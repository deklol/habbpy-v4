import type { EngineRuntimeSnapshot } from "../../renderer/engineRuntime";
import type {
  InjectionCommandDraft,
  InjectionSnippet,
  InjectionHistoryEntry,
  InjectionActionKind,
} from "../../renderer/ui/App";

interface InjectionPanelProps {
  readonly runtimeBusy: boolean;
  readonly roomReady: boolean | null;
  readonly selectedRuntimeSnapshot: EngineRuntimeSnapshot | null;
  readonly injectionDraft: InjectionCommandDraft;
  readonly injectionRepeatCount: string;
  readonly injectionRepeatInterval: string;
  readonly injectionMessage: string;
  readonly injectionSnippets: readonly InjectionSnippet[];
  readonly selectedInjectionSnippetId: string;
  readonly selectedInjectionSnippet: InjectionSnippet | null;
  readonly injectionHistory: readonly InjectionHistoryEntry[];
  readonly injectionFileInputRef: { readonly current: HTMLInputElement | null };
  readonly injectionActionOptions: readonly { readonly kind: InjectionActionKind; readonly label: string }[];
  readonly onUpdateInjectionDraft: <K extends keyof InjectionCommandDraft>(key: K, value: InjectionCommandDraft[K]) => void;
  readonly onSetInjectionRepeatCount: (v: string) => void;
  readonly onSetInjectionRepeatInterval: (v: string) => void;
  readonly onExecuteInjectionCommand: (command: InjectionCommandDraft, label?: string) => void;
  readonly onAddInjectionSnippet: () => void;
  readonly onImportInjectionSnippets: (file: File) => void;
  readonly onExportInjectionSnippets: () => void;
  readonly onSetInjectionSnippets: (value: readonly InjectionSnippet[] | ((current: readonly InjectionSnippet[]) => readonly InjectionSnippet[])) => void;
  readonly onSetSelectedInjectionSnippetId: (id: string) => void;
  readonly onSetInjectionMessage: (msg: string) => void;
  readonly onLoadInjectionSnippet: (snippet: InjectionSnippet) => void;
  readonly onSetInjectionHistory: (value: readonly InjectionHistoryEntry[] | ((current: readonly InjectionHistoryEntry[]) => readonly InjectionHistoryEntry[])) => void;
}

function compact(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === "object") return "-";
  return String(value);
}

function clampRepeatCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(25, parsed));
}

