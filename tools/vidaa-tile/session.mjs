// One TLS MQTT connection to one TV, and the operations built on it:
// pair, refresh, install, list, launch, remove.
//
// Connection outcomes are classified so the UI can tell "pair again" (the TV
// rejected our credentials) apart from "TV unreachable" (a network failure).

// mqtt is loaded on first connect, so setup, help and the dashboard start
// without it (and start faster).
let mqttLib = null;
const loadMqtt = async () => (mqttLib ??= (await import("mqtt")).default);
import net from "node:net";
import tls from "node:tls";
import * as protocol from "./protocol.mjs";
import { tvTimestamp as realTvTimestamp, fetchDescriptor } from "./discovery.mjs";
import { readState, writeState } from "./store.mjs";

const DEFAULT_PORT = 36669;
const CONNECT_TIMEOUT_MS = 10000;
const REFRESH_MARGIN_MS = 12 * 3600 * 1000;
// After this many consecutive failed pairings with the stored device UUID, the
// next pairing uses a fresh UUID (the TV may hold a broken state for the old
// one). Reusing the UUID otherwise avoids filling the TV's paired-device list.
const PAIR_FAILURES_BEFORE_NEW_UUID = 2;

export class AuthError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "AuthError";
    this.reason = reason; // "rejected" | "none"
  }
}
export class UnreachableError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnreachableError";
  }
}
export class PinError extends Error {
  constructor(message, { cancelled = false } = {}) {
    super(message);
    this.name = "PinError";
    this.cancelled = cancelled; // the user gave up; not the TV's fault
  }
}
export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}
export class CertificateError extends Error {
  constructor(message) {
    super(message);
    this.name = "CertificateError";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Open the TLS connection to the TV and verify it before any MQTT data (the
// CONNECT packet carries our credentials: the access token, or on refresh the
// refresh token) is sent.
//
// Verification: with a CA (secrets.caPem) the chain is checked normally. Without
// one, the TV's self-signed certificate is trusted on first use and pinned —
// `expectedFingerprint` (from the stored record) must then match, so a later
// impostor on the same address fails here, at the TLS handshake. First-ever
// pairing has nothing to compare against (TOFU).
function openTls({ host, port, secrets, expectedFingerprint }) {
  const opts = {
    host,
    port,
    ...(net.isIP(host) === 0 ? { servername: host } : {}),
    ...(secrets.cert ? { cert: secrets.cert, key: secrets.key } : {}),
    ...(secrets.pfx ? { pfx: secrets.pfx, passphrase: secrets.passphrase } : {}),
    ...(secrets.caPem
      ? { ca: secrets.caPem, rejectUnauthorized: true }
      : { rejectUnauthorized: false })
  };
  return new Promise((resolve, reject) => {
    const socket = tls.connect(opts);
    const fail = (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const timer = setTimeout(
      () => fail(new UnreachableError("TV not reachable: connection timed out")),
      CONNECT_TIMEOUT_MS
    );
    socket.once("error", (err) =>
      fail(new UnreachableError(`TV not reachable: ${err?.message || err?.code || "error"}`))
    );
    socket.once("secureConnect", () => {
      const fingerprint = socket.getPeerCertificate()?.fingerprint256;
      if (!secrets.caPem && expectedFingerprint && fingerprint !== expectedFingerprint) {
        fail(new CertificateError("the TV certificate changed since pairing (possible impostor)"));
        return;
      }
      clearTimeout(timer);
      // From here on mqtt reports socket errors; keep a no-op so none is
      // unhandled in between.
      socket.removeAllListeners("error");
      socket.on("error", () => {});
      resolve({ socket, fingerprint });
    });
  });
}

// Open a verified TLS MQTT connection. Resolves a small wrapper with a message
// log and a waitFor(topic) helper; rejects with a classified error.
async function openVerified({ host, port, creds, secrets, expectedFingerprint = null }) {
  const mqtt = await loadMqtt();
  const { socket, fingerprint } = await openTls({ host, port, secrets, expectedFingerprint });
  const opts = {
    protocolVersion: 4,
    clientId: creds.mqttClientId || creds.clientId,
    username: creds.username,
    password: creds.password,
    reconnectPeriod: 0,
    connectTimeout: CONNECT_TIMEOUT_MS
  };

  return new Promise((resolve, reject) => {
    // The socket is already verified; mqtt only writes CONNECT on top of it.
    const client = new mqtt.MqttClient(() => socket, opts);
    const messages = [];
    let settled = false;

    client.on("message", (topic, payload) => {
      messages.push({ topic, payload: payload.toString("utf8") });
    });

    client.on("connect", () => {
      if (settled) return;
      settled = true;
      resolve({
        client,
        messages,
        fingerprint,
        async waitFor(topic, timeoutMs, since = 0) {
          const end = Date.now() + timeoutMs;
          while (Date.now() < end) {
            for (let i = since; i < messages.length; i++) {
              if (messages[i].topic === topic) return messages[i].payload;
            }
            await sleep(100);
          }
          return null;
        },
        subscribe: (topics) => new Promise((r) => client.subscribe(topics, () => r())),
        publish: (topic, payload = "") =>
          new Promise((r) => client.publish(topic, payload, {}, () => r())),
        stop: () =>
          new Promise((r) => {
            client.end(true, {}, r);
          })
      });
    });

    client.on("error", (err) => {
      if (settled) return;
      settled = true;
      client.end(true);
      const code = err?.code;
      if (code === 4 || code === 5) {
        reject(new AuthError("rejected", "the TV rejected our credentials"));
      } else {
        reject(new UnreachableError(`TV not reachable: ${err?.message || code || "error"}`));
      }
    });

    // The TV dropped the connection before answering CONNECT.
    client.on("close", () => {
      if (settled) return;
      settled = true;
      client.end(true);
      reject(new UnreachableError("TV not reachable: connection closed"));
    });
  });
}

// Check that the mqtt library loads and builds a CONNECT packet, by letting it
// write one into a local socket. Used by `selftest` to smoke-test the bundled
// program, whose mqtt is otherwise only loaded when talking to a TV.
export async function selfTest({ timeoutMs = 5000 } = {}) {
  const mqtt = await loadMqtt();
  if (typeof mqtt.MqttClient !== "function") throw new Error("mqtt client not available");
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  let client;
  try {
    const firstByte = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("mqtt sent nothing")), timeoutMs);
      server.once("connection", (s) => {
        s.on("error", () => {});
        s.once("data", (d) => {
          clearTimeout(timer);
          resolve(d[0]);
        });
      });
      const socket = net.connect(server.address().port, "127.0.0.1");
      socket.on("error", () => {});
      client = new mqtt.MqttClient(() => socket, {
        protocolVersion: 4,
        clientId: "selftest",
        reconnectPeriod: 0,
        connectTimeout: timeoutMs
      });
      client.on("error", () => {});
    });
    if (firstByte !== 0x10) throw new Error("mqtt did not send a CONNECT packet");
  } finally {
    client?.end(true);
    server.close();
  }
}

