import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { WebContents } from "electron";
import {
  emptyUpdateState,
  installerManagedPluginPath,
  isNewerAppVersion,
  isSafeHttpsUrl,
  MAX_UPDATE_BYTES,
  publicUpdatePathIsForbidden,
  UPDATE_MANIFEST_ASSET_NAME,
  UPDATE_PLATFORM,
  UPDATE_REPOSITORY_NAME,
  UPDATE_REPOSITORY_OWNER,
  updatePercent,
  validateUpdateManifest,
  type AppUpdateProgress,
  type AppUpdateState,
  type UpdateReleaseInfo,
  type UpdateReleaseManifest,
} from "../shared/update.js";
import { errorMessage } from "../shared/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GITHUB_API_RELEASE_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY_OWNER}/${UPDATE_REPOSITORY_NAME}/releases/latest`;
const REQUEST_TIMEOUT_MS = 10_000;
const PROGRESS_EMIT_INTERVAL_MS = 150;
const UPDATE_STATE_FILE = "update-state.json";
const TEXT_EXTENSIONS = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".txt", ".xml", ".yml", ".yaml"]);
const FORBIDDEN_RELEASE_TEXT_PATTERNS = [
  /private-service(?:app)?\.com\/api\/endpoints/i,
  /HABBPY_V4_DISCORD_endpoint_URL/i,
  /[A-Z]:[\\/](?:Users[\\/]dekky|habbo|habbpy|slopwave)/i,
  /C:[\\/]Users[\\/]dekky/i,
  /F:[\\/](?:habbo|habbpy|slopwave)/i,
];

type FetchLike = typeof fetch;

interface UpdateManagerOptions {
  readonly appDataPath: string;
  readonly currentVersion: string;
  readonly installDir: string;
  readonly executablePath: string;
  readonly isPackaged: boolean;
  readonly fetchImpl?: FetchLike;
}

interface PersistedUpdateState {
  readonly skippedVersion?: string;
}

interface GitHubReleaseAsset {
  readonly name?: unknown;
  readonly browser_download_url?: unknown;
  readonly size?: unknown;
}

interface GitHubReleaseResponse {
  readonly tag_name?: unknown;
  readonly html_url?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
  readonly published_at?: unknown;
  readonly assets?: unknown;
}

export interface StagedUpdateValidation {
  readonly ok: boolean;
  readonly payloadRoot: string | null;
  readonly message: string;
}

export interface UpdateInstallPlan {
  readonly schemaVersion: 1;
  readonly installDir: string;
  readonly stagedPayloadRoot: string;
  readonly backupDir: string;
  readonly logPath: string;
  readonly appExePath: string;
  readonly parentPid: number;
  readonly relaunch: boolean;
}

export class UpdateManager {
  private state: AppUpdateState;
  private readonly fetchImpl: FetchLike;
  private readonly listeners = new Set<WebContents>();

  constructor(private readonly options: UpdateManagerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    const persisted = readPersistedState(this.statePath());
    this.state = emptyUpdateState(options.currentVersion, persisted.skippedVersion ?? null);
  }

  addListener(contents: WebContents): void {
    if (contents.isDestroyed()) return;
    this.listeners.add(contents);
    contents.once("destroyed", () => this.listeners.delete(contents));
  }

  snapshot(): AppUpdateState {
    return this.state;
  }

