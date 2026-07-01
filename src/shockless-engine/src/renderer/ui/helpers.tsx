import {
  Activity,
  Bot,
  CircleAlert,
  Command,
  Hammer,
  Info,
  List,
  Map,
  MessageSquare,
  Package,
  Plug,
  Sofa,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import {
  compactRuntimeValue,
  runtimeFps,
  runtimeItemRows,
  runtimeLocation,
  runtimeRoomId,
  runtimeRoomName,
  runtimeRoomOwner,
  runtimeRoomProp,
  runtimeRoomType,
  runtimeTickRate,
  summarizeRuntimeSnapshot,
  type RuntimeItemRow,
} from "../../engine-adapter/shocklessSessionAdapter";
import type {
  EngineRuntimeAction,
  EngineRuntimeSnapshot,
  EngineRuntimeSnapshotScope,
  RuntimeChatEntry,
  RuntimeInventoryItemSummary,
  RuntimeObjectSummary,
  RuntimeUserSummary,
} from "../engineRuntime";
import { parseConsoleCommand, type ConsoleRendererAction } from "../../shared/consoleCommand";
import { encodeShockwaveBase64Int, formatShockwavePacketParts } from "../../shared/shockwavePacketText";
import type { PluginDefinition, PluginPermission } from "../../shared/plugin";
import type {
  ClientProfileSummary,
  ClientRuntimeSummary,
  ClientSessionList,
  ClientSnapshot,
  ClientSessionSummary,
  EngineLaunchState,
  FurniMetadataEntry,
  FurniMetadataSnapshot,
  ProfileImportProgress,
  ProfileImportStage,
  RelayLogDeltaSnapshot,
  RelayLogEntry,
  RelayLogSnapshot,
  MimicCategory,
  OriginsUserLookupResult,
  UserRelayAction,
} from "../../shared/window-api";
import type { RendererUserPluginHost } from "../userPluginHost";
import type { EngineRuntimeActionResult } from "../engineRuntime";

export const iconMap = {
  activity: Activity,
  bot: Bot,
  command: Command,
  list: List,
  map: Map,
  messages: MessageSquare,
  package: Package,
  plug: Plug,
  sofa: Sofa,
  terminal: Terminal,
  user: User,
  wrench: Wrench,
  hammer: Hammer,
  info: Info,
};

export function PluginIcon({ plugin }: { readonly plugin: PluginDefinition }) {
  const Icon = iconMap[plugin.icon as keyof typeof iconMap] ?? CircleAlert;
  return <Icon aria-hidden="true" size={17} strokeWidth={2.1} />;
}

export function labelCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function statusLabel(value: unknown): string {
  const label = labelCase(value);
  return label === "Done" ? "Complete" : label;
}

export function permissionLabel(value: unknown): string {
  return String(value ?? "")
    .split(".")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "ui" ? "UI" : labelCase(part)))
    .join(" ") || "-";
}

export function originLabel(value: unknown): string {
  return String(value ?? "") === "built-in" ? "Built-In" : labelCase(value);
}

export function profileLine(profile: ClientProfileSummary | null | undefined): string {
  if (!profile) return "No profile selected";
  const build = profile.buildNumber ? `build ${profile.buildNumber}` : profile.versionId;
  return `${profile.label} / ${build}`;
}

export function clientSessionTitle(session: ClientSessionSummary): string {
  const mode = session.headless ? "Headless" : session.visible ? "Visible" : "Hidden";
  const markers = [session.selected ? "Selected" : "", session.main ? "Main" : "", mode, statusLabel(session.status)].filter(Boolean).join(", ");
  return `client${session.id} ${session.label} (${markers})\n${session.profileLabel}`;
}

export interface GameWebviewMount {
  readonly id: number;
  readonly label: string;
  readonly url: string;
  readonly partition: string;
}

export function gameWebviewPartitionForClient(clientId: number): string {
  return clientId === 1 ? "persist:habbpy-v4-shockless" : `persist:habbpy-v4-shockless-client-${clientId}`;
}

export function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function chatEntryKey(entry: RuntimeChatEntry, index: number): string {
  return `${entry.index ?? index}-${entry.timestamp ?? ""}-${entry.userName ?? ""}`;
}

export function chatEntryLabel(entry: RuntimeChatEntry): string {
  const mode = String(entry.chatMode ?? "talk").toUpperCase();
  const user = entry.userName || "system";
  return `[${mode}] ${user}`;
}

export function chatEntryKind(entry: RuntimeChatEntry): "talk" | "whisper" | "shout" | "system" {
  const mode = String(entry.chatMode ?? "talk").toLowerCase();
  if (mode.includes("whisper")) return "whisper";
  if (mode.includes("shout")) return "shout";
  if (mode.includes("system")) return "system";
  return "talk";
}

export function compactValue(value: unknown): string {
  return compactRuntimeValue(value);
}

export function commandArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export const mimicCategoryOptions: readonly { readonly id: MimicCategory; readonly label: string; readonly detail: string }[] = [
  { id: "movement", label: "Movement", detail: "walk and look packets" },
  { id: "speech", label: "Speech", detail: "chat, shout, whisper, typing" },
  { id: "actions", label: "Actions", detail: "wave, dance, carry, sign" },
  { id: "rooms", label: "Rooms", detail: "private room joins" },
];

export function withVisibleConsoleContext(input: string, snapshot: EngineRuntimeSnapshot | null, activeNames: readonly string[] = []): string {
  const parsed = parseConsoleCommand(input);
  if (!parsed.ok) return input;
  const needsSummonContext =
    parsed.command.command === "summon" ||
    parsed.command.flags.some((flag) => flag.name === "summon");
  const needsVisibleAccountContext =
    needsSummonContext ||
    parsed.command.command === "login" ||
    parsed.command.command === "load" ||
    parsed.command.command === "load-store" ||
    parsed.command.command === "accounts";
  if (!needsVisibleAccountContext) return input;
  const existingFlags = new Set(parsed.command.flags.map((flag) => flag.name));
  const additions: string[] = [];
  const mainName = firstUsefulName([snapshot?.userState?.sessionUserName, ...activeNames]);
  if (mainName && !existingFlags.has("main-name")) additions.push(`--main-name ${commandArg(mainName)}`);
  if (!existingFlags.has("active-name")) {
    for (const name of uniqueUsefulNames([snapshot?.userState?.sessionUserName, ...activeNames])) {
      additions.push(`--active-name ${commandArg(name)}`);
    }
  }
  if (!needsSummonContext) return additions.length > 0 ? `${input} ${additions.join(" ")}` : input;
  const roomId = runtimeRoomId(snapshot);
  const privateRoom = runtimeRoomType(snapshot) === "private";
  if (privateRoom && roomId && roomId !== "-" && !existingFlags.has("main-room-id")) additions.push(`--main-room-id ${commandArg(roomId)}`);
  const roomName = runtimeRoomName(snapshot);
  if (privateRoom && roomName && roomName !== "-" && !existingFlags.has("main-room-name")) additions.push(`--main-room-name ${commandArg(roomName)}`);
  return additions.length > 0 ? `${input} ${additions.join(" ")}` : input;
}

export function uniqueUsefulNames(values: readonly unknown[]): readonly string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const name = String(value ?? "").trim();
    const key = name.toLowerCase();
    if (!name || name === "-" || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function firstUsefulName(values: readonly unknown[]): string {
  return uniqueUsefulNames(values)[0] ?? "";
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    tagName === "webview" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

export function bindingKeyFromKeyboardEvent(event: { readonly key: string; readonly code?: string; readonly ctrlKey: boolean; readonly altKey: boolean; readonly shiftKey: boolean; readonly metaKey: boolean }): string {
  const key = normalizeShortcutKey(event.key, "code" in event ? event.code : "");
  if (!key) return "";
  const parts = [
    event.ctrlKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.metaKey ? "Meta" : "",
    key,
  ].filter(Boolean);
  return parts.join("+");
}

export function normalizeShortcutKey(keyValue: string, codeValue = ""): string {
  if (codeValue === "Backquote" || keyValue === "`") return "Backquote";
  const key = String(keyValue ?? "").trim();
  if (!key) return "";
  if (/^F(?:[1-9]|1\d|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  return key;
}

export function objectTitle(entry: { readonly id?: unknown; readonly objectId?: unknown; readonly className?: unknown; readonly name?: unknown }): string {
  return compactValue(entry.name ?? entry.className ?? entry.objectId ?? entry.id);
}

export function normalizeFurniClassName(value: unknown): string {
  return String(value ?? "").replace(/^ZaC/i, "").trim().toLowerCase();
}

export function furniInfoForClass(metadata: FurniMetadataSnapshot | null, className: unknown): FurniMetadataEntry | null {
  const key = normalizeFurniClassName(className);
  return key ? metadata?.entriesByClass[key] ?? null : null;
}

export function furniInfoForObject(metadata: FurniMetadataSnapshot | null, entry: RuntimeObjectSummary | RuntimeInventoryItemSummary | null | undefined): FurniMetadataEntry | null {
  if (!entry) return null;
  const record = entry as Record<string, unknown>;
  return furniInfoForClass(metadata, record.className ?? record.name);
}

export function furniDisplayName(metadata: FurniMetadataSnapshot | null, entry: RuntimeObjectSummary | RuntimeInventoryItemSummary | null | undefined): string {
  if (!entry) return "-";
  const record = entry as Record<string, unknown>;
  return compactValue(
    furniInfoForObject(metadata, entry)?.name ??
      record.className ??
      record.name ??
      record.objectId ??
      record.itemId ??
      record.id,
  );
}

export function isRelayBackedConsoleCommand(command: string): boolean {
  return [
    "message",
    "msg",
    "pm",
    "adduser",
    "friend",
    "requests",
    "friendrequests",
    "refreshrequests",
    "accept",
    "acceptfriend",
    "decline",
    "declinefriend",
    "follow",
    "followfriend",
    "removefriend",
    "unfriend",
  ].includes(command);
}

export function commandRefreshesEngineLaunch(command: string, firstArg = ""): boolean {
  return [
    "start",
    "launch",
    "newclient",
    "addclient",
    "login",
    "load",
    "load-store",
    "close",
    "stop",
  ].includes(command) || (command === "accounts" && firstArg.toLowerCase() === "load");
}

export function objectMeta(entry: {
  readonly id?: unknown;
  readonly objectId?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly direction?: unknown;
  readonly state?: unknown;
  readonly type?: unknown;
}): string {
  const parts = [
    entry.objectId ?? entry.id ? `id ${compactValue(entry.objectId ?? entry.id)}` : "",
    entry.x !== undefined || entry.y !== undefined ? `xy ${compactValue(entry.x)},${compactValue(entry.y)}` : "",
    entry.direction !== undefined ? `dir ${compactValue(entry.direction)}` : "",
    entry.state !== undefined && entry.state !== null ? `state ${compactValue(entry.state)}` : "",
    entry.type !== undefined ? `type ${compactValue(entry.type)}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

export function wallObjectMeta(entry: RuntimeObjectSummary): string {
  const parts = [
    entry.objectId ?? entry.id ? `id ${compactValue(entry.objectId ?? entry.id)}` : "",
    entry.wall ? `wall ${entry.wall}` : "",
    entry.local ? `local ${entry.local}` : "",
    entry.orientation ? `face ${compactValue(entry.orientation)}` : entry.direction !== undefined ? `dir ${compactValue(entry.direction)}` : "",
    entry.state !== undefined && entry.state !== null ? `state ${compactValue(entry.state)}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || objectMeta(entry);
}

export function objectSearchText(entry: RuntimeObjectSummary): string {
  return [
    entry.id,
    entry.objectId,
    entry.className,
    entry.name,
    entry.ownerName,
    entry.type,
    entry.state,
    entry.wall,
    entry.local,
    entry.orientation,
    entry.rawLocation,
  ]
    .map(compactValue)
    .join(" ")
    .toLowerCase();
}

export function isPlantLikeObject(entry: RuntimeObjectSummary): boolean {
  const text = objectSearchText(entry);
  return ["farm", "garden", "plant", "flower", "blossom", "pumpkin", "seed", "compost", "harvest", "water"].some((token) =>
    text.includes(token),
  );
}

export function isFishingAreaObject(entry: RuntimeObjectSummary): boolean {
  const className = compactValue(entry.className ?? entry.name).trim().toLowerCase();
  return className.endsWith("fish_area");
}

export function isPresentCatcherHammerObject(entry: RuntimeObjectSummary): boolean {
  return compactValue(entry.className ?? entry.name).trim().toLowerCase() === "toby_hammer";
}

export function isPresentCatcherPresentObject(entry: RuntimeObjectSummary): boolean {
  return compactValue(entry.className ?? entry.name).trim().toLowerCase().startsWith("anniv_present_gen");
}

export function isPresentCatcherGiftItem(entry: RuntimeInventoryItemSummary, classFilter: string): boolean {
  const filter = classFilter.trim().toLowerCase();
  if (!filter) return false;
  const text = [entry.className, entry.itemId, entry.objectId, entry.slotId, entry.inventoryKind].map(compactValue).join(" ").toLowerCase();
  return text.includes(filter);
}

export const presentCatcherPacketHeaders = new Set([65, 74, 78, 90, 93, 94, 1240, 1241, 3400, 3401, 3402, 3403, 3404, 3600, 3601, 3602, 3603, 3604]);

export type ItemRow = RuntimeItemRow;

export interface WallMoverLocation {
  readonly wallX: number;
  readonly wallY: number;
  readonly localX: number;
  readonly localY: number;
  readonly orientation: "l" | "r";
}

export function objectNumericId(entry: RuntimeObjectSummary | null | undefined): number | null {
  const parsed = finiteNumber(entry?.objectId ?? entry?.id);
  return parsed === null ? null : Math.trunc(parsed);
}

export function signedPair(value: unknown): { readonly x: number; readonly y: number } | null {
  const match = compactValue(value).match(/(-?\d+)\s*,\s*(-?\d+)/);
  if (!match) return null;
  return { x: Number.parseInt(match[1]!, 10), y: Number.parseInt(match[2]!, 10) };
}

export function wallOrientation(value: unknown): "l" | "r" | null {
  const normalized = compactValue(value).trim().toLowerCase();
  if (normalized === "l" || normalized === "left") return "l";
  if (normalized === "r" || normalized === "right") return "r";
  return null;
}

export function wallMoverLocation(entry: RuntimeObjectSummary | null | undefined): WallMoverLocation | null {
  const raw = compactValue(entry?.rawLocation);
  const rawMatch = raw.match(/:w=(-?\d+)\s*,\s*(-?\d+)\s+l=(-?\d+)\s*,\s*(-?\d+)\s+([lr])/i);
  if (rawMatch) {
    return {
      wallX: Number.parseInt(rawMatch[1]!, 10),
      wallY: Number.parseInt(rawMatch[2]!, 10),
      localX: Number.parseInt(rawMatch[3]!, 10),
      localY: Number.parseInt(rawMatch[4]!, 10),
      orientation: rawMatch[5]!.toLowerCase() as "l" | "r",
    };
  }
  const wall = signedPair(entry?.wall);
  const local = signedPair(entry?.local);
  const orientation = wallOrientation(entry?.orientation ?? entry?.direction);
  if (!wall || !local || !orientation) return null;
  return { wallX: wall.x, wallY: wall.y, localX: local.x, localY: local.y, orientation };
}

export function itemRowTile(row: ItemRow | null | undefined): { readonly x: number; readonly y: number; readonly direction: number } | null {
  const x = finiteNumber(row?.item.x);
  const y = finiteNumber(row?.item.y);
  const direction = finiteNumber(row?.item.direction) ?? 0;
  if (x === null || y === null) return null;
  return { x: Math.trunc(x), y: Math.trunc(y), direction: Math.trunc(direction) };
}

export function userTile(user: RuntimeUserSummary | null | undefined): { readonly x: number; readonly y: number } | null {
  const directX = finiteNumber(user?.x);
  const directY = finiteNumber(user?.y);
  if (directX !== null && directY !== null) return { x: Math.trunc(directX), y: Math.trunc(directY) };
  const match = String(user?.position ?? "").match(/(-?\d+)\s*,\s*(-?\d+)/);
  if (!match) return null;
  return { x: Number.parseInt(match[1]!, 10), y: Number.parseInt(match[2]!, 10) };
}

export const gardeningFacingTilePriority: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  0: [[0, -1], [-1, 0], [1, 0]],
  1: [[1, 0], [0, -1], [-1, 0]],
  2: [[1, 0], [0, -1], [0, 1]],
  3: [[1, 0], [0, 1], [0, -1]],
  4: [[0, 1], [1, 0], [-1, 0]],
  5: [[-1, 0], [0, 1], [1, 0]],
  6: [[-1, 0], [0, 1], [0, -1]],
  7: [[-1, 0], [0, -1], [1, 0]],
};

export const gardeningFallbackTilePriority: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
];

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function objectIdText(entry: RuntimeObjectSummary | null | undefined): string {
  return compactValue(entry?.objectId ?? entry?.id);
}

export function occupiedGardeningTiles(
  itemRows: readonly ItemRow[],
  users: readonly RuntimeUserSummary[],
  self: RuntimeUserSummary | null | undefined,
  ignoredObjectId: string,
): Set<string> {
  const occupied = new Set<string>();
  for (const row of itemRows) {
    if (objectIdText(row.item) === ignoredObjectId) continue;
    const tile = itemRowTile(row);
    if (tile) occupied.add(tileKey(tile.x, tile.y));
  }
  for (const user of users) {
    if (self && user.rowId === self.rowId) continue;
    const tile = userTile(user);
    if (tile) occupied.add(tileKey(tile.x, tile.y));
  }
  return occupied;
}

export function workingTileNearSelf(
  self: RuntimeUserSummary | null | undefined,
  fallback: ItemRow | null | undefined,
  itemRows: readonly ItemRow[] = [],
  users: readonly RuntimeUserSummary[] = [],
): { readonly x: number; readonly y: number } | null {
  const tile = userTile(self);
  if (tile) {
    const direction = finiteNumber(self?.direction);
    const offsets = direction === null ? gardeningFallbackTilePriority : gardeningFacingTilePriority[Math.trunc(direction) & 7] ?? gardeningFallbackTilePriority;
    const ignoredObjectId = objectIdText(fallback?.item);
    const occupied = occupiedGardeningTiles(itemRows, users, self, ignoredObjectId);
    const candidates = offsets.map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy }));
    return candidates.find((candidate) => !occupied.has(tileKey(candidate.x, candidate.y))) ?? candidates[0] ?? null;
  }
  const plant = itemRowTile(fallback);
  return plant ? { x: plant.x, y: plant.y } : null;
}

