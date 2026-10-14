// The MKV header gives VIDAA track names, but switching still needs the browser's
// HTMLMediaElement.audioTracks. Without it (desktop Chrome without the experimental
// flag, some VIDAA firmware) the menu lists tracks that cannot be selected.
export function canSwitchVidaaAudioTracks(video) {
  const list = video?.audioTracks;
  return Boolean(list && typeof list.length === "number" && list.length > 1);
}

// True when the menu shows several tracks but the browser cannot switch between them.
export function isVidaaAudioSwitchingUnavailable(video, listedTrackCount) {
  return Number(listedTrackCount || 0) > 1 && !canSwitchVidaaAudioTracks(video);
}
