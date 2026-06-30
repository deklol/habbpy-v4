import { describe, expect, it } from "vitest";
import { DirectorMovie, type MovieManifest } from "../../src/director/Movie";
import { ScriptInstance, ScriptRef, type GeneratedScriptModule } from "../../src/director/Runtime";
import { LingoColor, LingoDate, LingoRect } from "../../src/director/geometry";
import { CastMember, CastRegistry } from "../../src/director/members";
import { LingoImage } from "../../src/director/imaging";
import { paletteTableForBitmapDepth } from "../../src/director/palettes";
import { SpriteChannel } from "../../src/director/sprites";
import { LINGO_VOID, LingoFloat, LingoList, LingoPropList, type LingoValue, symbol } from "../../src/director/values";

function manifestWithCasts(): MovieManifest {
  return {
    stage: { width: 800, height: 600, backgroundColor: "#000000" },
    casts: [
      {
        number: 1,
        name: "Internal",
        members: [{ number: 1, name: "local-one", type: "bitmap" }],
      },
      {
        number: 11,
        name: "hh_entry_uk",
        members: [
          { number: 26, name: "car1", type: "bitmap" },
          { number: 28, name: "bus1", type: "bitmap" },
        ],
      },
      {
        number: 12,
        name: "alternate",
        members: [{ number: 26, name: "other-car", type: "bitmap" }],
      },
    ],
    score: {
      frameRate: 12,
      markers: [],
      behaviors: [],
      frames: [{ index: 1 }],
    },
  };
}

function createMovie(members: CastRegistry): DirectorMovie {
  return new DirectorMovie(
    manifestWithCasts(),
    { log: () => {} },
    async () => {},
    async () => "",
    members,
  );
}

