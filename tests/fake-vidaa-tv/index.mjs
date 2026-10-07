// A fake VIDAA TV for tests. It speaks the real wire protocol so the session
// code is exercised for real: a TLS MQTT broker that checks credentials the
// same way the TV does, drives the PIN handshake, issues tokens and manages a
// launcher app list. It also serves a UPnP descriptor (with a Date header) and
// can answer SSDP, for the discovery tests.

import tls from "node:tls";
import http from "node:http";
import dgram from "node:dgram";
import Aedes from "aedes";
import { sessionCredentials, tvTopics, parseToken } from "../../tools/vidaa-tile/protocol.mjs";
import { makeTestCerts, haveOpenssl } from "./make-test-certs.mjs";

export { haveOpenssl };

export async function startFakeTv({ constants, pin = "4321", behavior = "ok" } = {}) {
  const certs = makeTestCerts();
  const timestamp = 1759800000; // fixed TV clock, mirrored in the Date header
  const state = { behavior, pin: String(pin), appList: [], tokens: new Set() };
  const setBehavior = (b) => (state.behavior = b);

  const expectedFor = (clientId) => {
    const deviceId = clientId.split("$")[0];
    return sessionCredentials({ deviceId, tvTimestamp: timestamp, constants });
  };

  const broker = new Aedes({
    authenticate(client, username, password, cb) {
      if (state.behavior === "expiredRefresh") {
        const err = new Error("not authorized");
        err.returnCode = 5;
        return cb(err, false);
      }
      const pass = password ? password.toString("utf8") : "";
      if (state.tokens.has(pass)) return cb(null, true); // token-based reconnect
      const exp = expectedFor(client.id);
      const ok = username === exp.username && pass === exp.password;
      if (ok) return cb(null, true);
      const err = new Error("bad credentials");
      err.returnCode = 4;
      return cb(err, false);
    }
  });

  broker.on("publish", (packet, client) => {
    if (!client) return; // broker's own republishes
    const topic = packet.topic;
    const payload = packet.payload ? packet.payload.toString("utf8") : "";
    const t = tvTopics(client.id);
    const send = (replyTopic, obj) =>
      broker.publish({ topic: replyTopic, payload: JSON.stringify(obj), qos: 0 }, () => {});

    if (topic === t.ui + "actions/vidaa_app_connect") {
      send(t.authReply, { ok: true });
    } else if (topic === t.ui + "actions/authenticationcode") {
      let num = null;
      try {
        num = JSON.parse(payload).authNum;
      } catch {
        /* ignore */
      }
      const good = state.behavior !== "wrongPin" && String(num) === state.pin;
      send(t.authCodeReply, { result: good ? 1 : 0 });
    } else if (topic === t.platform + "data/gettoken") {
      if (state.behavior === "noTokenAfterPin") return;
      const token = "tok-" + Math.random().toString(36).slice(2);
      const refresh = "ref-" + Math.random().toString(36).slice(2);
      state.tokens.add(token);
      state.tokens.add(refresh);
      send(t.tokenReply, {
        accesstoken: token,
        refreshtoken: refresh,
        accesstoken_time: timestamp,
        refreshtoken_time: timestamp,
        accesstoken_duration_day: 2,
        refreshtoken_duration_day: 30
      });
    } else if (topic === t.ui + "actions/uievent") {
      try {
        const info = JSON.parse(payload).app_info;
        if (state.behavior !== "installNoConfirm" && info) {
          state.appList = state.appList.filter((a) => a.appId !== info.Id);
          state.appList.push({ appId: info.Id, name: info.Title, url: info.URL, appUrl: info.URL });
        }
      } catch {
        /* ignore */
      }
    } else if (topic === t.ui + "actions/applist") {
      broker.publish(
        { topic: t.applistReply, payload: JSON.stringify(state.appList), qos: 0 },
        () => {}
      );
    } else if (topic === t.ui + "actions/removeapp") {
      let id = null;
      try {
        id = JSON.parse(payload).appId;
      } catch {
        /* ignore */
      }
      state.appList = state.appList.filter((a) => a.appId !== id);
    }
  });

  // TLS MQTT broker
  const mqttServer = tls.createServer(
    { key: certs.serverKey, cert: certs.serverCert },
    broker.handle
  );
  await new Promise((r) => mqttServer.listen(0, "127.0.0.1", r));
  const port = mqttServer.address().port;

  // UPnP descriptor server with a deterministic Date header
  const descServer = http.createServer((req, res) => {
    res.setHeader("Date", new Date(timestamp * 1000).toUTCString());
    res.setHeader("Content-Type", "text/xml");
    res.end(
      `<root><device><friendlyName>Fake VIDAA</friendlyName>` +
        `<modelDescription>vidaa_support;transport_protocol</modelDescription></device></root>`
    );
  });
  await new Promise((r) => descServer.listen(0, "127.0.0.1", r));
  const descriptorPort = descServer.address().port;

  // Optional SSDP responder (used by the discovery test)
  let ssdp;
  function startSsdp() {
    ssdp = dgram.createSocket({ type: "udp4", reuseAddr: true });
    ssdp.bind(1900, () => {
      try {
        ssdp.addMembership("239.255.255.250");
      } catch {
        /* ignore */
      }
    });
    ssdp.on("message", (msg, rinfo) => {
      if (!/M-SEARCH/.test(msg.toString())) return;
      const reply = Buffer.from(
        [
          "HTTP/1.1 200 OK",
          `LOCATION: http://127.0.0.1:${descriptorPort}/desc.xml`,
          "ST: urn:schemas-upnp-org:device:MediaRenderer:1",
          "",
          ""
        ].join("\r\n")
      );
      ssdp.send(reply, rinfo.port, rinfo.address, () => {});
    });
  }

  async function stop() {
    if (ssdp) await new Promise((r) => ssdp.close(r));
    await new Promise((r) => descServer.close(r));
    await new Promise((r) => mqttServer.close(r));
    await new Promise((r) => broker.close(r));
  }

  return {
    host: "127.0.0.1",
    port,
    descriptorPort,
    ca: certs.ca,
    clientPfx: certs.clientPfx,
    clientPass: certs.clientPass,
    timestamp,
    setBehavior,
    startSsdp,
    stop,
    _parseToken: parseToken
  };
}
