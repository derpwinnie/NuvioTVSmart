# VIDAA tile installer – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hostable Node tool that pairs with a Hisense VIDAA TV (PIN) and installs any URL as a permanent launcher tile, on Linux, macOS and Windows.

**Architecture:** Small, single-responsibility ESM modules under `tools/vidaa-tile/`. Pure protocol functions are unit-tested with synthetic constants; I/O modules (discovery, session, store, cert) are tested end-to-end against a fake TV that speaks the real wire protocol. A local dashboard and a CLI share the same core.

**Tech Stack:** Node.js (repo uses v22, ESM), one runtime dependency `mqtt` (MQTT.js ^5). Dev: `aedes` (^0.51, embeddable MQTT broker) for the fake TV. Everything else is the Node standard library. Tests follow the existing `tests/test-vidaa-*.mjs` style (`node:assert/strict`, run by `node`).

**Spec:** `docs/superpowers/specs/2026-10-07-vidaa-tile-installer-design.md`

## Global Constraints

- Node ESM only; module files end in `.mjs` to match `tests/` (package.json has `"type": "module"`, repo `.js` is browser code — keep tool code in `.mjs` to avoid eslint's browser-globals config).
- The repo ships **no** Hisense key material, keystore password, or protocol constants. These are read at runtime from a user-local secrets file. Tests use synthetic values only.
- The tool never recovers a keystore password and never reads the app's native libraries. `cert.js` only unzips two named files.
- All user-facing strings in English, loaded from `tools/vidaa-tile/i18n/en.json`.
- Secrets and state live under `~/.config/nuvio-vidaa/` (Linux), `~/Library/Application Support/nuvio-vidaa/` (macOS), `%APPDATA%\nuvio-vidaa\` (Windows). Directory mode 0700, files 0600, writes atomic (temp + rename).
- Dashboard binds `127.0.0.1` by default; `--lan` requires a random key checked in constant time via cookie, never in the URL.
- New runtime dep `mqtt` and dev dep `aedes` are added to `package.json`. Nothing is installed globally.

## Review Focus

- **TV clock skew / missing Date header:** descriptor fetch may return no `Date`; `tvTimestamp` must surface this, not silently use the local clock (a wrong timestamp breaks the password). Covered in Task 2.
- **Partial / duplicate SSDP replies:** the same TV answers on several interfaces and sends malformed packets; discovery must dedupe by host and ignore non-`HTTP/1.1 200` data. Covered in Task 6.
- **MQTT CONNACK rejection vs. network failure:** rc 4/5 means "pair again", a socket error means "TV unreachable"; these must not be conflated. Covered in Task 7.
- **Install with no app-list push:** the TV may accept an install without broadcasting a new list; confirmation must poll `applist` and match on both id and URL. Covered in Task 8.
- **Corrupt / partially-written secrets or state file:** a crash mid-write must not brick the tool; reads must reject malformed JSON with a clear message, and writes must be atomic. Covered in Task 4.

---

## File structure

```
tools/vidaa-tile/
  protocol.mjs        pure: credentials, topics, payloads, parsers
  secrets.mjs         load client pfx+passphrase, constants, optional CA PEM
  store.mjs           per-TV state + secrets dir, atomic 0600 writes
  cert.mjs            unzip the two keystore files from a user APK
  discovery.mjs       SSDP search, descriptor fetch, TV clock
  session.mjs         one TLS MQTT connection: pair/refresh/install/list/launch/remove
  urls.mjs            tile URL validation
  cli.mjs             command-line entry
  web/
    server.mjs        local dashboard HTTP server
    public/           static dashboard page + script
  i18n/en.json        strings
tests/
  test-vidaa-tile-protocol.mjs
  test-vidaa-tile-urls.mjs
  test-vidaa-tile-store.mjs
  test-vidaa-tile-cert.mjs
  test-vidaa-tile-discovery.mjs
  test-vidaa-tile-session.mjs
  fake-vidaa-tv/
    index.mjs         SSDP responder + descriptor server + aedes TV broker
    make-test-certs.mjs  generate a throwaway CA + server + client cert at test time
docs/vidaa-tile.md    user docs (setup, self-hosting, real-TV checklist)
.github/workflows/pages.yml   build + publish the VIDAA bundle (disabled until opt-in)
Dockerfile.vidaa      static server image for self-hosting
```

The existing DNS installer moves to `installer/legacy/` (Task 14).

---

## Task 1: protocol.mjs — credentials and payloads

**Files:**

- Create: `tools/vidaa-tile/protocol.mjs`
- Test: `tests/test-vidaa-tile-protocol.mjs`

**Interfaces:**

- Produces:
  - `sessionCredentials({ deviceId, tvTimestamp, token, constants }) -> { clientId, username, password }`
  - `tvTopics(clientId) -> { ui, platform, mobile, broadcast, applistReply, tokenReply, authReply, authCodeReply }`
  - `newDeviceId() -> string` (MAC-shaped, lower-case, colon-separated)
  - `connectPayload()`, `pinPayload(pin)`, `tokenRequestPayload(refreshToken)`, `installPayload({appId,name,url,image})`, `launchPayload({appId,name,url})` → JSON strings
  - `parseToken(str) -> object|null`, `parseAppList(str) -> array|null`
  - `CONSTANT_KEYS = ["PATTERN","VALUE_SUFFIX","XOR_MASK","BRAND","OPERATION"]`
- Consumes: `constants` object with those keys, supplied by `secrets.mjs` (Task 3). `XOR_MASK` is a BigInt or decimal string; `tvTimestamp` is an integer (seconds).

- [ ] **Step 1: Write the failing test** (`tests/test-vidaa-tile-protocol.mjs`)

```js
import assert from "node:assert/strict";
import * as protocol from "../tools/vidaa-tile/protocol.mjs";

// Synthetic constants — NOT Hisense values. Used only to pin the math.
const constants = {
  PATTERN: "test-pattern",
  VALUE_SUFFIX: "test-suffix",
  XOR_MASK: 0x5a5a5a5a5an,
  BRAND: "his",
  OPERATION: "vidaacommon_001"
};
const deviceId = "aa:bb:cc:dd:ee:ff";
const tvTimestamp = 1759800000;

// Pairing credentials (no token): derived from the TV clock.
const pair = protocol.sessionCredentials({ deviceId, tvTimestamp, constants });
assert.equal(pair.clientId, "aa:bb:cc:dd:ee:ff$his$E37BF1_vidaacommon_001");
assert.equal(pair.username, "his$387398381722");
assert.equal(pair.password, "B9A25664C5EECB2E3226B73666AF9B5A");

// With a token: same identity, token is the password.
const tok = protocol.sessionCredentials({ deviceId, tvTimestamp, token: "ACCESS", constants });
assert.equal(tok.clientId, pair.clientId);
assert.equal(tok.username, pair.username);
assert.equal(tok.password, "ACCESS");

// Topics hang off the client id.
const t = protocol.tvTopics(pair.clientId);
assert.equal(t.ui, `/remoteapp/tv/ui_service/${pair.clientId}/`);
assert.equal(
  t.tokenReply,
  `/remoteapp/mobile/${pair.clientId}/platform_service/data/tokenissuance`
);
assert.equal(t.applistReply, `/remoteapp/mobile/${pair.clientId}/ui_service/data/applist`);

// newDeviceId shape.
assert.match(protocol.newDeviceId(), /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);

// Payloads.
assert.deepEqual(JSON.parse(protocol.connectPayload()), {
  app_version: 2,
  connect_result: 0,
  device_type: "Mobile App"
});
assert.deepEqual(JSON.parse(protocol.pinPayload("1234")), { authNum: 1234 });
const inst = JSON.parse(
  protocol.installPayload({ appId: "nuvio", name: "Nuvio", url: "https://x/", image: "" })
);
assert.equal(inst.type, "app_install");
assert.equal(inst.app_info.StoreType, 99);
assert.equal(inst.app_info.URL, "https://x/");
assert.equal(inst.app_info.Id, "nuvio");

// Parsers.
assert.equal(protocol.parseToken('{"nope":1}'), null);
assert.deepEqual(protocol.parseToken('{"accesstoken":"a"}'), { accesstoken: "a" });
assert.equal(protocol.parseAppList("not json"), null);
assert.deepEqual(protocol.parseAppList("[]"), []);

console.log("protocol tests passed");
```

- [ ] **Step 2: Run it, expect failure**

Run: `node tests/test-vidaa-tile-protocol.mjs`
Expected: FAIL — cannot find module `protocol.mjs`.

- [ ] **Step 3: Implement `tools/vidaa-tile/protocol.mjs`**

```js
import { createHash, randomBytes } from "node:crypto";

export const CONSTANT_KEYS = ["PATTERN", "VALUE_SUFFIX", "XOR_MASK", "BRAND", "OPERATION"];

const md5Upper = (s) => createHash("md5").update(s, "utf8").digest("hex").toUpperCase();

export function newDeviceId() {
  const b = randomBytes(6);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(":");
}

export function sessionCredentials({ deviceId, tvTimestamp, token = null, constants }) {
  const { PATTERN, VALUE_SUFFIX, XOR_MASK, BRAND, OPERATION } = constants;
  const clean = String(deviceId).replace(/-/g, ":").toLowerCase();
  const race = md5Upper(`${PATTERN}$${clean}`).slice(0, 6);
  const clientId = `${clean}$${BRAND}$${race}_${OPERATION}`;
  const mask = typeof XOR_MASK === "bigint" ? XOR_MASK : BigInt(XOR_MASK);
  const username = `${BRAND}$${BigInt(tvTimestamp) ^ mask}`;
  if (token !== null) return { clientId, username, password: token };
  const digit =
    String(tvTimestamp)
      .split("")
      .reduce((a, d) => a + Number(d), 0) % 10;
  const valueMd5 = md5Upper(`${BRAND}${digit}${VALUE_SUFFIX}`).slice(0, 6);
  return { clientId, username, password: md5Upper(`${tvTimestamp}$${valueMd5}`) };
}

export function tvTopics(clientId) {
  const mob = `/remoteapp/mobile/${clientId}/`;
  return {
    ui: `/remoteapp/tv/ui_service/${clientId}/`,
    platform: `/remoteapp/tv/platform_service/${clientId}/`,
    mobile: mob,
    broadcast: "/remoteapp/mobile/broadcast/",
    applistReply: mob + "ui_service/data/applist",
    tokenReply: mob + "platform_service/data/tokenissuance",
    authReply: mob + "ui_service/data/authentication",
    authCodeReply: mob + "ui_service/data/authenticationcode"
  };
}

export const connectPayload = () =>
  JSON.stringify({ app_version: 2, connect_result: 0, device_type: "Mobile App" });
export const pinPayload = (pin) => JSON.stringify({ authNum: Number(pin) });
export const tokenRequestPayload = (refreshToken) =>
  JSON.stringify({ refreshtoken: refreshToken || "" });
export const installPayload = ({ appId, name, url, image = "" }) =>
  JSON.stringify({
    type: "app_install",
    app_info: {
      Title: name,
      StoreType: 99,
      mediaId: appId,
      Id: appId,
      Image: image,
      URL: url,
      configUrlDownload: 0,
      configUrl: ""
    }
  });
export const launchPayload = ({ appId, name, url }) =>
  JSON.stringify({ appId, name, url, urlType: 37, appName: name, appUrl: url });

const parseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
export const parseToken = (s) => {
  const d = parseJson(s);
  return d && typeof d === "object" && "accesstoken" in d ? d : null;
};
export const parseAppList = (s) => {
  const d = parseJson(s);
  return Array.isArray(d) ? d : null;
};
```

- [ ] **Step 4: Run it, expect pass**

Run: `node tests/test-vidaa-tile-protocol.mjs`
Expected: PASS, prints "protocol tests passed".

- [ ] **Step 5: Commit**

```bash
git add tools/vidaa-tile/protocol.mjs tests/test-vidaa-tile-protocol.mjs
git commit -m "feat(vidaa-tile): protocol credential and payload functions"
```

---

## Task 2: discovery.mjs — timestamp helper first

**Files:**

- Create: `tools/vidaa-tile/discovery.mjs`
- Test: `tests/test-vidaa-tile-discovery.mjs` (extended in Task 6)

**Interfaces:**

- Produces:
  - `parseDescriptor(xml) -> { friendlyName, model, isVidaa }`
  - `readDateHeader(headers) -> number` (unix seconds) — **throws** `Error("TV did not report its clock")` when absent/unparseable
  - (Task 6 adds `discover()` and `fetchDescriptor()`)

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { parseDescriptor, readDateHeader } from "../tools/vidaa-tile/discovery.mjs";

const xml = `<root><device><friendlyName>Living Room</friendlyName>
<modelDescription>vidaa_support;transport_protocol</modelDescription></device></root>`;
const d = parseDescriptor(xml);
assert.equal(d.friendlyName, "Living Room");
assert.equal(d.isVidaa, true);
assert.equal(
  parseDescriptor("<root><modelDescription>roku</modelDescription></root>").isVidaa,
  false
);
assert.equal(parseDescriptor("<x>hisense inside</x>").isVidaa, true);

assert.equal(readDateHeader({ date: "Tue, 07 Oct 2025 00:00:00 GMT" }), 1759795200);
assert.throws(() => readDateHeader({}), /did not report its clock/);
console.log("discovery helper tests passed");
```

- [ ] **Step 2: Run, expect FAIL** (`node tests/test-vidaa-tile-discovery.mjs`).

- [ ] **Step 3: Implement the two helpers** in `discovery.mjs`:

```js
export function parseDescriptor(xml) {
  const name = /<friendlyName>([^<]+)<\/friendlyName>/.exec(xml);
  const model = /<modelDescription>([\s\S]*?)<\/modelDescription>/.exec(xml);
  const desc = model ? model[1] : "";
  const isVidaa = /vidaa_support|transport_protocol/.test(desc) || /hisense/i.test(xml);
  return { friendlyName: name ? name[1] : "", model: desc.trim().slice(0, 120), isVidaa };
}

export function readDateHeader(headers) {
  const raw = headers?.date || headers?.Date;
  const t = raw ? Date.parse(raw) : NaN;
  if (Number.isNaN(t)) throw new Error("TV did not report its clock");
  return Math.floor(t / 1000);
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add tools/vidaa-tile/discovery.mjs tests/test-vidaa-tile-discovery.mjs
git commit -m "feat(vidaa-tile): descriptor parsing and TV-clock header"
```

---

## Task 3: urls.mjs — tile URL validation

**Files:**

- Create: `tools/vidaa-tile/urls.mjs`
- Test: `tests/test-vidaa-tile-urls.mjs`

**Interfaces:**

- Produces: `validateTileUrl(input) -> { ok: true, url } | { ok: false, reason }`; `withVidaaWrapper(url) -> url` (adds `wrapper=vidaa` if absent).

- [ ] **Step 1: Failing test**

```js
import assert from "node:assert/strict";
import { validateTileUrl, withVidaaWrapper } from "../tools/vidaa-tile/urls.mjs";

assert.equal(validateTileUrl("https://nuvio.example/").ok, true);
assert.equal(validateTileUrl("http://192.168.1.5:4173/").ok, true); // private LAN http
assert.equal(validateTileUrl("http://100.64.1.2:4173/").ok, true); // Tailscale CGNAT
assert.equal(validateTileUrl("http://example.com/").ok, false); // public http
assert.equal(validateTileUrl("http://localhost/").ok, false); // loopback
assert.equal(validateTileUrl("https://user:pw@x/").ok, false); // credentials
assert.equal(validateTileUrl("ftp://x/").ok, false); // scheme
assert.equal(withVidaaWrapper("https://x/"), "https://x/?wrapper=vidaa");
assert.equal(withVidaaWrapper("https://x/?wrapper=vidaa"), "https://x/?wrapper=vidaa");
console.log("url tests passed");
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `urls.mjs`:

```js
const PRIVATE = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
];
const isLoopback = (h) => h === "localhost" || /^127\./.test(h) || h === "::1";
const isPrivate = (h) => PRIVATE.some((re) => re.test(h));

