import {
  Activity,
  Bot,
  CircleAlert,
  Command,
  Copy,
  FolderInput,
  Hammer,
  Info,
  List,
  Map,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Sofa,
  Square,
  Terminal,
  Trash2,
  User,
  Wrench,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState, type UIEvent } from "react";
import { initialAppState } from "../../core/sampleState";
import { shellReducer } from "../../core/shellStore";
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
import {
  readEngineRuntimeSnapshot,
  runEngineRuntimeAction,
  type EngineRuntimeAction,
  type EngineRuntimeSnapshot,
  type EngineRuntimeSnapshotScope,
  type EngineWebviewElement,
  type EngineRuntimeActionResult,
  type RuntimeChatEntry,
  type RuntimeInventoryItemSummary,
  type RuntimeObjectSummary,
  type RuntimeUserSummary,
} from "../engineRuntime";
import { RendererUserPluginHost, type UserPluginHostRequest } from "../userPluginHost";
import { getPluginById, plugins } from "../../plugins/registry";
import type { PluginDefinition, PluginPermission, PluginRegistryState } from "../../shared/plugin";
import { parseConsoleCommand, redactConsoleCommandInput, type ConsoleRendererAction } from "../../shared/consoleCommand";
import { encodeShockwaveBase64Int, formatShockwavePacketParts } from "../../shared/shockwavePacketText";
import type {
  AppPreferencesPatch,
  AppPreferencesState,
  ClientLibraryState,
  ClientRuntimeSummary,
  ClientSnapshot,
  ClientSessionList,
  ClientSessionSummary,
  ConsoleCommandStateSnapshot,
  ClientProfileSummary,
  EngineLaunchState,
  EngineLaunchSettingsPatch,
  FurniMetadataEntry,
  FurniMetadataSnapshot,
  FurniRelayAction,
  FishingRelayAction,
  GardeningRelayAction,
  OriginsUserLookupResult,
  ProfileImportProgress,
  ProfileImportStage,
  PluginPacketInput,
  RelayLogDeltaSnapshot,
  RelayLogEntry,
  RelayLogSnapshot,
  SocialRelayAction,
  MimicCategory,
  MimicStateSnapshot,
  UserRelayAction,
  WallMoverRelayAction,
} from "../../shared/window-api";

const iconMap = {
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

function PluginIcon({ plugin }: { readonly plugin: PluginDefinition }) {
  const Icon = iconMap[plugin.icon as keyof typeof iconMap] ?? CircleAlert;
  return <Icon aria-hidden="true" size={17} strokeWidth={2.1} />;
}

function labelCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusLabel(value: unknown): string {
  const label = labelCase(value);
  return label === "Done" ? "Complete" : label;
}

function permissionLabel(value: unknown): string {
  return String(value ?? "")
    .split(".")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "ui" ? "UI" : labelCase(part)))
    .join(" ") || "-";
}

function originLabel(value: unknown): string {
  return String(value ?? "") === "built-in" ? "Built-In" : labelCase(value);
}

function profileLine(profile: ClientProfileSummary | null | undefined): string {
  if (!profile) return "No profile selected";
  const build = profile.buildNumber ? `build ${profile.buildNumber}` : profile.versionId;
  return `${profile.label} / ${build}`;
}

function clientSessionTitle(session: ClientSessionSummary): string {
  const mode = session.headless ? "Headless" : session.visible ? "Visible" : "Hidden";
  const markers = [session.selected ? "Selected" : "", session.main ? "Main" : "", mode, statusLabel(session.status)].filter(Boolean).join(", ");
  return `client${session.id} ${session.label} (${markers})\n${session.profileLabel}`;
}

interface GameWebviewMount {
  readonly id: number;
  readonly label: string;
  readonly url: string;
  readonly partition: string;
}

function gameWebviewPartitionForClient(clientId: number): string {
  return clientId === 1 ? "persist:habbpy-v4-shockless" : `persist:habbpy-v4-shockless-client-${clientId}`;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function chatEntryKey(entry: RuntimeChatEntry, index: number): string {
  return `${entry.index ?? index}-${entry.timestamp ?? ""}-${entry.userName ?? ""}`;
}

function chatEntryLabel(entry: RuntimeChatEntry): string {
  const mode = String(entry.chatMode ?? "talk").toUpperCase();
  const user = entry.userName || "system";
  return `[${mode}] ${user}`;
}

function chatEntryKind(entry: RuntimeChatEntry): "talk" | "whisper" | "shout" | "system" {
  const mode = String(entry.chatMode ?? "talk").toLowerCase();
  if (mode.includes("whisper")) return "whisper";
  if (mode.includes("shout")) return "shout";
  if (mode.includes("system")) return "system";
  return "talk";
}

function compactValue(value: unknown): string {
  return compactRuntimeValue(value);
}

function commandArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const mimicCategoryOptions: readonly { readonly id: MimicCategory; readonly label: string; readonly detail: string }[] = [
  { id: "movement", label: "Movement", detail: "walk and look packets" },
  { id: "speech", label: "Speech", detail: "chat, shout, whisper, typing" },
  { id: "actions", label: "Actions", detail: "wave, dance, carry, sign" },
  { id: "rooms", label: "Rooms", detail: "private room joins" },
];

function withVisibleConsoleContext(input: string, snapshot: EngineRuntimeSnapshot | null, activeNames: readonly string[] = []): string {
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

function uniqueUsefulNames(values: readonly unknown[]): readonly string[] {
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

function firstUsefulName(values: readonly unknown[]): string {
  return uniqueUsefulNames(values)[0] ?? "";
}

function isTextEntryTarget(target: EventTarget | null): boolean {
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

function bindingKeyFromKeyboardEvent(event: { readonly key: string; readonly code?: string; readonly ctrlKey: boolean; readonly altKey: boolean; readonly shiftKey: boolean; readonly metaKey: boolean }): string {
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

function normalizeShortcutKey(keyValue: string, codeValue = ""): string {
  if (codeValue === "Backquote" || keyValue === "`") return "Backquote";
  const key = String(keyValue ?? "").trim();
  if (!key) return "";
  if (/^F(?:[1-9]|1\d|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  if (key === " ") return "Space";
  if (key === "Esc") return "Escape";
  return key;
}

function objectTitle(entry: { readonly id?: unknown; readonly objectId?: unknown; readonly className?: unknown; readonly name?: unknown }): string {
  return compactValue(entry.name ?? entry.className ?? entry.objectId ?? entry.id);
}

function normalizeFurniClassName(value: unknown): string {
  return String(value ?? "").replace(/^ZaC/i, "").trim().toLowerCase();
}

function furniInfoForClass(metadata: FurniMetadataSnapshot | null, className: unknown): FurniMetadataEntry | null {
  const key = normalizeFurniClassName(className);
  return key ? metadata?.entriesByClass[key] ?? null : null;
}

function furniInfoForObject(metadata: FurniMetadataSnapshot | null, entry: RuntimeObjectSummary | RuntimeInventoryItemSummary | null | undefined): FurniMetadataEntry | null {
  if (!entry) return null;
  const record = entry as Record<string, unknown>;
  return furniInfoForClass(metadata, record.className ?? record.name);
}

function furniDisplayName(metadata: FurniMetadataSnapshot | null, entry: RuntimeObjectSummary | RuntimeInventoryItemSummary | null | undefined): string {
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

function isRelayBackedConsoleCommand(command: string): boolean {
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

function commandRefreshesEngineLaunch(command: string, firstArg = ""): boolean {
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

function objectMeta(entry: {
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

function wallObjectMeta(entry: RuntimeObjectSummary): string {
  const parts = [
    entry.objectId ?? entry.id ? `id ${compactValue(entry.objectId ?? entry.id)}` : "",
    entry.wall ? `wall ${entry.wall}` : "",
    entry.local ? `local ${entry.local}` : "",
    entry.orientation ? `face ${compactValue(entry.orientation)}` : entry.direction !== undefined ? `dir ${compactValue(entry.direction)}` : "",
    entry.state !== undefined && entry.state !== null ? `state ${compactValue(entry.state)}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || objectMeta(entry);
}

function objectSearchText(entry: RuntimeObjectSummary): string {
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

function isPlantLikeObject(entry: RuntimeObjectSummary): boolean {
  const text = objectSearchText(entry);
  return ["farm", "garden", "plant", "flower", "blossom", "pumpkin", "seed", "compost", "harvest", "water"].some((token) =>
    text.includes(token),
  );
}

function isFishingAreaObject(entry: RuntimeObjectSummary): boolean {
  const className = compactValue(entry.className ?? entry.name).trim().toLowerCase();
  return className.endsWith("fish_area");
}

function isPresentCatcherHammerObject(entry: RuntimeObjectSummary): boolean {
  return compactValue(entry.className ?? entry.name).trim().toLowerCase() === "toby_hammer";
}

function isPresentCatcherPresentObject(entry: RuntimeObjectSummary): boolean {
  return compactValue(entry.className ?? entry.name).trim().toLowerCase().startsWith("anniv_present_gen");
}

function isPresentCatcherGiftItem(entry: RuntimeInventoryItemSummary, classFilter: string): boolean {
  const filter = classFilter.trim().toLowerCase();
  if (!filter) return false;
  const text = [entry.className, entry.itemId, entry.objectId, entry.slotId, entry.inventoryKind].map(compactValue).join(" ").toLowerCase();
  return text.includes(filter);
}

const presentCatcherPacketHeaders = new Set([65, 74, 78, 90, 93, 94, 1240, 1241, 3400, 3401, 3402, 3403, 3404, 3600, 3601, 3602, 3603, 3604]);

type ItemRow = RuntimeItemRow;

interface WallMoverLocation {
  readonly wallX: number;
  readonly wallY: number;
  readonly localX: number;
  readonly localY: number;
  readonly orientation: "l" | "r";
}

function objectNumericId(entry: RuntimeObjectSummary | null | undefined): number | null {
  const parsed = finiteNumber(entry?.objectId ?? entry?.id);
  return parsed === null ? null : Math.trunc(parsed);
}

function signedPair(value: unknown): { readonly x: number; readonly y: number } | null {
  const match = compactValue(value).match(/(-?\d+)\s*,\s*(-?\d+)/);
  if (!match) return null;
  return { x: Number.parseInt(match[1]!, 10), y: Number.parseInt(match[2]!, 10) };
}

function wallOrientation(value: unknown): "l" | "r" | null {
  const normalized = compactValue(value).trim().toLowerCase();
  if (normalized === "l" || normalized === "left") return "l";
  if (normalized === "r" || normalized === "right") return "r";
  return null;
}

function wallMoverLocation(entry: RuntimeObjectSummary | null | undefined): WallMoverLocation | null {
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

function itemRowTile(row: ItemRow | null | undefined): { readonly x: number; readonly y: number; readonly direction: number } | null {
  const x = finiteNumber(row?.item.x);
  const y = finiteNumber(row?.item.y);
  const direction = finiteNumber(row?.item.direction) ?? 0;
  if (x === null || y === null) return null;
  return { x: Math.trunc(x), y: Math.trunc(y), direction: Math.trunc(direction) };
}

function userTile(user: RuntimeUserSummary | null | undefined): { readonly x: number; readonly y: number } | null {
  const directX = finiteNumber(user?.x);
  const directY = finiteNumber(user?.y);
  if (directX !== null && directY !== null) return { x: Math.trunc(directX), y: Math.trunc(directY) };
  const match = String(user?.position ?? "").match(/(-?\d+)\s*,\s*(-?\d+)/);
  if (!match) return null;
  return { x: Number.parseInt(match[1]!, 10), y: Number.parseInt(match[2]!, 10) };
}

const gardeningFacingTilePriority: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  0: [[0, -1], [-1, 0], [1, 0]],
  1: [[1, 0], [0, -1], [-1, 0]],
  2: [[1, 0], [0, -1], [0, 1]],
  3: [[1, 0], [0, 1], [0, -1]],
  4: [[0, 1], [1, 0], [-1, 0]],
  5: [[-1, 0], [0, 1], [1, 0]],
  6: [[-1, 0], [0, 1], [0, -1]],
  7: [[-1, 0], [0, -1], [1, 0]],
};

const gardeningFallbackTilePriority: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
];

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function objectIdText(entry: RuntimeObjectSummary | null | undefined): string {
  return compactValue(entry?.objectId ?? entry?.id);
}

function occupiedGardeningTiles(
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

function workingTileNearSelf(
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

function findCurrentPlantRow(rows: readonly ItemRow[], objectId: number): ItemRow | null {
  return rows.find((row) => objectNumericId(row.item) === objectId) ?? null;
}

function adjacentTileForItem(
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

function latin1ByteArray(text: string): readonly number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const value = text.charCodeAt(index);
    if (value > 0xff) throw new Error("Text cannot be encoded as Latin-1.");
    bytes.push(value);
  }
  return bytes;
}

function shockwaveVl64ByteArray(value: number): readonly number[] {
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

function shockwaveOutgoingStringByteArray(value: string): readonly number[] {
  return [...encodeShockwaveBase64Int(value.length, 2), ...latin1ByteArray(value)];
}

function decodeShockwaveVl64Text(value: string): number | null {
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

type GardeningPhase = "idle" | "move_out" | "compost" | "water" | "harvest" | "return" | "complete" | "failed";

interface GardeningJobState {
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

type InjectionActionKind =
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

interface InjectionCommandDraft {
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

interface InjectionSnippet {
  readonly id: string;
  readonly label: string;
  readonly command: InjectionCommandDraft;
  readonly createdAt: string;
}

interface InjectionHistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly status: "success" | "blocked" | "warning" | "error";
  readonly message: string;
  readonly time: string;
}

interface PacketConsoleEntry {
  readonly id: string;
  readonly time: string;
  readonly kind: "command" | "success" | "warning" | "error" | "info";
  readonly text: string;
}

const injectionActionOptions: readonly { readonly kind: InjectionActionKind; readonly label: string }[] = [
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

const defaultInjectionDraft: InjectionCommandDraft = {
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

const injectionSnippetStorageKey = "habbpy-v4:injection-snippets";
const injectionHistoryStorageKey = "habbpy-v4:injection-history";
const userStoredLookStorageKey = "habbpy-v4:user-stored-looks";
const automationPrefsStorageKey = "habbpy-v4:automation-prefs";

function injectionCommandLabel(command: InjectionCommandDraft): string {
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

function cloneInjectionDraft(command: InjectionCommandDraft): InjectionCommandDraft {
  return {
    ...defaultInjectionDraft,
    ...command,
    rawDirection: command.rawDirection === "CLIENT" ? "CLIENT" : "SERVER",
  };
}

function normalizeInjectionSnippet(value: unknown, index: number): InjectionSnippet | null {
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

function normalizeInjectionSnippets(value: unknown): InjectionSnippet[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map(normalizeInjectionSnippet).filter((entry): entry is InjectionSnippet => Boolean(entry)).slice(0, 50);
}

function normalizeStoredUserLooks(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  return [...new Set(rows.map((entry) => String(entry ?? "").trim()).filter(Boolean))].slice(0, 20);
}

function loadStoredUserLooks(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeStoredUserLooks(JSON.parse(window.localStorage.getItem(userStoredLookStorageKey) || "[]"));
  } catch {
    return [];
  }
}

function loadAutomationPrefs(): { readonly autoHideBulletin: boolean } {
  if (typeof window === "undefined") return { autoHideBulletin: true };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(automationPrefsStorageKey) || "{}") as { readonly autoHideBulletin?: unknown };
    return { autoHideBulletin: parsed.autoHideBulletin !== false };
  } catch {
    return { autoHideBulletin: true };
  }
}

async function writeClipboardText(text: string): Promise<boolean> {
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

function injectionDraftToRuntimeAction(command: InjectionCommandDraft): { readonly action?: EngineRuntimeAction; readonly blocked?: string } {
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

function injectionDraftToUserRelayAction(command: InjectionCommandDraft): UserRelayAction | null {
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

function clampRepeatCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(25, parsed));
}

function clampRepeatInterval(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1000;
  return Math.max(50, Math.min(60000, parsed));
}

function clampMultiAccountCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(50, parsed));
}

function clampMultiAccountConcurrency(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(8, parsed));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function objectListSignature(items: readonly RuntimeObjectSummary[] | undefined): string {
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

function userListSignature(users: readonly RuntimeUserSummary[] | undefined): string {
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

function inventorySignature(inventory: EngineRuntimeSnapshot["inventory"]): string {
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

function navigatorSignature(navigator: EngineRuntimeSnapshot["navigator"]): string {
  if (!navigator) return "none";
  return [
    navigator.total,
    navigator.categories,
    navigator.publicRooms,
    navigator.privateRooms,
    navigator.publicRoomNodes.map((node) => [node.id ?? "-", node.name ?? "-", node.users ?? "-"].join(":")).join("|"),
  ].join(";");
}

function roomObjectsSignature(roomObjects: EngineRuntimeSnapshot["roomObjects"]): string {
  if (!roomObjects) return "none";
  return [
    JSON.stringify(roomObjects.counts),
    userListSignature(roomObjects.users),
    objectListSignature(roomObjects.activeObjects),
    objectListSignature(roomObjects.passiveObjects),
    objectListSignature(roomObjects.wallItems),
  ].join(";");
}

function userStateSignature(userState: EngineRuntimeSnapshot["userState"]): string {
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

function chatHistorySignature(chatHistory: EngineRuntimeSnapshot["chatHistory"]): string {
  const last = chatHistory[chatHistory.length - 1];
  return `${chatHistory.length}:${last?.timestamp ?? ""}:${last?.userName ?? ""}:${last?.text ?? ""}`;
}

function activeSpritesSignature(activeSprites: EngineRuntimeSnapshot["activeSprites"]): string {
  return activeSprites.map((sprite) => [sprite.n ?? "-", sprite.member ?? "-", sprite.loc?.join(",") ?? ""].join(":")).join("|");
}

function runtimeProbeScopesForPlugin(pluginId: string): readonly EngineRuntimeSnapshotScope[] {
  switch (pluginId) {
    case "dev-tools":
      return ["full"];
    case "info":
      return ["core", "room", "inventory", "navigator"];
    case "room":
    case "user":
    case "items":
    case "fishing":
    case "gardening":
    case "wall-mover":
    case "chat":
    case "visitors":
      return ["core", "room"];
    case "present-catcher":
      return ["core", "room", "inventory"];
    case "inventory":
      return ["core", "inventory"];
    default:
      return ["core"];
  }
}

function reuseStableRuntimeDetails(
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

function itemRowTitle(row: ItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  return furniDisplayName(metadata, row.item);
}

function itemRowMeta(row: ItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  const info = furniInfoForObject(metadata, row.item);
  const className = compactValue(row.item.className ?? row.item.name);
  const meta = objectMeta(row.item);
  return info && className !== "-" ? `class ${className} / ${meta}` : meta;
}

function itemRowSearchText(row: ItemRow, metadata: FurniMetadataSnapshot | null = null): string {
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

function userDisplayName(user: RuntimeUserSummary | null, sessionName?: string | null): string {
  if (!user) return "-";
  return compactValue(user.name ?? (user.rowId === "0" ? sessionName : null) ?? user.objectClass ?? user.className ?? user.rowId);
}

function userPosition(user: RuntimeUserSummary | null): string {
  if (!user) return "-";
  return compactValue(user.position ?? (user.x !== undefined || user.y !== undefined ? `${compactValue(user.x)}, ${compactValue(user.y)}, ${compactValue(user.z)}` : null));
}

function userRowMeta(user: RuntimeUserSummary, sessionName?: string | null): string {
  const parts = [
    user.rowId === "0" && sessionName ? "you" : "",
    userPosition(user) !== "-" ? `loc ${userPosition(user)}` : "",
    user.direction !== undefined ? `dir ${compactValue(user.direction)}` : "",
    user.spriteCount !== undefined ? `${compactValue(user.spriteCount)} sprites` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

interface PacketProfileUser {
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

interface PacketProfileIndex {
  readonly users: readonly PacketProfileUser[];
  readonly byAccountId: ReadonlyMap<string, PacketProfileUser>;
  readonly byName: ReadonlyMap<string, PacketProfileUser>;
  readonly byIndex: ReadonlyMap<string, PacketProfileUser>;
}

interface PacketInfoFriend {
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

interface PacketInfoEffect {
  readonly name: string;
  readonly value: string;
  readonly sourceLine: number;
}

interface PacketMessengerMessage {
  readonly key: string;
  readonly id: string;
  readonly senderAccountId: string;
  readonly sentAt: string;
  readonly text: string;
  readonly sourceLine: number;
}

interface PacketFriendRequest {
  readonly key: string;
  readonly accountId: string;
  readonly name: string;
  readonly requestId: string;
  readonly sourceLine: number;
}

interface PacketInfoState {
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

interface PacketInventoryItem {
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

interface PacketInventoryState {
  readonly items: readonly PacketInventoryItem[];
  readonly totalCount: number;
  readonly floorCount: number;
  readonly wallCount: number;
  readonly lastSourceLine: number | null;
}

interface PacketWallItem {
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

interface PacketWallItemState {
  readonly items: readonly PacketWallItem[];
  readonly itemCount: number;
  readonly lastSourceLine: number | null;
}

interface PacketChatEntry {
  readonly index: string;
  readonly text: string;
  readonly chatMode: string;
  readonly activity: string;
  readonly sourceLine: number;
}

interface PacketFishingCatch {
  readonly key: string;
  readonly fishName: string;
  readonly message: string;
  readonly xp: number;
  readonly golden: boolean;
  readonly sourceLine: number;
}

interface PacketFishopediaEntry {
  readonly key: string;
  readonly fishName: string;
  readonly xp: string;
  readonly catches: string;
  readonly completion: string;
  readonly location: string;
  readonly sourceLine: number;
}

interface PacketFishingState {
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

interface ClientPluginSnapshot {
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

interface InventoryDisplayRow {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly meta: string;
  readonly searchText: string;
  readonly detailRows: readonly { readonly label: string; readonly value: string }[];
}

const emptyPacketProfileIndex: PacketProfileIndex = {
  users: [],
  byAccountId: new globalThis.Map<string, PacketProfileUser>(),
  byName: new globalThis.Map<string, PacketProfileUser>(),
  byIndex: new globalThis.Map<string, PacketProfileUser>(),
};

const emptyPacketInfoState: PacketInfoState = {
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

const emptyPacketInventoryState: PacketInventoryState = {
  items: [],
  totalCount: 0,
  floorCount: 0,
  wallCount: 0,
  lastSourceLine: null,
};

const emptyPacketWallItemState: PacketWallItemState = {
  items: [],
  itemCount: 0,
  lastSourceLine: null,
};

const emptyPacketFishingState: PacketFishingState = {
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

function packetFieldMap(entry: RelayLogEntry): globalThis.Map<string, string> {
  const map = new globalThis.Map<string, string>();
  for (const field of entry.decodedFields) {
    map.set(field.label, field.value);
  }
  return map;
}

function packetUsersFromEntries(entries: readonly RelayLogEntry[], startIndex = 0): readonly PacketProfileUser[] {
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

let packetProfileUserCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly users: readonly PacketProfileUser[];
    }
  | null = null;

function packetUsersFromRelayLog(snapshot: RelayLogSnapshot | null): readonly PacketProfileUser[] {
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

function packetInfoStateFromEntries(
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

let packetInfoStateCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: PacketInfoState;
    }
  | null = null;

function packetInfoStateFromRelayLog(snapshot: RelayLogSnapshot | null): PacketInfoState {
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

function addPacketFriendsFromPrefix(
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

function addPacketPrivateMessagesFromPrefix(
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

function addPacketFriendRequestsFromPrefix(
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

function packetFriendFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketInfoFriend | null {
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

function packetPrivateMessageFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketMessengerMessage | null {
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

function packetFriendRequestFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketFriendRequest | null {
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

function packetFriendKey(friend: PacketInfoFriend): string {
  if (friend.accountId !== "-") return `id:${friend.accountId}`;
  return `name:${friend.name.trim().toLowerCase()}`;
}

function packetPrivateMessageKey(message: PacketMessengerMessage): string {
  if (message.id !== "-") return `id:${message.id}`;
  return `${message.senderAccountId}:${message.sentAt}:${message.text}`.trim().toLowerCase();
}

function packetFriendRequestKey(request: PacketFriendRequest): string {
  if (request.requestId !== "-") return `request:${request.requestId}`;
  if (request.accountId !== "-") return `account:${request.accountId}`;
  return `name:${request.name.trim().toLowerCase()}`;
}

function parsedCount(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function packetFriendSearchText(friend: PacketInfoFriend): string {
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

function packetFriendMeta(friend: PacketInfoFriend): string {
  const parts = [
    friend.online ? "online" : "offline",
    friend.canFollow ? "follow" : "",
    friend.location !== "-" ? friend.location : "",
    friend.lastAccess !== "-" ? `last ${friend.lastAccess}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

function packetFriendTitle(friend: PacketInfoFriend): string {
  const id = friend.accountId !== "-" ? `#${friend.accountId}` : "";
  return [friend.name, id, friend.motto !== "-" ? friend.motto : ""].filter(Boolean).join(" / ") || "-";
}

function lookupTokenMatches(values: readonly unknown[], normalizedToken: string, rawToken: string): boolean {
  return values.some((value) => {
    const text = compactValue(value).trim();
    if (!text || text === "-") return false;
    return text.toLowerCase() === normalizedToken || text === rawToken;
  });
}

function runtimeUserMatchesLookup(user: RuntimeUserSummary, normalizedToken: string, rawToken: string, sessionName?: string | null): boolean {
  return lookupTokenMatches(
    [userDisplayName(user, sessionName), user.name, user.accountId, user.roomIndex, user.rowId],
    normalizedToken,
    rawToken,
  );
}

function packetUserMatchesLookup(user: PacketProfileUser, normalizedToken: string, rawToken: string): boolean {
  return lookupTokenMatches([user.name, user.accountId, user.index], normalizedToken, rawToken);
}

function packetFriendMatchesLookup(friend: PacketInfoFriend, normalizedToken: string, rawToken: string): boolean {
  return lookupTokenMatches([friend.name, friend.accountId], normalizedToken, rawToken);
}

function packetFriendRequestMatchesLookup(request: PacketFriendRequest, normalizedToken: string, rawToken: string): boolean {
  return lookupTokenMatches([request.name, request.accountId, request.requestId], normalizedToken, rawToken);
}

function parsePositiveSocialAccountId(value: unknown): number | null {
  const accountId = Number.parseInt(compactValue(value), 10);
  return Number.isInteger(accountId) && accountId > 0 ? accountId : null;
}

function packetFriendActionId(friend: PacketInfoFriend): number | null {
  return parsePositiveSocialAccountId(friend.accountId);
}

function packetFriendRequestActionId(request: PacketFriendRequest): number | null {
  return parsePositiveSocialAccountId(request.accountId) ?? parsePositiveSocialAccountId(request.requestId);
}

function findPacketFriendForAction(friends: readonly PacketInfoFriend[], target: string): PacketInfoFriend | undefined {
  const rawToken = target.trim();
  if (!rawToken) return undefined;
  const normalizedToken = rawToken.toLowerCase();
  return friends.find((entry) => packetFriendMatchesLookup(entry, normalizedToken, rawToken));
}

function findPacketFriendRequestForAction(requests: readonly PacketFriendRequest[], target: string): PacketFriendRequest | undefined {
  const rawToken = target.trim();
  if (!rawToken) return requests.length === 1 ? requests[0] : undefined;
  const normalizedToken = rawToken.toLowerCase();
  return requests.find((entry) => packetFriendRequestMatchesLookup(entry, normalizedToken, rawToken));
}

function runtimeLookupLine(user: RuntimeUserSummary, snapshot: EngineRuntimeSnapshot | null): string {
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

function packetProfileLookupLine(user: PacketProfileUser): string {
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

function friendRequestLookupLine(request: PacketFriendRequest): string {
  return [
    "friend request:",
    `name=${compactValue(request.name)}`,
    `account=${compactValue(request.accountId)}`,
    `request=${compactValue(request.requestId)}`,
    `line=${request.sourceLine}`,
  ].join(" ");
}

function originsLookupLine(result: OriginsUserLookupResult, fallbackName: string): string {
  return [
    "origins:",
    `name=${compactValue(result.name || fallbackName)}`,
    `id=${compactValue(result.id)}`,
    `motto=${compactValue(result.motto)}`,
    `member=${compactValue(result.memberSince)}`,
    `visible=${compactValue(result.profileVisible)}`,
  ].join(" ");
}

function packetChatEntriesFromEntries(entries: readonly RelayLogEntry[], startIndex = 0): readonly PacketChatEntry[] {
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

let packetChatEntriesCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly entries: readonly PacketChatEntry[];
    }
  | null = null;

function packetChatEntriesFromRelayLog(snapshot: RelayLogSnapshot | null): readonly PacketChatEntry[] {
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

function packetFishingStateFromEntries(
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

function packetFishopediaEntryFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketFishopediaEntry | null {
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

function packetChatRuntimeEntry(
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

function packetChatUserName(
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

function packetWallItemStateFromEntries(
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

let packetWallItemStateCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: PacketWallItemState;
    }
  | null = null;

function packetWallItemStateFromRelayLog(snapshot: RelayLogSnapshot | null): PacketWallItemState {
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

function packetWallItemFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketWallItem | null {
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

function packetWallItemRow(item: PacketWallItem): ItemRow {
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

function packetInventoryStateFromEntries(
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

let packetInventoryStateCache:
  | {
      readonly logPath: string;
      readonly entryCount: number;
      readonly totalLines: number;
      readonly state: PacketInventoryState;
    }
  | null = null;

function packetInventoryStateFromRelayLog(snapshot: RelayLogSnapshot | null): PacketInventoryState {
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

function packetInventoryItemFromPrefix(fields: ReadonlyMap<string, string>, prefix: string, sourceLine: number): PacketInventoryItem | null {
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

function packetInventoryKey(rawId: string, displayId: string): string {
  if (rawId.length > 0) return `raw:${rawId}`;
  const cleanDisplayId = compactValue(displayId);
  return cleanDisplayId === "-" ? "" : `id:${cleanDisplayId}`;
}

function packetInventorySearchText(item: PacketInventoryItem): string {
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

function packetInventoryTitle(item: PacketInventoryItem, metadata: FurniMetadataSnapshot | null): string {
  return compactValue(furniInfoForClass(metadata, item.className)?.name ?? item.className);
}

function packetInventoryMeta(item: PacketInventoryItem): string {
  const parts = [
    `inv ${item.itemId !== "-" ? item.itemId : item.itemIdValue}`,
    item.objectId !== "-" ? `obj ${item.objectId}` : "",
    item.slotId !== "-" ? `slot ${item.slotId}` : "",
    item.size !== "-" ? `size ${item.size}` : "",
    item.colors !== "-" ? `colors ${item.colors}` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

function runtimeInventoryDisplayRow(item: RuntimeInventoryItemSummary, metadata: FurniMetadataSnapshot | null): InventoryDisplayRow {
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

function packetInventoryDisplayRow(item: PacketInventoryItem, metadata: FurniMetadataSnapshot | null): InventoryDisplayRow {
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

function packetProfileIndexFromUsers(users: readonly PacketProfileUser[]): PacketProfileIndex {
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

function selectPacketProfileUser(
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

function packetProfileForRuntimeUser(packetIndex: PacketProfileIndex, user: RuntimeUserSummary, sessionName?: string | null): PacketProfileUser | null {
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

function latestPacketVisitorUsers(packetUsers: readonly PacketProfileUser[]): readonly PacketProfileUser[] {
  const byKey = new globalThis.Map<string, PacketProfileUser>();
  for (const user of packetUsers) {
    if (compactValue(user.userType) !== "1") continue;
    const accountId = compactValue(user.accountId);
    const key = accountId !== "-" ? `id:${accountId}` : `name:${user.name.trim().toLowerCase()}`;
    byKey.set(key, user);
  }
  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function profileValue(primary: unknown, fallback: unknown): string {
  const value = compactValue(primary);
  if (value !== "-") return value;
  return compactValue(fallback);
}

interface VisitorEntry {
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

interface VisitorTrackerState {
  readonly roomKey: string;
  readonly activeKeys: readonly string[];
  readonly entries: Readonly<Record<string, VisitorEntry>>;
}

const emptyVisitorState: VisitorTrackerState = {
  roomKey: "",
  activeKeys: [],
  entries: {},
};

function isVisitorUser(user: RuntimeUserSummary): boolean {
  const sourceText = [user.type, user.userType, user.objectClass, user.className].map(compactValue).join(" ").toLowerCase();
  if (sourceText.includes("pet") || sourceText.includes("bot")) return false;
  if (sourceText.includes("human")) return true;
  return compactValue(user.type ?? user.userType) === "1" || Boolean(user.name || user.rowId);
}

function visitorKeyFor(user: RuntimeUserSummary, sessionName?: string | null, packetUser?: PacketProfileUser | null): string {
  const accountId = profileValue(user.accountId, packetUser?.accountId);
  if (accountId !== "-") return `id:${accountId}`;
  const name = userDisplayName(user, sessionName).trim().toLowerCase();
  if (name && name !== "-") return `name:${name}`;
  return `row:${user.rowId}`;
}

function visitorEntryFor(
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

function visitorEntryForPacketUser(user: PacketProfileUser, now: string, previous?: VisitorEntry): VisitorEntry {
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

function visitorSearchText(entry: VisitorEntry): string {
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

function visitorMeta(entry: VisitorEntry): string {
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

function inventoryKindLabel(kind: string): string {
  if (kind === "floor") return "Floor";
  if (kind === "wall") return "Wall";
  return compactValue(kind);
}

function inventoryItemTitle(item: RuntimeInventoryItemSummary, metadata: FurniMetadataSnapshot | null = null): string {
  return furniDisplayName(metadata, item);
}

function inventoryItemMeta(item: RuntimeInventoryItemSummary): string {
  const parts = [
    `inv ${compactValue(item.itemId)}`,
    item.objectId !== undefined ? `obj ${compactValue(item.objectId)}` : "",
    item.slotId !== undefined ? `slot ${compactValue(item.slotId)}` : "",
    item.size ? `size ${item.size}` : "",
    item.colors ? `colors ${item.colors}` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

function relayEntryLabel(entry: RelayLogEntry): string {
  const client = entry.clientId ? `c${entry.clientId} ` : "";
  if (entry.direction === "RELAY") return `${client}relay #${entry.sessionId ?? "-"}`;
  return `${client}${entry.direction} h${compactValue(entry.header)} ${compactValue(entry.size)}B`;
}

function relayEntryDisplayName(entry: RelayLogEntry): string {
  const name = entry.packetName ?? "UNKNOWN_HEADER";
  return name === "UNKNOWN_HEADER" ? "[UNKNOWN_HEADER]" : name;
}

interface RelayDerivedState {
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

const emptyRelayDerivedState: RelayDerivedState = {
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

function relayDerivedStateFromSnapshot(snapshot: RelayLogSnapshot | null): RelayDerivedState {
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

function relayModeSummary(modes: readonly string[]): string {
  return modes.length > 0 ? modes.join(" / ") : "-";
}

function relayEncryptionSummary(state: RelayDerivedState): string {
  if (state.hasServerCrypto && state.hasClientKeySwap) return "BobbaCrypto active / key swap routed";
  if (state.hasServerCrypto) return "BobbaCrypto active";
  if (state.hasClientKeySwap) return "key swap routed";
  return state.entryCount > 0 ? "pending handshake evidence" : "-";
}

function relayBodyLoggingSummary(state: RelayDerivedState): string {
  if (state.sampledBodies === 0 && state.redactedBodies === 0) return "-";
  return `${state.sampledBodies} sampled / ${state.redactedBodies} redacted`;
}

function relayPacketSummary(entry: RelayLogEntry | null): string {
  if (!entry) return "-";
  const client = entry.clientId ? `client${entry.clientId} / ` : "";
  return `${client}${relayEntryDisplayName(entry)} h${compactValue(entry.header)} #${compactValue(entry.sessionId)}`;
}

function bytesFromHex(hex: string | null): readonly number[] {
  if (!hex) return [];
  return hex
    .split(/\s+/)
    .map((part) => Number.parseInt(part, 16))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 255);
}

function formatHabbpyV3PacketText(entry: RelayLogEntry): string {
  if (entry.header === null) return entry.message;
  if (entry.bodyStatus === "redacted") return "<redacted>";
  if (entry.bodyStatus !== "sampled") return entry.message;
  return formatShockwavePacketParts(entry.header, bytesFromHex(entry.bodyHex));
}

function packetLogTimeLabel(updatedAt?: string | null): string {
  if (!updatedAt) return "--:--:--";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function relayEntryV3Line(entry: RelayLogEntry, updatedAt?: string | null): string {
  const clientPrefix = entry.clientId ? `[client${entry.clientId}] ` : "";
  if (entry.header === null) return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}[RELAY ] ${entry.message}`;
  const sidPrefix = entry.sessionId ? `[${entry.sessionId.slice(0, 6)}] ` : "";
  const name = relayEntryDisplayName(entry);
  const header = compactValue(entry.header);
  const size = compactValue(entry.size);
  return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}${sidPrefix}[${entry.direction.padEnd(6, " ")}] ${name} [${header}] (${size}B)  ${formatHabbpyV3PacketText(entry)}`;
}

function relayEntryPlain(entry: RelayLogEntry, updatedAt?: string | null): string {
  return relayEntryV3Line(entry, updatedAt);
}

function relayEntrySearchText(entry: RelayLogEntry): string {
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

function packetClientMatches(entry: RelayLogEntry, clientFilter: string): boolean {
  return clientFilter === "All" || String(entry.clientId ?? "") === clientFilter;
}

function normalizePacketClientFilter(value: string, choices: readonly { readonly value: string; readonly label: string }[]): string {
  const text = String(value || "All").trim().toLowerCase();
  if (!text || text === "all" || text === "all-clients") return "All";
  const numeric = text.replace(/^client/i, "");
  const match = choices.find((choice) => choice.value.toLowerCase() === numeric || choice.label.toLowerCase() === text || `client${choice.value}`.toLowerCase() === text);
  return match?.value ?? "All";
}
const PACKET_ROW_HEIGHT = 42;
const PACKET_RENDER_ROWS = 110;
const PACKET_OVERSCAN_ROWS = 18;
const PACKET_CONSOLE_ROW_HEIGHT = 18;
const PACKET_CONSOLE_RENDER_ROWS = 180;
const PACKET_CONSOLE_OVERSCAN_ROWS = 30;

function virtualPacketRange(
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

function mergeRelayLogSnapshot(
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

function relayLogSnapshotForClient(snapshot: RelayLogSnapshot | null, clientId: number | null): RelayLogSnapshot | null {
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

function clientPluginSnapshotForClient(options: {
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

function clientPluginSnapshotMapFromSources(options: {
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

function mergeClientSummaryIntoList(current: ClientSessionList | null, snapshot: ClientSnapshot): ClientSessionList | null {
  if (!current || !snapshot.client) return current;
  return {
    ...current,
    sessions: current.sessions.map((session) => session.id === snapshot.client?.id ? snapshot.client : session),
  };
}

interface UserPluginRoomUserCache {
  readonly roomKey: string;
  readonly usersByKey: ReadonlyMap<string, ReturnType<typeof pluginRuntimeUserPayload>>;
}

interface UserPluginRoomObjectRecord {
  readonly payload: ReturnType<typeof pluginRuntimeItemPayload>;
  readonly signature: string;
}

interface UserPluginRoomObjectCache {
  readonly roomKey: string;
  readonly itemsByKey: ReadonlyMap<string, UserPluginRoomObjectRecord>;
}

interface UserPluginChatCache {
  readonly roomKey: string;
  readonly keys: ReadonlySet<string>;
}

function pluginHasPermission(plugin: PluginDefinition, permission: PluginPermission): boolean {
  return (plugin.permissions ?? []).includes(permission);
}

function requirePluginPermission(plugin: PluginDefinition, permissions: readonly PluginPermission[]): void {
  if (permissions.some((permission) => pluginHasPermission(plugin, permission))) return;
  throw new Error(`${plugin.name} needs ${permissions.map(permissionLabel).join(" or ")} permission.`);
}

function isDisabledPluginCleanupRequest(api: string): boolean {
  return ["storage.get", "storage.set", "storage.delete", "client.getRights", "client.removeRights"].includes(api);
}

function pluginRoomKey(snapshot: EngineRuntimeSnapshot | null): string {
  if (!snapshot) return "";
  return `${runtimeRoomType(snapshot)}:${runtimeRoomId(snapshot)}:${runtimeRoomName(snapshot)}`;
}

function pluginRoomPayload(snapshot: EngineRuntimeSnapshot | null) {
  return {
    id: compactValue(runtimeRoomId(snapshot)),
    name: runtimeRoomName(snapshot),
    owner: runtimeRoomOwner(snapshot),
    type: runtimeRoomType(snapshot),
    layout: compactValue(runtimeRoomProp(snapshot, "#layout") ?? runtimeRoomProp(snapshot, "layout")),
    ready: Boolean(snapshot?.roomReady?.ready ?? snapshot?.roomEntryState?.roomReady?.ready),
  };
}

function pluginRuntimeUserKey(user: RuntimeUserSummary, sessionName?: string | null): string {
  const accountId = compactValue(user.accountId);
  if (accountId !== "-") return `account:${accountId}`;
  const roomIndex = compactValue(user.roomIndex);
  if (roomIndex !== "-") return `room-index:${roomIndex}`;
  return `row:${user.rowId}:${userDisplayName(user, sessionName).trim().toLowerCase()}`;
}

function pluginRuntimeUserPayload(user: RuntimeUserSummary, sessionName?: string | null) {
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

function pluginRuntimeItemSignature(row: RuntimeItemRow): string {
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

function pluginRuntimeItemPayload(row: RuntimeItemRow, metadata: FurniMetadataSnapshot | null = null) {
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

function pluginRoomObjectRecords(
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

function pluginRoomObjectsPayload(snapshot: EngineRuntimeSnapshot | null, clientId: number, metadata: FurniMetadataSnapshot | null) {
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

function dispatchPluginRoomItemEvent(
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

function pluginRuntimeUserKind(user: RuntimeUserSummary, sessionName?: string | null): "self" | "human" | "bot" | "unknown" {
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

function pluginRoomOccupantsPayload(snapshot: EngineRuntimeSnapshot | null) {
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

function pluginRoomUsersPayload(snapshot: EngineRuntimeSnapshot | null, clientId: number) {
  const sessionName = snapshot?.userState?.sessionUserName ?? null;
  const users = snapshot?.userState?.users ?? [];
  return {
    clientId,
    room: pluginRoomPayload(snapshot),
    users: users.map((user) => pluginRuntimeUserPayload(user, sessionName)),
  };
}

function pluginRelayPacketPayload(entry: RelayLogEntry, updatedAt?: string | null) {
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

function pluginChatPayload(entry: RuntimeChatEntry, clientId: number, room: ReturnType<typeof pluginRoomPayload>) {
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

function pluginStorageKey(pluginId: string, key: unknown): string {
  const normalizedKey = String(key ?? "").trim();
  if (!normalizedKey || normalizedKey.length > 120 || /[\x00-\x1f]/.test(normalizedKey)) {
    throw new Error("Plugin storage key must be 1-120 printable characters.");
  }
  return `habbpy-v4:user-plugin:${pluginId}:${normalizedKey}`;
}

function requestedPluginClientId(args: unknown, selectedClientId: number): number {
  const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const direct = Number(record.clientId);
  const options = record.options && typeof record.options === "object" ? (record.options as Record<string, unknown>) : {};
  const nested = Number(options.clientId);
  const candidate = Number.isInteger(direct) && direct > 0 ? direct : Number.isInteger(nested) && nested > 0 ? nested : selectedClientId;
  return candidate;
}

function cleanPluginRightsList(value: unknown): readonly string[] {
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

function cleanInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function cleanPositiveInt(value: unknown, fallback: number): number {
  const parsed = cleanInteger(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function pluginWalkTargetFromSnapshot(
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

function pluginWalkTargetFromRow(
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

function pluginFindItemRows(
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

function pluginSelectorIsEmpty(selector: unknown): boolean {
  if (selector === null || selector === undefined || selector === "") return true;
  if (typeof selector !== "object") return false;
  return Object.keys(selector as Record<string, unknown>).length === 0;
}

function pluginItemRowMatchesSelector(row: ItemRow, selector: unknown, metadata: FurniMetadataSnapshot | null): boolean {
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

function pluginResolveFloorItem(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
): { readonly row: ItemRow; readonly id: number; readonly tile: { readonly x: number; readonly y: number; readonly direction: number } } | null {
  const row = pluginFindItemRows(snapshot, selector, metadata, "floor")[0];
  const id = objectNumericId(row?.item);
  const tile = itemRowTile(row);
  return row && id !== null && tile ? { row, id, tile } : null;
}

function pluginResolveWallItem(
  snapshot: EngineRuntimeSnapshot | null,
  selector: unknown,
  metadata: FurniMetadataSnapshot | null,
): { readonly row: ItemRow; readonly id: number; readonly location: WallMoverLocation } | null {
  const row = pluginFindItemRows(snapshot, selector, metadata, "wall")[0];
  const id = objectNumericId(row?.item);
  const location = wallMoverLocation(row?.item);
  return row && id !== null && location ? { row, id, location } : null;
}

function pluginSelectorNumericId(selector: unknown): number | null {
  const record = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const parsed = finiteNumber(
    record.objectId ??
      record.itemId ??
      record.id ??
      (typeof selector === "number" || (typeof selector === "string" && /^\d+$/.test(selector.trim())) ? selector : null),
  );
  return parsed !== null && parsed > 0 ? Math.trunc(parsed) : null;
}

function pluginSelectorTile(selector: unknown): { readonly x: number; readonly y: number; readonly direction: number } | null {
  const record = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const tileRecord = record.tile && typeof record.tile === "object" ? (record.tile as Record<string, unknown>) : record;
  const x = finiteNumber(tileRecord.x);
  const y = finiteNumber(tileRecord.y);
  if (x === null || y === null) return null;
  return { x: Math.trunc(x), y: Math.trunc(y), direction: cleanInteger(tileRecord.direction, 0) };
}

function pluginSelectorKind(selector: unknown): "floor" | "wall" | null {
  const record = selector && typeof selector === "object" ? (selector as Record<string, unknown>) : {};
  const kind = String(record.kind ?? "").trim().toLowerCase();
  if (kind === "wall" || kind === "wallitem" || kind === "wall-item") return "wall";
  if (kind === "floor" || kind === "flooritem" || kind === "floor-item" || kind === "active" || kind === "passive") return "floor";
  return null;
}

function pluginSelectorWallLocation(selector: unknown, location: unknown): WallMoverLocation | null {
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

function pluginWallMoveLocation(base: WallMoverLocation, input: unknown): WallMoverLocation {
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

function pluginFishingAreaRows(snapshot: EngineRuntimeSnapshot | null, metadata: FurniMetadataSnapshot | null): readonly ItemRow[] {
  return runtimeItemRows(snapshot).filter((row) => row.kind !== "wall" && isFishingAreaObject(row.item) && itemRowTile(row));
}

function pluginFishingAreaPayload(row: ItemRow, metadata: FurniMetadataSnapshot | null): Record<string, unknown> {
  const tile = itemRowTile(row);
  return {
    id: objectNumericId(row.item),
    title: itemRowTitle(row, metadata),
    meta: itemRowMeta(row, metadata),
    tile,
    item: row.item,
  };
}

function pluginFishingAreaTarget(
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

function runtimeObjectNumericIds(entry: RuntimeObjectSummary | null | undefined): readonly number[] {
  if (!entry) return [];
  const record = entry as RuntimeObjectSummary & { readonly itemId?: unknown; readonly slotId?: unknown };
  const ids = [record.objectId, record.id, record.itemId, record.slotId]
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null)
    .map((value) => Math.trunc(value))
    .filter((value) => value > 0);
  return [...new Set(ids)];
}

function firstNonEmptyText(values: readonly unknown[]): string {
  for (const value of values) {
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (text) return text;
  }
  return "";
}

const PROFILE_IMPORT_STAGES: readonly ProfileImportStage[] = [
  "validate",
  "sanitize",
  "projectorrays",
  "index-casts",
  "text-fields",
  "materialize-bitmaps",
  "generate-scripts",
  "validate-profile",
];

const PROFILE_IMPORT_STAGE_LABELS: Record<ProfileImportStage, string> = {
  validate: "Validate folder",
  sanitize: "Copy client",
  projectorrays: "Decompile",
  "index-casts": "Index casts",
  "text-fields": "Extract text",
  "materialize-bitmaps": "Prepare assets",
  "generate-scripts": "Prepare scripts",
  "validate-profile": "Validate profile",
};

interface ProfileImportUiState {
  readonly running: boolean;
  readonly jobId: string | null;
  readonly sourceName: string;
  readonly startedAt: number | null;
  readonly latest: ProfileImportProgress | null;
  readonly entries: readonly ProfileImportProgress[];
  readonly events: readonly ProfileImportProgress[];
  readonly message: string;
}

const emptyProfileImportUiState: ProfileImportUiState = {
  running: false,
  jobId: null,
  sourceName: "",
  startedAt: null,
  latest: null,
  entries: [],
  events: [],
  message: "",
};

function pendingProfileImportUiState(): ProfileImportUiState {
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

function profileImportUiWithProgress(current: ProfileImportUiState, progress: ProfileImportProgress): ProfileImportUiState {
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

function profileImportUiFinished(current: ProfileImportUiState, message: string, failed: boolean): ProfileImportUiState {
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

function profileImportStageEntry(entries: readonly ProfileImportProgress[], stage: ProfileImportStage): ProfileImportProgress | undefined {
  return entries.find((entry) => entry.stage === stage);
}

function formatImportElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function profileImportStatusLabel(state: ProfileImportUiState): string {
  if (state.running) return "Running";
  if (state.latest?.state === "failed") return "Failed";
  if (state.latest?.state === "warning") return "Imported with warnings";
  if (state.latest?.state === "done") return "Complete";
  return "Idle";
}

function ImporterWorkspace({
  bridgeAvailable,
  bridgeMessage,
  engineBusy,
  settingsBusy,
  engineLaunch,
  elapsedMs,
  importState,
  profiles,
  selectedProfile,
  onImport,
  onRefresh,
  onStart,
  onSetCustomHotelView,
  onSetResizablePresentation,
  onSetVersionCheckBuild,
  versionCheckDraft,
  onVersionCheckDraftChange,
}: {
  readonly bridgeAvailable: boolean;
  readonly bridgeMessage: string;
  readonly engineBusy: boolean;
  readonly settingsBusy: boolean;
  readonly engineLaunch: EngineLaunchState | null;
  readonly elapsedMs: number;
  readonly importState: ProfileImportUiState;
  readonly profiles: readonly ClientProfileSummary[];
  readonly selectedProfile: ClientProfileSummary | null;
  readonly onImport: () => void;
  readonly onRefresh: () => void;
  readonly onStart: () => void;
  readonly onSetCustomHotelView: (enabled: boolean) => void;
  readonly onSetResizablePresentation: (enabled: boolean) => void;
  readonly onSetVersionCheckBuild: () => void;
  readonly versionCheckDraft: string;
  readonly onVersionCheckDraftChange: (value: string) => void;
}) {
  const latest = importState.latest;
  const latestPercent = Math.max(0, Math.min(100, Math.round(latest?.percent ?? 0)));
  const profileReady = Boolean(selectedProfile?.ready && engineLaunch?.status !== "running");
  const status = profileImportStatusLabel(importState);
  const message = importState.message || engineLaunch?.message || bridgeMessage;
  const launchSettingsDisabled = !bridgeAvailable || settingsBusy || engineLaunch?.status === "running";
  return (
    <div className="importer-workspace" aria-label="Client importer">
      <section className="importer-hero">
        <div className="importer-identity">
          <img className="hotel-avatar importer-avatar" src="./img/avatar.png" alt="" aria-hidden="true" />
          <div>
            <strong>Client Importer</strong>
            <span>{profiles.length > 0 ? profileLine(selectedProfile) : "No playable profile attached"}</span>
          </div>
        </div>
        <div className="importer-actions">
          <button type="button" onClick={onRefresh} disabled={!bridgeAvailable || engineBusy} title="Refresh client library">
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
          <button type="button" className="primary" onClick={onImport} disabled={!bridgeAvailable || engineBusy} title="Import or build client">
            <FolderInput size={14} />
            <span>{importState.running ? "Importing" : "Import/Build Client"}</span>
          </button>
          {profileReady ? (
            <button type="button" className="primary" onClick={onStart} disabled={!bridgeAvailable || engineBusy} title="Start embedded client">
              <Play size={14} />
              <span>Start</span>
            </button>
          ) : null}
        </div>
      </section>

      <section className="importer-main">
        <div className="importer-progress-panel">
          <div className="importer-panel-heading">
            <span>{status}</span>
            <strong>{latestPercent}%</strong>
          </div>
          <div className="importer-current-step">
            <strong>{latest ? PROFILE_IMPORT_STAGE_LABELS[latest.stage] : "Ready"}</strong>
            <span>{latest?.message ?? message ?? "Select a compiled client folder to build a playable Shockless profile."}</span>
            {latest?.detail ? <small>{latest.detail}</small> : null}
          </div>
          <div className="importer-progress-meta">
            <span>{formatImportElapsed(elapsedMs)} elapsed</span>
            <span>{importState.sourceName || latest?.sourceName || "No folder selected"}</span>
            {latest?.current !== undefined && latest.total !== undefined ? (
              <span>
                {latest.current.toLocaleString()} / {latest.total.toLocaleString()}
              </span>
            ) : latest?.current !== undefined ? (
              <span>{latest.current.toLocaleString()} written</span>
            ) : null}
          </div>
          <div className="importer-progress-bar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={latestPercent}>
            <span style={{ width: `${latestPercent}%` }} />
          </div>
          {importState.running ? (
            <p className="importer-note">Decompile and asset preparation can use CPU and disk while generated files are written.</p>
          ) : null}
          <ol className="importer-stage-list">
            {PROFILE_IMPORT_STAGES.map((stage) => {
              const entry = profileImportStageEntry(importState.entries, stage);
              const stateClass = entry?.state ?? "pending";
              return (
                <li className={stateClass} key={stage}>
                  <strong>{PROFILE_IMPORT_STAGE_LABELS[stage]}</strong>
                  <span>{entry?.message ?? "Waiting"}</span>
                  {entry?.detail ? <small>{entry.detail}</small> : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="importer-detail-panel">
          <div className="importer-panel-heading">
            <span>Details</span>
            <strong>{profiles.length} profile{profiles.length === 1 ? "" : "s"}</strong>
          </div>
          <div className="importer-detail-grid">
            <span>Selected</span>
            <strong>{profileLine(selectedProfile)}</strong>
            <span>Engine</span>
            <strong>{statusLabel(engineLaunch?.status)}</strong>
            <span>Stage</span>
            <strong>{engineLaunch?.settings?.resizablePresentation ? "Responsive" : "Fixed Stage"}</strong>
            <span>Hotel View</span>
            <strong>{engineLaunch?.settings?.customHotelView ? "Custom" : "Default"}</strong>
            <span>Version</span>
            <strong>{compactValue(engineLaunch?.settings?.versionCheckBuild ?? selectedProfile?.versionCheckBuild ?? null)}</strong>
            <span>Log</span>
            <strong>{compactValue(latest?.logPath ? latest.logPath.split(/[\\/]/).pop() : null)}</strong>
          </div>
          <div className="importer-launch-settings" aria-label="Launch settings">
            <label className="toggle-row checkbox-first-row">
              <input
                type="checkbox"
                checked={engineLaunch?.settings?.customHotelView === true}
                disabled={launchSettingsDisabled}
                onChange={(event) => onSetCustomHotelView(event.currentTarget.checked)}
              />
              <span>Custom hotel view</span>
            </label>
            <label className="toggle-row checkbox-first-row">
              <input
                type="checkbox"
                checked={engineLaunch?.settings?.resizablePresentation !== false}
                disabled={launchSettingsDisabled}
                onChange={(event) => onSetResizablePresentation(event.currentTarget.checked)}
              />
              <span>Responsive stage resize</span>
            </label>
            <form
              className="runtime-input-row importer-version-row"
              onSubmit={(event) => {
                event.preventDefault();
                onSetVersionCheckBuild();
              }}
            >
              <input
                value={versionCheckDraft}
                onChange={(event) => onVersionCheckDraftChange(event.currentTarget.value)}
                placeholder={selectedProfile?.versionCheckBuild ? String(selectedProfile.versionCheckBuild) : "auto"}
                disabled={!bridgeAvailable || engineBusy || !selectedProfile}
                aria-label="Version check build override"
              />
              <button type="submit" disabled={!bridgeAvailable || engineBusy || !selectedProfile}>
                Apply
              </button>
            </form>
          </div>
          <div className="importer-log-lines" aria-label="Importer detail log">
            {importState.events.length > 0 ? (
              importState.events.slice(-12).map((entry, index) => (
                <code className={entry.state} key={`${entry.jobId}-${entry.stage}-${entry.updatedAt}-${index}`}>
                  [{statusLabel(entry.state)}] {PROFILE_IMPORT_STAGE_LABELS[entry.stage]}: {entry.message}
                  {entry.detail ? ` (${entry.detail})` : ""}
                </code>
              ))
            ) : (
              <p>{message || "Importer idle."}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [state, dispatch] = useReducer(shellReducer, initialAppState);
  const [booting, setBooting] = useState(true);
  const [query, setQuery] = useState("");
  const [appInfo, setAppInfo] = useState<{ readonly name: string; readonly version: string; readonly mode: "desktop" | "browser-preview" } | null>(null);
  const [appPreferences, setAppPreferences] = useState<AppPreferencesState | null>(null);
  const [pluginRegistryState, setPluginRegistryState] = useState<PluginRegistryState | null>(null);
  const [pluginManagerMessage, setPluginManagerMessage] = useState("");
  const [newPluginId, setNewPluginId] = useState("my-plugin");
  const [newPluginName, setNewPluginName] = useState("My Plugin");
  const [settingsBindKey, setSettingsBindKey] = useState("F1");
  const [settingsBindCommand, setSettingsBindCommand] = useState("mimic status");
  const [libraryState, setLibraryState] = useState<ClientLibraryState | null>(null);
  const [clientSessions, setClientSessions] = useState<ClientSessionList | null>(null);
  const [selectedClientSnapshot, setSelectedClientSnapshot] = useState<ClientSnapshot | null>(null);
  const [engineLaunch, setEngineLaunch] = useState<EngineLaunchState | null>(null);
  const [relayLog, setRelayLog] = useState<RelayLogSnapshot | null>(null);
  const [furniMetadata, setFurniMetadata] = useState<FurniMetadataSnapshot | null>(null);
  const [engineBusy, setEngineBusy] = useState(false);
  const [profileImportUi, setProfileImportUi] = useState<ProfileImportUiState>(emptyProfileImportUiState);
  const [profileImportNow, setProfileImportNow] = useState(() => Date.now());
  const [versionCheckDraft, setVersionCheckDraft] = useState("");
  const [bridgeMessage, setBridgeMessage] = useState("");
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<EngineRuntimeSnapshot | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const [privateRoomId, setPrivateRoomId] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatClearOffset, setChatClearOffset] = useState(0);
  const [chatRoomMarkers, setChatRoomMarkers] = useState<RuntimeChatEntry[]>([]);
  const [chatFilters, setChatFilters] = useState({
    talk: true,
    whisper: true,
    shout: true,
    system: true,
    autoscroll: true,
  });
  const [packetFilters, setPacketFilters] = useState({
    client: true,
    server: true,
    relay: true,
    wrap: true,
    autoscroll: true,
    clientSession: "All",
    session: "All",
    search: "",
  });
  const [packetClearOffset, setPacketClearOffset] = useState(0);
  const [selectedPacketKey, setSelectedPacketKey] = useState("");
  const [packetExportMessage, setPacketExportMessage] = useState("");
  const [packetConsoleOpen, setPacketConsoleOpen] = useState(false);
  const [packetConsoleQuery, setPacketConsoleQuery] = useState("");
  const [packetConsoleClientFilter, setPacketConsoleClientFilter] = useState("All");
  const [packetConsoleInput, setPacketConsoleInput] = useState("");
  const [packetConsoleEntries, setPacketConsoleEntries] = useState<PacketConsoleEntry[]>([]);
  const [consoleCommandState, setConsoleCommandState] = useState<ConsoleCommandStateSnapshot | null>(null);
  const [mimicState, setMimicState] = useState<MimicStateSnapshot | null>(null);
  const [multiAccountFile, setMultiAccountFile] = useState("multiclient-accounts.txt");
  const [multiAccountCount, setMultiAccountCount] = useState("3");
  const [multiAccountConcurrency, setMultiAccountConcurrency] = useState("2");
  const [multiAccountKeyEnv, setMultiAccountKeyEnv] = useState("HABBPY_V4_ACCOUNT_STORE_KEY");
  const [multiAccountSummonTarget, setMultiAccountSummonTarget] = useState("headless");
  const [multiAccountLoadMode, setMultiAccountLoadMode] = useState<"headless" | "visible">("headless");
  const [multiAccountMessage, setMultiAccountMessage] = useState("");
  const [packetConsoleHistoryIndex, setPacketConsoleHistoryIndex] = useState<number | null>(null);
  const [packetListScrollTop, setPacketListScrollTop] = useState(0);
  const [packetConsoleScrollTop, setPacketConsoleScrollTop] = useState(0);
  const [socialFriendFilter, setSocialFriendFilter] = useState("");
  const [inventoryFilter, setInventoryFilter] = useState("");
  const [selectedInventoryKey, setSelectedInventoryKey] = useState("");
  const [gameZoom, setGameZoom] = useState<1 | 2>(1);
  const [injectionDraft, setInjectionDraft] = useState<InjectionCommandDraft>(defaultInjectionDraft);
  const [injectionRepeatCount, setInjectionRepeatCount] = useState("1");
  const [injectionRepeatInterval, setInjectionRepeatInterval] = useState("1000");
  const [injectionSnippets, setInjectionSnippets] = useState<InjectionSnippet[]>([]);
  const [selectedInjectionSnippetId, setSelectedInjectionSnippetId] = useState("");
  const [injectionHistory, setInjectionHistory] = useState<InjectionHistoryEntry[]>([]);
  const [injectionMessage, setInjectionMessage] = useState("");
  const [visitorFilter, setVisitorFilter] = useState("");
  const [visitorState, setVisitorState] = useState<VisitorTrackerState>(emptyVisitorState);
  const [itemFilter, setItemFilter] = useState("");
  const [selectedItemKey, setSelectedItemKey] = useState("");
  const [publicRoomQuery, setPublicRoomQuery] = useState("");
  const [roomStageClickX, setRoomStageClickX] = useState("480");
  const [roomStageClickY, setRoomStageClickY] = useState("270");
  const [selectedPlantKey, setSelectedPlantKey] = useState("");
  const [gardeningCycleSec, setGardeningCycleSec] = useState("600");
  const [gardeningJob, setGardeningJob] = useState<GardeningJobState | null>(null);
  const [gardeningRunning, setGardeningRunning] = useState(false);
  const [fishingMessage, setFishingMessage] = useState("");
  const [gardeningMessage, setGardeningMessage] = useState("");
  const [presentCatcherRunning, setPresentCatcherRunning] = useState(false);
  const [presentCatcherMessage, setPresentCatcherMessage] = useState("");
  const [presentCatcherTab, setPresentCatcherTab] = useState<"catcher" | "gifts" | "fragments">("catcher");
  const [presentCatcherPanicDraft, setPresentCatcherPanicDraft] = useState("");
  const [presentCatcherPanicNames, setPresentCatcherPanicNames] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("habbpy-v4:present-catcher:panic-names") ?? "[]");
      return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  const [presentCatcherGiftClass, setPresentCatcherGiftClass] = useState("balloon");
  const [selectedPresentGiftKey, setSelectedPresentGiftKey] = useState("");
  const [presentPlaceX, setPresentPlaceX] = useState("");
  const [presentPlaceY, setPresentPlaceY] = useState("");
  const [presentPlaceDirection, setPresentPlaceDirection] = useState("2");
  const [presentOpenObjectId, setPresentOpenObjectId] = useState("");
  const [presentFragmentEvent, setPresentFragmentEvent] = useState("second_anniversary");
  const [presentFragmentSlotId, setPresentFragmentSlotId] = useState("");
  const [presentFragmentTradeTarget, setPresentFragmentTradeTarget] = useState("");
  const [selectedWallMoverKey, setSelectedWallMoverKey] = useState("");
  const [wallMoverStep, setWallMoverStep] = useState("1");
  const [wallMoverMessage, setWallMoverMessage] = useState("");
  const [selectedUserKey, setSelectedUserKey] = useState("");
  const [engineUserNameLabels, setEngineUserNameLabels] = useState(false);
  const [userStoredLooks, setUserStoredLooks] = useState<string[]>(loadStoredUserLooks);
  const [selectedStoredUserLook, setSelectedStoredUserLook] = useState("");
  const [userToolMessage, setUserToolMessage] = useState("");
  const [automationPrefs, setAutomationPrefs] = useState(loadAutomationPrefs);
  const [automationMessage, setAutomationMessage] = useState("");
  const [socialMessage, setSocialMessage] = useState("");
  const [publicLookupName, setPublicLookupName] = useState("");
  const [publicLookupBusy, setPublicLookupBusy] = useState(false);
  const [publicLookupResult, setPublicLookupResult] = useState<OriginsUserLookupResult | null>(null);
  const [visitorLookupBusy, setVisitorLookupBusy] = useState(false);
  const [visitorLookupMessage, setVisitorLookupMessage] = useState("");
  const [visitorPublicProfiles, setVisitorPublicProfiles] = useState<Readonly<Record<string, OriginsUserLookupResult>>>({});
  const webviewRef = useRef<EngineWebviewElement | null>(null);
  const gameWebviewRefs = useRef<globalThis.Map<number, EngineWebviewElement>>(new globalThis.Map());
  const gameWebviewRefCallbacks = useRef<globalThis.Map<number, (element: Element | null) => void>>(new globalThis.Map());
  const runtimeSnapshotRef = useRef<EngineRuntimeSnapshot | null>(null);
  const relayLogRef = useRef<RelayLogSnapshot | null>(null);
  const clientSessionsRef = useRef<ClientSessionList | null>(null);
  const selectedClientIdRef = useRef(1);
  const selectedRuntimeSnapshotRef = useRef<EngineRuntimeSnapshot | null>(null);
  const userPluginHostRef = useRef<RendererUserPluginHost | null>(null);
  const userPluginRequestHandlerRef = useRef<(plugin: PluginDefinition, request: UserPluginHostRequest) => Promise<unknown>>(
    async () => {
      throw new Error("Plugin host is not ready.");
    },
  );
  const userPluginLogHandlerRef = useRef<(plugin: PluginDefinition, level: "info" | "warning" | "error", message: string) => void>(() => undefined);
  const userPluginRoomUsersRef = useRef<UserPluginRoomUserCache | null>(null);
  const userPluginRoomObjectsRef = useRef<UserPluginRoomObjectCache | null>(null);
  const userPluginChatRef = useRef<UserPluginChatCache | null>(null);
  const userPluginPacketCursorRef = useRef<{ readonly logPath: string | null; readonly lineNumber: number; readonly initialized: boolean }>({
    logPath: null,
    lineNumber: 0,
    initialized: false,
  });
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const packetListRef = useRef<HTMLDivElement | null>(null);
  const packetListScrollFrameRef = useRef<number | null>(null);
  const packetConsoleListRef = useRef<HTMLDivElement | null>(null);
  const packetConsolePacketListRef = useRef<HTMLDivElement | null>(null);
  const packetConsoleScrollFrameRef = useRef<number | null>(null);
  const injectionFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastChatRoomMarkerKeyRef = useRef("");
  const lastAutoHideBulletinKeyRef = useRef("");
  const presentCatcherActionInFlightRef = useRef(false);
  const visibleLoginSubmittedRef = useRef<Set<string>>(new Set());
  const visibleLoginInFlightRef = useRef<Set<string>>(new Set());
  const visibleLoginWarnedRef = useRef<Set<string>>(new Set());
  const preferenceDefaultsAppliedRef = useRef(false);
  const completedImportRefreshRef = useRef("");
  const [gameWebviewMountEpoch, setGameWebviewMountEpoch] = useState(0);
  const [mountedVisibleClientIds, setMountedVisibleClientIds] = useState<ReadonlySet<number>>(() => new globalThis.Set([1]));

  const availablePlugins = pluginRegistryState?.plugins ?? plugins;
  const pluginEnabledById = pluginRegistryState?.enabledById ?? state.plugins.enabledById;
  const pluginSurfaceEnabledByPluginId = pluginRegistryState?.uiSurfaceEnabledByPluginId ?? state.plugins.uiSurfaceEnabledByPluginId;
  const pinnedPluginIds = useMemo(
    () => new Set(pluginRegistryState?.pinnedPluginIds ?? ["connection", "plugin-manager", "settings"]),
    [pluginRegistryState?.pinnedPluginIds],
  );

  const railPlugins = useMemo(() => {
    return availablePlugins.filter((plugin) => pinnedPluginIds.has(plugin.id) || pluginEnabledById[plugin.id] !== false);
  }, [availablePlugins, pinnedPluginIds, pluginEnabledById]);

  const filteredPlugins = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return railPlugins;
    return railPlugins.filter((plugin) => {
      const text = [plugin.name, plugin.category, plugin.summary, ...plugin.capabilities].join(" ").toLowerCase();
      return text.includes(normalized);
    });
  }, [query, railPlugins]);
  const savedSelectedPlugin = availablePlugins.find((plugin) => plugin.id === state.selectedPluginId) ?? getPluginById(state.selectedPluginId) ?? availablePlugins[0] ?? plugins[0];
  const selectedPlugin = filteredPlugins.some((plugin) => plugin.id === savedSelectedPlugin.id)
    ? savedSelectedPlugin
    : filteredPlugins[0] ?? savedSelectedPlugin;
  const selectedProfile =
    libraryState?.profiles.find((profile) => profile.profileRoot === libraryState.selectedProfileRoot) ??
    engineLaunch?.profile ??
    null;
  const selectedClientSession =
    clientSessions?.sessions.find((session) => session.id === clientSessions.selectedClientId) ??
    clientSessions?.sessions.find((session) => session.selected) ??
    clientSessions?.sessions[0] ??
    null;
  const selectedClientId = selectedClientSession?.id ?? selectedClientSnapshot?.selectedClientId ?? clientSessions?.selectedClientId ?? 1;
  const selectedClientIsVisible = selectedClientSession?.visible !== false;
  const selectedClientEngineUrl =
    selectedClientSession && selectedClientIsVisible && selectedClientSession.status === "running"
      ? selectedClientSession.embeddedUrl ?? ""
      : "";
  const engineUrl = selectedClientSession
    ? selectedClientIsVisible
      ? selectedClientEngineUrl || (selectedClientId === 1 ? engineLaunch?.embeddedUrl ?? "" : "")
      : ""
    : engineLaunch?.embeddedUrl ?? "";
  const availableVisibleGameViews = useMemo(() => {
    const byClientId = new globalThis.Map<number, GameWebviewMount>();
    for (const session of clientSessions?.sessions ?? []) {
      if (!session.visible || session.headless || session.status !== "running") continue;
      const url = session.embeddedUrl || (session.id === 1 ? engineLaunch?.embeddedUrl ?? "" : "");
      if (!url) continue;
      byClientId.set(session.id, {
        id: session.id,
        label: session.label,
        url,
        partition: gameWebviewPartitionForClient(session.id),
      });
    }
    if (engineLaunch?.embeddedUrl && !byClientId.has(1)) {
      byClientId.set(1, {
        id: 1,
        label: clientSessions?.sessions.find((session) => session.id === 1)?.label ?? "Main",
        url: engineLaunch.embeddedUrl,
        partition: gameWebviewPartitionForClient(1),
      });
    }
    return [...byClientId.values()].sort((left, right) => left.id - right.id);
  }, [clientSessions?.sessions, engineLaunch?.embeddedUrl]);
  const availableVisibleGameViewKey = availableVisibleGameViews.map((view) => `${view.id}:${view.url}`).join("|");
  const mountedVisibleGameViews = useMemo(
    () =>
      availableVisibleGameViews.filter(
        (view) => mountedVisibleClientIds.has(view.id) || (view.id === selectedClientId && selectedClientIsVisible),
      ),
    [availableVisibleGameViews, mountedVisibleClientIds, selectedClientId, selectedClientIsVisible],
  );
  const hasMountedVisibleGameViews = mountedVisibleGameViews.length > 0;
  const selectedRuntimeSnapshot = selectedClientIsVisible ? runtimeSnapshot : null;
  const roomReady = Boolean(selectedRuntimeSnapshot?.roomReady?.ready ?? selectedRuntimeSnapshot?.roomEntryState?.roomReady?.ready);
  const privateRoomReady = roomReady && runtimeRoomType(selectedRuntimeSnapshot) === "private";
  const desktopBridgeAvailable = Boolean(window.habbpyV4);
  const profileImportRunning = profileImportUi.running;
  const profileImportElapsedMs =
    profileImportRunning && profileImportUi.startedAt
      ? Math.max(0, profileImportNow - profileImportUi.startedAt)
      : profileImportUi.latest?.elapsedMs ?? (profileImportUi.startedAt ? Math.max(0, profileImportNow - profileImportUi.startedAt) : 0);
  const mainMimicSourceId = clientSessions?.mainClientId ?? 1;
  const mainClientSession = clientSessions?.sessions.find((session) => session.id === mainMimicSourceId) ?? null;
  const mimicSourceSession = clientSessions?.sessions.find((session) => session.id === mimicState?.sourceClientId) ?? null;
  const mimicTargetSessions = (clientSessions?.sessions ?? []).filter((session) => mimicState?.targetClientIds.includes(session.id));
  const packetEntries = relayLog?.entries ?? [];
  useEffect(() => {
    clientSessionsRef.current = clientSessions;
  }, [clientSessions]);
  useEffect(() => {
    selectedClientIdRef.current = selectedClientId;
  }, [selectedClientId]);
  useEffect(() => {
    selectedRuntimeSnapshotRef.current = selectedRuntimeSnapshot;
  }, [selectedRuntimeSnapshot]);
  const clientPluginSnapshotsById = useMemo(
    () =>
      clientPluginSnapshotMapFromSources({
        relayLog,
        sessions: clientSessions?.sessions ?? [],
        selectedClientId,
        selectedRuntimeSnapshot,
        selectedClientSnapshot,
      }),
    [clientSessions?.sessions, relayLog, selectedClientId, selectedClientSnapshot, selectedRuntimeSnapshot],
  );
  const selectedClientPluginSnapshot = clientPluginSnapshotsById.get(selectedClientId) ?? null;
  const selectedClientRelayLog = selectedClientPluginSnapshot?.relay ?? null;
  const packetPanelActive = selectedPlugin.id === "packet-log";
  const relayDerivedState = useMemo(() => relayDerivedStateFromSnapshot(selectedClientRelayLog), [selectedClientRelayLog]);
  const packetInfoState = selectedClientPluginSnapshot?.packetInfo ?? emptyPacketInfoState;
  const packetInventoryState = selectedClientPluginSnapshot?.packetInventory ?? emptyPacketInventoryState;
  const packetWallItemState = selectedClientPluginSnapshot?.packetWallItems ?? emptyPacketWallItemState;
  const packetFishingState = selectedClientPluginSnapshot?.packetFishing ?? emptyPacketFishingState;
  const latestClientPacket = relayDerivedState.latestClientPacket;
  const latestServerPacket = relayDerivedState.latestServerPacket;
  const relaySessionId = compactValue(relayDerivedState.latestSessionId);
  const relayEncryptionState = relayEncryptionSummary(relayDerivedState);
  const relayBodyLoggingState = relayBodyLoggingSummary(relayDerivedState);
  const relayClientModes = relayModeSummary(relayDerivedState.clientModes);
  const relayServerModes = relayModeSummary(relayDerivedState.serverModes);
  const userRows = selectedRuntimeSnapshot?.userState?.users ?? [];
  const selectedUser = userRows.find((user) => user.rowId === selectedUserKey) ?? userRows[0] ?? null;
  const selectedUserName = userDisplayName(selectedUser, selectedRuntimeSnapshot?.userState?.sessionUserName);
  const selfUser = useMemo(() => {
    const sessionName = String(selectedRuntimeSnapshot?.userState?.sessionUserName ?? "").trim().toLowerCase();
    if (!sessionName) return selectedUser;
    return userRows.find((user) => userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName).trim().toLowerCase() === sessionName) ?? selectedUser;
  }, [selectedRuntimeSnapshot?.userState?.sessionUserName, selectedUser, userRows]);
  const packetProfileUsers = selectedClientPluginSnapshot?.profileUsers ?? [];
  const packetProfileIndex = selectedClientPluginSnapshot?.profileIndex ?? emptyPacketProfileIndex;
  const visibleActiveAccountNames = useMemo(
    () =>
      uniqueUsefulNames([
        selectedRuntimeSnapshot?.userState?.sessionUserName,
        selectedClientSession?.username,
        selectedClientSnapshot?.client?.username,
        selectedClientSnapshot?.runtime?.userName,
        userRows.find((user) => user.rowId === "0") ? userDisplayName(userRows.find((user) => user.rowId === "0") ?? null, selectedRuntimeSnapshot?.userState?.sessionUserName) : null,
      ]),
    [
      selectedClientSession?.username,
      selectedClientSnapshot?.client?.username,
      selectedClientSnapshot?.runtime?.userName,
      selectedRuntimeSnapshot?.userState?.sessionUserName,
      userRows,
    ],
  );
  const selectedPacketProfileUser = useMemo(
    () => selectPacketProfileUser(packetProfileIndex, selectedUserName, selectedUser),
    [packetProfileIndex, selectedUser, selectedUserName],
  );
  const packetChatEntries = selectedClientPluginSnapshot?.packetChatEntries ?? [];
  const packetChatHistory = useMemo(
    () =>
      packetChatEntries.map((entry) =>
        packetChatRuntimeEntry(entry, packetProfileIndex, userRows, selectedRuntimeSnapshot?.userState?.sessionUserName),
      ),
    [packetChatEntries, packetProfileIndex, selectedRuntimeSnapshot?.userState?.sessionUserName, userRows],
  );
  const filteredPacketFriends = useMemo(() => {
    const normalized = socialFriendFilter.trim().toLowerCase();
    if (!normalized) return packetInfoState.friends;
    return packetInfoState.friends.filter((friend) => packetFriendSearchText(friend).includes(normalized));
  }, [packetInfoState.friends, socialFriendFilter]);
  const onlinePacketFriends = packetInfoState.friends.filter((friend) => friend.online).length;
  const socialRequestCount = packetInfoState.friendRequests.length > 0
    ? String(packetInfoState.friendRequests.length)
    : packetInfoState.messengerRequestCount;
  const socialMessageCount = packetInfoState.privateMessages.length > 0
    ? String(packetInfoState.privateMessages.length)
    : packetInfoState.messengerMessageCount;
  const visiblePrivateMessages = packetInfoState.privateMessages.slice(-6).reverse();
  const visibleFriendRequests = packetInfoState.friendRequests.slice(-6).reverse();
  const runtimeInventoryItems = selectedRuntimeSnapshot?.inventory?.items ?? [];
  const runtimeInventoryRows = useMemo(
    () => runtimeInventoryItems.map((item) => runtimeInventoryDisplayRow(item, furniMetadata)),
    [furniMetadata, runtimeInventoryItems],
  );
  const packetInventoryRows = useMemo(
    () => packetInventoryState.items.map((item) => packetInventoryDisplayRow(item, furniMetadata)),
    [furniMetadata, packetInventoryState.items],
  );
  const inventoryUsesPacketRows = runtimeInventoryRows.length === 0 && packetInventoryRows.length > 0;
  const inventoryRows = inventoryUsesPacketRows ? packetInventoryRows : runtimeInventoryRows;
  const filteredInventoryRows = useMemo(() => {
    const normalized = inventoryFilter.trim().toLowerCase();
    if (!normalized) return inventoryRows;
    return inventoryRows.filter((row) => row.searchText.includes(normalized));
  }, [inventoryFilter, inventoryRows]);
  const selectedInventoryRow = filteredInventoryRows.find((row) => row.key === selectedInventoryKey) ?? filteredInventoryRows[0] ?? null;
  const inventoryTotalCount = inventoryUsesPacketRows
    ? packetInventoryState.totalCount
    : selectedRuntimeSnapshot?.inventory?.totalCount ?? selectedRuntimeSnapshot?.inventory?.itemCount ?? packetInventoryState.totalCount;
  const inventoryRowCount = inventoryUsesPacketRows ? packetInventoryState.totalCount : selectedRuntimeSnapshot?.inventory?.itemCount ?? runtimeInventoryRows.length;
  const inventoryFloorCount = inventoryUsesPacketRows ? packetInventoryState.floorCount : selectedRuntimeSnapshot?.inventory?.floorCount ?? 0;
  const inventoryWallCount = inventoryUsesPacketRows ? packetInventoryState.wallCount : selectedRuntimeSnapshot?.inventory?.wallCount ?? 0;
  const selectedUserAccountId = profileValue(selectedUser?.accountId, selectedPacketProfileUser?.accountId);
  const selectedUserIndex = profileValue(selectedUser?.roomIndex, selectedPacketProfileUser?.index);
  const selectedUserGender = profileValue(selectedUser?.gender, selectedPacketProfileUser?.gender);
  const selectedUserType = profileValue(selectedUser?.userType ?? selectedUser?.objectClass ?? selectedUser?.className, selectedPacketProfileUser?.userType);
  const selectedUserBadgeCode = profileValue(selectedUser?.badgeCode, selectedPacketProfileUser?.badgeCode);
  const selectedUserMotto = profileValue(selectedUser?.motto, selectedPacketProfileUser?.motto);
  const selectedUserPosition = profileValue(userPosition(selectedUser), selectedPacketProfileUser?.position);
  const selectedUserFigure = profileValue(selectedUser?.figure, selectedPacketProfileUser?.figure);
  const selectedUserPoolFigure = profileValue(selectedUser?.poolFigure, selectedPacketProfileUser?.poolFigure);
  const activeStoredUserLook = selectedStoredUserLook || userStoredLooks[0] || "";
  const sourceChatHistory = selectedRuntimeSnapshot?.chatHistory ?? [];
  const activeChatSourceHistory = sourceChatHistory.length > 0 ? sourceChatHistory : packetChatHistory;
  const chatHistory = useMemo(() => [...chatRoomMarkers, ...activeChatSourceHistory], [activeChatSourceHistory, chatRoomMarkers]);
  const visibleChatHistory = chatHistory
    .slice(Math.min(chatClearOffset, chatHistory.length))
    .filter((entry) => chatFilters[chatEntryKind(entry)]);
  const visitorRoomKey = roomReady ? `${runtimeRoomType(selectedRuntimeSnapshot)}:${runtimeRoomId(selectedRuntimeSnapshot)}` : "";
  const visitorRoomName = roomReady ? runtimeRoomName(selectedRuntimeSnapshot) : "-";
  const visitorEntries = useMemo(
    () =>
      Object.values(visitorState.entries).sort((left, right) => {
        if (left.current !== right.current) return left.current ? -1 : 1;
        return left.name.localeCompare(right.name);
      }),
    [visitorState.entries],
  );
  const enrichedVisitorEntries = useMemo(
    () =>
      visitorEntries.map((entry) => {
        if (entry.accountId !== "-") return entry;
        const profile = visitorPublicProfiles[entry.name.trim().toLowerCase()];
        if (!profile?.ok || !profile.id) return entry;
        return {
          ...entry,
          accountId: profile.id,
          sourceKeys: [...entry.sourceKeys, "official-origins-public-api"],
        };
      }),
    [visitorEntries, visitorPublicProfiles],
  );
  const filteredVisitorEntries = useMemo(() => {
    const normalized = visitorFilter.trim().toLowerCase();
    if (!normalized) return enrichedVisitorEntries;
    return enrichedVisitorEntries.filter((entry) => visitorSearchText(entry).includes(normalized));
  }, [enrichedVisitorEntries, visitorFilter]);
  const missingVisitorAccountIds = enrichedVisitorEntries.filter((entry) => entry.accountId === "-").length;
  const runtimeSourceItemRows = useMemo<readonly ItemRow[]>(() => runtimeItemRows(selectedRuntimeSnapshot), [selectedRuntimeSnapshot?.roomObjects]);
  const packetWallItemRows = useMemo<readonly ItemRow[]>(
    () => packetWallItemState.items.map((item) => packetWallItemRow(item)),
    [packetWallItemState.items],
  );
  const runtimeWallItemRows = runtimeSourceItemRows.filter((row) => row.kind === "wall");
  const itemRows = useMemo<readonly ItemRow[]>(() => {
    if (runtimeWallItemRows.length > 0 || packetWallItemRows.length === 0) return runtimeSourceItemRows;
    return [...runtimeSourceItemRows, ...packetWallItemRows];
  }, [packetWallItemRows, runtimeSourceItemRows, runtimeWallItemRows.length]);
  const filteredItemRows = useMemo(() => {
    const normalized = itemFilter.trim().toLowerCase();
    if (!normalized) return itemRows;
    return itemRows.filter((row) => itemRowSearchText(row, furniMetadata).includes(normalized));
  }, [furniMetadata, itemFilter, itemRows]);
  const selectedItemRow = itemRows.find((row) => row.key === selectedItemKey) ?? filteredItemRows[0] ?? null;
  const selectedItemMetadata = furniInfoForObject(furniMetadata, selectedItemRow?.item);
  const itemWallCount =
    runtimeWallItemRows.length > 0
      ? selectedRuntimeSnapshot?.roomObjects?.counts.wallItems ?? runtimeWallItemRows.length
      : packetWallItemState.itemCount;
  const fishingAreaRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isFishingAreaObject(row.item)), [itemRows]);
  const selectedFishingAreaRow = fishingAreaRows[0] ?? null;
  const plantRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isPlantLikeObject(row.item)), [itemRows]);
  const selectedPlantRow = plantRows.find((row) => row.key === selectedPlantKey) ?? plantRows[0] ?? null;
  const presentHammerRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isPresentCatcherHammerObject(row.item)), [itemRows]);
  const presentRows = useMemo(() => itemRows.filter((row) => row.kind !== "wall" && isPresentCatcherPresentObject(row.item)), [itemRows]);
  const presentGiftRows = useMemo(
    () => (selectedRuntimeSnapshot?.inventory?.items ?? []).filter((row) => isPresentCatcherGiftItem(row, presentCatcherGiftClass)),
    [presentCatcherGiftClass, selectedRuntimeSnapshot?.inventory?.items],
  );
  const selectedPresentGiftRow = presentGiftRows.find((row) => row.rowId === selectedPresentGiftKey) ?? presentGiftRows[0] ?? null;
  const presentCatcherPacketRows = useMemo(
    () =>
      (relayLog?.entries ?? [])
        .filter((entry) => (entry.clientId === null || entry.clientId === selectedClientId) && entry.header !== null && presentCatcherPacketHeaders.has(entry.header))
        .slice(-14),
    [relayLog?.entries, selectedClientId],
  );
  const wallMoverRows = useMemo(() => itemRows.filter((row) => row.kind === "wall"), [itemRows]);
  const selectedWallMoverRow = wallMoverRows.find((row) => row.key === selectedWallMoverKey) ?? wallMoverRows[0] ?? null;
  const selectedWallMoverLocation = wallMoverLocation(selectedWallMoverRow?.item);
  const selectedWallMoverItemId = objectNumericId(selectedWallMoverRow?.item);
  const deferredPacketSearch = useDeferredValue(packetFilters.search);
  const deferredPacketConsoleQuery = useDeferredValue(packetConsoleQuery);
  const packetSessionChoices = relayDerivedState.sessionChoices;
  const packetClientChoices = useMemo(() => {
    const choices = new globalThis.Map<string, string>();
    for (const session of clientSessions?.sessions ?? []) {
      choices.set(String(session.id), `client${session.id} ${session.label}`);
    }
    for (const entry of packetEntries) {
      if (entry.clientId === null) continue;
      choices.set(String(entry.clientId), `client${entry.clientId} ${entry.clientLabel ?? ""}`.trim());
    }
    return [
      { value: "All", label: "All clients" },
      ...[...choices.entries()]
        .sort((left, right) => Number(left[0]) - Number(right[0]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [clientSessions?.sessions, packetEntries]);
  const visiblePacketEntries = useMemo(() => {
    if (!packetPanelActive) return [];
    const offset = Math.min(packetClearOffset, packetEntries.length);
    const search = deferredPacketSearch.trim().toLowerCase();
    return packetEntries.slice(offset).filter((entry) => {
      if (entry.direction === "CLIENT" && !packetFilters.client) return false;
      if (entry.direction === "SERVER" && !packetFilters.server) return false;
      if (entry.direction === "RELAY" && !packetFilters.relay) return false;
      if (!packetClientMatches(entry, packetFilters.clientSession)) return false;
      if (packetFilters.session !== "All" && entry.sessionId !== packetFilters.session) return false;
      if (search && !relayEntrySearchText(entry).includes(search)) return false;
      return true;
    });
  }, [deferredPacketSearch, packetClearOffset, packetEntries, packetFilters.client, packetFilters.clientSession, packetFilters.relay, packetFilters.server, packetFilters.session, packetPanelActive]);
  const packetConsolePacketEntries = useMemo(() => {
    if (!packetConsoleOpen) return [];
    const offset = Math.min(packetClearOffset, packetEntries.length);
    const search = deferredPacketConsoleQuery.trim().toLowerCase();
    return packetEntries.slice(offset).filter((entry) => {
      if (!packetClientMatches(entry, packetConsoleClientFilter)) return false;
      if (!search) return true;
      return relayEntrySearchText(entry).includes(search);
    });
  }, [deferredPacketConsoleQuery, packetClearOffset, packetConsoleClientFilter, packetConsoleOpen, packetEntries]);
  const packetVirtualRange = useMemo(
    () => virtualPacketRange(visiblePacketEntries.length, packetListScrollTop),
    [packetListScrollTop, visiblePacketEntries.length],
  );
  const renderedPacketEntries = useMemo(
    () => visiblePacketEntries.slice(packetVirtualRange.start, packetVirtualRange.end),
    [packetVirtualRange.end, packetVirtualRange.start, visiblePacketEntries],
  );
  const packetConsoleVirtualRange = useMemo(
    () =>
      virtualPacketRange(
        packetConsolePacketEntries.length,
        packetConsoleScrollTop,
        PACKET_CONSOLE_ROW_HEIGHT,
        PACKET_CONSOLE_RENDER_ROWS,
        PACKET_CONSOLE_OVERSCAN_ROWS,
      ),
    [packetConsolePacketEntries.length, packetConsoleScrollTop],
  );
  const renderedPacketConsoleEntries = useMemo(
    () => packetConsolePacketEntries.slice(packetConsoleVirtualRange.start, packetConsoleVirtualRange.end),
    [packetConsolePacketEntries, packetConsoleVirtualRange.end, packetConsoleVirtualRange.start],
  );
  const selectedPacketEntry = packetPanelActive
    ? packetEntries.find((entry) => entry.id === selectedPacketKey) ?? visiblePacketEntries[visiblePacketEntries.length - 1] ?? null
    : null;
  const handlePacketListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (packetListScrollFrameRef.current !== null) window.cancelAnimationFrame(packetListScrollFrameRef.current);
    packetListScrollFrameRef.current = window.requestAnimationFrame(() => {
      packetListScrollFrameRef.current = null;
      startTransition(() => {
        setPacketListScrollTop(nextScrollTop);
      });
    });
  }, []);
  const handlePacketConsoleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (packetConsoleScrollFrameRef.current !== null) window.cancelAnimationFrame(packetConsoleScrollFrameRef.current);
    packetConsoleScrollFrameRef.current = window.requestAnimationFrame(() => {
      packetConsoleScrollFrameRef.current = null;
      startTransition(() => {
        setPacketConsoleScrollTop(nextScrollTop);
      });
    });
  }, []);
  const selectedInjectionSnippet = injectionSnippets.find((snippet) => snippet.id === selectedInjectionSnippetId) ?? null;

  const applyEngineLaunch = useCallback((launch: EngineLaunchState) => {
    setEngineLaunch(launch);
    dispatch({
      type: "mergeEngineStatus",
      status: {
        running: launch.status === "running",
        embedded: Boolean(launch.embeddedUrl),
        profileLabel: launch.profile ? profileLine(launch.profile) : "No Shockless profile attached",
        buildLabel: launch.buildLabel,
        location:
          launch.status === "running"
            ? "Shockless embedded"
            : launch.status === "ready"
              ? "Shockless ready"
              : launch.status === "error"
                ? "Embed error"
                : "Shell preview",
      },
    });
  }, []);

  const appendTimeline = useCallback((severity: "info" | "success" | "warning" | "error", message: string) => {
    dispatch({
      type: "appendTimeline",
      entry: {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        time: new Date().toLocaleTimeString(),
        severity,
        message,
      },
    });
  }, []);

  const updateAppPreferencePatch = useCallback(
    async (patch: AppPreferencesPatch, message: string, severity: "success" | "warning" = "success") => {
      if (!window.habbpyV4?.setAppPreferences) return;
      const next = await window.habbpyV4.setAppPreferences(patch);
      setAppPreferences(next);
      setBridgeMessage(message);
      appendTimeline(severity, message);
    },
    [appendTimeline],
  );

  const updateHardwareAccelerationPreference = useCallback(
    async (enabled: boolean) => {
      const restartRequired = enabled !== (appPreferences?.hardwareAccelerationActive ?? true);
      const restartNote = restartRequired ? " Restart Habbpy v4 to apply it." : "";
      await updateAppPreferencePatch(
        { hardwareAcceleration: enabled },
        `Hardware acceleration preference ${enabled ? "enabled" : "disabled"}.${restartNote}`,
        restartRequired ? "warning" : "success",
      );
    },
    [appPreferences?.hardwareAccelerationActive, updateAppPreferencePatch],
  );

  const saveSessionDefaultPreferences = useCallback(async () => {
    const patch: AppPreferencesPatch = {
      defaultAccountFile: multiAccountFile,
      defaultAccountCount: clampMultiAccountCount(multiAccountCount),
      defaultAccountConcurrency: clampMultiAccountConcurrency(multiAccountConcurrency),
      defaultAccountKeyEnv: multiAccountKeyEnv,
      defaultSummonTarget: multiAccountSummonTarget,
      defaultLoadMode: multiAccountLoadMode,
      autoSubmitVisibleLogin: appPreferences?.autoSubmitVisibleLogin !== false,
    };
    await updateAppPreferencePatch(patch, "Session defaults saved.");
  }, [
    appPreferences?.autoSubmitVisibleLogin,
    multiAccountConcurrency,
    multiAccountCount,
    multiAccountFile,
    multiAccountKeyEnv,
    multiAccountLoadMode,
    multiAccountSummonTarget,
    updateAppPreferencePatch,
  ]);

  const openMultiAccountPanel = useCallback(() => {
    dispatch({ type: "selectPlugin", pluginId: "multi-account" });
    if (state.ui.dockCollapsed) dispatch({ type: "toggleDockCollapsed" });
    setMultiAccountMessage("Choose Load Visible to start another switchable client, or Load Headless for background clients.");
    appendTimeline("info", "Opened Multi Account controls.");
  }, [appendTimeline, state.ui.dockCollapsed]);

  const refreshClientSessions = useCallback(async () => {
    if (!window.habbpyV4) return null;
    const sessions = await window.habbpyV4.getClientSessions();
    setClientSessions(sessions);
    return sessions;
  }, []);

  const refreshSelectedClientSnapshot = useCallback(async (clientId?: number, options: { readonly updateSelectedSnapshot?: boolean } = {}) => {
    if (!window.habbpyV4?.getClientSnapshot) return null;
    const snapshot = await window.habbpyV4.getClientSnapshot(clientId);
    const shouldUpdateSelectedSnapshot =
      options.updateSelectedSnapshot !== false &&
      (clientId === undefined || clientId === selectedClientIdRef.current);
    if (shouldUpdateSelectedSnapshot) setSelectedClientSnapshot(snapshot);
    setClientSessions((current) => mergeClientSummaryIntoList(current, snapshot));
    return snapshot;
  }, []);

  const refreshConsoleCommandState = useCallback(async () => {
    if (!window.habbpyV4?.getConsoleCommandState) return null;
    const snapshot = await window.habbpyV4.getConsoleCommandState();
    setConsoleCommandState(snapshot);
    return snapshot;
  }, []);

  const refreshMimicState = useCallback(async () => {
    if (!window.habbpyV4?.getMimicState) return null;
    const snapshot = await window.habbpyV4.getMimicState();
    setMimicState(snapshot);
    return snapshot;
  }, []);

  const selectClientSession = useCallback(
    async (clientId: number) => {
      if (!window.habbpyV4) return;
      const sessions = await window.habbpyV4.selectClientSession(clientId);
      setClientSessions(sessions);
      const launch = await window.habbpyV4.getEngineLaunchState().catch(() => null);
      if (launch) applyEngineLaunch(launch);
      void refreshSelectedClientSnapshot(clientId);
      void refreshMimicState();
      appendTimeline(sessions.selectedClientId === clientId ? "success" : "warning", sessions.message);
    },
    [appendTimeline, applyEngineLaunch, refreshMimicState, refreshSelectedClientSnapshot],
  );

  const setGameWebviewElement = useCallback((clientId: number, element: Element | null) => {
    const webview = element as EngineWebviewElement | null;
    const current = gameWebviewRefs.current.get(clientId) ?? null;
    if (webview) {
      if (current === webview) return;
      gameWebviewRefs.current.set(clientId, webview);
      setGameWebviewMountEpoch((epoch) => epoch + 1);
      return;
    }
    if (current) {
      gameWebviewRefs.current.delete(clientId);
      setGameWebviewMountEpoch((epoch) => epoch + 1);
    }
  }, []);

  const gameWebviewRefForClient = useCallback(
    (clientId: number) => {
      const current = gameWebviewRefCallbacks.current.get(clientId);
      if (current) return current;
      const callback = (element: Element | null) => setGameWebviewElement(clientId, element);
      gameWebviewRefCallbacks.current.set(clientId, callback);
      return callback;
    },
    [setGameWebviewElement],
  );

  const waitForVisibleClientWebview = useCallback(
    async (clientId: number): Promise<EngineWebviewElement | null> => {
      setMountedVisibleClientIds((current) => (current.has(clientId) ? current : new globalThis.Set([...current, clientId])));
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const webview = gameWebviewRefs.current.get(clientId);
        if (webview) return webview;
        await delay(250);
      }
      return null;
    },
    [],
  );

  useEffect(() => {
    if (availableVisibleGameViews.length === 0) return;
    setMountedVisibleClientIds((current) => {
      let changed = false;
      const next = new globalThis.Set(current);
      for (const view of availableVisibleGameViews) {
        if (next.has(view.id)) continue;
        next.add(view.id);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [availableVisibleGameViewKey, availableVisibleGameViews]);

  useEffect(() => {
    const availableIds = new globalThis.Set(availableVisibleGameViews.map((view) => view.id));
    setMountedVisibleClientIds((current) => {
      const next = new globalThis.Set([...current].filter((clientId) => availableIds.has(clientId)));
      return next.size === current.size && [...next].every((clientId) => current.has(clientId)) ? current : next;
    });
  }, [availableVisibleGameViewKey, availableVisibleGameViews]);

  useEffect(() => {
    webviewRef.current = gameWebviewRefs.current.get(selectedClientId) ?? null;
  }, [gameWebviewMountEpoch, mountedVisibleGameViews, selectedClientId]);

  const applyRuntimeSnapshot = useCallback((snapshot: EngineRuntimeSnapshot) => {
    const stableSnapshot = reuseStableRuntimeDetails(runtimeSnapshotRef.current, snapshot);
    runtimeSnapshotRef.current = stableSnapshot;
    const summary = summarizeRuntimeSnapshot(stableSnapshot);
    startTransition(() => {
      setRuntimeSnapshot(stableSnapshot);
      dispatch({
        type: "mergeEngineStatus",
        status: summary.engine,
      });
      dispatch({
        type: "mergeRoomSummary",
        room: summary.room,
      });
      dispatch({
        type: "mergeAccountSummary",
        account: summary.account,
      });
    });
  }, []);

  const refreshRuntimeSnapshot = useCallback(async (scopes: readonly EngineRuntimeSnapshotScope[] = ["full"]) => {
    const webview = webviewRef.current;
    if (!webview || !engineUrl) return null;
    const snapshot = await readEngineRuntimeSnapshot(webview, scopes);
    applyRuntimeSnapshot(snapshot);
    return snapshot;
  }, [applyRuntimeSnapshot, engineUrl, selectedClientId]);

  const refreshRelayLog = useCallback(async () => {
    if (!window.habbpyV4) return null;
    const current = relayLogRef.current;
    const snapshot = current
      ? await window.habbpyV4.getRelayLogDeltaSnapshot(current.logPath, current.totalLines)
      : await window.habbpyV4.getRelayLogSnapshot();
    let nextSnapshot: RelayLogSnapshot | null = null;
    setRelayLog((current) => {
      const merged = mergeRelayLogSnapshot(current, snapshot);
      if (current === merged) {
        nextSnapshot = current;
        return current;
      }
      relayLogRef.current = merged;
      nextSnapshot = merged;
      return merged;
    });
    return nextSnapshot ?? relayLogRef.current;
  }, []);

  const refreshFurniMetadata = useCallback(async () => {
    if (!window.habbpyV4) return null;
    const snapshot = await window.habbpyV4.getFurniMetadataSnapshot();
    setFurniMetadata(snapshot);
    return snapshot;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.code !== "Backquote" && event.key !== "`") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTextEntryTarget(event.target)) return;
      event.preventDefault();
      setPacketConsoleOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    void refreshConsoleCommandState();
  }, [refreshConsoleCommandState]);

  useEffect(() => {
    void refreshMimicState();
  }, [refreshMimicState]);

  useEffect(() => {
    localStorage.setItem("habbpy-v4:present-catcher:panic-names", JSON.stringify(presentCatcherPanicNames));
  }, [presentCatcherPanicNames]);

  useEffect(() => {
    if (!desktopBridgeAvailable) return;
    void refreshSelectedClientSnapshot(clientSessions?.selectedClientId);
  }, [clientSessions?.selectedClientId, desktopBridgeAvailable, refreshSelectedClientSnapshot]);

  useEffect(() => {
    if (!packetConsoleOpen) return;
    void refreshRelayLog();
    void refreshConsoleCommandState();
  }, [packetConsoleOpen, refreshConsoleCommandState, refreshRelayLog]);

  useEffect(() => {
    if (!desktopBridgeAvailable) return;
    if (selectedPlugin.id !== "multi-account" && !packetConsoleOpen && !mimicState?.enabled) return;
    const timer = window.setInterval(() => {
      void refreshMimicState();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [desktopBridgeAvailable, mimicState?.enabled, packetConsoleOpen, refreshMimicState, selectedPlugin.id]);

  useEffect(() => {
    relayLogRef.current = relayLog;
  }, [relayLog]);

  useEffect(
    () => () => {
      if (packetListScrollFrameRef.current !== null) window.cancelAnimationFrame(packetListScrollFrameRef.current);
      if (packetConsoleScrollFrameRef.current !== null) window.cancelAnimationFrame(packetConsoleScrollFrameRef.current);
    },
    [],
  );

  const exportVisiblePacketLog = useCallback(() => {
    if (visiblePacketEntries.length === 0) {
      setPacketExportMessage("No visible packet rows to export.");
      return;
    }
    const body = visiblePacketEntries.map((entry) => relayEntryPlain(entry, relayLog?.updatedAt)).join("\n");
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `habbpy-v4-packets-${stamp}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
    setPacketExportMessage(`Prepared export for ${visiblePacketEntries.length} visible rows.`);
  }, [relayLog?.updatedAt, visiblePacketEntries]);

  const runRuntimeAction = useCallback(
    async (action: EngineRuntimeAction) => {
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        setRuntimeMessage("Start the embedded client before using actions.");
        return;
      }
      setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, action);
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", result.message);
        await refreshRuntimeSnapshot();
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  const setEmbeddedRoomZoom = useCallback(
    async (scale: 1 | 2) => {
      const normalized = scale === 2 ? 2 : 1;
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        if (normalized === 1) setGameZoom(1);
        setRuntimeMessage("Start the embedded client before using room zoom.");
        return;
      }
      setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, { kind: "setRoomStageZoom", scale: normalized });
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", result.message);
        if (result.ok) setGameZoom(normalized);
        await refreshRuntimeSnapshot();
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  useEffect(() => {
    if (!privateRoomReady && gameZoom !== 1) void setEmbeddedRoomZoom(1);
  }, [gameZoom, privateRoomReady, setEmbeddedRoomZoom]);

  const sendGardeningAction = useCallback(
    async (action: GardeningRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Gardening packets.";
        setGardeningMessage(message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendGardeningRelayAction(action, targetClientId);
      setGardeningMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendFishingAction = useCallback(
    async (action: FishingRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Fishing packets.";
        setFishingMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendFishingRelayAction(action, targetClientId);
      setFishingMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendFishingStart = useCallback(async () => {
    const areaId = objectNumericId(selectedFishingAreaRow?.item);
    if (areaId === null) {
      const message = "Enter a fishing room and select a parsed fishing area first.";
      setFishingMessage(message);
      appendTimeline("warning", message);
      return;
    }
    await sendFishingAction({ action: "startFishing", areaId }, `Fishing start ${areaId}`);
  }, [appendTimeline, selectedFishingAreaRow, sendFishingAction]);

  const sendPresentCatcherPacket = useCallback(
    async (packet: PluginPacketInput, label: string) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Present Catcher packets.";
        setPresentCatcherMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const result = await window.habbpyV4.sendPluginPacket(packet, selectedClientId);
      setPresentCatcherMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot(["core", "room", "inventory"]).catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const usePresentCatcherFloorItem = useCallback(
    async (row: ItemRow, mode: "hammer" | "present") => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before using Present Catcher actions.";
        setPresentCatcherMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const objectId = objectNumericId(row.item);
      const tile = itemRowTile(row);
      if (objectId === null || !tile) {
        const message = "Selected target is missing a numeric object id or tile.";
        setPresentCatcherMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }

      const moveTarget = mode === "hammer"
        ? { x: tile.x, y: tile.y, furniId: objectId }
        : { ...(adjacentTileForItem(row, itemRows, userRows, selfUser) ?? { x: tile.x, y: tile.y + 1 }), furniId: 0 };
      const move = await window.habbpyV4.sendRoomRelayAction(
        { action: "move", x: moveTarget.x, y: moveTarget.y, furniId: moveTarget.furniId },
        selectedClientId,
      );
      appendTimeline(move.ok ? "success" : "warning", `Present Catcher move: ${move.message}`);
      if (!move.ok) {
        setPresentCatcherMessage(move.message);
        await refreshRelayLog().catch(() => null);
        return move;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const used = await window.habbpyV4.sendFurniRelayAction({ action: "useFloorItem", objectId, value: "0" }, selectedClientId);
      setPresentCatcherMessage(used.message);
      appendTimeline(used.ok ? "success" : "warning", `${mode === "hammer" ? "Collect Hammer" : "Use Present"}: ${used.message}`);
      await Promise.all([refreshRuntimeSnapshot(["core", "room", "inventory"]).catch(() => null), refreshRelayLog().catch(() => null)]);
      return used;
    },
    [appendTimeline, itemRows, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId, selfUser, userRows],
  );

  const runPresentCatcherStep = useCallback(
    async (auto = false) => {
      if (presentCatcherActionInFlightRef.current) return;
      const panicSet = new Set(presentCatcherPanicNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
      const panicHit = userRows.find((user) => panicSet.has(userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName).trim().toLowerCase()));
      if (panicHit) {
        setPresentCatcherRunning(false);
        const name = userDisplayName(panicHit, selectedRuntimeSnapshot?.userState?.sessionUserName);
        await sendPresentCatcherPacket({ header: 53 }, `Panic leave for ${name}`);
        setPresentCatcherMessage(`Stopped because panic user ${name} is in the room.`);
        return;
      }
      const target = presentHammerRows[0] ? { row: presentHammerRows[0], mode: "hammer" as const } : presentRows[0] ? { row: presentRows[0], mode: "present" as const } : null;
      if (!target) {
        setPresentCatcherMessage(auto ? "Watching current room; no hammers or event presents parsed." : "No hammers or event presents parsed in this room.");
        return;
      }
      presentCatcherActionInFlightRef.current = true;
      try {
        await usePresentCatcherFloorItem(target.row, target.mode);
      } finally {
        presentCatcherActionInFlightRef.current = false;
      }
    },
    [
      presentCatcherPanicNames,
      presentHammerRows,
      presentRows,
      selectedRuntimeSnapshot?.userState?.sessionUserName,
      sendPresentCatcherPacket,
      usePresentCatcherFloorItem,
      userRows,
    ],
  );

  useEffect(() => {
    if (!presentCatcherRunning) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      if (cancelled) return;
      await runPresentCatcherStep(true).catch((error) => {
        setPresentCatcherMessage(error instanceof Error ? error.message : String(error));
        appendTimeline("warning", `Present Catcher: ${error instanceof Error ? error.message : String(error)}`);
      });
      if (!cancelled) timer = window.setTimeout(tick, 1800);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [appendTimeline, presentCatcherRunning, runPresentCatcherStep]);

  const requestPresentCatcherInventory = useCallback(async () => {
    await runRuntimeAction({ kind: "requestInventory" });
    await refreshRuntimeSnapshot(["core", "inventory"]).catch(() => null);
  }, [refreshRuntimeSnapshot, runRuntimeAction]);

  const placeSelectedPresentGift = useCallback(async () => {
    const item = selectedPresentGiftRow;
    const token = compactValue(item?.itemId ?? item?.rowId).trim();
    if (!item || !token || token === "-") {
      const message = "Select an inventory gift token first.";
      setPresentCatcherMessage(message);
      appendTimeline("warning", message);
      return;
    }
    try {
      const selfTile = userTile(selfUser);
      const x = cleanInteger(presentPlaceX, selfTile ? selfTile.x + 1 : 0);
      const y = cleanInteger(presentPlaceY, selfTile ? selfTile.y : 0);
      const direction = cleanInteger(presentPlaceDirection, 2);
      setPresentPlaceX(String(x));
      setPresentPlaceY(String(y));
      setPresentPlaceDirection(String(direction));
      const bodyBytes = [...latin1ByteArray(token), ...shockwaveVl64ByteArray(x), ...shockwaveVl64ByteArray(y), ...shockwaveVl64ByteArray(direction)];
      const result = await sendPresentCatcherPacket({ header: 90, bodyBytes }, `Place gift ${token}`);
      const decodedId = decodeShockwaveVl64Text(token);
      const fallbackId = finiteNumber(item.objectId ?? item.slotId ?? item.itemId);
      const openId = decodedId !== null ? Math.abs(decodedId) : fallbackId !== null ? Math.trunc(Math.abs(fallbackId)) : null;
      if (result.ok && openId) setPresentOpenObjectId(String(openId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPresentCatcherMessage(message);
      appendTimeline("warning", `Present gift place: ${message}`);
    }
  }, [
    appendTimeline,
    presentPlaceDirection,
    presentPlaceX,
    presentPlaceY,
    selectedPresentGiftRow,
    selfUser,
    sendPresentCatcherPacket,
  ]);

  const openPresentObject = useCallback(async () => {
    const objectId = cleanPositiveInt(presentOpenObjectId, 0);
    if (!objectId) {
      const message = "Enter a placed present object id first.";
      setPresentCatcherMessage(message);
      appendTimeline("warning", message);
      return;
    }
    await sendPresentCatcherPacket({ header: 78, bodyText: String(objectId) }, `Open present ${objectId}`);
  }, [appendTimeline, presentOpenObjectId, sendPresentCatcherPacket]);

  const sendPresentFragmentPacket = useCallback(
    async (kind: "request" | "backpack" | "trade" | "add" | "accept" | "cancel") => {
      const eventName = presentFragmentEvent.trim() || "second_anniversary";
      if (kind === "request") {
        await sendPresentCatcherPacket({ header: 3400, bodyBytes: shockwaveOutgoingStringByteArray(eventName) }, `Request fragments ${eventName}`);
        return;
      }
      if (kind === "backpack") {
        await sendPresentCatcherPacket({ header: 1240 }, "Request backpack");
        return;
      }
      if (kind === "trade") {
        const target = presentFragmentTradeTarget.trim();
        if (!target) {
          setPresentCatcherMessage("Enter a receiver room index before opening a fragment trade.");
          return;
        }
        await sendPresentCatcherPacket(
          { header: 3403, bodyBytes: [...shockwaveOutgoingStringByteArray(eventName), ...shockwaveOutgoingStringByteArray(target)] },
          `Trade fragments with ${target}`,
        );
        return;
      }
      if (kind === "add") {
        const slotId = cleanPositiveInt(presentFragmentSlotId, 0);
        if (!slotId) {
          setPresentCatcherMessage("Enter a fragment slot id before adding a fragment.");
          return;
        }
        await sendPresentCatcherPacket({ header: 3404, bodyBytes: shockwaveVl64ByteArray(slotId) }, `Add fragment slot ${slotId}`);
        return;
      }
      if (kind === "accept") {
        await sendPresentCatcherPacket({ header: 3402, bodyBytes: shockwaveVl64ByteArray(1) }, "Accept fragment trade");
        return;
      }
      await sendPresentCatcherPacket({ header: 3401 }, "Cancel fragment trade");
    },
    [presentFragmentEvent, presentFragmentSlotId, presentFragmentTradeTarget, sendPresentCatcherPacket],
  );

  const sendUserAction = useCallback(
    async (action: UserRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending User packets.";
        setRuntimeMessage(message);
        return;
      }
      setRuntimeBusy(true);
      try {
        const targetClientId = clientId ?? selectedClientId;
        const result = await window.habbpyV4.sendUserRelayAction(action, targetClientId);
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
        await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendSocialAction = useCallback(
    async (action: SocialRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Social packets.";
        setSocialMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendSocialRelayAction(action, targetClientId);
      setSocialMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendWallMoverAction = useCallback(
    async (action: WallMoverRelayAction, label: string, clientId?: number) => {
      if (!window.habbpyV4) {
        const message = "Run the Electron shell before sending Wall Mover packets.";
        setWallMoverMessage(message);
        appendTimeline("warning", message);
        return { ok: false, message };
      }
      const targetClientId = clientId ?? selectedClientId;
      const result = await window.habbpyV4.sendWallMoverRelayAction(action, targetClientId);
      setWallMoverMessage(result.message);
      appendTimeline(result.ok ? "success" : "warning", `${label}: ${result.message}`);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    },
    [appendTimeline, refreshRelayLog, refreshRuntimeSnapshot, selectedClientId],
  );

  const sendWallMoverMove = useCallback(
    async (dx: number, dy: number, orientationOverride?: "l" | "r") => {
      const row = selectedWallMoverRow;
      const itemId = objectNumericId(row?.item);
      const location = wallMoverLocation(row?.item);
      const step = Math.max(1, Math.min(50, Math.trunc(Number.parseInt(wallMoverStep, 10) || 1)));
      setWallMoverStep(String(step));
      if (!row || itemId === null || !location) {
        const message = "Select a wall item with parsed wall/local coordinates first.";
        setWallMoverMessage(message);
        appendTimeline("warning", message);
        return;
      }
      const orientation = orientationOverride ?? location.orientation;
      const action: WallMoverRelayAction = {
        action: "moveItem",
        itemId,
        wallX: location.wallX,
        wallY: location.wallY,
        localX: location.localX + dx * step,
        localY: location.localY + dy * step,
        orientation,
        className: compactValue(row.item.className ?? row.item.name),
      };
      await sendWallMoverAction(action, `Wall move item ${itemId}`);
    },
    [appendTimeline, selectedWallMoverRow, sendWallMoverAction, wallMoverStep],
  );

  const sendWallMoverPickup = useCallback(async () => {
    const row = selectedWallMoverRow;
    const itemId = objectNumericId(row?.item);
    if (!row || itemId === null) {
      const message = "Select a wall item before pickup.";
      setWallMoverMessage(message);
      appendTimeline("warning", message);
      return;
    }
    await sendWallMoverAction(
      {
        action: "pickup",
        itemId,
        className: compactValue(row.item.className ?? row.item.name),
      },
      `Wall pickup item ${itemId}`,
    );
  }, [appendTimeline, selectedWallMoverRow, sendWallMoverAction]);

  const startGardeningJobForRow = useCallback(
    async (row: ItemRow, queue: readonly string[], mode: "cycle" | "compost", completed: number) => {
      const objectId = objectNumericId(row.item);
      const tile = itemRowTile(row);
      const working = workingTileNearSelf(selfUser, row, itemRows, userRows);
      if (objectId === null || !tile || !working) {
        setGardeningJob({
          plantKey: row.key,
          objectId: objectId ?? -1,
          originalX: tile?.x ?? 0,
          originalY: tile?.y ?? 0,
          originalDirection: tile?.direction ?? 0,
          workingX: working?.x ?? 0,
          workingY: working?.y ?? 0,
          phase: "failed",
          mode,
          queue,
          sentAt: Date.now(),
          moveAttempts: 0,
          actionAttempts: 0,
          completed,
          note: "Plant id, current tile, or avatar tile is missing from room data.",
          baselineState: compactValue(row.item.state),
        });
        return;
      }
      const sent = await sendGardeningAction(
        { action: "move", objectId, x: working.x, y: working.y, direction: tile.direction },
        `Move plant ${objectId}`,
      );
      setGardeningJob({
        plantKey: row.key,
        objectId,
        originalX: tile.x,
        originalY: tile.y,
        originalDirection: tile.direction,
        workingX: working.x,
        workingY: working.y,
        phase: sent.ok ? "move_out" : "failed",
        mode,
        queue,
        sentAt: Date.now(),
        moveAttempts: 1,
        actionAttempts: 0,
        completed,
        note: sent.ok ? `Moving ${objectId} to ${working.x},${working.y}.` : sent.message,
        baselineState: compactValue(row.item.state),
      });
      setGardeningRunning(sent.ok);
    },
    [itemRows, selfUser, sendGardeningAction, userRows],
  );

  const startGardening = useCallback(
    async (mode: "cycle" | "compost") => {
      if (!roomReady) {
        setGardeningMessage("Enter Codex Test Lab before starting Gardening.");
        return;
      }
      const ordered = selectedPlantRow ? [selectedPlantRow, ...plantRows.filter((row) => row.key !== selectedPlantRow.key)] : plantRows;
      const first = ordered[0];
      if (!first) {
        setGardeningMessage("No plant-like room objects are available.");
        return;
      }
      setGardeningRunning(true);
      const cycleSec = Math.max(30, Math.trunc(finiteNumber(gardeningCycleSec) ?? 600));
      setGardeningCycleSec(String(cycleSec));
      setGardeningMessage(`${mode === "compost" ? "Compost All" : "Gardening"} started for ${ordered.length} plant(s).`);
      await startGardeningJobForRow(first, ordered.slice(1).map((row) => row.key), mode, 0);
    },
    [gardeningCycleSec, plantRows, roomReady, selectedPlantRow, startGardeningJobForRow],
  );

  const stopGardening = useCallback(() => {
    setGardeningRunning(false);
    setGardeningJob((current) => (current ? { ...current, phase: "idle", note: "Stopped by user." } : null));
    setGardeningMessage("Gardening stopped.");
  }, []);

  useEffect(() => {
    if (!gardeningRunning || !gardeningJob || gardeningJob.phase === "idle" || gardeningJob.phase === "failed") return;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const now = Date.now();
        const elapsed = now - gardeningJob.sentAt;
        const currentRow = findCurrentPlantRow(plantRows, gardeningJob.objectId);
        const currentTile = itemRowTile(currentRow);
        const currentState = compactValue(currentRow?.item.state);
        const atWorking = currentTile?.x === gardeningJob.workingX && currentTile?.y === gardeningJob.workingY;
        const atOriginal = currentTile?.x === gardeningJob.originalX && currentTile?.y === gardeningJob.originalY;

        if (!currentRow || !currentTile) {
          setGardeningJob((current) => current && current.objectId === gardeningJob.objectId ? { ...current, phase: "failed", note: "Plant disappeared from room objects." } : current);
          setGardeningRunning(false);
          return;
        }

        if (gardeningJob.phase === "move_out") {
          if (atWorking && elapsed >= 350) {
            const nextAction = gardeningJob.mode === "compost" ? "compost" : "water";
            const sent = await sendGardeningAction({ action: nextAction, objectId: gardeningJob.objectId }, `${nextAction} plant ${gardeningJob.objectId}`);
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? {
                    ...current,
                    phase: sent.ok ? nextAction : "failed",
                    sentAt: Date.now(),
                    actionAttempts: 1,
                    baselineState: currentState,
                    note: sent.ok ? `${nextAction} sent for ${gardeningJob.objectId}.` : sent.message,
                  }
                : current,
            );
            if (!sent.ok) setGardeningRunning(false);
            return;
          }
          if (elapsed >= 3000) {
            if (gardeningJob.moveAttempts >= 3) {
              setGardeningJob((current) => current && current.objectId === gardeningJob.objectId ? { ...current, phase: "failed", note: "Move out failed after 3 attempts." } : current);
              setGardeningRunning(false);
              return;
            }
            const sent = await sendGardeningAction(
              { action: "move", objectId: gardeningJob.objectId, x: gardeningJob.workingX, y: gardeningJob.workingY, direction: gardeningJob.originalDirection },
              `Retry move plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? { ...current, sentAt: Date.now(), moveAttempts: current.moveAttempts + 1, note: sent.message }
                : current,
            );
          }
          return;
        }

        if (gardeningJob.phase === "compost" || gardeningJob.phase === "water" || gardeningJob.phase === "harvest") {
          const changed = currentState !== gardeningJob.baselineState;
          const actionTimeout = gardeningJob.phase === "compost" ? 2000 : 2500;
          const shouldProceed =
            changed ||
            (gardeningJob.phase === "compost" && elapsed >= actionTimeout) ||
            (gardeningJob.phase === "water" && elapsed >= actionTimeout && gardeningJob.actionAttempts >= 2) ||
            (gardeningJob.phase === "harvest" && elapsed >= actionTimeout && gardeningJob.actionAttempts >= 2);

          if (gardeningJob.phase === "water" && (changed || elapsed >= actionTimeout)) {
            if (!changed && gardeningJob.actionAttempts < 2) {
              const sent = await sendGardeningAction({ action: "water", objectId: gardeningJob.objectId }, `Retry water plant ${gardeningJob.objectId}`);
              setGardeningJob((current) =>
                current && current.objectId === gardeningJob.objectId
                  ? { ...current, sentAt: Date.now(), actionAttempts: current.actionAttempts + 1, note: sent.message }
                  : current,
              );
              return;
            }
            const sent = await sendGardeningAction({ action: "harvest", objectId: gardeningJob.objectId }, `Harvest plant ${gardeningJob.objectId}`);
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? {
                    ...current,
                    phase: sent.ok ? "harvest" : "failed",
                    sentAt: Date.now(),
                    actionAttempts: 1,
                    baselineState: currentState,
                    note: sent.ok ? `Harvest sent for ${gardeningJob.objectId}.` : sent.message,
                  }
                : current,
            );
            if (!sent.ok) setGardeningRunning(false);
            return;
          }

          if (shouldProceed) {
            const sent = await sendGardeningAction(
              {
                action: "move",
                objectId: gardeningJob.objectId,
                x: gardeningJob.originalX,
                y: gardeningJob.originalY,
                direction: gardeningJob.originalDirection,
              },
              `Return plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? {
                    ...current,
                    phase: sent.ok ? "return" : "failed",
                    sentAt: Date.now(),
                    moveAttempts: 1,
                    note: sent.ok ? `Returning ${gardeningJob.objectId} to ${gardeningJob.originalX},${gardeningJob.originalY}.` : sent.message,
                  }
                : current,
            );
            if (!sent.ok) setGardeningRunning(false);
          } else if (elapsed >= actionTimeout && gardeningJob.actionAttempts < 2) {
            const sent = await sendGardeningAction(
              { action: gardeningJob.phase, objectId: gardeningJob.objectId },
              `Retry ${gardeningJob.phase} plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? { ...current, sentAt: Date.now(), actionAttempts: current.actionAttempts + 1, note: sent.message }
                : current,
            );
          }
          return;
        }

        if (gardeningJob.phase === "return") {
          if (atOriginal) {
            const nextKey = gardeningJob.queue[0];
            const nextRow = nextKey ? plantRows.find((row) => row.key === nextKey) : null;
            if (nextRow) {
              await startGardeningJobForRow(nextRow, gardeningJob.queue.slice(1), gardeningJob.mode, gardeningJob.completed + 1);
            } else {
              setGardeningJob((current) =>
                current && current.objectId === gardeningJob.objectId
                  ? { ...current, phase: "complete", completed: current.completed + 1, note: "Cycle complete; all queued plants returned." }
                  : current,
              );
              setGardeningRunning(false);
              setGardeningMessage(`Gardening cycle complete. Completed ${gardeningJob.completed + 1} plant(s).`);
            }
            return;
          }
          if (elapsed >= 3000) {
            if (gardeningJob.moveAttempts >= 3) {
              setGardeningJob((current) => current && current.objectId === gardeningJob.objectId ? { ...current, phase: "failed", note: "Return failed after 3 attempts." } : current);
              setGardeningRunning(false);
              return;
            }
            const sent = await sendGardeningAction(
              {
                action: "move",
                objectId: gardeningJob.objectId,
                x: gardeningJob.originalX,
                y: gardeningJob.originalY,
                direction: gardeningJob.originalDirection,
              },
              `Retry return plant ${gardeningJob.objectId}`,
            );
            setGardeningJob((current) =>
              current && current.objectId === gardeningJob.objectId
                ? { ...current, sentAt: Date.now(), moveAttempts: current.moveAttempts + 1, note: sent.message }
                : current,
            );
          }
        }
      })();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [gardeningJob, gardeningRunning, plantRows, sendGardeningAction, startGardeningJobForRow]);

  const appendPacketConsole = useCallback((kind: PacketConsoleEntry["kind"], text: string) => {
    setPacketConsoleEntries((current) => {
      const next = [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: new Date().toLocaleTimeString(),
          kind,
          text,
        },
      ];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const executeConsoleRendererActions = useCallback(
    async (actions: readonly ConsoleRendererAction[], output: (kind: PacketConsoleEntry["kind"], text: string) => void = appendPacketConsole) => {
      if (actions.length === 0) return;
      setRuntimeBusy(true);
      try {
        for (const action of actions) {
          if (action.kind === "enterPrivateRoom") {
            const webview = await waitForVisibleClientWebview(action.clientId);
            if (!webview) {
              output("warning", `client${action.clientId}: visible runtime did not mount for room entry.`);
              continue;
            }
            const result = await runEngineRuntimeAction(webview, {
              kind: "enterPrivateRoom",
              flatId: action.flatId,
              waitUntilReady: action.reason !== "summon",
              timeoutMs: action.reason === "summon" ? 15000 : undefined,
            });
            output(result.ok ? "success" : "warning", `client${action.clientId}: ${result.message}`);
            if (result.ok) {
              const snapshot = await readEngineRuntimeSnapshot(webview, ["core", "room"]).catch(() => null);
              if (snapshot && action.clientId === selectedClientIdRef.current) applyRuntimeSnapshot(snapshot);
            }
            await refreshSelectedClientSnapshot(action.clientId, { updateSelectedSnapshot: action.clientId === selectedClientIdRef.current }).catch(() => null);
            await refreshClientSessions().catch(() => null);
          }
        }
      } finally {
        setRuntimeBusy(false);
      }
    },
    [
      appendPacketConsole,
      applyRuntimeSnapshot,
      refreshClientSessions,
      refreshSelectedClientSnapshot,
      waitForVisibleClientWebview,
    ],
  );

  const runMultiAccountCommand = useCallback(
    async (input: string): Promise<void> => {
      if (!window.habbpyV4?.runConsoleCommand) {
        setMultiAccountMessage("Desktop bridge is not available.");
        return;
      }
      const busInput = withVisibleConsoleContext(input, selectedClientIsVisible ? selectedRuntimeSnapshot : null, visibleActiveAccountNames);
      const result = await window.habbpyV4.runConsoleCommand(busInput);
      const actionCount = result.rendererActions?.length ?? 0;
      const message = [result.lines.join("\n"), actionCount > 0 ? `${actionCount} visible runtime action(s) queued.` : ""].filter(Boolean).join("\n");
      setMultiAccountMessage(message);
      appendTimeline(result.ok ? "success" : "warning", message || redactConsoleCommandInput(input));
      await refreshConsoleCommandState().catch(() => null);
      const sessions = await refreshClientSessions().catch(() => null);
      await refreshMimicState().catch(() => null);
      const nextSelectedClientId = sessions?.selectedClientId ?? clientSessions?.selectedClientId;
      await refreshSelectedClientSnapshot(nextSelectedClientId).catch(() => null);
      if (actionCount > 0) {
        await executeConsoleRendererActions(result.rendererActions ?? [], (kind, text) => {
          appendTimeline(kind === "success" ? "success" : kind === "error" ? "error" : "warning", text);
          setMultiAccountMessage((current) => `${current}\n${text}`.trim());
        });
      }
      if (commandRefreshesEngineLaunch(result.command?.command ?? "", result.command?.args[0] ?? "")) {
        const launch = await window.habbpyV4.getEngineLaunchState().catch(() => null);
        if (launch) applyEngineLaunch(launch);
      }
    },
    [
      appendTimeline,
      applyEngineLaunch,
      clientSessions?.selectedClientId,
      executeConsoleRendererActions,
      refreshClientSessions,
      refreshConsoleCommandState,
      refreshMimicState,
      refreshSelectedClientSnapshot,
      selectedClientIsVisible,
      selectedRuntimeSnapshot,
      visibleActiveAccountNames,
    ],
  );

  const addManualVisibleClient = useCallback(async () => {
    openMultiAccountPanel();
    await runMultiAccountCommand("newclient");
  }, [openMultiAccountPanel, runMultiAccountCommand]);

  const consoleBindingMap = useMemo(
    () => new globalThis.Map((consoleCommandState?.bindings ?? []).map((binding) => [binding.key, binding.command] as const)),
    [consoleCommandState?.bindings],
  );

  useEffect(() => {
    if (consoleBindingMap.size === 0 || !window.habbpyV4?.runConsoleBinding) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isTextEntryTarget(event.target)) return;
      const key = bindingKeyFromKeyboardEvent(event);
      if (!key || key === "Backquote") return;
      const boundCommand = consoleBindingMap.get(key);
      if (!boundCommand) return;
      event.preventDefault();
      setPacketConsoleOpen(true);
      appendPacketConsole("command", `[${key}] ${redactConsoleCommandInput(boundCommand)}`);
      void (async () => {
        const result = await window.habbpyV4?.runConsoleBinding?.(key);
        if (!result) return;
        for (const line of result.lines) appendPacketConsole(result.level, line);
        await refreshConsoleCommandState().catch(() => null);
        await refreshClientSessions().catch(() => null);
        await refreshSelectedClientSnapshot(result.targetClientIds?.[0] ?? clientSessions?.selectedClientId).catch(() => null);
        if ((result.rendererActions?.length ?? 0) > 0) {
          await executeConsoleRendererActions(result.rendererActions ?? []);
        }
        if (commandRefreshesEngineLaunch(result.command?.command ?? "", result.command?.args[0] ?? "")) {
          const launch = await window.habbpyV4?.getEngineLaunchState().catch(() => null);
          if (launch) applyEngineLaunch(launch);
        }
      })();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    appendPacketConsole,
    applyEngineLaunch,
    clientSessions?.selectedClientId,
    consoleBindingMap,
    executeConsoleRendererActions,
    refreshClientSessions,
    refreshConsoleCommandState,
    refreshSelectedClientSnapshot,
  ]);

  const runConsoleRuntimeAction = useCallback(
    async (action: EngineRuntimeAction): Promise<EngineRuntimeActionResult> => {
      const webview = webviewRef.current;
      if (!webview || !engineUrl) return { ok: false, message: "Start the embedded client first." };
      setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, action);
        setRuntimeMessage(result.message);
        appendTimeline(result.ok ? "success" : "warning", result.message);
        await refreshRuntimeSnapshot();
        return result;
      } finally {
        setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  userPluginLogHandlerRef.current = (plugin, level, message) => {
    const severity = level === "error" ? "error" : level === "warning" ? "warning" : "info";
    appendTimeline(severity, `${plugin.name}: ${message}`);
  };

  userPluginRequestHandlerRef.current = async (plugin, request) => {
    const pluginEnabled = pluginEnabledById[plugin.id] !== false;
    if (!pluginEnabled && !isDisabledPluginCleanupRequest(request.api)) {
      throw new Error(`${plugin.name} is disabled.`);
    }
    const args = request.args && typeof request.args === "object" ? (request.args as Record<string, unknown>) : {};
    const fullSnapshotForClient = async (clientId: number): Promise<EngineRuntimeSnapshot | null> => {
      if (clientId === selectedClientIdRef.current) return selectedRuntimeSnapshotRef.current;
      return null;
    };
    const runtimeSummaryForClient = async (clientId: number): Promise<ClientRuntimeSummary | null> => {
      const cached = clientPluginSnapshotsById.get(clientId)?.runtimeSummary;
      if (cached) return cached;
      const snapshot = await window.habbpyV4?.getClientSnapshot(clientId);
      return snapshot?.runtime ?? null;
    };
    if (request.api === "storage.get") {
      requirePluginPermission(plugin, ["storage"]);
      const raw = localStorage.getItem(pluginStorageKey(plugin.id, args.key));
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (request.api === "storage.set") {
      requirePluginPermission(plugin, ["storage"]);
      localStorage.setItem(pluginStorageKey(plugin.id, args.key), JSON.stringify(args.value ?? null));
      return true;
    }
    if (request.api === "storage.delete") {
      requirePluginPermission(plugin, ["storage"]);
      localStorage.removeItem(pluginStorageKey(plugin.id, args.key));
      return true;
    }
    if (request.api === "engine.getSnapshot") {
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const requestedClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (requestedClientId === selectedClientIdRef.current) return selectedRuntimeSnapshotRef.current;
      const snapshot = await window.habbpyV4?.getClientSnapshot(requestedClientId);
      return snapshot?.runtime ?? null;
    }
    if (request.api === "session.getClients") {
      requirePluginPermission(plugin, ["events.session"]);
      return {
        selectedClientId: clientSessionsRef.current?.selectedClientId ?? selectedClientIdRef.current,
        mainClientId: clientSessionsRef.current?.mainClientId ?? 1,
        clients: clientSessionsRef.current?.sessions ?? [],
      };
    }
    if (
      request.api === "client.getRights" ||
      request.api === "client.setRights" ||
      request.api === "client.grantRights" ||
      request.api === "client.removeRights" ||
      request.api === "client.enableChooserCommands"
    ) {
      requirePluginPermission(plugin, ["client.rights"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Client rights APIs currently target the selected visible runtime.");
      }
      const mode: "get" | "set" | "grant" | "remove" =
        request.api === "client.getRights" ? "get" :
        request.api === "client.setRights" ? "set" :
        request.api === "client.removeRights" ? "remove" :
        "grant";
      const rights = request.api === "client.enableChooserCommands"
        ? ["fuse_habbo_chooser", "fuse_furni_chooser"]
        : cleanPluginRightsList(args.rights);
      if (mode !== "get" && rights.length === 0) {
        throw new Error(`${request.api} requires at least one right.`);
      }
      const result = await runConsoleRuntimeAction({ kind: "clientRights", mode, rights });
      if (!result.ok) throw new Error(result.message);
      if (mode !== "get") await refreshRuntimeSnapshot().catch(() => null);
      return result;
    }
    if (request.api === "chat.send") {
      requirePluginPermission(plugin, ["chat.send"]);
      const message = String(args.message ?? "").trim();
      if (!message) throw new Error("chat.send requires a non-empty message.");
      if (message.length > 240) throw new Error("chat.send messages are limited to 240 characters.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("chat.send can only target the selected visible client until validated relay chat packets are enabled.");
      }
      const result = await runConsoleRuntimeAction({ kind: "sendChat", message });
      if (!result.ok) throw new Error(result.message);
      return result;
    }
    if (request.api === "stage.click") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Stage clicks can only target the selected visible client.");
      }
      const result = await runConsoleRuntimeAction({
        kind: "stageClick",
        x: cleanInteger(args.x, 0),
        y: cleanInteger(args.y, 0),
      });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.walkTo") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for avatar movement.");
      const options = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
      const result = await window.habbpyV4.sendRoomRelayAction(
        {
          action: "move",
          x: cleanInteger(args.x, 0),
          y: cleanInteger(args.y, 0),
          furniId: cleanInteger(args.furniId ?? options.furniId, 0),
        },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.walkToItem") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      requirePluginPermission(plugin, ["engine.snapshot"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for avatar movement.");
      const target = pluginWalkTargetFromSnapshot(selectedRuntimeSnapshotRef.current, args.selector, furniMetadata);
      if (!target) throw new Error("avatar.walkToItem could not resolve a floor item by id, name, class, or search text.");
      const options = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
      const furniId = options.useFurniId === false ? 0 : cleanInteger(options.furniId ?? args.furniId, target.furniId);
      const result = await window.habbpyV4.sendRoomRelayAction(
        { action: "move", x: target.x, y: target.y, furniId },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, target };
    }
    if (request.api === "rooms.enterPrivateRoom") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Private room entry through plugin engine control can only target the selected visible client.");
      }
      const flatId = String(args.flatId ?? "").trim();
      const result = await runConsoleRuntimeAction({ kind: "enterPrivateRoom", flatId: flatId || undefined, waitUntilReady: true });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "rooms.enterPublicRoom") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Public room entry through plugin engine control can only target the selected visible client.");
      }
      const result = await runConsoleRuntimeAction({ kind: "enterPublicRoom", query: String(args.query ?? "").trim() || undefined });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "navigator.open") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Navigator control can only target the selected visible client.");
      }
      const result = await runConsoleRuntimeAction({ kind: "openNavigator", view: String(args.view ?? "nav_pr") });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "windows.clickElement") {
      requirePluginPermission(plugin, ["engine.control"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      if (targetClientId !== selectedClientIdRef.current) {
        throw new Error("Window element clicks can only target the selected visible client.");
      }
      const windowId = String(args.windowId ?? "").trim();
      const elementId = String(args.elementId ?? "").trim();
      if (!windowId || !elementId) throw new Error("windows.clickElement requires windowId and elementId.");
      const result = await runConsoleRuntimeAction({ kind: "clickWindowElement", windowId, elementId });
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.wave") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "wave" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.dance") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "dance", number: cleanPositiveInt(args.number, 1) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.stopDance") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "stopDance" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.hcDance") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "hcdance", number: cleanPositiveInt(args.number, 1) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.carryDrink") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "carryDrink" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "avatar.applyLook") {
      requirePluginPermission(plugin, ["actions.avatar"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for user action.");
      const figure = String(args.figure ?? "").trim();
      if (!figure) throw new Error("avatar.applyLook requires a figure string.");
      const result = await window.habbpyV4.sendUserRelayAction({ action: "applyLook", figure }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.message") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for social message.");
      const result = await window.habbpyV4.sendSocialRelayAction(
        { action: "message", accountId: cleanPositiveInt(args.accountId, 0), message: String(args.message ?? ""), recipient: String(args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>).recipient ?? "" : "") },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.addUser") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for friend request.");
      const result = await window.habbpyV4.sendSocialRelayAction({ action: "addUser", name: String(args.name ?? "") }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.refreshRequests") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for friend requests.");
      const result = await window.habbpyV4.sendSocialRelayAction({ action: "refreshFriendRequests" }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "social.acceptRequest" || request.api === "social.declineRequest" || request.api === "social.removeFriend" || request.api === "social.followFriend") {
      requirePluginPermission(plugin, ["actions.social"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for social action.");
      const accountId = cleanPositiveInt(args.accountId, 0);
      const socialAction: SocialRelayAction =
        request.api === "social.acceptRequest" ? { action: "acceptRequest", accountId } :
        request.api === "social.declineRequest" ? { action: "declineRequest", accountId } :
        request.api === "social.removeFriend" ? { action: "removeFriend", accountId } :
        { action: "followFriend", accountId };
      const result = await window.habbpyV4.sendSocialRelayAction(socialAction, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "plants.movePlant") {
      requirePluginPermission(plugin, ["actions.plants"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for plant movement.");
      const result = await window.habbpyV4.sendGardeningRelayAction(
        { action: "move", objectId: cleanPositiveInt(args.objectId, 0), x: cleanInteger(args.x, 0), y: cleanInteger(args.y, 0), direction: cleanInteger(args.direction, 0) },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "plants.waterPlant" || request.api === "plants.harvestPlant" || request.api === "plants.compostPlant") {
      requirePluginPermission(plugin, ["actions.plants"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for plant action.");
      const action = request.api === "plants.waterPlant" ? "water" : request.api === "plants.harvestPlant" ? "harvest" : "compost";
      const result = await window.habbpyV4.sendGardeningRelayAction({ action, objectId: cleanPositiveInt(args.objectId, 0) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "wallItems.moveItem") {
      requirePluginPermission(plugin, ["actions.wallItems"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall item movement.");
      const item = args.item && typeof args.item === "object" ? args.item as Record<string, unknown> : {};
      const result = await window.habbpyV4.sendWallMoverRelayAction(
        {
          action: "moveItem",
          itemId: cleanPositiveInt(item.itemId, 0),
          wallX: cleanInteger(item.wallX, 0),
          wallY: cleanInteger(item.wallY, 0),
          localX: cleanInteger(item.localX, 0),
          localY: cleanInteger(item.localY, 0),
          orientation: item.orientation === "r" ? "r" : "l",
          className: typeof item.className === "string" ? item.className : undefined,
        },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "wallItems.pickupItem") {
      requirePluginPermission(plugin, ["actions.wallItems"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall item pickup.");
      const result = await window.habbpyV4.sendWallMoverRelayAction({ action: "pickup", itemId: cleanPositiveInt(args.itemId, 0) }, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "furni.findItems" || request.api === "furni.findItem") {
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const options = args.options && typeof args.options === "object" ? (args.options as Record<string, unknown>) : {};
      const requestedKind = String(args.kind ?? options.kind ?? "all").trim().toLowerCase();
      const kind = requestedKind === "floor" || requestedKind === "wall" ? requestedKind : "all";
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const snapshot = await fullSnapshotForClient(targetClientId);
      if (!snapshot) throw new Error("furni.findItems needs the target client to be the selected rendered client so room object rows are available.");
      const rows = pluginFindItemRows(snapshot, args.selector, furniMetadata, kind);
      const items = rows.map((row) => pluginRuntimeItemPayload(row, furniMetadata));
      return request.api === "furni.findItem" ? items[0] ?? null : items;
    }
    if (request.api === "furni.moveFloorItem" || request.api === "furni.rotateFloorItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni movement.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.objectId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      const selectorTile = pluginSelectorTile(selector);
      const directX = finiteNumber(request.api === "furni.rotateFloorItem" ? selectorTile?.x : args.x ?? selectorTile?.x);
      const directY = finiteNumber(request.api === "furni.rotateFloorItem" ? selectorTile?.y : args.y ?? selectorTile?.y);
      const directDirection = finiteNumber(args.direction ?? selectorTile?.direction);
      const needsSnapshot = !directId || directX === null || directY === null || directDirection === null;
      if (needsSnapshot) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = needsSnapshot ? await fullSnapshotForClient(targetClientId) : null;
      const resolved = snapshot ? pluginResolveFloorItem(snapshot, selector, furniMetadata) : null;
      const objectId = directId ?? resolved?.id ?? null;
      if (!objectId) throw new Error(`${request.api} needs a floor item id or a selector that resolves to a floor item.`);
      const xValue = finiteNumber(directX ?? resolved?.tile.x);
      const yValue = finiteNumber(directY ?? resolved?.tile.y);
      const directionValue = finiteNumber(directDirection ?? resolved?.tile.direction);
      if (xValue === null || yValue === null) throw new Error(`${request.api} needs target tile x/y or a selector with a parsed tile.`);
      if (directionValue === null) throw new Error(`${request.api} needs a direction or a selector with current direction.`);
      const action: FurniRelayAction = {
        action: request.api === "furni.rotateFloorItem" ? "rotateFloorItem" : "moveFloorItem",
        objectId,
        x: Math.trunc(xValue),
        y: Math.trunc(yValue),
        direction: Math.trunc(directionValue),
        className: compactValue(resolved?.row.item.className),
      };
      const result = await window.habbpyV4.sendFurniRelayAction(action, targetClientId);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.pickupFloorItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni pickup.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.objectId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      if (!directId) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveFloorItem(snapshot, selector, furniMetadata) : null;
      const objectId = directId ?? resolved?.id ?? null;
      if (!objectId) throw new Error("furni.pickupFloorItem needs a floor item id or a selector that resolves to a floor item.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        { action: "pickupFloorItem", objectId, className: compactValue(resolved?.row.item.className) },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.useFloorItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni use.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.objectId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      if (!directId) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveFloorItem(snapshot, selector, furniMetadata) : null;
      const objectId = directId ?? resolved?.id ?? null;
      if (!objectId) throw new Error("furni.useFloorItem needs a floor item id or a selector that resolves to a floor item.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        { action: "useFloorItem", objectId, value: String(args.value ?? "0"), className: compactValue(resolved?.row.item.className) },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.moveWallItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall furni movement.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.item ?? args.itemId;
      const directId = pluginSelectorNumericId(selector);
      const directLocation = pluginSelectorWallLocation(selector, args.location);
      if (!directId || !directLocation) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId && directLocation ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveWallItem(snapshot, selector, furniMetadata) : null;
      const itemId = directId ?? resolved?.id ?? null;
      const location = directLocation ?? (resolved ? pluginWallMoveLocation(resolved.location, args.location) : null);
      if (!itemId) throw new Error("furni.moveWallItem needs a wall item id or a selector that resolves to a wall item.");
      if (!location) throw new Error("furni.moveWallItem needs wall/local/orientation coordinates or a selected wall item with parsed coordinates.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        {
          action: "moveWallItem",
          itemId,
          wallX: location.wallX,
          wallY: location.wallY,
          localX: location.localX,
          localY: location.localY,
          orientation: location.orientation,
          className: compactValue(resolved?.row.item.className),
        },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.pickupWallItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for wall furni pickup.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.itemId ?? args.item;
      const directId = pluginSelectorNumericId(selector);
      if (!directId) requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = directId ? null : await fullSnapshotForClient(targetClientId);
      const resolved = snapshot ? pluginResolveWallItem(snapshot, selector, furniMetadata) : null;
      const itemId = directId ?? resolved?.id ?? null;
      if (!itemId) throw new Error("furni.pickupWallItem needs a wall item id or a selector that resolves to a wall item.");
      const result = await window.habbpyV4.sendFurniRelayAction(
        { action: "pickupWallItem", itemId, className: compactValue(resolved?.row.item.className) },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
    }
    if (request.api === "furni.pickupItem") {
      requirePluginPermission(plugin, ["actions.furni"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for furni pickup.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const selector = args.selector ?? args.itemId ?? args.objectId ?? args.item;
      const kind = pluginSelectorKind(selector);
      if (kind === "floor") {
        const objectId = pluginSelectorNumericId(selector);
        if (!objectId) requirePluginPermission(plugin, ["engine.snapshot"]);
        const resolved = objectId ? null : pluginResolveFloorItem(await fullSnapshotForClient(targetClientId), selector, furniMetadata);
        const id = objectId ?? resolved?.id ?? null;
        if (!id) throw new Error("furni.pickupItem could not resolve a floor item id.");
        const result = await window.habbpyV4.sendFurniRelayAction({ action: "pickupFloorItem", objectId: id }, targetClientId);
        await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
        return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
      }
      if (kind === "wall") {
        const itemId = pluginSelectorNumericId(selector);
        if (!itemId) requirePluginPermission(plugin, ["engine.snapshot"]);
        const resolved = itemId ? null : pluginResolveWallItem(await fullSnapshotForClient(targetClientId), selector, furniMetadata);
        const id = itemId ?? resolved?.id ?? null;
        if (!id) throw new Error("furni.pickupItem could not resolve a wall item id.");
        const result = await window.habbpyV4.sendFurniRelayAction({ action: "pickupWallItem", itemId: id }, targetClientId);
        await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
        return { ...result, item: resolved ? pluginRuntimeItemPayload(resolved.row, furniMetadata) : null };
      }
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const snapshot = await fullSnapshotForClient(targetClientId);
      const row = pluginFindItemRows(snapshot, selector, furniMetadata, "all")[0];
      if (!row) throw new Error("furni.pickupItem needs item kind or a selector that resolves to a live room item.");
      const id = objectNumericId(row.item);
      if (!id) throw new Error("furni.pickupItem resolved item has no numeric id.");
      const action: FurniRelayAction = row.kind === "wall" ? { action: "pickupWallItem", itemId: id } : { action: "pickupFloorItem", objectId: id };
      const result = await window.habbpyV4.sendFurniRelayAction(action, targetClientId);
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, item: pluginRuntimeItemPayload(row, furniMetadata) };
    }
    if (request.api === "fishing.getState") {
      requirePluginPermission(plugin, ["engine.snapshot"]);
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const snapshot = await fullSnapshotForClient(targetClientId);
      const runtimeSummary = await runtimeSummaryForClient(targetClientId);
      const pluginSnapshot = clientPluginSnapshotsById.get(targetClientId);
      const rows = pluginFishingAreaRows(snapshot, furniMetadata);
      const target = pluginFishingAreaTarget(snapshot, args.areaId, furniMetadata);
      return {
        roomReady: snapshot ? Boolean(snapshot.roomReady?.ready ?? snapshot.roomEntryState?.roomReady?.ready) : runtimeSummary?.roomReady ?? false,
        selectedClientId: selectedClientIdRef.current,
        clientId: targetClientId,
        hasFullRuntimeSnapshot: Boolean(snapshot),
        userCount: snapshot?.userState?.roomUserCount ?? snapshot?.roomObjects?.counts.users ?? runtimeSummary?.userCount ?? null,
        occupants: pluginRoomOccupantsPayload(snapshot),
        target: target?.area ?? null,
        walkTarget: target ? { x: target.x, y: target.y, furniId: target.furniId, label: target.label } : null,
        areas: rows.map((row) => pluginFishingAreaPayload(row, furniMetadata)),
        packet: pluginSnapshot?.packetFishing ?? null,
      };
    }
    if (request.api === "fishing.walkToArea") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      requirePluginPermission(plugin, ["actions.avatar"]);
      requirePluginPermission(plugin, ["engine.snapshot"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing movement.");
      const targetClientId = requestedPluginClientId(args, selectedClientIdRef.current);
      const snapshot = await fullSnapshotForClient(targetClientId);
      if (!snapshot) throw new Error("fishing.walkToArea needs the target client to be the selected rendered client so room object tiles are available.");
      const target = pluginFishingAreaTarget(snapshot, args.areaId, furniMetadata);
      if (!target) throw new Error("fishing.walkToArea could not resolve a parsed fishing area with tile coordinates.");
      const result = await window.habbpyV4.sendRoomRelayAction(
        { action: "move", x: target.x, y: target.y, furniId: target.furniId },
        targetClientId,
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return { ...result, target };
    }
    if (request.api === "fishing.startFishing") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const result = await window.habbpyV4.sendFishingRelayAction(
        { action: "startFishing", areaId: cleanPositiveInt(args.areaId, 0) },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "fishing.minigameInput") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const direction = String(args.direction ?? "").trim().toUpperCase();
      if (direction !== "L" && direction !== "R") throw new Error("fishing.minigameInput direction must be L or R.");
      const result = await window.habbpyV4.sendFishingRelayAction(
        { action: "minigameInput", direction },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "fishing.purchaseProduct") {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const productCode = String(args.productCode ?? args.code ?? "").trim();
      const result = await window.habbpyV4.sendFishingRelayAction(
        { action: "purchaseProduct", productCode },
        requestedPluginClientId(args, selectedClientIdRef.current),
      );
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (
      request.api === "fishing.registerDerby" ||
      request.api === "fishing.requestTokens" ||
      request.api === "fishing.requestProducts" ||
      request.api === "fishing.requestRodLevel" ||
      request.api === "fishing.requestStats" ||
      request.api === "fishing.requestFishopedia"
    ) {
      requirePluginPermission(plugin, ["actions.fishing"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for Fishing action.");
      const action: FishingRelayAction =
        request.api === "fishing.registerDerby" ? { action: "registerDerby" } :
        request.api === "fishing.requestTokens" ? { action: "requestTokens" } :
        request.api === "fishing.requestProducts" ? { action: "requestProducts" } :
        request.api === "fishing.requestRodLevel" ? { action: "requestRodLevel" } :
        request.api === "fishing.requestStats" ? { action: "requestStats" } :
        { action: "requestFishopedia" };
      const result = await window.habbpyV4.sendFishingRelayAction(action, requestedPluginClientId(args, selectedClientIdRef.current));
      await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
      return result;
    }
    if (request.api === "packets.send") {
      requirePluginPermission(plugin, ["packet.inject"]);
      if (!window.habbpyV4) throw new Error("Desktop bridge unavailable for packet send.");
      const result = await window.habbpyV4.sendPluginPacket(args.packet as PluginPacketInput, requestedPluginClientId(args, selectedClientIdRef.current));
      await refreshRelayLog().catch(() => null);
      return result;
    }
    if (request.api === "console.registerCommand") {
      requirePluginPermission(plugin, ["console.commands"]);
      return { ok: false, message: "Plugin console command registration is reserved for the command registry phase." };
    }
    if (request.api === "ui.registerPanel") {
      requirePluginPermission(plugin, ["ui.panel"]);
      return { ok: false, message: "Plugin-rendered custom panels are reserved for the panel renderer phase." };
    }
    throw new Error(`Unknown plugin host API: ${request.api}`);
  };

  useEffect(() => {
    if (!window.habbpyV4?.readPluginEntrySource) return undefined;
    const host = new RendererUserPluginHost({
      readEntrySource: (pluginId) => window.habbpyV4!.readPluginEntrySource(pluginId),
      handleRequest: (plugin, request) => userPluginRequestHandlerRef.current(plugin, request),
      log: (plugin, level, message) => userPluginLogHandlerRef.current(plugin, level, message),
    });
    userPluginHostRef.current = host;
    return () => {
      host.dispose();
      if (userPluginHostRef.current === host) userPluginHostRef.current = null;
    };
  }, []);

  useEffect(() => {
    userPluginHostRef.current?.sync(availablePlugins, pluginEnabledById);
  }, [availablePlugins, pluginEnabledById]);

  useEffect(() => {
    userPluginHostRef.current?.dispatchEvent("session.selected", {
      clientId: selectedClientId,
      session: selectedClientSession,
      mainClientId: clientSessions?.mainClientId ?? 1,
    });
  }, [clientSessions?.mainClientId, selectedClientId, selectedClientSession]);

  useEffect(() => {
    if (!selectedRuntimeSnapshot) return;
    userPluginHostRef.current?.dispatchEvent("runtime.snapshot", {
      clientId: selectedClientId,
      room: pluginRoomPayload(selectedRuntimeSnapshot),
      snapshot: selectedRuntimeSnapshot,
    });
  }, [selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    const snapshot = selectedRuntimeSnapshot;
    const currentRoomKey = pluginRoomKey(snapshot);
    if (!host || !snapshot || !roomReady || !currentRoomKey) {
      userPluginRoomUsersRef.current = null;
      return;
    }
    const sessionName = snapshot.userState?.sessionUserName ?? null;
    const usersByKey = new globalThis.Map<string, ReturnType<typeof pluginRuntimeUserPayload>>();
    for (const user of snapshot.userState?.users ?? []) {
      usersByKey.set(pluginRuntimeUserKey(user, sessionName), pluginRuntimeUserPayload(user, sessionName));
    }
    const room = pluginRoomPayload(snapshot);
    const previous = userPluginRoomUsersRef.current;
    if (!previous || previous.roomKey !== currentRoomKey) {
      userPluginRoomUsersRef.current = { roomKey: currentRoomKey, usersByKey };
      host.dispatchEvent("room.changed", { clientId: selectedClientId, room });
      host.dispatchEvent("room.ready", { clientId: selectedClientId, room });
      host.dispatchEvent("room.users", { ...pluginRoomUsersPayload(snapshot, selectedClientId), initial: true });
      return;
    }
    for (const [key, user] of usersByKey) {
      if (previous.usersByKey.has(key)) continue;
      host.dispatchEvent("room.userJoined", { clientId: selectedClientId, room, user, initial: false });
    }
    for (const [key, user] of previous.usersByKey) {
      if (usersByKey.has(key)) continue;
      host.dispatchEvent("room.userLeft", { clientId: selectedClientId, room, user });
    }
    userPluginRoomUsersRef.current = { roomKey: currentRoomKey, usersByKey };
  }, [roomReady, selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    const snapshot = selectedRuntimeSnapshot;
    const currentRoomKey = pluginRoomKey(snapshot);
    if (!host || !snapshot || !roomReady || !currentRoomKey) {
      userPluginRoomObjectsRef.current = null;
      return;
    }

    const room = pluginRoomPayload(snapshot);
    const itemsByKey = pluginRoomObjectRecords(snapshot, furniMetadata);
    const objectPayload = pluginRoomObjectsPayload(snapshot, selectedClientId, furniMetadata);
    const previous = userPluginRoomObjectsRef.current;
    if (!previous || previous.roomKey !== currentRoomKey) {
      userPluginRoomObjectsRef.current = { roomKey: currentRoomKey, itemsByKey };
      host.dispatchEvent("room.items", { ...objectPayload, initial: true });
      host.dispatchEvent("room.floorItemsLoaded", {
        clientId: selectedClientId,
        room,
        items: objectPayload.floorItems,
        floorItems: objectPayload.floorItems,
        initial: true,
      });
      host.dispatchEvent("room.wallItemsLoaded", {
        clientId: selectedClientId,
        room,
        items: objectPayload.wallItems,
        wallItems: objectPayload.wallItems,
        initial: true,
      });
      return;
    }

    let changed = false;
    for (const [key, record] of itemsByKey) {
      const previousRecord = previous.itemsByKey.get(key);
      if (!previousRecord) {
        changed = true;
        dispatchPluginRoomItemEvent(host, "Added", selectedClientId, room, record.payload);
        continue;
      }
      if (previousRecord.signature !== record.signature) {
        changed = true;
        dispatchPluginRoomItemEvent(host, "Updated", selectedClientId, room, record.payload, previousRecord.payload);
      }
    }
    for (const [key, previousRecord] of previous.itemsByKey) {
      if (itemsByKey.has(key)) continue;
      changed = true;
      dispatchPluginRoomItemEvent(host, "Removed", selectedClientId, room, previousRecord.payload);
    }
    if (changed) {
      host.dispatchEvent("room.items", { ...objectPayload, initial: false });
    }
    userPluginRoomObjectsRef.current = { roomKey: currentRoomKey, itemsByKey };
  }, [furniMetadata, roomReady, selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    const snapshot = selectedRuntimeSnapshot;
    const currentRoomKey = pluginRoomKey(snapshot);
    if (!host || !snapshot || !currentRoomKey) {
      userPluginChatRef.current = null;
      return;
    }
    const room = pluginRoomPayload(snapshot);
    const entriesByKey = new globalThis.Map<string, RuntimeChatEntry>();
    for (let index = 0; index < chatHistory.length; index += 1) {
      const entry = chatHistory[index]!;
      entriesByKey.set(chatEntryKey(entry, index), entry);
    }
    const previous = userPluginChatRef.current;
    if (!previous || previous.roomKey !== currentRoomKey) {
      userPluginChatRef.current = { roomKey: currentRoomKey, keys: new globalThis.Set(entriesByKey.keys()) };
      return;
    }
    for (const [key, entry] of entriesByKey) {
      if (previous.keys.has(key)) continue;
      host.dispatchEvent("chat.message", pluginChatPayload(entry, selectedClientId, room));
    }
    userPluginChatRef.current = { roomKey: currentRoomKey, keys: new globalThis.Set(entriesByKey.keys()) };
  }, [chatHistory, selectedClientId, selectedRuntimeSnapshot]);

  useEffect(() => {
    const host = userPluginHostRef.current;
    if (!host || !relayLog) return;
    const cursor = userPluginPacketCursorRef.current;
    if (!cursor.initialized || cursor.logPath !== relayLog.logPath) {
      userPluginPacketCursorRef.current = {
        logPath: relayLog.logPath,
        lineNumber: relayLog.totalLines,
        initialized: true,
      };
      return;
    }
    let nextLineNumber = cursor.lineNumber;
    for (const entry of relayLog.entries) {
      if (entry.lineNumber <= cursor.lineNumber || entry.header === null) continue;
      nextLineNumber = Math.max(nextLineNumber, entry.lineNumber);
      const packet = pluginRelayPacketPayload(entry, relayLog.updatedAt);
      host.dispatchEvent("packet", packet);
      if (packet.direction === "client" || packet.direction === "server") {
        host.dispatchEvent(`packet.${packet.direction}`, packet);
      }
    }
    if (nextLineNumber !== cursor.lineNumber) {
      userPluginPacketCursorRef.current = {
        logPath: relayLog.logPath,
        lineNumber: nextLineNumber,
        initialized: true,
      };
    }
  }, [relayLog]);

  const executePacketConsoleCommand = useCallback(async () => {
    const raw = packetConsoleInput.trim();
    if (!raw) return;
    setPacketConsoleInput("");
    setPacketConsoleHistoryIndex(null);
    appendPacketConsole("command", redactConsoleCommandInput(raw));

    let commandInput = raw.replace(/^\//, "");
    let commandParts = commandInput.split(/\s+/).filter(Boolean);
    let command = (commandParts[0] ?? "").toLowerCase();
    let parts: readonly string[] = commandParts.slice(1);
    let rest = commandInput.slice(commandParts[0]?.length ?? 0).trim();
    let targetClientIds: readonly number[] = [clientSessions?.selectedClientId ?? 1];
    if (window.habbpyV4?.runConsoleCommand) {
      const busInput = withVisibleConsoleContext(raw, selectedClientIsVisible ? selectedRuntimeSnapshot : null, visibleActiveAccountNames);
      const busResult = await window.habbpyV4.runConsoleCommand(busInput);
      await refreshConsoleCommandState().catch(() => null);
      for (const line of busResult.lines) appendPacketConsole(busResult.level, line);
      if (busResult.handled) {
        await refreshClientSessions().catch(() => null);
        await refreshSelectedClientSnapshot(busResult.targetClientIds?.[0] ?? clientSessions?.selectedClientId).catch(() => null);
        if ((busResult.rendererActions?.length ?? 0) > 0) {
          await executeConsoleRendererActions(busResult.rendererActions ?? []);
        }
        if (commandRefreshesEngineLaunch(busResult.command?.command ?? "", busResult.command?.args[0] ?? "")) {
          const launch = await window.habbpyV4.getEngineLaunchState().catch(() => null);
          if (launch) applyEngineLaunch(launch);
        }
        return;
      }
      if (!busResult.ok) return;
      const busCommand = busResult.command?.command ?? "";
      const relayBackedCommand = isRelayBackedConsoleCommand(busCommand);
      if ((busResult.targetClientIds?.length ?? 0) !== 1 && !relayBackedCommand) {
        appendPacketConsole("warning", "This command needs exactly one target client in the current single-view phase.");
        return;
      }
      if (!relayBackedCommand && busResult.targetClientIds?.[0] !== (clientSessions?.selectedClientId ?? 1)) {
        appendPacketConsole("warning", `client${busResult.targetClientIds?.[0] ?? "-"} is not the selected visible client yet.`);
        return;
      }
      if (!relayBackedCommand && !selectedClientIsVisible) {
        appendPacketConsole("warning", `client${clientSessions?.selectedClientId ?? 1} is headless; this command needs a visible runtime.`);
        return;
      }
      commandInput = busResult.passthroughInput ?? busResult.command?.inputWithoutTarget ?? commandInput;
      commandParts = busResult.command ? [busResult.command.command, ...busResult.command.args] : commandInput.split(/\s+/).filter(Boolean);
      command = busResult.command?.command ?? (commandParts[0] ?? "").toLowerCase();
      parts = busResult.command?.args ?? commandParts.slice(1);
      rest = parts.join(" ");
      targetClientIds = busResult.targetClientIds ?? targetClientIds;
    }
    const runtime = selectedRuntimeSnapshot;
    const refreshSelectedRuntime = async () => (selectedClientIsVisible ? await refreshRuntimeSnapshot().catch(() => null) : null);
    const sendSocialToTargets = async (action: SocialRelayAction, label: string) => {
      for (const clientId of targetClientIds) {
        const result = await sendSocialAction(action, label, clientId);
        const prefix = targetClientIds.length > 1 ? `client${clientId}: ` : "";
        appendPacketConsole(result.ok ? "success" : "warning", `${prefix}${result.message}`);
      }
    };

    if (command === "help" || command === "?") {
      appendPacketConsole(
        "info",
        "commands: help, clear, packets <filter|all|selected|client id>, list, select <id>, newclient, load <file> <count> --headless, mimic status|on|off|source <id>, enterroom <flat-id>, room, user, lookup <name>, rooms <query>, say <message>, input [client] <message>, wave, dance <1-4>, carrydrink, message <user|id> <message>, adduser <name>, requests, accept <request>, decline <request>, follow <friend>, removefriend <friend>, walk <x> <y>, fps [limit], perf, gpu",
      );
      return;
    }
    if (command === "clear") {
      setPacketConsoleEntries([]);
      return;
    }
    if (command === "packets" || command === "filter") {
      const mode = (parts[0] ?? "").toLowerCase();
      if (mode === "all" || mode === "clients") {
        setPacketConsoleClientFilter("All");
        appendPacketConsole("success", "packet client filter set to all clients");
        return;
      }
      if (mode === "selected") {
        const selected = String(clientSessions?.selectedClientId ?? 1);
        setPacketConsoleClientFilter(selected);
        appendPacketConsole("success", `packet client filter set to client${selected}`);
        return;
      }
      if (mode === "client" || mode === "c") {
        const nextClient = normalizePacketClientFilter(parts[1] ?? "All", packetClientChoices);
        setPacketConsoleClientFilter(nextClient);
        appendPacketConsole("success", nextClient === "All" ? "packet client filter set to all clients" : `packet client filter set to client${nextClient}`);
        return;
      }
      if (/^(?:client)?\d+$/i.test(parts[0] ?? "")) {
        const nextClient = normalizePacketClientFilter(parts[0] ?? "All", packetClientChoices);
        setPacketConsoleClientFilter(nextClient);
        appendPacketConsole("success", nextClient === "All" ? "packet client filter set to all clients" : `packet client filter set to client${nextClient}`);
        return;
      }
      setPacketConsoleQuery(rest);
      appendPacketConsole("success", rest ? `packet filter set to "${rest}"` : "packet filter cleared");
      return;
    }
    if (command === "say" || command === "chat") {
      if (!rest) {
        appendPacketConsole("warning", "usage: say <message>");
        return;
      }
      const result = await runConsoleRuntimeAction({ kind: "sendChat", message: rest });
      appendPacketConsole(result.ok ? "success" : "warning", result.message);
      return;
    }
    if (command === "message" || command === "msg" || command === "pm") {
      const target = parts[0] ?? "";
      const message = rest.slice(target.length).trim();
      if (!target || !message) {
        appendPacketConsole("warning", "usage: message <friend-name-or-account-id> <message>");
        return;
      }
      if (!window.habbpyV4) {
        appendPacketConsole("warning", "desktop bridge unavailable for private message");
        return;
      }
      let accountId = Number.parseInt(target, 10);
      const normalizedTarget = target.toLowerCase();
      if (!Number.isInteger(accountId) || accountId <= 0) {
        const runtimeUser = userRows.find((entry) =>
          runtimeUserMatchesLookup(entry, normalizedTarget, target, selectedRuntimeSnapshot?.userState?.sessionUserName),
        );
        const packetUser =
          packetProfileIndex.byName.get(normalizedTarget) ??
          packetProfileIndex.byAccountId.get(target) ??
          packetProfileIndex.users.find((entry) => packetUserMatchesLookup(entry, normalizedTarget, target));
        const friend = packetInfoState.friends.find(
          (entry) => packetFriendMatchesLookup(entry, normalizedTarget, target),
        );
        const request = packetInfoState.friendRequests.find(
          (entry) => packetFriendRequestMatchesLookup(entry, normalizedTarget, target),
        );
        for (const candidate of [runtimeUser?.accountId, packetUser?.accountId, friend?.accountId, request?.accountId]) {
          const resolvedId = Number.parseInt(compactValue(candidate), 10);
          if (Number.isInteger(resolvedId) && resolvedId > 0) {
            accountId = resolvedId;
            break;
          }
        }
      }
      if (!Number.isInteger(accountId) || accountId <= 0) {
        const lookup = await window.habbpyV4.lookupOriginsUser(target);
        const lookupId = Number.parseInt(lookup.id, 10);
        if (Number.isInteger(lookupId) && lookupId > 0) {
          accountId = lookupId;
        } else {
          appendPacketConsole("warning", `message target needs a numeric account id or parsed friend row; lookup id=${lookup.id || "-"}`);
          return;
        }
      }
      await sendSocialToTargets({ action: "message", accountId, recipient: target, message }, "Private message");
      return;
    }
    if (command === "adduser" || command === "friend") {
      const name = rest.trim();
      if (!name) {
        appendPacketConsole("warning", "usage: adduser <habbo-name>");
        return;
      }
      if (!window.habbpyV4) {
        appendPacketConsole("warning", "desktop bridge unavailable for friend request");
        return;
      }
      await sendSocialToTargets({ action: "addUser", name }, `Friend request ${name}`);
      return;
    }
    if (command === "requests" || command === "friendrequests" || command === "refreshrequests") {
      await sendSocialToTargets({ action: "refreshFriendRequests" }, "Refresh friend requests");
      return;
    }
    if (command === "accept" || command === "acceptfriend") {
      const target = rest.trim();
      const request = findPacketFriendRequestForAction(packetInfoState.friendRequests, target);
      if (!request) {
        appendPacketConsole("warning", target ? `friend request not found: ${target}` : "usage: accept <request-name-or-account-id>");
        return;
      }
      const accountId = packetFriendRequestActionId(request);
      if (accountId === null) {
        appendPacketConsole("warning", `friend request ${request.name} has no numeric account id`);
        return;
      }
      await sendSocialToTargets({ action: "acceptRequest", accountId }, `Accept request ${request.name}`);
      return;
    }
    if (command === "decline" || command === "declinefriend") {
      const target = rest.trim();
      const request = findPacketFriendRequestForAction(packetInfoState.friendRequests, target);
      if (!request) {
        appendPacketConsole("warning", target ? `friend request not found: ${target}` : "usage: decline <request-name-or-account-id>");
        return;
      }
      const accountId = packetFriendRequestActionId(request);
      if (accountId === null) {
        appendPacketConsole("warning", `friend request ${request.name} has no numeric account id`);
        return;
      }
      await sendSocialToTargets({ action: "declineRequest", accountId }, `Decline request ${request.name}`);
      return;
    }
    if (command === "follow" || command === "followfriend") {
      const target = rest.trim();
      if (!target) {
        appendPacketConsole("warning", "usage: follow <friend-name-or-account-id>");
        return;
      }
      const friend = findPacketFriendForAction(packetInfoState.friends, target);
      const accountId = parsePositiveSocialAccountId(target) ?? (friend ? packetFriendActionId(friend) : null);
      if (accountId === null) {
        appendPacketConsole("warning", `friend not found with numeric account id: ${target}`);
        return;
      }
      await sendSocialToTargets(
        { action: "followFriend", accountId, name: friend?.name ?? target },
        `Follow friend ${friend?.name ?? target}`,
      );
      return;
    }
    if (command === "removefriend" || command === "unfriend") {
      const target = rest.trim();
      if (!target) {
        appendPacketConsole("warning", "usage: removefriend <friend-name-or-account-id>");
        return;
      }
      const friend = findPacketFriendForAction(packetInfoState.friends, target);
      const accountId = parsePositiveSocialAccountId(target) ?? (friend ? packetFriendActionId(friend) : null);
      if (accountId === null) {
        appendPacketConsole("warning", `friend not found with numeric account id: ${target}`);
        return;
      }
      await sendSocialToTargets(
        { action: "removeFriend", accountId, name: friend?.name ?? target },
        `Remove friend ${friend?.name ?? target}`,
      );
      return;
    }
    if (command === "walk" || command === "stageclick") {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        appendPacketConsole("warning", "usage: walk <stage-x> <stage-y>");
        return;
      }
      const result = await runConsoleRuntimeAction({ kind: "stageClick", x, y });
      appendPacketConsole(result.ok ? "success" : "warning", result.message);
      return;
    }
    if (command === "room") {
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      appendPacketConsole(
        "info",
        `room=${runtimeRoomName(snapshot)} id=${runtimeRoomId(snapshot)} type=${runtimeRoomType(snapshot)} ready=${compactValue(snapshot?.roomReady?.ready ?? snapshot?.roomEntryState?.roomReady?.ready)} users=${compactValue(snapshot?.userState?.roomUserCount ?? snapshot?.roomReady?.roomLikeSpriteCount)}`,
      );
      return;
    }
    if (command === "user") {
      appendPacketConsole(
        "info",
        `user=${selectedUserName} account=${selectedUserAccountId} pos=${selectedUserPosition} figure=${selectedUserFigure}`,
      );
      return;
    }
    if (command === "lookup") {
      const name = rest || selectedUserName;
      if (!name || name === "-") {
        appendPacketConsole("warning", "usage: lookup <habbo-name>");
        return;
      }
      if (!window.habbpyV4) {
        appendPacketConsole("warning", "desktop bridge unavailable for Origins public lookup");
        return;
      }
      const rawToken = name.trim();
      const normalizedToken = rawToken.toLowerCase();
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      const runtimeMatches: RuntimeUserSummary[] = [];
      const seenRuntimeUsers = new Set<string>();
      for (const user of [...(snapshot?.userState?.users ?? []), ...(snapshot?.roomObjects?.users ?? [])]) {
        if (!runtimeUserMatchesLookup(user, normalizedToken, rawToken, snapshot?.userState?.sessionUserName)) continue;
        const key = [
          compactValue(user.accountId),
          compactValue(user.roomIndex ?? user.rowId),
          userDisplayName(user, snapshot?.userState?.sessionUserName).toLowerCase(),
        ].join(":");
        if (seenRuntimeUsers.has(key)) continue;
        seenRuntimeUsers.add(key);
        runtimeMatches.push(user);
      }
      const packetMatches: PacketProfileUser[] = [];
      const seenPacketUsers = new Set<string>();
      for (const user of packetProfileIndex.users) {
        if (!packetUserMatchesLookup(user, normalizedToken, rawToken)) continue;
        const key = [compactValue(user.accountId), compactValue(user.index), user.name.toLowerCase()].join(":");
        if (seenPacketUsers.has(key)) continue;
        seenPacketUsers.add(key);
        packetMatches.push(user);
      }
      const friendMatches = packetInfoState.friends.filter((entry) => packetFriendMatchesLookup(entry, normalizedToken, rawToken));
      const requestMatches = packetInfoState.friendRequests.filter((entry) => packetFriendRequestMatchesLookup(entry, normalizedToken, rawToken));
      const localAccountIds = new Set<string>();
      for (const user of runtimeMatches) {
        const accountIdValue = compactValue(user.accountId);
        if (accountIdValue !== "-") localAccountIds.add(accountIdValue);
      }
      for (const user of packetMatches) {
        if (user.accountId !== "-") localAccountIds.add(user.accountId);
      }
      for (const friend of friendMatches) {
        if (friend.accountId !== "-") localAccountIds.add(friend.accountId);
      }
      for (const request of requestMatches) {
        if (request.accountId !== "-") localAccountIds.add(request.accountId);
      }
      for (const user of runtimeMatches.slice(0, 3)) appendPacketConsole("info", runtimeLookupLine(user, snapshot));
      for (const user of packetMatches.slice(-3)) appendPacketConsole("info", packetProfileLookupLine(user));
      for (const friend of friendMatches.slice(0, 3)) {
        appendPacketConsole("info", `friend: ${packetFriendTitle(friend)} / ${packetFriendMeta(friend)} / line=${friend.sourceLine}`);
      }
      for (const request of requestMatches.slice(0, 3)) appendPacketConsole("info", friendRequestLookupLine(request));
      const recentMessages = localAccountIds.size > 0
        ? packetInfoState.privateMessages.filter((entry) => localAccountIds.has(entry.senderAccountId)).slice(-3)
        : [];
      for (const message of recentMessages) {
        appendPacketConsole(
          "info",
          `private message: from=${message.senderAccountId} sent=${compactValue(message.sentAt)} text=${compactValue(message.text)} line=${message.sourceLine}`,
        );
      }
      if (runtimeMatches.length === 0 && packetMatches.length === 0 && friendMatches.length === 0 && requestMatches.length === 0) {
        appendPacketConsole("info", `in-game: no runtime, USERS, friend, or request match for ${rawToken}`);
      }
      const result = await window.habbpyV4.lookupOriginsUser(name);
      appendPacketConsole(result.ok ? "success" : "warning", originsLookupLine(result, name));
      return;
    }
    if (command === "rooms") {
      const opened = await runConsoleRuntimeAction({ kind: "openNavigator", view: "nav_pr" });
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      const query = rest.toLowerCase();
      const rooms = (snapshot?.navigator?.publicRoomNodes ?? [])
        .filter((entry) => !query || [entry.name, entry.unitStrId, entry.id, entry.port].some((value) => String(value ?? "").toLowerCase().includes(query)))
        .slice(0, 6);
      if (rooms.length === 0) {
        appendPacketConsole(opened.ok ? "warning" : "error", opened.ok ? "no matching public rooms loaded yet" : opened.message);
        return;
      }
      appendPacketConsole("success", rooms.map((entry) => `${compactValue(entry.name)} id=${compactValue(entry.id)} unit=${compactValue(entry.unitStrId)}`).join(" | "));
      return;
    }
    if (command === "fps" || command === "perf") {
      const snapshot = (await refreshSelectedRuntime()) ?? runtime;
      const stats = snapshot?.performanceStats;
      appendPacketConsole(
        "info",
        `fps=${compactValue(stats?.rafPerSecond ?? stats?.rafRate)} tempo=${compactValue(stats?.frameTempo)} director=${compactValue(stats?.directorTicksPerSecond ?? stats?.directorTickRate)} worstRafMs=${compactValue(finiteNumber(stats?.worstRafDeltaMs))}`,
      );
      if (command === "fps" && parts[0]) {
        appendPacketConsole("warning", "runtime FPS limit changes are not available yet.");
      }
      return;
    }
    if (command === "gpu") {
      const active = appPreferences?.hardwareAccelerationActive ?? true;
      const preferred = appPreferences?.hardwareAcceleration ?? true;
      const switches = appPreferences?.gpuLaunchSwitches.join(", ") || "none";
      const restart = appPreferences?.hardwareAccelerationRestartRequired ? " restart required" : " active";
      appendPacketConsole(
        appPreferences?.hardwareAccelerationRestartRequired ? "warning" : "info",
        `hardwareAcceleration=${active ? "on" : "off"} preference=${preferred ? "on" : "off"} state=${restart} launchSwitches=${switches}`,
      );
      return;
    }

    appendPacketConsole("warning", `unknown command "${command}". type help`);
  }, [
    appendPacketConsole,
    appPreferences,
    applyEngineLaunch,
    clientSessions?.selectedClientId,
    executeConsoleRendererActions,
    packetConsoleInput,
    packetInfoState.friendRequests,
    packetInfoState.friends,
    packetInfoState.privateMessages,
    packetClientChoices,
    packetProfileIndex,
    refreshRelayLog,
    refreshClientSessions,
    refreshConsoleCommandState,
    refreshSelectedClientSnapshot,
    refreshRuntimeSnapshot,
    runConsoleRuntimeAction,
    sendSocialAction,
    selectedClientIsVisible,
    selectedRuntimeSnapshot,
    selectedUserAccountId,
    selectedUserFigure,
    selectedUserName,
    selectedUserPosition,
    visibleActiveAccountNames,
    userRows,
  ]);

  const hideBulletinBoard = useCallback(
    async (mode: "auto" | "manual") => {
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        const message = "Start the embedded client before hiding the Bulletin Board.";
        setAutomationMessage(message);
        if (mode === "manual") appendTimeline("warning", message);
        return;
      }
      if (mode === "manual") setRuntimeBusy(true);
      try {
        const result = await runEngineRuntimeAction(webview, { kind: "hideBulletinBoard" });
        const message = mode === "auto" ? `Auto-hide Bulletin: ${result.message}` : result.message;
        setAutomationMessage(message);
        if (result.ok && result.result && typeof result.result === "object" && "closed" in result.result && (result.result as { closed?: unknown }).closed === false) {
          return;
        }
        appendTimeline(result.ok ? "success" : "warning", message);
        await refreshRuntimeSnapshot();
      } finally {
        if (mode === "manual") setRuntimeBusy(false);
      }
    },
    [appendTimeline, engineUrl, refreshRuntimeSnapshot, selectedClientId],
  );

  const copyUserValue = useCallback(
    async (label: string, value: unknown) => {
      const text = compactValue(value);
      if (text === "-") {
        const message = `${label} is not exposed by the current room user data.`;
        setUserToolMessage(message);
        appendTimeline("warning", message);
        return;
      }
      const copied = await writeClipboardText(text);
      const message = copied ? `Copied ${label}.` : `Clipboard is unavailable for ${label}.`;
      setUserToolMessage(message);
      appendTimeline(copied ? "success" : "warning", message);
    },
    [appendTimeline],
  );

  const lookupPublicUser = useCallback(async () => {
    const name = publicLookupName.trim() || selectedUserName;
    if (!name || name === "-") {
      setPublicLookupResult({
        ok: false,
        query: "",
        source: "official-origins-public-api",
        id: "",
        name: "",
        figureString: "",
        motto: "",
        memberSince: "",
        profileVisible: null,
        selectedBadges: [],
        message: "Enter a Habbo name to look up.",
      });
      return;
    }
    if (!window.habbpyV4) {
      setPublicLookupResult({
        ok: false,
        query: name,
        source: "official-origins-public-api",
        id: "",
        name,
        figureString: "",
        motto: "",
        memberSince: "",
        profileVisible: null,
        selectedBadges: [],
        message: "Desktop bridge is not available in browser preview.",
      });
      return;
    }
    setPublicLookupBusy(true);
    try {
      const result = await window.habbpyV4.lookupOriginsUser(name);
      setPublicLookupResult(result);
      if (!publicLookupName.trim() && result.name) setPublicLookupName(result.name);
      appendTimeline(result.ok ? "success" : "warning", result.message);
    } finally {
      setPublicLookupBusy(false);
    }
  }, [appendTimeline, publicLookupName, selectedUserName]);

  const lookupMissingVisitorProfiles = useCallback(async () => {
    const missing = filteredVisitorEntries
      .filter((entry) => entry.accountId === "-" && entry.name && entry.name !== "-")
      .map((entry) => entry.name.trim())
      .filter(Boolean);
    const uniqueNames = [...new Set(missing.map((name) => name.toLowerCase()))]
      .map((lowerName) => missing.find((name) => name.toLowerCase() === lowerName) ?? lowerName);

    if (uniqueNames.length === 0) {
      const message = "No visitors need public profile lookup.";
      setVisitorLookupMessage(message);
      appendTimeline("info", message);
      return;
    }
    if (!window.habbpyV4) {
      const message = "Desktop bridge is not available for public visitor lookup.";
      setVisitorLookupMessage(message);
      appendTimeline("warning", message);
      return;
    }

    setVisitorLookupBusy(true);
    let found = 0;
    try {
      const updates: Record<string, OriginsUserLookupResult> = {};
      for (const name of uniqueNames) {
        const result = await window.habbpyV4.lookupOriginsUser(name);
        updates[name.toLowerCase()] = result;
        if (result.ok && result.id) found += 1;
      }
      setVisitorPublicProfiles((current) => ({ ...current, ...updates }));
      const message = `Public lookup checked ${uniqueNames.length} visitor${uniqueNames.length === 1 ? "" : "s"}; ${found} id${found === 1 ? "" : "s"} found.`;
      setVisitorLookupMessage(message);
      appendTimeline(found > 0 ? "success" : "warning", message);
    } finally {
      setVisitorLookupBusy(false);
    }
  }, [appendTimeline, filteredVisitorEntries]);

  const copySelectedUserProfile = useCallback(async () => {
    if (!selectedUser) {
      const message = "No room user is selected.";
      setUserToolMessage(message);
      appendTimeline("warning", message);
      return;
    }
    const profile = [
      `Name: ${selectedUserName}`,
      `Account: ${selectedUserAccountId}`,
      `Index: ${selectedUserIndex}`,
      `Gender: ${selectedUserGender}`,
      `Type: ${selectedUserType}`,
      `Badge: ${selectedUserBadgeCode}`,
      `Motto: ${selectedUserMotto}`,
      `Position: ${selectedUserPosition}`,
      `Direction: ${compactValue(selectedUser.direction)}`,
      `Figure: ${selectedUserFigure}`,
      `PH Figure: ${selectedUserPoolFigure}`,
    ].join("\n");
    const copied = await writeClipboardText(profile);
    const message = copied ? "Copied selected user profile snapshot." : "Clipboard is unavailable for the profile snapshot.";
    setUserToolMessage(message);
    appendTimeline(copied ? "success" : "warning", message);
  }, [
    appendTimeline,
    selectedUser,
    selectedUserAccountId,
    selectedUserBadgeCode,
    selectedUserFigure,
    selectedUserGender,
    selectedUserIndex,
    selectedUserMotto,
    selectedUserName,
    selectedUserPoolFigure,
    selectedUserPosition,
    selectedUserType,
  ]);

  const storeSelectedUserLook = useCallback(() => {
    if (!selectedUser || selectedUserFigure === "-") {
      const message = "Selected user figure is not exposed by the current room data.";
      setUserToolMessage(message);
      appendTimeline("warning", message);
      return;
    }
    setUserStoredLooks((current) => [selectedUserFigure, ...current.filter((entry) => entry !== selectedUserFigure)].slice(0, 20));
    setSelectedStoredUserLook(selectedUserFigure);
    const message = `Stored parsed look for ${selectedUserName}.`;
    setUserToolMessage(message);
    appendTimeline("success", message);
  }, [appendTimeline, selectedUser, selectedUserFigure, selectedUserName]);

  const copyStoredUserLook = useCallback(async () => {
    const look = activeStoredUserLook.trim();
    if (!look) {
      const message = "No stored user look is available.";
      setUserToolMessage(message);
      appendTimeline("warning", message);
      return;
    }
    const copied = await writeClipboardText(look);
    const message = copied ? "Copied stored user look." : "Clipboard is unavailable for the stored look.";
    setUserToolMessage(message);
    appendTimeline(copied ? "success" : "warning", message);
  }, [activeStoredUserLook, appendTimeline]);

  const clearStoredUserLooks = useCallback(() => {
    setUserStoredLooks([]);
    setSelectedStoredUserLook("");
    setUserToolMessage("Stored user looks cleared.");
  }, []);

  const updateInjectionDraft = useCallback(
    <K extends keyof InjectionCommandDraft>(key: K, value: InjectionCommandDraft[K]) => {
      setInjectionDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const pushInjectionHistory = useCallback((entry: Omit<InjectionHistoryEntry, "id" | "time">) => {
    setInjectionHistory((current) =>
      [
        {
          ...entry,
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          time: new Date().toLocaleTimeString(),
        },
        ...current,
      ].slice(0, 50),
    );
  }, []);

  const executeInjectionCommand = useCallback(
    async (command: InjectionCommandDraft, label = injectionCommandLabel(command)) => {
      const userRelayAction = injectionDraftToUserRelayAction(command);
      if (userRelayAction) {
        if (!window.habbpyV4) {
          const message = "Run the Electron shell before using packet-backed User commands.";
          setInjectionMessage(message);
          pushInjectionHistory({ label, status: "warning", message });
          appendTimeline("warning", message);
          return;
        }
        const repeatCount = clampRepeatCount(injectionRepeatCount);
        const repeatInterval = clampRepeatInterval(injectionRepeatInterval);
        setRuntimeBusy(true);
        let lastResult: Awaited<ReturnType<NonNullable<typeof window.habbpyV4>["sendUserRelayAction"]>> = {
          ok: false,
          message: "Command did not run.",
        };
        try {
          for (let index = 0; index < repeatCount; index += 1) {
            lastResult = await window.habbpyV4.sendUserRelayAction(userRelayAction, selectedClientId);
            if (!lastResult.ok) break;
            if (index < repeatCount - 1) await delay(repeatInterval);
          }
          const message = repeatCount > 1 ? `${lastResult.message} (${repeatCount} requested)` : lastResult.message;
          setInjectionMessage(message);
          setRuntimeMessage(message);
          pushInjectionHistory({ label, status: lastResult.ok ? "success" : "warning", message });
          appendTimeline(lastResult.ok ? "success" : "warning", `${label}: ${message}`);
          await Promise.all([refreshRuntimeSnapshot().catch(() => null), refreshRelayLog().catch(() => null)]);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setInjectionMessage(message);
          pushInjectionHistory({ label, status: "error", message });
          appendTimeline("error", message);
        } finally {
          setRuntimeBusy(false);
        }
        return;
      }

      const built = injectionDraftToRuntimeAction(command);
      if (built.blocked || !built.action) {
        const message = built.blocked ?? "Command is not runnable.";
        setInjectionMessage(message);
        pushInjectionHistory({ label, status: command.actionKind === "rawPacketBlocked" ? "blocked" : "warning", message });
        appendTimeline("warning", message);
        return;
      }
      const webview = webviewRef.current;
      if (!webview || !engineUrl) {
        const message = "Start the embedded client before using commands.";
        setInjectionMessage(message);
        pushInjectionHistory({ label, status: "warning", message });
        appendTimeline("warning", message);
        return;
      }
      const repeatCount = clampRepeatCount(injectionRepeatCount);
      const repeatInterval = clampRepeatInterval(injectionRepeatInterval);
      setRuntimeBusy(true);
      let lastResult: EngineRuntimeActionResult = { ok: false, message: "Command did not run." };
      try {
        for (let index = 0; index < repeatCount; index += 1) {
          lastResult = await runEngineRuntimeAction(webview, built.action);
          if (!lastResult.ok) break;
          if (index < repeatCount - 1) await delay(repeatInterval);
        }
        const message = repeatCount > 1 ? `${lastResult.message} (${repeatCount} requested)` : lastResult.message;
        setInjectionMessage(message);
        setRuntimeMessage(message);
        pushInjectionHistory({ label, status: lastResult.ok ? "success" : "warning", message });
        appendTimeline(lastResult.ok ? "success" : "warning", message);
        await refreshRuntimeSnapshot();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setInjectionMessage(message);
        pushInjectionHistory({ label, status: "error", message });
        appendTimeline("error", message);
      } finally {
        setRuntimeBusy(false);
      }
    },
    [
      appendTimeline,
      engineUrl,
      injectionRepeatCount,
      injectionRepeatInterval,
      pushInjectionHistory,
      refreshRelayLog,
      refreshRuntimeSnapshot,
      selectedClientId,
    ],
  );

  const addInjectionSnippet = useCallback(() => {
    const command = cloneInjectionDraft(injectionDraft);
    const label = injectionCommandLabel(command);
    const snippet: InjectionSnippet = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label,
      command,
      createdAt: new Date().toISOString(),
    };
    setInjectionSnippets((current) => [snippet, ...current.filter((entry) => entry.label !== label)].slice(0, 50));
    setSelectedInjectionSnippetId(snippet.id);
    setInjectionMessage(`Saved snippet: ${label}`);
  }, [injectionDraft]);

  const loadInjectionSnippet = useCallback((snippet: InjectionSnippet) => {
    setInjectionDraft(cloneInjectionDraft(snippet.command));
    setSelectedInjectionSnippetId(snippet.id);
    setInjectionMessage(`Loaded snippet: ${snippet.label}`);
  }, []);

  const exportInjectionSnippets = useCallback(() => {
    if (injectionSnippets.length === 0) {
      setInjectionMessage("No saved snippets to export.");
      return;
    }
    const blob = new Blob([`${JSON.stringify(injectionSnippets, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `habbpy-v4-injection-snippets-${stamp}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setInjectionMessage(`Prepared export for ${injectionSnippets.length} snippets.`);
  }, [injectionSnippets]);

  const importInjectionSnippets = useCallback(async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const loaded = normalizeInjectionSnippets(parsed);
      if (loaded.length === 0) {
        setInjectionMessage("Snippet file did not contain supported v4 or v3 entries.");
        return;
      }
      setInjectionSnippets((current) => [...loaded, ...current].slice(0, 50));
      setSelectedInjectionSnippetId(loaded[0]?.id ?? "");
      setInjectionMessage(`Loaded ${loaded.length} snippets.`);
    } catch (error) {
      setInjectionMessage(error instanceof Error ? `Load failed: ${error.message}` : "Load failed.");
    }
  }, []);

  const refreshLibrary = useCallback(async () => {
    if (!window.habbpyV4) {
      setBridgeMessage("Run the Electron shell to import or embed a Shockless client.");
      return;
    }
    setAppInfo(await window.habbpyV4.getAppInfo());
    setAppPreferences(await window.habbpyV4.getAppPreferences());
    setPluginRegistryState(await window.habbpyV4.getPluginRegistryState());
    const nextLibrary = await window.habbpyV4.getClientLibraryState();
    setLibraryState(nextLibrary);
    setBridgeMessage(nextLibrary.message);
    applyEngineLaunch(await window.habbpyV4.getEngineLaunchState());
    await refreshClientSessions();
    void refreshFurniMetadata();
  }, [applyEngineLaunch, refreshClientSessions, refreshFurniMetadata]);

  const refreshPluginRegistry = useCallback(async () => {
    if (!window.habbpyV4?.getPluginRegistryState) return;
    const next = await window.habbpyV4.getPluginRegistryState();
    setPluginRegistryState(next);
    setPluginManagerMessage(next.message);
  }, []);

  useEffect(() => {
    if (!appPreferences || preferenceDefaultsAppliedRef.current) return;
    preferenceDefaultsAppliedRef.current = true;
    setPacketFilters((current) => ({
      ...current,
      wrap: appPreferences.packetOutputWrap,
      autoscroll: appPreferences.packetOutputAutoScroll,
    }));
    setMultiAccountFile(appPreferences.defaultAccountFile);
    setMultiAccountCount(String(appPreferences.defaultAccountCount));
    setMultiAccountConcurrency(String(appPreferences.defaultAccountConcurrency));
    setMultiAccountKeyEnv(appPreferences.defaultAccountKeyEnv);
    setMultiAccountSummonTarget(appPreferences.defaultSummonTarget);
    setMultiAccountLoadMode(appPreferences.defaultLoadMode);
  }, [appPreferences]);

  const setPluginEnabled = useCallback(
    async (plugin: PluginDefinition, enabled: boolean) => {
      if (!window.habbpyV4?.setPluginEnabled) {
        dispatch({ type: "setPluginEnabled", pluginId: plugin.id, enabled });
        return;
      }
      const next = await window.habbpyV4.setPluginEnabled(plugin.id, enabled);
      setPluginRegistryState(next);
      setPluginManagerMessage(next.message);
      appendTimeline(enabled ? "success" : "info", next.message);
    },
    [appendTimeline],
  );

  const setPluginSurfaceEnabled = useCallback(
    async (pluginId: string, surfaceId: string, enabled: boolean) => {
      if (!window.habbpyV4?.setPluginSurfaceEnabled) {
        dispatch({ type: "setPluginUiSurfaceEnabled", pluginId, surfaceId, enabled });
        return;
      }
      const next = await window.habbpyV4.setPluginSurfaceEnabled(pluginId, surfaceId, enabled);
      setPluginRegistryState(next);
      setPluginManagerMessage(next.message);
      appendTimeline("info", next.message);
    },
    [appendTimeline],
  );

  const reloadPlugins = useCallback(async () => {
    if (!window.habbpyV4?.reloadPlugins) return;
    const next = await window.habbpyV4.reloadPlugins();
    setPluginRegistryState(next);
    setPluginManagerMessage(next.message);
    appendTimeline("success", next.message);
  }, [appendTimeline]);

  const openPluginsFolder = useCallback(async () => {
    if (!window.habbpyV4?.openPluginsFolder) return;
    const result = await window.habbpyV4.openPluginsFolder();
    setPluginRegistryState(result.state);
    setPluginManagerMessage(result.message);
    appendTimeline(result.ok ? "success" : "warning", result.message);
  }, [appendTimeline]);

  const createPluginFromTemplate = useCallback(async () => {
    if (!window.habbpyV4?.createPluginFromTemplate) return;
    const result = await window.habbpyV4.createPluginFromTemplate({ id: newPluginId, name: newPluginName });
    setPluginRegistryState(result.state);
    setPluginManagerMessage(result.message);
    appendTimeline(result.ok ? "success" : "warning", result.message);
  }, [appendTimeline, newPluginId, newPluginName]);

  const installPluginFromFolder = useCallback(async () => {
    if (!window.habbpyV4?.installPluginFromFolder) return;
    const result = await window.habbpyV4.installPluginFromFolder();
    setPluginRegistryState(result.state);
    setPluginManagerMessage(result.message);
    appendTimeline(result.ok ? "success" : "warning", result.message);
  }, [appendTimeline]);

  const importClientReference = useCallback(async () => {
    if (!window.habbpyV4) return;
    setProfileImportUi(pendingProfileImportUiState());
    setEngineBusy(true);
    try {
      const nextLibrary = await window.habbpyV4.importClientReference();
      setLibraryState(nextLibrary);
      setBridgeMessage(nextLibrary.message);
      applyEngineLaunch(await window.habbpyV4.getEngineLaunchState());
      await refreshClientSessions();
      setProfileImportUi((current) => profileImportUiFinished(current, nextLibrary.message, false));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import/build failed.";
      setBridgeMessage(message);
      setProfileImportUi((current) => profileImportUiFinished(current, message, true));
    } finally {
      setEngineBusy(false);
    }
  }, [applyEngineLaunch, refreshClientSessions]);

  const selectClientProfile = useCallback(
    async (profileRoot: string) => {
      if (!window.habbpyV4) return;
      const nextLibrary = await window.habbpyV4.setActiveClientProfile(profileRoot);
      setLibraryState(nextLibrary);
      setBridgeMessage(nextLibrary.message);
      applyEngineLaunch(await window.habbpyV4.getEngineLaunchState());
      await refreshClientSessions();
    },
    [applyEngineLaunch, refreshClientSessions],
  );

  const startEngine = useCallback(async () => {
    if (!window.habbpyV4) {
      setBridgeMessage("Run npm run electron:dev to use embedded Shockless.");
      return;
    }
    setEngineBusy(true);
    try {
      applyEngineLaunch(await window.habbpyV4.startEmbeddedEngine());
      await refreshClientSessions();
    } finally {
      setEngineBusy(false);
    }
  }, [applyEngineLaunch, refreshClientSessions]);

  const stopEngine = useCallback(async () => {
    if (!window.habbpyV4) return;
    setEngineBusy(true);
    try {
      applyEngineLaunch(await window.habbpyV4.stopEmbeddedEngine());
      await refreshClientSessions();
    } finally {
      setEngineBusy(false);
    }
  }, [applyEngineLaunch, refreshClientSessions]);

  const updateEngineLaunchSettings = useCallback(
    async (patch: EngineLaunchSettingsPatch, message = "Launch settings updated.") => {
      if (!window.habbpyV4?.setEngineLaunchSettings) return;
      setEngineBusy(true);
      try {
        const launch = await window.habbpyV4.setEngineLaunchSettings(patch);
        applyEngineLaunch(launch);
        await refreshClientSessions();
        setBridgeMessage(message);
        appendTimeline("success", message);
      } finally {
        setEngineBusy(false);
      }
    },
    [appendTimeline, applyEngineLaunch, refreshClientSessions],
  );

  const applyVersionCheckBuild = useCallback(() => {
    const trimmed = versionCheckDraft.trim();
    if (!trimmed) {
      void updateEngineLaunchSettings({ versionCheckBuild: null }, "Version check override cleared; profile/default value will be used.");
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
      setBridgeMessage("Version check build must be a positive integer, or blank for auto/profile default.");
      appendTimeline("warning", "Invalid version check build override.");
      return;
    }
    void updateEngineLaunchSettings({ versionCheckBuild: parsed }, `Version check override set to ${parsed}.`);
  }, [appendTimeline, updateEngineLaunchSettings, versionCheckDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (railPlugins.some((plugin) => plugin.id === state.selectedPluginId)) return;
    dispatch({ type: "selectPlugin", pluginId: "plugin-manager" });
  }, [railPlugins, state.selectedPluginId]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  useEffect(() => {
    const value = engineLaunch?.settings?.versionCheckBuild ?? selectedProfile?.versionCheckBuild ?? null;
    setVersionCheckDraft(value ? String(value) : "");
  }, [engineLaunch?.settings?.versionCheckBuild, selectedProfile?.id, selectedProfile?.versionCheckBuild]);

  useEffect(() => {
    const latest = profileImportUi.latest;
    const completed =
      latest?.stage === "validate-profile" &&
      (latest.state === "done" || latest.state === "warning") &&
      latest.jobId !== completedImportRefreshRef.current;
    if (!completed) return;
    completedImportRefreshRef.current = latest.jobId;
    void refreshLibrary();
  }, [profileImportUi.latest, refreshLibrary]);

  useEffect(() => {
    const unsubscribe = window.habbpyV4?.onProfileImportProgress?.((progress) => {
      startTransition(() => {
        setProfileImportUi((current) => profileImportUiWithProgress(current, progress));
      });
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!profileImportRunning) return;
    setProfileImportNow(Date.now());
    const timer = window.setInterval(() => setProfileImportNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [profileImportRunning]);

  useEffect(() => {
    try {
      setInjectionSnippets(normalizeInjectionSnippets(JSON.parse(window.localStorage.getItem(injectionSnippetStorageKey) || "[]")));
      const parsedHistory = JSON.parse(window.localStorage.getItem(injectionHistoryStorageKey) || "[]");
      setInjectionHistory(Array.isArray(parsedHistory) ? parsedHistory.slice(0, 50) : []);
    } catch {
      setInjectionSnippets([]);
      setInjectionHistory([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(injectionSnippetStorageKey, JSON.stringify(injectionSnippets.slice(0, 50)));
    } catch {
      // Local browser storage is optional; snippets still work in memory.
    }
  }, [injectionSnippets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(injectionHistoryStorageKey, JSON.stringify(injectionHistory.slice(0, 50)));
    } catch {
      // Local browser storage is optional; history still works in memory.
    }
  }, [injectionHistory]);

  useEffect(() => {
    if (!selectedStoredUserLook && userStoredLooks.length > 0) {
      setSelectedStoredUserLook(userStoredLooks[0]);
    }
  }, [selectedStoredUserLook, userStoredLooks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(userStoredLookStorageKey, JSON.stringify(userStoredLooks.slice(0, 20)));
    } catch {
      // Local browser storage is optional; stored looks still work in memory.
    }
  }, [userStoredLooks]);

  useEffect(() => {
    try {
      window.localStorage.setItem(automationPrefsStorageKey, JSON.stringify(automationPrefs));
    } catch {
      // Local browser storage is optional; automation preferences still work in memory.
    }
  }, [automationPrefs]);

  useEffect(() => {
    if (!window.habbpyV4) return;
    const active =
      packetConsoleOpen ||
      selectedPlugin.id === "connection" ||
      selectedPlugin.id === "packet-log" ||
      selectedPlugin.id === "automation" ||
      selectedPlugin.id === "chat" ||
      selectedPlugin.id === "dev-tools" ||
      selectedPlugin.id === "fishing" ||
      selectedPlugin.id === "gardening" ||
      selectedPlugin.id === "info" ||
      selectedPlugin.id === "inventory" ||
      selectedPlugin.id === "items" ||
      selectedPlugin.id === "present-catcher" ||
      selectedPlugin.id === "social" ||
      selectedPlugin.id === "user" ||
      selectedPlugin.id === "visitors" ||
      selectedPlugin.id === "wall-mover";
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    const readLog = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await refreshRelayLog();
      } catch {
        if (!cancelled) {
          relayLogRef.current = null;
          setRelayLog(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void readLog();
    const interval = window.setInterval(() => void readLog(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [packetConsoleOpen, refreshRelayLog, selectedPlugin.id]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !engineUrl) return;
    let cancelled = false;
    let inFlight = false;
    const scopes = runtimeProbeScopesForPlugin(selectedPlugin.id);

    const readRuntimeProbe = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const probe = await readEngineRuntimeSnapshot(webview, scopes);
        if (cancelled) return;
        applyRuntimeSnapshot(probe);
      } catch {
        if (!cancelled) {
          dispatch({
            type: "mergeEngineStatus",
            status: {
              location: "Shockless loading",
            },
          });
        }
      } finally {
        inFlight = false;
      }
    };

    const onLoad = () => void readRuntimeProbe();
    webview.addEventListener("did-finish-load", onLoad);
    const interval = window.setInterval(() => void readRuntimeProbe(), 2500);
    void readRuntimeProbe();

    return () => {
      cancelled = true;
      webview.removeEventListener("did-finish-load", onLoad);
      window.clearInterval(interval);
    };
  }, [applyRuntimeSnapshot, engineUrl, selectedClientId, selectedPlugin.id]);

  useEffect(() => {
    if (appPreferences?.autoSubmitVisibleLogin === false) return;
    const submitBridge = window.habbpyV4?.submitVisibleClientLogin;
    if (!submitBridge) return;
    let cancelled = false;
    const timers: number[] = [];
    const listenerCleanups: Array<() => void> = [];
    const sessionById = new globalThis.Map((clientSessions?.sessions ?? []).map((session) => [session.id, session]));

    const submitVisibleLogin = async (view: GameWebviewMount) => {
      const loginKey = `${view.id}:${view.url}`;
      if (cancelled || view.id === 1 || visibleLoginSubmittedRef.current.has(loginKey) || visibleLoginInFlightRef.current.has(loginKey)) return;
      const session = sessionById.get(view.id);
      if (!session?.visible || session.headless || session.status !== "running") return;
      const webview = gameWebviewRefs.current.get(view.id);
      if (!webview) return;
      if (typeof webview.getWebContentsId !== "function") return;
      const webContentsId = Number(webview.getWebContentsId());
      if (!Number.isFinite(webContentsId) || webContentsId <= 0) return;
      visibleLoginInFlightRef.current.add(loginKey);
      try {
        const result = await submitBridge(view.id, webContentsId);
        if (!result || cancelled) return;
        if (result.ok) {
          visibleLoginSubmittedRef.current.add(loginKey);
          visibleLoginWarnedRef.current.delete(loginKey);
          appendTimeline("success", result.message);
          await refreshClientSessions().catch(() => null);
          await refreshSelectedClientSnapshot(view.id).catch(() => null);
          return;
        }
        if (!visibleLoginWarnedRef.current.has(loginKey)) {
          visibleLoginWarnedRef.current.add(loginKey);
          appendTimeline("warning", result.message);
        }
      } finally {
        visibleLoginInFlightRef.current.delete(loginKey);
      }
    };

    for (const view of mountedVisibleGameViews) {
      if (view.id === 1) continue;
      const webview = gameWebviewRefs.current.get(view.id);
      if (!webview) continue;
      const onLoad = () => {
        const timer = window.setTimeout(() => void submitVisibleLogin(view), 750);
        timers.push(timer);
      };
      webview.addEventListener("did-finish-load", onLoad);
      listenerCleanups.push(() => webview.removeEventListener("did-finish-load", onLoad));
      timers.push(window.setTimeout(() => void submitVisibleLogin(view), 750));
      timers.push(window.setInterval(() => void submitVisibleLogin(view), 5000));
    }

    return () => {
      cancelled = true;
      for (const cleanup of listenerCleanups) cleanup();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [
    appendTimeline,
    appPreferences?.autoSubmitVisibleLogin,
    clientSessions?.sessions,
    gameWebviewMountEpoch,
    mountedVisibleGameViews,
    refreshClientSessions,
    refreshSelectedClientSnapshot,
  ]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !engineUrl || !engineUserNameLabels || !selectedClientIsVisible) return;
    let cancelled = false;
    let inFlight = false;
    let applied = false;
    let attempts = 0;
    let interval: number | null = null;
    const applyNameLabels = async () => {
      if (cancelled || inFlight || applied) return;
      attempts += 1;
      inFlight = true;
      try {
        const result = await runEngineRuntimeAction(webview, { kind: "setUserNameLabels", enabled: true });
        if (!cancelled && result.ok) {
          applied = true;
          setRuntimeMessage(result.message);
          if (interval !== null) {
            window.clearInterval(interval);
            interval = null;
          }
        }
      } finally {
        inFlight = false;
      }
      if (attempts >= 20 && interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    };
    const onLoad = () => {
      applied = false;
      attempts = 0;
      window.setTimeout(() => void applyNameLabels(), 750);
    };
    webview.addEventListener("did-finish-load", onLoad);
    const timer = window.setTimeout(() => void applyNameLabels(), 1200);
    interval = window.setInterval(() => void applyNameLabels(), 1000);
    return () => {
      cancelled = true;
      webview.removeEventListener("did-finish-load", onLoad);
      window.clearTimeout(timer);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [engineUrl, engineUserNameLabels, selectedClientId, selectedClientIsVisible]);

  useEffect(() => {
    if (!selectedRuntimeSnapshot) return;
    const nextKey = roomReady
      ? `room:${runtimeRoomType(selectedRuntimeSnapshot)}:${runtimeRoomId(selectedRuntimeSnapshot)}:${runtimeRoomName(selectedRuntimeSnapshot)}`
      : engineUrl
        ? "not-ready"
        : "stopped";
    const previousKey = lastChatRoomMarkerKeyRef.current;
    if (previousKey === nextKey) return;
    lastChatRoomMarkerKeyRef.current = nextKey;

    const markerText = roomReady
      ? `Entered room: ${runtimeRoomName(selectedRuntimeSnapshot)}`
      : previousKey.startsWith("room:")
        ? "Room cleared."
        : "";
    if (!markerText) return;

    const marker: RuntimeChatEntry = {
      index: Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      userName: "Room",
      chatMode: "system",
      text: markerText,
    };
    setChatRoomMarkers((current) => [...current.slice(-99), marker]);
  }, [engineUrl, roomReady, selectedRuntimeSnapshot]);

  useEffect(() => {
    if (!automationPrefs.autoHideBulletin || !selectedRuntimeSnapshot || !engineUrl) return;
    const bulletinWindows = selectedRuntimeSnapshot.windowIds.filter((id) => /bulletin|welcome|news/i.test(id));
    if (bulletinWindows.length === 0) return;
    const nextKey = `${engineUrl}:${bulletinWindows.join("|")}`;
    if (lastAutoHideBulletinKeyRef.current === nextKey) return;
    lastAutoHideBulletinKeyRef.current = nextKey;
    void hideBulletinBoard("auto");
  }, [automationPrefs.autoHideBulletin, engineUrl, hideBulletinBoard, selectedRuntimeSnapshot]);

  useEffect(() => {
    if (selectedPlugin.id !== "chat" || !chatFilters.autoscroll) return;
    const list = chatListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chatFilters.autoscroll, selectedPlugin.id, visibleChatHistory.length]);

  useEffect(() => {
    if (selectedPlugin.id !== "packet-log" || !packetFilters.autoscroll) return;
    const list = packetListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
      startTransition(() => {
        setPacketListScrollTop(list.scrollTop);
      });
    }
  }, [packetFilters.autoscroll, selectedPlugin.id, visiblePacketEntries.length]);

  useEffect(() => {
    if (!packetConsoleOpen) return;
    const list = packetConsoleListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    const packetList = packetConsolePacketListRef.current;
    if (packetList) {
      packetList.scrollTop = packetList.scrollHeight;
      startTransition(() => {
        setPacketConsoleScrollTop(packetList.scrollTop);
      });
    }
  }, [packetConsoleEntries.length, packetConsoleOpen, packetConsolePacketEntries.length]);

  useEffect(() => {
    const sourceUsers = selectedRuntimeSnapshot?.userState?.users ?? [];
    const packetVisitors = latestPacketVisitorUsers(packetProfileUsers);
    setVisitorState((current) => {
      if (!roomReady || !visitorRoomKey) {
        if (current.roomKey === "" && Object.keys(current.entries).length === 0) return current;
        return emptyVisitorState;
      }

      const sameRoom = current.roomKey === visitorRoomKey;
      const previousActive = sameRoom ? new Set(current.activeKeys) : new Set<string>();
      const nextActive = new Set<string>();
      const nextEntries: Record<string, VisitorEntry> = sameRoom ? { ...current.entries } : {};
      const now = new Date().toLocaleTimeString();
      const matchedPacketKeys = new Set<string>();

      for (const user of sourceUsers.filter(isVisitorUser)) {
        const packetUser = packetProfileForRuntimeUser(packetProfileIndex, user, selectedRuntimeSnapshot?.userState?.sessionUserName);
        if (packetUser) {
          const packetAccountId = compactValue(packetUser.accountId);
          matchedPacketKeys.add(packetAccountId !== "-" ? `id:${packetAccountId}` : `name:${packetUser.name.trim().toLowerCase()}`);
        }
        const key = visitorKeyFor(user, selectedRuntimeSnapshot?.userState?.sessionUserName, packetUser);
        nextActive.add(key);
        const previous = nextEntries[key];
        const reentered = Boolean(previous) && !previousActive.has(key);
        nextEntries[key] = {
          ...visitorEntryFor(user, selectedRuntimeSnapshot?.userState?.sessionUserName, now, previous, packetUser),
          visits: previous ? previous.visits + (reentered ? 1 : 0) : 1,
          entered: previous && !reentered ? previous.entered : now,
        };
      }

      for (const packetUser of packetVisitors) {
        const packetAccountId = compactValue(packetUser.accountId);
        const packetKey = packetAccountId !== "-" ? `id:${packetAccountId}` : `name:${packetUser.name.trim().toLowerCase()}`;
        if (matchedPacketKeys.has(packetKey)) continue;
        nextActive.add(packetKey);
        const previous = nextEntries[packetKey];
        const reentered = Boolean(previous) && !previousActive.has(packetKey);
        nextEntries[packetKey] = {
          ...visitorEntryForPacketUser(packetUser, now, previous),
          visits: previous ? previous.visits + (reentered ? 1 : 0) : 1,
          entered: previous && !reentered ? previous.entered : now,
        };
      }

      for (const key of previousActive) {
        if (!nextActive.has(key) && nextEntries[key]?.current) {
          nextEntries[key] = {
            ...nextEntries[key],
            current: false,
            left: now,
          };
        }
      }

      return {
        roomKey: visitorRoomKey,
        activeKeys: [...nextActive],
        entries: nextEntries,
      };
    });
  }, [packetProfileIndex, packetProfileUsers, roomReady, selectedRuntimeSnapshot?.userState?.sessionUserName, selectedRuntimeSnapshot?.userState?.users, visitorRoomKey]);

  return (
    <main className={`app-shell ${state.ui.dockCollapsed ? "dock-collapsed" : ""}`}>
      <div className={`boot-splash ${booting ? "" : "boot-hide"}`} aria-hidden={!booting}>
        <div className="boot-inner">
          <div className="boot-brand">
            <img className="boot-sprite" src="./img/headicon.png" alt="" aria-hidden="true" />
            <span className="boot-title">Habbpy v4</span>
          </div>
          <div className="boot-bar">
            <span />
          </div>
        </div>
      </div>

      <section className="game-region" aria-label="Embedded Shockless game area">
        <header className="top-bar">
          <div className="top-bar-copy">
            <img className="app-brand-sprite" src="./img/headicon.png" alt="" aria-hidden="true" />
            <div>
              <div className="app-title">Habbpy v4</div>
              <div className="app-subtitle">Shockless Engine companion shell</div>
            </div>
          </div>
          <div className="engine-actions" aria-label="Embedded engine controls">
            <button
              className="engine-action-button"
              type="button"
              onClick={() => void refreshLibrary()}
              disabled={!desktopBridgeAvailable || engineBusy || profileImportRunning}
              title="Refresh"
            >
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
            {engineUrl ? (
              <button
                className="engine-action-button"
                type="button"
                onClick={() => void stopEngine()}
                disabled={!desktopBridgeAvailable || engineBusy || profileImportRunning}
                title="Stop"
              >
                <Square size={13} />
                <span>Stop</span>
              </button>
            ) : (
              <button
                className="engine-action-button primary"
                type="button"
                onClick={() => void startEngine()}
                disabled={!desktopBridgeAvailable || engineBusy || profileImportRunning || (!selectedProfile?.ready && engineLaunch?.status === "not-configured")}
                title="Start"
              >
                <Play size={14} />
                <span>Start</span>
              </button>
            )}
          </div>
          <div className="session-strip" aria-label="Client sessions">
            {(clientSessions?.sessions.length ? clientSessions.sessions : selectedClientSession ? [selectedClientSession] : []).map((session) => (
              <button
                key={session.id}
                type="button"
                className={`session-chip ${session.selected ? "selected" : ""} ${session.status === "running" ? "running" : session.status === "error" ? "error" : ""}`}
                onClick={() => void selectClientSession(session.id)}
                title={clientSessionTitle(session)}
                aria-label={`Select client ${session.id}`}
              >
                <span>{session.id}</span>
                {session.headless ? <small>H</small> : null}
              </button>
            ))}
            {!clientSessions?.sessions.length && !selectedClientSession ? <span className="session-empty">1</span> : null}
            <button
              className="session-add-button"
              type="button"
              onClick={() => void addManualVisibleClient()}
              title="Start a manual visible client"
              aria-label="Add client session"
            >
              <Plus size={15} />
            </button>
          </div>
          <div
            className={`conn-status ${
              state.engine.embedded ? "online" : engineLaunch?.status === "ready" ? "ready" : "idle"
            }`}
            aria-label="Engine status"
            title={state.engine.location}
          >
            <span className="conn-dot" />
            <span>{state.engine.embedded ? "Connected" : engineLaunch?.status === "ready" ? "Ready" : "Preview"}</span>
          </div>
        </header>

        <div className={`game-frame ${hasMountedVisibleGameViews ? "embedded" : ""}`}>
          <div className="game-toolbar">
            <span>GameHost</span>
            <span>{state.engine.profileLabel}</span>
          </div>
          <div className="game-stage">
            {hasMountedVisibleGameViews ? (
              <div className="game-webview-stack">
                {mountedVisibleGameViews.map((view) => {
                  const active = view.id === selectedClientId && Boolean(engineUrl) && view.url === engineUrl;
                  return (
                    <div
                      key={`client-${view.id}`}
                      className={`game-webview-zoom-surface ${active ? "active" : "inactive"}`}
                      aria-hidden={!active}
                      data-client-id={view.id}
                      data-client-label={view.label}
                    >
                      <webview
                        ref={gameWebviewRefForClient(view.id)}
                        className="game-webview"
                        src={view.url}
                        partition={view.partition}
                        webpreferences="contextIsolation=yes,nodeIntegration=no"
                      />
                    </div>
                  );
                })}
                {!engineUrl ? (
                  <div className="game-placeholder game-placeholder-overlay">
                    {selectedClientSession && !selectedClientIsVisible ? (
                      <div className="hotel-card">
                        <img className="hotel-avatar" src="./img/avatar.png" alt="" aria-hidden="true" />
                        <div>
                          <strong>Headless client selected</strong>
                          <p>client{selectedClientId} is headless; select a visible session to render a game view.</p>
                        </div>
                      </div>
                    ) : (
                      <ImporterWorkspace
                        bridgeAvailable={desktopBridgeAvailable}
                        bridgeMessage={bridgeMessage}
                        engineBusy={engineBusy || profileImportRunning}
                        settingsBusy={engineBusy && !profileImportRunning}
                        engineLaunch={engineLaunch}
                        elapsedMs={profileImportElapsedMs}
                        importState={profileImportUi}
                        profiles={libraryState?.profiles ?? []}
                        selectedProfile={selectedProfile}
                        onImport={() => void importClientReference()}
                        onRefresh={() => void refreshLibrary()}
                        onStart={() => void startEngine()}
                        onSetCustomHotelView={(enabled) => void updateEngineLaunchSettings({ customHotelView: enabled }, `Custom hotel view ${enabled ? "enabled" : "disabled"}.`)}
                        onSetResizablePresentation={(enabled) => void updateEngineLaunchSettings({ resizablePresentation: enabled }, `Responsive stage resize ${enabled ? "enabled" : "disabled"}.`)}
                        onSetVersionCheckBuild={applyVersionCheckBuild}
                        versionCheckDraft={versionCheckDraft}
                        onVersionCheckDraftChange={setVersionCheckDraft}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="game-placeholder">
                {selectedClientSession && !selectedClientIsVisible ? (
                  <div className="hotel-card">
                    <img className="hotel-avatar" src="./img/avatar.png" alt="" aria-hidden="true" />
                    <div>
                      <strong>Headless client selected</strong>
                      <p>client{selectedClientId} is headless; select a visible session to render a game view.</p>
                    </div>
                  </div>
                ) : (
                  <ImporterWorkspace
                    bridgeAvailable={desktopBridgeAvailable}
                    bridgeMessage={bridgeMessage}
                    engineBusy={engineBusy || profileImportRunning}
                    settingsBusy={engineBusy && !profileImportRunning}
                    engineLaunch={engineLaunch}
                    elapsedMs={profileImportElapsedMs}
                    importState={profileImportUi}
                    profiles={libraryState?.profiles ?? []}
                    selectedProfile={selectedProfile}
                    onImport={() => void importClientReference()}
                    onRefresh={() => void refreshLibrary()}
                    onStart={() => void startEngine()}
                    onSetCustomHotelView={(enabled) => void updateEngineLaunchSettings({ customHotelView: enabled }, `Custom hotel view ${enabled ? "enabled" : "disabled"}.`)}
                    onSetResizablePresentation={(enabled) => void updateEngineLaunchSettings({ resizablePresentation: enabled }, `Responsive stage resize ${enabled ? "enabled" : "disabled"}.`)}
                    onSetVersionCheckBuild={applyVersionCheckBuild}
                    versionCheckDraft={versionCheckDraft}
                    onVersionCheckDraftChange={setVersionCheckDraft}
                  />
                )}
              </div>
            )}
          </div>
          {packetConsoleOpen ? (
            <div className="packet-console" aria-label="Packet log console">
              <div className="packet-console-header">
                <div>
                  <Terminal size={14} />
                  <strong>Packet Log</strong>
                  <span>{compactValue(packetConsolePacketEntries.length)} rows</span>
                  <span>{packetConsoleClientFilter === "All" ? "all clients" : `client${packetConsoleClientFilter}`}</span>
                  {packetConsoleQuery ? <span>filter: {packetConsoleQuery}</span> : null}
                </div>
                <select
                  className="packet-console-client-select"
                  value={packetConsoleClientFilter}
                  onChange={(event) => setPacketConsoleClientFilter(event.currentTarget.value)}
                  aria-label="Packet console client filter"
                >
                  {packetClientChoices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => setPacketConsoleOpen(false)} aria-label="Close packet log console">
                  `
                </button>
              </div>
              <div className="packet-console-list" ref={packetConsoleListRef}>
                {packetConsoleEntries.slice(-80).map((entry) => (
                  <div className={`packet-console-output ${entry.kind}`} key={entry.id}>
                    <span>{entry.time}</span>
                    <strong>{entry.kind === "command" ? ">" : statusLabel(entry.kind)}</strong>
                    <small>{entry.text}</small>
                  </div>
                ))}
                {packetConsolePacketEntries.length > 0 ? (
                  <div className="packet-console-packet-list" ref={packetConsolePacketListRef} onScroll={handlePacketConsoleScroll}>
                    <div className="packet-console-packet-space" style={{ height: packetConsoleVirtualRange.height }}>
                      <div
                        className="packet-console-packet-window"
                        style={{ transform: `translateY(${packetConsoleVirtualRange.top}px)` }}
                      >
                        {renderedPacketConsoleEntries.map((entry) => (
                          <code className={`packet-console-packet-row packet-${entry.direction.toLowerCase()}`} key={entry.id}>
                            {relayEntryV3Line(entry, relayLog?.updatedAt)}
                          </code>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                {packetConsolePacketEntries.length === 0 ? (
                  <div className="packet-console-empty">
                    {packetEntries.length === 0 ? "Start the embedded client to create relay rows." : "No packets match this filter."}
                  </div>
                ) : null}
              </div>
              <div className="packet-console-input-row">
                <span>`</span>
                <input
                  value={packetConsoleInput}
                  onChange={(event) => setPacketConsoleInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void executePacketConsoleCommand();
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      const history = consoleCommandState?.history ?? [];
                      if (history.length === 0) return;
                      event.preventDefault();
                      const nextIndex = packetConsoleHistoryIndex === null
                        ? history.length - 1
                        : Math.max(0, packetConsoleHistoryIndex - 1);
                      setPacketConsoleHistoryIndex(nextIndex);
                      setPacketConsoleInput(history[nextIndex] ?? "");
                      return;
                    }
                    if (event.key === "ArrowDown") {
                      const history = consoleCommandState?.history ?? [];
                      if (history.length === 0 || packetConsoleHistoryIndex === null) return;
                      event.preventDefault();
                      const nextIndex = packetConsoleHistoryIndex + 1;
                      if (nextIndex >= history.length) {
                        setPacketConsoleHistoryIndex(null);
                        setPacketConsoleInput("");
                      } else {
                        setPacketConsoleHistoryIndex(nextIndex);
                        setPacketConsoleInput(history[nextIndex] ?? "");
                      }
                    }
                  }}
                  placeholder="help / alias bringall summon all / bind F1 bringall / packets client 2"
                  aria-label="Packet console command"
                />
              </div>
            </div>
          ) : null}
          {pluginEnabledById.room !== false && pluginSurfaceEnabledByPluginId.room?.overlay && roomReady ? (
            <div className="room-overlay room-overlay-top">
              <strong>{runtimeRoomName(selectedRuntimeSnapshot)}</strong>
              <span>
                {runtimeRoomType(selectedRuntimeSnapshot)} / {compactValue(selectedRuntimeSnapshot?.userState?.roomUserCount ?? selectedRuntimeSnapshot?.roomReady?.roomLikeSpriteCount)} users
              </span>
              {privateRoomReady ? (
                <button
                  className="room-zoom-toggle"
                  type="button"
                  onClick={() => void setEmbeddedRoomZoom(gameZoom === 1 ? 2 : 1)}
                  title={gameZoom === 1 ? "Zoom to 200%" : "Zoom to 100%"}
                  aria-label={gameZoom === 1 ? "Zoom to 200%" : "Zoom to 100%"}
                >
                  {gameZoom === 1 ? <ZoomIn size={13} /> : <ZoomOut size={13} />}
                  <span>{gameZoom === 1 ? "2x" : "1x"}</span>
                </button>
              ) : null}
            </div>
          ) : null}
          {pluginEnabledById["dev-tools"] !== false && pluginSurfaceEnabledByPluginId["dev-tools"]?.status && selectedRuntimeSnapshot ? (
            <div className="room-overlay room-overlay-bottom">
              <strong>FPS {compactValue(state.engine.fps ?? selectedRuntimeSnapshot.performanceStats?.rafPerSecond)}</strong>
              <span>{runtimeRoomName(selectedRuntimeSnapshot)}</span>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="plugin-dock" aria-label="Plugin dock" data-selected-plugin={selectedPlugin.id}>
        <nav className="icon-rail" aria-label="Plugins">
          <button
            className="rail-toggle"
            type="button"
            aria-label={state.ui.dockCollapsed ? "Expand plugin dock" : "Collapse plugin dock"}
            onClick={() => dispatch({ type: "toggleDockCollapsed" })}
            title={state.ui.dockCollapsed ? "Expand plugin dock" : "Collapse plugin dock"}
          >
            {state.ui.dockCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>

          <div className="rail-list">
            {filteredPlugins.map((plugin) => {
              const enabled = pluginEnabledById[plugin.id] !== false;
              const active = plugin.id === selectedPlugin.id;
              return (
                <button
                  className={`rail-tab ${active ? "active" : ""} ${enabled ? "" : "disabled"}`}
                  type="button"
                  key={plugin.id}
                  title={plugin.name}
                  aria-label={plugin.name}
                  aria-pressed={active}
                  onClick={() => {
                    if (active && !state.ui.dockCollapsed) {
                      dispatch({ type: "toggleDockCollapsed" });
                    } else {
                      dispatch({ type: "selectPlugin", pluginId: plugin.id });
                      if (state.ui.dockCollapsed) dispatch({ type: "toggleDockCollapsed" });
                    }
                  }}
                >
                  <span className="plugin-icon">
                    <PluginIcon plugin={plugin} />
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {!state.ui.dockCollapsed ? (
          <section className="plugin-panel" aria-label={`${selectedPlugin.name} panel`}>
            <div className="panel-title">
              <div className="panel-icon">
                <PluginIcon plugin={selectedPlugin} />
              </div>
              <div>
                <h2>{selectedPlugin.name}</h2>
                <p>{labelCase(selectedPlugin.category)}</p>
              </div>
            </div>

            {selectedPlugin.id === "connection" ? (
              <div className="client-library">
                <div className="client-library-actions">
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => void importClientReference()}
                    disabled={!desktopBridgeAvailable || engineBusy || profileImportRunning}
                  >
                    <FolderInput size={14} />
                    <span>{profileImportRunning ? "Importing..." : "Import/Build Client"}</span>
                  </button>
                </div>
                <div className="profile-list-compact">
                  {(libraryState?.profiles ?? []).map((profile) => (
                    <button
                      className={`profile-option ${profile.profileRoot === libraryState?.selectedProfileRoot ? "active" : ""}`}
                      type="button"
                      key={profile.profileRoot}
                      onClick={() => void selectClientProfile(profile.profileRoot)}
                    >
                      <strong>{profileLine(profile)}</strong>
                      <small>{profile.ready ? "Ready / Referenced" : profile.reason}</small>
                    </button>
                  ))}
                  {(libraryState?.profiles.length ?? 0) === 0 ? <p className="empty-panel-note">{bridgeMessage}</p> : null}
                </div>
                <div className="mini-section">
                  <h3>Session</h3>
                  <div className="kv-grid">
                    <span>State</span>
                    <strong>{profileImportRunning ? "Importing" : engineBusy ? "Starting" : statusLabel(engineLaunch?.status)}</strong>
                    <span>Session ID</span>
                    <strong>{relaySessionId}</strong>
                    <span>Bridge</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.networkBridgeUrl)}</strong>
                    <span>Relay Log</span>
                    <strong>{selectedClientRelayLog?.exists ? `${compactValue(selectedClientRelayLog.entries.length)} selected rows` : "Missing"}</strong>
                    <span>Client Packets</span>
                    <strong>{compactValue(selectedClientRelayLog?.clientCount)}</strong>
                    <span>Server Packets</span>
                    <strong>{compactValue(selectedClientRelayLog?.serverCount)}</strong>
                    <span>Latest Client</span>
                    <strong>{relayPacketSummary(latestClientPacket)}</strong>
                    <span>Latest Server</span>
                    <strong>{relayPacketSummary(latestServerPacket)}</strong>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Selected Client</h3>
                  <div className="kv-grid">
                    <span>Client</span>
                    <strong>{selectedClientSnapshot?.client ? `client${selectedClientSnapshot.client.id} / ${selectedClientSnapshot.client.label}` : compactValue(selectedClientSession?.label)}</strong>
                    <span>Mode</span>
                    <strong>{selectedClientSnapshot?.client?.headless ? "headless" : selectedClientSnapshot?.client?.visible ? "visible" : "-"}</strong>
                    <span>User</span>
                    <strong>{compactValue(selectedClientSnapshot?.runtime?.userName ?? selectedClientSnapshot?.client?.username)}</strong>
                    <span>Room</span>
                    <strong>{compactValue(selectedClientSnapshot?.runtime?.roomName ?? selectedClientSnapshot?.client?.roomName)}</strong>
                    <span>Users</span>
                    <strong>{compactValue(selectedClientSnapshot?.runtime?.userCount)}</strong>
                    <span>Relay</span>
                    <strong>{selectedClientSnapshot?.relay ? `${selectedClientSnapshot.relay.packetCount} packets` : "-"}</strong>
                    <span>Updated</span>
                    <strong>{compactValue(selectedClientSnapshot?.runtime?.updatedAt)}</strong>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Parsed State</h3>
                  <div className="kv-grid">
                    <span>Client</span>
                    <strong>client{selectedClientId}</strong>
                    <span>Profiles</span>
                    <strong>{compactValue(packetProfileUsers.length)}</strong>
                    <span>Friends</span>
                    <strong>{compactValue(packetInfoState.friends.length)}</strong>
                    <span>Requests</span>
                    <strong>{compactValue(packetInfoState.friendRequests.length)}</strong>
                    <span>Messages</span>
                    <strong>{compactValue(packetInfoState.privateMessages.length)}</strong>
                    <span>Chat Rows</span>
                    <strong>{compactValue(packetChatEntries.length)}</strong>
                    <span>Inventory</span>
                    <strong>{compactValue(packetInventoryState.totalCount)}</strong>
                    <span>Wall Items</span>
                    <strong>{compactValue(packetWallItemState.itemCount)}</strong>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Encryption</h3>
                  <div className="kv-grid">
                    <span>State</span>
                    <strong>{relayEncryptionState}</strong>
                    <span>Client Mode</span>
                    <strong>{relayClientModes}</strong>
                    <span>Server Mode</span>
                    <strong>{relayServerModes}</strong>
                    <span>Body Logging</span>
                    <strong>{relayBodyLoggingState}</strong>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Engine</h3>
                  <div className="kv-grid">
                    <span>Title</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.title)}</strong>
                    <span>Runtime</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.scriptBundle?.runtimeVersion)}</strong>
                    <span>Presentation</span>
                    <strong>{engineLaunch?.settings?.resizablePresentation ? "responsive" : "fixed-stage"}</strong>
                    <span>FPS</span>
                    <strong>{compactValue(runtimeFps(selectedRuntimeSnapshot))}</strong>
                    <span>Ticks</span>
                    <strong>{compactValue(runtimeTickRate(selectedRuntimeSnapshot))}</strong>
                    <span>Scripts</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.scriptBundle?.executableScripts)}</strong>
                    <span>Fields</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.editableFields.length)}</strong>
                    <span>Windows</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.windowIds.length)}</strong>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "plugin-manager" ? (
              <div className="runtime-panel plugin-manager-panel">
                <div className="mini-section">
                  <h3>Plugin Manager</h3>
                  <div className="runtime-actions plugin-manager-actions">
                    <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void reloadPlugins()}>
                      <RefreshCw size={14} />
                      Reload Plugins
                    </button>
                    <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void openPluginsFolder()}>
                      <FolderInput size={14} />
                      Open Folder
                    </button>
                    <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void installPluginFromFolder()}>
                      <Plus size={14} />
                      Install From Folder
                    </button>
                  </div>
                  <div className="kv-grid">
                    <span>User Root</span>
                    <strong>{compactValue(pluginRegistryState?.userPluginRoot)}</strong>
                    <span>Portable Root</span>
                    <strong>{compactValue(pluginRegistryState?.portablePluginRoot)}</strong>
                    <span>Plugins</span>
                    <strong>{compactValue(availablePlugins.length)}</strong>
                    <span>Enabled</span>
                    <strong>{compactValue(availablePlugins.filter((plugin) => pluginEnabledById[plugin.id] !== false).length)}</strong>
                  </div>
                  {pluginManagerMessage || pluginRegistryState?.message ? (
                    <p className="runtime-message">{pluginManagerMessage || pluginRegistryState?.message}</p>
                  ) : null}
                </div>

                <div className="mini-section">
                  <h3>Create Plugin</h3>
                  <div className="inline-field-grid">
                    <label className="field-stack">
                      <span>Plugin Id</span>
                      <input value={newPluginId} onChange={(event) => setNewPluginId(event.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
                    </label>
                    <label className="field-stack">
                      <span>Name</span>
                      <input value={newPluginName} onChange={(event) => setNewPluginName(event.currentTarget.value)} />
                    </label>
                  </div>
                  <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !newPluginId.trim()} onClick={() => void createPluginFromTemplate()}>
                    <Plus size={14} />
                    Create From Template
                  </button>
                </div>

                <div className="mini-section">
                  <h3>Installed Plugins</h3>
                  <div className="plugin-manager-list" aria-label="Installed plugins">
                    {availablePlugins.map((plugin) => {
                      const pinned = pinnedPluginIds.has(plugin.id);
                      const enabled = pluginEnabledById[plugin.id] !== false;
                      return (
                        <div className={`plugin-manager-row ${enabled ? "enabled" : "disabled"} ${pinned ? "pinned" : ""}`} key={plugin.id}>
                          <div className="plugin-manager-row-main">
                            <div className="panel-icon">
                              <PluginIcon plugin={plugin} />
                            </div>
                            <div>
                              <strong>{plugin.name}</strong>
                              <small>
                                {originLabel(plugin.origin ?? "built-in")} / {labelCase(plugin.category)} / {statusLabel(plugin.status)}
                              </small>
                              <p>{plugin.summary}</p>
                            </div>
                            <label className="switch-row">
                              <input
                                type="checkbox"
                                checked={enabled}
                                disabled={pinned || !desktopBridgeAvailable}
                                onChange={(event) => void setPluginEnabled(plugin, event.currentTarget.checked)}
                              />
                              <span>{pinned ? "Pinned" : enabled ? "Enabled" : "Disabled"}</span>
                            </label>
                          </div>
                          <div className="chip-list permission-chip-list">
                            {(plugin.permissions ?? []).map((permission) => (
                              <span key={permission}>{permissionLabel(permission)}</span>
                            ))}
                            {(plugin.permissions ?? []).length === 0 ? <span>No permissions</span> : null}
                          </div>
                          <div className="plugin-surface-grid">
                            {plugin.uiSurfaces.map((surface) => (
                              <label className="toggle-row checkbox-first-row" key={surface.id}>
                                <input
                                  type="checkbox"
                                  checked={pluginSurfaceEnabledByPluginId[plugin.id]?.[surface.id] ?? surface.enabledByDefault}
                                  disabled={!desktopBridgeAvailable || !enabled}
                                  onChange={(event) => void setPluginSurfaceEnabled(plugin.id, surface.id, event.currentTarget.checked)}
                                />
                                <span>
                                  <strong>{surface.label}</strong>
                                  <small>{labelCase(surface.kind)} / {surface.summary}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                          {plugin.loadError ? <p className="runtime-message">{plugin.loadError}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(pluginRegistryState?.loadErrors.length ?? 0) > 0 ? (
                  <div className="mini-section">
                    <h3>Load Errors</h3>
                    <div className="mini-table">
                      {pluginRegistryState?.loadErrors.map((error) => (
                        <p key={`${error.sourcePath}:${error.message}`}>
                          <span>{compactValue(error.pluginId ?? "Plugin")}</span>
                          <strong>{error.message}</strong>
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedPlugin.id === "settings" ? (
              <div className="runtime-panel settings-panel">
                <div className="mini-section">
                  <h3>Engine</h3>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={engineLaunch?.settings?.customHotelView === true}
                      disabled={!desktopBridgeAvailable || engineBusy || engineLaunch?.status === "running"}
                      onChange={(event) => void updateEngineLaunchSettings({ customHotelView: event.currentTarget.checked }, `Custom hotel view ${event.currentTarget.checked ? "enabled" : "disabled"}.`)}
                    />
                    <span>
                      <strong>Custom Hotel View</strong>
                      <small>Use the Habbpy hotel view when launching compatible profiles.</small>
                    </span>
                  </label>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={engineLaunch?.settings?.resizablePresentation !== false}
                      disabled={!desktopBridgeAvailable || engineBusy || engineLaunch?.status === "running"}
                      onChange={(event) => void updateEngineLaunchSettings({ resizablePresentation: event.currentTarget.checked }, `Responsive stage resize ${event.currentTarget.checked ? "enabled" : "disabled"}.`)}
                    />
                    <span>
                      <strong>Responsive Stage Resize</strong>
                      <small>Adapt the stage to the app window while preserving the Director room.</small>
                    </span>
                  </label>
                  <div className="runtime-input-row">
                    <input
                      value={versionCheckDraft}
                      onChange={(event) => setVersionCheckDraft(event.currentTarget.value.replace(/[^\d]/g, ""))}
                      placeholder="VERSIONCHECK auto"
                      aria-label="Version check build override"
                    />
                    <button type="button" disabled={!desktopBridgeAvailable || engineBusy} onClick={applyVersionCheckBuild}>
                      Apply
                    </button>
                    <button
                      type="button"
                      disabled={!desktopBridgeAvailable || engineBusy}
                      onClick={() => {
                        setVersionCheckDraft("");
                        void updateEngineLaunchSettings({ versionCheckBuild: null }, "Version check override cleared.");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Performance</h3>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={appPreferences?.hardwareAcceleration ?? true}
                      onChange={(event) => void updateHardwareAccelerationPreference(event.currentTarget.checked)}
                      disabled={!desktopBridgeAvailable}
                    />
                    <span>
                      <strong>Hardware Acceleration</strong>
                      <small>{appPreferences?.hardwareAccelerationRestartRequired ? "Restart required for this change." : "GPU acceleration is active when available."}</small>
                    </span>
                  </label>
                  <div className="mini-table">
                    <p>
                      <span>GPU Launch</span>
                      <strong>{appPreferences?.hardwareAccelerationActive === false ? "Disabled" : "Enabled"}</strong>
                    </p>
                    <p>
                      <span>Preference</span>
                      <strong>{appPreferences?.hardwareAcceleration === false ? "Disabled" : "Enabled"}</strong>
                    </p>
                    <p>
                      <span>Restart</span>
                      <strong>{appPreferences?.hardwareAccelerationRestartRequired ? "Required" : "Not Required"}</strong>
                    </p>
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Hotkeys</h3>
                  <div className="inline-field-grid">
                    <label className="field-stack">
                      <span>Key</span>
                      <input value={settingsBindKey} onChange={(event) => setSettingsBindKey(event.currentTarget.value)} />
                    </label>
                    <label className="field-stack">
                      <span>Command</span>
                      <input value={settingsBindCommand} onChange={(event) => setSettingsBindCommand(event.currentTarget.value)} />
                    </label>
                  </div>
                  <div className="runtime-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !settingsBindKey.trim() || !settingsBindCommand.trim()}
                      onClick={() => void runMultiAccountCommand(`bind ${commandArg(settingsBindKey.trim())} ${commandArg(settingsBindCommand.trim())}`)}
                    >
                      Save Binding
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !settingsBindKey.trim()}
                      onClick={() => void runMultiAccountCommand(`unbind ${commandArg(settingsBindKey.trim())}`)}
                    >
                      Remove Binding
                    </button>
                  </div>
                  <div className="mini-table">
                    {(consoleCommandState?.bindings ?? []).map((binding) => (
                      <p key={binding.key}>
                        <span>{binding.key}</span>
                        <strong>{binding.command}</strong>
                      </p>
                    ))}
                    {(consoleCommandState?.bindings.length ?? 0) === 0 ? (
                      <p>
                        <span>Bindings</span>
                        <strong>No bindings configured.</strong>
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Console</h3>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={packetFilters.wrap}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setPacketFilters((current) => ({ ...current, wrap: checked }));
                        void updateAppPreferencePatch(
                          { packetOutputWrap: checked },
                          `Packet text wrapping ${checked ? "enabled" : "disabled"}.`,
                        );
                      }}
                    />
                    <span>
                      <strong>Wrap Packet Text</strong>
                      <small>Wrap long packet rows in the console and Packet Log panel.</small>
                    </span>
                  </label>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={packetFilters.autoscroll}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setPacketFilters((current) => ({ ...current, autoscroll: checked }));
                        void updateAppPreferencePatch(
                          { packetOutputAutoScroll: checked },
                          `Packet auto scroll ${checked ? "enabled" : "disabled"}.`,
                        );
                      }}
                    />
                    <span>
                      <strong>Auto Scroll Packet Output</strong>
                      <small>Keep packet views pinned to the newest live rows.</small>
                    </span>
                  </label>
                </div>

                <div className="mini-section">
                  <h3>Session Defaults</h3>
                  <label className="field-stack">
                    <span>Account File</span>
                    <input value={multiAccountFile} onChange={(event) => setMultiAccountFile(event.currentTarget.value)} />
                  </label>
                  <div className="inline-field-grid">
                    <label className="field-stack">
                      <span>Count</span>
                      <input value={multiAccountCount} onChange={(event) => setMultiAccountCount(event.currentTarget.value.replace(/[^\d]/g, ""))} />
                    </label>
                    <label className="field-stack">
                      <span>Concurrency</span>
                      <input
                        value={multiAccountConcurrency}
                        onChange={(event) => setMultiAccountConcurrency(event.currentTarget.value.replace(/[^\d]/g, ""))}
                      />
                    </label>
                  </div>
                  <label className="field-stack">
                    <span>Key Env</span>
                    <input value={multiAccountKeyEnv} onChange={(event) => setMultiAccountKeyEnv(event.currentTarget.value)} />
                  </label>
                  <label className="field-stack">
                    <span>Summon Target</span>
                    <input value={multiAccountSummonTarget} onChange={(event) => setMultiAccountSummonTarget(event.currentTarget.value)} />
                  </label>
                  <label className="field-stack">
                    <span>Default Load Mode</span>
                    <select
                      value={multiAccountLoadMode}
                      onChange={(event) => setMultiAccountLoadMode(event.currentTarget.value === "visible" ? "visible" : "headless")}
                    >
                      <option value="headless">Headless</option>
                      <option value="visible">Visible</option>
                    </select>
                  </label>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={appPreferences?.autoSubmitVisibleLogin !== false}
                      disabled={!desktopBridgeAvailable}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        void updateAppPreferencePatch(
                          { autoSubmitVisibleLogin: checked },
                          `Visible client auto-login ${checked ? "enabled" : "disabled"}.`,
                        );
                      }}
                    />
                    <span>
                      <strong>Auto-submit Visible Logins</strong>
                      <small>Automatically submits credentials for loaded visible client sessions.</small>
                    </span>
                  </label>
                  <div className="runtime-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
                      onClick={() => void saveSessionDefaultPreferences()}
                    >
                      Save Defaults
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
                      onClick={() =>
                        void runMultiAccountCommand(
                          `load ${commandArg(multiAccountFile.trim())} ${clampMultiAccountCount(multiAccountCount)}${multiAccountLoadMode === "headless" ? " --headless" : ""} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
                        )
                      }
                    >
                      Load Default
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.origin === "user" ? (
              <div className="runtime-panel user-plugin-panel">
                <div className="mini-section">
                  <h3>{selectedPlugin.name}</h3>
                  <p className="runtime-message">{selectedPlugin.summary}</p>
                  <div className="kv-grid">
                    <span>Status</span>
                    <strong>{statusLabel(selectedPlugin.status)}</strong>
                    <span>Version</span>
                    <strong>{compactValue(selectedPlugin.version)}</strong>
                    <span>Author</span>
                    <strong>{compactValue(selectedPlugin.author)}</strong>
                    <span>Category</span>
                    <strong>{labelCase(selectedPlugin.category)}</strong>
                    <span>Entry</span>
                    <strong>{compactValue(selectedPlugin.entry ? selectedPlugin.entry.split(/[\\/]/).pop() : null)}</strong>
                    <span>Surfaces</span>
                    <strong>{compactValue(selectedPlugin.uiSurfaces.length)}</strong>
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Permissions</h3>
                  <div className="chip-list permission-chip-list">
                    {(selectedPlugin.permissions ?? []).map((permission) => (
                      <span key={permission}>{permissionLabel(permission)}</span>
                    ))}
                    {(selectedPlugin.permissions ?? []).length === 0 ? <span>No permissions</span> : null}
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Surfaces</h3>
                  <div className="mini-table">
                    {selectedPlugin.uiSurfaces.map((surface) => (
                      <p key={surface.id}>
                        <span>{surface.label}</span>
                        <strong>{labelCase(surface.kind)} / {(pluginSurfaceEnabledByPluginId[selectedPlugin.id]?.[surface.id] ?? surface.enabledByDefault) ? "Enabled" : "Disabled"}</strong>
                      </p>
                    ))}
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Files</h3>
                  <div className="runtime-actions">
                    <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void openPluginsFolder()}>
                      <FolderInput size={14} />
                      Open Plugins Folder
                    </button>
                    <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void reloadPlugins()}>
                      <RefreshCw size={14} />
                      Reload Plugin List
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "multi-account" ? (
              <div className="runtime-panel multi-account-panel">
                <div className="mini-section">
                  <h3>Sessions</h3>
                  <div className="kv-grid">
                    <span>Selected</span>
                    <strong>client{selectedClientId} / {compactValue(selectedClientSession?.label)}</strong>
                    <span>Main</span>
                    <strong>{mainClientSession ? `client${mainClientSession.id} / ${mainClientSession.label}` : `client${clientSessions?.mainClientId ?? 1}`}</strong>
                    <span>Running</span>
                    <strong>{compactValue((clientSessions?.sessions ?? []).filter((session) => session.status === "running").length)}</strong>
                    <span>Headless</span>
                    <strong>{compactValue((clientSessions?.sessions ?? []).filter((session) => session.headless).length)}</strong>
                  </div>
                  <div className="multi-session-list" aria-label="Multi account sessions">
                    {(clientSessions?.sessions ?? []).map((session) => (
                      <div
                        key={session.id}
                        className={`multi-session-row ${session.selected ? "active" : ""} ${session.main ? "main" : ""}`}
                      >
                        <button
                          className="multi-session-select"
                          type="button"
                          onClick={() => void selectClientSession(session.id)}
                          title={clientSessionTitle(session)}
                        >
                          <span>client{session.id}</span>
                          <strong>{session.label}</strong>
                          <small>{session.username || "-"} / {session.roomName || "-"}</small>
                          <em>{session.headless ? "headless" : "visible"} {session.main ? "/ main" : ""}</em>
                        </button>
                        <button
                          className="multi-session-close"
                          type="button"
                          disabled={!desktopBridgeAvailable || session.id === 1}
                          onClick={() => void runMultiAccountCommand(`close ${session.id}`)}
                          title={session.id === 1 ? "Use Stop for client1" : `Close client${session.id}`}
                          aria-label={`Close client ${session.id}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="runtime-actions multi-account-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void refreshClientSessions().then(() => refreshMimicState())}
                    >
                      Refresh
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand("newclient")}
                    >
                      New Visible
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand(`main ${selectedClientId}`)}
                    >
                      Set Main
                    </button>
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Load Accounts</h3>
                  <label className="field-stack">
                    <span>Account File</span>
                    <input value={multiAccountFile} onChange={(event) => setMultiAccountFile(event.currentTarget.value)} />
                  </label>
                  <div className="inline-field-grid">
                    <label className="field-stack">
                      <span>Count</span>
                      <input value={multiAccountCount} onChange={(event) => setMultiAccountCount(event.currentTarget.value.replace(/[^\d]/g, ""))} />
                    </label>
                    <label className="field-stack">
                      <span>Concurrency</span>
                      <input value={multiAccountConcurrency} onChange={(event) => setMultiAccountConcurrency(event.currentTarget.value.replace(/[^\d]/g, ""))} />
                    </label>
                  </div>
                  <label className="field-stack">
                    <span>Key Env</span>
                    <input value={multiAccountKeyEnv} onChange={(event) => setMultiAccountKeyEnv(event.currentTarget.value)} />
                  </label>
                  <div className="runtime-actions multi-account-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
                      onClick={() =>
                        void runMultiAccountCommand(
                          `load ${commandArg(multiAccountFile.trim())} ${clampMultiAccountCount(multiAccountCount)} --headless --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
                        )
                      }
                    >
                      Load Headless
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
                      onClick={() =>
                        void runMultiAccountCommand(
                          `load ${commandArg(multiAccountFile.trim())} ${clampMultiAccountCount(multiAccountCount)} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
                        )
                      }
                    >
                      Load Visible
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountFile.trim() || !multiAccountKeyEnv.trim()}
                      onClick={() =>
                        void runMultiAccountCommand(
                          `accounts import ${commandArg(multiAccountFile.trim())} --key-env ${multiAccountKeyEnv.trim()}`,
                        )
                      }
                    >
                      Import Store
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountKeyEnv.trim()}
                      onClick={() =>
                        void runMultiAccountCommand(
                          `accounts load ${clampMultiAccountCount(multiAccountCount)} --headless --key-env ${multiAccountKeyEnv.trim()} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
                        )
                      }
                    >
                      Store Headless
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountKeyEnv.trim()}
                      onClick={() =>
                        void runMultiAccountCommand(
                          `accounts load ${clampMultiAccountCount(multiAccountCount)} --key-env ${multiAccountKeyEnv.trim()} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
                        )
                      }
                    >
                      Store Visible
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand("list")}
                    >
                      List
                    </button>
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Summon</h3>
                  <label className="field-stack">
                    <span>Target</span>
                    <input value={multiAccountSummonTarget} onChange={(event) => setMultiAccountSummonTarget(event.currentTarget.value)} />
                  </label>
                  <div className="runtime-actions multi-account-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountSummonTarget.trim()}
                      onClick={() => void runMultiAccountCommand(`summon ${commandArg(multiAccountSummonTarget.trim())}`)}
                    >
                      Summon
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || !multiAccountSummonTarget.trim()}
                      onClick={() => void runMultiAccountCommand(`summon ${commandArg(multiAccountSummonTarget.trim())} --room`)}
                    >
                      Enter Room
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand("summon headless")}
                    >
                      Summon Headless
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand("summon all")}
                    >
                      Summon All
                    </button>
                  </div>
                </div>

                <div className="mini-section">
                  <h3>Mimic</h3>
                  <div className="kv-grid">
                    <span>State</span>
                    <strong>{mimicState?.enabled ? "On" : "Off"}</strong>
                    <span>Mimic From</span>
                    <strong>{mimicSourceSession ? `client${mimicSourceSession.id} / ${mimicSourceSession.label}` : `client${mimicState?.sourceClientId ?? 1}`}</strong>
                    <span>Targets</span>
                    <strong>{mimicTargetSessions.length > 0 ? mimicTargetSessions.map((session) => `client${session.id}`).join(", ") : "-"}</strong>
                    <span>Forwarded</span>
                    <strong>{compactValue(mimicState?.forwardedCount)}</strong>
                  </div>
                  <div className="runtime-actions multi-account-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand(`mimic on --source ${mainMimicSourceId}`)}
                    >
                      Enable From Main
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand("mimic off")}
                    >
                      Disable
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand(`mimic source ${selectedClientId}`)}
                    >
                      Use Selected
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void runMultiAccountCommand("mimic status")}
                    >
                      Status
                    </button>
                  </div>
                  {mimicCategoryOptions.map((option) => {
                    const checked = mimicState?.categories[option.id] !== false;
                    return (
                      <label className="toggle-row checkbox-first-row" key={option.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!desktopBridgeAvailable}
                          onChange={(event) => void runMultiAccountCommand(`mimic set ${option.id} ${event.currentTarget.checked ? "on" : "off"}`)}
                        />
                        <span>
                          <strong>{option.label}</strong>
                          <small>{option.detail}</small>
                        </span>
                      </label>
                    );
                  })}
                  {mimicState?.lastError ? <p className="runtime-message">{mimicState.lastError}</p> : null}
                </div>

                {multiAccountMessage ? <pre className="multi-account-output">{multiAccountMessage}</pre> : null}
              </div>
            ) : null}

            {selectedPlugin.id === "info" ? (
              <div className="runtime-panel">
                <button
                  className="wide-action"
                  type="button"
                  onClick={() => void refreshRuntimeSnapshot()}
                  disabled={!engineUrl || runtimeBusy}
                >
                  <RefreshCw size={14} />
                  <span>Read Info</span>
                </button>
                <div className="kv-grid">
                  <span>Name</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.sessionUserName)}</strong>
                  <span>Account ID</span>
                  <strong>{compactValue(selectedUser?.accountId)}</strong>
                  <span>Badge</span>
                  <strong>{packetInfoState.activeBadgeCode !== "-" ? packetInfoState.activeBadgeCode : compactValue(selectedUser?.badgeCode)}</strong>
                  <span>Room</span>
                  <strong>{runtimeRoomName(selectedRuntimeSnapshot)} [{runtimeRoomId(selectedRuntimeSnapshot)}]</strong>
                  <span>Owner</span>
                  <strong>{runtimeRoomOwner(selectedRuntimeSnapshot)}</strong>
                  <span>Layout</span>
                  <strong>{compactValue(runtimeRoomProp(selectedRuntimeSnapshot, "#layout") ?? runtimeRoomProp(selectedRuntimeSnapshot, "layout"))}</strong>
                  <span>Inventory</span>
                  <strong>{compactValue(inventoryTotalCount)}</strong>
                  <span>Rights</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.rightsCount)}</strong>
                  <span>Friends</span>
                  <strong>{compactValue(packetInfoState.friends.length)}</strong>
                  <span>Badges</span>
                  <strong>{compactValue(packetInfoState.badges.length)}</strong>
                  <span>Effects</span>
                  <strong>{compactValue(packetInfoState.statusEffects.length)}</strong>
                  <span>Prefs</span>
                  <strong>{compactValue(packetInfoState.preferences.length)}</strong>
                  <span>Requests</span>
                  <strong>{compactValue(socialRequestCount)}</strong>
                  <span>Messages</span>
                  <strong>{compactValue(socialMessageCount)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Rights</h3>
                  <div className="chip-list">
                    {(selectedRuntimeSnapshot?.userState?.rights ?? []).slice(0, 18).map((right) => (
                      <span key={right}>{right}</span>
                    ))}
                    {(selectedRuntimeSnapshot?.userState?.rights.length ?? 0) === 0 ? <span>none</span> : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Badges</h3>
                  <div className="chip-list">
                    {packetInfoState.badges.slice(0, 24).map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                    {packetInfoState.badges.length === 0 ? <span>none</span> : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Preferences</h3>
                  <div className="mini-table">
                    {packetInfoState.preferences.slice(0, 12).map((preference, index) => (
                      <p key={`${index}:${preference}`}>
                        <span>{index + 1}</span>
                        <strong>{preference}</strong>
                      </p>
                    ))}
                    {packetInfoState.preferences.length === 0 ? (
                      <p>
                        <span>Prefs</span>
                        <strong>-</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Effects</h3>
                  <div className="mini-table">
                    {packetInfoState.statusEffects.slice(0, 12).map((effect) => (
                      <p key={`${effect.name}:${effect.value}`}>
                        <span>{effect.value}</span>
                        <strong>{effect.name}</strong>
                      </p>
                    ))}
                    {packetInfoState.statusEffects.length === 0 ? (
                      <p>
                        <span>Effects</span>
                        <strong>-</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Public User Lookup</h3>
                  <form
                    className="runtime-input-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void lookupPublicUser();
                    }}
                  >
                    <input
                      value={publicLookupName}
                      onChange={(event) => setPublicLookupName(event.currentTarget.value)}
                      placeholder={selectedUserName && selectedUserName !== "-" ? selectedUserName : "Habbo name"}
                      aria-label="Origins public user lookup name"
                    />
                    <button type="submit" disabled={publicLookupBusy}>
                      Lookup
                    </button>
                  </form>
                  <div className="kv-grid">
                    <span>Name</span>
                    <strong>{compactValue(publicLookupResult?.name)}</strong>
                    <span>ID</span>
                    <strong>{compactValue(publicLookupResult?.id)}</strong>
                    <span>Motto</span>
                    <strong>{compactValue(publicLookupResult?.motto)}</strong>
                    <span>Figure</span>
                    <strong>{compactValue(publicLookupResult?.figureString)}</strong>
                    <span>Created</span>
                    <strong>{compactValue(publicLookupResult?.memberSince)}</strong>
                    <span>Visible</span>
                    <strong>{compactValue(publicLookupResult?.profileVisible)}</strong>
                  </div>
                  {publicLookupResult ? <p className="runtime-message">{publicLookupResult.message}</p> : null}
                  {(publicLookupResult?.selectedBadges.length ?? 0) > 0 ? (
                    <div className="chip-list">
                      {publicLookupResult?.selectedBadges.map((badge) => <span key={badge}>{badge}</span>)}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "room" ? (
              <div className="runtime-panel">
                <div className="runtime-actions">
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => void refreshRuntimeSnapshot()}
                    disabled={!engineUrl || runtimeBusy}
                  >
                    <RefreshCw size={14} />
                    <span>Read Live Room</span>
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => void runRuntimeAction({ kind: "showHotelView" })}
                    disabled={!engineUrl || runtimeBusy}
                  >
                    Hotel View
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => void runRuntimeAction({ kind: "openNavigator", view: "nav_pr" })}
                    disabled={!engineUrl || runtimeBusy}
                  >
                    Public Navigator
                  </button>
                </div>
                <form
                  className="runtime-input-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runRuntimeAction({ kind: "enterPrivateRoom", flatId: privateRoomId });
                  }}
                >
                  <input
                    value={privateRoomId}
                    onChange={(event) => setPrivateRoomId(event.currentTarget.value)}
                    placeholder="Flat id"
                    aria-label="Private room flat id"
                  />
                  <button type="submit" disabled={!engineUrl || runtimeBusy}>
                    Enter
                  </button>
                </form>
                <form
                  className="runtime-input-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runRuntimeAction({ kind: "enterPublicRoom", query: publicRoomQuery });
                  }}
                >
                  <input
                    value={publicRoomQuery}
                    onChange={(event) => setPublicRoomQuery(event.currentTarget.value)}
                    placeholder="Public room name, id, unit, or port"
                    aria-label="Public room query"
                  />
                  <button type="submit" disabled={!engineUrl || runtimeBusy}>
                    Enter
                  </button>
                </form>
                <form
                  className="runtime-input-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runRuntimeAction({ kind: "stageClick", x: Number(roomStageClickX), y: Number(roomStageClickY) });
                  }}
                >
                  <input
                    value={roomStageClickX}
                    onChange={(event) => setRoomStageClickX(event.currentTarget.value)}
                    placeholder="Stage x"
                    aria-label="Walk stage x"
                  />
                  <input
                    value={roomStageClickY}
                    onChange={(event) => setRoomStageClickY(event.currentTarget.value)}
                    placeholder="Stage y"
                    aria-label="Walk stage y"
                  />
                  <button type="submit" disabled={!engineUrl || runtimeBusy}>
                    Walk
                  </button>
                </form>
                <div className="kv-grid">
                  <span>View</span>
                  <strong>{runtimeLocation(selectedRuntimeSnapshot)}</strong>
                  <span>Room ID</span>
                  <strong>{runtimeRoomId(selectedRuntimeSnapshot)}</strong>
                  <span>Owner</span>
                  <strong>{runtimeRoomOwner(selectedRuntimeSnapshot)}</strong>
                  <span>Room Type</span>
                  <strong>{runtimeRoomType(selectedRuntimeSnapshot)}</strong>
                  <span>Ready</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomReady?.ready ?? selectedRuntimeSnapshot?.roomEntryState?.roomReady?.ready)}</strong>
                  <span>Entry</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomEntryState?.entryState?.state)}</strong>
                  <span>Layout</span>
                  <strong>{compactValue(runtimeRoomProp(selectedRuntimeSnapshot, "#layout") ?? runtimeRoomProp(selectedRuntimeSnapshot, "layout"))}</strong>
                  <span>Users</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomObjects?.counts.users)}</strong>
                  <span>Floor Objects</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomObjects?.counts.activeObjects)}</strong>
                  <span>Wall Items</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomObjects?.counts.wallItems)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Recent Room Objects</h3>
                  <div className="mini-table">
                    {(selectedRuntimeSnapshot?.roomObjects?.activeObjects ?? []).slice(0, 6).map((entry, index) => (
                      <p key={`${entry.objectId ?? entry.id ?? index}`}>
                        <span>{compactValue(entry.objectId ?? entry.id ?? index)}</span>
                        <strong>{objectTitle(entry)}</strong>
                      </p>
                    ))}
                    {(selectedRuntimeSnapshot?.roomObjects?.activeObjects.length ?? 0) === 0 ? <p>No active room objects yet.</p> : null}
                  </div>
                </div>
                {runtimeMessage ? <p className="runtime-message">{runtimeMessage}</p> : null}
              </div>
            ) : null}

            {selectedPlugin.id === "user" ? (
              <div className="runtime-panel">
                <div className="user-select-row">
                  <select
                    value={selectedUser?.rowId ?? ""}
                    onChange={(event) => setSelectedUserKey(event.currentTarget.value)}
                    disabled={userRows.length === 0}
                    aria-label="Room user"
                  >
                    {userRows.length > 0 ? (
                      userRows.map((user) => (
                        <option key={user.rowId} value={user.rowId}>
                          {userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName)} ({user.rowId})
                        </option>
                      ))
                    ) : (
                      <option value="">No room users</option>
                    )}
                  </select>
                  <button
                    type="button"
                    disabled={!engineUrl || runtimeBusy}
                    onClick={() => void refreshRuntimeSnapshot()}
                    aria-label="Refresh user state"
                    title="Refresh user state"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div className="kv-grid">
                  <span>Session User</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.sessionUserName)}</strong>
                  <span>Room Users</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.roomUserCount ?? selectedRuntimeSnapshot?.roomObjects?.counts.users)}</strong>
                  <span>Room</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.roomName ?? runtimeRoomName(selectedRuntimeSnapshot))}</strong>
                  <span>Owner</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.roomOwner ?? runtimeRoomOwner(selectedRuntimeSnapshot))}</strong>
                  <span>Rights</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.rightsCount)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Profile</h3>
                  <div className="mini-table user-detail-table">
                    <p>
                      <span>Name</span>
                      <strong>{selectedUserName}</strong>
                  </p>
                  <p>
                    <span>Account</span>
                      <strong>{selectedUserAccountId}</strong>
                  </p>
                  <p>
                    <span>Index</span>
                      <strong>{selectedUserIndex}</strong>
                  </p>
                  <p>
                    <span>Gender</span>
                      <strong>{selectedUserGender}</strong>
                  </p>
                  <p>
                    <span>Type</span>
                      <strong>{selectedUserType}</strong>
                  </p>
                  <p>
                    <span>Badge</span>
                      <strong>{selectedUserBadgeCode}</strong>
                  </p>
                  <p>
                    <span>Motto</span>
                      <strong>{selectedUserMotto}</strong>
                  </p>
                </div>
              </div>
                <div className="mini-section">
                  <h3>State</h3>
                  <div className="mini-table user-detail-table">
                    <p>
                      <span>Position</span>
                      <strong>{selectedUserPosition}</strong>
                    </p>
                    <p>
                      <span>Direction</span>
                      <strong>{compactValue(selectedUser?.direction)}</strong>
                    </p>
                    <p>
                      <span>Activity</span>
                      <strong>{compactValue(selectedUser?.activity)}</strong>
                    </p>
                    <p>
                      <span>Typing</span>
                      <strong>{compactValue(selectedUser?.typing)}</strong>
                    </p>
                    <p>
                      <span>Expression</span>
                      <strong>{compactValue(selectedUser?.expression)}</strong>
                    </p>
                    <p>
                      <span>Last Said</span>
                      <strong>{compactValue(selectedUser?.lastSaid)}</strong>
                    </p>
                    <p>
                      <span>Last Action</span>
                      <strong>{compactValue(selectedUser?.lastAction)}</strong>
                    </p>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Appearance</h3>
                  <div className="mini-table user-detail-table">
                    <p>
                      <span>Figure</span>
                      <strong>{selectedUserFigure}</strong>
                    </p>
                    <p>
                      <span>PH Figure</span>
                      <strong>{selectedUserPoolFigure}</strong>
                    </p>
                    <p>
                      <span>Sprites</span>
                      <strong>{compactValue(selectedUser?.spriteCount)}</strong>
                    </p>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Profile Tools</h3>
                  {userToolMessage ? <p className="runtime-message">{userToolMessage}</p> : null}
                  <div className="runtime-actions user-tool-actions">
                    <button className="wide-action" type="button" disabled={!selectedUser} onClick={() => void copyUserValue("name", selectedUserName)}>
                      <Copy size={12} /> Name
                    </button>
                    <button className="wide-action" type="button" disabled={!selectedUser} onClick={() => void copySelectedUserProfile()}>
                      <Copy size={12} /> Profile
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!selectedUser || selectedUserMotto === "-"}
                      onClick={() => void copyUserValue("motto", selectedUserMotto)}
                    >
                      <Copy size={12} /> Motto
                    </button>
                    <button className="wide-action" type="button" disabled={!selectedUser || selectedUserFigure === "-"} onClick={() => void copyUserValue("figure", selectedUserFigure)}>
                      <Copy size={12} /> Figure
                    </button>
                    <button className="wide-action" type="button" disabled={!selectedUser || selectedUserFigure === "-"} onClick={storeSelectedUserLook}>
                      <FolderInput size={12} /> Store Look
                    </button>
                    <button className="wide-action" type="button" disabled={!activeStoredUserLook} onClick={() => void copyStoredUserLook()}>
                      <Copy size={12} /> Stored
                    </button>
                  </div>
                  <div className="user-stored-look-row">
                    <select
                      value={activeStoredUserLook}
                      onChange={(event) => setSelectedStoredUserLook(event.currentTarget.value)}
                      disabled={userStoredLooks.length === 0}
                      aria-label="Stored user look"
                    >
                      {userStoredLooks.length > 0 ? (
                        userStoredLooks.map((look) => (
                          <option key={look} value={look}>
                            {look}
                          </option>
                        ))
                      ) : (
                        <option value="">No stored parsed looks</option>
                      )}
                    </select>
                    <button type="button" title="Copy stored look" aria-label="Copy stored look" disabled={!activeStoredUserLook} onClick={() => void copyStoredUserLook()}>
                      <Copy size={12} />
                    </button>
                    <button type="button" title="Clear stored looks" aria-label="Clear stored looks" disabled={userStoredLooks.length === 0} onClick={clearStoredUserLooks}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Room Users</h3>
                  <div className="mini-table user-list-table">
                    {userRows.slice(0, 12).map((user) => (
                      <p key={user.rowId}>
                        <span>{compactValue(user.rowId)}</span>
                        <strong>{userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName)} / {userRowMeta(user, selectedRuntimeSnapshot?.userState?.sessionUserName)}</strong>
                      </p>
                    ))}
                    {userRows.length === 0 ? (
                      <p>No room users are available until a room session is active.</p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Session Rights</h3>
                  <div className="chip-list">
                    {(selectedRuntimeSnapshot?.userState?.rights ?? []).slice(0, 14).map((right) => (
                      <span key={right}>{right}</span>
                    ))}
                    {(selectedRuntimeSnapshot?.userState?.rights.length ?? 0) === 0 ? <span>none</span> : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Actions</h3>
                  <div className="runtime-actions user-tool-actions user-action-blocks">
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "wave" }, "Wave")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Wave
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "dance", number: 1 }, "Dance")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Dance 1
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "dance", number: 2 }, "Dance 2")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Dance 2
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "dance", number: 3 }, "Dance 3")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Dance 3
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "dance", number: 4 }, "Dance 4")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Dance 4
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "stopDance" }, "Stop Dance")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Stop Dance
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "hcdance", number: 2 }, "HC Dance")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      HC Dance
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "carryDrink" }, "Carry Drink")}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      Carry Drink
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "applyLook", figure: selectedUserFigure }, "Apply Look")}
                      disabled={!engineUrl || runtimeBusy || selectedUserFigure === "-"}
                    >
                      Apply Look
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => void sendUserAction({ action: "applyLook", figure: activeStoredUserLook }, "Apply Stored Look")}
                      disabled={!engineUrl || runtimeBusy || !activeStoredUserLook}
                    >
                      Apply Stored
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => {
                        const enabled = !engineUserNameLabels;
                        setEngineUserNameLabels(enabled);
                        void runRuntimeAction({ kind: "setUserNameLabels", enabled });
                      }}
                      disabled={!engineUrl || runtimeBusy}
                    >
                      {engineUserNameLabels ? "Hide Names" : "Show Names"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "items" ? (
              <div className="runtime-panel">
                <div className="runtime-input-row item-filter-row">
                  <input
                    value={itemFilter}
                    onChange={(event) => setItemFilter(event.currentTarget.value)}
                    placeholder="Search items"
                    aria-label="Search items"
                  />
                  <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                    Read
                  </button>
                </div>
                {socialMessage ? <p className="runtime-message">{socialMessage}</p> : null}
                <div className="kv-grid">
                  <span>Floor Active</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomObjects?.counts.activeObjects)}</strong>
                  <span>Floor Passive</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomObjects?.counts.passiveObjects)}</strong>
                  <span>Wall Items</span>
                  <strong>{compactValue(itemWallCount)}</strong>
                  <span>Filtered</span>
                  <strong>{compactValue(filteredItemRows.length)}</strong>
                  <span>Selected</span>
                  <strong>{selectedItemRow ? `${selectedItemRow.label} ${compactValue(selectedItemRow.item.objectId ?? selectedItemRow.item.id)}` : "-"}</strong>
                  <span>Catalogue</span>
                  <strong>{compactValue(furniMetadata ? `${furniMetadata.entryCount} entries` : null)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Items</h3>
                  <div className="item-list">
                    {filteredItemRows.slice(0, 18).map((row) => (
                      <button
                        className={`item-row ${selectedItemRow?.key === row.key ? "active" : ""}`}
                        key={row.key}
                        type="button"
                        onClick={() => setSelectedItemKey(row.key)}
                      >
                        <span>{row.label}</span>
                        <div>
                          <strong>{itemRowTitle(row, furniMetadata)}</strong>
                          <small>{itemRowMeta(row, furniMetadata)}</small>
                        </div>
                      </button>
                    ))}
                    {filteredItemRows.length === 0 ? (
                      <div className="item-row empty">
                        <span>-</span>
                        <div>
                          <strong>{roomReady ? "No matching items" : "Waiting for room item data"}</strong>
                          <small>{roomReady ? "No matching items." : "Enter a room to populate the item list."}</small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Selected Detail</h3>
                  <div className="mini-table item-detail-table">
                    <p>
                      <span>Type</span>
                      <strong>{compactValue(selectedItemRow?.label)}</strong>
                    </p>
                    <p>
                      <span>ID</span>
                      <strong>{compactValue(selectedItemRow?.item.objectId ?? selectedItemRow?.item.id)}</strong>
                    </p>
                    <p>
                      <span>Class</span>
                      <strong>{compactValue(selectedItemRow?.item.className)}</strong>
                    </p>
                    <p>
                      <span>Name</span>
                      <strong>{furniDisplayName(furniMetadata, selectedItemRow?.item)}</strong>
                    </p>
                    <p>
                      <span>Furni ID</span>
                      <strong>{compactValue(selectedItemMetadata?.id)}</strong>
                    </p>
                    <p>
                      <span>Category</span>
                      <strong>{compactValue(selectedItemMetadata?.category)}</strong>
                    </p>
                    <p>
                      <span>Desc</span>
                      <strong>{compactValue(selectedItemMetadata?.description)}</strong>
                    </p>
                    <p>
                      <span>XY</span>
                      <strong>{compactValue(selectedItemRow?.item.x)}, {compactValue(selectedItemRow?.item.y)}, {compactValue(selectedItemRow?.item.z)}</strong>
                    </p>
                    <p>
                      <span>Direction</span>
                      <strong>{compactValue(selectedItemRow?.item.direction)}</strong>
                    </p>
                    <p>
                      <span>Owner</span>
                      <strong>{compactValue(selectedItemRow?.item.ownerName)}</strong>
                    </p>
                    <p>
                      <span>Wall</span>
                      <strong>{compactValue(selectedItemRow?.item.wall)}</strong>
                    </p>
                    <p>
                      <span>Local</span>
                      <strong>{compactValue(selectedItemRow?.item.local)}</strong>
                    </p>
                    <p>
                      <span>Face</span>
                      <strong>{compactValue(selectedItemRow?.item.orientation)}</strong>
                    </p>
                    <p>
                      <span>Raw Loc</span>
                      <strong>{compactValue(selectedItemRow?.item.rawLocation)}</strong>
                    </p>
                    <p>
                      <span>State</span>
                      <strong>{compactValue(selectedItemRow?.item.state)}</strong>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "inventory" ? (
              <div className="runtime-panel">
                <button
                  className="wide-action"
                  type="button"
                  disabled={!engineUrl || runtimeBusy}
                  onClick={() => void runRuntimeAction({ kind: "requestInventory" })}
                >
                  Request Hand
                </button>
                <div className="runtime-input-row item-filter-row">
                  <input
                    value={inventoryFilter}
                    onChange={(event) => setInventoryFilter(event.currentTarget.value)}
                    placeholder="Search inventory"
                    aria-label="Search inventory"
                  />
                  <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot(["inventory"])}>
                    Read
                  </button>
                </div>
                <div className="kv-grid">
                  <span>Total</span>
                  <strong>{compactValue(inventoryTotalCount)}</strong>
                  <span>Rows</span>
                  <strong>{compactValue(inventoryRowCount)}</strong>
                  <span>Floor</span>
                  <strong>{compactValue(inventoryFloorCount)}</strong>
                  <span>Wall</span>
                  <strong>{compactValue(inventoryWallCount)}</strong>
                  <span>State</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.inventory?.openState)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Inventory Items</h3>
                  <div className="item-list inventory-table">
                    {filteredInventoryRows.slice(0, 24).map((row) => (
                      <button
                        className={`item-row ${selectedInventoryRow?.key === row.key ? "active" : ""}`}
                        key={row.key}
                        type="button"
                        onClick={() => setSelectedInventoryKey(row.key)}
                      >
                        <span>{row.kind}</span>
                        <div>
                          <strong>{row.title}</strong>
                          <small>{row.meta}</small>
                        </div>
                      </button>
                    ))}
                    {filteredInventoryRows.length === 0 ? (
                      <button className="item-row empty" type="button" disabled>
                        <span>Empty</span>
                        <div>
                          <strong>
                            {inventoryRows.length === 0
                              ? selectedRuntimeSnapshot?.inventory?.note ?? "Waiting for inventory packet rows."
                              : "No inventory rows match the filter."}
                          </strong>
                          <small>{inventoryRows.length === 0 ? "Use Request Hand or wait for STRIPINFO_2." : "Clear the search filter."}</small>
                        </div>
                      </button>
                    ) : null}
                  </div>
                </div>
                {selectedInventoryRow ? (
                  <div className="mini-section">
                    <h3>Item Detail</h3>
                    <div className="mini-table item-detail-table">
                      {selectedInventoryRow.detailRows.map((row) => (
                        <p key={row.label}>
                          <span>{row.label}</span>
                          <strong>{compactValue(row.value)}</strong>
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {selectedPlugin.id === "social" ? (
              <div className="runtime-panel">
                <div className="runtime-input-row visitor-filter-row">
                  <input
                    value={socialFriendFilter}
                    onChange={(event) => setSocialFriendFilter(event.currentTarget.value)}
                    placeholder="Search friends"
                    aria-label="Search friends"
                  />
                  <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                    Read
                  </button>
                </div>
                <div className="kv-grid">
                  <span>Friends</span>
                  <strong>{compactValue(packetInfoState.friends.length)}</strong>
                  <span>Online</span>
                  <strong>{compactValue(onlinePacketFriends)}</strong>
                  <span>Filtered</span>
                  <strong>{compactValue(filteredPacketFriends.length)}</strong>
                  <span>Badges</span>
                  <strong>{compactValue(packetInfoState.badges.length)}</strong>
                  <span>Active Badge</span>
                  <strong>{compactValue(packetInfoState.activeBadgeCode)}</strong>
                  <span>Rights</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.rightsCount)}</strong>
                  <span>Chat Lines</span>
                  <strong>{compactValue(sourceChatHistory.length > 0 ? sourceChatHistory.length : packetChatEntries.length)}</strong>
                  <span>Room Users</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.roomUserCount)}</strong>
                  <span>Friend Limit</span>
                  <strong>{compactValue(packetInfoState.messengerUserLimit)}</strong>
                  <span>Requests</span>
                  <strong>{compactValue(socialRequestCount)}</strong>
                  <span>Messages</span>
                  <strong>{compactValue(socialMessageCount)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Friends</h3>
                  <div className="mini-table">
                    {filteredPacketFriends.slice(0, 14).map((friend) => {
                      const accountId = packetFriendActionId(friend);
                      return (
                        <p className="social-row" key={packetFriendKey(friend)}>
                          <span>{friend.online ? "On" : "Off"}</span>
                          <strong>{packetFriendTitle(friend)} / {packetFriendMeta(friend)}</strong>
                          <span className="social-row-actions">
                            <button
                              type="button"
                              disabled={!desktopBridgeAvailable || accountId === null || !friend.canFollow}
                              onClick={() => accountId !== null && void sendSocialAction({ action: "followFriend", accountId, name: friend.name }, `Follow friend ${friend.name}`)}
                            >
                              Follow
                            </button>
                            <button
                              type="button"
                              disabled={!desktopBridgeAvailable || accountId === null}
                              onClick={() => accountId !== null && void sendSocialAction({ action: "removeFriend", accountId, name: friend.name }, `Remove friend ${friend.name}`)}
                            >
                              Remove
                            </button>
                          </span>
                        </p>
                      );
                    })}
                    {filteredPacketFriends.length === 0 ? (
                      <p>
                        <span>Friends</span>
                        <strong>{packetInfoState.friends.length === 0 ? "No friend rows parsed yet." : "No friends match the filter."}</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Messages</h3>
                  <div className="mini-table">
                    {visiblePrivateMessages.map((message) => (
                      <p key={message.key}>
                        <span>{message.senderAccountId}</span>
                        <strong>{message.sentAt} / {message.text}</strong>
                      </p>
                    ))}
                    {visiblePrivateMessages.length === 0 ? (
                      <p>
                        <span>Messages</span>
                        <strong>{packetInfoState.messengerMessageCount !== "-" ? `${packetInfoState.messengerMessageCount} listed, no rows decoded yet.` : "No private message rows parsed yet."}</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <div className="mini-section-title-row">
                    <h3>Requests</h3>
                    <button
                      type="button"
                      disabled={!desktopBridgeAvailable}
                      onClick={() => void sendSocialAction({ action: "refreshFriendRequests" }, "Refresh friend requests")}
                    >
                      Refresh
                    </button>
                  </div>
                  <div className="mini-table">
                    {visibleFriendRequests.map((request) => {
                      const accountId = packetFriendRequestActionId(request);
                      return (
                        <p className="social-row" key={request.key}>
                          <span>{request.accountId}</span>
                          <strong>{request.name} / request {request.requestId}</strong>
                          <span className="social-row-actions">
                            <button
                              type="button"
                              disabled={!desktopBridgeAvailable || accountId === null}
                              onClick={() => accountId !== null && void sendSocialAction({ action: "acceptRequest", accountId }, `Accept request ${request.name}`)}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={!desktopBridgeAvailable || accountId === null}
                              onClick={() => accountId !== null && void sendSocialAction({ action: "declineRequest", accountId }, `Decline request ${request.name}`)}
                            >
                              Decline
                            </button>
                          </span>
                        </p>
                      );
                    })}
                    {visibleFriendRequests.length === 0 ? (
                      <p>
                        <span>Requests</span>
                        <strong>{packetInfoState.messengerRequestCount !== "-" ? `${packetInfoState.messengerRequestCount} listed, no rows decoded yet.` : "No friend request rows parsed yet."}</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Badges</h3>
                  <div className="chip-list">
                    {packetInfoState.badges.slice(0, 18).map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                    {packetInfoState.badges.length === 0 ? <span>none</span> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "visitors" ? (
              <div className="runtime-panel">
                <div className="runtime-input-row visitor-filter-row">
                  <input
                    value={visitorFilter}
                    onChange={(event) => setVisitorFilter(event.currentTarget.value)}
                    placeholder="Search visitors"
                    aria-label="Search visitors"
                  />
                  <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                    Read
                  </button>
                  <button type="button" disabled={visitorLookupBusy || filteredVisitorEntries.every((entry) => entry.accountId !== "-")} onClick={() => void lookupMissingVisitorProfiles()}>
                    Lookup IDs
                  </button>
                </div>
                <div className="kv-grid">
                  <span>Current</span>
                  <strong>{compactValue(visitorState.activeKeys.length)}</strong>
                  <span>Seen</span>
                  <strong>{compactValue(visitorEntries.length)}</strong>
                  <span>Filtered</span>
                  <strong>{compactValue(filteredVisitorEntries.length)}</strong>
                  <span>Room</span>
                  <strong>{visitorRoomName}</strong>
                  <span>Missing IDs</span>
                  <strong>{compactValue(missingVisitorAccountIds)}</strong>
                  <span>Public Profiles</span>
                  <strong>{compactValue(Object.keys(visitorPublicProfiles).length)}</strong>
                </div>
                {visitorLookupMessage ? <p className="runtime-message">{visitorLookupMessage}</p> : null}
                <div className="mini-section">
                  <h3>Visitors</h3>
                  <div className="visitor-list">
                    {filteredVisitorEntries.map((entry) => (
                      <div className={`visitor-row ${entry.current ? "visitor-current" : "visitor-left"}`} key={entry.key}>
                        <span>{entry.current ? "*" : "-"}</span>
                        <div>
                          <strong>{entry.name}</strong>
                          <small>{visitorMeta(entry)}</small>
                        </div>
                      </div>
                    ))}
                    {filteredVisitorEntries.length === 0 ? (
                      <div className="visitor-row visitor-left">
                        <span>-</span>
                        <div>
                          <strong>{roomReady ? "No matching visitors" : "Waiting for room user data"}</strong>
                          <small>{roomReady ? "No matching visitors." : "Start the embedded client and enter a room."}</small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "chat" ? (
              <div className="runtime-panel">
                <div className="chat-filter-row" aria-label="Chat filters">
                  {(["talk", "whisper", "shout", "system"] as const).map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={chatFilters[kind]}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setChatFilters((current) => ({ ...current, [kind]: checked }));
                        }}
                      />
                      <span>{labelCase(kind)}</span>
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={chatFilters.autoscroll}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setChatFilters((current) => ({ ...current, autoscroll: checked }));
                      }}
                    />
                    <span>auto</span>
                  </label>
                </div>
                <form
                  className="runtime-input-row chat-send-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const message = chatDraft.trim();
                    if (!message) return;
                    setChatDraft("");
                    void runRuntimeAction({ kind: "sendChat", message });
                  }}
                >
                  <input
                    value={chatDraft}
                    onChange={(event) => setChatDraft(event.currentTarget.value)}
                    placeholder={roomReady ? "Send room chat" : "Chat available in room"}
                    aria-label="Room chat message"
                    disabled={!roomReady}
                  />
                  <button type="submit" disabled={!engineUrl || runtimeBusy || !roomReady || !chatDraft.trim()}>
                    Send
                  </button>
                </form>
                <div className="chat-list" aria-label="Room chat history" ref={chatListRef}>
                  {visibleChatHistory.length > 0 ? (
                    visibleChatHistory.map((entry, index) => (
                      <div className="chat-entry" key={chatEntryKey(entry, index)}>
                        <span>{entry.timestamp || "-"}</span>
                        <strong>{chatEntryLabel(entry)}</strong>
                        <p>{entry.text || ""}</p>
                      </div>
                    ))
                  ) : (
                    <p className="empty-panel-note">No chat history is available yet.</p>
                  )}
                </div>
                <button className="wide-action chat-clear-action" type="button" onClick={() => setChatClearOffset(chatHistory.length)}>
                  Clear Display
                </button>
                <div className="kv-grid chat-stats-grid">
                  <span>Room Ready</span>
                  <strong>{compactValue(roomReady)}</strong>
                  <span>Room Messages</span>
                  <strong>{compactValue(activeChatSourceHistory.length)}</strong>
                  <span>Packet Rows</span>
                  <strong>{compactValue(packetChatEntries.length)}</strong>
                  <span>Displayed</span>
                  <strong>{compactValue(visibleChatHistory.length)}</strong>
                </div>
                {runtimeMessage ? <p className="runtime-message">{runtimeMessage}</p> : null}
              </div>
            ) : null}

            {selectedPlugin.id === "automation" ? (
              <div className="runtime-panel">
                <div className="mini-section">
                  <h3>Login Comfort</h3>
                  <label className="toggle-row checkbox-first-row">
                    <input
                      type="checkbox"
                      checked={automationPrefs.autoHideBulletin}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setAutomationPrefs((current) => ({ ...current, autoHideBulletin: checked }));
                        setAutomationMessage(checked ? "Auto-hide Bulletin is enabled." : "Auto-hide Bulletin is disabled.");
                      }}
                    />
                    <span>Auto-hide Bulletin Board after login</span>
                  </label>
                  <div className="runtime-actions automation-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!engineUrl || runtimeBusy}
                      onClick={() => void hideBulletinBoard("manual")}
                    >
                      Hide Bulletin Now
                    </button>
                    <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                      Read Windows
                    </button>
                  </div>
                  {automationMessage ? <p className="runtime-message">{automationMessage}</p> : null}
                </div>
                <div className="kv-grid">
                  <span>Room Ready</span>
                  <strong>{compactValue(roomReady)}</strong>
                  <span>Auto Bulletin</span>
                  <strong>{automationPrefs.autoHideBulletin ? "Enabled" : "Disabled"}</strong>
                  <span>Visible Windows</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.windowIds.length)}</strong>
                  <span>Users</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.roomObjects?.counts.users)}</strong>
                  <span>Fish Areas</span>
                  <strong>{compactValue(fishingAreaRows.length)}</strong>
                  <span>Plants</span>
                  <strong>{compactValue(plantRows.length)}</strong>
                  <span>Wall Items</span>
                  <strong>{compactValue(wallMoverRows.length)}</strong>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "fishing" ? (
              <div className="runtime-panel">
                <div className="runtime-actions automation-actions">
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || !roomReady || runtimeBusy || !selectedFishingAreaRow}
                    onClick={() => void sendFishingStart()}
                  >
                    Start Fishing
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || runtimeBusy}
                    onClick={() => void sendFishingAction({ action: "requestFishopedia" }, "Fishing request Fishopedia")}
                  >
                    Read Fishopedia
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || runtimeBusy}
                    onClick={() => void sendFishingAction({ action: "requestTokens" }, "Fishing request tokens")}
                  >
                    Read Tokens
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || runtimeBusy}
                    onClick={() => void sendFishingAction({ action: "registerDerby" }, "Fishing derby register")}
                  >
                    Register Derby
                  </button>
                  <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                    Refresh
                  </button>
                </div>
                <div className="kv-grid">
                  <span>Room Ready</span>
                  <strong>{compactValue(roomReady)}</strong>
                  <span>Areas</span>
                  <strong>{compactValue(fishingAreaRows.length)}</strong>
                  <span>Target</span>
                  <strong>{compactValue(selectedFishingAreaRow ? objectTitle(selectedFishingAreaRow.item) : null)}</strong>
                  <span>Status</span>
                  <strong>{packetFishingState.status}</strong>
                  <span>Minigame</span>
                  <strong>{packetFishingState.minigameActive ? "active" : "idle"}</strong>
                  <span>Pin</span>
                  <strong>{compactValue(packetFishingState.minigamePin)}</strong>
                  <span>Catches</span>
                  <strong>{compactValue(packetFishingState.catches)}</strong>
                  <span>Golden</span>
                  <strong>{compactValue(packetFishingState.golden)}</strong>
                  <span>XP</span>
                  <strong>{compactValue(packetFishingState.xp)}</strong>
                  <span>Tokens</span>
                  <strong>{compactValue(packetFishingState.tokens)}</strong>
                  <span>Level</span>
                  <strong>{compactValue(packetFishingState.level)}</strong>
                  <span>Frenzies</span>
                  <strong>{compactValue(packetFishingState.frenzies)}</strong>
                  <span>Fishopedia</span>
                  <strong>{compactValue(packetFishingState.fishopedia.length)}</strong>
                  <span>Last Action</span>
                  <strong>{compactValue(packetFishingState.lastClientAction)}</strong>
                </div>
                {fishingMessage || packetFishingState.note !== "-" ? <p className="runtime-message">{fishingMessage || packetFishingState.note}</p> : null}
                <div className="mini-section">
                  <h3>Catch Log</h3>
                  <div className="mini-table">
                    {packetFishingState.catchLog.slice(-8).reverse().map((entry) => (
                      <p key={entry.key}>
                        <span>{entry.golden ? "gold" : "fish"}</span>
                        <strong>{entry.fishName} / +{entry.xp} XP / line {entry.sourceLine}</strong>
                      </p>
                    ))}
                    {packetFishingState.catchLog.length === 0 ? (
                      <p>
                        <span>-</span>
                        <strong>No fishing catch packets parsed yet.</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Active Fishing Areas</h3>
                  <div className="item-list">
                    {fishingAreaRows.slice(0, 8).map((row) => (
                      <div className="item-row empty" key={row.key}>
                        <span>{row.label}</span>
                        <div>
                          <strong>{itemRowTitle(row, furniMetadata)}</strong>
                          <small>{itemRowMeta(row, furniMetadata)}</small>
                        </div>
                      </div>
                    ))}
                    {fishingAreaRows.length === 0 ? (
                      <div className="item-row empty">
                        <span>-</span>
                        <div>
                          <strong>No fishing areas matched</strong>
                          <small>Enter a fishing room to populate this list.</small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Fishopedia</h3>
                  <div className="mini-table">
                    {packetFishingState.fishopedia.slice(0, 10).map((entry) => (
                      <p key={entry.key}>
                        <span>{entry.catches !== "-" ? entry.catches : "-"}</span>
                        <strong>
                          {entry.fishName}
                          {entry.xp !== "-" ? ` / ${entry.xp} XP` : ""}
                          {entry.location !== "-" ? ` / ${entry.location}` : ""}
                        </strong>
                      </p>
                    ))}
                    {packetFishingState.fishopedia.length === 0 ? (
                      <p>
                        <span>-</span>
                        <strong>No Fishopedia packets parsed yet.</strong>
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "present-catcher" ? (
              <div className="runtime-panel present-catcher-panel">
                <div className="runtime-actions automation-actions">
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || !roomReady || presentCatcherRunning}
                    onClick={() => {
                      setPresentCatcherRunning(true);
                      setPresentCatcherMessage("Watching current room for hammers and event presents.");
                    }}
                  >
                    Start
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!presentCatcherRunning}
                    onClick={() => {
                      setPresentCatcherRunning(false);
                      setPresentCatcherMessage("Stopped.");
                    }}
                  >
                    Stop
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || !roomReady}
                    onClick={() => void runPresentCatcherStep(false)}
                  >
                    Step
                  </button>
                  <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot(["core", "room", "inventory"])}>
                    Refresh
                  </button>
                </div>
                <div className="present-catcher-tab-row" role="tablist" aria-label="Present Catcher views">
                  {(["catcher", "gifts", "fragments"] as const).map((tab) => (
                    <button
                      className={presentCatcherTab === tab ? "active" : ""}
                      key={tab}
                      type="button"
                      onClick={() => setPresentCatcherTab(tab)}
                    >
                      {labelCase(tab)}
                    </button>
                  ))}
                </div>
                <div className="kv-grid">
                  <span>Room Ready</span>
                  <strong>{compactValue(roomReady)}</strong>
                  <span>Room</span>
                  <strong>{runtimeRoomName(selectedRuntimeSnapshot)}</strong>
                  <span>Hammers</span>
                  <strong>{compactValue(presentHammerRows.length)}</strong>
                  <span>Presents</span>
                  <strong>{compactValue(presentRows.length)}</strong>
                  <span>Inventory Gifts</span>
                  <strong>{compactValue(presentGiftRows.length)}</strong>
                  <span>Panic Users</span>
                  <strong>{compactValue(presentCatcherPanicNames.length)}</strong>
                  <span>Status</span>
                  <strong>{presentCatcherRunning ? "Running" : "Idle"}</strong>
                  <span>Packets</span>
                  <strong>{compactValue(presentCatcherPacketRows.length)}</strong>
                </div>
                {presentCatcherMessage ? <p className="runtime-message">{presentCatcherMessage}</p> : null}

                {presentCatcherTab === "catcher" ? (
                  <>
                    <div className="mini-section">
                      <h3>Targets</h3>
                      <div className="item-list">
                        {[...presentHammerRows, ...presentRows].slice(0, 12).map((row) => {
                          const isHammer = isPresentCatcherHammerObject(row.item);
                          return (
                            <button
                              className="item-row"
                              key={row.key}
                              type="button"
                              disabled={!desktopBridgeAvailable || !roomReady}
                              onClick={() => void usePresentCatcherFloorItem(row, isHammer ? "hammer" : "present")}
                            >
                              <span>{isHammer ? "Hammer" : "Present"}</span>
                              <div>
                                <strong>{itemRowTitle(row, furniMetadata)}</strong>
                                <small>{itemRowMeta(row, furniMetadata)}</small>
                              </div>
                            </button>
                          );
                        })}
                        {presentHammerRows.length + presentRows.length === 0 ? (
                          <div className="item-row empty">
                            <span>-</span>
                            <div>
                              <strong>No event targets parsed</strong>
                              <small>Enter an event room with hammers or anniversary presents.</small>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mini-section">
                      <h3>Panic List</h3>
                      <form
                        className="runtime-input-row"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const name = presentCatcherPanicDraft.trim();
                          if (!name) return;
                          setPresentCatcherPanicNames((current) => [...new Set([...current, name])]);
                          setPresentCatcherPanicDraft("");
                        }}
                      >
                        <input value={presentCatcherPanicDraft} onChange={(event) => setPresentCatcherPanicDraft(event.currentTarget.value)} placeholder="Name to avoid" />
                        <button type="submit">Add</button>
                      </form>
                      <div className="mini-table user-list-table">
                        {userRows.slice(0, 10).map((user) => {
                          const name = userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName);
                          const listed = presentCatcherPanicNames.some((entry) => entry.toLowerCase() === name.toLowerCase());
                          return (
                            <p key={pluginRuntimeUserKey(user, selectedRuntimeSnapshot?.userState?.sessionUserName)}>
                              <span>{listed ? "Avoid" : "Room"}</span>
                              <strong>
                                {name}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (listed) setPresentCatcherPanicNames((current) => current.filter((entry) => entry.toLowerCase() !== name.toLowerCase()));
                                    else setPresentCatcherPanicNames((current) => [...new Set([...current, name])]);
                                  }}
                                >
                                  {listed ? "Remove" : "Add"}
                                </button>
                              </strong>
                            </p>
                          );
                        })}
                        {userRows.length === 0 ? <p>No room users parsed yet.</p> : null}
                      </div>
                    </div>
                  </>
                ) : null}

                {presentCatcherTab === "gifts" ? (
                  <>
                    <div className="mini-section">
                      <h3>Gift Opener</h3>
                      <div className="inline-field-grid">
                        <label className="field-stack">
                          <span>Class Filter</span>
                          <input value={presentCatcherGiftClass} onChange={(event) => setPresentCatcherGiftClass(event.currentTarget.value)} />
                        </label>
                        <label className="field-stack">
                          <span>X</span>
                          <input value={presentPlaceX} onChange={(event) => setPresentPlaceX(event.currentTarget.value.replace(/[^\d-]/g, ""))} />
                        </label>
                        <label className="field-stack">
                          <span>Y</span>
                          <input value={presentPlaceY} onChange={(event) => setPresentPlaceY(event.currentTarget.value.replace(/[^\d-]/g, ""))} />
                        </label>
                        <label className="field-stack">
                          <span>Dir</span>
                          <input value={presentPlaceDirection} onChange={(event) => setPresentPlaceDirection(event.currentTarget.value.replace(/[^\d-]/g, ""))} />
                        </label>
                      </div>
                      <div className="runtime-actions automation-actions">
                        <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void requestPresentCatcherInventory()}>
                          Request Inventory
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !selectedPresentGiftRow} onClick={() => void placeSelectedPresentGift()}>
                          Place Selected
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentCatcherPacket({ header: 65, bodyText: "new" }, "Refresh strip")}>
                          Refresh Strip
                        </button>
                      </div>
                      <form
                        className="runtime-input-row"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void openPresentObject();
                        }}
                      >
                        <input value={presentOpenObjectId} onChange={(event) => setPresentOpenObjectId(event.currentTarget.value.replace(/[^\d]/g, ""))} placeholder="Placed object id" />
                        <button type="submit" disabled={!desktopBridgeAvailable}>
                          Open
                        </button>
                      </form>
                    </div>
                    <div className="mini-section">
                      <h3>Matching Inventory</h3>
                      <div className="item-list inventory-table">
                        {presentGiftRows.slice(0, 14).map((row) => (
                          <button
                            className={`item-row ${selectedPresentGiftRow?.rowId === row.rowId ? "active" : ""}`}
                            key={row.rowId}
                            type="button"
                            onClick={() => {
                              setSelectedPresentGiftKey(row.rowId);
                              const decodedId = decodeShockwaveVl64Text(compactValue(row.itemId));
                              const fallbackId = finiteNumber(row.objectId ?? row.slotId ?? row.itemId);
                              const openId = decodedId !== null ? Math.abs(decodedId) : fallbackId !== null ? Math.trunc(Math.abs(fallbackId)) : null;
                              if (openId) setPresentOpenObjectId(String(openId));
                            }}
                          >
                            <span>{row.inventoryKind || "item"}</span>
                            <div>
                              <strong>{compactValue(row.className)}</strong>
                              <small>token {compactValue(row.itemId)} / object {compactValue(row.objectId)}</small>
                            </div>
                          </button>
                        ))}
                        {presentGiftRows.length === 0 ? (
                          <div className="item-row empty">
                            <span>-</span>
                            <div>
                              <strong>No matching inventory gifts</strong>
                              <small>Open/request inventory and adjust the class filter.</small>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}

                {presentCatcherTab === "fragments" ? (
                  <>
                    <div className="mini-section">
                      <h3>Treasure Fragments</h3>
                      <div className="inline-field-grid">
                        <label className="field-stack">
                          <span>Event</span>
                          <input value={presentFragmentEvent} onChange={(event) => setPresentFragmentEvent(event.currentTarget.value)} />
                        </label>
                        <label className="field-stack">
                          <span>Receiver Index</span>
                          <input value={presentFragmentTradeTarget} onChange={(event) => setPresentFragmentTradeTarget(event.currentTarget.value)} />
                        </label>
                        <label className="field-stack">
                          <span>Slot Id</span>
                          <input value={presentFragmentSlotId} onChange={(event) => setPresentFragmentSlotId(event.currentTarget.value.replace(/[^\d]/g, ""))} />
                        </label>
                      </div>
                      <div className="runtime-actions automation-actions">
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentFragmentPacket("request")}>
                          Read Fragments
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentFragmentPacket("backpack")}>
                          Read Backpack
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentFragmentPacket("trade")}>
                          Trade With
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentFragmentPacket("add")}>
                          Add Slot
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentFragmentPacket("accept")}>
                          Accept
                        </button>
                        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void sendPresentFragmentPacket("cancel")}>
                          Cancel
                        </button>
                      </div>
                    </div>
                    <div className="mini-section">
                      <h3>Fragment Packet Feed</h3>
                      <div className="mini-table packet-detail-table">
                        {presentCatcherPacketRows.slice().reverse().map((entry) => (
                          <p key={entry.id}>
                            <span>{compactValue(entry.header)}</span>
                            <strong>{relayEntryPlain(entry, relayLog?.updatedAt)}</strong>
                          </p>
                        ))}
                        {presentCatcherPacketRows.length === 0 ? <p>No present/gift/fragment packets parsed yet.</p> : null}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {selectedPlugin.id === "gardening" ? (
              <div className="runtime-panel">
                <div className="runtime-actions automation-actions">
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || !roomReady || gardeningRunning || plantRows.length === 0}
                    onClick={() => void startGardening("cycle")}
                  >
                    Start Gardening
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable || !roomReady || gardeningRunning || plantRows.length === 0}
                    onClick={() => void startGardening("compost")}
                  >
                    Compost All
                  </button>
                  <button className="wide-action" type="button" disabled={!gardeningRunning} onClick={stopGardening}>
                    Stop
                  </button>
                  <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                    Refresh
                  </button>
                </div>
                <div className="chat-filter-row packet-filter-row" aria-label="Gardening settings">
                  <label>
                    <span>Cycle sec</span>
                    <input
                      value={gardeningCycleSec}
                      onChange={(event) => setGardeningCycleSec(event.target.value)}
                      inputMode="numeric"
                      aria-label="Gardening cycle seconds"
                    />
                  </label>
                </div>
                <div className="kv-grid">
                  <span>Room Ready</span>
                  <strong>{compactValue(roomReady)}</strong>
                  <span>Plants</span>
                  <strong>{compactValue(plantRows.length)}</strong>
                  <span>Ready</span>
                  <strong>{plantRows.length > 0 ? compactValue(plantRows.length) : "-"}</strong>
                  <span>Phase</span>
                  <strong>{gardeningJob?.phase ?? "idle"}</strong>
                  <span>Cycle Sec</span>
                  <strong>{compactValue(gardeningCycleSec)}</strong>
                  <span>Tracked</span>
                  <strong>{compactValue(gardeningJob ? gardeningJob.queue.length + 1 : plantRows.length)}</strong>
                  <span>Room</span>
                  <strong>{runtimeRoomName(selectedRuntimeSnapshot)}</strong>
                  <span>Avatar Tile</span>
                  <strong>{userTile(selfUser) ? `${userTile(selfUser)?.x},${userTile(selfUser)?.y}` : "-"}</strong>
                </div>
                {gardeningMessage || gardeningJob?.note ? <p className="runtime-message">{gardeningMessage || gardeningJob?.note}</p> : null}
                <div className="mini-section">
                  <h3>Plants In Room</h3>
                  <div className="item-list">
                    {plantRows.map((row) => (
                      <button
                        className={`item-row ${selectedPlantRow?.key === row.key ? "active" : ""}`}
                        key={row.key}
                        type="button"
                        onClick={() => setSelectedPlantKey(row.key)}
                      >
                        <span>{row.label}</span>
                        <div>
                          <strong>{itemRowTitle(row, furniMetadata)}</strong>
                          <small>{itemRowMeta(row, furniMetadata)}</small>
                        </div>
                      </button>
                    ))}
                    {plantRows.length === 0 ? (
                      <div className="item-row empty">
                        <span>-</span>
                        <div>
                          <strong>No plants found</strong>
                          <small>Enter a room with plants to populate this list.</small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Current Target Plant</h3>
                  <div className="mini-table item-detail-table">
                    <p>
                      <span>ID</span>
                      <strong>{compactValue(selectedPlantRow?.item.objectId ?? selectedPlantRow?.item.id)}</strong>
                    </p>
                    <p>
                      <span>Plant</span>
                      <strong>{compactValue(selectedPlantRow ? itemRowTitle(selectedPlantRow, furniMetadata) : null)}</strong>
                    </p>
                    <p>
                      <span>XY</span>
                      <strong>{compactValue(selectedPlantRow?.item.x)}, {compactValue(selectedPlantRow?.item.y)}, {compactValue(selectedPlantRow?.item.z)}</strong>
                    </p>
                    <p>
                      <span>Stage</span>
                      <strong>{compactValue(selectedPlantRow?.item.state)}</strong>
                    </p>
                    <p>
                      <span>Status</span>
                      <strong>{gardeningJob && selectedPlantRow && gardeningJob.plantKey === selectedPlantRow.key ? gardeningJob.phase : selectedPlantRow ? "queued" : "-"}</strong>
                    </p>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Current Cycle</h3>
                  <div className="mini-table item-detail-table">
                    <p>
                      <span>Target</span>
                      <strong>{compactValue(gardeningJob?.objectId)}</strong>
                    </p>
                    <p>
                      <span>Original</span>
                      <strong>
                        {gardeningJob ? `${gardeningJob.originalX},${gardeningJob.originalY} dir ${gardeningJob.originalDirection}` : "-"}
                      </strong>
                    </p>
                    <p>
                      <span>Working</span>
                      <strong>{gardeningJob ? `${gardeningJob.workingX},${gardeningJob.workingY}` : "-"}</strong>
                    </p>
                    <p>
                      <span>Attempts</span>
                      <strong>{gardeningJob ? `move ${gardeningJob.moveAttempts} / action ${gardeningJob.actionAttempts}` : "-"}</strong>
                    </p>
                    <p>
                      <span>Completed</span>
                      <strong>{compactValue(gardeningJob?.completed ?? 0)}</strong>
                    </p>
                    <p>
                      <span>Queued</span>
                      <strong>{compactValue(gardeningJob?.queue.length ?? plantRows.length)}</strong>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "wall-mover" ? (
              <div className="runtime-panel">
                <div className="runtime-actions automation-actions">
                  <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void refreshRuntimeSnapshot()}>
                    Refresh
                  </button>
                </div>
                {wallMoverMessage ? <p className="runtime-message">{wallMoverMessage}</p> : null}
                <div className="kv-grid">
                  <span>Rights</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.userState?.rightsCount)}</strong>
                  <span>Target ID</span>
                  <strong>{compactValue(selectedWallMoverItemId)}</strong>
                  <span>Class</span>
                  <strong>{compactValue(selectedWallMoverRow?.item.className ?? selectedWallMoverRow?.item.name)}</strong>
                  <span>Owner</span>
                  <strong>{compactValue(selectedWallMoverRow?.item.ownerName)}</strong>
                  <span>Wall Pos</span>
                  <strong>{compactValue(selectedWallMoverRow?.item.wall)}</strong>
                  <span>Local Pos</span>
                  <strong>{compactValue(selectedWallMoverRow?.item.local)}</strong>
                  <span>Orientation</span>
                  <strong>{compactValue(selectedWallMoverRow?.item.orientation ?? selectedWallMoverRow?.item.direction)}</strong>
                  <span>Step</span>
                  <strong>{compactValue(wallMoverStep)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Move</h3>
                  <div className="inline-field-grid">
                    <label className="field-stack">
                      <span>Step</span>
                      <input
                        value={wallMoverStep}
                        onChange={(event) => setWallMoverStep(event.currentTarget.value.replace(/[^\d]/g, "").slice(0, 2))}
                        inputMode="numeric"
                      />
                    </label>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null}
                      onClick={() => void sendWallMoverPickup()}
                    >
                      Pick Up Selected
                    </button>
                  </div>
                  <div className="wall-mover-pad" aria-label="Wall mover nudge controls">
                    <span />
                    <button type="button" disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null || selectedWallMoverLocation === null} onClick={() => void sendWallMoverMove(0, -1)}>
                      Up
                    </button>
                    <span />
                    <button type="button" disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null || selectedWallMoverLocation === null} onClick={() => void sendWallMoverMove(-1, 0)}>
                      Left
                    </button>
                    <button type="button" disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null || selectedWallMoverLocation === null} onClick={() => void sendWallMoverMove(0, 1)}>
                      Down
                    </button>
                    <button type="button" disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null || selectedWallMoverLocation === null} onClick={() => void sendWallMoverMove(1, 0)}>
                      Right
                    </button>
                  </div>
                  <div className="wall-mover-action-row">
                    <button
                      type="button"
                      disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null || selectedWallMoverLocation === null}
                      onClick={() => void sendWallMoverMove(0, 0, "l")}
                    >
                      Face L
                    </button>
                    <button
                      type="button"
                      disabled={!desktopBridgeAvailable || selectedWallMoverItemId === null || selectedWallMoverLocation === null}
                      onClick={() => void sendWallMoverMove(0, 0, "r")}
                    >
                      Face R
                    </button>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Wall Items</h3>
                  <div className="item-list">
                    {wallMoverRows.slice(0, 14).map((row) => (
                      <button
                        className={`item-row ${selectedWallMoverRow?.key === row.key ? "active" : ""}`}
                        key={row.key}
                        type="button"
                        onClick={() => setSelectedWallMoverKey(row.key)}
                      >
                        <span>Wall</span>
                        <div>
                          <strong>{itemRowTitle(row, furniMetadata)}</strong>
                          <small>{wallObjectMeta(row.item)}</small>
                        </div>
                      </button>
                    ))}
                    {wallMoverRows.length === 0 ? (
                      <div className="item-row empty">
                        <span>-</span>
                        <div>
                          <strong>No wall items found</strong>
                          <small>Enter a room with wall furni to populate this list.</small>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "injection" ? (
              <div className="runtime-panel">
                <div className="mini-section injection-editor">
                  <h3>Command Editor</h3>
                  <label className="field-stack">
                    <span>Action</span>
                    <select
                      value={injectionDraft.actionKind}
                      onChange={(event) => updateInjectionDraft("actionKind", event.currentTarget.value as InjectionActionKind)}
                    >
                      {injectionActionOptions.map((option) => (
                        <option key={option.kind} value={option.kind}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {injectionDraft.actionKind === "sendChat" ? (
                    <label className="field-stack">
                      <span>Chat Text</span>
                      <textarea
                        value={injectionDraft.chatMessage}
                        onChange={(event) => updateInjectionDraft("chatMessage", event.currentTarget.value)}
                        rows={3}
                        placeholder="Message sent through the live room chat field"
                      />
                    </label>
                  ) : null}

                  {injectionDraft.actionKind === "stageClick" ? (
                    <div className="inline-field-grid">
                      <label className="field-stack">
                        <span>Stage X</span>
                        <input value={injectionDraft.stageX} onChange={(event) => updateInjectionDraft("stageX", event.currentTarget.value)} />
                      </label>
                      <label className="field-stack">
                        <span>Stage Y</span>
                        <input value={injectionDraft.stageY} onChange={(event) => updateInjectionDraft("stageY", event.currentTarget.value)} />
                      </label>
                    </div>
                  ) : null}

                  {injectionDraft.actionKind === "clickWindowElement" ? (
                    <div className="inline-field-grid">
                      <label className="field-stack">
                        <span>Window Id</span>
                        <input
                          value={injectionDraft.windowId}
                          onChange={(event) => updateInjectionDraft("windowId", event.currentTarget.value)}
                          placeholder="Room_bar"
                        />
                      </label>
                      <label className="field-stack">
                        <span>Element Id</span>
                        <input
                          value={injectionDraft.elementId}
                          onChange={(event) => updateInjectionDraft("elementId", event.currentTarget.value)}
                          placeholder="int_hand_image"
                        />
                      </label>
                    </div>
                  ) : null}

                  {injectionDraft.actionKind === "openNavigator" ? (
                    <label className="field-stack">
                      <span>Navigator View</span>
                      <select value={injectionDraft.navigatorView} onChange={(event) => updateInjectionDraft("navigatorView", event.currentTarget.value)}>
                        <option value="nav_pr">Public spaces</option>
                        <option value="nav_gr0">Guest rooms</option>
                      </select>
                    </label>
                  ) : null}

                  {injectionDraft.actionKind === "enterPrivateRoom" ? (
                    <label className="field-stack">
                      <span>Flat Id</span>
                      <input
                        value={injectionDraft.flatId}
                        onChange={(event) => updateInjectionDraft("flatId", event.currentTarget.value)}
                        placeholder="empty uses current private room id"
                      />
                    </label>
                  ) : null}

                  {injectionDraft.actionKind === "enterPublicRoom" ? (
                    <label className="field-stack">
                      <span>Public Room</span>
                      <input
                        value={injectionDraft.publicRoomQuery}
                        onChange={(event) => updateInjectionDraft("publicRoomQuery", event.currentTarget.value)}
                        placeholder="empty uses first cached public room"
                      />
                    </label>
                  ) : null}

                  {injectionDraft.actionKind === "rawPacketBlocked" ? (
                    <>
                      <label className="field-stack">
                        <span>Packet Text</span>
                        <textarea
                          value={injectionDraft.rawText}
                          onChange={(event) => updateInjectionDraft("rawText", event.currentTarget.value)}
                          rows={3}
                          placeholder="{h:94} or :WAVE"
                        />
                      </label>
                    </>
                  ) : null}

                  <div className="inline-field-grid repeat-grid">
                    <label className="field-stack">
                      <span>Repeat</span>
                      <input value={injectionRepeatCount} onChange={(event) => setInjectionRepeatCount(event.currentTarget.value)} />
                    </label>
                    <label className="field-stack">
                      <span>Interval ms</span>
                      <input value={injectionRepeatInterval} onChange={(event) => setInjectionRepeatInterval(event.currentTarget.value)} />
                    </label>
                  </div>
                  <div className="runtime-actions injection-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={runtimeBusy}
                      onClick={() => void executeInjectionCommand(injectionDraft)}
                    >
                      Run
                    </button>
                    <button className="wide-action" type="button" onClick={addInjectionSnippet}>
                      Add To Saved
                    </button>
                  </div>
                  <div className="kv-grid">
                    <span>Room Ready</span>
                    <strong>{compactValue(roomReady)}</strong>
                    <span>Windows</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.windowIds.length)}</strong>
                    <span>Fields</span>
                    <strong>{compactValue(selectedRuntimeSnapshot?.editableFields.length)}</strong>
                    <span>Repeat Cap</span>
                    <strong>{compactValue(clampRepeatCount(injectionRepeatCount))}</strong>
                  </div>
                  {injectionMessage ? <p className="runtime-message">{injectionMessage}</p> : null}
                </div>
                <div className="mini-section">
                  <h3>Saved Snippets</h3>
                  <input
                    ref={injectionFileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden-file-input"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importInjectionSnippets(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="runtime-actions injection-actions">
                    <button className="wide-action" type="button" onClick={() => injectionFileInputRef.current?.click()}>
                      Load File
                    </button>
                    <button className="wide-action" type="button" onClick={exportInjectionSnippets}>
                      Save File
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      onClick={() => {
                        setInjectionSnippets([]);
                        setSelectedInjectionSnippetId("");
                        setInjectionMessage("Saved snippets cleared.");
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="injection-list" aria-label="Saved injection snippets">
                    {injectionSnippets.length > 0 ? (
                      injectionSnippets.map((snippet) => (
                        <button
                          className={`injection-row ${snippet.id === selectedInjectionSnippetId ? "active" : ""}`}
                          key={snippet.id}
                          type="button"
                          onClick={() => loadInjectionSnippet(snippet)}
                        >
                          <strong>{snippet.label}</strong>
                        </button>
                      ))
                    ) : (
                      <p className="empty-panel-note">No saved snippets yet.</p>
                    )}
                  </div>
                  <div className="runtime-actions injection-actions">
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!selectedInjectionSnippet || runtimeBusy}
                      onClick={() => {
                        if (selectedInjectionSnippet) void executeInjectionCommand(selectedInjectionSnippet.command, selectedInjectionSnippet.label);
                      }}
                    >
                      Send Selected
                    </button>
                    <button
                      className="wide-action"
                      type="button"
                      disabled={!selectedInjectionSnippet}
                      onClick={() => {
                        if (!selectedInjectionSnippet) return;
                        setInjectionSnippets((current) => current.filter((snippet) => snippet.id !== selectedInjectionSnippet.id));
                        setSelectedInjectionSnippetId("");
                        setInjectionMessage("Snippet removed.");
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Recent Injections</h3>
                  <div className="injection-history-list">
                    {injectionHistory.length > 0 ? (
                      injectionHistory.slice(0, 12).map((entry) => (
                        <div className={`injection-history-row ${entry.status}`} key={entry.id}>
                          <span>{entry.time}</span>
                          <strong>{entry.label}</strong>
                          <p>{entry.message}</p>
                        </div>
                      ))
                    ) : (
                      <p className="empty-panel-note">No commands have run yet.</p>
                    )}
                  </div>
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => {
                      setInjectionHistory([]);
                      setInjectionMessage("Recent injection history cleared.");
                    }}
                  >
                    Clear History
                  </button>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "packet-log" ? (
              <div className="runtime-panel">
                <div className="runtime-actions">
                  <button
                    className="wide-action"
                    type="button"
                    disabled={!desktopBridgeAvailable}
                    onClick={() => void refreshRelayLog()}
                  >
                    <RefreshCw size={14} />
                    <span>Refresh Relay Log</span>
                  </button>
                  <button className="wide-action" type="button" onClick={exportVisiblePacketLog}>
                    Export Visible
                  </button>
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => {
                      setPacketClearOffset(packetEntries.length);
                      setSelectedPacketKey("");
                      setPacketExportMessage("Display cleared; relay log kept intact.");
                    }}
                  >
                    Clear Display
                  </button>
                </div>
                <div className="chat-filter-row packet-filter-row" aria-label="Packet log filters">
                  {(["client", "server", "relay"] as const).map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={packetFilters[kind]}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setPacketFilters((current) => ({ ...current, [kind]: checked }));
                        }}
                      />
                      <span>{labelCase(kind)}</span>
                    </label>
                  ))}
                  <label>
                    <input
                      type="checkbox"
                      checked={packetFilters.wrap}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setPacketFilters((current) => ({ ...current, wrap: checked }));
                      }}
                    />
                    <span>wrap</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={packetFilters.autoscroll}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setPacketFilters((current) => ({ ...current, autoscroll: checked }));
                      }}
                    />
                    <span>auto</span>
                  </label>
                </div>
                <div className="user-select-row packet-session-row">
                  <input
                    value={packetFilters.search}
                    onChange={(event) => {
                      const search = event.currentTarget.value;
                      setPacketFilters((current) => ({ ...current, search }));
                    }}
                    placeholder="Search packets, body, fields"
                    aria-label="Search packet log"
                  />
                  <select
                    value={packetFilters.clientSession}
                    onChange={(event) => {
                      const clientSession = event.currentTarget.value;
                      setPacketFilters((current) => ({ ...current, clientSession }));
                    }}
                    aria-label="Packet client filter"
                  >
                    {packetClientChoices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={packetFilters.session}
                    onChange={(event) => {
                      const session = event.currentTarget.value;
                      setPacketFilters((current) => ({ ...current, session }));
                    }}
                    aria-label="Packet session filter"
                  >
                    {packetSessionChoices.map((sessionId) => (
                      <option key={sessionId} value={sessionId}>
                        {sessionId === "All" ? "All sessions" : `session ${sessionId}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setPacketFilters((current) => ({ ...current, client: true, server: true, relay: true, clientSession: "All", session: "All", search: "" }))}
                    title="Reset packet filters"
                    aria-label="Reset packet filters"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
                <div className="mini-section packet-list-section">
                  <h3>Packet Log</h3>
                  <div
                    className={`packet-entry-list ${packetFilters.wrap ? "wrap" : ""}`}
                    ref={packetListRef}
                    onScroll={handlePacketListScroll}
                  >
                    {visiblePacketEntries.length > 0 ? (
                      <div className="packet-entry-virtual-space" style={{ height: packetVirtualRange.height }}>
                        <div
                          className="packet-entry-virtual-window"
                          style={{ transform: `translateY(${packetVirtualRange.top}px)` }}
                        >
                          {renderedPacketEntries.map((entry) => (
                            <button
                              className={`packet-entry ${selectedPacketEntry?.id === entry.id ? "active" : ""} packet-${entry.direction.toLowerCase()}`}
                              key={entry.id}
                              type="button"
                              onClick={() => setSelectedPacketKey(entry.id)}
                            >
                              <span>{entry.header === null ? "RELAY" : relayEntryLabel(entry)}</span>
                              <strong>{relayEntryV3Line(entry, relayLog?.updatedAt)}</strong>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="packet-entry empty">
                        <span>Empty</span>
                        <strong>{packetEntries.length === 0 ? "Start the embedded client to create relay log entries." : "No relay rows match the current filters."}</strong>
                      </div>
                    )}
                    {visiblePacketEntries.length > renderedPacketEntries.length ? (
                      <p className="packet-virtual-note">
                        Rendering {packetVirtualRange.start + 1}-{packetVirtualRange.end} of {visiblePacketEntries.length} matching rows.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mini-section packet-detail-section">
                  <h3>Selected Packet</h3>
                  <div className="packet-detail-scroll">
                    <div className="mini-table packet-detail-table">
                      <p>
                        <span>Line</span>
                        <strong>{compactValue(selectedPacketEntry?.lineNumber)}</strong>
                      </p>
                      <p>
                        <span>Client</span>
                        <strong>
                          {selectedPacketEntry?.clientId ? `client${selectedPacketEntry.clientId} ${selectedPacketEntry.clientLabel ?? ""}`.trim() : "-"}
                        </strong>
                      </p>
                      <p>
                        <span>Session</span>
                        <strong>{compactValue(selectedPacketEntry?.sessionId)}</strong>
                      </p>
                      <p>
                        <span>Direction</span>
                        <strong>{compactValue(selectedPacketEntry?.direction)}</strong>
                      </p>
                      <p>
                        <span>Name</span>
                        <strong>{selectedPacketEntry ? relayEntryDisplayName(selectedPacketEntry) : "-"}</strong>
                      </p>
                      <p>
                        <span>Header</span>
                        <strong>{compactValue(selectedPacketEntry?.header)}</strong>
                      </p>
                      <p>
                        <span>Size</span>
                        <strong>{compactValue(selectedPacketEntry?.size)}</strong>
                      </p>
                      <p>
                        <span>Payload</span>
                        <strong>{selectedPacketEntry?.payloadBytes === null || selectedPacketEntry?.payloadBytes === undefined ? "-" : `${selectedPacketEntry.payloadBytes}B`}</strong>
                      </p>
                      <p>
                        <span>v3 Line</span>
                        <strong>{selectedPacketEntry ? relayEntryV3Line(selectedPacketEntry, relayLog?.updatedAt) : "-"}</strong>
                      </p>
                    </div>
                    <h3 className="packet-subheading">Decrypted Body</h3>
                    <div className="mini-table packet-detail-table">
                      <p>
                        <span>ASCII</span>
                        <strong>{selectedPacketEntry?.bodyAscii ?? selectedPacketEntry?.bodyText ?? "-"}</strong>
                      </p>
                      <p>
                        <span>Hex</span>
                        <strong>{selectedPacketEntry?.bodyHex ?? "-"}</strong>
                      </p>
                      {(selectedPacketEntry?.decodedFields ?? []).map((field) => (
                        <p key={`${field.label}:${field.value}`}>
                          <span>{field.label}</span>
                          <strong>{field.value}</strong>
                        </p>
                      ))}
                      {selectedPacketEntry && selectedPacketEntry.decodedFields.length === 0 ? (
                        <p>
                          <span>Fields</span>
                          <strong>No decoded fields.</strong>
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="kv-grid packet-stats-grid">
                  <span>Bridge</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.networkBridgeUrl)}</strong>
                  <span>Log</span>
                  <strong>{relayLog?.exists ? "Present" : "Missing"}</strong>
                  <span>Packets</span>
                  <strong>{compactValue(relayLog?.packetCount)}</strong>
                  <span>Client</span>
                  <strong>{compactValue(relayLog?.clientCount)}</strong>
                  <span>Server</span>
                  <strong>{compactValue(relayLog?.serverCount)}</strong>
                  <span>Lines</span>
                  <strong>{compactValue(relayLog?.totalLines)}</strong>
                  <span>Client Filter</span>
                  <strong>{packetFilters.clientSession === "All" ? "All clients" : `client${packetFilters.clientSession}`}</strong>
                  <span>Visible</span>
                  <strong>{compactValue(visiblePacketEntries.length)}</strong>
                </div>
                <p className="runtime-message">{packetExportMessage || relayLog?.message || "Relay log snapshot not loaded."}</p>
              </div>
            ) : null}

            {selectedPlugin.id === "dev-tools" ? (
              <div className="runtime-panel">
                <div className="runtime-actions">
                  <button
                    className="wide-action"
                    type="button"
                    onClick={() => void refreshRuntimeSnapshot()}
                    disabled={!engineUrl || runtimeBusy}
                  >
                    <RefreshCw size={14} />
                    <span>Refresh Diagnostics</span>
                  </button>
                </div>
                <div className="kv-grid">
                  <span>Frame</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.frame)}</strong>
                  <span>Casts Loaded</span>
                  <strong>{selectedRuntimeSnapshot ? `${selectedRuntimeSnapshot.loadedCastCount}${selectedRuntimeSnapshot.castLoaded ? " / complete" : ""}` : "-"}</strong>
                  <span>FPS</span>
                  <strong>{compactValue(runtimeFps(selectedRuntimeSnapshot))}</strong>
                  <span>Tick Rate</span>
                  <strong>{compactValue(runtimeTickRate(selectedRuntimeSnapshot))}</strong>
                  <span>Worst RAF</span>
                  <strong>{compactValue(finiteNumber(selectedRuntimeSnapshot?.performanceStats?.worstRafDeltaMs))}</strong>
                  <span>Timeouts</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.performanceStats?.activeTimeoutCount)}</strong>
                  <span>Errors</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.errors)}</strong>
                  <span>Objects</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.objectCount)}</strong>
                  <span>Windows</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.windowIds.length)}</strong>
                  <span>Fields</span>
                  <strong>{compactValue(selectedRuntimeSnapshot?.editableFields.length)}</strong>
                </div>
                <div className="mini-section">
                  <h3>Script Bundle</h3>
                  <p>
                    {selectedRuntimeSnapshot?.scriptBundle
                      ? `${selectedRuntimeSnapshot.scriptBundle.runtimeVersion ?? "-"} -> ${selectedRuntimeSnapshot.scriptBundle.executableVersion ?? "-"}`
                      : "-"}
                  </p>
                </div>
                <div className="mini-section">
                  <h3>Runtime Windows</h3>
                  <div className="chip-list">
                    {(selectedRuntimeSnapshot?.windowIds ?? []).length > 0 ? (
                      selectedRuntimeSnapshot?.windowIds.map((id) => <span key={id}>{id}</span>)
                    ) : (
                      <span>none</span>
                    )}
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Editable Fields</h3>
                  <div className="mini-table">
                    {(selectedRuntimeSnapshot?.editableFields ?? []).slice(0, 6).map((field) => (
                      <p key={field.n}>
                        <span>#{field.n}</span>
                        <strong>{field.member}</strong>
                      </p>
                    ))}
                    {(selectedRuntimeSnapshot?.editableFields.length ?? 0) === 0 ? <p>No editable fields visible.</p> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {selectedPlugin.id === "about" ? (
              <div className="runtime-panel about-panel">
                <div className="kv-grid">
                  <span>App</span>
                  <strong>{appInfo?.name ?? "Habbpy v4"}</strong>
                  <span>Version</span>
                  <strong>{appInfo?.version ?? "-"}</strong>
                  <span>Mode</span>
                  <strong>{compactValue(appInfo?.mode)}</strong>
                  <span>Profile</span>
                  <strong>{selectedProfile?.label ?? "No profile selected"}</strong>
                  <span>Build</span>
                  <strong>{engineLaunch?.buildLabel ?? profileLine(selectedProfile)}</strong>
                  <span>Storage</span>
                  <strong>{selectedProfile?.storageMode ?? "-"}</strong>
                </div>
                <div className="mini-section">
                  <h3>Project</h3>
                  <p>
                    Habbpy v4 is a local Electron and React companion shell for Shockless Engine. It embeds the playable
                    Director-compatible client and ports Habbpy v3 features into compact plugins.
                  </p>
                </div>
                <div className="mini-section">
                  <h3>Credits</h3>
                  <div className="chip-list">
                    <span>dek</span>
                    <span>cam</span>
                    <span>jeff</span>
                    <span>sonicmouse</span>
                    <span>scott</span>
                    <span>Jephyrr</span>
                    <span>DarkStar</span>
                    <span>G-Earth</span>
                    <span>ProjectorRays</span>
                    <span>Shockless Engine</span>
                  </div>
                </div>
                <div className="mini-section">
                  <h3>Links</h3>
                  <div className="mini-table about-link-table">
                    <p>
                      <span>Site</span>
                      <strong>https://dek.cx</strong>
                    </p>
                    <p>
                      <span>Habbo</span>
                      <strong>https://habbo.dek.cx</strong>
                    </p>
                    <p>
                      <span>Social</span>
                      <strong>https://x.com/dekHabbo</strong>
                    </p>
                    <p>
                      <span>G-Earth</span>
                      <strong>https://github.com/G-Realm/G-Earth</strong>
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </aside>
    </main>
  );
}
