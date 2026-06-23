// Drives pointer/keyboard input against the running dev server and captures
// the result.
//
//   node tools/dev/interact.mjs [url] [waitMs] [out.png] [--click=x,y]... [--type=text] [--key=Enter]...
//
// Actions run in the order given on the command line. Click coordinates are
// stage pixels (the canvas is hit at its bounding box plus the offsets).
import { chromium } from "playwright";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const actions = args.filter((a) => a.startsWith("--"));

const url = positional[0] ?? "http://127.0.0.1:5180/?fastEntry=1";
const waitMs = Number(positional[1] ?? 30000);
const out = positional[2] ?? "tmp/interact.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
page.on("console", (message) => {
  const text = message.text();
  if (!text.startsWith("[vite]")) console.log(`[console] ${text}`);
});
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);

const canvas = await page.$("canvas");
if (!canvas) {
  console.error("no canvas found");
  process.exit(1);
}
const box = await canvas.boundingBox();

for (const action of actions) {
  const eq = action.indexOf("=");
  const name = action.slice(2, eq === -1 ? undefined : eq);
  const value = eq === -1 ? "" : action.slice(eq + 1);
  if (name === "click") {
    const [x, y] = value.split(",").map(Number);
    await page.mouse.click(box.x + x, box.y + y);
    console.log(`clicked stage (${x}, ${y})`);
  } else if (name === "type") {
    await page.keyboard.type(value, { delay: 40 });
    console.log(`typed "${value}"`);
  } else if (name === "key") {
    await page.keyboard.press(value);
    console.log(`pressed ${value}`);
  } else if (name === "pause") {
    await page.waitForTimeout(Number(value) || 1000);
  }
  await page.waitForTimeout(250);
}

await page.waitForTimeout(1500);
await page.screenshot({ path: out });
console.log(`captured ${out}`);
await browser.close();
