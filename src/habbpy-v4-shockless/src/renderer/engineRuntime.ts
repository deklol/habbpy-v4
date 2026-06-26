export type EngineWebviewElement = HTMLElement & {
  executeJavaScript<T>(code: string): Promise<T>;
  getWebContentsId?: () => number;
};

export interface RuntimeRoomReady {
  readonly ready?: boolean;
  readonly route?: string;
  readonly roomId?: string | number | null;
  readonly roomType?: string | null;
  readonly roomLikeSpriteCount?: number;
  readonly hasRoomVisualizer?: boolean;
  readonly hasRoomInterface?: boolean;
  readonly hasRoomComponent?: boolean;
  readonly roomComponentActive?: boolean;
}

export interface RuntimePerformanceStats {
  readonly currentFps?: number;
  readonly rafPerSecond?: number;
  readonly rafRate?: number;
  readonly directorTicksPerSecond?: number;
  readonly directorTickRate?: number;
  readonly frameTempo?: number;
  readonly activeTimeoutCount?: number;
  readonly worstRafDeltaMs?: number;
  readonly averageRafDeltaMs?: number;
}

export type EngineRuntimeSnapshotScope = "core" | "room" | "inventory" | "navigator" | "sprites" | "full";

export interface RuntimeSnapshotTiming {
  readonly name: string;
  readonly ms: number;
}

export interface RuntimeEditableField {
  readonly n: number;
  readonly member: string;
  readonly rect: readonly [number, number, number, number];
  readonly text: string;
}

export interface RuntimeChatEntry {
  readonly index?: number;
  readonly timestamp?: string;
  readonly userName?: string;
  readonly userId?: string | number;
  readonly chatMode?: string;
  readonly text?: string;
}

export interface RuntimeScriptBundle {
  readonly runtimeVersion?: string;
  readonly executableVersion?: string;
  readonly exact?: boolean;
  readonly executableScripts?: number;
  readonly profileScriptRecords?: number;
}

export interface RuntimeSpriteSummary {
  readonly n?: number;
  readonly member?: string;
  readonly type?: string;
  readonly loc?: readonly unknown[];
  readonly size?: readonly unknown[];
  readonly editable?: unknown;
}

export interface RuntimeObjectSummary {
  readonly id?: string | number;
  readonly objectId?: string | number;
  readonly className?: string;
  readonly name?: string;
  readonly ownerName?: string;
  readonly x?: string | number;
  readonly y?: string | number;
  readonly z?: string | number;
  readonly direction?: string | number;
  readonly wall?: string;
  readonly local?: string;
  readonly orientation?: string;
  readonly rawLocation?: string;
  readonly state?: string | number | null;
  readonly type?: string;
}

export interface RuntimeUserSummary extends RuntimeObjectSummary {
  readonly rowId: string;
  readonly roomIndex?: string | number;
  readonly accountId?: string | number;
  readonly gender?: string;
  readonly motto?: string;
  readonly figure?: string;
  readonly poolFigure?: string;
  readonly badgeCode?: string;
  readonly userType?: string;
  readonly objectClass?: string;
  readonly position?: string;
  readonly activity?: string;
  readonly typing?: boolean | null;
  readonly expression?: string;
  readonly lastSaid?: string;
  readonly lastAction?: string;
  readonly spriteCount?: number;
  readonly sourceKeys: readonly string[];
}

export interface RuntimeUserStateSummary {
  readonly source: string;
  readonly sessionUserName: string | null;
  readonly roomName: string | null;
  readonly roomOwner: string | null;
  readonly roomId: string | number | null;
  readonly roomType: string | null;
  readonly rightsCount: number;
  readonly rights: readonly string[];
  readonly roomUserCount: number;
  readonly users: readonly RuntimeUserSummary[];
  readonly sessionKeys: readonly string[];
  readonly missingProfileFields: readonly string[];
}

export interface RuntimeRoomObjectsSummary {
  readonly keys: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly users: readonly RuntimeUserSummary[];
  readonly activeObjects: readonly RuntimeObjectSummary[];
  readonly passiveObjects: readonly RuntimeObjectSummary[];
  readonly wallItems: readonly RuntimeObjectSummary[];
}

export interface RuntimeInventoryItemSummary {
  readonly rowId: string;
  readonly inventoryKind: string;
  readonly itemId: string | number;
  readonly className?: string;
  readonly objectId?: string | number;
  readonly slotId?: string | number;
  readonly size?: string;
  readonly colors?: string;
  readonly data?: string;
  readonly rawKeys: readonly string[];
}

export interface RuntimeInventorySummary {
  readonly source: string;
  readonly available: boolean;
  readonly openState: string | null;
  readonly totalCount: number;
  readonly itemCount: number;
  readonly floorCount: number;
  readonly wallCount: number;
  readonly hiddenCount: number;
  readonly items: readonly RuntimeInventoryItemSummary[];
  readonly rawKeys: readonly string[];
  readonly note?: string;
}

