import { once } from "node:events";
import { existsSync, statSync } from "node:fs";
import type { Server } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRelayResourceDir } from "./shocklessEmbed.js";

interface OriginsRelayModule {
  createOriginsRelayServer(options?: {
    readonly wsHost?: string;
    readonly wsPort?: number;
    readonly quiet?: boolean;
    readonly logPackets?: boolean;
  }): Server;
}

interface ProbeResult {
  readonly build: number;
  readonly accepted: boolean;
  readonly rejected: boolean;
  readonly error?: string;
}

export interface VersionCheckDetectionResult {
  readonly build: number | null;
  readonly tried: readonly number[];
  readonly error?: string;
}

const PROBE_HOST = "127.0.0.1";
const DEFAULT_PROBE_TIMEOUT_MS = 5000;
const DEFAULT_PROBE_LOOKAHEAD = 64;

export async function detectAcceptedVersionCheckBuild(options: {
  readonly profileRoot: string;
  readonly preferredBuilds?: readonly (number | null | undefined)[];
  readonly timeoutMs?: number;
  readonly lookahead?: number;
}): Promise<VersionCheckDetectionResult> {
  const defaultBuild = await loadDefaultVersionCheckBuild(options.profileRoot);
  const builds = candidateBuilds(options.preferredBuilds ?? [], options.lookahead ?? DEFAULT_PROBE_LOOKAHEAD, defaultBuild);
  if (builds.length === 0) return { build: null, tried: [] };

  let relayServer: Server | null = null;
  const tried: number[] = [];
  try {
    const relayDir = resolveRelayResourceDir(options.profileRoot);
    if (!relayDir) return { build: null, tried, error: "Relay resources unavailable for VERSIONCHECK probe." };
    const relayModule = (await import(pathToFileURL(resolve(join(relayDir, "origins-relay.mjs"))).href)) as OriginsRelayModule;
    relayServer = relayModule.createOriginsRelayServer({ wsHost: PROBE_HOST, quiet: true });
    await new Promise<void>((resolveListen, reject) => {
      relayServer!.once("error", reject);
      relayServer!.listen(0, PROBE_HOST, resolveListen);
    });
    const address = relayServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) return { build: null, tried, error: "Version-check probe relay did not expose a port." };

    for (const build of builds) {
      tried.push(build);
      const result = await probeBuild(build, port, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
      if (result.accepted) return { build, tried };
      if (result.error && !result.rejected) return { build: null, tried, error: result.error };
    }
    return { build: null, tried };
  } catch (error) {
    return { build: null, tried, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await closeServer(relayServer);
  }
}

function candidateBuilds(preferredBuilds: readonly (number | null | undefined)[], lookahead: number, defaultBuild: number | null): number[] {
  const result: number[] = [];
  const add = (value: unknown): void => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || result.includes(parsed)) return;
    result.push(parsed);
  };
  for (const build of preferredBuilds) add(build);
  add(defaultBuild);
  if (defaultBuild !== null) {
    for (let offset = 1; offset <= lookahead; offset += 1) add(defaultBuild + offset);
  }
  const first = result[0];
  if (first !== undefined && defaultBuild === null) {
    for (let offset = 1; offset <= lookahead; offset += 1) add(first + offset);
    for (let offset = 1; offset <= Math.min(lookahead, 8); offset += 1) add(first - offset);
  }
  return result;
}

async function loadDefaultVersionCheckBuild(profileRoot: string): Promise<number | null> {
  for (const candidate of defaultVersionCheckBuildModuleCandidates(profileRoot)) {
    if (!fileExists(candidate)) continue;
    try {
      const mod = (await import(pathToFileURL(candidate).href)) as { readonly DEFAULT_VERSION_CHECK_BUILD?: unknown };
      const value = Number(mod.DEFAULT_VERSION_CHECK_BUILD);
      if (Number.isSafeInteger(value) && value > 0) return value;
    } catch {
      // Keep looking for a bundled/source Shockless common types module.
    }
  }
  return null;
}

function defaultVersionCheckBuildModuleCandidates(profileRoot: string): readonly string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const relayDir = resolveRelayResourceDir(profileRoot);
  return [
    resourcesPath ? join(resourcesPath, "engine", "standalone", "dist", "main", "common", "types.js") : "",
    relayDir ? join(dirname(relayDir), "engine", "standalone", "dist", "main", "common", "types.js") : "",
    relayDir ? join(dirname(dirname(relayDir)), "dist", "main", "common", "types.js") : "",
    resolve(process.cwd(), "..", "habbo-origins-engine", "standalone", "dist", "main", "common", "types.js"),
    ...ancestorSiblingCandidates("habbo-origins-engine", "standalone", "dist", "main", "common", "types.js"),
  ].filter(Boolean);
}

