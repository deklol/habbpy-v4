import { RefreshCw } from "lucide-react";
import type { EngineRuntimeSnapshot } from "../../renderer/engineRuntime";
import type { PacketInfoState } from "../../renderer/ui/App";
import type { OriginsUserLookupResult } from "../../shared/window-api";
import { runtimeRoomName, runtimeRoomId, runtimeRoomOwner, runtimeRoomProp } from "../../engine-adapter/shocklessSessionAdapter";

interface InfoPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly runtimeSnapshot: EngineRuntimeSnapshot | null;
  readonly packetInfoState: PacketInfoState;
  readonly inventoryTotalCount: number;
  readonly socialRequestCount: string | number;
  readonly socialMessageCount: string | number;
  readonly selectedUserAccountId: string;
  readonly selectedUserBadgeCode: string;
  readonly publicLookupName: string;
  readonly publicLookupBusy: boolean;
  readonly publicLookupResult: OriginsUserLookupResult | null;
  readonly selectedUserName: string | null;
  readonly onRead: () => void;
  readonly onLookupPublicUser: () => void;
  readonly onSetPublicLookupName: (v: string) => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

export function InfoPanel({
  engineUrl, runtimeBusy, runtimeSnapshot, packetInfoState,
  inventoryTotalCount, socialRequestCount, socialMessageCount,
  selectedUserAccountId, selectedUserBadgeCode,
  publicLookupName, publicLookupBusy, publicLookupResult, selectedUserName,
  onRead, onLookupPublicUser, onSetPublicLookupName,
}: InfoPanelProps) {
  return (
    <div className="runtime-panel">
      <button className="wide-action" type="button" onClick={() => void onRead()} disabled={!engineUrl || runtimeBusy}>
        <RefreshCw size={14} /><span>Read Info</span>
      </button>
      <div className="kv-grid">
        <span>Name</span><strong>{compact(runtimeSnapshot?.userState?.sessionUserName)}</strong>
        <span>Account ID</span><strong>{compact(selectedUserAccountId)}</strong>
        <span>Badge</span><strong>{packetInfoState.activeBadgeCode !== "-" ? packetInfoState.activeBadgeCode : compact(selectedUserBadgeCode)}</strong>
        <span>Room</span><strong>{runtimeRoomName(runtimeSnapshot)} [{runtimeRoomId(runtimeSnapshot)}]</strong>
        <span>Owner</span><strong>{runtimeRoomOwner(runtimeSnapshot)}</strong>
        <span>Layout</span><strong>{compact(runtimeRoomProp(runtimeSnapshot, "#layout") ?? runtimeRoomProp(runtimeSnapshot, "layout"))}</strong>
        <span>Inventory</span><strong>{compact(inventoryTotalCount)}</strong>
        <span>Rights</span><strong>{compact(runtimeSnapshot?.userState?.rightsCount)}</strong>
        <span>Friends</span><strong>{compact(packetInfoState.friends.length)}</strong>
        <span>Badges</span><strong>{compact(packetInfoState.badges.length)}</strong>
        <span>Effects</span><strong>{compact(packetInfoState.statusEffects.length)}</strong>
        <span>Prefs</span><strong>{compact(packetInfoState.preferences.length)}</strong>
        <span>Requests</span><strong>{compact(socialRequestCount)}</strong>
        <span>Messages</span><strong>{compact(socialMessageCount)}</strong>
      </div>
      <div className="mini-section"><h3>Rights</h3>
        <div className="chip-list">
          {(runtimeSnapshot?.userState?.rights ?? []).slice(0, 18).map((right) => <span key={right}>{right}</span>)}
          {(runtimeSnapshot?.userState?.rights.length ?? 0) === 0 ? <span>none</span> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Badges</h3>
        <div className="chip-list">
          {packetInfoState.badges.slice(0, 24).map((badge: string) => <span key={badge}>{badge}</span>)}
          {packetInfoState.badges.length === 0 ? <span>none</span> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Preferences</h3>
        <div className="mini-table">
          {packetInfoState.preferences.slice(0, 12).map((preference: string, index: number) => <p key={`${index}:${preference}`}><span>{index + 1}</span><strong>{preference}</strong></p>)}
          {packetInfoState.preferences.length === 0 ? <p><span>Prefs</span><strong>-</strong></p> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Effects</h3>
        <div className="mini-table">
          {packetInfoState.statusEffects.slice(0, 12).map((effect: { name: string; value: string }) => <p key={`${effect.name}:${effect.value}`}><span>{effect.value}</span><strong>{effect.name}</strong></p>)}
          {packetInfoState.statusEffects.length === 0 ? <p><span>Effects</span><strong>-</strong></p> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Public User Lookup</h3>
        <form className="runtime-input-row" onSubmit={(e) => { e.preventDefault(); onLookupPublicUser(); }}>
          <input value={publicLookupName} onChange={(e) => onSetPublicLookupName(e.currentTarget.value)} placeholder={selectedUserName && selectedUserName !== "-" ? selectedUserName : "Habbo name"} aria-label="Origins public user lookup name" />
          <button type="submit" disabled={publicLookupBusy}>Lookup</button>
        </form>
        <div className="kv-grid">
          <span>Name</span><strong>{compact(publicLookupResult?.name)}</strong>
          <span>ID</span><strong>{compact(publicLookupResult?.id)}</strong>
          <span>Motto</span><strong>{compact(publicLookupResult?.motto)}</strong>
          <span>Figure</span><strong>{compact(publicLookupResult?.figureString)}</strong>
          <span>Created</span><strong>{compact(publicLookupResult?.memberSince)}</strong>
          <span>Visible</span><strong>{compact(publicLookupResult?.profileVisible)}</strong>
        </div>
        {publicLookupResult ? <p className="runtime-message">{publicLookupResult.message}</p> : null}
        {(publicLookupResult?.selectedBadges.length ?? 0) > 0 ? (
          <div className="chip-list">{publicLookupResult?.selectedBadges.map((badge: string) => <span key={badge}>{badge}</span>)}</div>
        ) : null}
      </div>
    </div>
  );
}