describe("Director sprite and member host properties", () => {
  it("resolves sprite objects passed back to sprite and puppetSprite", () => {
    const members = new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/");
    const movie = createMovie(members);
    const sprite = movie.runtime.call("sprite", [5]) as SpriteChannel;

    expect(movie.runtime.call("sprite", [sprite])).toBe(sprite);
    expect(movie.runtime.call("puppetSprite", [sprite, 1])).toBe(1);
    expect(sprite.puppet).toBe(1);
  });

  it("reports an opt-in live stage viewport through Director stage APIs", () => {
    const manifest = manifestWithCasts();
    const members = new CastRegistry({ movie: manifest, textFields: [], bitmaps: [] }, "/assets/");
    const movie = createMovie(members);

    expect(movie.runtime.theProp("stageRight")).toBe(800);
    expect(movie.runtime.theProp("stageBottom")).toBe(600);

    movie.setStageViewport(1280, 720);

    expect(movie.runtime.theProp("stageRight")).toBe(1280);
    expect(movie.runtime.theProp("stageBottom")).toBe(720);

    const stage = movie.runtime.theProp("stage");
    const sourceRect = movie.getProp(stage, "sourcerect") as LingoRect;
    const drawRect = movie.getProp(stage, "drawrect") as LingoRect;
    const stageImage = movie.getProp(stage, "image") as LingoValue;

    expect(sourceRect.width).toBe(800);
    expect(sourceRect.height).toBe(600);
    expect(drawRect.width).toBe(1280);
    expect(drawRect.height).toBe(720);
    expect(movie.getProp(stageImage, "width")).toBe(1280);
    expect(movie.getProp(stageImage, "height")).toBe(720);

    movie.resetStageViewport();
    expect(movie.runtime.theProp("stageRight")).toBe(800);
    expect(movie.runtime.theProp("stageBottom")).toBe(600);
  });

  it("assigns sprite members from globally unique member numbers", () => {
    const manifest = manifestWithCasts();
    const members = new CastRegistry({ movie: manifest, textFields: [], bitmaps: [] }, "/assets/");
    members.loadCast("Internal");
    members.loadCast("hh_entry_uk");
    const movie = createMovie(members);
    const sprite = movie.call("sprite", [5]) as SpriteChannel;
    const car = members.find("car1", "hh_entry_uk")!;

    movie.setProp(sprite, "castnum", car.slotNumber);

    expect(movie.getProp(sprite, "member")).toBe(car);
    expect(movie.getProp(sprite, "castnum")).toBe(car.slotNumber);
    expect(movie.getProp(sprite, "castlibnum")).toBe(11);
  });

  it("uses sprite.castLibNum to resolve local castNum assignments", () => {
    const manifest = manifestWithCasts();
    const members = new CastRegistry({ movie: manifest, textFields: [], bitmaps: [] }, "/assets/");
    members.loadCast("hh_entry_uk");
    members.loadCast("alternate");
    const movie = createMovie(members);
    const sprite = movie.call("sprite", [5]) as SpriteChannel;

    movie.setProp(sprite, "castlibnum", 12);
    movie.setProp(sprite, "castnum", 26);

    expect((movie.getProp(sprite, "member") as CastMember).name).toBe("other-car");
    expect(movie.getProp(sprite, "castlibnum")).toBe(12);
  });

  it("computes sprite edges from loc and member registration point", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 7, "registered", "bitmap", {
      bitmap: { width: 42, height: 34, regX: 5, regY: 8, pngUrl: "/registered.png" },
    });
    const sprite = movie.call("sprite", [5]) as SpriteChannel;

    movie.setProp(sprite, "member", member);
    movie.setProp(sprite, "loc", movie.runtime.call("point", [100, 50]));

    expect(movie.getProp(sprite, "rect")).toEqual(new LingoRect(95, 42, 137, 76));
    expect(movie.getProp(sprite, "left")).toBe(95);
    expect(movie.getProp(sprite, "top")).toBe(42);
    expect(movie.getProp(sprite, "right")).toBe(137);
    expect(movie.getProp(sprite, "bottom")).toBe(76);

    movie.setProp(sprite, "right", 150);
    expect(movie.getProp(sprite, "loch")).toBe(113);
    expect(movie.getProp(sprite, "left")).toBe(108);
  });

  it("applies sprite rect writes so released channels do not keep stale size", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 8, "registered", "bitmap", {
      bitmap: { width: 40, height: 20, regX: 10, regY: 5, pngUrl: "/registered.png" },
    });
    const sprite = movie.call("sprite", [5]) as SpriteChannel;

    movie.setProp(sprite, "member", member);
    movie.setProp(sprite, "rect", new LingoRect(20, 30, 100, 70));

    expect(movie.getProp(sprite, "width")).toBe(80);
    expect(movie.getProp(sprite, "height")).toBe(40);
    expect(movie.getProp(sprite, "rect")).toEqual(new LingoRect(20, 30, 100, 70));

    movie.setProp(sprite, "member", 0);
    movie.setProp(sprite, "rect", new LingoRect(0, 0, 1, 1));

    expect(movie.getProp(sprite, "width")).toBe(1);
    expect(movie.getProp(sprite, "height")).toBe(1);
    expect(movie.getProp(sprite, "rect")).toEqual(new LingoRect(0, 0, 1, 1));
  });

  it("resets immediate sprite state when puppet control is disabled", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 18, "mirrored-room-object", "bitmap", {
      bitmap: { width: 40, height: 20, regX: 10, regY: 5, pngUrl: "/mirrored-room-object.png" },
    });
    const sprite = movie.call("sprite", [5]) as SpriteChannel;
    const behavior = new ScriptInstance({
      scriptName: "Mouse Receiver",
      scriptType: "behavior",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    });

    movie.runtime.call("puppetsprite", [5, 1]);
    movie.setProp(sprite, "member", member);
    movie.setProp(sprite, "loc", movie.runtime.call("point", [100, 50]));
    movie.setProp(sprite, "locz", 200);
    movie.setProp(sprite, "rect", new LingoRect(20, 30, 100, 70));
    movie.setProp(sprite, "ink", 36);
    movie.setProp(sprite, "blend", 70);
    movie.setProp(sprite, "visible", 1);
    movie.setProp(sprite, "stretch", 1);
    movie.setProp(sprite, "trails", 1);
    movie.setProp(sprite, "fliph", 1);
    movie.setProp(sprite, "flipv", 1);
    movie.setProp(sprite, "rotation", 180);
    movie.setProp(sprite, "skew", 180);
    movie.setProp(sprite, "editable", 1);
    movie.setProp(sprite, "scriptinstancelist", new LingoList([behavior]));
    movie.runtime.call("setid", [sprite, "leaky-ui-target"]);

    movie.runtime.call("puppetsprite", [5, 0]);

    expect(movie.getProp(sprite, "puppet")).toBe(0);
    expect(movie.getProp(sprite, "member")).toBe(0);
    expect(movie.getProp(sprite, "castlibnum")).toBe(0);
    expect(movie.getProp(sprite, "loch")).toBe(0);
    expect(movie.getProp(sprite, "locv")).toBe(0);
    expect(movie.getProp(sprite, "locz")).toBe(5);
    expect(movie.getProp(sprite, "ink")).toBe(0);
    expect(movie.getProp(sprite, "blend")).toBe(100);
    expect(movie.getProp(sprite, "visible")).toBe(0);
    expect(movie.getProp(sprite, "width")).toBe(0);
    expect(movie.getProp(sprite, "height")).toBe(0);
    expect(movie.getProp(sprite, "stretch")).toBe(0);
    expect(movie.getProp(sprite, "trails")).toBe(0);
    expect(movie.getProp(sprite, "fliph")).toBe(0);
    expect(movie.getProp(sprite, "flipv")).toBe(0);
    expect(movie.getProp(sprite, "rotation")).toBe(0);
    expect(movie.getProp(sprite, "skew")).toBe(0);
    expect(movie.getProp(sprite, "editable")).toBe(0);
    expect(movie.getProp(sprite, "scriptinstancelist")).toEqual(new LingoList());
    expect(movie.runtime.call("getid", [sprite])).toBe(0);
  });

  it("hit-tests mirrored alias sprites at their rendered bounds", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 19, "mirrored-furni", "bitmap", {
      bitmap: { width: 49, height: 40, regX: -8, regY: 29, pngUrl: "/mirrored-furni.png" },
    });
    const sprite = movie.call("sprite", [5]) as SpriteChannel;

    movie.setProp(sprite, "member", member);
    movie.setProp(sprite, "puppet", 1);
    movie.setProp(sprite, "loc", movie.runtime.call("point", [186, 211]));
    movie.setProp(sprite, "rotation", 180);
    movie.setProp(sprite, "skew", 180);

    expect(movie.getProp(sprite, "rect")).toEqual(new LingoRect(129, 182, 178, 222));
    expect(movie.spritesAt(150, 200)).toEqual([sprite]);
    expect(movie.spritesAt(220, 200)).toEqual([]);
  });

  it("unwraps LingoFloat values for sprite numeric assignments", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const sprite = movie.call("sprite", [5]) as SpriteChannel;

    movie.setProp(sprite, "loch", new LingoFloat(10.4));
    movie.setProp(sprite, "locv", new LingoFloat(296.6));
    movie.setProp(sprite, "width", new LingoFloat(42.5));
    movie.setProp(sprite, "height", new LingoFloat(12.2));

    expect(movie.getProp(sprite, "loch")).toBe(10);
    expect(movie.getProp(sprite, "locv")).toBe(297);
    expect(movie.getProp(sprite, "width")).toBe(43);
    expect(movie.getProp(sprite, "height")).toBe(12);
  });

  it("exposes member and image paletteRef for window compositing", () => {
    const member = new CastMember("bin", 99, 1, "window_buffer", "bitmap");
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const image = movie.runtime.call("image", [40, 20, 8, symbol("systemWin")]) as LingoImage;

    expect(movie.runtime.getProp(image, "paletteRef")).toBe(symbol("systemWin"));
    movie.runtime.setProp(image, "paletteRef", symbol("systemMac"));
    expect(movie.runtime.getProp(image, "paletteRef")).toBe(symbol("systemMac"));

    movie.setProp(member, "image", image);
    expect(movie.getProp(member, "paletteref")).toBe(symbol("systemMac"));

    movie.setProp(member, "paletteref", symbol("rainbow"));
    expect(movie.getProp(member, "paletteref")).toBe(symbol("rainbow"));
    expect(movie.runtime.getProp(image, "paletteref")).toBe(symbol("rainbow"));

    movie.setProp(member, "palette", symbol("systemMac"));
    expect(movie.getProp(member, "palette")).toBe(symbol("systemMac"));
    expect(movie.getProp(member, "paletteref")).toBe(symbol("systemMac"));
  });

  it("reports empty scriptText for non-script members so bitmap media is not rejected as script data", () => {
    const member = new CastMember("bin", 99, 2, "runtime_photo_bitmap", "bitmap");
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));

    expect(movie.runtime.getProp(member, "scriptText")).toBe("");
  });

  it("keeps retrieved photo bitmap media when source fallback tries to apply photo_invalid", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const palette = paletteTableForBitmapDepth("grayscale", 8);
    const retrieved = LingoImage.fromPaletteIndices(2, 1, new Uint8Array([8, 16]), palette, symbol("grayscale"), 8);
    const invalid = LingoImage.fromPaletteIndices(2, 1, new Uint8Array([200, 220]), palette, symbol("grayscale"), 8);
    const targetMember = new CastMember("bin", 99, 2, "runtime_photo_bitmap", "bitmap");
    const invalidMember = new CastMember("hh_photo", 7, 1, "photo_invalid", "bitmap");

    movie.runtime.setProp(targetMember, "media", retrieved.toDirectorBitmapMedia());
    movie.runtime.setProp(invalidMember, "image", invalid);
    movie.runtime.setProp(targetMember, "media", movie.runtime.getProp(invalidMember, "media"));

    expect(targetMember.image?.getPixel(0, 0).paletteIndex).toBe(8);
    expect(targetMember.image?.getPixel(1, 0).paletteIndex).toBe(16);
  });

  it("returns a Director date object for the systemDate property", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const date = movie.runtime.theProp("systemdate");
    const now = new Date();

    expect(date).toBeInstanceOf(LingoDate);
    expect(movie.runtime.getProp(date, "year")).toBe(now.getFullYear());
    expect(movie.runtime.getProp(date, "month")).toBe(now.getMonth() + 1);
    expect(movie.runtime.getProp(date, "day")).toBe(now.getDate());
  });

  it("exposes movie tempo and global text selection properties", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));

    expect(movie.runtime.theProp("frameTempo")).toBe(12);
    movie.runtime.setTheProp("selStart", 7);
    movie.runtime.setTheProp("selEnd", 9);

    expect(movie.runtime.theProp("selStart")).toBe(7);
    expect(movie.runtime.theProp("selEnd")).toBe(9);
  });

  it("allows source timeout manager to clear timeout host fields", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const timeout = movie.call("timeout", ["uid:1"])!;

    movie.setProp(timeout, "target", symbol("client"));
    movie.setProp(timeout, "timeouthandler", symbol("executeTimeOut"));
    movie.setProp(timeout, "period", 250);

    expect(movie.getProp(timeout, "target")).toBe(symbol("client"));
    expect(movie.getProp(timeout, "timeouthandler")).toBe(symbol("executeTimeOut"));
    expect(movie.getProp(timeout, "period")).toBe(250);

    movie.setProp(timeout, "target", LINGO_VOID);

    expect(movie.getProp(timeout, "target")).toBe(LINGO_VOID);
  });

  it("exposes Director sound channel instances used by the source sound manager", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const channel = movie.runtime.call("sound", [new LingoFloat(1)]);
    const soundMember = new CastMember("sounds", 5, 1, "beep", "sound");
    const soundEntry = LingoPropList.fromPairs([
      [symbol("member"), soundMember],
      [symbol("loopCount"), 1],
    ]);

    expect(movie.runtime.call("sound", [1])).toBe(channel);
    expect(movie.runtime.call("ilk", [channel])).toBe(symbol("instance"));
    expect(movie.getProp(soundMember, "duration")).toBe(0);

    movie.runtime.setProp(channel, "volume", 123);
    expect(movie.runtime.getProp(channel, "volume")).toBe(123);

    expect(movie.runtime.callMethod(channel, "play", [soundEntry])).toBe(1);
    expect(movie.runtime.callMethod(channel, "isbusy", [])).toBe(1);
    expect(movie.runtime.getProp(channel, "member")).toBe(soundMember);

    expect(movie.runtime.callMethod(channel, "queue", [soundEntry])).toBe(1);
    expect(movie.runtime.getProp(movie.runtime.callMethod(channel, "getplaylist", []), "count")).toBe(1);

    expect(movie.runtime.callMethod(channel, "setplaylist", [new LingoList()])).toBe(1);
    expect(movie.runtime.getProp(movie.runtime.callMethod(channel, "getplaylist", []), "count")).toBe(0);
    expect(movie.runtime.callMethod(channel, "stop", [])).toBe(1);
    expect(movie.runtime.callMethod(channel, "isbusy", [])).toBe(0);
  });

  it("applies native editable text input before keyDown handlers observe the field", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 8, "editable", "field", { text: "" });
    member.style.set("editable", 1);
    const sprite = movie.call("sprite", [5]) as SpriteChannel;
    movie.setProp(sprite, "member", member);
    movie.setProp(sprite, "editable", 1);
    movie.setProp(sprite, "puppet", 1);
    movie.keyboardFocusSprite = 5;
    sprite.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Key Observer",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          keydown() {
            member.text = `seen:${member.text}`;
            return 0;
          },
        },
      }),
    );

    movie.keyDown("a", 65, false);

    expect(member.text).toBe("seen:a");
  });

  it("does not append again when a keyDown handler masks editable text", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 9, "editable", "field", { text: "" });
    member.style.set("editable", 1);
    const sprite = movie.call("sprite", [5]) as SpriteChannel;
    movie.setProp(sprite, "member", member);
    movie.setProp(sprite, "editable", 1);
    movie.setProp(sprite, "puppet", 1);
    movie.keyboardFocusSprite = 5;
    sprite.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Key Editor",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          keydown() {
            member.text = "*".repeat(member.text.length);
            return 1;
          },
        },
      }),
    );

    movie.keyDown("a", 65, false);

    expect(member.text).toBe("*");
  });

  it("moves keyboard focus through editable sprites on Tab in sprite number order", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    for (const number of [5, 7, 9]) {
      const member = new CastMember("test", 3, 20 + number, `editable_${number}`, "field", { text: "" });
      member.style.set("editable", 1);
      const sprite = movie.call("sprite", [number]) as SpriteChannel;
      movie.setProp(sprite, "member", member);
      movie.setProp(sprite, "editable", 1);
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "visible", 1);
    }

    movie.keyboardFocusSprite = 5;
    movie.keyDown("\t", 48, false);
    expect(movie.keyboardFocusSprite).toBe(7);

    movie.keyDown("\t", 48, true);
    expect(movie.keyboardFocusSprite).toBe(5);
  });

  it("keeps focus when a Tab keyDown handler consumes the event", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 30, "editable", "field", { text: "" });
    member.style.set("editable", 1);
    const first = movie.call("sprite", [5]) as SpriteChannel;
    const secondMember = new CastMember("test", 3, 31, "next", "field", { text: "" });
    secondMember.style.set("editable", 1);
    const second = movie.call("sprite", [6]) as SpriteChannel;
    for (const [sprite, field] of [
      [first, member],
      [second, secondMember],
    ] as const) {
      movie.setProp(sprite, "member", field);
      movie.setProp(sprite, "editable", 1);
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "visible", 1);
    }
    first.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Tab Consumer",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          keydown() {
            return 1;
          },
        },
      }),
    );

    movie.keyboardFocusSprite = 5;
    movie.keyDown("\t", 48, false);

    expect(movie.keyboardFocusSprite).toBe(5);
  });

  it("does not move focus when the focused member disables autoTab", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    for (const number of [5, 6]) {
      const member = new CastMember("test", 3, 40 + number, `editable_${number}`, "field", { text: "" });
      member.style.set("editable", 1);
      if (number === 5) member.style.set("autotab", 0);
      const sprite = movie.call("sprite", [number]) as SpriteChannel;
      movie.setProp(sprite, "member", member);
      movie.setProp(sprite, "editable", 1);
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "visible", 1);
    }

    movie.keyboardFocusSprite = 5;
    movie.keyDown("\t", 48, false);

    expect(movie.keyboardFocusSprite).toBe(5);
  });

  it("skips visual-only top sprites when dispatching mouse input", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const visual = new CastMember("test", 3, 10, "visual", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/visual.png" },
    });
    const lowerMember = new CastMember("test", 3, 11, "interactive", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/interactive.png" },
    });
    const lower = movie.call("sprite", [5]) as SpriteChannel;
    const top = movie.call("sprite", [6]) as SpriteChannel;
    const events: string[] = [];

    for (const sprite of [lower, top]) {
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "loc", movie.runtime.call("point", [0, 0]));
    }
    movie.setProp(lower, "member", lowerMember);
    movie.setProp(top, "member", visual);
    movie.setProp(lower, "locz", 100);
    movie.setProp(top, "locz", 200);
    lower.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Mouse Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mousedown() {
            events.push("down");
            return 1;
          },
          mouseup() {
            events.push("up");
            return 1;
          },
        },
      }),
    );

    movie.pointerMove(10, 10);
    movie.pointerDown();
    movie.pointerUp();

    expect(events).toEqual(["down", "up"]);
    expect(movie.runtime.theProp("rollover")).toBe(5);
  });

  it("recomputes the rollover from current sprite visibility", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const lowerMember = new CastMember("test", 3, 17, "lower", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/lower.png" },
    });
    const topMember = new CastMember("test", 3, 18, "top", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/top.png" },
    });
    const lower = movie.call("sprite", [5]) as SpriteChannel;
    const top = movie.call("sprite", [6]) as SpriteChannel;
    const handler = new ScriptInstance({
      scriptName: "Mouse Receiver",
      scriptType: "behavior",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {
        mousedown() {
          return 1;
        },
      },
    });

    for (const sprite of [lower, top]) {
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "loc", movie.runtime.call("point", [0, 0]));
      sprite.scriptInstanceList.items.push(handler);
    }
    movie.setProp(lower, "member", lowerMember);
    movie.setProp(top, "member", topMember);
    movie.setProp(lower, "locz", 100);
    movie.setProp(top, "locz", 200);

    movie.pointerMove(10, 10);
    expect(movie.runtime.theProp("rollover")).toBe(6);

    movie.setProp(top, "visible", 0);
    expect(movie.runtime.theProp("rollover")).toBe(5);

    movie.setProp(top, "visible", 1);
    expect(movie.runtime.theProp("rollover")).toBe(6);
  });

  it("exposes Director sprite references through the sprite property", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const sprite = movie.call("sprite", [5]) as SpriteChannel;

    expect(movie.getProp(sprite, "sprite")).toBe(sprite);
  });

  it("uses mouseUp-only sprites as pointer targets through visual overlays", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 12, "button", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/button.png" },
    });
    const overlayMember = new CastMember("test", 3, 13, "overlay", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/overlay.png" },
    });
    const button = movie.call("sprite", [5]) as SpriteChannel;
    const overlay = movie.call("sprite", [6]) as SpriteChannel;
    let clicked = 0;

    for (const sprite of [button, overlay]) {
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "loc", movie.runtime.call("point", [0, 0]));
    }
    movie.setProp(button, "member", member);
    movie.setProp(overlay, "member", overlayMember);
    movie.setProp(button, "locz", 100);
    movie.setProp(overlay, "locz", 200);
    button.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Click Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mouseup() {
            clicked += 1;
            return 1;
          },
        },
      }),
    );

    movie.pointerMove(10, 10);
    movie.pointerDown();
    movie.pointerUp();

    expect(clicked).toBe(1);
  });

  it("passes mouse events through transparent matte pixels on higher sprites", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const buttonMember = new CastMember("test", 3, 20, "button", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/button.png" },
    });
    const overlayMember = new CastMember("test", 3, 21, "overlay", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/overlay.png" },
    });
    overlayMember.image = {
      width: 40,
      height: 40,
      incomplete: false,
      getPixel: () => new LingoColor(255, 255, 255),
      getPixelAlpha: () => 255,
      isBoundaryConnectedColorPixel: () => true,
    } as unknown as LingoImage;
    const button = movie.call("sprite", [5]) as SpriteChannel;
    const overlay = movie.call("sprite", [6]) as SpriteChannel;
    let buttonClicked = 0;
    let overlayClicked = 0;

    for (const sprite of [button, overlay]) {
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "loc", movie.runtime.call("point", [0, 0]));
    }
    movie.setProp(button, "member", buttonMember);
    movie.setProp(overlay, "member", overlayMember);
    movie.setProp(button, "locz", 100);
    movie.setProp(overlay, "locz", 200);
    movie.setProp(overlay, "ink", 8);
    button.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Button Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mouseup() {
            buttonClicked += 1;
            return 1;
          },
        },
      }),
    );
    overlay.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Overlay Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mouseup() {
            overlayClicked += 1;
            return 1;
          },
        },
      }),
    );

    expect(movie.spritesAt(10, 10)[0]).toBe(overlay);
    expect(movie.inputSpriteAt(10, 10)).toBe(button);

    movie.pointerMove(10, 10);
    movie.pointerDown();
    movie.pointerUp();

    expect(buttonClicked).toBe(1);
    expect(overlayClicked).toBe(0);
  });

  it("keeps enclosed opaque white pixels clickable on matte image-buffer sprites", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const buttonMember = new CastMember("test", 3, 22, "button", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/button.png" },
    });
    const iconMember = new CastMember("test", 3, 23, "icon", "bitmap", {});
    iconMember.image = {
      width: 40,
      height: 40,
      incomplete: false,
      getPixel: () => new LingoColor(255, 255, 255),
      getPixelAlpha: () => 255,
      isBoundaryConnectedColorPixel: () => false,
      matteCoveragePolicyForDebug: () => "exact-white-transparent",
    } as unknown as LingoImage;
    const button = movie.call("sprite", [5]) as SpriteChannel;
    const icon = movie.call("sprite", [6]) as SpriteChannel;
    let buttonClicked = 0;
    let iconClicked = 0;

    for (const sprite of [button, icon]) {
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "loc", movie.runtime.call("point", [0, 0]));
    }
    movie.setProp(button, "member", buttonMember);
    movie.setProp(icon, "member", iconMember);
    movie.setProp(button, "locz", 100);
    movie.setProp(icon, "locz", 200);
    movie.setProp(icon, "ink", 8);
    button.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Button Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mouseup() {
            buttonClicked += 1;
            return 1;
          },
        },
      }),
    );
    icon.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Icon Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mouseup() {
            iconClicked += 1;
            return 1;
          },
        },
      }),
    );

    expect(movie.inputSpriteAt(10, 10)).toBe(icon);

    movie.pointerMove(10, 10);
    movie.pointerDown();
    movie.pointerUp();

    expect(buttonClicked).toBe(0);
    expect(iconClicked).toBe(1);
  });

  it("exposes Director doubleClick during second click on the same sprite", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const member = new CastMember("test", 3, 16, "button", "bitmap", {
      bitmap: { width: 40, height: 40, regX: 0, regY: 0, pngUrl: "/button.png" },
    });
    const button = movie.call("sprite", [5]) as SpriteChannel;
    const values: LingoValue[] = [];

    movie.setProp(button, "puppet", 1);
    movie.setProp(button, "loc", movie.runtime.call("point", [0, 0]));
    movie.setProp(button, "member", member);
    button.scriptInstanceList.items.push(
      new ScriptInstance({
        scriptName: "Click Receiver",
        scriptType: "behavior",
        scriptProperties: [],
        scriptGlobals: [],
        handlers: {
          mousedown(ctx) {
            values.push(ctx.theProp("doubleClick"));
            return 1;
          },
        },
      }),
    );

    movie.pointerMove(10, 10);
    movie.pointerDown();
    movie.pointerUp();
    movie.pointerDown();
    movie.pointerUp();

    expect(values).toEqual([0, 1]);
  });

  it("focuses editable field sprites through visual overlays", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const fieldMember = new CastMember("test", 3, 14, "editable", "field", { text: "" });
    fieldMember.style.set("editable", 1);
    fieldMember.style.set("rect", new LingoRect(0, 0, 80, 20));
    const overlayMember = new CastMember("test", 3, 15, "overlay", "bitmap", {
      bitmap: { width: 80, height: 20, regX: 0, regY: 0, pngUrl: "/overlay.png" },
    });
    const field = movie.call("sprite", [5]) as SpriteChannel;
    const overlay = movie.call("sprite", [6]) as SpriteChannel;

    for (const sprite of [field, overlay]) {
      movie.setProp(sprite, "puppet", 1);
      movie.setProp(sprite, "loc", movie.runtime.call("point", [0, 0]));
    }
    movie.setProp(field, "member", fieldMember);
    movie.setProp(field, "editable", 1);
    movie.setProp(field, "locz", 100);
    movie.setProp(overlay, "member", overlayMember);
    movie.setProp(overlay, "locz", 200);

    movie.pointerMove(10, 10);
    movie.pointerDown();

    expect(movie.keyboardFocusSprite).toBe(5);
  });

  it("focuses empty editable ink sprites over their full field rectangle", () => {
    const movie = createMovie(new CastRegistry({ movie: manifestWithCasts(), textFields: [], bitmaps: [] }, "/assets/"));
    const fieldMember = new CastMember("test", 3, 16, "empty_editable", "field", { text: "" });
    fieldMember.style.set("editable", 1);
    movie.setProp(fieldMember, "rect", new LingoRect(0, 0, 160, 16));
    movie.setProp(fieldMember, "color", new LingoColor(0, 0, 0));
    const field = movie.call("sprite", [5]) as SpriteChannel;

    movie.setProp(field, "member", fieldMember);
    movie.setProp(field, "editable", 1);
    movie.setProp(field, "puppet", 1);
    movie.setProp(field, "visible", 1);
    movie.setProp(field, "ink", 36);
    movie.setProp(field, "loc", movie.runtime.call("point", [20, 30]));
    movie.setProp(field, "locz", 100);
    movie.prepareTextSpriteImages();

    movie.pointerMove(80, 38);
    movie.pointerDown();
    movie.keyDown("a", 65, false);

    expect(movie.keyboardFocusSprite).toBe(5);
    expect(fieldMember.text).toBe("a");
  });

  it("resolves duplicate script names by loaded cast member", () => {
    const manifest: MovieManifest = {
      stage: { width: 800, height: 600, backgroundColor: "#000000" },
      casts: [
        {
          number: 20,
          name: "cast_a",
          members: [{ number: 1, name: "Entry Car Class", type: "script" }],
        },
        {
          number: 21,
          name: "cast_b",
          members: [{ number: 1, name: "Entry Car Class", type: "script" }],
        },
      ],
      score: {
        frameRate: 12,
        markers: [],
        behaviors: [],
        frames: [{ index: 1 }],
      },
    };
    const members = new CastRegistry({ movie: manifest, textFields: [], bitmaps: [] }, "/assets/");
    members.loadCast("cast_a");
    members.loadCast("cast_b");
    const movie = new DirectorMovie(manifest, { log: () => {} }, async () => {}, async () => "", members);
    const moduleA: GeneratedScriptModule = {
      scriptName: "Entry Car Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    };
    const moduleB: GeneratedScriptModule = {
      scriptName: "Entry Car Class",
      scriptType: "parent",
      scriptProperties: [],
      scriptGlobals: [],
      handlers: {},
    };
    movie.runtime.register(moduleA, "cast_a", { memberNumber: 1 });
    movie.runtime.register(moduleB, "cast_b", { memberNumber: 1 });

    const refA = movie.call("script", [members.find(1, "cast_a")!.slotNumber]);
    const refB = movie.call("script", [members.find(1, "cast_b")!.slotNumber]);

    expect(refA).toBeInstanceOf(ScriptRef);
    expect(refB).toBeInstanceOf(ScriptRef);
    expect((refA as ScriptRef).module).toBe(moduleA);
    expect((refB as ScriptRef).module).toBe(moduleB);
  });

  it("resolves field text within the requested castLib", () => {
    const manifest: MovieManifest = {
      stage: { width: 800, height: 600, backgroundColor: "#000000" },
      casts: [
        {
          number: 20,
          name: "cast_a",
          members: [{ number: 1, name: "thread.index", type: "field" }],
        },
        {
          number: 21,
          name: "cast_b",
          members: [{ number: 1, name: "thread.index", type: "field" }],
        },
      ],
      score: {
        frameRate: 12,
        markers: [],
        behaviors: [],
        frames: [{ index: 1 }],
      },
    };
    const members = new CastRegistry(
      {
        movie: manifest,
        textFields: [
          { castName: "cast_a", member: 1, memberName: "thread.index", text: "thread.id = a" },
          { castName: "cast_b", member: 1, memberName: "thread.index", text: "thread.id = b" },
        ],
        bitmaps: [],
      },
      "/assets/",
    );
    members.loadCast("cast_a");
    members.loadCast("cast_b");
    const movie = new DirectorMovie(manifest, { log: () => {} }, async () => {}, async () => "", members);

    expect(movie.call("field", ["thread.index", 20])).toBe("thread.id = a");
    expect(movie.call("field", ["thread.index", 21])).toBe("thread.id = b");
  });

  it("indexes a dynamically loaded cast at its assigned castLib slot", () => {
    const manifest: MovieManifest = {
      stage: { width: 800, height: 600, backgroundColor: "#000000" },
      casts: [
        {
          number: 645,
          name: "hh_shared",
          members: [{ number: 1, name: "thread.hobba", type: "field" }],
        },
        {
          number: 646,
          name: "empty",
          members: [],
        },
      ],
      score: {
        frameRate: 12,
        markers: [],
        behaviors: [],
        frames: [{ index: 1 }],
      },
    };
    const members = new CastRegistry(
      {
        movie: manifest,
        textFields: [
          { castName: "hh_shared", member: 1, memberName: "thread.hobba", text: "thread.id = hobba" },
        ],
        bitmaps: [],
      },
      "/assets/",
    );
    members.loadCast("hh_shared");
    expect(members.find("thread.hobba", "hh_shared")!.slotNumber).toBe((645 << 16) | 1);
    const movie = new DirectorMovie(manifest, { log: () => {} }, async () => {}, async () => "", members);
    const castLib = movie.runtime.call("castLib", [646]);

    movie.runtime.setProp(castLib, "fileName", "/origins-data/client/hh_shared.cct");
    const threadMember = movie.runtime.call("member", ["thread.hobba", 646]) as CastMember;
    const globalNumber = (646 << 16) | 1;

    expect(movie.runtime.getProp(threadMember, "castLibNum")).toBe(646);
    expect(movie.runtime.getProp(threadMember, "number")).toBe(globalNumber);
    expect(movie.runtime.call("field", [globalNumber])).toBe("thread.id = hobba");
    expect(movie.runtime.getProp(movie.runtime.call("member", [globalNumber]), "castLibNum")).toBe(646);
  });

  it("creates dynamic bin members with globally unique member numbers", () => {
    const manifest: MovieManifest = {
      stage: { width: 800, height: 600, backgroundColor: "#000000" },
      casts: [
        {
          number: 1,
          name: "Internal",
          members: [{ number: 1, name: "local-one", type: "bitmap" }],
        },
      ],
      score: {
        frameRate: 12,
        markers: [],
        behaviors: [],
        frames: [{ index: 1 }],
      },
    };
    const members = new CastRegistry({ movie: manifest, textFields: [], bitmaps: [] }, "/assets/");
    members.loadCast("Internal");
    const movie = new DirectorMovie(manifest, { log: () => {} }, async () => {}, async () => "", members);
    const bin = movie.runtime.call("castLib", ["bin"]);
    const created = movie.runtime.call("new", [symbol("bitmap"), bin]) as CastMember;

    movie.runtime.setProp(created, "name", "VizWrap_wall01");
    const globalNumber = movie.runtime.getProp(created, "number");

    expect(globalNumber).toBe((2 << 16) | 1);
    expect(movie.runtime.call("member", [globalNumber])).toBe(created);
    expect(movie.runtime.call("member", ["VizWrap_wall01"])).toBe(created);
    expect(movie.runtime.call("member", [1])).not.toBe(created);
  });
});
