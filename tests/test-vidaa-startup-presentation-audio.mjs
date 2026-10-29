import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.window = new EventTarget();
globalThis.document = {
  getElementById: () => null,
  documentElement: {},
  visibilityState: "visible"
};

const { PlayerController } = await import("../js/ui/screens/player/playerScreenContext.js");
const { createPlayerScreenMethods29 } =
  await import("../js/ui/screens/player/playerScreenMethods-29-sync-post-play-player-surface.js");
const { createPlayerScreenMethods30 } =
  await import("../js/ui/screens/player/playerScreenMethods-30-schedule-buffering-spinner-refresh.js");
const { createPlayerScreenMethods31 } =
  await import("../js/ui/screens/player/playerScreenMethods-31-seek-playback-seconds.js");
const { createPlayerScreenMethods38 } =
  await import("../js/ui/screens/player/playerScreenMethods-38-schedule-playback-stall-guard.js");
const { createPlayerVideoLifecycleHandlers } =
  await import("../js/ui/screens/player/playerVideoLifecycleHandlers.js");

const originalTimers = { setTimeout, clearTimeout, now: Date.now };
let now = 100000;
let nextTimer = 0;
const timers = new Map();
Date.now = () => now;
globalThis.setTimeout = (callback, delay = 0) => {
  const id = ++nextTimer;
  timers.set(id, { callback, at: now + Number(delay || 0) });
  return id;
};
globalThis.clearTimeout = (id) => timers.delete(id);

async function advance(ms) {
  const end = now + ms;
  let steps = 0;
  while (true) {
    const due = [...timers]
      .filter(([, timer]) => timer.at <= end)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    assert.ok(++steps < 100, "Completion timers must remain bounded");
    timers.delete(due[0]);
    now = due[1].at;
    await due[1].callback();
  }
  now = end;
}

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, active) {
      if (active) values.add(name);
      else values.delete(name);
    }
  };
}

function fixture() {
  timers.clear();
  const video = {
    muted: false,
    defaultMuted: false,
    volume: 1,
    readyState: 4,
    currentTime: 12,
    paused: false,
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    }
  };
  Object.assign(PlayerController, {
    video,
    playbackEngine: "native",
    startupAudioGateActive: false,
    startupAudioGatePausesNativePlayback: false,
    startupPresentationAudioMuted: false,
    isUsingAvPlay: () => false,
    getPlaybackReadyState: () => video.readyState,
    getCurrentTimeSeconds: () => video.currentTime,
    syncWebOsPlaybackKeepAwake() {}
  });
  const noop = () => {};
  const screen = {
    ...createPlayerScreenMethods29(),
    ...createPlayerScreenMethods30(),
    ...createPlayerScreenMethods31(),
    ...createPlayerScreenMethods38(),
    activePlaybackUrl: "https://fixture.invalid/audio.m3u8",
    uiRefs: { loadingOverlay: { classList: classList() } },
    loadingVisible: true,
    loadingLogoFillProgress: 1,
    loadingLogoFillTarget: 1,
    hasPresentedPlaybackFrame: false,
    startupPlaybackHasAdvanced: true,
    startupTrackPreferenceReady: true,
    startupAudioGateActive: false,
    startupAudioPreferenceApplied: true,
    startupAudioPreferenceApplying: false,
    startupAudioGateAllowsNativePlayback: false,
    pendingPlaybackRestore: null,
    playbackEngineValidated: true,
    isExternalFrameMode: () => false,
    isStartupErrorVisible() {
      return Boolean(this.startupErrorMessage);
    },
    isBufferingForPauseOverlay: () => false,
    isActiveMountToken: () => true,
    isCurrentSourcePlaybackAttempt: () => true,
    isSeekOverlaySuppressingControls: () => false,
    isVidaaStartupAudioPreferenceWindowPending: () => false,
    hasAudioTracksAvailable: () => false,
    getPlaybackStallTimeoutMs: () => 1000,
    // kvn fork: the undecodable-audio check (methods-74) is covered by its own tests.
    startVidaaAudioCheck: noop,
    clearPlaybackStallGuard() {
      clearTimeout(this.playbackStallTimer);
      this.playbackStallTimer = null;
    },
    setLoadingLogoFillTarget(value) {
      this.loadingLogoFillTarget = value;
      this.loadingLogoFillProgress = value;
    },
    applyStartupAudioFallback() {
      this.startupAudioPreferenceApplied = true;
    },
    clearSourceFallbackDeadline: noop,
    armSourceFallbackDeadline: noop,
    syncLoadingOverlayStatus: noop,
    beginPlaybackEngineValidation: noop,
    warmBitmapSubtitleSharedResources: noop,
    clearStartupAudioPreferenceRetry: noop,
    updateUiTick: noop,
    renderSkipIntroButton: noop,
    renderNextEpisodeCard: noop,
    dismissPauseOverlay: noop,
    maybeShowParentalGuideOverlay: noop
  };
  PlayerController.setStartupPresentationAudioMuted(true);
  return { screen, video };
}

