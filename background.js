/* =====================================================================
   background.js  -  the extension's "service worker"

   WHAT THIS FILE DOES
   Chrome fires `webNavigation.onErrorOccurred` whenever a page load fails.
   The event tells us which tab, which URL and an error string such as
   "net::ERR_INTERNET_DISCONNECTED". If the error means "you are offline",
   we point that tab at our game page instead of letting Chrome show the dino.

   WHY IT'S WRITTEN THIS WAY
   - A Manifest V3 service worker is started on demand and shut down when idle,
     so listeners MUST be registered at the top level of the file (not inside
     a function that runs later), or Chrome won't wake us up for the event.
   - We can't literally replace Chrome's built-in error page. We let it begin
     to load, then immediately navigate the tab somewhere else.
   ===================================================================== */

// The error strings that mean "your device has no internet".
// (Other errors, like a mistyped domain, keep Chrome's normal page: the dino
// only appears for no-connection, so we mirror that.)
const OFFLINE_ERRORS = [
  'net::ERR_INTERNET_DISCONNECTED',
  'net::ERR_NETWORK_CHANGED',
];

// Where the game lives inside the extension. getURL turns a relative path
// into a full chrome-extension://<id>/game/game.html address.
const GAME_PAGE = chrome.runtime.getURL('game/game.html');

chrome.webNavigation.onErrorOccurred.addListener((details) => {
  // Handy while testing: open chrome://extensions, click "service worker"
  // under this extension, and you'll see every failed navigation here.
  console.log('[dunk-offline] navigation error:', details.error, details.url);

  // frameId 0 = the tab's main page. Anything else is an iframe/ad/widget,
  // and we must not hijack the whole tab because an embedded frame failed.
  if (details.frameId !== 0) return;

  // Only react to "you're offline" errors.
  if (!OFFLINE_ERRORS.includes(details.error)) return;

  // Only hijack normal web pages (not chrome:// pages, files, etc.).
  const url = details.url || '';
  if (url && !/^https?:/i.test(url)) return;

  // Pass the original address along (?from=...) so the game page can offer
  // a one-click "open it again" once the connection returns.
  const target = url ? `${GAME_PAGE}?from=${encodeURIComponent(url)}` : GAME_PAGE;

  chrome.tabs.update(details.tabId, { url: target });
});

// Clicking the toolbar icon opens the game directly. This is the easy way
// to test the game page without having to switch your Wi-Fi off.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: GAME_PAGE });
});
