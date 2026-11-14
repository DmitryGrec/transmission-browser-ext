import { getSettings, getTorrents, rpc, webUrl, STATUS } from "../lib/rpc.js";
import { t as tr, bytes, num, lang, localize, ready } from "../lib/i18n.js";

await ready;
localize();

const $ = (s) => document.querySelector(s);
const list = $("#list");
const tpl = $("#rowTpl");
const msg = $("#message");
let settings;
let filter = "all";
let torrents = [];
let timer;
const confirming = new Set(); // torrent ids with an open delete prompt

// ---------- formatting ----------
const speed = (n) => tr("perSecond", n > 0 ? bytes(n) : "0 " + tr("byteUnits").split(" ")[1]);
function eta(s) {
  if (s < 0) return "";
  if (s < 60) return tr("etaS", s);
  if (s < 3600) return tr("etaM", Math.floor(s / 60));
  if (s < 86400) return tr("etaHM", Math.floor(s / 3600), Math.floor((s % 3600) / 60));
  return tr("etaDH", Math.floor(s / 86400), Math.floor((s % 86400) / 3600));
}

// ---------- filters ----------
const isActive = (t) => t.rateDownload > 0 || t.rateUpload > 0 || t.status === 2;
const FILTERS = {
  all: () => true,
  active: isActive,
  downloading: (t) => t.status === 3 || t.status === 4,
  seeding: (t) => t.status === 5 || t.status === 6,
  paused: (t) => t.status === 0,
};

const pctFormats = [0, 1].map((d) => new Intl.NumberFormat(lang, { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d }));
const percent = (f, digits) => pctFormats[digits].format(f);

function describe(t) {
  if (t.error) return tr("torrentError", t.errorString);
  const pct = percent(t.percentDone, 1);
  const done = tr("pctOf", pct, bytes(t.sizeWhenDone));
  switch (t.status) {
    case 4: {
      const e = eta(t.eta);
      return [done, tr("peersOf", t.peersSendingToUs, t.peersConnected), e && tr("timeLeft", e)].filter(Boolean).join(" · ");
    }
    case 6:
      return tr("seedingInfo", t.uploadRatio < 0 ? "–" : num(t.uploadRatio, 2), t.peersGettingFromUs);
    case 2:
      return tr("verifyingPct", percent(t.recheckProgress, 0));
    case 0:
      return tr("pausedInfo", done);
    default:
      return `${STATUS[t.status]} · ${pct}`;
  }
}

function stateClass(t) {
  if (t.error) return "error";
  if (t.status === 0) return t.percentDone >= 1 ? "paused done" : "paused";
  if (t.status === 5 || t.status === 6) return "seeding";
  return "downloading";
}

// ---------- rendering ----------
function render() {
  for (const btn of document.querySelectorAll("#filters button")) {
    const f = btn.dataset.filter;
    btn.classList.toggle("on", f === filter);
    btn.querySelector(".n").textContent = torrents.filter(FILTERS[f]).length;
  }
  $("#totDown").textContent = speed(torrents.reduce((a, t) => a + t.rateDownload, 0));
  $("#totUp").textContent = speed(torrents.reduce((a, t) => a + t.rateUpload, 0));

  const shown = torrents.filter(FILTERS[filter]).sort((a, b) => a.queuePosition - b.queuePosition);
  if (!torrents.length) showMessage(tr("noTorrents"));
  else if (!shown.length) showMessage(tr("nothingHere"));
  else hideMessage();

  // Reuse rows by id so open confirmations and hover state survive refreshes.
  const existing = new Map([...list.children].map((li) => [li.dataset.id, li]));
  const frag = document.createDocumentFragment();
  for (const t of shown) {
    const li = existing.get(String(t.id)) || buildRow(t.id);
    existing.delete(String(t.id));
    fillRow(li, t);
    frag.appendChild(li);
  }
  list.replaceChildren(frag);
}

function buildRow(id) {
  const li = tpl.content.firstElementChild.cloneNode(true);
  li.dataset.id = id;
  li.querySelector(".toggle").addEventListener("click", () => {
    const t = torrents.find((x) => x.id === id);
    act(t.status === 0 ? "torrent-start" : "torrent-stop", { ids: [id] });
  });
  li.querySelector(".remove").addEventListener("click", () => {
    confirming.has(id) ? confirming.delete(id) : confirming.add(id);
    li.querySelector(".confirm").hidden = !confirming.has(id);
  });
  li.querySelector(".cancel").addEventListener("click", () => {
    confirming.delete(id);
    li.querySelector(".confirm").hidden = true;
  });
  const remove = (wipe) => {
    confirming.delete(id);
    act("torrent-remove", { ids: [id], "delete-local-data": wipe });
  };
  li.querySelector(".keep").addEventListener("click", () => remove(false));
  li.querySelector(".wipe").addEventListener("click", () => remove(true));
  return li;
}

function fillRow(li, t) {
  li.className = "torrent " + stateClass(t);
  const name = li.querySelector(".name");
  name.textContent = t.name;
  name.title = t.name;
  li.querySelector(".fill").style.width = (t.status === 2 ? t.recheckProgress : t.percentDone) * 100 + "%";
  li.querySelector(".status").textContent = describe(t);
  li.querySelector(".status").title = describe(t);
  li.querySelector(".rates").textContent =
    t.status === 0 ? "" : `↓ ${speed(t.rateDownload)}  ↑ ${speed(t.rateUpload)}`;
  const toggle = li.querySelector(".toggle");
  const paused = t.status === 0;
  toggle.innerHTML = paused ? "&#9654;" : "&#10074;&#10074;";
  toggle.title = tr(paused ? "start" : "pause");
  li.querySelector(".confirm").hidden = !confirming.has(t.id);
}

function showMessage(text, isError = false, withSettings = false) {
  msg.hidden = false;
  msg.className = isError ? "error" : "";
  msg.textContent = text;
  if (withSettings) {
    const b = document.createElement("button");
    b.textContent = tr("openSettings");
    b.onclick = () => chrome.runtime.openOptionsPage();
    msg.append(document.createElement("br"), b);
  }
}
function hideMessage() {
  msg.hidden = true;
}

// ---------- data ----------
async function refresh() {
  try {
    torrents = await getTorrents(settings);
    render();
  } catch (e) {
    torrents = [];
    list.replaceChildren();
    showMessage(e.message, true, e.kind !== "rpc");
  }
}

async function act(method, args) {
  try {
    await rpc(method, args, settings);
  } catch (e) {
    showMessage(e.message, true);
  }
  await refresh();
  chrome.runtime.sendMessage("refresh-badge").catch(() => {});
}

// ---------- wiring ----------
document.querySelectorAll("#filters button").forEach((b) =>
  b.addEventListener("click", () => {
    filter = b.dataset.filter;
    try { localStorage.setItem("filter", filter); } catch {}
    render();
  })
);
$("#startAll").onclick = () => act("torrent-start", {});
$("#stopAll").onclick = () => act("torrent-stop", {});
$("#openWeb").onclick = () => (settings.url ? chrome.tabs.create({ url: webUrl(settings) }) : chrome.runtime.openOptionsPage());
$("#openOptions").onclick = () => chrome.runtime.openOptionsPage();

(async () => {
  try { filter = localStorage.getItem("filter") || "all"; } catch {}
  if (!FILTERS[filter]) filter = "all";
  settings = await getSettings();
  showMessage(tr("connecting"));
  await refresh();
  timer = setInterval(refresh, Math.max(1, settings.refreshSeconds) * 1000);
})();
