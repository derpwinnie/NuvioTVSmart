// Some MKV sources carry audio only in codecs the TV browser cannot decode (DTS,
// TrueHD). The video plays, no error event fires and the user hears nothing.
// Detect that from the decoder's byte counter, remember the codec per device,
// and skip such sources next time as soon as their header has been read.
import { vidaaAudioCodecDisplayName } from "./vidaaMkvTracks.js";

export const VIDAA_SILENT_AUDIO_CHECK_INTERVAL_MS = 1000;
// Seconds of real playback without a single decoded audio byte.
export const VIDAA_SILENT_AUDIO_MIN_PLAYED_SECONDS = 5;
// Give up waiting for the MKV header probe after this much playback.
export const VIDAA_SILENT_AUDIO_PROBE_WAIT_SECONDS = 60;
// A larger jump between two checks is a seek, not playback.
const MAX_ADVANCE_PER_CHECK_SECONDS = 3;
export const VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY = "vidaaUnsupportedAudioCodecs";
// Set once this device's decoded-byte counter has counted audio. Until then a silent
// counter proves nothing: a TV that decodes audio outside the browser would report 0
// for every source, and the check must not reject them all.
export const VIDAA_AUDIO_COUNTER_VERIFIED_KEY = "vidaaAudioByteCounterVerified";

export function isVidaaAudioCounterVerified(storage) {
  try {
    return storage?.get?.(VIDAA_AUDIO_COUNTER_VERIFIED_KEY, false) === true;
  } catch (_) {
    return false;
  }
}

export function markVidaaAudioCounterVerified(storage) {
  try {
    if (!isVidaaAudioCounterVerified(storage))
      storage?.set?.(VIDAA_AUDIO_COUNTER_VERIFIED_KEY, true);
  } catch (_) {
    // Storage blocked: detection simply stays off on this device.
  }
}

// Half a second of silent AAC (920 bytes). Playing it muted and hidden shows whether
// this device's browser counts decoded audio at all, before any real source played.
const VIDAA_AUDIO_COUNTER_PROBE_URI =
  "data:audio/mp4;base64,AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAAhmcmVlAAAASW1kYXTeAgBMYXZjNjIuMjguMTAzAAIwQA4BGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwAAAyttb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAB9AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACVXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAB9AAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAfQAAAQAAAEAAAAAAc1tZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAFYiAAAvEVXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAF4bWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAE8c3RibAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAQAQAAAAAFYiAAAAAAA2ZXNkcwAAAAADgICAJQABAASAgIAXQBUAAAAAAF3AAAADtwWAgIAFE4hW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAACwAABAAAAAABAAADEQAAABxzdHNjAAAAAAAAAAEAAAABAAAADAAAAAEAAABEc3RzegAAAAAAAAAAAAAADAAAABUAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAABRzdGNvAAAAAAAAAAEAAAAsAAAAGnNncGQBAAAAcm9sbAAAAAIAAAAB//8AAAAcc2JncAAAAAByb2xsAAAAAQAAAAwAAAABAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2Mi4xMi4xMDM=";
const VIDAA_AUDIO_COUNTER_PROBE_WAIT_MS = 1500;

// Resolves true when a muted, detached <audio> playing the probe clip makes
// webkitAudioDecodedByteCount count; false when it stays 0 or the API is missing.
export async function probeVidaaAudioCounter(
  createAudio = () => document.createElement("audio"),
  waitMs = VIDAA_AUDIO_COUNTER_PROBE_WAIT_MS
) {
  let audio = null;
  try {
    audio = createAudio();
    if (typeof audio?.webkitAudioDecodedByteCount !== "number") return false;
    audio.muted = true;
    audio.preload = "auto";
    audio.src = VIDAA_AUDIO_COUNTER_PROBE_URI;
    await audio.play();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return Number(audio.webkitAudioDecodedByteCount) > 0;
  } catch (_) {
    return false;
  } finally {
    try {
      audio?.pause?.();
      audio?.removeAttribute?.("src");
      audio?.load?.();
    } catch (_) {
      // Best effort cleanup of the probe element.
    }
  }
}

const CODEC_IDS_BY_NAME = {
  dts: "A_DTS",
  dca: "A_DTS",
  truehd: "A_TRUEHD",
  mlp: "A_TRUEHD",
  eac3: "A_EAC3",
  "e-ac-3": "A_EAC3",
  ac3: "A_AC3",
  "ac-3": "A_AC3",
  aac: "A_AAC",
  opus: "A_OPUS",
  flac: "A_FLAC"
};

// Matroska codec id of an audio track ("A_DTS"), or "" when unknown. Tracks from
// the dev server's probe may only carry a codec name ("dts").
export function vidaaAudioCodecKey(track) {
  const codecId = String(track?.codec_id || track?.codecId || "").trim();
  if (/^A_/i.test(codecId)) return codecId.toUpperCase();
  const name = String(track?.codec || track?.audioCodec || track?.codec_name || "")
    .trim()
    .toLowerCase();
  return CODEC_IDS_BY_NAME[name] || "";
}