function saveRecord(record) {
  const state = readState();
  state.tvs[record.host] = { ...record };
  writeState(state);
}

// The brand the TV declares in its descriptor (null when unknown).
async function realTvBrand(host) {
  const info = await fetchDescriptor(host).catch(() => null);
  return info?.brand || null;
}

// Credentials for a stored pairing: its profile and brand, and for the static
// profile the paired topic identity with a fresh broker id (as Sidee does).
function recordCredentials(record, { ts, token, secrets }) {
  const authProfile = record.authProfile || "modern";
  const creds = protocol.sessionCredentials({
    deviceId: record.deviceId,
    tvTimestamp: ts,
    token,
    constants: secrets.constants,
    authProfile,
    brand: record.brand
  });
  if (authProfile !== "static") return creds;
  return {
    ...creds,
    clientId: record.clientId || creds.clientId,
    mqttClientId: "nuvio_" + protocol.newDeviceId().replace(/:/g, "")
  };
}

const isTokenless = (record) => record?.authProfile === "static" && !record?.tokens;

function tokensToRecord(tok, base) {
  const dur = Number(tok.accesstoken_duration_day || 2);
  return {
    ...base,
    tokens: tok,
    expiresAt: Date.now() + dur * 86400 * 1000,
    pairFailures: 0
  };
}

