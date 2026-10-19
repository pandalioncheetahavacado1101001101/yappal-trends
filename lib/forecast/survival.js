'use strict';
/*
 * Kaplan-Meier with delayed entry (left truncation) and right censoring, and the residual life it gives at an age: the survival
 * prior of ios/IDEAS-SUPER.md P6. Pure; hours throughout.
 *
 * A record is { entry, exit, event }: watched from age `entry` (0 for a life seen from its start; a trend met after it began enters
 * at its age then), last seen at age `exit`, `event` true when it ended there and false when it was still going (censored).
 * At an age x the risk set is every record with entry < x <= exit; S(x) is the product over event ages t <= x of (1 - d(t) / n(t)).
 * The residual life at age A is read from S(A + r) / S(A): its p-quantile is the smallest r where that falls to 1 - p, and null
 * where the data end first (no tail is invented past the longest life followed).
 */

/** The Kaplan-Meier curve of `records`: { times, surv, atRisk, events, maxExit }, one step per distinct event age, ascending. */
function kaplanMeier(records) {
  const rs = (records || []).filter((r) => Number.isFinite(r.exit) && r.exit > (r.entry || 0));
  const entries = rs.map((r) => r.entry || 0).sort((a, b) => a - b);
  const exits = rs.map((r) => r.exit).sort((a, b) => a - b);
  const deaths = new Map();
  for (const r of rs) if (r.event) deaths.set(r.exit, (deaths.get(r.exit) || 0) + 1);
  const ages = [...deaths.keys()].sort((a, b) => a - b);
  const times = [];
  const surv = [];
  const atRisk = [];
  const events = [];
  let s = 1;
  let iIn = 0;
  let iOut = 0;
  for (const t of ages) {
    // (risk set at t: entered before t, not yet left before t; one that leaves at t is still at risk at t)
    while (iIn < entries.length && entries[iIn] < t) iIn += 1;
    while (iOut < exits.length && exits[iOut] < t) iOut += 1;
    const n = iIn - iOut;
    const d = deaths.get(t);
    if (n <= 0) continue;
    s *= 1 - d / n;
    times.push(t);
    surv.push(s);
    atRisk.push(n);
    events.push(d);
  }
  return { times, surv, atRisk, events, n: rs.length, maxExit: exits.length ? exits[exits.length - 1] : 0 };
}

/** S(x): the share of lives still going at age x. */
function survivalAt(km, x) {
  let lo = 0;
  let hi = km.times.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (km.times[mid] <= x) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at < 0 ? 1 : km.surv[at];
}

/** How many records reached age x (entered by then and lasted at least that long): C7's "comparables" of a trend aged x. */
const reachedAge = (records, x) => (records || []).filter((r) => (r.entry || 0) <= x && r.exit >= x).length;

/**
 * Residual-life quantiles at age `age`: { [p]: hours or null }. null: the curve does not fall that far before the data end (the
 * life followed longest), so that quantile is unknown, never extrapolated. Also { s0 }: S(age); every quantile is null when it is 0.
 */
function residualQuantiles(km, age, ps = [0.25, 0.5, 0.75]) {
  const s0 = survivalAt(km, age);
  const out = { s0 };
  for (const p of ps) {
    out[p] = null;
    if (!(s0 > 0)) continue;
    const bar = s0 * (1 - p) + 1e-12;
    for (let i = 0; i < km.times.length; i++) {
      if (km.times[i] <= age) continue;
      if (km.surv[i] <= bar) { out[p] = km.times[i] - age; break; }
    }
  }
  return out;
}

module.exports = { kaplanMeier, survivalAt, reachedAge, residualQuantiles };
