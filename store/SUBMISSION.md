# Publishing to Edge Add-ons

Everything needed for the submission is in this folder:

- `build.ps1` builds the package `dist/transmission-edge-<version>.zip`.
- `LISTING.md` holds the description, search terms and properties for every language.
- `images/` holds the logo, promo tiles and screenshots. `mockup/render.sh` regenerates them from
  the real pages after UI changes.

## 1. Developer account (one time, free)

1. Go to <https://partner.microsoft.com/dashboard/microsoftedge/overview> and sign in with a Microsoft
   account.
2. Register as an **Individual** developer. Registration for Edge add-ons is free. Microsoft verifies
   the email, and this can take a day or two.
3. The publisher display name you choose is shown on the store page.

## 2. Build the package

```
pwsh store/build.ps1
```

Before each new upload, raise `version` in `manifest.json`. The store refuses a version it has
already received.

## 3. Create the submission

Partner Center → Microsoft Edge → **Create new extension** → upload
`dist/transmission-edge-1.0.0.zip`. Then fill in each page:

- **Availability**: Visibility *Public*, Markets *all*.
- **Properties**: use the table at the top of `LISTING.md`.
- **Store listings**: add the languages the extension has (English, German, Spanish, French,
  Portuguese (Brazil), Russian, Chinese (Simplified)). Paste each language's description and search
  terms, and upload the same images for each language.
- **Submit**: paste the notes below into **Notes for certification**.

Review usually takes up to 7 business days. Partner Center emails the result.

### Notes for certification (paste as is)

```
Transmission Remote is a remote control for a Transmission BitTorrent server (https://transmissionbt.com) that the user runs themselves (home server, NAS or seedbox). It has no backend of its own and sends data only to the server address the user enters.

HOW TO TEST
1. Start a Transmission server, for example with Docker:
   docker run -d -p 9091:9091 lscr.io/linuxserver/transmission
   (or install Transmission on any PC and turn on Preferences → Remote → Allow remote access).
2. The settings page opens on install. Enter 127.0.0.1 (or the server's IP) as the address, leave the protocol http and the port 9091, and press "Test connection". It should say "Connected to Transmission <version>".
3. Open https://ubuntu.com/download/alternative-downloads and click any ".torrent" link: an "Add torrent" window opens with the file list and a folder choice. Press Add.
4. Click the toolbar icon: the torrent appears in the list with its progress. Try pause, start and remove.

PERMISSIONS
- <all_urls> host access and the content script: to notice clicks on .torrent and magnet links on any page, to download .torrent files from whichever site hosts them, and to reach the user's server at any address. Page content is not read or collected.
- cookies, declarativeNetRequestWithHostAccess: to download a .torrent file with the hosting site's own cookies and referrer (sites that need a login). Cookies are only sent back to that same site.
- downloads, downloads.ui: to pick up a .torrent file the browser starts downloading, read it, delete the leftover copy and briefly hide the download bubble while the add dialog is open.
- contextMenus: "Add to Transmission…" on .torrent links. storage, alarms: settings and a 1-minute badge refresh.

Privacy policy: https://github.com/DmitryGrec/transmission-browser-ext/blob/main/PRIVACY.md
```

## Before you submit: things to check

- **The icon.** `icons/icon128.png` closely resembles the official Transmission app icon. Reviewers
  reject extensions whose logo copies another product's branding. The word "Transmission" in the name
  is normally fine because it describes what the extension works with, and every description ends with
  a "not affiliated" line. The icon is the bigger risk. The safest route is an original icon. If it
  gets rejected, the icon is the first thing to replace.
- **Logo size.** Partner Center asks for a square logo of at least 128×128 and recommends 300×300.
  `images/logo-128.png` is the 128 px icon. A 300 px version needs a new drawing, because enlarging the
  128 px image would blur it.
- **The manifest `key`.** The package keeps it, so a store install would get the same ID as the
  unpacked copy. If Partner Center refuses the upload over `key`, rebuild with
  `pwsh store/build.ps1 -StripKey`. The store assigns its own ID in that case, so settings synced
  from the unpacked copy will not carry over. Users set the extension up once more.
- **Updating the published version.** Raise `version`, rebuild, then in Partner Center open the extension
  → **Packages** → **Replace** → **Publish**.
- **Optional: Chrome Web Store.** The same zip works there too (one-time fee of US$5). The Chrome
  store does reject `key`, so use `-StripKey`.
