import assert from "node:assert/strict";

// Wire-up of the VIDAA media check (methods file 74) and the shared source-failure
// handling (methods file 75) with a fake screen and video element. The decisions
// themselves are tested in test-vidaa-audio-support.mjs.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.location = { search: "?wrapper=vidaa", hostname: "example.github.io" };
let userAgent = "Mozilla/5.0 VIDAA/7.0";
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  get: () => ({ userAgent, onLine: true })
});
const originalInfo = console.info;
const originalWarn = console.warn;
const logs = [];
console.info = (...args) => logs.push(args);
console.warn = (...args) => logs.push(args);

const { createPlayerScreenMethods74, resetVidaaAudioCounterProbe } =
  await import("../js/ui/screens/player/playerScreenMethods-74-vidaa-audio-support.js");
const { createPlayerScreenMethods75 } =
  await import("../js/ui/screens/player/playerScreenMethods-75-vidaa-source-failure.js");
const { PlayerController } = await import("../js/ui/screens/player/playerScreenContext.js");
const { VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY } =
  await import("../js/platform/vidaa/vidaaAudioSupport.js");
const { VIDAA_MEDIA_COUNTERS_VERIFIED_KEY } =
  await import("../js/platform/vidaa/vidaaMediaCounters.js");
const verified = () => JSON.parse(store.get(VIDAA_MEDIA_COUNTERS_VERIFIED_KEY) || "{}");

const URL_A = "https://debrid.example/token123/a.mkv";
const DTS_TRACKS = [{ type: "audio", codec_id: "A_DTS", isDefault: true }];
const learned = () => JSON.parse(store.get(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY) || "[]");

function createScreen({ eligibility = "eligible", next = { id: "b" } } = {}) {
  const calls = [];
  const state = {
    ...createPlayerScreenMethods74(),
    ...createPlayerScreenMethods75(),
    activePlaybackUrl: URL_A,
    streamCandidates: [{ id: "a" }, { id: "b" }],
    paused: false,
    vidaaAudioCheckTimer: null,
    vidaaAudioCheckState: null,
    vidaaAudioCheckUrl: "",
    vidaaAudioCheckDoneUrl: "",
    vidaaAudioProbe: null,
    seekOverlayVisible: false,
    bufferingActive: false,
    sourcesAlert: null,
    sourcesFocus: null,
    calls,
    getStreamCandidateByUrl: () => state.streamCandidates[0],
    getVidaaAutoPlayFailoverContext: () => ({ settings: {}, eligibility }),
    pickVidaaAutoPlayFailoverCandidate: () => next,
    startVidaaAutoPlayFailover: (failed, candidate) =>
      calls.push(["failover", failed.id, candidate.id]),
    showAspectToast: (label, options) => calls.push(["toast", label, options?.durationMs]),
    showStartupError: (message) => calls.push(["startup-error", message]),
    // Like the real panel on VIDAA: focus starts on the playing source.
    openSourcesPanel: () => {
      calls.push(["open-sources"]);
      state.sourcesFocus = { zone: "list", index: 0 };
    },
    getFilteredSources: () => state.streamCandidates,
    renderSourcesPanel: () => calls.push(["render-sources"]),
    markPlaybackSourceFailed: () => calls.push(["failed"])
  };
  return new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : () => undefined)
  });
}

const video = {
  webkitAudioDecodedByteCount: 0,
  webkitVideoDecodedByteCount: 1,
  videoWidth: 1920,
  videoHeight: 1080,
  currentTime: 10,
  paused: false,
  seeking: false
};
PlayerController.video = video;
let pauses = 0;
PlayerController.pause = () => (pauses += 1);
const tick = (screen, count) => {
  for (let index = 0; index < count; index += 1) {
    video.currentTime += 1;
    screen.runVidaaAudioCheck();
  }
};
const kinds = (screen) => screen.calls.map(([kind]) => kind);

// 0. Until this device's counter has counted audio once, silence proves nothing:
// a TV decoding audio outside the browser would report 0 for every source.
let screen = createScreen();
screen.startVidaaAudioCheck();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
tick(screen, 6);
// The counter self-test cannot run here (no DOM): it resolves false, the check gives up.
await new Promise((resolve) => setTimeout(resolve, 0));
tick(screen, 1);
assert.deepEqual(screen.calls, [], "unverified counter: no reaction");
assert.equal(
  store.has(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY) && learned().length > 0,
  false,
  "nothing learned"
);
assert.ok(JSON.stringify(logs).includes("counter-not-verified"));
assert.equal(screen.vidaaAudioCheckTimer, null, "check ends once audio and video are decided");
// A source that decodes audio verifies the counter for later checks.
screen = createScreen();
video.webkitAudioDecodedByteCount = 4096;
screen.startVidaaAudioCheck();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
tick(screen, 1);
assert.deepEqual(verified().audio, ["native"]);
assert.deepEqual(verified().video, ["native"], "a normal picture verifies the video check");
video.webkitAudioDecodedByteCount = 0;

