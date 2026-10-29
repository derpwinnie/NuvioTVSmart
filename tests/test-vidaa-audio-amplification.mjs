import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
globalThis.fetch = () => {
  throw Error("Unexpected network request");
};

const { PlayerController } = await import("../js/core/player/playerController.js");
const { PlayerScreen } = await import("../js/ui/screens/player/playerScreen.js");
const { Platform } = await import("../js/platform/index.js");

const contexts = [];
class AudioContextFixture {
  constructor() {
    this.state = "suspended";
    this.destination = {};
    this.sources = [];
    this.resumes = 0;
    contexts.push(this);
  }
  createMediaElementSource(video) {
    // Creating this node reroutes audio even when a later gain is set to 1.
    video.routedThroughWebAudio = true;
    const source = { video, connect() {} };
    this.sources.push(source);
    return source;
  }
  createGain() {
    return { gain: { value: 1 }, connect() {} };
  }
  resume() {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
}
globalThis.AudioContext = AudioContextFixture;

function fixture(platform, audioAmplificationDb) {
  globalThis.__NUVIO_PLATFORM__ = platform;
  Platform.current = null;
  PlayerController.video = { src: "https://media.invalid/stream.mkv", muted: false, volume: 1 };
  return {
    ...PlayerScreen,
    audioAmplificationDb,
    persistAudioAmplification: true,
    audioAmplificationAvailable: true,
    audioContext: null,
    audioMediaSource: null,
    audioGainNode: null
  };
}

for (const platform of ["vidaa", "tizen", "webos"]) {
  for (const db of [0, 6, 20]) {
    const ui = fixture(platform, db);
    const before = contexts.length;
    ui.applyAudioAmplification();
    assert.equal(ui.audioAmplificationAvailable, false, `${platform}: boost unavailable`);
    assert.equal(ui.ensureAudioAmplificationGraph(), false);
    assert.equal(contexts.length, before, `${platform}: never reroute native audio`);
    assert.equal(PlayerController.video.routedThroughWebAudio, undefined);
    assert.equal(PlayerController.video.muted, false);
    assert.equal(PlayerController.video.volume, 1);
    // A saved boost must not break the next source or be removed from settings.
    PlayerController.video.src = "https://another.invalid/next.m3u8";
    ui.applyAudioAmplification();
    assert.equal(contexts.length, before);
    assert.equal(ui.audioAmplificationDb, db);
    assert.equal(ui.persistAudioAmplification, true);
  }
}

// Browser playback keeps its existing amplification behavior.
const browser = fixture("browser", 0);
browser.applyAudioAmplification();
assert.equal(browser.audioAmplificationAvailable, true);
assert.equal(browser.audioContext, null, "zero boost leaves browser audio native");
browser.audioAmplificationDb = 6;
browser.applyAudioAmplification();
const context = browser.audioContext;
assert.equal(context.sources.length, 1);
assert.equal(context.sources[0].video, PlayerController.video);
assert.equal(context.resumes, 1);
assert.equal(browser.audioGainNode.gain.value, Math.pow(10, 6 / 20));
browser.audioAmplificationDb = 12;
browser.applyAudioAmplification();
assert.equal(browser.audioContext, context);
assert.equal(context.sources.length, 1);
assert.equal(browser.audioGainNode.gain.value, Math.pow(10, 12 / 20));
browser.audioAmplificationDb = 0;
browser.applyAudioAmplification();
assert.equal(browser.audioGainNode.gain.value, 1);

console.log(
  "PASS: saved audio boost never reroutes VIDAA/Tizen/webOS native audio; browser amplification still works (simulated audio graph, no TV)."
);
