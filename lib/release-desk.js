'use strict';
/*
 * What comes out in the next days, listed before anyone searches for it (ios/IDEAS-SUPER.md, lead: the scoreboard's headline is the
 * hours between a comparator showing a trend and our first listing). A week of public lists showed why: almost no shared Google Trends
 * entry was listed before Google Trends, and a fifth of its entertainment entries were things a calendar knew days ahead (season
 * drops, finales, theme nights, films), every one listed late or never. Their searches begin when the thing comes out, or the
 * evening before; a row made from the calendar is there first.
 *
 * Calendars (lib/sources/releases.js): TVmaze's schedule, today and tomorrow, and a show's seasons; Wikipedia's list of the year's
 * American films. Buzz, so only what people already read about is listed: Wikipedia's daily top-1,000 lists the collector reads
 * anyway (engine/talk-sources.js wikiTopLists), the newest two. A row is made for
 *   a season starting  (its first episode, or a whole season out on one day) of a show in the top lists; a batch of episodes of one of
 *                      TVmaze's most followed shows (weight PREMIERE_WEIGHT), or a whole season from its first episode of any show the
 *                      schedule keeps (WHOLE_WEIGHT), whatever the lists say: listed from the day before (US Eastern). A new show's
 *                      whole season has no article to read yet, and its searches can begin the evening it comes out
 *   a season's finale  (its last episode, by the show's own season count) of a show in the top lists: from the day before
 *   a theme night      (a competition or reality show's episode named for its theme: "... Night", "... Finale") or a special, of a
 *                      show in the top lists: from the day before
 *   a film opening     in the US, whose own article is in the top lists: from six days before (a Friday film from the Saturday before:
 *                      a film's searches began two to six days ahead of its day that week, with its reviews, previews and promotion)
 * and kept until the day after (a film: its first weekend). ROWS_MAX a list, the soonest first; never one a row of the list already
 * tells (`place`). The row says only what the calendar says, and names it. Nothing is drama, nothing claims a start: the desk lays them out
 * past page one (`place`, from PLACE_FROM), where they count as listed and take no place from a story.
 *
 * A row's card key is the thing's own name ("<Show>", "<Film>"; a theme night's whole title), so the name people search for it by is one
 * of its keys; its title says what happens ("<Show> season 3", "<Film> movie").
 * Off: IDEAS_SOURCES_OFF=releases (nothing is asked and no row is made).
 */
const fs = require('node:fs');
const path = require('node:path');
const R = require('./sources/releases');
const { naturalKey } = require('./identity');
const { keyOf, localDay, zonedTime, DAY } = require('./util');

const ZONE = 'America/New_York';
const PER_CYCLE = 2;
const RETRY_SECONDS = 3600;
const TV_DAYS_KEPT = 4;
const SEASONS_KEPT = 60;
const PREMIERE_WEIGHT = 100;
// (a whole season from its first episode: any show the schedule keeps, lib/sources/releases.js WEIGHT_KEPT)
const WHOLE_WEIGHT = R.WEIGHT_KEPT;
const DROP_MIN = 3;
const TV_BEFORE_DAYS = 1;
const TV_AFTER_DAYS = 2;
const FILM_BEFORE_DAYS = 6;
const FILM_AFTER_DAYS = 3;
const FILMS_AHEAD_DAYS = 45;
const TOP_LISTS = 2;
const ROWS_MAX = 8;
const PLACE_FROM = 41;
const PLACE_EVERY = 4;
// (how many rows a list publishes: lib/feed.js ROWS_MAX)
const LIST_KEPT = 80;
const HEAT_BASE = 24;
const HEAT_MAX = 36;
const SOURCE_TV = 'TVmaze';
const SOURCE_FILM = 'Wikipedia';
// (a competition or reality show's episode named for its theme, or the night it settles something)
const THEMED_TYPES = new Set(['Reality', 'Game Show', 'Variety', 'Award Show']);
const THEME = /\b(?:night|finale|premiere|reunion|special|semi-?finals?|finals?|results|live shows?|eliminations?|awards?)\b/i;
const GENERIC = /^(?:episode|ep\.?|part|chapter|show|week)\s*#?\d+$|\b\d{4}\b|^(?:mon|tue|wed|thu|fri|sat|sun)\w*,? /i;
// (a one-word name names a work only beside a word that says it is one)
const WORK_WORDS = new Set(['movie', 'film', 'season', 'series', 'show', 'trailer', 'review', 'reviews', 'box', 'premiere', 'finale', 'episode', 'cast', 'release', 'ending']);
const SCREEN_ARTICLE = /\((?:[^)]*\b)?(?:TV series|miniseries|season \d+|TV program(?:me)?|game show|web series|reality series|American TV series)\)/i;
// (samples/validate.cjs LIMITS: a title the feed would cut, a line it would refuse)
const TITLE_MAX = 80;
const LINE_MAX = 200;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const emptyCache = () => ({ tv: {}, seasons: {}, films: {} });
const cacheOf = (cache) => ({ ...emptyCache(), ...(cache && typeof cache === 'object' ? cache : {}) });
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY * 1000).toISOString().slice(0, 10);
const dayStart = (ymd) => zonedTime(ymd, ZONE, 0, 0);
const fresh = (entry, every, nowS) => !!entry && Number.isFinite(entry.at) && nowS - entry.at < every;

