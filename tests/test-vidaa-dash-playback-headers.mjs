import assert from "node:assert/strict";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.document = { getElementById: () => null, documentElement: {} };
const { PlayerController } = await import("../js/core/player/playerController.js");
const { createWebPlaybackHeaderDiagnosticSnapshot } =
  await import("../js/core/player/webPlaybackHeaders.js");
const { routeAdaptiveProxyRequest } = await import("../js/core/player/adaptiveRequestHeaders.js");

function fixture(headers = {}) {
  const interceptors = [];
  let initialized = false;
  const player = {
    updateSettings() {},
    addRequestInterceptor(fn) {
      assert.equal(initialized, false, "headers configured before manifest request");
      interceptors.push(fn);
    },
    // Upstream 1.2.10 also reports DASH redirects through a response interceptor.
    addResponseInterceptor() {},
    initialize() {
      initialized = true;
    },
    on() {}
  };
  globalThis.dashjs = { MediaPlayer: () => ({ create: () => player }) };
  const owner = {
    ...PlayerController,
    video: {},
    currentPlaybackHeaders: headers,
    canUseDashJs: () => true,
    isPlaybackRequestActive: () => true,
    teardownDashInstance() {},
    teardownHlsInstance() {},
    emitVideoEvent() {}
  };
  return { owner, interceptors };
}

const token = "Bearer fixture-only";
const { owner, interceptors } = fixture({
  Authorization: token,
  "X-Playback": "fixture",
  Cookie: "blocked"
});
assert.equal(owner.playWithDashJs("https://media.invalid/manifest.mpd", 1), true);
assert.equal(interceptors.length, 1, "DASH requests must receive source headers");
for (const [type, url] of [
  ["MPD", "https://media.invalid/manifest.mpd"],
  ["InitializationSegment", "https://audio.invalid/audio/init.mp4"],
  ["MediaSegment", "https://audio.invalid/audio/segment-1.m4s"],
  ["MediaSegment", "https://video.invalid/video/segment-1.m4s"]
]) {
  const result = await interceptors[0]({ type, url, headers: { Range: "bytes=0-1023" } });
  assert.equal(result.url, url, "direct playback keeps the CDN URL");
  assert.equal(result.headers.authorization, token);
  assert.equal(result.headers["x-playback"], "fixture");
  assert.equal(result.headers.range, "bytes=0-1023", "keep dash.js request headers");
  assert.equal(result.headers.cookie, undefined, "browser-controlled headers stay excluded");
}
const direct = fixture();
assert.equal(direct.owner.playWithDashJs("https://media.invalid/manifest.mpd", 1), true);
assert.equal(direct.interceptors.length, 0, "ordinary sources need no interceptor");
const obsolete = fixture({ Authorization: token });
obsolete.owner.isPlaybackRequestActive = () => false;
assert.equal(obsolete.owner.playWithDashJs("https://media.invalid/manifest.mpd", 1), false);
assert.equal(obsolete.interceptors.length, 0);

const diagnostic = createWebPlaybackHeaderDiagnosticSnapshot(
  { Authorization: token, Cookie: "blocked" },
  { playbackEngine: "dash.js" }
);
assert.deepEqual(diagnostic.forwardedHeaderNames, ["Authorization"]);
assert.equal(JSON.stringify(diagnostic).includes(token), false);
// Preserve the upstream webOS proxy routing when a manifest uses another CDN.
const proxied = routeAdaptiveProxyRequest(
  "https://audio.invalid/track/init.mp4?x=1",
  "http://127.0.0.1:2710/proxy/d=https%3A%2F%2Fmedia.invalid&h_x=fixture/manifest.mpd"
);
const proxyUrl = new URL(proxied);
const options = new URLSearchParams(proxyUrl.pathname.slice(7).split("/")[0]);
assert.equal(proxyUrl.origin, "http://127.0.0.1:2710");
assert.equal(options.get("d"), "https://audio.invalid");
assert.equal(options.get("h_x"), "fixture");
assert.equal(proxyUrl.search, "?x=1");

console.log(
  "PASS: DASH manifest, audio/video initialization and segments inherit safe playback headers before initialization; ordinary and obsolete sources stay isolated (simulated DASH requests)."
);