export function findCurrentPlantRow(rows: readonly ItemRow[], objectId: number): ItemRow | null {
  return rows.find((row) => objectNumericId(row.item) === objectId) ?? null;
}

export function adjacentTileForItem(
  row: ItemRow | null | undefined,
  itemRows: readonly ItemRow[],
  users: readonly RuntimeUserSummary[],
  self: RuntimeUserSummary | null | undefined,
): { readonly x: number; readonly y: number } | null {
  const tile = itemRowTile(row);
  if (!tile) return null;
  const occupied = occupiedGardeningTiles(itemRows, users, self, objectIdText(row?.item));
  const selfTile = userTile(self);
  const candidates = [
    { x: tile.x, y: tile.y + 1 },
    { x: tile.x + 1, y: tile.y },
    { x: tile.x - 1, y: tile.y },
    { x: tile.x, y: tile.y - 1 },
  ].filter((candidate) => !occupied.has(tileKey(candidate.x, candidate.y)));
  const pool = candidates.length > 0 ? candidates : [{ x: tile.x, y: tile.y + 1 }];
  if (!selfTile) return pool[0] ?? null;
  return [...pool].sort((left, right) => Math.abs(left.x - selfTile.x) + Math.abs(left.y - selfTile.y) - (Math.abs(right.x - selfTile.x) + Math.abs(right.y - selfTile.y)))[0] ?? null;
}

export function latin1ByteArray(text: string): readonly number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const value = text.charCodeAt(index);
    if (value > 0xff) throw new Error("Text cannot be encoded as Latin-1.");
    bytes.push(value);
  }
  return bytes;
}

export function shockwaveVl64ByteArray(value: number): readonly number[] {
  if (!Number.isInteger(value)) throw new Error(`VL64 value must be an integer: ${value}`);
  const negative = value < 0;
  let remaining = Math.abs(value);
  const bytes: number[] = [64 + (remaining & 0x03)];
  remaining = Math.floor(remaining / 4);
  while (remaining > 0) {
    bytes.push(64 + (remaining & 0x3f));
    remaining = Math.floor(remaining / 64);
  }
  if (bytes.length > 6) throw new Error(`VL64 value uses ${bytes.length} bytes; max supported is 6`);
  bytes[0] = bytes[0]! | (bytes.length << 3) | (negative ? 0x04 : 0);
  return bytes;
}

export function shockwaveOutgoingStringByteArray(value: string): readonly number[] {
  return [...encodeShockwaveBase64Int(value.length, 2), ...latin1ByteArray(value)];
}

export function decodeShockwaveVl64Text(value: string): number | null {
  if (!value) return null;
  const bytes = latin1ByteArray(value);
  const first = bytes[0];
  if (first === undefined || first < 64) return null;
  const length = (first >> 3) & 0x07;
  if (length <= 0 || bytes.length < length) return null;
  let result = first & 0x03;
  let shift = 2;
  for (let index = 1; index < length; index += 1) {
    result += (bytes[index]! & 0x3f) << shift;
    shift += 6;
  }
  return (first & 0x04) !== 0 ? -result : result;
}

export type GardeningPhase = "idle" | "move_out" | "compost" | "water" | "harvest" | "return" | "complete" | "failed";

export interface GardeningJobState {
  readonly plantKey: string;
  readonly objectId: number;
  readonly originalX: number;
  readonly originalY: number;
  readonly originalDirection: number;
  readonly workingX: number;
  readonly workingY: number;
  readonly phase: GardeningPhase;
  readonly mode: "cycle" | "compost";
  readonly queue: readonly string[];
  readonly sentAt: number;
  readonly moveAttempts: number;
  readonly actionAttempts: number;
  readonly completed: number;
  readonly note: string;
  readonly baselineState: string;
}

export type InjectionActionKind =
  | "sendChat"
  | "stageClick"
  | "clickWindowElement"
  | "openNavigator"
  | "enterPrivateRoom"
  | "enterPublicRoom"
  | "requestInventory"
  | "userWave"
  | "userDance"
  | "userStopDance"
  | "userHcDance"
  | "userCarryDrink"
  | "showHotelView"
  | "rawPacketBlocked";

export interface InjectionCommandDraft {
  readonly actionKind: InjectionActionKind;
  readonly chatMessage: string;
  readonly stageX: string;
  readonly stageY: string;
  readonly windowId: string;
  readonly elementId: string;
  readonly navigatorView: string;
  readonly flatId: string;
  readonly publicRoomQuery: string;
  readonly rawDirection: "SERVER" | "CLIENT";
  readonly rawText: string;
}

export interface InjectionSnippet {
  readonly id: string;
  readonly label: string;
  readonly command: InjectionCommandDraft;
  readonly createdAt: string;
}

export interface InjectionHistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly status: "success" | "blocked" | "warning" | "error";
  readonly message: string;
  readonly time: string;
}

export interface PacketConsoleEntry {
  readonly id: string;
  readonly time: string;
  readonly kind: "command" | "success" | "warning" | "error" | "info";
  readonly text: string;
}

export type PluginClientRightsOwners = Map<number, Map<string, Set<string>>>;

export const injectionActionOptions: readonly { readonly kind: InjectionActionKind; readonly label: string }[] = [
  { kind: "sendChat", label: "Send chat" },
  { kind: "stageClick", label: "Stage click" },
  { kind: "clickWindowElement", label: "Click window element" },
  { kind: "openNavigator", label: "Navigator view" },
  { kind: "enterPrivateRoom", label: "Enter private room" },
  { kind: "enterPublicRoom", label: "Enter public room" },
  { kind: "requestInventory", label: "Request hand inventory" },
  { kind: "userWave", label: "Wave" },
  { kind: "userDance", label: "Dance" },
  { kind: "userStopDance", label: "Stop dance" },
  { kind: "userHcDance", label: "HC Dance" },
  { kind: "userCarryDrink", label: "Carry drink" },
  { kind: "showHotelView", label: "Show hotel view" },
];

export const defaultInjectionDraft: InjectionCommandDraft = {
  actionKind: "sendChat",
  chatMessage: "",
  stageX: "480",
  stageY: "270",
  windowId: "Room_bar",
  elementId: "int_hand_image",
  navigatorView: "nav_pr",
  flatId: "",
  publicRoomQuery: "",
  rawDirection: "SERVER",
  rawText: "",
};

export const injectionSnippetStorageKey = "habbpy-v4:injection-snippets";
export const injectionHistoryStorageKey = "habbpy-v4:injection-history";
export const userStoredLookStorageKey = "habbpy-v4:user-stored-looks";
export const automationPrefsStorageKey = "habbpy-v4:automation-prefs";

export function injectionCommandLabel(command: InjectionCommandDraft): string {
  switch (command.actionKind) {
    case "sendChat":
      return `sendChat ${command.chatMessage.trim().slice(0, 38) || "(empty)"}`;
    case "stageClick":
      return `stageClick ${command.stageX.trim() || "?"},${command.stageY.trim() || "?"}`;
    case "clickWindowElement":
      return `clickWindowElement ${command.windowId.trim() || "?"}:${command.elementId.trim() || "?"}`;
    case "openNavigator":
      return `navigatorView ${command.navigatorView.trim() || "nav_pr"}`;
    case "enterPrivateRoom":
      return `enterPrivateRoom ${command.flatId.trim() || "current"}`;
    case "enterPublicRoom":
      return `enterPublicRoom ${command.publicRoomQuery.trim() || "first public room"}`;
    case "requestInventory":
      return "requestInventory";
    case "userWave":
      return "userWave";
    case "userDance":
      return "userDance";
    case "userStopDance":
      return "userStopDance";
    case "userHcDance":
      return "userHcDance";
    case "userCarryDrink":
      return "userCarryDrink";
    case "showHotelView":
      return "showHotelView";
    case "rawPacketBlocked":
      return `[${command.rawDirection}] ${command.rawText.trim().slice(0, 38) || "(empty)"}`;
  }
}

export function cloneInjectionDraft(command: InjectionCommandDraft): InjectionCommandDraft {
  return {
    ...defaultInjectionDraft,
    ...command,
    rawDirection: command.rawDirection === "CLIENT" ? "CLIENT" : "SERVER",
  };
}

export function normalizeInjectionSnippet(value: unknown, index: number): InjectionSnippet | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const commandRecord = record.command && typeof record.command === "object" ? (record.command as Record<string, unknown>) : record;
  const rawKind = String(commandRecord.actionKind ?? "").trim();
  const actionKind = injectionActionOptions.some((option) => option.kind === rawKind) ? (rawKind as InjectionActionKind) : "";
  const isV3RawSnippet = typeof record.text === "string" || typeof commandRecord.rawText === "string";
  const command = cloneInjectionDraft({
    ...defaultInjectionDraft,
    actionKind: actionKind || (isV3RawSnippet ? "rawPacketBlocked" : "sendChat"),
    chatMessage: String(commandRecord.chatMessage ?? ""),
    stageX: String(commandRecord.stageX ?? defaultInjectionDraft.stageX),
    stageY: String(commandRecord.stageY ?? defaultInjectionDraft.stageY),
    windowId: String(commandRecord.windowId ?? defaultInjectionDraft.windowId),
    elementId: String(commandRecord.elementId ?? defaultInjectionDraft.elementId),
    navigatorView: String(commandRecord.navigatorView ?? defaultInjectionDraft.navigatorView),
    flatId: String(commandRecord.flatId ?? ""),
    publicRoomQuery: String(commandRecord.publicRoomQuery ?? commandRecord.publicRoom ?? ""),
    rawDirection: String(commandRecord.rawDirection ?? record.direction ?? "SERVER").toUpperCase() === "CLIENT" ? "CLIENT" : "SERVER",
    rawText: String(commandRecord.rawText ?? record.text ?? ""),
  });
  return {
    id: String(record.id ?? `loaded-${Date.now()}-${index}`),
    label: String(record.label ?? injectionCommandLabel(command)),
    command,
    createdAt: String(record.createdAt ?? new Date().toISOString()),
  };
}

export function normalizeInjectionSnippets(value: unknown): InjectionSnippet[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map(normalizeInjectionSnippet).filter((entry): entry is InjectionSnippet => Boolean(entry)).slice(0, 50);
}

export function normalizeStoredUserLooks(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  return [...new Set(rows.map((entry) => String(entry ?? "").trim()).filter(Boolean))].slice(0, 20);
}

export function loadStoredUserLooks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeStoredUserLooks(JSON.parse(window.localStorage.getItem(userStoredLookStorageKey) || "[]"));
  } catch {
    return [];
  }
}

export function loadAutomationPrefs(): { readonly autoHideBulletin: boolean } {
  if (typeof window === "undefined") return { autoHideBulletin: true };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(automationPrefsStorageKey) || "{}") as { readonly autoHideBulletin?: unknown };
    return { autoHideBulletin: parsed.autoHideBulletin !== false };
  } catch {
    return { autoHideBulletin: true };
  }
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to a temporary textarea below.
    }
  }
  if (typeof document === "undefined" || !document.body) return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-1000px";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

export function injectionDraftToRuntimeAction(command: InjectionCommandDraft): { readonly action?: EngineRuntimeAction; readonly blocked?: string } {
  switch (command.actionKind) {
    case "sendChat": {
      const message = command.chatMessage.trim();
      return message ? { action: { kind: "sendChat", message } } : { blocked: "Enter a chat message first." };
    }
    case "stageClick": {
      const x = Number(command.stageX);
      const y = Number(command.stageY);
      return Number.isFinite(x) && Number.isFinite(y)
        ? { action: { kind: "stageClick", x, y } }
        : { blocked: "Stage click needs numeric x/y coordinates." };
    }
    case "clickWindowElement": {
      const windowId = command.windowId.trim();
      const elementId = command.elementId.trim();
      return windowId && elementId
        ? { action: { kind: "clickWindowElement", windowId, elementId } }
        : { blocked: "Window element click needs window id and element id." };
    }
    case "openNavigator":
      return { action: { kind: "openNavigator", view: command.navigatorView.trim() || "nav_pr" } };
    case "enterPrivateRoom":
      return { action: { kind: "enterPrivateRoom", flatId: command.flatId.trim() || undefined } };
    case "enterPublicRoom":
      return { action: { kind: "enterPublicRoom", query: command.publicRoomQuery.trim() || undefined } };
    case "requestInventory":
      return { action: { kind: "requestInventory" } };
    case "userWave":
    case "userDance":
    case "userStopDance":
    case "userHcDance":
    case "userCarryDrink":
      return { blocked: "User relay actions are handled by the packet relay bridge." };
    case "showHotelView":
      return { action: { kind: "showHotelView" } };
    case "rawPacketBlocked":
      return { blocked: "Arbitrary raw packet sending is blocked until a Shockless-approved boundary exists." };
  }
}

export function injectionDraftToUserRelayAction(command: InjectionCommandDraft): UserRelayAction | null {
  switch (command.actionKind) {
    case "userWave":
      return { action: "wave" };
    case "userDance":
      return { action: "dance", number: 1 };
    case "userStopDance":
      return { action: "stopDance" };
    case "userHcDance":
      return { action: "hcdance", number: 2 };
    case "userCarryDrink":
      return { action: "carryDrink" };
    default:
      return null;
  }
}

export function clampRepeatCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(25, parsed));
}

export function clampRepeatInterval(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1000;
  return Math.max(50, Math.min(60000, parsed));
}

export function clampMultiAccountCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(50, parsed));
}

export function clampMultiAccountConcurrency(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(8, parsed));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function objectListSignature(items: readonly RuntimeObjectSummary[] | undefined): string {
  if (!items || items.length === 0) return "0";
  return items
    .map((item) =>
      [
        item.objectId ?? item.id ?? "-",
        item.className ?? "-",
        item.x ?? "-",
        item.y ?? "-",
        item.z ?? "-",
        item.direction ?? "-",
        item.state ?? "-",
      ].join(":"),
    )
    .join("|");
}

export function userListSignature(users: readonly RuntimeUserSummary[] | undefined): string {
  if (!users || users.length === 0) return "0";
  return users
    .map((user) =>
      [
        user.rowId,
        user.accountId ?? "-",
        user.roomIndex ?? "-",
        user.position ?? "-",
        user.activity ?? "-",
        user.typing ?? "-",
        user.lastAction ?? "-",
        user.lastSaid ?? "-",
      ].join(":"),
    )
    .join("|");
}

export function inventorySignature(inventory: EngineRuntimeSnapshot["inventory"]): string {
  if (!inventory) return "none";
  return [
    inventory.openState ?? "-",
    inventory.totalCount,
    inventory.itemCount,
    inventory.floorCount,
    inventory.wallCount,
    inventory.items.map((item) => [item.rowId, item.itemId, item.objectId ?? "-", item.slotId ?? "-"].join(":")).join("|"),
  ].join(";");
}

export function navigatorSignature(navigator: EngineRuntimeSnapshot["navigator"]): string {
  if (!navigator) return "none";
  return [
    navigator.total,
    navigator.categories,
    navigator.publicRooms,
    navigator.privateRooms,
    navigator.publicRoomNodes.map((node) => [node.id ?? "-", node.name ?? "-", node.users ?? "-"].join(":")).join("|"),
  ].join(";");
}

export function roomObjectsSignature(roomObjects: EngineRuntimeSnapshot["roomObjects"]): string {
  if (!roomObjects) return "none";
  return [
    JSON.stringify(roomObjects.counts),
    userListSignature(roomObjects.users),
    objectListSignature(roomObjects.activeObjects),
    objectListSignature(roomObjects.passiveObjects),
    objectListSignature(roomObjects.wallItems),
  ].join(";");
}

export function userStateSignature(userState: EngineRuntimeSnapshot["userState"]): string {
  if (!userState) return "none";
  return [
    userState.sessionUserName ?? "-",
    userState.roomName ?? "-",
    userState.roomOwner ?? "-",
    userState.roomId ?? "-",
    userState.roomType ?? "-",
    userState.rights.join("|"),
    userListSignature(userState.users),
  ].join(";");
}

export function chatHistorySignature(chatHistory: EngineRuntimeSnapshot["chatHistory"]): string {
  const last = chatHistory[chatHistory.length - 1];
  return `${chatHistory.length}:${last?.timestamp ?? ""}:${last?.userName ?? ""}:${last?.text ?? ""}`;
}

export function activeSpritesSignature(activeSprites: EngineRuntimeSnapshot["activeSprites"]): string {
  return activeSprites.map((sprite) => [sprite.n ?? "-", sprite.member ?? "-", sprite.loc?.join(",") ?? ""].join(":")).join("|");
}

export function runtimeProbeScopesForPlugin(pluginId: string): readonly EngineRuntimeSnapshotScope[] {
  switch (pluginId) {
    case "dev-tools":
      return ["full"];
    case "info":
      return ["core", "room", "inventory", "navigator"];
    case "room":
    case "user":
    case "items":
    case "wall-mover":
    case "chat":
    case "visitors":
      return ["core", "room"];
    case "inventory":
      return ["core", "inventory"];
    default:
      return ["core"];
  }
}

