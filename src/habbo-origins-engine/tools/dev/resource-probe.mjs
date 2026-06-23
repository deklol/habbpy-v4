// Logs in, waits for the room stack, then queries the live Resource Manager
// member index for the given names (diagnosing getmemnum misses).
//
//   node tools/dev/resource-probe.mjs <url> <name1> [name2...]
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastEntry=1";
const names = process.argv.slice(3);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: 60000,
  });
  await page.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );
  await page.waitForFunction(() => window.__engine?.dev?.waitForObject("Room_visualizer", 1), null, {
    timeout: 60000,
    polling: 1000,
  });
  await page.waitForTimeout(12000);
  const result = await page.evaluate((wanted) => window.__engine.resourceMembers(wanted), names);
  for (const [name, value] of Object.entries(result)) {
    console.log(`${name} -> ${JSON.stringify(value)}`);
  }
  const casts = await page.evaluate(() => window.__engine.loadedCasts?.() ?? null);
  if (casts) console.log(`loaded casts: ${casts.join(", ")}`);
} finally {
  if (browser) await browser.close();
}
