import { getSettings, rpc, toBase64, fromBase64, cleanSubdir, isConfigured } from "../lib/rpc.js";
import { parseTorrent, parseMagnet } from "../lib/bencode.js";
import { t, plural, bytes, localize, ready, lang } from "../lib/i18n.js";

await ready;
localize();

const $ = (id) => document.getElementById(id);
const say = (t, cls = "") => { $("status").textContent = t; $("status").className = cls; };
let settings, job, meta, metainfo = null;

function fact(label, value) {
  if (!value) return;
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  $("facts").append(dt, dd);
}

// Downloads the .torrent the way the page would: with the site's cookies and the page as Referer.
// Extension requests normally go out without them (Edge treats them as third-party), which makes
// many trackers answer 403, so a temporary header rule adds them for this one host.
async function addHeaderRule(url, referrer) {
  const host = new URL(url).hostname;
  let cookie = "";
  try {
    const list = await chrome.cookies.getAll({ url });
    cookie = list.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {}
  const requestHeaders = [];
  if (referrer && /^https?:/i.test(referrer)) requestHeaders.push({ header: "referer", operation: "set", value: referrer });
  if (cookie) requestHeaders.push({ header: "cookie", operation: "set", value: cookie });
  if (!requestHeaders.length) return () => {};
  const id = 100000 + Math.floor(Math.random() * 900000);
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders },
      condition: { requestDomains: [host], initiatorDomains: [chrome.runtime.id], resourceTypes: ["xmlhttprequest", "other"] },
    }],
  }).catch(() => {});
  return () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
}

async function loadTorrentBytes(url, referrer) {
  const removeRule = await addHeaderRule(url, referrer);
  try {
    // fetch() rejects with the browser's own English text ("Failed to fetch"), so replace it.
    const res = await fetch(url, { credentials: "include", cache: "no-store" }).catch(() => {
      throw new Error(t("errSiteUnreachable"));
    });
    if (!res.ok) throw new Error(t("errSiteRefused", res.status));
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] !== 0x64) throw new Error(t("errSiteNotTorrent"));
    return buf;
  } finally {
    removeRule();
  }
}

// ---------- files Edge downloaded ----------
const isTorrent = (buf) => buf && buf.length > 0 && buf[0] === 0x64; // bencoded dict starts with "d"

async function fileAccess() {
  try { return await chrome.extension.isAllowedFileSchemeAccess(); } catch { return false; }
}

// Edge is waiting for the user (paused, or a "Keep / Delete" safety prompt) rather than downloading.
const TRANSIENT_DANGER = ["safe", "accepted", "asyncScanning", "asyncLocalPasswordScanning", "deepScannedSafe", "allowlistedByPolicy"];
const needsUser = (item) => item.paused || (item.danger && !TRANSIENT_DANGER.includes(item.danger));

function showWaiting(text) {
  $("loading").textContent = text;
  if (!$("form").hidden) say(text);
}

// Listens for changes *and* polls: a .torrent is tiny and often finishes between a state check and
// adding a listener, so relying on onChanged alone sometimes waits forever.
function waitForDownload(id, timeoutMs = 60000) {
  const started = Date.now();
  let stuckSince = 0;
  let warned = false;
  return new Promise((resolve, reject) => {
    let finished = false;
    const stop = (fn, v) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      chrome.downloads.onChanged.removeListener(onChange);
      fn(v);
    };
    const check = async () => {
      if (finished) return;
      let item;
      try { [item] = await chrome.downloads.search({ id }); } catch (e) { return stop(reject, e); }
      if (!item) return stop(reject, new Error(t("errDownloadGone")));
      if (item.state === "complete") return stop(resolve, item);
      if (item.state === "interrupted") return stop(reject, new Error(t("errEdgeFailed", item.error || t("interrupted"))));
      if (needsUser(item)) {
        stuckSince = stuckSince || Date.now();
        if (!warned && Date.now() - stuckSince > 1500) {
          // The hidden download bubble would hide Edge's question, so bring it back.
          warned = true;
          timeoutMs = Math.max(timeoutMs, Date.now() - started + 180000);
          console.info("Download needs the user:", item.danger, item.paused ? "paused" : "");
          chrome.runtime.sendMessage({ type: "show-download-ui", id }).catch(() => {});
          showWaiting(item.paused
            ? t("edgePaused")
            : t("edgeAsksKeep"));
        }
      } else stuckSince = 0;
      if (Date.now() - started > timeoutMs) stop(reject, new Error(t("errTooLong")));
    };
    const onChange = (d) => d.id === id && check();
    chrome.downloads.onChanged.addListener(onChange);
    const poll = setInterval(check, 500);
    check();
  });
}

