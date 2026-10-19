'use strict';
/*
 * Scoring forecasts whose outcomes are censored (ios/IDEAS-SUPER.md P6, the forecast row of the scoreboard). Pure; hours throughout.
 *
 * A case is { key, cls, age, exact (hours it had left: it ended) or censoredAt (hours it was followed and still going), followUp
 * (hours it could have been followed, whatever happened: the newest snapshot that could still show it) } plus what each method said.
 *
 * Inverse probability of censoring weights: a score that needs the outcome up to a horizon h (within +-50%: h = 2x the forecast;
 * inside the interval: its upper quartile; an error of at most e: forecast + e; still on at w hours: w) is known when the search
 * ended first or was followed past h, and each known score counts 1 / G(min(left, h)), G(x) the share of cases followed at least
 * x. Dropping the unknown ones instead drops the long lives and flatters every forecast (`naive` shows by how much).
 *
 * The gate (C7 as amended, awaiting the owner) is read on the real design alone: a landmark back-test classes most searches by a
 * volume read after the moment, so it is a diagnostic and never opens a class. It counts distinct keywords, once across countries
 * (one search is forecast every 6 hours and in up to four countries: 30 forecasts can be a handful of searches), and each threshold
 * must hold at the edge of a 95% interval bootstrapped by keyword, not only at its point.
 */

const ERROR_STEP = 0.25;
const ERROR_MAX = 400;
const CHANCE_HOURS = 24;
const CHANCE_BINS = [0, 0.2, 0.4, 0.6, 0.8, 1.000001];
const GATE = { maxMedianError: 8, minWithin50: 0.5, iqr: [0.4, 0.6], minKeywords: 30, design: 'real', confidence: 0.95, resamples: 400, seed: 20261020 };
// (the scoreboard's forecast row: "with 72 h follow-up". A forecast that could not be followed that far is not scored: weights
// alone cannot carry a long life from the few moments followed for days onto the many followed for hours)
const MIN_FOLLOW_UP = 72;

/** G(x): the share of cases followed at least x hours. */
function followedShare(cases) {
  const fu = cases.map((c) => c.followUp).sort((a, b) => a - b);
  return (x) => {
    let lo = 0;
    let hi = fu.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (fu[mid] < x) lo = mid + 1; else hi = mid; }
    return fu.length ? (fu.length - lo) / fu.length : 0;
  };
}
/** Each case's known outcome up to horizon h: { left (Infinity: past h), weight } or null when it is not known that far. */
function knownTo(c, h, G) {
  if (!Number.isFinite(h)) return null;
  let left;
  let d;
  if (c.exact !== null && c.exact !== undefined) { left = c.exact; d = Math.min(c.exact, h); } else if (c.censoredAt >= h) { left = Infinity; d = h; } else return null;
  const g = G(d);
  return g > 0 ? { left, weight: 1 / g } : null;
}
/** The weighted mean of value(left, case) over the known cases: { mean, known } or null. */
function weightedMean(cases, G, horizonOf, value) {
  let num = 0;
  let den = 0;
  let known = 0;
  for (const c of cases) {
    const k = knownTo(c, horizonOf(c), G);
    if (!k) continue;
    known += 1;
    den += k.weight;
    num += k.weight * value(k.left, c);
  }
  return den > 0 ? { mean: num / den, known } : null;
}
/** Median absolute error of pred(case): the smallest e (on a quarter-hour grid) with the weighted share within e at 0.5 or more. */
function medianError(cases, G, pred) {
  for (let e = 0; e <= ERROR_MAX; e += ERROR_STEP) {
    const s = weightedMean(cases, G, (c) => pred(c) + e, (left, c) => (Math.abs(left - pred(c)) <= e ? 1 : 0));
    if (s && s.mean >= 0.5) return e;
  }
  return null;
}
/** A point forecast's scores: { n, known (for +-50%), medianError, within50, iqrCover }. pred(case): hours; q(case): [q25, q75] or null. */
function pointScores(cases, G, pred, q = null) {
  const xs = cases.filter((c) => Number.isFinite(pred(c)));
  const within = weightedMean(xs, G, (c) => 2 * pred(c), (left, c) => (left >= pred(c) / 1.5 && left <= 2 * pred(c) ? 1 : 0));
  const inQ = q ? xs.filter((c) => { const v = q(c); return v && Number.isFinite(v[0]) && Number.isFinite(v[1]); }) : [];
  const iqr = inQ.length ? weightedMean(inQ, G, (c) => q(c)[1], (left, c) => (left >= q(c)[0] && left <= q(c)[1] ? 1 : 0)) : null;
  return { n: xs.length, known: within ? within.known : 0, medianError: xs.length ? medianError(xs, G, pred) : null, within50: within ? within.mean : null, iqrCover: iqr ? iqr.mean : null };
}
/** The same scores as a back-test that drops every censored case and weighs the rest alike would give (the bias, shown). */
function naiveScores(cases, pred, q) {
  const xs = cases.filter((c) => c.exact !== null && c.exact !== undefined && Number.isFinite(pred(c)));
  if (!xs.length) return { n: 0, medianError: null, within50: null, iqrCover: null };
  const errs = xs.map((c) => Math.abs(c.exact - pred(c))).sort((a, b) => a - b);
  const mid = errs.length % 2 ? errs[(errs.length - 1) / 2] : (errs[errs.length / 2 - 1] + errs[errs.length / 2]) / 2;
  const share = (f) => xs.filter(f).length / xs.length;
  return { n: xs.length, medianError: mid, within50: share((c) => c.exact >= pred(c) / 1.5 && c.exact <= 2 * pred(c)),
    iqrCover: q ? share((c) => { const v = q(c); return v && c.exact >= v[0] && c.exact <= v[1]; }) : null };
}
/**
 * The chance forecast's scores: { n, known, brier, climateBrier, skill (1 - brier / climate's), bins: [{ from, to, n, said, seen }] }.
 * chance(case) and climate(case): the chance it is still on CHANCE_HOURS from now.
 */
