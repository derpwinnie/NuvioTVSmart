import assert from "node:assert/strict";
import { selectAutoPlayStream } from "../js/core/streams/streamAutoPlaySelector.js";
import {
  normalizeStreamDisplayText,
  normalizeStreamSearchText,
  normalizeStreamMatchPattern
} from "../js/core/streams/streamDisplayText.js";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { documentElement: { classList: { contains: () => false } } };

const { getStreamHeadline, getStreamDescriptionLines, getAddonBadgeLabel, StreamScreen } =
  await import("../js/ui/screens/stream/streamScreen.js");
const { createPlayerScreenMethods63 } =
  await import("../js/ui/screens/player/playerScreenMethods-63-get-source-request-key.js");
const { createPlayerScreenMethods67 } =
  await import("../js/ui/screens/player/playerScreenMethods-67-render-episode-streams-view.js");
const { formatPlaybackSourceName, resolvePlaybackSourceName } =
  await import("../js/ui/screens/player/playbackDisplayText.js");

for (const [decorated, readable] of [
  ["𝐈𝐓 𝘐𝘵 𝕀𝕥 ℐ𝒯 ＩＴ ⒾⓉ 🄸🅃 🅸🆃 🅘🅣", "IT It It IT IT IT IT IT IT"],
  ["𝐈t 🇮t I\u200bT I\u200dT I\u2060T", "It It IT IT IT"],
  ["🇮🇹🇬🇧 🇯🇵", "[IT][GB] [JP]"],
  ["🅸️🆃️ 𝟜𝕂", "IT 4K"],
  [
    "✓ ɪᴛ · ᴇɴ · sᴜʙ (ᴇɴ · ᴇɴᶠᵒʳᶜᵉᵈ · ᴇɴᶜᶜ · ᴇs · ɪᴛ · ɪᴛᶠᵒʳᶜᵉᵈ · ʀᴜ)",
    "✓ it · en · sub (en · enforced · encc · es · it · itforced · ru)"
  ],
  ["Teach You A Lesson s₀₁·ᴇ₁₀", "Teach You A Lesson s01·e10"],
  ["ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘꞯʀꜱᴛᴜᴠᴡxʏᴢ", "abcdefghijklmnopqrstuvwxyz"],
  ["éàèìòù 1⁺2⁻3 ¼ ² ₄", "éàèìòù 1⁺2⁻3 ¼ 2 4"],
  ["Città 日本語 العربية 👩‍💻", "Città 日本語 العربية 👩‍💻"],
  ["�T \ud835", "�T \ud835"],
  ["ɴᴇᴛғʟɪx · ғалым", "netflix · ғалым"]
]) {
  // Without emoji/symbol glyphs (the default) icons are left out, not spelled as words.
  const display = readable.replace(/^✓ /, "").replace(/ 👩‍💻$/, "");
  assert.equal(normalizeStreamDisplayText(decorated), display);
  assert.equal(normalizeStreamSearchText(decorated), readable);
}

