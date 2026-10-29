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

// Older auth profiles and the TV-declared brand. Vectors from a transcription of
// Sidee's session_credentials (core/protocol.py), same synthetic constants.
const allConstants = {
  ...constants,
  STANDARD_SUFFIX: "test-standard",
  STATIC_USERNAME: "STATIC-USER",
  STATIC_PASSWORD: "STATIC-PASS"
};
const vectors = {
  "modern/his": [
    "aa:bb:cc:dd:ee:ff$his$E37BF1_vidaacommon_001",
    "his$387398381722",
    "B9A25664C5EECB2E3226B73666AF9B5A"
  ],
  "modern/tos": [
    "aa:bb:cc:dd:ee:ff$tos$E37BF1_vidaacommon_001",
    "tos$387398381722",
    "A36262570F7B661BD7C6A8EC03023ACE"
  ],
  "static/his": ["aa:bb:cc:dd:ee:ff$his$E37BF1_vidaacommon_001", "STATIC-USER", "STATIC-PASS"],
  "static/tos": ["aa:bb:cc:dd:ee:ff$tos$E37BF1_vidaacommon_001", "STATIC-USER", "STATIC-PASS"],
  "middle/his": [
    "aa:bb:cc:dd:ee:ff$his$E37BF1_vidaacommon_001",
    "his$387398381722",
    "C2297EC60470D190D1699D602CD62134"
  ],
  "middle/tos": [
    "aa:bb:cc:dd:ee:ff$tos$E37BF1_vidaacommon_001",
    "tos$387398381722",
    "8425D4055835C5C008BEBCF954AD9D7C"
  ],
  "remotenow/his": [
    "aa:bb:cc:dd:ee:ff$his$E37BF1_vidaacommon_001",
    "his$1759800000",
    "C2297EC60470D190D1699D602CD62134"
  ],
  "remotenow/tos": [
    "aa:bb:cc:dd:ee:ff$tos$E37BF1_vidaacommon_001",
    "tos$1759800000",
    "8425D4055835C5C008BEBCF954AD9D7C"
  ]
};
for (const [key, [clientId, username, password]] of Object.entries(vectors)) {
  const [authProfile, brand] = key.split("/");
  const c = protocol.sessionCredentials({
    deviceId,
    tvTimestamp,
    constants: allConstants,
    authProfile,
    brand
  });
  assert.deepEqual([c.clientId, c.username, c.password], [clientId, username, password], key);
}
assert.equal(
  protocol.sessionCredentials({
    deviceId,
    tvTimestamp,
    token: "T",
    constants: allConstants,
    authProfile: "static"
  }).password,
  "T"
);
assert.deepEqual(
  protocol.availableAuthProfiles(constants),
  ["modern"],
  "APK-route constants only allow modern"
);
assert.deepEqual(protocol.availableAuthProfiles(allConstants), [
  "modern",
  "static",
  "middle",
  "remotenow"
]);
assert.throws(
  () => protocol.sessionCredentials({ deviceId, tvTimestamp, constants, authProfile: "static" }),
  /needs/
);

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
