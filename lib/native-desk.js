'use strict';
/*
 * What the creator-native signals are made into (ios/IDEAS-FEED.md L10). Pure: people with their signals go in (lib/native-signals.js);
 * out come
 *   rows      a creator's story no outlet has told yet, as a row the series can tag Early: two independent kinds of signal inside
 *             six hours of each other, a title "<name> <noun>" whose noun the signals themselves say, and one line built from what
 *             they say, told as reported (a video's title is its maker's claim; a ban flag is a fact with no reason);
 *   attached  the same signals on the rows the engine already lists for that person, so their samples, their status and their graph
 *             read the creators' side, and the page can lead with the stories creators are actually talking about;
 *   research  the names worth their own search this cycle.
 * Nothing here is a headline. A row made here has no outlet, no search and no "Reported by": it says so by what it carries.
 */
const TN = require('../engine/talk-nouns');
const NS = require('./native-signals');
const { naturalKey } = require('./identity');
const { keyOf, HOUR } = require('./util');

// (eighteen hours, as lib/measure.js K.EARLY_KIND_SPAN reads it since 2026-10-12)
const KIND_SPAN = 18 * HOUR;
const YOUNG = 30 * HOUR;
const LIVE_WITHIN = 12 * HOUR;
const LINE_MAX = 200;
const HEAT_BASE = 12;
const HEAT_PER_KIND = 6;
const HEAT_PER_ITEM = 2;
const HEAT_ITEMS_MAX = 8;
// (always under the heat a row is on the page for in its own right: a row made here is unproven by construction. lib/history.js PAGE_OWN_HEAT)
const HEAT_MAX = 38;
const RESEARCH_PER_CYCLE = 4;
const ROWS_PER_CYCLE = 6;
const ITEMS_KEPT = 24;
// the order a line is told in: what the platform shows, what creators made, what was clipped, what is argued, what is asked
const TELL_ORDER = ['platform', 'creators', 'clips', 'reddit', 'asked'];
const BOARD = { livestreamfail: 'r/LivestreamFail', youtubedrama: 'r/youtubedrama', fauxmoi: 'r/Fauxmoi', popculturechat: 'r/popculturechat', tiktokcringe: 'r/TikTokCringe', outoftheloop: 'r/OutOfTheLoop',
  kaicenat: 'r/Kaicenat', hiphopheads: 'r/hiphopheads', beautyguruchatter: 'r/BeautyGuruChatter', subredditdrama: 'r/SubredditDrama', ontd: 'ONTD' };

const count = (n) => Math.round(n).toLocaleString('en-US');
/** A number said roundly: 12,400 is "about 12,000". */
const about = (n) => { const m = Math.pow(10, Math.max(2, Math.floor(Math.log10(Math.max(1, n))) - 1)); return count(Math.round(n / m) * m); };
const listOf = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** A name as a card prints it: a roster's or its source's own spelling ("xQc", "jawbreakergirl"), else each word capitalised ("jack doherty" is "Jack Doherty"). */
const shown = (p) => p.name || p.key.replace(/(?<![\p{L}\p{N}])\p{L}/gu, (c) => c.toUpperCase());

/** Whether two of a person's kinds were first seen inside six hours of each other, both inside the last thirty hours (C3: corroboration). */
function corroborated(kinds, t) {
  const times = Object.values(kinds).map((k) => k.at).filter((at) => Number.isFinite(at) && t - at <= YOUNG).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] <= KIND_SPAN) return true;
  return false;
}

/** The noun family a person's signals say most, of the ones a row told only by posts and videos may carry; null when they say none. */
function familyOf(p) {
  const top = Object.entries(p.families).filter(([f]) => NS.NATIVE_FAMS.has(f)).sort((a, b) => b[1] - a[1] || (TN.FAMILY.get(b[0]).w || 0) - (TN.FAMILY.get(a[0]).w || 0) || a[0].localeCompare(b[0]))[0];
  return top ? top[0] : null;
}
/** The noun as the title says it ("ban", "allegations", "beef"), from a text of the person's own signals that says the family. */
function nounOf(family, text) {
  const f = TN.FAMILY.get(family);
  if (!f) return null;
  // (asked, never stated: a question about a cancelling is backlash, not a cancelled show)
  if (family === 'quit' && /\bbanned\b/i.test(text || '')) return 'ban';
  if (family === 'backlash' && /getting (?:cancell?ed|hate)|mad at/i.test(text || '')) return 'backlash';
  return f.noun(String(text || ''));
}

