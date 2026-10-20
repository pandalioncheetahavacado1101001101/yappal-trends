'use strict';
/*
 * Names breaking out in the press, from GDELT's quarter-hour file (ios/IDEAS-SUPER.md P13; ios/.review/super-data-and-product.md 4).
 * The collector already reads one file a cycle (lib/sources/gdelt.js: every article the web published in a slot, a quarter of them
 * English) and keeps only the titles that name someone the list holds. This reads the same parsed articles for the names the list
 * does NOT hold: a person's name printed by three or more outlets in the newest slot, or five different ones in the last hour, at
 * three times or more its usual rate, is a breakout. One the collector has not searched lately is searched in the same cycle, when
 * the owner has switched it on (lib/discover.js gdeltStep, IDEAS_GDELT). No request of its own: the file is already in hand.
 *
 *   const found = discover(state, articles, { slot, searched, known })   -> { state, surging, fresh, stats }
 *   const queue = toFront(queue, found.fresh.map((x) => x.name))         -> those names first, each once
 *
 * A name is two or three capitalised words that read as a person's: opening with a given name, or with a word no dictionary has
 * ("Varo Tessin", invented); never a place, a team, a month, a platform. In a Title Case headline (every word capitalised)
 * the second word must be one no dictionary has, so "Senate Passes Budget" is nobody. An outlet counts once however many of its
 * local pages print the story (GDELT.outletOf).
 *
 * Precision mode (ios/.review/datasets-knowledge.md B9, on by default): distinct outlets per name per quarter-hour and over the
 * hour, never raw article counts (one outlet printing a name every slot is one outlet); the same quarter-hour last week in the
 * baseline once a week is held; and two independent outlets inside two hours (outlets that printed one wire headline are one).
 *
 * The state is the collector's own (meta): per-slot outlet and headline ids for the last two hours (short hashes, never the
 * text), per-day sums for 7 days (the busiest names of a day only), the names two outlets printed in each slot of the last week
 * (for the same quarter-hour a week on), and which names this put first and when (7 days). That last tells which rows came
 * through here, nothing more: coverage "first" stays the scoreboard's own, a row's first listing against the comparator's
 * (ios/IDEAS-SUPER.md), and a name this sent for a search counts toward it only if a row was listed, and listed first. All of it is
 * per-name, so it is private state: never published, never logged by name (a log line carries counts only).
 */
const GDELT = require('./gdelt');
const W = require('../../engine/wording');
const R = require('../../engine/rules');
const { keyOf } = require('../util');

const SLOT = GDELT.SLOT;
const DAY = 86400;
const RECENT_SLOTS = 4; // "the last hour": the newest slot and the three before it
const SLOTS_KEPT = 8;
const BASE_DAYS = 7;
const DAY_NAMES_MAX = 3000; // a day keeps its busiest names; one seen by a single outlet once is no baseline worth keeping
const BASE_SLOTS_MIN = 24; // six hours of slots before anything is called a breakout: on a cold start everything looks new
const MEAN_FLOOR = 0.2; // outlets a slot: the rate a name never seen is taken to have
const RATIO = 3; // "tripling against a 7-day mean"
const MIN_SLOT = 3; // outlets in the newest slot ...
const MIN_HOUR = 5; // ... or in the last hour
const FRESH_MAX = 3; // names put first in one cycle
const FOUND_DAYS = 7;
const STATE_VERSION = 2;
const WEEK = 7 * DAY;
const WEEK_MIN = 2; // outlets in a slot for a name to be remembered for the same quarter-hour next week
const WEEK_NAMES_MAX = 40;
const INDEPENDENT_MIN = 2; // "two independent outlets within 2 h" (B9's precision mode): two outlets printing one wire headline are one
// a name ending in an institution's or a place's word is no person ("Bank of America", "Paso County", "Wildlife Park")
const ORG_TAIL = new Set(('inc corp co ltd llc plc group news media network times post journal daily weekly magazine gazette tribune herald '
  + 'university college school academy hospital center centre clinic foundation institute council committee court department police party '
  + 'church museum club league association union bank fund capital partners holdings studios records entertainment games airlines airways '
  + 'motors energy metals mining county state province district station assembly parliament senate ministry island islands river lake '
  + 'park wildlife zoo north south east west city town village street road avenue square bridge airport stadium arena orchestra '
  + 'philharmonic festival awards cup championship series fc united show podcast tour').split(' '));
