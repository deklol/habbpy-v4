import { paletteTableForBitmapDepth } from "./palettes";
import { LingoObjectLike, LingoSymbol, LingoValue } from "./values";
import { LingoColor, LingoPoint, LingoRect } from "./geometry";
import { decodeDirectorBitmapMedia, encodeDirectorBitmapMedia } from "./directorBitmapMedia";

/**
 * Director image object. Habbo renders almost everything by compositing
 * member bitmaps into image buffers with copyPixels (the single most-used
 * method in the source), then showing the buffer on a sprite. This wraps an
 * HTML canvas in the browser; in Node (boot simulator) the canvas is absent
 * and pixel operations are no-ops so the logic path still runs.
 *
 * Two Director facts drive this implementation (evidence: docs/inks.txt,
 * release306 window/visualizer source):
 * - `image(w, h, depth)` starts WHITE; window buffers rely on that white plus
 *   a sprite-level Matte ink for their rounded corners.
 * - copyPixels params carry #ink, #blend, #color/#bgColor, and
 *   #maskImage/#maskOffset; #color/#bgColor provide Director foreground and
 *   background colorization, ink 36 keys out the bg color, ink 8 applies
 *   native matte coverage, ink 41 multiplies by #bgColor, ink 33 keys white
 *   then adds, inks 37/39 are lightest/darkest RGB compares.
 *
 * Bitmap decode is asynchronous in the browser while the source expects
 * loaded casts to have pixels synchronously. Images therefore track
 * "incomplete" state: copies from an incomplete image are journaled and
 * replayed when its pixels arrive, cascading through dependent buffers.
 */

type Canvas2D = CanvasRenderingContext2D;
/** The DOM drawImage source type (our exported CanvasImageSource shadows it). */
type DomImageSource = Parameters<CanvasRenderingContext2D["drawImage"]>[0];

export type MatteCoveragePolicy =
  | "exact-white-transparent"
  | "edge-connected-white-transparent"
  | "edge-connected-dominant-palette-index-transparent";

export interface CopyPixelsParams {
  blend?: number;
  ink?: number;
  color?: LingoColor | null;
  bgColor?: LingoColor | null;
  paletteRef?: LingoValue | null;
  maskImage?: LingoImage | null;
  maskOffset?: LingoPoint | null;
  /** Axis-aligned quad destinations reduce to a rect plus mirroring (the
   * source's flipH/flipV idiom: copyPixels(img, quadList, rect)). */
  flipH?: boolean;
  flipV?: boolean;
  quadTransform?: CopyPixelsQuadTransform;
  quadPoints?: CopyPixelsQuadPoints;
}

export interface LingoBitmapMediaSource {
  readonly memberName?: string;
  readonly memberNumber?: number;
  readonly castName?: string;
}

export type CopyPixelsQuadPoints = [LingoPoint, LingoPoint, LingoPoint, LingoPoint];

export type CopyPixelsQuadTransform =
  | "identity"
  | "flipH"
  | "flipV"
  | "rotate180"
  | "rotateCW"
  | "rotateCCW"
  | "transpose"
  | "antiTranspose";

function createCanvas(width: number, height: number): { ctx: Canvas2D | null; el: unknown } {
  if (typeof document !== "undefined") {
    const el = document.createElement("canvas");
    el.width = Math.max(1, width);
    el.height = Math.max(1, height);
    const ctx = el.getContext("2d", { willReadFrequently: true }) as Canvas2D;
    ctx.imageSmoothingEnabled = false;
    return { ctx, el };
  }
  // Node: no canvas. Image keeps dimensions only.
  return { ctx: null, el: null };
}

export class LingoBitmapMedia implements LingoObjectLike {
  readonly lingoType = "media";
  private imageCache: LingoImage | null | undefined;

  constructor(
    readonly bytes: Uint8Array,
    readonly source: LingoBitmapMediaSource = {},
  ) {}

  toImage(): LingoImage | null {
    if (this.imageCache !== undefined) return this.imageCache;
    this.imageCache = decodeDirectorBitmapMedia(this.bytes);
    return this.imageCache;
  }

  lingoToString(): string {
    return `(media ${this.bytes.length} bytes)`;
  }
}