export async function pair({
  host,
  port = DEFAULT_PORT,
  pinProvider,
  onPinReady,
  secrets,
  getTimestamp,
  getBrand,
  pinWaitMs
}) {
  const ts = await (getTimestamp ? getTimestamp() : realTvTimestamp(host));
  const brand = await (getBrand ? getBrand() : realTvBrand(host));
  const prev = readState().tvs[host];
  const reused = Boolean(prev?.deviceId) && !pairFailuresExceeded(prev);
  const deviceId = reused ? prev.deviceId : protocol.newDeviceId();
  try {
    return await pairWith({
      host,
      port,
      pinProvider,
      onPinReady,
      secrets,
      ts,
      prev,
      deviceId,
      brand,
      reused,
      pinWaitMs
    });
  } catch (e) {
    if (countsAsPairFailure(e)) registerPairFailure(host, reused);
    throw e;
  }
}

export function pairFailuresExceeded(record) {
  return (record?.pairFailures || 0) >= PAIR_FAILURES_BEFORE_NEW_UUID;
}

// A cancelled PIN prompt, an unreachable TV or a certificate mismatch says
// nothing about the TV's state for our UUID, so they do not count.
function countsAsPairFailure(e) {
  if (e instanceof PinError) return !e.cancelled;
  return e instanceof AuthError || e instanceof TimeoutError;
}

// Only a failure with the reused UUID counts against it; failures with a
// fresh UUID leave the stored record untouched (as in Sidee).
function registerPairFailure(host, reused) {
  if (!reused) return;
  const state = readState();
  const rec = state.tvs[host];
  if (!rec) return;
  state.tvs[host] = { ...rec, pairFailures: (rec.pairFailures || 0) + 1 };
  writeState(state);
}

// Open the pairing connection, trying each available auth profile once, and
// only after the TV explicitly refused the previous one (MQTT rc 4/5). Network,
// TLS and certificate failures stop at once: other credentials cannot fix them.
// Order as in Sidee: a known working profile first, otherwise "static" (a
// rejected dynamic attempt can throttle static auth on Toshiba firmware).
async function openPairingConnection({ host, port, secrets, ts, prev, deviceId, brand, reused }) {
  const available = protocol.availableAuthProfiles(secrets.constants);
  const preferred = reused && prev?.authProfile ? prev.authProfile : "static";
  const order = [...new Set([preferred, ...protocol.AUTH_PROFILES])].filter((p) =>
    available.includes(p)
  );
  const refused = [];
  for (const authProfile of order) {
    const creds = protocol.sessionCredentials({
      deviceId,
      tvTimestamp: ts,
      constants: secrets.constants,
      authProfile,
      brand
    });
    if (authProfile === "static") {
      creds.mqttClientId = "nuvio_" + protocol.newDeviceId().replace(/:/g, "");
    }
    try {
      // Re-pairing a TV we already know: verify its pinned certificate so a
      // MITM cannot hijack the re-pair. First-ever pairing is TOFU.
      const conn = await openVerified({
        host,
        port,
        creds,
        secrets,
        expectedFingerprint: prev?.serverFingerprint
      });
      return { conn, creds, authProfile };
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      refused.push(authProfile);
    }
  }
  throw new AuthError(
    "rejected",
    `the TV refused every authentication profile (${refused.join(", ") || "none available"})`
  );
}

