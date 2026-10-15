import assert from "node:assert/strict";

// The player screen is a singleton: per-playback VIDAA state must reset on every mount.
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const originalError = console.error;
console.error = () => {};
const { initializePlayerMountState } =
  await import("../js/ui/screens/player/playerMountStateInitialization.js");
console.error = originalError;

const state = {
  vidaaAutoPlayFailoverAttempts: 3,
  vidaaUserPickedSource: true,
  vidaaBufferGapArm: { until: Infinity, maxGapSeconds: 20 },
  vidaaAudioCheckDoneUrl: "https://example.com/old.mkv",
  vidaaAudioProbe: { url: "https://example.com/old.mkv", audioTrackCount: 1, codecIds: ["A_DTS"] }
};
// Methods called during initialization are no-ops here.
const screen = new Proxy(state, {
  get: (target, key) => (key in target ? target[key] : () => undefined)
});
initializePlayerMountState.call(screen, {}, "https://example.com/a.mkv");

assert.equal(state.vidaaAutoPlayFailoverAttempts, 0);
assert.equal(state.vidaaBufferGapArm, null);
assert.equal(state.vidaaUserPickedSource, false);
assert.equal(state.vidaaAudioCheckDoneUrl, "");
assert.equal(state.vidaaAudioProbe, null);
assert.equal(state.vidaaAudioCheckTimer, null);

console.log("VIDAA player mount reset checks passed.");
