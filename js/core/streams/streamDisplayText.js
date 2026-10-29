// Some addon formatters use styled mathematical letters for labels such as
// "4K" and "FullHD". TV fonts can render those symbols as missing-glyph boxes.
const MATHEMATICAL_ALPHANUMERIC_START = 0x1d400;
const MATHEMATICAL_ALPHANUMERIC_END = 0x1d7ff;
// AIOStreams formatters also spell labels with phonetic small capitals.
// Those letters do not have a compatibility decomposition (e.g. ɪᴛ stays ɪᴛ
// under NFKC). Keep this limited to the decorated Latin alphabet.
const LATIN_SMALL_CAPITALS = {
  ᴀ: "a",
  ʙ: "b",
  ᴄ: "c",
  ᴅ: "d",
  ᴇ: "e",
  ꜰ: "f",
  ɢ: "g",
  ʜ: "h",
  ɪ: "i",
  ᴊ: "j",
  ᴋ: "k",
  ʟ: "l",
  ᴍ: "m",
  ɴ: "n",
  ᴏ: "o",
  ᴘ: "p",
  "ꞯ": "q",
  ʀ: "r",
  ꜱ: "s",
  ᴛ: "t",
  ᴜ: "u",
  ᴠ: "v",
  ᴡ: "w",
  ʏ: "y",
  ᴢ: "z"
};

function readCodePoint(text, index) {
  const first = text.charCodeAt(index);
  if (first < 0xd800 || first > 0xdbff || index + 1 >= text.length) {
    return { codePoint: first, length: 1 };
  }
  const second = text.charCodeAt(index + 1);
  if (second < 0xdc00 || second > 0xdfff) {
    return { codePoint: first, length: 1 };
  }
  return {
    codePoint: (first - 0xd800) * 0x400 + (second - 0xdc00) + 0x10000,
    length: 2
  };
}

export function normalizeMathematicalAlphanumericSymbols(value = "") {
  const text = String(value || "");
  if (!text || typeof text.normalize !== "function") {
    return text;
  }

  let normalized = "";
  let index = 0;
  while (index < text.length) {
    const current = readCodePoint(text, index);
    const symbol = text.slice(index, index + current.length);
    normalized +=
      current.codePoint >= MATHEMATICAL_ALPHANUMERIC_START &&
      current.codePoint <= MATHEMATICAL_ALPHANUMERIC_END
        ? symbol.normalize("NFKC")
        : symbol;
    index += current.length;
  }
  return normalized;
}

const REGIONAL_INDICATOR_START = 0x1f1e6;
const REGIONAL_INDICATOR_END = 0x1f1ff;

function isRegionalIndicator(codePoint) {
  return codePoint >= REGIONAL_INDICATOR_START && codePoint <= REGIONAL_INDICATOR_END;
}

function indicatorLetter(codePoint) {
  return String.fromCharCode(65 + codePoint - REGIONAL_INDICATOR_START);
}

function hasSmallCapitalNeighbor(text, index, length) {
  return (
    Object.prototype.hasOwnProperty.call(LATIN_SMALL_CAPITALS, text[index - 1]) ||
    Object.prototype.hasOwnProperty.call(LATIN_SMALL_CAPITALS, text[index + length])
  );
}

function plainLabelSymbol(symbol, codePoint, smallCapitalNeighbor = false) {
  if (Object.prototype.hasOwnProperty.call(LATIN_SMALL_CAPITALS, symbol)) {
    return LATIN_SMALL_CAPITALS[symbol];
  }
  // AIO's small-cap font spells "netflix" with a Cyrillic ghe for its f.
  // Fold it only beside decorated Latin letters, never in Cyrillic words.
  if (symbol === "ғ" && smallCapitalNeighbor) return "f";
  // Negative circled/squared letters have no NFKC decomposition.
  if (codePoint >= 0x1f150 && codePoint <= 0x1f169)
    return String.fromCharCode(65 + codePoint - 0x1f150);
  if (codePoint >= 0x1f170 && codePoint <= 0x1f189)
    return String.fromCharCode(65 + codePoint - 0x1f170);
  if (isRegionalIndicator(codePoint)) return indicatorLetter(codePoint);
  if (typeof symbol.normalize !== "function") return symbol;
  if (codePoint >= MATHEMATICAL_ALPHANUMERIC_START && codePoint <= MATHEMATICAL_ALPHANUMERIC_END) {
    return symbol.normalize("NFKC");
  }
  // Restrict compatibility folding to label alphabets. In particular, regex
  // punctuation, accented titles and unrelated writing systems keep their form.
  if (
    (codePoint >= 0x2100 && codePoint <= 0x214f) ||
    codePoint === 0x00b2 ||
    codePoint === 0x00b3 ||
    codePoint === 0x00b9 ||
    (codePoint >= 0x02b0 && codePoint <= 0x02ff) ||
    (codePoint >= 0x1d2c && codePoint <= 0x1d6a) ||
    (codePoint >= 0x1d9b && codePoint <= 0x1dbf) ||
    (codePoint >= 0x2070 && codePoint <= 0x209f) ||
    (codePoint >= 0x24b6 && codePoint <= 0x24e9) ||
    (codePoint >= 0x1f130 && codePoint <= 0x1f149) ||
    (codePoint >= 0xff10 && codePoint <= 0xff19) ||
    (codePoint >= 0xff21 && codePoint <= 0xff3a) ||
    (codePoint >= 0xff41 && codePoint <= 0xff5a)
  ) {
    const plain = symbol.normalize("NFKC");
    if (/^[A-Za-z0-9]$/.test(plain)) return plain;
  }
  return symbol;
}

