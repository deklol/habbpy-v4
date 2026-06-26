import type { RuntimeItemRow } from "../../engine-adapter/shocklessSessionAdapter";
import type { WallMoverLocation } from "../../renderer/ui/App";

interface WallMoverPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly desktopBridgeAvailable: boolean;
  readonly wallMoverMessage: string;
  readonly rightsCount: number | string;
  readonly selectedItemId: number | null;
  readonly selectedClassName: string;
  readonly selectedOwnerName: string;
  readonly selectedWallPos: string;
  readonly selectedLocalPos: string;
  readonly selectedOrientation: string;
  readonly wallMoverStep: string;
  readonly selectedLocation: WallMoverLocation | null;
  readonly wallMoverRows: readonly RuntimeItemRow[];
  readonly selectedRow: RuntimeItemRow | null;
  readonly itemTitle: (row: RuntimeItemRow) => string;
  readonly itemMeta: (item: RuntimeItemRow["item"]) => string;
  readonly onRefresh: () => void;
  readonly onSetStep: (value: string) => void;
  readonly onPickup: () => void;
  readonly onMove: (dx: number, dy: number, orientation?: "l" | "r") => void;
  readonly onSelectKey: (key: string) => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

export function WallMoverPanel({
  engineUrl,
  runtimeBusy,
  desktopBridgeAvailable,
  wallMoverMessage,
  rightsCount,
  selectedItemId,
  selectedClassName,
  selectedOwnerName,
  selectedWallPos,
  selectedLocalPos,
  selectedOrientation,
  wallMoverStep,
  selectedLocation,
  wallMoverRows,
  selectedRow,
  itemTitle,
  itemMeta,
  onRefresh,
  onSetStep,
  onPickup,
  onMove,
  onSelectKey,
}: WallMoverPanelProps) {
  const moveDisabled = !desktopBridgeAvailable || selectedItemId === null || selectedLocation === null;
  return (
    <div className="runtime-panel">
      <div className="runtime-actions automation-actions">
        <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRefresh()}>Refresh</button>
      </div>
      {wallMoverMessage ? <p className="runtime-message">{wallMoverMessage}</p> : null}
      <div className="kv-grid">
        <span>Rights</span><strong>{compact(rightsCount)}</strong>
        <span>Target ID</span><strong>{compact(selectedItemId)}</strong>
        <span>Class</span><strong>{compact(selectedClassName)}</strong>
        <span>Owner</span><strong>{compact(selectedOwnerName)}</strong>
        <span>Wall Pos</span><strong>{compact(selectedWallPos)}</strong>
        <span>Local Pos</span><strong>{compact(selectedLocalPos)}</strong>
        <span>Orientation</span><strong>{compact(selectedOrientation)}</strong>
        <span>Step</span><strong>{compact(wallMoverStep)}</strong>
      </div>
      <div className="mini-section">
        <h3>Move</h3>
        <div className="inline-field-grid">
          <label className="field-stack">
            <span>Step</span>
            <input value={wallMoverStep} onChange={(event) => onSetStep(event.currentTarget.value.replace(/[^\d]/g, "").slice(0, 2))} inputMode="numeric" />
          </label>
          <button className="wide-action" type="button" disabled={!desktopBridgeAvailable || selectedItemId === null} onClick={() => void onPickup()}>Pick Up Selected</button>
        </div>
        <div className="wall-mover-pad" aria-label="Wall mover nudge controls">
          <span />
          <button type="button" disabled={moveDisabled} onClick={() => void onMove(0, -1)}>Up</button>
          <span />
          <button type="button" disabled={moveDisabled} onClick={() => void onMove(-1, 0)}>Left</button>
          <button type="button" disabled={moveDisabled} onClick={() => void onMove(0, 1)}>Down</button>
          <button type="button" disabled={moveDisabled} onClick={() => void onMove(1, 0)}>Right</button>
        </div>
        <div className="wall-mover-action-row">
          <button type="button" disabled={moveDisabled} onClick={() => void onMove(0, 0, "l")}>Face L</button>
          <button type="button" disabled={moveDisabled} onClick={() => void onMove(0, 0, "r")}>Face R</button>
        </div>
      </div>
      <div className="mini-section">
        <h3>Wall Items</h3>
        <div className="item-list">
          {wallMoverRows.slice(0, 14).map((row) => (
            <button className={`item-row ${selectedRow?.key === row.key ? "active" : ""}`} key={row.key} type="button" onClick={() => onSelectKey(row.key)}>
              <span>Wall</span>
              <div><strong>{itemTitle(row)}</strong><small>{itemMeta(row.item)}</small></div>
            </button>
          ))}
          {wallMoverRows.length === 0 ? (
            <div className="item-row empty"><span>-</span><div><strong>No wall items found</strong><small>Enter a room with wall furni to populate this list.</small></div></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
