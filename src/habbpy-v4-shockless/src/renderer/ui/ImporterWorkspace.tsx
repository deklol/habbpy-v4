import { FolderInput, Play, RefreshCw } from "lucide-react";
import type { EngineLaunchState, ClientProfileSummary } from "../../shared/window-api";
import {
  profileLine,
  statusLabel,
  compactValue,
  profileImportStatusLabel,
  profileImportStageEntry,
  formatImportElapsed,
  PROFILE_IMPORT_STAGES,
  PROFILE_IMPORT_STAGE_LABELS,
  type ProfileImportUiState,
} from "./helpers";

interface ImporterWorkspaceProps {
  readonly bridgeAvailable: boolean;
  readonly bridgeMessage: string;
  readonly engineBusy: boolean;
  readonly settingsBusy: boolean;
  readonly engineLaunch: EngineLaunchState | null;
  readonly elapsedMs: number;
  readonly importState: ProfileImportUiState;
  readonly profiles: readonly ClientProfileSummary[];
  readonly selectedProfile: ClientProfileSummary | null;
  readonly onImport: () => void;
  readonly onRefresh: () => void;
  readonly onStart: () => void;
  readonly onSetCustomHotelView: (enabled: boolean) => void;
  readonly onSetResizablePresentation: (enabled: boolean) => void;
  readonly onSetVersionCheckBuild: () => void;
  readonly versionCheckDraft: string;
  readonly onVersionCheckDraftChange: (value: string) => void;
}

