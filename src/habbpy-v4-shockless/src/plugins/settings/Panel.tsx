import type {
  AppPreferencesState,
  AppPreferencesPatch,
  EngineLaunchState,
  EngineLaunchSettingsPatch,
  ConsoleCommandStateSnapshot,
} from "../../shared/window-api";

interface SettingsPanelProps {
  readonly desktopBridgeAvailable: boolean;
  readonly engineBusy: boolean;
  readonly engineLaunch: EngineLaunchState | null;
  readonly versionCheckDraft: string;
  readonly appPreferences: AppPreferencesState | null;
  readonly settingsBindKey: string;
  readonly settingsBindCommand: string;
  readonly consoleCommandState: ConsoleCommandStateSnapshot | null;
  readonly packetFilters: { wrap: boolean; autoscroll: boolean } & Record<string, unknown>;
  readonly multiAccountFile: string;
  readonly multiAccountCount: string;
  readonly multiAccountConcurrency: string;
  readonly multiAccountKeyEnv: string;
  readonly multiAccountSummonTarget: string;
  readonly multiAccountLoadMode: "headless" | "visible";
  readonly onUpdateEngineLaunchSettings: (patch: EngineLaunchSettingsPatch, message: string) => void;
  readonly onSetVersionCheckDraft: (v: string) => void;
  readonly onApplyVersionCheckBuild: () => void;
  readonly onUpdateHardwareAccelerationPreference: (enabled: boolean) => void;
  readonly onSetSettingsBindKey: (v: string) => void;
  readonly onSetSettingsBindCommand: (v: string) => void;
  readonly onRunMultiAccountCommand: (cmd: string) => void;
  readonly onSetPacketFilters: (setter: (current: { wrap: boolean; autoscroll: boolean } & Record<string, unknown>) => { wrap: boolean; autoscroll: boolean } & Record<string, unknown>) => void;
  readonly onUpdateAppPreferencePatch: (patch: AppPreferencesPatch, message: string) => void;
  readonly onSetMultiAccountFile: (v: string) => void;
  readonly onSetMultiAccountCount: (v: string) => void;
  readonly onSetMultiAccountConcurrency: (v: string) => void;
  readonly onSetMultiAccountKeyEnv: (v: string) => void;
  readonly onSetMultiAccountSummonTarget: (v: string) => void;
  readonly onSetMultiAccountLoadMode: (v: "headless" | "visible") => void;
  readonly onSaveSessionDefaultPreferences: () => void;
}

function commandArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function clampMultiAccountCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(50, parsed));
}

function clampMultiAccountConcurrency(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(8, parsed));
}

