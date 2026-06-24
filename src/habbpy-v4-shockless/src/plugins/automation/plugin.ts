import type { PluginDefinition } from "../../shared/plugin.js";

export const automationPlugin: PluginDefinition = {
    id: "automation",
    name: "Automation",
    category: "automation",
    icon: "bot",
    enabledByDefault: false,
    status: "mapped",
    summary: "Automation tools for comfort, fishing, gardening, and wall items.",
    capabilities: [
      "Auto-hide Bulletin Board after login",
      "Fishing plugin split",
      "Gardening plugin split",
      "Wall Mover plugin split",
      "Comfort toggles",
      "Fishing minigame relay helpers",
    ],
    uiSurfaces: [
      {
        id: "panel",
        kind: "panel",
        label: "Automation Panel",
        enabledByDefault: false,
        summary: "Fishing, gardening, wall mover, and helper settings.",
      },
      {
        id: "status",
        kind: "status",
        label: "Automation Status",
        enabledByDefault: false,
        summary: "Compact active automation readout.",
      },
      {
        id: "commands",
        kind: "commands",
        label: "Automation Commands",
        enabledByDefault: false,
        summary: "Automation start/stop and mode commands.",
      },
    ],
    sourceMapping: {
      habbpyV3: [
        "habbpy/tabs/fishing_tab.py",
        "habbpy/tabs/gardening_tab.py",
        "habbpy/tabs/wallmover_tab.py",
        "habbpy/fishing.py",
        "habbpy/gardening.py",
        "habbpy/wallmover.py",
      ],
      shockless: [
        "window.__engine.dev.windowIds",
        "window.__engine.dev.windowElements",
        "window.__engine.dev.clickWindowElement",
        "src/shared/fishingRelayPackets.ts",
      ],
      notes:
        "Auto-hide Bulletin Board is mapped through runtime window controls. Fishing, Gardening, and Wall Mover own their first-class controls and validated relay actions.",
    },
  };
