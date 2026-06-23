import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPinnedPlugin, plugins, pluginSortValue } from "../plugins/registry.js";
import type {
  PluginCreateRequest,
  PluginDefinition,
  PluginEntrySourceResult,
  PluginInstallResult,
  PluginLoadError,
  PluginManifest,
  PluginPermission,
  PluginRegistryState,
  PluginUiSurface,
} from "../shared/plugin.js";
import { defaultSensitiveClientHeaders, type PluginRelayPolicy } from "../shared/pluginRelayHooks.js";

const STORE_DIR = "HabbpyV4";
const PLUGIN_DIR = "plugins";
const SETTINGS_FILE = "settings.json";
const MANIFEST_FILE = "habbpy.plugin.json";
const REGISTRY_VERSION = 1;

const allowedCategories = new Set(["session", "room", "user", "inventory", "automation", "social", "developer"]);
const allowedPermissions = new Set<PluginPermission>([
  "ui.panel",
  "ui.status",
  "ui.overlay",
  "console.commands",
  "engine.snapshot",
  "engine.control",
  "client.rights",
  "events.room",
  "events.chat",
  "events.packet",
  "events.session",
  "actions.avatar",
  "actions.social",
  "actions.fishing",
  "actions.furni",
  "actions.plants",
  "actions.wallItems",
  "chat.send",
  "storage",
  "packet.read",
  "packet.inject",
  "packet.intercept",
  "packet.intercept.sensitive",
]);
const MAX_PLUGIN_ENTRY_BYTES = 512 * 1024;
const obviousPrivateFilePattern = /(^goal\.md$|multiclient-accounts|password|credential|secret|token|webhook)/i;

interface StoredPluginSettings {
  readonly version: number;
  readonly enabledById: Record<string, boolean>;
  readonly uiSurfaceEnabledByPluginId: Record<string, Record<string, boolean>>;
  readonly permissionGrants: Record<string, readonly PluginPermission[]>;
}

interface DiscoveryResult {
  readonly plugins: readonly PluginDefinition[];
  readonly errors: readonly PluginLoadError[];
}

export class PluginManager {
  constructor(private readonly appDataPath: string) {}

  state(message = "Plugin manager ready."): PluginRegistryState {
    const discovered = this.discoverUserPlugins();
    const allPlugins = this.sortedPlugins([...plugins, ...discovered.plugins]);
    const stored = this.readSettings();
    const enabledById = this.enabledState(allPlugins, stored);
    const uiSurfaceEnabledByPluginId = this.surfaceState(allPlugins, stored);
    return {
      plugins: allPlugins,
      enabledById,
      uiSurfaceEnabledByPluginId,
      pinnedPluginIds: allPlugins.filter(isPinnedPlugin).map((plugin) => plugin.id),
      userPluginRoot: this.userPluginRoot(),
      portablePluginRoot: this.portablePluginRoot(),
      loadErrors: discovered.errors,
      message,
    };
  }

  setPluginEnabled(pluginId: string, enabled: boolean): PluginRegistryState {
    const current = this.state();
    const plugin = current.plugins.find((entry) => entry.id === pluginId);
    if (!plugin) return this.state(`Plugin not found: ${pluginId}`);
    if (isPinnedPlugin(plugin) && !enabled) return this.state(`${plugin.name} is pinned and cannot be disabled.`);
    const stored = this.readSettings();
    this.writeSettings({
      ...stored,
      enabledById: {
        ...stored.enabledById,
        [pluginId]: enabled,
      },
    });
    return this.state(`${plugin.name} ${enabled ? "enabled" : "disabled"}.`);
  }

