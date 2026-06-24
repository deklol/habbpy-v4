#!/usr/bin/env node
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { createWriteStream, existsSync, mkdirSync, readFileSync, type WriteStream } from "node:fs";
import net, { type Server, type Socket } from "node:net";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSocialRelayPacketFromControl } from "../../shared/socialRelayPackets.js";
import { buildFishingRelayPacketFromControl } from "../../shared/fishingRelayPackets.js";
import { buildFurniRelayPacketFromControl } from "../../shared/furniRelayPackets.js";
import { buildUserRelayPacketFromControl } from "../../shared/userRelayPackets.js";
import { buildWallMoverRelayPacketFromControl } from "../../shared/wallMoverRelayPackets.js";
import { buildMimicRelayPacketFromControl } from "../../shared/mimicRelayPackets.js";
import { buildRoomRelayPacketsFromControl } from "../../shared/roomRelayPackets.js";
import { buildGardeningRelayPacketFromControl } from "../../shared/gardeningRelayPackets.js";
import { buildShockwavePluginPacketFromControl } from "../../shared/shockwavePluginPacketBuilder.js";
import {
  decidePluginRelayPacket,
  emptyPluginRelayPolicy,
  normalizePluginRelayPolicy,
  type PluginRelayDirection,
  type PluginRelayPolicy,
} from "../../shared/pluginRelayHooks.js";

type BodyLoggingMode = "off" | "safe";

interface RelayOptions {
  readonly wsHost?: string;
  readonly wsPort?: number | string;
  readonly controlHost?: string;
  readonly controlPort?: number | string;
  readonly tcpHost?: string;
  readonly tcpPort?: number | string;
  readonly dnsBypassHosts?: boolean;
  readonly logPackets?: boolean;
  readonly logPacketBodies?: BodyLoggingMode;
  readonly sessionLogDir?: string;
  readonly pluginRelayPolicyFile?: string;
  readonly quiet?: boolean;
  readonly privateKey?: string;
}

interface RelaySettings {
  readonly wsHost: string;
  readonly wsPort: number;
  readonly controlHost: string;
  readonly controlPort: number;
  readonly tcpHost: string;
  readonly tcpPort: number;
  readonly dnsBypassHosts: boolean;
  readonly logPackets: boolean;
  readonly logPacketBodies: BodyLoggingMode;
  readonly sessionLogDir?: string;
  readonly pluginRelayPolicy: PluginRelayPolicy;
  readonly quiet: boolean;
  readonly privateKey?: string;
}

interface WebSocketFrameHandlers {
  readonly data: (payload: Buffer) => void;
  readonly close: () => void;
  readonly pong: (payload: Buffer) => void;
}

interface PacketBuffer {
  push(chunk: Buffer): void;
  receive(): Buffer[];
}

interface PacketBufferConstructor {
  new (...args: unknown[]): PacketBuffer;
}

interface CryptoStream {
  xor(input: Buffer): Buffer;
}

interface BobbaCryptoInstance {
  publicKeyString(): string;
  setPeerPublicKey(publicKey: string): void;
  readonly c2sHeader: CryptoStream;
  readonly c2sData: CryptoStream;
  readonly s2cHeader: CryptoStream;
  readonly s2cData: CryptoStream;
}

interface BobbaCryptoConstructor {
  new (options?: { readonly privateKey?: string }): BobbaCryptoInstance;
}

interface CodecModule {
  readonly ClientPacketBuffer: PacketBufferConstructor;
  readonly EncryptedShockwaveChunkBuffer: PacketBufferConstructor;
  readonly ServerPacketBuffer: PacketBufferConstructor;
  readonly encryptShockwaveChunk: (plainChunk: Buffer, headerStream: CryptoStream, dataStream: CryptoStream) => Buffer;
  readonly makePacket: (headerId: number, payload?: Buffer) => Buffer;
  readonly packetHeaderId: (packet: Buffer) => number;
  readonly prependClientLength: (packet: Buffer) => Buffer;
  readonly readIncomingString: (packet: Buffer, offset?: number) => { readonly value: string; readonly offset: number };
  readonly readOutgoingString: (packet: Buffer, offset?: number) => { readonly value: string; readonly offset: number };
  readonly serverFrame: (packet: Buffer) => Buffer;
  readonly writeOutgoingString: (value: string) => Buffer;
}

