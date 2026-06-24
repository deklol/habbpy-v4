// Source-level private-room text/desync diagnostic.
// Logs in headlessly, closes Bulletin Board through the source close sprite,
// cycles hotel view -> private room, and records text/window/sprite transform
// state after each cycle.
//
//   node tools/dev/private-room-text-cycle-probe.mjs [url] [outDir] [cycles] [settleMs] [viewportW] [viewportH] [resizeSequence]
//
// resizeSequence is optional comma-separated viewport sizes, for example:
//   1500x760,960x540,1500x760
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5311/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const outDir = process.argv[3] ?? "tmp/private-room-text-cycle";
const cycles = Math.max(1, Number(process.argv[4] ?? 3) | 0);
const settleMs = Math.max(0, Number(process.argv[5] ?? 5000) | 0);
const viewportWidth = Math.max(960, Number(process.argv[6] ?? 1120) | 0);
const viewportHeight = Math.max(540, Number(process.argv[7] ?? 660) | 0);
const resizeSequence = String(process.argv[8] ?? "")
  .split(",")
  .map((entry) => /^(\d+)x(\d+)$/i.exec(entry.trim()))
  .filter(Boolean)
  .map((match) => ({
    width: Math.max(960, Number(match[1]) | 0),
    height: Math.max(540, Number(match[2]) | 0),
  }));
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

async function applyViewportSequence(page, label) {
  const captures = [];
  for (let index = 0; index < resizeSequence.length; index += 1) {
    const size = resizeSequence[index];
    await page.setViewportSize(size);
    await page.waitForTimeout(900);
    const suffix = `${label}-resize-${index + 1}-${size.width}x${size.height}`;
    const imagePath = join(outDir, `${suffix}.png`);
    await page.screenshot({ path: imagePath, timeout: 60000 });
    const canvasPath = join(outDir, `${suffix}-canvas.png`);
    const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
    writeDataUrl(canvasPath, canvasDataUrl);
    captures.push({
      label: suffix,
      viewport: size,
      screenshot: imagePath,
      canvas: canvasPath,
      resize: await page.evaluate(() => window.__engine.resizeEngine?.() ?? null),
    });
  }
  return captures;
}

async function waitForUsableRoom(page, timeoutMs = 120000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeoutMs) {
    state = await page.evaluate(() => {
      const ready = window.__engine.dev.roomReady();
      const objectIds = window.__engine.objectIds?.() ?? [];
      const sprites = window.__engine.activeSprites?.() ?? [];
      const roomSprites = sprites.filter((sprite) => {
        const member = String(sprite.member ?? "").toLowerCase();
        const id = String(sprite.id ?? "").toLowerCase();
        return id.includes("room") || id.includes("obj") || id.includes("user") || member.includes("floor") || member.includes("wall");
      });
      return {
        ready,
        hasRoomVisualizer: objectIds.includes("Room_visualizer"),
        roomSpriteCount: roomSprites.length,
      };
    });
    if (state.hasRoomVisualizer && state.roomSpriteCount > 10) return state;
    await sleep(250);
  }
  throw new Error(`room not ready: ${JSON.stringify(state)}`);
}

async function captureState(page, label) {
  const state = await page.evaluate((label) => {
    const sprites = window.__engine.activeSprites?.() ?? [];
    const objectIds = window.__engine.objectIds?.() ?? [];
    const transformed = (sprite) =>
      Number(sprite.flipH || 0) !== 0 ||
      Number(sprite.flipV || 0) !== 0 ||
      Number(sprite.rotation || 0) !== 0 ||
      Number(sprite.skew || 0) !== 0;
    const textSprites = sprites.filter((sprite) => sprite.type === "text" || sprite.type === "field");
    const suspiciousTextSprites = textSprites.filter(transformed);
    const suspiciousUiSprites = sprites.filter((sprite) => {
      const member = String(sprite.member ?? "");
      const id = String(sprite.id ?? "");
      return transformed(sprite) && /(Room_|info|button|bar|text|window|stand)/i.test(`${member} ${id}`);
    });
    const visualizer = window.__engine.visualizer?.("Room_visualizer") ?? null;
    const wrapperObjects = objectIds
      .filter((id) => /^uid:/.test(id))
      .map((id) => [id, window.__engine.objectProps?.(id)])
      .filter(([, value]) => value?.object === "Visualizer Part Wrapper Class")
      .map(([id, value]) => ({
        id,
        wrapId: value.props?.pwrapid,
        typeDef: value.props?.ptypedef,
        sprite: value.props?.psprite,
        parts: value.props?.ppartlist?.count,
        valid: value.props?.ancestor?.props?.valid,
      }));
    return {
      label,
      frame: window.__engine.frame?.() ?? null,
      errors: window.__engine.errors?.() ?? null,
      roomReady: window.__engine.dev.roomReady?.() ?? null,
      resize: window.__engine.resizeEngine?.() ?? null,
      objectCount: objectIds.length,
      wrapperObjects,
      textSprites,
      suspiciousTextSprites,
      suspiciousUiSprites,
      roomInfoWindow: window.__engine.windowElements?.("Room_info") ?? null,
      roomInfoStandWindow: window.__engine.windowElements?.("Room_info_stand") ?? null,
      roomBarWindow: window.__engine.windowElements?.("Room_bar") ?? null,
      roomInterfaceWindow: window.__engine.windowElements?.("Room_interface") ?? null,
      visualizer,
      hitProbes: {
        toolbarConsole: window.__engine.hitProbe?.(716, Math.max(0, (window.__engine.resizeEngine?.().viewportHeight ?? 540) - 24)),
        roomInfo: window.__engine.hitProbe?.(35, Math.max(0, (window.__engine.resizeEngine?.().viewportHeight ?? 540) - 88)),
        infostand: window.__engine.hitProbe?.(
          Math.max(0, (window.__engine.resizeEngine?.().viewportWidth ?? 960) - 84),
          Math.max(0, (window.__engine.resizeEngine?.().viewportHeight ?? 540) - 104),
        ),
      },
      pageLogTail: (document.getElementById("log")?.innerText ?? "").split("\n").slice(-50),
    };
  }, label);
  const imagePath = join(outDir, `${label}.png`);
  await page.screenshot({ path: imagePath, timeout: 60000 });
  const canvasPath = join(outDir, `${label}-canvas.png`);
  const canvasDataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  writeDataUrl(canvasPath, canvasDataUrl);
  return { ...state, screenshot: imagePath, canvas: canvasPath };
}

