// VIDAA: native audio track selection that follows the track, not its position.
//
// The audio dialog keeps a snapshot of its entries. VIDAA firmware can reorder or
// replace the AudioTrackList before it dispatches "change", so an old ordinal can
// point at another language. A selection the firmware rejects half-way must not
// leave every track disabled either. Empi9245 found both on a real VIDAA TV
// (firmware U09.60, 2026-10-16) and fixed them in his fork (93fa57bd); this is the
// same behavior as a small module.

function clean(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

// What identifies a native track across list replacements.
export function describeVidaaAudioTrack(track) {
  return {
    id: clean(track?.id ?? track?.trackId),
    language: clean(track?.language ?? track?.lang),
    label: clean(track?.label ?? track?.name)
  };
}

// Current index of `wanted` in `tracks`: the same object, else the one track with
// the same identity. Without a native object the entry's own index is used.
// Returns -1 when the track is gone or ambiguous.
export function resolveVidaaAudioTrackIndex(tracks, wanted, fallbackIndex = -1) {
  const list = Array.from(tracks || []);
  if (!wanted) {
    return Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < list.length
      ? fallbackIndex
      : -1;
  }
  const objectIndex = list.indexOf(wanted);
  if (objectIndex >= 0) return objectIndex;
  const identity = describeVidaaAudioTrack(wanted);
  const keys = Object.keys(identity).filter((key) => identity[key]);
  if (!keys.length) return -1;
  const matches = list.filter((track) => {
    const candidate = describeVidaaAudioTrack(track);
    return keys.every((key) => candidate[key] === identity[key]);
  });
  return matches.length === 1 ? list.indexOf(matches[0]) : -1;
}

function flagNames(track) {
  // VIDAA exposes `enabled`; `selected` belongs to video tracks.
  return ["enabled", "selected"].filter((name) => {
    try {
      return typeof track?.[name] === "boolean";
    } catch (_) {
      return false;
    }
  });
}

function setFlag(track, name, value) {
  try {
    if (track[name] !== value) track[name] = value;
  } catch (_) {
    // A firmware rejection stays a failed selection.
  }
}

// Whether exactly the target track is enabled.
export function vidaaAudioSelectionMatches(tracks, targetIndex) {
  const list = Array.from(tracks || []);
  if (!list[targetIndex]) return false;
  try {
    return list.every((track, index) => {
      if (!("enabled" in track)) return true;
      return Boolean(track.enabled) === (index === targetIndex);
    });
  } catch (_) {
    return false;
  }
}

// Enables the target before disabling the others, so a firmware that accepts
// the first command and rejects the second never ends with no audio at all.
// Returns a rollback that restores the previous flags while `tracks` is still the
// current list.
export function selectVidaaAudioTrack(tracks, targetIndex) {
  const list = Array.from(tracks || []);
  const snapshot = list.map((track) => ({
    track,
    flags: flagNames(track).map((name) => [name, Boolean(track[name])])
  }));
  const target = list[targetIndex];
  if (target) flagNames(target).forEach((name) => setFlag(target, name, true));
  list.forEach((track, index) => {
    if (index !== targetIndex) flagNames(track).forEach((name) => setFlag(track, name, false));
  });
  return function rollback(currentTracks = list) {
    const current = Array.from(currentTracks || []);
    if (
      current.length !== snapshot.length ||
      snapshot.some(({ track }) => !current.includes(track))
    ) {
      return false;
    }
    // Re-enable the previous output first, then switch the others back off.
    for (const enabled of [true, false]) {
      for (const { track, flags } of snapshot) {
        for (const [name, value] of flags) {
          if (value === enabled) setFlag(track, name, value);
        }
      }
    }
    return true;
  };
}