export function validateTileUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return { ok: false, reason: "not a URL" };
  }
  if (u.username || u.password) return { ok: false, reason: "URL must not contain credentials" };
  if (u.protocol === "https:") return { ok: true, url: u.href };
  if (u.protocol === "http:") {
    if (isLoopback(u.hostname))
      return { ok: false, reason: "loopback is not reachable from the TV" };
    if (isPrivate(u.hostname)) return { ok: true, url: u.href };
    return { ok: false, reason: "plain http is only allowed on your private network" };
  }
  return { ok: false, reason: "only http and https are allowed" };
}

export function withVidaaWrapper(url) {
  const u = new URL(url);
  if (!u.searchParams.has("wrapper")) u.searchParams.set("wrapper", "vidaa");
  return u.href;
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(vidaa-tile): tile URL validation`.

---

## Task 4: store.mjs — state and secrets on disk

**Files:**

- Create: `tools/vidaa-tile/store.mjs`
- Test: `tests/test-vidaa-tile-store.mjs`

**Interfaces:**

- Produces:
  - `configDir() -> string` (platform path; honours `NUVIO_VIDAA_HOME` override for tests)
  - `readState() -> { tvs: {host: {deviceId, clientId, tokens, expiresAt, pairFailures}}, settings }` (defaults when missing; **throws** on malformed JSON)
  - `writeState(state) -> void` (atomic, file mode 0600, dir 0700)
  - `secretsPath()`, `fileInDir(name)` helpers

- [ ] **Step 1: Failing test** (uses `NUVIO_VIDAA_HOME` in a temp dir)

```js
import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "vidaa-store-"));
process.env.NUVIO_VIDAA_HOME = home;
const store = await import("../tools/vidaa-tile/store.mjs");

