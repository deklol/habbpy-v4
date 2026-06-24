import { Assets, Container, Graphics, Sprite, Text, Texture, TilingSprite } from "pixi.js";
import { LingoColor, LingoRect } from "../director/geometry";
import { SpriteChannel } from "../director/sprites";
import { LingoImage } from "../director/imaging";
import { paletteColor } from "../director/palettes";
import { LingoSymbol, type LingoValue } from "../director/values";
import {
  bitmapUrlForInk,
  boundaryConnectedDominantBorderMask,
  boundaryConnectedWhiteMask,
  applyDirectorMaskCoveragePixels,
  bufferSpriteInkUsesColorKey,
  bufferSpriteInkUsesBoundaryWhiteCoverage,
  bufferSpriteInkUsesDirectorMask,
  bufferSpriteInkUsesMatteCoverage,
  bufferSpriteInkUsesMultiplyTint,
  directBitmapInkNeedsRuntimePixels,
  directBitmapInkIsInvisibleHitProxy,
  directBitmapInkRequiresPixelProcessing,
  directBitmapInkUsesSpriteProcessing,
  directorSpriteTintForDirectBitmap,
  processedDirectBitmapInkUsesGpuTint,
  subtractInkSourceIsNoop,
} from "./ink";

type StageNode = Sprite | Graphics | TilingSprite | TextFieldNode;

export interface UserNameLabel {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RoomStagePresentation {
  readonly scale: number;
  readonly originX: number;
  readonly originY: number;
  readonly channels: ReadonlySet<number>;
}

export interface PresentationUnderlay {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: number;
  readonly textureUrl?: string;
}

export interface CustomHotelViewPresentation {
  readonly active: boolean;
  readonly backgroundUrl: string;
  readonly stageUrl: string;
  readonly bannerUrl: string;
  readonly backgroundX: number;
  readonly backgroundY: number;
  readonly stageX: number;
  readonly stageY: number;
  readonly bannerX: number;
  readonly bannerY: number;
}

interface TextFieldNode extends Container {
  __textNode: Sprite;
  __caretNode: Graphics;
}

interface UserNameLabelNode extends Container {
  __outlineNodes: Text[];
  __fillNode: Text;
  __labelText: string;
}

/**
 * Pixi presenter for Director sprite channels. Pure consumer: reads channel
 * state each sync and mirrors it into Pixi display objects. Director
 * semantics (loc = where the member's regPoint lands; channel z-order with
 * locZ override) are applied here. Generated ink-specific asset variants are
 * selected for direct bitmap sprites; image/copyPixels semantics stay in the
 * Director image layer.
 */
export class StageRenderer {
  private readonly root = new Container();
  private readonly views = new Map<number, { node: StageNode; key: string }>();
  private readonly underlays = new Map<string, Graphics | TilingSprite>();
  private readonly customHotelViewNodes = new Map<string, Sprite>();
  private readonly userNameLabelNodes = new Map<string, UserNameLabelNode>();
  private readonly textures = new Map<string, Texture | "loading" | "failed">();
  private readonly imageTextures = new Map<LingoImage, { texture: Texture; version: number; el: unknown }>();
  /** Ink-processed buffer textures: image -> "ink:backColor" -> a persistent
   * scratch canvas + texture pair that is reprocessed in place (no per-frame
   * canvas/texture allocation). */
  private readonly inkTextures = new WeakMap<
    LingoImage,
    Map<
      string,
      {
        canvas: HTMLCanvasElement;
        ctx: CanvasRenderingContext2D;
        texture: Texture | null;
        version: number;
        maskVersion: number;
      }
    >
  >();
  private readonly imageIds = new WeakMap<LingoImage, number>();
  private nextImageId = 1;
  private dirty = true;
  private customHotelView: CustomHotelViewPresentation | null = null;
  private suppressedChannels = new Set<number>();
  private roomStagePresentation: RoomStagePresentation | null = null;
  private roomStagePresentationSignature = "";

  constructor(stage: Container) {
    this.root.sortableChildren = true;
    stage.addChild(this.root);
  }

