import { contextBridge, ipcRenderer } from "electron";
import type { HabbpyV4Api } from "../shared/window-api.js";

const api: HabbpyV4Api = {
  getAppInfo: () => ipcRenderer.invoke("habbpy-v4:get-app-info"),
  getAppPreferences: () => ipcRenderer.invoke("habbpy-v4:get-app-preferences"),
  setAppPreferences: (patch) => ipcRenderer.invoke("habbpy-v4:set-app-preferences", patch),
  getUpdateState: () => ipcRenderer.invoke("habbpy-v4:get-update-state"),
  checkForUpdates: () => ipcRenderer.invoke("habbpy-v4:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("habbpy-v4:download-update"),
  installDownloadedUpdate: () => ipcRenderer.invoke("habbpy-v4:install-downloaded-update"),
  skipUpdate: (version) => ipcRenderer.invoke("habbpy-v4:skip-update", version),
  onUpdateState: (listener) => {
    const channel = "habbpy-v4:update-state";
    const wrapped = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state as Parameters<typeof listener>[0]);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  getPluginRegistryState: () => ipcRenderer.invoke("habbpy-v4:get-plugin-registry-state"),
  setPluginEnabled: (pluginId, enabled) => ipcRenderer.invoke("habbpy-v4:set-plugin-enabled", pluginId, enabled),
  setPluginSurfaceEnabled: (pluginId, surfaceId, enabled) =>
    ipcRenderer.invoke("habbpy-v4:set-plugin-surface-enabled", pluginId, surfaceId, enabled),
  reloadPlugins: () => ipcRenderer.invoke("habbpy-v4:reload-plugins"),
  openPluginsFolder: () => ipcRenderer.invoke("habbpy-v4:open-plugins-folder"),
  createPluginFromTemplate: (request) => ipcRenderer.invoke("habbpy-v4:create-plugin-from-template", request),
  installPluginFromFolder: () => ipcRenderer.invoke("habbpy-v4:install-plugin-from-folder"),
  uninstallPlugin: (pluginId) => ipcRenderer.invoke("habbpy-v4:uninstall-plugin", pluginId),
  readPluginEntrySource: (pluginId) => ipcRenderer.invoke("habbpy-v4:read-plugin-entry-source", pluginId),
  getClientLibraryState: () => ipcRenderer.invoke("habbpy-v4:get-client-library-state"),
  getClientSessions: () => ipcRenderer.invoke("habbpy-v4:get-client-sessions"),
  getClientSnapshot: (clientId) => ipcRenderer.invoke("habbpy-v4:get-client-snapshot", clientId),
  getClientSnapshots: () => ipcRenderer.invoke("habbpy-v4:get-client-snapshots"),
  selectClientSession: (clientId) => ipcRenderer.invoke("habbpy-v4:select-client-session", clientId),
  renameClientSession: (clientId, label) => ipcRenderer.invoke("habbpy-v4:rename-client-session", clientId, label),
  runConsoleCommand: (input) => ipcRenderer.invoke("habbpy-v4:run-console-command", input),
  runConsoleBinding: (key) => ipcRenderer.invoke("habbpy-v4:run-console-binding", key),
  getConsoleCommandState: () => ipcRenderer.invoke("habbpy-v4:get-console-command-state"),
  getMimicState: () => ipcRenderer.invoke("habbpy-v4:get-mimic-state"),
  importClientReference: () => ipcRenderer.invoke("habbpy-v4:import-client-reference"),
  onProfileImportProgress: (listener) => {
    const channel = "habbpy-v4:profile-import-progress";
    const wrapped = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress as Parameters<typeof listener>[0]);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onShowAbout: (listener) => {
    const channel = "habbpy-v4:show-about";
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  setActiveClientProfile: (profileRoot) => ipcRenderer.invoke("habbpy-v4:set-active-client-profile", profileRoot),
  getEngineLaunchState: () => ipcRenderer.invoke("habbpy-v4:get-engine-launch-state"),
  setEngineLaunchSettings: (patch) => ipcRenderer.invoke("habbpy-v4:set-engine-launch-settings", patch),
  startEmbeddedEngine: () => ipcRenderer.invoke("habbpy-v4:start-embedded-engine"),
  stopEmbeddedEngine: () => ipcRenderer.invoke("habbpy-v4:stop-embedded-engine"),
  submitVisibleClientLogin: (clientId, webContentsId) => ipcRenderer.invoke("habbpy-v4:submit-visible-client-login", clientId, webContentsId),
  getRelayLogSnapshot: () => ipcRenderer.invoke("habbpy-v4:get-relay-log-snapshot"),
  getRelayLogDeltaSnapshot: (currentLogPath, afterLineNumber) =>
    ipcRenderer.invoke("habbpy-v4:get-relay-log-delta-snapshot", currentLogPath, afterLineNumber),
  getFurniMetadataSnapshot: () => ipcRenderer.invoke("habbpy-v4:get-furni-metadata-snapshot"),
  lookupOriginsUser: (name) => ipcRenderer.invoke("habbpy-v4:lookup-origins-user", name),
  sendRoomRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-room-relay-action", action, clientId),
  sendFishingRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-fishing-relay-action", action, clientId),
  sendGardeningRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-gardening-relay-action", action, clientId),
  sendUserRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-user-relay-action", action, clientId),
  sendSocialRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-social-relay-action", action, clientId),
  sendWallMoverRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-wall-mover-relay-action", action, clientId),
  sendFurniRelayAction: (action, clientId) => ipcRenderer.invoke("habbpy-v4:send-furni-relay-action", action, clientId),
  sendPluginPacket: (packet, clientId) => ipcRenderer.invoke("habbpy-v4:send-plugin-packet", packet, clientId),
};

contextBridge.exposeInMainWorld("habbpyV4", api);
contextBridge.exposeInMainWorld("shockless", api);
