import { ChunkRef, DirectorHost, MissingScriptRef, Runtime, ScriptInstance, UnsupportedFeatureError } from "./Runtime";
import { inspectDirectorBitmapMedia, type DirectorBitmapMediaInspection } from "./directorBitmapMedia";
import { LingoColor, LingoDate, LingoPoint, LingoRect } from "./geometry";
import { LingoBitmapMedia, LingoImage } from "./imaging";
import { paletteColor } from "./palettes";
import {
  LINGO_VOID,
  LingoList,
  LingoObjectLike,
  LingoPropList,
  LingoSymbol,
  LingoValue,
  LingoVoid,
  duplicateValue,
  isNumber,
  numberOf,
} from "./values";
import { CastMember, CastRegistry } from "./members";
import {
  createDirectorNetworkHost,
  type DirectorNetworkBridgeOptions,
  type DirectorNetworkHost,
} from "./network";
import { LAST_CHANNEL, SpriteChannel, createChannels } from "./sprites";
import * as ops from "./ops";

/**
 * Minimal Director movie host: score frame loop, markers, frame behaviors,
 * tempo, castLib references, and the network-preload builtins the release306
 * entry movie uses (preloadNetThing/netDone). Rendering is delegated to a
 * presenter callback; game behavior comes entirely from generated code.
 */

export interface ManifestCast {
  number: number;
  name: string;
  members: { number: number; name: string; type: string }[];
}

export interface ManifestScore {
  frameRate: number;
  markers: { name: string; frame: number }[];
  behaviors: {
    startFrame: number;
    endFrame: number;
    channel: number;
    script: { castLib: number; member: number };
  }[];
  frames: { index: number }[];
}

export interface MovieManifest {
  stage: { width: number; height: number; backgroundColor: string };
  casts: ManifestCast[];
  score: ManifestScore;
}

const TEXT_CHUNK_STYLE_PROPERTIES = new Set(["color", "font", "fontsize", "fontstyle"]);
const POINTER_TARGET_EVENTS = ["mouseenter", "mouseleave", "mousewithin", "mousedown", "mouseup", "mouseupoutside"];
const DIRECTOR_TEXT_ANTIALIAS_THRESHOLD = 14;
const DARK_TEXT_BITMAP_ALPHA_THRESHOLD = 64;
const LIGHT_TEXT_BITMAP_ALPHA_THRESHOLD = 160;
const WHITE = new LingoColor(255, 255, 255);

export class CastLibRef implements LingoObjectLike {
  readonly lingoType = "castLibRef";
  preloadMode = 0;
  name: string;
  /** Setting fileName is Director's dynamic cast-load trigger. */
  fileName: string;

  constructor(
    public readonly number: number,
    initialName: string,
  ) {
    this.name = initialName;
    this.fileName = `${initialName}.cst`;
  }

  lingoToString(): string {
    return `(castLib ${this.number})`;
  }
}

export class StageRef implements LingoObjectLike {
  readonly lingoType = "stageRef";
}

/** Director timeout object: timeout("name").new(periodMs, #handler, target)
 * fires handler on target every period until forget(). */
export class TimeoutRef implements LingoObjectLike {
  readonly lingoType = "timeout";
  periodMs = 0;
  handler: LingoValue = LINGO_VOID;
  target: LingoValue = LINGO_VOID;
  nextFireAt = 0;
  active = false;

  constructor(
    public readonly name: string,
    private readonly owner: DirectorMovie,
  ) {}

  schedule(periodMs: number, handler: LingoValue, target: LingoValue): void {
    this.periodMs = Math.max(1, periodMs);
    this.handler = handler;
    this.target = target;
    this.nextFireAt = Date.now() + this.periodMs;
    this.active = true;
  }

  forget(): void {
    this.active = false;
    this.owner.dropTimeout(this.name);
  }
}

/** Director sound(channel) host object. Habbo's generated Sound Channel Class
 * owns scheduling and loop timing; this object supplies the native Director
 * channel surface it checks via ilk(#instance). */
export class SoundChannelRef implements LingoObjectLike {
  readonly lingoType = "instance";
  volume = 255;
  member: LingoValue = 0;
  private busy = false;
  private playlist = new LingoList();
  private current: LingoValue = LINGO_VOID;

  constructor(public readonly number: number) {}

  setPlayList(list: LingoValue): void {
    this.playlist = list instanceof LingoList ? new LingoList([...list.items]) : new LingoList();
  }

  getPlayList(): LingoList {
    return this.playlist;
  }

  play(item: LingoValue = LINGO_VOID): number {
    if (!(item instanceof LingoVoid)) {
      this.current = item;
    } else if (this.playlist.count() > 0) {
      this.current = this.playlist.getAt(1);
    }
    this.member = soundEntryMember(this.current);
    this.busy = !(this.member instanceof LingoVoid) && this.member !== 0;
    return 1;
  }

  queue(item: LingoValue): number {
    this.playlist.add(item);
    return 1;
  }

  stop(): number {
    this.busy = false;
    this.member = 0;
    this.current = LINGO_VOID;
    return 1;
  }

  isBusy(): number {
    return this.busy ? 1 : 0;
  }

  lingoToString(): string {
    return `(sound ${this.number})`;
  }
}

function soundEntryMember(entry: LingoValue): LingoValue {
  if (entry instanceof LingoPropList) {
    return entry.getaProp(LingoSymbol.for("member"), ops.lingoKeyEquals);
  }
  return LINGO_VOID;
}

/** Director time format: "1:23 PM" (short) / "1:23:45 PM" (long). */
function formatTime(now: Date, long: boolean): string {
  let hours = now.getHours();
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return long ? `${hours}:${minutes}:${seconds} ${suffix}` : `${hours}:${minutes} ${suffix}`;
}

export interface MovieLogSink {
  log(kind: "info" | "error" | "put", text: string): void;
}

export class DirectorMovie implements DirectorHost {
  readonly runtime: Runtime;
  private readonly network: DirectorNetworkHost;
  private currentFrame = 1;
  private nextFrameOverride: number | null = null;
  private tempo: number;
  private readonly castLibs: CastLibRef[];
  private readonly stage = new StageRef();
  private stageViewport = { width: 0, height: 0 };
  private readonly behaviorInstances = new Map<string, ScriptInstance>();
  private preloads = new Map<string, "loading" | "done" | "failed">();
  private halted: string | null = null;
  /** Director net job table for getNetText/netDone/netError/netTextResult. */
  private netJobs = new Map<number, { state: "loading" | "done" | "failed"; text: string; error: string | number; url: string }>();
  private nextNetId = 1;
  private readonly timeouts = new Map<string, TimeoutRef>();
  private readonly soundChannels = new Map<number, SoundChannelRef>();
  private tickCounter = 0;
  private lastTickTimeMs = 0;

  dropTimeout(name: string): void {
    this.timeouts.delete(name.toLowerCase());
  }

  /** Director resolves relative net URLs against the movie path. Dead
   * origins-gamedata.habbo.com endpoints mirror to the local client files
   * (same approach as the original hotel page's sw-param overrides). */
  private resolveUrl(url: string): string {
    const gamedata = /^https?:\/\/origins-gamedata\.habbo\.com\/([a-z_]+)\/\d+/i.exec(url);
    if (gamedata) {
      const fileByEndpoint: Record<string, string> = {
        external_variables: "external_variables.txt",
        external_texts: "external_texts.txt",
        figuredata_xml: "figuredata.xml",
      };
      const file = fileByEndpoint[gamedata[1]!.toLowerCase()];
      if (file) return this.moviePath + file;
    }
    if (/^(https?:)?\/\//i.test(url) || url.startsWith("/")) {
      return url;
    }
    return this.moviePath + url;
  }

  /** Fires due timeouts; called from tick(). */
  private fireTimeouts(): void {
    const now = Date.now();
    for (const timeoutRef of [...this.timeouts.values()]) {
      if (!timeoutRef.active || now < timeoutRef.nextFireAt) continue;
      timeoutRef.nextFireAt = now + timeoutRef.periodMs;
      const handlerName =
        timeoutRef.handler instanceof LingoSymbol
          ? timeoutRef.handler.name
          : ops.stringOf(timeoutRef.handler);
      const target = timeoutRef.target;
      this.guard(`timeout ${timeoutRef.name}`, () => {
        if (target instanceof ScriptInstance) {
          this.runtime.callMethod(target, handlerName.toLowerCase(), [timeoutRef]);
        } else {
          this.runtime.call(handlerName.toLowerCase(), [timeoutRef]);
        }
      });
    }
  }
  centerStage = 0;
  exitLock = 0;
  alertHook: LingoValue = LINGO_VOID;
  stageBgColor: LingoValue = 0;
  /** Live pointer position over the stage (updated by the app shell). */
  mouseH = 0;
  mouseV = 0;
  mouseDownFlag = 0;
  private doubleClickFlag = 0;
  private lastClickTimeMs = 0;
  private lastClickSpriteNumber = 0;
  private lastClickH = Number.NaN;
  private lastClickV = Number.NaN;
  keyboardFocusSprite: LingoValue = 0;
  /** `the key` / `the keyCode` of the most recent keyboard event. */
  lastKey = "";
  lastKeyCode = 0;
  shiftDown = 0;
  /** Global text selection endpoints used by Director text/field editing. */
  selStart = 0;
  selEnd = 0;
  /** Sprite that received the last mouseDown (mouseUp vs mouseUpOutSide). */
  private mouseDownSprite: SpriteChannel | null = null;
  private hoverSprite: SpriteChannel | null = null;
  private rolloverSprite: SpriteChannel | null = null;
  private textMeasureContext: CanvasRenderingContext2D | null | undefined;

  readonly channels = createChannels();
  onObjectRegistered: (id: LingoValue, object: LingoValue, classList: LingoValue) => void = () => {};
  onCastLoaded: (castName: string, castNumber: number) => void = () => {};
  /** Notified when a runtime image buffer is permanently replaced, so the
   * presenter can destroy its GPU texture instead of leaking it. */
  onImageReleased: (image: LingoImage) => void = () => {};

  constructor(
    private readonly manifest: MovieManifest,
    private readonly log: MovieLogSink,
    private readonly fetchPreload: (fileName: string) => Promise<void>,
    private readonly fetchText: (url: string) => Promise<string>,
    private readonly members: CastRegistry,
    private readonly onStageChange: () => void = () => {},
    /** Base URL the original movie lives at; cast fileNames resolve here. */
    private readonly moviePath = "/origins-data/source/",
    /** Shockwave embed parameters (sw1..sw9): the original hotel page's
     * config-injection mechanism (Core Thread parses them in Plugin mode). */
    private readonly externalParams = new Map<string, string>(),
    /** Decodes a loaded cast's bitmap PNGs into image buffers (browser);
     * no-op in the Node simulator. */
    private readonly decodeCastImages: (castName: string) => Promise<void> = async () => {},
    /** Director Multiuser/BobbaXtra shim backed by the local Origins 306
     * relay. The browser side stays plaintext; the relay owns BobbaCrypto. */
    networkOptions: DirectorNetworkBridgeOptions = {},
    /** Live stage-image snapshot provider for `(the stage).image`. The
     * Director host owns the API shape; the browser app supplies Pixi pixels. */
    private readonly stageImageProvider: () => LingoImage | null = () => null,
  ) {
    this.runtime = new Runtime(this);
    this.network = createDirectorNetworkHost(
      networkOptions,
      (target, handlerName) => {
        this.runtime.callMethod(target, handlerName, []);
      },
      (message) => this.log.log("info", message),
    );
    this.tempo = manifest.score.frameRate;
    this.castLibs = manifest.casts.map((cast) => new CastLibRef(cast.number, cast.name));
    this.stageViewport = {
      width: manifest.stage.width,
      height: manifest.stage.height,
    };
  }

  get frame(): number {
    return this.currentFrame;
  }

  get frameTempo(): number {
    return this.tempo;
  }

