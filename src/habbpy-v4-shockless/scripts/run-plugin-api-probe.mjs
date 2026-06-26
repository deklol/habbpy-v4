import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const electronExecutable = require("electron");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const appDataRoot = resolve(process.env.APPDATA || process.env.HABBPY_V4_APP_DATA_PATH || "");
const pluginId = "plugin-api-probe";
const pluginRoot = resolve(appDataRoot, "HabbpyV4", "plugins", pluginId);
const pluginSettingsPath = resolve(appDataRoot, "HabbpyV4", "plugins", "settings.json");
const reportPath = resolve(repoRoot, "logs", "automation", `plugin-api-probe-${stamp}.json`);
const screenshotDir = resolve(repoRoot, "screenshots", "automation", `plugin-api-probe-${stamp}`);
const roomId = String(process.env.HABBPY_V4_PLUGIN_PROBE_ROOM_ID || "224520").trim();
const accountFile = String(process.env.HABBPY_V4_PLUGIN_PROBE_ACCOUNT_FILE || "multiclient-accounts.txt").trim();
const primaryAccountLabel = String(process.env.HABBPY_V4_PLUGIN_PROBE_PRIMARY_LABEL || "").trim();
const joinerAccountLabel = String(process.env.HABBPY_V4_PLUGIN_PROBE_JOINER_LABEL || "").trim();
const explicitAccountSelection = Boolean(primaryAccountLabel || joinerAccountLabel);
const joinerMode = String(process.env.HABBPY_V4_PLUGIN_PROBE_JOINER_MODE || "visible").trim().toLowerCase() === "headless" ? "headless" : "visible";
const visibleAccountCount = positiveInt(process.env.HABBPY_V4_PLUGIN_PROBE_VISIBLE_COUNT, 1);
const joinerAccountCount = positiveInt(
  process.env.HABBPY_V4_PLUGIN_PROBE_JOINER_COUNT ?? process.env.HABBPY_V4_PLUGIN_PROBE_HEADLESS_COUNT,
  2,
);
const waitAfterLoadMs = positiveInt(process.env.HABBPY_V4_PLUGIN_PROBE_WAIT_AFTER_LOAD_MS, 45000);
const roomTimeoutMs = positiveInt(process.env.HABBPY_V4_PLUGIN_PROBE_ROOM_TIMEOUT_MS, 90000);
const eventTimeoutMs = positiveInt(process.env.HABBPY_V4_PLUGIN_PROBE_EVENT_TIMEOUT_MS, 60000);
const primaryClientId = 2;
const joinerClientId = 3;

await mkdir(dirname(reportPath), { recursive: true });
await mkdir(screenshotDir, { recursive: true });

let previousPluginSettings = null;
let hadPluginSettings = false;
let app = null;
let page = null;
let selectedAccounts = null;
const commandLog = [];
const consoleMessages = [];
const pageErrors = [];
const screenshots = [];