assert.deepEqual(store.readState().tvs, {}); // default when absent
store.writeState({ tvs: { "1.2.3.4": { deviceId: "x" } }, settings: {} });
assert.equal(store.readState().tvs["1.2.3.4"].deviceId, "x");

if (process.platform !== "win32") {
  const mode = statSync(store.fileInDir("state.json")).mode & 0o777;
  assert.equal(mode, 0o600, `state file mode ${mode.toString(8)}`);
}

writeFileSync(store.fileInDir("state.json"), "{ broken");
assert.throws(() => store.readState(), /could not read/i);
console.log("store tests passed");
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `store.mjs`:

```js
import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function configDir() {
  if (process.env.NUVIO_VIDAA_HOME) return process.env.NUVIO_VIDAA_HOME;
  if (platform() === "win32") return join(process.env.APPDATA || homedir(), "nuvio-vidaa");
  if (platform() === "darwin")
    return join(homedir(), "Library", "Application Support", "nuvio-vidaa");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nuvio-vidaa");
}
const ensureDir = () => {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  return configDir();
};
export const fileInDir = (name) => join(configDir(), name);
export const secretsPath = () => fileInDir("secrets.json");

export function readState() {
  let raw;
  try {
    raw = readFileSync(fileInDir("state.json"), "utf8");
  } catch {
    return { tvs: {}, settings: {} };
  }
  try {
    const s = JSON.parse(raw);
    return { tvs: s.tvs || {}, settings: s.settings || {} };
  } catch {
    throw new Error("could not read state.json (corrupt); delete it to reset");
  }
}

export function writeState(state) {
  ensureDir();
  const tmp = fileInDir(`state.json.tmp-${process.pid}`);
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, fileInDir("state.json"));
  try {
    chmodSync(fileInDir("state.json"), 0o600);
  } catch {
    /* best effort on win */
  }
}
```

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(vidaa-tile): on-disk state and secrets store`.

---

## Task 5: cert.mjs — unzip keystores from a user APK; secrets.mjs — load secrets

**Files:**

- Create: `tools/vidaa-tile/cert.mjs`, `tools/vidaa-tile/secrets.mjs`
- Test: `tests/test-vidaa-tile-cert.mjs`

**Interfaces:**

- `cert.mjs`: `extractKeystores(apkPath) -> { p12Path, bksPath }` — unzips `res/raw/client_mobile_android.p12` and `res/raw/remoteca.bks` into the config dir via `store`. Throws if either entry is missing.
- `secrets.mjs`: `loadSecrets() -> { pfx: Buffer, passphrase, constants, caPem? }` — reads `secrets.json` (passphrase + constants, with `XOR_MASK` as BigInt) and the unzipped `.p12`; throws a clear message naming what is missing. `requireComplete()` lists missing pieces for the dashboard.

Note: APKs are zip files; use `node:zlib` inflate on the ZIP entries (Task writes a tiny local unzip for the two stored-or-deflated entries) — no third-party unzip dependency. A fixture APK (a plain zip containing two dummy files at those paths) is generated in the test.

- [ ] **Step 1: Failing test** — builds a fixture "apk" (zip) with the two entries using the system `zip`-free approach: write via `node`'s `zlib` is complex, so the test creates the fixture with a minimal stored-entry zip writer included in the test, OR shells out to `zip` if available. Concrete test:

```js
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const home = mkdtempSync(join(tmpdir(), "vidaa-cert-"));
process.env.NUVIO_VIDAA_HOME = home;
const work = mkdtempSync(join(tmpdir(), "vidaa-apk-"));