  get haltedReason(): string | null {
    return this.halted;
  }

  tickDiagnostics(): {
    tickCount: number;
    lastTickTimeMs: number;
    timeouts: Array<{
      name: string;
      active: boolean;
      periodMs: number;
      dueInMs: number;
      handler: string;
      targetType: string;
      targetScript: string | null;
    }>;
  } {
    const now = Date.now();
    return {
      tickCount: this.tickCounter,
      lastTickTimeMs: this.lastTickTimeMs,
      timeouts: [...this.timeouts.values()].map((timeoutRef) => ({
        name: timeoutRef.name,
        active: timeoutRef.active,
        periodMs: timeoutRef.periodMs,
        dueInMs: timeoutRef.active ? Math.max(0, timeoutRef.nextFireAt - now) : 0,
        handler:
          timeoutRef.handler instanceof LingoSymbol
            ? `#${timeoutRef.handler.name}`
            : ops.displayString(timeoutRef.handler),
        targetType:
          timeoutRef.target instanceof LingoVoid
            ? "void"
            : typeof timeoutRef.target === "object" && timeoutRef.target && "lingoType" in timeoutRef.target
              ? String((timeoutRef.target as LingoObjectLike).lingoType)
              : typeof timeoutRef.target,
        targetScript: timeoutRef.target instanceof ScriptInstance ? timeoutRef.target.module.scriptName : null,
      })),
    };
  }

  get stageViewportWidth(): number {
    return this.stageViewport.width;
  }

  get stageViewportHeight(): number {
    return this.stageViewport.height;
  }

  get manifestStageWidth(): number {
    return this.manifest.stage.width;
  }

  get manifestStageHeight(): number {
    return this.manifest.stage.height;
  }

