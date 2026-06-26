import { RefreshCw } from "lucide-react";
import { runtimeFps, runtimeTickRate } from "../../engine-adapter/shocklessSessionAdapter";
import type { EngineRuntimeSnapshot } from "../../renderer/engineRuntime";

interface DevToolsPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly runtimeSnapshot: EngineRuntimeSnapshot | null;
  readonly onRefresh: () => void;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

function fnum(value: unknown): string {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? String(parsed) : "-";
}

export function DevToolsPanel({ engineUrl, runtimeBusy, runtimeSnapshot, onRefresh }: DevToolsPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="runtime-actions">
        <button
          className="wide-action"
          type="button"
          onClick={() => void onRefresh()}
          disabled={!engineUrl || runtimeBusy}
        >
          <RefreshCw size={14} />
          <span>Refresh Diagnostics</span>
        </button>
      </div>
      <div className="kv-grid">
        <span>Frame</span>
        <strong>{compact(runtimeSnapshot?.frame)}</strong>
        <span>Casts Loaded</span>
        <strong>{runtimeSnapshot ? `${runtimeSnapshot.loadedCastCount}${runtimeSnapshot.castLoaded ? " / complete" : ""}` : "-"}</strong>
        <span>FPS</span>
        <strong>{compact(runtimeFps(runtimeSnapshot))}</strong>
        <span>Tick Rate</span>
        <strong>{compact(runtimeTickRate(runtimeSnapshot))}</strong>
        <span>Worst RAF</span>
        <strong>{fnum(runtimeSnapshot?.performanceStats?.worstRafDeltaMs)}</strong>
        <span>Timeouts</span>
        <strong>{compact(runtimeSnapshot?.performanceStats?.activeTimeoutCount)}</strong>
        <span>Errors</span>
        <strong>{compact(runtimeSnapshot?.errors)}</strong>
        <span>Objects</span>
        <strong>{compact(runtimeSnapshot?.objectCount)}</strong>
        <span>Windows</span>
        <strong>{compact(runtimeSnapshot?.windowIds.length)}</strong>
        <span>Fields</span>
        <strong>{compact(runtimeSnapshot?.editableFields.length)}</strong>
      </div>
      <div className="mini-section">
        <h3>Script Bundle</h3>
        <p>
          {runtimeSnapshot?.scriptBundle
            ? `${runtimeSnapshot.scriptBundle.runtimeVersion ?? "-"} -> ${runtimeSnapshot.scriptBundle.executableVersion ?? "-"}`
            : "-"}
        </p>
      </div>
      <div className="mini-section">
        <h3>Runtime Windows</h3>
        <div className="chip-list">
          {(runtimeSnapshot?.windowIds ?? []).length > 0 ? (
            runtimeSnapshot?.windowIds.map((id) => <span key={id}>{id}</span>)
          ) : (
            <span>none</span>
          )}
        </div>
      </div>
      <div className="mini-section">
        <h3>Editable Fields</h3>
        <div className="mini-table">
          {(runtimeSnapshot?.editableFields ?? []).slice(0, 6).map((field) => (
            <p key={field.n}>
              <span>#{field.n}</span>
              <strong>{field.member}</strong>
            </p>
          ))}
          {(runtimeSnapshot?.editableFields.length ?? 0) === 0 ? <p>No editable fields visible.</p> : null}
        </div>
      </div>
    </div>
  );
}
