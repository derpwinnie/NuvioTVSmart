/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import { decideVidaaSourceFailureReaction, isVidaaFailoverMediaError } from "../../../platform/vidaa/vidaaAutoPlayFailover.js";
import { nextVidaaStallRestarts } from "../../../platform/vidaa/vidaaStallRestart.js";

// VIDAA: every "this source cannot play here" ends the same way. Auto-play moves on to
// the next ranked source; otherwise playback stops on the in-player sources list with
// an alert on top and the next source focused. The startup error card is not used:
// its Go Back leaves the player when playback came from continue watching.
// Other platforms keep their error card and sources line.
export function createPlayerScreenMethods75() {
  const { PlayerController, Environment, t } = internals;

  return {
    // A check found that the source cannot play (no media error fired).
    // `message` says what is wrong; the hint to choose another source is added here.
    handleVidaaSourceFailure({
      candidate = null,
      playbackUrl = this.activePlaybackUrl,
      title = "",
      message = "",
      failoverToast = "",
      logMessage = "VIDAA auto-play: source cannot play, trying the next one"
    } = {}) {
      const { settings, eligibility } = this.getVidaaAutoPlayFailoverContext();
      const next = eligibility === "eligible" ? this.pickVidaaAutoPlayFailoverCandidate(candidate, settings) : null;
      const reaction = decideVidaaSourceFailureReaction({ eligibility, hasNextCandidate: Boolean(next) });
      this.markPlaybackSourceFailed(playbackUrl, candidate);
      if (reaction === "failover") {
        if (failoverToast) {
          this.showAspectToast(failoverToast, { durationMs: 4000 });
        }
        this.startVidaaAutoPlayFailover(candidate, next, { logMessage });
        return reaction;
      }
      const hint =
        reaction === "none-left"
          ? t("player_vidaa_no_source_left", {}, "No other source could be tried automatically. Choose another source.")
          : t("player_vidaa_choose_another_source", {}, "Choose another source.");
      this.showVidaaSourcesAlert({ title, message: `${message} ${hint}` });
      return reaction;
    },
    // Opens the in-player sources list with an alert above the filters. Unlike
    // sourcesError it survives the list reload that opening the panel starts; it is
    // cleared when the panel closes (also when a new source is picked).
    showVidaaSourcesAlert({ title = "", message = "", keepPlayback = false } = {}) {
      if (!keepPlayback) {
        PlayerController.pause();
        this.paused = true;
        this.updateMediaSessionPlaybackState();
        this.loadingVisible = false;
        this.bufferingActive = false;
        this.dismissPauseOverlay();
        this.updateLoadingVisibility();
      }
      this.setControlsVisible(true, { focus: false });
      this.openSourcesPanel();
      this.sourcesAlert = {
        title: title || t("player_error_title", {}, "Playback Error"),
        message: String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error")
      };
      // Focus the source after the failed one: OK plays the next candidate.
      const listLength = this.getFilteredSources().length;
      if (!keepPlayback && this.sourcesFocus?.zone === "list" && this.sourcesFocus.index + 1 < listLength) {
        this.sourcesFocus = { zone: "list", index: this.sourcesFocus.index + 1 };
      }
      this.renderSourcesPanel();
      this.updateUiTick();
    },
    // Called at the end of showStartupError. Returns true when the error went to the
    // sources list instead of the card (VIDAA with sources to choose from).
    presentStartupErrorInVidaaSources() {
      if (!Environment.isVidaa() || !this.streamCandidates?.length || this.isExternalFrameMode?.()) {
        return false;
      }
      const message = this.startupErrorMessage;
      this.clearStartupError();
      this.showVidaaSourcesAlert({ message });
      return true;
    },
    // A media error after playback had started. Restart the same source at its position
    // (decode errors after a seek are often one-off, shared budget with stall restarts),
    // then fail over (auto-play). Returns true when one of them started.
    recoverVidaaPlaybackError(candidate, mediaErrorCode) {
      if (!Environment.isVidaa() || !isVidaaFailoverMediaError(mediaErrorCode, globalThis.navigator?.onLine)) {
        return false;
      }
      const restarts = nextVidaaStallRestarts(this.vidaaStallRestarts, Date.now());
      if (restarts) {
        this.vidaaStallRestarts = restarts;
        console.warn("Playback error on VIDAA; restarting the current source", {
          attempt: restarts.length,
          mediaErrorCode
        });
        this.lastPlaybackErrorAt = 0;
        void this.playStreamByUrl(this.activePlaybackUrl, {
          preservePlaybackState: true,
          resetSilentAudioState: false,
          sourceCandidate: candidate
        });
        return true;
      }
      this.markPlaybackSourceFailed(this.activePlaybackUrl, candidate);
      return this.tryVidaaAutoPlayNextSource(candidate, { mediaErrorCode });
    }
  };
}
