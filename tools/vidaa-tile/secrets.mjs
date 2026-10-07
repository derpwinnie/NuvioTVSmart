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
export function requireComplete() {
  const s = readSecretsFile();
  const missingConstants = !s.constants || CONSTANT_KEYS.some((k) => s.constants[k] == null);
  return {
    needApk: !existsSync(fileInDir("client.p12")),
    needPassphrase: !s.keystorePassphrase,
    needConstants: missingConstants
  };
}

export function loadSecrets() {
  const s = readSecretsFile();
  const missing = [];
  if (!existsSync(fileInDir("client.p12"))) missing.push("client keystore (run import-apk)");
  if (!s.keystorePassphrase) missing.push("keystorePassphrase");
  if (!s.constants) missing.push("constants");
  else {
    for (const k of CONSTANT_KEYS) if (s.constants[k] == null) missing.push(`constants.${k}`);
  }
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);

  const constants = { ...s.constants, XOR_MASK: BigInt(s.constants.XOR_MASK) };
  return {
    pfx: readFileSync(fileInDir("client.p12")),
    passphrase: s.keystorePassphrase,
    constants,
    caPem: s.caPem || undefined
  };
}
