import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  copyFile as copyFileAsync,
  link as linkAsync,
  mkdir as mkdirAsync,
  open as openAsync,
  readdir as readdirAsync,
  stat as statAsync,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { DEFAULT_VERSION_CHECK_BUILD, PROFILE_RUNTIME_DATA_SCHEMA_VERSION } from "../common/types.js";
import type {
  ImportProfileRequest,
  ImportProgress,
  ImportReport,
  ProfileImportStage,
  RuntimeProfile,
  RuntimeReadiness,
  StageState,
} from "../common/types.js";
import {
  defaultExtractionToolsRoot,
  defaultProfileScriptCompiler,
  defaultProjectorRaysExe,
  repoRootFromStandalone,
} from "./profilePaths.js";
import { ProfileStore } from "./profileStore.js";
import {
  assetIndexFiles,
  detectEngineExecutableScriptVersions,
  hasBundledExecutableScripts,
  isPlayableOriginsBaseline,
  missingExecutableScriptsReason,
  minimumOriginsBuildNumber,
  optionalRuntimeDataFiles,
  requiredRuntimeDataFiles,
  unsupportedOriginsProfileReason,
} from "./originsRuntimeAdapter.js";
import {
  profileValidationReportPath,
  summarizeProfileValidation,
  validateProfileContract,
  type ProfileValidationReport,
} from "./profileValidator.js";
import { clientVersionIdFromExternalVariables } from "./originsGamedata.js";
import { detectAcceptedVersionCheckBuild } from "./versionCheckBuild.js";

interface ImporterOptions {
  readonly cacheRoot: string;
  readonly profilesRoot?: string;
  readonly legacyProfilesRoot?: string;
  readonly projectorRaysExe?: string;
  readonly engineRoot?: string;
  readonly runProjectorRays?: boolean;
  readonly detectVersionCheckBuild?: boolean;
  readonly extractionToolsRoot?: string;
  readonly profileScriptCompiler?: string;
}

type ProgressSink = (progress: ImportProgress) => void;
type StageProgressSink = (
  stage: ProfileImportStage,
  state: ImportProgress["state"],
  message: string,
  detail?: string,
  current?: number,
  total?: number,
  percentOverride?: number,
) => void;

interface EngineConfig {
  readonly runtimeDataRoot?: string;
  readonly decodedAssetsRoot?: string;
  readonly originsSourceRoot?: string;
}

interface AssetCopyStats {
  readonly referenced: number;
  readonly copied: number;
  readonly reused: number;
  readonly missing: string[];
  readonly invalid: string[];
}

interface RuntimeReadinessOptions {
  readonly validateAssetContents?: boolean;
  readonly validateRuntimeDataContents?: boolean;
  readonly skipProfileValidation?: boolean;
  readonly runtimeDataSchemaVersion?: number;
  readonly executableScriptVersions?: readonly string[];
  readonly storedRuntime?: RuntimeReadiness;
  readonly assetStats?: AssetCopyStats;
  readonly profileValidation?: ProfileValidationReport;
}

interface CopyStats {
  readonly totalFiles: number;
  readonly copiedFiles: number;
  readonly copiedBytes: number;
  readonly skippedZeroByteFiles: number;
}

interface CopyPlanEntry {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly relativePath: string;
  readonly size: number;
}

interface ProfileRuntimeGenerationOptions {
  readonly versionId: string;
  readonly sourceId: string;
  readonly clientRoot: string;
  readonly profileRoot: string;
  readonly extractedRoot: string;
  readonly runtimeDataRoot: string;
  readonly assetsRoot: string;
  readonly scriptsRoot: string;
  readonly entryMovie: string;
  readonly extractionToolsRoot: string;
  readonly profileScriptCompiler: string;
}

interface ProjectorRaysProgressSample {
  readonly elapsedMs: number;
  readonly logBytes: number;
  readonly outputFiles: number;
  readonly capped: boolean;
}

const STAGE_PERCENT: Record<ProfileImportStage, number> = {
  validate: 7,
  sanitize: 20,
  projectorrays: 45,
  "index-casts": 58,
  "text-fields": 68,
  "materialize-bitmaps": 78,
  "generate-scripts": 88,
  "validate-profile": 100,
};

const STAGE_ORDER: ProfileImportStage[] = [
  "validate",
  "sanitize",
  "projectorrays",
  "index-casts",
  "text-fields",
  "materialize-bitmaps",
  "generate-scripts",
  "validate-profile",
];

const PROJECTORRAYS_OUTPUT_SAMPLE_LIMIT = 25000;
const ASSET_PROGRESS_INTERVAL = 1000;

export class ProfileImporter {
  private readonly store: ProfileStore;
  private readonly projectorRaysExe: string;
  private readonly engineRoot: string;
  private readonly runProjectorRays: boolean;
  private readonly detectVersionCheckBuild: boolean;
  private readonly extractionToolsRoot: string;
  private readonly profileScriptCompiler: string;

  constructor(private readonly options: ImporterOptions) {
    this.store = new ProfileStore(options.cacheRoot, {
      profilesRoot: options.profilesRoot,
      legacyProfilesRoot: options.legacyProfilesRoot,
    });
    this.projectorRaysExe = options.projectorRaysExe ?? defaultProjectorRaysExe();
    this.engineRoot = options.engineRoot ?? repoRootFromStandalone();
    this.runProjectorRays = options.runProjectorRays !== false;
    this.detectVersionCheckBuild = options.detectVersionCheckBuild ?? this.runProjectorRays;
    this.extractionToolsRoot = options.extractionToolsRoot ?? defaultExtractionToolsRoot();
    this.profileScriptCompiler = options.profileScriptCompiler ?? defaultProfileScriptCompiler();
  }

