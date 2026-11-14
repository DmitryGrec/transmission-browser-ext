import { DEFAULTS, getSettings, settingsStore, rpc, webUrl, baseUrl, originPattern, normalizeServer, cleanSubdir } from "../lib/rpc.js";
import { t, localize, ready, LANGUAGES } from "../lib/i18n.js";

await ready;
localize();

const $ = (id) => document.getElementById(id);

// Language picker: "Automatic" (the default) plus each language in its own name.
{
  const sel = $("language");
  sel.replaceChildren(
    new Option(t("langAuto"), "auto"),
    ...Object.entries(LANGUAGES).map(([k, name]) => new Option(name, k)),
  );
}
// A new language takes effect by reloading the page (the background worker reloads its own copy).
chrome.storage.onChanged.addListener((c, area) => {
  if (area === "sync" && c.language) location.reload();
});

// Autosaved fields. The address row (defaultProtocol, server, defaultPort) is saved by Test connection.
const SIMPLE = ["username", "password", "rpcPath", "webPath",
  "badge", "interceptClicks", "interceptDownloads", "startAdded", "language"];

let dirs = [];          // allowed subfolders
let downloadDir = "";   // reported by the server
let savedAddr = "";     // address row currently in storage, see addrKey()
let defaultDir = null; // preselected folder ("" = download-dir), null = last used

function say(el, text, cls = "") {
  $(el).textContent = text;
  $(el).className = cls + ($(el).classList.contains("small") ? " small" : "");
}

// ---------- reading / writing the form ----------
function fill(s) {
  for (const k of SIMPLE) {
    const el = $(k);
    if (el.type === "checkbox") el.checked = !!s[k];
    else el.value = s[k];
  }
  $("server").value = s.url || "";
  $("defaultProtocol").value = s.defaultProtocol;
  $("defaultPort").value = s.defaultPort;
  savedAddr = addrKey(s);
  dirs = [...(s.allowedDirs || [])];
  defaultDir = s.defaultDir ?? null;
  renderDirs();
  updateResolved();
}

const addrKey = (s) => JSON.stringify([s.url || "", s.defaultProtocol, s.defaultPort]);

// Throws if the address is not usable. url stays as typed; baseUrl() resolves it.
function readConnection() {
  const proto = $("defaultProtocol").value;
  const port = Number($("defaultPort").value) || DEFAULTS.defaultPort;
  const url = $("server").value.trim();
  normalizeServer(url, proto, port);
  return {
    url,
    defaultProtocol: proto,
    defaultPort: port,
    username: $("username").value.trim(),
    password: $("password").value,
    rpcPath: fixPath($("rpcPath").value, DEFAULTS.rpcPath),
    webPath: fixPath($("webPath").value, DEFAULTS.webPath),
  };
}

function updateResolved() {
  try {
    const c = readConnection();
    $("resolved").textContent = t("connectsTo", baseUrl(c) + c.rpcPath);
    $("webLink").href = webUrl(c);
  } catch (e) {
    $("resolved").textContent = $("server").value.trim() ? e.message : "";
  }
}