const DEFAULT_WS_HOST = "127.0.0.1";
const DEFAULT_WS_PORT = 12326;
const DEFAULT_CONTROL_HOST = "127.0.0.1";
const DEFAULT_CONTROL_PORT = 12327;
const DEFAULT_TCP_HOST = "game-ous.habbo.com";
const DEFAULT_TCP_PORT = 40001;

const PACKETS = {
  HELLO: 0,
  SECRET_KEY: 1,
  TRY_LOGIN: 4,
  UNIQUEID: 6,
  GENERATEKEY: 202,
} as const;

const activeSessions = new Map<number, OriginsRelaySession>();

const relayResources = resolveRelayResourceDir();
const { BobbaCrypto } = (await import(pathToFileURL(join(relayResources, "bobba-crypto.mjs")).href)) as {
  readonly BobbaCrypto: BobbaCryptoConstructor;
};
const {
  ClientPacketBuffer,
  EncryptedShockwaveChunkBuffer,
  ServerPacketBuffer,
  encryptShockwaveChunk,
  makePacket,
  packetHeaderId,
  prependClientLength,
  readIncomingString,
  readOutgoingString,
  serverFrame,
  writeOutgoingString,
} = (await import(pathToFileURL(join(relayResources, "shockwave-codec.mjs")).href)) as CodecModule;

export function createOriginsRelayServer(options: RelayOptions = {}): Server {
  const settings = normalizeRelayOptions(options);
  let connectionCounter = 0;

  return net.createServer((browserSocket) => {
    const id = ++connectionCounter;
    const session = new OriginsRelaySession(id, settings, browserSocket);
    session.start();
  });
}

class OriginsRelaySession {
  private websocketUpgraded = false;
  private websocketBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private httpHandshakeBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private upstreamSocket: Socket | undefined;
  private readonly upstreamCrypto: BobbaCryptoInstance;
  private readonly clientPackets = new ClientPacketBuffer();
  private readonly serverPackets = new ServerPacketBuffer();
  private encryptedServerChunks: PacketBuffer | undefined;
  private serverCryptoEnabled = false;
  private closed = false;
  private readonly sessionLogStream: WriteStream | null;
  private pluginPolicyLogged = false;

  constructor(
    readonly id: number,
    private readonly settings: RelaySettings,
    private readonly browserSocket: Socket,
  ) {
    this.upstreamCrypto = new BobbaCrypto(settings.privateKey === undefined ? {} : { privateKey: settings.privateKey });
    this.sessionLogStream = settings.sessionLogDir ? createSessionLogStream(settings.sessionLogDir, id) : null;
  }

  start(): void {
    activeSessions.set(this.id, this);
    this.browserSocket.on("data", (chunk: Buffer) => this.handleBrowserData(chunk));
    this.browserSocket.on("close", () => this.close("browser closed"));
    this.browserSocket.on("error", (error: Error) => this.close(`browser error ${error.message}`));
  }

  private handleBrowserData(chunk: Buffer): void {
    if (this.closed) return;

    if (!this.websocketUpgraded) {
      this.httpHandshakeBuffer = Buffer.concat([this.httpHandshakeBuffer, Buffer.from(chunk)]);
      const end = this.httpHandshakeBuffer.indexOf("\r\n\r\n");
      if (end < 0) return;

      const headerText = this.httpHandshakeBuffer.subarray(0, end).toString("latin1");
      const headers = parseHttpHeaders(headerText);
      const key = headers["sec-websocket-key"];
      if (!key) {
        this.browserSocket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return;
      }

      const leftover = this.httpHandshakeBuffer.subarray(end + 4);
      void this.connectUpstreamAndUpgrade(key, leftover);
      return;
    }

    this.websocketBuffer = Buffer.concat([this.websocketBuffer, Buffer.from(chunk)]);
    this.websocketBuffer = drainWebSocketFrames(this.websocketBuffer, {
      data: (payload) => this.handleBrowserPayload(payload),
      close: () => this.close("browser requested websocket close"),
      pong: (payload) => this.browserSocket.write(encodeWebSocketFrame(payload, 0x0a)),
    });
  }

