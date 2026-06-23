import type { PluginDefinition, PluginEntrySourceResult, PluginPermission } from "../shared/plugin";

export interface UserPluginHostRequest {
  readonly id: number;
  readonly api: string;
  readonly args: unknown;
}

export interface UserPluginHostContext {
  readonly readEntrySource: (pluginId: string) => Promise<PluginEntrySourceResult>;
  readonly handleRequest: (plugin: PluginDefinition, request: UserPluginHostRequest) => Promise<unknown>;
  readonly log: (plugin: PluginDefinition, level: "info" | "warning" | "error", message: string) => void;
}

interface RuntimeRecord {
  readonly plugin: PluginDefinition;
  readonly worker: Worker;
  disposeTimer?: ReturnType<typeof setTimeout>;
}

export class RendererUserPluginHost {
  private readonly runtimes = new Map<string, RuntimeRecord>();
  private readonly loading = new Set<string>();

  constructor(private readonly context: UserPluginHostContext) {}

  sync(plugins: readonly PluginDefinition[], enabledById: Readonly<Record<string, boolean>>): void {
    const expected = new Set<string>();
    for (const plugin of plugins) {
      if (plugin.origin !== "user" || !plugin.entry || enabledById[plugin.id] === false) continue;
      expected.add(plugin.id);
      void this.ensureRuntime(plugin);
    }

    for (const pluginId of [...this.runtimes.keys()]) {
      if (!expected.has(pluginId)) this.disposeRuntime(pluginId);
    }
  }

  dispatchEvent(name: string, payload: unknown): void {
    for (const runtime of this.runtimes.values()) {
      if (!canReceiveEvent(runtime.plugin, name)) continue;
      runtime.worker.postMessage({ type: "event", name, payload });
    }
  }

  dispose(): void {
    for (const pluginId of [...this.runtimes.keys()]) this.disposeRuntime(pluginId);
    this.loading.clear();
  }

  private async ensureRuntime(plugin: PluginDefinition): Promise<void> {
    if (this.runtimes.has(plugin.id) || this.loading.has(plugin.id)) return;
    this.loading.add(plugin.id);
    try {
      const source = await this.context.readEntrySource(plugin.id);
      if (!source.ok) {
        this.context.log(plugin, "warning", source.message);
        return;
      }

      const workerUrl = URL.createObjectURL(new Blob([userPluginWorkerSource()], { type: "text/javascript" }));
      const worker = new Worker(workerUrl, { type: "module", name: `habbpy-plugin-${plugin.id}` });
      URL.revokeObjectURL(workerUrl);
      const runtime: RuntimeRecord = { plugin, worker };
      this.runtimes.set(plugin.id, runtime);
      worker.onmessage = (event: MessageEvent) => void this.handleWorkerMessage(runtime, event.data);
      worker.onerror = (event) => {
        this.context.log(plugin, "error", event.message || "Plugin worker error.");
      };
      worker.postMessage({
        type: "init",
        plugin: {
          id: plugin.id,
          name: plugin.name,
          permissions: plugin.permissions ?? [],
          surfaces: plugin.uiSurfaces,
        },
        source: source.source,
      });
    } finally {
      this.loading.delete(plugin.id);
    }
  }