/** Exact-match color key -> transparent (Director Background Transparent). */
function applyColorKey(ctx: Canvas2D, width: number, height: number, color: LingoColor, opaqueNonKey: boolean): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    if (data[offset] === color.r && data[offset + 1] === color.g && data[offset + 2] === color.b) {
      data[offset + 3] = 0;
    } else if (opaqueNonKey) {
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Director Matte coverage for ordinary sprite presentation.
 * Native MX 2004 evidence keeps matte coverage as compositor input; it does
 * not reconstruct coverage from arbitrary palette bytes. Static/direct sprite
 * Matte keeps the exact-white rule unless an image carries stronger
 * provenance. Explicit createMatte() mask objects are handled separately
 * below because the scripting reference defines them as Matte-ink masks. */
function applyExactWhiteMatteCoverage(ctx: Canvas2D, width: number, height: number, color: LingoColor): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    if (data[offset] === color.r && data[offset + 1] === color.g && data[offset + 2] === color.b) {
      data[offset + 3] = 0;
    } else {
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function applyCopyPixelsMatteCoverage(ctx: Canvas2D, width: number, height: number, color: LingoColor): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  if (imageHasNonOpaqueAlpha(data)) {
    return;
  }
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    if (data[offset] === color.r && data[offset + 1] === color.g && data[offset + 2] === color.b) {
      data[offset + 3] = 0;
    } else {
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function dominantOpaqueBorderColor(data: Uint8ClampedArray, width: number, height: number): LingoColor | null {
  const counts = new Map<number, number>();
  const add = (x: number, y: number): void => {
    const offset = (y * width + x) * 4;
    if (data[offset + 3]! === 0) return;
    const rgb = ((data[offset]! & 0xff) << 16) | ((data[offset + 1]! & 0xff) << 8) | (data[offset + 2]! & 0xff);
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  };
  for (let x = 0; x < width; x += 1) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y);
    add(width - 1, y);
  }
  let bestRgb: number | null = null;
  let bestCount = 0;
  for (const [rgb, count] of counts) {
    if (count <= bestCount) continue;
    bestRgb = rgb;
    bestCount = count;
  }
  return bestRgb === null
    ? null
    : new LingoColor((bestRgb >> 16) & 0xff, (bestRgb >> 8) & 0xff, bestRgb & 0xff);
}

function boundaryConnectedColorMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  color: LingoColor,
): Uint8Array {
  const mask = new Uint8Array(Math.max(0, width * height));
  if (width <= 0 || height <= 0) return mask;
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const matches = (index: number): boolean => {
    const offset = index * 4;
    return (
      data[offset + 3]! > 0 &&
      data[offset]! === color.r &&
      data[offset + 1]! === color.g &&
      data[offset + 2]! === color.b
    );
  };
  const enqueue = (x: number, y: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (mask[index] || !matches(index)) return;
    mask[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = Math.floor(index / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }
  return mask;
}

function applyBoundaryConnectedMatteCoverage(
  ctx: Canvas2D,
  width: number,
  height: number,
  color: LingoColor | null,
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const key = color ?? dominantOpaqueBorderColor(data, width, height) ?? WHITE;
  const boundaryMask = boundaryConnectedColorMask(data, width, height, key);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (data[offset + 3]! === 0 || boundaryMask[index]) {
      data[offset + 3] = 0;
    } else {
      data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function imageHasNonOpaqueAlpha(data: Uint8ClampedArray): boolean {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset]! < 255) return true;
  }
  return false;
}

function applyAlphaLayerMatteCoverage(ctx: Canvas2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
}

function normalizeMatteCoveragePolicy(policy: string | null | undefined): MatteCoveragePolicy {
  switch (String(policy ?? "").toLowerCase()) {
    case "edge-connected-white-transparent":
      return "edge-connected-white-transparent";
    case "edge-connected-dominant-palette-index-transparent":
      return "edge-connected-dominant-palette-index-transparent";
    default:
      return "exact-white-transparent";
  }
}

function drawSizeForQuadTransform(
  transform: CopyPixelsQuadTransform,
  width: number,
  height: number,
): { width: number; height: number } {
  switch (transform) {
    case "rotateCW":
    case "rotateCCW":
    case "transpose":
    case "antiTranspose":
      return { width: height, height: width };
    default:
      return { width, height };
  }
}

function applyQuadTransform(ctx: Canvas2D, transform: CopyPixelsQuadTransform, width: number, height: number): void {
  switch (transform) {
    case "identity":
      return;
    case "flipH":
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      return;
    case "flipV":
      ctx.translate(0, height);
      ctx.scale(1, -1);
      return;
    case "rotate180":
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      return;
    case "rotateCW":
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
      return;
    case "rotateCCW":
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
      return;
    case "transpose":
      ctx.transform(0, 1, 1, 0, 0, 0);
      return;
    case "antiTranspose":
      ctx.transform(0, -1, -1, 0, width, height);
      return;
  }
}

export function affineTransformForQuad(
  points: CopyPixelsQuadPoints,
  width: number,
  height: number,
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const [ul, ur, _lr, ll] = points;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return {
    a: (ur.x - ul.x) / safeWidth,
    b: (ur.y - ul.y) / safeWidth,
    c: (ll.x - ul.x) / safeHeight,
    d: (ll.y - ul.y) / safeHeight,
    e: ul.x,
    f: ul.y,
  };
}

/** Director Darken's fixed-point bgColor filter plus foreColor offset. */
function applyDarkenColorFilter(
  ctx: Canvas2D,
  width: number,
  height: number,
  scale: LingoColor,
  add: LingoColor | null,
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const scaleChannel = (value: number): number => (value >= 255 ? 256 : Math.max(0, Math.min(255, Math.trunc(value))));
  const sr = scaleChannel(scale.r);
  const sg = scaleChannel(scale.g);
  const sb = scaleChannel(scale.b);
  const ar = add?.r ?? 0;
  const ag = add?.g ?? 0;
  const ab = add?.b ?? 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    data[offset] = Math.min(255, ((data[offset]! * sr) >> 8) + ar);
    data[offset + 1] = Math.min(255, ((data[offset + 1]! * sg) >> 8) + ag);
    data[offset + 2] = Math.min(255, ((data[offset + 2]! * sb) >> 8) + ab);
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Director foreground/background colorization:
 * foreground color changes black/dark pixels, background color changes
 * white/light pixels. This is the same color-control path exposed to
 * copyPixels as #color/#bgColor, independent from #bgColor's transparency key
 * role in ink 36 and filter role in ink 41.
 */
function applyDirectorColorization(
  ctx: Canvas2D,
  width: number,
  height: number,
  foreColor: LingoColor | null,
  backColor: LingoColor | null,
): void {
  if (!foreColor && !backColor) return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    const lightness = (r + g + b) / (255 * 3);
    if (foreColor && backColor) {
      const dark = 1 - lightness;
      data[offset] = Math.round((foreColor.r * dark) + (backColor.r * lightness));
      data[offset + 1] = Math.round((foreColor.g * dark) + (backColor.g * lightness));
      data[offset + 2] = Math.round((foreColor.b * dark) + (backColor.b * lightness));
    } else if (foreColor) {
      const dark = 1 - lightness;
      data[offset] = Math.round((r * (1 - dark)) + (foreColor.r * dark));
      data[offset + 1] = Math.round((g * (1 - dark)) + (foreColor.g * dark));
      data[offset + 2] = Math.round((b * (1 - dark)) + (foreColor.b * dark));
    } else if (backColor) {
      const light = lightness;
      data[offset] = Math.round((r * (1 - light)) + (backColor.r * light));
      data[offset + 1] = Math.round((g * (1 - light)) + (backColor.g * light));
      data[offset + 2] = Math.round((b * (1 - light)) + (backColor.b * light));
    }
  }
  ctx.putImageData(image, 0, 0);
}

const WHITE = new LingoColor(255, 255, 255);

function paletteColorsForRef(ref: LingoValue | null | undefined, bitDepth?: number | null): readonly number[] | null {
  if (ref instanceof LingoSymbol) return paletteTableForBitmapDepth(ref.name.replace(/^#/, ""), bitDepth);
  const paletteLike = ref as { paletteColors?: unknown } | null | undefined;
  return Array.isArray(paletteLike?.paletteColors) ? (paletteLike.paletteColors as readonly number[]) : null;
}

function isGrayscalePalette(palette: readonly number[] | null): boolean {
  if (!palette || palette.length < 256) return false;
  const grayscale = paletteTableForBitmapDepth("grayscale", 8);
  for (let index = 0; index < 256; index += 1) {
    if ((palette[index] ?? null) !== grayscale[index]) return false;
  }
  return true;
}

function resolveColorForPalette(color: LingoColor, paletteRef: LingoValue | null | undefined): LingoColor {
  if (color.paletteIndex === null) return color;
  const table = paletteColorsForRef(paletteRef);
  if (!table || table.length === 0) return color;
  const index = Math.max(0, Math.min(255, Math.trunc(color.paletteIndex)));
  const rgb = table[index] ?? color.hex;
  return new LingoColor((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, index);
}

/**
 * Director mask/alpha images are grayscale where BLACK is opaque (Mask ink:
 * "black areas make the sprite opaque, white areas are transparent");
 * transparent pixels are fully masked out. Returns a canvas whose alpha
 * channel holds the mask's effective coverage for destination-in compositing.
 */
function effectiveMaskCanvas(mask: LingoImage): { el: unknown } | null {
  if (!mask.el || !mask.context) return null;
  const width = mask.width;
  const height = mask.height;
  const staged = createCanvas(width, height);
  if (!staged.ctx) return null;
  staged.ctx.drawImage(mask.el as DomImageSource, 0, 0);
  const image = staged.ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    if (alpha === 0) continue;
    const luminance = (data[offset]! + data[offset + 1]! + data[offset + 2]!) / 3;
    data[offset + 3] = Math.round((alpha * (255 - luminance)) / 255);
  }
  staged.ctx.putImageData(image, 0, 0);
  return { el: staged.el };
}

export class LingoImage implements LingoObjectLike {
  /** Diagnostic tap (tools/dev, ?traceCopy=1): observes every executed copy. */
  static copyTrace:
    | ((info: {
        destW: number;
        destH: number;
        srcW: number;
        srcH: number;
        destRect: string;
        sourceRect: string;
        ink: number | undefined;
        journaled: boolean;
      }) => void)
    | null = null;

  readonly lingoType = "image";
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  private _paletteRef: LingoValue;
  private indexedSource: { indices: Uint8Array; fallbackPalette: readonly number[]; bitDepth: number } | null = null;
  private matteCoveragePolicy: MatteCoveragePolicy = "exact-white-transparent";
  private boundaryMaskCache = new Map<string, { version: number; mask: Uint8Array }>();
  /** Mutable canvas context; created lazily on first mutation/pixel read.
   * Most decoded bitmaps are only ever copy SOURCES — keeping them as their
   * decoded drawable avoids allocating a CPU canvas per cast member (the
   * furni casts alone are 16k bitmaps / ~150MB RGBA). */
  private ctxStore: Canvas2D | null = null;
  private elStore: unknown = null;
  /** Decoded drawable (ImageBitmap/HTMLImageElement) standing in for pixels
   * until a mutation forces canvas materialization. */
  private drawable: CanvasImageSource | null = null;
  private canvasReady = false;
  private initWhitePending = false;
  /** Bumped on every mutation so the renderer can invalidate its texture. */
  version = 0;

  /** Pixels not yet arrived (bitmap decode in flight). */
  private pendingFill = false;
  /** Number of queued mutations into this image still waiting on inputs. */
  private pendingDeps = 0;
  /** Callbacks to run when this image becomes complete. */
  private completionQueue: (() => void)[] = [];
  /** Ordered mutation queue: once one operation waits on a decoding input,
   * every later mutation queues behind it so Director paint order holds
   * (e.g. a window's panel face must not replay over its labels). */
  private opQueue: { inputsRemaining: number; execute: () => void }[] = [];

  constructor(
    width: number,
    height: number,
    depth = 32,
    paletteRef: LingoValue = LingoSymbol.for("systemMac"),
    options: { initWhite?: boolean } = {},
  ) {
    this.width = Math.max(1, Math.trunc(width));
    this.height = Math.max(1, Math.trunc(height));
    this.depth = depth;
    this._paletteRef = paletteRef;
    // Director images start white; decoded/derived buffers opt out. The
    // canvas itself materializes on first use (el/context access).
    this.initWhitePending = options.initWhite ?? true;
  }

  private static get browserEnv(): boolean {
    return typeof document !== "undefined";
  }

  get paletteRef(): LingoValue {
    return this._paletteRef;
  }

  set paletteRef(value: LingoValue) {
    this._paletteRef = value;
    this.renderIndexedSource();
  }

  setMatteCoveragePolicy(policy: string | null | undefined): this {
    this.matteCoveragePolicy = normalizeMatteCoveragePolicy(policy);
    return this;
  }

  matteCoveragePolicyForDebug(): MatteCoveragePolicy {
    return this.matteCoveragePolicy;
  }

  /** Drawable source for canvas/GPU consumers: the adopted decode until the
   * image is mutated, then the materialized canvas. Null in Node. */
  get el(): unknown {
    if (this.drawable) return this.drawable;
    if (!this.canvasReady && LingoImage.browserEnv) this.materialize();
    return this.elStore;
  }

  /** Mutable 2d context (materializes the canvas; collapses an adopted
   * drawable into it first so pixels are preserved). Null in Node. */
  private get ctx(): Canvas2D | null {
    if (!this.canvasReady && LingoImage.browserEnv) this.materialize();
    return this.ctxStore;
  }

  private materialize(): void {
    if (this.canvasReady) return;
    const { ctx, el } = createCanvas(this.width, this.height);
    this.ctxStore = ctx;
    this.elStore = el;
    this.canvasReady = true;
    if (!ctx) return;
    if (this.indexedSource) {
      this.renderIndexedSourceToContext(ctx);
    } else if (this.drawable) {
      ctx.drawImage(this.drawable as DomImageSource, 0, 0);
      this.drawable = null;
      // The backing store changed identity; renderers compare el and rebuild.
      this.version += 1;
    } else if (this.initWhitePending) {
      ctx.fillStyle = "rgb(255, 255, 255)";
      ctx.fillRect(0, 0, this.width, this.height);
    }
    this.initWhitePending = false;
  }

  /** Wrap an already-decoded HTMLImageElement/ImageBitmap as an image without
   * copying it into a canvas; the drawable serves reads, and mutation
   * materializes a canvas on demand. */
  static fromDrawable(drawable: CanvasImageSource, width: number, height: number): LingoImage {
    const image = new LingoImage(width, height, 32, LingoSymbol.for("systemMac"), { initWhite: false });
    if (LingoImage.browserEnv) {
      image.drawable = drawable;
    }
    return image;
  }

  static fromDirectorBitmapMedia(media: LingoBitmapMedia): LingoImage | null {
    return media.toImage();
  }

  toDirectorBitmapMedia(source: LingoBitmapMediaSource = {}): LingoBitmapMedia {
    return new LingoBitmapMedia(encodeDirectorBitmapMedia(this), source);
  }

  directorBitmapMediaSource(): { readonly indices: Uint8Array } | null {
    if (!this.indexedSource || this.indexedSource.bitDepth !== 8) return null;
    if (!isGrayscalePalette(this.activePaletteColors())) return null;
    return { indices: new Uint8Array(this.indexedSource.indices) };
  }

  /** Capture a draw source into an immutable Director image at this instant.
   * Director's `(the stage).image` is used as a snapshot source by Habbo's
   * camera code; it must not keep a live reference to the renderer canvas. */
  static fromDrawableSnapshot(drawable: CanvasImageSource, width: number, height: number): LingoImage {
    const image = new LingoImage(width, height, 32, LingoSymbol.for("systemMac"), { initWhite: false });
    if (LingoImage.browserEnv) {
      const ctx = image.ctx;
      if (ctx) {
        ctx.clearRect(0, 0, image.width, image.height);
        ctx.drawImage(drawable as DomImageSource, 0, 0, image.width, image.height);
        image.initWhitePending = false;
        image.drawable = null;
        image.version += 1;
      }
    }
    return image;
  }

  /** Build a palette-indexed bitmap using the currently assigned palette.
   * Director stores many room pieces as indexed pixels; source code swaps the
   * palette before reading member.image. */
  static fromPaletteIndices(
    width: number,
    height: number,
    indices: Uint8Array,
    palette: readonly number[],
    paletteRef: LingoValue = LingoSymbol.for("systemMac"),
    bitDepth = 8,
  ): LingoImage {
    const normalizedDepth = Math.max(1, Math.trunc(Number(bitDepth) || 8));
    const image = new LingoImage(width, height, normalizedDepth, paletteRef, { initWhite: false });
    image.indexedSource = {
      indices: new Uint8Array(indices),
      fallbackPalette: [...palette],
      bitDepth: normalizedDepth,
    };
    image.renderIndexedSource();
    return image;
  }

  private activePaletteColors(): readonly number[] | null {
    return paletteColorsForRef(this._paletteRef, this.indexedSource?.bitDepth) ?? this.indexedSource?.fallbackPalette ?? null;
  }

  private renderIndexedSource(): void {
    if (!this.indexedSource || !LingoImage.browserEnv) return;
    if (!this.canvasReady) {
      this.materialize();
      return;
    }
    if (this.ctxStore) this.renderIndexedSourceToContext(this.ctxStore);
  }

  private renderIndexedSourceToContext(ctx: Canvas2D): void {
    const source = this.indexedSource;
    if (!source) return;
    const palette = this.activePaletteColors();
    if (!palette || palette.length === 0) return;
    const pixels = ctx.createImageData(this.width, this.height);
    const limit = Math.min(source.indices.length, this.width * this.height);
    for (let index = 0; index < limit; index += 1) {
      const rgb = palette[source.indices[index] ?? 0] ?? 0;
      const offset = index * 4;
      pixels.data[offset] = (rgb >> 16) & 0xff;
      pixels.data[offset + 1] = (rgb >> 8) & 0xff;
      pixels.data[offset + 2] = rgb & 0xff;
      pixels.data[offset + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    this.initWhitePending = false;
    this.drawable = null;
    this.version += 1;
  }

  private clearIndexedSource(): void {
    this.indexedSource = null;
  }

  /** A placeholder whose pixels arrive later (async bitmap decode). */
  static pendingPlaceholder(width: number, height: number): LingoImage {
    const image = new LingoImage(width, height, 32, LingoSymbol.for("systemMac"), { initWhite: false });
    if (LingoImage.browserEnv) {
      image.pendingFill = true;
    }
    return image;
  }

  get context(): Canvas2D | null {
    return this.ctx;
  }

  get incomplete(): boolean {
    return this.pendingFill || this.pendingDeps > 0;
  }

  /** Runs when (or immediately if) the image has its final pixels. */
  onComplete(callback: () => void): void {
    if (!this.incomplete) {
      callback();
      return;
    }
    this.completionQueue.push(callback);
  }

  /** Delivers decoded pixels into a pending placeholder and replays
   * journaled copies that were waiting on them. A null drawable (decode
   * failure) still resolves so dependent logic never stalls. */
  adoptDrawable(drawable: CanvasImageSource | null): void {
    this.clearIndexedSource();
    if (LingoImage.browserEnv && drawable) {
      if (this.canvasReady && this.ctxStore) {
        this.ctxStore.drawImage(drawable as DomImageSource, 0, 0);
      } else {
        this.drawable = drawable;
        this.initWhitePending = false;
      }
    }
    this.version += 1;
    if (this.pendingFill) {
      this.pendingFill = false;
      this.pumpQueue();
    } else {
      this.flushIfComplete();
    }
  }

  private flushIfComplete(): void {
    if (this.incomplete) return;
    const queue = this.completionQueue;
    this.completionQueue = [];
    for (const callback of queue) callback();
  }

  /** Runs a mutation in Director paint order: immediately when nothing is
   * queued and all inputs have pixels, else behind the queued operations. */
  private enqueueOrRun(inputs: LingoImage[], execute: () => void): void {
    const waits = inputs.filter((input) => input.incomplete);
    // If this image is itself a pending decoded bitmap, preserve Director
    // mutation order by applying writes after the source pixels arrive.
    if (!this.pendingFill && this.opQueue.length === 0 && waits.length === 0) {
      execute();
      return;
    }
    const op = { inputsRemaining: waits.length, execute };
    this.opQueue.push(op);
    this.pendingDeps += 1;
    for (const input of waits) {
      input.onComplete(() => {
        op.inputsRemaining -= 1;
        this.pumpQueue();
      });
    }
    // A fully-ready op still queues behind earlier waiters; pump in case it
    // is already at the head.
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (this.opQueue.length > 0 && this.opQueue[0]!.inputsRemaining === 0) {
      const op = this.opQueue.shift()!;
      op.execute();
      this.pendingDeps = Math.max(0, this.pendingDeps - 1);
    }
    this.flushIfComplete();
  }

  fill(rect: LingoRect | null, color: LingoColor): void {
    if (!this.ctx) return;
    this.clearIndexedSource();
    const r = rect ?? new LingoRect(0, 0, this.width, this.height);
    const fillColor = resolveColorForPalette(color, this.paletteRef);
    this.enqueueOrRun([], () => {
      if (!this.ctx) return;
      this.ctx.fillStyle = `rgb(${fillColor.r}, ${fillColor.g}, ${fillColor.b})`;
      this.ctx.fillRect(r.left, r.top, r.width, r.height);
      this.version += 1;
    });
  }

  /** copyPixels(source, destRect|destPoint, sourceRect, params). Applies
   * Director ink semantics; copies from images whose pixels are still
   * decoding are journaled and replayed on arrival. */
  copyPixels(
    source: LingoImage,
    dest: LingoRect | LingoPoint,
    sourceRect: LingoRect,
    params: CopyPixelsParams | null,
  ): void {
    if (!this.ctx || !source.el) return;
    this.clearIndexedSource();
    const destRect =
      dest instanceof LingoRect
        ? dest
        : new LingoRect(dest.x, dest.y, dest.x + sourceRect.width, dest.y + sourceRect.height);

    const mask = params?.maskImage ?? null;
    const willQueue = this.opQueue.length > 0 || source.incomplete || (mask?.incomplete ?? false);
    // Director copyPixels observes the source pixels at call time. The runtime
    // can queue later copies behind pending bitmap decodes, while Habbo's
    // Writer reuses one mutable text member for many rows. Snapshot any
    // already-complete inputs before queuing so delayed copies cannot pick up
    // a later Writer render.
    const sourceForCopy = willQueue && !source.incomplete ? source.duplicate() : source;
    const maskForCopy = mask && willQueue && !mask.incomplete ? mask.duplicate() : mask;
    const paramsForCopy =
      maskForCopy === mask ? params : { ...(params ?? {}), maskImage: maskForCopy };
    const inputs: LingoImage[] = [sourceForCopy];
    if (maskForCopy) inputs.push(maskForCopy);

    LingoImage.copyTrace?.({
      destW: this.width,
      destH: this.height,
      srcW: source.width,
      srcH: source.height,
      destRect: `${destRect.left},${destRect.top},${destRect.right},${destRect.bottom}`,
      sourceRect: `${sourceRect.left},${sourceRect.top},${sourceRect.right},${sourceRect.bottom}`,
      ink: params?.ink,
      journaled: willQueue,
    });

    this.enqueueOrRun(inputs, () => {
      this.executeCopy(sourceForCopy, destRect, sourceRect, paramsForCopy);
    });
  }

  private executeCopy(
    source: LingoImage,
    destRect: LingoRect,
    sourceRect: LingoRect,
    params: CopyPixelsParams | null,
  ): void {
    if (!this.ctx || !source.el) return;
    const ink = params?.ink ?? 0;
    const blend = params?.blend;
    const foreColor = params?.color
      ? resolveColorForPalette(params.color, params.paletteRef ?? source.paletteRef)
      : null;
    const bgColor = params?.bgColor
      ? resolveColorForPalette(params.bgColor, params.paletteRef ?? source.paletteRef)
      : null;
    const mask = params?.maskImage ?? null;
    const srcW = Math.max(1, Math.trunc(sourceRect.width));
    const srcH = Math.max(1, Math.trunc(sourceRect.height));

    // Stage the source region so ink/mask processing cannot touch `source`.
    const stage = createCanvas(srcW, srcH);
    if (!stage.ctx) return;
    stage.ctx.drawImage(
      source.el as DomImageSource,
      sourceRect.left,
      sourceRect.top,
      srcW,
      srcH,
      0,
      0,
      srcW,
      srcH,
    );

    switch (ink) {
      case 8:
        applyCopyPixelsMatteCoverage(stage.ctx, srcW, srcH, WHITE);
        break;
      case 33:
        applyColorKey(stage.ctx, srcW, srcH, bgColor ?? WHITE, true);
        break;
      case 36:
        applyColorKey(stage.ctx, srcW, srcH, bgColor ?? WHITE, false);
        break;
      case 41:
        if (bgColor) applyDarkenColorFilter(stage.ctx, srcW, srcH, bgColor, foreColor);
        break;
      default:
        break;
    }

    const colorizeBg = bgColor && ink !== 33 && ink !== 36 && ink !== 41 ? bgColor : null;
    applyDirectorColorization(stage.ctx, srcW, srcH, foreColor, colorizeBg);

    if (mask && mask.el) {
      const offset = params?.maskOffset ?? null;
      const coverage = effectiveMaskCanvas(mask);
      if (coverage) {
        stage.ctx.globalCompositeOperation = "destination-in";
        stage.ctx.drawImage(
          coverage.el as DomImageSource,
          Math.trunc(offset?.x ?? 0),
          Math.trunc(offset?.y ?? 0),
        );
        stage.ctx.globalCompositeOperation = "source-over";
      }
    }

    this.ctx.save();
    if (typeof blend === "number") {
      this.ctx.globalAlpha = Math.max(0, Math.min(1, blend / 100));
    }
    if (ink === 33 || ink === 34) {
      this.ctx.globalCompositeOperation = "lighter";
    } else if (ink === 39) {
      this.ctx.globalCompositeOperation = "darken";
    } else if (ink === 37) {
      this.ctx.globalCompositeOperation = "lighten";
    }
    const quadTransform =
      params?.quadTransform ?? (params?.flipH && params?.flipV ? "rotate180" : params?.flipH ? "flipH" : params?.flipV ? "flipV" : "identity");
    if (params?.quadPoints) {
      const affine = affineTransformForQuad(params.quadPoints, srcW, srcH);
      this.ctx.transform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
      this.ctx.drawImage(stage.el as DomImageSource, 0, 0, srcW, srcH);
    } else if (params?.quadTransform) {
      this.ctx.translate(destRect.left, destRect.top);
      applyQuadTransform(this.ctx, quadTransform, destRect.width, destRect.height);
      const drawSize = drawSizeForQuadTransform(quadTransform, destRect.width, destRect.height);
      this.ctx.drawImage(stage.el as DomImageSource, 0, 0, srcW, srcH, 0, 0, drawSize.width, drawSize.height);
    } else {
      this.ctx.translate(
        destRect.left + (params?.flipH ? destRect.width : 0),
        destRect.top + (params?.flipV ? destRect.height : 0),
      );
      this.ctx.scale(params?.flipH ? -1 : 1, params?.flipV ? -1 : 1);
      const drawSize = drawSizeForQuadTransform(quadTransform, destRect.width, destRect.height);
      this.ctx.drawImage(stage.el as DomImageSource, 0, 0, srcW, srcH, 0, 0, drawSize.width, drawSize.height);
    }
    this.ctx.restore();
    this.version += 1;
  }

  setPixel(x: number, y: number, color: LingoColor): void {
    if (!this.ctx) return;
    this.clearIndexedSource();
    const pixelColor = resolveColorForPalette(color, this.paletteRef);
    this.enqueueOrRun([], () => {
      if (!this.ctx) return;
      this.ctx.fillStyle = `rgb(${pixelColor.r}, ${pixelColor.g}, ${pixelColor.b})`;
      this.ctx.fillRect(Math.trunc(x), Math.trunc(y), 1, 1);
      this.version += 1;
    });
  }

  getPixel(x: number, y: number): LingoColor {
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (this.indexedSource && px >= 0 && py >= 0 && px < this.width && py < this.height) {
      const paletteIndex = this.indexedSource.indices[py * this.width + px] ?? 0;
      const palette = this.activePaletteColors();
      const rgb = palette?.[paletteIndex] ?? 0;
      return new LingoColor((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff, paletteIndex);
    }
    if (!this.ctx) return new LingoColor(0, 0, 0);
    const data = this.ctx.getImageData(px, py, 1, 1).data;
    const color = new LingoColor(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0);
    color.paletteIndex = this.nearestPaletteIndex(color);
    return color;
  }

  private nearestPaletteIndex(color: LingoColor): number {
    const palette = this.activePaletteColors();
    if (!palette || palette.length === 0) return 0;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < palette.length; index += 1) {
      const rgb = palette[index] ?? 0;
      const red = (rgb >> 16) & 0xff;
      const green = (rgb >> 8) & 0xff;
      const blue = rgb & 0xff;
      const dr = red - color.r;
      const dg = green - color.g;
      const db = blue - color.b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  getPixelAlpha(x: number, y: number): number {
    if (!this.ctx) return 255;
    const data = this.ctx.getImageData(Math.trunc(x), Math.trunc(y), 1, 1).data;
    return data[3] ?? 255;
  }

  isBoundaryConnectedColorPixel(x: number, y: number, color: LingoColor): boolean {
    if (!this.ctx) return false;
    const px = Math.trunc(x);
    const py = Math.trunc(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return false;
    const key = `${color.r},${color.g},${color.b}`;
    let cached = this.boundaryMaskCache.get(key);
    if (!cached || cached.version !== this.version) {
      const data = this.ctx.getImageData(0, 0, this.width, this.height).data;
      cached = {
        version: this.version,
        mask: boundaryConnectedColorMask(data, this.width, this.height, color),
      };
      this.boundaryMaskCache.set(key, cached);
    }
    return cached.mask[py * this.width + px] === 1;
  }

  duplicate(): LingoImage {
    if (this.indexedSource) {
      const copy = LingoImage.fromPaletteIndices(
        this.width,
        this.height,
        this.indexedSource.indices,
        this.indexedSource.fallbackPalette,
        this.paletteRef,
        this.indexedSource.bitDepth,
      );
      copy.useAlpha = this.useAlpha;
      copy.setMatteCoveragePolicy(this.matteCoveragePolicy);
      return copy;
    }
    const copy = new LingoImage(this.width, this.height, this.depth, this.paletteRef, { initWhite: false });
    copy.setMatteCoveragePolicy(this.matteCoveragePolicy);
    if (this.incomplete) {
      // Duplicating a still-decoding image used to freeze a one-shot blank snapshot that
      // never healed. The window clouds duplicate their 8-bit graphics at init and derive
      // a matte from the copy, so a duplicate taken before decode left the clouds
      // permanently flat-white / outline-less (intermittent, decode-vs-init timing). Track
      // the source's completion and re-copy when it finishes — same pattern createMatte()
      // already uses for the same reason.
      copy.pendingFill = true;
      this.onComplete(() => {
        copy.copyPixels(this, this.getRect(), this.getRect(), null);
        copy.pendingFill = false;
        copy.flushIfComplete();
      });
    } else {
      copy.copyPixels(this, this.getRect(), this.getRect(), null);
    }
    return copy;
  }

  /** Director createMask(): preserves the image's mask-ink luminance for
   * #maskImage in copyPixels. Black remains opaque, white transparent. */
  createMask(): LingoImage {
    return this.duplicate();
  }

  /** Director createMatte(): returns a matte object for copyPixels #maskImage.
   * Official Director docs describe this as duplicating Matte ink and deriving
   * from the source alpha layer. If no alpha layer is present, the classic
   * Matte-ink outline behavior removes boundary-connected white backing while
   * preserving enclosed white artwork. This is intentionally separate from
   * direct sprite Matte presentation, which still uses its exact/provenance
   * rules at the final compositor boundary. */
  createMatte(): LingoImage {
    const matte = new LingoImage(this.width, this.height, this.depth, this.paletteRef, { initWhite: false });
    if (!matte.ctx) return matte;
    if (this.incomplete) {
      matte.pendingFill = true;
      this.onComplete(() => {
        matte.computeMatteFrom(this);
        matte.pendingFill = false;
        matte.flushIfComplete();
      });
    } else {
      matte.computeMatteFrom(this);
    }
    return matte;
  }

  private computeMatteFrom(source: LingoImage): void {
    if (!this.ctx || !source.el) return;
    this.clearIndexedSource();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(source.el as DomImageSource, 0, 0);
    const sourcePixels = this.ctx.getImageData(0, 0, this.width, this.height).data;
    if (imageHasNonOpaqueAlpha(sourcePixels)) {
      applyAlphaLayerMatteCoverage(this.ctx, this.width, this.height);
    } else {
      switch (source.matteCoveragePolicy) {
        case "edge-connected-dominant-palette-index-transparent":
          applyBoundaryConnectedMatteCoverage(this.ctx, this.width, this.height, null);
          break;
        default:
          applyBoundaryConnectedMatteCoverage(this.ctx, this.width, this.height, WHITE);
          break;
      }
    }
    // Director matte masks use black as opaque coverage.
    const image = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = image.data;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3]! > 0) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 255;
      }
    }
    this.ctx.putImageData(image, 0, 0);
    this.version += 1;
  }

  getRect(): LingoRect {
    return new LingoRect(0, 0, this.width, this.height);
  }

  /** image.useAlpha — accepted and tracked; canvas pixels always carry
   * alpha, so this only mirrors the Lingo-visible property. */
  useAlpha: number = 1;

  /** setAlpha(image | int). With an image, the alpha channel follows
   * Director's mask convention (black = opaque, white = transparent);
   * with an integer, alpha is uniform. */
  setAlpha(alpha: LingoImage | number): void {
    if (!this.ctx) return;
    this.clearIndexedSource();
    this.enqueueOrRun(typeof alpha === "number" ? [] : [alpha], () => {
      this.applyAlpha(alpha);
    });
  }

  private applyAlpha(alpha: LingoImage | number): void {
    if (!this.ctx) return;
    const image = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = image.data;
    if (typeof alpha === "number") {
      const value = Math.max(0, Math.min(255, Math.trunc(alpha)));
      for (let offset = 3; offset < data.length; offset += 4) {
        data[offset] = value;
      }
    } else {
      if (!alpha.el || !alpha.context) return;
      const staged = createCanvas(this.width, this.height);
      if (!staged.ctx) return;
      staged.ctx.drawImage(alpha.el as DomImageSource, 0, 0);
      const maskData = staged.ctx.getImageData(0, 0, this.width, this.height).data;
      for (let offset = 0; offset < data.length; offset += 4) {
        const maskAlpha = maskData[offset + 3]!;
        if (maskAlpha === 0) {
          data[offset + 3] = 0;
          continue;
        }
        const luminance = (maskData[offset]! + maskData[offset + 1]! + maskData[offset + 2]!) / 3;
        data[offset + 3] = Math.round((maskAlpha * (255 - luminance)) / 255);
      }
    }
    this.ctx.putImageData(image, 0, 0);
    this.version += 1;
  }

  /** trimWhiteSpace(): the image cropped to its non-white, non-transparent
   * bounding box (Common Button uses it to fit button face artwork). */
  trimWhiteSpace(): LingoImage {
    if (!this.ctx) return this;
    const image = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = image.data;
    let left = this.width;
    let top = this.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const offset = (y * this.width + x) * 4;
        const opaque = data[offset + 3]! > 0;
        const white = data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255;
        if (opaque && !white) {
          if (x < left) left = x;
          if (y < top) top = y;
          if (x > right) right = x;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (right < left || bottom < top) return this;
    const cropped = new LingoImage(right - left + 1, bottom - top + 1, this.depth, this.paletteRef, {
      initWhite: false,
    });
    cropped.copyPixels(this, cropped.getRect(), new LingoRect(left, top, right + 1, bottom + 1), null);
    return cropped;
  }

  lingoToString(): string {
    return `(image ${this.width} x ${this.height})`;
  }
}

/** A drawable image source type usable in either environment. */
export type CanvasImageSource = unknown;

export function isLingoImage(value: LingoValue): value is LingoImage {
  return value instanceof LingoImage;
}
