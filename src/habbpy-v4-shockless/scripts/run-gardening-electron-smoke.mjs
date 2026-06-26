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
  process.env.HABBPY_V4_GARDENING_SMOKE_REPORT || join("logs", "automation", `gardening-smoke-${stamp}.json`),
);
const screenshotDir = resolve(
  repoRoot,
  process.env.HABBPY_V4_GARDENING_SMOKE_SCREENSHOT_DIR || join("screenshots", "automation", `gardening-smoke-${stamp}`),
);
const accountFile = process.env.HABBPY_V4_GARDENING_SMOKE_ACCOUNT_FILE || "multiclient-accounts.txt";
const accountCount = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_COUNT, 3);
const concurrency = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_CONCURRENCY, 2);
const targetLabel = String(process.env.HABBPY_V4_GARDENING_SMOKE_TARGET_LABEL || "").trim();
const roomId = String(process.env.HABBPY_V4_GARDENING_SMOKE_ROOM_ID || "").trim();
const waitAfterLoadMs = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_WAIT_AFTER_LOAD_MS, 45000);
const waitAfterRoomMs = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_WAIT_AFTER_ROOM_MS, 12000);
const targetTimeoutMs = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_TARGET_TIMEOUT_MS, 90000);
const roomTimeoutMs = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_ROOM_TIMEOUT_MS, 90000);
const panelTimeoutMs = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_PANEL_TIMEOUT_MS, 60000);
const packetTimeoutMs = positiveInt(process.env.HABBPY_V4_GARDENING_SMOKE_PACKET_TIMEOUT_MS, 45000);
const visibleClientIds = Array.from({ length: accountCount }, (_entry, index) => index + 2);

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
  if (!roomId) {
    throw new Error("Set HABBPY_V4_GARDENING_SMOKE_ROOM_ID to a private room flat id before running Gardening smoke.");
  }

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
  offscreenBounds = await app.evaluate(({ BrowserWindow }) => {
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
  await page.waitForTimeout(5500);

  await runConsoleCommand(page, `load ${quoteArg(accountFile)} ${accountCount} --concurrency ${concurrency}`);
  await waitForAnyLoadedVisibleWebview(page, 90000);
  await page.waitForTimeout(waitAfterLoadMs);

  const target = await waitForTargetClient(page, targetLabel, visibleClientIds, targetTimeoutMs);
  await runConsoleCommand(page, `@${target.clientId} enterroom ${roomId}`);
  await waitForClientRoom(page, target.clientId, roomId, roomTimeoutMs);
  await closeConsole(page);
  await selectClient(page, target.clientId);
  await page.waitForTimeout(waitAfterRoomMs);

  await openPlugin(page, "Gardening");
  await page.locator('section.plugin-panel[aria-label="Gardening panel"]').waitFor({ state: "visible", timeout: panelTimeoutMs });
  await tryRefreshGardeningPanel(page);
  await page.waitForTimeout(3000);

  const beforeFacts = await gardeningPanelFacts(page);
  screenshots.push(await capturePage(page, `gardening-before-client${target.clientId}`));
  await waitForStartGardeningEnabled(page, panelTimeoutMs);

  const baselineRelay = await relaySnapshot(page);
  const baselineLine = maxLineForClient(baselineRelay, target.clientId);
  await page.locator('section.plugin-panel[aria-label="Gardening panel"]').getByRole("button", { name: "Start Gardening" }).click();
  await page.waitForTimeout(1200);
  const afterClickFacts = await gardeningPanelFacts(page);
  screenshots.push(await capturePage(page, `gardening-after-start-client${target.clientId}`));

  const packetProof = await waitForGardeningPackets(page, target.clientId, baselineLine, packetTimeoutMs);
  const finalFacts = await gardeningPanelFacts(page);
  screenshots.push(await capturePage(page, `gardening-packets-client${target.clientId}`));

  const finalSessions = await clientSessions(page);
  const finalWebviews = await webviewSummaries(page);
  const roomMatches = roomReadyMatches(finalWebviews.find((entry) => entry.clientId === target.clientId), roomId);
  const startEnabled = beforeFacts.buttons.startGardening?.disabled === false;
  const plantCount = numericFact(beforeFacts.facts.Plants);
  const expectedHeaders = new Set(packetProof.headers);
  const ok =
    roomMatches &&
    startEnabled &&
    plantCount > 0 &&
    expectedHeaders.has(73) &&
    ((expectedHeaders.has(540) && expectedHeaders.has(541)) || expectedHeaders.has(1115)) &&
    consoleMessages.length === 0 &&
    pageErrors.length === 0;

  const report = {
    ok,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-gardening-smoke",
    portableLaunched: false,
    mainWindowMode: "offscreen",
    offscreenBounds,
    accountFile,
    accountCount,
    targetLabel: targetLabel || null,
    target,
    roomId,
    commands: commandLog,
    beforeFacts,
    afterClickFacts,
    finalFacts,
    packetProof,
    finalSessions,
    finalWebviews,
    screenshots,
    consoleMessages,
    pageErrors,
  };
  await writeReport(report);
  console.log(`Gardening smoke report: ${reportPath}`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  const report = {
    ok: false,
    createdAt: new Date().toISOString(),
    kind: "habbpy-v4-gardening-smoke",
    portableLaunched: false,
    mainWindowMode: "offscreen",
    offscreenBounds,
    accountFile,
    accountCount,
    targetLabel: targetLabel || null,
    roomId: roomId || null,
    commands: commandLog,
    screenshots,
    consoleMessages,
    pageErrors,
    finalSessions: page ? await clientSessions(page).catch(() => null) : null,
    finalWebviews: page ? await webviewSummaries(page).catch(() => null) : null,
    error: maskText(error instanceof Error ? error.stack || error.message : String(error)),
  };
  await writeReport(report);
  console.error(`Gardening smoke failed. Report: ${reportPath}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => null);
}

async function runConsoleCommand(page, command) {
  await openConsole(page);
  const input = page.getByLabel("Packet console command");
  await input.fill(command);
  await input.press("Enter");
  const row = {
    command: maskCommand(command),
    at: new Date().toISOString(),
    consoleEntries: [],
  };
  commandLog.push(row);
  await page.waitForTimeout(750);
  row.consoleEntries = await packetConsoleEntries(page).catch(() => []);
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

async function openPlugin(page, name) {
  const button = page.locator(`button.rail-tab[aria-label="${cssAttrValue(name)}"]`);
  await button.waitFor({ state: "visible", timeout: 30000 });
  await button.click();
}

async function tryRefreshGardeningPanel(page) {
  const refresh = page.locator('section.plugin-panel[aria-label="Gardening panel"]').getByRole("button", { name: "Refresh" });
  if (await refresh.isVisible().catch(() => false)) {
    await refresh.click().catch(() => null);
  }
}

async function waitForMountedVisibleWebviews(page, clientIds, timeoutMs) {
  await page.waitForFunction(
    (ids) => ids.every((id) => document.querySelector(`.game-webview-zoom-surface[data-client-id="${id}"] webview`)),
    clientIds,
    { timeout: timeoutMs },
  );
}

async function waitForAnyLoadedVisibleWebview(page, timeoutMs) {
  await page.waitForFunction(
    () => [...document.querySelectorAll(".game-webview-zoom-surface")].some((surface) => Number(surface.getAttribute("data-client-id")) > 1 && surface.querySelector("webview")),
    null,
    { timeout: timeoutMs },
  );
}

async function waitForTargetClient(page, label, clientIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    const sessions = await clientSessions(page).catch(() => null);
    const webviews = await webviewSummaries(page).catch(() => []);
    latest = clientIds.map((clientId) => targetCandidate(clientId, sessions, webviews));
    const match = chooseTarget(latest, label);
    if (match) return match;
    await page.waitForTimeout(2500);
  }
  throw new Error(`No loaded visible target client matched ${label ? `"${maskText(label)}"` : "the loaded account list"}. Candidates: ${JSON.stringify(latest.map(compactCandidate))}`);
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

async function waitForStartGardeningEnabled(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const panel = document.querySelector('section.plugin-panel[aria-label="Gardening panel"]');
      const button = [...(panel?.querySelectorAll("button") ?? [])].find((entry) => entry.textContent?.trim() === "Start Gardening");
      return Boolean(button && !button.disabled);
    },
    null,
    { timeout: timeoutMs },
  );
}

async function waitForGardeningPackets(page, clientId, afterLineNumber, timeoutMs) {
  const wanted = new Set([73, 540, 541, 1115]);
  const deadline = Date.now() + timeoutMs;
  let latestEntries = [];
  let latestSnapshot = null;
  while (Date.now() < deadline) {
    latestSnapshot = await relaySnapshot(page);
    latestEntries = gardeningEntries(latestSnapshot, clientId, afterLineNumber, wanted);
    const headers = new Set(latestEntries.map((entry) => entry.header));
    if (headers.has(73) && ((headers.has(540) && headers.has(541)) || headers.has(1115))) {
      return compactPacketProof(latestSnapshot, latestEntries, afterLineNumber);
    }
    await page.waitForTimeout(1500);
  }
  return compactPacketProof(latestSnapshot, latestEntries, afterLineNumber);
}

async function clientSessions(page) {
  return page.evaluate(() => window.habbpyV4?.getClientSessions?.() ?? null);
}

async function relaySnapshot(page) {
  return page.evaluate(() => window.habbpyV4?.getRelayLogSnapshot?.() ?? null);
}

async function packetConsoleEntries(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".packet-console-output")]
      .slice(-18)
      .map((entry) => ({
        kind: [...entry.classList].find((name) => name !== "packet-console-output") ?? "",
        text: entry.textContent?.trim() ?? "",
      })),
  );
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

async function gardeningPanelFacts(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('section.plugin-panel[aria-label="Gardening panel"]');
    if (!panel) return { visible: false, facts: {}, buttons: {}, rows: [], message: null };
    const facts = {};
    const kvChildren = [...(panel.querySelector(".kv-grid")?.children ?? [])];
    for (let index = 0; index < kvChildren.length; index += 2) {
      const key = kvChildren[index]?.textContent?.trim();
      const value = kvChildren[index + 1]?.textContent?.trim();
      if (key) facts[key] = value ?? "";
    }
    const buttonState = (label) => {
      const button = [...panel.querySelectorAll("button")].find((entry) => entry.textContent?.trim() === label);
      return button ? { visible: true, disabled: button.disabled } : { visible: false, disabled: null };
    };
    const rows = [...panel.querySelectorAll(".mini-section .item-list .item-row:not(.empty)")].slice(0, 16).map((row) => ({
      label: row.querySelector("span")?.textContent?.trim() || "",
      title: row.querySelector("strong")?.textContent?.trim() || "",
      meta: row.querySelector("small")?.textContent?.trim() || "",
      active: row.classList.contains("active"),
    }));
    return {
      visible: true,
      facts,
      buttons: {
        startGardening: buttonState("Start Gardening"),
        compostAll: buttonState("Compost All"),
        stop: buttonState("Stop"),
        refresh: buttonState("Refresh"),
      },
      rows,
      message: panel.querySelector(".runtime-message")?.textContent?.trim() || null,
    };
  });
}

async function capturePage(page, label) {
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "gardening-smoke";
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

function targetCandidate(clientId, sessions, webviews) {
  const session = (sessions?.sessions || []).find((entry) => entry.id === clientId) || null;
  const webview = (webviews || []).find((entry) => entry.clientId === clientId) || null;
  const names = [
    session?.label,
    session?.username,
    webview?.label,
    webview?.summary?.userName,
  ].filter(Boolean).map((entry) => String(entry));
  return {
    clientId,
    label: session?.label ?? webview?.label ?? `client${clientId}`,
    username: session?.username ?? webview?.summary?.userName ?? null,
    status: session?.status ?? null,
    visible: session?.visible ?? null,
    active: webview?.active ?? false,
    hasEngine: webview?.summary?.hasEngine ?? false,
    names,
  };
}

function chooseTarget(candidates, label) {
  const ready = candidates.filter((candidate) => candidate.visible !== false && candidate.status === "running" && candidate.hasEngine);
  if (label) {
    const normalized = normalize(label);
    return (
      ready.find((candidate) => candidate.names.some((name) => normalize(name) === normalized)) ??
      ready.find((candidate) => candidate.names.some((name) => normalize(name).includes(normalized))) ??
      null
    );
  }
  return ready[ready.length - 1] ?? null;
}

function compactCandidate(candidate) {
  return {
    clientId: candidate.clientId,
    label: candidate.label,
    username: candidate.username,
    status: candidate.status,
    hasEngine: candidate.hasEngine,
  };
}

function roomReadyMatches(entry, expectedRoomId) {
  const summary = entry?.summary || {};
  const ready = summary.roomReady === true || summary.roomReady?.ready === true;
  const actualRoomId = String(summary.roomId || summary.roomReady?.roomId || summary.roomReady?.flatId || "");
  return ready && actualRoomId === String(expectedRoomId);
}

function gardeningEntries(snapshot, clientId, afterLineNumber, wanted) {
  return (snapshot?.entries || [])
    .filter(
      (entry) =>
        entry.clientId === clientId &&
        entry.direction === "CLIENT" &&
        wanted.has(entry.header) &&
        Number(entry.lineNumber || 0) > afterLineNumber,
    )
    .map((entry) => ({
      lineNumber: entry.lineNumber,
      clientId: entry.clientId,
      clientLabel: entry.clientLabel,
      direction: entry.direction,
      header: entry.header,
      packetName: entry.packetName,
      bodyStatus: entry.bodyStatus,
      bodyNote: entry.bodyNote,
      decodedFields: entry.decodedFields,
      message: entry.message,
    }));
}

function compactPacketProof(snapshot, entries, afterLineNumber) {
  const headers = [...new Set(entries.map((entry) => entry.header).filter((entry) => entry !== null))].sort((left, right) => left - right);
  return {
    afterLineNumber,
    logPath: snapshot?.logPath ?? null,
    totalLines: snapshot?.totalLines ?? null,
    packetCount: snapshot?.packetCount ?? null,
    headers,
    entries,
  };
}

function maxLineForClient(snapshot, clientId) {
  return Math.max(
    0,
    ...(snapshot?.entries || [])
      .filter((entry) => entry.clientId === clientId)
      .map((entry) => Number(entry.lineNumber || 0)),
  );
}

function numericFact(value) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d-]+/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
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

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function maskCommand(command) {
  return maskText(String(command ?? "").replace(/(login\s+)\S+:\S+/i, "$1[credentials]"));
}

function maskText(text) {
  return String(text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(password|token|webhook|secret)=\S+/gi, "$1=[redacted]");
}
