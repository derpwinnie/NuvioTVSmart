/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import {
  advanceVidaaPlayedSeconds,
  areAllVidaaAudioCodecsUnsupported,
  createVidaaSilentAudioCheck,
  forgetVidaaUnsupportedAudioCodecs,
  isVidaaAudioCounterVerified,
  markVidaaAudioCounterVerified,
  probeVidaaAudioCounter,
  formatVidaaAudioCodecNames,
  learnVidaaUnsupportedAudioCodecs,
  readVidaaUnsupportedAudioCodecs,
  stepVidaaSilentAudioCheck,
  summarizeVidaaAudioProbe,
  syncVidaaAudioMemoryWithBrowser,
  VIDAA_REMEMBERED_CODEC_GRACE_SECONDS,
  VIDAA_SILENT_AUDIO_CHECK_INTERVAL_MS
} from "../../../platform/vidaa/vidaaAudioSupport.js";
import { checkVidaaVideoPresence } from "../../../platform/vidaa/vidaaVideoSupport.js";

// VIDAA: a source whose audio or video the TV cannot decode plays without an error
// (silent, or sound over a black picture). Check each playback once its time advances
// and hand a failure to handleVidaaSourceFailure (methods 75): fail over (auto-play)
// or open the sources list with an alert. See vidaaAudioSupport.js / vidaaVideoSupport.js.
// One counter self-test per app session: null = not run, a Promise = running,
// true/false = result.
let counterProbe = null;
// The learned memory is checked against the browser version once per app session.
let memorySynced = false;

function syncVidaaAudioMemoryOnce() {
  if (memorySynced) return;
  memorySynced = true;
  if (syncVidaaAudioMemoryWithBrowser(LocalStore, globalThis.navigator?.userAgent)) {
    console.info("VIDAA audio support memory reset", { reason: "browser-changed" });
  }
}

function ensureVidaaAudioCounterProbe() {
  if (counterProbe !== null || isVidaaAudioCounterVerified(LocalStore)) return;
  counterProbe = probeVidaaAudioCounter().then((counts) => {
    if (counts) markVidaaAudioCounterVerified(LocalStore);
    counterProbe = counts;
    return counts;
  });
}

// Test hook: forget the session's self-test result and browser check.
export function resetVidaaAudioCounterProbe() {
  counterProbe = null;
  memorySynced = false;
}

