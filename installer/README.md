# VIDAA installer

**Use the tile tool instead:** [`npm run vidaa:tile`](../docs/vidaa-tile.md). It
pairs with the TV by PIN and adds a launcher tile pointing at any address you
host — on Linux, macOS and Windows, without root or DNS changes.

The old DNS-spoofing installer has moved to [`legacy/`](./legacy). It needs root,
often fails on newer firmware, and the tile it creates is only a link that still
has to be served afterwards. It is kept for older TVs where the tile tool does
not work. Read [`legacy/README.md`](./legacy/README.md) first.
