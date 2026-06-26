import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const electronExecutable = require("electron");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const appDataRoot = resolve(process.env.HABBPY_V4_APP_DATA_PATH || process.env.APPDATA || "");
const pluginSettingsPath = resolve(appDataRoot, "HabbpyV4", "plugins", "settings.json");
const pluginSettingsBackupPath = resolve(appDataRoot, "HabbpyV4", "plugins", `settings.live-matrix-backup-${stamp}.json`);
const liveApiProbePluginId = `live-api-probe-${Date.now().toString(36)}`;
const liveApiProbeRoot = resolve(appDataRoot, "HabbpyV4", "plugins", liveApiProbePluginId);
const roomId = String(process.env.HABBPY_V4_PLUGIN_MATRIX_ROOM_ID || "224520").trim();
const accountFile = String(process.env.HABBPY_V4_PLUGIN_MATRIX_ACCOUNT_FILE || "multiclient-accounts.txt").trim();
const accountCount = positiveInt(process.env.HABBPY_V4_PLUGIN_MATRIX_ACCOUNT_COUNT, 1);
const waitAfterLoadMs = positiveInt(process.env.HABBPY_V4_PLUGIN_MATRIX_WAIT_AFTER_LOAD_MS, 45000);
const roomTimeoutMs = positiveInt(process.env.HABBPY_V4_PLUGIN_MATRIX_ROOM_TIMEOUT_MS, 90000);
const panelSettleMs = positiveInt(process.env.HABBPY_V4_PLUGIN_MATRIX_PANEL_SETTLE_MS, 1200);
const fishingAreaTimeoutMs = positiveInt(process.env.HABBPY_V4_PLUGIN_MATRIX_FISHING_AREA_TIMEOUT_MS, 90000);
const pluginFilterIds = new Set(
  String(process.env.HABBPY_V4_PLUGIN_MATRIX_ONLY || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const fishingQueries = String(
  process.env.HABBPY_V4_PLUGIN_MATRIX_FISHING_QUERIES ||
    "Infobus Park,Infobus Park Overflow,park,hh_room_park_general,hh_room_park,Port Hana,Port Hana Overflow,Snouthill Pier,Snouthill Pier Overflow,Fishing,fishing,fish",
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const reportPath = resolve(
  repoRoot,
  process.env.HABBPY_V4_PLUGIN_MATRIX_REPORT || join("logs", "automation", `plugin-live-matrix-${stamp}.json`),
);
const screenshotDir = resolve(
  repoRoot,
  process.env.HABBPY_V4_PLUGIN_MATRIX_SCREENSHOT_DIR || join("screenshots", "automation", `plugin-live-matrix-${stamp}`),
);

const builtInPlugins = [
  { id: "connection", name: "Connection", inGame: true },
  { id: "plugin-manager", name: "Plugin Manager", inGame: false },
  { id: "settings", name: "Settings", inGame: false },
  { id: "multi-account", name: "Multi Account", inGame: true },
  { id: "info", name: "Info", inGame: true },
  { id: "room", name: "Room", inGame: true },
  { id: "user", name: "User", inGame: true },
  { id: "items", name: "Items", inGame: true },
  { id: "inventory", name: "Inventory", inGame: true },
  { id: "automation", name: "Automation", inGame: true },
  { id: "fishing", name: "Fishing", inGame: true },
  { id: "gardening", name: "Gardening", inGame: true },
  { id: "wall-mover", name: "Wall Mover", inGame: true },
  { id: "social", name: "Social", inGame: true },
  { id: "visitors", name: "Visitors", inGame: true },
  { id: "chat", name: "Chat", inGame: true },
  { id: "injection", name: "Injection", inGame: true },
  { id: "packet-log", name: "Packet Log", inGame: true },
  { id: "dev-tools", name: "Dev Tools", inGame: true },
  { id: "about", name: "About", inGame: false },
];
const matrixPlugins =
  pluginFilterIds.size > 0 ? builtInPlugins.filter((plugin) => pluginFilterIds.has(plugin.id)) : builtInPlugins;
const probeFishingEnabled = matrixPlugins.some((plugin) => plugin.id === "fishing") && process.env.HABBPY_V4_PLUGIN_MATRIX_DISABLE_FISHING_PROBE !== "1";
const safeChatText = `plugin live matrix ${Date.now().toString(36)}`;

await mkdir(dirname(reportPath), { recursive: true });
await mkdir(screenshotDir, { recursive: true });

let app = null;
let page = null;
let previousPluginSettings = null;
let hadPluginSettings = false;
let offscreenBounds = null;
const commandLog = [];
const consoleMessages = [];
const pageErrors = [];
const screenshots = [];

try {
  if (!appDataRoot) throw new Error("APPDATA or HABBPY_V4_APP_DATA_PATH is required for the plugin matrix.");
  if (!roomId) throw new Error("Set HABBPY_V4_PLUGIN_MATRIX_ROOM_ID to a private room flat id.");
  await recoverInterruptedPluginMatrixRun();
  await installLiveApiProbePlugin();
  await enableBuiltInsForRun();

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
  offscreenBounds = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0] ?? null;
    if (!window) return null;
    window.setBounds({ x: -32000, y: -32000, width: 1440, height: 800 }, false);
    window.setSkipTaskbar(true);
    window.showInactive();
    return window.getBounds();
  });
  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    if (message.text().includes("Electron Security Warning")) return;
    consoleMessages.push({ type: message.type(), text: maskText(message.text()) });
  });
  page.on("pageerror", (error) => pageErrors.push(maskText(error.stack || error.message)));

  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 60000 });
  await waitForAllPluginTabs(page);
  await runConsoleCommand(page, `load ${quoteArg(accountFile)} ${accountCount} --concurrency 1`);
  await waitForAnyLoadedVisibleWebview(page, 90000);
  await page.waitForTimeout(waitAfterLoadMs);
  const targetClient = await firstRunningVisibleClient(page, 90000);
  await selectClient(page, targetClient.clientId);
  await runRuntimeDevAction(page, targetClient.clientId, { kind: "enterPrivateRoom", flatId: roomId });
  await waitForClientRoom(page, targetClient.clientId, roomId, roomTimeoutMs);
  await page.waitForTimeout(5000);

  await runConsoleCommand(page, `@${targetClient.clientId} say ${quoteArg(safeChatText)}`);
  await runConsoleCommand(page, `@${targetClient.clientId} wave`);
  await runConsoleCommand(page, `@${targetClient.clientId} dance 1`);
  await runConsoleCommand(page, `@${targetClient.clientId} lookup ${quoteArg(targetClient.username || targetClient.label)}`);
  await closeConsole(page);

  const baseContext = await currentContext(page, targetClient.clientId);
  const pluginResults = [];
  for (const plugin of matrixPlugins) {
    let fishingProbe = null;
    if (plugin.id === "fishing") {
      fishingProbe = await enterFishingRoomForMatrix(page, targetClient.clientId);
      if (!fishingProbe.ok) {
        await openPlugin(page, plugin.name).catch(() => null);
        await page.waitForTimeout(panelSettleMs);
        const facts = await panelFacts(page).catch(() => null);
        const screenshot = await capturePage(page, plugin.id);
        screenshots.push({ plugin: plugin.id, path: screenshot });
        pluginResults.push({
          pluginId: plugin.id,
          name: plugin.name,
          status: "needs-context",
          reason: fishingProbe.reason,
          proof: {
            roomId: fishingProbe.roomId ?? null,
            roomName: fishingProbe.roomName ?? null,
            userCount: fishingProbe.userCount ?? null,
            query: fishingProbe.query ?? null,
            occupiedRooms: fishingProbe.occupiedRooms ?? [],
            screenshot,
            facts,
          },
        });
        await writeProgressReport({ targetClient, baseContext, pluginResults });
        await returnToPrivateTestRoom(page, targetClient.clientId).catch(() => null);
        continue;
      }
    }
    await openPlugin(page, plugin.name);
    await page.waitForTimeout(panelSettleMs);
    if (plugin.id === "chat") await sendChatFromPanel(page, `${safeChatText} panel`).catch((error) => recordSoftFailure(pluginResults, plugin, error));
    if (plugin.id === "injection") await sendInjectionChat(page, `${safeChatText} injection`).catch((error) => recordSoftFailure(pluginResults, plugin, error));
    if (plugin.id === "fishing") await sendFishingStartFromPanel(page).catch((error) => recordSoftFailure(pluginResults, plugin, error));
    await page.waitForTimeout(plugin.id === "packet-log" ? 1800 : panelSettleMs);
    const facts = await panelFacts(page);
    const screenshot = await capturePage(page, plugin.id);
    screenshots.push({ plugin: plugin.id, path: screenshot });
    const context = { ...(await currentContext(page, targetClient.clientId)), fishingProbe, liveApiProbe: await readLiveApiProbe(page) };
    pluginResults.push(evaluatePlugin(plugin, facts, context, screenshot));
    await writeProgressReport({ targetClient, baseContext, pluginResults });
    if (plugin.id === "fishing") await returnToPrivateTestRoom(page, targetClient.clientId).catch(() => null);
  }

  const failures = pluginResults.filter((result) => result.status === "failed");
  const needsContext = pluginResults.filter((result) => result.status === "needs-context");
  const report = {
    ok: failures.length === 0 && needsContext.length === 0,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-plugin-live-matrix",
    pluginFilter: [...pluginFilterIds],
    roomId,
    targetClient,
    baseContext,
    plugins: pluginResults,
    failures,
    needsContext,
    commands: commandLog,
    screenshots,
    liveApiProbe: await readLiveApiProbe(page).catch(() => null),
    consoleMessages,
    pageErrors,
    offscreenBounds,
  };
  await writeReport(report);
  console.log(`Plugin live matrix report: ${reportPath}`);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  const report = {
    ok: false,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-plugin-live-matrix",
    pluginFilter: [...pluginFilterIds],
    roomId,
    commands: commandLog,
    screenshots,
    liveApiProbe: page ? await readLiveApiProbe(page).catch(() => null) : null,
    consoleMessages,
    pageErrors,
    offscreenBounds,
    context: page ? await currentContext(page, 2).catch(() => null) : null,
    error: maskText(error instanceof Error ? error.stack || error.message : String(error)),
  };
  await writeReport(report);
  console.error(`Plugin live matrix failed. Report: ${reportPath}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => null);
  await restorePluginSettings().catch(() => null);
  await rm(liveApiProbeRoot, { recursive: true, force: true }).catch(() => null);
}

async function enableBuiltInsForRun() {
  hadPluginSettings = existsSync(pluginSettingsPath);
  previousPluginSettings = hadPluginSettings ? await readFile(pluginSettingsPath, "utf8") : null;
  await mkdir(dirname(pluginSettingsPath), { recursive: true });
  await writeFile(pluginSettingsBackupPath, previousPluginSettings ?? "", "utf8");
  const parsed = hadPluginSettings ? safeJson(previousPluginSettings, {}) : {};
  const enabledById = { ...(isRecord(parsed.enabledById) ? parsed.enabledById : {}) };
  const uiSurfaceEnabledByPluginId = {
    ...(isRecord(parsed.uiSurfaceEnabledByPluginId) ? parsed.uiSurfaceEnabledByPluginId : {}),
  };
  for (const plugin of builtInPlugins) {
    enabledById[plugin.id] = true;
    uiSurfaceEnabledByPluginId[plugin.id] = {
      ...(isRecord(uiSurfaceEnabledByPluginId[plugin.id]) ? uiSurfaceEnabledByPluginId[plugin.id] : {}),
      panel: true,
      status: true,
      overlay: true,
      commands: true,
    };
  }
  enabledById[liveApiProbePluginId] = true;
  uiSurfaceEnabledByPluginId[liveApiProbePluginId] = {
    status: true,
  };
  await writeFile(
    pluginSettingsPath,
    `${JSON.stringify(
      {
        version: 1,
        enabledById,
        uiSurfaceEnabledByPluginId,
        permissionGrants: isRecord(parsed.permissionGrants) ? parsed.permissionGrants : {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function installLiveApiProbePlugin() {
  await rm(liveApiProbeRoot, { recursive: true, force: true });
  await mkdir(liveApiProbeRoot, { recursive: true });
  const manifest = {
    id: liveApiProbePluginId,
    name: "Live API Probe",
    version: "1.0.0",
    author: "Habbpy v4 automation",
    description: "Temporary automation plugin that proves user-plugin host APIs against a live session.",
    entry: "plugin.js",
    icon: "terminal",
    category: "developer",
    permissions: [
      "storage",
      "events.room",
      "events.packet",
      "packet.read",
      "engine.snapshot",
      "actions.furni",
      ...(probeFishingEnabled ? ["actions.fishing", "actions.avatar"] : []),
    ],
    surfaces: [
      {
        id: "status",
        kind: "status",
        label: "Live API Probe",
        enabledByDefault: true,
        summary: "Temporary live plugin API proof.",
      },
    ],
    commands: [],
    hotkeys: [],
  };
  await writeFile(join(liveApiProbeRoot, "habbpy.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    join(liveApiProbeRoot, "plugin.js"),
    `${[
      "const PROBE_ID = " + JSON.stringify(liveApiProbePluginId) + ";",
      "const FISHING_PROBE_ENABLED = " + JSON.stringify(probeFishingEnabled) + ";",
      "",
      "export async function activate(api) {",
      "  const { events, fishing, furni, packets, plugin, storage, timers } = api;",
      "  const disposers = [];",
      "  let packetSeen = false;",
      "  let itemSeen = false;",
      "  let fishingRan = false;",
      "  await record(storage, 'activated', { pluginId: PROBE_ID, runtimePluginId: plugin.id, runtimePluginName: plugin.name });",
      "  void capture('timers.sleep', () => timers.sleep(250)).then((result) => record(storage, 'timerSleep', result));",
      "  void capture('events.once.room.ready', () => events.once('room.ready', { timeoutMs: 60000 })).then((result) => record(storage, 'roomReadyOnce', summarizeEventResult(result)));",
      "  void capture('events.once.room.items', () => events.once('room.items', { timeoutMs: 60000 })).then((result) => record(storage, 'roomItemsOnce', summarizeRoomItemsResult(result)));",
      "  void capture('packets.once.all', () => packets.once('all', {}, { timeoutMs: 60000 })).then((result) => record(storage, 'packetOnce', summarizePacketResult(result)));",
      "",
      "  disposers.push(packets.on('all', {}, async (packet) => {",
      "    if (!packetSeen) {",
      "      packetSeen = true;",
      "      await record(storage, 'packetEvent', {",
      "        clientId: packet?.clientId ?? null,",
      "        direction: packet?.direction ?? null,",
      "        header: packet?.header ?? null,",
      "        packetName: packet?.packetName ?? 'UNKNOWN_HEADER',",
      "      });",
      "    }",
      "    return packet.allow();",
      "  }));",
      "",
      "  disposers.push(events.on('room.items', async (event) => {",
      "    if (itemSeen) return;",
      "    itemSeen = true;",
      "    const summary = summarizeRoomItemsEvent(event);",
      "    await record(storage, 'roomItemsEvent', summary);",
      "    const allItems = await capture('furni.findItems', () => furni.findItems());",
      "    const first = Array.isArray(allItems?.result) ? allItems.result[0] ?? null : null;",
      "    const firstQuery = first?.className ?? first?.name ?? first?.id ?? null;",
      "    const oneItem = firstQuery ? await capture('furni.findItem', () => furni.findItem({ query: firstQuery })) : { ok: false, api: 'furni.findItem', message: 'No live item available.' };",
      "    await record(storage, 'furniApi', { allItems: summarizeFurniResult(allItems), oneItem: summarizeFurniResult(oneItem), firstQuery });",
      "  }));",
      "",
      "  if (FISHING_PROBE_ENABLED) disposers.push(events.on('runtime.snapshot', async (event) => {",
      "    if (!fishing) return;",
      "    const state = await capture('fishing.getState', () => fishing.getState());",
      "    await record(storage, 'latestFishingState', summarizeFishingState(state));",
      "    const areaId = state?.result?.target?.id ?? state?.result?.areas?.[0]?.id ?? null;",
      "    const occupants = state?.result?.occupants ?? summarizeOccupants(event?.snapshot);",
      "    if (Number(occupants?.otherHumanCount ?? 0) > 0) {",
      "      await record(storage, 'fishingApiSkipped', { reason: 'occupied-room', occupants });",
      "      return;",
      "    }",
      "    if (fishingRan || !state?.ok || !state?.result?.hasFullRuntimeSnapshot || !areaId) return;",
      "    fishingRan = true;",
      "    const walk = await capture('fishing.walkToArea', () => fishing.walkToArea(areaId));",
      "    await delay(650);",
      "    const start = await capture('fishing.startFishing', () => fishing.startFishing(areaId));",
      "    const tokens = await capture('fishing.requestTokens', () => fishing.requestTokens());",
      "    await record(storage, 'fishingApi', { areaId, walk, start, tokens });",
      "  }));",
      "",
      "  if (!FISHING_PROBE_ENABLED) await record(storage, 'fishingApiSkipped', { reason: 'disabled-for-this-matrix' });",
      "",
      "  return () => {",
      "    for (const dispose of disposers) dispose();",
      "  };",
      "}",
      "",
      "async function capture(api, fn) {",
      "  try {",
      "    const result = await fn();",
      "    return { ok: true, api, result };",
      "  } catch (error) {",
      "    return { ok: false, api, message: error?.message || String(error) };",
      "  }",
      "}",
      "",
      "function summarizeRoomItemsResult(result) {",
      "  return {",
      "    ok: Boolean(result?.ok),",
      "    message: result?.message ?? null,",
      "    ...summarizeRoomItemsEvent(result?.result),",
      "  };",
      "}",
      "",
      "function summarizeRoomItemsEvent(event) {",
      "  return {",
      "    clientId: event?.clientId ?? null,",
      "    roomId: event?.room?.id ?? null,",
      "    roomName: event?.room?.name ?? null,",
      "    total: Number(event?.counts?.total ?? (Array.isArray(event?.items) ? event.items.length : 0)),",
      "    floorItems: Number(event?.counts?.floorItems ?? (Array.isArray(event?.floorItems) ? event.floorItems.length : 0)),",
      "    wallItems: Number(event?.counts?.wallItems ?? (Array.isArray(event?.wallItems) ? event.wallItems.length : 0)),",
      "    firstItem: itemSummary(event?.items?.[0] ?? event?.floorItems?.[0] ?? event?.wallItems?.[0] ?? null),",
      "  };",
      "}",
      "",
      "function summarizeFurniResult(result) {",
      "  const rows = Array.isArray(result?.result) ? result.result : result?.result ? [result.result] : [];",
      "  return {",
      "    ok: Boolean(result?.ok),",
      "    api: result?.api ?? null,",
      "    message: result?.message ?? null,",
      "    count: rows.length,",
      "    firstItem: itemSummary(rows[0] ?? null),",
      "  };",
      "}",
      "",
      "function itemSummary(item) {",
      "  if (!item) return null;",
      "  return { key: item.key ?? null, kind: item.kind ?? null, id: item.id ?? item.objectId ?? item.itemId ?? null, className: item.className ?? null, name: item.name ?? null, tile: item.tile ?? null, wallLocation: item.wallLocation ?? null };",
      "}",
      "",
      "function summarizeFishingState(state) {",
      "  return {",
      "    ok: Boolean(state?.ok),",
      "    message: state?.message ?? null,",
      "    clientId: state?.result?.clientId ?? null,",
      "    hasFullRuntimeSnapshot: Boolean(state?.result?.hasFullRuntimeSnapshot),",
      "    roomReady: state?.result?.roomReady ?? null,",
      "    areaCount: Array.isArray(state?.result?.areas) ? state.result.areas.length : 0,",
      "    targetId: state?.result?.target?.id ?? null,",
      "    occupants: state?.result?.occupants ?? null,",
      "    packetStatus: state?.result?.packet?.status ?? null,",
      "  };",
      "}",
      "",
      "function summarizeEventResult(result) {",
      "  return {",
      "    ok: Boolean(result?.ok),",
      "    message: result?.message ?? null,",
      "    clientId: result?.result?.clientId ?? null,",
      "    roomId: result?.result?.room?.id ?? null,",
      "    roomName: result?.result?.room?.name ?? null,",
      "  };",
      "}",
      "",
      "function summarizePacketResult(result) {",
      "  return {",
      "    ok: Boolean(result?.ok),",
      "    message: result?.message ?? null,",
      "    clientId: result?.result?.clientId ?? null,",
      "    direction: result?.result?.direction ?? null,",
      "    header: result?.result?.header ?? null,",
      "    packetName: result?.result?.packetName ?? 'UNKNOWN_HEADER',",
      "  };",
      "}",
      "",
      "function summarizeOccupants(snapshot) {",
      "  const fishingNpcNames = new Set(['bob', 'recruiter blaze']);",
      "  const sessionName = String(snapshot?.userState?.sessionUserName ?? '').trim().toLowerCase();",
      "  const users = Array.isArray(snapshot?.userState?.users) ? snapshot.userState.users : [];",
      "  const rows = users.map((user) => {",
      "    const name = String(user?.name ?? (user?.rowId === '0' ? snapshot?.userState?.sessionUserName ?? '' : '') ?? user?.rowId ?? '').trim();",
      "    const type = String(user?.userType ?? user?.type ?? user?.objectClass ?? user?.className ?? '').trim().toLowerCase();",
      "    const lower = name.toLowerCase();",
      "    const kind = lower && sessionName && lower === sessionName ? 'self' : type === '1' || type.includes('human') ? 'human' : (/^\\d+$/.test(type) && type !== '1') || type.includes('bot') || type.includes('pet') || fishingNpcNames.has(lower) ? 'bot' : user?.accountId || user?.figure ? 'human' : 'unknown';",
      "    return { name, userType: type || null, kind };",
      "  });",
      "  return { totalCount: rows.length, otherHumanCount: rows.filter((user) => user.kind === 'human').length, botCount: rows.filter((user) => user.kind === 'bot').length, unknownCount: rows.filter((user) => user.kind === 'unknown').length, users: rows };",
      "}",
      "",
      "async function record(storage, key, value) {",
      "  await storage.set(key, { value, updatedAt: new Date().toISOString() });",
      "}",
      "",
      "function delay(ms) {",
      "  return new Promise((resolve) => setTimeout(resolve, ms));",
      "}",
      "",
    ].join("\n")}\n`,
    "utf8",
  );
}

async function restorePluginSettings() {
  if (hadPluginSettings && previousPluginSettings !== null) {
    await writeFile(pluginSettingsPath, previousPluginSettings, "utf8");
  } else {
    await rm(pluginSettingsPath, { force: true });
  }
  await rm(pluginSettingsBackupPath, { force: true });
}

async function recoverInterruptedPluginMatrixRun() {
  const pluginDir = dirname(pluginSettingsPath);
  await mkdir(pluginDir, { recursive: true });
  const entries = await readdir(pluginDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("live-api-probe-")) {
      await rm(resolve(pluginDir, entry.name), { recursive: true, force: true }).catch(() => null);
    }
  }
  if (!existsSync(pluginSettingsPath)) return;
  const settingsText = await readFile(pluginSettingsPath, "utf8").catch(() => "");
  if (!settingsText.includes("live-api-probe-")) return;
  const backups = entries
    .filter((entry) => entry.isFile() && /^settings\.live-matrix-backup-.+\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latestBackup = backups[backups.length - 1];
  if (latestBackup) {
    const backupText = await readFile(resolve(pluginDir, latestBackup), "utf8").catch(() => "");
    if (backupText.trim()) await writeFile(pluginSettingsPath, backupText, "utf8");
    else await rm(pluginSettingsPath, { force: true });
  }
  for (const backup of backups) await rm(resolve(pluginDir, backup), { force: true }).catch(() => null);
}

async function waitForAllPluginTabs(activePage) {
  await activePage.waitForFunction(
    (names) => names.every((name) => Boolean(document.querySelector(`button.rail-tab[aria-label="${name}"]`))),
    builtInPlugins.map((plugin) => plugin.name),
    { timeout: 30000 },
  );
}

async function runConsoleCommand(activePage, command) {
  await openConsole(activePage);
  const input = activePage.getByLabel("Packet console command");
  await input.fill(command);
  await input.press("Enter");
  commandLog.push({ command: maskCommand(command), at: new Date().toISOString() });
  await activePage.waitForTimeout(1000);
}

async function openConsole(activePage) {
  const input = activePage.getByLabel("Packet console command");
  if (await input.isVisible().catch(() => false)) return;
  await activePage.keyboard.press("Backquote");
  await input.waitFor({ state: "visible", timeout: 10000 });
}

async function closeConsole(activePage) {
  const closeButton = activePage.getByLabel("Close packet log console");
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await activePage.waitForTimeout(250);
  }
}

async function waitForAnyLoadedVisibleWebview(activePage, timeoutMs) {
  await activePage.waitForFunction(
    () => [...document.querySelectorAll(".game-webview-zoom-surface")].some((surface) => Number(surface.getAttribute("data-client-id")) > 1 && surface.querySelector("webview")),
    null,
    { timeout: timeoutMs },
  );
}

async function firstRunningVisibleClient(activePage, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    const sessions = await activePage.evaluate(() => window.habbpyV4?.getClientSessions?.() ?? null).catch(() => null);
    const webviews = await webviewSummaries(activePage).catch(() => []);
    latest = (sessions?.sessions || [])
      .filter((session) => session.id > 1 && session.visible && session.status === "running")
      .map((session) => {
        const webview = webviews.find((entry) => entry.clientId === session.id);
        return {
          clientId: session.id,
          label: session.label,
          username: session.username || webview?.summary?.userName || null,
          roomName: session.roomName || webview?.summary?.roomName || null,
          hasEngine: Boolean(webview?.summary?.hasEngine),
        };
      });
    const match = latest.find((entry) => entry.hasEngine);
    if (match) return match;
    await activePage.waitForTimeout(2500);
  }
  throw new Error(`No running visible client found. Candidates: ${JSON.stringify(latest)}`);
}

async function waitForClientRoom(activePage, clientId, expectedRoomId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const rows = await webviewSummaries(activePage);
    latest = rows.find((entry) => entry.clientId === clientId) ?? null;
    if (roomReadyMatches(latest, expectedRoomId)) return latest;
    await activePage.waitForTimeout(2000);
  }
  throw new Error(`client${clientId} did not report room ${expectedRoomId} within ${timeoutMs}ms; latest=${JSON.stringify(latest)}`);
}

async function selectClient(activePage, clientId) {
  const button = activePage.getByLabel(`Select client ${clientId}`);
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
  await activePage.waitForFunction(
    (id) => document.querySelector(`.game-webview-zoom-surface[data-client-id="${id}"]`)?.classList.contains("active") === true,
    clientId,
    { timeout: 30000 },
  );
}

async function openPlugin(activePage, name) {
  const currentPanel = activePage.locator("section.plugin-panel").first();
  const currentTitle = (await currentPanel.locator("h2").first().textContent().catch(() => "")).trim();
  if (currentTitle === name && await currentPanel.isVisible().catch(() => false)) return;
  const button = activePage.locator(`button.rail-tab[aria-label="${cssAttrValue(name)}"]`);
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
  await activePage.locator(`section.plugin-panel[aria-label="${cssAttrValue(name)} panel"]`).waitFor({ state: "visible", timeout: 30000 });
}

async function sendChatFromPanel(activePage, message) {
  const input = activePage.locator('section.plugin-panel[aria-label="Chat panel"] input[aria-label="Room chat message"]');
  if (!(await input.isVisible().catch(() => false))) return;
  await input.fill(message);
  await input.press("Enter");
}

async function sendInjectionChat(activePage, message) {
  const panel = activePage.locator('section.plugin-panel[aria-label="Injection panel"]');
  const textarea = panel.locator("textarea").first();
  if (!(await textarea.isVisible().catch(() => false))) return;
  await textarea.fill(message);
  await panel.getByRole("button", { name: "Run" }).click();
}

async function sendFishingStartFromPanel(activePage) {
  const panel = activePage.locator('section.plugin-panel[aria-label="Fishing panel"]');
  const button = panel.getByRole("button", { name: "Start Fishing" });
  if (!(await button.isVisible().catch(() => false))) return;
  if (await button.isDisabled().catch(() => true)) throw new Error("Fishing Start button was disabled after fishing area probe.");
  await button.click();
}

async function currentContext(activePage, clientId) {
  const [sessions, relay, webviews] = await Promise.all([
    activePage.evaluate(() => window.habbpyV4?.getClientSessions?.() ?? null).catch(() => null),
    activePage.evaluate(() => window.habbpyV4?.getRelayLogSnapshot?.() ?? null).catch(() => null),
    webviewSummaries(activePage).catch(() => []),
  ]);
  const selected = webviews.find((entry) => entry.clientId === clientId) ?? webviews.find((entry) => entry.active) ?? null;
  return {
    sessions,
    relay: relay
      ? {
          exists: relay.exists,
          packetCount: relay.packetCount,
          clientCount: relay.clientCount,
          serverCount: relay.serverCount,
          totalLines: relay.totalLines,
          logPath: relay.logPath,
          headers: [...new Set((relay.entries || []).map((entry) => entry.header).filter((entry) => entry !== null))].slice(0, 60),
        }
      : null,
    selected,
  };
}

async function readLiveApiProbe(activePage) {
  return activePage.evaluate((pluginId) => {
    const prefix = `habbpy-v4:user-plugin:${pluginId}:`;
    const entries = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      const shortKey = key.slice(prefix.length);
      const raw = localStorage.getItem(key);
      try {
        entries[shortKey] = raw ? JSON.parse(raw) : null;
      } catch {
        entries[shortKey] = raw;
      }
    }
    return {
      pluginId,
      keys: Object.keys(entries).sort(),
      entries,
    };
  }, liveApiProbePluginId);
}

async function enterFishingRoomForMatrix(activePage, clientId) {
  const occupiedRooms = [];
  for (const query of fishingQueries) {
    const entry = await runRuntimeDevAction(activePage, clientId, { kind: "enterPublicRoom", query }).catch((error) => ({
      ok: false,
      message: maskText(error instanceof Error ? error.message : String(error)),
    }));
    const areaProbe = await waitForFishingAreasInEmptyRoom(activePage, clientId, query);
    if (areaProbe.notEmpty) {
      occupiedRooms.push({
        query,
        roomId: areaProbe.roomId ?? null,
        roomName: areaProbe.roomName ?? null,
        userCount: areaProbe.userCount ?? null,
        occupants: areaProbe.occupants ?? null,
      });
      await returnToPrivateTestRoom(activePage, clientId).catch(() => null);
      continue;
    }
    if (entry.ok !== false && areaProbe.fishingAreas > 0) {
      return {
        ok: true,
        reason: `Entered empty fishing room using query '${query}'.`,
        query,
        ...areaProbe,
        entry,
      };
    }
    await returnToPrivateTestRoom(activePage, clientId).catch(() => null);
  }
  return {
    ok: false,
    reason: `No empty fishing public room with fishing areas was found for queries: ${fishingQueries.join(", ") || "none"}.`,
    query: null,
    occupiedRooms,
  };
}

async function waitForFishingAreasInEmptyRoom(activePage, clientId, query) {
  const deadline = Date.now() + fishingAreaTimeoutMs;
  let latest = { fishingAreas: 0, userCount: null, roomId: null, roomName: null, notEmpty: false, occupants: null };
  while (Date.now() < deadline) {
    await openPlugin(activePage, "Fishing").catch(() => null);
    await activePage.waitForTimeout(panelSettleMs);
    const [facts, context] = await Promise.all([
      panelFacts(activePage).catch(() => null),
      currentContext(activePage, clientId).catch(() => null),
    ]);
    const summary = context?.selected?.summary ?? {};
    const userCount = Number(summary.userCount ?? 0);
    const occupants = normalizeOccupants(summary.occupants, summary.userName);
    const otherHumanCount = Number(occupants?.otherHumanCount ?? 0);
    latest = {
      fishingAreas: extractNumber(facts?.kv?.Areas ?? facts?.kv?.["Fishing Areas"]),
      userCount: Number.isFinite(userCount) ? userCount : null,
      roomId: String(summary.roomId ?? "") || null,
      roomName: String(summary.roomName ?? "") || null,
      notEmpty: Number.isFinite(otherHumanCount) && otherHumanCount > 0,
      occupants,
      query,
    };
    if (latest.notEmpty || latest.fishingAreas > 0) return latest;
    await activePage.waitForTimeout(5000);
  }
  return latest;
}

async function returnToPrivateTestRoom(activePage, clientId) {
  await runRuntimeDevAction(activePage, clientId, { kind: "enterPrivateRoom", flatId: roomId });
  await waitForClientRoom(activePage, clientId, roomId, roomTimeoutMs);
}

async function runRuntimeDevAction(activePage, clientId, action) {
  const script = `
    (async (action) => {
      const dev = window.__engine?.dev;
      if (!dev) return { ok: false, message: "Shockless dev API is not ready." };
      if (action.kind === "enterPublicRoom") {
        if (typeof dev.enterPublicRoom !== "function") return { ok: false, message: "Public room entry helper is not available." };
        const result = await dev.enterPublicRoom(String(action.query || ""), 90000);
        if (Array.isArray(result?.errors) && result.errors.length > 0) return { ok: false, message: result.errors.join("; "), result };
        return { ok: true, message: "Public room entry command routed through Navigator helpers.", result };
      }
      if (action.kind === "enterPrivateRoom") {
        if (typeof dev.enterPrivateRoom !== "function") return { ok: false, message: "Private room entry helper is not available." };
        const result = await dev.enterPrivateRoom(String(action.flatId || ""), true, 90000);
        return { ok: true, message: "Private room entry command routed through Shockless helpers.", result };
      }
      return { ok: false, message: "Unsupported runtime matrix action." };
    })(${JSON.stringify(action)})
  `;
  return activePage.evaluate(
    async ({ clientId: targetClientId, script: scriptText }) => {
      const surface = document.querySelector(`.game-webview-zoom-surface[data-client-id="${targetClientId}"]`);
      const webview = surface?.querySelector("webview");
      if (!webview) return { ok: false, message: `client${targetClientId} webview is not mounted.` };
      return webview.executeJavaScript(scriptText, true);
    },
    { clientId, script },
  );
}

async function webviewSummaries(activePage) {
  return activePage.evaluate(async () => {
    const surfaces = [...document.querySelectorAll(".game-webview-zoom-surface")];
    const rows = [];
    for (const surface of surfaces) {
      const webview = surface.querySelector("webview");
      const clientId = Number(surface.getAttribute("data-client-id"));
      const active = surface.classList.contains("active");
      const label = surface.getAttribute("data-client-label") || "";
      const summary = webview
        ? await webview.executeJavaScript(`
          (async () => {
            const root = window.__engine || null;
            const dev = root?.dev || null;
            const safe = async (fn, args = []) => {
              try { return typeof fn === "function" ? await Promise.resolve(fn(...args)) : null; }
              catch (error) { return { error: String(error?.message || error) }; }
            };
            const nativeValue = (value) => {
              if (value == null || typeof value !== "object") return value;
              if (Array.isArray(value)) return value.map(nativeValue);
              if (value.type === "symbol") return "#" + String(value.name ?? value.value ?? value.key ?? "");
              if (Array.isArray(value.entries)) {
                const out = {};
                for (const entry of value.entries) {
                  const key = String(entry?.key?.name ?? entry?.key?.value ?? entry?.key ?? entry?.name ?? entry?.prop ?? "");
                  if (key) out[key] = nativeValue(entry?.value ?? entry);
                }
                return out;
              }
              if ("value" in value && Object.keys(value).length <= 3) return nativeValue(value.value);
              const out = {};
              for (const [key, entry] of Object.entries(value)) out[key] = nativeValue(entry);
              return out;
            };
            const valueText = (value) => {
              const native = nativeValue(value);
              if (native == null || native === "") return null;
              if (Array.isArray(native)) return native.map(valueText).filter(Boolean).join(", ");
              if (typeof native === "object") return null;
              return String(native);
            };
            const propEntries = (value) => {
              const native = nativeValue(value);
              if (!native || typeof native !== "object") return [];
              return Object.entries(native).map(([key, value]) => ({ key, value }));
            };
            const arrayFrom = (value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
            const roomValue = (lastRoom, ...keys) => {
              const lowered = keys.map((key) => String(key).toLowerCase());
              return Object.entries(lastRoom || {}).find(([key]) => lowered.includes(String(key).toLowerCase()))?.[1];
            };
            const sessionObject = await safe(root?.objectProps, ["Session"]);
            const sessionProps = sessionObject?.props ?? sessionObject?.properties ?? sessionObject ?? {};
            const sessionItemList =
              sessionProps?.ancestor?.props?.pitemlist ??
              sessionProps?.ancestor?.props?.pItemList ??
              sessionProps?.pitemlist ??
              sessionProps?.pItemList ??
              null;
            const sessionEntries = propEntries(sessionItemList);
            const sessionValue = (...keys) => {
              const lowered = keys.map((key) => String(key).toLowerCase());
              return sessionEntries.find((entry) => lowered.includes(String(entry.key).toLowerCase()))?.value;
            };
            const lastRoom = nativeValue(sessionValue("lastroom"));
            const rawRoomObjects = await safe(root?.roomObjects);
            const roomReady = await safe(dev?.roomReady);
            const performanceStats = await safe(dev?.performanceStats);
            const activeObjects = arrayFrom(rawRoomObjects?.activeObjects ?? rawRoomObjects?.active ?? rawRoomObjects?.floorItems);
            const passiveObjects = arrayFrom(rawRoomObjects?.passiveObjects ?? rawRoomObjects?.passive);
            const wallItems = arrayFrom(rawRoomObjects?.wallItems ?? rawRoomObjects?.wall);
            const users = arrayFrom(rawRoomObjects?.users ?? rawRoomObjects?.roomUsers ?? rawRoomObjects?.people);
            const fishingNpcNames = new Set(["bob", "recruiter blaze"]);
            const displayName = (user, index) => valueText(user?.name ?? user?.userName ?? user?.className ?? user?.class ?? user?.object ?? user?.id ?? index) ?? "";
            const userSummary = (user, index, sessionName) => {
              const name = displayName(user, index);
              const type = valueText(user?.userType ?? user?.type ?? user?.user_type ?? user?.objectClass ?? user?.className ?? user?.class);
              const lower = String(name || "").trim().toLowerCase();
              const normalizedSession = String(sessionName || "").trim().toLowerCase();
              const source = [type, user?.objectClass, user?.className, user?.class].map((entry) => String(entry ?? "")).join(" ").toLowerCase();
              const kind = lower && normalizedSession && lower === normalizedSession
                ? "self"
                : type === "1" || source.includes("human")
                  ? "human"
                  : (/^\\d+$/.test(String(type || "")) && String(type) !== "1") || source.includes("bot") || source.includes("pet") || fishingNpcNames.has(lower)
                    ? "bot"
                    : user?.accountId || user?.account_id || user?.figure
                      ? "human"
                      : "unknown";
              return {
                name,
                rowId: String(user?.rowId ?? user?.index ?? user?.id ?? index),
                accountId: String(user?.accountId ?? user?.account_id ?? ""),
                userType: type ?? null,
                kind,
              };
            };
            const sessionUserName = valueText(sessionValue("#userName", "userName"));
            const occupantRows = users.map((user, index) => userSummary(user, index, sessionUserName));
            const occupants = {
              totalCount: occupantRows.length,
              humanCount: occupantRows.filter((user) => user.kind === "human" || user.kind === "self").length,
              otherHumanCount: occupantRows.filter((user) => user.kind === "human").length,
              botCount: occupantRows.filter((user) => user.kind === "bot").length,
              unknownCount: occupantRows.filter((user) => user.kind === "unknown").length,
              users: occupantRows,
            };
            return {
              href: location.href,
              title: document.title,
              hasEngine: Boolean(root),
              hasDev: Boolean(dev),
              canvasCount: document.querySelectorAll("canvas").length,
              roomReady,
              roomName: valueText(roomValue(lastRoom, "#name", "name")),
              roomId: String(roomValue(lastRoom, "#flatId", "#id", "flatId", "id") ?? ""),
              roomOwner: valueText(roomValue(lastRoom, "#owner", "owner")),
              userName: sessionUserName,
              userCount: users.length || roomReady?.roomLikeSpriteCount || null,
              occupants,
              itemCount: activeObjects.length + passiveObjects.length + wallItems.length,
              wallItemCount: wallItems.length,
              floorItemCount: activeObjects.length + passiveObjects.length,
              fps: performanceStats?.rafPerSecond ?? performanceStats?.rafRate ?? performanceStats?.fps ?? null,
            };
          })()
        `, true).catch((error) => ({ error: String(error?.message || error) }))
        : { error: "webview not mounted" };
      rows.push({ clientId, label, active, mounted: Boolean(webview), summary });
    }
    return rows;
  });
}

async function panelFacts(activePage) {
  return activePage.evaluate(() => {
    const panel = document.querySelector("section.plugin-panel");
    if (!panel) return { visible: false, title: "", text: "", kv: {}, counts: {}, buttons: [] };
    const kv = {};
    for (const grid of panel.querySelectorAll(".kv-grid")) {
      const children = [...grid.children];
      for (let index = 0; index < children.length; index += 2) {
        const key = children[index]?.textContent?.trim();
        const value = children[index + 1]?.textContent?.trim();
        if (key) kv[key] = value ?? "";
      }
    }
    const count = (selector) => panel.querySelectorAll(selector).length;
    return {
      visible: true,
      title: panel.querySelector("h2")?.textContent?.trim() || "",
      text: panel.textContent?.replace(/\s+/g, " ").trim() || "",
      kv,
      counts: {
        pluginRows: count(".plugin-manager-row"),
        sessionRows: count(".multi-session-row"),
        itemRows: count(".item-list .item-row:not(.empty)"),
        packetRows: count(".packet-entry:not(.empty)"),
        chatRows: count(".chat-entry, .chat-row"),
        visitorRows: count(".visitor-row, .item-row:not(.empty)"),
        injectionRows: count(".injection-history-row"),
      },
      buttons: [...panel.querySelectorAll("button")].map((button) => ({
        text: button.textContent?.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || "",
        disabled: button.disabled,
      })),
    };
  });
}

function evaluatePlugin(plugin, facts, context, screenshot) {
  const selected = context.selected?.summary ?? {};
  const relay = context.relay ?? {};
  const text = facts.text || "";
  const baseProof = {
    roomId: selected.roomId || null,
    roomName: selected.roomName || null,
    roomReady: roomReadyMatches(context.selected, roomId),
    packets: relay.packetCount ?? null,
    screenshot,
  };
  const pass = (reason, extra = {}) => ({ pluginId: plugin.id, name: plugin.name, status: "passed", reason, proof: { ...baseProof, ...extra } });
  const fail = (reason, extra = {}) => ({ pluginId: plugin.id, name: plugin.name, status: "failed", reason, proof: { ...baseProof, ...extra } });
  const needs = (reason, extra = {}) => ({ pluginId: plugin.id, name: plugin.name, status: "needs-context", reason, proof: { ...baseProof, ...extra } });
  const visible = facts.visible && facts.title === plugin.name;
  if (!visible) return fail("Panel did not render for the selected plugin.", { title: facts.title });
  switch (plugin.id) {
    case "connection":
      return relay.packetCount > 0 && text.includes("Parsed State") ? pass("Connection panel sees live relay and parsed session state.") : fail("Connection panel did not expose live relay/parsed state.", { kv: facts.kv });
    case "plugin-manager":
      return facts.counts.pluginRows >= builtInPlugins.length ? pass("Plugin Manager lists built-in/user plugins and toggles.") : fail("Plugin Manager did not list expected plugins.", { rows: facts.counts.pluginRows });
    case "settings":
      return text.includes("Hardware Acceleration") && text.includes("Responsive Stage Resize") ? pass("Settings exposes engine, hardware, console, and session preferences.") : fail("Settings is missing expected preference groups.");
    case "multi-account":
      return facts.counts.sessionRows >= 2 ? pass("Multi Account sees active visible sessions and controls.") : fail("Multi Account did not show the loaded game session.", { rows: facts.counts.sessionRows });
    case "info":
      return text.includes("Codex Test LAB") || text.includes(roomId) ? pass("Info panel reads live account/room packet/runtime facts.") : fail("Info panel did not show live room facts.", { kv: facts.kv });
    case "room":
      return text.includes("Codex Test LAB") || text.includes(roomId) ? pass("Room panel reads live private-room state.") : fail("Room panel did not show live room state.", { kv: facts.kv });
    case "user":
      return Number(selected.userCount || 0) > 0 && text.includes("Actions") ? pass("User panel sees live room users and action controls.") : fail("User panel did not expose live user/action state.", { userCount: selected.userCount, kv: facts.kv });
    case "items":
      return Number(selected.itemCount || 0) > 0 && facts.counts.itemRows > 0 ? pass("Items panel lists live room floor/wall objects.") : fail("Items panel did not list live room objects.", { itemCount: selected.itemCount, rows: facts.counts.itemRows });
    case "inventory":
      return text.includes("Request Hand") && (text.includes("Inventory Items") || text.includes("Hand inventory"))
        ? pass("Inventory panel renders against the live session; item count may be zero for the account.", { kv: facts.kv })
        : fail("Inventory panel did not render live session context.", { kv: facts.kv });
    case "automation":
      return text.includes("Room Ready") && text.includes("Plants") ? pass("Automation panel reads live room automation counts.") : fail("Automation panel did not show live automation counts.", { kv: facts.kv });
    case "fishing":
      if (!context.fishingProbe?.ok) return needs(context.fishingProbe?.reason ?? "Fishing public-room probe did not run.", { kv: facts.kv });
      if (Number(normalizeOccupants(selected.occupants, selected.userName)?.otherHumanCount ?? 0) > 0) return needs("Another real user joined the fishing room; Bob/NPCs are ignored, but the test must leave occupied public rooms.", { kv: facts.kv, fishingProbe: context.fishingProbe, occupants: selected.occupants });
      {
        const apiProof = context.liveApiProbe?.entries?.fishingApi?.value ?? null;
        const apiPassed = Boolean(apiProof?.walk?.ok && apiProof?.start?.ok && apiProof?.tokens?.ok);
        const panelPassed = Number(extractNumber(facts.kv.Areas ?? facts.kv["Fishing Areas"])) > 0 && /Fishing start header=1100|STARTFISHING/i.test(text);
        return panelPassed && apiPassed
          ? pass("Fishing found live areas in an empty public room; native panel and temporary user plugin both sent v3 Fishing actions through scoped APIs.", { kv: facts.kv, fishingProbe: context.fishingProbe, liveApiProbe: context.liveApiProbe })
          : fail("Fishing did not prove both native panel relay and user-plugin Fishing APIs.", { kv: facts.kv, fishingProbe: context.fishingProbe, liveApiProbe: context.liveApiProbe });
      }
    case "gardening":
      return text.includes("Start Gardening") && Number(extractNumber(facts.kv.Plants)) > 0 ? pass("Gardening panel sees live plants and start controls.") : fail("Gardening panel did not find live plants/start controls.", { kv: facts.kv });
    case "wall-mover":
      return facts.counts.itemRows > 0 && text.includes("Target ID") && text.includes("Pick Up Selected") ? pass("Wall Mover lists live wall items and movement controls.") : fail("Wall Mover did not list live wall items.", { wallItemCount: selected.wallItemCount, rows: facts.counts.itemRows });
    case "social":
      return text.includes("Friends") && text.includes("Messages") ? pass("Social panel renders parsed messenger state in the live session.") : fail("Social panel did not show messenger state.", { kv: facts.kv });
    case "visitors":
      return Number(selected.userCount || 0) > 0 && text.includes(selected.userName || "") ? pass("Visitors panel sees current live room users.") : fail("Visitors panel did not list current room users.", { userCount: selected.userCount });
    case "chat":
      return text.includes(safeChatText) || facts.counts.chatRows > 0 ? pass("Chat panel reads/sends live room chat.") : fail("Chat panel did not show live chat rows.", { rows: facts.counts.chatRows });
    case "injection":
      return text.includes("Recent Injections") && /sent through|success/i.test(text) ? pass("Injection command editor executed a live room action.") : fail("Injection panel did not record a successful live action.", { rows: facts.counts.injectionRows });
    case "packet-log":
      return relay.packetCount > 0 && facts.counts.packetRows > 0 ? pass("Packet Log lists decrypted live relay rows.") : fail("Packet Log did not show live packet rows.", { packetCount: relay.packetCount, rows: facts.counts.packetRows });
    case "dev-tools":
      return text.includes("FPS") && selected.hasEngine !== false ? pass("Dev Tools reads live engine diagnostics.") : fail("Dev Tools did not show live diagnostics.", { kv: facts.kv });
    case "about":
      return text.includes("Habbpy v4") ? pass("About panel renders app/runtime metadata.") : fail("About panel did not render app metadata.");
    default:
      return needs("No live assertion has been defined for this plugin yet.");
  }
}

function recordSoftFailure(results, plugin, error) {
  results.push({
    pluginId: plugin.id,
    name: plugin.name,
    status: "failed",
    reason: maskText(error instanceof Error ? error.message : String(error)),
    proof: { screenshot: null },
  });
}

async function capturePage(activePage, label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "plugin";
  const path = join(screenshotDir, `${safeLabel}-${stamp}.png`);
  await activePage.screenshot({ path, fullPage: true, timeout: 60000 });
  return path;
}

async function writeProgressReport({ targetClient, baseContext, pluginResults }) {
  await writeReport({
    ok: false,
    partial: true,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-plugin-live-matrix",
    roomId,
    targetClient,
    baseContext,
    plugins: pluginResults,
    failures: pluginResults.filter((result) => result.status === "failed"),
    needsContext: pluginResults.filter((result) => result.status === "needs-context"),
    pluginFilter: [...pluginFilterIds],
    commands: commandLog,
    screenshots,
    consoleMessages,
    pageErrors,
    offscreenBounds,
  });
}

async function writeReport(report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function roomReadyMatches(entry, expectedRoomId) {
  const summary = entry?.summary || {};
  const ready = summary.roomReady === true || summary.roomReady?.ready === true;
  if (!ready) return false;
  const actualRoomId = String(summary.roomId || summary.roomReady?.roomId || summary.roomReady?.flatId || "").trim();
  if (actualRoomId === String(expectedRoomId)) return true;
  if (String(summary.roomName || "").toLowerCase().includes("codex test lab")) return true;
  const roomType = String(summary.roomType || summary.roomReady?.roomType || "").toLowerCase();
  const hasLiveRoomContent = Number(summary.userCount || 0) > 0 || Number(summary.itemCount || 0) > 0;
  return roomType.includes("private") && hasLiveRoomContent;
}

function extractNumber(value) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d-]+/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOccupants(occupants, sessionName = "") {
  if (occupants && typeof occupants === "object") return occupants;
  return {
    totalCount: 0,
    humanCount: 0,
    otherHumanCount: 0,
    botCount: 0,
    unknownCount: 0,
    users: [],
    sessionName,
  };
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function quoteArg(value) {
  const text = String(value ?? "");
  return /[\s"]/.test(text) ? `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : text;
}

function cssAttrValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function maskCommand(command) {
  return maskText(String(command ?? "").replace(/(login\s+)(?:"[^"]*"|\S+:\S+)/i, "$1[credentials]"));
}

function maskText(text) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(password|token|webhook|secret)=\S+/gi, "$1=[redacted]");
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
