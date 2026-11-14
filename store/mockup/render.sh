#!/usr/bin/env bash
# Regenerates store/images/*.png from the real extension pages with a fake chrome.* API and fake
# Transmission server (shim.js). Needs Git Bash, Python 3 and Edge. Run: bash store/mockup/render.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; MOCK="$ROOT/store/mockup"; OUT="$ROOT/store/images"
WORK="$(mktemp -d)"; SITE="$WORK/site"; mkdir -p "$SITE" "$OUT"
cp -r "$ROOT"/{background,content,popup,options,add,lib,icons,_locales,manifest.json} "$MOCK"/{shim.js,stage.html,demo.b64} "$SITE/"
for f in popup/popup.html add/add.html options/options.html; do
  sed -i 's#<script type="module"#<script src="/shim.js"></script>\n  <script type="module"#' "$SITE/$f"
done
python -m http.server 8765 --bind 127.0.0.1 --directory "$SITE" >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV; rm -rf "$WORK"' EXIT
sleep 1
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
shot() { "$EDGE" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$(cygpath -w "$WORK/prof")" \
  --virtual-time-budget=6000 --force-device-scale-factor=1 $5 --window-size=$2,$3 \
  --screenshot="$(cygpath -w "$OUT/$1.png")" "http://127.0.0.1:8765/stage.html?$4" 2>/dev/null; }
L=--blink-settings=preferredColorScheme=1
shot screenshot-1-popup 1280 800 "s=1" $L
shot screenshot-2-add-dialog 1280 800 "s=2" $L
shot screenshot-3-settings 1280 800 "s=3" $L
shot screenshot-4-languages-dark 1280 800 "s=4&lang=de" --force-dark-mode
shot promo-small-440x280 440 280 "tile=small" $L
shot promo-large-1400x560 1400 560 "tile=large" $L
cp "$ROOT/icons/icon128.png" "$OUT/logo-128.png"
echo "Images written to $OUT"
