#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const workspaceRoot = resolve(scriptDir, "..");
const engineRoot = resolve(process.env.HABBPY_V4_ENGINE_SOURCE_ROOT || join(workspaceRoot, "..", "habbo-origins-engine"));
const releaseRoot = join(workspaceRoot, "release");
const portableSourceRoot = join(workspaceRoot, "dist", "portable", "HabbpyV4");
const portableReleaseRoot = join(releaseRoot, "release", "HabbpyV4");
const sourceReleaseRoot = join(releaseRoot, "src");
const appSourceReleaseRoot = join(sourceReleaseRoot, "habbpy-v4-shockless");
const engineSourceReleaseRoot = join(sourceReleaseRoot, "habbo-origins-engine");

const textExtensions = new Set([
  "",
  ".bat",
  ".cjs",
  ".cmd",
  ".css",
  ".cts",
  ".gitignore",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mjs",
  ".ps1",
  ".sh",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const localAutomationScripts = new Set([
  "clean-public-release.mjs",
  "prepare-release-bundle.mjs",
  "run-chooser-rights-live-proof.mjs",
  "run-electron-automation.mjs",
  "run-gardening-electron-smoke.mjs",
  "run-plugin-api-probe.mjs",
  "run-plugin-live-matrix.mjs",
  "run-visible-electron-smoke.mjs",
  "send-webhook.mjs",
]);

const sourceOnlyAppEntries = new Set([
  ".gitignore",
  "README.md",
  "docs",
  "examples",
  "index.html",
  "package-lock.json",
  "package.json",
  "public",
  "scripts",
  "src",
  "tests",
  "tsconfig.json",
  "tsconfig.main.json",
  "vite.config.ts",
]);

const sourceOnlyEngineEntries = new Set([
  ".gitignore",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "docs",
  "engine.config.json",
  "index.html",
  "package-lock.json",
  "package.json",
  "public",
  "src",
  "standalone",
  "tests",
  "tools",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
]);

const releaseStats = {
  portableFiles: 0,
  appSourceFiles: 0,
  engineSourceFiles: 0,
  sanitizedTextFiles: 0,
  skipped: [],
};

await main();

async function main() {
  await assertPathExists(join(portableSourceRoot, "Habbpy v4.exe"), "existing portable executable");
  await assertPathExists(join(portableSourceRoot, "resources"), "existing portable resources");
  await assertPathExists(join(engineRoot, "package.json"), "engine source root");

  await clearReleaseRoot();
  await mkdir(releaseRoot, { recursive: true });

  await copyPortable();
  await copyAppSource();
  await copyEngineSource();
  await sanitizeReleaseTextFiles(sourceReleaseRoot);
  await sanitizeReleasePackageJson();

  const verification = await verifyReleaseBundle();
  await writeReleaseReadme(verification);
  await writeReleaseManifest(verification);

  const summary = {
    ok: verification.ok,
    releaseRoot: "release",
    portable: "release/release/HabbpyV4/Habbpy v4.exe",
    appSource: "release/src/habbpy-v4-shockless",
    engineSource: "release/src/habbo-origins-engine",
    stats: releaseStats,
    findings: verification.findings.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!verification.ok) {
    process.exitCode = 1;
  }
}

async function clearReleaseRoot() {
  const resolvedRelease = resolve(releaseRoot);
  const resolvedWorkspace = resolve(workspaceRoot);
  if (!resolvedRelease.startsWith(resolvedWorkspace + sep) || resolvedRelease === resolvedWorkspace) {
    throw new Error(`Refusing to remove unsafe release path: ${resolvedRelease}`);
  }
  if (resolve(portableSourceRoot).startsWith(resolvedRelease + sep)) {
    throw new Error("Refusing to stage from a portable path inside the release output.");
  }
  if (!existsSync(resolvedRelease)) return;
  for (const entry of await readdir(resolvedRelease, { withFileTypes: true })) {
    if ([".git", ".gitignore", "media"].includes(entry.name)) continue;
    await rm(join(resolvedRelease, entry.name), { recursive: true, force: true });
  }
}

async function copyPortable() {
  await copyTree(portableSourceRoot, portableReleaseRoot, {
    shouldInclude: ({ rel, name, isDirectory }) => {
      const normalized = normalizeRel(rel);
      if (!normalized) return true;
      if (isDirectory && ["clients", "logs", "screenshots", "crashpad"].includes(name.toLowerCase())) return false;
      if (["goal.md", "multiclient-accounts.txt"].includes(name.toLowerCase())) return false;
      if (name.toLowerCase().endsWith(".log")) return false;
      if (normalized.includes("/clients/") || normalized.startsWith("clients/")) return false;
      return true;
    },
    onFile: () => {
      releaseStats.portableFiles += 1;
    },
  });
}

async function copyAppSource() {
  await copySelectedEntries(workspaceRoot, appSourceReleaseRoot, sourceOnlyAppEntries, {
    shouldInclude: ({ rel, name, isDirectory }) => {
      const normalized = normalizeRel(rel);
      const lowerName = name.toLowerCase();
      if (!normalized) return true;
      if (isDirectory && [".git", ".agents", ".tmp", "dist", "logs", "node_modules", "release", "screenshots", "tmp"].includes(lowerName)) {
        return false;
      }
      if (normalized.startsWith("scripts/") && localAutomationScripts.has(name)) return false;
      if (["goal.md", "multiclient-accounts.txt", ".env", ".env.local"].includes(lowerName)) return false;
      if (lowerName.endsWith(".log")) return false;
      return true;
    },
    onFile: () => {
      releaseStats.appSourceFiles += 1;
    },
  });
}

async function copyEngineSource() {
  await copySelectedEntries(engineRoot, engineSourceReleaseRoot, sourceOnlyEngineEntries, {
    shouldInclude: ({ rel, name, isDirectory }) => {
      const normalized = normalizeRel(rel);
      const lowerName = name.toLowerCase();
      if (!normalized) return true;
      if (isDirectory && [".git", ".agents", "clients", "compiled", "dist", "exports", "generated", "node_modules", "ref", "release", "tmp"].includes(lowerName)) {
        return false;
      }
      if (normalized.startsWith("standalone/")) {
        const parts = normalized.split("/");
        if (isDirectory && lowerName.startsWith("release")) return false;
        if (parts.some((part) => ["clients", "dist", "node_modules", "release"].includes(part.toLowerCase()))) return false;
        if (parts.some((part) => part.toLowerCase().startsWith("release-"))) return false;
      }
      if (lowerName === "src.zip" || lowerName.endsWith(".log")) return false;
      return true;
    },
    onFile: () => {
      releaseStats.engineSourceFiles += 1;
    },
  });
}

async function copySelectedEntries(sourceRoot, destinationRoot, selectedEntries, options) {
  await mkdir(destinationRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!selectedEntries.has(entry.name)) {
      releaseStats.skipped.push(normalizeRel(relative(workspaceRoot, join(sourceRoot, entry.name))));
      continue;
    }
    await copyTree(join(sourceRoot, entry.name), join(destinationRoot, entry.name), options, entry.name);
  }
}

async function copyTree(source, destination, options, rel = "") {
  const info = await stat(source);
  const name = rel.split(/[\\/]/).filter(Boolean).at(-1) || "";
  const shouldInclude = options.shouldInclude?.({ rel, name, isDirectory: info.isDirectory() }) ?? true;
  if (!shouldInclude) return;

  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const childRel = rel ? join(rel, entry.name) : entry.name;
      await copyTree(join(source, entry.name), join(destination, entry.name), options, childRel);
    }
    return;
  }

  if (info.isSymbolicLink?.()) {
    await mkdir(resolve(destination, ".."), { recursive: true });
    await symlink(await readFile(source, "utf8"), destination);
    return;
  }

  await mkdir(resolve(destination, ".."), { recursive: true });
  await copyFile(source, destination);
  options.onFile?.(source, destination);
}

