// VIDAA's HTML player lists MKV audio tracks without language or name, and the
// TV has no local media service to ask. Read the Matroska Tracks element from
// the start of the file instead (a ranged fetch), so the audio menu can show
// "German" or "English 5.1" rather than "Audio 1".

const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_SEEK = 0x4dbb;
const ID_SEEK_ID = 0x53ab;
const ID_SEEK_POSITION = 0x53ac;
const ID_TRACKS = 0x1654ae6b;
const ID_CLUSTER = 0x1f43b675;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_FLAG_DEFAULT = 0x88;
const ID_FLAG_FORCED = 0x55aa;
const ID_CODEC_ID = 0x86;
const ID_NAME = 0x536e;
const ID_LANGUAGE = 0x22b59c;
const ID_LANGUAGE_BCP47 = 0x22b59d;
const ID_AUDIO = 0xe1;
const ID_CHANNELS = 0x9f;
const ID_SAMPLING_FREQUENCY = 0xb5;

const TRACK_TYPE_AUDIO = 2;
const HEAD_BYTES = 256 * 1024;
const TRACKS_MAX_BYTES = 256 * 1024;
// The first request often waits on the addon resolving the debrid link, which
// can take well over 5s; later requests are fast. Allow for the slow first one.
const REQUEST_TIMEOUT_MS = 15000;

const CODEC_NAMES = [
  [/^A_EAC3/, "EAC3"],
  [/^A_AC3/, "AC3"],
  [/^A_DTS/, "DTS"],
  [/^A_TRUEHD/, "TrueHD"],
  [/^A_AAC/, "AAC"],
  [/^A_OPUS/, "Opus"],
  [/^A_FLAC/, "FLAC"],
  [/^A_VORBIS/, "Vorbis"],
  [/^A_MPEG\/L3/, "MP3"],
  [/^A_MPEG\/L2/, "MP2"],
  [/^A_PCM/, "PCM"]
];

// Spelling for user-facing messages; the audio menu keeps the short names above.
const CODEC_DISPLAY_NAMES = { EAC3: "E-AC-3", AC3: "AC-3" };

// "A_DTS" -> "DTS", "A_EAC3" -> "E-AC-3". Empty for an empty codec id.
export function vidaaAudioCodecDisplayName(codecId) {
  const id = String(codecId || "").trim();
  if (!id) return "";
  const name = codecName(id);
  return CODEC_DISPLAY_NAMES[name] || name;
}

function readVint(bytes, offset, keepMarker) {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    length += 1;
    mask >>= 1;
  }
  if (offset + length > bytes.length) return null;
  let value = keepMarker ? first : first & (mask - 1);
  let allOnes = (first & (mask - 1)) === mask - 1;
  for (let index = 1; index < length; index += 1) {
    const byte = bytes[offset + index];
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

// Yields { id, start, dataStart, dataEnd } for each child element in [start, end).
// dataEnd is clamped to the bytes we have; `truncated` marks a cut-off element.
function readChildren(bytes, start, end) {
  const children = [];
  let offset = start;
  while (offset < end) {
    const id = readVint(bytes, offset, true);
    if (!id) break;
    const size = readVint(bytes, offset + id.length, false);
    if (!size) break;
    const dataStart = offset + id.length + size.length;
    const declaredEnd = size.unknown ? Infinity : dataStart + size.value;
    children.push({
      id: id.value,
      start: offset,
      dataStart,
      dataEnd: Math.min(declaredEnd, end, bytes.length),
      truncated: declaredEnd > bytes.length
    });
    if (size.unknown || declaredEnd >= end) break;
    offset = declaredEnd;
  }
  return children;
}

function readUint(bytes, element) {
  let value = 0;
  for (let index = element.dataStart; index < element.dataEnd; index += 1) {
    value = value * 256 + bytes[index];
  }
  return value;
}

function readFloat(bytes, element) {
  const length = element.dataEnd - element.dataStart;
  if (length !== 4 && length !== 8) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset + element.dataStart, length);
  return length === 4 ? view.getFloat32(0) : view.getFloat64(0);
}

function readString(bytes, element) {
  const slice = bytes.subarray(element.dataStart, element.dataEnd);
  let text;
  try {
    text = new TextDecoder("utf-8").decode(slice);
  } catch (_) {
    text = String.fromCharCode(...slice);
  }
  return text.replace(/\0+$/, "").trim();
}

function codecName(codecId) {
  const match = CODEC_NAMES.find(([pattern]) => pattern.test(codecId));
  return match ? match[1] : codecId.replace(/^A_/, "");
}

