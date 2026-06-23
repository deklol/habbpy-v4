// Logs in via the dev API, waits for an Object Manager id, then prints
// objectProps for the requested ids (diagnosing source object state).
//
//   node tools/dev/object-probe.mjs <url> <waitId> <id1> [id2...] [--timeout=120000] [--settle=8000]
import { chromium } from "playwright";

const rawArgs = process.argv.slice(2);
const positional = rawArgs.filter((arg) => !arg.startsWith("--"));
const flags = new Map(
  rawArgs
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const eq = arg.indexOf("=");
      return eq === -1 ? [arg.slice(2), "1"] : [arg.slice(2, eq), arg.slice(eq + 1)];
    }),
);

const url = positional[0] ?? "http://127.0.0.1:5174/?fastEntry=1";
const waitId = positional[1] ?? "Room Classes";
const ids = positional.slice(2);
if (ids.length === 0) ids.push(waitId);
const waitTimeoutMs = Number(flags.get("timeout") ?? 60000);
const loginTimeoutMs = Number(flags.get("loginTimeout") ?? waitTimeoutMs);
const settleMs = Number(flags.get("settle") ?? 8000);
const maxChars = Number(flags.get("maxChars") ?? 6000);
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, {
    timeout: loginTimeoutMs,
  });
  await page.evaluate(
    ({ email, password }) => window.__engine.dev.login(email, password, 10),
    { email, password },
  );
  await page.waitForFunction(
    (id) => window.__engine?.dev?.waitForObject(id, 1),
    waitId,
    { timeout: waitTimeoutMs, polling: 1000 },
  );
  await page.waitForTimeout(settleMs);
  for (const id of ids) {
    const props = await page.evaluate((objectId) => window.__engine.objectProps(objectId), id);
    console.log(`===== ${id} =====`);
    console.log(JSON.stringify(props, null, 2).slice(0, maxChars));
  }
} finally {
  if (browser) await browser.close();
}