function ancestorSiblingCandidates(...parts: readonly string[]): readonly string[] {
  const starts = new Set([process.cwd(), process.execPath ? dirname(process.execPath) : process.cwd()]);
  const candidates = new Set<string>();
  for (const start of starts) {
    let current = resolve(start);
    while (true) {
      candidates.add(join(current, ...parts));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...candidates];
}

function fileExists(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}

async function probeBuild(build: number, port: number, timeoutMs: number): Promise<ProbeResult> {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) return { build, accepted: false, rejected: false, error: "WebSocket is not available in this runtime." };

  const ws = new WebSocketCtor(`ws://${PROBE_HOST}:${port}`);
  const timer = new AbortController();
  let accepted = false;
  let rejected = false;
  let error: string | undefined;
  let done = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const waitForResult = new Promise<void>((resolveWait) => {
    const finish = (): void => {
      if (done) return;
      done = true;
      resolveWait();
    };
    timeout = setTimeout(finish, timeoutMs);

    ws.addEventListener(
      "message",
      (event) => {
        void bytesFromWebSocketData(event.data)
          .then((bytes) => {
            for (const packet of splitServerFrames(bytes)) {
              const id = safePacketHeaderId(packet);
              if (id === 0) {
                ws.send(prependClientLength(makePacket(206)));
              } else if (id === 277) {
                ws.send(prependClientLength(makePacket(202, writeOutgoingString("relay-terminated"))));
              } else if (id === 1) {
                ws.send(prependClientLength(versionCheckPacket(build)));
                ws.send(prependClientLength(makePacket(6, writeOutgoingString("director-habbo-runtime"))));
                ws.send(prependClientLength(makePacket(181)));
              } else if (id === 33 && packet.subarray(2).toString("latin1").includes("Version not correct")) {
                rejected = true;
                finish();
              } else if (id === 257) {
                accepted = true;
                finish();
              }
            }
          })
          .catch((decodeError: unknown) => {
            error = decodeError instanceof Error ? decodeError.message : String(decodeError);
            finish();
          });
      },
      { signal: timer.signal },
    );
    ws.addEventListener(
      "error",
      () => {
        error = "WebSocket error during version-check probe.";
        finish();
      },
      { signal: timer.signal },
    );
    ws.addEventListener("close", finish, { signal: timer.signal });
  });

  try {
    await once(ws, "open");
    await waitForResult;
  } catch (openError) {
    error = openError instanceof Error ? openError.message : String(openError);
  } finally {
    if (timeout) clearTimeout(timeout);
    timer.abort();
    try {
      ws.close();
    } catch {
      // Ignore close races during probe cleanup.
    }
  }

  return { build, accepted, rejected, ...(error ? { error } : {}) };
}

function versionCheckPacket(build: number): Buffer {
  return makePacket(
    5,
    Buffer.concat([Buffer.from(encodeVl64(build), "latin1"), writeOutgoingString("2"), writeOutgoingString("external_variables.txt")]),
  );
}

function makePacket(headerId: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  return Buffer.concat([encodeHabboBase64(headerId, 2), payload]);
}

function prependClientLength(packet: Buffer): Buffer {
  return Buffer.concat([encodeHabboBase64(packet.length, 3), packet]);
}

function writeOutgoingString(value: string): Buffer {
  const bytes = Buffer.from(value, "latin1");
  return Buffer.concat([encodeHabboBase64(bytes.length, 2), bytes]);
}

function encodeHabboBase64(value: number, width: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid Habbo Base64 value: ${value}`);
  const output = Buffer.alloc(width);
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    output[index] = 0x40 + (remaining & 0x3f);
    remaining = Math.floor(remaining / 64);
  }
  if (remaining !== 0) throw new Error(`Habbo Base64 value ${value} does not fit in ${width} bytes.`);
  return output;
}

function decodeHabboBase64(bytes: Buffer): number {
  let value = 0;
  for (const byte of bytes) value = value * 64 + (byte & 0x3f);
  return value;
}

function encodeVl64(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid VL64 value: ${value}`);
  let remaining = value;
  const bytes = [64 + (remaining & 0x03)];
  remaining = Math.floor(remaining / 4);
  while (remaining > 0) {
    bytes.push(64 + (remaining & 0x3f));
    remaining = Math.floor(remaining / 64);
  }
  bytes[0] = bytes[0]! | (bytes.length << 3);
  return String.fromCharCode(...bytes);
}

function packetHeaderId(packet: Buffer): number {
  if (packet.length < 2) throw new Error("Packet missing header.");
  return decodeHabboBase64(packet.subarray(0, 2));
}

function splitServerFrames(bytes: Buffer): Buffer[] {
  const packets: Buffer[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const end = bytes.indexOf(1, offset);
    if (end < 0) {
      if (offset < bytes.length) packets.push(bytes.subarray(offset));
      break;
    }
    if (end > offset) packets.push(bytes.subarray(offset, end));
    offset = end + 1;
  }
  return packets;
}

function safePacketHeaderId(packet: Buffer): number {
  try {
    return packetHeaderId(packet);
  } catch {
    return -1;
  }
}

async function bytesFromWebSocketData(data: unknown): Promise<Buffer> {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  if (typeof data === "string") return Buffer.from(data, "latin1");
  return Buffer.from([]);
}

function closeServer(server: Server | null): Promise<void> {
  return new Promise((resolveClose) => {
    if (!server || !server.listening) {
      resolveClose();
      return;
    }
    server.close(() => resolveClose());
  });
}
