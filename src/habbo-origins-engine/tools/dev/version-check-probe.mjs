#!/usr/bin/env node
import { once } from "node:events";

import { createOriginsRelayServer } from "../../standalone/resources/relay/origins-relay.mjs";
import {
  decodeHabboBase64Int,
  makePacket,
  packetHeaderId,
  prependClientLength,
  writeOutgoingString,
} from "../../standalone/resources/relay/shockwave-codec.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 12329;
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_BUILDS = "1128,1129-1160";

const builds = parseBuilds(process.argv[2] ?? process.env.ORIGINS_VERSION_PROBE_BUILDS ?? DEFAULT_BUILDS);
const port = positiveInt(process.env.ORIGINS_VERSION_PROBE_PORT, DEFAULT_PORT);
const timeoutMs = positiveInt(process.env.ORIGINS_VERSION_PROBE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

const server = createOriginsRelayServer({
  wsHost: DEFAULT_HOST,
  wsPort: port,
  quiet: true,
  logPackets: process.env.ORIGINS_LOG_PACKETS === "1",
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, DEFAULT_HOST, resolve);
});

const results = [];
try {
  for (const build of builds) {
    const result = await probeBuild(build, { port, timeoutMs });
    results.push(result);
    console.log(JSON.stringify(result));
    if (result.accepted) break;
  }
} finally {
  server.close();
}

const accepted = results.find((result) => result.accepted);
if (!accepted) {
  process.exitCode = 2;
}

async function probeBuild(build, options) {
  const ws = new WebSocket(`ws://${DEFAULT_HOST}:${options.port}`);
  const packets = [];
  let done = false;
  let accepted = false;
  let rejected = false;
  let error = null;
  let timer = null;

  const packetPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      done = true;
      resolve();
    }, options.timeoutMs);

    ws.addEventListener("message", async (event) => {
      const bytes = await bytesFromWebSocketData(event.data);
      for (const packet of splitServerFrames(bytes)) {
        const id = safePacketHeaderId(packet);
        const sample = packet.subarray(2, Math.min(packet.length, 80)).toString("latin1").replace(/\x02/g, "\\x02");
        packets.push({ id, length: packet.length, sample });
        if (id === 0) {
          ws.send(prependClientLength(makePacket(206)));
        } else if (id === 277) {
          ws.send(prependClientLength(makePacket(202, writeOutgoingString("relay-terminated"))));
        } else if (id === 1) {
          ws.send(prependClientLength(versionCheckPacket(build)));
          ws.send(prependClientLength(makePacket(6, writeOutgoingString("director-habbo-runtime"))));
          ws.send(prependClientLength(makePacket(181)));
        } else if (id === 33 && /Version not correct/i.test(sample)) {
          rejected = true;
          done = true;
          resolve();
        } else if (id === 257) {
          accepted = true;
          done = true;
          resolve();
        }
      }
    });

    ws.addEventListener("error", () => {
      error = "websocket error";
      done = true;
      resolve();
    });

    ws.addEventListener("close", () => {
      if (!done) {
        done = true;
        resolve();
      }
    });
  });

  await once(ws, "open");
  await packetPromise;
  if (timer) clearTimeout(timer);
  ws.close();

  return {
    build,
    accepted,
    rejected,
    error,
    packetIds: packets.map((packet) => packet.id),
    packets: packets.slice(0, 12),
  };
}

function versionCheckPacket(build) {
  return makePacket(
    5,
    Buffer.concat([
      Buffer.from(encodeVl64(build), "latin1"),
      writeOutgoingString("2"),
      writeOutgoingString("external_variables.txt"),
    ]),
  );
}

function encodeVl64(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid positive VL64 value: ${value}`);
  let remaining = value;
  const bytes = [64 + (remaining & 0x03)];
  remaining = Math.floor(remaining / 4);
  while (remaining > 0) {
    bytes.push(64 + (remaining & 0x3f));
    remaining = Math.floor(remaining / 64);
  }
  bytes[0] = bytes[0] | (bytes.length << 3);
  return String.fromCharCode(...bytes);
}

async function bytesFromWebSocketData(data) {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof Blob !== "undefined" && data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  if (typeof data === "string") return Buffer.from(data, "latin1");
  return Buffer.from(data);
}

function splitServerFrames(bytes) {
  const packets = [];
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

function safePacketHeaderId(packet) {
  try {
    return packetHeaderId(packet);
  } catch {
    return -1;
  }
}

function parseBuilds(value) {
  const result = [];
  for (const part of String(value).split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = /^(\d+)-(\d+)$/.exec(trimmed);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let build = start; build <= end; build += 1) result.push(build);
      continue;
    }
    result.push(Number(trimmed));
  }
  return [...new Set(result)].filter((build) => Number.isSafeInteger(build) && build > 0);
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