  async checkForUpdates(options: { readonly silent?: boolean } = {}): Promise<AppUpdateState> {
    if (this.state.status === "checking" || this.state.status === "downloading" || this.state.status === "installing") return this.state;
    this.setState({
      status: "checking",
      progress: null,
      error: null,
      message: "Checking GitHub releases...",
    });

    try {
      const release = await this.fetchLatestRelease();
      if (!release) {
        this.setState({
          status: "up-to-date",
          lastCheckedAt: new Date().toISOString(),
          available: null,
          message: "No public update release is available yet.",
        });
        return this.state;
      }
      if (!isNewerAppVersion(release.version, this.options.currentVersion)) {
        this.setState({
          status: "up-to-date",
          lastCheckedAt: new Date().toISOString(),
          available: release,
          message: `Shockless Engine is up to date (${this.options.currentVersion}).`,
        });
        return this.state;
      }
      if (this.state.skippedVersion === release.version) {
        this.setState({
          status: "skipped",
          lastCheckedAt: new Date().toISOString(),
          available: release,
          message: `Update ${release.version} is skipped.`,
        });
        return this.state;
      }
      this.setState({
        status: "available",
        lastCheckedAt: new Date().toISOString(),
        available: release,
        message: `Update ${release.version} is available.`,
      });
    } catch (error) {
      this.setState({
        status: options.silent ? "unavailable" : "error",
        lastCheckedAt: new Date().toISOString(),
        available: null,
        error: errorMessage(error),
        message: options.silent ? "Update check unavailable. The app can still be used normally." : `Update check failed: ${errorMessage(error)}`,
      });
    }
    return this.state;
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    const available = this.state.available;
    if (!available) return this.checkForUpdates({ silent: false });
    if (!isNewerAppVersion(available.version, this.options.currentVersion)) return this.state;

    const updateRoot = this.updateRoot(available.version);
    const zipPath = join(updateRoot, available.assetName);
    const partialPath = `${zipPath}.partial`;
    const stageRoot = join(updateRoot, "stage");
    await mkdir(updateRoot, { recursive: true });
    await rm(partialPath, { force: true });
    await rm(zipPath, { force: true });
    await rm(stageRoot, { recursive: true, force: true });

    this.setState({
      status: "downloading",
      progress: { bytesReceived: 0, totalBytes: available.size, percent: 0 },
      stagedPath: null,
      error: null,
      message: `Downloading ${available.assetName}...`,
    });

    try {
      await this.downloadFile(available.assetUrl, partialPath, available.size);
      const actualSha256 = await sha256File(partialPath);
      if (actualSha256 !== available.sha256) {
        throw new Error(`Update checksum mismatch. Expected ${available.sha256}, received ${actualSha256}.`);
      }
      await renamePortableFile(partialPath, zipPath);
      await extractUpdateZip(zipPath, stageRoot);
      const staged = await validateStagedUpdatePayload(stageRoot);
      if (!staged.ok || !staged.payloadRoot) throw new Error(staged.message);

      this.setState({
        status: "downloaded",
        progress: { bytesReceived: available.size, totalBytes: available.size, percent: 100 },
        stagedPath: staged.payloadRoot,
        message: `Update ${available.version} is ready to install.`,
      });
    } catch (error) {
      await rm(partialPath, { force: true });
      this.setState({
        status: "error",
        error: errorMessage(error),
        message: `Update download failed: ${errorMessage(error)}`,
      });
    }
    return this.state;
  }

