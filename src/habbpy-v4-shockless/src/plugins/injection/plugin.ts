import type { PluginDefinition } from "../../shared/plugin.js";

export const injectionPlugin: PluginDefinition = {
    id: "injection",
    name: "Injection",
    category: "developer",
    icon: "terminal",
    enabledByDefault: false,
    status: "mapped",
    summary: "Mapped command editor for chat, room, window, and user actions.",
    capabilities: [
      "Mapped command editor",
      "Saved snippets",
      "Recent command history",
      "Finite repeat for mapped actions",
      "User Wave/Dance/Stop/Carry actions",
      "v3 raw packet snippets imported for review",
    ],
    uiSurfaces: [
      {
        id: "panel",
        kind: "panel",
        label: "Injection Panel",
        enabledByDefault: false,
        summary: "Compact mapped-command editor.",
      },
      {
        id: "commands",
        kind: "commands",
        label: "Commands",
        enabledByDefault: false,
        summary: "Run mapped chat, Navigator, room entry, user, window, and stage actions.",
      },
    ],
    sourceMapping: {
      habbpyV3: ["habbpy/tabs/injection_tab.py", "habbpy/session.py"],
      shockless: [
        "window.__engine.dev.sendChat",
        "window.__engine.dev.stageClick",
        "window.__engine.dev.clickWindowElement",
        "window.__engine.dev.navigatorView",
        "window.__engine.dev.enterPrivateRoom",
        "window.__engine.dev.enterPublicRoom",
        "Room_bar:int_hand_image",
        "Room_interface:wave.button",
        "Room_interface:dance.button",
        "Room_interface:hcdance.button",
        "Prefer mapped runtime commands; raw packet path is not yet accepted for v4",
      ],
      notes:
        "v4 ports the editor/snippet/history workflow for mapped actions. Arbitrary raw packet send and all-session injection remain pending.",
    },
  };
