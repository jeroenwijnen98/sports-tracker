#!/bin/bash
# Weekly Polar sync, run from the sleepwatcher wake script.
# PROJECT_DIR is derived from this script's own location so the repo can be
# moved without editing anything here.
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$PROJECT_DIR/logs/sync.log"
mkdir -p "$(dirname "$LOG")"
cd "$PROJECT_DIR" || exit 1

# Prefer the native arm64 Homebrew node; /usr/local is the x86_64 build, which
# runs under Rosetta. launchd/sleepwatcher gives us a bare PATH, so look in the
# known install locations rather than relying on `command -v node`.
if [ -x "/opt/homebrew/bin/node" ]; then
  NODE=/opt/homebrew/bin/node
elif [ -x "/usr/local/bin/node" ]; then
  NODE=/usr/local/bin/node
elif command -v node &>/dev/null; then
  NODE=$(command -v node)
else
  echo "node not found" >> "$LOG"
  exit 1
fi

echo "--- $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG"
"$NODE" scripts/sync.js >> "$LOG" 2>&1
