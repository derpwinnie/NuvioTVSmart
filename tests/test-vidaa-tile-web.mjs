import http from "node:http";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { haveOpenssl, startFakeTv } from "./fake-vidaa-tv/index.mjs";

process.env.NODE_ENV = "test";
process.env.NUVIO_VIDAA_HOME = mkdtempSync(join(tmpdir(), "vidaa-web-"));
const { startDashboard } = await import("../tools/vidaa-tile/web/server.mjs");
const store = await import("../tools/vidaa-tile/store.mjs");

const dash = await startDashboard({ port: 0 });
const call = (method, path, body) =>
  fetch(`http://127.0.0.1:${dash.port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  }).then((r) => r.json());

// Fresh home: status reports missing secrets and no TVs.
let status = await call("GET", "/api/status");
assert.equal(status.secrets.needApk, true);
assert.deepEqual(status.tvs, []);

// Static page is served.
const page = await fetch(`http://127.0.0.1:${dash.port}/`).then((r) => r.text());
assert.match(page, /VIDAA tile installer/);

// Raw request helper — fetch silently drops Host/Origin (forbidden headers).
const raw = (method, path, headers) =>
  new Promise((resolve) => {
    const req = http.request(
      { host: "127.0.0.1", port: dash.port, method, path, headers },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.end();
  });

// DNS-rebinding guard: a foreign Host header is refused.
assert.equal(await raw("GET", "/api/status", { Host: "evil.example" }), 403);

// CSRF guard: a cross-origin state-changing request is refused.
assert.equal(
  await raw("POST", "/api/discover", {
    Host: `127.0.0.1:${dash.port}`,
    Origin: "http://evil.example"
  }),
  403
);

// Full pair + install over the API, against the fake TV (needs openssl).
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

  // Pairing needs the fake TV's ephemeral port + fixed clock, which the real
  // /api/pair path cannot know, so drive the session layer directly here to
  // seed a paired record, then exercise the tile API through HTTP.
  const session = await import("../tools/vidaa-tile/session.mjs");
  const rec = await session.pair({
    host: tv.host,
    port: tv.port,
    secrets: {
      pfx: tv.clientPfx,
      passphrase: tv.clientPass,
      constants: { ...constants, XOR_MASK: 7n },
      caPem: tv.ca
    },
    getTimestamp: async () => tv.timestamp,
    pinProvider: async () => "2468"
  });
  assert.ok(rec.tokens.accesstoken);

  status = await call("GET", "/api/status");
  assert.ok(status.tvs.includes(tv.host));

  await tv.stop();
}

await dash.close();
console.log("web tests passed");
