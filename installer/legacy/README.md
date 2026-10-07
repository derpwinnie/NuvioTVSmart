> **Deprecated.** Prefer the tile tool: `npm run vidaa:tile` (see ../../docs/vidaa-tile.md). This DNS method needs root and often fails on newer firmware.

# VIDAA helpers

Two ways to get Nuvio onto a Hisense VIDAA TV. The first one is the one you want.

For a home screen tile on newer firmware, also look at [Sidee](https://github.com/Empi9245/Sidee) (see the notes in the [main README](../README.md#home-screen-tile)).

## 1. Bookmark it in the TV browser

1. Serve the app from your computer (`npm run serve:vidaa`, see the main README) or from wherever you host it.
2. On the TV, open the browser and go to that address, e.g. `http://<your-pc-ip>:4173/?wrapper=vidaa`.
3. Add it to your bookmarks.

That's it. The address has to stay reachable. The service worker only uses its cache when the TV is offline.

## 2. Home screen icon (experimental, often doesn't work)

`server.py` tries to add a Nuvio tile to the TV's home screen using Hisense's `Hisense_installApp` function. To reach that function it pretends to be `vidaahub.com`: it runs a small DNS server and an HTTPS server with a self-signed certificate on your computer.

Before you bother:

- On newer firmware (roughly VIDAA U6 and later) the TV usually ignores the request without telling you.
- The tile is just a link to a URL. After you switch the DNS back, that URL still has to be served by something, or the tile opens nothing.
- It needs root on your computer, because it uses ports 53 and 443.

If you still want to try:

1. On a computer on the same network, run:
   ```bash
   sudo python3 installer/legacy/server.py
   ```
   It prints your computer's local IP (e.g. `192.168.1.100`). On Windows you can use `start-windows.bat`, on macOS/Linux `start-mac-linux.sh`.
2. On the TV, go to **Settings > Network > Network Configuration > DNS**, switch to manual and enter that IP.
3. Open the TV browser and go to `https://vidaahub.com`.
4. Press **Install to TV Launcher**.
5. Set the TV's DNS back to automatic and restart the TV.
6. If it worked, the Nuvio tile is on the home screen.

> [!WARNING]
> Don't try to force it by writing launcher files yourself or by using the `1969` service menu. People have boot-looped their TVs that way, and there's no public way to recover them.
