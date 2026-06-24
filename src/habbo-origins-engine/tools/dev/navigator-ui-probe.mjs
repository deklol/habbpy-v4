// Navigator UI parity probe.
// Logs in through source events, routes to hotel view, captures the public
// navigator and Rooms tab, and dumps source window/resolved sprite state.
//
//   node tools/dev/navigator-ui-probe.mjs [url] [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://127.0.0.1:5311/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const outDir = process.argv[3] ?? "tmp/navigator-ui-probe";
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

async function captureCanvas(page, name) {
  const dataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  return writeDataUrl(join(outDir, `${name}.png`), dataUrl);
}

async function closeBulletin(page) {
  return page.evaluate(async () => {
    const results = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
      if (!close) break;
      results.push(window.__engine.dev.clickSprite(close.n) ? `clicked ${close.n}` : `failed ${close.n}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return results;
  });
}

async function waitForNavigator(page, timeoutMs = 60000) {
  await page.waitForFunction(
    () => window.__engine?.dev?.windowIds?.().includes("Hotel Navigator"),
    null,
    { timeout: timeoutMs },
  );
}

async function dumpState(page, label) {
  const state = await page.evaluate((label) => {
    const windowState = window.__engine.dev.windowElements("Hotel Navigator", false);
    return {
      label,
      frame: window.__engine.frame?.() ?? null,
      errors: window.__engine.errors?.() ?? null,
      windowIds: window.__engine.dev.windowIds?.() ?? [],
      navigatorWindow: windowState,
      navigatorSprites: window.__engine.dev.resolvedSprites?.("nav", false) ?? [],
      textSprites: window.__engine.dev.resolvedSprites?.("text", false) ?? [],
      hitSamples: {
        topLeft: window.__engine.dev.hitSprites?.(600, 40) ?? [],
        roomList: window.__engine.dev.hitSprites?.(700, 175) ?? [],
        infoPane: window.__engine.dev.hitSprites?.(720, 390) ?? [],
      },
    };
  }, label);
  writeFileSync(join(outDir, `${label}.json`), JSON.stringify(state, null, 2));
  return state;
}

const browser = await chromium.launch();
const consoleLines = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 980, height: 620 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, { timeout: 120000 });
  await page.evaluate(({ email, password }) => window.__engine.dev.login(email, password, 10), { email, password });
  await page.evaluate(() => window.__engine.dev.waitForRoomReady(120000));
  await sleep(2500);
  await closeBulletin(page);

  const hotelResult = await page.evaluate(() => window.__engine.dev.showHotelView());
  await waitForNavigator(page);
  await sleep(1500);
  await closeBulletin(page);
  await sleep(500);

  await captureCanvas(page, "navigator-public");
  const publicState = await dumpState(page, "navigator-public");

  const privateClick = await page.evaluate(() => window.__engine.dev.clickWindowElement("Hotel Navigator", "nav_tb_guestRooms"));
  await sleep(1500);
  await captureCanvas(page, "navigator-rooms");
  const roomsState = await dumpState(page, "navigator-rooms");

  const result = {
    url,
    hotelResult,
    privateClick,
    publicWindowElements: publicState.navigatorWindow?.elements?.length ?? null,
    roomsWindowElements: roomsState.navigatorWindow?.elements?.length ?? null,
  };
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) {
    try {
      await captureCanvas(page, "failure");
    } catch {
      // Best-effort capture only.
    }
  }
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  throw error;
} finally {
  await browser.close();
}
