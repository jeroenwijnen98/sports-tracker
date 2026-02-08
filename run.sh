#!/bin/bash

PROJECT_DIR="/Users/marcwijnen/Documents/GitHub/_apps/sports-tracker"
NODE="/usr/local/bin/node"
LOG="$PROJECT_DIR/logs/sync.log"

cd "$PROJECT_DIR"
echo "--- $(date '+%Y-%m-%d %H:%M:%S') ---" >> "$LOG"
"$NODE" scripts/sync.js >> "$LOG" 2>&1