export function reuseStableRuntimeDetails(
  previous: EngineRuntimeSnapshot | null,
  next: EngineRuntimeSnapshot,
): EngineRuntimeSnapshot {
  if (!previous) return next;
  const scopes = new Set(next.dataScopes ?? ["full"]);
  const hasScope = (scope: string): boolean => scopes.has("full") || scopes.has(scope);
  return {
    ...next,
    roomObjects:
      !hasScope("room") && previous.roomObjects
        ? previous.roomObjects
        :
      roomObjectsSignature(previous.roomObjects) === roomObjectsSignature(next.roomObjects)
        ? previous.roomObjects
        : next.roomObjects,
    userState:
      !hasScope("room") && previous.userState
        ? previous.userState
        :
      userStateSignature(previous.userState) === userStateSignature(next.userState)
        ? previous.userState
        : next.userState,
    inventory:
      !hasScope("inventory") && previous.inventory
        ? previous.inventory
        :
      inventorySignature(previous.inventory) === inventorySignature(next.inventory)
        ? previous.inventory
        : next.inventory,
    navigator:
      !hasScope("navigator") && previous.navigator
        ? previous.navigator
        :
      navigatorSignature(previous.navigator) === navigatorSignature(next.navigator)
        ? previous.navigator
        : next.navigator,
    chatHistory:
      !hasScope("room") && previous.chatHistory.length > 0
        ? previous.chatHistory
        :
      chatHistorySignature(previous.chatHistory) === chatHistorySignature(next.chatHistory)
        ? previous.chatHistory
        : next.chatHistory,
    activeSprites:
      !hasScope("sprites") && previous.activeSprites.length > 0
        ? previous.activeSprites
        :
      activeSpritesSignature(previous.activeSprites) === activeSpritesSignature(next.activeSprites)
        ? previous.activeSprites
        : next.activeSprites,
    windowIds:
      previous.windowIds.join("|") === next.windowIds.join("|")
        ? previous.windowIds
        : next.windowIds,
  };
}

export function itemRowTitle(row: ItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  return furniDisplayName(metadata, row.item);
}

export function itemRowMeta(row: ItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  const info = furniInfoForObject(metadata, row.item);
  const className = compactValue(row.item.className ?? row.item.name);
  const meta = objectMeta(row.item);
  return info && className !== "-" ? `class ${className} / ${meta}` : meta;
}

export function itemRowSearchText(row: ItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  const info = furniInfoForObject(metadata, row.item);
  return [
    row.label,
    row.source,
    row.key,
    objectTitle(row.item),
    objectMeta(row.item),
    row.item.className,
    row.item.name,
    info?.id,
    info?.name,
    info?.description,
    info?.category,
  ]
    .join(" ")
    .toLowerCase();
}

export function userDisplayName(user: RuntimeUserSummary | null, sessionName?: string | null): string {
  if (!user) return "-";
  return compactValue(user.name ?? (user.rowId === "0" ? sessionName : null) ?? user.objectClass ?? user.className ?? user.rowId);
}

export function userPosition(user: RuntimeUserSummary | null): string {
  if (!user) return "-";
  return compactValue(user.position ?? (user.x !== undefined || user.y !== undefined ? `${compactValue(user.x)}, ${compactValue(user.y)}, ${compactValue(user.z)}` : null));
}

export function userRowMeta(user: RuntimeUserSummary, sessionName?: string | null): string {
  const parts = [
    user.rowId === "0" && sessionName ? "you" : "",
    userPosition(user) !== "-" ? `loc ${userPosition(user)}` : "",
    user.direction !== undefined ? `dir ${compactValue(user.direction)}` : "",
    user.spriteCount !== undefined ? `${compactValue(user.spriteCount)} sprites` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

export interface PacketProfileUser {
  readonly name: string;
  readonly accountId: string;
  readonly index: string;
  readonly gender: string;
  readonly motto: string;
  readonly figure: string;
  readonly poolFigure: string;
  readonly badgeCode: string;
  readonly userType: string;
  readonly position: string;
  readonly sourceLine: number;
}

export interface PacketProfileIndex {
  readonly users: readonly PacketProfileUser[];
  readonly byAccountId: ReadonlyMap<string, PacketProfileUser>;
  readonly byName: ReadonlyMap<string, PacketProfileUser>;
  readonly byIndex: ReadonlyMap<string, PacketProfileUser>;
}

export interface PacketInfoFriend {
  readonly accountId: string;
  readonly name: string;
  readonly gender: string;
  readonly motto: string;
  readonly online: boolean;
  readonly canFollow: boolean;
  readonly location: string;
  readonly lastAccess: string;
  readonly figure: string;
  readonly categoryId: string;
  readonly sourceLine: number;
}

export interface PacketInfoEffect {
  readonly name: string;
  readonly value: string;
  readonly sourceLine: number;
}

export interface PacketMessengerMessage {
  readonly key: string;
  readonly id: string;
  readonly senderAccountId: string;
  readonly sentAt: string;
  readonly text: string;
  readonly sourceLine: number;
}

export interface PacketFriendRequest {
  readonly key: string;
  readonly accountId: string;
  readonly name: string;
  readonly requestId: string;
  readonly sourceLine: number;
}

export interface PacketInfoState {
  readonly friends: readonly PacketInfoFriend[];
  readonly badges: readonly string[];
  readonly activeBadgeSlot: string;
  readonly activeBadgeCode: string;
  readonly preferences: readonly string[];
  readonly statusEffects: readonly PacketInfoEffect[];
  readonly privateMessages: readonly PacketMessengerMessage[];
  readonly friendRequests: readonly PacketFriendRequest[];
  readonly messengerMessage: string;
  readonly messengerUserLimit: string;
  readonly messengerRequestCount: string;
  readonly messengerRequestPendingCount: string;
  readonly messengerMessageCount: string;
  readonly messengerUnreadMessageCount: string;
}

export interface PacketInventoryItem {
  readonly key: string;
  readonly itemId: string;
  readonly rawId: string;
  readonly itemIdValue: string;
  readonly slotId: string;
  readonly objectId: string;
  readonly itemType: string;
  readonly inventoryKind: string;
  readonly className: string;
  readonly size: string;
  readonly colors: string;
  readonly data: string;
  readonly head: string;
  readonly body: string;
  readonly meta: string;
  readonly headTokens: string;
  readonly bodyTokens: string;
  readonly metaTokens: string;
  readonly sourceLine: number;
}

export interface PacketInventoryState {
  readonly items: readonly PacketInventoryItem[];
  readonly totalCount: number;
  readonly floorCount: number;
  readonly wallCount: number;
  readonly lastSourceLine: number | null;
}

export interface PacketWallItem {
  readonly key: string;
  readonly itemId: string;
  readonly className: string;
  readonly ownerName: string;
  readonly wall: string;
  readonly local: string;
  readonly orientation: string;
  readonly rawLocation: string;
  readonly data: string;
  readonly state: string;
  readonly sourceLine: number;
}

export interface PacketWallItemState {
  readonly items: readonly PacketWallItem[];
  readonly itemCount: number;
  readonly lastSourceLine: number | null;
}

export interface PacketChatEntry {
  readonly index: string;
  readonly text: string;
  readonly chatMode: string;
  readonly activity: string;
  readonly sourceLine: number;
}

export interface PacketFishingCatch {
  readonly key: string;
  readonly fishName: string;
  readonly message: string;
  readonly xp: number;
  readonly golden: boolean;
  readonly sourceLine: number;
}

export interface PacketFishopediaEntry {
  readonly key: string;
  readonly fishName: string;
  readonly xp: string;
  readonly catches: string;
  readonly completion: string;
  readonly location: string;
  readonly sourceLine: number;
}

export interface PacketFishingState {
  readonly status: string;
  readonly note: string;
  readonly tokens: string;
  readonly level: string;
  readonly minigameActive: boolean;
  readonly minigamePin: string;
  readonly minigameValues: string;
  readonly catches: number;
  readonly golden: number;
  readonly xp: number;
  readonly frenzies: number;
  readonly fishopedia: readonly PacketFishopediaEntry[];
  readonly catchLog: readonly PacketFishingCatch[];
  readonly lastCatch: PacketFishingCatch | null;
  readonly lastClientAction: string;
  readonly lastSourceLine: number | null;
}

export interface ClientPluginSnapshot {
  readonly clientId: number;
  readonly label: string;
  readonly relay: RelayLogSnapshot | null;
  readonly runtime: EngineRuntimeSnapshot | null;
  readonly runtimeSummary: ClientRuntimeSummary | null;
  readonly profileUsers: readonly PacketProfileUser[];
  readonly profileIndex: PacketProfileIndex;
  readonly packetInfo: PacketInfoState;
  readonly packetInventory: PacketInventoryState;
  readonly packetWallItems: PacketWallItemState;
  readonly packetChatEntries: readonly PacketChatEntry[];
  readonly packetFishing: PacketFishingState;
  readonly updatedAt: string | null;
}

export interface InventoryDisplayRow {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly meta: string;
  readonly searchText: string;
  readonly detailRows: readonly { readonly label: string; readonly value: string }[];
}

export const emptyPacketProfileIndex: PacketProfileIndex = {
  users: [],
  byAccountId: new globalThis.Map<string, PacketProfileUser>(),
  byName: new globalThis.Map<string, PacketProfileUser>(),
  byIndex: new globalThis.Map<string, PacketProfileUser>(),
};

export const emptyPacketInfoState: PacketInfoState = {
  friends: [],
  badges: [],
  activeBadgeSlot: "-",
  activeBadgeCode: "-",
  preferences: [],
  statusEffects: [],
  privateMessages: [],
  friendRequests: [],
  messengerMessage: "-",
  messengerUserLimit: "-",
  messengerRequestCount: "-",
  messengerRequestPendingCount: "-",
  messengerMessageCount: "-",
  messengerUnreadMessageCount: "-",
};

export const emptyPacketInventoryState: PacketInventoryState = {
  items: [],
  totalCount: 0,
  floorCount: 0,
  wallCount: 0,
  lastSourceLine: null,
};

export const emptyPacketWallItemState: PacketWallItemState = {
  items: [],
  itemCount: 0,
  lastSourceLine: null,
};

export const emptyPacketFishingState: PacketFishingState = {
  status: "idle",
  note: "-",
  tokens: "-",
  level: "-",
  minigameActive: false,
  minigamePin: "-",
  minigameValues: "-",
  catches: 0,
  golden: 0,
  xp: 0,
  frenzies: 0,
  fishopedia: [],
  catchLog: [],
  lastCatch: null,
  lastClientAction: "-",
  lastSourceLine: null,
};

export function packetFieldMap(entry: RelayLogEntry): globalThis.Map<string, string> {
  const map = new globalThis.Map<string, string>();
  for (const field of entry.decodedFields) {
    map.set(field.label, field.value);
  }
  return map;
}

export function packetUsersFromEntries(entries: readonly RelayLogEntry[], startIndex = 0): readonly PacketProfileUser[] {
  const users: PacketProfileUser[] = [];
  for (let entryIndex = Math.max(0, startIndex); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.direction !== "SERVER" || entry.header !== 28) continue;
    const fields = packetFieldMap(entry);
    const count = Number(fields.get("userCount") ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    for (let row = 1; row <= count; row += 1) {
      const name = compactValue(fields.get(`user ${row} name`));
      if (name === "-") continue;
      users.push({
        name,
        accountId: compactValue(fields.get(`user ${row} accountId`)),
        index: compactValue(fields.get(`user ${row} index`)),
        gender: compactValue(fields.get(`user ${row} gender`)),
        motto: compactValue(fields.get(`user ${row} motto`)),
        figure: compactValue(fields.get(`user ${row} figure`)),
        poolFigure: compactValue(fields.get(`user ${row} poolFigure`)),
        badgeCode: compactValue(fields.get(`user ${row} badge`)),
        userType: compactValue(fields.get(`user ${row} type`)),
        position: compactValue(fields.get(`user ${row} position`)),
        sourceLine: entry.lineNumber,
      });
    }
  }
  return users;
}

export let packetProfileUserCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly users: readonly PacketProfileUser[];
    }
  | null = null;

export function packetUsersFromRelayLog(snapshot: RelayLogSnapshot | null): readonly PacketProfileUser[] {
  if (!snapshot || snapshot.entries.length === 0) {
    packetProfileUserCache = null;
    return [];
  }
  if (
    packetProfileUserCache &&
    packetProfileUserCache.logPath === snapshot.logPath &&
    packetProfileUserCache.entryCount <= snapshot.entries.length &&
    packetProfileUserCache.totalLines <= snapshot.totalLines
  ) {
    const appendedUsers = packetUsersFromEntries(snapshot.entries, packetProfileUserCache.entryCount);
    const users = appendedUsers.length > 0 ? [...packetProfileUserCache.users, ...appendedUsers] : packetProfileUserCache.users;
    packetProfileUserCache = {
      logPath: snapshot.logPath,
      entryCount: snapshot.entries.length,
      totalLines: snapshot.totalLines,
      users,
    };
    return users;
  }
  const users = packetUsersFromEntries(snapshot.entries);
  packetProfileUserCache = {
    logPath: snapshot.logPath,
    entryCount: snapshot.entries.length,
    totalLines: snapshot.totalLines,
    users,
  };
  return users;
}

export function packetInfoStateFromEntries(
  entries: readonly RelayLogEntry[],
  startIndex = 0,
  initialState: PacketInfoState = emptyPacketInfoState,
): PacketInfoState {
  const friendsByKey = new globalThis.Map<string, PacketInfoFriend>();
  for (const friend of initialState.friends) {
    friendsByKey.set(packetFriendKey(friend), friend);
  }
  const privateMessagesByKey = new globalThis.Map<string, PacketMessengerMessage>();
  for (const message of initialState.privateMessages) {
    privateMessagesByKey.set(packetPrivateMessageKey(message), message);
  }
  const friendRequestsByKey = new globalThis.Map<string, PacketFriendRequest>();
  for (const request of initialState.friendRequests) {
    friendRequestsByKey.set(packetFriendRequestKey(request), request);
  }
  let badges = [...initialState.badges];
  let activeBadgeSlot = initialState.activeBadgeSlot;
  let activeBadgeCode = initialState.activeBadgeCode;
  let preferences = [...initialState.preferences];
  let statusEffects = [...initialState.statusEffects];
  let messengerMessage = initialState.messengerMessage;
  let messengerUserLimit = initialState.messengerUserLimit;
  let messengerRequestCount = initialState.messengerRequestCount;
  let messengerRequestPendingCount = initialState.messengerRequestPendingCount;
  let messengerMessageCount = initialState.messengerMessageCount;
  let messengerUnreadMessageCount = initialState.messengerUnreadMessageCount;

  for (let entryIndex = Math.max(0, startIndex); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.direction !== "SERVER") continue;
    const fields = packetFieldMap(entry);
    if (entry.header === 12) {
      const count = parsedCount(fields.get("messengerFriendCount"));
      if (count !== null) {
        friendsByKey.clear();
        addPacketFriendsFromPrefix(friendsByKey, fields, "friend", count, entry.lineNumber);
      }
      messengerMessage = compactValue(fields.get("messenger persistentMessage"));
      messengerUserLimit = compactValue(fields.get("messenger userLimit"));
      messengerRequestCount = compactValue(fields.get("messenger requestCount"));
      messengerMessageCount = compactValue(fields.get("messenger messageCount"));
    } else if (entry.header === 13) {
      const count = parsedCount(fields.get("friendUpdateCount"));
      if (count !== null) addPacketFriendsFromPrefix(friendsByKey, fields, "friendUpdate", count, entry.lineNumber);
    } else if (entry.header === 137) {
      const friend = packetFriendFromPrefix(fields, "friendAdded", entry.lineNumber);
      if (friend) friendsByKey.set(packetFriendKey(friend), friend);
    } else if (entry.header === 132) {
      const count = parsedCount(fields.get("friendRequestCount"));
      if (count !== null) {
        addPacketFriendRequestsFromPrefix(friendRequestsByKey, fields, "friendRequest", count, entry.lineNumber);
        messengerRequestCount = String(friendRequestsByKey.size);
        messengerRequestPendingCount = compactValue(fields.get("friendRequestPendingCount"));
      }
    } else if (entry.header === 134) {
      const count = parsedCount(fields.get("privateMessageCount"));
      if (count !== null) {
        addPacketPrivateMessagesFromPrefix(privateMessagesByKey, fields, "privateMessage", count, entry.lineNumber);
        messengerMessageCount = String(privateMessagesByKey.size);
        messengerUnreadMessageCount = compactValue(fields.get("privateMessageUnreadCount"));
      }
    } else if (entry.header === 362) {
      const count = parsedCount(fields.get("highlightFriendCount"));
      if (count !== null) addPacketFriendsFromPrefix(friendsByKey, fields, "highlightFriend", count, entry.lineNumber);
    } else if (entry.header === 229) {
      const count = parsedCount(fields.get("badgeCount"));
      if (count !== null) {
        badges = [];
        for (let row = 1; row <= count; row += 1) {
          const badge = compactValue(fields.get(`badge ${row} code`));
          if (badge !== "-") badges.push(badge);
        }
      }
    } else if (entry.header === 228) {
      activeBadgeSlot = compactValue(fields.get("activeBadgeSlot"));
      activeBadgeCode = compactValue(fields.get("activeBadgeCode"));
    } else if (entry.header === 308) {
      const count = parsedCount(fields.get("accountPreferenceCount"));
      if (count !== null) {
        preferences = [];
        for (let row = 1; row <= count; row += 1) {
          const preference = compactValue(fields.get(`accountPreference ${row}`));
          if (preference !== "-") preferences.push(preference);
        }
      }
    } else if (entry.header === 1242) {
      const count = parsedCount(fields.get("statusEffectCount"));
      if (count !== null) {
        statusEffects = [];
        for (let row = 1; row <= count; row += 1) {
          const name = compactValue(fields.get(`statusEffect ${row} name`));
          if (name === "-") continue;
          statusEffects.push({
            name,
            value: compactValue(fields.get(`statusEffect ${row} value`)),
            sourceLine: entry.lineNumber,
          });
        }
      }
    } else if (entry.header === 313) {
      const count = parsedCount(fields.get("privateMessageCount"));
      if (count !== null) {
        privateMessagesByKey.clear();
        addPacketPrivateMessagesFromPrefix(privateMessagesByKey, fields, "privateMessage", count, entry.lineNumber);
        messengerMessageCount = String(count);
        messengerUnreadMessageCount = compactValue(fields.get("privateMessageUnreadCount"));
      }
    } else if (entry.header === 314) {
      const count = parsedCount(fields.get("friendRequestCount"));
      if (count !== null) {
        friendRequestsByKey.clear();
        addPacketFriendRequestsFromPrefix(friendRequestsByKey, fields, "friendRequest", count, entry.lineNumber);
        messengerRequestCount = String(count);
        messengerRequestPendingCount = compactValue(fields.get("friendRequestPendingCount"));
      }
    }
  }

  return {
    friends: [...friendsByKey.values()].sort((left, right) => {
      if (left.online !== right.online) return left.online ? -1 : 1;
      return left.name.localeCompare(right.name);
    }),
    badges,
    activeBadgeSlot,
    activeBadgeCode,
    preferences,
    statusEffects,
    privateMessages: [...privateMessagesByKey.values()],
    friendRequests: [...friendRequestsByKey.values()],
    messengerMessage,
    messengerUserLimit,
    messengerRequestCount,
    messengerRequestPendingCount,
    messengerMessageCount,
    messengerUnreadMessageCount,
  };
}

