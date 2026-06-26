#!/usr/bin/env node
import { copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = join(workspaceRoot, "release");
const portableOldRoot = join(releaseRoot, "release", "HabbpyV4");
const portableRoot = join(releaseRoot, "portable", "HabbpyV4");
const appSourceRoot = join(releaseRoot, "src", "habbpy-v4-shockless");
const engineSourceRoot = join(releaseRoot, "src", "habbo-origins-engine");
const rootDocs = join(releaseRoot, "docs");
const artifactsRoot = join(releaseRoot, "artifacts");
const privatePremadePluginIds = await readPrivatePremadePluginIds();

const agplLicensePath = join(resolve(workspaceRoot, "..", "habbo-origins-engine"), "LICENSE");
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".mjs", ".rst", ".txt", ".ts", ".tsx", ".cts", ".xml", ".yml", ".yaml"]);

await main();

async function main() {
  assertInsideWorkspace(releaseRoot);
  await assertPathExists(releaseRoot, "release folder");
  await normalizePortableLayout();
  await removeSafe(artifactsRoot);
  await mkdir(artifactsRoot, { recursive: true });
  await convertReadmesToText(releaseRoot);
  await writePublicReadme();
  await writeLicense();
  await writeCleanDocs();
  await replaceSourceDocs();
  await writeSourceReadmes();
  await patchReleaseSourceScripts();
  await removePrivatePremadeModules();
  await removeInternalAndMarkdownFiles();
  await sanitizePublicDocReferences();
  await sanitizeTextFiles();
  const verification = await verifyPublicRelease();
  await writeReleaseManifest(verification);
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.ok) process.exitCode = 1;
}

async function normalizePortableLayout() {
  if (existsSync(portableOldRoot)) {
    await removeSafe(join(releaseRoot, "portable"));
    await mkdir(join(releaseRoot, "portable"), { recursive: true });
    await cp(portableOldRoot, portableRoot, { recursive: true, force: true });
  }
  await removeSafe(join(releaseRoot, "release"));
}

async function convertReadmesToText(root) {
  for (const file of await listFiles(root)) {
    if (basename(file).toLowerCase() !== "readme.md") continue;
    const target = join(dirname(file), "README.txt");
    if (!existsSync(target)) await copyFile(file, target);
  }
}

