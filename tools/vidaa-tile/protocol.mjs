// Pure protocol functions for talking to a Hisense VIDAA TV.
//
// No I/O and no secrets live here: the caller passes in the protocol
// `constants` (loaded from the user-local secrets file) and the TV clock.
// Reference for the wire format: Empi9245/Sidee (core/protocol.py).

import { createHash, randomBytes } from "node:crypto";

export const CONSTANT_KEYS = ["PATTERN", "VALUE_SUFFIX", "XOR_MASK", "BRAND", "OPERATION"];

const md5Upper = (s) => createHash("md5").update(s, "utf8").digest("hex").toUpperCase();

export function newDeviceId() {
  const b = randomBytes(6);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(":");
}

export function sessionCredentials({ deviceId, tvTimestamp, token = null, constants }) {
  const { PATTERN, VALUE_SUFFIX, XOR_MASK, BRAND, OPERATION } = constants;
  const clean = String(deviceId).replace(/-/g, ":").toLowerCase();
  const race = md5Upper(`${PATTERN}$${clean}`).slice(0, 6);
  const clientId = `${clean}$${BRAND}$${race}_${OPERATION}`;
  const mask = typeof XOR_MASK === "bigint" ? XOR_MASK : BigInt(XOR_MASK);
  const username = `${BRAND}$${BigInt(tvTimestamp) ^ mask}`;
  if (token !== null) return { clientId, username, password: token };
  const digit =
    String(tvTimestamp)
      .split("")
      .reduce((a, d) => a + Number(d), 0) % 10;
  const valueMd5 = md5Upper(`${BRAND}${digit}${VALUE_SUFFIX}`).slice(0, 6);
  return { clientId, username, password: md5Upper(`${tvTimestamp}$${valueMd5}`) };
}

export function tvTopics(clientId) {
  const mob = `/remoteapp/mobile/${clientId}/`;
  return {
    ui: `/remoteapp/tv/ui_service/${clientId}/`,
    platform: `/remoteapp/tv/platform_service/${clientId}/`,
    mobile: mob,
    broadcast: "/remoteapp/mobile/broadcast/",
    applistReply: mob + "ui_service/data/applist",
    tokenReply: mob + "platform_service/data/tokenissuance",
    authReply: mob + "ui_service/data/authentication",
    authCodeReply: mob + "ui_service/data/authenticationcode"
  };
}

export const connectPayload = () =>
  JSON.stringify({ app_version: 2, connect_result: 0, device_type: "Mobile App" });

export const pinPayload = (pin) => JSON.stringify({ authNum: Number(pin) });

export const tokenRequestPayload = (refreshToken) =>
  JSON.stringify({ refreshtoken: refreshToken || "" });

export const installPayload = ({ appId, name, url, image = "" }) =>
  JSON.stringify({
    type: "app_install",
    app_info: {
      Title: name,
      StoreType: 99,
      mediaId: appId,
      Id: appId,
      Image: image,
      URL: url,
      configUrlDownload: 0,
      configUrl: ""
    }
  });

export const launchPayload = ({ appId, name, url }) =>
  JSON.stringify({ appId, name, url, urlType: 37, appName: name, appUrl: url });

const parseJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export const parseToken = (s) => {
  const d = parseJson(s);
  return d && typeof d === "object" && "accesstoken" in d ? d : null;
};

export const parseAppList = (s) => {
  const d = parseJson(s);
  return Array.isArray(d) ? d : null;
};
