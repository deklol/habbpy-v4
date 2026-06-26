import { FolderInput } from "lucide-react";
import type { EngineRuntimeSnapshot } from "../../renderer/engineRuntime";
import { compactRuntimeValue, runtimeFps, runtimeTickRate } from "../../engine-adapter/shocklessSessionAdapter";
import type {
  ClientLibraryState,
  ClientSnapshot,
  ClientSessionSummary,
  EngineLaunchState,
  RelayLogEntry,
  RelayLogSnapshot,
} from "../../shared/window-api";
import type { PacketChatEntry, PacketInfoState, PacketInventoryState, PacketProfileUser, PacketWallItemState } from "../../renderer/ui/App";

interface ConnectionPanelProps {
  readonly desktopBridgeAvailable: boolean;
  readonly engineBusy: boolean;
  readonly profileImportRunning: boolean;
  readonly libraryState: ClientLibraryState | null;
  readonly bridgeMessage: string;
  readonly engineLaunch: EngineLaunchState | null;
  readonly relaySessionId: string;
  readonly selectedRuntimeSnapshot: EngineRuntimeSnapshot | null;
  readonly selectedClientRelayLog: RelayLogSnapshot | null;
  readonly latestClientPacket: RelayLogEntry | null;
  readonly latestServerPacket: RelayLogEntry | null;
  readonly selectedClientSnapshot: ClientSnapshot | null;
  readonly selectedClientSession: ClientSessionSummary | null;
  readonly selectedClientId: number;
  readonly packetProfileUsers: readonly PacketProfileUser[];
  readonly packetInfoState: PacketInfoState;
  readonly packetChatEntries: readonly PacketChatEntry[];
  readonly packetInventoryState: PacketInventoryState;
  readonly packetWallItemState: PacketWallItemState;
  readonly relayEncryptionState: string;
  readonly relayClientModes: string;
  readonly relayServerModes: string;
  readonly relayBodyLoggingState: string;
  readonly onImportClientReference: () => void;
  readonly onSelectClientProfile: (root: string) => void;
}

function compact(value: unknown): string {
  return compactRuntimeValue(value);
}

function labelCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusLabel(value: unknown): string {
  const label = labelCase(value);
  return label === "Done" ? "Complete" : label;
}

function profileLine(profile: { readonly label?: unknown; readonly buildNumber?: unknown; readonly versionId?: unknown } | null | undefined): string {
  if (!profile) return "No profile selected";
  const build = profile.buildNumber ? `build ${profile.buildNumber}` : profile.versionId;
  return `${profile.label ?? ""} / ${build}`;
}

function relayEntryDisplayName(entry: RelayLogEntry): string {
  const name = entry.packetName ?? "UNKNOWN_HEADER";
  return name === "UNKNOWN_HEADER" ? "[UNKNOWN_HEADER]" : name;
}

function relayPacketSummary(entry: RelayLogEntry | null): string {
  if (!entry) return "-";
  const client = entry.clientId ? `client${entry.clientId} \\ ` : "";
  return `${client}${relayEntryDisplayName(entry)} h${compact(entry.header)} #${compact(entry.sessionId)}`;
}

