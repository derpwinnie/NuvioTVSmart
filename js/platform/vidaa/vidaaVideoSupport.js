// A source whose video the TV browser cannot decode (e.g. a codec it lacks) may play
// its audio over a black picture without any error. Detect that the same way as
// undecodable audio (see vidaaAudioSupport.js): playback advances, but the element
// never learns a picture size and the decoder never counts a video byte.
export const VIDAA_MISSING_VIDEO_MIN_PLAYED_SECONDS = 5;

// `sample`: { videoWidth, videoHeight, decodedVideoBytes, playedSeconds }.
// Returns "ok" (a picture exists), "missing" or "wait".
export function checkVidaaVideoPresence(sample = {}) {
  if (
    Number(sample.videoWidth) > 0 ||
    Number(sample.videoHeight) > 0 ||
    Number(sample.decodedVideoBytes) > 0
  ) {
    return "ok";
  }
  return Number(sample.playedSeconds) >= VIDAA_MISSING_VIDEO_MIN_PLAYED_SECONDS
    ? "missing"
    : "wait";
}
