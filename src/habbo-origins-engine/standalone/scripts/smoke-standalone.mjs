#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const standaloneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const useDevMain = process.env.ORIGINS_SMOKE_DEV_MAIN === "1";
const visibleStandalone = process.env.ORIGINS_SMOKE_VISIBLE === "1";
const executablePath = resolve(
  process.argv[2] ??
    (useDevMain
      ? join(standaloneRoot, "node_modules", "electron", "dist", "electron.exe")
      : join(standaloneRoot, "release", "win-unpacked", "Shockless Engine.exe")),
);
const outRoot = resolve(process.argv[3] ?? join(standaloneRoot, "..", "tmp", "standalone-smoke"));
const electronArgs = parseArgList(process.env.ORIGINS_SMOKE_ELECTRON_ARGS ?? "");
const lightFacts = process.env.ORIGINS_SMOKE_LIGHT_FACTS === "1";
const includeRoomAnchors = process.env.ORIGINS_SMOKE_INCLUDE_ROOM_ANCHORS === "1";
const sourceDiagnostics = process.env.ORIGINS_SMOKE_SOURCE_DIAGNOSTICS === "1";
const showUserNameLabels = process.env.ORIGINS_SMOKE_SHOW_USER_NAMES === "1";
const requestedRoomStageZoom = Math.max(1, Number(process.env.ORIGINS_SMOKE_ROOM_STAGE_ZOOM ?? 1) | 0);
const memberQueries = (process.env.ORIGINS_SMOKE_MEMBER_QUERIES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const resolvedSpriteQueries = (process.env.ORIGINS_SMOKE_RESOLVED_SPRITES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const resolvedSpriteChannels = (process.env.ORIGINS_SMOKE_SPRITE_CHANNELS ?? "")
  .split(",")
  .map((entry) => Number(entry.trim()))
  .filter((entry) => Number.isFinite(entry) && entry > 0);
const hitProbes = (process.env.ORIGINS_SMOKE_HIT_PROBES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const match = /^(-?\d+):(-?\d+)$/.exec(entry);
    if (!match) throw new Error(`Invalid ORIGINS_SMOKE_HIT_PROBES entry: ${entry}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  });
const mouseMoves = (process.env.ORIGINS_SMOKE_MOUSE_MOVES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const match = /^(-?\d+):(-?\d+)(?::(\d+))?$/.exec(entry);
    if (!match) throw new Error(`Invalid ORIGINS_SMOKE_MOUSE_MOVES entry: ${entry}`);
    return { x: Number(match[1]), y: Number(match[2]), waitMs: Number(match[3] ?? 500) };
  });
const stageClicks = (process.env.ORIGINS_SMOKE_STAGE_CLICKS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const match = /^(-?\d+):(-?\d+)(?::(\d+))?$/.exec(entry);
    if (!match) throw new Error(`Invalid ORIGINS_SMOKE_STAGE_CLICKS entry: ${entry}`);
    return { x: Number(match[1]), y: Number(match[2]), waitMs: Number(match[3] ?? 1000) };
  });
const stageDrags = (process.env.ORIGINS_SMOKE_STAGE_DRAGS ?? "")
  .split(";")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const match = /^(-?\d+):(-?\d+):(-?\d+):(-?\d+)(?::(\d+))?$/.exec(entry);
    if (!match) throw new Error(`Invalid ORIGINS_SMOKE_STAGE_DRAGS entry: ${entry}`);
    return {
      fromX: Number(match[1]),
      fromY: Number(match[2]),
      toX: Number(match[3]),
      toY: Number(match[4]),
      waitMs: Number(match[5] ?? 1000),
    };
  });
const realTypeSteps = (process.env.ORIGINS_SMOKE_REAL_TYPE_STEPS ?? "")
  .split("|")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [xText, yText, text = "", waitText = "1000"] = entry.split(":");
    const x = Number(xText);
    const y = Number(yText);
    const waitMs = Number(waitText);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Invalid ORIGINS_SMOKE_REAL_TYPE_STEPS entry: ${entry}`);
    }
    return {
      x,
      y,
      text: text.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t"),
      waitMs: Number.isFinite(waitMs) ? waitMs : 1000,
    };
  });
const spriteClicks = (process.env.ORIGINS_SMOKE_CLICK_SPRITES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const match = /^(.+?)(?::(\d+))?$/.exec(entry);
    if (!match) throw new Error(`Invalid ORIGINS_SMOKE_CLICK_SPRITES entry: ${entry}`);
    return { query: match[1].trim(), waitMs: Number(match[2] ?? 1000) };
  });
const includeResolvedImages = process.env.ORIGINS_SMOKE_INCLUDE_IMAGES === "1";
const skipScreenshots = process.env.ORIGINS_SMOKE_SKIP_SCREENSHOTS === "1";
const resolvedSpriteLimit = Math.max(1, Number(process.env.ORIGINS_SMOKE_RESOLVED_LIMIT ?? 12) | 0);
const executeMessages = (process.env.ORIGINS_SMOKE_EXECUTE_MESSAGES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const traceHandlersBeforePublic = (process.env.ORIGINS_SMOKE_TRACE_HANDLERS_BEFORE_PUBLIC ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const traceHandlersAtStart = (process.env.ORIGINS_SMOKE_TRACE_HANDLERS_START ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const windowQueries = (process.env.ORIGINS_SMOKE_WINDOW_IDS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const objectQueries = (process.env.ORIGINS_SMOKE_OBJECT_IDS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const variableQueries = (process.env.ORIGINS_SMOKE_VARIABLES ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const windowElementClicks = (process.env.ORIGINS_SMOKE_CLICK_WINDOW_ELEMENTS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(`Invalid ORIGINS_SMOKE_CLICK_WINDOW_ELEMENTS entry: ${entry}`);
    }
    return {
      windowId: entry.slice(0, separator),
      elementId: entry.slice(separator + 1),
    };
  });

if (!existsSync(executablePath)) {
  throw new Error(`Standalone executable not found: ${executablePath}`);
}

mkdirSync(outRoot, { recursive: true });

function writePartial(label, data) {
  writeFileSync(
    join(outRoot, "partial-result.json"),
    `${JSON.stringify({ label, generatedAt: new Date().toISOString(), ...data }, null, 2)}\n`,
    "utf8",
  );
}

function parseResizeSequence(value) {
  if (!value) return [];
  if (value === "1") {
    return [
      { width: 1500, height: 760 },
      { width: 960, height: 540 },
      { width: 1280, height: 760 },
    ];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+)x(\d+)$/i.exec(entry);
      if (!match) throw new Error(`Invalid ORIGINS_SMOKE_RESIZE_SEQUENCE entry: ${entry}`);
      return { width: Number(match[1]), height: Number(match[2]) };
    });
}

function parseFlatSequence(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseArgList(value) {
  if (!value) return [];
  return value.match(/"[^"]+"|'[^']+'|\S+/g)?.map((entry) => entry.replace(/^["']|["']$/g, "")) ?? [];
}

