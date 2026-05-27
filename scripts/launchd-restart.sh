#!/usr/bin/env bash
set -euo pipefail

LABEL="com.aicodeeditor.monitor"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if [[ ! -f "${PLIST_PATH}" ]]; then
  echo "LaunchAgent not installed: ${PLIST_PATH}"
  echo "Run: npm run launchd:install -- --watch"
  exit 1
fi

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
else
  launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
  launchctl enable "gui/$(id -u)/${LABEL}" || true
  launchctl kickstart -k "gui/$(id -u)/${LABEL}"
fi

echo "Restarted ${LABEL}"
