// Source-level private-room text diagnostic.
// Logs in through the dev API, closes Bulletin Board, selects real room
// targets through normal Director pointer events, then exports the baked
// per-element images used by Room_info, Room_info_stand, Room_interface, and
// Room_bar. This avoids reading the shared "visual window text" member after
// later Text Wrapper renders have already reused it.
//
//   node tools/dev/private-room-text-focus-probe.mjs [url] [outDir] [settleMs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://127.0.0.1:5311/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const outDir = process.argv[3] ?? "tmp/private-room-text-focus";
const settleMs = Number(process.argv[4] ?? 5000);
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
    .slice(0, 96);
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
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
      if (!close) break;
      results.push(window.__engine.dev.clickSprite(close.n) ? `clicked ${close.n}` : `failed ${close.n}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return results;
  });
}

async function waitForUsableRoom(page, timeoutMs = 120000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeoutMs) {
    state = await page.evaluate(() => {
      const objectIds = window.__engine.objectIds?.() ?? [];
      const sprites = window.__engine.activeSprites?.() ?? [];
      const roomSprites = sprites.filter((sprite) => {
        const member = String(sprite.member ?? "").toLowerCase();
        const id = String(sprite.id ?? "").toLowerCase();
        return id.includes("room") || id.includes("obj") || id.includes("user") || member.includes("floor") || member.includes("wall");
      });
      return {
        hasRoomVisualizer: objectIds.includes("Room_visualizer"),
        roomSpriteCount: roomSprites.length,
      };
    });
    if (state.hasRoomVisualizer && state.roomSpriteCount > 10) return state;
    await sleep(250);
  }
  throw new Error(`room not ready: ${JSON.stringify(state)}`);
}

async function canvasScreenshot(page, fileName) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return canvas?.toDataURL("image/png") ?? null;
  });
  return writeDataUrl(join(outDir, fileName), dataUrl);
}

async function collectTextState(page, label) {
  const raw = await page.evaluate((label) => {
    const windows = {};
    for (const id of ["Room_info", "Room_info_stand", "Room_interface", "Room_bar"]) {
      windows[id] = window.__engine.windowElements?.(id, true) ?? null;
    }
    const textElements = {};
    for (const [windowId, win] of Object.entries(windows)) {
      const elements = Array.isArray(win?.elements) ? win.elements : [];
      textElements[windowId] = elements
        .filter((element) => {
          const haystack = `${element.id ?? ""} ${element.class ?? ""} ${element.type ?? ""}`;
          return /text|name|owner|desc|info|room_obj_disp|tooltip|chat_field/i.test(haystack);
        })
        .map((element) => ({
          id: element.id,
          class: element.class,
          type: element.type,
          visible: element.visible,
          loc: element.loc,
          own: element.own,
          size: element.size,
          rect: element.rect,
          fontData: element.fontData,
          image: element.image,
          member: element.member,
          textMember: element.textMember,
          sprite: element.sprite,
        }));
    }
    return {
      label,
      errors: window.__engine.errors?.() ?? null,
      rollover: window.__engine.rollover?.() ?? null,
      roomInterface: window.__engine.objectProps?.("#room_interface") ?? null,
      windows,
      textElements,
      activeSprites: window.__engine.activeSprites?.() ?? null,
    };
  }, label);
  const files = [];
  const stripped = stripImages(raw, label, files);
  await canvasScreenshot(page, `${safeName(label)}-canvas.png`);
  return { ...stripped, imageFiles: files };
}

let browser;
let page;
const consoleLines = [];
try {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1120, height: 660 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, { timeout: 120000 });
  await page.evaluate(({ email, password }) => window.__engine.dev.login(email, password, 10), { email, password });
  await waitForUsableRoom(page);
  await page.waitForTimeout(settleMs);
  const closeBulletinResult = await closeBulletin(page);
  await page.waitForTimeout(1000);

  const targets = await page.evaluate(() => {
    const roomObjects = window.__engine.roomObjects?.() ?? { users: [], active: [], items: [] };
    const candidates = [];
    const spriteOf = (object) => {
      const raw = Array.isArray(object?.sprites)
        ? object.sprites
        : Array.isArray(object?.sprites?.items)
          ? object.sprites.items
          : Array.isArray(object?.sprites?.entries)
            ? object.sprites.entries.map((entry) => entry.value)
            : [];
      return raw.find((sprite) => sprite.size?.[0] > 8 && sprite.size?.[1] > 8) ?? raw[0] ?? null;
    };
    for (const [kind, list] of [
      ["user", roomObjects.users ?? []],
      ["active", roomObjects.active ?? []],
      ["item", roomObjects.items ?? []],
    ]) {
      for (const object of list) {
        const sprite = spriteOf(object);
        if (!sprite) continue;
        const debug = window.__engine.spriteDebug(sprite.n);
        if (!debug?.rect) continue;
        candidates.push({
          id: `${kind}-${object.class ?? object.id}`,
          kind,
          objectId: object.id,
          class: object.class,
          sprite: sprite.n,
          member: sprite.member,
          x: Math.floor((debug.rect[0] + debug.rect[2]) / 2),
          y: Math.floor((debug.rect[1] + debug.rect[3]) / 2),
        });
      }
    }
    const prefer = (pattern) => candidates.find((target) => pattern.test(`${target.kind} ${target.class} ${target.member}`));
    return [
      prefer(/^user\b/i),
      prefer(/^active\b.*(machine|cola|fridge|throne|trophy|lamp|table|chair)/i),
      prefer(/^item\b/i),
    ].filter(Boolean);
  });

  const states = [
    {
      route: "initial",
      closeBulletin: closeBulletinResult,
      ...(await collectTextState(page, "initial-room")),
    },
  ];

  for (const target of targets) {
    await page.evaluate((target) => window.__engine.dev.stageClick(target.x, target.y), target);
    await page.waitForTimeout(1200);
    states.push({
      route: "stage-click",
      target,
      hitStack: await page.evaluate((target) => window.__engine.hitSprites(target.x, target.y), target),
      ...(await collectTextState(page, `selected-${target.id}`)),
    });
  }

  const result = { url, settleMs, targets, states };
  writeFileSync(join(outDir, "state.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  console.table(
    states.map((state) => ({
      label: state.label,
      route: state.route,
      target: state.target?.id ?? "",
      errors: Array.isArray(state.errors) ? state.errors.length : state.errors,
      files: state.imageFiles?.length ?? 0,
    })),
  );
} catch (error) {
  if (page) {
    try {
      await canvasScreenshot(page, "failure-canvas.png");
      writeFileSync(join(outDir, "failure-page.log"), await page.evaluate(() => document.getElementById("log")?.innerText ?? ""));
    } catch (captureError) {
      writeFileSync(join(outDir, "capture-error.log"), String(captureError));
    }
  }
  throw error;
} finally {
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  if (browser) await browser.close();
}
