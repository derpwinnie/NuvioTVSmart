import assert from "node:assert/strict";
import {
  areAllVidaaAudioCodecsUnsupported,
  createVidaaSilentAudioCheck,
  forgetVidaaUnsupportedAudioCodecs,
  formatVidaaAudioCodecNames,
  learnVidaaUnsupportedAudioCodecs,
  readVidaaUnsupportedAudioCodecs,
  stepVidaaSilentAudioCheck,
  summarizeVidaaAudioProbe,
  syncVidaaAudioMemoryWithBrowser,
  VIDAA_AUDIO_MEMORY_BROWSER_KEY,
  VIDAA_SILENT_AUDIO_UNKNOWN_TRACKS_SECONDS,
  VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY,
  vidaaAudioCodecKey
} from "../js/platform/vidaa/vidaaAudioSupport.js";
import {
  isVidaaMediaCounterVerified,
  markVidaaMediaCounterVerified,
  VIDAA_MEDIA_COUNTERS_VERIFIED_KEY,
  vidaaPlaybackPipeline
} from "../js/platform/vidaa/vidaaMediaCounters.js";

const dtsProbe = summarizeVidaaAudioProbe([
  { type: "audio", codec_id: "A_DTS", isDefault: true },
  { type: "subtitle", codec_id: "S_TEXT/UTF8" }
]);

// Runs one check per sample and returns the verdicts.
function run(samples) {
  let state = createVidaaSilentAudioCheck();
  return samples.map((sample) => {
    const result = stepVidaaSilentAudioCheck(state, {
      decodedBytes: 0,
      probe: dtsProbe,
      ...sample
    });
    state = result.state;
    return result.verdict;
  });
}
const seconds = (count, extra = {}) =>
  Array.from({ length: count }, (_, index) => ({ currentTime: 10 + index, ...extra }));

// --- Probe summary ---
assert.deepEqual(dtsProbe, { audioTrackCount: 1, codecIds: ["A_DTS"], playedCodecId: "A_DTS" });
assert.deepEqual(
  summarizeVidaaAudioProbe([
    { type: "audio", codec_id: "A_AAC", isDefault: false },
    { type: "audio", codec_id: "A_TRUEHD", isDefault: true }
  ]).playedCodecId,
  "A_TRUEHD"
);
assert.equal(
  summarizeVidaaAudioProbe([{ type: "audio", codec_id: "A_AC3", isDefault: false }]).playedCodecId,
  "A_AC3"
);
assert.deepEqual(summarizeVidaaAudioProbe(null), {
  audioTrackCount: 0,
  codecIds: [],
  playedCodecId: ""
});
assert.equal(vidaaAudioCodecKey({ codec: "dts" }), "A_DTS");
assert.equal(vidaaAudioCodecKey({ codec_id: "a_eac3" }), "A_EAC3");
assert.equal(vidaaAudioCodecKey({ codec: "mystery" }), "");

// --- (a) Silent-audio decision ---
// Five seconds of advancing playback with no decoded audio: unsupported.
assert.deepEqual(run(seconds(6)), ["wait", "wait", "wait", "wait", "wait", "unsupported"]);

// Decoded audio: fine, stop checking.
assert.deepEqual(run([{ currentTime: 1, decodedBytes: 4096 }]), ["ok"]);

// No byte counter (other browsers): never flag.
assert.deepEqual(run(seconds(10, { decodedBytes: undefined }))[0], "skip");

// Paused or seeking time does not count, and a seek jump does not count.
assert.ok(!run(seconds(10, { paused: true })).includes("unsupported"));
assert.ok(!run(seconds(10, { seeking: true })).includes("unsupported"));
assert.ok(
  !run([0, 120, 240, 360, 480, 600].map((time) => ({ currentTime: time }))).includes("unsupported")
);
// Stuck time (buffering) does not count either.
assert.ok(!run(seconds(10).map(() => ({ currentTime: 42 }))).includes("unsupported"));

