import { Application, TextureSource } from "pixi.js";
// Director inks 35/38 (Subtract Pin/Subtract) map to the GPU "subtract"
// blend, which Pixi only honors with the advanced-blend-modes extension;
// without it the room dimmer draws opaque and blacks out the stage.
import "pixi.js/advanced-blend-modes";
import { DirectorMovie, MovieManifest } from "@director/Movie";
import * as DirectorLingoRuntime from "@director/lingo";
import { LingoRect } from "@director/geometry";
import { CastMember, CastRegistry, setImageDecodeRequester, type BitmapInfo, type CastManifests } from "@director/members";
import { LingoImage } from "@director/imaging";
import { directorKeyForBrowserEvent, directorKeyForTextKey } from "@director/keyboard";
import { lingoEquals, lingoKeyEquals, truthy as lingoTruthy } from "@director/ops";
import { ScriptInstance, type Runtime } from "@director/Runtime";
import { SpriteChannel } from "@director/sprites";
import {
  LINGO_VOID,
  LingoList,
  LingoPropList,
  LingoSymbol,
  LingoVoid,
  numberOf,
  type LingoValue,
} from "@director/values";
import {
  externalMembersFromCastGraph,
  externalMembersFromGeneratedScripts,
  externalMembersFromVisuals,
  mergeDirectorBitmapAssets,
  palettesFromBitmapAssets,
  releaseArray,
  type BitmapPaletteSource,
  type ExternalCastRecord,
  type GeneratedScriptRecord,
  type RuntimeDataFile,
  type VisualLayoutRecord,
} from "../habbo/runtimeData";
import { installRelease306CastLoadCompatibility } from "../habbo/castLoadCompatibility";
import {
  origins306ClientVersionId,
  origins306ExternalParams,
  origins306VersionCheckClientTypeOverride,
  origins306VersionCheckExternalVariablesUrlOverride,
  overrideOrigins306ExternalVariables,
} from "../habbo/launchParams";
import { installRelease306ResourceManagerCompatibility } from "../habbo/resourceManagerCompatibility";
import { installRelease306RoomBufferCompatibility } from "../habbo/roomBufferCompatibility";
import { enableRelease306RoomAssetVariables } from "../habbo/roomAssetVariables";
import { installRelease306StringServicesCompatibility } from "../habbo/stringServicesCompatibility";
import { installRelease306TextManagerCompatibility } from "../habbo/textManagerCompatibility";
import { installOriginsVariableManagerCompatibility } from "../habbo/variableManagerCompatibility";
import { OriginsResizeEngine, type ResizeEngineSnapshot } from "../habbo/resizeEngine";
import {
  CUSTOM_HOTEL_VIEW_ASSETS,
  customHotelViewBannerUrl,
  customHotelViewLayout,
  customHotelViewToolbarUnderlayHeight,
  customHotelViewUsesLargeStage,
} from "../habbo/customHotelView";
import { bitmapUrlForInk } from "../render/ink";
import {
  StageRenderer,
  type CustomHotelViewPresentation,
  type PresentationUnderlay,
  type RoomStagePresentation,
  type UserNameLabel,
} from "../render/StageRenderer";
import { generatedScripts as release306GeneratedScripts } from "../../generated/scripts/registry";

/**
 * Boot harness: loads an Origins profile manifest, registers the generated
 * habbo.dir + fuse_client scripts, and runs the entry movie's score loop.
 * Everything that happens after this file is generated-from-source Lingo.
 */

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const mirrorEngineLogToConsole = new URLSearchParams(window.location.search).get("consoleLog") === "1";
const directorProfileRuntimeGlobal = globalThis as typeof globalThis & {
  __directorProfileRuntime?: { lingo: typeof DirectorLingoRuntime };
};
directorProfileRuntimeGlobal.__directorProfileRuntime = { lingo: DirectorLingoRuntime };
const ROOM_PRESENTATION_TOOLBAR_HEIGHT = 54;

