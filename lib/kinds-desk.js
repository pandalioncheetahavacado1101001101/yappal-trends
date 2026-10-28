'use strict';
/*
 * The kinds the list holds and never builds a row for (ios/.review/learn/2026-10-30-5x-plan.md, wave 9 "kinds-gap"): an extension
 * desk, `rows(ctx)`, whose rows each carry a `section` and their clock (`extUntil`, the extension's budget) and are laid out only past
 * the list's main rows (ranks 81 and on): collect.js registers `rows` with the extension (lib/extension.js candidates, measure, extend),
 * so the main rows never see them and ranks 1-80 are the same with or without this desk. (`apart` and `asCalendar` are kept for a
 * caller that hands the rows to the main layout.) With IDEAS_EXTENSION=0 the desk reads nothing and makes no row.
 *
 *   remembered  a death people are reading about: a name on Wikipedia's deaths page (lib/sources/deaths-page.js, a confirming voice
 *               only), worded by an outlet's report of it (a headline the collector read, else the report the page cites), with
 *               people looking it up (Google Trends' entries, Wikipedia's daily top lists, or two outlets of the collector's own).
 *               Somber: noun "death", never drama, never lifted. Clock: 72 h from the day of death.
 *   rightNow    a service down: an incident on the service's own status page (lib/sources/statuspage.js), read only once a search or
 *               a headline of the last hours says it is down, worded as the service said it. Clock: 6 h from its newest update.
 *   tonight     a person in the news from last night's TV: a show the calendar says aired (lib/release-desk.js's TVmaze schedule,
 *               read only), a Google Trends entry for a person tied to it, and a headline that names both. Clock: 36 h from the air time.
 *   games       a game launching or climbing on the Steam store's top sellers (lib/sources/steam-store.js), as the store says it.
 *               Clock: 3 days before its day to 7 days after, or while it climbs.
 *
 * Nothing here is drama or Early, claims a start, asks a name search or keys a row by a name (the release desk's rule: a row keyed by a
 * name has that name searched again). Reported wording only: a death or an outage is told in the words of the one who reported it,
 * and a row is made only when such words exist. A thing a row of the list already tells gets no row here (`told`).
 *
 * Off (each read its own): IDEAS_KINDS_OFF=deaths,outages,games,tonight (or "all"); IDEAS_SOURCES_OFF=kinds turns off every read and
 * row. Requests: at most PER_CYCLE a cycle (deaths 1 an hour, the store's lists 1 an hour and one game's facts when a new one sells,
 * a status feed only when a service is said to be down).
 */
const fs = require('node:fs');
const path = require('node:path');
const DP = require('./sources/deaths-page');
const SP = require('./sources/statuspage');
const SS = require('./sources/steam-store');
const RDESK = require('./release-desk');
const TN = require('../engine/talk-nouns');
const { naturalKey } = require('./identity');
const { OUTLET_BY_DOMAIN } = require('./outlets');
const { keyOf, localDay, zonedTime, HOUR, DAY } = require('./util');

const ZONE = 'America/New_York';
const PER_CYCLE = 4;
// (the deaths page's Wikimedia request is kept back from the rounds, as the film page's is: the rounds fill the group's cap, and without
// it the page is never read. The cost: in the hour's cycle one dictionary lookup waits a cycle. false: the page takes what the rounds leave)
// (false since the wave-9 merge: holding it moved rows 1-80 on 15 of 35 replayed lists; the page is read once the group's cap has room)
const HOLD_WIKIMEDIA = false;
const RETRY_SECONDS = HOUR;
const SECTIONS = ['remembered', 'rightNow', 'tonight', 'games'];
const SWITCHES = { remembered: 'deaths', rightNow: 'outages', tonight: 'tonight', games: 'games' };
const SECTION_MAX = { remembered: 6, rightNow: 4, tonight: 6, games: 5 };
const TITLE_MAX = 80;
// (the list's main rows: lib/feed.js ROWS_MAX before the extension; a section row is never among them)
const MAIN_ROWS = 80;
const LINE_MAX = 200;
const HEAT_BASE = 24;
const HEAT_MAX = 36;
// remembered
const DEATH_HOURS = 72;
const DEATH_VIEWS_MIN = 10000;
const DEATH_OUTLETS_MIN = 2;
// rightNow
const OUTAGE_HOURS = 6;
const OUTAGE_SAID_HOURS = 3;
const STATUS_AGAIN_SECONDS = 30 * 60;
const STATUS_PER_CYCLE = 2;
// tonight
const TV_HOURS = 36;
const TV_BEFORE_HOURS = 2;
// games
const LAUNCH_BEFORE_DAYS = 3;
const LAUNCH_AFTER_DAYS = 7;
const CLIMB_HOURS = 3;
const CLIMB_PLACES = 2;
const CLIMB_NEW_DAYS = 7;
const STEAM_HISTORY = 12;
const APPS_KEPT = 200;
const APPS_PER_CYCLE = 2;
const AUDIENCE_GEOS = { US: ['US'], GB: ['GB'], AU: ['AU'], CA: ['CA', 'US'], mixed: ['US', 'GB', 'AU', 'CA'] };
const US_TV = new Set(['US', 'CA', 'mixed']);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// (a service said to be down: in a search or a headline, the word within a few words of the service's name)
const DOWN = /\b(?:down|outage|outages|not working|isn t working|went down|goes down|server status|servers? down|crash(?:ed|es|ing)?|offline)\b/;
// (what a death row's tier is, from the page's own words for the person)
const CREATOR_WORDS = /\b(?:youtuber|streamer|influencer|tiktoker|content creator|podcaster|internet personality|vlogger|twitch)\b/i;
const STAR_WORDS = /\b(?:actor|actress|singer|musician|rapper|songwriter|comedian|presenter|television|tv|film|reality|model|dancer|drummer|guitarist|bassist|composer|voice|host|producer|director|record)\b/i;
const SPORT_WORDS = /\b(?:footballer|basketball|baseball|football|soccer|cricketer|boxer|wrestler|golfer|tennis|hockey|athlete|racing|driver|coach|olympic|swimmer|cyclist|jockey)\b/i;
// (whose a death is, for an audience that reads about it only in the daily top lists: the page's own word for the person's country)
const NATIONS = { US: /^(?:\S+-born )?American\b/, GB: /^(?:\S+-born )?(?:British|English|Scottish|Welsh|Northern Irish)\b/, AU: /^(?:\S+-born )?Australian\b/,
  CA: /^(?:\S+-born )?(?:Canadian|American)\b/, mixed: /^(?:\S+-born )?(?:American|British|English|Scottish|Welsh|Northern Irish|Australian|Canadian)\b/ };
