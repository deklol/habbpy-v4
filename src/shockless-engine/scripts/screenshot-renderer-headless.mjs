import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const rendererDir = path.resolve(process.env.HABBPY_V4_RENDERER_DIR || path.join(repoRoot, "dist", "renderer"));
const outRoot = path.resolve(process.env.HABBPY_V4_SCREENSHOT_DIR || path.join(repoRoot, "screenshots", "headless-renderer"));
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(outRoot, `renderer-${runStamp}`);
const viewport = {
  width: readPositiveInt(process.env.HABBPY_V4_SCREENSHOT_VIEWPORT_WIDTH, 1365),
  height: readPositiveInt(process.env.HABBPY_V4_SCREENSHOT_VIEWPORT_HEIGHT, 768),
};
const defaultPlugins = [
  "Connection",
  "Multi Account",
  "Info",
  "Room",
  "User",
  "Social",
  "Chat",
  "Visitors",
  "Items",
  "Inventory",
  "Automation",
  "Wall Mover",
  "Packet Log",
  "Injection",
  "Dev Tools",
  "Sample Plugin",
];
const pluginsToCapture = (process.env.HABBPY_V4_SCREENSHOT_PLUGINS || defaultPlugins.join(","))
  .split(",")
  .map((plugin) => plugin.trim())
  .filter(Boolean);
const scrollPlugins = new Set(
  (process.env.HABBPY_V4_SCREENSHOT_SCROLL_PLUGINS || "")
    .split(",")
    .map((plugin) => plugin.trim())
    .filter(Boolean),
);
const consoleCommands = parseConsoleCommands(process.env.HABBPY_V4_SCREENSHOT_CONSOLE_COMMANDS || "");
const captureCollapsedDock = parseBooleanFlag(process.env.HABBPY_V4_SCREENSHOT_COLLAPSED_DOCK);

const forbiddenVisibleCopy = [
  "Info sources",
  "Source Mapping",
  "source-missing",
  "Mapped Social Data",
  "Room_container",
  "Furnidata",
  "Cycle Rooms",
  "Room Sprites",
  "Entry State",
  "Room Markers",
  "not parsed",
  "none parsed",
  "No parsed",
  "USERS line",
  "Relay Profile",
];

await assertDirectory(rendererDir);
await mkdir(outDir, { recursive: true });

const server = await startStaticServer(rendererDir);
const url = `http://127.0.0.1:${server.port}/index.html`;
let browser;

