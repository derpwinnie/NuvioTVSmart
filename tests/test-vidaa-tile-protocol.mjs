import assert from "node:assert/strict";
import * as protocol from "../tools/vidaa-tile/protocol.mjs";

// Synthetic constants — NOT Hisense values. Used only to pin the math.
const constants = {
  PATTERN: "test-pattern",
  VALUE_SUFFIX: "test-suffix",
  XOR_MASK: 0x5a5a5a5a5an,
  BRAND: "his",
  OPERATION: "vidaacommon_001"
};
const deviceId = "aa:bb:cc:dd:ee:ff";
const tvTimestamp = 1759800000;

// Pairing credentials (no token): derived from the TV clock.
const pair = protocol.sessionCredentials({ deviceId, tvTimestamp, constants });
assert.equal(pair.clientId, "aa:bb:cc:dd:ee:ff$his$E37BF1_vidaacommon_001");
assert.equal(pair.username, "his$387398381722");
assert.equal(pair.password, "B9A25664C5EECB2E3226B73666AF9B5A");

// With a token: same identity, token is the password.
const tok = protocol.sessionCredentials({ deviceId, tvTimestamp, token: "ACCESS", constants });
assert.equal(tok.clientId, pair.clientId);
assert.equal(tok.username, pair.username);
assert.equal(tok.password, "ACCESS");

// Topics hang off the client id.
const t = protocol.tvTopics(pair.clientId);
assert.equal(t.ui, `/remoteapp/tv/ui_service/${pair.clientId}/`);
assert.equal(
  t.tokenReply,
  `/remoteapp/mobile/${pair.clientId}/platform_service/data/tokenissuance`
);
assert.equal(t.applistReply, `/remoteapp/mobile/${pair.clientId}/ui_service/data/applist`);

// newDeviceId shape.
assert.match(protocol.newDeviceId(), /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);

// Payloads.
assert.deepEqual(JSON.parse(protocol.connectPayload()), {
  app_version: 2,
  connect_result: 0,
  device_type: "Mobile App"
});
assert.deepEqual(JSON.parse(protocol.pinPayload("1234")), { authNum: 1234 });
const inst = JSON.parse(
  protocol.installPayload({ appId: "nuvio", name: "Nuvio", url: "https://x/", image: "" })
);
assert.equal(inst.type, "app_install");
assert.equal(inst.app_info.StoreType, 99);
assert.equal(inst.app_info.URL, "https://x/");
assert.equal(inst.app_info.Id, "nuvio");

// Parsers.
assert.equal(protocol.parseToken('{"nope":1}'), null);
assert.deepEqual(protocol.parseToken('{"accesstoken":"a"}'), { accesstoken: "a" });
assert.equal(protocol.parseAppList("not json"), null);
assert.deepEqual(protocol.parseAppList("[]"), []);

console.log("protocol tests passed");