// ---------- the top lists ----------
/**
 * The newest TOP_LISTS of Wikipedia's daily top lists before today (UTC), read into one lookup: (name, { screen }) -> views. A name is
 * an article's title without its parentheses, keyed; `screen` asks for an article that says it is a show ("(TV series)", "season 3").
 */
function buzzOf(wikiLists, nowS) {
  const today = new Date(nowS * 1000).toISOString().slice(0, 10);
  const days = [...(wikiLists ? wikiLists.keys() : [])].filter((d) => d < today).sort().slice(-TOP_LISTS);
  const any = new Map();
  const screen = new Map();
  for (const d of days) {
    for (const [article, views] of wikiLists.get(d).views) {
      const plain = String(article).replace(/_/g, ' ');
      const name = keyOf(plain.replace(/\([^)]*\)/g, ' '));
      if (!name) continue;
      any.set(name, Math.max(any.get(name) || 0, views));
      if (SCREEN_ARTICLE.test(plain)) screen.set(name, Math.max(screen.get(name) || 0, views));
      // (and an article by its exact title, for a film's own article)
      any.set(`=${plain}`, Math.max(any.get(`=${plain}`) || 0, views));
    }
  }
  return { days, any, screen };
}
/** How read a show is in the top lists: its article, its season's ("<show> season 35", "<show> 51"). A one-word name needs a show's article. */
function showViews(buzz, show, season) {
  const name = keyOf(show);
  if (!name) return 0;
  const wide = name.split(' ').length >= 2;
  return Math.max(0, wide ? buzz.any.get(name) || 0 : buzz.screen.get(name) || 0, buzz.any.get(`${name} season ${season}`) || 0, buzz.any.get(`${name} ${season}`) || 0);
}

// ---------- asking ----------
/** The shows whose finale the seasons would tell: a regular episode in the window, read in the top lists, its seasons not read this week. */
function seasonsWanted(cache, buzz, nowS) {
  const out = [];
  for (const entry of Object.values(cache.tv)) {
    for (const it of entry.items || []) {
      if (it.number === 1 || !Number.isFinite(it.number) || fresh(cache.seasons[it.showId], R.SEASONS_EVERY, nowS) || out.includes(it.showId)) continue;
      if (showViews(buzz, it.show, it.season) > 0) out.push(it.showId);
    }
  }
  return out;
}
/** The calendar requests due now, PER_CYCLE at most: today's and tomorrow's schedules, then the year's films, then a show's seasons. */
function due(cache0, nowS, wikiLists = null) {
  const cache = cacheOf(cache0);
  const today = localDay(nowS, ZONE);
  const out = [];
  for (const day of [today, addDays(today, 1)]) for (const which of ['net', 'web']) if (!fresh(cache.tv[`${day}|${which}`], R.TV_EVERY, nowS)) out.push(R.tvRequest(which, day));
  const year = Number(today.slice(0, 4));
  const years = today.slice(5, 7) === '12' ? [year, year + 1] : [year];
  for (const y of years) if (!fresh(cache.films[y], R.FILMS_EVERY, nowS)) out.push(R.filmsRequest(y));
  for (const id of seasonsWanted(cache, buzzOf(wikiLists, nowS), nowS)) out.push(R.seasonsRequest(id));
  return out.slice(0, PER_CYCLE);
}