// Build a fixture APK (a zip) with the two expected entries.
const raw = join(work, "res", "raw");
execFileSync("mkdir", ["-p", raw]);
writeFileSync(join(raw, "client_mobile_android.p12"), "DUMMY-P12");
writeFileSync(join(raw, "remoteca.bks"), "DUMMY-BKS");
const apk = join(work, "fixture.apk");
execFileSync("zip", ["-qr", apk, "res"], { cwd: work });

const { extractKeystores } = await import("../tools/vidaa-tile/cert.mjs");
const out = extractKeystores(apk);
assert.ok(existsSync(out.p12Path));
assert.equal(readFileSync(out.p12Path, "utf8"), "DUMMY-P12");
assert.ok(existsSync(out.bksPath));

// Missing entry -> clear error.
const bad = join(work, "bad.apk");
execFileSync("bash", ["-c", `cd ${work} && zip -q ${bad} res/raw/remoteca.bks`]);
assert.throws(() => extractKeystores(bad), /client_mobile_android\.p12/);
console.log("cert tests passed");
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `cert.mjs` using Node's built-in zip reading. Node has no zip reader in stdlib, so implement a minimal reader over the central directory supporting stored (0) and deflated (8) entries via `zlib.inflateRawSync`. Target only the two known paths. Save both into `configDir()` with mode 0600. Also implement `secrets.mjs` `loadSecrets()`/`requireComplete()` reading `secrets.json`:

