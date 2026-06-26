interface AutomationPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly roomReady: boolean | null;
  readonly autoHideBulletin: boolean;
  readonly windowCount: number;
  readonly userCount: number;
  readonly fishAreaCount: number;
  readonly plantCount: number;
  readonly wallItemCount: number;
  readonly message: string;
  readonly onAutoHideChange: (enabled: boolean) => void;
  readonly onHideBulletin: () => void;
  readonly onReadWindows: () => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

export function AutomationPanel({
  engineUrl,
  runtimeBusy,
  roomReady,
  autoHideBulletin,
  windowCount,
  userCount,
  fishAreaCount,
  plantCount,
  wallItemCount,
  message,
  onAutoHideChange,
  onHideBulletin,
  onReadWindows,
}: AutomationPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="mini-section">
        <h3>Login Comfort</h3>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={autoHideBulletin}
            onChange={(event) => onAutoHideChange(event.currentTarget.checked)}
          />
          <span>Auto-hide Bulletin Board after login</span>
        </label>
        <div className="runtime-actions automation-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!engineUrl || runtimeBusy}
            onClick={() => void onHideBulletin()}
          >
            Hide Bulletin Now
          </button>
          <button className="wide-action" type="button" disabled={!engineUrl || runtimeBusy} onClick={() => void onReadWindows()}>
            Read Windows
          </button>
        </div>
        {message ? <p className="runtime-message">{message}</p> : null}
      </div>
      <div className="kv-grid">
        <span>Room Ready</span>
        <strong>{compact(roomReady)}</strong>
        <span>Auto Bulletin</span>
        <strong>{autoHideBulletin ? "Enabled" : "Disabled"}</strong>
        <span>Visible Windows</span>
        <strong>{compact(windowCount)}</strong>
        <span>Users</span>
        <strong>{compact(userCount)}</strong>
        <span>Fish Areas</span>
        <strong>{compact(fishAreaCount)}</strong>
        <span>Plants</span>
        <strong>{compact(plantCount)}</strong>
        <span>Wall Items</span>
        <strong>{compact(wallItemCount)}</strong>
      </div>
    </div>
  );
}