function safeFilePart(value) {
  return String(value ?? "room")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
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

function summarizePublicBeginResult(result) {
  if (!result || typeof result !== "object") return result;
  const summarizeNode = (node) => {
    if (!node || typeof node !== "object") return node ?? null;
    const entries = Array.isArray(node.entries)
      ? Object.fromEntries(
          node.entries.map((entry) => [
            String(entry.key ?? "").replace(/^#/, ""),
            entry.value,
          ]),
        )
      : node;
    const casts = Array.isArray(entries.casts?.items)
      ? entries.casts.items
      : Array.isArray(entries.casts)
        ? entries.casts
        : entries.casts?.type === "list"
          ? entries.casts.items ?? []
          : entries.casts ?? [];
    return {
      id: entries.id,
      nodeType: entries.nodeType,
      name: entries.name,
      parentId: entries.parentid ?? entries.parentId,
      unitStrId: entries.unitStrId,
      port: entries.port,
      door: entries.door,
      casts,
    };
  };
  const cache = result.cache && typeof result.cache === "object" ? result.cache : null;
  const publicNodes = Array.isArray(cache?.publicNodes) ? cache.publicNodes : [];
  return {
    route: result.route,
    query: result.query,
    result: result.result,
    errors: result.errors,
    node: summarizeNode(result.node),
    cache: cache
      ? {
          route: cache.route,
          expandedCategories: Array.isArray(cache.expandedCategories)
            ? cache.expandedCategories.map((entry) => summarizeNode(entry.node))
            : [],
          publicNodeCount: publicNodes.length,
          matchedPublicNodes: publicNodes
            .map(summarizeNode)
            .filter((node) => {
              const query = String(result.query ?? "").toLowerCase();
              return (
                String(node?.id ?? "").toLowerCase() === query ||
                String(node?.name ?? "").toLowerCase().includes(query) ||
                String(node?.unitStrId ?? "").toLowerCase() === query
              );
            })
            .slice(0, 8),
          errors: cache.errors,
        }
      : null,
  };
}

async function captureLightGameStatus(game, label = "light game status") {
  try {
    return await withTimeout(
      game.evaluate(() => ({
        status: document.getElementById("status")?.textContent ?? "",
        performance: window.__engine?.dev?.performanceStats?.() ?? null,
        editableFieldCount: window.__engine?.dev?.editableFields?.().length ?? null,
        roomReady: window.__engine?.dev?.roomReady?.() ?? null,
        roomEntryState: window.__engine?.dev?.roomEntryState?.() ?? null,
        logTail: Array.from(document.querySelectorAll("#log div"))
          .slice(-12)
          .map((entry) => entry.textContent ?? ""),
      })),
      Number(process.env.ORIGINS_SMOKE_LIGHT_STATUS_TIMEOUT_MS ?? 1500),
      label,
    );
  } catch (error) {
    return { captureError: error instanceof Error ? error.message : String(error) };
  }
}

function summarizePublicNode(node) {
  if (!node || typeof node !== "object") return node ?? null;
  const entries = Array.isArray(node.entries)
    ? Object.fromEntries(
        node.entries.map((entry) => [
          String(entry.key ?? "").replace(/^#/, ""),
          entry.value,
        ]),
      )
    : node;
  const casts = Array.isArray(entries.casts?.items)
    ? entries.casts.items
    : Array.isArray(entries.casts)
      ? entries.casts
      : entries.casts?.type === "list"
        ? entries.casts.items ?? []
        : entries.casts ?? [];
  return {
    id: entries.id,
    nodeType: entries.nodeType,
    name: entries.name,
    parentId: entries.parentid ?? entries.parentId,
    unitStrId: entries.unitStrId,
    port: entries.port,
    door: entries.door,
    casts,
  };
}

function publicNodeMatchesQuery(node, query) {
  const text = String(query ?? "").trim().toLowerCase();
  if (!text) return false;
  return (
    String(node?.id ?? "").toLowerCase() === text ||
    String(node?.name ?? "").toLowerCase().includes(text) ||
    String(node?.unitStrId ?? "").toLowerCase() === text
  );
}

async function waitForPublicRoomNode(game, query, timeoutMs, pollMs) {
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 30000);
  let samples = 0;
  let last = null;
  while (Date.now() < deadline) {
    samples += 1;
    last = await captureLightGameStatus(game, "public node status");
    const nodes = Array.isArray(last?.roomEntryState?.publicNodes)
      ? last.roomEntryState.publicNodes.map(summarizePublicNode)
      : [];
    const match = nodes.find((node) => publicNodeMatchesQuery(node, query)) ?? null;
    if (match) {
      return { ready: true, samples, query, match, publicNodeCount: nodes.length, last };
    }
    await game.waitForTimeout(Math.max(50, Number(pollMs) || 500));
  }
  const nodes = Array.isArray(last?.roomEntryState?.publicNodes)
    ? last.roomEntryState.publicNodes.map(summarizePublicNode)
    : [];
  return { ready: false, samples, query, match: null, publicNodeCount: nodes.length, last };
}

async function captureGameFacts(game) {
  return await game.evaluate(({ lightFacts, memberQueries, resolvedSpriteQueries, resolvedSpriteChannels, hitProbes, includeResolvedImages, includeRoomAnchors, resolvedSpriteLimit, windowQueries, objectQueries, variableQueries, sourceDiagnostics }) => {
    const activeSprites = window.__engine?.activeSprites?.() ?? [];
    const visibleSprites = activeSprites.filter((sprite) => sprite.vis !== 0);
    const spriteBounds =
      visibleSprites.length === 0
        ? null
        : visibleSprites.reduce(
            (bounds, sprite) => {
              const [x, y] = sprite.loc ?? [0, 0];
              const [width, height] = sprite.size ?? [0, 0];
              return {
                left: Math.min(bounds.left, x),
                top: Math.min(bounds.top, y),
                right: Math.max(bounds.right, x + width),
                bottom: Math.max(bounds.bottom, y + height),
              };
            },
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
          );
    const roomLikeSprites = activeSprites.filter((sprite) => {
      const member = String(sprite.member ?? "").toLowerCase();
      const id = String(sprite.id ?? "").toLowerCase();
      return (
        member.includes("floor") ||
        member.includes("wall") ||
        member.includes("tile") ||
        member.includes("chair") ||
        member.includes("sofa") ||
        member.includes("trophy") ||
        id.includes("room") ||
        id.includes("obj") ||
        id.includes("user")
      );
    });
    return {
      url: location.href,
      status: document.getElementById("status")?.textContent ?? "",
      canvasCount: document.querySelectorAll("canvas").length,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      canvas: (() => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return {
          width: canvas.width,
          height: canvas.height,
          cssWidth: rect.width,
          cssHeight: rect.height,
        };
      })(),
      resize: window.__engine?.resizeEngine?.() ?? null,
      roomStageZoom: window.__engine?.dev?.roomStageZoom?.() ?? null,
      userNameLabels: window.__engine?.dev?.userNameLabels?.() ?? null,
      customHotelView: window.__engine?.customHotelView?.() ?? window.__engine?.dev?.customHotelView?.() ?? null,
      performance: window.__engine?.dev?.performanceStats?.() ?? null,
      scriptBundle: window.__engine?.dev?.scriptBundle?.() ?? null,
      roomReady: window.__engine?.dev?.roomReady?.() ?? null,
      roomEntryState: window.__engine?.dev?.roomEntryState?.() ?? null,
      currentFlatId: window.__engine?.dev?.currentPrivateRoomFlatId?.() ?? null,
      keyboardFocus: window.__engine?.dev?.keyboardFocus?.() ?? null,
      editableFields: window.__engine?.dev?.editableFields?.() ?? [],
      navigatorPublicNodes: (window.__engine?.dev?.navigatorPublicNodes?.() ?? []).slice(0, 80),
      windowIds: windowQueries.length > 0 ? window.__engine?.dev?.windowIds?.() ?? [] : null,
      windowDiagnostics:
        windowQueries.length > 0
          ? Object.fromEntries(
              windowQueries.map((id) => [
                id,
                window.__engine?.dev?.windowElements?.(id, includeResolvedImages) ?? null,
              ]),
            )
          : null,
      objectDiagnostics:
        objectQueries.length > 0
          ? Object.fromEntries(
              objectQueries.map((id) => [
                id,
                window.__engine?.objectProps?.(id) ?? null,
              ]),
            )
          : null,
      variableDiagnostics: variableQueries.length > 0 ? (window.__engine?.variables?.(variableQueries) ?? null) : null,
      sourceDiagnostics: sourceDiagnostics
        ? {
            toggleIgBroker: window.__engine?.dev?.brokerMessage?.("toggle_ig") ?? null,
            threads: window.__engine?.dev?.threads?.() ?? null,
            igState: window.__engine?.dev?.igState?.() ?? null,
          }
        : null,
      memberDiagnostics:
        memberQueries.length > 0 ? (window.__engine?.dev?.memberDiagnostics?.(memberQueries) ?? null) : null,
      resolvedSpriteDiagnostics:
        resolvedSpriteQueries.length > 0 || resolvedSpriteChannels.length > 0
          ? {
              channels: Object.fromEntries(
                resolvedSpriteChannels.map((channel) => [
                  channel,
                  window.__engine?.dev?.resolvedSpriteDebug?.(channel, includeResolvedImages) ?? null,
                ]),
              ),
              queries: Object.fromEntries(
                resolvedSpriteQueries.map((query) => [
                  query,
                  (window.__engine?.dev?.resolvedSprites?.(query, includeResolvedImages) ?? []).slice(0, resolvedSpriteLimit),
                ]),
              ),
            }
          : null,
      hitProbes:
        hitProbes.length > 0
          ? hitProbes.map((probe) => ({
              ...probe,
              hits: window.__engine?.dev?.hitProbe?.(probe.x, probe.y) ?? [],
            }))
          : null,
      objectIds: window.__engine?.objectIds?.() ?? [],
      roomObjects: lightFacts ? null : (window.__engine?.dev?.roomObjects?.() ?? window.__engine?.roomObjects?.() ?? null),
      roomAnchors: lightFacts && !includeRoomAnchors
        ? null
        : {
            roomInterface: window.__engine?.objectProps?.("#room_interface") ?? null,
            roomVisualizer: window.__engine?.visualizer?.("Room_visualizer") ?? null,
            roomBar: window.__engine?.objectProps?.("RoomBarID") ?? null,
            roomInfo: window.__engine?.objectProps?.("Room_info") ?? null,
            roomInfoStand: window.__engine?.objectProps?.("Room_info_stand") ?? null,
            hand: window.__engine?.visualizer?.("Hand_visualizer") ?? null,
            handButtons: window.__engine?.objectProps?.("habbo_hand_buttons") ?? null,
          },
      spriteStats: {
        activeCount: activeSprites.length,
        visibleCount: visibleSprites.length,
        visibleBounds: spriteBounds,
        roomLikeSample: roomLikeSprites.slice(0, lightFacts ? 24 : 80),
      },
      activeSpritesSample: activeSprites.slice(0, lightFacts ? 40 : 120),
      log: Array.from(document.querySelectorAll("#log div")).map((entry) => entry.textContent ?? ""),
      logTail: Array.from(document.querySelectorAll("#log div"))
        .slice(-25)
        .map((entry) => entry.textContent ?? ""),
    };
  }, {
    lightFacts,
    memberQueries,
    resolvedSpriteQueries,
    resolvedSpriteChannels,
    hitProbes,
    includeResolvedImages,
    includeRoomAnchors,
    resolvedSpriteLimit,
    windowQueries,
    objectQueries,
    variableQueries,
    sourceDiagnostics,
  });
}

async function captureGameFactsSafe(game, label = "game facts capture") {
  const timeoutMs = Number(process.env.ORIGINS_SMOKE_FACTS_TIMEOUT_MS ?? 5000);
  try {
    return await withTimeout(captureGameFacts(game), timeoutMs, label);
  } catch (error) {
    return {
      captureError: error instanceof Error ? error.message : String(error),
      log: [],
    };
  }
}

async function captureScreenshotIfEnabled(page, path) {
  if (skipScreenshots) return { screenshotPath: null, screenshotError: null };
  try {
    await capturePageImage(page, path);
    return { screenshotPath: path, screenshotError: null };
  } catch (error) {
    return {
      screenshotPath: null,
      screenshotError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function capturePageImage(page, path) {
  if (process.env.ORIGINS_SMOKE_CANVAS_SCREENSHOTS === "1") {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return null;
      return canvas.toDataURL("image/png");
    });
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,")) {
      writeFileSync(path, Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
      return;
    }
  }
  await page.screenshot({ path, timeout: Number(process.env.ORIGINS_SMOKE_SCREENSHOT_TIMEOUT_MS ?? 30000) });
}

async function pollRoomReady(game, timeoutMs, intervalMs, pollTimeoutMs, onPoll) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let samples = 0;
  let last = null;
  while (Date.now() < deadline) {
    samples += 1;
    try {
      last = await withTimeout(
        game.evaluate(() => ({
          roomReady: window.__engine?.dev?.roomReady?.() ?? null,
          roomEntryState: window.__engine?.dev?.roomEntryState?.() ?? null,
        })),
        pollTimeoutMs,
        "room-state poll",
      );
    } catch (error) {
      return {
        ready: false,
        samples,
        timedOut: true,
        error: error instanceof Error ? error.message : String(error),
        last,
      };
    }
    await onPoll?.({ samples, last });
    if (last?.roomReady?.ready) {
      return {
        ready: true,
        samples,
        timedOut: false,
        last,
      };
    }
    await game.waitForTimeout(intervalMs);
  }
  return {
    ready: false,
    samples,
    timedOut: false,
    last,
  };
}

async function closeBulletinBoard(game) {
  return await game.evaluate(() => {
    const dev = window.__engine?.dev;
    const attempts = [];
    const flatten = (elements) => {
      const result = [];
      for (const element of Array.isArray(elements) ? elements : []) {
        result.push(element);
        result.push(...flatten(element?.children));
      }
      return result;
    };
    const textFor = (value) => {
      if (value == null) return "";
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
      if (Array.isArray(value)) return value.map(textFor).join(" ");
      if (typeof value === "object") {
        return [
          value.id,
          value.class,
          value.type,
          value.member?.name,
          value.member?.castName,
          value.buffer?.name,
          value.textMember?.name,
          value.sprite?.member,
          value.children,
        ]
          .map(textFor)
          .join(" ");
      }
      return "";
    };
    const isBulletinWindow = (id, windowState) =>
      /bulletin|board/i.test(`${id} ${windowState?.id ?? ""} ${windowState?.class ?? ""} ${textFor(windowState?.elements)}`);
    const isCloseElement = (element) => /(^|[_\s-])close($|[_\s-])|closebox|btn_close|closebutton/i.test(textFor(element));
    const ids = [
      ...(dev?.windowIds?.() ?? []),
      ...(window.__engine?.objectIds?.() ?? []).filter((id) => /bulletin|board/i.test(String(id ?? ""))),
    ].filter((id, index, list) => list.indexOf(id) === index);
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const id = ids[index];
      const windowState = dev?.windowElements?.(id, false);
      if (!isBulletinWindow(id, windowState)) continue;
      const close = flatten(windowState?.elements).find(isCloseElement);
      if (!close?.id) {
        attempts.push({ route: "source-window", id, closed: false, error: "no close element" });
        continue;
      }
      const result = dev?.clickWindowElement?.(id, close.id);
      attempts.push({ route: "source-window", id, elementId: close.id, result });
      if (result?.clicked === true) return { closed: true, route: `clicked window ${id} element ${close.id}`, attempts };
    }
    const close = window.__engine
      ?.activeSprites?.()
      ?.find((sprite) => /Bulletin Board_close/i.test(String(sprite.member ?? "")));
    if (!close) return { closed: false, route: "no bulletin close element or sprite", attempts };
    const clicked = dev?.clickSprite?.(close.n) === true;
    attempts.push({ route: "sprite-fallback", sprite: close.n, clicked });
    return { closed: clicked, route: clicked ? `clicked sprite ${close.n}` : "click failed", attempts };
  });
}

