// Source-level multi-window UI parity probe.
// Logs in through window.__engine.dev, opens high-value UI panels through
// generated message/object routes, captures canvases, and dumps Window Manager
// element state with per-element images.
//
//   node tools/dev/ui-window-parity-probe.mjs [url] [outDir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://127.0.0.1:5311/?fastEntry=1&eagerDecodeMax=0&capture=1&versionCheckBuild=1126";
const outDir = process.argv[3] ?? "tmp/ui-window-parity-probe";
const email = process.env.HABBO_TEST_EMAIL;
const password = process.env.HABBO_TEST_PASSWORD;

if (!email || !password) {
  console.error("HABBO_TEST_EMAIL / HABBO_TEST_PASSWORD not set");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeName(value) {
  return String(value ?? "unknown")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function writeDataUrl(filePath, dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  writeFileSync(filePath, Buffer.from(dataUrl.slice(comma + 1), "base64"));
  return filePath;
}

function stripImages(value, prefix, files) {
  if (Array.isArray(value)) return value.map((entry, index) => stripImages(entry, `${prefix}-${index}`, files));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "dataUrl" && typeof entry === "string") {
      const filePath = join(outDir, `${safeName(prefix)}.png`);
      const written = writeDataUrl(filePath, entry);
      if (written) files.push(written);
      out.path = written;
      continue;
    }
    out[key] = stripImages(entry, `${prefix}-${key}`, files);
  }
  return out;
}

async function waitForUsableRoom(page, timeoutMs = 120000) {
  const start = Date.now();
  let state = null;
  while (Date.now() - start < timeoutMs) {
    state = await page.evaluate(() => window.__engine?.dev?.roomReady?.() ?? {});
    if (state.ready) return state;
    await sleep(250);
  }
  throw new Error(`room not ready: ${JSON.stringify(state)}`);
}

async function closeBulletin(page) {
  return page.evaluate(async () => {
    const results = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const close = window.__engine.activeSprites().find((sprite) => /Bulletin Board_close/i.test(sprite.member));
      if (!close) break;
      results.push(window.__engine.dev.clickSprite(close.n) ? `clicked ${close.n}` : `failed ${close.n}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return results;
  });
}

async function captureCanvas(page, name) {
  const dataUrl = await page.evaluate(() => document.querySelector("canvas")?.toDataURL("image/png") ?? null);
  return writeDataUrl(join(outDir, `${safeName(name)}.png`), dataUrl);
}

async function dumpWindows(page, label, beforeIds) {
  const raw = await page.evaluate(
    ({ label, beforeIds }) => {
      const ids = window.__engine.dev.windowIds();
      const before = new Set(beforeIds);
      const interesting = ids.filter((id) => {
        if (!before.has(id)) return true;
        return /catalog|catalogue|purse|console|messenger|challenge|competition|registration|custom|figure|standing|account/i.test(id);
      });
      const windows = {};
      for (const id of interesting) {
        windows[id] = window.__engine.dev.windowElements(id, true);
      }
      return {
        label,
        frame: window.__engine.frame?.() ?? null,
        errors: window.__engine.errors?.() ?? null,
        windowIds: ids,
        interestingWindowIds: interesting,
        windows,
        titleSprites: window.__engine.dev
          .resolvedSprites("", false)
          .filter((sprite) => /title|heading|caption/i.test(`${sprite.member?.name ?? sprite.member ?? ""} ${sprite.sourceWindowOwners?.map?.((owner) => owner.id).join(" ") ?? ""}`)),
      };
    },
    { label, beforeIds },
  );
  const files = [];
  const stripped = stripImages(raw, label, files);
  await captureCanvas(page, `${label}-canvas`);
  writeFileSync(join(outDir, `${safeName(label)}.json`), JSON.stringify({ ...stripped, imageFiles: files }, null, 2));
  return { ...stripped, imageFiles: files };
}

const actions = [
  {
    label: "catalogue-message",
    run: () => window.__engine.dev.executeMessage("show_catalogue"),
  },
  {
    label: "catalogue-toggle-message",
    run: () => window.__engine.dev.executeMessage("show_hide_catalogue"),
  },
  {
    label: "purse-general-dialog",
    run: () => window.__engine.dev.executeMessage("openGeneralDialog", ["purse"]),
  },
  {
    label: "purse-message",
    run: () => window.__engine.dev.executeMessage("show_purse"),
  },
  {
    label: "console-message",
    run: () => window.__engine.dev.executeMessage("show_hide_messenger"),
  },
  {
    label: "challenge-toolbar-message",
    run: () => window.__engine.dev.executeMessage("show_hide_challenge_window"),
  },
  {
    label: "room-competition-interface",
    run: () => window.__engine.objectMethod("#room_interface", "openroomcompetition", []),
  },
  {
    label: "registration-message",
    run: () => window.__engine.dev.executeMessage("show_registration"),
  },
  {
    label: "registration-component-figure-update",
    run: () => window.__engine.objectMethod("#registration_component", "openfigureupdate", []),
  },
];

const browser = await chromium.launch();
const consoleLines = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1264, height: 761 } });
  page.on("console", (message) => consoleLines.push(`[${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => consoleLines.push(`[pageerror] ${error.message}`));

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__engine?.dev?.editableFields().length >= 2, null, { timeout: 120000 });
  await page.evaluate(({ email, password }) => window.__engine.dev.login(email, password, 10), { email, password });
  const roomState = await waitForUsableRoom(page);
  await page.waitForTimeout(3500);
  const closeBulletinResult = await closeBulletin(page);
  await page.waitForTimeout(750);

  const initial = await dumpWindows(page, "initial-room", []);
  const summaries = [];

  for (const action of actions) {
    const beforeIds = await page.evaluate(() => window.__engine.dev.windowIds());
    const openResult = await page.evaluate((source) => {
      const fn = new Function(`return (${source})();`);
      return fn();
    }, action.run.toString());
    await page.waitForTimeout(2500);
    const state = await dumpWindows(page, action.label, beforeIds);
    summaries.push({
      label: action.label,
      openResult,
      windowIds: state.interestingWindowIds,
      errors: state.errors,
      images: state.imageFiles.length,
    });
  }

  const result = {
    url,
    roomState,
    closeBulletinResult,
    initialWindows: initial.interestingWindowIds,
    summaries,
  };
  writeFileSync(join(outDir, "result.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  console.table(
    summaries.map((summary) => ({
      label: summary.label,
      windows: summary.windowIds.join(", "),
      errors: summary.errors,
      images: summary.images,
    })),
  );
} catch (error) {
  if (page) {
    try {
      await captureCanvas(page, "failure-canvas");
      writeFileSync(join(outDir, "failure-window-ids.json"), JSON.stringify(await page.evaluate(() => window.__engine?.dev?.windowIds?.() ?? []), null, 2));
    } catch {
      // Best-effort diagnostic capture.
    }
  }
  writeFileSync(join(outDir, "console.log"), consoleLines.join("\n"));
  throw error;
} finally {
  await browser.close();
}