function fileUrl(path) {
  const parts = path.split(/[\\/]/).map((p, i) => (i === 0 && /^[a-zA-Z]:$/.test(p) ? p : encodeURIComponent(p)));
  return (path.startsWith("/") ? "file://" : "file:///") + parts.join("/");
}

// fetch() refuses file: URLs, XHR doesn't (when "Allow access to file URLs" is on).
function readLocalFile(path) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("GET", fileUrl(path));
    x.responseType = "arraybuffer";
    x.onload = () => (x.response ? resolve(new Uint8Array(x.response)) : reject(new Error(t("errReadFile"))));
    x.onerror = () => reject(new Error(t("errReadFile")));
    x.send();
  });
}

async function discardDownload(id) {
  if (id == null) return;
  await chrome.downloads.removeFile(id).catch(() => {});
  await chrome.downloads.erase({ id }).catch(() => {});
}

async function readDownload(id) {
  $("loading").textContent = t("waitingDownload");
  const item = await waitForDownload(id);
  const buf = await readLocalFile(item.filename);
  if (!isTorrent(buf)) throw new Error(t("errFileNotTorrent"));
  await discardDownload(id);
  return buf;
}

// Ask the content script in the original page to fetch it: same origin, the site's own session.
async function fetchInTab(job) {
  if (job.tabId == null) return null;
  try {
    const r = await chrome.tabs.sendMessage(job.tabId, { type: "fetch-torrent", url: job.url }, { frameId: job.frameId || 0 });
    return r && r.data ? fromBase64(r.data) : null;
  } catch {
    return null; // tab closed, or the page was open before the extension was loaded
  }
}

// Tries, in order: bytes the page already sent, the file Edge downloaded, a fetch from inside the
// page, and finally a fetch from the extension with the site's cookies and Referer added.
async function loadTorrent(job) {
  if (job.data) return fromBase64(job.data);
  let firstError = null;
  if (job.downloadId != null && (await fileAccess())) {
    try { return await readDownload(job.downloadId); } catch (e) { firstError = e; }
  }
  const fromPage = await fetchInTab(job);
  if (isTorrent(fromPage)) { discardDownload(job.downloadId); return fromPage; }
  try {
    const buf = await loadTorrentBytes(job.url, job.referrer);
    discardDownload(job.downloadId);
    return buf;
  } catch (e) {
    throw firstError || e;
  }
}

// Fallback: point at the file Edge saved (or download it now) so the user can pick it.
async function offerDownloadedFile(id) {
  try {
    const item = await waitForDownload(id);
    $("savedAs").textContent = t("savedAs", item.filename);
    $("savedAs").hidden = false;
    $("openNormally").hidden = true;
  } catch (e) {
    say(e.message, "err");
  }
}

async function downloadInBrowser(url, referrer) {
  const removeRule = await addHeaderRule(url, referrer);
  try {
    job.downloadId = await chrome.downloads.download({ url, saveAs: false });
    say(t("downloading"));
    if (await fileAccess()) {
      showTorrent(await readDownload(job.downloadId));
      say("");
    } else {
      await offerDownloadedFile(job.downloadId);
      say("");
    }
  } catch (e) {
    say(e.message, "err");
  } finally {
    setTimeout(removeRule, 30000);
  }
}

