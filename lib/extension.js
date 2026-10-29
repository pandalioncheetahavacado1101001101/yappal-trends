'use strict';
/*
 * The extension (ios/IDEAS-FEED.md D3, as of 2026-10-31): ranks 81-160 of a list, by section, after the main list's 80. The main
 * list is laid out exactly as before (lib/feed.js spliceEarly, keepEarly); nothing here reorders, retitles or measures a row of it.
 *
 *   desks      an extension desk is a pure function (ctx) => rows, each row with a `section` (SECTIONS keys). The desks: the search
 *              desk's extended mode (lib/search-desk.js `extended`, "stillSearched" and, wave 12, "niche"), the kinds desk (remembered,
 *              rightNow, tonight, games), the charts desk (lib/desks/charts.js, "charts") and, wave 12, the cards under the talking
 *              points' cut (lib/desks/more.js, "more"). `more` is first the main list's own rows past 80 (lib/feed.js hands them in),
 *              then those cards.
 *   candidates the desks' rows of each audience, made after the main rows and never handed to the main pipeline: a desk that throws
 *              costs its own rows, never the list (each is fenced).
 *   measure    the candidates through the same history step as every row (lib/history.js `step`), in a call of their own, so the
 *              main rows' identities, samples and statuses are those of a cycle without them. A candidate the step ties to a trend a
 *              main row holds is that row's story: it is left out (the main row tells it).
 *   extend     after the feed's layout (lib/feed.js build): the main rows as laid out, then each section's rows that pass the freshness
 *              budget, in SECTIONS order, each section up to its quota, then every section's overflow, ROWS_MAX rows in all.
 *   budget     an eligibility rule, as every desk's own is (rank, never remove: no row is judged by what it says). A row qualifies
 *              when one holds: it started under 72 hours ago; it has a new chapter or turn inside 48 hours; (wave 12, More's rows
 *              only) one of its own headlines is under 24 hours old; it is still on its own chart; its Google Trends search is still searched (or ended
 *              inside 6 hours); its desk's own clock (`extUntil`: a TV night 36 h, an outage 6 h, a death 72 h) has not run out.
 *   trim       the list's bytes: the main rows first, exactly as before (120 KB with the main rows alone), then extension rows from
 *              the end (the lowest section first) while the whole list is over 240 KB.
 *
 * Off with IDEAS_EXTENSION=0 (collect.yml passes the repository variable): then nothing here runs and every list is the main list.
 * No user-facing prediction is made here; the budget is internal. Counts only in the ledger (`extensionOf`), never a row.
 */
const { HOUR } = require('./util');

const MAIN_ROWS = 80;
const ROWS_MAX = 160;
const MAIN_BYTES_MAX = 120000;
const LIST_BYTES_MAX = 240000;
// (an extension needs the page under it: a list too short to fill its first page has no extension)
const PAGE_MIN = 20;
const FRESH_STARTED = 72 * HOUR;
const CHAPTER_WITHIN = 48 * HOUR;
// (wave 12: a story an outlet told again today is still news, whatever its start: on the warm frozen day 13 of the 34 cards under the
// cut that the budget refused had a headline of their own under 24 hours old, 8 more under 48)
const NEWS_WITHIN = 24 * HOUR;
const SEARCH_ENDED = 6 * HOUR;

// (display order; quota: the rows a section places before any section's overflow. Quotas are fixed until 14 days of the section
// ledger can set them. Wave 12: still searched 18 -> 20 (Google's "Other" searches beside the pop ones), charts 20 -> 24 (each
// audience's own countries' song charts), niche 10 -> 12 (the creator niches Google files apart, titled for what they are: the rows are
// Google's food, pets, shopping and technology searches, not the viewer's own niche); `more` takes the rest)
const SECTIONS = [
  { key: 'justStarting', title: 'Just starting', quota: 10 },
  { key: 'stillSearched', title: 'Still searched', quota: 20 },
  { key: 'tonight', title: 'Tonight and this week', quota: 14 },
  { key: 'charts', title: 'Charts', quota: 24 },
  { key: 'games', title: 'Games', quota: 10 },
  { key: 'niche', title: 'Niche searches', quota: 12 },
  { key: 'remembered', title: 'Remembered', quota: 6 },
  { key: 'rightNow', title: 'Right now', quota: 4 },
  { key: 'rumours', title: 'Rumours and leaks', quota: 10 },
  { key: 'more', title: 'More', quota: ROWS_MAX },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);
const SECTION_OF = new Map(SECTIONS.map((s, i) => [s.key, { ...s, order: i }]));

/** Whether the extension runs: on unless IDEAS_EXTENSION is "0" or "off". */
const on = (env = process.env) => !/^(?:0|off|false)$/i.test(String(env.IDEAS_EXTENSION ?? '').trim());

