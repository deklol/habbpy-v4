// Reusable Playwright capture harness for the engine dev server.
//
//   node tools/dev/capture.mjs <url> <out.png> [waitMs] [--console=<log>] [--every=<ms>]
//
// Captures the page after waitMs (default 20000). With --every, also saves
// numbered intermediate frames (out-1.png, out-2.png, ...) so slow boots can
// be inspected over time. Browser console output is mirrored to stdout or to
// --console=<file>.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

const url = positional[0] ?? "http://127.0.0.1:5180/";
const out = positional[1] ?? "tmp/capture.png";
const waitMs = Number(positional[2] ?? 20000);
const everyMs = flags.has("every") ? Number(flags.get("every")) : 0;
const consolePath = flags.get("console") ?? null;

mkdirSync(dirname(out), { recursive: true });
const consoleLines = [];
const log = (line) => {
  consoleLines.push(line);
  if (!consolePath) process.stdout.write(line + "\n");
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
page.on("console", (message) => log(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => log(`[pageerror] ${error.message}`));
page.on("requestfailed", (request) =>
  log(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ""}`),
);

await page.goto(url, { waitUntil: "domcontentloaded" });

const started = Date.now();
let frameIndex = 0;
while (Date.now() - started < waitMs) {
  const remaining = waitMs - (Date.now() - started);
  const step = everyMs > 0 ? Math.min(everyMs, remaining) : remaining;
  await page.waitForTimeout(step);
  if (everyMs > 0 && Date.now() - started < waitMs) {
    frameIndex += 1;
    await page.screenshot({ path: out.replace(/\.png$/, `-${frameIndex}.png`) });
  }
}

await page.screenshot({ path: out });
if (consolePath) writeFileSync(consolePath, consoleLines.join("\n"));
await browser.close();
process.stdout.write(`captured ${out} after ${waitMs}ms\n`);
