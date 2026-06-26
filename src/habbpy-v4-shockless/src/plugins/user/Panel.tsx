import { Copy, FolderInput, RefreshCw, Trash2 } from "lucide-react";
import type { EngineRuntimeSnapshot, RuntimeUserSummary } from "../../renderer/engineRuntime";
import { compactRuntimeValue, runtimeRoomName, runtimeRoomOwner } from "../../engine-adapter/shocklessSessionAdapter";

interface UserPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly selectedRuntimeSnapshot: EngineRuntimeSnapshot | null;
  readonly selectedUser: RuntimeUserSummary | null;
  readonly userRows: readonly RuntimeUserSummary[];
  readonly selectedUserName: string;
  readonly selectedUserAccountId: string;
  readonly selectedUserIndex: string;
  readonly selectedUserGender: string;
  readonly selectedUserType: string;
  readonly selectedUserBadgeCode: string;
  readonly selectedUserMotto: string;
  readonly selectedUserPosition: string;
  readonly selectedUserFigure: string;
  readonly selectedUserPoolFigure: string;
  readonly userToolMessage: string;
  readonly activeStoredUserLook: string;
  readonly userStoredLooks: readonly string[];
  readonly engineUserNameLabels: boolean;
  readonly onSetSelectedUserKey: (key: string) => void;
  readonly onRefresh: () => void;
  readonly onCopyUserValue: (label: string, value: unknown) => void;
  readonly onCopySelectedUserProfile: () => void;
  readonly onStoreSelectedUserLook: () => void;
  readonly onCopyStoredUserLook: () => void;
  readonly onSetSelectedStoredUserLook: (v: string) => void;
  readonly onClearStoredUserLooks: () => void;
  readonly onSendUserAction: (action: Record<string, unknown>, label: string) => void;
  readonly onSetEngineUserNameLabels: (v: boolean) => void;
  readonly onRunRuntimeAction: (action: Record<string, unknown>) => void;
}

function compact(value: unknown): string {
  return compactRuntimeValue(value);
}

function userDisplayName(user: RuntimeUserSummary | null, sessionName?: string | null): string {
  if (!user) return "-";
  return compact(user.name ?? (user.rowId === "0" ? sessionName : null) ?? user.objectClass ?? user.className ?? user.rowId);
}

function userPosition(user: RuntimeUserSummary | null): string {
  if (!user) return "-";
  return compact(user.position ?? (user.x !== undefined || user.y !== undefined ? `${compact(user.x)}, ${compact(user.y)}, ${compact(user.z)}` : null));
}

