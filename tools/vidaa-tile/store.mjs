// On-disk state and secrets for the tile tool.
//
// Everything lives in one per-user config directory. State (paired TVs,
// tokens) and secrets (keystore files, passphrase, constants) are written
// with restrictive permissions and atomic replaces so a crash mid-write
// cannot brick the tool.

import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export function configDir() {
  if (process.env.NUVIO_VIDAA_HOME) return process.env.NUVIO_VIDAA_HOME;
  if (platform() === "win32") return join(process.env.APPDATA || homedir(), "nuvio-vidaa");
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "nuvio-vidaa");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "nuvio-vidaa");
}

function ensureDir() {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  return configDir();
}

export const fileInDir = (name) => join(configDir(), name);
export const secretsPath = () => fileInDir("secrets.json");

export function readState() {
  let raw;
  try {
    raw = readFileSync(fileInDir("state.json"), "utf8");
  } catch {
    return { tvs: {}, settings: {} };
  }
  try {
    const s = JSON.parse(raw);
    return { tvs: s.tvs || {}, settings: s.settings || {} };
  } catch {
    throw new Error("could not read state.json (corrupt); delete it to reset");
  }
}

export function writeState(state) {
  writeFileAtomic("state.json", JSON.stringify(state, null, 2));
}

// Shared by state and secrets writers: temp file + rename, mode 0600.
export function writeFileAtomic(name, contents) {
  ensureDir();
  const tmp = fileInDir(`${name}.tmp-${process.pid}`);
  writeFileSync(tmp, contents, { mode: 0o600 });
  renameSync(tmp, fileInDir(name));
  try {
    chmodSync(fileInDir(name), 0o600);
  } catch {
    /* best effort on Windows */
  }
}

export function writeBinaryAtomic(name, buffer) {
  ensureDir();
  const tmp = fileInDir(`${name}.tmp-${process.pid}`);
  writeFileSync(tmp, buffer, { mode: 0o600 });
  renameSync(tmp, fileInDir(name));
  try {
    chmodSync(fileInDir(name), 0o600);
  } catch {
    /* best effort on Windows */
  }
}
