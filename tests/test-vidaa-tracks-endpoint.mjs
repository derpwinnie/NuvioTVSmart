import assert from "node:assert/strict";
import vm from "node:vm";
import { buildRuntimeEnvScript } from "../scripts/envProperties.mjs";

// Run as the VIDAA browser build.
globalThis.location = { search: "?wrapper=vidaa", hostname: "example.github.io" };
globalThis.__NUVIO_ENV__ = {};
console.warn = () => {};

const requested = [];
globalThis.fetch = async (url) => {
  requested.push(String(url));
  if (String(url).startsWith("/tracks/")) {
    return new Response(JSON.stringify([{ type: "audio", language: "eng" }]), { status: 200 });
  }
  // Direct MKV reads fail without CORS headers on the stream host.
  throw new TypeError("Failed to fetch");
};

const { localMediaTracksRepository } =
  await import("../js/data/repository/localMediaTracksRepository.js");
const sameOriginCalls = () => requested.filter((url) => url.startsWith("/tracks/"));

// 1. Static hosting (no flag): the stream URL never goes to /tracks on the app host.
assert.deepEqual(
  await localMediaTracksRepository.getTracks("https://debrid.example/token123/a.mkv"),
  []
);
assert.equal(sameOriginCalls().length, 0);
assert.equal(requested.length, 1);

// 2. The dev server sets the flag, so the fallback may use its /tracks proxy.
globalThis.__NUVIO_ENV__ = { NUVIO_LOCAL_TRACKS_ENDPOINT: true };
const tracks = await localMediaTracksRepository.getTracks("https://debrid.example/token123/b.mkv");
assert.equal(tracks.length, 1);
assert.equal(sameOriginCalls().length, 1);

// 3. The env script only carries the flag when the serving process adds it;
//    local.properties cannot switch it on.
const readEnv = (script) => {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(script, sandbox);
  return sandbox.__NUVIO_ENV__;
};
assert.equal(
  readEnv(buildRuntimeEnvScript({ NUVIO_LOCAL_TRACKS_ENDPOINT: "true" }))
    .NUVIO_LOCAL_TRACKS_ENDPOINT,
  undefined
);
assert.equal(
  readEnv(buildRuntimeEnvScript({}, { NUVIO_LOCAL_TRACKS_ENDPOINT: true }))
    .NUVIO_LOCAL_TRACKS_ENDPOINT,
  true
);

console.log("vidaa tracks endpoint: 3 checks passed");
