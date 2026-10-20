'use strict';
/*
 * Wikipedia's daily views as the size unit (ios/.review/trend-size-scale.md "The unit"): the article plus the titles that carry its
 * history (former titles left as redirects by a move), each subject's views minus its own baseline, the subjects added; the lifespan
 * read off the result. Also the cache of fetched days (each title's days are fetched once) and the pre-2015 conversion. Pure.
 */
const { FLOOR, ANCHORS } = require('./scale');
const D = require('./days');
const { median } = require('../util');

// the per-article daily series begins here; anything earlier is the converted pagecounts data (wikiLegacy)
const DAILY_FROM = ANCHORS.unit.dailyFrom;
// the baseline: the median of the days from 45 to 8 before the trend began
const BASELINE_FROM = 45;
const BASELINE_TO = 8;
// how far a life is chained across days under the floor, back to its start and on to its end: the trend's own page, or a quiet one
// (a baseline under the floor), across up to 30 such days; a busy person's page only across a week, so a celebrity's earlier news is
// not drawn as this trend's life, nor their later news (a streamer's page that never goes 30 days quiet: with a 30-day end one
// riot's life ran 516 days and took in the streamer's later spikes)
const START_LULL_NEW = 30;
const START_LULL_EXISTING = 7;
// (the end of a quiet or own page's life: 30 straight days under the floor)
const END_LULL_DAYS = START_LULL_NEW;
// where the trend's own day is looked for around its start (a start known late, a page that spiked a day early)
const ANCHOR_BEFORE = 3;
const ANCHOR_AFTER = 14;
// the history fetched first for a subject: this far before the trend began (more only when the life reaches its edge)
const HISTORY_DAYS = 400;
const BASELINE_PASSES = 3;
// where a life starts and ends: the floor, or an existing page's own swing (3 robust sigmas of its baseline days) when that is
// larger. A page read 7,000 a day moves by thousands on an ordinary day, and such a day is no part of a trend's life. (The size
// itself is never raised to this: a day's % is its excess on the one scale.)
const LIFE_NOISE_SIGMAS = 3;
const MAD_TO_SIGMA = 1.4826;

/** A title as the pageviews API takes it in its path: spaces as underscores, everything else percent-encoded. */
const restTitle = (title) => encodeURIComponent(String(title).trim().replace(/ /g, '_'));

/**
 * A per-article reply -> [{ day, views }] in day order; [] for the API's "no data in this range" (a 404 with a JSON body); null when
 * the text is not a reply at all.
 */
