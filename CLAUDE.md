# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Microsoft Edge (Chromium) extension, "Transmission Remote", that talks to a Transmission
BitTorrent server over its JSON-RPC API. Plain ES modules, HTML and CSS: no build step, no package
manager, no dependencies, no tests, no linter.

## Running / developing

- Load it unpacked: `edge://extensions` → Developer mode → **Load unpacked** → pick this folder (the one
  with `manifest.json`).
- After changing files: **Reload** on the extension card. Content-script changes also need the web page
  reloaded. The popup, options page and add dialog pick up changes when reopened.
- Debug the background worker via the "service worker" link on the extension card; the popup via
  right-click → Inspect.
- `manifest.json` has a `key` (public key only) that pins the extension ID to
  `ebhdpnafjolpgegnlgphcnbkmloipopm` wherever it is loaded unpacked, so `chrome.storage.sync` settings
  are shared between PCs. Do not change or remove it, or synced settings are lost. Remove it only for a
  store upload if the store rejects it.
- Distribution is by zipping the folder (`transmission-edge.zip`, mentioned in the README). The store
  package `dist/transmission-edge-<version>.zip` holds only the runtime files (`manifest.json`,
  `background/`, `content/`, `popup/`, `options/`, `add/`, `lib/`, `icons/`, `_locales/`), not `.idea`,
  docs or `dist/`. `PRIVACY.md` is the store privacy policy and
  explains each permission; update it when permissions or data flows change.
- Messages from content scripts come from arbitrary pages: `background.js` validates their URLs/data, and
  `content.js` ignores untrusted (script-generated) clicks.

## Architecture

Layout: `manifest.json`, `_locales/` and `icons/` stay at the root (Edge requires it). Each entry point has
its own folder holding its HTML/JS/CSS: `background/`, `content/`, `popup/`, `options/`, `add/`. Shared
modules live in `lib/` and are imported as `../lib/<name>.js`. Extension URLs are built from the root,
e.g. `chrome.runtime.getURL("add/add.html")`. File names below are given without their folder.

Entry points (all wired in `manifest.json`):

- `background.js`: module service worker. Toolbar badge (refreshed by a 1-minute alarm and on any
  `chrome.storage.sync` change), the "Add to Transmission…" link context menu (only on `*.torrent` URLs, via
  `targetUrlPatterns`), and catching
  `.torrent` downloads via `chrome.downloads.onCreated`. It lets Edge finish the download and passes its
  `downloadId` (plus the referring tab) to the add dialog, which deletes the file once done. Meanwhile
  Edge's download bubble is hidden with `chrome.downloads.setUiOptions` (`downloads.ui` permission).
  That setting affects every download, so it is restored when the download is erased, when the dialog
  window closes, after a 3-minute safety alarm, and on startup. Pending ids live in `chrome.storage.session`
  because the worker can be suspended. Opens the options page on first install or when no server is set.
- `content.js`: injected into every page and frame at `document_start`. Not a module, so it cannot import
  `rpc.js`. Intercepts left-clicks on `magnet:` and `*.torrent` links. For `.torrent` it tries a
  same-origin `fetch` with page cookies and sends the base64 bytes along. Ctrl/Shift/Alt/Meta-click sends
  a `bypass` message so the download catcher leaves that URL alone for 60 s.
- `popup.html/js`: torrent list with filters and start/pause/remove. Polls `torrent-get` every
  `refreshSeconds` (fixed at 3 in `DEFAULTS`, not shown in the options page). Rows are reused by torrent id so open delete confirmations survive refreshes.
- `options.html/js`: server connection, and the allowed download folders. "Test connection" requests the host
  permission for the server origin at runtime (`chrome.permissions.request`) and suggests subfolders from
  existing torrents' `downloadDir`. Every option saves as soon as it changes (there is no Save
  button); only the address row (default protocol, address, default port) waits for a
  successful "Test connection". `url` is stored as typed; `baseUrl()` in `rpc.js` resolves it with
  `defaultProtocol`/`defaultPort`.
- `add.html/js`: the "Add torrent" popup window.

Shared modules:

- `rpc.js`: settings (`DEFAULTS` plus `getSettings()` over `chrome.storage.sync`, so settings follow the browser profile; older local settings are moved over once), the RPC client,
  server-address normalisation, `cleanSubdir()`, base64 helpers, `FIELDS` and the `STATUS` codes.