async function selectRoomTarget(page) {
  const target = await page.evaluate(() => {
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
      ["item", roomObjects.items ?? []],
      ["active", roomObjects.active ?? []],
      ["user", roomObjects.users ?? []],
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
    return (
      candidates.find((candidate) => candidate.kind === "item") ??
      candidates.find((candidate) => candidate.kind === "active") ??
      candidates.find((candidate) => candidate.kind === "user") ??
      null
    );
  });
  if (!target) return null;
  await page.evaluate((target) => window.__engine.dev.stageClick(target.x, target.y), target);
  await page.waitForTimeout(1200);
  return target;
}

let browser;
let page;
const consoleLines = [];
try {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, { timeout: 120000 });
  await page.evaluate(({ email, password }) => window.__engine.dev.login(email, password, 10), { email, password });
  await waitForUsableRoom(page);
  await page.waitForTimeout(settleMs);
  const initialClose = await closeBulletin(page);
  await page.waitForTimeout(1000);

  const flatId = await page.evaluate(() => {
    const value = window.__engine.objectMethod?.("#room_component", "getPrivateRoomFlatId", []);
    return typeof value === "string" && value.length > 0 ? value : null;
  });
  if (!flatId) {
    throw new Error("private room flat id not available after login");
  }
  const states = [];
  states.push({
    route: "initial",
    closeBulletin: initialClose,
    viewportSequence: await applyViewportSequence(page, "cycle-0-room"),
    ...(await captureState(page, "cycle-0-room")),
  });

  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const leave = await page.evaluate(() => window.__engine.dev.showHotelView());
    await page.waitForTimeout(2500);
    states.push({
      route: "hotel-view",
      cycle,
      result: leave,
      viewportSequence: await applyViewportSequence(page, `cycle-${cycle}-hotel`),
      ...(await captureState(page, `cycle-${cycle}-hotel`)),
    });

    const enter = await page.evaluate((flatId) => window.__engine.dev.enterPrivateRoom(flatId, true, 120000), flatId);
    await waitForUsableRoom(page);
    await page.waitForTimeout(settleMs);
    const closeResult = await closeBulletin(page);
    await page.waitForTimeout(1000);
    states.push({
      route: "private-room",
      cycle,
      result: enter,
      closeBulletin: closeResult,
      viewportSequence: await applyViewportSequence(page, `cycle-${cycle}-room`),
      ...(await captureState(page, `cycle-${cycle}-room`)),
    });
  }

  const selectedTarget = await selectRoomTarget(page);
  if (selectedTarget) {
    states.push({
      route: "selected-target",
      target: selectedTarget,
      ...(await captureState(page, `cycle-${cycles}-selected-${selectedTarget.kind}`)),
    });
  }

  const result = {
    url,
    cycles,
    settleMs,
    viewport: { width: viewportWidth, height: viewportHeight },
    resizeSequence,
    flatId,
    states,
    summary: states.map((state) => ({
      label: state.label,
      route: state.route,
      objectCount: state.objectCount,
      wrapperObjects: state.wrapperObjects.length,
      suspiciousTextSprites: state.suspiciousTextSprites.length,
      suspiciousUiSprites: state.suspiciousUiSprites.length,
      selectedTarget: state.target?.id ?? "",
      screenshot: state.screenshot,
    })),
  };
  writeFileSync(join(outDir, "state.json"), JSON.stringify(result, null, 2));
  console.table(result.summary);
} catch (error) {
  if (page) {
    try {
      await page.screenshot({ path: join(outDir, "failure.png"), timeout: 15000 });
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
