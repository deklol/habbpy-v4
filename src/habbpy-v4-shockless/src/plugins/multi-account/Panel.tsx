import { Trash2 } from "lucide-react";
import type { ClientSessionList, ClientSessionSummary, MimicCategory, MimicStateSnapshot } from "../../shared/window-api";

// ── Local helpers (extracted from App.tsx to keep components self-contained) ──

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

function compactValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === "object") return "-";
  return String(value);
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

function clientSessionTitle(session: ClientSessionSummary): string {
  const mode = session.headless ? "Headless" : session.visible ? "Visible" : "Hidden";
  const markers = [session.selected ? "Selected" : "", session.main ? "Main" : "", mode, statusLabel(session.status)].filter(Boolean).join(", ");
  return `client${session.id} ${session.label} (${markers})\n${session.profileLabel}`;
}

const mimicCategoryOptions: readonly { readonly id: MimicCategory; readonly label: string; readonly detail: string }[] = [
  { id: "movement", label: "Movement", detail: "walk and look packets" },
  { id: "speech", label: "Speech", detail: "chat, shout, whisper, typing" },
  { id: "actions", label: "Actions", detail: "wave, dance, carry, sign" },
  { id: "rooms", label: "Rooms", detail: "private room joins" },
];

// ── Props ──

export interface MultiAccountPanelProps {
  readonly desktopBridgeAvailable: boolean;
  readonly selectedClientId: number;
  readonly selectedClientSession: ClientSessionSummary | null;
  readonly clientSessions: ClientSessionList | null;
  readonly mainClientSession: ClientSessionSummary | null;
  readonly multiAccountFile: string;
  readonly multiAccountCount: string;
  readonly multiAccountConcurrency: string;
  readonly multiAccountKeyEnv: string;
  readonly multiAccountSummonTarget: string;
  readonly mimicState: MimicStateSnapshot | null;
  readonly mimicSourceSession: ClientSessionSummary | null;
  readonly mimicTargetSessions: readonly ClientSessionSummary[];
  readonly mainMimicSourceId: number;
  readonly multiAccountMessage: string;
  readonly onSelectClientSession: (id: number) => void;
  readonly onRunMultiAccountCommand: (cmd: string) => void;
  readonly onRefreshClientSessions: () => Promise<unknown>;
  readonly onRefreshMimicState: () => void;
  readonly onSetMultiAccountFile: (v: string) => void;
  readonly onSetMultiAccountCount: (v: string) => void;
  readonly onSetMultiAccountConcurrency: (v: string) => void;
  readonly onSetMultiAccountKeyEnv: (v: string) => void;
  readonly onSetMultiAccountSummonTarget: (v: string) => void;
}

// ── Component ──

