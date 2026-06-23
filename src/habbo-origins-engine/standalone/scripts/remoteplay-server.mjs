#!/usr/bin/env node
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const standaloneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(standaloneRoot, "..");
const useDevMain = process.env.ORIGINS_REMOTEPLAY_DEV_MAIN === "1";
const executablePath = resolve(
  process.env.ORIGINS_REMOTEPLAY_EXE ??
    (useDevMain
      ? join(standaloneRoot, "node_modules", "electron", "dist", "electron.exe")
      : join(standaloneRoot, "release", "win-unpacked", "Shockless Engine.exe")),
);
const host = process.env.ORIGINS_REMOTEPLAY_HOST ?? "127.0.0.1";
const requestedPort = positiveInteger(process.env.ORIGINS_REMOTEPLAY_PORT, 8787);
const requestTimeoutMs = positiveInteger(process.env.ORIGINS_REMOTEPLAY_REQUEST_TIMEOUT_MS, 120000);
const gameReadyTimeoutMs = positiveInteger(process.env.ORIGINS_REMOTEPLAY_GAME_READY_TIMEOUT_MS, 180000);

let electronApp = null;
let launcherPage = null;
let gamePage = null;
let startedAt = null;
const pageLogs = [];
const actionLog = [];
const trackedPages = new WeakSet();

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pushLimited(list, value, limit = 600) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function logAction(kind, message, details = null) {
  pushLimited(actionLog, {
    at: new Date().toISOString(),
    kind,
    message,
    details,
  });
}

