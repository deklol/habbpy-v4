// Source-level room selection diagnostic.
// Logs in through the dev API, waits for a private room, closes the Bulletin
// Board if present, calls Room Interface eventProcUserObj for the requested
// user id, then captures selection/infostand state and a screenshot.
// The source Room Interface thread is keyed as #room_interface; the window can
// later exist as the exact string Room_interface, so capture both.
//
//   node tools/dev/selection-probe.mjs [url] [outPrefix] [userId] [settleMs]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const prefix = process.argv[3] ?? "tmp/selection";
const userId = process.argv[4] ?? "0";
const settleMs = Number(process.argv[5] ?? 25000);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;
const scrollMemberNames = [
  "scrollbarv1.element",
  "button.scroll.up.active",
  "button.scroll.down.active",
  "scrollbar.vertical.active",
  "button.scroll.lift.active",
  "button.scroll.up.pressed",
  "button.scroll.down.pressed",
  "scrollbar.vertical.pressed",
  "button.scroll.lift.pressed",
  "button.scroll.up.passive",
  "button.scroll.down.passive",
  "scrollbar.vertical.passive",
  "button.scroll.lift.passive",
];
const bulletinImageNames = [
  "Bulletin Board_shadow",
  "Bulletin Board_back",
  "Bulletin Board_drag",
  "Bulletin Board_close",
  "Bulletin Board_bulletin_background",
  "Bulletin Board_calendar",
  "Bulletin Board_events",
  "Bulletin Board_articles",
  "Bulletin Board_events_scroll",
  "Bulletin Board_articles_scroll",
  "Bulletin Board_server_clock",
  "bulletin_background",
  "bulletin_article_background",
  "button.scroll.up.active",
  "button.scroll.down.active",
  "scrollbar.vertical.active",
  "button.scroll.lift.active",
];

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });

const consoleLines = [];
let browser;
let page;
try {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1120, height: 660 } });
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

  const bulletinBeforeClose = await page.evaluate((names) => ({
    window: window.__engine.objectProps("Bulletin Board"),
    scrollMembers: Object.fromEntries(
      names.map((name) => {
        try {
          return [name, window.__engine.objectMethod("#resource_manager", "getmemnum", [name])];
        } catch (error) {
          return [name, String(error?.message ?? error)];
        }
      }),
    ),
    sprites: window.__engine
      .activeSprites()
      .filter((sprite) => /Bulletin Board/i.test(sprite.member))
      .map((sprite) => window.__engine.spriteDebug(sprite.n)),
  }), scrollMemberNames);
  const bulletinImages = await page.evaluate((names) => {
    const result = {};
    for (const name of names) {
      result[name] = window.__engine.memberImageData?.(name) ?? window.__engine.findMember?.(name)?.imageData ?? null;
    }
    return result;
  }, bulletinImageNames);
  for (const [name, dataUrl] of Object.entries(bulletinImages)) {
    if (!dataUrl) continue;
    const safe = name.replace(/[^\w.-]/g, "_");
    writeFileSync(`${prefix}-${safe}.png`, Buffer.from(dataUrl.split(",")[1], "base64"));
  }
  await page.screenshot({ path: `${prefix}-bulletin.png`, timeout: 60000 });
  const closeResult = await page.evaluate(() => {
    const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
    if (!close) return "no bulletin close sprite";
    return window.__engine.dev.clickSprite(close.n) ? `clicked sprite ${close.n}` : "click failed";
  });
  await page.waitForTimeout(1500);
  const bulletinAfterClose = await page.evaluate(() => ({
    window: window.__engine.objectProps("Bulletin Board"),
    sprites: window.__engine
      .activeSprites()
      .filter((sprite) => /Bulletin Board/i.test(sprite.member))
      .map((sprite) => window.__engine.spriteDebug(sprite.n)),
  }));

  const state = await page.evaluate((userId) => {
    const result = {
      closeResult: null,
      bulletinBeforeClose: null,
      bulletinAfterClose: null,
      directError: null,
      directResult: null,
      roomInterfaceThreadBefore: window.__engine.objectProps("#room_interface"),
      roomInterfaceWindowBefore: window.__engine.objectProps("Room_interface"),
      roomObjectsBefore: window.__engine.roomObjects?.() ?? null,
      roomInterfaceThreadAfter: null,
      roomInterfaceWindowAfter: null,
      roomInfoStandAfter: null,
      roomBadgeAfter: null,
      roomObjectsAfter: null,
      largeSprites: null,
      hitStacks: {},
    };
    try {
      result.directResult = window.__engine.objectMethod("#room_interface", "eventProcUserObj", [
        "mouseDown",
        userId,
      ]);
    } catch (error) {
      result.directError = String(error?.message ?? error);
    }
    result.roomInterfaceThreadAfter = window.__engine.objectProps("#room_interface");
    result.roomInterfaceWindowAfter = window.__engine.objectProps("Room_interface");
    result.roomInfoStandAfter = window.__engine.objectProps("Room_info_stand");
    result.roomBadgeAfter = window.__engine.objectProps("Room_badge");
    result.roomObjectsAfter = window.__engine.roomObjects?.() ?? null;
    result.largeSprites = window.__engine
      .activeSprites()
      .filter((sprite) => sprite.size?.[0] >= 250 && sprite.size?.[1] >= 150)
      .map((sprite) => window.__engine.spriteDebug(sprite.n));
    for (const point of [
      [420, 260],
      [480, 320],
      [760, 515],
    ]) {
      result.hitStacks[point.join(",")] = window.__engine.hitSprites(point[0], point[1]);
    }
    return result;
  }, userId);
  state.closeResult = closeResult;
  state.bulletinBeforeClose = bulletinBeforeClose;
  state.bulletinAfterClose = bulletinAfterClose;

  writeFileSync(`${prefix}-state.json`, JSON.stringify(state, null, 2));
  const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
  writeFileSync(`${prefix}-page.log`, pageLog);
  await page.screenshot({ path: `${prefix}-room.png`, timeout: 60000 });

  console.log(`bulletin: ${closeResult}`);
  console.log(`direct error: ${state.directError ?? "none"}`);
  console.log(`captured ${prefix}-state.json and ${prefix}-room.png`);
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