  async importProfile(request: ImportProfileRequest, onProgress: ProgressSink = () => undefined): Promise<RuntimeProfile> {
    const manualVersionCheckBuild = normalizeRequestedVersionCheckBuild(request.versionCheckBuild);
    let versionCheckBuild = manualVersionCheckBuild ?? DEFAULT_VERSION_CHECK_BUILD;
    const stages: ImportProgress[] = [];
    const importStartedAt = Date.now();
    const progress = (
      stage: ProfileImportStage,
      state: ImportProgress["state"],
      message: string,
      detail?: string,
      current?: number,
      total?: number,
      percentOverride?: number,
    ): void => {
      const entry: ImportProgress = {
        stage,
        state,
        message,
        detail,
        percent: percentOverride ?? progressPercent(stage, state, current, total),
        elapsedMs: Date.now() - importStartedAt,
        ...(current !== undefined ? { current } : {}),
        ...(total !== undefined ? { total } : {}),
      };
      stages.push(entry);
      onProgress(entry);
    };

    const requestedClientRoot = resolve(request.clientRoot);
    progress("validate", "running", "Validating compiled client folder", requestedClientRoot);
    const resolvedClient = resolveCompiledClientRoot(requestedClientRoot);
    const clientRoot = resolvedClient.clientRoot;
    const validated = resolvedClient.validation;
    progress(
      "validate",
      "done",
      `Found ${validated.castCount} cast files`,
      resolvedClient.selectedFromParent ? `${validated.entryMovie}; selected ${clientRoot}` : validated.entryMovie,
    );

    const id = createProfileId(validated.versionId, clientRoot);
    const tempRoot = join(this.store.profilesRoot, `.importing-${id}`);
    const finalRoot = join(this.store.profilesRoot, id);
    rmSync(tempRoot, { recursive: true, force: true });
    mkdirSync(tempRoot, { recursive: true });

    const profilePaths = {
      client: "client",
      extracted: "extracted/projectorrays",
      runtimeData: "runtime-data",
      assets: "assets",
      scripts: "scripts",
      report: "import-report.json",
    };
    const skippedZeroByteFiles: string[] = [];
    const warnings: string[] = [...validated.warnings];
    let projectorraysExitCode: number | null = null;
    let projectorraysVersionOutput = "";

    try {
      progress("sanitize", "running", "Copying client into profile cache", "Source folder is never modified");
      const copyStats = await sanitizeCopy(clientRoot, join(tempRoot, profilePaths.client), skippedZeroByteFiles, (copied, total) => {
        progress("sanitize", "running", "Copying client into profile cache", `${copied}/${total} files copied`, copied, total);
      });
      progress("sanitize", "running", "Preparing client metadata", "Recovering external variables/texts if needed");
      await ensureOptionalClientFiles(join(tempRoot, profilePaths.client), validated.buildNumber, warnings);
      const clientVariablesPath = join(tempRoot, profilePaths.client, "external_variables.txt");
      const clientVariableVersionId = existsSync(clientVariablesPath)
        ? clientVersionIdFromExternalVariables(readFileSync(clientVariablesPath, "utf8"))
        : null;
      if (manualVersionCheckBuild !== null) {
        progress(
          "sanitize",
          "running",
          "Using manual VERSIONCHECK build override",
          `build ${manualVersionCheckBuild}${clientVariableVersionId ? `; external client.version.id=${clientVariableVersionId}` : ""}`,
        );
      } else if (this.detectVersionCheckBuild) {
        progress(
          "sanitize",
          "running",
          "Detecting accepted VERSIONCHECK build",
          clientVariableVersionId ? `external client.version.id=${clientVariableVersionId}` : "Official handshake probe",
        );
        const detected = await detectAcceptedVersionCheckBuild({
          preferredBuilds: [DEFAULT_VERSION_CHECK_BUILD, versionCheckBuild],
        });
        if (detected.build !== null) {
          versionCheckBuild = detected.build;
          progress("sanitize", "running", "Detected accepted VERSIONCHECK build", `build ${versionCheckBuild}`);
        } else {
          warnings.push(
            `Could not auto-detect accepted VERSIONCHECK build${
              detected.error ? `: ${detected.error}` : ""
            }. Falling back to ${DEFAULT_VERSION_CHECK_BUILD}.`,
          );
        }
      }
      progress(
        "sanitize",
        skippedZeroByteFiles.length > 0 ? "warning" : "done",
        `Copied ${copyStats.copiedFiles} client file(s), ${formatBytes(copyStats.copiedBytes)}`,
        skippedZeroByteFiles.length > 0 ? `Skipped ${skippedZeroByteFiles.length} zero-byte cast file(s)` : undefined,
        copyStats.copiedFiles,
        copyStats.totalFiles,
      );

      mkdirSync(join(tempRoot, profilePaths.extracted), { recursive: true });
      const logPath = join(tempRoot, "projectorrays.log");
      if (this.runProjectorRays) {
        if (!existsSync(this.projectorRaysExe)) {
          throw new Error(`ProjectorRays executable not found: ${this.projectorRaysExe}`);
        }
        progress("projectorrays", "running", "Running ProjectorRays", basename(this.projectorRaysExe));
        projectorraysVersionOutput = await runProjectorRaysVersion(this.projectorRaysExe, join(tempRoot, profilePaths.client, validated.entryMovie));
        projectorraysExitCode = await runProjectorRaysDecompile(
          this.projectorRaysExe,
          join(tempRoot, profilePaths.client),
          join(tempRoot, profilePaths.extracted),
          logPath,
          (sample) => {
            const outputText = sample.capped
              ? `at least ${sample.outputFiles.toLocaleString()} output files`
              : `${sample.outputFiles.toLocaleString()} output files`;
            const percent = projectorRaysRunningPercent(sample.elapsedMs);
            progress(
              "projectorrays",
              "running",
              "Running ProjectorRays",
              `${outputText}; ${formatBytes(sample.logBytes)} log output`,
              undefined,
              undefined,
              percent,
            );
          },
        );
        const extractedCount = await countFilesAsync(join(tempRoot, profilePaths.extracted));
        progress(
          "projectorrays",
          "done",
          "ProjectorRays decompile completed",
          `Exit code ${projectorraysExitCode}; ${extractedCount.toLocaleString()} output files`,
        );
      } else {
        warnings.push("ProjectorRays execution was skipped by importer option.");
        writeFileSync(logPath, "ProjectorRays execution skipped.\n", "utf8");
        progress("projectorrays", "skipped", "ProjectorRays skipped", "Used only for tests or dry runs");
      }

      const runtimeDataRoot = join(tempRoot, profilePaths.runtimeData);
      const assetsRoot = join(tempRoot, profilePaths.assets);
      const scriptsRoot = join(tempRoot, profilePaths.scripts);
      mkdirSync(runtimeDataRoot, { recursive: true });
      mkdirSync(assetsRoot, { recursive: true });
      mkdirSync(scriptsRoot, { recursive: true });
      ensureOptionalRuntimeDataFiles(runtimeDataRoot, validated.versionId);

      let assetStats: AssetCopyStats;
      if (this.runProjectorRays) {
        assetStats = await generateProfileRuntimeData(
          {
            versionId: validated.versionId,
            sourceId: `compiled-${validated.buildNumber ?? validated.versionId}`,
            clientRoot,
            profileRoot: tempRoot,
            extractedRoot: join(tempRoot, profilePaths.extracted),
            runtimeDataRoot,
            assetsRoot,
            scriptsRoot,
            entryMovie: validated.entryMovie,
            extractionToolsRoot: this.extractionToolsRoot,
            profileScriptCompiler: this.profileScriptCompiler,
          },
          progress,
          warnings,
        );
      } else {
        for (const [stage, message] of [
          ["index-casts", "Preparing cast index directory"],
          ["text-fields", "Preparing text-field directory"],
          ["materialize-bitmaps", "Materializing bitmap assets into the profile cache"],
          ["generate-scripts", "Preparing generated script registry directory"],
        ] as const) {
          progress(stage, "skipped", message, "ProjectorRays execution was skipped");
        }
        assetStats = { referenced: 0, copied: 0, reused: 0, missing: [], invalid: [] };
      }

      if (validated.versionId === "release306" && assetStats.referenced === 0) {
        copyKnownRuntimeData(validated.versionId, this.engineRoot, runtimeDataRoot, warnings);
        progress("materialize-bitmaps", "running", "Materializing known release306 bitmap assets into the profile cache");
        assetStats = await copyKnownRuntimeAssets(
          validated.versionId,
          this.engineRoot,
          runtimeDataRoot,
          assetsRoot,
          warnings,
          (detail, current, total) =>
            progress("materialize-bitmaps", "running", "Materializing bitmap assets into the profile cache", detail, current, total),
        );
        progress(
          "materialize-bitmaps",
          assetStats.missing.length > 0 || assetStats.invalid.length > 0 ? "warning" : "done",
          `Materialized ${assetStats.referenced} referenced bitmap asset file(s)`,
          `${assetStats.copied} copied, ${assetStats.reused} already present`,
          assetStats.referenced,
          assetStats.referenced,
        );
      }

      const profileValidation = validateProfileContract({
        versionId: validated.versionId,
        runtimeDataRoot,
        assetsRoot,
        scriptsRoot,
        extractedRoot: join(tempRoot, profilePaths.extracted),
        runtimeDataSchemaVersion: PROFILE_RUNTIME_DATA_SCHEMA_VERSION,
      });
      const readiness = validateRuntimeReadiness(
        runtimeDataRoot,
        validated.versionId,
        assetsRoot,
        join(tempRoot, profilePaths.extracted),
        {
          assetStats,
          runtimeDataSchemaVersion: PROFILE_RUNTIME_DATA_SCHEMA_VERSION,
          executableScriptVersions: detectEngineExecutableScriptVersions(this.engineRoot),
          validateRuntimeDataContents: true,
          profileValidation,
        },
      );
      writeFileSync(profileValidationReportPath(tempRoot), `${JSON.stringify(profileValidation, null, 2)}\n`, "utf8");
      if (!readiness.ready) {
        warnings.push(readiness.reason ?? "Runtime profile is not yet launchable.");
      }

      progress(
        "validate-profile",
        readiness.ready ? "done" : "warning",
        readiness.ready ? "Profile is ready to launch" : "Profile imported but runtime data generation is incomplete",
        readiness.reason,
      );

      const profile: RuntimeProfile = {
        id,
        displayName: originsProfileDisplayName(validated.buildNumber, basename(clientRoot)),
        versionId: validated.versionId,
        buildNumber: validated.buildNumber,
        versionCheckBuild,
        importedAt: new Date().toISOString(),
        sourceFolderName: basename(clientRoot),
        entryMovie: validated.entryMovie,
        alternateEntryMovies: validated.alternateEntryMovies,
        status: "imported",
        fixedStage: request.fixedStage,
        resizablePresentation: request.resizablePresentation,
        paths: profilePaths,
        runtime: readiness,
        importReportPath: profilePaths.report,
        runtimeDataSchemaVersion: PROFILE_RUNTIME_DATA_SCHEMA_VERSION,
      };

      const report: ImportReport = {
        profileId: id,
        generatedAt: new Date().toISOString(),
        runtimeDataSchemaVersion: PROFILE_RUNTIME_DATA_SCHEMA_VERSION,
        sourceFolderName: basename(clientRoot),
        versionCheckBuild,
        entryMovie: validated.entryMovie,
        alternateEntryMovies: validated.alternateEntryMovies,
        skippedZeroByteFiles,
        warnings,
        stages,
        projectorrays: {
          executable: basename(this.projectorRaysExe),
          exitCode: projectorraysExitCode,
          logPath: "projectorrays.log",
          versionOutput: projectorraysVersionOutput,
        },
        runtime: readiness,
        profileValidation: summarizeProfileValidation(profileValidation),
        assets: {
          referenced: assetStats.referenced,
          copied: assetStats.copied,
          reused: assetStats.reused,
          missing: assetStats.missing.length,
          invalid: assetStats.invalid.length,
        },
      };
      writeFileSync(join(tempRoot, profilePaths.report), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      this.store.write(tempRoot, profile);

      commitProfileDirectory(tempRoot, finalRoot);
      return { ...profile, profileRoot: finalRoot };
    } catch (error) {
      preserveFailedImport(tempRoot, id, error, stages);
      progress("validate-profile", "failed", "Import failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

function preserveFailedImport(tempRoot: string, id: string, error: unknown, stages: ImportProgress[]): void {
  if (!existsSync(tempRoot)) return;
  const failedRoot = join(dirname(tempRoot), `.failed-${id}-${Date.now()}`);
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(
    join(tempRoot, "failed-import.json"),
    `${JSON.stringify(
      {
        failedAt: new Date().toISOString(),
        error: message,
        stages,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  try {
    renameSync(tempRoot, failedRoot);
  } catch {
    cpSync(tempRoot, failedRoot, { recursive: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function commitProfileDirectory(tempRoot: string, finalRoot: string): void {
  rmSync(finalRoot, { recursive: true, force: true });
  try {
    renameSync(tempRoot, finalRoot);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EPERM" && code !== "EXDEV") throw error;
    cpSync(tempRoot, finalRoot, { recursive: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function ensureOptionalClientFiles(clientRoot: string, buildNumber: number | null, warnings: string[]): Promise<void> {
  const steamBuildPath = join(clientRoot, "steam_build.txt");
  if (!existsSync(steamBuildPath)) {
    writeFileSync(steamBuildPath, "", "utf8");
  }
  await ensureExternalFieldFile(clientRoot, "external_variables.txt", buildNumber, warnings);
  await ensureExternalFieldFile(clientRoot, "external_texts.txt", buildNumber, warnings);
}

async function ensureExternalFieldFile(
  clientRoot: string,
  fileName: "external_variables.txt" | "external_texts.txt",
  buildNumber: number | null,
  warnings: string[],
): Promise<void> {
  const targetPath = join(clientRoot, fileName);
  if (existsSync(targetPath)) return;

  if (buildNumber !== null) {
    const url = `https://cdn.sulek.dev/ShockwaveWindows/${buildNumber}/${fileName}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 0) {
          writeFileSync(targetPath, bytes);
          warnings.push(`Imported ${fileName} from Sulek Shockwave Windows build ${buildNumber}.`);
          return;
        }
      }
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      throw new Error(
        `Compiled client is missing ${fileName}, and the standard metadata download for build ${buildNumber} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    throw new Error(`Compiled client is missing ${fileName}, and no build number was detected for the standard metadata download.`);
  }
}

function ensureOptionalRuntimeDataFiles(runtimeDataRoot: string, versionId: string): void {
  const supplementPath = join(runtimeDataRoot, `external-cast-text-fields-supplement.${versionId}.json`);
  if (!existsSync(supplementPath)) {
    writeFileSync(
      supplementPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), releases: [{ versionId, release: versionId, fields: [] }] }, null, 2)}\n`,
      "utf8",
    );
  }
}

function normalizeRequestedVersionCheckBuild(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

const REQUIRED_EXTRACTION_TOOLS = [
  "build-projectorrays-manifest.mjs",
  "extract-projectorrays-text-fields.mjs",
  "index-external-fields.mjs",
  "build-external-cast-graph.mjs",
  "extract-external-cast-text-fields.mjs",
  "recover-external-cast-text-fields.mjs",
  "build-external-cast-window-layout-index.mjs",
  "decode-external-cast-bitmaps.mjs",
  "build-visual-bitmap-assets.mjs",
  "decode-button-element-bitmaps.mjs",
] as const;

async function generateProfileRuntimeData(
  options: ProfileRuntimeGenerationOptions,
  progress: StageProgressSink,
  warnings: string[],
): Promise<AssetCopyStats> {
  const version = options.versionId;
  assertExtractionTools(options.extractionToolsRoot);
  if (!existsSync(options.profileScriptCompiler)) {
    throw new Error(`Standalone profile script compiler not found: ${options.profileScriptCompiler}`);
  }
  const summaryPath = join(options.profileRoot, "extraction", "projectorrays-summary.json");
  mkdirSync(dirname(summaryPath), { recursive: true });
  writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        releases: [
          {
            release: version,
            sourceRelease: version,
            outputRoot: "extracted/projectorrays",
            entryMovie: options.entryMovie,
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const runtimeFile = (name: string): string => join(options.runtimeDataRoot, name);
  const tool = (name: string): string => join(options.extractionToolsRoot, name);
  const toolProgress = (
    stage: ProfileImportStage,
    message: string,
    toolName: string,
    progressRoot?: string,
    percentForSample?: (sample: ProjectorRaysProgressSample) => number,
  ): {
    readonly progressRoot?: string;
    readonly onProgress: (sample: ProjectorRaysProgressSample) => void;
  } => ({
    ...(progressRoot ? { progressRoot } : {}),
    onProgress: (sample) => {
      progress(
        stage,
        "running",
        message,
        toolProgressDetail(toolName, sample),
        undefined,
        undefined,
        percentForSample?.(sample),
      );
    },
  });

  progress("index-casts", "running", "Building profile manifest and cast graph", "ProjectorRays manifest");
  await runNodeTool(
    tool("build-projectorrays-manifest.mjs"),
    [
      "--summary",
      summaryPath,
      "--output-root",
      options.runtimeDataRoot,
      "--bitmap-asset-root",
      join(options.assetsRoot, "projectorrays-score-bitmaps"),
      "--release",
      version,
    ],
    options.profileRoot,
    toolProgress("index-casts", "Building profile manifest and cast graph", "build-projectorrays-manifest.mjs", options.runtimeDataRoot),
  );

  await runNodeTool(
    tool("index-external-fields.mjs"),
    [
      "--source",
      `${version}:${options.sourceId}:client/external_variables.txt`,
      "--source",
      `${version}:${options.sourceId}:client/external_texts.txt`,
      "--out",
      runtimeFile(`external-fields.${version}.json`),
    ],
    options.profileRoot,
    toolProgress("index-casts", "Indexing external variable/text fields", "index-external-fields.mjs", options.runtimeDataRoot),
  );

  await runNodeTool(
    tool("build-external-cast-graph.mjs"),
    [
      "--summary",
      summaryPath,
      "--external-fields",
      runtimeFile(`external-fields.${version}.json`),
      "--out",
      runtimeFile(`external-cast-graph.${version}.json`),
      "--version",
      version,
    ],
    options.profileRoot,
    toolProgress("index-casts", "Building external cast graph", "build-external-cast-graph.mjs", options.runtimeDataRoot),
  );
  progress("index-casts", "done", "Built profile cast graph", `${version}-projectorrays-manifest.json`);

  progress("text-fields", "running", "Extracting profile text fields", "ProjectorRays and external cast text");
  await runNodeTool(
    tool("extract-projectorrays-text-fields.mjs"),
    [
      "--summary",
      summaryPath,
      "--manifest-root",
      options.runtimeDataRoot,
      "--out",
      runtimeFile(`projectorrays-text-fields.${version}.json`),
      "--release",
      version,
    ],
    options.profileRoot,
    toolProgress("text-fields", "Extracting profile text fields", "extract-projectorrays-text-fields.mjs", options.runtimeDataRoot),
  );
  await runNodeTool(
    tool("extract-external-cast-text-fields.mjs"),
    [
      "--external-cast-graph",
      runtimeFile(`external-cast-graph.${version}.json`),
      "--out",
      runtimeFile(`external-cast-text-fields.${version}.json`),
      "--version",
      version,
    ],
    options.profileRoot,
    toolProgress("text-fields", "Extracting external cast text fields", "extract-external-cast-text-fields.mjs", options.runtimeDataRoot),
  );
  await runNodeTool(
    tool("recover-external-cast-text-fields.mjs"),
    [
      "--external-cast-graph",
      runtimeFile(`external-cast-graph.${version}.json`),
      "--external-cast-text-fields",
      runtimeFile(`external-cast-text-fields.${version}.json`),
      "--source-root",
      options.extractedRoot,
      "--out",
      runtimeFile(`external-cast-text-fields-supplement.${version}.json`),
      "--version",
      version,
    ],
    options.profileRoot,
    toolProgress("text-fields", "Recovering supplemental text fields", "recover-external-cast-text-fields.mjs", options.runtimeDataRoot),
  );
  for (const layoutKind of ["window", "visual"] as const) {
    await runNodeTool(
      tool("build-external-cast-window-layout-index.mjs"),
      [
        "--external-cast-graph",
        runtimeFile(`external-cast-graph.${version}.json`),
        "--external-cast-text-fields",
        runtimeFile(`external-cast-text-fields.${version}.json`),
        "--out",
        runtimeFile(`external-cast-${layoutKind}-layout-index.${version}.json`),
        "--layout-kind",
        layoutKind,
        "--version",
        version,
      ],
      options.profileRoot,
      toolProgress(
        "text-fields",
        `Building ${layoutKind} layout index`,
        "build-external-cast-window-layout-index.mjs",
        options.runtimeDataRoot,
      ),
    );
  }
  progress("text-fields", "done", "Extracted profile text and layout indexes", version);

  progress("materialize-bitmaps", "running", "Decoding profile bitmap assets", "External cast bitmaps");
  await runNodeTool(
    tool("decode-external-cast-bitmaps.mjs"),
    [
      "--external-cast-graph",
      runtimeFile(`external-cast-graph.${version}.json`),
      "--out",
      runtimeFile(`external-bitmap-assets.${version}.json`),
      "--asset-root",
      join(options.assetsRoot, "external-bitmaps"),
      "--asset-path-base",
      options.assetsRoot,
      "--version",
      version,
    ],
    options.profileRoot,
    {
      progressRoot: join(options.assetsRoot, "external-bitmaps"),
      onProgress: (sample) => {
        const written =
          sample.capped
            ? `at least ${sample.outputFiles.toLocaleString()} external PNG file(s) written`
            : `${sample.outputFiles.toLocaleString()} external PNG file(s) written`;
        progress(
          "materialize-bitmaps",
          "running",
          "Decoding profile bitmap assets",
          written,
          undefined,
          undefined,
          bitmapGenerationPercent(sample.elapsedMs),
        );
      },
    },
  );

  progress("materialize-bitmaps", "running", "Decoding profile visual bitmap assets", "Visualizer/layout bitmaps");
  await runNodeTool(
    tool("build-visual-bitmap-assets.mjs"),
    [
      "--version",
      version,
      "--source-root",
      options.extractedRoot,
      "--runtime-data-root",
      options.runtimeDataRoot,
      "--asset-root",
      join(options.assetsRoot, "visual-bitmaps"),
      "--asset-path-base",
      options.assetsRoot,
      "--out",
      runtimeFile(`visual-bitmap-assets.${version}.json`),
    ],
    options.profileRoot,
    toolProgress(
      "materialize-bitmaps",
      "Decoding profile visual bitmap assets",
      "build-visual-bitmap-assets.mjs",
      join(options.assetsRoot, "visual-bitmaps"),
      (sample) => bitmapGenerationPercent(sample.elapsedMs),
    ),
  );

  await runNodeTool(
    tool("decode-button-element-bitmaps.mjs"),
    [
      "--external-cast-graph",
      runtimeFile(`external-cast-graph.${version}.json`),
      "--external-cast-text-fields",
      runtimeFile(`external-cast-text-fields.${version}.json`),
      "--out",
      runtimeFile(`button-bitmap-assets.${version}.json`),
      "--asset-root",
      join(options.assetsRoot, "button-bitmaps"),
      "--asset-path-base",
      options.assetsRoot,
      "--version",
      version,
    ],
    options.profileRoot,
    toolProgress(
      "materialize-bitmaps",
      "Decoding profile button bitmap assets",
      "decode-button-element-bitmaps.mjs",
      join(options.assetsRoot, "button-bitmaps"),
      (sample) => bitmapGenerationPercent(sample.elapsedMs),
    ),
  );

  normalizeProfileAssetPaths(options.runtimeDataRoot);
  const assetStats = await collectProfileAssetStats(options.runtimeDataRoot, version, options.assetsRoot);
  progress(
    "materialize-bitmaps",
    assetStats.missing.length > 0 || assetStats.invalid.length > 0 ? "warning" : "done",
    `Materialized ${assetStats.referenced.toLocaleString()} referenced bitmap asset file(s)`,
    `${assetStats.copied.toLocaleString()} ready, ${assetStats.missing.length.toLocaleString()} missing`,
    assetStats.copied,
    assetStats.referenced,
  );
  if (assetStats.missing.length > 0) {
    warnings.push(`Missing ${assetStats.missing.length} referenced bitmap asset file(s). First missing: ${assetStats.missing.slice(0, 5).join(", ")}`);
  }
  if (assetStats.invalid.length > 0) {
    warnings.push(`Invalid ${assetStats.invalid.length} referenced bitmap asset file(s). First invalid: ${assetStats.invalid.slice(0, 5).join(", ")}`);
  }

  progress("generate-scripts", "running", "Indexing profile Lingo scripts", "Profile script identity registry");
  const scriptRegistry = buildProfileScriptRegistry(options.extractedRoot, version);
  writeFileSync(join(options.scriptsRoot, "profile-script-registry.json"), `${JSON.stringify(scriptRegistry, null, 2)}\n`, "utf8");
  progress("generate-scripts", "running", "Generating executable profile scripts", "Lingo to browser modules");
  await runNodeTool(
    options.profileScriptCompiler,
    [
      "--source-root",
      options.extractedRoot,
      "--out-root",
      join(options.scriptsRoot, "executable"),
      "--version",
      version,
    ],
    options.profileRoot,
    toolProgress(
      "generate-scripts",
      "Generating executable profile scripts",
      "profile-script-compiler.mjs",
      join(options.scriptsRoot, "executable"),
    ),
  );
  progress(
    "generate-scripts",
    "done",
    `Generated ${scriptRegistry.scripts.length.toLocaleString()} executable profile script member(s)`,
    "Profile executable script registry ready",
  );

  return assetStats;
}

function assertExtractionTools(root: string): void {
  for (const tool of REQUIRED_EXTRACTION_TOOLS) {
    const toolPath = join(root, tool);
    if (!existsSync(toolPath)) {
      throw new Error(`Standalone extraction tool not found: ${toolPath}`);
    }
  }
}

async function runNodeTool(
  scriptPath: string,
  args: string[],
  cwd: string,
  options: {
    readonly progressRoot?: string;
    readonly onProgress?: (sample: ProjectorRaysProgressSample) => void;
  } = {},
): Promise<void> {
  const electronRunAsNode = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
  const result = await runProcess(process.execPath, [scriptPath, ...args], cwd, {
    progressRoot: options.progressRoot,
    onProgress: options.onProgress,
    env: {
      ...process.env,
      ...electronRunAsNode,
    },
  });
  if (result.exitCode !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    throw new Error(`Extraction tool failed (${result.exitCode}): ${basename(scriptPath)}${output ? `\n${output}` : ""}`);
  }
}

function normalizeProfileAssetPaths(runtimeDataRoot: string): void {
  for (const entry of readdirSync(runtimeDataRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !/bitmap-assets\..+\.json$/i.test(entry.name)) continue;
    const filePath = join(runtimeDataRoot, entry.name);
    const data = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    normalizeAssetReferences(data);
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

function normalizeAssetReferences(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) normalizeAssetReferences(entry);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if ((key === "pngPath" || key === "sourcePngPath") && typeof entry === "string") {
      record[key] = normalizeAssetReference(entry);
    } else if (key === "inkAssetPaths" && entry && typeof entry === "object") {
      for (const [ink, pathValue] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof pathValue === "string") {
          (entry as Record<string, unknown>)[ink] = normalizeAssetReference(pathValue);
        }
      }
    } else {
      normalizeAssetReferences(entry);
    }
  }
}

function normalizeAssetReference(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("generated/assets/")) return normalized;
  if (normalized.startsWith("assets/")) return `generated/${normalized}`;
  const marker = "/assets/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return `generated/assets/${normalized.slice(markerIndex + marker.length)}`;
  }
  return normalized;
}

async function collectProfileAssetStats(runtimeDataRoot: string, versionId: string, assetsRoot: string): Promise<AssetCopyStats> {
  const assetPaths = collectReferencedAssetPaths(runtimeDataRoot, versionId);
  let ready = 0;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const assetPath of assetPaths) {
    const fullPath = join(assetsRoot, assetPath);
    if (!existsSync(fullPath)) {
      missing.push(assetPath);
    } else if (await pngLooksValidAsync(fullPath)) {
      ready += 1;
    } else {
      invalid.push(assetPath);
    }
  }
  return { referenced: assetPaths.length, copied: ready, reused: 0, missing, invalid };
}

function buildProfileScriptRegistry(extractedRoot: string, versionId: string): {
  readonly generatedAt: string;
  readonly versionId: string;
  readonly scripts: Array<{
    readonly castFile: string;
    readonly castLib: string;
    readonly scriptType: string;
    readonly memberNumber: number | null;
    readonly memberName: string | null;
    readonly sourcePath: string;
  }>;
} {
  const scripts = collectLingoFiles(extractedRoot).map((file) => {
    const relativePath = relative(extractedRoot, file).replace(/\\/g, "/");
    const parts = relativePath.split("/");
    const castFile = parts[0] ?? "";
    const castIndex = parts.indexOf("casts");
    const castLib = castIndex >= 0 ? parts[castIndex + 1] ?? "" : "";
    const fileName = parts[parts.length - 1] ?? "";
    const match = /^(MovieScript|ParentScript|BehaviorScript|CastScript)\s+(\d+)(?:\s+-\s+(.+))?\.ls$/i.exec(fileName);
    const rawType = match?.[1]?.toLowerCase() ?? "unknown";
    const scriptType =
      rawType === "moviescript"
        ? "movie"
        : rawType === "parentscript"
          ? "parent"
          : rawType === "behaviorscript"
            ? "behavior"
            : rawType === "castscript"
              ? "cast"
              : "unknown";
    return {
      castFile,
      castLib,
      scriptType,
      memberNumber: match?.[2] ? Number.parseInt(match[2], 10) : null,
      memberName: match?.[3] ?? null,
      sourcePath: relativePath,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    versionId,
    scripts: scripts.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
  };
}

function collectLingoFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".ls")) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

export function validateCompiledClient(clientRoot: string): {
  entryMovie: string;
  alternateEntryMovies: string[];
  castCount: number;
  versionId: string;
  buildNumber: number | null;
  warnings: string[];
} {
  if (!existsSync(clientRoot) || !statSync(clientRoot).isDirectory()) {
    throw new Error(`Compiled client folder does not exist: ${clientRoot}`);
  }

  const entries = readdirSync(clientRoot, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const entryMovie = files.find((entry) => entry.name.toLowerCase() === "habbo.dcr");
  if (!entryMovie) throw new Error("Folder must contain habbo.dcr");
  const entryPath = join(clientRoot, entryMovie.name);
  if (statSync(entryPath).size <= 0) throw new Error("habbo.dcr is empty");

  const fuseClient = files.find((entry) => entry.name.toLowerCase() === "fuse_client.cct");
  if (!fuseClient || statSync(join(clientRoot, fuseClient.name)).size <= 0) {
    throw new Error("Folder must contain a non-empty fuse_client.cct");
  }

  const castCount = files.filter((entry) => isDirectorCastFile(entry.name) && statSync(join(clientRoot, entry.name)).size > 0).length;
  if (castCount < 25) {
    throw new Error(`Folder has too few non-empty Director cast files for a supported Origins client: ${castCount}`);
  }

  const buildNumber = inferBuildNumber(clientRoot);
  const minimumBuild = minimumOriginsBuildNumber();
  if (buildNumber !== null && buildNumber < minimumBuild) {
    throw new Error(`Unsupported Origins client build ${buildNumber}; standalone profiles start at build ${minimumBuild}`);
  }

  const warnings: string[] = [];
  if (!existsSync(join(clientRoot, "external_variables.txt"))) {
    warnings.push("external_variables.txt is missing from the compiled folder; runtime import may need recovered field data.");
  }
  if (!existsSync(join(clientRoot, "external_texts.txt"))) {
    warnings.push("external_texts.txt is missing from the compiled folder; runtime import may need recovered text data.");
  }

  return {
    entryMovie: entryMovie.name,
    alternateEntryMovies: files
      .map((entry) => entry.name)
      .filter((name) => /\.dcr$/i.test(name) && name.toLowerCase() !== "habbo.dcr")
      .sort(),
    castCount,
    versionId: buildNumber ? `release${buildNumber}` : "release-unknown",
    buildNumber,
    warnings,
  };
}

function resolveCompiledClientRoot(requestedRoot: string): {
  readonly clientRoot: string;
  readonly validation: ReturnType<typeof validateCompiledClient>;
  readonly selectedFromParent: boolean;
} {
  try {
    return { clientRoot: requestedRoot, validation: validateCompiledClient(requestedRoot), selectedFromParent: false };
  } catch (directError) {
    if (!existsSync(requestedRoot) || !statSync(requestedRoot).isDirectory()) {
      throw directError;
    }

    const candidates = readdirSync(requestedRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const childRoot = join(requestedRoot, entry.name);
        try {
          const validation = validateCompiledClient(childRoot);
          return {
            clientRoot: childRoot,
            validation,
            mtimeMs: statSync(childRoot).mtimeMs,
          };
        } catch {
          return null;
        }
      })
      .filter((candidate): candidate is { clientRoot: string; validation: ReturnType<typeof validateCompiledClient>; mtimeMs: number } =>
        candidate !== null,
      )
      .sort((left, right) => {
        const leftBuild = left.validation.buildNumber ?? -1;
        const rightBuild = right.validation.buildNumber ?? -1;
        if (leftBuild !== rightBuild) return rightBuild - leftBuild;
        if (left.mtimeMs !== right.mtimeMs) return right.mtimeMs - left.mtimeMs;
        return left.clientRoot.localeCompare(right.clientRoot);
      });

    const selected = candidates[0];
    if (!selected) throw directError;
    return {
      clientRoot: selected.clientRoot,
      validation: selected.validation,
      selectedFromParent: true,
    };
  }
}

function profileExecutableScriptStatus(
  scriptsRoot: string,
  versionId: string,
): { ready: boolean; versionLabel: string; reason?: string } {
  const executableRoot = join(scriptsRoot, "executable");
  const registryPath = join(executableRoot, "registry.js");
  const manifestPath = join(executableRoot, "manifest.json");
  const versionLabel = `profile:${versionId}`;
  if (!existsSync(registryPath) || !existsSync(manifestPath)) {
    return {
      ready: false,
      versionLabel,
      reason: missingExecutableScriptsReason(versionId),
    };
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      readonly versionId?: unknown;
      readonly scriptCount?: unknown;
      readonly failureCount?: unknown;
    };
    const manifestVersion = String(manifest.versionId ?? "").trim().toLowerCase();
    if (manifestVersion !== versionId.trim().toLowerCase()) {
      return {
        ready: false,
        versionLabel,
        reason: `Profile executable scripts were generated for ${manifestVersion || "an unknown version"}, not ${versionId}. Re-import this compiled client folder.`,
      };
    }
    const scriptCount = Number(manifest.scriptCount);
    const failureCount = Number(manifest.failureCount);
    if (!Number.isInteger(scriptCount) || scriptCount <= 0) {
      return {
        ready: false,
        versionLabel,
        reason: `Profile executable scripts for ${versionId} are empty. Re-import this compiled client folder.`,
      };
    }
    if (!Number.isInteger(failureCount) || failureCount > 0) {
      return {
        ready: false,
        versionLabel,
        reason: `Profile executable script generation for ${versionId} has ${Number.isFinite(failureCount) ? failureCount : "unknown"} failure(s). Re-import after fixing the compiler issue.`,
      };
    }
    return { ready: true, versionLabel };
  } catch (error) {
    return {
      ready: false,
      versionLabel,
      reason: `Profile executable script manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function validateRuntimeReadiness(
  runtimeDataRoot: string,
  versionId: string,
  assetsRoot?: string,
  extractedRoot?: string,
  options: RuntimeReadinessOptions = {},
): RuntimeReadiness {
  const scriptsRoot = join(runtimeDataRoot, "..", "scripts");
  const profileExecutableScripts = profileExecutableScriptStatus(scriptsRoot, versionId);
  if (!isPlayableOriginsBaseline(versionId)) {
    return {
      ready: false,
      reason: unsupportedOriginsProfileReason(versionId),
      missingFiles: [],
      executableScriptsSupported: profileExecutableScripts.ready,
      executableScriptVersion: profileExecutableScripts.versionLabel,
    };
  }
  const executableScriptsSupported =
    profileExecutableScripts.ready || hasBundledExecutableScripts(versionId, options.executableScriptVersions);
  const missingRuntimeFiles = requiredRuntimeDataFiles(versionId).filter((file) => !existsSync(join(runtimeDataRoot, file)));
  const missingFiles: string[] = [...missingRuntimeFiles];
  if (!executableScriptsSupported) {
    missingFiles.push(`scripts/executable/registry.js`);
  }
  const runtimeDataShapeErrors: string[] = [];
  const profileValidation = options.skipProfileValidation
    ? null
    : (options.profileValidation ??
      validateProfileContract({
        versionId,
        runtimeDataRoot,
        assetsRoot,
        scriptsRoot,
        extractedRoot,
        runtimeDataSchemaVersion: options.runtimeDataSchemaVersion,
        validateAssetContents: options.validateAssetContents,
      }));
  const profileValidationSummary =
    profileValidation !== null
      ? summarizeProfileValidation(profileValidation)
      : (options.storedRuntime?.validation ?? {
          ready: options.storedRuntime?.ready ?? false,
          errorCount: 0,
          warningCount: 0,
          checkCount: 0,
        });

  if (options.runtimeDataSchemaVersion !== PROFILE_RUNTIME_DATA_SCHEMA_VERSION) {
    missingFiles.push(`runtime-data schema v${PROFILE_RUNTIME_DATA_SCHEMA_VERSION}`);
  } else if (options.validateRuntimeDataContents) {
    runtimeDataShapeErrors.push(...validateRuntimeDataSchemaContents(runtimeDataRoot, versionId));
    missingFiles.push(...runtimeDataShapeErrors.map((reason) => `runtime-data/${reason}`));
  }

  if (extractedRoot && !hasExtractedProjectorRaysOutput(extractedRoot)) {
    missingFiles.push("extracted/projectorrays output");
  }

  const scriptRegistryPath = join(scriptsRoot, "profile-script-registry.json");
  if (!existsSync(scriptRegistryPath)) {
    missingFiles.push("scripts/profile-script-registry.json");
  }

  let assetReferences = 0;
  let assetFilesReady = 0;
  let assetFilesMissing = 0;
  let assetFilesInvalid = 0;
  if (assetsRoot) {
    if (options.assetStats) {
      assetReferences = options.assetStats.referenced;
      assetFilesMissing = options.assetStats.missing.length;
      assetFilesInvalid = options.assetStats.invalid.length;
      assetFilesReady = Math.max(0, assetReferences - assetFilesMissing - assetFilesInvalid);
      for (const assetPath of [...options.assetStats.missing, ...options.assetStats.invalid].slice(0, 50)) {
        missingFiles.push(`assets/${assetPath}`);
      }
    } else if (options.validateAssetContents) {
      const assetPaths = collectReferencedAssetPaths(runtimeDataRoot, versionId);
      assetReferences = assetPaths.length;
      for (const assetPath of assetPaths) {
        const fullPath = join(assetsRoot, assetPath);
        if (!existsSync(fullPath)) {
          assetFilesMissing += 1;
          if (missingFiles.length < 50) missingFiles.push(`assets/${assetPath}`);
          continue;
        }
        if (!pngLooksValid(fullPath)) {
          assetFilesInvalid += 1;
          if (missingFiles.length < 50) missingFiles.push(`assets/${assetPath}`);
          continue;
        }
        assetFilesReady += 1;
      }
    } else {
      const stored = options.storedRuntime;
      assetReferences = stored?.assetReferences ?? 0;
      assetFilesReady = stored?.assetFilesReady ?? 0;
      assetFilesMissing = stored?.assetFilesMissing ?? 0;
      assetFilesInvalid = stored?.assetFilesInvalid ?? 0;
      if (
        assetReferences <= 0 ||
        assetFilesReady !== assetReferences ||
        assetFilesMissing !== 0 ||
        assetFilesInvalid !== 0 ||
        !existsSync(assetsRoot)
      ) {
        missingFiles.push("validated bitmap asset profile");
      }
    }
  }

  const reasons: string[] = [];
  if (missingRuntimeFiles.length > 0) {
    reasons.push(`Missing runtime-data files: ${missingRuntimeFiles.join(", ")}`);
  }
  if (!executableScriptsSupported) {
    reasons.push(profileExecutableScripts.reason ?? missingExecutableScriptsReason(versionId));
  }
  if (options.runtimeDataSchemaVersion !== PROFILE_RUNTIME_DATA_SCHEMA_VERSION) {
    reasons.push(
      `Profile was imported with an older runtime-data schema; re-import the compiled client folder so indexed bitmap palettes are regenerated.`,
    );
  }
  if (runtimeDataShapeErrors.length > 0) {
    reasons.push(`Runtime-data schema validation failed: ${runtimeDataShapeErrors.join("; ")}`);
  }
  if (extractedRoot && !hasExtractedProjectorRaysOutput(extractedRoot)) {
    reasons.push("Missing ProjectorRays extraction output.");
  }
  if (!existsSync(scriptRegistryPath)) {
    reasons.push("Missing profile script registry.");
  }
  const profileValidationErrors = profileValidation?.issues.filter((issue) => issue.severity === "error") ?? [];
  if (profileValidationErrors.length > 0) {
    const sample = profileValidationErrors
      .slice(0, 4)
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    reasons.push(`Profile compiler validation failed: ${sample}`);
    for (const issue of profileValidationErrors.slice(0, 50)) {
      missingFiles.push(`profile-validation/${issue.code}`);
    }
  }
  if (assetsRoot && assetFilesMissing + assetFilesInvalid > 0) {
    reasons.push(`Missing or invalid bitmap assets: ${assetFilesMissing} missing, ${assetFilesInvalid} invalid.`);
  } else if (assetsRoot && assetReferences <= 0) {
    reasons.push("Profile was imported before bitmap asset validation; re-import the compiled client folder.");
  } else if (assetsRoot && missingFiles.includes("validated bitmap asset profile")) {
    reasons.push("Bitmap asset profile is incomplete; re-import the compiled client folder.");
  }
  return {
    ready: missingFiles.length === 0,
    reason: reasons.length > 0 ? reasons.join(" ") : undefined,
    missingFiles,
    executableScriptsSupported,
    executableScriptVersion: profileExecutableScripts.ready ? profileExecutableScripts.versionLabel : versionId,
    assetReferences,
    assetFilesReady,
    assetFilesMissing,
    assetFilesInvalid,
    validation: profileValidationSummary,
  };
}

function validateRuntimeDataSchemaContents(runtimeDataRoot: string, versionId: string): string[] {
  const externalBitmapPath = join(runtimeDataRoot, `external-bitmap-assets.${versionId}.json`);
  if (!existsSync(externalBitmapPath)) return [];

  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(externalBitmapPath, "utf8"));
  } catch (error) {
    return [`external-bitmap-assets.${versionId}.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }

  const assets = externalBitmapAssets(raw);
  const indexed = assets.filter((asset) => Number(asset.bitDepth) > 0 && Number(asset.bitDepth) < 32);
  const indexedWithPalette = indexed.filter(
    (asset) =>
      typeof asset.paletteIndexData === "string" &&
      asset.paletteIndexData.length > 0 &&
      Array.isArray(asset.paletteColors) &&
      asset.paletteColors.length > 0,
  );
  if (indexed.length > 0 && indexedWithPalette.length < Math.min(indexed.length, 100)) {
    errors.push(
      `external-bitmap-assets.${versionId}.json is missing indexed palette data (${indexedWithPalette.length}/${indexed.length} indexed bitmaps usable)`,
    );
  }

  for (const required of [
    ["hh_interface", "window.top.left"],
    ["hh_cat_gfx_all", "tree_col1_unselected"],
    ["hh_console", "console_bg"],
  ] as const) {
    const asset = assets.find(
      (entry) =>
        normalizeRuntimeDataName(String(entry.castName ?? "")) === normalizeRuntimeDataName(required[0]) &&
        normalizeRuntimeDataName(String(entry.memberName ?? "")) === normalizeRuntimeDataName(required[1]),
    );
    if (!asset || Number(asset.bitDepth) >= 32) continue;
    if (
      typeof asset.paletteIndexData !== "string" ||
      asset.paletteIndexData.length === 0 ||
      !Array.isArray(asset.paletteColors) ||
      asset.paletteColors.length === 0
    ) {
      errors.push(`${required[0]}/${required[1]} lacks paletteIndexData or paletteColors`);
    }
  }

  return errors;
}

function externalBitmapAssets(raw: unknown): Record<string, unknown>[] {
  const releases = (raw as { releases?: unknown })?.releases;
  const release =
    Array.isArray(releases) ? releases[0] : releases && typeof releases === "object" ? Object.values(releases)[0] : undefined;
  const assets = (release as { assets?: unknown })?.assets;
  return Array.isArray(assets) ? (assets as Record<string, unknown>[]) : [];
}

function normalizeRuntimeDataName(value: string): string {
  return value.trim().toLowerCase().replace(/\.(cct|cst)$/i, "");
}

async function sanitizeCopy(
  sourceRoot: string,
  targetRoot: string,
  skippedZeroByteFiles: string[],
  onProgress: (copied: number, total: number) => void,
): Promise<CopyStats> {
  const plan: CopyPlanEntry[] = [];
  collectCopyPlan(sourceRoot, sourceRoot, targetRoot, plan, skippedZeroByteFiles);
  await mkdirAsync(targetRoot, { recursive: true });
  let copiedFiles = 0;
  let copiedBytes = 0;
  for (const entry of plan) {
    await mkdirAsync(dirname(entry.targetPath), { recursive: true });
    await copyFileAsync(entry.sourcePath, entry.targetPath);
    copiedFiles += 1;
    copiedBytes += entry.size;
    if (copiedFiles % 10 === 0 || copiedFiles === plan.length) {
      onProgress(copiedFiles, plan.length);
      await yieldToEventLoop();
    }
  }
  return {
    totalFiles: plan.length,
    copiedFiles,
    copiedBytes,
    skippedZeroByteFiles: skippedZeroByteFiles.length,
  };
}

function collectCopyPlan(
  root: string,
  sourceRoot: string,
  targetRoot: string,
  plan: CopyPlanEntry[],
  skippedZeroByteFiles: string[],
): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const sourcePath = join(root, entry.name);
    const relativePath = relative(sourceRoot, sourcePath).replace(/\\/g, "/");
    const targetPath = join(targetRoot, relativePath);
    if (entry.isDirectory()) {
      collectCopyPlan(sourcePath, sourceRoot, targetRoot, plan, skippedZeroByteFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const size = statSync(sourcePath).size;
    if (size === 0 && isDirectorCastFile(entry.name)) {
      skippedZeroByteFiles.push(relativePath);
      continue;
    }
    plan.push({ sourcePath, targetPath, relativePath, size });
  }
}

function copyKnownRuntimeData(versionId: string, engineRoot: string, outRoot: string, warnings: string[]): void {
  mkdirSync(outRoot, { recursive: true });
  if (!isPlayableOriginsBaseline(versionId)) {
    warnings.push(`${versionId} runtime data generator is not connected yet; profile cache contains client and ProjectorRays output only.`);
    return;
  }
  const config = readEngineConfig(engineRoot);
  const candidates = uniquePaths([join(engineRoot, "generated", "runtime-data"), config.runtimeDataRoot].filter(isString));
  if (!candidates.some((candidate) => existsSync(join(candidate, `${versionId}-projectorrays-manifest.json`)))) {
    warnings.push("Known Origins baseline runtime-data files were not found beside the engine checkout.");
    return;
  }
  for (const file of [...requiredRuntimeDataFiles(versionId), ...optionalRuntimeDataFiles(versionId)]) {
    const source = candidates.map((candidate) => join(candidate, file)).find((candidate) => existsSync(candidate));
    if (source) copyFileSync(source, join(outRoot, file));
  }
}

async function copyKnownRuntimeAssets(
  versionId: string,
  engineRoot: string,
  runtimeDataRoot: string,
  outRoot: string,
  warnings: string[],
  onProgress: (detail: string, current: number, total: number) => void,
): Promise<AssetCopyStats> {
  await mkdirAsync(outRoot, { recursive: true });
  if (!isPlayableOriginsBaseline(versionId)) {
    return { referenced: 0, copied: 0, reused: 0, missing: [], invalid: [] };
  }

  const assetPaths = collectReferencedAssetPaths(runtimeDataRoot, versionId);
  const config = readEngineConfig(engineRoot);
  const sourceRoots = uniquePaths([join(engineRoot, "generated", "assets"), config.decodedAssetsRoot].filter(isString));
  if (sourceRoots.length === 0) {
    warnings.push("No decoded asset roots are configured.");
  }

  let copied = 0;
  let reused = 0;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (let index = 0; index < assetPaths.length; index += 1) {
    const assetPath = assetPaths[index]!;
    const target = join(outRoot, assetPath);
    if (await pngLooksValidAsync(target)) {
      reused += 1;
    } else {
      const source = await firstValidPng(sourceRoots.map((root) => join(root, assetPath)));
      if (!source) {
        missing.push(assetPath);
      } else {
        await mkdirAsync(dirname(target), { recursive: true });
        await linkOrCopyFile(source, target);
        if (await pngLooksValidAsync(target)) {
          copied += 1;
        } else {
          invalid.push(assetPath);
        }
      }
    }

    if ((index + 1) % ASSET_PROGRESS_INTERVAL === 0 || index + 1 === assetPaths.length) {
      onProgress(
        `${(index + 1).toLocaleString()}/${assetPaths.length.toLocaleString()} assets checked; ${copied.toLocaleString()} materialized, ${reused.toLocaleString()} reused`,
        index + 1,
        assetPaths.length,
      );
      await yieldToEventLoop();
    }
  }

  if (missing.length > 0) {
    warnings.push(`Missing ${missing.length} referenced bitmap asset file(s). First missing: ${missing.slice(0, 5).join(", ")}`);
  }
  if (invalid.length > 0) {
    warnings.push(`Invalid ${invalid.length} referenced bitmap asset file(s). First invalid: ${invalid.slice(0, 5).join(", ")}`);
  }

  return { referenced: assetPaths.length, copied, reused, missing, invalid };
}

function collectReferencedAssetPaths(runtimeDataRoot: string, versionId: string): string[] {
  const paths = new Set<string>();
  for (const file of assetIndexFiles(versionId)) {
    const fullPath = join(runtimeDataRoot, file);
    if (!existsSync(fullPath)) continue;
    collectAssetPathsFromValue(JSON.parse(readFileSync(fullPath, "utf8")), paths);
  }
  return [...paths].sort();
}

function collectAssetPathsFromValue(value: unknown, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectAssetPathsFromValue(entry, paths);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    if (key === "pngPath" && typeof entry === "string") {
      addAssetPath(paths, entry);
    } else if (key === "inkAssetPaths" && entry && typeof entry === "object") {
      for (const assetPath of Object.values(entry)) addAssetPath(paths, assetPath);
    } else if (typeof entry === "string" && /generated[\\/]assets[\\/].+\.png$/i.test(entry)) {
      addAssetPath(paths, entry);
    } else {
      collectAssetPathsFromValue(entry, paths);
    }
  }
}

function addAssetPath(paths: Set<string>, value: unknown): void {
  if (typeof value !== "string" || !/\.png$/i.test(value)) return;
  const stripped = value.replace(/^generated[\\/]+assets[\\/]+/i, "").replaceAll("\\", "/");
  if (stripped.length > 0 && !stripped.startsWith("../")) paths.add(stripped);
}

function pngLooksValid(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size < 33) return false;
    const fd = openSync(filePath, "r");
    try {
      const signature = Buffer.alloc(8);
      readSync(fd, signature, 0, 8, 0);
      return signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

async function pngLooksValidAsync(filePath: string): Promise<boolean> {
  try {
    const stats = await statAsync(filePath);
    if (!stats.isFile() || stats.size < 33) return false;
    const file = await openAsync(filePath, "r");
    try {
      const signature = Buffer.alloc(8);
      const result = await file.read(signature, 0, 8, 0);
      return (
        result.bytesRead === 8 &&
        signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

async function firstValidPng(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pngLooksValidAsync(candidate)) return candidate;
  }
  return null;
}

async function linkOrCopyFile(source: string, target: string): Promise<void> {
  rmSync(target, { force: true });
  try {
    await linkAsync(source, target);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "EXDEV" && code !== "EPERM" && code !== "EACCES" && code !== "ENOENT") {
      throw error;
    }
    await copyFileAsync(source, target);
  }
}

function hasExtractedProjectorRaysOutput(extractedRoot: string): boolean {
  if (!existsSync(extractedRoot)) return false;
  const stack = [extractedRoot];
  let scanned = 0;
  while (stack.length > 0 && scanned < 5000) {
    const root = stack.pop()!;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      scanned += 1;
      if (entry.isDirectory()) {
        stack.push(join(root, entry.name));
      } else if (entry.isFile() && /\.(ls|lasm|json|txt)$/i.test(entry.name) && statSync(join(root, entry.name)).size > 0) {
        return true;
      }
    }
  }
  return false;
}

function readEngineConfig(engineRoot: string): EngineConfig {
  const candidates = [join(engineRoot, "engine.config.json")];
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as EngineConfig;
  } catch {
    return {};
  }
}

function uniquePaths(paths: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of paths) {
    const resolved = resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(resolved);
  }
  return result;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function runProjectorRaysVersion(executable: string, entryMovie: string): Promise<string> {
  const result = await runProcess(executable, ["version", entryMovie, "--style", "long"], undefined);
  return `${result.stdout}${result.stderr}`.trim();
}

async function runProjectorRaysDecompile(
  executable: string,
  inputRoot: string,
  outRoot: string,
  logPath: string,
  onProgress: (sample: ProjectorRaysProgressSample) => void,
): Promise<number> {
  const result = await runProcess(
    executable,
    ["decompile", inputRoot, "-o", outRoot, "--dump-scripts", "--dump-chunks", "--dump-json"],
    undefined,
    { logPath, progressRoot: outRoot, onProgress },
  );
  if (result.exitCode !== 0) {
    throw new Error(`ProjectorRays failed with exit code ${result.exitCode}. See ${logPath}`);
  }
  return result.exitCode;
}

function runProcess(
  command: string,
  args: string[],
  cwd: string | undefined,
  options: {
    readonly logPath?: string;
    readonly progressRoot?: string;
    readonly onProgress?: (sample: ProjectorRaysProgressSample) => void;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, { cwd, env: options.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let logBytes = 0;
    const startedAt = Date.now();
    const logStream = options.logPath ? createWriteStream(options.logPath, { encoding: "utf8" }) : null;
    let progressBusy = false;
    let progressStopped = false;

    const emitProgress = async (): Promise<void> => {
      if (!options.onProgress || progressBusy || progressStopped) return;
      progressBusy = true;
      try {
        if (!options.progressRoot) {
          if (!progressStopped) {
            options.onProgress({
              elapsedMs: Date.now() - startedAt,
              logBytes,
              outputFiles: 0,
              capped: false,
            });
          }
          return;
        }
        const output = await countFilesUpToAsync(options.progressRoot, PROJECTORRAYS_OUTPUT_SAMPLE_LIMIT);
        if (!progressStopped) {
          options.onProgress({
            elapsedMs: Date.now() - startedAt,
            logBytes,
            outputFiles: output.count,
            capped: output.capped,
          });
        }
      } catch {
        if (!progressStopped) {
          options.onProgress({
            elapsedMs: Date.now() - startedAt,
            logBytes,
            outputFiles: 0,
            capped: false,
          });
        }
      } finally {
        progressBusy = false;
      }
    };

    const interval = options.onProgress ? setInterval(() => void emitProgress(), 2000) : null;
    if (options.onProgress) void emitProgress();

    const writeOutput = (chunk: Buffer, stream: "stdout" | "stderr"): void => {
      const text = String(chunk);
      logBytes += Buffer.byteLength(text);
      if (stream === "stdout") {
        if (!logStream) stdout += text;
      } else if (!logStream) {
        stderr += text;
      }
      logStream?.write(text.replaceAll("\\", "/"));
    };

    child.stdout.on("data", (chunk) => {
      writeOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)), "stdout");
    });
    child.stderr.on("data", (chunk) => {
      writeOutput(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)), "stderr");
    });
    child.on("error", (error) => {
      if (interval) clearInterval(interval);
      progressStopped = true;
      logStream?.end();
      reject(error);
    });
    child.on("close", (code) => {
      if (interval) clearInterval(interval);
      progressStopped = true;
      if (logStream) {
        logStream.end(() => resolveProcess({ exitCode: code ?? 1, stdout, stderr }));
      } else {
        resolveProcess({ exitCode: code ?? 1, stdout, stderr });
      }
    });
  });
}