/**
 * A person's signals as one family's row may read them: an item that says ANOTHER drama noun and not this one belongs to another
 * story and is left out; a kind with no item left is gone. family: a noun family's key.
 */
function signalsFor(p, family) {
  const f = family ? TN.FAMILY.get(family) : null;
  // (a video that says no noun at all still fits when its title is about trouble: "The Rakai situation"; his gameplay video does not)
  const fits = (i) => { if (!f || !i.title) return true; if (i.fam !== undefined) return i.fam === null || i.fam === family; const said = NS.familiesOf(i.title); return said.includes(family) || (!said.length && (i.k !== 'upload' || NS.DRAMA_ISH.test(i.title))); };
  const kinds = {};
  for (const [kind, k] of Object.entries(p.kinds)) {
    const items = k.items.filter(fits);
    // (a ban is a ban's signal and nobody else's; followers falling say nothing about why and stand beside any story)
    if (kind === 'platform' && k.says.includes('ban') && family && family !== 'quit' && !k.says.some((s) => s.startsWith('dip|'))) continue;
    if (!items.length) continue;
    kinds[kind] = { ...k, items, at: kind === 'creators' ? k.at : Math.min(...items.map((i) => i.t)) };
  }
  return kinds;
}

/** One sentence for a kind of signal, with no full stop: what it says, as reported. brief: without the title it would quote. */
function tell(kind, k, p, family, brief = false) {
  const name = shown(p);
  const f = TN.FAMILY.get(family);
  const saying = (titles) => titles.find((x) => f && TN.says(x, f)) || titles[0];
  if (kind === 'platform') {
    if (k.says.includes('ban')) return `Twitch shows ${name}’s channel as banned`;
    const dip = k.says.find((s) => s.startsWith('dip|'));
    return dip ? `${name}’s Twitch channel lost about ${about(Number(dip.slice(4)))} followers within hours` : null;
  }
  if (kind === 'creators') {
    const channels = [...new Set(k.items.map((i) => i.outlet).filter(Boolean))];
    if (channels.length < 2) return null;
    const title = saying(k.items.map((i) => i.title).filter(Boolean));
    return `${listOf(channels.slice(0, 2))}${channels.length > 2 ? ' and other commentary channels' : ''} posted videos about ${name}${title && !brief ? `; one is titled “${NS.quotable(title)}”` : ''}`;
  }
  if (kind === 'clips') {
    const best = [...k.items].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    return best ? `a clip ${brief ? 'about it' : `titled “${NS.quotable(best.title)}”`} ${Number.isFinite(best.score) ? `has ${count(best.score)} points` : 'is climbing'} on r/LivestreamFail` : null;
  }
  if (kind === 'reddit') {
    const best = k.items.find((i) => f && TN.says(i.title || '', f)) || k.items[0];
    return best ? `a thread ${brief ? 'about it' : `titled “${NS.quotable(best.title)}”`} is drawing comments on ${BOARD[best.sub] || 'Reddit'}` : null;
  }
  if (kind === 'asked') {
    const q = saying(k.says);
    return q ? `people are searching “${q}”` : null;
  }
  return null;
}
// (a sentence that opens with a name keeps the name's own spelling: "penguinz0 and ...", "xQc’s Twitch channel ...")
const capital = (s) => (s && /^(?:a |an |people |the )/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The one line of a row made here: the two strongest kinds, each told as what its source shows, joined in one line of 200
 * characters at most. null when fewer than two kinds can be told.
 */
function lineOf(p, family, kinds) {
  const told = TELL_ORDER.filter((k) => kinds[k]).map((k) => ({ full: tell(k, kinds[k], p, family), brief: tell(k, kinds[k], p, family, true) })).filter((x) => x.full && x.brief);
  if (told.length < 2) return null;
  const [a, b] = told;
  // (both as their sources word them; too long, the second and then the first is said without the title it would quote)
  for (const [x, y] of [[a.full, b.full], [a.full, b.brief], [a.brief, b.full], [a.brief, b.brief]]) {
    const line = `${capital(x)}, and ${y}.`;
    if (line.length <= LINE_MAX) return line;
  }
  return null;
}

/** Why it is listed, one plain line each, for the sheet: what each kind of signal shows, with the numbers the sources themselves give. */
function whyOf(p, kinds) {
  const out = [];
  if (kinds.platform) out.push(kinds.platform.says.includes('ban') ? 'Twitch shows the channel as banned' : 'The channel is losing followers on Twitch');
  if (kinds.creators) {
    const channels = [...new Set(kinds.creators.items.map((i) => i.outlet).filter(Boolean))];
    out.push(`Commentary channels are posting about it: ${channels.slice(0, 3).join(', ')}`);
    if (Number.isFinite(p.viewsAnHour) && p.viewsAnHour >= 1000) out.push(`Those videos are gaining about ${about(p.viewsAnHour)} views an hour`);
  }
  if (kinds.clips) { const best = [...kinds.clips.items].sort((a, b) => (b.score || 0) - (a.score || 0))[0]; if (best && Number.isFinite(best.score)) out.push(`A clip about it has ${count(best.score)} points on r/LivestreamFail`); }
  if (kinds.reddit) { const sub = kinds.reddit.items[0] && kinds.reddit.items[0].sub; out.push(`People are commenting on it on ${BOARD[sub] || 'Reddit'} right now`); }
  if (kinds.asked) out.push(`People are searching “${kinds.asked.says[0]}”${p.confirmed ? ' on Google and Bing' : ''}`);
  return out;
}

/** What a row carries of a person's signals (`meta.native`): the items by their own times, when each kind was first seen, views an hour, why. */
function nativeMeta(p, kinds, t) {
  const items = Object.values(kinds).flatMap((k) => k.items).filter((i) => Number.isFinite(i.t) && i.t <= t).sort((a, b) => a.t - b.t).slice(-ITEMS_KEPT)
    .map((i) => ({ t: i.t * 1000, k: i.k, title: i.title || null, outlet: i.outlet || null, ...(i.sub ? { sub: i.sub } : {}), ...(Number.isFinite(i.rank) ? { rank: i.rank } : {}) }));
  return { items, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.at])), viewsAnHour: kinds.creators && Number.isFinite(p.viewsAnHour) ? p.viewsAnHour : null, why: whyOf(p, kinds),
    live: Object.values(kinds).filter((k) => k.items.some((i) => t - i.t <= KIND_SPAN)).length };
}

