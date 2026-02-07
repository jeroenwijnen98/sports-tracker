#!/bin/bash
cd "$(dirname "$0")"

# Find node
if command -v node &>/dev/null; then
  NODE=node
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE=/opt/homebrew/bin/node
elif [ -x "/usr/local/bin/node" ]; then
  NODE=/usr/local/bin/node
else
  echo "Node.js not found. Install it with: brew install node"
  read -p "Press Enter to close..."
  exit 1
fi

# Open browser and hide Terminal window after a short delay
(sleep 1 && open "http://localhost:3000" && osascript -e 'tell application "System Events" to set visible of process "Terminal" to false') &

echo "Starting Sports Tracker on http://localhost:3000"
$NODE server.js