function parseTrackEntry(bytes, entry) {
  const track = { trackType: 0, number: 0, codecId: "", name: "", language: "eng", bcp47: "" };
  track.isDefault = true;
  track.forced = false;
  readChildren(bytes, entry.dataStart, entry.dataEnd).forEach((child) => {
    if (child.truncated) return;
    switch (child.id) {
      case ID_TRACK_NUMBER:
        track.number = readUint(bytes, child);
        break;
      case ID_TRACK_TYPE:
        track.trackType = readUint(bytes, child);
        break;
      case ID_FLAG_DEFAULT:
        track.isDefault = readUint(bytes, child) === 1;
        break;
      case ID_FLAG_FORCED:
        track.forced = readUint(bytes, child) === 1;
        break;
      case ID_CODEC_ID:
        track.codecId = readString(bytes, child);
        break;
      case ID_NAME:
        track.name = readString(bytes, child);
        break;
      case ID_LANGUAGE:
        track.language = readString(bytes, child);
        break;
      case ID_LANGUAGE_BCP47:
        track.bcp47 = readString(bytes, child);
        break;
      case ID_AUDIO:
        readChildren(bytes, child.dataStart, child.dataEnd).forEach((audioChild) => {
          if (audioChild.id === ID_CHANNELS) track.channels = readUint(bytes, audioChild);
          if (audioChild.id === ID_SAMPLING_FREQUENCY)
            track.sampleRate = Math.round(readFloat(bytes, audioChild));
        });
        break;
      default:
        break;
    }
  });
  return track;
}

// Turns a Tracks element body into the track shape the local media services
// return, so the player's existing metadata merge can use it unchanged.
function parseTracksElement(bytes, tracksElement) {
  return readChildren(bytes, tracksElement.dataStart, tracksElement.dataEnd)
    .filter((child) => child.id === ID_TRACK_ENTRY && !child.truncated)
    .map((child) => parseTrackEntry(bytes, child))
    .filter((track) => track.trackType === TRACK_TYPE_AUDIO)
    .map((track) => {
      const language = track.bcp47 || track.language;
      const codec = codecName(track.codecId);
      return {
        id: track.number,
        type: "audio",
        lang: language,
        language,
        label: track.name,
        name: track.name,
        codec,
        audioCodec: codec,
        codec_id: track.codecId,
        channels: track.channels || "",
        sampleRate: track.sampleRate || 0,
        isDefault: track.isDefault,
        forced: track.forced
      };
    });
}

// Parses the head of a Matroska file. Returns { tracks } when the Tracks
// element is complete in `bytes`, { tracksOffset } when only the SeekHead
// says where it is, or null when this is not Matroska.
export function parseMatroskaHead(bytes) {
  const topLevel = readChildren(bytes, 0, bytes.length);
  if (topLevel[0]?.id !== ID_EBML) return null;
  const segment = topLevel.find((element) => element.id === ID_SEGMENT);
  if (!segment) return null;

  let tracksOffset = -1;
  for (const child of readChildren(bytes, segment.dataStart, bytes.length)) {
    if (child.id === ID_TRACKS) {
      if (!child.truncated) return { tracks: parseTracksElement(bytes, child) };
      tracksOffset = child.start - segment.dataStart;
      break;
    }
    if (child.id === ID_CLUSTER) break;
    if (child.id === ID_SEEK_HEAD && !child.truncated) {
      readChildren(bytes, child.dataStart, child.dataEnd)
        .filter((seek) => seek.id === ID_SEEK)
        .forEach((seek) => {
          let seekId = 0;
          let position = -1;
          readChildren(bytes, seek.dataStart, seek.dataEnd).forEach((field) => {
            if (field.id === ID_SEEK_ID) seekId = readUint(bytes, field);
            if (field.id === ID_SEEK_POSITION) position = readUint(bytes, field);
          });
          if (seekId === ID_TRACKS && position >= 0) tracksOffset = position;
        });
    }
  }
  if (tracksOffset < 0) return { tracks: [] };
  return { tracksOffset: segment.dataStart + tracksOffset };
}

// Parses bytes that start at the Tracks element (fetched via the SeekHead).
export function parseMatroskaTracksAt(bytes) {
  const [element] = readChildren(bytes, 0, bytes.length);
  if (element?.id !== ID_TRACKS || element.truncated) return [];
  return parseTracksElement(bytes, element);
}

// Reads at most maxBytes from a ranged request. A server that ignores Range
// answers 200 with the whole file, so stop reading and abort once we have
// enough instead of downloading the movie.
async function fetchRange(url, start, maxBytes, fetchImpl) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : 0;
  try {
    const response = await fetchImpl(url, {
      headers: { Range: `bytes=${start}-${start + maxBytes - 1}` },
      signal: controller?.signal
    });
    if (!response.ok) throw new Error(`MKV header request failed with HTTP ${response.status}`);
    if (response.status !== 206 && start > 0) throw new Error("Server ignored the byte range");
    const reader = response.body?.getReader?.();
    if (!reader) {
      if (response.status !== 206) throw new Error("Server ignored the byte range");
      return new Uint8Array(await response.arrayBuffer()).subarray(0, maxBytes);
    }
    const result = new Uint8Array(maxBytes);
    let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, maxBytes - received);
      result.set(value.subarray(0, take), received);
      received += take;
    }
    reader.cancel?.().catch?.(() => {});
    return result.subarray(0, received);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    controller?.abort();
  }
}

export async function fetchVidaaMkvAudioTracks(
  url,
  { fetchImpl = globalThis.fetch?.bind(globalThis) } = {}
) {
  if (!url || typeof fetchImpl !== "function") return [];
  const head = await fetchRange(url, 0, HEAD_BYTES, fetchImpl);
  const parsed = parseMatroskaHead(head);
  if (!parsed) return [];
  if (parsed.tracks) return parsed.tracks;
  const tracksBytes = await fetchRange(url, parsed.tracksOffset, TRACKS_MAX_BYTES, fetchImpl);
  return parseMatroskaTracksAt(tracksBytes);
}
