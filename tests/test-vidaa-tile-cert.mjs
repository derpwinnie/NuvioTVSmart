import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// Skip gracefully if the `zip` CLI is not available to build the fixture.
let haveZip = true;
try {
  execFileSync("zip", ["--version"], { stdio: "ignore" });
} catch {
  haveZip = false;
}
if (!haveZip) {
  console.log("cert tests skipped (no zip CLI to build the fixture)");
  process.exit(0);
}

const home = mkdtempSync(join(tmpdir(), "vidaa-cert-"));
process.env.NUVIO_VIDAA_HOME = home;
const work = mkdtempSync(join(tmpdir(), "vidaa-apk-"));

const raw = join(work, "res", "raw");
mkdirSync(raw, { recursive: true });
writeFileSync(join(raw, "client_mobile_android.p12"), "DUMMY-P12");
writeFileSync(join(raw, "remoteca.bks"), "DUMMY-BKS");
const apk = join(work, "fixture.apk");
execFileSync("zip", ["-qr", apk, "res"], { cwd: work });

const { extractKeystores } = await import("../tools/vidaa-tile/cert.mjs");
const out = extractKeystores(apk);
assert.ok(existsSync(out.p12Path));
assert.equal(readFileSync(out.p12Path, "utf8"), "DUMMY-P12");
assert.ok(existsSync(out.bksPath));
assert.equal(readFileSync(out.bksPath, "utf8"), "DUMMY-BKS");

// Missing entry -> clear error naming the missing file.
const bad = join(work, "bad.apk");
execFileSync("zip", ["-q", bad, "res/raw/remoteca.bks"], { cwd: work });
assert.throws(() => extractKeystores(bad), /client_mobile_android\.p12/);

console.log("cert tests passed");