function userRowMeta(user: RuntimeUserSummary, sessionName?: string | null): string {
  const parts = [
    user.rowId === "0" && sessionName ? "you" : "",
    userPosition(user) !== "-" ? `loc ${userPosition(user)}` : "",
    user.direction !== undefined ? `dir ${compact(user.direction)}` : "",
    user.spriteCount !== undefined ? `${compact(user.spriteCount)} sprites` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

export function UserPanel({
  engineUrl, runtimeBusy, selectedRuntimeSnapshot, selectedUser, userRows,
  selectedUserName, selectedUserAccountId, selectedUserIndex, selectedUserGender,
  selectedUserType, selectedUserBadgeCode, selectedUserMotto, selectedUserPosition,
  selectedUserFigure, selectedUserPoolFigure, userToolMessage, activeStoredUserLook,
  userStoredLooks, engineUserNameLabels,
  onSetSelectedUserKey, onRefresh, onCopyUserValue, onCopySelectedUserProfile,
  onStoreSelectedUserLook, onCopyStoredUserLook, onSetSelectedStoredUserLook,
  onClearStoredUserLooks, onSendUserAction, onSetEngineUserNameLabels, onRunRuntimeAction,
}: UserPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="user-select-row">
        <select
          value={selectedUser?.rowId ?? ""}
          onChange={(event) => onSetSelectedUserKey(event.currentTarget.value)}
          disabled={userRows.length === 0}
          aria-label="Room user"
        >
          {userRows.length > 0 ? (
            userRows.map((user) => (
              <option key={user.rowId} value={user.rowId}>
                {userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName)} ({user.rowId})
              </option>
            ))
          ) : (
            <option value="">No room users</option>
          )}
        </select>
        <button
          type="button"
          disabled={!engineUrl || runtimeBusy}
          onClick={() => void onRefresh()}
          aria-label="Refresh user state"
          title="Refresh user state"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="kv-grid">
        <span>Session User</span>
        <strong>{compact(selectedRuntimeSnapshot?.userState?.sessionUserName)}</strong>
        <span>Room Users</span>
        <strong>{compact(selectedRuntimeSnapshot?.userState?.roomUserCount ?? selectedRuntimeSnapshot?.roomObjects?.counts.users)}</strong>
        <span>Room</span>
        <strong>{compact(selectedRuntimeSnapshot?.userState?.roomName ?? runtimeRoomName(selectedRuntimeSnapshot))}</strong>
        <span>Owner</span>
        <strong>{compact(selectedRuntimeSnapshot?.userState?.roomOwner ?? runtimeRoomOwner(selectedRuntimeSnapshot))}</strong>
        <span>Rights</span>
        <strong>{compact(selectedRuntimeSnapshot?.userState?.rightsCount)}</strong>
      </div>
      <div className="mini-section">
        <h3>Profile</h3>
        <div className="mini-table user-detail-table">
          <p>
            <span>Name</span>
            <strong>{selectedUserName}</strong>
          </p>
          <p>
            <span>Account</span>
            <strong>{selectedUserAccountId}</strong>
          </p>
          <p>
            <span>Index</span>
            <strong>{selectedUserIndex}</strong>
          </p>
          <p>
            <span>Gender</span>
            <strong>{selectedUserGender}</strong>
          </p>
          <p>
            <span>Type</span>
            <strong>{selectedUserType}</strong>
          </p>
          <p>
            <span>Badge</span>
            <strong>{selectedUserBadgeCode}</strong>
          </p>
          <p>
            <span>Motto</span>
            <strong>{selectedUserMotto}</strong>
          </p>
        </div>
      </div>
      <div className="mini-section">
        <h3>State</h3>
        <div className="mini-table user-detail-table">
          <p>
            <span>Position</span>
            <strong>{selectedUserPosition}</strong>
          </p>
          <p>
            <span>Direction</span>
            <strong>{compact(selectedUser?.direction)}</strong>
          </p>
          <p>
            <span>Activity</span>
            <strong>{compact(selectedUser?.activity)}</strong>
          </p>
          <p>
            <span>Typing</span>
            <strong>{compact(selectedUser?.typing)}</strong>
          </p>
          <p>
            <span>Expression</span>
            <strong>{compact(selectedUser?.expression)}</strong>
          </p>
          <p>
            <span>Last Said</span>
            <strong>{compact(selectedUser?.lastSaid)}</strong>
          </p>
          <p>
            <span>Last Action</span>
            <strong>{compact(selectedUser?.lastAction)}</strong>
          </p>
        </div>
      </div>
      <div className="mini-section">
        <h3>Appearance</h3>
        <div className="mini-table user-detail-table">
          <p>
            <span>Figure</span>
            <strong>{selectedUserFigure}</strong>
          </p>
          <p>
            <span>PH Figure</span>
            <strong>{selectedUserPoolFigure}</strong>
          </p>
          <p>
            <span>Sprites</span>
            <strong>{compact(selectedUser?.spriteCount)}</strong>
          </p>
        </div>
      </div>
      <div className="mini-section">
        <h3>Profile Tools</h3>
        {userToolMessage ? <p className="runtime-message">{userToolMessage}</p> : null}
        <div className="runtime-actions user-tool-actions">
          <button className="wide-action" type="button" disabled={!selectedUser} onClick={() => void onCopyUserValue("name", selectedUserName)}>
            <Copy size={12} /> Name
          </button>
          <button className="wide-action" type="button" disabled={!selectedUser} onClick={() => void onCopySelectedUserProfile()}>
            <Copy size={12} /> Profile
          </button>
          <button className="wide-action" type="button" disabled={!selectedUser || selectedUserMotto === "-"} onClick={() => void onCopyUserValue("motto", selectedUserMotto)}>
            <Copy size={12} /> Motto
          </button>
          <button className="wide-action" type="button" disabled={!selectedUser || selectedUserFigure === "-"} onClick={() => void onCopyUserValue("figure", selectedUserFigure)}>
            <Copy size={12} /> Figure
          </button>
          <button className="wide-action" type="button" disabled={!selectedUser || selectedUserFigure === "-"} onClick={onStoreSelectedUserLook}>
            <FolderInput size={12} /> Store Look
          </button>
          <button className="wide-action" type="button" disabled={!activeStoredUserLook} onClick={() => void onCopyStoredUserLook()}>
            <Copy size={12} /> Stored
          </button>
        </div>
        <div className="user-stored-look-row">
          <select
            value={activeStoredUserLook}
            onChange={(event) => onSetSelectedStoredUserLook(event.currentTarget.value)}
            disabled={userStoredLooks.length === 0}
            aria-label="Stored user look"
          >
            {userStoredLooks.length > 0 ? (
              userStoredLooks.map((look) => (
                <option key={look} value={look}>
                  {look}
                </option>
              ))
            ) : (
              <option value="">No stored parsed looks</option>
            )}
          </select>
          <button type="button" title="Copy stored look" aria-label="Copy stored look" disabled={!activeStoredUserLook} onClick={() => void onCopyStoredUserLook()}>
            <Copy size={12} />
          </button>
          <button type="button" title="Clear stored looks" aria-label="Clear stored looks" disabled={userStoredLooks.length === 0} onClick={onClearStoredUserLooks}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="mini-section">
        <h3>Room Users</h3>
        <div className="mini-table user-list-table">
          {userRows.slice(0, 12).map((user) => (
            <p key={user.rowId}>
              <span>{compact(user.rowId)}</span>
              <strong>{userDisplayName(user, selectedRuntimeSnapshot?.userState?.sessionUserName)} / {userRowMeta(user, selectedRuntimeSnapshot?.userState?.sessionUserName)}</strong>
            </p>
          ))}
          {userRows.length === 0 ? (
            <p>No room users are available until a room session is active.</p>
          ) : null}
        </div>
      </div>
      <div className="mini-section">
        <h3>Session Rights</h3>
        <div className="chip-list">
          {(selectedRuntimeSnapshot?.userState?.rights ?? []).slice(0, 14).map((right) => (
            <span key={right}>{right}</span>
          ))}
          {(selectedRuntimeSnapshot?.userState?.rights.length ?? 0) === 0 ? <span>none</span> : null}
        </div>
      </div>
      <div className="mini-section">
        <h3>Actions</h3>
        <div className="runtime-actions user-tool-actions user-action-blocks">
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "wave" }, "Wave")} disabled={!engineUrl || runtimeBusy}>Wave</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "dance", number: 1 }, "Dance")} disabled={!engineUrl || runtimeBusy}>Dance 1</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "dance", number: 2 }, "Dance 2")} disabled={!engineUrl || runtimeBusy}>Dance 2</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "dance", number: 3 }, "Dance 3")} disabled={!engineUrl || runtimeBusy}>Dance 3</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "dance", number: 4 }, "Dance 4")} disabled={!engineUrl || runtimeBusy}>Dance 4</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "stopDance" }, "Stop Dance")} disabled={!engineUrl || runtimeBusy}>Stop Dance</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "hcdance", number: 2 }, "HC Dance")} disabled={!engineUrl || runtimeBusy}>HC Dance</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "carryDrink" }, "Carry Drink")} disabled={!engineUrl || runtimeBusy}>Carry Drink</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "applyLook", figure: selectedUserFigure }, "Apply Look")} disabled={!engineUrl || runtimeBusy || selectedUserFigure === "-"}>Apply Look</button>
          <button className="wide-action" type="button" onClick={() => void onSendUserAction({ action: "applyLook", figure: activeStoredUserLook }, "Apply Stored Look")} disabled={!engineUrl || runtimeBusy || !activeStoredUserLook}>Apply Stored</button>
          <button className="wide-action" type="button" onClick={() => { const enabled = !engineUserNameLabels; onSetEngineUserNameLabels(enabled); void onRunRuntimeAction({ kind: "setUserNameLabels", enabled }); }} disabled={!engineUrl || runtimeBusy}>
            {engineUserNameLabels ? "Hide Names" : "Show Names"}
          </button>
        </div>
      </div>
    </div>
  );
}
