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

const found = await discover({
  timeoutMs: 1000,
  targets: ["127.0.0.1"],
  ssdpPort,
  notifyPort: null
});
assert.equal(found.length, 1, "the fake TV answered and was recognised");
assert.equal(found[0].host, "127.0.0.1");
assert.equal(found[0].friendlyName, "Fake VIDAA");
assert.equal(found[0].isVidaa, true);

// A TV that never answers M-SEARCH but announces itself (NOTIFY) is found too.
const quiet = dgram.createSocket("udp4");
await new Promise((r) => quiet.bind(0, "127.0.0.1", r));
const probe = dgram.createSocket("udp4");
await new Promise((r) => probe.bind(0, "127.0.0.1", r));
const notifyPort = probe.address().port;
probe.close();
const announce = setInterval(() => {
  const msg = Buffer.from(
    [
      "NOTIFY * HTTP/1.1",
      `LOCATION: http://127.0.0.1:${tv.descriptorPort}/desc.xml`,
      "NT: urn:schemas-upnp-org:device:MediaRenderer:1",
      "NTS: ssdp:alive",
      "",
      ""
    ].join("\r\n")
  );
  quiet.send(msg, notifyPort, "127.0.0.1", () => {});
}, 100);
const announced = await discover({
  timeoutMs: 800,
  targets: ["127.0.0.1"],
  ssdpPort: quiet.address().port,
  notifyPort
});
clearInterval(announce);
quiet.close();
assert.equal(announced.length, 1, "a NOTIFY-only TV is found");
assert.equal(announced[0].friendlyName, "Fake VIDAA");
await tv.stop();

// A port where nothing answers finds nothing.
const silent = dgram.createSocket("udp4");
await new Promise((r) => silent.bind(0, "127.0.0.1", r));
const none = await discover({
  timeoutMs: 300,
  targets: ["127.0.0.1"],
  ssdpPort: silent.address().port,
  notifyPort: null
});
silent.close();
assert.deepEqual(none, []);

console.log("discovery e2e passed");