// Reduces a track probe result to what the audio check needs.
export function summarizeVidaaAudioProbe(tracks) {
  const audio = (Array.isArray(tracks) ? tracks : []).filter(
    (track) => String(track?.type || "").toLowerCase() === "audio"
  );
  const codecIds = audio.map(vidaaAudioCodecKey);
  // The browser plays the default track (the first one when none is marked).
  const playedIndex = Math.max(
    0,
    audio.findIndex((track) => track?.isDefault === true)
  );
  return {
    audioTrackCount: audio.length,
    codecIds,
    playedCodecId: codecIds[playedIndex] || ""
  };
}

export function createVidaaSilentAudioCheck() {
  return { playedSeconds: 0, lastTime: null };
}

// One check. `sample`: { decodedBytes, currentTime, paused, seeking, probe }
// where probe is a summarizeVidaaAudioProbe result or null while unknown.
// Returns { state, verdict } with verdict "wait" (check again), "ok" (audio
// decodes), "skip" (cannot tell, stop checking) or "unsupported".
export function stepVidaaSilentAudioCheck(state, sample = {}) {
  const previous = state || createVidaaSilentAudioCheck();
  if (typeof sample.decodedBytes !== "number" || !Number.isFinite(sample.decodedBytes)) {
    return { state: previous, verdict: "skip" };
  }
  if (sample.decodedBytes > 0) {
    return { state: previous, verdict: "ok" };
  }
  const time = Number(sample.currentTime);
  let playedSeconds = previous.playedSeconds;
  if (Number.isFinite(time) && previous.lastTime !== null && !sample.paused && !sample.seeking) {
    const delta = time - previous.lastTime;
    if (delta > 0 && delta <= MAX_ADVANCE_PER_CHECK_SECONDS) playedSeconds += delta;
  }
  const next = { playedSeconds, lastTime: Number.isFinite(time) ? time : previous.lastTime };
  if (playedSeconds < VIDAA_SILENT_AUDIO_MIN_PLAYED_SECONDS) {
    return { state: next, verdict: "wait" };
  }
  const probe = sample.probe;
  if (!probe) {
    return {
      state: next,
      verdict: playedSeconds >= VIDAA_SILENT_AUDIO_PROBE_WAIT_SECONDS ? "skip" : "wait"
    };
  }
  // A file without audio tracks is silent on purpose.
  if (!(probe.audioTrackCount > 0)) return { state: next, verdict: "skip" };
  return { state: next, verdict: "unsupported" };
}

// `storage` is LocalStore-like: get(key, fallback) / set(key, value).
export function readVidaaUnsupportedAudioCodecs(storage) {
  try {
    const stored = storage?.get?.(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY, []);
    return new Set(
      (Array.isArray(stored) ? stored : [])
        .map((id) => String(id || "").toUpperCase())
        .filter((id) => id.startsWith("A_"))
    );
  } catch (_) {
    return new Set();
  }
}

// Remembers codec ids learned from a runtime detection. Returns the new set.
export function learnVidaaUnsupportedAudioCodecs(storage, codecIds) {
  const known = readVidaaUnsupportedAudioCodecs(storage);
  const before = known.size;
  (Array.isArray(codecIds) ? codecIds : [codecIds])
    .map((id) => String(id || "").toUpperCase())
    .filter((id) => id.startsWith("A_"))
    .forEach((id) => known.add(id));
  if (known.size !== before) {
    try {
      storage?.set?.(VIDAA_UNSUPPORTED_AUDIO_CODECS_KEY, [...known]);
    } catch (_) {
      // Storage full or blocked: the detection still works, just without memory.
    }
  }
  return known;
}

// True only when the source has audio and every audio track's codec is known
// to be unsupported. An unknown codec counts as supported.
export function areAllVidaaAudioCodecsUnsupported(codecIds, unsupported) {
  const ids = Array.isArray(codecIds) ? codecIds : [];
  if (!ids.length || !unsupported?.size) return false;
  return ids.every((id) => Boolean(id) && unsupported.has(String(id).toUpperCase()));
}

// "DTS" or "DTS/TrueHD" for messages.
export function formatVidaaAudioCodecNames(codecIds) {
  const names = (Array.isArray(codecIds) ? codecIds : [codecIds])
    .map(vidaaAudioCodecDisplayName)
    .filter(Boolean);
  return [...new Set(names)].join("/");
}

// What to do with a source whose audio cannot be decoded.
// "failover": play the next auto-play candidate; "error": auto-play has no
// candidate left; "sources-panel": the user picked it, let them choose another.
export function decideVidaaAudioUnsupportedReaction({
  eligibility = "",
  hasNextCandidate = false,
  candidateCount = 0
} = {}) {
  if (eligibility === "eligible") {
    return { action: hasNextCandidate ? "failover" : "error", openSourcesPanel: false };
  }
  return { action: "sources-panel", openSourcesPanel: candidateCount > 1 };
}
