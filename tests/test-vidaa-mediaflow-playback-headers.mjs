import assert from "node:assert/strict";
import {
  createWebPlaybackHeaderDiagnosticSnapshot,
  getStandaloneWebPlaybackCompatibility
} from "../js/core/player/webPlaybackHeaders.js";

// Sanitized shape of the Streamvix Italian source tested on VIDAA. The
// destination, password and header values here are fixture data only.
const headers = { Referer: "https://fixture-origin.invalid/", "User-Agent": "Fixture TV/1.0" };
function proxyUrl() {
  const url = new URL("https://fixture-proxy.invalid/proxy/stream");
  url.searchParams.set("d", "https://fixture-cdn.invalid/Conan.S01E04.ITA.mp4");
  url.searchParams.set("api_password", "fixture-password");
  for (const [name, value] of Object.entries(headers)) url.searchParams.set(`h_${name}`, value);
  return url;
}
const options = (url = proxyUrl()) => ({ playbackUrl: String(url) });
assert.equal(
  getStandaloneWebPlaybackCompatibility(headers, true, options()).compatible,
  true,
  "A MediaFlow URL that already forwards every required header must reach the player"
);
assert.equal(getStandaloneWebPlaybackCompatibility(headers, true).compatible, false);
assert.equal(getStandaloneWebPlaybackCompatibility(headers, false).compatible, true);

const lowercase = proxyUrl();
lowercase.searchParams.delete("h_Referer");
lowercase.searchParams.set("h_rEfErEr", headers.Referer);
assert.equal(
  getStandaloneWebPlaybackCompatibility(headers, "true", options(lowercase)).compatible,
  true
);
for (const [label, mutate] of [
  ["missing required header", (url) => url.searchParams.delete("h_Referer")],
  ["mismatched value", (url) => url.searchParams.set("h_Referer", "https://other.invalid/")],
  ["duplicate header", (url) => url.searchParams.append("h_Referer", headers.Referer)],
  ["case-conflicting header", (url) => url.searchParams.append("h_referer", headers.Referer)],
  [
    "duplicate destination",
    (url) => url.searchParams.append("d", "https://other.invalid/video.mp4")
  ],
  [
    "case-conflicting destination",
    (url) => url.searchParams.append("D", "https://other.invalid/video.mp4")
  ],
  ["missing destination", (url) => url.searchParams.delete("d")],
  ["non-HTTP destination", (url) => url.searchParams.set("d", "file:///fixture.mp4")],
  ["relative destination", (url) => url.searchParams.set("d", "/fixture.mp4")],
  [
    "wrong endpoint",
    (url) => {
      url.pathname = "/proxy/hls/manifest.m3u8";
    }
  ],
  [
    "endpoint suffix",
    (url) => {
      url.pathname = "/proxy/stream/extra";
    }
  ],
  [
    "non-HTTP proxy",
    (url) => {
      url.protocol = "ftp:";
    }
  ],
  ["disabled proxy", (url) => url.searchParams.set("no_proxy", "true")],
  ["invalid embedded header", (url) => url.searchParams.set("h_Origin", "bad\r\nvalue")]
]) {
  const url = proxyUrl();
  mutate(url);
  assert.equal(
    getStandaloneWebPlaybackCompatibility(headers, true, options(url)).compatible,
    false,
    label
  );
}
assert.equal(
  getStandaloneWebPlaybackCompatibility({ ...headers, referer: headers.Referer }, true, options())
    .compatible,
  false,
  "Duplicate declarations are ambiguous even when the values match"
);
assert.equal(
  getStandaloneWebPlaybackCompatibility(
    { ...headers, referer: `${headers.Referer}\r\ninvalid` },
    true,
    options()
  ).compatible,
  false,
  "A malformed duplicate declaration cannot disappear during normalization"
);
assert.equal(
  getStandaloneWebPlaybackCompatibility({ ...headers, Cookie: "fixture-session" }, true, options())
    .compatible,
  false,
  "An unencoded additional restricted header still blocks playback"
);

