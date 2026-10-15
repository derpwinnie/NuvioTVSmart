import assert from "node:assert/strict";
import {
  selectVidaaTextTrack,
  shouldDisableVidaaInitialTextTrack
} from "../js/platform/vidaa/vidaaVideo.js";

// VIDAA renders the first embedded subtitle track while every mode reads "disabled".
// Turning subtitles off must toggle it on and off (as Stremio's VidaaVideo does).
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const log = [];
const track = (name) => {
  let mode = "disabled";
  return {
    get mode() {
      return mode;
    },
    set mode(value) {
      mode = value;
      log.push(`${name}:${value}`);
    }
  };
};

let tracks = [track("a"), track("b")];
assert.equal(selectVidaaTextTrack(tracks, -1), true);
assert.deepEqual(log, ["a:showing"]);
await tick();
assert.deepEqual(log, ["a:showing", "a:disabled", "b:disabled"]);
assert.ok(tracks.every((entry) => entry.mode === "disabled"));

// A track Nuvio showed itself is turned off directly, without the toggle.
log.length = 0;
tracks = [track("a"), track("b")];
tracks[1].mode = "showing";
log.length = 0;
selectVidaaTextTrack(tracks, -1);
assert.deepEqual(log, ["a:disabled", "b:disabled"]);

// Selecting a track still works as before.
log.length = 0;
selectVidaaTextTrack(tracks, 0);
assert.equal(tracks[0].mode, "showing");
assert.equal(tracks[1].mode, "disabled");
await tick();

// The automatic turn-off only applies when Nuvio shows no subtitle of its own.
assert.equal(shouldDisableVidaaInitialTextTrack({ selectedSubtitleTrackIndex: -1 }), true);
assert.equal(shouldDisableVidaaInitialTextTrack({ selectedSubtitleTrackIndex: 1 }), false);
assert.equal(
  shouldDisableVidaaInitialTextTrack({
    selectedSubtitleTrackIndex: -1,
    selectedAddonSubtitleId: "x"
  }),
  false
);
assert.equal(
  shouldDisableVidaaInitialTextTrack({ selectedSubtitleTrackIndex: -1, externalTrackNodes: [{}] }),
  false
);

console.log("VIDAA subtitle off checks passed.");