export let packetInfoStateCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: PacketInfoState;
    }
  | null = null;

export function packetInfoStateFromRelayLog(snapshot: RelayLogSnapshot | null): PacketInfoState {
  if (!snapshot || snapshot.entries.length === 0) {
    packetInfoStateCache = null;
    return emptyPacketInfoState;
  }
  if (
    packetInfoStateCache &&
    packetInfoStateCache.logPath === snapshot.logPath &&
    packetInfoStateCache.entryCount <= snapshot.entries.length &&
    packetInfoStateCache.totalLines <= snapshot.totalLines
  ) {
    const state = packetInfoStateFromEntries(snapshot.entries, packetInfoStateCache.entryCount, packetInfoStateCache.state);
    packetInfoStateCache = {
      logPath: snapshot.logPath,
      entryCount: snapshot.entries.length,
      totalLines: snapshot.totalLines,
      state,
    };
    return state;
  }
  const state = packetInfoStateFromEntries(snapshot.entries);
  packetInfoStateCache = {
    logPath: snapshot.logPath,
    entryCount: snapshot.entries.length,
    totalLines: snapshot.totalLines,
    state,
  };
  return state;
}

export function addPacketFriendsFromPrefix(
  friendsByKey: globalThis.Map<string, PacketInfoFriend>,
  fields: ReadonlyMap<string, string>,
  prefix: string,
  count: number,
  sourceLine: number,
): void {
  for (let row = 1; row <= count; row += 1) {
    const friend = packetFriendFromPrefix(fields, `${prefix} ${row}`, sourceLine);
    if (friend) friendsByKey.set(packetFriendKey(friend), friend);
  }
}

export function addPacketPrivateMessagesFromPrefix(
  messagesByKey: globalThis.Map<string, PacketMessengerMessage>,
  fields: ReadonlyMap<string, string>,
  prefix: string,
  count: number,
  sourceLine: number,
): void {
  for (let row = 1; row <= count; row += 1) {
    const message = packetPrivateMessageFromPrefix(fields, `${prefix} ${row}`, sourceLine);
    if (message) messagesByKey.set(packetPrivateMessageKey(message), message);
  }
}

export function addPacketFriendRequestsFromPrefix(
  requestsByKey: globalThis.Map<string, PacketFriendRequest>,
  fields: ReadonlyMap<string, string>,
  prefix: string,
  count: number,
  sourceLine: number,
): void {
  for (let row = 1; row <= count; row += 1) {
    const request = packetFriendRequestFromPrefix(fields, `${prefix} ${row}`, sourceLine);
    if (request) requestsByKey.set(packetFriendRequestKey(request), request);
  }
}

export function packetFriendFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketInfoFriend | null {
  const accountId = compactValue(fields.get(`${prefix} accountId`));
  const name = compactValue(fields.get(`${prefix} name`));
  if (accountId === "-" && name === "-") return null;
  return {
    accountId,
    name,
    gender: compactValue(fields.get(`${prefix} gender`)),
    motto: compactValue(fields.get(`${prefix} motto`)),
    online: fields.get(`${prefix} online`) === "true",
    canFollow: fields.get(`${prefix} canFollow`) === "true",
    location: compactValue(fields.get(`${prefix} location`)),
    lastAccess: compactValue(fields.get(`${prefix} lastAccess`)),
    figure: compactValue(fields.get(`${prefix} figure`)),
    categoryId: compactValue(fields.get(`${prefix} categoryId`)),
    sourceLine,
  };
}

export function packetPrivateMessageFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketMessengerMessage | null {
  const id = compactValue(fields.get(`${prefix} id`));
  const text = compactValue(fields.get(`${prefix} text`));
  if (id === "-" && text === "-") return null;
  const message: PacketMessengerMessage = {
    key: "",
    id,
    senderAccountId: compactValue(fields.get(`${prefix} senderAccountId`)),
    sentAt: compactValue(fields.get(`${prefix} sentAt`)),
    text,
    sourceLine,
  };
  return { ...message, key: packetPrivateMessageKey(message) };
}

export function packetFriendRequestFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketFriendRequest | null {
  const accountId = compactValue(fields.get(`${prefix} accountId`));
  const name = compactValue(fields.get(`${prefix} name`));
  if (accountId === "-" && name === "-") return null;
  const request: PacketFriendRequest = {
    key: "",
    accountId,
    name,
    requestId: compactValue(fields.get(`${prefix} requestId`)),
    sourceLine,
  };
  return { ...request, key: packetFriendRequestKey(request) };
}

export function packetFriendKey(friend: PacketInfoFriend): string {
  if (friend.accountId !== "-") return `id:${friend.accountId}`;
  return `name:${friend.name.trim().toLowerCase()}`;
}

export function packetPrivateMessageKey(message: PacketMessengerMessage): string {
  if (message.id !== "-") return `id:${message.id}`;
  return `${message.senderAccountId}:${message.sentAt}:${message.text}`.trim().toLowerCase();
}

export function packetFriendRequestKey(request: PacketFriendRequest): string {
  if (request.requestId !== "-") return `request:${request.requestId}`;
  if (request.accountId !== "-") return `account:${request.accountId}`;
  return `name:${request.name.trim().toLowerCase()}`;
}

export function parsedCount(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function packetFriendSearchText(friend: PacketInfoFriend): string {
  return [
    friend.accountId,
    friend.name,
    friend.motto,
    friend.online ? "online" : "offline",
    friend.canFollow ? "follow" : "",
    friend.location,
    friend.lastAccess,
    friend.figure,
    friend.categoryId,
  ]
    .join(" ")
    .toLowerCase();
}

export function packetFriendMeta(friend: PacketInfoFriend): string {
  const parts = [
    friend.online ? "online" : "offline",
    friend.canFollow ? "follow" : "",
    friend.location !== "-" ? friend.location : "",
    friend.lastAccess !== "-" ? `last ${friend.lastAccess}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

export function packetFriendTitle(friend: PacketInfoFriend): string {
  const id = friend.accountId !== "-" ? `#${friend.accountId}` : "";
  return [friend.name, id, friend.motto !== "-" ? friend.motto : ""].filter(Boolean).join(" / ") || "-";
}

export function lookupTokenMatches(values: readonly unknown[], normalizedToken: string, rawToken: string): boolean {
  return values.some((value) => {
    const text = compactValue(value).trim();
    if (!text || text === "-") return false;
    return text.toLowerCase() === normalizedToken || text === rawToken;
  });
}

export function runtimeUserMatchesLookup(user: RuntimeUserSummary, normalizedToken: string, rawToken: string, sessionName?: string | null): boolean {
  return lookupTokenMatches(
    [userDisplayName(user, sessionName), user.name, user.accountId, user.roomIndex, user.rowId],
    normalizedToken,
    rawToken,
  );
}

export function packetUserMatchesLookup(user: PacketProfileUser, normalizedToken: string, rawToken: string): boolean {
  return lookupTokenMatches([user.name, user.accountId, user.index], normalizedToken, rawToken);
}

export function packetFriendMatchesLookup(friend: PacketInfoFriend, normalizedToken: string, rawToken: string): boolean {
  return lookupTokenMatches([friend.name, friend.accountId], normalizedToken, rawToken);
}

export function packetFriendRequestMatchesLookup(request: PacketFriendRequest, normalizedToken: string, rawToken: string): boolean {
  return lookupTokenMatches([request.name, request.accountId, request.requestId], normalizedToken, rawToken);
}

export function parsePositiveSocialAccountId(value: unknown): number | null {
  const accountId = Number.parseInt(compactValue(value), 10);
  return Number.isInteger(accountId) && accountId > 0 ? accountId : null;
}

export function packetFriendActionId(friend: PacketInfoFriend): number | null {
  return parsePositiveSocialAccountId(friend.accountId);
}

export function packetFriendRequestActionId(request: PacketFriendRequest): number | null {
  return parsePositiveSocialAccountId(request.accountId) ?? parsePositiveSocialAccountId(request.requestId);
}

export function findPacketFriendForAction(friends: readonly PacketInfoFriend[], target: string): PacketInfoFriend | undefined {
  const rawToken = target.trim();
  if (!rawToken) return undefined;
  const normalizedToken = rawToken.toLowerCase();
  return friends.find((entry) => packetFriendMatchesLookup(entry, normalizedToken, rawToken));
}

export function findPacketFriendRequestForAction(requests: readonly PacketFriendRequest[], target: string): PacketFriendRequest | undefined {
  const rawToken = target.trim();
  if (!rawToken) return requests.length === 1 ? requests[0] : undefined;
  const normalizedToken = rawToken.toLowerCase();
  return requests.find((entry) => packetFriendRequestMatchesLookup(entry, normalizedToken, rawToken));
}

export function runtimeLookupLine(user: RuntimeUserSummary, snapshot: EngineRuntimeSnapshot | null): string {
  return [
    `in-game: room=${runtimeRoomName(snapshot)}`,
    `user=${userDisplayName(user, snapshot?.userState?.sessionUserName)}`,
    `account=${compactValue(user.accountId)}`,
    `index=${compactValue(user.roomIndex ?? user.rowId)}`,
    `pos=${userPosition(user)}`,
    `figure=${compactValue(user.figure)}`,
    `badge=${compactValue(user.badgeCode)}`,
  ].join(" ");
}

export function packetProfileLookupLine(user: PacketProfileUser): string {
  return [
    "in-game packet USERS:",
    `name=${compactValue(user.name)}`,
    `account=${compactValue(user.accountId)}`,
    `index=${compactValue(user.index)}`,
    `pos=${compactValue(user.position)}`,
    `motto=${compactValue(user.motto)}`,
    `figure=${compactValue(user.figure)}`,
    `badge=${compactValue(user.badgeCode)}`,
    `line=${user.sourceLine}`,
  ].join(" ");
}

export function friendRequestLookupLine(request: PacketFriendRequest): string {
  return [
    "friend request:",
    `name=${compactValue(request.name)}`,
    `account=${compactValue(request.accountId)}`,
    `request=${compactValue(request.requestId)}`,
    `line=${request.sourceLine}`,
  ].join(" ");
}

export function originsLookupLine(result: OriginsUserLookupResult, fallbackName: string): string {
  return [
    "origins:",
    `name=${compactValue(result.name || fallbackName)}`,
    `id=${compactValue(result.id)}`,
    `motto=${compactValue(result.motto)}`,
    `member=${compactValue(result.memberSince)}`,
    `visible=${compactValue(result.profileVisible)}`,
  ].join(" ");
}

export function packetChatEntriesFromEntries(entries: readonly RelayLogEntry[], startIndex = 0): readonly PacketChatEntry[] {
  const chatEntries: PacketChatEntry[] = [];
  for (let entryIndex = Math.max(0, startIndex); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.direction !== "SERVER" || (entry.header !== 24 && entry.header !== 25 && entry.header !== 26)) continue;
    const fields = packetFieldMap(entry);
    const text = compactValue(fields.get("chatText"));
    if (text === "-") continue;
    chatEntries.push({
      index: compactValue(fields.get("chatIndex")),
      text,
      chatMode: compactValue(fields.get("chatType")),
      activity: compactValue(fields.get("chatActivity")),
      sourceLine: entry.lineNumber,
    });
  }
  return chatEntries;
}

export let packetChatEntriesCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly entries: readonly PacketChatEntry[];
    }
  | null = null;

export function packetChatEntriesFromRelayLog(snapshot: RelayLogSnapshot | null): readonly PacketChatEntry[] {
  if (!snapshot || snapshot.entries.length === 0) {
    packetChatEntriesCache = null;
    return [];
  }
  if (
    packetChatEntriesCache &&
    packetChatEntriesCache.logPath === snapshot.logPath &&
    packetChatEntriesCache.entryCount <= snapshot.entries.length &&
    packetChatEntriesCache.totalLines <= snapshot.totalLines
  ) {
    const appendedEntries = packetChatEntriesFromEntries(snapshot.entries, packetChatEntriesCache.entryCount);
    const entries = appendedEntries.length > 0 ? [...packetChatEntriesCache.entries, ...appendedEntries] : packetChatEntriesCache.entries;
    packetChatEntriesCache = {
      logPath: snapshot.logPath,
      entryCount: snapshot.entries.length,
      totalLines: snapshot.totalLines,
      entries,
    };
    return entries;
  }
  const entries = packetChatEntriesFromEntries(snapshot.entries);
  packetChatEntriesCache = {
    logPath: snapshot.logPath,
    entryCount: snapshot.entries.length,
    totalLines: snapshot.totalLines,
    entries,
  };
  return entries;
}

export function packetFishingStateFromEntries(
  entries: readonly RelayLogEntry[],
  startIndex = 0,
  initialState: PacketFishingState = emptyPacketFishingState,
): PacketFishingState {
  let status = initialState.status;
  let note = initialState.note;
  let tokens = initialState.tokens;
  let level = initialState.level;
  let minigameActive = initialState.minigameActive;
  let minigamePin = initialState.minigamePin;
  let minigameValues = initialState.minigameValues;
  let catches = initialState.catches;
  let golden = initialState.golden;
  let xp = initialState.xp;
  let frenzies = initialState.frenzies;
  let lastCatch = initialState.lastCatch;
  let lastClientAction = initialState.lastClientAction;
  let lastSourceLine = initialState.lastSourceLine;
  const catchLog = [...initialState.catchLog];
  const fishopediaByKey = new globalThis.Map<string, PacketFishopediaEntry>();
  for (const entry of initialState.fishopedia) fishopediaByKey.set(entry.key, entry);

  for (let entryIndex = Math.max(0, startIndex); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.direction !== "SERVER" && entry.direction !== "CLIENT") continue;
    const fields = packetFieldMap(entry);

    if (entry.direction === "CLIENT") {
      const action = compactValue(fields.get("fishingClientAction") ?? fields.get("fishingClientRequest"));
      if (action !== "-") {
        const target = compactValue(fields.get("fishingClientTargetId"));
        const input = compactValue(fields.get("fishingClientInput"));
        lastClientAction = [action, target !== "-" ? `target ${target}` : "", input !== "-" ? input : ""].filter(Boolean).join(" / ");
        lastSourceLine = entry.lineNumber;
      }
      continue;
    }

    if (entry.header === 1107) {
      minigameActive = true;
      status = "minigame";
      note = "Minigame started";
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 1108) {
      minigameActive = true;
      status = "minigame";
      minigamePin = compactValue(fields.get("fishingMinigamePin"));
      minigameValues = compactValue(fields.get("fishingMinigameValues"));
      note = minigamePin !== "-" ? `Minigame pin ${minigamePin}` : "Minigame update";
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 1109) {
      minigameActive = false;
      status = "idle";
      note = "Minigame ended";
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 1102) {
      tokens = compactValue(fields.get("fishTokens"));
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 680) {
      const nextLevel = compactValue(fields.get("fishingLevel"));
      if (nextLevel !== "-") {
        level = nextLevel;
        note = `Fishing level ${nextLevel}`;
      }
      if (compactValue(fields.get("fishingFrenzyActive")) === "true") {
        frenzies += 1;
        status = "frenzy";
        note = "Fishing frenzy started";
      }
      const derby = compactValue(fields.get("fishingDerbyMessage"));
      if (derby !== "-") note = derby;
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 1101) {
      if (compactValue(fields.get("fishingSlipAway")) === "true") {
        status = "idle";
        minigameActive = false;
        note = "Fish slipped away";
        lastSourceLine = entry.lineNumber;
      }
      const fishName = compactValue(fields.get("fishingCatchName"));
      if (fishName !== "-") {
        const catchXp = Number.parseInt(compactValue(fields.get("fishingCatchXp")), 10);
        const goldenCatch = compactValue(fields.get("fishingCatchGolden")) === "true";
        const caught: PacketFishingCatch = {
          key: `line:${entry.lineNumber}:${fishName}:${compactValue(fields.get("fishingCatchXp"))}`,
          fishName,
          message: compactValue(fields.get("fishingCatchMessage")),
          xp: Number.isFinite(catchXp) ? catchXp : 0,
          golden: goldenCatch,
          sourceLine: entry.lineNumber,
        };
        if (!catchLog.some((existing) => existing.key === caught.key)) {
          catches += 1;
          xp += caught.xp;
          if (caught.golden) golden += 1;
          catchLog.push(caught);
        }
        lastCatch = caught;
        minigameActive = false;
        status = caught.golden ? "golden-catch" : "catch";
        note = `${caught.fishName} (+${caught.xp} XP)`;
        lastSourceLine = entry.lineNumber;
      }
    } else if (entry.header === 1115) {
      const count = parsedCount(fields.get("fishopediaCount"));
      if (count !== null) {
        fishopediaByKey.clear();
        for (let row = 1; row <= count; row += 1) {
          const fish = packetFishopediaEntryFromPrefix(fields, `fishopedia ${row}`, entry.lineNumber);
          if (fish) fishopediaByKey.set(fish.key, fish);
        }
      }
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 1116) {
      const fish = packetFishopediaEntryFromPrefix(fields, "fishopediaFish", entry.lineNumber);
      if (fish) {
        fishopediaByKey.set(fish.key, fish);
        note = `Fishopedia updated: ${fish.fishName}`;
      }
      lastSourceLine = entry.lineNumber;
    }
  }

  return {
    status,
    note,
    tokens,
    level,
    minigameActive,
    minigamePin,
    minigameValues,
    catches,
    golden,
    xp,
    frenzies,
    fishopedia: [...fishopediaByKey.values()].sort((left, right) => left.fishName.localeCompare(right.fishName)),
    catchLog: catchLog.slice(-100),
    lastCatch,
    lastClientAction,
    lastSourceLine,
  };
}

