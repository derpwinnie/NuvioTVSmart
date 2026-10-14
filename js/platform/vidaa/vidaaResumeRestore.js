import { timeRangesToArray } from "./vidaaBufferGap.js";

// VIDAA sometimes drops the resume seek: currentTime stays at 0 while the browser has
// already buffered data around the resume target (seen: 393-438 s), video paused and no
// further events firing. A timer retries the restore until it lands or gives up.
export const VIDAA_RESTORE_RETRY_MS = 1000;
export const VIDAA_RESTORE_MAX_ATTEMPTS = 8;
const BUFFERED_WINDOW_SECONDS = 30;
const LANDING_OFFSET_SECONDS = 0.01;

export { timeRangesToArray };

// Seek into data that is already buffered near the target when there is some, so the
// browser does not have to start a new request that it might drop again.
export function getVidaaResumeSeekTarget(targetSeconds, ranges = []) {
  const target = Number(targetSeconds);
  const range = ranges.find(
    ([start, end]) => end > target && start <= target + BUFFERED_WINDOW_SECONDS
  );
  return range ? Math.max(range[0] + LANDING_OFFSET_SECONDS, target) : target;
}

// Next step for a pending resume restore that has not reached its target yet:
// wait for a running seek, seek (again), or give up after a few attempts.
export function decideVidaaResumeRestore({
  targetSeconds,
  ranges = [],
  seeking = false,
  force = false,
  attempts = 0
}) {
  if (seeking && !force) return { action: "wait" };
  if (attempts >= VIDAA_RESTORE_MAX_ATTEMPTS) return { action: "give-up" };
  return { action: "seek", seconds: getVidaaResumeSeekTarget(targetSeconds, ranges) };
}
