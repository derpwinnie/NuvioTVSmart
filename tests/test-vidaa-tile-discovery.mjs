import assert from "node:assert/strict";
import {
  parseDescriptor,
  readDateHeader,
  _classifyReply,
  _descriptorTargets,
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

console.log("discovery helper tests passed");
