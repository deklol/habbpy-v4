import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const standaloneRoot = fileURLToPath(new URL("..", import.meta.url));

describe("external bitmap asset materializer", () => {
  it("preserves packed 4-bit Director palette indexes and recovers local unkeyed CLUTs", () => {
    const root = tempRoot("external-4bit-palette");
    try {
      const sourceRoot = join(root, "source");
      const runtimeDataRoot = join(root, "runtime-data");
      const assetRoot = join(root, "assets", "external-bitmaps");
      const chunksRoot = join(sourceRoot, "hh_test", "chunks");
      mkdirSync(chunksRoot, { recursive: true });
      mkdirSync(runtimeDataRoot, { recursive: true });

      writeFileSync(
        join(chunksRoot, "KEY_-3.bin"),
        reversedLittleEndianKeyChunk([
          { sectionID: 20, castID: 100, fourCC: "BITD" },
        ]),
      );
      writeFileSync(join(chunksRoot, "CASt-100.json"), JSON.stringify({ type: 1, info: { name: "poster_test" } }));
      writeFileSync(join(chunksRoot, "CASt-100.bin"), bitmapCastChunk({ width: 2, height: 1, pitch: 1, bitDepth: 4, paletteMemberNumber: 2 }));
      writeFileSync(join(chunksRoot, "CASt-200.json"), JSON.stringify({ type: 4, info: { name: "poster_palette" } }));
      writeFileSync(join(chunksRoot, "BITD-20.bin"), Buffer.from([0x12]));
      writeFileSync(join(chunksRoot, "CLUT-21.bin"), paletteChunk([
        0xffffff,
        0xff0000,
        0x00ff00,
        0x0000ff,
      ]));
      writeFileSync(
        join(runtimeDataRoot, "external-cast-graph.release999.json"),
        JSON.stringify({
          releases: [
            {
              versionId: "release999",
              casts: [
                {
                  name: "hh_test",
                  order: 1,
                  resolved: true,
                  expectedExtractionRoot: join(sourceRoot, "hh_test"),
                  members: [
                    { number: 1, name: "poster_test", type: "bitmap", memberChunkId: 100 },
                    { number: 2, name: "poster_palette", type: "palette", memberChunkId: 200 },
                  ],
                },
              ],
            },
          ],
        }),
      );

      const outPath = join(root, "external-bitmap-assets.release999.json");
      const result = spawnSync(
        process.execPath,
        [
          join(standaloneRoot, "resources", "extraction", "decode-external-cast-bitmaps.mjs"),
          "--version",
          "release999",
          "--external-cast-graph",
          join(runtimeDataRoot, "external-cast-graph.release999.json"),
          "--asset-root",
          assetRoot,
          "--asset-path-base",
          join(root, "assets"),
          "--out",
          outPath,
        ],
        { cwd: standaloneRoot, encoding: "utf8" },
      );

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${String(result.error ?? "")}`);
      const release = JSON.parse(readFileSync(outPath, "utf8")).releases[0];
      assert.equal(release.unsupportedCount, 0);
      const asset = release.assets.find((entry: Record<string, unknown>) => entry.memberName === "poster_test");
      assert.deepEqual([...Buffer.from(asset.paletteIndexData, "base64")], [1, 2]);
      assert.equal(asset.paletteColors[1], 0xff0000);
      assert.equal(asset.paletteColors[2], 0x00ff00);
      assert.equal(existsSync(join(root, "assets", asset.pngPath)), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("decodes Director built-in systemWin palette ids with native color order", () => {
    const root = tempRoot("external-systemwin-palette");
    try {
      const sourceRoot = join(root, "source");
      const runtimeDataRoot = join(root, "runtime-data");
      const assetRoot = join(root, "assets", "external-bitmaps");
      const chunksRoot = join(sourceRoot, "hh_test", "chunks");
      mkdirSync(chunksRoot, { recursive: true });
      mkdirSync(runtimeDataRoot, { recursive: true });

      writeFileSync(
        join(chunksRoot, "KEY_-3.bin"),
        reversedLittleEndianKeyChunk([
          { sectionID: 20, castID: 100, fourCC: "BITD" },
        ]),
      );
      writeFileSync(join(chunksRoot, "CASt-100.json"), JSON.stringify({ type: 1, info: { name: "system_win_test" } }));
      writeFileSync(join(chunksRoot, "CASt-100.bin"), bitmapCastChunk({ width: 1, height: 1, pitch: 1, bitDepth: 8, paletteMemberNumber: -101 }));
      writeFileSync(join(chunksRoot, "BITD-20.bin"), Buffer.from([8]));
      writeFileSync(
        join(runtimeDataRoot, "external-cast-graph.release999.json"),
        JSON.stringify({
          releases: [
            {
              versionId: "release999",
              casts: [
                {
                  name: "hh_test",
                  order: 1,
                  resolved: true,
                  expectedExtractionRoot: join(sourceRoot, "hh_test"),
                  members: [
                    { number: 1, name: "system_win_test", type: "bitmap", memberChunkId: 100 },
                  ],
                },
              ],
            },
          ],
        }),
      );

      const outPath = join(root, "external-bitmap-assets.release999.json");
      const result = spawnSync(
        process.execPath,
        [
          join(standaloneRoot, "resources", "extraction", "decode-external-cast-bitmaps.mjs"),
          "--version",
          "release999",
          "--external-cast-graph",
          join(runtimeDataRoot, "external-cast-graph.release999.json"),
          "--asset-root",
          assetRoot,
          "--asset-path-base",
          join(root, "assets"),
          "--out",
          outPath,
        ],
        { cwd: standaloneRoot, encoding: "utf8" },
      );

      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${String(result.error ?? "")}`);
      const release = JSON.parse(readFileSync(outPath, "utf8")).releases[0];
      assert.equal(release.unsupportedCount, 0);
      const asset = release.assets.find((entry: Record<string, unknown>) => entry.memberName === "system_win_test");
      assert.equal(asset.paletteName, "systemWin");
      assert.equal(asset.paletteChunkPath, "builtin/systemWin");
      assert.deepEqual([...Buffer.from(asset.paletteIndexData, "base64")], [8]);
      assert.equal(asset.paletteColors[8], 0xa0a0a4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function tempRoot(name: string): string {
  const root = join(tmpdir(), `habbo-origins-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function reversedLittleEndianKeyChunk(entries: Array<{ sectionID: number; castID: number; fourCC: string }>): Buffer {
  const buffer = Buffer.alloc(12 + entries.length * 12);
  for (const [index, entry] of entries.entries()) {
    const offset = 12 + index * 12;
    buffer.writeUInt32LE(entry.sectionID, offset);
    buffer.writeUInt32LE(entry.castID, offset + 4);
    buffer.write([...entry.fourCC].reverse().join(""), offset + 8, 4, "latin1");
  }
  return buffer;
}

function bitmapCastChunk(options: { width: number; height: number; pitch: number; bitDepth: number; paletteMemberNumber: number }): Buffer {
  const specific = Buffer.alloc(28);
  specific.writeUInt16BE(0x8000 | options.pitch, 0);
  specific.writeInt16BE(0, 2);
  specific.writeInt16BE(0, 4);
  specific.writeInt16BE(options.height, 6);
  specific.writeInt16BE(options.width, 8);
  specific.writeUInt8(1, 10);
  specific.writeInt16BE(0, 18);
  specific.writeInt16BE(0, 20);
  specific.writeUInt8(options.bitDepth, 23);
  specific.writeInt16BE(0, 24);
  specific.writeInt16BE(options.paletteMemberNumber, 26);

  const header = Buffer.alloc(12);
  header.writeUInt32BE(0, 4);
  header.writeUInt32BE(specific.length, 8);
  return Buffer.concat([header, specific]);
}

function paletteChunk(colors: number[]): Buffer {
  const expanded = [...colors];
  while (expanded.length < 16) expanded.push(0);

  const buffer = Buffer.alloc(expanded.length * 6);
  for (const [index, rgb] of expanded.entries()) {
    const offset = index * 6;
    buffer.writeUInt16BE(((rgb >> 16) & 0xff) * 257, offset);
    buffer.writeUInt16BE(((rgb >> 8) & 0xff) * 257, offset + 2);
    buffer.writeUInt16BE((rgb & 0xff) * 257, offset + 4);
  }
  return buffer;
}
