import { RefreshCw } from "lucide-react";
import type { EngineRuntimeSnapshot } from "../../renderer/engineRuntime";
import { runtimeLocation, runtimeRoomId, runtimeRoomOwner, runtimeRoomType, runtimeRoomProp } from "../../engine-adapter/shocklessSessionAdapter";

interface RoomPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly runtimeSnapshot: EngineRuntimeSnapshot | null;
  readonly privateRoomId: string;
  readonly publicRoomQuery: string;
  readonly roomStageClickX: string;
  readonly roomStageClickY: string;
  readonly runtimeMessage: string;
  readonly onRead: () => void;
  readonly onShowHotelView: () => void;
  readonly onOpenNavigator: () => void;
  readonly onSetPrivateRoomId: (v: string) => void;
  readonly onEnterPrivateRoom: (flatId: string) => void;
  readonly onSetPublicRoomQuery: (v: string) => void;
  readonly onEnterPublicRoom: (query: string) => void;
  readonly onSetStageClickX: (v: string) => void;
  readonly onSetStageClickY: (v: string) => void;
  readonly onWalk: (x: number, y: number) => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

function objectTitle(entry: Record<string, unknown>): string {
  return compact(entry.name ?? entry.className ?? entry.objectId ?? entry.id);
}

export function RoomPanel({
  engineUrl, runtimeBusy, runtimeSnapshot, privateRoomId, publicRoomQuery,
  roomStageClickX, roomStageClickY, runtimeMessage,
  onRead, onShowHotelView, onOpenNavigator,
  onSetPrivateRoomId, onEnterPrivateRoom, onSetPublicRoomQuery, onEnterPublicRoom,
  onSetStageClickX, onSetStageClickY, onWalk,
}: RoomPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-actions">
        <button className="wide-action" type="button" onClick={() => void onRead()} disabled={!engineUrl || runtimeBusy}>
          <RefreshCw size={14} /><span>Read Live Room</span>
        </button>
        <button className="wide-action" type="button" onClick={() => void onShowHotelView()} disabled={!engineUrl || runtimeBusy}>Hotel View</button>
        <button className="wide-action" type="button" onClick={() => void onOpenNavigator()} disabled={!engineUrl || runtimeBusy}>Public Navigator</button>
      </div>
      <form className="runtime-input-row" onSubmit={(e) => { e.preventDefault(); onEnterPrivateRoom(privateRoomId); }}>
        <input value={privateRoomId} onChange={(e) => onSetPrivateRoomId(e.currentTarget.value)} placeholder="Flat id" aria-label="Private room flat id" />
        <button type="submit" disabled={!engineUrl || runtimeBusy}>Enter</button>
      </form>
      <form className="runtime-input-row" onSubmit={(e) => { e.preventDefault(); onEnterPublicRoom(publicRoomQuery); }}>
        <input value={publicRoomQuery} onChange={(e) => onSetPublicRoomQuery(e.currentTarget.value)} placeholder="Public room name, id, unit, or port" aria-label="Public room query" />
        <button type="submit" disabled={!engineUrl || runtimeBusy}>Enter</button>
      </form>
      <form className="runtime-input-row" onSubmit={(e) => { e.preventDefault(); onWalk(Number(roomStageClickX), Number(roomStageClickY)); }}>
        <input value={roomStageClickX} onChange={(e) => onSetStageClickX(e.currentTarget.value)} placeholder="Stage x" aria-label="Walk stage x" />
        <input value={roomStageClickY} onChange={(e) => onSetStageClickY(e.currentTarget.value)} placeholder="Stage y" aria-label="Walk stage y" />
        <button type="submit" disabled={!engineUrl || runtimeBusy}>Walk</button>
      </form>
      <div className="kv-grid">
        <span>View</span><strong>{runtimeLocation(runtimeSnapshot)}</strong>
        <span>Room ID</span><strong>{runtimeRoomId(runtimeSnapshot)}</strong>
        <span>Owner</span><strong>{runtimeRoomOwner(runtimeSnapshot)}</strong>
        <span>Room Type</span><strong>{runtimeRoomType(runtimeSnapshot)}</strong>
        <span>Ready</span><strong>{compact(runtimeSnapshot?.roomReady?.ready ?? runtimeSnapshot?.roomEntryState?.roomReady?.ready)}</strong>
        <span>Entry</span><strong>{compact(runtimeSnapshot?.roomEntryState?.entryState?.state)}</strong>
        <span>Layout</span><strong>{compact(runtimeRoomProp(runtimeSnapshot, "#layout") ?? runtimeRoomProp(runtimeSnapshot, "layout"))}</strong>
        <span>Users</span><strong>{compact(runtimeSnapshot?.roomObjects?.counts.users)}</strong>
        <span>Floor Objects</span><strong>{compact(runtimeSnapshot?.roomObjects?.counts.activeObjects)}</strong>
        <span>Wall Items</span><strong>{compact(runtimeSnapshot?.roomObjects?.counts.wallItems)}</strong>
      </div>
      <div className="mini-section">
        <h3>Recent Room Objects</h3>
        <div className="mini-table">
          {(runtimeSnapshot?.roomObjects?.activeObjects ?? []).slice(0, 6).map((entry, index) => (
            <p key={`${entry.objectId ?? entry.id ?? index}`}>
              <span>{compact(entry.objectId ?? entry.id ?? index)}</span>
              <strong>{objectTitle(entry as Record<string, unknown>)}</strong>
            </p>
          ))}
          {(runtimeSnapshot?.roomObjects?.activeObjects.length ?? 0) === 0 ? <p>No active room objects yet.</p> : null}
        </div>
      </div>
      {runtimeMessage ? <p className="runtime-message">{runtimeMessage}</p> : null}
    </div>
  );
}
