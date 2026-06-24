// Source-level Room_bar dropdown diagnostic.
// Logs in through the dev API, waits for the generated room bar window, then
// exports the Say/Whisper/Shout dropdown buffer and related sprite state.
//
//   node tools/dev/room-bar-dropdown-probe.mjs [url] [outDir] [settleMs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://127.0.0.1:5311/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const outDir = process.argv[3] ?? "tmp/room-bar-dropdown-probe";
const settleMs = Number(process.argv[4] ?? 2500);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeName(value) {
  return String(value ?? "unknown")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function writeDataUrl(filePath, dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  writeFileSync(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
  return filePath;
}

function stripImages(value, prefix, files) {
  if (Array.isArray(value)) {
    return value.map((entry, index) => stripImages(entry, `${prefix}-${index}`, files));
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "dataUrl" && typeof entry === "string") {
      const path = join(outDir, `${safeName(prefix)}.png`);
      const written = writeDataUrl(path, entry);
      if (written) files.push(written);
      out.path = written;
      continue;
    }
    out[key] = stripImages(entry, `${prefix}-${key}`, files);
  }
  return out;
}

async function closeBulletin(page) {
  return page.evaluate(async () => {
    const results = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
      if (!close) break;
      results.push(window.__engine.dev.clickSprite(close.n) ? `clicked ${close.n}` : `failed ${close.n}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return results;
  });
}

async function waitForRoomBar(page, timeoutMs = 120000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeoutMs) {
    state = await page.evaluate(() => {
      const roomReady = window.__engine.dev?.roomReady?.() ?? {};
      const objectIds = window.__engine.objectIds?.() ?? [];
      const windowIds = window.__engine.dev?.windowIds?.() ?? [];
      const roomBar =
        window.__engine.dev?.windowElements?.("Room_bar", false) ??
        window.__engine.windowElements?.("Room_bar", false) ??
        null;
      const roomBarId =
        window.__engine.dev?.windowElements?.("RoomBarID", false) ??
        window.__engine.windowElements?.("RoomBarID", false) ??
        null;
      return {
        roomReady,
        hasRoomVisualizer: objectIds.includes("Room_visualizer"),
        windowIds,
        hasRoomBar: !roomBar?.error,
        hasRoomBarId: !roomBarId?.error,
      };
    });
    if (state.hasRoomBar || state.hasRoomBarId) return state;
    await sleep(250);
  }
  throw new Error(`room bar not ready: ${JSON.stringify(state)}`);
}

const browser = await chromium.launch();
const consoleLines = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1120, height: 660 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, { timeout: 120000 });
  await page.evaluate(({ email, password }) => window.__engine.dev.login(email, password, 10), { email, password });
  const ready = await waitForRoomBar(page);
  await page.waitForTimeout(settleMs);
  const closeBulletinResult = await closeBulletin(page);
  await page.waitForTimeout(1000);

  const raw = await page.evaluate(() => {
    const windows = Object.fromEntries(
      ["Room_bar", "RoomBarID"].map((id) => [
        id,
        window.__engine.dev?.windowElements?.(id, true) ?? window.__engine.windowElements?.(id, true) ?? null,
      ]),
    );
    const allElements = Object.entries(windows).flatMap(([windowId, win]) =>
      Array.isArray(win?.elements) ? win.elements.map((element) => ({ windowId, element })) : [],
    );
    const dropdownElements = allElements
      .filter(({ element }) => /speechmode|drop/i.test(`${element.id ?? ""} ${element.class ?? ""} ${element.type ?? ""}`))
      .map(({ windowId, element }) => ({ windowId, ...element }));
    const activeSprites = window.__engine.activeSprites?.() ?? [];
    const toolbarSprites = activeSprites.filter((sprite) =>
      /speech|drop|Room_bar|RoomBarID|chat_field|alapalkki|controller|hand|nav|brochure|purse/i.test(
        `${sprite.id ?? ""} ${sprite.member ?? ""}`,
      ),
    );
    const roomObjects = window.__engine.roomObjects?.() ?? { users: [], active: [], items: [] };
    const colouredRoomSprites = activeSprites.filter((sprite) =>
      /door|mat|rug|throne|chair|sofa|table|lamp|pillow|trophy|pumpkin|plant|doormat/i.test(`${sprite.id ?? ""} ${sprite.member ?? ""}`),
    );
    return {
      errors: window.__engine.errors?.() ?? null,
      roomReady: window.__engine.dev?.roomReady?.() ?? null,
      objectIds: window.__engine.objectIds?.() ?? null,
      windowIds: window.__engine.dev?.windowIds?.() ?? [],
      windows,
      dropdownElements,
      toolbarSprites,
      roomObjects,
      colouredRoomSprites,
    };
  });

  const files = [];
  const stripped = stripImages(raw, "room-bar-dropdown", files);
  const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  writeDataUrl(join(outDir, "canvas.png"), canvasDataUrl);
  writeFileSync(join(outDir, "state.json"), JSON.stringify({ url, ready, closeBulletinResult, ...stripped, imageFiles: files }, null, 2));
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  console.log(`wrote ${join(outDir, "state.json")}`);
  console.table(
    stripped.dropdownElements.map((element) => ({
      window: element.windowId,
      id: element.id,
      class: element.class,
      loc: Array.isArray(element.loc) ? element.loc.join(",") : "",
      size: Array.isArray(element.size) ? element.size.join(",") : "",
      sprite: element.sprite?.n ?? "",
      buffer: element.buffer?.name ?? "",
      image: element.presentedImage?.path ?? "",
    })),
  );
} catch (error) {
  if (page) {
    try {
      const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
      writeDataUrl(join(outDir, "failure-canvas.png"), canvasDataUrl);
    } catch {
      // Best-effort diagnostic capture.
    }
  }
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  throw error;
} finally {
  await browser.close();
}