  private async connectUpstreamAndUpgrade(webSocketKey: string, leftover: Buffer): Promise<void> {
    try {
      const upstreamHost = await resolveUpstreamHost(this.settings);
      this.upstreamSocket = net.connect({ host: upstreamHost, port: this.settings.tcpPort });
      this.upstreamSocket.on("data", (chunk: Buffer) => this.handleUpstreamData(chunk));
      this.upstreamSocket.on("close", () => this.close("upstream closed"));
      this.upstreamSocket.on("error", (error: Error) => this.close(`upstream error ${error.message}`));

      await onceConnect(this.upstreamSocket);
      this.websocketUpgraded = true;
      this.browserSocket.write(webSocketUpgradeResponse(webSocketKey));
      this.log(`browser ws -> ${upstreamHost}:${this.settings.tcpPort}`);

      if (leftover.length > 0) this.handleBrowserData(leftover);
    } catch (error) {
      const message = errorMessage(error);
      this.log(`upstream connect failed: ${message}`);
      this.browserSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      this.close(`upstream connect failed ${message}`);
    }
  }

  private handleBrowserPayload(payload: Buffer): void {
    this.clientPackets.push(payload);
    let packets: Buffer[];
    try {
      packets = this.clientPackets.receive();
    } catch (error) {
      this.closeProtocolError("browser packet parse failed", error);
      return;
    }

    for (const packet of packets) {
      try {
        this.forwardBrowserPacket(packet);
      } catch (error) {
        this.closeProtocolError("browser packet forward failed", error);
        return;
      }
    }
  }

  private forwardBrowserPacket(packet: Buffer): void {
    if (!this.upstreamSocket || this.upstreamSocket.destroyed) return;

    let outgoingPacket: Buffer<ArrayBufferLike> = Buffer.from(packet);
    const headerId = safeHeaderId(outgoingPacket);
    if (headerId === PACKETS.GENERATEKEY) {
      outgoingPacket = makePacket(PACKETS.GENERATEKEY, writeOutgoingString(this.upstreamCrypto.publicKeyString()));
      this.log(`client GENERATEKEY replaced with relay public key length ${this.upstreamCrypto.publicKeyString().length}`);
    }
    this.applyPluginRelayPolicy("client", outgoingPacket);

    if (this.serverCryptoEnabled) {
      this.upstreamSocket.write(encryptShockwaveChunk(outgoingPacket, this.upstreamCrypto.c2sHeader, this.upstreamCrypto.c2sData));
      this.logPacket("browser -> official plaintext", outgoingPacket);
      return;
    }

    this.upstreamSocket.write(prependClientLength(outgoingPacket));
    this.logPacket("browser -> official plaintext", outgoingPacket);
  }

  injectClientPacket(packet: Buffer, note: string): { readonly ok: boolean; readonly message: string } {
    if (!this.upstreamSocket || this.upstreamSocket.destroyed) {
      return { ok: false, message: `Relay session ${this.id} has no live upstream socket.` };
    }

    if (this.serverCryptoEnabled) {
      this.upstreamSocket.write(encryptShockwaveChunk(packet, this.upstreamCrypto.c2sHeader, this.upstreamCrypto.c2sData));
    } else {
      this.upstreamSocket.write(prependClientLength(packet));
    }
    this.logPacket(`habbpy-control -> official plaintext ${note}`, packet);
    return { ok: true, message: `Sent ${note} through relay session ${this.id}.` };
  }

