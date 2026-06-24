import { describe, expect, it } from "vitest";
import { DirectorMovie, type MovieManifest } from "../../src/director/Movie";
import { CastRegistry } from "../../src/director/members";
import { ScriptInstance } from "../../src/director/Runtime";
import { LINGO_VOID, symbol } from "../../src/director/values";

function emptyManifest(): MovieManifest {
  return {
    stage: { width: 960, height: 540, backgroundColor: "#000000" },
    casts: [],
    score: { frameRate: 12, markers: [], behaviors: [], frames: [{ index: 1 }] },
  };
}

function createMovie(): DirectorMovie {
  const members = new CastRegistry({ movie: { casts: [] }, textFields: [], bitmaps: [] }, "/origins-data/assets/");
  return new DirectorMovie(emptyManifest(), { log: () => {} }, async () => {}, async () => "", members);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Director timeout objects", () => {
  it("dispatches method-syntax timeout new calls to script instances", async () => {
    const movie = createMovie();
    let calls = 0;
    let sawTargetAsMe = false;
    let timeoutName = "";
    const target = new ScriptInstance({
      scriptName: "Delay Target",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        executedelay(ctx, _me, args) {
          calls += 1;
          sawTargetAsMe = args[0] === target;
          timeoutName = String(ctx.getProp(args[1] ?? LINGO_VOID, "name"));
          return 1;
        },
      },
    });

    const timeout = movie.call("timeout", ["Delay navigator_component 1"]);
    expect(timeout).toBeTruthy();
    movie.runtime.callMethod(timeout ?? LINGO_VOID, "new", [1, symbol("executeDelay"), target]);

    await wait(4);
    movie.tick();

    expect(calls).toBe(1);
    expect(sawTargetAsMe).toBe(true);
    expect(timeoutName).toBe("delay navigator_component 1");
  });

  it("cancels method-syntax timeout forget calls", async () => {
    const movie = createMovie();
    let calls = 0;
    const target = new ScriptInstance({
      scriptName: "Delay Target",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        executedelay() {
          calls += 1;
          return 1;
        },
      },
    });

    const timeout = movie.call("timeout", ["Delay navigator_component 2"]);
    expect(timeout).toBeTruthy();
    movie.runtime.callMethod(timeout ?? LINGO_VOID, "new", [1, symbol("executeDelay"), target]);
    movie.runtime.callMethod(timeout ?? LINGO_VOID, "forget", []);

    await wait(4);
    movie.tick();

    expect(calls).toBe(0);
  });
});
