// End-to-end SSDP discovery against the fake TV. The responder listens on an
// ephemeral loopback port and discover() is pointed at it, so the test does
// not depend on multicast or broadcast working here and can genuinely fail.
import assert from "node:assert/strict";
import dgram from "node:dgram";
import { haveOpenssl, startFakeTv } from "./fake-vidaa-tv/index.mjs";
import { discover } from "../tools/vidaa-tile/discovery.mjs";

if (!haveOpenssl()) {
  console.log("discovery e2e skipped (no openssl)");
  process.exit(0);
}

const tv = await startFakeTv({
  constants: { PATTERN: "p", VALUE_SUFFIX: "s", XOR_MASK: 1n, BRAND: "his", OPERATION: "op" }
});
const ssdpPort = await tv.startSsdp({ port: 0, address: "127.0.0.1" });

const found = await discover({ timeoutMs: 1000, targets: ["127.0.0.1"], ssdpPort });
assert.equal(found.length, 1, "the fake TV answered and was recognised");
assert.equal(found[0].host, "127.0.0.1");
assert.equal(found[0].friendlyName, "Fake VIDAA");
assert.equal(found[0].isVidaa, true);
await tv.stop();

// A port where nothing answers finds nothing.
const silent = dgram.createSocket("udp4");
await new Promise((r) => silent.bind(0, "127.0.0.1", r));
const none = await discover({
  timeoutMs: 300,
  targets: ["127.0.0.1"],
  ssdpPort: silent.address().port
});
silent.close();
assert.deepEqual(none, []);

console.log("discovery e2e passed");