// 1. Auto-picked source, silent DTS audio: fail over after 5 s and learn the codec.
screen = createScreen();
screen.startVidaaAudioCheck();
tick(screen, 3);
assert.equal(screen.calls.length, 0, "no verdict before the probe and 5 s");
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
tick(screen, 3);
assert.deepEqual(kinds(screen), ["failed", "toast", "failover"]);
assert.match(screen.calls[1][1], /\(DTS\)/);
assert.equal(screen.vidaaAudioCheckTimer, null, "timer cleared after the verdict");
assert.deepEqual(learned(), ["A_DTS"]);
// Only once per source playback.
screen.startVidaaAudioCheck();
assert.equal(screen.vidaaAudioCheckTimer, null);
assert.ok(!JSON.stringify(logs).includes("token123"), "no stream URL in logs");

// 1b. A later playback of the same source (e.g. a manual switch back to it) is checked
// again: the remembered codec reacts after a short grace, not the full 5 s.
screen = createScreen({ eligibility: "manual-selection" });
screen.vidaaAudioCheckDoneUrl = URL_A;
screen.startVidaaAudioCheck();
assert.equal(screen.vidaaAudioCheckTimer, null, "same playback: not checked twice");
screen.resetVidaaAudioCheckForNewPlayback();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
assert.equal(screen.calls.length, 0, "grace: not at the first check");
tick(screen, 2);
assert.ok(kinds(screen).includes("open-sources"), "known DTS source reacts after the grace");

// 2. Manually picked source with a remembered codec: the in-player sources list opens
// with an alert on top and focus moves to the next source. No error card.
pauses = 0;
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
tick(screen, 2);
assert.deepEqual(kinds(screen), ["failed", "open-sources", "render-sources"]);
assert.equal(pauses, 1);
assert.equal(screen.paused, true);
assert.equal(screen.sourcesAlert.title, "Audio not supported");
assert.match(
  screen.sourcesAlert.message,
  /\(DTS\).*Choose another source/,
  "alert explains the codec"
);
assert.deepEqual(screen.sourcesFocus, { zone: "list", index: 1 }, "focus on the next source");

// 3. Auto-play (also resume / continue watching) with no candidate left: the same
// sources list with an alert, never the error card whose Back leaves the player.
screen = createScreen({ next: null });
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
tick(screen, 2);
assert.deepEqual(kinds(screen), ["failed", "open-sources", "render-sources"]);
assert.match(screen.sourcesAlert.message, /\(DTS\).*No other source could be tried/);

// 4. Self-healing: a remembered codec that decodes now (firmware update) plays on and
// is taken off the list.
assert.deepEqual(learned(), ["A_DTS"]);
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
video.webkitAudioDecodedByteCount = 2048;
tick(screen, 4);
assert.equal(screen.calls.length, 0);
assert.deepEqual(learned(), [], "DTS forgotten");
assert.equal(screen.vidaaAudioCheckTimer, null);
video.webkitAudioDecodedByteCount = 0;

// 5. No byte counter API: audio is never flagged.
delete video.webkitAudioDecodedByteCount;
screen = createScreen();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
tick(screen, 12);
assert.equal(screen.calls.length, 0);
assert.equal(screen.vidaaAudioCheckTimer, null);
video.webkitAudioDecodedByteCount = 0;

// 6. No track info (MP4 / HLS / unreadable header): silence for 10 s still counts,
// without a codec name and without learning anything.
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, []);
screen.startVidaaAudioCheck();
tick(screen, 6);
assert.equal(screen.calls.length, 0, "not after 5 s without track info");
tick(screen, 5);
assert.deepEqual(kinds(screen), ["failed", "open-sources", "render-sources"]);
assert.equal(
  screen.sourcesAlert.message,
  "This source's audio isn't supported on this device. Choose another source."
);
assert.deepEqual(learned(), []);

// 7. A probe for another URL is ignored and a source change stops the check.
screen = createScreen();
screen.recordVidaaAudioProbe("https://debrid.example/other.mkv", DTS_TRACKS);
screen.startVidaaAudioCheck();
tick(screen, 3);
assert.equal(screen.calls.length, 0);
screen.activePlaybackUrl = "https://debrid.example/next.mkv";
screen.runVidaaAudioCheck();
assert.equal(screen.vidaaAudioCheckTimer, null);

