import assert from "node:assert/strict";
import { shouldShowVidaaAutoPlaySelecting } from "../js/platform/vidaa/vidaaAutoPlaySelecting.js";

const base = { isVidaa: true, autoPlayMode: "FIRST_STREAM", autoPlayEnabled: true };

// Fresh open with automatic selection on VIDAA: show "finding source", not the list.
assert.equal(shouldShowVidaaAutoPlaySelecting(base), true);

// Manual mode, manual selection, coming back from the player, other platforms: keep the list.
assert.equal(shouldShowVidaaAutoPlaySelecting({ ...base, autoPlayMode: "MANUAL" }), false);
assert.equal(shouldShowVidaaAutoPlaySelecting({ ...base, autoPlayMode: "manual" }), false);
assert.equal(shouldShowVidaaAutoPlaySelecting({ ...base, manualSelection: true }), false);
assert.equal(shouldShowVidaaAutoPlaySelecting({ ...base, isBackNavigation: true }), false);
assert.equal(shouldShowVidaaAutoPlaySelecting({ ...base, isVidaa: false }), false);
assert.equal(shouldShowVidaaAutoPlaySelecting({ ...base, autoPlayEnabled: false }), false);
assert.equal(shouldShowVidaaAutoPlaySelecting(), false);

console.log("VIDAA auto-play selecting checks passed.");
