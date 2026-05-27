#!/usr/bin/env bash
set -euo pipefail

LABEL="com.aicodeeditor.monitor"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${LAUNCH_AGENTS_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs"
STDOUT_LOG="${LOG_DIR}/aicodeeditor-monitor.log"
STDERR_LOG="${LOG_DIR}/aicodeeditor-monitor.err.log"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-}"

if [[ "${MODE}" == "--watch" ]]; then
  NPM_SCRIPT="start:watch"
elif [[ "${MODE}" == "--stable" || -z "${MODE}" ]]; then
  NPM_SCRIPT="start"
else
  echo "Unknown mode: ${MODE}"
  echo "Usage: npm run launchd:install -- [--watch|--stable]"
  exit 1
fi

mkdir -p "${LAUNCH_AGENTS_DIR}" "${LOG_DIR}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "${PROJECT_DIR}" && npm run ${NPM_SCRIPT}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${STDOUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${STDERR_LOG}</string>
</dict>
</plist>
EOF

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)/${LABEL}" || true
fi

launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl enable "gui/$(id -u)/${LABEL}" || true
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "Installed ${LABEL} at ${PLIST_PATH}"
echo "Mode: ${NPM_SCRIPT}"
echo "Logs: ${STDOUT_LOG} / ${STDERR_LOG}"