const consoleMessages = [];
const pageErrors = [];
const screenshots = [];

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });

  await page.addInitScript((fixture) => {
    const clone = (value) => JSON.parse(JSON.stringify(value));
    let clientSessions = clone(fixture.clientSessions);
    let pluginRegistry = clone(fixture.pluginRegistry);
    let commandState = { aliases: {}, bindings: {}, history: [] };
    const redactCommand = (input) => String(input || "").replace(/(login\s+)(\S+:\S+)/i, "$1[credentials]");
    const commandStateSnapshot = () => ({
      aliases: Object.entries(commandState.aliases).sort(([a], [b]) => a.localeCompare(b)).map(([name, expansion]) => ({ name, expansion })),
      bindings: Object.entries(commandState.bindings).sort(([a], [b]) => a.localeCompare(b)).map(([key, command]) => ({ key, command })),
      history: commandState.history.slice(),
    });
    const normalizeBindingKey = (value) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      const parts = raw.split("+").map((part) => part.trim()).filter(Boolean);
      const key = parts.pop() || "";
      const modifiers = new Set(parts.map((part) => part.toLowerCase()));
      const ordered = [
        modifiers.has("ctrl") || modifiers.has("control") ? "Ctrl" : "",
        modifiers.has("alt") ? "Alt" : "",
        modifiers.has("shift") ? "Shift" : "",
        modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command") ? "Meta" : "",
      ].filter(Boolean);
      const normalizedKey = /^f(?:[1-9]|1\d|2[0-4])$/i.test(key) ? key.toUpperCase() : key.length === 1 ? key.toUpperCase() : key;
      return [...ordered, normalizedKey].join("+");
    };
    const fixtureUserPlugin = (id, name) => ({
      id,
      name,
      version: "1.0.0",
      author: "Fixture",
      category: "developer",
      icon: "terminal",
      enabledByDefault: false,
      status: "ready",
      summary: "Fixture user plugin created by the screenshot harness.",
      capabilities: ["Fixture manifest-backed user plugin panel"],
      uiSurfaces: [
        {
          id: "panel",
          kind: "panel",
          label: name,
          enabledByDefault: true,
          summary: "Fixture plugin panel.",
        },
      ],
      sourceMapping: {
        habbpyV3: ["User plugin"],
        shockless: ["plugin.js"],
        notes: "Fixture user plugin.",
      },
      origin: "user",
      core: false,
      entry: `mock://${id}/plugin.js`,
      pluginRoot: `mock://${id}`,
      permissions: ["ui.panel", "events.packet", "packet.read"],
      loadError: null,
    });
    const parseFixtureCommand = (input) => {
      const rawInput = String(input || "");
      const withoutSlash = rawInput.trim().replace(/^\//, "");
      const tokens = withoutSlash.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
      const targetToken = tokens[0]?.startsWith("@") ? tokens.shift().slice(1) : null;
      const target =
        targetToken === "all" ? { kind: "all", raw: targetToken } :
        targetToken === "main" ? { kind: "main", raw: targetToken } :
        targetToken === "visible" ? { kind: "visible", raw: targetToken } :
        targetToken === "headless" ? { kind: "headless", raw: targetToken } :
        targetToken && /^\d+$/.test(targetToken) ? { kind: "clientId", raw: targetToken, clientId: Number(targetToken) } :
        targetToken ? { kind: "label", raw: targetToken, label: targetToken } :
        { kind: "selected", raw: null };
      const command = String(tokens.shift() || "").toLowerCase();
      const args = [];
      const flags = [];
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.startsWith("--") && token.length > 2) {
          const body = token.slice(2);
          const [name, inlineValue] = body.split(/=(.*)/s);
          if (inlineValue !== undefined) {
            flags.push({ name: name.toLowerCase(), value: inlineValue });
          } else {
            flags.push({ name: body.toLowerCase(), value: true });
          }
        } else if (token) {
          args.push(token);
        }
      }
      return { rawInput, inputWithoutTarget: [command, ...tokens].join(" "), command, args, flags, target };
    };
    const selectFixtureClient = (clientId) => {
      const selected = clientSessions.sessions.some((session) => session.id === Number(clientId));
      clientSessions = {
        ...clientSessions,
        selectedClientId: selected ? Number(clientId) : clientSessions.selectedClientId,
        message: selected ? `Selected client${clientId}.` : `Client ${clientId} is not running yet.`,
        sessions: clientSessions.sessions.map((session) => ({ ...session, selected: selected ? Number(clientId) === session.id : session.selected })),
      };
      return selected;
    };
    const fixtureTargetIds = (command) => {
      if (command.target.kind === "all") return clientSessions.sessions.map((session) => session.id);
      if (command.target.kind === "visible") return clientSessions.sessions.filter((session) => session.visible).map((session) => session.id);
      if (command.target.kind === "headless") return clientSessions.sessions.filter((session) => session.headless).map((session) => session.id);
      if (command.target.kind === "main") return [clientSessions.mainClientId];
      if (command.target.kind === "selected") return [clientSessions.selectedClientId];
      if (command.target.kind === "clientId" && clientSessions.sessions.some((session) => session.id === command.target.clientId)) return [command.target.clientId];
      if (command.target.kind === "label") {
        const match = clientSessions.sessions.find((session) => session.label.toLowerCase() === String(command.target.label || "").toLowerCase());
        if (match) return [match.id];
      }
      return [];
    };
    window.habbpyV4 = {
      getAppInfo: async () => clone(fixture.appInfo),
      getAppPreferences: async () => clone(fixture.appPreferences),
      setAppPreferences: async (patch) => {
        for (const [key, value] of Object.entries(patch || {})) {
          if (value !== undefined && key in fixture.appPreferences) {
            fixture.appPreferences[key] = value;
          }
        }
        const hardwarePreference =
          typeof patch?.hardwareAcceleration === "boolean" ? patch.hardwareAcceleration : fixture.appPreferences.hardwareAcceleration;
        fixture.appPreferences = {
          ...fixture.appPreferences,
          hardwareAcceleration: hardwarePreference,
          hardwareAccelerationRestartRequired: hardwarePreference !== fixture.appPreferences.hardwareAccelerationActive,
        };
        return clone(fixture.appPreferences);
      },
      getUpdateState: async () => clone(fixture.updateState),
      checkForUpdates: async () => {
        fixture.updateState = {
          ...fixture.updateState,
          status: "up-to-date",
          lastCheckedAt: new Date().toISOString(),
          message: "Headless fixture is up to date.",
          error: null,
        };
        return clone(fixture.updateState);
      },
      downloadUpdate: async () => clone(fixture.updateState),
      installDownloadedUpdate: async () => clone(fixture.updateState),
      skipUpdate: async (version) => {
        fixture.updateState = { ...fixture.updateState, status: "skipped", skippedVersion: String(version || ""), message: `Skipped ${version || "update"}.` };
        return clone(fixture.updateState);
      },
      onUpdateState: () => () => undefined,
      getPluginRegistryState: async () => clone(pluginRegistry),
      setPluginEnabled: async (pluginId, enabled) => {
        const id = String(pluginId || "");
        if (pluginRegistry.pinnedPluginIds.includes(id) && !enabled) {
          return clone({ ...pluginRegistry, message: `${id} is pinned and cannot be disabled.` });
        }
        pluginRegistry = {
          ...pluginRegistry,
          enabledById: {
            ...pluginRegistry.enabledById,
            [id]: Boolean(enabled),
          },
          message: `${id || "Plugin"} ${enabled ? "enabled" : "disabled"}.`,
        };
        return clone(pluginRegistry);
      },
      setPluginSurfaceEnabled: async (pluginId, surfaceId, enabled) => {
        const id = String(pluginId || "");
        const surface = String(surfaceId || "");
        pluginRegistry = {
          ...pluginRegistry,
          uiSurfaceEnabledByPluginId: {
            ...pluginRegistry.uiSurfaceEnabledByPluginId,
            [id]: {
              ...(pluginRegistry.uiSurfaceEnabledByPluginId[id] || {}),
              [surface]: Boolean(enabled),
            },
          },
          message: `${id || "Plugin"} ${surface || "surface"} ${enabled ? "enabled" : "disabled"}.`,
        };
        return clone(pluginRegistry);
      },
      reloadPlugins: async () => {
        pluginRegistry = { ...pluginRegistry, message: "Plugins reloaded." };
        return clone(pluginRegistry);
      },
      openPluginsFolder: async () => ({ ok: true, message: "Plugins folder opened.", state: clone(pluginRegistry) }),
      createPluginFromTemplate: async (request) => {
        const id = String(request?.id || "fixture-created-plugin").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "fixture-created-plugin";
        const name = String(request?.name || id.split("-").map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" "));
        const plugin = fixtureUserPlugin(id, name);
        pluginRegistry = {
          ...pluginRegistry,
          plugins: [...pluginRegistry.plugins.filter((entry) => entry.id !== id), plugin],
          enabledById: { ...pluginRegistry.enabledById, [id]: true },
          uiSurfaceEnabledByPluginId: {
            ...pluginRegistry.uiSurfaceEnabledByPluginId,
            [id]: { panel: true },
          },
          message: `Created plugin '${name}'.`,
        };
        return { ok: true, message: `Created plugin '${name}' from template.`, state: clone(pluginRegistry) };
      },
      installPluginFromFolder: async () => {
        const plugin = fixtureUserPlugin("installed-fixture", "Installed Fixture");
        pluginRegistry = {
          ...pluginRegistry,
          plugins: [...pluginRegistry.plugins.filter((entry) => entry.id !== plugin.id), plugin],
          enabledById: { ...pluginRegistry.enabledById, [plugin.id]: true },
          uiSurfaceEnabledByPluginId: {
            ...pluginRegistry.uiSurfaceEnabledByPluginId,
            [plugin.id]: { panel: true },
          },
          message: "Installed plugin 'Installed Fixture'.",
        };
        return { ok: true, message: "Installed plugin 'Installed Fixture'.", state: clone(pluginRegistry) };
      },
      uninstallPlugin: async (pluginId) => {
        const id = String(pluginId || "");
        const plugin = pluginRegistry.plugins.find((entry) => entry.id === id);
        if (!plugin || plugin.origin !== "user") return { ok: false, message: "Only user plugins can be uninstalled.", state: clone(pluginRegistry) };
        const { [id]: _enabled, ...enabledById } = pluginRegistry.enabledById;
        const { [id]: _surfaces, ...uiSurfaceEnabledByPluginId } = pluginRegistry.uiSurfaceEnabledByPluginId;
        pluginRegistry = {
          ...pluginRegistry,
          plugins: pluginRegistry.plugins.filter((entry) => entry.id !== id),
          enabledById,
          uiSurfaceEnabledByPluginId,
          message: `Uninstalled plugin '${plugin.name}'.`,
        };
        return { ok: true, message: pluginRegistry.message, state: clone(pluginRegistry) };
      },
      readPluginEntrySource: async (pluginId) => ({
        ok: true,
        pluginId: String(pluginId || ""),
        source: "export function activate(api) { const { log } = api; log.info('Fixture plugin activated.'); return () => log.info('Fixture plugin deactivated.'); }",
        message: "Fixture plugin entry loaded.",
      }),
      getClientLibraryState: async () => clone(fixture.library),
      getClientSessions: async () => clone(clientSessions),
      getClientSnapshot: async (clientId) => {
        const id = Number(clientId || clientSessions.selectedClientId);
        const session = clientSessions.sessions.find((entry) => entry.id === id) || null;
        return clone({
          selectedClientId: clientSessions.selectedClientId,
          mainClientId: clientSessions.mainClientId,
          client: session,
          runtime: session
            ? {
                clientId: session.id,
                source: session.headless ? "hidden-runtime" : "none",
                updatedAt: fixture.relayLog.updatedAt,
                roomReady: true,
                roomId: "224520",
                roomName: session.roomName || "Codex Test LAB",
                roomType: "private",
                roomOwner: "dek",
                userName: session.username,
                userCount: 1,
                fps: 144,
                frame: 42,
                error: session.visible ? "Visible client runtime is owned by the renderer webview." : null,
              }
            : null,
          relay: session
            ? {
                clientId: session.id,
                logPath: fixture.relayLog.logPath,
                exists: true,
                updatedAt: fixture.relayLog.updatedAt,
                totalLines: fixture.relayLog.totalLines,
                packetCount: fixture.relayLog.packetCount,
                clientCount: fixture.relayLog.clientCount,
                serverCount: fixture.relayLog.serverCount,
                latestClientPacket: "PONG [196] line 4",
                latestServerPacket: "SLIDEOBJECTBUNDLE [230] line 3",
              }
            : null,
          message: session ? `client${session.id} snapshot ready.` : `Client ${id} is not running yet.`,
        });
      },
      getClientSnapshots: async () =>
        clone({
          selectedClientId: clientSessions.selectedClientId,
          mainClientId: clientSessions.mainClientId,
          clients: await Promise.all(clientSessions.sessions.map((session) => window.habbpyV4.getClientSnapshot(session.id))),
          message: `Collected ${clientSessions.sessions.length} client snapshot(s).`,
        }),
      selectClientSession: async (clientId) => {
        selectFixtureClient(clientId);
        return clone(clientSessions);
      },
      renameClientSession: async (clientId, label) => {
        clientSessions = {
          ...clientSessions,
          message: Number(clientId) === 1 ? `Renamed client1 to ${label}.` : `Client ${clientId} is not running yet.`,
          sessions: clientSessions.sessions.map((session) => Number(clientId) === session.id ? { ...session, label: String(label || "Main") } : session),
        };
        return clone(clientSessions);
      },
      runConsoleCommand: async (input) => {
        const redacted = redactCommand(input).trim();
        if (redacted && commandState.history.at(-1) !== redacted) {
          commandState.history = [...commandState.history, redacted].slice(-200);
        }
        const command = parseFixtureCommand(input);
        if (commandState.aliases[command.command]) {
          const target = command.target?.raw ? `@${command.target.raw} ` : "";
          const expanded = `${target}${commandState.aliases[command.command]} ${command.args.join(" ")}`.trim();
          const result = await window.habbpyV4.runConsoleCommand(expanded);
          return { ...result, lines: [`alias ${command.command} -> ${commandState.aliases[command.command]}`, ...result.lines] };
        }
        const targetClientIds = fixtureTargetIds(command);
        if (targetClientIds.length === 0 && command.command !== "load") {
          return { ok: false, handled: true, level: "warning", lines: [`Client target not running: ${command.target.raw || "-"}`], command, targetClientIds };
        }
        if (command.command === "alias") {
          const name = String(command.args[0] || "").toLowerCase();
          const expansion = command.args.slice(1).join(" ").trim();
          if (!name) {
            const lines = Object.entries(commandState.aliases).map(([aliasName, aliasExpansion]) => `${aliasName} = ${aliasExpansion}`);
            return { ok: true, handled: true, level: "info", lines: lines.length ? lines : ["No aliases configured."], command, targetClientIds };
          }
          if (!expansion) {
            return { ok: Boolean(commandState.aliases[name]), handled: true, level: commandState.aliases[name] ? "info" : "warning", lines: [commandState.aliases[name] ? `${name} = ${commandState.aliases[name]}` : `Alias not found: ${name}`], command, targetClientIds };
          }
          commandState = { ...commandState, aliases: { ...commandState.aliases, [name]: expansion } };
          return { ok: true, handled: true, level: "success", lines: [`alias ${name} = ${expansion}`], command, targetClientIds };
        }
        if (command.command === "unalias") {
          const name = String(command.args[0] || "").toLowerCase();
          const aliases = { ...commandState.aliases };
          delete aliases[name];
          commandState = { ...commandState, aliases };
          return { ok: true, handled: true, level: "success", lines: [`removed alias ${name}`], command, targetClientIds };
        }
        if (command.command === "bind") {
          const key = normalizeBindingKey(command.args[0]);
          const boundCommand = command.args.slice(1).join(" ").trim();
          if (!key || !boundCommand) return { ok: false, handled: true, level: "warning", lines: ["usage: bind <key> <command>"], command, targetClientIds };
          commandState = { ...commandState, bindings: { ...commandState.bindings, [key]: boundCommand } };
          return { ok: true, handled: true, level: "success", lines: [`bound ${key} -> ${boundCommand}`], command, targetClientIds };
        }
        if (command.command === "unbind") {
          const key = normalizeBindingKey(command.args[0]);
          const bindings = { ...commandState.bindings };
          delete bindings[key];
          commandState = { ...commandState, bindings };
          return { ok: true, handled: true, level: "success", lines: [`removed binding ${key}`], command, targetClientIds };
        }
        if (command.command === "bindings") {
          const lines = Object.entries(commandState.bindings).map(([key, boundCommand]) => `${key} -> ${boundCommand}`);
          return { ok: true, handled: true, level: "info", lines: lines.length ? lines : ["No bindings configured."], command, targetClientIds };
        }
        if (command.command === "history") {
          return { ok: true, handled: true, level: "info", lines: commandState.history.slice(-20).map((entry, index) => `${index + 1}: ${entry}`), command, targetClientIds };
        }
        if (command.command === "exec") {
          const dryRun = command.flags.some((flag) => flag.name === "dry-run");
          return {
            ok: true,
            handled: true,
            level: dryRun ? "info" : "success",
            lines: dryRun
              ? [
                  `exec ${command.args[0] || "script"}: 2 command(s) [dry-run]`,
                  "1> alias fixturewho list [dry-run ok] alias -> client1",
                  "2> fixturewho [dry-run ok] list -> client1 (alias fixturewho -> list)",
                ]
              : [`exec ${command.args[0] || "script"}: fixture script execution path ready`],
            command,
            targetClientIds,
          };
        }
        if (command.command === "accounts") {
          const action = (command.args[0] || "").toLowerCase();
          if (!action) {
            return {
              ok: true,
              handled: true,
              level: "info",
              lines: [
                "usage: accounts import <file> --key-env <ENV_NAME> | accounts list --key-env <ENV_NAME> | accounts load <count> --key-env <ENV_NAME> [--headless] | accounts clear",
                "encrypted store: fixture account store ready",
              ],
              command,
              targetClientIds,
            };
          }
          if (action === "list") {
            return {
              ok: true,
              handled: true,
              level: "info",
              lines: [
                "Encrypted account store: 2 account(s)",
                "Updated: fixture",
                "Source: fixture-accounts.txt",
                "1: FixtureAlt1",
                "2: FixtureAlt2",
              ],
              command,
              targetClientIds,
            };
          }
          if (action === "load") {
            const count = Math.max(1, Number.parseInt(command.args[1] || "1", 10) || 1);
            const currentMax = Math.max(...clientSessions.sessions.map((session) => session.id));
            const added = Array.from({ length: count }, (_, index) => {
              const id = currentMax + index + 1;
              return {
                ...clientSessions.sessions[0],
                id,
                label: `FixtureEncrypted${index + 1}`,
                username: `FixtureEncrypted${index + 1}`,
                status: "ready",
                headless: command.flags.some((flag) => flag.name === "headless"),
                visible: !command.flags.some((flag) => flag.name === "headless"),
                selected: false,
                main: false,
                embeddedUrl: null,
                relayWsPort: 12440 + id * 2,
                relayControlPort: 12441 + id * 2,
                roomName: "Codex Test LAB",
              };
            });
            clientSessions = {
              ...clientSessions,
              message: `Started ${added.length} encrypted fixture client(s).`,
              sessions: [...clientSessions.sessions, ...added],
            };
            return {
              ok: true,
              handled: true,
              level: "success",
              lines: [
                "Encrypted account store load: credentials were decrypted in memory only and not printed.",
                ...added.map((session) => `client${session.id}: ${session.label} ${session.headless ? "[HEADLESS]" : "[VISIBLE]"} ${session.status}`),
              ],
              command,
              targetClientIds: added.map((session) => session.id),
            };
          }
          if (action === "import") {
            return {
              ok: true,
              handled: true,
              level: "success",
              lines: [
                "Imported 2 account(s) into encrypted account store.",
                "Labels: FixtureAlt1, FixtureAlt2",
                "Credentials are encrypted at rest and are never printed by account commands.",
              ],
              command,
              targetClientIds,
            };
          }
          return { ok: false, handled: true, level: "warning", lines: ["usage: accounts import|list|load|clear"], command, targetClientIds };
        }
        if (command.command === "load") {
          const count = Math.max(1, Number.parseInt(command.args[1] || "1", 10) || 1);
          const headless = command.flags.some((flag) => flag.name === "headless");
          const currentMax = Math.max(...clientSessions.sessions.map((session) => session.id));
          const added = Array.from({ length: count }, (_, index) => {
            const id = currentMax + index + 1;
            return {
              ...clientSessions.sessions[0],
              id,
              label: `FixtureAlt${index + 1}`,
              username: `FixtureAlt${index + 1}`,
              status: "ready",
              headless,
              visible: !headless,
              selected: false,
              main: false,
              embeddedUrl: null,
              relayWsPort: 12340 + id * 2,
              relayControlPort: 12341 + id * 2,
              roomName: "Codex Test LAB",
            };
          });
          clientSessions = {
            ...clientSessions,
            message: `Started ${added.length} fixture client(s).`,
            sessions: [...clientSessions.sessions, ...added],
          };
          return {
            ok: true,
            handled: true,
            level: "success",
            lines: [
              `Started ${added.length} client(s) from ${command.args[0] || "fixture"} without persisting or printing credentials.`,
              ...added.map((session) => `client${session.id}: ${session.label} ${session.headless ? "[HEADLESS]" : "[VISIBLE]"} ${session.status}`),
            ],
            command,
            targetClientIds: added.map((session) => session.id),
          };
        }
        if (command.command === "list" || command.command === "clients" || command.command === "sessions") {
          return {
            ok: true,
            handled: true,
            level: "info",
            lines: clientSessions.sessions.map((session) => `${session.id} ${session.label} [${session.selected ? "selected," : ""}${session.headless ? "headless," : "visible,"}${session.status}] ${session.profileLabel}`),
            command,
            targetClientIds,
          };
        }
        if (command.command === "select") {
          const requested = Number.parseInt(command.args[0] || String(targetClientIds[0] || clientSessions.selectedClientId), 10);
          const ok = selectFixtureClient(requested);
          return { ok, handled: true, level: ok ? "success" : "warning", lines: [clientSessions.message], command, targetClientIds: [clientSessions.selectedClientId] };
        }
        if (command.command === "mimic") {
          const sourceFlag = command.flags.find((flag) => flag.name === "source");
          const action = (command.args[0] || "status").toLowerCase();
          const sourceId = Number.parseInt(sourceFlag?.value || command.args[1] || String(clientSessions.mainClientId), 10) || clientSessions.mainClientId;
          if (action === "on" || action === "enable") {
            return {
              ok: true,
              handled: true,
              level: "success",
              lines: [`Mimic enabled from client${sourceId}. ${Math.max(0, clientSessions.sessions.length - 1)} target client(s) available.`],
              command,
              targetClientIds: [sourceId],
            };
          }
          if (action === "off" || action === "disable") {
            return { ok: true, handled: true, level: "success", lines: ["Mimic disabled."], command, targetClientIds: [sourceId] };
          }
          if (action === "source") {
            return { ok: true, handled: true, level: "success", lines: [`Mimic source set to client${sourceId}.`], command, targetClientIds: [sourceId] };
          }
          return {
            ok: true,
            handled: true,
            level: "info",
            lines: [
              "Mimic: off",
              `Source: client${clientSessions.mainClientId}`,
              `Targets: ${clientSessions.sessions.filter((session) => session.id !== clientSessions.mainClientId).map((session) => `client${session.id}`).join(", ") || "-"}`,
              "Forwarded: 0",
              "Blocked: 0",
              "Last forward: -",
              "Last error: -",
            ],
            command,
            targetClientIds: [clientSessions.mainClientId],
          };
        }
        return { ok: true, handled: false, level: "info", lines: [], passthroughInput: command.inputWithoutTarget, command, targetClientIds };
      },
      runConsoleBinding: async (key) => {
        const normalized = normalizeBindingKey(key);
        const boundCommand = commandState.bindings[normalized];
        if (!boundCommand) return { ok: false, handled: true, level: "warning", lines: [`No console binding for ${normalized || "-"}.`] };
        return window.habbpyV4.runConsoleCommand(boundCommand);
      },
      getConsoleCommandState: async () => clone(commandStateSnapshot()),
      importClientReference: async () => clone(fixture.library),
      setActiveClientProfile: async () => clone(fixture.library),
      getEngineLaunchState: async () => clone(fixture.launch),
      setEngineLaunchSettings: async (patch) => {
        fixture.launch = {
          ...fixture.launch,
          settings: {
            ...fixture.launch.settings,
            ...(typeof patch?.resizablePresentation === "boolean" ? { resizablePresentation: patch.resizablePresentation } : {}),
            ...(typeof patch?.customHotelView === "boolean" ? { customHotelView: patch.customHotelView } : {}),
            ...(patch?.versionCheckBuild === null || Number.isInteger(patch?.versionCheckBuild)
              ? { versionCheckBuild: patch.versionCheckBuild }
              : {}),
          },
        };
        return clone(fixture.launch);
      },
      startEmbeddedEngine: async () => clone(fixture.launch),
      stopEmbeddedEngine: async () => clone(fixture.launch),
      getRelayLogSnapshot: async () => clone(fixture.relayLog),
      getRelayLogDeltaSnapshot: async (currentLogPath, afterLineNumber) => {
        if (currentLogPath === fixture.relayLog.logPath && afterLineNumber >= fixture.relayLog.totalLines) {
          return clone({
            ...fixture.relayLog,
            afterLineNumber,
            reset: false,
            entries: [],
          });
        }
        return clone({
          ...fixture.relayLog,
          afterLineNumber,
          reset: true,
        });
      },
      getFurniMetadataSnapshot: async () => clone(fixture.furni),
      lookupOriginsUser: async (name) =>
        clone({
          ok: true,
          query: name,
          source: "official-origins-public-api",
          id: "headless-user-id",
          name: String(name || "dek"),
          figureString: "hd-180-1.ch-210-66.lg-270-82.sh-290-91",
          motto: "Headless renderer fixture",
          memberSince: "2026-06-21",
          profileVisible: true,
          selectedBadges: [],
          message: "Headless lookup fixture.",
        }),
      sendGardeningRelayAction: async (action, clientId = 1) => ({
        ok: true,
        message: `Headless relay action accepted for client${clientId}: ${action.action}`,
        sessionId: clientId,
      }),
      sendRoomRelayAction: async (action, clientId = 1) => ({
        ok: true,
        message: `Headless room action accepted for client${clientId}: ${action.action}`,
        sessionId: clientId,
      }),
      sendFishingRelayAction: async (action, clientId = 1) => ({
        ok: true,
        message: `Headless fishing action accepted for client${clientId}: ${action.action}`,
        sessionId: clientId,
      }),
      sendUserRelayAction: async (action, clientId = 1) => ({
        ok: true,
        message: `Headless user action accepted for client${clientId}: ${action.action}`,
        sessionId: clientId,
      }),
      sendSocialRelayAction: async (action, clientId = 1) => ({
        ok: true,
        message: `Headless social action accepted for client${clientId}: ${action.action}`,
        sessionId: clientId,
      }),
      sendWallMoverRelayAction: async (action, clientId = 1) => ({
        ok: true,
        message: `Headless wall mover action accepted for client${clientId}: ${action.action}`,
        sessionId: clientId,
      }),
    };
  }, createFixture());

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator(".app-shell").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(5200);
  const homePath = path.join(outDir, `home-importer-${runStamp}.png`);
  await page.screenshot({ path: homePath, fullPage: true });
  screenshots.push({ plugin: "Importer Home", path: homePath });
  await page.getByLabel("Embedded engine controls").getByRole("button", { name: "Plugins", exact: true }).click();
  await page.locator(".plugin-store-popout").waitFor({ state: "visible", timeout: 10000 });
  await capturePluginSearchProof(page, outDir, runStamp, screenshots);
  await capturePluginResizeProof(page, outDir, runStamp, screenshots);

  for (const pluginName of pluginsToCapture) {
    const row = page.locator(".plugin-store-list .plugin-store-row").filter({ hasText: pluginName }).first();
    await row.waitFor({ state: "visible", timeout: 10000 });
    await row.click();
    await page.locator(".plugin-store-detail").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(pluginName === "Packet Log" ? 500 : 150);
    if (pluginName === "Packet Log") {
      await page.getByText("SLIDEOBJECTBUNDLE", { exact: false }).first().waitFor({ timeout: 3000 }).catch(() => undefined);
    }

    const fileName = `${slugify(pluginName)}-${runStamp}.png`;
    const screenshotPath = path.join(outDir, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    screenshots.push({ plugin: pluginName, path: screenshotPath });

    if (scrollPlugins.has(pluginName)) {
      await page.locator(".plugin-store-detail").evaluate((panel) => {
        panel.scrollTop = panel.scrollHeight;
      });
      await page.locator(".packet-detail-scroll").evaluate((panel) => {
        panel.scrollTop = panel.scrollHeight;
      }).catch(() => undefined);
      await page.waitForTimeout(150);
      const scrolledPath = path.join(outDir, `${slugify(pluginName)}-scrolled-${runStamp}.png`);
      await page.screenshot({ path: scrolledPath, fullPage: true });
      screenshots.push({ plugin: `${pluginName} scrolled`, path: scrolledPath });
    }
  }

  await page.getByRole("button", { name: "Close plugins", exact: true }).click();
  await page.locator(".plugin-store-popout").waitFor({ state: "hidden", timeout: 10000 });

  await page.getByLabel("Embedded engine controls").getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-popout").waitFor({ state: "visible", timeout: 10000 });
  await captureSettingsSearchProof(page, outDir, runStamp, screenshots);
  await page.waitForTimeout(250);
  const settingsPath = path.join(outDir, `settings-${runStamp}.png`);
  await page.screenshot({ path: settingsPath, fullPage: true });
  screenshots.push({ plugin: "Settings Popout", path: settingsPath });
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.locator(".settings-popout").waitFor({ state: "hidden", timeout: 10000 });

  if (captureCollapsedDock) {
    await page.waitForTimeout(250);
    const collapsedPath = path.join(outDir, `ui-plugin-rail-${runStamp}.png`);
    await page.screenshot({ path: collapsedPath, fullPage: true });
    screenshots.push({ plugin: "Plugin Rail", path: collapsedPath });
  }
  if (consoleCommands.length > 0) {
    await page.keyboard.press("Backquote");
    const consoleInput = page.getByLabel("Packet console command");
    await consoleInput.waitFor({ state: "visible", timeout: 10000 });
    for (const command of consoleCommands) {
      await consoleInput.fill(command);
      await consoleInput.press("Enter");
      await page.waitForTimeout(250);
    }
    await page.locator(".packet-console-list").evaluate((panel) => {
      panel.scrollTop = panel.scrollHeight;
    });
    await page.waitForTimeout(150);
    const consolePath = path.join(outDir, `console-${runStamp}.png`);
    await page.screenshot({ path: consolePath, fullPage: true });
    screenshots.push({ plugin: "Console", path: consolePath });
  }

  const visibleText = await page.locator("body").innerText();
  const forbiddenPresent = forbiddenVisibleCopy.filter((text) => visibleText.includes(text));
  const manifest = {
    kind: "habbpy-v4-headless-renderer-screenshot",
    portableLaunched: false,
    electronLaunched: false,
    rendererDir,
    url,
    viewport,
    plugins: pluginsToCapture,
    scrollPlugins: [...scrollPlugins],
    captureCollapsedDock,
    consoleCommands,
    screenshots,
    forbiddenPresent,
    consoleMessages,
    pageErrors,
  };
  const manifestPath = path.join(outDir, `manifest-${runStamp}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (forbiddenPresent.length > 0 || consoleMessages.length > 0 || pageErrors.length > 0) {
    console.error(JSON.stringify(manifest, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Headless renderer screenshots written to ${outDir}`);
    console.log(`Manifest: ${manifestPath}`);
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}

