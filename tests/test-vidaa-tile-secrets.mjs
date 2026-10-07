import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "vidaa-secrets-"));
process.env.NUVIO_VIDAA_HOME = home;
const { requireComplete, loadSecrets } = await import("../tools/vidaa-tile/secrets.mjs");
const store = await import("../tools/vidaa-tile/store.mjs");

// Fresh home: everything is missing.
let need = requireComplete();
assert.equal(need.needApk, true);
assert.equal(need.needPassphrase, true);
assert.equal(need.needConstants, true);
assert.throws(() => loadSecrets(), /missing:/);

// Fill in secrets + keystore and it loads, with XOR_MASK as BigInt.
store.writeFileAtomic(
  "secrets.json",
  JSON.stringify({
    keystorePassphrase: "pw",
    constants: {
      PATTERN: "p",
      VALUE_SUFFIX: "s",
      XOR_MASK: "389",
      BRAND: "his",
      OPERATION: "op_001"
    }
  })
);
store.writeBinaryAtomic("client.p12", Buffer.from("PFX"));

need = requireComplete();
assert.equal(need.needApk, false);
assert.equal(need.needPassphrase, false);
assert.equal(need.needConstants, false);

const sec = loadSecrets();
assert.equal(sec.passphrase, "pw");
assert.equal(sec.constants.XOR_MASK, 389n);
assert.equal(sec.pfx.toString(), "PFX");

// A corrupt secrets.json is reported, not swallowed.
writeFileSync(store.secretsPath(), "{ nope");
assert.throws(() => loadSecrets(), /corrupt/i);

console.log("secrets tests passed");
