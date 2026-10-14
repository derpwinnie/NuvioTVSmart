import http from "node:http";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { haveOpenssl, startFakeTv } from "./fake-vidaa-tv/index.mjs";

process.env.NODE_ENV = "test";
process.env.NUVIO_VIDAA_HOME = mkdtempSync(join(tmpdir(), "vidaa-web-"));
const { startDashboard, MAX_BODY_BYTES } = await import("../tools/vidaa-tile/web/server.mjs");
const store = await import("../tools/vidaa-tile/store.mjs");

// Raw request helper — fetch silently drops Host/Origin/Cookie (forbidden
// headers) and follows redirects.
const raw = (port, method, path, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    // Node sends DELETE bodies without a length unless one is set.
    if (body !== undefined) req.setHeader("Content-Length", Buffer.byteLength(body));
    req.end(body);
  });
const jsonCall = (port, method, path, body, headers = {}) =>
  raw(port, method, path, {
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined
  });

// --- Local dashboard: guards and static files -------------------------------
{
  const dash = await startDashboard({ port: 0 });
  const call = (method, path, body) => jsonCall(dash.port, method, path, body);

  // Fresh home: status reports missing secrets and no TVs.
  const status = await call("GET", "/api/status");
  assert.equal(status.status, 200);
  assert.equal(status.json.secrets.needApk, true);
  assert.deepEqual(status.json.tvs, []);

  // Static page is served.
  const page = await raw(dash.port, "GET", "/");
  assert.match(page.text, /VIDAA tile installer/);

  // DNS-rebinding guard: a foreign Host header is refused.
  const rebind = await raw(dash.port, "GET", "/api/status", { headers: { Host: "evil.example" } });
  assert.equal(rebind.status, 403);

  // CSRF guard: a cross-origin state-changing request is refused.
  const csrf = await raw(dash.port, "POST", "/api/discover", {
    headers: { Host: `127.0.0.1:${dash.port}`, Origin: "http://evil.example" }
  });
  assert.equal(csrf.status, 403);

  // Oversized bodies are refused before they are parsed or acted on.
  const big = await call("POST", "/api/secret", { passphrase: "x".repeat(MAX_BODY_BYTES) });
  assert.equal(big.status, 413);
  assert.equal(existsSync(store.secretsPath()), false, "nothing was written");

  // Pairing needs an address.
  const noHost = await call("POST", "/api/pair/start", {});
  assert.equal(noHost.status, 400);
  // Submitting a PIN without a pairing is an error.
  const noPair = await call("POST", "/api/pair/submit", { pin: "1" });
  assert.equal(noPair.status, 400);
  assert.match(noPair.json.error, /no pairing in progress/);

  await dash.close();
}

