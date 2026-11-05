#!/usr/bin/env bash
# Installs / removes a macOS LaunchAgent that runs the Agent Office server (production build) at login.
#   scripts/launchagent.sh install     build, write the plist, load it
#   scripts/launchagent.sh uninstall   unload and delete the plist
#   scripts/launchagent.sh restart     restart the server with its current settings (used after an update)
#   scripts/launchagent.sh status
# Options via env: PORT (default 4317), DEMO (default 1 = demo until real events arrive),
# UPDATE_CHECK (default 1 = daily look for a new release; 0 = off).
# USAGE_POLL (default 0; 1 = poll Claude usage for the whiteboard pies, see docs/configuration.md).
set -euo pipefail

LABEL="com.agent-office.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/agent-office.log"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4317}"
DEMO="${DEMO:-1}"
UPDATE_CHECK="${UPDATE_CHECK:-1}"
USAGE_POLL="${USAGE_POLL:-0}"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
  install)
    NODE="$(command -v node)"
    [ -x "$NODE" ] || { echo "node not found in PATH" >&2; exit 1; }
    (cd "$ROOT" && pnpm build >/dev/null)
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--import</string>
    <string>tsx</string>
    <string>server/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>$PORT</string>
    <key>DEMO</key><string>$DEMO</string>
    <key>UPDATE_CHECK</key><string>$UPDATE_CHECK</string>
    <key>USAGE_POLL</key><string>$USAGE_POLL</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed $PLIST → http://localhost:$PORT (logs: $LOG)"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $LABEL"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Restarted $LABEL"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "state|pid|last exit" || echo "not loaded"
    curl -s "http://localhost:$PORT/health" && echo
    ;;
  *)
    echo "usage: $0 install|uninstall|restart|status" >&2
    exit 1
    ;;
esac
