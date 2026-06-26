import { describe, expect, it } from "vitest";
import { DirectorMovie, type MovieManifest } from "../../src/director/Movie";
import { ScriptInstance, type GeneratedScriptModule } from "../../src/director/Runtime";
import { CastMember, CastRegistry } from "../../src/director/members";
import { LingoPoint } from "../../src/director/geometry";
import { lingoKeyEquals } from "../../src/director/ops";
import { SpriteChannel } from "../../src/director/sprites";
import { OriginsResizeEngine } from "../../src/habbo/resizeEngine";
import { LINGO_VOID, LingoList, LingoPropList, LingoSymbol, symbol, type LingoValue } from "../../src/director/values";

function manifest(): MovieManifest {
  return {
    stage: { width: 960, height: 540, backgroundColor: "#000000" },
    casts: [],
    score: { frameRate: 24, markers: [], behaviors: [], frames: [{ index: 1 }] },
  };
}

function moduleFor(
  scriptName: string,
  scriptProperties: string[] = [],
  handlers: GeneratedScriptModule["handlers"] = {},
): GeneratedScriptModule {
  return {
    scriptName,
    scriptType: "parent",
    scriptProperties,
    scriptGlobals: [],
    handlers,
  };
}

function createMovie(): DirectorMovie {
  return new DirectorMovie(
    manifest(),
    { log: () => undefined },
    async () => undefined,
    async () => "",
    new CastRegistry({ movie: manifest(), textFields: [], bitmaps: [] }, "/assets/"),
  );
}

