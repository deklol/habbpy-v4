import type { InventoryDisplayRow } from "../../renderer/ui/App";

interface InventoryPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly inventoryFilter: string;
  readonly inventoryTotalCount: number;
  readonly inventoryRowCount: number;
  readonly inventoryFloorCount: number;
  readonly inventoryWallCount: number;
  readonly inventoryOpenState: string;
  readonly filteredInventoryRows: readonly InventoryDisplayRow[];
  readonly selectedInventoryRow: InventoryDisplayRow | null;
  readonly inventoryRowsLength: number;
  readonly inventoryNote: string | null;
  readonly onRequestHand: () => void;
  readonly onSetFilter: (value: string) => void;
  readonly onRead: () => void;
  readonly onSelectKey: (key: string) => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

export function InventoryPanel({
  engineUrl,
  runtimeBusy,
  inventoryFilter,
  inventoryTotalCount,
  inventoryRowCount,
  inventoryFloorCount,
  inventoryWallCount,
  inventoryOpenState,
  filteredInventoryRows,
  selectedInventoryRow,
  inventoryRowsLength,
  inventoryNote,
  onRequestHand,
  onSetFilter,
  onRead,
  onSelectKey,
}: InventoryPanelProps) {
  return (
    <div className="runtime-panel">
      <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRequestHand()}>
        Request Hand
      </button>
      <div className="runtime-input-row item-filter-row">
        <input value={inventoryFilter} onChange={(event) => onSetFilter(event.currentTarget.value)} placeholder="Search inventory" aria-label="Search inventory" />
        <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRead()}>Read</button>
      </div>
      <div className="kv-grid">
        <span>Total</span><strong>{compact(inventoryTotalCount)}</strong>
        <span>Rows</span><strong>{compact(inventoryRowCount)}</strong>
        <span>Floor</span><strong>{compact(inventoryFloorCount)}</strong>
        <span>Wall</span><strong>{compact(inventoryWallCount)}</strong>
        <span>State</span><strong>{compact(inventoryOpenState)}</strong>
      </div>
      <div className="mini-section">
        <h3>Inventory Items</h3>
        <div className="item-list inventory-table">
          {filteredInventoryRows.slice(0, 24).map((row: { key: string; kind: string; title: string; meta: string; detailRows: readonly { label: string; value: string }[] }) => (
            <button className={`item-row ${selectedInventoryRow?.key === row.key ? "active" : ""}`} key={row.key} type="button" onClick={() => onSelectKey(row.key)}>
              <span>{row.kind}</span>
              <div><strong>{row.title}</strong><small>{row.meta}</small></div>
            </button>
          ))}
          {filteredInventoryRows.length === 0 ? (
            <button className="item-row empty" type="button" disabled>
              <span>Empty</span>
              <div>
                <strong>{inventoryRowsLength === 0 ? inventoryNote ?? "Waiting for inventory packet rows." : "No inventory rows match the filter."}</strong>
                <small>{inventoryRowsLength === 0 ? "Use Request Hand or wait for STRIPINFO_2." : "Clear the search filter."}</small>
              </div>
            </button>
          ) : null}
        </div>
      </div>
      {selectedInventoryRow ? (
        <div className="mini-section">
          <h3>Item Detail</h3>
          <div className="mini-table item-detail-table">
            {selectedInventoryRow.detailRows.map((row: { readonly label: string; readonly value: string }) => (
              <p key={row.label}><span>{row.label}</span><strong>{compact(row.value)}</strong></p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
