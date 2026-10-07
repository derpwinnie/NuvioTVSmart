# VIDAA tile installer

Put Nuvio — or any address you host — on a Hisense VIDAA TV as a permanent
launcher tile. It pairs with the TV like the official remote app (you type the
PIN shown on the TV) and registers a tile that opens a web address. Nothing is
copied onto the TV; the tile opens a URL, so that URL has to stay reachable.

Works on Linux, macOS and Windows. Experimental: confirmed to build and pass
its tests here, but the final pairing step can only be verified on a real TV.

> Protocol reference and credit: [Sidee](https://github.com/Empi9245/Sidee) by
> @Empi9245. This tool is an independent, self-hostable implementation.

## Quick start (no setup, no Node.js)

1. Download the program for your computer from the
   [VIDAA tile tool releases](../../../releases)
   (`nuvio-vidaa-tile-windows-x64.exe`, `-macos-arm64` for M-series Macs,
   `-macos-x64` for Intel Macs, `-linux-x64`).
2. Double-click it (Linux: `chmod +x` it first). The dashboard opens in your
   browser. Keep the program's window open while you use it.
3. Click **Set up with one click**, then **Find TV**, enter the PIN your TV
   shows, and **Install tile**. Done.

macOS: the program is not notarized. On first launch go to System Settings →
Privacy & Security → **Open Anyway**. Windows SmartScreen may ask the same
("More info" → "Run anyway"). If Windows asks about network access, allow it
on private networks so the TV can be found.

## One-time setup: where the certificate comes from

The TV only accepts its official remote app, so the tool needs that app's
client certificate and five protocol constants. This repo still ships **no**
Hisense material. You choose one of two ways:

- **One click (recommended).** The dashboard button, or `import-sidee` on the
  CLI, downloads two files from one *pinned* commit of
  [Sidee](https://github.com/Empi9245/Sidee) (MIT), checks their SHA-256 and
  decodes them on your computer. No passphrase needed. If Sidee's files ever
  change, the hash check fails and nothing is used; update this tool or use
  the APK route.
- **Your own app copy.** Point the tool at an `.apk` of the official "VIDAA
  Smart TV" app (package `com.universal.remote.multi`); it extracts
  `res/raw/client_mobile_android.p12` and `res/raw/remoteca.bks` (pure unzip).
  You then supply the keystore passphrase and the constants (`PATTERN`,
  `VALUE_SUFFIX`, `XOR_MASK`, `BRAND`, `OPERATION`) yourself.

Either way the result is stored under your user config
(`~/.config/nuvio-vidaa/` on Linux, `~/Library/Application Support/nuvio-vidaa/`
on macOS, `%APPDATA%\nuvio-vidaa\` on Windows), readable only by you.

## From source

```bash
npm run vidaa:tile            # opens the local dashboard in your browser
```

Or use the CLI:

```bash
npm run vidaa:tile -- import-sidee                # one-click setup
npm run vidaa:tile -- discover
npm run vidaa:tile -- pair 192.168.1.50          # enter the PIN the TV shows
npm run vidaa:tile -- install 192.168.1.50        # uses the free hosted build
npm run vidaa:tile -- install 192.168.1.50 https://your-host.example/   # or your own
npm run vidaa:tile -- list 192.168.1.50
npm run vidaa:tile -- remove 192.168.1.50 nuvio
```

APK route instead of `import-sidee`:

```bash
npm run vidaa:tile -- import-apk /path/to/vidaa.apk
npm run vidaa:tile -- set-secret --passphrase 'THE_PASSPHRASE' --constants constants.json
```

`constants.json` is `{ "PATTERN": "...", "VALUE_SUFFIX": "...", "XOR_MASK":
"<decimal>", "BRAND": "his", "OPERATION": "vidaacommon_001" }`.

To build the single-file program yourself: `npm run vidaa:tile:build` (puts it
in `dist/vidaa-tile/`, for the OS you run it on). CI builds all four via
`.github/workflows/vidaa-tile-release.yml`; push a tag `vidaa-tile-vX.Y.Z` to
publish a release.

### Linux / Fedora notes

- Discovery listens for the TV's reply. If `firewalld` blocks it, allow the
  discovery port and retry; the tool never changes your firewall itself.
- To drive the dashboard from your phone, start it with `--lan`
  (`npm run vidaa:tile -- --lan`, or the program with `--lan`).
  It then binds your LAN and prints a one-time link with an access key; open
  that link once to authorize the browser. The key is kept in a cookie, never
  in the address bar.

## Where the tile points

The tile opens a URL that must stay reachable even when your PC is off.

**You don't have to host anything.** This fork publishes its VIDAA build for
free on GitHub Pages:

    https://derpwinnie.github.io/NuvioTVSmart/vidaa.html

The dashboard and `install` use this address by default. It is rebuilt
automatically on every push to `main`, so the tile always opens the latest
version. Your PC is only needed once, to pair the TV and add the tile.

Only if you want your own copy:

- **Your own GitHub Pages** — fork the repo, enable Pages (Settings → Pages →
  Source: GitHub Actions); `.github/workflows/pages.yml` then publishes it to
  `https://<you>.github.io/<repo>/vidaa.html`. Free for public repos.
- **Docker** — `docker build -f Dockerfile.vidaa -t nuvio-vidaa .` then
  `docker run --rm -p 8080:8080 nuvio-vidaa`, and put https in front for public
  access. Runs as a non-root user and serves only the built `dist/`.
- **Home network** — `npm run serve:vidaa` serves it on port 4173, but the tile
  only works while that machine is on.

## Security

- The one-click setup only accepts files whose SHA-256 matches the pinned
  Sidee commit, so a compromised or changed upstream cannot slip in.
- The connection to the TV is over TLS. With `remoteca.bks` converted to a CA
  PEM (set `caPem` in `secrets.json`) it is fully verified. Without one, the
  TV's self-signed certificate is trusted on first pairing and **pinned**: a
  later impostor on the same address is rejected. The only exposure is a
  man-in-the-middle during the very first pairing on your own LAN.
- The dashboard binds `127.0.0.1` by default and rejects foreign `Host` headers
  (DNS-rebinding) and cross-origin requests (CSRF).

## Test on a real TV

There is no TV in this project's setup, so the pairing step needs a tester.

1. `npm run vidaa:tile -- --help` to confirm it runs.
2. Do the one-time setup, then `discover`, `pair <host>`, and `install`.
3. If something fails, re-run with `--diagnose` (planned) or copy the terminal
   output — tokens and the PIN are not needed to debug discovery/pairing shape.
4. Report TV model and VIDAA version with the result.

## Limitations

- Tile removal is best-effort; if the TV does not confirm, remove the tile from
  the launcher on the TV.
- Behaviour on firmware other than what testers report is unknown.
