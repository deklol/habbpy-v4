import type { RuntimeItemRow } from "../../engine-adapter/shocklessSessionAdapter";
import type { PacketFishingState, PacketFishingCatch, PacketFishopediaEntry } from "../../renderer/ui/App";

interface FishingPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly desktopBridgeAvailable: boolean;
  readonly roomReady: boolean | null;
  readonly fishingMessage: string;
  readonly packetFishingState: PacketFishingState;
  readonly fishingAreaRows: readonly RuntimeItemRow[];
  readonly selectedFishingAreaRow: RuntimeItemRow | null;
  readonly itemTitle: (row: RuntimeItemRow) => string;
  readonly itemMeta: (row: RuntimeItemRow) => string;
  readonly onStartFishing: () => void;
  readonly onSendAction: (action: Record<string, unknown>, label: string) => void;
  readonly onRefresh: () => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

function objectTitle(entry: Record<string, unknown>): string {
  return compact(entry.name ?? entry.className ?? entry.objectId ?? entry.id);
}

export function FishingPanel({
  engineUrl, runtimeBusy, desktopBridgeAvailable, roomReady, fishingMessage, packetFishingState,
  fishingAreaRows, selectedFishingAreaRow, itemTitle, itemMeta,
  onStartFishing, onSendAction, onRefresh,
}: FishingPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-actions automation-actions">
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !roomReady || runtimeBusy || !selectedFishingAreaRow} onClick={() => void onStartFishing()}>Start Fishing</button>
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || runtimeBusy} onClick={() => onSendAction({ action: "requestFishopedia" }, "Fishing request Fishopedia")}>Read Fishopedia</button>
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || runtimeBusy} onClick={() => onSendAction({ action: "requestTokens" }, "Fishing request tokens")}>Read Tokens</button>
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || runtimeBusy} onClick={() => onSendAction({ action: "registerDerby" }, "Fishing derby register")}>Register Derby</button>
        <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRefresh()}>Refresh</button>
      </div>
      <div className="kv-grid">
        <span>Room Ready</span><strong>{compact(roomReady)}</strong>
        <span>Areas</span><strong>{compact(fishingAreaRows.length)}</strong>
        <span>Target</span><strong>{compact(selectedFishingAreaRow ? objectTitle(selectedFishingAreaRow.item as Record<string, unknown>) : null)}</strong>
        <span>Status</span><strong>{packetFishingState.status}</strong>
        <span>Minigame</span><strong>{packetFishingState.minigameActive ? "active" : "idle"}</strong>
        <span>Pin</span><strong>{compact(packetFishingState.minigamePin)}</strong>
        <span>Catches</span><strong>{compact(packetFishingState.catches)}</strong>
        <span>Golden</span><strong>{compact(packetFishingState.golden)}</strong>
        <span>XP</span><strong>{compact(packetFishingState.xp)}</strong>
        <span>Tokens</span><strong>{compact(packetFishingState.tokens)}</strong>
        <span>Level</span><strong>{compact(packetFishingState.level)}</strong>
        <span>Frenzies</span><strong>{compact(packetFishingState.frenzies)}</strong>
        <span>Fishopedia</span><strong>{compact(packetFishingState.fishopedia.length)}</strong>
        <span>Last Action</span><strong>{compact(packetFishingState.lastClientAction)}</strong>
      </div>
      {fishingMessage || packetFishingState.note !== "-" ? <p className="runtime-message">{fishingMessage || packetFishingState.note}</p> : null}
      <div className="mini-section"><h3>Catch Log</h3>
        <div className="mini-table">
          {packetFishingState.catchLog.slice(-8).reverse().map((entry: PacketFishingCatch) => (
            <p key={entry.key}><span>{entry.golden ? "gold" : "fish"}</span><strong>{entry.fishName} / +{entry.xp} XP / line {entry.sourceLine}</strong></p>
          ))}
          {packetFishingState.catchLog.length === 0 ? <p><span>-</span><strong>No fishing catch packets parsed yet.</strong></p> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Active Fishing Areas</h3>
        <div className="item-list">
          {fishingAreaRows.slice(0, 8).map((row) => (
            <div className="item-row empty" key={row.key}><span>{row.label}</span><div><strong>{itemTitle(row)}</strong><small>{itemMeta(row)}</small></div></div>
          ))}
          {fishingAreaRows.length === 0 ? <div className="item-row empty"><span>-</span><div><strong>No fishing areas matched</strong><small>Enter a fishing room to populate this list.</small></div></div> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Fishopedia</h3>
        <div className="mini-table">
          {packetFishingState.fishopedia.slice(0, 10).map((entry: PacketFishopediaEntry) => (
            <p key={entry.key}><span>{entry.catches !== "-" ? entry.catches : "-"}</span><strong>{entry.fishName}{entry.xp !== "-" ? ` / ${entry.xp} XP` : ""}{entry.location !== "-" ? ` / ${entry.location}` : ""}</strong></p>
          ))}
          {packetFishingState.fishopedia.length === 0 ? <p><span>-</span><strong>No Fishopedia packets parsed yet.</strong></p> : null}
        </div>
      </div>
    </div>
  );
}