try {
  if (!appDataRoot) throw new Error("APPDATA or HABBPY_V4_APP_DATA_PATH is required for the plugin probe.");
  if (visibleAccountCount < 1) throw new Error("The plugin API probe needs one visible account to observe room events.");
  if (joinerAccountCount < 2) throw new Error("The plugin API probe needs two account-file entries so a second real account can join after the observer is in-room.");
  await installProbePlugin();
  selectedAccounts = explicitAccountSelection ? await selectProbeAccounts() : null;

  app = await electron.launch({
    executablePath: electronExecutable,
    args: ["dist/main/main/main.js"],
    cwd: repoRoot,
    env: {
      ...process.env,
      HABBPY_V4_MAIN_WINDOW_SHOW: "1",
      HABBPY_V4_VERSION_CHECK_BUILD: process.env.HABBPY_V4_VERSION_CHECK_BUILD || "1129",
    },
    timeout: 60000,
  });
  page = await app.firstWindow({ timeout: 60000 });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0] ?? null;
    if (!window) return null;
    window.setBounds({ x: -32000, y: -32000, width: 1440, height: 760 }, false);
    window.setSkipTaskbar(true);
    window.showInactive();
    return window.getBounds();
  });

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.text().includes("Electron Security Warning")) return;
      consoleMessages.push({ type: message.type(), text: maskText(message.text()) });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(maskText(error.stack || error.message));
  });

  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 60000 });
  await waitForProbeActive(page);
  await page.waitForTimeout(2000);

  if (selectedAccounts) {
    await runConsoleCommand(page, loginCommand(selectedAccounts.primary, false));
  } else {
    await runConsoleCommand(page, `load ${quoteArg(accountFile)} ${visibleAccountCount} --concurrency 1`);
  }
  await waitForMountedVisibleWebviews(page, [primaryClientId], 90000);
  await page.waitForTimeout(waitAfterLoadMs);

  await selectClient(page, primaryClientId);
  await runConsoleCommand(page, `@${primaryClientId} enterroom ${roomId}`);
  await selectClient(page, primaryClientId);
  await waitForProbeEvent(page, "room.ready", 1, eventTimeoutMs);
  await waitForProbeEvent(page, "room.users", 1, eventTimeoutMs);
  await waitForProbeRoom(page, roomId, eventTimeoutMs);
  await waitForProbeApi(page, "chat.send", "ok", eventTimeoutMs);
  await waitForProbeEvent(page, "chat.message", 1, eventTimeoutMs);

  if (joinerClientId !== primaryClientId) {
    if (selectedAccounts) {
      await runConsoleCommand(page, loginCommand(selectedAccounts.joiner, joinerMode === "headless"));
    } else {
      await runConsoleCommand(page, `load ${quoteArg(accountFile)} ${joinerAccountCount} --concurrency 1`);
    }
    if (selectedAccounts && joinerMode === "headless") {
      await waitForClientSession(page, joinerClientId, { headless: true, status: "running" }, roomTimeoutMs);
    } else {
      await waitForMountedVisibleWebviews(page, [joinerClientId], roomTimeoutMs);
      await waitForClientSession(page, joinerClientId, { headless: false, status: "running" }, roomTimeoutMs);
    }
    await page.waitForTimeout(5000);
    await selectClient(page, primaryClientId);
    await runConsoleCommand(page, `main ${primaryClientId}`);
    const joinedAfterLoad = await waitForOptionalProbeEvent(page, "room.userJoined", 1, 30000);
    if (!joinedAfterLoad) {
      await runConsoleCommand(page, `summon ${joinerClientId} --room --main-room-id ${roomId}`);
      await waitForProbeEvent(page, "room.userJoined", 1, eventTimeoutMs);
    }
    await runConsoleCommand(page, `close ${joinerClientId}`);
    await waitForProbeEvent(page, "room.userLeft", 1, eventTimeoutMs);
  }

  await runConsoleCommand(page, `@${primaryClientId} wave`);
  await waitForProbeEvent(page, "packet.client", 1, eventTimeoutMs);
  await waitForProbeEvent(page, "packet.server", 1, eventTimeoutMs);
  await waitForProbeEvent(page, "packet", 2, eventTimeoutMs);

  await closeConsole(page);
  screenshots.push(await capturePage(page, "plugin-api-probe-final"));
  const finalProbe = await readProbeReport(page);
  const finalSessions = await clientSessions(page);
  const finalWebviews = await webviewSummaries(page);
  const expectedEvents = [
    "session.selected",
    "runtime.snapshot",
    "room.changed",
    "room.ready",
    "room.users",
    "chat.message",
    "packet",
    "packet.client",
    "packet.server",
  ];
  if (joinerClientId !== primaryClientId) {
    expectedEvents.push("room.userJoined", "room.userLeft");
  }
  const expectedApis = ["storage", "session.getClients", "engine.getSnapshot", "packets.send.blocked", "chat.send"];
  const missingEvents = expectedEvents.filter((name) => !(finalProbe?.eventCounts?.[name] > 0));
  const missingApis = expectedApis.filter((name) => finalProbe?.apiResults?.[name] !== "ok");
  const ok = missingEvents.length === 0 && missingApis.length === 0 && consoleMessages.length === 0 && pageErrors.length === 0;

  await writeReport({
    ok,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-plugin-api-live-probe",
    pluginId,
    roomId,
    explicitAccountSelection,
    joinerMode: selectedAccounts ? joinerMode : "visible",
    visibleAccountCount,
    joinerAccountCount,
    primaryClientId,
    joinerClientId,
    commands: commandLog,
    missingEvents,
    missingApis,
    probe: finalProbe,
    sessions: finalSessions,
    webviews: finalWebviews,
    screenshots,
    consoleMessages,
    pageErrors,
  });
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  if (page) {
    await capturePage(page, "plugin-api-probe-failure").then((path) => screenshots.push(path)).catch(() => null);
  }
  await writeReport({
    ok: false,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-plugin-api-live-probe",
    pluginId,
    roomId,
    explicitAccountSelection,
    joinerMode: selectedAccounts ? joinerMode : "visible",
    visibleAccountCount,
    joinerAccountCount,
    primaryClientId,
    joinerClientId,
    commands: commandLog,
    probe: page ? await readProbeReport(page).catch(() => null) : null,
    sessions: page ? await clientSessions(page).catch(() => null) : null,
    webviews: page ? await webviewSummaries(page).catch(() => null) : null,
    screenshots,
    consoleMessages,
    pageErrors,
    error: maskText(error instanceof Error ? error.stack || error.message : String(error)),
  });
  console.error(`Plugin API probe failed. Report: ${reportPath}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => null);
  await restoreProbePlugin().catch(() => null);
}

async function installProbePlugin() {
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(
    join(pluginRoot, "habbpy.plugin.json"),
    `${JSON.stringify(
      {
        id: pluginId,
        name: "Plugin API Probe",
        version: "1.0.0",
        author: "Habbpy v4 automation",
        description: "Temporary live validation probe for the user plugin API.",
        entry: "plugin.js",
        icon: "terminal",
        category: "developer",
        permissions: [
          "ui.panel",
          "events.room",
          "events.chat",
          "events.packet",
          "events.session",
          "engine.snapshot",
          "chat.send",
          "storage",
          "packet.read",
          "packet.inject",
        ],
        surfaces: [
          {
            id: "panel",
            kind: "panel",
            label: "Plugin API Probe",
            enabledByDefault: true,
            summary: "Temporary live validation probe.",
          },
        ],
        commands: [],
        hotkeys: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(join(pluginRoot, "plugin.js"), probePluginSource(), "utf8");

  hadPluginSettings = existsSync(pluginSettingsPath);
  previousPluginSettings = hadPluginSettings ? await readFile(pluginSettingsPath, "utf8") : null;
  const parsed = hadPluginSettings ? JSON.parse(previousPluginSettings) : {};
  const next = {
    version: 1,
    enabledById: {
      ...(parsed.enabledById && typeof parsed.enabledById === "object" ? parsed.enabledById : {}),
      [pluginId]: true,
    },
    uiSurfaceEnabledByPluginId: {
      ...(parsed.uiSurfaceEnabledByPluginId && typeof parsed.uiSurfaceEnabledByPluginId === "object" ? parsed.uiSurfaceEnabledByPluginId : {}),
      [pluginId]: { panel: true },
    },
    permissionGrants: parsed.permissionGrants && typeof parsed.permissionGrants === "object" ? parsed.permissionGrants : {},
  };
  await mkdir(dirname(pluginSettingsPath), { recursive: true });
  await writeFile(pluginSettingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function restoreProbePlugin() {
  await rm(pluginRoot, { recursive: true, force: true });
  if (hadPluginSettings && previousPluginSettings !== null) {
    await writeFile(pluginSettingsPath, previousPluginSettings, "utf8");
  } else {
    await rm(pluginSettingsPath, { force: true });
  }
}

function probePluginSource() {
  return `
const state = {
  startedAt: new Date().toISOString(),
  eventCounts: {},
  samples: {},
  apiResults: {},
};
let chatSent = false;

export async function activate(api) {
  const { chat, engine, events, log, packets, session, storage } = api;
  async function persist() {
    await storage.set("probe-report", state).catch(() => undefined);
  }
  function samplePayload(name, payload) {
    if (name.startsWith("packet")) {
      return {
        direction: payload?.direction ?? null,
        header: payload?.header ?? null,
        packetName: payload?.packetName ?? null,
        clientId: payload?.clientId ?? null,
        hasPlainText: Boolean(payload?.plainText || payload?.bodyAscii || payload?.bodyText),
      };
    }
    if (name === "room.users") return { clientId: payload?.clientId ?? null, count: Array.isArray(payload?.users) ? payload.users.length : 0, initial: payload?.initial === true };
    if (name.startsWith("room.")) return { clientId: payload?.clientId ?? null, roomId: payload?.room?.id ?? null, hasUser: Boolean(payload?.user) };
    if (name === "chat.message") return { clientId: payload?.clientId ?? null, mode: payload?.mode ?? null, textLength: String(payload?.text ?? "").length };
    if (name === "runtime.snapshot") return { clientId: payload?.clientId ?? null, roomId: payload?.room?.id ?? null, roomReady: Boolean(payload?.snapshot?.roomReady?.ready ?? payload?.snapshot?.roomEntryState?.roomReady?.ready) };
    if (name === "session.selected") return { clientId: payload?.clientId ?? null, hasSession: Boolean(payload?.session) };
    return { seen: true };
  }
  async function record(name, payload = {}) {
    const sample = samplePayload(name, payload);
    state.eventCounts[name] = (state.eventCounts[name] || 0) + 1;
    state.samples[name] ||= sample;
    state.latest ||= {};
    state.latest[name] = sample;
    if (name === "room.changed" || name === "room.ready") state.currentRoom = sample;
    state.updatedAt = new Date().toISOString();
    await persist();
    log.info("PROBE " + name + " #" + state.eventCounts[name]);
  }
  async function callApi(name, run) {
    try {
      await run();
      state.apiResults[name] = "ok";
    } catch (error) {
      state.apiResults[name] = "error:" + (error?.message || error);
    }
    await persist();
  }

  await callApi("storage", async () => {
    await storage.set("storage-self-test", { ok: true });
    const value = await storage.get("storage-self-test", null);
    if (!value?.ok) throw new Error("storage roundtrip failed");
    await storage.delete("storage-self-test");
  });
  await callApi("session.getClients", async () => {
    const clients = await session.getClients();
    if (!Array.isArray(clients?.clients)) throw new Error("missing clients array");
  });
  await callApi("engine.getSnapshot", async () => {
    await engine.getSnapshot();
  });
  await callApi("packets.send.blocked", async () => {
    try {
      await packets.send(1, { header: 52, body: "probe" });
    } catch (error) {
      if (String(error?.message || error).includes("not enabled yet")) return;
      throw error;
    }
    throw new Error("packets.send unexpectedly succeeded");
  });

  const disposers = [];
  for (const name of ["session.selected", "runtime.snapshot", "room.changed", "room.ready", "room.users", "room.userJoined", "room.userLeft", "chat.message", "packet", "packet.client", "packet.server"]) {
    disposers.push(events.on(name, (payload) => {
      void record(name, payload);
      if (name === "room.ready" && !chatSent) {
        chatSent = true;
        setTimeout(() => {
          void callApi("chat.send", async () => {
            await chat.send("plugin api probe " + Date.now().toString(36), { clientId: payload?.clientId });
          });
        }, 1000);
      }
    }));
  }
  disposers.push(packets.on("client", {}, (packet) => {
    void record("packets.on.client", packet);
    return packet.allow();
  }));
  disposers.push(packets.on("server", {}, (packet) => {
    void record("packets.on.server", packet);
    return packet.allow();
  }));
  await record("activated", {});
  return () => {
    for (const dispose of disposers) dispose();
  };
}
`;
}

async function waitForProbeActive(page) {
  await page.waitForFunction(
    (key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.eventCounts?.activated > 0 && parsed?.apiResults?.storage === "ok";
      } catch {
        return false;
      }
    },
    storageKey("probe-report"),
    { timeout: 30000 },
  );
}

async function waitForProbeEvent(page, name, count, timeoutMs) {
  await page.waitForFunction(
    ({ key, name: eventName, count: expectedCount }) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        return (JSON.parse(raw)?.eventCounts?.[eventName] || 0) >= expectedCount;
      } catch {
        return false;
      }
    },
    { key: storageKey("probe-report"), name, count },
    { timeout: timeoutMs },
  );
}

async function waitForProbeRoom(page, expectedRoomId, timeoutMs) {
  await page.waitForFunction(
    ({ key, expectedRoomId }) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        const roomId = JSON.parse(raw)?.currentRoom?.roomId;
        return String(roomId ?? "") === String(expectedRoomId);
      } catch {
        return false;
      }
    },
    { key: storageKey("probe-report"), expectedRoomId },
    { timeout: timeoutMs },
  );
}

