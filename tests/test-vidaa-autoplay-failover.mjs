import assert from "node:assert/strict";
import {
  getVidaaAutoPlayFailoverEligibility,
  isVidaaFailoverMediaError,
  pickVidaaNextAutoPlayCandidate,
  VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS
} from "../js/platform/vidaa/vidaaAutoPlayFailover.js";

const list = [
  { id: "a", url: "https://x/a.avi", name: "Movie 2160p AVI", addonName: "AIO" },
  { id: "b", url: "https://x/b.mkv", name: "Movie 720p", addonName: "AIO" },
  { id: "c", url: "https://x/c.mkv", name: "Movie 1080p", addonName: "AIO" }
];
const failedA = { currentId: "a", failedUrls: new Set(["https://x/a.avi"]) };

// First stream mode: the next best is the next one in the ranked list.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, {
    ...failedA,
    settings: { streamAutoPlayMode: "FIRST_STREAM" }
  })?.id,
  "b"
);

// Regex mode: the next source that still matches the user's rule wins, not list order.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, {
    ...failedA,
    settings: { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "1080p" }
  })?.id,
  "c"
);

// Regex mode with no other match: stop, the user's rule excludes the rest.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, {
    ...failedA,
    settings: { streamAutoPlayMode: "REGEX_MATCH", streamAutoPlayRegex: "2160p" }
  }),
  null
);

// Without settings: list order after the failed one, wrapping around, skipping failures.
assert.equal(pickVidaaNextAutoPlayCandidate(list, failedA)?.id, "b");
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, { currentId: "c", failedIds: new Set(["a", "c"]) })?.id,
  "b"
);

// Everything failed, nothing else, no URL, or too many attempts: stop.
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, { currentId: "a", failedIds: new Set(["a", "b", "c"]) }),
  null
);
assert.equal(pickVidaaNextAutoPlayCandidate([list[0]], { currentId: "a" }), null);
assert.equal(pickVidaaNextAutoPlayCandidate([], {}), null);
assert.equal(
  pickVidaaNextAutoPlayCandidate([{ id: "a", url: "u" }, { id: "b" }], { currentId: "a" }),
  null
);
assert.equal(
  pickVidaaNextAutoPlayCandidate(list, {
    ...failedA,
    attempts: VIDAA_AUTOPLAY_FAILOVER_MAX_ATTEMPTS
  }),
  null
);

// Only decode/format errors, or network errors while online, trigger a failover.
assert.equal(isVidaaFailoverMediaError(3), true);
assert.equal(isVidaaFailoverMediaError(4), true);
assert.equal(isVidaaFailoverMediaError(2, true), true);
assert.equal(isVidaaFailoverMediaError(2, undefined), true);
assert.equal(isVidaaFailoverMediaError(2, false), false);
assert.equal(isVidaaFailoverMediaError(1), false);
assert.equal(isVidaaFailoverMediaError(0), false);

// Eligibility: only sources the auto-play logic picked, never a user's choice.
assert.equal(
  getVidaaAutoPlayFailoverEligibility({ autoPlayOn: true, autoPlaySelected: true }),
  "eligible"
);
assert.equal(
  getVidaaAutoPlayFailoverEligibility({ autoPlayOn: false, autoPlaySelected: true }),
  "auto-play-off"
);
// Picked on the Sources screen (no auto-play flag).
assert.equal(getVidaaAutoPlayFailoverEligibility({ autoPlayOn: true }), "manual-selection");
// "Play manually" entry point.
assert.equal(
  getVidaaAutoPlayFailoverEligibility({
    autoPlayOn: true,
    autoPlaySelected: true,
    manualSelection: true
  }),
  "manual-selection"
);
// Picked in the player's Sources panel after an auto-play start.
assert.equal(
  getVidaaAutoPlayFailoverEligibility({
    autoPlayOn: true,
    autoPlaySelected: true,
    userPickedSource: true
  }),
  "manual-selection"
);

console.log("VIDAA auto-play failover checks passed.");
