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
  vidaaBufferGapArm: { until: Infinity, maxGapSeconds: 20 }
};
// Methods called during initialization are no-ops here.
const screen = new Proxy(state, {
  get: (target, key) => (key in target ? target[key] : () => undefined)
});
initializePlayerMountState.call(screen, {}, "https://example.com/a.mkv");

assert.equal(state.vidaaAutoPlayFailoverAttempts, 0);
assert.equal(state.vidaaBufferGapArm, null);

console.log("VIDAA player mount reset checks passed.");