  setPresentationUnderlays(underlays: readonly PresentationUnderlay[]): void {
    const seen = new Set<string>();
    for (const underlay of underlays) {
      seen.add(underlay.id);
      const texture = underlay.textureUrl ? this.textureFor(underlay.textureUrl) : null;
      let node = this.underlays.get(underlay.id);
      if (texture && !(node instanceof TilingSprite)) {
        node?.destroy();
        node = new TilingSprite({
          texture,
          width: Math.max(1, Math.round(underlay.width)),
          height: Math.max(1, Math.round(underlay.height)),
          roundPixels: true,
        });
        node.zIndex = -19_999_999;
        this.root.addChild(node);
        this.underlays.set(underlay.id, node);
      } else if (!texture && !(node instanceof Graphics)) {
        node?.destroy();
        node = new Graphics();
        this.configurePixelNode(node);
        // Above the stage cover, below all normal source-owned UI sprites.
        node.zIndex = -19_999_999;
        this.root.addChild(node);
        this.underlays.set(underlay.id, node);
      }
      if (!node) continue;
      node.x = Math.round(underlay.x);
      node.y = Math.round(underlay.y);
      if (node instanceof TilingSprite) {
        if (texture) node.texture = texture;
        node.width = Math.max(1, Math.round(underlay.width));
        node.height = Math.max(1, Math.round(underlay.height));
      } else {
        node.clear();
        node.rect(0, 0, Math.max(1, Math.round(underlay.width)), Math.max(1, Math.round(underlay.height)));
        node.fill(underlay.color);
      }
    }
    for (const [id, node] of this.underlays) {
      if (seen.has(id)) continue;
      node.destroy();
      this.underlays.delete(id);
    }
  }

  setCustomHotelView(presentation: CustomHotelViewPresentation | null): void {
    if (this.sameCustomHotelViewPresentation(this.customHotelView, presentation)) return;
    this.customHotelView = presentation?.active ? presentation : null;
    if (!this.customHotelView) {
      for (const node of this.customHotelViewNodes.values()) {
        node.destroy();
      }
      this.customHotelViewNodes.clear();
    }
    this.markDirty();
  }

  setSuppressedChannels(channels: ReadonlySet<number>): void {
    if (this.sameNumberSet(this.suppressedChannels, channels)) return;
    this.suppressedChannels = new Set(channels);
    this.markDirty();
  }

  setRoomStagePresentation(presentation: RoomStagePresentation | null): void {
    const normalized =
      presentation && presentation.scale > 1 && presentation.channels.size > 0
        ? {
            scale: presentation.scale,
            originX: presentation.originX,
            originY: presentation.originY,
            channels: new Set(presentation.channels),
          }
        : null;
    const signature = this.roomStagePresentationKey(normalized);
    if (signature === this.roomStagePresentationSignature) return;
    this.roomStagePresentation = normalized;
    this.roomStagePresentationSignature = signature;
    this.markDirty();
  }

  setUserNameLabels(labels: readonly UserNameLabel[]): void {
    const seen = new Set<string>();
    for (const label of labels) {
      const id = String(label.id || label.name);
      const text = String(label.name || "").trim();
      if (!id || !text) continue;
      seen.add(id);
      let node = this.userNameLabelNodes.get(id);
      if (!node) {
        node = this.createUserNameLabelNode(text);
        this.root.addChild(node);
        this.userNameLabelNodes.set(id, node);
      }
      if (node.__labelText !== text) this.updateUserNameLabelText(node, text);
      const point = this.transformRoomPoint(label.x, label.y + 15);
      node.x = Math.round(point.x);
      node.y = Math.round(point.y);
      node.zIndex = userNameLabelZIndex(label.z);
      node.visible = true;
    }

    for (const [id, node] of this.userNameLabelNodes) {
      if (seen.has(id)) continue;
      node.destroy();
      this.userNameLabelNodes.delete(id);
    }
  }

  markDirty(): void {
    this.dirty = true;
  }

  needsSync(): boolean {
    return this.dirty;
  }

