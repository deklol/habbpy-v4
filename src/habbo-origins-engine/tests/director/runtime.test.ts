import { describe, expect, it } from "vitest";
import {
  MissingScriptInstance,
  MissingScriptRef,
  Runtime,
  ScriptInstance,
  classifyCopyPixelsQuadTransform,
} from "../../src/director/Runtime";
import { LingoColor, LingoDate, LingoPoint, LingoRect } from "../../src/director/geometry";
import { affineTransformForQuad, LingoImage } from "../../src/director/imaging";
import { LINGO_VOID, LingoFloat, LingoList, LingoPropList, float, symbol } from "../../src/director/values";

function withPixelCanvas(test: () => void): void {
  const previousDocument = globalThis.document;
  class FakeCanvas {
    width = 1;
    height = 1;
    context: FakeContext | null = null;

    getContext(): FakeContext {
      this.context ??= new FakeContext(this);
      return this.context;
    }
  }

  class FakeContext {
    fillStyle = "rgb(0, 0, 0)";
    globalAlpha = 1;
    globalCompositeOperation = "source-over";
    imageSmoothingEnabled = true;
    private data = new Uint8ClampedArray(4);
    private transformState = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    private transformStack: typeof this.transformState[] = [];

    constructor(public readonly canvas: FakeCanvas) {}

    private ensureSize(): void {
      const size = Math.max(1, this.canvas.width) * Math.max(1, this.canvas.height) * 4;
      if (this.data.length !== size) this.data = new Uint8ClampedArray(size);
    }

    createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }

    putImageData(image: { data: Uint8ClampedArray; width?: number; height?: number }, x: number, y: number): void {
      this.ensureSize();
      const width = image.width ?? this.canvas.width;
      const height = image.height ?? this.canvas.height;
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          const dst = ((y + row) * this.canvas.width + x + col) * 4;
          const src = (row * width + col) * 4;
          this.data.set(image.data.slice(src, src + 4), dst);
        }
      }
    }

    getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
      this.ensureSize();
      const out = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        for (let col = 0; col < width; col += 1) {
          const src = ((y + row) * this.canvas.width + x + col) * 4;
          const dst = (row * width + col) * 4;
          out.set(this.data.slice(src, src + 4), dst);
        }
      }
      return { data: out, width, height };
    }

    fillRect(x: number, y: number, width: number, height: number): void {
      this.ensureSize();
      const match = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(this.fillStyle);
      const r = Number(match?.[1] ?? 0);
      const g = Number(match?.[2] ?? 0);
      const b = Number(match?.[3] ?? 0);
      for (let row = y; row < y + height; row += 1) {
        for (let col = x; col < x + width; col += 1) {
          const offset = (row * this.canvas.width + col) * 4;
          this.data[offset] = r;
          this.data[offset + 1] = g;
          this.data[offset + 2] = b;
          this.data[offset + 3] = 255;
        }
      }
    }

    clearRect(x: number, y: number, width: number, height: number): void {
      this.ensureSize();
      for (let row = y; row < y + height; row += 1) {
        for (let col = x; col < x + width; col += 1) {
          this.data.fill(0, (row * this.canvas.width + col) * 4, (row * this.canvas.width + col) * 4 + 4);
        }
      }
    }

    drawImage(source: FakeCanvas, ...args: number[]): void {
      this.ensureSize();
      const sourceCtx = source.getContext();
      sourceCtx.ensureSize();
      const [sx, sy, sw, sh, dx, dy, dw, dh] =
        args.length >= 8
          ? (args as [number, number, number, number, number, number, number, number])
          : [0, 0, source.width, source.height, args[0] ?? 0, args[1] ?? 0, source.width, source.height];
      for (let row = 0; row < dh; row += 1) {
        for (let col = 0; col < dw; col += 1) {
          const srcX = sx + Math.floor((col * sw) / dw);
          const srcY = sy + Math.floor((row * sh) / dh);
          const point = this.transformPoint(dx + col + 0.5, dy + row + 0.5);
          const dstX = Math.floor(point.x);
          const dstY = Math.floor(point.y);
          if (dstX < 0 || dstY < 0 || dstX >= this.canvas.width || dstY >= this.canvas.height) continue;
          const src = (srcY * source.width + srcX) * 4;
          const dst = (dstY * this.canvas.width + dstX) * 4;
          this.data.set(sourceCtx.data.slice(src, src + 4), dst);
        }
      }
    }

    save(): void {
      this.transformStack.push({ ...this.transformState });
    }

    restore(): void {
      this.transformState = this.transformStack.pop() ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }

    translate(x = 0, y = 0): void {
      this.transform(1, 0, 0, 1, x, y);
    }

    scale(x = 1, y = 1): void {
      this.transform(x, 0, 0, y, 0, 0);
    }

    rotate(angle = 0): void {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.transform(cos, sin, -sin, cos, 0, 0);
    }

    transform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): void {
      const current = this.transformState;
      this.transformState = {
        a: current.a * a + current.c * b,
        b: current.b * a + current.d * b,
        c: current.a * c + current.c * d,
        d: current.b * c + current.d * d,
        e: current.a * e + current.c * f + current.e,
        f: current.b * e + current.d * f + current.f,
      };
    }

    private transformPoint(x: number, y: number): { x: number; y: number } {
      const m = this.transformState;
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    }
  }

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeCanvas() },
  });
  try {
    test();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
  }
}

function expectFloatValue(value: unknown): number {
  expect(value).toBeInstanceOf(LingoFloat);
  return (value as LingoFloat).value;
}

describe("Director copyPixels quad destinations", () => {
  const rect = new LingoRect(0, 0, 10, 20);
  const tl = new LingoPoint(0, 0);
  const tr = new LingoPoint(10, 0);
  const br = new LingoPoint(10, 20);
  const bl = new LingoPoint(0, 20);

  it("classifies source corner mappings for flips and right-angle rotations", () => {
    expect(classifyCopyPixelsQuadTransform([tl, tr, br, bl], rect)).toBe("identity");
    expect(classifyCopyPixelsQuadTransform([tr, tl, bl, br], rect)).toBe("flipH");
    expect(classifyCopyPixelsQuadTransform([bl, br, tr, tl], rect)).toBe("flipV");
    expect(classifyCopyPixelsQuadTransform([br, bl, tl, tr], rect)).toBe("rotate180");
    expect(classifyCopyPixelsQuadTransform([tr, br, bl, tl], rect)).toBe("rotateCW");
    expect(classifyCopyPixelsQuadTransform([bl, tl, tr, br], rect)).toBe("rotateCCW");
  });

  it("builds affine transforms for Director parallelogram quad copies", () => {
    const rightStallSign = [
      new LingoPoint(0, 0),
      new LingoPoint(64, 32),
      new LingoPoint(64, 50),
      new LingoPoint(0, 18),
    ] as [LingoPoint, LingoPoint, LingoPoint, LingoPoint];
    const transform = affineTransformForQuad(rightStallSign, 64, 18);

    expect(transform.a).toBeCloseTo(1);
    expect(transform.b).toBeCloseTo(0.5);
    expect(transform.c).toBeCloseTo(0);
    expect(transform.d).toBeCloseTo(1);
    expect(transform.e).toBe(0);
    expect(transform.f).toBe(0);
  });

  it("keeps offscreen Director image canvases unsmoothed for pixel copies", () => {
    withPixelCanvas(() => {
      const image = new LingoImage(2, 2, 32);
      expect(image.context?.imageSmoothingEnabled).toBe(false);
    });
  });

  it("copies Director horizontal flip quad destinations pixel-for-pixel", () => {
    withPixelCanvas(() => {
      const runtime = new Runtime();
      const source = new LingoImage(2, 1, 32);
      const dest = new LingoImage(2, 1, 32);
      source.setPixel(0, 0, new LingoColor(10, 20, 30));
      source.setPixel(1, 0, new LingoColor(200, 210, 220));

      runtime.callMethod(dest, "copyPixels", [
        source,
        new LingoList([
          new LingoPoint(2, 0),
          new LingoPoint(0, 0),
          new LingoPoint(0, 1),
          new LingoPoint(2, 1),
        ]),
        source.getRect(),
      ]);

      expect(dest.getPixel(0, 0).hex).toBe(0xc8d2dc);
      expect(dest.getPixel(1, 0).hex).toBe(0x0a141e);
    });
  });
});

