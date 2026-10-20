'use strict';
/*
 * One number a day from several sources (ios/.review/trend-size-scale.md "One number per day"): each source a wiki-equivalent
 * estimate in log10; a day's value the weighted mean, weight 1/sigma^2; a Wikipedia figure that a calibrated proxy sits more than
 * 2 of its sigmas above is a partial article (sigma 0.6); uncalibrated series rescaled by one factor to the calibrated days they
 * share; a day with nothing interpolated in log space between its neighbours. A gap, a day whose combined sigma is above 0.3, a
 * converted pre-2015 day and a day only an uncalibrated series gives are all `estimated` (drawn dotted). The partial test runs only
 * on days up to the article's own peak: a searches band is a running total that Google holds while it lists the trend, so on a
 * fading day it says nothing of that day (lib/size/tracked.js keeps a band only on the day it first reaches a new level). Pure.
 */
const P = require('./proxies');
const { pctOfLog } = require('./scale');
const D = require('./days');
const { median } = require('../util');

/**
 * One day's estimates -> { log, sigma, basis (the kind that weighs most), partial (the Wikipedia figure was taken as partial),
 * outsideUs (the US searches sit more than 2 of their sigmas under the Wikipedia figure: the attention is mostly elsewhere) }.
 * estimates: [{ kind, log, sigma }], at least one. partialTest: false on a day after the article's own peak (no proxy makes the
 * article partial there).
 */
function combineDay(estimates, { partialTest = true } = {}) {
  const wiki = estimates.find((e) => e.kind === 'wiki');
  const partial = partialTest && !!wiki && estimates.some((e) => e !== wiki && P.CALIBRATED.has(e.kind) && e.kind !== 'wiki-legacy' && e.log - wiki.log > P.PARTIAL_SIGMAS * e.sigma);
  const searches = estimates.find((e) => e.kind === 'searches' && !e.own);
  const outsideUs = !!wiki && !!searches && wiki.log - searches.log > P.PARTIAL_SIGMAS * searches.sigma;
  const es = partial ? estimates.map((e) => (e === wiki ? { ...e, sigma: P.PARTIAL_SIGMA } : e)) : estimates;
  let w = 0;
  let wx = 0;
  let basis = null;
  let top = -1;
  for (const e of es) {
    const we = 1 / (e.sigma * e.sigma);
    w += we;
    wx += we * e.log;
    if (we > top) { top = we; basis = e.kind; }
  }
  return { log: wx / w, sigma: 1 / Math.sqrt(w), basis, partial, outsideUs };
}

/**
 * An uncalibrated series rescaled to the calibrated days it shares: one factor, the median log difference on those days; its sigma is
 * the calibrated days' (median) plus 0.1. series: Map(day -> value > 0); calibrated: Map(day -> { log, sigma }). Returns
 * Map(day -> estimate), or null when no day is shared (shape alone places nothing).
 */
function rescaleShape(kind, series, calibrated) {
  const shared = [...series].filter(([d, v]) => v > 0 && calibrated.has(d));
  if (!shared.length) return null;
  const factor = median(shared.map(([d, v]) => calibrated.get(d).log - Math.log10(v)));
  const sigma = median(shared.map(([d]) => calibrated.get(d).sigma)) + P.SHAPE_EXTRA_SIGMA;
  const out = new Map();
  for (const [d, v] of series) if (v > 0) out.set(d, { kind, log: Math.log10(v) + factor, sigma });
  return out;
}

const push = (map, day, e) => { if (e) map.set(day, [...(map.get(day) || []), e]); };

// the fewest days a proxy and the article must share before the proxy's newer days are placed with the trend's own offset: one shared
// day, read while a story is still breaking, can put a row at the spike ceiling that its later shared days place far lower
const OWN_OFFSET_DAYS = 2;

/**
 * Where a calibrated proxy's days go when the trend has an article. A day the article also covers is combined as it stands (the
 * partial test included). A day it does not cover (the newest, before the article's figure lands) is placed with this trend's own
 * offset between the proxy and the article, the median over the days they share where the article was not partial (OWN_OFFSET_DAYS
 * of them at least): a band of searches holds while the views fall, so the general fit would lift such a day to where the trend once
 * was. Without such days the general fit stands only for a partial article; otherwise the day waits for the article's own figure. peakDay: the article's
 * own peak (a shared day after it is never partial). Returns Map(day -> estimate).
 */
function placeProxy(days, wikiByDay, peakDay = null) {
  const shared = [...days].filter(([d]) => wikiByDay.has(d));
  // (after the article's peak no day is partial: a proxy there is compared as it stands)
  const fair = shared.filter(([d, e]) => (peakDay && d > peakDay) || !(e.log - wikiByDay.get(d).log > P.PARTIAL_SIGMAS * e.sigma));
  const offset = fair.length >= OWN_OFFSET_DAYS ? median(fair.map(([d, e]) => wikiByDay.get(d).log - e.log)) : null;
  const out = new Map();
  for (const [d, e] of days) {
    if (wikiByDay.has(d)) out.set(d, e);
    else if (offset !== null) out.set(d, { ...e, log: e.log + offset, own: true });
    else if (shared.length > fair.length) out.set(d, e);
  }
  return out;
}

