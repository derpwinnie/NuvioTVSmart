// A mid-playback stall on VIDAA is usually a slow seek in a file without a seek index, and
// restarting the same source at the same position recovers it. Cap the restarts so a source
// that keeps stalling still ends at the sources panel instead of looping.
export const VIDAA_STALL_RESTART_LIMIT = 3;
export const VIDAA_STALL_RESTART_WINDOW_MS = 2 * 60 * 1000;

// Returns the restart timestamps to keep (including now) when a restart is allowed, or null.
export function nextVidaaStallRestarts(
  previous,
  now,
  limit = VIDAA_STALL_RESTART_LIMIT,
  windowMs = VIDAA_STALL_RESTART_WINDOW_MS
) {
  const recent = (Array.isArray(previous) ? previous : []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) return null;
  return [...recent, now];
}
