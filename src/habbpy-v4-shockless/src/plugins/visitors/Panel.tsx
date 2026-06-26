import type { VisitorEntry } from "../../renderer/ui/App";

interface VisitorsPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly visitorFilter: string;
  readonly visitorLookupBusy: boolean;
  readonly visitorStateActiveKeysLength: number;
  readonly visitorEntriesLength: number;
  readonly filteredVisitorEntries: readonly VisitorEntry[];
  readonly filteredVisitorEntriesLength: number;
  readonly visitorRoomName: string;
  readonly missingVisitorAccountIds: number;
  readonly visitorPublicProfilesCount: number;
  readonly visitorLookupMessage: string;
  readonly roomReady: boolean | null;
  readonly onSetFilter: (value: string) => void;
  readonly onRead: () => void;
  readonly onLookupIds: () => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
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
  ].filter(Boolean).join(" / ") || "-";
}

export function VisitorsPanel({
  engineUrl,
  runtimeBusy,
  visitorFilter,
  visitorLookupBusy,
  visitorStateActiveKeysLength,
  visitorEntriesLength,
  filteredVisitorEntries,
  filteredVisitorEntriesLength,
  visitorRoomName,
  missingVisitorAccountIds,
  visitorPublicProfilesCount,
  visitorLookupMessage,
  roomReady,
  onSetFilter,
  onRead,
  onLookupIds,
}: VisitorsPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-input-row visitor-filter-row">
        <input value={visitorFilter} onChange={(event) => onSetFilter(event.currentTarget.value)} placeholder="Search visitors" aria-label="Search visitors" />
        <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRead()}>Read</button>
        <button type="button" disabled={visitorLookupBusy || filteredVisitorEntries.every((entry) => entry.accountId !== "-")} onClick={() => void onLookupIds()}>Lookup IDs</button>
      </div>
      <div className="kv-grid">
        <span>Current</span><strong>{compact(visitorStateActiveKeysLength)}</strong>
        <span>Seen</span><strong>{compact(visitorEntriesLength)}</strong>
        <span>Filtered</span><strong>{compact(filteredVisitorEntriesLength)}</strong>
        <span>Room</span><strong>{visitorRoomName}</strong>
        <span>Missing IDs</span><strong>{compact(missingVisitorAccountIds)}</strong>
        <span>Public Profiles</span><strong>{compact(visitorPublicProfilesCount)}</strong>
      </div>
      {visitorLookupMessage ? <p className="runtime-message">{visitorLookupMessage}</p> : null}
      <div className="mini-section">
        <h3>Visitors</h3>
        <div className="visitor-list">
          {filteredVisitorEntries.map((entry) => (
            <div className={`visitor-row ${entry.current ? "visitor-current" : "visitor-left"}`} key={entry.key}>
              <span>{entry.current ? "*" : "-"}</span>
              <div><strong>{entry.name}</strong><small>{visitorMeta(entry)}</small></div>
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
  );
}