```js
// secrets.json shape (user-filled, never committed):
// { "keystorePassphrase": "...", "constants": { "PATTERN":"...", "VALUE_SUFFIX":"...",
//   "XOR_MASK":"<decimal>", "BRAND":"his", "OPERATION":"vidaacommon_001" }, "caPem": "optional" }
```

`loadSecrets` converts `XOR_MASK` string → BigInt, reads the `.p12` buffer from the config dir, and throws `Error("missing: <list>")` naming any absent piece. `requireComplete()` returns `{ needApk, needPassphrase, needConstants }` booleans for the dashboard.

- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(vidaa-tile): extract keystores from APK and load local secrets`.

---

## Task 6: discovery.mjs — SSDP search and descriptor fetch

**Files:**

- Modify: `tools/vidaa-tile/discovery.mjs`
- Test: extend `tests/test-vidaa-tile-discovery.mjs` (covered fully in Task 9 against the fake TV; here add a unit test for dedupe/filtering of SSDP payloads via an injected socket).

**Interfaces:**

- Produces:
  - `async discover({ timeoutMs = 4000, port = 0 } = {}) -> [{ host, friendlyName, model, isVidaa }]`
  - `async fetchDescriptor(host, location?) -> { host, friendlyName, model, isVidaa, headers }`
  - `async tvTimestamp(host) -> number` (uses `fetchDescriptor` + `readDateHeader`, throws if no clock)
- Consumes: `parseDescriptor`, `readDateHeader` (Task 2).

Implementation notes carried from the spec: `M-SEARCH` with `ST: urn:schemas-upnp-org:device:MediaRenderer:1`, `MX: 2`, sent to each interface directed broadcast + `255.255.255.255` + `239.255.255.250:1900`, re-sent every 500 ms until `timeoutMs`. Bind a fixed UDP `port` when given so a firewall rule can allow replies. Ignore datagrams not starting with `HTTP/1.1 200`. Dedupe by source host. Fetch descriptor from the `Location` header, else `http://<host>:{18400,38400,80}/MediaServer/rendererdevicedesc.xml`. Reject descriptor URLs with credentials or non-http scheme. Interfaces come from `os.networkInterfaces()`; compute each IPv4 directed broadcast from address+netmask.

