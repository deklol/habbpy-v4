#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const standaloneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const useDevMain = process.env.ORIGINS_TIMELINE_DEV_MAIN === "1";
const executablePath = resolve(
  process.argv[2] ??
    (useDevMain
      ? join(standaloneRoot, "node_modules", "electron", "dist", "electron.exe")
      : join(standaloneRoot, "release", "win-unpacked", "Shockless Engine.exe")),
);
const outRoot = resolve(process.argv[3] ?? join(standaloneRoot, "..", "tmp", "standalone-sakura-timeline"));
const email = process.env.ORIGINS_SMOKE_EMAIL ?? process.env.HABBO_TEST_EMAIL;
const password = process.env.ORIGINS_SMOKE_PASSWORD ?? process.env.HABBO_TEST_PASSWORD;
const intervalMs = Number(process.env.ORIGINS_TIMELINE_INTERVAL_MS ?? 2000);
const roomTimeoutMs = Number(process.env.ORIGINS_TIMELINE_ROOM_TIMEOUT_MS ?? 180000);
const initialRoomTimeoutMs = Number(process.env.ORIGINS_TIMELINE_INITIAL_ROOM_TIMEOUT_MS ?? roomTimeoutMs);
const enterRoomTimeoutMs = Number(process.env.ORIGINS_TIMELINE_ENTER_ROOM_TIMEOUT_MS ?? roomTimeoutMs);
const afterReadyMs = Number(process.env.ORIGINS_TIMELINE_AFTER_READY_MS ?? 12000);
const afterOpenMs = Number(process.env.ORIGINS_TIMELINE_AFTER_OPEN_MS ?? 400);
const fallbackFlatId = process.env.ORIGINS_TIMELINE_FLAT_ID ?? process.env.HABBO_HORIZON_FLAT_ID ?? "225622";

if (!existsSync(executablePath)) {
  throw new Error(`Standalone executable not found: ${executablePath}`);
}
if (!email || !password) {
  throw new Error("Set ORIGINS_SMOKE_EMAIL/ORIGINS_SMOKE_PASSWORD or HABBO_TEST_EMAIL/HABBO_TEST_PASSWORD");
}

mkdirSync(outRoot, { recursive: true });

function safeName(label) {
  return label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

async function captureSnapshot(page, label, startedAt) {
  const facts = await page.evaluate((label) => {
    const activeSprites = window.__engine?.activeSprites?.() ?? [];
    const visibleSprites = activeSprites.filter((sprite) => sprite.vis !== 0);
    const bounds =
      visibleSprites.length === 0
        ? null
        : visibleSprites.reduce(
            (result, sprite) => {
              const [x, y] = sprite.loc ?? [0, 0];
              const [width, height] = sprite.size ?? [0, 0];
              return {
                left: Math.min(result.left, x),
                top: Math.min(result.top, y),
                right: Math.max(result.right, x + width),
                bottom: Math.max(result.bottom, y + height),
              };
            },
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
          );
    const interestingSprites = activeSprites.filter((sprite) => {
      const text = [sprite.n, sprite.member, sprite.cast, sprite.id, sprite.type].join(" ");
      return /sakura|horizon|hrz_|exterior|landscape|foreground|background|bridge|market|stall|room_dimmer|roomshadow|room_stage|floor|wall|visualizer/i.test(
        text,
      );
    });
    const canvas = document.querySelector("canvas");
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      label,
      url: location.href,
      status: document.getElementById("status")?.textContent ?? "",
      frame: window.__engine?.frame?.() ?? null,
      errors: window.__engine?.errors?.() ?? null,
      roomReady: window.__engine?.dev?.roomReady?.() ?? null,
      objectIds: window.__engine?.objectIds?.() ?? [],
      roomComponent: window.__engine?.objectProps?.("#room_component") ?? null,
      castLoadManager: window.__engine?.objectProps?.("#castload_manager") ?? null,
      variables: window.__engine?.variables?.([
        "room.cast.private",
        "room.cast.small.private",
        "room.dynamic.assets.enabled",
        "room.castload.debug",
        "net.operation.count",
      ]) ?? null,
      loadedCasts: window.__engine?.loadedCasts?.() ?? [],
      roomVisualizer: window.__engine?.visualizer?.("Room_visualizer") ?? null,
      roomGeometry: window.__engine?.objectProps?.("Room_geometry") ?? null,
      roomObjects: window.__engine?.roomObjects?.() ?? null,
      resize: window.__engine?.resizeEngine?.() ?? null,
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            cssWidth: canvasRect?.width ?? null,
            cssHeight: canvasRect?.height ?? null,
          }
        : null,
      spriteCounts: {
        active: activeSprites.length,
        visible: visibleSprites.length,
        interesting: interestingSprites.length,
        visibleBounds: bounds,
      },
      interestingSprites,
      activeSpritesTail: activeSprites.slice(-80),
      logTail: (document.getElementById("log")?.innerText ?? "").split("\n").slice(-120),
    };
  }, label);
  const screenshotPath = join(outRoot, `${String(captures.length + 1).padStart(2, "0")}-${safeName(label)}.png`);
  await page.screenshot({ path: screenshotPath, timeout: 60000 });
  return {
    label,
    elapsedMs: Date.now() - startedAt,
    screenshotPath,
    facts,
  };
}