// Public labels from the reported Conan S1E4 sources, without URL or account data.
const conanAio = {
  name: "1080P\u200d\u200d    \u200d\u200d\u200d⚡\u200d\u200d\n  〈Web\u200d-\u200ddl〉\u200d     \u200d\n  ★★★★★",
  description:
    "➤ Detective Conan The… s₀₁·ᴇ₀₄\n▣ AVC ♬ DD+ ♯ 2.0\n◈ 270 MB · 3.39 ᴹᵇᵖˢ\n⛉ [TB] Comet · KQRM\n✓ ᴇɴ · ᴇs · ɪᴛ · sᴜʙ (ᴇɴ · ᴇs · ɪᴛ · ʀᴜ)\n » ɴᴇᴛғʟɪx ₁₆₅₀"
};
const conanOriginal = structuredClone(conanAio);
// Upstream 1.2.10 keeps multiline addon names in the headline.
assert.equal(getStreamHeadline(conanAio), "1080P    \n  <Web-dl>     \n  *****");
assert.deepEqual(getStreamDescriptionLines(conanAio), [
  "> Detective Conan The… s01·e04",
  "AVC DD+ # 2.0",
  "270 MB · 3.39 Mbps",
  "[TB] Comet · KQRM",
  "en · es · it · sub (en · es · it · ru)",
  "» netflix 1650"
]);
assert.equal(normalizeStreamDisplayText(conanAio.name), "1080P    \n  <Web-dl>     \n  *****");
assert.equal(
  normalizeStreamDisplayText("1080P\n★★★★☆"),
  "1080P\n****-",
  "empty rating stars remain distinct from filled stars"
);
assert.deepEqual(
  getStreamDescriptionLines({
    name: "1080P",
    description: "✎ Detective.Conan.S01E04.mkv\n⛿ ɪᴛ · ᴇɴ"
  }),
  ["Detective.Conan.S01E04.mkv", "it · en"]
);
assert.equal(getStreamHeadline({ name: "🪐 Anime Saturn" }), "Anime Saturn");
assert.equal(normalizeStreamDisplayText("🌍 🌎 🌏"), "");
assert.equal(getStreamHeadline({ name: "🤌 Anime World 🌍" }), "Anime World");
assert.equal(getStreamHeadline({ name: "🤌 StreamingCommunity 🍿" }), "StreamingCommunity");
assert.equal(normalizeStreamDisplayText("a 🍿 b\n🤌 Anime World 🌍\nx"), "a b\nAnime World\nx");
assert.deepEqual(
  getStreamDescriptionLines({
    title: "🎬 Detective conan ▪ S1E4\n🗣 [ITA]\n🌐 Proxy (ON)",
    name: "StreamViX"
  }),
  ["Detective conan - S1E4", "[ITA]", "Proxy (ON)"]
);
assert.equal(normalizeStreamDisplayText("🎦 🅵🅷🅳 🎞️ HEVC 🎧 AAC 💾 629 MB"), "FHD HEVC AAC 629 MB");
assert.equal(normalizeStreamDisplayText("☁︎ File\n❖ 660 MB / 6.98 GB"), "File\n660 MB / 6.98 GB");
assert.equal(normalizeStreamDisplayText("StreamViX | ElfHosted ⚡ 🌐 📺"), "StreamViX | ElfHosted");
assert.equal(normalizeStreamDisplayText("F♯ music · ♯ 5.1"), "F# music · # 5.1");
// Without emoji glyphs a joined emoji goes as a whole; joins inside Arabic and
// Indic words stay. With emoji glyphs (native or the bundled font) nothing changes.
assert.equal(normalizeStreamDisplayText("👩‍💻 العربية‍العربية क्‍ष"), "العربية‍العربية क्‍ष");
assert.equal(normalizeStreamDisplayText("👩‍🚀 🤌🏽 👁️‍🗨️"), "");
const allGlyphs = { emoji: true, flags: true, symbols: true, letters: true };
for (const text of ["👩‍💻 العربية‍العربية क्‍ष", "👩‍🚀 🤌🏽 👁️‍🗨️", "🗣 IT | 🇬🇧 EN ★★★★☆ ♬ AAC 𝐅𝐇𝐃"]) {
  assert.equal(
    normalizeStreamDisplayText(text, allGlyphs),
    text,
    "drawable glyphs stay as they are"
  );
}
assert.equal(
  normalizeStreamDisplayText("🗣 IT | 🇬🇧 EN ★ ♬ AAC", { symbols: true }),
  "IT | [GB] EN ★ ♬ AAC",
  "a symbol font alone keeps symbols; emoji go and flags become codes"
);
assert.equal(
  normalizeStreamSearchText("🗣️ 🇮🇹 💾 629 MB"),
  "🗣️ [IT] 💾 629 MB",
  "display icon fallback must not alter language or regex input"
);
assert.deepEqual(conanAio, conanOriginal, "Actual source metadata remains unchanged");

