import assert from "node:assert/strict";
import { validateTileUrl, withVidaaWrapper } from "../tools/vidaa-tile/urls.mjs";

assert.equal(validateTileUrl("https://nuvio.example/").ok, true);
assert.equal(validateTileUrl("http://192.168.1.5:4173/").ok, true); // private LAN http
assert.equal(validateTileUrl("http://100.64.1.2:4173/").ok, true); // Tailscale CGNAT
assert.equal(validateTileUrl("http://example.com/").ok, false); // public http
assert.equal(validateTileUrl("http://localhost/").ok, false); // loopback
assert.equal(validateTileUrl("https://user:pw@x/").ok, false); // credentials
assert.equal(validateTileUrl("ftp://x/").ok, false); // scheme
assert.equal(validateTileUrl("not a url").ok, false);
assert.equal(withVidaaWrapper("https://x/"), "https://x/?wrapper=vidaa");
assert.equal(withVidaaWrapper("https://x/?wrapper=vidaa"), "https://x/?wrapper=vidaa");

console.log("url tests passed");
