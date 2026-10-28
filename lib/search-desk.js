'use strict';
/*
 * What people are searching right now, as rows (ios/IDEAS-SUPER.md 1: the scoreboard's Google Trends coverage). Pure: the Trends
 * rows the store keeps (engine/talk-sources.js talkTrendRows, merged by lib/ingest.js) and the cycle's headlines go in; out come
 *   rows   a "Trending now" search of the audience's own countries, in the pop-culture categories (the engine's own: Beauty &
 *          Fashion, Entertainment, Games, Hobbies & Leisure), searched SEARCH_MIN times or more, begun inside the last FRESH_HOURS
 *          and still searched (or ended inside the last ENDED_HOURS), that no row of the list already tells: a row titled as people
 *          typed it, cased as its headlines print it, and told by one reported headline that names it (Google's own article for the
 *          search first, else the newest headline of the cycle that prints every word of it). With no such headline there is no row:
 *          a search with nothing written about it says nothing a card can stand on.
 * The engine's talking points want a noun its headlines repeat ("<name> allegations"); a search whose story has none ("<name>",
 * searched 100K times for an interview) was evaluated and listed nowhere. The scoreboard of 2026-10-19..25 found 11% of these
 * entries on the list. A row made here is the search, said as one: no noun, no drama, no claim of its own, only the headline.
 * Never a fixture, a service search (scores, tickets, lottery numbers), a league or a broadcaster, a question: the engine's rules
 * for a name (engine/talk-candidates.js), kept here.
 * The extended mode (`extended`, as of 2026-10-31) is an extension desk (lib/extension.js): the same rows, made the same way, of the
 * searches still searched at any age (or ended inside ENDED_HOURS) at each country's own floor (STILL_MIN), that no main row tells,
 * STILL_ROWS_MAX at most, in the section "stillSearched" after the main list. Never on the page, never searched for by the collector.
 */
const TC = require('../engine/talk-candidates');
const TS = require('../engine/talk-sources');
const TN = require('../engine/talk-nouns');
const { naturalKey } = require('./identity');
const { keyOf, homeGeos, HOUR } = require('./util');

// (Google's own category ids: engine/sources.js TRENDS_POP_CATEGORIES)
const POP_CATEGORIES = new Set([2, 4, 6, 8]);
const SEARCH_MIN = 20000;
const FRESH_HOURS = 30;
const ENDED_HOURS = 6;
const NEWS_BACK_HOURS = 72;
const TITLE_WORDS_MAX = 7;
const LINE_MAX = 200;
const ROWS_MAX = 12;
// (a row made here is unproven by construction: under the heat a row is on the page for in its own right, lib/history.js PAGE_OWN_HEAT)
const HEAT_BASE = 10;
const HEAT_PER_DECADE = 8;
const HEAT_LIVE = 4;
const HEAT_MAX = 36;
const SMALL = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'vs']);

const FIXTURE = /\b(?:vs\.?|v\.?)\s|\s[-–]\s|\s(?:at|@)\s/i;
const SERVICE = /\b(?:where to watch|how to watch|what time|when is|what channel|channel|tickets?|score|scores|standings|schedule|stats|lineups?|odds|predictions?|highlights|results|weather|forecast|server status|servers?|outage|codes?|login|near me|refunds?|checks?|stimulus|deadline|hours|tonight|today|live ?stream|release date|time|spoilers?|episode \d+|season \d+|draft|rankings?|playoffs?|bracket|polls?|calculator|lottery|powerball|mega millions|jackpot|numbers|prices?|rates?)\b/i;

/** Whether a Trends row is a search a row is made for, at `t` (seconds), for an audience's countries. */
function inScope(tr, t, geos) {
  const start = tr.start / 1000;
  const end = tr.end === null || tr.end === undefined ? null : tr.end / 1000;
  const kw = keyOf(tr.keyword);
  if (!kw || !geos.includes(tr.geo) || !(tr.cats || []).some((c) => POP_CATEGORIES.has(c)) || !(tr.volume >= SEARCH_MIN)) return false;
  if (start > t || t - start > FRESH_HOURS * HOUR || (end !== null && t - end > ENDED_HOURS * HOUR)) return false;
  if (kw.split(' ').length > TITLE_WORDS_MAX || FIXTURE.test(` ${tr.keyword} `) || SERVICE.test(tr.keyword) || TC.LEAGUE_KW.test(kw) || TN.QUESTION.test(tr.keyword)) return false;
  return true;
}

const words = (text) => keyOf(text).split(' ').filter(Boolean);
const has = (hay, key) => !!key && ` ${hay} `.includes(` ${key} `);

/**
 * Whether a row of the list already tells the search: the engine tied it to the row (its searches), or the row's subject is the
 * search's opening name ("quorra bellwind" of "quorra bellwind pet passes away"), or the search is in the row's title.
 */
