// Dumps live sprite-channel state from the running dev server.
//
//   node tools/dev/probe-sprites.mjs [url] [waitMs] [--out=<json>]
//
// Prints window.__engine.activeSprites() with frame/error counters after the
// boot has had waitMs to settle. Useful for matching rendered defects to the
// sprite channels that produced them.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const flags = new Map(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const eq = a.indexOf("=");
      return eq === -1 ? [a.slice(2), "1"] : [a.slice(2, eq), a.slice(eq + 1)];
    }),
);

const url = positional[0] ?? "http://127.0.0.1:5180/?fastEntry=1";
const waitMs = Number(positional[1] ?? 30000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);

const state = await page.evaluate(() => {
  const engine = window.__engine;
  if (!engine) return null;
  return {
    frame: engine.frame(),
    errors: engine.errors(),
    sprites: engine.activeSprites(),
  };
});

await browser.close();
if (!state) {
  console.error("window.__engine not present");
  process.exit(1);
}
const text = JSON.stringify(state, null, 2);
if (flags.has("out")) {
  writeFileSync(flags.get("out"), text);
  console.log(`wrote ${flags.get("out")} (${state.sprites.length} sprites, frame ${state.frame})`);
} else {
  console.log(text);
}