export function ImporterWorkspace({
  bridgeAvailable, bridgeMessage, engineBusy, settingsBusy, engineLaunch,
  elapsedMs, importState, profiles, selectedProfile,
  onImport, onRefresh, onStart,
  onSetCustomHotelView, onSetResizablePresentation, onSetVersionCheckBuild,
  versionCheckDraft, onVersionCheckDraftChange,
}: ImporterWorkspaceProps) {
  const latest = importState.latest;
  const latestPercent = Math.max(0, Math.min(100, Math.round(latest?.percent ?? 0)));
  const profileReady = Boolean(selectedProfile?.ready && engineLaunch?.status !== "running");
  const status = profileImportStatusLabel(importState);
  const message = importState.message || engineLaunch?.message || bridgeMessage;
  const launchSettingsDisabled = !bridgeAvailable || settingsBusy || engineLaunch?.status === "running";
  return (
    <div className="importer-workspace" aria-label="Client importer">
      <section className="importer-hero">
        <div className="importer-identity">
          <img className="hotel-avatar importer-avatar" src="./img/avatar.png" alt="" aria-hidden="true" />
          <div>
            <strong>Client Importer</strong>
            <span>{profiles.length > 0 ? profileLine(selectedProfile) : "No playable profile attached"}</span>
          </div>
        </div>
        <div className="importer-actions">
          <button type="button" onClick={onRefresh} disabled={!bridgeAvailable || engineBusy} title="Refresh client library">
            <RefreshCw size={14} /><span>Refresh</span>
          </button>
          <button type="button" className="primary" onClick={onImport} disabled={!bridgeAvailable || engineBusy} title="Import or build client">
            <FolderInput size={14} /><span>{importState.running ? "Importing" : "Import/Build Client"}</span>
          </button>
          {profileReady ? (
            <button type="button" className="primary" onClick={onStart} disabled={!bridgeAvailable || engineBusy} title="Start embedded client">
              <Play size={14} /><span>Start</span>
            </button>
          ) : null}
        </div>
      </section>
      <section className="importer-main">
        <div className="importer-progress-panel">
          <div className="importer-panel-heading"><span>{status}</span><strong>{latestPercent}%</strong></div>
          <div className="importer-current-step">
            <strong>{latest ? PROFILE_IMPORT_STAGE_LABELS[latest.stage] : "Ready"}</strong>
            <span>{latest?.message ?? message ?? "Select a compiled client folder to build a playable Shockless profile."}</span>
            {latest?.detail ? <small>{latest.detail}</small> : null}
          </div>
          <div className="importer-progress-meta">
            <span>{formatImportElapsed(elapsedMs)} elapsed</span>
            <span>{importState.sourceName || latest?.sourceName || "No folder selected"}</span>
            {latest?.current !== undefined && latest.total !== undefined ? (
              <span>{latest.current.toLocaleString()} / {latest.total.toLocaleString()}</span>
            ) : latest?.current !== undefined ? (
              <span>{latest.current.toLocaleString()} written</span>
            ) : null}
          </div>
          <div className="importer-progress-bar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={latestPercent}>
            <span style={{ width: `${latestPercent}%` }} />
          </div>
          {importState.running ? <p className="importer-note">Decompile and asset preparation can use CPU and disk while generated files are written.</p> : null}
          <ol className="importer-stage-list">
            {PROFILE_IMPORT_STAGES.map((stage) => {
              const entry = profileImportStageEntry(importState.entries, stage);
              const stateClass = entry?.state ?? "pending";
              return (
                <li className={stateClass} key={stage}>
                  <strong>{PROFILE_IMPORT_STAGE_LABELS[stage]}</strong>
                  <span>{entry?.message ?? "Waiting"}</span>
                  {entry?.detail ? <small>{entry.detail}</small> : null}
                </li>
              );
            })}
          </ol>
        </div>
        <div className="importer-detail-panel">
          <div className="importer-panel-heading"><span>Details</span><strong>{profiles.length} profile{profiles.length === 1 ? "" : "s"}</strong></div>
          <div className="importer-detail-grid">
            <span>Selected</span><strong>{profileLine(selectedProfile)}</strong>
            <span>Engine</span><strong>{statusLabel(engineLaunch?.status)}</strong>
            <span>Stage</span><strong>{engineLaunch?.settings?.resizablePresentation ? "Responsive" : "Fixed Stage"}</strong>
            <span>Hotel View</span><strong>{engineLaunch?.settings?.customHotelView ? "Custom" : "Default"}</strong>
            <span>Version</span><strong>{compactValue(engineLaunch?.settings?.versionCheckBuild ?? selectedProfile?.versionCheckBuild ?? null)}</strong>
            <span>Log</span><strong>{compactValue(latest?.logPath ? latest.logPath.split(/[\\/]/).pop() : null)}</strong>
          </div>
          <div className="importer-launch-settings" aria-label="Launch settings">
            <label className="toggle-row checkbox-first-row">
              <input type="checkbox" checked={engineLaunch?.settings?.customHotelView === true} disabled={launchSettingsDisabled} onChange={(event) => onSetCustomHotelView(event.currentTarget.checked)} />
              <span>Custom hotel view</span>
            </label>
            <label className="toggle-row checkbox-first-row">
              <input type="checkbox" checked={engineLaunch?.settings?.resizablePresentation !== false} disabled={launchSettingsDisabled} onChange={(event) => onSetResizablePresentation(event.currentTarget.checked)} />
              <span>Responsive stage resize</span>
            </label>
            <form className="runtime-input-row importer-version-row" onSubmit={(event) => { event.preventDefault(); onSetVersionCheckBuild(); }}>
              <input value={versionCheckDraft} onChange={(event) => onVersionCheckDraftChange(event.currentTarget.value)} placeholder={selectedProfile?.versionCheckBuild ? String(selectedProfile.versionCheckBuild) : "auto"} disabled={!bridgeAvailable || engineBusy || !selectedProfile} aria-label="Version check build override" />
              <button type="submit" disabled={!bridgeAvailable || engineBusy || !selectedProfile}>Apply</button>
            </form>
          </div>
          <div className="importer-log-lines" aria-label="Importer detail log">
            {importState.events.length > 0 ? (
              importState.events.slice(-12).map((entry, index) => (
                <code className={entry.state} key={`${entry.jobId}-${entry.stage}-${entry.updatedAt}-${index}`}>
                  [{statusLabel(entry.state)}] {PROFILE_IMPORT_STAGE_LABELS[entry.stage]}: {entry.message}
                  {entry.detail ? ` (${entry.detail})` : ""}
                </code>
              ))
            ) : (
              <p>{message || "Importer idle."}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
