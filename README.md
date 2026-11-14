# Transmission Remote (Microsoft Edge extension)

Shows what your Transmission server is doing and lets you start, pause and remove torrents.
Clicking a `.torrent` or magnet link on any web page opens an "Add torrent" dialog with the
torrent's details, a file list and a choice of download folder.
Everything else (speed limits, queue, default folders, etc.) stays in the Transmission web interface,
which the ↗ button in the popup opens.

## Install (load unpacked)

1. Download this `transmission-edge` folder (or unzip `transmission-edge.zip`) somewhere permanent,
   for example `C:\Tools\transmission-edge`. Edge loads it from there each time, so don't delete it.
2. In Edge, open `edge://extensions`.
3. Turn on **Developer mode** (left sidebar or bottom left).
4. Click **Load unpacked** and pick the `transmission-edge` folder (the one containing `manifest.json`).
5. Click the puzzle-piece icon in the toolbar and pin **Transmission Remote**.

On first start the settings page opens by itself:
1. **Server**: type the IP or URL of your Transmission (e.g. `192.168.1.10`). If you leave out the protocol
   or port, the defaults are used (http and 9091, both changeable). Add a username/password if your server
   needs one, then press **Test connection**. The address is saved once the test succeeds.
2. **Allowed download folders**: once connected, the page shows the server's `download-dir`. Add the
   subfolders torrents may be saved to (e.g. `movies`, `tv/series`); folders your torrents already use are
   offered as one-click suggestions. `download-dir` itself is in the list by default (remove it with ✕
   if you don't want that). **Set default** picks the folder the add dialog preselects.

Everything else saves as soon as you change it; there is no Save button.

You can come back any time via ⚙ in the popup or right-click the icon → **Extension options**.

To update after changing files: `edge://extensions` → **Reload** on the extension card.

## What it does

**Popup**
- Total download/upload speed, start all / pause all, link to the web interface.
- Filters: All, Active, Downloading, Seeding, Paused (with counts).
- Each torrent: name, progress bar, status (peers, ETA, ratio, errors) and speeds.
- ▶ / ❚❚ starts or pauses a torrent. ✕ asks: **Remove** (keep the files) or **Remove + delete data**.
- Refreshes every 3 seconds while open.

**Toolbar badge**: number of downloading torrents (red if any torrent has an error, "!" if the server
can't be reached). Can be turned off in options.

**Adding torrents**
- Click a `.torrent` or `magnet:` link: an "Add torrent" window opens with name, size, tracker, comment,
  and the file list with checkboxes to skip files you don't want.
- "Download to" only offers the allowed folders from the settings page, all inside Transmission's
  `download-dir` (e.g. `movies` → `<download-dir>/movies`). Absolute paths, drive letters, `~` and `..`
  are rejected when you add folders, so nothing can be saved outside `download-dir`. The default folder
  (or, if none is set, the last folder you used) is preselected, and free space is shown.
- "Start downloading right away" can be unticked to add paused.
- Right-click a `.torrent` link → **Add to Transmission…** opens the same dialog (the menu entry only
  appears on `.torrent` links).
- Links that don't end in `.torrent` (e.g. `download.php?id=…`): just click them; when Edge starts
  downloading a torrent file the extension catches it and opens the same dialog.
- Sites that need your login or sit behind Cloudflare (e.g. rutracker's `dl.php`): the extension uses the
  file Edge itself downloaded, or asks the page to fetch it with your current session. For the smoothest
  experience turn on **Allow access to file URLs** on the extension's card in `edge://extensions` (the
  extension's Details page); without it, the dialog may ask you to choose the file Edge saved.
- Hold Ctrl/Shift while clicking to bypass the dialog and let Edge handle the link normally.
- Both behaviours can be turned off in options.

## Project layout

```
manifest.json      extension manifest (must stay at the root)
_locales/          translations (messages.json per language)
icons/             toolbar and store icons
background/        service worker (badge, context menu, download catcher)
content/           content script injected into web pages (link clicks)
popup/             toolbar popup (torrent list)
options/           settings page
add/               "Add torrent" dialog window
lib/               shared ES modules (RPC client, i18n, bencode parser)
```

## Notes
- On install Edge warns that the extension can "read and change all your data on all websites".
  That's needed to spot torrent links on any page and to download `.torrent` files from any site;
  the extension only sends data to your Transmission server. See [PRIVACY.md](PRIVACY.md).
- Settings, including the server password, are kept in Edge's synced extension storage, so they follow
  your Edge profile to other PCs. Use `https` if the server is reachable from outside your home
  network: with plain `http` the password travels unencrypted.
- If the popup says "Access denied", allow your PC's address in Transmission's `rpc-whitelist`
  (or turn the whitelist off) in `settings.json` on the server.
