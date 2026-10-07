import assert from "node:assert/strict";
import { parseDescriptor, readDateHeader, _classifyReply } from "../tools/vidaa-tile/discovery.mjs";

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

console.log("discovery helper tests passed");
