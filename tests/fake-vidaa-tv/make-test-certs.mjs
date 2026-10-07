// Generate a throwaway CA, a server certificate for 127.0.0.1 and a
// password-protected client PKCS#12 — all at test time, via the system
// openssl. Nothing here is Hisense material; it only lets the fake TV run a
// real TLS handshake so the session code is tested against proper verification.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function haveOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function makeTestCerts() {
  const dir = mkdtempSync(join(tmpdir(), "vidaa-certs-"));
  const p = (f) => join(dir, f);
  const run = (args) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "ignore"] });

  // CA
  run(["genrsa", "-out", p("ca.key"), "2048"]);
  run([
    "req",
    "-x509",
    "-new",
    "-key",
    p("ca.key"),
    "-days",
    "3",
    "-subj",
    "/CN=Test RemoteCA",
    "-out",
    p("ca.pem")
  ]);

  // Server cert for 127.0.0.1 (SAN) signed by the CA
  run(["genrsa", "-out", p("server.key"), "2048"]);
  writeFileSync(p("san.cnf"), "subjectAltName=IP:127.0.0.1\n");
  run(["req", "-new", "-key", p("server.key"), "-subj", "/CN=127.0.0.1", "-out", p("server.csr")]);
  run([
    "x509",
    "-req",
    "-in",
    p("server.csr"),
    "-CA",
    p("ca.pem"),
    "-CAkey",
    p("ca.key"),
    "-CAcreateserial",
    "-days",
    "3",
    "-extfile",
    p("san.cnf"),
    "-out",
    p("server.pem")
  ]);

  // Client cert signed by the CA, bundled into a password-protected .p12
  const clientPass = "testpass";
  run(["genrsa", "-out", p("client.key"), "2048"]);
  run(["req", "-new", "-key", p("client.key"), "-subj", "/CN=TestClient", "-out", p("client.csr")]);
  run([
    "x509",
    "-req",
    "-in",
    p("client.csr"),
    "-CA",
    p("ca.pem"),
    "-CAkey",
    p("ca.key"),
    "-CAcreateserial",
    "-days",
    "3",
    "-out",
    p("client.pem")
  ]);
  run([
    "pkcs12",
    "-export",
    "-inkey",
    p("client.key"),
    "-in",
    p("client.pem"),
    "-certfile",
    p("ca.pem"),
    "-passout",
    `pass:${clientPass}`,
    "-out",
    p("client.p12")
  ]);

  return {
    dir,
    ca: readFileSync(p("ca.pem")),
    serverKey: readFileSync(p("server.key")),
    serverCert: readFileSync(p("server.pem")),
    clientPfx: readFileSync(p("client.p12")),
    clientPass
  };
}