// ---------- connection ----------
async function ensurePermission(s) {
  const origins = [originPattern(s)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function connect() {
  let c;
  try { c = readConnection(); } catch (e) { say("connStatus", e.message, "err"); return false; }
  if (!(await ensurePermission(c))) { say("connStatus", t("permissionDenied"), "err"); return false; }
  await chrome.storage.session.remove("sid").catch(() => {});
  say("connStatus", t("connecting"));
  try {
    const [session, torrents] = await Promise.all([
      rpc("session-get", { fields: ["version", "download-dir"] }, { ...DEFAULTS, ...c }),
      rpc("torrent-get", { fields: ["downloadDir"] }, { ...DEFAULTS, ...c }).then((r) => r.torrents || []).catch(() => []),
    ]);
    downloadDir = (session["download-dir"] || "").replace(/\/+$/, "");
    say("connStatus", t("connectedTo", session.version || "").trim(), "ok");
    // The address row is the only part that waits for a successful test before it is saved.
    if (addrKey(c) !== savedAddr) {
      await save({ url: c.url, defaultProtocol: c.defaultProtocol, defaultPort: c.defaultPort });
      savedAddr = addrKey(c);
      $("welcome").hidden = true;
    }
    $("foldersBox").disabled = false;
    $("rootLabel").textContent = downloadDir ? `: ${downloadDir}` : "";
    $("prefix").textContent = (downloadDir || "download-dir") + "/";
    showSuggestions(torrents.map((t) => t.downloadDir));
    renderDirs();
    return true;
  } catch (e) {
    say("connStatus", e.message, "err");
    return false;
  }
}

// ---------- allowed folders ----------
function renderDirs() {
  if (!dirs.includes(defaultDir)) defaultDir = null;
  const ul = $("dirList");
  ul.replaceChildren();
  if (!dirs.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("noFoldersYet");
    ul.append(li);
  }
  for (const d of dirs) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    const i = document.createElement("i");
    const base = downloadDir || "download-dir";
    i.textContent = d ? base + "/" : base;
    span.append(i, d);
    span.title = d ? base + "/" + d : base;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "✕";
    rm.title = t("remove");
    rm.onclick = () => { dirs = dirs.filter((x) => x !== d); dirsChanged(); };
    li.append(span, defaultButton(document.createElement("button"), d), rm);
    ul.append(li);
  }
}

// "Default" toggle shown right of a folder; d is "" for download-dir itself.
// Clicking the current default clears it, so the add dialog falls back to the last used folder.
function defaultButton(b, d) {
  const on = defaultDir === d;
  b.type = "button";
  b.className = on ? "def on" : "def";
  b.textContent = t(on ? "defaultOn" : "setDefault");
  b.title = t(on ? "defaultOnTitle" : "setDefaultTitle");
  b.setAttribute("aria-pressed", String(on));
  b.onclick = () => { defaultDir = on ? null : d; dirsChanged(); };
  return b;
}


function addDir(value) {
  try {
    const d = cleanSubdir(value);
    if (!dirs.includes(d)) dirs.push(d);
    dirs.sort((a, b) => a.localeCompare(b));
    $("newDir").value = "";
    say("dirError", "", "err");
    dirsChanged();
  } catch (e) {
    say("dirError", e.message, "err");
  }
}

function showSuggestions(paths) {
  const subs = new Set();
  for (const p of paths) {
    const d = (p || "").replace(/\/+$/, "");
    if (downloadDir && d.startsWith(downloadDir + "/")) subs.add(d.slice(downloadDir.length + 1));
  }
  const box = $("suggest");
  box.replaceChildren(...[...subs].sort().map((d) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "+ " + d;
    b.onclick = () => addDir(d);
    return b;
  }));
  $("suggestBox").hidden = !subs.size;
}

// ---------- saving (everything but the server address saves as soon as it changes) ----------
let statusTimer;
async function save(values) {
  await settingsStore.set(values);
  say("status", t("saved"), "ok");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => say("status", t("autosaveNote"), "muted"), 1500);
}

function dirsChanged() {
  renderDirs(); // also drops a default that is no longer in the list
  save({ allowedDirs: dirs, defaultDir });
  say("dirError", dirs.length ? "" : t("noFoldersAllowed"), "err");
}

const fixPath = (p, d) => { p = (p || "").trim() || d; return p.startsWith("/") ? p : "/" + p; };

// Value to store for a SIMPLE field, or undefined while it is not valid yet.
function fieldValue(k) {
  const el = $(k);
  if (el.type === "checkbox") return el.checked;
  if (k === "rpcPath" || k === "webPath") return fixPath(el.value, DEFAULTS[k]);
  if (k === "username") return el.value.trim();
  return el.value;
}

const pending = {};
function saveField(k, delay = 0) {
  clearTimeout(pending[k]);
  pending[k] = setTimeout(() => {
    const v = fieldValue(k);
    if (v !== undefined) save({ [k]: v });
  }, delay);
}
for (const k of SIMPLE) {
  const el = $(k);
  el.addEventListener("change", () => saveField(k));
  if (el.type !== "checkbox" && el.tagName !== "SELECT") el.addEventListener("input", () => saveField(k, 500));
}

// ---------- wiring ----------
$("connect").onclick = connect;
$("form").addEventListener("submit", (e) => e.preventDefault());
$("addDir").onclick = () => addDir($("newDir").value);
$("newDir").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addDir($("newDir").value); } });
for (const id of ["server", "defaultProtocol", "defaultPort", "rpcPath", "webPath"]) $(id).addEventListener("input", updateResolved);
$("server").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); connect(); } });

getSettings().then((s) => {
  fill(s);
  if (!s.url) {
    $("welcome").hidden = false;
    $("server").focus();
  } else {
    connect();
  }
});
