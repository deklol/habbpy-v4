import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const electronExecutable = require("electron");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = resolve(
  repoRoot,
  process.env.HABBPY_V4_VISIBLE_SMOKE_REPORT || join("logs", "automation", `visible-sessions-${stamp}.json`),
);
const screenshotDir = resolve(
  repoRoot,
  process.env.HABBPY_V4_VISIBLE_SMOKE_SCREENSHOT_DIR || join("screenshots", "automation", `visible-sessions-${stamp}`),
);
const accountFile = process.env.HABBPY_V4_VISIBLE_SMOKE_ACCOUNT_FILE || "multiclient-accounts.txt";
const accountCount = positiveInt(process.env.HABBPY_V4_VISIBLE_SMOKE_COUNT, 2);
const concurrency = positiveInt(process.env.HABBPY_V4_VISIBLE_SMOKE_CONCURRENCY, 2);
const roomId = String(process.env.HABBPY_V4_VISIBLE_SMOKE_ROOM_ID || "").trim();
const windowMode = process.env.HABBPY_V4_VISIBLE_SMOKE_WINDOW_MODE || "offscreen";
const waitAfterLoadMs = positiveInt(process.env.HABBPY_V4_VISIBLE_SMOKE_WAIT_AFTER_LOAD_MS, 45000);
const waitAfterRoomMs = positiveInt(process.env.HABBPY_V4_VISIBLE_SMOKE_WAIT_AFTER_ROOM_MS, 25000);
const roomTimeoutMs = positiveInt(process.env.HABBPY_V4_VISIBLE_SMOKE_ROOM_TIMEOUT_MS, 90000);
const visibleClientIds = Array.from({ length: accountCount }, (_entry, index) => index + 2);
const summonMode = truthy(process.env.HABBPY_V4_VISIBLE_SMOKE_SUMMON);
const summonMainClientId = positiveInt(process.env.HABBPY_V4_VISIBLE_SMOKE_SUMMON_MAIN_CLIENT_ID, visibleClientIds[0] ?? 2);
const summonTargetClientIds = parseClientIds(
  process.env.HABBPY_V4_VISIBLE_SMOKE_SUMMON_TARGETS,
  visibleClientIds.filter((clientId) => clientId !== summonMainClientId),
);

await mkdir(dirname(reportPath), { recursive: true });
await mkdir(screenshotDir, { recursive: true });

const consoleMessages = [];
const pageErrors = [];
const commandLog = [];
const screenshots = [];
let app;
let page;
let offscreenBounds = null;

