#!/bin/bash
# Builds Agent Office.app: menu bar lock screen + the scene server, the built scene and the Claude Code hooks installer.
#   lock/build.sh            build, install to ~/Applications, launch (uses this Mac's Node.js)
#   lock/build.sh build      build only → lock/build/Agent Office.app
#   lock/build.sh package    self-contained build with Node.js embedded → lock/build/AgentOffice.zip, to share
#   lock/build.sh uninstall  quit and remove the installed app
# SIGN_ID="Developer ID Application: …" signs with your certificate instead of ad hoc.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
MODE="${1:-install}"
APP="build/Agent Office.app"
DEST="$HOME/Applications/Agent Office.app"
RES="$APP/Contents/Resources"

if [ "$MODE" = "uninstall" ]; then
  pkill -x AgentOffice 2>/dev/null || true
  rm -rf "$DEST"
  echo "Removed $DEST (Claude Code hooks: node scripts/claude-hooks.mjs uninstall)"
  exit 0
fi

NODE="$(command -v node || true)"
[ -x "$NODE" ] || { echo "node not found in PATH (needed to build the scene)" >&2; exit 1; }
NODE="$(realpath "$NODE")" # version managers (fnm…) hand out per-shell paths that vanish

rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$RES/server/server"
cp Info.plist "$APP/Contents/Info.plist"

# Scene: production build, server bundled into one file (dev-only Vite left out), hooks installer.
(cd "$ROOT" && { [ -d node_modules ] || pnpm install --frozen-lockfile; } && pnpm build >/dev/null)
ESBUILD="$(echo "$ROOT"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild | awk '{print $1}')"
"$ESBUILD" "$ROOT/server/index.ts" --bundle --platform=node --format=esm --target=node20 --log-level=warning \
  --external:vite --external:bufferutil --external:utf-8-validate \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$RES/server/server/index.mjs"
cp -R "$ROOT/dist" "$RES/server/dist"
cp "$ROOT/scripts/claude-hooks.mjs" "$RES/claude-hooks.mjs"

# Icon, rendered at each size by the pixel engine (nearest neighbour keeps the pixels crisp).
ICONSET="build/AppIcon.iconset"; rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/app-icon.ts" "$ICONSET/icon_${s}x${s}.png" $s >/dev/null
  "$ROOT/node_modules/.bin/tsx" "$ROOT/scripts/app-icon.ts" "$ICONSET/icon_${s}x${s}@2x.png" $((s * 2)) >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"

swiftc -O -module-name AgentOffice \
  -framework AppKit -framework WebKit -framework LocalAuthentication -framework OpenDirectory \
  -framework Carbon -framework IOKit -framework ServiceManagement -framework ApplicationServices \
  -o "$APP/Contents/MacOS/AgentOffice" Sources/*.swift

if [ "$MODE" = "package" ]; then
  cp "$NODE" "$APP/Contents/MacOS/node"
else
  /usr/libexec/PlistBuddy -c "Add :AgentOfficeNode string $NODE" "$APP/Contents/Info.plist"
fi
codesign --force --sign "${SIGN_ID:--}" "$APP"
echo "Built $APP"

case "$MODE" in
  build) ;;
  package)
    rm -f build/AgentOffice.zip
    ditto -c -k --keepParent "$APP" build/AgentOffice.zip
    echo "Packaged lock/build/AgentOffice.zip ($(du -h build/AgentOffice.zip | cut -f1)) — Apple silicon, $("$NODE" --version) embedded"
    ;;
  *)
    pkill -x AgentOffice 2>/dev/null || true
    pkill -x AgentOfficeLock 2>/dev/null || true; rm -rf "$HOME/Applications/AgentOfficeLock.app" # pre-rename name
    mkdir -p "$HOME/Applications"
    rm -rf "$DEST"; cp -R "$APP" "$DEST"
    open "$DEST"
    echo "Installed $DEST (menu bar: lock icon, ⌃⌥⌘L to lock)"
    ;;
esac