/**
 * The Wikimedia requests to keep back from the cycle's rounds for the year's film page: 1 when this cycle's asking holds it, else 0. In
 * a replay (`folder`, the slot's recording) only when the recording holds it: a day recorded before this desk is replayed as it was.
 */
function wikiHold(cache0, nowS, folder = null) {
  const films = due(cache0, nowS).filter((r) => r.kind === 'releases-films');
  return (folder ? recordedOnly(films, folder) : films).length;
}

/** The cache with the replies read in ([{ request, status, text }]), old days and seasons let go. Never changes the cache handed in. */
function read(cache0, results, nowS) {
  const cache = cacheOf(cache0);
  const tv = { ...cache.tv };
  const seasons = { ...cache.seasons };
  const films = { ...cache.films };
  let n = 0;
  // (a reply that did not answer, or did not read, is asked again after RETRY_SECONDS, not every cycle; what was held before stays)
  const failed = (table, key, every, field) => { const was = table[key]; table[key] = { ...(was || { [field]: [] }), at: nowS - every + RETRY_SECONDS }; };
  for (const r of results || []) {
    if (!r || !r.request) continue;
    const { kind, args = {} } = r.request;
    const ok = r.status === 200;
    if (kind === 'releases-tv') {
      const items = ok ? R.parseTv(r.text, args) : null;
      if (items) { tv[`${args.day}|${args.which}`] = { at: nowS, items }; n += 1; } else failed(tv, `${args.day}|${args.which}`, R.TV_EVERY, 'items');
    }
    if (kind === 'releases-seasons') {
      const list = ok ? R.parseSeasons(r.text) : null;
      if (list) { seasons[args.showId] = { at: nowS, list }; n += 1; } else failed(seasons, args.showId, R.SEASONS_EVERY, 'list');
    }
    if (kind === 'releases-films') {
      // (the films of the weeks around now: the year's list is four hundred, the state keeps what a row can be made of)
      const today = localDay(nowS, ZONE);
      const items = ok ? R.parseFilms(r.text, args.year) : null;
      if (items) { films[args.year] = { at: nowS, items: items.filter((f) => f.day >= addDays(today, -FILM_AFTER_DAYS - 1) && f.day <= addDays(today, FILMS_AHEAD_DAYS)) }; n += 1; } else failed(films, args.year, R.FILMS_EVERY, 'items');
    }
  }
  const oldest = addDays(localDay(nowS, ZONE), -TV_DAYS_KEPT);
  const keptTv = Object.fromEntries(Object.entries(tv).filter(([k]) => k.slice(0, 10) >= oldest));
  const keptSeasons = Object.fromEntries(Object.entries(seasons).sort((a, b) => b[1].at - a[1].at).slice(0, SEASONS_KEPT));
  const year = Number(localDay(nowS, ZONE).slice(0, 4));
  const keptFilms = Object.fromEntries(Object.entries(films).filter(([y]) => Number(y) >= year - 1));
  return { cache: { tv: keptTv, seasons: keptSeasons, films: keptFilms }, read: n };
}

/** In a replay, only what the recording holds (a calendar the day never asked for is not asked: the replay stays the day's). */
function recordedOnly(requests, folder) {
  if (!folder) return requests;
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); } catch { manifest = {}; }
  return requests.filter((r) => manifest[r.id]);
}

/**
 * One cycle's asking: { cache, results, read }. send(requests) -> results ([{ request, status, text, ... }], as lib/fetch.js sends);
 * a failure costs the calendar's freshness and nothing else.
 */
async function step({ cache, nowS, wikiLists = null, send }) {
  const requests = due(cache, nowS, wikiLists);
  if (!requests.length) return { cache: cacheOf(cache), results: [], read: 0 };
  const results = await send(requests);
  const out = read(cache, results, nowS);
  return { cache: out.cache, results, read: out.read };
}