describe("OriginsResizeEngine", () => {
  it("only requires frame sync after viewport or manual room presentation offsets are active", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const roomVisualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pSpriteList", "pWrappedParts"]),
    );
    roomVisualizer.props.set("plocx", 0);
    roomVisualizer.props.set("plocy", 0);
    roomVisualizer.props.set("pspritelist", new LingoList());
    roomVisualizer.props.set("pwrappedparts", new LingoPropList());
    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", ["pWideScreenOffset"], {
        moveroomby(ctx, me, args) {
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          const visualizer = objectList.getaProp("Room_visualizer", (left: LingoValue, right: LingoValue) => left === right);
          if (visualizer instanceof ScriptInstance) {
            visualizer.props.set("plocx", Number(visualizer.props.get("plocx") ?? 0) + dx);
            visualizer.props.set("plocy", Number(visualizer.props.get("plocy") ?? 0) + dy);
          }
          return LINGO_VOID;
        },
      }),
    );
    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_visualizer", roomVisualizer, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);

    expect(engine.needsFrameSync()).toBe(false);
    engine.setViewport(1500, 760);
    expect(engine.needsFrameSync()).toBe(true);
    engine.setViewport(960, 540);
    expect(engine.needsFrameSync()).toBe(false);
    engine.dragRoomBy(12, 0);
    expect(engine.needsFrameSync()).toBe(true);
  });

  it("does not mutate Director's logical stage rect for presentation resize", () => {
    const movie = createMovie();
    const engine = new OriginsResizeEngine(movie);

    engine.setViewport(1500, 760);

    expect(movie.runtime.theProp("stageRight")).toBe(960);
    expect(movie.runtime.theProp("stageBottom")).toBe(540);
    const stage = movie.runtime.theProp("stage");
    const rect = movie.getProp(stage, "rect");
    expect(rect).toMatchObject({ left: 0, top: 0, right: 960, bottom: 540 });
  });

  it("keeps source-owned wall wrappers from being double-offset after resize", () => {
    const movie = createMovie();
    const objectList = new LingoPropList();
    const gCore = new ScriptInstance(moduleFor("Object Manager Class", ["pObjectList"]));
    gCore.props.set("pobjectlist", objectList);
    movie.runtime.setGlobal("gcore", gCore);

    const roomVisualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pSpriteList", "pWrappedParts"]),
    );
    roomVisualizer.props.set("plocx", 0);
    roomVisualizer.props.set("plocy", 0);

    const floorSprite = new SpriteChannel(10);
    floorSprite.locH = 32;
    floorSprite.locV = 0;
    const wallSprite = new SpriteChannel(11);
    wallSprite.locH = 32;
    wallSprite.locV = 0;
    roomVisualizer.props.set("pspritelist", new LingoList([floorSprite, wallSprite]));

    const floorWrapper = wrapper("floor", floorSprite, 32, 0);
    const wallWrapper = wrapper("wallleft", wallSprite, 32, 0, [{ locH: 120, locV: 80 }]);
    roomVisualizer.props.set(
      "pwrappedparts",
      LingoPropList.fromPairs([
        ["floor", floorWrapper],
        ["wall", wallWrapper],
      ]),
    );

    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", ["pWideScreenOffset"], {
        moveroomby(ctx, me, args) {
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          const visualizer = objectList.getaProp("Room_visualizer", (left: LingoValue, right: LingoValue) => left === right);
          if (visualizer instanceof ScriptInstance) {
            visualizer.props.set("plocx", Number(visualizer.props.get("plocx") ?? 0) + dx);
            visualizer.props.set("plocy", Number(visualizer.props.get("plocy") ?? 0) + dy);
            const sprites = visualizer.props.get("pspritelist");
            if (sprites instanceof LingoList) {
              for (const value of sprites.items) {
                if (!(value instanceof SpriteChannel)) continue;
                value.locH += dx;
                value.locV += dy;
              }
            }
            moveWrapperParts(visualizer, dx, dy);
          }
          return LINGO_VOID;
        },
        updatescreenoffset() {
          return LINGO_VOID;
        },
      }),
    );
    roomInterface.props.set("pwidescreenoffset", 32);

    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_visualizer", roomVisualizer, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    engine.setViewport(1500, 760);

    expect(roomVisualizer.props.get("plocx")).toBe(270);
    expect(roomVisualizer.props.get("plocy")).toBe(110);
    expect(floorSprite.locH).toBe(302);
    expect(floorSprite.locV).toBe(110);

    floorSprite.locH = 32;
    floorSprite.locV = 0;
    wallSprite.locH = 32;
    wallSprite.locV = 0;
    const snapshot = engine.apply("same-viewport-wrapper-refresh");

    expect(snapshot.anchors).toEqual(expect.arrayContaining([expect.objectContaining({ id: "wrapper:floor", action: "wrapper-follow" })]));
    expect(snapshot.anchors.some((anchor) => anchor.id === "wrapper:wall" && anchor.action === "wrapper-source-owned-corrected")).toBe(true);
    expect(roomVisualizer.props.get("plocx")).toBe(270);
    expect(roomVisualizer.props.get("plocy")).toBe(110);
    expect(floorSprite.locH).toBe(302);
    expect(floorSprite.locV).toBe(110);
    expect(wallSprite.locH).toBe(302);
    expect(wallSprite.locV).toBe(110);
  });

  it("resets the room presentation baseline when source rebuilds a visualizer in the same viewport", () => {
    const movie = createMovie();
    const objectList = new LingoPropList();
    const gCore = new ScriptInstance(moduleFor("Object Manager Class", ["pObjectList"]));
    gCore.props.set("pobjectlist", objectList);
    movie.runtime.setGlobal("gcore", gCore);

    const roomVisualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pLayout", "pSpriteList", "pWrappedParts"]),
    );
    roomVisualizer.props.set("plocx", 0);
    roomVisualizer.props.set("plocy", 0);
    roomVisualizer.props.set("playout", "model_a.room");

    const wallWrapperSprite = new SpriteChannel(13);
    wallWrapperSprite.locH = 0;
    wallWrapperSprite.locV = 0;
    roomVisualizer.props.set("pspritelist", new LingoList([wallWrapperSprite]));

    const wallWrapper = wrapper("wallleft", wallWrapperSprite, 0, 0);
    roomVisualizer.props.set("pwrappedparts", LingoPropList.fromPairs([["wall", wallWrapper]]));

    const objectShadow = new SpriteChannel(14);
    objectShadow.locH = 0;
    objectShadow.locV = 0;

    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", ["pWideScreenOffset"], {
        moveroomby(ctx, me, args) {
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          const visualizer = objectList.getaProp("Room_visualizer", (left: LingoValue, right: LingoValue) => left === right);
          if (visualizer instanceof ScriptInstance) {
            visualizer.props.set("plocx", Number(visualizer.props.get("plocx") ?? 0) + dx);
            visualizer.props.set("plocy", Number(visualizer.props.get("plocy") ?? 0) + dy);
            const sprites = visualizer.props.get("pspritelist");
            if (sprites instanceof LingoList) {
              for (const value of sprites.items) {
                if (!(value instanceof SpriteChannel)) continue;
                value.locH += dx;
                value.locV += dy;
              }
            }
          }
          objectShadow.locH += dx;
          objectShadow.locV += dy;
          return LINGO_VOID;
        },
      }),
    );
    roomInterface.props.set("pwidescreenoffset", 0);

    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_visualizer", roomVisualizer, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    engine.setViewport(1500, 760);

    expect(roomVisualizer.props.get("plocx")).toBe(270);
    expect(roomVisualizer.props.get("plocy")).toBe(110);
    expect(wallWrapperSprite.locH).toBe(270);
    expect(wallWrapperSprite.locV).toBe(110);
    expect(objectShadow.locH).toBe(270);
    expect(objectShadow.locV).toBe(110);

    roomVisualizer.props.set("plocx", 40);
    roomVisualizer.props.set("plocy", 50);
    wallWrapperSprite.locH = 40;
    wallWrapperSprite.locV = 50;
    objectShadow.locH = 40;
    objectShadow.locV = 50;
    wallWrapper.props.set("poffsets", new LingoList([40, 50]));

    const snapshot = engine.apply("source-room-rebuild-same-visualizer");

    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "Room_stage", action: "source-moveRoomBy", x: 270, y: 110 }),
      ]),
    );
    expect(roomVisualizer.props.get("plocx")).toBe(310);
    expect(roomVisualizer.props.get("plocy")).toBe(160);
    expect(wallWrapperSprite.locH).toBe(310);
    expect(wallWrapperSprite.locV).toBe(160);
    expect(objectShadow.locH).toBe(310);
    expect(objectShadow.locV).toBe(160);
  });

  it("does not treat late source-owned shadow wrappers as a room rebuild", () => {
    const movie = createMovie();
    const objectList = new LingoPropList();
    const gCore = new ScriptInstance(moduleFor("Object Manager Class", ["pObjectList"]));
    gCore.props.set("pobjectlist", objectList);
    movie.runtime.setGlobal("gcore", gCore);

    const roomVisualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pLayout", "pSpriteList", "pWrappedParts"]),
    );
    roomVisualizer.props.set("plocx", 0);
    roomVisualizer.props.set("plocy", 0);
    roomVisualizer.props.set("playout", "model_a.room");
    roomVisualizer.props.set("pspritelist", new LingoList());
    roomVisualizer.props.set("pwrappedparts", new LingoPropList());

    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", ["pWideScreenOffset"], {
        moveroomby(ctx, me, args) {
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          const visualizer = objectList.getaProp("Room_visualizer", (left: LingoValue, right: LingoValue) => left === right);
          if (visualizer instanceof ScriptInstance) {
            visualizer.props.set("plocx", Number(visualizer.props.get("plocx") ?? 0) + dx);
            visualizer.props.set("plocy", Number(visualizer.props.get("plocy") ?? 0) + dy);
            const sprites = visualizer.props.get("pspritelist");
            if (sprites instanceof LingoList) {
              for (const value of sprites.items) {
                if (!(value instanceof SpriteChannel)) continue;
                value.locH += dx;
                value.locV += dy;
              }
            }
          }
          return LINGO_VOID;
        },
      }),
    );
    roomInterface.props.set("pwidescreenoffset", 0);

    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_visualizer", roomVisualizer, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    engine.setViewport(1500, 760);

    expect(roomVisualizer.props.get("plocx")).toBe(270);
    expect(roomVisualizer.props.get("plocy")).toBe(110);

    const shadowSprite = new SpriteChannel(15);
    shadowSprite.locH = 0;
    shadowSprite.locV = 0;
    const spriteList = roomVisualizer.props.get("pspritelist");
    if (spriteList instanceof LingoList) spriteList.add(shadowSprite);
    const shadowWrapper = wrapper("other", shadowSprite, 0, 0, [{ locH: 320, locV: 260 }]);
    roomVisualizer.props.set("pwrappedparts", LingoPropList.fromPairs([["roomShadow", shadowWrapper]]));

    const sameViewport = engine.apply("late-shadow-wrapper");

    expect(sameViewport.anchors.some((anchor) => anchor.id === "Room_stage" && anchor.x === 270)).toBe(false);
    expect(sameViewport.anchors).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "wrapper:roomShadow", action: "wrapper-follow" })]),
    );
    expect(roomVisualizer.props.get("plocx")).toBe(270);
    expect(roomVisualizer.props.get("plocy")).toBe(110);
    expect(shadowSprite.locH).toBe(270);
    expect(shadowSprite.locV).toBe(110);

    engine.setViewport(1600, 760);

    expect(roomVisualizer.props.get("plocx")).toBe(320);
    expect(roomVisualizer.props.get("plocy")).toBe(110);
    expect(shadowSprite.locH).toBe(320);
    expect(shadowSprite.locV).toBe(110);
  });

  it("reanchors the source action-button window when source room selection snaps it back", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const roomInterface = new ScriptInstance(moduleFor("Room Interface Class", ["pLastStageW", "pLastStageH"]));
    const actionWindow = windowInstance(545, 470, 390, 48);
    const actionSprite = new SpriteChannel(51);
    actionSprite.locH = 550;
    actionSprite.locV = 475;
    actionWindow.props.set("pspritelist", LingoPropList.fromPairs([["action.button", actionSprite]]));

    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_interface", actionWindow, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    engine.setViewport(1500, 760);

    expect(actionWindow.props.get("plocx")).toBe(1085);
    expect(actionWindow.props.get("plocy")).toBe(690);
    expect(actionSprite.locH).toBe(1090);
    expect(actionSprite.locV).toBe(695);

    movie.runtime.callMethod(actionWindow, "moveto", [545, 690]);
    expect(actionWindow.props.get("plocx")).toBe(545);

    const snapshot = engine.apply("same-viewport-source-snap");

    expect(snapshot.anchors.some((anchor) => anchor.id === "Room_interface")).toBe(true);
    expect(actionWindow.props.get("plocx")).toBe(1085);
    expect(actionWindow.props.get("plocy")).toBe(690);
    expect(actionSprite.locH).toBe(1090);
    expect(actionSprite.locV).toBe(695);
  });

  it("does not confuse the room interface thread with the optional action-button window", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const roomInterface = new ScriptInstance(moduleFor("Room Interface Class", ["pLastStageW", "pLastStageH"]));
    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    const snapshot = engine.setViewport(1264, 761);

    expect(snapshot.errors).toEqual([]);
    expect(snapshot.anchors.some((anchor) => anchor.id === "Room_interface")).toBe(false);
    expect(roomInterface.props.get("plaststagew")).toBe(1264);
    expect(roomInterface.props.get("plaststageh")).toBe(761);
  });

  it("moves infostand title overlay sprites with the infostand window", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", [
        "pLastStageW",
        "pLastStageH",
        "pInfoStandTitleSpr",
        "pInfoStandTitleBgSpr",
        "pInfoStandTitlePanelSpr",
      ]),
    );
    const standWindow = windowInstance(792, 332, 168, 208);
    const title = new SpriteChannel(61);
    title.locH = 774;
    title.locV = 196;
    const titleBg = new SpriteChannel(62);
    titleBg.locH = 774;
    titleBg.locV = 196;
    const titlePanel = new SpriteChannel(63);
    titlePanel.locH = 774;
    titlePanel.locV = 212;
    roomInterface.props.set("pinfostandtitlespr", title);
    roomInterface.props.set("pinfostandtitlebgspr", titleBg);
    roomInterface.props.set("pinfostandtitlepanelspr", titlePanel);

    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_info_stand", standWindow, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    const snapshot = engine.setViewport(1500, 760);

    expect(snapshot.anchors.some((anchor) => anchor.action === "infostand-title-follow")).toBe(true);
    expect(standWindow.props.get("plocx")).toBe(1332);
    expect(standWindow.props.get("plocy")).toBe(552);
    expect(title.locH).toBe(1314);
    expect(title.locV).toBe(416);
    expect(titleBg.locH).toBe(1314);
    expect(titlePanel.locV).toBe(432);
  });

  it("adds a presentation toolbar underlay without resizing source toolbar sprites", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const bg = new SpriteChannel(71);
    bg.member = new CastMember("hh_room_bar", 1, 1, "alapalkki_bg", "bitmap", {
      bitmap: { width: 960, height: 54, regX: 10, regY: 0, pngUrl: null },
    });
    bg.locH = 10;
    bg.locV = 452;
    bg.width = 960;
    bg.height = 54;
    bg.puppet = 1;
    const iconShadow = new SpriteChannel(72);
    iconShadow.member = new CastMember("hh_room_bar", 1, 2, "shadow.bar", "bitmap", {
      bitmap: { width: 38, height: 22, regX: 0, regY: 0, pngUrl: null },
    });
    iconShadow.locH = 930;
    iconShadow.locV = 468;
    iconShadow.width = 38;
    iconShadow.height = 22;
    iconShadow.puppet = 1;
    const bottomBar = windowInstance(0, 452, 960, 92);
    bottomBar.props.set("pspritelist", LingoPropList.fromPairs([["bg", bg], ["shadow", iconShadow]]));

    objectList.setaProp("Room_bar", bottomBar, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    const snapshot = engine.setViewport(1500, 760);

    const underlay = snapshot.anchors.find((anchor) => anchor.action === "toolbar-underlay");
    expect(underlay).toMatchObject({ x: 0, y: 705, width: 1500, height: 54 });
    expect(bottomBar.props.get("plocx")).toBe(270);
    expect(bottomBar.props.get("plocy")).toBe(668);
    expect(bg.width).toBe(960);
    expect(bg.locH).toBe(280);
    expect(bg.locV).toBe(668);
    expect(iconShadow.width).toBe(38);
    expect(iconShadow.locH).toBe(1200);
    expect(iconShadow.locV).toBe(684);
  });

  it("keeps presentation cover and dimmer sprites out of the toolbar hit strip", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const cover = new SpriteChannel(80);
    cover.width = 960;
    cover.height = 540;
    const dimmer = new SpriteChannel(81);
    dimmer.width = 980;
    dimmer.height = 540;
    const roomInterface = new ScriptInstance(moduleFor("Room Interface Class", ["pCoverSpr", "pWideScreenOffset"], {
      moveroomby() {
        return LINGO_VOID;
      },
    }));
    roomInterface.props.set("pcoverspr", cover);
    roomInterface.props.set("pwidescreenoffset", 32);
    const roomVisualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pSpriteList", "pWrappedParts", "pRoomDimmerSprite"]),
    );
    roomVisualizer.props.set("plocx", 32);
    roomVisualizer.props.set("plocy", 0);
    roomVisualizer.props.set("pspritelist", new LingoList());
    roomVisualizer.props.set("pwrappedparts", new LingoPropList());
    roomVisualizer.props.set("proomdimmersprite", dimmer);
    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_visualizer", roomVisualizer, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    const snapshot = engine.setViewport(1500, 760);

    expect(cover.width).toBe(1500);
    expect(cover.height).toBe(705);
    expect(dimmer.width).toBe(1520);
    expect(dimmer.height).toBe(705);
    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "pCoverSpr", height: 705 }),
        expect.objectContaining({ id: "pRoomDimmerSprite", height: 705 }),
      ]),
    );
  });

  it("drags the room through the same source moveRoomBy path used by viewport anchoring", () => {
    const movie = createMovie();
    const objectList = new LingoPropList();
    const gCore = new ScriptInstance(moduleFor("Object Manager Class", ["pObjectList"]));
    gCore.props.set("pobjectlist", objectList);
    movie.runtime.setGlobal("gcore", gCore);

    const roomVisualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pSpriteList", "pWrappedParts"]),
    );
    roomVisualizer.props.set("plocx", 0);
    roomVisualizer.props.set("plocy", 0);
    roomVisualizer.props.set("pspritelist", new LingoList());
    roomVisualizer.props.set("pwrappedparts", new LingoPropList());

    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", ["pWideScreenOffset"], {
        moveroomby(ctx, me, args) {
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          const visualizer = objectList.getaProp("Room_visualizer", (left: LingoValue, right: LingoValue) => left === right);
          if (visualizer instanceof ScriptInstance) {
            visualizer.props.set("plocx", Number(visualizer.props.get("plocx") ?? 0) + dx);
            visualizer.props.set("plocy", Number(visualizer.props.get("plocy") ?? 0) + dy);
          }
          return LINGO_VOID;
        },
      }),
    );
    roomInterface.props.set("pwidescreenoffset", 32);
    objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
    objectList.setaProp("Room_visualizer", roomVisualizer, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    engine.setViewport(1500, 760);
    expect(roomVisualizer.props.get("plocx")).toBe(270);
    expect(roomVisualizer.props.get("plocy")).toBe(110);
    expect(engine.canDragRoomAt(50, 50)).toBe(true);
    expect(engine.canDragRoomAt(50, 730)).toBe(false);

    engine.dragRoomBy(25, -15);
    expect(roomVisualizer.props.get("plocx")).toBe(295);
    expect(roomVisualizer.props.get("plocy")).toBe(95);

    engine.apply("same-viewport-after-drag");
    expect(roomVisualizer.props.get("plocx")).toBe(295);
    expect(roomVisualizer.props.get("plocy")).toBe(95);
  });

  it("anchors newly reopened hand visualizers to the wide viewport right edge", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const engine = new OriginsResizeEngine(movie);
    engine.setViewport(1500, 760);

    const firstHand = windowInstance(704, -22, 256, 220);
    objectList.setaProp("Hand_visualizer", firstHand, lingoKeyEquals);

    let snapshot = engine.apply("hand-opened-after-wide-resize");

    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "Hand_visualizer", action: "right-preserve", x: 1244, y: -22 }),
      ]),
    );
    expect(firstHand.props.get("plocx")).toBe(1244);
    expect(firstHand.props.get("plocy")).toBe(-22);

    snapshot = engine.apply("same-viewport-after-hand-anchor");
    expect(snapshot.anchors.some((anchor) => anchor.id === "Hand_visualizer")).toBe(false);
    expect(firstHand.props.get("plocx")).toBe(1244);

    const reopenedHand = windowInstance(704, -22, 256, 220);
    objectList.setaProp("Hand_visualizer", reopenedHand, lingoKeyEquals);

    engine.apply("hand-reopened-after-close");

    expect(reopenedHand.props.get("plocx")).toBe(1244);
    expect(reopenedHand.props.get("plocy")).toBe(-22);
  });

  it("centers the hotel entry visualizer and bottom bar in a wide presentation viewport", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const entryView = windowInstance(0, 0, 960, 540);
    const entryCloud = new SpriteChannel(91);
    entryCloud.locH = 480;
    entryCloud.locV = 120;
    const entryCar = new SpriteChannel(93);
    entryCar.locH = 184;
    entryCar.locV = 505;
    entryView.props.set("pspritelist", LingoPropList.fromPairs([["entry_cloud", entryCloud], ["entry_car", entryCar]]));
    const entryInterface = new ScriptInstance(moduleFor("Entry Interface Class", ["pItemObjList"]));
    const cloudAnimation = new ScriptInstance(moduleFor("Entry Cloud Class", ["pSprite", "pLoc"]));
    cloudAnimation.props.set("psprite", entryCloud);
    cloudAnimation.props.set("ploc", new LingoPoint(480, 120));
    const carAnimation = new ScriptInstance(moduleFor("Entry Car Class", ["pSprite"]));
    carAnimation.props.set("psprite", entryCar);
    entryInterface.props.set("pitemobjlist", new LingoList([cloudAnimation, carAnimation]));
    const entryBar = windowInstance(0, 535, 960, 54);
    const entryBarIcon = new SpriteChannel(92);
    entryBarIcon.locH = 220;
    entryBarIcon.locV = 536;
    entryBar.props.set("pspritelist", LingoPropList.fromPairs([["entry_icon", entryBarIcon]]));
    const loginA = windowInstance(640, 100, 220, 120);
    const loginASprite = new SpriteChannel(94);
    loginASprite.locH = 650;
    loginASprite.locV = 110;
    loginA.props.set("pspritelist", LingoPropList.fromPairs([["login_a_bg", loginASprite]]));
    const loginB = windowInstance(640, 230, 220, 220);
    const loginBSprite = new SpriteChannel(95);
    loginBSprite.locH = 650;
    loginBSprite.locV = 240;
    loginB.props.set("pspritelist", LingoPropList.fromPairs([["login_b_bg", loginBSprite]]));
    objectList.setaProp(symbol("entry_interface"), entryInterface, lingoKeyEquals);
    objectList.setaProp("entry_view", entryView, lingoKeyEquals);
    objectList.setaProp("entry_bar", entryBar, lingoKeyEquals);
    objectList.setaProp(symbol("login_a"), loginA, lingoKeyEquals);
    objectList.setaProp(symbol("login_b"), loginB, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    const snapshot = engine.setViewport(1500, 760);

    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "entry_view", action: "stage-center", x: 270, y: 0 }),
        expect.objectContaining({ id: "entry_bar", action: "bottom-center", x: 270, y: 706 }),
        expect.objectContaining({ id: "#login_a", action: "entry-stage-follow", x: 910, y: 100 }),
        expect.objectContaining({ id: "#login_b", action: "entry-stage-follow", x: 910, y: 230 }),
      ]),
    );
    expect(entryView.props.get("plocx")).toBe(270);
    expect(entryView.props.get("plocy")).toBe(0);
    expect(entryCloud.locH).toBe(750);
    expect(entryCloud.locV).toBe(120);
    expect(entryCar.locH).toBe(454);
    expect(entryCar.locV).toBe(505);
    expect(entryBar.props.get("plocx")).toBe(270);
    expect(entryBar.props.get("plocy")).toBe(706);
    expect(entryBarIcon.locH).toBe(490);
    expect(entryBarIcon.locV).toBe(707);
    expect(loginA.props.get("plocx")).toBe(910);
    expect(loginA.props.get("plocy")).toBe(100);
    expect(loginASprite.locH).toBe(920);
    expect(loginASprite.locV).toBe(110);
    expect(loginB.props.get("plocx")).toBe(910);
    expect(loginB.props.get("plocy")).toBe(230);
    expect(loginBSprite.locH).toBe(920);
    expect(loginBSprite.locV).toBe(240);

    movie.runtime.callMethod(entryView, "moveto", [0, 0]);
    movie.runtime.callMethod(entryBar, "moveto", [0, 535]);
    movie.runtime.callMethod(loginA, "moveto", [640, 100]);
    movie.runtime.callMethod(loginB, "moveto", [640, 230]);
    const refreshed = engine.apply("source-entry-reset");

    expect(refreshed.anchors.some((anchor) => anchor.id === "entry_view")).toBe(true);
    expect(refreshed.anchors.some((anchor) => anchor.id === "entry_bar")).toBe(true);
    expect(refreshed.anchors.some((anchor) => anchor.id === "#login_a")).toBe(true);
    expect(refreshed.anchors.some((anchor) => anchor.id === "#login_b")).toBe(true);
    expect(entryView.props.get("plocx")).toBe(270);
    expect(entryView.props.get("plocy")).toBe(0);
    expect(entryBar.props.get("plocx")).toBe(270);
    expect(entryBar.props.get("plocy")).toBe(706);
    expect(loginA.props.get("plocx")).toBe(910);
    expect(loginA.props.get("plocy")).toBe(100);
    expect(loginB.props.get("plocx")).toBe(910);
    expect(loginB.props.get("plocy")).toBe(230);

    entryCloud.locH = 481;
    entryCloud.locV = 121;
    entryCar.locH = 456;
    entryCar.locV = 504;
    const animationRefresh = engine.apply("entry-animation-source-refresh");
    expect(animationRefresh.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "entry_animation:91", action: "animation-stage-center", x: 750, y: 120 }),
      ]),
    );
    expect(entryCloud.locH).toBe(750);
    expect(entryCloud.locV).toBe(120);
    expect(entryCar.locH).toBe(456);
    expect(entryCar.locV).toBe(504);

    entryCar.locH = 184;
    entryCar.locV = 505;
    engine.apply("entry-car-source-reset");
    expect(entryCar.locH).toBe(454);
    expect(entryCar.locV).toBe(505);
  });

  it("recenters source-created loading windows in the presentation viewport", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const loadingRoom = windowInstance(330, 220, 300, 100);
    const loadingRoomSprite = new SpriteChannel(95);
    loadingRoomSprite.locH = 340;
    loadingRoomSprite.locV = 230;
    loadingRoom.props.set("pspritelist", LingoPropList.fromPairs([["loader", loadingRoomSprite]]));
    objectList.setaProp("Loading room", loadingRoom, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    let snapshot = engine.setViewport(1500, 760);

    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "Loading room", action: "viewport-center", x: 600, y: 330 }),
      ]),
    );
    expect(loadingRoom.props.get("plocx")).toBe(600);
    expect(loadingRoom.props.get("plocy")).toBe(330);
    expect(loadingRoomSprite.locH).toBe(610);
    expect(loadingRoomSprite.locV).toBe(340);

    movie.runtime.callMethod(loadingRoom, "moveto", [330, 220]);
    snapshot = engine.apply("source-loading-room-center-reset");

    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "Loading room", action: "viewport-center", x: 600, y: 330 }),
      ]),
    );
    expect(loadingRoom.props.get("plocx")).toBe(600);
    expect(loadingRoom.props.get("plocy")).toBe(330);
  });

  it("anchors source-created bulletin notifications to the presentation viewport right edge", () => {
    const movie = createMovie();
    const objectList = installObjectManager(movie);
    const notificationSprite = new SpriteChannel(101);
    notificationSprite.locH = 702;
    notificationSprite.locV = 620;
    notificationSprite.width = 254;
    notificationSprite.ink = 8;
    notificationSprite.blend = 100;
    const notificationManager = new ScriptInstance(
      moduleFor("Bulletin Notification Manager", ["pNotifications", "pRightMargin"]),
    );
    notificationManager.props.set("prightmargin", 4);
    notificationManager.props.set(
      "pnotifications",
      LingoPropList.fromPairs([
        [
          "notification_1",
          LingoPropList.fromPairs([
            [symbol("sprite"), notificationSprite],
            [symbol("progress"), 40],
          ]),
        ],
      ]),
    );
    objectList.setaProp("bulletin_notification_manager", notificationManager, lingoKeyEquals);

    const engine = new OriginsResizeEngine(movie);
    const snapshot = engine.setViewport(1500, 760);

    expect(snapshot.anchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bulletin_notification:notification_1",
          action: "top-right-notification",
          x: 1242,
          y: 620,
          width: 254,
        }),
      ]),
    );
    expect(notificationSprite.locH).toBe(1242);
    expect(notificationSprite.locV).toBe(620);
    expect(notificationSprite.ink).toBe(8);
    expect(notificationSprite.blend).toBe(100);
  });
});