// (an age a report gives: "dies at 81", "dead at 81", "aged 81", ", 81,"; one that is not the page's is another person's report)
const AGE_SAID = /\b(?:at|aged)\s+(\d{1,3})\b|,\s*(\d{1,3}),/i;
// (a role's death is no person's: "<name>'s character dies in the finale", "<show> kills off <name>")
const FICTION = /\b(?:character|characters|killed off|kills off|kill off|on screen|onscreen|finale|episode|storyline|plot|spoilers?)\b/;
// (a death only asked about, feared, rumoured, unconfirmed or denied is no report of one: "Is <name> dead?", "<name> dead? Rumours
// spread ...", "Fans fear <name> has died", "<name> reportedly dies at 52, unconfirmed", "<name> is alive", "false reports")
const DEATH_UNSURE = /\b(?:hoax\w*|rumou?r\w*|fears?|feared|unconfirmed|unverified|alive|not dead|false|fake[sd]?|speculation)\b/i;
// (the page's own citation alone words a row only once the entry held across two hourly reads, and only from a work or a known outlet)
const CITED_HELD_SECONDS = HOUR;
const POLITICS_WORDS = /\b(?:politician|senator|governor|minister|mp|mla|mha|congressman|congresswoman|mayor|diplomat|judge|jurist|president|prime minister|official)\b/i;