// letters/flags: the device draws decorated letters / flag emoji itself, so
// they stay. Search text always folds both (see normalizeStreamSearchText).
function normalizeStreamLabel(value, { letters = false, flags = false } = {}) {
  const text = String(value || "");
  let normalized = "";
  for (let index = 0; index < text.length;) {
    const current = readCodePoint(text, index);
    if (flags && isRegionalIndicator(current.codePoint)) {
      normalized += text.slice(index, index + current.length);
      index += current.length;
      continue;
    }
    if (isRegionalIndicator(current.codePoint) && index + current.length < text.length) {
      const next = readCodePoint(text, index + current.length);
      if (isRegionalIndicator(next.codePoint)) {
        const country = indicatorLetter(current.codePoint) + indicatorLetter(next.codePoint);
        normalized += `[${country}]`;
        index += current.length + next.length;
        if (text.charCodeAt(index) === 0xfe0f) index++;
        continue;
      }
    }
    const symbol = text.slice(index, index + current.length);
    normalized += letters
      ? symbol
      : plainLabelSymbol(
          symbol,
          current.codePoint,
          hasSmallCapitalNeighbor(text, index, current.length)
        );
    index += current.length;
  }
  return normalized
    .replace(/([A-Za-z0-9])[\u200b-\u200d\u2060\ufeff]+(?=[A-Za-z0-9])/g, "$1")
    .replace(/([A-Za-z0-9])[\ufe0e\ufe0f]+/g, "$1");
}

// Metadata icons whose shape has a plain-text equivalent. Used only when the
// device cannot draw them (no symbol font); other icons are then left out
// rather than spelled as words.
const SYMBOL_TEXT_FALLBACK = {
  "\u2605": "*",
  "\u2606": "-",
  "\u2b50": "*",
  "\u27a4": ">",
  "\u25aa": "-",
  "\u266f": "#"
};
// Angle brackets (technical and CJK forms): no bundled font covers them.
const BRACKETS = { "\u2329": "<", "\u232a": ">", "\u3008": "<", "\u3009": ">" };

function isSymbolCodePoint(codePoint) {
  return (
    (codePoint >= 0x2190 && codePoint <= 0x2bff) || (codePoint >= 0x1f650 && codePoint <= 0x1f67f)
  );
}

// Emoji/symbols the device cannot draw are left out (with their variation
// selectors and joiners); symbol shapes with a text equivalent keep it.
function normalizeStreamPresentationSymbols(text, { emoji = false, symbols = false } = {}) {
  let readable = "";
  for (let index = 0; index < text.length;) {
    const current = readCodePoint(text, index);
    const symbol = text.slice(index, index + current.length);
    const { codePoint } = current;
    index += current.length;
    if (Object.prototype.hasOwnProperty.call(BRACKETS, symbol)) {
      readable += BRACKETS[symbol];
      continue;
    }
    const smpPictograph =
      codePoint >= 0x1f000 && codePoint <= 0x1faff && !isRegionalIndicator(codePoint);
    const bmpSymbol = isSymbolCodePoint(codePoint);
    const drawable = smpPictograph ? emoji : bmpSymbol ? emoji || symbols : true;
    if (drawable || (!smpPictograph && !bmpSymbol)) {
      readable += symbol;
      continue;
    }
    readable += SYMBOL_TEXT_FALLBACK[symbol] ?? "";
    while (
      text.charCodeAt(index) === 0xfe0e ||
      text.charCodeAt(index) === 0xfe0f ||
      text.charCodeAt(index) === 0x200d
    ) {
      index++;
    }
    // A dropped icon leaves one space between words, and none before a line end.
    if (!SYMBOL_TEXT_FALLBACK[symbol]) {
      const next = text[index] || "";
      if (next === " " && (readable === "" || /[ \n]$/.test(readable))) index++;
      else if ((next === "" || next === "\n" || next === "\r") && / +$/.test(readable))
        readable = readable.replace(/ +$/, "");
    }
  }
  // AIO labels pad their icons with stand-alone joiners, including at line
  // endings. Remove them only between ASCII/space/boundaries. Emoji ZWJ
  // sequences and joins inside Arabic/Indic words keep their original form.
  return readable.replace(
    /(^|[\x20-\x7e\s])[\u200b-\u200d\u2060\ufeff]+(?=[\x20-\x7e\s]|$)/g,
    "$1"
  );
}

