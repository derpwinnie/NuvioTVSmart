import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = { ...process.env, NUVIO_VIDAA_HOME: mkdtempSync(join(tmpdir(), "vidaa-cli-")) };
const cli = (args) =>
  execFileSync("node", ["tools/vidaa-tile/cli.mjs", ...args], { env, encoding: "utf8" });

// --help prints the command list.
assert.match(cli(["--help"]), /import-apk/);
assert.match(cli(["--help"]), /pair <host>/);

// status reports everything missing on a fresh home.
const status = JSON.parse(cli(["status"]));
assert.equal(status.needApk, true);
assert.equal(status.needPassphrase, true);
assert.equal(status.needConstants, true);

// unknown command exits non-zero.
let code = 0;
try {
  execFileSync("node", ["tools/vidaa-tile/cli.mjs", "nope"], { env, stdio: "ignore" });
} catch (e) {
  code = e.status;
}
assert.equal(code, 2);

// TV commands without a host fail with a clear message instead of trying
// localhost.
for (const cmd of ["pair", "list", "install", "launch", "remove"]) {
  const r = spawnSync("node", ["tools/vidaa-tile/cli.mjs", cmd], { env, encoding: "utf8" });
  assert.equal(r.status, 2, `${cmd} without host exits 2`);
  assert.match(r.stderr, new RegExp(`${cmd} needs the TV's address`));
}

console.log("cli tests passed");