async function waitForOptionalProbeEvent(page, name, count, timeoutMs) {
  try {
    await waitForProbeEvent(page, name, count, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

async function waitForProbeApi(page, name, value, timeoutMs) {
  await page.waitForFunction(
    ({ key, name: apiName, value: expectedValue }) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        return JSON.parse(raw)?.apiResults?.[apiName] === expectedValue;
      } catch {
        return false;
      }
    },
    { key: storageKey("probe-report"), name, value },
    { timeout: timeoutMs },
  );
}

async function readProbeReport(page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storageKey("probe-report"));
}

function storageKey(key) {
  return `habbpy-v4:user-plugin:${pluginId}:${key}`;
}

async function runConsoleCommand(page, command) {
  await openConsole(page);
  const input = page.getByLabel("Packet console command");
  await input.fill(command);
  await input.press("Enter");
  commandLog.push({ command: maskCommand(command), at: new Date().toISOString() });
  await page.waitForTimeout(1000);
}

async function openConsole(page) {
  const input = page.getByLabel("Packet console command");
  if (await input.isVisible().catch(() => false)) return;
  await page.keyboard.press("Backquote");
  await input.waitFor({ state: "visible", timeout: 10000 });
}

async function closeConsole(page) {
  const closeButton = page.getByLabel("Close packet log console");
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await page.waitForTimeout(250);
  }
}

