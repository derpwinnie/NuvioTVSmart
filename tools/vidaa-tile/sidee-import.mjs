// One-click setup: take the TV client certificate and protocol constants from
// Sidee (https://github.com/Empi9245/Sidee, MIT) instead of making the user
// dig them out of the VIDAA app.
//
// This repo still ships no Hisense material. On request, the tool downloads
// two files from ONE pinned Sidee commit, checks their SHA-256, decodes them
// locally and stores the result in the user's config dir like the APK route.
// A changed upstream file never gets used silently: the hash check fails and
// the user is told to update the tool or use the APK route.

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { writeFileAtomic, secretsPath } from "./store.mjs";
import { CONSTANT_KEYS } from "./protocol.mjs";

// v0.1.4.2 + docs (2026-10-21): adds the older auth profiles and the TV brand.
export const SIDEE_COMMIT = "36095890dbf27e3daf1cf9c461bc62f8e7cad175";
const RAW = `https://raw.githubusercontent.com/Empi9245/Sidee/${SIDEE_COMMIT}/`;

export const SIDEE_FILES = {
  bundle: {
    path: "core/tv-client.bundle",
    sha256: "955e90447fd7da7680ddcbbf1cc72807f7eaa065f14ff59d057d76811dad6d5c"
  },
  protocol: {
    path: "core/protocol.py",
    sha256: "fe5ebcf173e91388baca59555bb1b316c91c1e7c26a2e0542ab8d4e96babdc95"
  }
};

// Python's base64.b85decode (RFC 1924 alphabet, no padding chars in input).
const B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
const B85_INDEX = new Map([...B85].map((c, i) => [c, i]));

export function b85decode(text) {
  const s = String(text).replace(/\s+/g, "");
  const pad = (5 - (s.length % 5)) % 5;
  const full = s + "~".repeat(pad);
  const out = Buffer.alloc((full.length / 5) * 4);
  for (let i = 0, o = 0; i < full.length; i += 5, o += 4) {
    let acc = 0;
    for (let j = 0; j < 5; j++) {
      const v = B85_INDEX.get(full[i + j]);
      if (v === undefined) throw new Error(`bad base85 character ${JSON.stringify(full[i + j])}`);
      acc = acc * 85 + v;
    }
    if (acc > 0xffffffff) throw new Error("base85 overflow");
    out.writeUInt32BE(acc, o);
  }
  return out.subarray(0, out.length - pad);
}

const xor = (buf, key) => Buffer.from(buf.map((b, i) => b ^ key[i % key.length]));

// tv-client.bundle = base85(xor(zlib(PEM cert + PEM key), "k3"))
export function decodeBundle(text) {
  const pem = inflateSync(xor(b85decode(text), Buffer.from("k3"))).toString("utf8");
  const end = "-----END CERTIFICATE-----";
  const i = pem.indexOf(end);
  if (i < 0 || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    throw new Error("Sidee bundle did not contain a certificate and key");
  }
  return {
    cert: pem.slice(0, i + end.length).trim() + "\n",
    key: pem.slice(i + end.length).trim() + "\n"
  };
}

// protocol.py stores PATTERN, VALUE_SUFFIX and XOR_MASK as base85+xor strings
// in `_C` with key `_K`; BRAND and OPERATION are plain literals. Newer versions
// add STANDARD_SUFFIX (same encoding) and the static identity as literals in
// session_credentials; both are optional and enable the older auth profiles.
export function decodeProtocol(source) {
  const key = /_K\s*=\s*b"([^"]+)"/.exec(source);
  const list = /_C\s*=\s*\[([\s\S]*?)\]/.exec(source);
  const brand = /BRAND\s*=\s*"([^"]+)"/.exec(source);
  const op = /OPERATION\s*=\s*"([^"]+)"/.exec(source);
  if (!key || !list || !brand || !op) throw new Error("unexpected Sidee protocol.py layout");
  const items = [...list[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (items.length < 3) throw new Error("unexpected Sidee protocol.py layout");
  const k = Buffer.from(key[1], "latin1");
  const dec = (s) => xor(b85decode(s), k);
  const mask = dec(items[2]);
  const constants = {
    PATTERN: dec(items[0]).toString("ascii"),
    VALUE_SUFFIX: dec(items[1]).toString("ascii"),
    XOR_MASK: BigInt("0x" + (mask.toString("hex") || "0")).toString(),
    BRAND: brand[1],
    OPERATION: op[1]
  };
  const standard = /STANDARD_SUFFIX\s*=\s*_deco\("([^"]+)",\s*_K\)/.exec(source);
  if (standard) constants.STANDARD_SUFFIX = dec(standard[1]).toString("ascii");
  const fixed = /return client_id, "([^"]+)", token if token is not None else "([^"]+)"/.exec(
    source
  );
  if (fixed) {
    constants.STATIC_USERNAME = fixed[1];
    constants.STATIC_PASSWORD = fixed[2];
  }
  return constants;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function fetchPinned({ path, sha256: want }, fetchImpl) {
  const res = await fetchImpl(RAW + path);
  if (!res.ok) throw new Error(`download of Sidee ${path} failed (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== want) {
    throw new Error(
      `Sidee ${path} does not match the pinned version; update this tool or use the APK route`
    );
  }
  return buf.toString("utf8");
}

// Download, verify, decode and store. Returns which pieces were written.
export async function importFromSidee({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("this Node.js has no fetch(); use Node 18+");
  const [bundleText, protocolText] = await Promise.all([
    fetchPinned(SIDEE_FILES.bundle, fetchImpl),
    fetchPinned(SIDEE_FILES.protocol, fetchImpl)
  ]);
  return storeSideeMaterial({ bundleText, protocolText });
}

export function storeSideeMaterial({ bundleText, protocolText }) {
  const { cert, key } = decodeBundle(bundleText);
  const constants = decodeProtocol(protocolText);
  for (const k of CONSTANT_KEYS) if (!constants[k]) throw new Error(`Sidee constant ${k} empty`);

  let current = {};
  if (existsSync(secretsPath())) {
    try {
      current = JSON.parse(readFileSync(secretsPath(), "utf8"));
    } catch {
      current = {};
    }
  }
  writeFileAtomic("client.pem", cert + key);
  current.constants = constants;
  current.source = { sidee: SIDEE_COMMIT };
  writeFileAtomic("secrets.json", JSON.stringify(current, null, 2));
  return { ok: true, commit: SIDEE_COMMIT };
}
