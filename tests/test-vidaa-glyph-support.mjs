// VIDAA glyph support: a simulated canvas decides which samples draw, so the
// native check, the bundled-font path and the text fallback run without a TV.
import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: "" };
const {
  GLYPH_SAMPLES,
  rendersGlyph,
  startVidaaGlyphSupport,
  getVidaaGlyphSupport,
  _resetVidaaGlyphSupportForTests
} = await import("../js/platform/vidaa/vidaaGlyphSupport.js");
const { readableStreamText, readableStreamHeadline } =
  await import("../js/core/streams/streamDisplayText.js");

const MISSING = "\u{10FFFD}";

// drawable(text, font) -> true when the simulated TV has a glyph for it.
// Without a glyph every code point draws the same missing-glyph box, so a
// two-code-point flag draws two boxes (as in Chromium).
function fakeCanvas(drawable) {
  let last = { text: "", font: "" };
  const ctx = {
    font: "",
    clearRect() {},
    fillText(text) {
      last = { text, font: ctx.font };
    },
    getImageData() {
      const data = new Uint8ClampedArray(48 * 48 * 4);
      const codePoints = [...last.text];
      const ok = !codePoints.includes(MISSING) && drawable(last.text, last.font);
      if (ok) {
        // A real glyph: pixels unique to the text.
        const pixel = 100 + (codePoints[0].codePointAt(0) % 100);
        data[pixel * 4] = 200;
        data[pixel * 4 + 3] = 255;
      } else {
        // One box per code point.
        for (let box = 0; box < codePoints.length; box++) data[box * 40 + 3] = 255;
      }
      return { data };
    }
  };
  return { getContext: () => ctx };
}

function fakeDocument() {
  const classes = new Set();
  return {
    classes,
    documentElement: {
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c)
      }
    }
  };
}

const allSamples = Object.values(GLYPH_SAMPLES).flat();

// The comparison itself: a sample that draws differs from the box.
assert.equal(
  rendersGlyph(
    fakeCanvas(() => true),
    "\u{1F600}"
  ),
  true
);
assert.equal(
  rendersGlyph(
    fakeCanvas(() => false),
    "\u{1F600}"
  ),
  false
);
assert.equal(
  rendersGlyph({ getContext: () => null }, "\u{1F600}"),
  false,
  "no 2D context: unsupported"
);
// Regression: a flag without a flag font draws two boxes and must not count
// as drawn just because two boxes differ from one.
assert.equal(
  rendersGlyph(
    fakeCanvas(() => false),
    "\u{1F1E9}\u{1F1EA}"
  ),
  false
);
assert.equal(
  rendersGlyph(
    fakeCanvas(() => true),
    "\u{1F1E9}\u{1F1EA}"
  ),
  true
);
assert.equal(
  rendersGlyph(
    {
      getContext: () => {
        throw new Error("blocked");
      }
    },
    "x"
  ),
  false
);

// 1. A TV that draws everything itself: no fonts, no class.
{
  _resetVidaaGlyphSupportForTests();
  const doc = fakeDocument();
  const loads = [];
  const support = await startVidaaGlyphSupport({
    doc,
    fonts: { load: (font, text) => loads.push([font, text]) },
    createCanvas: () => fakeCanvas(() => true)
  });
  assert.deepEqual(support, { emoji: true, flags: true, symbols: true, letters: true });
  assert.equal(doc.classes.size, 0);
  assert.deepEqual(loads, []);
}

// 2. Nothing native, the bundled fonts draw emoji, flags and symbols. Decorated
// letters have no bundled font and stay folded to plain text.
{
  _resetVidaaGlyphSupportForTests();
  const doc = fakeDocument();
  const loads = [];
  const support = await startVidaaGlyphSupport({
    doc,
    fonts: { load: async (font, text) => loads.push([font, text]) },
    createCanvas: () =>
      fakeCanvas((text, font) => font.includes("Nuvio") && !GLYPH_SAMPLES.letters.includes(text))
  });
  assert.deepEqual(support, { emoji: true, flags: true, symbols: true, letters: false });
  assert.ok(doc.classes.has("vidaa-glyph-fonts"), "the font stack gets the bundled families");
  const families = new Set(loads.map(([font]) => font.replace(/^32px /, "")));
  assert.deepEqual([...families].sort(), [
    '"Nuvio Emoji"',
    '"Nuvio Symbols Extra"',
    '"Nuvio Symbols"'
  ]);
  assert.ok(loads.every(([, text]) => allSamples.includes(text)));
  assert.deepEqual(getVidaaGlyphSupport(), support);
}

// 3. Fonts that do not help (old engine, blocked download): text fallback, and
// the class is removed so no further downloads start.
{
  _resetVidaaGlyphSupportForTests();
  const doc = fakeDocument();
  const support = await startVidaaGlyphSupport({
    doc,
    fonts: { load: async () => Promise.reject(new Error("network")) },
    createCanvas: () => fakeCanvas(() => false)
  });
  assert.deepEqual(support, { emoji: false, flags: false, symbols: false, letters: false });
  assert.equal(doc.classes.has("vidaa-glyph-fonts"), false);
}

// 4. No canvas at all: everything falls back to text.
{
  _resetVidaaGlyphSupportForTests();
  const support = await startVidaaGlyphSupport({ doc: fakeDocument(), createCanvas: () => null });
  assert.deepEqual(support, { emoji: false, flags: false, symbols: false, letters: false });
}

// Labels follow the reported support; platforms that report none keep them.
const label = "\u{1F5E3} IT | \u{1F1EC}\u{1F1E7} EN ★ ♬ AAC \u{1D405}\u{1D407}\u{1D403}";
const env = (glyphs, { webos = false } = {}) => ({
  getGlyphSupport: () => glyphs,
  isWebOS: () => webos
});
assert.equal(readableStreamText(label, env(null)), label, "no glyph report: unchanged");
assert.equal(readableStreamText(label, null), label);
assert.equal(
  readableStreamText(label, env({ emoji: true, flags: true, symbols: true, letters: false })),
  "\u{1F5E3} IT | \u{1F1EC}\u{1F1E7} EN ★ ♬ AAC FHD"
);
assert.equal(
  readableStreamText(label, env({ emoji: false, flags: false, symbols: false, letters: false })),
  "IT | [GB] EN * AAC FHD"
);
assert.equal(
  readableStreamHeadline(label, env(null, { webos: true })),
  label.replace("\u{1D405}\u{1D407}\u{1D403}", "FHD")
);

// Environment reports glyph support only on VIDAA.
for (const [platform, expectReport] of [
  ["vidaa", true],
  ["tizen", false],
  ["webos", false],
  ["browser", false]
]) {
  globalThis.__NUVIO_PLATFORM__ = platform;
  const { Platform } = await import("../js/platform/index.js");
  Platform.current = null;
  const { Environment } = await import("../js/platform/environment.js");
  assert.equal(Environment.getGlyphSupport() !== null, expectReport, platform);
}

console.log(
  "VIDAA glyph support checks passed: native, bundled fonts, text fallback, no canvas, platform isolation."
);
