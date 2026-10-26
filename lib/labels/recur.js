'use strict';
/*
 * What a row's own history says it is (ios/.review/datasets-knowledge.md B3, C4 labels), from the state's own readings only:
 *
 *   returning   it was listed before, went off the list for a day or more, and its current run began 1-30 days after that earlier
 *               listing. Returning is normal (62.5% of Wikipedia's first entries, 36.7% of Google Trends' 5K+ trends had been there
 *               in the month or year before) and a return alone sinks nothing: its age is counted from the run it is on now.
 *   weekly      listed, or its own search trending, within 12 hours either side of this hour 1, 2, 3 or 4 weeks back, in 2 of the 4
 *               (1.9% of trends; 15.6% of them trend again the next week at that hour, against 3.6%). Never Early.
 *   always-on   its daily line never jumps: the 99th-percentile day at most 3x the median day and fewer than 5% days at zero, over
 *               two weeks or more (13% of Google Trends keywords: navigation, utilities, games). Never Early.
 *   evergreen   on Wikipedia's top list in the same week last year (+-7 days). Never Early. The rule takes last year's titles as
 *               an input: the collector reads no year-old list yet, so it says nothing until one is handed in.
 *
 * Pure: times are epoch seconds, `t` is handed in, no I/O.
 */
const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;
const OFF_GAP = DAY;
const RETURN_MIN = DAY;
const RETURN_MAX = 30 * DAY;
const WEEKLY_SLACK = 12 * HOUR;
const WEEKLY_BACK = [1, 2, 3, 4];
const WEEKLY_MIN = 2;
const ALWAYS_DAYS = 14;
const ALWAYS_RATIO = 3;
const ALWAYS_ZERO_SHARE = 0.05;

/** The runs a row was listed in: [{ from, to }] (epoch seconds), oldest first; a gap of a day or more off the list ends a run. */
function runsOf(times) {
  const xs = [...new Set((times || []).filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x - last.to < OFF_GAP) out[out.length - 1] = { from: last.from, to: x };
    else out.push({ from: x, to: x });
  }
  return out;
}

/**
 * Returning: { returning, runFrom (when the run it is on now began, or null) }. listed: the times it was listed (its own and those of
 * an earlier trend with the same key), up to `t`.
 */
function returningOf(listed, t) {
  const runs = runsOf((listed || []).filter((x) => x <= t));
  if (runs.length < 2) return { returning: false, runFrom: runs.length ? runs[0].from : null };
  const now = runs[runs.length - 1];
  // (the run it is on must be the one going now: a row listed this cycle or the one before)
  if (t - now.to > OFF_GAP) return { returning: false, runFrom: null };
  const before = runs.slice(0, -1).map((r) => r.to);
  const returning = before.some((x) => now.from - x >= RETURN_MIN && now.from - x <= RETURN_MAX);
  return { returning, runFrom: now.from };
}

/**
 * Weekly: whether it was listed, or its own search began trending, within 12 hours of this hour in 2 of the 4 weeks before.
 * times: [{ t, res }] (a reading and the span it stands for: a compacted day covers its whole day), or plain epoch seconds.
 */
function weeklyOf(times, t) {
  const spans = (times || []).map((x) => (typeof x === 'number' ? { t: x, res: 0 } : x)).filter((x) => x && Number.isFinite(x.t));
  const hits = WEEKLY_BACK.filter((k) => {
    const at = t - k * WEEK;
    return spans.some((x) => x.t <= at + WEEKLY_SLACK && x.t + (x.res || 0) >= at - WEEKLY_SLACK);
  }).length;
  return hits >= WEEKLY_MIN;
}

/** The q-quantile of numbers (linear between the two nearest). */
function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
}

/** Always-on: daily values (oldest first, nulls skipped) over two weeks or more whose 99th percentile is at most 3x their median. */
function alwaysOnOf(daily) {
  const xs = (daily || []).filter(Number.isFinite);
  if (xs.length < ALWAYS_DAYS) return false;
  const med = quantile(xs, 0.5);
  if (!(med > 0)) return false;
  const zeros = xs.filter((x) => x <= 0).length / xs.length;
  return quantile(xs, 0.99) <= ALWAYS_RATIO * med && zeros < ALWAYS_ZERO_SHARE;
}

/** Evergreen: its page title is among the titles on Wikipedia's top list in the same week last year (a Set handed in), or false. */
function evergreenOf(title, lastYear) {
  return !!title && lastYear instanceof Set && lastYear.has(String(title).replace(/ /g, '_').toLowerCase());
}

module.exports = { runsOf, returningOf, weeklyOf, alwaysOnOf, evergreenOf, quantile, RETURN_MAX, WEEKLY_MIN, ALWAYS_DAYS };
