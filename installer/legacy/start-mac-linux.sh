#!/bin/bash
# Start the legacy installer server (server.py next to this script).
#
# Without root it only serves the built app over http on port 4173 (run
# `npm run package:vidaa` in the repository first). The DNS spoofing and HTTPS
# parts of the home screen installer need ports 53 and 443, so run it with
# sudo for those.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "======================================================="
echo "  Starting Nuvio TV Server for Hisense VIDAA OS (legacy)"
echo "======================================================="
echo ""

if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 could not be found. Please install Python 3."
    exit 1
fi

ROOT="$(cd "$DIR/../.." && pwd)"
if [ ! -f "$ROOT/dist/vidaa/app.bundle.js" ] && [ ! -f "$ROOT/dist/app.bundle.js" ]; then
    echo "[WARN] No built app found in $ROOT/dist. Run 'npm run package:vidaa' first,"
    echo "[WARN] otherwise only the installer page is served."
    echo ""
fi

if [ "$EUID" -ne 0 ]; then
    echo "[TIP] Running without sudo: only the web server on port 4173 will start."
    echo "[TIP] For the home screen installer (ports 53/443), re-run with sudo."
    echo "[TIP] The tile tool needs no root: npm run vidaa:tile (docs/vidaa-tile.md)."
    echo ""
fi

exec python3 server.py
