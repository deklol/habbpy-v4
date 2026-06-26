import type { PacketInfoState, PacketInfoFriend, PacketFriendRequest, PacketMessengerMessage } from "../../renderer/ui/App";

interface SocialPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly desktopBridgeAvailable: boolean;
  readonly socialFriendFilter: string;
  readonly packetInfoState: PacketInfoState;
  readonly onlinePacketFriends: number;
  readonly filteredPacketFriends: readonly PacketInfoFriend[];
  readonly visiblePrivateMessages: readonly PacketMessengerMessage[];
  readonly visibleFriendRequests: readonly PacketFriendRequest[];
  readonly rightsCount: number;
  readonly sourceChatHistoryLength: number;
  readonly packetChatEntriesLength: number;
  readonly roomUserCount: number;
  readonly socialRequestCount: string;
  readonly socialMessageCount: string;
  readonly onSetFilter: (v: string) => void;
  readonly onRead: () => void;
  readonly onSendSocialAction: (action: Record<string, unknown>, label: string) => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

function packetFriendKey(f: PacketInfoFriend): string { return f.accountId !== "-" ? `id:${f.accountId}` : `name:${f.name.trim().toLowerCase()}`; }
function packetFriendTitle(f: PacketInfoFriend): string { const id = f.accountId !== "-" ? `#${f.accountId}` : ""; return [f.name, id, f.motto !== "-" ? f.motto : ""].filter(Boolean).join(" / ") || "-"; }
function packetFriendMeta(f: PacketInfoFriend): string { const parts = [f.online ? "online" : "offline", f.canFollow ? "follow" : "", f.location !== "-" ? f.location : "", f.lastAccess !== "-" ? `last ${f.lastAccess}` : ""].filter(Boolean); return parts.join(" / ") || "-"; }
function parseId(v: unknown): number | null { const n = Number.parseInt(compact(v), 10); return Number.isInteger(n) && n > 0 ? n : null; }
function packetFriendActionId(f: PacketInfoFriend): number | null { return parseId(f.accountId); }
function packetFriendRequestActionId(r: PacketFriendRequest): number | null { return parseId(r.accountId) ?? parseId(r.requestId); }

export function SocialPanel({
  engineUrl, runtimeBusy, desktopBridgeAvailable, socialFriendFilter, packetInfoState,
  onlinePacketFriends, filteredPacketFriends, visiblePrivateMessages, visibleFriendRequests,
  rightsCount, sourceChatHistoryLength, packetChatEntriesLength, roomUserCount,
  socialRequestCount, socialMessageCount, onSetFilter, onRead, onSendSocialAction,
}: SocialPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-input-row visitor-filter-row">
        <input value={socialFriendFilter} onChange={(e) => onSetFilter(e.currentTarget.value)} placeholder="Search friends" aria-label="Search friends" />
        <button type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onRead()}>Read</button>
      </div>
      <div className="kv-grid">
        <span>Friends</span><strong>{compact(packetInfoState.friends.length)}</strong>
        <span>Online</span><strong>{compact(onlinePacketFriends)}</strong>
        <span>Filtered</span><strong>{compact(filteredPacketFriends.length)}</strong>
        <span>Badges</span><strong>{compact(packetInfoState.badges.length)}</strong>
        <span>Active Badge</span><strong>{compact(packetInfoState.activeBadgeCode)}</strong>
        <span>Rights</span><strong>{compact(rightsCount)}</strong>
        <span>Chat Lines</span><strong>{compact(sourceChatHistoryLength > 0 ? sourceChatHistoryLength : packetChatEntriesLength)}</strong>
        <span>Room Users</span><strong>{compact(roomUserCount)}</strong>
        <span>Friend Limit</span><strong>{compact(packetInfoState.messengerUserLimit)}</strong>
        <span>Requests</span><strong>{compact(socialRequestCount)}</strong>
        <span>Messages</span><strong>{compact(socialMessageCount)}</strong>
      </div>
      <div className="mini-section"><h3>Friends</h3>
        <div className="mini-table">
          {filteredPacketFriends.slice(0, 14).map((friend) => {
            const accountId = packetFriendActionId(friend);
            return (
              <p className="social-row" key={packetFriendKey(friend)}>
                <span>{friend.online ? "On" : "Off"}</span>
                <strong>{packetFriendTitle(friend)} / {packetFriendMeta(friend)}</strong>
                <span className="social-row-actions">
                  <button type="button" disabled={!desktopBridgeAvailable || accountId === null || !friend.canFollow} onClick={() => accountId !== null && onSendSocialAction({ action: "followFriend", accountId, name: friend.name }, `Follow friend ${friend.name}`)}>Follow</button>
                  <button type="button" disabled={!desktopBridgeAvailable || accountId === null} onClick={() => accountId !== null && onSendSocialAction({ action: "removeFriend", accountId, name: friend.name }, `Remove friend ${friend.name}`)}>Remove</button>
                </span>
              </p>
            );
          })}
          {filteredPacketFriends.length === 0 ? <p><span>Friends</span><strong>{packetInfoState.friends.length === 0 ? "No friend rows parsed yet." : "No friends match the filter."}</strong></p> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Messages</h3>
        <div className="mini-table">
          {visiblePrivateMessages.map((message) => <p key={message.key}><span>{message.senderAccountId}</span><strong>{message.sentAt} / {message.text}</strong></p>)}
          {visiblePrivateMessages.length === 0 ? <p><span>Messages</span><strong>{packetInfoState.messengerMessageCount !== "-" ? `${packetInfoState.messengerMessageCount} listed, no rows decoded yet.` : "No private message rows parsed yet."}</strong></p> : null}
        </div>
      </div>
      <div className="mini-section">
        <div className="mini-section-title-row"><h3>Requests</h3>
          <button type="button" disabled={!desktopBridgeAvailable} onClick={() => onSendSocialAction({ action: "refreshFriendRequests" }, "Refresh friend requests")}>Refresh</button>
        </div>
        <div className="mini-table">
          {visibleFriendRequests.map((request) => {
            const accountId = packetFriendRequestActionId(request);
            return (
              <p className="social-row" key={request.key}><span>{request.accountId}</span><strong>{request.name} / request {request.requestId}</strong>
                <span className="social-row-actions">
                  <button type="button" disabled={!desktopBridgeAvailable || accountId === null} onClick={() => accountId !== null && onSendSocialAction({ action: "acceptRequest", accountId }, `Accept request ${request.name}`)}>Accept</button>
                  <button type="button" disabled={!desktopBridgeAvailable || accountId === null} onClick={() => accountId !== null && onSendSocialAction({ action: "declineRequest", accountId }, `Decline request ${request.name}`)}>Decline</button>
                </span>
              </p>
            );
          })}
          {visibleFriendRequests.length === 0 ? <p><span>Requests</span><strong>{packetInfoState.messengerRequestCount !== "-" ? `${packetInfoState.messengerRequestCount} listed, no rows decoded yet.` : "No friend request rows parsed yet."}</strong></p> : null}
        </div>
      </div>
      <div className="mini-section"><h3>Badges</h3>
        <div className="chip-list">{packetInfoState.badges.slice(0, 18).map((badge: string) => <span key={badge}>{badge}</span>)}{packetInfoState.badges.length === 0 ? <span>none</span> : null}</div>
      </div>
    </div>
  );
}
