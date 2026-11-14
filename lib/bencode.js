// Tiny bencode decoder plus helpers to read .torrent metadata and magnet links.
import { t } from "./i18n.js";

export function decode(bytes) {
  let i = 0;
  const td = new TextDecoder("utf-8", { fatal: false });
  const bad = () => { throw new Error(t("errBadTorrent")); };
  let depth = 0;
  function readInt(end) {
    if (end < 0) bad();
    const s = td.decode(bytes.subarray(i, end));
    i = end + 1;
    return Number(s);
  }
  function next() {
    if (++depth > 256) bad(); // nesting this deep is not a real torrent
    try { return value(); } finally { depth--; }
  }
  function value() {
    if (i >= bytes.length) bad();
    const c = bytes[i];
    if (c === 0x69) { // i<int>e
      i++;
      return readInt(bytes.indexOf(0x65, i));
    }
    if (c === 0x6c) { // l...e
      i++;
      const out = [];
      while (bytes[i] !== 0x65) out.push(next());
      i++;
      return out;
    }
    if (c === 0x64) { // d...e
      i++;
      // No prototype: a "__proto__" key in the file must stay an ordinary key.
      const out = Object.create(null);
      while (bytes[i] !== 0x65) {
        const key = next();
        if (!(key instanceof Uint8Array)) bad();
        const k = td.decode(key);
        out[k] = next();
      }
      i++;
      return out;
    }
    if (c >= 0x30 && c <= 0x39) { // <len>:<bytes>
      const colon = bytes.indexOf(0x3a, i);
      if (colon < 0) bad();
      const len = Number(td.decode(bytes.subarray(i, colon)));
      i = colon + 1;
      if (!Number.isInteger(len) || len < 0 || i + len > bytes.length) bad();
      const s = bytes.subarray(i, i + len);
      i += len;
      return s;
    }
    bad();
  }
  return next();
}

const td = new TextDecoder("utf-8");
const text = (v) => (v instanceof Uint8Array ? td.decode(v) : v == null ? "" : String(v));

export function parseTorrent(bytes) {
  const t = decode(bytes);
  if (!t || !t.info) throw new Error(t("errBadTorrent"));
  const info = t.info;
  const name = text(info["name.utf-8"] || info.name);
  let files = [];
  if (Array.isArray(info.files)) {
    files = info.files.map((f) => ({
      path: (f["path.utf-8"] || f.path || []).map(text).join("/"),
      length: f.length || 0,
    }));
  } else if (typeof info.length === "number") {
    files = [{ path: name, length: info.length }];
  } else if (info["file tree"]) {
    // BitTorrent v2-only torrent
    (function walk(node, prefix) {
      for (const [k, v] of Object.entries(node)) {
        if (k === "" && v.length != null) files.push({ path: prefix, length: v.length });
        else walk(v, prefix ? prefix + "/" + k : k);
      }
    })(info["file tree"], "");
  }
  const trackers = [];
  if (Array.isArray(t["announce-list"])) t["announce-list"].flat().forEach((u) => trackers.push(text(u)));
  else if (t.announce) trackers.push(text(t.announce));
  return {
    name,
    files,
    totalSize: files.reduce((a, f) => a + f.length, 0),
    comment: text(t["comment.utf-8"] || t.comment),
    createdBy: text(t["created by"]),
    creationDate: t["creation date"] ? new Date(t["creation date"] * 1000) : null,
    private: info.private === 1,
    pieceLength: info["piece length"] || 0,
    trackers: [...new Set(trackers)],
  };
}

export function parseMagnet(uri) {
  const u = new URL(uri);
  const p = u.searchParams;
  const xt = p.getAll("xt").find((x) => /^urn:bt(m)?ih:/i.test(x)) || "";
  return {
    name: p.get("dn") || "",
    hash: xt.replace(/^urn:bt(m)?ih:/i, ""),
    totalSize: Number(p.get("xl")) || 0,
    trackers: p.getAll("tr"),
  };
}