export interface RuntimeNavigatorSummary {
  readonly total: number;
  readonly categories: number;
  readonly publicRooms: number;
  readonly privateRooms: number;
  readonly sample: readonly RuntimeObjectSummary[];
  readonly publicRoomNodes: readonly RuntimeNavigatorNodeSummary[];
}

export interface RuntimeNavigatorNodeSummary {
  readonly id?: string | number;
  readonly name?: string;
  readonly unitStrId?: string;
  readonly port?: string | number;
  readonly users?: string | number;
  readonly maxUsers?: string | number;
  readonly nodeType?: string | number;
  readonly parentId?: string | number;
  readonly hidden?: string | number | boolean;
}

export interface RuntimeRoomEntryState {
  readonly roomReady?: RuntimeRoomReady;
  readonly entryState?: {
    readonly state?: string;
    readonly entryBarObject?: boolean;
    readonly entryVisualizerObject?: boolean;
  };
  readonly lastroom?: unknown;
  readonly roomComponent?: {
    readonly pActiveFlag?: number | boolean;
    readonly pRoomId?: string | number | null;
    readonly pReportRoomId?: string | number | null | unknown;
    readonly pCastLoaded?: number | boolean;
    readonly pSaveData?: unknown;
  };
  readonly publicNodes?: readonly unknown[];
}

export interface EngineRuntimeSnapshot {
  readonly dataScopes?: readonly EngineRuntimeSnapshotScope[];
  readonly snapshotTimings?: readonly RuntimeSnapshotTiming[];
  readonly snapshotTotalMs?: number;
  readonly hasEngine: boolean;
  readonly title: string;
  readonly href: string;
  readonly errors: number;
  readonly frame: number | null;
  readonly castLoaded: boolean | null;
  readonly loadedCastCount: number;
  readonly networkBridgeUrl: string | null;
  readonly roomReady: RuntimeRoomReady | null;
  readonly roomEntryState: RuntimeRoomEntryState | null;
  readonly performanceStats: RuntimePerformanceStats | null;
  readonly editableFields: readonly RuntimeEditableField[];
  readonly windowIds: readonly string[];
  readonly objectCount: number;
  readonly chatHistory: readonly RuntimeChatEntry[];
  readonly scriptBundle: RuntimeScriptBundle | null;
  readonly activeSprites: readonly RuntimeSpriteSummary[];
  readonly roomObjects: RuntimeRoomObjectsSummary | null;
  readonly userState: RuntimeUserStateSummary | null;
  readonly inventory: RuntimeInventorySummary | null;
  readonly navigator: RuntimeNavigatorSummary | null;
  readonly customHotelView: unknown;
}

export type EngineRuntimeAction =
  | { readonly kind: "showHotelView" }
  | { readonly kind: "openNavigator"; readonly view?: string }
  | { readonly kind: "enterPrivateRoom"; readonly flatId?: string; readonly waitUntilReady?: boolean; readonly timeoutMs?: number }
  | { readonly kind: "enterPublicRoom"; readonly query?: string }
  | { readonly kind: "requestInventory" }
  | { readonly kind: "hideBulletinBoard" }
  | { readonly kind: "setUserNameLabels"; readonly enabled: boolean }
  | { readonly kind: "setRoomStageZoom"; readonly scale: 1 | 2 }
  | { readonly kind: "clientRights"; readonly mode: "get" | "set" | "grant" | "remove"; readonly rights?: readonly string[] }
  | { readonly kind: "userWindowAction"; readonly action: "wave" | "dance" | "hcdance" }
  | { readonly kind: "sendChat"; readonly message: string }
  | { readonly kind: "stageClick"; readonly x: number; readonly y: number }
  | { readonly kind: "clickWindowElement"; readonly windowId: string; readonly elementId: string };

export interface EngineRuntimeActionResult {
  readonly ok: boolean;
  readonly message: string;
  readonly result?: unknown;
}