const styledPattern = new RegExp(normalizeStreamMatchPattern("^(?!.*CAM).*\\b𝐈𝐓\\b$"));
assert.ok(styledPattern.test("Audio IT"));
assert.equal(styledPattern.test("CAM IT"), false);
const flagPattern = new RegExp(normalizeStreamMatchPattern("^🇮🇹$"));
assert.equal(flagPattern.test(normalizeStreamSearchText("🇮🇹")), true);
assert.equal(flagPattern.test("I"), false, "A flag must not become a character class");
assert.equal(new RegExp(normalizeStreamMatchPattern("\\🇮🇹")).test("[IT]"), true);
assert.equal(new RegExp(normalizeStreamMatchPattern("\\bɪᴛ\\b")).test("audio it"), true);
assert.equal(new RegExp(normalizeStreamMatchPattern("ɴᴇᴛғʟɪx")).test("netflix"), true);
const flagClass = new RegExp(normalizeStreamMatchPattern("[🇮🇹]"));
for (const ordinary of ["I", "T", "[", "]"]) assert.equal(flagClass.test(ordinary), false);
assert.equal(normalizeStreamMatchPattern("[𝐀-𝐙]"), "[𝐀-𝐙]");
for (const pattern of ["[Ａ-Ｚ]", "[ⓐ-ⓩ]"]) {
  assert.equal(normalizeStreamMatchPattern(pattern), pattern);
  const originalClass = new RegExp(pattern);
  const preservedClass = new RegExp(normalizeStreamMatchPattern(pattern));
  for (const text of ["α", "中", "A", "Ａ"])
    assert.equal(preservedClass.test(text), originalClass.test(text));
}
assert.equal(
  selectAutoPlayStream([{ description: "𝐂𝐀𝐌 1080p", url: "https://fixture.invalid/cam" }], {
    mode: "REGEX_MATCH",
    regexPattern: "(?!.*(𝐂𝐀𝐌|TS)).*1080p"
  }),
  null
);
const urlPattern = new RegExp(normalizeStreamMatchPattern("https://fixture\\.invalid/𝐈𝐓"));
assert.equal(urlPattern.test("https://fixture.invalid/𝐈𝐓"), true);
const unchangedPattern = "^(?!.*(CAM|TS)).*\\bIT\\b[0-9]+\\.mkv$";
assert.equal(normalizeStreamMatchPattern(unchangedPattern), unchangedPattern);

const source = {
  id: "original-𝐈𝐓",
  name: "Source 𝐈t",
  title: "𝟜𝕂 🇮🇹",
  description: "Audio: 🅸🆃\n🇮🇹 / English\nCittà 日本語",
  addonName: "Fixture",
  url: "https://fixture.invalid/𝐈𝐓?token=🇮🇹"
};
const original = structuredClone(source);
assert.equal(getStreamHeadline(source), "Source It");
assert.equal(getStreamHeadline({ addonName: "𝐀𝐝𝐝𝐨𝐧 🇮🇹" }), "Addon [IT]");
assert.equal(formatPlaybackSourceName("𝐅𝐇𝐃\\n🇮🇹\nCittà • 1080p"), "FHD · [IT] · Città • 1080p");
assert.equal(resolvePlaybackSourceName(source), "Source It");
assert.equal(resolvePlaybackSourceName({ addonName: "𝐀𝐝𝐝𝐨𝐧 🇮🇹" }), "Addon [IT]");
assert.equal(resolvePlaybackSourceName({ ...source, isSynthetic: true }), "");
// Sanitized metadata from the same AIOStreams episode used for the TV check.
const aioMetadata = {
  name: "1080P",
  description: "Teach You A Lesson s₀₁·ᴇ₁₀\n✓ ɪᴛ · ᴇɴ · sᴜʙ (ᴇɴ · ɪᴛᶠᵒʳᶜᵉᵈ)"
};
assert.deepEqual(getStreamDescriptionLines(aioMetadata), [
  "Teach You A Lesson s01·e10",
  "it · en · sub (en · itforced)"
]);
assert.equal(resolvePlaybackSourceName({ name: "AIO ɪᴛ · s₀₁·ᴇ₁₀" }), "AIO it · s01·e10");
assert.deepEqual(getStreamDescriptionLines(source), [
  "Audio: IT",
  "[IT] / English",
  "Città 日本語"
]);
const markup = StreamScreen.renderStreamCard.call(
  { isCardActionFocused: () => false },
  source,
  0,
  false,
  { showAddonLogo: false }
);
assert.ok(markup.includes("Source It"));
assert.ok(markup.includes("Audio: IT"));
assert.ok(markup.includes("[IT] / English"));