export function SettingsPanel({
  desktopBridgeAvailable,
  engineBusy,
  engineLaunch,
  versionCheckDraft,
  appPreferences,
  settingsBindKey,
  settingsBindCommand,
  consoleCommandState,
  packetFilters,
  multiAccountFile,
  multiAccountCount,
  multiAccountConcurrency,
  multiAccountKeyEnv,
  multiAccountSummonTarget,
  multiAccountLoadMode,
  onUpdateEngineLaunchSettings,
  onSetVersionCheckDraft,
  onApplyVersionCheckBuild,
  onUpdateHardwareAccelerationPreference,
  onSetSettingsBindKey,
  onSetSettingsBindCommand,
  onRunMultiAccountCommand,
  onSetPacketFilters,
  onUpdateAppPreferencePatch,
  onSetMultiAccountFile,
  onSetMultiAccountCount,
  onSetMultiAccountConcurrency,
  onSetMultiAccountKeyEnv,
  onSetMultiAccountSummonTarget,
  onSetMultiAccountLoadMode,
  onSaveSessionDefaultPreferences,
}: SettingsPanelProps) {
  return (
    <div className="runtime-panel settings-panel">
      <div className="mini-section">
        <h3>Engine</h3>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={engineLaunch?.settings?.customHotelView === true}
            disabled={!desktopBridgeAvailable || engineBusy || engineLaunch?.status === "running"}
            onChange={(event) => void onUpdateEngineLaunchSettings({ customHotelView: event.currentTarget.checked }, `Custom hotel view ${event.currentTarget.checked ? "enabled" : "disabled"}.`)}
          />
          <span>
            <strong>Custom Hotel View</strong>
            <small>Use the Habbpy hotel view when launching compatible profiles.</small>
          </span>
        </label>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={engineLaunch?.settings?.resizablePresentation !== false}
            disabled={!desktopBridgeAvailable || engineBusy || engineLaunch?.status === "running"}
            onChange={(event) => void onUpdateEngineLaunchSettings({ resizablePresentation: event.currentTarget.checked }, `Responsive stage resize ${event.currentTarget.checked ? "enabled" : "disabled"}.`)}
          />
          <span>
            <strong>Responsive Stage Resize</strong>
            <small>Adapt the stage to the app window while preserving the Director room.</small>
          </span>
        </label>
        <div className="runtime-input-row">
          <input
            value={versionCheckDraft}
            onChange={(event) => onSetVersionCheckDraft(event.currentTarget.value.replace(/[^\d]/g, ""))}
            placeholder="VERSIONCHECK auto"
            aria-label="Version check build override"
          />
          <button type="button" disabled={!desktopBridgeAvailable || engineBusy} onClick={onApplyVersionCheckBuild}>
            Apply
          </button>
          <button
            type="button"
            disabled={!desktopBridgeAvailable || engineBusy}
            onClick={() => {
              onSetVersionCheckDraft("");
              void onUpdateEngineLaunchSettings({ versionCheckBuild: null }, "Version check override cleared.");
            }}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="mini-section">
        <h3>Performance</h3>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={appPreferences?.hardwareAcceleration ?? true}
            onChange={(event) => void onUpdateHardwareAccelerationPreference(event.currentTarget.checked)}
            disabled={!desktopBridgeAvailable}
          />
          <span>
            <strong>Hardware Acceleration</strong>
            <small>{appPreferences?.hardwareAccelerationRestartRequired ? "Restart required for this change." : "GPU acceleration is active when available."}</small>
          </span>
        </label>
        <div className="mini-table">
          <p>
            <span>GPU Launch</span>
            <strong>{appPreferences?.hardwareAccelerationActive === false ? "Disabled" : "Enabled"}</strong>
          </p>
          <p>
            <span>Preference</span>
            <strong>{appPreferences?.hardwareAcceleration === false ? "Disabled" : "Enabled"}</strong>
          </p>
          <p>
            <span>Restart</span>
            <strong>{appPreferences?.hardwareAccelerationRestartRequired ? "Required" : "Not Required"}</strong>
          </p>
        </div>
      </div>

      <div className="mini-section">
        <h3>Hotkeys</h3>
        <div className="inline-field-grid">
          <label className="field-stack">
            <span>Key</span>
            <input value={settingsBindKey} onChange={(event) => onSetSettingsBindKey(event.currentTarget.value)} />
          </label>
          <label className="field-stack">
            <span>Command</span>
            <input value={settingsBindCommand} onChange={(event) => onSetSettingsBindCommand(event.currentTarget.value)} />
          </label>
        </div>
        <div className="runtime-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !settingsBindKey.trim() || !settingsBindCommand.trim()}
            onClick={() => void onRunMultiAccountCommand(`bind ${commandArg(settingsBindKey.trim())} ${commandArg(settingsBindCommand.trim())}`)}
          >
            Save Binding
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !settingsBindKey.trim()}
            onClick={() => void onRunMultiAccountCommand(`unbind ${commandArg(settingsBindKey.trim())}`)}
          >
            Remove Binding
          </button>
        </div>
        <div className="mini-table">
          {(consoleCommandState?.bindings ?? []).map((binding) => (
            <p key={binding.key}>
              <span>{binding.key}</span>
              <strong>{binding.command}</strong>
            </p>
          ))}
          {(consoleCommandState?.bindings.length ?? 0) === 0 ? (
            <p>
              <span>Bindings</span>
              <strong>No bindings configured.</strong>
            </p>
          ) : null}
        </div>
      </div>

      <div className="mini-section">
        <h3>Console</h3>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={packetFilters.wrap}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              onSetPacketFilters((current) => ({ ...current, wrap: checked }));
              void onUpdateAppPreferencePatch(
                { packetOutputWrap: checked },
                `Packet text wrapping ${checked ? "enabled" : "disabled"}.`,
              );
            }}
          />
          <span>
            <strong>Wrap Packet Text</strong>
            <small>Wrap long packet rows in the console and Packet Log panel.</small>
          </span>
        </label>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={packetFilters.autoscroll}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              onSetPacketFilters((current) => ({ ...current, autoscroll: checked }));
              void onUpdateAppPreferencePatch(
                { packetOutputAutoScroll: checked },
                `Packet auto scroll ${checked ? "enabled" : "disabled"}.`,
              );
            }}
          />
          <span>
            <strong>Auto Scroll Packet Output</strong>
            <small>Keep packet views pinned to the newest live rows.</small>
          </span>
        </label>
      </div>

      <div className="mini-section">
        <h3>Session Defaults</h3>
        <label className="field-stack">
          <span>Account File</span>
          <input value={multiAccountFile} onChange={(event) => onSetMultiAccountFile(event.currentTarget.value)} />
        </label>
        <div className="inline-field-grid">
          <label className="field-stack">
            <span>Count</span>
            <input value={multiAccountCount} onChange={(event) => onSetMultiAccountCount(event.currentTarget.value.replace(/[^\d]/g, ""))} />
          </label>
          <label className="field-stack">
            <span>Concurrency</span>
            <input value={multiAccountConcurrency} onChange={(event) => onSetMultiAccountConcurrency(event.currentTarget.value.replace(/[^\d]/g, ""))} />
          </label>
        </div>
        <label className="field-stack">
          <span>Key Env</span>
          <input value={multiAccountKeyEnv} onChange={(event) => onSetMultiAccountKeyEnv(event.currentTarget.value)} />
        </label>
        <label className="field-stack">
          <span>Summon Target</span>
          <input value={multiAccountSummonTarget} onChange={(event) => onSetMultiAccountSummonTarget(event.currentTarget.value)} />
        </label>
        <label className="field-stack">
          <span>Default Load Mode</span>
          <select
            value={multiAccountLoadMode}
            onChange={(event) => onSetMultiAccountLoadMode(event.currentTarget.value === "visible" ? "visible" : "headless")}
          >
            <option value="headless">Headless</option>
            <option value="visible">Visible</option>
          </select>
        </label>
        <label className="toggle-row checkbox-first-row">
          <input
            type="checkbox"
            checked={appPreferences?.autoSubmitVisibleLogin !== false}
            disabled={!desktopBridgeAvailable}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              void onUpdateAppPreferencePatch(
                { autoSubmitVisibleLogin: checked },
                `Visible client auto-login ${checked ? "enabled" : "disabled"}.`,
              );
            }}
          />
          <span>
            <strong>Auto-submit Visible Logins</strong>
            <small>Automatically submits credentials for loaded visible client sessions.</small>
          </span>
        </label>
        <div className="runtime-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
            onClick={() => void onSaveSessionDefaultPreferences()}
          >
            Save Defaults
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
            onClick={() =>
              void onRunMultiAccountCommand(
                `load ${commandArg(multiAccountFile.trim())} ${clampMultiAccountCount(multiAccountCount)}${multiAccountLoadMode === "headless" ? " --headless" : ""} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
              )
            }
          >
            Load Default
          </button>
        </div>
      </div>
    </div>
  );
}
