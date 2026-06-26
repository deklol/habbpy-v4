import React from "react";
import { RefreshCw, FolderInput } from "lucide-react";
import type { EngineRuntimeSnapshot } from "../../renderer/engineRuntime";
import { compactRuntimeValue } from "../../engine-adapter/shocklessSessionAdapter";
import type { RelayLogEntry, RelayLogSnapshot } from "../../shared/window-api";
import { formatShockwavePacketParts } from "../../shared/shockwavePacketText";

// ----- helpers -----

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

function relayEntryLabel(entry: RelayLogEntry): string {
  const client = entry.clientId ? `c${entry.clientId} ` : "";
  if (entry.direction === "RELAY") return `${client}relay #${entry.sessionId ?? "-"}`;
  return `${client}${entry.direction} h${compactValue(entry.header)} ${compactValue(entry.size)}B`;
}

function relayEntryDisplayName(entry: RelayLogEntry): string {
  const name = entry.packetName ?? "UNKNOWN_HEADER";
  return name === "UNKNOWN_HEADER" ? "[UNKNOWN_HEADER]" : name;
}

function packetLogTimeLabel(updatedAt?: string | null): string {
  if (!updatedAt) return "--:--:--";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

function relayEntryV3Line(entry: RelayLogEntry, updatedAt?: string | null): string {
  const clientPrefix = entry.clientId ? `[client${entry.clientId}] ` : "";
  if (entry.header === null) return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}[RELAY ] ${entry.message}`;
  const sidPrefix = entry.sessionId ? `[${entry.sessionId.slice(0, 6)}] ` : "";
  const name = relayEntryDisplayName(entry);
  const header = compactValue(entry.header);
  const size = compactValue(entry.size);
  return `${packetLogTimeLabel(updatedAt)}  ${clientPrefix}${sidPrefix}[${entry.direction.padEnd(6, " ")}] ${name} [${header}] (${size}B)  ${formatHabbpyV3PacketText(entry)}`;
}

// ----- filter shape -----

export interface PacketLogFilters {
  readonly client: boolean;
  readonly server: boolean;
  readonly relay: boolean;
  readonly wrap: boolean;
  readonly autoscroll: boolean;
  readonly clientSession: string;
  readonly session: string;
  readonly search: string;
}

// ----- props -----

export interface PacketLogPanelProps {
  readonly desktopBridgeAvailable: boolean;
  readonly packetFilters: PacketLogFilters;
  readonly packetClientChoices: readonly { value: string; label: string }[];
  readonly packetSessionChoices: readonly string[];
  readonly packetListRef: { readonly current: HTMLDivElement | null };
  readonly handlePacketListScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  readonly visiblePacketEntries: readonly RelayLogEntry[];
  readonly renderedPacketEntries: readonly RelayLogEntry[];
  readonly selectedPacketEntry: RelayLogEntry | null;
  readonly packetVirtualRange: { height: number; top: number; start: number; end: number };
  readonly selectedRuntimeSnapshot: EngineRuntimeSnapshot | null;
  readonly relayLog: RelayLogSnapshot | null;
  readonly packetEntries: readonly RelayLogEntry[];
  readonly packetExportMessage: string;
  readonly onRefreshRelayLog: () => void;
  readonly onExportVisiblePacketLog: () => void;
  readonly onSetPacketClearOffset: (offset: number) => void;
  readonly onSetSelectedPacketKey: (key: string) => void;
  readonly onSetPacketExportMessage: (msg: string) => void;
  readonly onSetPacketFilters: (setter: (current: PacketLogFilters) => PacketLogFilters) => void;
}

// ----- component -----

export function PacketLogPanel(props: PacketLogPanelProps): React.ReactElement {
  const {
    desktopBridgeAvailable,
    packetFilters,
    packetClientChoices,
    packetSessionChoices,
    packetListRef,
    handlePacketListScroll,
    visiblePacketEntries,
    renderedPacketEntries,
    selectedPacketEntry,
    packetVirtualRange,
    selectedRuntimeSnapshot,
    relayLog,
    packetEntries,
    packetExportMessage,
    onRefreshRelayLog,
    onExportVisiblePacketLog,
    onSetPacketClearOffset,
    onSetSelectedPacketKey,
    onSetPacketExportMessage,
    onSetPacketFilters,
  } = props;

  return (
    <div className="runtime-panel">
      <div className="runtime-actions">
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable} onClick={() => void onRefreshRelayLog()}>
          <RefreshCw size={14} />
          <span>Refresh Relay Log</span>
        </button>
        <button className="wide-action" type="button" onClick={onExportVisiblePacketLog}>
          Export Visible
        </button>
        <button className="wide-action" type="button" onClick={() => { onSetPacketClearOffset(packetEntries.length); onSetSelectedPacketKey(""); onSetPacketExportMessage("Display cleared; relay log kept intact."); }}>
          Clear Display
        </button>
      </div>
      <div className="chat-filter-row packet-filter-row" aria-label="Packet log filters">
        {(["client", "server", "relay"] as const).map((kind) => (
          <label key={kind}>
            <input type="checkbox" checked={packetFilters[kind]} onChange={(event) => { const checked = event.currentTarget.checked; onSetPacketFilters((current) => ({ ...current, [kind]: checked })); }} />
            <span>{labelCase(kind)}</span>
          </label>
        ))}
        <label>
          <input type="checkbox" checked={packetFilters.wrap} onChange={(event) => { const checked = event.currentTarget.checked; onSetPacketFilters((current) => ({ ...current, wrap: checked })); }} />
          <span>wrap</span>
        </label>
        <label>
          <input type="checkbox" checked={packetFilters.autoscroll} onChange={(event) => { const checked = event.currentTarget.checked; onSetPacketFilters((current) => ({ ...current, autoscroll: checked })); }} />
          <span>auto</span>
        </label>
      </div>
      <div className="user-select-row packet-session-row">
        <input value={packetFilters.search} onChange={(event) => { const search = event.currentTarget.value; onSetPacketFilters((current) => ({ ...current, search })); }} placeholder="Search packets, body, fields" aria-label="Search packet log" />
        <select value={packetFilters.clientSession} onChange={(event) => { const clientSession = event.currentTarget.value; onSetPacketFilters((current) => ({ ...current, clientSession })); }} aria-label="Packet client filter">
          {packetClientChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </select>
        <select value={packetFilters.session} onChange={(event) => { const session = event.currentTarget.value; onSetPacketFilters((current) => ({ ...current, session })); }} aria-label="Packet session filter">
          {packetSessionChoices.map((sessionId) => (
            <option key={sessionId} value={sessionId}>{sessionId === "All" ? "All sessions" : `session ${sessionId}`}</option>
          ))}
        </select>
        <button type="button" onClick={() => onSetPacketFilters((current) => ({ ...current, client: true, server: true, relay: true, clientSession: "All", session: "All", search: "" }))} title="Reset packet filters" aria-label="Reset packet filters">
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="mini-section packet-list-section">
        <h3>Packet Log</h3>
        <div className={`packet-entry-list ${packetFilters.wrap ? "wrap" : ""}`} ref={packetListRef} onScroll={handlePacketListScroll}>
          {visiblePacketEntries.length > 0 ? (
            <div className="packet-entry-virtual-space" style={{ height: packetVirtualRange.height }}>
              <div className="packet-entry-virtual-window" style={{ transform: `translateY(${packetVirtualRange.top}px)` }}>
                {renderedPacketEntries.map((entry) => (
                  <button className={`packet-entry ${selectedPacketEntry?.id === entry.id ? "active" : ""} packet-${entry.direction.toLowerCase()}`} key={entry.id} type="button" onClick={() => onSetSelectedPacketKey(entry.id)}>
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
            <p><span>Line</span><strong>{compactValue(selectedPacketEntry?.lineNumber)}</strong></p>
            <p><span>Client</span><strong>{selectedPacketEntry?.clientId ? `client${selectedPacketEntry.clientId} ${selectedPacketEntry.clientLabel ?? ""}`.trim() : "-"}</strong></p>
            <p><span>Session</span><strong>{compactValue(selectedPacketEntry?.sessionId)}</strong></p>
            <p><span>Direction</span><strong>{compactValue(selectedPacketEntry?.direction)}</strong></p>
            <p><span>Name</span><strong>{selectedPacketEntry ? relayEntryDisplayName(selectedPacketEntry) : "-"}</strong></p>
            <p><span>Header</span><strong>{compactValue(selectedPacketEntry?.header)}</strong></p>
            <p><span>Size</span><strong>{compactValue(selectedPacketEntry?.size)}</strong></p>
            <p><span>Payload</span><strong>{selectedPacketEntry?.payloadBytes === null || selectedPacketEntry?.payloadBytes === undefined ? "-" : `${selectedPacketEntry.payloadBytes}B`}</strong></p>
            <p><span>v3 Line</span><strong>{selectedPacketEntry ? relayEntryV3Line(selectedPacketEntry, relayLog?.updatedAt) : "-"}</strong></p>
          </div>
          <h3 className="packet-subheading">Decrypted Body</h3>
          <div className="mini-table packet-detail-table">
            <p><span>ASCII</span><strong>{selectedPacketEntry?.bodyAscii ?? selectedPacketEntry?.bodyText ?? "-"}</strong></p>
            <p><span>Hex</span><strong>{selectedPacketEntry?.bodyHex ?? "-"}</strong></p>
            {(selectedPacketEntry?.decodedFields ?? []).map((field) => (
              <p key={`${field.label}:${field.value}`}><span>{field.label}</span><strong>{field.value}</strong></p>
            ))}
            {selectedPacketEntry && selectedPacketEntry.decodedFields.length === 0 ? (
              <p><span>Fields</span><strong>No decoded fields.</strong></p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="kv-grid packet-stats-grid">
        <span>Bridge</span><strong>{compactValue(selectedRuntimeSnapshot?.networkBridgeUrl)}</strong>
        <span>Log</span><strong>{relayLog?.exists ? "Present" : "Missing"}</strong>
        <span>Packets</span><strong>{compactValue(relayLog?.packetCount)}</strong>
        <span>Client</span><strong>{compactValue(relayLog?.clientCount)}</strong>
        <span>Server</span><strong>{compactValue(relayLog?.serverCount)}</strong>
        <span>Lines</span><strong>{compactValue(relayLog?.totalLines)}</strong>
        <span>Client Filter</span><strong>{packetFilters.clientSession === "All" ? "All clients" : `client${packetFilters.clientSession}`}</strong>
        <span>Visible</span><strong>{compactValue(visiblePacketEntries.length)}</strong>
      </div>
      <p className="runtime-message">{packetExportMessage || relayLog?.message || "Relay log snapshot not loaded."}</p>
    </div>
  );
}