function chanceScores(cases, G, chance, climate, hours = CHANCE_HOURS) {
  const xs = cases.filter((c) => Number.isFinite(chance(c)) && Number.isFinite(climate(c)));
  const on = (left) => (left > hours ? 1 : 0);
  const b = weightedMean(xs, G, () => hours, (left, c) => (chance(c) - on(left)) ** 2);
  const bc = weightedMean(xs, G, () => hours, (left, c) => (climate(c) - on(left)) ** 2);
  const bins = [];
  for (let i = 0; i < CHANCE_BINS.length - 1; i++) {
    const inBin = xs.filter((c) => chance(c) >= CHANCE_BINS[i] && chance(c) < CHANCE_BINS[i + 1]);
    const said = weightedMean(inBin, G, () => hours, (left, c) => chance(c));
    const seen = weightedMean(inBin, G, () => hours, (left) => on(left));
    bins.push({ from: CHANCE_BINS[i], to: Math.min(1, CHANCE_BINS[i + 1]), n: inBin.length, said: said ? said.mean : null, seen: seen ? seen.mean : null });
  }
  return { n: xs.length, known: b ? b.known : 0, brier: b ? b.mean : null, climateBrier: bc ? bc.mean : null, skill: b && bc && bc.mean > 0 ? 1 - b.mean / bc.mean : null, bins };
}

const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : 'n/a');
/** A case's search, once across countries: its keyword as typed, in lower case (a case with none falls back to its key). */
const keywordOf = (c) => String(c.keyword ?? c.key ?? '').trim().toLowerCase();
/** The distinct keywords among cases. */
const keywordsOf = (cases) => new Set(cases.map(keywordOf).filter(Boolean)).size;
/** A seeded uniform draw in [0, 1) (mulberry32): the same cases give the same interval every run. */
function uniforms(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The q-quantile of numbers (linear between order statistics), or null with none. */
function quantile(xs, q) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (v.length - 1) * q;
  const lo = Math.floor(at);
  return v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * (at - lo);
}
/**
 * A point forecast's three scores with a bootstrap interval, resampled by keyword (every forecast of a drawn keyword comes with it,
 * so the searches forecast many times weigh as one search): { medianError: [lo, hi], within50: [lo, hi], iqrCover: [lo, hi] }, or
 * null with no keyword. G stays the one fitted on every case.
 */