  async installDownloadedUpdate(): Promise<AppUpdateState> {
    if (this.state.status !== "downloaded" || !this.state.available || !this.state.stagedPath) {
      return {
        ...this.state,
        status: "error",
        error: "No downloaded update is ready to install.",
        message: "Download an update before installing.",
      };
    }
    if (!this.options.isPackaged) {
      this.setState({
        status: "error",
        error: "Restart install is only available from the packaged portable app.",
        message: "Run the packaged portable app to install downloaded updates.",
      });
      return this.state;
    }

    const planPath = await this.writeInstallPlan(this.state.available, this.state.stagedPath);
    const helperPath = this.installerHelperPath(this.state.stagedPath);
    if (!existsSync(helperPath)) {
      this.setState({
        status: "error",
        error: "Updater helper is missing from the packaged app.",
        message: "Updater helper is missing from the packaged app.",
      });
      return this.state;
    }
    const helperRunnerPath = await this.writeHelperRunner(this.state.available.version);

    const child = spawn(helperRunnerPath, [helperPath, planPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    child.unref();
    this.setState({
      status: "installing",
      message: "Restarting to install the downloaded update...",
      error: null,
    });
    return this.state;
  }

  async skipUpdate(version: string): Promise<AppUpdateState> {
    const clean = version.trim();
    const skippedVersion = clean || this.state.available?.version || null;
    await writePersistedState(this.statePath(), { skippedVersion: skippedVersion ?? undefined });
    this.setState({
      status: skippedVersion && this.state.available?.version === skippedVersion ? "skipped" : this.state.status,
      skippedVersion,
      message: skippedVersion ? `Update ${skippedVersion} is skipped.` : "No update version is skipped.",
    });
    return this.state;
  }

  private async fetchLatestRelease(): Promise<UpdateReleaseInfo | null> {
    const release = await this.fetchJson<GitHubReleaseResponse>(GITHUB_API_RELEASE_URL);
    if (release.draft === true || release.prerelease === true) return null;
    const tagName = cleanString(release.tag_name);
    const releaseUrl = cleanString(release.html_url);
    if (!tagName || !isSafeHttpsUrl(releaseUrl, "github.com")) throw new Error("GitHub latest release response is missing tag/html URL.");
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const manifestAsset = assets.find((asset): asset is GitHubReleaseAsset =>
      isRecord(asset) && cleanString(asset.name) === UPDATE_MANIFEST_ASSET_NAME,
    );
    const manifestUrl = cleanString(manifestAsset?.browser_download_url);
    if (!isSafeHttpsUrl(manifestUrl, "github.com")) throw new Error("Latest release does not contain a valid update.json asset.");

    const manifestValidation = validateUpdateManifest(await this.fetchJson<unknown>(manifestUrl), UPDATE_PLATFORM);
    if (!manifestValidation.ok || !manifestValidation.manifest) throw new Error(manifestValidation.message);
    const manifest = manifestValidation.manifest;
    const asset = assets.find((entry): entry is GitHubReleaseAsset =>
      isRecord(entry) && cleanString(entry.name) === manifest.assetName,
    );
    const assetUrl = cleanString(asset?.browser_download_url);
    if (!isSafeHttpsUrl(assetUrl, "github.com")) throw new Error(`Release asset is missing or invalid: ${manifest.assetName}`);
    if (Number(asset?.size) !== manifest.size) throw new Error(`Release asset size does not match ${UPDATE_MANIFEST_ASSET_NAME}.`);
    return {
      ...manifest,
      tagName,
      assetUrl,
      manifestUrl,
      publishedAt: manifest.publishedAt ?? (cleanString(release.published_at) || undefined),
      releaseUrl,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Shockless-Engine/${this.options.currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub request failed (${response.status} ${response.statusText}).`);
    return response.json() as Promise<T>;
  }

  private async downloadFile(url: string, destination: string, expectedBytes: number): Promise<void> {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": `Shockless-Engine/${this.options.currentVersion}`,
      },
    });
    if (!response.ok) throw new Error(`Release asset download failed (${response.status} ${response.statusText}).`);
    const length = Number(response.headers.get("content-length") ?? expectedBytes);
    if (!Number.isFinite(length) || length <= 0 || length > MAX_UPDATE_BYTES) throw new Error("Release asset size is invalid.");
    if (length !== expectedBytes) throw new Error("Release asset content length does not match update manifest.");
    if (!response.body) throw new Error("Release asset response did not contain a body.");

    let bytesReceived = 0;
    let lastEmit = 0;
    const progress = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        bytesReceived += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_EMIT_INTERVAL_MS || bytesReceived === expectedBytes) {
          lastEmit = now;
          this.setProgress(bytesReceived, expectedBytes);
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(destination));
    if (bytesReceived !== expectedBytes) throw new Error(`Downloaded ${bytesReceived} bytes, expected ${expectedBytes}.`);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private setProgress(bytesReceived: number, totalBytes: number): void {
    const progress: AppUpdateProgress = {
      bytesReceived,
      totalBytes,
      percent: updatePercent(bytesReceived, totalBytes),
    };
    this.setState({ progress, message: `Downloading update... ${progress.percent}%` });
  }

  private setState(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch };
    for (const contents of [...this.listeners]) {
      if (contents.isDestroyed()) {
        this.listeners.delete(contents);
        continue;
      }
      contents.send("habbpy-v4:update-state", this.state);
    }
  }

  private async writeInstallPlan(update: UpdateReleaseInfo, stagedPayloadRoot: string): Promise<string> {
    const root = this.updateRoot(update.version);
    await mkdir(root, { recursive: true });
    const backupDir = join(root, "backup");
    const plan: UpdateInstallPlan = {
      schemaVersion: 1,
      installDir: this.options.installDir,
      stagedPayloadRoot,
      backupDir,
      logPath: join(root, "install.log"),
      appExePath: this.options.executablePath,
      parentPid: process.pid,
      relaunch: true,
    };
    const planPath = join(root, "install-plan.json");
    await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    return planPath;
  }

  private installerHelperPath(stagedPayloadRoot: string): string {
    const stagedHelper = join(stagedPayloadRoot, "resources", "app", "dist", "main", "main", "updateInstallerHelper.js");
    if (existsSync(stagedHelper)) return stagedHelper;
    return join(__dirname, "updateInstallerHelper.js");
  }

  private async writeHelperRunner(version: string): Promise<string> {
    const root = this.updateRoot(version);
    await mkdir(root, { recursive: true });
    const helperRunnerPath = join(root, "updater-runner.exe");
    await rm(helperRunnerPath, { force: true });
    await copyFile(this.options.executablePath, helperRunnerPath);
    return helperRunnerPath;
  }

  private updateRoot(version: string): string {
    return join(this.options.appDataPath, "HabbpyV4", "updates", safeVersionDir(version));
  }

  private statePath(): string {
    return join(this.options.appDataPath, "HabbpyV4", "updates", UPDATE_STATE_FILE);
  }
}

export async function validateStagedUpdatePayload(stageRoot: string): Promise<StagedUpdateValidation> {
  const root = await resolveStagedPayloadRoot(stageRoot);
  if (!root) return { ok: false, payloadRoot: null, message: "Staged update does not contain a portable HabbpyV4 root." };
  const required = [
    "Habbpy v4.exe",
    "resources/app/package.json",
    "resources/app/dist/main/main/main.js",
    "resources/app/dist/main/main/updateInstallerHelper.js",
    "resources/engine/dist/index.html",
    "resources/relay/origins-relay.mjs",
  ];
  for (const file of required) {
    if (!existsSync(join(root, file))) return { ok: false, payloadRoot: null, message: `Staged update is missing ${file}.` };
  }
  const leakedText: string[] = [];
  for await (const filePath of walkFiles(root)) {
    const rel = relative(root, filePath);
    if (publicUpdatePathIsForbidden(rel)) return { ok: false, payloadRoot: null, message: `Staged update contains forbidden path ${rel}.` };
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const fileStat = await stat(filePath);
    if (fileStat.size > 1024 * 1024) continue;
    const text = await readFile(filePath, "utf8").catch(() => "");
    if (FORBIDDEN_RELEASE_TEXT_PATTERNS.some((pattern) => pattern.test(text))) leakedText.push(rel);
  }
  if (leakedText.length > 0) {
    return { ok: false, payloadRoot: null, message: `Staged update contains private/local text needle(s): ${leakedText.join(", ")}.` };
  }
  return { ok: true, payloadRoot: root, message: "Staged update payload is valid." };
}

export async function extractUpdateZip(zipPath: string, destination: string): Promise<void> {
  const script = `
$ErrorActionPreference = "Stop"
$ZipPath = ${powershellString(zipPath)}
$Destination = ${powershellString(destination)}
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$destFull = [System.IO.Path]::GetFullPath($Destination)
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  foreach ($entry in $zip.Entries) {
    $name = [string]$entry.FullName
    $normalized = $name.Replace("\\", "/")
    if ([string]::IsNullOrWhiteSpace($normalized)) { throw "Zip entry name is empty." }
    if ($normalized.StartsWith("/") -or $normalized -match "^[A-Za-z]:") { throw "Zip entry uses an absolute path: $name" }
    if ($normalized.Split("/") -contains "..") { throw "Zip entry attempts to leave the update directory: $name" }
    $target = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($destFull, $name))
    if ($target -ne $destFull -and -not $target.StartsWith($destFull + [System.IO.Path]::DirectorySeparatorChar)) {
      throw "Zip entry resolves outside destination: $name"
    }
  }
} finally {
  $zip.Dispose()
}
[System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Destination)
`;
  await runPowershell(script);
}

function readPersistedState(filePath: string): PersistedUpdateState {
  try {
    const parsed = JSON.parse(readFileSyncUtf8(filePath)) as PersistedUpdateState;
    return { skippedVersion: typeof parsed.skippedVersion === "string" ? parsed.skippedVersion : undefined };
  } catch {
    return {};
  }
}

async function writePersistedState(filePath: string, state: PersistedUpdateState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readFileSyncUtf8(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function renamePortableFile(from: string, to: string): Promise<void> {
  const { rename } = await import("node:fs/promises");
  await rename(from, to);
}

async function resolveStagedPayloadRoot(stageRoot: string): Promise<string | null> {
  const direct = resolve(stageRoot);
  if (existsSync(join(direct, "Habbpy v4.exe"))) return direct;
  const named = join(direct, "HabbpyV4");
  if (existsSync(join(named, "Habbpy v4.exe"))) return named;
  const entries = await readdir(direct, { withFileTypes: true }).catch(() => []);
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1) {
    const child = join(direct, directories[0].name);
    if (existsSync(join(child, "Habbpy v4.exe"))) return child;
  }
  return null;
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filePath = join(root, entry.name);
    if (entry.isDirectory()) yield* walkFiles(filePath);
    else if (entry.isFile()) yield filePath;
  }
}

async function runPowershell(script: string): Promise<void> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}.`));
    });
  });
}

function powershellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function safeVersionDir(version: string): string {
  return version.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "update";
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function replaceableInstallerPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("../")) return false;
  if (normalized.split("/")[0]?.toLowerCase() === "plugins") return installerManagedPluginPath(normalized);
  return true;
}