describe("runtime property access", () => {
  it("reads property-list entries before built-in list properties", () => {
    const runtime = new Runtime();
    const props = LingoPropList.fromPairs([
      [symbol("ilk"), symbol("struct")],
      [symbol("count"), 42],
    ]);

    expect(runtime.getProp(props, "ilk")).toBe(symbol("struct"));
    expect(runtime.getProp(props, "count")).toBe(42);
  });

  it("falls back to built-in property-list properties when entries are absent", () => {
    const runtime = new Runtime();
    const props = LingoPropList.fromPairs([[symbol("name"), "example"]]);

    expect(runtime.getProp(props, "ilk")).toBe(symbol("propList"));
    expect(runtime.getProp(props, "count")).toBe(1);
  });

  it("implements property-list setProp without appending missing keys", () => {
    const runtime = new Runtime();
    const props = LingoPropList.fromPairs([[symbol("value"), 1]]);

    runtime.callMethod(props, "setprop", [symbol("value"), 2]);
    expect(props.getaProp(symbol("value"), (a, b) => a === b)).toBe(2);
    expect(() => runtime.callMethod(props, "setprop", [symbol("missing"), 3])).toThrow(
      /property not found/,
    );
    expect(props.count()).toBe(1);
  });

  it("still exposes built-in ilk for script instances", () => {
    const runtime = new Runtime();
    const instance = new ScriptInstance({
      scriptName: "Example Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });

    expect(runtime.getProp(instance, "ilk")).toBe(symbol("instance"));
  });

  it("stores Director preferences case-insensitively", () => {
    const runtime = new Runtime();

    expect(runtime.call("getPref", ["Blocktime"])).toBe(LINGO_VOID);
    expect(runtime.call("setPref", ["blocktime", "42"])).toBe(1);

    expect(runtime.call("getPref", ["Blocktime"])).toBe("42");
  });

  it("supports outputList as a diagnostic Message-window builtin", () => {
    const lines: string[] = [];
    const runtime = new Runtime({ put: (text) => lines.push(text) });

    expect(runtime.call("outputList", [new LingoList(["bad", "data"])])).toBe(LINGO_VOID);
    expect(lines).toEqual(["[\"bad\", \"data\"]"]);
  });

  it("represents real script members without generated modules as non-objects", () => {
    const runtime = new Runtime();
    const missing = new MissingScriptRef("42009274", "Balloon Furni Class", 42009274, "hh_room");
    const instance = runtime.callMethod(missing, "new", []);

    expect(instance).toBeInstanceOf(MissingScriptInstance);
    expect(runtime.call("objectp", [instance])).toBe(0);
    expect(runtime.call("ilk", [instance, symbol("instance")])).toBe(0);
    expect(runtime.callMethod(instance, "handler", [symbol("construct")])).toBe(0);
  });

  it("broadcasts call() to host-backed objects in lists", () => {
    const handled = { lingoType: "hostTarget" } as never;
    const skipped = { lingoType: "hostTarget" } as never;
    const calls: unknown[][] = [];
    const runtime = new Runtime({
      callMethod(receiver, method, args) {
        if (receiver !== handled || method !== "registerprocedure") return undefined;
        calls.push(args);
        return 1;
      },
    });

    const result = runtime.call("call", [
      symbol("registerProcedure"),
      new LingoList([skipped, handled]),
      symbol("eventProcRoom"),
      "Room_interface",
      symbol("mouseDown"),
    ]);

    expect(result).toBe(1);
    expect(calls).toEqual([[symbol("eventProcRoom"), "Room_interface", symbol("mouseDown")]]);
  });

  it("reports unsupported errors thrown inside call() target handlers", () => {
    const lines: string[] = [];
    const runtime = new Runtime({ put: (text) => lines.push(text) });
    const instance = new ScriptInstance({
      scriptName: "Room Interface Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        eventprocactiveobj(ctx) {
          return ctx.theProp("rollover");
        },
      },
    });

    expect(runtime.call("call", [symbol("eventProcActiveObj"), instance, symbol("mouseDown"), "971822"])).toBe(
      LINGO_VOID,
    );
    expect(lines.some((line) => line.includes("script error in #eventProcActiveObj: unsupported: the rollover"))).toBe(
      true,
    );
  });

  it("parses room packet control-prefixed integer strings", () => {
    const runtime = new Runtime();

    expect(runtime.call("integer", [String.fromCharCode(2) + "184123"])).toBe(184123);
    expect(runtime.call("integer", ["poster184123"])).toBe(LINGO_VOID);
  });

  it("creates Director palette-index colors with RGB properties", () => {
    const runtime = new Runtime();
    const color = runtime.call("paletteIndex", [82]);

    expect(color).toBeInstanceOf(LingoColor);
    expect(runtime.getProp(color, "paletteIndex")).toBe(82);
    expect(runtime.getProp(color, "colorType")).toBe(symbol("paletteIndex"));
    expect(runtime.getProp(color, "red")).toBeTypeOf("number");
    expect(runtime.callMethod(color, "hexstring", [])).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("supports Director color constructors", () => {
    const runtime = new Runtime();
    const rgb = runtime.call("color", [symbol("rgb"), 1, 2, 3]);
    const pal = runtime.call("color", [symbol("paletteIndex"), 82]);

    expect(rgb).toEqual(new LingoColor(1, 2, 3));
    expect(runtime.getProp(rgb, "colorType")).toBe(symbol("rgb"));
    expect(runtime.getProp(pal, "paletteIndex")).toBe(82);
  });

  it("allows Director color channel mutation", () => {
    const runtime = new Runtime();
    const color = runtime.call("paletteIndex", [82]) as LingoColor;

    runtime.setProp(color, "red", 12.5);
    runtime.setProp(color, "green", 34);
    runtime.setProp(color, "blue", 56);

    expect(runtime.getProp(color, "red")).toBe(12.5);
    expect(runtime.getProp(color, "green")).toBe(34);
    expect(runtime.getProp(color, "blue")).toBe(56);
    expect(runtime.getProp(color, "colorType")).toBe(symbol("rgb"));
  });

  it("allows Director paletteIndex reassignment on colors", () => {
    const runtime = new Runtime();
    const color = new LingoColor(1, 2, 3);

    runtime.setProp(color, "paletteIndex", 82);

    expect(runtime.getProp(color, "paletteIndex")).toBe(82);
    expect(runtime.getProp(color, "colorType")).toBe(symbol("paletteIndex"));
    expect(runtime.getProp(color, "red")).toBeTypeOf("number");
  });

  it("evaluates Director constants inside value() field literals", () => {
    const runtime = new Runtime();
    const parsed = runtime.call("value", [
      "[\"b\": [#style: #fontStyle, #default:[#bold]], \"br\":[#replace:RETURN], \"empty\":[#value:EMPTY], \"void\":[#value:VOID]]",
    ]);

    expect(parsed).toBeInstanceOf(LingoPropList);
    const bold = runtime.getIndex(parsed, ["b"], null);
    const br = runtime.getIndex(parsed, ["br"], null);
    const empty = runtime.getIndex(parsed, ["empty"], null);
    const voidValue = runtime.getIndex(parsed, ["void"], null);

    expect(runtime.getIndex(bold, [symbol("style")], null)).toBe(symbol("fontStyle"));
    expect(runtime.getIndex(br, [symbol("replace")], null)).toBe("\r");
    expect(runtime.getIndex(empty, [symbol("value")], null)).toBe("");
    expect(runtime.getIndex(voidValue, [symbol("value")], null)).toBe(LINGO_VOID);
  });

  it("evaluates bare property-list keys used by room animation data", () => {
    const runtime = new Runtime();
    const parsed = runtime.call("value", [
      "[states:[1,2,3], layers:[ a:[ [ frames:[ 0 ] ], [ frames:[ 1 ] ] ] ]]",
    ]);

    expect(parsed).toBeInstanceOf(LingoPropList);
    expect(runtime.getIndex(parsed, [symbol("states")], null)).toBeInstanceOf(LingoList);
    const layers = runtime.getIndex(parsed, [symbol("layers")], null);
    expect(layers).toBeInstanceOf(LingoPropList);
    expect(runtime.getIndex(layers, [symbol("a")], null)).toBeInstanceOf(LingoList);
  });

  it("evaluates unary plus in authored furniture props field literals", () => {
    const runtime = new Runtime();
    const parsed = runtime.call("value", [
      '["a": [#zshift: [0, 0, 0, 0, +10], #locshift:[0,0,0,0,point(26,13)]]]',
    ]);

    expect(parsed).toBeInstanceOf(LingoPropList);
    const part = runtime.getIndex(parsed, ["a"], null);
    const zshift = runtime.getIndex(part, [symbol("zshift")], null) as LingoList;
    const locshift = runtime.getIndex(part, [symbol("locshift")], null) as LingoList;
    expect(zshift.getAt(5)).toBe(10);
    expect(locshift.getAt(5)).toEqual(new LingoPoint(26, 13));
  });

  it("tolerates surplus trailing brackets in authored props field literals", () => {
    const runtime = new Runtime();
    const parsed = runtime.call("value", [
      '["a": [#ink: 36, #zshift: [-1000]], "b": [#ink: 36, #zshift: [-1005], #blend: 20]]]',
    ]);

    expect(parsed).toBeInstanceOf(LingoPropList);
    const b = runtime.getIndex(parsed, ["b"], null);
    expect(runtime.getIndex(b, [symbol("blend")], null)).toBe(20);
  });

  it("reads property-list symbol keys through string ids without overwriting exact string keys", () => {
    const runtime = new Runtime();
    const props = LingoPropList.fromPairs([[symbol("session"), "symbol-session"]]);

    expect(runtime.callMethod(props, "getaprop", ["session"])).toBe("symbol-session");
    runtime.callMethod(props, "setaprop", ["session", "string-session"]);

    expect(props.count()).toBe(2);
    expect(runtime.callMethod(props, "getaprop", ["session"])).toBe("string-session");
    expect(runtime.callMethod(props, "getaprop", [symbol("session")])).toBe("symbol-session");
  });

  it("indexes property lists exact-first before string/symbol fallback", () => {
    const runtime = new Runtime();
    const objectList = LingoPropList.fromPairs([
      [symbol("session"), "session-object"],
      [symbol("room_interface"), "thread-object"],
      ["Room_interface", "window-object"],
    ]);

    expect(runtime.getIndex(objectList, ["session"], null)).toBe("session-object");
    expect(runtime.getIndex(objectList, [symbol("session")], null)).toBe("session-object");
    expect(runtime.getIndex(objectList, ["Room_interface"], null)).toBe("window-object");
    expect(runtime.getIndex(objectList, [symbol("room_interface")], null)).toBe("thread-object");

    const images = LingoPropList.fromPairs([[symbol("top_up"), "image"]]);
    expect(runtime.getIndex(images, ["top_up"], null)).toBe("image");
  });

  it("exposes Director date properties and ilk", () => {
    const runtime = new Runtime();
    const date = new LingoDate(2026, 6, 11);

    expect(runtime.getProp(date, "year")).toBe(2026);
    expect(runtime.getProp(date, "month")).toBe(6);
    expect(runtime.getProp(date, "day")).toBe(11);
    expect(runtime.getProp(date, "ilk")).toBe(symbol("date"));
    expect(runtime.call("ilk", [date, symbol("date")])).toBe(1);
  });

  it("mutates Director point and rect properties", () => {
    const runtime = new Runtime();
    const point = new LingoPoint(10, 20);
    const rect = new LingoRect(1, 2, 11, 22);

    runtime.setProp(point, "locH", 15);
    runtime.setProp(point, "locV", 25);
    expect(point).toEqual(new LingoPoint(15, 25));

    runtime.setProp(rect, "top", 5);
    runtime.setProp(rect, "width", 30);
    runtime.setProp(rect, "height", 40);
    expect(rect).toEqual(new LingoRect(1, 5, 31, 45));
  });

  it("computes min and max from a single Director list argument", () => {
    const runtime = new Runtime();
    const values = new LingoList([42, -3, 18]);

    expect(runtime.call("min", [values])).toBe(-3);
    expect(runtime.call("max", [values])).toBe(42);
  });

  it("resolves Director trigonometry builtins and numeric method aliases", () => {
    const runtime = new Runtime();

    expect(expectFloatValue(runtime.call("sin", [float(Math.PI / 2)])).toFixed(10)).toBe("1.0000000000");
    expect(expectFloatValue(runtime.call("cos", [float(0)])).toFixed(10)).toBe("1.0000000000");
    expect(expectFloatValue(runtime.call("tan", [float(Math.PI / 4)])).toFixed(10)).toBe("1.0000000000");
    expect(expectFloatValue(runtime.call("atan", [1])).toFixed(10)).toBe((Math.PI / 4).toFixed(10));

    expect(expectFloatValue(runtime.callMethod(float(Math.PI / 2), "sin", [])).toFixed(10)).toBe("1.0000000000");
    expect(expectFloatValue(runtime.callMethod(0, "cos", [])).toFixed(10)).toBe("1.0000000000");
  });

  it("exposes Director's maxInteger runtime property", () => {
    const runtime = new Runtime();

    expect(runtime.theProp("maxInteger")).toBe(2147483647);
  });

  it("aliases legacy Director timer to the 60 Hz tick clock", () => {
    const runtime = new Runtime();

    const timer = runtime.theProp("timer");
    const ticks = runtime.theProp("ticks");

    expect(typeof timer).toBe("number");
    expect(Math.abs((timer as number) - (ticks as number))).toBeLessThanOrEqual(1);
  });

  it("exposes scalar string and integer value-level properties", () => {
    const runtime = new Runtime();

    expect(runtime.getProp("1024173", "string")).toBe("1024173");
    expect(runtime.getProp("42", "integer")).toBe(42);
    expect(runtime.getProp(42, "string")).toBe("42");
  });

  it("treats the empty sprite member sentinel as an empty member name", () => {
    const runtime = new Runtime();

    expect(runtime.getProp(0, "name")).toBe("");
  });

  it("duplicates Director geometry and color values without aliasing", () => {
    const runtime = new Runtime();
    const point = new LingoPoint(10, 20);
    const rect = new LingoRect(1, 2, 11, 22);
    const color = new LingoColor(4, 5, 6, 82);

    const pointCopy = runtime.callMethod(point, "duplicate", []) as LingoPoint;
    expect(pointCopy).toEqual(point);
    expect(pointCopy).not.toBe(point);
    runtime.setIndex(pointCopy, [1], null, 30);
    expect(point).toEqual(new LingoPoint(10, 20));
    expect(pointCopy).toEqual(new LingoPoint(30, 20));

    const rectCopy = runtime.callMethod(rect, "duplicate", []) as LingoRect;
    expect(rectCopy).toEqual(rect);
    expect(rectCopy).not.toBe(rect);
    runtime.setIndex(rectCopy, [2], null, 9);
    expect(rect).toEqual(new LingoRect(1, 2, 11, 22));
    expect(rectCopy).toEqual(new LingoRect(1, 9, 11, 22));

    const colorCopy = runtime.callMethod(color, "duplicate", []) as LingoColor;
    expect(colorCopy).toEqual(color);
    expect(colorCopy).not.toBe(color);
  });

  it("computes Director rect union and intersection", () => {
    const runtime = new Runtime();
    const left = new LingoRect(0, 0, 10, 10);
    const right = new LingoRect(15, 5, 20, 12);

    expect(runtime.call("union", [left, right])).toEqual(new LingoRect(0, 0, 20, 12));
    expect(runtime.callMethod(left, "union", [right])).toEqual(new LingoRect(0, 0, 20, 12));
    expect(runtime.call("intersect", [left, new LingoRect(5, -2, 12, 4)])).toEqual(
      new LingoRect(5, 0, 10, 4),
    );
    expect(runtime.callMethod(left, "intersect", [right])).toEqual(new LingoRect(0, 0, 0, 0));
  });

  it("accepts coordinate-form image fill calls", () => {
    const calls: Array<[number, number, number, number]> = [];
    const ctx = {
      canvas: { width: 20, height: 20 },
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      putImageData: () => {},
      drawImage: () => {},
      fillStyle: "",
      fillRect: (x: number, y: number, w: number, h: number) => calls.push([x, y, w, h]),
      clearRect: () => {},
      globalAlpha: 1,
    };
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    });
    try {
      const runtime = new Runtime();
      const image = new LingoImage(20, 20, 8);
      // Director images initialize white (first recorded fill), then the
      // coordinate-form fill(left, top, right, bottom, color) applies.
      runtime.callMethod(image, "fill", [2, 3, 12, 9, new LingoColor(4, 5, 6)]);
      expect(calls).toEqual([
        [0, 0, 20, 20],
        [2, 3, 10, 6],
      ]);
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    }
  });

  it("resolves palette-index image fills through the image palette", () => {
    const fills: Array<{ style: string; rect: [number, number, number, number] }> = [];
    let fillStyle = "";
    const ctx = {
      canvas: { width: 4, height: 4 },
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
      putImageData: () => {},
      drawImage: () => {},
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = value;
      },
      fillRect: (x: number, y: number, w: number, h: number) =>
        fills.push({ style: fillStyle, rect: [x, y, w, h] }),
      clearRect: () => {},
      globalAlpha: 1,
    };
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) },
    });
    try {
      const runtime = new Runtime();
      const paletteRef = { lingoType: "member", paletteColors: [0x000000, 0x112233, 0xabcdef] } as any;
      const image = new LingoImage(4, 4, 8, paletteRef);

      runtime.callMethod(image, "fill", [1, 1, 3, 3, new LingoColor(255, 255, 255, 2)]);

      expect(fills).toEqual([
        { style: "rgb(255, 255, 255)", rect: [0, 0, 4, 4] },
        { style: "rgb(171, 205, 239)", rect: [1, 1, 2, 2] },
      ]);
    } finally {
      Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    }
  });

  it("applies copyPixels #color foreground colorization", () => {
    withPixelCanvas(() => {
      const runtime = new Runtime();
      const source = new LingoImage(2, 1, 32);
      const dest = new LingoImage(2, 1, 32);
      source.setPixel(0, 0, new LingoColor(0, 0, 0));
      source.setPixel(1, 0, new LingoColor(128, 128, 128));

      runtime.callMethod(dest, "copyPixels", [
        source,
        source.getRect(),
        source.getRect(),
        LingoPropList.fromPairs([[symbol("color"), new LingoColor(255, 0, 0)]]),
      ]);

      expect(dest.getPixel(0, 0).hex).toBe(0xff0000);
      const blended = dest.getPixel(1, 0);
      expect(blended.r).toBeGreaterThan(blended.g);
      expect(blended.g).toBe(blended.b);
    });
  });

  it("keeps copyPixels #color after background-transparent keying", () => {
    withPixelCanvas(() => {
      const runtime = new Runtime();
      const source = new LingoImage(2, 1, 32);
      const dest = new LingoImage(2, 1, 32);
      source.setPixel(1, 0, new LingoColor(0, 0, 0));

      runtime.callMethod(dest, "copyPixels", [
        source,
        source.getRect(),
        source.getRect(),
        LingoPropList.fromPairs([
          [symbol("ink"), 36],
          [symbol("color"), new LingoColor(255, 255, 255)],
        ]),
      ]);

      expect(dest.getPixel(1, 0).hex).toBe(0xffffff);
    });
  });

  it("preserves source alpha when copyPixels matte copies runtime text-like images", () => {
    withPixelCanvas(() => {
      const runtime = new Runtime();
      const source = new LingoImage(2, 1, 32, undefined, { initWhite: false });
      const dest = new LingoImage(2, 1, 32, undefined, { initWhite: false });
      source.setPixel(0, 0, new LingoColor(255, 255, 255));

      runtime.callMethod(dest, "copyPixels", [
        source,
        source.getRect(),
        source.getRect(),
        LingoPropList.fromPairs([[symbol("ink"), 8]]),
      ]);

      expect(dest.getPixel(0, 0).hex).toBe(0xffffff);
      expect(dest.getPixelAlpha(0, 0)).toBe(255);
      expect(dest.getPixelAlpha(1, 0)).toBe(0);
    });
  });

  it("re-renders palette-indexed image duplicates when paletteRef changes", () => {
    withPixelCanvas(() => {
      const paletteA = { lingoType: "member", paletteColors: [0x000000, 0x112233] } as any;
      const paletteB = { lingoType: "member", paletteColors: [0xffffff, 0xaabbcc] } as any;
      const image = LingoImage.fromPaletteIndices(1, 1, new Uint8Array([1]), paletteA.paletteColors, paletteA);

      expect(image.getPixel(0, 0).hex).toBe(0x112233);

      const copy = image.duplicate();
      copy.paletteRef = paletteB;

      expect(copy.getPixel(0, 0).hex).toBe(0xaabbcc);
      expect(image.getPixel(0, 0).hex).toBe(0x112233);

      copy.fill(copy.getRect(), new LingoColor(1, 2, 3));
      copy.paletteRef = paletteA;

      expect(copy.getPixel(0, 0).hex).toBe(0x010203);
    });
  });

  it("does not reinterpret 2-bit indexed images as 256-color system palettes", () => {
    withPixelCanvas(() => {
      const image = LingoImage.fromPaletteIndices(
        4,
        1,
        new Uint8Array([0, 1, 2, 3]),
        [0xffffff, 0xa3a3a3, 0x656565, 0x000000],
        symbol("systemMac"),
        2,
      );

      expect(image.getPixel(0, 0).hex).toBe(0xffffff);
      expect(image.getPixel(1, 0).hex).toBe(0xa3a3a3);
      expect(image.getPixel(2, 0).hex).toBe(0x656565);
      expect(image.getPixel(3, 0).hex).toBe(0x000000);

      const copy = image.duplicate();
      copy.paletteRef = symbol("systemWin");

      expect(copy.getPixel(3, 0).hex).toBe(0x000000);
      expect(image.getPixel(3, 0).hex).toBe(0x000000);
    });
  });

  it("exposes image createMask for copyPixels mask parameters", () => {
    const runtime = new Runtime();
    const image = new LingoImage(7, 5, 8);

    const mask = runtime.callMethod(image, "createMask", []);

    expect(mask).toBeInstanceOf(LingoImage);
    expect((mask as LingoImage).width).toBe(7);
    expect((mask as LingoImage).height).toBe(5);
  });

  it("creates Matte masks that preserve enclosed white artwork", () => {
    withPixelCanvas(() => {
      const image = new LingoImage(5, 5, 8);
      const black = new LingoColor(0, 0, 0);
      for (let x = 1; x <= 3; x += 1) {
        image.setPixel(x, 1, black);
        image.setPixel(x, 3, black);
      }
      image.setPixel(1, 2, black);
      image.setPixel(3, 2, black);

      const matte = image.createMatte();

      expect(matte.getPixelAlpha(0, 0)).toBe(0);
      expect(matte.getPixel(2, 2).hex).toBe(0x000000);
      expect(matte.getPixelAlpha(2, 2)).toBe(255);
    });
  });

  it("replaces and inserts around string chunks", () => {
    const runtime = new Runtime();

    expect(runtime.replaceChunk("model_1.room", "char", 7, null, "x", "into")).toBe("model_x.room");
    expect(runtime.replaceChunk("ab", "char", 2, null, "X", "before")).toBe("aXb");
    expect(runtime.replaceChunk("ab", "char", 2, null, "X", "after")).toBe("abX");
    expect(runtime.replaceChunk("one two", "word", 2, null, "three", "into")).toBe("one three");
  });

  it("treats Director word chunks as whitespace-delimited original spans", () => {
    const runtime = new Runtime();
    const quoted = '"Swap Animation Class"';

    expect(runtime.chunkCount(quoted, "word")).toBe(3);
    expect(runtime.chunk("word", 1, runtime.chunkCount(quoted, "word"), quoted)).toBe(quoted);
  });

  it("preserves quoted text field lists for source value() parsing", () => {
    const runtime = new Runtime();
    const pair = 'bulletin_months="January", "February", "March"';

    runtime.setTheProp("itemDelimiter", "=");
    const itemPart = runtime.getProp(pair, "item");
    const rawValue = runtime.getIndex(
      itemPart,
      [2],
      runtime.getProp(itemPart, "count"),
    ) as string;
    const wordPart = runtime.getProp(rawValue, "word");
    const normalized = runtime.getIndex(
      wordPart,
      [1],
      runtime.getProp(wordPart, "count"),
    ) as string;

    expect(normalized).toBe('"January", "February", "March"');
    const parsed = runtime.call("value", [`[${normalized}]`]);
    expect(parsed).toBeInstanceOf(LingoList);
    expect((parsed as LingoList).items).toEqual(["January", "February", "March"]);
  });

  it("treats CR plus packet char(2) as one line separator", () => {
    const runtime = new Runtime();
    const content = `1024173\twindow\r${String.fromCharCode(2)}184123\tposter\r${String.fromCharCode(2)}`;

    expect(runtime.chunkCount(content, "line")).toBe(3);
    expect(runtime.chunk("line", 1, null, content)).toBe("1024173\twindow");
    expect(runtime.chunk("line", 2, null, content)).toBe("184123\tposter");
    expect(runtime.chunk("line", 3, null, content)).toBe("");
  });

  it("treats bare packet char(2) as a line separator except before a tab field continuation", () => {
    const runtime = new Runtime();
    const separator = String.fromCharCode(2);

    expect(runtime.chunkCount(`first${separator}second`, "line")).toBe(2);
    expect(runtime.chunk("line", 1, null, `first${separator}second`)).toBe("first");
    expect(runtime.chunk("line", 2, null, `first${separator}second`)).toBe("second");
    expect(runtime.chunkCount(`-1${separator}\t3`, "line")).toBe(1);
  });

  it("does not split Director line chunks on bare packet char(2) inside catalogue rows", () => {
    const runtime = new Runtime();
    const separator = String.fromCharCode(2);
    const productRow = `p:Armchair\tLarge, but worth it\t-1${separator}\t3\ttrue\ts\tsofachair_silo\t0\t1,1\tA1 STS\t#ffffff,#ABD0D2\t25`;

    expect(runtime.chunkCount(productRow, "line")).toBe(1);

    runtime.setTheProp("itemDelimiter", ":");
    const lineItems = runtime.getProp(productRow, "item");
    const data = runtime.getIndex(lineItems, [2], runtime.getProp(lineItems, "count")) as string;

    runtime.setTheProp("itemDelimiter", "\t");
    const items = runtime.getProp(data, "item");
    expect(runtime.getIndex(items, [1], null)).toBe("Armchair");
    expect(runtime.call("integer", [runtime.getIndex(items, [3], null)])).toBe(-1);
    expect(runtime.getIndex(items, [4], null)).toBe("3");
    expect(runtime.getIndex(items, [7], null)).toBe("sofachair_silo");
    expect(runtime.getIndex(items, [10], null)).toBe("A1 STS");
  });

  it("returns EMPTY for descending explicit chunk ranges", () => {
    const runtime = new Runtime();
    const emptyBodyPacket = `@-${String.fromCharCode(1)}`;

    expect(runtime.chunk("char", 3, 2, emptyBodyPacket)).toBe("");
  });

  it("preserves Thread Manager's pre-linked ancestor bridge during chain construction", () => {
    const runtime = new Runtime();
    const thread = new ScriptInstance({
      scriptName: "Thread Instance Class",
      scriptType: "parent",
      scriptProperties: ["interface", "component", "handler"],
      scriptGlobals: [],
      handlers: {
        getinterface(ctx, me, args) {
          return ctx.getInstanceProp(args[0] ?? me, "interface");
        },
      },
    });
    const iface = new ScriptInstance({
      scriptName: "Messenger Interface Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const base = new ScriptInstance({
      scriptName: "Object Base Class",
      scriptType: "parent",
      scriptProperties: ["id", "valid", "delays"],
      scriptGlobals: [],
      handlers: {},
    });
    const component = new ScriptInstance({
      scriptName: "Messenger Component Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });

    runtime.setProp(thread, "interface", iface);
    runtime.setIndex(base, [symbol("ancestor")], null, thread);
    runtime.setIndex(base, [symbol("ancestor")], null, LINGO_VOID);
    runtime.setIndex(component, [symbol("ancestor")], null, base);

    expect(runtime.callMethod(component, "getinterface", [])).toBe(iface);
  });

  it("binds unqualified handler properties to the declaring ancestor scope", () => {
    const runtime = new Runtime();
    const parent = new ScriptInstance({
      scriptName: "Active Object Class",
      scriptType: "parent",
      scriptProperties: ["pAnimFrame", "pSprList"],
      scriptGlobals: [],
      handlers: {
        construct(ctx, me, args) {
          ctx.setInstanceProp(args[0] ?? me, "pAnimFrame", 0);
          ctx.setInstanceProp(args[0] ?? me, "pSprList", new LingoList(["sprite"]));
          return 1;
        },
        readframe(ctx, me, args) {
          return ctx.getInstanceProp(args[0] ?? me, "pAnimFrame");
        },
      },
    });
    const child = new ScriptInstance({
      scriptName: "Queue Class",
      scriptType: "parent",
      scriptProperties: ["pAnimFrame"],
      scriptGlobals: [],
      handlers: {
        readchildframe(ctx, me, args) {
          return ctx.getInstanceProp(args[0] ?? me, "pAnimFrame");
        },
        readparentsprites(ctx, me, args) {
          return ctx.getProp(args[0] ?? me, "pSprList");
        },
      },
    });

    runtime.setIndex(child, [symbol("ancestor")], null, parent);
    runtime.callMethod(child, "construct", []);
    runtime.callMethod(child, "readchildframe", []);
    runtime.setProp(child, "pAnimFrame", 7);

    expect(runtime.callMethod(child, "readframe", [])).toBe(0);
    expect(runtime.callMethod(child, "readchildframe", [])).toBe(7);
    expect(runtime.callMethod(child, "readparentsprites", [])).toEqual(new LingoList(["sprite"]));
  });

  it("passes Director target-list arguments through callAncestor", () => {
    const runtime = new Runtime();
    const parent = new ScriptInstance({
      scriptName: "Item Object Class",
      scriptType: "parent",
      scriptProperties: ["pSprList"],
      scriptGlobals: [],
      handlers: {
        define(ctx, me, args) {
          ctx.setInstanceProp(me, "pSprList", new LingoList(["wall-sprite"]));
          return args[1] ?? LINGO_VOID;
        },
      },
    });
    const child = new ScriptInstance({
      scriptName: "Window Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        define(ctx, me, args) {
          const sourceMe = args[0] ?? me;
          return ctx.callLocal(me, "callancestor", [
            symbol("define"),
            new LingoList([sourceMe]),
            args[1] ?? LINGO_VOID,
          ]);
        },
      },
    });
    const payload = LingoPropList.fromPairs([[symbol("class"), "window_double_default"]]);

    runtime.setIndex(child, [symbol("ancestor")], null, parent);

    expect(runtime.callMethod(child, "define", [payload])).toBe(payload);
    expect(runtime.getProp(child, "pSprList")).toEqual(new LingoList(["wall-sprite"]));
    expect(child.props.has("psprlist")).toBe(false);
    expect(parent.props.has("psprlist")).toBe(true);
  });

  it("resolves callAncestor relative to the currently executing ancestor handler", () => {
    const runtime = new Runtime();
    const calls: string[] = [];
    const grandparent = new ScriptInstance({
      scriptName: "Item Object Class",
      scriptType: "parent",
      scriptProperties: ["pSprList"],
      scriptGlobals: [],
      handlers: {
        define(ctx, me, args) {
          calls.push("item");
          ctx.setInstanceProp(me, "pSprList", new LingoList(["base-sprite"]));
          return args[1] ?? LINGO_VOID;
        },
      },
    });
    const parent = new ScriptInstance({
      scriptName: "Item Object Extension Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        define(ctx, me, args) {
          calls.push("extension");
          return ctx.callLocal(me, "callancestor", [
            symbol("define"),
            new LingoList([args[0] ?? me]),
            args[1] ?? LINGO_VOID,
          ]);
        },
      },
    });
    const child = new ScriptInstance({
      scriptName: "Window Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        define(ctx, me, args) {
          calls.push("window");
          return ctx.callLocal(me, "callancestor", [
            symbol("define"),
            new LingoList([args[0] ?? me]),
            args[1] ?? LINGO_VOID,
          ]);
        },
      },
    });
    const payload = LingoPropList.fromPairs([[symbol("class"), "window_double_default"]]);

    runtime.setIndex(parent, [symbol("ancestor")], null, grandparent);
    runtime.setIndex(child, [symbol("ancestor")], null, parent);

    expect(runtime.callMethod(child, "define", [payload])).toBe(payload);
    expect(calls).toEqual(["window", "extension", "item"]);
    expect(runtime.getProp(child, "pSprList")).toEqual(new LingoList(["base-sprite"]));
  });
});