function createFixture() {
  const profile = {
    id: "headless-renderer-profile",
    label: "Headless renderer profile",
    versionId: "fixture",
    buildNumber: null,
    versionCheckBuild: null,
    importedAt: "2026-06-21T00:00:00.000Z",
    sourceFolderName: "fixture-profile",
    profileRoot: "mock://headless-renderer-profile",
    ready: true,
    reason: null,
    storageMode: "referenced",
  };
  const updatedAt = "2026-06-21T19:30:00.000Z";
  const entries = [
    packetEntry({
      id: "relay-1",
      lineNumber: 1,
      direction: "RELAY",
      route: "relay",
      header: null,
      packetName: null,
      size: null,
      payloadBytes: null,
      bodyStatus: "not-a-packet",
      bodyText: null,
      bodyHex: null,
      bodyAscii: null,
      message: "session headless-session-1 accepted / body logging sampled",
    }),
    packetEntry({
      id: "server-230",
      lineNumber: 2,
      direction: "SERVER",
      route: "official -> shockless",
      header: 230,
      packetName: "SLIDEOBJECTBUNDLE",
      size: 29,
      payloadBytes: 27,
      bodyText: "12[2]34 cp[91]`",
      bodyHex: "31 32 02 33 34 20 63 70 5b 39 31 5d 60",
      bodyAscii: "12\\x0234 cp[91]`",
      decodedFields: [{ label: "Object", value: "plant_rose / id 42" }],
      message: "SERVER SLIDEOBJECTBUNDLE sampled body",
    }),
    packetEntry({
      id: "client-50",
      lineNumber: 3,
      direction: "CLIENT",
      route: "shockless -> official",
      header: 50,
      packetName: "PING",
      size: 2,
      payloadBytes: 0,
      bodyText: "",
      bodyHex: "",
      bodyAscii: "",
      message: "CLIENT PING sampled body",
    }),
    packetEntry({
      id: "client2-chat",
      clientId: 2,
      clientLabel: "FixtureAlt1",
      sessionId: "headless-session-2",
      lineNumber: 4,
      direction: "CLIENT",
      route: "shockless -> official",
      header: 55,
      packetName: "CHAT",
      size: 24,
      payloadBytes: 22,
      bodyText: "hello from fixture alt",
      bodyHex: "68 65 6c 6c 6f 20 66 72 6f 6d 20 66 69 78 74 75 72 65 20 61 6c 74",
      bodyAscii: "hello from fixture alt",
      message: "CLIENT CHAT fixture alt body",
    }),
    packetEntry({
      id: "server-unknown",
      lineNumber: 5,
      direction: "SERVER",
      route: "official -> shockless",
      header: 999,
      packetName: "UNKNOWN_HEADER",
      size: 18,
      payloadBytes: 16,
      bodyText: "mystery payload with full text kept visible",
      bodyHex: "6d 79 73 74 65 72 79 20 70 61 79 6c 6f 61 64",
      bodyAscii: "mystery payload",
      message: "SERVER UNKNOWN_HEADER sampled body",
    }),
    packetEntry({
      id: "server-activeobjects",
      lineNumber: 6,
      direction: "SERVER",
      route: "official -> shockless",
      header: 32,
      packetName: "ACTIVEOBJECTS",
      size: 53,
      payloadBytes: 51,
      bodyText: "I42\\x02plant_bonsai\\x02KQAIIJ0.0\\x02#00ff00\\x02ready\\x02SAwatered\\x02",
      bodyHex: "49 34 32 02 70 6c 61 6e 74 5f 62 6f 6e 73 61 69 02 4b 51 41 49 49 4a 30 2e 30 02 23 30 30 66 66 30 30 02 72 65 61 64 79 02 53 41 77 61 74 65 72 65 64 02",
      bodyAscii: "I42<STX>plant_bonsai<STX>KQAIIJ0.0<STX>#00ff00<STX>ready<STX>SAwatered<STX>",
      decodedFields: [
        { label: "floorObjectCount", value: "1" },
        { label: "floorObject 1 id", value: "42" },
        { label: "floorObject 1 class", value: "plant_bonsai" },
        { label: "floorObject 1 tile", value: "3, 5, 0.0" },
        { label: "floorObject 1 size", value: "1x1" },
        { label: "floorObject 1 rawPosition", value: "KQAIIJ0.0" },
        { label: "floorObject 1 state", value: "7" },
        { label: "floorObject 1 stuff", value: "watered" },
      ],
      message: "SERVER ACTIVEOBJECTS sampled body",
    }),
    packetEntry({
      id: "client-fishing-start",
      lineNumber: 20,
      direction: "CLIENT",
      route: "shockless -> official",
      header: 1100,
      packetName: "STARTFISHING",
      size: 4,
      payloadBytes: 2,
      bodyText: "target 42",
      bodyHex: "2a",
      bodyAscii: "*",
      decodedFields: [
        { label: "fishingClientAction", value: "start" },
        { label: "fishingClientTargetId", value: "42" },
      ],
      message: "CLIENT STARTFISHING sampled body",
    }),
    packetEntry({
      id: "server-fishing-start",
      lineNumber: 21,
      direction: "SERVER",
      route: "official -> shockless",
      header: 1107,
      packetName: "START_FISHING",
      size: 2,
      payloadBytes: 0,
      bodyText: "",
      bodyHex: "",
      bodyAscii: "",
      decodedFields: [
        { label: "fishingMinigameActive", value: "true" },
        { label: "fishingStatus", value: "minigame-started" },
      ],
      message: "SERVER START_FISHING sampled body",
    }),
    packetEntry({
      id: "server-fishing-status",
      lineNumber: 22,
      direction: "SERVER",
      route: "official -> shockless",
      header: 1108,
      packetName: "FISHING_STATUS",
      size: 7,
      payloadBytes: 5,
      bodyText: "18,2,7,0",
      bodyHex: "12 02 07 00",
      bodyAscii: "18,2,7,0",
      decodedFields: [
        { label: "fishingStatusValueCount", value: "4" },
        { label: "fishingStatus 1", value: "18" },
        { label: "fishingStatus 2", value: "2" },
        { label: "fishingStatus 3", value: "7" },
        { label: "fishingStatus 4", value: "0" },
        { label: "fishingMinigamePin", value: "18" },
        { label: "fishingMinigameValues", value: "18, 2, 7, 0" },
      ],
      message: "SERVER FISHING_STATUS sampled body",
    }),
    packetEntry({
      id: "server-fishing-chat",
      lineNumber: 23,
      direction: "SERVER",
      route: "official -> shockless",
      header: 1101,
      packetName: "FISHING_CHAT",
      size: 39,
      payloadBytes: 37,
      bodyText: "You caught a golden carp! (+42 XP)",
      bodyHex: "59 6f 75 20 63 61 75 67 68 74",
      bodyAscii: "You caught a golden carp! (+42 XP)",
      decodedFields: [
        { label: "fishingChatText", value: "You caught a golden carp! (+42 XP)" },
        { label: "fishingCatchMessage", value: "You caught a golden carp!" },
        { label: "fishingCatchName", value: "golden carp" },
        { label: "fishingCatchXp", value: "42" },
        { label: "fishingCatchGolden", value: "true" },
        { label: "fishingStatus", value: "catch" },
      ],
      message: "SERVER FISHING_CHAT sampled body",
    }),
    packetEntry({
      id: "server-fish-tokens",
      lineNumber: 24,
      direction: "SERVER",
      route: "official -> shockless",
      header: 1102,
      packetName: "FISH_TOKENS",
      size: 4,
      payloadBytes: 2,
      bodyText: "1234",
      bodyHex: "31 32 33 34",
      bodyAscii: "1234",
      decodedFields: [{ label: "fishTokens", value: "1234" }],
      message: "SERVER FISH_TOKENS sampled body",
    }),
    packetEntry({
      id: "server-fishing-bulletin",
      lineNumber: 25,
      direction: "SERVER",
      route: "official -> shockless",
      header: 680,
      packetName: "BULLETIN",
      size: 64,
      payloadBytes: 62,
      bodyText: "You leveled up! / You reached fishing level 5 / Fishing Frenzy is active",
      bodyHex: "62 75 6c 6c 65 74 69 6e",
      bodyAscii: "You leveled up! / Fishing Frenzy is active",
      decodedFields: [
        { label: "fishingBulletinText", value: "You leveled up! You reached fishing level 5 Fishing Frenzy is active" },
        { label: "fishingFrenzyActive", value: "true" },
        { label: "fishingFrenzyDurationSec", value: "600" },
        { label: "fishingLevelTitle", value: "You leveled up!" },
        { label: "fishingLevelMessage", value: "You reached fishing level 5" },
        { label: "fishingLevel", value: "5" },
      ],
      message: "SERVER BULLETIN fishing sampled body",
    }),
    packetEntry({
      id: "server-fishopedia-fish",
      lineNumber: 26,
      direction: "SERVER",
      route: "official -> shockless",
      header: 1116,
      packetName: "UPDATE_FISHPEDIA_FISH",
      size: 49,
      payloadBytes: 47,
      bodyText: "fish_golden_carp / 42 XP / 3 catches / complete / lake",
      bodyHex: "66 69 73 68 5f 67 6f 6c 64",
      bodyAscii: "fish_golden_carp",
      decodedFields: [
        { label: "fishopediaFish name", value: "fish_golden_carp" },
        { label: "fishopediaFish xp", value: "42" },
        { label: "fishopediaFish catches", value: "3" },
        { label: "fishopediaFish completion", value: "complete" },
        { label: "fishopediaFish location", value: "lake" },
      ],
      message: "SERVER UPDATE_FISHPEDIA_FISH sampled body",
    }),
    packetEntry({
      id: "server-friend-init",
      lineNumber: 6,
      direction: "SERVER",
      route: "official -> shockless",
      header: 12,
      packetName: "FRIEND_LIST_INIT",
      size: 128,
      payloadBytes: 126,
      bodyText: "friend init fixture",
      bodyHex: "66 72 69 65 6e 64 20 69 6e 69 74",
      bodyAscii: "friend init fixture",
      decodedFields: [
        { label: "messenger persistentMessage", value: "hello" },
        { label: "messenger userLimit", value: "500" },
        { label: "messenger normalLimit", value: "300" },
        { label: "messenger extendedLimit", value: "200" },
        { label: "messengerFriendCount", value: "2" },
        { label: "friend 1 accountId", value: "902" },
        { label: "friend 1 name", value: "dek" },
        { label: "friend 1 gender", value: "1" },
        { label: "friend 1 motto", value: "higher brain pattern" },
        { label: "friend 1 online", value: "true" },
        { label: "friend 1 canFollow", value: "true" },
        { label: "friend 1 location", value: "Codex Test LAB" },
        { label: "friend 1 lastAccess", value: "today" },
        { label: "friend 1 figure", value: "hr-515-1027.hd-190-1021" },
        { label: "friend 1 categoryId", value: "3" },
        { label: "friend 2 accountId", value: "224520" },
        { label: "friend 2 name", value: "Woutt" },
        { label: "friend 2 gender", value: "1" },
        { label: "friend 2 motto", value: "Room builder" },
        { label: "friend 2 online", value: "false" },
        { label: "friend 2 canFollow", value: "false" },
        { label: "friend 2 location", value: "-" },
        { label: "friend 2 lastAccess", value: "yesterday" },
        { label: "friend 2 figure", value: "hd-180-1.ch-210-66" },
        { label: "friend 2 categoryId", value: "1" },
        { label: "messenger requestLimit", value: "10" },
        { label: "messenger requestCount", value: "2" },
        { label: "messenger messageLimit", value: "20" },
        { label: "messenger messageCount", value: "4" },
      ],
      message: "SERVER FRIEND_LIST_INIT sampled body",
    }),
    packetEntry({
      id: "server-badges",
      lineNumber: 7,
      direction: "SERVER",
      route: "official -> shockless",
      header: 229,
      packetName: "AVAILABLE_BADGES",
      size: 28,
      payloadBytes: 26,
      bodyText: "badges fixture",
      bodyHex: "62 61 64 67 65 73",
      bodyAscii: "badges fixture",
      decodedFields: [
        { label: "badgeCount", value: "3" },
        { label: "badge 1 code", value: "HC1" },
        { label: "badge 2 code", value: "ADM" },
        { label: "badge 3 code", value: "GRD99" },
      ],
      message: "SERVER AVAILABLE_BADGES sampled body",
    }),
    packetEntry({
      id: "server-active-badge",
      lineNumber: 8,
      direction: "SERVER",
      route: "official -> shockless",
      header: 228,
      packetName: "USERBADGE",
      size: 8,
      payloadBytes: 6,
      bodyText: "badge slot",
      bodyHex: "62 61 64 67 65",
      bodyAscii: "badge slot",
      decodedFields: [
        { label: "activeBadgeSlot", value: "1" },
        { label: "activeBadgeCode", value: "HC1" },
      ],
      message: "SERVER USERBADGE sampled body",
    }),
    packetEntry({
      id: "server-preferences",
      lineNumber: 9,
      direction: "SERVER",
      route: "official -> shockless",
      header: 308,
      packetName: "ACCOUNT_PREFERENCES",
      size: 5,
      payloadBytes: 3,
      bodyText: "prefs fixture",
      bodyHex: "70 72 65 66 73",
      bodyAscii: "prefs fixture",
      decodedFields: [
        { label: "accountPreferenceCount", value: "3" },
        { label: "accountPreference 1", value: "1" },
        { label: "accountPreference 2", value: "0" },
        { label: "accountPreference 3", value: "1" },
      ],
      message: "SERVER ACCOUNT_PREFERENCES sampled body",
    }),
    packetEntry({
      id: "server-effects",
      lineNumber: 10,
      direction: "SERVER",
      route: "official -> shockless",
      header: 1242,
      packetName: "STATUS_EFFECTS",
      size: 34,
      payloadBytes: 32,
      bodyText: "effects fixture",
      bodyHex: "65 66 66 65 63 74 73",
      bodyAscii: "effects fixture",
      decodedFields: [
        { label: "statusEffectCount", value: "2" },
        { label: "statusEffect 1 name", value: "sparkle" },
        { label: "statusEffect 1 value", value: "5" },
        { label: "statusEffect 2 name", value: "ghost" },
        { label: "statusEffect 2 value", value: "0" },
      ],
      message: "SERVER STATUS_EFFECTS sampled body",
    }),
    packetEntry({
      id: "server-inventory",
      lineNumber: 11,
      direction: "SERVER",
      route: "official -> shockless",
      header: 140,
      packetName: "STRIPINFO_2",
      size: 82,
      payloadBytes: 80,
      bodyText: "inventory fixture",
      bodyHex: "69 6e 76 65 6e 74 6f 72 79",
      bodyAscii: "inventory fixture",
      decodedFields: [
        { label: "inventoryItemCount", value: "2" },
        { label: "inventoryItem 1 id", value: "501" },
        { label: "inventoryItem 1 rawId", value: "501" },
        { label: "inventoryItem 1 idValue", value: "501" },
        { label: "inventoryItem 1 slotId", value: "3" },
        { label: "inventoryItem 1 objectId", value: "42" },
        { label: "inventoryItem 1 type", value: "S" },
        { label: "inventoryItem 1 kind", value: "floor" },
        { label: "inventoryItem 1 class", value: "plant_bonsai" },
        { label: "inventoryItem 1 size", value: "1x2" },
        { label: "inventoryItem 1 colors", value: "#00ff00" },
        { label: "inventoryItem 1 data", value: "#00ff00" },
        { label: "inventoryItem 1 head", value: "501<STX>3S" },
        { label: "inventoryItem 1 body", value: "42<STX>0<STX>0plant_bonsai" },
        { label: "inventoryItem 1 meta", value: "1<STX>2#00ff00" },
        { label: "inventoryItem 1 headTokens", value: "501,3" },
        { label: "inventoryItem 1 bodyTokens", value: "42,0,0" },
        { label: "inventoryItem 1 metaTokens", value: "1,2" },
        { label: "inventoryItem 2 id", value: "777" },
        { label: "inventoryItem 2 rawId", value: "777" },
        { label: "inventoryItem 2 idValue", value: "777" },
        { label: "inventoryItem 2 slotId", value: "9" },
        { label: "inventoryItem 2 objectId", value: "88" },
        { label: "inventoryItem 2 type", value: "I" },
        { label: "inventoryItem 2 kind", value: "wall" },
        { label: "inventoryItem 2 class", value: "poster_skull" },
        { label: "inventoryItem 2 size", value: "-" },
        { label: "inventoryItem 2 data", value: "wall-data" },
        { label: "inventoryItem 2 head", value: "777<STX>9I" },
        { label: "inventoryItem 2 body", value: "88<STX>0<STX>0poster_skull" },
        { label: "inventoryItem 2 meta", value: "wall-data" },
        { label: "inventoryItem 2 headTokens", value: "777,9" },
        { label: "inventoryItem 2 bodyTokens", value: "88,0,0" },
      ],
      message: "SERVER STRIPINFO_2 sampled body",
    }),
    packetEntry({
      id: "server-users",
      lineNumber: 13,
      direction: "SERVER",
      route: "official -> shockless",
      header: 28,
      packetName: "USERS",
      size: 96,
      payloadBytes: 94,
      bodyText: "users fixture",
      bodyHex: "75 73 65 72 73",
      bodyAscii: "users fixture",
      decodedFields: [
        { label: "userCount", value: "1" },
        { label: "user 1 name", value: "dek" },
        { label: "user 1 accountId", value: "902" },
        { label: "user 1 index", value: "1" },
        { label: "user 1 figure", value: "hr-515-1027.hd-190-1021" },
        { label: "user 1 gender", value: "m" },
        { label: "user 1 motto", value: "higher brain pattern" },
        { label: "user 1 position", value: "4, 5, 0.0" },
        { label: "user 1 poolFigure", value: "-" },
        { label: "user 1 badge", value: "HC1" },
        { label: "user 1 type", value: "1" },
      ],
      message: "SERVER USERS sampled body",
    }),
    packetEntry({
      id: "server-chat-talk",
      lineNumber: 14,
      direction: "SERVER",
      route: "official -> shockless",
      header: 24,
      packetName: "CHAT",
      size: 16,
      payloadBytes: 14,
      bodyText: "chat fixture",
      bodyHex: "63 68 61 74",
      bodyAscii: "chat fixture",
      decodedFields: [
        { label: "chatIndex", value: "1" },
        { label: "chatText", value: "hello from relay chat" },
        { label: "chatType", value: "talk" },
        { label: "chatActivity", value: "TALKING" },
      ],
      message: "SERVER CHAT sampled body",
    }),
    packetEntry({
      id: "server-chat-whisper",
      lineNumber: 15,
      direction: "SERVER",
      route: "official -> shockless",
      header: 25,
      packetName: "CHAT_2",
      size: 18,
      payloadBytes: 16,
      bodyText: "whisper fixture",
      bodyHex: "77 68 69 73 70 65 72",
      bodyAscii: "whisper fixture",
      decodedFields: [
        { label: "chatIndex", value: "1" },
        { label: "chatText", value: "quiet relay whisper" },
        { label: "chatType", value: "whisper" },
        { label: "chatActivity", value: "WHISPERING" },
      ],
      message: "SERVER CHAT_2 sampled body",
    }),
    packetEntry({
      id: "server-chat-shout",
      lineNumber: 16,
      direction: "SERVER",
      route: "official -> shockless",
      header: 26,
      packetName: "CHAT_3",
      size: 18,
      payloadBytes: 16,
      bodyText: "shout fixture",
      bodyHex: "73 68 6f 75 74",
      bodyAscii: "shout fixture",
      decodedFields: [
        { label: "chatIndex", value: "1" },
        { label: "chatText", value: "relay shout line" },
        { label: "chatType", value: "shout" },
        { label: "chatActivity", value: "SHOUTING" },
      ],
      message: "SERVER CHAT_3 sampled body",
    }),
    packetEntry({
      id: "server-wall-items",
      lineNumber: 17,
      direction: "SERVER",
      route: "official -> shockless",
      header: 45,
      packetName: "ITEMS",
      size: 96,
      payloadBytes: 94,
      bodyText: "wall items fixture",
      bodyHex: "77 61 6c 6c 20 69 74 65 6d 73",
      bodyAscii: "wall items fixture",
      decodedFields: [
        { label: "wallItemCount", value: "2" },
        { label: "wallItem 1 id", value: "42" },
        { label: "wallItem 1 class", value: "poster_skull" },
        { label: "wallItem 1 owner", value: "dek" },
        { label: "wallItem 1 wall", value: "1,2" },
        { label: "wallItem 1 local", value: "3,4" },
        { label: "wallItem 1 orientation", value: "l" },
        { label: "wallItem 1 rawLocation", value: ":w=1,2 l=3,4 l" },
        { label: "wallItem 1 data", value: "7" },
        { label: "wallItem 1 state", value: "7" },
        { label: "wallItem 2 id", value: "77" },
        { label: "wallItem 2 class", value: "poster_hc" },
        { label: "wallItem 2 owner", value: "Woutt" },
        { label: "wallItem 2 wall", value: "-2,5" },
        { label: "wallItem 2 local", value: "0,1" },
        { label: "wallItem 2 orientation", value: "r" },
        { label: "wallItem 2 rawLocation", value: ":w=-2,5 l=0,1 r" },
        { label: "wallItem 2 data", value: "open" },
      ],
      message: "SERVER ITEMS sampled body",
    }),
    packetEntry({
      id: "server-friend-request-list",
      lineNumber: 18,
      direction: "SERVER",
      route: "official -> shockless",
      header: 314,
      packetName: "FRIEND_REQUEST_LIST",
      size: 23,
      payloadBytes: 21,
      bodyText: "friend request fixture",
      bodyHex: "66 72 69 65 6e 64 20 72 65 71",
      bodyAscii: "friend request fixture",
      decodedFields: [
        { label: "friendRequestCount", value: "1" },
        { label: "friendRequestPendingCount", value: "1" },
        { label: "friendRequest 1 accountId", value: "77157" },
        { label: "friendRequest 1 name", value: "DrSmug" },
        { label: "friendRequest 1 requestId", value: "77157" },
      ],
      message: "SERVER FRIEND_REQUEST_LIST sampled body",
    }),
    packetEntry({
      id: "server-private-message",
      lineNumber: 19,
      direction: "SERVER",
      route: "official -> shockless",
      header: 134,
      packetName: "MESSENGER_MESSAGE",
      size: 94,
      payloadBytes: 92,
      bodyText: "private message fixture",
      bodyHex: "70 72 69 76 61 74 65 20 6d 73 67",
      bodyAscii: "private message fixture",
      decodedFields: [
        { label: "privateMessageCount", value: "1" },
        { label: "privateMessageUnreadCount", value: "1" },
        { label: "privateMessage 1 id", value: "6a2a526d744ba00ef0fd5e15" },
        { label: "privateMessage 1 senderAccountId", value: "161423" },
        { label: "privateMessage 1 sentAt", value: "21-06-2026 05:15:09" },
        { label: "privateMessage 1 text", value: "sorry this is just a test message" },
      ],
      message: "SERVER MESSENGER_MESSAGE sampled body",
    }),
  ];

  return {
    appInfo: {
      name: "Shockless Engine",
      version: "0.0.1",
      mode: "browser-preview",
    },
    appPreferences: {
      hardwareAcceleration: true,
      packetOutputWrap: true,
      packetOutputAutoScroll: true,
      defaultAccountFile: "multiclient-accounts.txt",
      defaultAccountCount: 3,
      defaultAccountConcurrency: 2,
      defaultAccountKeyEnv: "HABBPY_V4_ACCOUNT_STORE_KEY",
      defaultSummonTarget: "headless",
      defaultLoadMode: "headless",
      autoSubmitVisibleLogin: true,
      hardwareAccelerationActive: true,
      hardwareAccelerationRestartRequired: false,
      gpuLaunchSwitches: ["enable-gpu-rasterization", "enable-zero-copy", "ignore-gpu-blocklist", "enable-accelerated-2d-canvas"],
    },
    updateState: {
      status: "idle",
      currentVersion: "0.0.1",
      lastCheckedAt: null,
      skippedVersion: null,
      available: null,
      progress: null,
      stagedPath: null,
      message: "Headless fixture update checker idle.",
      error: null,
    },
    pluginRegistry: createPluginRegistryFixture(),
    library: {
      profiles: [profile],
      selectedProfileRoot: profile.profileRoot,
      selectedProfileId: profile.id,
      message: "Headless renderer fixture profile ready.",
    },
    launch: {
      status: "ready",
      embeddedUrl: null,
      profile,
      buildLabel: "Headless renderer fixture",
      message: "Headless renderer fixture ready.",
      settings: {
        resizablePresentation: true,
        customHotelView: true,
        versionCheckBuild: null,
      },
    },
    clientSessions: {
      selectedClientId: 1,
      mainClientId: 1,
      message: "Headless fixture session manager ready.",
      sessions: [
        {
          id: 1,
          label: "Main",
          username: "dek",
          status: "ready",
          headless: false,
          visible: true,
          selected: true,
          main: true,
          profileId: profile.id,
          profileLabel: "Headless renderer profile / fixture",
          buildLabel: "Headless renderer fixture",
          embeddedUrl: null,
          relayWsPort: null,
          relayControlPort: null,
          roomName: "Codex Test LAB",
          lastError: null,
        },
      ],
    },
    relayLog: {
      logPath: "mock://headless-renderer/shockless-relay.log",
      exists: true,
      fileSize: 2048,
      updatedAt,
      totalLines: entries.length,
      packetCount: entries.filter((entry) => entry.header !== null).length,
      clientCount: entries.filter((entry) => entry.direction === "CLIENT").length,
      serverCount: entries.filter((entry) => entry.direction === "SERVER").length,
      entries,
      message: "Headless fixture relay log loaded.",
    },
    furni: {
      source: "cache",
      fetchedAt: updatedAt,
      entryCount: 2,
      entriesByClass: {
        plant_rose: {
          id: "plant_rose",
          className: "plant_rose",
          kind: "floor",
          name: "Plant",
          description: "Fixture plant metadata",
          category: "plants",
          width: 1,
          height: 1,
          rare: false,
        },
        plant_bonsai: {
          id: "plant_bonsai",
          className: "plant_bonsai",
          kind: "floor",
          name: "Bonsai Plant",
          description: "Fixture inventory plant metadata",
          category: "plants",
          width: 1,
          height: 2,
          rare: false,
        },
        poster_skull: {
          id: "poster_skull",
          className: "poster_skull",
          kind: "wall",
          name: "Skull Poster",
          description: "Fixture wall inventory metadata",
          category: "posters",
          width: 1,
          height: 1,
          rare: false,
        },
        poster_hc: {
          id: "poster_hc",
          className: "poster_hc",
          kind: "wall",
          name: "HC Poster",
          description: "Fixture HC wall poster metadata",
          category: "posters",
          width: 1,
          height: 1,
          rare: false,
        },
      },
      message: "Headless furni fixture loaded.",
    },
  };
}