async function writePublicReadme() {
  const screenshots = await releaseScreenshotSection();
  const text = `Habbpy v4
=========

Habbpy v4 is a local desktop companion shell for the Shockless engine. It packages a playable Windows app, the Habbpy v4 application source, and the Shockless engine source needed to rebuild, audit, or modify the project under the GNU Affero General Public License v3.0.

What It Is
----------

Habbpy v4 wraps a modern Shockwave-compatible runtime in an Electron desktop shell. The app can import a user-supplied compiled client into a playable Shockless profile, embed that profile in the GameHost, expose live session and packet state, and run first-party or user-installed plugins through a restricted plugin API.

How It Works
------------

- The Electron main process manages app lifecycle, client profile import, portable packaging, and visible or hidden runtime sessions.
- The React renderer provides the GameHost, right-side plugin dock, backtick console, packet log, client importer, plugin manager, and module panels.
- Shockless runs the imported client in a browser runtime and exposes controlled engine/session hooks back to Habbpy v4.
- The relay and packet-log layers parse live client/server traffic into readable packet rows for panels, console output, and plugin events.
- User plugins run in a restricted Worker host. Plugins request named permissions and call grouped APIs for rooms, users, furni, chat, packets, sessions, storage, timers, and UI panels.

Languages And Stack
-------------------

- TypeScript and JavaScript
- React
- Electron
- Vite
- Node.js
- Playwright-based automation and screenshot checks
- Shockless engine runtime with browser-rendered Director/Shockwave compatibility layers

${screenshots}License
-------

This public release is provided under the GNU Affero General Public License v3.0. See LICENSE in this folder.

Release Layout
--------------

- \`\`habbpy-v4-portable-windows.zip\`\` from GitHub Releases
  Ready-to-run Windows portable build. Extract the full \`\`HabbpyV4\`\` folder and run \`\`Habbpy v4.exe\`\` from inside it. This archive includes the bundled Shockless importer resources required by \`\`Import/Build Client\`\`.

- \`\`habbpy-v4-source-agplv3.zip\`\` or a GitHub source checkout
  Source and public documentation only. This does not include the portable executable or built Shockless importer resources until you build them locally.

- src/habbpy-v4-shockless
  Electron/React application source, plugin manager, packet log, multi-session shell, relay bridge, and plugin API.

- src/habbo-origins-engine
  Shockless engine source and standalone importer source used by Habbpy v4.

- docs
  Public HTML documentation with clean file names.

Key Features
------------

- Portable Windows desktop build.
- Client import/build flow for user-supplied compiled client folders or existing Shockless profiles.
- Embedded game view with responsive stage sizing, zoom controls, session switcher, and collapsible plugin dock.
- Plugin manager for bundled plugins and user-installed plugins.
- Plugin template and public HTML API documentation for writing custom plugins.
- Backtick console for session commands and readable packet/session output.
- Packet log panel with client/server/relay filters and per-session filtering.
- Multi-session control surface for visible and hidden sessions.
- Runtime panels for connection/session state, room state, users, inventory, items, chat, social state, packet inspection, and developer diagnostics.

How To Import A Client
----------------------

1. Download \`\`habbpy-v4-portable-windows.zip\`\` from GitHub Releases.
2. Extract the full \`\`HabbpyV4\`\` folder.
3. Run \`\`HabbpyV4/Habbpy v4.exe\`\`.
4. Open the Connection panel and choose \`\`Import/Build Client\`\`.
5. Select either a compiled Habbo client folder or an existing Shockless profile folder.
6. Leave the importer open while it validates the folder, copies the client, indexes casts, extracts text, prepares assets, prepares scripts, and validates the playable profile.
7. When the profile is ready, select it in the client library and press \`\`Start\`\`.

Do not run a plain GitHub source checkout as if it were the portable app. Source checkouts must be built first so \`\`resources/engine/standalone/dist/main/cli/profile-import.js\`\` exists.

Imported playable profiles are stored beside the portable app in its local client profile folder and are reused on later launches. Habbpy v4 does not hardcode client build folders; the importer discovers the selected folder and builds or reuses the matching playable profile.

Requirements For Rebuilding
---------------------------

- Node.js 20 or newer
- npm
- Windows for the portable packaging flow

Build From Source
-----------------

Open PowerShell in this release folder.

Build the engine::

   cd src/habbo-origins-engine
   npm install
   npm run build
   cd standalone
   npm install
   npm run compile

Build and package the desktop app::

   cd ../../habbpy-v4-shockless
   npm install
   npm run package:portable

The packaged app is written to \`\`src/habbpy-v4-shockless/dist/portable/HabbpyV4\`\`. The app packaging script expects \`\`src/habbo-origins-engine\`\` to sit beside \`\`src/habbpy-v4-shockless\`\`, which is already how this release is laid out. \`\`npm run package:portable\`\` verifies that the Shockless standalone profile importer and ProjectorRays resources are included before the package is considered valid.

Limitations
-----------

- The packaged portable flow targets Windows.
- A playable client is not bundled. Users must import their own compatible compiled client folder or existing Shockless profile.
- Live online features require a working network connection and user-owned credentials entered locally at runtime.
- Client/server compatibility depends on the imported client build and the target service version.
- User plugins are intentionally sandboxed. APIs that touch packets, session control, or engine actions require explicit plugin permissions and validated payloads.
- Director/Shockwave compatibility is still evolving; plugin authors should test against the client build they plan to use.
`;
  await removeSafe(join(releaseRoot, "README.txt"));
  await writeFile(join(releaseRoot, "README.rst"), text, "utf8");
}