describe("runtime Object Manager compatibility", () => {
  it("notifies the host after Object Manager create returns an instance", () => {
    const events: unknown[][] = [];
    const runtime = new Runtime({
      objectRegistered: (id, object, classList) => events.push([id, object, classList]),
    });
    const target = new ScriptInstance({
      scriptName: "Buffer Component Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const manager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        create() {
          return target;
        },
      },
    });
    const classList = new LingoList(["Buffer Component Class"]);

    expect(runtime.callMethod(manager, "create", ["Room Asset Buffer", classList])).toBe(target);
    expect(events).toEqual([["Room Asset Buffer", target, classList]]);
  });

  it("notifies the host after Object Manager registerObject succeeds", () => {
    const events: unknown[][] = [];
    const runtime = new Runtime({
      objectRegistered: (id, object, classList) => events.push([id, object, classList]),
    });
    const target = new ScriptInstance({
      scriptName: "Buffer Component Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const manager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        registerobject() {
          return 1;
        },
      },
    });

    expect(runtime.callMethod(manager, "registerobject", [symbol("buffer_component"), target])).toBe(1);
    expect(events).toEqual([[symbol("buffer_component"), target, LINGO_VOID]]);
  });

  it("hides an object from objectExists while its deconstruct handler is active", () => {
    const runtime = new Runtime();
    const manager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: [
        "pObjectList",
        "pUpdateList",
        "pPrepareList",
        "pManagerList",
        "pInstanceList",
        "pEraseLock",
      ],
      scriptGlobals: [],
      handlers: {},
    });
    let deconstructCalls = 0;
    const target = new ScriptInstance({
      scriptName: "Blueprint Manager Class",
      scriptType: "parent",
      scriptProperties: ["valid", "delays"],
      scriptGlobals: [],
      handlers: {
        deconstruct(ctx, me, args) {
          const self = args[0] ?? me;
          deconstructCalls += 1;
          expect(ctx.callLocal(self, "objectp", [self])).toBe(0);
          expect(ctx.callMethod(manager, "remove", ["Blueprint_Manager"])).toBe(0);
          return 1;
        },
      },
    });
    const objectList = LingoPropList.fromPairs([["Blueprint_Manager", target]]);
    const updateList = new LingoList([target]);
    const prepareList = new LingoList([target]);
    const instanceList = new LingoList(["Blueprint_Manager"]);
    const managerList = new LingoList(["Blueprint_Manager"]);

    runtime.setProp(target, "valid", 1);
    runtime.setProp(target, "delays", new LingoPropList());
    runtime.setProp(manager, "pobjectlist", objectList);
    runtime.setProp(manager, "pupdatelist", updateList);
    runtime.setProp(manager, "ppreparelist", prepareList);
    runtime.setProp(manager, "pinstancelist", instanceList);
    runtime.setProp(manager, "pmanagerlist", managerList);
    runtime.setProp(manager, "peraselock", 0);

    expect(runtime.callMethod(manager, "remove", ["Blueprint_Manager"])).toBe(1);
    expect(deconstructCalls).toBe(1);
    expect(runtime.call("objectp", [target])).toBe(0);
    expect(runtime.callMethod(objectList, "getaprop", ["Blueprint_Manager"])).toBe(LINGO_VOID);
    expect(runtime.getProp(updateList, "count")).toBe(0);
    expect(runtime.getProp(prepareList, "count")).toBe(0);
    expect(runtime.getProp(instanceList, "count")).toBe(0);
    expect(runtime.getProp(managerList, "count")).toBe(0);
  });

  it("does not collapse symbol thread ids with string window ids during remove", () => {
    const runtime = new Runtime();
    const manager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: [
        "pObjectList",
        "pUpdateList",
        "pPrepareList",
        "pManagerList",
        "pInstanceList",
        "pEraseLock",
      ],
      scriptGlobals: [],
      handlers: {},
    });
    let roomDeconstructs = 0;
    let windowDeconstructs = 0;
    const roomInterface = new ScriptInstance({
      scriptName: "Room Interface Class",
      scriptType: "parent",
      scriptProperties: ["valid", "delays"],
      scriptGlobals: [],
      handlers: {
        deconstruct() {
          roomDeconstructs += 1;
          return 1;
        },
      },
    });
    const roomWindow = new ScriptInstance({
      scriptName: "Window Instance Class",
      scriptType: "parent",
      scriptProperties: ["valid", "delays"],
      scriptGlobals: [],
      handlers: {
        deconstruct() {
          windowDeconstructs += 1;
          return 1;
        },
      },
    });
    const objectList = LingoPropList.fromPairs([
      [symbol("room_interface"), roomInterface],
      ["Room_interface", roomWindow],
    ]);
    const instanceList = new LingoList([symbol("room_interface"), "Room_interface"]);

    for (const object of [roomInterface, roomWindow]) {
      runtime.setProp(object, "valid", 1);
      runtime.setProp(object, "delays", new LingoPropList());
    }
    runtime.setProp(manager, "pobjectlist", objectList);
    runtime.setProp(manager, "pupdatelist", new LingoList());
    runtime.setProp(manager, "ppreparelist", new LingoList());
    runtime.setProp(manager, "pinstancelist", instanceList);
    runtime.setProp(manager, "pmanagerlist", new LingoList());
    runtime.setProp(manager, "peraselock", 0);

    expect(runtime.callMethod(manager, "remove", ["Room_interface"])).toBe(1);
    expect(roomDeconstructs).toBe(0);
    expect(windowDeconstructs).toBe(1);
    expect(runtime.callMethod(objectList, "getaprop", [symbol("room_interface")])).toBe(roomInterface);
    expect(objectList.keys).toEqual([symbol("room_interface")]);
    expect(objectList.values).toEqual([roomInterface]);
    expect(instanceList.items).toEqual([symbol("room_interface")]);
  });

  it("unregisters visualizer wrapper children when removing a visualizer", () => {
    const runtime = new Runtime();
    const manager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: [
        "pObjectList",
        "pUpdateList",
        "pPrepareList",
        "pManagerList",
        "pInstanceList",
        "pEraseLock",
      ],
      scriptGlobals: [],
      handlers: {},
    });
    const wrapperModule = {
      scriptName: "Visualizer Part Wrapper Class",
      scriptType: "parent" as const,
      scriptProperties: ["valid", "delays"],
      scriptGlobals: [],
      handlers: {
        deconstruct() {
          return 1;
        },
      },
    };
    let wrapperDeconstructs = 0;
    const wallWrapper = new ScriptInstance({
      ...wrapperModule,
      handlers: {
        deconstruct() {
          wrapperDeconstructs += 1;
          return 1;
        },
      },
    });
    const floorWrapper = new ScriptInstance({
      ...wrapperModule,
      handlers: {
        deconstruct() {
          wrapperDeconstructs += 1;
          return 1;
        },
      },
    });
    const unrelatedWrapper = new ScriptInstance(wrapperModule);
    const visualizer = new ScriptInstance({
      scriptName: "Visualizer Instance Class",
      scriptType: "parent",
      scriptProperties: ["valid", "delays", "pWrappedParts"],
      scriptGlobals: [],
      handlers: {
        deconstruct(ctx, me, args) {
          const self = args[0] ?? me;
          const wrappedParts = ctx.getProp(self, "pwrappedparts") as LingoPropList;
          for (const wrapper of wrappedParts.values) {
            ctx.callMethod(wrapper, "deconstruct", []);
          }
          ctx.setProp(self, "pwrappedparts", new LingoPropList());
          return 1;
        },
      },
    });
    const objectList = LingoPropList.fromPairs([
      ["Room_visualizer", visualizer],
      ["uid:wall", wallWrapper],
      ["uid:floor", floorWrapper],
      ["uid:unrelated", unrelatedWrapper],
    ]);
    const instanceList = new LingoList(["Room_visualizer", "uid:wall", "uid:floor", "uid:unrelated"]);
    const updateList = new LingoList([wallWrapper, floorWrapper, unrelatedWrapper]);
    const prepareList = new LingoList([floorWrapper, unrelatedWrapper]);

    for (const object of [visualizer, wallWrapper, floorWrapper, unrelatedWrapper]) {
      runtime.setProp(object, "valid", 1);
      runtime.setProp(object, "delays", new LingoPropList());
    }
    runtime.setProp(visualizer, "pwrappedparts", LingoPropList.fromPairs([
      ["wall01", wallWrapper],
      ["floor01", floorWrapper],
    ]));
    runtime.setProp(manager, "pobjectlist", objectList);
    runtime.setProp(manager, "pupdatelist", updateList);
    runtime.setProp(manager, "ppreparelist", prepareList);
    runtime.setProp(manager, "pinstancelist", instanceList);
    runtime.setProp(manager, "pmanagerlist", new LingoList());
    runtime.setProp(manager, "peraselock", 0);

    expect(runtime.callMethod(manager, "remove", ["Room_visualizer"])).toBe(1);

    expect(wrapperDeconstructs).toBe(2);
    expect(objectList.keys).toEqual(["uid:unrelated"]);
    expect(objectList.values).toEqual([unrelatedWrapper]);
    expect(instanceList.items).toEqual(["uid:unrelated"]);
    expect(updateList.items).toEqual([unrelatedWrapper]);
    expect(prepareList.items).toEqual([unrelatedWrapper]);
    expect(runtime.getProp(wallWrapper, "valid")).toBe(0);
    expect(runtime.getProp(floorWrapper, "valid")).toBe(0);
    expect(runtime.getProp(unrelatedWrapper, "valid")).toBe(1);
  });

  it("resolves manager item ids through pItemList when callers use string ids", () => {
    const runtime = new Runtime();
    const connection = new ScriptInstance({
      scriptName: "Connection Instance Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const objectManager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: ["pObjectList"],
      scriptGlobals: [],
      handlers: {
        get(ctx, me, args) {
          const objectList = ctx.getInstanceProp(args[0] ?? me, "pobjectlist");
          const value = ctx.getIndex(objectList, [args[1] ?? LINGO_VOID], null);
          return value === LINGO_VOID ? 0 : value;
        },
      },
    });
    const managerTemplate = new ScriptInstance({
      scriptName: "Manager Template Class",
      scriptType: "parent",
      scriptProperties: ["pItemList"],
      scriptGlobals: [],
      handlers: {
        get(ctx, _me, args) {
          return ctx.callMethod(objectManager, "get", [args[1] ?? LINGO_VOID]);
        },
      },
    });
    const connectionManager = new ScriptInstance({
      scriptName: "Connection Manager Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        create(_ctx, _me, args) {
          return args[1] ?? LINGO_VOID;
        },
        registerlistener(_ctx, _me, args) {
          return args[1] ?? LINGO_VOID;
        },
      },
    });

    runtime.setProp(objectManager, "pobjectlist", LingoPropList.fromPairs([[symbol("info"), connection]]));
    runtime.setIndex(connectionManager, [symbol("ancestor")], null, managerTemplate);
    runtime.setProp(connectionManager, "pitemlist", new LingoList([symbol("info")]));

    expect(runtime.callMethod(objectManager, "get", ["info"])).toBe(0);
    expect(runtime.callMethod(connectionManager, "get", ["info"])).toBe(connection);
    expect(runtime.callMethod(connectionManager, "create", ["info", "127.0.0.1", 12326])).toBe(symbol("info"));
    expect(runtime.callMethod(connectionManager, "registerlistener", ["info", "client", new LingoPropList()])).toBe(
      symbol("info"),
    );
  });

  it("resolves global Object API string singleton ids exact-first", () => {
    const runtime = new Runtime();
    const session = new ScriptInstance({
      scriptName: "Variable Container Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const thread = new ScriptInstance({
      scriptName: "Room Interface Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const window = new ScriptInstance({
      scriptName: "Window Instance Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const wrapper = new ScriptInstance({
      scriptName: "Multicomponent Window Wrapper Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const objectList = LingoPropList.fromPairs([
      [symbol("session"), session],
      [symbol("room_interface"), thread],
      ["Room_interface", window],
      ["ig_window_wrapper", wrapper],
    ]);
    const objectManager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: ["pObjectList"],
      scriptGlobals: [],
      handlers: {
        get(ctx, _me, args) {
          const value = ctx.getIndex(objectList, [args[1] ?? LINGO_VOID], null);
          return value === LINGO_VOID ? 0 : value;
        },
        exists(ctx, _me, args) {
          const value = ctx.getIndex(objectList, [args[1] ?? LINGO_VOID], null);
          return value instanceof ScriptInstance ? 1 : 0;
        },
      },
    });
    runtime.setProp(objectManager, "pobjectlist", objectList);
    runtime.setGlobal("gcore", objectManager);
    runtime.register(
      {
        scriptName: "Object API",
        scriptType: "movie",
        scriptProperties: [],
        scriptGlobals: ["gCore"],
        handlers: {
          getobject(ctx, me, args) {
            return ctx.callMethod(ctx.getGlobal("gcore"), "get", [args[0] ?? LINGO_VOID]);
          },
          objectexists(ctx, me, args) {
            return ctx.callMethod(ctx.getGlobal("gcore"), "exists", [args[0] ?? LINGO_VOID]);
          },
        },
      },
      "test",
    );

    expect(runtime.callMethod(objectManager, "get", ["session"])).toBe(0);
    expect(runtime.call("getObject", ["session"])).toBe(session);
    expect(runtime.call("objectExists", ["session"])).toBe(1);
    expect(runtime.call("getObject", ["Room_interface"])).toBe(window);
    expect(runtime.callMethod(objectManager, "get", ["Room_interface"])).toBe(window);
    expect(runtime.callMethod(objectManager, "get", [symbol("ig_window_wrapper")])).toBe(0);
    expect(runtime.call("getObject", [symbol("ig_window_wrapper")])).toBe(wrapper);
    expect(runtime.call("objectExists", [symbol("ig_window_wrapper")])).toBe(1);
    expect(runtime.call("getObject", ["missing"])).toBe(0);
  });

  it("keeps Object Manager string window ids distinct from symbol thread ids during creation", () => {
    const runtime = new Runtime();
    const thread = new ScriptInstance({
      scriptName: "Room Interface Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const window = new ScriptInstance({
      scriptName: "Window Instance Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });
    const objectList = LingoPropList.fromPairs([[symbol("room_interface"), thread]]);
    const objectManager = new ScriptInstance({
      scriptName: "Object Manager Class",
      scriptType: "parent",
      scriptProperties: ["pObjectList"],
      scriptGlobals: [],
      handlers: {
        create(ctx, me, args) {
          const id = args[1] ?? LINGO_VOID;
          const existing = ctx.getIndex(ctx.getInstanceProp(me, "pobjectlist"), [id], null);
          if (ctx.callLocal(me, "objectp", [existing])) {
            return "already-exists";
          }
          const object = args[2] ?? LINGO_VOID;
          ctx.setIndex(ctx.getInstanceProp(me, "pobjectlist"), [id], null, object);
          return object;
        },
        get(ctx, me, args) {
          const value = ctx.getIndex(ctx.getInstanceProp(me, "pobjectlist"), [args[1] ?? LINGO_VOID], null);
          return value === LINGO_VOID ? 0 : value;
        },
      },
    });
    runtime.setProp(objectManager, "pobjectlist", objectList);

    expect(runtime.callMethod(objectManager, "get", ["Room_interface"])).toBe(0);
    expect(runtime.callMethod(objectManager, "create", ["Room_interface", window])).toBe(window);
    expect(runtime.callMethod(objectManager, "get", ["Room_interface"])).toBe(window);
    expect(runtime.callMethod(objectManager, "get", [symbol("room_interface")])).toBe(thread);
    expect(objectList.keys).toEqual([symbol("room_interface"), "Room_interface"]);
  });
});
