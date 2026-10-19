'use strict';
/*
 * The survival prior of ios/IDEAS-SUPER.md P6 and the baselines it must beat. Pure; hours throughout.
 *
 * Class = Trends group (lib/forecast/gt.js: pop, sports, other) x the search's volume band NOW (5K+, 20K+, 100K+: the 100K line is
 * C7's own small/big, measure.K.BIG_SEARCH). A search under 5K lives a few hours and is never forecast. Where a class has too few
 * lives at the trend's age (MIN_AT_RISK) its band across all groups stands in ("per kind where n allows"); where that has too few
 * too, there is no forecast.
 *
 * The forecast at age A is the Kaplan-Meier residual life at A (lib/forecast/survival.js): its median is the number, its quartiles
 * the interval. It is shown under C7's hide rules as they apply to a search: under 2 hours old, under 6 hours left, the middle half
 * wider than 1.5x the median, or a quartile past the data, and it is rounded as the feed rounds (measure.roundLeft).
 *
 * The baselines: "plain residual life" is C7 as written today (ended comparables of the class that lived at least A, the median of
 * what they had left: censored lives dropped, so it leans short); "typical life minus age" is the rule C7 bans (J2); "climatology"
 * is what no forecast amounts to, one constant for every trend: the pooled residual life at 2 hours of every class.
 */
const M = require('../measure');
const { HOUR, median } = require('../util');
const SV = require('./survival');

const BANDS = [{ id: '5K', min: 5000 }, { id: '20K', min: 20000 }, { id: '100K', min: M.K.BIG_SEARCH }];
const MIN_AT_RISK = 30;
const LEFT = { minAge: M.K.LEFT_MIN_AGE / HOUR, minLeft: M.K.LEFT_MIN, spread: M.K.LEFT_SPREAD, comparables: M.K.LEFT_COMPARABLES, max: M.K.LEFT_MAX };

/** A volume's band id, or null under the lowest. */
function bandOf(volume) {
  let out = null;
  for (const b of BANDS) if ((volume || 0) >= b.min) out = b.id;
  return out;
}
/** A search's class ("pop/20K"), or null when its volume is under every band. */
const classOf = ({ group, volume }) => { const b = bandOf(volume); return b ? `${group}/${b}` : null; };
const pooledOf = (cls) => `*/${cls.split('/')[1]}`;

/**
 * The prior from survival records ({ group, volume, entry, exit, event }): { strata: Map(name -> { records, km }), all }. A record
 * is filed by the volume it carries (a life that ended: its final volume; one still going: its volume when last read).
 */
function fitPrior(records) {
  const groups = new Map();
  const add = (name, r) => { if (!groups.has(name)) groups.set(name, []); groups.get(name).push(r); };
  const eligible = [];
  for (const r of records || []) {
    const cls = classOf(r);
    if (!cls) continue;
    eligible.push(r);
    add(cls, r);
    add(pooledOf(cls), r);
  }
  const strata = new Map([...groups].map(([name, rs]) => [name, { records: rs, km: SV.kaplanMeier(rs) }]));
  return { strata, all: { records: eligible, km: SV.kaplanMeier(eligible) } };
}

/** The stratum a trend of class `cls` aged `age` is forecast from: its class, else its band pooled; null when neither has MIN_AT_RISK lives at that age. */
function stratumFor(prior, cls, age) {
  for (const name of [cls, pooledOf(cls)]) {
    const s = prior.strata.get(name);
    if (!s) continue;
    const atRisk = SV.reachedAge(s.records, age);
    if (atRisk >= MIN_AT_RISK) return { name, atRisk, ...s };
  }
  return null;
}

/**
 * The model's forecast for a search ({ group, volume, age }: age in hours): { cls, stratum, atRisk, median, q25, q75 }, or
 * { cls, hidden } when there is none to make (`small`: under every band; `thin`: too few lives at that age).
 */
