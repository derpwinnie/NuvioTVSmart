import assert from "node:assert/strict";
import {
  parseDescriptor,
  readDateHeader,
  _classifyReply,
  _descriptorTargets,
  descriptorBrand,
  verifyTvHost,
  tvTimestamp
} from "../tools/vidaa-tile/discovery.mjs";

const xml = `<root><device><friendlyName>Living Room</friendlyName>
<modelDescription>vidaa_support;transport_protocol</modelDescription></device></root>`;
const d = parseDescriptor(xml);
assert.equal(d.friendlyName, "Living Room");
assert.equal(d.isVidaa, true);
assert.equal(
  parseDescriptor("<root><modelDescription>roku</modelDescription></root>").isVidaa,
  false
);
assert.equal(parseDescriptor("<x>hisense inside</x>").isVidaa, true);

// The brand the TV declares (Sidee 0.1.4.2): Toshiba-licensed firmware says tos.
assert.equal(d.brand, null, "no brand line: callers fall back to the BRAND constant");
const toshiba = parseDescriptor(
  "<root><manufacturer>TOSHIBA</manufacturer><modelDescription>vidaa_support=1\nbrand=tos\ntransport_protocol=2</modelDescription></root>"
);
assert.equal(toshiba.isVidaa, true, "VIDAA keys identify a Toshiba-branded VIDAA TV");
assert.equal(toshiba.brand, "tos");
assert.equal(descriptorBrand("brand=HIS"), "his");
assert.equal(descriptorBrand("brand=not valid!"), null);
assert.equal(descriptorBrand("x;brand=tos;y"), "tos");

assert.equal(readDateHeader({ date: "Tue, 07 Oct 2025 00:00:00 GMT" }), 1759795200);
assert.throws(() => readDateHeader({}), /did not report its clock/);

// SSDP reply classification: only 200 responses with a Location count.
assert.equal(
  _classifyReply("HTTP/1.1 200 OK\r\nLOCATION: http://1.2.3.4:18400/desc.xml\r\n\r\n"),
  "http://1.2.3.4:18400/desc.xml"
);
assert.equal(_classifyReply("HTTP/1.1 404 Not Found\r\nLOCATION: http://x/\r\n\r\n"), null);
assert.equal(_classifyReply("HTTP/1.1 200 OK\r\n\r\n"), null);
assert.equal(_classifyReply("garbage"), null);
// Announcements: only a MediaRenderer ssdp:alive counts.
const notify = (nt, nts) =>
  `NOTIFY * HTTP/1.1\r\nLOCATION: http://1.2.3.4:38400/desc.xml\r\nNT: ${nt}\r\nNTS: ${nts}\r\n\r\n`;
assert.equal(
  _classifyReply(notify("urn:schemas-upnp-org:device:MediaRenderer:1", "ssdp:alive")),
  "http://1.2.3.4:38400/desc.xml"
);
assert.equal(
  _classifyReply(notify("urn:schemas-upnp-org:device:MediaRenderer:1", "ssdp:byebye")),
  null
);
assert.equal(
  _classifyReply(notify("urn:schemas-upnp-org:device:InternetGatewayDevice:1", "ssdp:alive")),
  null
);

// SSRF guard: a Location pointing at a different host is ignored; only the
// replying host's own ports are used. A same-host Location keeps its port/path.
const cross = _descriptorTargets("1.2.3.4", "http://169.254.169.254/latest/meta-data/");
assert.ok(
  cross.every((t) => t.host === "1.2.3.4"),
  "cross-host Location must not redirect the fetch"
);
const same = _descriptorTargets("1.2.3.4", "http://1.2.3.4:18400/desc.xml");
assert.deepEqual(same, [{ host: "1.2.3.4", port: 18400, path: "/desc.xml" }]);
assert.ok(
  _descriptorTargets("1.2.3.4", "https://1.2.3.4/x").every((t) =>
    t.path.includes("rendererdevicedesc")
  )
);

// TV clock: use the TV's answer, else fall back to local time instead of
// aborting (as Sidee does).
assert.equal(await tvTimestamp("tv", { query: async () => 1759800000 }), 1759800000);
assert.equal(
  await tvTimestamp("tv", {
    query: async () => {
      throw new Error("TV did not report its clock");
    },
    now: () => 1760000000123
  }),
  1760000000
);

// Manual address check: needs a VIDAA descriptor and an open pairing port.
const net = await import("node:net");
const listener = net.createServer((s) => s.destroy());
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const openPort = listener.address().port;
const vidaaInfo = async () => ({ isVidaa: true });
assert.deepEqual(
  (await verifyTvHost("127.0.0.1", { pairingPort: openPort, describe: vidaaInfo })).ok,
  true
);
listener.close();
assert.equal(
  (await verifyTvHost("127.0.0.1", { pairingPort: openPort, describe: vidaaInfo, timeoutMs: 500 }))
    .reason,
  "port-closed"
);
assert.equal(
  (await verifyTvHost("127.0.0.1", { describe: async () => ({ isVidaa: false }) })).reason,
  "not-vidaa"
);
assert.equal(
  (
    await verifyTvHost("127.0.0.1", {
      describe: async () => {
        throw new Error("no descriptor");
      }
    })
  ).reason,
  "no-descriptor"
);

console.log("discovery helper tests passed");
