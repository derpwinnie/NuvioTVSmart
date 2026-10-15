/* eslint-disable no-unused-vars */
import * as internals from "./playerScreenContext.js";
import {
  getVidaaAutoPlayFailoverEligibility,
  isVidaaFailoverMediaError,
  pickVidaaNextAutoPlayCandidate
} from "../../../platform/vidaa/vidaaAutoPlayFailover.js";

export function createPlayerScreenMethods35() {
  const {
    streamRepository,
    TorrentSettingsStore,
    DirectDebridResolver,
    WebOsEngineFsResolver,
    TizenStreamingServerResolver,
    logEngineFsDebug,
    getP2pInfoHash,
    t,
    extractPlaybackHttpStatus,
    streamDirectPlaybackUrl,
    PlayerSettingsStore,
    isAutoPlayEffectivelyEnabled,
    Environment,
    addonRepository
  } = internals;

  return {
    async playStreamCandidate(streamCandidate, options = {}) {
      const mountToken = options?.mountToken ?? null;
      if (!this.isActiveMountToken(mountToken)) {
        return;
      }
      if (!streamCandidate) {
        return;
      }
      streamRepository.setLocalPluginSearchPaused(true);
      const forceEngineFsResolve = options?.forceEngineFsResolve === true;
      let targetUrl = forceEngineFsResolve ? "" : streamDirectPlaybackUrl(streamCandidate);
      if (!targetUrl) {
        const resolveContext = {
          season: this.params?.season == null ? null : Number(this.params.season),
          episode: this.params?.episode == null ? null : Number(this.params.episode)
        };
        const canUseEngineFs = WebOsEngineFsResolver.canResolveStream(streamCandidate);
        const canUseTizenP2p = TizenStreamingServerResolver.canResolveStream(streamCandidate);
        const canResolveP2p = canUseEngineFs || canUseTizenP2p;
        const tizenP2pUnsupported = TizenStreamingServerResolver.isUnsupportedOnCurrentTizen(streamCandidate);
        const p2pEnabled = Boolean(TorrentSettingsStore.get().p2pEnabled);
        const canUseP2p = p2pEnabled && canResolveP2p;
        let fallbackError = "";
        let resolveFailureStatus = "";
        let resolveFailureDetail = "";
        let preResolveEngineFsKeepAliveToken = "";
        const stopPreResolveEngineFsKeepAlive = () => {
          if (
            !preResolveEngineFsKeepAliveToken ||
            this.engineFsKeepAliveToken !== preResolveEngineFsKeepAliveToken ||
            this.currentEngineFsStream
          ) {
            return;
          }
          this.stopEngineFsKeepAlive();
        };

        if (DirectDebridResolver.canResolveStream(streamCandidate, resolveContext)) {
          const result = await DirectDebridResolver.resolve(streamCandidate, resolveContext);
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          if (result.status === "success" && result.stream?.url) {
            targetUrl = result.stream.url;
            Object.assign(streamCandidate, {
              url: targetUrl,
              externalUrl: null,
              mimeType: result.stream.mimeType || streamCandidate.mimeType,
              sourceType: result.stream.sourceType || streamCandidate.sourceType,
              behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
              raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
            });
          } else {
            fallbackError =
              result.status === "service_degraded"
                ? t(
                    "stream.debrid.serviceDegraded",
                    {},
                    "The Debrid service is currently degraded. Try again later or choose another source."
                  )
                : result.status === "not_cached"
                  ? t("stream.debrid.notCached", {}, "Not cached on this service.")
                  : result.status === "stale"
                    ? t("stream.debrid.stale", {}, "This Debrid result expired. Refreshing streams.")
                    : t("stream.debrid.failed", {}, "Could not resolve this Debrid stream.");
            resolveFailureStatus = result.status || "debrid-failed";
            resolveFailureDetail = result.detail || result.error || "";
            if (result.status === "service_degraded") {
              if (!this.hasPresentedPlaybackFrame) {
                this.showStartupError(fallbackError, {
                  streamCandidate,
                  reason: "debrid-resolve",
                  resolverStatus: resolveFailureStatus,
                  resolverDetail: resolveFailureDetail
                });
              } else {
                // The source playing before keeps playing.
                this.reportPlaybackFailureToSources(
                  fallbackError,
                  {
                    streamCandidate,
                    reason: "debrid-resolve",
                    resolverStatus: resolveFailureStatus,
                    resolverDetail: resolveFailureDetail
                  },
                  { keepPlayback: true }
                );
              }
              return;
            }
          }
        }

        if (!targetUrl && canUseP2p) {
          if (canUseEngineFs && !this.currentEngineFsStream && !this.engineFsKeepAliveToken) {
            const infoHash = getP2pInfoHash(streamCandidate);
            if (infoHash) {
              this.startEngineFsKeepAlive({
                kind: "webos-enginefs",
                infoHash,
                fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
              });
              preResolveEngineFsKeepAliveToken = this.engineFsKeepAliveToken;
              logEngineFsDebug("EngineFS keepalive started before P2P resolve", {
                infoHash,
                fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
              });
            }
          }
          const result = canUseEngineFs
            ? await WebOsEngineFsResolver.resolve(streamCandidate, resolveContext)
            : await TizenStreamingServerResolver.resolve(streamCandidate, resolveContext);
          if (!this.isActiveMountToken(mountToken)) {
            stopPreResolveEngineFsKeepAlive();
            const resolvedEngineFs = result?.stream?.engineFs || null;
            if (resolvedEngineFs?.infoHash) {
              void this.cleanupEngineFsState(resolvedEngineFs, "stale-p2p-resolve", {
                deferMs: 0
              }).catch(() => null);
            }
            return;
          }
          if (result.status === "success" && result.stream?.url) {
            targetUrl = result.stream.url;
            Object.assign(streamCandidate, {
              url: targetUrl,
              externalUrl: null,
              infoHash: result.stream.infoHash || streamCandidate.infoHash,
              fileIdx: result.stream.fileIdx ?? streamCandidate.fileIdx,
              engineFs: result.stream.engineFs || streamCandidate.engineFs || null,
              tizenP2p: result.stream.tizenP2p || streamCandidate.tizenP2p || null,
              mimeType: result.stream.mimeType || streamCandidate.mimeType,
              sourceType: result.stream.sourceType || streamCandidate.sourceType,
              behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
              raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
            });
          } else {
            resolveFailureStatus = result?.status || "p2p-failed";
            resolveFailureDetail = result?.detail || result?.error || "";
            console.warn("PlayerScreen: P2P resolve failed", {
              status: result.status,
              detail: result.detail || "",
              infoHash:
                streamCandidate.infoHash ||
                streamCandidate.raw?.infoHash ||
                streamCandidate.clientResolve?.infoHash ||
                streamCandidate.raw?.clientResolve?.infoHash ||
                "",
              fileIdx: streamCandidate.fileIdx ?? streamCandidate.raw?.fileIdx ?? null
            });

            stopPreResolveEngineFsKeepAlive();
          }
        }

        if (!targetUrl) {
          if (!this.isActiveMountToken(mountToken)) {
            return;
          }
          const startupMessage =
            fallbackError ||
            (tizenP2pUnsupported
              ? t("player_error_tizen_p2p_unsupported", {}, "Torrent/P2P streaming is not supported on this TV.")
              : !p2pEnabled && canResolveP2p
                ? t("player_error_p2p_disabled", {}, "P2P streaming is disabled. Enable P2P in Settings to play torrent streams.")
                : canUseP2p
                  ? t(
                      "player_error_failed_start_torrent",
                      [t("player_error_playback_fallback", {}, "Playback error")],
                      "Failed to start torrent: %1$s"
                    )
                  : t("player_error_playback_fallback", {}, "Playback error"));
          if (!this.hasPresentedPlaybackFrame) {
            this.showStartupError(startupMessage, {
              streamCandidate,
              reason: tizenP2pUnsupported
                ? "tizen-p2p-unsupported"
                : !p2pEnabled && canResolveP2p
                  ? "p2p-disabled"
                  : canUseP2p
                    ? "p2p-resolve"
                    : "stream-resolve",
              resolverStatus: resolveFailureStatus,
              resolverDetail: resolveFailureDetail
            });
            return;
          }
          const sourceErrorMessage = tizenP2pUnsupported
            ? t("player_error_tizen_p2p_unsupported", {}, "Torrent/P2P streaming is not supported on this TV.")
            : !p2pEnabled && canResolveP2p
              ? t("player_error_p2p_disabled", {}, "P2P streaming is disabled. Enable P2P in Settings to play torrent streams.")
              : canUseP2p
                ? t("stream.p2p.failed", {}, "Could not start this torrent stream.")
                : fallbackError || t("stream.debrid.unavailable", {}, "This Debrid source needs a configured Debrid account.");
          this.reportPlaybackFailureToSources(
            sourceErrorMessage,
            {
              streamCandidate,
              reason: tizenP2pUnsupported
                ? "tizen-p2p-unsupported"
                : !p2pEnabled && canResolveP2p
                  ? "p2p-disabled"
                  : canUseP2p
                    ? "p2p-resolve"
                    : "stream-resolve",
              resolverStatus: resolveFailureStatus,
              resolverDetail: resolveFailureDetail
            },
            { keepPlayback: true }
          );
          return;
        }

        this.streamCandidates = this.streamCandidates.map((entry) =>
          entry.id === streamCandidate.id ? { ...entry, ...streamCandidate } : entry
        );
      }
      this.rememberSelectedStreamPreference(streamCandidate);
      await this.playStreamByUrl(targetUrl, {
        ...options,
        mountToken,
        sourceCandidate: streamCandidate
      });
    },
    // Whether the current source may be replaced automatically (see vidaaAutoPlayFailover.js).
    getVidaaAutoPlayFailoverContext() {
      const settings = PlayerSettingsStore.get();
      const autoPlayOn =
        String(settings.streamAutoPlayMode || "MANUAL").toUpperCase() !== "MANUAL" && isAutoPlayEffectivelyEnabled(settings);
      const eligibility = getVidaaAutoPlayFailoverEligibility({
        autoPlayOn,
        autoPlaySelected: this.params?.autoPlaySelected,
        manualSelection: this.params?.streamRouteParams?.manualSelection,
        userPickedSource: this.vidaaUserPickedSource
      });
      return { settings, eligibility };
    },
    // Next candidate by the auto-play ranking, or null when none is left.
    pickVidaaAutoPlayFailoverCandidate(failedCandidate, settings = PlayerSettingsStore.get()) {
      return pickVidaaNextAutoPlayCandidate(this.streamCandidates, {
        currentId: failedCandidate?.id || "",
        failedUrls: this.failedPlaybackUrls || new Set(),
        failedIds: this.failedPlaybackStreamIds || new Set(),
        attempts: Number(this.vidaaAutoPlayFailoverAttempts || 0),
        settings,
        installedAddonNames: new Set(
          (addonRepository.getCachedInstalledAddons() || [])
            .map((addon) => String(addon?.displayName || addon?.name || "").trim())
            .filter(Boolean)
        )
      });
    },
    startVidaaAutoPlayFailover(
      failedCandidate,
      next,
      { logMessage = "VIDAA auto-play: source failed to start, trying the next one" } = {}
    ) {
      this.vidaaAutoPlayFailoverAttempts = Number(this.vidaaAutoPlayFailoverAttempts || 0) + 1;
      const nextIndex = this.streamCandidates.indexOf(next);
      if (nextIndex >= 0) {
        this.currentStreamIndex = nextIndex;
      }
      // Log list positions, not stream ids: ids can contain stream URLs with tokens.
      console.warn(logMessage, {
        failedIndex: this.streamCandidates.findIndex((entry) => entry?.id && entry.id === failedCandidate?.id),
        nextIndex,
        attempt: this.vidaaAutoPlayFailoverAttempts
      });
      // Like the engine switch: let the next source report its own startup error
      // instead of having it swallowed by the 120 ms error throttle.
      this.lastPlaybackErrorAt = 0;
      void this.playStreamCandidate(next, {
        preservePlaybackState: true,
        mountToken: this.playerMountToken
      });
    },
    // VIDAA + automatic source selection: when a source fails to start, play the
    // next one instead of showing the error. Returns true when a retry started.
    tryVidaaAutoPlayNextSource(failedCandidate = this.getCurrentStreamCandidate(), { mediaErrorCode = 0, stalled = false } = {}) {
      if (!Environment.isVidaa()) {
        return false;
      }
      const { settings, eligibility } = this.getVidaaAutoPlayFailoverContext();
      if (eligibility !== "eligible") {
        console.info("VIDAA auto-play failover skipped", {
          reason: eligibility,
          mode: settings.streamAutoPlayMode || "MANUAL"
        });
        return false;
      }
      if (!isVidaaFailoverMediaError(mediaErrorCode, globalThis.navigator?.onLine, { stalled })) {
        console.info("VIDAA auto-play failover skipped", {
          reason: "error-not-source-related",
          mediaErrorCode,
          stalled,
          online: globalThis.navigator?.onLine !== false
        });
        return false;
      }
      const next = this.pickVidaaAutoPlayFailoverCandidate(failedCandidate, settings);
      if (!next) {
        console.info("VIDAA auto-play failover skipped", {
          reason: "no-other-source",
          candidates: this.streamCandidates.length,
          attempts: Number(this.vidaaAutoPlayFailoverAttempts || 0)
        });
        return false;
      }
      this.startVidaaAutoPlayFailover(failedCandidate, next);
      return true;
    },
    async switchStream(direction) {
      if (!this.streamCandidates.length) {
        return;
      }

      this.currentStreamIndex += direction;
      if (this.currentStreamIndex >= this.streamCandidates.length) {
        this.currentStreamIndex = 0;
      }
      if (this.currentStreamIndex < 0) {
        this.currentStreamIndex = this.streamCandidates.length - 1;
      }

      const selected = this.streamCandidates[this.currentStreamIndex];
      if (!selected) {
        return;
      }
      this.vidaaUserPickedSource = true;
      await this.playStreamCandidate(selected, { preservePlaybackState: true });
    },
    markPlaybackSourceFailed(url = this.activePlaybackUrl, streamCandidate = this.getCurrentStreamCandidate()) {
      const normalizedUrl = String(url || "").trim();
      if (normalizedUrl) {
        (this.failedPlaybackUrls || (this.failedPlaybackUrls = new Set())).add(normalizedUrl);
      }
      const currentCandidate = streamCandidate || this.getCurrentStreamCandidate?.();
      const currentId = String(currentCandidate?.id || "").trim();
      if (currentId) {
        (this.failedPlaybackStreamIds || (this.failedPlaybackStreamIds = new Set())).add(currentId);
      }
    },
    mediaErrorMessage(errorCode = 0, detail = "", streamCandidate = this.getCurrentStreamCandidate()) {
      const code = Number(errorCode || 0);
      const text = String(detail || "").toLowerCase();
      const httpStatus = extractPlaybackHttpStatus(detail);
      const httpMessage = this.getHttpPlaybackErrorMessage(httpStatus);
      if (httpMessage) {
        return httpMessage;
      }
      const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
      if (compatibilityMessage && (code === 0 || code === 2 || code === 4)) {
        return compatibilityMessage;
      }
      if (code === 1) return "Playback aborted";
      if (code === 2) return "Network error";
      if (code === 3) {
        const unsupported = t(
          "player_error_unsupported_format",
          [this.getPlaybackErrorCodeLabel(code) || "decode"],
          "This stream uses a format your device may not support. Try a different source. [%1$s]"
        );
        return `${t("player_error_decoder", {}, "Decoder error")}\n\n${unsupported}`;
      }
      if (code === 4) {
        if (this.isDebridPlaybackCandidate(streamCandidate)) {
          return t("player_error_stream_load_failed", {}, "Playback failed to load");
        }
        if (
          text.includes("manifestparsingerror") ||
          text.includes("manifest parsing") ||
          text.includes("unrecognized") ||
          text.includes("invalid content") ||
          text.includes("invalid data") ||
          text.includes("text/html") ||
          text.includes("html")
        ) {
          return t(
            "player_error_source_invalid_content",
            [this.getPlaybackErrorCodeLabel(code) || "source"],
            "Source error: The stream source returned invalid or unplayable content. The link may have expired or the server returned an error page instead of video.\n\nTry a different source. [%1$s]"
          );
        }
        if (
          text.includes("no supported source") ||
          text.includes("no supported sources") ||
          text.includes("not supported") ||
          text.includes("unsupported")
        ) {
          return t("player_error_source_not_supported", {}, "Source not supported on this TV");
        }
        return t("player_error_playback_fallback", {}, "Playback error");
      }
      return t("player_error_playback_fallback", {}, "Playback error");
    },
    attemptSilentAudioRecovery(reason = "silent-audio") {
      void reason;
      return false;
    },
    clearPlaybackStallGuard() {
      if (this.playbackStallTimer) {
        clearTimeout(this.playbackStallTimer);
        this.playbackStallTimer = null;
      }
    }
  };
}
