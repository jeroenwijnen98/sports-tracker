#!/bin/bash
# Installs (or refreshes) /Applications/SportsTracker.app from the copy in this repo.
# Only needed when SportsTracker.app itself changes — never when the app's own
# code (server.js, public/, src/) changes.
set -e
cd "$(dirname "$0")"
rm -rf /Applications/SportsTracker.app
cp -R SportsTracker.app /Applications/SportsTracker.app
codesign --force -s - /Applications/SportsTracker.app
echo "Installed /Applications/SportsTracker.app"