export function ConnectionPanel({
  desktopBridgeAvailable, engineBusy, profileImportRunning,
  libraryState, bridgeMessage, engineLaunch, relaySessionId,
  selectedRuntimeSnapshot, selectedClientRelayLog,
  latestClientPacket, latestServerPacket,
  selectedClientSnapshot, selectedClientSession, selectedClientId,
  packetProfileUsers, packetInfoState, packetChatEntries,
  packetInventoryState, packetWallItemState,
  relayEncryptionState, relayClientModes, relayServerModes, relayBodyLoggingState,
  onImportClientReference, onSelectClientProfile,
}: ConnectionPanelProps) {
  return (
    <div className="client-library">
      <div className="client-library-actions">
        <button
          className="wide-action"
          type="button"
          onClick={() => void onImportClientReference()}
          disabled={!desktopBridgeAvailable || engineBusy || profileImportRunning}
        >
          <FolderInput size={14} />
          <span>{profileImportRunning ? "Importing..." : "Import/Build Client"}</span>
        </button>
      </div>
      <div className="profile-list-compact">
        {(libraryState?.profiles ?? []).map((profile) => (
          <button
            className={`profile-option ${profile.profileRoot === libraryState?.selectedProfileRoot ? "active" : ""}`}
            type="button"
            key={profile.profileRoot}
            onClick={() => void onSelectClientProfile(profile.profileRoot)}
          >
            <strong>{profileLine(profile)}</strong>
            <small>{profile.ready ? "Ready / Referenced" : profile.reason}</small>
          </button>
        ))}
        {(libraryState?.profiles.length ?? 0) === 0 ? <p className="empty-panel-note">{bridgeMessage}</p> : null}
      </div>
      <div className="mini-section">
        <h3>Session</h3>
        <div className="kv-grid">
          <span>State</span>
          <strong>{profileImportRunning ? "Importing" : engineBusy ? "Starting" : statusLabel(engineLaunch?.status)}</strong>
          <span>Session ID</span>
          <strong>{relaySessionId}</strong>
          <span>Bridge</span>
          <strong>{compact(selectedRuntimeSnapshot?.networkBridgeUrl)}</strong>
          <span>Relay Log</span>
          <strong>{selectedClientRelayLog?.exists ? `${compact(selectedClientRelayLog.entries.length)} selected rows` : "Missing"}</strong>
          <span>Client Packets</span>
          <strong>{compact(selectedClientRelayLog?.clientCount)}</strong>
          <span>Server Packets</span>
          <strong>{compact(selectedClientRelayLog?.serverCount)}</strong>
          <span>Latest Client</span>
          <strong>{relayPacketSummary(latestClientPacket)}</strong>
          <span>Latest Server</span>
          <strong>{relayPacketSummary(latestServerPacket)}</strong>
        </div>
      </div>
      <div className="mini-section">
        <h3>Selected Client</h3>
        <div className="kv-grid">
          <span>Client</span>
          <strong>{selectedClientSnapshot?.client ? `client${selectedClientSnapshot.client.id} / ${selectedClientSnapshot.client.label}` : compact(selectedClientSession?.label)}</strong>
          <span>Mode</span>
          <strong>{selectedClientSnapshot?.client?.headless ? "headless" : selectedClientSnapshot?.client?.visible ? "visible" : "-"}</strong>
          <span>User</span>
          <strong>{compact(selectedClientSnapshot?.runtime?.userName ?? selectedClientSnapshot?.client?.username)}</strong>
          <span>Room</span>
          <strong>{compact(selectedClientSnapshot?.runtime?.roomName ?? selectedClientSnapshot?.client?.roomName)}</strong>
          <span>Users</span>
          <strong>{compact(selectedClientSnapshot?.runtime?.userCount)}</strong>
          <span>Relay</span>
          <strong>{selectedClientSnapshot?.relay ? `${selectedClientSnapshot.relay.packetCount} packets` : "-"}</strong>
          <span>Updated</span>
          <strong>{compact(selectedClientSnapshot?.runtime?.updatedAt)}</strong>
        </div>
      </div>
      <div className="mini-section">
        <h3>Parsed State</h3>
        <div className="kv-grid">
          <span>Client</span>
          <strong>client{selectedClientId}</strong>
          <span>Profiles</span>
          <strong>{compact(packetProfileUsers.length)}</strong>
          <span>Friends</span>
          <strong>{compact(packetInfoState.friends.length)}</strong>
          <span>Requests</span>
          <strong>{compact(packetInfoState.friendRequests.length)}</strong>
          <span>Messages</span>
          <strong>{compact(packetInfoState.privateMessages.length)}</strong>
          <span>Chat Rows</span>
          <strong>{compact(packetChatEntries.length)}</strong>
          <span>Inventory</span>
          <strong>{compact(packetInventoryState.totalCount)}</strong>
          <span>Wall Items</span>
          <strong>{compact(packetWallItemState.itemCount)}</strong>
        </div>
      </div>
      <div className="mini-section">
        <h3>Encryption</h3>
        <div className="kv-grid">
          <span>State</span>
          <strong>{relayEncryptionState}</strong>
          <span>Client Mode</span>
          <strong>{relayClientModes}</strong>
          <span>Server Mode</span>
          <strong>{relayServerModes}</strong>
          <span>Body Logging</span>
          <strong>{relayBodyLoggingState}</strong>
        </div>
      </div>
      <div className="mini-section">
        <h3>Engine</h3>
        <div className="kv-grid">
          <span>Title</span>
          <strong>{compact(selectedRuntimeSnapshot?.title)}</strong>
          <span>Runtime</span>
          <strong>{compact(selectedRuntimeSnapshot?.scriptBundle?.runtimeVersion)}</strong>
          <span>Presentation</span>
          <strong>{engineLaunch?.settings?.resizablePresentation ? "responsive" : "fixed-stage"}</strong>
          <span>FPS</span>
          <strong>{compact(runtimeFps(selectedRuntimeSnapshot))}</strong>
          <span>Ticks</span>
          <strong>{compact(runtimeTickRate(selectedRuntimeSnapshot))}</strong>
          <span>Scripts</span>
          <strong>{compact(selectedRuntimeSnapshot?.scriptBundle?.executableScripts)}</strong>
          <span>Fields</span>
          <strong>{compact(selectedRuntimeSnapshot?.editableFields.length)}</strong>
          <span>Windows</span>
          <strong>{compact(selectedRuntimeSnapshot?.windowIds.length)}</strong>
        </div>
      </div>
    </div>
  );
}
