# VIDAA tile installer – design

Date: 2026-10-07
Status: draft, awaiting review

## Goal

Let anyone put Nuvio (this fork, or any self-hosted build) on a Hisense VIDAA TV as a permanent launcher tile, from Linux, macOS or Windows, without DNS tricks or root.

The tool uses the same TV mechanism as [Sidee](https://github.com/Empi9245/Sidee) by @Empi9245: it pairs with the TV like the official remote app (PIN shown on the TV) and asks the TV to register a web-app tile. Nothing is copied onto the TV; the tile opens a URL. Sidee is the reference for the protocol and is credited in the README and in the source.

Compared with Sidee, the tool:

- runs on Linux (Fedora: firewalld, multiple interfaces) as well as macOS and Windows;
- installs any URL, so users can self-host their build;
- lists tiles, supports several TVs, and tries to remove tiles;
- keeps the dashboard on `127.0.0.1` by default, with no access key in the URL;
- pins the TV certificate after pairing instead of disabling verification;
- waits for real TV replies instead of fixed sleeps, and tells "TV unreachable" apart from "pairing expired";
- is tested end to end against a fake TV that speaks the real protocol.

## Non-goals

- Packaged desktop apps (installers, signed bundles). Possible later on top of this tool.
- Shipping Hisense key material. See "Client certificate".
- Tizen, webOS or anything outside VIDAA.

## Success criteria

1. `npm run vidaa:tile` on Fedora opens the dashboard; the user finds the TV, enters the PIN, enters a URL and the tile appears in the TV launcher and stays after a reboot.
2. Every flow and every error case below passes against the fake TV in `npm run test:vidaa`.
3. The self-hosting options (GitHub Pages, Docker, `serve:vidaa`) serve a build that loads with `?wrapper=vidaa`.

Criterion 1 can only be confirmed on a real TV. Until then the tool is labelled experimental.

## Architecture

New folder `tools/vidaa-tile/`, Node.js ESM, same Node version as the rest of the repo. One runtime dependency: `mqtt` (MQTT.js). Everything else uses the Node standard library.

| Module         | Responsibility                                                                                                                                                                       | Depends on            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `discovery.js` | SSDP search on all IPv4 interfaces, fetch the device descriptor, decide whether it is a VIDAA TV, read the TV clock from the HTTP `Date` header. Manual IP is supported.             | `node:dgram`, `os`    |
| `protocol.js`  | Pure functions: client id, username, passwords, topic names, message payloads. No I/O.                                                                                               | `secrets.js`          |
| `secrets.js`   | Loads the user-local client keystore, CA keystore, keystore password and protocol constants. Never bundled.                                                                          | `store.js`            |
| `session.js`   | One TLS MQTT connection to one TV: pair, refresh, install, list, launch, remove. Request/response with timeouts, waits for the matching reply topic. Verifies the TV against the CA. | `mqtt`, `protocol.js` |
| `store.js`     | Per-TV records (device id, tokens, expiry) and local secrets in `~/.config/nuvio-vidaa/` (platform equivalent on macOS/Windows). Directory 0700, files 0600, atomic writes.          | `node:fs`             |
| `cert.js`      | Unzips the two keystore files (`client_mobile_android.p12`, `remoteca.bks`) from a user-supplied APK and saves them through `store.js`. Does not recover the keystore password.      | `node:zlib`           |
| `urls.js`      | Validates tile URLs: `https`, or `http` on private LAN ranges and Tailscale (`100.64.0.0/10`). Rejects loopback and credentials in URLs. Adds `wrapper=vidaa` for Nuvio.             | –                     |
| `web/`         | Local dashboard (server plus static page). Server binds `127.0.0.1` by default.                                                                                                      | all of the above      |
| `cli.js`       | Same functions without UI: `discover`, `pair`, `list`, `install`, `launch`, `remove`, `import-cert`.                                                                                 | all of the above      |
| `i18n/en.json` | All user-facing strings. Other languages can be added as files later.                                                                                                                | –                     |

Entry point: `npm run vidaa:tile` (dashboard) and `npm run vidaa:tile -- <command>` (CLI).

The old DNS-spoofing installer moves to `installer/legacy/` with a deprecation note.

## Client certificate and protocol constants

The TV only accepts MQTT clients that present the client certificate of the official remote app (subject `CN=VidaaAppAndroidV01`). Sidee bundles that certificate and private key, plus protocol constants taken from the same app. That material belongs to Hisense; it cannot be put under this repo's licence, and a shared key can be revoked for everyone at once.

The two keystore files are password-protected (verified on the real app: `client_mobile_android.p12` fails to open without a password; `remoteca.bks` is a BouncyCastle keystore). The password and the protocol constants live inside the app's native code.

Decision: this repo ships no Hisense material. The tool never recovers the keystore password and never reverse-engineers the native libraries — that is deliberately out of scope and was blocked for good reason during research.

Split of work, once per machine:

- **Automated:** `cert.js` unzips the two keystore files from an APK the user points it at (`res/raw/client_mobile_android.p12`, `res/raw/remoteca.bks`). Pure extraction, no cracking.
- **User-supplied:** the keystore password and the protocol constants (`PATTERN`, `VALUE_SUFFIX`, `XOR_MASK`, `BRAND`, `OPERATION`) are entered once into a local secrets file. Users obtain them however they like; the docs point at public sources (e.g. the Sidee source decodes the constants). The tool reads them from the secrets file, never from the binaries.

A real advantage over Sidee: because `remoteca.bks` is available, the TLS connection to the TV is verified against Hisense's `RemoteCA` instead of disabling verification.

## Protocol (reference: Sidee `core/client.py`, `core/protocol.py`)

- **Discovery:** SSDP `M-SEARCH`, `ST: urn:schemas-upnp-org:device:MediaRenderer:1`, `MX: 2`, sent to every interface's directed broadcast, `255.255.255.255` and `239.255.255.250:1900`, repeated every 0.5 s for 4 s. Replies arrive on a fixed local port so a firewall rule can allow them. Descriptor from `Location`, falling back to `http://<host>:{18400,38400,80}/MediaServer/rendererdevicedesc.xml`.
- **Transport:** MQTT 3.1.1 over TLS, port 36669, mutual TLS with the client certificate.
- **Credentials:** client id, username and pairing password are derived from a per-TV device id, the TV clock and the constants. After pairing, the access token (about 2 days) or refresh token (about 30 days) is the password. The device id is kept and reused when re-pairing, because the TV limits the number of paired devices.
- **Pairing:** subscribe to the authentication and token reply topics, send `vidaa_app_connect`, send the PIN to `authenticationcode`, request tokens with `gettoken`, close the PIN prompt.
- **Install:** `uievent` with `type: app_install` and the tile data (title, id, image, URL, `StoreType: 99`). Success means the tile appears in a following `applist` reply with the same id and URL.
- **List:** `applist`, reply on the `applist` data topic.
- **Launch:** `launchapp` with the tile id and URL.
- **Remove:** not known. Implemented as an experiment; if the TV does not confirm, the UI tells the user to remove the tile on the TV.

## Flows

**First run**

1. Dashboard opens in the browser on `127.0.0.1`.
2. No certificate yet: ask for the APK, run `cert.js`, save.
3. Find TV: 4 s search, list results with names; manual IP field.
4. Pair: TV shows a PIN, user enters it. The TLS connection is verified against `remoteca.bks`. Save tokens and device id.
5. Add tile: URL (default from settings, e.g. the user's GitHub Pages URL), name, optional icon. Install, then confirm via `applist` before showing success.

**Later runs:** paired TVs are listed. Tiles can be listed, re-installed with new data, launched, or removed (experimental).

**Tokens:** refreshed on use when the access token is close to expiry. When the refresh token has expired or the TV rejects it, the user is asked to pair again, with the same device id.

**LAN mode:** `--lan` binds the dashboard to the LAN for phone use. Access needs a random key entered once in a login form; it is stored in a cookie, not in the URL, and compared in constant time.

## Errors

| Case                           | Detection                                | Message / action                                                                     |
| ------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| No TV found                    | discovery returns nothing                | Same network? On Fedora: firewalld command to allow the reply port. Manual IP field. |
| TV off or unreachable          | TCP/TLS connect fails or times out       | "TV not reachable." Pairing is kept.                                                 |
| Wrong or expired PIN           | `authenticationcode` result is not 1     | "PIN not accepted", button for a new PIN.                                            |
| Pairing expired or revoked     | MQTT CONNACK 4/5 with refresh token      | "Pair again."                                                                        |
| TV fails CA verification       | TLS handshake rejected by `remoteca.bks` | Abort: "This device is not a genuine VIDAA TV, or is being impersonated."            |
| No confirmation after install  | tile not in `applist` within 15 s        | "No confirmation from the TV. Check the launcher."                                   |
| Certificate missing or invalid | `secrets.js` load or validation fails    | Back to the certificate step with an explanation.                                    |
| Invalid URL                    | `urls.js`                                | Explain which URLs are allowed, before anything is sent.                             |

The tool never changes firewall or system settings itself. Internal errors are logged locally; the dashboard shows the message, not stack traces.

## Self-hosting

- **GitHub Pages:** workflow that builds the VIDAA bundle and publishes it on the fork. Enabled only after the maintainer agrees, because it creates a public site.
- **Docker:** `Dockerfile` with a small static web server serving the built app.
- **Home network:** the existing `npm run serve:vidaa`; the tile only works while that machine runs.

The README gets a "Home screen tile" section that replaces the DNS installer instructions.

## Testing

- **Fake TV** (`tests/fake-vidaa-tv/`): SSDP responder, descriptor server with `Date` header, TLS MQTT broker that checks credentials like the real TV, PIN/token/tile state, and switches for each error case. Uses a test certificate and test constants generated at test time; no Hisense material in the repo.
- **Unit tests:** `protocol.js` against fixed vectors computed by hand from the Sidee reference; `urls.js`; `store.js` (permissions, several TVs, corrupt file).
- **End-to-end tests** against the fake TV: discover, pair, install, confirm, refresh, re-pair, and one test per row of the error table. Added to `npm run test:vidaa`.
- **Dashboard:** Playwright run through the whole flow against the fake TV, with screenshots.
- **Docker:** build and run the image, check that the app loads with `?wrapper=vidaa`.
- **Real TV:** `--diagnose` writes all messages to a file with tokens and PIN redacted, for attaching to an issue. The docs include a 10-minute test checklist for testers with a VIDAA TV.

Not verifiable without a real TV: that the fake TV matches real behaviour in every detail, whether removal works, and behaviour on other firmware versions.