async function pairWith({
  host,
  port,
  pinProvider,
  onPinReady,
  secrets,
  ts,
  prev,
  deviceId,
  brand,
  reused,
  pinWaitMs = {}
}) {
  const { conn, creds, authProfile } = await openPairingConnection({
    host,
    port,
    secrets,
    ts,
    prev,
    deviceId,
    brand,
    reused
  });
  const t = protocol.tvTopics(creds.clientId);
  const isStatic = authProfile === "static";
  try {
    await conn.subscribe([t.authReply, t.authCodeReply, t.tokenReply]);
    // Pre-token (static) firmware shows the PIN on a TV state query; newer
    // TVs, and static ones that ignore it, use the app-connect request.
    let started = null;
    if (isStatic) {
      await conn.publish(t.ui + "actions/gettvstate", "");
      started = await conn.waitFor(t.authReply, pinWaitMs.tvState ?? 5000);
    }
    if (started === null) {
      await conn.publish(t.ui + "actions/vidaa_app_connect", protocol.connectPayload());
      started = await conn.waitFor(t.authReply, isStatic ? 10000 : 15000);
    }
    if (started === null) {
      throw new TimeoutError("the TV did not start pairing");
    }
    if (onPinReady) await onPinReady();
    let pin;
    try {
      pin = await pinProvider();
    } catch (e) {
      throw new PinError(e?.message || "no PIN entered", { cancelled: true });
    }
    if (!pin) throw new PinError("no PIN entered", { cancelled: true });
    const since = conn.messages.length;
    await conn.publish(t.ui + "actions/authenticationcode", protocol.pinPayload(pin));
    const reply = await conn.waitFor(t.authCodeReply, 15000, since);
    if (reply === null) throw new TimeoutError("the TV did not confirm the PIN");
    let result;
    try {
      result = JSON.parse(reply).result;
    } catch {
      result = 0;
    }
    if (result !== 1) throw new PinError("PIN incorrect or expired");

    const sincePin = conn.messages.length;
    await conn.publish(t.platform + "data/gettoken", protocol.tokenRequestPayload(""));
    await conn.publish(t.ui + "actions/authenticationcodeclose", "");
    const raw = await conn.waitFor(
      t.tokenReply,
      isStatic ? (pinWaitMs.staticToken ?? 5000) : 20000,
      sincePin
    );
    const base = {
      host,
      port,
      deviceId,
      clientId: creds.clientId,
      username: creds.username,
      authProfile,
      brand: brand || null,
      serverFingerprint: conn.fingerprint
    };
    if (raw === null && isStatic) {
      // Static firmware authorizes the client identity after the PIN and sends
      // no token. Only save it once it answers a fresh read-only request.
      await conn.subscribe([t.applistReply]);
      const sinceApps = conn.messages.length;
      await conn.publish(t.ui + "actions/applist", "0");
      const apps = await conn.waitFor(t.applistReply, 8000, sinceApps);
      if (apps === null || protocol.parseAppList(apps) === null) {
        throw new TimeoutError("PIN accepted but the TV did not confirm access to its app list");
      }
      const record = { ...base, tokens: null, pairFailures: 0 };
      saveRecord(record);
      return record;
    }
    const tok = raw && protocol.parseToken(raw);
    if (!tok) throw new TimeoutError("PIN accepted but the TV sent no token");

    const record = tokensToRecord(tok, base);
    saveRecord(record);
    return record;
  } finally {
    await conn.stop();
  }
}

export async function refresh(record, { secrets, getTimestamp } = {}) {
  // A static pairing has no tokens to refresh: the TV must be paired again.
  if (isTokenless(record))
    throw new AuthError("rejected", "the TV rejected the pairing: pair again");
  const ts = await (getTimestamp ? getTimestamp() : realTvTimestamp(record.host));
  const creds = recordCredentials(record, { ts, token: record.tokens.refreshtoken, secrets });
  const t = protocol.tvTopics(creds.clientId);
  const conn = await openVerified({
    host: record.host,
    port: record.port,
    creds,
    secrets,
    expectedFingerprint: record.serverFingerprint
  });
  try {
    await conn.subscribe([t.tokenReply]);
    await conn.publish(
      t.platform + "data/gettoken",
      protocol.tokenRequestPayload(record.tokens.refreshtoken)
    );
    const raw = await conn.waitFor(t.tokenReply, 20000);
    const tok = raw && protocol.parseToken(raw);
    if (!tok) throw new AuthError("rejected", "refresh failed: pair again");
    const updated = tokensToRecord(tok, { ...record });
    saveRecord(updated);
    return updated;
  } finally {
    await conn.stop();
  }
}

