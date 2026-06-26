import { CircleAlert, FolderInput, Plus, RefreshCw } from "lucide-react";
import { Activity, Bot, Command, Hammer, Info, List, Map, MessageSquare, Package, Plug, Sofa, Terminal, User, Wrench } from "lucide-react";
import type { PluginDefinition, PluginPermission, PluginRegistryState } from "../../shared/plugin";
import { compactRuntimeValue } from "../../engine-adapter/shocklessSessionAdapter";

const iconMap = {
  activity: Activity,
  bot: Bot,
  command: Command,
  list: List,
  map: Map,
  messages: MessageSquare,
  package: Package,
  plug: Plug,
  sofa: Sofa,
  terminal: Terminal,
  user: User,
  wrench: Wrench,
  hammer: Hammer,
  info: Info,
};

function PluginIcon({ plugin }: { readonly plugin: PluginDefinition }) {
  const Icon = iconMap[plugin.icon as keyof typeof iconMap] ?? CircleAlert;
  return <Icon aria-hidden="true" size={17} strokeWidth={2.1} />;
}

function labelCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusLabel(value: unknown): string {
  const label = labelCase(value);
  return label === "Done" ? "Complete" : label;
}

function permissionLabel(value: unknown): string {
  return String(value ?? "")
    .split(".")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "ui" ? "UI" : labelCase(part)))
    .join(" ") || "-";
}

function originLabel(value: unknown): string {
  return String(value ?? "") === "built-in" ? "Built-In" : labelCase(value);
}

function compactValue(value: unknown): string {
  return compactRuntimeValue(value);
}

export interface PluginManagerPanelProps {
  readonly desktopBridgeAvailable: boolean;
  readonly pluginRegistryState: PluginRegistryState | null;
  readonly availablePlugins: readonly PluginDefinition[];
  readonly pluginEnabledById: Record<string, boolean | undefined>;
  readonly pluginSurfaceEnabledByPluginId: Record<string, Record<string, boolean> | undefined>;
  readonly pinnedPluginIds: ReadonlySet<string>;
  readonly pluginManagerMessage: string;
  readonly newPluginId: string;
  readonly newPluginName: string;
  readonly onReloadPlugins: () => void;
  readonly onOpenPluginsFolder: () => void;
  readonly onInstallPluginFromFolder: () => void;
  readonly onSetNewPluginId: (v: string) => void;
  readonly onSetNewPluginName: (v: string) => void;
  readonly onCreatePluginFromTemplate: () => void;
  readonly onSetPluginEnabled: (plugin: PluginDefinition, enabled: boolean) => void;
  readonly onSetPluginSurfaceEnabled: (pluginId: string, surfaceId: string, enabled: boolean) => void;
}

