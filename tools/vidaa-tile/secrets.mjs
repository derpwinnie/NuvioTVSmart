// Load the user-local secrets the TV protocol needs.
//
// None of this ships with the repo. The user fills secrets.json once:
//   {
//     "keystorePassphrase": "...",
//     "constants": { "PATTERN": "...", "VALUE_SUFFIX": "...",
//                    "XOR_MASK": "<decimal>", "BRAND": "his",
//                    "OPERATION": "vidaacommon_001" },
//     "caPem": "-----BEGIN CERTIFICATE----- ..."   // optional
//   }
// and runs `import-apk` once to drop client.p12 / remoteca.bks next to it.
// Or, one click: `import-sidee` writes client.pem and the constants for you.

import { readFileSync, existsSync } from "node:fs";
import { CONSTANT_KEYS } from "./protocol.mjs";
import { secretsPath, fileInDir } from "./store.mjs";

function readSecretsFile() {
  if (!existsSync(secretsPath())) return {};
  try {
    return JSON.parse(readFileSync(secretsPath(), "utf8"));
  } catch {
    throw new Error("could not read secrets.json (corrupt JSON)");
  }
}

// Report which setup pieces are still missing, for the dashboard wizard.
// Two ways to provide the client certificate: client.pem (cert + key, from the
// one-click Sidee import) or client.p12 + passphrase (from your own APK).
const hasPem = () => existsSync(fileInDir("client.pem"));

export function requireComplete() {
  const s = readSecretsFile();
  const missingConstants = !s.constants || CONSTANT_KEYS.some((k) => s.constants[k] == null);
  const pem = hasPem();
  const needApk = !pem && !existsSync(fileInDir("client.p12"));
  const needPassphrase = !pem && !s.keystorePassphrase;
  return {
    needApk,
    needPassphrase,
    needConstants: missingConstants,
    ready: !needApk && !needPassphrase && !missingConstants,
    source: s.source?.sidee ? "sidee" : pem || existsSync(fileInDir("client.p12")) ? "apk" : null
  };
}

export function loadSecrets() {
  const s = readSecretsFile();
  const missing = [];
  const pem = hasPem();
  if (!pem) {
    if (!existsSync(fileInDir("client.p12"))) {
      missing.push("client certificate (run import-sidee, or import-apk)");
    }
    if (!s.keystorePassphrase) missing.push("keystorePassphrase");
  }
  if (!s.constants) missing.push("constants");
  else {
    for (const k of CONSTANT_KEYS) if (s.constants[k] == null) missing.push(`constants.${k}`);
  }
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);

  const constants = { ...s.constants, XOR_MASK: BigInt(s.constants.XOR_MASK) };
  const cert = pem ? readFileSync(fileInDir("client.pem"), "utf8") : null;
  return {
    pfx: pem ? undefined : readFileSync(fileInDir("client.p12")),
    passphrase: pem ? undefined : s.keystorePassphrase,
    cert: cert || undefined,
    key: cert || undefined,
    constants,
    caPem: s.caPem || undefined
  };
}
