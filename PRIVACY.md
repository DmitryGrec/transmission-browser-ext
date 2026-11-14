# Privacy policy: Transmission Remote

Transmission Remote is a browser extension that controls a Transmission BitTorrent server that you run
yourself. It has no server of its own, no analytics, no ads and no tracking.

## What it stores

- **Settings** you enter on its options page: your Transmission server address, username and password,
  the allowed download folders and on/off switches. They are kept in the browser's extension storage
  (`chrome.storage.sync`), which your browser syncs between your own devices if you have sync turned on.
- **The last download folders you used**, in local extension storage on this device.
- **A Transmission session id**, kept only until the browser closes.

You can delete all of it by removing the extension.

## What it sends, and to whom

- **To your Transmission server only** (the address you entered): requests to list, start, pause, remove
  and add torrents, including the `.torrent` file or magnet link you chose to add and your server
  username and password.
- **To the website a `.torrent` link points to**: when you click such a link, the extension downloads that
  file the way the browser would, with that site's own cookies and the page you clicked on as referrer,
  so that sites which need you to be logged in still work. Those cookies are only read for, and only sent
  to, that same site, and are not stored.

Nothing is sent to the extension's author or to any other third party.

## Why it asks for its permissions

- **Read and change data on all websites** (`<all_urls>`): to notice clicks on `.torrent` and magnet
  links on any page, to download `.torrent` files from whichever site hosts them, and to reach your
  Transmission server at whatever address you give it. Page content is not read or collected.
- **Cookies** and **declarativeNetRequestWithHostAccess**: to download a `.torrent` file with the hosting
  site's login cookies (see above).
- **Downloads** and **downloads.ui**: to pick up `.torrent` files the browser starts downloading, read
  them, delete the leftover copy, and hide the download bubble briefly while the add dialog is open.
- **Context menus**: the "Add to Transmission…" entry on `.torrent` links.
- **Storage** and **alarms**: settings, and refreshing the toolbar badge once a minute.