export async function readEngineRuntimeSnapshot(
  webview: EngineWebviewElement,
  scopes: readonly EngineRuntimeSnapshotScope[] = ["full"],
): Promise<EngineRuntimeSnapshot> {
  return webview.executeJavaScript<EngineRuntimeSnapshot>(`
    (async (requestedScopes) => {
      const snapshotStartedAt = performance.now();
      const dataScopes = Array.isArray(requestedScopes) && requestedScopes.length > 0 ? requestedScopes : ["full"];
      const scopeSet = new Set(dataScopes);
      const hasScope = (scope) => scopeSet.has("full") || scopeSet.has(scope);
      const includeRoom = hasScope("room");
      const includeInventory = hasScope("inventory");
      const includeNavigator = hasScope("navigator");
      const includeSprites = hasScope("sprites");
      const timings = [];
      const timed = async (name, run) => {
        const started = performance.now();
        try {
          return await run();
        } finally {
          timings.push({ name, ms: Math.round((performance.now() - started) * 100) / 100 });
        }
      };
      const root = window.__engine || null;
      const dev = root?.dev || null;
      const safe = async (name, fn, fallback = null, args = []) => timed(name, async () => {
        try {
          return typeof fn === "function" ? await Promise.resolve(fn(...args)) : fallback;
        } catch (error) {
          return fallback;
        }
      });
      const rootSafe = async (name, fallback = null, args = []) => safe("root." + name, root?.[name], fallback, args);
      const devSafe = async (name, fallback = null, args = []) => safe("dev." + name, dev?.[name], fallback, args);
      const plainKey = (key) => {
        if (key == null) return "";
        if (typeof key === "string" || typeof key === "number" || typeof key === "boolean") return String(key);
        if (typeof key !== "object") return String(key);
        return String(key.name ?? key.value ?? key.symbol ?? key.key ?? "");
      };
      const nativeValue = (value) => {
        if (value == null || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map(nativeValue);
        if (value.type === "symbol") return "#" + plainKey(value);
        if (value.type === "list" && Array.isArray(value.items)) return value.items.map(nativeValue);
        if (Array.isArray(value.entries)) {
          if (value.type === "list") return value.entries.map((entry) => nativeValue(entry?.value ?? entry));
          const out = {};
          for (const entry of value.entries) {
            const key = plainKey(entry?.key ?? entry?.name ?? entry?.prop);
            if (key) out[key] = nativeValue(entry?.value);
          }
          return out;
        }
        if ("value" in value && Object.keys(value).length <= 3) return nativeValue(value.value);
        const out = {};
        for (const [key, entry] of Object.entries(value)) out[key] = nativeValue(entry);
        return out;
      };
      const propEntries = (value) => {
        if (!value || typeof value !== "object") return [];
        if (Array.isArray(value.entries)) {
          return value.entries.map((entry, index) => ({
            key: plainKey(entry?.key ?? entry?.name ?? entry?.prop ?? index + 1),
            value: nativeValue(entry?.value ?? entry),
          }));
        }
        return Object.entries(value).map(([key, entry]) => ({ key, value: nativeValue(entry) }));
      };
      const loadedCasts = await rootSafe("loadedCasts", []);
      const objectIds = await rootSafe("objectIds", []);
      const chatHistory = includeRoom ? await devSafe("chatHistory", []) : [];
      const activeSprites = includeSprites ? await rootSafe("activeSprites", []) : [];
      const rawRoomObjects = includeRoom ? await rootSafe("roomObjects", null) : null;
      const rawNavigatorNodes = includeNavigator ? await devSafe("navigatorNodes", []) : [];
      const compactObject = (entry) => {
        if (!entry || typeof entry !== "object") return {};
        const asText = (value) => {
          const native = nativeValue(value);
          if (native == null || native === "") return undefined;
          if (Array.isArray(native)) return native.map(asText).filter(Boolean).join(", ");
          if (typeof native === "object") return undefined;
          return String(native);
        };
        const location = entry.location ?? entry.wallLocation ?? entry.wall_location ?? entry.loc;
        const locNative = nativeValue(entry.loc);
        const locArray = Array.isArray(locNative) ? locNative : [];
        const locationSource = location && typeof location === "object" ? location : {};
        const wallX = entry.wallX ?? entry.wall_x ?? locationSource.wallX ?? locationSource.wall_x;
        const wallY = entry.wallY ?? entry.wall_y ?? locationSource.wallY ?? locationSource.wall_y;
        const localX = entry.localX ?? entry.local_x ?? locationSource.localX ?? locationSource.local_x;
        const localY = entry.localY ?? entry.local_y ?? locationSource.localY ?? locationSource.local_y;
        const directionNative = nativeValue(entry.direction ?? entry.dir);
        const direction = Array.isArray(directionNative) ? directionNative[0] : directionNative;
        const wall =
          asText(entry.wall ?? entry.wallPos ?? entry.wall_pos ?? locationSource.wall ?? locationSource.rawWall) ??
          (wallX != null || wallY != null ? [asText(wallX) ?? "-", asText(wallY) ?? "-"].join(",") : undefined);
        const local =
          asText(entry.local ?? entry.localPos ?? entry.local_pos ?? locationSource.local) ??
          (localX != null || localY != null ? [asText(localX) ?? "-", asText(localY) ?? "-"].join(",") : undefined);
        return {
          id: entry.id ?? entry.item_id ?? entry.object_id ?? entry.account_id ?? entry.index,
          objectId: entry.objectId ?? entry.object_id ?? entry.item_id,
          className: entry.className ?? entry.class_name ?? entry.class ?? entry.name,
          name: entry.name ?? entry.userName ?? entry.ownerName,
          ownerName: entry.ownerName ?? entry.owner_name ?? entry.owner,
          x: entry.x ?? entry.locX ?? entry.tileX ?? locArray[0],
          y: entry.y ?? entry.locY ?? entry.tileY ?? locArray[1],
          z: entry.z ?? locArray[2],
          direction,
          wall,
          local,
          orientation: entry.orientation ?? entry.face ?? locationSource.orientation ?? locationSource.dir,
          rawLocation: entry.rawLocation ?? entry.raw_location ?? locationSource.raw,
          state: entry.state ?? entry.data ?? null,
          type: entry.type ?? entry.user_type ?? entry.item_type,
        };
      };
      const arrayFrom = (value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
      const safeKeys = (entry) =>
        Object.keys(entry || {}).filter((key) => !["#password", "password", "#email", "email", "#totp", "totp"].includes(key.toLowerCase()));
      const valueText = (value) => {
        const native = nativeValue(value);
        if (native == null || native === "") return undefined;
        if (Array.isArray(native)) return native.map((item) => valueText(item) ?? "").filter(Boolean).join(", ");
        if (typeof native === "object") return undefined;
        return String(native);
      };
      const compactUser = (entry, index) => {
        const base = compactObject(entry);
        const native = nativeValue(entry);
        const source = native && typeof native === "object" ? native : {};
        const loc = Array.isArray(source.loc)
          ? source.loc.map((part) => valueText(part) ?? "-").join(", ")
          : valueText(source.loc ?? entry?.loc);
        const sprites = source.sprites && typeof source.sprites === "object" ? source.sprites : entry?.sprites;
        const type = valueText(source.type ?? entry?.type ?? entry?.user_type ?? entry?.class);
        return {
          ...base,
          rowId: String(source.index ?? source.id ?? source.key ?? entry?.index ?? entry?.id ?? entry?.key ?? index),
          roomIndex: source.index ?? source.id ?? source.key ?? entry?.index ?? entry?.id ?? entry?.key,
          accountId: source.account_id ?? source.accountId ?? source.accountID ?? entry?.account_id ?? entry?.accountId,
          gender: valueText(source.gender ?? source.sex ?? entry?.gender ?? entry?.sex),
          motto: valueText(source.custom ?? source.motto ?? source.mission ?? entry?.custom ?? entry?.motto ?? entry?.mission),
          figure: valueText(source.figure ?? entry?.figure),
          poolFigure: valueText(source.pool_figure ?? source.ph_figure ?? entry?.pool_figure ?? entry?.ph_figure),
          badgeCode: valueText(source.badge_code ?? source.badgeCode ?? entry?.badge_code ?? entry?.badgeCode),
          userType: type,
          objectClass: valueText(source.object ?? entry?.object ?? entry?.className ?? entry?.class),
          position: loc,
          activity: valueText(source.activity ?? entry?.activity),
          typing: typeof source.typing === "boolean" ? source.typing : typeof entry?.typing === "boolean" ? entry.typing : null,
          expression: valueText(source.expression ?? entry?.expression),
          lastSaid: valueText(source.last_said ?? source.lastSaid ?? entry?.last_said ?? entry?.lastSaid),
          lastAction: valueText(source.last_action ?? source.lastAction ?? source.action ?? entry?.last_action ?? entry?.lastAction ?? entry?.action),
          spriteCount: sprites && typeof sprites === "object" ? Object.keys(sprites).length : undefined,
          sourceKeys: safeKeys(entry).slice(0, 30),
        };
      };
      const sessionObject = includeRoom ? await rootSafe("objectProps", null, ["Session"]) : null;
      const sessionProps = sessionObject?.props ?? sessionObject?.properties ?? sessionObject ?? {};
      const sessionItemList =
        sessionProps?.ancestor?.props?.pitemlist ??
        sessionProps?.ancestor?.props?.pItemList ??
        sessionProps?.pitemlist ??
        sessionProps?.pItemList ??
        null;
      const sessionEntries = propEntries(sessionItemList);
      const sessionValue = (...keys) => {
        const lowered = keys.map((key) => String(key).toLowerCase());
        return sessionEntries.find((entry) => lowered.includes(String(entry.key).toLowerCase()))?.value;
      };
      const sessionUserName = valueText(sessionValue("#userName", "userName"));
      const lastRoom = nativeValue(sessionValue("lastroom"));
      const roomValue = (...keys) => {
        if (!lastRoom || typeof lastRoom !== "object") return undefined;
        const lowered = keys.map((key) => String(key).toLowerCase());
        return Object.entries(lastRoom).find(([key]) => lowered.includes(String(key).toLowerCase()))?.[1];
      };
      const rights = nativeValue(sessionValue("user_rights"));
      const rightsList = Array.isArray(rights) ? rights.map((right) => String(right)).filter(Boolean) : [];
      const safeSessionKeys = sessionEntries.map((entry) => String(entry.key)).filter((key) => !["#password", "password", "#email", "email", "#totp", "totp"].includes(key.toLowerCase()));
      const rawUsers = rawRoomObjects && typeof rawRoomObjects === "object"
        ? arrayFrom(rawRoomObjects.users ?? rawRoomObjects.roomUsers ?? rawRoomObjects.people)
        : [];
      const userSummaries = rawUsers.slice(0, 20).map(compactUser);
      const missingProfileFields = [
        ["account id", userSummaries.some((user) => user.accountId != null)],
        ["gender", userSummaries.some((user) => user.gender)],
        ["motto", userSummaries.some((user) => user.motto)],
        ["badge", userSummaries.some((user) => user.badgeCode)],
        ["figure", userSummaries.some((user) => user.figure)],
        ["pool figure", userSummaries.some((user) => user.poolFigure)],
        ["speech/action history", userSummaries.some((user) => user.lastSaid || user.lastAction)],
      ].filter(([, available]) => !available).map(([label]) => label);
      const roomObjects = (() => {
        if (!rawRoomObjects || typeof rawRoomObjects !== "object") return null;
        const keys = Object.keys(rawRoomObjects).sort();
        const users = rawUsers;
        const activeObjects = arrayFrom(rawRoomObjects.activeObjects ?? rawRoomObjects.active ?? rawRoomObjects.floorItems);
        const passiveObjects = arrayFrom(rawRoomObjects.passiveObjects ?? rawRoomObjects.passive);
        const wallItems = arrayFrom(rawRoomObjects.wallItems ?? rawRoomObjects.wall);
        return {
          keys,
          counts: {
            users: users.length,
            activeObjects: activeObjects.length,
            passiveObjects: passiveObjects.length,
            wallItems: wallItems.length,
          },
          users: userSummaries,
          activeObjects: activeObjects.slice(0, 100).map(compactObject),
          passiveObjects: passiveObjects.slice(0, 100).map(compactObject),
          wallItems: wallItems.slice(0, 100).map(compactObject),
        };
      })();
      const userState = sessionEntries.length > 0 || userSummaries.length > 0 ? {
        source: "Session.pitemlist + roomObjects.users",
        sessionUserName: sessionUserName ?? null,
        roomName: valueText(roomValue("#name", "name")) ?? null,
        roomOwner: valueText(roomValue("#owner", "owner")) ?? null,
        roomId: roomValue("#flatId", "#id", "flatId", "id") ?? null,
        roomType: valueText(roomValue("#type", "type")) ?? null,
        rightsCount: rightsList.length,
        rights: rightsList.slice(0, 24),
        roomUserCount: rawUsers.length,
        users: userSummaries,
        sessionKeys: safeSessionKeys.slice(0, 36),
        missingProfileFields,
      } : null;
      const inventory = includeInventory ? await timed("derive.inventory", async () => {
        const container = await rootSafe("objectProps", null, ["Room_container"]);
        if (!container || typeof container !== "object") return null;
        const props = container.props ?? container.properties ?? container;
        const itemList = props.pitemlist ?? props.pItemList ?? props.PItemList;
        const hiddenIds = props.phiddenids ?? props.pHiddenIds ?? null;
        const entries = propEntries(itemList);
        const items = entries.map((entry, index) => {
          const value = entry.value && typeof entry.value === "object" ? entry.value : {};
          const stripType = String(value.striptype ?? value.stripType ?? value.type ?? "").replace(/^#/, "").toLowerCase();
          const inventoryKind = stripType === "active" ? "floor" : stripType === "item" ? "wall" : stripType || "unknown";
          const width = value.width ?? value.w ?? value.dimensions?.[0];
          const length = value.length ?? value.l ?? value.dimensions?.[1];
          const size = width != null || length != null ? [width ?? "-", length ?? "-"].join(" x ") : undefined;
          return {
            rowId: String(value.stripId ?? value.stripid ?? value.item_id ?? entry.key ?? index),
            inventoryKind,
            itemId: value.stripId ?? value.stripid ?? entry.key ?? index,
            className: value.class ?? value.className ?? value.name,
            objectId: value.id ?? value.objectId ?? value.object_id,
            slotId: value.slotId ?? value.slot_id ?? value.slot,
            size,
            colors: value.colors ?? value.color,
            data: value.props ?? value.data ?? value.extra,
            rawKeys: Object.keys(value).slice(0, 24),
          };
        });
        return {
          source: "Room_container.pItemList",
          available: true,
          openState: props.panimmode ?? props.pAnimMode ?? null,
          totalCount: Number(props.ptotalcount ?? props.pTotalCount ?? items.length) || 0,
          itemCount: items.length,
          floorCount: items.filter((item) => item.inventoryKind === "floor").length,
          wallCount: items.filter((item) => item.inventoryKind === "wall").length,
          hiddenCount: Array.isArray(nativeValue(hiddenIds)) ? nativeValue(hiddenIds).length : 0,
          items: items.slice(0, 60),
          rawKeys: Object.keys(props).slice(0, 40),
          note: items.length === 0 ? "Hand inventory is currently empty." : undefined,
        };
      }) : null;
      const navigator = includeNavigator ? timed("derive.navigator", async () => {
        const nodes = arrayFrom(rawNavigatorNodes);
        if (nodes.length === 0) return null;
        const categoryCount = nodes.filter((entry) => String(entry?.type ?? entry?.nodeType ?? "").toLowerCase().includes("category")).length;
        const publicRooms = nodes.filter((entry) => {
          const text = [entry?.type, entry?.roomType, entry?.unitStrId, entry?.name].join(" ").toLowerCase();
          return text.includes("public") || Boolean(entry?.unitStrId);
        });
        const privateRooms = nodes.filter((entry) => {
          const text = [entry?.type, entry?.roomType].join(" ").toLowerCase();
          return text.includes("private") || Boolean(entry?.flatId);
        });
        return {
          total: nodes.length,
          categories: categoryCount,
          publicRooms: publicRooms.length,
          privateRooms: privateRooms.length,
          sample: nodes.slice(0, 8).map(compactObject),
          publicRoomNodes: publicRooms.slice(0, 40).map((entry) => ({
            id: entry?.id,
            name: valueText(entry?.name),
            unitStrId: valueText(entry?.unitStrId),
            port: entry?.port,
            users: entry?.users,
            maxUsers: entry?.maxUsers,
            nodeType: entry?.nodeType,
            parentId: entry?.parentId,
            hidden: entry?.hidden,
          })),
        };
      }) : Promise.resolve(null);
      const navigatorValue = await navigator;
      const frameValue = await rootSafe("frame", null);
      return {
        dataScopes,
        hasEngine: Boolean(root),
        title: document.title || "",
        href: location.href,
        errors: Number(await rootSafe("errors", 0)) || 0,
        frame: Number.isFinite(Number(frameValue)) ? Number(frameValue) : null,
        castLoaded: await rootSafe("castLoaded", null),
        loadedCastCount: Array.isArray(loadedCasts) ? loadedCasts.length : 0,
        networkBridgeUrl: await rootSafe("networkBridgeUrl", null),
        roomReady: await devSafe("roomReady", null),
        roomEntryState: await devSafe("roomEntryState", null),
        performanceStats: await devSafe("performanceStats", null),
        editableFields: await devSafe("editableFields", []),
        windowIds: await devSafe("windowIds", []),
        objectCount: Array.isArray(objectIds) ? objectIds.length : 0,
        chatHistory: Array.isArray(chatHistory) ? chatHistory.slice(-5000) : [],
        scriptBundle: await devSafe("scriptBundle", null),
        activeSprites: Array.isArray(activeSprites) ? activeSprites.slice(0, 20).map((entry) => ({
          n: entry?.n,
          member: entry?.member,
          type: entry?.type,
          loc: entry?.loc,
          size: entry?.size,
          editable: entry?.editable,
        })) : [],
        roomObjects,
        userState,
        inventory,
        navigator: navigatorValue,
        customHotelView: await devSafe("customHotelView", null),
        snapshotTimings: timings,
        snapshotTotalMs: Math.round((performance.now() - snapshotStartedAt) * 100) / 100,
      };
    })(${JSON.stringify(scopes)})
  `);
}

