// Toolbar badge, context menu, download catching and opening the add dialog.
import { getSettings, getTorrents } from "../lib/rpc.js";
import { t, ready, loadLanguage } from "../lib/i18n.js";

const ALARM = "badge-refresh";

async function updateBadge() {
  await ready;
  const s = await getSettings();
  if (!s.url) {
    await chrome.action.setBadgeBackgroundColor({ color: "#777" });
    await chrome.action.setBadgeText({ text: "?" });
    await chrome.action.setTitle({ title: t("badgeNotSetUp") });
    return;
  }
  if (!s.badge) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  try {
    const torrents = await getTorrents(s);
    const downloading = torrents.filter((t) => t.status === 4).length;
    const errors = torrents.some((t) => t.error);
    await chrome.action.setBadgeBackgroundColor({ color: errors ? "#c62828" : "#2e7d32" });
    await chrome.action.setBadgeText({ text: downloading ? String(downloading) : "" });
    await chrome.action.setTitle({ title: t("badgeSummary", downloading, torrents.length) });
  } catch (e) {
    await chrome.action.setBadgeBackgroundColor({ color: "#777" });
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setTitle({ title: t("badgeError", e.message) });
  }
}

// ---------- add dialog ----------
// tabId/frameId: the page the link came from, so the dialog can fetch the file from inside that page
// (with the site's own session). downloadId: a download Edge already started for this torrent.
async function openAddDialog({ url, data, referrer, tabId, frameId, downloadId }) {
  const key = "add-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  await chrome.storage.session.set({
    [key]: {
      url,
      data: data || null,
      referrer: referrer || "",
      tabId: tabId ?? null,
      frameId: frameId ?? 0,
      downloadId: downloadId ?? null,
    },
  });
  let left, top;
  try {
    const w = await chrome.windows.getLastFocused();
    left = Math.round(w.left + (w.width - 600) / 2);
    top = Math.round(w.top + 80);
  } catch {}
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`add/add.html?key=${key}`),
    type: "popup",
    width: 600,
    height: url.startsWith("magnet:") ? 400 : 640,
    left,
    top,
    focused: true,
  });
  if (downloadId != null && win) await chrome.storage.session.set({ ["win-" + win.id]: downloadId }).catch(() => {});
}

// Dialog closed with its window's ✕: bring Edge's download UI back for that download.
chrome.windows.onRemoved.addListener(async (winId) => {
  const k = "win-" + winId;
  const id = (await chrome.storage.session.get(k).catch(() => ({})))[k];
  if (id == null) return;
  await chrome.storage.session.remove(k).catch(() => {});
  restoreDownloadUi(id);
});

async function setupMenu() {
  await ready;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "add-link",
      title: t("menuAdd"),
      contexts: ["link"],
      // Only links to .torrent files (optionally with a query string). Links such as dl.php?t=… are
      // still handled on a normal click, by catching the download Edge starts.
      targetUrlPatterns: ["*://*/*.torrent", "*://*/*.torrent?*", "*://*/*.TORRENT", "*://*/*.TORRENT?*"],
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-link" && info.linkUrl) {
    openAddDialog({ url: info.linkUrl, referrer: info.pageUrl, tabId: tab && tab.id, frameId: info.frameId });
  }
});

// Downloads don't say which tab started them; find the tab showing the referring page.
async function tabForReferrer(referrer) {
  try {
    if (referrer) {
      const exact = (await chrome.tabs.query({})).find((t) => t.url === referrer);
      if (exact) return exact.id;
    }
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active && referrer && active.url && new URL(active.url).origin === new URL(referrer).origin) return active.id;
  } catch {}
  return null;
}

// Catch .torrent files the browser is about to download (covers links like download.php?id=123).
const looksLikeTorrent = (item) =>
  item.mime === "application/x-bittorrent" || /\.torrent$/i.test(item.filename || "") || /\.torrent(\?|$)/i.test(item.finalUrl || item.url || "");

const bypass = new Map(); // url -> expiry time, for Ctrl+clicked links
const bypassed = (u) => [...bypass].some(([url, until]) => url === u && until > Date.now());

