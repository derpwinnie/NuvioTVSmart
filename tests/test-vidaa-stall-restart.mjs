import assert from "node:assert/strict";
import {
  nextVidaaStallRestarts,
  VIDAA_STALL_RESTART_WINDOW_MS
} from "../js/platform/vidaa/vidaaStallRestart.js";

// First stall: restart allowed.
assert.deepEqual(nextVidaaStallRestarts(undefined, 1000), [1000]);

// Up to three restarts within the window, then the sources panel takes over.
let history = [];
for (const now of [1000, 20000, 40000]) history = nextVidaaStallRestarts(history, now);
assert.deepEqual(history, [1000, 20000, 40000]);
assert.equal(nextVidaaStallRestarts(history, 60000), null);

// Old restarts fall out of the window, so a later stall may restart again.
const later = 1000 + VIDAA_STALL_RESTART_WINDOW_MS + 1;
assert.deepEqual(nextVidaaStallRestarts(history, later), [20000, 40000, later]);

console.log("VIDAA stall restart checks passed.");