const isExt = (row) => !!row && typeof row.section === 'string' && SECTION_OF.has(row.section);
const keyOfRow = (r) => r.natural || r.cardKey || r.title;

/**
 * Every desk's rows for each audience: { audience: [row with section] }. desks: [(ctx) => rows]; ctxOf(audience) -> the desk's
 * ctx. A row with no known section goes under `more`; the same natural key twice in one audience is one row (the first desk's).
 */
function candidates(audiences, desks, ctxOf, { log = () => {} } = {}) {
  const out = {};
  for (const a of audiences) {
    const seen = new Set();
    const rows = [];
    for (const desk of desks) {
      let made = [];
      try { made = desk(ctxOf(a)) || []; } catch (e) { log(`[extension] ${a}: a desk made no rows: ${e.message}`); made = []; }
      for (const r of made) {
        if (!r || !r.title) continue;
        const k = keyOfRow(r);
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push(isExt(r) ? r : { ...r, section: 'more' });
      }
    }
    out[a] = rows;
  }
  return out;
}

/**
 * The candidates measured, beside the main cycle: { cycle (the main cycle with the kept candidates' trends added), rows: { audience:
 * rows } }. step(rowsByAudience) is lib/history.js step with the cycle's own inputs (it sets each row's id). The main cycle is never
 * changed: a new object is returned. A candidate whose trend a main row holds is left out; a trend the main step carried that a
 * candidate now holds is the candidate's (sampled once).
 */
function measure(mainCycle, byAudience, step) {
  const all = Object.values(byAudience).flat();
  if (!all.length) return { cycle: mainCycle, rows: {} };
  const ext = step(byAudience);
  const held = new Set(mainCycle.trends.keys());
  const kept = new Map([...ext.trends].filter(([id]) => !held.has(id)));
  const mainAliases = new Set(mainCycle.aliases.map(([k]) => k));
  const cycle = {
    ...mainCycle,
    trends: new Map([...mainCycle.trends, ...kept]),
    minted: [...mainCycle.minted, ...ext.minted.filter((m) => kept.has(m.id))],
    aliases: [...mainCycle.aliases, ...ext.aliases.filter(([k, id]) => kept.has(id) && !mainAliases.has(k))],
    carried: mainCycle.carried.filter((c) => !kept.has(c.id)),
    failed: [...(mainCycle.failed || []), ...(ext.failed || [])],
  };
  const rows = Object.fromEntries(Object.entries(byAudience).map(([a, rs]) => [a, rs.filter((r) => r.id && kept.has(r.id))]));
  return { cycle, rows };
}

/** The newest of a row's own headlines (meta.own, ms or s), in epoch seconds, or null. */
function newestOwn(row) {
  const ts = ((row && row.meta && row.meta.own) || []).map((h) => (h && Number.isFinite(h.t) ? (h.t > 1e12 ? h.t / 1000 : h.t) : NaN)).filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : null;
}

/**
 * The freshness budget at `t` (epoch s): (row) -> why it qualifies ('clock', 'started', 'chapter', 'news', 'charted', 'searched') or
 * null. cycleOf(row): the row's measured trend (lib/history.js step), or null.
 */
function budgetOf({ t, cycleOf }) {
  const within = (x, span) => Number.isFinite(x) && x <= t && t - x < span;
  return (row) => {
    const c = cycleOf(row);
    if (!c) return null;
    if (Number.isFinite(row.extUntil)) return t < row.extUntil ? 'clock' : null;
    const next = c.next || {};
    if (within(next.startedAt, FRESH_STARTED)) return 'started';
    if (within(next.chapterAt, CHAPTER_WITHIN) || within(c.turnAt, CHAPTER_WITHIN)) return 'chapter';
    // (More's rows only: a section that says why a row is there, "Still searched", keeps its own reason)
    if ((!row.section || row.section === 'more') && within(newestOwn(row), NEWS_WITHIN)) return 'news';
    if (row.platform && (row.platform.status || row.platform.sound)) return 'charted';
    const searches = (c.line && c.line.searches) || [];
    if (searches.some((s) => Number.isFinite(s.start) && s.start <= t && (s.end === null || s.end === undefined || t - s.end < SEARCH_ENDED))) return 'searched';
    return null;
  };
}

// (wave 12: under `more`, what began under 72 hours first, then a new chapter inside 48 or today's own headline, then the rest, each in
// the order it came: the section is the list's last, so the rows the 160 cut leaves out are its oldest, never its newest)
const YOUNG_FIRST = { started: 0, chapter: 1, clock: 1, news: 1 };
const youngOrder = (why) => (Object.prototype.hasOwnProperty.call(YOUNG_FIRST, why) ? YOUNG_FIRST[why] : 2);