  private handleUpstreamData(chunk: Buffer): void {
    try {
      if (this.serverCryptoEnabled) {
        this.encryptedServerChunks?.push(chunk);
        for (const plainChunk of this.encryptedServerChunks?.receive() ?? []) {
          this.serverPackets.push(plainChunk);
          this.forwardServerPackets();
        }
        return;
      }

      this.serverPackets.push(chunk);
      this.forwardServerPackets();
    } catch (error) {
      this.closeProtocolError("official packet parse failed", error);
    }
  }

  private forwardServerPackets(): void {
    for (const packet of this.serverPackets.receive()) {
      const headerId = safeHeaderId(packet);
      if (headerId === PACKETS.SECRET_KEY && !this.serverCryptoEnabled) {
        const serverPublicKey = readIncomingString(packet).value;
        this.upstreamCrypto.setPeerPublicKey(serverPublicKey);
        this.encryptedServerChunks = new EncryptedShockwaveChunkBuffer(
          this.upstreamCrypto.s2cHeader,
          this.upstreamCrypto.s2cData,
        );
        this.serverCryptoEnabled = true;
        this.log(`official SECRET_KEY received length ${serverPublicKey.length}; upstream BobbaCrypto enabled`);
      }

      this.applyPluginRelayPolicy("server", packet);
      this.browserSocket.write(encodeWebSocketFrame(serverFrame(packet), 0x02));
      this.logPacket("official -> browser plaintext", packet);
    }
  }

  private applyPluginRelayPolicy(direction: PluginRelayDirection, packet: Buffer): void {
    if (this.pluginPolicyLogged) return;
    const header = safeHeaderId(packet);
    const decision = decidePluginRelayPacket(this.settings.pluginRelayPolicy, { direction, header });
    const grantCount = this.settings.pluginRelayPolicy.grants.length;
    if (grantCount === 0) {
      this.pluginPolicyLogged = true;
      return;
    }
    this.pluginPolicyLogged = true;
    this.log(
      `plugin relay policy active grants=${grantCount} firstPacket=${direction}:${header} readers=${decision.readPluginIds.length} interceptors=${decision.interceptPluginIds.length} injectors=${decision.injectPluginIds.length}`,
    );
  }

  private close(reason: string): void {
    if (this.closed) return;

    this.closed = true;
    this.log(reason);
    activeSessions.delete(this.id);
    this.upstreamSocket?.destroy();
    this.browserSocket.destroy();
    this.sessionLogStream?.end();
  }

  private closeProtocolError(context: string, error: unknown): void {
    this.close(`${context}: ${errorMessage(error)}`);
  }

  private log(message: string): void {
    const line = `[${new Date().toISOString()}] [origins-relay #${this.id}] ${message}\n`;
    this.sessionLogStream?.write(line);
    if (this.settings.quiet) return;
    console.log(`[origins-relay #${this.id}] ${message}`);
  }

  private logPacket(prefix: string, packet: Buffer): void {
    if (!this.settings.logPackets) return;

    const headerId = safeHeaderId(packet);
    const suffix =
      headerId === PACKETS.GENERATEKEY
        ? ` header=${headerId} keyLength=${readSafeOutgoingString(packet).length}`
        : ` header=${headerId} bytes=${packet.length}`;
    this.log(`${prefix}${suffix}${safeBodySuffix(prefix, headerId, packet, this.settings.logPacketBodies)}`);
  }
}

