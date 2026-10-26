'use strict';
/*
 * "Will fade" from a row's own daily curve (ios/.review/datasets-knowledge.md B4, B5): the young-curve logistic fitted on the Google
 * Trends Calibrated Corpus (gtab-lasting.json, weights only). From the first one to three days after a curve first jumps (onset), or
 * after it first turns down (turn), it gives p(lasting): the excess still at 20% of the peak's a week on. "Gone within a week" at
 * p >= 0.6, that is p(lasting) <= 0.4, was right 77-89% of the time held out; "will last" only 57-65%, so only the first is a call.
 *
 * The curve is the row's own interest (lib/measure.js, 0-100) as the collector read it (never a rebuilt or re-seeded hour: another
 * scale), averaged per UTC day over the days it watched at least half of (the start day from the story's start). Its
 * baseline is the days before the story began, and a story has no attention of its own before it began: the baseline is 0 where the
 * collector met the row at its start, and the call is not made for a row met after its start (what came before is unknown, not 0).
 * The day still running is never a day: a half-day would read as a fall. Pure: no clock but `now`, no I/O.
 */
const CO = require('./gtab-lasting.json');

const DAY = 86400;
const HIST = 7;
// (the corpus counts in Google Trends steps; the row's interest is 0-100 with one decimal, so a step is one point)
const QUANTUM = 1;
// p(lasting) at or under this is "gone within a week" (p >= 0.6 of fading)
const WILL_FADE_P = 0.4;
const MAX_DAYS = 3;
// (a day the collector watched for less than this share of its hours is no day of the curve)
const DAY_COVER = 0.5;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/**
 * The daily curve: [{ day (UTC day number), v (mean interest that day) }] for each whole UTC day from `from` to the day before `now`,
 * from samples [{ t, res, interest }] (the row's own, observed or carried; never a rebuilt or re-seeded one). A day read for less
 * than half its hours is null, except the first.
 */
function dailyOf(samples, { from, now, stepSeconds = 900 } = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(now)) return [];
  const first = Math.floor(from / DAY);
  const last = Math.floor(now / DAY) - 1;
  const sums = new Map();
  for (const s of samples || []) {
    if (!s || s.reseeded || s.backfilled || !Number.isFinite(s.interest) || !Number.isFinite(s.t) || s.t >= (last + 1) * DAY) continue;
    const d = Math.floor(s.t / DAY);
    if (d < first) continue;
    const x = sums.get(d) || { sum: 0, n: 0, secs: 0 };
    sums.set(d, { sum: x.sum + s.interest * (s.res || stepSeconds), n: x.n + 1, secs: x.secs + (s.res || stepSeconds) });
  }
  const out = [];
  for (let d = first; d <= last; d++) {
    const x = sums.get(d);
    // (the start day is whole from the story's start: what it read of it is the day)
    out.push({ day: d, v: x && (d === first || x.secs >= DAY_COVER * DAY) ? x.sum / x.secs : null });
  }
  return out;
}

/** p(lasting) from one set of weights and a feature row; a feature given as null stands at the corpus's mean (it says nothing). */
function pOf(w, x) {
  if (!w || x.length !== w.coef.length) return null;
  let z = w.intercept;
  for (let i = 0; i < x.length; i++) if (x[i] !== null) z += w.coef[i] * ((x[i] - w.mean[i]) / (w.scale[i] || 1));
  return sigmoid(z);
}

/**
 * p(lasting) for a story's daily values `v` (oldest first; index 0 is the first day the story could have had attention, its start
 * day) with baseline `b` (0 for a story met at its start): { anchor ('onset' | 'turn'), days (1-3 seen after the anchor), p } or null
 * when the curve has not jumped yet or a day it needs is missing. `s`: the baseline's noise. With none (a story has no baseline of
 * its own to be noisy) the peak's height over the noise says nothing and stands at the corpus's mean: on the row's 0-100 scale every
 * story would read as a giant spike over a one-point noise, and the model reads a giant spike as one that fades.
 */
function lastingOf(v, { b = 0, s = null } = {}) {
  if (!Array.isArray(v) || !v.length || v.some((x) => !Number.isFinite(x))) return null;
  const pad = [...Array(HIST).fill(b), ...v];
  const scale = Math.max(Number.isFinite(s) ? s : QUANTUM, QUANTUM);
  const sized = Number.isFinite(s);
  const t0 = pad.findIndex((x, i) => i >= HIST && x - b >= Math.max(3 * scale, 2 * QUANTUM) && x >= 1.5 * b);
  if (t0 < 0) return null;
  const feats = (seg, m, pos) => {
    const y = seg.map((x) => clip(m > b ? (x - b) / (m - b) : 0, -1, 1.5));
    return [...y, sized ? Math.log1p(Math.max(m - b, 0) / scale) : null, Math.log1p(Math.max(b, 0) / Math.max(m, 1e-9)), pos];
  };
  // the first turn-down: the first day from onset that is a running maximum and the next day is lower
  let mday = -1;
  for (let t = t0; t + 1 < pad.length; t++) if (pad[t + 1] < pad[t] && pad[t] >= Math.max(...pad.slice(t0, t + 1))) { mday = t; break; }
  if (mday >= 0) {
    const dd = Math.min(MAX_DAYS, pad.length - 1 - mday);
    const seg = pad.slice(mday - HIST, mday + dd + 1);
    return { anchor: 'turn', days: dd, p: pOf(CO.turn[`d${dd}`], feats(seg, pad[mday], mday - t0)) };
  }
  const dd = Math.min(MAX_DAYS, pad.length - t0);
  const seg = pad.slice(t0 - HIST, t0 + dd);
  const m = Math.max(...seg);
  return { anchor: 'onset', days: dd, p: pOf(CO.onset[`d${dd}`], feats(seg, m, seg.indexOf(m) - HIST)) };
}

/**
 * Whether a row's own curve says "gone within a week": { willFade, p, anchor, days } or null when no call can be made (the row was met
 * after its start, no whole day yet, a day missing, no jump yet). samples: the row's own; startedAt, firstSeen: epoch seconds.
 */
function fadeCall(samples, { startedAt = null, firstSeen = null, now } = {}) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return null;
  // (met at its start: the collector's first sight within its start day, so the days before hold none of its attention)
  if (Number.isFinite(firstSeen) && Math.floor(firstSeen / DAY) > Math.floor(startedAt / DAY)) return null;
  const days = dailyOf(samples, { from: startedAt, now });
  if (!days.length || days.some((d) => d.v === null)) return null;
  const call = lastingOf(days.map((d) => d.v));
  return call && Number.isFinite(call.p) ? { ...call, willFade: call.p <= WILL_FADE_P } : null;
}

module.exports = { dailyOf, lastingOf, fadeCall, pOf, median, WILL_FADE_P, QUANTUM, HIST };
