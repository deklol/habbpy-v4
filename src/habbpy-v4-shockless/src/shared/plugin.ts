export type PluginCategory =
  | "core"
  | "session"
  | "room"
  | "user"
  | "inventory"
  | "automation"
  | "social"
  | "developer";

export type PluginStatus = "ready" | "mapped" | "partial" | "blocked";

export type PluginUiSurfaceKind = "panel" | "overlay" | "status" | "commands";

export type PluginOrigin = "built-in" | "user";

export type PluginPermission =
  | "ui.panel"
  | "ui.status"
  | "ui.overlay"
  | "console.commands"
  | "engine.snapshot"
  | "engine.control"
  | "client.rights"
  | "events.room"
  | "events.chat"
  | "events.packet"
  | "events.session"
  | "actions.avatar"
  | "actions.social"
  | "actions.fishing"
  | "actions.furni"
  | "actions.plants"
  | "actions.wallItems"
  | "chat.send"
  | "storage"
  | "packet.read"
  | "packet.inject"
  | "packet.intercept"
  | "packet.intercept.sensitive";

export interface PluginUiSurface {
  readonly id: string;
  readonly kind: PluginUiSurfaceKind;
  readonly label: string;
  readonly enabledByDefault: boolean;
  readonly summary: string;
}

export interface SourceMapping {
  readonly habbpyV3: readonly string[];
  readonly shockless: readonly string[];
  readonly notes?: string;
}

export interface PluginManagedRuntime {
  readonly clientRights?: readonly string[];
}

export interface PluginDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: PluginCategory;
  readonly icon: string;
  readonly enabledByDefault: boolean;
  readonly status: PluginStatus;
  readonly summary: string;
  readonly capabilities: readonly string[];
  readonly uiSurfaces: readonly PluginUiSurface[];
  readonly sourceMapping: SourceMapping;
  readonly origin?: PluginOrigin;
  readonly core?: boolean;
  readonly version?: string;
  readonly author?: string;
  readonly entry?: string;
  readonly pluginRoot?: string;
  readonly permissions?: readonly PluginPermission[];
  readonly managedRuntime?: PluginManagedRuntime;
  readonly loadError?: string | null;
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: string;
  readonly description?: string;
  readonly entry: string;
  readonly icon?: string;
  readonly category: PluginCategory;
  readonly permissions: readonly PluginPermission[];
  readonly surfaces: readonly PluginUiSurface[];
  readonly managedRuntime?: PluginManagedRuntime;
  readonly commands?: readonly unknown[];
  readonly hotkeys?: readonly unknown[];
}

export interface PluginLoadError {
  readonly pluginId: string | null;
  readonly sourcePath: string;
  readonly message: string;
}

export interface PluginRegistryState {
  readonly plugins: readonly PluginDefinition[];
  readonly enabledById: Readonly<Record<string, boolean>>;
  readonly uiSurfaceEnabledByPluginId: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  readonly pinnedPluginIds: readonly string[];
  readonly userPluginRoot: string;
  readonly portablePluginRoot: string | null;
  readonly loadErrors: readonly PluginLoadError[];
  readonly message: string;
}

export interface PluginCreateRequest {
  readonly id: string;
  readonly name: string;
}

export interface PluginInstallResult {
  readonly ok: boolean;
  readonly message: string;
  readonly state: PluginRegistryState;
}

export interface PluginEntrySourceResult {
  readonly ok: boolean;
  readonly pluginId: string;
  readonly source: string | null;
  readonly message: string;
}
