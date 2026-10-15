import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fetchVidaaMkvAudioTracks,
  parseMatroskaHead,
  parseMatroskaTracksAt,
  vidaaAudioCodecDisplayName
} from "../js/platform/vidaa/vidaaMkvTracks.js";

const bytes = new Uint8Array(
  await readFile(new URL("./fixtures/vidaa-audio-tracks.mkv", import.meta.url))
);
const summary = (tracks) =>
  tracks.map((track) => [track.type, track.language, track.name, track.codec]);
const expected = [
  ["audio", "ger", "Deutsch DD 5.1", "AC3"],
  ["audio", "eng", "", "AAC"],
  ["audio", "jpn", "Kommentar", "EAC3"]
];

// 1. A complete head yields the audio tracks in file order.
assert.deepEqual(summary(parseMatroskaHead(bytes).tracks), expected);

// 2. A head that cuts off the Tracks element points at it instead.
let cut = 0;
for (let length = 64; length < bytes.length; length += 8) {
  if (parseMatroskaHead(bytes.subarray(0, length))?.tracks?.length) break;
  cut = length;
}
const partial = parseMatroskaHead(bytes.subarray(0, cut));
assert.equal(typeof partial.tracksOffset, "number");
assert.deepEqual(summary(parseMatroskaTracksAt(bytes.subarray(partial.tracksOffset))), expected);

// 3. Non-Matroska data is ignored.
assert.equal(parseMatroskaHead(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])), null);

// 4. The ranged fetch reads only the head.
const requested = [];
const rangedFetch = async (_url, init) => {
  const [, start, end] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).map(Number);
  requested.push([start, end]);
  return new Response(bytes.slice(start, end + 1), { status: 206 });
};
assert.deepEqual(
  summary(await fetchVidaaMkvAudioTracks("https://example.com/a.mkv", { fetchImpl: rangedFetch })),
  expected
);
assert.deepEqual(requested, [[0, 256 * 1024 - 1]]);

// 5. A server that ignores Range is not read to the end.
let pulled = 0;
const fullBody = new ReadableStream({
  pull(controller) {
    pulled += 64 * 1024;
    controller.enqueue(new Uint8Array(64 * 1024));
    if (pulled > 4 * 1024 * 1024) controller.close();
  }
});
const ignoringFetch = async () => new Response(fullBody, { status: 200 });
assert.deepEqual(
  await fetchVidaaMkvAudioTracks("https://example.com/a.mkv", { fetchImpl: ignoringFetch }),
  []
);
assert.ok(pulled <= 512 * 1024, `read ${pulled} bytes`);

// 6. Human-readable codec names for messages.
assert.deepEqual(
  [
    "A_DTS",
    "A_TRUEHD",
    "A_EAC3",
    "A_AC3",
    "A_AAC",
    "A_OPUS",
    "A_FLAC",
    "A_DTS/LOSSLESS",
    "A_XYZ",
    ""
  ].map(vidaaAudioCodecDisplayName),
  ["DTS", "TrueHD", "E-AC-3", "AC-3", "AAC", "Opus", "FLAC", "DTS", "XYZ", ""]
);

console.log("vidaa mkv tracks: ok");