async function closeBulletinBoard(page) {
  return await page.evaluate(() => {
    const close = window.__engine
      ?.activeSprites?.()
      ?.find((sprite) => /Bulletin Board_close/i.test(String(sprite.member ?? "")));
    if (!close) return { closed: false, route: "no bulletin close sprite" };
    const clicked = window.__engine?.dev?.clickSprite?.(close.n) === true;
    return { closed: clicked, route: clicked ? `clicked sprite ${close.n}` : "click failed" };
  });
}

async function waitForRoomReadyByPolling(page, timeoutMs, labelPrefix, startedAt) {
  let roomReadyResult = null;
  let ready = false;
  const roomWaitStart = Date.now();
  let step = 0;
  while (Date.now() - roomWaitStart < timeoutMs) {
    await page.waitForTimeout(intervalMs);
    step += 1;
    roomReadyResult = await page.evaluate(() => window.__engine?.dev?.roomReady?.() ?? null);
    captures.push(await captureSnapshot(page, `${labelPrefix}-${String(step).padStart(2, "0")}`, startedAt));
    if (
      roomReadyResult?.ready ||
      (roomReadyResult?.hasRoomVisualizer &&
        ((roomReadyResult?.roomSpriteCount ?? 0) > 0 || (roomReadyResult?.roomLikeSpriteCount ?? 0) > 0))
    ) {
      ready = true;
      break;
    }
  }
  return { ready, roomReadyResult };
}

async function currentRoomFlatId(page) {
  return await page.evaluate(() => {
    const entries = window.__engine?.objectProps?.("#room_component")?.props?.psavedata?.entries ?? [];
    const value = entries.find((entry) => {
      const key = String(entry?.key ?? "").toLowerCase();
      return key === "#id" || key === "#flatid";
    })?.value;
    return value === undefined || value === null ? "" : String(value);
  });
}

const captures = [];
const pageLogs = [];
const failedRequests = [];
let launcher = null;
let game = null;
let app = null;
const startedAt = Date.now();

