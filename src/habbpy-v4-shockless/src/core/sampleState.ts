import type { AppState } from "../shared/session";
import { createInitialPluginEnabledState, createInitialPluginUiSurfaceState } from "./shellStore";

export const initialAppState: AppState = {
  engine: {
    running: false,
    embedded: false,
    profileLabel: "No Shockless profile attached",
    buildLabel: "Waiting for engine",
    location: "Shell ready",
    fps: null,
    tickRate: null,
    latencyMs: null,
    errors: 0,
  },
  account: {
    name: "-",
    badge: "-",
    credits: null,
    clubDays: null,
  },
  room: {
    id: "-",
    name: "No room",
    owner: "-",
    type: "unknown",
    users: 0,
    floorItems: 0,
    wallItems: 0,
  },
  ui: {
    dockCollapsed: false,
  },
  plugins: {
    enabledById: createInitialPluginEnabledState(),
    uiSurfaceEnabledByPluginId: createInitialPluginUiSurfaceState(),
  },
  selectedPluginId: "connection",
  commandTimeline: [
    {
      id: "boot",
      time: "local",
      severity: "info",
      message: "Habbpy v4 shell initialized. Shockless embed is the next milestone.",
    },
  ],
};