try {
  app = await electron.launch({
    executablePath: electronExecutable,
    args: ["dist/main/main/main.js"],
    cwd: repoRoot,
    env: {
      ...process.env,
      HABBPY_V4_MAIN_WINDOW_SHOW: "0",
    },
    timeout: 60000,
  });
  page = await app.firstWindow({ timeout: 60000 });
  if (windowMode !== "hidden") {
    offscreenBounds = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0] ?? null;
      if (!window) return null;
      window.setBounds({ x: -32000, y: -32000, width: 1440, height: 760 }, false);
      window.setSkipTaskbar(true);
      window.showInactive();
      return window.getBounds();
    });
  }
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
  await page.waitForTimeout(5500);

  await runConsoleCommand(page, `load ${quoteArg(accountFile)} ${accountCount} --concurrency ${concurrency}`);
  await waitForMountedVisibleWebviews(page, visibleClientIds, 90000);
  await page.waitForTimeout(waitAfterLoadMs);

  if (roomId && summonMode) {
    if (!visibleClientIds.includes(summonMainClientId)) {
      throw new Error(`summon main client${summonMainClientId} was not loaded by this smoke`);
    }
    await runConsoleCommand(page, `main ${summonMainClientId}`);
    await selectClient(page, summonMainClientId);
    await page.waitForTimeout(1500);
    await runConsoleCommand(page, `@${summonMainClientId} enterroom ${roomId}`);
    await waitForClientRoom(page, summonMainClientId, roomId, roomTimeoutMs);
    await selectClient(page, summonMainClientId);
    await page.waitForTimeout(2500);
    for (const clientId of summonTargetClientIds) {
      await runConsoleCommand(page, `summon ${clientId}`);
    }
    for (const clientId of summonTargetClientIds) {
      await waitForClientRoom(page, clientId, roomId, roomTimeoutMs);
    }
    await closeConsole(page);
    await page.waitForTimeout(waitAfterRoomMs);
  } else if (roomId) {
    for (const clientId of visibleClientIds) {
      await runConsoleCommand(page, `@${clientId} enterroom ${roomId}`);
      await waitForClientRoom(page, clientId, roomId, roomTimeoutMs);
    }
    await closeConsole(page);
    await page.waitForTimeout(waitAfterRoomMs);
  } else {
    await closeConsole(page);
  }

  const phases = [];
  for (const clientId of visibleClientIds) {
    await selectClient(page, clientId);
    await page.waitForTimeout(2000);
    phases.push({
      phase: `selected-client${clientId}`,
      selectedClientId: clientId,
      sessions: await clientSessions(page),
      webviews: await webviewSummaries(page),
    });
    screenshots.push(await capturePage(page, `selected-client${clientId}`));
  }

  if (visibleClientIds.length > 1) {
    const firstClientId = visibleClientIds[0];
    await selectClient(page, firstClientId);
    await page.waitForTimeout(1500);
    phases.push({
      phase: `selected-client${firstClientId}-again`,
      selectedClientId: firstClientId,
      sessions: await clientSessions(page),
      webviews: await webviewSummaries(page),
    });
    screenshots.push(await capturePage(page, `selected-client${firstClientId}-again`));
  }

  const finalSessions = await clientSessions(page);
  const finalWebviews = await webviewSummaries(page);
  const expectedClients = new Set(visibleClientIds);
  const mountedClientIds = new Set(finalWebviews.map((entry) => entry.clientId));
  const runningVisibleSessions = (finalSessions.sessions || []).filter((session) => expectedClients.has(session.id) && session.visible && session.status === "running");
  const activeSequence = phases.map((phase) => activeWebviewClientId(phase.webviews));
  const roomMatches = roomId
    ? finalWebviews.filter((entry) => expectedClients.has(entry.clientId)).every((entry) => roomReadyMatches(entry, roomId))
    : true;
  const ok =
    runningVisibleSessions.length === expectedClients.size &&
    visibleClientIds.every((clientId) => mountedClientIds.has(clientId)) &&
    activeSequence.every((clientId, index) => clientId === phases[index]?.selectedClientId) &&
    roomMatches &&
    consoleMessages.length === 0 &&
    pageErrors.length === 0;

  const report = {
    ok,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-visible-session-smoke",
    portableLaunched: false,
    mainWindowMode: windowMode === "hidden" ? "hidden" : "offscreen",
    offscreenBounds,
    accountFile,
    accountCount,
    roomId: roomId || null,
    summonMode,
    summonMainClientId: summonMode ? summonMainClientId : null,
    summonTargetClientIds: summonMode ? summonTargetClientIds : [],
    commands: commandLog,
    finalSessions,
    finalWebviews,
    activeSequence,
    phases,
    screenshots,
    consoleMessages,
    pageErrors,
  };
  await writeReport(report);
  console.log(`Visible session smoke report: ${reportPath}`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  const report = {
    ok: false,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-visible-session-smoke",
    portableLaunched: false,
    mainWindowMode: windowMode === "hidden" ? "hidden" : "offscreen",
    offscreenBounds,
    accountFile,
    accountCount,
    roomId: roomId || null,
    summonMode,
    summonMainClientId: summonMode ? summonMainClientId : null,
    summonTargetClientIds: summonMode ? summonTargetClientIds : [],
    commands: commandLog,
    screenshots,
    consoleMessages,
    pageErrors,
    finalSessions: page ? await clientSessions(page).catch(() => null) : null,
    finalWebviews: page ? await webviewSummaries(page).catch(() => null) : null,
    error: maskText(error instanceof Error ? error.stack || error.message : String(error)),
  };
  await writeReport(report);
  console.error(`Visible session smoke failed. Report: ${reportPath}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => null);
}

async function runConsoleCommand(page, command) {
  await openConsole(page);
  const input = page.getByLabel("Packet console command");
  await input.fill(command);
  await input.press("Enter");
  commandLog.push({
    command: maskCommand(command),
    at: new Date().toISOString(),
  });
  await page.waitForTimeout(750);
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

async function waitForClientRoom(page, clientId, expectedRoomId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await webviewSummaries(page);
    const row = rows.find((entry) => entry.clientId === clientId);
    if (row && roomReadyMatches(row, expectedRoomId)) return row;
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
      const label = surface.getAttribute("data-client-label") || "";
      const active = surface.classList.contains("active");
      const url = typeof webview?.getURL === "function" ? webview.getURL() : webview?.getAttribute("src") || "";
      const summary = webview
        ? await webview.executeJavaScript(`
          (async () => {
            const root = window.__engine || null;
            const dev = root?.dev || null;
            const safe = async (fn, args = []) => {
              try {
                return typeof fn === "function" ? await Promise.resolve(fn(...args)) : null;
              } catch {
                return null;
              }
            };
            const plainKey = (key) => {
              if (key == null) return "";
              if (typeof key === "string" || typeof key === "number" || typeof key === "boolean") return String(key);
              if (typeof key !== "object") return String(key);
              return String(key.name ?? key.value ?? key.symbol ?? key.key ?? "");
            };
            const nativeValue = (value) => {
              if (value == null || typeof value !== "object") return value;
              if (Array.isArray(value)) return value.map(nativeValue);
              if (value.type === "symbol") return "#" + plainKey(value);
              if (value.type === "list" && Array.isArray(value.items)) return value.items.map(nativeValue);
              if (Array.isArray(value.entries)) {
                if (value.type === "list") return value.entries.map((entry) => nativeValue(entry?.value ?? entry));
                const out = {};
                for (const entry of value.entries) {
                  const key = plainKey(entry?.key ?? entry?.name ?? entry?.prop);
                  if (key) out[key] = nativeValue(entry?.value);
                }
                return out;
              }
              if ("value" in value && Object.keys(value).length <= 3) return nativeValue(value.value);
              const out = {};
              for (const [key, entry] of Object.entries(value)) out[key] = nativeValue(entry);
              return out;
            };
            const propEntries = (value) => {
              if (!value || typeof value !== "object") return [];
              if (Array.isArray(value.entries)) {
                return value.entries.map((entry, index) => ({
                  key: plainKey(entry?.key ?? entry?.name ?? entry?.prop ?? index + 1),
                  value: nativeValue(entry?.value ?? entry),
                }));
              }
              return Object.entries(value).map(([key, entry]) => ({ key, value: nativeValue(entry) }));
            };
            const valueText = (value) => {
              const native = nativeValue(value);
              if (native == null || native === "") return null;
              if (Array.isArray(native)) return native.map(valueText).filter(Boolean).join(", ");
              if (typeof native === "object") return null;
              return String(native);
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
            const roomValue = (...keys) => {
              if (!lastRoom || typeof lastRoom !== "object") return undefined;
              const lowered = keys.map((key) => String(key).toLowerCase());
              return Object.entries(lastRoom).find(([key]) => lowered.includes(String(key).toLowerCase()))?.[1];
            };
            const roomObjects = await safe(root?.roomObjects);
            const roomReady = await safe(dev?.roomReady);
            const performanceStats = await safe(dev?.performanceStats);
            const users = roomObjects && typeof roomObjects === "object"
              ? roomObjects.users ?? roomObjects.roomUsers ?? roomObjects.people
              : null;
            return {
              href: location.href,
              title: document.title,
              hasEngine: Boolean(root),
              hasDev: Boolean(dev),
              canvasCount: document.querySelectorAll("canvas").length,
              roomReady,
              userName: valueText(sessionValue("#userName", "userName")),
              roomName: valueText(roomValue("#name", "name")),
              roomId: valueText(roomValue("#flatId", "#id", "flatId", "id")),
              roomOwner: valueText(roomValue("#owner", "owner")),
              userCount: Array.isArray(users) ? users.length : users && typeof users === "object" ? Object.keys(users).length : null,
              fps: performanceStats?.rafPerSecond ?? performanceStats?.rafRate ?? performanceStats?.fps ?? null,
            };
          })()
        `, true).catch((error) => ({ error: String(error?.message || error) }))
        : { error: "webview not mounted" };
      rows.push({ clientId, label, active, url, summary });
    }
    return rows;
  });
}

async function capturePage(page, label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "visible-session";
  const filePath = join(screenshotDir, `${safeLabel}-${stamp}.png`);
  await page.screenshot({ path: filePath, fullPage: true, timeout: 60000 });
  return {
    label,
    path: filePath,
  };
}

async function writeReport(report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function activeWebviewClientId(webviews) {
  return webviews.find((entry) => entry.active)?.clientId ?? null;
}

function roomReadyMatches(entry, expectedRoomId) {
  const summary = entry?.summary || {};
  const ready = summary.roomReady === true || summary.roomReady?.ready === true;
  const actualRoomId = String(summary.roomId || summary.roomReady?.roomId || summary.roomReady?.flatId || "");
  return ready && actualRoomId === String(expectedRoomId);
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseClientIds(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const ids = text
    .split(/[,\s]+/)
    .map((entry) => Number.parseInt(entry, 10))
    .filter((entry) => Number.isSafeInteger(entry) && entry > 0);
  return ids.length > 0 ? [...new Set(ids)] : fallback;
}

function truthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
}

function quoteArg(value) {
  const text = String(value ?? "");
  return /[\s"]/.test(text) ? `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : text;
}

function maskCommand(command) {
  return maskText(String(command ?? "").replace(/(login\s+)\S+:\S+/i, "$1[credentials]"));
}

function maskText(text) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(password|token|webhook|secret)=\S+/gi, "$1=[redacted]");
}
