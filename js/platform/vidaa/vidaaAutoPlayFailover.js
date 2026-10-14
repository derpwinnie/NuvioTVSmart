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
    if (ranked) {
      return ranked;
    }
  }
  // Nothing matches the ranking rules any more: fall back to list order after the failed one.
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
