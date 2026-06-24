import type { PluginDefinition } from "../../shared/plugin.js";

export const fishingPlugin: PluginDefinition = {
    id: "fishing",
    name: "Fishing",
    category: "automation",
    icon: "bot",
    enabledByDefault: false,
    status: "ready",
    summary: "Fishing room candidates, safe start/derby actions, and packet-backed catch, token, minigame, frenzy, and Fishopedia state.",
    capabilities: [
      "Live room prerequisite, fishing-area candidate rows, and walk-to-area movement",
      "Validated start fishing, minigame input, derby register, token, stats, rod, products, and Fishopedia relay actions",
      "Packet-backed catches, golden catches, XP, token balance, and level",
      "Packet-backed minigame status/pin values and frenzy notifications",
      "Packet-backed Fishopedia snapshot/update rows",
    ],
    permissions: ["ui.panel", "console.commands", "events.room", "engine.snapshot", "events.packet", "packet.read", "actions.fishing", "actions.avatar"],
    uiSurfaces: [
      {
        id: "panel",
        kind: "panel",
        label: "Fishing Panel",
        enabledByDefault: false,
        summary: "Compact autofish status and room prerequisites.",
      },
      {
        id: "commands",
        kind: "commands",
        label: "Fishing Commands",
        enabledByDefault: false,
        summary: "Start fishing, minigame input, derby register, and fishing data requests routed through scoped relay actions.",
      },
    ],
    sourceMapping: {
      habbpyV3: ["habbpy/tabs/fishing_tab.py", "habbpy/fishing.py", "habbpy/autofish.py", "habbpy/room_engine.py"],
      shockless: ["window.__engine.roomObjects()", "src/main/relayLog.ts fishing packet decoders", "src/shared/fishingRelayPackets.ts"],
      notes:
        "Panel reads live room candidates and parsed fishing packet state. Walk-to-area, start/minigame/derby/data requests use validated v3-equivalent relay actions instead of raw packet text.",
    },
  };
