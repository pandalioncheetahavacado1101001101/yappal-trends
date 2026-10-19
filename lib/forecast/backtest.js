'use strict';
/*
 * The back-test of ios/IDEAS-SUPER.md P6: forecasts made at moments in the past from what was known then, scored against how each
 * search went on (lib/forecast/score.js). Pure; hours in the cases, seconds in the moments.
 *
 * Two designs, both out of time (the prior at a moment is fitted only on what was known by that moment):
 *   real      every snapshot is a moment (one per country every 6 hours at most): each search live in it is forecast from its
 *             age and its volume as read then, and scored by its newest reading since (ended there, or still going: censored).
 *             Honest about volume; most moments are followed for under a day.
 *   landmark  moments every 6 hours inside a later snapshot's 168 hours, 72 to 144 hours before it: each search live then (by
 *             that snapshot's ends) is forecast and scored by that snapshot. Many more forecasts followed for days, but a search's
 *             volume at the moment is known only where an earlier snapshot read it; else its later volume stands in
 *             (`volumeSeen: later`), which flatters the classes by size. A diagnostic: the gate reads the real design alone.
 */
const { HOUR } = require('../util');
const GT = require('./gt');
const P = require('./prior');
const SC = require('./score');

const ORIGIN_APART = 6 * HOUR;
const LANDMARK_STEP = 6 * HOUR;
const LANDMARK_MIN_FOLLOW = 72 * HOUR;
const LANDMARK_SPAN = 72 * HOUR;
const CLUSTER_GAP = 48 * HOUR;

// ---------- moments ----------
/** One moment per country every `apart` seconds at most, from the snapshots' times ({ US: [at, ...] }): [{ geo, at }]. */
function realOrigins(times, apart = ORIGIN_APART) {
  const out = [];
  for (const geo of Object.keys(times).sort()) {
    let last = -Infinity;
    for (const at of times[geo]) if (at - last >= apart) { out.push({ geo, at }); last = at; }
  }
  return out;
}
/** The last snapshot of each run of a country's snapshots (a gap over CLUSTER_GAP ends a run): what landmarks are scored by. */
function clusterEnds(times, gap = CLUSTER_GAP) {
  const out = [];
  for (const geo of Object.keys(times).sort()) {
    const ts = times[geo];
    ts.forEach((at, i) => { if (i === ts.length - 1 || ts[i + 1] - at > gap) out.push({ geo, at }); });
  }
  return out;
}
/** The landmark moments a later snapshot (`end`: { geo, at }) scores: [{ geo, at, scoredBy }]. */
function landmarksOf(end) {
  const out = [];
  for (let at = end.at - LANDMARK_MIN_FOLLOW; at >= end.at - LANDMARK_MIN_FOLLOW - LANDMARK_SPAN; at -= LANDMARK_STEP) out.push({ geo: end.geo, at, scoredBy: end.at });
  return out;
}

// ---------- cases ----------
const caseOf = (e, origin, outcome) => ({ key: e.key, keyword: e.keyword, geo: origin.geo, at: origin.at, group: e.group, age: (origin.at - e.start) / HOUR, ...outcome });

/**
 * Real moment: every search live in the snapshot taken at the moment, its outcome from its newest reading since. volume: 'then'
 * (as read at the moment: the design) or 'final' (its newest volume: only to measure how much the landmark design is flattered).
 */
