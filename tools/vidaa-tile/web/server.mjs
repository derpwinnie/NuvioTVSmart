// Local dashboard for the VIDAA tile tool.
//
// Binds 127.0.0.1 by default. With { lan: true } it binds all interfaces and
// requires a random access key (set in a cookie, never in the URL), so a phone
// on the same network can drive it without exposing it to the world.

import http from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { discover } from "../discovery.mjs";
import { extractKeystores } from "../cert.mjs";
import { loadSecrets, requireComplete } from "../secrets.mjs";
import { readState, writeFileAtomic, secretsPath } from "../store.mjs";
import { validateTileUrl, withVidaaWrapper } from "../urls.mjs";
import * as session from "../session.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function recordFor(host) {
  const rec = readState().tvs[host];
  if (!rec) throw new Error(`no paired TV at ${host}`);
  return rec;
}

export async function startDashboard({ lan = false, port = 0 } = {}) {
  const host = lan ? "0.0.0.0" : "127.0.0.1";
  const key = lan ? randomBytes(16).toString("hex") : null;
  const pending = { resolvePin: null, promise: null, ready: null };

  const authed = (req) => {
    if (!key) return true;
    const cookie = /(?:^|;\s*)vk=([a-f0-9]+)/.exec(req.headers.cookie || "");
    if (!cookie) return false;
    const a = Buffer.from(cookie[1]);
    const b = Buffer.from(key);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const api = {
    async "GET /api/status"() {
      const state = readState();
      return { secrets: requireComplete(), tvs: Object.keys(state.tvs) };
    },
    async "POST /api/import-apk"(body) {
      const out = extractKeystores(body.apkPath);
      return { ok: true, files: out };
    },
    async "POST /api/secret"(body) {
      let cur = {};
      try {
        cur = JSON.parse(readFileSync(secretsPath(), "utf8"));
      } catch {
        /* new */
      }
      if (body.passphrase) cur.keystorePassphrase = body.passphrase;
      if (body.constants) cur.constants = body.constants;
      if (body.caPem) cur.caPem = body.caPem;
      writeFileAtomic("secrets.json", JSON.stringify(cur, null, 2));
      return { ok: true };
    },
    async "POST /api/discover"() {
      return { tvs: await discover({ timeoutMs: 4000 }) };
    },
    async "POST /api/pair/start"(body) {
      const secrets = loadSecrets();
      pending.ready = null;
      const readySignal = new Promise((r) => (pending.ready = r));
      pending.promise = session
        .pair({
          host: body.host,
          secrets,
          onPinReady: () => pending.ready(),
          pinProvider: () => new Promise((r) => (pending.resolvePin = r))
        })
        .then((rec) => ({ ok: true, host: rec.host }))
        .catch((e) => ({ ok: false, error: classify(e) }));
      // Resolve this call once the TV has shown its PIN (or pairing failed).
      await Promise.race([readySignal, pending.promise]);
      return { ok: true, waitingForPin: true };
    },
    async "POST /api/pair/submit"(body) {
      if (!pending.resolvePin) throw new Error("no pairing in progress");
      pending.resolvePin(String(body.pin || ""));
      return pending.promise;
    },
    async "GET /api/tiles"(body, url) {
      const secrets = loadSecrets();
      return {
        tiles: await session.listTiles(recordFor(url.searchParams.get("host")), { secrets })
      };
    },
    async "POST /api/tiles"(body) {
      const secrets = loadSecrets();
      const v = validateTileUrl(body.url);
      if (!v.ok) return { ok: false, error: v.reason };
      const tiles = await session.addTile(
        recordFor(body.host),
        {
          appId: body.appId || "nuvio",
          name: body.name || "Nuvio",
          url: withVidaaWrapper(v.url),
          image: body.image || ""
        },
        { secrets }
      );
      return { ok: true, tiles };
    },
    async "POST /api/launch"(body) {
      const secrets = loadSecrets();
      await session.launchTile(
        recordFor(body.host),
        { appId: body.appId, name: body.name || body.appId, url: body.url || "" },
        { secrets }
      );
      return { ok: true };
    },
    async "DELETE /api/tiles"(body) {
      const secrets = loadSecrets();
      const gone = await session.removeTile(recordFor(body.host), body.appId, { secrets });
      return { ok: true, removed: gone };
    }
  };

  const allowedHosts = new Set(["127.0.0.1", "localhost"]);
  if (lan) allowedHosts.add(localAddress());

  // Reject requests whose Host header is not one we bound to. This blocks DNS
  // rebinding, where a malicious page resolves its own domain to 127.0.0.1 and
  // POSTs to the dashboard: such requests carry the attacker's Host, not ours.
  const hostAllowed = (req) => {
    const h = (req.headers.host || "").split(":")[0];
    return allowedHosts.has(h);
  };

  // State-changing requests must be same-origin. A cross-site page can send a
  // simple POST, but its Origin header will not match ours.
  const originAllowed = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true; // same-origin navigations / curl have no Origin
    try {
      return (new URL(origin).host || "") === (req.headers.host || "");
    } catch {
      return false;
    }
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!hostAllowed(req)) return send(res, 403, { error: "forbidden host" });
    if (req.method !== "GET" && !originAllowed(req)) {
      return send(res, 403, { error: "cross-origin request refused" });
    }
    // LAN login: accept the key once, set the cookie.
    if (key && url.pathname === "/login" && url.searchParams.get("key")) {
      const ok = url.searchParams.get("key") === key;
      res.writeHead(
        ok ? 302 : 403,
        ok ? { "Set-Cookie": `vk=${key}; HttpOnly; SameSite=Strict`, Location: "/" } : {}
      );
      return res.end(ok ? "" : "bad key");
    }
    if (!authed(req)) return send(res, 401, { error: "unauthorized" });

    const route = `${req.method} ${url.pathname}`;
    if (api[route]) {
      try {
        const body = req.method === "GET" ? {} : await readBody(req);
        return send(res, 200, await api[route](body, url));
      } catch (e) {
        return send(res, 400, { error: classify(e) });
      }
    }
    return serveStatic(url.pathname, res);
  });

  await new Promise((r) => server.listen(port, host, r));
  const actual = server.address().port;
  const base = `http://${lan ? localAddress() : "127.0.0.1"}:${actual}/`;
  const link = key ? `${base}login?key=${key}` : base;
  if (process.env.NODE_ENV !== "test") {
    console.log(`Dashboard: ${link}`);
    if (lan) console.log("(LAN mode — open the link above once to authorize this browser.)");
  }
  return { server, port: actual, link, close: () => new Promise((r) => server.close(r)) };
}

function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  let body;
  try {
    body = readFileSync(file);
  } catch {
    return send(res, 404, { error: "not found" });
  }
  const ext = rel.slice(rel.lastIndexOf("."));
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  res.end(body);
}

function classify(e) {
  if (e.name === "UnreachableError") return "TV not reachable.";
  if (e.name === "PinError") return "PIN incorrect or expired.";
  if (e.name === "AuthError") return "Please pair again.";
  if (e.name === "CertificateError")
    return "The TV certificate changed — a different device may be answering.";
  return e.message || "error";
}

function localAddress() {
  const nets = Object.values(networkInterfaces()).flat();
  const a = nets.find((n) => n && n.family === "IPv4" && !n.internal);
  return a ? a.address : "127.0.0.1";
}