function forecastOf(prior, { group, volume, age }) {
  const cls = classOf({ group, volume });
  if (!cls) return { cls: null, hidden: 'small' };
  const s = stratumFor(prior, cls, age);
  if (!s) return { cls, hidden: 'thin' };
  const q = SV.residualQuantiles(s.km, age);
  return { cls, stratum: s.name, atRisk: s.atRisk, median: q[0.5], q25: q[0.25], q75: q[0.75] };
}

/**
 * What the card would say: { shown (hours, rounded as the feed sends them) } or { hidden: reason }, by C7's rules as they apply to
 * a search's forecast. fc: { median, q25, q75, atRisk }; age in hours.
 */
function shownOf(fc, age) {
  if (!fc || fc.hidden) return { hidden: fc ? fc.hidden : 'none' };
  if (age < LEFT.minAge) return { hidden: 'young' };
  if (!(fc.atRisk >= LEFT.comparables)) return { hidden: 'comparables' };
  if (![fc.median, fc.q25, fc.q75].every(Number.isFinite)) return { hidden: 'tail' };
  if (fc.q75 - fc.q25 > LEFT.spread * fc.median) return { hidden: 'spread' };
  if (fc.median < LEFT.minLeft) return { hidden: 'short' };
  return { shown: M.roundLeft(Math.min(fc.median, LEFT.max)) };
}

/** measure.timeLeft's own quantile of a sorted list. */
const quantileOf = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

/** "Plain residual life", C7 as written: ended lives of the stratum that lasted at least `age`, what they had left. { median, q25, q75, n } or null. */
function plainResidual(records, age) {
  const left = (records || []).filter((r) => r.event && r.exit >= age).map((r) => r.exit - age).sort((a, b) => a - b);
  if (!left.length) return null;
  return { median: median(left), q25: quantileOf(left, 0.25), q75: quantileOf(left, 0.75), n: left.length };
}
/** "Typical life minus age", the rule C7 bans: the stratum's median ended life less the age (never under 0). */
function typicalMinusAge(records, age) {
  const lives = (records || []).filter((r) => r.event).map((r) => r.exit);
  if (!lives.length) return null;
  return { median: Math.max(0, median(lives) - age), q25: null, q75: null, n: lives.length };
}
/** "Climatology": one constant for every trend, the pooled residual life at C7's youngest age, from every class's lives. */
function climatology(prior) {
  const q = SV.residualQuantiles(prior.all.km, LEFT.minAge);
  return { median: q[0.5], q25: q[0.25], q75: q[0.75], n: prior.all.records.length };
}

/**
 * The other way to say it (the C7 amendment's option B): the chance a search aged `age` is still trending `hours` from now,
 * S(age + hours) / S(age) of its stratum: { p, stratum, atRisk } or null where there is no stratum or the curve ends first.
 */
function chanceStillOn(prior, { group, volume, age }, hours) {
  const cls = classOf({ group, volume });
  if (!cls || age < LEFT.minAge) return null;
  const s = stratumFor(prior, cls, age);
  if (!s || s.km.maxExit < age + hours) return null;
  const s0 = SV.survivalAt(s.km, age);
  return s0 > 0 ? { p: SV.survivalAt(s.km, age + hours) / s0, stratum: s.name, atRisk: s.atRisk } : null;
}
/** The same chance from every class pooled at C7's youngest age: one number for every trend, what no forecast amounts to. */
function climatologyChance(prior, hours) {
  const s0 = SV.survivalAt(prior.all.km, LEFT.minAge);
  return s0 > 0 ? SV.survivalAt(prior.all.km, LEFT.minAge + hours) / s0 : null;
}

module.exports = { BANDS, MIN_AT_RISK, LEFT, bandOf, classOf, pooledOf, fitPrior, stratumFor, forecastOf, shownOf, plainResidual, typicalMinusAge, climatology, chanceStillOn, climatologyChance };
