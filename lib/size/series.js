'use strict';
/*
 * A trend's size over its life (ios/.review/trend-size-scale.md): Wikipedia's part (lib/size/wiki.js) and the collector's own
 * measurements (lib/size/tracked.js) combined day by day (lib/size/combine.js), then read on the one absolute scale
 * (lib/size/scale.js) as attention that lasts:
 *   - the line: each day, the mean of the 7 days around it that lie inside the life (a day inside it with nothing placed counts as
 *     nothing; a day before the life began, or after the last, is no day of it: a page made the day a story broke starts on that
 *     day's own reading, not on a week averaged with days before the page existed). Centred, so a peak stands on its own week, not
 *     the week after it; the ring and the caption are dated by the highest single day inside the peak's week;
 *   - the size (the headline): the best 30-day mean, every window ending inside the life (a live trend reads its size so far);
 *   - a spike (half its own peak day on 3 days or fewer) tops out at the spike ceiling, line and size alike.
 * A row whose only measure is a searches band (a running total, B1) has no days to average: it is one dotted marker. Pure.
 */
const SC = require('./scale');
const C = require('./combine');
const P = require('./proxies');
const D = require('./days');

const { ANCHORS, round1 } = SC;
// the detail's chart: at most this many points; a longer life keeps its first and last day and each stretch's lowest and highest
const FEED_POINTS = 60;
// fewer points, tried in turn, when the detail has less room left under its 6 KB (D4)
const FEED_POINTS_TIGHT = [48, 36, 24, 16];
// a line that never reached this is nothing on the scale: the detail carries no chart of it
const SHOWN_FROM = 1;
// a life that starts this close to its page's first view starts where the page does, not where the trend did
const PAGE_DAYS = 14;
// a page whose first view came after this many days before the trend began was made for the trend (wiki.js takes its baseline there)
const NEW_PAGE_DAYS = 45;
// a talking point sized by a person's page: a life that reaches back this many days or more before the row's own start is the page's,
// an earlier story of the same person (a page made for one story, read for the next a month on), and the chart starts this many
// days before the row did instead. Reviewers, 2026-10-20: "Started 3 days ago" above a chart that began a month before
const STORY_GAP_DAYS = 14;
const STORY_MARGIN_DAYS = 3;
const MONTH = ANCHORS.proxies.find((p) => p.id === 'searches').month;
// what a caption may compare a trend with: every historic anchor and ladder row the anchors file names plainly (`like`), on the size's
// measure (its best 30 days), the anchors first so that on a tie the mega-trends' own names win. Only memes, sounds, games and shows
// carry a `like`: a row that names a person or a person's scandal (an obituary, a celebrity scandal, a streamer's ban, a rivalry of
// two channels) never does, so no caption puts a real person into the detail of a trend that never mentions them (reviewers,
// 2026-10-20: every capped spike, deaths included, was compared with a celebrity's scandal by name)
const REFERENCES = [...ANCHORS.anchors, ...ANCHORS.ladder].filter((r) => typeof r.like === 'string' && Number.isFinite(r.pct)).map((r) => ({ name: r.like, pct: r.pct }));
// the ticks on the chart's right edge: the mega band's edge (Among Us, 95) and its top (Squid Game, 100), as the anchors file sets them
const TICKS = [ANCHORS.scale.band.anchor, ANCHORS.scale.topAnchor].map((id) => ANCHORS.anchors.find((a) => a.id === id)).map((a) => ({ name: a.like || a.short, pct: a.pct }));

/** Each point's views a day (10^log), keyed by day number. */
const viewsByDay = (points) => new Map(points.map((p) => [D.dayNum(p.day), Math.pow(10, p.log)]));

/** The mean of the `n` days to day number `k` (days with no point count as nothing: the size's 30 days, a live trend's so far). */
function meanTo(byDay, k, n) {
  let s = 0;
  for (let i = 0; i < n; i += 1) s += byDay.get(k - i) || 0;
  return s / n;
}

/** The days of the `n`-day window centred on day number `k` that lie inside the life (day numbers `lo` to `hi`). */
function windowOf(k, n, lo, hi) {
  const half = Math.floor(n / 2);
  const out = [];
  for (let i = Math.max(lo, k - half); i <= Math.min(hi, k + n - 1 - half); i += 1) out.push(i);
  return out;
}
/** The line on day number `k`: the mean of its window's days (a day inside the life with no point counts as nothing). */
function meanAround(byDay, k, n, lo, hi) {
  const days = windowOf(k, n, lo, hi);
  return days.length ? days.reduce((sum, i) => sum + (byDay.get(i) || 0), 0) / days.length : 0;
}

/** How many days stood at or above half the highest day. */
function daysAboveHalf(points) {
  const vs = points.map((p) => Math.pow(10, p.log));
  const top = Math.max(...vs);
  return vs.filter((v) => v >= top / 2).length;
}

