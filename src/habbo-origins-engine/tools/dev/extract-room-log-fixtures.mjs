#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const logsRoot = path.resolve(args.logsRoot ?? process.env.HABBO_LOGS_ROOT ?? path.join(process.cwd(), "logs"));
const outPath = args.out ? path.resolve(args.out) : undefined;
const limit = Number(args.limit ?? 200);
const nameFilter = normalize(args.name ?? "");
const since = args.since ? new Date(args.since).getTime() : 0;

if (!existsSync(logsRoot)) throw new Error(`Log root not found: ${logsRoot}`);

const files = readdirSync(logsRoot)
  .filter((name) => /\.(log|txt|json)$/i.test(name))
  .map((name) => {
    const fullPath = path.join(logsRoot, name);
    const stat = statSync(fullPath);
    return { fullPath, name, mtimeMs: stat.mtimeMs, size: stat.size };
  })
  .filter((file) => !since || file.mtimeMs >= since)
  .sort((left, right) => right.mtimeMs - left.mtimeMs);

const visits = [];
for (const file of files) {
  const text = readFileSync(file.fullPath, "utf8");
  let pending = undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.includes("[SERVER] FLATINFO [54]")) {
      pending = parseFlatInfo(line, file);
      continue;
    }
    if (line.includes("[SERVER] ROOM_READY [69]")) {
      const ready = parseRoomReady(line);
      if (!pending) pending = { log: file.name, logPath: file.fullPath, time: lineTime(line), properties: {} };
      pending.model = ready.model ?? pending.model;
      pending.flatId = ready.flatId ?? pending.flatId;
      pending.readyLine = line.trim();
      pending.properties = pending.properties ?? {};
      visits.push(pending);
      continue;
    }
    if (line.includes("[SERVER] FLATPROPERTY [46]")) {
      const property = parseFlatProperty(line);
      const visit = visits[visits.length - 1] ?? pending;
      if (visit && property) {
        visit.properties = visit.properties ?? {};
        visit.properties[property.kind] = property.value;
      }
      continue;
    }
    if (line.includes("[SERVER] ACTIVEOBJECTS [32]")) {
      const visit = visits[visits.length - 1] ?? pending;
      if (visit) visit.activeObjectsLine = line.trim();
      continue;
    }
    if (line.includes("[SERVER] ITEMS [45]")) {
      const visit = visits[visits.length - 1] ?? pending;
      if (visit) visit.wallItemsLine = line.trim();
    }
  }
}

const filtered = visits
  .filter((visit) => !nameFilter || normalize(`${visit.roomName ?? ""} ${visit.owner ?? ""} ${visit.model ?? ""} ${visit.flatId ?? ""}`).includes(nameFilter))
  .slice(0, limit)
  .map((visit) => ({
    time: visit.time,
    log: visit.log,
    flatId: visit.flatId,
    model: visit.model,
    owner: visit.owner,
    roomName: visit.roomName,
    description: visit.description,
    properties: visit.properties ?? {},
    hasActiveObjects: Boolean(visit.activeObjectsLine),
    hasWallItems: Boolean(visit.wallItemsLine),
  }));

const output = {
  generatedAt: new Date().toISOString(),
  logsRoot,
  fileCount: files.length,
  totalVisits: visits.length,
  count: filtered.length,
  visits: filtered,
};

const json = `${JSON.stringify(output, null, 2)}\n`;
if (outPath) {
  writeFileSync(outPath, json, "utf8");
  console.log(outPath);
} else {
  process.stdout.write(json);
}

function parseFlatInfo(line, file) {
  const payload = payloadAfterSize(line);
  const parts = payload.split("[2]");
  const modelIndex = parts.findIndex((part) => /model_[a-z]|exterior_[a-z]/i.test(part));
  const model = modelIndex >= 0 ? parts[modelIndex].match(/(model_[a-z]|exterior_[a-z])/i)?.[1] : undefined;
  const owner = modelIndex > 0 ? trailingName(parts[modelIndex - 1]) : undefined;
  return {
    log: file.name,
    logPath: file.fullPath,
    time: lineTime(line),
    owner,
    model,
    roomName: modelIndex >= 0 ? cleanText(parts[modelIndex + 1]) : undefined,
    description: modelIndex >= 0 ? cleanText(parts[modelIndex + 2]) : undefined,
    properties: {},
    flatInfoLine: line.trim(),
  };
}

function parseRoomReady(line) {
  const payload = payloadAfterSize(line);
  const match = payload.match(/(model_[a-z]|exterior_[a-z])\s+(\d+)/i);
  return { model: match?.[1], flatId: match?.[2] };
}

function parseFlatProperty(line) {
  const payload = payloadAfterSize(line);
  const match = payload.match(/(wallpaper|floor|landscape|landscapeanim)\/([^\s\x01\[]+)/i);
  if (!match) return undefined;
  return { kind: match[1].toLowerCase(), value: match[2] };
}

function payloadAfterSize(line) {
  const index = line.indexOf(")  ");
  return index >= 0 ? line.slice(index + 3).trim() : line.trim();
}

function lineTime(line) {
  const match = line.match(/^(\d\d:\d\d:\d\d)/);
  return match?.[1];
}

function trailingName(value) {
  const cleaned = cleanText(value);
  const match = cleaned.match(/([A-Za-z0-9_. -]{2,})$/);
  return match?.[1]?.trim();
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\[(\d+)\]/g, "")
    .replace(/[^\x20-\x7e]+/g, "")
    .trim();
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseArgs(raw) {
  const parsed = {};
  for (let index = 0; index < raw.length; index += 1) {
    const arg = raw[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = raw[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "1";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