export function normalizeRelayOptions(options: RelayOptions = {}): RelaySettings {
  return {
    wsHost: options.wsHost ?? readEnvString("ORIGINS_WS_HOST", "BRIDGE_WS_HOST") ?? DEFAULT_WS_HOST,
    wsPort: parsePort(options.wsPort ?? readEnvString("ORIGINS_WS_PORT", "BRIDGE_WS_PORT"), DEFAULT_WS_PORT),
    controlHost: options.controlHost ?? readEnvString("ORIGINS_CONTROL_HOST") ?? DEFAULT_CONTROL_HOST,
    controlPort: parsePort(options.controlPort ?? readEnvString("ORIGINS_CONTROL_PORT"), DEFAULT_CONTROL_PORT),
    tcpHost: options.tcpHost ?? readEnvString("ORIGINS_TCP_HOST", "BRIDGE_TCP_HOST") ?? DEFAULT_TCP_HOST,
    tcpPort: parsePort(options.tcpPort ?? readEnvString("ORIGINS_TCP_PORT", "BRIDGE_TCP_PORT"), DEFAULT_TCP_PORT),
    dnsBypassHosts: options.dnsBypassHosts ?? readEnvString("ORIGINS_DNS_BYPASS_HOSTS") !== "0",
    logPackets: options.logPackets ?? readEnvString("ORIGINS_LOG_PACKETS") === "1",
    logPacketBodies: options.logPacketBodies ?? parseBodyLoggingMode(readEnvString("ORIGINS_LOG_PACKET_BODIES")),
    sessionLogDir: options.sessionLogDir ?? readEnvString("ORIGINS_SESSION_LOG_DIR"),
    pluginRelayPolicy: readPluginRelayPolicy(options.pluginRelayPolicyFile ?? readEnvString("ORIGINS_PLUGIN_RELAY_POLICY_FILE")),
    quiet: options.quiet ?? false,
    privateKey: options.privateKey,
  };
}

function readPluginRelayPolicy(filePath: string | undefined): PluginRelayPolicy {
  if (!filePath) return emptyPluginRelayPolicy();
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) return emptyPluginRelayPolicy();
  try {
    return normalizePluginRelayPolicy(JSON.parse(readFileSync(resolved, "utf8")));
  } catch {
    return emptyPluginRelayPolicy();
  }
}

function createSessionLogStream(logDir: string, sessionId: number): WriteStream {
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return createWriteStream(join(logDir, `session-${stamp}-${sessionId}.log`), { flags: "a" });
}

function createRelayControlServer(settings: RelaySettings): Server {
  return net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) socket.write(`${JSON.stringify(handleRelayControlLine(line))}\n`);
        newline = buffer.indexOf("\n");
      }
    });
    socket.on("error", () => undefined);
  });
}

function handleRelayControlLine(line: string): { readonly ok: boolean; readonly message: string; readonly sessionId?: number } {
  let command: unknown;
  try {
    command = JSON.parse(line);
  } catch {
    return { ok: false, message: "Relay control command was not valid JSON." };
  }

  const packetBuild = relayPacketFromControl(command);
  if (!packetBuild.ok) return packetBuild;
  const session = latestActiveSession();
  if (!session) return { ok: false, message: "No active relay session is available for packet send." };
  const packets = "packets" in packetBuild ? packetBuild.packets : [{ packet: packetBuild.packet, note: packetBuild.note }];
  for (const packet of packets) {
    const sent = session.injectClientPacket(packet.packet, packet.note);
    if (!sent.ok) return { ...sent, sessionId: session.id };
  }
  const message =
    packets.length === 1
      ? `Sent ${packets[0]?.note ?? packetBuild.note} through relay session ${session.id}.`
      : `Sent ${packetBuild.note} through relay session ${session.id} (${packets.length} packets).`;
  return { ok: true, message, sessionId: session.id };
}

function latestActiveSession(): OriginsRelaySession | null {
  const sessions = [...activeSessions.values()];
  return sessions[sessions.length - 1] ?? null;
}

function relayPacketFromControl(command: unknown):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: true; readonly packets: readonly { readonly packet: Buffer; readonly note: string }[]; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  if (!command || typeof command !== "object") return { ok: false, message: "Relay control command must be an object." };
  const record = command as Record<string, unknown>;
  if (record.scope === "gardening") return gardeningPacketFromControl(record);
  if (record.scope === "fishing") return fishingPacketFromControl(record);
  if (record.scope === "user") return userPacketFromControl(record);
  if (record.scope === "social") return socialPacketFromControl(record);
  if (record.scope === "room") return roomPacketFromControl(record);
  if (record.scope === "wallMover") return wallMoverPacketFromControl(record);
  if (record.scope === "furni") return furniPacketFromControl(record);
  if (record.scope === "mimic") return mimicPacketFromControl(record);
  if (record.scope === "packet") return pluginPacketFromControl(record);
  return { ok: false, message: "Relay control scope is not allowed." };
}

function gardeningPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildGardeningRelayPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet), note: result.note };
}

function userPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildUserRelayPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet), note: result.note };
}

function fishingPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildFishingRelayPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet), note: result.note };
}

function socialPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildSocialRelayPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet), note: result.note };
}

function roomPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packets: readonly { readonly packet: Buffer; readonly note: string }[]; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildRoomRelayPacketsFromControl(record);
  if (!result.ok) return result;
  return {
    ok: true,
    note: result.note,
    packets: result.packets.map((packet) => ({ packet: Buffer.from(packet.packet), note: packet.note })),
  };
}

function wallMoverPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildWallMoverRelayPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet), note: result.note };
}

function furniPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildFurniRelayPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet), note: result.note };
}

function pluginPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildShockwavePluginPacketFromControl(record);
  if (!result.ok) return result;
  return { ok: true, packet: Buffer.from(result.packet.packet), note: result.packet.note };
}

function mimicPacketFromControl(record: Record<string, unknown>):
  | { readonly ok: true; readonly packet: Buffer; readonly note: string }
  | { readonly ok: false; readonly message: string } {
  const result = buildMimicRelayPacketFromControl(record);
  if (!result.ok) return result;
  return {
    ok: true,
    packet: makePacket(result.packet.header, Buffer.from(result.packet.body)),
    note: result.packet.note,
  };
}

function parseControlInt(value: unknown, label: string): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string } {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isInteger(parsed)) return { ok: false, message: `Invalid relay ${label}: ${String(value ?? "")}.` };
  return { ok: true, value: parsed };
}

function encodeVl64(value: number): string {
  if (!Number.isInteger(value)) throw new Error(`VL64 value must be an integer: ${value}`);
  const negative = value < 0;
  let remaining = Math.abs(value);
  const bytes: number[] = [64 + (remaining & 0x03)];
  remaining = Math.floor(remaining / 4);
  while (remaining > 0) {
    bytes.push(64 + (remaining & 0x3f));
    remaining = Math.floor(remaining / 64);
  }
  if (bytes.length > 6) throw new Error(`VL64 value uses ${bytes.length} bytes; max supported is 6`);
  bytes[0] = bytes[0]! | (bytes.length << 3) | (negative ? 0x04 : 0);
  return String.fromCharCode(...bytes);
}

async function resolveUpstreamHost(settings: RelaySettings): Promise<string> {
  if (!settings.dnsBypassHosts || settings.tcpHost !== DEFAULT_TCP_HOST) return settings.tcpHost;

  try {
    const addresses = await dns.resolve4(settings.tcpHost);
    const publicAddress = addresses.find((address) => !isLocalAddress(address));
    return publicAddress ?? settings.tcpHost;
  } catch {
    return settings.tcpHost;
  }
}

function webSocketUpgradeResponse(key: string): string {
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  return [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n",
  ].join("\r\n");
}

function parseHttpHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r\n/).slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function drainWebSocketFrames(buffer: Buffer, handlers: WebSocketFrameHandlers): Buffer {
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      if (high !== 0) throw new Error("WebSocket frame is too large for the Origins relay");
      length = low;
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + length));
    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    if (opcode === 0x08) {
      handlers.close();
    } else if (opcode === 0x09) {
      handlers.pong(payload);
    } else if (opcode === 0x01 || opcode === 0x02) {
      handlers.data(payload);
    }

    offset += frameLength;
  }

  return buffer.subarray(offset);
}

