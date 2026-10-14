import assert from "node:assert/strict";
import {
  armVidaaBufferGap,
  getVidaaBufferGapTarget,
  shouldJumpVidaaBufferGap,
  timeRangesToArray,
  VIDAA_RESUME_GAP_SECONDS,
  VIDAA_SEEK_GAP_SECONDS
} from "../js/platform/vidaa/vidaaBufferGap.js";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// The stuck resume seen in the browser: position 259.9, buffer from the keyframe at 262.888.
near(getVidaaBufferGapTarget(259.9, [[262.888, 278]]), 262.898);

// Playing inside a buffered range: nothing to do.
assert.equal(getVidaaBufferGapTarget(270, [[262.888, 278]]), null);

// Wide keyframe spacing: resume at 420.82 with the buffer starting at 429.5.
near(getVidaaBufferGapTarget(420.82, [[429.5, 430.6]]), 429.51);

// A range far ahead is a real buffering wait, not a keyframe gap.
assert.equal(getVidaaBufferGapTarget(100, [[125, 140]]), null);

// Nothing buffered yet, or only behind the position.
assert.equal(getVidaaBufferGapTarget(50, []), null);
assert.equal(getVidaaBufferGapTarget(50, [[0, 40]]), null);

// With several ranges, the first one ahead within the limit wins.
near(
  getVidaaBufferGapTarget(41, [
    [0, 40],
    [43, 60],
    [44, 70]
  ]),
  43.01
);

// End of a range is not inside it.
near(
  getVidaaBufferGapTarget(40, [
    [0, 40],
    [42, 50]
  ]),
  42.01
);

// Invalid positions are ignored.
assert.equal(getVidaaBufferGapTarget(Number.NaN, [[1, 2]]), null);

// TimeRanges-like objects convert to [start, end] pairs.
const timeRanges = { length: 2, start: (i) => [1, 5][i], end: (i) => [3, 9][i] };
assert.deepEqual(timeRangesToArray(timeRanges), [
  [1, 3],
  [5, 9]
]);
assert.deepEqual(timeRangesToArray(null), []);

// Armed jump: only right after a resume restore or a seek.
const t0 = 1_000_000;
const resumeArm = armVidaaBufferGap(VIDAA_RESUME_GAP_SECONDS, t0);
const seekArm = armVidaaBufferGap(VIDAA_SEEK_GAP_SECONDS, t0);

// A stall at the end of a buffered range during normal playback is a real underrun.
assert.equal(
  shouldJumpVidaaBufferGap({
    armed: null,
    now: t0,
    currentTime: 40,
    ranges: [
      [0, 40],
      [42, 50]
    ]
  }),
  null
);

// Armed by a resume restore: a gap up to 20 s is stepped over.
near(
  shouldJumpVidaaBufferGap({
    armed: resumeArm,
    now: t0 + 500,
    currentTime: 410,
    ranges: [[429.5, 440]]
  }),
  429.51
);

// Armed by a user seek: only small gaps (5 s).
near(
  shouldJumpVidaaBufferGap({
    armed: seekArm,
    now: t0 + 500,
    currentTime: 100,
    ranges: [[104, 120]]
  }),
  104.01
);
assert.equal(
  shouldJumpVidaaBufferGap({
    armed: seekArm,
    now: t0 + 500,
    currentTime: 100,
    ranges: [[110, 120]]
  }),
  null
);

// The arm expires after a few seconds.
assert.equal(
  shouldJumpVidaaBufferGap({
    armed: resumeArm,
    now: t0 + 9000,
    currentTime: 410,
    ranges: [[420, 440]]
  }),
  null
);

// Never while a seek is still running or the user is scrubbing.
assert.equal(
  shouldJumpVidaaBufferGap({
    armed: resumeArm,
    now: t0,
    currentTime: 410,
    ranges: [[420, 440]],
    seeking: true
  }),
  null
);
assert.equal(
  shouldJumpVidaaBufferGap({
    armed: resumeArm,
    now: t0,
    currentTime: 410,
    ranges: [[420, 440]],
    scrubbing: true
  }),
  null
);

console.log("VIDAA buffer gap checks passed.");
