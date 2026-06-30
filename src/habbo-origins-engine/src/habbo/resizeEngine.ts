import type { DirectorMovie } from "../director/Movie";
import { LingoPoint, LingoRect } from "../director/geometry";
import { lingoKeyEquals, stringOf } from "../director/ops";
import { ScriptInstance } from "../director/Runtime";
import { SpriteChannel } from "../director/sprites";
import {
  LINGO_VOID,
  LingoFloat,
  LingoList,
  LingoPropList,
  LingoSymbol,
  LingoVoid,
  type LingoValue,
} from "../director/values";

export interface ResizeEngineAnchor {
  readonly id: string;
  readonly kind: "stage" | "manager" | "window" | "visualizer" | "sprite" | "room";
  readonly action: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly note?: string;
}

export interface ResizeEngineSnapshot {
  readonly enabled: boolean;
  readonly changed: boolean;
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly anchors: ResizeEngineAnchor[];
  readonly errors: string[];
}

interface SeenPosition {
  readonly instance: ScriptInstance;
  readonly locX: number;
  readonly locY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

interface RoomStageState {
  readonly instance: ScriptInstance;
  readonly baseX: number;
  readonly baseY: number;
  readonly sourceWideOffset: number;
  readonly epochKey: string;
  readonly wrappers: Map<string, WrapperStageBaseline>;
}

interface MoveResult {
  readonly moved: boolean;
  readonly dx: number;
  readonly dy: number;
  readonly x: number;
  readonly y: number;
}

interface WrapperPartBaseline {
  readonly locH: number;
  readonly locV: number;
}

interface WrapperStageBaseline {
  readonly instance: ScriptInstance;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly appliedX: number;
  readonly appliedY: number;
  readonly parts: WrapperPartBaseline[];
}

const PRESENTATION_TOOLBAR_HEIGHT = 54;

export class OriginsResizeEngine {
  private viewportWidth: number;
  private viewportHeight: number;
  private snapshot: ResizeEngineSnapshot;
  private readonly seen = new Map<string, SeenPosition>();
  private readonly applied = new Map<string, string>();
  private readonly entryAnimationOffsets = new Map<number, { x: number; y: number; lastX: number; lastY: number }>();
  private roomStage: RoomStageState | null = null;
  private manualRoomOffsetX = 0;
  private manualRoomOffsetY = 0;

  constructor(private readonly movie: DirectorMovie) {
    this.viewportWidth = movie.manifestStageWidth;
    this.viewportHeight = movie.manifestStageHeight;
    this.snapshot = this.emptySnapshot();
  }

  setViewport(width: number, height: number): ResizeEngineSnapshot {
    this.viewportWidth = Math.max(1, Math.round(width));
    this.viewportHeight = Math.max(1, Math.round(height));
    return this.apply("viewport");
  }