function createPluginRegistryFixture() {
  const plugins = [
    pluginFixture("connection", "Connection", "core", "plug", "Client profile, import, build, and launch controls.", true),
    pluginFixture("plugin-manager", "Plugin Manager", "core", "settings", "Install, create, reload, enable, disable, and inspect Shockless plugins.", true),
    pluginFixture("settings", "Settings", "core", "settings", "Engine preferences, console preferences, hotkeys, and app performance settings.", true),
    pluginFixture("multi-account", "Multi Account", "session", "users", "Visible and headless session controls.", true),
    pluginFixture("info", "Info", "session", "info", "Account, room, inventory, rights, and public lookup facts.", true),
    pluginFixture("room", "Room", "room", "map", "Room details, heightmap, users, furni, and navigation actions.", true),
    pluginFixture("user", "User", "user", "user", "Selected user profile, avatar actions, and username label controls.", true),
    pluginFixture("items", "Items", "room", "sofa", "Searchable floor and wall item inspector.", true),
    pluginFixture("inventory", "Inventory", "inventory", "package", "Hand inventory rows and item metadata.", true),
    pluginFixture("automation", "Automation", "automation", "bot", "Room automation controls.", true),
    pluginFixture("wall-mover", "Wall Mover", "automation", "hammer", "Wall item movement and pickup tools.", true),
    pluginFixture("social", "Social", "social", "messages", "Friends, messages, requests, and follow actions.", true),
    pluginFixture("visitors", "Visitors", "social", "users", "Current and seen room visitors.", true),
    pluginFixture("chat", "Chat", "social", "messages", "Room chat history and send controls.", true),
    pluginFixture("injection", "Injection", "developer", "terminal", "Mapped runtime command editor.", true),
    pluginFixture("packet-log", "Packet Log", "developer", "terminal", "Decrypted v3-style packet log viewer.", true, ["ui.panel", "packet.read"]),
    pluginFixture("dev-tools", "Dev Tools", "developer", "wrench", "Runtime diagnostics and performance counters.", true),
    {
      ...pluginFixture("sample-plugin", "Sample Plugin", "developer", "terminal", "Disabled fixture user plugin.", false, ["ui.panel", "packet.read"]),
      origin: "user",
      version: "1.0.0",
      author: "Fixture",
      entry: "mock://sample-plugin/plugin.js",
      pluginRoot: "mock://sample-plugin",
    },
  ];
  const enabledById = Object.fromEntries(plugins.map((plugin) => [plugin.id, plugin.enabledByDefault]));
  const uiSurfaceEnabledByPluginId = Object.fromEntries(
    plugins.map((plugin) => [
      plugin.id,
      Object.fromEntries(plugin.uiSurfaces.map((surface) => [surface.id, surface.enabledByDefault])),
    ]),
  );
  return {
    plugins,
    enabledById,
    uiSurfaceEnabledByPluginId,
    pinnedPluginIds: ["connection", "plugin-manager", "settings"],
    userPluginRoot: "mock://appdata/Shockless/plugins",
    portablePluginRoot: "mock://portable/Shockless/plugins",
    loadErrors: [],
    message: "Headless fixture plugin manager ready.",
  };
}