function realCases(entries, times, origin, { volume = 'then' } = {}) {
  const out = [];
  for (const e of entries) {
    if (e.geo !== origin.geo || e.start >= origin.at) continue;
    const now = GT.readingAt(e, origin.at);
    if (!now || now.at !== origin.at || now.end !== null) continue;
    const last = GT.lastReading(e);
    const horizon = GT.horizonOf(e, times);
    if (last.at <= origin.at || !Number.isFinite(horizon)) continue;
    const ended = last.end !== null;
    out.push(caseOf(e, origin, { volume: volume === 'final' ? last.volume : now.volume, volumeSeen: volume === 'final' ? 'later' : 'then',
      exact: ended ? Math.max(0, (last.end - origin.at) / HOUR) : null, censoredAt: ended ? null : (last.at - origin.at) / HOUR, followUp: (horizon - origin.at) / HOUR }));
  }
  return out;
}
/** Landmark moment: every search in the later snapshot that began before the moment and had not ended by it. */
function landmarkCases(entries, origin) {
  const out = [];
  for (const e of entries) {
    if (e.geo !== origin.geo || e.start >= origin.at) continue;
    const later = GT.readingAt(e, origin.scoredBy);
    if (!later || later.at !== origin.scoredBy) continue;
    if (later.end !== null && later.end <= origin.at) continue;
    const then = GT.readingAt(e, origin.at);
    const live = !!then && then.end === null;
    out.push(caseOf(e, origin, { volume: live ? then.volume : later.volume, volumeSeen: live ? 'then' : 'later',
      exact: later.end !== null ? (later.end - origin.at) / HOUR : null, censoredAt: later.end !== null ? null : (later.at - origin.at) / HOUR,
      followUp: (origin.scoredBy - origin.at) / HOUR }));
  }
  return out;
}

// ---------- what each method says ----------
/**
 * Each case with what every method said: { ...case, cls, model: { raw, shown, q25, q75, stratum } | { hidden }, plain, typical,
 * climate, chance: { p, climate } | null (still on in score.CHANCE_HOURS) }.
 */
function forecastCases(cases, prior) {
  const climate = P.climatology(prior);
  const climateChance = P.climatologyChance(prior, SC.CHANCE_HOURS);
  return cases.map((c) => {
    const fc = P.forecastOf(prior, c);
    const shown = P.shownOf(fc, c.age);
    const ch = P.chanceStillOn(prior, c, SC.CHANCE_HOURS);
    const base = { ...c, cls: fc.cls, chance: ch && Number.isFinite(climateChance) ? { p: ch.p, climate: climateChance } : null };
    if (shown.hidden) return { ...base, model: { hidden: shown.hidden } };
    const s = prior.strata.get(fc.stratum);
    return { ...base, model: { raw: fc.median, shown: shown.shown, q25: fc.q25, q75: fc.q75, stratum: fc.stratum },
      plain: P.plainResidual(s.records, c.age), typical: P.typicalMinusAge(s.records, c.age), climate };
  });
}

// ---------- the designs end to end ----------
/** The real design: { forecasts, rows }. */
function runReal(entries, times, { volume = 'then' } = {}) {
  const forecasts = [];
  for (const origin of realOrigins(times)) {
    const cases = realCases(entries, times, origin, { volume });
    if (cases.length) forecasts.push(...forecastCases(cases, P.fitPrior(GT.recordsAsOf(entries, origin.at))));
  }
  return { forecasts, rows: SC.report(forecasts, { design: volume === 'final' ? 'real, volume read later' : 'real' }) };
}
/**
 * The landmark design: { forecasts, rows }. The prior at a moment: every search that had begun by then, as every snapshot since
 * shows the time before it (lib/forecast/gt.js recordsAt): ended by then, or censored at its age then.
 */
function runLandmark(entries, times) {
  const forecasts = [];
  for (const end of clusterEnds(times)) {
    const inLater = entries.filter((e) => { const r = GT.readingAt(e, end.at); return e.geo === end.geo && r && r.at === end.at; });
    for (const origin of landmarksOf(end)) {
      const cases = landmarkCases(inLater, origin);
      if (cases.length) forecasts.push(...forecastCases(cases, P.fitPrior(GT.recordsAt(entries, origin.at))));
    }
  }
  return { forecasts, rows: SC.report(forecasts, { design: 'landmark' }) };
}

module.exports = { ORIGIN_APART, LANDMARK_MIN_FOLLOW, realOrigins, clusterEnds, landmarksOf, realCases, landmarkCases, forecastCases, runReal, runLandmark };