// No track info (probe not there yet, or empty for MP4 / HLS / unreadable headers):
// silence only counts after the longer wait.
for (const probe of [null, { audioTrackCount: 0, codecIds: [] }]) {
  const verdicts = run(seconds(VIDAA_SILENT_AUDIO_UNKNOWN_TRACKS_SECONDS + 1, { probe }));
  assert.equal(verdicts.indexOf("unsupported"), VIDAA_SILENT_AUDIO_UNKNOWN_TRACKS_SECONDS);
}
// The probe arriving later shortens the wait to the normal 5 s.
assert.equal(run([...seconds(5, { probe: null }), { currentTime: 15 }]).at(-1), "unsupported");

// --- (b) Unsupported-codec memory ---
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: (key, fallback) => (key in data ? data[key] : fallback),
    set: (key, value) => (data[key] = value)
  };
}
const storage = memoryStorage();
assert.equal(readVidaaUnsupportedAudioCodecs(storage).size, 0);
learnVidaaUnsupportedAudioCodecs(storage, ["A_DTS"]);
learnVidaaUnsupportedAudioCodecs(storage, ["A_DTS", "", "junk"]);
assert.deepEqual(storage.data[VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY], ["A_DTS"]);
const known = readVidaaUnsupportedAudioCodecs(storage);
assert.equal(areAllVidaaAudioCodecsUnsupported(["A_DTS", "A_DTS"], known), true);
// One playable (or unknown) track keeps the source.
assert.equal(areAllVidaaAudioCodecsUnsupported(["A_DTS", "A_AAC"], known), false);
assert.equal(areAllVidaaAudioCodecsUnsupported(["A_DTS", ""], known), false);
assert.equal(areAllVidaaAudioCodecsUnsupported([], known), false);
assert.equal(areAllVidaaAudioCodecsUnsupported(["A_DTS"], new Set()), false);

// Storage failures are tolerated.
const broken = {
  get() {
    throw new Error("blocked");
  },
  set() {
    throw new Error("quota");
  }
};
assert.equal(readVidaaUnsupportedAudioCodecs(broken).size, 0);
assert.deepEqual([...learnVidaaUnsupportedAudioCodecs(broken, ["A_TRUEHD"])], ["A_TRUEHD"]);
assert.equal(
  readVidaaUnsupportedAudioCodecs(memoryStorage({ [VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY]: "x" }))
    .size,
  0
);
assert.equal(readVidaaUnsupportedAudioCodecs(null).size, 0);

assert.equal(formatVidaaAudioCodecNames(["A_DTS", "A_TRUEHD", "A_DTS"]), "DTS/TrueHD");

// A codec that decodes after all is forgotten; others stay.
learnVidaaUnsupportedAudioCodecs(storage, ["A_TRUEHD"]);
assert.deepEqual([...forgetVidaaUnsupportedAudioCodecs(storage, ["a_dts"])], ["A_TRUEHD"]);
assert.deepEqual(storage.data[VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY], ["A_TRUEHD"]);
assert.deepEqual([...forgetVidaaUnsupportedAudioCodecs(broken, ["A_DTS"])], []);

// --- (c) Memory follows the browser version ---
{
  const memory = memoryStorage({
    [VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY]: ["A_DTS"],
    [VIDAA_MEDIA_COUNTERS_VERIFIED_KEY]: { audio: ["native"] }
  });
  // First run with this key (older build): start over once, not reported as a change.
  assert.equal(syncVidaaAudioMemoryWithBrowser(memory, "VIDAA/7"), false);
  assert.deepEqual(memory.data[VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY], []);
  memory.data[VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY] = ["A_DTS"];
  markVidaaMediaCounterVerified(memory, "audio", "native");
  // Same browser: kept.
  assert.equal(syncVidaaAudioMemoryWithBrowser(memory, "VIDAA/7"), false);
  assert.deepEqual(memory.data[VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY], ["A_DTS"]);
  // Firmware update: both cleared.
  assert.equal(syncVidaaAudioMemoryWithBrowser(memory, "VIDAA/8"), true);
  assert.deepEqual(memory.data[VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY], []);
  assert.equal(isVidaaMediaCounterVerified(memory, "audio", "native"), false);
  assert.equal(memory.data[VIDAA_AUDIO_MEMORY_BROWSER_KEY], "VIDAA/8");
  assert.equal(syncVidaaAudioMemoryWithBrowser(broken, "VIDAA/8"), false);
}

