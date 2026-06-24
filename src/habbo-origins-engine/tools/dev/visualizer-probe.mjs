// Room visualizer diagnostic (docs/NEXT_STEPS.md item: visualizer probe).
// Logs in, waits for Room_visualizer, closes the Bulletin Board if present,
// then dumps wrapper state, VizWrap_* member lookups, and a screenshot.
//
//   node tools/dev/visualizer-probe.mjs [url] [outPrefix]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const prefix = process.argv[3] ?? "tmp/viz";
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

let browser;
let page;
const consoleLines = [];
const failedRequests = [];
try {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1120, height: 660 } });
  page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
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
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: 120000,
  });
  await page.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );
  await page.waitForFunction(() => window.__engine?.objectIds?.().includes("Room_visualizer"), null, {
    timeout: 90000,
    polling: 1000,
  });
  await page.waitForTimeout(20000);

  // Close the Bulletin Board through its own close-control sprite.
  const closed = await page.evaluate(() => {
    const sprites = window.__engine.activeSprites();
    const close = sprites.find((s) => /Bulletin Board_close/i.test(s.member));
    if (!close) return "no bulletin close sprite";
    return window.__engine.dev.clickSprite(close.n) ? `clicked sprite ${close.n}` : "click failed";
  });
  console.log(`bulletin: ${closed}`);
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => {
    const viz = window.__engine.visualizer?.("Room_visualizer") ?? null;
    const sprites = window.__engine.activeSprites();
    const vizWraps = [];
    for (const name of [
      "VizWrap_floor", "VizWrap_wall", "VizWrap_wall01", "VizWrap_floor01",
    ]) {
      vizWraps.push({ name, member: window.__engine.findMember?.(name) ? "FOUND" : null });
    }
    const resourceNames = [
      "model_a Class",
      "model_a.room Class",
      "model_h Class",
      "model_h.room Class",
      "model_horizon Class",
      "model_horizon.room Class",
      "horizon Class",
      "horizon.room Class",
      "wallpattern_patterns",
      "floorpattern_patterns",
      "wallpattern_lively",
      "floorpattern_tiles2",
      "floorpattern_tiles3",
      "leftwall door_a",
      "leftwall door_b",
      "leftwall leftdoor_open",
      "leftwall leftdoor_open_mask",
      "rightwall window_double_default_a_0",
      "leftwall window_double_default_a_0",
      "landscape_bg",
      "landscape_cloud_2_left",
      "controller_icon",
      "controller_icon_sd",
      "mes_dark_icon",
      "mes_lite_icon",
      "mes_ani_1",
      "mes_ani_2",
      "mes_ani_3",
    ];
    return {
      viz,
      vizWrapLookups: vizWraps,
      roomProgram: window.__engine.objectProps?.("Room Program") ?? null,
      roomComponent: window.__engine.objectProps?.("#room_component") ?? null,
      roomBar: window.__engine.objectProps?.("Room_bar") ?? null,
      roomInfoStand: window.__engine.objectProps?.("Room_info_stand") ?? null,
      roomAssetBuffer: window.__engine.roomAssetBuffer?.() ?? null,
      roomObjects: window.__engine.roomObjects?.() ?? null,
      resourceMembers: window.__engine.resourceMembers?.(resourceNames) ?? null,
      memberLookups: Object.fromEntries(resourceNames.map((name) => [name, window.__engine.findMember?.(name) ?? null])),
      variables: window.__engine.variables?.([
        "room.cast.private",
        "room.cast.1",
        "room.cast.2",
        "room.cast.3",
        "room.cast.4",
        "private.room.properties",
        "dynamic.download.name.template",
        "dynamic.download.url",
      ]) ?? null,
      spriteCount: sprites.length,
      sprites,
    };
  });
  writeFileSync(`${prefix}-state.json`, JSON.stringify({ ...state, failedRequests }, null, 2));
  console.log(`visualizer summary: ${JSON.stringify(state.viz).slice(0, 1800)}`);

  const imageNames = [
    "VizWrap_floor01",
    "VizWrap_wall01",
    "VizWrap_wall02",
    "VizWrap_roomShadow",
    "flat_floor_0_a_0_0_0",
    "left_wallpart_0_a_0_0_0",
    "right_wallpart_0_a_0_2_0",
    "Room_bar_int_alapalkki_bg",
    "Room_bar_controller_icon",
    "Room_bar_controller_icon_sd",
    "mes_dark_icon",
    "mes_lite_icon",
    "mes_ani_1",
    "mes_ani_2",
    "mes_ani_3",
    "Room_bar_int_messenger_image",
    "Room_bar_int_nav_image",
    "Room_bar_int_purse_image",
    "Room_bar_int_brochure_image",
    "Room_bar_int_hand_image",
    "Room_bar_int_challenge_image",
    "Room_info_stand_info_stand",
  ];
  const images = await page.evaluate((names) => {
    const result = {};
    for (const name of names) {
      result[name] = window.__engine.memberImageData?.(name) ?? null;
    }
    return result;
  }, imageNames);
  for (const [name, dataUrl] of Object.entries(images)) {
    if (!dataUrl) continue;
    const safe = name.replace(/[^\w.-]/g, "_");
    writeFileSync(`${prefix}-${safe}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
  }

  await page.screenshot({ path: `${prefix}-room.png`, timeout: 60000 });
  const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
  writeFileSync(`${prefix}-page.log`, pageLog);
  console.log(`captured ${prefix}-room.png`);
} catch (error) {
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  if (page) {
    try {
      const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
      writeFileSync(`${prefix}-page.log`, pageLog);
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      writeFileSync(`${prefix}-body.log`, bodyText);
      await page.screenshot({ path: `${prefix}-failure.png`, timeout: 15000 });
    } catch (captureError) {
      writeFileSync(`${prefix}-capture-error.log`, String(captureError));
    }
  }
  throw error;
} finally {
  if (browser) await browser.close();
}