function wrapper(
  type: string,
  sprite: SpriteChannel,
  offsetX: number,
  offsetY: number,
  parts: Array<{ locH: number; locV: number }> = [],
): ScriptInstance {
  const instance = new ScriptInstance(
    moduleFor("Visualizer Part Wrapper Class", ["pTypeDef", "pSprite", "pOffsets", "pPartList"]),
  );
  instance.props.set("ptypedef", symbol(type));
  instance.props.set("psprite", sprite);
  instance.props.set("poffsets", new LingoList([offsetX, offsetY]));
  instance.props.set(
    "ppartlist",
    new LingoList(
      parts.map((part) =>
        LingoPropList.fromPairs([
          [symbol("locH"), part.locH],
          [symbol("locV"), part.locV],
        ]),
      ),
    ),
  );
  return instance;
}

function moveWrapperParts(visualizer: ScriptInstance, dx: number, dy: number): void {
  const wrappedParts = visualizer.props.get("pwrappedparts");
  if (!(wrappedParts instanceof LingoPropList)) return;
  for (const wrapperValue of wrappedParts.values) {
    if (!(wrapperValue instanceof ScriptInstance)) continue;
    const partList = wrapperValue.props.get("ppartlist");
    if (!(partList instanceof LingoList)) continue;
    for (const partValue of partList.items) {
      if (!(partValue instanceof LingoPropList)) continue;
      const locH = Number(partValue.getaProp(symbol("locH"), lingoKeyEquals));
      const locV = Number(partValue.getaProp(symbol("locV"), lingoKeyEquals));
      partValue.setaProp(symbol("locH"), locH + dx, lingoKeyEquals);
      partValue.setaProp(symbol("locV"), locV + dy, lingoKeyEquals);
    }
  }
}