// Presentation only: never write the result into URLs, stream IDs or payloads.
// `glyphs`: what the device draws ({ emoji, flags, symbols, letters }); the
// default replaces everything, for devices that report nothing usable.
export function normalizeStreamDisplayText(value = "", glyphs = {}) {
  return normalizeStreamPresentationSymbols(normalizeStreamLabel(value, glyphs), glyphs).trim();
}

export function normalizeStreamSearchText(value = "") {
  return normalizeStreamLabel(value);
}

export function normalizeStreamMatchPattern(value = "") {
  const text = String(value || "");
  let normalized = "";
  for (let index = 0; index < text.length;) {
    let escaped = false;
    if (text[index] === "\\" && index + 1 < text.length) {
      const next = readCodePoint(text, index + 1);
      // Preserve regex escapes and backreferences. An escaped decorated glyph
      // is an identity escape, so handle its literal symbol below.
      if (next.codePoint < 128) {
        normalized += text.slice(index, index + 2);
        index += 2;
        continue;
      }
      escaped = true;
      index++;
    }
    const current = readCodePoint(text, index);
    const symbol = text.slice(index, index + current.length);
    if (!escaped && symbol === "[") {
      // Preserve code-point sets/ranges; folding endpoints can widen a range.
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === "\\") end += 2;
        else if (text[end++] === "]") break;
      }
      normalized += text.slice(index, end);
      index = end;
      continue;
    }
    if (isRegionalIndicator(current.codePoint) && index + current.length < text.length) {
      const next = readCodePoint(text, index + current.length);
      if (isRegionalIndicator(next.codePoint)) {
        const country = indicatorLetter(current.codePoint) + indicatorLetter(next.codePoint);
        let end = index + current.length + next.length;
        if (text.charCodeAt(end) === 0xfe0f) end++;
        const flag = text.slice(index, end);
        // Keep class syntax intact. A flag outside a class matches both the
        // readable marker and an unchanged literal flag in an opaque URL.
        normalized += `(?:${flag}|\\[${country}\\])`;
        index = end;
        continue;
      }
    }
    const plain = plainLabelSymbol(
      symbol,
      current.codePoint,
      hasSmallCapitalNeighbor(text, index, current.length)
    );
    if (plain !== symbol) {
      // Non-capturing alternatives retain raw Unicode URL patterns without a
      // second raw-text match that could bypass a negative language lookahead.
      normalized += `(?:${symbol}|${plain})`;
    } else {
      normalized += `${escaped ? "\\" : ""}${symbol}`;
    }
    index += current.length;
  }
  return normalized;
}

// The display rule for stream labels, in one place. Callers pass their
// platform Environment, so this module stays platform-free. A device that
// reports glyph support (VIDAA) gets only the glyphs it cannot draw replaced;
// everything else shows the text unchanged.
export function readableStreamText(value = "", environment = null) {
  const text = String(value ?? "");
  const glyphs = environment?.getGlyphSupport?.();
  return glyphs ? normalizeStreamDisplayText(text, glyphs) : text;
}

// Headlines also keep upstream's webOS rule: decorated letters only, emoji stay.
export function readableStreamHeadline(value = "", environment = null) {
  const text = String(value ?? "");
  const glyphs = environment?.getGlyphSupport?.();
  if (glyphs) return normalizeStreamDisplayText(text, glyphs);
  return environment?.isWebOS?.() ? normalizeMathematicalAlphanumericSymbols(text) : text;
}