export async function runEngineRuntimeAction(
  webview: EngineWebviewElement,
  action: EngineRuntimeAction,
): Promise<EngineRuntimeActionResult> {
  return webview.executeJavaScript<EngineRuntimeActionResult>(`
    (async (action) => {
      const dev = window.__engine?.dev;
      if (!dev) return { ok: false, message: "Shockless dev API is not ready." };
      try {
        if (action.kind === "showHotelView") {
          if (typeof dev.showHotelView !== "function") return { ok: false, message: "Hotel view helper is not available." };
          const result = await dev.showHotelView();
          return { ok: true, message: "Hotel view command routed through Shockless helpers.", result };
        }
        if (action.kind === "openNavigator") {
          const view = action.view || "nav_pr";
          if (typeof dev.navigatorView === "function") {
            const result = await dev.navigatorView(view);
            return { ok: true, message: "Navigator opened through Shockless helpers.", result };
          }
          if (typeof dev.openNavigator === "function") {
            const result = await dev.openNavigator();
            return { ok: true, message: "Navigator opened through Shockless helpers.", result };
          }
          return { ok: false, message: "Navigator helper is not available." };
        }
        if (action.kind === "enterPrivateRoom") {
          if (typeof dev.enterPrivateRoom !== "function") return { ok: false, message: "Private room entry helper is not available." };
          const flatId = String(action.flatId || "").trim();
          const waitUntilReady = action.waitUntilReady !== false;
          const timeoutMs = Number.isFinite(action.timeoutMs) && action.timeoutMs > 0 ? Number(action.timeoutMs) : 90000;
          const result = flatId ? await dev.enterPrivateRoom(flatId, waitUntilReady, timeoutMs) : await dev.enterPrivateRoom(undefined, waitUntilReady, timeoutMs);
          return { ok: true, message: "Private room entry command routed through Shockless helpers.", result };
        }
        if (action.kind === "enterPublicRoom") {
          if (typeof dev.enterPublicRoom !== "function") return { ok: false, message: "Public room entry helper is not available." };
          const query = String(action.query || "").trim();
          const result = query ? await dev.enterPublicRoom(query, 90000) : await dev.enterPublicRoom(undefined, 90000);
          if (Array.isArray(result?.errors) && result.errors.length > 0) {
            return { ok: false, message: result.errors.join("; "), result };
          }
          return { ok: true, message: "Public room entry command routed through Navigator helpers.", result };
        }
        if (action.kind === "requestInventory") {
          const root = window.__engine;
          const container =
            typeof root?.objectProps === "function"
              ? await Promise.resolve(root.objectProps("Room_container")).catch(() => null)
              : null;
          const props = container?.props ?? container?.properties ?? container ?? {};
          const openState = String(props.panimmode ?? props.pAnimMode ?? "");
          if (openState.toLowerCase().includes("open")) {
            return { ok: true, message: "Hand inventory is already open; refreshed live Room_container data.", result: { openState } };
          }
          if (typeof dev.clickWindowElement !== "function") return { ok: false, message: "Runtime window click helper is not available." };
          const windows = typeof dev.windowIds === "function" ? await dev.windowIds() : [];
          if (!Array.isArray(windows) || !windows.includes("Room_bar")) {
            return { ok: false, message: "Room bar is not available yet; enter Codex Test Lab before requesting inventory." };
          }
          const result = await dev.clickWindowElement("Room_bar", "int_hand_image");
          if (result?.clicked === false || result === false) {
            return { ok: false, message: "Room bar hand icon click did not resolve to a runtime sprite.", result };
          }
          return { ok: true, message: "Hand inventory requested through Room_bar int_hand_image click.", result };
        }
        if (action.kind === "userWindowAction") {
          if (typeof dev.clickWindowElement !== "function") return { ok: false, message: "Runtime window click helper is not available." };
          const elementByAction = {
            wave: "wave.button",
            dance: "dance.button",
            hcdance: "hcdance.button",
          };
          const actionName = String(action.action || "");
          const elementId = elementByAction[actionName];
          if (!elementId) return { ok: false, message: "Unknown user action." };
          const result = await dev.clickWindowElement("Room_interface", elementId);
          if (result?.clicked === false || result === false || result?.error) {
            return { ok: false, message: result?.error || \`Room_interface:\${elementId} did not resolve to a clickable runtime sprite.\`, result };
          }
          return { ok: true, message: \`User \${actionName} routed through Room_interface:\${elementId}.\`, result };
        }
        if (action.kind === "hideBulletinBoard") {
          if (typeof dev.clickWindowElement !== "function") return { ok: false, message: "Runtime window click helper is not available." };
          const ids = typeof dev.windowIds === "function" ? await Promise.resolve(dev.windowIds()).catch(() => []) : [];
          const windows = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
          const bulletinWindows = windows.filter((id) => /bulletin|welcome|news/i.test(id));
          if (bulletinWindows.length === 0) {
            return { ok: true, message: "No Bulletin Board window is visible.", result: { closed: false, reason: "not-visible", windows } };
          }
          const flattenElements = (elements) => {
            const rows = [];
            const visit = (entry) => {
              if (!entry || typeof entry !== "object") return;
              rows.push(entry);
              const children = Array.isArray(entry.children) ? entry.children : [];
              for (const child of children) visit(child);
            };
            for (const entry of Array.isArray(elements) ? elements : []) visit(entry);
            return rows;
          };
          const scoreElement = (entry) => {
            const text = [entry.id, entry.class, entry.type, entry.text, entry.name, entry.member].join(" ").toLowerCase();
            if (!text.trim()) return 0;
            if (/\b(close|closed|exit|cancel|ok|done)\b/.test(text)) return 10;
            if (/x|cross/.test(text)) return 4;
            return 0;
          };
          const fallbackElementIds = ["close", "button_close", "btn_close", "header_button_close", "close_button", "ok", "cancel"];
          for (const windowId of bulletinWindows) {
            const elements = typeof dev.windowElements === "function"
              ? await Promise.resolve(dev.windowElements(windowId)).catch(() => [])
              : [];
            const ranked = flattenElements(elements)
              .filter((entry) => entry?.id != null)
              .map((entry) => ({ id: String(entry.id), score: scoreElement(entry) }))
              .filter((entry) => entry.score > 0)
              .sort((left, right) => right.score - left.score);
            const candidateIds = [...new Set([...ranked.map((entry) => entry.id), ...fallbackElementIds])];
            for (const elementId of candidateIds) {
              const result = await Promise.resolve(dev.clickWindowElement(windowId, elementId)).catch((error) => ({ error: String(error) }));
              if (result?.clicked === false || result === false || result?.error) continue;
              return { ok: true, message: "Bulletin Board hidden through runtime window controls.", result: { closed: true, windowId, elementId, result } };
            }
          }
          return { ok: false, message: "Bulletin Board was visible, but no close element resolved to a runtime sprite.", result: { windows: bulletinWindows } };
        }
        if (action.kind === "setUserNameLabels") {
          if (typeof dev.setUserNameLabels !== "function") return { ok: false, message: "Engine username label helper is not available." };
          const result = await dev.setUserNameLabels(Boolean(action.enabled));
          return {
            ok: true,
            message: Boolean(action.enabled) ? "Engine username labels enabled." : "Engine username labels disabled.",
            result,
          };
        }
        if (action.kind === "setRoomStageZoom") {
          if (typeof dev.setRoomStageZoom !== "function") return { ok: false, message: "Engine room zoom helper is not available." };
          const scale = Number(action.scale) >= 2 ? 2 : 1;
          const result = await dev.setRoomStageZoom(scale);
          return {
            ok: true,
            message: scale === 2 ? "Room stage zoom set to 200%." : "Room stage zoom set to 100%.",
            result,
          };
        }
        if (action.kind === "clientRights") {
          const root = window.__engine;
          if (typeof root?.objectMethod !== "function") return { ok: false, message: "Source Session object helper is not available." };
          const cleanRight = (value) => {
            const text = String(value ?? "").trim();
            return /^[A-Za-z0-9_.:-]{1,96}$/.test(text) ? text : "";
          };
          const listFromSummary = (value) => {
            if (Array.isArray(value)) return value.map(cleanRight).filter(Boolean);
            if (value && typeof value === "object" && Array.isArray(value.items)) return value.items.map(cleanRight).filter(Boolean);
            return [];
          };
          const uniqueRights = (values) => {
            const seen = new Set();
            const out = [];
            for (const value of values) {
              const right = cleanRight(value);
              if (!right) continue;
              const key = right.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              out.push(right);
            }
            return out;
          };
          const before = uniqueRights(listFromSummary(await Promise.resolve(root.objectMethod("session", "get", ["user_rights", []]))));
          const mode = String(action.mode || "get").toLowerCase();
          const requested = uniqueRights(Array.isArray(action.rights) ? action.rights : []);
          if (mode === "get") {
            return { ok: true, message: "Client rights read from source Session.", result: { source: "Session.user_rights", rights: before } };
          }
          if (requested.length === 0) return { ok: false, message: "Client rights action needs at least one right." };
          let next = before;
          if (mode === "set") next = requested;
          else if (mode === "grant") next = uniqueRights([...before, ...requested]);
          else if (mode === "remove") {
            const removing = new Set(requested.map((right) => right.toLowerCase()));
            next = before.filter((right) => !removing.has(right.toLowerCase()));
          } else {
            return { ok: false, message: "Unknown client rights mode." };
          }
          const setResult = await Promise.resolve(root.objectMethod("session", "set", ["user_rights", next]));
          const rights = uniqueRights(listFromSummary(await Promise.resolve(root.objectMethod("session", "get", ["user_rights", []]))));
          return {
            ok: true,
            message: \`Client rights \${mode} applied through source Session.\`,
            result: { source: "Session.user_rights", before, requested, rights, setResult },
          };
        }
        if (action.kind === "sendChat") {
          const message = String(action.message || "").trim();
          if (!message) return { ok: false, message: "Enter a chat message first." };
          if (typeof dev.sendChat !== "function") return { ok: false, message: "Chat send helper is not available." };
          const result = await dev.sendChat(message, 0);
          return { ok: true, message: "Chat message sent through the live Director chat field.", result };
        }
        if (action.kind === "stageClick") {
          const x = Number(action.x);
          const y = Number(action.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, message: "Stage click needs numeric x/y stage coordinates." };
          if (typeof dev.stageClick !== "function") return { ok: false, message: "Stage click helper is not available." };
          const result = await dev.stageClick(x, y);
          return { ok: true, message: "Stage click routed through Director pointer events.", result };
        }
        if (action.kind === "clickWindowElement") {
          const windowId = String(action.windowId || "").trim();
          const elementId = String(action.elementId || "").trim();
          if (!windowId || !elementId) return { ok: false, message: "Window element click needs a window id and element id." };
          if (typeof dev.clickWindowElement !== "function") return { ok: false, message: "Window element click helper is not available." };
          const result = await dev.clickWindowElement(windowId, elementId);
          if (result?.clicked === false || result === false) {
            return { ok: false, message: "Runtime window element did not resolve to a clickable sprite.", result };
          }
          return { ok: true, message: "Window element click routed through sprite events.", result };
        }
        return { ok: false, message: "Unknown runtime action." };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    })(${JSON.stringify(action)})
  `);
}