function appendLog(kind: "info" | "error" | "put", text: string): void {
  const line = document.createElement("div");
  line.className = kind;
  line.textContent = `[${kind}] ${text}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  if (mirrorEngineLogToConsole) {
    const message = `[engine:${kind}] ${text}`;
    if (kind === "error") {
      console.error(message);
    } else {
      console.log(message);
    }
  }
}

// Source-derived from release306 external_variables.txt. The fast-entry dev
// path keeps these later casts for login avatars, home/bulletin UI, and the
// room asset buffer without forcing every furniture cast to load before login.
const FAST_ENTRY_DEFAULT_CAST_KEEP = [
  "hh_human_acc_face",
  "hh_human_acc_head",
  "hh_human_hats",
  "hh_human_hair",
  "hh_human_shirt",
  "hh_human_leg",
  "hh_human_shoe",
  "hh_human_acc_eye",
  "hh_human_body",
  "hh_human_face",
  "hh_human_item",
  "hh_human_acc_waist",
  "hh_human_acc_chest",
  "hh_human_50_shirt",
  "hh_human_50_leg",
  "hh_human_50_shoe",
  "hh_human_50_item",
  "hh_human_50_acc_chest",
  "hh_human_50_acc_waist",
  "hh_human_50_acc_head",
  "hh_human_50_body",
  "hh_human_50_face",
  "hh_human_50_hats",
  "hh_human_50_hair",
  "hh_human_50_acc_eye",
  "hh_human_50_acc_face",
  "hh_bulletin",
  "hh_buffer",
] as const;

function createDecodeScheduler(concurrency: number): <T>(task: () => Promise<T>) => Promise<T> {
  const queue: (() => Promise<void>)[] = [];
  let active = 0;

  // Pump synchronously: completions arrive on the microtask queue, so the
  // next task starts without a setTimeout clamp (which adds milliseconds per
  // task and turns ten thousand decodes into a minute of dead time).
  const pump = (): void => {
    while (active < concurrency && queue.length > 0) {
      const task = queue.shift()!;
      active += 1;
      void task().finally(() => {
        active -= 1;
        pump();
      });
    }
  };

  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      });
      pump();
    });
}

function installSourcePerfTrace(
  runtime: Runtime,
  thresholdMs: number,
  log: (level: "info" | "error" | "put", message: string) => void,
): void {
  const originalCallMethod = runtime.callMethod.bind(runtime);
  runtime.callMethod = (receiver: LingoValue, method: string, args: LingoValue[]): LingoValue => {
    const start = performance.now();
    try {
      return originalCallMethod(receiver, method, args);
    } finally {
      const elapsed = performance.now() - start;
      if (elapsed >= thresholdMs) {
        const target =
          receiver instanceof ScriptInstance
            ? receiver.module.scriptName
            : receiver instanceof LingoPropList
              ? "propList"
              : receiver instanceof LingoList
                ? "list"
                : typeof receiver;
        log("info", `[perf] ${target}.${method} ${elapsed.toFixed(1)}ms`);
      }
    }
  };
}

async function fetchImageBitmap(
  url: string,
  cache: Map<string, Promise<ImageBitmap | null>>,
): Promise<ImageBitmap | null> {
  let promise = cache.get(url);
  if (!promise) {
    promise = fetch(url)
      .then((response) => (response.ok ? response.blob() : Promise.reject(response.status)))
      .then((blob) => createImageBitmap(blob))
      .catch(() => null);
    cache.set(url, promise);
  }
  return promise;
}

/** Routes decoded pixels into the member's image slot. A pending placeholder
 * (created when generated code touched the image before decode) is filled in
 * place so journaled copyPixels replays fire; otherwise the decode becomes
 * the member's image buffer. Failures resolve empty so logic never stalls. */
function deliverBitmapPixels(bitmap: BitmapInfo, decoded: ImageBitmap | null): void {
  const existing = bitmap.decoded;
  if (existing) {
    existing.setMatteCoveragePolicy(bitmap.ink8AlphaPolicy);
    existing.adoptDrawable(decoded);
  } else if (decoded) {
    bitmap.decoded = LingoImage.fromDrawable(decoded, bitmap.width, bitmap.height)
      .setMatteCoveragePolicy(bitmap.ink8AlphaPolicy);
  } else {
    bitmap.decoded = new LingoImage(bitmap.width, bitmap.height, 32, undefined, { initWhite: false })
      .setMatteCoveragePolicy(bitmap.ink8AlphaPolicy);
  }
}

function limitCastEntryVariables(text: string, limit: number, keepNames: ReadonlySet<string>): string {
  if (limit <= 0 && keepNames.size === 0) return text;
  const lines = text.split(/\r\n|\r|\n/);
  const entries: Array<{ lineIndex: number; entryNumber: number; castName: string }> = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = /^cast\.entry\.(\d+)=(.+)$/i.exec(lines[lineIndex]!.trim());
    if (!match) continue;
    entries.push({
      lineIndex,
      entryNumber: Number(match[1]),
      castName: match[2]!.trim(),
    });
  }
  if (entries.length === 0) return text;
  const firstEntryLine = Math.min(...entries.map((entry) => entry.lineIndex));
  const castEntryLines = new Set(entries.map((entry) => entry.lineIndex));
  const compactedEntries = entries
    .filter((entry) => (limit > 0 && entry.entryNumber <= limit) || keepNames.has(entry.castName.toLowerCase()))
    .sort((left, right) => left.entryNumber - right.entryNumber)
    .map((entry, index) => `cast.entry.${index + 1}=${entry.castName}`);
  const result: string[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (lineIndex === firstEntryLine) {
      result.push(...compactedEntries);
    }
    if (castEntryLines.has(lineIndex)) continue;
    result.push(lines[lineIndex]!);
  }
  return result.join("\r");
}

function parseCastEntryKeep(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

function runtimeVersionFromParams(params: URLSearchParams): string {
  const candidate = (params.get("profileVersion") ?? params.get("versionId") ?? "release306").trim();
  return /^release\d+$/i.test(candidate) ? candidate.toLowerCase() : "release306";
}

type GeneratedScriptBundle = typeof release306GeneratedScripts;
type GeneratedScriptRegistryModule = { readonly generatedScripts: GeneratedScriptBundle };

async function generatedScriptsForRuntimeVersion(runtimeVersion: string, profileId: string): Promise<{
  readonly version: string;
  readonly scripts: GeneratedScriptBundle;
  readonly exact: boolean;
  readonly source: "profile" | "bundled";
}> {
  const profileBundle = await loadProfileExecutableScripts(runtimeVersion, profileId);
  if (profileBundle) return profileBundle;
  if (runtimeVersion === "release306") {
    return { version: "release306", scripts: release306GeneratedScripts, exact: true, source: "bundled" };
  }
  throw new Error(
    `No executable generated script bundle is available for ${runtimeVersion}. ` +
      `Import generated data/assets are not enough on their own; re-import the compiled client so scripts/executable/registry.js is generated for this profile.`,
  );
}

async function loadProfileExecutableScripts(
  runtimeVersion: string,
  profileId: string,
): Promise<{
  readonly version: string;
  readonly scripts: GeneratedScriptBundle;
  readonly exact: boolean;
  readonly source: "profile";
} | null> {
  const manifestResponse = await fetch("/origins-data/scripts/executable/manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) return null;
  const manifest = (await manifestResponse.json()) as {
    readonly versionId?: unknown;
    readonly scriptCount?: unknown;
    readonly failureCount?: unknown;
  };
  const manifestVersion = String(manifest.versionId ?? "").trim().toLowerCase();
  if (manifestVersion !== runtimeVersion) {
    throw new Error(`Profile executable scripts are for ${manifestVersion || "an unknown version"}, not ${runtimeVersion}.`);
  }
  const failureCount = Number(manifest.failureCount);
  if (!Number.isInteger(failureCount) || failureCount > 0) {
    throw new Error(`Profile executable scripts for ${runtimeVersion} have ${Number.isFinite(failureCount) ? failureCount : "unknown"} compiler failure(s).`);
  }
  const scriptCount = Number(manifest.scriptCount);
  if (!Number.isInteger(scriptCount) || scriptCount <= 0) {
    throw new Error(`Profile executable scripts for ${runtimeVersion} are empty.`);
  }
  const registryUrl =
    `/origins-data/scripts/executable/registry.js?profile=${encodeURIComponent(profileId)}&version=${encodeURIComponent(runtimeVersion)}`;
  const module = (await import(/* @vite-ignore */ registryUrl)) as GeneratedScriptRegistryModule;
  if (!Array.isArray(module.generatedScripts) || module.generatedScripts.length === 0) {
    throw new Error(`Profile executable registry for ${runtimeVersion} did not export generatedScripts.`);
  }
  return { version: runtimeVersion, scripts: module.generatedScripts, exact: true, source: "profile" };
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const runtimeVersion = runtimeVersionFromParams(params);
  const executableScripts = await generatedScriptsForRuntimeVersion(runtimeVersion, params.get("profile") ?? "");
  const resizablePresentation = params.get("resizablePresentation") === "1";
  const customHotelViewEnabled = params.get("customHotelView") === "1" || params.get("custom-hotelview") === "1";
  if (params.get("standalone") === "1") {
    document.body.dataset.standalone = "1";
  }
  if (resizablePresentation) {
    document.body.dataset.resizablePresentation = "1";
  }
  if (customHotelViewEnabled) {
    document.body.dataset.customHotelView = "1";
  }
  TextureSource.defaultOptions.scaleMode = "nearest";
  const fastVisual = params.get("fastVisual") === "1";
  const defaultCastEntryLimit = params.get("fastEntry") === "1" ? 13 : 0;
  const fastEntryCastLimit = Math.max(0, Number(params.get("castEntryLimit") ?? defaultCastEntryLimit) | 0);
  const castEntryKeep = parseCastEntryKeep(params.get("castEntryKeep"));
  if (params.get("fastEntry") === "1" && params.get("fastEntryEntryOnly") !== "1") {
    for (const castName of FAST_ENTRY_DEFAULT_CAST_KEEP) {
      castEntryKeep.add(castName);
    }
  }
  const decodeConcurrency = Math.max(1, Number(params.get("decodeConcurrency") ?? 8) | 0);
  // Casts with more bitmaps than this defer decoding to on-demand (touched
  // composites decode through setImageDecodeRequester). 0 = defer everything:
  // the furni/avatar casts alone hold ~16k bitmaps / ~150MB RGBA, and eagerly
  // decoding them is what made room entry take a minute.
  const eagerDecodeMaxParam = params.get("eagerDecodeMax");
  const eagerDecodeMax =
    eagerDecodeMaxParam === null ? 120 : Math.max(0, Number(eagerDecodeMaxParam) | 0);
  const scheduleDecode = createDecodeScheduler(decodeConcurrency);
  const textCache = new Map<string, Promise<string>>();
  const bitmapDecodeCache = new Map<string, Promise<ImageBitmap | null>>();
  const runtimeDataUrl = (name: string): string => `/origins-data/runtime-data/${name}`;
  const fetchRuntimeJson = async <T>(name: string): Promise<T> => {
    const response = await fetch(runtimeDataUrl(name));
    if (!response.ok) {
      throw new Error(`Failed to load runtime-data/${name}: HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  };
  const fetchOptionalRuntimeJson = async <T extends RuntimeDataFile>(name: string, fallback: T): Promise<T> => {
    const response = await fetch(runtimeDataUrl(name));
    return response.ok ? ((await response.json()) as T) : fallback;
  };
  const fetchOptionalJson = async <T>(url: string, fallback: T): Promise<T> => {
    const response = await fetch(url);
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return fallback;
    }
    return (await response.json()) as T;
  };

  const manifest = await fetchRuntimeJson<MovieManifest & {
    stage: { width: number; height: number; backgroundColor: string };
  }>(`${runtimeVersion}-projectorrays-manifest.json`);

  const stageWrapEl = document.getElementById("stage-wrap")!;
  const stageViewportSize = (): { width: number; height: number } => {
    if (!resizablePresentation) {
      return { width: manifest.stage.width, height: manifest.stage.height };
    }
    const rect = stageWrapEl.getBoundingClientRect();
    return {
      width: Math.max(manifest.stage.width, Math.floor(rect.width || window.innerWidth || manifest.stage.width)),
      height: Math.max(manifest.stage.height, Math.floor(rect.height || window.innerHeight || manifest.stage.height)),
    };
  };
  const initialStageViewport = stageViewportSize();
  const app = new Application();
  await app.init({
    width: initialStageViewport.width,
    height: initialStageViewport.height,
    background: manifest.stage.backgroundColor,
    antialias: false,
    autoDensity: false,
    resolution: 1,
    roundPixels: true,
    // Advanced blend modes (Director subtract inks) sample the backbuffer.
    useBackBuffer: true,
    // Diagnostic captures need canvas.toDataURL()/screenshots to see the
    // current WebGL frame. Keep it opt-in because preserving the drawing
    // buffer can slow normal play.
    preserveDrawingBuffer: params.get("capture") === "1",
  });
  const resizePixiStage = (width: number, height: number): boolean => {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const rendererChanged = app.renderer.width !== nextWidth || app.renderer.height !== nextHeight;
    const cssWidth = `${nextWidth}px`;
    const cssHeight = `${nextHeight}px`;
    const styleChanged = app.canvas.style.width !== cssWidth || app.canvas.style.height !== cssHeight;
    if (rendererChanged) app.renderer.resize(nextWidth, nextHeight);
    if (app.canvas.style.width !== cssWidth) app.canvas.style.width = cssWidth;
    if (app.canvas.style.height !== cssHeight) app.canvas.style.height = cssHeight;
    return rendererChanged || styleChanged;
  };
  resizePixiStage(initialStageViewport.width, initialStageViewport.height);
  app.canvas.style.imageRendering = "pixelated";
  stageWrapEl.appendChild(app.canvas);
  if (fastEntryCastLimit > 0) {
    appendLog("info", `fast entry cast limit: cast.entry.1..${fastEntryCastLimit}`);
  }
  if (castEntryKeep.size > 0) {
    appendLog("info", `fast entry cast keep (${castEntryKeep.size}): ${[...castEntryKeep].join(", ")}`);
  }
  if (fastVisual) {
    appendLog("info", "fast visual mode: bitmap buffer decode disabled");
  } else if (eagerDecodeMax > 0) {
    appendLog("info", `eager bitmap decode cap: ${eagerDecodeMax} per cast (eagerDecodeMax=0 defers all to on-demand)`);
  } else {
    appendLog("info", "eager bitmap decode disabled: all members decode on demand");
  }

  const [
    textFieldsRaw,
    externalTextFieldsRaw,
    supplementalTextFieldsRaw,
    bitmapsRaw,
    visualBitmapsRaw,
    visualLayoutsRaw,
    externalCastGraphRaw,
    profileScriptsRaw,
  ] = await Promise.all([
    fetchRuntimeJson<RuntimeDataFile>(`projectorrays-text-fields.${runtimeVersion}.json`),
    fetchRuntimeJson<RuntimeDataFile>(`external-cast-text-fields.${runtimeVersion}.json`),
    fetchOptionalRuntimeJson<RuntimeDataFile>(`external-cast-text-fields-supplement.${runtimeVersion}.json`, { releases: [{ fields: [] }] }),
    fetchRuntimeJson<RuntimeDataFile>(`external-bitmap-assets.${runtimeVersion}.json`),
    fetchRuntimeJson<RuntimeDataFile>(`visual-bitmap-assets.${runtimeVersion}.json`),
    fetchRuntimeJson<RuntimeDataFile>(`external-cast-visual-layout-index.${runtimeVersion}.json`),
    fetchRuntimeJson<RuntimeDataFile>(`external-cast-graph.${runtimeVersion}.json`),
    fetchOptionalJson<{ scripts: GeneratedScriptRecord[] }>("/origins-data/scripts/profile-script-registry.json", { scripts: [] }),
  ]);
  const textFields = [
    ...releaseArray<CastManifests["textFields"][number]>(textFieldsRaw, "fields"),
    ...releaseArray<CastManifests["textFields"][number]>(externalTextFieldsRaw, "fields"),
    ...releaseArray<CastManifests["textFields"][number]>(supplementalTextFieldsRaw, "fields"),
  ];
  const profileBitmaps = releaseArray<BitmapPaletteSource>(bitmapsRaw, "assets");
  const visualBitmaps = releaseArray<CastManifests["bitmaps"][number]>(visualBitmapsRaw, "assets");
  const palettes = [
    ...releaseArray<NonNullable<CastManifests["palettes"]>[number]>(bitmapsRaw, "palettes"),
    ...releaseArray<NonNullable<CastManifests["palettes"]>[number]>(visualBitmapsRaw, "palettes"),
    ...palettesFromBitmapAssets([...profileBitmaps, ...visualBitmaps]),
  ];
  const visualLayouts = releaseArray<VisualLayoutRecord>(visualLayoutsRaw, "visuals");
  const externalCasts = releaseArray<ExternalCastRecord>(externalCastGraphRaw, "casts");
  const profileScriptRecords = Array.isArray(profileScriptsRaw.scripts) ? profileScriptsRaw.scripts : [];
  const bitmaps = mergeDirectorBitmapAssets(profileBitmaps, visualBitmaps);
  const externalMembers = [
    ...externalMembersFromCastGraph(externalCasts),
    ...externalMembersFromVisuals(visualLayouts),
    ...externalMembersFromGeneratedScripts([...executableScripts.scripts, ...profileScriptRecords]),
  ];
  const members = new CastRegistry(
    { movie: manifest, textFields, bitmaps, palettes, externalMembers },
    "/origins-data/assets/",
  );
  members.loadCast("Internal");
  members.loadCast("fuse_client");
  appendLog(
    "info",
    `profile ${runtimeVersion}: casts loaded ${members.loaded.join(", ")} (${textFields.length} fields, ${profileBitmaps.length} profile bitmaps, ${visualBitmaps.length} visual bitmaps, ${palettes.length} palettes, ${externalMembers.length} external refs, ${profileScriptRecords.length} profile script members, executable scripts ${executableScripts.version} from ${executableScripts.source}${executableScripts.exact ? "" : " fallback"})`,
  );

  const renderer = new StageRenderer(app.stage);
  let customHotelViewUnderlayActive = (): boolean => false;
  const syncPresentationUnderlays = (snapshot: ResizeEngineSnapshot | null): void => {
    if (!resizablePresentation || !snapshot) {
      renderer.setPresentationUnderlays([]);
      return;
    }
    const customToolbar = customHotelViewUnderlayActive();
    const underlays: PresentationUnderlay[] = [];
    for (const anchor of snapshot.anchors) {
      if (anchor.action !== "toolbar-underlay") continue;
      const sourceHeight = anchor.height ?? 54;
      underlays.push({
        id: anchor.id,
        x: anchor.x ?? 0,
        y: anchor.y ?? 0,
        width: anchor.width ?? manifest.stage.width,
        height: customToolbar ? customHotelViewToolbarUnderlayHeight(sourceHeight) : sourceHeight,
        color: customToolbar ? 0x000000 : 0x555555,
        textureUrl: customToolbar ? undefined : "/presentation/toolbar-bg-54px.png",
      });
    }
    renderer.setPresentationUnderlays(underlays);
  };

  // Generated code touched a deferred member's image: decode it now so its
  // pending placeholder fills and journaled composites replay. Scheduled so a
  // room-entry burst stays at the decode concurrency limit.
  setImageDecodeRequester((member) => {
    const bitmap = member.bitmap;
    if (!bitmap?.pngUrl) return;
    const url = bitmap.pngUrl;
    void scheduleDecode(() => fetchImageBitmap(url, bitmapDecodeCache))
      .then((decoded) => {
        deliverBitmapPixels(bitmap, decoded);
        renderer.markDirty();
      })
      .catch(() => {
        deliverBitmapPixels(bitmap, null);
      });
  });

  let movieForRoomBuffer: DirectorMovie | null = null;
  const getRoomAssetBuffer = (): ScriptInstance | null => {
    const activeMovie = movieForRoomBuffer;
    if (!activeMovie) return null;
    const objectList = objectManagerList(activeMovie.runtime.getGlobal("gcore"));
    if (!objectList) return null;
    // Match the live release306 object identity. In this boot path the
    // source-created Buffer Component instance is registered as
    // #buffer_component and owns pPlaceHolderList/pLoadedCasts.
    const threadObject = propListLookup(objectList, "#room_asset_buffer");
    if (threadObject instanceof ScriptInstance) {
      try {
        const component = activeMovie.runtime.callMethod(threadObject, "getcomponent", []);
        if (component instanceof ScriptInstance) return component;
      } catch {
        // Fall through to the object id used by the source method.
      }
    }
    const objectComponent = propListLookup(objectList, "Room Asset Buffer");
    if (objectComponent instanceof ScriptInstance) return objectComponent;
    const bufferComponent = propListLookup(objectList, "#buffer_component");
    return bufferComponent instanceof ScriptInstance ? bufferComponent : null;
  };

  const movie = new DirectorMovie(
    manifest,
    { log: appendLog },
    async (fileName) => {
      // The original movie preloads the linked cast file over the network;
      // we fetch the same bytes from the official client distribution.
      const response = await fetch(`/origins-data/client/${fileName}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await response.arrayBuffer();
    },
    async (url) => {
      let promise = textCache.get(url);
      if (!promise) {
        promise = fetch(url).then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.text();
        }).then((text) => {
          if (!/(?:^|\/)external_variables\.txt(?:\?|$)/i.test(url)) return text;
          let variables = text;
          if (params.get("roomDynamicAssets") !== "0") {
            variables = enableRelease306RoomAssetVariables(variables);
          }
          variables = overrideOrigins306ExternalVariables(variables, params);
          variables = limitCastEntryVariables(variables, fastEntryCastLimit, castEntryKeep);
          return variables;
        });
        textCache.set(url, promise);
      }
      return promise;
    },
    members,
    () => renderer.markDirty(),
    "/origins-data/client/",
    origins306ExternalParams(params),
    async (castName) => {
      // Eagerly decode small/UI casts into image buffers for copyPixels
      // windows. Large avatar/furni casts defer: any member whose image is
      // actually touched by generated code is decoded on demand through the
      // setImageDecodeRequester hook, so deferral never blanks composites.
      if (fastVisual) {
        renderer.markDirty();
        return;
      }
      const candidates = members
        .membersOf(castName)
        .filter((member) => member.bitmap?.pngUrl && !member.bitmap.decoded);
      if (eagerDecodeMax === 0 || candidates.length > eagerDecodeMax) {
        if (candidates.length > 0) {
          appendLog(
            "info",
            `deferred ${candidates.length} bitmap buffer decodes for ${castName} (on-demand decode covers composites)`,
          );
        }
        renderer.markDirty();
        return;
      }
      const work: Promise<void>[] = [];
      for (const member of candidates) {
        const bitmap = member.bitmap;
        if (!bitmap || !bitmap.pngUrl || bitmap.decoded) continue;
        const url = bitmap.pngUrl;
        work.push(
          scheduleDecode(async () => {
            deliverBitmapPixels(bitmap, await fetchImageBitmap(url, bitmapDecodeCache));
          })
            .then(() => {
              renderer.markDirty();
            })
            .catch(() => {
              deliverBitmapPixels(bitmap, null);
            }),
        );
      }
      await Promise.all(work);
      appendLog("info", `decoded ${work.length} bitmaps for ${castName} (limit ${decodeConcurrency})`);
      renderer.markDirty();
    },
    {
      bobbaPublicKey: params.get("bobbaPublicKey") ?? undefined,
      tracePackets: params.get("tracePackets") === "1",
      release306VersionCheckBuild: origins306ClientVersionId(params),
      release306VersionCheckClientType: origins306VersionCheckClientTypeOverride(params),
      release306VersionCheckExternalVariablesUrl: origins306VersionCheckExternalVariablesUrlOverride(params),
      machineId: params.get("machineId")?.trim() || params.get("uniqueId")?.trim() || undefined,
    },
  );
  installRelease306CastLoadCompatibility(movie.runtime);
  installRelease306RoomBufferCompatibility(movie.runtime, members);
  installRelease306ResourceManagerCompatibility(movie.runtime, members);
  installOriginsVariableManagerCompatibility(movie.runtime);
  installRelease306StringServicesCompatibility(movie.runtime);
  installRelease306TextManagerCompatibility(movie.runtime);
  if (params.get("tracePerf") === "1") {
    installSourcePerfTrace(movie.runtime, Math.max(1, Number(params.get("tracePerfMs") ?? 25) || 25), appendLog);
  }
  const resizeEngine = resizablePresentation ? new OriginsResizeEngine(movie) : null;
  let resizeSnapshot: ResizeEngineSnapshot | null = null;
  const applyResizableViewport = (reason: string): void => {
    if (!resizeEngine) return;
    const size = stageViewportSize();
    const rendererResized = resizePixiStage(size.width, size.height);
    resizeSnapshot = resizeEngine.setViewport(size.width, size.height);
    syncPresentationUnderlays(resizeSnapshot);
    if (rendererResized || resizeSnapshot.changed) {
      const focusedSprite = Number(movie.keyboardFocusSprite) | 0;
      movie.prepareTextSpriteImages(focusedSprite);
      renderer.markDirty();
      if (!shouldHoldRoomAssetPresentation(getRoomAssetBuffer())) {
        renderer.sync(movie.channels, focusedSprite);
      }
    }
    if (resizeSnapshot.errors.length > 0) {
      appendLog("error", `resize engine ${reason}: ${resizeSnapshot.errors.join("; ")}`);
    }
  };
  if (resizeEngine) {
    applyResizableViewport("initial");
    let resizeQueued = false;
    const queueResize = (): void => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        applyResizableViewport("resize");
      });
    };
    new ResizeObserver(queueResize).observe(stageWrapEl);
    window.addEventListener("resize", queueResize);
  }
  movieForRoomBuffer = movie;
  movie.onImageReleased = (image) => renderer.releaseImage(image);
  appendLog("info", `network bridge: ${movie.networkBridgeUrl}`);

  const traceSprites = new Set(
    (params.get("traceSprites") ?? "")
      .split(",")
      .map((entry) => Number(entry.trim()) | 0)
      .filter((entry) => entry > 0),
  );
  if (traceSprites.size > 0) {
    const setProp = movie.setProp;
    movie.setProp = (receiver, property, value) => {
      if (
        receiver instanceof SpriteChannel &&
        traceSprites.has(receiver.number) &&
        ["loc", "loch", "locv", "width", "height", "member", "castnum"].includes(property)
      ) {
        appendLog(
          "info",
          `[sprite ${receiver.number}] ${property} ${JSON.stringify(debugValue(value))} before (${receiver.locH},${receiver.locV})`,
        );
      }
      return setProp(receiver, property, value);
    };
  }

  // Pointer and keyboard events feed Director's sprite event dispatch
  // (Event Broker behaviors, editable-field focus and typing).
  const stagePoint = (event: Pick<MouseEvent, "clientX" | "clientY">): { x: number; y: number } => {
    const bounds = app.canvas.getBoundingClientRect();
    if (resizeEngine) {
      return {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
    }
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * manifest.stage.width,
      y: ((event.clientY - bounds.top) / bounds.height) * manifest.stage.height,
    };
  };
  const valueToNumber = (value: LingoValue | undefined, fallback = 0): number => {
    if (value === undefined || value instanceof LingoVoid) return fallback;
    try {
      const numeric = numberOf(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    } catch {
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      }
      return fallback;
    }
  };
  const valueToId = (value: LingoValue): string =>
    value instanceof LingoSymbol ? `#${value.name}` : typeof value === "string" ? value : String(debugValue(value));
  const elementVisible = (element: ScriptInstance): boolean => {
    const value = instancePropValue(element, "pvisible");
    return value === undefined || value instanceof LingoVoid ? true : lingoTruthy(value);
  };
  const elementRect = (element: ScriptInstance): LingoRect | null => {
    const sprite = instancePropValue(element, "psprite");
    if (!(sprite instanceof SpriteChannel)) return null;
    const spriteRect = movie.spriteBounds(sprite.number);
    if (!spriteRect) return null;
    const hasOwnRect =
      !(instancePropValue(element, "pownx") instanceof LingoVoid) &&
      !(instancePropValue(element, "powny") instanceof LingoVoid);
    const ownX = hasOwnRect ? valueToNumber(instancePropValue(element, "pownx"), 0) : 0;
    const ownY = hasOwnRect ? valueToNumber(instancePropValue(element, "powny"), 0) : 0;
    const width = valueToNumber(
      hasOwnRect ? instancePropValue(element, "pownw") : instancePropValue(element, "pwidth"),
      spriteRect.width,
    );
    const height = valueToNumber(
      hasOwnRect ? instancePropValue(element, "pownh") : instancePropValue(element, "pheight"),
      spriteRect.height,
    );
    if (width <= 0 || height <= 0) return null;
    return new LingoRect(spriteRect.left + ownX, spriteRect.top + ownY, spriteRect.left + ownX + width, spriteRect.top + ownY + height);
  };
  const rectContains = (rect: LingoRect, x: number, y: number): boolean =>
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  const sourceWindowManager = (): ScriptInstance | null => {
    try {
      const manager = movie.runtime.call("getwindowmanager", []);
      return manager instanceof ScriptInstance ? manager : null;
    } catch {
      return null;
    }
  };
  const sourceWindowIds = (windowManager: ScriptInstance): LingoValue[] => {
    const itemList = instancePropValue(windowManager, "pitemlist");
    return itemList instanceof LingoList ? [...itemList.items] : [];
  };
  const sourceWindowById = (windowManager: ScriptInstance, id: LingoValue): ScriptInstance | null => {
    try {
      const windowObject = movie.runtime.callMethod(windowManager, "get", [id]);
      return windowObject instanceof ScriptInstance ? windowObject : null;
    } catch {
      return null;
    }
  };
  const sourceWindowVisible = (windowObject: ScriptInstance): boolean => {
    const visible = instancePropValue(windowObject, "pvisible");
    return visible === undefined || visible instanceof LingoVoid ? true : lingoTruthy(visible);
  };
  const sourceWindowRect = (windowObject: ScriptInstance): LingoRect | null => {
    const left = valueToNumber(instancePropValue(windowObject, "plocx"), Number.NaN);
    const top = valueToNumber(instancePropValue(windowObject, "plocy"), Number.NaN);
    const width = valueToNumber(instancePropValue(windowObject, "pwidth"), 0);
    const height = valueToNumber(instancePropValue(windowObject, "pheight"), 0);
    if (!Number.isFinite(left) || !Number.isFinite(top) || width <= 0 || height <= 0) return null;
    return new LingoRect(left, top, left + width, top + height);
  };
  const sourceWindowElements = (windowObject: ScriptInstance): ScriptInstance[] => {
    const elements = instancePropValue(windowObject, "pelemlist");
    if (!(elements instanceof LingoPropList)) return [];
    return elements.values.filter((entry): entry is ScriptInstance => entry instanceof ScriptInstance);
  };
  const sourceWindowContainsPoint = (x: number, y: number): boolean => {
    const windowManager = sourceWindowManager();
    if (!windowManager) return false;
    const ids = sourceWindowIds(windowManager);
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const windowObject = sourceWindowById(windowManager, ids[index]!);
      if (!windowObject || !sourceWindowVisible(windowObject)) continue;
      const windowRect = sourceWindowRect(windowObject);
      if (windowRect && rectContains(windowRect, x, y)) return true;
      for (const element of sourceWindowElements(windowObject)) {
        if (!elementVisible(element)) continue;
        const rect = elementRect(element);
        if (rect && rectContains(rect, x, y)) return true;
      }
    }
    return false;
  };
  const elementType = (element: ScriptInstance): string => {
    const type = instancePropValue(element, "ptype");
    if (type instanceof LingoSymbol) return type.name.toLowerCase();
    return typeof type === "string" ? type.toLowerCase() : "";
  };
  const elementScrollIds = (element: ScriptInstance): LingoValue[] => {
    const scrolls = instancePropValue(element, "pscrolls");
    return scrolls instanceof LingoList ? [...scrolls.items] : [];
  };
  const resolveScrollbar = (windowObject: ScriptInstance, id: LingoValue): ScriptInstance | null => {
    try {
      const element = movie.runtime.callMethod(windowObject, "getelement", [id]);
      return element instanceof ScriptInstance && movie.runtime.hasHandler(element, "setscrolloffset") ? element : null;
    } catch {
      return null;
    }
  };
  const scrollbarAxis = (scrollbar: ScriptInstance): "x" | "y" | null => {
    const type = elementType(scrollbar);
    if (type === "scrollbarv") return "y";
    if (type === "scrollbarh") return "x";
    return null;
  };
  const scrollbarsForElement = (windowObject: ScriptInstance, element: ScriptInstance): ScriptInstance[] => {
    if (movie.runtime.hasHandler(element, "setscrolloffset")) return [element];
    const result: ScriptInstance[] = [];
    for (const id of elementScrollIds(element)) {
      const scrollbar = resolveScrollbar(windowObject, id);
      if (scrollbar) result.push(scrollbar);
    }
    return result;
  };
  const wheelUnits = (delta: number): number => Math.max(1, Math.min(12, Math.round(Math.abs(delta) / 120) || 1));
  const applyWheelToScrollbar = (
    scrollbar: ScriptInstance,
    deltaY: number,
    deltaX: number,
    shiftDown: boolean,
  ): { axis: "x" | "y"; from: number; to: number } | null => {
    const axis = scrollbarAxis(scrollbar);
    if (!axis) return null;
    const delta = axis === "y" ? deltaY : shiftDown && deltaX === 0 ? deltaY : deltaX;
    if (delta === 0) return null;
    let current = 0;
    let step = 16;
    try {
      current = valueToNumber(movie.runtime.callMethod(scrollbar, "getproperty", [LingoSymbol.for("offset")]), 0);
      step = Math.max(1, Math.abs(valueToNumber(movie.runtime.callMethod(scrollbar, "getproperty", [LingoSymbol.for("scrollStep")]), 16)));
    } catch {
      current = valueToNumber(instancePropValue(scrollbar, "pscrolloffset"), 0);
      step = Math.max(1, Math.abs(valueToNumber(instancePropValue(scrollbar, "pscrollstep"), 16)));
    }
    const next = current + Math.sign(delta) * step * wheelUnits(delta);
    movie.runtime.callMethod(scrollbar, "setscrolloffset", [next]);
    return { axis, from: current, to: valueToNumber(instancePropValue(scrollbar, "pscrolloffset"), next) };
  };
  const sourceWheelAt = (
    x: number,
    y: number,
    deltaY: number,
    deltaX = 0,
    shiftDown = false,
  ): {
    consumed: boolean;
    windowId: string | null;
    element: string | null;
    scrollbars: Array<{ type: string; axis: "x" | "y"; from: number; to: number }>;
    errors: string[];
  } => {
    const errors: string[] = [];
    const windowManager = sourceWindowManager();
    if (!windowManager) return { consumed: false, windowId: null, element: null, scrollbars: [], errors };
    const ids = sourceWindowIds(windowManager);
    for (let idIndex = ids.length - 1; idIndex >= 0; idIndex -= 1) {
      const id = ids[idIndex]!;
      const windowObject = sourceWindowById(windowManager, id);
      if (!windowObject) continue;
      const visible = instancePropValue(windowObject, "pvisible");
      if (!(visible === undefined || visible instanceof LingoVoid || lingoTruthy(visible))) continue;
      const candidates = sourceWindowElements(windowObject)
        .filter((element) => elementVisible(element))
        .map((element) => {
          const rect = elementRect(element);
          const sprite = instancePropValue(element, "psprite");
          return {
            element,
            rect,
            z: sprite instanceof SpriteChannel ? sprite.locZ : 0,
            scrollbars: scrollbarsForElement(windowObject, element),
          };
        })
        .filter((candidate) => candidate.rect && rectContains(candidate.rect, x, y) && candidate.scrollbars.length > 0)
        .sort((left, right) => right.z - left.z);
      for (const candidate of candidates) {
        const applied: Array<{ type: string; axis: "x" | "y"; from: number; to: number }> = [];
        for (const scrollbar of candidate.scrollbars) {
          try {
            const result = applyWheelToScrollbar(scrollbar, deltaY, deltaX, shiftDown);
            if (result) {
              applied.push({ type: elementType(scrollbar), ...result });
            }
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
        if (applied.length > 0) {
          const focusedSprite = Number(movie.keyboardFocusSprite) | 0;
          movie.prepareTextSpriteImages(focusedSprite);
          renderer.markDirty();
          if (!shouldHoldRoomAssetPresentation(getRoomAssetBuffer())) {
            renderer.sync(movie.channels, focusedSprite);
          }
          return {
            consumed: true,
            windowId: valueToId(id),
            element: String(debugValue(instancePropValue(candidate.element, "pid")) ?? candidate.element.module.scriptName),
            scrollbars: applied,
            errors,
          };
        }
      }
    }
    return { consumed: false, windowId: null, element: null, scrollbars: [], errors };
  };
  let roomPresentationDrag: { pointerId: number; lastX: number; lastY: number } | null = null;
  let customHotelViewDrag: { pointerId: number; lastX: number; lastY: number } | null = null;
  let customHotelViewManualOffsetX = 0;
  let customHotelViewManualOffsetY = 0;
  let customHotelViewWasActive = false;
  let customHotelViewActivatedAt = performance.now();
  let syncCustomHotelViewPresentation = (): CustomHotelViewPresentation | null => null;
  let canDragCustomHotelViewAt = (_x: number, _y: number): boolean => false;
  let roomStageZoom: 1 | 2 = 1;
  let currentRoomStagePresentation = (): RoomStagePresentation | null => null;
  let roomStageSourcePoint = (point: { x: number; y: number }): { x: number; y: number } => point;
  let roomStageDragDeltaScale = (): number => 1;
  let setRoomStageZoom = (_scale: number): Record<string, unknown> => ({ ok: false, scale: roomStageZoom, reason: "room zoom not initialized" });
  let roomStageZoomDiagnostics = (): Record<string, unknown> => ({ ok: false, scale: roomStageZoom, active: false, channelCount: 0 });
  let renderDirty = true;
  let customHotelViewDiagnostics = (): Record<string, unknown> => ({
    enabled: customHotelViewEnabled,
    active: false,
    manualOffset: [customHotelViewManualOffsetX, customHotelViewManualOffsetY],
    presentation: null,
    suppressedChannels: [],
    assetRoutes: CUSTOM_HOTEL_VIEW_ASSETS,
  });
  app.canvas.addEventListener("pointermove", (event) => {
    const point = stagePoint(event);
    const sourcePoint = roomStageSourcePoint(point);
    if (customHotelViewDrag && event.pointerId === customHotelViewDrag.pointerId) {
      customHotelViewManualOffsetX += point.x - customHotelViewDrag.lastX;
      customHotelViewManualOffsetY += point.y - customHotelViewDrag.lastY;
      customHotelViewDrag = { pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      syncCustomHotelViewPresentation();
      renderer.markDirty();
      if (!shouldHoldRoomAssetPresentation(getRoomAssetBuffer())) {
        renderer.sync(movie.channels, Number(movie.keyboardFocusSprite) | 0);
        renderDirty = false;
      }
      event.preventDefault();
      return;
    }
    if (roomPresentationDrag && resizeEngine && event.pointerId === roomPresentationDrag.pointerId) {
      const dragScale = roomStageDragDeltaScale();
      resizeSnapshot = resizeEngine.dragRoomBy(
        (point.x - roomPresentationDrag.lastX) / dragScale,
        (point.y - roomPresentationDrag.lastY) / dragScale,
      );
      roomPresentationDrag = { pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      syncPresentationUnderlays(resizeSnapshot);
      if (resizeSnapshot.changed) {
        const focusedSprite = Number(movie.keyboardFocusSprite) | 0;
        movie.prepareTextSpriteImages(focusedSprite);
        renderer.markDirty();
        if (!shouldHoldRoomAssetPresentation(getRoomAssetBuffer())) {
          renderer.sync(movie.channels, focusedSprite);
          renderDirty = false;
        }
      }
      event.preventDefault();
      return;
    }
    movie.pointerMove(sourcePoint.x, sourcePoint.y);
    renderDirty = true;
    renderer.markDirty();
  });
  app.canvas.addEventListener("pointerdown", (event) => {
    const point = stagePoint(event);
    const sourcePoint = roomStageSourcePoint(point);
    const target = movie.inputSpriteAt(sourcePoint.x, sourcePoint.y, ["mousedown", "mouseup", "mouseupoutside"]);
    if (event.button === 0 && !target && canDragCustomHotelViewAt(point.x, point.y)) {
      customHotelViewDrag = { pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      app.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (resizeEngine && event.button === 1 && resizeEngine.canDragRoomAt(sourcePoint.x, sourcePoint.y)) {
      roomPresentationDrag = { pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      app.canvas.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    // Keep Director's `the shiftDown` accurate for Shift+click handlers (e.g. the
    // navigator "Who's in here?" on a public room). Shift is a modifier, not a
    // mapped key, so keyDown never sets it; refresh it from the mouse event here.
    movie.shiftDown = event.shiftKey ? 1 : 0;
    movie.pointerMove(sourcePoint.x, sourcePoint.y);
    movie.pointerDown();
    renderDirty = true;
    renderer.markDirty();
  });
  app.canvas.addEventListener("pointerup", (event) => {
    const point = stagePoint(event);
    const sourcePoint = roomStageSourcePoint(point);
    if (customHotelViewDrag && event.pointerId === customHotelViewDrag.pointerId) {
      customHotelViewDrag = null;
      app.canvas.releasePointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (roomPresentationDrag && event.pointerId === roomPresentationDrag.pointerId) {
      roomPresentationDrag = null;
      app.canvas.releasePointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    movie.shiftDown = event.shiftKey ? 1 : 0;
    movie.pointerMove(sourcePoint.x, sourcePoint.y);
    movie.pointerUp();
    renderDirty = true;
    renderer.markDirty();
  });
  app.canvas.addEventListener("pointercancel", (event) => {
    if (customHotelViewDrag?.pointerId === event.pointerId) {
      customHotelViewDrag = null;
      app.canvas.releasePointerCapture?.(event.pointerId);
    }
    if (roomPresentationDrag?.pointerId === event.pointerId) {
      roomPresentationDrag = null;
      app.canvas.releasePointerCapture?.(event.pointerId);
    }
  });
  app.canvas.addEventListener("auxclick", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  app.canvas.addEventListener(
    "wheel",
    (event) => {
      const point = stagePoint(event);
      const sourcePoint = roomStageSourcePoint(point);
      movie.pointerMove(sourcePoint.x, sourcePoint.y);
      renderDirty = true;
      renderer.markDirty();
      const result = sourceWheelAt(sourcePoint.x, sourcePoint.y, event.deltaY, event.deltaX, event.shiftKey);
      if (result.consumed) {
        event.preventDefault();
      }
    },
    { passive: false },
  );

  const preventBrowserKeyDefault = (event: KeyboardEvent): void => {
    if (
      event.key === "Backspace" ||
      event.key === "Tab" ||
      event.key === "Enter" ||
      event.key === "Escape" ||
      event.key.startsWith("Arrow")
    ) {
      event.preventDefault();
    }
  };
  const objectManagerObjectById = (id: string): LingoValue => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    return objectList ? propListLookup(objectList, id) : LINGO_VOID;
  };
  const escapeCancelsObjectMover = (): boolean => {
    const roomInterface = objectManagerObjectById("#room_interface");
    if (!(roomInterface instanceof ScriptInstance)) return false;
    const action = valueToId(instancePropValue(roomInterface, "pclickaction") ?? LINGO_VOID);
    if (
      action !== "moveActive" &&
      action !== "moveItem" &&
      action !== "placeActive" &&
      action !== "placeItem" &&
      action !== "placeCatalogueSandboxActive" &&
      action !== "placeCatalogueSandboxItem"
    ) {
      return false;
    }
    try {
      movie.runtime.callMethod(roomInterface, "cancelobjectmover", []);
      return true;
    } catch (error) {
      appendLog("error", `Escape cancelObjectMover failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  window.addEventListener("keydown", (event) => {
    const mapped = directorKeyForBrowserEvent(event);
    if (!mapped) return;
    preventBrowserKeyDefault(event);
    movie.keyDown(mapped.key, mapped.code, event.shiftKey);
    if (mapped.code === 53 && escapeCancelsObjectMover()) {
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => {
    const mapped = directorKeyForBrowserEvent(event);
    if (!mapped) return;
    movie.keyUp(mapped.key, mapped.code, event.shiftKey);
  });

  for (const entry of executableScripts.scripts) {
    movie.runtime.register(entry.module, entry.castFile, { memberNumber: entry.memberNumber });
  }
  appendLog("info", `registered ${executableScripts.scripts.length} executable generated scripts from ${executableScripts.version}`);

  // ?traceCopy=1 logs every image copy (diagnose composite pipelines).
  if (params.get("traceCopy") === "1") {
    LingoImage.copyTrace = (info) => {
      console.log(
        `[copy] dest ${info.destW}x${info.destH} <- src ${info.srcW}x${info.srcH} dr(${info.destRect}) sr(${info.sourceRect}) ink=${info.ink ?? "-"}${info.journaled ? " journaled" : ""}`,
      );
    };
  }

  // ?trace=handler1,handler2 wires the runtime tracer into the page log.
  const traceParam = params.get("trace");
  if (traceParam) {
    for (const name of traceParam.split(",")) {
      movie.runtime.traceHandlers.add(name.trim().toLowerCase());
    }
    movie.runtime.traceSink = (text) => appendLog("info", text);
  }

  // Window composites bake text once; the Volter (Goldfish) faces must be
  // resident before generated code renders its first label.
  try {
    const sizes = [9, 10, 11, 12, 14, 18];
    const fontLoads = sizes.flatMap((size) => [
      document.fonts.load(`${size}px "Volter Goldfish"`),
      document.fonts.load(`bold ${size}px "Volter Goldfish"`),
    ]);
    await Promise.race([
      Promise.all(fontLoads).then(() => document.fonts.ready),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("font timeout")), 3000)),
    ]);
  } catch {
    appendLog("info", "Volter Goldfish webfont unavailable; falling back to system fonts");
  }

  movie.start();
  const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
  const stageClick = (x: number, y: number): void => {
    movie.pointerMove(x, y);
    movie.pointerDown();
    movie.pointerUp();
  };
  const spriteCenter = (spriteNumber: number): { x: number; y: number } | null => {
    const rect = movie.spriteBounds(spriteNumber);
    if (!rect) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const clickSprite = (spriteNumber: number): boolean => {
    const center = spriteCenter(spriteNumber);
    if (!center) return false;
    stageClick(center.x, center.y);
    return true;
  };
  const spritePixelAt = (channel: SpriteChannel, x: number, y: number): unknown => {
    const rect = movie.spriteBounds(channel.number);
    const image = channel.member?.image ?? channel.member?.bitmap?.decoded ?? null;
    if (!rect || !image || rect.width <= 0 || rect.height <= 0) return null;
    const sourceX = Math.max(0, Math.min(image.width - 1, Math.floor(((x - rect.left) / rect.width) * image.width)));
    const sourceY = Math.max(0, Math.min(image.height - 1, Math.floor(((y - rect.top) / rect.height) * image.height)));
    const pixel = image.getPixel(sourceX, sourceY);
    const hex = `#${[pixel.r, pixel.g, pixel.b].map((part) => part.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    return { source: [sourceX, sourceY], rgb: [pixel.r, pixel.g, pixel.b], hex };
  };
  const hitProbe = (x: number, y: number): unknown[] =>
    movie.spritesAt(Number(x), Number(y)).map((channel) => ({
      ...(summarizeSprite(channel, 3) as Record<string, unknown>),
      rect: (() => {
        const rect = movie.spriteBounds(channel.number);
        return rect ? [rect.left, rect.top, rect.right, rect.bottom] : null;
      })(),
      pixel: spritePixelAt(channel, Number(x), Number(y)),
    }));
  const imageDataSummary = (image: LingoValue): unknown => {
    if (!(image instanceof LingoImage)) return summarizeValue(image, 3);
    const el = image.el as HTMLCanvasElement | undefined;
    return {
      type: "image",
      size: [image.width, image.height],
      incomplete: image.incomplete,
      version: image.version,
      dataUrl: el && "toDataURL" in el ? el.toDataURL() : null,
    };
  };
  const imageSummary = (image: LingoValue | undefined, includeData = false): unknown => {
    if (!(image instanceof LingoImage)) return summarizeValue(image, 2);
    const el = image.el as HTMLCanvasElement | undefined;
    const summary: Record<string, unknown> = {
      type: "image",
      size: [image.width, image.height],
      depth: image.depth,
      paletteRef: debugValue(image.paletteRef),
      matteCoveragePolicy: image.matteCoveragePolicyForDebug(),
      incomplete: image.incomplete,
      version: image.version,
    };
    if (includeData) {
      summary.dataUrl = el && "toDataURL" in el ? el.toDataURL() : null;
    }
    return summary;
  };
  const paletteSample = (colors: readonly number[] | null | undefined): unknown => {
    if (!colors || colors.length === 0) return null;
    const wanted = [0, 1, 2, 80, 81, 82, 83, 86, 128, 129, 130, 131, 132, 255];
    const entries: Record<string, string> = {};
    for (const index of wanted) {
      const rgb = colors[index];
      if (rgb === undefined) continue;
      entries[String(index)] = `#${rgb.toString(16).padStart(6, "0").toUpperCase()}`;
    }
    return { count: colors.length, entries };
  };
  const memberSummary = (value: LingoValue | undefined, includeImages = false): unknown => {
    if (!(value instanceof CastMember)) return summarizeValue(value, 2);
    const image = value.image ?? null;
    const decoded = value.bitmap?.decoded ?? null;
    return {
      name: value.name,
      type: value.type,
      number: value.number,
      slotNumber: value.slotNumber,
      castNumber: value.castNumber,
      text: value.type === "field" || value.type === "text" ? value.text : undefined,
      style: Object.fromEntries(value.style),
      textRuns: value.textStyleRuns,
      regPoint: [value.regX, value.regY],
      bitmapSize: value.bitmap ? [value.bitmap.width, value.bitmap.height] : null,
      image: image ? imageSummary(image, includeImages) : null,
      decoded: decoded ? imageSummary(decoded, includeImages) : null,
      presentationImage: value.presentationImage ? imageSummary(value.presentationImage, includeImages) : null,
      paletteColors: paletteSample(value.paletteColors),
      bitmapPaletteColors: paletteSample(value.bitmap?.paletteColors),
      bitmapInk8AlphaPolicy: value.bitmap?.ink8AlphaPolicy ?? null,
    };
  };
  const summarizeWindowElement = (
    element: ScriptInstance,
    includeImages = false,
    depth = 1,
  ): Record<string, unknown> => {
    const sprite = instancePropValue(element, "psprite");
    const buffer = instancePropValue(element, "pbuffer");
    const member = instancePropValue(element, "pmember");
    const textMember = instancePropValue(element, "ptextmem");
    const image = instancePropValue(element, "pimage");
    const children = instancePropValue(element, "pelemlist");
    const childItems =
      children instanceof LingoList
        ? children.items.filter((entry): entry is ScriptInstance => entry instanceof ScriptInstance)
        : [];
    const rect = elementRect(element);
    const presentedImage =
      buffer instanceof CastMember && buffer.image
        ? buffer.image
        : member instanceof CastMember && member.image
          ? member.image
          : image instanceof LingoImage
            ? image
            : null;
    return {
      id: debugValue(instancePropValue(element, "pid")),
      class: element.module.scriptName,
      type: elementType(element),
      visible: debugValue(instancePropValue(element, "pvisible")),
      loc: [debugValue(instancePropValue(element, "plocx")), debugValue(instancePropValue(element, "plocy"))],
      own: [
        debugValue(instancePropValue(element, "pownx")),
        debugValue(instancePropValue(element, "powny")),
        debugValue(instancePropValue(element, "pownw")),
        debugValue(instancePropValue(element, "pownh")),
      ],
      size: [debugValue(instancePropValue(element, "pwidth")), debugValue(instancePropValue(element, "pheight"))],
      scale: [debugValue(instancePropValue(element, "pscaleh")), debugValue(instancePropValue(element, "pscalev"))],
      rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null,
      sprite: summarizeSprite(sprite, 2),
      buffer: memberSummary(buffer, includeImages),
      member: memberSummary(member, includeImages),
      image: imageSummary(image, includeImages),
      presentedImage: imageSummary(presentedImage ?? undefined, includeImages),
      textMember: memberSummary(textMember, includeImages),
      fontData: summarizeValue(instancePropValue(element, "pfontdata"), 2),
      params: summarizeValue(instancePropValue(element, "pparams"), 1),
      props: summarizeValue(instancePropValue(element, "pprops"), 1),
      scrolls: summarizeValue(instancePropValue(element, "pscrolls"), 1),
      childCount: childItems.length,
      children: depth > 0 ? childItems.map((child) => summarizeWindowElement(child, includeImages, depth - 1)) : [],
    };
  };
  const summarizeSourceWindow = (id: string, includeImages = false): unknown => {
    const windowManager = sourceWindowManager();
    if (!windowManager) return { error: "window manager unavailable" };
    const windowId = coerceDebugValue(id);
    const windowObject = sourceWindowById(windowManager, windowId);
    if (!windowObject) return { error: `window not found: ${id}` };
    return {
      id,
      class: windowObject.module.scriptName,
      visible: debugValue(instancePropValue(windowObject, "pvisible")),
      loc: [debugValue(instancePropValue(windowObject, "plocx")), debugValue(instancePropValue(windowObject, "plocy"))],
      size: [debugValue(instancePropValue(windowObject, "pwidth")), debugValue(instancePropValue(windowObject, "pheight"))],
      locZ: debugValue(instancePropValue(windowObject, "plocz")),
      clientRect: debugValue(instancePropValue(windowObject, "pclientrect")),
      spriteList: summarizeValue(instancePropValue(windowObject, "pspritelist"), 2),
      memberList: summarizeValue(instancePropValue(windowObject, "pmemberlist"), 1),
      elements: sourceWindowElements(windowObject).map((element) => summarizeWindowElement(element, includeImages, 1)),
    };
  };
  const sourceWindowElementTree = (element: ScriptInstance): ScriptInstance[] => {
    const children = instancePropValue(element, "pelemlist");
    const childItems =
      children instanceof LingoList
        ? children.items.filter((entry): entry is ScriptInstance => entry instanceof ScriptInstance)
        : [];
    return [element, ...childItems.flatMap((child) => sourceWindowElementTree(child))];
  };
  const sourceWindowElementsForSprite = (sprite: SpriteChannel, includeImages = false): unknown[] => {
    const windowManager = sourceWindowManager();
    if (!windowManager) return [];
    const result: unknown[] = [];
    for (const id of sourceWindowIds(windowManager)) {
      const windowObject = sourceWindowById(windowManager, id);
      if (!windowObject) continue;
      for (const element of sourceWindowElements(windowObject).flatMap((entry) => sourceWindowElementTree(entry))) {
        if (instancePropValue(element, "psprite") !== sprite) continue;
        result.push({
          windowId: valueToId(id),
          windowClass: windowObject.module.scriptName,
          element: summarizeWindowElement(element, includeImages, 0),
        });
      }
    }
    return result;
  };
  const imageDimensions = (image: LingoImage | null | undefined): unknown =>
    image
      ? {
          size: [image.width, image.height],
          depth: image.depth,
          incomplete: image.incomplete,
          version: image.version,
          paletteRef: debugValue(image.paletteRef),
        }
      : null;
  const resolvedRenderPath = (sprite: SpriteChannel): Record<string, unknown> => {
    const member = sprite.member;
    if (!member) return { path: "empty" };
    if (member.image) {
      return {
        path: "member.image-buffer",
        image: imageDimensions(member.image),
        reason: "Runtime composited image buffer; this is the path used by source windows and many wrapper elements.",
      };
    }
    if (member.type === "field" || member.type === "text") {
      return {
        path: "text.presentationImage",
        image: imageDimensions(member.presentationImage),
        reason: "Director text/field member raster prepared by Movie.prepareTextSpriteImages.",
      };
    }
    if (member.bitmap?.pngUrl) {
      const selectedUrl = bitmapUrlForInk(member.bitmap, sprite.ink);
      return {
        path: selectedUrl === member.bitmap.pngUrl ? "bitmap.png" : "bitmap.ink-png",
        url: selectedUrl,
        bitmap: {
          size: [member.bitmap.width, member.bitmap.height],
          regPoint: [member.bitmap.regX, member.bitmap.regY],
          rawUrl: member.bitmap.pngUrl,
          decoded: imageDimensions(member.bitmap.decoded ?? null),
          inkVariants: Object.keys(member.bitmap.inkUrls ?? {}),
          selectedInk: sprite.ink,
          hasPaletteIndices: !!member.bitmap.paletteIndexData,
        },
        reason: "Decoded/generated bitmap asset selected by member bitmap metadata.",
      };
    }
    if (member.bitmap?.decoded) {
      return {
        path: "bitmap.decoded-buffer",
        image: imageDimensions(member.bitmap.decoded),
        reason: "Decoded bitmap buffer without a source png URL.",
      };
    }
    if (member.type === "shape") {
      return {
        path: "shape",
        reason: "Director shape sprite drawn by renderer from channel dimensions and color.",
      };
    }
    return { path: "unsupported", memberType: member.type };
  };
  const resolvedSpriteSummary = (sprite: SpriteChannel, includeImages = false): Record<string, unknown> => {
    const rect = movie.spriteBounds(sprite.number);
    const member = sprite.member;
    return {
      ...(summarizeSprite(sprite, 4) as Record<string, unknown>),
      rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null,
      visible: sprite.visible,
      puppet: sprite.puppet,
      stretch: sprite.stretch,
      trails: sprite.trails,
      foreColor: sprite.foreColor,
      backColor: sprite.backColor,
      color: debugValue(sprite.color),
      bgColor: debugValue(sprite.bgColor),
      cursor: summarizeValue(sprite.cursor as LingoValue, 1),
      render: resolvedRenderPath(sprite),
      member: member ? memberSummary(member, includeImages) : null,
      sourceWindowOwners: sourceWindowElementsForSprite(sprite, includeImages),
    };
  };
  const clickWindowElement = (windowId: string, elementId: string): unknown => {
    const windowManager = sourceWindowManager();
    if (!windowManager) return { clicked: false, error: "window manager unavailable" };
    const windowObject = sourceWindowById(windowManager, coerceDebugValue(windowId));
    if (!windowObject) return { clicked: false, error: `window not found: ${windowId}` };
    let element: LingoValue;
    try {
      element = movie.runtime.callMethod(windowObject, "getelement", [coerceDebugValue(elementId)]);
    } catch (error) {
      return { clicked: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!(element instanceof ScriptInstance)) {
      return { clicked: false, error: `element not found: ${elementId}`, value: summarizeValue(element, 2) };
    }
    const sprite = instancePropValue(element, "psprite");
    if (!(sprite instanceof SpriteChannel)) {
      return { clicked: false, error: `element has no sprite: ${elementId}`, value: summarizeObject(element, 1) };
    }
    return {
      clicked: clickSprite(sprite.number),
      windowId,
      elementId,
      sprite: sprite.number,
      rect: (() => {
        const rect = movie.spriteBounds(sprite.number);
        return rect ? [rect.left, rect.top, rect.right, rect.bottom] : null;
      })(),
    };
  };
  const pressKey = async (key: string, shiftDown = false): Promise<boolean> => {
    const mapped = directorKeyForTextKey(key);
    if (!mapped) return false;
    movie.keyDown(mapped.key, mapped.code, shiftDown);
    movie.keyUp(mapped.key, mapped.code, shiftDown);
    await delay(0);
    return true;
  };
  const typeText = async (text: string, delayMs = 0): Promise<void> => {
    for (const char of text) {
      await pressKey(char, char !== char.toLowerCase());
      if (delayMs > 0) await delay(delayMs);
    }
  };
  const editableFields = (): Array<{
    n: number;
    member: string;
    rect: [number, number, number, number];
    text: string;
  }> =>
    movie.channels
      .filter((channel) => channel.puppet === 1 && channel.visible === 1 && channel.member && movie.channelEditable(channel))
      .map((channel) => {
        const rect = movie.spriteBounds(channel.number);
        return rect
          ? {
              n: channel.number,
              member: channel.member!.name,
              rect: [rect.left, rect.top, rect.right, rect.bottom] as [number, number, number, number],
              text: channel.member!.text,
            }
          : null;
      })
      .filter((entry): entry is { n: number; member: string; rect: [number, number, number, number]; text: string } => !!entry)
      .sort((left, right) => left.rect[1] - right.rect[1] || left.rect[0] - right.rect[0]);
  const clearFocusedField = async (): Promise<void> => {
    const focus = Number(movie.keyboardFocusSprite) | 0;
    const member = focus > 0 ? movie.channels[focus]?.member : null;
    const count = member?.text.length ?? 0;
    for (let index = 0; index < count; index += 1) {
      await pressKey("Backspace");
    }
  };
  const sourceTimeoutIds = (): string[] => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    const timeoutManager = objectList ? propListLookup(objectList, "#timeout_manager") : LINGO_VOID;
    if (!(timeoutManager instanceof ScriptInstance)) return [];
    const itemList = instancePropValue(timeoutManager, "pitemlist");
    if (!(itemList instanceof LingoPropList)) return [];
    return itemList.keys.map((key) => String(debugValue(key)));
  };
  const drainSourceTimeouts = async (
    shouldDrain: (id: string) => boolean,
    maxTicks = 8,
  ): Promise<{ before: string[]; after: string[]; ticks: number }> => {
    const before = sourceTimeoutIds().filter(shouldDrain);
    let after = before;
    let ticks = 0;
    while (after.length > 0 && ticks < maxTicks) {
      await delay(0);
      movie.tick();
      ticks += 1;
      after = sourceTimeoutIds().filter(shouldDrain);
    }
    return { before, after, ticks };
  };
  const loginWithSourceEvents = async (email: string, password: string, delayMs = 0): Promise<{
    fields: [number, number];
    focus: number;
    passwordTimeoutDrain?: { before: string[]; after: string[]; ticks: number };
    submit: "source-handler" | "button" | "enter";
  }> => {
    const fields = editableFields();
    if (fields.length < 2) {
      throw new Error(`login fields not ready: found ${fields.length}`);
    }
    const emailField = fields[0]!;
    const passwordField = fields[1]!;
    clickSprite(emailField.n);
    await clearFocusedField();
    await typeText(email, delayMs);
    clickSprite(passwordField.n);
    await clearFocusedField();
    await typeText(password, delayMs);
    const passwordTimeoutDrain = await drainSourceTimeouts((id) => id.toLowerCase().startsWith("pwdhide"));
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    const loginInterface = objectList ? propListLookup(objectList, "#login_interface") : LINGO_VOID;
    if (loginInterface instanceof ScriptInstance && movie.runtime.hasHandler(loginInterface, "eventproclogin")) {
      const windowManager = sourceWindowManager();
      const loginWindow = windowManager ? sourceWindowById(windowManager, LingoSymbol.for("login_b")) : null;
      if (loginWindow) {
        const usernameElement = movie.runtime.callMethod(loginWindow, "getelement", ["login_username"]);
        if (usernameElement instanceof ScriptInstance && movie.runtime.hasHandler(usernameElement, "settext")) {
          movie.runtime.callMethod(usernameElement, "settext", [email]);
        }
        const passwordElement = movie.runtime.callMethod(loginWindow, "getelement", ["login_password"]);
        if (passwordElement instanceof ScriptInstance && movie.runtime.hasHandler(passwordElement, "settext")) {
          movie.runtime.callMethod(passwordElement, "settext", ["*".repeat(password.length)]);
        }
      }
      movie.runtime.setInstanceProp(loginInterface, "ptemppassword", password);
      movie.runtime.callMethod(loginInterface, "eventproclogin", [LingoSymbol.for("mouseUp"), "login_ok", LINGO_VOID]);
      return {
        fields: [emailField.n, passwordField.n],
        focus: Number(movie.keyboardFocusSprite) | 0,
        passwordTimeoutDrain,
        submit: "source-handler",
      };
    }
    const submitSprite = movie.channels.find(
      (channel) =>
        channel.puppet === 1 &&
        channel.visible === 1 &&
        !!channel.member &&
        /login.*(?:totp_)?ok/i.test(channel.member.name),
    );
    if (submitSprite && clickSprite(submitSprite.number)) {
      return { fields: [emailField.n, passwordField.n], focus: Number(movie.keyboardFocusSprite) | 0, passwordTimeoutDrain, submit: "button" };
    }
    await pressKey("Enter");
    return { fields: [emailField.n, passwordField.n], focus: Number(movie.keyboardFocusSprite) | 0, passwordTimeoutDrain, submit: "enter" };
  };
  const entryComponentFromObjects = (): ScriptInstance | null => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    if (!objectList) return null;
    for (const id of ["#entry_component", "#entry"]) {
      const object = propListLookup(objectList, id);
      if (object instanceof ScriptInstance && movie.runtime.hasHandler(object, "enterentry")) {
        return object;
      }
      if (object instanceof ScriptInstance && movie.runtime.hasHandler(object, "getcomponent")) {
        try {
          const component = movie.runtime.callMethod(object, "getcomponent", []);
          if (component instanceof ScriptInstance && movie.runtime.hasHandler(component, "enterentry")) {
            return component;
          }
        } catch {
          // Diagnostic fallback only; keep the source message route primary.
        }
      }
    }
    return null;
  };
  const navigatorComponentFromObjects = (): ScriptInstance | null => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    if (!objectList) return null;
    const object = propListLookup(objectList, "#navigator_component");
    if (object instanceof ScriptInstance && movie.runtime.hasHandler(object, "updatestate")) {
      return object;
    }
    return null;
  };
  const navigatorInterfaceFromObjects = (): ScriptInstance | null => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    if (!objectList) return null;
    const direct = propListLookup(objectList, "#navigator_interface");
    if (direct instanceof ScriptInstance && movie.runtime.hasHandler(direct, "shownavigator")) {
      return direct;
    }
    const component = navigatorComponentFromObjects();
    if (component instanceof ScriptInstance && movie.runtime.hasHandler(component, "getinterface")) {
      try {
        const iface = movie.runtime.callMethod(component, "getinterface", []);
        if (iface instanceof ScriptInstance && movie.runtime.hasHandler(iface, "shownavigator")) {
          return iface;
        }
      } catch {
        // Diagnostic helper only; callers report unavailable navigator below.
      }
    }
    return null;
  };
  const showNavigatorWithSource = (view?: string): Record<string, unknown> => {
    const iface = navigatorInterfaceFromObjects();
    const result: Record<string, unknown> = {
      ok: false,
      route: "Navigator Interface",
      requestedView: view ?? null,
      showResult: null,
      viewResult: null,
      errors: [] as string[],
    };
    if (!(iface instanceof ScriptInstance)) {
      (result.errors as string[]).push("navigator interface not available");
      return result;
    }
    try {
      result.showResult = summarizeValue(movie.runtime.callMethod(iface, "shownavigator", []), 2);
    } catch (error) {
      (result.errors as string[]).push(error instanceof Error ? error.message : String(error));
    }
    if (view && view.length > 0) {
      try {
        result.viewResult = summarizeValue(movie.runtime.callMethod(iface, "changewindowview", [view]), 2);
      } catch (error) {
        (result.errors as string[]).push(error instanceof Error ? error.message : String(error));
      }
    }
    result.ok = (result.errors as string[]).length === 0;
    result.window = summarizeSourceWindow("Hotel Navigator", false);
    return result;
  };
  const hideNavigatorWithSource = (mode: string | undefined = "hide"): Record<string, unknown> => {
    const iface = navigatorInterfaceFromObjects();
    const result: Record<string, unknown> = {
      ok: false,
      route: "Navigator Interface.hideNavigator",
      mode,
      hideResult: null,
      errors: [] as string[],
    };
    if (!(iface instanceof ScriptInstance)) {
      (result.errors as string[]).push("navigator interface not available");
      return result;
    }
    const symbol = String(mode ?? "hide").toLowerCase() === "remove" ? LingoSymbol.for("remove") : LingoSymbol.for("hide");
    try {
      result.hideResult = summarizeValue(movie.runtime.callMethod(iface, "hidenavigator", [symbol]), 2);
    } catch (error) {
      (result.errors as string[]).push(error instanceof Error ? error.message : String(error));
    }
    result.ok = (result.errors as string[]).length === 0;
    return result;
  };
  const executeSourceMessage = (message: string, args: unknown[] = []): Record<string, unknown> => {
    const result: Record<string, unknown> = {
      ok: false,
      route: "executeMessage",
      message,
      result: null,
      errors: [] as string[],
    };
    try {
      const messageValue = String(message).startsWith("#") ? coerceDebugValue(message) : LingoSymbol.for(String(message));
      const callArgs = [messageValue, ...args.map((value) => coerceDebugValue(value))];
      result.result = summarizeValue(movie.runtime.call("executemessage", callArgs), 3);
    } catch (error) {
      (result.errors as string[]).push(error instanceof Error ? error.message : String(error));
    }
    result.ok = (result.errors as string[]).length === 0;
    return result;
  };
  const entryStateSummary = (): {
    state: unknown;
    entryBarObject: boolean;
    entryVisualizerObject: boolean;
  } => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    if (!objectList) return { state: null, entryBarObject: false, entryVisualizerObject: false };
    const component = entryComponentFromObjects();
    const state = component instanceof ScriptInstance ? summarizeValue(instancePropValue(component, "pstate") ?? LINGO_VOID, 1) : null;
    return {
      state,
      entryBarObject: !(propListLookup(objectList, "entry_bar") instanceof LingoVoid),
      entryVisualizerObject: !(propListLookup(objectList, "entry_view") instanceof LingoVoid),
    };
  };
  const entryStateActive = (state: { state: unknown; entryBarObject: boolean; entryVisualizerObject: boolean }): boolean =>
    state.entryBarObject || state.entryVisualizerObject || state.state === "#hotelView" || state.state === "#entryBar";
  const objectById = (id: string): LingoValue => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    return objectList ? propListLookup(objectList, id) : LINGO_VOID;
  };
  const objectExists = (id: string): boolean => {
    return !(objectById(id) instanceof LingoVoid);
  };
  const propListEntries = (value: LingoValue): Array<{ key: unknown; value: unknown }> => {
    if (!(value instanceof LingoPropList)) return [];
    return value.keys.map((key, index) => ({
      key: debugValue(key),
      value: summarizeValue(value.values[index], 2),
    }));
  };
  const sourceObjectIdFor = (object: LingoValue): string | null => {
    if (!(object instanceof ScriptInstance)) return null;
    const id = instancePropValue(object, "pid");
    return id === undefined || id instanceof LingoVoid ? null : valueToId(id);
  };
  const brokerMessageSummary = (message = "toggle_ig"): Record<string, unknown> => {
    const broker = objectById("#broker_manager");
    if (!(broker instanceof ScriptInstance)) return { exists: false, message, subscribers: [] };
    const itemList = instancePropValue(broker, "pitemlist");
    const messageKey = String(message).startsWith("#") ? LingoSymbol.for(String(message).slice(1)) : LingoSymbol.for(String(message));
    const subscribers = itemList instanceof LingoPropList ? propListLookup(itemList, valueToId(messageKey)) : LINGO_VOID;
    return {
      exists: true,
      message: valueToId(messageKey),
      subscriberCount: subscribers instanceof LingoPropList ? subscribers.count() : 0,
      subscribers: propListEntries(subscribers),
    };
  };
  const threadManagerSummary = (): Record<string, unknown> => {
    const threadManager = objectById("#thread_manager");
    if (!(threadManager instanceof ScriptInstance)) return { exists: false, threads: [] };
    const threads = instancePropValue(threadManager, "pthreadlist");
    const entries =
      threads instanceof LingoPropList
        ? threads.keys.map((key, index) => {
            const thread = threads.values[index];
            const threadInstance = thread instanceof ScriptInstance ? thread : null;
            const moduleSummary = (name: string): unknown => {
              if (!threadInstance) return null;
              const module = instancePropValue(threadInstance, name);
              return module instanceof ScriptInstance
                ? {
                    id: sourceObjectIdFor(module),
                    script: module.module.scriptName,
                    object: debugValue(module),
                  }
                : summarizeValue(module, 1);
            };
            return {
              id: debugValue(key),
              object: summarizeValue(thread, 1),
              interface: moduleSummary("interface"),
              component: moduleSummary("component"),
              handler: moduleSummary("handler"),
            };
          })
        : [];
    return {
      exists: true,
      indexField: summarizeValue(instancePropValue(threadManager, "pindexfield"), 1),
      threadCount: entries.length,
      threads: entries,
    };
  };
  const windowWrapperSummary = (id: string): Record<string, unknown> => {
    const wrapper = objectById(id);
    if (!(wrapper instanceof ScriptInstance)) return { id, exists: false };
    const get = (prop: string): unknown => {
      try {
        return summarizeValue(movie.runtime.callMethod(wrapper, "getproperty", [LingoSymbol.for(prop)]), 2);
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    };
    return {
      id,
      exists: true,
      script: wrapper.module.scriptName,
      visible: get("visible"),
      partCount: get("part_count"),
      locX: get("locX"),
      locY: get("locY"),
      width: get("width"),
      height: get("height"),
      props: summarizeValue(instancePropValue(wrapper, "pprops"), 2),
    };
  };
  const igStateSummary = (): Record<string, unknown> => {
    const component = objectById("#ig_component");
    const iface = objectById("#ig_interface");
    const components = component instanceof ScriptInstance ? instancePropValue(component, "pigcomponents") : LINGO_VOID;
    return {
      componentExists: component instanceof ScriptInstance,
      interfaceExists: iface instanceof ScriptInstance,
      systemState: component instanceof ScriptInstance ? summarizeValue(instancePropValue(component, "psystemstate"), 2) : null,
      activeMode: component instanceof ScriptInstance ? summarizeValue(instancePropValue(component, "pactivemode"), 2) : null,
      componentKeys:
        components instanceof LingoPropList
          ? components.keys.map((key, index) => ({
              key: debugValue(key),
              object: summarizeValue(components.values[index], 1),
            }))
          : [],
      mainWrapperId: iface instanceof ScriptInstance ? summarizeValue(instancePropValue(iface, "pmainwindowwrapperid"), 2) : null,
      sideWrapperId: iface instanceof ScriptInstance ? summarizeValue(instancePropValue(iface, "psidewindowwrapperid"), 2) : null,
      mainWrapper: windowWrapperSummary("ig_window_wrapper"),
      sideWrapper: windowWrapperSummary("ig_window2_wrapper"),
      sourceWindows: (() => {
        const manager = sourceWindowManager();
        return manager ? sourceWindowIds(manager).map(valueToId).filter((id) => id.toLowerCase().includes("ig")) : [];
      })(),
    };
  };
  const roomReadySummary = (): {
    ready: boolean;
    route: string;
    hasRoomVisualizer: boolean;
    hasRoomInterface: boolean;
    hasRoomComponent: boolean;
    hasRoomContainer: boolean;
    hasRoomGeometry: boolean;
    hasRoomClasses: boolean;
    roomComponentActive: boolean;
    roomId: unknown;
    roomType: unknown;
    roomLikeSpriteCount: number;
  } => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    const hasRoomVisualizer = objectExists("Room_visualizer");
    const hasRoomInterface = objectExists("#room_interface");
    const hasRoomComponent = objectExists("#room_component");
    const hasRoomContainer = objectExists("Room_container");
    const hasRoomGeometry = objectExists("Room_geometry");
    const hasRoomClasses = objectExists("Room Classes");
    const roomComponentObject = objectList ? propListLookup(objectList, "#room_component") : LINGO_VOID;
    const roomComponentActive =
      roomComponentObject instanceof ScriptInstance ? lingoTruthy(instancePropValue(roomComponentObject, "pactiveflag") ?? 0) : false;
    const roomId = roomComponentObject instanceof ScriptInstance ? debugValue(instancePropValue(roomComponentObject, "proomid")) : null;
    const savedData = roomComponentObject instanceof ScriptInstance ? instancePropValue(roomComponentObject, "psavedata") : LINGO_VOID;
    const roomType = savedData instanceof LingoPropList ? debugValue(propListValue(savedData, "type")) : null;
    const roomLikeSpriteCount = movie.channels.filter((channel) => {
      if (channel.puppet !== 1 || !channel.member || channel.visible === 0) return false;
      const member = channel.member.name.toLowerCase();
      const id = String(debugValue(channel.id)).toLowerCase();
      return (
        id.includes("room") ||
        id.includes("obj") ||
        id.includes("user") ||
        member.includes("floor") ||
        member.includes("wall") ||
        member.includes("tile") ||
        member.includes("chair") ||
        member.includes("sofa")
      );
    }).length;
    const classicReady = hasRoomVisualizer || roomComponentActive;
    const profileReady =
      hasRoomInterface && hasRoomComponent && hasRoomClasses && (hasRoomContainer || hasRoomGeometry) && roomLikeSpriteCount > 0;
    return {
      ready: classicReady || profileReady,
      route: roomComponentActive ? "Room Component.pActiveFlag" : classicReady ? "Room_visualizer" : profileReady ? "room interface/container" : "pending",
      hasRoomVisualizer,
      hasRoomInterface,
      hasRoomComponent,
      hasRoomContainer,
      hasRoomGeometry,
      hasRoomClasses,
      roomComponentActive,
      roomId,
      roomType,
      roomLikeSpriteCount,
    };
  };
  const waitForRoomReady = async (timeoutMs = 10000): Promise<ReturnType<typeof roomReadySummary>> => {
    const deadline = performance.now() + Math.max(1, Number(timeoutMs) || 10000);
    let state = roomReadySummary();
    while (!state.ready && performance.now() < deadline) {
      await delay(100);
      state = roomReadySummary();
    }
    return state;
  };
  const roomEntryState = (): Record<string, unknown> => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    const session = objectList ? propListLookup(objectList, "#session") : LINGO_VOID;
    const navigatorComponent = navigatorComponentFromObjects();
    const roomComponent = objectList ? propListLookup(objectList, "#room_component") : LINGO_VOID;
    const roomSavedData = roomComponent instanceof ScriptInstance ? instancePropValue(roomComponent, "psavedata") : LINGO_VOID;
    const delaySummary = (object: LingoValue): unknown => {
      if (!(object instanceof ScriptInstance)) return null;
      const delays = instancePropValue(object, "delays");
      if (!(delays instanceof LingoPropList)) return { count: 0, entries: [] };
      return {
        count: delays.count(),
        entries: delays.keys.map((key, index) => ({
          key: debugValue(key),
          value: summarizeValue(delays.values[index], 2),
        })),
      };
    };
    const sessionValue = (key: string): unknown => {
      if (!(session instanceof ScriptInstance) || !movie.runtime.hasHandler(session, "get")) return null;
      try {
        return summarizeValue(movie.runtime.callMethod(session, "get", [key]), 2);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    return {
      roomReady: roomReadySummary(),
      directorTick: movie.tickDiagnostics(),
      entryState: entryStateSummary(),
      lastroom: sessionValue("lastroom"),
      navigatorState: navigatorComponent instanceof ScriptInstance
        ? summarizeValue(instancePropValue(navigatorComponent, "pstate") ?? LINGO_VOID, 1)
        : null,
      navigatorDelays: delaySummary(navigatorComponent ?? LINGO_VOID),
      roomComponent: roomComponent instanceof ScriptInstance
        ? {
            pActiveFlag: debugValue(instancePropValue(roomComponent, "pactiveflag")),
            pRoomId: debugValue(instancePropValue(roomComponent, "proomid")),
            pReportRoomId: debugValue(instancePropValue(roomComponent, "preportroomid")),
            pCastLoaded: debugValue(instancePropValue(roomComponent, "pcastloaded")),
            pCommonCastTaskActive: debugValue(instancePropValue(roomComponent, "pcommoncasttaskactive")),
            pRoomConnectionRequested: debugValue(instancePropValue(roomComponent, "proomconnectionrequested")),
            pInterstitialFinishedLogged: debugValue(instancePropValue(roomComponent, "pinterstitialfinishedlogged")),
            pSaveData: summarizeValue(roomSavedData, 2),
          }
        : null,
      variables: summarizeVariables(movie.runtime.getGlobal("gcore"), [
        "forward.id",
        "forward.type",
        "friend.id",
        "connection.info.id",
        "connection.room.id",
      ]),
      publicNodes: navigatorPublicNodes().slice(0, 20),
    };
  };
  const waitForHotelViewStable = async (
    timeoutMs = 15000,
    stableMs = 1200,
  ): Promise<{ stable: boolean; state: Record<string, unknown>; samples: number }> => {
    const timeout = Math.max(1, Number(timeoutMs) || 15000);
    const requiredStableMs = Math.max(1, Number(stableMs) || 1200);
    const deadline = performance.now() + timeout;
    let stableSince = 0;
    let samples = 0;
    let state = roomEntryState();
    while (performance.now() < deadline) {
      samples += 1;
      state = roomEntryState();
      const roomReady = state.roomReady as { ready?: boolean; roomId?: unknown } | null;
      const entryState = state.entryState as { entryBarObject?: boolean; entryVisualizerObject?: boolean; state?: unknown } | null;
      const roomIdle =
        !roomReady?.ready &&
        (roomReady?.roomId === "" || roomReady?.roomId === null || typeof roomReady?.roomId === "undefined");
      const entryActive =
        Boolean(entryState?.entryBarObject) ||
        Boolean(entryState?.entryVisualizerObject) ||
        entryState?.state === "#hotelView" ||
        entryState?.state === "#entryBar";
      if (entryActive && roomIdle) {
        if (stableSince === 0) stableSince = performance.now();
        if (performance.now() - stableSince >= requiredStableMs) {
          return { stable: true, state, samples };
        }
      } else {
        stableSince = 0;
      }
      await delay(100);
    }
    return { stable: false, state, samples };
  };
  const customHotelViewSuppressedChannels = (): Set<number> => {
    const channels = new Set<number>();
    const entryView = objectById("entry_view");
    if (entryView instanceof ScriptInstance) {
      const sprites = instancePropValue(entryView, "pspritelist");
      const addEntrySprite = (value: LingoValue): void => {
        if (value instanceof SpriteChannel) {
          // entry_view owns the hotel-view visualizer artwork. Source toolbar,
          // status text, and window-manager UI are owned by entry_bar/windows,
          // so suppressing entry_view wholesale prevents resized source hotel
          // sprites from leaking behind the custom presentation.
          channels.add(value.number);
          return;
        }
        if (value instanceof LingoList) {
          for (const item of value.items) addEntrySprite(item);
          return;
        }
        if (value instanceof LingoPropList) {
          for (const item of value.values) addEntrySprite(item);
        }
      };
      addEntrySprite(sprites ?? LINGO_VOID);
    }
    // Keep entry_bar and source window-manager sprites intact. Only the
    // source hotel-view visualizer's background/movie layers are replaced.
    return channels;
  };
  const customHotelViewIsActive = (): boolean => {
    if (!customHotelViewEnabled) return false;
    const room = roomReadySummary();
    if (room.ready || room.hasRoomVisualizer || room.roomComponentActive) return false;
    if (room.roomId !== null && room.roomId !== undefined && room.roomId !== "" && room.roomId !== 0) return false;
    const manager = sourceWindowManager();
    const entry = entryStateSummary();
    if (!entryStateActive(entry)) return false;
    if (!entry.entryVisualizerObject) return false;
    if (!manager) return false;
    const visibleWindow = (id: LingoValue): boolean => {
      const windowObject = sourceWindowById(manager, id);
      if (!windowObject) return false;
      try {
        const visible = movie.runtime.callMethod(windowObject, "getproperty", [LingoSymbol.for("visible")]);
        if (!(visible instanceof LingoVoid)) return lingoTruthy(visible);
      } catch {
        // Some source window wrappers expose visibility as pVisible rather
        // than a getProperty value during construction.
      }
      const propVisible = instancePropValue(windowObject, "pvisible");
      return propVisible === undefined || propVisible instanceof LingoVoid ? true : lingoTruthy(propVisible);
    };
    return (
      visibleWindow(LingoSymbol.for("login_a")) ||
      visibleWindow(LingoSymbol.for("login_b")) ||
      visibleWindow("entry_bar")
    );
  };
  customHotelViewUnderlayActive = customHotelViewIsActive;
  const customHotelViewPresentation = (): CustomHotelViewPresentation | null => {
    if (!customHotelViewIsActive()) return null;
    const size = stageViewportSize();
    const useLargeStage = customHotelViewUsesLargeStage({
      viewportWidth: size.width,
      viewportHeight: size.height,
      screenWidth: window.screen?.availWidth || window.screen?.width,
      screenHeight: window.screen?.availHeight || window.screen?.height,
      resizable: resizablePresentation,
    });
    const layout = customHotelViewLayout({
      viewportWidth: size.width,
      viewportHeight: size.height,
      manualOffsetX: customHotelViewManualOffsetX,
      manualOffsetY: customHotelViewManualOffsetY,
      useLargeStage,
      elapsedMs: performance.now() - customHotelViewActivatedAt,
    });
    return {
      active: true,
      backgroundUrl: CUSTOM_HOTEL_VIEW_ASSETS.backgroundUrl,
      stageUrl: useLargeStage ? CUSTOM_HOTEL_VIEW_ASSETS.stageLargeUrl : CUSTOM_HOTEL_VIEW_ASSETS.stageSmallUrl,
      bannerUrl: customHotelViewBannerUrl(useLargeStage),
      ...layout,
    };
  };
  syncCustomHotelViewPresentation = (): CustomHotelViewPresentation | null => {
    const active = customHotelViewIsActive();
    const wasActive = customHotelViewWasActive;
    if (active && !wasActive) {
      customHotelViewManualOffsetX = 0;
      customHotelViewManualOffsetY = 0;
      customHotelViewActivatedAt = performance.now();
    }
    customHotelViewWasActive = active;
    if (active !== wasActive) syncPresentationUnderlays(resizeSnapshot);
    if (!active) {
      renderer.setCustomHotelView(null);
      renderer.setSuppressedChannels(new Set());
      return null;
    }
    const presentation = customHotelViewPresentation();
    renderer.setCustomHotelView(presentation);
    renderer.setSuppressedChannels(customHotelViewSuppressedChannels());
    return presentation;
  };
  canDragCustomHotelViewAt = (x: number, y: number): boolean => {
    if (!customHotelViewIsActive()) return false;
    if (sourceWindowContainsPoint(x, y)) return false;
    const size = stageViewportSize();
    return y >= 0 && y < Math.max(0, size.height - 54);
  };
  customHotelViewDiagnostics = (): Record<string, unknown> => {
    const presentation = customHotelViewPresentation();
    const suppressed = customHotelViewIsActive() ? [...customHotelViewSuppressedChannels()].sort((a, b) => a - b) : [];
    const size = stageViewportSize();
    return {
      enabled: customHotelViewEnabled,
      active: customHotelViewIsActive(),
      manualOffset: [customHotelViewManualOffsetX, customHotelViewManualOffsetY],
      presentation,
      useLargeStage: customHotelViewUsesLargeStage({
        viewportWidth: size.width,
        viewportHeight: size.height,
        screenWidth: window.screen?.availWidth || window.screen?.width,
        screenHeight: window.screen?.availHeight || window.screen?.height,
        resizable: resizablePresentation,
      }),
      suppressedChannels: suppressed,
      assetRoutes: CUSTOM_HOTEL_VIEW_ASSETS,
    };
  };
  const currentPrivateRoomFlatId = (): string | null => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    if (!objectList) return null;
    const roomComponent = propListLookup(objectList, "#room_component");
    if (roomComponent instanceof ScriptInstance && movie.runtime.hasHandler(roomComponent, "getprivateroomflatid")) {
      const flatId = movie.runtime.callMethod(roomComponent, "getprivateroomflatid", []);
      if (flatId instanceof LingoVoid) return null;
      const text = typeof flatId === "string" ? flatId : String(debugValue(flatId));
      return text.length > 0 ? text : null;
    }
    return null;
  };
  const roomStageToolbarTop = (): number => {
    const size = stageViewportSize();
    return Math.max(0, size.height - ROOM_PRESENTATION_TOOLBAR_HEIGHT - 1);
  };
  const spriteChannelByNumber = (number: number): SpriteChannel | null => {
    const direct = movie.channels[number];
    if (direct instanceof SpriteChannel && direct.number === number) return direct;
    return movie.channels.find((channel) => channel.number === number) ?? null;
  };
  const addRoomStageSprite = (value: LingoValue | undefined, channels: Set<number>): void => {
    if (value instanceof SpriteChannel) {
      if (value.visible !== 0) channels.add(value.number);
      return;
    }
    if (value instanceof LingoList) {
      for (const entry of value.items) addRoomStageSprite(entry, channels);
      return;
    }
    if (value instanceof LingoPropList) {
      for (const entry of value.values) addRoomStageSprite(entry, channels);
    }
  };
  const addRoomObjectSprites = (object: LingoValue | undefined, channels: Set<number>): void => {
    if (!(object instanceof ScriptInstance)) return;
    addRoomStageSprite(instancePropValue(object, "psprlist"), channels);
  };
  const addRoomObjectListSprites = (value: LingoValue | undefined, channels: Set<number>): void => {
    if (value instanceof LingoPropList) {
      for (const entry of value.values) addRoomObjectSprites(entry, channels);
      return;
    }
    if (value instanceof LingoList) {
      for (const entry of value.items) addRoomObjectSprites(entry, channels);
    }
  };
  const addFallbackAvatarStageSprites = (channels: Set<number>): void => {
    for (const channel of movie.channels) {
      if (channel.visible === 0 || channel.blend <= 0 || !channel.member) continue;
      const memberName = channel.member.name ?? "";
      if (!/^Canvas:uid:/i.test(memberName) && !/^h_/i.test(memberName)) continue;
      const rect = movie.spriteBounds(channel.number);
      if (rect && rect.top >= roomStageToolbarTop()) continue;
      channels.add(channel.number);
    }
  };
  const roomStagePresentationChannels = (): Set<number> => {
    const channels = new Set<number>();
    const visualizer = objectById("Room_visualizer");
    if (visualizer instanceof ScriptInstance) {
      addRoomStageSprite(instancePropValue(visualizer, "pspritelist"), channels);
      addRoomStageSprite(instancePropValue(visualizer, "pactsprlist"), channels);
      const wrappedParts = instancePropValue(visualizer, "pwrappedparts");
      if (wrappedParts instanceof LingoPropList) {
        for (const wrapper of wrappedParts.values) {
          if (wrapper instanceof ScriptInstance) addRoomStageSprite(instancePropValue(wrapper, "psprite"), channels);
        }
      }
      // The window landscape (sky) is a separately-reserved managed sprite that lives in
      // neither pSpriteList/pActSprList nor the wrappers, so the room zoom skipped it and
      // the sky stayed at 1x. Include it so it scales in lockstep with the walls/windows.
      if (movie.runtime.hasHandler(visualizer, "getsprbyid")) {
        addRoomStageSprite(movie.runtime.callMethod(visualizer, "getsprbyid", ["landscape"]), channels);
      }
    }

    // The cloud animation (Landscape Animation Manager) owns its own reserved sprite —
    // include it too so the clouds zoom with the sky instead of staying small.
    const landscapeAnim = objectById("landscape_animation_manager");
    if (landscapeAnim instanceof ScriptInstance) {
      addRoomStageSprite(instancePropValue(landscapeAnim, "psprite"), channels);
    }

    const roomComponent = objectById("#room_component");
    if (roomComponent instanceof ScriptInstance) {
      for (const propName of ["puserobjlist", "pactiveobjlist", "ppassiveobjlist", "pitemobjlist"]) {
        addRoomObjectListSprites(instancePropValue(roomComponent, propName), channels);
      }
    }
    addFallbackAvatarStageSprites(channels);
    return channels;
  };
  const roomStagePresentationOrigin = (channels: ReadonlySet<number>): { x: number; y: number } => {
    const visualizer = objectById("Room_visualizer");
    if (visualizer instanceof ScriptInstance) {
      const x = valueToNumber(instancePropValue(visualizer, "plocx"), Number.NaN);
      const y = valueToNumber(instancePropValue(visualizer, "plocy"), Number.NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    for (const channelNumber of channels) {
      const rect = movie.spriteBounds(channelNumber);
      const channel = spriteChannelByNumber(channelNumber);
      if (rect) {
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
      } else if (channel) {
        left = Math.min(left, channel.locH);
        top = Math.min(top, channel.locV);
      }
    }
    return {
      x: Number.isFinite(left) ? left : 0,
      y: Number.isFinite(top) ? top : 0,
    };
  };
  const roomStageCanZoom = (): boolean => {
    return Boolean(currentPrivateRoomFlatId()) && roomReadySummary().ready;
  };
  currentRoomStagePresentation = (): RoomStagePresentation | null => {
    if (roomStageZoom !== 2 || !roomStageCanZoom()) return null;
    const channels = roomStagePresentationChannels();
    if (channels.size === 0) return null;
    const origin = roomStagePresentationOrigin(channels);
    return {
      scale: 2,
      originX: origin.x,
      originY: origin.y,
      channels,
    };
  };
  roomStageSourcePoint = (point: { x: number; y: number }): { x: number; y: number } => {
    const presentation = currentRoomStagePresentation();
    if (!presentation) return point;
    if (point.y >= roomStageToolbarTop()) return point;
    if (sourceWindowContainsPoint(point.x, point.y)) return point;
    return {
      x: presentation.originX + (point.x - presentation.originX) / presentation.scale,
      y: presentation.originY + (point.y - presentation.originY) / presentation.scale,
    };
  };
  roomStageDragDeltaScale = (): number => currentRoomStagePresentation()?.scale ?? 1;
  roomStageZoomDiagnostics = (): Record<string, unknown> => {
    const presentation = currentRoomStagePresentation();
    return {
      ok: true,
      scale: roomStageZoom,
      active: Boolean(presentation),
      canZoom: roomStageCanZoom(),
      privateRoomFlatId: currentPrivateRoomFlatId(),
      toolbarTop: roomStageToolbarTop(),
      channelCount: presentation?.channels.size ?? 0,
      origin: presentation ? [presentation.originX, presentation.originY] : null,
    };
  };
  setRoomStageZoom = (scale: number): Record<string, unknown> => {
    roomStageZoom = Number(scale) >= 2 ? 2 : 1;
    renderer.setRoomStagePresentation(currentRoomStagePresentation());
    renderer.markDirty();
    return roomStageZoomDiagnostics();
  };
  const collectNavigatorNodes = (nodeTypes?: Set<number>): Array<{
    node: LingoPropList;
    cacheKey: LingoValue | null;
    parentCacheKey: LingoValue | null;
  }> => {
    const navigatorComponent = navigatorComponentFromObjects();
    if (!(navigatorComponent instanceof ScriptInstance)) return [];
    const cache = instancePropValue(navigatorComponent, "pnodecache");
    if (!(cache instanceof LingoPropList)) return [];
    const result: Array<{
      node: LingoPropList;
      cacheKey: LingoValue | null;
      parentCacheKey: LingoValue | null;
    }> = [];
    const seen = new Set<LingoPropList>();
    const visitNode = (node: LingoValue, cacheKey: LingoValue | null, parentCacheKey: LingoValue | null): void => {
      if (!(node instanceof LingoPropList) || seen.has(node)) return;
      seen.add(node);
      const nodeType = propListValue(node, "nodeType");
      if (typeof nodeType === "number" && (!nodeTypes || nodeTypes.has(nodeType))) {
        result.push({ node, cacheKey, parentCacheKey });
      }
      const children = propListValue(node, "children");
      if (children instanceof LingoPropList) {
        for (let index = 0; index < children.values.length; index += 1) {
          visitNode(children.values[index]!, children.keys[index] ?? null, cacheKey);
        }
      }
    };
    for (let index = 0; index < cache.values.length; index += 1) {
      visitNode(cache.values[index]!, cache.keys[index] ?? null, null);
    }
    return result;
  };
  const summarizeNavigatorNode = (
    entry: { node: LingoPropList; cacheKey: LingoValue | null; parentCacheKey: LingoValue | null },
  ): Record<string, unknown> => {
    const nodeType = propListValue(entry.node, "nodeType");
    return {
      cacheKey: entry.cacheKey === null ? null : debugValue(entry.cacheKey),
      parentCacheKey: entry.parentCacheKey === null ? null : debugValue(entry.parentCacheKey),
      nodeType: debugValue(nodeType),
      id: debugValue(propListValue(entry.node, "id")),
      name: debugValue(propListValue(entry.node, "name")),
      parentId: debugValue(propListValue(entry.node, "parentid")),
      unitStrId: debugValue(propListValue(entry.node, "unitStrId")),
      port: debugValue(propListValue(entry.node, "port")),
      door: debugValue(propListValue(entry.node, "door")),
      users: debugValue(propListValue(entry.node, "usercount")),
      maxUsers: debugValue(propListValue(entry.node, "maxUsers")),
      casts: summarizeValue(propListValue(entry.node, "casts"), 1),
      hidden: debugValue(propListValue(entry.node, "hidden")),
      halfRoomID: debugValue(propListValue(entry.node, "halfRoomID")),
    };
  };
  const navigatorPublicNodes = (): Array<Record<string, unknown>> =>
    collectNavigatorNodes(new Set([1])).map((entry) => summarizeNavigatorNode(entry));
  const navigatorNodes = (): Array<Record<string, unknown>> =>
    collectNavigatorNodes().map((entry) => summarizeNavigatorNode(entry));
  const findNavigatorNode = (query: string | number | undefined, nodeTypes?: Set<number>): LingoPropList | null => {
    const raw = query === undefined ? "" : String(query).trim();
    const rawLower = raw.toLowerCase();
    const rawNumber = raw.length > 0 && /^\d+$/.test(raw) ? Number(raw) : null;
    const nodes = collectNavigatorNodes(nodeTypes).map((entry) => entry.node);
    if (nodes.length === 0) return null;
    if (raw.length === 0) return nodes[0] ?? null;
    const field = (node: LingoPropList, key: string): string => {
      const value = propListValue(node, key);
      const debug = debugValue(value);
      return debug === undefined || debug === null ? "" : String(debug);
    };
    return (
      nodes.find((node) => field(node, "id") === raw) ??
      nodes.find((node) => field(node, "unitStrId").toLowerCase() === rawLower) ??
      nodes.find((node) => field(node, "name").toLowerCase() === rawLower) ??
      (rawNumber === null ? undefined : nodes.find((node) => valueToNumber(propListValue(node, "port"), -1) === rawNumber)) ??
      nodes.find((node) => field(node, "name").toLowerCase().includes(rawLower)) ??
      null
    );
  };
  const findNavigatorPublicNode = (query: string | number | undefined): LingoPropList | null =>
    findNavigatorNode(query, new Set([1]));
  const ensureNavigatorPublicNodes = async (timeoutMs = 15000, query?: string | number): Promise<{
    route: string;
    sendResult: unknown;
    expandedCategories: unknown[];
    publicNodes: Array<Record<string, unknown>>;
    errors: string[];
  }> => {
    const errors: string[] = [];
    const expandedCategories: unknown[] = [];
    const navigatorComponent = navigatorComponentFromObjects();
    let route = "Navigator Component cached node data";
    let sendResult: unknown = LINGO_VOID;
    if (!(navigatorComponent instanceof ScriptInstance)) {
      return { route, sendResult: null, expandedCategories, publicNodes: [], errors: ["Navigator Component not available"] };
    }
    const sendNavigate = (category: LingoValue): unknown => {
      if (category instanceof LingoVoid || !movie.runtime.hasHandler(navigatorComponent, "sendnavigate")) {
        return null;
      }
      try {
        return summarizeValue(movie.runtime.callMethod(navigatorComponent, "sendnavigate", [category]), 2);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return null;
      }
    };
    if (navigatorPublicNodes().length === 0) {
      const rootUnitCatId = instancePropValue(navigatorComponent, "prootunitcatid");
      const targetCategory = rootUnitCatId instanceof LingoVoid || rootUnitCatId === undefined ? LINGO_VOID : rootUnitCatId;
      route = "Navigator Component.sendNavigate(public root)";
      if (!(targetCategory instanceof LingoVoid)) {
        sendResult = sendNavigate(targetCategory) as LingoValue;
      } else {
        errors.push("Navigator public root category is not available");
      }
    }
    const deadline = performance.now() + Math.max(1, Number(timeoutMs) || 15000);
    let publicNodes = navigatorPublicNodes();
    while (publicNodes.length === 0 && performance.now() < deadline) {
      await delay(100);
      publicNodes = navigatorPublicNodes();
    }
    if (query !== undefined && !findNavigatorPublicNode(query) && performance.now() < deadline) {
      route = "Navigator Component.sendNavigate(public categories)";
      const expandedIds = new Set<string>();
      while (!findNavigatorPublicNode(query) && performance.now() < deadline) {
        const categoryEntry = collectNavigatorNodes(new Set([0])).find((entry) => {
          const id = String(debugValue(propListValue(entry.node, "id")) ?? "");
          return id.length > 0 && !expandedIds.has(id);
        });
        if (!categoryEntry) break;
        const categoryId = propListValue(categoryEntry.node, "id");
        const categoryIdText = String(debugValue(categoryId) ?? "");
        if (categoryIdText.length === 0) break;
        expandedIds.add(categoryIdText);
        const result = sendNavigate(categoryId);
        expandedCategories.push({
          node: summarizeNavigatorNode(categoryEntry),
          sendResult: result,
        });
        while (!findNavigatorPublicNode(query) && performance.now() < deadline) {
          await delay(100);
          const newerCategories = collectNavigatorNodes(new Set([0])).filter((entry) => {
            const id = String(debugValue(propListValue(entry.node, "id")) ?? "");
            return id.length > 0 && !expandedIds.has(id);
          });
          const targetFound = Boolean(findNavigatorPublicNode(query));
          if (targetFound || newerCategories.length > 0) break;
        }
      }
      publicNodes = navigatorPublicNodes();
    }
    return { route, sendResult, expandedCategories, publicNodes, errors };
  };
  const beginPublicRoomEntryWithSourceEvents = async (
    query?: string | number,
    cacheTimeoutMs = 20000,
  ): Promise<{
    route: string;
    query: string | number | null;
    node: unknown;
    cache: Awaited<ReturnType<typeof ensureNavigatorPublicNodes>>;
    result: unknown;
    errors: string[];
  }> => {
    const errors: string[] = [];
    const cache = await ensureNavigatorPublicNodes(cacheTimeoutMs, query);
    errors.push(...cache.errors);
    const navigatorComponent = navigatorComponentFromObjects();
    let result: LingoValue = LINGO_VOID;
    const node = findNavigatorPublicNode(query);
    if (!(navigatorComponent instanceof ScriptInstance) || !movie.runtime.hasHandler(navigatorComponent, "prepareroomentry")) {
      errors.push("Navigator Component.prepareRoomEntry not available");
    } else if (!(node instanceof LingoPropList)) {
      errors.push(`public room node not found: ${query ?? "<first>"}`);
    } else {
      try {
        result = movie.runtime.callMethod(navigatorComponent, "prepareroomentry", [node]);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return {
      route: "Navigator Component.prepareRoomEntry(public node)",
      query: query ?? null,
      node: node instanceof LingoPropList ? summarizeValue(node, 2) : null,
      cache,
      result: summarizeValue(result, 2),
      errors,
    };
  };
  const enterPublicRoomWithSourceEvents = async (
    query?: string | number,
    timeoutMs = 90000,
  ): Promise<{
    route: string;
    query: string | number | null;
    node: unknown;
    cache: Awaited<ReturnType<typeof ensureNavigatorPublicNodes>>;
    result: unknown;
    roomReady: ReturnType<typeof roomReadySummary>;
    errors: string[];
  }> => {
    const started = await beginPublicRoomEntryWithSourceEvents(query, Math.min(timeoutMs, 20000));
    const roomReady = await waitForRoomReady(timeoutMs);
    return {
      ...started,
      roomReady,
    };
  };
  const memberDiagnostics = (names: string[]): Record<string, unknown> => {
    const index = resourceMemberIndex(movie.runtime.getGlobal("gcore"));
    const result: Record<string, unknown> = {};
    for (const rawName of names) {
      const name = String(rawName ?? "");
      const numericId = /^-?\d+$/.test(name.trim()) ? Number(name.trim()) : null;
      const exact = numericId === null ? members.find(name, null) : members.find(numericId, null);
      const loadedMatches = members.loaded.flatMap((castName) =>
        members
          .membersOf(castName)
          .filter((member) =>
            numericId === null
              ? member.name.toLowerCase() === name.toLowerCase()
              : member.slotNumber === numericId || member.number === (numericId & 0xffff),
          )
          .map((member) => ({
            castName,
            member: member.number,
            slotNumber: member.slotNumber,
            type: member.type,
            textLength: member.text.length,
          })),
      );
      const indexed = numericId === null && index ? index.getaProp(name, lingoKeyEquals) : LINGO_VOID;
      result[name] = {
        decodedSlot:
          numericId === null
            ? null
            : {
                castLib: numericId >> 16,
                member: numericId & 0xffff,
              },
        resourceIndex: indexed instanceof LingoVoid ? null : debugValue(indexed),
        member: exact
          ? {
              castName: exact.castName,
              member: exact.number,
              slotNumber: exact.slotNumber,
              castNumber: exact.castNumber,
              type: exact.type,
              textLength: exact.text.length,
              hasBitmap: Boolean(exact.bitmap),
            }
          : null,
        loadedMatches,
      };
    }
    return result;
  };
  const enterPrivateRoomWithSourceEvents = async (
    flatId?: string,
    skipRoomEntryChecks = true,
    timeoutMs = 60000,
  ): Promise<{
    route: string;
    flatId: string | null;
    result: unknown;
    roomReady: ReturnType<typeof roomReadySummary>;
    errors: string[];
  }> => {
    const errors: string[] = [];
    const targetFlatId = flatId && flatId.length > 0 ? flatId : currentPrivateRoomFlatId();
    let result: LingoValue = LINGO_VOID;
    if (!targetFlatId) {
      errors.push("private room flat id not available");
    } else {
      const navigatorComponent = navigatorComponentFromObjects();
      if (navigatorComponent instanceof ScriptInstance && movie.runtime.hasHandler(navigatorComponent, "prepareroomentry")) {
        try {
          result = movie.runtime.callMethod(navigatorComponent, "prepareroomentry", [
            targetFlatId,
            LingoSymbol.for("private"),
            skipRoomEntryChecks ? 1 : 0,
          ]);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } else {
        errors.push("Navigator Component.prepareRoomEntry not available");
      }
    }
    const roomReady = await waitForRoomReady(timeoutMs);
    return {
      route: "Navigator Component.prepareRoomEntry(flatId, #private)",
      flatId: targetFlatId,
      result: summarizeValue(result, 2),
      roomReady,
      errors,
    };
  };
  // --- Private-room entry watchdog: auto-retry a stalled join instead of hanging ---
  // A private-room open (Navigator Component.prepareRoomEntry -> TRYFLAT/GOTOFLAT/
  // room_directory -> ROOM_READY) normally reaches "ready" within a couple of seconds.
  // If the server never returns the room data the source just waits on the loader bar
  // forever (classic Habbo has no retry). Watch for a load that has made NO progress for
  // a while (route, sprite count, cast-loaded and active flag all frozen) while a flat is
  // still targeted and unready, then clear the room-connection guard
  // (pRoomConnectionRequested, which otherwise blocks a re-send) and re-fire
  // prepareRoomEntry — an instant retry rather than an indefinite hang.
  const ROOM_ENTRY_STALL_MS = 1800;
  const ROOM_ENTRY_MAX_RETRIES = 8;
  let roomEntryWatch: { flatId: string; fingerprint: string; sinceMs: number; retries: number } | null = null;
  const roomComponentInstance = (): ScriptInstance | null => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    const rc = objectList ? propListLookup(objectList, "#room_component") : LINGO_VOID;
    return rc instanceof ScriptInstance ? rc : null;
  };
  const retryRoomEntry = (flatId: string): void => {
    const rc = roomComponentInstance();
    if (rc) {
      // Clear the connection guard so the open can be re-sent on the re-drive.
      try {
        movie.runtime.setInstanceProp(rc, "proomconnectionrequested", 0);
      } catch {
        /* best effort */
      }
    }
    const navigatorComponent = navigatorComponentFromObjects();
    if (navigatorComponent instanceof ScriptInstance && movie.runtime.hasHandler(navigatorComponent, "prepareroomentry")) {
      try {
        movie.runtime.callMethod(navigatorComponent, "prepareroomentry", [flatId, LingoSymbol.for("private"), 1]);
      } catch (error) {
        appendLog("error", `room-entry retry failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const roomEntryWatchdogSnapshot = (): Record<string, unknown> => ({
    watching: roomEntryWatch
      ? { ...roomEntryWatch, stalledMs: Math.round(performance.now() - roomEntryWatch.sinceMs) }
      : null,
    stallMs: ROOM_ENTRY_STALL_MS,
    maxRetries: ROOM_ENTRY_MAX_RETRIES,
  });
  const roomEntryWatchdogTick = (): void => {
    const flatId = currentPrivateRoomFlatId();
    const summary = roomReadySummary();
    if (!flatId || summary.ready) {
      roomEntryWatch = null;
      return;
    }
    const rc = roomComponentInstance();
    // Progress fingerprint: anything moving here means the load is still advancing.
    const fingerprint = [
      summary.route,
      summary.roomLikeSpriteCount,
      rc ? debugValue(instancePropValue(rc, "pcastloaded")) : "-",
      rc ? debugValue(instancePropValue(rc, "pactiveflag")) : "-",
    ].join("|");
    const now = performance.now();
    if (!roomEntryWatch || roomEntryWatch.flatId !== flatId) {
      roomEntryWatch = { flatId, fingerprint, sinceMs: now, retries: 0 };
      return;
    }
    if (roomEntryWatch.fingerprint !== fingerprint) {
      // Still progressing — reset the stall clock, keep the retry budget for this flat.
      roomEntryWatch.fingerprint = fingerprint;
      roomEntryWatch.sinceMs = now;
      return;
    }
    if (now - roomEntryWatch.sinceMs >= ROOM_ENTRY_STALL_MS && roomEntryWatch.retries < ROOM_ENTRY_MAX_RETRIES) {
      appendLog(
        "info",
        `private room ${flatId} stalled at "${summary.route}" for ${Math.round(now - roomEntryWatch.sinceMs)}ms with no progress; auto-retrying entry (attempt ${roomEntryWatch.retries + 1}/${ROOM_ENTRY_MAX_RETRIES})`,
      );
      retryRoomEntry(flatId);
      roomEntryWatch.sinceMs = now;
      roomEntryWatch.retries += 1;
    }
  };
  const roomEntryWatchdogTimer = setInterval(roomEntryWatchdogTick, 1000);
  void roomEntryWatchdogTimer;
  const sessionObjectFromObjects = (): ScriptInstance | null => {
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    if (!objectList) return null;
    const session = propListLookup(objectList, "#session");
    return session instanceof ScriptInstance ? session : null;
  };
  const sourceSessionGet = (key: string): LingoValue => {
    const session = sessionObjectFromObjects();
    if (!(session instanceof ScriptInstance) || !movie.runtime.hasHandler(session, "get")) return LINGO_VOID;
    try {
      return movie.runtime.callMethod(session, "get", [key]);
    } catch {
      return LINGO_VOID;
    }
  };
  const chatHistoryFromSourceSession = (): Array<Record<string, unknown>> => {
    const history = sourceSessionGet("chat_history");
    if (!(history instanceof LingoList)) return [];
    return history.items.map((entry, index) => {
      if (!(entry instanceof LingoPropList)) {
        return {
          index: index + 1,
          type: "unknown",
          raw: summarizeValue(entry, 2),
        };
      }
      const message = propListValue(entry, "message");
      const messageProps = message instanceof LingoPropList ? message : null;
      return {
        index: index + 1,
        type: debugValue(propListValue(entry, "type")),
        timestamp: debugValue(propListValue(entry, "timeStamp")),
        userName: debugValue(propListValue(entry, "userName")),
        userObject: debugValue(propListValue(entry, "uObject")),
        virtual: debugValue(propListValue(entry, "virtual")),
        mode: messageProps ? debugValue(propListValue(messageProps, "command")) : null,
        userId: messageProps ? debugValue(propListValue(messageProps, "id")) : null,
        text: messageProps ? debugValue(propListValue(messageProps, "message")) : debugValue(message),
      };
    });
  };
  const sendChatWithSourceEvents = async (
    text: string,
    delayMs = 0,
  ): Promise<{
    ok: boolean;
    route: string;
    field: unknown;
    enterResult: boolean;
    errors: string[];
  }> => {
    const errors: string[] = [];
    const message = String(text ?? "");
    if (message.trim().length === 0) errors.push("chat message is empty");
    if (message.length > 300) errors.push("chat message exceeds 300 characters");
    const fields = editableFields();
    const candidates = fields
      .map((field) => ({
        field,
        width: field.rect[2] - field.rect[0],
        height: field.rect[3] - field.rect[1],
      }))
      .filter((entry) => entry.width >= 120 && entry.height <= 40)
      .sort((left, right) => right.field.rect[1] - left.field.rect[1] || right.width - left.width);
    const target = candidates[0]?.field ?? fields[fields.length - 1] ?? null;
    if (!target) errors.push("no editable chat field is available");
    if (errors.length > 0 || !target) {
      return {
        ok: false,
        route: "Director editable field + Enter",
        field: target,
        enterResult: false,
        errors,
      };
    }
    clickSprite(target.n);
    await clearFocusedField();
    await typeText(message, Math.max(0, Number(delayMs) || 0));
    const enterResult = await pressKey("Enter");
    return {
      ok: enterResult,
      route: "Director editable field + Enter",
      field: target,
      enterResult,
      errors,
    };
  };
  const showHotelViewWithSourceEvents = async (): Promise<{
    route: string;
    primaryResult: unknown;
    changeRoomResult: unknown;
    leaveRoomResult: unknown;
    fallbackResult: unknown;
    state: unknown;
    entryBarObject: boolean;
    entryVisualizerObject: boolean;
    errors: string[];
  }> => {
    const errors: string[] = [];
    let route = "Navigator Component.updateState(enterEntry)";
    let primaryResult: LingoValue = LINGO_VOID;
    let changeRoomResult: LingoValue = LINGO_VOID;
    let leaveRoomResult: LingoValue = LINGO_VOID;
    let fallbackResult: LingoValue = LINGO_VOID;
    const initialRoom = roomReadySummary();
    const navigatorComponent = navigatorComponentFromObjects();
    if (navigatorComponent instanceof ScriptInstance) {
      try {
        // Source-backed path: Navigator Component.updateState("enterEntry")
        // performs executeMessage(#changeRoom) then executeMessage(#leaveRoom).
        // Calling those messages here as well tears the active room down twice.
        if (initialRoom.ready) {
          route = "Navigator Component.updateState(enterEntry)";
        }
        primaryResult = movie.runtime.callMethod(navigatorComponent, "updatestate", ["enterEntry"]);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      route = "executemessage(#changeRoom) + executemessage(#leaveRoom)";
      try {
        if (!initialRoom.ready) changeRoomResult = movie.runtime.call("executemessage", [LingoSymbol.for("changeRoom")]);
        if (!initialRoom.ready) leaveRoomResult = movie.runtime.call("executemessage", [LingoSymbol.for("leaveRoom")]);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        route = "Entry Component.enterEntry fallback";
      }
    }
    await delay(0);
    let state = entryStateSummary();
    if (!entryStateActive(state)) {
      const component = entryComponentFromObjects();
      if (component instanceof ScriptInstance) {
        try {
          fallbackResult = movie.runtime.callMethod(component, "enterentry", []);
          route = route === "executemessage(#leaveRoom)" ? "executemessage(#leaveRoom) + Entry Component.enterEntry" : route;
          await delay(0);
          state = entryStateSummary();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }
    return {
      route,
      primaryResult: summarizeValue(primaryResult, 2),
      changeRoomResult: summarizeValue(changeRoomResult, 2),
      leaveRoomResult: summarizeValue(leaveRoomResult, 2),
      fallbackResult: summarizeValue(fallbackResult, 2),
      ...state,
      errors,
    };
  };

  const appStartedAt = performance.now();
  let rafCount = 0;
  let lastRafAt = appStartedAt;
  const rafDeltas: number[] = [];
  const performanceStats = (): Record<string, unknown> => {
    const tick = movie.tickDiagnostics();
    const recent = rafDeltas.slice(-120);
    const averageRafDeltaMs =
      recent.length > 0 ? recent.reduce((sum, value) => sum + value, 0) / recent.length : 0;
    const worstRafDeltaMs = recent.length > 0 ? Math.max(...recent) : 0;
    const elapsedMs = Math.max(1, performance.now() - appStartedAt);
    return {
      elapsedMs: Math.round(elapsedMs),
      rafCount,
      rafPerSecond: Math.round((rafCount / elapsedMs) * 100000) / 100,
      averageRafDeltaMs: Math.round(averageRafDeltaMs * 100) / 100,
      worstRafDeltaMs: Math.round(worstRafDeltaMs * 100) / 100,
      // Live frame rate from the RECENT frame-delta average (not the lifetime rafPerSecond),
      // so a stall shows up immediately: main-thread lag delays RAF, the recent deltas grow,
      // and this number drops — the way a normal game-engine FPS readout behaves.
      currentFps: averageRafDeltaMs > 0 ? Math.round(1000 / averageRafDeltaMs) : 0,
      frameTempo: movie.frameTempo,
      directorTickCount: tick.tickCount,
      directorTicksPerSecond: Math.round((tick.tickCount / elapsedMs) * 100000) / 100,
      activeTimeoutCount: tick.timeouts.filter((timeout) => timeout.active).length,
    };
  };
  let userNameLabelsEnabled = false;
  const setUserNameLabels = (enabled: boolean): Record<string, unknown> => {
    userNameLabelsEnabled = Boolean(enabled);
    if (!userNameLabelsEnabled) renderer.setUserNameLabels([]);
    renderer.markDirty();
    return { enabled: userNameLabelsEnabled };
  };
  const userNameLabels = (): UserNameLabel[] => {
    if (!userNameLabelsEnabled) return [];
    const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
    const roomComponent = objectList ? propListLookup(objectList, "#room_component") : LINGO_VOID;
    if (!(roomComponent instanceof ScriptInstance)) return [];
    const prop = (object: ScriptInstance, name: string): LingoValue => {
      try {
        return movie.runtime.getProp(object, name);
      } catch {
        return instancePropValue(object, name) ?? LINGO_VOID;
      }
    };
    const userList = prop(roomComponent, "puserobjlist");
    const users =
      userList instanceof LingoPropList
        ? userList.keys.map((key, index) => ({ key, user: userList.values[index] }))
        : userList instanceof LingoList
          ? userList.items.map((user, index) => ({ key: index + 1, user }))
          : [];
    const avatarSpriteGroups = fallbackAvatarSpriteGroups(movie.channels);
    return users.flatMap(({ key, user }): UserNameLabel[] => {
      if (!(user instanceof ScriptInstance)) return [];
      const name = String(debugValue(prop(user, "pname")) ?? debugValue(key) ?? "").trim();
      if (!name || name === "<Void>") return [];
      const sprites = prop(user, "psprlist");
      const spriteItems =
        sprites instanceof LingoList
          ? sprites.items
          : sprites instanceof LingoPropList
            ? sprites.values
            : [];
      const candidateSprites = spriteItems.length > 0 ? spriteItems : avatarSpriteGroups[users.findIndex((entry) => entry.user === user)] ?? [];
      if (candidateSprites.length === 0) return [];
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let maxZ = Number.NEGATIVE_INFINITY;
      for (const entry of candidateSprites) {
        if (!(entry instanceof SpriteChannel) || entry.visible === 0) continue;
        const rect = movie.spriteBounds(entry.number);
        if (!rect) continue;
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        maxZ = Math.max(maxZ, entry.locZ);
      }
      if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(maxZ)) return [];
      const id = String(debugValue(prop(user, "id")) ?? debugValue(key) ?? name);
      return [{
        id,
        name,
        x: Math.round((left + right) / 2),
        y: Math.round(top - 3),
        z: maxZ,
      }];
    });
  };

  const fallbackAvatarSpriteGroups = (channels: readonly SpriteChannel[]): SpriteChannel[][] => {
    const groups = new Map<string, SpriteChannel[]>();
    for (const channel of channels) {
      if (channel.visible === 0 || channel.blend <= 0) continue;
      const memberName = channel.member?.name ?? "";
      if (!/^Canvas:uid:/i.test(memberName) && !/^h_/i.test(memberName)) continue;
      const key = `${Math.round(channel.locH)}:${Math.round(channel.locV)}`;
      const group = groups.get(key) ?? [];
      group.push(channel);
      groups.set(key, group);
    }
    return [...groups.values()]
      .filter((group) => group.some((channel) => /^Canvas:uid:/i.test(channel.member?.name ?? "") || /^h_/i.test(channel.member?.name ?? "")))
      .sort((left, right) => {
        const leftZ = Math.max(...left.map((channel) => channel.locZ));
        const rightZ = Math.max(...right.map((channel) => channel.locZ));
        return leftZ - rightZ;
      });
  };

  // Expose live state for diagnostics/capture.
  (window as unknown as { __engine: unknown }).__engine = {
    dev: {
      stageClick,
      clickSprite,
      editableFields,
      pressKey,
      typeText,
      login: loginWithSourceEvents,
      sourceTimeoutIds,
      showHotelView: showHotelViewWithSourceEvents,
      enterPrivateRoom: enterPrivateRoomWithSourceEvents,
      beginPublicRoomEntry: beginPublicRoomEntryWithSourceEvents,
      enterPublicRoom: enterPublicRoomWithSourceEvents,
      sendChat: sendChatWithSourceEvents,
      chatHistory: chatHistoryFromSourceSession,
      navigatorPublicNodes,
      navigatorNodes,
      openNavigator: () => showNavigatorWithSource(),
      hideNavigator: (mode?: string) => hideNavigatorWithSource(mode),
      navigatorView: (view = "nav_pr") => showNavigatorWithSource(String(view)),
      executeMessage: executeSourceMessage,
      brokerMessage: (message = "toggle_ig") => brokerMessageSummary(String(message)),
      threads: threadManagerSummary,
      igState: igStateSummary,
      setTraceHandlers: (handlers: string[] | string) => {
        const list = Array.isArray(handlers) ? handlers : String(handlers ?? "").split(",");
        movie.runtime.traceSink = (text) => appendLog("info", text);
        for (const handler of list) {
          const normalized = String(handler ?? "").trim().toLowerCase();
          if (normalized) movie.runtime.traceHandlers.add(normalized);
        }
        return [...movie.runtime.traceHandlers];
      },
      clearTraceHandlers: () => {
        movie.runtime.traceHandlers.clear();
        return [];
      },
      currentPrivateRoomFlatId,
      memberDiagnostics,
      clickWindowElement,
      windowElements: (id: string, includeImages = false) => summarizeSourceWindow(id, Boolean(includeImages)),
      windowIds: () => {
        const windowManager = sourceWindowManager();
        return windowManager ? sourceWindowIds(windowManager).map(valueToId) : [];
      },
      wheelAt: (x: number, y: number, deltaY: number, deltaX = 0, shiftDown = false) =>
        sourceWheelAt(Number(x), Number(y), Number(deltaY), Number(deltaX), Boolean(shiftDown)),
      spriteDebug: (n: number) => {
        const channel = movie.channels[Number(n) | 0];
        if (!channel) return null;
        const rect = movie.spriteBounds(channel.number);
        return {
          ...(summarizeSprite(channel, 4) as Record<string, unknown>),
          rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null,
        };
      },
      resolvedSpriteDebug: (n: number, includeImages = false) => {
        const channel = movie.channels[Number(n) | 0];
        return channel ? resolvedSpriteSummary(channel, Boolean(includeImages)) : null;
      },
      resolvedSprites: (query = "", includeImages = false) => {
        const needle = String(query ?? "").toLowerCase();
        return movie.channels
          .filter((channel) => {
            if (channel.puppet !== 1 || !channel.member) return false;
            if (!needle) return true;
            const haystack = [
              channel.number,
              channel.member.name,
              channel.member.type,
              debugValue(channel.id),
              channel.member.castName,
            ]
              .join(" ")
              .toLowerCase();
            return haystack.includes(needle);
          })
          .map((channel) => resolvedSpriteSummary(channel, Boolean(includeImages)));
      },
      hitSprites: (x: number, y: number) => movie.spritesAt(Number(x), Number(y)).map((channel) => summarizeSprite(channel, 3)),
      inputSpriteAt: (x: number, y: number) => {
        const channel = movie.inputSpriteAt(Number(x), Number(y));
        if (!channel) return null;
        const rect = movie.spriteBounds(channel.number);
        return {
          ...(summarizeSprite(channel, 4) as Record<string, unknown>),
          rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null,
          pixel: spritePixelAt(channel, Number(x), Number(y)),
        };
      },
      hitProbe,
      waitForObject: async (id: string, timeoutMs = 10000) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) {
          if (objectExists(id)) return true;
          await delay(100);
        }
        return false;
      },
      roomReady: roomReadySummary,
      waitForRoomReady,
      roomEntryState,
      roomEntryWatchdog: roomEntryWatchdogSnapshot,
      performanceStats,
      setUserNameLabels,
      userNameLabels: () => ({ enabled: userNameLabelsEnabled, labels: userNameLabels() }),
      setRoomStageZoom,
      roomStageZoom: roomStageZoomDiagnostics,
      customHotelView: customHotelViewDiagnostics,
      waitForHotelViewStable,
      scriptBundle: () => ({
        runtimeVersion,
        executableVersion: executableScripts.version,
        exact: executableScripts.exact,
        executableScripts: executableScripts.scripts.length,
        profileScriptRecords: profileScriptRecords.length,
      }),
    },
    activeSprites: () =>
      movie.channels
        .filter((c) => c.puppet === 1 && c.member)
        .map((c) => ({
          n: c.number,
          member: c.member!.name,
          memberNumber: c.member!.number,
          castNum: c.member!.slotNumber,
          castLibNum: c.member!.castNumber,
          type: c.member!.type,
          hasPng: !!c.member!.bitmap?.pngUrl,
          hasImage: !!c.member!.image,
          hasDecoded: !!c.member!.bitmap?.decoded,
          imgSize: c.member!.image ? [c.member!.image.width, c.member!.image.height] : null,
          loc: [c.locH, c.locV],
          z: c.locZ,
          vis: c.visible,
          ink: c.ink,
          blend: c.blend,
          size: [c.width, c.height],
          rotation: c.rotation,
          skew: c.skew,
          regPoint: c.member ? [c.member.regX, c.member.regY] : null,
          id: debugValue(c.id),
          color: debugValue(c.color),
          bgColor: debugValue(c.bgColor),
          flipH: c.flipH,
          bitmapSize: c.member!.bitmap ? [c.member!.bitmap.width, c.member!.bitmap.height] : null,
          editable: c.editable,
          text: c.member!.type === "field" || c.member!.type === "text" ? c.member!.text : undefined,
        })),
    keyboardFocus: () => movie.keyboardFocusSprite,
    memberImageData: (name: string) => {
      const exact = movie.channels.find((c) => c.member?.name === name);
      if (exact?.member) {
        const image = exact.member.image ?? exact.member.bitmap?.decoded;
        const el = image?.el as HTMLCanvasElement | undefined;
        return el ? el.toDataURL() : null;
      }
      for (const c of movie.channels) {
        if (c.member?.name.startsWith(name)) {
          const image = c.member.image ?? c.member.bitmap?.decoded;
          const el = image?.el as HTMLCanvasElement | undefined;
          return el ? el.toDataURL() : null;
        }
      }
      return null;
    },
    findMember: (prefix: string) => {
        for (const castName of members.loaded) {
          for (const member of members.membersOf(castName)) {
            if (!member.name.startsWith(prefix)) continue;
            const image = member.image ?? member.bitmap?.decoded;
            const el = image?.el as HTMLCanvasElement | undefined;
          return {
            cast: castName,
            name: member.name,
            type: member.type,
            text: member.text,
            style: Object.fromEntries(member.style),
            imageSize: image ? [image.width, image.height] : null,
              imageIncomplete: image ? image.incomplete : null,
              imageVersion: image ? image.version : null,
              paletteColors: paletteSample(member.paletteColors),
              bitmapPaletteColors: paletteSample(member.bitmap?.paletteColors),
              imageData: el ? el.toDataURL() : null,
            };
          }
      }
      return null;
    },
    frame: () => movie.frame,
    errors: () => movie.errorCount,
    networkBridgeUrl: () => movie.networkBridgeUrl,
    castLoaded: (name: string) => members.loaded.includes(name),
    loadedCasts: () => [...members.loaded],
    brokerMessage: (message = "toggle_ig") => brokerMessageSummary(String(message)),
    threads: threadManagerSummary,
    igState: igStateSummary,
    resourceMembers: (names: string[]) => {
      const index = resourceMemberIndex(movie.runtime.getGlobal("gcore"));
      if (!index) return {};
      const result: Record<string, LingoValue> = {};
      for (const name of names) {
        result[name] = index.getaProp(name, lingoKeyEquals);
      }
      return result;
    },
    objectIds: () => {
      const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
      if (!objectList) return [];
      return objectList.keys.map(debugValue);
    },
    variables: (names: string[]) => summarizeVariables(movie.runtime.getGlobal("gcore"), names),
    objectProps: (id: string) => {
      const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
      if (!objectList) return null;
      const object = propListLookup(objectList, id);
      return summarizeObject(object, 3);
    },
    windowElements: (id: string, includeImages = false) => summarizeSourceWindow(id, Boolean(includeImages)),
    objectMethod: (id: string, method: string, args: unknown[] = []) => {
      const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
      if (!objectList) return null;
      const object = propListLookup(objectList, id);
      const result = movie.runtime.callMethod(
        object,
        method,
        args.map((value) => coerceDebugValue(value)),
      );
      return summarizeValue(result, 3);
    },
    writerPreview: (id: string, text: string, width = 245, height = 38) => {
      const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
      if (!objectList) return null;
      const writer = propListLookup(objectList, id);
      if (!(writer instanceof ScriptInstance) || !movie.runtime.hasHandler(writer, "render")) {
        return { error: `writer not found: ${id}` };
      }
      const image = movie.runtime.callMethod(writer, "render", [
        text,
        new LingoRect(0, 0, Math.max(1, Number(width) | 0), Math.max(1, Number(height) | 0)),
      ]);
      return imageDataSummary(image);
    },
    objectWriterPreview: (objectId: string, propName: string, text: string, width = 245, height = 38) => {
      const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
      if (!objectList) return null;
      const object = propListLookup(objectList, objectId);
      if (!(object instanceof ScriptInstance)) {
        return { error: `object not found: ${objectId}` };
      }
      const writer = object.props.get(String(propName).toLowerCase());
      if (!(writer instanceof ScriptInstance) || !movie.runtime.hasHandler(writer, "render")) {
        return { error: `writer property not found: ${objectId}.${propName}`, value: summarizeValue(writer, 2) };
      }
      const image = movie.runtime.callMethod(writer, "render", [
        text,
        new LingoRect(0, 0, Math.max(1, Number(width) | 0), Math.max(1, Number(height) | 0)),
      ]);
      return imageDataSummary(image);
    },
    connectionCommand: (id: string, command: string) => {
      const objectList = objectManagerList(movie.runtime.getGlobal("gcore"));
      if (!objectList) return null;
      const connection = propListLookup(objectList, id);
      if (!(connection instanceof ScriptInstance)) return null;
      const pointer = connection.props.get("pcommandspntr");
      if (!(pointer instanceof LingoPropList)) return null;
      const value = pointer.getaProp(LingoSymbol.for("value"), lingoKeyEquals);
      if (!(value instanceof LingoPropList)) return null;
      return debugValue(value.getaProp(command, lingoKeyEquals));
    },
    spriteDebug: (n: number) => {
      const channel = movie.channels[Number(n) | 0];
      if (!channel) return null;
      const rect = movie.spriteBounds(channel.number);
      return {
        ...(summarizeSprite(channel, 4) as Record<string, unknown>),
        rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null,
      };
    },
    resolvedSpriteDebug: (n: number, includeImages = false) => {
      const channel = movie.channels[Number(n) | 0];
      return channel ? resolvedSpriteSummary(channel, Boolean(includeImages)) : null;
    },
    resolvedSprites: (query = "", includeImages = false) => {
      const needle = String(query ?? "").toLowerCase();
      return movie.channels
        .filter((channel) => {
          if (channel.puppet !== 1 || !channel.member) return false;
          if (!needle) return true;
          const haystack = [
            channel.number,
            channel.member.name,
            channel.member.type,
            debugValue(channel.id),
            channel.member.castName,
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        })
        .map((channel) => resolvedSpriteSummary(channel, Boolean(includeImages)));
    },
    rollover: () => debugValue(movie.runtime.theProp("rollover")),
    hitSprites: (x: number, y: number) => movie.spritesAt(Number(x), Number(y)).map((channel) => summarizeSprite(channel, 3)),
    inputSpriteAt: (x: number, y: number) => {
      const channel = movie.inputSpriteAt(Number(x), Number(y));
      if (!channel) return null;
      const rect = movie.spriteBounds(channel.number);
      return {
        ...(summarizeSprite(channel, 4) as Record<string, unknown>),
        rect: rect ? [rect.left, rect.top, rect.right, rect.bottom] : null,
        pixel: spritePixelAt(channel, Number(x), Number(y)),
      };
    },
    hitProbe,
    roomAssetBuffer: () => summarizeRoomAssetBuffer(getRoomAssetBuffer()),
    roomAssetBufferDiagnostics: (limit = 20) =>
      summarizeRoomAssetBufferDiagnostics(getRoomAssetBuffer(), movie.runtime, Math.max(1, Number(limit) | 0)),
    roomObjects: () => summarizeRoomObjects(movie.runtime.getGlobal("gcore"), movie.runtime),
    visualizer: (id: string) => summarizeVisualizer(movie.runtime.getGlobal("gcore"), id),
    resizeEngine: () => resizeSnapshot ?? resizeEngine?.currentSnapshot() ?? { enabled: false },
    customHotelView: customHotelViewDiagnostics,
  };
  setupQuickLoginPanel();

  let lastTick = performance.now();
  let lastRoomAssetPresentationHold = false;
  let lastFocusedSprite = Number(movie.keyboardFocusSprite) | 0;
  let lastCaretBlinkEpoch = Math.floor(performance.now() / 500);
  const step = (now: number): void => {
    rafCount += 1;
    const rafDelta = now - lastRafAt;
    lastRafAt = now;
    if (Number.isFinite(rafDelta) && rafDelta >= 0) {
      rafDeltas.push(rafDelta);
      if (rafDeltas.length > 240) rafDeltas.splice(0, rafDeltas.length - 240);
    }
    const interval = 1000 / movie.frameTempo;
    if (now - lastTick >= interval) {
      lastTick = now;
      movie.tick();
      renderDirty = true;
      if (resizeEngine?.needsFrameSync()) {
        resizeSnapshot = resizeEngine.apply("frame");
        syncPresentationUnderlays(resizeSnapshot);
        if (resizeSnapshot.changed) {
          renderDirty = true;
          renderer.markDirty();
        }
      }
      const marker = movie.markerName(movie.frame);
      statusEl.textContent = movie.haltedReason
        ? `HALTED at frame ${movie.frame}: ${movie.haltedReason}`
        : `frame ${movie.frame}${marker ? ` (${marker})` : ""} | tempo ${movie.frameTempo}fps`;
    }
    const focusedSprite = Number(movie.keyboardFocusSprite) | 0;
    const focusedSpriteChanged = focusedSprite !== lastFocusedSprite;
    if (focusedSpriteChanged) {
      lastFocusedSprite = focusedSprite;
      renderDirty = true;
    }
    const caretBlinkEpoch = Math.floor(now / 500);
    if (focusedSprite > 0 && caretBlinkEpoch !== lastCaretBlinkEpoch) {
      lastCaretBlinkEpoch = caretBlinkEpoch;
      renderDirty = true;
    }
    syncCustomHotelViewPresentation();
    const holdRoomAssets = shouldHoldRoomAssetPresentation(getRoomAssetBuffer());
    if (holdRoomAssets !== lastRoomAssetPresentationHold) {
      appendLog(
        "info",
        holdRoomAssets
          ? "room presentation hold: waiting for room asset placeholders to finalize"
          : "room presentation hold released: room asset placeholders finalized",
      );
      lastRoomAssetPresentationHold = holdRoomAssets;
      renderDirty = true;
    }
    if (!holdRoomAssets) {
      renderer.setRoomStagePresentation(currentRoomStagePresentation());
      if (renderDirty || renderer.needsSync()) {
        movie.prepareTextSpriteImages(focusedSprite);
        renderer.sync(movie.channels, focusedSprite);
        renderDirty = false;
      }
      if (userNameLabelsEnabled) {
        renderer.setUserNameLabels(userNameLabels());
      }
    } else {
      renderer.setRoomStagePresentation(null);
      renderer.setUserNameLabels([]);
      renderDirty = false;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function shouldHoldRoomAssetPresentation(buffer: ScriptInstance | null): boolean {
  if (!buffer) return false;
  const placeholders = instancePropValue(buffer, "pplaceholderlist");
  if (!(placeholders instanceof LingoPropList)) return false;
  const active = propListLookup(placeholders, "active");
  const item = propListLookup(placeholders, "item");
  const activeCount = active instanceof LingoPropList ? active.count() : 0;
  const itemCount = item instanceof LingoPropList ? item.count() : 0;
  return activeCount + itemCount > 0;
}

function resourceMemberIndex(gCore: LingoValue): LingoPropList | null {
  if (!(gCore instanceof ScriptInstance)) return null;
  const objectList = gCore.props.get("pobjectlist");
  if (!(objectList instanceof LingoPropList)) return null;
  const resourceManager = objectList.getaProp(LingoSymbol.for("resource_manager"), lingoKeyEquals);
  if (!(resourceManager instanceof ScriptInstance)) return null;
  const index = resourceManager.props.get("pallmemnumlist");
  return index instanceof LingoPropList ? index : null;
}

function objectManagerList(gCore: LingoValue): LingoPropList | null {
  if (!(gCore instanceof ScriptInstance)) return null;
  const objectList = gCore.props.get("pobjectlist");
  return objectList instanceof LingoPropList ? objectList : null;
}

function propListLookup(list: LingoPropList, key: string): LingoValue {
  const asString = list.getaProp(key, lingoKeyEquals);
  if (!(asString instanceof LingoVoid)) {
    return asString;
  }
  const symbolKey = key.startsWith("#") ? key.slice(1) : key;
  return list.getaProp(LingoSymbol.for(symbolKey), lingoKeyEquals);
}

function instancePropValue(instance: ScriptInstance, name: string): LingoValue | undefined {
  const key = name.toLowerCase();
  let target: ScriptInstance | null = instance;
  while (target) {
    if (target.props.has(key)) return target.props.get(key);
    const ancestor = target.props.get("ancestor");
    target = ancestor instanceof ScriptInstance ? ancestor : null;
  }
  return undefined;
}

function summarizeVariables(gCore: LingoValue, names: string[]): Record<string, unknown> {
  const objectList = objectManagerList(gCore);
  if (!objectList) return {};
  const manager = propListLookup(objectList, "#variable_manager");
  if (!(manager instanceof ScriptInstance)) return {};
  const itemList = instancePropValue(manager, "pitemlist");
  if (!(itemList instanceof LingoPropList)) return {};
  const result: Record<string, unknown> = {};
  for (const name of names) {
    result[name] = summarizeValue(propListLookup(itemList, name), 3);
  }
  return result;
}

function setupQuickLoginPanel(): void {
  const panel = document.getElementById("quick-login-panel");
  const emailInput = document.getElementById("quick-login-email") as HTMLInputElement | null;
  const passwordInput = document.getElementById("quick-login-password") as HTMLInputElement | null;
  const button = document.getElementById("quick-login-submit") as HTMLButtonElement | null;
  const message = document.getElementById("quick-login-message");
  if (!panel || !emailInput || !passwordInput || !button || !message) return;
  const params = new URLSearchParams(location.search);
  if (params.get("standalone") === "1") {
    panel.remove();
    return;
  }
  document.body.dataset.devQuickLogin = "1";
  emailInput.value = params.get("quickEmail") ?? localStorage.getItem("habbo.quick.email") ?? "";
  passwordInput.value = params.get("quickPassword") ?? localStorage.getItem("habbo.quick.password") ?? "";
  for (const input of [emailInput, passwordInput]) {
    input.addEventListener("keydown", (event) => event.stopPropagation());
    input.addEventListener("keyup", (event) => event.stopPropagation());
  }
  button.addEventListener("click", async () => {
    const engine = (window as unknown as {
      __engine?: { dev?: { login?: (email: string, password: string, delayMs?: number) => Promise<unknown> } };
    }).__engine;
    const login = engine?.dev?.login;
    if (!login) {
      message.textContent = "engine not ready";
      return;
    }
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      message.textContent = "enter credentials";
      return;
    }
    localStorage.setItem("habbo.quick.email", email);
    localStorage.setItem("habbo.quick.password", password);
    button.disabled = true;
    message.textContent = "sending login";
    try {
      await login(email, password, 10);
      message.textContent = "login sent";
    } catch (error) {
      message.textContent = String(error);
    } finally {
      button.disabled = false;
    }
  });
}

function summarizeVisualizer(gCore: LingoValue, id: string): unknown {
  const objectList = objectManagerList(gCore);
  if (!objectList) return null;
  const visualizer = propListLookup(objectList, id);
  if (!(visualizer instanceof ScriptInstance)) return null;
  const wrappedParts = instancePropValue(visualizer, "pwrappedparts");
  const spriteData = instancePropValue(visualizer, "pspritedata");
  return {
    id,
    spriteList: summarizeList(instancePropValue(visualizer, "pspritelist")),
    activeSprites: summarizePropList(instancePropValue(visualizer, "pactsprlist")),
    spriteDataCount: spriteData instanceof LingoList ? spriteData.count() : null,
    wrappedParts: summarizeWrappedParts(wrappedParts),
  };
}

function summarizeWrappedParts(value: LingoValue | undefined): unknown[] {
  if (!(value instanceof LingoPropList)) return [];
  return value.keys.map((key, index) => {
    const wrapper = value.values[index];
    if (!(wrapper instanceof ScriptInstance)) {
      return { key: debugValue(key), value: debugValue(wrapper) };
    }
    return {
      key: debugValue(key),
      object: wrapper.module.scriptName,
      imgMemberId: debugValue(instancePropValue(wrapper, "pimgmemberid")),
      typeDef: debugValue(instancePropValue(wrapper, "ptypedef")),
      sprite: summarizeSprite(instancePropValue(wrapper, "psprite")),
      locZ: debugValue(instancePropValue(wrapper, "plocz")),
      visualizerLocZ: debugValue(instancePropValue(wrapper, "pvisualizerlocz")),
      wrapperStatus: summarizeValue(instancePropValue(wrapper, "pwrapperstatus"), 2),
      offsets: summarizeValue(instancePropValue(wrapper, "poffsets"), 1),
      wrapId: debugValue(instancePropValue(wrapper, "pwrapid")),
      boundingRect: debugValue(instancePropValue(wrapper, "pboundingrect")),
      capturesEvents: debugValue(instancePropValue(wrapper, "pcapturesevents")),
      spriteProps: summarizeValue(instancePropValue(wrapper, "pspriteprops"), 2),
      bgColor: debugValue(instancePropValue(wrapper, "pbgcolor")),
      partList: summarizeListSample(instancePropValue(wrapper, "ppartlist"), 12),
    };
  });
}

function summarizeRoomAssetBuffer(buffer: ScriptInstance | null): unknown {
  if (!buffer) return null;
  const placeholders = instancePropValue(buffer, "pplaceholderlist");
  const activePlaceholders = placeholders instanceof LingoPropList
    ? propListLookup(placeholders, "active")
    : LINGO_VOID;
  const itemPlaceholders = placeholders instanceof LingoPropList
    ? propListLookup(placeholders, "item")
    : LINGO_VOID;
  return {
    object: buffer.module.scriptName,
    loadedCasts: summarizePropListSample(instancePropValue(buffer, "ploadedcasts")),
    queuedCasts: summarizePropListSample(instancePropValue(buffer, "pqueuedcasts")),
    classToCast: summarizePropListSample(instancePropValue(buffer, "pclasstocast")),
    furnitureCastList: summarizeListSample(instancePropValue(buffer, "pfurniturecastlist")),
    placeholders: {
      active: activePlaceholders instanceof LingoPropList ? activePlaceholders.count() : 0,
      item: itemPlaceholders instanceof LingoPropList ? itemPlaceholders.count() : 0,
    },
  };
}

function summarizeRoomAssetBufferDiagnostics(
  buffer: ScriptInstance | null,
  runtime: Runtime,
  limit: number,
): unknown {
  if (!buffer) return null;
  const placeholders = instancePropValue(buffer, "pplaceholderlist");
  const sourceList = (typeName: "active" | "item"): LingoPropList | null => {
    if (!(placeholders instanceof LingoPropList)) return null;
    const value = propListLookup(placeholders, typeName);
    return value instanceof LingoPropList ? value : null;
  };
  const safeCall = (method: string, args: LingoValue[]): LingoValue => {
    try {
      if (!runtime.hasHandler(buffer, method)) return LINGO_VOID;
      return runtime.callMethod(buffer, method, args);
    } catch (error) {
      return String(error);
    }
  };
  const summarizePlaceholderList = (typeName: "active" | "item"): unknown[] => {
    const list = sourceList(typeName);
    if (!list) return [];
    return list.keys.slice(0, limit).map((key, index) => {
      const object = list.values[index];
      if (!(object instanceof LingoPropList)) {
        return { key: debugValue(key), value: summarizeValue(object, 1) };
      }
      const classValue = propListValue(object, "class");
      const typeValue = propListValue(object, "type");
      const className = safeCall("getclassname", [classValue, typeValue]);
      const castName = safeCall("getcastforclass", [className]);
      const ready = safeCall("objectfurnitureready", [object, typeName]);
      const canFinalize = safeCall("canfinalizeplaceholder", [object, typeName, castName]);
      const candidates = placeholderMemberCandidates(buffer, runtime, object, typeName, className);
      return {
        key: debugValue(key),
        id: debugValue(propListValue(object, "id")),
        sourceClass: debugValue(classValue),
        sourceType: debugValue(typeValue),
        className: debugValue(className),
        castName: debugValue(castName),
        ready: debugValue(ready),
        canFinalize: debugValue(canFinalize),
        direction: summarizeValue(propListValue(object, "direction"), 1),
        dimensions: summarizeValue(propListValue(object, "dimensions"), 1),
        members: candidates,
      };
    });
  };
  return {
    object: buffer.module.scriptName,
    scale: debugValue(safeCall("getcurrentroomscale", [])),
    furnitureCastList: summarizeListSample(instancePropValue(buffer, "pfurniturecastlist"), 80),
    loadedCasts: summarizePropListSample(instancePropValue(buffer, "ploadedcasts"), 80),
    queuedCasts: summarizePropListSample(instancePropValue(buffer, "pqueuedcasts"), 80),
    activePlaceholders: summarizePlaceholderList("active"),
    itemPlaceholders: summarizePlaceholderList("item"),
  };
}

function propListValue(list: LingoPropList, key: string): LingoValue {
  const bySymbol = list.getaProp(LingoSymbol.for(key), lingoKeyEquals);
  if (!(bySymbol instanceof LingoVoid)) return bySymbol;
  return list.getaProp(key, lingoKeyEquals);
}

function placeholderMemberCandidates(
  buffer: ScriptInstance,
  runtime: Runtime,
  object: LingoPropList,
  typeName: "active" | "item",
  className: LingoValue,
): unknown[] {
  const callExists = (name: string): unknown => {
    try {
      return debugValue(runtime.callMethod(buffer, "memberreferenceexists", [name]));
    } catch (error) {
      return String(error);
    }
  };
  const classText = typeof className === "string" ? className : "";
  if (!classText) return [];
  if (typeName === "item") {
    const direction = debugValue(runtime.callMethod(buffer, "getitemdirectionname", [object]));
    const directionText = typeof direction === "string" ? direction : String(direction);
    const typeValue = propListValue(object, "type");
    const typeText = typeof typeValue === "string" ? typeValue : "";
    const names = [
      `${directionText} ${classText}`,
      `${directionText} ${classText}_a_0`,
      typeText ? `${directionText} ${classText}_${typeText}` : "",
    ].filter(Boolean);
    return names.map((name) => ({ name, exists: callExists(name) }));
  }
  const dimensions = propListValue(object, "dimensions");
  const directionValue = propListValue(object, "direction");
  const width = dimensions instanceof LingoList && dimensions.items.length >= 1 ? Number(dimensions.items[0]) || 1 : 1;
  const height = dimensions instanceof LingoList && dimensions.items.length >= 2 ? Number(dimensions.items[1]) || 1 : 1;
  const direction =
    directionValue instanceof LingoList && directionValue.items.length > 0
      ? Number(directionValue.items[0]) || 0
      : Number(directionValue) || 0;
  const base = `${classText}_a_0_${width}_${height}`;
  const names = [
    `${base}_${direction}_0`,
    `${base}_${direction}_1`,
    `${base}_0_0`,
    `${classText}.data`,
    `${classText}.props`,
  ];
  return names.map((name) => ({ name, exists: callExists(name) }));
}

function summarizeRoomObjects(gCore: LingoValue, runtime: Runtime): unknown {
  const objectList = objectManagerList(gCore);
  if (!objectList) return null;
  const roomComponent = propListLookup(objectList, "#room_component");
  if (!(roomComponent instanceof ScriptInstance)) return null;
  const prop = (object: ScriptInstance, name: string): LingoValue => {
    try {
      return runtime.getProp(object, name);
    } catch {
      return instancePropValue(object, name) ?? LINGO_VOID;
    }
  };
  const summarizeObjectList = (propName: string): unknown[] => {
    const list = prop(roomComponent, propName);
    if (!(list instanceof LingoPropList)) return [];
    return list.keys.map((key, index) => {
      const object = list.values[index];
      if (!(object instanceof ScriptInstance)) {
        return { key: debugValue(key), value: debugValue(object) };
      }
      const sprites = prop(object, "psprlist");
      return {
        key: debugValue(key),
        object: object.module.scriptName,
        id: debugValue(prop(object, "id")),
        name: debugValue(prop(object, "pname")),
        custom: debugValue(prop(object, "pcustom")),
        sex: debugValue(prop(object, "psex")),
        badge: debugValue(prop(object, "pbadge")),
        class: debugValue(prop(object, "pclass")),
        type: debugValue(prop(object, "ptype")),
        direction: summarizeValue(prop(object, "pdirection"), 2),
        dimensions: summarizeValue(prop(object, "pdimensions"), 2),
        formatVersion: debugValue(prop(object, "pformatver")),
        wall: [debugValue(prop(object, "pwallx")), debugValue(prop(object, "pwally"))],
        local: [debugValue(prop(object, "plocalx")), debugValue(prop(object, "plocaly"))],
        loc: [
          debugValue(prop(object, "plocx")),
          debugValue(prop(object, "plocy")),
          debugValue(prop(object, "ploch")),
        ],
        sprites: sprites instanceof LingoList
          ? {
              count: sprites.count(),
              items: sprites.items.map((sprite) =>
                sprite instanceof SpriteChannel
                  ? {
                      n: sprite.number,
                      member: sprite.member?.name ?? null,
                      loc: [sprite.locH, sprite.locV],
                      size: [sprite.width, sprite.height],
                      z: sprite.locZ,
                      visible: sprite.visible,
                    }
                  : debugValue(sprite),
              ),
            }
          : summarizeValue(sprites, 0),
      };
    });
  };
  return {
    users: summarizeObjectList("puserobjlist"),
    active: summarizeObjectList("pactiveobjlist"),
    passive: summarizeObjectList("ppassiveobjlist"),
    items: summarizeObjectList("pitemobjlist"),
  };
}

function summarizePropListSample(value: LingoValue | undefined, limit = 30): unknown {
  if (!(value instanceof LingoPropList)) return { count: 0, entries: [] };
  return {
    count: value.count(),
    entries: value.keys.slice(0, limit).map((key, index) => ({
      key: debugValue(key),
      value: debugValue(value.values[index]),
    })),
  };
}

function summarizeListSample(value: LingoValue | undefined, limit = 30): unknown {
  if (!(value instanceof LingoList)) return { count: 0, items: [] };
  return {
    count: value.count(),
    items: value.items.slice(0, limit).map(debugValue),
  };
}

function summarizeList(value: LingoValue | undefined): unknown[] {
  if (value instanceof LingoList) return value.items.map((entry) => summarizeSprite(entry));
  if (value instanceof LingoPropList) return value.values.map((entry) => summarizeSprite(entry));
  return [];
}

function summarizePropList(value: LingoValue | undefined): unknown[] {
  if (!(value instanceof LingoPropList)) return [];
  return value.keys.map((key, index) => ({
    key: debugValue(key),
    sprite: summarizeSprite(value.values[index]),
  }));
}

function summarizeSprite(value: LingoValue | undefined, depth = 1): unknown {
  if (!(value instanceof SpriteChannel)) return debugValue(value);
  return {
    n: value.number,
    member: value.member?.name ?? null,
    memberNumber: value.member?.number ?? null,
    castNum: value.member?.slotNumber ?? 0,
    castLibNum: value.member?.castNumber ?? value.castLibNum,
    loc: [value.locH, value.locV],
    size: [value.width, value.height],
    z: value.locZ,
    id: debugValue(value.id),
    ink: value.ink,
    blend: value.blend,
    flipH: value.flipH,
    flipV: value.flipV,
    rotation: value.rotation,
    skew: value.skew,
    regPoint: value.member ? [value.member.regX, value.member.regY] : null,
    scripts: value.scriptInstanceList.items.map((entry) => summarizeValue(entry, depth)),
  };
}

function debugValue(value: LingoValue | undefined): unknown {
  if (value instanceof LingoSymbol) return `#${value.name}`;
  if (value instanceof SpriteChannel) return `(sprite ${value.number})`;
  if (value instanceof ScriptInstance) return `<offspring "${value.module.scriptName}">`;
  if (value && typeof value === "object" && "lingoToString" in value && typeof value.lingoToString === "function") {
    return value.lingoToString();
  }
  return value;
}

function summarizeValue(value: LingoValue | undefined, depth: number): unknown {
  if (depth <= 0) return debugValue(value);
  if (value instanceof LingoList) {
    return {
      type: "list",
      count: value.count(),
      items: value.items.slice(0, 20).map((entry) => summarizeValue(entry, depth - 1)),
    };
  }
  if (value instanceof LingoPropList) {
    return {
      type: "propList",
      count: value.count(),
      entries: value.keys.slice(0, 20).map((key, index) => ({
        key: debugValue(key),
        value: summarizeValue(value.values[index], depth - 1),
      })),
    };
  }
  if (value instanceof ScriptInstance) {
    return summarizeObject(value, depth - 1);
  }
  return debugValue(value);
}

function summarizeObject(value: LingoValue | undefined, depth: number): unknown {
  if (!(value instanceof ScriptInstance)) return debugValue(value);
  const summary: Record<string, unknown> = {
    object: value.module.scriptName,
    props: Object.fromEntries(
      Array.from(value.props.entries()).map(([key, entry]) => [key, summarizeValue(entry, depth)]),
    ),
  };
  if (!(value.ancestor instanceof LingoVoid) && depth > 0) {
    summary.ancestor = summarizeObject(value.ancestor, depth - 1);
  }
  return summary;
}

function coerceDebugValue(value: unknown): LingoValue {
  if (typeof value === "string") {
    return value.startsWith("#") ? LingoSymbol.for(value.slice(1)) : value;
  }
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return new LingoList(value.map((entry) => coerceDebugValue(entry)));
  if (value && typeof value === "object") {
    const props = new LingoPropList();
    for (const [key, entry] of Object.entries(value)) {
      props.setaProp(
        key.startsWith("#") ? LingoSymbol.for(key.slice(1)) : key,
        coerceDebugValue(entry),
        lingoKeyEquals,
      );
    }
    return props;
  }
  return value instanceof LingoVoid ? value : 0;
}

boot().catch((error) => {
  statusEl.textContent = `boot failed: ${String(error)}`;
  appendLog("error", String(error));
});
