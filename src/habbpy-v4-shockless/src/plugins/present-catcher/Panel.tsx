import type { EngineRuntimeSnapshot, RuntimeUserSummary, RuntimeInventoryItemSummary } from "../../renderer/engineRuntime";
import type { RuntimeObjectSummary } from "../../renderer/engineRuntime";
import type { RelayLogEntry, RelayLogSnapshot, FurniMetadataSnapshot, FurniMetadataEntry, PluginPacketInput } from "../../shared/window-api";
import type { RuntimeItemRow } from "../../engine-adapter/shocklessSessionAdapter";
import { compactRuntimeValue, runtimeRoomName } from "../../engine-adapter/shocklessSessionAdapter";
import { formatShockwavePacketParts } from "../../shared/shockwavePacketText";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function compact(value: unknown): string {
  return compactRuntimeValue(value);
}

function compactValue(value: unknown): string {
  return compactRuntimeValue(value);
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

function userDisplayName(user: RuntimeUserSummary | null, sessionName?: string | null): string {
  if (!user) return "-";
  return compactValue(user.name ?? (user.rowId === "0" ? sessionName : null) ?? user.objectClass ?? user.className ?? user.rowId);
}

function isPresentCatcherHammerObject(entry: RuntimeObjectSummary): boolean {
  return compactValue(entry.className ?? entry.name).trim().toLowerCase() === "toby_hammer";
}

function isPresentCatcherPresentObject(entry: RuntimeObjectSummary): boolean {
  return compactValue(entry.className ?? entry.name).trim().toLowerCase().startsWith("anniv_present_gen");
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

function itemRowTitle(row: RuntimeItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  return furniDisplayName(metadata, row.item);
}

function itemRowMeta(row: RuntimeItemRow, metadata: FurniMetadataSnapshot | null = null): string {
  const info = furniInfoForObject(metadata, row.item);
  const className = compactValue(row.item.className ?? row.item.name);
  const meta = objectMeta(row.item);
  return info && className !== "-" ? `class ${className} \\ ${meta}` : meta;
}

function pluginRuntimeUserKey(user: RuntimeUserSummary, sessionName?: string | null): string {
  const accountId = compactValue(user.accountId);
  if (accountId !== "-") return `account:${accountId}`;
  const roomIndex = compactValue(user.roomIndex);
  if (roomIndex !== "-") return `room-index:${roomIndex}`;
  return `row:${user.rowId}:${userDisplayName(user, sessionName).trim().toLowerCase()}`;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
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

function bytesFromHex(hex: string | null): readonly number[] {
  if (!hex) return [];
  return hex
    .split(/\s+/)
    .map((part) => Number.parseInt(part, 16))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 255);
}

function packetLogTimeLabel(updatedAt?: string | null): string {
  if (!updatedAt) return "--:--:--";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function relayEntryDisplayName(entry: RelayLogEntry): string {
  const name = entry.packetName ?? "UNKNOWN_HEADER";
  return name === "UNKNOWN_HEADER" ? "[UNKNOWN_HEADER]" : name;
}

function formatHabbpyV3PacketText(entry: RelayLogEntry): string {
  if (entry.header === null) return entry.message;
  if (entry.bodyStatus === "redacted") return "<redacted>";
  if (entry.bodyStatus !== "sampled") return entry.message;
  return formatShockwavePacketParts(entry.header, bytesFromHex(entry.bodyHex));
}

function relayEntryV3Line(entry: RelayLogEntry, updatedAt?: string | null): string {
  const clientPrefix = entry.clientId ? `[client${entry.clientId}] ` : "";
  if (entry.header === null) return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}[RELAY ] ${entry.message}`;
  const sidPrefix = entry.sessionId ? `[${entry.sessionId.slice(0, 6)}] ` : "";
  const name = relayEntryDisplayName(entry);
  const header = compact(entry.header);
  const size = compact(entry.size);
  return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}${sidPrefix}[${entry.direction.padEnd(6, " ")}] ${name} [${header}] (${size}B)  ${formatHabbpyV3PacketText(entry)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresentCatcherPanelProps {
  desktopBridgeAvailable: boolean;
  roomReady: boolean | null;
  engineUrl: string | null;
  runtimeBusy: boolean;
  presentCatcherRunning: boolean;
  presentCatcherMessage: string;
  presentCatcherTab: "catcher" | "gifts" | "fragments";
  presentCatcherPanicDraft: string;
  presentCatcherPanicNames: readonly string[];
  presentCatcherGiftClass: string;
  presentPlaceX: string;
  presentPlaceY: string;
  presentPlaceDirection: string;
  presentOpenObjectId: string;
  presentFragmentEvent: string;
  presentFragmentSlotId: string;
  presentFragmentTradeTarget: string;
  selectedRuntimeSnapshot: EngineRuntimeSnapshot | null;
  presentHammerRows: readonly RuntimeItemRow[];
  presentRows: readonly RuntimeItemRow[];
  presentGiftRows: readonly RuntimeInventoryItemSummary[];
  selectedPresentGiftRow: RuntimeInventoryItemSummary | null;
  presentCatcherPacketRows: readonly RelayLogEntry[];
  userRows: readonly RuntimeUserSummary[];
  furniMetadata: FurniMetadataSnapshot | null;
  relayLog: RelayLogSnapshot | null;
  onStartPresentCatcher: () => void;
  onStopPresentCatcher: () => void;
  onRunPresentCatcherStep: (auto: boolean) => void;
  onRefreshRuntimeSnapshot: (scopes?: readonly string[]) => void;
  onSetPresentCatcherTab: (tab: "catcher" | "gifts" | "fragments") => void;
  onSetPresentCatcherPanicDraft: (v: string) => void;
  onSetPresentCatcherPanicNames: (setter: (current: string[]) => string[]) => void;
  onSetPresentCatcherGiftClass: (v: string) => void;
  onSetPresentPlaceX: (v: string) => void;
  onSetPresentPlaceY: (v: string) => void;
  onSetPresentPlaceDirection: (v: string) => void;
  onSetPresentOpenObjectId: (v: string) => void;
  onSetPresentFragmentEvent: (v: string) => void;
  onSetPresentFragmentSlotId: (v: string) => void;
  onSetPresentFragmentTradeTarget: (v: string) => void;
  onUsePresentCatcherFloorItem: (row: RuntimeItemRow, mode: "hammer" | "present") => void;
  onRequestPresentCatcherInventory: () => void;
  onPlaceSelectedPresentGift: () => void;
  onSendPresentCatcherPacket: (packet: PluginPacketInput, label: string) => void;
  onOpenPresentObject: () => void;
  onSendPresentFragmentPacket: (kind: string) => void;
  onSetSelectedPresentGiftKey: (key: string) => void;
  onSetPresentCatcherMessage: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresentCatcherPanel(props: PresentCatcherPanelProps): JSX.Element {
  const {
    desktopBridgeAvailable,
    roomReady,
    engineUrl,
    runtimeBusy,
    presentCatcherRunning,
    presentCatcherMessage,
    presentCatcherTab,
    presentCatcherPanicDraft,
    presentCatcherPanicNames,
    presentCatcherGiftClass,
    presentPlaceX,
    presentPlaceY,
    presentPlaceDirection,
    presentOpenObjectId,
    presentFragmentEvent,
    presentFragmentSlotId,
    presentFragmentTradeTarget,
    selectedRuntimeSnapshot,
    presentHammerRows,
    presentRows,
    presentGiftRows,
    selectedPresentGiftRow,
    presentCatcherPacketRows,
    userRows,
    furniMetadata,
    relayLog,
    onStartPresentCatcher,
    onStopPresentCatcher,
    onRunPresentCatcherStep,
    onRefreshRuntimeSnapshot,
    onSetPresentCatcherTab,
    onSetPresentCatcherPanicDraft,
    onSetPresentCatcherPanicNames,
    onSetPresentCatcherGiftClass,
    onSetPresentPlaceX,
    onSetPresentPlaceY,
    onSetPresentPlaceDirection,
    onSetPresentOpenObjectId,
    onSetPresentFragmentEvent,
    onSetPresentFragmentSlotId,
    onSetPresentFragmentTradeTarget,
    onUsePresentCatcherFloorItem,
    onRequestPresentCatcherInventory,
    onPlaceSelectedPresentGift,
    onSendPresentCatcherPacket,
    onOpenPresentObject,
    onSendPresentFragmentPacket,
    onSetSelectedPresentGiftKey,
    onSetPresentCatcherMessage,
  } = props;

  return (
    <div className="runtime-panel present-catcher-panel">
      <div className="runtime-actions automation-actions">
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !roomReady || presentCatcherRunning} onClick={() => { onStartPresentCatcher(); onSetPresentCatcherMessage("Watching current room for hammers and event presents."); }}>Start</button>
        <button className="wide-action" type="button" disabled={!presentCatcherRunning} onClick={() => { onStopPresentCatcher(); onSetPresentCatcherMessage("Stopped."); }}>Stop</button>
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !roomReady} onClick={() => void onRunPresentCatcherStep(false)}>Step</button>
        <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRefreshRuntimeSnapshot(["core", "room", "inventory"])}>Refresh</button>
      </div>
      <div className="present-catcher-tab-row" role="tablist" aria-label="Present Catcher views">
        {(["catcher", "gifts", "fragments"] as const).map((tab) => (
          <button className={presentCatcherTab === tab ? "active" : ""} key={tab} type="button" onClick={() => onSetPresentCatcherTab(tab)}>
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
                  <button className="item-row" key={row.key} type="button" disabled={!desktopBridgeAvailable || !roomReady} onClick={() => void onUsePresentCatcherFloorItem(row, isHammer ? "hammer" : "present")}>
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
                  <div><strong>No event targets parsed</strong><small>Enter an event room with hammers or anniversary presents.</small></div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="mini-section">
            <h3>Panic List</h3>
            <form className="runtime-input-row" onSubmit={(event) => { event.preventDefault(); const name = presentCatcherPanicDraft.trim(); if (!name) return; onSetPresentCatcherPanicNames((current) => [...new Set([...current, name])]); onSetPresentCatcherPanicDraft(""); }}>
              <input value={presentCatcherPanicDraft} onChange={(event) => onSetPresentCatcherPanicDraft(event.currentTarget.value)} placeholder="Name to avoid" />
              <button type="submit">Add</button>
            </form>
            <div className="mini-table user-list-table">
              {userRows.slice(0, 10).map((user) => {
                const name = userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName);
                const listed = presentCatcherPanicNames.some((entry) => entry.toLowerCase() === name.toLowerCase());
                return (
                  <p key={pluginRuntimeUserKey(user, selectedRuntimeSnapshot?.userState?.sessionUserName)}>
                    <span>{listed ? "Avoid" : "Room"}</span>
                    <strong>{name}<button type="button" onClick={() => { if (listed) onSetPresentCatcherPanicNames((current) => current.filter((entry) => entry.toLowerCase() !== name.toLowerCase())); else onSetPresentCatcherPanicNames((current) => [...new Set([...current, name])]); }}>{listed ? "Remove" : "Add"}</button></strong>
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
              <label className="field-stack"><span>Class Filter</span><input value={presentCatcherGiftClass} onChange={(event) => onSetPresentCatcherGiftClass(event.currentTarget.value)} /></label>
              <label className="field-stack"><span>X</span><input value={presentPlaceX} onChange={(event) => onSetPresentPlaceX(event.currentTarget.value.replace(/[^\d-]/g, ""))} /></label>
              <label className="field-stack"><span>Y</span><input value={presentPlaceY} onChange={(event) => onSetPresentPlaceY(event.currentTarget.value.replace(/[^\d-]/g, ""))} /></label>
              <label className="field-stack"><span>Dir</span><input value={presentPlaceDirection} onChange={(event) => onSetPresentPlaceDirection(event.currentTarget.value.replace(/[^\d-]/g, ""))} /></label>
            </div>
            <div className="runtime-actions automation-actions">
              <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRequestPresentCatcherInventory()}>Request Inventory</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !selectedPresentGiftRow} onClick={() => void onPlaceSelectedPresentGift()}>Place Selected</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentCatcherPacket({ header: 65, bodyText: "new" }, "Refresh strip")}>Refresh Strip</button>
            </div>
            <form className="runtime-input-row" onSubmit={(event) => { event.preventDefault(); void onOpenPresentObject(); }}>
              <input value={presentOpenObjectId} onChange={(event) => onSetPresentOpenObjectId(event.currentTarget.value.replace(/[^\d]/g, ""))} placeholder="Placed object id" />
              <button type="submit" disabled={!desktopBridgeAvailable}>Open</button>
            </form>
          </div>
          <div className="mini-section">
            <h3>Matching Inventory</h3>
            <div className="item-list inventory-table">
              {presentGiftRows.slice(0, 14).map((row) => (
                <button className={`item-row ${selectedPresentGiftRow?.rowId === row.rowId ? "active" : ""}`} key={row.rowId} type="button" onClick={() => { onSetSelectedPresentGiftKey(row.rowId); const decodedId = decodeShockwaveVl64Text(compactValue(row.itemId)); const fallbackId = finiteNumber(row.objectId ?? row.slotId ?? row.itemId); const openId = decodedId !== null ? Math.abs(decodedId) : fallbackId !== null ? Math.trunc(Math.abs(fallbackId)) : null; if (openId) onSetPresentOpenObjectId(String(openId)); }}>
                  <span>{row.inventoryKind || "item"}</span>
                  <div><strong>{compactValue(row.className)}</strong><small>token {compactValue(row.itemId)} / object {compactValue(row.objectId)}</small></div>
                </button>
              ))}
              {presentGiftRows.length === 0 ? (
                <div className="item-row empty"><span>-</span><div><strong>No matching inventory gifts</strong><small>Open/request inventory and adjust the class filter.</small></div></div>
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
              <label className="field-stack"><span>Event</span><input value={presentFragmentEvent} onChange={(event) => onSetPresentFragmentEvent(event.currentTarget.value)} /></label>
              <label className="field-stack"><span>Receiver Index</span><input value={presentFragmentTradeTarget} onChange={(event) => onSetPresentFragmentTradeTarget(event.currentTarget.value)} /></label>
              <label className="field-stack"><span>Slot Id</span><input value={presentFragmentSlotId} onChange={(event) => onSetPresentFragmentSlotId(event.currentTarget.value.replace(/[^\d]/g, ""))} /></label>
            </div>
            <div className="runtime-actions automation-actions">
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentFragmentPacket("request")}>Read Fragments</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentFragmentPacket("backpack")}>Read Backpack</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentFragmentPacket("trade")}>Trade With</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentFragmentPacket("add")}>Add Slot</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentFragmentPacket("accept")}>Accept</button>
              <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onSendPresentFragmentPacket("cancel")}>Cancel</button>
            </div>
          </div>
          <div className="mini-section">
            <h3>Fragment Packet Feed</h3>
            <div className="mini-table packet-detail-table">
              {presentCatcherPacketRows.slice().reverse().map((entry) => (
                <p key={entry.id}>
                  <span>{compactValue(entry.header)}</span>
                  <strong>{relayEntryV3Line(entry, relayLog?.updatedAt)}</strong>
                </p>
              ))}
              {presentCatcherPacketRows.length === 0 ? <p>No present/gift/fragment packets parsed yet.</p> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
