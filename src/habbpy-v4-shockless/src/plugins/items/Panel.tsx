import type { RuntimeItemRow } from "../../engine-adapter/shocklessSessionAdapter";
import type { FurniMetadataSnapshot, FurniMetadataEntry } from "../../shared/window-api";

interface ItemsPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly roomReady: boolean | null;
  readonly itemFilter: string;
  readonly socialMessage: string;
  readonly activeObjectsCount: number;
  readonly passiveObjectsCount: number;
  readonly wallCount: number;
  readonly filteredCount: number;
  readonly selectedLabel: string;
  readonly metadataEntryCount: number | null;
  readonly filteredItemRows: readonly RuntimeItemRow[];
  readonly selectedItemRow: RuntimeItemRow | null;
  readonly selectedItemMetadata: FurniMetadataEntry | null;
  readonly itemTitle: (row: RuntimeItemRow) => string;
  readonly itemMeta: (row: RuntimeItemRow) => string;
  readonly itemDisplayName: (item: RuntimeItemRow["item"] | undefined) => string;
  readonly onSetFilter: (v: string) => void;
  readonly onRead: () => void;
  readonly onSelectKey: (key: string) => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

export function ItemsPanel({
  engineUrl, runtimeBusy, roomReady, itemFilter, socialMessage,
  activeObjectsCount, passiveObjectsCount, wallCount, filteredCount,
  selectedLabel, metadataEntryCount,
  filteredItemRows, selectedItemRow, selectedItemMetadata,
  itemTitle, itemMeta, itemDisplayName,
  onSetFilter, onRead, onSelectKey,
}: ItemsPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-input-row item-filter-row">
        <input value={itemFilter} onChange={(e) => onSetFilter(e.currentTarget.value)} placeholder="Search items" aria-label="Search items" />
        <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRead()}>Read</button>
      </div>
      {socialMessage ? <p className="runtime-message">{socialMessage}</p> : null}
      <div className="kv-grid">
        <span>Floor Active</span><strong>{compact(activeObjectsCount)}</strong>
        <span>Floor Passive</span><strong>{compact(passiveObjectsCount)}</strong>
        <span>Wall Items</span><strong>{compact(wallCount)}</strong>
        <span>Filtered</span><strong>{compact(filteredCount)}</strong>
        <span>Selected</span><strong>{selectedItemRow ? `${selectedItemRow.label} ${compact(selectedItemRow.item.objectId ?? selectedItemRow.item.id)}` : "-"}</strong>
        <span>Catalogue</span><strong>{compact(metadataEntryCount)}</strong>
      </div>
      <div className="mini-section">
        <h3>Items</h3>
        <div className="item-list">
          {filteredItemRows.slice(0, 18).map((row) => (
            <button className={`item-row ${selectedItemRow?.key === row.key ? "active" : ""}`} key={row.key} type="button" onClick={() => onSelectKey(row.key)}>
              <span>{row.label}</span>
              <div><strong>{itemTitle(row)}</strong><small>{itemMeta(row)}</small></div>
            </button>
          ))}
          {filteredItemRows.length === 0 ? (
            <div className="item-row empty"><span>-</span><div><strong>{roomReady ? "No matching items" : "Waiting for room item data"}</strong><small>{roomReady ? "No matching items." : "Enter a room to populate the item list."}</small></div></div>
          ) : null}
        </div>
      </div>
      <div className="mini-section">
        <h3>Selected Detail</h3>
        <div className="mini-table item-detail-table">
          <p><span>Type</span><strong>{compact(selectedItemRow?.label)}</strong></p>
          <p><span>ID</span><strong>{compact(selectedItemRow?.item.objectId ?? selectedItemRow?.item.id)}</strong></p>
          <p><span>Class</span><strong>{compact(selectedItemRow?.item.className)}</strong></p>
          <p><span>Name</span><strong>{itemDisplayName(selectedItemRow?.item)}</strong></p>
          <p><span>Furni ID</span><strong>{compact(selectedItemMetadata?.id)}</strong></p>
          <p><span>Category</span><strong>{compact(selectedItemMetadata?.category)}</strong></p>
          <p><span>Desc</span><strong>{compact(selectedItemMetadata?.description)}</strong></p>
          <p><span>XY</span><strong>{compact(selectedItemRow?.item.x)}, {compact(selectedItemRow?.item.y)}, {compact(selectedItemRow?.item.z)}</strong></p>
          <p><span>Direction</span><strong>{compact(selectedItemRow?.item.direction)}</strong></p>
          <p><span>Owner</span><strong>{compact(selectedItemRow?.item.ownerName)}</strong></p>
          <p><span>Wall</span><strong>{compact(selectedItemRow?.item.wall)}</strong></p>
          <p><span>Local</span><strong>{compact(selectedItemRow?.item.local)}</strong></p>
          <p><span>Face</span><strong>{compact(selectedItemRow?.item.orientation)}</strong></p>
          <p><span>Raw Loc</span><strong>{compact(selectedItemRow?.item.rawLocation)}</strong></p>
          <p><span>State</span><strong>{compact(selectedItemRow?.item.state)}</strong></p>
        </div>
      </div>
    </div>
  );
}
