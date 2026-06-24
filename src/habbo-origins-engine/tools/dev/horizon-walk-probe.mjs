// Horizon/private-room walking diagnostic.
// Logs in through the source UI, waits for the room, records Room_geometry,
// derives several screen points from the source geometry object, clicks those
// points through normal Director pointer events, then records user movement.
//
//   node tools/dev/horizon-walk-probe.mjs [url] [outPrefix] [settleMs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5313/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const prefix = process.argv[3] ?? "tmp/horizon-walk/horizon-walk";
const settleMs = Number(process.argv[4] ?? 18000);
const flatId = process.env.HABBO_HORIZON_FLAT_ID ?? process.argv[5] ?? "225622";
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync(dirname(prefix), { recursive: true });

const consoleLines = [];
const failedRequests = [];

function decodeCanvasDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

function summarizedListItems(value) {
  if (Array.isArray(value)) return value;
  if (value && value.type === "list" && Array.isArray(value.items)) return value.items;
  return null;
}

async function closeBulletin(page) {
  return page.evaluate(() => {
    const close = window.__engine
      ?.activeSprites?.()
      ?.find((sprite) => /Bulletin Board_close/i.test(sprite.member));
    if (!close) return "no bulletin close sprite";
    return window.__engine.dev.clickSprite(close.n) ? `clicked ${close.n}` : "click failed";
  });
}

async function snapshot(page, label) {
  return page.evaluate((label) => {
    const roomObjects = window.__engine.roomObjects?.() ?? { users: [], active: [], items: [] };
    const user = roomObjects.users?.find((entry) => /dek/i.test(String(entry.name ?? ""))) ?? roomObjects.users?.[0] ?? null;
    const geometry = window.__engine.objectProps?.("Room_geometry") ?? null;
    const roomInterface = window.__engine.objectProps?.("#room_interface") ?? null;
    const roomComponent = window.__engine.objectProps?.("#room_component") ?? null;
    const visualizer = window.__engine.visualizer?.("Room_visualizer") ?? null;
    const sprites = window.__engine.activeSprites?.() ?? [];
    const listItems = (value) => {
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.items)) return value.items;
      if (value && Array.isArray(value.entries)) return value.entries.map((entry) => entry.value);
      return [];
    };
    const horizonSprites = sprites.filter((sprite) =>
      [
        sprite.member,
        sprite.id,
      ].join(" ").match(/hrz_|horizon|exterior|mainfloor|landscape|foreground|above|hiliter/i)
    );
    const userSprites = listItems(user?.sprites).map((sprite) => {
      const debug = window.__engine.spriteDebug?.(sprite.n) ?? null;
      return { ...sprite, rect: debug?.rect ?? null };
    }) ?? [];
    const geometryTiles = [];
    for (const tile of [
      [7, 9, 0],
      [8, 8, 0],
      [11, 10, 0],
      [13, 9, 0],
      [16, 6, 0],
      [10, 20, 7],
    ]) {
      const screen = window.__engine.objectMethod?.("Room_geometry", "getScreenCoordinate", tile) ?? null;
      geometryTiles.push({ tile, screen });
    }
    const candidatePoints = [];
    for (const entry of geometryTiles) {
      const items = Array.isArray(entry.screen)
        ? entry.screen
        : entry.screen?.type === "list" && Array.isArray(entry.screen.items)
          ? entry.screen.items
          : null;
      if (items && items.length >= 2) {
        candidatePoints.push({
          id: `tile-${entry.tile.join("-")}`,
          tile: entry.tile,
          x: Number(items[0]),
          y: Number(items[1]),
        });
      }
    }
    for (const point of [
      { id: "screen-center", x: 480, y: 270 },
      { id: "screen-horizon-floor-a", x: 570, y: 235 },
      { id: "screen-horizon-floor-b", x: 730, y: 205 },
      { id: "screen-horizon-floor-c", x: 400, y: 330 },
    ]) {
      candidatePoints.push(point);
    }
    const hitProbes = Object.fromEntries(
      candidatePoints.map((point) => [
        point.id,
        {
          point,
          world: window.__engine.objectMethod?.("Room_geometry", "getWorldCoordinate", [point.x, point.y]) ?? null,
          hits: window.__engine.hitSprites?.(point.x, point.y) ?? [],
          probe: window.__engine.hitProbe?.(point.x, point.y) ?? null,
        },
      ]),
    );
    return {
      label,
      frame: window.__engine.frame?.() ?? null,
      errors: window.__engine.errors?.() ?? null,
      roomReady: window.__engine.dev?.roomReady?.() ?? null,
      rollover: window.__engine.rollover?.() ?? null,
      geometry,
      roomInterface,
      roomComponent,
      visualizer,
      roomObjects,
      user,
      userSprites,
      geometryTiles,
      horizonSprites,
      candidatePoints,
      hitProbes,
      pageLogTail: (document.getElementById("log")?.innerText ?? "").split("\n").slice(-80),
    };
  }, label);
}

