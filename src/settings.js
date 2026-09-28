// The settings the setup window offers - six of the twenty-odd.
//
// The rest are engine tuning (scan timing, memory windows, the offsets
// URL, calls a minute) that a player should never need, and a panel of
// all of them would make the app look harder than it is. They stay in
// config.json, the window says so, and a button opens the folder.
//
// Whatever arrives from the window is made safe HERE before it is saved:
// the page is ours, but a settings file is no place for "whatever came".

import { SCRIPTS } from './chatlog.js';

// In the order the window lists them. Russian first: it is what this is for.
export const LANGUAGES = [
  ['cyrillic', 'Russian'],
  ['spanish', 'Spanish (Latin American, on US servers)'],
  ['han', 'Chinese'],
  ['hangul', 'Korean'],
  ['greek', 'Greek'],
  ['arabic', 'Arabic'],
  ['thai', 'Thai'],
];

// Russian for EU, Spanish for US, Chinese for SEA (the user, 2026-09-23: the
// most repeated SEA complaint is Chinese players who cannot use English -
// China's own servers are emptying and they queue on SEA).
export const THEIRS = ['Russian', 'Spanish', 'Chinese'];
const THEIR_SCRIPT = { Russian: 'cyrillic', Spanish: 'spanish', Chinese: 'han' };
const isEnglish = (s) => String(s || '').trim().toLowerCase() === 'english';

// The app's own keys - hide/show the overlay, quit - are the player's to
// change or turn off (a player, 2026-09-28: Alt+D "eats the input, preventing
// Dota from getting it" - Alt+key is alt-cast in Dota). A key registered for
// the whole system is taken from every program, so: a letter or a digit only
// with Ctrl or Alt; F1-F24 and a few others alone; never Enter (Ctrl+Enter is
// the say key). Answers Electron's accelerator, '' for none, or null.
const MODS = { ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift' };
const ALONE_OK = /^(F([1-9]|1\d|2[0-4])|Home|End|PageUp|PageDown|Insert|Pause|ScrollLock)$/;
export function normalizeHotkey(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  const parts = t.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const mods = new Set();
  for (const p of parts.slice(0, -1)) {
    const m = MODS[p.toLowerCase()];
    if (!m || mods.has(m)) return null;
    mods.add(m);
  }
  let key = parts[parts.length - 1];
  if (/^[a-z0-9]$/i.test(key)) key = key.toUpperCase();
  else if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  else key = { home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', pause: 'Pause', scrolllock: 'ScrollLock' }[key.toLowerCase()] || null;
  if (!key || !(/^[A-Z0-9]$/.test(key) || ALONE_OK.test(key))) return null;
  // A letter or digit with only Shift (or nothing) would take that character
  // from every program on the PC.
  if (/^[A-Z0-9]$/.test(key) && !mods.has('Control') && !mods.has('Alt')) return null;
  return ['Control', 'Alt', 'Shift'].filter((m) => mods.has(m)).concat(key).join('+');
}
const keyOf = (v, fallback) => (typeof v === 'string' ? v : fallback);

/** What the window is shown: only these, never the key. */
export function uiSettings(cfg) {
  return {
    scripts: (cfg.scripts || []).filter((s) => s in SCRIPTS),
    showOriginal: cfg.showOriginal !== false,
    showHeroes: cfg.showHeroes !== false,
    fontSize: cfg.fontSize,
    autoUpdate: cfg.autoUpdate !== false,
    // Which way Ctrl+Enter in Dota's chat translates what the player typed.
    sayInto: isEnglish(cfg.replyLanguage) ? 'english' : 'theirs',
    theirLanguage: THEIRS.includes(cfg.theirLanguage) ? cfg.theirLanguage : 'Russian',
    hideHotkey: keyOf(cfg.hideHotkey, 'Alt+D'),
    quitHotkey: keyOf(cfg.quitHotkey, 'Alt+Shift+D'),
  };
}

/**
 * What the window sent back, as a patch for config.json. Anything missing
 * or wrong is simply not in the patch, so it stays as it was.
 */
export function settingsPatch(raw, cfg = {}) {
  const patch = {};
  if (!raw || typeof raw !== 'object') return patch;
  if (Array.isArray(raw.scripts)) {
    const known = LANGUAGES.map(([id]) => id).filter((id) => raw.scripts.includes(id));
    // Nothing ticked would be an app that translates nothing and says
    // nothing about why. Not saved.
    if (known.length) patch.scripts = known;
  }
  for (const key of ['showOriginal', 'showHeroes', 'autoUpdate']) {
    if (typeof raw[key] === 'boolean') patch[key] = raw[key];
  }
  // Two choices in the window, and a third kept out of their way: a language
  // set BY NAME in config.json ("Ukrainian") is somebody's own choice of
  // "their language", and saving the window must not flatten it to auto.
  // Their language: one of two, and the language's script is switched on
  // with it (the other one is left as it was - a player on both servers
  // can keep both ticked).
  if (THEIRS.includes(raw.theirLanguage) && raw.theirLanguage !== cfg.theirLanguage) {
    patch.theirLanguage = raw.theirLanguage;
    const have = patch.scripts || cfg.scripts || [];
    const need = THEIR_SCRIPT[raw.theirLanguage];
    // In the window's own order: a list in another order reads as "the
    // languages changed" at the next save and restarts the reader for nothing.
    if (!have.includes(need)) patch.scripts = LANGUAGES.map(([id]) => id).filter((id) => id === need || have.includes(id));
  }
  if (raw.sayInto === 'english') patch.replyLanguage = 'English';
  else if (raw.sayInto === 'theirs' && isEnglish(cfg.replyLanguage)) patch.replyLanguage = 'auto';
  // The app's own keys. A key the say keys or the other one already has is
  // refused (both would fire, or neither).
  const say = [cfg.sayHotkey, cfg.sayAllHotkey].filter(Boolean).map((k) => normalizeHotkey(k));
  for (const [name, other] of [['hideHotkey', 'quitHotkey'], ['quitHotkey', 'hideHotkey']]) {
    if (!(name in raw)) continue;
    const k = normalizeHotkey(raw[name]);
    if (k === null) continue;
    const otherNow = other in raw ? normalizeHotkey(raw[other]) : keyOf(cfg[other], other === 'hideHotkey' ? 'Alt+D' : 'Alt+Shift+D');
    if (k && (k === otherNow || say.includes(k))) continue;
    patch[name] = k;
  }
  const size = Number(raw.fontSize);
  if (Number.isFinite(size)) patch.fontSize = Math.min(28, Math.max(11, Math.round(size)));
  return patch;
}
