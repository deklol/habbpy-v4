import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { PluginDefinition } from "../../shared/plugin";

interface IconRailProps {
  readonly dockCollapsed: boolean;
  readonly filteredPlugins: readonly PluginDefinition[];
  readonly pluginEnabledById: Readonly<Record<string, boolean>>;
  readonly selectedPluginId: string;
  readonly PluginIcon: React.ComponentType<{ readonly plugin: PluginDefinition }>;
  readonly onToggleDock: () => void;
  readonly onSelectPlugin: (pluginId: string) => void;
}

export function IconRail({
  dockCollapsed, filteredPlugins, pluginEnabledById, selectedPluginId,
  PluginIcon, onToggleDock, onSelectPlugin,
}: IconRailProps) {
  return (
    <nav className="icon-rail" aria-label="Plugins">
      <button
        className="rail-toggle"
        type="button"
        aria-label={dockCollapsed ? "Expand plugin dock" : "Collapse plugin dock"}
        onClick={onToggleDock}
        title={dockCollapsed ? "Expand plugin dock" : "Collapse plugin dock"}
      >
        {dockCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
      <div className="rail-list">
        {filteredPlugins.map((plugin) => {
          const enabled = pluginEnabledById[plugin.id] !== false;
          const active = plugin.id === selectedPluginId;
          return (
            <button
              className={`rail-tab ${active ? "active" : ""} ${enabled ? "" : "disabled"}`}
              type="button"
              key={plugin.id}
              title={plugin.name}
              aria-label={plugin.name}
              aria-pressed={active}
              onClick={() => onSelectPlugin(plugin.id)}
            >
              <span className="plugin-icon">
                <PluginIcon plugin={plugin} />
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