function pluginFixture(id, name, category, icon, summary, enabledByDefault, permissions = ["ui.panel"]) {
  const core = category === "core";
  return {
    id,
    name,
    category,
    icon,
    enabledByDefault,
    status: "ready",
    summary,
    capabilities: [summary],
    uiSurfaces: [
      {
        id: "panel",
        kind: "panel",
        label: name,
        enabledByDefault: true,
        summary,
      },
    ],
    sourceMapping: {
      habbpyV3: ["Headless renderer fixture"],
      shockless: ["Headless renderer fixture"],
      notes: "Screenshot fixture plugin metadata.",
    },
    origin: "built-in",
    core,
    permissions,
    loadError: null,
  };
}

function parseConsoleCommands(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((value) => String(value).trim()).filter(Boolean);
    } catch {
      // Fall back to the semicolon/newline format below.
    }
  }
  return trimmed
    .split(/\r?\n|(?<!\\);/u)
    .map((command) => command.replace(/\\;/g, ";").trim())
    .filter(Boolean);
}

function packetEntry(entry) {
  return {
    clientId: 1,
    clientLabel: "Main",
    sessionId: entry.header === null ? null : "headless-session-1",
    mode: entry.header === null ? null : "decrypted",
    bodyTruncated: false,
    bodyNote: entry.header === null ? "relay lifecycle" : "sampled decrypted packet body",
    decodedFields: [],
    ...entry,
  };
}