// the world's countries and regions, as the platform names them in English (never a list typed here)
const REGIONS = (() => {
  const out = new Set();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
      const code = String.fromCharCode(a, b);
      try { const n = names.of(code); if (n && n !== code) out.add(keyOf(n)); } catch { /* not a region */ }
    }
  } catch { /* no region names: places fall to the other checks */ }
  return out;
})();
// a people's or a country's adjective ("European", "Korean", "Chinese"): the four letters a region's word opens with, and an ending
const REGION_WORDS = new Set([...REGIONS].flatMap((r) => r.split(' ')).filter((w) => w.length >= 4));
const REGION_HEADS = new Set([...REGION_WORDS].map((w) => w.slice(0, 4)));
const demonym = (w) => !W.isFirstName(w) && (REGION_WORDS.has(w) || (/(?:an|ian|ean|ese|ish|i)$/.test(w) && REGION_HEADS.has(w.slice(0, 4))));

/** A word's letters without the quotes and marks around it, whether a clause ends after it, and whether it is possessive. */
function core(word) {
  const m = String(word).match(/^[^\p{L}\p{N}]*([\p{L}\p{N}](?:[\p{L}\p{N}.'’-]*[\p{L}\p{N}])?)([^\p{L}\p{N}]*)$/u);
  if (!m) return { text: '', breaks: true, possessive: false };
  const possessive = /['’]s$/i.test(m[1]);
  return { text: possessive ? m[1].slice(0, -2) : m[1], breaks: /[,:;!?.|–—"”]/.test(m[2]) || m[2].includes('-'), possessive };
}
// the months and the days of the week, as the platform names them in English ("August Maidan" is no one)
const CALENDAR = new Set([...Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2020, m, 15)).toLocaleString('en', { month: 'long', timeZone: 'UTC' })),
  ...Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2020, 5, 7 + d)).toLocaleString('en', { weekday: 'long', timeZone: 'UTC' }))].map((x) => x.toLowerCase()));
const lower = (w) => W.words(w).join('');
const acronym = (w) => /^\p{Lu}[\p{Lu}\d.&-]+$/u.test(w); // "HC", "QB", "NFC": a title or a body, not a name's word
const capital = (w) => /^\p{Lu}/u.test(w) && !acronym(w);
const given = (w) => W.isFirstName(w) || W.isProperWord(w);
const nameStart = (w) => !demonym(w) && (given(w) || (!W.inDict(w) && !R.TEAM_WORDS.has(w)));
const nobody = (ws) => ws.some((w) => W.STOP.has(w) || CALENDAR.has(w) || /\d/.test(w) || w.length < 2) || R.isPlaceOrTeam(ws.join(' ')) || REGIONS.has(ws.join(' '))
  || ws.some((w) => REGIONS.has(w)) || W.ENTITY_STOP.has(ws.join(' ')) || ws.some((w) => W.ENTITY_STOP.has(w)) || ORG_TAIL.has(ws[ws.length - 1]);

/**
 * The person-like names a headline carries: [{ key, name }], each once. In a sentence-case headline, a run of two or three
 * capitalised words (not the headline's first word unless it reads as a name; a longer run gives the names inside it that open with a
 * given name). In a Title Case one, where every word is capitalised, a name start followed by a word no dictionary has ("Varo Tessin
 * Slams ..."), or a given name, a second given name and a surname. Acronyms ("HC", "QB") are no name's words.
 */
function namesIn(title) {
  const raw = String(title || '').split(/\s+/).filter(Boolean);
  const words = raw.map(core);
  const titleCase = W.isTitleCase(raw);
  const out = new Map();
  const take = (parts) => {
    const ws = parts.map(lower);
    if (ws.length < 2 || ws.length > 3 || nobody(ws) || !nameStart(ws[0])) return false;
    const key = keyOf(parts.join(' '));
    if (!key) return false;
    if (!out.has(key)) out.set(key, { key, name: parts.join(' ') });
    return true;
  };
  const cap = (i) => !!words[i] && !!words[i].text && capital(words[i].text);
  if (titleCase) {
    for (let i = 0; i + 1 < words.length; i++) {
      if (!cap(i) || !cap(i + 1) || words[i].breaks || words[i].possessive) continue;
      const w1 = lower(words[i + 1].text);
      const third = words[i + 2];
      if (given(w1) && !words[i + 1].breaks && !words[i + 1].possessive && cap(i + 2) && !W.looksVerb(lower(third.text)) && !W.STOP.has(lower(third.text))
        && take([words[i].text, words[i + 1].text, third.text])) { i += 2; continue; }
      if (!W.inDict(w1) && take([words[i].text, words[i + 1].text])) i += 1;
    }
    return [...out.values()];
  }
  // sentence case: the maximal capitalised runs, each broken at a clause or a possessive. Two dictionary words are a phrase in
  // capitals ("European Trade"), not a person, unless the first is a given name
  // ("Samsung Galaxy", "Winless Titans": a second word a dictionary has needs a first word that is a given name)
  const plain = (ws) => (ws.every((w) => W.inDict(w)) && !W.isFirstName(ws[0])) || (W.inDict(ws[1]) && !given(ws[0]));
  let i = 0;
  while (i < words.length) {
    if (!cap(i)) { i += 1; continue; }
    const run = [i];
    while (!words[run[run.length - 1]].breaks && !words[run[run.length - 1]].possessive && cap(run[run.length - 1] + 1)) run.push(run[run.length - 1] + 1);
    i = run[run.length - 1] + 1;
    let parts = run.map((k) => words[k].text);
    // ("Why Varo Tessin ...": a headline's first word is capitalised whatever it is)
    if (run[0] === 0 && parts.length > 2 && !nameStart(lower(parts[0]))) { run.shift(); parts = parts.slice(1); }
    // ("Varo Tessin Getting ...": a third word a dictionary has, after a surname, is the headline's)
    if (parts.length === 3 && W.inDict(lower(parts[2])) && (!given(lower(parts[1])) || W.looksVerb(lower(parts[2])) || /ing$/.test(lower(parts[2])))) parts = parts.slice(0, 2);
    const opens = run[0] > 0 || nameStart(lower(parts[0]));
    if (parts.length >= 2 && parts.length <= 3 && opens && !plain(parts.map(lower))) { take(parts); continue; }
    if (parts.length <= 3) continue;
    // a longer run ("Varo Tessin West End"): the pairs in it that open as a name and close with a word no dictionary has
    for (let k = 0; k + 1 < parts.length; k++) {
      const a = lower(parts[k]); const b = lower(parts[k + 1]);
      if ((given(a) || !W.inDict(a)) && (!W.inDict(b) || given(b)) && take(parts.slice(k, k + 2))) k += 1;
    }
  }
  return [...out.values()];
}

/** A short, stable id for an outlet or a headline in the state (FNV-1a, base 36): the state keeps who and which, never the text. */
function idOf(text) {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/**
 * One slot's articles -> Map(key -> { name, outlets, pairs }): how many outlets printed each name (an outlet's chain of pages once),
 * and [outlet id, headline id] for each headline an outlet printed it in (what "independent" is read from).
 */
function countSlot(articles) {
  const byKey = new Map();
  for (const a of articles || []) {
    if (!a || !a.title) continue;
    const outlet = GDELT.outletOf(a.host || GDELT.hostOf(a.url) || '');
    const head = idOf(keyOf(a.title));
    for (const { key, name } of namesIn(a.title)) {
      if (!byKey.has(key)) byKey.set(key, { name, outlets: new Set(), pairs: new Map(), surfaces: new Map() });
      const e = byKey.get(key);
      e.outlets.add(outlet);
      e.pairs.set(`${idOf(outlet)} ${head}`, [idOf(outlet), head]);
      e.surfaces.set(name, (e.surfaces.get(name) || 0) + 1);
    }
  }
  return new Map([...byKey].map(([key, e]) => [key, { name: [...e.surfaces].sort((x, y) => y[1] - x[1])[0][0], outlets: e.outlets.size, pairs: [...e.pairs.values()] }]));
}

/**
 * How many independent outlets printed a name: outlets that printed the very same headline are one (a wire story and its copies),
 * so this is the number of groups of outlets joined by a shared headline. pairs: [[outlet id, headline id]].
 */
function independentOf(pairs) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const join = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [o, h] of pairs) { const ok = `o${o}`; const hk = `h${h}`; if (!parent.has(ok)) parent.set(ok, ok); if (!parent.has(hk)) parent.set(hk, hk); join(ok, hk); }
  return new Set([...parent.keys()].filter((k) => k[0] === 'o').map(find)).size;
}

