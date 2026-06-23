// Measures the Volter Goldfish webfont's canvas metrics at the sizes the
// release306 source uses, so the text rasterizer can place baselines and
// advances pixel-exactly. Loads the dev page only for its @font-face.
//
//   node tools/dev/font-metrics-probe.mjs [url]
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5174/?fastVisual=1&fastEntry=1";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 200 } });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const metrics = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('9px "Volter Goldfish"'),
      document.fonts.load('bold 9px "Volter Goldfish"'),
    ]);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const sample = (font, text) => {
      ctx.font = font;
      const m = ctx.measureText(text);
      return {
        width: m.width,
        fontAscent: m.fontBoundingBoxAscent,
        fontDescent: m.fontBoundingBoxDescent,
        actualAscent: m.actualBoundingBoxAscent,
        actualDescent: m.actualBoundingBoxDescent,
      };
    };
    const out = {};
    for (const font of ['9px "Volter Goldfish"', 'bold 9px "Volter Goldfish"', '10px "Volter Goldfish"']) {
      out[font] = {
        Mg: sample(font, "Mg"),
        xHeight: sample(font, "x"),
        caps: sample(font, "HELLO"),
        descenders: sample(font, "gjpqy"),
        sentence: sample(font, "Create one here"),
        perChar: Object.fromEntries(
          [..."Create onhrils "].map((c) => [c === " " ? "space" : c, sample(font, c).width]),
        ),
      };
    }
    return out;
  });
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}
