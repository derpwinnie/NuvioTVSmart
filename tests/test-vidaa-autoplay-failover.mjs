import assert from "node:assert/strict";
import { pickVidaaNextAutoPlayCandidate, VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS } from "../js/platform/vidaa/vidaaAutoPlayFailover.js";

const list = [
  { id: "a", url: "https://x/a.avi" },
  { id: "b", url: "https://x/b.mkv" },
  { id: "c", url: "https://x/c.mp4" }
];

// The AVI failed: take the next source in list order.
assert.equal(pickVidaaNextAutoPlayCandidate(list, { currentId: "a", failedUrls: new Set(["https://x/a.avi"]) })?.id, "b");

// Skip sources that already failed, wrap around the list.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, { currentId: "c", failedIds: new Set(["a", "c"]) })?.id,
  "b"
);

// Everything failed, or nothing else to try: stop.
assert.equal(pickVidaaNextAutoPlayCandidate(list, { currentId: "a", failedIds: new Set(["a", "b", "c"]) }), null);
assert.equal(pickVidaaNextAutoPlayCandidate([list[0]], { currentId: "a" }), null);
assert.equal(pickVidaaNextAutoPlayCandidate([], {}), null);

// Candidates without a URL are not playable.
assert.equal(pickVidaaNextAutoPlayCandidate([{ id: "a", url: "u" }, { id: "b" }], { currentId: "a" }), null);

// Bounded number of attempts.
assert.equal(pickVidaaNextAutoPlayCandidate(list, { currentId: "a", attempts: VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS }), null);

console.log("VIDAA auto-play failover checks passed.");