function told(tr, row) {
  const kw = keyOf(tr.keyword);
  if (((row.meta && row.meta.trends) || []).some((x) => keyOf(x.keyword || '') === kw)) return true;
  const names = [row.subject, row.surface, ...((row.point && row.point.also) || [])].map((x) => keyOf(x || '')).filter((x) => x.split(' ').length >= 2 || (x && x === kw));
  if (names.some((n) => n === kw || kw.startsWith(`${n} `))) return true;
  const title = keyOf(row.title || '');
  return has(title, kw) || (title.split(' ').length >= 2 && kw.startsWith(`${title} `));
}

/** A headline without its outlet's tail ("... - People.com"). */
const plainHead = (h) => TN.cleanHeadline(String(h.title || ''), h.outlet || '').replace(/\s+[-–—|]\s+[^-–—|]{2,40}$/, '').trim();

/**
 * The headline that tells the search: Google's own article for it (the store's moment trend of the same key), else the newest of
 * the cycle's headlines that prints every word of it (three letters or more). { title, t (ms), outlet, url } or null.
 */
function headlineOf(tr, ctx) {
  return headlinesOf(tr, ctx)[0] || null;
}
/** Every headline that tells the search, in headlineOf's order (Google's own article, then the newest first). */
function headlinesOf(tr, { resolved = new Map(), news = [], t }) {
  const out = [];
  const own = resolved.get(tr.key);
  if (own && own.title && Number.isFinite(own.t) && own.t / 1000 <= t + HOUR) out.push({ title: plainHead(own), t: own.t, outlet: own.publisher || null, url: own.url || null });
  const need = words(tr.keyword).filter((w) => w.length >= 3 && !SMALL.has(w));
  if (!need.length) return out;
  const from = (tr.start / 1000 - NEWS_BACK_HOURS * HOUR) * 1000;
  const hits = news.filter((h) => h && h.title && Number.isFinite(h.t) && h.t >= from && h.t / 1000 <= t + HOUR && need.every((w) => has(keyOf(h.title), w)))
    .sort((a, b) => b.t - a.t);
  return [...out, ...hits.map((h) => ({ title: plainHead(h), t: h.t, outlet: h.outlet || null, url: h.url || null }))];
}

