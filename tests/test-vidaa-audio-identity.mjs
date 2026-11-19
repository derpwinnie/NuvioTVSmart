import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const {
  describeVidaaAudioTrack,
  resolveVidaaAudioTrackIndex,
  selectVidaaAudioTrack,
  vidaaAudioSelectionMatches
} = await import("../js/platform/vidaa/vidaaAudioTrackIdentity.js");

const track = (id, language, enabled = false) => ({ id, language, label: "", enabled });

// Identity follows the object, then a unique id/language match.
{
  const ita = track("1", "ita", true);
  const kor = track("2", "kor");
  const eng = track("3", "eng");
  assert.equal(resolveVidaaAudioTrackIndex([ita, kor, eng], kor, 1), 1);
  assert.equal(
    resolveVidaaAudioTrackIndex([eng, ita, kor], kor, 1),
    2,
    "a reordered list keeps the track"
  );
  const replaced = [track("1", "ita"), track("3", "eng"), track("2", "kor")];
  assert.equal(
    resolveVidaaAudioTrackIndex(replaced, kor, 1),
    2,
    "new objects with the same identity"
  );
  assert.equal(
    resolveVidaaAudioTrackIndex([ita, eng], kor, 1),
    -1,
    "a removed track is not replaced by its position"
  );
  const twins = [track("", "eng"), track("", "eng")];
  assert.equal(
    resolveVidaaAudioTrackIndex(twins, track("", "eng"), 0),
    -1,
    "an ambiguous identity is refused"
  );
  assert.equal(
    resolveVidaaAudioTrackIndex([ita, kor], null, 1),
    1,
    "no native track: the entry index"
  );
  assert.equal(resolveVidaaAudioTrackIndex([ita, kor], null, 5), -1);
  assert.deepEqual(describeVidaaAudioTrack({ id: " A ", language: "ITA", name: "Main" }), {
    id: "a",
    language: "ita",
    label: "main"
  });
}

// The target is enabled before the others are switched off; a rejection rolls back.
{
  const order = [];
  const make = (id, enabled) => {
    let value = enabled;
    return {
      id,
      language: id,
      get enabled() {
        return value;
      },
      set enabled(next) {
        order.push(`${id}:${next}`);
        value = next;
      }
    };
  };
  const tracks = [make("ita", true), make("kor", false), make("eng", false)];
  const rollback = selectVidaaAudioTrack(tracks, 1);
  assert.deepEqual(order, ["kor:true", "ita:false"], "enable first, then disable the old track");
  assert.equal(vidaaAudioSelectionMatches(tracks, 1), true);
  assert.equal(rollback(tracks), true);
  assert.deepEqual(
    tracks.map((t) => t.enabled),
    [true, false, false],
    "rollback restores the previous output"
  );
  assert.equal(rollback([tracks[0]]), false, "no rollback on a replaced list");
}

// Player level: a dialog snapshot after the firmware reordered its list, and a
// firmware that refuses to switch.
const { createPlayerScreenVidaaAudioSupportMethods } =
  await import("../js/ui/screens/player/playerScreenVidaaAudioSupport.js");
globalThis.__NUVIO_PLATFORM__ = "vidaa";
const { Platform } = await import("../js/platform/index.js");
Platform.current = null;
function player(tracks) {
  const methods = createPlayerScreenVidaaAudioSupportMethods();
  return {
    ...methods,
    tracks,
    renders: 0,
    remembered: null,
    selectedAudioTrackIndex: 0,
    getAudioTracks() {
      return this.tracks;
    },
    invalidateTrackDialogCaches() {},
    renderControlButtons() {},
    renderAudioDialog() {
      this.renders += 1;
    },
    rememberAudioTrackSelection(preference) {
      this.remembered = preference;
    },
    getAudioTrackPreference(entry) {
      return { language: entry.nativeAudioTrack?.language || "" };
    }
  };
}
{
  const ita = track("1", "ita", true);
  const kor = track("2", "kor");
  const eng = track("3", "eng");
  const screen = player([ita, kor, eng]);
  // The dialog entry was built while kor was at index 1 ...
  const entry = { id: "audio-track-1", audioTrackIndex: 1, nativeAudioTrack: kor };
  // ... then the firmware reordered the list before "change".
  screen.tracks = [eng, ita, kor];
  assert.equal(screen.applyVidaaNativeAudioTrack(entry, 1, { rememberSelection: true }), true);
  assert.equal(screen.selectedAudioTrackIndex, 2);
  assert.deepEqual(
    screen.tracks.map((t) => t.enabled),
    [false, false, true],
    "the chosen language plays, not the track now at its old index"
  );
  assert.deepEqual(screen.remembered, { language: "kor" });
}
{
  const ita = track("1", "ita", true);
  const stubborn = {
    id: "2",
    language: "kor",
    label: "",
    get enabled() {
      return false;
    },
    set enabled(_) {}
  };
  const screen = player([ita, stubborn]);
  const entry = { id: "audio-track-1", audioTrackIndex: 1, nativeAudioTrack: stubborn };
  assert.equal(
    screen.applyVidaaNativeAudioTrack(entry, 1),
    false,
    "a refused switch is reported as failed"
  );
  assert.equal(ita.enabled, true, "the previous track keeps playing");
  assert.equal(screen.selectedAudioTrackIndex, 0);
  assert.ok(screen.renders > 0, "the dialog shows the real state again");
}
// The overlay attaches the native track to upstream's entries.
{
  const screen = player([]);
  const native = [track("1", "ita", true), track("2", "kor")];
  Object.assign(screen, {
    embeddedAudioTracks: [],
    selectedEmbeddedAudioTrackIndex: -1,
    getEmbeddedAudioTrackByNativeIndex: () => null,
    getEmbeddedAudioTrack: () => null,
    mergeEmbeddedAudioTrackMetadata: (t) => ({ ...t })
  });
  const entries = screen.getMergedAudioTrackEntries(native);
  assert.equal(entries[1].nativeAudioTrack, native[1]);
}

console.log(
  "VIDAA audio identity checks passed: reorder, replacement, ambiguity, enable-first order and rollback."
);