try {
  // The native watchdog can observe decoded frames before the normal logo
  // completion callback. It hides loading directly, without presenting audio.
  {
    const { screen, video } = fixture();
    screen.scheduleLoadingCompletionCheck(200);
    screen.schedulePlaybackStallGuard({ timeoutMs: 100 });
    await advance(100);
    assert.equal(screen.hasPresentedPlaybackFrame, true);
    assert.equal(screen.loadingVisible, false);
    // Upstream 1.2.10 may already release the mute here (updateLoadingVisibility
    // once startup is ready); either way it must be released below.
    await advance(350);
    assert.equal(video.muted, false, "Hidden loading must not cancel pending audio presentation");
    assert.equal(video.defaultMuted, false);
    assert.equal(PlayerController.startupPresentationAudioMuted, false);
  }

  // A source recovery preserves the frame state. The production waiting handler
  // hides loading while a resume seek and language selection are still pending.
  {
    const { screen, video } = fixture();
    screen.hasPresentedPlaybackFrame = true;
    screen.startupPlaybackHasAdvanced = false;
    screen.pendingPlaybackRestore = { timeSeconds: 80, paused: false };
    screen.startupAudioPreferenceApplying = true;
    screen.enableStartupAudioGate({ allowNativePlayback: true, maxWaitMs: 5000 });
    createPlayerVideoLifecycleHandlers.call(screen, video, () => false).onWaiting();
    assert.equal(screen.loadingVisible, false, "Waiting uses the buffering view during recovery");
    screen.scheduleLoadingCompletionCheck(100);
    await advance(500);
    assert.equal(video.muted, true, "Track selection and resume restoration still gate audio");
    screen.startupAudioPreferenceApplying = false;
    await advance(500);
    assert.equal(screen.startupAudioGateActive, false);
    assert.equal(
      video.muted,
      true,
      "Releasing the language gate does not skip pending restoration"
    );
    video.currentTime = 80;
    screen.finalizePendingPlaybackRestore();
    await advance(500);
    assert.equal(
      video.muted,
      false,
      "Restored recovery must eventually present audio with loading hidden"
    );
  }

  // Normal startup must retain the language gate until its selection settles.
  {
    const { screen, video } = fixture();
    screen.hasPresentedPlaybackFrame = true;
    screen.startupAudioPreferenceApplying = true;
    screen.enableStartupAudioGate({ allowNativePlayback: true, maxWaitMs: 5000 });
    screen.scheduleLoadingCompletionCheck(100);
    await advance(500);
    assert.equal(video.muted, true);
    screen.startupAudioPreferenceApplying = false;
    await advance(500);
    assert.equal(video.muted, false);
  }

  for (const mode of ["error", "external"]) {
    const { screen, video } = fixture();
    screen.scheduleLoadingCompletionCheck(100);
    if (mode === "error") screen.startupErrorMessage = "fixture error";
    else screen.isExternalFrameMode = () => true;
    screen.loadingVisible = false;
    await advance(1000);
    assert.equal(video.muted, true, `${mode} does not present a failed or replaced source`);
    assert.equal(timers.size, 0, `${mode} stops pending presentation timers`);
  }

  {
    const { screen, video } = fixture();
    screen.scheduleLoadingCompletionCheck(100);
    // Route cleanup and source fallback both cancel this production timer
    // before stopping the media controller and resetting presentation mute.
    screen.clearLoadingCompletionTimer();
    PlayerController.setStartupPresentationAudioMuted(false);
    await advance(1000);
    assert.equal(
      timers.size,
      0,
      "Cleanup leaves no presentation callback to revive the old source"
    );
    assert.equal(screen.loadingVisible, true, "A cancelled callback cannot change the old UI");
    assert.equal(video.muted, false);
  }
} finally {
  globalThis.setTimeout = originalTimers.setTimeout;
  globalThis.clearTimeout = originalTimers.clearTimeout;
  Date.now = originalTimers.now;
}

console.log(
  "PASS: VIDAA startup audio presentation survives hidden loading, watchdog and source restoration"
);
