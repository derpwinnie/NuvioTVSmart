// With automatic source selection, a source the TV/browser cannot play (an AVI,
// an unsupported codec) should not end on an error screen: move on to the next
// source in list order, like a user would. Bounded so a list of broken sources
// cannot loop forever.
export const VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS = 5;

function candidateUrl(candidate) {
  return String(candidate?.url || candidate?.raw?.url || "").trim();
}

// Returns the next playable candidate after `currentId`, or null when none is left.
export function pickVidaaNextAutoPlayCandidate(
  candidates,
  { currentId = "", failedUrls = new Set(), failedIds = new Set(), attempts = 0 } = {}
) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (attempts >= VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS || !list.length) {
    return null;
  }
  const start = list.findIndex((candidate) => String(candidate?.id || "") === String(currentId || ""));
  for (let offset = 1; offset <= list.length; offset += 1) {
    const candidate = list[(Math.max(start, -1) + offset) % list.length];
    const url = candidateUrl(candidate);
    const id = String(candidate?.id || "");
    if (!url || failedUrls.has(url) || (id && failedIds.has(id)) || (id && id === String(currentId || ""))) {
      continue;
    }
    return candidate;
  }
  return null;
}
