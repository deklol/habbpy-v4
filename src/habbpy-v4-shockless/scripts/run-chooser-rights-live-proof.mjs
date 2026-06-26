import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const electronExecutable = require("electron");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const pluginId = "chooser-furni-permissions";
const roomId = String(process.env.HABBPY_V4_CHOOSER_PROOF_ROOM_ID || "224520").trim();
const accountFile = String(process.env.HABBPY_V4_CHOOSER_PROOF_ACCOUNT_FILE || "multiclient-accounts.txt").trim();
const accountLabel = String(process.env.HABBPY_V4_CHOOSER_PROOF_ACCOUNT_LABEL || "shockless").trim();
const appDataRoot = resolve(process.env.APPDATA || process.env.HABBPY_V4_APP_DATA_PATH || "");
const appPluginRoot = resolve(appDataRoot, "HabbpyV4", "plugins", pluginId);
const sourcePluginRoot = resolve(repoRoot, "examples", "plugins", pluginId);
const pluginSettingsPath = resolve(appDataRoot, "HabbpyV4", "plugins", "settings.json");
const reportPath = resolve(repoRoot, "logs", "automation", `chooser-rights-proof-${stamp}.json`);
const screenshotDir = resolve(repoRoot, "screenshots", "automation", `chooser-rights-proof-${stamp}`);
const clientId = 2;

await mkdir(dirname(reportPath), { recursive: true });
await mkdir(screenshotDir, { recursive: true });

let app = null;
let page = null;
let previousPluginSettings = null;
let hadPluginSettings = false;
let hadPluginFolder = false;
let previousPluginFolder = null;
const commandLog = [];
const consoleMessages = [];
const pageErrors = [];
const screenshots = [];