async function selectClient(page, clientId) {
  const button = page.getByLabel(`Select client ${clientId}`);
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
  await page.waitForFunction(
    (id) => document.querySelector(`.game-webview-zoom-surface[data-client-id="${id}"]`)?.classList.contains("active") === true,
    clientId,
    { timeout: 30000 },
  );
}

async function waitForMountedVisibleWebviews(page, clientIds, timeoutMs) {
  await page.waitForFunction(
    (ids) => ids.every((id) => document.querySelector(`.game-webview-zoom-surface[data-client-id="${id}"] webview`)),
    clientIds,
    { timeout: timeoutMs },
  );
}

async function waitForClientSession(page, clientId, expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSession = null;
  while (Date.now() < deadline) {
    const list = await clientSessions(page).catch(() => null);
    lastSession = list?.sessions?.find((session) => session.id === clientId) ?? null;
    if (
      lastSession &&
      (expected.headless === undefined || lastSession.headless === expected.headless) &&
      (expected.status === undefined || lastSession.status === expected.status)
    ) {
      return lastSession;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`client${clientId} did not reach expected session state within ${timeoutMs}ms; last=${JSON.stringify(lastSession)}`);
}

async function waitForClientRoom(page, clientId, expectedRoomId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await webviewSummaries(page).catch(() => []);
    const row = rows.find((entry) => entry.clientId === clientId);
    if (roomReadyMatches(row, expectedRoomId)) return row;
    await page.waitForTimeout(2000);
  }
  throw new Error(`client${clientId} did not report room ${expectedRoomId} within ${timeoutMs}ms`);
}

