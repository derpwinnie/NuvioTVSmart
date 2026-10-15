// The silent-audio and black-picture checks read the browser's decoder counters
// (webkitAudioDecodedByteCount, webkitVideoDecodedByteCount, videoWidth). A TV that
// decodes outside the browser, or a playback pipeline that does not report, shows 0
// for every source, and the checks must not reject them all. So a counter is only
// trusted once it has counted something on this device, per kind (audio/video) and
// per pipeline: a plain file (native) and MSE playback (hls.js, dash.js) report
// through different paths.
export const VIDAA_MEDIA_COUNTERS_VERIFIED_KEY = "vidaaMediaCountersVerified";

export function vidaaPlaybackPipeline(engine) {
  const name = String(engine || "").toLowerCase();
  return name === "hls.js" || name === "dash.js" ? name : "native";
}

function readVerified(storage) {
  try {
    const stored = storage?.get?.(VIDAA_MEDIA_COUNTERS_VERIFIED_KEY, null);
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch (_) {
    return {};
  }
}

// kind: "audio" or "video"; engine: PlayerController.playbackEngine.
export function isVidaaMediaCounterVerified(storage, kind, engine) {
  const list = readVerified(storage)[kind];
  return Array.isArray(list) && list.includes(vidaaPlaybackPipeline(engine));
}

export function markVidaaMediaCounterVerified(storage, kind, engine) {
  if (isVidaaMediaCounterVerified(storage, kind, engine)) return;
  const verified = readVerified(storage);
  const list = Array.isArray(verified[kind]) ? verified[kind] : [];
  try {
    storage?.set?.(VIDAA_MEDIA_COUNTERS_VERIFIED_KEY, {
      ...verified,
      [kind]: [...list, vidaaPlaybackPipeline(engine)]
    });
  } catch (_) {
    // Storage blocked: detection simply stays off on this device.
  }
}

export function resetVidaaMediaCounters(storage) {
  try {
    storage?.set?.(VIDAA_MEDIA_COUNTERS_VERIFIED_KEY, {});
  } catch (_) {
    // Nothing to reset when storage is blocked.
  }
}