/**
 * Where the chart's start comes from, given the life's first day `start`: 'page' with the page's first day when the chart cannot
 * reach further back than a page did: one of its titles began within PAGE_DAYS before the life did ("6-7 (meme)" on 2025-08-30, the
 * life on the 31st), or the page was made for the trend (a trend's own page, or a person's whose first view came after the 45 days
 * before the trend began); else 'start' (the trend's own start, which the page's history reaches).
 */
function startOf(wiki, start, trendStart) {
  const k = D.dayNum(start);
  const made = [];
  for (const p of wiki.pages || []) {
    for (const f of p.titleFirstDays || []) if (D.dayNum(f) <= k && k - D.dayNum(f) <= PAGE_DAYS) made.push(f);
    if (!p.firstKnown || !p.firstDay || p.firstDay > start) continue;
    if (p.kind === 'trend' || (trendStart && D.dayNum(p.firstDay) > D.dayNum(trendStart) - NEW_PAGE_DAYS)) made.push(p.firstDay);
  }
  made.sort();
  return made.length ? { from: 'page', fromDay: made[0] } : { from: 'start', fromDay: null };
}

/**
 * A row with nothing but a searches band: one dotted marker on the day the band first reached its top level. A band is the trend's
 * running total, so it is no line; its size is the band's day (the calibrated fit) times the listed rows' median ratio of best month
 * to peak day (lib/data/size-anchors.json, proxies "searches" month).
 */
function markerOf(bands) {
  const top = bands.reduce((a, b) => (b.value > a.value || (b.value === a.value && b.day < a.day) ? b : a));
  const e = P.estimate('searches', top.value);
  const views = Math.pow(10, e.log) * MONTH.ratio;
  const pct = SC.pctOf(views);
  const point = { day: top.day, log: Math.log10(views), sigma: Math.hypot(e.sigma, MONTH.sigma), views, week: views, pct, dayPct: pct, basis: 'searches-total', estimated: true, gap: false, partial: false, outsideUs: false };
  return { points: [point], stretches: C.stretchesOf([point]), peakPct: round1(pct), peakFrom: top.day, peakTo: top.day, spike: false, daysAboveHalf: null,
    lineTopDay: top.day, from: 'tracking', fromDay: top.day, start: top.day, end: top.day, partialDays: [], marker: true };
}

/**
 * One trend's size. Inputs:
 *   wiki: what wikiSize() gave (or null: no article);
 *   tracked: [{ day, kind, value }] (trackedFromSamples / trackedFromDemand);
 *   legacy: Map(day -> converted views) for pre-2015 days, or null;
 *   trendStart: the day the trend began as the collector knows it; today: the UTC day now.
 * Returns null when nothing calibrated places any day (a TikTok-only row: "listed, size not measured"), else
 * { points: [{ day, log, sigma, views, week (the centred 7-day mean), pct (the line, shown), dayPct (that day alone), basis, estimated, gap,
 *   partial, outsideUs }],
 *   stretches, peakPct (the size: best 30-day mean, shown), peakFrom, peakTo (its 30 days, from the life's first day at most),
 *   spike, daysAboveHalf, lineTopDay (the peak's day: the highest single day inside the week the line is highest on), from: 'start' |
 *   'page' | 'tracking', fromDay, start, end, partialDays, marker }. A talking point's person's page whose life began STORY_GAP_DAYS or
 *   more before trendStart is read from STORY_MARGIN_DAYS before it.
 */