async function releaseScreenshotSection() {
  const screenshotRoot = join(releaseRoot, "media", "screenshots");
  if (!existsSync(screenshotRoot)) return "";
  const files = (await readdir(screenshotRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => entry.name);
  if (files.length === 0) return "";
  const preferredOrder = [
    "main-ui-plugin-dock-closed-20260623-164528.png",
    "game-room-codex-test-lab-20260623-074701.png",
  ];
  const orderedFiles = [
    ...preferredOrder.filter((name) => files.includes(name)),
    ...files.filter((name) => !preferredOrder.includes(name)).sort((a, b) => a.localeCompare(b)),
  ];
  const captions = new Map([
    ["main-ui-plugin-dock-closed-20260623-164528.png", "Main app UI with the plugin dock closed"],
    ["game-room-codex-test-lab-20260623-074701.png", "Embedded Shockless room view"],
  ]);
  const images = orderedFiles
    .map((file) => {
      const caption = captions.get(file) ?? file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      return `.. image:: media/screenshots/${file}
   :alt: Habbpy v4 ${caption}

${caption}

`;
    })
    .join("");
  return `Screenshots
-----------

${images}`;
}

async function writeLicense() {
  if (existsSync(agplLicensePath)) {
    await copyFile(agplLicensePath, join(releaseRoot, "LICENSE"));
    return;
  }
  await writeFile(
    join(releaseRoot, "LICENSE"),
    "GNU Affero General Public License v3.0\n\nSee https://www.gnu.org/licenses/agpl-3.0.txt\n",
    "utf8",
  );
}

async function writeCleanDocs() {
  await removeSafe(rootDocs);
  await mkdir(rootDocs, { recursive: true });

  await writeFile(join(rootDocs, "index.html"), docsIndexPage(), "utf8");

  await writeHtmlDoc("getting-started.html", "Getting Started", [
    paragraph("For normal use, download habbpy-v4-portable-windows.zip from GitHub Releases, extract the full HabbpyV4 folder, then run HabbpyV4/Habbpy v4.exe. The portable archive includes the Shockless importer resources used by Import/Build Client."),
    paragraph("A GitHub source checkout or source archive is not the portable app. Build from source first if you want to run from source."),
    heading("Import A Client"),
    paragraph("Use Import/Build Client inside the app and select a compiled client folder or an existing Shockless profile. The portable stores playable profiles beside the executable in a local clients folder. When validation finishes, select the imported profile from the client library and press Start."),
    heading("Plugins"),
    paragraph("Bundled plugins live in the portable plugins folder. Installable examples and premade module sources are included so users can inspect and adapt plugin code."),
  ]);

  await writeHtmlDoc("building-from-source.html", "Building From Source", [
    paragraph("The source tree is laid out so the desktop app and engine are sibling folders under src. A source checkout does not include the packaged Shockless importer; build the engine standalone package before packaging Habbpy v4."),
    code(`cd src/habbo-origins-engine
npm install
npm run build
cd standalone
npm install
npm run compile

cd ../../habbpy-v4-shockless
npm install
npm run package:portable`),
    paragraph("The desktop packaging script discovers the sibling engine folder automatically from this release layout. The portable output is written to src/habbpy-v4-shockless/dist/portable/HabbpyV4 and the package verifier checks that resources/engine/standalone/dist/main/cli/profile-import.js and the importer resource payload are present."),
    paragraph("If Import/Build Client reports that the Shockless profile importer was not found, rebuild the standalone importer with npm --prefix ../habbo-origins-engine/standalone run compile from src/habbpy-v4-shockless, then run npm run package:portable again."),
  ]);

  await writeHtmlDoc("release-layout.html", "Release Layout", [
    list([
      "habbpy-v4-portable-windows.zip - ready-to-run Windows portable archive from GitHub Releases. Extract the full HabbpyV4 folder and run Habbpy v4.exe.",
      "habbpy-v4-source-agplv3.zip or GitHub source checkout - source and public documentation only. Build the engine standalone importer before using Import/Build Client from source.",
      "src/habbpy-v4-shockless - app source, plugin manager, packet log, multi-session shell, relay bridge, and plugin API.",
      "src/habbo-origins-engine - Shockless engine source and standalone importer source.",
      "docs - public HTML documentation.",
    ]),
  ]);

  await writeHtmlDoc("engine-overview.html", "Engine Overview", [
    paragraph("Shockless is a browser engine/runtime compatible with Director/Shockwave-era Habbo clients. It provides source-aware runtime services, rendering, networking, and standalone profile import resources used by Habbpy v4."),
    paragraph("The importer creates playable profile outputs locally from user-selected client folders. This source release focuses on the app, engine, plugin examples, and public documentation needed to rebuild and modify the project."),
  ]);

  await convertMarkdownDoc("plugin-authoring.html", "Plugin Authoring", join(workspaceRoot, "docs", "plugin-authoring.md"));
  await convertMarkdownDoc("console-commands.html", "Console Commands", join(workspaceRoot, "docs", "backtick-console-commands.md"));
  await convertMarkdownDoc("multi-client.html", "Multi-Client Sessions", join(workspaceRoot, "docs", "multi-account-sessions.md"));

  const wikiSource = join(workspaceRoot, "docs", "plugin-api-wiki.html");
  if (existsSync(wikiSource)) {
    let html = await readFile(wikiSource, "utf8");
    html = html
      .replaceAll("Plugin API Wiki", "Plugin API")
      .replaceAll("../public/fonts", "../src/habbpy-v4-shockless/public/fonts");
    await writeFile(join(rootDocs, "plugin-api.html"), html, "utf8");
  } else {
    await convertMarkdownDoc("plugin-api.html", "Plugin API", join(workspaceRoot, "docs", "plugin-api-reference.md"));
  }
}

async function replaceSourceDocs() {
  const appDocs = join(appSourceRoot, "docs");
  const engineDocs = join(engineSourceRoot, "docs");
  await removeSafe(appDocs);
  await mkdir(appDocs, { recursive: true });
  for (const file of await listFiles(rootDocs)) {
    await copyFile(file, join(appDocs, basename(file)));
  }

  await removeSafe(engineDocs);
  await mkdir(engineDocs, { recursive: true });
  await writeFile(
    join(engineDocs, "engine-overview.html"),
    htmlPage("Engine Overview", [
      paragraph("Shockless engine source is included for rebuilding and modification."),
      paragraph("Generated runtime profile outputs are created locally by the importer from selected client folders."),
    ]),
    "utf8",
  );
  await writeFile(
    join(engineDocs, "building-engine.html"),
    htmlPage("Building The Engine", [
      code(`cd src/habbo-origins-engine
npm install
npm run build
cd standalone
npm install
npm run compile`),
      paragraph("The standalone compile step writes dist/main/cli/profile-import.js, which Habbpy v4 packages for Import/Build Client."),
    ]),
    "utf8",
  );
}

async function writeSourceReadmes() {
  await writeFile(
    join(appSourceRoot, "README.txt"),
    `Habbpy v4 Application Source
==============================

This folder contains the Electron/React desktop application, plugin manager, user plugin host, packet log reader, relay bridge integration, and portable packaging scripts.

License: GNU Affero General Public License v3.0.

Build:

  npm install
  npm run build

Package portable:

  npm --prefix ../habbo-origins-engine/standalone install
  npm --prefix ../habbo-origins-engine/standalone run compile
  npm run package:portable

The sibling engine source is expected at ../habbo-origins-engine in this release layout. Import/Build Client needs the built Shockless standalone importer at ../habbo-origins-engine/standalone/dist/main/cli/profile-import.js.

Public docs are in ../../docs and this folder's docs directory.
`,
    "utf8",
  );

  await writeFile(
    join(engineSourceRoot, "README.txt"),
    `Shockless Engine Source
=======================

This folder contains the Shockless engine source and standalone importer source used by Habbpy v4.

License: GNU Affero General Public License v3.0.

Build:

  npm install
  npm run build
  cd standalone
  npm install
  npm run compile

The standalone compile step generates dist/main/cli/profile-import.js and the browser/runtime assets that Habbpy v4 packages into its portable Import/Build Client flow.

Generated clients, local caches, extracted reference corpora, and direction notes are not included in this public release.
`,
    "utf8",
  );
}

async function patchReleaseSourceScripts() {
  const replacements = [
    [join(appSourceRoot, "scripts", "generate-premade-plugin-sources.mjs"), [["README.md", "README.txt"]]],
    [join(appSourceRoot, "scripts", "package-portable.mjs"), [["README.md", "README.txt"]]],
    [join(appSourceRoot, "scripts", "verify-portable-package.mjs"), [["README.md", "README.txt"], ['".md", ', ""]]],
  ];
  for (const [file, pairs] of replacements) {
    if (!existsSync(file)) continue;
    let text = await readFile(file, "utf8");
    for (const [from, to] of pairs) text = text.split(from).join(to);
    await writeFile(file, text, "utf8");
  }

  const packageJsonPath = join(appSourceRoot, "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packageJson.license = "AGPL-3.0-only";
    packageJson.private = false;
    packageJson.description = "Desktop companion shell for the Shockless engine";
    delete packageJson.scripts?.["generate:premade-plugins"];
    if (typeof packageJson.scripts?.["package:portable"] === "string") {
      packageJson.scripts["package:portable"] = packageJson.scripts["package:portable"].replace("npm run generate:premade-plugins && ", "");
    }
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  }

  const enginePackagePath = join(engineSourceRoot, "package.json");
  if (existsSync(enginePackagePath)) {
    const packageJson = JSON.parse(await readFile(enginePackagePath, "utf8"));
    packageJson.license = "AGPL-3.0-only";
    packageJson.private = false;
    delete packageJson.scripts?.["dev:webhook"];
    await writeFile(enginePackagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  }

  await removeSafe(join(appSourceRoot, "scripts", "generate-premade-plugin-sources.mjs"));
}

async function removePrivatePremadeModules() {
  if (privatePremadePluginIds.length === 0) return;
  for (const id of privatePremadePluginIds) {
    await removeSafe(join(appSourceRoot, "examples", "premade-plugins", id));
    await removeSafe(join(portableRoot, "plugins", "_premade-modules", id));
  }
}

async function removeInternalAndMarkdownFiles() {
  const forbiddenDirs = new Set([".agents", "ref", "generated", "exports", "compiled", "tmp"]);
  const forbiddenNames = new Set([
    "goal.md",
    "multiclient-accounts.txt",
    "agents.md",
    "uncompleted.md",
    "design.md",
    "plan.md",
    "idea.txt",
    "send-discord-webhook.mjs",
    ".private-premade-modules.json",
  ]);
  for (const entry of await listEntriesDeep(releaseRoot)) {
    const lowerName = basename(entry.path).toLowerCase();
    if (entry.isDirectory && forbiddenDirs.has(lowerName)) {
      await removeSafe(entry.path);
      continue;
    }
    if (!entry.isFile) continue;
    if (extname(entry.path).toLowerCase() === ".md" || forbiddenNames.has(lowerName)) {
      await removeSafe(entry.path);
    }
  }
}

async function sanitizePublicDocReferences() {
  const targets = [
    rootDocs,
    join(appSourceRoot, "docs"),
    join(engineSourceRoot, "docs"),
    join(appSourceRoot, "README.txt"),
    join(engineSourceRoot, "README.txt"),
    join(releaseRoot, "README.rst"),
  ];
  for (const target of targets) {
    const files = existsSync(target) && (await stat(target)).isDirectory() ? await listFiles(target) : [target];
    for (const file of files) {
      if (!existsSync(file) || !isTextFile(file)) continue;
      let text = await readFile(file, "utf8");
      const next = text
        .replaceAll("README.md", "README.txt")
        .replaceAll("plugin-api-reference.md", "plugin-api.html")
        .replaceAll("plugin-authoring.md", "plugin-authoring.html")
        .replaceAll("backtick-console-commands.md", "console-commands.html")
        .replaceAll("multi-account-sessions.md", "multi-client.html")
        .replaceAll("playability-slice.md", "getting-started.html")
        .replaceAll("UNCOMPLETED.md", "release-layout.html")
        .replace(/<a href="xabbo-plugin-api-inspiration\.md"><code>xabbo-plugin-api-inspiration\.md<\/code><\/a>[^<]*(?:<[^>]+>[^<]*){0,3}/g, "plugin architecture notes.")
        .replaceAll("xabbo-plugin-api-inspiration.md", "plugin architecture notes")
        .replaceAll("docs/NEXT_STEPS.md", "public docs")
        .replaceAll("docs/CURRENT_STATE.md", "public docs")
        .replaceAll("docs/DEV_AUTOMATION_API.md", "engine runtime API")
        .replaceAll("docs/REMOTE_PLAY_API.md", "engine runtime API");
      if (next !== text) await writeFile(file, next, "utf8");
    }
  }
}

async function sanitizeTextFiles() {
  const privateNeedles = await readPrivateNeedles();
  for (const file of await listFiles(releaseRoot)) {
    if (!isTextFile(file)) continue;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    let next = text
      .replace(/C:\\Users\\dekky(?:\\[^\s`'"<>)\]]+)*/gi, "<local-user-path>")
      .replace(/F:\\habbpy-v4-shockless(?:\\[^\s`'"<>)\]]+)*/gi, "<habbpy-v4-source-path>")
      .replace(/F:\\habbo-origins-engine(?:\\[^\s`'"<>)\]]+)*/gi, "<shockless-engine-source-path>")
      .replace(/https:\/\/discord\.com\/api\/webhooks\/[^\s`'"<>)\]]+/gi, "<discord-webhook-url-redacted>");
    for (const needle of privateNeedles) {
      next = next.split(needle).join("<private-test-value-redacted>");
    }
    if (next !== text) await writeFile(file, next, "utf8");
  }
}

async function verifyPublicRelease() {
  const files = await listFiles(releaseRoot);
  const findings = [];
  const privateValues = await readPrivateNeedles();
  for (const file of files) {
    const rel = normalize(relative(releaseRoot, file));
    const lower = rel.toLowerCase();
    const parts = lower.split("/");
    if (lower.endsWith(".md")) findings.push({ type: "markdown-file", path: rel });
    if (parts.includes(".agents") || lower.includes("agents.md")) findings.push({ type: "agent-file", path: rel });
    if (/(^|\/)(goal\.md|multiclient-accounts\.txt|design\.md|plan\.md|idea\.txt|uncompleted\.md)$/i.test(lower)) {
      findings.push({ type: "private-or-direction-file", path: rel });
    }
    if (lower.includes("xabbo") || lower.includes("adobe_director") || lower.includes("drmx") || lower.includes("native-director") || lower.includes("rendering-pipeline")) {
      findings.push({ type: "reference-material", path: rel });
    }
    if (!isTextFile(file)) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    if (/https:\/\/discord\.com\/api\/webhooks\//i.test(text)) findings.push({ type: "webhook", path: rel });
    if (/C:\\Users\\dekky|F:\\habbpy-v4-shockless|F:\\habbo-origins-engine/i.test(text)) findings.push({ type: "local-path", path: rel });
    if ((lower === "readme.txt" || lower === "readme.rst") && /botting/i.test(text)) findings.push({ type: "readme-botting", path: rel });
    for (const value of privateValues) {
      if (text.includes(value)) {
        findings.push({ type: "private-value", path: rel });
        break;
      }
    }
  }
  return {
    ok: findings.length === 0,
    releaseRoot: "release",
    files: files.length,
    findings,
    paths: {
      portable: "portable/HabbpyV4/Habbpy v4.exe",
      appSource: "src/habbpy-v4-shockless",
      engineSource: "src/habbo-origins-engine",
      docs: "docs",
    },
  };
}

async function writeReleaseManifest(verification) {
  await writeFile(
    join(releaseRoot, "RELEASE_MANIFEST.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), ...verification }, null, 2)}\n`,
    "utf8",
  );
}

async function convertMarkdownDoc(fileName, title, sourcePath) {
  if (!existsSync(sourcePath)) {
    await writeHtmlDoc(fileName, title, [paragraph("Documentation source was not available in this workspace.")]);
    return;
  }
  const markdown = await readFile(sourcePath, "utf8");
  const html = markdownToHtml(markdown);
  await writeFile(join(rootDocs, fileName), htmlPage(title, [html], { raw: true }), "utf8");
}

async function writeHtmlDoc(fileName, title, blocks) {
  await writeFile(join(rootDocs, fileName), htmlPage(title, blocks), "utf8");
}

function docsNavItems() {
  return [
    { href: "index.html", title: "Documentation", label: "Home", summary: "Offline docs start page" },
    { href: "getting-started.html", title: "Getting Started", label: "Getting Started", summary: "Run the portable app and import a profile" },
    { href: "building-from-source.html", title: "Building From Source", label: "Build From Source", summary: "Install dependencies and package the app" },
    { href: "plugin-authoring.html", title: "Plugin Authoring", label: "Plugin Authoring", summary: "Create and install user plugins" },
    { href: "plugin-api.html", title: "Plugin API", label: "Plugin API", summary: "Complete plugin API reference" },
    { href: "console-commands.html", title: "Console Commands", label: "Console Commands", summary: "Backtick console command usage" },
    { href: "multi-client.html", title: "Multi-Client Sessions", label: "Multi-Client", summary: "Visible and hidden session control" },
    { href: "engine-overview.html", title: "Engine Overview", label: "Engine Overview", summary: "Shockless runtime overview" },
    { href: "release-layout.html", title: "Release Layout", label: "Release Layout", summary: "Files included in the public release" },
  ];
}

function docsIndexPage() {
  const cards = docsNavItems().filter((item) => item.href !== "index.html");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Habbpy v4 Documentation</title>
  <style>${docsCss()}</style>
</head>
<body>
  <div class="shell">
    ${docsSidebar("Documentation")}
    <main class="content">
      <section class="hero-window">
        <div class="titlebar">
          <div>
            <p class="eyebrow">Offline Documentation</p>
            <h1>Habbpy v4</h1>
          </div>
          <span class="status-pill">file:// ready</span>
        </div>
        <div class="hero-grid">
          <div>
            <p class="lead">Open this folder directly from disk. The documentation uses inline styles, bundled relative assets, and local links, so no web server is required.</p>
            <div class="quick-actions">
              <a class="button primary" href="getting-started.html">Getting Started</a>
              <a class="button" href="plugin-api.html">Plugin API</a>
              <a class="button" href="building-from-source.html">Build From Source</a>
            </div>
          </div>
          <div class="path-card">
            <span class="label">Open locally</span>
            <code>docs/index.html</code>
            <span class="hint">Relative links stay inside this docs folder.</span>
          </div>
        </div>
      </section>
      <section class="doc-window">
        <div class="section-heading">
          <p class="eyebrow">Contents</p>
          <h2>Documentation Index</h2>
        </div>
        <div class="card-grid">
          ${cards.map((card) => docsCard(card)).join("\n")}
        </div>
      </section>
    </main>
  </div>
</body>
</html>
`;
}

function docsCard(card) {
  return `<a class="doc-card" href="${escapeHtml(card.href)}"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.summary)}</strong></a>`;
}

function htmlPage(title, blocks, options = {}) {
  const body = options.raw ? blocks.join("\n") : blocks.join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - Habbpy v4</title>
  <style>${docsCss()}</style>
</head>
<body>
  <div class="shell">
    ${docsSidebar(title)}
    <main class="content">
      <section class="doc-window">
        <div class="titlebar">
          <div>
            <p class="eyebrow">Habbpy v4 Documentation</p>
            <h1>${escapeHtml(title)}</h1>
          </div>
          <a class="status-pill" href="index.html">Index</a>
        </div>
        <div class="doc-body">${body}</div>
      </section>
    </main>
  </div>
</body>
</html>
`;
}

function docsSidebar(currentTitle) {
  return `<aside class="sidebar">
      <a class="brand" href="index.html" aria-label="Habbpy v4 documentation home">
        <span class="brand-mark">H</span>
        <span><strong>Habbpy v4</strong><small>Public docs</small></span>
      </a>
      <nav class="nav" aria-label="Documentation sections">
        ${docsNavItems().map((item) => {
          const active = item.title === currentTitle ? " active" : "";
          return `<a class="nav-link${active}" href="${escapeHtml(item.href)}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.summary)}</small></a>`;
        }).join("\n")}
      </nav>
    </aside>`;
}

function docsCss() {
  return `
    @font-face {
      font-family: "Volter Goldfish";
      src: url("../src/habbpy-v4-shockless/public/fonts/volter/volter-goldfish.woff2") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: "Volter Goldfish";
      src: url("../src/habbpy-v4-shockless/public/fonts/volter/volter-bold-goldfish.woff2") format("woff2");
      font-weight: 700;
      font-style: normal;
      font-display: swap;
    }
    :root {
      color-scheme: dark;
      --font: "Volter Goldfish", "Segoe UI", Tahoma, sans-serif;
      --font-read: "Segoe UI", Tahoma, Arial, sans-serif;
      --mono: ui-monospace, "Cascadia Code", Consolas, monospace;
      --bg: #050505;
      --panel: #101010;
      --panel-2: #171717;
      --panel-3: #202020;
      --line: #2b2b2b;
      --text: #dedede;
      --muted: #9a9a9a;
      --dim: #656565;
      --gold: #e3b23a;
      --gold-dark: #9c7418;
      --shadow: #000;
      --bevel: inset 2px 2px 0 #2d2d2d, inset -2px -2px 0 #000;
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--bg); }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font: 14px/1.55 var(--font-read);
      background:
        repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 12px),
        linear-gradient(180deg, #0b0b0b 0%, #030303 100%);
    }
    a { color: inherit; }
    code, pre { font-family: var(--mono); }
    pre {
      overflow: auto;
      max-width: 100%;
      padding: 14px;
      background: #070707;
      border: 1px solid var(--line);
      box-shadow: var(--bevel);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
      display: block;
      overflow-x: auto;
      white-space: normal;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px;
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th { background: var(--panel-2); color: var(--gold); text-align: left; }
    .shell {
      display: grid;
      grid-template-columns: 276px minmax(0, 1120px);
      gap: 14px;
      min-height: 100vh;
      justify-content: center;
      padding: 12px;
      max-width: 100%;
    }
    .sidebar {
      min-width: 0;
      position: sticky;
      top: 12px;
      height: calc(100vh - 24px);
      overflow: auto;
      padding: 12px;
      background: var(--panel);
      box-shadow: 0 0 0 2px #000, var(--bevel);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 58px;
      padding: 8px;
      margin-bottom: 12px;
      color: var(--text);
      text-decoration: none;
      background: #151515;
      box-shadow: var(--bevel);
    }
    .brand-mark {
      width: 38px;
      height: 38px;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #f1c550, var(--gold-dark));
      color: #111;
      font: 700 20px/1 var(--font);
      box-shadow: 0 0 0 2px #000, inset 2px 2px 0 rgba(255,255,255,.24), inset -2px -2px 0 #5b4108;
    }
    .brand strong {
      display: block;
      font: 700 15px/1 var(--font);
      text-shadow: 2px 2px 0 #000;
    }
    .brand small {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font: 9px/1 var(--font);
    }
    .nav {
      display: grid;
      gap: 6px;
    }
    .nav-link {
      display: block;
      padding: 10px;
      color: var(--text);
      text-decoration: none;
      background: #151515;
      border-left: 3px solid transparent;
      box-shadow: var(--bevel);
    }
    .nav-link:hover,
    .nav-link.active {
      border-left-color: var(--gold);
      background: #1d1d1d;
    }
    .nav-link span {
      display: block;
      color: #f1f1f1;
      font: 700 10px/1.2 var(--font);
      text-shadow: 2px 2px 0 #000;
    }
    .nav-link small {
      display: block;
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .content {
      min-width: 0;
      display: grid;
      align-content: start;
      gap: 14px;
    }
    .hero-window,
    .doc-window {
      min-width: 0;
      max-width: 100%;
      background: var(--panel);
      box-shadow: 0 0 0 2px #000, var(--bevel);
    }
    .titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      padding: 14px 16px;
      background: #171717;
      border-bottom: 1px solid var(--line);
    }
    .eyebrow {
      margin: 0 0 7px;
      color: var(--gold);
      font: 700 9px/1 var(--font);
      text-transform: uppercase;
      letter-spacing: 0;
    }
    h1, h2, h3 {
      color: #f5f5f5;
      line-height: 1.2;
      text-shadow: 2px 2px 0 #000;
    }
    h1 {
      margin: 0;
      font: 700 24px/1.1 var(--font);
    }
    h2 {
      margin: 28px 0 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line);
      font-size: 21px;
    }
    h3 { margin-top: 22px; }
    .status-pill,
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 12px;
      color: var(--text);
      text-decoration: none;
      background: #1a1a1a;
      box-shadow: 0 0 0 2px #000, var(--bevel);
      font: 700 10px/1 var(--font);
    }
    .button.primary {
      color: #111;
      background: linear-gradient(180deg, #efc24b, #c79422);
    }
    .hero-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(260px, .6fr);
      gap: 14px;
      padding: 18px;
    }
    .lead {
      margin: 0;
      max-width: 760px;
      color: var(--text);
      font-size: 16px;
    }
    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }
    .path-card {
      padding: 14px;
      background: #090909;
      border: 1px solid var(--line);
      box-shadow: var(--bevel);
    }
    .path-card .label,
    .path-card .hint {
      display: block;
      color: var(--muted);
      font-size: 12px;
    }
    .path-card code {
      display: block;
      margin: 10px 0;
      color: var(--gold);
      word-break: break-word;
    }
    .section-heading {
      padding: 14px 16px 0;
    }
    .section-heading h2 {
      margin-top: 0;
    }
    .doc-body {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      padding: 18px;
    }
    .doc-body a {
      color: var(--gold);
    }
    .doc-body code {
      color: #f0c85a;
      background: #080808;
      border: 1px solid #242424;
      padding: 1px 4px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .doc-body pre code {
      display: block;
      padding: 0;
      color: var(--text);
      background: transparent;
      border: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: normal;
    }
    .doc-body p,
    .doc-body li {
      color: var(--text);
    }
    .doc-body ul,
    .doc-body ol {
      margin: 10px 0 16px 22px;
      padding: 0;
    }
    .doc-body li + li {
      margin-top: 6px;
    }
    .doc-body blockquote {
      margin: 16px 0;
      padding: 10px 14px;
      border-left: 3px solid var(--gold-dark);
      background: #0b0b0b;
      color: var(--muted);
    }
    .doc-body img {
      max-width: 100%;
      height: auto;
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 10px;
      padding: 0 18px 18px;
    }
    .doc-card {
      min-height: 116px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      padding: 14px;
      color: var(--text);
      text-decoration: none;
      background: #151515;
      border-left: 3px solid var(--gold-dark);
      box-shadow: var(--bevel);
    }
    .doc-card:hover {
      border-left-color: var(--gold);
      background: #1d1d1d;
    }
    .doc-card span {
      color: var(--gold);
      font: 700 10px/1.1 var(--font);
    }
    .doc-card strong {
      color: #efefef;
      font-size: 14px;
      font-weight: 600;
    }
    @media (max-width: 900px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .sidebar {
        position: static;
        height: auto;
      }
      .hero-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inCode = false;
  let listOpen = null;
  const closeList = () => {
    if (!listOpen) return;
    out.push(`</${listOpen}>`);
    listOpen = null;
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      closeList();
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
    if (headingMatch) {
      closeList();
      const level = Math.min(headingMatch[1].length + 1, 4);
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }
    const bulletMatch = /^[-*]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      if (listOpen !== "ul") {
        closeList();
        out.push("<ul>");
        listOpen = "ul";
      }
      out.push(`<li>${inlineMarkdown(bulletMatch[1])}</li>`);
      continue;
    }
    const orderedMatch = /^\d+\.\s+(.+)$/.exec(line);
    if (orderedMatch) {
      if (listOpen !== "ol") {
        closeList();
        out.push("<ol>");
        listOpen = "ol";
      }
      out.push(`<li>${inlineMarkdown(orderedMatch[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    out.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  if (inCode) out.push("</code></pre>");
  closeList();
  return out.join("\n");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function paragraph(text) {
  return `<p>${escapeHtml(text)}</p>`;
}

function heading(text) {
  return `<h2>${escapeHtml(text)}</h2>`;
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${typeof item === "string" && item.startsWith("<a ") ? item : escapeHtml(item)}</li>`).join("")}</ul>`;
}

function code(text) {
  return `<pre><code>${escapeHtml(text)}</code></pre>`;
}

function link(href, text) {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

async function readPrivateNeedles() {
  const needles = new Set();
  for (const file of [join(workspaceRoot, "goal.md"), join(workspaceRoot, "multiclient-accounts.txt")]) {
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    for (const match of text.match(/https:\/\/discord\.com\/api\/webhooks\/[^\s`'"<>)\]]+/gi) ?? []) needles.add(match);
    for (const match of text.match(/[^\s:@]+@[^\s:@]+\.[^\s:@]+:[^\s]+/gi) ?? []) {
      needles.add(match);
      const [email, password] = match.split(":", 2);
      if (email?.length >= 4) needles.add(email);
      if (password?.length >= 4) needles.add(password);
    }
  }
  return [...needles].filter((needle) => needle.length >= 4);
}

async function readPrivatePremadePluginIds() {
  const file = join(workspaceRoot, ".private-premade-modules.json");
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^[a-z0-9-]{1,64}$/.test(entry));
}

async function listFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

async function listEntriesDeep(root) {
  const entries = [];
  if (!existsSync(root)) return entries;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      const isDirectory = entry.isDirectory();
      entries.push({ path: full, isDirectory, isFile: entry.isFile() });
      if (isDirectory) stack.push(full);
    }
  }
  return entries.sort((a, b) => b.path.length - a.path.length);
}

