# Dunk Shot Offline (Chrome extension)

Replaces Chrome's "No internet" dinosaur with a Dunk Shot style game.

## Install (unpacked)
1. Unzip this folder somewhere permanent (Chrome reads it from disk each time).
2. Open chrome://extensions and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped `dunk-offline` folder.

## Test it
- **Game page only:** click the basketball icon in the toolbar (pin it from the puzzle menu). It opens the game in a new tab.
- **Real offline trigger:** turn Wi-Fi off, then open any site you haven't got cached (or press Enter on a reload). The tab should jump to the game.
- **See what Chrome reports:** on chrome://extensions click "service worker" under this extension. Every failed navigation logs its error string there. If the dino still shows, the logged error name tells you which string to add to `OFFLINE_ERRORS` in background.js.

## Files
- `manifest.json`  declares permissions and the background worker
- `background.js`  detects the offline error and redirects the tab
- `game/`          the game page (html, css, js), fully self-contained, works offline
- `icons/`         toolbar icons