export function packetFishopediaEntryFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketFishopediaEntry | null {
  const fishName = compactValue(fields.get(`${prefix} name`));
  if (fishName === "-") return null;
  return {
    key: fishName.trim().toLowerCase(),
    fishName,
    xp: compactValue(fields.get(`${prefix} xp`)),
    catches: compactValue(fields.get(`${prefix} catches`)),
    completion: compactValue(fields.get(`${prefix} completion`)),
    location: compactValue(fields.get(`${prefix} location`)),
    sourceLine,
  };
}

export function packetChatRuntimeEntry(
  entry: PacketChatEntry,
  packetIndex: PacketProfileIndex,
  runtimeUsers: readonly RuntimeUserSummary[],
  sessionName?: string | null,
): RuntimeChatEntry {
  const numericIndex = Number(entry.index);
  const resolvedUser = packetChatUserName(entry.index, packetIndex, runtimeUsers, sessionName);
  return {
    index: Number.isFinite(numericIndex) ? numericIndex : undefined,
    timestamp: `line ${entry.sourceLine}`,
    userName: resolvedUser,
    chatMode: entry.chatMode === "-" ? "talk" : entry.chatMode,
    text: entry.text,
  };
}

export function packetChatUserName(
  index: string,
  packetIndex: PacketProfileIndex,
  runtimeUsers: readonly RuntimeUserSummary[],
  sessionName?: string | null,
): string {
  const cleanIndex = compactValue(index);
  if (cleanIndex === "0") return "System";
  const packetUser = cleanIndex !== "-" ? packetIndex.byIndex.get(cleanIndex) : null;
  if (packetUser) return packetUser.name;
  const runtimeUser = runtimeUsers.find((user) => compactValue(user.roomIndex ?? user.rowId) === cleanIndex);
  if (runtimeUser) return userDisplayName(runtimeUser, sessionName);
  return cleanIndex === "-" ? "System" : `#${cleanIndex}`;
}

export function packetWallItemStateFromEntries(
  entries: readonly RelayLogEntry[],
  startIndex = 0,
  initialState: PacketWallItemState = emptyPacketWallItemState,
): PacketWallItemState {
  const itemsByKey = new globalThis.Map<string, PacketWallItem>();
  for (const item of initialState.items) {
    itemsByKey.set(item.key, item);
  }
  let lastSourceLine = initialState.lastSourceLine;

  for (let entryIndex = Math.max(0, startIndex); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.direction !== "SERVER") continue;
    const fields = packetFieldMap(entry);
    if (entry.header === 45) {
      const count = parsedCount(fields.get("wallItemCount"));
      if (count === null) continue;
      itemsByKey.clear();
      for (let row = 1; row <= count; row += 1) {
        const item = packetWallItemFromPrefix(fields, `wallItem ${row}`, entry.lineNumber);
        if (item) itemsByKey.set(item.key, item);
      }
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 85) {
      const item = packetWallItemFromPrefix(fields, "wallItemUpdate", entry.lineNumber);
      if (item) itemsByKey.set(item.key, item);
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 84) {
      const itemId = compactValue(fields.get("wallItemRemove id"));
      if (itemId !== "-") itemsByKey.delete(`wall:${itemId}`);
      lastSourceLine = entry.lineNumber;
    }
  }

  const items = [...itemsByKey.values()].sort((left, right) => Number(left.itemId) - Number(right.itemId));
  return { items, itemCount: items.length, lastSourceLine };
}

export let packetWallItemStateCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: PacketWallItemState;
    }
  | null = null;

export function packetWallItemStateFromRelayLog(snapshot: RelayLogSnapshot | null): PacketWallItemState {
  if (!snapshot || snapshot.entries.length === 0) {
    packetWallItemStateCache = null;
    return emptyPacketWallItemState;
  }
  if (
    packetWallItemStateCache &&
    packetWallItemStateCache.logPath === snapshot.logPath &&
    packetWallItemStateCache.entryCount <= snapshot.entries.length &&
    packetWallItemStateCache.totalLines <= snapshot.totalLines
  ) {
    const state = packetWallItemStateFromEntries(snapshot.entries, packetWallItemStateCache.entryCount, packetWallItemStateCache.state);
    packetWallItemStateCache = {
      logPath: snapshot.logPath,
      entryCount: snapshot.entries.length,
      totalLines: snapshot.totalLines,
      state,
    };
    return state;
  }
  const state = packetWallItemStateFromEntries(snapshot.entries);
  packetWallItemStateCache = {
    logPath: snapshot.logPath,
    entryCount: snapshot.entries.length,
    totalLines: snapshot.totalLines,
    state,
  };
  return state;
}

export function packetWallItemFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketWallItem | null {
  const itemId = compactValue(fields.get(`${prefix} id`));
  if (itemId === "-") return null;
  return {
    key: `wall:${itemId}`,
    itemId,
    className: compactValue(fields.get(`${prefix} class`)),
    ownerName: compactValue(fields.get(`${prefix} owner`)),
    wall: compactValue(fields.get(`${prefix} wall`)),
    local: compactValue(fields.get(`${prefix} local`)),
    orientation: compactValue(fields.get(`${prefix} orientation`)),
    rawLocation: compactValue(fields.get(`${prefix} rawLocation`)),
    data: compactValue(fields.get(`${prefix} data`)),
    state: compactValue(fields.get(`${prefix} state`)),
    sourceLine,
  };
}

export function packetWallItemRow(item: PacketWallItem): ItemRow {
  const object: RuntimeObjectSummary = {
    id: item.itemId,
    objectId: item.itemId,
    className: item.className,
    name: item.className,
    ownerName: item.ownerName,
    wall: item.wall,
    local: item.local,
    orientation: item.orientation,
    rawLocation: item.rawLocation,
    state: item.state !== "-" ? item.state : item.data,
    type: "wall",
  };
  return {
    key: `packet-wall:${item.itemId}`,
    kind: "wall",
    label: "Wall",
    source: `relay.ITEMS.line.${item.sourceLine}`,
    item: object,
  };
}

export function packetInventoryStateFromEntries(
  entries: readonly RelayLogEntry[],
  startIndex = 0,
  initialState: PacketInventoryState = emptyPacketInventoryState,
): PacketInventoryState {
  const itemsByKey = new globalThis.Map<string, PacketInventoryItem>();
  for (const item of initialState.items) {
    itemsByKey.set(item.key, item);
  }
  let lastSourceLine = initialState.lastSourceLine;

  for (let entryIndex = Math.max(0, startIndex); entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.direction !== "SERVER") continue;
    const fields = packetFieldMap(entry);
    if (entry.header === 140) {
      const count = parsedCount(fields.get("inventoryItemCount"));
      if (count === null) continue;
      for (let row = 1; row <= count; row += 1) {
        const item = packetInventoryItemFromPrefix(fields, `inventoryItem ${row}`, entry.lineNumber);
        if (item) itemsByKey.set(item.key, item);
      }
      lastSourceLine = entry.lineNumber;
    } else if (entry.header === 99) {
      const key = packetInventoryKey(fields.get("inventoryRemove raw") ?? "", fields.get("inventoryRemove id") ?? "");
      if (key) itemsByKey.delete(key);
      lastSourceLine = entry.lineNumber;
    }
  }

  const items = [...itemsByKey.values()].sort((left, right) => {
    if (left.inventoryKind !== right.inventoryKind) return left.inventoryKind.localeCompare(right.inventoryKind);
    return left.className.localeCompare(right.className);
  });
  return {
    items,
    totalCount: items.length,
    floorCount: items.filter((item) => item.inventoryKind === "floor").length,
    wallCount: items.filter((item) => item.inventoryKind === "wall").length,
    lastSourceLine,
  };
}

export let packetInventoryStateCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: PacketInventoryState;
    }
  | null = null;

export function packetInventoryStateFromRelayLog(snapshot: RelayLogSnapshot | null): PacketInventoryState {
  if (!snapshot || snapshot.entries.length === 0) {
    packetInventoryStateCache = null;
    return emptyPacketInventoryState;
  }
  if (
    packetInventoryStateCache &&
    packetInventoryStateCache.logPath === snapshot.logPath &&
    packetInventoryStateCache.entryCount <= snapshot.entries.length &&
    packetInventoryStateCache.totalLines <= snapshot.totalLines
  ) {
    const state = packetInventoryStateFromEntries(snapshot.entries, packetInventoryStateCache.entryCount, packetInventoryStateCache.state);
    packetInventoryStateCache = {
      logPath: snapshot.logPath,
      entryCount: snapshot.entries.length,
      totalLines: snapshot.totalLines,
      state,
    };
    return state;
  }
  const state = packetInventoryStateFromEntries(snapshot.entries);
  packetInventoryStateCache = {
    logPath: snapshot.logPath,
    entryCount: snapshot.entries.length,
    totalLines: snapshot.totalLines,
    state,
  };
  return state;
}

export function packetInventoryItemFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketInventoryItem | null {
  const itemId = compactValue(fields.get(`${prefix} id`));
  const rawId = fields.get(`${prefix} rawId`) ?? "";
  const itemIdValue = compactValue(fields.get(`${prefix} idValue`));
  const key = packetInventoryKey(rawId, itemId);
  if (!key && itemIdValue === "-") return null;
  return {
    key: key || `value:${itemIdValue}`,
    itemId,
    rawId,
    itemIdValue,
    slotId: compactValue(fields.get(`${prefix} slotId`)),
    objectId: compactValue(fields.get(`${prefix} objectId`)),
    itemType: compactValue(fields.get(`${prefix} type`)),
    inventoryKind: compactValue(fields.get(`${prefix} kind`)),
    className: compactValue(fields.get(`${prefix} class`)),
    size: compactValue(fields.get(`${prefix} size`)),
    colors: compactValue(fields.get(`${prefix} colors`)),
    data: compactValue(fields.get(`${prefix} data`)),
    head: compactValue(fields.get(`${prefix} head`)),
    body: compactValue(fields.get(`${prefix} body`)),
    meta: compactValue(fields.get(`${prefix} meta`)),
    headTokens: compactValue(fields.get(`${prefix} headTokens`)),
    bodyTokens: compactValue(fields.get(`${prefix} bodyTokens`)),
    metaTokens: compactValue(fields.get(`${prefix} metaTokens`)),
    sourceLine,
  };
}

export function packetInventoryKey(rawId: string, displayId: string): string {
  if (rawId.length > 0) return `raw:${rawId}`;
  const cleanDisplayId = compactValue(displayId);
  return cleanDisplayId === "-" ? "" : `id:${cleanDisplayId}`;
}

export function packetInventorySearchText(item: PacketInventoryItem): string {
  return [
    item.itemId,
    item.itemIdValue,
    item.slotId,
    item.objectId,
    item.itemType,
    item.inventoryKind,
    item.className,
    item.size,
    item.colors,
    item.data,
    item.headTokens,
    item.bodyTokens,
    item.metaTokens,
  ]
    .join(" ")
    .toLowerCase();
}

export function packetInventoryTitle(item: PacketInventoryItem, metadata: FurniMetadataSnapshot | null): string {
  return compactValue(furniInfoForClass(metadata, item.className)?.name ?? item.className);
}