async function clientSessions(page) {
  return page.evaluate(() => window.habbpyV4?.getClientSessions?.() ?? null);
}

async function webviewSummaries(page) {
  return page.evaluate(async () => {
    const surfaces = [...document.querySelectorAll(".game-webview-zoom-surface")];
    const rows = [];
    for (const surface of surfaces) {
      const webview = surface.querySelector("webview");
      const clientId = Number(surface.getAttribute("data-client-id"));
      const active = surface.classList.contains("active");
      let runtime = null;
      if (webview) {
        try {
          runtime = await webview.executeJavaScript(
            "window.__shocklessDev?.snapshot ? window.__shocklessDev.snapshot({ scope: 'summary' }) : null",
            true,
          );
        } catch (error) {
          runtime = { error: String(error?.message || error) };
        }
      }
      rows.push({ clientId, active, mounted: Boolean(webview), runtime });
    }
    return rows;
  });
}

function roomReadyMatches(row, expectedRoomId) {
  if (!row?.runtime) return false;
  const roomReady = row.runtime.roomReady?.ready ?? row.runtime.roomEntryState?.roomReady?.ready ?? false;
  const roomId = String(row.runtime.room?.id ?? row.runtime.location?.roomId ?? row.runtime.roomEntryState?.flatId ?? "");
  return Boolean(roomReady) && roomId === String(expectedRoomId);
}