  sync(channels: SpriteChannel[], focusedSprite = 0): void {
    // Always re-sync: composited image buffers mutate in place without a
    // sprite-property change, so dirty-only syncing would miss them.
    this.dirty = false;
    const seen = new Set<number>();
    this.syncCustomHotelViewNodes();

    for (const channel of channels) {
      if (this.suppressedChannels.has(channel.number)) continue;
      const member = channel.member;
      const shouldShow = channel.puppet === 1 && channel.visible === 1 && member !== null;
      if (!shouldShow) continue;
      if (
        directBitmapInkIsInvisibleHitProxy(
          channel.ink,
          member!.bitmap?.width,
          member!.bitmap?.height,
        )
      ) {
        continue;
      }
      if (this.shouldSkipNoopSubtractSprite(channel)) continue;

      // 1. Member backed by a runtime image buffer (composited windows).
      // Decoded direct bitmaps can also use this path when the sprite ink
      // needs Director matte/color-key/tint semantics that depend on channel
      // state rather than only on a pre-generated asset URL. While the decode
      // is still in flight the PNG ink-variant path below renders instead of
      // a blank placeholder.
      const canProcessDirectBitmapInk =
        !member!.image &&
        !!member!.bitmap?.pngUrl &&
        this.shouldProcessDirectBitmapInk(channel.ink);
      const directBitmap = canProcessDirectBitmapInk ? member!.bitmap! : null;
      const hasPreprocessedDirectInk =
        !!directBitmap &&
        this.hasPreprocessedInkBitmap(directBitmap, channel.ink);
      const needsDirectPixelInk =
        canProcessDirectBitmapInk &&
        this.preferDecodedDirectBitmapInk(channel.ink, member!.name, channel.blend);
      const needsRuntimeDirectInk =
        canProcessDirectBitmapInk &&
        directBitmapInkNeedsRuntimePixels(channel.ink, member!.name, channel.blend, hasPreprocessedDirectInk);
      const directBitmapBuffer =
        needsRuntimeDirectInk
          ? needsDirectPixelInk
            ? member!.effectiveImage()
            : (directBitmap?.decoded && !directBitmap.decoded.incomplete ? directBitmap.decoded : null)
          : null;
      const buffer = member!.image ?? directBitmapBuffer ?? (!member!.bitmap?.pngUrl ? (member!.bitmap?.decoded ?? null) : null);
      const maskImage = channel.ink === 9 ? this.directorMaskImageFor(member!) : null;
      if (needsDirectPixelInk && directBitmapBuffer?.incomplete) continue;
      if (maskImage?.incomplete) continue;
      if (buffer) {
        const texture = this.inkProcessedTexture(
          buffer,
          channel.ink,
          channel.foreColor,
          channel.backColor,
          channel.bgColor,
          member!.image === buffer,
          maskImage,
        );
        if (!texture) continue;
        seen.add(channel.number);
        const key = `img:${channel.number}`;
        let view = this.views.get(channel.number);
        if (!view || !(view.node instanceof Sprite)) {
          view?.node.destroy();
          const node = new Sprite(texture);
          this.configurePixelNode(node);
          this.root.addChild(node);
          view = { node, key };
          this.views.set(channel.number, view);
        }
        const node = view.node as Sprite;
        node.scale.set(1, 1);
        node.texture = texture;
        if (channel.width > 0) node.width = channel.width;
        if (channel.height > 0) node.height = channel.height;
        this.applyChannelInkState(
          node,
          channel,
          directBitmapBuffer !== null && processedDirectBitmapInkUsesGpuTint(channel.ink),
        );
        this.applySpriteNodeState(node, channel, channel.locH, channel.locV, member!.regX, member!.regY);
        continue;
      }

      if (member!.bitmap && member!.bitmap.pngUrl) {
        const bitmap = member!.bitmap;
        const needsDecodedInk = this.preferDecodedDirectBitmapInk(channel.ink, member!.name, channel.blend);
        if (
          this.shouldProcessDirectBitmapInk(channel.ink) &&
          !bitmap.decoded &&
          (needsDecodedInk || !this.hasPreprocessedInkBitmap(bitmap, channel.ink))
        ) {
          // Ask the Director member layer to decode pixels so sprite-level ink
          // can be applied from the actual source bitmap. This is mandatory
          // for Matte: generated variants can only guess at coverage, while
          // native Director keeps member pixels and channel ink as separate
          // compositor inputs until presentation time.
          member!.effectiveImage();
        }
        if (needsDecodedInk && bitmap.decoded?.incomplete) continue;
        const url = bitmapUrlForInk(bitmap, channel.ink);
        if (!url) continue;
        const key = `bmp:${url}`;
        const texture = this.textureFor(url);
        if (!texture) continue; // still loading; next sync shows it
        seen.add(channel.number);
        let view = this.views.get(channel.number);
        if (!view || view.key !== key || !(view.node instanceof Sprite)) {
          view?.node.destroy();
          const node = new Sprite(texture);
          this.configurePixelNode(node);
          this.root.addChild(node);
          view = { node, key };
          this.views.set(channel.number, view);
        }
        const node = view.node as Sprite;
        node.scale.set(1, 1);
        node.texture = texture;
        if (channel.width > 0) node.width = channel.width;
        if (channel.height > 0) node.height = channel.height;
        this.applyChannelInkState(node, channel, true);
        this.applySpriteNodeState(node, channel, channel.locH, channel.locV, member!.regX, member!.regY);
      } else if (member!.type === "shape") {
        const width = Math.max(1, channel.width);
        const height = Math.max(1, channel.height);
        const fill = this.colorValue(channel.color, 0xffffff);
        const key = `shape:${width}x${height}:${fill.toString(16)}`;
        seen.add(channel.number);
        let view = this.views.get(channel.number);
        if (!view || view.key !== key || !(view.node instanceof Graphics)) {
          view?.node.destroy();
          const node = new Graphics();
          this.configurePixelNode(node);
          node.rect(0, 0, width, height);
          node.fill(fill);
          this.root.addChild(node);
          view = { node, key };
          this.views.set(channel.number, view);
        }
        view.node.scale.set(1, 1);
        this.applyNodeState(view.node, channel, channel.locH, channel.locV);
      } else if (member!.type === "field" || member!.type === "text") {
        const image = member!.presentationImage;
        if (!image) continue;
        const texture = this.imageTextureFor(image);
        if (!texture) continue;
        const editable =
          channel.editable === 1 || Number(member!.style.get("editable") ?? 0) === 1;
        const focused = channel.number === focusedSprite && editable;
        const fill = this.textFill(member!.style.get("color"));
        const key = `txtimg:${image.width}x${image.height}:${image.version}`;
        seen.add(channel.number);
        let view = this.views.get(channel.number);
        if (!view || !this.isTextFieldNode(view.node)) {
          view?.node.destroy();
          const node = new Container() as TextFieldNode;
          const textNode = new Sprite(texture);
          const caretNode = new Graphics();
          node.__textNode = textNode;
          node.__caretNode = caretNode;
          this.configurePixelNode(node);
          this.configurePixelNode(textNode);
          this.configurePixelNode(caretNode);
          node.addChild(textNode, caretNode);
          this.root.addChild(node);
          view = { node, key };
          this.views.set(channel.number, view);
        }
        const node = view.node as TextFieldNode;
        const textNode = node.__textNode;
        if (view.key !== key) {
          textNode.texture = texture;
          view.key = key;
        }
        node.scale.set(1, 1);
        this.drawCaret(node.__caretNode, member!.presentationCaretLoc, fill, focused);
        this.applyNodeState(node, channel, channel.locH, channel.locV);
      }
    }

    for (const [number, view] of this.views) {
      if (!seen.has(number)) {
        view.node.destroy();
        this.views.delete(number);
      }
    }
  }