async function closeBulletinBeforeScreenshot(game, reason) {
  if (process.env.ORIGINS_SMOKE_CLOSE_BULLETIN !== "1") return null;
  const result = await closeBulletinBoard(game);
  if (result?.closed) {
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_BULLETIN_CLOSE_WAIT_MS ?? 1000));
  }
  return { reason, ...result };
}

const pageLogs = [];
const crashedPages = new Set();

function isCrashMessage(value) {
  return /target crashed|page crashed|renderer process crashed/i.test(String(value ?? ""));
}

function assertPageNotCrashed(page, label) {
  if (!page) return;
  if (crashedPages.has(page)) {
    throw new Error(`${label}: page crashed (${page.url()})`);
  }
  if (typeof page.isClosed === "function" && page.isClosed()) {
    throw new Error(`${label}: page closed (${page.url()})`);
  }
}
const app = await electron.launch({
  executablePath,
  args: [
    ...(useDevMain ? [join(standaloneRoot, "dist", "main", "main", "main.js")] : []),
    ...electronArgs,
  ],
  env: {
    ...process.env,
    ORIGINS_STANDALONE_HEADLESS: visibleStandalone ? "0" : "1",
    ORIGINS_STANDALONE_TRACE: process.env.ORIGINS_SMOKE_TRACE === "0" ? "0" : "1",
    ...(process.env.ORIGINS_SMOKE_RESIZABLE === "1" ? { ORIGINS_STANDALONE_FORCE_RESIZABLE: "1" } : {}),
  },
});