function installObjectManager(movie: DirectorMovie): LingoPropList {
  const objectList = new LingoPropList();
  const gCore = new ScriptInstance(moduleFor("Object Manager Class", ["pObjectList"]));
  gCore.props.set("pobjectlist", objectList);
  movie.runtime.setGlobal("gcore", gCore);
  return objectList;
}

function windowInstance(x: number, y: number, width: number, height: number): ScriptInstance {
  const instance = new ScriptInstance(
    moduleFor("Window Instance Class", ["pLocX", "pLocY", "pwidth", "pheight", "pSpriteList", "pBoundary"], {
      moveto(ctx, me, args) {
        const targetX = Number(args[1] ?? 0);
        const targetY = Number(args[2] ?? 0);
        const dx = targetX - Number(ctx.getInstanceProp(me, "plocx") ?? 0);
        const dy = targetY - Number(ctx.getInstanceProp(me, "plocy") ?? 0);
        ctx.callMethod(me, "moveby", [dx, dy]);
        return LINGO_VOID;
      },
      moveby(ctx, me, args) {
        const dx = Number(args[1] ?? 0);
        const dy = Number(args[2] ?? 0);
        ctx.setInstanceProp(me, "plocx", Number(ctx.getInstanceProp(me, "plocx") ?? 0) + dx);
        ctx.setInstanceProp(me, "plocy", Number(ctx.getInstanceProp(me, "plocy") ?? 0) + dy);
        for (const sprite of windowSprites(ctx.getInstanceProp(me, "pspritelist"))) {
          sprite.locH += dx;
          sprite.locV += dy;
        }
        return LINGO_VOID;
      },
      getproperty(ctx, me, args) {
        const prop = propName(args[1] ?? LINGO_VOID);
        if (prop === "width") return ctx.getInstanceProp(me, "pwidth");
        if (prop === "height") return ctx.getInstanceProp(me, "pheight");
        if (prop === "spritlist" || prop === "spritelist") return ctx.getInstanceProp(me, "pspritelist");
        return LINGO_VOID;
      },
      setproperty(ctx, me, args) {
        if (propName(args[1] ?? LINGO_VOID) === "boundary") ctx.setInstanceProp(me, "pboundary", args[2] ?? LINGO_VOID);
        return 1;
      },
    }),
  );
  instance.props.set("plocx", x);
  instance.props.set("plocy", y);
  instance.props.set("pwidth", width);
  instance.props.set("pheight", height);
  instance.props.set("pspritelist", new LingoList());
  return instance;
}