function sizeOf({ wiki = null, tracked = [], legacy = null, trendStart, today }) {
  const seen = tracked.filter((t) => t && D.isDay(t.day) && t.day <= today);
  const calibrated = seen.filter((t) => P.CALIBRATED.has(t.kind) && Number.isFinite(t.value) && t.value > 0);
  if (!wiki && !legacy && calibrated.length && calibrated.every((t) => t.kind === 'searches')) return markerOf(calibrated);
  const trackedDays = seen.map((t) => t.day).sort();
  let start;
  let end;
  let from;
  if (wiki && wiki.life) {
    start = wiki.life.start;
    end = wiki.life.ended ? wiki.life.end : today;
    from = 'start';
  } else if (wiki) {
    // (a page that never reached the floor: the trend is measured, and small, from its start)
    start = trendStart > wiki.from ? trendStart : wiki.from;
    end = today;
    from = 'start';
  } else {
    if (!trackedDays.length) return null;
    start = trackedDays[0];
    end = today;
    from = 'tracking';
  }
  let fromDay = from === 'tracking' ? start : null;
  if (wiki && wiki.life) ({ from, fromDay } = startOf(wiki, start, trendStart));
  // (a person's page whose life began weeks before this story did: the chart is the story's, from a few days before it began)
  const personal = wiki && (wiki.pages || []).length > 0 && wiki.pages.every((p) => p.kind === 'person');
  let clipped = false;
  if (personal && wiki.life && D.isDay(trendStart) && D.dayNum(start) <= D.dayNum(trendStart) - STORY_GAP_DAYS) {
    start = D.addDays(trendStart, -STORY_MARGIN_DAYS);
    from = 'start';
    fromDay = null;
    clipped = true;
  }
  // (what the collector saw before or after the article's life still places those days; the chart then starts at tracking)
  if (trackedDays.length && trackedDays[0] < start) { start = trackedDays[0]; from = 'tracking'; fromDay = start; }
  if (trackedDays.length && trackedDays[trackedDays.length - 1] > end) end = trackedDays[trackedDays.length - 1];
  const daily = C.combine({ wiki: wiki ? wiki.excess : null, legacy, tracked: seen, start, end });
  if (!daily.length || !daily.some((p) => P.CALIBRATED.has(p.basis))) return null;
  const above = daysAboveHalf(daily);
  const spike = SC.isSpike(above);
  const byDay = viewsByDay(daily);
  const estimatedDays = new Set(daily.filter((p) => p.estimated).map((p) => D.dayNum(p.day)));
  const firstK = D.dayNum(daily[0].day);
  const lastK = D.dayNum(daily[daily.length - 1].day);
  // (the first day a week around a day may reach back to: a page that stood before the life began was read at its baseline then, so
  // those days count as nothing; one made for the trend did not exist before its first view, nor does anything before the collector
  // met a row it alone measures, nor an earlier story of a person's page the chart was cut from)
  const lo = from === 'tracking' || clipped ? firstK : from === 'page' && fromDay ? Math.min(firstK, D.dayNum(fromDay)) : -Infinity;
  let best = { mean: -1, k: null };
  let lineTop = { mean: -1, k: null };
  const points = daily.map((p) => {
    const k = D.dayNum(p.day);
    const week = meanAround(byDay, k, SC.LINE_DAYS, lo, lastK);
    const month = meanTo(byDay, k, SC.SIZE_DAYS);
    if (month > best.mean) best = { mean: month, k };
    if (week > lineTop.mean) lineTop = { mean: week, k };
    const estimated = windowOf(k, SC.LINE_DAYS, lo, lastK).some((i) => estimatedDays.has(i));
    return { ...p, views: Math.pow(10, p.log), dayPct: p.pct, week, pct: SC.shown(SC.pctOf(week), spike), estimated };
  });
  // (the peak's day: the highest single day inside the week the line is highest on, the first of equals. A spike is dated by the day
  // it broke, not by the middle of the week it leaves behind)
  const peakK = windowOf(lineTop.k, SC.LINE_DAYS, lo, lastK).filter((i) => byDay.has(i)).reduce((a, i) => (a === null || byDay.get(i) > byDay.get(a) ? i : a), null);
  return { points, stretches: C.stretchesOf(points), peakPct: round1(SC.shown(SC.pctOf(best.mean), spike)), peakFrom: D.dayOf(Math.max(firstK, best.k - SC.SIZE_DAYS + 1)),
    peakTo: D.dayOf(best.k), spike, daysAboveHalf: above, lineTopDay: D.dayOf(peakK === null ? lineTop.k : peakK), from, fromDay, start: points[0].day, end: points[points.length - 1].day,
    partialDays: points.filter((p) => p.partial).map((p) => p.day), marker: false };
}

/**
 * The points the detail carries: every day up to `max` of them. A longer life keeps its first day and its last, and between them
 * equal stretches, each by its lowest and its highest day (the peak is always one of them, and so is every fall). A kept point
 * stands for the days nearest it, and is estimated when any of them is.
 */