function inferBuildNumber(clientRoot: string): number | null {
  const pathParts = resolve(clientRoot).split(/[\\/]/).reverse();
  for (const part of pathParts) {
    const match = /^(?:release|build|version|compiled|v)?[-_ ]?(\d{3,4})$/i.exec(part);
    if (match?.[1]) return Number(match[1]);
  }
  const iniPath = join(clientRoot, "Habbo.INI");
  if (existsSync(iniPath)) {
    const match = /(?:release|build|version)\D*(\d{3,4})/i.exec(readFileSync(iniPath, "utf8"));
    if (match) return Number(match[1]);
  }
  return null;
}

function createProfileId(versionId: string, clientRoot: string): string {
  const hash = createHash("sha1")
    .update(clientRoot)
    .update(String(Date.now()))
    .digest("hex")
    .slice(0, 8);
  return `${versionId.replace(/[^a-z0-9_-]/gi, "-")}-${hash}`;
}

function originsProfileDisplayName(buildNumber: number | null, sourceFolderName: string): string {
  const buildLabel = buildNumber ? `Origins build ${buildNumber}` : "Origins profile";
  return `${buildLabel} (${sourceFolderName})`;
}

function isDirectorCastFile(name: string): boolean {
  const ext = extname(name).toLowerCase();
  return ext === ".cct" || ext === ".cst" || ext === ".dcr" || ext === ".dir" || ext === ".dxr";
}

