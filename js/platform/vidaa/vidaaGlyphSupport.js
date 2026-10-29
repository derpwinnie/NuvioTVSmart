// Which label glyphs the VIDAA browser can draw. It ships no emoji or symbol
// font, so addon labels (AIOStreams icons, flags, emoji) would render as boxes.
//
// On start the TV draws a sample of each glyph group on a canvas and compares
// it with a code point no font has. Missing groups get the bundled fonts
// (css/components-60-vidaa.css, class vidaa-glyph-fonts) and are checked
// again once loaded. Whatever still fails is replaced by text in
// streamDisplayText.js (flags as [DE], other icons dropped).

const MISSING = "\u{10FFFD}";
const FONT_LOAD_TIMEOUT_MS = 8000;
const GLYPH_FONTS_CLASS = "vidaa-glyph-fonts";

// Every sample character must draw for its group to count as supported.
export const GLYPH_SAMPLES = Object.freeze({
  emoji: ["\u{1F600}", "⚡"],
  flags: ["\u{1F1E9}\u{1F1EA}"],
  symbols: ["▣", "♬"],
  letters: ["\u{1D405}", "ᴀ"]
});

// Fonts that can supply a group; letters are folded to plain text instead.
const GROUP_FONTS = Object.freeze({
  emoji: ['"Nuvio Emoji"'],
  flags: ['"Nuvio Emoji"'],
  symbols: ['"Nuvio Symbols"', '"Nuvio Symbols Extra"']
});

const NONE = Object.freeze({ emoji: false, flags: false, symbols: false, letters: false });
let support = NONE;
let started = false;

export function getVidaaGlyphSupport() {
  return { ...support };
}

function createDefaultCanvas(doc) {
  const canvas = doc?.createElement?.("canvas");
  if (!canvas) return null;
  canvas.width = 48;
  canvas.height = 48;
  return canvas;
}

function drawPixels(ctx, text, family) {
  ctx.clearRect(0, 0, 48, 48);
  ctx.font = `32px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  ctx.fillText(text, 4, 38);
  return ctx.getImageData(0, 0, 48, 48).data;
}

// A glyph is drawn when its pixels differ from the missing-glyph box (or
// blank) the same font stack produces for a code point no font covers.
export function rendersGlyph(canvas, text, family = "sans-serif") {
  try {
    const ctx = canvas?.getContext?.("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const missing = drawPixels(ctx, MISSING, family);
    const drawn = drawPixels(ctx, text, family);
    let inked = false;
    let differs = false;
    for (let i = 0; i < drawn.length; i++) {
      if (i % 4 === 3 && drawn[i] !== 0) inked = true;
      if (drawn[i] !== missing[i]) differs = true;
      if (inked && differs) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

export function detectGlyphSupport(canvas, family = "sans-serif") {
  const result = {};
  for (const [group, samples] of Object.entries(GLYPH_SAMPLES)) {
    result[group] = samples.every((sample) => rendersGlyph(canvas, sample, family));
  }
  return result;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

// Native check right away (labels rendered before fonts load fall back to
// text), then the bundled fonts for the groups the TV cannot draw.
export async function startVidaaGlyphSupport({
  doc = globalThis.document,
  fonts = globalThis.document?.fonts,
  createCanvas = () => createDefaultCanvas(doc)
} = {}) {
  if (started) return getVidaaGlyphSupport();
  started = true;
  const canvas = createCanvas();
  if (!canvas) return getVidaaGlyphSupport();
  support = Object.freeze(detectGlyphSupport(canvas));
  const missingGroups = Object.keys(GROUP_FONTS).filter((group) => !support[group]);
  if (!missingGroups.length) return getVidaaGlyphSupport();

  doc?.documentElement?.classList?.add(GLYPH_FONTS_CLASS);
  const loads = missingGroups.flatMap((group) =>
    GROUP_FONTS[group].flatMap((family) =>
      GLYPH_SAMPLES[group].map((sample) =>
        Promise.resolve(fonts?.load?.(`32px ${family}`, sample)).catch(() => null)
      )
    )
  );
  await withTimeout(Promise.all(loads), FONT_LOAD_TIMEOUT_MS);

  const next = { ...support };
  for (const group of missingGroups) {
    const family = `${GROUP_FONTS[group].join(", ")}, sans-serif`;
    next[group] = GLYPH_SAMPLES[group].every((sample) => rendersGlyph(canvas, sample, family));
  }
  support = Object.freeze(next);
  // Nothing loaded is usable: drop the class so no further downloads start.
  if (!missingGroups.some((group) => support[group])) {
    doc?.documentElement?.classList?.remove(GLYPH_FONTS_CLASS);
  }
  return getVidaaGlyphSupport();
}

export function _resetVidaaGlyphSupportForTests() {
  support = NONE;
  started = false;
}
