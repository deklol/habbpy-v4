// Logs in through the source dev API, waits for the private-room stack, then
// dumps Buffer Component placeholder/cast/member readiness diagnostics.
//
//   node tools/dev/buffer-diagnostics.mjs [url] [outPrefix] [settleMs] [limit] [loginWaitMs]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const prefix = process.argv[3] ?? "tmp/buffer-diagnostics";
const settleMs = Number(process.argv[4] ?? 30000);
const limit = Number(process.argv[5] ?? 80);
const loginWaitMs = Number(process.argv[6] ?? 120000);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });
const consoleLines = [];
let browser;

try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 660 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: loginWaitMs,
  });
  console.log("login fields ready; logging in");
  await page.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );

  await page.waitForFunction(
    () => window.__engine?.objectIds?.().includes("Room_bar") || window.__engine?.objectIds?.().includes("Room_visualizer"),
    null,
    { timeout: loginWaitMs },
  );
  await page.waitForTimeout(settleMs);

  const state = await page.evaluate((limit) => ({
    frame: window.__engine.frame(),
    errors: window.__engine.errors(),
    objects: window.__engine.objectIds(),
    variables: window.__engine.variables?.([
      "private.room.properties",
      "room.cast.private",
      "room.cast.1",
      "room.cast.2",
      "room.cast.3",
      "room.cast.4",
      "room.cast.small.1",
      "room.dynamic.assets.enabled",
      "room.dynamic.furniture.cast.prefix",
    ]) ?? null,
    roomGeometry: window.__engine.objectProps?.("Room_geometry") ?? null,
    roomComponent: window.__engine.objectProps?.("#room_component") ?? null,
    roomAssetBuffer: window.__engine.roomAssetBuffer?.() ?? null,
    roomAssetBufferDiagnostics: window.__engine.roomAssetBufferDiagnostics?.(limit) ?? null,
    roomObjects: window.__engine.roomObjects?.() ?? null,
  }), limit);
  writeFileSync(`${prefix}-state.json`, JSON.stringify(state, null, 2));
  writeFileSync(`${prefix}-page.log`, await page.evaluate(() => document.getElementById("log")?.innerText ?? ""));
  console.log(
    `state: frame ${state.frame}, ${state.errors} errors, ${state.objects.length} objects`,
  );
  const placeholders = state.roomAssetBuffer?.placeholders;
  if (placeholders) {
    console.log(`placeholders: active=${placeholders.active} item=${placeholders.item}`);
  }
} finally {
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  if (browser) await browser.close();
}

console.log(`wrote ${prefix}-state.json and ${prefix}-page.log`);
