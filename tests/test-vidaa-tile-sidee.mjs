// One-click Sidee import: decoding, hash pinning and storage. Uses synthetic
// fixtures only; no Hisense material is part of this test.
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "vidaa-sidee-"));
process.env.NUVIO_VIDAA_HOME = home;
const sidee = await import("../tools/vidaa-tile/sidee-import.mjs");
const { requireComplete, loadSecrets } = await import("../tools/vidaa-tile/secrets.mjs");

// Encoders mirroring Python's base64.b85encode and Sidee's bundle format.
const B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
function b85encode(buf) {
  const pad = (4 - (buf.length % 4)) % 4;
  const full = Buffer.concat([buf, Buffer.alloc(pad)]);
  let out = "";
  for (let i = 0; i < full.length; i += 4) {
    let n = full.readUInt32BE(i);
    let chunk = "";
    for (let j = 0; j < 5; j++) {
      chunk = B85[n % 85] + chunk;
      n = Math.floor(n / 85);
    }
    out += chunk;
  }
  return out.slice(0, out.length - pad);
}
const xor = (buf, key) => Buffer.from(buf.map((b, i) => b ^ key[i % key.length]));

// b85 round-trips for every padding length.
for (const s of ["", "a", "ab", "abc", "abcd", "hello world!"]) {
  assert.equal(sidee.b85decode(b85encode(Buffer.from(s))).toString(), s);
}
assert.throws(() => sidee.b85decode("ab\"cd"), /bad base85/);

const CERT = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
const KEY = "-----BEGIN PRIVATE KEY-----\nBBBB\n-----END PRIVATE KEY-----";
const bundleText = b85encode(xor(deflateSync(Buffer.from(CERT + "\n" + KEY + "\n")), Buffer.from("k3")));

const decoded = sidee.decodeBundle(bundleText);
assert.equal(decoded.cert, CERT + "\n");
assert.equal(decoded.key, KEY + "\n");
assert.throws(
  () => sidee.decodeBundle(b85encode(xor(deflateSync(Buffer.from("nope")), Buffer.from("k3")))),
  /certificate and key/
);

const K = Buffer.from("v1tile");
const enc = (buf) => b85encode(xor(buf, K));
const protocolText = `
_K = b"v1tile"
_C = [
    "${enc(Buffer.from("pattern-x"))}",
    "${enc(Buffer.from("suffix-y"))}",
    "${enc(Buffer.from([0x01, 0x02, 0x03]))}",
]
BRAND = "his"
OPERATION = "op_001"
`;
assert.deepEqual(sidee.decodeProtocol(protocolText), {
  PATTERN: "pattern-x",
  VALUE_SUFFIX: "suffix-y",
  XOR_MASK: String(0x010203),
  BRAND: "his",
  OPERATION: "op_001"
});
assert.throws(() => sidee.decodeProtocol("nothing here"), /layout/);

// A download that does not match the pinned hash is refused and stores nothing.
const fakeFetch = (bodies) => async (url) => {
  const name = Object.keys(bodies).find((p) => url.endsWith(p));
  assert.ok(url.includes(sidee.SIDEE_COMMIT), "downloads must use the pinned commit");
  return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(bodies[name]) };
};
await assert.rejects(
  sidee.importFromSidee({
    fetchImpl: fakeFetch({ "core/tv-client.bundle": bundleText, "core/protocol.py": protocolText })
  }),
  /does not match the pinned version/
);
assert.equal(existsSync(join(home, "client.pem")), false);

await assert.rejects(
  sidee.importFromSidee({ fetchImpl: async () => ({ ok: false, status: 404 }) }),
  /HTTP 404/
);

// The pinned hashes are well-formed.
for (const f of Object.values(sidee.SIDEE_FILES)) assert.match(f.sha256, /^[0-9a-f]{64}$/);
assert.equal(createHash("sha256").update("").digest("hex").length, 64);

// Storing makes setup complete without APK or passphrase, and loadSecrets
// hands the PEM to the TLS layer instead of a PKCS#12.
let need = requireComplete();
assert.equal(need.ready, false);
sidee.storeSideeMaterial({ bundleText, protocolText });
need = requireComplete();
assert.equal(need.ready, true);
assert.equal(need.needApk, false);
assert.equal(need.needPassphrase, false);
assert.equal(need.source, "sidee");
const s = loadSecrets();
assert.equal(s.pfx, undefined);
assert.ok(s.cert.includes("BEGIN CERTIFICATE") && s.key.includes("PRIVATE KEY"));
assert.equal(s.constants.XOR_MASK, 0x010203n);
assert.equal(JSON.parse(readFileSync(join(home, "secrets.json"), "utf8")).source.sidee, sidee.SIDEE_COMMIT);

console.log("vidaa-tile sidee import: ok");
