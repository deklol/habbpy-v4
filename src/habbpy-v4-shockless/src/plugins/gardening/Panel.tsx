import type { RuntimeItemRow } from "../../engine-adapter/shocklessSessionAdapter";
import type { GardeningJobState } from "../../renderer/ui/App";
import type { EngineRuntimeSnapshot, RuntimeUserSummary } from "../../renderer/engineRuntime";
import { runtimeRoomName } from "../../engine-adapter/shocklessSessionAdapter";

interface GardeningPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly desktopBridgeAvailable: boolean;
  readonly roomReady: boolean | null;
  readonly gardeningRunning: boolean;
  readonly gardeningCycleSec: string;
  readonly gardeningMessage: string;
  readonly gardeningJob: GardeningJobState | null;
  readonly runtimeSnapshot: EngineRuntimeSnapshot | null;
  readonly plantRows: readonly RuntimeItemRow[];
  readonly selectedPlantRow: RuntimeItemRow | null;
  readonly selfUser: RuntimeUserSummary | null;
  readonly itemTitle: (row: RuntimeItemRow) => string;
  readonly itemMeta: (row: RuntimeItemRow) => string;
  readonly onStartGardening: (mode: "cycle" | "compost") => void;
  readonly onStopGardening: () => void;
  readonly onSetCycleSec: (v: string) => void;
  readonly onSelectPlant: (key: string) => void;
  readonly onRefresh: () => void;
}

function compact(value: unknown): string { const text = String(value ?? "").trim(); return text || "-"; }
function userTile(u: RuntimeUserSummary | null | undefined): { x: number; y: number } | null {
  if (!u) return null;
  const dx = typeof u.x === "number" ? u.x : NaN, dy = typeof u.y === "number" ? u.y : NaN;
  if (Number.isFinite(dx) && Number.isFinite(dy)) return { x: Math.trunc(dx), y: Math.trunc(dy) };
  const m = String(u.position ?? "").match(/(-?\d+)\s*,\s*(-?\d+)/);
  return m ? { x: Number.parseInt(m[1]!, 10), y: Number.parseInt(m[2]!, 10) } : null;
}

export function GardeningPanel({
  engineUrl, runtimeBusy, desktopBridgeAvailable, roomReady, gardeningRunning, gardeningCycleSec,
  gardeningMessage, gardeningJob, runtimeSnapshot, plantRows, selectedPlantRow, selfUser,
  itemTitle, itemMeta, onStartGardening, onStopGardening, onSetCycleSec, onSelectPlant, onRefresh,
}: GardeningPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-actions automation-actions">
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !roomReady || gardeningRunning || plantRows.length === 0} onClick={() => void onStartGardening("cycle")}>Start Gardening</button>
        <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || !roomReady || gardeningRunning || plantRows.length === 0} onClick={() => void onStartGardening("compost")}>Compost All</button>
        <button className="wide-action" type="button" disabled={!gardeningRunning} onClick={onStopGardening}>Stop</button>
        <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRefresh()}>Refresh</button>
      </div>
      <div className="chat-filter-row packet-filter-row" aria-label="Gardening settings">
        <label><span>Cycle sec</span><input value={gardeningCycleSec} onChange={(e) => onSetCycleSec(e.target.value)} inputMode="numeric" aria-label="Gardening cycle seconds" /></label>
      </div>
      <div className="kv-grid">
        <span>Room Ready</span><strong>{compact(roomReady)}</strong>
        <span>Plants</span><strong>{compact(plantRows.length)}</strong>
        <span>Ready</span><strong>{plantRows.length > 0 ? compact(plantRows.length) : "-"}</strong>
        <span>Phase</span><strong>{gardeningJob?.phase ?? "idle"}</strong>
        <span>Cycle Sec</span><strong>{compact(gardeningCycleSec)}</strong>
        <span>Tracked</span><strong>{compact(gardeningJob ? gardeningJob.queue.length + 1 : plantRows.length)}</strong>
        <span>Room</span><strong>{runtimeRoomName(runtimeSnapshot)}</strong>
        <span>Avatar Tile</span><strong>{userTile(selfUser) ? `${userTile(selfUser)?.x},${userTile(selfUser)?.y}` : "-"}</strong>
      </div>
      {gardeningMessage || gardeningJob?.note ? <p className="runtime-message">{gardeningMessage || gardeningJob?.note}</p> : null}
      <div className="mini-section"><h3>Plants In Room</h3>
        <div className="item-list">
          {plantRows.map((row) => (
            <button className={`item-row ${selectedPlantRow?.key === row.key ? "active" : ""}`} key={row.key} type="button" onClick={() => onSelectPlant(row.key)}>
              <span>{row.label}</span><div><strong>{itemTitle(row)}</strong><small>{itemMeta(row)}</small></div>
            </button>
          ))}
          {plantRows.length === 0 ? <div className="item-row empty"><span>-</span><div><strong>No plants found</strong><small>Enter a room with plants to populate this list.</small></div></div> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Current Target Plant</h3>
        <div className="mini-table item-detail-table">
          <p><span>ID</span><strong>{compact(selectedPlantRow?.item.objectId ?? selectedPlantRow?.item.id)}</strong></p>
          <p><span>Plant</span><strong>{compact(selectedPlantRow ? itemTitle(selectedPlantRow) : null)}</strong></p>
          <p><span>XY</span><strong>{compact(selectedPlantRow?.item.x)}, {compact(selectedPlantRow?.item.y)}, {compact(selectedPlantRow?.item.z)}</strong></p>
          <p><span>Stage</span><strong>{compact(selectedPlantRow?.item.state)}</strong></p>
          <p><span>Status</span><strong>{gardeningJob && selectedPlantRow && gardeningJob.plantKey === selectedPlantRow.key ? gardeningJob.phase : selectedPlantRow ? "queued" : "-"}</strong></p>
        </div>
      </div>
      <div className="mini-section"><h3>Current Cycle</h3>
        <div className="mini-table item-detail-table">
          <p><span>Target</span><strong>{compact(gardeningJob?.objectId)}</strong></p>
          <p><span>Original</span><strong>{gardeningJob ? `${gardeningJob.originalX},${gardeningJob.originalY} dir ${gardeningJob.originalDirection}` : "-"}</strong></p>
          <p><span>Working</span><strong>{gardeningJob ? `${gardeningJob.workingX},${gardeningJob.workingY}` : "-"}</strong></p>
          <p><span>Attempts</span><strong>{gardeningJob ? `move ${gardeningJob.moveAttempts} / action ${gardeningJob.actionAttempts}` : "-"}</strong></p>
          <p><span>Completed</span><strong>{compact(gardeningJob?.completed ?? 0)}</strong></p>
          <p><span>Queued</span><strong>{compact(gardeningJob?.queue.length ?? plantRows.length)}</strong></p>
        </div>
      </div>
    </div>
  );
}
