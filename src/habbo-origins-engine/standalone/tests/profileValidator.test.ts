import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PROFILE_RUNTIME_DATA_SCHEMA_VERSION } from "../src/common/types.js";
import { validateProfileContract } from "../src/main/profileValidator.js";

describe("profile compiler validator", () => {
  it("accepts a complete minimal Director profile contract", () => {
    const root = createProfileFixture();
    try {
      const report = validateFixture(root);
      assert.equal(report.ready, true);
      assert.equal(report.issues.filter((issue) => issue.severity === "error").length, 0);
      assert.equal(report.inventory.assetReferences, 1);
      assert.equal(report.inventory.assetFilesReady, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when materialized bitmap metadata drops Director registration state", () => {
    const root = createProfileFixture({
      externalAssetPatch: {
        regPoint: undefined,
      },
    });
    try {
      const report = validateFixture(root);
      assert.equal(report.ready, false);
      assert.ok(report.issues.some((issue) => issue.code === "bitmap-director-metadata" && issue.severity === "error"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails when a referenced bitmap PNG is missing", () => {
    const root = createProfileFixture({ omitPng: true });
    try {
      const report = validateFixture(root);
      assert.equal(report.ready, false);
      assert.ok(report.issues.some((issue) => issue.code === "materialized-assets" && issue.severity === "error"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("surfaces partial exterior visual layout coverage as a warning without disabling launch", () => {
    const root = createProfileFixture({
      visualRecord: {
        visualName: "exterior_z",
        memberName: "exterior_z.visual",
        bitmapElementCount: 3,
        assetIds: ["release320:test:1"],
      },
      visualIndexRecord: {
        visualName: "exterior_z",
        memberName: "exterior_z.visual",
        bitmapReferences: [
          visualBitmapReference(1, "ready_piece"),
          visualBitmapReference(2, "missing_piece", { bitDepth: 32, bitdExists: false, bitdBytes: 0 }),
        ],
        unresolvedReferences: [],
      },
    });
    try {
      const report = validateFixture(root);
      assert.equal(report.ready, true);
      assert.ok(report.issues.some((issue) => issue.code === "exterior-visual-layout-coverage" && issue.severity === "warning"));
      assert.equal(report.diagnostics.visualLayoutClosure.exteriorPartialLayouts, 1);
      assert.equal(report.diagnostics.visualLayoutClosure.gaps[0]?.missingBitmapReferences[0]?.memberName, "missing_piece");
      assert.equal(report.diagnostics.visualLayoutClosure.gaps[0]?.missingBitmapReferences[0]?.reason, "missing-bitd");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("groups unsupported bitmap extraction records by source reason", () => {
    const root = createProfileFixture({
      externalUnsupported: [
        { castName: "test", memberName: "missing_bitd_a", reason: "BITD path is missing" },
        { castName: "test", memberName: "missing_bitd_b", reason: "BITD path is missing" },
        { castName: "test", memberName: "bad_palette", reason: "palette -102 did not resolve" },
      ],
    });
    try {
      const report = validateFixture(root);
      assert.equal(report.ready, true);
      assert.equal(report.diagnostics.unsupportedBitmapRecords.total, 3);
      assert.deepEqual(
        report.diagnostics.unsupportedBitmapRecords.byReason.map((entry) => [entry.reason, entry.count]),
        [
          ["BITD path is missing", 2],
          ["palette -102 did not resolve", 1],
        ],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks missing visual bitmap references as recoverable when Director BITD source exists", () => {
    const root = createProfileFixture({
      visualRecord: {
        visualName: "exterior_recoverable",
        memberName: "exterior_recoverable.visual",
        bitmapElementCount: 2,
        assetIds: ["release320:test:1"],
      },
      visualIndexRecord: {
        visualName: "exterior_recoverable",
        memberName: "exterior_recoverable.visual",
        bitmapReferences: [
          visualBitmapReference(1, "ready_piece", {}, 100),
          visualBitmapReference(2, "recoverable_piece", { width: 2, height: 1, bitDepth: 8, pitch: 2, bitdExists: false, bitdBytes: 0 }, 200),
        ],
        unresolvedReferences: [],
      },
    });
    try {
      writeRecoverableBitd(root, 20, 2);
      const report = validateFixture(root);
      const missing = report.diagnostics.visualLayoutClosure.gaps[0]?.missingBitmapReferences[0];
      assert.equal(report.ready, true);
      assert.ok(report.issues.some((issue) => issue.code === "recoverable-visual-layout-assets" && issue.severity === "warning"));
      assert.equal(missing?.memberName, "recoverable_piece");
      assert.equal(missing?.reason, "recoverable-bitd:orphan-raw-exact-length");
      assert.equal(missing?.sourceRecovery?.sectionID, 20);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function validateFixture(root: string) {
  return validateProfileContract({
    versionId: "release320",
    runtimeDataRoot: join(root, "runtime-data"),
    assetsRoot: join(root, "assets"),
    scriptsRoot: join(root, "scripts"),
    extractedRoot: join(root, "extracted", "projectorrays"),
    runtimeDataSchemaVersion: PROFILE_RUNTIME_DATA_SCHEMA_VERSION,
  });
}

function createProfileFixture(
  options: {
    readonly omitPng?: boolean;
    readonly externalAssetPatch?: Record<string, unknown>;
    readonly externalUnsupported?: Record<string, unknown>[];
    readonly visualRecord?: Record<string, unknown>;
    readonly visualIndexRecord?: Record<string, unknown>;
  } = {},
): string {
  const root = join(tmpdir(), `hoe-profile-validator-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const runtimeDataRoot = join(root, "runtime-data");
  const assetsRoot = join(root, "assets");
  const scriptsRoot = join(root, "scripts");
  const extractedRoot = join(root, "extracted", "projectorrays", "test", "casts", "External");
  mkdirSync(runtimeDataRoot, { recursive: true });
  mkdirSync(assetsRoot, { recursive: true });
  mkdirSync(scriptsRoot, { recursive: true });
  mkdirSync(extractedRoot, { recursive: true });
  writeFileSync(join(extractedRoot, "ParentScript 1 - Test Class.ls"), "on test me\nend\n", "utf8");
  writeFileSync(
    join(scriptsRoot, "profile-script-registry.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), versionId: "release320", scripts: [{ sourcePath: "test/casts/External/ParentScript 1 - Test Class.ls" }] }, null, 2)}\n`,
    "utf8",
  );

  const pngPath = "generated/assets/external-bitmaps/release320/test/0001-test.png";
  if (!options.omitPng) {
    const fullPng = join(assetsRoot, "external-bitmaps", "release320", "test", "0001-test.png");
    mkdirSync(join(fullPng, ".."), { recursive: true });
    writeFileSync(fullPng, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]));
  }

  const asset = {
    id: "release320:test:1",
    castName: "test",
    member: 1,
    memberName: "test",
    mediaType: "bitmap",
    width: 1,
    height: 1,
    bitDepth: 8,
    pitch: 1,
    regPoint: { x: 0, y: 0 },
    initialRect: { left: 0, top: 0, right: 1, bottom: 1 },
    paletteColors: [0, 16777215],
    paletteIndexData: "AA==",
    pngPath,
    ...options.externalAssetPatch,
  };
  const visualRecord = options.visualRecord ?? {
    visualName: "complete_visual",
    memberName: "complete.visual",
    bitmapElementCount: 1,
    assetIds: ["release320:test:1"],
  };
  const visualIndexRecord = options.visualIndexRecord ?? {
    visualName: String(visualRecord.visualName ?? "complete_visual"),
    memberName: String(visualRecord.memberName ?? "complete.visual"),
    bitmapReferences: [visualBitmapReference(1, "test")],
    unresolvedReferences: [],
  };

  writeJson(join(runtimeDataRoot, "release320-projectorrays-manifest.json"), { releases: [{ versionId: "release320" }] });
  writeJson(join(runtimeDataRoot, "projectorrays-text-fields.release320.json"), { releases: [{ versionId: "release320", fields: [] }] });
  writeJson(join(runtimeDataRoot, "external-cast-text-fields.release320.json"), { releases: [{ versionId: "release320", fields: [] }] });
  writeJson(join(runtimeDataRoot, "external-cast-graph.release320.json"), {
    releases: [{ versionId: "release320", casts: [{ name: "test", resolved: true, members: [{ number: 1, name: "test", type: "bitmap" }] }] }],
  });
  writeJson(join(runtimeDataRoot, "external-bitmap-assets.release320.json"), {
    releases: [{ versionId: "release320", assets: [asset], unsupported: options.externalUnsupported ?? [] }],
  });
  writeJson(join(runtimeDataRoot, "visual-bitmap-assets.release320.json"), {
    releases: [
      {
        versionId: "release320",
        assets: [asset],
        unsupported: [],
        visuals: [visualRecord],
      },
    ],
  });
  writeJson(join(runtimeDataRoot, "external-cast-visual-layout-index.release320.json"), {
    releases: [{ versionId: "release320", visuals: [visualIndexRecord] }],
  });
  return root;
}

function visualBitmapReference(
  member: number,
  memberName: string,
  bitmapPatch: Record<string, unknown> = {},
  memberChunkId = member,
): Record<string, unknown> {
  return {
    castName: "test",
    member,
    memberChunkId,
    memberName,
    memberType: "bitmap",
    bitmap: {
      bitDepth: 8,
      bitdExists: true,
      bitdBytes: 12,
      paletteId: -1,
      ...bitmapPatch,
    },
  };
}

function writeRecoverableBitd(root: string, sectionId: number, expectedBytes: number): void {
  const chunksRoot = join(root, "extracted", "projectorrays", "test", "chunks");
  mkdirSync(chunksRoot, { recursive: true });
  writeFileSync(join(chunksRoot, "KEY_-3.bin"), Buffer.alloc(12));
  writeFileSync(join(chunksRoot, `BITD-${sectionId}.bin`), Buffer.alloc(expectedBytes));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