/**
 * The list's rows: rows80 (the main rows as laid out) then the extension. extRows: the desks' measured rows with their sections; more:
 * the main rows the layout left past its 80 (each listed under `more`); budget: budgetOf. A row the main list already holds, or a
 * row twice, is placed once. Returns the rows (never more than max).
 */
function extend(rows80, extRows, { more = [], budget, max = ROWS_MAX } = {}) {
  if (rows80.length < PAGE_MIN || !budget) return rows80;
  const taken = new Set(rows80.map((r) => r.id));
  const groups = new Map(SECTION_KEYS.map((k) => [k, []]));
  const why = new Map();
  const add = (r) => {
    const w = r && !taken.has(r.id) ? budget(r) : null;
    if (!w) return;
    taken.add(r.id);
    why.set(r, w);
    groups.get(r.section).push(r);
  };
  // (the main list's own rows past its 80 first under `more`, then a desk's: they ranked higher in the pipeline that made them)
  for (const r of more) add(isExt(r) ? r : { ...r, section: 'more' });
  for (const r of extRows) if (isExt(r)) add(r);
  const young = groups.get('more').map((r, i) => ({ r, i, o: youngOrder(why.get(r)) })).sort((a, b) => a.o - b.o || a.i - b.i).map((x) => x.r);
  groups.set('more', young);
  const placed = [];
  const overflow = [];
  for (const s of SECTIONS) {
    const rows = groups.get(s.key);
    placed.push(...rows.slice(0, s.quota));
    overflow.push(...rows.slice(s.quota));
  }
  return [...rows80, ...placed, ...overflow].slice(0, Math.max(rows80.length, max));
}

/** The header's `sections`: [{ key, title, count }] of the sections the items hold, in display order. */
function sectionsOf(items) {
  const counts = new Map();
  for (const x of items) if (x && typeof x.section === 'string' && SECTION_OF.has(x.section)) counts.set(x.section, (counts.get(x.section) || 0) + 1);
  return SECTIONS.filter((s) => counts.has(s.key)).map((s) => ({ key: s.key, title: s.title, count: counts.get(s.key) }));
}

/**
 * The list under its byte caps: the main items trimmed from the end while the main list alone is over mainBytesMax (as before the
 * extension); then extension items from the end while the whole list is over bytesMax. A main list that had to lose a row keeps no
 * extension (its ranks would no longer follow on). bytesOf(list) -> bytes. Returns the list ({ ...header, sections?, items }).
 */
function trim(items, { header, bytesOf, mainBytesMax = MAIN_BYTES_MAX, bytesMax = LIST_BYTES_MAX, minRows = 5 }) {
  const main = items.filter((x) => !x.section);
  let m = main;
  while (m.length > minRows && bytesOf({ ...header, items: m }) > mainBytesMax) m = m.slice(0, -1);
  let ext = m.length === main.length ? items.filter((x) => !!x.section) : [];
  const listOf = (xs) => (xs.length ? { ...header, sections: sectionsOf(xs), items: [...m, ...xs] } : { ...header, items: m });
  let list = listOf(ext);
  while (ext.length && bytesOf(list) > bytesMax) { ext = ext.slice(0, -1); list = listOf(ext); }
  return list;
}

/** The rank the state records for an item (lib/history.js samples): its place, or for an extension row MAIN_ROWS + its place in the extension. */
const historyRank = (item, mainCount) => (item.section ? MAIN_ROWS + (item.rank - mainCount) : item.rank);

/**
 * The ledger's counts of one list, never a row: { rows: { section: n }, fresh (share of extension rows started under 72 h, null with
 * none), on }. t: epoch s.
 */
function extensionOf(list, t, isOn = true) {
  const ext = ((list && list.items) || []).filter((x) => x && x.section);
  const rows = {};
  for (const s of sectionsOf(ext)) rows[s.key] = s.count;
  const young = ext.filter((x) => x.startedAt && t - Date.parse(x.startedAt) / 1000 < FRESH_STARTED).length;
  return { on: isOn, rows, fresh: ext.length ? Math.round((young / ext.length) * 1000) / 1000 : null };
}

module.exports = { on, isExt, candidates, measure, budgetOf, newestOwn, extend, sectionsOf, trim, historyRank, extensionOf, SECTIONS, SECTION_KEYS, MAIN_ROWS, ROWS_MAX, MAIN_BYTES_MAX, LIST_BYTES_MAX, PAGE_MIN, FRESH_STARTED, CHAPTER_WITHIN, NEWS_WITHIN, SEARCH_ENDED };