  private syncCustomHotelViewNodes(): void {
    const presentation = this.customHotelView;
    if (!presentation) return;
    this.syncCustomHotelViewSprite("background", presentation.backgroundUrl, presentation.backgroundX, presentation.backgroundY, -30_000_000);
    this.syncCustomHotelViewSprite("stage", presentation.stageUrl, presentation.stageX, presentation.stageY, -29_999_999);
    this.syncCustomHotelViewSprite("banner", presentation.bannerUrl, presentation.bannerX, presentation.bannerY, -29_999_998);
  }

  private syncCustomHotelViewSprite(id: string, url: string, x: number, y: number, zIndex: number): void {
    const texture = this.textureFor(url);
    if (!texture) return;
    let node = this.customHotelViewNodes.get(id);
    if (!node) {
      node = new Sprite(texture);
      this.configurePixelNode(node);
      node.zIndex = zIndex;
      this.root.addChild(node);
      this.customHotelViewNodes.set(id, node);
    }
    node.texture = texture;
    node.x = Math.round(x);
    node.y = Math.round(y);
    node.scale.set(1, 1);
    node.alpha = 1;
    node.visible = true;
    node.zIndex = zIndex;
  }

  private roomStagePresentationKey(presentation: RoomStagePresentation | null): string {
    if (!presentation) return "";
    return [
      presentation.scale,
      Math.round(presentation.originX),
      Math.round(presentation.originY),
      [...presentation.channels].sort((left, right) => left - right).join(","),
    ].join("|");
  }

  private roomPresentationScaleFor(channelNumber: number): number {
    const presentation = this.roomStagePresentation;
    return presentation && presentation.channels.has(channelNumber) ? presentation.scale : 1;
  }

