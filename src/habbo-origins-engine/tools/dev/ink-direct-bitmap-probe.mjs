// Source-aware renderer probe for direct bitmap sprites whose Director ink
// needs a decoded buffer when no generated ink-variant PNG exists.
//
// Usage:
//   node tools/dev/ink-direct-bitmap-probe.mjs [url] [outPrefix]
//
// Example:
//   node tools/dev/ink-direct-bitmap-probe.mjs http://127.0.0.1:5174 tmp/ink-direct-bitmap

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5174";
const prefix = process.argv[3] ?? "tmp/ink-direct-bitmap";
const hostPath = "tmp/ink-direct-bitmap-probe-host.html";

function writeDataUrlPng(path, dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("invalid data URL");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(dataUrl.slice(comma + 1), "base64"));
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 80, height: 56 } });
  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  writeFileSync(
    hostPath,
    '<!doctype html><meta charset="utf-8"><title>ink-direct-bitmap-probe</title><body></body>\n',
  );
  const origin = new URL(url).origin;
  await page.goto(`${origin}/${hostPath.replace(/\\/g, "/")}`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const result = await page.evaluate(async () => {
    const { StageRenderer } = await import("/src/render/StageRenderer.ts");
    const pixiUrl = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => /\/node_modules\/\.vite\/deps\/pixi__js\.js\?/.test(name));
    if (!pixiUrl) throw new Error("Pixi module URL not found after StageRenderer import");
    const { Application } = await import(pixiUrl);
    const { CastMember, setImageDecodeRequester } = await import("/src/director/members.ts");
    const { LingoImage } = await import("/src/director/imaging.ts");
    const { SpriteChannel } = await import("/src/director/sprites.ts");

    document.body.innerHTML = "";
    document.body.style.margin = "0";
    const app = new Application();
    await app.init({
      width: 80,
      height: 56,
      background: 0x00ff00,
      antialias: false,
      autoDensity: false,
      resolution: 1,
      preserveDrawingBuffer: true,
    });
    app.canvas.style.imageRendering = "pixelated";
    document.body.appendChild(app.canvas);

    const renderer = new StageRenderer(app.stage);
    let decodeRequests = 0;
    setImageDecodeRequester((member) => {
      decodeRequests += 1;
      void (async () => {
        const bitmap = member.bitmap;
        const response = await fetch(bitmap.pngUrl);
        const imageBitmap = await createImageBitmap(await response.blob());
        if (bitmap.decoded) {
          bitmap.decoded.adoptDrawable(imageBitmap);
        } else {
          bitmap.decoded = LingoImage.fromDrawable(imageBitmap, bitmap.width, bitmap.height);
        }
        renderer.markDirty();
      })();
    });

    const member = new CastMember("hh_interface", 648, 504, "controller_icon", "bitmap", {
      bitmap: {
        width: 25,
        height: 31,
        regX: 0,
        regY: 0,
        pngUrl: "/origins-data/assets/external-bitmaps/release306/hh_interface/0504-controller-icon.png",
      },
    });
    const channel = new SpriteChannel(1);
    channel.puppet = 1;
    channel.visible = 1;
    channel.member = member;
    channel.ink = 36;
    channel.backColor = 0;
    channel.locH = 10;
    channel.locV = 10;

    renderer.sync([channel]);
    const start = performance.now();
    while (!(member.bitmap.decoded && !member.bitmap.decoded.incomplete)) {
      if (performance.now() - start > 5000) throw new Error("decode did not complete");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    renderer.sync([channel]);
    app.renderer.render(app.stage);

    const capture = document.createElement("canvas");
    capture.width = app.canvas.width;
    capture.height = app.canvas.height;
    const ctx = capture.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(app.canvas, 0, 0);
    const pixels = ctx.getImageData(10, 10, 25, 31).data;
    let opaqueWhitePixels = 0;
    let opaquePixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3];
      if (alpha > 245) {
        opaquePixels += 1;
        if (pixels[offset] > 245 && pixels[offset + 1] > 245 && pixels[offset + 2] > 245) {
          opaqueWhitePixels += 1;
        }
      }
    }
    const dataUrl = capture.toDataURL("image/png");
    setImageDecodeRequester(null);
    return { decodeRequests, opaquePixels, opaqueWhitePixels, dataUrl };
  });

  writeDataUrlPng(`${prefix}.png`, result.dataUrl);
  const json = {
    decodeRequests: result.decodeRequests,
    opaquePixels: result.opaquePixels,
    opaqueWhitePixels: result.opaqueWhitePixels,
    png: `${prefix}.png`,
  };
  writeFileSync(`${prefix}.json`, `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(`${prefix}-console.log`, consoleLines.join("\n"));
  console.log(JSON.stringify(json, null, 2));
} finally {
  await browser.close();
}
