import assert from "node:assert/strict";
import {
  areAllVidaaAudioCodecsUnsupported,
  createVidaaSilentAudioCheck,
  decideVidaaAudioUnsupportedReaction,
  formatVidaaAudioCodecNames,
  learnVidaaUnsupportedAudioCodecs,
  readVidaaUnsupportedAudioCodecs,
  stepVidaaSilentAudioCheck,
  summarizeVidaaAudioProbe,
  VIDAA_SILENT_AUDIO_PROBE_WAIT_SECONDS,
  VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY,
  vidaaAudioCodecKey
} from "../js/platform/vidaa/vidaaAudioSupport.js";

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

// Video-only file: silent on purpose.
assert.equal(run(seconds(6, { probe: { audioTrackCount: 0, codecIds: [] } }))[5], "skip");

// Probe unknown: wait for it, flag once it arrives, give up when it never does.
const unknown = run(seconds(VIDAA_SILENT_AUDIO_PROBE_WAIT_SECONDS + 2, { probe: null }));
assert.ok(!unknown.includes("unsupported"));
assert.equal(unknown.at(-1), "skip");
assert.equal(run([...seconds(8, { probe: null }), { currentTime: 18 }]).at(-1), "unsupported");

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

// --- (c) Reaction ---
assert.deepEqual(
  decideVidaaAudioUnsupportedReaction({ eligibility: "eligible", hasNextCandidate: true }),
  {
    action: "failover",
    openSourcesPanel: false
  }
);
assert.equal(
  decideVidaaAudioUnsupportedReaction({ eligibility: "eligible", hasNextCandidate: false }).action,
  "error"
);
assert.deepEqual(
  decideVidaaAudioUnsupportedReaction({
    eligibility: "manual-selection",
    hasNextCandidate: true,
    candidateCount: 3
  }),
  { action: "sources-panel", openSourcesPanel: true }
);
assert.deepEqual(
  decideVidaaAudioUnsupportedReaction({ eligibility: "auto-play-off", candidateCount: 1 }),
  {
    action: "sources-panel",
    openSourcesPanel: false
  }
);

console.log("VIDAA audio support checks passed.");

// Counter verification memory.
{
  const { isVidaaAudioCounterVerified, markVidaaAudioCounterVerified } =
    await import("../js/platform/vidaa/vidaaAudioSupport.js");
  const values = new Map();
  const fakeStore = {
    get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    set: (key, value) => values.set(key, value)
  };
  assert.equal(isVidaaAudioCounterVerified(fakeStore), false);
  markVidaaAudioCounterVerified(fakeStore);
  assert.equal(isVidaaAudioCounterVerified(fakeStore), true);
  const broken = {
    get: () => {
      throw new Error("blocked");
    },
    set: () => {
      throw new Error("blocked");
    }
  };
  assert.equal(isVidaaAudioCounterVerified(broken), false);
  markVidaaAudioCounterVerified(broken);
  console.log("VIDAA audio counter verification checks passed.");
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