let browser;
let page;
try {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? "",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedRequests.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        statusText: response.statusText(),
      });
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, { timeout: 120000 });
  await page.evaluate(({ email, password }) => window.__engine.dev.login(email, password, 10), { email, password });
  let initialReady = await page.evaluate(() => window.__engine.dev.waitForRoomReady(120000));
  let enterResult = null;
  if (!initialReady?.hasRoomVisualizer && flatId) {
    enterResult = await page.evaluate(
      ({ flatId }) => window.__engine.dev.enterPrivateRoom(flatId, true, 120000),
      { flatId },
    );
  }
  await page.waitForFunction(() => window.__engine?.objectIds?.().includes("Room_visualizer"), null, {
    timeout: 120000,
    polling: 1000,
  });
  await page.waitForTimeout(settleMs);
  const bulletin = await closeBulletin(page);
  await page.waitForTimeout(1500);

  const before = await snapshot(page, "before");
  const clickResults = [];
  const clicks = before.candidatePoints.filter((point) => point.id.startsWith("tile-")).slice(0, 5);
  if (clicks.length === 0) {
    clicks.push(
      { id: "screen-horizon-floor-a", x: 570, y: 235 },
      { id: "screen-horizon-floor-b", x: 730, y: 205 },
    );
  }

  for (const point of clicks) {
    const preClick = await snapshot(page, `pre-${point.id}`);
    await page.evaluate((point) => window.__engine.dev.stageClick(point.x, point.y), point);
    await page.waitForTimeout(1800);
    const postClick = await snapshot(page, `post-${point.id}`);
    clickResults.push({ point, preClick, postClick });
  }

  const after = await snapshot(page, "after");
  const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
  const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  const state = {
    url,
    flatId,
    initialReady,
    enterResult,
    bulletin,
    failedRequests,
    before,
    clickResults,
    after,
  };
  writeFileSync(`${prefix}-state.json`, JSON.stringify(state, null, 2));
  writeFileSync(`${prefix}-page.log`, pageLog);
  if (canvasDataUrl) writeFileSync(`${prefix}-canvas.png`, decodeCanvasDataUrl(canvasDataUrl));
  await page.screenshot({ path: `${prefix}-page.png`, timeout: 60000 });
  console.log(`captured ${prefix}-state.json`);
} catch (error) {
  if (page) {
    try {
      const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
      writeFileSync(`${prefix}-page.log`, pageLog);
      const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
      if (canvasDataUrl) writeFileSync(`${prefix}-failure-canvas.png`, decodeCanvasDataUrl(canvasDataUrl));
      await page.screenshot({ path: `${prefix}-failure-page.png`, timeout: 15000 });
    } catch (captureError) {
      writeFileSync(`${prefix}-capture-error.log`, String(captureError));
    }
  }
  throw error;
} finally {
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  if (browser) await browser.close();
}
