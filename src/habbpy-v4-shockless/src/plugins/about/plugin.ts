import type { PluginDefinition } from "../../shared/plugin.js";

export const aboutPlugin: PluginDefinition = {
    id: "about",
    name: "About",
    category: "developer",
    icon: "info",
    enabledByDefault: true,
    status: "ready",
    summary: "Version, credits, build/profile facts, and project links.",
    capabilities: ["App version and runtime mode", "Selected Shockless profile/build facts", "Credits", "Reference links"],
    uiSurfaces: [
      {
        id: "panel",
        kind: "panel",
        label: "About Panel",
        enabledByDefault: true,
        summary: "Compact project information and credits in the dock.",
      },
    ],
    sourceMapping: {
      habbpyV3: ["habbpy/tabs/about_tab.py", "habbpy/__init__.py"],
      shockless: ["app.getVersion()", "src/main/main.ts getAppInfo", "src/main/clientLibrary.ts"],
      notes: "Preserves v3 credit/link content and adds v4 profile/build context without hardcoding client versions.",
    },
  };
