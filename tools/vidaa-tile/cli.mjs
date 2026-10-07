#!/usr/bin/env node
// Command-line interface for the VIDAA tile tool. With no command it starts
// the local dashboard; otherwise it runs one action and exits.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { discover } from "./discovery.mjs";
import { extractKeystores } from "./cert.mjs";
import { importFromSidee, SIDEE_COMMIT } from "./sidee-import.mjs";
import { loadSecrets, requireComplete } from "./secrets.mjs";
import { readState } from "./store.mjs";
import { writeFileAtomic, secretsPath } from "./store.mjs";
import { DEFAULT_TILE_URL, validateTileUrl, withVidaaWrapper } from "./urls.mjs";
import * as session from "./session.mjs";

const USAGE = `nuvio vidaa-tile — put Nuvio on a Hisense VIDAA TV as a launcher tile

Usage:
  npm run vidaa:tile                     start the local dashboard
  npm run vidaa:tile -- <command> [opts]

Commands:
  discover                               find VIDAA TVs on the network
  import-sidee                           one-click setup: fetch the TV certificate and
                                         constants from a pinned Sidee release (verified)
  import-apk <path.apk>                  or: extract the keystore files from your VIDAA app
  set-secret [--passphrase P] [--constants file.json] [--ca ca.pem]
  status                                 show what setup is still missing
  pair <host>                            pair with a TV (enter the PIN it shows)
  list <host>                            list launcher tiles
  install <host> [url] [--name N] [--app-id ID] [--image URL]
                                         (url defaults to the free hosted build)
  launch <host> <appId> [--url U] [--name N]
  remove <host> <appId>

Secrets (certificate and protocol constants) live in your user config and never
ship with this repo. See docs/vidaa-tile.md.`;

// Switches take no value; every other --flag takes the next argument.
const SWITCHES = new Set(["lan", "json", "no-open", "help"]);

function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const name = args[i].slice(2);
      flags[name] = SWITCHES.has(name) ? true : args[++i];
    } else rest.push(args[i]);
  }
  return { flags, rest };
}

function askPin() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question("PIN shown on the TV: ", (a) => (rl.close(), r(a.trim()))));
}

function recordFor(host) {
  const rec = readState().tvs[host];
  if (!rec) throw new Error(`no paired TV at ${host}; run: pair ${host}`);
  return rec;
}

async function main() {
  const argv = process.argv.slice(2);
  // Allow bare switches without a command, e.g. `vidaa-tile --lan`.
  if (argv[0] === "-h") argv[0] = "--help";
  const cmd = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  const { flags, rest } = parseFlags(cmd ? argv.slice(1) : argv);

  if (flags.help) {
    console.log(USAGE);
    return;
  }

  if (!cmd || cmd === "dashboard") {
    const { startDashboard, openBrowser } = await import("./web/server.mjs");
    const lan = flags.lan === true;
    const { link } = await startDashboard({ lan });
    if (!lan && flags["no-open"] == null && !process.env.CI) openBrowser(link);
    console.log("Keep this window open while you use the dashboard. Ctrl+C quits.");
    return;
  }

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(USAGE);
    return;
  }

  if (cmd === "status") {
    console.log(JSON.stringify(requireComplete(), null, 2));
    return;
  }

  if (cmd === "import-sidee") {
    await importFromSidee();
    console.log(`setup complete (certificate and constants from Sidee ${SIDEE_COMMIT.slice(0, 7)})`);
    return;
  }

  if (cmd === "import-apk") {
    const out = extractKeystores(rest[0]);
    console.log(`imported keystores:\n  ${out.p12Path}\n  ${out.bksPath}`);
    return;
  }

  if (cmd === "set-secret") {
    let current = {};
    try {
      current = JSON.parse(readFileSync(secretsPath(), "utf8"));
    } catch {
      /* new file */
    }
    if (flags.passphrase) current.keystorePassphrase = flags.passphrase;
    if (flags.constants) current.constants = JSON.parse(readFileSync(flags.constants, "utf8"));
    if (flags.ca) current.caPem = readFileSync(flags.ca, "utf8");
    writeFileAtomic("secrets.json", JSON.stringify(current, null, 2));
    console.log("secrets updated");
    return;
  }

  if (cmd === "discover") {
    const tvs = await discover({ timeoutMs: 4000 });
    console.log(flags.json ? JSON.stringify(tvs, null, 2) : formatTvs(tvs));
    return;
  }

  if (!["pair", "list", "install", "launch", "remove"].includes(cmd)) {
    console.error(`unknown command: ${cmd}\n`);
    console.log(USAGE);
    process.exitCode = 2;
    return;
  }

  const secrets = loadSecrets(); // the rest need the secrets

  if (cmd === "pair") {
    const rec = await session.pair({ host: rest[0], pinProvider: askPin, secrets });
    console.log(`paired with ${rec.host}`);
    return;
  }
  if (cmd === "list") {
    const apps = await session.listTiles(recordFor(rest[0]), { secrets });
    console.log(flags.json ? JSON.stringify(apps, null, 2) : formatApps(apps));
    return;
  }
  if (cmd === "install") {
    const [host, rawUrl = DEFAULT_TILE_URL] = rest;
    const v = validateTileUrl(rawUrl);
    if (!v.ok) throw new Error(`invalid URL: ${v.reason}`);
    const url = withVidaaWrapper(v.url);
    const apps = await session.addTile(
      recordFor(host),
      {
        appId: flags["app-id"] || "nuvio",
        name: flags.name || "Nuvio",
        url,
        image: flags.image || ""
      },
      { secrets }
    );
    console.log(`installed. ${apps.length} tiles now on the TV.`);
    return;
  }
  if (cmd === "launch") {
    await session.launchTile(
      recordFor(rest[0]),
      { appId: rest[1], name: flags.name || rest[1], url: flags.url || "" },
      { secrets }
    );
    console.log("launch sent");
    return;
  }
  if (cmd === "remove") {
    const gone = await session.removeTile(recordFor(rest[0]), rest[1], { secrets });
    console.log(gone ? "removed" : "sent; the TV may still show the tile — remove it there");
    return;
  }
}

const formatTvs = (tvs) =>
  tvs.length ? tvs.map((t) => `  ${t.host}  ${t.friendlyName}`).join("\n") : "  (no TVs found)";
const formatApps = (apps) =>
  apps.length
    ? apps.map((a) => `  ${a.appId}  ${a.name || ""}  ${a.url || a.appUrl || ""}`).join("\n")
    : "  (no tiles)";

main().catch((e) => {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
});
