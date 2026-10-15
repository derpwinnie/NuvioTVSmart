import assert from "node:assert/strict";

// VIDAA lets the video run during the startup audio gate. The remembered (per series)
// or preferred audio track must still win: the gate may not latch the default track
// on the first frame while the MKV header (track list) is still being read, and a
// track list that arrives late while the gate is open re-opens the match.
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key)
};
globalThis.location = { search: "?wrapper=vidaa", hostname: "example.github.io" };

const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");
const { createPlayerScreenMethods39 } =
  await import("../js/ui/screens/player/playerScreenMethods-39-refresh-track-dialogs.js");
const { PlayerController } = await import("../js/ui/screens/player/playerScreenContext.js");

PlayerController.video = { readyState: 4 };
PlayerController.getPlaybackReadyState = () => 4;

function createScreen({ discoveryPending = true, deadlineInMs = 3000 } = {}) {
  const calls = [];
  const state = {
    ...createPlayerScreenMethods30(),
    ...createPlayerScreenMethods39(),
    calls,
    startupAudioGateActive: true,
    startupAudioGateAllowsNativePlayback: true,
    startupAudioGateDeadline: Date.now() + deadlineInMs,
    hasPresentedPlaybackFrame: true,
    startupAudioPreferenceApplied: false,
    startupAudioFallbackApplied: false,
    pendingWebOsAudioSelection: null,
    startupTrackPreferenceReady: true,
    subtitleDialogVisible: false,
    audioDialogVisible: false,
    trackSignature: "default-only",
    isAudioPreferenceDiscoveryPending: () => discoveryPending,
    getStartupAudioTrackSetSignature: () => state.trackSignature,
    applyStartupAudioFallback: () => {
      calls.push("fallback");
      state.startupAudioFallbackApplied = true;
      state.startupAudioPreferenceApplied = true;
      return true;
    },
    applyStartupAudioPreference: () => {
      if (state.startupAudioPreferenceApplied) return false;
      calls.push("preference");
      state.startupAudioPreferenceApplied = true;
      return true;
    }
  };
  return new Proxy(state, {
    get: (target, key) => (key in target ? target[key] : () => undefined)
  });
}

// 1. First frame while the track list is still loading: keep waiting, no fallback.
let screen = createScreen();
assert.equal(screen.isStartupGateReleaseReady(), false);
assert.deepEqual(screen.calls, []);

// 2. Tracks known: the gate releases with whatever the preference step chose.
screen = createScreen({ discoveryPending: false });
assert.equal(screen.isStartupGateReleaseReady(), true);
assert.deepEqual(screen.calls, ["fallback"], "no preference applied before: fallback as before");

// 3. Discovery never settles: the bounded deadline still releases (no endless mute).
screen = createScreen({ deadlineInMs: -1 });
assert.equal(screen.isStartupGateReleaseReady(), true);
assert.deepEqual(screen.calls, ["fallback"]);

// 4. The full track list arrives after a fallback while the gate is still open:
// matching re-opens and the remembered/preferred track is applied.
screen = createScreen({ discoveryPending: false });
screen.refreshTrackDialogs();
screen.applyStartupAudioFallback();
screen.calls.length = 0;
screen.trackSignature = "de,en";
screen.refreshTrackDialogs();
assert.deepEqual(screen.calls, ["preference"]);

// 5. After the gate is released, a late track list does not switch audio mid-film.
screen = createScreen({ discoveryPending: false });
screen.refreshTrackDialogs();
screen.applyStartupAudioFallback();
screen.releaseStartupAudioGate();
screen.calls.length = 0;
screen.trackSignature = "de,en";
screen.refreshTrackDialogs();
assert.deepEqual(screen.calls, []);

console.log("VIDAA startup audio preference checks passed.");