const emptyCache = () => ({ deaths: {}, status: {}, steam: null });
const cacheOf = (cache) => ({ ...emptyCache(), ...(cache && typeof cache === 'object' ? cache : {}) });
const fresh = (entry, every, nowS) => !!entry && Number.isFinite(entry.at) && nowS - entry.at < every;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY * 1000).toISOString().slice(0, 10);
const dayWords = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const cut = (s, max) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`; };
// (a store name in capitals is written as a name: "ASHEN LANTERN RISING" -> "Ashen Lantern Rising"; a short word stays, it may be one's letters)
const quiet = (s) => (/\p{Ll}/u.test(s) ? s : s.replace(/\p{Lu}{4,}/gu, (w) => w[0] + w.slice(1).toLowerCase()));
const has = (hay, name) => !!name && ` ${hay} `.includes(` ${name} `);

// ---------- switches ----------
/** The sections switched off: IDEAS_KINDS_OFF names reads ("deaths", "outages", "games", "tonight", or "all"); IDEAS_SOURCES_OFF "kinds" is all. */
function offOf(env = {}) {
  const named = new Set(String(env.IDEAS_KINDS_OFF || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const all = named.has('all') || named.has('1') || String(env.IDEAS_SOURCES_OFF || '').split(',').map((x) => x.trim()).includes('kinds');
  return new Set(SECTIONS.filter((s) => all || named.has(SWITCHES[s])));
}

// ---------- what is said now (the voices that ask a status page, and that list a death or a TV night) ----------
// (one reading of the store's headlines and searches a cycle, whatever the audiences and sections ask of it: the same arrays come back)
const READ = new WeakMap();
const once = (list, tag, make) => {
  if (!list || typeof list !== 'object') return make();
  const memo = READ.get(list) || new Map();
  READ.set(list, memo);
  if (!memo.has(tag)) memo.set(tag, make());
  return memo.get(tag);
};
/** Store headlines as [{ title, key (keyed title), at (s), outlet }] of the last `hours` before t. items: [{ title, t (ms), publisher | label }]. */
const headlinesOf = (items, t, hours) => once(items, `h|${t}|${hours}`, () => headlinesRead(items, t, hours));
function headlinesRead(items, t, hours) {
  const out = [];
  for (const it of items || []) {
    if (!it || typeof it.title !== 'string' || !Number.isFinite(it.t)) continue;
    const at = Math.floor(it.t / 1000);
    if (at > t + 900 || t - at > hours * HOUR) continue;
    out.push({ title: it.title, key: keyOf(it.title), at, outlet: it.publisher || it.label || null });
  }
  return out;
}
/** Google Trends entries as [{ geo, key, related (keyed), start (s), end, volume, cats }] begun inside `hours` before t, still going or ended in the last one. */
const trendsOf = (trends, t, hours, geos = null) => once(trends, `t|${t}|${hours}|${geos ? geos.join(',') : ''}`, () => trendsRead(trends, t, hours, geos));
function trendsRead(trends, t, hours, geos) {
  const out = [];
  for (const tr of trends || []) {
    if (!tr || typeof tr.keyword !== 'string' || !Number.isFinite(tr.start)) continue;
    const start = Math.floor(tr.start / 1000);
    const end = Number.isFinite(tr.end) ? Math.floor(tr.end / 1000) : null;
    if (start > t + 900 || t - start > hours * HOUR || (end !== null && t - end > HOUR)) continue;
    if (geos && !geos.includes(tr.geo)) continue;
    out.push({ geo: tr.geo, key: keyOf(tr.keyword), related: (tr.related || []).map(keyOf).filter(Boolean), start, end, volume: tr.volume || 0, cats: tr.cats || [] });
  }
  return out;
}
const saysDown = (text, alias) => {
  const at = ` ${text} `.indexOf(` ${alias} `);
  if (at < 0) return false;
  const near = ` ${text} `.slice(Math.max(0, at - 12), at + alias.length + 34);
  return DOWN.test(near);
};
/**
 * The services said to be down in the last OUTAGE_SAID_HOURS (for asking) or OUTAGE_HOURS (for a row): Map(id -> [{ kind, at }]),
 * from a Google Trends entry or a store headline that names the service and says it is down.
 */
function saidDown({ trends = [], items = [], t, hours = OUTAGE_SAID_HOURS }) {
  const out = new Map();
  const add = (id, v) => out.set(id, [...(out.get(id) || []), v]);
  const ts = trendsOf(trends, t, hours);
  const hs = headlinesOf(items, t, hours);
  for (const s of SP.SERVICES) {
    for (const alias of s.aliases) {
      for (const tr of ts) if ([tr.key, ...tr.related].some((x) => saysDown(x, alias))) add(s.id, { kind: 'search', at: tr.start, volume: tr.volume });
      for (const h of hs) if (saysDown(h.key, alias)) add(s.id, { kind: 'headline', at: h.at, outlet: h.outlet });
    }
  }
  return out;
}

// ---------- asking ----------
/** The requests due now, PER_CYCLE at most: a status feed a service is said to be down for, the deaths page, the store's lists, one game's facts. */
function due(cache0, nowS, { off = new Set(), trends = [], items = [] } = {}) {
  const cache = cacheOf(cache0);
  const out = [];
  if (!off.has('rightNow')) {
    const said = saidDown({ trends, items, t: nowS });
    for (const id of [...said.keys()].slice(0, STATUS_PER_CYCLE)) if (!fresh(cache.status[id], STATUS_AGAIN_SECONDS, nowS)) out.push(SP.statusRequest(id));
  }
  if (!off.has('remembered')) {
    const page = DP.titlesAt(nowS).find((p) => !fresh(cache.deaths[p.title], p.every, nowS));
    if (page) out.push(DP.pageRequest(page.title));
  }
  if (!off.has('games')) {
    if (!fresh(cache.steam, SS.EVERY, nowS)) out.push(SS.featuredRequest());
    const apps = (cache.steam && cache.steam.apps) || {};
    for (const g of ((cache.steam && cache.steam.top) || []).filter((x) => !apps[x.id]).slice(0, APPS_PER_CYCLE)) out.push(SS.appRequest(g.id));
  }
  return out.filter(Boolean).slice(0, PER_CYCLE);
}

/** In a replay, only what the recording holds (a day recorded before this desk is replayed as it was). */
function recordedOnly(requests, folder) {
  if (!folder) return requests;
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); } catch { manifest = {}; }
  return requests.filter((r) => manifest[r.id]);
}

/** The Wikimedia requests to keep back from the cycle's rounds for the deaths page: 1 when this cycle asks it, else 0 (a replay: when recorded). */
function wikiHold(cache0, nowS, { off = new Set(), folder = null } = {}) {
  if (off.has('remembered') || !HOLD_WIKIMEDIA) return 0;
  const cache = cacheOf(cache0);
  const page = DP.titlesAt(nowS).find((p) => !fresh(cache.deaths[p.title], p.every, nowS));
  if (!page) return 0;
  return (folder ? recordedOnly([DP.pageRequest(page.title)], folder) : [1]).length;
}

/** The cache with the replies read in ([{ request, status, text }]); never changes the cache handed in. A failure is asked again after RETRY_SECONDS. */
function read(cache0, results, nowS) {
  const cache = cacheOf(cache0);
  const deaths = { ...cache.deaths };
  const status = { ...cache.status };
  let steam = cache.steam ? { ...cache.steam } : null;
  let n = 0;
  for (const r of results || []) {
    if (!r || !r.request) continue;
    const { kind, args = {} } = r.request;
    const ok = r.status === 200;
    if (kind === 'kinds-deaths') {
      const page = ok ? DP.parse(r.text, args.title) : null;
      const was = deaths[args.title] || null;
      if (page) {
        // (when each name was first seen on the page: a confirming voice's own time)
        const seen = { ...((was && was.seen) || {}) };
        for (const e of page.entries) if (!Number.isFinite(seen[e.article])) seen[e.article] = nowS;
        const keep = new Set(page.entries.map((e) => e.article));
        deaths[args.title] = { at: nowS, revid: page.revid, revAt: page.at, entries: page.entries, seen: Object.fromEntries(Object.entries(seen).filter(([a]) => keep.has(a))) };
        n += 1;
      } else deaths[args.title] = { ...(was || { entries: [], seen: {} }), at: nowS - DP.EVERY + RETRY_SECONDS };
    }
    if (kind === 'kinds-status') {
      const incidents = ok ? SP.parse(r.text) : null;
      if (incidents) { status[args.service] = { at: nowS, incidents }; n += 1; } else status[args.service] = { ...(status[args.service] || { incidents: [] }), at: nowS - STATUS_AGAIN_SECONDS + RETRY_SECONDS / 4 };
    }
    if (kind === 'kinds-steam-featured') {
      const f = ok ? SS.parseFeatured(r.text) : null;
      const was = steam || { top: [], soon: [], fresh: [], firstTop: {}, history: [], apps: {} };
      if (f) {
        const firstTop = { ...(was.firstTop || {}) };
        for (const g of f.top) if (!Number.isFinite(firstTop[g.id])) firstTop[g.id] = nowS;
        const history = [...(was.history || []), { at: nowS, ranks: Object.fromEntries(f.top.map((g) => [g.id, g.rank])) }].slice(-STEAM_HISTORY);
        const seenIds = new Set(history.flatMap((h) => Object.keys(h.ranks)));
        steam = { ...was, at: nowS, top: f.top, soon: f.soon, fresh: f.fresh, firstTop: Object.fromEntries(Object.entries(firstTop).filter(([id, at]) => seenIds.has(id) || nowS - at < 30 * DAY)), history };
        n += 1;
      } else steam = { ...was, at: nowS - SS.EVERY + RETRY_SECONDS };
    }
    if (kind === 'kinds-steam-app') {
      const app = ok ? SS.parseApp(r.text, args.id) : null;
      const was = steam || { top: [], soon: [], fresh: [], firstTop: {}, history: [], apps: {}, at: null };
      // (an app the store does not answer for is kept as unknown, so it is not asked every cycle)
      const facts = app || { id: args.id, type: null, name: null, day: null, soon: false, free: false };
      const apps = Object.fromEntries(Object.entries({ ...(was.apps || {}), [args.id]: { ...facts, at: nowS } }).sort((a, b) => b[1].at - a[1].at).slice(0, APPS_KEPT));
      steam = { ...was, apps };
      if (app) n += 1;
    }
  }
  return { cache: { deaths, status, steam }, read: n };
}

/** One cycle's asking: { cache, results, read }. send(requests) -> results, as lib/fetch.js sends; a failure costs the read's freshness and nothing else. */
async function step({ cache, nowS, send, off = new Set(), trends = [], items = [] }) {
  const requests = due(cache, nowS, { off, trends, items });
  if (!requests.length) return { cache: cacheOf(cache), results: [], read: 0 };
  const results = await send(requests);
  const out = read(cache, results, nowS);
  return { cache: out.cache, results, read: out.read };
}

// ---------- the rows ----------
/** Whether a row of the list already tells the thing named `name` (keyed): the release desk's rule, over every row that is not this desk's. */
const toldBy = (name, rows) => (rows || []).some((r) => r && !r.kindsRow && (RDESK.told(name, r) || keyOf(r.subject || '') === name));
const heatOf = (weight) => Math.min(HEAT_MAX, HEAT_BASE + Math.max(0, Math.round(weight)));

/** A row as the release desk makes one (lib/release-desk.js add): talk, one point, no key, no start, past the main rows by `section`. */
function rowOf({ audience, rank, section, kind, title, line, name, surface, noun = null, tier = 'other', heat, sources, at, until, sensitive = null, status = 'rising' }) {
  const subject = keyOf(name);
  const meta = { key: null, subject, surface, family: null, noun, from: 'kinds', own: [], outletsOwn: 0, outletsAll: 0, trends: [], fresh: [], wiki: null, also: [], searched: false, newsAt: null, ytAt: null,
    timeline: { first: null, replies: [], chapter: null, latest: null }, kinds: { section, kind, at, until } };
  const point = { title, kind, what: line, subject: surface, noun, heat, status, sources, tier, drama: false, from: 'kinds', meta, ...(sensitive ? { sensitive: true, sensitiveWhy: sensitive } : {}) };
  return { audience, engineRank: rank, kind: 'talk', title, heat, engineStatus: status, drama: false, type: 'point', cardKey: `point:${surface}`, point, word: null, moment: null, meta, wordish: false,
    line, subject, surface, family: null, noun, tier, kindsRow: true, section, extUntil: until, natural: naturalKey({ kind: 'talk', subject, family: null, noun, title }), heads: [] };
}

/** A death row's tier, from the page's own words for the person. */
function tierOf(desc) {
  const d = String(desc || '');
  if (CREATOR_WORDS.test(d)) return 'creator';
  if (POLITICS_WORDS.test(d)) return 'politics';
  if (SPORT_WORDS.test(d) && !STAR_WORDS.test(d)) return 'sports';
  if (STAR_WORDS.test(d)) return 'celebrity';
  return 'other';
}
/** Whether a headline tells the person's own death (keyed name), in the engine's own reading: "<name> dies at 80", "Star of <show>, <name>, dead". */
function ownDeath(title, name, age = null) {
  const fam = TN.FAMILY.get('death');
  const key = keyOf(title);
  if (!fam || !has(key, name) || FICTION.test(key)) return false;
  if (/[?]/.test(String(title)) || TN.QUESTION.test(String(title).trim()) || DEATH_UNSURE.test(String(title))) return false;
  const said = String(title).match(AGE_SAID);
  const n = said ? Number(said[1] || said[2]) : null;
  if (Number.isFinite(age) && Number.isFinite(n) && n >= 10 && Math.abs(n - age) > 1) return false;
  const who = TN.whoseDeath(name, fam, [title]);
  return who.own >= 1 && who.others === 0;
}
/** Whether the page's citation may word a row alone: a title, the entry held across two hourly reads, and a named work or an outlet the list knows. */
function citedOk(e, seenAt, t) {
  if (!e.ref || !e.ref.title || !Number.isFinite(seenAt) || seenAt > t - CITED_HELD_SECONDS) return false;
  return !!(e.ref.work && String(e.ref.work).trim()) || !!OUTLET_BY_DOMAIN[String(e.ref.host || '').toLowerCase().replace(/^www\./, '')];
}
/** The audience's deaths: [{ entry, report: { title, outlet }, views, searched, outlets, at, until }], most read first. */
function deathsAt(cache, { t, audience, items, trends, wikiLists }) {
  const buzz = RDESK.buzzOf(wikiLists, t);
  const heads = headlinesOf(items, t, DEATH_HOURS);
  const ts = trendsOf(trends, t, DEATH_HOURS, AUDIENCE_GEOS[audience] || null);
  const from = new Date((t - DEATH_HOURS * HOUR) * 1000).toISOString().slice(0, 10);
  const seen = new Set();
  const out = [];
  for (const page of Object.values(cache.deaths || {})) {
    for (const e of page.entries || []) {
      const name = keyOf(e.name);
      if (!name || name.split(' ').length < 2 || seen.has(name) || e.day < from) continue;
      const seenAt = (page.seen || {})[e.article];
      // (a name the page held only after this instant is not known yet: a replay or a late read)
      if (Number.isFinite(seenAt) && seenAt > t) continue;
      const own = heads.filter((h) => has(h.key, name) && ownDeath(h.title, name, e.age));
      const outlets = new Set(own.map((h) => h.outlet || h.key));
      const views = Math.max(buzz.any.get(keyOf(String(e.article).replace(/\([^)]*\)/g, ' '))) || 0, buzz.any.get(name) || 0);
      const searched = ts.filter((tr) => tr.key === name || tr.key.startsWith(`${name} `) || tr.related.includes(name)).reduce((m, tr) => Math.max(m, tr.volume || 1), 0);
      // (people looking it up: a search of the audience's own countries, two outlets the collector reads, or the top lists for a person of
      // the audience's own countries: the top lists are the world's)
      const home = (NATIONS[audience] || NATIONS.mixed).test(e.desc || '');
      if (!((views >= DEATH_VIEWS_MIN && home) || searched > 0 || outlets.size >= DEATH_OUTLETS_MIN)) continue;
      // (the words: the newest of the collector's own headlines that tells it, else the report the page cites, when it tells it in English)
      const mine = own.sort((a, b) => b.at - a.at)[0];
      const cited = !mine && citedOk(e, seenAt, t) && ownDeath(e.ref.title, name, e.age) ? { title: e.ref.title, outlet: e.ref.work || OUTLET_BY_DOMAIN[e.ref.host] } : null;
      const report = mine ? { title: TN.cleanHeadline(mine.title, mine.outlet), outlet: mine.outlet } : cited;
      if (!report || !report.title) continue;
      seen.add(name);
      out.push({ entry: e, name, report, views, searched, outlets: outlets.size, at: zonedTime(e.day, 'UTC', 0, 0), until: zonedTime(e.day, 'UTC', 0, 0) + DAY + DEATH_HOURS * HOUR });
    }
  }
  return out.filter((d) => t < d.until).sort((a, b) => (b.searched + b.views) - (a.searched + a.views) || b.entry.day.localeCompare(a.entry.day) || a.name.localeCompare(b.name));
}

/** The audience's outages: [{ service, incident, latest, voices, at, until }], the newest first. */
function outagesAt(cache, { t, items, trends }) {
  const said = saidDown({ trends, items, t, hours: OUTAGE_HOURS });
  const out = [];
  for (const [id, voices] of said) {
    const s = SP.byId.get(id);
    const held = (cache.status || {})[id];
    if (!s || !held) continue;
    for (const inc of held.incidents || []) {
      const ups = (inc.updates || []).filter((u) => Number.isFinite(u.at) && u.at <= t + 900);
      if (!ups.length) continue;
      const latest = ups[0];
      const first = ups[ups.length - 1];
      if (t - latest.at > OUTAGE_HOURS * HOUR) continue;
      // (a voice of the same hours: a search or a headline from two hours before the incident's first word on)
      if (!voices.some((v) => v.at >= first.at - 2 * HOUR)) continue;
      out.push({ service: s, incident: inc, latest, first, voices, at: first.at, until: latest.at + OUTAGE_HOURS * HOUR });
      break;
    }
  }
  return out.sort((a, b) => b.latest.at - a.latest.at);
}

/** A show's names a headline may use: its own, and its initials ("Ballroom of Lights Live", "BOLL"). */
function showNames(show) {
  const k = keyOf(show);
  const ws = k.split(' ').filter(Boolean);
  const initials = ws.length >= 3 ? ws.map((w) => w[0]).join('') : null;
  return [k, ...(initials && initials.length >= 3 ? [initials] : [])];
}
/** The shows the calendar says aired in the last TV_HOURS: [{ show, names, at }]. releases: the release desk's cache. */
function airedAt(releases, t) {
  const out = new Map();
  for (const entry of Object.values((releases && releases.tv) || {})) {
    for (const it of entry.items || []) {
      const at = !it.web && Number.isFinite(it.at) ? it.at : zonedTime(it.day, ZONE, 20, 0);
      if (!Number.isFinite(at) || at > t || t - at > TV_HOURS * HOUR) continue;
      const k = keyOf(it.show);
      if (!k || (out.has(k) && out.get(k).at >= at)) continue;
      out.set(k, { show: it.show, names: showNames(it.show), at, web: !!it.web });
    }
  }
  return [...out.values()];
}
/** The name as a headline prints it (its casing), or null when the headline does not print it. */
function casedIn(title, name) {
  const ws = name.split(' ');
  const pat = new RegExp(`(?<![\\p{L}\\p{N}])${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+')}(?![\\p{L}\\p{N}])`, 'iu');
  const m = String(title).normalize('NFD').replace(/[̀-ͯ]/g, '').match(pat);
  return m && /\p{Lu}/u.test(m[0]) ? m[0] : null;
}
/** The audience's TV-night people: [{ name, surface, show, report, volume, at, until }], most searched first. */
function tonightAt(releases, { t, audience, items, trends }) {
  const shows = airedAt(releases, t).filter((s) => s.web || US_TV.has(audience));
  if (!shows.length) return [];
  const heads = headlinesOf(items, t, TV_HOURS);
  const out = [];
  const seen = new Set();
  for (const tr of trendsOf(trends, t, TV_HOURS, AUDIENCE_GEOS[audience] || null)) {
    const words = tr.key.split(' ');
    if (words.length < 2 || words.length > 3 || TN.QUESTION.test(tr.key) || seen.has(tr.key) || !TN.personLike(tr.key, null)) continue;
    const show = shows.find((s) => s.at - TV_BEFORE_HOURS * HOUR <= tr.start && s.names.some((n) => tr.related.some((q) => has(q, n)) && !has(n, tr.key)));
    if (!show) continue;
    // (the words: a headline of those hours that names the person and the show)
    const head = heads.filter((h) => h.at >= show.at - TV_BEFORE_HOURS * HOUR && has(h.key, tr.key) && show.names.some((n) => has(h.key, n))).sort((a, b) => b.at - a.at)[0];
    const surface = head ? casedIn(head.title, tr.key) : null;
    if (!head || !surface) continue;
    seen.add(tr.key);
    out.push({ name: tr.key, surface, show: show.show, report: { title: TN.cleanHeadline(head.title, head.outlet), outlet: head.outlet }, volume: tr.volume, at: show.at, until: show.at + TV_HOURS * HOUR });
  }
  return out.sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name));
}