// --- (d) Missing picture ---
{
  const { checkVidaaVideoPresence } = await import("../js/platform/vidaa/vidaaVideoSupport.js");
  assert.equal(checkVidaaVideoPresence({ videoWidth: 1920, playedSeconds: 9 }), "ok");
  assert.equal(checkVidaaVideoPresence({ decodedVideoBytes: 10, playedSeconds: 9 }), "ok");
  assert.equal(
    checkVidaaVideoPresence({ videoWidth: 0, decodedVideoBytes: 0, playedSeconds: 4 }),
    "wait"
  );
  assert.equal(
    checkVidaaVideoPresence({ videoWidth: 0, decodedVideoBytes: 0, playedSeconds: 5 }),
    "missing"
  );
  // No byte counter API: the picture size alone decides.
  assert.equal(checkVidaaVideoPresence({ videoWidth: 0, playedSeconds: 6 }), "missing");
}

console.log("VIDAA audio support checks passed.");

// Counter verification memory: per kind and per pipeline.
{
  const values = new Map();
  const fakeStore = {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    set: (key, value) => values.set(key, value)
  };
  assert.equal(vidaaPlaybackPipeline("native-file"), "native");
  assert.equal(vidaaPlaybackPipeline(undefined), "native");
  assert.equal(vidaaPlaybackPipeline("hls.js"), "hls.js");
  assert.equal(vidaaPlaybackPipeline("native-hls"), "native-hls");
  assert.equal(isVidaaMediaCounterVerified(fakeStore, "audio", "native-file"), false);
  markVidaaMediaCounterVerified(fakeStore, "audio", "native-file");
  assert.equal(isVidaaMediaCounterVerified(fakeStore, "audio", "native"), true);
  // A plain file proves nothing for MSE playback, or for the picture.
  assert.equal(isVidaaMediaCounterVerified(fakeStore, "audio", "hls.js"), false);
  assert.equal(isVidaaMediaCounterVerified(fakeStore, "audio", "native-hls"), false);
  assert.equal(isVidaaMediaCounterVerified(fakeStore, "video", "native"), false);
  markVidaaMediaCounterVerified(fakeStore, "audio", "hls.js");
  markVidaaMediaCounterVerified(fakeStore, "audio", "hls.js");
  assert.deepEqual(values.get(VIDAA_MEDIA_COUNTERS_VERIFIED_KEY), { audio: ["native", "hls.js"] });
  const broken = {
    get: () => {
      throw new Error("blocked");
    },
    set: () => {
      throw new Error("blocked");
    }
  };
  assert.equal(isVidaaMediaCounterVerified(broken, "audio", "native"), false);
  markVidaaMediaCounterVerified(broken, "audio", "native");
  console.log("VIDAA media counter verification checks passed.");
}

// Counter self-test with fake <audio> elements.
{
  const { probeVidaaAudioCounter } = await import("../js/platform/vidaa/vidaaAudioSupport.js");
  const fakeAudio = (bytesAfterPlay, { rejectPlay = false, api = true } = {}) => {
    const audio = {
      muted: false,
      src: "",
      pause() {},
      removeAttribute() {},
      load() {},
      play: () => {
        if (rejectPlay) return Promise.reject(new Error("NotAllowedError"));
        audio.webkitAudioDecodedByteCount = bytesAfterPlay;
        return Promise.resolve();
      }
    };
    if (api) audio.webkitAudioDecodedByteCount = 0;
    return audio;
  };
  assert.equal(await probeVidaaAudioCounter(() => fakeAudio(65), 0), true, "counting device");
  assert.equal(await probeVidaaAudioCounter(() => fakeAudio(0), 0), false, "silent counter");
  assert.equal(
    await probeVidaaAudioCounter(() => fakeAudio(65, { api: false }), 0),
    false,
    "no counter API"
  );
  assert.equal(
    await probeVidaaAudioCounter(() => fakeAudio(65, { rejectPlay: true }), 0),
    false,
    "autoplay blocked"
  );
  assert.equal(
    await probeVidaaAudioCounter(() => {
      throw new Error("no DOM");
    }, 0),
    false,
    "no DOM"
  );
  const muted = fakeAudio(65);
  await probeVidaaAudioCounter(() => muted, 0);
  assert.equal(muted.muted, true, "the probe plays muted");
  console.log("VIDAA audio counter self-test checks passed.");
}
