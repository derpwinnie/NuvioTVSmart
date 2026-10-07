// One TLS MQTT connection to one TV, and the operations built on it:
// pair, refresh, install, list, launch, remove.
//
// Connection outcomes are classified so the UI can tell "pair again" (the TV
// rejected our credentials) apart from "TV unreachable" (a network failure).

import mqtt from "mqtt";
import * as protocol from "./protocol.mjs";
import { tvTimestamp as realTvTimestamp } from "./discovery.mjs";
import { readState, writeState } from "./store.mjs";

const DEFAULT_PORT = 36669;
const REFRESH_MARGIN_MS = 12 * 3600 * 1000;

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
  constructor(message) {
    super(message);
    this.name = "PinError";
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

// Open a verified TLS MQTT connection. Resolves a small wrapper with a message
// log and a waitFor(topic) helper; rejects with a classified error.
//
// Verification: with a CA (secrets.caPem) the chain is checked normally. Without
// one, the TV's self-signed certificate is trusted on first use and pinned —
// `expectedFingerprint` (from the stored record) must then match, so a later
// impostor on the same address is rejected.
function connect({ host, port, creds, secrets, expectedFingerprint = null }) {
  const opts = {
    host,
    port,
    protocol: "mqtts",
    protocolVersion: 4,
    clientId: creds.clientId,
    username: creds.username,
    password: creds.password,
    pfx: secrets.pfx,
    passphrase: secrets.passphrase,
    reconnectPeriod: 0,
    connectTimeout: 10000,
    pfxForceNativeStore: false
  };
  if (secrets.caPem) {
    opts.ca = secrets.caPem;
    opts.rejectUnauthorized = true;
  } else {
    // Pin-on-first-use: the TV uses a self-signed certificate, so we cannot
    // verify a chain. The caller compares the peer fingerprint against the one
    // stored at pairing time.
    opts.rejectUnauthorized = false;
  }

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(opts);
    const messages = [];
    let settled = false;

    client.on("message", (topic, payload) => {
      messages.push({ topic, payload: payload.toString("utf8") });
    });

    client.on("connect", () => {
      if (settled) return;
      settled = true;
      const socket = client.stream?.socket || client.stream;
      let fingerprint;
      try {
        fingerprint = socket?.getPeerCertificate?.()?.fingerprint256;
      } catch {
        /* ignore */
      }
      // Pinned-certificate check (only when we are not verifying against a CA).
      if (!secrets.caPem && expectedFingerprint && fingerprint !== expectedFingerprint) {
        settled = true;
        client.end(true);
        return reject(
          new CertificateError("the TV certificate changed since pairing (possible impostor)")
        );
      }
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
  });
}

function saveRecord(record) {
  const state = readState();
  state.tvs[record.host] = { ...record };
  writeState(state);
}

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
  store = { readState, writeState },
  secrets,
  getTimestamp
}) {
  void store;
  const ts = await (getTimestamp ? getTimestamp() : realTvTimestamp(host));
  const prev = readState().tvs[host];
  const deviceId =
    prev && prev.deviceId && (prev.pairFailures || 0) < 2 ? prev.deviceId : protocol.newDeviceId();
  const creds = protocol.sessionCredentials({
    deviceId,
    tvTimestamp: ts,
    constants: secrets.constants
  });
  const t = protocol.tvTopics(creds.clientId);
  const conn = await connect({ host, port, creds, secrets });
  try {
    await conn.subscribe([t.authReply, t.authCodeReply, t.tokenReply]);
    await conn.publish(t.ui + "actions/vidaa_app_connect", protocol.connectPayload());
    if ((await conn.waitFor(t.authReply, 15000)) === null) {
      throw new TimeoutError("the TV did not start pairing");
    }
    if (onPinReady) await onPinReady();
    const pin = await pinProvider();
    if (!pin) throw new PinError("no PIN entered");
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
    const raw = await conn.waitFor(t.tokenReply, 20000, sincePin);
    const tok = raw && protocol.parseToken(raw);
    if (!tok) throw new TimeoutError("PIN accepted but the TV sent no token");

    const record = tokensToRecord(tok, {
      host,
      port,
      deviceId,
      clientId: creds.clientId,
      username: creds.username,
      serverFingerprint: conn.fingerprint
    });
    saveRecord(record);
    return record;
  } finally {
    await conn.stop();
  }
}

export async function refresh(record, { secrets, getTimestamp } = {}) {
  const ts = await (getTimestamp ? getTimestamp() : realTvTimestamp(record.host));
  const creds = protocol.sessionCredentials({
    deviceId: record.deviceId,
    tvTimestamp: ts,
    token: record.tokens.refreshtoken,
    constants: secrets.constants
  });
  const t = protocol.tvTopics(creds.clientId);
  const conn = await connect({
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
  if (current.expiresAt && Date.now() > current.expiresAt - REFRESH_MARGIN_MS) {
    current = await refresh(current, { secrets, getTimestamp });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const ts = await (getTimestamp ? getTimestamp() : realTvTimestamp(current.host));
    const creds = protocol.sessionCredentials({
      deviceId: current.deviceId,
      tvTimestamp: ts,
      token: current.tokens.accesstoken,
      constants: secrets.constants
    });
    const t = protocol.tvTopics(creds.clientId);
    let conn;
    try {
      conn = await connect({
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

export async function addTile(record, { appId, name, url, image = "" }, opts) {
  return withSession(
    record,
    async (conn, t) => {
      await conn.subscribe([t.applistReply]);
      await conn.publish(
        t.ui + "actions/uievent",
        protocol.installPayload({ appId, name, url, image })
      );
      for (let attempt = 0; attempt < 2; attempt++) {
        const since = conn.messages.length;
        await conn.publish(t.ui + "actions/applist", "0");
        const raw = await conn.waitFor(t.applistReply, 8000, since);
        const apps = raw ? protocol.parseAppList(raw) : null;
        if (apps && apps.some((a) => tileMatches(a, appId, url))) return apps;
        if (attempt === 0) await sleep(1500);
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
  return withSession(
    record,
    async (conn, t) => {
      await conn.publish(t.ui + "actions/launchapp", protocol.launchPayload({ appId, name, url }));
      await sleep(500);
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
