import type { RuntimeChatEntry } from "../../renderer/engineRuntime";

interface ChatFilterState {
  readonly talk: boolean;
  readonly whisper: boolean;
  readonly shout: boolean;
  readonly system: boolean;
  readonly autoscroll: boolean;
}

interface ChatPanelProps {
  readonly engineUrl: string | null;
  readonly runtimeBusy: boolean;
  readonly roomReady: boolean | null;
  readonly chatDraft: string;
  readonly chatFilters: ChatFilterState;
  readonly visibleChatHistory: readonly RuntimeChatEntry[];
  readonly chatHistoryLength: number;
  readonly activeChatSourceHistoryLength: number;
  readonly packetChatEntriesLength: number;
  readonly displayedCount: number;
  readonly runtimeMessage: string;
  readonly chatListRef: { readonly current: HTMLDivElement | null };
  readonly onSetChatDraft: (value: string) => void;
  readonly onSetChatFilter: (kind: string, checked: boolean) => void;
  readonly onSend: (message: string) => void;
  readonly onClearDisplay: () => void;
}

function labelCase(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text.split(/[-_\s.]+/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function chatEntryKey(entry: RuntimeChatEntry, index: number): string {
  return `${entry.index ?? index}-${entry.timestamp ?? ""}-${entry.userName ?? ""}`;
}

function chatEntryLabel(entry: RuntimeChatEntry): string {
  const mode = String(entry.chatMode ?? "talk").toUpperCase();
  const user = entry.userName || "system";
  return `[${mode}] ${user}`;
}

function compact(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "-";
}

const CHAT_KINDS = ["talk", "whisper", "shout", "system"] as const;

export function ChatPanel({
  engineUrl,
  runtimeBusy,
  roomReady,
  chatDraft,
  chatFilters,
  visibleChatHistory,
  chatHistoryLength,
  activeChatSourceHistoryLength,
  packetChatEntriesLength,
  displayedCount,
  runtimeMessage,
  chatListRef,
  onSetChatDraft,
  onSetChatFilter,
  onSend,
  onClearDisplay,
}: ChatPanelProps) {
  return (
    <div className="runtime-panel">
      <div className="chat-filter-row" aria-label="Chat filters">
        {CHAT_KINDS.map((kind) => (
          <label key={kind}>
            <input type="checkbox" checked={chatFilters[kind]} onChange={(event) => onSetChatFilter(kind, event.currentTarget.checked)} />
            <span>{labelCase(kind)}</span>
          </label>
        ))}
        <label>
          <input type="checkbox" checked={chatFilters.autoscroll} onChange={(event) => onSetChatFilter("autoscroll", event.currentTarget.checked)} />
          <span>auto</span>
        </label>
      </div>
      <form className="runtime-input-row chat-send-row" onSubmit={(event) => { event.preventDefault(); const msg = chatDraft.trim(); if (msg) { onSetChatDraft(""); onSend(msg); } }}>
        <input value={chatDraft} onChange={(event) => onSetChatDraft(event.currentTarget.value)} placeholder={roomReady ? "Send room chat" : "Chat available in room"} aria-label="Room chat message" disabled={!roomReady} />
        <button type="submit" disabled={!engineUrl || runtimeBusy || !roomReady || !chatDraft.trim()}>Send</button>
      </form>
      <div className="chat-list" aria-label="Room chat history" ref={chatListRef}>
        {visibleChatHistory.length > 0 ? (
          visibleChatHistory.map((entry, index) => (
            <div className="chat-entry" key={chatEntryKey(entry, index)}>
              <span>{entry.timestamp || "-"}</span>
              <strong>{chatEntryLabel(entry)}</strong>
              <p>{entry.text || ""}</p>
            </div>
          ))
        ) : (
          <p className="empty-panel-note">No chat history is available yet.</p>
        )}
      </div>
      <button className="wide-action chat-clear-action" type="button" onClick={onClearDisplay}>Clear Display</button>
      <div className="kv-grid chat-stats-grid">
        <span>Room Ready</span><strong>{compact(roomReady)}</strong>
        <span>Room Messages</span><strong>{compact(activeChatSourceHistoryLength)}</strong>
        <span>Packet Rows</span><strong>{compact(packetChatEntriesLength)}</strong>
        <span>Displayed</span><strong>{compact(displayedCount)}</strong>
      </div>
      {runtimeMessage ? <p className="runtime-message">{runtimeMessage}</p> : null}
    </div>
  );
}
