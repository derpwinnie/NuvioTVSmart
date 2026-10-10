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

// Failed pairings with the reused UUID are counted; a cancelled PIN prompt is
// not. After two failures the next pairing switches to a fresh UUID.
{
  const store = await import("../tools/vidaa-tile/store.mjs");
  const stored = () => store.readState().tvs[tv.host];
  assert.equal(stored().pairFailures, 1, "wrong PIN counted once");
  assert.equal(stored().deviceId, rec.deviceId);

  await assert.rejects(
    session.pair({ ...base, pinProvider: async () => "" }),
    (e) => e.name === "PinError" && e.cancelled === true
  );
  await assert.rejects(
    session.pair({
      ...base,
      pinProvider: async () => {
        throw new Error("cancelled by user");
      }
    }),
    (e) => e.name === "PinError" && e.cancelled === true
  );
  assert.equal(stored().pairFailures, 1, "cancel does not count");

  tv.setBehavior("wrongPin");
  await assert.rejects(session.pair({ ...base, pinProvider: async () => "0000" }));
  tv.setBehavior("ok");
  assert.equal(stored().pairFailures, 2);
  assert.equal(session.pairFailuresExceeded(stored()), true);

  // Now a fresh UUID is used; failing with it leaves the old record alone.
  tv.setBehavior("wrongPin");
  await assert.rejects(session.pair({ ...base, pinProvider: async () => "0000" }));
  tv.setBehavior("ok");
  assert.equal(stored().pairFailures, 2, "failure with a fresh UUID not counted");

  const fresh = await session.pair({ ...base, pinProvider: async () => "4321" });
  assert.notEqual(fresh.deviceId, rec.deviceId, "new UUID after two failures");
  assert.equal(stored().pairFailures, 0, "success resets the counter");
  // Reset to the original record so the tests below use `rec`.
  const st = store.readState();
  st.tvs[tv.host] = rec;
  store.writeState(st);
}

// Install a tile, confirmed via the app list.
const tile = { appId: "nuvio", name: "Nuvio", url: "https://nuvio.example/?wrapper=vidaa" };
// The real launcher pauses (8 s / 2 s / 4 s) are shrunk for the tests.
const fast = { afterInstallMs: 0, installRetryMs: 0, afterLaunchMs: 0 };
const tileOpts = (delays = fast) => ({ secrets, getTimestamp, delays });
assert.deepEqual(session.DEFAULT_DELAYS, {
  afterInstallMs: 8000,
  installRetryMs: 2000,
  afterLaunchMs: 4000
});
const apps = await session.addTile(rec, tile, tileOpts());
assert.ok(apps.some((a) => session.tileMatches(a, tile.appId, tile.url)));

// The launcher registers a tile with a lag: the pause after install covers it.
tv.setInstallDelay(150);
{
  const t0 = Date.now();
  const tile2 = { ...tile, appId: "slow1" };
  const got = await session.addTile(rec, tile2, tileOpts({ ...fast, afterInstallMs: 300 }));
  assert.ok(Date.now() - t0 >= 300, "waited after install before querying the app list");
  assert.ok(got.some((a) => session.tileMatches(a, "slow1", tile.url)));
  // ...and a missed first query is retried after installRetryMs.
  const tile3 = { ...tile, appId: "slow2" };
  const got3 = await session.addTile(rec, tile3, tileOpts({ ...fast, installRetryMs: 300 }));
  assert.ok(got3.some((a) => session.tileMatches(a, "slow2", tile.url)));
  // Without either pause the lagging tile is not confirmed.
  const tile4 = { ...tile, appId: "slow3" };
  await assert.rejects(session.addTile(rec, tile4, tileOpts()), (e) => e.name === "TimeoutError");
}
tv.setInstallDelay(0);

// List shows it, remove drops it.
const listed = await session.listTiles(rec, { secrets, getTimestamp });
assert.ok(listed.some((a) => a.appId === "nuvio"));
const removed = await session.removeTile(rec, "nuvio", { secrets, getTimestamp });
assert.equal(removed, true);

// Launch keeps the connection open for afterLaunchMs before disconnecting.
{
  const t0 = Date.now();
  await session.launchTile(rec, tile, tileOpts({ ...fast, afterLaunchMs: 300 }));
  const done = Date.now();
  assert.equal(tv.launches.length, 1);
  assert.equal(tv.launches[0].appId, "nuvio");
  assert.ok(done - tv.launches[0].at >= 250, "stayed connected after the launch request");
  assert.ok(done - t0 >= 300);
}

// Install with no confirmation -> TimeoutError.
tv.setBehavior("installNoConfirm");
await assert.rejects(session.addTile(rec, tile, tileOpts()), (e) => e.name === "TimeoutError");
tv.setBehavior("ok");

// Pin-on-first-use: without a CA, the TV cert is trusted on first pairing and
// pinned; a changed fingerprint afterwards is rejected.
{
  // Fresh state: both fake TVs share 127.0.0.1, so drop the earlier record to
  // model a genuine first-time pairing (TOFU) here.
  const store0 = await import("../tools/vidaa-tile/store.mjs");
  store0.writeState({ tvs: {}, settings: {} });
  const tv2 = await startFakeTv({ constants, pin: "1111", behavior: "ok" });
  const noCa = { pfx: tv2.clientPfx, passphrase: tv2.clientPass, constants };
  const b2 = {
    host: tv2.host,
    port: tv2.port,
    secrets: noCa,
    getTimestamp: async () => tv2.timestamp
  };
  const rec2 = await session.pair({ ...b2, pinProvider: async () => "1111" });
  assert.ok(rec2.serverFingerprint, "TOFU pinned a fingerprint");
  // Same cert still works.
  await session.listTiles(rec2, { secrets: noCa, getTimestamp: async () => tv2.timestamp });
  // Tamper the pinned fingerprint -> CertificateError.
  const tampered = { ...rec2, serverFingerprint: "AA:BB" };
  await assert.rejects(
    session.listTiles(tampered, { secrets: noCa, getTimestamp: async () => tv2.timestamp }),
    (e) => e.name === "CertificateError"
  );

  // Re-pairing a known TV also verifies the pinned fingerprint (no MITM hijack).
  const store = await import("../tools/vidaa-tile/store.mjs");
  const st = store.readState();
  st.tvs[tv2.host] = { ...rec2, serverFingerprint: "DE:AD" };
  store.writeState(st);
  await assert.rejects(
    session.pair({ ...b2, pinProvider: async () => "1111" }),
    (e) => e.name === "CertificateError"
  );
  await tv2.stop();
}

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