const decoratedAddon = "𝐀𝐝𝐝𝐨𝐧 ɪᴛ";
assert.equal(getAddonBadgeLabel(decoratedAddon), "AI");
// Icons the TV cannot draw are not used as initials; other scripts keep
// complete characters.
assert.equal(getAddonBadgeLabel("🎧 日本語"), "日", "initials retain complete Unicode characters");
assert.equal(getAddonBadgeLabel("🧑 日本語 Addon"), "日A");
const addonMarkup = StreamScreen.renderStreamCard.call(
  { isCardActionFocused: () => false },
  { ...source, addonName: decoratedAddon },
  0,
  false,
  { showAddonLogo: true }
);
assert.match(addonMarkup, /class="stream-route-addon-name"[^>]*>Addon it<\/div>/);
const chipMarkup = StreamScreen.renderChip(decoratedAddon, true, "success");
assert.match(chipMarkup, /<span[^>]*>Addon it<\/span>/);
assert.ok(chipMarkup.includes(`data-addon="${decoratedAddon}"`), "filter identity stays original");

const playerSource = { ...source, label: source.name };
const panel = {
  childNodes: [],
  classList: { toggle() {} },
  querySelector: () => null,
  innerHTML: ""
};
createPlayerScreenMethods63().renderSourcesPanel.call({
  cancelScheduledSourcesPanelRender() {},
  uiRefs: { sourcesPanel: panel },
  sourcesPanelVisible: true,
  sourcesFocus: { zone: "list", index: 0 },
  params: {},
  streamCandidates: [],
  getOrderedStreamCandidates: () => [playerSource],
  getSourceFilters: () => ["all", decoratedAddon],
  getFilteredSources: () => [playerSource],
  ensureSourcesFocus() {},
  syncSourcesFocusDom() {}
});
assert.ok(panel.innerHTML.includes("Source It"));
assert.ok(panel.innerHTML.includes("Audio: IT"));
assert.ok(!panel.innerHTML.includes("🅸🆃"));
assert.match(panel.innerHTML, /class="player-sources-filter[^>]*>\s*Addon it\s*<\/div>/);
const episodeMarkup = createPlayerScreenMethods67().renderEpisodeStreamsView.call({
  episodes: [],
  episodePanelIndex: 0,
  episodePanelStreamFocus: { zone: "streams", index: 0 },
  getEpisodePanelStreamFilters: () => ["all", decoratedAddon],
  getFilteredEpisodePanelStreams: () => [playerSource]
});
assert.ok(episodeMarkup.includes("Source It"));
assert.ok(episodeMarkup.includes("Audio: IT"));
assert.ok(!episodeMarkup.includes("🅸🆃"));
assert.match(episodeMarkup, /class="player-episode-stream-filter[^>]*>\s*Addon it\s*<\/button>/);
assert.deepEqual(source, original, "Readability must not mutate source IDs, URLs or metadata");

console.log(
  "PASS: readable VIDAA stream labels/flags in picker, descriptions and player panels; regex syntax, other scripts and source identity preserved"
);