try {
  if (!appDataRoot) throw new Error("APPDATA or HABBPY_V4_APP_DATA_PATH is required.");
  await assertPathExists(join(sourcePluginRoot, "habbpy.plugin.json"), "Chooser/Furni example plugin manifest");
  await installProofPlugin();
  const account = await selectAccount();

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
    window.setBounds({ x: -32000, y: -32000, width: 1440, height: 820 }, false);
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
  await page.waitForTimeout(2500);
  await runConsoleCommand(page, loginCommand(account));
  await waitForMountedVisibleWebviews(page, [clientId], 90000);
  await page.waitForTimeout(45000);
  await selectClient(page, clientId);
  await runConsoleCommand(page, `@${clientId} enterroom ${roomId}`);
  await waitForClientRoom(page, clientId, roomId, 90000);
  await selectClient(page, clientId);
  await waitForPluginGrant(page, 60000);

  const rightsBeforeCommands = await readClientRights(page, clientId);
  if (!rightsBeforeCommands.includes("fuse_habbo_chooser") || !rightsBeforeCommands.includes("fuse_furni_chooser")) {
    throw new Error(`Chooser rights were not present after room-ready grant: ${rightsBeforeCommands.join(", ") || "none"}`);
  }

  await sendRuntimeChat(page, clientId, ":chooser");
  const chooserWindowIds = await waitForWindowMatching(page, clientId, /chooser|user\s*list/i, 30000);
  screenshots.push(await capturePage(page, "shockless-chooser-ui"));

  const beforeFurniWindowIds = await windowIds(page, clientId);
  await sendRuntimeChat(page, clientId, ":furni");
  const furniWindowIds = await waitForNewOrMatchingWindow(page, clientId, beforeFurniWindowIds, /furni|strip|item/i, 30000);
  screenshots.push(await capturePage(page, "shockless-furni-ui"));

  const sessions = await clientSessions(page);
  const webviews = await webviewSummaries(page);
  const pluginGrant = await readPluginGrant(page);
  const report = {
    ok: true,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-chooser-rights-live-proof",
    accountLabel: account.label,
    clientId,
    roomId,
    rights: rightsBeforeCommands,
    chooserWindowIds,
    furniWindowIds,
    pluginGrant,
    sessions,
    webviews,
    commands: commandLog,
    screenshots,
    consoleMessages,
    pageErrors,
  };
  await writeReport(report);
  console.log(`Chooser rights proof report: ${reportPath}`);
  console.log(`Chooser proof screenshot: ${screenshots[0]}`);
  console.log(`Furni proof screenshot: ${screenshots[1]}`);
  process.exitCode = 0;
} catch (error) {
  if (page) await capturePage(page, "chooser-proof-failure").then((path) => screenshots.push(path)).catch(() => null);
  await writeReport({
    ok: false,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-chooser-rights-live-proof",
    accountLabel,
    clientId,
    roomId,
    commands: commandLog,
    screenshots,
    pluginGrant: page ? await readPluginGrant(page).catch(() => null) : null,
    sessions: page ? await clientSessions(page).catch(() => null) : null,
    webviews: page ? await webviewSummaries(page).catch(() => null) : null,
    consoleMessages,
    pageErrors,
    error: maskText(error instanceof Error ? error.stack || error.message : String(error)),
  });
  console.error(`Chooser rights proof failed. Report: ${reportPath}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => null);
  await restoreProofPlugin().catch(() => null);
}

async function installProofPlugin() {
  await mkdir(dirname(appPluginRoot), { recursive: true });
  hadPluginFolder = existsSync(appPluginRoot);
  previousPluginFolder = hadPluginFolder ? `${appPluginRoot}.proof-backup-${stamp}` : null;
  if (hadPluginFolder && previousPluginFolder) {
    await rm(previousPluginFolder, { recursive: true, force: true });
    await cp(appPluginRoot, previousPluginFolder, { recursive: true, force: true });
  }
  await rm(appPluginRoot, { recursive: true, force: true });
  await cp(sourcePluginRoot, appPluginRoot, { recursive: true, force: true });

  hadPluginSettings = existsSync(pluginSettingsPath);
  previousPluginSettings = hadPluginSettings ? await readFile(pluginSettingsPath, "utf8") : null;
  const parsed = hadPluginSettings ? safeJson(previousPluginSettings, {}) : {};
  await mkdir(dirname(pluginSettingsPath), { recursive: true });
  await writeFile(
    pluginSettingsPath,
    `${JSON.stringify(
      {
        version: 1,
        enabledById: {
          ...(isRecord(parsed.enabledById) ? parsed.enabledById : {}),
          [pluginId]: true,
        },
        uiSurfaceEnabledByPluginId: {
          ...(isRecord(parsed.uiSurfaceEnabledByPluginId) ? parsed.uiSurfaceEnabledByPluginId : {}),
          [pluginId]: { status: true },
        },
        permissionGrants: isRecord(parsed.permissionGrants) ? parsed.permissionGrants : {},
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function restoreProofPlugin() {
  await rm(appPluginRoot, { recursive: true, force: true });
  if (hadPluginFolder && previousPluginFolder) {
    await cp(previousPluginFolder, appPluginRoot, { recursive: true, force: true });
    await rm(previousPluginFolder, { recursive: true, force: true });
  }
  if (hadPluginSettings && previousPluginSettings !== null) {
    await writeFile(pluginSettingsPath, previousPluginSettings, "utf8");
  } else {
    await rm(pluginSettingsPath, { force: true });
  }
}

async function selectAccount() {
  const accounts = parseAccounts(await readFile(resolve(repoRoot, accountFile), "utf8"));
  const target = findAccount(accounts, accountLabel) ?? findAccount(accounts, "shockless1") ?? findAccount(accounts, "shockless");
  if (!target) throw new Error(`Could not find account label '${accountLabel}' in account file.`);
  return target;
}

function parseAccounts(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

function findAccount(accounts, label) {
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

function loginCommand(account) {
  return `login ${quoteArg(`${account.email}:${account.password}`)} --label ${quoteArg(account.label)}`;
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

async function selectClient(activePage, targetClientId) {
  const button = activePage.getByLabel(`Select client ${targetClientId}`);
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
  await activePage.waitForFunction(
    (id) => document.querySelector(`.game-webview-zoom-surface[data-client-id="${id}"]`)?.classList.contains("active") === true,
    targetClientId,
    { timeout: 30000 },
  );
}

async function waitForMountedVisibleWebviews(activePage, clientIds, timeoutMs) {
  await activePage.waitForFunction(
    (ids) => ids.every((id) => document.querySelector(`.game-webview-zoom-surface[data-client-id="${id}"] webview`)),
    clientIds,
    { timeout: timeoutMs },
  );
}

async function waitForClientRoom(activePage, targetClientId, expectedRoomId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await webviewSummaries(activePage).catch(() => []);
    const row = rows.find((entry) => entry.clientId === targetClientId);
    if (roomReadyMatches(row, expectedRoomId)) return row;
    await activePage.waitForTimeout(2000);
  }
  throw new Error(`client${targetClientId} did not report room ${expectedRoomId} within ${timeoutMs}ms`);
}

async function waitForPluginGrant(activePage, timeoutMs) {
  await activePage.waitForFunction(
    (key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      try {
        return JSON.parse(raw)?.ok === true;
      } catch {
        return false;
      }
    },
    storageKey("lastGrant"),
    { timeout: timeoutMs },
  );
}

async function readPluginGrant(activePage) {
  return activePage.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storageKey("lastGrant"));
}

async function readClientRights(activePage, targetClientId) {
  return activePage.evaluate(
    async ({ clientId: wantedClientId }) => {
      const surface = document.querySelector(`.game-webview-zoom-surface[data-client-id="${wantedClientId}"]`);
      const webview = surface?.querySelector("webview");
      if (!webview) return [];
      return webview.executeJavaScript(`
        (async () => {
          const root = window.__engine;
          const normalize = (value) => {
            if (Array.isArray(value)) return value.map(String);
            if (value && typeof value === "object" && Array.isArray(value.items)) return value.items.map(String);
            return [];
          };
          return normalize(await Promise.resolve(root?.objectMethod?.("session", "get", ["user_rights", []])));
        })()
      `, true);
    },
    { clientId: targetClientId },
  );
}

async function sendRuntimeChat(activePage, targetClientId, message) {
  await closeConsole(activePage);
  const result = await activePage.evaluate(
    async ({ clientId: wantedClientId, message }) => {
      const surface = document.querySelector(`.game-webview-zoom-surface[data-client-id="${wantedClientId}"]`);
      const webview = surface?.querySelector("webview");
      if (!webview) return { ok: false, message: "webview not mounted" };
      return webview.executeJavaScript(`
        (async (message) => {
          const dev = window.__engine?.dev;
          if (typeof dev?.sendChat !== "function") return { ok: false, message: "sendChat helper unavailable" };
          const result = await dev.sendChat(message, 0);
          return { ok: true, result };
        })(${JSON.stringify(message)})
      `, true);
    },
    { clientId: targetClientId, message },
  );
  if (!result?.ok) throw new Error(result?.message || `Failed to send ${message}`);
  await activePage.waitForTimeout(1500);
  return result;
}

async function waitForWindowMatching(activePage, targetClientId, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    latest = await windowIds(activePage, targetClientId).catch(() => []);
    if (latest.some((id) => pattern.test(String(id)))) return latest;
    await activePage.waitForTimeout(1000);
  }
  throw new Error(`No runtime window matched ${pattern} within ${timeoutMs}ms; latest=${latest.join(", ") || "none"}`);
}

async function waitForNewOrMatchingWindow(activePage, targetClientId, previousIds, pattern, timeoutMs) {
  const previous = new Set((Array.isArray(previousIds) ? previousIds : []).map(String));
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    latest = await windowIds(activePage, targetClientId).catch(() => []);
    if (latest.some((id) => pattern.test(String(id)))) return latest;
    if (latest.some((id) => !previous.has(String(id)))) return latest;
    await activePage.waitForTimeout(1000);
  }
  throw new Error(`No new runtime window or ${pattern} match within ${timeoutMs}ms; latest=${latest.join(", ") || "none"}`);
}

async function windowIds(activePage, targetClientId) {
  return activePage.evaluate(
    async ({ clientId: wantedClientId }) => {
      const surface = document.querySelector(`.game-webview-zoom-surface[data-client-id="${wantedClientId}"]`);
      const webview = surface?.querySelector("webview");
      if (!webview) return [];
      return webview.executeJavaScript(`
        (async () => {
          const ids = await Promise.resolve(window.__engine?.dev?.windowIds?.()).catch(() => []);
          return Array.isArray(ids) ? ids.map(String) : [];
        })()
      `, true);
    },
    { clientId: targetClientId },
  );
}

async function clientSessions(activePage) {
  return activePage.evaluate(() => window.habbpyV4?.getClientSessions?.() ?? null);
}

async function webviewSummaries(activePage) {
  return activePage.evaluate(async () => {
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
            `
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
                  if (value.type === "list" && Array.isArray(value.items)) return value.items.map(nativeValue);
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
                return {
                  hasEngine: Boolean(root),
                  hasDev: Boolean(dev),
                  roomReady: await safe(dev?.roomReady),
                  windowIds: await safe(dev?.windowIds) ?? [],
                  roomName: valueText(roomValue(lastRoom, "#name", "name")),
                  roomId: String(roomValue(lastRoom, "#flatId", "#id", "flatId", "id") ?? ""),
                  roomOwner: valueText(roomValue(lastRoom, "#owner", "owner")),
                  userName: valueText(sessionValue("#userName", "userName")),
                };
              })()
            `,
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
  const roomIdValue = String(
    row.runtime.roomId ??
      row.runtime.roomReady?.roomId ??
      row.runtime.roomReady?.flatId ??
      row.runtime.room?.id ??
      row.runtime.location?.roomId ??
      row.runtime.roomEntryState?.flatId ??
      "",
  );
  return Boolean(roomReady) && roomIdValue === String(expectedRoomId);
}

async function capturePage(activePage, label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "proof";
  const path = join(screenshotDir, `${safeLabel}-${stamp}.png`);
  await activePage.screenshot({ path, fullPage: true, timeout: 60000 });
  return path;
}

async function writeReport(report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function assertPathExists(path, label) {
  try {
    await stat(path);
  } catch {
    throw new Error(`${label} is missing at ${path}`);
  }
}

function storageKey(key) {
  return `habbpy-v4:user-plugin:${pluginId}:${key}`;
}

function quoteArg(value) {
  const text = String(value ?? "");
  return /[\s"]/.test(text) ? `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : text;
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

function maskCommand(command) {
  return maskText(String(command ?? "").replace(/(login\s+)(?:"[^"]*"|\S+:\S+)/i, "$1[credentials]"));
}

function maskText(text) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(password|token|webhook|secret)=\S+/gi, "$1=[redacted]");
}