function trackPage(page, label) {
  if (trackedPages.has(page)) return;
  trackedPages.add(page);
  page.on("console", (message) => {
    pushLimited(pageLogs, `[${new Date().toISOString()}] [${label}] [${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    pushLimited(pageLogs, `[${new Date().toISOString()}] [${label}] [pageerror] ${String(error)}`);
  });
  page.on("close", () => {
    pushLimited(pageLogs, `[${new Date().toISOString()}] [${label}] [pageclose] ${page.url()}`);
  });
  page.on("crash", () => {
    pushLimited(pageLogs, `[${new Date().toISOString()}] [${label}] [pagecrash] ${page.url()}`);
  });
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function combineExtraQuery(existing, required) {
  const params = new URLSearchParams(existing?.startsWith("?") ? existing.slice(1) : existing ?? "");
  const extra = new URLSearchParams(required);
  for (const [key, value] of extra) {
    if (!params.has(key)) params.set(key, value);
  }
  return params.toString();
}

async function ensureLauncher() {
  if (launcherPage && !launcherPage.isClosed()) return launcherPage;
  if (!existsSync(executablePath)) {
    throw new Error(`Standalone executable not found: ${executablePath}`);
  }
  if (!electronApp) {
    electronApp = await electron.launch({
      executablePath,
      ...(useDevMain ? { args: [join(standaloneRoot, "dist", "main", "main", "main.js")] } : {}),
      env: {
        ...process.env,
        ORIGINS_STANDALONE_HEADLESS: "1",
        ORIGINS_STANDALONE_TRACE: "1",
        ORIGINS_STANDALONE_EXTRA_QUERY: combineExtraQuery(
          process.env.ORIGINS_STANDALONE_EXTRA_QUERY,
          "consoleLog=1&capture=1",
        ),
      },
    });
    startedAt = new Date().toISOString();
    electronApp.on("window", (page) => trackPage(page, `window-${electronApp.windows().length}`));
    electronApp.on("close", () => {
      electronApp = null;
      launcherPage = null;
      gamePage = null;
      startedAt = null;
    });
    logAction("engine", "hidden standalone process launched", { executablePath });
  }
  launcherPage = await electronApp.firstWindow();
  trackPage(launcherPage, "launcher");
  await launcherPage.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await launcherPage.waitForFunction(() => Boolean(window.standalone?.getState), null, { timeout: 30000 });
  return launcherPage;
}

async function findGamePage() {
  if (gamePage && !gamePage.isClosed()) return gamePage;
  if (!electronApp) return null;
  for (const page of electronApp.windows()) {
    if (page.isClosed() || page === launcherPage) continue;
    const hasCanvas = await page.locator("canvas").count().catch(() => 0);
    if (hasCanvas > 0) {
      gamePage = page;
      trackPage(gamePage, "game");
      return gamePage;
    }
  }
  return null;
}

async function waitForGameReady(timeoutMs = gameReadyTimeoutMs) {
  const page = await findGamePage();
  if (!page) throw new Error("Game page has not been opened. Call POST /api/engine/start first.");
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  await page.waitForSelector("canvas", { timeout: timeoutMs });
  await page.waitForFunction(() => Boolean(window.__engine?.dev), null, { timeout: timeoutMs });
  return page;
}

async function startGame(profileId = null) {
  const launcher = await ensureLauncher();
  const gamePromise = electronApp.waitForEvent("window", { timeout: 45000 }).catch(() => null);
  const playResult = await launcher.evaluate(async ({ profileId: targetProfileId }) => {
    const api = window.standalone;
    if (!api) throw new Error("standalone preload API is unavailable");
    const state = await api.getState();
    const activeId = state.settings.activeProfileId;
    const profile =
      state.profiles.find((entry) => entry.id === targetProfileId) ??
      state.profiles.find((entry) => entry.id === activeId) ??
      state.profiles.find((entry) => entry.runtime?.ready) ??
      state.profiles[0] ??
      null;
    if (!profile) throw new Error("No imported profile is available");
    if (!profile.runtime?.ready) {
      throw new Error(profile.runtime?.reason ?? `Profile is not ready: ${profile.id}`);
    }
    await api.setActiveProfile(profile.id);
    await api.playProfile(profile.id);
    return {
      profileId: profile.id,
      displayName: profile.displayName,
      versionId: profile.versionId,
      buildNumber: profile.buildNumber,
      versionCheckBuild: state.settings.versionCheckBuild,
    };
  }, { profileId });
  const newGame = await gamePromise;
  if (newGame && !newGame.isClosed()) {
    gamePage = newGame;
    trackPage(gamePage, "game");
  }
  await waitForGameReady();
  logAction("engine", "game engine page ready", playResult);
  return playResult;
}

async function stopGame() {
  const app = electronApp;
  electronApp = null;
  launcherPage = null;
  gamePage = null;
  startedAt = null;
  if (app) await app.close().catch(() => undefined);
  logAction("engine", "hidden standalone process stopped");
  return { stopped: true };
}

async function engineEval(pageFunction, arg, label, timeoutMs = requestTimeoutMs) {
  const page = await waitForGameReady();
  return withTimeout(page.evaluate(pageFunction, arg), timeoutMs, label);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueText(value, fallback = "") {
  if (value === null || typeof value === "undefined") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function firstText(...values) {
  for (const value of values) {
    const text = valueText(value, "");
    if (text.trim().length > 0) return text;
  }
  return "";
}

function statusValue(value, fallback = "unknown") {
  const text = valueText(value, fallback);
  return text.startsWith("#") ? text.slice(1) : text;
}

function entriesToObject(value) {
  if (!isRecord(value) || !Array.isArray(value.entries)) return {};
  const result = {};
  for (const entry of value.entries) {
    if (!isRecord(entry)) continue;
    const key = valueText(entry.key);
    if (!key) continue;
    result[key.startsWith("#") ? key.slice(1) : key] = entry.value;
  }
  return result;
}

function normalizeNavigatorNode(node) {
  const typeNumber = Number(node?.nodeType);
  const type =
    typeNumber === 0 ? "category" :
    typeNumber === 1 ? "public-room" :
    typeNumber === 2 ? "private-room" :
    Number.isFinite(typeNumber) ? `type-${typeNumber}` :
    "unknown";
  const users = Number(node?.users);
  const maxUsers = Number(node?.maxUsers);
  return {
    cacheKey: node?.cacheKey ?? null,
    parentCacheKey: node?.parentCacheKey ?? null,
    nodeType: Number.isFinite(typeNumber) ? typeNumber : node?.nodeType ?? null,
    type,
    id: valueText(node?.id),
    name: valueText(node?.name, valueText(node?.unitStrId, "Unnamed")),
    parentId: valueText(node?.parentId),
    unitStrId: valueText(node?.unitStrId),
    port: valueText(node?.port),
    door: valueText(node?.door),
    users: Number.isFinite(users) ? users : null,
    maxUsers: Number.isFinite(maxUsers) ? maxUsers : null,
    hidden: node?.hidden ?? null,
    halfRoomID: node?.halfRoomID ?? null,
    casts: node?.casts ?? null,
  };
}

function summarizeNavigator(nodes) {
  const normalized = (Array.isArray(nodes) ? nodes : []).map(normalizeNavigatorNode);
  const categories = normalized.filter((node) => node.type === "category");
  const publicRooms = normalized.filter((node) => node.type === "public-room");
  const privateRooms = normalized.filter((node) => node.type === "private-room");
  const categoriesByKey = new Map(categories.map((category) => [String(category.cacheKey ?? category.id), category]));
  const publicByCategory = {};
  for (const room of publicRooms) {
    const key = String(room.parentCacheKey ?? room.parentId ?? "uncategorized");
    const category = categoriesByKey.get(key);
    const label = category?.name || room.parentId || "Uncategorized";
    if (!publicByCategory[label]) publicByCategory[label] = [];
    publicByCategory[label].push(room);
  }
  return {
    total: normalized.length,
    categories,
    publicRooms,
    privateRooms,
    publicByCategory,
  };
}

function summarizeRoomObject(object) {
  if (!isRecord(object)) {
    return {
      key: null,
      id: null,
      class: valueText(object, "unknown"),
      type: "",
      loc: null,
      sprites: null,
    };
  }
  const sprites = Array.isArray(object.sprites) ? object.sprites : [];
  return {
    key: object.key ?? null,
    id: object.id ?? null,
    class: object.class || object.name || object.key || object.id || "unknown",
    type: object.type || "",
    loc: Array.isArray(object.loc) ? object.loc : object.local ?? object.wall ?? null,
    wall: Array.isArray(object.wall) ? object.wall : null,
    local: Array.isArray(object.local) ? object.local : null,
    sprites: sprites.length || null,
  };
}

function summarizeRoom(roomEntryState, roomReady, roomObjects = null, options = {}) {
  const component = isRecord(roomEntryState?.roomComponent) ? roomEntryState.roomComponent : {};
  const saveData = entriesToObject(component.pSaveData);
  const lastroom = entriesToObject(roomEntryState?.lastroom);
  const users = Array.isArray(roomObjects?.users) ? roomObjects.users : [];
  const active = Array.isArray(roomObjects?.active) ? roomObjects.active : [];
  const passive = Array.isArray(roomObjects?.passive) ? roomObjects.passive : [];
  const items = Array.isArray(roomObjects?.items) ? roomObjects.items : [];
  const type = statusValue(roomReady?.roomType ?? saveData.type ?? lastroom.type, "unknown");
  const summary = {
    mode: type === "public" ? "public-room" : type === "private" ? "private-room" : "unknown",
    ready: Boolean(roomReady?.ready),
    route: valueText(roomReady?.route),
    id: firstText(roomReady?.roomId, component.pRoomId, saveData.id, lastroom.id),
    flatId: firstText(saveData.flatId, saveData.flatid, lastroom.flatId, lastroom.flatid),
    name: firstText(saveData.name, lastroom.name, component.pRoomId, roomReady?.roomId) || "Unknown room",
    owner: firstText(saveData.owner, saveData.ownerName, lastroom.owner, lastroom.ownerName),
    type,
    users: users.map((user) => {
      const summary = summarizeRoomObject(user);
      return {
        key: summary.key,
        id: summary.id,
        name: summary.class || "user",
        loc: summary.loc,
        sprites: summary.sprites,
      };
    }),
    counts: {
      users: users.length,
      activeObjects: active.length,
      passiveObjects: passive.length,
      wallItems: items.length,
      roomLikeSprites: Number(roomReady?.roomLikeSpriteCount) || 0,
    },
  };
  if (roomObjects) {
    summary.objects = {
      active: active.map(summarizeRoomObject),
      passive: passive.map(summarizeRoomObject),
      wallItems: items.map(summarizeRoomObject),
    };
  }
  if (options.includeSource) {
    summary.source = {
      roomReady,
      roomEntryState,
      roomObjects,
    };
  }
  return summary;
}

function summarizeRemoteStatus(payload) {
  const engine = payload.engine;
  const room = summarizeRoom(engine?.roomEntryState, engine?.roomReady);
  const navigator = summarizeNavigator(engine?.navigatorNodes ?? engine?.publicNodes ?? []);
  const editableFields = Number(engine?.editableFields) || 0;
  const hasGame = Boolean(payload.remotePlay?.gameReady) && !engine?.captureError;
  const entryState = isRecord(engine?.roomEntryState?.entryState) ? engine.roomEntryState.entryState : {};
  const navigatorState = statusValue(engine?.roomEntryState?.navigatorState, "");
  let location = "stopped";
  if (payload.remotePlay?.standaloneRunning && !payload.remotePlay?.gameReady) location = "launcher";
  if (hasGame) location = "engine-ready";
  if (hasGame && editableFields >= 2 && !room.ready) location = "login";
  if (hasGame && (entryState.entryBarObject || entryState.entryVisualizerObject || navigatorState === "enterEntry")) {
    location = "hotel-view";
  }
  if (room.ready) location = room.mode;
  return {
    engine: {
      running: Boolean(payload.remotePlay?.standaloneRunning),
      launcherReady: Boolean(payload.remotePlay?.launcherReady),
      gameReady: Boolean(payload.remotePlay?.gameReady),
      status: valueText(engine?.status, payload.remotePlay?.standaloneRunning ? "starting" : "stopped"),
      profile: engine?.scriptBundle ?? null,
      errors: engine?.errors ?? null,
      captureError: engine?.captureError ?? null,
    },
    login: {
      canLogin: hasGame && editableFields >= 2,
      editableFields,
      loggedIn: room.ready || location === "hotel-view",
    },
    location: {
      mode: location,
      label:
        location === "private-room" ? "Private room" :
        location === "public-room" ? "Public room" :
        location === "hotel-view" ? "Hotel view" :
        location === "login" ? "Login screen" :
        location === "launcher" ? "Launcher" :
        location === "engine-ready" ? "Engine ready" :
        "Stopped",
      navigatorState,
    },
    room,
    navigator,
    chatTail: Array.isArray(engine?.chatTail) ? engine.chatTail : [],
  };
}

async function currentEngineStatus() {
  const base = {
    remotePlay: {
      host,
      startedAt,
      standaloneRunning: Boolean(electronApp),
      launcherReady: Boolean(launcherPage && !launcherPage.isClosed()),
      gameReady: Boolean(gamePage && !gamePage.isClosed()),
      executablePath,
      useDevMain,
    },
    logs: {
      actions: actionLog.slice(-40),
      page: pageLogs.slice(-80),
    },
  };
  const page = await findGamePage();
  if (!page) return { ...base, summary: summarizeRemoteStatus(base) };
  const engine = await page
    .evaluate(() => ({
      status: document.getElementById("status")?.textContent ?? "",
      editableFields: window.__engine?.dev?.editableFields?.().length ?? 0,
      roomReady: window.__engine?.dev?.roomReady?.() ?? null,
      roomEntryState: window.__engine?.dev?.roomEntryState?.() ?? null,
      navigatorNodes: (window.__engine?.dev?.navigatorNodes?.() ?? window.__engine?.dev?.navigatorPublicNodes?.() ?? []).slice(0, 250),
      publicNodes: (window.__engine?.dev?.navigatorPublicNodes?.() ?? []).slice(0, 40),
      chatTail: (window.__engine?.dev?.chatHistory?.() ?? []).slice(-20),
      scriptBundle: window.__engine?.dev?.scriptBundle?.() ?? null,
      errors: window.__engine?.errors?.() ?? null,
    }))
    .catch((error) => ({ captureError: error instanceof Error ? error.message : String(error) }));
  const payload = { ...base, engine };
  return { ...payload, summary: summarizeRemoteStatus(payload) };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body exceeds 1 MB");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendHtml(response, body) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

async function officialOriginsUserLookup(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) throw new Error("Missing user name");
  const url = `https://origins.habbo.com/api/public/users?name=${encodeURIComponent(trimmed)}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "ShocklessEngine-RemotePlay/0.1",
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the response body as text if Sulake changes the payload.
  }
  return {
    source: "official-origins-public-api",
    endpoint: "https://origins.habbo.com/api/public/users?name=<name>",
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    sendJson(response, 200, await currentEngineStatus());
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/logs") {
    sendJson(response, 200, { actions: actionLog.slice(-200), page: pageLogs.slice(-300) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/engine/start") {
    const body = await readJson(request);
    sendJson(response, 200, { ok: true, result: await startGame(body.profileId ?? null), status: await currentEngineStatus() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/engine/stop") {
    sendJson(response, 200, { ok: true, result: await stopGame() });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(request);
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    if (!email || !password) throw new Error("email and password are required");
    const result = await engineEval(
      async ({ email: loginEmail, password: loginPassword, delayMs, waitForRoom, timeoutMs }) => {
        const login = await window.__engine.dev.login(loginEmail, loginPassword, delayMs);
        const roomReady = waitForRoom ? await window.__engine.dev.waitForRoomReady(timeoutMs) : null;
        return { login, roomReady };
      },
      {
        email,
        password,
        delayMs: positiveInteger(body.delayMs, 10),
        waitForRoom: body.waitForRoom !== false,
        timeoutMs: positiveInteger(body.timeoutMs, 180000),
      },
      "remotePlay login",
    );
    logAction("command", "login submitted through Director source fields", { email, waitForRoom: body.waitForRoom !== false });
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/hotel-view") {
    const body = await readJson(request);
    const result = await engineEval(
      async ({ timeoutMs, stableMs }) => {
        const view = await window.__engine.dev.showHotelView();
        const stable = await window.__engine.dev.waitForHotelViewStable(timeoutMs, stableMs);
        return { view, stable };
      },
      {
        timeoutMs: positiveInteger(body.timeoutMs, 45000),
        stableMs: positiveInteger(body.stableMs, 1500),
      },
      "remotePlay hotel view",
    );
    logAction("command", "hotel view requested");
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/rooms/public") {
    const result = await engineEval(
      () => window.__engine?.dev?.navigatorPublicNodes?.() ?? [],
      null,
      "remotePlay public room list",
      10000,
    );
    sendJson(response, 200, { ok: true, rooms: summarizeNavigator(result).publicRooms, raw: result });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/navigator/nodes") {
    const result = await engineEval(
      () => window.__engine?.dev?.navigatorNodes?.() ?? window.__engine?.dev?.navigatorPublicNodes?.() ?? [],
      null,
      "remotePlay navigator node list",
      10000,
    );
    sendJson(response, 200, { ok: true, navigator: summarizeNavigator(result), raw: result });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/rooms/public") {
    const body = await readJson(request);
    const query = body.query ?? body.name ?? body.id ?? "";
    const result = await engineEval(
      async ({ query, ensureHotelView, timeoutMs }) => {
        if (ensureHotelView) {
          const deadline = performance.now() + Math.min(timeoutMs, 60000);
          while ((window.__engine.dev.navigatorPublicNodes?.() ?? []).length === 0 && performance.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          await window.__engine.dev.showHotelView();
          await window.__engine.dev.waitForHotelViewStable(45000, 1500);
        }
        return window.__engine.dev.enterPublicRoom(query, timeoutMs);
      },
      {
        query,
        ensureHotelView: body.ensureHotelView !== false,
        timeoutMs: positiveInteger(body.timeoutMs, 90000),
      },
      "remotePlay enter public room",
    );
    logAction("command", "public room entry requested", { query });
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/rooms/private") {
    const body = await readJson(request);
    const flatId = String(body.flatId ?? body.id ?? "").trim();
    const result = await engineEval(
      ({ flatId, timeoutMs }) => window.__engine.dev.enterPrivateRoom(flatId || undefined, true, timeoutMs),
      { flatId, timeoutMs: positiveInteger(body.timeoutMs, 90000) },
      "remotePlay enter private room",
    );
    logAction("command", "private room entry requested", { flatId });
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/room") {
    const includeObjects = url.searchParams.get("objects") === "1";
    const result = await engineEval(
      ({ includeObjects }) => ({
        roomEntryState: window.__engine.dev.roomEntryState(),
        roomReady: window.__engine.dev.roomReady(),
        roomObjects: includeObjects ? window.__engine.roomObjects?.() ?? null : null,
      }),
      { includeObjects },
      "remotePlay current room info",
      includeObjects ? 30000 : 10000,
    );
    sendJson(response, 200, {
      ok: true,
      room: summarizeRoom(result.roomEntryState, result.roomReady, result.roomObjects),
      debug: result,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/chat") {
    const result = await engineEval(
      () => window.__engine?.dev?.chatHistory?.() ?? [],
      null,
      "remotePlay chat history",
      10000,
    );
    sendJson(response, 200, { ok: true, messages: result });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/chat/send") {
    const body = await readJson(request);
    const message = String(body.message ?? "");
    const result = await engineEval(
      ({ message, delayMs }) => window.__engine.dev.sendChat(message, delayMs),
      { message, delayMs: positiveInteger(body.delayMs, 0) },
      "remotePlay send chat",
    );
    logAction("command", "chat message sent through Director chat field", { length: message.length });
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/navigator/open") {
    const body = await readJson(request);
    const result = await engineEval(
      ({ view }) => (view ? window.__engine.dev.navigatorView(view) : window.__engine.dev.openNavigator()),
      { view: body.view ?? null },
      "remotePlay open navigator",
    );
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/windows") {
    const result = await engineEval(() => window.__engine.dev.windowIds(), null, "remotePlay window ids", 10000);
    sendJson(response, 200, { ok: true, windows: result });
    return;
  }
  const windowMatch = /^\/api\/windows\/([^/]+)$/.exec(url.pathname);
  if (request.method === "GET" && windowMatch) {
    const id = decodeURIComponent(windowMatch[1]);
    const includeImages = url.searchParams.get("images") === "1";
    const result = await engineEval(
      ({ id, includeImages }) => window.__engine.dev.windowElements(id, includeImages),
      { id, includeImages },
      "remotePlay window elements",
      includeImages ? 60000 : 10000,
    );
    sendJson(response, 200, { ok: true, window: result });
    return;
  }
  const windowClickMatch = /^\/api\/windows\/([^/]+)\/click$/.exec(url.pathname);
  if (request.method === "POST" && windowClickMatch) {
    const body = await readJson(request);
    const id = decodeURIComponent(windowClickMatch[1]);
    const elementId = String(body.elementId ?? "");
    const result = await engineEval(
      ({ id, elementId }) => window.__engine.dev.clickWindowElement(id, elementId),
      { id, elementId },
      "remotePlay click window element",
    );
    sendJson(response, 200, { ok: true, result });
    return;
  }
  if (request.method === "GET" && (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/"))) {
    const name = url.pathname === "/api/users"
      ? url.searchParams.get("name")
      : decodeURIComponent(url.pathname.slice("/api/users/".length));
    sendJson(response, 200, await officialOriginsUserLookup(name));
    return;
  }

  sendJson(response, 404, { ok: false, error: `Unknown endpoint: ${request.method} ${url.pathname}` });
}

const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Shockless Engine remotePlay</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #080b0f;
        --surface: #111822;
        --surface-2: #182331;
        --surface-3: #202b3a;
        --line: #314155;
        --line-soft: #253346;
        --text: #f1f6ff;
        --muted: #96a8bd;
        --gold: #f0c247;
        --blue: #6fb8d3;
        --green: #55d982;
        --red: #ff7474;
        --orange: #f39c4a;
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at 22% 8%, rgba(95, 137, 187, 0.24), transparent 30%),
          linear-gradient(135deg, #07090d 0%, #0c1119 52%, #111817 100%);
        color: var(--text);
        font: 13px/1.45 "Segoe UI", Arial, sans-serif;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--line);
        background: rgba(8, 11, 15, 0.92);
      }
      h1, h2, h3 { margin: 0; letter-spacing: 0; }
      h1 { font-size: 20px; }
      h2 { font-size: 14px; color: var(--gold); }
      h3 { font-size: 13px; color: var(--text); }
      p { margin: 0; }
      button {
        border: 1px solid #44566c;
        background: linear-gradient(#2b394a, #1f2b39);
        color: var(--text);
        border-radius: 5px;
        padding: 8px 11px;
        font: 700 12px/1 "Segoe UI", Arial, sans-serif;
        cursor: pointer;
      }
      button:hover { border-color: #6c8098; }
      button:disabled { cursor: default; opacity: 0.48; }
      button.primary { background: linear-gradient(#8a6717, #60480e); border-color: #b98f24; color: #fff8d5; }
      button.danger { background: linear-gradient(#68323b, #441b23); border-color: #96505a; }
      button.ghost { background: #111821; }
      input, select, textarea {
        width: 100%;
        border: 1px solid #40536c;
        background: #071019;
        color: var(--text);
        border-radius: 5px;
        padding: 8px 9px;
        font: inherit;
      }
      label { display: grid; gap: 5px; color: var(--muted); }
      main {
        display: grid;
        grid-template-columns: 330px minmax(0, 1fr);
        gap: 14px;
        padding: 14px;
      }
      .stack { display: grid; gap: 12px; }
      .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: linear-gradient(180deg, rgba(25, 36, 50, 0.97), rgba(14, 20, 30, 0.98));
        padding: 12px;
        min-width: 0;
      }
      .panel-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }
      .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
      .muted { color: var(--muted); }
      .small { font-size: 12px; }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: #101720;
        color: var(--muted);
        padding: 5px 9px;
        min-height: 25px;
      }
      .pill.ok { color: #c9ffdc; border-color: rgba(85, 217, 130, 0.55); background: rgba(18, 75, 44, 0.42); }
      .pill.warn { color: #ffe2b7; border-color: rgba(243, 156, 74, 0.58); background: rgba(82, 52, 19, 0.44); }
      .pill.bad { color: #ffd0d0; border-color: rgba(255, 116, 116, 0.55); background: rgba(88, 30, 35, 0.45); }
      .dot { width: 8px; height: 8px; border-radius: 99px; background: currentColor; display: inline-block; }
      .tabbar {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }
      .tabbar button[aria-selected="true"] { border-color: var(--gold); color: #fff3bd; background: #46370f; }
      .view { display: grid; gap: 12px; }
      .metric {
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: rgba(9, 14, 21, 0.48);
        padding: 10px;
      }
      .metric b { display: block; font-size: 18px; margin-top: 3px; }
      .room-list {
        display: grid;
        gap: 8px;
        max-height: 430px;
        overflow: auto;
        padding-right: 3px;
      }
      .room-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: rgba(12, 18, 28, 0.74);
        padding: 10px;
      }
      .room-card strong { display: block; overflow-wrap: anywhere; }
      .room-card .badge-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
      .inline-badge {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--line-soft);
        border-radius: 999px;
        padding: 2px 7px;
        color: var(--muted);
        background: rgba(255, 255, 255, 0.035);
        font-size: 11px;
      }
      .chat-log {
        display: grid;
        gap: 7px;
        max-height: 390px;
        overflow: auto;
      }
      .chat-line {
        border-left: 3px solid var(--blue);
        background: rgba(9, 14, 21, 0.58);
        padding: 7px 9px;
      }
      .chat-line b { color: #ffffff; }
      .details-box {
        margin: 0;
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: #060a10;
        color: #dbe6f5;
        padding: 10px;
        max-height: 360px;
        overflow: auto;
        white-space: pre-wrap;
      }
      details {
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: rgba(6, 10, 16, 0.58);
        padding: 8px;
      }
      summary { cursor: pointer; color: var(--gold); font-weight: 700; }
      .table-scroll {
        max-height: 300px;
        overflow: auto;
        border: 1px solid var(--line-soft);
        border-radius: 7px;
      }
      .table-scroll .api-table th,
      .table-scroll .api-table td { background: rgba(6, 10, 16, 0.42); }
      .window-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 8px;
      }
      .window-card,
      .element-card {
        border: 1px solid var(--line-soft);
        border-radius: 7px;
        background: rgba(9, 14, 21, 0.64);
        padding: 9px;
        display: grid;
        gap: 6px;
      }
      .window-card button,
      .element-card button { justify-self: start; }
      .command-feed {
        display: grid;
        gap: 6px;
        max-height: 220px;
        overflow: auto;
      }
      .command-row {
        display: grid;
        grid-template-columns: 78px minmax(0, 1fr);
        gap: 8px;
        border-bottom: 1px solid var(--line-soft);
        padding: 6px 2px;
      }
      .notice {
        border: 1px solid rgba(240, 194, 71, 0.36);
        background: rgba(75, 58, 13, 0.28);
        border-radius: 7px;
        padding: 9px 10px;
      }
      .api-table {
        width: 100%;
        border-collapse: collapse;
      }
      .api-table th, .api-table td {
        text-align: left;
        border-bottom: 1px solid var(--line-soft);
        padding: 7px 5px;
        vertical-align: top;
      }
      .api-table th { color: var(--muted); font-weight: 700; }
      @media (max-width: 980px) {
        main { grid-template-columns: 1fr; }
        .tabbar, .grid-2, .grid-3 { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Shockless Engine remotePlay</h1>
        <p class="muted">Local control dashboard for a hidden standalone game engine instance.</p>
      </div>
      <div class="row" id="top-pills">
        <span class="pill"><span class="dot"></span>Loading</span>
      </div>
    </header>

    <main>
      <aside class="stack">
        <section class="panel">
          <div class="panel-head">
            <h2>Engine</h2>
            <span id="poll-state" class="pill">Auto refresh on</span>
          </div>
          <div class="row">
            <button class="primary" data-command="start">Start engine</button>
            <button data-command="status">Refresh</button>
            <button class="danger" data-command="stop">Stop</button>
          </div>
          <div class="stack" id="engine-summary" style="margin-top:12px"></div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Login</h2></div>
          <div class="stack">
            <label>Email <input id="login-email" autocomplete="username" /></label>
            <label>Password <input id="login-password" type="password" autocomplete="current-password" /></label>
            <button data-command="login">Login and wait for room</button>
            <div id="login-state" class="muted small">Waiting for engine state.</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>User Lookup</h2></div>
          <div class="stack">
            <label>Origins username <input id="user-name" placeholder="dek" /></label>
            <button data-command="user-lookup">Lookup user</button>
            <div class="notice small">In-client console search still needs source mapping. This panel uses the official Origins public lookup API.</div>
            <div id="user-result" class="stack"></div>
          </div>
        </section>
      </aside>

      <section class="panel">
        <div class="tabbar">
          <button data-panel="overview" aria-selected="true">Overview</button>
          <button data-panel="navigator">Navigator</button>
          <button data-panel="room">Room</button>
          <button data-panel="chat">Chat</button>
          <button data-panel="windows">Windows</button>
          <button data-panel="debug">Debug</button>
        </div>

        <div id="overview" class="view"></div>

        <div id="navigator" class="view" hidden>
          <div class="row">
            <button data-command="hotel">Hotel view</button>
            <button data-command="open-navigator">Open Navigator</button>
            <button data-command="navigator-nodes">Refresh rooms</button>
          </div>
          <div class="grid-2">
            <label>Category <select id="category-filter"><option value="">All public rooms</option></select></label>
            <label>Search public rooms <input id="navigator-search" placeholder="Filter by name, id, or category" /></label>
          </div>
          <div class="grid-2">
            <label>Public room name or id <input id="public-room" placeholder="Welcome Lounge" /></label>
            <label>Room entry <select id="public-entry-mode"><option value="hotel">Ensure hotel view first</option><option value="direct">Use current source state</option></select></label>
          </div>
          <div class="row">
            <button data-command="enter-public">Enter public room</button>
          </div>
          <div id="navigator-summary" class="grid-3"></div>
          <div id="public-room-list" class="room-list"></div>
        </div>

        <div id="room" class="view" hidden>
          <div class="row">
            <button data-command="room-info">Refresh room data</button>
            <button data-command="hotel">Leave to hotel view</button>
          </div>
          <div class="grid-2">
            <label>Private flat id <input id="private-room" placeholder="34251" /></label>
            <label>Room detail mode <select id="room-detail-mode"><option value="summary">Summary only</option><option value="objects">Include users and objects</option></select></label>
          </div>
          <div class="row">
            <button data-command="enter-private">Enter private room</button>
          </div>
          <div id="room-current" class="stack"></div>
          <div id="room-detail" class="stack"></div>
        </div>

        <div id="chat" class="view" hidden>
          <div class="grid-2">
            <label>Message <input id="chat-message" placeholder="Hello from remotePlay" /></label>
            <label>Refresh <select id="chat-refresh"><option value="auto">Auto</option><option value="manual">Manual</option></select></label>
          </div>
          <div class="row">
            <button data-command="send-chat">Send chat</button>
            <button data-command="read-chat">Read chat history</button>
          </div>
          <div id="chat-log" class="chat-log"></div>
        </div>

        <div id="windows" class="view" hidden>
          <div class="row">
            <button data-command="windows">Refresh windows</button>
            <button data-command="window-elements">Inspect selected window</button>
          </div>
          <div class="grid-2">
            <label>Window id <input id="window-id" placeholder="Hotel Navigator" /></label>
            <label>Element filter <input id="window-filter" placeholder="close, button, tab, room" /></label>
          </div>
          <div id="window-list" class="window-grid"></div>
          <div id="window-elements" class="stack"></div>
        </div>

        <div id="debug" class="view" hidden>
          <div class="row">
            <button data-command="logs">Logs</button>
            <button data-command="status">Refresh status</button>
          </div>
          <div id="debug-output" class="stack"></div>
        </div>
      </section>
    </main>

    <script>
      const state = {
        status: null,
        navigator: null,
        roomDetail: null,
        windows: null,
        windowElements: null,
        activePanel: "overview",
        refreshing: false,
      };
      const $ = (id) => document.getElementById(id);
      const html = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
      const json = (value) => JSON.stringify(value, null, 2);
      const setBusy = (button, busy) => { if (button) button.disabled = busy; };
      const pill = (label, tone) => '<span class="pill ' + (tone || "") + '"><span class="dot"></span>' + html(label) + '</span>';
      const metric = (label, value, hint) => '<div class="metric"><span class="muted small">' + html(label) + '</span><b>' + html(value) + '</b>' + (hint ? '<div class="muted small">' + html(hint) + '</div>' : '') + '</div>';
      const rawDetails = (label, value) => '<details><summary>' + html(label) + '</summary><pre class="details-box">' + html(json(value)) + '</pre></details>';

      async function api(path, options = {}) {
        const response = await fetch(path, {
          method: options.method || "GET",
          headers: options.body ? { "content-type": "application/json" } : undefined,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || response.statusText);
        return data;
      }

      function renderTop(status) {
        const summary = status.summary || {};
        const engine = summary.engine || {};
        const login = summary.login || {};
        const location = summary.location || {};
        $("top-pills").innerHTML = [
          pill(engine.gameReady ? "Engine ready" : engine.running ? "Starting" : "Stopped", engine.gameReady ? "ok" : engine.running ? "warn" : "bad"),
          pill(login.loggedIn ? "Logged in" : login.canLogin ? "Login ready" : "Login unavailable", login.loggedIn ? "ok" : login.canLogin ? "warn" : ""),
          pill(location.label || "Unknown", location.mode === "private-room" || location.mode === "public-room" ? "ok" : location.mode === "login" ? "warn" : ""),
          pill(engine.errors === 0 ? "No errors" : "Errors: " + (engine.errors ?? "unknown"), engine.errors === 0 ? "ok" : engine.errors ? "bad" : ""),
        ].join("");
      }

      function renderEngine(status) {
        const summary = status.summary || {};
        const engine = summary.engine || {};
        const location = summary.location || {};
        const profile = engine.profile || {};
        $("engine-summary").innerHTML = [
          metric("State", engine.gameReady ? "Ready" : engine.running ? "Starting" : "Stopped", location.label || ""),
          metric("Profile", profile.runtimeVersion || profile.executableVersion || "Unknown", profile.exact ? "exact script bundle" : ""),
          metric("Status", engine.status || "No engine page", engine.captureError || ""),
        ].join("");
        $("login-state").textContent = summary.login?.loggedIn ? "Logged in. Current location: " + (location.label || "unknown") : summary.login?.canLogin ? "Login fields are ready." : "Start the engine and wait for login fields.";
      }

      function renderOverview(status) {
        const summary = status.summary || {};
        const room = summary.room || {};
        const nav = summary.navigator || {};
        const actions = status.logs?.actions || [];
        $("overview").innerHTML = [
          '<div class="grid-3">',
          metric("Location", summary.location?.label || "Unknown", room.name || ""),
          metric("Room", room.ready ? room.name || room.id || "Ready" : "Not in a room", room.type || ""),
          metric("Navigator", (nav.publicRooms?.length || 0) + " public rooms", (nav.categories?.length || 0) + " categories cached"),
          '</div>',
          '<div class="panel" style="background:rgba(8,13,20,0.42)">',
          '<div class="panel-head"><h3>Current room</h3><button data-panel="room">Open room panel</button></div>',
          roomSummaryHtml(room),
          '</div>',
          '<div class="panel" style="background:rgba(8,13,20,0.42)">',
          '<div class="panel-head"><h3>Recent chat</h3><button data-panel="chat">Open chat panel</button></div>',
          chatHtml(summary.chatTail || []),
          '</div>',
          '<div class="panel" style="background:rgba(8,13,20,0.42)">',
          '<div class="panel-head"><h3>Command timeline</h3><button data-panel="debug">Open debug</button></div>',
          actionFeedHtml(actions),
          '</div>',
        ].join("");
      }

      function actionFeedHtml(actions) {
        if (!actions.length) return '<div class="notice">No remotePlay commands have run yet.</div>';
        return '<div class="command-feed">' + actions.slice(-12).reverse().map((entry) => {
          const time = entry.at ? new Date(entry.at).toLocaleTimeString() : "";
          return '<div class="command-row"><span class="muted small">' + html(time) + '</span><div><b>' + html(entry.kind || "action") + '</b><div>' + html(entry.message || "") + '</div></div></div>';
        }).join("") + '</div>';
      }

      function roomSummaryHtml(room) {
        const counts = room.counts || {};
        return [
          '<div class="grid-3">',
          metric("Users", counts.users ?? 0),
          metric("Furni", (counts.activeObjects ?? 0) + "/" + (counts.passiveObjects ?? 0), "active/passive"),
          metric("Wall items", counts.wallItems ?? 0),
          '</div>',
          '<table class="api-table"><tbody>',
          '<tr><th>Mode</th><td>' + html(room.mode || "unknown") + '</td></tr>',
          '<tr><th>Name</th><td>' + html(room.name || "") + '</td></tr>',
          '<tr><th>ID</th><td>' + html(room.id || room.flatId || "") + '</td></tr>',
          '<tr><th>Owner</th><td>' + html(room.owner || "") + '</td></tr>',
          '<tr><th>Route</th><td>' + html(room.route || "") + '</td></tr>',
          '</tbody></table>',
        ].join("");
      }

      function renderNavigator(status) {
        const nav = state.navigator?.navigator || status.summary?.navigator || { categories: [], publicRooms: [] };
        const selected = $("category-filter").value;
        const previousOptions = $("category-filter").innerHTML;
        const categories = nav.categories || [];
        const options = ['<option value="">All public rooms</option>'].concat(categories.map((category) => '<option value="' + html(category.name) + '">' + html(category.name) + '</option>')).join("");
        if (previousOptions !== options) {
          $("category-filter").innerHTML = options;
          $("category-filter").value = selected;
        }
        const filter = $("category-filter").value;
        const search = $("navigator-search").value.trim().toLowerCase();
        const rooms = (nav.publicRooms || []).filter((room) => {
          const category = Object.entries(nav.publicByCategory || {}).find(([, candidates]) =>
            candidates.some((candidate) => candidate.id === room.id && candidate.name === room.name)
          )?.[0] || "";
          const categoryMatch = !filter || category === filter;
          const searchHaystack = [room.name, room.id, room.unitStrId, room.parentId, category].join(" ").toLowerCase();
          return categoryMatch && (!search || searchHaystack.includes(search));
        });
        $("navigator-summary").innerHTML = [
          metric("Categories", categories.length),
          metric("Public rooms", nav.publicRooms?.length || 0),
          metric("Shown", rooms.length, filter || "All categories"),
        ].join("");
        $("public-room-list").innerHTML = rooms.length ? rooms.map((room) => {
          const occupancy = room.users === null || room.maxUsers === null ? "" : room.users + "/" + room.maxUsers;
          const query = room.id || room.name || room.unitStrId || "";
          const category = Object.entries(nav.publicByCategory || {}).find(([, candidates]) =>
            candidates.some((candidate) => candidate.id === room.id && candidate.name === room.name)
          )?.[0] || "";
          const badges = [category, occupancy, room.id, room.unitStrId].filter(Boolean);
          return '<div class="room-card"><div><strong>' + html(room.name || query) + '</strong><div class="badge-row">' + badges.map((badge) => '<span class="inline-badge">' + html(badge) + '</span>').join("") + '</div></div><button data-public-query="' + html(query) + '">Enter</button></div>';
        }).join("") : '<div class="notice">No public rooms cached yet. Start the engine, log in, then refresh rooms or open Hotel view.</div>';
      }

      function renderRoom(status) {
        const room = state.roomDetail?.room || status.summary?.room || {};
        $("room-current").innerHTML = roomSummaryHtml(room);
        if (state.roomDetail?.room) {
          $("room-detail").innerHTML = [
            objectTableHtml("Users", state.roomDetail.room.users || [], "name"),
            objectTableHtml("Active furni", state.roomDetail.room.objects?.active || [], "class"),
            objectTableHtml("Passive furni", state.roomDetail.room.objects?.passive || [], "class"),
            objectTableHtml("Wall items", state.roomDetail.room.objects?.wallItems || [], "class"),
            rawDetails("Room debug JSON", state.roomDetail),
          ].join("");
        }
      }

      function objectTableHtml(title, rows, nameField) {
        if (!rows.length) return '<section><h3>' + html(title) + '</h3><div class="notice small">No entries reported.</div></section>';
        return [
          '<section class="stack">',
          '<div class="panel-head"><h3>' + html(title) + '</h3><span class="pill">' + rows.length + '</span></div>',
          '<div class="table-scroll"><table class="api-table"><thead><tr><th>Name/Class</th><th>ID</th><th>Type</th><th>Location</th><th>Sprites</th></tr></thead><tbody>',
          rows.slice(0, 120).map((row) => {
            const loc = Array.isArray(row.loc) ? row.loc.join(", ") : row.loc || "";
            return '<tr><td>' + html(row[nameField] || row.class || row.name || row.key || "") + '</td><td>' + html(row.id || row.key || "") + '</td><td>' + html(row.type || "") + '</td><td>' + html(loc) + '</td><td>' + html(row.sprites || "") + '</td></tr>';
          }).join(""),
          '</tbody></table></div>',
          rows.length > 120 ? '<div class="muted small">Showing first 120 entries.</div>' : '',
          '</section>',
        ].join("");
      }

      function chatHtml(messages) {
        if (!messages.length) return '<div class="notice">No chat messages recorded in the source chat history yet.</div>';
        return messages.slice(-30).map((entry) => {
          const user = entry.userName || entry.userId || "system";
          const text = entry.text || entry.raw || "";
          return '<div class="chat-line"><b>' + html(user) + '</b><div>' + html(text) + '</div><div class="muted small">' + html(entry.mode || entry.type || "") + '</div></div>';
        }).join("");
      }

      function renderChat(status) {
        $("chat-log").innerHTML = chatHtml(status.summary?.chatTail || []);
      }

      function renderDebug(status) {
        if (!$("debug-output").innerHTML) {
          $("debug-output").innerHTML = rawDetails("Latest status JSON", status);
        }
      }

      function renderWindows() {
        const windows = state.windows?.windows || [];
        $("window-list").innerHTML = windows.length ? windows.map((id) => {
          const selected = id === $("window-id").value;
          return '<div class="window-card"><strong>' + html(id) + '</strong><span class="muted small">' + (selected ? 'selected' : 'source window') + '</span><button data-window-id="' + html(id) + '">Inspect</button></div>';
        }).join("") : '<div class="notice">No source windows listed yet. Start the engine, then refresh windows.</div>';

        const windowInfo = state.windowElements?.window;
        if (!windowInfo) {
          $("window-elements").innerHTML = '<div class="notice">Select a window to inspect its source elements.</div>';
          return;
        }
        const filter = $("window-filter").value.trim().toLowerCase();
        const elements = Array.isArray(windowInfo.elements) ? windowInfo.elements : Array.isArray(windowInfo) ? windowInfo : [];
        const visible = elements.filter((element) => {
          const haystack = json(element).toLowerCase();
          return !filter || haystack.includes(filter);
        });
        $("window-elements").innerHTML = [
          '<div class="panel-head"><h3>' + html($("window-id").value || "Window") + ' elements</h3><span class="pill">' + visible.length + '/' + elements.length + '</span></div>',
          visible.length ? '<div class="window-grid">' + visible.slice(0, 180).map((element, index) => {
            const elementId = element.id || element.elementId || element.name || element.key || element.memberName || String(index);
            const label = element.name || element.id || element.memberName || elementId;
            const rect = Array.isArray(element.rect) ? element.rect.join(", ") : "";
            const member = element.memberName || element.member || element.memberId || "";
            return '<div class="element-card"><strong>' + html(label) + '</strong><div class="muted small">' + html([member, rect].filter(Boolean).join(" | ")) + '</div><button data-window-element="' + html(elementId) + '">Click element</button></div>';
          }).join("") + '</div>' : '<div class="notice">No elements match the current filter.</div>',
          rawDetails("Window element JSON", state.windowElements),
        ].join("");
      }

      function renderAll() {
        if (!state.status) return;
        renderTop(state.status);
        renderEngine(state.status);
        renderOverview(state.status);
        renderNavigator(state.status);
        renderRoom(state.status);
        renderChat(state.status);
        renderWindows();
        renderDebug(state.status);
      }

      async function refreshStatus() {
        if (state.refreshing) return state.status;
        state.refreshing = true;
        $("poll-state").textContent = "Refreshing";
        try {
          state.status = await api("/api/status");
          renderAll();
          $("poll-state").textContent = "Auto refresh on";
          return state.status;
        } finally {
          state.refreshing = false;
        }
      }

      async function command(name) {
        if (name === "start") return api("/api/engine/start", { method: "POST", body: {} });
        if (name === "stop") {
          state.roomDetail = null;
          state.windows = null;
          state.windowElements = null;
          return api("/api/engine/stop", { method: "POST", body: {} });
        }
        if (name === "status") return refreshStatus();
        if (name === "login") return api("/api/login", { method: "POST", body: { email: $("login-email").value, password: $("login-password").value, waitForRoom: true } });
        if (name === "hotel") return api("/api/hotel-view", { method: "POST", body: {} });
        if (name === "open-navigator") return api("/api/navigator/open", { method: "POST", body: {} });
        if (name === "navigator-nodes") {
          state.navigator = await api("/api/navigator/nodes");
          renderNavigator(state.status || { summary: {} });
          return state.navigator;
        }
        if (name === "enter-public") return api("/api/rooms/public", {
          method: "POST",
          body: {
            query: $("public-room").value || "Welcome Lounge",
            ensureHotelView: $("public-entry-mode").value !== "direct",
          },
        });
        if (name === "enter-private") return api("/api/rooms/private", { method: "POST", body: { flatId: $("private-room").value } });
        if (name === "room-info") {
          const includeObjects = $("room-detail-mode").value === "objects";
          const result = await api("/api/room" + (includeObjects ? "?objects=1" : ""));
          state.roomDetail = result;
          renderRoom(state.status || { summary: {} });
          return result;
        }
        if (name === "send-chat") return api("/api/chat/send", { method: "POST", body: { message: $("chat-message").value } });
        if (name === "read-chat") {
          const result = await api("/api/chat");
          $("chat-log").innerHTML = chatHtml(result.messages || []);
          return result;
        }
        if (name === "user-lookup") {
          const result = await api("/api/users?name=" + encodeURIComponent($("user-name").value));
          renderUserLookup(result);
          return result;
        }
        if (name === "windows") {
          const result = await api("/api/windows");
          state.windows = result;
          renderWindows();
          return result;
        }
        if (name === "window-elements") {
          const result = await api("/api/windows/" + encodeURIComponent($("window-id").value));
          state.windowElements = result;
          renderWindows();
          return result;
        }
        if (name === "logs") {
          const result = await api("/api/logs");
          $("debug-output").innerHTML = rawDetails("Logs", result);
          return result;
        }
        throw new Error("Unknown command: " + name);
      }

      function renderUserLookup(result) {
        const body = result.body;
        const user = Array.isArray(body) ? body[0] : body?.user || body;
        if (!user || typeof user !== "object") {
          $("user-result").innerHTML = '<div class="notice">No structured user data returned.</div>' + rawDetails("Lookup response", result);
          return;
        }
        $("user-result").innerHTML = [
          '<table class="api-table"><tbody>',
          '<tr><th>Name</th><td>' + html(user.name || user.uniqueId || "") + '</td></tr>',
          '<tr><th>Motto</th><td>' + html(user.motto || "") + '</td></tr>',
          '<tr><th>Figure</th><td>' + html(user.figureString || user.figure || "") + '</td></tr>',
          '<tr><th>Profile</th><td>' + html(user.profileVisible ?? user.online ?? "") + '</td></tr>',
          '</tbody></table>',
          rawDetails("Lookup response", result),
        ].join("");
      }

      function selectPanel(panel) {
        if (!panel) return;
        state.activePanel = panel;
        document.querySelectorAll(".tabbar [data-panel]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.panel === panel)));
        document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== panel; });
      }

      document.querySelectorAll(".tabbar [data-panel]").forEach((button) => {
        button.addEventListener("click", () => selectPanel(button.dataset.panel));
      });

      $("category-filter").addEventListener("change", () => renderNavigator(state.status || { summary: {} }));
      $("navigator-search").addEventListener("input", () => renderNavigator(state.status || { summary: {} }));
      $("window-filter").addEventListener("input", () => renderWindows());
      document.addEventListener("click", async (event) => {
        const panelButton = event.target.closest("[data-panel]");
        if (panelButton) {
          event.preventDefault();
          selectPanel(panelButton.dataset.panel);
          return;
        }
        const roomButton = event.target.closest("[data-public-query]");
        if (roomButton) {
          $("public-room").value = roomButton.dataset.publicQuery || "";
          event.preventDefault();
          await runButton(roomButton, async () => api("/api/rooms/public", {
            method: "POST",
            body: {
              query: $("public-room").value,
              ensureHotelView: $("public-entry-mode").value !== "direct",
            },
          }));
          return;
        }
        const windowButton = event.target.closest("[data-window-id]");
        if (windowButton) {
          event.preventDefault();
          $("window-id").value = windowButton.dataset.windowId || "";
          await runButton(windowButton, async () => {
            const result = await api("/api/windows/" + encodeURIComponent($("window-id").value));
            state.windowElements = result;
            renderWindows();
            return result;
          });
          return;
        }
        const elementButton = event.target.closest("[data-window-element]");
        if (elementButton) {
          event.preventDefault();
          await runButton(elementButton, async () => api("/api/windows/" + encodeURIComponent($("window-id").value) + "/click", {
            method: "POST",
            body: { elementId: elementButton.dataset.windowElement || "" },
          }));
          return;
        }
        const button = event.target.closest("[data-command]");
        if (!button) return;
        event.preventDefault();
        await runButton(button, () => command(button.dataset.command));
      });

      async function runButton(button, action) {
        setBusy(button, true);
        try {
          const result = await action();
          $("debug-output").innerHTML = rawDetails("Last command result", result);
          await refreshStatus();
        } catch (error) {
          const message = '<div class="notice">Command failed: ' + html(error.message || String(error)) + '</div>';
          const panel = button.closest(".view");
          if (panel?.id === "debug") $("debug-output").innerHTML = message;
          else if (panel?.id === "room") $("room-detail").innerHTML = message;
          else if (panel?.id === "chat") $("chat-log").innerHTML = message;
          else if (panel?.id === "navigator") $("public-room-list").innerHTML = message;
          else $("engine-summary").innerHTML = message;
        } finally {
          setBusy(button, false);
        }
      }

      refreshStatus().catch((error) => {
        $("engine-summary").innerHTML = '<div class="notice">Unable to read status: ' + html(error.message || String(error)) + '</div>';
      });
      setInterval(() => {
        if ($("chat-refresh").value === "manual" && state.activePanel === "chat") return;
        refreshStatus().catch(() => {});
      }, 5000);
    </script>
  </body>
</html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (request.method === "GET" && url.pathname === "/") {
      sendHtml(response, dashboardHtml);
      return;
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    sendJson(response, 404, { ok: false, error: `Not found: ${url.pathname}` });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

async function listenWithFallback(startPort) {
  for (let port = startPort; port < startPort + 20; port += 1) {
    const result = await new Promise((resolve) => {
      const onError = (error) => {
        server.off("listening", onListening);
        resolve({ ok: false, error });
      };
      const onListening = () => {
        server.off("error", onError);
        resolve({ ok: true, port });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
    if (result.ok) return result.port;
    if (result.error?.code !== "EADDRINUSE") throw result.error;
  }
  throw new Error(`No free remotePlay port found from ${startPort} to ${startPort + 19}`);
}

const port = await listenWithFallback(requestedPort);
const url = `http://${host}:${port}/`;
console.log(`remotePlay dashboard: ${url}`);
console.log(`remotePlay API docs: ${join(repoRoot, "docs", "REMOTE_PLAY_API.md")}`);

process.on("SIGINT", async () => {
  await stopGame();
  server.close(() => process.exit(0));
});
process.on("SIGTERM", async () => {
  await stopGame();
  server.close(() => process.exit(0));
});
