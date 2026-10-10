import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_TILE_IMAGE,
  validateTileUrl,
  withVidaaWrapper
} from "../tools/vidaa-tile/urls.mjs";

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

// The default tile icon is a square PNG that the Pages build publishes
// (assets/ is copied into dist/vidaa unchanged).
assert.equal(
  DEFAULT_TILE_IMAGE,
  "https://derpwinnie.github.io/NuvioTVSmart/assets/images/tizenIcon.png"
);
{
  const png = readFileSync(new URL("../assets/images/tizenIcon.png", import.meta.url));
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, height, "tile icon is square");
  assert.ok(width >= 512, "tile icon is large enough for the launcher");
}

console.log("url tests passed");