// ---------- the events ----------
const dayWords = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
function clockWords(at) {
  const [hh, mm] = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at * 1000)).split(':').map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'a.m.' : 'p.m.'} ET`;
}
/** When, as the row says it: "Tuesday, Oct 20 at 8 p.m. ET" for a network's episode, the day alone for a streaming one. */
const whenOf = (it) => (!it.web && Number.isFinite(it.at) ? `${dayWords(it.day)} at ${clockWords(it.at)}` : dayWords(it.day));
const quoted = (s) => `“${s}”`;
const withShow = (show, name) => (keyOf(name).includes(keyOf(show)) ? name : `${show} ${name}`);
/** The verb as of `today` (US Eastern): what is still to come in the present ("comes out"), what is out in the past ("came out"). */
const tense = (day, today, now, then) => (today && day < today ? then : now);

/** The TV events of the cache: [{ kind, show, title, card, line, day, from, until, views, audiences, source }]; lines in the tense of `today`. */
function tvEvents(cache, buzz, today = null) {
  const groups = new Map();
  for (const entry of Object.values(cache.tv)) {
    for (const it of entry.items || []) {
      // (a streaming service's episode is that service's day; a network's, the night it airs, US Eastern)
      const day = !it.web && Number.isFinite(it.at) ? localDay(it.at, ZONE) : it.day;
      const k = `${it.showId}|${day}`;
      const g = groups.get(k) || { day, items: [] };
      if (!g.items.some((x) => x.id === it.id)) g.items.push({ ...it, day });
      groups.set(k, g);
    }
  }
  const out = [];
  for (const { day, items } of groups.values()) {
    items.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    const first = items[0];
    const { show, season } = first;
    const views = showViews(buzz, show, season);
    const seasonInfo = ((cache.seasons[first.showId] || {}).list || []).find((s) => s.number === season) || null;
    const last = items[items.length - 1];
    const premiere = items.some((x) => x.number === 1) || items.length >= DROP_MIN;
    const finale = !premiere && !!seasonInfo && Number.isFinite(seasonInfo.episodes) && seasonInfo.episodes > 1 && last.number === seasonInfo.episodes;
    const themed = items.find((x) => x.type === 'significant_special' || (THEMED_TYPES.has(x.stype) && THEME.test(x.name) && !GENERIC.test(x.name)));
    const audiences = first.web && !first.country ? ['US', 'GB', 'AU', 'CA', 'mixed'] : ['US', 'CA', 'mixed'];
    const where = first.channel ? ` on ${first.channel}` : '';
    let ev = null;
    const all = items.length >= DROP_MIN && items[0].number === 1;
    if (premiere && (views > 0 || (first.weight >= PREMIERE_WEIGHT && items.length >= DROP_MIN) || (all && first.weight >= WHOLE_WEIGHT))) {
      const come = tense(day, today, 'come out', 'came out');
      const line = all ? `All ${items.length} episodes of season ${season} of ${show} ${come}${where} on ${whenOf(first)}.`
        : items.length >= DROP_MIN ? `${items.length} new episodes of ${show}, season ${season}, ${come}${where} on ${whenOf(first)}.`
          : `Season ${season} of ${show} ${tense(day, today, 'starts', 'started')}${where} on ${whenOf(first)}.`;
      ev = { kind: 'premiere', title: `${show} season ${season}`, card: show, line };
    } else if (finale && views > 0) {
      const comes = tense(day, today, 'comes out', 'came out');
      const named = `The season ${season} finale of ${show}, ${quoted(last.name)}, ${comes}${where} on ${whenOf(last)}.`;
      ev = { kind: 'finale', title: `${show} season ${season} finale`, card: show, line: named.length <= LINE_MAX ? named : `The season ${season} finale of ${show} ${comes}${where} on ${whenOf(last)}.` };
    } else if (themed && views > 0 && withShow(show, themed.name).length <= TITLE_MAX) {
      const title = withShow(show, themed.name);
      ev = { kind: 'night', title, card: title, line: `The ${quoted(themed.name)} episode of ${show} ${tense(day, today, 'airs', 'aired')}${where} on ${whenOf(themed)}.` };
    }
    if (!ev || ev.title.length > TITLE_MAX || ev.line.length > LINE_MAX) continue;
    out.push({ ...ev, show, day, views, audiences, source: SOURCE_TV, from: dayStart(addDays(day, -TV_BEFORE_DAYS)), until: dayStart(addDays(day, TV_AFTER_DAYS)) });
  }
  return out;
}

/** The film events of the cache: a film whose own article is in the top lists, from FILM_BEFORE_DAYS before its day; lines in the tense of `today`. */
function filmEvents(cache, buzz, today = null) {
  const out = [];
  for (const entry of Object.values(cache.films)) {
    for (const f of entry.items || []) {
      const views = buzz.any.get(`=${f.article}`) || 0;
      if (!views) continue;
      if (f.title.length + ' movie'.length > TITLE_MAX) continue;
      out.push({ kind: 'film', show: f.title, title: `${f.title} movie`, card: f.title, line: `${f.title} ${tense(f.day, today, 'comes out', 'came out')} in the US on ${dayWords(f.day)}.`, day: f.day, views,
        audiences: ['US', 'CA', 'mixed'], source: SOURCE_FILM, from: dayStart(addDays(f.day, -FILM_BEFORE_DAYS)), until: dayStart(addDays(f.day, FILM_AFTER_DAYS)) });
    }
  }
  return out;
}

/**
 * Every event live at `t` (seconds) for an audience: what is still to come first, the soonest first (the day before is when it is worth
 * most: its searches have not begun), then what is out, the most read first.
 */
function eventsAt(cache0, wikiLists, t, audience = 'US') {
  const cache = cacheOf(cache0);
  const buzz = buzzOf(wikiLists, t);
  const today = localDay(t, ZONE);
  const seen = new Set();
  const out = (e) => Number(e.day < today);
  return [...tvEvents(cache, buzz, today), ...filmEvents(cache, buzz, today)].filter((e) => t >= e.from && t < e.until && e.audiences.includes(audience))
    .sort((a, b) => out(a) - out(b) || (out(a) ? 0 : a.day.localeCompare(b.day)) || b.views - a.views || a.title.localeCompare(b.title))
    .filter((e) => { const k = keyOf(e.card); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- the rows ----------
/** Whether a row of the list already tells the thing named `name` (keyed): its subject, or a title that is the name or opens with it as a work's. */
function told(name, row) {
  if (!name || row.releaseRow) return false;
  if (keyOf(row.subject || '') === name || keyOf(row.surface || '') === name) return true;
  const title = keyOf(row.title || '');
  if (title === name) return true;
  if (!title.startsWith(`${name} `)) return false;
  return name.split(' ').length >= 2 || WORK_WORDS.has(title.slice(name.length + 1).split(' ')[0]);
}

const heatOf = (views) => Math.min(HEAT_MAX, HEAT_BASE + (views > 0 ? Math.round(3 * Math.log10(1 + views / 1000)) : 0));

/**
 * The audience's rows with the calendar's added after them, ROWS_MAX at most. ctx: { cache (the desk's calendar, as `step` keeps it),
 * wikiLists, t (seconds), audience }. Whether a row of the list already tells the same thing is known once the list is laid out:
 * `place` drops the calendar's row then (the engine's own rows are many more than the list keeps).
 */
function add(rows, { cache = null, wikiLists = null, t, audience = 'US' }) {
  const rankFrom = 1 + rows.reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
  const made = [];
  for (const e of eventsAt(cache, wikiLists, t, audience)) {
    if (made.length >= ROWS_MAX) break;
    const name = keyOf(e.card);
    const heat = heatOf(e.views);
    const release = { kind: e.kind, day: e.day, source: e.source };
    // (no key: a row keyed by a name has that name searched again while it is rising, lib/budget.js pickNames, and the calendar's rows would
    // take the name searches the people's stories need. What the calendar says is the whole row)
    const meta = { key: null, subject: name, surface: e.card, family: null, noun: null, from: 'releases', own: [], outletsOwn: 0, outletsAll: 0, trends: [], fresh: [], wiki: null,
      also: [], searched: false, newsAt: null, ytAt: null, timeline: { first: null, replies: [], chapter: null, latest: null }, release };
    const point = { title: e.title, kind: 'show', what: e.line, subject: e.card, noun: null, heat, status: 'rising', sources: [e.source], tier: 'other', drama: false, from: 'releases', meta };
    made.push({ audience, engineRank: rankFrom + made.length, kind: 'talk', title: e.title, heat, engineStatus: 'rising', drama: false, type: 'point', cardKey: `point:${e.card}`, point,
      word: null, moment: null, meta, wordish: false, line: e.line, subject: name, surface: e.card, family: null, noun: null, tier: 'other', releaseRow: true,
      natural: naturalKey({ kind: 'talk', subject: name, family: null, noun: null, title: e.title }), heads: [] });
  }
  return [...rows, ...made];
}

/**
 * What a calendar row never pushes out of the list: people-drama, a creator's or a celebrity's story, a row with a search of its own
 * (what the scoreboard's Google Trends reads), a sound (a chart's). A full list is cut at `keep`, so each calendar row put in costs the list its last row; that row is the
 * last one of the rest. Measured on a week of public lists with the desk's rows put in: pushing the last rows down lost trends the list
 * never showed again, people-drama and a shared Google Trends entry among them; with this rule about half as many, none of them drama,
 * a person's story, searched or a sound (AI-trend words and stories of no one), and no shared entry.
 */
const KEEPS_PLACE = (r) => !!r && (!!r.drama || r.tier === 'creator' || r.tier === 'celebrity' || !!r.searchRow || ((r.meta && r.meta.trends) || []).some((x) => (x.volume || 0) >= SEARCH_KEEPS) ||
  r.kind === 'sound');
const SEARCH_KEEPS = 20000;

/**
 * A laid-out list with the calendar's rows moved past page one: from PLACE_FROM, one every PLACE_EVERY rows (the list's end, if shorter).
 * One that a row inside the list's `keep` (the rows a list publishes) already tells is left out: that row is the thing's. A row that
 * keeps its place (KEEPS_PLACE) and would fall past `keep` takes the place of the last row past PLACE_FROM that does not.
 */
function place(rows, { keep = LIST_KEPT, log = null } = {}) {
  const mine = rows.filter((r) => r && r.releaseRow);
  if (!mine.length) return rows;
  // (a fault here costs the calendar's rows their place, never the list its order: they stay where the desk put them)
  try { return placed(rows, mine, keep); } catch (e) { if (log) log(`[releases] the calendar's rows keep the desk's places: ${e.message}`); return rows; }
}
function placed(rows, mine, keep) {
  const out = rows.filter((r) => !(r && r.releaseRow));
  const shown = out.slice(0, keep);
  const kept = mine.filter((r) => !shown.some((x) => told(keyOf(r.surface || r.subject), x) || told(keyOf(r.title), x)));
  kept.forEach((r, i) => { out.splice(Math.min(out.length, PLACE_FROM - 1 + i * PLACE_EVERY), 0, r); });
  // (the rows the calendar's pushed past the cut: one that keeps its place swaps with the last row inside that does not)
  let low = keep - 1;
  for (let at = keep; at < Math.min(out.length, keep + kept.length); at++) {
    if (!KEEPS_PLACE(out[at])) continue;
    while (low >= PLACE_FROM - 1 && (KEEPS_PLACE(out[low]) || out[low].releaseRow)) low -= 1;
    if (low < PLACE_FROM - 1) break;
    const up = out.splice(at, 1)[0];
    const down = out.splice(low, 1, up)[0];
    out.splice(at, 0, down);
    low -= 1;
  }
  return out;
}

/** Counts for the cycle's log: the calendar's days and films held, and the rows made for an audience. Never a title. */
function census(cache0, rows = []) {
  const cache = cacheOf(cache0);
  const mine = rows.filter((r) => r.releaseRow);
  return { days: Object.keys(cache.tv).length, films: Object.values(cache.films).reduce((n, e) => n + (e.items || []).length, 0), seasons: Object.keys(cache.seasons).length,
    rows: mine.length, tv: mine.filter((r) => r.meta.release.source === SOURCE_TV).length, film: mine.filter((r) => r.meta.release.source === SOURCE_FILM).length };
}

module.exports = { due, wikiHold, read, step, recordedOnly, eventsAt, tvEvents, filmEvents, buzzOf, showViews, told, add, place, census, ROWS_MAX, PLACE_FROM, PLACE_EVERY, PER_CYCLE,
  PREMIERE_WEIGHT, WHOLE_WEIGHT, TV_BEFORE_DAYS, TV_AFTER_DAYS, FILM_BEFORE_DAYS, FILM_AFTER_DAYS };