  apply(reason = "sync"): ResizeEngineSnapshot {
    const anchors: ResizeEngineAnchor[] = [];
    const errors: string[] = [];
    let changed = false;
    const markChanged = (): void => {
      changed = true;
    };
    const guard = (id: string, kind: ResizeEngineAnchor["kind"], action: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        errors.push(`${id}.${action}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    anchors.push({
      id: "stage",
      kind: "stage",
      action: "viewport",
      width: this.viewportWidth,
      height: this.viewportHeight,
    });

    guard("window_manager", "manager", "boundary", () => {
      const manager = this.object("#window_manager");
      if (!manager) return;
      if (!this.shouldApply("window_manager")) return;
      const boundary = new LingoRect(-20, -20, this.viewportWidth + 20, this.viewportHeight + 20);
      this.movie.runtime.callMethod(manager, "setproperty", [LingoSymbol.for("boundary"), boundary]);
      this.markApplied("window_manager");
      markChanged();
      anchors.push({ id: "window_manager", kind: "manager", action: "boundary", width: this.viewportWidth, height: this.viewportHeight });
    });

    guard("visualizer_manager", "manager", "boundary", () => {
      const manager = this.object("#visualizer_manager");
      if (!manager) return;
      if (!this.shouldApply("visualizer_manager")) return;
      const boundary = new LingoRect(-1000, -1000, this.viewportWidth + 1000, this.viewportHeight + 1000);
      this.movie.runtime.callMethod(manager, "setproperty", [LingoSymbol.for("boundary"), boundary]);
      this.markApplied("visualizer_manager");
      markChanged();
      anchors.push({
        id: "visualizer_manager",
        kind: "manager",
        action: "boundary",
        width: this.viewportWidth,
        height: this.viewportHeight,
      });
    });

    const roomInterface = this.object("#room_interface") ?? this.object("room_interface");
    if (roomInterface) {
      guard("room_interface", "room", "stage-props", () => {
        const lastWidth = this.numberProp(roomInterface, "plaststagew", 0);
        const lastHeight = this.numberProp(roomInterface, "plaststageh", 0);
        if (lastWidth !== this.viewportWidth) {
          this.movie.runtime.setProp(roomInterface, "pLastStageW", this.viewportWidth);
          markChanged();
        }
        if (lastHeight !== this.viewportHeight) {
          this.movie.runtime.setProp(roomInterface, "pLastStageH", this.viewportHeight);
          markChanged();
        }
        if (!this.object("Room_visualizer") && this.movie.runtime.hasHandler(roomInterface, "updatescreenoffset")) {
          this.movie.runtime.callMethod(roomInterface, "updatescreenoffset", []);
        }
        if (this.resizeCoverSprite(roomInterface, anchors)) markChanged();
        this.markApplied("room_interface");
        anchors.push({
          id: "room_interface",
          kind: "room",
          action: "stage-props",
          width: this.viewportWidth,
          height: this.viewportHeight,
        });
      });
    }

    const roomOffsetX = Math.round((this.viewportWidth - this.movie.manifestStageWidth) / 2);
    const roomOffsetY = Math.round((this.viewportHeight - this.movie.manifestStageHeight) / 2);
    const entryOffsetX = roomOffsetX;
    const entryOffsetY = 0;

    guard("Room_visualizer", "room", "stage-follow", () => {
      const visualizer = this.object("Room_visualizer");
      if (!visualizer) return;
      const interfaceObject = roomInterface ?? this.object("#room_interface") ?? this.object("room_interface");
      if (!interfaceObject) return;
      let currentX = this.numberProp(visualizer, "plocx", 0);
      let currentY = this.numberProp(visualizer, "plocy", 0);
      const sourceWideOffset = this.numberProp(interfaceObject, "pwidescreenoffset", 0);
      const epochKey = this.roomStageEpochKey(visualizer, sourceWideOffset);
      const seenRoomStage = this.seen.get("Room_stage");
      const sourceSnap =
        this.roomStage?.instance === visualizer &&
        seenRoomStage?.instance === visualizer &&
        (Math.round(currentX) !== Math.round(seenRoomStage.locX) || Math.round(currentY) !== Math.round(seenRoomStage.locY));
      if (!this.roomStage || this.roomStage.instance !== visualizer || this.roomStage.epochKey !== epochKey || sourceSnap) {
        this.roomStage = {
          instance: visualizer,
          baseX: currentX,
          baseY: currentY,
          sourceWideOffset,
          epochKey,
          wrappers: this.captureWrapperBaselines(visualizer, 0, 0),
        };
        this.manualRoomOffsetX = 0;
        this.manualRoomOffsetY = 0;
      }
      const targetX = Math.round(this.roomStage.baseX + roomOffsetX + this.manualRoomOffsetX);
      const targetY = Math.round(this.roomStage.baseY + roomOffsetY + this.manualRoomOffsetY);
      const deltaX = Math.round(targetX - currentX);
      const deltaY = Math.round(targetY - currentY);
      if (deltaX !== 0 || deltaY !== 0) {
        this.movie.runtime.callMethod(interfaceObject, "moveroomby", [deltaX, deltaY]);
        markChanged();
        currentX = this.numberProp(visualizer, "plocx", targetX);
        currentY = this.numberProp(visualizer, "plocy", targetY);
        this.manualRoomOffsetX = Math.round(currentX - this.roomStage.baseX - roomOffsetX);
        this.manualRoomOffsetY = Math.round(currentY - this.roomStage.baseY - roomOffsetY);
      }
      this.updateSeen("Room_stage", visualizer, currentX, currentY);
      if (this.correctWrapperSpriteLocations(visualizer, currentX, currentY, anchors)) markChanged();
      if (this.resizeDimmerSprite(visualizer, anchors)) markChanged();
      this.markApplied("Room_stage");
      anchors.push({
        id: "Room_stage",
        kind: "room",
        action: "source-moveRoomBy",
        x: deltaX,
        y: deltaY,
        note: `target=${targetX},${targetY}; sourceWideOffset=${this.roomStage.sourceWideOffset}`,
      });
    });

    guard("entry_view", "visualizer", "stage-center", () => {
      const visualizer = this.object("entry_view");
      if (!visualizer) return;
      const x = Math.round(entryOffsetX);
      const y = Math.round(entryOffsetY);
      const move = this.moveInstanceTo(visualizer, x, y);
      if (!move.moved) return;
      this.updateSeen("entry_view", visualizer, move.x, move.y);
      this.markApplied("entry_view");
      this.rememberEntryAnimationOffsets(move.x, move.y);
      markChanged();
      anchors.push({ id: "entry_view", kind: "visualizer", action: "stage-center", x: move.x, y: move.y });
    });

    guard("entry_interface", "visualizer", "animation-stage-center", () => {
      const entryInterface = this.object("#entry_interface") ?? this.object("entry_interface");
      if (!entryInterface) return;
      if (this.anchorEntryAnimationSprites(entryInterface, entryOffsetX, entryOffsetY, anchors)) markChanged();
    });

    for (const id of ["#login_a", "#login_b"]) {
      guard(id, "window", "entry-stage-follow", () => {
        const window = this.object(id);
        if (!window) return;
        this.setWideBoundary(window);
        const seen = this.rememberFromViewport(id, window, this.movie.manifestStageWidth);
        const x = Math.round(seen.locX + entryOffsetX);
        const y = Math.round(seen.locY + entryOffsetY);
        const move = this.moveInstanceTo(window, x, y);
        if (!move.moved) return;
        markChanged();
        anchors.push({ id, kind: "window", action: "entry-stage-follow", x: move.x, y: move.y });
      });
    }

    for (const id of this.loadingWindowIds()) {
      guard(id, "window", "viewport-center", () => {
        const window = this.object(id);
        if (!window) return;
        this.setWideBoundary(window);
        const width = Math.max(1, this.numberProperty(window, "width", this.movie.manifestStageWidth));
        const height = Math.max(1, this.numberProperty(window, "height", this.movie.manifestStageHeight));
        const x = Math.max(0, Math.round((this.viewportWidth - width) / 2));
        const y = Math.max(0, Math.round((this.viewportHeight - height) / 2));
        const move = this.moveInstanceTo(window, x, y);
        if (!move.moved) return;
        this.updateSeen(id, window, move.x, move.y);
        markChanged();
        anchors.push({ id, kind: "window", action: "viewport-center", x: move.x, y: move.y });
      });
    }

    const bottomBars = ["RoomBarID", "Room_bar", "entry_bar"];
    let bottomBarTargetY: number | null = null;
    let toolbarUnderlayAdded = false;
    for (const id of bottomBars) {
      guard(id, "window", "bottom-center", () => {
        const window = this.object(id);
        if (!window) return;
        const height = Math.max(1, this.numberProperty(window, "height", PRESENTATION_TOOLBAR_HEIGHT));
        const x = Math.max(0, Math.round((this.viewportWidth - this.movie.manifestStageWidth) / 2));
        const y = Math.max(0, this.viewportHeight - height);
        const underlayY = this.toolbarTop();
        this.setWideBoundary(window);
        const move = this.moveInstanceTo(window, x, y);
        if (move.moved) {
          this.updateSeen(id, window, x, y);
          markChanged();
        }
        this.markApplied(id);
        bottomBarTargetY = y;
        if (!toolbarUnderlayAdded) {
          toolbarUnderlayAdded = true;
          anchors.push({
            id: "toolbar_underlay",
            kind: "sprite",
            action: "toolbar-underlay",
            x: 0,
            y: underlayY,
            width: this.viewportWidth,
            height: PRESENTATION_TOOLBAR_HEIGHT,
          });
        }
        if (move.moved) {
          anchors.push({ id, kind: "window", action: "bottom-center", x, y });
        }
      });
    }

    guard("Room_info", "window", "room-follow", () => {
      const window = this.object("Room_info");
      if (!window) return;
      this.setWideBoundary(window);
      const x = Math.max(0, Math.round(10 + roomOffsetX));
      const y = bottomBarTargetY === null ? Math.round(420 + Math.max(0, roomOffsetY)) : Math.max(0, bottomBarTargetY - 66);
      const move = this.moveInstanceTo(window, x, y);
      if (!move.moved) return;
      this.updateSeen("Room_info", window, move.x, move.y);
      this.markApplied("Room_info");
      markChanged();
      anchors.push({ id: "Room_info", kind: "window", action: "room-follow", x: move.x, y: move.y });
    });

    guard("Room_info_stand", "window", "right-anchor", () => {
      const window = this.object("Room_info_stand");
      if (!window) return;
      this.setWideBoundary(window);
      const x = Math.max(0, this.viewportWidth - 168);
      const y = Math.max(0, this.viewportHeight - 208);
      const move = this.moveInstanceTo(window, x, y);
      if (move.moved) {
        this.updateSeen("Room_info_stand", window, move.x, move.y);
        this.moveInfoStandLooseSprites(roomInterface, move.dx, move.dy, anchors);
        markChanged();
      }
      if (this.positionInfoStandTitle(roomInterface, anchors)) markChanged();
      this.markApplied("Room_info_stand");
      if (move.moved) anchors.push({ id: "Room_info_stand", kind: "window", action: "right-anchor", x: move.x, y: move.y });
    });

    guard("Room_interface", "window", "right-anchor", () => {
      const window = this.object("Room_interface");
      if (!window) return;
      this.setWideBoundary(window);
      const x = Math.max(0, Math.round(545 + (this.viewportWidth - this.movie.manifestStageWidth)));
      const y = Math.max(0, this.viewportHeight - 70);
      const move = this.moveInstanceTo(window, x, y);
      if (!move.moved) return;
      this.updateSeen("Room_interface", window, move.x, move.y);
      this.markApplied("Room_interface");
      markChanged();
      anchors.push({ id: "Room_interface", kind: "window", action: "right-anchor", x: move.x, y: move.y });
    });

    guard("Hand_visualizer", "visualizer", "right-preserve", () => {
      const visualizer = this.object("Hand_visualizer");
      if (!visualizer) return;
      const seen = this.rememberFromViewport("Hand_visualizer", visualizer, this.movie.manifestStageWidth);
      const currentX = this.numberProp(visualizer, "plocx", seen.locX);
      const currentY = this.numberProp(visualizer, "plocy", seen.locY);
      const x = Math.round(currentX + (this.viewportWidth - seen.viewportWidth));
      const y = currentY;
      const move = this.moveInstanceTo(visualizer, x, y);
      if (!move.moved) return;
      this.updateSeen("Hand_visualizer", visualizer, move.x, move.y);
      this.markApplied("Hand_visualizer");
      markChanged();
      anchors.push({ id: "Hand_visualizer", kind: "visualizer", action: "right-preserve", x: move.x, y: move.y });
    });

    guard("habbo_hand_buttons", "window", "top-right", () => {
      const window = this.object("habbo_hand_buttons");
      if (!window) return;
      this.setWideBoundary(window);
      const width = Math.max(1, this.numberProperty(window, "width", 447));
      const x = Math.max(0, this.viewportWidth - width - 5);
      const y = 5;
      const move = this.moveInstanceTo(window, x, y);
      if (!move.moved) return;
      this.updateSeen("habbo_hand_buttons", window, move.x, move.y);
      this.markApplied("habbo_hand_buttons");
      markChanged();
      anchors.push({ id: "habbo_hand_buttons", kind: "window", action: "top-right", x: move.x, y: move.y });
    });

    guard("bulletin_notification_manager", "manager", "top-right-notifications", () => {
      const manager = this.object("bulletin_notification_manager");
      if (!manager) return;
      if (this.anchorBulletinNotifications(manager, anchors)) markChanged();
      this.markApplied("bulletin_notification_manager");
    });

    this.snapshot = {
      enabled: true,
      changed,
      baseWidth: this.movie.manifestStageWidth,
      baseHeight: this.movie.manifestStageHeight,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      anchors,
      errors,
    };
    return this.snapshot;
  }

  currentSnapshot(): ResizeEngineSnapshot {
    return this.snapshot;
  }

  needsFrameSync(): boolean {
    return (
      this.viewportWidth !== this.movie.manifestStageWidth ||
      this.viewportHeight !== this.movie.manifestStageHeight ||
      this.manualRoomOffsetX !== 0 ||
      this.manualRoomOffsetY !== 0
    );
  }

  canDragRoomAt(x: number, y: number): boolean {
    return (
      !!this.object("Room_visualizer") &&
      x >= 0 &&
      y >= 0 &&
      x < this.viewportWidth &&
      y < this.toolbarTop()
    );
  }

  dragRoomBy(dx: number, dy: number): ResizeEngineSnapshot {
    const roundedDx = Math.round(dx);
    const roundedDy = Math.round(dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (roundedDx === 0 && roundedDy === 0)) {
      return this.snapshot;
    }
    this.manualRoomOffsetX += roundedDx;
    this.manualRoomOffsetY += roundedDy;
    return this.apply("room-drag");
  }

  private emptySnapshot(): ResizeEngineSnapshot {
    return {
      enabled: true,
      changed: false,
      baseWidth: this.movie.manifestStageWidth,
      baseHeight: this.movie.manifestStageHeight,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      anchors: [],
      errors: [],
    };
  }

  private viewportKey(): string {
    return `${this.viewportWidth}x${this.viewportHeight}`;
  }

  private toolbarTop(): number {
    return Math.max(0, this.viewportHeight - PRESENTATION_TOOLBAR_HEIGHT - 1);
  }

  private shouldApply(id: string): boolean {
    return this.applied.get(id) !== this.viewportKey();
  }

  private markApplied(id: string): void {
    this.applied.set(id, this.viewportKey());
  }

  private object(id: string): ScriptInstance | null {
    const list = this.objectList();
    if (!list) return null;
    const value = this.propListLookup(list, id);
    return value instanceof ScriptInstance ? value : null;
  }

  private loadingWindowIds(): string[] {
    const ids = new Set<string>();
    if (this.object("Loading room")) ids.add("Loading room");
    const list = this.objectList();
    if (!list) return [...ids];
    for (const value of list.values) {
      if (!(value instanceof ScriptInstance)) continue;
      if (value.module.scriptName.toLowerCase() !== "loading bar class") continue;
      const windowId = this.instanceProp(value, "pwindowid");
      const id = stringOf(windowId).trim();
      if (id !== "" && this.object(id)) ids.add(id);
    }
    return [...ids];
  }

  private objectList(): LingoPropList | null {
    const gCore = this.movie.runtime.getGlobal("gcore");
    if (!(gCore instanceof ScriptInstance)) return null;
    const objectList = gCore.props.get("pobjectlist");
    return objectList instanceof LingoPropList ? objectList : null;
  }

  private propListLookup(list: LingoPropList, key: string): LingoValue {
    if (key.startsWith("#")) {
      const symbolKey = key.slice(1).toLowerCase();
      for (let index = 0; index < list.keys.length; index += 1) {
        const candidate = list.keys[index];
        if (candidate instanceof LingoSymbol && candidate.name.toLowerCase() === symbolKey) {
          return list.values[index] ?? LINGO_VOID;
        }
      }
      return LINGO_VOID;
    }
    const stringKey = key.toLowerCase();
    for (let index = 0; index < list.keys.length; index += 1) {
      const candidate = list.keys[index];
      if (typeof candidate === "string" && candidate.toLowerCase() === stringKey) {
        return list.values[index] ?? LINGO_VOID;
      }
    }
    return LINGO_VOID;
  }

  private remember(id: string, instance: ScriptInstance): SeenPosition {
    return this.rememberFromViewport(id, instance, this.viewportWidth);
  }

  private rememberFromViewport(id: string, instance: ScriptInstance, newInstanceViewportWidth: number): SeenPosition {
    const existing = this.seen.get(id);
    if (existing?.instance === instance) return existing;
    if (existing && existing.instance !== instance) {
      this.applied.delete(id);
    }
    const locX = this.numberProp(instance, "plocx", 0);
    const locY = this.numberProp(instance, "plocy", 0);
    const seen = {
      instance,
      locX,
      locY,
      viewportWidth: Math.max(1, Math.round(newInstanceViewportWidth)),
      viewportHeight: this.viewportHeight,
    };
    this.seen.set(id, seen);
    return seen;
  }

  private updateSeen(id: string, instance: ScriptInstance, locX: number, locY: number): void {
    this.seen.set(id, {
      instance,
      locX,
      locY,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
    });
  }

  private moveInstance(instance: ScriptInstance, x: number, y: number): void {
    this.movie.runtime.callMethod(instance, "moveto", [Math.round(x), Math.round(y)]);
  }

  private moveInstanceTo(instance: ScriptInstance, x: number, y: number): MoveResult {
    const targetX = Math.round(x);
    const targetY = Math.round(y);
    const currentX = this.numberProp(instance, "plocx", targetX);
    const currentY = this.numberProp(instance, "plocy", targetY);
    if (currentX === targetX && currentY === targetY) {
      return { moved: false, dx: 0, dy: 0, x: currentX, y: currentY };
    }
    this.moveInstance(instance, targetX, targetY);
    const nextX = this.numberProp(instance, "plocx", targetX);
    const nextY = this.numberProp(instance, "plocy", targetY);
    return { moved: nextX !== currentX || nextY !== currentY, dx: nextX - currentX, dy: nextY - currentY, x: nextX, y: nextY };
  }

  private setWideBoundary(instance: ScriptInstance): void {
    if (!this.movie.runtime.hasHandler(instance, "setproperty")) return;
    const boundary = new LingoRect(-1000, -1000, this.viewportWidth + 1000, this.viewportHeight + 1000);
    this.movie.runtime.callMethod(instance, "setproperty", [LingoSymbol.for("boundary"), boundary]);
  }

  private numberProperty(instance: ScriptInstance, property: string, fallback: number): number {
    try {
      const value = this.movie.runtime.callMethod(instance, "getproperty", [LingoSymbol.for(property)]);
      const result = this.numberValue(value, Number.NaN);
      return Number.isFinite(result) ? result : fallback;
    } catch {
      return this.numberProp(instance, `p${property}`, fallback);
    }
  }

  private numberProp(instance: ScriptInstance, prop: string, fallback: number): number {
    const value = instance.props.get(prop.toLowerCase()) ?? LINGO_VOID;
    return this.numberValue(value, fallback);
  }

  private numberValue(value: LingoValue, fallback: number): number {
    if (typeof value === "number") return value;
    if (value instanceof LingoFloat) return value.value;
    const numeric = Number(stringOf(value));
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  private resizeCoverSprite(roomInterface: ScriptInstance, anchors: ResizeEngineAnchor[]): boolean {
    const cover = this.instanceProp(roomInterface, "pcoverspr");
    if (!(cover instanceof SpriteChannel)) return false;
    const height = Math.max(1, this.toolbarTop());
    if (cover.width === this.viewportWidth && cover.height === height) return false;
    cover.width = this.viewportWidth;
    cover.height = height;
    anchors.push({ id: "pCoverSpr", kind: "sprite", action: "resize", width: cover.width, height: cover.height });
    return true;
  }

  private resizeDimmerSprite(visualizer: ScriptInstance, anchors: ResizeEngineAnchor[]): boolean {
    const dimmer = this.instanceProp(visualizer, "proomdimmersprite");
    if (!(dimmer instanceof SpriteChannel)) return false;
    const height = Math.max(1, this.toolbarTop());
    if (dimmer.width === this.viewportWidth + 20 && dimmer.height === height) return false;
    dimmer.width = this.viewportWidth + 20;
    dimmer.height = height;
    anchors.push({ id: "pRoomDimmerSprite", kind: "sprite", action: "resize", width: dimmer.width, height: dimmer.height });
    return true;
  }

  private correctWrapperSpriteLocations(
    visualizer: ScriptInstance,
    currentX: number,
    currentY: number,
    anchors: ResizeEngineAnchor[],
  ): boolean {
    const roomStage = this.roomStage;
    if (!roomStage || roomStage.instance !== visualizer) return false;
    const wrappedParts = this.instanceProp(visualizer, "pwrappedparts");
    if (!(wrappedParts instanceof LingoPropList)) return false;
    let changed = false;
    const appliedX = Math.round(currentX - roomStage.baseX);
    const appliedY = Math.round(currentY - roomStage.baseY);
    for (let index = 0; index < wrappedParts.values.length; index += 1) {
      const wrapper = wrappedParts.values[index];
      if (!(wrapper instanceof ScriptInstance)) continue;
      const typeDef = this.normalizedSymbol(this.instanceProp(wrapper, "ptypedef"));
      const sprite = this.instanceProp(wrapper, "psprite");
      const offsets = this.instanceProp(wrapper, "poffsets");
      if (!(sprite instanceof SpriteChannel) || !(offsets instanceof LingoList)) continue;
      const offsetX = this.numberValue(offsets.getAt(1), sprite.locH);
      const offsetY = this.numberValue(offsets.getAt(2), sprite.locV);
      const baselineKey = this.wrapperBaselineKey(wrappedParts, index, wrapper);
      let baseline = roomStage.wrappers.get(baselineKey);
      if (!baseline || baseline.instance !== wrapper) {
        baseline = this.captureWrapperBaseline(wrapper, offsetX, offsetY, 0, 0);
        roomStage.wrappers.set(baselineKey, baseline);
      }
      const wrapperAppliedX = Math.round(appliedX - baseline.appliedX);
      const wrapperAppliedY = Math.round(appliedY - baseline.appliedY);
      const contentShift = this.wrapperUniformPartShift(roomStage, baselineKey, wrapper);
      const expectedSpriteMovedX = Math.round(offsetX + wrapperAppliedX);
      const expectedSpriteMovedY = Math.round(offsetY + wrapperAppliedY);
      if (contentShift && this.matchesRoomStageMove(contentShift, wrapperAppliedX, wrapperAppliedY)) {
        if (this.spriteAt(sprite, expectedSpriteMovedX, expectedSpriteMovedY)) {
          continue;
        }
        sprite.locH = expectedSpriteMovedX;
        sprite.locV = expectedSpriteMovedY;
        changed = true;
        anchors.push({
          id: `wrapper:${String(wrappedParts.keys[index] ?? index + 1)}`,
          kind: "sprite",
          action: "wrapper-source-owned-corrected",
          x: sprite.locH,
          y: sprite.locV,
          note: `${typeDef} stray→${expectedSpriteMovedX},${expectedSpriteMovedY}`,
        });
        continue;
      }
      const expectedX = expectedSpriteMovedX;
      const expectedY = expectedSpriteMovedY;
      if (sprite.locH === expectedX && sprite.locV === expectedY) continue;
      console.debug(`[resize] wrapper ${typeDef} sp${sprite.number}: sprite@${sprite.locH},${sprite.locV} → expected@${expectedX},${expectedY} (offsetX=${offsetX} wrapperApplied=${wrapperAppliedX},${wrapperAppliedY} applied=${appliedX},${appliedY} base=${roomStage.baseX},${roomStage.baseY})`);
      sprite.locH = expectedX;
      sprite.locV = expectedY;
      changed = true;
      anchors.push({
        id: `wrapper:${String(wrappedParts.keys[index] ?? index + 1)}`,
        kind: "sprite",
        action: "wrapper-follow",
        x: expectedX,
        y: expectedY,
        note: typeDef,
      });
    }
    return changed;
  }

  private captureWrapperBaselines(visualizer: ScriptInstance, appliedX: number, appliedY: number): Map<string, WrapperStageBaseline> {
    const result = new Map<string, WrapperStageBaseline>();
    const wrappedParts = this.instanceProp(visualizer, "pwrappedparts");
    if (!(wrappedParts instanceof LingoPropList)) return result;
    for (let index = 0; index < wrappedParts.values.length; index += 1) {
      const wrapper = wrappedParts.values[index];
      if (!(wrapper instanceof ScriptInstance)) continue;
      const offsets = this.instanceProp(wrapper, "poffsets");
      const sprite = this.instanceProp(wrapper, "psprite");
      const fallbackX = sprite instanceof SpriteChannel ? sprite.locH : 0;
      const fallbackY = sprite instanceof SpriteChannel ? sprite.locV : 0;
      const offsetX = offsets instanceof LingoList ? this.numberValue(offsets.getAt(1), fallbackX) : fallbackX;
      const offsetY = offsets instanceof LingoList ? this.numberValue(offsets.getAt(2), fallbackY) : fallbackY;
      result.set(this.wrapperBaselineKey(wrappedParts, index, wrapper), this.captureWrapperBaseline(wrapper, offsetX, offsetY, appliedX, appliedY));
    }
    return result;
  }

  private captureWrapperBaseline(
    wrapper: ScriptInstance,
    offsetX: number,
    offsetY: number,
    appliedX: number,
    appliedY: number,
  ): WrapperStageBaseline {
    return {
      instance: wrapper,
      offsetX,
      offsetY,
      appliedX: Math.round(appliedX),
      appliedY: Math.round(appliedY),
      parts: this.wrapperPartBaselines(wrapper),
    };
  }

  private wrapperUniformPartShift(
    roomStage: RoomStageState,
    baselineKey: string,
    wrapper: ScriptInstance,
  ): { x: number; y: number } | null {
    const baseline = roomStage.wrappers.get(baselineKey);
    if (!baseline || baseline.instance !== wrapper) return null;
    const parts = this.wrapperPartBaselines(wrapper);
    if (parts.length === 0 || parts.length !== baseline.parts.length) return null;
    let absorbedX: number | null = null;
    let absorbedY: number | null = null;
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = parts[partIndex];
      const base = baseline.parts[partIndex];
      if (!part || !base) return null;
      const dx = Math.round(part.locH - base.locH);
      const dy = Math.round(part.locV - base.locV);
      if (absorbedX === null) absorbedX = dx;
      if (absorbedY === null) absorbedY = dy;
      if (absorbedX !== dx || absorbedY !== dy) return null;
    }
    return { x: Math.round(absorbedX ?? 0), y: Math.round(absorbedY ?? 0) };
  }

  private matchesRoomStageMove(shift: { x: number; y: number }, appliedX: number, appliedY: number): boolean {
    return Math.abs(shift.x - appliedX) <= 1 && Math.abs(shift.y - appliedY) <= 1;
  }

  private spriteAt(sprite: SpriteChannel, x: number, y: number): boolean {
    return Math.round(sprite.locH) === Math.round(x) && Math.round(sprite.locV) === Math.round(y);
  }

  private wrapperPartBaselines(wrapper: ScriptInstance): WrapperPartBaseline[] {
    const partList = this.instanceProp(wrapper, "ppartlist");
    if (!(partList instanceof LingoList)) return [];
    const parts: WrapperPartBaseline[] = [];
    for (const value of partList.items) {
      if (!(value instanceof LingoPropList)) continue;
      parts.push({
        locH: this.numberValue(this.propListLookup(value, "#locH"), 0),
        locV: this.numberValue(this.propListLookup(value, "#locV"), 0),
      });
    }
    return parts;
  }

  private wrapperBaselineKey(wrappedParts: LingoPropList, index: number, wrapper: ScriptInstance): string {
    const key = stringOf(wrappedParts.keys[index] ?? index + 1).trim().toLowerCase();
    const type = this.normalizedSymbol(this.instanceProp(wrapper, "pTypeDef"));
    return `${index}:${key}:${type}`;
  }

  private roomStageEpochKey(visualizer: ScriptInstance, sourceWideOffset: number): string {
    const layout = stringOf(this.instanceProp(visualizer, "pLayout")).trim().toLowerCase();
    return `${layout}|${sourceWideOffset}`;
  }

  private moveInfoStandLooseSprites(
    roomInterface: ScriptInstance | null,
    dx: number,
    dy: number,
    anchors: ResizeEngineAnchor[],
  ): boolean {
    if (!roomInterface || (dx === 0 && dy === 0)) return false;
    let changed = false;
    for (const prop of ["pinfostandtitlespr", "pinfostandtitlebgspr", "pinfostandtitlepanelspr"]) {
      const sprite = this.instanceProp(roomInterface, prop);
      if (!(sprite instanceof SpriteChannel)) continue;
      sprite.locH = Math.round(sprite.locH + dx);
      sprite.locV = Math.round(sprite.locV + dy);
      changed = true;
      anchors.push({
        id: prop,
        kind: "sprite",
        action: "infostand-title-follow",
        x: sprite.locH,
        y: sprite.locV,
      });
    }
    return changed;
  }

  private positionInfoStandTitle(roomInterface: ScriptInstance | null, anchors: ResizeEngineAnchor[]): boolean {
    if (!roomInterface || !this.movie.runtime.hasHandler(roomInterface, "positioninfostandtitlesprite")) return false;
    const before = this.infoStandTitleSpritePositions(roomInterface);
    this.movie.runtime.callMethod(roomInterface, "positioninfostandtitlesprite", []);
    const after = this.infoStandTitleSpritePositions(roomInterface);
    let changed = false;
    for (const [prop, position] of after) {
      const previous = before.get(prop);
      if (previous && previous.x === position.x && previous.y === position.y) continue;
      changed = true;
      anchors.push({
        id: prop,
        kind: "sprite",
        action: "infostand-title-source-position",
        x: position.x,
        y: position.y,
      });
    }
    return changed;
  }

  private infoStandTitleSpritePositions(roomInterface: ScriptInstance): Map<string, { x: number; y: number }> {
    const result = new Map<string, { x: number; y: number }>();
    for (const prop of ["pinfostandtitlespr", "pinfostandtitlebgspr", "pinfostandtitlepanelspr"]) {
      const sprite = this.instanceProp(roomInterface, prop);
      if (sprite instanceof SpriteChannel) result.set(prop, { x: sprite.locH, y: sprite.locV });
    }
    return result;
  }

  private anchorBulletinNotifications(manager: ScriptInstance, anchors: ResizeEngineAnchor[]): boolean {
    const notifications = this.instanceProp(manager, "pnotifications");
    if (!(notifications instanceof LingoPropList)) return false;
    const rightMargin = Math.max(0, this.numberProp(manager, "prightmargin", 4));
    let changed = false;
    for (let index = 0; index < notifications.values.length; index += 1) {
      const notification = notifications.values[index];
      if (!(notification instanceof LingoPropList)) continue;
      const sprite = this.propListLookup(notification, "#sprite");
      if (!(sprite instanceof SpriteChannel)) continue;
      const width =
        sprite.width ||
        sprite.member?.image?.width ||
        sprite.member?.bitmap?.width;
      const effectiveWidth = Math.max(1, Math.round(width || 254));
      const targetX = Math.round(this.viewportWidth - effectiveWidth - rightMargin);
      if (sprite.locH === targetX) continue;
      sprite.locH = targetX;
      changed = true;
      anchors.push({
        id: `bulletin_notification:${String(notifications.keys[index] ?? index + 1)}`,
        kind: "sprite",
        action: "top-right-notification",
        x: sprite.locH,
        y: sprite.locV,
        width: effectiveWidth,
      });
    }
    return changed;
  }

  private rememberEntryAnimationOffsets(offsetX: number, offsetY: number): void {
    const entryInterface = this.object("#entry_interface") ?? this.object("entry_interface");
    if (!entryInterface) return;
    const itemObjects = this.instanceProp(entryInterface, "pitemobjlist");
    if (!(itemObjects instanceof LingoList)) return;
    for (const item of itemObjects.items) {
      if (!(item instanceof ScriptInstance)) continue;
      const sprite = this.instanceProp(item, "psprite");
      if (sprite instanceof SpriteChannel) {
        this.entryAnimationOffsets.set(sprite.number, {
          x: Math.round(offsetX),
          y: Math.round(offsetY),
          lastX: sprite.locH,
          lastY: sprite.locV,
        });
      }
    }
  }

  private anchorEntryAnimationSprites(
    entryInterface: ScriptInstance,
    offsetX: number,
    offsetY: number,
    anchors: ResizeEngineAnchor[],
  ): boolean {
    const itemObjects = this.instanceProp(entryInterface, "pitemobjlist");
    if (!(itemObjects instanceof LingoList)) return false;
    let changed = false;
    const liveSprites = new Set<number>();
    for (const item of itemObjects.items) {
      if (!(item instanceof ScriptInstance)) continue;
      const sprite = this.instanceProp(item, "psprite");
      if (!(sprite instanceof SpriteChannel)) continue;
      liveSprites.add(sprite.number);
      const remembered = this.entryAnimationOffsets.get(sprite.number) ?? {
        x: 0,
        y: 0,
        lastX: sprite.locH,
        lastY: sprite.locV,
      };
      const sourceLoc = this.instanceProp(item, "ploc");
      const looksLikeContinuousSourceUpdate =
        remembered.x !== 0 || remembered.y !== 0
          ? Math.abs(sprite.locH - remembered.lastX) <= 96 && Math.abs(sprite.locV - remembered.lastY) <= 96
          : false;
      const baseX =
        sourceLoc instanceof LingoPoint
          ? sourceLoc.x
          : looksLikeContinuousSourceUpdate
            ? sprite.locH - remembered.x
            : sprite.locH;
      const baseY =
        sourceLoc instanceof LingoPoint
          ? sourceLoc.y
          : looksLikeContinuousSourceUpdate
            ? sprite.locV - remembered.y
            : sprite.locV;
      const targetX = Math.round(baseX + offsetX);
      const targetY = Math.round(baseY + offsetY);
      this.entryAnimationOffsets.set(sprite.number, {
        x: Math.round(offsetX),
        y: Math.round(offsetY),
        lastX: targetX,
        lastY: targetY,
      });
      if (sprite.locH === targetX && sprite.locV === targetY) continue;
      sprite.locH = targetX;
      sprite.locV = targetY;
      changed = true;
      anchors.push({
        id: `entry_animation:${sprite.number}`,
        kind: "sprite",
        action: "animation-stage-center",
        x: targetX,
        y: targetY,
        note: item.module.scriptName,
      });
    }
    for (const spriteNumber of [...this.entryAnimationOffsets.keys()]) {
      if (!liveSprites.has(spriteNumber)) this.entryAnimationOffsets.delete(spriteNumber);
    }
    return changed;
  }

  private instanceProp(instance: ScriptInstance, prop: string): LingoValue {
    let target: ScriptInstance | LingoVoid = instance;
    const key = prop.toLowerCase();
    while (target instanceof ScriptInstance) {
      if (target.props.has(key)) return target.props.get(key) ?? LINGO_VOID;
      target = target.ancestor;
    }
    return LINGO_VOID;
  }

  private normalizedSymbol(value: LingoValue): string {
    if (value instanceof LingoSymbol) return value.name.toLowerCase();
    return stringOf(value).replace(/^#/, "").toLowerCase();
  }
}
