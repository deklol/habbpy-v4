#!/usr/bin/env node
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const config = JSON.parse(readFileSync(path.join(repoRoot, "engine.config.json"), "utf8"));
const args = parseArgs(process.argv.slice(2));
const version = normalizeVersion(args.version ?? "release306");
const runtimeDataRoot = path.resolve(args.runtimeDataRoot ?? config.runtimeDataRoot);
const sourceRoot = path.resolve(args.sourceRoot ?? config.originsSourceRoot);
const donorAssetRoot = path.resolve(args.donorAssetRoot ?? config.decodedAssetsRoot);
const outRoot = path.resolve(args.outRoot ?? path.join(repoRoot, "generated/assets"));
const casts = new Set(
  String(args.casts ?? "")
    .split(",")
    .map((value) => normalizeName(value.trim()))
    .filter(Boolean),
);
const force = args.force === "1" || args.force === "true";

const manifestPath = path.join(runtimeDataRoot, `external-bitmap-assets.${version}.json`);
const manifest = readJson(manifestPath);
const release = releaseFor(manifest, version);
const assets = release.assets ?? [];
let considered = 0;
let written = 0;
let skippedValid = 0;
let skippedUnsupported = 0;
const failures = [];

for (const asset of assets) {
  if (casts.size > 0 && !casts.has(normalizeName(asset.castName))) continue;
  considered += 1;
  const targetPath = path.resolve(outRoot, stripGeneratedAssetsPrefix(asset.pngPath));
  const donorPath = path.resolve(donorAssetRoot, stripGeneratedAssetsPrefix(asset.pngPath));
  if (!force && pngLooksValid(targetPath)) {
    skippedValid += 1;
    continue;
  }
  if (!force && pngLooksValid(donorPath)) {
    skippedValid += 1;
    continue;
  }

  try {
    const decoded = decodeAsset(asset);
    if (!decoded) {
      skippedUnsupported += 1;
      continue;
    }
    writePng(targetPath, decoded.width, decoded.height, decoded.rgba);
    written += 1;

    if (asset.inkAssetPaths && decoded.paletteIndices) {
      const ink36Path = asset.inkAssetPaths["36"]
        ? path.resolve(outRoot, stripGeneratedAssetsPrefix(asset.inkAssetPaths["36"]))
        : null;
      if (ink36Path) {
        writePng(ink36Path, decoded.width, decoded.height, applyPaletteIndexColorKey(decoded.rgba, decoded.paletteIndices, 0));
      }
      const ink8Path = asset.inkAssetPaths["8"]
        ? path.resolve(outRoot, stripGeneratedAssetsPrefix(asset.inkAssetPaths["8"]))
        : null;
      if (ink8Path) {
        writePng(
          ink8Path,
          decoded.width,
          decoded.height,
          applyExactWhiteMatteCoverage(decoded.rgba),
        );
      }
    }
  } catch (error) {
    failures.push({
      castName: asset.castName,
      member: asset.member,
      memberName: asset.memberName,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

console.log(`Materialized ${written} ${version} external bitmap asset(s)`);
console.log(`Considered ${considered}, skipped valid ${skippedValid}, skipped unsupported ${skippedUnsupported}`);
if (failures.length > 0) {
  console.log(`Failures ${failures.length}`);
  for (const failure of failures.slice(0, 20)) {
    console.log(`${failure.castName} #${failure.member} ${failure.memberName}: ${failure.message}`);
  }
  if (failures.length > 20) console.log(`... ${failures.length - 20} more`);
  process.exitCode = 1;
}

function decodeAsset(asset) {
  if (![1, 2, 4, 8, 32].includes(asset.bitDepth)) return null;
  if (!asset.sourceBitdPath) return null;
  const bitdPath = sourcePath(asset.sourceBitdPath);
  if (!existsSync(bitdPath)) return null;

  const width = asset.width;
  const height = asset.height;
  const pitch = asset.pitch > 0 ? asset.pitch : Math.ceil((width * asset.bitDepth) / 8);
  const sourceBytes = readFileSync(bitdPath);
  const expectedBytes = pitch * height;
  const compressed = sourceBytes.length < expectedBytes;
  const decodedSource = compressed ? decompressPackBits(sourceBytes, expectedBytes) : sourceBytes.subarray(0, expectedBytes);
  const rgba = Buffer.alloc(width * height * 4);

  if (asset.bitDepth === 32) {
    decode32BitRgba(decodedSource, rgba, width, height, pitch, asset.alphaPolicy === "native-32-bit-alpha", compressed);
    return { width, height, rgba, paletteIndices: null };
  }

  const palette = resolvePalette(asset);
  if (!palette) return null;
  const paletteIndices = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const paletteIndex = readPaletteIndex(decodedSource, asset.bitDepth, pitch, x, y);
      paletteIndices[y * width + x] = paletteIndex;
      const color = palette[paletteIndex] ?? { r: 0, g: 0, b: 0 };
      const dest = (y * width + x) * 4;
      rgba[dest] = color.r;
      rgba[dest + 1] = color.g;
      rgba[dest + 2] = color.b;
      rgba[dest + 3] = 255;
    }
  }
  return { width, height, rgba, paletteIndices };
}

function resolvePalette(asset) {
  if (!asset.paletteChunkPath) {
    const normalized = normalizeName(asset.paletteName);
    if (normalized === "systemmac") return createSystemMacPalette();
    if (normalized === "grayscale") return createGrayscalePalette();
    return null;
  }
  const palettePath = sourcePath(asset.paletteChunkPath);
  if (!existsSync(palettePath)) return null;
  const bytes = readFileSync(palettePath);
  const colors = [];
  for (let offset = 0; offset + 5 < bytes.length; offset += 6) {
    colors.push({
      r: toByte(bytes.readUInt16BE(offset)),
      g: toByte(bytes.readUInt16BE(offset + 2)),
      b: toByte(bytes.readUInt16BE(offset + 4)),
    });
  }
  return colors;
}

function sourcePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const prefix = `extracted/projectorrays/${version}/`;
  if (normalized.startsWith(prefix)) {
    return path.join(sourceRoot, normalized.slice(prefix.length));
  }
  return path.resolve(repoRoot, relativePath);
}

function pngLooksValid(filePath) {
  if (!existsSync(filePath)) return false;
  const size = statSync(filePath).size;
  if (size < 33) return false;
  const bytes = readFileSync(filePath, { encoding: null, flag: "r" }).subarray(0, 8);
  return bytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function writePng(filePath, width, height, rgba) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, encodePngRgba(width, height, rgba));
}

