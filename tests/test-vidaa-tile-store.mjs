import assert from "node:assert/strict";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "vidaa-store-"));
process.env.NUVIO_VIDAA_HOME = home;
const store = await import("../tools/vidaa-tile/store.mjs");

assert.deepEqual(store.readState().tvs, {}); // default when absent
store.writeState({ tvs: { "1.2.3.4": { deviceId: "x" } }, settings: {} });
assert.equal(store.readState().tvs["1.2.3.4"].deviceId, "x");

if (process.platform !== "win32") {
  const mode = statSync(store.fileInDir("state.json")).mode & 0o777;
  assert.equal(mode, 0o600, `state file mode ${mode.toString(8)}`);
}

writeFileSync(store.fileInDir("state.json"), "{ broken");
assert.throws(() => store.readState(), /could not read/i);

console.log("store tests passed");