export function packetInventoryMeta(item: PacketInventoryItem): string {
  const parts = [
    `inv ${item.itemId !== "-" ? item.itemId : item.itemIdValue}`,
    item.objectId !== "-" ? `obj ${item.objectId}` : "",
    item.slotId !== "-" ? `slot ${item.slotId}` : "",
    item.size !== "-" ? `size ${item.size}` : "",
    item.colors !== "-" ? `colors ${item.colors}` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

export function runtimeInventoryDisplayRow(item: RuntimeInventoryItemSummary, metadata: FurniMetadataSnapshot | null): InventoryDisplayRow {
  const title = inventoryItemTitle(item, metadata);
  const meta = inventoryItemMeta(item);
  const detailRows = [
    { label: "Kind", value: inventoryKindLabel(item.inventoryKind) },
    { label: "Inv ID", value: compactValue(item.itemId) },
    { label: "Object ID", value: compactValue(item.objectId) },
    { label: "Slot", value: compactValue(item.slotId) },
    { label: "Class", value: compactValue(item.className) },
    { label: "Name", value: title },
    { label: "Size", value: compactValue(item.size) },
    { label: "Colors", value: compactValue(item.colors) },
    { label: "Data", value: compactValue(item.data) },
  ];
  return {
    key: `runtime:${item.rowId}`,
    kind: inventoryKindLabel(item.inventoryKind),
    title,
    meta,
    detailRows,
    searchText: [title, meta, item.inventoryKind, item.itemId, item.objectId, item.slotId, item.className, item.colors, item.data].join(" ").toLowerCase(),
  };
}

export function packetInventoryDisplayRow(item: PacketInventoryItem, metadata: FurniMetadataSnapshot | null): InventoryDisplayRow {
  const title = packetInventoryTitle(item, metadata);
  const meta = packetInventoryMeta(item);
  const detailRows = [
    { label: "Kind", value: inventoryKindLabel(item.inventoryKind) },
    { label: "Inv ID", value: item.itemId },
    { label: "ID Value", value: item.itemIdValue },
    { label: "Slot", value: item.slotId },
    { label: "Object ID", value: item.objectId },
    { label: "Class", value: item.className },
    { label: "Name", value: title },
    { label: "Size", value: item.size },
    { label: "Colors", value: item.colors },
    { label: "Data", value: item.data },
    { label: "Head Tokens", value: item.headTokens },
    { label: "Body Tokens", value: item.bodyTokens },
    { label: "Meta Tokens", value: item.metaTokens },
    { label: "Packet Line", value: String(item.sourceLine) },
  ];
  return {
    key: `packet:${item.key}`,
    kind: inventoryKindLabel(item.inventoryKind),
    title,
    meta,
    detailRows,
    searchText: [title, meta, packetInventorySearchText(item)].join(" ").toLowerCase(),
  };
}

export function packetProfileIndexFromUsers(users: readonly PacketProfileUser[]): PacketProfileIndex {
  if (users.length === 0) return emptyPacketProfileIndex;
  const byAccountId = new globalThis.Map<string, PacketProfileUser>();
  const byName = new globalThis.Map<string, PacketProfileUser>();
  const byIndex = new globalThis.Map<string, PacketProfileUser>();
  for (const user of users) {
    const accountId = compactValue(user.accountId);
    if (accountId !== "-") byAccountId.set(accountId, user);
    const name = user.name.trim().toLowerCase();
    if (name && name !== "-") byName.set(name, user);
    const index = compactValue(user.index);
    if (index !== "-") byIndex.set(index, user);
  }
  return { users, byAccountId, byName, byIndex };
}

export function selectPacketProfileUser(
  packetIndex: PacketProfileIndex,
  selectedName: string,
  selectedUser: RuntimeUserSummary | null,
): PacketProfileUser | null {
  if (packetIndex.users.length === 0) return null;
  const normalizedName = selectedName.trim().toLowerCase();
  const selectedAccountId = compactValue(selectedUser?.accountId);
  const selectedIndex = compactValue(selectedUser?.roomIndex ?? selectedUser?.rowId);
  if (selectedAccountId !== "-") {
    const match = packetIndex.byAccountId.get(selectedAccountId);
    if (match) return match;
  }
  if (normalizedName && normalizedName !== "-") {
    const match = packetIndex.byName.get(normalizedName);
    if (match) return match;
  }
  if (selectedIndex !== "-") {
    const match = packetIndex.byIndex.get(selectedIndex);
    if (match) return match;
  }
  return packetIndex.users[packetIndex.users.length - 1] ?? null;
}

export function packetProfileForRuntimeUser(packetIndex: PacketProfileIndex, user: RuntimeUserSummary, sessionName?: string | null): PacketProfileUser | null {
  const name = userDisplayName(user, sessionName).trim().toLowerCase();
  const accountId = compactValue(user.accountId);
  const index = compactValue(user.roomIndex ?? user.rowId);
  if (accountId !== "-") {
    const match = packetIndex.byAccountId.get(accountId);
    if (match) return match;
  }
  if (name && name !== "-") {
    const match = packetIndex.byName.get(name);
    if (match) return match;
  }
  if (index !== "-") {
    const match = packetIndex.byIndex.get(index);
    if (match) return match;
  }
  return null;
}

export function latestPacketVisitorUsers(packetUsers: readonly PacketProfileUser[]): readonly PacketProfileUser[] {
  const byKey = new globalThis.Map<string, PacketProfileUser>();
  for (const user of packetUsers) {
    if (compactValue(user.userType) !== "1") continue;
    const accountId = compactValue(user.accountId);
    const key = accountId !== "-" ? `id:${accountId}` : `name:${user.name.trim().toLowerCase()}`;
    byKey.set(key, user);
  }
  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function profileValue(primary: unknown, fallback: unknown): string {
  const value = compactValue(primary);
  if (value !== "-") return value;
  return compactValue(fallback);
}

export interface VisitorEntry {
  readonly key: string;
  readonly name: string;
  readonly accountId: string;
  readonly index: string;
  readonly rowId: string;
  readonly visits: number;
  readonly entered: string;
  readonly left: string;
  readonly current: boolean;
  readonly position: string;
  readonly userType: string;
  readonly packetLine: string;
  readonly sourceKeys: readonly string[];
}

export interface VisitorTrackerState {
  readonly roomKey: string;
  readonly activeKeys: readonly string[];
  readonly entries: Readonly<Record<string, VisitorEntry>>;
}

export const emptyVisitorState: VisitorTrackerState = {
  roomKey: "",
  activeKeys: [],
  entries: {},
};

export function isVisitorUser(user: RuntimeUserSummary): boolean {
  const sourceText = [user.type, user.userType, user.objectClass, user.className].map(compactValue).join(" ").toLowerCase();
  if (sourceText.includes("pet") || sourceText.includes("bot")) return false;
  if (sourceText.includes("human")) return true;
  return compactValue(user.type ?? user.userType) === "1" || Boolean(user.name || user.rowId);
}

export function visitorKeyFor(user: RuntimeUserSummary, sessionName?: string | null, packetUser?: PacketProfileUser | null): string {
  const accountId = profileValue(user.accountId, packetUser?.accountId);
  if (accountId !== "-") return `id:${accountId}`;
  const name = userDisplayName(user, sessionName).trim().toLowerCase();
  if (name && name !== "-") return `name:${name}`;
  return `row:${user.rowId}`;
}

export function visitorEntryFor(
  user: RuntimeUserSummary,
  sessionName: string | null | undefined,
  now: string,
  previous?: VisitorEntry,
  packetUser?: PacketProfileUser | null,
): VisitorEntry {
  const accountId = profileValue(user.accountId, packetUser?.accountId);
  const name = profileValue(userDisplayName(user, sessionName), packetUser?.name);
  const packetLine = packetUser ? String(packetUser.sourceLine) : "-";
  return {
    key: visitorKeyFor(user, sessionName, packetUser),
    name,
    accountId,
    index: profileValue(user.roomIndex ?? user.rowId, packetUser?.index),
    rowId: user.rowId,
    visits: previous?.visits ?? 1,
    entered: previous?.entered ?? now,
    left: "-",
    current: true,
    position: profileValue(userPosition(user), packetUser?.position),
    userType: profileValue(user.userType ?? user.type ?? user.objectClass, packetUser?.userType),
    packetLine,
    sourceKeys: packetUser ? [...user.sourceKeys, `relay.USERS.line.${packetUser.sourceLine}`] : user.sourceKeys,
  };
}

export function visitorEntryForPacketUser(user: PacketProfileUser, now: string, previous?: VisitorEntry): VisitorEntry {
  const key = compactValue(user.accountId) !== "-" ? `id:${user.accountId}` : `name:${user.name.trim().toLowerCase()}`;
  return {
    key,
    name: user.name,
    accountId: compactValue(user.accountId),
    index: compactValue(user.index),
    rowId: user.index,
    visits: previous?.visits ?? 1,
    entered: previous?.entered ?? now,
    left: "-",
    current: true,
    position: compactValue(user.position),
    userType: compactValue(user.userType),
    packetLine: String(user.sourceLine),
    sourceKeys: [`relay.USERS.line.${user.sourceLine}`],
  };
}

export function visitorSearchText(entry: VisitorEntry): string {
  return [
    entry.name,
    entry.accountId,
    entry.index,
    entry.visits,
    entry.entered,
    entry.left,
    entry.position,
    entry.userType,
    entry.packetLine,
    entry.sourceKeys.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

export function visitorMeta(entry: VisitorEntry): string {
  const id = entry.accountId === "-" ? "id missing" : `id:${entry.accountId}`;
  const visits = `${entry.visits} visit${entry.visits === 1 ? "" : "s"}`;
  return [
    id,
    visits,
    entry.position !== "-" ? `tile ${entry.position}` : "",
    entry.entered !== "-" ? `entered ${entry.entered}` : "",
    entry.current ? "in room" : `left ${entry.left}`,
  ]
    .filter(Boolean)
    .join(" / ");
}

export function inventoryKindLabel(kind: string): string {
  if (kind === "floor") return "Floor";
  if (kind === "wall") return "Wall";
  return compactValue(kind);
}

export function inventoryItemTitle(item: RuntimeInventoryItemSummary, metadata: FurniMetadataSnapshot | null = null): string {
  return furniDisplayName(metadata, item);
}

export function inventoryItemMeta(item: RuntimeInventoryItemSummary): string {
  const parts = [
    `inv ${compactValue(item.itemId)}`,
    item.objectId !== undefined ? `obj ${compactValue(item.objectId)}` : "",
    item.slotId !== undefined ? `slot ${compactValue(item.slotId)}` : "",
    item.size ? `size ${item.size}` : "",
    item.colors ? `colors ${item.colors}` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

export function relayEntryLabel(entry: RelayLogEntry): string {
  const client = entry.clientId ? `c${entry.clientId} ` : "";
  if (entry.direction === "RELAY") return `${client}relay #${entry.sessionId ?? "-"}`;
  return `${client}${entry.direction} h${compactValue(entry.header)} ${compactValue(entry.size)}B`;
}

export function relayEntryDisplayName(entry: RelayLogEntry): string {
  const name = entry.packetName ?? "UNKNOWN_HEADER";
  return name === "UNKNOWN_HEADER" ? "[UNKNOWN_HEADER]" : name;
}

export interface RelayDerivedState {
  readonly entryCount: number;
  readonly latestClientPacket: RelayLogEntry | null;
  readonly latestServerPacket: RelayLogEntry | null;
  readonly latestSessionId: string;
  readonly clientModes: readonly string[];
  readonly serverModes: readonly string[];
  readonly sessionChoices: readonly string[];
  readonly sampledBodies: number;
  readonly redactedBodies: number;
  readonly hasServerCrypto: boolean;
  readonly hasClientKeySwap: boolean;
}

export const emptyRelayDerivedState: RelayDerivedState = {
  entryCount: 0,
  latestClientPacket: null,
  latestServerPacket: null,
  latestSessionId: "-",
  clientModes: [],
  serverModes: [],
  sessionChoices: ["All"],
  sampledBodies: 0,
  redactedBodies: 0,
  hasServerCrypto: false,
  hasClientKeySwap: false,
};

let relayDerivedCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: RelayDerivedState;
    }
  | null = null;

export function relayDerivedStateFromSnapshot(snapshot: RelayLogSnapshot | null): RelayDerivedState {
  if (!snapshot || snapshot.entries.length === 0) {
    relayDerivedCache = null;
    return emptyRelayDerivedState;
  }
  const cache = relayDerivedCache;
  const canAppend =
    cache !== null &&
    cache.logPath === snapshot.logPath &&
    cache.entryCount <= snapshot.entries.length &&
    cache.totalLines <= snapshot.totalLines;
  const previous = canAppend ? cache.state : emptyRelayDerivedState;
  const startIndex = canAppend ? cache.entryCount : 0;
  let latestClientPacket = previous.latestClientPacket;
  let latestServerPacket = previous.latestServerPacket;
  let latestSessionId = previous.latestSessionId;
  const clientModes = new globalThis.Set(previous.clientModes);
  const serverModes = new globalThis.Set(previous.serverModes);
  const sessions = new globalThis.Set(previous.sessionChoices.filter((session) => session !== "All"));
  let sampledBodies = previous.sampledBodies;
  let redactedBodies = previous.redactedBodies;
  let hasServerCrypto = previous.hasServerCrypto;
  let hasClientKeySwap = previous.hasClientKeySwap;

  for (let index = startIndex; index < snapshot.entries.length; index += 1) {
    const entry = snapshot.entries[index]!;
    if (entry.sessionId) {
      latestSessionId = entry.sessionId;
      sessions.add(entry.sessionId);
    }
    if (entry.header !== null) {
      if (entry.direction === "CLIENT") latestClientPacket = entry;
      if (entry.direction === "SERVER") latestServerPacket = entry;
      const mode = compactValue(entry.mode);
      if (mode !== "-") {
        if (entry.direction === "CLIENT") clientModes.add(mode);
        if (entry.direction === "SERVER") serverModes.add(mode);
      }
    }
    if (entry.bodyStatus === "sampled") sampledBodies += 1;
    if (entry.bodyStatus === "redacted") redactedBodies += 1;
    if (/SECRET_KEY|BobbaCrypto/i.test(entry.message)) hasServerCrypto = true;
    if (/GENERATEKEY|public key/i.test(entry.message)) hasClientKeySwap = true;
  }

  const state: RelayDerivedState = {
    entryCount: snapshot.entries.length,
    latestClientPacket,
    latestServerPacket,
    latestSessionId,
    clientModes: [...clientModes],
    serverModes: [...serverModes],
    sessionChoices: ["All", ...sessions],
    sampledBodies,
    redactedBodies,
    hasServerCrypto,
    hasClientKeySwap,
  };
  relayDerivedCache = {
    logPath: snapshot.logPath,
    entryCount: snapshot.entries.length,
    totalLines: snapshot.totalLines,
    state,
  };
  return state;
}

export function relayModeSummary(modes: readonly string[]): string {
  return modes.length > 0 ? modes.join(" / ") : "-";
}

export function relayEncryptionSummary(state: RelayDerivedState): string {
  if (state.hasServerCrypto && state.hasClientKeySwap) return "BobbaCrypto active / key swap routed";
  if (state.hasServerCrypto) return "BobbaCrypto active";
  if (state.hasClientKeySwap) return "key swap routed";
  return state.entryCount > 0 ? "pending handshake evidence" : "-";
}

export function relayBodyLoggingSummary(state: RelayDerivedState): string {
  if (state.sampledBodies === 0 && state.redactedBodies === 0) return "-";
  return `${state.sampledBodies} sampled / ${state.redactedBodies} redacted`;
}

export function relayPacketSummary(entry: RelayLogEntry | null): string {
  if (!entry) return "-";
  const client = entry.clientId ? `client${entry.clientId} / ` : "";
  return `${client}${relayEntryDisplayName(entry)} h${compactValue(entry.header)} #${compactValue(entry.sessionId)}`;
}

export function bytesFromHex(hex: string | null): readonly number[] {
  if (!hex) return [];
  return hex
    .split(/\s+/)
    .map((part) => Number.parseInt(part, 16))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 255);
}

export function formatHabbpyV3PacketText(entry: RelayLogEntry): string {
  if (entry.header === null) return entry.message;
  if (entry.bodyStatus === "redacted") return "<redacted>";
  if (entry.bodyStatus !== "sampled") return entry.message;
  return formatShockwavePacketParts(entry.header, bytesFromHex(entry.bodyHex));
}

export function packetLogTimeLabel(updatedAt?: string | null): string {
  if (!updatedAt) return "--:--:--";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function relayEntryV3Line(entry: RelayLogEntry, updatedAt?: string | null): string {
  const clientPrefix = entry.clientId ? `[client${entry.clientId}] ` : "";
  if (entry.header === null) return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}[RELAY ] ${entry.message}`;
  const sidPrefix = entry.sessionId ? `[${entry.sessionId.slice(0, 6)}] ` : "";
  const name = relayEntryDisplayName(entry);
  const header = compactValue(entry.header);
  const size = compactValue(entry.size);
  return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}${sidPrefix}[${entry.direction.padEnd(6, " ")}] ${name} [${header}] (${size}B)  ${formatHabbpyV3PacketText(entry)}`;
}

export function relayEntryPlain(entry: RelayLogEntry, updatedAt?: string | null): string {
  return relayEntryV3Line(entry, updatedAt);
}

export function relayEntrySearchText(entry: RelayLogEntry): string {
  const cached = relayEntrySearchCache.get(entry);
  if (cached) return cached;
  const text = [
    entry.direction,
    entry.clientId ? `client${entry.clientId}` : "",
    entry.clientLabel,
    entry.route,
    entry.mode,
    entry.header,
    entry.packetName,
    entry.size,
    entry.payloadBytes,
    entry.bodyStatus,
    entry.bodyText,
    entry.bodyAscii,
    entry.bodyHex,
    entry.message,
    ...entry.decodedFields.flatMap((field) => [field.label, field.value]),
  ]
    .map((value) => compactValue(value).toLowerCase())
    .join(" ");
  relayEntrySearchCache.set(entry, text);
  return text;
}

const relayEntrySearchCache = new WeakMap<RelayLogEntry, string>();

export function packetClientMatches(entry: RelayLogEntry, clientFilter: string): boolean {
  return clientFilter === "All" || String(entry.clientId ?? "") === clientFilter;
}

export function normalizePacketClientFilter(value: string, choices: readonly { readonly value: string; readonly label: string }[]): string {
  const text = String(value || "All").trim().toLowerCase();
  if (!text || text === "all" || text === "all-clients") return "All";
  const numeric = text.replace(/^client/i, "");
  const match = choices.find((choice) => choice.value.toLowerCase() === numeric || choice.label.toLowerCase() === text || `client${choice.value}`.toLowerCase() === text);
  return match?.value ?? "All";
}
export const PACKET_ROW_HEIGHT = 42;
export const PACKET_RENDER_ROWS = 110;
export const PACKET_OVERSCAN_ROWS = 18;
export const PACKET_CONSOLE_ROW_HEIGHT = 18;
export const PACKET_CONSOLE_RENDER_ROWS = 180;
export const PACKET_CONSOLE_OVERSCAN_ROWS = 30;

export function virtualPacketRange(
  totalRows: number,
  scrollTop: number,
  rowHeight = PACKET_ROW_HEIGHT,
  renderRows = PACKET_RENDER_ROWS,
  overscanRows = PACKET_OVERSCAN_ROWS,
): { start: number; end: number; top: number; height: number } {
  if (totalRows <= 0) return { start: 0, end: 0, top: 0, height: 0 };
  const rawStart = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const start = Math.min(rawStart, Math.max(0, totalRows - renderRows));
  const end = Math.min(totalRows, start + renderRows);
  return {
    start,
    end,
    top: start * rowHeight,
    height: totalRows * rowHeight,
  };
}

export function mergeRelayLogSnapshot(
  current: RelayLogSnapshot | null,
  incoming: RelayLogSnapshot | RelayLogDeltaSnapshot,
): RelayLogSnapshot {
  const delta = incoming as RelayLogDeltaSnapshot;
  if (!current || !("reset" in incoming) || delta.reset || current.logPath !== incoming.logPath) {
    return {
      logPath: incoming.logPath,
      exists: incoming.exists,
      fileSize: incoming.fileSize,
      updatedAt: incoming.updatedAt,
      totalLines: incoming.totalLines,
      packetCount: incoming.packetCount,
      clientCount: incoming.clientCount,
      serverCount: incoming.serverCount,
      entries: incoming.entries,
      message: incoming.message,
    };
  }
  if (
    current.fileSize === incoming.fileSize &&
    current.updatedAt === incoming.updatedAt &&
    current.totalLines === incoming.totalLines &&
    incoming.entries.length === 0
  ) {
    return current;
  }
  return {
    logPath: incoming.logPath,
    exists: incoming.exists,
    fileSize: incoming.fileSize,
    updatedAt: incoming.updatedAt,
    totalLines: incoming.totalLines,
    packetCount: incoming.packetCount,
    clientCount: incoming.clientCount,
    serverCount: incoming.serverCount,
    entries: incoming.entries.length > 0 ? [...current.entries, ...incoming.entries] : current.entries,
    message: incoming.message,
  };
}

export function relayLogSnapshotForClient(snapshot: RelayLogSnapshot | null, clientId: number | null): RelayLogSnapshot | null {
  if (!snapshot || !Number.isInteger(clientId) || (clientId ?? 0) <= 0) return null;
  const selectedClientId = clientId as number;
  const entries = snapshot.entries.filter((entry) => entry.clientId === selectedClientId || (selectedClientId === 1 && entry.clientId === null));
  let packetCount = 0;
  let clientCount = 0;
  let serverCount = 0;
  for (const entry of entries) {
    if (entry.header === null) continue;
    packetCount += 1;
    if (entry.direction === "CLIENT") clientCount += 1;
    if (entry.direction === "SERVER") serverCount += 1;
  }
  return {
    ...snapshot,
    logPath: `${snapshot.logPath}#client-${selectedClientId}`,
    packetCount,
    clientCount,
    serverCount,
    entries,
    message: entries.length > 0
      ? `Selected client${selectedClientId} relay view active.`
      : `No relay rows for selected client${selectedClientId}.`,
  };
}

export function clientPluginSnapshotForClient(options: {
  readonly clientId: number;
  readonly label: string;
  readonly relay: RelayLogSnapshot | null;
  readonly runtime: EngineRuntimeSnapshot | null;
  readonly runtimeSummary: ClientRuntimeSummary | null;
}): ClientPluginSnapshot {
  const profileUsers = options.relay ? packetUsersFromEntries(options.relay.entries) : [];
  const packetInfo = options.relay ? packetInfoStateFromEntries(options.relay.entries) : emptyPacketInfoState;
  const packetInventory = options.relay ? packetInventoryStateFromEntries(options.relay.entries) : emptyPacketInventoryState;
  const packetWallItems = options.relay ? packetWallItemStateFromEntries(options.relay.entries) : emptyPacketWallItemState;
  const packetChatEntries = options.relay ? packetChatEntriesFromEntries(options.relay.entries) : [];
  const packetFishing = options.relay ? packetFishingStateFromEntries(options.relay.entries) : emptyPacketFishingState;
  return {
    clientId: options.clientId,
    label: options.label,
    relay: options.relay,
    runtime: options.runtime,
    runtimeSummary: options.runtimeSummary,
    profileUsers,
    profileIndex: packetProfileIndexFromUsers(profileUsers),
    packetInfo,
    packetInventory,
    packetWallItems,
    packetChatEntries,
    packetFishing,
    updatedAt: options.runtimeSummary?.updatedAt ?? options.relay?.updatedAt ?? null,
  };
}

export function clientPluginSnapshotMapFromSources(options: {
  readonly relayLog: RelayLogSnapshot | null;
  readonly sessions: readonly ClientSessionSummary[];
  readonly selectedClientId: number;
  readonly selectedRuntimeSnapshot: EngineRuntimeSnapshot | null;
  readonly selectedClientSnapshot: ClientSnapshot | null;
}): ReadonlyMap<number, ClientPluginSnapshot> {
  const sessions = options.sessions.length > 0
    ? options.sessions
    : options.selectedClientSnapshot?.client
      ? [options.selectedClientSnapshot.client]
      : [];
  const map = new globalThis.Map<number, ClientPluginSnapshot>();
  for (const session of sessions) {
    const runtimeSummary = options.selectedClientSnapshot?.client?.id === session.id ? options.selectedClientSnapshot.runtime : null;
    map.set(
      session.id,
      clientPluginSnapshotForClient({
        clientId: session.id,
        label: session.label || `client${session.id}`,
        relay: relayLogSnapshotForClient(options.relayLog, session.id),
        runtime: session.id === options.selectedClientId ? options.selectedRuntimeSnapshot : null,
        runtimeSummary,
      }),
    );
  }
  if (!map.has(options.selectedClientId)) {
    const selected = options.selectedClientSnapshot?.client;
    map.set(
      options.selectedClientId,
      clientPluginSnapshotForClient({
        clientId: options.selectedClientId,
        label: selected?.label || `client${options.selectedClientId}`,
        relay: relayLogSnapshotForClient(options.relayLog, options.selectedClientId),
        runtime: options.selectedRuntimeSnapshot,
        runtimeSummary: options.selectedClientSnapshot?.runtime ?? null,
      }),
    );
  }
  return map;
}

export function mergeClientSummaryIntoList(current: ClientSessionList | null, snapshot: ClientSnapshot): ClientSessionList | null {
  if (!current || !snapshot.client) return current;
  return {
    ...current,
    sessions: current.sessions.map((session) => session.id === snapshot.client?.id ? snapshot.client : session),
  };
}

export interface UserPluginRoomUserCache {
  readonly roomKey: string;
  readonly usersByKey: ReadonlyMap<string, ReturnType<typeof pluginRuntimeUserPayload>>;
}

export interface UserPluginRoomObjectRecord {
  readonly payload: ReturnType<typeof pluginRuntimeItemPayload>;
  readonly signature: string;
}

export interface UserPluginRoomObjectCache {
  readonly roomKey: string;
  readonly itemsByKey: ReadonlyMap<string, UserPluginRoomObjectRecord>;
}

export interface UserPluginChatCache {
  readonly roomKey: string;
  readonly keys: ReadonlySet<string>;
}

export function pluginHasPermission(plugin: PluginDefinition, permission: PluginPermission): boolean {
  return (plugin.permissions ?? []).includes(permission);
}

export function requirePluginPermission(plugin: PluginDefinition, permissions: readonly PluginPermission[]): void {
  if (permissions.some((permission) => pluginHasPermission(plugin, permission))) return;
  throw new Error(`${plugin.name} needs ${permissions.map(permissionLabel).join(" or ")} permission.`);
}

export function isDisabledPluginCleanupRequest(api: string): boolean {
  return ["storage.get", "storage.set", "storage.delete", "client.getRights", "client.removeRights"].includes(api);
}

export function assertDisabledPluginCleanupRequest(plugin: PluginDefinition, api: string, args: Record<string, unknown>): void {
  if (!isDisabledPluginCleanupRequest(api)) {
    throw new Error(`${plugin.name} is disabled.`);
  }
  if (api !== "client.removeRights") return;
  const managedRights = pluginManagedClientRights(plugin);
  const managedKeys = new Set(managedRights.map((right) => right.toLowerCase()));
  const requestedRights = cleanPluginRightsList(args.rights);
  if (requestedRights.length === 0) throw new Error(`${plugin.name} can only remove managed client rights while disabled.`);
  if (requestedRights.some((right) => !managedKeys.has(right.toLowerCase()))) {
    throw new Error(`${plugin.name} can only remove its own managed client rights while disabled.`);
  }
}

export function pluginRoomKey(snapshot: EngineRuntimeSnapshot | null): string {
  if (!snapshot) return "";
  return `${runtimeRoomType(snapshot)}:${runtimeRoomId(snapshot)}:${runtimeRoomName(snapshot)}`;
}

export function pluginRoomPayload(snapshot: EngineRuntimeSnapshot | null) {
  return {
    id: compactValue(runtimeRoomId(snapshot)),
    name: runtimeRoomName(snapshot),
    owner: runtimeRoomOwner(snapshot),
    type: runtimeRoomType(snapshot),
    layout: compactValue(runtimeRoomProp(snapshot, "#layout") ?? runtimeRoomProp(snapshot, "layout")),
    ready: Boolean(snapshot?.roomReady?.ready ?? snapshot?.roomEntryState?.roomReady?.ready),
  };
}

export function pluginRuntimeUserKey(user: RuntimeUserSummary, sessionName?: string | null): string {
  const accountId = compactValue(user.accountId);
  if (accountId !== "-") return `account:${accountId}`;
  const roomIndex = compactValue(user.roomIndex);
  if (roomIndex !== "-") return `room-index:${roomIndex}`;
  return `row:${user.rowId}:${userDisplayName(user, sessionName).trim().toLowerCase()}`;
}

export function pluginRuntimeUserPayload(user: RuntimeUserSummary, sessionName?: string | null) {
  const displayName = userDisplayName(user, sessionName);
  const kind = pluginRuntimeUserKind(user, sessionName);
  return {
    key: pluginRuntimeUserKey(user, sessionName),
    id: compactValue(user.id ?? user.objectId ?? user.rowId),
    rowId: user.rowId,
    roomIndex: compactValue(user.roomIndex),
    accountId: compactValue(user.accountId),
    name: displayName,
    isSelf: Boolean(sessionName && displayName.trim().toLowerCase() === String(sessionName).trim().toLowerCase()),
    figure: compactValue(user.figure),
    gender: compactValue(user.gender),
    motto: compactValue(user.motto),
    badgeCode: compactValue(user.badgeCode),
    userType: compactValue(user.userType ?? user.type ?? user.objectClass),
    kind,
    isBot: kind === "bot",
    isHuman: kind === "human" || kind === "self",
    position: userPosition(user),
    activity: compactValue(user.activity),
    typing: user.typing ?? null,
    expression: compactValue(user.expression),
    lastSaid: compactValue(user.lastSaid),
  };
}

export function pluginRuntimeItemSignature(row: RuntimeItemRow): string {
  const item = row.item;
  return JSON.stringify({
    key: row.key,
    kind: row.kind,
    id: compactValue(item.objectId ?? item.id),
    className: compactValue(item.className ?? item.name),
    name: compactValue(item.name),
    ownerName: compactValue(item.ownerName),
    x: compactValue(item.x),
    y: compactValue(item.y),
    z: compactValue(item.z),
    direction: compactValue(item.direction),
    wall: compactValue(item.wall),
    local: compactValue(item.local),
    orientation: compactValue(item.orientation),
    rawLocation: compactValue(item.rawLocation),
    state: compactValue(item.state),
    type: compactValue(item.type),
  });
}

export function pluginRuntimeItemPayload(row: RuntimeItemRow, metadata: FurniMetadataSnapshot | null = null) {
  const item = row.item;
  const tile = itemRowTile(row);
  const wallLocation = wallMoverLocation(item);
  return {
    key: row.key,
    kind: row.kind,
    label: row.label,
    source: row.source,
    id: compactValue(item.objectId ?? item.id),
    objectId: compactValue(item.objectId),
    itemId: compactValue(item.id),
    className: compactValue(item.className ?? item.name),
    name: itemRowTitle(row, metadata),
    ownerName: compactValue(item.ownerName),
    meta: itemRowMeta(row, metadata),
    searchText: itemRowSearchText(row, metadata),
    tile,
    wallLocation,
    wall: compactValue(item.wall),
    local: compactValue(item.local),
    orientation: compactValue(item.orientation ?? item.direction),
    rawLocation: compactValue(item.rawLocation),
    state: item.state ?? null,
    type: compactValue(item.type),
    raw: item,
  };
}

export function pluginRoomObjectRecords(
  snapshot: EngineRuntimeSnapshot | null,
  metadata: FurniMetadataSnapshot | null,
): ReadonlyMap<string, UserPluginRoomObjectRecord> {
  const map = new globalThis.Map<string, UserPluginRoomObjectRecord>();
  for (const row of runtimeItemRows(snapshot)) {
    map.set(row.key, {
      payload: pluginRuntimeItemPayload(row, metadata),
      signature: pluginRuntimeItemSignature(row),
    });
  }
  return map;
}

export function pluginRoomObjectsPayload(snapshot: EngineRuntimeSnapshot | null, clientId: number, metadata: FurniMetadataSnapshot | null) {
  const items = [...pluginRoomObjectRecords(snapshot, metadata).values()].map((record) => record.payload);
  const floorItems = items.filter((item) => item.kind !== "wall");
  const wallItems = items.filter((item) => item.kind === "wall");
  return {
    clientId,
    room: pluginRoomPayload(snapshot),
    counts: {
      total: items.length,
      floorItems: floorItems.length,
      wallItems: wallItems.length,
      activeObjects: snapshot?.roomObjects?.counts.activeObjects ?? 0,
      passiveObjects: snapshot?.roomObjects?.counts.passiveObjects ?? 0,
    },
    items,
    floorItems,
    wallItems,
  };
}

export function dispatchPluginRoomItemEvent(
  host: RendererUserPluginHost,
  phase: "Added" | "Updated" | "Removed",
  clientId: number,
  room: ReturnType<typeof pluginRoomPayload>,
  item: ReturnType<typeof pluginRuntimeItemPayload>,
  previous: ReturnType<typeof pluginRuntimeItemPayload> | null = null,
): void {
  const payload = { clientId, room, item, previous };
  host.dispatchEvent(`room.item${phase}`, payload);
  host.dispatchEvent(`room.${item.kind === "wall" ? "wallItem" : "floorItem"}${phase}`, payload);
}

const fishingPublicRoomNpcNames = new Set(["bob", "recruiter blaze"]);

export function pluginRuntimeUserKind(user: RuntimeUserSummary, sessionName?: string | null): "self" | "human" | "bot" | "unknown" {
  const displayName = userDisplayName(user, sessionName).trim();
  const normalizedName = displayName.toLowerCase();
  const normalizedSession = String(sessionName ?? "").trim().toLowerCase();
  if (normalizedName && normalizedSession && normalizedName === normalizedSession) return "self";
  const type = compactValue(user.userType ?? user.type ?? user.objectClass ?? user.className).trim().toLowerCase();
  const sourceText = [type, user.objectClass, user.className].map(compactValue).join(" ").toLowerCase();
  if (type === "1" || sourceText.includes("human")) return "human";
  if ((/^\d+$/.test(type) && type !== "1") || sourceText.includes("bot") || sourceText.includes("pet")) return "bot";
  if (fishingPublicRoomNpcNames.has(normalizedName)) return "bot";
  if (compactValue(user.accountId) !== "-" || compactValue(user.figure) !== "-") return "human";
  return "unknown";
}

export function pluginRoomOccupantsPayload(snapshot: EngineRuntimeSnapshot | null) {
  const sessionName = snapshot?.userState?.sessionUserName ?? null;
  const users = (snapshot?.userState?.users ?? []).map((user) => pluginRuntimeUserPayload(user, sessionName));
  const humans = users.filter((user) => user.kind === "human" || user.kind === "self");
  const others = users.filter((user) => user.kind === "human");
  const bots = users.filter((user) => user.kind === "bot");
  const unknown = users.filter((user) => user.kind === "unknown");
  return {
    totalCount: users.length,
    humanCount: humans.length,
    otherHumanCount: others.length,
    botCount: bots.length,
    unknownCount: unknown.length,
    safeToAutomate: others.length === 0,
    self: users.find((user) => user.kind === "self") ?? null,
    bob: users.find((user) => String(user.name ?? "").trim().toLowerCase() === "bob") ?? null,
    users,
    otherHumans: others,
    bots,
    unknown,
  };
}

export function pluginRoomUsersPayload(snapshot: EngineRuntimeSnapshot | null, clientId: number) {
  const sessionName = snapshot?.userState?.sessionUserName ?? null;
  const users = snapshot?.userState?.users ?? [];
  return {
    clientId,
    room: pluginRoomPayload(snapshot),
    users: users.map((user) => pluginRuntimeUserPayload(user, sessionName)),
  };
}

export function pluginRelayPacketPayload(entry: RelayLogEntry, updatedAt?: string | null) {
  const direction = entry.direction === "CLIENT" ? "client" : entry.direction === "SERVER" ? "server" : "relay";
  return {
    id: entry.id,
    lineNumber: entry.lineNumber,
    clientId: entry.clientId ?? 1,
    clientLabel: entry.clientLabel,
    sessionId: entry.sessionId,
    direction,
    route: entry.route,
    mode: entry.mode,
    header: entry.header,
    packetName: entry.packetName,
    size: entry.size,
    payloadBytes: entry.payloadBytes,
    bodyStatus: entry.bodyStatus,
    bodyText: entry.bodyText,
    bodyHex: entry.bodyHex,
    bodyAscii: entry.bodyAscii,
    bodyTruncated: entry.bodyTruncated,
    bodyNote: entry.bodyNote,
    message: entry.message,
    decodedFields: entry.decodedFields,
    plainText: relayEntryPlain(entry, updatedAt),
  };
}

export function pluginChatPayload(entry: RuntimeChatEntry, clientId: number, room: ReturnType<typeof pluginRoomPayload>) {
  return {
    clientId,
    room,
    index: entry.index ?? null,
    timestamp: entry.timestamp ?? null,
    userName: entry.userName ?? "System",
    userId: entry.userId ?? null,
    mode: entry.chatMode ?? "talk",
    text: entry.text ?? "",
  };
}

export function pluginStorageKey(pluginId: string, key: unknown): string {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey || normalizedKey.length > 120 || /[\x00-\x1f]/.test(normalizedKey)) {
    throw new Error("Plugin storage key must be 1-120 printable characters.");
  }
  return `habbpy-v4:user-plugin:${pluginId}:${normalizedKey}`;
}

export function requestedPluginClientId(args: unknown, selectedClientId: number): number {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const direct = Number(record.clientId);
  const options = record.options && typeof record.options === "object" ? (record.options as Record<string, unknown>) : {};
  const nested = Number(options.clientId);
  const candidate = Number.isInteger(direct) && direct > 0 ? direct : Number.isInteger(nested) && nested > 0 ? nested : selectedClientId;
  return candidate;
}

export function cleanPluginRightsList(value: unknown): readonly string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s]+/)
      : [];
  const seen = new Set<string>();
  const rights: string[] = [];
  for (const entry of raw) {
    const right = String(entry ?? "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(right)) continue;
    const key = right.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rights.push(right);
  }
  return rights;
}

export function pluginManagedClientRights(plugin: PluginDefinition): readonly string[] {
  return cleanPluginRightsList(plugin.managedRuntime?.clientRights ?? []);
}

export function disabledManagedClientRights(
  pluginList: readonly PluginDefinition[],
  enabledById: Readonly<Record<string, boolean>>,
): readonly string[] {
  const enabledManaged = new Set<string>();
  for (const plugin of pluginList) {
    if (enabledById[plugin.id] === false) continue;
    for (const right of pluginManagedClientRights(plugin)) enabledManaged.add(right.toLowerCase());
  }

  const seen = new Set<string>();
  const rights: string[] = [];
  for (const plugin of pluginList) {
    if (enabledById[plugin.id] !== false) continue;
    for (const right of pluginManagedClientRights(plugin)) {
      const key = right.toLowerCase();
      if (enabledManaged.has(key) || seen.has(key)) continue;
      seen.add(key);
      rights.push(right);
    }
  }
  return rights;
}

export function matchingClientRights(currentRights: readonly string[] | undefined, wantedRights: readonly string[]): readonly string[] {
  const current = new Set((currentRights ?? []).map((right) => right.toLowerCase()));
  return wantedRights.filter((right) => current.has(right.toLowerCase()));
}

export function clientRightsPayloadRights(value: unknown, key: "before" | "rights"): readonly string[] {
  if (!value || typeof value !== "object") return [];
  const record = value as { readonly result?: unknown; readonly [field: string]: unknown };
  const nested = record.result && typeof record.result === "object" ? record.result as Record<string, unknown> : null;
  return cleanPluginRightsList(nested?.[key] ?? record[key]);
}

export function addClientRightOwners(owners: PluginClientRightsOwners, clientId: number, pluginId: string, rights: readonly string[]): void {
  if (rights.length === 0) return;
  const byRight = owners.get(clientId) ?? new globalThis.Map<string, Set<string>>();
  owners.set(clientId, byRight);
  for (const right of rights) {
    const key = right.toLowerCase();
    const pluginsForRight = byRight.get(key) ?? new Set<string>();
    pluginsForRight.add(pluginId);
    byRight.set(key, pluginsForRight);
  }
}

export function removeClientRightOwners(owners: PluginClientRightsOwners, clientId: number, pluginId: string, rights: readonly string[]): void {
  const byRight = owners.get(clientId);
  if (!byRight) return;
  for (const right of rights) {
    const key = right.toLowerCase();
    const pluginsForRight = byRight.get(key);
    if (!pluginsForRight) continue;
    pluginsForRight.delete(pluginId);
    if (pluginsForRight.size === 0) byRight.delete(key);
  }
  if (byRight.size === 0) owners.delete(clientId);
}

export function updateClientRightOwners(
  owners: PluginClientRightsOwners,
  plugin: PluginDefinition,
  clientId: number,
  mode: "get" | "set" | "grant" | "remove",
  requestedRights: readonly string[],
  actionResult: EngineRuntimeActionResult,
): void {
  if (mode === "get") return;
  const managedRights = pluginManagedClientRights(plugin);
  if (managedRights.length === 0) return;
  const managedKeys = new Set(managedRights.map((right) => right.toLowerCase()));
  const afterKeys = new Set(clientRightsPayloadRights(actionResult.result, "rights").map((right) => right.toLowerCase()));
  if (mode === "remove") {
    removeClientRightOwners(owners, clientId, plugin.id, requestedRights.filter((right) => managedKeys.has(right.toLowerCase())));
    return;
  }
  if (mode === "set") {
    addClientRightOwners(owners, clientId, plugin.id, managedRights.filter((right) => afterKeys.has(right.toLowerCase())));
    removeClientRightOwners(owners, clientId, plugin.id, managedRights.filter((right) => !afterKeys.has(right.toLowerCase())));
    return;
  }
  addClientRightOwners(
    owners,
    clientId,
    plugin.id,
    requestedRights.filter((right) => managedKeys.has(right.toLowerCase()) && afterKeys.has(right.toLowerCase())),
  );
}

export function cleanInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function cleanPositiveInt(value: unknown, fallback: number): number {
  const parsed = cleanInteger(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export function pluginWalkTargetFromSnapshot(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
): { readonly x: number; readonly y: number; readonly furniId: number; readonly label: string } | null {
  const rows = runtimeItemRows(snapshot).filter((row) => row.kind !== "wall" && itemRowTile(row));
  if (rows.length === 0) return null;

  const selectorRecord = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const idCandidate = finiteNumber(
    selectorRecord.objectId ??
      selectorRecord.itemId ??
      selectorRecord.id ??
      (typeof selector === "number" || (typeof selector === "string" && /^\d+$/.test(selector.trim())) ? selector : null),
  );
  if (idCandidate !== null) {
    const targetId = Math.trunc(idCandidate);
    const idMatch = rows.find((row) => runtimeObjectNumericIds(row.item).includes(targetId));
    const resolved = pluginWalkTargetFromRow(idMatch, metadata);
    if (resolved) return resolved;
  }

  const textSelector = firstNonEmptyText([
    typeof selector === "string" ? selector : "",
    selectorRecord.name,
    selectorRecord.className,
    selectorRecord.query,
    selectorRecord.text,
    selectorRecord.key,
  ]);
  if (!textSelector) return null;

  const normalized = textSelector.toLowerCase();
  const exact = selectorRecord.exact === true;
  const textMatch = rows.find((row) => {
    const exactCandidates = [
      row.key,
      row.item.className,
      row.item.name,
      itemRowTitle(row, metadata),
      objectTitle(row.item),
      ...runtimeObjectNumericIds(row.item).map(String),
    ].map((value) => compactValue(value).toLowerCase());
    if (exact) return exactCandidates.includes(normalized);
    return itemRowSearchText(row, metadata).includes(normalized) || exactCandidates.some((candidate) => candidate.includes(normalized));
  });
  return pluginWalkTargetFromRow(textMatch, metadata);
}

export function pluginWalkTargetFromRow(
  row: ItemRow | null | undefined,
  metadata: FurniMetadataSnapshot | null,
): { readonly x: number; readonly y: number; readonly furniId: number; readonly label: string } | null {
  const tile = itemRowTile(row);
  if (!row || !tile) return null;
  return {
    x: tile.x,
    y: tile.y,
    furniId: objectNumericId(row.item) ?? 0,
    label: `${itemRowTitle(row, metadata)} (${compactValue(row.item.className ?? row.key)})`,
  };
}

export function pluginFindItemRows(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
  kind: "floor" | "wall" | "all" = "all",
): readonly ItemRow[] {
  const rows = runtimeItemRows(snapshot).filter((row) => {
    if (kind === "floor") return row.kind !== "wall";
    if (kind === "wall") return row.kind === "wall";
    return true;
  });
  if (pluginSelectorIsEmpty(selector)) return rows;
  return rows.filter((row) => pluginItemRowMatchesSelector(row, selector, metadata));
}

export function pluginSelectorIsEmpty(selector: unknown): boolean {
  if (selector === null || selector === undefined || selector === "") return true;
  if (typeof selector !== "object") return false;
  return Object.keys(selector as Record<string, unknown>).length === 0;
}

export function pluginItemRowMatchesSelector(row: ItemRow, selector: unknown, metadata: FurniMetadataSnapshot | null): boolean {
  const selectorRecord = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const idCandidate = finiteNumber(
    selectorRecord.objectId ??
      selectorRecord.itemId ??
      selectorRecord.id ??
      (typeof selector === "number" || (typeof selector === "string" && /^\d+$/.test(selector.trim())) ? selector : null),
  );
  if (idCandidate !== null && runtimeObjectNumericIds(row.item).includes(Math.trunc(idCandidate))) return true;

  const textSelector = firstNonEmptyText([
    typeof selector === "string" ? selector : "",
    selectorRecord.key,
    selectorRecord.name,
    selectorRecord.className,
    selectorRecord.query,
    selectorRecord.text,
    selectorRecord.ownerName,
  ]);
  if (!textSelector) return false;
  const normalized = textSelector.toLowerCase();
  const exact = selectorRecord.exact === true;
  const exactCandidates = [
    row.key,
    row.kind,
    row.label,
    row.item.className,
    row.item.name,
    row.item.ownerName,
    itemRowTitle(row, metadata),
    objectTitle(row.item),
    ...runtimeObjectNumericIds(row.item).map(String),
  ].map((value) => compactValue(value).toLowerCase());
  if (exact) return exactCandidates.includes(normalized);
  return itemRowSearchText(row, metadata).includes(normalized) || exactCandidates.some((candidate) => candidate.includes(normalized));
}

export function pluginResolveFloorItem(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
): { readonly row: ItemRow; readonly id: number; readonly tile: { readonly x: number; readonly y: number; readonly direction: number } } | null {
  const row = pluginFindItemRows(snapshot, selector, metadata, "floor")[0];
  const id = objectNumericId(row?.item);
  const tile = itemRowTile(row);
  return row && id !== null && tile ? { row, id, tile } : null;
}

export function pluginResolveWallItem(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
): { readonly row: ItemRow; readonly id: number; readonly location: WallMoverLocation } | null {
  const row = pluginFindItemRows(snapshot, selector, metadata, "wall")[0];
  const id = objectNumericId(row?.item);
  const location = wallMoverLocation(row?.item);
  return row && id !== null && location ? { row, id, location } : null;
}

export function pluginSelectorNumericId(selector: unknown): number | null {
  const record = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const parsed = finiteNumber(
    record.objectId ??
      record.itemId ??
      record.id ??
      (typeof selector === "number" || (typeof selector === "string" && /^\d+$/.test(selector.trim())) ? selector : null),
  );
  return parsed !== null && parsed > 0 ? Math.trunc(parsed) : null;
}

export function pluginSelectorTile(selector: unknown): { readonly x: number; readonly y: number; readonly direction: number } | null {
  const record = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const tileRecord = record.tile && typeof record.tile === "object" ? (record.tile as Record<string, unknown>) : record;
  const x = finiteNumber(tileRecord.x);
  const y = finiteNumber(tileRecord.y);
  if (x === null || y === null) return null;
  return { x: Math.trunc(x), y: Math.trunc(y), direction: cleanInteger(tileRecord.direction, 0) };
}

export function pluginSelectorKind(selector: unknown): "floor" | "wall" | null {
  const record = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const kind = String(record.kind ?? "").trim().toLowerCase();
  if (kind === "wall" || kind === "wallitem" || kind === "wall-item") return "wall";
  if (kind === "floor" || kind === "flooritem" || kind === "floor-item" || kind === "active" || kind === "passive") return "floor";
  return null;
}

export function pluginSelectorWallLocation(selector: unknown, location: unknown): WallMoverLocation | null {
  const locationRecord = location && typeof location === "object" ? (location as Record<string, unknown>) : {};
  const selectorRecord = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const candidate = Object.keys(locationRecord).length > 0
    ? locationRecord
    : selectorRecord.wallLocation && typeof selectorRecord.wallLocation === "object"
      ? (selectorRecord.wallLocation as Record<string, unknown>)
      : selectorRecord;
  const directWallX = finiteNumber(candidate.wallX);
  const directWallY = finiteNumber(candidate.wallY);
  const directLocalX = finiteNumber(candidate.localX);
  const directLocalY = finiteNumber(candidate.localY);
  const orientation = candidate.orientation === "r" || candidate.orientation === "l" ? candidate.orientation : null;
  if (directWallX !== null && directWallY !== null && directLocalX !== null && directLocalY !== null && orientation) {
    return {
      wallX: Math.trunc(directWallX),
      wallY: Math.trunc(directWallY),
      localX: Math.trunc(directLocalX),
      localY: Math.trunc(directLocalY),
      orientation,
    };
  }
  return null;
}

export function pluginWallMoveLocation(base: WallMoverLocation, input: unknown): WallMoverLocation {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const deltaX = cleanInteger(record.deltaX ?? record.dx, 0);
  const deltaY = cleanInteger(record.deltaY ?? record.dy, 0);
  const orientation = record.orientation === "r" || record.orientation === "l" ? record.orientation : base.orientation;
  return {
    wallX: Object.prototype.hasOwnProperty.call(record, "wallX") ? cleanInteger(record.wallX, base.wallX) : base.wallX + deltaX,
    wallY: Object.prototype.hasOwnProperty.call(record, "wallY") ? cleanInteger(record.wallY, base.wallY) : base.wallY + deltaY,
    localX: Object.prototype.hasOwnProperty.call(record, "localX") ? cleanInteger(record.localX, base.localX) : base.localX,
    localY: Object.prototype.hasOwnProperty.call(record, "localY") ? cleanInteger(record.localY, base.localY) : base.localY,
    orientation,
  };
}

export function pluginFishingAreaRows(snapshot: EngineRuntimeSnapshot | null, metadata: FurniMetadataSnapshot | null): readonly ItemRow[] {
  return runtimeItemRows(snapshot).filter((row) => row.kind !== "wall" && isFishingAreaObject(row.item) && itemRowTile(row));
}

export function pluginFishingAreaPayload(row: ItemRow, metadata: FurniMetadataSnapshot | null): Record<string, unknown> {
  const tile = itemRowTile(row);
  return {
    id: objectNumericId(row.item),
    title: itemRowTitle(row, metadata),
    meta: itemRowMeta(row, metadata),
    tile,
    item: row.item,
  };
}

export function pluginFishingAreaTarget(
  snapshot: EngineRuntimeSnapshot | null,
  areaId: unknown,
  metadata: FurniMetadataSnapshot | null,
): { readonly x: number; readonly y: number; readonly furniId: number; readonly label: string; readonly area: Record<string, unknown> } | null {
  const rows = pluginFishingAreaRows(snapshot, metadata);
  if (rows.length === 0) return null;
  const parsedAreaId = cleanPositiveInt(areaId, 0);
  const row = parsedAreaId > 0 ? rows.find((entry) => runtimeObjectNumericIds(entry.item).includes(parsedAreaId)) : rows[0];
  const tile = itemRowTile(row);
  if (!row || !tile) return null;
  const area = pluginFishingAreaPayload(row, metadata);
  return {
    x: tile.x,
    y: tile.y,
    furniId: objectNumericId(row.item) ?? 0,
    label: `${itemRowTitle(row, metadata)} (${compactValue(row.item.className ?? row.key)})`,
    area,
  };
}

export function pluginPlantRows(
  snapshot: EngineRuntimeSnapshot | null,
  metadata: FurniMetadataSnapshot | null,
  selector: unknown = null,
): readonly ItemRow[] {
  return runtimeItemRows(snapshot)
    .filter((row) => row.kind !== "wall" && isPlantLikeObject(row.item) && itemRowTile(row))
    .filter((row) => pluginSelectorIsEmpty(selector) || pluginItemRowMatchesSelector(row, selector, metadata));
}

export function pluginPlantPayload(row: ItemRow, metadata: FurniMetadataSnapshot | null): Record<string, unknown> {
  const tile = itemRowTile(row);
  return {
    id: objectNumericId(row.item),
    objectId: objectNumericId(row.item),
    title: itemRowTitle(row, metadata),
    meta: itemRowMeta(row, metadata),
    className: row.item.className ?? row.item.name ?? null,
    ownerName: row.item.ownerName ?? null,
    state: row.item.state ?? null,
    tile,
    item: row.item,
  };
}

export function pluginPlantCyclePlan(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
): Record<string, unknown> | null {
  const row = pluginPlantRows(snapshot, metadata, selector)[0];
  const objectId = objectNumericId(row?.item);
  const original = itemRowTile(row);
  if (!row || objectId === null || !original) return null;

  const users = snapshot?.userState?.users ?? snapshot?.roomObjects?.users ?? [];
  const sessionName = compactValue(snapshot?.userState?.sessionUserName).trim().toLowerCase();
  const self = users.find((user) => Boolean((user as RuntimeUserSummary & { readonly isSelf?: unknown }).isSelf))
    ?? users.find((user) => compactValue(user.name ?? user.className).trim().toLowerCase() === sessionName)
    ?? users[0]
    ?? null;
  const itemRows = runtimeItemRows(snapshot);
  const working = workingTileNearSelf(self, row, itemRows, users) ?? { x: original.x, y: original.y };

  return {
    objectId,
    plant: pluginPlantPayload(row, metadata),
    original: { x: original.x, y: original.y, direction: original.direction },
    working: { x: working.x, y: working.y, direction: original.direction },
    self: self ? { name: self.name ?? self.className ?? null, tile: userTile(self), direction: self.direction ?? null } : null,
    actions: ["move", "water", "harvest", "return"],
  };
}

export function runtimeObjectNumericIds(entry: RuntimeObjectSummary | null | undefined): readonly number[] {
  if (!entry) return [];
  const record = entry as RuntimeObjectSummary & { readonly itemId?: unknown; readonly slotId?: unknown };
  const ids = [record.objectId, record.id, record.itemId, record.slotId]
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null)
    .map((value) => Math.trunc(value))
    .filter((value) => value > 0);
  return [...new Set(ids)];
}

export function firstNonEmptyText(values: readonly unknown[]): string {
  for (const value of values) {
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (text) return text;
  }
  return "";
}

export const PROFILE_IMPORT_STAGES: readonly ProfileImportStage[] = [
  "validate",
  "sanitize",
  "projectorrays",
  "index-casts",
  "text-fields",
  "materialize-bitmaps",
  "generate-scripts",
  "validate-profile",
];

export const PROFILE_IMPORT_STAGE_LABELS: Record<ProfileImportStage, string> = {
  validate: "Validate folder",
  sanitize: "Copy client",
  projectorrays: "Decompile",
  "index-casts": "Index casts",
  "text-fields": "Extract text",
  "materialize-bitmaps": "Prepare assets",
  "generate-scripts": "Prepare scripts",
  "validate-profile": "Validate profile",
};

export interface ProfileImportUiState {
  readonly running: boolean;
  readonly jobId: string | null;
  readonly sourceName: string;
  readonly startedAt: number | null;
  readonly latest: ProfileImportProgress | null;
  readonly entries: readonly ProfileImportProgress[];
  readonly events: readonly ProfileImportProgress[];
  readonly message: string;
}

export const emptyProfileImportUiState: ProfileImportUiState = {
  running: false,
  jobId: null,
  sourceName: "",
  startedAt: null,
  latest: null,
  entries: [],
  events: [],
  message: "",
};

export function pendingProfileImportUiState(): ProfileImportUiState {
  const now = Date.now();
  return {
    running: true,
    jobId: null,
    sourceName: "",
    startedAt: now,
    latest: {
      jobId: "pending-folder",
      sourceName: "",
      stage: "validate",
      state: "running",
      message: "Waiting for folder selection",
      detail: "Choose a compiled Habbo client folder or existing Shockless profile",
      percent: 0,
      elapsedMs: 0,
      logPath: null,
      updatedAt: new Date(now).toISOString(),
    },
    entries: [],
    events: [],
    message: "Waiting for folder selection.",
  };
}

export function profileImportUiWithProgress(current: ProfileImportUiState, progress: ProfileImportProgress): ProfileImportUiState {
  const sameJob = !current.jobId || current.jobId === progress.jobId || current.jobId === "pending-folder";
  const baseEntries = sameJob ? current.entries : [];
  const entries = [...baseEntries.filter((entry) => entry.stage !== progress.stage), progress].sort(
    (left, right) => PROFILE_IMPORT_STAGES.indexOf(left.stage) - PROFILE_IMPORT_STAGES.indexOf(right.stage),
  );
  const baseEvents = sameJob ? current.events : [];
  const events = [...baseEvents, progress].slice(-24);
  const terminal = progress.stage === "validate-profile" && (progress.state === "done" || progress.state === "warning" || progress.state === "failed");
  return {
    running: !terminal,
    jobId: progress.jobId,
    sourceName: progress.sourceName,
    startedAt: current.startedAt ?? Date.now() - (progress.elapsedMs ?? 0),
    latest: progress,
    entries,
    events,
    message: progress.message,
  };
}

export function profileImportUiFinished(current: ProfileImportUiState, message: string, failed: boolean): ProfileImportUiState {
  const latest = current.latest;
  const skipped = /cancel/i.test(message);
  if (!latest) {
    return {
      ...emptyProfileImportUiState,
      message,
    };
  }
  const finalProgress: ProfileImportProgress = {
    ...latest,
    stage: failed ? "validate-profile" : latest.stage,
    state: failed ? "failed" : skipped ? "skipped" : latest.state === "running" ? "done" : latest.state,
    message: failed ? "Import failed" : message,
    detail: failed || skipped ? message : latest.detail,
    percent: failed || skipped ? Math.max(0, latest.percent) : Math.max(latest.percent, 100),
    elapsedMs: latest.elapsedMs ?? (current.startedAt ? Date.now() - current.startedAt : undefined),
    updatedAt: new Date().toISOString(),
  };
  return {
    ...current,
    running: false,
    latest: finalProgress,
    entries: [...current.entries.filter((entry) => entry.stage !== finalProgress.stage), finalProgress].sort(
      (left, right) => PROFILE_IMPORT_STAGES.indexOf(left.stage) - PROFILE_IMPORT_STAGES.indexOf(right.stage),
    ),
    events: [...current.events, finalProgress].slice(-24),
    message,
  };
}

export function profileImportStageEntry(entries: readonly ProfileImportProgress[], stage: ProfileImportStage): ProfileImportProgress | undefined {
  return entries.find((entry) => entry.stage === stage);
}

export function formatImportElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function profileImportStatusLabel(state: ProfileImportUiState): string {
  if (state.running) return "Running";
  if (state.latest?.state === "failed") return "Failed";
  if (state.latest?.state === "warning") return "Imported with warnings";
  if (state.latest?.state === "done") return "Complete";
  return "Idle";
}
