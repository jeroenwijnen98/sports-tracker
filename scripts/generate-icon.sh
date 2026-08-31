#!/bin/bash
# Regenerates the .app bundle's icon from public/logo.png, the same image the
# browser tab uses. The .icns inside the bundle must be a real file, not a
# symlink — `cp -R` into /Applications would leave a symlink dangling.
#
# Uses only macOS built-ins (sips, iconutil); no Homebrew dependency.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="public/logo.png"
BUNDLE_ICNS="SportsTracker.app/Contents/Resources/icon.icns"
mkdir -p assets "$(dirname "$BUNDLE_ICNS")"

[ -f "$SRC" ] || { echo "$SRC not found" >&2; exit 1; }

# The logo is not square (631x642); pad it onto a square canvas first, or every
# slice below comes out stretched.
WORK="$(mktemp -d)"
sips -s format png "$SRC" --out "$WORK/square.png" >/dev/null
sips -p 642 642 "$WORK/square.png" --out "$WORK/square.png" >/dev/null

ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$WORK/square.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$WORK/square.png" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o assets/icon.icns
cp assets/icon.icns "$BUNDLE_ICNS"
rm -rf "$WORK"

echo "Regenerated from $SRC:"
echo "  assets/icon.icns"
echo "  $BUNDLE_ICNS"
