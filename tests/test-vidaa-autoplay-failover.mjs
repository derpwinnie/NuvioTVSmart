import assert from "node:assert/strict";
import { pickVidaaNextAutoPlayCandidate, VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS } from "../js/platform/vidaa/vidaaAutoPlayFailover.js";

const list = [
  { id: "a", url: "https://x/a.avi", name: "Movie 2160p AVI", addonName: "AIO" },
  { id: "b", url: "https://x/b.mkv", name: "Movie 720p", addonName: "AIO" },
  { id: "c", url: "https://x/c.mkv", name: "Movie 1080p", addonName: "AIO" }
];
const failedA = { currentId: "a", failedUrls: new Set(["https://x/a.avi"]) };

// First stream mode: the next best is the next one in the ranked list.
assert.equal(pickVidaaNextAutoPlayCandidate(list, { ...failedA, settings: { streamAutoPlayMode: "FIRST_STREAM" } })?.id, "b");

// Regex mode: the next source that still matches the user's rule wins, not list order.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, { ...failedA, settings: { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "1080p" } })?.id,
  "c"
);

// Regex mode with no other match: fall back to list order instead of giving up.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, { ...failedA, settings: { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "2160p" } })?.id,
  "b"
);

// Without settings: list order after the failed one, wrapping around, skipping failures.
assert.equal(pickVidaaNextAutoPlayCandidate(list, failedA)?.id, "b");
assert.equal(pickVidaaNextAutoPlayCandidate(list, { currentId: "c", failedIds: new Set(["a", "c"]) })?.id, "b");

// Everything failed, nothing else, no URL, or too many attempts: stop.
assert.equal(pickVidaaNextAutoPlayCandidate(list, { currentId: "a", failedIds: new Set(["a", "b", "c"]) }), null);
assert.equal(pickVidaaNextAutoPlayCandidate([list[0]], { currentId: "a" }), null);
assert.equal(pickVidaaNextAutoPlayCandidate([], {}), null);
assert.equal(pickVidaaNextAutoPlayCandidate([{ id: "a", url: "u" }, { id: "b" }], { currentId: "a" }), null);
assert.equal(pickVidaaNextAutoPlayCandidate(list, { ...failedA, attempts: VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS }), null);

console.log("VIDAA auto-play failover checks passed.");
