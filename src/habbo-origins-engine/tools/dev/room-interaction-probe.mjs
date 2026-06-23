// Source-level private-room interaction diagnostic.
// Logs in, closes the Bulletin Board, captures hit stacks for representative
// room points, clicks them through normal Director pointer events, and records
// Room Interface / infostand state after each click.
//
//   node tools/dev/room-interaction-probe.mjs [url] [outPrefix] [settleMs]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const prefix = process.argv[3] ?? "tmp/room-interaction";
const settleMs = Number(process.argv[4] ?? 18000);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });

const fixedPoints = [
  { id: "floor-center", x: 520, y: 300 },
  { id: "infostand", x: 230, y: 446 },
  { id: "say-dropdown", x: 280, y: 516 },
];

let browser;
let page;
const consoleLines = [];
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

  await page.evaluate(() => {
    const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
    if (close) window.__engine.dev.clickSprite(close.n);
  });
  await page.waitForTimeout(1500);

  const before = await page.evaluate((fixedPoints) => {
    const roomObjects = window.__engine.roomObjects?.() ?? { users: [], active: [], items: [] };
    const objectTargets = [];
    const firstWithClass = (list, pattern) => list.find((object) => pattern.test(object.class ?? ""));
    const user = roomObjects.users?.[0];
    const fridge = firstWithClass(roomObjects.active ?? [], /^fridge\b/i);
    const trophy = firstWithClass(roomObjects.active ?? [], /^prizetrophy/i);
    const poster = firstWithClass(roomObjects.items ?? [], /^poster\b/i);
    const windowItem = firstWithClass(roomObjects.items ?? [], /^window_/i);
    const door = firstWithClass(roomObjects.active ?? [], /^door_cabin\b/i);
    const spritesOf = (object) => {
      if (Array.isArray(object?.sprites)) return object.sprites;
      if (Array.isArray(object?.sprites?.items)) return object.sprites.items;
      if (Array.isArray(object?.sprites?.entries)) return object.sprites.entries.map((entry) => entry.value);
      return [];
    };
    for (const [id, object] of [
      ["user", user],
      ["active-fridge", fridge],
      ["active-trophy", trophy],
      ["item-poster", poster],
      ["item-window", windowItem],
      ["active-door", door],
    ]) {
      const sprites = spritesOf(object);
      const sprite = sprites.find((entry) => entry.size?.[0] > 1 && entry.size?.[1] > 1) ?? sprites[0];
      if (sprite) objectTargets.push({ id, objectId: object.id, class: object.class, sprite: sprite.n, member: sprite.member });
    }
    const points = [...fixedPoints];
    for (const target of objectTargets) {
      const sprite = window.__engine.spriteDebug(target.sprite);
      if (sprite?.rect) {
        points.push({
          id: target.id,
          objectId: target.objectId,
          class: target.class,
          sprite: target.sprite,
          member: target.member,
          x: Math.floor((sprite.rect[0] + sprite.rect[2]) / 2),
          y: Math.floor((sprite.rect[1] + sprite.rect[3]) / 2),
        });
      }
    }
    return {
      roomInterface: window.__engine.objectProps("#room_interface"),
      roomInfoStand: window.__engine.objectProps("Room_info_stand"),
      roomObjects,
      activeSprites: window.__engine.activeSprites(),
      targets: points,
      hitStacks: Object.fromEntries(points.map((point) => [point.id, window.__engine.hitSprites(point.x, point.y)])),
    };
  }, fixedPoints);

  const clicks = [];
  for (const point of before.targets) {
    await page.evaluate((point) => window.__engine.dev.stageClick(point.x, point.y), point);
    await page.waitForTimeout(900);
    clicks.push(await page.evaluate((point) => ({
      point,
      rollover: window.__engine.rollover?.() ?? null,
      hitStack: window.__engine.hitSprites(point.x, point.y),
      roomInterface: window.__engine.objectProps("#room_interface"),
      roomInfoStand: window.__engine.objectProps("Room_info_stand"),
      roomObjects: window.__engine.roomObjects?.() ?? null,
      pageLogTail: (document.getElementById("log")?.innerText ?? "").split("\n").slice(-30),
    }), point));
  }

  const state = { before, clicks };
  writeFileSync(`${prefix}-state.json`, JSON.stringify(state, null, 2));
  const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
  writeFileSync(`${prefix}-page.log`, pageLog);
  await page.screenshot({ path: `${prefix}.png`, timeout: 60000 });
  console.log(`captured ${prefix}-state.json and ${prefix}.png`);
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
