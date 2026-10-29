# Subtitle fonts

The webOS HTML subtitle overlay selects static Android-family faces because webOS TV does not reliably apply CSS font-weight effects.

- `Roboto-Regular.ttf` and `Roboto-Bold.ttf` come from AOSP `platform/external/roboto-fonts`, tag `android-11.0.0_r39`; distributed under Apache License 2.0. See `Roboto-NOTICE.txt`.
- `NotoNaskhArabicUI-Regular.ttf` and `NotoNaskhArabicUI-Bold.ttf` come from AOSP `platform/external/noto-fonts/notonaskharabicui`, commit `a19a3af6f202af6785a4449fb807e406a548299a`; distributed under SIL Open Font License 1.1. See `NotoNaskhArabicUI-NOTICE.txt`.

# VIDAA glyph fonts

The VIDAA browser ships no emoji or symbol font. These subsets are loaded only on VIDAA, and only when a canvas check shows the TV cannot draw the glyphs itself.

- `TwemojiMozilla-Emoji.woff2` and `TwemojiMozilla-Flags.woff2` are subsets (COLRv0 color) of `Twemoji.Mozilla.ttf` from `mozilla/twemoji-colr` release `v0.7.0` (sha256 `6d90152ee0d29e82fe2a87793af5aa4b7ad13e6538360889e141e81ed299ee8e`). Font build under Apache License 2.0, emoji art from Twemoji under CC BY 4.0. See `TwemojiMozilla-LICENSE.md`.
- `NotoSansSymbols2-Subset.woff2` (release `NotoSansSymbols2-v2.008`) and `NotoSansSymbols-Subset.woff2` (release `NotoSansSymbols-v2.003`, only the code points Symbols 2 lacks) come from `notofonts/symbols`; distributed under SIL Open Font License 1.1. See `NotoSansSymbols-OFL.txt`.
- Subsets were made with `pyftsubset` (fontTools) to arrows, technical, enclosed, geometric, misc symbols, dingbats and the emoji/flag ranges.