function encodeWebSocketFrame(payload: Buffer, opcode: number): Buffer {
  const data = Buffer.from(payload);
  if (data.length <= 125) return Buffer.concat([Buffer.from([0x80 | opcode, data.length]), data]);
  if (data.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
    return Buffer.concat([header, data]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeUInt32BE(0, 2);
  header.writeUInt32BE(data.length, 6);
  return Buffer.concat([header, data]);
}

function onceConnect(socket: Socket): Promise<void> {
  return new Promise((resolveConnect, reject) => {
    const cleanup = (): void => {
      socket.off("connect", handleConnect);
      socket.off("error", handleError);
    };
    const handleConnect = (): void => {
      cleanup();
      resolveConnect();
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    socket.once("connect", handleConnect);
    socket.once("error", handleError);
  });
}

function safeBodySuffix(prefix: string, headerId: number, packet: Buffer, mode: BodyLoggingMode): string {
  if (mode !== "safe" || headerId < 0) return "";
  const bodyLength = Math.max(0, packet.length - 2);
  if (isSensitiveClientPacket(prefix, headerId)) return ` bodyStatus=redacted bodyLen=${bodyLength}`;

  const sample = escapedPacketBody(packet.subarray(2));
  return ` bodyStatus=sampled bodyLen=${bodyLength} bodySample=${JSON.stringify(sample)}`;
}

function isSensitiveClientPacket(prefix: string, headerId: number): boolean {
  if (!prefix.startsWith("browser -> official")) return false;
  return headerId === PACKETS.TRY_LOGIN || headerId === PACKETS.UNIQUEID || headerId === PACKETS.GENERATEKEY;
}

function escapedPacketBody(packetBody: Buffer): string {
  let sample = "";
  for (const byte of packetBody) {
    if (byte === 0x09) sample += "\\t";
    else if (byte === 0x0a) sample += "\\n";
    else if (byte === 0x0d) sample += "\\r";
    else if (byte === 0x5c) sample += "\\\\";
    else if (byte >= 0x20 && byte <= 0x7e) sample += String.fromCharCode(byte);
    else sample += `\\x${byte.toString(16).padStart(2, "0")}`;
  }
  return sample;
}

function readSafeOutgoingString(packet: Buffer): string {
  try {
    return readOutgoingString(packet).value;
  } catch {
    return "";
  }
}

function safeHeaderId(packet: Buffer): number {
  try {
    return packetHeaderId(packet);
  } catch {
    return -1;
  }
}

function readEnvString(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function parseBodyLoggingMode(value: string | undefined): BodyLoggingMode {
  return value === "safe" ? "safe" : "off";
}

function parsePort(value: number | string | undefined, fallback: number): number {
  const parsed =
    value === undefined || value === null || String(value).trim() === "" ? fallback : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) throw new Error(`Invalid port: ${value}`);
  return parsed;
}

function isLocalAddress(address: string): boolean {
  return address === "127.0.0.1" || address.startsWith("127.") || address === "0.0.0.0";
}

function resolveRelayResourceDir(): string {
  const resourceDir = readEnvString("ORIGINS_RELAY_RESOURCE_DIR");
  if (!resourceDir) throw new Error("ORIGINS_RELAY_RESOURCE_DIR must point to Shockless relay resources.");
  return resolve(resourceDir);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settings = normalizeRelayOptions();
  const server = createOriginsRelayServer(settings);
  const controlServer = createRelayControlServer(settings);
  server.listen(settings.wsPort, settings.wsHost, () => {
    console.log(`[origins-relay] listening ws://${settings.wsHost}:${settings.wsPort} -> ${settings.tcpHost}:${settings.tcpPort}`);
    console.log(`[origins-relay] gardening control listening tcp://${settings.controlHost}:${settings.controlPort}`);
    console.log("[origins-relay] browser side stays plaintext; official TCP side uses BobbaCrypto after SECRET_KEY");
    console.log("[origins-relay] Habbpy v4 safe packet body logging enabled only with ORIGINS_LOG_PACKET_BODIES=safe");
  });
  controlServer.listen(settings.controlPort, settings.controlHost);

  process.on("SIGINT", () => {
    controlServer.close();
    server.close(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    controlServer.close();
    server.close(() => process.exit(0));
  });
}