function keywordInterval(cases, G, pred, q, { resamples = GATE.resamples, confidence = GATE.confidence, seed = GATE.seed } = {}) {
  const by = new Map();
  for (const c of cases) { const k = keywordOf(c); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
  const groups = [...by.keys()].sort().map((k) => by.get(k));
  if (!groups.length) return null;
  const u = uniforms(seed);
  const draws = { medianError: [], within50: [], iqrCover: [] };
  for (let r = 0; r < resamples; r++) {
    const sample = [];
    for (let i = 0; i < groups.length; i++) sample.push(...groups[Math.floor(u() * groups.length)]);
    const s = pointScores(sample, G, pred, q);
    for (const k of Object.keys(draws)) draws[k].push(s[k]);
  }
  const tail = (1 - confidence) / 2;
  const edge = (xs) => [quantile(xs, tail), quantile(xs, 1 - tail)];
  return { medianError: edge(draws.medianError), within50: edge(draws.within50), iqrCover: edge(draws.iqrCover) };
}
/** What the gate misses before its interval is read: the design, the keywords, the three thresholds at their points, the baselines. */
function pointMisses(row) {
  const m = row.model;
  const why = [];
  if (row.design !== GATE.design) why.push(`${row.design || 'an unnamed'} design: a diagnostic, never a gate`);
  if (!(row.keywords >= GATE.minKeywords)) why.push(`${row.keywords ?? 0} keywords`);
  if (!(m.medianError <= GATE.maxMedianError)) why.push(`median error ${m.medianError} h`);
  if (!(m.within50 >= GATE.minWithin50)) why.push(`${pct(m.within50)} within +-50%`);
  if (!(m.iqrCover >= GATE.iqr[0] && m.iqrCover <= GATE.iqr[1])) why.push(`interval held ${pct(m.iqrCover)}`);
  for (const b of ['plain', 'climate']) {
    const s = row[b];
    if (!s || !(m.medianError < s.medianError) || !(m.within50 > s.within50)) why.push(`does not beat ${b}`);
  }
  return why;
}
/**
 * Whether a class passes the P6 gate: the real design; at least GATE.minKeywords distinct keywords, each followed 72 h; the three
 * thresholds at their points and at the far edge of their 95% keyword interval (`row.ci`); better than the plain baseline and
 * climatology on both error and the +-50% share. "Within +-50%": the life it had left is between two-thirds of the forecast and
 * twice it (the forecast within 50% of the actual).
 */
function gateOf(row) {
  const why = pointMisses(row);
  if (!why.length) {
    const ci = row.ci;
    if (!ci) why.push('no 95% interval');
    else {
      if (!(ci.medianError[1] <= GATE.maxMedianError)) why.push(`median error up to ${ci.medianError[1]} h at 95%`);
      if (!(ci.within50[0] >= GATE.minWithin50)) why.push(`${pct(ci.within50[0])} within +-50% at 95%`);
      if (!(ci.iqrCover[0] >= GATE.iqr[0] && ci.iqrCover[1] <= GATE.iqr[1])) why.push(`interval held ${pct(ci.iqrCover[0])} to ${pct(ci.iqrCover[1])} at 95%`);
    }
  }
  return { pass: why.length === 0, why };
}

const METHODS = {
  model: { pred: (c) => c.model.shown, q: (c) => [c.model.q25, c.model.q75] },
  modelRaw: { pred: (c) => c.model.raw, q: null },
  plain: { pred: (c) => (c.plain ? c.plain.median : NaN), q: (c) => (c.plain ? [c.plain.q25, c.plain.q75] : null) },
  typical: { pred: (c) => (c.typical ? c.typical.median : NaN), q: null },
  climate: { pred: (c) => c.climate.median, q: (c) => [c.climate.q25, c.climate.q75] },
};

/**
 * Scores per class and for all classes together: [{ cls, design, cases, shown, searches, keywords, hidden: { reason: n }, exact,
 * censored, model, modelRaw, plain, typical, climate (the baselines scored on the model's shown cases), naive, chance, ci (the
 * model's keyword interval: only on the real design, for a class that passes at its points), gate }]. Only forecasts followed
 * `minFollowUp` hours or more are scored, and G is fitted on all of those. design: 'real' (volume as read at the moment: the one
 * the gate reads), 'landmark' or any other name (a diagnostic).
 */
function report(allForecasts, { minFollowUp = MIN_FOLLOW_UP, design = GATE.design, interval = {} } = {}) {
  const forecasts = allForecasts.filter((c) => c.followUp >= minFollowUp);
  const G = followedShare(forecasts);
  const classes = [...new Set(forecasts.map((c) => c.cls).filter(Boolean))].sort();
  const rowOf = (cls, xs) => {
    const shown = xs.filter((c) => !c.model.hidden);
    const hidden = {};
    for (const c of xs) if (c.model.hidden) hidden[c.model.hidden] = (hidden[c.model.hidden] || 0) + 1;
    const row = { cls, design, cases: xs.length, shown: shown.length, searches: new Set(shown.map((c) => c.key)).size, keywords: keywordsOf(shown), hidden,
      exact: shown.filter((c) => c.exact !== null).length, censored: shown.filter((c) => c.exact === null).length };
    for (const [name, m] of Object.entries(METHODS)) row[name] = pointScores(shown, G, m.pred, m.q);
    row.naive = naiveScores(shown, METHODS.model.pred, METHODS.model.q);
    row.chance = chanceScores(xs, G, (c) => (c.chance ? c.chance.p : NaN), (c) => (c.chance ? c.chance.climate : NaN));
    // (the interval costs a few hundred re-scorings: drawn only where it can still decide the gate)
    row.ci = pointMisses(row).length ? null : keywordInterval(shown, G, METHODS.model.pred, METHODS.model.q, interval);
    return { ...row, gate: gateOf(row) };
  };
  const rows = classes.map((cls) => rowOf(cls, forecasts.filter((c) => c.cls === cls)));
  rows.push(rowOf('all', forecasts.filter((c) => c.cls)));
  return rows;
}

module.exports = { GATE, MIN_FOLLOW_UP, CHANCE_HOURS, followedShare, knownTo, weightedMean, medianError, pointScores, naiveScores, chanceScores, keywordOf, keywordsOf, keywordInterval, quantile, gateOf, report, METHODS };
