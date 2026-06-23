// Saves a live member's composited image buffer to a PNG for inspection.
//
//   node tools/dev/dump-member-image.mjs <memberNamePrefix> [url] [waitMs] [out.png]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const name = process.argv[2] ?? "login_b_login_b";
const url = process.argv[3] ?? "http://127.0.0.1:5180/?fastEntry=1";
const waitMs = Number(process.argv[4] ?? 30000);
const out = process.argv[5] ?? `tmp/member-${name.replace(/[^\w.-]/g, "_")}.png`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);
const dataUrl = await page.evaluate((memberName) => window.__engine?.memberImageData?.(memberName) ?? null, name);
await browser.close();
if (!dataUrl) {
  console.error(`no image buffer found for member ~ ${name}`);
  process.exit(1);
}
writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log(`wrote ${out}`);