// While the add dialog handles a caught download, Edge's own download bubble is hidden so the user
// only sees the dialog. It comes back once those downloads are erased (the dialog does that), or
// after a safety alarm, since a hidden download UI would otherwise affect every download.
const UI_ALARM = "restore-download-ui";
async function hiddenDownloads() {
  try { return (await chrome.storage.session.get({ hiddenDownloads: [] })).hiddenDownloads; } catch { return []; }
}
async function hideDownloadUi(id) {
  try { await chrome.downloads.setUiOptions({ enabled: false }); } catch { return; }
  const ids = await hiddenDownloads();
  await chrome.storage.session.set({ hiddenDownloads: [...ids, id] }).catch(() => {});
  chrome.alarms.create(UI_ALARM, { delayInMinutes: 3 });
}
async function restoreDownloadUi(id) {
  let ids = [];
  if (id != null) {
    ids = (await hiddenDownloads()).filter((x) => x !== id);
    await chrome.storage.session.set({ hiddenDownloads: ids }).catch(() => {});
  } else {
    await chrome.storage.session.remove("hiddenDownloads").catch(() => {});
  }
  if (ids.length) return;
  chrome.alarms.clear(UI_ALARM);
  try { await chrome.downloads.setUiOptions({ enabled: true }); } catch {}
}
chrome.downloads.onErased.addListener(async (id) => {
  if ((await hiddenDownloads()).includes(id)) restoreDownloadUi(id);
});

chrome.downloads.onCreated.addListener(async (item) => {
  if (!looksLikeTorrent(item) || item.byExtensionId === chrome.runtime.id) return;
  if (bypassed(item.url) || bypassed(item.finalUrl)) return;
  if (!/^https?:/i.test(item.finalUrl || item.url)) return;
  if (!(await getSettings()).interceptDownloads) return;
  await hideDownloadUi(item.id);
  // Let Edge finish this download: its request carried the site's full session (cookies, Referer,
  // POST form data, ...), which a second request from the extension often can't reproduce. The add
  // dialog reads the finished file and then deletes it.
  const url = item.finalUrl || item.url;
  openAddDialog({ url, referrer: item.referrer, downloadId: item.id, tabId: await tabForReferrer(item.referrer) });
});

// ---------- lifecycle ----------
function init() {
  restoreDownloadUi(); // never leave Edge's download UI hidden across restarts
  chrome.alarms.create(ALARM, { periodInMinutes: 1 });
  setupMenu();
  updateBadge();
}
chrome.runtime.onInstalled.addListener(async (details) => {
  init();
  // First start: ask for the server and allowed folders.
  if (details.reason === "install" || !(await getSettings()).url) chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(init);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) updateBadge();
  else if (a.name === UI_ALARM) restoreDownloadUi();
});
chrome.storage.onChanged.addListener(async (c, area) => {
  if (area !== "sync") return;
  if (c.language) {
    await loadLanguage();
    setupMenu();
  }
  updateBadge();
});
// Messages also come from content scripts, which run on any page: check what they send.
const linkUrl = (u) => typeof u === "string" && u.length < 65536 && /^(magnet:|https?:\/\/)/i.test(u);
const MAX_TORRENT_B64 = 16 * 1024 * 1024;
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg === "refresh-badge") updateBadge();
  else if (!msg || typeof msg !== "object") return;
  else if (msg.type === "show-download-ui") restoreDownloadUi(msg.id);
  else if (msg.type === "bypass" && linkUrl(msg.url)) {
    const now = Date.now();
    for (const [u, until] of bypass) if (until <= now) bypass.delete(u);
    bypass.set(msg.url, now + 60000);
  } else if (msg.type === "add-torrent" && linkUrl(msg.url)) {
    if (msg.data != null && (typeof msg.data !== "string" || msg.data.length > MAX_TORRENT_B64)) msg.data = null;
    openAddDialog({
      url: msg.url,
      data: msg.data,
      referrer: msg.referrer || sender.url,
      tabId: sender.tab && sender.tab.id,
      frameId: sender.frameId,
    });
  }
});
