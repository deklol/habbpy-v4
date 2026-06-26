import React from "react";
import { FolderInput, RefreshCw } from "lucide-react";
import { PluginDefinition } from "../../shared/plugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compactValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim() === "") return "—";
  return String(value);
}

function labelCase(value: string): string {
  if (!value) return "";
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "error":
      return "Error";
    default:
      return labelCase(status);
  }
}

function permissionLabel(permission: string): string {
  switch (permission) {
    case "network":
      return "Network Access";
    case "filesystem":
      return "File System Access";
    case "clipboard":
      return "Clipboard Access";
    case "notifications":
      return "Notifications";
    case "storage":
      return "Local Storage";
    case "ui":
      return "UI Access";
    default:
      return labelCase(permission);
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UserPluginPanelProps {
  selectedPlugin: PluginDefinition;
  pluginSurfaceEnabledByPluginId: Record<string, Record<string, boolean> | undefined>;
  desktopBridgeAvailable: boolean;
  onOpenPluginsFolder: () => void;
  onReloadPlugins: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserPluginPanel({
  selectedPlugin,
  pluginSurfaceEnabledByPluginId,
  desktopBridgeAvailable,
  onOpenPluginsFolder,
  onReloadPlugins,
}: UserPluginPanelProps): React.ReactElement {
  return (
    <div className="runtime-panel user-plugin-panel">
      <div className="mini-section">
        <h3>{selectedPlugin.name}</h3>
        <p className="runtime-message">{selectedPlugin.summary}</p>
        <div className="kv-grid">
          <span>Status</span>
          <strong>{statusLabel(selectedPlugin.status)}</strong>
          <span>Version</span>
          <strong>{compactValue(selectedPlugin.version)}</strong>
          <span>Author</span>
          <strong>{compactValue(selectedPlugin.author)}</strong>
          <span>Category</span>
          <strong>{labelCase(selectedPlugin.category)}</strong>
          <span>Entry</span>
          <strong>{compactValue(selectedPlugin.entry ? selectedPlugin.entry.split(/[\\/]/).pop() : null)}</strong>
          <span>Surfaces</span>
          <strong>{compactValue(selectedPlugin.uiSurfaces.length)}</strong>
        </div>
      </div>

      <div className="mini-section">
        <h3>Permissions</h3>
        <div className="chip-list permission-chip-list">
          {(selectedPlugin.permissions ?? []).map((permission) => (
            <span key={permission}>{permissionLabel(permission)}</span>
          ))}
          {(selectedPlugin.permissions ?? []).length === 0 ? <span>No permissions</span> : null}
        </div>
      </div>

      <div className="mini-section">
        <h3>Surfaces</h3>
        <div className="mini-table">
          {selectedPlugin.uiSurfaces.map((surface) => (
            <p key={surface.id}>
              <span>{surface.label}</span>
              <strong>
                {labelCase(surface.kind)} /{" "}
                {(pluginSurfaceEnabledByPluginId[selectedPlugin.id]?.[surface.id] ??
                  surface.enabledByDefault)
                  ? "Enabled"
                  : "Disabled"}
              </strong>
            </p>
          ))}
        </div>
      </div>

      <div className="mini-section">
        <h3>Files</h3>
        <div className="runtime-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void onOpenPluginsFolder()}
          >
            <FolderInput size={14} />
            Open Plugins Folder
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void onReloadPlugins()}
          >
            <RefreshCw size={14} />
            Reload Plugin List
          </button>
        </div>
      </div>
    </div>
  );
}