function parseRest(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  if (!Array.isArray(j.items)) return /not.?found/i.test(`${j.type || ''} ${j.title || ''}`) ? [] : null;
  return j.items.filter((i) => i && typeof i.timestamp === 'string' && Number.isFinite(i.views)).map((i) => ({ day: D.expand(i.timestamp), views: i.views }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * The last day a reply covers. The API leaves a day of no views out, so a quiet page's reply cannot say on its own whether its last
 * day is published yet: `publishedThrough` (the newest day any reply of the cycle carried) says it for all of them.
 */
function coveredTo(items, requestedTo, publishedThrough = null) {
  const last = items.length ? items[items.length - 1].day : null;
  const best = [last, publishedThrough].filter(Boolean).sort().pop() || null;
  return best && best > requestedTo ? requestedTo : best;
}

/**
 * The cache entry of one title after a fetch: { title, from, to, days: { day: views } }. Days between `from` and `to` that are not
 * in `days` had no views. Returns a new entry; the old one is not touched.
 */
function mergeFetch(entry, title, items, { from, to }) {
  const old = entry || { title, from: null, to: null, days: {} };
  if (!to || to < from) return { ...old, title };
  const days = { ...old.days };
  for (const i of items) if (i.day >= from && i.day <= to) days[i.day] = i.views;
  // (two ranges that touch become one; a fetch that would leave a hole keeps the newer range, and the hole is never read as zeros)
  const touches = !old.to || (D.dayNum(from) <= D.dayNum(old.to) + 1 && D.dayNum(to) >= D.dayNum(old.from) - 1);
  if (touches) return { title, from: old.from && old.from < from ? old.from : from, to: old.to && old.to > to ? old.to : to, days };
  return to > old.to ? { title, from, to, days } : { ...old, title, days };
}

/**
 * The ranges a title still needs, oldest first: before what is cached (back to `from`), and after it (to `yesterday`). Each day is
 * fetched once. [{ from, to }]
 */
function wantRanges(entry, from, yesterday) {
  const start = from < DAILY_FROM ? DAILY_FROM : from;
  if (start > yesterday) return [];
  if (!entry || !entry.to) return [{ from: start, to: yesterday }];
  const out = [];
  if (start < entry.from) out.push({ from: start, to: D.addDays(entry.from, -1) });
  if (entry.to < yesterday) out.push({ from: D.addDays(entry.to, 1), to: yesterday });
  return out;
}

/** One title's views on `day`: a number inside its cached range (0 for a day the API left out), else undefined. */
const viewsOn = (entry, day) => (entry && entry.from && day >= entry.from && day <= entry.to ? entry.days[day] || 0 : undefined);

/**
 * A title's first view: { title, day (its first day with a view, or null for none), known (that day is the title's start: there are
 * days without a view held before it, so it is when the page began; a view on the first day held, or on the daily series' first,
 * says only that it is older) }.
 */
function firstViewOf(entry) {
  const days = Object.keys(entry.days || {}).filter((d) => d >= entry.from && d <= entry.to && entry.days[d] > 0).sort();
  const day = days[0] || null;
  return { title: entry.title, day, known: !!day && day > entry.from };
}

/**
 * One subject's daily views: its titles added, over the days every title covers. titles: [cache entry]. Returns
 * { from, to, views: Map(day -> views), firstDay (the first day with any view), firsts: [each title's first view (firstViewOf)] },
 * or null when nothing is cached.
 */
function subjectViews(titles) {
  const live = titles.filter((e) => e && e.from && e.to);
  if (!live.length) return null;
  const from = live.map((e) => e.from).sort()[0];
  const to = live.map((e) => e.to).sort()[0];
  if (to < from) return null;
  const views = new Map();
  let firstDay = null;
  for (const day of D.daysBetween(from, to)) {
    // (a title whose range starts later had no data before it: those days read 0 for it)
    const v = live.reduce((s, e) => s + (day >= e.from ? viewsOn(e, day) || 0 : 0), 0);
    views.set(day, v);
    if (v > 0 && !firstDay) firstDay = day;
  }
  return { from, to, views, firstDay, firsts: live.map(firstViewOf) };
}

/**
 * A subject's baseline for a trend that began on `start`: the median of its days from 45 to 8 before (a day with no views counts 0);
 * 0 for a page made for the trend (no view before the window began).
 */
function baselineOf(subject, start) {
  const xs = baselineDays(subject, start);
  return xs ? median(xs) || 0 : 0;
}
/** The baseline window's days (a day with no views counts 0), or null for a page made for the trend. */
function baselineDays(subject, start) {
  const a = D.addDays(start, -BASELINE_FROM);
  const b = D.addDays(start, -BASELINE_TO);
  if (!subject.firstDay || subject.firstDay > a) return null;
  return D.daysBetween(a, b).map((d) => (subject.views.has(d) ? subject.views.get(d) : 0));
}
/** A page's own day-to-day swing before the trend: 1.4826 x the median absolute deviation of its baseline days (0 for a new page). */
function swingOf(subject, start) {
  const xs = baselineDays(subject, start);
  if (!xs) return 0;
  const m = median(xs);
  return MAD_TO_SIGMA * (median(xs.map((x) => Math.abs(x - m))) || 0);
}

/**
 * The life of a trend in a daily excess series: from `anchor` (the trend's own day), back to the first day at or above the floor
 * before a lull of `lull` straight days under it, and on to the last day at or above the floor before the same lull, or to today
 * while no such lull has come. excess: Map(day -> views above baseline) over [from, to]; floor: what counts as above (FLOOR, or a
 * busy page's swing). Returns { start, end, ended, atEdge (the start is the first day held, so the life may reach further back) }.
 */
function lifeOf(excess, anchor, from, to, lull, floor = FLOOR) {
  const above = (d) => (excess.get(d) || 0) >= floor;
  let start = anchor;
  let quiet = 0;
  for (let n = D.dayNum(anchor) - 1; n >= D.dayNum(from); n -= 1) {
    const d = D.dayOf(n);
    if (above(d)) { start = d; quiet = 0; } else if (++quiet >= lull) break;
  }
  let last = anchor;
  let ended = false;
  quiet = 0;
  for (let n = D.dayNum(anchor) + 1; n <= D.dayNum(to); n += 1) {
    const d = D.dayOf(n);
    if (above(d)) { last = d; quiet = 0; } else if (++quiet >= lull) { ended = true; break; }
  }
  return { start, end: ended ? last : to, ended, atEdge: start === from && from > DAILY_FROM };
}

/** The trend's own day: the day of most excess from 3 days before its start to 14 after (within what is held), or null. */
function anchorOf(excess, trendStart, from, to) {
  let best = null;
  for (const d of D.daysBetween(D.addDays(trendStart, -ANCHOR_BEFORE), D.addDays(trendStart, ANCHOR_AFTER))) {
    if (d < from || d > to) continue;
    if (!best || (excess.get(d) || 0) > (excess.get(best) || 0)) best = d;
  }
  return best;
}

/**
 * Wikipedia's part of a trend's size. subjects: [{ kind: 'trend' | 'person', titles: [cache entry of each title] }] (a bare list of
 * entries is a person's page); a trend about several subjects adds each subject's excess. trendStart: the day the trend began as the
 * collector knows it.
 *
 * A trend's own page (a meme's, a show's, an event's) lives the trend's life: its life starts at the first day at or above the floor
 * in its full history (read with no baseline, chained across lulls under 30 days), and its baseline is taken before that day (0 for
 * a page made for the trend). A person's page has a life of its own: its baseline is taken before this trend began, and the life is
 * found around the trend's own days, its floor raised to the page's own swing. When that life began well before the trend's known
 * start, the baseline moves back with it, a few passes at most.
 * Returns { excess: Map(day -> views above baseline, the subjects added), from, to, life: { start, end, ended, atEdge } or null (no day
 * reached the floor), baselines: [views], newPage: [bool], pages: [{ kind, firstDay (the page's first view: its earliest title's),
 * firstKnown (that day is when the page began, not merely the first day held), titleFirstDays: [the days its titles began, where
 * known] }], lifeFloor (what counted as above) }, or null when nothing is cached.
 */
function wikiSize(subjects, trendStart) {
  const list = subjects.map((s) => (Array.isArray(s) ? { kind: 'person', titles: s } : s));
  const views = list.map((s) => subjectViews(s.titles));
  const kinds = list.map((s) => s.kind).filter((k, i) => views[i]);
  const held = views.filter(Boolean);
  if (!held.length) return null;
  const from = held.map((v) => v.from).sort()[0];
  const to = held.map((v) => v.to).sort()[0];
  // (each page's first view, and its titles': a first view after the first day held is when it began; on that day it says nothing)
  const pages = held.map((v, i) => {
    const seen = v.firsts.filter((f) => f.day).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    return { kind: kinds[i], firstDay: seen.length ? seen[0].day : null, firstKnown: seen.length > 0 && seen[0].known, titleFirstDays: seen.filter((f) => f.known).map((f) => f.day) };
  });
  const pass = (baselines, start) => {
    // (a life chains across 30 days under the floor when every page is the trend's own or a quiet one; a busy person's, a week)
    const quiet = held.every((v, i) => kinds[i] === 'trend' || baselines[i] < FLOOR);
    const lull = quiet ? START_LULL_NEW : START_LULL_EXISTING;
    const excess = new Map();
    for (const d of D.daysBetween(from, to)) excess.set(d, held.reduce((s, v, i) => s + Math.max(0, (v.views.get(d) || 0) - baselines[i]), 0));
    const anchor = anchorOf(excess, trendStart, from, to);
    const floor = Math.max(FLOOR, LIFE_NOISE_SIGMAS * Math.sqrt(held.reduce((q, v, i) => q + (kinds[i] === 'person' ? swingOf(v, start) ** 2 : 0), 0)));
    const life = anchor && (excess.get(anchor) || 0) >= floor ? lifeOf(excess, anchor, from, to, lull, floor) : null;
    return { excess, from, to, life, baselines, newPage: baselines.map((x) => x < FLOOR), pages, lifeFloor: Math.round(floor) };
  };
  // (first: a trend's own page with no baseline, to find where its life began; a person's against the trend's known start)
  let start = trendStart;
  let out = pass(held.map((v, i) => (kinds[i] === 'trend' ? 0 : baselineOf(v, trendStart))), start);
  for (let n = 0; n < BASELINE_PASSES && out.life; n += 1) {
    const ownMoved = kinds.some((k) => k === 'trend') && n === 0;
    if (!ownMoved && out.life.start >= D.addDays(start, -BASELINE_TO)) break;
    start = out.life.start < start ? out.life.start : start;
    out = pass(held.map((v) => baselineOf(v, start)), start);
  }
  return out;
}

/**
 * Whether a subject's earlier history is worth one more fetch (back to the daily series' start): its life reaches the first day held,
 * or a trend's own page was already read on the first day held, so when it began is not known (the chart says it starts at the
 * page: a word's page can begin months before the 400 days held while its life starts inside them).
 */
const wantsEarlier = (wiki) => !!wiki && ((!!wiki.life && wiki.life.atEdge) || (wiki.pages || []).some((p) => p.kind === 'trend' && p.firstDay && !p.firstKnown && wiki.from > DAILY_FROM));

/** The day the first fetch of a subject's history begins: 400 days before the trend, never before the daily series does. */
const historyFrom = (trendStart) => { const d = D.addDays(trendStart, -HISTORY_DAYS); return d < DAILY_FROM ? DAILY_FROM : d; };

/**
 * Pre-July-2015 views from a pagecounts-ez desktop count (crawlers in): the crawler factor applied, then the mobile views put back
 * with the article's mobile share, the project's share that day raised by the odds ratio of viral pages (anchors file, "before2015").
 * Returns views; with { low, high } odds ratios, also the range.
 */
function wikiLegacy(rawDesktop, projectMobileShare, oddsRatio = ANCHORS.unit.before2015.mobileOddsRatio.central) {
  const crawler = ANCHORS.unit.before2015.crawlerFactor;
  const odds = (oddsRatio * projectMobileShare) / (1 - projectMobileShare);
  const share = odds / (1 + odds);
  return (rawDesktop * crawler) / (1 - share);
}

module.exports = { DAILY_FROM, BASELINE_FROM, BASELINE_TO, END_LULL_DAYS, START_LULL_NEW, START_LULL_EXISTING, HISTORY_DAYS, restTitle, parseRest, coveredTo,
  mergeFetch, wantRanges, viewsOn, firstViewOf, subjectViews, baselineOf, swingOf, lifeOf, anchorOf, wikiSize, wantsEarlier, historyFrom, wikiLegacy };
