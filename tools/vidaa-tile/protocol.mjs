// Pure protocol functions for talking to a Hisense VIDAA TV.
//
// No I/O and no secrets live here: the caller passes in the protocol
// `constants` (loaded from the user-local secrets file) and the TV clock.
// Reference for the wire format: Empi9245/Sidee (core/protocol.py).

import { createHash, randomBytes } from "node:crypto";

export const CONSTANT_KEYS = ["PATTERN", "VALUE_SUFFIX", "XOR_MASK", "BRAND", "OPERATION"];
// Extra firmware constants for the older authentication profiles. Optional:
// without them only the "modern" profile is available.
export const OPTIONAL_CONSTANT_KEYS = ["STANDARD_SUFFIX", "STATIC_USERNAME", "STATIC_PASSWORD"];

// The credential variants VIDAA firmware accepts (same set and order as Sidee
// 0.1.4+). "static" is a fixed identity without tokens; "middle" and
// "remotenow" use the standard value suffix, "remotenow" without the XOR mask.
export const AUTH_PROFILES = ["modern", "static", "middle", "remotenow"];

const PROFILE_NEEDS = {
  modern: [],
  static: ["STATIC_USERNAME", "STATIC_PASSWORD"],
  middle: ["STANDARD_SUFFIX"],
  remotenow: ["STANDARD_SUFFIX"]
};

export function availableAuthProfiles(constants = {}) {
  return AUTH_PROFILES.filter((profile) => PROFILE_NEEDS[profile].every((key) => constants[key]));
}

const md5Upper = (s) => createHash("md5").update(s, "utf8").digest("hex").toUpperCase();

export function newDeviceId() {
  const b = randomBytes(6);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join(":");
}

// `brand` is what the TV declares in its UPnP descriptor (his = Hisense,
// tos = Toshiba-licensed firmware); the official app feeds it into the same
// algorithm. It defaults to the BRAND constant.
export function sessionCredentials({
  deviceId,
  tvTimestamp,
  token = null,
  constants,
  authProfile = "modern",
  brand = null
}) {
  if (!AUTH_PROFILES.includes(authProfile)) throw new Error(`unknown auth profile ${authProfile}`);
  const missing = PROFILE_NEEDS[authProfile].filter((key) => !constants[key]);
  if (missing.length) throw new Error(`auth profile ${authProfile} needs ${missing.join(", ")}`);
  const { PATTERN, VALUE_SUFFIX, XOR_MASK, OPERATION } = constants;
  const BRAND = brand || constants.BRAND;
  const clean = String(deviceId).replace(/-/g, ":").toLowerCase();
  const race = md5Upper(`${PATTERN}$${clean}`).slice(0, 6);
  const clientId = `${clean}$${BRAND}$${race}_${OPERATION}`;
  if (authProfile === "static") {
    return {
      clientId,
      username: constants.STATIC_USERNAME,
      password: token !== null ? token : constants.STATIC_PASSWORD
    };
  }
  const mask = typeof XOR_MASK === "bigint" ? XOR_MASK : BigInt(XOR_MASK);
  const stamp = authProfile === "remotenow" ? BigInt(tvTimestamp) : BigInt(tvTimestamp) ^ mask;
  const username = `${BRAND}$${stamp}`;
  if (token !== null) return { clientId, username, password: token };
  const digit =
    String(tvTimestamp)
      .split("")
      .reduce((a, d) => a + Number(d), 0) % 10;
  const suffix = authProfile === "modern" ? VALUE_SUFFIX : constants.STANDARD_SUFFIX;
  const valueMd5 = md5Upper(`${BRAND}${digit}${suffix}`).slice(0, 6);
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