const emptyState = () => ({ v: STATE_VERSION, since: null, slots: [], days: [], week: [], found: {} });
/** A state read back, or a new one when it is missing or not this version's. */
const stateOf = (s) => (s && s.v === STATE_VERSION && Array.isArray(s.slots) && Array.isArray(s.days) && Array.isArray(s.week) && s.found && typeof s.found === 'object' ? s : emptyState());

/** The 7-day baseline before `slot`: Map(key -> outlets a slot), and how many slots it rests on. */
function baseline(state, slot) {
  const from = Math.floor(slot / DAY) - BASE_DAYS;
  const sums = new Map();
  let slots = 0;
  for (const [day, seen, counts] of state.days) {
    if (day < from) continue;
    slots += seen;
    for (const [k, n] of Object.entries(counts)) sums.set(k, (sums.get(k) || 0) + n);
  }
  return { mean: new Map([...sums].map(([k, n]) => [k, slots ? n / slots : 0])), slots };
}

/**
 * The same quarter-hour last week, once a week is held (B9): Map(key -> outlets), the busiest of the slot a week before and the one
 * on either side of it (a slot GDELT never wrote is no quiet one), or null while the state is younger than a week.
 */
function lastWeek(state, slot) {
  if (!Number.isFinite(state.since) || state.since > slot - WEEK - SLOT) return null;
  const out = new Map();
  for (const [s, counts] of state.week) {
    if (Math.abs(s - (slot - WEEK)) > SLOT) continue;
    for (const [k, n] of Object.entries(counts)) out.set(k, Math.max(out.get(k) || 0, n));
  }
  return out;
}

