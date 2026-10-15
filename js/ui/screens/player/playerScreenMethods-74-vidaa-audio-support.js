/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import {
  areAllVidaaAudioCodecsUnsupported,
  createVidaaSilentAudioCheck,
  decideVidaaAudioUnsupportedReaction,
  isVidaaAudioCounterVerified,
  markVidaaAudioCounterVerified,
  probeVidaaAudioCounter,
  formatVidaaAudioCodecNames,
  learnVidaaUnsupportedAudioCodecs,
  readVidaaUnsupportedAudioCodecs,
  stepVidaaSilentAudioCheck,
  summarizeVidaaAudioProbe,
  VIDAA_SILENT_AUDIO_CHECK_INTERVAL_MS
} from "../../../platform/vidaa/vidaaAudioSupport.js";

// VIDAA: a source whose audio the TV cannot decode plays silently without an
// error. Check it once per source after the first frame and fail over (auto-play)
// or open the sources panel with an alert. See vidaaAudioSupport.js.
// One counter self-test per app session: null = not run, a Promise = running,
// true/false = result.
let counterProbe = null;

function ensureVidaaAudioCounterProbe() {
  if (counterProbe !== null || isVidaaAudioCounterVerified(LocalStore)) return;
  counterProbe = probeVidaaAudioCounter().then((counts) => {
    if (counts) markVidaaAudioCounterVerified(LocalStore);
    counterProbe = counts;
    return counts;
  });
}

// Test hook: forget the session's self-test result.
export function resetVidaaAudioCounterProbe() {
  counterProbe = null;
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
      this.vidaaAudioCheckUrl = url;
      this.vidaaAudioCheckState = createVidaaSilentAudioCheck();
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
    runVidaaAudioCheck() {
      if (!this.vidaaAudioCheckTimer) {
        return;
      }
      if (String(this.activePlaybackUrl || "") !== this.vidaaAudioCheckUrl) {
        // The source changed without going through playStreamByUrl.
        this.stopVidaaAudioCheck();
        return;
      }
      const probe = this.getVidaaAudioProbeForCheck();
      const video = PlayerController.video;
      const decodedBytes = video?.webkitAudioDecodedByteCount;
      // Codecs this device already failed on: no need to wait for silence. Decoded
      // audio always wins over the remembered list.
      if (
        probe &&
        !(Number(decodedBytes) > 0) &&
        areAllVidaaAudioCodecsUnsupported(probe.codecIds, readVidaaUnsupportedAudioCodecs(LocalStore))
      ) {
        this.finishVidaaAudioCheck();
        this.handleVidaaUnsupportedAudio(probe, { detectedBy: "remembered-codec" });
        return;
      }
      const { state, verdict } = stepVidaaSilentAudioCheck(this.vidaaAudioCheckState, {
        decodedBytes,
        currentTime: video?.currentTime,
        paused: Boolean(this.paused || video?.paused),
        seeking: Boolean(video?.seeking || this.seekOverlayVisible || this.bufferingActive),
        probe
      });
      this.vidaaAudioCheckState = state;
      if (verdict === "wait") {
        return;
      }
      if (verdict === "ok") {
        markVidaaAudioCounterVerified(LocalStore);
      }
      if (verdict === "unsupported" && !isVidaaAudioCounterVerified(LocalStore)) {
        ensureVidaaAudioCounterProbe();
        if (counterProbe instanceof Promise) {
          // The self-test is still running: check again on the next tick.
          return;
        }
        console.info("VIDAA audio check skipped", { reason: "counter-not-verified" });
        this.finishVidaaAudioCheck();
        return;
      }
      if (verdict !== "unsupported") {
        if (verdict === "skip") {
          console.info("VIDAA audio check skipped", {
            reason: typeof decodedBytes !== "number" ? "no-decoded-byte-counter" : probe ? "no-audio-tracks" : "no-track-probe"
          });
        }
        this.finishVidaaAudioCheck();
        return;
      }
      const playedSeconds = Math.round(state.playedSeconds);
      this.finishVidaaAudioCheck();
      // Learn only the codec the browser actually tried to play.
      learnVidaaUnsupportedAudioCodecs(LocalStore, [probe.playedCodecId]);
      this.handleVidaaUnsupportedAudio(probe, { detectedBy: "silent-playback", playedSeconds });
    },
    handleVidaaUnsupportedAudio(probe, { detectedBy = "", playedSeconds = 0 } = {}) {
      const playbackUrl = this.activePlaybackUrl;
      const candidate = this.getStreamCandidateByUrl(playbackUrl) || this.getCurrentStreamCandidate();
      const codecIds = detectedBy === "silent-playback" && probe.playedCodecId ? [probe.playedCodecId] : probe.codecIds;
      const codec = formatVidaaAudioCodecNames(codecIds) || "?";
      const { settings, eligibility } = this.getVidaaAutoPlayFailoverContext();
      const next = eligibility === "eligible" ? this.pickVidaaAutoPlayFailoverCandidate(candidate, settings) : null;
      const reaction = decideVidaaAudioUnsupportedReaction({
        eligibility,
        hasNextCandidate: Boolean(next),
        candidateCount: this.streamCandidates.length
      });
      // Codec ids, list positions and seconds only: stream URLs carry tokens.
      console.warn("VIDAA: source audio cannot be decoded on this device", {
        codecIds: probe.codecIds,
        detectedBy,
        playedSeconds,
        sourceIndex: this.streamCandidates.indexOf(candidate),
        action: reaction.action
      });
      this.markPlaybackSourceFailed(playbackUrl, candidate);

      if (reaction.action === "failover") {
        this.showAspectToast(
          t(
            "player_vidaa_audio_unsupported_trying_next",
            { codec },
            `This source's audio (${codec}) isn't supported on this device. Trying the next source…`
          ),
          { durationMs: 4000 }
        );
        this.startVidaaAutoPlayFailover(candidate, next, {
          logMessage: "VIDAA auto-play: source audio unsupported, trying the next one"
        });
        return;
      }

      PlayerController.pause();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      // Auto-play out of candidates, or a source the user picked: stop on the in-player
      // sources list with an alert on top, so the next pick is one OK away.
      const message =
        reaction.action === "error"
          ? t(
              "player_vidaa_audio_unsupported_none_left",
              { codec },
              `This source's audio (${codec}) isn't supported on this device, and none of the other sources could be tried automatically. Choose another source.`
            )
          : t(
              "player_vidaa_audio_unsupported_choose_source",
              { codec },
              `This source's audio (${codec}) isn't supported on this device. Choose another source.`
            );
      this.showVidaaSourcesAlert({
        title: t("player_vidaa_audio_unsupported_title", {}, "Audio not supported"),
        message
      });
    },
    // Opens the in-player sources list with an alert above the filters. Unlike
    // sourcesError it survives the list reload that opening the panel starts, and it is
    // cleared when the panel closes (also when a new source is picked).
    showVidaaSourcesAlert({ title = "", message = "" } = {}) {
      this.loadingVisible = false;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
      this.openSourcesPanel();
      this.sourcesAlert = { title, message };
      // Focus the source after the failed one: OK plays the next candidate.
      const listLength = this.getFilteredSources().length;
      if (this.sourcesFocus?.zone === "list" && this.sourcesFocus.index + 1 < listLength) {
        this.sourcesFocus = { zone: "list", index: this.sourcesFocus.index + 1 };
      }
      this.renderSourcesPanel();
      this.updateUiTick();
    }
  };
}
