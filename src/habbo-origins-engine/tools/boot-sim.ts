/**
 * Headless boot simulator: runs the habbo.dir entry movie exactly like the
 * browser harness but in Node, reading manifests straight from the donor
 * tree. Prints the movie log, put output, and unsupported features.
 *
 * Usage: npx tsx tools/boot-sim.ts [tickCount]
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DirectorMovie, MovieManifest } from "../src/director/Movie";
import { CastRegistry, type CastManifests } from "../src/director/members";
import {
  externalMembersFromGeneratedScripts,
  externalMembersFromVisuals,
  releaseArray,
  type VisualLayoutRecord,
} from "../src/habbo/runtimeData";
import { origins306ExternalParams } from "../src/habbo/launchParams";
import { generatedScripts } from "../generated/scripts/registry";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(repoRoot, "engine.config.json"), "utf8")) as {
  runtimeDataRoot: string;
  originsClientRoot: string;
};

const manifest = JSON.parse(
  readFileSync(join(config.runtimeDataRoot, "release306-projectorrays-manifest.json"), "utf8"),
) as MovieManifest;
const textFieldsRaw = JSON.parse(
  readFileSync(join(config.runtimeDataRoot, "projectorrays-text-fields.release306.json"), "utf8"),
);
const externalTextFieldsRaw = JSON.parse(
  readFileSync(join(config.runtimeDataRoot, "external-cast-text-fields.release306.json"), "utf8"),
);
const externalTextFieldSupplementRaw = JSON.parse(
  readFileSync(join(repoRoot, "generated/runtime-data/external-cast-text-fields-supplement.release306.json"), "utf8"),
);
const bitmapsRaw = JSON.parse(
  readFileSync(join(config.runtimeDataRoot, "external-bitmap-assets.release306.json"), "utf8"),
);
const visualLayoutsRaw = JSON.parse(
  readFileSync(join(config.runtimeDataRoot, "external-cast-visual-layout-index.release306.json"), "utf8"),
);

const members = new CastRegistry(
  {
    movie: manifest,
    textFields: [
      ...releaseArray<CastManifests["textFields"][number]>(textFieldsRaw, "fields"),
      ...releaseArray<CastManifests["textFields"][number]>(externalTextFieldsRaw, "fields"),
      ...releaseArray<CastManifests["textFields"][number]>(externalTextFieldSupplementRaw, "fields"),
    ],
    bitmaps: releaseArray<CastManifests["bitmaps"][number]>(bitmapsRaw, "assets"),
    externalMembers: [
      ...externalMembersFromVisuals(releaseArray<VisualLayoutRecord>(visualLayoutsRaw, "visuals")),
      ...externalMembersFromGeneratedScripts(generatedScripts),
    ],
  },
  "/origins-data/assets/",
);
members.loadCast("Internal");
members.loadCast("fuse_client");

const movie = new DirectorMovie(
  manifest,
  {
    log: (kind, text) => console.log(`[${kind}] ${text}`),
  },
  async () => {}, // preload resolves immediately in the simulator
  async (url) => {
    // Map the client base URL onto the local distribution folder.
    const rest = url.replace(/^\/origins-data\/client\//, "");
    return readFileSync(join(config.originsClientRoot, rest), "latin1");
  },
  members,
  () => {},
  "/origins-data/client/",
  origins306ExternalParams(),
);

for (const entry of generatedScripts) {
  movie.runtime.register(entry.module, entry.castFile, { memberNumber: entry.memberNumber });
}

for (const name of (process.env.TRACE ?? "").split(",").filter(Boolean)) {
  movie.runtime.traceHandlers.add(name.toLowerCase());
}

movie.start();
const ticks = Number(process.argv[2] ?? 12);
for (let i = 0; i < ticks; i += 1) {
  // Let the (instant) preload promise settle between ticks.
  await new Promise((resolve) => setTimeout(resolve, 1));
  movie.tick();
}
console.log(`--- frame ${movie.frame}, errors ${movie.errorCount} ---`);

// Active sprite channels (what the renderer would draw).
let active = 0;
for (const channel of movie.channels) {
  if (channel.puppet === 1 && channel.member) {
    active += 1;
    if (active <= 12) {
      const bmp = channel.member.bitmap;
      console.log(
        `  sprite ${channel.number}: member="${channel.member.name}" type=${channel.member.type} ` +
          `bitmap=${bmp ? `${bmp.width}x${bmp.height} png=${bmp.pngUrl ? "yes" : "NO"}` : "none"} ` +
          `loc=(${channel.locH},${channel.locV}) z=${channel.locZ} vis=${channel.visible}`,
      );
    }
  }
}
console.log(`active puppet sprites with members: ${active}`);

// Inspect the variable manager's parsed item list (diagnostic).
import { ScriptInstance } from "../src/director/Runtime";
import { LingoPropList, LingoSymbol } from "../src/director/values";
import { lingoEquals } from "../src/director/ops";
const gCore = movie.runtime.getGlobal("gcore");
if (gCore instanceof ScriptInstance) {
  const objectList = gCore.props.get("pobjectlist");
  if (objectList instanceof LingoPropList) {
    // Core thread state (boot progression indicator)
    const threadManager = objectList.getaProp(LingoSymbol.for("thread_manager"), lingoEquals);
    if (threadManager instanceof ScriptInstance) {
      const threads = movie.runtime.getProp(threadManager, "pthreadlist");
      if (threads instanceof LingoPropList) {
        for (let i = 1; i <= threads.count(); i += 1) {
          const thread = threads.getAt(i);
          if (thread instanceof ScriptInstance) {
            const component = thread.props.get("pcomponent");
            const state =
              component instanceof ScriptInstance
                ? movie.runtime.getProp(component, "pstate")
                : "(no component)";
            console.log(`thread ${String(threads.getPropAt(i))}: state=${JSON.stringify(state)}`);
          }
        }
      }
    }
    const variableManager = objectList.getaProp(LingoSymbol.for("variable_manager"), lingoEquals);
    if (variableManager instanceof ScriptInstance) {
      const items = movie.runtime.getProp(variableManager, "pitemlist");
      console.log("instance script:", variableManager.module.scriptName);
      let chain = variableManager as ScriptInstance | null;
      while (chain) {
        console.log(
          `  props of ${chain.module.scriptName}:`,
          [...chain.props.keys()].join(", ") || "(none)",
        );
        const ancestor = chain.props.get("ancestor");
        chain = ancestor instanceof ScriptInstance ? ancestor : null;
      }
      if (items instanceof LingoPropList) {
        console.log(`variables parsed: ${items.count()}`);
        console.log(
          "keys:",
          items.keys.slice(0, 8).map((key) => String(key)).join(" | "),
        );
        console.log(
          "tooltip.active =",
          JSON.stringify(items.getaProp("tooltip.active", lingoEquals)),
        );
      } else {
        console.log("pItemList is not a propList:", items?.constructor?.name);
      }
    } else {
      console.log("variable_manager instance not found");
    }
    const resourceManager = objectList.getaProp(LingoSymbol.for("resource_manager"), lingoEquals);
    if (resourceManager instanceof ScriptInstance) {
      const index = movie.runtime.getProp(resourceManager, "pallmemnumlist");
      if (index instanceof LingoPropList) {
        console.log(`resource members indexed: ${index.count()}`);
        for (const name of [
          "Object Base Class",
          "Figure System Class",
          "Figure Data Class",
          "Login Component Class",
        ]) {
          console.log(`${name} -> ${JSON.stringify(index.getaProp(name, lingoEquals))}`);
        }
      } else {
        console.log("Resource Manager pAllMemNumList is not a propList");
      }
    } else {
      console.log("resource_manager instance not found");
    }
  } else {
    console.log("gCore.pObjectList is not a propList");
  }
} else {
  console.log("gCore not an instance:", typeof gCore);
}