function isTextFile(file) {
  const ext = extname(file).toLowerCase();
  const name = basename(file).toLowerCase();
  return textExtensions.has(ext) || name === "license" || name === "version" || name === ".gitignore";
}

async function removeSafe(target) {
  if (!existsSync(target)) return;
  assertInsideRelease(target);
  await rm(target, { recursive: true, force: true });
}

function assertInsideWorkspace(target) {
  const resolvedTarget = resolve(target);
  const resolvedWorkspace = resolve(workspaceRoot);
  if (resolvedTarget !== resolvedWorkspace && !resolvedTarget.startsWith(resolvedWorkspace + sep)) {
    throw new Error(`Refusing path outside workspace: ${resolvedTarget}`);
  }
}

function assertInsideRelease(target) {
  const resolvedTarget = resolve(target);
  const resolvedRelease = resolve(releaseRoot);
  if (resolvedTarget !== resolvedRelease && !resolvedTarget.startsWith(resolvedRelease + sep)) {
    throw new Error(`Refusing path outside release folder: ${resolvedTarget}`);
  }
}

async function assertPathExists(target, label) {
  if (!existsSync(target)) throw new Error(`Missing ${label}: ${target}`);
  await stat(target);
}

function normalize(value) {
  return value.replace(/\\/g, "/");
}
