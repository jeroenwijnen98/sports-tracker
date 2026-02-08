#!/bin/bash
cd "$(dirname "$0")"

# Check if Terminal had other windows open (if only 1 window, it was opened just for us)
TERMINAL_WINDOWS=$(osascript -e 'tell application "Terminal" to count windows' 2>/dev/null || echo 1)

# Find node
if command -v node &>/dev/null; then
  NODE=node
elif [ -x "/opt/homebrew/bin/node" ]; then
  NODE=/opt/homebrew/bin/node
elif [ -x "/usr/local/bin/node" ]; then
  NODE=/usr/local/bin/node
else
  osascript -e 'display alert "Node.js not found" message "Install it with: brew install node"'
  exit 1
fi

# If server is already running on port 3000, just open browser
if lsof -ti:3000 &>/dev/null; then
  open "http://localhost:3000"
else
  # Start server in background (survives terminal close)
  nohup $NODE server.js > /dev/null 2>&1 &

  # Wait for server to be ready, then open browser
  for i in {1..20}; do
    sleep 0.5
    curl -s -o /dev/null http://localhost:3000 && break
  done
  open "http://localhost:3000"
fi

# If Terminal was opened just for this script, quit it entirely; otherwise just close this window
if [ "$TERMINAL_WINDOWS" -le 1 ]; then
  osascript -e 'tell application "Terminal" to quit' 2>/dev/null &
else
  osascript -e 'tell application "Terminal" to close front window' 2>/dev/null &
fi
exit 0
