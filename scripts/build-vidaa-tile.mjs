#!/usr/bin/env node
// Build the VIDAA tile tool as ONE executable for the current OS/arch, so
// users can double-click it like Sidee: no git, no Node.js, no npm install.
//
//   node scripts/build-vidaa-tile.mjs            -> dist/vidaa-tile/nuvio-vidaa-tile-<os>-<arch>[.exe]
//   node scripts/build-vidaa-tile.mjs --bundle-only   -> just the bundled .cjs (for testing)
//
// How: esbuild bundles the CLI, mqtt and the dashboard files into one CommonJS
// file; Node's Single Executable Application support then injects that into a
// copy of the running `node` binary (postject). Run it on each target OS; the
// GitHub workflow vidaa-tile-release.yml does that for Windows, macOS, Linux.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tool = join(root, "tools", "vidaa-tile");
const out = join(root, "dist", "vidaa-tile");
const bundleOnly = process.argv.includes("--bundle-only");

const OS = { win32: "windows", darwin: "macos", linux: "linux" }[process.platform] || process.platform;
const exeName = `nuvio-vidaa-tile-${OS}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Embed the dashboard (index.html, app.js) so the executable needs no folder.
const publicDir = join(tool, "web", "public");
const assets = Object.fromEntries(
  readdirSync(publicDir).map((f) => ["/" + f, readFileSync(join(publicDir, f), "utf8")])
);

const bundlePath = join(out, "vidaa-tile.cjs");
await build({
  entryPoints: [join(tool, "cli.mjs")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: bundlePath,
  legalComments: "inline",
  banner: { js: `globalThis.__VIDAA_TILE_ASSETS__ = ${JSON.stringify(assets)};` },
  // The shebang in cli.mjs would end up mid-file after the banner.
  plugins: [
    {
      name: "strip-shebang",
      setup(b) {
        b.onLoad({ filter: /cli\.mjs$/ }, (args) => ({
          contents: readFileSync(args.path, "utf8").replace(/^#!.*\n/, ""),
          loader: "js"
        }));
      }
    }
  ],
  logLevel: "warning"
});
console.log(`bundled: ${bundlePath}`);
if (bundleOnly) process.exit(0);

// Single Executable Application: blob -> copy of node -> inject.
const blob = join(out, "sea-prep.blob");
const seaConfig = join(out, "sea-config.json");
writeFileSync(
  seaConfig,
  JSON.stringify({
    main: bundlePath,
    output: blob,
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    useSnapshot: false
  })
);
execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" });

const exe = join(out, exeName);
copyFileSync(process.execPath, exe);
chmodSync(exe, 0o755);

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
if (process.platform === "darwin") run("codesign", ["--remove-signature", exe]);

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
run(npx, [
  "--yes",
  "postject@1.0.0-alpha.6",
  exe,
  "NODE_SEA_BLOB",
  blob,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])
]);

// Ad-hoc signature so Apple Silicon will run it at all (still unnotarized:
// the first launch needs "Open Anyway", same as Sidee).
if (process.platform === "darwin") run("codesign", ["--sign", "-", exe]);

rmSync(blob, { force: true });
rmSync(seaConfig, { force: true });
console.log(`built: ${exe}`);