/**
 * The daily points of a trend's size over [start, end]. Inputs:
 *   wiki: Map(day -> excess views) or null (the days Wikipedia covers, as lib/size/wiki.js gives them; only days in [start, end] are read);
 *   legacy: Map(day -> converted views) or null (pre-2015 days);
 *   tracked: [{ day, kind, value }] (the collector's own observations: searches, outlets, players are calibrated; wiki-hourly, gdelt,
 *     tiktok-videos and youtube-uploads give shape only).
 * A trend with no article is placed by the proxies' general fits. Returns [{ day, log, sigma, pct, basis, estimated, gap, partial }] in
 * day order, from the first day anything places to the last (never extrapolated past either end).
 */
function combine({ wiki = null, legacy = null, tracked = [], start, end }) {
  const inRange = (d) => d >= start && d <= end;
  const byDay = new Map();
  const wikiByDay = new Map();
  if (wiki) for (const [d, v] of wiki) if (inRange(d)) { const e = P.estimate('wiki', v); wikiByDay.set(d, e); push(byDay, d, e); }
  if (legacy) for (const [d, v] of legacy) if (inRange(d)) { const e = P.estimate('wiki-legacy', v); wikiByDay.set(d, e); push(byDay, d, e); }
  const shapes = new Map();
  const proxies = new Map();
  for (const t of tracked) {
    if (!t || !D.isDay(t.day) || !inRange(t.day)) continue;
    const group = P.SHAPE_ONLY.has(t.kind) ? shapes : proxies;
    if (P.SHAPE_ONLY.has(t.kind)) {
      if (!(t.value > 0)) continue;
      if (!group.has(t.kind)) group.set(t.kind, new Map());
      group.get(t.kind).set(t.day, Math.max(group.get(t.kind).get(t.day) || 0, t.value));
      continue;
    }
    // (a calibrated proxy: a day's largest reading, once)
    const e = P.estimate(t.kind, t.value);
    if (!e) continue;
    if (!group.has(t.kind)) group.set(t.kind, new Map());
    const old = group.get(t.kind).get(t.day);
    if (!old || old.log < e.log) group.get(t.kind).set(t.day, e);
  }
  // (the article's own peak: the day of its largest figure; the partial test stops there)
  let peakDay = null;
  for (const [d, e] of wikiByDay) if (!peakDay || e.log > wikiByDay.get(peakDay).log) peakDay = d;
  const testOn = (d) => ({ partialTest: !peakDay || d <= peakDay });
  for (const days of proxies.values()) for (const [d, e] of (wikiByDay.size ? placeProxy(days, wikiByDay, peakDay) : days)) push(byDay, d, e);
  const first = new Map([...byDay].map(([d, es]) => [d, combineDay(es, testOn(d))]));
  // shape-only series, scaled to the calibrated days they share, then a day's estimates combined again
  const all = new Map(byDay);
  for (const [kind, series] of shapes) {
    const scaled = rescaleShape(kind, series, first);
    if (scaled) for (const [d, e] of scaled) push(all, d, e);
  }
  const days = [...all.keys()].sort();
  if (!days.length) return [];
  const known = new Map(days.map((d) => [d, combineDay(all.get(d), testOn(d))]));
  const out = [];
  let prev = null;
  let k = 0;
  for (const d of D.daysBetween(days[0], days[days.length - 1])) {
    const here = known.get(d);
    if (here) {
      const style = here.basis === 'wiki-legacy' || P.SHAPE_ONLY.has(here.basis);
      out.push({ day: d, log: here.log, sigma: here.sigma, pct: pctOfLog(here.log), basis: here.basis, estimated: here.sigma > P.ESTIMATED_SIGMA || style, gap: false, partial: here.partial, outsideUs: here.outsideUs });
      prev = d;
      k += 1;
      continue;
    }
    // a gap: in log space between the days either side of it
    const next = days[k];
    const a = known.get(prev);
    const b = known.get(next);
    const f = (D.dayNum(d) - D.dayNum(prev)) / (D.dayNum(next) - D.dayNum(prev));
    const log = a.log + f * (b.log - a.log);
    out.push({ day: d, log, sigma: Math.max(a.sigma, b.sigma), pct: pctOfLog(log), basis: a.basis, estimated: true, gap: true, partial: false, outsideUs: false });
  }
  return out;
}

/** Consecutive days of one basis and one style as stretches: [{ from, to, basis (the label), estimated }]. */
function stretchesOf(points) {
  const out = [];
  for (const p of points) {
    const label = P.LABEL[p.basis] || p.basis;
    const last = out[out.length - 1];
    if (last && last.basis === label && last.estimated === p.estimated && D.dayNum(p.day) === D.dayNum(last.to) + 1) out[out.length - 1] = { ...last, to: p.day };
    else out.push({ from: p.day, to: p.day, basis: label, estimated: p.estimated });
  }
  return out;
}

module.exports = { OWN_OFFSET_DAYS, combineDay, rescaleShape, placeProxy, combine, stretchesOf };
