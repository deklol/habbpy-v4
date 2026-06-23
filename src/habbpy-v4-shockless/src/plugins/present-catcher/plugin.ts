import type { PluginDefinition } from "../../shared/plugin.js";

export const presentCatcherPlugin: PluginDefinition = {
  id: "present-catcher",
  name: "Present Catcher",
  category: "automation",
  icon: "package",
  enabledByDefault: false,
  status: "mapped",
  summary: "Converted v3 present catcher controls for event presents, panic users, gift opening, and treasure fragments.",
  capabilities: [
    "Live hammer and event-present target lists from parsed room objects",
    "Panic list using parsed room users",
    "Packet-backed walk, hammer collect, and present-use actions",
    "Gift opener controls for inventory tokens and present-open packets",
    "Treasure fragment request/trade packet controls",
  ],
  permissions: [
    "ui.panel",
    "console.commands",
    "events.room",
    "events.packet",
    "engine.snapshot",
    "engine.control",
    "packet.read",
    "packet.inject",
    "actions.avatar",
    "actions.furni",
    "storage",
  ],
  uiSurfaces: [
    {
      id: "panel",
      kind: "panel",
      label: "Present Catcher Panel",
      enabledByDefault: false,
      summary: "Converted v3-style event present, gift, panic-list, and fragment controls.",
    },
    {
      id: "commands",
      kind: "commands",
      label: "Present Catcher Commands",
      enabledByDefault: false,
      summary: "Reserved console commands for catcher, gift opener, and fragment trade workflows.",
    },
  ],
  sourceMapping: {
    habbpyV3: [
      "present-catcher-module/engine.py",
      "present-catcher-module/module_engine.py",
      "present-catcher-module/tab.py",
      "present-catcher-module/present_open.py",
      "present-catcher-module/present_opener.py",
      "present-catcher-module/treasure_fragments.py",
      "present-catcher-module/treasure_trade.py",
      "present-catcher-module/panic_list.py",
    ],
    shockless: [
      "window.__engine.roomObjects()",
      "src/shared/roomRelayPackets.ts",
      "src/shared/furniRelayPackets.ts",
      "src/shared/shockwavePluginPacketBuilder.ts",
      "src/renderer/userPluginHost.ts",
    ],
    notes:
      "Converted from the v3 Python/Tk module into v4 typed relay actions and a built-in panel. Live anniversary event behavior is untested until the matching Origins event presents/fragments are available.",
  },
};