async function capturePluginSearchProof(page, outDir, stamp, screenshots) {
  const search = page.locator(".plugin-store-sidebar-search input").first();
  await search.fill("names above");
  const userRow = page.locator(".plugin-store-list .plugin-store-row").filter({ hasText: "User" }).first();
  await userRow.waitFor({ state: "visible", timeout: 5000 });
  await userRow.click();
  await page.getByText("Render Names Above Heads", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(150);
  const screenshotPath = path.join(outDir, `plugin-search-name-labels-${stamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  screenshots.push({ plugin: "Plugin search - name labels", path: screenshotPath });
  await search.fill("");
  await page.waitForTimeout(100);
}

async function capturePluginResizeProof(page, outDir, stamp, screenshots) {
  const modal = page.locator(".plugin-store-popout").first();
  const handle = page.locator(".plugin-store-popout .app-popout-resize-handle").first();
  const before = await modal.boundingBox();
  const handleBox = await handle.boundingBox();
  if (!before || !handleBox) throw new Error("Plugin manager resize proof failed: modal or handle was not visible.");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 110, handleBox.y + handleBox.height / 2 + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const after = await modal.boundingBox();
  if (!after) throw new Error("Plugin manager resize proof failed: modal disappeared after resize.");
  const widthDelta = after.width - before.width;
  const heightDelta = after.height - before.height;
  if (widthDelta < 35 && heightDelta < 25) {
    throw new Error(`Plugin manager resize proof failed: size only changed by ${Math.round(widthDelta)}x${Math.round(heightDelta)}.`);
  }
  const screenshotPath = path.join(outDir, `plugin-resize-proof-${stamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  screenshots.push({ plugin: "Plugin resize proof", path: screenshotPath });
}

async function captureSettingsSearchProof(page, outDir, stamp, screenshots) {
  const search = page.locator(".settings-popout .plugin-store-sidebar-search input").first();
  await search.fill("names above");
  await page.getByText("Render Names Above Heads", { exact: false }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.waitForTimeout(150);
  const screenshotPath = path.join(outDir, `settings-search-name-labels-${stamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  screenshots.push({ plugin: "Settings search - name labels", path: screenshotPath });
  await search.fill("");
  await page.waitForTimeout(100);
}

async function assertDirectory(directory) {
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) throw new Error(`${directory} is not a directory.`);
  } catch (error) {
    throw new Error(`Renderer build not found at ${directory}. Run npm run build:renderer first.`, {
      cause: error,
    });
  }
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanFlag(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
      const filePath = path.resolve(root, `.${pathname}`);
      if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": contentType(filePath),
        "cache-control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: server.address().port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff2":
      return "font/woff2";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