- [ ] **Step 1: Failing test** — a `_classifyReply(text)` pure helper that returns a host/location or null, tested for: valid 200 with Location, non-200 ignored, missing Location ignored.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `discover`, `fetchDescriptor`, `tvTimestamp`, and the exported `_classifyReply` + `_directedBroadcasts()` helpers.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(vidaa-tile): SSDP discovery and descriptor fetch`.

---

## Task 7: fake-vidaa-tv + session.mjs pairing

**Files:**

- Create: `tests/fake-vidaa-tv/make-test-certs.mjs`, `tests/fake-vidaa-tv/index.mjs`
- Create: `tools/vidaa-tile/session.mjs`
- Test: `tests/test-vidaa-tile-session.mjs`

**Interfaces:**

- Fake TV: `startFakeTv({ constants, pin, behavior }) -> { host, port, descriptorPort, stop(), setBehavior(b), ca, serverCert }` using `aedes` over TLS (server cert signed by a throwaway CA), an HTTP descriptor server that sets a `Date` header, and an SSDP responder. It authenticates MQTT connects exactly like `protocol.sessionCredentials` (recomputes expected username/password from the presented client id + its own clock) and drives the pairing handshake: on `vidaa_app_connect` publish to `authReply`; on correct `authenticationcode` reply `{result:1}` to `authCodeReply`; on `gettoken` publish a token JSON to `tokenReply`. `behavior` switches: `wrongPin`, `expiredRefresh` (CONNACK 5), `noTokenAfterPin`, `offline`.
- `session.mjs`:
  - `async pair({ host, pinProvider, store, secrets }) -> record`
  - `async refresh(record, { store, secrets }) -> record`
  - `async withSession(record, op, { store, secrets }) -> result` (proactive refresh, one retry on rc 4/5 → refresh, errors classified)
  - error classes: `AuthError` (`reason: "rejected"|"none"`), `UnreachableError`, `PinError`, `TimeoutError`
  - TV verification: pass `ca: secrets.caPem` to the TLS options when present; otherwise pin-on-first-use — store the server cert fingerprint on first pair and compare on later connects (`rejectUnauthorized:false` + manual fingerprint check). (In tests, pass the fake TV's `ca`.)

- [ ] **Step 1: Write `make-test-certs.mjs`** — generates a CA, a server cert (CN matches host `127.0.0.1` via SAN) and a client cert/key as PEM, using `node-forge`? No — avoid a dep: shell out to `openssl` at test setup (openssl is present on dev machines; the fake TV is test-only). Save PEMs to a temp dir and return paths. (Guard: skip the session test with a clear message if `openssl` is absent.)

- [ ] **Step 2: Write the failing test** `tests/test-vidaa-tile-session.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NUVIO_VIDAA_HOME = mkdtempSync(join(tmpdir(), "vidaa-sess-"));
const constants = {
  PATTERN: "p",
  VALUE_SUFFIX: "s",
  XOR_MASK: 123n,
  BRAND: "his",
  OPERATION: "op_001"
};
const { startFakeTv } = await import("../tests/fake-vidaa-tv/index.mjs");
const session = await import("../tools/vidaa-tile/session.mjs");
const store = await import("../tools/vidaa-tile/store.mjs");

const tv = await startFakeTv({ constants, pin: "4321", behavior: "ok" });
const secrets = { pfx: tv.clientPfx, passphrase: tv.clientPass, constants, caPem: tv.ca };

const rec = await session.pair({
  host: tv.host,
  port: tv.port,
  descriptorPort: tv.descriptorPort,
  pinProvider: async () => "4321",
  store,
  secrets
});
assert.ok(rec.tokens.accesstoken);

tv.setBehavior("wrongPin");
await assert.rejects(
  session.pair({
    host: tv.host,
    port: tv.port,
    descriptorPort: tv.descriptorPort,
    pinProvider: async () => "0000",
    store,
    secrets
  }),
  (e) => e.name === "PinError"
);

