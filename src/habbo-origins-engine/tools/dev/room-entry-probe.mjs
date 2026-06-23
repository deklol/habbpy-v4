// Drives the source login flow via window.__engine.dev and captures the
// room-entry state: console log, periodic screenshots, final sprite/object
// dumps. Credentials come from HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD.
//
//   node tools/dev/room-entry-probe.mjs [url] [settleMs] [outPrefix] [loginWaitMs]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1&eagerDecodeMax=0";
const settleMs = Number(process.argv[3] ?? 45000);
const prefix = process.argv[4] ?? "tmp/room-entry";
const loginWaitMs = Number(process.argv[5] ?? 120000);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;
if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync("tmp", { recursive: true });
const consoleLines = [];
let browser;
async function safeScreenshot(page, path) {
  try {
    await page.screenshot({ path, timeout: 60000 });
  } catch (error) {
    consoleLines.push(`[probe] screenshot failed ${path}: ${error.message}`);
    console.warn(`screenshot failed ${path}: ${error.message}`);
  }
}
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 660 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: loginWaitMs,
  });
  await safeScreenshot(page, `${prefix}-1-login.png`);
  console.log("login fields ready; logging in");

  await page.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );

  const start = Date.now();
  let shot = 1;
  while (Date.now() - start < settleMs) {
    await page.waitForTimeout(10000);
    shot += 1;
    await safeScreenshot(page, `${prefix}-${shot}-t${Math.round((Date.now() - start) / 1000)}s.png`);
  }

  const state = await page.evaluate(() => ({
    frame: window.__engine.frame(),
    errors: window.__engine.errors(),
    objects: window.__engine.objectIds(),
    roomAssetBuffer: window.__engine.roomAssetBuffer?.() ?? null,
    roomObjects: window.__engine.roomObjects?.() ?? null,
    sprites: window.__engine.activeSprites(),
  }));
  writeFileSync(`${prefix}-state.json`, JSON.stringify(state, null, 2));
  const pageLog = await page.evaluate(() => document.getElementById("log")?.innerText ?? "");
  writeFileSync(`${prefix}-page.log`, pageLog);
  console.log(
    `state: frame ${state.frame}, ${state.errors} errors, ${state.objects.length} objects, ${state.sprites.length} sprites`,
  );
  console.log(`objects: ${state.objects.join(", ")}`);
} finally {
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  if (browser) await browser.close();
}
console.log(`captured ${prefix}-*.png, console -> ${prefix}-console.log`);
