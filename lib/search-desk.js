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
function headlineOf(tr, { resolved = new Map(), news = [], t }) {
  const own = resolved.get(tr.key);
  if (own && own.title && Number.isFinite(own.t) && own.t / 1000 <= t + HOUR) return { title: plainHead(own), t: own.t, outlet: own.publisher || null, url: own.url || null };
  const need = words(tr.keyword).filter((w) => w.length >= 3 && !SMALL.has(w));
  if (!need.length) return null;
  const from = (tr.start / 1000 - NEWS_BACK_HOURS * HOUR) * 1000;
  const hits = news.filter((h) => h && h.title && Number.isFinite(h.t) && h.t >= from && h.t / 1000 <= t + HOUR && need.every((w) => has(keyOf(h.title), w)))
    .sort((a, b) => b.t - a.t);
  const h = hits[0];
  return h ? { title: plainHead(h), t: h.t, outlet: h.outlet || null, url: h.url || null } : null;
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
  const made = [];
  for (const tr of [...byKw.values()].sort((a, b) => b.volume - a.volume || b.start - a.start || a.keyword.localeCompare(b.keyword))) {
    if (made.length >= ROWS_MAX) break;
    const head = headlineOf(tr, { resolved, news, t });
    if (!head || head.title.length < 12 || head.title.length > LINE_MAX) continue;
    const kw = keyOf(tr.keyword);
    // (two searches of one story: the second is told by the first's row)
    if (made.some((m) => told(tr, m))) continue;
    const title = titleOf(tr.keyword, head.title);
    const line = sentence(head.title);
    const heat = heatOf(tr);
    const search = { key: tr.key, geo: tr.geo, keyword: tr.keyword, volume: tr.volume, growth: tr.growth || 0, start: tr.start, end: tr.end ?? null, cats: [...(tr.cats || [])] };
    const own = [{ t: head.t, title: head.title, outlet: head.outlet, fam: 'gnews', url: head.url, k: 'outlet' }];
    const look = lookups.get(`talk-${TS.talkKey(kw)}`) || {};
    const newsAt = Math.max(look.tpnewsAt || 0, look.tprecentAt || 0) || null;
    const meta = { key: kw, subject: kw, surface: title, family: null, noun: null, from: 'search', own, outletsOwn: 1, outletsAll: 1, trends: [search], fresh: [], wiki: null, also: [],
      searched: newsAt !== null, newsAt, ytAt: look.tpytAt || null, timeline: { first: null, replies: [], chapter: null, latest: null } };
    const point = { title, kind: 'story', what: line, subject: title, noun: null, heat, status: 'rising', sources: head.outlet ? [head.outlet] : [], tier: 'other', drama: false, from: 'search', meta };
    made.push({ audience, engineRank: rankFrom + made.length, kind: 'talk', title, heat, engineStatus: 'rising', drama: false, type: 'point', cardKey: `point:${title}`, point, word: null, moment: null,
      meta, wordish: false, line, subject: kw, surface: title, family: null, noun: null, tier: 'other', searchRow: true,
      natural: naturalKey({ kind: 'talk', subject: kw, family: null, noun: null, title }), heads: [keyOf(head.title)] });
  }
  return [...rows, ...made];
}

module.exports = { add, inScope, told, headlineOf, titleOf, heatOf, POP_CATEGORIES, SEARCH_MIN, FRESH_HOURS, ENDED_HOURS, ROWS_MAX };