export function PluginManagerPanel({
  desktopBridgeAvailable,
  pluginRegistryState,
  availablePlugins,
  pluginEnabledById,
  pluginSurfaceEnabledByPluginId,
  pinnedPluginIds,
  pluginManagerMessage,
  newPluginId,
  newPluginName,
  onReloadPlugins: reloadPlugins,
  onOpenPluginsFolder: openPluginsFolder,
  onInstallPluginFromFolder: installPluginFromFolder,
  onSetNewPluginId: setNewPluginId,
  onSetNewPluginName: setNewPluginName,
  onCreatePluginFromTemplate: createPluginFromTemplate,
  onSetPluginEnabled: setPluginEnabled,
  onSetPluginSurfaceEnabled: setPluginSurfaceEnabled,
}: PluginManagerPanelProps) {
  return (
    <div className="runtime-panel plugin-manager-panel">
      <div className="mini-section">
        <h3>Plugin Manager</h3>
        <div className="runtime-actions plugin-manager-actions">
          <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void reloadPlugins()}>
            <RefreshCw size={14} />
            Reload Plugins
          </button>
          <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void openPluginsFolder()}>
            <FolderInput size={14} />
            Open Folder
          </button>
          <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void installPluginFromFolder()}>
            <Plus size={14} />
            Install From Folder
          </button>
        </div>
        <div className="kv-grid">
          <span>User Root</span>
          <strong>{compactValue(pluginRegistryState?.userPluginRoot)}</strong>
          <span>Portable Root</span>
          <strong>{compactValue(pluginRegistryState?.portablePluginRoot)}</strong>
          <span>Plugins</span>
          <strong>{compactValue(availablePlugins.length)}</strong>
          <span>Enabled</span>
          <strong>{compactValue(availablePlugins.filter((plugin) => pluginEnabledById[plugin.id] !== false).length)}</strong>
        </div>
        {pluginManagerMessage || pluginRegistryState?.message ? (
          <p className="runtime-message">{pluginManagerMessage || pluginRegistryState?.message}</p>
        ) : null}
      </div>

      <div className="mini-section">
        <h3>Create Plugin</h3>
        <div className="inline-field-grid">
          <label className="field-stack">
            <span>Plugin Id</span>
            <input value={newPluginId} onChange={(event) => setNewPluginId(event.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          </label>
          <label className="field-stack">
            <span>Name</span>
            <input value={newPluginName} onChange={(event) => setNewPluginName(event.currentTarget.value)} />
          </label>
        </div>
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !newPluginId.trim()} onClick={() => void createPluginFromTemplate()}>
          <Plus size={14} />
          Create From Template
        </button>
      </div>

      <div className="mini-section">
        <h3>Installed Plugins</h3>
        <div className="plugin-manager-list" aria-label="Installed plugins">
          {availablePlugins.map((plugin) => {
            const pinned = pinnedPluginIds.has(plugin.id);
            const enabled = pluginEnabledById[plugin.id] !== false;
            return (
              <div className={`plugin-manager-row ${enabled ? "enabled" : "disabled"} ${pinned ? "pinned" : ""}`} key={plugin.id}>
                <div className="plugin-manager-row-main">
                  <div className="panel-icon">
                    <PluginIcon plugin={plugin} />
                  </div>
                  <div>
                    <strong>{plugin.name}</strong>
                    <small>
                      {originLabel(plugin.origin ?? "built-in")} / {labelCase(plugin.category)} / {statusLabel(plugin.status)}
                    </small>
                    <p>{plugin.summary}</p>
                  </div>
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={pinned || !desktopBridgeAvailable}
                      onChange={(event) => void setPluginEnabled(plugin, event.currentTarget.checked)}
                    />
                    <span>{pinned ? "Pinned" : enabled ? "Enabled" : "Disabled"}</span>
                  </label>
                </div>
                <div className="chip-list permission-chip-list">
                  {(plugin.permissions ?? []).map((permission) => (
                    <span key={permission}>{permissionLabel(permission)}</span>
                  ))}
                  {(plugin.permissions ?? []).length === 0 ? <span>No permissions</span> : null}
                </div>
                <div className="plugin-surface-grid">
                  {plugin.uiSurfaces.map((surface) => (
                    <label className="toggle-row checkbox-first-row" key={surface.id}>
                      <input
                        type="checkbox"
                        checked={pluginSurfaceEnabledByPluginId[plugin.id]?.[surface.id] ?? surface.enabledByDefault}
                        disabled={!desktopBridgeAvailable || !enabled}
                        onChange={(event) => void setPluginSurfaceEnabled(plugin.id, surface.id, event.currentTarget.checked)}
                      />
                      <span>
                        <strong>{surface.label}</strong>
                        <small>{labelCase(surface.kind)} / {surface.summary}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {plugin.loadError ? <p className="runtime-message">{plugin.loadError}</p> : null}
              </div>
            );
          })}
        </div>
      </div>

      {(pluginRegistryState?.loadErrors.length ?? 0) > 0 ? (
        <div className="mini-section">
          <h3>Load Errors</h3>
          <div className="mini-table">
            {pluginRegistryState?.loadErrors.map((error) => (
              <p key={`${error.sourcePath}:${error.message}`}>
                <span>{compactValue(error.pluginId ?? "Plugin")}</span>
                <strong>{error.message}</strong>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