async function sanitizeReleasePackageJson() {
  const packagePath = join(appSourceReleaseRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  for (const scriptName of [
    "automation:electron",
    "automation:visible",
    "automation:gardening",
    "automation:chooser-rights",
    "automation:plugins",
    "webhook",
  ]) {
    delete packageJson.scripts?.[scriptName];
  }
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

async function sanitizeReleaseTextFiles(root) {
  const privateNeedles = await getPrivateNeedles();
  const files = await listFiles(root);
  for (const file of files) {
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
      .replace(/file:\/\/\/F:\/habbpy-v4-shockless[^\s`'"<>)\]]*/gi, "file:///<habbpy-v4-source-path>")
      .replace(/https:\/\/discord\.com\/api\/webhooks\/[^\s`'"<>)\]]+/gi, "<discord-webhook-url-redacted>");

    for (const needle of privateNeedles) {
      if (needle.length >= 4) {
        next = next.split(needle).join("<private-test-value-redacted>");
      }
    }

    if (next !== text) {
      await writeFile(file, next, "utf8");
      releaseStats.sanitizedTextFiles += 1;
    }
  }
}

async function getPrivateNeedles() {
  const needles = new Set();
  const goalPath = join(workspaceRoot, "goal.md");
  if (existsSync(goalPath)) {
    const text = await readFile(goalPath, "utf8");
    const webhookMatches = text.match(/https:\/\/discord\.com\/api\/webhooks\/[^\s`'"<>)\]]+/gi) ?? [];
    for (const match of webhookMatches) needles.add(match);
    const credentialMatches = text.match(/[^\s:@]+@[^\s:@]+\.[^\s:@]+:[^\s]+/gi) ?? [];
    for (const match of credentialMatches) {
      needles.add(match);
      const [email, password] = match.split(":", 2).map((part) => part.trim()).filter(Boolean);
      if (email) needles.add(email);
      if (password && password.length >= 4) needles.add(password);
    }
  }

  const accountPath = join(workspaceRoot, "multiclient-accounts.txt");
  if (existsSync(accountPath)) {
    const text = await readFile(accountPath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (line.includes(":") || /^[\w.-]+@[\w.-]+$/.test(line)) {
        needles.add(line);
      }
      if (line.includes(":")) {
        const [email, password] = line.split(":", 2).map((part) => part.trim()).filter(Boolean);
        if (email) needles.add(email);
        if (password && password.length >= 4) needles.add(password);
      }
    }
  }
  return [...needles].filter((needle) => needle.length >= 4);
}

async function verifyReleaseBundle() {
  const findings = [];
  const privateNeedles = await getPrivateNeedles();
  const allFiles = await listFiles(releaseRoot);

  for (const file of allFiles) {
    const rel = normalizeRel(relative(releaseRoot, file));
    const lower = rel.toLowerCase();
    const segments = lower.split("/");

    if (segments.includes(".git") || (lower.startsWith("src/") && segments.includes("node_modules"))) {
      findings.push({ severity: "Error", type: "forbidden-directory", path: rel });
    }
    if (lower.endsWith("/goal.md") || lower === "goal.md" || lower.endsWith("/multiclient-accounts.txt") || lower === "multiclient-accounts.txt") {
      findings.push({ severity: "Error", type: "forbidden-private-file", path: rel });
    }
    if (lower.startsWith("release/") && (segments.includes("clients") || segments.includes("logs") || segments.includes("screenshots"))) {
      findings.push({ severity: "Error", type: "forbidden-portable-runtime-data", path: rel });
    }
    if (lower.startsWith("src/") && ["dist", "release", "logs", "screenshots", ".tmp", "tmp", "clients", "compiled", "exports", "generated", "ref"].some((part) => segments.includes(part))) {
      findings.push({ severity: "Error", type: "forbidden-source-build-or-cache", path: rel });
    }
    if (lower.endsWith(".log")) {
      findings.push({ severity: "Error", type: "forbidden-log-file", path: rel });
    }

    if (!isTextFile(file)) continue;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }

    const contentChecks = [
      ["discord-webhook-url", /https:\/\/discord\.com\/api\/webhooks\//i],
      ["local-user-path", /C:\\Users\\dekky/i],
      ["local-app-path", /F:\\habbpy-v4-shockless/i],
      ["local-engine-path", /F:\\habbo-origins-engine/i],
      ["file-url-local-app-path", /file:\/\/\/F:\/habbpy-v4-shockless/i],
    ];
    for (const [type, pattern] of contentChecks) {
      if (pattern.test(text)) findings.push({ severity: "Error", type, path: rel });
    }
    for (const needle of privateNeedles) {
      if (needle.length >= 4 && text.includes(needle)) {
        findings.push({ severity: "Error", type: "private-value", path: rel });
        break;
      }
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    counts: {
      files: allFiles.length,
      portableFiles: releaseStats.portableFiles,
      appSourceFiles: releaseStats.appSourceFiles,
      engineSourceFiles: releaseStats.engineSourceFiles,
      sanitizedTextFiles: releaseStats.sanitizedTextFiles,
    },
  };
}

async function writeReleaseReadme(verification) {
  const text = `# Habbpy v4 Release Bundle

Generated by \`scripts/prepare-release-bundle.mjs\`.

## Contents

- \`release/HabbpyV4/Habbpy v4.exe\` - runnable portable build copied from the existing packaged output.
- \`src/habbpy-v4-shockless\` - GitHub-ready Habbpy v4 app source.
- \`src/habbo-origins-engine\` - GitHub-ready Shockless engine source.

## Release Hygiene

- Imported clients, local logs, screenshots, generated engine exports, build caches, local account files, and private goal files are excluded.
- The app source copy omits local live-account automation and webhook helper scripts.
- The engine source copy omits generated/decompiled client output and standalone release builds; the runnable portable includes the built engine runtime.
- Absolute developer-machine path references and private local test values are redacted from text files in this bundle.

Verification: ${verification.ok ? "Success" : "Failed"}
Files checked: ${verification.counts.files}
Findings: ${verification.findings.length}
`;
  await writeFile(join(releaseRoot, "README.md"), text, "utf8");
}

async function writeReleaseManifest(verification) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    paths: {
      portable: "release/HabbpyV4/Habbpy v4.exe",
      appSource: "src/habbpy-v4-shockless",
      engineSource: "src/habbo-origins-engine",
    },
    verification,
  };
  await writeFile(join(releaseRoot, "RELEASE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function listFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  await walk(root);
  return files;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
}

function isTextFile(file) {
  const ext = extname(file).toLowerCase();
  const name = file.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  return textExtensions.has(ext) || textExtensions.has(`.${name}`) || name === "license";
}

function normalizeRel(value) {
  return value.replace(/\\/g, "/");
}

async function assertPathExists(target, label) {
  if (!existsSync(target)) {
    throw new Error(`Missing ${label}: ${target}`);
  }
}