function showTorrent(raw) {
  meta = parseTorrent(raw);
  metainfo = toBase64(raw);
  $("facts").replaceChildren();
  $("files").replaceChildren();
  $("title").textContent = meta.name;
  fact(t("factSize"), plural("sizeInFiles", meta.files.length, bytes(meta.totalSize), meta.files.length));
  if (meta.trackers.length) {
    let host;
    try { host = new URL(meta.trackers[0]).host || meta.trackers[0]; } catch { host = meta.trackers[0]; }
    fact(t("factTracker"), meta.trackers.length > 1 ? t("moreTrackers", host, meta.trackers.length - 1) : host);
  }
  fact(t("factComment"), meta.comment);
  fact(t("factCreated"), [meta.creationDate && meta.creationDate.toLocaleString(lang), meta.createdBy].filter(Boolean).join(" · "));
  fact(t("factPrivate"), meta.private ? t("yes") : "");
  $("fallback").hidden = true;
  showFiles(meta.files);
}

function showFiles(files) {
  if (files.length < 2) { $("filesBox").hidden = true; return; }
  $("filesBox").hidden = false;
  const ul = $("files");
  files.forEach((f, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<label><input type="checkbox" checked data-i="${i}"><span class="p"></span></label><span class="s"></span>`;
    li.querySelector(".p").textContent = f.path;
    li.querySelector(".p").title = f.path;
    li.querySelector(".s").textContent = bytes(f.length);
    ul.append(li);
  });
  ul.onchange = updateSelection;
  $("allFiles").onchange = (e) => {
    ul.querySelectorAll("input").forEach((c) => (c.checked = e.target.checked));
    updateSelection();
  };
  updateSelection();
}

function updateSelection() {
  const boxes = [...$("files").querySelectorAll("input")];
  const on = boxes.filter((b) => b.checked);
  const size = on.reduce((a, b) => a + meta.files[b.dataset.i].length, 0);
  $("selSize").textContent = t("selection", on.length, boxes.length, bytes(size));
  $("allFiles").checked = on.length === boxes.length;
  $("allFiles").indeterminate = on.length > 0 && on.length < boxes.length;
  $("add").disabled = on.length === 0 || (!!baseDir && !allowed.length);
}

let baseDir = "";
let allowed = []; // allowed subfolders ("" = download-dir itself)

function joinBase(sub) {
  return sub ? baseDir.replace(/\/+$/, "") + "/" + sub : baseDir;
}

function needSetup(text) {
  say(text, "err");
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = t("openSettings");
  b.onclick = () => chrome.runtime.openOptionsPage();
  $("status").append(b);
  $("add").disabled = true;
}

async function loadDirs() {
  const [session, stored] = await Promise.all([
    rpc("session-get", { fields: ["download-dir"] }, settings),
    chrome.storage.local.get({ recentSubdirs: [] }),
  ]);
  baseDir = session["download-dir"] || "";
  if (!baseDir) throw new Error(t("errNoDownloadDir"));
  allowed = [];
  for (const d of settings.allowedDirs) {
    try {
      const c = cleanSubdir(d); // "" is download-dir itself
      if (!allowed.includes(c)) allowed.push(c);
    } catch {}
  }
  if (!allowed.length) return needSetup(t("noDirsAllowed"));
  $("dir").replaceChildren(
    ...allowed.map((d) => Object.assign(document.createElement("option"), { value: d, textContent: "/" + d, title: joinBase(d) }))
  );
  let preferred;
  if (typeof settings.defaultDir === "string") {
    try { preferred = cleanSubdir(settings.defaultDir); } catch {}
  }
  if (!allowed.includes(preferred)) preferred = stored.recentSubdirs.find((d) => allowed.includes(d));
  if (preferred !== undefined) $("dir").value = preferred;
  checkFree();
}

async function checkFree() {
  const sub = $("dir").value;
  // A subfolder that doesn't exist yet has no free-space answer, so fall back to download-dir.
  for (const path of sub ? [joinBase(sub), baseDir] : [baseDir]) {
    try {
      const r = await rpc("free-space", { path }, settings);
      const low = meta.totalSize && r["size-bytes"] < meta.totalSize;
      $("free").textContent = t(low ? "freeSpaceLow" : "freeSpace", bytes(r["size-bytes"]));
      return;
    } catch {}
  }
  $("free").textContent = "";
}

async function submit(ev) {
  ev.preventDefault();
  const sub = $("dir").value;
  if (!allowed.includes(sub)) return say(t("dirNotAllowed"), "err");
  const args = { "download-dir": joinBase(sub), paused: !$("start").checked };
  if (metainfo) args.metainfo = metainfo;
  else args.filename = job.url;
  const boxes = [...$("files").querySelectorAll("input")];
  const unwanted = boxes.filter((b) => !b.checked).map((b) => Number(b.dataset.i));
  if (unwanted.length) args["files-unwanted"] = unwanted;

  $("add").disabled = true;
  say(t("adding"));
  try {
    const r = await rpc("torrent-add", args, settings);
    const { recentSubdirs = [] } = await chrome.storage.local.get({ recentSubdirs: [] });
    await chrome.storage.local.set({
      recentSubdirs: [sub, ...recentSubdirs.filter((d) => d !== sub)].slice(0, 8),
      startAdded: $("start").checked,
    });
    chrome.runtime.sendMessage("refresh-badge").catch(() => {});
    discardDownload(job.downloadId); // the .torrent Edge saved is no longer needed
    if (r["torrent-duplicate"]) say(t("alreadyAdded"), "ok");
    else say(t("added"), "ok");
    setTimeout(() => window.close(), 1200);
  } catch (e) {
    say(e.message, "err");
    $("add").disabled = false;
  }
}

(async () => {
  settings = await getSettings();
  $("start").checked = settings.startAdded;
  const key = new URLSearchParams(location.search).get("key");
  job = (await chrome.storage.session.get(key))[key];
  chrome.storage.session.remove(key).catch(() => {});
  if (!job) {
    $("loading").textContent = t("nothingToAdd");
    return;
  }
  // Edge's copy of the .torrent is only kept for this dialog (it used to be cancelled outright).
  $("cancel").onclick = async () => { await discardDownload(job.downloadId); window.close(); };
  $("form").addEventListener("submit", submit);
  $("dir").addEventListener("change", checkFree);

  try {
    if (job.url.startsWith("magnet:")) {
      meta = { ...parseMagnet(job.url), files: [] };
      $("title").textContent = meta.name || t("magnetLink");
      fact(t("factType"), t("magnetType"));
      fact(t("factSize"), meta.totalSize ? bytes(meta.totalSize) : "");
      fact(t("factInfoHash"), meta.hash);
      fact(t("factTrackers"), meta.trackers.length ? String(meta.trackers.length) : "");
    } else {
      showTorrent(await loadTorrent(job));
    }
  } catch (e) {
    // The site still refused: let the user pick the file Edge downloaded (or download it now).
    meta = { files: [], totalSize: 0 };
    const last = new URL(job.url).pathname.split("/").pop();
    try { $("title").textContent = decodeURIComponent(last) || t("torrentFallbackName"); } catch { $("title").textContent = last || t("torrentFallbackName"); }
    $("fallbackMsg").textContent = e.message + ".";
    $("fallback").hidden = false;
    $("openNormally").onclick = () => downloadInBrowser(job.url, job.referrer);
    if (!(await fileAccess())) {
      $("fileAccessHint").hidden = false;
      $("openExtSettings").onclick = () => chrome.tabs.create({ url: `edge://extensions/?id=${chrome.runtime.id}` });
    }
    if (job.downloadId != null) offerDownloadedFile(job.downloadId);
    $("pickFile").onchange = async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      try {
        showTorrent(new Uint8Array(await f.arrayBuffer()));
        say("");
      } catch (err) {
        say(err.message, "err");
      }
    };
    say("");
  }
  $("loading").hidden = true;
  $("details").hidden = false;
  $("form").hidden = false;
  if (!isConfigured(settings)) return needSetup(t("setupFirst"));
  try {
    await loadDirs();
  } catch (e) {
    if (e.kind === "config" || e.kind === "auth" || e.kind === "network") return needSetup(e.message);
    say(e.message, "err");
    $("add").disabled = true;
    return;
  }
  $("dir").focus();
})();