  setPluginSurfaceEnabled(pluginId: string, surfaceId: string, enabled: boolean): PluginRegistryState {
    const current = this.state();
    const plugin = current.plugins.find((entry) => entry.id === pluginId);
    const surface = plugin?.uiSurfaces.find((entry) => entry.id === surfaceId);
    if (!plugin || !surface) return this.state(`Plugin surface not found: ${pluginId}.${surfaceId}`);
    const stored = this.readSettings();
    this.writeSettings({
      ...stored,
      uiSurfaceEnabledByPluginId: {
        ...stored.uiSurfaceEnabledByPluginId,
        [pluginId]: {
          ...stored.uiSurfaceEnabledByPluginId[pluginId],
          [surfaceId]: enabled,
        },
      },
    });
    return this.state(`${plugin.name} ${surface.label} ${enabled ? "enabled" : "disabled"}.`);
  }

  reload(): PluginRegistryState {
    return this.state("Plugins reloaded.");
  }

  readPluginEntrySource(pluginId: string): PluginEntrySourceResult {
    const id = String(pluginId ?? "").trim();
    const state = this.state();
    const plugin = state.plugins.find((entry) => entry.id === id && entry.origin === "user");
    if (!plugin) return { ok: false, pluginId: id, source: null, message: `User plugin not found: ${id}` };
    if (state.enabledById[plugin.id] === false) {
      return { ok: false, pluginId: plugin.id, source: null, message: `${plugin.name} is disabled.` };
    }
    if (!plugin.entry || !plugin.pluginRoot) {
      return { ok: false, pluginId: plugin.id, source: null, message: `${plugin.name} has no entry file.` };
    }
    const entryPath = safePluginPath(plugin.pluginRoot, relative(plugin.pluginRoot, plugin.entry));
    if (!entryPath || entryPath !== plugin.entry || !existsSync(entryPath)) {
      return { ok: false, pluginId: plugin.id, source: null, message: `${plugin.name} entry is no longer valid.` };
    }
    const entryStats = statSync(entryPath);
    if (!entryStats.isFile()) {
      return { ok: false, pluginId: plugin.id, source: null, message: `${plugin.name} entry is not a file.` };
    }
    if (entryStats.size > MAX_PLUGIN_ENTRY_BYTES) {
      return { ok: false, pluginId: plugin.id, source: null, message: `${plugin.name} entry is larger than the 512 KB host limit.` };
    }
    return {
      ok: true,
      pluginId: plugin.id,
      source: readFileSync(entryPath, "utf8"),
      message: `${plugin.name} entry loaded.`,
    };
  }