let launcher = null;
let game = null;
let loginAttempted = false;
let loginResult = null;
let roomWaited = false;
let roomReadyResult = null;
let hotelViewResult = null;
let hotelStableResult = null;
let hotelReturnResult = null;
let hotelReturnStableResult = null;
let hotelReturnScreenshotPath = null;
let bulletinCloseResult = null;
let userNameLabelsResult = null;
let roomStageZoomResult = null;
let enabledTraceHandlersAtStart = null;
let publicRoomBootstrapResult = null;
const enteredRooms = [];
const enteredPublicRooms = [];
const resizeSteps = [];
const mouseSteps = [];
const stageDragSteps = [];
const executedMessages = [];
const clickedWindowElements = [];
const clickedStagePoints = [];
const realTypedSteps = [];
const clickedSprites = [];
const postLoginSamples = [];

try {
  const publicRoomQueries = parseFlatSequence(process.env.ORIGINS_SMOKE_ENTER_PUBLIC_ROOMS);

  app.on("window", (page) => {
    page.on("console", (message) => {
      pageLogs.push(`[${new Date().toISOString()}] [${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      pageLogs.push(`[${new Date().toISOString()}] [pageerror] ${String(error)}`);
    });
    page.on("close", () => {
      pageLogs.push(`[${new Date().toISOString()}] [pageclose] ${page.url()}`);
    });
    page.on("crash", () => {
      crashedPages.add(page);
      pageLogs.push(`[${new Date().toISOString()}] [pagecrash] ${page.url()}`);
    });
  });

  launcher = await app.firstWindow();
  await launcher.waitForLoadState("domcontentloaded");
  await launcher.waitForFunction(
    () => {
      const byId = document.querySelector("#play-profile");
      if (byId instanceof HTMLButtonElement && !byId.disabled) return true;
      return [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim().toLowerCase() === "play" && !button.disabled,
      );
    },
    null,
    { timeout: 30000 },
  );

  const launchFacts = await launcher.evaluate(() => {
    const status = document.querySelector(".facts div:nth-child(5) dd")?.textContent?.trim() ?? "";
    const profile = document.querySelector(".facts div:nth-child(1) dd")?.textContent?.trim() ?? "";
    const build = document.querySelector(".facts div:nth-child(2) dd")?.textContent?.trim() ?? "";
    return { profile, build, status };
  });
  writePartial("launcher-ready", { launchFacts, pageLogTail: pageLogs.slice(-25) });

  const gamePromise = app.waitForEvent("window", { timeout: 30000 });
  const clickedPlay = await launcher.evaluate(() => {
    const byId = document.querySelector("#play-profile");
    if (byId instanceof HTMLButtonElement && !byId.disabled) {
      byId.click();
      return true;
    }
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim().toLowerCase() === "play" && !candidate.disabled,
    );
    if (button instanceof HTMLButtonElement) {
      button.click();
      return true;
    }
    return false;
  });
  if (!clickedPlay) {
    throw new Error("Playable profile button not found");
  }
  game = await gamePromise;
  await game.waitForLoadState("domcontentloaded");
  await game.waitForSelector("canvas", { timeout: 60000 });
  if (showUserNameLabels || requestedRoomStageZoom > 1) {
    await game.waitForFunction(
      () => Boolean(window.__engine?.dev?.setUserNameLabels) && Boolean(window.__engine?.dev?.setRoomStageZoom),
      null,
      { timeout: Number(process.env.ORIGINS_SMOKE_DEV_API_TIMEOUT_MS ?? 60000) },
    );
    if (showUserNameLabels) {
      userNameLabelsResult = await game.evaluate(() => window.__engine?.dev?.setUserNameLabels?.(true));
    }
    if (requestedRoomStageZoom > 1) {
      roomStageZoomResult = await game.evaluate((scale) => window.__engine?.dev?.setRoomStageZoom?.(scale), requestedRoomStageZoom);
    }
  }
  if (traceHandlersAtStart.length > 0) {
    await game.waitForFunction(
      () => Boolean(window.__engine?.dev?.setTraceHandlers),
      null,
      { timeout: Number(process.env.ORIGINS_SMOKE_TRACE_READY_TIMEOUT_MS ?? 60000) },
    );
    enabledTraceHandlersAtStart = await game.evaluate(
      (handlers) => window.__engine?.dev?.setTraceHandlers?.(handlers),
      traceHandlersAtStart,
    );
  }
  await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_WAIT_MS ?? 30000));
  writePartial("game-opened", {
    launchFacts,
    enabledTraceHandlersAtStart,
    gameFacts: await captureGameFactsSafe(game, "game-opened facts"),
    pageLogTail: pageLogs.slice(-25),
  });

  const loginEmail = process.env.ORIGINS_SMOKE_EMAIL;
  const loginPassword = process.env.ORIGINS_SMOKE_PASSWORD;
  if (loginEmail && loginPassword) {
    const loginReadyTimeoutMs = Number(process.env.ORIGINS_SMOKE_LOGIN_READY_TIMEOUT_MS ?? 180000);
    const loginReadyDeadline = Date.now() + loginReadyTimeoutMs;
    let loginReadySamples = 0;
    let loginReadyStatus = null;
    while (Date.now() < loginReadyDeadline) {
      loginReadySamples += 1;
      loginReadyStatus = await captureLightGameStatus(game, "login-ready status");
      if ((loginReadyStatus?.editableFieldCount ?? 0) >= 2) break;
      if (loginReadySamples === 1 || loginReadySamples % Number(process.env.ORIGINS_SMOKE_LOGIN_READY_PARTIAL_EVERY ?? 5) === 0) {
        writePartial("login-ready-waiting", {
          launchFacts,
          loginAttempted,
          loginReady: { samples: loginReadySamples, last: loginReadyStatus },
          pageLogTail: pageLogs.slice(-25),
        });
      }
      await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_LOGIN_READY_POLL_MS ?? 1000));
    }
    if ((loginReadyStatus?.editableFieldCount ?? 0) < 2) {
      throw new Error(`Login fields did not become ready: ${JSON.stringify(loginReadyStatus)}`);
    }
    loginAttempted = true;
    loginResult = await game.evaluate(
      ({ email, password }) => window.__engine.dev.login(email, password, 10),
      { email: loginEmail, password: loginPassword },
    );
    if (process.env.ORIGINS_SMOKE_WAIT_FOR_ROOM === "1") {
      roomReadyResult = await game.evaluate(
        (timeoutMs) => window.__engine?.dev?.waitForRoomReady?.(timeoutMs),
        Number(process.env.ORIGINS_SMOKE_ROOM_TIMEOUT_MS ?? 180000),
      );
      if (!roomReadyResult?.ready) {
        throw new Error(`Room did not become ready: ${JSON.stringify(roomReadyResult)}`);
      }
      roomWaited = true;
    }
    const afterLoginWaitMs = Number(process.env.ORIGINS_SMOKE_AFTER_LOGIN_WAIT_MS ?? 45000);
    const postLoginSampleEveryMs = Number(process.env.ORIGINS_SMOKE_POST_LOGIN_SAMPLE_EVERY_MS ?? 0);
    if (postLoginSampleEveryMs > 0 && afterLoginWaitMs > 0) {
      const waitStartedAt = Date.now();
      let sampleIndex = 0;
      while (Date.now() - waitStartedAt < afterLoginWaitMs) {
        await game.waitForTimeout(Math.min(postLoginSampleEveryMs, Math.max(0, afterLoginWaitMs - (Date.now() - waitStartedAt))));
        sampleIndex += 1;
        const sample = await captureLightGameStatus(game, `post-login sample ${sampleIndex}`);
        postLoginSamples.push({ index: sampleIndex, elapsedMs: Date.now() - waitStartedAt, sample });
        writePartial("post-login-sample", {
          launchFacts,
          loginAttempted,
          loginResult,
          roomWaited,
          roomReadyResult,
          postLoginSamples,
          pageLogTail: pageLogs.slice(-25),
        });
        if (sample?.captureError) break;
      }
    } else {
      await game.waitForTimeout(afterLoginWaitMs);
    }
    writePartial("login-complete", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      postLoginSamples,
      gameFacts:
        process.env.ORIGINS_SMOKE_SKIP_LOGIN_COMPLETE_FACTS === "1"
          ? { skipped: true, log: [] }
          : await captureGameFactsSafe(game, "login-complete facts"),
      pageLogTail: pageLogs.slice(-25),
    });
  }

  if (process.env.ORIGINS_SMOKE_WAIT_FOR_ROOM === "1" && !roomWaited) {
    roomReadyResult = await pollRoomReady(
      game,
      Number(process.env.ORIGINS_SMOKE_ROOM_TIMEOUT_MS ?? 300000),
      Number(process.env.ORIGINS_SMOKE_ROOM_POLL_MS ?? 1000),
      Number(process.env.ORIGINS_SMOKE_ROOM_POLL_TIMEOUT_MS ?? 5000),
      async ({ samples, last }) => {
        if (samples === 1 || samples % Number(process.env.ORIGINS_SMOKE_ROOM_PARTIAL_EVERY ?? 10) === 0) {
          writePartial("saved-login-room-ready-waiting", {
            launchFacts,
            loginAttempted,
            loginResult,
            roomWaited,
            roomReadyResult: { samples, last },
            pageLogTail: pageLogs.slice(-25),
          });
        }
      },
    );
    if (!roomReadyResult?.ready) {
      throw new Error(`Room did not become ready: ${JSON.stringify(roomReadyResult)}`);
    }
    roomWaited = true;
    writePartial("room-ready", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      gameFacts: await captureGameFactsSafe(game, "room-ready facts"),
      pageLogTail: pageLogs.slice(-25),
    });
  }

  if (process.env.ORIGINS_SMOKE_CLOSE_BULLETIN === "1" && process.env.ORIGINS_SMOKE_SHOW_HOTEL !== "1") {
    bulletinCloseResult = await closeBulletinBoard(game);
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_BULLETIN_CLOSE_WAIT_MS ?? 1000));
    writePartial("bulletin-closed", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      bulletinCloseResult,
      gameFacts: await captureGameFacts(game),
      pageLogTail: pageLogs.slice(-25),
    });
  }

  if (process.env.ORIGINS_SMOKE_RESIZE_BEFORE_ROOMS === "1") {
    const resizeSequence = parseResizeSequence(process.env.ORIGINS_SMOKE_RESIZE_SEQUENCE);
    for (const [index, size] of resizeSequence.entries()) {
      await game.setViewportSize(size);
      await game.waitForFunction(
        (expected) => window.innerWidth === expected.width && window.innerHeight === expected.height,
        size,
        { timeout: 10000 },
      );
      await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_RESIZE_STEP_WAIT_MS ?? 1500));
      const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `pre-room-resize-${size.width}x${size.height}`);
      const facts = await captureGameFacts(game);
      const stepScreenshotPath = join(outRoot, `pre-room-resize-${index + 1}-${size.width}x${size.height}.png`);
      await capturePageImage(game, stepScreenshotPath);
      resizeSteps.push({ index: index + 1, phase: "before-rooms", size, facts, screenshotPath: stepScreenshotPath, preScreenshotBulletinCloseResult });
      writePartial("pre-room-resize-step", {
        launchFacts,
        loginAttempted,
        loginResult,
        roomWaited,
        roomReadyResult,
        hotelViewResult,
        hotelStableResult,
        bulletinCloseResult,
        enteredRooms,
        enteredPublicRooms,
        resizeSteps,
        pageLogTail: pageLogs.slice(-25),
      });
    }
  }

  if (process.env.ORIGINS_SMOKE_SHOW_HOTEL === "1") {
    if (publicRoomQueries.length > 0 && process.env.ORIGINS_SMOKE_WAIT_FOR_PUBLIC_BOOTSTRAP !== "0") {
      publicRoomBootstrapResult = await waitForPublicRoomNode(
        game,
        publicRoomQueries[0],
        Number(process.env.ORIGINS_SMOKE_PUBLIC_BOOTSTRAP_TIMEOUT_MS ?? 60000),
        Number(process.env.ORIGINS_SMOKE_PUBLIC_BOOTSTRAP_POLL_MS ?? 500),
      );
      writePartial("public-room-bootstrap-before-hotel", {
        launchFacts,
        loginAttempted,
        loginResult,
        roomWaited,
        roomReadyResult,
        publicRoomBootstrapResult,
        pageLogTail: pageLogs.slice(-25),
      });
    }
    hotelViewResult = await game.evaluate(() => window.__engine?.dev?.showHotelView?.());
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_SHOW_HOTEL_WAIT_MS ?? 3500));
    if (
      process.env.ORIGINS_SMOKE_WAIT_FOR_STABLE_HOTEL === "1" ||
      publicRoomQueries.length > 0
    ) {
      hotelStableResult = await game.evaluate(
        ({ timeoutMs, stableMs }) => window.__engine?.dev?.waitForHotelViewStable?.(timeoutMs, stableMs),
        {
          timeoutMs: Number(process.env.ORIGINS_SMOKE_STABLE_HOTEL_TIMEOUT_MS ?? 45000),
          stableMs: Number(process.env.ORIGINS_SMOKE_STABLE_HOTEL_MS ?? 1500),
        },
      );
      writePartial("hotel-view-stability", {
        launchFacts,
        loginAttempted,
        loginResult,
        roomWaited,
        roomReadyResult,
        hotelViewResult,
        hotelStableResult,
        bulletinCloseResult,
        gameFacts: await captureGameFactsSafe(game, "hotel-view-stability facts"),
        pageLogTail: pageLogs.slice(-25),
      });
      if (!hotelStableResult?.stable && hotelStableResult?.state?.roomReady?.ready) {
        hotelViewResult = await game.evaluate(() => window.__engine?.dev?.showHotelView?.());
        await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_SHOW_HOTEL_RETRY_WAIT_MS ?? 1000));
        hotelStableResult = await game.evaluate(
          ({ timeoutMs, stableMs }) => window.__engine?.dev?.waitForHotelViewStable?.(timeoutMs, stableMs),
          {
            timeoutMs: Number(process.env.ORIGINS_SMOKE_STABLE_HOTEL_RETRY_TIMEOUT_MS ?? 30000),
            stableMs: Number(process.env.ORIGINS_SMOKE_STABLE_HOTEL_MS ?? 1500),
          },
        );
        writePartial("hotel-view-retry-after-room", {
          launchFacts,
          loginAttempted,
          loginResult,
          roomWaited,
          roomReadyResult,
          hotelViewResult,
          hotelStableResult,
          bulletinCloseResult,
          gameFacts: await captureGameFactsSafe(game, "hotel-view retry facts"),
          pageLogTail: pageLogs.slice(-25),
        });
      }
    }
    if (process.env.ORIGINS_SMOKE_CLOSE_BULLETIN === "1") {
      bulletinCloseResult = await closeBulletinBoard(game);
      await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_BULLETIN_CLOSE_WAIT_MS ?? 1000));
    }
    writePartial("hotel-view", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      gameFacts: await captureGameFactsSafe(game, "hotel-view facts"),
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const flatId of parseFlatSequence(process.env.ORIGINS_SMOKE_ENTER_FLAT_IDS)) {
    const enterResult = await game.evaluate(
      ({ flatId, timeoutMs }) => window.__engine?.dev?.enterPrivateRoom?.(flatId, true, timeoutMs),
      { flatId, timeoutMs: Number(process.env.ORIGINS_SMOKE_ENTER_ROOM_TIMEOUT_MS ?? 180000) },
    );
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_ENTER_ROOM_WAIT_MS ?? 3000));
    if (showUserNameLabels) {
      userNameLabelsResult = await game.evaluate(() => window.__engine?.dev?.setUserNameLabels?.(true));
    }
    if (requestedRoomStageZoom > 1) {
      roomStageZoomResult = await game.evaluate((scale) => window.__engine?.dev?.setRoomStageZoom?.(scale), requestedRoomStageZoom);
      await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_ROOM_STAGE_ZOOM_WAIT_MS ?? 500));
    }
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `flat-${flatId}`);
    const facts = await captureGameFacts(game);
    const screenshotPath = join(outRoot, `flat-${flatId}.png`);
    await capturePageImage(game, screenshotPath);
    enteredRooms.push({ flatId, enterResult, facts, screenshotPath, preScreenshotBulletinCloseResult });
    writePartial("flat-entered", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      userNameLabelsResult,
      roomStageZoomResult,
      enteredRooms,
      enteredPublicRooms,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const query of publicRoomQueries) {
    let enabledTraceHandlers = null;
    if (traceHandlersBeforePublic.length > 0) {
      enabledTraceHandlers = await game.evaluate(
        (handlers) => window.__engine?.dev?.setTraceHandlers?.(handlers),
        traceHandlersBeforePublic,
      );
      writePartial("public-room-trace-enabled", {
        launchFacts,
        loginAttempted,
        loginResult,
        roomWaited,
        roomReadyResult,
        hotelViewResult,
        hotelStableResult,
        bulletinCloseResult,
        enteredRooms,
        enteredPublicRooms,
        enabledTraceHandlers,
        pageLogTail: pageLogs.slice(-25),
      });
    }
    const publicNodePreflight = await waitForPublicRoomNode(
      game,
      query,
      Number(process.env.ORIGINS_SMOKE_PUBLIC_NODE_PREFLIGHT_TIMEOUT_MS ?? 5000),
      Number(process.env.ORIGINS_SMOKE_PUBLIC_NODE_PREFLIGHT_POLL_MS ?? 500),
    );
    enteredPublicRooms.push({ query, publicNodePreflight, beginResult: null, enterRoomReady: null, facts: null, screenshotPath: null, enabledTraceHandlers });
    writePartial("public-room-node-preflight", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      pageLogTail: pageLogs.slice(-25),
    });
    const beginResultRaw = await game.evaluate(
      ({ query, timeoutMs }) => window.__engine?.dev?.beginPublicRoomEntry?.(query, timeoutMs),
      { query, timeoutMs: Number(process.env.ORIGINS_SMOKE_PUBLIC_NODE_TIMEOUT_MS ?? 90000) },
    );
    const beginResult = summarizePublicBeginResult(beginResultRaw);
    let enterRoomReady = null;
    enteredPublicRooms[enteredPublicRooms.length - 1] = { query, publicNodePreflight, beginResult, enterRoomReady, facts: await captureGameFactsSafe(game, "public-room begin facts"), screenshotPath: null, enabledTraceHandlers };
    writePartial("public-room-entry-begun", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      pageLogTail: pageLogs.slice(-25),
    });
    if (!beginResult?.node) {
      enteredPublicRooms[enteredPublicRooms.length - 1] = {
        query,
        publicNodePreflight,
        beginResult,
        enterRoomReady: { ready: false, route: "public node not found", skipped: true },
        facts: await captureGameFactsSafe(game, "public-room missing-node facts"),
        screenshotPath: null,
        enabledTraceHandlers,
      };
      writePartial("public-room-node-missing", {
        launchFacts,
        loginAttempted,
        loginResult,
        roomWaited,
        roomReadyResult,
        hotelViewResult,
        hotelStableResult,
        bulletinCloseResult,
        enteredRooms,
        enteredPublicRooms,
        pageLogTail: pageLogs.slice(-25),
      });
      continue;
    }
    enterRoomReady = await pollRoomReady(
      game,
      Number(process.env.ORIGINS_SMOKE_ENTER_PUBLIC_ROOM_TIMEOUT_MS ?? 180000),
      Number(process.env.ORIGINS_SMOKE_PUBLIC_ROOM_POLL_MS ?? 1000),
      Number(process.env.ORIGINS_SMOKE_PUBLIC_ROOM_POLL_TIMEOUT_MS ?? 3000),
      async ({ samples, last }) => {
        if (samples === 1 || samples % Number(process.env.ORIGINS_SMOKE_PUBLIC_ROOM_PARTIAL_EVERY ?? 5) === 0) {
          enteredPublicRooms[enteredPublicRooms.length - 1] = {
            query,
            publicNodePreflight,
            beginResult,
            enterRoomReady: { samples, last },
            facts: {
              roomReady: last?.roomReady ?? null,
              roomEntryState: last?.roomEntryState ?? null,
            },
            screenshotPath: null,
          };
          writePartial("public-room-waiting", {
            launchFacts,
            loginAttempted,
            loginResult,
            roomWaited,
            roomReadyResult,
            hotelViewResult,
            hotelStableResult,
            bulletinCloseResult,
            enteredRooms,
            enteredPublicRooms,
            pageLogTail: pageLogs.slice(-25),
          });
        }
      },
    );
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_ENTER_PUBLIC_ROOM_WAIT_MS ?? 5000));
    let facts = null;
    let screenshotPath = null;
    let captureError = null;
    try {
      const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `public-${query}`);
      facts = await captureGameFactsSafe(game, "public-room final facts");
      const screenshot = await captureScreenshotIfEnabled(game, join(outRoot, `public-${safeFilePart(query)}.png`));
      screenshotPath = screenshot.screenshotPath;
      if (preScreenshotBulletinCloseResult) {
        enteredPublicRooms[enteredPublicRooms.length - 1] = {
          ...enteredPublicRooms[enteredPublicRooms.length - 1],
          preScreenshotBulletinCloseResult,
        };
      }
      if (screenshot.screenshotError) {
        captureError = captureError ? `${captureError}; screenshot: ${screenshot.screenshotError}` : `screenshot: ${screenshot.screenshotError}`;
      }
    } catch (error) {
      captureError = error instanceof Error ? error.message : String(error);
    }
    enteredPublicRooms[enteredPublicRooms.length - 1] = { query, publicNodePreflight, beginResult, enterRoomReady, facts, screenshotPath, captureError };
    writePartial(captureError ? "public-room-capture-failed" : "public-room-entered", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  if (process.env.ORIGINS_SMOKE_SHOW_HOTEL_AFTER_ROOMS === "1") {
    hotelReturnResult = await game.evaluate(() => window.__engine?.dev?.showHotelView?.());
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_SHOW_HOTEL_WAIT_MS ?? 3500));
    hotelReturnStableResult = await game.evaluate(
      ({ timeoutMs, stableMs }) => window.__engine?.dev?.waitForHotelViewStable?.(timeoutMs, stableMs),
      {
        timeoutMs: Number(process.env.ORIGINS_SMOKE_STABLE_HOTEL_TIMEOUT_MS ?? 45000),
        stableMs: Number(process.env.ORIGINS_SMOKE_STABLE_HOTEL_MS ?? 1500),
      },
    );
    if (process.env.ORIGINS_SMOKE_CLOSE_BULLETIN === "1") {
      bulletinCloseResult = await closeBulletinBoard(game);
      await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_BULLETIN_CLOSE_WAIT_MS ?? 1000));
    }
    hotelReturnScreenshotPath = join(outRoot, "hotel-after-rooms.png");
      await capturePageImage(game, hotelReturnScreenshotPath);
    writePartial("hotel-after-rooms", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      hotelReturnResult,
      hotelReturnStableResult,
      hotelReturnScreenshotPath,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      gameFacts: await captureGameFactsSafe(game, "hotel-after-rooms facts"),
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, click] of spriteClicks.entries()) {
    const clickResult = await game.evaluate((query) => {
      const sprites = window.__engine?.dev?.resolvedSprites?.(query, false) ?? [];
      const sprite = sprites[0] ?? null;
      const spriteNumber = typeof sprite?.n === "number" ? sprite.n : Number(sprite?.n);
      if (!Number.isFinite(spriteNumber) || spriteNumber <= 0) {
        return { clicked: false, error: `sprite not found: ${query}`, query, sprite };
      }
      return {
        clicked: window.__engine?.dev?.clickSprite?.(spriteNumber) ?? false,
        query,
        spriteNumber,
        sprite,
      };
    }, click.query);
    await game.waitForTimeout(click.waitMs);
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `sprite-click-${click.query}`);
    const facts = await captureGameFacts(game);
    const screenshotPath = join(outRoot, `sprite-click-${index + 1}-${safeFilePart(click.query)}.png`);
    await capturePageImage(game, screenshotPath);
    clickedSprites.push({ index: index + 1, ...click, clickResult, facts, screenshotPath, preScreenshotBulletinCloseResult });
    writePartial("sprite-clicked", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      executedMessages,
      clickedStagePoints,
      clickedSprites,
      clickedWindowElements,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, message] of executeMessages.entries()) {
    const executeResult = await game.evaluate(
      (message) => window.__engine?.dev?.executeMessage?.(message),
      message,
    );
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_EXECUTE_MESSAGE_WAIT_MS ?? 1500));
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `message-${message}`);
    const facts = await captureGameFacts(game);
    const screenshotPath = join(outRoot, `message-${index + 1}-${safeFilePart(message)}.png`);
    await capturePageImage(game, screenshotPath);
    executedMessages.push({ index: index + 1, message, executeResult, facts, screenshotPath, preScreenshotBulletinCloseResult });
    writePartial("message-executed", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      executedMessages,
      clickedStagePoints,
      clickedSprites,
      clickedWindowElements,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, click] of stageClicks.entries()) {
    await game.evaluate(({ x, y }) => window.__engine?.dev?.stageClick?.(x, y), click);
    await game.waitForTimeout(click.waitMs);
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `stage-click-${click.x}-${click.y}`);
    const facts = await captureGameFacts(game);
    const screenshotPath = join(outRoot, `stage-click-${index + 1}-${click.x}-${click.y}.png`);
    await capturePageImage(game, screenshotPath);
    clickedStagePoints.push({ index: index + 1, ...click, facts, screenshotPath, preScreenshotBulletinCloseResult });
    writePartial("stage-clicked", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      executedMessages,
      clickedStagePoints,
      clickedSprites,
      clickedWindowElements,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, step] of realTypeSteps.entries()) {
    assertPageNotCrashed(game, `real-type step ${index + 1}`);
    const before = await captureGameFactsSafe(game, "real-type before facts");
    await game.mouse.click(step.x, step.y);
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_REAL_CLICK_WAIT_MS ?? 250));
    if (step.text.length > 0) {
      await game.keyboard.type(step.text, { delay: Number(process.env.ORIGINS_SMOKE_REAL_TYPE_DELAY_MS ?? 20) });
    }
    await game.waitForTimeout(step.waitMs);
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `real-type-${step.x}-${step.y}`);
    const facts = await captureGameFacts(game);
    const screenshotPath = join(outRoot, `real-type-${index + 1}-${step.x}-${step.y}.png`);
    await capturePageImage(game, screenshotPath);
    const editableFieldTexts = (facts.editableFields ?? []).map((field) => String(field?.text ?? ""));
    const typedTextSeen = step.text.length === 0 || editableFieldTexts.some((text) => text.includes(step.text));
    realTypedSteps.push({
      index: index + 1,
      ...step,
      before,
      facts,
      typedTextSeen,
      editableFieldTexts,
      screenshotPath,
      preScreenshotBulletinCloseResult,
    });
    writePartial("real-type-step", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      executedMessages,
      clickedStagePoints,
      realTypedSteps,
      clickedSprites,
      clickedWindowElements,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, click] of windowElementClicks.entries()) {
    const clickResult = await game.evaluate(
      ({ windowId, elementId }) => window.__engine?.dev?.clickWindowElement?.(windowId, elementId),
      click,
    );
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_AFTER_WINDOW_ELEMENT_CLICK_WAIT_MS ?? 1500));
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `window-click-${click.windowId}-${click.elementId}`);
    const facts = await captureGameFacts(game);
    const screenshotPath = join(outRoot, `window-click-${index + 1}-${safeFilePart(click.windowId)}-${safeFilePart(click.elementId)}.png`);
    await capturePageImage(game, screenshotPath);
    clickedWindowElements.push({ index: index + 1, ...click, clickResult, facts, screenshotPath, preScreenshotBulletinCloseResult });
    writePartial("window-element-clicked", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      executedMessages,
      clickedStagePoints,
      clickedSprites,
      clickedWindowElements,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  const resizeSequence =
    process.env.ORIGINS_SMOKE_RESIZE_BEFORE_ROOMS === "1"
      ? []
      : parseResizeSequence(process.env.ORIGINS_SMOKE_RESIZE_SEQUENCE);
  for (const [index, size] of resizeSequence.entries()) {
    await game.setViewportSize(size);
    await game.waitForFunction(
      (expected) => window.innerWidth === expected.width && window.innerHeight === expected.height,
      size,
      { timeout: 10000 },
    );
    await game.waitForTimeout(Number(process.env.ORIGINS_SMOKE_RESIZE_STEP_WAIT_MS ?? 1500));
    const preScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, `resize-${size.width}x${size.height}`);
    const facts = await captureGameFacts(game);
    const stepScreenshotPath = join(outRoot, `resize-${index + 1}-${size.width}x${size.height}.png`);
    await capturePageImage(game, stepScreenshotPath);
    resizeSteps.push({ index: index + 1, size, facts, screenshotPath: stepScreenshotPath, preScreenshotBulletinCloseResult });
    writePartial("resize-step", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      resizeSteps,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, drag] of stageDrags.entries()) {
    const before = await captureGameFactsSafe(game, "stage-drag before facts");
    await game.mouse.move(drag.fromX, drag.fromY);
    await game.mouse.down();
    await game.mouse.move(drag.toX, drag.toY, { steps: Number(process.env.ORIGINS_SMOKE_STAGE_DRAG_STEPS ?? 12) });
    await game.mouse.up();
    await game.waitForTimeout(drag.waitMs);
    const facts = await captureGameFacts(game);
    const stepScreenshotPath = join(outRoot, `stage-drag-${index + 1}-${drag.fromX}-${drag.fromY}-${drag.toX}-${drag.toY}.png`);
    await capturePageImage(game, stepScreenshotPath);
    stageDragSteps.push({ index: index + 1, drag, before, facts, screenshotPath: stepScreenshotPath });
    writePartial("stage-drag-step", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      resizeSteps,
      stageDragSteps,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  for (const [index, move] of mouseMoves.entries()) {
    await game.mouse.move(move.x, move.y);
    await game.waitForTimeout(move.waitMs);
    const facts = await captureGameFactsSafe(game, "mouse-step facts");
    const stepScreenshotPath = join(outRoot, `mouse-${index + 1}-${move.x}-${move.y}.png`);
    await capturePageImage(game, stepScreenshotPath);
    mouseSteps.push({ index: index + 1, move, facts, screenshotPath: stepScreenshotPath });
    writePartial("mouse-step", {
      launchFacts,
      loginAttempted,
      loginResult,
      roomWaited,
      roomReadyResult,
      hotelViewResult,
      hotelStableResult,
      bulletinCloseResult,
      enteredRooms,
      enteredPublicRooms,
      resizeSteps,
      mouseSteps,
      pageLogTail: pageLogs.slice(-25),
    });
  }

  const finalPreScreenshotBulletinCloseResult = await closeBulletinBeforeScreenshot(game, "final");
  assertPageNotCrashed(game, "final capture");
  const gameFacts = await captureGameFactsSafe(game, "final game facts");
  if (isCrashMessage(gameFacts.captureError)) {
    throw new Error(`final game facts failed after page crash: ${gameFacts.captureError}`);
  }

  const finalScreenshot = await captureScreenshotIfEnabled(game, join(outRoot, "game.png"));
  if (isCrashMessage(finalScreenshot.screenshotError)) {
    throw new Error(`final screenshot failed after page crash: ${finalScreenshot.screenshotError}`);
  }
  const result = {
    executablePath,
    generatedAt: new Date().toISOString(),
    launchFacts,
    loginAttempted,
    loginResult,
    roomWaited,
    roomReadyResult,
    hotelViewResult,
    hotelStableResult,
    hotelReturnResult,
    hotelReturnStableResult,
    hotelReturnScreenshotPath,
    bulletinCloseResult,
    userNameLabelsResult,
    roomStageZoomResult,
    publicRoomBootstrapResult,
    enabledTraceHandlersAtStart,
    postLoginSamples,
    enteredRooms,
    enteredPublicRooms,
    executedMessages,
    clickedStagePoints,
    realTypedSteps,
    clickedSprites,
    clickedWindowElements,
    resizeSteps,
    mouseSteps,
    stageDragSteps,
    finalPreScreenshotBulletinCloseResult,
    gameFacts,
    screenshotPath: finalScreenshot.screenshotPath,
    screenshotError: finalScreenshot.screenshotError,
  };
  writeFileSync(join(outRoot, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(outRoot, "page.log"), `${pageLogs.join("\n")}\n`, "utf8");
  writeFileSync(join(outRoot, "game.log"), `${gameFacts.log.join("\n")}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const failure = {
    executablePath,
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    loginAttempted,
    loginResult,
    roomWaited,
    roomReadyResult,
    hotelViewResult,
    hotelStableResult,
    bulletinCloseResult,
    userNameLabelsResult,
    roomStageZoomResult,
    publicRoomBootstrapResult,
    postLoginSamples,
    enteredRooms,
    enteredPublicRooms,
    executedMessages,
    clickedStagePoints,
    realTypedSteps,
    clickedSprites,
    clickedWindowElements,
    resizeSteps,
    mouseSteps,
    launcherUrl: null,
    gameFacts: null,
    launcherScreenshotPath: null,
    gameScreenshotPath: null,
  };
  if (launcher) {
    try {
      failure.launcherUrl = launcher.url();
      const launcherScreenshotPath = join(outRoot, "launcher-failure.png");
      const screenshot = await captureScreenshotIfEnabled(launcher, launcherScreenshotPath);
      failure.launcherScreenshotPath = screenshot.screenshotPath;
      if (screenshot.screenshotError) {
        pageLogs.push(`[${new Date().toISOString()}] [captureerror] launcher ${screenshot.screenshotError}`);
      }
    } catch (captureError) {
      pageLogs.push(`[${new Date().toISOString()}] [captureerror] launcher ${String(captureError)}`);
    }
  }
  if (game) {
    try {
      failure.gameFacts = await captureGameFactsSafe(game, "failure game facts");
      const gameScreenshotPath = join(outRoot, "game-failure.png");
      const screenshot = await captureScreenshotIfEnabled(game, gameScreenshotPath);
      failure.gameScreenshotPath = screenshot.screenshotPath;
      if (screenshot.screenshotError) {
        pageLogs.push(`[${new Date().toISOString()}] [captureerror] game ${screenshot.screenshotError}`);
      }
      if (failure.gameFacts?.log) {
        writeFileSync(join(outRoot, "game.log"), `${failure.gameFacts.log.join("\n")}\n`, "utf8");
      }
    } catch (captureError) {
      pageLogs.push(`[${new Date().toISOString()}] [captureerror] game ${String(captureError)}`);
    }
  }
  writeFileSync(join(outRoot, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  writeFileSync(join(outRoot, "page.log"), `${pageLogs.join("\n")}\n`, "utf8");
  throw error;
} finally {
  writeFileSync(join(outRoot, "page.log"), `${pageLogs.join("\n")}\n`, "utf8");
  await app.close().catch(() => undefined);
}