function thin(points, max = FEED_POINTS) {
  if (points.length <= max) return points;
  const inner = points.slice(1, -1);
  const buckets = Math.max(1, Math.floor((max - 2) / 2));
  const size = inner.length / buckets;
  const out = [points[0]];
  for (let b = 0; b < buckets; b += 1) {
    const lo = Math.round(b * size);
    const hi = Math.round((b + 1) * size);
    if (hi <= lo) continue;
    // (by the line's own level where it is known: a capped or clamped line reads the same on many days)
    const level = (q) => (Number.isFinite(q.week) ? q.week : q.pct);
    let low = lo;
    let high = lo;
    for (let i = lo; i < hi; i += 1) {
      if (level(inner[i]) < level(inner[low])) low = i;
      if (level(inner[i]) > level(inner[high])) high = i;
    }
    const kept = low === high ? [low] : [Math.min(low, high), Math.max(low, high)];
    // (the days each kept point stands for: from the bucket's start, or the midpoint after the point before, to the next midpoint)
    kept.forEach((i, j) => {
      const a = j === 0 ? lo : Math.floor((kept[0] + kept[1]) / 2) + 1;
      const z = j === kept.length - 1 ? hi - 1 : Math.floor((kept[0] + kept[1]) / 2);
      out.push({ ...inner[i], estimated: inner.slice(a, z + 1).some((p) => p.estimated) });
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * The published reference nearest a size (the first of equals), on the same side of the mega band's edge as the size where one is
 * (a spike capped at 92 is compared with the biggest trend under the band, never called "about Among Us size"), or null.
 */
function nearestReference(pct) {
  const side = REFERENCES.filter((r) => (r.pct >= SC.BAND) === (pct >= SC.BAND));
  let best = null;
  for (const r of side.length ? side : REFERENCES) if (!best || Math.abs(r.pct - pct) < Math.abs(best.pct - pct)) best = r;
  return best;
}

/** The detail's reference marks for a size: the two ticks, and the published reference nearest it (once), lowest first. */
function bandFor(pct) {
  const near = nearestReference(pct);
  return [...TICKS, ...(near && !TICKS.some((x) => x.name === near.name) ? [near] : [])].sort((a, b) => a.pct - b.pct);
}

/**
 * The detail field (D4 `size`): { series: [{ day, pct, estimated? }], sizePct, peakDay, kind: 'spike' | 'sustained', from: 'start' |
 * 'tracking', band: [{ name, pct }] }, or null: for a row nothing calibrated measures, for one dotted marker (a searches band alone is no
 * line), and for a line that never reached SHOWN_FROM. `series` is the line (the centred 7-day mean), at most `maxPoints`
 * of it thinned so the rise, the peak and every fall stay; a point carries `estimated: true` only when it is (absent is false: the
 * detail is 6 KB at most). `sizePct` is the size (the best 30 days); `peakDay` the peak's day, always one of the points; `kind` whether it was a
 * spike (its size and line stop at the spike ceiling); `from` "tracking" when nothing reaches back past the collector's own first
 * sight of it. `band`: the ticks (the mega band's edge and top) and the published reference nearest the size, for the caption.
 */
function feedField(size, { maxPoints = FEED_POINTS } = {}) {
  if (!size || size.marker) return null;
  const kept = thin(size.points, maxPoints);
  // (the ring's day is always one of the points: thinning keeps each stretch's highest line, which a spike's own day need not be)
  const peak = size.points.find((p) => p.day === size.lineTopDay);
  const series = (peak && !kept.some((p) => p.day === peak.day) ? [...kept, peak].sort((a, b) => (a.day < b.day ? -1 : 1)) : kept)
    .map((p) => ({ day: p.day, pct: round1(p.pct), ...(p.estimated ? { estimated: true } : {}) }));
  if (series.length < 2 || Math.max(...series.map((p) => p.pct)) < SHOWN_FROM) return null;
  return { series, sizePct: size.peakPct, peakDay: size.lineTopDay, kind: size.spike ? 'spike' : 'sustained', from: size.from === 'tracking' ? 'tracking' : 'start', band: bandFor(size.peakPct) };
}

/** The field in `bytes` or fewer (as JSON): FEED_POINTS points, else fewer, else null (the detail stands without it). */
function feedFieldWithin(size, bytes) {
  for (const n of [FEED_POINTS, ...FEED_POINTS_TIGHT]) {
    const field = feedField(size, { maxPoints: n });
    if (!field) return null;
    if (Buffer.byteLength(JSON.stringify(field)) <= bytes) return field;
  }
  return null;
}

/**
 * A field already made (feedField's, kept in the state) in `bytes` or fewer: its own points thinned to FEED_POINTS and fewer in turn,
 * its peak day always one of them; else null.
 */
function fieldWithin(field, bytes) {
  if (!field || !Array.isArray(field.series)) return null;
  for (const n of [FEED_POINTS, ...FEED_POINTS_TIGHT]) {
    const kept = thin(field.series, n);
    const peak = field.series.find((p) => p.day === field.peakDay);
    const series = (peak && !kept.some((p) => p.day === peak.day) ? [...kept, peak].sort((a, b) => (a.day < b.day ? -1 : 1)) : kept)
      .map((p) => ({ day: p.day, pct: p.pct, ...(p.estimated ? { estimated: true } : {}) }));
    const out = { ...field, series };
    if (Buffer.byteLength(JSON.stringify(out)) <= bytes) return out;
  }
  return null;
}

module.exports = { FEED_POINTS, FEED_POINTS_TIGHT, SHOWN_FROM, PAGE_DAYS, STORY_GAP_DAYS, STORY_MARGIN_DAYS, REFERENCES, TICKS, sizeOf, thin, feedField, feedFieldWithin, fieldWithin, nearestReference, bandFor, daysAboveHalf };