await tv.stop();
console.log("session pairing tests passed");
```

- [ ] **Step 3: Implement `fake-vidaa-tv/index.mjs` and `session.mjs`** until the test passes. Keep the fake TV's auth check identical to `protocol` so a credential bug fails the test.
- [ ] **Step 4: Run, expect PASS** (`node tests/test-vidaa-tile-session.mjs`).
- [ ] **Step 5: Commit** `feat(vidaa-tile): fake TV and pairing session`.

---

## Task 8: session.mjs — install / list / launch / remove + confirmation

**Files:**

- Modify: `tools/vidaa-tile/session.mjs`, `tests/fake-vidaa-tv/index.mjs`
- Test: extend `tests/test-vidaa-tile-session.mjs`

**Interfaces:**

- Produces: `addTile(record, {appId,name,url,image})`, `listTiles(record)`, `launchTile(record, tile)`, `removeTile(record, appId)`, and `tileMatches(tile, appId, url)` (matches on `appId` and all of `url`/`appUrl`/`URL`).
- Fake TV keeps an app list; on `uievent` app_install it adds the tile; on `applist` request it returns the list; supports a `behavior: "installNoConfirm"` where install does not add, so the confirm poll fails and surfaces a timeout.

- [ ] **Step 1: Failing test** — pair (ok), `addTile` returns a list containing the tile (match on id+url); set `installNoConfirm`, assert `addTile` throws `TimeoutError`; `listTiles` returns the earlier tile; `removeTile` attempts removal and `listTiles` no longer contains it (fake TV supports remove).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** the four operations via `withSession`, confirming install by polling `applist` (2 attempts, 8 s each, ignoring lists sent before the request) and matching with `tileMatches`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(vidaa-tile): tile install/list/launch/remove with confirmation`.

---

## Task 9: discovery against the fake TV + error-row coverage

**Files:**

- Modify: `tests/test-vidaa-tile-discovery.mjs`, `tests/test-vidaa-tile-session.mjs`
- Test: same

Covers the Review Focus rows end to end: SSDP dedupe/partial (discovery sees the fake TV once), missing Date header (`tvTimestamp` throws), CONNACK 5 → `AuthError("rejected")` (behavior `expiredRefresh`), unreachable host → `UnreachableError` (behavior `offline`), install-no-confirm → `TimeoutError` (Task 8), corrupt state → throws (Task 4).

- [ ] **Step 1** Add a discovery test: start the fake TV's SSDP+descriptor, call `discover({timeoutMs:1500})`, assert exactly one VIDAA entry for the fake host.
- [ ] **Step 2** Add session tests for `expiredRefresh` and `offline` behaviors asserting the error classes.
- [ ] **Step 3** Run both suites, expect PASS.
- [ ] **Step 4: Commit** `test(vidaa-tile): end-to-end discovery and error-path coverage`.

---

## Task 10: CLI

**Files:**

- Create: `tools/vidaa-tile/cli.mjs`
- Modify: `package.json` (add `"vidaa:tile"` script, `mqtt` dep, `aedes` devDep)
- Test: `tests/test-vidaa-tile-session.mjs` already exercises the core; add a thin `tests/test-vidaa-tile-cli.mjs` that spawns `node cli.mjs discover --help`-style and asserts usage text (no network).

**Interfaces:** commands `discover`, `import-apk <path>`, `pair <host>`, `list`, `install <url> [--name] [--image]`, `launch <appId>`, `remove <appId>`, `set-secret` (writes `secrets.json` fields). `--json` for machine output. PIN read from stdin for `pair`.

- [ ] **Step 1** Failing test: `node tools/vidaa-tile/cli.mjs` with no args prints usage and exits non-zero.
- [ ] **Step 2** Run, expect FAIL.
- [ ] **Step 3** Implement `cli.mjs` dispatching to the modules; add package.json script `"vidaa:tile": "node tools/vidaa-tile/cli.mjs"`.
- [ ] **Step 4** Run, expect PASS; also `npm run vidaa:tile -- --help` prints commands.
- [ ] **Step 5: Commit** `feat(vidaa-tile): command-line interface`.

---

## Task 11: Dashboard (web)

**Files:**

- Create: `tools/vidaa-tile/web/server.mjs`, `tools/vidaa-tile/web/public/index.html`, `tools/vidaa-tile/web/public/app.js`, `tools/vidaa-tile/i18n/en.json`
- Modify: `cli.mjs` (default to dashboard when no command), `package.json`
- Test: `tests/test-vidaa-tile-web.mjs` (start server on `127.0.0.1:0`, hit JSON endpoints with the fake TV; Playwright pass is manual, Task 13)

**Interfaces:** HTTP server binds `127.0.0.1` (or LAN with `--lan` + key). JSON API: `GET /api/status` (what secrets are missing, paired TVs), `POST /api/import-apk`, `POST /api/secret`, `POST /api/discover`, `POST /api/pair` (host, pin), `GET /api/tiles`, `POST /api/tiles` (install), `POST /api/launch`, `DELETE /api/tiles/:appId`. Errors return `{error}` with the i18n message, never a stack. Static files served from `web/public`.