export function InjectionPanel({
  runtimeBusy,
  roomReady,
  selectedRuntimeSnapshot,
  injectionDraft,
  injectionRepeatCount,
  injectionRepeatInterval,
  injectionMessage,
  injectionSnippets,
  selectedInjectionSnippetId,
  selectedInjectionSnippet,
  injectionHistory,
  injectionFileInputRef,
  injectionActionOptions,
  onUpdateInjectionDraft: updateInjectionDraft,
  onSetInjectionRepeatCount: setInjectionRepeatCount,
  onSetInjectionRepeatInterval: setInjectionRepeatInterval,
  onExecuteInjectionCommand: executeInjectionCommand,
  onAddInjectionSnippet: addInjectionSnippet,
  onImportInjectionSnippets: importInjectionSnippets,
  onExportInjectionSnippets: exportInjectionSnippets,
  onSetInjectionSnippets: setInjectionSnippets,
  onSetSelectedInjectionSnippetId: setSelectedInjectionSnippetId,
  onSetInjectionMessage: setInjectionMessage,
  onLoadInjectionSnippet: loadInjectionSnippet,
  onSetInjectionHistory: setInjectionHistory,
}: InjectionPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="mini-section injection-editor">
        <h3>Command Editor</h3>
        <label className="field-stack">
          <span>Action</span>
          <select value={injectionDraft.actionKind} onChange={(event) => updateInjectionDraft("actionKind", event.currentTarget.value as InjectionActionKind)}>
            {injectionActionOptions.map((option) => (
              <option key={option.kind} value={option.kind}>{option.label}</option>
            ))}
          </select>
        </label>

        {injectionDraft.actionKind === "sendChat" ? (
          <label className="field-stack">
            <span>Chat Text</span>
            <textarea value={injectionDraft.chatMessage} onChange={(event) => updateInjectionDraft("chatMessage", event.currentTarget.value)} rows={3} placeholder="Message sent through the live room chat field" />
          </label>
        ) : null}

        {injectionDraft.actionKind === "stageClick" ? (
          <div className="inline-field-grid">
            <label className="field-stack"><span>Stage X</span><input value={injectionDraft.stageX} onChange={(event) => updateInjectionDraft("stageX", event.currentTarget.value)} /></label>
            <label className="field-stack"><span>Stage Y</span><input value={injectionDraft.stageY} onChange={(event) => updateInjectionDraft("stageY", event.currentTarget.value)} /></label>
          </div>
        ) : null}

        {injectionDraft.actionKind === "clickWindowElement" ? (
          <div className="inline-field-grid">
            <label className="field-stack"><span>Window Id</span><input value={injectionDraft.windowId} onChange={(event) => updateInjectionDraft("windowId", event.currentTarget.value)} placeholder="Room_bar" /></label>
            <label className="field-stack"><span>Element Id</span><input value={injectionDraft.elementId} onChange={(event) => updateInjectionDraft("elementId", event.currentTarget.value)} placeholder="int_hand_image" /></label>
          </div>
        ) : null}

        {injectionDraft.actionKind === "openNavigator" ? (
          <label className="field-stack">
            <span>Navigator View</span>
            <select value={injectionDraft.navigatorView} onChange={(event) => updateInjectionDraft("navigatorView", event.currentTarget.value)}>
              <option value="nav_pr">Public spaces</option>
              <option value="nav_gr0">Guest rooms</option>
            </select>
          </label>
        ) : null}

        {injectionDraft.actionKind === "enterPrivateRoom" ? (
          <label className="field-stack"><span>Flat Id</span><input value={injectionDraft.flatId} onChange={(event) => updateInjectionDraft("flatId", event.currentTarget.value)} placeholder="empty uses current private room id" /></label>
        ) : null}

        {injectionDraft.actionKind === "enterPublicRoom" ? (
          <label className="field-stack"><span>Public Room</span><input value={injectionDraft.publicRoomQuery} onChange={(event) => updateInjectionDraft("publicRoomQuery", event.currentTarget.value)} placeholder="empty uses first cached public room" /></label>
        ) : null}

        {injectionDraft.actionKind === "rawPacketBlocked" ? (
          <>
            <label className="field-stack"><span>Packet Text</span><textarea value={injectionDraft.rawText} onChange={(event) => updateInjectionDraft("rawText", event.currentTarget.value)} rows={3} placeholder="{h:94} or :WAVE" /></label>
          </>
        ) : null}

        <div className="inline-field-grid repeat-grid">
          <label className="field-stack"><span>Repeat</span><input value={injectionRepeatCount} onChange={(event) => setInjectionRepeatCount(event.currentTarget.value)} /></label>
          <label className="field-stack"><span>Interval ms</span><input value={injectionRepeatInterval} onChange={(event) => setInjectionRepeatInterval(event.currentTarget.value)} /></label>
        </div>
        <div className="runtime-actions injection-actions">
          <button className="wide-action" type="button" disabled={runtimeBusy} onClick={() => void executeInjectionCommand(injectionDraft)}>Run</button>
          <button className="wide-action" type="button" onClick={addInjectionSnippet}>Add To Saved</button>
        </div>
        <div className="kv-grid">
          <span>Room Ready</span>
          <strong>{compact(roomReady)}</strong>
          <span>Windows</span>
          <strong>{compact(selectedRuntimeSnapshot?.windowIds.length)}</strong>
          <span>Fields</span>
          <strong>{compact(selectedRuntimeSnapshot?.editableFields.length)}</strong>
          <span>Repeat Cap</span>
          <strong>{compact(clampRepeatCount(injectionRepeatCount))}</strong>
        </div>
        {injectionMessage ? <p className="runtime-message">{injectionMessage}</p> : null}
      </div>
      <div className="mini-section">
        <h3>Saved Snippets</h3>
        <input ref={injectionFileInputRef} type="file" accept="application/json,.json" className="hidden-file-input" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importInjectionSnippets(file); event.currentTarget.value = ""; }} />
        <div className="runtime-actions injection-actions">
          <button className="wide-action" type="button" onClick={() => injectionFileInputRef.current?.click()}>Load File</button>
          <button className="wide-action" type="button" onClick={exportInjectionSnippets}>Save File</button>
          <button className="wide-action" type="button" onClick={() => { setInjectionSnippets([]); setSelectedInjectionSnippetId(""); setInjectionMessage("Saved snippets cleared."); }}>Clear</button>
        </div>
        <div className="injection-list" aria-label="Saved injection snippets">
          {injectionSnippets.length > 0 ? (
            injectionSnippets.map((snippet) => (
              <button className={`injection-row ${snippet.id === selectedInjectionSnippetId ? "active" : ""}`} key={snippet.id} type="button" onClick={() => loadInjectionSnippet(snippet)}>
                <strong>{snippet.label}</strong>
              </button>
            ))
          ) : (
            <p className="empty-panel-note">No saved snippets yet.</p>
          )}
        </div>
        <div className="runtime-actions injection-actions">
          <button className="wide-action" type="button" disabled={!selectedInjectionSnippet || runtimeBusy} onClick={() => { if (selectedInjectionSnippet) void executeInjectionCommand(selectedInjectionSnippet.command, selectedInjectionSnippet.label); }}>Send Selected</button>
          <button className="wide-action" type="button" disabled={!selectedInjectionSnippet} onClick={() => { if (!selectedInjectionSnippet) return; setInjectionSnippets((current) => current.filter((snippet) => snippet.id !== selectedInjectionSnippet.id)); setSelectedInjectionSnippetId(""); setInjectionMessage("Snippet removed."); }}>Remove</button>
        </div>
      </div>
      <div className="mini-section">
        <h3>Recent Injections</h3>
        <div className="injection-history-list">
          {injectionHistory.length > 0 ? (
            injectionHistory.slice(0, 12).map((entry) => (
              <div className={`injection-history-row ${entry.status}`} key={entry.id}>
                <span>{entry.time}</span>
                <strong>{entry.label}</strong>
                <p>{entry.message}</p>
              </div>
            ))
          ) : (
            <p className="empty-panel-note">No commands have run yet.</p>
          )}
        </div>
        <button className="wide-action" type="button" onClick={() => { setInjectionHistory([]); setInjectionMessage("Recent injection history cleared."); }}>Clear History</button>
      </div>
    </div>
  );
}
