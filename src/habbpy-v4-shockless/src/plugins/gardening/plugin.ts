import type { PluginDefinition } from "../../shared/plugin.js";

export const gardeningPlugin: PluginDefinition = {
    id: "gardening",
    name: "Gardening",
    category: "automation",
    icon: "bot",
    enabledByDefault: false,
    status: "mapped",
    summary: "Gardening controls, live plant candidates, packet actions, and cycle state.",
    capabilities: [
      "Start Gardening and Compost All use the v3 move/action/return packet flow through the local relay",
      "Live plant-like room object candidate list",
      "Current target plant detail from room rows",
      "Current cycle phase, original tile, working tile, attempts, completed, and queued counts",
      "Tracked room and room-cycle controls documented until visit helpers exist",
    ],
    uiSurfaces: [
      {
        id: "panel",
        kind: "panel",
        label: "Gardening Panel",
        enabledByDefault: false,
        summary: "Compact plant state with v3-style move/action/return Gardening controls.",
      },
      {
        id: "commands",
        kind: "commands",
        label: "Gardening Commands",
        enabledByDefault: false,
        summary: "Start, compost, water, harvest, and return commands mapped through the local relay; room tracking remains pending.",
      },
    ],
    sourceMapping: {
      habbpyV3: ["habbpy/tabs/gardening_tab.py", "habbpy/gardening.py"],
      shockless: ["window.__engine.roomObjects()", "src/main/relay/originsRelayV4.ts Gardening control socket"],
      notes:
        "Panel reads live plant-like room objects and sends the v3 Gardening packet headers 73/540/541/1115 through a scoped local relay control path. Tracked room persistence and room-cycle visits remain pending.",
    },
  };