// Run op(conn, topics) on a token-authenticated connection, refreshing first
// when the access token is near expiry and retrying once if the TV rejects it.
export async function withSession(record, op, { secrets, getTimestamp } = {}) {
  let current = record;
  if (
    !isTokenless(current) &&
    current.expiresAt &&
    Date.now() > current.expiresAt - REFRESH_MARGIN_MS
  ) {
    current = await refresh(current, { secrets, getTimestamp });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    // A static pairing needs no TV clock: its identity is fixed.
    const ts = isTokenless(current)
      ? 0
      : await (getTimestamp ? getTimestamp() : realTvTimestamp(current.host));
    const creds = recordCredentials(current, {
      ts,
      token: isTokenless(current) ? null : current.tokens.accesstoken,
      secrets
    });
    const t = protocol.tvTopics(creds.clientId);
    let conn;
    try {
      conn = await openVerified({
        host: current.host,
        port: current.port,
        creds,
        secrets,
        expectedFingerprint: current.serverFingerprint
      });
    } catch (e) {
      if (e instanceof AuthError && attempt === 0) {
        current = await refresh(current, { secrets, getTimestamp });
        continue;
      }
      throw e;
    }
    try {
      return await op(conn, t);
    } finally {
      await conn.stop();
    }
  }
  throw new AuthError("rejected", "could not authenticate with the TV");
}

export function tileMatches(tile, appId, url) {
  if (!tile || String(tile.appId || "").toLowerCase() !== String(appId).toLowerCase()) {
    return false;
  }
  const urls = ["url", "appUrl", "URL"]
    .map((k) => (typeof tile[k] === "string" ? tile[k].trim() : ""))
    .filter(Boolean);
  return urls.length > 0 && urls.every((u) => u === url);
}

// Pauses the real launcher needs (taken from Sidee, which was tested on a TV).
// Tests pass `opts.delays` to shrink them.
export const DEFAULT_DELAYS = {
  afterInstallMs: 8000, // the launcher registers the tile before it lists it
  installRetryMs: 2000, // second applist query if the first missed the tile
  afterLaunchMs: 4000 // keep the connection open while the TV starts the app
};
const delaysFrom = (opts) => ({ ...DEFAULT_DELAYS, ...(opts?.delays || {}) });

export async function addTile(record, { appId, name, url, image = "" }, opts) {
  const delays = delaysFrom(opts);
  return withSession(
    record,
    async (conn, t) => {
      await conn.subscribe([t.applistReply]);
      await conn.publish(
        t.ui + "actions/uievent",
        protocol.installPayload({ appId, name, url, image })
      );
      await sleep(delays.afterInstallMs);
      for (let attempt = 0; attempt < 2; attempt++) {
        const since = conn.messages.length;
        await conn.publish(t.ui + "actions/applist", "0");
        const raw = await conn.waitFor(t.applistReply, 8000, since);
        const apps = raw ? protocol.parseAppList(raw) : null;
        if (apps && apps.some((a) => tileMatches(a, appId, url))) return apps;
        if (attempt === 0) await sleep(delays.installRetryMs);
      }
      throw new TimeoutError("the TV did not confirm the tile");
    },
    opts
  );
}

export async function listTiles(record, opts) {
  return withSession(
    record,
    async (conn, t) => {
      await conn.subscribe([t.applistReply]);
      await conn.publish(t.ui + "actions/applist", "0");
      const raw = await conn.waitFor(t.applistReply, 10000);
      return (raw && protocol.parseAppList(raw)) || [];
    },
    opts
  );
}

export async function launchTile(record, { appId, name, url }, opts) {
  const delays = delaysFrom(opts);
  return withSession(
    record,
    async (conn, t) => {
      await conn.publish(t.ui + "actions/launchapp", protocol.launchPayload({ appId, name, url }));
      // Disconnecting right away can cut the launch short (Sidee waits 4 s).
      await sleep(delays.afterLaunchMs);
    },
    opts
  );
}

export async function removeTile(record, appId, opts) {
  return withSession(
    record,
    async (conn, t) => {
      await conn.publish(t.ui + "actions/removeapp", JSON.stringify({ appId }));
      await sleep(500);
      await conn.subscribe([t.applistReply]);
      const since = conn.messages.length;
      await conn.publish(t.ui + "actions/applist", "0");
      const raw = await conn.waitFor(t.applistReply, 8000, since);
      const apps = (raw && protocol.parseAppList(raw)) || [];
      return !apps.some((a) => String(a.appId).toLowerCase() === String(appId).toLowerCase());
    },
    opts
  );
}