- `i18n.js`: localization. It loads `_locales/<code>/messages.json` itself (plus `en` as fallback)
  instead of using `chrome.i18n.getMessage`, because `chrome.i18n` only follows Edge's display language
  and cannot be switched. The `language` setting picks the language; `"auto"` takes the first supported
  one from the profile's preferred languages (`chrome.i18n.getAcceptLanguages()`), then the display
  language. Exports `ready` (pages `await ready` at top level; the service worker cannot use top-level
  await, so it awaits it in handlers and calls `loadLanguage()` when `language` changes), `t()`,
  `plural()` (`key_one`/`_few`/`_many`/`_other` via `Intl.PluralRules`), `num()`, `bytes()`, `lang`,
  `LANGUAGES` and `localize()`, which fills `data-i18n`, `data-i18n-html`, `data-i18n-title` and
  `data-i18n-placeholder` elements (and `<template>` contents). Only the manifest's `__MSG_…__` strings
  (name, description, toolbar title) still follow Edge's display language.
- `bencode.js`: bencode decoder plus `parseTorrent()` (v1 single/multi-file and v2 `file tree`) and
  `parseMagnet()`.

### Flows worth knowing

- **Opening the add dialog**: every source (content script click, context menu, caught download) ends in
  `openAddDialog()` in `background.js`. It stores `{url, data, referrer, tabId, frameId, downloadId}` in
  `chrome.storage.session` under a random key and opens `add.html?key=…`, which reads and deletes that key.
- **Getting the .torrent bytes** (`loadTorrent()` in `add.js`): requests must look like the browser's own
  in the user's current session. Many trackers (e.g. behind Cloudflare) answer 403 to a request from the
  extension itself (extension Origin, cross-site `Sec-Fetch-*`, missing cookies). In order:
  1. bytes the content script already fetched (`data`);
  2. the file Edge downloaded (`downloadId`). It is read with XHR on a `file://` URL, which only works when
     "Allow access to file URLs" is on, because `fetch()` rejects `file:`;
  3. a `fetch-torrent` message to `content.js` in the source tab/frame, which fetches same-origin with the
     page's session;
  4. a fetch from the extension, with `addHeaderRule()` adding a temporary `declarativeNetRequest` session
     rule that sets `cookie`/`referer` for that host only.

  If all of these fail, the dialog shows where Edge saved the file and offers a file picker, "Download in
  browser" and a link to turn on file access. Pressing Add sends the URL instead (`filename` rather than
  `metainfo`), so Transmission fetches it itself. Edge's copy is deleted (`discardDownload()`) after the
  torrent is read, added or cancelled.
- **RPC session handshake**: Transmission answers 409 with `X-Transmission-Session-Id`. `rpc()` caches it in
  `chrome.storage.session` (`sid`) and retries once. Errors are `RpcError` with a `kind`
  (`config | auth | network | rpc | http`); the UI uses `kind` to decide whether to offer an
  "Open settings" button.

### Invariant: downloads stay inside `download-dir`

Torrents may only be saved to the folders listed in `allowedDirs`, all below Transmission's `download-dir`
(`""` is `download-dir` itself, and is in the list by default). `cleanSubdir()` rejects absolute paths, drive letters, `~`, `..` and control characters.
The add dialog cleans the stored list again, builds the `<select>` only from it, and re-checks the chosen
value against it on submit before joining it onto `download-dir`. Keep all three checks when changing
folder handling.

### Conventions

- Settings: add new ones to `DEFAULTS` in `rpc.js`. Simple form fields are autosaved through the `SIMPLE`
  list and `fieldValue()` in `options.js`.
- Other storage keys outside `DEFAULTS`: `recentSubdirs` (local, the last folders used, the first one is
  preselected unless the `defaultDir` setting names an allowed folder; `null` means "last used"); `sid` and `add-*` job keys (session).
- Popup/dialog → background messages: the string `"refresh-badge"`, and objects `{type: "bypass"}` and
  `{type: "add-torrent"}`.
- Torrent status codes: 0 paused, 1–2 verify, 3 queued, 4 downloading, 5–6 seeding.
- UI text: never hard-code it. Add the key to `_locales/en/messages.json` (the `default_locale` and
  fallback) and to every other locale (`ru`, `de`, `es`, `pt_BR`, `zh_CN`, `fr`), keeping the same `$1`…
  placeholders and, for `*Html` keys, the same tags (`hintHtml` must keep `id="webLink"`). The manifest
  uses `__MSG_extName__` etc. To add a language, add its folder and an entry in `LANGUAGES` in `i18n.js`;
  the options page lists it automatically. Changing `language` reloads the options page.
