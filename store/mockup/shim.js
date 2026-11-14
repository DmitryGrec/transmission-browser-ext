// Screenshot harness: fakes the chrome.* APIs and a Transmission server so the real pages render.
(() => {
  const qs = new URLSearchParams(location.search);
  const lang = qs.get("lang") || "en";
  const xhr = new XMLHttpRequest();
  xhr.open("GET", "/demo.b64", false); xhr.send();
  const demo = xhr.responseText.trim();

  const data = {
    sync: { url: "192.168.1.10", allowedDirs: ["", "linux-isos", "movies/open", "backups"], defaultDir: "movies/open", language: lang },
    local: { recentSubdirs: ["movies/open"] },
    session: { "add-demo": { url: "https://download.example.org/blender-open-movies.torrent", data: demo, referrer: "https://download.example.org/" } },
  };
  const area = (name) => ({
    async get(keys) {
      const d = data[name];
      if (keys == null) return { ...d };
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in d).map((k) => [k, d[k]]));
      return Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, k in d ? d[k] : v]));
    },
    async set(o) { Object.assign(data[name], o); },
    async remove() {},
  });
  const noop = () => {};
  const ev = { addListener: noop, removeListener: noop };
  window.chrome = {
    storage: { sync: area("sync"), local: area("local"), session: area("session"), onChanged: ev },
    runtime: { id: "ebhdpnafjolpgegnlgphcnbkmloipopm", getURL: (p) => "/" + p, sendMessage: async () => {}, openOptionsPage: noop },
    i18n: { getAcceptLanguages: async () => [lang], getUILanguage: () => lang },
    permissions: { contains: async () => true, request: async () => true },
    tabs: { create: noop, sendMessage: async () => null },
    extension: { isAllowedFileSchemeAccess: async () => true },
    downloads: { onChanged: ev, search: async () => [], removeFile: async () => {}, erase: async () => {} },
    cookies: { getAll: async () => [] },
    declarativeNetRequest: { updateSessionRules: async () => {} },
  };

  const G = 1024 ** 3, M = 1024 ** 2;
  const torrents = [
    { name: "ubuntu-24.04.3-desktop-amd64.iso", status: 4, percentDone: 0.634, sizeWhenDone: 6.1 * G, rateDownload: 11.8 * M, rateUpload: 420e3, eta: 214, peersConnected: 48, peersSendingToUs: 31, downloadDir: "/srv/torrents/linux-isos" },
    { name: "Blender Open Movies Collection", status: 4, percentDone: 0.218, sizeWhenDone: 6.65 * G, rateDownload: 6.4 * M, rateUpload: 96e3, eta: 1012, peersConnected: 22, peersSendingToUs: 14, downloadDir: "/srv/torrents/movies/open" },
    { name: "Fedora-Workstation-Live-x86_64-43", status: 6, percentDone: 1, sizeWhenDone: 2.3 * G, rateUpload: 1.9 * M, uploadRatio: 2.47, peersGettingFromUs: 7, downloadDir: "/srv/torrents/linux-isos" },
    { name: "debian-13.1.0-amd64-DVD-1.iso", status: 6, percentDone: 1, sizeWhenDone: 3.9 * G, rateUpload: 640e3, uploadRatio: 1.12, peersGettingFromUs: 3, downloadDir: "/srv/torrents/linux-isos" },
    { name: "archlinux-2025.11.01-x86_64.iso", status: 3, percentDone: 0, sizeWhenDone: 1.4 * G, downloadDir: "/srv/torrents/linux-isos" },
    { name: "Wikipedia offline (kiwix) – wikipedia_en_all_maxi", status: 0, percentDone: 0.412, sizeWhenDone: 102 * G, downloadDir: "/srv/torrents/backups" },
    { name: "LibreOffice_25.8_Win_x86-64.msi", status: 0, percentDone: 1, sizeWhenDone: 352 * M, uploadRatio: 3.2, downloadDir: "/srv/torrents" },
  ].map((t, i) => ({ id: i + 1, rateDownload: 0, rateUpload: 0, eta: -1, error: 0, errorString: "", uploadRatio: 0,
    peersConnected: 0, peersSendingToUs: 0, peersGettingFromUs: 0, recheckProgress: 0, queuePosition: i,
    totalSize: t.sizeWhenDone, leftUntilDone: 0, isFinished: false, addedDate: 0, ...t }));

  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    if (!String(url).includes("/transmission/rpc")) return realFetch(url, opts);
    const { method, arguments: a } = JSON.parse(opts.body);
    let r = {};
    if (method === "torrent-get") r = { torrents };
    else if (method === "session-get") r = { "download-dir": "/srv/torrents", version: "4.0.6 (38c164933e)" };
    else if (method === "free-space") r = { path: a.path, "size-bytes": 1.62 * 1024 ** 4 };
    return new Response(JSON.stringify({ result: "success", arguments: r }), { headers: { "Content-Type": "application/json" } });
  };
})();