async function capturePage(page, label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "probe";
  const path = join(screenshotDir, `${safeLabel}-${stamp}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function writeReport(report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Plugin API probe report: ${reportPath}`);
}

async function selectProbeAccounts() {
  const accounts = parseProbeAccounts(await readFile(resolve(repoRoot, accountFile), "utf8"));
  if (accounts.length < 2) throw new Error("The plugin API probe needs at least two valid account blocks in the account file.");
  const primary = findProbeAccount(accounts, primaryAccountLabel) ?? accounts[0];
  const joiner =
    findProbeAccount(accounts, joinerAccountLabel) ??
    accounts.find((account) => account !== primary && account.email.toLowerCase() !== primary.email.toLowerCase()) ??
    null;
  if (!primary || !joiner) throw new Error("The plugin API probe could not resolve two distinct account blocks.");
  if (primary.email.toLowerCase() === joiner.email.toLowerCase()) throw new Error("The plugin API probe resolved duplicate account credentials.");
  return { primary, joiner };
}

function parseProbeAccounts(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const accounts = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const label = lines[index];
    const credential = lines[index + 1];
    if (!credential.includes("@") || !credential.includes(":")) continue;
    const separator = credential.indexOf(":");
    const email = credential.slice(0, separator).trim();
    const password = credential.slice(separator + 1);
    if (!label || !email || !password) continue;
    accounts.push({ label, email, password });
    index += 1;
  }
  return accounts;
}

function findProbeAccount(accounts, label) {
  const key = accountLabelKey(label);
  if (!key) return null;
  const exact = accounts.find((account) => accountLabelKey(account.label) === key);
  if (exact) return exact;
  const partial = accounts.filter((account) => accountLabelKey(account.label).includes(key) || key.includes(accountLabelKey(account.label)));
  return partial.length === 1 ? partial[0] : null;
}

function accountLabelKey(label) {
  return String(label || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function loginCommand(account, headless) {
  return `login ${quoteArg(`${account.email}:${account.password}`)} --label ${quoteArg(account.label)}${headless ? " --headless" : ""}`;
}

function quoteArg(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maskCommand(command) {
  return String(command).replace(/(login\s+)(?:"[^"]*"|\S+:\S+)/i, "$1[credentials]");
}

function maskText(text) {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi, "[email]")
    .replace(/(password|token|webhook|secret)=\\S+/gi, "$1=[redacted]");
}