/** The state with one slot's counts added (a slot already in it is not counted twice). */
function withSlot(state, slot, counts) {
  if (state.slots.some(([s]) => s === slot)) return state;
  const pairsOf = Object.fromEntries([...counts].map(([k, e]) => [k, e.pairs]));
  const slots = [...state.slots, [slot, pairsOf]].sort((x, y) => x[0] - y[0]).slice(-SLOTS_KEPT);
  const plain = Object.fromEntries([...counts].map(([k, e]) => [k, e.outlets]));
  const day = Math.floor(slot / DAY);
  const old = state.days.find(([d]) => d === day);
  const sum = { ...(old ? old[2] : {}) };
  for (const [k, n] of Object.entries(plain)) sum[k] = (sum[k] || 0) + n;
  const kept = Object.fromEntries(Object.entries(sum).sort((x, y) => y[1] - x[1]).slice(0, DAY_NAMES_MAX));
  const days = [...state.days.filter(([d]) => d !== day && d > day - BASE_DAYS - 1), [day, (old ? old[1] : 0) + 1, kept]].sort((x, y) => x[0] - y[0]);
  // (next week's same quarter-hour: only the names two outlets or more printed in the slot, the busiest few)
  const busy = Object.fromEntries(Object.entries(plain).filter(([, n]) => n >= WEEK_MIN).sort((x, y) => y[1] - x[1]).slice(0, WEEK_NAMES_MAX));
  const week = [...state.week.filter(([s]) => s !== slot && s > slot - WEEK - 2 * SLOT), [slot, busy]].sort((x, y) => x[0] - y[0]);
  return { ...state, since: Number.isFinite(state.since) ? Math.min(state.since, slot) : slot, slots, days, week };
}

