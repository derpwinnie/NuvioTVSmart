import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { haveOpenssl, startFakeTv } from "./fake-vidaa-tv/index.mjs";

if (!haveOpenssl()) {
  console.log("session tests skipped (no openssl to build test certs)");
  process.exit(0);
}

process.env.NUVIO_VIDAA_HOME = mkdtempSync(join(tmpdir(), "vidaa-sess-"));
const session = await import("../tools/vidaa-tile/session.mjs");

const constants = {
  PATTERN: "p",
  VALUE_SUFFIX: "s",
  XOR_MASK: 123n,
  BRAND: "his",
  OPERATION: "op_001"
};

const tv = await startFakeTv({ constants, pin: "4321", behavior: "ok" });
const secrets = { pfx: tv.clientPfx, passphrase: tv.clientPass, constants, caPem: tv.ca };
const getTimestamp = async () => tv.timestamp;
const base = { host: tv.host, port: tv.port, secrets, getTimestamp };

// Pairing with the right PIN yields tokens.
const rec = await session.pair({ ...base, pinProvider: async () => "4321" });
assert.ok(rec.tokens.accesstoken, "got an access token");
assert.ok(rec.serverFingerprint, "captured the TV certificate fingerprint");

// Wrong PIN -> PinError.
tv.setBehavior("wrongPin");
await assert.rejects(
  session.pair({ ...base, pinProvider: async () => "0000" }),
  (e) => e.name === "PinError"
);
tv.setBehavior("ok");

// Install a tile, confirmed via the app list.
const tile = { appId: "nuvio", name: "Nuvio", url: "https://nuvio.example/?wrapper=vidaa" };
const apps = await session.addTile(rec, tile, { secrets, getTimestamp });
assert.ok(apps.some((a) => session.tileMatches(a, tile.appId, tile.url)));

// List shows it, remove drops it.
const listed = await session.listTiles(rec, { secrets, getTimestamp });
assert.ok(listed.some((a) => a.appId === "nuvio"));
const removed = await session.removeTile(rec, "nuvio", { secrets, getTimestamp });
assert.equal(removed, true);

// Install with no confirmation -> TimeoutError.
tv.setBehavior("installNoConfirm");
await assert.rejects(
  session.addTile(rec, tile, { secrets, getTimestamp }),
  (e) => e.name === "TimeoutError"
);
tv.setBehavior("ok");

// Rejected tokens (CONNACK 5) -> AuthError("rejected"), i.e. "pair again".
tv.setBehavior("expiredRefresh");
await assert.rejects(
  session.listTiles(rec, { secrets, getTimestamp }),
  (e) => e.name === "AuthError" && e.reason === "rejected"
);
tv.setBehavior("ok");

// Unreachable TV -> UnreachableError.
await tv.stop();
await assert.rejects(
  session.listTiles(rec, { secrets, getTimestamp }),
  (e) => e.name === "UnreachableError"
);

console.log("session tests passed");