// --- LAN mode: the access key and the login cookie ---------------------------
{
  const dash = await startDashboard({ lan: true, port: 0 });
  const key = /login\?key=([a-f0-9]+)$/.exec(dash.link)?.[1];
  assert.ok(key && key.length === 32, "the login link carries the key");
  const local = { Host: `127.0.0.1:${dash.port}` };

  assert.equal((await raw(dash.port, "GET", "/api/status", { headers: local })).status, 401);
  assert.equal((await raw(dash.port, "GET", "/", { headers: local })).status, 401);

  // A wrong key (same length, or a different length) is refused.
  const wrong = key.replace(/./, (c) => (c === "a" ? "b" : "a"));
  for (const k of [wrong, "abc"]) {
    const r = await raw(dash.port, "GET", `/login?key=${k}`, { headers: local });
    assert.equal(r.status, 403);
    assert.equal(r.headers["set-cookie"], undefined);
  }

  // The right key sets an HttpOnly cookie and redirects away from the key URL.
  const login = await raw(dash.port, "GET", `/login?key=${key}`, { headers: local });
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, "/");
  assert.equal(login.headers["cache-control"], "no-store");
  const cookie = login.headers["set-cookie"][0];
  assert.match(cookie, new RegExp(`^vk=${key};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  const withCookie = await raw(dash.port, "GET", "/api/status", {
    headers: { ...local, Cookie: `vk=${key}` }
  });
  assert.equal(withCookie.status, 200);
  assert.deepEqual(withCookie.json.tvs, []);
  const badCookie = await raw(dash.port, "GET", "/api/status", {
    headers: { ...local, Cookie: `vk=${wrong}` }
  });
  assert.equal(badCookie.status, 401);

  await dash.close();
}

// --- Full pair + tile management over HTTP, against the fake TV --------------
if (haveOpenssl()) {
  const constants = {
    PATTERN: "p",
    VALUE_SUFFIX: "s",
    XOR_MASK: "7",
    BRAND: "his",
    OPERATION: "op_001"
  };
  const tv = await startFakeTv({ constants: { ...constants, XOR_MASK: 7n }, pin: "2468" });
  store.writeFileAtomic(
    "secrets.json",
    JSON.stringify({ keystorePassphrase: tv.clientPass, constants, caPem: tv.ca.toString() })
  );
  store.writeBinaryAtomic("client.p12", tv.clientPfx);

  // The fake TV listens on an ephemeral port with a fixed clock; the real
  // launcher pauses are shrunk. Everything else goes through HTTP.
  const dash = await startDashboard({
    port: 0,
    tv: {
      port: tv.port,
      getTimestamp: async () => tv.timestamp,
      delays: { afterInstallMs: 0, installRetryMs: 0, afterLaunchMs: 0 }
    }
  });
  const call = (method, path, body) => jsonCall(dash.port, method, path, body);
  const host = tv.host;

  // A pairing that fails before the PIN step reports the failure (not
  // "waiting for PIN") and leaves nothing to submit a PIN to.
  tv.setBehavior("expiredRefresh"); // the TV refuses the connection
  let r = await call("POST", "/api/pair/start", { host });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.waitingForPin, undefined);
  assert.equal(r.json.error, "Please pair again.");
  r = await call("POST", "/api/pair/submit", { pin: "2468" });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no pairing in progress/);
  tv.setBehavior("ok");

  // Wrong PIN: start succeeds, submit reports the PIN error.
  r = await call("POST", "/api/pair/start", { host });
  assert.deepEqual(r.json, { ok: true, waitingForPin: true });
  tv.setBehavior("wrongPin");
  r = await call("POST", "/api/pair/submit", { pin: "0000" });
  assert.deepEqual(r.json, { ok: false, error: "PIN incorrect or expired." });
  tv.setBehavior("ok");
  r = await call("POST", "/api/pair/submit", { pin: "2468" });
  assert.equal(r.status, 400, "a finished pairing takes no further PIN");

  // A second start replaces an unfinished one; the right PIN pairs.
  r = await call("POST", "/api/pair/start", { host });
  assert.equal(r.json.waitingForPin, true);
  r = await call("POST", "/api/pair/start", { host });
  assert.equal(r.json.waitingForPin, true);
  r = await call("POST", "/api/pair/submit", { pin: "2468" });
  assert.deepEqual(r.json, { ok: true, host });

  r = await call("GET", "/api/status");
  assert.deepEqual(r.json.tvs, [host]);

  // Tiles: list (empty), add, refuse a bad URL, launch, delete.
  r = await call("GET", `/api/tiles?host=${host}`);
  assert.deepEqual(r.json, { tiles: [] });

  r = await call("POST", "/api/tiles", { host, url: "https://nuvio.example/" });
  assert.equal(r.json.ok, true);
  assert.ok(
    r.json.tiles.some(
      (t) => t.appId === "nuvio" && t.url === "https://nuvio.example/?wrapper=vidaa"
    )
  );
  assert.equal(tv.appList().length, 1);

  r = await call("POST", "/api/tiles", { host, url: "http://192.168.1.1.evil.com/" });
  assert.deepEqual(r.json, {
    ok: false,
    error: "plain http is only allowed on your private network"
  });
  assert.equal(tv.appList().length, 1, "refused URL was not installed");

  r = await call("GET", `/api/tiles?host=${host}`);
  assert.deepEqual(
    r.json.tiles.map((t) => t.appId),
    ["nuvio"]
  );

  r = await call("POST", "/api/launch", { host, appId: "nuvio" });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(tv.launches.length, 1);
  assert.equal(tv.launches[0].appId, "nuvio");

  r = await call("DELETE", "/api/tiles", { host, appId: "nuvio" });
  assert.deepEqual(r.json, { ok: true, removed: true });
  assert.equal(tv.appList().length, 0);

  // Errors reach the client instead of an empty list.
  r = await call("GET", "/api/tiles?host=192.0.2.1");
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no paired TV at 192\.0\.2\.1/);

  await tv.stop();
  r = await call("GET", `/api/tiles?host=${host}`);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "TV not reachable.");

  await dash.close();
} else {
  console.log("web tests: fake-TV part skipped (no openssl)");
}

console.log("web tests passed");
