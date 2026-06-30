import { createRequire } from "node:module";
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(__dirname, "..");
const portableParent = resolve(workspace, "dist", "portable");
const portableRoot = join(portableParent, "HabbpyV4");
const portableClientsRoot = join(portableRoot, "clients");
const preservePortableClients = process.env.HABBPY_V4_PRESERVE_PORTABLE_CLIENTS === "1";
const appRoot = join(portableRoot, "resources", "app");
const packagedEngineRoot = join(portableRoot, "resources", "engine");
const appName = "Habbpy v4.exe";

function assertInside(parent, target) {
  const normalizedParent = resolve(parent);
  const normalizedTarget = resolve(target);
  if (normalizedTarget !== normalizedParent && !normalizedTarget.startsWith(normalizedParent + sep)) {
    throw new Error(`Refusing to write outside ${normalizedParent}: ${normalizedTarget}`);
  }
}

async function assertPathExists(path, label, hint = "run npm run build first") {
  try {
    await stat(path);
  } catch {
    throw new Error(`${label} is missing at ${path}; ${hint}.`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveShocklessEngineRoot() {
  if (process.env.HABBPY_V4_SHOCKLESS_ENGINE_ROOT) {
    const override = resolve(process.env.HABBPY_V4_SHOCKLESS_ENGINE_ROOT);
    if (await isShocklessEngineBuildRoot(override)) return override;
    throw new Error(
      `HABBPY_V4_SHOCKLESS_ENGINE_ROOT points at ${override}, but that folder does not contain the built Shockless engine renderer and standalone importer.`,
    );
  }
  const candidates = [
    join(workspace, "engine"),
    resolve(workspace, "..", "habbo-origins-engine"),
    ...ancestorSiblingCandidates("habbo-origins-engine"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (await isShocklessEngineBuildRoot(resolved)) return resolved;
  }
  throw new Error(
    "Shockless engine build/importer was not found. Build the local engine folder first, or set HABBPY_V4_SHOCKLESS_ENGINE_ROOT to the intended engine root.",
  );
}

async function isShocklessEngineBuildRoot(root) {
  return (
    (await pathExists(join(root, "dist", "index.html"))) &&
    (await pathExists(join(root, "standalone", "dist", "main", "cli", "profile-import.js"))) &&
    (await pathExists(join(root, "standalone", "resources", "projectorrays", "projectorrays-0.2.0.exe")))
  );
}

function ancestorSiblingCandidates(...parts) {
  const candidates = new Set();
  for (let current = workspace; dirname(current) !== current; current = dirname(current)) {
    candidates.add(join(dirname(current), ...parts));
  }
  return [...candidates];
}

const electronExecutable = require("electron");
const electronDist = dirname(electronExecutable);
const builtMain = join(workspace, "dist", "main");
const builtRenderer = join(workspace, "dist", "renderer");
const pluginTemplateRoot = join(workspace, "src", "plugins", "template");
const pluginSourceRoot = join(workspace, "src", "plugins");
const bundledPluginsRoot = join(workspace, "examples", "plugins");
const premadePluginsRoot = join(workspace, "examples", "premade-plugins");
const shocklessEngineRoot = await resolveShocklessEngineRoot();
const shocklessStandaloneRoot = join(shocklessEngineRoot, "standalone");

assertInside(resolve(workspace, "dist"), portableRoot);
await assertPathExists(join(builtMain, "main", "main.js"), "Built main process");
await assertPathExists(join(builtRenderer, "index.html"), "Built renderer");
await assertPathExists(join(pluginTemplateRoot, "habbpy.plugin.json"), "Plugin template manifest");
await assertPathExists(join(pluginTemplateRoot, "plugin.js"), "Plugin template entry");
await assertPathExists(join(bundledPluginsRoot, "welcome-message", "habbpy.plugin.json"), "Bundled Welcome Message plugin manifest");
await assertPathExists(join(bundledPluginsRoot, "welcome-message", "plugin.js"), "Bundled Welcome Message plugin entry");
await assertPathExists(join(premadePluginsRoot, "README.txt"), "Premade plugin source README");
await assertPathExists(join(premadePluginsRoot, "room", "habbpy.plugin.json"), "Premade Room plugin manifest");
await assertPathExists(join(premadePluginsRoot, "packet-log", "plugin.js"), "Premade Packet Log plugin entry");
await assertPathExists(join(shocklessEngineRoot, "dist", "index.html"), "Shockless engine renderer build", "run npm --prefix engine run build first");
await assertPathExists(
  join(shocklessStandaloneRoot, "dist", "main", "cli", "profile-import.js"),
  "Shockless standalone profile importer",
  "run npm --prefix engine/standalone run compile first",
);
await assertPathExists(
  join(shocklessStandaloneRoot, "resources", "compiler", "profile-script-compiler.mjs"),
  "Shockless profile script compiler",
  "run npm --prefix engine/standalone run compile first",
);

await cleanupPreserveTempDirs();
await clearPortableRoot();
await mkdir(portableParent, { recursive: true });
await cp(electronDist, portableRoot, { recursive: true, force: true });

const copiedElectron = join(portableRoot, basename(electronExecutable));
const appExecutable = join(portableRoot, appName);
if (copiedElectron !== appExecutable) {
  await rm(appExecutable, { force: true });
  await rename(copiedElectron, appExecutable);
}

await mkdir(appRoot, { recursive: true });
await cp(builtMain, join(appRoot, "dist", "main"), { recursive: true, force: true });
await removeUnbackedBuiltPluginDirectories(join(appRoot, "dist", "main", "plugins"), pluginSourceRoot);
await cp(builtRenderer, join(appRoot, "dist", "renderer"), { recursive: true, force: true });
await cp(pluginTemplateRoot, join(appRoot, "dist", "plugins", "template"), { recursive: true, force: true });
await cp(bundledPluginsRoot, join(portableRoot, "plugins"), { recursive: true, force: true });
await cp(premadePluginsRoot, join(portableRoot, "plugins", "_premade-modules"), { recursive: true, force: true });
await cp(join(shocklessEngineRoot, "dist"), join(packagedEngineRoot, "dist"), { recursive: true, force: true });
await cp(join(shocklessStandaloneRoot, "dist", "main"), join(packagedEngineRoot, "standalone", "dist", "main"), {
  recursive: true,
  force: true,
});
await cp(join(shocklessStandaloneRoot, "resources"), join(packagedEngineRoot, "standalone", "resources"), {
  recursive: true,
  force: true,
});
await cp(join(shocklessStandaloneRoot, "package.json"), join(packagedEngineRoot, "standalone", "package.json"), { force: true });
await cp(join(shocklessStandaloneRoot, "resources", "relay"), join(portableRoot, "resources", "relay"), {
  recursive: true,
  force: true,
});

const rootPackage = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
const standalonePackage = JSON.parse(await readFile(join(shocklessStandaloneRoot, "package.json"), "utf8"));
await writeFile(
  join(appRoot, "package.json"),
  `${JSON.stringify(
    {
      name: rootPackage.name,
      version: rootPackage.version,
      private: true,
      type: "module",
      main: rootPackage.main,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

for (const resource of standalonePackage.build?.extraResources ?? []) {
  if (!resource || typeof resource.from !== "string" || typeof resource.to !== "string") continue;
  const normalizedFrom = resource.from.replaceAll("\\", "/");
  if (!normalizedFrom.startsWith("node_modules/")) continue;
  const fromPath = join(shocklessStandaloneRoot, resource.from);
  const toPath = join(packagedEngineRoot, "standalone", "resources", resource.to);
  await assertPathExists(fromPath, `Shockless standalone resource dependency ${resource.from}`);
  await cp(fromPath, toPath, { recursive: true, force: true });
}

await writeFile(
  join(portableRoot, "README.txt"),
  "Run Habbpy v4.exe to start the portable Habbpy v4 shell. Use Import/Build Client to select a compiled Habbo client folder or an existing Shockless profile. New playable profiles are stored in clients/ beside the EXE. Bundled user plugins live in plugins/ and can be enabled from Plugin Manager. Readable premade module plugin sources live in plugins/_premade-modules/.\n",
  "utf8",
);

const summary = {
  portableRoot: relative(workspace, portableRoot),
  executable: relative(workspace, appExecutable),
  appMain: relative(workspace, join(appRoot, rootPackage.main)),
  pluginTemplate: relative(workspace, join(appRoot, "dist", "plugins", "template", "habbpy.plugin.json")),
  bundledPlugins: relative(workspace, join(portableRoot, "plugins")),
  premadePlugins: relative(workspace, join(portableRoot, "plugins", "_premade-modules")),
  shocklessEngineRoot: relative(workspace, shocklessEngineRoot),
  engine: relative(workspace, join(packagedEngineRoot, "dist", "index.html")),
  importer: relative(workspace, join(packagedEngineRoot, "standalone", "dist", "main", "cli", "profile-import.js")),
  relayResources: relative(workspace, join(portableRoot, "resources", "relay")),
};
console.log(JSON.stringify(summary, null, 2));

async function clearPortableRoot() {
  if (!(await pathExists(portableRoot))) return;
  const entries = await readdir(portableRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => !preservePortableClients || entry.name.toLowerCase() !== "clients")
      .map((entry) => rm(join(portableRoot, entry.name), { recursive: true, force: true })),
  );
  if (!preservePortableClients) {
    await rm(portableClientsRoot, { recursive: true, force: true });
  }
}

async function cleanupPreserveTempDirs() {
  if (!(await pathExists(portableParent))) return;
  const entries = await readdir(portableParent, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".preserve-HabbpyV4-"))
      .map((entry) => rm(join(portableParent, entry.name), { recursive: true, force: true })),
  );
}

async function removeUnbackedBuiltPluginDirectories(builtPluginRoot, sourcePluginRoot) {
  if (!(await pathExists(builtPluginRoot))) return;
  const entries = await readdir(builtPluginRoot, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        if (await pathExists(join(sourcePluginRoot, entry.name))) return;
        await rm(join(builtPluginRoot, entry.name), { recursive: true, force: true });
      }),
  );
}
