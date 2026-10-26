'use strict';
/*
 * Will a page-one row still be live tomorrow (the scoreboard's precision check, .github/scoreboard/metrics.js liveAfter: not ended within
 * 24 hours, and 20-28 hours on a headline of its own in the last day or its line at half of where it stood)? Measured on the frozen
 * state's own reads (2026-10-11/12, 19 lists, 275 story rows of 41 stories): a story whose line is under half of its peak, the peak six
 * hours behind or more, with fewer than two own headlines in the day, was live a day later 0 times in 102 (11 stories); every other
 * story 115 of 173. Such a row is `spent`: it sinks below the rows of the page's kinds that are not (lib/page-sink.js), never leaves.
 *
 * Not spent: a row rising or Early, one whose newest chapter or turn is inside the day (a second accuser starts its day again), one
 * whose timeline told something new inside the last three days (the frozen day 2026-10-12b: its researchers put two such stories on
 * page one, a chapter two days old under each, with their own lines at nothing), and a word or a sound (its life is its charts' and
 * its pages', which the line does not draw). Pure, no I/O.
 */
const HOUR = 3600;
const DAY = 86400;
const SPENT_SHARE = 0.5;
const PEAK_BEHIND = 6 * HOUR;
const TOLD_MIN = 2;
// (a peak under this is no line to read: lib/measure.js K.PEAK_MIN)
const PEAK_MIN = 5;
const STORY_KINDS = new Set(['talk', 'moment']);
const TOLD_QUIET = 3 * DAY;

/**
 * Whether a row is spent: { kind, nowShare (its line now over its peak), peak, peakAt, n24 (own headlines in the last day), rising,
 * early, newsAt (its newest chapter or turn), toldAt (the newest entry of its timeline that told something: its start, a chapter, a
 * turn, a reply, its latest) } at `t` (epoch seconds).
 */
function spentOf({ kind = 'talk', nowShare = null, peak = null, peakAt = null, n24 = 0, rising = false, early = false, newsAt = null, toldAt = null } = {}, t) {
  if (!STORY_KINDS.has(kind) || rising || early || !Number.isFinite(t)) return false;
  if (!(peak >= PEAK_MIN) || !Number.isFinite(nowShare) || !Number.isFinite(peakAt)) return false;
  if (Number.isFinite(newsAt) && newsAt <= t && t - newsAt <= DAY) return false;
  if (Number.isFinite(toldAt) && toldAt <= t && t - toldAt <= TOLD_QUIET) return false;
  return nowShare < SPENT_SHARE && t - peakAt >= PEAK_BEHIND && (n24 || 0) < TOLD_MIN;
}

module.exports = { spentOf, SPENT_SHARE, PEAK_BEHIND, TOLD_MIN, TOLD_QUIET };
