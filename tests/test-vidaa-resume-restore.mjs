import assert from "node:assert/strict";
import {
  decideVidaaResumeRestore,
  getVidaaResumeSeekTarget,
  VIDAA_RESTORE_MAX_ATTEMPTS
} from "../js/platform/vidaa/vidaaResumeRestore.js";

// The hang seen in the browser: currentTime 0, data buffered only around the target.
assert.deepEqual(
  decideVidaaResumeRestore({ targetSeconds: 400, ranges: [[393, 438]], attempts: 1 }),
  {
    action: "seek",
    seconds: 400
  }
);

// Buffer starts a little after the target (keyframe): land inside it.
assert.equal(getVidaaResumeSeekTarget(400, [[410, 438]]), 410.01);

// Nothing buffered near the target: plain seek to the target.
assert.equal(getVidaaResumeSeekTarget(400, []), 400);
assert.equal(getVidaaResumeSeekTarget(400, [[0, 20]]), 400);
assert.equal(getVidaaResumeSeekTarget(400, [[450, 500]]), 400);
// A range that ends before the target does not help.
assert.equal(getVidaaResumeSeekTarget(400, [[380, 399]]), 400);

// A running seek is not interrupted unless forced (loadedmetadata).
assert.deepEqual(decideVidaaResumeRestore({ targetSeconds: 400, seeking: true }), {
  action: "wait"
});
assert.equal(
  decideVidaaResumeRestore({ targetSeconds: 400, seeking: true, force: true }).action,
  "seek"
);

// Give up after a few attempts.
assert.equal(
  decideVidaaResumeRestore({ targetSeconds: 400, attempts: VIDAA_RESTORE_MAX_ATTEMPTS - 1 }).action,
  "seek"
);
assert.equal(
  decideVidaaResumeRestore({ targetSeconds: 400, attempts: VIDAA_RESTORE_MAX_ATTEMPTS }).action,
  "give-up"
);

console.log("VIDAA resume restore checks passed.");
