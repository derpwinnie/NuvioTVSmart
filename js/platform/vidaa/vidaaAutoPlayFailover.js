// With automatic source selection, a source the TV/browser cannot play (an AVI,
// an unsupported codec) should not end on an error screen. Nothing is excluded
// up front: only a source that actually failed to start on this device is
// skipped, and the next best one is picked with the same auto-play ranking that
// chose the first. Bounded so a list of broken sources cannot loop forever.
import { selectAutoPlayStream } from "../../core/streams/streamAutoPlaySelector.js";

export const VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS = 5;

function candidateUrl(candidate) {
  return String(candidate?.url || candidate?.raw?.url || "").trim();
}

function isUntried(candidate, { currentId, failedUrls, failedIds }) {
  const url = candidateUrl(candidate);
  const id = String(candidate?.id || "");
  return (
    Boolean(url) &&
    !failedUrls.has(url) &&
    !(id && (failedIds.has(id) || id === String(currentId || "")))
  );
}

// A source failed to start because of the source itself (decode / unsupported format,
// code 3/4) or the network (code 2). Code 2 while the TV is offline is not the source's
// fault, so trying the next one would only burn through the list.
// A startup that stalls without any error (dead link, server never sends data) counts
// like a network error.
export function isVidaaFailoverMediaError(mediaErrorCode, online = true, { stalled = false } = {}) {
  const code = Number(mediaErrorCode);
  if (code === 3 || code === 4) return true;
  return (code === 2 || (stalled && !code)) && online !== false;
}

// What to do with a source that cannot play on this device (error, stall, audio or
// video the TV cannot decode): "failover" plays the next auto-play candidate;
// "none-left" and "user-picked" stop on the in-player sources list with an alert.
export function decideVidaaSourceFailureReaction({
  eligibility = "",
  hasNextCandidate = false
} = {}) {
  if (eligibility !== "eligible") return "user-picked";
  return hasNextCandidate ? "failover" : "none-left";
}

// Failover only replaces a source the auto-play (or auto-resume) logic picked, never one
// the user chose on the Sources screen or in the player's Sources panel.
// Returns "eligible" or the reason it is not.
export function getVidaaAutoPlayFailoverEligibility({
  autoPlayOn = false,
  autoPlaySelected = false,
  manualSelection = false,
  userPickedSource = false
} = {}) {
  if (!autoPlayOn) return "auto-play-off";
  if (manualSelection || userPickedSource || !autoPlaySelected) return "manual-selection";
  return "eligible";
}

// Returns the next candidate to try, or null when none is left.
// `settings` are the player settings; `installedAddonNames` matches the stream screen.
export function pickVidaaNextAutoPlayCandidate(
  candidates,
  {
    currentId = "",
    failedUrls = new Set(),
    failedIds = new Set(),
    attempts = 0,
    settings = null,
    installedAddonNames = new Set()
  } = {}
) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (attempts >= VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS || !list.length) {
    return null;
  }
  const remaining = list.filter((candidate) =>
    isUntried(candidate, { currentId, failedUrls, failedIds })
  );
  if (!remaining.length) {
    return null;
  }
  if (settings) {
    // Same ranking as the first pick (mode, source scope, regex, selected addons).
    // The failed source's binge group is not preferred again on purpose.
    const ranked = selectAutoPlayStream(remaining, {
      mode: settings.streamAutoPlayMode,
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames,
      selectedAddons: settings.streamAutoPlaySelectedAddons,
      selectedPlugins: settings.streamAutoPlaySelectedPlugins
    });
    // When the user's rules exclude every remaining source, stop: the first pick
    // would not have chosen any of them either.
    return ranked || null;
  }
  // No ranking rules given: list order after the failed one.
  const start = list.findIndex(
    (candidate) => String(candidate?.id || "") === String(currentId || "")
  );
  for (let offset = 1; offset <= list.length; offset += 1) {
    const candidate = list[(Math.max(start, -1) + offset) % list.length];
    if (remaining.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}