  private transformRoomPoint(x: number, y: number): { x: number; y: number } {
    const presentation = this.roomStagePresentation;
    if (!presentation) return { x, y };
    return {
      x: presentation.originX + (x - presentation.originX) * presentation.scale,
      y: presentation.originY + (y - presentation.originY) * presentation.scale,
    };
  }

  private transformChannelPoint(channel: SpriteChannel, x: number, y: number): { x: number; y: number } {
    const presentation = this.roomStagePresentation;
    if (!presentation || !presentation.channels.has(channel.number)) return { x, y };
    return {
      x: presentation.originX + (x - presentation.originX) * presentation.scale,
      y: presentation.originY + (y - presentation.originY) * presentation.scale,
    };
  }

  private createUserNameLabelNode(text: string): UserNameLabelNode {
    const node = new Container() as UserNameLabelNode;
    node.sortableChildren = true;
    node.__labelText = text;
    node.__outlineNodes = [];
    const offsets = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ] as const;
    for (const [x, y] of offsets) {
      const outline = this.createUserNameLabelText(text, "#000000");
      outline.x = x;
      outline.y = y;
      outline.zIndex = 0;
      node.addChild(outline);
      node.__outlineNodes.push(outline);
    }
    node.__fillNode = this.createUserNameLabelText(text, "#ffffff");
    node.__fillNode.zIndex = 1;
    node.addChild(node.__fillNode);
    return node;
  }

  private createUserNameLabelText(text: string, fill: string): Text {
    const node = new Text({
      text,
      style: {
        fontFamily: '"Volter Goldfish", Goldfish, Volter, Arial, sans-serif',
        fontSize: 9,
        fill,
        align: "center",
        padding: 2,
      },
    });
    node.anchor.set(0.5, 1);
    node.resolution = 1;
    node.roundPixels = true;
    return node;
  }

  private updateUserNameLabelText(node: UserNameLabelNode, text: string): void {
    node.__labelText = text;
    node.__fillNode.text = text;
    for (const outline of node.__outlineNodes) {
      outline.text = text;
    }
  }

  private sameCustomHotelViewPresentation(
    left: CustomHotelViewPresentation | null,
    right: CustomHotelViewPresentation | null,
  ): boolean {
    const normalizedRight = right?.active ? right : null;
    if (!left || !normalizedRight) return left === normalizedRight;
    return (
      left.backgroundUrl === normalizedRight.backgroundUrl &&
      left.stageUrl === normalizedRight.stageUrl &&
      left.bannerUrl === normalizedRight.bannerUrl &&
      left.backgroundX === normalizedRight.backgroundX &&
      left.backgroundY === normalizedRight.backgroundY &&
      left.stageX === normalizedRight.stageX &&
      left.stageY === normalizedRight.stageY &&
      left.bannerX === normalizedRight.bannerX &&
      left.bannerY === normalizedRight.bannerY
    );
  }

