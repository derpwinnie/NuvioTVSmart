// Extract the two keystore files the TV protocol needs from an APK the user
// supplies. This is pure unzip: it reads named entries and never recovers the
// keystore password or touches the app's native code. The repo ships no
// Hisense material; the user points at their own copy of the app.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { writeBinaryAtomic, fileInDir } from "./store.mjs";

const WANTED = {
  p12: "res/raw/client_mobile_android.p12",
  bks: "res/raw/remoteca.bks"
};

// Minimal ZIP reader over the End-of-Central-Directory record. Supports the
// only two storage methods APKs use for these assets: stored (0) and
// deflate (8). Returns a Buffer for one named entry, or null if absent.
function readZipEntry(zip, name) {
  const eocd = findEocd(zip);
  let off = eocd.cdOffset;
  for (let i = 0; i < eocd.count; i++) {
    if (zip.readUInt32LE(off) !== 0x02014b50) throw new Error("bad central directory");
    const method = zip.readUInt16LE(off + 10);
    const compSize = zip.readUInt32LE(off + 20);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const localOff = zip.readUInt32LE(off + 42);
    const entryName = zip.toString("utf8", off + 46, off + 46 + nameLen);
    if (entryName === name) {
      return extractLocal(zip, localOff, method, compSize);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function extractLocal(zip, localOff, method, compSize) {
  if (zip.readUInt32LE(localOff) !== 0x04034b50) throw new Error("bad local header");
  const nameLen = zip.readUInt16LE(localOff + 26);
  const extraLen = zip.readUInt16LE(localOff + 28);
  const dataStart = localOff + 30 + nameLen + extraLen;
  const comp = zip.subarray(dataStart, dataStart + compSize);
  if (method === 0) return Buffer.from(comp);
  if (method === 8) return inflateRawSync(comp);
  throw new Error(`unsupported zip compression method ${method}`);
}

function findEocd(zip) {
  // Scan backwards for the EOCD signature (no zip comment expected, but allow).
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      return { count: zip.readUInt16LE(i + 10), cdOffset: zip.readUInt32LE(i + 16) };
    }
  }
  throw new Error("not a zip/apk file (no end-of-central-directory record)");
}

export function extractKeystores(apkPath) {
  const zip = readFileSync(apkPath);
  const p12 = readZipEntry(zip, WANTED.p12);
  if (!p12) throw new Error(`APK is missing ${WANTED.p12}`);
  const bks = readZipEntry(zip, WANTED.bks);
  if (!bks) throw new Error(`APK is missing ${WANTED.bks}`);
  writeBinaryAtomic("client.p12", p12);
  writeBinaryAtomic("remoteca.bks", bks);
  return { p12Path: fileInDir("client.p12"), bksPath: fileInDir("remoteca.bks") };
}
