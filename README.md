<div align="center">

  <img src="assets/brand/app_logo_wordmark.png" alt="Nuvio" width="300" />

  <p>
    A free, open-source media app for your phone, your desktop, and the TV you already own.
    <br />
    Bring your own sources. Nuvio turns them into a library with artwork, ratings, subtitles, and your place saved on every screen.
  </p>

[Website](https://nuvio.tv) · [GitHub releases](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) · [Support Nuvio](https://nuvio.tv/support)

</div>

> [!NOTE]
> This is a fork of [NuvioMedia/NuvioTVSmart](https://github.com/NuvioMedia/NuvioTVSmart) that adds experimental support for Hisense VIDAA TVs. Everything else is the same as upstream. The VIDAA part is not supported by the Nuvio team, so please report VIDAA problems here, not upstream. Jump to [VIDAA](#hisense-vidaa-experimental).

## Get Nuvio TV

Nuvio TV supports **Samsung Tizen TVs from 2018 onward (Tizen 4+)**, **LG webOS TVs from 2020 onward (webOS 5+)**, and **Hisense VIDAA OS (Experimental Port)**.
The startup compatibility baseline is Samsung Tizen 4.0 / Chromium 56, LG webOS 5.0 / Chromium 68, and Hisense VIDAA OS (Chromium / WebKit runtime).

Platform capabilities are intentionally version-dependent:

- **Hisense VIDAA OS (Experimental Port)** — TV remote navigation, a fixed TV canvas, and playback through the TV runtime's HTML video backend, with native HLS preferred when supported. Audio and subtitle availability depends on the TV firmware.

- **Samsung Tizen 4.x** — the app and direct playback are supported, but torrent/P2P playback is unavailable by design. Some advanced audio and subtitle features may also be limited.
- **Samsung Tizen 5.x, including 5.5** — torrent/P2P playback is supported through the bundled local EngineFS service only. The PluginService, plugin execution, and remote plugin pull/push synchronization are disabled; the Plugins screen is not available.
  The Node 4.4.3 service runtime observed on Tizen 5.5 is incompatible with the current PluginService syntax and URL APIs. Experimental legacy transports are not included; plugin support starts at Tizen 6.0.
- **Samsung Tizen 6+** — torrent/P2P and the packaged PluginService are supported. Plugin execution requires the packaged service plus the TV runtime's Worker and WebAssembly support. Tizen 6 and later use the same current Tizen service pipeline.
- **LG webOS 5.x** — torrent/P2P and the packaged plugin service are supported, with the limited plugin resource quotas used by the older webOS runtime.
- **LG webOS 6+** — torrent/P2P and the packaged plugin service are supported with the modern plugin resource quotas.

On Tizen 5+ and LG webOS, torrent/P2P uses only the bundled local companion service; no external torrent streaming server is configured or required.

- [Hisense VIDAA (experimental)](#hisense-vidaa-experimental): run or host the web build, see below
- [Nuvio TV Installer](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for Windows, macOS, and Linux
- [Samsung Tizen WGT](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for manual installation
- [LG webOS Homebrew repository](https://raw.githubusercontent.com/NuvioMedia/NuvioTVWebOS/main/webosbrew/apps.json)
- [LG webOS IPK](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for manual installation

## Hisense VIDAA (experimental)

VIDAA is the TV OS on Hisense TVs (and some Toshiba, Sharp and other brands). There's no Nuvio app for it, so this fork makes the regular web build usable in the TV's own browser: the remote's arrows, OK and Back work, and the layout is fixed at 1920×1080 so it isn't zoomed in or cut off. Navigation is remote-only (no mouse pointer).

Things to know before you try it:

- It's a web page in the TV browser, not an installed app. Something has to serve it (your computer, or a host you set up).
- The VIDAA code now builds on [@Empi9245](https://github.com/Empi9245)'s version of this port, which was tested on a real TV (firmware U09.60). Other versions may behave differently.
- Playback uses the browser's video player, so which files play (MKV, AC-3, DTS, HEVC…) depends on your TV.
- Most of this port was written with AI help.

Upstream decided not to support VIDAA ([#790](https://github.com/NuvioMedia/NuvioTVSmart/issues/790), [#1007](https://github.com/NuvioMedia/NuvioTVSmart/pull/1007)). They'd only consider an official native app through VIDAA's partner programme, which isn't realistic for a hobby fork.

### Running it from your computer

Your computer and the TV need to be on the same network.

```bash
git clone https://github.com/derpwinnie/NuvioTVSmart.git
cd NuvioTVSmart
npm install
npm run build
npm run serve:vidaa
```

The terminal prints an address like `http://192.168.1.50:4173/?wrapper=vidaa`. Open it in the TV's browser and bookmark it. The app usually detects VIDAA on its own; the `?wrapper=vidaa` part is there in case it doesn't.

The page only works while your computer is running the server. The server doesn't hand out git data, dotfiles, `node_modules` or the `local*.properties` files, but anyone on your network can open the app while it's running.

### Hosting it somewhere

`npm run package:vidaa` puts a static build in `dist/vidaa/` (plus `dist/nuvio-vidaa.zip`). Upload that to any static host (there's a `vercel.json` for Vercel) and open `https://<your-host>/vidaa.html` on the TV. `vidaa.html` always starts in VIDAA mode, and each build gets new file names so the TV doesn't keep old code. The zip is not something you can install on the TV.

### Home screen tile

**Sidee (newer firmware).** [Sidee](https://github.com/Empi9245/Sidee) by @Empi9245 pairs with the TV over your network (you type a PIN shown on the TV) and adds a launcher tile that opens a web address. Tested on VIDAA U09.60. Things to know:

- Its Nuvio preset is hard-wired to `https://nuviotvsmart.vercel.app/vidaa.html`, which is his hosted copy, not this fork. To use your own host you have to change the `url` in Sidee's `core/presets.py`.
- It talks to the TV with the protocol of Hisense's remote-control app and ships a client certificate taken from that app. Hisense could block it at any time.
- While it runs, its dashboard is reachable from your whole network (protected only by a key in the URL). Close it when you're done.

**Old DNS trick (older firmware).** [`installer/`](./installer) has a script that redirects the TV's DNS to your computer and asks the TV browser to install a tile. It needs root, it often fails on newer firmware, and the tile is only a link, so the URL still has to be served afterwards. Read [installer/README.md](./installer/README.md) first.

Don't mess with launcher files or the `1969` service menu; people have bricked TVs that way.

### Problems

Open an issue with your TV model, VIDAA version and what happened. For remote problems, say which key. If an update doesn't show up, clear the browser data for the page on the TV.

### Ideas (not planned)

These are ideas I wrote down so I don't forget them, not plans. Any of them could turn out wrong or not worth it.

- **Sending small fixes upstream.** Upstream won't take VIDAA, but it does take bug fixes. Some things we ran into might also happen on Tizen, webOS or in the browser, like the player's Sources panel not getting real focus or the dev server serving repo files to the network. Could still fail if the bugs turn out to be VIDAA-only, and each fix needs its own issue and before/after proof.
- **A proper native VIDAA app.** It's the only route upstream said it would accept. It needs VIDAA's partner programme, an NDA and a lot of time, so it's probably out of reach.
- **A permanent public URL.** Then people could just bookmark it with no PC or DNS tricks. Someone has to pay for it and be responsible for it, and if it goes down every TV using it breaks.
- **Backend settings.** The fork's builds point at Nuvio's own backend by default (`scripts/envProperties.mjs`); upstream leaves that empty on purpose. It could move into deploy settings, but then login breaks for anyone who doesn't set it, and `npm run test:vidaa` expects it to be there.
- **A list of tested TVs.** Model, VIDAA version, which keys and codecs work, and screenshots. Upstream closed #1007 partly for having no screenshots or logs. Depends on people with the TVs helping out.
- **Checking the guesswork in the VIDAA adapter.** The yellow-button "native player", allowing insecure connections to some domains, and polling the on-screen keyboard are all untested guesses. They might help, might do nothing, or might cause problems on some firmware.
- **Splitting the VIDAA CSS.** `css/components-61.css` is about 1,500 lines in one file. Easier to read if split, but moving CSS around without a TV to check on can break layouts.
- **Keeping up with upstream.** Rebasing often keeps the VIDAA changes small, but every rebase can quietly break something on VIDAA unless someone retests on a TV.

## Build from source

```bash
git clone https://github.com/derpwinnie/NuvioTVSmart.git NuvioTVSmart
cd NuvioTVSmart
npm install
npm run build
```

Build TV packages with:

```bash
npm run package:tizen
npm run package:tizen:store
npm run package:webos
npm run package:vidaa
```

`package:tizen` creates the unsigned WGT used by development and the Nuvio TV Installer. The installer signs it locally for the target TV before installation. `package:tizen:store` is a separate Seller Office build: it requires Tizen Studio/Web CLI and a configured security profile, and creates the signed Store package with the local EngineFS service included so Tizen 5+ retains torrent/P2P playback. Tizen 4 still reports P2P as unsupported at runtime. Nuvio TV is built with JavaScript, HTML, CSS, and platform TV APIs. Building requires Node.js and npm; package installation additionally requires the relevant Tizen or webOS tools.

`npm run test:vidaa` builds and packages the VIDAA version, then runs its tests.

## Thanks

- [@loggie86](https://github.com/loggie86) for testing on a real Hisense TV and figuring out a lot of the launcher and backend details.
- [@Empi9245](https://github.com/Empi9245) for the VIDAA 9 fixes and the real-TV tested rework this fork now builds on (smooth remote navigation, lazy image loading, keyboard, playback and packaging), plus [Sidee](https://github.com/Empi9245/Sidee).

## License

[GNU General Public License v3.0](./LICENSE)
