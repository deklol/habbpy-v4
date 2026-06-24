// Source-driven room-load timing probe.
//
// Logs in through window.__engine.dev.login, samples lightweight runtime state,
// records browser long tasks / event-loop gaps, and closes Chromium in finally.
//
//   node tools/dev/room-load-timing-probe.mjs [url] [prefix] [maxMs] [loginWaitMs] [typeDelayMs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const prefix = process.argv[3] ?? "tmp/room-load-timing";
const maxMs = Number(process.argv[4] ?? 120000);
const loginWaitMs = Number(process.argv[5] ?? 120000);
const typeDelayMs = Number(process.argv[6] ?? 10);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });

const startedAt = Date.now();
const ts = () => Date.now() - startedAt;
const consoleLines = [];
const milestones = [];
const samples = [];
let browser;

function mark(name, extra = {}) {
  const entry = { t: ts(), name, ...extra };
  milestones.push(entry);
  console.log(`${String(entry.t).padStart(6)}ms ${name}${Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ""}`);
}

async function sample(page, label) {
  const result = await page.evaluate((label) => {
    const engine = window.__engine;
    const buffer = engine?.roomAssetBuffer?.() ?? null;
    const roomObjects = engine?.roomObjects?.() ?? null;
    const liveObjectPlaceholders = {
      active: Array.isArray(roomObjects?.active)
        ? roomObjects.active.filter((object) => object?.object === "Furniture Placeholder Class").length
        : null,
      item: Array.isArray(roomObjects?.items)
        ? roomObjects.items.filter((object) => object?.object === "Furniture Placeholder Class").length
        : null,
    };
    return {
      t: Math.round(performance.now()),
      label,
      frame: engine?.frame?.() ?? null,
      errors: engine?.errors?.() ?? null,
      objects: engine?.objectIds?.().length ?? null,
      sprites: engine?.activeSprites?.().length ?? null,
      casts: engine?.loadedCasts?.().length ?? null,
      hasRoomVisualizer: engine?.objectIds?.().includes("Room_visualizer") ?? false,
      hasRoomBar: engine?.objectIds?.().includes("Room_bar") ?? false,
      placeholders: buffer?.placeholders ?? null,
      liveObjectPlaceholders,
      logRows: document.getElementById("log")?.children.length ?? 0,
      eventLoopGaps: window.__roomLoadTiming?.eventLoopGaps?.slice(-20) ?? [],
      longTasks: window.__roomLoadTiming?.longTasks?.slice(-20) ?? [],
    };
  }, label);
  samples.push(result);
  return result;
}

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 660 } });

  page.on("console", (message) => {
    const line = `[${ts()}ms][${message.type()}] ${message.text()}`;
    consoleLines.push(line);
    if (/\bForwarding to room\b|network bridge connected|network bridge closed|Version not correct|old client|deferred .* bitmap|decoded .* bitmaps|castLib .* loaded|packet out.*VERSIONCHECK/i.test(message.text())) {
      console.log(line);
    }
  });
  page.on("pageerror", (error) => consoleLines.push(`[${ts()}ms][pageerror] ${error.message}`));

  await page.addInitScript(() => {
    const timing = {
      eventLoopGaps: [],
      longTasks: [],
    };
    window.__roomLoadTiming = timing;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      if (gap > 250) {
        timing.eventLoopGaps.push({ t: Math.round(now), gap: Math.round(gap) });
        if (timing.eventLoopGaps.length > 200) timing.eventLoopGaps.shift();
      }
      last = now;
    }, 100);
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          timing.longTasks.push({
            t: Math.round(entry.startTime),
            duration: Math.round(entry.duration),
            name: entry.name,
          });
          if (timing.longTasks.length > 200) timing.longTasks.shift();
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long Task API is not available in every browser mode.
    }
  });

  mark("goto");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sample(page, "domcontentloaded");

  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: loginWaitMs,
  });
  mark("login-fields-ready", await sample(page, "login-fields-ready"));

  await page.evaluate(
    ({ email, password, typeDelayMs }) => window.__engine.dev.login(email, password, typeDelayMs),
    { email, password, typeDelayMs },
  );
  mark("login-submitted", await sample(page, "login-submitted"));

  const loadStart = Date.now();
  let seenVisualizer = false;
  let seenRoomBar = false;
  let settledAt = null;
  while (Date.now() - loadStart < maxMs) {
    await page.waitForTimeout(1000);
    const state = await sample(page, "poll");
    if (state.hasRoomVisualizer && !seenVisualizer) {
      seenVisualizer = true;
      mark("room-visualizer", state);
    }
    if (state.hasRoomBar && !seenRoomBar) {
      seenRoomBar = true;
      mark("room-bar", state);
    }
    const placeholders = state.placeholders;
    const placeholderCount =
      placeholders && typeof placeholders === "object"
        ? Number(placeholders.active ?? 0) + Number(placeholders.item ?? 0)
        : null;
    const livePlaceholders = state.liveObjectPlaceholders;
    const livePlaceholderCount =
      livePlaceholders && typeof livePlaceholders === "object"
        ? Number(livePlaceholders.active ?? 0) + Number(livePlaceholders.item ?? 0)
        : null;
    if (
      state.hasRoomVisualizer &&
      state.hasRoomBar &&
      state.sprites >= 80 &&
      placeholderCount === 0 &&
      livePlaceholderCount === 0
    ) {
      settledAt = ts();
      mark("room-settled", state);
      break;
    }
  }

  const finalState = await page.evaluate(() => ({
    frame: window.__engine?.frame?.() ?? null,
    errors: window.__engine?.errors?.() ?? null,
    objects: window.__engine?.objectIds?.() ?? [],
    sprites: window.__engine?.activeSprites?.() ?? [],
    roomAssetBuffer: window.__engine?.roomAssetBuffer?.() ?? null,
    roomObjects: window.__engine?.roomObjects?.() ?? null,
    liveObjectPlaceholders: (() => {
      const roomObjects = window.__engine?.roomObjects?.() ?? null;
      return {
        active: Array.isArray(roomObjects?.active)
          ? roomObjects.active.filter((object) => object?.object === "Furniture Placeholder Class").length
          : null,
        item: Array.isArray(roomObjects?.items)
          ? roomObjects.items.filter((object) => object?.object === "Furniture Placeholder Class").length
          : null,
      };
    })(),
    logRows: document.getElementById("log")?.children.length ?? 0,
    eventLoopGaps: window.__roomLoadTiming?.eventLoopGaps ?? [],
    longTasks: window.__roomLoadTiming?.longTasks ?? [],
  }));

  await page.screenshot({ path: `${prefix}.png`, timeout: 60000 });
  writeFileSync(`${prefix}.json`, JSON.stringify({ url, settledAt, milestones, samples, finalState }, null, 2));
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  writeFileSync(`${prefix}-page.log`, await page.evaluate(() => document.getElementById("log")?.innerText ?? ""));

  const longestGap = finalState.eventLoopGaps.reduce((max, gap) => Math.max(max, Number(gap.gap) || 0), 0);
  const longestTask = finalState.longTasks.reduce((max, task) => Math.max(max, Number(task.duration) || 0), 0);
  console.log(
    `final: frame=${finalState.frame} errors=${finalState.errors} objects=${finalState.objects.length} sprites=${finalState.sprites.length} logRows=${finalState.logRows} settledAt=${settledAt}`,
  );
  console.log(`longest event-loop gap=${longestGap}ms; longest longtask=${longestTask}ms`);
} finally {
  if (browser) await browser.close();
}
