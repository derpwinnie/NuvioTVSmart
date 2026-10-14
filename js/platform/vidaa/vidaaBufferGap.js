// Small gaps before the first buffered range happen when a resume seek in an MKV/MP4 lands
// before the next keyframe: the browser buffers from the keyframe on, while currentTime
// stays in front of it and playback never starts. Jumping to the range start fixes it.
// Keyframes can be 10s+ apart in some encodes (seen: resume at 420.82, buffer from 429.5).
export const VIDAA_MAX_BUFFER_GAP_SECONDS = 20;
// Lands just inside the buffered range so float rounding can't leave us in front of it again.
const GAP_LANDING_OFFSET_SECONDS = 0.01;

export function timeRangesToArray(timeRanges) {
  const ranges = [];
  for (let index = 0; index < Number(timeRanges?.length || 0); index += 1) {
    ranges.push([timeRanges.start(index), timeRanges.end(index)]);
  }
  return ranges;
}

// Returns the time to jump to, or null when currentTime is buffered or no range starts close ahead.
export function getVidaaBufferGapTarget(
  currentTime,
  ranges,
  maxGapSeconds = VIDAA_MAX_BUFFER_GAP_SECONDS
) {
  const time = Number(currentTime);
  if (!Number.isFinite(time)) return null;
  if (ranges.some(([start, end]) => time >= start && time < end)) return null;
  const next = ranges.find(([start]) => start > time && start - time <= maxGapSeconds);
  return next ? next[0] + GAP_LANDING_OFFSET_SECONDS : null;
}
