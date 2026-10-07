// VIDAA TV discovery over SSDP, plus descriptor parsing and the TV clock.
//
// Pure helpers (parseDescriptor, readDateHeader, _classifyReply) are unit
// tested; the network entry points (discover, fetchDescriptor, tvTimestamp)
// are exercised end to end against the fake TV.

import dgram from "node:dgram";
import http from "node:http";
import os from "node:os";

const SSDP_MULTICAST = "239.255.255.250";
const SSDP_PORT = 1900;
const UPNP_PORTS = [18400, 38400, 80];
const ST = "urn:schemas-upnp-org:device:MediaRenderer:1";

export function parseDescriptor(xml) {
  const name = /<friendlyName>([^<]+)<\/friendlyName>/.exec(xml);
  const model = /<modelDescription>([\s\S]*?)<\/modelDescription>/.exec(xml);
  const desc = model ? model[1] : "";
  const isVidaa = /vidaa_support|transport_protocol/.test(desc) || /hisense/i.test(xml);
  return { friendlyName: name ? name[1] : "", model: desc.trim().slice(0, 120), isVidaa };
}

export function readDateHeader(headers) {
  const raw = headers?.date || headers?.Date;
  const t = raw ? Date.parse(raw) : NaN;
  if (Number.isNaN(t)) throw new Error("TV did not report its clock");
  return Math.floor(t / 1000);
}

// Turn one raw SSDP datagram into its descriptor URL, or null if it is not a
// usable 200 response.
export function _classifyReply(text) {
  if (!/^HTTP\/1\.1 200/i.test(text)) return null;
  const m = /Location:\s*(\S+)/i.exec(text);
  return m ? m[1] : null;
}

// Every interface's directed IPv4 broadcast address, for unicast-friendly
// M-SEARCH delivery (some stacks drop the global broadcast on virtual NICs).
export function _directedBroadcasts() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      const ip = a.address.split(".").map(Number);
      const mask = a.netmask.split(".").map(Number);
      out.push(ip.map((o, i) => (o & mask[i]) | (~mask[i] & 0xff)).join("."));
    }
  }
  return [...new Set(out)];
}

function msearch(sock, target) {
  const msg = Buffer.from(
    [
      "M-SEARCH * HTTP/1.1",
      `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      "MX: 2",
      `ST: ${ST}`,
      "CONTENT-LENGTH: 0",
      "",
      ""
    ].join("\r\n")
  );
  sock.send(msg, SSDP_PORT, target, () => {});
}

export async function discover({ timeoutMs = 4000, port = 0 } = {}) {
  const locations = new Map();
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  await new Promise((resolve) => {
    sock.bind(port, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* ignore */
      }
      resolve();
    });
  });
  const targets = [..._directedBroadcasts(), "255.255.255.255", SSDP_MULTICAST];
  sock.on("message", (data, rinfo) => {
    const loc = _classifyReply(data.toString("utf8"));
    if (loc && !locations.has(rinfo.address)) locations.set(rinfo.address, loc);
  });
  const blast = () => targets.forEach((t) => msearch(sock, t));
  blast();
  const ticker = setInterval(blast, 500);
  await new Promise((r) => setTimeout(r, timeoutMs));
  clearInterval(ticker);
  sock.close();

  const found = [];
  for (const [host, loc] of locations) {
    const info = await fetchDescriptor(host, loc).catch(() => null);
    if (info && info.isVidaa) found.push(info);
  }
  return found.sort((a, b) => a.host.localeCompare(b.host));
}

function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout: 3000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// Decide which HTTP target(s) to fetch the descriptor from. The Location in an
// SSDP reply is attacker-controllable on the LAN, so we only trust its path and
// port — never let it redirect us to a different host (SSRF guard). A Location
// pointing elsewhere is ignored and we fall back to the replying host's ports.
export function _descriptorTargets(host, location) {
  if (location) {
    let u;
    try {
      u = new URL(location);
    } catch {
      u = null;
    }
    if (u && u.protocol === "http:" && !u.username && !u.password && u.hostname === host) {
      return [{ host, port: Number(u.port) || 80, path: u.pathname + u.search }];
    }
  }
  return UPNP_PORTS.map((p) => ({ host, port: p, path: "/MediaServer/rendererdevicedesc.xml" }));
}

export async function fetchDescriptor(host, location) {
  const tries = _descriptorTargets(host, location);
  let lastErr;
  for (const t of tries) {
    try {
      const res = await httpGet(t.host, t.port, t.path);
      if (res.status !== 200) continue;
      return { host, ...parseDescriptor(res.body), headers: res.headers };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`no descriptor from ${host}`);
}

export async function tvTimestamp(host) {
  const info = await fetchDescriptor(host).catch(() => null);
  if (info) return readDateHeader(info.headers);
  // No descriptor reachable: ask each port just for headers.
  for (const p of UPNP_PORTS) {
    try {
      const res = await httpGet(host, p, "/MediaServer/rendererdevicedesc.xml");
      return readDateHeader(res.headers);
    } catch {
      /* next port */
    }
  }
  throw new Error("TV did not report its clock");
}
