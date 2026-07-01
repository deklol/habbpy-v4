// Focused diagnostic smoke: log in one client, enter a windowed room (Codex Test LAB
// flat 224520 by default), and dump the LIVE landscape/cloud animation-manager state
// from the engine — so we can see which runtime gate is keeping the clouds from
// rendering, instead of guessing. Runs against the editable engine via
// HABBPY_V4_SHOCKLESS_ENGINE_ROOT. Reads engine state directly through the game
// webview's executeJavaScript (the same path the visible-session smoke uses).
import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = resolve(import.meta.dirname, "..");
const electronExecutable = require("electron");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = resolve(repoRoot, "logs", "automation", `landscape-diag-${stamp}.json`);
const accountFile = process.env.LDIAG_ACCOUNT_FILE || "multiclient-accounts.txt";
const roomId = String(process.env.LDIAG_ROOM_ID || "224520").trim();
const clientId = 2;

await mkdir(dirname(reportPath), { recursive: true });

const report = { ok: false, roomId, createdAt: new Date().toISOString(), commands: [], dumps: [], consoleErrors: [] };
let app;
let page;

try {
  app = await electron.launch({
    executablePath: electronExecutable,
    // Anti-throttle flags: an offscreen/backgrounded window is otherwise throttled to
    // zero RAF, which starves the engine's Director tick so nothing ever loads.
    args: [
      "dist/main/main/main.js",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
    cwd: repoRoot,
    env: {
      ...process.env,
      HABBPY_V4_MAIN_WINDOW_SHOW: "1",
      HABBPY_V4_SHOCKLESS_ENGINE_ROOT: process.env.HABBPY_V4_SHOCKLESS_ENGINE_ROOT || resolve(repoRoot, "engine"),
    },
    timeout: 60000,
  });
  page = await app.firstWindow({ timeout: 60000 });
  // Render ON-SCREEN — an offscreen window won't composite, so RAF (and the engine's
  // Director tick) never fires and nothing loads. A visible window is the reliable driver.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      w.setBounds({ x: 40, y: 40, width: 1500, height: 860 }, false);
      w.show();
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(m.text().slice(0, 300));
  });

  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(4000);

  await runConsole(page, `load ${accountFile} 1 --concurrency 1`);
  await page.waitForFunction(
    () => Boolean(document.querySelector(`.game-webview-zoom-surface[data-client-id="2"] webview`)),
    undefined,
    { timeout: 120000 },
  );
  // wait for actual LOGIN (session userName present), not just the webview mount
  const login = await waitForLogin(page, 150000);
  report.login = login;

  await runConsole(page, `@${clientId} enterroom ${roomId}`);
  const room = await waitForRoom(page, roomId, 120000);
  report.roomReadyRaw = room;
  await closeConsole(page);

  // dump regardless of whether readiness was positively detected — we want the data
  await page.waitForTimeout(8000);
  report.dumps.push({ phase: "initial", ...(await dumpLandscape(page)) });

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setBounds({ x: -32000, y: -32000, width: 1820, height: 980 }, false);
  });
  await page.waitForTimeout(6000);
  report.dumps.push({ phase: "after-resize", ...(await dumpLandscape(page)) });

  report.ok = report.dumps.some((d) => d.anim && !d.anim.error);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\nLANDSCAPE DIAG REPORT: ${reportPath}`);
  for (const d of report.dumps) console.log(`[${d.phase}] ${summarize(d)}`);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  report.error = error instanceof Error ? error.stack || error.message : String(error);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`Landscape diag failed. Report: ${reportPath}\n${report.error}`);
  process.exitCode = 1;
} finally {
  if (app) await app.close().catch(() => null);
}

async function dumpLandscape(page) {
  return page.evaluate(async (cid) => {
    const surface = document.querySelector(`.game-webview-zoom-surface[data-client-id="${cid}"]`);
    const webview = surface?.querySelector("webview");
    if (!webview) return { error: "webview not mounted" };
    const code = `(() => {
      const root = window.__engine; const dev = root && root.dev;
      const op = (id) => { try { return root.objectProps(id); } catch (e) { return { error: String((e && e.message) || e) }; } };
      const safe = (fn, ...a) => { try { return typeof fn === "function" ? fn(...a) : null; } catch (e) { return { error: String((e && e.message) || e) }; } };
      const g = (p, ...ks) => { for (const k of ks) { const v = p && p[k]; if (v !== undefined) return v && typeof v === "object" && "value" in v ? v.value : v; } return undefined; };
      const pick = (s) => { if (!s || typeof s !== "object") return s; const p = s.props || s; const m = p.member; return { n: g(p,"number","spriteNumber"), loc: [g(p,"loch","locH"), g(p,"locv","locV")], locz: g(p,"locz","locZ"), visible: g(p,"visible"), blend: g(p,"blend"), ink: g(p,"ink"), member: m && typeof m === "object" ? g(m.props||m,"name") : m, rect: s.rect }; };
      const anim = op("landscape_animation_manager"); const ap = (anim && (anim.props || anim)) || {};
      const list = ap.paniminstancelist || ap.pAnimInstanceList;
      const instances = list && (list.count != null ? list.count : (list.items || list.entries || []).length);
      const cloudNum = Number((String(g(ap,"psprite","pSprite") || "").match(/sprite (\\d+)/) || [])[1] || 0);
      return {
        hasEngine: Boolean(root),
        roomReady: safe(dev && dev.roomReady),
        perf: safe(dev && dev.performanceStats),
        zoom: safe(dev && dev.roomStageZoom),
        resize: safe(dev && dev.resizeEngine),
        anim: { stopped: g(ap,"pstopped","pStopped"), memberCount: g(ap,"panimmembercount","pAnimMemberCount"), instances, mask: String(g(ap,"pmaskimage","pMaskImage") || ""), cloudNum },
        cloudSprite: cloudNum ? pick(safe(dev && dev.spriteDebug, cloudNum)) : null,
        landscapeSprites: (safe(dev && dev.resolvedSprites, "landscape") || []).map(pick),
        wallSprites: (safe(dev && dev.resolvedSprites, "wall") || []).slice(0, 3).map(pick),
      };
    })()`;
    try {
      return await webview.executeJavaScript(code, true);
    } catch (e) {
      return { error: String((e && e.message) || e) };
    }
  }, clientId);
}

function summarize(d) {
  if (!d || d.error) return `ERROR ${d?.error ?? "?"}`;
  const a = d.anim || {};
  const perf = d.perf || {};
  const raf = perf.rafPerSecond ?? perf.fps ?? "?";
  const cs = d.cloudSprite || {};
  const ls = (d.landscapeSprites || [])[0] || {};
  const fmt = (s) => (s ? `n=${s.n} loc=[${s.loc}] z=${s.locz} vis=${s.visible} ink=${s.ink} blend=${s.blend} rect=${JSON.stringify(s.rect)}` : "none");
  return [
    `room=${d.roomReady?.ready ?? d.roomReady} raf=${raf}`,
    `anim{ stopped=${a.stopped} memberCount=${a.memberCount} instances=${a.instances} mask=${a.mask} cloudNum=${a.cloudNum} }`,
    `cloudSprite{ ${fmt(cs)} }`,
    `landscapeSprite{ ${fmt(ls)} } (of ${(d.landscapeSprites || []).length})`,
    `zoom=${JSON.stringify(d.zoom)?.slice(0, 160)}`,
  ].join("\n  ");
}

async function runConsole(page, command) {
  await openConsole(page);
  const input = page.getByLabel("Packet console command");
  await input.fill(command);
  await input.press("Enter");
  report.commands.push(command.replace(/\S+@\S+/g, "[acct]"));
  await page.waitForTimeout(800);
}

async function openConsole(page) {
  const input = page.getByLabel("Packet console command");
  if (await input.isVisible().catch(() => false)) return;
  await page.keyboard.press("Backquote");
  await input.waitFor({ state: "visible", timeout: 10000 });
}

async function closeConsole(page) {
  const close = page.getByLabel("Close packet log console");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForTimeout(250);
  }
}

async function evalWebview(page, code) {
  return page.evaluate(
    async ({ cid, code }) => {
      const surface = document.querySelector(`.game-webview-zoom-surface[data-client-id="${cid}"]`);
      const webview = surface?.querySelector("webview");
      if (!webview) return { error: "webview not mounted" };
      try {
        return await webview.executeJavaScript(code, true);
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    },
    { cid: clientId, code },
  );
}

async function waitForLogin(page, timeoutMs) {
  const code = `(() => { try { const s = window.__engine && window.__engine.objectProps && window.__engine.objectProps("Session"); return { hasEngine: Boolean(window.__engine), session: Boolean(s), raw: s ? JSON.stringify(s).length : 0 }; } catch (e) { return { error: String((e && e.message) || e) }; } })()`;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalWebview(page, code);
    if (last && last.session && last.raw > 50) return last;
    await page.waitForTimeout(3000);
  }
  return last;
}

// Non-fatal: poll roomReady, return the last raw value so the run always proceeds to a dump.
async function waitForRoom(page, expectedRoomId, timeoutMs) {
  const code = `(() => { try { const d = window.__engine && window.__engine.dev; const r = d && d.roomReady && d.roomReady(); return r ?? null; } catch (e) { return { error: String((e && e.message) || e) }; } })()`;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalWebview(page, code);
    const ok = last === true || last?.ready === true;
    const rid = String(last?.roomId ?? last?.flatId ?? "");
    if (ok && (!rid || rid === String(expectedRoomId))) return last;
    await page.waitForTimeout(2500);
  }
  return last;
}