/**
 * Whether a person can be a row's subject: a creator a roster lists, or a name the sources themselves call a creator that is no
 * dictionary word or lone given name. Never someone who is no creator: a celebrity's story is an outlet's to tell.
 */
const nameable = (p) => p.key.split(' ').length <= 3 && !!p.creator && (p.known || !p.strict);

/**
 * The rows made this cycle: [row] in the shape lib/rows.js gives a talking point, for every audience named. A person lists when
 * they can be named, two kinds of signal corroborate inside six hours, the newest signal is inside twelve, the signals say a noun
 * a row told by posts alone may carry, and the engine does not already list them (`taken`: subject keys).
 * ctx: { t, audiences, taken: Set, rankFrom: { audience: first free engine rank } }.
 */
function rowsOf(people, { t, audiences = ['US'], taken = new Set(), rankFrom = {} }) {
  const made = [];
  const listed = (key) => [...taken].some((s) => s === key || ` ${s} `.includes(` ${key} `) || ` ${key} `.includes(` ${s} `));
  for (const p of people.values()) {
    if (!nameable(p) || listed(p.key)) continue;
    const family = familyOf(p);
    if (!family) continue;
    const kinds = signalsFor(p, family);
    if (Object.keys(kinds).length < 2 || !corroborated(kinds, t)) continue;
    const newest = Math.max(...Object.values(kinds).flatMap((k) => k.items.map((i) => i.t)));
    if (t - newest > LIVE_WITHIN) continue;
    const noun = nounOf(family, p.texts[family]);
    const line = lineOf(p, family, kinds);
    if (!noun || !line) continue;
    const n = Object.values(kinds).reduce((a, k) => a + k.items.length, 0);
    made.push({ p, family, noun, line, kinds, heat: Math.min(HEAT_MAX, HEAT_BASE + HEAT_PER_KIND * Object.keys(kinds).length + Math.min(HEAT_ITEMS_MAX, HEAT_PER_ITEM * n) + (p.confirmed ? 2 : 0)) });
  }
  made.sort((a, b) => b.heat - a.heat || a.p.key.localeCompare(b.p.key));
  const out = {};
  for (const audience of audiences) {
    out[audience] = made.slice(0, ROWS_PER_CYCLE).map((m, i) => {
      const surface = shown(m.p);
      const title = `${surface} ${m.noun}`;
      const meta = { key: m.p.key, subject: m.p.key, surface, family: m.family, noun: m.noun, from: 'native', own: [], outletsOwn: 0, outletsAll: 0, trends: [], fresh: [], wiki: null, also: [], creator: true, person: true,
        // (it has no name search to wait for: its signals carry their own times)
        searched: true, newsAt: null, ytAt: null, timeline: { first: null, replies: [], chapter: null, latest: null }, native: nativeMeta(m.p, m.kinds, t) };
      const point = { title, kind: 'story', what: m.line, subject: surface, noun: m.noun, heat: m.heat, status: 'rising', sources: [], tier: 'creator', drama: true, from: 'native', meta };
      return { audience, engineRank: (rankFrom[audience] || 1) + i, kind: 'talk', title, heat: m.heat, engineStatus: 'rising', drama: true, type: 'point', cardKey: `point:${title}`, point, word: null, moment: null, meta, wordish: false,
        line: m.line, subject: m.p.key, surface, family: m.family, noun: m.noun, tier: 'creator', native: true, natural: naturalKey({ kind: 'talk', subject: m.p.key, family: m.family, noun: m.noun, title }), heads: [] };
    });
  }
  return out;
}

