// Intercepts clicks on .torrent and magnet links and hands them to the extension's add dialog.
(() => {
  let enabled = true;
  // Settings are in storage.sync (see rpc.js). Until the extension migrates older local settings,
  // the default (true) applies.
  chrome.storage.sync.get({ interceptClicks: true }, (s) => (enabled = s.interceptClicks));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "sync" && c.interceptClicks) enabled = c.interceptClicks.newValue;
  });

  function torrentLink(a) {
    if (!a || !a.href) return null;
    let u;
    try { u = new URL(a.href, location.href); } catch { return null; }
    if (u.protocol === "magnet:") return { kind: "magnet", url: u.href };
    if ((u.protocol === "http:" || u.protocol === "https:") && /\.torrent$/i.test(u.pathname)) return { kind: "file", url: u.href };
    return null;
  }

  async function fetchHere(url) {
    // Fetching from the page keeps the site's login cookies; works for same-origin links.
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] !== 0x64) return null; // bencoded torrents start with "d"
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    } catch {
      return null;
    }
  }

  // The add dialog asks the page to download a torrent for it, so the request goes out exactly like
  // the site's own (same origin, the site's cookies and this page as Referer).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "fetch-torrent") return;
    fetchHere(msg.url).then((data) => sendResponse({ data }));
    return true;
  });

  document.addEventListener(
    "click",
    async (ev) => {
      // isTrusted: ignore clicks the page fakes with element.click() / dispatchEvent, so a site can't
      // pop up the add dialog (or set a bypass) on its own. chrome.runtime.id is gone after the
      // extension was reloaded; then leave the click to the browser instead of swallowing it.
      if (!enabled || !ev.isTrusted || ev.button !== 0 || !chrome.runtime?.id) return;
      const link = torrentLink(ev.target.closest && ev.target.closest("a[href]"));
      if (!link) return;
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) {
        // Let the browser handle it, and tell the download catcher to leave this one alone.
        chrome.runtime.sendMessage({ type: "bypass", url: link.url });
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const data = link.kind === "file" ? await fetchHere(link.url) : null;
      chrome.runtime.sendMessage({ type: "add-torrent", url: link.url, data, referrer: location.href });
    },
    true
  );
})();
