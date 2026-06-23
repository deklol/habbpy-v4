// Private-room resolved sprite diagnostic.
// Logs in through window.__engine.dev, waits for a usable room, closes the
// Bulletin Board, then exports the renderer-facing channel state plus the
// owning source window element, when a sprite belongs to a source window.
//
//   node tools/dev/resolved-sprite-state-probe.mjs [url] [outDir] [query]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://127.0.0.1:5311/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const outDir = process.argv[3] ?? "tmp/resolved-sprite-state";
const query = process.argv[4] ?? "room";
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeDataUrl(filePath, dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  writeFileSync(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
  return filePath;
}

async function waitForUsableRoom(page, timeoutMs = 120000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeoutMs) {
    state = await page.evaluate(() => {
      const ready = window.__engine?.dev?.roomReady?.() ?? {};
      const objectIds = window.__engine?.objectIds?.() ?? [];
      const sprites = window.__engine?.activeSprites?.() ?? [];
      return {
        ready: Boolean(ready.ready),
        route: ready.route ?? "unknown",
        hasRoomVisualizer: objectIds.includes("Room_visualizer"),
        roomSpriteCount: sprites.filter((sprite) => {
          const member = String(sprite.member ?? "").toLowerCase();
          const id = String(sprite.id ?? "").toLowerCase();
          return id.includes("room") || id.includes("obj") || id.includes("user") || member.includes("floor") || member.includes("wall");
        }).length,
      };
    });
    if (state.ready || (state.hasRoomVisualizer && state.roomSpriteCount > 10)) return state;
    await sleep(250);
  }
  throw new Error(`room not ready: ${JSON.stringify(state)}`);
}

async function closeBulletin(page) {
  return page.evaluate(async () => {
    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
      if (!close) break;
      results.push(window.__engine.dev.clickSprite(close.n) ? `clicked ${close.n}` : `failed ${close.n}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return results;
  });
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
  const roomState = await waitForUsableRoom(page);
  await page.waitForTimeout(3500);
  const closeBulletinResult = await closeBulletin(page);
  await page.waitForTimeout(1000);

  const state = await page.evaluate((query) => {
    const resolved =
      window.__engine.dev?.resolvedSprites?.(query, false) ?? window.__engine.resolvedSprites?.(query, false) ?? [];
    const roomWindows = Object.fromEntries(
      ["Room_info", "Room_info_stand", "Room_interface", "Room_bar"].map((id) => [
        id,
        window.__engine.dev?.windowElements?.(id, false) ?? window.__engine.windowElements?.(id, false) ?? null,
      ]),
    );
    return {
      query,
      frame: window.__engine.frame?.() ?? null,
      errors: window.__engine.errors?.() ?? null,
      roomReady: window.__engine.dev?.roomReady?.() ?? null,
      rollover: window.__engine.rollover?.() ?? null,
      resolved,
      roomWindows,
    };
  }, query);
  const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  writeDataUrl(join(outDir, "canvas.png"), canvasDataUrl);
  writeFileSync(join(outDir, "state.json"), JSON.stringify({ url, roomState, closeBulletinResult, ...state }, null, 2));
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  console.log(`wrote ${join(outDir, "state.json")}`);
  console.table(
    state.resolved.slice(0, 20).map((sprite) => ({
      n: sprite.n,
      member: sprite.member?.name ?? sprite.member,
      path: sprite.render?.path,
      owners: Array.isArray(sprite.sourceWindowOwners) ? sprite.sourceWindowOwners.length : 0,
      rect: Array.isArray(sprite.rect) ? sprite.rect.join(",") : "",
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