/**
 * One slot of discovery. state: what the last call returned (or null); articles: GDELT.parse(text) of this slot's file; slot: its
 * epoch seconds; searched(name) / known(name): whether the collector has searched the name lately / the list holds it.
 *
 * A breakout: printed by three or more outlets in the slot, or five or more different outlets in the last hour (an outlet that
 * prints the name every quarter-hour is one outlet, never four: distinct sources, never raw counts), at three times or more its
 * rate, the rate being the 7-day mean or, once a week is held, the same quarter-hour last week, whichever is higher. In precision
 * mode (B9, the default) it must also have two independent outlets inside the last two hours: two outlets that printed one wire
 * headline are one.
 * Returns { state (new), surging: [{ key, name, outlets, hour, independent, mean, week, ratio }], fresh: the surging the collector has
 * not searched and the list does not hold (at most `freshMax`, busiest first), stats: { articles, names, surging, fresh, baseSlots,
 * weekly } }.
 */
function discover(state, articles, { slot, searched = () => false, known = () => false, freshMax = FRESH_MAX, precise = true } = {}) {
  const before = stateOf(state);
  if (!Number.isFinite(slot) || before.slots.some(([s]) => s === slot)) {
    return { state: before, surging: [], fresh: [], stats: { articles: 0, names: 0, surging: 0, fresh: 0, baseSlots: baseline(before, slot || 0).slots, weekly: false } };
  }
  const counts = countSlot(articles);
  const base = baseline(before, slot);
  const week = lastWeek(before, slot);
  const recent = before.slots.filter(([s]) => s > slot - RECENT_SLOTS * SLOT && s < slot);
  const window = before.slots.filter(([s]) => s > slot - SLOTS_KEPT * SLOT && s < slot);
  const surging = [];
  if (base.slots >= BASE_SLOTS_MIN) {
    for (const [key, e] of counts) {
      const outletsIn = (slots) => new Set([...e.pairs, ...slots.flatMap(([, c]) => c[key] || [])].map(([o]) => o));
      const hour = outletsIn(recent).size;
      const mean = base.mean.get(key) || 0;
      const last = week ? week.get(key) || 0 : 0;
      const ratio = (hour / (recent.length + 1)) / Math.max(mean, last, MEAN_FLOOR);
      if (!((e.outlets >= MIN_SLOT || hour >= MIN_HOUR) && ratio >= RATIO)) continue;
      const independent = independentOf([...e.pairs, ...window.flatMap(([, c]) => c[key] || [])]);
      if (precise && independent < INDEPENDENT_MIN) continue;
      surging.push({ key, name: e.name, outlets: e.outlets, hour, independent, mean: Math.round(mean * 1000) / 1000, week: week ? last : null, ratio: Math.round(ratio * 10) / 10 });
    }
  }
  surging.sort((x, y) => y.hour - x.hour || y.ratio - x.ratio || x.key.localeCompare(y.key));
  const fresh = surging.filter((x) => !searched(x.name) && !known(x.name)).slice(0, freshMax);
  const found = Object.fromEntries([...Object.entries(before.found).filter(([, at]) => slot - at < FOUND_DAYS * DAY), ...fresh.filter((x) => !(x.key in before.found)).map((x) => [x.key, slot])]);
  const next = { ...withSlot(before, slot, counts), found };
  return { state: next, surging, fresh, stats: { articles: (articles || []).length, names: counts.size, surging: surging.length, fresh: fresh.length, baseSlots: base.slots, weekly: !!week } };
}

/** The queue with `names` first (at most `max` of them), each name once (by its letters and digits, as the name search keys it). */
function toFront(queue, names, max = FRESH_MAX) {
  const k = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  const first = [];
  for (const n of names || []) if (first.length < max && !first.some((x) => k(x) === k(n))) first.push(n);
  const seen = new Set(first.map(k));
  const rest = (queue || []).filter((n) => { const key = k(n); if (seen.has(key)) return false; seen.add(key); return true; });
  return [...first, ...rest];
}

/**
 * When this module put a name at the front of the search queue (epoch seconds), within the last 7 days, or null. For attribution
 * only (which first-listed rows came through GDELT), never a numerator: putting a name first is not listing it first.
 */
const foundAt = (state, name) => { const s = stateOf(state); const key = keyOf(name); return key in s.found ? s.found[key] : null; };

module.exports = { namesIn, countSlot, independentOf, discover, toFront, foundAt, baseline, lastWeek, emptyState, idOf, RATIO, MIN_SLOT, MIN_HOUR, BASE_SLOTS_MIN, FRESH_MAX, SLOTS_KEPT, INDEPENDENT_MIN, WEEK };