function stripGeneratedAssetsPrefix(assetPath) {
  return assetPath.replace(/^generated[\\/]+assets[\\/]+/i, "");
}

function readPaletteIndex(source, bitDepth, pitch, x, y) {
  const rowOffset = y * pitch;
  switch (bitDepth) {
    case 1: {
      const byte = source[rowOffset + (x >> 3)] ?? 0;
      return (byte >> (7 - (x & 7))) & 1;
    }
    case 2: {
      const byte = source[rowOffset + (x >> 2)] ?? 0;
      const value = (byte >> (6 - ((x & 3) * 2))) & 0x03;
      return value;
    }
    case 4: {
      const byte = source[rowOffset + (x >> 1)] ?? 0;
      const value = (x & 1) === 0 ? (byte >> 4) & 0x0f : byte & 0x0f;
      return value;
    }
    case 8:
      return source[rowOffset + x] ?? 0;
    default:
      return 0;
  }
}

function decode32BitRgba(source, rgba, width, height, pitch, useAlpha, compressed) {
  const scanWidth = Math.max(width, Math.floor((pitch * 8) / 32));
  for (let y = 0; y < height; y += 1) {
    const lineOffset = y * pitch;
    for (let x = 0; x < width; x += 1) {
      const dest = (y * width + x) * 4;
      if (compressed) {
        const alphaIndex = lineOffset + x;
        const redIndex = lineOffset + scanWidth + x;
        const greenIndex = lineOffset + scanWidth * 2 + x;
        const blueIndex = lineOffset + scanWidth * 3 + x;
        rgba[dest] = source[redIndex] ?? 0;
        rgba[dest + 1] = source[greenIndex] ?? 0;
        rgba[dest + 2] = source[blueIndex] ?? 0;
        rgba[dest + 3] = useAlpha ? source[alphaIndex] ?? 255 : 255;
      } else {
        const sourceIndex = lineOffset + x * 4;
        rgba[dest] = source[sourceIndex + 1] ?? 0;
        rgba[dest + 1] = source[sourceIndex + 2] ?? 0;
        rgba[dest + 2] = source[sourceIndex + 3] ?? 0;
        rgba[dest + 3] = useAlpha ? source[sourceIndex] ?? 255 : 255;
      }
    }
  }
}