export function createPlayerScreenMethods74() {
  const { PlayerController, Environment, t } = internals;

  return {
    // Called with the track probe result of `probeUrl` (the MKV header read).
    recordVidaaAudioProbe(probeUrl, tracks) {
      if (!Environment.isVidaa()) {
        return;
      }
      this.vidaaAudioProbe = { url: String(probeUrl || ""), ...summarizeVidaaAudioProbe(tracks) };
      if (this.vidaaAudioProbe.url === String(this.activePlaybackUrl || "")) {
        this.forgetVidaaCodecIfDecoding(this.vidaaAudioProbe, PlayerController.video?.webkitAudioDecodedByteCount);
      }
      if (this.vidaaAudioCheckTimer && this.vidaaAudioProbe.url === this.vidaaAudioCheckUrl) {
        this.runVidaaAudioCheck();
      }
    },
    // Starts the check for the active source once its first frame is shown.
    startVidaaAudioCheck() {
      const url = String(this.activePlaybackUrl || "");
      if (!Environment.isVidaa() || !url || this.vidaaAudioCheckTimer || this.vidaaAudioCheckDoneUrl === url) {
        return;
      }
      syncVidaaAudioMemoryOnce();
      this.vidaaAudioCheckUrl = url;
      this.vidaaAudioCheckState = createVidaaSilentAudioCheck();
      this.vidaaAudioCheckAudioDone = false;
      this.vidaaVideoCheckState = createVidaaSilentAudioCheck();
      this.vidaaVideoCheckDone = false;
      this.vidaaAudioCheckTimer = setInterval(() => this.runVidaaAudioCheck(), VIDAA_SILENT_AUDIO_CHECK_INTERVAL_MS);
      // Start the one-time counter self-test now so its result is in before a verdict.
      ensureVidaaAudioCounterProbe();
      this.runVidaaAudioCheck();
    },
    stopVidaaAudioCheck() {
      if (this.vidaaAudioCheckTimer) {
        clearInterval(this.vidaaAudioCheckTimer);
      }
      this.vidaaAudioCheckTimer = null;
      this.vidaaAudioCheckState = null;
      this.vidaaVideoCheckState = null;
      this.vidaaAudioCheckUrl = "";
    },
    // Every playback start (also a manual switch back to a source checked before) gets a
    // fresh check; the done marker only prevents re-checking within one playback.
    resetVidaaAudioCheckForNewPlayback() {
      this.stopVidaaAudioCheck();
      this.vidaaAudioCheckDoneUrl = "";
    },
    finishVidaaAudioCheck() {
      this.vidaaAudioCheckDoneUrl = this.vidaaAudioCheckUrl;
      this.stopVidaaAudioCheck();
    },
    getVidaaAudioProbeForCheck() {
      const probe = this.vidaaAudioProbe;
      return probe && probe.url === this.vidaaAudioCheckUrl ? probe : null;
    },
    // A codec on the unsupported list that decodes now (e.g. after a firmware update)
    // is taken off the list.
    forgetVidaaCodecIfDecoding(probe, decodedBytes) {
      const codecId = probe?.playedCodecId;
      if (!codecId || !(Number(decodedBytes) > 0) || !readVidaaUnsupportedAudioCodecs(LocalStore).has(codecId)) {
        return;
      }
      forgetVidaaUnsupportedAudioCodecs(LocalStore, [codecId]);
      console.info("VIDAA audio codec decodes now; removed from the unsupported list", { codecId });
    },
    runVidaaAudioCheck() {
      if (!this.vidaaAudioCheckTimer) {
        return;
      }
      if (String(this.activePlaybackUrl || "") !== this.vidaaAudioCheckUrl) {
        // The source changed without going through playStreamByUrl.
        this.stopVidaaAudioCheck();
        return;
      }
      const video = PlayerController.video;
      const playback = {
        currentTime: video?.currentTime,
        paused: Boolean(this.paused || video?.paused),
        seeking: Boolean(video?.seeking || this.seekOverlayVisible || this.bufferingActive)
      };
      if (!this.vidaaVideoCheckDone && this.runVidaaVideoCheckStep(video, playback)) {
        return;
      }
      if (!this.vidaaAudioCheckAudioDone && this.runVidaaAudioCheckStep(video, playback)) {
        return;
      }
      if (this.vidaaVideoCheckDone && this.vidaaAudioCheckAudioDone) {
        this.finishVidaaAudioCheck();
      }
    },
    // Returns true when the check ended with a failure (handled already).
    runVidaaVideoCheckStep(video, playback) {
      this.vidaaVideoCheckState = advanceVidaaPlayedSeconds(this.vidaaVideoCheckState, playback);
      const presence = checkVidaaVideoPresence({
        videoWidth: video?.videoWidth,
        videoHeight: video?.videoHeight,
        decodedVideoBytes: video?.webkitVideoDecodedByteCount,
        playedSeconds: this.vidaaVideoCheckState.playedSeconds
      });
      if (presence === "wait") {
        return false;
      }
      this.vidaaVideoCheckDone = true;
      if (presence === "ok") {
        return false;
      }
      const playedSeconds = Math.round(this.vidaaVideoCheckState.playedSeconds);
      this.finishVidaaAudioCheck();
      this.reportVidaaUndecodableMedia("video", { detectedBy: "no-picture", playedSeconds });
      return true;
    },
    // Returns true when the check ended with a failure (handled already).
    runVidaaAudioCheckStep(video, playback) {
      const probe = this.getVidaaAudioProbeForCheck();
      const decodedBytes = video?.webkitAudioDecodedByteCount;
      const { state, verdict } = stepVidaaSilentAudioCheck(this.vidaaAudioCheckState, {
        ...playback,
        decodedBytes,
        probe
      });
      this.vidaaAudioCheckState = state;
      if (verdict === "ok") {
        markVidaaAudioCounterVerified(LocalStore);
        this.forgetVidaaCodecIfDecoding(probe, decodedBytes);
        this.vidaaAudioCheckAudioDone = true;
        return false;
      }
      if (verdict === "skip") {
        console.info("VIDAA audio check skipped", { reason: "no-decoded-byte-counter" });
        this.vidaaAudioCheckAudioDone = true;
        return false;
      }
      // Codecs this device already failed on: no need to wait the full time, but give
      // a short grace so a codec that decodes by now (firmware update) can prove it.
      const remembered = probe && areAllVidaaAudioCodecsUnsupported(probe.codecIds, readVidaaUnsupportedAudioCodecs(LocalStore));
      if (remembered && state.playedSeconds >= VIDAA_REMEMBERED_CODEC_GRACE_SECONDS) {
        this.finishVidaaAudioCheck();
        this.reportVidaaUndecodableMedia("audio", { probe, detectedBy: "remembered-codec" });
        return true;
      }
      if (verdict === "wait") {
        return false;
      }
      // verdict "unsupported": silence only counts once this device's counter has
      // counted audio (see VIDAA_AUDIO_COUNTER_VERIFIED_KEY).
      if (!isVidaaAudioCounterVerified(LocalStore)) {
        ensureVidaaAudioCounterProbe();
        if (counterProbe instanceof Promise) {
          // The self-test is still running: check again on the next tick.
          return false;
        }
        console.info("VIDAA audio check skipped", { reason: "counter-not-verified" });
        this.vidaaAudioCheckAudioDone = true;
        return false;
      }
      const playedSeconds = Math.round(state.playedSeconds);
      this.finishVidaaAudioCheck();
      // Learn only the codec the browser actually tried to play (unknown without a probe).
      if (probe?.playedCodecId) {
        learnVidaaUnsupportedAudioCodecs(LocalStore, [probe.playedCodecId]);
      }
      this.reportVidaaUndecodableMedia("audio", { probe, detectedBy: "silent-playback", playedSeconds });
      return true;
    },
    reportVidaaUndecodableMedia(kind, { probe = null, detectedBy = "", playedSeconds = 0 } = {}) {
      const playbackUrl = this.activePlaybackUrl;
      const candidate = this.getStreamCandidateByUrl(playbackUrl) || this.getCurrentStreamCandidate();
      const codecIds = detectedBy === "silent-playback" && probe?.playedCodecId ? [probe.playedCodecId] : probe?.codecIds || [];
      const codec = formatVidaaAudioCodecNames(codecIds);
      // Codec ids, list positions and seconds only: stream URLs carry tokens.
      console.warn(`VIDAA: source ${kind} cannot be decoded on this device`, {
        codecIds: probe?.codecIds || [],
        detectedBy,
        playedSeconds,
        sourceIndex: this.streamCandidates.indexOf(candidate)
      });
      if (kind === "video") {
        this.handleVidaaSourceFailure({
          candidate,
          playbackUrl,
          title: t("player_vidaa_video_unsupported_title", {}, "Video not supported"),
          message: t("player_vidaa_video_unsupported", {}, "This source's video can't be shown on this device."),
          failoverToast: t(
            "player_vidaa_video_unsupported_trying_next",
            {},
            "This source's video can't be shown on this device. Trying the next source…"
          ),
          logMessage: "VIDAA auto-play: source video unsupported, trying the next one"
        });
        return;
      }
      this.handleVidaaSourceFailure({
        candidate,
        playbackUrl,
        title: t("player_vidaa_audio_unsupported_title", {}, "Audio not supported"),
        message: codec
          ? t("player_vidaa_audio_unsupported", { codec }, `This source's audio (${codec}) isn't supported on this device.`)
          : t("player_vidaa_audio_unsupported_unknown", {}, "This source's audio isn't supported on this device."),
        failoverToast: codec
          ? t(
              "player_vidaa_audio_unsupported_trying_next",
              { codec },
              `This source's audio (${codec}) isn't supported on this device. Trying the next source…`
            )
          : t(
              "player_vidaa_audio_unsupported_unknown_trying_next",
              {},
              "This source's audio isn't supported on this device. Trying the next source…"
            ),
        logMessage: "VIDAA auto-play: source audio unsupported, trying the next one"
      });
    }
  };
}
