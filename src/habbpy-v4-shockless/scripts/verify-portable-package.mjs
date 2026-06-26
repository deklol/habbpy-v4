import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const portableRoot = resolve(process.argv[2] ?? join(workspace, "dist", "portable", "HabbpyV4"));
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".txt"]);
const premadeModuleIds = readPremadeModuleIds(join(portableRoot, "plugins", "_premade-modules"));
const requiredFiles = [
  "Habbpy v4.exe",
  "README.txt",
  "resources/app/package.json",
  "resources/app/dist/main/main/main.js",
  "resources/app/dist/main/main/profileImportRunner.js",
  "resources/app/dist/main/main/shocklessEmbed.js",
  "resources/app/dist/plugins/template/habbpy.plugin.json",
  "resources/app/dist/plugins/template/plugin.js",
  "resources/app/dist/plugins/template/README.md",
  "plugins/welcome-message/habbpy.plugin.json",
  "plugins/welcome-message/plugin.js",
  "plugins/welcome-message/README.md",
  "plugins/_premade-modules/README.md",
  ...premadeModuleIds.flatMap((id) => [
    `plugins/_premade-modules/${id}/habbpy.plugin.json`,
    `plugins/_premade-modules/${id}/plugin.js`,
    `plugins/_premade-modules/${id}/README.md`,
  ]),
  "resources/engine/dist/index.html",
  "resources/engine/standalone/package.json",
  "resources/engine/standalone/dist/main/cli/profile-import.js",
  "resources/engine/standalone/resources/projectorrays/projectorrays-0.2.0.exe",
  "resources/engine/standalone/resources/compiler/profile-script-compiler.mjs",
  "resources/engine/standalone/resources/extraction/build-projectorrays-manifest.mjs",
  "resources/engine/standalone/resources/extraction/node_modules/jpeg-js/package.json",
  "resources/engine/standalone/resources/extraction/node_modules/jpeg-js/index.js",
  "resources/relay/origins-relay.mjs",
  "resources/relay/shockwave-codec.mjs",
  "resources/relay/bobba-crypto.mjs",
];
const forbiddenFileNames = new Set(["goal.md", "multiclient-accounts.txt"]);
const forbiddenTextPatterns = [
  /[A-Z]:[\\/](?:Users[\\/]dekky|habbo|habbpy|slopwave)/i,
  /C:[\\/]Users[\\/]dekky/i,
  /F:[\\/](?:habbo|habbpy|slopwave)/i,
];

if (!existsSync(portableRoot) || !statSync(portableRoot).isDirectory()) {
  fail(`Portable root is missing: ${portableRoot}`);
}

const missing = requiredFiles.filter((file) => !fileExists(join(portableRoot, file)));
if (missing.length > 0) {
  fail(`Portable package is missing required file(s): ${missing.join(", ")}`);
}

const copiedForbiddenFiles = [];
const leakedText = [];
let standaloneResourceFileCount = 0;
let standaloneResourceBytes = 0;

for (const filePath of walk(portableRoot)) {
  const name = basename(filePath);
  if (forbiddenFileNames.has(name.toLowerCase())) {
    copiedForbiddenFiles.push(relative(portableRoot, filePath));
  }
  if (filePath.includes(`${join("resources", "engine", "standalone", "resources")}`)) {
    standaloneResourceFileCount += 1;
    standaloneResourceBytes += statSync(filePath).size;
  }
  if (!textExtensions.has(extname(filePath).toLowerCase())) continue;
  const text = readFileSync(filePath, "utf8");
  for (const pattern of forbiddenTextPatterns) {
    if (pattern.test(text)) {
      leakedText.push(relative(portableRoot, filePath));
      break;
    }
  }
}

if (copiedForbiddenFiles.length > 0) {
  fail(`Portable package copied private local file(s): ${copiedForbiddenFiles.join(", ")}`);
}
if (leakedText.length > 0) {
  fail(`Portable package contains local absolute path needle(s): ${leakedText.join(", ")}`);
}
if (standaloneResourceFileCount < 10 || standaloneResourceBytes < 1_000_000) {
  fail("Portable package does not contain the expected standalone importer resource payload.");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      portableRoot: relative(workspace, portableRoot),
      requiredFiles: requiredFiles.length,
      standaloneResourceFileCount,
      standaloneResourceBytes,
      forbiddenFilesCopied: copiedForbiddenFiles.length,
      localAbsolutePathNeedles: leakedText.length,
    },
    null,
    2,
  ),
);

function fileExists(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readPremadeModuleIds(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function* walk(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const filePath = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walk(filePath);
    } else if (entry.isFile()) {
      yield filePath;
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
