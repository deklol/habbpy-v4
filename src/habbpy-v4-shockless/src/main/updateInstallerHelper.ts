import { spawn } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { installerManagedPluginPath, portableInstallPathIsPreserved } from "../shared/update.js";

interface UpdateInstallPlan {
  readonly schemaVersion: 1;
  readonly installDir: string;
  readonly stagedPayloadRoot: string;
  readonly backupDir: string;
  readonly logPath: string;
  readonly appExePath: string;
  readonly parentPid: number;
  readonly relaunch: boolean;
}

const REQUIRED_PAYLOAD_FILES = [
  "Habbpy v4.exe",
  "resources/app/package.json",
  "resources/app/dist/main/main/main.js",
  "resources/app/dist/main/main/updateInstallerHelper.js",
  "resources/engine/dist/index.html",
  "resources/relay/origins-relay.mjs",
];

void main().catch((error) => {
  try {
    const plan = readPlan(process.argv[2] ?? "");
    log(plan, `FAILED: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  } catch {
    // At this point there is no reliable log path.
  }
  process.exit(1);
});

async function main(): Promise<void> {
  const plan = readPlan(process.argv[2] ?? "");
  log(plan, "Installer helper started.");
  validatePlan(plan);
  await waitForProcessExit(plan.parentPid, 60_000);
  installStagedUpdate(plan);
  log(plan, "Install complete.");
  if (plan.relaunch) relaunch(plan);
}

function readPlan(planPath: string): UpdateInstallPlan {
  if (!planPath) throw new Error("Missing updater install plan path.");
  const parsed = JSON.parse(readFileSync(planPath, "utf8")) as UpdateInstallPlan;
  return parsed;
}

function validatePlan(plan: UpdateInstallPlan): void {
  if (plan.schemaVersion !== 1) throw new Error("Unsupported install plan schema.");
  const installDir = resolve(plan.installDir);
  const stagedPayloadRoot = resolve(plan.stagedPayloadRoot);
  const appExePath = resolve(plan.appExePath);
  assertInside(installDir, appExePath);
  if (!existsSync(installDir) || !statSync(installDir).isDirectory()) throw new Error(`Install directory is missing: ${installDir}`);
  if (!existsSync(stagedPayloadRoot) || !statSync(stagedPayloadRoot).isDirectory()) throw new Error(`Staged payload is missing: ${stagedPayloadRoot}`);
  for (const file of REQUIRED_PAYLOAD_FILES) {
    if (!existsSync(join(stagedPayloadRoot, file))) throw new Error(`Staged payload is missing ${file}.`);
  }
}

function installStagedUpdate(plan: UpdateInstallPlan): void {
  const installDir = resolve(plan.installDir);
  const stagedPayloadRoot = resolve(plan.stagedPayloadRoot);
  const backupDir = resolve(plan.backupDir);
  const backedUp = new Set<string>();
  const added = new Set<string>();
  mkdirSync(backupDir, { recursive: true });

  try {
    for (const entry of readdirSync(installDir, { withFileTypes: true })) {
      const rel = entry.name;
      if (portableInstallPathIsPreserved(rel)) continue;
      if (rel.toLowerCase() === "plugins") continue;
      backupAndRemove(installDir, backupDir, rel, backedUp);
    }

    for (const entry of readdirSync(stagedPayloadRoot, { withFileTypes: true })) {
      const rel = entry.name;
      if (portableInstallPathIsPreserved(rel)) continue;
      if (rel.toLowerCase() === "plugins") continue;
      copyEntry(stagedPayloadRoot, installDir, backupDir, rel, backedUp, added);
    }

    installBundledPlugins(stagedPayloadRoot, installDir, backupDir, backedUp, added);
  } catch (error) {
    rollback(installDir, backupDir, backedUp, added, plan, error);
    throw error;
  }
}

function installBundledPlugins(
  stagedPayloadRoot: string,
  installDir: string,
  backupDir: string,
  backedUp: Set<string>,
  added: Set<string>,
): void {
  const stagedPlugins = join(stagedPayloadRoot, "plugins");
  if (!existsSync(stagedPlugins)) return;
  mkdirSync(join(installDir, "plugins"), { recursive: true });
  for (const entry of readdirSync(stagedPlugins, { withFileTypes: true })) {
    const rel = `plugins/${entry.name}`;
    if (!installerManagedPluginPath(rel)) continue;
    copyEntry(stagedPayloadRoot, installDir, backupDir, rel, backedUp, added);
  }
}

function backupAndRemove(root: string, backupRoot: string, relativePath: string, backedUp: Set<string>): void {
  assertSafeRelativePath(relativePath);
  const source = join(root, relativePath);
  if (!existsSync(source)) return;
  const backup = join(backupRoot, relativePath);
  mkdirSync(dirname(backup), { recursive: true });
  cpSync(source, backup, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
  backedUp.add(relativePath);
}

function copyEntry(
  sourceRoot: string,
  targetRoot: string,
  backupRoot: string,
  relativePath: string,
  backedUp: Set<string>,
  added: Set<string>,
): void {
  assertSafeRelativePath(relativePath);
  const source = join(sourceRoot, relativePath);
  const target = join(targetRoot, relativePath);
  if (existsSync(target) && !backedUp.has(relativePath)) {
    backupAndRemove(targetRoot, backupRoot, relativePath, backedUp);
  } else if (!existsSync(target)) {
    added.add(relativePath);
  }
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

function rollback(
  installDir: string,
  backupDir: string,
  backedUp: Set<string>,
  added: Set<string>,
  plan: UpdateInstallPlan,
  originalError: unknown,
): void {
  log(plan, `Install failed; rolling back. ${originalError instanceof Error ? originalError.message : String(originalError)}`);
  for (const rel of [...added].reverse()) {
    rmSync(join(installDir, rel), { recursive: true, force: true });
  }
  for (const rel of [...backedUp].reverse()) {
    const backup = join(backupDir, rel);
    const target = join(installDir, rel);
    rmSync(target, { recursive: true, force: true });
    if (existsSync(backup)) {
      mkdirSync(dirname(target), { recursive: true });
      cpSync(backup, target, { recursive: true, force: true });
    }
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!processIsRunning(pid)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function relaunch(plan: UpdateInstallPlan): void {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(plan.appExePath, [], {
    cwd: plan.installDir,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
}

function assertSafeRelativePath(relativePath: string): void {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe installer path: ${relativePath}`);
  }
}

function assertInside(parent: string, target: string): void {
  const normalizedParent = resolve(parent);
  const normalizedTarget = resolve(target);
  if (normalizedTarget !== normalizedParent && !normalizedTarget.startsWith(normalizedParent + sep)) {
    throw new Error(`Refusing path outside ${normalizedParent}: ${normalizedTarget}`);
  }
}

function log(plan: UpdateInstallPlan, message: string): void {
  mkdirSync(dirname(plan.logPath), { recursive: true });
  appendFileSync(plan.logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}