// (the extended mode's choice of words, wave 9 merge: the phone hides a line that opens with the row's title (ios Core
// IdeasFeedCardText.line), so a row titled by a bare name says nothing under it when its headline opens with the name. A headline that
// reports the searched person's own death titles the row "<name> death", somber, as the kinds desk's remembered rows are (lib/kinds-desk.js
// ownDeath: never a question, a rumour, a fear or a denial); otherwise the first headline that does not open with the title words it. When
// every headline opens with it, the line names its outlet first ("<outlet>: <headline>"), the reported words unchanged)
const PERSON_WORDS = [2, 3];
const opensWith = (line, title) => { const l = keyOf(line); const h = keyOf(title); return !!l && !!h && (l === h || l.startsWith(`${h} `) || h.startsWith(`${l} `)); };
function wordsOf(tr, heads) {
  const kw = keyOf(tr.keyword);
  const n = kw.split(' ').length;
  const usable = heads.filter((h) => h.title.length >= 12 && h.title.length <= LINE_MAX);
  if (PERSON_WORDS.includes(n)) {
    const KD = require('./kinds-desk');
    const deaths = usable.filter((h) => KD.ownDeath(h.title, kw) && nameDies(h.title, kw));
    if (deaths.length) return { head: deaths.find((h) => !opensWith(h.title, `${titleOf(tr.keyword, h.title)} death`)) || deaths[0], death: true };
  }
  const shown = usable.find((h) => !opensWith(h.title, titleOf(tr.keyword, h.title)));
  return { head: shown || heads[0] || null, death: false };
}
// (the death word after the name with no other capitalised word between them, or only an appositive between commas: "<name>, 52,
// dies" and "<name>, Chart-Topping Singer, Dies" are theirs; "<show> star <name> dies",
// "<name>'s co-star <other> dies" are not the search's own. Strict on purpose: a death it cannot place stays a bare-name row)
const DIES = /(?<![\p{L}\p{N}])(?:dies|died|dead|death|passes away|passed away)(?![\p{L}\p{N}])/iu;
const SMALL_SAID = /(?<![\p{L}\p{N}])(?:has|have|had|is|was|reportedly|suddenly|tragically|unexpectedly|peacefully|now|also)(?![\p{L}\p{N}])/giu;
function nameDies(title, kw) {
  const pat = new RegExp(`(?<![\\p{L}\\p{N}])${kw.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+')}(?![\\p{L}\\p{N}])`, 'iu');
  const plain = String(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const m = plain.match(pat);
  if (!m) return false;
  const rest = plain.slice(m.index + m[0].length);
  const d = rest.search(DIES);
  if (d < 0) return false;
  const between = rest.slice(0, d);
  if (/^['’]s\b/u.test(rest)) return false;
  // (an appositive between two commas describes the name: "<name>, Chart-Topping Singer, Dies at 69")
  if (/^\s*,[^,]{1,60},\s*(?:has\s+|have\s+|is\s+)?$/iu.test(between)) return true;
  // (a title-case headline's small words are no other name: "<name> Has Died", "<name> Reportedly Dies")
  return !/(?<![\p{L}\p{N}])\p{Lu}/u.test(between.replace(SMALL_SAID, ' '));
}
/** The extended row's line: its headline, or "<outlet>: <headline>" when the headline opens with the title (the phone would hide it). */
function stillLine(head, title) {
  const line = sentence(head.title);
  if (!opensWith(line, title) || !head.outlet) return line;
  const named = sentence(`${String(head.outlet).trim()}: ${head.title}`);
  return named.length <= LINE_MAX ? named : line;
}

/** The search as people typed it, each word as the headline prints it ("Quorra Bellwind pet passes away"), the first word capitalised. */
function titleOf(keyword, head) {
  const printed = new Map();
  for (const w of String(head || '').split(/\s+/)) {
    const bare = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/i, '');
    if (bare && !printed.has(bare.toLowerCase())) printed.set(bare.toLowerCase(), bare);
  }
  const out = String(keyword).trim().split(/\s+/).map((w) => printed.get(w.toLowerCase()) || w);
  return out.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

const heatOf = (tr) => Math.min(HEAT_MAX, Math.round(HEAT_BASE + HEAT_PER_DECADE * Math.log10(Math.max(1, tr.volume / 10000)) + (tr.end === null || tr.end === undefined ? HEAT_LIVE : 0)));
const sentence = (s) => (/[.!?]['’"”]?$/.test(s) ? s : `${s}.`);

/**
 * The audience's rows with the searches no row tells added after them, biggest search first, ROWS_MAX at most. ctx: { trends (the
 * store's Trends rows), resolved (Map(trend key -> Google's article)), news ([{ title, t (ms), outlet }]), lookups (the store's: whose
 * name was searched, and when), t (seconds), audience }. A row is keyed by its search's name, and like every row keyed by a name it says
 * no start until that name's own search has answered (lib/history.js `dated`, C4): until then it waits under the page.
 */
function add(rows, { trends = [], resolved = new Map(), news = [], lookups = new Map(), t, audience = 'US' }) {
  const geos = homeGeos(audience);
  const byKw = new Map();
  for (const tr of trends) {
    if (!inScope(tr, t, geos) || rows.some((r) => told(tr, r))) continue;
    const kw = keyOf(tr.keyword);
    const was = byKw.get(kw);
    if (!was || tr.volume > was.volume || (tr.volume === was.volume && tr.start > was.start)) byKw.set(kw, tr);
  }
  const rankFrom = 1 + rows.reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
  return [...rows, ...made(byKw, { resolved, news, lookups, t, audience, rankFrom, max: ROWS_MAX })];
}

/**
 * The rows of the searches in byKw (Map(keyword key -> Trends row)), biggest search first, max at most: each told by one reported
 * headline that names it (no headline, no row), a second search of one story told by the first's row.
 */
function made(byKw, { resolved, news, lookups, t, audience, rankFrom, max, extra = {} }) {
  const out = [];
  for (const tr of [...byKw.values()].sort((a, b) => b.volume - a.volume || b.start - a.start || a.keyword.localeCompare(b.keyword))) {
    if (out.length >= max) break;
    const still = extra.section === STILL_SECTION;
    const picked = still ? wordsOf(tr, headlinesOf(tr, { resolved, news, t })) : { head: headlineOf(tr, { resolved, news, t }), death: false };
    const head = picked.head;
    if (!head || head.title.length < 12 || head.title.length > LINE_MAX) continue;
    const kw = keyOf(tr.keyword);
    // (two searches of one story: the second is told by the first's row)
    if (out.some((m) => told(tr, m))) continue;
    const named = titleOf(tr.keyword, head.title);
    const title = picked.death ? `${named} death` : named;
    const noun = picked.death ? 'death' : null;
    const status = picked.death ? 'peaking' : 'rising';
    const line = still ? stillLine(head, title) : sentence(head.title);
    const heat = heatOf(tr);
    const search = { key: tr.key, geo: tr.geo, keyword: tr.keyword, volume: tr.volume, growth: tr.growth || 0, start: tr.start, end: tr.end ?? null, cats: [...(tr.cats || [])] };
    const own = [{ t: head.t, title: head.title, outlet: head.outlet, fam: 'gnews', url: head.url, k: 'outlet' }];
    const look = lookups.get(`talk-${TS.talkKey(kw)}`) || {};
    const newsAt = Math.max(look.tpnewsAt || 0, look.tprecentAt || 0) || null;
    const meta = { key: kw, subject: kw, surface: named, family: null, noun, from: 'search', own, outletsOwn: 1, outletsAll: 1, trends: [search], fresh: [], wiki: null, also: [],
      searched: newsAt !== null, newsAt, ytAt: look.tpytAt || null, timeline: { first: null, replies: [], chapter: null, latest: null } };
    const point = { title, kind: 'story', what: line, subject: named, noun, heat, status, sources: head.outlet ? [head.outlet] : [], tier: 'other', drama: false, from: 'search', meta,
      ...(picked.death ? { sensitive: true, sensitiveWhy: 'tragedy' } : {}) };
    out.push({ audience, engineRank: rankFrom + out.length, kind: 'talk', title, heat, engineStatus: status, drama: false, type: 'point', cardKey: `point:${named}`, point, word: null, moment: null,
      meta, wordish: false, line, subject: kw, surface: named, family: null, noun, tier: 'other', searchRow: true,
      natural: naturalKey({ kind: 'talk', subject: kw, family: null, noun, title }), heads: [keyOf(head.title)], ...extra });
  }
  return out;
}

// ---------- the extended mode: the extension's "Still searched" section (lib/extension.js, ios/IDEAS-FEED.md D3 as of 2026-10-31) ----------
// (each country's own Trends read, at its own floor: a search of 10K in the UK or 5K in Australia or Canada is that country's 20K)
const STILL_MIN = { US: 20000, GB: 10000, AU: 5000, CA: 5000 };
const STILL_ROWS_MAX = 30;
// (a search the last whole read of its country no longer carries is ended by lib/ingest.js; one whose country was not read lately is
// not known to be still searched)
const STILL_SEEN_HOURS = 6;
const STILL_SECTION = 'stillSearched';

/**
 * Whether a Trends row is still searched at `t` for an audience's countries: the scope of `inScope` at any age (a search begun a week
 * ago and still trending is still searched), at its own country's floor, while still trending or ended inside ENDED_HOURS.
 */
function stillInScope(tr, t, geos) {
  const start = tr.start / 1000;
  const end = tr.end === null || tr.end === undefined ? null : tr.end / 1000;
  const kw = keyOf(tr.keyword);
  if (!kw || !geos.includes(tr.geo) || !(tr.cats || []).some((c) => POP_CATEGORIES.has(c)) || !(tr.volume >= (STILL_MIN[tr.geo] || SEARCH_MIN))) return false;
  if (start > t || (end !== null && t - end > ENDED_HOURS * HOUR)) return false;
  if (end === null && Number.isFinite(tr.seen) && t - tr.seen / 1000 > STILL_SEEN_HOURS * HOUR) return false;
  if (kw.split(' ').length > TITLE_WORDS_MAX || FIXTURE.test(` ${tr.keyword} `) || SERVICE.test(tr.keyword) || TC.LEAGUE_KW.test(kw) || TN.QUESTION.test(tr.keyword)) return false;
  return true;
}

/**
 * The extension desk (lib/extension.js): the searches of the audience's own countries still searched that no row of its main list
 * tells, each a row of the section "stillSearched", STILL_ROWS_MAX at most, made as `add` makes its rows (a reported headline that
 * names it, or no row). ctx: { rows (the audience's main rows), trends, resolved, news, lookups, t, audience }.
 */
function extended({ rows = [], trends = [], resolved = new Map(), news = [], lookups = new Map(), t, audience = 'US' }) {
  const geos = homeGeos(audience);
  const byKw = new Map();
  for (const tr of trends) {
    if (!stillInScope(tr, t, geos) || rows.some((r) => told(tr, r))) continue;
    const kw = keyOf(tr.keyword);
    const was = byKw.get(kw);
    if (!was || tr.volume > was.volume || (tr.volume === was.volume && tr.start > was.start)) byKw.set(kw, tr);
  }
  const rankFrom = 1 + rows.reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
  return made(byKw, { resolved, news, lookups, t, audience, rankFrom, max: STILL_ROWS_MAX, extra: { section: STILL_SECTION } });
}

module.exports = { add, extended, inScope, stillInScope, told, headlineOf, headlinesOf, wordsOf, titleOf, heatOf, POP_CATEGORIES, SEARCH_MIN, FRESH_HOURS, ENDED_HOURS, ROWS_MAX, STILL_MIN, STILL_ROWS_MAX, STILL_SECTION };