  relayPolicy(): PluginRelayPolicy {
    const state = this.state();
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      sensitiveClientHeaders: defaultSensitiveClientHeaders(),
      grants: state.plugins
        .filter((plugin) => state.enabledById[plugin.id] !== false)
        .filter((plugin) => plugin.permissions?.some((permission) => permission.startsWith("packet.")))
        .map((plugin) => ({
          pluginId: plugin.id,
          permissions: plugin.permissions ?? [],
        })),
    };
  }

  createFromTemplate(request: PluginCreateRequest): PluginInstallResult {
    const id = sanitizePluginId(request.id);
    const name = String(request.name ?? "").trim() || titleFromPluginId(id);
    if (!id) return { ok: false, message: "Plugin id must use lowercase letters, numbers, and hyphens.", state: this.state() };
    const builtIn = plugins.some((plugin) => plugin.id === id);
    if (builtIn) return { ok: false, message: `Plugin id '${id}' is reserved by a built-in plugin.`, state: this.state() };
    const targetRoot = join(this.userPluginRoot(), id);
    if (existsSync(targetRoot)) return { ok: false, message: `Plugin folder already exists: ${id}`, state: this.state() };
    const templateRoot = resolveTemplateRoot();
    mkdirSync(dirname(targetRoot), { recursive: true });
    cpSync(templateRoot, targetRoot, { recursive: true, errorOnExist: true });
    const manifestPath = join(targetRoot, MANIFEST_FILE);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.id = id;
    manifest.name = name;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const validation = this.validateUserPluginRoot(targetRoot, new Set(plugins.map((plugin) => plugin.id)));
    if (!validation.ok) {
      rmSync(targetRoot, { recursive: true, force: true });
      return { ok: false, message: validation.message, state: this.state() };
    }
    this.enableNewPlugin(id);
    return { ok: true, message: `Created plugin '${name}' from template.`, state: this.state(`Created plugin '${name}'.`) };
  }

  installFromFolder(sourceFolder: string): PluginInstallResult {
    const sourceRoot = resolve(String(sourceFolder ?? ""));
    const validation = this.validateUserPluginRoot(sourceRoot, new Set(plugins.map((plugin) => plugin.id)));
    if (!validation.ok) return { ok: false, message: validation.message, state: this.state() };
    if (folderHasObviousPrivateFiles(sourceRoot)) {
      return { ok: false, message: "Plugin install refused because the folder contains obvious credential/webhook files.", state: this.state() };
    }
    const id = validation.plugin.id;
    const targetRoot = join(this.userPluginRoot(), id);
    if (existsSync(targetRoot)) return { ok: false, message: `Plugin folder already exists: ${id}`, state: this.state() };
    mkdirSync(dirname(targetRoot), { recursive: true });
    cpSync(sourceRoot, targetRoot, { recursive: true, errorOnExist: true });
    this.enableNewPlugin(id);
    return { ok: true, message: `Installed plugin '${validation.plugin.name}'.`, state: this.state(`Installed plugin '${validation.plugin.name}'.`) };
  }

  userPluginRoot(): string {
    return join(this.appDataPath, STORE_DIR, PLUGIN_DIR);
  }

  portablePluginRoot(): string | null {
    const execPath = process.execPath ? dirname(process.execPath) : "";
    const candidate = execPath ? join(execPath, PLUGIN_DIR) : "";
    return candidate || null;
  }

  private discoverUserPlugins(): DiscoveryResult {
    const errors: PluginLoadError[] = [];
    const accepted = new Map<string, PluginDefinition>();
    const seenIds = new Set(plugins.map((plugin) => plugin.id));
    for (const root of [this.userPluginRoot(), this.portablePluginRoot()].filter((entry): entry is string => Boolean(entry))) {
      if (!existsSync(root)) continue;
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (shouldSkipPluginDirectory(entry.name)) continue;
        const pluginRoot = join(root, entry.name);
        const validation = this.validateUserPluginRoot(pluginRoot, seenIds);
        if (!validation.ok) {
          errors.push({ pluginId: validation.pluginId, sourcePath: pluginRoot, message: validation.message });
          continue;
        }
        accepted.set(validation.plugin.id, validation.plugin);
        seenIds.add(validation.plugin.id);
      }
    }
    return { plugins: [...accepted.values()], errors };
  }

  private validateUserPluginRoot(
    pluginRoot: string,
    reservedIds: ReadonlySet<string>,
  ):
    | { readonly ok: true; readonly plugin: PluginDefinition }
    | { readonly ok: false; readonly pluginId: string | null; readonly message: string } {
    const root = resolve(pluginRoot);
    if (!existsSync(root) || !statSync(root).isDirectory()) return { ok: false, pluginId: null, message: "Plugin folder does not exist." };
    const manifestPath = join(root, MANIFEST_FILE);
    if (!existsSync(manifestPath)) return { ok: false, pluginId: null, message: `Missing ${MANIFEST_FILE}.` };
    let manifest: PluginManifest;
    try {
      manifest = normalizeManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    } catch (error) {
      return { ok: false, pluginId: null, message: errorMessage(error) };
    }
    if (reservedIds.has(manifest.id)) return { ok: false, pluginId: manifest.id, message: `Duplicate or reserved plugin id: ${manifest.id}.` };
    const entryPath = safePluginPath(root, manifest.entry);
    if (!entryPath || !existsSync(entryPath) || !statSync(entryPath).isFile()) {
      return { ok: false, pluginId: manifest.id, message: `Plugin entry not found: ${manifest.entry}.` };
    }
    return {
      ok: true,
      plugin: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        category: manifest.category,
        icon: manifest.icon ?? "terminal",
        enabledByDefault: false,
        status: "ready",
        summary: manifest.description ?? "User plugin.",
        capabilities: manifest.permissions.map((permission) => permission),
        uiSurfaces: manifest.surfaces,
        sourceMapping: {
          habbpyV3: ["User plugin"],
          shockless: [manifest.entry],
          notes: "Loaded from a user plugin manifest.",
        },
        origin: "user",
        core: false,
        entry: entryPath,
        pluginRoot: root,
        permissions: manifest.permissions,
        loadError: null,
      },
    };
  }

  private sortedPlugins(pluginList: readonly PluginDefinition[]): readonly PluginDefinition[] {
    return [...pluginList].sort((left, right) => {
      const leftPinned = isPinnedPlugin(left) ? 0 : 1;
      const rightPinned = isPinnedPlugin(right) ? 0 : 1;
      if (leftPinned !== rightPinned) return leftPinned - rightPinned;
      const leftSort = pluginSortValue(left.id);
      const rightSort = pluginSortValue(right.id);
      if (leftSort !== rightSort) return leftSort - rightSort;
      return left.name.localeCompare(right.name);
    });
  }

  private enabledState(pluginList: readonly PluginDefinition[], stored: StoredPluginSettings): Readonly<Record<string, boolean>> {
    return Object.fromEntries(
      pluginList.map((plugin) => [
        plugin.id,
        isPinnedPlugin(plugin) ? true : stored.enabledById[plugin.id] ?? plugin.enabledByDefault,
      ]),
    );
  }

  private surfaceState(
    pluginList: readonly PluginDefinition[],
    stored: StoredPluginSettings,
  ): Readonly<Record<string, Readonly<Record<string, boolean>>>> {
    return Object.fromEntries(
      pluginList.map((plugin) => [
        plugin.id,
        Object.fromEntries(
          plugin.uiSurfaces.map((surface) => [
            surface.id,
            stored.uiSurfaceEnabledByPluginId[plugin.id]?.[surface.id] ?? surface.enabledByDefault,
          ]),
        ),
      ]),
    );
  }

  private enableNewPlugin(pluginId: string): void {
    const stored = this.readSettings();
    this.writeSettings({
      ...stored,
      enabledById: {
        ...stored.enabledById,
        [pluginId]: true,
      },
    });
  }

  private readSettings(): StoredPluginSettings {
    const filePath = this.settingsPath();
    if (!existsSync(filePath)) return defaultStoredPluginSettings();
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<StoredPluginSettings>;
      return {
        version: REGISTRY_VERSION,
        enabledById: cleanBooleanRecord(parsed.enabledById),
        uiSurfaceEnabledByPluginId: cleanNestedBooleanRecord(parsed.uiSurfaceEnabledByPluginId),
        permissionGrants: cleanPermissionRecord(parsed.permissionGrants),
      };
    } catch {
      return defaultStoredPluginSettings();
    }
  }

  private writeSettings(settings: StoredPluginSettings): void {
    const filePath = this.settingsPath();
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  private settingsPath(): string {
    return join(this.appDataPath, STORE_DIR, PLUGIN_DIR, SETTINGS_FILE);
  }
}

function normalizeManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== "object") throw new Error("Plugin manifest must be an object.");
  const record = value as Record<string, unknown>;
  const id = sanitizePluginId(record.id);
  if (!id) throw new Error("Plugin id must use lowercase letters, numbers, and hyphens.");
  const name = cleanRequiredString(record.name, "Plugin name");
  const version = cleanRequiredString(record.version, "Plugin version");
  const entry = cleanRequiredString(record.entry, "Plugin entry");
  const category = cleanRequiredString(record.category, "Plugin category");
  if (!allowedCategories.has(category)) throw new Error(`Invalid plugin category: ${category}.`);
  const permissions = Array.isArray(record.permissions)
    ? record.permissions.map((entry) => cleanRequiredString(entry, "Plugin permission"))
    : [];
  for (const permission of permissions) {
    if (!allowedPermissions.has(permission as PluginPermission)) throw new Error(`Invalid plugin permission: ${permission}.`);
  }
  const surfaces = Array.isArray(record.surfaces) ? record.surfaces.map(normalizeSurface) : [];
  if (surfaces.length === 0) throw new Error("Plugin manifest must define at least one surface.");
  return {
    id,
    name,
    version,
    author: typeof record.author === "string" ? record.author.trim() : undefined,
    description: typeof record.description === "string" ? record.description.trim() : undefined,
    entry,
    icon: typeof record.icon === "string" ? record.icon.trim() || "terminal" : "terminal",
    category: category as PluginManifest["category"],
    permissions: permissions as readonly PluginPermission[],
    surfaces,
    commands: Array.isArray(record.commands) ? record.commands : [],
    hotkeys: Array.isArray(record.hotkeys) ? record.hotkeys : [],
  };
}

