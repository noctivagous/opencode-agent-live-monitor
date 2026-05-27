#!/usr/bin/env bash
set -euo pipefail

LABEL="com.aicodeeditor.monitor"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/${LABEL}" || true
fi

if [[ -f "${PLIST_PATH}" ]]; then
  rm -f "${PLIST_PATH}"
  echo "Removed ${PLIST_PATH}"
else
  echo "No plist found at ${PLIST_PATH}"
fi

echo "Uninstalled ${LABEL}"