- [ ] **Step 1** Failing test: start server, `GET /api/status` returns JSON listing missing secrets on a fresh home.
- [ ] **Step 2** Run, expect FAIL.
- [ ] **Step 3** Implement server + minimal page (vanilla JS, no framework): wizard steps mirroring Task-flow (APK → passphrase/constants → find TV → PIN → install). Bind host guarded; `--lan` adds a login form setting a cookie compared with `crypto.timingSafeEqual`.
- [ ] **Step 4** Run, expect PASS.
- [ ] **Step 5: Commit** `feat(vidaa-tile): local dashboard`.

---

## Task 12: Self-hosting (GitHub Pages, Docker)

**Files:**

- Create: `.github/workflows/pages.yml` (build the VIDAA bundle, upload Pages artifact; `on: workflow_dispatch` only — not auto, enabled after maintainer opts in), `Dockerfile.vidaa`
- Modify: `docs/vidaa-tile.md` (Task 13)

- [ ] **Step 1** Add `Dockerfile.vidaa`: build (`npm ci && npm run build`) then serve `dist/` with a tiny static server (`node ./scripts/serve.mjs --vidaa` or a 15-line static server). Test locally: `docker build -f Dockerfile.vidaa -t nuvio-vidaa . && docker run --rm -p 8080:8080 nuvio-vidaa` (or `podman`), curl `/?wrapper=vidaa` returns the page. Record the command output in the commit.
- [ ] **Step 2** Add `pages.yml` with `workflow_dispatch`, building the bundle and publishing. Validate YAML locally (`node -e "require('js-yaml')"` not available → use `python3 -c 'import yaml,sys;yaml.safe_load(open("..."))'`).
- [ ] **Step 3: Commit** `feat(vidaa-tile): Docker and GitHub Pages self-hosting`.

---

## Task 13: Docs + Playwright pass + full test wiring

**Files:**

- Create: `docs/vidaa-tile.md`
- Modify: `README.md` (replace the DNS installer section with a "Home screen tile" section linking the new tool and Sidee credit), `package.json` (fold the new tests into `test:vidaa:unit`)
- Test: Playwright run of the dashboard against the fake TV via Thorium, screenshots saved.

- [ ] **Step 1** Add every `tests/test-vidaa-tile-*.mjs` to `test:vidaa:unit`.
- [ ] **Step 2** Run `npm run test:vidaa` — all green.
- [ ] **Step 3** Playwright: start the dashboard + fake TV, click through the wizard, screenshot each step (evidence for the maintainer).
- [ ] **Step 4** Write `docs/vidaa-tile.md`: what the tool does, the one-time secrets setup (APK path, where to obtain the passphrase and constants — pointing at public sources, with the explicit note that this repo ships none of it), self-hosting options, and a 10-minute real-TV checklist plus `--diagnose` (redacted log) instructions. Credit `Empi9245/Sidee` as the protocol reference.
- [ ] **Step 5: Commit** `docs(vidaa-tile): user guide, README section, wire up tests`.

---

## Task 14: Retire the DNS installer

**Files:**

- Move: `installer/{server.py,start-mac-linux.sh,start-windows.bat,index.html}` → `installer/legacy/`
- Modify: `installer/README.md` → deprecation note pointing at the new tool; keep legacy steps under `installer/legacy/`.

- [ ] **Step 1** `git mv` the files; add `installer/legacy/README.md` noting it is unsupported and often blocked on modern firmware.
- [ ] **Step 2** Update `installer/README.md` to point at `docs/vidaa-tile.md`.
- [ ] **Step 3** `npm run format:check` and `npm run test:vidaa` still green.
- [ ] **Step 4: Commit** `chore(vidaa): deprecate the DNS installer in favour of the tile tool`.

---

## Self-review notes

- **Spec coverage:** architecture modules → Tasks 1–11; self-hosting → 12; docs/real-TV → 13; legacy retirement → 14; CA-vs-pin decision recorded in Task 7. The spec line "verified against remoteca.bks" is refined in Task 7: v1 pins on first use and accepts a user CA PEM, because Node cannot read a BouncyCastle keystore without the keystore password (out of scope). This is the one deliberate deviation; note it in `docs/vidaa-tile.md`.
- **Review Focus:** all five rows have owning tasks (2, 6, 7, 8, 4) with explicit tests, re-exercised in Task 9.
- **Type consistency:** `sessionCredentials` takes/returns the same shape across tasks; `record` = `{host, deviceId, clientId, username, tokens, expiresAt, pairFailures, serverFingerprint?}` used by session + store + cli + web.
- **No secrets in repo:** constants and passphrase are user config (`secrets.json`), tests use synthetic values; `cert.mjs` only unzips. Confirmed against Global Constraints.