// 8. Video the TV cannot decode: sound over a black picture (no size, no decoded video).
video.webkitAudioDecodedByteCount = 4096;
video.webkitVideoDecodedByteCount = 0;
video.videoWidth = 0;
video.videoHeight = 0;
screen = createScreen();
screen.startVidaaAudioCheck();
tick(screen, 4);
assert.equal(screen.calls.length, 0, "not before 5 s");
tick(screen, 2);
assert.deepEqual(kinds(screen), ["failed", "toast", "failover"]);
assert.match(screen.calls[1][1], /video/);
screen = createScreen({ eligibility: "manual-selection" });
screen.startVidaaAudioCheck();
tick(screen, 6);
assert.equal(screen.sourcesAlert.title, "Video not supported");
// A picture size alone (TV decoding video outside the browser) is enough.
video.videoWidth = 1280;
video.videoHeight = 720;
screen = createScreen();
screen.startVidaaAudioCheck();
tick(screen, 8);
assert.equal(screen.calls.length, 0);
assert.equal(screen.vidaaAudioCheckTimer, null);
video.webkitVideoDecodedByteCount = 1;

// 9. A firmware update (other user agent) starts the memory over.
store.set(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY, JSON.stringify(["A_DTS"]));
resetVidaaAudioCounterProbe();
userAgent = "Mozilla/5.0 VIDAA/8.0";
video.webkitAudioDecodedByteCount = 0;
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
assert.deepEqual(learned(), [], "codec list cleared");
assert.equal(verified().audio, undefined, "audio counter re-verified after the update");
assert.ok(JSON.stringify(logs).includes("browser-changed"));
screen.stopVidaaAudioCheck();

// 9b. Counters are trusted per pipeline. A TV that never reports a picture size:
// the black-picture check stays off.
store.set(VIDAA_MEDIA_COUNTERS_VERIFIED_KEY, JSON.stringify({}));
video.webkitAudioDecodedByteCount = 4096;
video.webkitVideoDecodedByteCount = 0;
video.videoWidth = 0;
video.videoHeight = 0;
screen = createScreen();
screen.startVidaaAudioCheck();
tick(screen, 8);
assert.equal(screen.calls.length, 0, "unverified picture counter: no reaction");
assert.ok(JSON.stringify(logs).includes("VIDAA video check skipped"));
assert.equal(screen.vidaaAudioCheckTimer, null);
video.webkitVideoDecodedByteCount = 1;
video.videoWidth = 1920;
video.videoHeight = 1080;
// MSE playback (hls.js): a plain file's counter proves nothing for it.
PlayerController.playbackEngine = "hls.js";
video.webkitAudioDecodedByteCount = 0;
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, []);
screen.startVidaaAudioCheck();
tick(screen, 12);
assert.equal(screen.calls.length, 0, "unverified hls.js counter: no reaction");
assert.equal(screen.vidaaAudioCheckTimer, null);
// Once an HLS source counted audio, a silent one is reported.
video.webkitAudioDecodedByteCount = 512;
screen = createScreen();
screen.startVidaaAudioCheck();
tick(screen, 1);
assert.ok(verified().audio.includes("hls.js"));
video.webkitAudioDecodedByteCount = 0;
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, []);
screen.startVidaaAudioCheck();
tick(screen, 12);
assert.ok(kinds(screen).includes("open-sources"));
PlayerController.playbackEngine = "native-file";

// 10. A startup error on VIDAA goes to the sources list, not the card.
screen = createScreen();
screen.startupErrorMessage = "This file format isn't supported.";
screen.clearStartupError = () => {
  screen.startupErrorMessage = "";
  screen.calls.push(["clear-card"]);
};
assert.equal(screen.presentStartupErrorInVidaaSources(), true);
assert.deepEqual(kinds(screen), ["clear-card", "open-sources", "render-sources"]);
assert.equal(screen.sourcesAlert.title, "Playback Error");
assert.equal(screen.sourcesAlert.message, "This file format isn't supported.");
// Nothing to choose from: keep the card.
screen = createScreen();
screen.streamCandidates = [];
assert.equal(screen.presentStartupErrorInVidaaSources(), false);

// 11. A media error mid-film: restart the source at its position (bounded), then fail
// over (auto-play), then give up to the sources list.
screen = createScreen();
let restarts = 0;
let failovers = 0;
screen.playStreamByUrl = () => (restarts += 1);
screen.tryVidaaAutoPlayNextSource = () => (failovers += 1) < 0;
for (let attempt = 0; attempt < 3; attempt += 1) {
  assert.equal(screen.recoverVidaaPlaybackError({ id: "a" }, 3), true);
}
assert.equal(restarts, 3);
assert.equal(
  screen.recoverVidaaPlaybackError({ id: "a" }, 3),
  false,
  "budget used, no next source"
);
assert.equal(failovers, 1);
assert.equal(
  screen.recoverVidaaPlaybackError({ id: "a" }, 1),
  false,
  "aborted is not a source failure"
);
// Another source (after a failover or a manual pick) starts with a fresh budget.
screen.activePlaybackUrl = "https://debrid.example/token123/b.mkv";
assert.equal(screen.recoverVidaaPlaybackError({ id: "b" }, 3), true);
assert.equal(restarts, 4);

console.info = originalInfo;
console.warn = originalWarn;
console.log("VIDAA audio support player checks passed.");