function normalizeSurface(value: unknown): PluginUiSurface {
  if (!value || typeof value !== "object") throw new Error("Plugin surface must be an object.");
  const record = value as Record<string, unknown>;
  const id = sanitizeSurfaceId(record.id);
  const kind = cleanRequiredString(record.kind, "Plugin surface kind");
  if (!["panel", "overlay", "status", "commands"].includes(kind)) throw new Error(`Invalid plugin surface kind: ${kind}.`);
  return {
    id,
    kind: kind as PluginUiSurface["kind"],
    label: cleanRequiredString(record.label, "Plugin surface label"),
    enabledByDefault: record.enabledByDefault !== false,
    summary: cleanRequiredString(record.summary, "Plugin surface summary"),
  };
}

function safePluginPath(root: string, requestedPath: string): string | null {
  if (isAbsolute(requestedPath)) return null;
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(root, normalize(requestedPath));
  const offset = relative(resolvedRoot, resolvedPath);
  if (offset.startsWith("..") || isAbsolute(offset)) return null;
  return resolvedPath;
}

function folderHasObviousPrivateFiles(root: string): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !existsSync(current)) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (obviousPrivateFilePattern.test(entry.name)) return true;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
    }
  }
  return false;
}

function sanitizePluginId(value: unknown): string {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,63}$/.test(text) ? text : "";
}

function sanitizeSurfaceId(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(text)) throw new Error("Plugin surface id is invalid.");
  return text;
}

function cleanRequiredString(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, entry]) => key && typeof entry === "boolean"),
  ) as Record<string, boolean>;
}

function cleanNestedBooleanRecord(value: unknown): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([pluginId, surfaces]) => [
      pluginId,
      cleanBooleanRecord(surfaces),
    ]),
  );
}

function cleanPermissionRecord(value: unknown): Record<string, readonly PluginPermission[]> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([pluginId, entries]) => [
      pluginId,
      Array.isArray(entries) ? entries.filter((entry): entry is PluginPermission => allowedPermissions.has(entry as PluginPermission)) : [],
    ]),
  );
}

function defaultStoredPluginSettings(): StoredPluginSettings {
  return {
    version: REGISTRY_VERSION,
    enabledById: {},
    uiSurfaceEnabledByPluginId: {},
    permissionGrants: {},
  };
}

function shouldSkipPluginDirectory(name: string): boolean {
  return name.startsWith(".") || name.startsWith("_");
}

function resolveTemplateRoot(): string {
  const mainDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(mainDir, "..", "..", "plugins", "template"),
    join(process.cwd(), "src", "plugins", "template"),
    process.resourcesPath ? join(process.resourcesPath, "app", "dist", "plugins", "template") : "",
  ].filter(Boolean);
  const match = candidates.map((candidate) => resolve(candidate)).find((candidate) => existsSync(join(candidate, MANIFEST_FILE)));
  if (!match) throw new Error("Plugin template folder was not found.");
  return match;
}

function titleFromPluginId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