  private async handleWorkerMessage(runtime: RuntimeRecord, data: unknown): Promise<void> {
    if (!data || typeof data !== "object") return;
    const message = data as Record<string, unknown>;
    if (message.type === "log") {
      const level = message.level === "warning" || message.level === "error" ? message.level : "info";
      this.context.log(runtime.plugin, level, String(message.message ?? ""));
      return;
    }
    if (message.type === "status") {
      const status = String(message.status ?? "");
      if (status === "active") this.context.log(runtime.plugin, "info", "Plugin activated.");
      if (status === "disposed") {
        if (runtime.disposeTimer) clearTimeout(runtime.disposeTimer);
        runtime.worker.terminate();
      }
      return;
    }
    if (message.type !== "request") return;
    const request = normalizeHostRequest(message);
    if (!request) return;
    try {
      const result = await this.context.handleRequest(runtime.plugin, request);
      runtime.worker.postMessage({ type: "response", id: request.id, ok: true, result });
    } catch (error) {
      runtime.worker.postMessage({ type: "response", id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private disposeRuntime(pluginId: string): void {
    const runtime = this.runtimes.get(pluginId);
    if (!runtime) return;
    runtime.worker.postMessage({ type: "dispose" });
    this.runtimes.delete(pluginId);
    runtime.disposeTimer = setTimeout(() => runtime.worker.terminate(), 1500);
  }
}

function canReceiveEvent(plugin: PluginDefinition, name: string): boolean {
  const permission = permissionForEventName(name);
  if (!permission) return true;
  const permissions = plugin.permissions ?? [];
  if (permissions.includes(permission)) return true;
  if (permission === "events.packet") {
    return permissions.includes("packet.read") || permissions.includes("packet.intercept") || permissions.includes("packet.intercept.sensitive");
  }
  return false;
}

function permissionForEventName(name: string): PluginPermission | null {
  if (name === "packet" || name.startsWith("packet.")) return "events.packet";
  if (name.startsWith("chat.")) return "events.chat";
  if (name.startsWith("room.")) return "events.room";
  if (name.startsWith("session.") || name.startsWith("client.")) return "events.session";
  if (name.startsWith("runtime.") || name.startsWith("engine.")) return "engine.snapshot";
  return null;
}

function normalizeHostRequest(message: Record<string, unknown>): UserPluginHostRequest | null {
  const id = Number(message.id);
  const api = String(message.api ?? "");
  if (!Number.isInteger(id) || id < 0 || !api) return null;
  return { id, api, args: message.args };
}

function userPluginWorkerSource(): string {
  return `
const pending = new Map();
const eventHandlers = new Map();
let nextRequestId = 1;
let disposeCallbacks = [];
const pluginInfo = {
  id: "",
  name: "",
  permissions: [],
  surfaces: [],
};

function log(level, message) {
  postMessage({ type: "log", level, message: String(message ?? "") });
}

function request(api, args) {
  const id = nextRequestId++;
  postMessage({ type: "request", id, api, args });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function addHandler(name, handler) {
  const key = String(name || "");
  if (!key || typeof handler !== "function") return () => undefined;
  const handlers = eventHandlers.get(key) || new Map();
  const id = nextRequestId++;
  handlers.set(id, handler);
  eventHandlers.set(key, handlers);
  return () => {
    const current = eventHandlers.get(key);
    current?.delete(id);
    if (current?.size === 0) eventHandlers.delete(key);
  };
}

function normalizeTimeoutMs(options) {
  if (!options || typeof options !== "object") return null;
  const raw = options.timeoutMs ?? options.timeout;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function waitForEvent(name, options = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const off = addHandler(name, (payload) => {
      if (done) return undefined;
      done = true;
      if (timer !== null) clearTimeout(timer);
      off();
      resolve(payload);
      return undefined;
    });
    const timeoutMs = normalizeTimeoutMs(options);
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        reject(new Error("Timed out waiting for event " + String(name || "")));
      }, timeoutMs);
    }
  });
}

function waitForPacket(direction, filter = {}, options = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer = null;
    const off = api.packets.on(direction, filter, (packet) => {
      if (done) return packet.allow();
      done = true;
      if (timer !== null) clearTimeout(timer);
      off();
      resolve(packet);
      return packet.allow();
    });
    const timeoutMs = normalizeTimeoutMs(options);
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        off();
        reject(new Error("Timed out waiting for packet."));
      }, timeoutMs);
    }
  });
}

function sleep(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration < 0) return Promise.reject(new Error("sleep requires a non-negative duration."));
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function dispatchEvent(name, payload) {
  const exactName = String(name || "");
  const handlerGroups = [eventHandlers.get(exactName), exactName === "*" ? null : eventHandlers.get("*")].filter(Boolean);
  for (const handlers of handlerGroups) {
    for (const handler of handlers.values()) {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((error) => log("error", error?.message || error));
    }
  }
}

function packetEvent(packet) {
  return {
    ...packet,
    allow: () => ({ action: "allow" }),
    block: (reason) => ({ action: "block", reason }),
    replace: (nextPacket) => ({ action: "replace", packet: nextPacket }),
    inject: (nextPacket) => ({ action: "inject", packet: nextPacket }),
  };
}

const api = {
  plugin: pluginInfo,
  log: {
    info: (message) => log("info", message),
    warn: (message) => log("warning", message),
    error: (message) => log("error", message),
  },
  events: {
    on: addHandler,
    once: waitForEvent,
    emit: (name, payload = {}) => {
      dispatchEvent(name, payload);
      return true;
    },
    defineFromPacket: (eventName, direction = "all", filter = {}, mapper = (packet) => packet) =>
      api.packets.on(direction, filter, (packet) => {
        const payload = mapper(packet);
        if (payload !== undefined) dispatchEvent(eventName, payload);
        return packet.allow();
      }),
  },
  packets: {
    on(direction, filter, handler) {
      const normalizedDirection = String(direction || "all").toLowerCase();
      const eventName = normalizedDirection === "all" || normalizedDirection === "*" ? "packet" : "packet." + normalizedDirection;
      return addHandler(eventName, (packet) => {
        const wantedHeader = filter && Object.prototype.hasOwnProperty.call(filter, "header") ? Number(filter.header) : null;
        const wantedName = filter?.packetName ? String(filter.packetName).toUpperCase() : "";
        if (wantedHeader !== null && packet?.header !== wantedHeader) return undefined;
        if (wantedName && String(packet?.packetName || "").toUpperCase() !== wantedName) return undefined;
        return handler(packetEvent(packet));
      });
    },
    once: waitForPacket,
    send: (clientId, packet) => request("packets.send", { clientId, packet }),
  },
  timers: {
    sleep,
  },
  chat: {
    send: (message, options = {}) => request("chat.send", { message, options }),
  },
  stage: {
    click: (x, y, options = {}) => request("stage.click", { x, y, options }),
  },
  rooms: {
    enterPrivateRoom: (flatId, options = {}) => request("rooms.enterPrivateRoom", { flatId, options }),
    enterPublicRoom: (query, options = {}) => request("rooms.enterPublicRoom", { query, options }),
  },
  navigator: {
    open: (view = "nav_pr", options = {}) => request("navigator.open", { view, options }),
  },
  windows: {
    clickElement: (windowId, elementId, options = {}) => request("windows.clickElement", { windowId, elementId, options }),
  },
  avatar: {
    walkTo: (x, y, furniId = 0, options = {}) => request("avatar.walkTo", { x, y, furniId, options }),
    walkToItem: (selector, options = {}) => request("avatar.walkToItem", { selector, options }),
    wave: (options = {}) => request("avatar.wave", { options }),
    dance: (number = 1, options = {}) => request("avatar.dance", { number, options }),
    stopDance: (options = {}) => request("avatar.stopDance", { options }),
    hcDance: (number = 1, options = {}) => request("avatar.hcDance", { number, options }),
    carryDrink: (options = {}) => request("avatar.carryDrink", { options }),
    applyLook: (figure, options = {}) => request("avatar.applyLook", { figure, options }),
  },
  social: {
    message: (accountId, message, options = {}) => request("social.message", { accountId, message, options }),
    addUser: (name, options = {}) => request("social.addUser", { name, options }),
    refreshRequests: (options = {}) => request("social.refreshRequests", { options }),
    acceptRequest: (accountId, options = {}) => request("social.acceptRequest", { accountId, options }),
    declineRequest: (accountId, options = {}) => request("social.declineRequest", { accountId, options }),
    removeFriend: (accountId, options = {}) => request("social.removeFriend", { accountId, options }),
    followFriend: (accountId, options = {}) => request("social.followFriend", { accountId, options }),
  },
  plants: {
    movePlant: (objectId, x, y, direction = 0, options = {}) => request("plants.movePlant", { objectId, x, y, direction, options }),
    waterPlant: (objectId, options = {}) => request("plants.waterPlant", { objectId, options }),
    harvestPlant: (objectId, options = {}) => request("plants.harvestPlant", { objectId, options }),
    compostPlant: (objectId, options = {}) => request("plants.compostPlant", { objectId, options }),
  },
  wallItems: {
    moveItem: (item, options = {}) => request("wallItems.moveItem", { item, options }),
    pickupItem: (itemId, options = {}) => request("wallItems.pickupItem", { itemId, options }),
  },
  furni: {
    findItems: (selector = {}, options = {}) => request("furni.findItems", { selector, options }),
    findItem: (selector = {}, options = {}) => request("furni.findItem", { selector, options }),
    moveFloorItem: (selector, x, y, direction = null, options = {}) => request("furni.moveFloorItem", { selector, x, y, direction, options }),
    rotateFloorItem: (selector, direction, options = {}) => request("furni.rotateFloorItem", { selector, direction, options }),
    useFloorItem: (selector, value = "0", options = {}) => request("furni.useFloorItem", { selector, value, options }),
    pickupFloorItem: (selector, options = {}) => request("furni.pickupFloorItem", { selector, options }),
    moveWallItem: (selector, location, options = {}) => request("furni.moveWallItem", { selector, location, options }),
    pickupWallItem: (selector, options = {}) => request("furni.pickupWallItem", { selector, options }),
    pickupItem: (selector, options = {}) => request("furni.pickupItem", { selector, options }),
  },
  fishing: {
    getState: (options = {}) => request("fishing.getState", { options }),
    walkToArea: (areaIdOrOptions = null, options = {}) => {
      const areaId = areaIdOrOptions && typeof areaIdOrOptions === "object" ? null : areaIdOrOptions;
      const resolvedOptions = areaIdOrOptions && typeof areaIdOrOptions === "object" ? areaIdOrOptions : options;
      return request("fishing.walkToArea", { areaId, options: resolvedOptions });
    },
    startFishing: (areaId, options = {}) => request("fishing.startFishing", { areaId, options }),
    minigameInput: (direction, options = {}) => request("fishing.minigameInput", { direction, options }),
    purchaseProduct: (productCode, options = {}) => request("fishing.purchaseProduct", { productCode, options }),
    registerDerby: (options = {}) => request("fishing.registerDerby", { options }),
    requestTokens: (options = {}) => request("fishing.requestTokens", { options }),
    requestProducts: (options = {}) => request("fishing.requestProducts", { options }),
    requestRodLevel: (options = {}) => request("fishing.requestRodLevel", { options }),
    requestStats: (options = {}) => request("fishing.requestStats", { options }),
    requestFishopedia: (options = {}) => request("fishing.requestFishopedia", { options }),
  },
  engine: {
    getSnapshot: (clientId) => request("engine.getSnapshot", { clientId }),
  },
  client: {
    getRights: (options = {}) => request("client.getRights", { options }),
    setRights: (rights, options = {}) => request("client.setRights", { rights, options }),
    grantRights: (rights, options = {}) => request("client.grantRights", { rights, options }),
    removeRights: (rights, options = {}) => request("client.removeRights", { rights, options }),
    enableChooserCommands: (options = {}) => request("client.enableChooserCommands", { options }),
  },
  session: {
    getClients: () => request("session.getClients", {}),
  },
  storage: {
    get: (key, fallbackValue = null) => request("storage.get", { key }).then((value) => value === null || value === undefined ? fallbackValue : value),
    set: (key, value) => request("storage.set", { key, value }),
    delete: (key) => request("storage.delete", { key }),
  },
  console: {
    registerCommand: (command) => request("console.registerCommand", { command }),
  },
  ui: {
    registerPanel: (surface) => request("ui.registerPanel", { surface }),
  },
};

async function activatePlugin(source) {
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const pluginModule = await import(moduleUrl);
    if (typeof pluginModule.activate !== "function") throw new Error("Plugin entry must export activate(api).");
    const dispose = await pluginModule.activate(api);
    if (typeof dispose === "function") disposeCallbacks.push(dispose);
    postMessage({ type: "status", status: "active" });
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "init") {
    const plugin = message.plugin && typeof message.plugin === "object" ? message.plugin : {};
    pluginInfo.id = String(plugin.id ?? "");
    pluginInfo.name = String(plugin.name ?? "");
    pluginInfo.permissions = Array.isArray(plugin.permissions) ? plugin.permissions.map((entry) => String(entry)) : [];
    pluginInfo.surfaces = Array.isArray(plugin.surfaces) ? plugin.surfaces : [];
    activatePlugin(String(message.source || "")).catch((error) => log("error", error?.message || error));
    return;
  }
  if (message.type === "response") {
    const pendingRequest = pending.get(message.id);
    if (!pendingRequest) return;
    pending.delete(message.id);
    if (message.ok) pendingRequest.resolve(message.result);
    else pendingRequest.reject(new Error(String(message.error || "Plugin host request failed.")));
    return;
  }
  if (message.type === "event") {
    dispatchEvent(message.name, message.payload);
    return;
  }
  if (message.type === "dispose") {
    const callbacks = disposeCallbacks.splice(0);
    Promise.allSettled(callbacks.map((dispose) => Promise.resolve().then(dispose)))
      .then(() => postMessage({ type: "status", status: "disposed" }))
      .catch((error) => {
        log("error", error?.message || error);
        postMessage({ type: "status", status: "disposed" });
      });
  }
};
`;
}