/**
 * The engine's rows with the creators' side attached: a talking point whose subject the signals are about gains `meta.native`, the
 * signals that fit its own noun. Rows the signals say nothing of come back as they were.
 */
function attach(rows, people, index, t) {
  return rows.map((row) => {
    if (row.type !== 'point' || row.wordish || row.native) return row;
    const key = keyOf(row.subject || '');
    const p = people.get(index.alias.get(key) || key) || people.get(index.alias.get(keyOf(row.surface || '')) || '');
    if (!p) return row;
    const kinds = signalsFor(p, row.family || null);
    if (!Object.keys(kinds).length) return row;
    return { ...row, meta: { ...(row.meta || {}), native: nativeMeta(p, kinds, t) } };
  });
}

/**
 * The names worth their own search this cycle, `max` at most: who two kinds agree on first, then one kind, then the shortlist.
 * lately(name): the name was searched inside the last few hours.
 */
function research(people, { lately = () => false, max = RESEARCH_PER_CYCLE } = {}) {
  const score = (p) => 10 * Object.keys(p.kinds).length + (p.known ? 2 : 0) + (p.shortlist ? 1 : 0);
  return [...people.values()].filter((p) => nameable(p) && (Object.keys(p.kinds).length || p.shortlist)).sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key))
    .map(shown).filter((name) => !lately(name)).slice(0, max);
}

module.exports = { rowsOf, attach, research, lineOf, whyOf, familyOf, nounOf, signalsFor, corroborated, nameable, shown, nativeMeta, HEAT_MAX, KIND_SPAN };
