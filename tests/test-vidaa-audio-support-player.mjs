import assert from "node:assert/strict";

// Wire-up of the VIDAA audio check in the player (methods file 74) with a fake
// screen and video element. The decisions themselves are tested in
// test-vidaa-audio-support.mjs.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.location = { search: "?wrapper=vidaa", hostname: "example.github.io" };
const originalInfo = console.info;
const originalWarn = console.warn;
const logs = [];
console.info = (...args) => logs.push(args);
console.warn = (...args) => logs.push(args);

const { createPlayerScreenMethods74 } =
  await import("../js/ui/screens/player/playerScreenMethods-74-vidaa-audio-support.js");
const { PlayerController } = await import("../js/ui/screens/player/playerScreenContext.js");
const { VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY, VIDAA_AUDIO_COUNTER_VERIFIED_KEY } =
  await import("../js/platform/vidaa/vidaaAudioSupport.js");

const URL_A = "https://debrid.example/token123/a.mkv";
const DTS_TRACKS = [{ type: "audio", codec_id: "A_DTS", isDefault: true }];

function createScreen({ eligibility = "eligible", next = { id: "b" } } = {}) {
  const calls = [];
  const state = {
    ...createPlayerScreenMethods74(),
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
    sourcesError: null,
    calls,
    getStreamCandidateByUrl: () => state.streamCandidates[0],
    getVidaaAutoPlayFailoverContext: () => ({ settings: {}, eligibility }),
    pickVidaaAutoPlayFailoverCandidate: () => next,
    startVidaaAutoPlayFailover: (failed, candidate) =>
      calls.push(["failover", failed.id, candidate.id]),
    showAspectToast: (label, options) => calls.push(["toast", label, options?.durationMs]),
    showStartupError: (message) => calls.push(["startup-error", message]),
    openSourcesPanel: () => calls.push(["open-sources"]),
    renderSourcesPanel: () => calls.push(["render-sources"]),
    formatPlaybackErrorForSources: (message) => message,
    markPlaybackSourceFailed: () => calls.push(["failed"])
  };
  return new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : () => undefined)
  });
}

const video = { webkitAudioDecodedByteCount: 0, currentTime: 10, paused: false, seeking: false };
PlayerController.video = video;
let pauses = 0;
PlayerController.pause = () => (pauses += 1);
const tick = (screen, count) => {
  for (let index = 0; index < count; index += 1) {
    video.currentTime += 1;
    screen.runVidaaAudioCheck();
  }
};

// 0. Until this device's counter has counted audio once, silence proves nothing:
// a TV decoding audio outside the browser would report 0 for every source.
let screen = createScreen();
screen.startVidaaAudioCheck();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
tick(screen, 6);
assert.deepEqual(screen.calls, [], "unverified counter: no reaction");
assert.equal(store.has(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY), false, "nothing learned");
assert.ok(JSON.stringify(logs).includes("counter-not-verified"));
// A source that decodes audio verifies the counter for later checks.
screen = createScreen();
video.webkitAudioDecodedByteCount = 4096;
screen.startVidaaAudioCheck();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
tick(screen, 1);
assert.equal(JSON.parse(store.get(VIDAA_AUDIO_COUNTER_VERIFIED_KEY)), true);
video.webkitAudioDecodedByteCount = 0;

// 1. Auto-picked source, silent DTS audio: fail over after 5 s and learn the codec.
screen = createScreen();
screen.startVidaaAudioCheck();
tick(screen, 3);
assert.equal(screen.calls.length, 0, "no verdict before the probe and 5 s");
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
tick(screen, 3);
assert.deepEqual(
  screen.calls.map(([kind]) => kind),
  ["failed", "toast", "failover"]
);
assert.match(screen.calls[1][1], /\(DTS\)/);
assert.equal(screen.vidaaAudioCheckTimer, null, "timer cleared after the verdict");
assert.equal(JSON.parse(store.get(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY)).join(), "A_DTS");
// Only once per source playback.
screen.startVidaaAudioCheck();
assert.equal(screen.vidaaAudioCheckTimer, null);
assert.ok(!JSON.stringify(logs).includes("token123"), "no stream URL in logs");

// 2. Manually picked source with a remembered codec: sources panel without waiting.
screen = createScreen({ eligibility: "manual-selection" });
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
video.currentTime = 10;
screen.startVidaaAudioCheck();
assert.deepEqual(
  screen.calls.map(([kind]) => kind),
  ["failed", "open-sources"]
);
assert.equal(pauses, 1);
assert.equal(screen.paused, true);
assert.match(screen.sourcesError, /\(DTS\).*another source/);

// 3. Auto-play with no candidate left: startup error.
screen = createScreen({ next: null });
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
assert.deepEqual(
  screen.calls.map(([kind]) => kind),
  ["failed", "startup-error"]
);
assert.match(screen.calls[1][1], /None of the remaining sources/);

// 4. A playable track next to a remembered one, decoding audio: nothing happens.
screen = createScreen();
screen.recordVidaaAudioProbe(URL_A, [...DTS_TRACKS, { type: "audio", codec_id: "A_AAC" }]);
screen.startVidaaAudioCheck();
video.webkitAudioDecodedByteCount = 2048;
tick(screen, 8);
assert.equal(screen.calls.length, 0);
assert.equal(screen.vidaaAudioCheckTimer, null);

// 5. No byte counter API: skipped, never flagged.
delete video.webkitAudioDecodedByteCount;
store.clear();
screen = createScreen();
screen.recordVidaaAudioProbe(URL_A, DTS_TRACKS);
screen.startVidaaAudioCheck();
tick(screen, 8);
assert.equal(screen.calls.length, 0);
assert.equal(screen.vidaaAudioCheckTimer, null);

// 6. A probe for another URL is ignored and a source change stops the check.
video.webkitAudioDecodedByteCount = 0;
screen = createScreen();
screen.recordVidaaAudioProbe("https://debrid.example/other.mkv", DTS_TRACKS);
screen.startVidaaAudioCheck();
tick(screen, 8);
assert.equal(screen.calls.length, 0);
screen.activePlaybackUrl = "https://debrid.example/next.mkv";
screen.runVidaaAudioCheck();
assert.equal(screen.vidaaAudioCheckTimer, null);

console.info = originalInfo;
console.warn = originalWarn;
console.log("VIDAA audio support player checks passed.");