try {
  app = await electron.launch({
    executablePath,
    ...(useDevMain ? { args: [join(standaloneRoot, "dist", "main", "main", "main.js")] } : {}),
    env: {
      ...process.env,
      ORIGINS_STANDALONE_HEADLESS: "1",
      ORIGINS_STANDALONE_TRACE: "1",
    },
  });

  app.on("window", (page) => {
    page.on("console", (message) => {
      pageLogs.push(`[${new Date().toISOString()}] [${message.type()}] ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      pageLogs.push(`[${new Date().toISOString()}] [pageerror] ${String(error)}`);
    });
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
  });

  launcher = await app.firstWindow();
  await launcher.waitForLoadState("domcontentloaded");
  await launcher.waitForFunction(
    () => {
      const byId = document.querySelector("#play-profile");
      if (byId instanceof HTMLButtonElement && !byId.disabled) return true;
      return [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim().toLowerCase() === "play" && !button.disabled,
      );
    },
    null,
    { timeout: 30000 },
  );

  const gamePromise = app.waitForEvent("window", { timeout: 30000 });
  await launcher.evaluate(() => {
    const byId = document.querySelector("#play-profile");
    if (byId instanceof HTMLButtonElement && !byId.disabled) {
      byId.click();
      return;
    }
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim().toLowerCase() === "play" && !candidate.disabled,
    );
    if (button instanceof HTMLButtonElement) button.click();
  });
  game = await gamePromise;
  await game.waitForLoadState("domcontentloaded");
  await game.waitForSelector("canvas", { timeout: 60000 });
  await game.waitForTimeout(afterOpenMs);
  captures.push(await captureSnapshot(game, "game-open", startedAt));

  await game.waitForFunction(() => window.__engine?.dev?.editableFields?.().length >= 2, null, {
    timeout: 180000,
  });
  captures.push(await captureSnapshot(game, "login-ready", startedAt));

  const loginResult = await game.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );
  captures.push(await captureSnapshot(game, "login-submitted", startedAt));

  let { ready, roomReadyResult } = await waitForRoomReadyByPolling(game, initialRoomTimeoutMs, "room-load", startedAt);
  let enterRoomResult = null;
  const activeFlatId = await currentRoomFlatId(game);
  if (ready && fallbackFlatId && activeFlatId && activeFlatId !== String(fallbackFlatId)) {
    ready = false;
    captures.push(await captureSnapshot(game, `before-explicit-enter-room-${activeFlatId}`, startedAt));
  }
  if (!ready && fallbackFlatId) {
    enterRoomResult = await game.evaluate(
      ({ flatId, timeoutMs }) => window.__engine?.dev?.enterPrivateRoom?.(flatId, true, timeoutMs),
      { flatId: fallbackFlatId, timeoutMs: enterRoomTimeoutMs },
    );
    captures.push(await captureSnapshot(game, "after-explicit-enter-room", startedAt));
    roomReadyResult = enterRoomResult?.roomReady ?? roomReadyResult;
    ready =
      roomReadyResult?.ready ||
      (roomReadyResult?.hasRoomVisualizer &&
        ((roomReadyResult?.roomSpriteCount ?? 0) > 0 || (roomReadyResult?.roomLikeSpriteCount ?? 0) > 0));
    if (!ready) {
      const retry = await waitForRoomReadyByPolling(game, Math.min(enterRoomTimeoutMs, 45000), "room-enter-wait", startedAt);
      ready = retry.ready;
      roomReadyResult = retry.roomReadyResult ?? roomReadyResult;
    }
  }
  if (!ready) {
    throw new Error(`Room did not become ready: ${JSON.stringify(roomReadyResult)}`);
  }

  const bulletinCloseResult = await closeBulletinBoard(game);
  await game.waitForTimeout(1000);
  captures.push(await captureSnapshot(game, "after-bulletin-close", startedAt));

  const afterReadyEnd = Date.now() + afterReadyMs;
  let step = 0;
  while (Date.now() < afterReadyEnd) {
    await game.waitForTimeout(Math.min(intervalMs, Math.max(0, afterReadyEnd - Date.now())));
    step += 1;
    captures.push(await captureSnapshot(game, `post-ready-${String(step).padStart(2, "0")}`, startedAt));
  }

  const finalFacts = await game.evaluate(() => {
    const allSprites = window.__engine?.activeSprites?.() ?? [];
    return {
      errors: window.__engine?.errors?.() ?? null,
      objectIds: window.__engine?.objectIds?.() ?? [],
      roomReady: window.__engine?.dev?.roomReady?.() ?? null,
      allSprites,
      resolvedSakuraSprites: window.__engine?.dev?.resolvedSprites?.("sakura", false) ?? [],
      resolvedHorizonSprites: window.__engine?.dev?.resolvedSprites?.("horizon", false) ?? [],
      resolvedMarketSprites: window.__engine?.dev?.resolvedSprites?.("market", false) ?? [],
      pageLog: document.getElementById("log")?.innerText ?? "",
    };
  });
  const result = {
    executablePath,
    generatedAt: new Date().toISOString(),
    loginResult,
    roomReadyResult,
    fallbackFlatId,
    enterRoomResult,
    bulletinCloseResult,
    failedRequests,
    captures,
    finalFacts,
  };
  writeFileSync(join(outRoot, "timeline.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(join(outRoot, "page.log"), `${finalFacts.pageLog}\n`, "utf8");
  writeFileSync(join(outRoot, "console.log"), `${pageLogs.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ outRoot, captureCount: captures.length, roomReadyResult, failedRequests }, null, 2));
} catch (error) {
  const failure = {
    executablePath,
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    failedRequests,
    captures,
  };
  if (game) {
    try {
      captures.push(await captureSnapshot(game, "failure", startedAt));
      failure.gameUrl = game.url();
      failure.pageLog = await game.evaluate(() => document.getElementById("log")?.innerText ?? "");
    } catch (captureError) {
      pageLogs.push(`[${new Date().toISOString()}] [captureerror] game ${String(captureError)}`);
    }
  }
  if (launcher) {
    try {
      const launcherScreenshotPath = join(outRoot, "launcher-failure.png");
      await launcher.screenshot({ path: launcherScreenshotPath, timeout: 15000 });
      failure.launcherScreenshotPath = launcherScreenshotPath;
    } catch (captureError) {
      pageLogs.push(`[${new Date().toISOString()}] [captureerror] launcher ${String(captureError)}`);
    }
  }
  writeFileSync(join(outRoot, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  writeFileSync(join(outRoot, "console.log"), `${pageLogs.join("\n")}\n`, "utf8");
  throw error;
} finally {
  if (app) await app.close().catch(() => undefined);
}
