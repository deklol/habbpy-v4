// Source-level private-room parity diagnostic.
// Logs in through window.__engine.dev, waits for the Room_visualizer, closes
// the Bulletin Board through its source close sprite, captures stage state,
// hit/pixel probes, a screenshot, and an optional browser-canvas image diff.
//
//   node tools/dev/room-parity-probe.mjs [url] [outPrefix] [referencePng] [settleMs]
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const prefix = process.argv[3] ?? "tmp/room-parity";
const referencePath = process.argv[4] ?? "tmp/origins-ref/origins-test-lab-origins.png";
const settleMs = Number(process.argv[5] ?? 25000);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });

const mimeFor = (file) => {
  const ext = extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
};

const dataUrlFor = (file) => {
  const absolute = resolve(file);
  const bytes = readFileSync(absolute);
  return `data:${mimeFor(absolute)};base64,${bytes.toString("base64")}`;
};

async function diffImages(page, actualPath, expectedPath) {
  if (!expectedPath || !existsSync(expectedPath) || !existsSync(actualPath)) return null;
  return page.evaluate(
    async ({ actualUrl, expectedUrl }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`failed to load ${src.slice(0, 32)}`));
          image.src = src;
        });
      const [actual, expected] = await Promise.all([load(actualUrl), load(expectedUrl)]);
      const width = Math.min(actual.width, expected.width);
      const height = Math.min(actual.height, expected.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(expected, 0, 0);
      const expectedPixels = ctx.getImageData(0, 0, width, height).data;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(actual, 0, 0);
      const actualPixels = ctx.getImageData(0, 0, width, height).data;
      let changed = 0;
      let strong = 0;
      let totalDelta = 0;
      const bbox = { left: width, top: height, right: -1, bottom: -1 };
      const samples = [];
      for (let offset = 0; offset < actualPixels.length; offset += 4) {
        const pixel = offset / 4;
        const x = pixel % width;
        const y = (pixel - x) / width;
        const delta =
          Math.abs(actualPixels[offset] - expectedPixels[offset]) +
          Math.abs(actualPixels[offset + 1] - expectedPixels[offset + 1]) +
          Math.abs(actualPixels[offset + 2] - expectedPixels[offset + 2]) +
          Math.abs(actualPixels[offset + 3] - expectedPixels[offset + 3]);
        if (delta <= 12) continue;
        changed += 1;
        totalDelta += delta;
        if (delta > 72) {
          strong += 1;
          bbox.left = Math.min(bbox.left, x);
          bbox.top = Math.min(bbox.top, y);
          bbox.right = Math.max(bbox.right, x);
          bbox.bottom = Math.max(bbox.bottom, y);
          if (samples.length < 20) {
            samples.push({
              x,
              y,
              delta,
              actual: Array.from(actualPixels.slice(offset, offset + 4)),
              expected: Array.from(expectedPixels.slice(offset, offset + 4)),
            });
          }
        }
      }
      return {
        actualSize: [actual.width, actual.height],
        expectedSize: [expected.width, expected.height],
        comparedSize: [width, height],
        changed,
        strong,
        changedRatio: changed / (width * height),
        averageDelta: changed ? totalDelta / changed : 0,
        strongBBox: strong ? [bbox.left, bbox.top, bbox.right, bbox.bottom] : null,
        samples,
      };
    },
    { actualUrl: dataUrlFor(actualPath), expectedUrl: dataUrlFor(expectedPath) },
  );
}

const probePoints = [
  { id: "door-mask", x: 328, y: 194 },
  { id: "door-top", x: 329, y: 110 },
  { id: "avatar-body", x: 492, y: 196 },
  { id: "floor-center", x: 520, y: 300 },
  { id: "toolbar-console", x: 716, y: 516 },
  { id: "say-dropdown", x: 114, y: 514 },
  { id: "infostand-title", x: 100, y: 430 },
];

let browser;
let page;
const consoleLines = [];
try {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: 120000,
  });
  await page.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );
  await page.waitForFunction(() => window.__engine?.objectIds?.().includes("Room_visualizer"), null, {
    timeout: 120000,
    polling: 1000,
  });
  await page.waitForTimeout(settleMs);

  const closeResult = await page.evaluate(() => {
    const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
    if (!close) return "no bulletin close sprite";
    return window.__engine.dev.clickSprite(close.n) ? `clicked sprite ${close.n}` : "click failed";
  });
  await page.waitForTimeout(1500);

  const state = await page.evaluate(({ probePoints, closeResult }) => ({
    closeResult,
    frame: window.__engine.frame?.() ?? null,
    errors: window.__engine.errors?.() ?? null,
    rollover: window.__engine.rollover?.() ?? null,
    roomInterface: window.__engine.objectProps?.("#room_interface") ?? null,
    roomInfoStand: window.__engine.objectProps?.("Room_info_stand") ?? null,
    roomInfoStandWindow: window.__engine.windowElements?.("Room_info_stand") ?? null,
    roomInfoWindow: window.__engine.windowElements?.("Room_info") ?? null,
    roomBarWindow: window.__engine.windowElements?.("Room_bar") ?? null,
    roomInterfaceWindow: window.__engine.windowElements?.("Room_interface") ?? null,
    roomAssetBuffer: window.__engine.roomAssetBuffer?.() ?? null,
    roomObjects: window.__engine.roomObjects?.() ?? null,
    activeSprites: window.__engine.activeSprites?.() ?? null,
    hitProbes: Object.fromEntries(probePoints.map((point) => [point.id, window.__engine.hitProbe?.(point.x, point.y)])),
  }), { probePoints, closeResult });

  const actualPath = `${prefix}.png`;
  await page.screenshot({ path: actualPath, timeout: 60000 });
  state.diff = await diffImages(page, actualPath, referencePath);
  writeFileSync(`${prefix}-state.json`, JSON.stringify(state, null, 2));
  const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
  writeFileSync(`${prefix}-page.log`, pageLog);
  console.log(`captured ${actualPath}`);
  if (state.diff) {
    console.log(`diff changed=${state.diff.changed} strong=${state.diff.strong} bbox=${state.diff.strongBBox}`);
  }
} catch (error) {
  if (page) {
    try {
      const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
      writeFileSync(`${prefix}-page.log`, pageLog);
      await page.screenshot({ path: `${prefix}-failure.png`, timeout: 15000 });
    } catch (captureError) {
      writeFileSync(`${prefix}-capture-error.log`, String(captureError));
    }
  }
  throw error;
} finally {
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  if (browser) await browser.close();
}
