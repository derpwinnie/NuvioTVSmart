# VIDAA tile installer

Put Nuvio — or any address you host — on a Hisense VIDAA TV as a permanent
launcher tile. It pairs with the TV like the official remote app (you type the
PIN shown on the TV) and registers a tile that opens a web address. Nothing is
copied onto the TV; the tile opens a URL, so that URL has to stay reachable.

Works on Linux, macOS and Windows. Experimental: confirmed to build and pass
its tests here, but the final pairing step can only be verified on a real TV.

> Protocol reference and credit: [Sidee](https://github.com/Empi9245/Sidee) by
> @Empi9245. This tool is an independent, self-hostable implementation.

## What you need once

This repo ships **no** Hisense material. The tool needs three things from your
own copy of the official VIDAA app, set up once per computer:

1. **The two keystore files.** Point the tool at an `.apk` of the official
   "VIDAA Smart TV" app (package `com.universal.remote.multi`). It extracts
   `res/raw/client_mobile_android.p12` and `res/raw/remoteca.bks` — pure unzip,
   nothing is cracked.
2. **The keystore passphrase.** The `.p12` is password-protected. The tool does
   not recover the password; you provide it.
3. **The protocol constants** (`PATTERN`, `VALUE_SUFFIX`, `XOR_MASK`, `BRAND`,
   `OPERATION`). These live in the app and are decoded in public projects such
   as Sidee's `core/protocol.py`.

These are stored under your user config (`~/.config/nuvio-vidaa/` on Linux),
readable only by you, and never committed.

## Use it

```bash
npm run vidaa:tile            # opens the local dashboard in your browser
```

The dashboard walks through: one-time setup → find TV → enter PIN → install.

Or use the CLI:

```bash
npm run vidaa:tile -- import-apk /path/to/vidaa.apk
npm run vidaa:tile -- set-secret --passphrase 'THE_PASSPHRASE' --constants constants.json
npm run vidaa:tile -- discover
npm run vidaa:tile -- pair 192.168.1.50          # enter the PIN the TV shows
npm run vidaa:tile -- install 192.168.1.50 https://your-host.example/
npm run vidaa:tile -- list 192.168.1.50
npm run vidaa:tile -- remove 192.168.1.50 nuvio
```

`constants.json` is `{ "PATTERN": "...", "VALUE_SUFFIX": "...", "XOR_MASK":
"<decimal>", "BRAND": "his", "OPERATION": "vidaacommon_001" }`.

### Linux / Fedora notes

- Discovery listens for the TV's reply. If `firewalld` blocks it, allow the
  discovery port and retry; the tool never changes your firewall itself.
- To drive the dashboard from your phone, start it with `-- dashboard --lan`.
  It then binds your LAN and prints a one-time link with an access key; open
  that link once to authorize the browser. The key is kept in a cookie, never
  in the address bar.

## Where to host your build

The tile opens a URL that must stay reachable even when your PC is off.

- **GitHub Pages** — `.github/workflows/pages.yml` builds and publishes the
  VIDAA build. It is manual-trigger only (Actions → "Publish VIDAA build to
  Pages" → Run), because enabling Pages creates a public site.
- **Docker** — `docker build -f Dockerfile.vidaa -t nuvio-vidaa .` then
  `docker run --rm -p 8080:8080 nuvio-vidaa`, and put https in front for public
  access. Runs as a non-root user and serves only the built `dist/`.
- **Home network** — `npm run serve:vidaa` serves it on port 4173, but the tile
  only works while that machine is on.

## Security

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
