// Localization. Strings live in _locales/<lang>/messages.json; English is the fallback for any key a
// translation lacks. chrome.i18n can only follow Edge's display language and cannot be switched, so the
// extension loads the message files itself: the "language" setting picks one, and "auto" takes the
// first supported language from the profile's preferred languages (edge://settings/languages), then
// Edge's display language. Only the manifest strings (__MSG_…__) still go through chrome.i18n.
//
// Pages: `await ready` before anything else (top-level await). The service worker cannot use
// top-level await, so it awaits `ready` inside its handlers and calls loadLanguage() on changes.

// Native names, shown in the language picker as they are.
export const LANGUAGES = {
  en: "English",
  ru: "Русский",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  pt_BR: "Português (Brasil)",
  zh_CN: "简体中文",
};

let messages = {};
let fallback = {};
export let code = "en"; // folder name in _locales
export let lang = "en"; // BCP 47 tag for Intl and <html lang>
let rules = new Intl.PluralRules("en");
const formats = new Map();

// "pt-BR" → pt_BR, "ru-RU" → ru, "es-419" → es, "zh-CN"/"zh-Hans" → zh_CN. Traditional Chinese
// (zh-TW, zh-HK, zh-Hant) is not offered Simplified Chinese.
export function matchLanguage(tag) {
  const t = String(tag || "").replace("_", "-").toLowerCase();
  const [base, region] = t.split("-");
  const exact = Object.keys(LANGUAGES).find((k) => k.toLowerCase().replace("_", "-") === t);
  if (exact) return exact;
  if (base === "zh") return /^(tw|hk|mo|hant)$/.test(region || "") ? null : "zh_CN";
  return Object.keys(LANGUAGES).find((k) => k.split("_")[0] === base) || null;
}

export async function autoLanguage() {
  let preferred = [];
  try { preferred = await chrome.i18n.getAcceptLanguages(); } catch {}
  for (const tag of [...preferred, chrome.i18n.getUILanguage()]) {
    const m = matchLanguage(tag);
    if (m) return m;
  }
  return "en";
}

async function readMessages(c) {
  try {
    return await (await fetch(chrome.runtime.getURL(`_locales/${c}/messages.json`))).json();
  } catch {
    return {};
  }
}

export async function loadLanguage() {
  let setting = "auto";
  try { ({ language: setting } = await chrome.storage.sync.get({ language: "auto" })); } catch {}
  code = LANGUAGES[setting] ? setting : await autoLanguage();
  lang = code.replace("_", "-");
  [messages, fallback] = await Promise.all([readMessages(code), code === "en" ? null : readMessages("en")]);
  fallback = fallback || messages;
  rules = new Intl.PluralRules(lang);
  formats.clear();
  return code;
}
export const ready = loadLanguage();

const lookup = (key) => (messages[key] || fallback[key] || {}).message;
const fill = (msg, subs) => msg.replace(/\$(\$|\d)/g, (_, d) => (d === "$" ? "$" : String(subs[d - 1] ?? "")));

// Message with $1…$9 filled in. Returns the key itself if it is missing, so gaps are easy to spot.
export function t(key, ...subs) {
  const msg = lookup(key);
  return msg == null ? key : fill(msg, subs);
}

// Plural forms: picks key_one / key_few / key_many / key_other by count n (CLDR categories via
// Intl.PluralRules), falling back to key_other.
export function plural(key, n, ...subs) {
  const msg = (messages[`${key}_${rules.select(n)}`] || {}).message;
  return msg != null ? fill(msg, subs) : t(`${key}_other`, ...subs);
}

export function num(n, digits = 0) {
  if (!formats.has(digits)) {
    formats.set(digits, new Intl.NumberFormat(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return formats.get(digits).format(n);
}

export function bytes(n) {
  const u = t("byteUnits").split(" ");
  if (!n) return "0 " + u[0];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return num(n / 1024 ** i, i ? 1 : 0) + " " + u[i];
}

// Fills elements marked data-i18n (text), data-i18n-html (our own markup such as <b>),
// data-i18n-title and data-i18n-placeholder. Also fills <template> contents.
export function localize(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const tpl of root.querySelectorAll("template")) localize(tpl.content);
  if (root === document) document.documentElement.lang = lang;
}
