// Minimal Transmission RPC client shared by the popup, options page and background worker.
import { t } from "./i18n.js";

export const DEFAULTS = {
  url: "", // server address as typed, e.g. 192.168.1.10 or https://nas:9091; empty until set up
  defaultProtocol: "http",
  defaultPort: 9091,
  rpcPath: "/transmission/rpc",
  webPath: "/transmission/web/",
  username: "",
  password: "",
  refreshSeconds: 3, // popup polling interval; fixed, not shown in the options page
  badge: true,
  interceptClicks: true,
  interceptDownloads: true,
  startAdded: true,
  allowedDirs: [""], // folders below download-dir the add dialog offers ("" = download-dir itself)
  defaultDir: "", // folder preselected in the add dialog ("" = download-dir); null = last used
  language: "auto", // UI language: "auto" (profile's preferred languages) or a key of LANGUAGES in i18n.js
};

// Settings live in chrome.storage.sync so they follow the browser profile to other PCs.
export const settingsStore = chrome.storage.sync;

export async function getSettings() {
  await migrateLocalToSync();
  await migrateAllowRoot();
  const { refreshSeconds, ...stored } = await settingsStore.get(DEFAULTS);
  if (refreshSeconds !== DEFAULTS.refreshSeconds) settingsStore.remove("refreshSeconds"); // set by older versions
  return { ...DEFAULTS, ...stored };
}

// Older versions kept settings in chrome.storage.local. Move them to sync once; a value that
// already arrived through sync (set up on another PC) wins over the local one.
const LEGACY_KEYS = [...Object.keys(DEFAULTS), "allowRoot"];
async function migrateLocalToSync() {
  const local = await chrome.storage.local.get(LEGACY_KEYS);
  const keys = Object.keys(local);
  if (!keys.length) return;
  const synced = await settingsStore.get(keys);
  const copy = Object.fromEntries(keys.filter((k) => !(k in synced)).map((k) => [k, local[k]]));
  if (Object.keys(copy).length) await settingsStore.set(copy);
  await chrome.storage.local.remove(keys);
}

// Older versions had an "Allow saving directly in download-dir" checkbox (allowRoot).
// download-dir is now the "" entry of allowedDirs, so fold the old flag into the list once.
async function migrateAllowRoot() {
  const old = await settingsStore.get(["allowRoot", "allowedDirs", "defaultDir"]);
  if (!("allowRoot" in old)) return;
  const dirs = (Array.isArray(old.allowedDirs) ? old.allowedDirs : []).filter((d) => d !== "");
  await settingsStore.set({
    allowedDirs: old.allowRoot ? ["", ...dirs] : dirs,
    defaultDir: "defaultDir" in old ? old.defaultDir : null, // keep "last used" for existing users
  });
  await settingsStore.remove("allowRoot");
}

// Turns "192.168.1.10", "nas.local:9092" or "https://host" into an origin, filling in the
// default protocol and port when they are not given.
export function normalizeServer(input, protocol = "http", port = 9091) {
  let s = (input || "").trim();
  if (!s) throw new Error(t("errNoAddress"));
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `${protocol}://${s}`;
  let u;
  try { u = new URL(s); } catch { throw new Error(t("errBadAddress")); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(t("errProtocol"));
  const hostPart = s.replace(/^[^:]+:\/\//, "").split(/[/?#]/)[0];
  const hasPort = /:\d+$/.test(hostPart);
  if (!hasPort && port) u.port = String(port);
  return hasPort || !port ? `${u.protocol}//${hostPart.replace(/^.*@/, "")}` : u.origin;
}

// Turns a folder typed by the user into a safe path below download-dir, or throws.
export function cleanSubdir(input) {
  const raw = (input || "").trim();
  if (/^([\\/]|[a-zA-Z]:|~)/.test(raw)) throw new Error(t("errAbsolute"));
  if (/[\x00-\x1f]/.test(raw)) throw new Error(t("errBadChars"));
  const parts = raw.split(/[\\/]+/).map((p) => p.trim()).filter((p) => p && p !== ".");
  // "..." and the like count too: Windows servers trim trailing dots, which can turn them into "..".
  if (parts.some((p) => /^\.{2,}$/.test(p))) throw new Error(t("errDotDot"));
  return parts.join("/");
}

export function isConfigured(s) {
  return !!(s && s.url);
}

// The address is stored as the user typed it; the default protocol and port fill in what it lacks.
export function baseUrl(s) {
  try {
    return normalizeServer(s.url, s.defaultProtocol, s.defaultPort);
  } catch {
    return s.url.trim().replace(/\/+$/, "");
  }
}
export function rpcUrl(s) {
  return baseUrl(s) + s.rpcPath;
}
export function webUrl(s) {
  return baseUrl(s) + s.webPath;
}
export function originPattern(s) {
  const u = new URL(baseUrl(s));
  return `${u.protocol}//${u.host}/*`;
}

// The session id is cached in session storage so the 409 handshake happens once per browser session.
async function cachedSessionId() {
  try {
    return (await chrome.storage.session.get("sid")).sid || "";
  } catch {
    return "";
  }
}
async function storeSessionId(sid) {
  try {
    await chrome.storage.session.set({ sid });
  } catch {}
}

export class RpcError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind; // "config" | "auth" | "network" | "rpc" | "http"
  }
}

export async function rpc(method, args = {}, settings) {
  const s = settings || (await getSettings());
  if (!isConfigured(s)) throw new RpcError(t("errNotSetUp"), "config");
  const headers = { "Content-Type": "application/json" };
  if (s.username || s.password) {
    headers["Authorization"] = "Basic " + btoa(unescape(encodeURIComponent(`${s.username}:${s.password}`)));
  }
  const body = JSON.stringify({ method, arguments: args });

  let sid = await cachedSessionId();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (sid) headers["X-Transmission-Session-Id"] = sid;
    let res;
    try {
      res = await fetch(rpcUrl(s), { method: "POST", headers, body, credentials: "omit", cache: "no-store" });
    } catch (e) {
      throw new RpcError(t("errCannotReach", baseUrl(s)), "network");
    }
    if (res.status === 409) {
      sid = res.headers.get("X-Transmission-Session-Id") || "";
      await storeSessionId(sid);
      continue;
    }
    if (res.status === 401) throw new RpcError(t("errAuth"), "auth");
    if (res.status === 403) throw new RpcError(t("errForbidden"), "auth");
    if (!res.ok) throw new RpcError(t("errHttp", res.status), "http");
    const json = await res.json();
    if (json.result !== "success") throw new RpcError(json.result || t("errRpc"), "rpc");
    return json.arguments || {};
  }
  throw new RpcError(t("errHandshake"), "http");
}

export const FIELDS = [
  "id", "name", "status", "percentDone", "rateDownload", "rateUpload", "eta",
  "error", "errorString", "totalSize", "sizeWhenDone", "leftUntilDone",
  "uploadRatio", "peersConnected", "peersSendingToUs", "peersGettingFromUs",
  "recheckProgress", "isFinished", "addedDate", "queuePosition",
];

// Localized names, keyed by Transmission's status code. Getters, so they follow the loaded language.
export const STATUS = {};
for (const c of [0, 1, 2, 3, 4, 5, 6]) Object.defineProperty(STATUS, c, { get: () => t("status" + c), enumerable: true });

export function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function getTorrents(settings) {
  const r = await rpc("torrent-get", { fields: FIELDS }, settings);
  return r.torrents || [];
}