function progressPercent(
  stage: ProfileImportStage,
  state: StageState,
  current: number | undefined,
  total: number | undefined,
): number {
  const end = STAGE_PERCENT[stage];
  if (state === "done" || state === "warning" || state === "skipped") return end;
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const start = stageIndex > 0 ? STAGE_PERCENT[STAGE_ORDER[stageIndex - 1]!] : 0;
  if (current === undefined || total === undefined || total <= 0) return start;
  const ratio = Math.max(0, Math.min(1, current / total));
  return Math.round(start + (end - start) * ratio);
}

function projectorRaysRunningPercent(elapsedMs: number): number {
  const start = STAGE_PERCENT.projectorrays - 24;
  const end = STAGE_PERCENT.projectorrays - 1;
  const ratio = 1 - Math.exp(-Math.max(0, elapsedMs) / 120000);
  return Math.round(start + (end - start) * Math.min(0.92, ratio));
}

function bitmapGenerationPercent(elapsedMs: number): number {
  const start = STAGE_PERCENT["text-fields"] + 1;
  const end = STAGE_PERCENT["materialize-bitmaps"] - 1;
  const ratio = 1 - Math.exp(-Math.max(0, elapsedMs) / 180000);
  return Math.round(start + (end - start) * Math.min(0.95, ratio));
}

function toolProgressDetail(toolName: string, sample: ProjectorRaysProgressSample): string {
  const parts = [toolName, formatElapsed(sample.elapsedMs)];
  if (sample.outputFiles > 0) {
    const outputText = sample.capped
      ? `at least ${sample.outputFiles.toLocaleString()} output file(s)`
      : `${sample.outputFiles.toLocaleString()} output file(s)`;
    parts.push(outputText);
  }
  if (sample.logBytes > 0) parts.push(`${formatBytes(sample.logBytes)} log output`);
  return parts.join("; ");
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} elapsed`;
}

async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function countFilesAsync(root: string): Promise<number> {
  if (!existsSync(root)) return 0;
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of await readdirAsync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

async function countFilesUpToAsync(root: string, limit: number): Promise<{ count: number; capped: boolean }> {
  if (!existsSync(root)) return { count: 0, capped: false };
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of await readdirAsync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
      } else if (entry.isFile()) {
        count += 1;
        if (count >= limit) return { count, capped: true };
      }
    }
    await yieldToEventLoop();
  }
  return { count, capped: false };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}