  private sameNumberSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
    if (left.size !== right.size) return false;
    for (const value of left) {
      if (!right.has(value)) return false;
    }
    return true;
  }

  /** Director sprite-level ink for a buffer-backed sprite. Buffers are
   * white-initialized like Director images; Matte (8) removes coverage,
   * Background Transparent (36) keys the sprite's backColor (palette index,
   * default 0 = white), Darken (41) applies Director's fixed-point
   * background-colour filter plus foreground offset, and Add Pin (33) keys
   * then adds (the additive half is the node blend mode). Runtime image
   * buffers use boundary-connected white as the absent-background coverage
   * recovery so closed white artwork drawn into a buffer survives; direct
   * bitmap sources keep the recovered native exact-white Matte behavior.
   * Processed pixels are cached per image+ink+effective colour state and
   * refreshed when the buffer mutates. */
  private inkProcessedTexture(
    image: LingoImage,
    ink: number,
    foreColor: number,
    backColor: number,
    spriteBgColor: LingoValue,
    runtimeImageBuffer = false,
    maskImage: LingoImage | null = null,
  ): Texture | null {
    if (ink !== 8 && ink !== 9 && ink !== 36 && ink !== 41 && ink !== 33) {
      return this.imageTextureFor(image);
    }
    const el = image.el;
    if (!el) return null;
    if (bufferSpriteInkUsesDirectorMask(ink) && !maskImage) {
      return this.imageTextureFor(image);
    }
    if (maskImage?.incomplete) return null;
    const maskEl = maskImage?.el ?? null;
    if (bufferSpriteInkUsesDirectorMask(ink) && !maskEl) return null;
    let byInk = this.inkTextures.get(image);
    if (!byInk) {
      byInk = new Map();
      this.inkTextures.set(image, byInk);
    }
    const bg = spriteBgColor instanceof LingoColor
      ? spriteBgColor
      : paletteColor("systemMac", backColor);
    const fg = paletteColor("systemMac", foreColor);
    const maskId = maskImage ? this.imageId(maskImage) : 0;
    const maskVersion = maskImage?.version ?? -1;
    const key = `${ink}:${runtimeImageBuffer ? "runtime" : "decoded"}:${bg.r},${bg.g},${bg.b}:${fg.r},${fg.g},${fg.b}:mask:${maskId}`;
    let entry = byInk.get(key);
    if (entry) {
      if (entry.version === image.version && entry.maskVersion === maskVersion) return entry.texture;
      // Mid-load buffers mutate on every journal replay; reprocessing the
      // full-image matte/key per mutation is the room-entry CPU killer.
      // Show the last processed state and reprocess once the image settles.
      if (image.incomplete || maskImage?.incomplete) return entry.texture;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      entry = { canvas, ctx, texture: null, version: -1, maskVersion: -1 };
      byInk.set(key, entry);
    }

    const { canvas, ctx } = entry;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(el as CanvasImageSource & { width: number }, 0, 0);
    if (bufferSpriteInkUsesDirectorMask(ink) && maskEl) {
      this.applyDirectorMaskCoverage(ctx, canvas.width, canvas.height, maskEl as CanvasImageSource);
    }
    if (bufferSpriteInkUsesMatteCoverage(ink)) {
      const mattePolicy = image.matteCoveragePolicyForDebug();
      if (
        bufferSpriteInkUsesBoundaryWhiteCoverage(ink, runtimeImageBuffer) ||
        mattePolicy === "edge-connected-white-transparent"
      ) {
        this.applyBoundaryWhiteCoverage(ctx, canvas.width, canvas.height);
      } else if (mattePolicy === "edge-connected-dominant-palette-index-transparent") {
        this.applyBoundaryDominantCoverage(ctx, canvas.width, canvas.height);
      } else {
        this.applyMatteCoverage(ctx, canvas.width, canvas.height);
      }
    }
    if (bufferSpriteInkUsesColorKey(ink)) {
      this.colorKey(ctx, canvas.width, canvas.height, bg.r, bg.g, bg.b);
    }
    if (bufferSpriteInkUsesMultiplyTint(ink)) {
      this.applyDarkenColorFilter(ctx, canvas.width, canvas.height, bg, fg);
    }
    if (entry.texture) {
      entry.texture.source.update();
    } else {
      entry.texture = Texture.from(canvas);
      entry.texture.source.scaleMode = "nearest";
    }
    entry.version = image.version;
    entry.maskVersion = maskVersion;
    return entry.texture;
  }

  private shouldProcessDirectBitmapInk(ink: number): boolean {
    return directBitmapInkUsesSpriteProcessing(ink);
  }

  private shouldSkipNoopSubtractSprite(channel: SpriteChannel): boolean {
    if (channel.ink !== 35 && channel.ink !== 38) return false;
    const image = channel.member?.image ?? channel.member?.bitmap?.decoded ?? null;
    if (!image || image.incomplete || image.width !== 1 || image.height !== 1) return false;
    return subtractInkSourceIsNoop(channel.ink, image.getPixel(0, 0));
  }

  private preferDecodedDirectBitmapInk(ink: number, memberName: string, blend: number): boolean {
    return directBitmapInkRequiresPixelProcessing(ink, memberName, blend);
  }

  private hasPreprocessedInkBitmap(bitmap: { pngUrl: string | null; inkUrls?: Record<string, string> }, ink: number): boolean {
    const url = bitmapUrlForInk(bitmap, ink);
    return !!url && url !== bitmap.pngUrl;
  }

  private directorMaskImageFor(member: NonNullable<SpriteChannel["member"]>): LingoImage | null {
    const maskMember = member.nextCastMember;
    if (!maskMember || (!maskMember.image && !maskMember.bitmap)) return null;
    return maskMember.effectiveImage();
  }

  private imageId(image: LingoImage): number {
    let id = this.imageIds.get(image);
    if (!id) {
      id = this.nextImageId++;
      this.imageIds.set(image, id);
    }
    return id;
  }

  private colorKey(ctx: CanvasRenderingContext2D, width: number, height: number, r: number, g: number, b: number): void {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue;
      if (pixels[offset] === r && pixels[offset + 1] === g && pixels[offset + 2] === b) {
        pixels[offset + 3] = 0;
      }
    }
    ctx.putImageData(data, 0, 0);
  }

  private applyDarkenColorFilter(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    scale: LingoColor,
    add: LingoColor,
  ): void {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    const scaleChannel = (value: number): number => (value >= 255 ? 256 : Math.max(0, Math.min(255, Math.trunc(value))));
    const sr = scaleChannel(scale.r);
    const sg = scaleChannel(scale.g);
    const sb = scaleChannel(scale.b);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue;
      pixels[offset] = Math.min(255, ((pixels[offset]! * sr) >> 8) + add.r);
      pixels[offset + 1] = Math.min(255, ((pixels[offset + 1]! * sg) >> 8) + add.g);
      pixels[offset + 2] = Math.min(255, ((pixels[offset + 2]! * sb) >> 8) + add.b);
    }
    ctx.putImageData(data, 0, 0);
  }

  private applyMatteCoverage(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    // Director stage MATTE is native coverage, not an edge flood-fill of
    // visible RGB. For ordinary bitmap sprites the recovered MX 2004 path
    // treats exact white as zero coverage and leaves non-white artwork
    // opaque; mask/matte objects carry their own coverage provenance through
    // LingoImage.copyPixels.
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] === 255 && pixels[offset + 1] === 255 && pixels[offset + 2] === 255) {
        pixels[offset + 3] = 0;
      } else if (pixels[offset + 3]! > 0) {
        pixels[offset + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
  }

  private applyBoundaryWhiteCoverage(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    const mask = boundaryConnectedWhiteMask(pixels, width, height);
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      if (mask[index]) {
        pixels[offset + 3] = 0;
      } else if (pixels[offset + 3]! > 0) {
        pixels[offset + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
  }

  private applyBoundaryDominantCoverage(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const data = ctx.getImageData(0, 0, width, height);
    const pixels = data.data;
    const mask = boundaryConnectedDominantBorderMask(pixels, width, height);
    for (let index = 0; index < mask.length; index += 1) {
      const offset = index * 4;
      if (mask[index]) {
        pixels[offset + 3] = 0;
      } else if (pixels[offset + 3]! > 0) {
        pixels[offset + 3] = 255;
      }
    }
    ctx.putImageData(data, 0, 0);
  }

  private applyDirectorMaskCoverage(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    maskSource: CanvasImageSource,
  ): void {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    maskCtx.clearRect(0, 0, width, height);
    maskCtx.drawImage(maskSource, 0, 0);
    const source = ctx.getImageData(0, 0, width, height);
    const mask = maskCtx.getImageData(0, 0, width, height);
    applyDirectorMaskCoveragePixels(source.data, mask.data, width, height);
    ctx.putImageData(source, 0, 0);
  }

  /** Channel ink state that maps onto GPU compositing: additive inks blend
   * with 'add'; Subtract/Subtract Pin subtract the foreground RGB from the
   * stage; Darken over a direct PNG tints by the backColor filter (how entry
   * cars and room parts get colors). */
  private applyChannelInkState(node: Sprite, channel: SpriteChannel, directPngTexture: boolean): void {
    node.blendMode =
      channel.ink === 33 || channel.ink === 34
        ? "add"
        : channel.ink === 35 || channel.ink === 38
          ? "subtract"
          : "normal";
    node.tint = directorSpriteTintForDirectBitmap(
      channel.ink,
      directPngTexture,
      channel.backColor,
      channel.bgColor,
    );
  }

  /** Texture for a runtime image buffer, refreshed when the image mutates.
   * One texture per buffer; mutations re-upload the same source (Pixi
   * caches Texture.from by source, so creating new textures would return
   * the stale cached one). Incomplete images (journal replays pending) keep
   * their last upload to avoid per-mutation re-uploads during loading; the
   * completing mutation bumps the version again and refreshes. A changed
   * backing store (decoded drawable collapsed into a canvas) rebuilds the
   * texture outright. */
  private imageTextureFor(image: LingoImage): Texture | null {
    const el = image.el;
    if (!el) return null;
    const cached = this.imageTextures.get(image);
    if (cached && cached.el === el) {
      if (cached.version !== image.version && !image.incomplete) {
        cached.texture.source.update();
        cached.version = image.version;
      }
      return cached.texture;
    }
    if (cached) {
      cached.texture.destroy(true);
      this.imageTextures.delete(image);
    }
    const texture = Texture.from(el as HTMLCanvasElement);
    texture.source.scaleMode = "nearest";
    this.imageTextures.set(image, { texture, version: image.version, el });
    return texture;
  }

  /** Drops cached GPU textures for an image buffer the movie no longer uses
   * (e.g. a text raster replaced by a different-sized one). */
  releaseImage(image: LingoImage): void {
    const cached = this.imageTextures.get(image);
    if (cached) {
      cached.texture.destroy(true);
      this.imageTextures.delete(image);
    }
    const byInk = this.inkTextures.get(image);
    if (byInk) {
      for (const entry of byInk.values()) {
        entry.texture?.destroy(true);
      }
      this.inkTextures.delete(image);
    }
  }

  private applySpriteNodeState(
    node: Sprite,
    channel: SpriteChannel,
    locH: number,
    locV: number,
    pivotX: number,
    pivotY: number,
  ): void {
    // Director loc is the cast member registration point. Pixi's pivot gives
    // the same result for untransformed sprites and keeps rotation/skew around
    // that registration point for mirrored member aliases.
    node.pivot.set(pivotX, pivotY);
    this.applyNodeState(node, channel, locH, locV);
  }

  private applyNodeState(node: StageNode, channel: SpriteChannel, x: number, y: number): void {
    const point = this.transformChannelPoint(channel, x, y);
    node.x = point.x;
    node.y = point.y;
    node.zIndex = channel.locZ;
    node.alpha = channel.blend / 100;
    const aliasMirrorH = this.isAliasMirrorTransform(channel);
    node.rotation = ((aliasMirrorH ? 0 : channel.rotation) * Math.PI) / 180;
    node.skew.set(((aliasMirrorH ? 0 : channel.skew) * Math.PI) / 180, 0);
    const flipH = (channel.flipH ? -1 : 1) * (aliasMirrorH ? -1 : 1);
    const presentationScale = this.roomPresentationScaleFor(channel.number);
    node.scale.x = Math.abs(node.scale.x) * presentationScale * flipH;
    node.scale.y = Math.abs(node.scale.y) * presentationScale * (channel.flipV ? -1 : 1);
  }

  private isAliasMirrorTransform(channel: SpriteChannel): boolean {
    const normalize = (value: number): number => ((Math.round(value) % 360) + 360) % 360;
    return normalize(channel.rotation) === 180 && normalize(channel.skew) === 180;
  }

  private configurePixelNode(node: StageNode): void {
    if ("roundPixels" in node) {
      node.roundPixels = true;
    }
  }

  private isTextFieldNode(node: StageNode): node is TextFieldNode {
    return node instanceof Container && "__textNode" in node && "__caretNode" in node;
  }

  private drawCaret(
    caret: Graphics,
    loc: { x: number; y: number; height: number } | null,
    fill: number,
    visible: boolean,
  ): void {
    caret.clear();
    if (!visible || !loc || Math.floor(Date.now() / 500) % 2 === 1) return;
    const height = Math.max(9, Math.round(loc.height));
    caret.rect(Math.ceil(loc.x) + 1, Math.floor(loc.y), 1, height);
    caret.fill(fill);
  }

  private colorValue(value: unknown, fallback: number): number {
    if (value instanceof LingoColor) return (value.r << 16) | (value.g << 8) | value.b;
    if (typeof value === "number") return value & 0xffffff;
    return fallback;
  }

  private textFill(value: LingoValue | undefined): number {
    if (value instanceof LingoColor) return (value.r << 16) | (value.g << 8) | value.b;
    if (typeof value === "string" && /^#?[0-9a-f]{6}$/i.test(value.trim())) {
      return Number.parseInt(value.trim().replace(/^#/, ""), 16);
    }
    return 0x000000;
  }

  private textureFor(url: string): Texture | null {
    const cached = this.textures.get(url);
    if (cached instanceof Texture) return cached;
    if (cached === "loading" || cached === "failed") return null;
    this.textures.set(url, "loading");
    Assets.load<Texture>(url)
      .then((texture) => {
        texture.source.scaleMode = "nearest";
        this.textures.set(url, texture);
        this.markDirty();
      })
      .catch(() => this.textures.set(url, "failed"));
    return null;
  }
}

export function userNameLabelZIndex(labelZ: number): number {
  return Math.max(0, Math.round(labelZ)) + 1;
}
