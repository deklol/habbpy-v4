import { chromium } from "playwright";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const url = process.env.HABBPY_V4_SCREENSHOT_URL || "http://127.0.0.1:5178/";
const outDir = process.env.HABBPY_V4_SCREENSHOT_DIR || "screenshots/shell";
await mkdir(outDir, { recursive: true });
const runStamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace("Z", "");

async function uniqueScreenshotPath(baseName) {
  const first = path.join(outDir, `${baseName}-${runStamp}.png`);
  if (!(await fileExists(first))) return first;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(outDir, `${baseName}-${runStamp}-${index}.png`);
    if (!(await fileExists(candidate))) return candidate;
  }
  throw new Error(`Could not allocate screenshot path for ${baseName}`);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1288, height: 656 } });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  const defaultPath = await uniqueScreenshotPath("shell-default");
  await page.screenshot({ path: defaultPath, fullPage: true });
  await page.getByRole("button", { name: "Collapse plugin dock" }).click();
  const collapsedPath = await uniqueScreenshotPath("shell-collapsed");
  await page.screenshot({ path: collapsedPath, fullPage: true });
  await page.getByRole("button", { name: "Expand plugin dock" }).click();
  await page.getByPlaceholder("Search plugins").fill("dev");
  const searchPath = await uniqueScreenshotPath("shell-search-dev");
  await page.screenshot({ path: searchPath, fullPage: true });
  const manifestPath = path.join(outDir, `shell-run-${runStamp}.json`);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        url,
        viewport: { width: 1288, height: 656 },
        screenshots: {
          default: defaultPath,
          collapsed: collapsedPath,
          searchDev: searchPath,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Screenshots written to ${outDir}`);
  console.log(`Manifest: ${manifestPath}`);
} finally {
  if (browser) {
    await browser.close();
  }
}