export function MultiAccountPanel(props: MultiAccountPanelProps): React.JSX.Element {
  const {
    desktopBridgeAvailable,
    selectedClientId,
    selectedClientSession,
    clientSessions,
    mainClientSession,
    multiAccountFile,
    multiAccountCount,
    multiAccountConcurrency,
    multiAccountKeyEnv,
    multiAccountSummonTarget,
    mimicState,
    mimicSourceSession,
    mimicTargetSessions,
    mainMimicSourceId,
    multiAccountMessage,
    onSelectClientSession,
    onRunMultiAccountCommand,
    onRefreshClientSessions,
    onRefreshMimicState,
    onSetMultiAccountFile,
    onSetMultiAccountCount,
    onSetMultiAccountConcurrency,
    onSetMultiAccountKeyEnv,
    onSetMultiAccountSummonTarget,
  } = props;

  const selectClientSession = onSelectClientSession;
  const runMultiAccountCommand = onRunMultiAccountCommand;
  const refreshClientSessions = onRefreshClientSessions;
  const refreshMimicState = onRefreshMimicState;
  const setMultiAccountFile = onSetMultiAccountFile;
  const setMultiAccountCount = onSetMultiAccountCount;
  const setMultiAccountConcurrency = onSetMultiAccountConcurrency;
  const setMultiAccountKeyEnv = onSetMultiAccountKeyEnv;
  const setMultiAccountSummonTarget = onSetMultiAccountSummonTarget;

  return (
    <div className="runtime-panel multi-account-panel">
      <div className="mini-section">
        <h3>Sessions</h3>
        <div className="kv-grid">
          <span>Selected</span>
          <strong>client{selectedClientId} / {compactValue(selectedClientSession?.label)}</strong>
          <span>Main</span>
          <strong>{mainClientSession ? `client${mainClientSession.id} / ${mainClientSession.label}` : `client${clientSessions?.mainClientId ?? 1}`}</strong>
          <span>Running</span>
          <strong>{compactValue((clientSessions?.sessions ?? []).filter((session) => session.status === "running").length)}</strong>
          <span>Headless</span>
          <strong>{compactValue((clientSessions?.sessions ?? []).filter((session) => session.headless).length)}</strong>
        </div>
        <div className="multi-session-list" aria-label="Multi account sessions">
          {(clientSessions?.sessions ?? []).map((session) => (
            <div
              key={session.id}
              className={`multi-session-row ${session.selected ? "active" : ""} ${session.main ? "main" : ""}`}
            >
              <button
                className="multi-session-select"
                type="button"
                onClick={() => void selectClientSession(session.id)}
                title={clientSessionTitle(session)}
              >
                <span>client{session.id}</span>
                <strong>{session.label}</strong>
                <small>{session.username || "-"} / {session.roomName || "-"}</small>
                <em>{session.headless ? "headless" : "visible"} {session.main ? "/ main" : ""}</em>
              </button>
              <button
                className="multi-session-close"
                type="button"
                disabled={!desktopBridgeAvailable || session.id === 1}
                onClick={() => void runMultiAccountCommand(`close ${session.id}`)}
                title={session.id === 1 ? "Use Stop for client1" : `Close client${session.id}`}
                aria-label={`Close client ${session.id}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="runtime-actions multi-account-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void refreshClientSessions().then(() => refreshMimicState())}
          >
            Refresh
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand("newclient")}
          >
            New Visible
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand(`main ${selectedClientId}`)}
          >
            Set Main
          </button>
        </div>
      </div>

      <div className="mini-section">
        <h3>Load Accounts</h3>
        <label className="field-stack">
          <span>Account File</span>
          <input value={multiAccountFile} onChange={(event) => setMultiAccountFile(event.currentTarget.value)} />
        </label>
        <div className="inline-field-grid">
          <label className="field-stack">
            <span>Count</span>
            <input value={multiAccountCount} onChange={(event) => setMultiAccountCount(event.currentTarget.value.replace(/[^\d]/g, ""))} />
          </label>
          <label className="field-stack">
            <span>Concurrency</span>
            <input value={multiAccountConcurrency} onChange={(event) => setMultiAccountConcurrency(event.currentTarget.value.replace(/[^\d]/g, ""))} />
          </label>
        </div>
        <label className="field-stack">
          <span>Key Env</span>
          <input value={multiAccountKeyEnv} onChange={(event) => setMultiAccountKeyEnv(event.currentTarget.value)} />
        </label>
        <div className="runtime-actions multi-account-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
            onClick={() =>
              void runMultiAccountCommand(
                `load ${commandArg(multiAccountFile.trim())} ${clampMultiAccountCount(multiAccountCount)} --headless --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
              )
            }
          >
            Load Headless
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountFile.trim()}
            onClick={() =>
              void runMultiAccountCommand(
                `load ${commandArg(multiAccountFile.trim())} ${clampMultiAccountCount(multiAccountCount)} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
              )
            }
          >
            Load Visible
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountFile.trim() || !multiAccountKeyEnv.trim()}
            onClick={() =>
              void runMultiAccountCommand(
                `accounts import ${commandArg(multiAccountFile.trim())} --key-env ${multiAccountKeyEnv.trim()}`,
              )
            }
          >
            Import Store
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountKeyEnv.trim()}
            onClick={() =>
              void runMultiAccountCommand(
                `accounts load ${clampMultiAccountCount(multiAccountCount)} --headless --key-env ${multiAccountKeyEnv.trim()} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
              )
            }
          >
            Store Headless
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountKeyEnv.trim()}
            onClick={() =>
              void runMultiAccountCommand(
                `accounts load ${clampMultiAccountCount(multiAccountCount)} --key-env ${multiAccountKeyEnv.trim()} --concurrency ${clampMultiAccountConcurrency(multiAccountConcurrency)}`,
              )
            }
          >
            Store Visible
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand("list")}
          >
            List
          </button>
        </div>
      </div>

      <div className="mini-section">
        <h3>Summon</h3>
        <label className="field-stack">
          <span>Target</span>
          <input value={multiAccountSummonTarget} onChange={(event) => setMultiAccountSummonTarget(event.currentTarget.value)} />
        </label>
        <div className="runtime-actions multi-account-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountSummonTarget.trim()}
            onClick={() => void runMultiAccountCommand(`summon ${commandArg(multiAccountSummonTarget.trim())}`)}
          >
            Summon
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable || !multiAccountSummonTarget.trim()}
            onClick={() => void runMultiAccountCommand(`summon ${commandArg(multiAccountSummonTarget.trim())} --room`)}
          >
            Enter Room
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand("summon headless")}
          >
            Summon Headless
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand("summon all")}
          >
            Summon All
          </button>
        </div>
      </div>

      <div className="mini-section">
        <h3>Mimic</h3>
        <div className="kv-grid">
          <span>State</span>
          <strong>{mimicState?.enabled ? "On" : "Off"}</strong>
          <span>Mimic From</span>
          <strong>{mimicSourceSession ? `client${mimicSourceSession.id} / ${mimicSourceSession.label}` : `client${mimicState?.sourceClientId ?? 1}`}</strong>
          <span>Targets</span>
          <strong>{mimicTargetSessions.length > 0 ? mimicTargetSessions.map((session) => `client${session.id}`).join(", ") : "-"}</strong>
          <span>Forwarded</span>
          <strong>{compactValue(mimicState?.forwardedCount)}</strong>
        </div>
        <div className="runtime-actions multi-account-actions">
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand(`mimic on --source ${mainMimicSourceId}`)}
          >
            Enable From Main
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand("mimic off")}
          >
            Disable
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand(`mimic source ${selectedClientId}`)}
          >
            Use Selected
          </button>
          <button
            className="wide-action"
            type="button"
            disabled={!desktopBridgeAvailable}
            onClick={() => void runMultiAccountCommand("mimic status")}
          >
            Status
          </button>
        </div>
        {mimicCategoryOptions.map((option) => {
          const checked = mimicState?.categories[option.id] !== false;
          return (
            <label className="toggle-row checkbox-first-row" key={option.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!desktopBridgeAvailable}
                onChange={(event) => void runMultiAccountCommand(`mimic set ${option.id} ${event.currentTarget.checked ? "on" : "off"}`)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          );
        })}
        {mimicState?.lastError ? <p className="runtime-message">{mimicState.lastError}</p> : null}
      </div>

      {multiAccountMessage ? <pre className="multi-account-output">{multiAccountMessage}</pre> : null}
    </div>
  );
}