function windowSprites(value: LingoValue): SpriteChannel[] {
  if (value instanceof LingoList) return value.items.filter((item): item is SpriteChannel => item instanceof SpriteChannel);
  if (value instanceof LingoPropList) return value.values.filter((item): item is SpriteChannel => item instanceof SpriteChannel);
  return [];
}

function propName(value: LingoValue): string {
  if (value instanceof LingoSymbol) return value.name.toLowerCase();
  return String(value).replace(/^#/, "").toLowerCase();
}

it("keeps wall and floor wrappers locked to room position across multiple frames", () => {
  // Models real game: moveroomby does NOT move wrapper parts (matching real Lingo at
  // ParentScript_3_-_Room_Interface_Class.ts:2834). Source resets wrapper sprites to
  // pOffsets each frame (Visualizer Part Wrapper Class.updateSprite:432).
  const movie = createMovie();
  const objectList = installObjectManager(movie);

  const floorSprite = new SpriteChannel(10);
  const wallSprite = new SpriteChannel(11);
  floorSprite.locH = 32;
  floorSprite.locV = 0;
  wallSprite.locH = 32;
  wallSprite.locV = 0;

  const visualizer = new ScriptInstance(
    moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pSpriteList", "pWrappedParts"]),
  );
  visualizer.props.set("plocx", 0);
  visualizer.props.set("plocy", 0);
  visualizer.props.set("pspritelist", new LingoList([floorSprite, wallSprite]));

  const floorWrapper = wrapper("floor", floorSprite, 32, 0);
  const wallWrapper = wrapper("wallleft", wallSprite, 32, 0, [{ locH: 120, locV: 80 }]);
  visualizer.props.set(
    "pwrappedparts",
    LingoPropList.fromPairs([["floor", floorWrapper], ["wall", wallWrapper]]),
  );

  const roomInterface = new ScriptInstance(
    moduleFor("Room Interface Class", ["pWideScreenOffset"], {
      moveroomby(ctx, me, args) {
        const dx = Number(args[1] ?? 0);
        const dy = Number(args[2] ?? 0);
        const viz = objectList.getaProp("Room_visualizer", (a, b) => a === b);
        if (viz instanceof ScriptInstance) {
          viz.props.set("plocx", Number(viz.props.get("plocx") ?? 0) + dx);
          viz.props.set("plocy", Number(viz.props.get("plocy") ?? 0) + dy);
          for (const v of (viz.props.get("pspritelist") as LingoList).items) {
            if (v instanceof SpriteChannel) { v.locH += dx; v.locV += dy; }
          }
          // Real Lingo does NOT call moveWrapperParts — wrapper parts stay at original
        }
        return LINGO_VOID;
      },
    }),
  );
  roomInterface.props.set("pwidescreenoffset", 32);
  objectList.setaProp(symbol("room_interface"), roomInterface, lingoKeyEquals);
  objectList.setaProp("Room_visualizer", visualizer, lingoKeyEquals);

  const engine = new OriginsResizeEngine(movie);
  engine.setViewport(2560, 1440);
  const offsetX = Math.round((2560 - 960) / 2); // 800

  // After resize: visualizer moved, wrappers corrected
  expect(visualizer.props.get("plocx")).toBe(800);
  expect(floorSprite.locH).toBe(832); // 32 + 800
  expect(wallSprite.locH).toBe(832); // wall also corrected

  // Simulate 10 frames: source resets sprites each frame, engine re-corrects
  for (let frame = 0; frame < 10; frame++) {
    floorSprite.locH = 32; // source updateSprite resets to pOffsets
    floorSprite.locV = 0;
    wallSprite.locH = 32;
    wallSprite.locV = 0;
    engine.apply(`frame-${frame}`);
  }

  // After 10 frames, wrappers must still be at the correct offset position
  expect(floorSprite.locH).toBe(832);
  expect(wallSprite.locH).toBe(832);

  // Change viewport and verify wrappers follow
  engine.setViewport(1920, 1080);
  const offset2 = Math.round((1920 - 960) / 2); // 480
  expect(floorSprite.locH).toBe(512); // 32 + 480
  expect(wallSprite.locH).toBe(512); // wall follows floor

  // 10 more frames
  for (let frame = 0; frame < 10; frame++) {
    floorSprite.locH = 32;
    wallSprite.locH = 32;
    engine.apply(`frame2-${frame}`);
  }
  expect(floorSprite.locH).toBe(512);
  expect(wallSprite.locH).toBe(512);
});

it("does not accumulate wrapper position drift across resize and room rejoin cycles", () => {
  const movie = createMovie();
  const objectList = installObjectManager(movie);

  // Room at 2560x1440 viewport (2K monitor) with two walls and a floor
  function buildRoom(): { visualizer: ScriptInstance; interface: ScriptInstance; walls: SpriteChannel[]; floor: SpriteChannel } {
    const visualizer = new ScriptInstance(
      moduleFor("Visualizer Instance Class", ["pLocX", "pLocY", "pLayout", "pSpriteList", "pWrappedParts"]),
    );
    visualizer.props.set("plocx", 0);
    visualizer.props.set("plocy", 0);
    visualizer.props.set("playout", "model_a.room");

    const wallLeftSprite = new SpriteChannel(10);
    wallLeftSprite.locH = 32;
    wallLeftSprite.locV = 0;
    const wallRightSprite = new SpriteChannel(11);
    wallRightSprite.locH = 480;
    wallRightSprite.locV = 0;
    const floorSprite = new SpriteChannel(12);
    floorSprite.locH = 0;
    floorSprite.locV = 160;
    visualizer.props.set("pspritelist", new LingoList([wallLeftSprite, wallRightSprite, floorSprite]));

    const wallLeftWrapper = wrapper("wallleft", wallLeftSprite, 32, 0, [
      { locH: 120, locV: 80 },
      { locH: 180, locV: 80 },
    ]);
    const wallRightWrapper = wrapper("wallright", wallRightSprite, 480, 0, [
      { locH: 600, locV: 80 },
      { locH: 660, locV: 80 },
    ]);
    const floorWrapper = wrapper("floor", floorSprite, 0, 160);
    visualizer.props.set(
      "pwrappedparts",
      LingoPropList.fromPairs([
        ["wallleft", wallLeftWrapper],
        ["wallright", wallRightWrapper],
        ["floor", floorWrapper],
      ]),
    );

    const roomInterface = new ScriptInstance(
      moduleFor("Room Interface Class", ["pWideScreenOffset"], {
        moveroomby(ctx, me, args) {
          const dx = Number(args[1] ?? 0);
          const dy = Number(args[2] ?? 0);
          const viz = objectList.getaProp("Room_visualizer", (left: LingoValue, right: LingoValue) => left === right);
          if (viz instanceof ScriptInstance) {
            viz.props.set("plocx", Number(viz.props.get("plocx") ?? 0) + dx);
            viz.props.set("plocy", Number(viz.props.get("plocy") ?? 0) + dy);
            for (const v of (viz.props.get("pspritelist") as LingoList).items) {
              if (v instanceof SpriteChannel) { v.locH += dx; v.locV += dy; }
            }
            moveWrapperParts(viz, dx, dy);
          }
          return LINGO_VOID;
        },
      }),
    );
    roomInterface.props.set("pwidescreenoffset", 32);
    return { visualizer, interface: roomInterface, walls: [wallLeftSprite, wallRightSprite], floor: floorSprite };
  }

  // First room
  let { visualizer, interface: iface, walls: walls1, floor: floor1 } = buildRoom();
  objectList.setaProp(symbol("room_interface"), iface, lingoKeyEquals);
  objectList.setaProp("Room_visualizer", visualizer, lingoKeyEquals);

  const engine = new OriginsResizeEngine(movie);

  // Resize to 2K monitor
  engine.setViewport(2560, 1440);
  const offset = Math.round((2560 - 960) / 2); // 800
  const offsetY = Math.round((1440 - 540) / 2); // 450

  // After resize: room centered, wrappers corrected
  expect(visualizer.props.get("plocx")).toBe(800);
  expect(walls1[0]!.locH).toBe(832); // 32 + 800
  expect(walls1[1]!.locH).toBe(1280); // 480 + 800
  expect(floor1.locH).toBe(800); // 0 + 800

  // Simulate room rejoin: source rebuilds visualizer at original positions
  objectList.deleteProp(symbol("room_interface"), (a: LingoValue, b: LingoValue) => a === b);
  objectList.deleteProp("Room_visualizer", (a: LingoValue, b: LingoValue) => a === b);
  const { visualizer: viz2, interface: iface2, walls: walls2, floor: floor2 } = buildRoom();
  objectList.setaProp(symbol("room_interface"), iface2, lingoKeyEquals);
  objectList.setaProp("Room_visualizer", viz2, lingoKeyEquals);

  // Source resets wrapper sprites (simulating updateSprite)
  const wl = walls2[0]!;
  const wr = walls2[1]!;
  wl.locH = 32;
  wr.locH = 480;
  floor2.locH = 0;

  // Apply should re-correct wrappers based on current viewport
  engine.apply("post-rejoin-refresh");

  // Wrappers should be at the CORRECT positions for 2560x1440
  expect(wl.locH).toBe(832); // 32 + 800 — left wall
  expect(wr.locH).toBe(1280); // 480 + 800 — right wall
  expect(floor2.locH).toBe(800); // 0 + 800 — floor

  // Resize to a different size
  engine.setViewport(1920, 1080);
  const offset2 = Math.round((1920 - 960) / 2); // 480
  const offsetY2 = Math.round((1080 - 540) / 2); // 270

  // Source resets again
  const wl2 = walls2[0]!;
  const wr2 = walls2[1]!;
  wl2.locH = 32;
  wr2.locH = 480;
  floor2.locH = 0;
  engine.apply("second-resize-refresh");

  // Should be at new positions
  expect(wl2.locH).toBe(512); // 32 + 480
  expect(wr2.locH).toBe(960); // 480 + 480
  expect(floor2.locH).toBe(480); // 0 + 480
});