/** The games: [{ game, rank, how ('soon' | 'out' | 'climbing'), day, from }], the best sellers first. */
function gamesAt(cache, { t }) {
  const st = cache.steam;
  if (!st || !Number.isFinite(st.at) || t - st.at > 3 * SS.EVERY || st.at > t + 900) return [];
  const today = localDay(t, ZONE);
  const back = (st.history || []).filter((h) => h.at <= t - CLIMB_HOURS * HOUR).slice(-1)[0] || null;
  const out = [];
  for (const g of st.top || []) {
    const app = (st.apps || {})[g.id];
    if (!app || app.type !== 'game') continue;
    if (app.day && app.day >= addDays(today, -LAUNCH_AFTER_DAYS) && app.day <= addDays(today, LAUNCH_BEFORE_DAYS)) {
      out.push({ game: app.name || g.name, id: g.id, rank: g.rank, how: app.day > today ? 'soon' : 'out', day: app.day, until: zonedTime(addDays(app.day, LAUNCH_AFTER_DAYS + 1), ZONE, 0, 0) });
      continue;
    }
    const was = back ? back.ranks[g.id] : undefined;
    const first = (st.firstTop || {})[g.id];
    const young = !app.day || app.day >= addDays(today, -CLIMB_NEW_DAYS) || (Number.isFinite(first) && t - first < CLIMB_NEW_DAYS * DAY && (st.history || []).length >= STEAM_HISTORY);
    if (Number.isFinite(was) && was - g.rank >= CLIMB_PLACES && young) out.push({ game: app.name || g.name, id: g.id, rank: g.rank, how: 'climbing', from: was, day: app.day, until: t + SS.EVERY });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/**
 * The desk's rows for one audience, each with its `section`, SECTION_MAX a section, nothing a row of `rows` already tells.
 * ctx: { cache (this desk's, as `step` keeps it), t (seconds), audience, rows (the audience's rows as made: what is told), items (the
 * store's headlines: [{ title, t (ms), publisher }]), trends (the store's Google Trends entries), wikiLists (the daily top lists),
 * releases (the release desk's calendar), off (sections switched off: `offOf`), rankFrom }.
 */
function rows(ctx) {
  const { t, audience = 'US', items = [], trends = [], wikiLists = null, releases = null, off = new Set() } = ctx;
  const cache = cacheOf(ctx.cache);
  const listed = ctx.rows || [];
  let rank = Number.isFinite(ctx.rankFrom) ? ctx.rankFrom : 1 + listed.reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
  const made = [];
  const named = new Set();
  const take = (name) => { if (!name || named.has(name) || toldBy(name, listed)) return false; named.add(name); return true; };
  const push = (spec) => { made.push(rowOf({ audience, rank, ...spec })); rank += 1; };
  if (!off.has('remembered')) {
    let n = 0;
    for (const d of deathsAt(cache, { t, audience, items, trends, wikiLists })) {
      if (n >= SECTION_MAX.remembered) break;
      if (!take(d.name)) continue;
      const title = `${d.entry.name} death`;
      const line = cut(d.report.title, LINE_MAX);
      if (title.length > TITLE_MAX) continue;
      push({ section: 'remembered', kind: 'death', title, line, name: d.entry.name, surface: d.entry.name, noun: 'death', tier: tierOf(d.entry.desc), heat: heatOf(3 * Math.log10(1 + (d.views + d.searched) / 1000)),
        sources: [d.report.outlet, 'Wikipedia'].filter(Boolean), at: d.at, until: d.until, sensitive: 'tragedy', status: 'peaking' });
      n += 1;
    }
  }
  if (!off.has('rightNow')) {
    let n = 0;
    for (const o of outagesAt(cache, { t, items, trends })) {
      if (n >= SECTION_MAX.rightNow) break;
      if (!take(keyOf(o.service.name)) || toldBy(keyOf(`${o.service.name} outage`), listed)) continue;
      const resolved = o.latest.status === 'resolved' || o.latest.status === 'postmortem';
      const when = clockWords(o.latest.at);
      const quoted = `“${cut(o.incident.title, 110)}”`;
      const line = resolved ? `${o.service.name}'s status page says ${quoted} was resolved at ${when}.` : `${o.service.name}'s status page: ${quoted} (${o.latest.status}, ${when}).`;
      push({ section: 'rightNow', kind: 'outage', title: `${o.service.name} outage`, line: cut(line, LINE_MAX), name: o.service.name, surface: o.service.name, heat: heatOf(o.voices.length),
        sources: [`${o.service.name} status`], at: o.at, until: o.until, status: resolved ? 'fading' : 'rising' });
      n += 1;
    }
  }
  if (!off.has('tonight')) {
    let n = 0;
    for (const p of tonightAt(releases, { t, audience, items, trends })) {
      if (n >= SECTION_MAX.tonight) break;
      if (!take(p.name)) continue;
      const title = `${p.surface}, ${p.show}`;
      if (title.length > TITLE_MAX) continue;
      push({ section: 'tonight', kind: 'tv', title, line: cut(p.report.title, LINE_MAX), name: p.surface, surface: p.surface, tier: 'celebrity', heat: heatOf(3 * Math.log10(1 + p.volume / 1000)),
        sources: [p.report.outlet, 'TVmaze'].filter(Boolean), at: p.at, until: p.until });
      n += 1;
    }
  }
  if (!off.has('games')) {
    let n = 0;
    for (const g of gamesAt(cache, { t })) {
      if (n >= SECTION_MAX.games) break;
      if (!take(keyOf(g.game))) continue;
      const name = quiet(g.game);
      // (the line never opens with the title: the phone hides a line that does, ios Core IdeasFeedCardText.line)
      const line = g.how === 'soon' ? `Comes out on Steam on ${dayWords(g.day)}; already No. ${g.rank} on Steam's top sellers.`
        : g.how === 'out' ? `Came out on Steam on ${dayWords(g.day)}; No. ${g.rank} on Steam's top sellers.`
          : `Climbed to No. ${g.rank} on Steam's top sellers, up from No. ${g.from}.`;
      push({ section: 'games', kind: 'game', title: cut(quiet(g.game), TITLE_MAX), line: cut(line, LINE_MAX), name: g.game, surface: g.game, heat: heatOf(12 - g.rank), sources: ['Steam'], at: g.day ? zonedTime(g.day, ZONE, 0, 0) : t,
        until: g.until });
      n += 1;
    }
  }
  return made;
}
function clockWords(at) {
  const [hh, mm] = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at * 1000)).split(':').map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'a.m.' : 'p.m.'} ET`;
}

/** The audience's rows with the desk's added after them (made against every row the audience has, so a told thing gets none). */
function add(rowsIn, ctx) {
  return [...rowsIn, ...rows({ ...ctx, rows: [...rowsIn, ...(ctx.others || [])] })];
}

/**
 * A layout that never sees the desk's rows: `layout` orders the rest exactly as it would without them, and the desk's follow, by
 * section, so the main rows' ranks are the same with or without this desk. Only past `keep` main rows (the list's main 80, IDEAS-FEED
 * D3: a section row is never inside them): a shorter main list carries none. (The extension's `extend()` lays the sections out past
 * the main rows; until the feed publishes past 80, its cut drops them.)
 */
function apart(rowsIn, layout, keep = MAIN_ROWS) {
  const mine = (rowsIn || []).filter((r) => r && r.kindsRow);
  const rest = mine.length ? rowsIn.filter((r) => !(r && r.kindsRow)) : rowsIn;
  const laid = layout(rest);
  if (!mine.length || laid.length < keep) return laid;
  const order = (r) => SECTIONS.indexOf(r.section);
  return [...laid, ...mine.map((r, i) => ({ r, i })).sort((a, b) => order(a.r) - order(b.r) || a.i - b.i).map((x) => x.r)];
}

/**
 * The fallback when no extension lays the sections out: up to `max` of the desk's rows handed to the release desk's places past page
 * one (lib/release-desk.js place: 41, 45, ...; its keep-place rule), marked as its rows are, in place of `apart`. Only the merge chooses this.
 */
function asCalendar(rowsIn, max = 4) {
  let n = 0;
  return rowsIn.map((r) => {
    if (!r || !r.kindsRow) return r;
    if (n >= max) return null;
    n += 1;
    // (no longer apart: the release desk's places hold it, lib/release-desk.js place)
    return { ...r, kindsRow: false, releaseRow: true, meta: { ...r.meta, release: { kind: r.meta.kinds.kind, day: null, source: (r.point.sources || [])[0] || 'kinds' } } };
  }).filter(Boolean);
}

/** The section an engine row past the main rows belongs to, for the extension (a death or a tribute is remembered; a game, games), or null. */
function sectionOf(row) {
  if (!row || row.kind !== 'talk' && row.kind !== 'word') return null;
  if (row.kind === 'talk' && (row.noun === 'death' || row.noun === 'tribute' || row.noun === 'funeral')) return 'remembered';
  if (row.kind === 'word' && row.word && row.word.sub === 'gaming') return 'games';
  return null;
}

/** Counts for the cycle's log: what each read holds and the rows made for an audience. Never a name. */
function census(cache0, made = [], nowS = null) {
  const cache = cacheOf(cache0);
  const pages = Object.values(cache.deaths);
  const by = Object.fromEntries(SECTIONS.map((s) => [s, made.filter((r) => r.kindsRow && r.section === s).length]));
  return { deaths: pages.reduce((n, p) => n + (p.entries || []).length, 0), services: Object.keys(cache.status).length,
    incidents: Object.values(cache.status).reduce((n, s) => n + (s.incidents || []).filter((i) => Number.isFinite(nowS) && nowS - i.at < OUTAGE_HOURS * HOUR).length, 0),
    sellers: ((cache.steam && cache.steam.top) || []).length, apps: Object.keys((cache.steam && cache.steam.apps) || {}).length, rows: by };
}

module.exports = { SECTIONS, SECTION_MAX, MAIN_ROWS, HOLD_WIKIMEDIA, SWITCHES, PER_CYCLE, offOf, due, wikiHold, read, step, recordedOnly, rows, add, apart, asCalendar, sectionOf, census,
  deathsAt, outagesAt, tonightAt, gamesAt, airedAt, saidDown, showNames, ownDeath, tierOf, DEATH_HOURS, OUTAGE_HOURS, TV_HOURS, LAUNCH_BEFORE_DAYS, LAUNCH_AFTER_DAYS };
