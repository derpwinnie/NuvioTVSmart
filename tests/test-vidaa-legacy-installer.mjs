// Checks that the legacy installer server only serves its own assets and the built app,
// never other repository files (path traversal).
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerDir = path.join(rootDir, "installer", "legacy");

// The server resolves paths with these helpers; the request handler decodes the URL once first.
const probe = String.raw`
import http.client, http.server, json, os, sys, threading, urllib.parse
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import server
app_dir = sys.argv[2]

# End to end through the request handler: raw request paths (no client-side
# normalisation) against a server on an ephemeral loopback port.
server.APP_DIR_CANDIDATES[:] = [app_dir]
httpd = http.server.HTTPServer(("127.0.0.1", 0), server.InstallerHandler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
def status(url):
    conn = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
    conn.request("GET", url)
    res = conn.getresponse()
    body = res.read()
    conn.close()
    return [res.status, b"secret" in body or b'"name"' in body]
http_results = {u: status(u) for u in [
    "/", "/index.html?x=1", "/app.bundle.js", "/install", "/shared/icon.png", "/shared/index.html",
    "/shared/../../package.json", "/shared/..%2f..%2fpackage.json", "/shared/%2e%2e",
    "/shared/..%5c..%5cpackage.json", "/shared/", "/../package.json", "/%2e%2e/package.json",
    "/..%2f..%2fpackage.json", "/../vidaa-secret/key.txt", "/linked/package.json", "/a%00b",
]}
httpd.shutdown()
def shared(url):
    path = urllib.parse.unquote(url)
    return server.resolve_shared_file(path[len("/shared/"):])
def app(url):
    return server.resolve_app_file(app_dir, urllib.parse.unquote(url))
print(json.dumps({
    "sharedIcon": bool(shared("/shared/icon.png")),
    "sharedInstallerFile": bool(shared("/shared/index.html")),
    "sharedTraversal": shared("/shared/../../package.json"),
    "sharedEncodedTraversal": shared("/shared/..%2f..%2fpackage.json"),
    "sharedDotDot": shared("/shared/.."),
    "appIndex": bool(app("/")),
    "appAsset": bool(app("/app.bundle.js")),
    "appTraversal": app("/../package.json"),
    "appEncodedTraversal": app("/%2e%2e/package.json"),
    "appSiblingPrefix": app("/../vidaa-secret/key.txt"),
    "appSymlinkOut": app("/linked/package.json"),
    "http": http_results,
    "repoIsNotAnAppDir": all(not c.rstrip("/").endswith(os.path.basename(server.REPO_ROOT)) for c in server.APP_DIR_CANDIDATES),
}))
`;

const workDir = mkdtempSync(path.join(tmpdir(), "nuvio-legacy-installer-"));
let failed = 0;
const check = (label, condition) => {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
};

try {
  // A fake built app next to a sibling folder whose name shares the "vidaa" prefix.
  const appDir = path.join(workDir, "vidaa");
  mkdirSync(appDir);
  writeFileSync(path.join(appDir, "index.html"), "<!doctype html>");
  writeFileSync(path.join(appDir, "app.bundle.js"), "");
  mkdirSync(path.join(workDir, "vidaa-secret"));
  writeFileSync(path.join(workDir, "vidaa-secret", "key.txt"), "secret");
  symlinkSync(rootDir, path.join(appDir, "linked"));

  const output = execFileSync("python3", ["-c", probe, installerDir, appDir], { encoding: "utf8" });
  const result = JSON.parse(output.trim().split("\n").pop());

  check("shared asset is served", result.sharedIcon);
  check("plain installer file is served from /shared/", result.sharedInstallerFile);
  check("/shared/../../package.json is refused", result.sharedTraversal === null);
  check("/shared/..%2f..%2fpackage.json is refused", result.sharedEncodedTraversal === null);
  check("/shared/.. is refused", result.sharedDotDot === null);
  check("app index is served", result.appIndex);
  check("app asset is served", result.appAsset);
  check("/../package.json is refused", result.appTraversal === null);
  check("/%2e%2e/package.json is refused", result.appEncodedTraversal === null);
  check("a sibling folder with the same prefix is refused", result.appSiblingPrefix === null);
  check("a symlink out of the app folder is refused", result.appSymlinkOut === null);
  check("the repository root is never served as the app", result.repoIsNotAnAppDir);

  // The same through the HTTP handler: these are served, everything else
  // requested by the probe must be a 404 without file content.
  const served = [
    "/",
    "/index.html?x=1",
    "/app.bundle.js",
    "/install",
    "/shared/icon.png",
    "/shared/index.html"
  ];
  for (const [url, [status, leaked]] of Object.entries(result.http)) {
    if (served.includes(url)) check(`HTTP ${url} is served`, status === 200 && !leaked);
    else check(`HTTP ${url} is 404`, status === 404 && !leaked);
  }
  check("every request got an answer", Object.keys(result.http).length === 17);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failed) {
  console.error(`${failed} legacy installer check(s) failed`);
  process.exit(1);
}
console.log("Legacy installer path checks passed.");
