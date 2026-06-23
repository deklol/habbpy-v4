// Captures only the rendered Director canvas from the dev server.
//
//   node tools/dev/canvas-capture.mjs <url> <out.png> [waitMs] [width] [height]
//
// This avoids Playwright page screenshots accidentally including diagnostic
// sidebars or log panels around the game canvas.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5311/?fastEntry=1&capture=1";
const out = process.argv[3] ?? "tmp/canvas-capture.png";
const waitMs = Number(process.argv[4] ?? 8000);
const width = Number(process.argv[5] ?? 980);
const height = Number(process.argv[6] ?? 620);

mkdirSync(dirname(out), { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 120000 });
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  const dataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  if (!dataUrl) throw new Error("No canvas data available");
  const comma = dataUrl.indexOf(",");
  writeFileSync(out, Buffer.from(dataUrl.slice(comma + 1), "base64"));
  process.stdout.write(`captured canvas ${out} after ${waitMs}ms\n`);
} finally {
  await browser.close();
}
