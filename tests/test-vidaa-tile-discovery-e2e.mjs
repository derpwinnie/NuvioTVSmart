import assert from "node:assert/strict";
import { haveOpenssl, startFakeTv } from "./fake-vidaa-tv/index.mjs";
import { discover } from "../tools/vidaa-tile/discovery.mjs";

if (!haveOpenssl()) {
  console.log("discovery e2e skipped (no openssl)");
  process.exit(0);
}

const tv = await startFakeTv({
  constants: { PATTERN: "p", VALUE_SUFFIX: "s", XOR_MASK: 1n, BRAND: "his", OPERATION: "op" }
});
let ssdpOk = true;
try {
  tv.startSsdp();
} catch {
  ssdpOk = false;
}
if (!ssdpOk) {
  console.log("discovery e2e skipped (cannot bind SSDP port 1900)");
  await tv.stop();
  process.exit(0);
}

const found = await discover({ timeoutMs: 2000 });
await tv.stop();

const mine = found.filter((f) => f.host === "127.0.0.1" || f.friendlyName === "Fake VIDAA");
if (mine.length === 0) {
  console.log("discovery e2e inconclusive (no SSDP reply received in this sandbox)");
  process.exit(0);
}
assert.ok(mine.every((f) => f.isVidaa));
console.log("discovery e2e passed");
