'use strict';
/*
 * What sinks on page one (ios/IDEAS-SUPER.md P5): rank, never filter. The live page of 2026-10-19 07:25Z carried eight Fading rows
 * and ten rows that began more than a week before; the scoreboard's first seven days (2026-10-18 to 10-24) found 5-9 such old rows, 0-6
 * Fading ones, and only 2-9 of 20 rows still live a day later on every page one. A row sinks; it never leaves the list:
 *
 *   fading   its measured series says Fading, as its card does (a rule of the collector's own gave the word, not the engine's one
 *            snapshot: its windows, its own dated items, its daily curve's "gone within a week" or its slide on a ranked list,
 *            lib/labels), and nothing new has been written about it in the last 24 hours: it sinks below the live rows of its kind
 *   old      it began more than seven days ago (a row that returned to the list counts from the run it is on now: lib/labels/recur.js),
 *            it is not rising, and nothing new has been written about it in the last 24 hours: it sinks below the fresher rows
 *   spent    it will not last the day (lib/labels/lasts.js): its line under half its peak, the peak six hours behind or more, fewer than
 *            two headlines of its own in the day, nothing new told for three days, and it began more than three days ago. On the frozen
 *            state rows of the first four were live a day later 0 times in 102 (46 of them over three days old); one headline of the
 *            day does not keep it up. A younger one, or one with a chapter of the last three days, keeps its place: the frozen days'
 *            researchers put such stories on page one
 *
 * The desk lays it out (lib/desk.js `order`): a row that sinks takes no row of page one while a row of the page's kinds (its picks,
 * the people-drama waiting under it, the things to film) that does not sink is left; the page's own picks that sink come first of
 * what sinks. The rest of the list, the news the page keeps under it, is never lifted over one: a short list fills page one with
 * what sinks before it does with a row the desk holds off the page.
 *
 * A row with news in the last 24 hours keeps its place against "fading" and "old", whatever its age or its line. What counts as news,
 * and what a tier is, is the desk's to say (lib/desk.js `order`); this file holds the rule, its switch and the page's tally. Pure: no
 * clock but `now`, no I/O.
 *
 * ON since 2026-10-27 (the scoreboard's baseline week is in); IDEAS_PAGE_SINK=0 turns it off, and with it the labels (lib/labels):
 * the page is then laid out exactly as it was without them. The tally is logged either way.
 */
const OLD_DAYS = 7;
const DAY_SECONDS = 86400;
const PAGE = 20;
const SPENT_AGE_SECONDS = 3 * DAY_SECONDS;
const OFF = new Set(['0', 'off', 'false', 'no']);

/** Whether the page's sink (and the labels) are on: on unless IDEAS_PAGE_SINK is 0, off, false or no. */
const on = (env = {}) => !OFF.has(String(env.IDEAS_PAGE_SINK ?? '').trim().toLowerCase());

/**
 * Why a row sinks: 'fading', 'old', 'spent', or null when it keeps its place.
 * row: { status: the word its measured series says ('rising' | 'peaking' | 'fading'), or null when no rule of the collector's own
 *   said one; rising: whether it is rising (the word the page lays it out by); startedAt: when it began (epoch seconds) or null;
 *   news: whether something new was written about it in the last 24 hours; spent: whether it will not last the day (lib/labels);
 *   runFrom: when the run it returned to the list on began, or null; charted: a sound a chart the collector read today still lists, live
 *   a day later by the scoreboard's own rule (scoreboard-spec v4: still on a chart at +20-28 h), so its age alone never sinks it }.
 * now: epoch seconds; with no clock nothing sinks.
 */
function sinkOf({ status = null, rising = false, startedAt = null, news = false, spent = false, runFrom = null, charted = false } = {}, now = null) {
  if (!Number.isFinite(now)) return null;
  // (a return counts its age from the run it is on now: a return alone sinks nothing. datasets-knowledge B3)
  const begun = Number.isFinite(runFrom) && Number.isFinite(startedAt) ? Math.max(startedAt, runFrom) : startedAt;
  if (!news && status === 'fading') return 'fading';
  // (a sound still on a chart read today is live a day on, 13 of 15 by the scoreboard's v4 reading of 10-18..10-24: age alone never sinks it.
  // Sounds still on the charts sank as old before this)
  if (!news && !rising && !charted && Number.isFinite(begun) && now - begun > OLD_DAYS * DAY_SECONDS) return 'old';
  if (spent && !rising && !charted && Number.isFinite(begun) && now - begun > SPENT_AGE_SECONDS) return 'spent';
  return null;
}

/** Takes the first row of `queue` that `ok` passes, or null: the queue is changed in place, as `shift` changes it. */
function takeFirst(queue, ok = () => true) {
  const at = queue.findIndex(ok);
  return at < 0 ? null : queue.splice(at, 1)[0];
}

/**
 * What page one of a published list (D3) carries, in aggregate numbers only: its rows; the ones whose status is Fading, all of them
 * and those on a measured series (the phone shows the word only on those: an unmeasured row's badge is a plain "Trending"); and the
 * ones that began more than seven days before the list was made and are neither rising nor Early. Counted as the scoreboard counts
 * page one (.github/scoreboard/scoreboard-spec.json "precision"), so the log and the scoreboard say the same of a page.
 */
function pageTally(list, pageSize = PAGE) {
  const at = list && Date.parse(list.generatedAt) / 1000;
  const page = ((list && list.items) || []).filter((it) => Number.isFinite(it.rank) && it.rank >= 1 && it.rank <= pageSize);
  const began = (it) => (it.startedAt ? Date.parse(it.startedAt) / 1000 : NaN);
  return {
    rows: page.length,
    fading: page.filter((it) => it.status === 'fading').length,
    fadingMeasured: page.filter((it) => it.status === 'fading' && it.statusMeasured === true).length,
    old: Number.isFinite(at) ? page.filter((it) => Number.isFinite(began(it)) && at - began(it) > OLD_DAYS * DAY_SECONDS && it.status !== 'rising' && !it.isEarly).length : 0,
  };
}

const KEPT = ['card', 'chapter', 'unread', 'began', 'film', 'told', 'fill', 'unmeasured', 'other'];
/**
 * What kept page one's Fading rows up, in aggregate numbers only (lib/desk.js `order` opts.keptBy: row id -> why). For a row on a
 * measured series, the news the desk read in it: 'card' (the sentence an editor's card cites tells something new of the title),
 * 'chapter' (the series' newest chapter or turn does), 'unread' (a chapter of the day whose headline the row no longer carries),
 * 'began' (it began inside the day), 'film' (a thing to film charts or a roundup vouch for), 'told' (outlets told it again that day,
 * TOLD_TODAY_MIN headlines that are no recap); or 'fill' (it sinks, and the page ran short). 'unmeasured' for a Fading no rule of the
 * collector's own gave; 'other' where the desk said nothing of it. Every key is counted, zeros too.
 */
function keptTally(list, keptBy, pageSize = PAGE) {
  const out = Object.fromEntries(KEPT.map((k) => [k, 0]));
  for (const it of ((list && list.items) || []).filter((x) => Number.isFinite(x.rank) && x.rank >= 1 && x.rank <= pageSize && x.status === 'fading')) {
    const why = keptBy && typeof keptBy.get === 'function' ? keptBy.get(it.id) : null;
    out[KEPT.includes(why) ? why : it.statusMeasured === true ? 'other' : 'unmeasured'] += 1;
  }
  return out;
}

module.exports = { on, sinkOf, takeFirst, pageTally, keptTally, OLD_DAYS, SPENT_AGE_SECONDS };