  setStageViewport(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth === this.stageViewport.width && nextHeight === this.stageViewport.height) return;
    this.stageViewport = { width: nextWidth, height: nextHeight };
    this.onStageChange();
  }

  resetStageViewport(): void {
    this.setStageViewport(this.manifest.stage.width, this.manifest.stage.height);
  }

  get networkBridgeUrl(): string {
    return this.network.bridgeUrl;
  }

  objectRegistered = (id: LingoValue, object: LingoValue, classList: LingoValue): void => {
    this.onObjectRegistered(id, object, classList);
  };

  markerName(frame: number): string | null {
    return this.manifest.score.markers.find((marker) => marker.frame === frame)?.name ?? null;
  }

  private castLibNameForNumber(castNumber: number): string | null {
    return this.castLibs.find((cast) => cast.number === castNumber)?.name ?? null;
  }

  private ensureCastLib(name: string): CastLibRef {
    const existing = this.castLibs.find((cast) => cast.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const nextNumber = Math.max(0, ...this.castLibs.map((cast) => cast.number)) + 1;
    const cast = new CastLibRef(nextNumber, name);
    this.castLibs.push(cast);
    return cast;
  }

  private assignSpriteMember(channel: SpriteChannel, value: LingoValue, castName: string | null = null): void {
    if (value instanceof CastMember) {
      channel.member = value;
      channel.castLibNum = value.castNumber;
      return;
    }
    if (value === 0 || value instanceof LingoVoid) {
      channel.member = null;
      return;
    }
    const member = this.members.find(value, castName);
    channel.member = member;
    if (member) {
      channel.castLibNum = member.castNumber;
    }
  }

  private soundChannel(value: LingoValue): SoundChannelRef {
    const channelNumber = Math.max(
      1,
      Math.round(isNumber(value) ? numberOf(value) : Number(ops.stringOf(value)) || 1),
    );
    let channel = this.soundChannels.get(channelNumber);
    if (!channel) {
      channel = new SoundChannelRef(channelNumber);
      this.soundChannels.set(channelNumber, channel);
    }
    return channel;
  }

  /** Run prepareMovie (movie scripts), then the frame loop begins. */
  start(): void {
    this.guard("prepareMovie", () => {
      this.runtime.call("preparemovie", []);
    });
  }

  /** One score tick: prepareFrame to timeout targets (Director sends frame
   * events to timeout targets; the Object Manager's 1-hour #null timeout
   * exists precisely to receive prepareFrame and pump #prepare/#update),
   * then exitFrame to frame behaviors, then advance the playback head. */
  tick(): void {
    this.tickCounter += 1;
    this.lastTickTimeMs = Date.now();
    if (this.halted) return;
    this.nextFrameOverride = null;
    for (const timeoutRef of [...this.timeouts.values()]) {
      const target = timeoutRef.target;
      if (
        timeoutRef.active &&
        target instanceof ScriptInstance &&
        this.runtime.hasHandler(target, "prepareframe")
      ) {
        this.guard(`prepareFrame(${timeoutRef.name})`, () => {
          this.runtime.callMethod(target, "prepareframe", []);
        });
      }
    }
    const behaviors = this.manifest.score.behaviors.filter(
      (behavior) =>
        behavior.startFrame <= this.currentFrame && behavior.endFrame >= this.currentFrame,
    );
    for (const behavior of behaviors) {
      const key = `${behavior.script.castLib}:${behavior.script.member}:${behavior.startFrame}`;
      let instance = this.behaviorInstances.get(key);
      if (!instance) {
        const module = this.resolveScript(behavior.script.castLib, behavior.script.member);
        if (!module) {
          this.log.log(
            "error",
            `missing behavior script castLib ${behavior.script.castLib} member ${behavior.script.member}`,
          );
          continue;
        }
        instance = new ScriptInstance(module);
        this.behaviorInstances.set(key, instance);
      }
      const target = instance;
      this.guard(`exitFrame @${this.currentFrame}`, () => {
        if (target.module.handlers["exitframe"]) {
          this.runtime.callMethod(target, "exitframe", []);
        }
      });
      if (this.halted) return;
    }
    this.fireTimeouts();
    const total = this.manifest.score.frames.length;
    const next = this.nextFrameOverride ?? this.currentFrame + 1;
    this.currentFrame = Math.max(1, Math.min(total, next));
  }

  private resolveScript(castLibNumber: number, memberNumber: number) {
    const cast = this.manifest.casts.find((entry) => entry.number === castLibNumber);
    const member = cast?.members.find((entry) => entry.number === memberNumber);
    if (!cast || !member) return null;
    return (
      this.runtime.findScriptByMember(cast.name, member.number)?.module ??
      this.runtime.findScript(member.name)?.module ??
      null
    );
  }

  // -- Input event dispatch ---------------------------------------------------

  /** Topmost visible puppet sprite whose rect contains the stage point. */
  spriteAt(x: number, y: number): SpriteChannel | null {
    return this.spritesAt(x, y)[0] ?? null;
  }

  spritesAt(x: number, y: number): SpriteChannel[] {
    const hits: SpriteChannel[] = [];
    for (const channel of this.channels) {
      if (channel.puppet !== 1 || channel.visible !== 1 || !channel.member) continue;
      const rect = this.spriteRect(channel);
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) {
        hits.push(channel);
      }
    }
    return hits.sort((left, right) => right.locZ - left.locZ || right.number - left.number);
  }

  spriteBounds(channelNumber: number): LingoRect | null {
    const channel = this.channels[channelNumber];
    return channel ? this.spriteRect(channel) : null;
  }

  inputSpriteAt(x: number, y: number, events: readonly string[] = POINTER_TARGET_EVENTS): SpriteChannel | null {
    return this.eventSpriteAt(x, y, events);
  }

  private channelHasHandler(channel: SpriteChannel, event: string): boolean {
    for (const instance of channel.scriptInstanceList.items) {
      if (instance instanceof ScriptInstance && this.runtime.hasHandler(instance, event)) {
        return true;
      }
    }
    return false;
  }

  private channelHasAnyHandler(channel: SpriteChannel, events: readonly string[]): boolean {
    return events.some((event) => this.channelHasHandler(channel, event));
  }

  /** Director primary mouse events are delivered to the topmost sprite that
   * can handle the event. Visual-only sprites still draw in front, but they do
   * not consume room clicks before the Event Broker receives them. */
  private eventSpriteAt(x: number, y: number, events: readonly string[]): SpriteChannel | null {
    for (const channel of this.spritesAt(x, y)) {
      if (!this.channelAcceptsInputAt(channel, x, y)) continue;
      if (this.channelEditable(channel) || this.channelHasAnyHandler(channel, events)) {
        return channel;
      }
    }
    return null;
  }

  private channelAcceptsInputAt(channel: SpriteChannel, x: number, y: number): boolean {
    if (!channel.member) return false;
    const local = this.spriteSourcePoint(channel, x, y);
    if (!local) return false;
    // Editable Director field/text sprites focus over their whole sprite
    // rectangle. Their rendered image can be empty or key-transparent before
    // typing, so bitmap matte hit masks must not make them click-through.
    if (this.channelEditable(channel)) return true;
    if (!this.channelUsesTransparentInputMask(channel)) return true;
    const image = this.memberHitImage(channel.member);
    if (!image || image.incomplete) return true;
    const sourceX = Math.max(0, Math.min(image.width - 1, Math.floor((local.x / local.width) * image.width)));
    const sourceY = Math.max(0, Math.min(image.height - 1, Math.floor((local.y / local.height) * image.height)));
    const alpha = image.getPixelAlpha ? image.getPixelAlpha(sourceX, sourceY) : 255;
    if (alpha <= 0) return false;
    const pixel = image.getPixel(sourceX, sourceY);
    if (channel.ink === 8) {
      if (!this.sameRgb(pixel, WHITE)) return true;
      if (this.channelUsesBoundaryMatteInput(channel, image)) {
        return !(image.isBoundaryConnectedColorPixel?.(sourceX, sourceY, WHITE) ?? true);
      }
      return false;
    }
    if (channel.ink === 33 || channel.ink === 36) {
      return !this.sameRgb(pixel, this.transparentKeyColor(channel));
    }
    return true;
  }

  private channelUsesTransparentInputMask(channel: SpriteChannel): boolean {
    return channel.ink === 8 || channel.ink === 33 || channel.ink === 36;
  }

  private memberHitImage(member: CastMember): (Pick<LingoImage, "width" | "height" | "incomplete" | "getPixel"> & {
    getPixelAlpha?: (x: number, y: number) => number;
    isBoundaryConnectedColorPixel?: (x: number, y: number, color: LingoColor) => boolean;
    matteCoveragePolicyForDebug?: () => string;
  }) | null {
    return member.presentationImage ?? member.image ?? member.bitmap?.decoded ?? null;
  }

  private channelUsesBoundaryMatteInput(
    channel: SpriteChannel,
    image: Pick<LingoImage, "width" | "height" | "incomplete" | "getPixel"> & {
      matteCoveragePolicyForDebug?: () => string;
    },
  ): boolean {
    if (channel.member?.image === image) return true;
    const policy = image.matteCoveragePolicyForDebug?.();
    return policy === "edge-connected-white-transparent" || policy === "edge-connected-dominant-palette-index-transparent";
  }

  private transparentKeyColor(channel: SpriteChannel): LingoColor {
    return channel.bgColor instanceof LingoColor ? channel.bgColor : paletteColor("systemMac", channel.backColor);
  }

  private sameRgb(left: LingoColor, right: LingoColor): boolean {
    return left.r === right.r && left.g === right.g && left.b === right.b;
  }

  private spriteSourcePoint(
    sprite: SpriteChannel,
    stageX: number,
    stageY: number,
  ): { x: number; y: number; width: number; height: number } | null {
    const width = this.spriteWidth(sprite);
    const height = this.spriteHeight(sprite);
    const memberWidth = sprite.member ? this.memberWidth(sprite.member) : width;
    const memberHeight = sprite.member ? this.memberHeight(sprite.member) : height;
    const sourceWidth = memberWidth > 0 ? memberWidth : width;
    const sourceHeight = memberHeight > 0 ? memberHeight : height;
    if (sourceWidth <= 0 || sourceHeight <= 0 || width <= 0 || height <= 0) return null;
    const scaleX = width / sourceWidth;
    const scaleY = height / sourceHeight;
    const aliasMirrorH = this.isAliasMirrorTransform(sprite);
    const flipX = (sprite.flipH ? -1 : 1) * (aliasMirrorH ? -1 : 1);
    const flipY = sprite.flipV ? -1 : 1;
    const rotation = aliasMirrorH ? 0 : this.degreesToRadians(sprite.rotation);
    const skewX = aliasMirrorH ? 0 : this.degreesToRadians(sprite.skew);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = stageX - sprite.locH;
    const dy = stageY - sprite.locV;
    const skewedX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const localX = skewedX - Math.tan(skewX) * localY;
    const sourceX = localX / (scaleX * flipX) + this.spriteRegX(sprite);
    const sourceY = localY / (scaleY * flipY) + this.spriteRegY(sprite);
    if (sourceX < 0 || sourceY < 0 || sourceX >= sourceWidth || sourceY >= sourceHeight) return null;
    return { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight };
  }

  /** Director exposes `the rollover` as the current effective sprite channel
   * under the pointer, using the same target filtering as primary input. */
  private currentRolloverSprite(events: readonly string[] = POINTER_TARGET_EVENTS): SpriteChannel | null {
    return this.eventSpriteAt(this.mouseH, this.mouseV, events);
  }

  private updateRolloverSprite(events: readonly string[]): SpriteChannel | null {
    this.rolloverSprite = this.currentRolloverSprite(events);
    return this.rolloverSprite;
  }

  /** Sends a Director sprite event to the channel's attached behaviors
   * (Event Broker et al). True when a behavior consumed the event — a truthy
   * return without pass(); pass() falls through to default behavior. */
  private sendSpriteEvent(channel: SpriteChannel | null, event: string): boolean {
    if (!channel) return false;
    let consumed = false;
    this.runtime.eventPassed = false;
    for (const instance of [...channel.scriptInstanceList.items]) {
      if (!(instance instanceof ScriptInstance)) continue;
      if (!this.runtime.hasHandler(instance, event)) continue;
      this.guard(`${event}(sprite ${channel.number})`, () => {
        const result = this.runtime.callMethod(instance, event, []);
        if (ops.truthy(result)) consumed = true;
      });
    }
    if (this.runtime.eventPassed) consumed = false;
    this.runtime.eventPassed = false;
    return consumed;
  }

  pointerMove(x: number, y: number): void {
    this.mouseH = Math.round(x);
    this.mouseV = Math.round(y);
    const over = this.updateRolloverSprite(["mouseenter", "mouseleave", "mousewithin", "mousedown", "mouseup"]);
    if (over !== this.hoverSprite) {
      this.sendSpriteEvent(this.hoverSprite, "mouseleave");
      this.hoverSprite = over;
      this.sendSpriteEvent(over, "mouseenter");
    } else {
      this.sendSpriteEvent(over, "mousewithin");
    }
  }

  /** A sprite takes keystrokes when the sprite or its field member is
   * editable (Field Wrapper sets member.editable = 1). */
  channelEditable(channel: SpriteChannel | null): boolean {
    if (!channel || !channel.member) return false;
    if (channel.editable === 1) return true;
    return Number(channel.member.style.get("editable") ?? 0) === 1;
  }

  pointerDown(): void {
    this.mouseDownFlag = 1;
    const target = this.updateRolloverSprite(["mousedown", "mouseup", "mouseupoutside"]);
    const now = Date.now();
    this.doubleClickFlag =
      target &&
      target.number === this.lastClickSpriteNumber &&
      now - this.lastClickTimeMs <= 500 &&
      Math.abs(this.mouseH - this.lastClickH) <= 4 &&
      Math.abs(this.mouseV - this.lastClickV) <= 4
        ? 1
        : 0;
    this.lastClickTimeMs = now;
    this.lastClickSpriteNumber = target?.number ?? 0;
    this.lastClickH = this.mouseH;
    this.lastClickV = this.mouseV;
    this.mouseDownSprite = target;
    // Director gives editable field sprites keyboard focus on click and
    // blurs them when the click lands elsewhere.
    this.keyboardFocusSprite = this.channelEditable(target) ? target!.number : 0;
    this.sendSpriteEvent(target, "mousedown");
  }

  pointerUp(): void {
    this.mouseDownFlag = 0;
    const downSprite = this.mouseDownSprite;
    this.mouseDownSprite = null;
    const target = this.updateRolloverSprite(["mouseup", "mouseupoutside", "mousedown"]);
    if (!downSprite) return;
    if (target === downSprite) {
      this.sendSpriteEvent(downSprite, "mouseup");
    } else {
      this.sendSpriteEvent(downSprite, "mouseupoutside");
    }
  }

  keyDown(key: string, keyCode: number, shiftDown: boolean): void {
    this.lastKey = key;
    this.lastKeyCode = keyCode;
    this.shiftDown = shiftDown ? 1 : 0;
    const focus = Number(this.keyboardFocusSprite) | 0;
    const channel = focus > 0 ? (this.channels[focus] ?? null) : null;
    const editableMember = channel && this.channelEditable(channel) ? channel.member : null;
    if (editableMember && key !== "\t") {
      this.applyFieldKey(editableMember, key);
    }
    const consumed = this.sendSpriteEvent(channel, "keydown");
    if (editableMember && key === "\t" && !consumed && this.memberAutoTab(editableMember)) {
      this.focusAdjacentEditableSprite(focus, shiftDown);
    }
  }

  keyUp(key: string, keyCode: number, shiftDown: boolean): void {
    this.lastKey = key;
    this.lastKeyCode = keyCode;
    this.shiftDown = shiftDown ? 1 : 0;
    const focus = Number(this.keyboardFocusSprite) | 0;
    const channel = focus > 0 ? (this.channels[focus] ?? null) : null;
    this.sendSpriteEvent(channel, "keyup");
  }

  /** Director's default editable-field behavior for unconsumed keystrokes. */
  private applyFieldKey(member: CastMember, key: string): void {
    if (key === "\b") {
      if (member.text.length > 0) member.text = member.text.slice(0, -1);
    } else if (key === "\r" || key === "\n" || key === "\t") {
      return; // return/tab are source-handler territory, not text insertion
    } else if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) !== 127) {
      member.text += key;
    }
    member.textVersion += 1;
    this.onStageChange();
  }

  private memberAutoTab(member: CastMember): boolean {
    const value = member.style.get("autotab");
    return value === undefined ? true : ops.truthy(value);
  }

  private focusAdjacentEditableSprite(current: number, reverse: boolean): void {
    const editable = this.channels
      .filter((channel) => channel.puppet === 1 && channel.visible === 1 && this.channelEditable(channel))
      .sort((left, right) => left.number - right.number);
    if (editable.length === 0) {
      this.keyboardFocusSprite = 0;
      return;
    }
    const index = editable.findIndex((channel) => channel.number === current);
    const nextIndex =
      index === -1
        ? reverse
          ? editable.length - 1
          : 0
        : reverse
          ? (index - 1 + editable.length) % editable.length
          : (index + 1) % editable.length;
    this.keyboardFocusSprite = editable[nextIndex]!.number;
  }

  private readonly seenErrors = new Set<string>();
  private readonly seenScriptMisses = new Set<string>();
  errorCount = 0;

  /** Director semantics: a script error aborts the current event handler and
   * the movie continues (the original client even routes errors through
   * `the alertHook`). Unique errors are logged once. */
  private guard(what: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.errorCount += 1;
      const message =
        error instanceof UnsupportedFeatureError
          ? error.feature
          : error instanceof Error
            ? error.message
            : String(error);
      if (!this.seenErrors.has(message)) {
        this.seenErrors.add(message);
        this.log.log("error", `${what}: ${message}`);
      }
    }
  }

  // -- DirectorHost ----------------------------------------------------------

  put = (text: string): void => {
    this.log.log("put", text);
  };

  call = (name: string, args: LingoValue[]): LingoValue | undefined => {
    switch (name) {
      case "preloadnetthing": {
        // preloadNetThing returns a stream ID; CastLoad polls it via
        // getStreamStatus/netDone exactly like getNetText. For cast files it
        // is only the download step: release306 imports the cast later by
        // assigning castLib(n).fileName, which gives the cast its runtime slot.
        const url = this.resolveUrl(ops.stringOf(args[0] ?? LINGO_VOID));
        const id = this.nextNetId;
        this.nextNetId += 1;
        this.netJobs.set(id, { state: "loading", text: "", error: "" as string | number, url });
        const isCast = /\.(cct|cst)(\?|$)/i.test(url);
        if (isCast) {
          const base = url.split("/").pop()!.replace(/\.(cct|cst).*$/i, "");
          const exists = base.toLowerCase() === "empty" || this.members.definedMembersOf(base).length > 0;
          if (exists) {
            this.netJobs.set(id, { state: "done", text: "", error: "OK", url });
          } else {
            this.netJobs.set(id, { state: "failed", text: "", error: 4165, url });
          }
          return id;
        }
        const work = this.fetchText(url);
        work
          .then((raw) => {
            this.netJobs.set(id, { state: "done", text: raw, error: "OK", url });
          })
          .catch(() => {
            this.netJobs.set(id, { state: "failed", text: "", error: 4165, url });
          });
        return id;
      }
      case "netdone": {
        if (args.length > 0 && typeof args[0] === "number") {
          const job = this.netJobs.get(args[0]);
          return job === undefined || job.state !== "loading" ? 1 : 0;
        }
        const states = [...this.netJobs.values()].map((job) => job.state);
        return states.every((state) => state !== "loading") ? 1 : 0;
      }
      case "preloaddone":
      case "preload": {
        const job = this.netJobs.get(Number(args[0] ?? 0));
        return job === undefined || job.state !== "loading" ? 1 : 0;
      }
      case "getnettext": {
        // Director resolves relative URLs against the movie path.
        const url = this.resolveUrl(ops.stringOf(args[0] ?? LINGO_VOID));
        const id = this.nextNetId;
        this.nextNetId += 1;
        const job = { state: "loading" as const, text: "", error: "" as string | number, url };
        this.netJobs.set(id, job);
        this.log.log("info", `getNetText #${id} ${url}`);
        this.fetchText(url)
          .then((raw) => {
            // Director normalizes downloaded text line endings to RETURN
            // (CR); the Variable Container dump splits items on RETURN.
            const text = raw.replace(/\r\n|\n/g, "\r");
            this.netJobs.set(id, { state: "done", text, error: "OK", url });
            this.log.log("info", `netDone #${id} (${text.length} chars)`);
          })
          .catch((error) => {
            // 4165: "Requested object could not be found" - the code the
            // Download Instance handles gracefully for missing files.
            this.netJobs.set(id, { state: "failed", text: "", error: 4165, url });
            this.log.log("error", `netError #${id} ${String(error)}`);
          });
        return id;
      }
      case "neterror": {
        const job = this.netJobs.get(Number(args[0] ?? 0));
        if (!job || job.state === "loading") return "";
        return job.state === "done" ? "OK" : job.error;
      }
      case "nettextresult": {
        const job = this.netJobs.get(Number(args[0] ?? 0));
        return job?.text ?? "";
      }
      case "netabort": {
        this.netJobs.delete(Number(args[0] ?? 0));
        return 1;
      }
      case "getstreamstatus": {
        const job = this.netJobs.get(Number(args[0] ?? 0));
        if (!job) return 0;
        // Cast streams are metadata-backed and do not retain opaque .cct
        // bytes in `text`. Director still reports completed streams as having
        // made progress; release306 checks retry timeout before netDone, so a
        // done/0-byte stream is treated as a stalled load and retried.
        const bytes = job.text.length > 0 ? job.text.length : job.state === "done" ? 1 : 0;
        return LingoPropList.fromPairs([
          [LingoSymbol.for("URL"), job.url],
          [LingoSymbol.for("state"), job.state === "done" ? "Complete" : job.state === "failed" ? "Error" : "InProgress"],
          [LingoSymbol.for("bytesSoFar"), job.state === "done" ? bytes : 0],
          [LingoSymbol.for("bytesTotal"), bytes],
          [LingoSymbol.for("error"), job.state === "failed" ? job.error : ""],
        ]);
      }
      case "puppettempo":
        this.tempo = Number(args[0] ?? this.tempo) || this.tempo;
        return 1;
      case "movetofront":
        return 1;
      case "go": {
        const target = args[0] ?? LINGO_VOID;
        if (typeof target === "number") {
          this.nextFrameOverride = target;
        } else if (typeof target === "string") {
          const marker = this.manifest.score.markers.find(
            (entry) => entry.name.toLowerCase() === target.toLowerCase(),
          );
          if (marker) {
            this.nextFrameOverride = marker.frame;
          }
        }
        return 1;
      }
      case "castlib": {
        const id = args[0] ?? LINGO_VOID;
        const ref =
          typeof id === "number"
            ? this.castLibs.find((cast) => cast.number === id)
            : this.castLibs.find((cast) => cast.name.toLowerCase() === ops.stringOf(id).toLowerCase());
        if (ref) return ref;
        if (typeof id === "string" && id.trim().length > 0) {
          return this.ensureCastLib(id);
        }
        return undefined;
      }
      case "field": {
        const castArg = args[1];
        const cast =
          castArg instanceof CastLibRef
            ? castArg
            : typeof castArg === "number"
              ? this.castLibs.find((entry) => entry.number === castArg)
              : typeof castArg === "string"
                ? this.castLibs.find((entry) => entry.name.toLowerCase() === castArg.toLowerCase())
                : undefined;
        const member = this.members.find(args[0] ?? LINGO_VOID, cast?.name ?? null);
        return member ? member.text : LINGO_VOID;
      }
      case "member": {
        const castArg = args[1];
        const cast =
          castArg instanceof CastLibRef
            ? castArg
            : typeof castArg === "number"
              ? this.castLibs.find((entry) => entry.number === castArg)
              : typeof castArg === "string"
                ? this.castLibs.find((entry) => entry.name.toLowerCase() === castArg.toLowerCase())
                : undefined;
        const id = args[0] ?? LINGO_VOID;
        const member = this.members.find(id, cast?.name ?? null);
        if (member) return member;
        // Director always yields a ref: missing names report number -1
        // (preIndexMembers tests `member(x, lib).number > 0`), empty slots
        // report an empty name.
        return new CastMember(
          cast?.name ?? "",
          cast?.number ?? 0,
          typeof id === "number" ? id : -1,
          "",
          "empty",
        );
      }
      case "sprite": {
        if (args[0] instanceof SpriteChannel) return args[0];
        const number = Number(args[0] ?? 0) | 0;
        return this.channels[number] ?? LINGO_VOID;
      }
      case "sound":
        return this.soundChannel(args[0] ?? 1);
      case "puppetsprite": {
        const number = args[0] instanceof SpriteChannel ? args[0].number : Number(args[0] ?? 0) | 0;
        const channel = this.channels[number];
        if (channel) {
          if (Number(args[1] ?? 0)) {
            channel.puppet = 1;
          } else {
            channel.resetImmediateProperties();
          }
          this.onStageChange();
        }
        return 1;
      }
      case "setid":
        if (args[0] instanceof SpriteChannel) {
          args[0].id = args[1] ?? 0;
          return 1;
        }
        return undefined;
      case "getid":
        if (args[0] instanceof SpriteChannel) {
          return args[0].id;
        }
        return undefined;
      case "updatestage":
        this.onStageChange();
        return 1;
      case "cursor":
        // Global cursor command; pointer styling comes with the input layer.
        return 1;
      case "externalparamvalue": {
        const key = ops.stringOf(args[0] ?? LINGO_VOID).toLowerCase();
        const value = this.externalParams.get(key);
        return value === undefined ? LINGO_VOID : value;
      }
      case "externalparamcount":
        return this.externalParams.size;
      case "timeout": {
        const name = ops.stringOf(args[0] ?? LINGO_VOID).toLowerCase();
        let ref = this.timeouts.get(name);
        if (!ref) {
          ref = new TimeoutRef(name, this);
          this.timeouts.set(name, ref);
        }
        return ref;
      }
      case "xtra":
        return this.network.createXtra(ops.stringOf(args[0] ?? LINGO_VOID));
      case "new": {
        // timeout("x").new(period, #handler, target) routes here.
        if (args[0] instanceof TimeoutRef) {
          const ref = args[0];
          ref.schedule(Number(args[1] ?? 0) || 0, args[2] ?? LINGO_VOID, args[3] ?? LINGO_VOID);
          this.timeouts.set(ref.name, ref);
          return ref;
        }
        return this.network.createXtraInstance(args[0] ?? LINGO_VOID);
      }
      case "forget": {
        if (args[0] instanceof TimeoutRef) {
          args[0].forget();
          return 1;
        }
        return undefined;
      }
      case "erase": {
        if (args[0] instanceof CastMember) {
          this.members.remove(args[0]);
          return 1;
        }
        return undefined;
      }
      case "newmember": {
        // new(#field, castLib n) from Resource Manager createMember.
        const typeName = args[0] instanceof LingoSymbol ? args[0].name.toLowerCase() : "field";
        const castRef = args[1];
        const cast = castRef instanceof CastLibRef ? castRef : this.ensureCastLib("bin");
        return this.members.create(cast.name, "", typeName, cast.number);
      }
      case "script": {
        // script(nameOrNumber): the member must exist in a LOADED cast
        // (Director load-order semantics; Figure System must not construct
        // before hh_human arrives), then its generated module runs.
        const member = this.members.find(args[0] ?? LINGO_VOID, null);
        if (member && member.type === "script") {
          const scriptRef =
            this.runtime.findScriptByMember(member.castName, member.number) ??
            this.runtime.findScript(member.name);
          if (scriptRef) return scriptRef;
          const requested = ops.stringOf(args[0] ?? LINGO_VOID);
          if (!this.seenScriptMisses.has(requested)) {
            this.seenScriptMisses.add(requested);
            this.log.log(
              "info",
              `script() miss: ${requested} (${member.name} in ${member.castName} has no executable module)`,
            );
          }
          return new MissingScriptRef(requested, member.name, member.slotNumber, member.castName);
        }
        // Source error paths print only the resolved 0; the requested name
        // is the actionable diagnostic.
        const requested = ops.stringOf(args[0] ?? LINGO_VOID);
        if (!this.seenScriptMisses.has(requested)) {
          this.seenScriptMisses.add(requested);
          this.log.log(
            "info",
            `script() miss: ${requested}${member ? ` (member type ${member.type} in ${member.castName})` : " (no member)"}`,
          );
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };

  theProp = (name: string): LingoValue | undefined => {
    switch (name) {
      case "frame":
        return this.currentFrame;
      case "frametempo":
        return this.tempo;
      case "stage":
        return this.stage;
      case "runmode":
        return "Plugin";
      case "platform":
        return "Windows,32";
      case "centerstage":
        return this.centerStage;
      case "exitlock":
        return this.exitLock;
      case "lastchannel":
        return LAST_CHANNEL;
      case "stageleft":
        return 0;
      case "stagetop":
        return 0;
      case "stageright":
        return this.stageViewport.width;
      case "stagebottom":
        return this.stageViewport.height;
      case "colordepth":
        return 32;
      case "mouseh":
        return this.mouseH;
      case "mousev":
        return this.mouseV;
      case "mouseloc":
        return new LingoPoint(this.mouseH, this.mouseV);
      case "mousedown":
        return this.mouseDownFlag;
      case "doubleclick":
        return this.doubleClickFlag;
      case "rollover":
        this.rolloverSprite = this.currentRolloverSprite();
        return this.rolloverSprite?.number ?? 0;
      case "keyboardfocussprite":
        return this.keyboardFocusSprite;
      case "selstart":
        return this.selStart;
      case "selend":
        return this.selEnd;
      case "key":
        return this.lastKey;
      case "keycode":
        return this.lastKeyCode;
      case "shiftdown":
        return this.shiftDown;
      case "controldown":
      case "commanddown":
      case "optiondown":
        return 0;
      case "moviepath":
        return this.moviePath;
      case "moviename":
        return "habbo.dir";
      case "number_of_castlibs":
        return this.castLibs.length;
      case "alerthook":
        return this.alertHook;
      case "time":
      case "short time":
        return formatTime(new Date(), false);
      case "long time":
        return formatTime(new Date(), true);
      case "systemdate": {
        const now = new Date();
        return new LingoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
      }
      case "date":
      case "short date": {
        const now = new Date();
        return `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}`;
      }
      case "long date":
        return new Date().toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        });
      case "abbreviated date":
      case "abbrev date":
      case "abbr date":
        return new Date().toLocaleDateString("en-US", {
          weekday: "short",
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      default:
        return undefined;
    }
  };

  setTheProp = (name: string, value: LingoValue): boolean => {
    switch (name) {
      case "centerstage":
        this.centerStage = Number(value) || 0;
        return true;
      case "exitlock":
        this.exitLock = Number(value) || 0;
        return true;
      case "alerthook":
        this.alertHook = value;
        return true;
      case "keyboardfocussprite":
        this.keyboardFocusSprite = value;
        return true;
      case "selstart":
        this.selStart = Math.max(0, Number(value) || 0);
        return true;
      case "selend":
        this.selEnd = Math.max(0, Number(value) || 0);
        return true;
      default:
        return false;
    }
  };

  getProp = (receiver: LingoValue, property: string): LingoValue | undefined => {
    if (receiver instanceof StageRef) {
      switch (property) {
        case "sourcerect":
          return new LingoRect(0, 0, this.manifest.stage.width, this.manifest.stage.height);
        case "rect":
          return new LingoRect(0, 0, this.stageViewport.width, this.stageViewport.height);
        case "image":
          return this.stageImageProvider() ?? new LingoImage(this.stageViewport.width, this.stageViewport.height, 32);
        case "title":
          return "Habbo Origins";
        case "bgcolor":
          return this.stageBgColor;
        case "drawrect":
          return new LingoRect(0, 0, this.stageViewport.width, this.stageViewport.height);
        default:
          return undefined;
      }
    }
    if (receiver instanceof TimeoutRef) {
      switch (property) {
        case "name":
          return receiver.name;
        case "period":
          return receiver.periodMs;
        case "timeouthandler":
          return receiver.handler;
        case "target":
          return receiver.target;
        default:
          return undefined;
      }
    }
    if (receiver instanceof SoundChannelRef) {
      switch (property) {
        case "volume":
          return receiver.volume;
        case "member":
          return receiver.member;
        case "number":
        case "channel":
          return receiver.number;
        default:
          return undefined;
      }
    }
    if (receiver instanceof ChunkRef && receiver.owner instanceof CastMember) {
      if (TEXT_CHUNK_STYLE_PROPERTIES.has(property)) {
        return this.textStyleAt(receiver.owner, receiver.start ?? 1, property) ?? this.getProp(receiver.owner, property);
      }
      return undefined;
    }
    if (receiver instanceof CastLibRef) {
      switch (property) {
        case "filename":
          return receiver.fileName;
        case "preloadmode":
          return receiver.preloadMode;
        case "name":
          return receiver.name;
        case "number":
          return receiver.number;
        default:
          return undefined;
      }
    }
    if (receiver instanceof LingoImage) {
      switch (property) {
        case "width":
          return receiver.width;
        case "height":
          return receiver.height;
        case "depth":
          return receiver.depth;
        case "rect":
          return receiver.getRect();
        case "paletteref":
          return receiver.paletteRef;
        case "usealpha":
          return receiver.useAlpha;
        default:
          return undefined;
      }
    }
    if (receiver instanceof CastMember) {
      switch (property) {
        case "name":
          return receiver.name;
        case "number":
          // Movie-global slot number unless this is a missing-member ref.
          return receiver.number < 0 ? -1 : receiver.slotNumber;
        case "membernum":
          return receiver.number;
        case "type":
          return LingoSymbol.for(receiver.type);
        case "text":
          return receiver.text;
        case "scripttext":
          return receiver.type === "script" ? receiver.text : "";
        case "castlibnum":
          return receiver.castNumber;
        case "char":
        case "word":
        case "item":
        case "line":
          return new ChunkRef(receiver.text, property, receiver);
        case "width":
          return this.memberWidth(receiver);
        case "height":
          return this.memberHeight(receiver);
        case "image":
          if (receiver.type === "field" || receiver.type === "text") {
            return this.ensureTextMemberImage(receiver);
          }
          return receiver.effectiveImage();
        case "media":
          if (receiver.type === "field" || receiver.type === "text") {
            return this.ensureTextMemberImage(receiver).toDirectorBitmapMedia(mediaSourceForMember(receiver));
          }
          return receiver.effectiveImage().toDirectorBitmapMedia(mediaSourceForMember(receiver));
        case "rect":
          return this.memberRect(receiver);
        case "regpoint":
          return new LingoPoint(receiver.regX, receiver.regY);
        case "paletteref":
          return receiver.paletteRef;
        case "palette":
          return receiver.palette;
        case "lineheight":
          return this.memberLineHeight(receiver);
        default: {
          const styled = receiver.style.get(property);
          if (styled !== undefined) return styled;
          // Director default member styling values (read before first set).
          switch (property) {
            case "fontstyle":
              return new LingoList([LingoSymbol.for("plain")]);
            case "font":
              return "Arial";
            case "fontsize":
              return 12;
            case "color":
              return new LingoColor(0, 0, 0);
            case "bgcolor":
              return new LingoColor(255, 255, 255);
            case "alignment":
              return LingoSymbol.for("left");
            case "wordwrap":
              return 1;
            case "boxtype":
              return LingoSymbol.for("adjust");
            case "editable":
              return 0;
            case "margin":
            case "border":
              return 0;
            case "autotab":
            case "boxdropshadow":
            case "dropshadow":
            case "antialias":
              return 0;
            case "linecount":
              return this.layoutTextMember(receiver).length;
            case "duration":
              return receiver.type === "sound" ? 0 : undefined;
            case "charspacing":
            case "topspacing":
            case "bottomspacing":
            case "leftindent":
            case "rightindent":
            case "firstindent":
              return 0;
            case "fixedlinespace":
              return 0;
            case "lineheight":
              return this.memberLineHeight(receiver);
            default:
              return undefined;
          }
        }
      }
    }
    if (receiver instanceof SpriteChannel) {
      switch (property) {
        case "member":
          return receiver.member ?? 0;
        case "castnum":
          return receiver.member ? receiver.member.slotNumber : 0;
        case "castlibnum":
          return receiver.member?.castNumber ?? receiver.castLibNum;
        case "loc":
          return new LingoPoint(receiver.locH, receiver.locV);
        case "rect": {
          return this.spriteRect(receiver);
        }
        case "left":
          return this.spriteRect(receiver).left;
        case "top":
          return this.spriteRect(receiver).top;
        case "right":
          return this.spriteRect(receiver).right;
        case "bottom":
          return this.spriteRect(receiver).bottom;
        case "loch":
          return receiver.locH;
        case "locv":
          return receiver.locV;
        case "locz":
          return receiver.locZ;
        case "ink":
          return receiver.ink;
        case "blend":
          return receiver.blend;
        case "visible":
          return receiver.visible;
        case "puppet":
          return receiver.puppet;
        case "width":
          return receiver.width || (receiver.member?.bitmap?.width ?? 0);
        case "height":
          return receiver.height || (receiver.member?.bitmap?.height ?? 0);
        case "spritenum":
          return receiver.number;
        case "sprite":
          return receiver;
        case "scriptinstancelist":
          return receiver.scriptInstanceList;
        case "stretch":
          return receiver.stretch;
        case "trails":
          return receiver.trails;
        case "fliph":
          return receiver.flipH;
        case "flipv":
          return receiver.flipV;
        case "rotation":
          return receiver.rotation;
        case "skew":
          return receiver.skew;
        case "ilk":
          return LingoSymbol.for("sprite");
        case "forecolor":
          return receiver.foreColor;
        case "backcolor":
          return receiver.backColor;
        case "color":
          return receiver.color;
        case "bgcolor":
          return receiver.bgColor;
        case "editable":
          return receiver.editable;
        default:
          return undefined;
      }
    }
    return undefined;
  };

  setProp = (receiver: LingoValue, property: string, value: LingoValue): boolean => {
    if (receiver instanceof TimeoutRef) {
      switch (property) {
        case "target":
          receiver.target = value;
          return true;
        case "timeouthandler":
          receiver.handler = value;
          return true;
        case "period":
          receiver.periodMs = Number(value) || 0;
          return true;
        default:
          return false;
      }
    }
    if (receiver instanceof SoundChannelRef) {
      switch (property) {
        case "volume":
          receiver.volume = this.integerValue(value, receiver.volume);
          return true;
        case "member":
          receiver.member = value;
          return true;
        default:
          return false;
      }
    }
    if (receiver instanceof ChunkRef && receiver.owner instanceof CastMember) {
      if (!TEXT_CHUNK_STYLE_PROPERTIES.has(property)) return false;
      const start = receiver.start ?? 1;
      const end = receiver.end ?? receiver.owner.text.length;
      receiver.owner.setTextStyleRange(start, end, property, value);
      this.onStageChange();
      return true;
    }
    if (receiver instanceof StageRef) {
      if (property === "title") {
        if (typeof document !== "undefined") {
          document.title = ops.stringOf(value);
        }
        return true;
      }
      if (property === "bgcolor") {
        this.stageBgColor = value;
        this.onStageChange();
        return true;
      }
      if (property === "drawrect" || property === "rect" || property === "title") {
        return true; // accepted; fixed-size browser stage
      }
      return false;
    }
    if (receiver instanceof CastLibRef) {
      switch (property) {
        case "preloadmode":
          receiver.preloadMode = Number(value) || 0;
          return true;
        case "name":
          receiver.name = ops.stringOf(value);
          return true;
        case "filename": {
          receiver.fileName = ops.stringOf(value);
          // Director loads the cast when fileName is assigned; the castLib
          // takes the loaded cast's name.
          const base = receiver.fileName.split("/").pop()!.replace(/\.(cct|cst)$/i, "");
          if (base.toLowerCase() !== "empty") {
            this.log.log("info", `castLib ${receiver.number} fileName = ${receiver.fileName}`);
          }
          if (base && base.toLowerCase() !== "empty" && this.members.loadCast(base, receiver.number)) {
            receiver.name = base;
            this.log.log("info", `castLib ${receiver.number} loaded cast ${base}`);
            this.onCastLoaded(base, receiver.number);
            void this.decodeCastImages(base);
            this.onStageChange();
          }
          return true;
        }
        default:
          return false;
      }
    }
    if (receiver instanceof CastMember) {
      switch (property) {
        case "text":
          receiver.text = ops.stringOf(value);
          receiver.clearTextStyleRuns();
          receiver.textVersion += 1;
          this.onStageChange();
          return true;
        case "name":
          this.members.rename(receiver, ops.stringOf(value));
          return true;
        case "image":
          // Director copies pixels on member.image assignment; holding the
          // reference would alias the source (Common Button assigns its
          // state image to the buffer, then composites that image into the
          // buffer — aliased, that is a self-copy through a white fill).
          receiver.imageSource = value instanceof LingoImage ? value : null;
          receiver.image = value instanceof LingoImage ? value.duplicate() : null;
          if (receiver.image) {
            receiver.paletteRef = receiver.image.paletteRef;
            receiver.palette = receiver.image.paletteRef;
          }
          this.onStageChange();
          return true;
        case "media":
          if (isPhotoInvalidMedia(value) && receiver.imageSource) {
            this.log.log("info", `photo media fallback ignored for ${receiver.name || "runtime bitmap"}; keeping retrieved bitmap`);
            return true;
          }
          if (value instanceof LingoImage) {
            receiver.imageSource = value;
          } else if (value instanceof LingoBitmapMedia) {
            receiver.imageSource = LingoImage.fromDirectorBitmapMedia(value);
            if (!receiver.imageSource && !isPhotoInvalidMedia(value)) {
              this.log.log(
                "info",
                `bitmap media decode failed for ${receiver.name || "runtime bitmap"}; ${formatDirectorBitmapMediaInspection(
                  inspectDirectorBitmapMedia(value.bytes),
                )}`,
              );
            }
          } else {
            receiver.imageSource = null;
          }
          receiver.image = receiver.imageSource ? receiver.imageSource.duplicate() : null;
          if (receiver.image) {
            receiver.paletteRef = receiver.image.paletteRef;
            receiver.palette = receiver.image.paletteRef;
          }
          this.onStageChange();
          return true;
        case "regpoint":
          if (value instanceof LingoPoint) {
            receiver.regPointOverride = { x: value.x, y: value.y };
          }
          return true;
        case "paletteref":
          receiver.paletteRef = value;
          if (receiver.image) {
            receiver.image.paletteRef = value;
          }
          if (receiver.imageSource) {
            receiver.imageSource.paletteRef = value;
          }
          return true;
        case "palette":
          receiver.palette = value;
          if (value instanceof CastMember || value instanceof LingoSymbol) {
            receiver.paletteRef = value;
            if (receiver.image) {
              receiver.image.paletteRef = value;
            }
            if (receiver.imageSource) {
              receiver.imageSource.paletteRef = value;
            }
          }
          return true;
        case "color":
        case "bgcolor":
        case "forecolor":
        case "backcolor":
        case "font":
        case "fontsize":
        case "fontstyle":
        case "alignment":
        case "wordwrap":
        case "boxtype":
        case "editable":
        case "border":
        case "margin":
        case "linecount":
        case "fixedlinespace":
        case "charspacing":
        case "topspacing":
        case "bottomspacing":
        case "leftindent":
        case "rightindent":
        case "firstindent":
        case "antialias":
        case "rect":
        case "width":
        case "height":
        case "autotab":
        case "boxdropshadow":
        case "dropshadow":
          // Director text/field member styling; stored for the renderer.
          receiver.style.set(property, value);
          receiver.textVersion += 1;
          this.onStageChange();
          return true;
        case "lineheight": {
          const lineHeight = this.numericValue(value, 0);
          receiver.style.set("fixedlinespace", value);
          if (lineHeight > 0) {
            receiver.style.set("topspacing", Math.max(0, Math.round(lineHeight - this.memberFontSize(receiver))));
          }
          receiver.textVersion += 1;
          this.onStageChange();
          return true;
        }
        default:
          return false;
      }
    }
    if (receiver instanceof SpriteChannel) {
      switch (property) {
        case "member":
          this.assignSpriteMember(receiver, value);
          this.onStageChange();
          return true;
        case "castnum": {
          const castName =
            typeof value === "number" && (value >> 16) === 0 && receiver.castLibNum > 0
              ? this.castLibNameForNumber(receiver.castLibNum)
              : null;
          this.assignSpriteMember(receiver, value, castName);
          this.onStageChange();
          return true;
        }
        case "castlibnum": {
          const castNumber = Number(value) | 0;
          receiver.castLibNum = castNumber;
          const castName = this.castLibNameForNumber(castNumber);
          if (receiver.member && castName) {
            this.assignSpriteMember(receiver, receiver.member.number, castName);
          }
          this.onStageChange();
          return true;
        }
        case "loc":
          if (value instanceof LingoPoint) {
            receiver.locH = Math.round(value.x);
            receiver.locV = Math.round(value.y);
            this.onStageChange();
          }
          return true;
        case "loch":
          receiver.locH = this.integerValue(value);
          this.onStageChange();
          return true;
        case "locv":
          receiver.locV = this.integerValue(value);
          this.onStageChange();
          return true;
        case "locz":
          receiver.locZ = this.integerValue(value);
          this.onStageChange();
          return true;
        case "left": {
          receiver.locH = this.integerValue(value) + this.spriteRegX(receiver);
          this.onStageChange();
          return true;
        }
        case "top": {
          receiver.locV = this.integerValue(value) + this.spriteRegY(receiver);
          this.onStageChange();
          return true;
        }
        case "right": {
          const rect = this.spriteRect(receiver);
          receiver.locH = this.integerValue(value) - rect.width + this.spriteRegX(receiver);
          this.onStageChange();
          return true;
        }
        case "bottom": {
          const rect = this.spriteRect(receiver);
          receiver.locV = this.integerValue(value) - rect.height + this.spriteRegY(receiver);
          this.onStageChange();
          return true;
        }
        case "ink":
          receiver.ink = this.integerValue(value);
          this.onStageChange();
          return true;
        case "blend":
          receiver.blend = this.integerValue(value);
          this.onStageChange();
          return true;
        case "visible":
          receiver.visible = this.numericValue(value) ? 1 : 0;
          this.onStageChange();
          return true;
        case "puppet":
          if (this.numericValue(value)) {
            receiver.puppet = 1;
          } else {
            receiver.resetImmediateProperties();
          }
          this.onStageChange();
          return true;
        case "width":
          receiver.width = this.integerValue(value);
          this.onStageChange();
          return true;
        case "height":
          receiver.height = this.integerValue(value);
          this.onStageChange();
          return true;
        case "scriptinstancelist":
          if (value instanceof LingoList) {
            receiver.scriptInstanceList = value;
            // Director gives each attached behavior its sprite channel; the
            // Event Broker reads `the spriteNum of me`.
            for (const instance of value.items) {
              if (instance instanceof ScriptInstance) {
                instance.props.set("spritenum", receiver.number);
              }
            }
          }
          return true;
        case "cursor":
          receiver.cursor = value;
          return true;
        case "rect":
          if (value instanceof LingoRect) {
            this.setSpriteRect(receiver, value);
          }
          return true;
        case "stretch":
          receiver.stretch = this.numericValue(value) ? 1 : 0;
          return true;
        case "trails":
          receiver.trails = this.numericValue(value) ? 1 : 0;
          return true;
        case "fliph":
          receiver.flipH = this.numericValue(value) ? 1 : 0;
          this.onStageChange();
          return true;
        case "flipv":
          receiver.flipV = this.numericValue(value) ? 1 : 0;
          this.onStageChange();
          return true;
        case "rotation":
          receiver.rotation = this.numericValue(value);
          this.onStageChange();
          return true;
        case "skew":
          receiver.skew = this.numericValue(value);
          this.onStageChange();
          return true;
        case "forecolor":
          receiver.foreColor = this.integerValue(value);
          return true;
        case "backcolor":
          receiver.backColor = this.integerValue(value);
          return true;
        case "color":
          receiver.color = value;
          this.onStageChange();
          return true;
        case "bgcolor":
          receiver.bgColor = value;
          this.onStageChange();
          return true;
        case "editable":
          receiver.editable = this.numericValue(value) ? 1 : 0;
          return true;
        default:
          return false;
      }
    }
    return false;
  };

  /** Director sprite-behavior dispatch: a method called on a sprite is sent
   * to the behavior instances in its scriptInstanceList (the sprite's
   * attached scripts), matching how the source calls
   * `tsprite.registerProcedure(...)` etc. */
  callMethod = (receiver: LingoValue, method: string, args: LingoValue[]): LingoValue | undefined => {
    const networkResult = this.network.callMethod(receiver, method, args);
    if (networkResult !== undefined) {
      return networkResult;
    }
    if (receiver instanceof TimeoutRef) {
      switch (method.toLowerCase()) {
        case "new":
          receiver.schedule(Number(args[0] ?? 0) || 0, args[1] ?? LINGO_VOID, args[2] ?? LINGO_VOID);
          this.timeouts.set(receiver.name, receiver);
          return receiver;
        case "forget":
          receiver.forget();
          return 1;
        default:
          return undefined;
      }
    }
    if (receiver instanceof SoundChannelRef) {
      switch (method) {
        case "setplaylist":
          receiver.setPlayList(args[0] ?? LINGO_VOID);
          return 1;
        case "getplaylist":
          return receiver.getPlayList();
        case "play":
          return receiver.play(args[0] ?? LINGO_VOID);
        case "queue":
          return receiver.queue(args[0] ?? LINGO_VOID);
        case "stop":
          return receiver.stop();
        case "isbusy":
          return receiver.isBusy();
        default:
          return undefined;
      }
    }
    if (receiver instanceof CastMember) {
      switch (method) {
        case "duplicate": {
          const target =
            args[0] instanceof CastMember ? args[0] : this.members.find(args[0] ?? LINGO_VOID, null);
          if (!target) return LINGO_VOID;
          target.type = receiver.type;
          target.text = receiver.text;
          target.textVersion += 1;
          target.bitmap = receiver.bitmap
            ? {
                ...receiver.bitmap,
                decoded: receiver.bitmap.decoded ? receiver.bitmap.decoded.duplicate() : receiver.bitmap.decoded,
              }
            : null;
          target.image = receiver.image ? receiver.image.duplicate() : null;
          target.imageSource = receiver.imageSource ? receiver.imageSource.duplicate() : null;
          target.paletteRef = receiver.paletteRef;
          target.palette = receiver.palette;
          target.paletteColors = receiver.paletteColors ? [...receiver.paletteColors] : null;
          target.regPointOverride = receiver.regPointOverride ? { ...receiver.regPointOverride } : null;
          target.style.clear();
          for (const [key, value] of receiver.style) {
            target.style.set(key, duplicateValue(value));
          }
          target.clearTextStyleRuns();
          for (const run of receiver.textStyleRuns) {
            target.setTextStyleRange(run.start, run.end, run.property, duplicateValue(run.value));
          }
          this.onStageChange();
          return target;
        }
        case "charpostoloc":
          return this.memberCharPosToLoc(receiver, Number(args[0] ?? 1) | 0);
        case "loctocharpos": {
          const loc = args[0];
          if (loc instanceof LingoPoint) return this.memberLocToCharPos(receiver, loc);
          return 1;
        }
        default:
          return undefined;
      }
    }
    if (receiver instanceof SpriteChannel) {
      for (const instance of receiver.scriptInstanceList.items) {
        if (instance instanceof ScriptInstance && this.runtime.hasHandler(instance, method)) {
          return this.runtime.callMethod(instance, method, args);
        }
      }
    }
    return undefined;
  };

  private memberRect(member: CastMember): LingoRect {
    const styled = member.style.get("rect");
    if (member.type === "field" || member.type === "text") {
      // Director #adjust boxes re-derive their rect from content: an assigned
      // rect supplies the layout width, but the member's rect/height/image
      // stay mutually consistent with the wrapped text. Text Wrapper copies
      // sourceRect=member.rect out of member.image, so returning a stale
      // assigned rect (e.g. Writer's 1px measurement rect) would scale the
      // raster into the destination — the squashed/clipped text defect.
      if (this.memberBoxType(member) === "adjust") {
        const left = styled instanceof LingoRect ? styled.left : 0;
        const top = styled instanceof LingoRect ? styled.top : 0;
        return new LingoRect(left, top, left + this.memberWidth(member), top + this.memberHeight(member));
      }
      if (styled instanceof LingoRect) return styled;
    }
    if (styled instanceof LingoRect) return styled;
    return new LingoRect(0, 0, this.memberWidth(member), this.memberHeight(member));
  }

  private spriteRegX(sprite: SpriteChannel): number {
    return sprite.member?.regX ?? 0;
  }

  private spriteRegY(sprite: SpriteChannel): number {
    return sprite.member?.regY ?? 0;
  }

  private spriteWidth(sprite: SpriteChannel): number {
    return sprite.width || (sprite.member ? this.memberWidth(sprite.member) : 0);
  }

  private spriteHeight(sprite: SpriteChannel): number {
    return sprite.height || (sprite.member ? this.memberHeight(sprite.member) : 0);
  }

  private spriteRect(sprite: SpriteChannel): LingoRect {
    const width = this.spriteWidth(sprite);
    const height = this.spriteHeight(sprite);
    const memberWidth = sprite.member ? this.memberWidth(sprite.member) : width;
    const memberHeight = sprite.member ? this.memberHeight(sprite.member) : height;
    const sourceWidth = memberWidth > 0 ? memberWidth : width;
    const sourceHeight = memberHeight > 0 ? memberHeight : height;
    const scaleX = sourceWidth > 0 ? width / sourceWidth : 1;
    const scaleY = sourceHeight > 0 ? height / sourceHeight : 1;
    const aliasMirrorH = this.isAliasMirrorTransform(sprite);
    const flipX = (sprite.flipH ? -1 : 1) * (aliasMirrorH ? -1 : 1);
    const flipY = sprite.flipV ? -1 : 1;
    const rotation = aliasMirrorH ? 0 : this.degreesToRadians(sprite.rotation);
    const skewX = aliasMirrorH ? 0 : this.degreesToRadians(sprite.skew);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const skewTan = Math.tan(skewX);
    const regX = this.spriteRegX(sprite);
    const regY = this.spriteRegY(sprite);
    const corners: Array<[number, number]> = [
      [0, 0],
      [sourceWidth, 0],
      [0, sourceHeight],
      [sourceWidth, sourceHeight],
    ];
    const points = corners.map(([x, y]) => {
      const localX = (x - regX) * scaleX * flipX;
      const localY = (y - regY) * scaleY * flipY;
      const skewedX = localX + skewTan * localY;
      return {
        x: sprite.locH + skewedX * cos - localY * sin,
        y: sprite.locV + skewedX * sin + localY * cos,
      };
    });
    const left = Math.min(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const right = Math.max(...points.map((point) => point.x));
    const bottom = Math.max(...points.map((point) => point.y));
    return new LingoRect(Math.round(left), Math.round(top), Math.round(right), Math.round(bottom));
  }

  private setSpriteRect(sprite: SpriteChannel, rect: LingoRect): void {
    const width = Math.max(0, Math.round(rect.width));
    const height = Math.max(0, Math.round(rect.height));
    sprite.width = width;
    sprite.height = height;

    const memberWidth = sprite.member ? this.memberWidth(sprite.member) : width;
    const memberHeight = sprite.member ? this.memberHeight(sprite.member) : height;
    const scaleX = memberWidth > 0 ? width / memberWidth : 1;
    const scaleY = memberHeight > 0 ? height / memberHeight : 1;
    sprite.locH = Math.round(rect.left + this.spriteRegX(sprite) * scaleX);
    sprite.locV = Math.round(rect.top + this.spriteRegY(sprite) * scaleY);
    this.onStageChange();
  }

  private isAliasMirrorTransform(sprite: SpriteChannel): boolean {
    return this.normalizeDegrees(sprite.rotation) === 180 && this.normalizeDegrees(sprite.skew) === 180;
  }

  private normalizeDegrees(value: number): number {
    return ((Math.round(value) % 360) + 360) % 360;
  }

  private degreesToRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private memberWidth(member: CastMember): number {
    const styledWidth = this.memberNumberStyle(member, "width", NaN);
    if (!Number.isNaN(styledWidth)) return styledWidth;
    const styledRect = member.style.get("rect");
    if (styledRect instanceof LingoRect) return styledRect.width;
    if (member.type === "field" || member.type === "text") {
      return this.measureTextMemberWidth(member);
    }
    return member.image?.width ?? member.bitmap?.width ?? 0;
  }

  private memberHeight(member: CastMember): number {
    const styledHeight = this.memberNumberStyle(member, "height", NaN);
    if (!Number.isNaN(styledHeight)) return styledHeight;
    const styledRect = member.style.get("rect");
    if (member.type === "field" || member.type === "text") {
      const boxType = this.memberBoxType(member);
      if (styledRect instanceof LingoRect && boxType !== "adjust") return styledRect.height;
      return Math.max(1, this.layoutTextMember(member).length * this.memberLineHeight(member));
    }
    if (styledRect instanceof LingoRect) return styledRect.height;
    return member.image?.height ?? member.bitmap?.height ?? 0;
  }

  private memberNumberStyle(member: CastMember, key: string, fallback: number): number {
    const value = member.style.get(key);
    return isNumber(value ?? LINGO_VOID) ? numberOf(value!) : fallback;
  }

  private memberBooleanStyle(member: CastMember, key: string, fallback: boolean): boolean {
    const value = member.style.get(key);
    return value === undefined ? fallback : ops.truthy(value);
  }

  private numericValue(value: LingoValue, fallback = 0): number {
    if (isNumber(value)) return numberOf(value);
    const converted = Number(value);
    return Number.isFinite(converted) ? converted : fallback;
  }

  private integerValue(value: LingoValue, fallback = 0): number {
    return Math.round(this.numericValue(value, fallback));
  }

  private memberFontSize(member: CastMember): number {
    return Math.max(1, this.memberNumberStyle(member, "fontsize", 12));
  }

  private memberLineHeight(member: CastMember): number {
    const fixed = this.memberNumberStyle(member, "fixedlinespace", 0);
    const spaced = this.memberFontSize(member) + this.memberNumberStyle(member, "topspacing", 0);
    return Math.max(1, fixed, spaced);
  }

  private memberTopSpacing(member: CastMember): number {
    return Math.max(0, this.memberNumberStyle(member, "topspacing", 0));
  }

  private memberTextDrawTopInset(member: CastMember, lineHeight: number, fontSize: number, descent: number): number {
    if (member.style.has("topspacing")) return this.memberTopSpacing(member);
    const fixed = this.memberNumberStyle(member, "fixedlinespace", 0);
    if (fixed <= fontSize) return 0;
    // Director's text image keeps fixed-line cells and font ascent separate.
    // Large fixedLineSpace-only controls, such as dropmenus, draw glyphs in
    // the lower text band; Writer-managed text sets topSpacing explicitly.
    return Math.max(0, Math.round(lineHeight - fontSize - descent));
  }

  private memberBoxType(member: CastMember): string {
    const value = member.style.get("boxtype");
    if (value instanceof LingoSymbol) return value.name.toLowerCase();
    if (typeof value === "string") return value.toLowerCase().replace(/^#/, "");
    return "adjust";
  }

  private memberCharWidth(member: CastMember): number {
    return Math.max(1, this.measureTextSpan(member, "W", 1));
  }

  private memberTextLines(member: CastMember): string[] {
    const lines = member.text.split(/\r\n|\r|\n/);
    return lines.length > 0 ? lines : [""];
  }

  private layoutTextMember(member: CastMember): { text: string; start: number; end: number; line: number }[] {
    const wrapWidth = this.memberNumberStyle(member, "wordwrap", 1) ? this.memberRectWidth(member) : 0;
    const rows: { text: string; start: number; end: number; line: number }[] = [];
    let globalPos = 1;
    let visualLine = 0;
    for (const sourceLine of this.memberTextLines(member)) {
      if (sourceLine.length === 0) {
        rows.push({ text: "", start: globalPos, end: globalPos, line: visualLine });
        visualLine += 1;
        globalPos += 1;
        continue;
      }
      if (wrapWidth <= 0) {
        rows.push({ text: sourceLine, start: globalPos, end: globalPos + sourceLine.length, line: visualLine });
        visualLine += 1;
      } else {
        let offset = 0;
        while (offset < sourceLine.length) {
          let end = offset;
          let width = 0;
          while (end < sourceLine.length) {
            const char = sourceLine[end]!;
            const advance = this.measureTextSpan(member, char, globalPos + end);
            if (end > offset && width + advance > wrapWidth) break;
            width += advance;
            end += 1;
          }
          if (end === offset) end += 1;
          const text = sourceLine.slice(offset, end);
          rows.push({
            text,
            start: globalPos + offset,
            end: globalPos + offset + text.length,
            line: visualLine,
          });
          visualLine += 1;
          offset = end;
        }
      }
      globalPos += sourceLine.length + 1;
    }
    return rows.length > 0 ? rows : [{ text: "", start: 1, end: 1, line: 0 }];
  }

  private memberRectWidth(member: CastMember): number {
    const styled = member.style.get("rect");
    if (styled instanceof LingoRect) return styled.width;
    return this.memberNumberStyle(member, "width", 0);
  }

  private measureTextMemberWidth(member: CastMember): number {
    return Math.max(1, ...this.layoutTextMember(member).map((line) => this.measureTextSpan(member, line.text, line.start)));
  }

  private memberCharPosToLoc(member: CastMember, position: number): LingoPoint {
    const lineHeight = this.memberLineHeight(member);
    const pos = Math.max(1, Math.min(position, member.text.length + 1));
    const rows = this.layoutTextMember(member);
    for (const row of rows) {
      if (pos >= row.start && pos <= row.end) {
        return new LingoPoint(this.measureTextSpan(member, row.text.slice(0, pos - row.start), row.start), row.line * lineHeight);
      }
    }
    const last = rows[rows.length - 1]!;
    return new LingoPoint(this.measureTextSpan(member, last.text, last.start), last.line * lineHeight);
  }

  private memberLocToCharPos(member: CastMember, loc: LingoPoint): number {
    const lineHeight = this.memberLineHeight(member);
    const rowIndex = Math.max(0, Math.floor(loc.y / lineHeight));
    const rows = this.layoutTextMember(member);
    const row = rows[Math.min(rowIndex, rows.length - 1)]!;
    let width = 0;
    for (let i = 0; i < row.text.length; i += 1) {
      const advance = this.measureTextSpan(member, row.text[i]!, row.start + i);
      if (loc.x < width + advance / 2) return row.start + i;
      width += advance;
    }
    return row.end;
  }

  private textStyleAt(member: CastMember, position: number, property: string): LingoValue | undefined {
    const key = property.toLowerCase();
    let value = member.style.get(key);
    for (const run of member.textStyleRuns) {
      if (run.property === key && position >= run.start && position <= run.end) {
        value = run.value;
      }
    }
    return value;
  }

  private textStyleNumberAt(member: CastMember, position: number, property: string, fallback: number): number {
    const value = this.textStyleAt(member, position, property);
    return isNumber(value ?? LINGO_VOID) ? numberOf(value!) : fallback;
  }

  private textStyleNames(value: LingoValue | undefined): Set<string> {
    const names = new Set<string>();
    const add = (entry: LingoValue): void => {
      if (entry instanceof LingoSymbol) names.add(entry.name.toLowerCase().replace(/^#/, ""));
      else if (typeof entry === "string") {
        for (const token of entry.toLowerCase().split(/[,\s]+/)) {
          const normalized = token.trim().replace(/^#/, "");
          if (normalized.length > 0) names.add(normalized);
        }
      }
    };
    if (value instanceof LingoList) {
      for (const entry of value.items) add(entry);
    } else if (value !== undefined) {
      add(value);
    }
    return names;
  }

  private textColorCss(value: LingoValue | undefined): string {
    if (value instanceof LingoColor) {
      return `rgb(${value.r}, ${value.g}, ${value.b})`;
    }
    if (value instanceof LingoList && value.items.length >= 3) {
      const rgb = value.items.slice(0, 3).map((entry) => (isNumber(entry) ? Math.round(numberOf(entry)) : 0));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
    // Window layouts carry colors as "#RRGGBB" strings (#txtColor).
    if (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())) {
      const hex = value.trim().replace(/^#/, "");
      const numeric = Number.parseInt(hex, 16);
      return `rgb(${(numeric >> 16) & 0xff}, ${(numeric >> 8) & 0xff}, ${numeric & 0xff})`;
    }
    return "rgb(0, 0, 0)";
  }

  private static fontFamilyCandidates(value: string): string[] {
    const candidates: string[] = [];
    let current = "";
    let quote: '"' | "'" | null = null;
    for (const char of value) {
      if ((char === '"' || char === "'") && quote === null) {
        quote = char;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      if (char === "," && quote === null) {
        const candidate = current.trim();
        if (candidate.length > 0) candidates.push(candidate);
        current = "";
        continue;
      }
      current += char;
    }
    const finalCandidate = current.trim();
    if (finalCandidate.length > 0) candidates.push(finalCandidate);
    return candidates;
  }

  private static cssFontFamilyToken(family: string): string {
    const cleaned = family.trim().replace(/"/g, "");
    if (cleaned.length === 0) return "Arial";
    const generic = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);
    if (generic.has(cleaned.toLowerCase()) || /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(cleaned)) return cleaned;
    return `"${cleaned}"`;
  }

  /** release306 text uses the embedded Director fonts "V" (Volter) and "VB"
   * (Volter Bold), the Goldfish bitmap fonts served as webfonts. */
  private static volterFamilyFor(value: LingoValue | undefined): { family: string; bold: boolean } | null {
    if (typeof value !== "string") return null;
    const firstFamily = DirectorMovie.fontFamilyCandidates(value)[0] ?? value;
    const normalized = firstFamily.toLowerCase().replace(/"/g, "").replace(/\s+/g, " ").trim();
    const compact = normalized.replace(/[\s_-]+/g, "");
    switch (compact) {
      case "v":
      case "volter":
      case "volter(goldfish)":
      case "voltergoldfish":
        return { family: '"Volter Goldfish"', bold: false };
      case "vb":
      case "volterbold":
      case "volterbold(goldfish)":
      case "volterboldgoldfish":
        return { family: '"Volter Goldfish"', bold: true };
      default:
        return null;
    }
  }

  private canvasFontFamily(value: LingoValue | undefined): string {
    if (typeof value !== "string" || value.trim().length === 0) return "Arial";
    const candidates = DirectorMovie.fontFamilyCandidates(value);
    const volter = DirectorMovie.volterFamilyFor(value);
    if (volter) {
      const fallbacks = candidates.slice(1).map((family) => DirectorMovie.cssFontFamilyToken(family));
      return [volter.family, ...fallbacks].join(", ");
    }
    const families = candidates.length > 0 ? candidates : ["Arial"];
    return families.map((family) => DirectorMovie.cssFontFamilyToken(family)).join(", ");
  }

  private canvasFont(member: CastMember, position: number): string {
    const fontSize = this.textStyleNumberAt(member, position, "fontsize", this.memberFontSize(member));
    const fontValue = this.textStyleAt(member, position, "font");
    const family = this.canvasFontFamily(fontValue);
    const names = this.textStyleNames(this.textStyleAt(member, position, "fontstyle"));
    const cssParts: string[] = [];
    if (names.has("italic")) cssParts.push("italic");
    if (names.has("bold") || DirectorMovie.volterFamilyFor(fontValue)?.bold) cssParts.push("bold");
    cssParts.push(`${fontSize}px`, family);
    return cssParts.join(" ");
  }

  private measureContext(): CanvasRenderingContext2D | null {
    if (this.textMeasureContext !== undefined) return this.textMeasureContext;
    if (typeof document === "undefined") {
      this.textMeasureContext = null;
      return null;
    }
    const canvas = document.createElement("canvas");
    this.textMeasureContext = canvas.getContext("2d");
    return this.textMeasureContext;
  }

  private fallbackTextAdvance(member: CastMember, text: string): number {
    const charSpacing = this.memberNumberStyle(member, "charspacing", 0);
    return Math.max(0, text.length * (Math.ceil(this.memberFontSize(member) * 0.58) + charSpacing));
  }

  /** Per-font, per-character advances rounded to whole pixels. Director's
   * bitmap fonts (Volter 9px) have integral advances; the webfont reports
   * 5.0009/5.9985-style widths whose fractional drift smears glyphs across
   * pixel boundaries. Rounding keeps layout, caret math, and drawing on the
   * same integer grid. */
  private readonly glyphAdvanceCache = new Map<string, Map<string, number>>();

  private glyphAdvance(font: string, char: string): number {
    let byChar = this.glyphAdvanceCache.get(font);
    if (!byChar) {
      byChar = new Map();
      this.glyphAdvanceCache.set(font, byChar);
    }
    const cached = byChar.get(char);
    if (cached !== undefined) return cached;
    const ctx = this.measureContext()!;
    ctx.font = font;
    const advance = Math.round(ctx.measureText(char).width);
    byChar.set(char, advance);
    return advance;
  }

  /** Font box metrics (rounded). The raster places each row's baseline at
   * rowTop + topSpacing + (fontSize - descent), which keeps Volter's caps and
   * descenders inside the Director glyph band [topSpacing, topSpacing+fontSize]
   * that Writer Class slices lines out of. */
  private readonly fontMetricsCache = new Map<string, { ascent: number; descent: number }>();

  private fontMetrics(font: string): { ascent: number; descent: number } {
    const cached = this.fontMetricsCache.get(font);
    if (cached) return cached;
    let metrics = { ascent: 7, descent: 2 };
    const ctx = this.measureContext();
    if (ctx) {
      ctx.font = font;
      const measured = ctx.measureText("Mg");
      const ascent = measured.fontBoundingBoxAscent ?? 0;
      const descent = measured.fontBoundingBoxDescent ?? 0;
      if (ascent > 0 || descent > 0) {
        metrics = { ascent: Math.round(ascent), descent: Math.round(descent) };
      }
    }
    this.fontMetricsCache.set(font, metrics);
    return metrics;
  }

  private measureTextSpan(member: CastMember, text: string, position: number): number {
    if (text.length === 0) return 0;
    if (!this.measureContext()) return this.fallbackTextAdvance(member, text);
    const charSpacing = this.memberNumberStyle(member, "charspacing", 0);
    let width = 0;
    if (member.textStyleRuns.length === 0) {
      const font = this.canvasFont(member, position);
      for (let i = 0; i < text.length; i += 1) {
        width += this.glyphAdvance(font, text[i]!);
      }
    } else {
      for (let i = 0; i < text.length; i += 1) {
        width += this.glyphAdvance(this.canvasFont(member, position + i), text[i]!);
      }
    }
    return width + Math.max(0, text.length - 1) * charSpacing;
  }

  /** Mutation-counter key: text/style writes bump member.textVersion, so the
   * per-frame presentation check is one string compare instead of
   * re-serializing the member's text and style tables. */
  private textMemberPresentationKey(member: CastMember): string {
    return String(member.textVersion);
  }

  private memberTextRowBaseX(member: CastMember, rowText: string, rowStart: number, width: number): number {
    const alignValue = member.style.get("alignment");
    const align =
      alignValue instanceof LingoSymbol
        ? alignValue.name.toLowerCase()
        : typeof alignValue === "string"
          ? alignValue.toLowerCase()
          : "left";
    const rowWidth = this.measureTextSpan(member, rowText, rowStart);
    return align === "center" ? Math.max(0, (width - rowWidth) / 2) : align === "right" ? Math.max(0, width - rowWidth) : 0;
  }

  private memberTextCaretLoc(member: CastMember, position: number): { x: number; y: number; height: number } {
    const width = Math.max(1, this.memberWidth(member));
    const lineHeight = this.memberLineHeight(member);
    const pos = Math.max(1, Math.min(position, member.text.length + 1));
    const rows = this.layoutTextMember(member);
    for (const row of rows) {
      if (pos >= row.start && pos <= row.end) {
        const x =
          this.memberTextRowBaseX(member, row.text, row.start, width) +
          this.measureTextSpan(member, row.text.slice(0, pos - row.start), row.start);
        return { x, y: row.line * lineHeight, height: lineHeight };
      }
    }
    const last = rows[rows.length - 1]!;
    return {
      x: this.memberTextRowBaseX(member, last.text, last.start, width) + this.measureTextSpan(member, last.text, last.start),
      y: last.line * lineHeight,
      height: lineHeight,
    };
  }

  prepareTextSpriteImages(focusedSprite = 0): void {
    for (const channel of this.channels) {
      const member = channel.member;
      if (channel.puppet !== 1 || channel.visible !== 1 || !member || (member.type !== "field" && member.type !== "text")) {
        continue;
      }
      this.ensureTextMemberImage(member);
      const editable = channel.editable === 1 || Number(member.style.get("editable") ?? 0) === 1;
      member.presentationCaretLoc =
        channel.number === focusedSprite && editable ? this.memberTextCaretLoc(member, this.selEnd || member.text.length + 1) : null;
    }
  }

  /** The member's current text raster, rebuilt only when text/styles changed.
   * The previous canvas is reused when dimensions match so the renderer can
   * update one GPU texture in place; a replaced image is released through
   * onImageReleased so its texture does not leak. */
  ensureTextMemberImage(member: CastMember): LingoImage {
    const key = this.textMemberPresentationKey(member);
    if (member.presentationImageKey !== key || !member.presentationImage) {
      const previous = member.presentationImage;
      member.presentationImage = this.renderTextMemberImage(member, previous);
      member.presentationImageKey = key;
      if (previous && previous !== member.presentationImage) {
        this.onImageReleased(previous);
      }
    }
    return member.presentationImage;
  }

  private drawTextMemberChar(
    ctx: CanvasRenderingContext2D,
    member: CastMember,
    char: string,
    position: number,
    x: number,
    baselineY: number,
    advance: number,
  ): void {
    const fontSize = this.textStyleNumberAt(member, position, "fontsize", this.memberFontSize(member));
    const fontStyle = this.textStyleNames(this.textStyleAt(member, position, "fontstyle"));
    ctx.font = this.canvasFont(member, position);
    ctx.fillStyle = this.textColorCss(this.textStyleAt(member, position, "color"));
    ctx.fillText(char, x, baselineY);
    if (fontStyle.has("underline")) {
      const underlineHeight = Math.max(1, Math.round(fontSize / 12));
      ctx.fillRect(x, baselineY + 1, advance, underlineHeight);
    }
  }

  private shouldSnapTextAlpha(member: CastMember): boolean {
    if (!this.memberBooleanStyle(member, "antialias", true)) return true;
    const threshold = this.memberNumberStyle(member, "antialiasthreshold", DIRECTOR_TEXT_ANTIALIAS_THRESHOLD);
    return this.layoutTextMember(member).every((row) => {
      const fontSize = this.textStyleNumberAt(member, row.start, "fontsize", this.memberFontSize(member));
      return fontSize < threshold;
    });
  }

  private textPixelAlphaThreshold(red: number, green: number, blue: number): number {
    const brightness = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    return brightness >= 170 ? LIGHT_TEXT_BITMAP_ALPHA_THRESHOLD : DARK_TEXT_BITMAP_ALPHA_THRESHOLD;
  }

  /** Rasterizes a text/field member at Director metrics: each visual row is a
   * lineHeight-tall cell, glyphs occupy the band [topSpacing,
   * topSpacing+fontSize] within it (the band Writer Class slices out of
   * member.image), and every glyph lands on integer x advances. Director's
   * antiAliasThreshold defaults to 14pt, so Habbo's 9px Volter text is snapped
   * to bitmap alpha instead of left as browser antialiased webfont output. */
  private renderTextMemberImage(member: CastMember, reuse: LingoImage | null = null): LingoImage {
    const width = Math.max(1, Math.round(this.memberWidth(member)));
    const height = Math.max(1, Math.round(this.memberHeight(member)));
    const image =
      reuse && reuse.width === width && reuse.height === height && reuse.context
        ? reuse
        : new LingoImage(width, height, 32, undefined, { initWhite: false });
    const ctx = image.context;
    if (!ctx) return image;

    ctx.clearRect(0, 0, width, height);
    ctx.textBaseline = "alphabetic";
    const lineHeight = this.memberLineHeight(member);
    const charSpacing = this.memberNumberStyle(member, "charspacing", 0);
    for (const row of this.layoutTextMember(member)) {
      const rowFont = this.canvasFont(member, row.start);
      const fontSize = this.textStyleNumberAt(member, row.start, "fontsize", this.memberFontSize(member));
      const descent = this.fontMetrics(rowFont).descent;
      const topInset = this.memberTextDrawTopInset(member, lineHeight, fontSize, descent);
      const baselineY = row.line * lineHeight + topInset + Math.max(1, fontSize - descent);
      const baseX = Math.round(this.memberTextRowBaseX(member, row.text, row.start, width));
      let x = baseX;
      for (let i = 0; i < row.text.length; i += 1) {
        const position = row.start + i;
        const advance =
          member.textStyleRuns.length === 0
            ? this.glyphAdvance(rowFont, row.text[i]!)
            : this.measureTextSpan(member, row.text[i]!, position);
        this.drawTextMemberChar(ctx, member, row.text[i]!, position, x, baselineY, advance);
        x += advance + (i < row.text.length - 1 ? charSpacing : 0);
      }
    }
    if (this.shouldSnapTextAlpha(member)) {
      const pixels = ctx.getImageData(0, 0, width, height);
      const data = pixels.data;
      for (let offset = 3; offset < data.length; offset += 4) {
        const alphaThreshold = this.textPixelAlphaThreshold(data[offset - 3] ?? 0, data[offset - 2] ?? 0, data[offset - 1] ?? 0);
        data[offset] = data[offset]! >= alphaThreshold ? 255 : 0;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    image.version += 1;
    return image;
  }

  theOf = (property: string, object: LingoValue): LingoValue | undefined => {
    if (object instanceof CastMember || object instanceof SpriteChannel || object instanceof CastLibRef) {
      if (property === "number_of_members" && object instanceof CastLibRef) {
        return this.members.memberCount(object.name);
      }
      return this.getProp(object, property);
    }
    return undefined;
  };

  setTheOf = (property: string, object: LingoValue, value: LingoValue): boolean => {
    return this.setProp(object, property, value);
  };

  objectRef = (refType: string, id: LingoValue, castLib: LingoValue | null): LingoValue | undefined => {
    if (refType === "castlib") {
      return this.call("castlib", [id]);
    }
    if (refType === "member" || refType === "field") {
      return this.call("member", castLib === null ? [id] : [id, castLib]);
    }
    if (refType === "sprite") {
      return this.call("sprite", [id]);
    }
    return undefined;
  };
}

function mediaSourceForMember(member: CastMember): { readonly memberName: string; readonly memberNumber: number; readonly castName: string } {
  return {
    memberName: member.name,
    memberNumber: member.number,
    castName: member.castName,
  };
}

function isPhotoInvalidMedia(value: LingoValue): boolean {
  return value instanceof LingoBitmapMedia && value.source.memberName?.toLowerCase() === "photo_invalid";
}

function formatDirectorBitmapMediaInspection(info: DirectorBitmapMediaInspection): string {
  const fields = [
    `accepted=${info.accepted ? 1 : 0}`,
    `reason=${info.reason}`,
    `bytes=${info.bytes}`,
    `prefix=${info.prefix}`,
  ];
  if (info.offset !== undefined) fields.push(`offset=${info.offset}`);
  if (info.fourCC !== undefined) fields.push(`fourCC=${JSON.stringify(info.fourCC)}`);
  if (info.width !== undefined && info.height !== undefined) fields.push(`size=${info.width}x${info.height}`);
  if (info.rowBytes !== undefined) fields.push(`rowBytes=${info.rowBytes}`);
  if (info.minRowBytes !== undefined) fields.push(`minRowBytes=${info.minRowBytes}`);
  if (info.bitDepth !== undefined) fields.push(`bitDepth=${info.bitDepth}`);
  if (info.palette !== undefined) fields.push(`palette=${info.palette}`);
  if (info.paletteName !== undefined) fields.push(`paletteName=${info.paletteName}`);
  if (info.packedLength !== undefined) fields.push(`packedLength=${info.packedLength}`);
  return fields.join(" ");
}