function decompressPackBits(source, expectedBytes) {
  const output = Buffer.alloc(expectedBytes);
  let sourceOffset = 0;
  let outputOffset = 0;
  while (sourceOffset < source.length && outputOffset < expectedBytes) {
    const control = source[sourceOffset++] ?? 0;
    if (control < 0x80) {
      const count = control + 1;
      for (let index = 0; index < count && sourceOffset < source.length && outputOffset < expectedBytes; index += 1) {
        output[outputOffset++] = source[sourceOffset++] ?? 0;
      }
    } else if (control > 0x80) {
      const count = 257 - control;
      const value = source[sourceOffset++] ?? 0;
      for (let index = 0; index < count && outputOffset < expectedBytes; index += 1) {
        output[outputOffset++] = value;
      }
    }
  }
  return output;
}

function applyPaletteIndexColorKey(rgba, paletteIndices, transparentIndex) {
  const output = Buffer.from(rgba);
  for (let index = 0; index < paletteIndices.length; index += 1) {
    if (paletteIndices[index] === transparentIndex) output[index * 4 + 3] = 0;
  }
  return output;
}

function applyExactWhiteMatteCoverage(rgba) {
  const output = Buffer.from(rgba);
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue;
    if (output[offset] === 255 && output[offset + 1] === 255 && output[offset + 2] === 255) {
      output[offset + 3] = 0;
    } else {
      output[offset + 3] = 255;
    }
  }
  return output;
}

function encodePngRgba(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (stride + 1);
    scanlines[target] = 0;
    rgba.copy(scanlines, target + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createSystemMacPalette() {
  const colors = [];
  const cube = [255, 204, 153, 102, 51, 0];
  for (const r of cube) {
    for (const g of cube) {
      for (const b of cube) {
        if (r !== 0 || g !== 0 || b !== 0) colors.push({ r, g, b });
      }
    }
  }
  const ramps = [238, 221, 187, 170, 136, 119, 85, 68, 34, 17];
  for (const r of ramps) colors.push({ r, g: 0, b: 0 });
  for (const g of ramps) colors.push({ r: 0, g, b: 0 });
  for (const b of ramps) colors.push({ r: 0, g: 0, b });
  for (const value of ramps) colors.push({ r: value, g: value, b: value });
  colors.push({ r: 0, g: 0, b: 0 });
  return colors;
}

function createGrayscalePalette() {
  return Array.from({ length: 256 }, (_, index) => {
    const value = 255 - index;
    return { r: value, g: value, b: value };
  });
}

function toByte(value) {
  return Math.max(0, Math.min(255, Math.round(value / 257)));
}

function increment(counts, value) {
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

function releaseFor(data, wantedVersion) {
  const releases = data.releases ?? [];
  return releases.find((entry) => normalizeVersion(entry.versionId ?? entry.release ?? "") === wantedVersion) ?? releases[0] ?? data;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    parsed[rawKey] = inlineValue ?? argv[++index] ?? "1";
  }
  return parsed;
}

function normalizeVersion(value) {
  const raw = String(value);
  return raw.startsWith("release") ? raw : `release${raw}`;
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/\.(cct|cst)$/i, "");
}
