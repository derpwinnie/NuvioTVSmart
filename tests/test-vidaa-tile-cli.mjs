import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

console.log("cli tests passed");
