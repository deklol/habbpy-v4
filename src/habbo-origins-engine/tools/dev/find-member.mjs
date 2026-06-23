// Finds a live cast member by name prefix and prints its state (text, style,
// image buffer saved to PNG when present).
//
//   node tools/dev/find-member.mjs <prefix> [url] [waitMs]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const prefix = process.argv[2] ?? "entry_nameOfYourHabbo";
const url = process.argv[3] ?? "http://127.0.0.1:5180/?fastEntry=1";
const waitMs = Number(process.argv[4] ?? 30000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);
const info = await page.evaluate((p) => window.__engine?.findMember?.(p) ?? null, prefix);
await browser.close();
if (!info) {
  console.error(`member not found: ${prefix}`);
  process.exit(1);
}
const { imageData, ...rest } = info;
console.log(JSON.stringify(rest, null, 2));
if (imageData) {
  const out = `tmp/member-${info.name.replace(/[^\w.-]/g, "_")}.png`;
  writeFileSync(out, Buffer.from(imageData.split(",")[1], "base64"));
  console.log(`image: ${out}`);
} else {
  console.log("no image buffer");
}
