import type { PluginDefinition, PluginPermission } from "../shared/plugin.js";
import { builtInPluginDefinitions } from "./builtins.js";

const pluginDisplayOrder = new Map(
  [
    "connection",
    "plugin-manager",
    "settings",
    "multi-account",
    "info",
    "room",
    "user",
    "social",
    "chat",
    "visitors",
    "items",
    "inventory",
    "gardening",
    "wall-mover",
    "fishing",
    "present-catcher",
    "packet-log",
    "automation",
    "injection",
    "dev-tools",
    "about",
  ].map((id, index) => [id, index] as const),
);

export const plugins: readonly PluginDefinition[] = [...builtInPluginDefinitions].map(normalizeBuiltInPlugin).sort(
  (left, right) => (pluginDisplayOrder.get(left.id) ?? 999) - (pluginDisplayOrder.get(right.id) ?? 999),
);

export function getPluginById(id: string): PluginDefinition | undefined {
  return plugins.find((plugin) => plugin.id === id);
}

export function isPinnedPlugin(plugin: PluginDefinition): boolean {
  return plugin.core === true || plugin.category === "core";
}

export function normalizeBuiltInPlugin(plugin: PluginDefinition): PluginDefinition {
  return {
    ...plugin,
    origin: plugin.origin ?? "built-in",
    core: plugin.core ?? false,
    permissions: plugin.permissions ?? permissionsFromSurfaces(plugin),
    loadError: plugin.loadError ?? null,
  };
}

export function pluginSortValue(pluginId: string): number {
  return pluginDisplayOrder.get(pluginId) ?? 999;
}

function permissionsFromSurfaces(plugin: PluginDefinition): readonly PluginPermission[] {
  const permissions = new Set<PluginPermission>();
  for (const surface of plugin.uiSurfaces) {
    if (surface.kind === "panel") permissions.add("ui.panel");
    if (surface.kind === "status") permissions.add("ui.status");
    if (surface.kind === "overlay") permissions.add("ui.overlay");
    if (surface.kind === "commands") permissions.add("console.commands");
  }
  if (plugin.id === "packet-log") permissions.add("packet.read");
  if (plugin.id === "injection") permissions.add("console.commands");
  return [...permissions];
}
