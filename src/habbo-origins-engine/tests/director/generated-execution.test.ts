import { describe, expect, it } from "vitest";
import { Runtime } from "../../src/director/Runtime";
import * as compressModule from "../../generated/scripts/hh_room_pool/External/MovieScript_6_-__compressString_and_decompressString";

/**
 * End-to-end proof of the compile pipeline: real release306 Lingo source
 * (hh_room_pool compress/decompress movie script) parsed, generated to
 * TypeScript, and executed on the Director runtime with exact semantics.
 * The algorithms exercise chunk expressions, `the last char in`,
 * `delete char -30000 of`, integer division, mod, offset(), and repeat
 * loops with next repeat.
 */
describe("generated release306 code execution", () => {
  function makeRuntime(): Runtime {
    const runtime = new Runtime();
    runtime.register(compressModule, "hh_room_pool");
    return runtime;
  }

  it("hex2int converts hex strings", () => {
    const runtime = makeRuntime();
    expect(runtime.call("hex2int", ["1A"])).toBe(26);
    expect(runtime.call("hex2int", ["FF"])).toBe(255);
    expect(runtime.call("hex2int", ["00"])).toBe(0);
    expect(runtime.call("hex2int", ["10"])).toBe(16);
  });

  it("int2hex converts integers to even-width hex", () => {
    const runtime = makeRuntime();
    expect(runtime.call("int2hex", [255])).toBe("FF");
    expect(runtime.call("int2hex", [26])).toBe("1A");
    expect(runtime.call("int2hex", [0])).toBe("00");
    expect(runtime.call("int2hex", [256])).toBe("0100");
  });

  it("compressString round-trips through decompressString", () => {
    const runtime = makeRuntime();
    const original = "aaaaaaaaaabbbbcdddddddddddddddddddddddddddd";
    const compressed = runtime.call("compressstring", [original]) as string;
    expect(compressed).not.toBe(original);
    expect(compressed.length).toBeLessThan(original.length);
    const restored = runtime.call("decompressstring", [compressed]);
    expect(restored).toBe(original);
  });

  it("compressString escapes the % marker itself", () => {
    const runtime = makeRuntime();
    const original = "ab%cd";
    const compressed = runtime.call("compressstring", [original]) as string;
    const restored = runtime.call("decompressstring", [compressed]);
    expect(restored).toBe(original);
  });
});