const diagnostic = createWebPlaybackHeaderDiagnosticSnapshot(headers, {
  notWebReady: true,
  playbackEngine: "native",
  ...options()
});
assert.match(diagnostic.standaloneCompatibility, /compatible MediaFlow proxy stream/);
const diagnosticText = JSON.stringify(diagnostic);
for (const value of [
  headers.Referer,
  headers["User-Agent"],
  "fixture-password",
  "Conan.S01E04",
  "?",
  "h_Referer"
])
  assert.equal(
    diagnosticText.includes(value),
    false,
    "Header diagnostics expose only names and compatibility status"
  );

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.__NUVIO_PLATFORM__ = "vidaa";
globalThis.location = { search: "" };
globalThis.window = new EventTarget();
globalThis.document = { getElementById: () => null, documentElement: {} };
const { PlayerController } = await import("../js/ui/screens/player/playerScreenContext.js");
const { createPlayerScreenMethods17 } =
  await import("../js/ui/screens/player/playerScreenMethods-17-get-web-header-restricted-stream-message.js");
const candidate = {
  id: `Streamvix-1-${String(proxyUrl())}`,
  name: "Conan S01E04 ITA",
  addonName: "Streamvix",
  url: String(proxyUrl()),
  raw: { behaviorHints: { notWebReady: true, proxyHeaders: { request: headers } } }
};
PlayerController.video = { src: candidate.url, currentSrc: candidate.url };
PlayerController.playbackEngine = "native";
PlayerController.getAvPlayDiagnosticSnapshot = () => null;
PlayerController.getLastAvPlayErrorDiagnostic = () => null;
PlayerController.getLastHlsErrorDetail = () => "";
const screen = {
  ...createPlayerScreenMethods17(),
  activePlaybackUrl: "https://unrelated.invalid/video.mp4",
  getCurrentStreamCandidate: () => candidate,
  getStreamCandidateByUrl: () => candidate,
  getPlaybackEventErrorDetail: () => "",
  getPlaybackErrorCodeLabel: () => ""
};
assert.equal(
  screen.getWebHeaderRestrictedStreamMessage(candidate),
  "",
  "The real screen passes the candidate's actual proxy URL"
);
const directCandidate = { ...candidate, url: "https://fixture-cdn.invalid/video.mp4" };
assert.notEqual(
  screen.getWebHeaderRestrictedStreamMessage(directCandidate),
  "",
  "Direct URLs keep their existing incompatibility block"
);
const lines = screen
  .getPlaybackErrorDetailLines({ streamCandidate: candidate, playbackUrl: candidate.url })
  .join("\n");
assert.match(lines, /compatible MediaFlow proxy stream/);
assert.match(lines, /Source: Streamvix \/ Conan S01E04 ITA/);
assert.match(
  screen
    .getPlaybackErrorDetailLines({ streamCandidate: { ...candidate, id: "fixture-source-7" } })
    .join("\n"),
  /Source: Streamvix \/ Conan S01E04 ITA \/ fixture-source-7/,
  "Ordinary source IDs remain available for diagnosis"
);
for (const value of [
  "fixture-password",
  headers.Referer,
  headers["User-Agent"],
  "?d=",
  "api_password="
])
  assert.equal(
    lines.includes(value),
    false,
    "Playback URL diagnostics redact proxy credentials and header values"
  );
const credentialUrl = proxyUrl();
credentialUrl.username = "fixture-user";
credentialUrl.password = "fixture-url-password";
PlayerController.video.src = PlayerController.video.currentSrc = String(credentialUrl);
const credentialLines = screen
  .getPlaybackErrorDetailLines({ playbackUrl: String(credentialUrl) })
  .join("\n");
for (const value of ["fixture-user", "fixture-url-password", "fixture-password", "?d="])
  assert.equal(
    credentialLines.includes(value),
    false,
    "URL diagnostic labels omit user information and queries"
  );

console.log(
  "PASS: verified MediaFlow stream URLs preserve required headers without leaking query values"
);
