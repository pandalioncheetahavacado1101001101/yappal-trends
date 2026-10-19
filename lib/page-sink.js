'use strict';
/*
 * What sinks on page one (ios/IDEAS-SUPER.md P5): rank, never filter. The live page of 2026-10-19 07:25Z carried eight Fading rows
 * and ten rows that began more than a week before. A row sinks; it never leaves the list:
 *
 *   fading   its measured series says Fading, as its card does (a rule of the collector's own gave the word, not the engine's one
 *            snapshot, and the card says it), and nothing new has been written about it in the last 24 hours: it sinks below the
 *            live rows of its kind
 *   old      it began more than seven days ago, it is not rising, and nothing new has been written about it in the last 24 hours:
 *            it sinks below the fresher rows
 *
 * The desk lays it out (lib/desk.js `order`): a row that sinks takes no row of page one while a row of the page's kinds (its picks,
 * the people-drama waiting under it, the things to film) that does not sink is left; the page's own picks that sink come first of
 * what sinks. The rest of the list, the news the page keeps under it, is never lifted over one: a short list fills page one with
 * what sinks before it does with a row the desk holds off the page.
 *
 * A row with news in the last 24 hours keeps its place, whatever its age or its line. What counts as news, and what a tier is, is
 * the desk's to say (lib/desk.js `order`); this file holds the rule, its switch and the page's tally. Pure: no clock but `now`, no I/O.
 *
 * HELD (ios/IDEAS-SUPER.md: nothing that moves a number ships before the scoreboard has its baseline): the rule is off unless
 * IDEAS_PAGE_SINK=1, so the code may be published with it off and the page stays as it was; the tally is logged either way.
 */
const OLD_DAYS = 7;
const DAY_SECONDS = 86400;
const PAGE = 20;

/** Whether the page's sink is switched on: IDEAS_PAGE_SINK=1 (off by default until the scoreboard has a baseline). */
const on = (env = {}) => String(env.IDEAS_PAGE_SINK || '').trim() === '1';

/**
 * Why a row sinks: 'fading', 'old', or null when it keeps its place.
 * row: { status: the word its measured series says ('rising' | 'peaking' | 'fading'), or null when no rule of the collector's own
 *   said one; rising: whether it is rising (the word the page lays it out by); startedAt: when it began (epoch seconds) or null;
 *   news: whether something new was written about it in the last 24 hours }. now: epoch seconds; with no clock nothing sinks.
 */
function sinkOf({ status = null, rising = false, startedAt = null, news = false } = {}, now = null) {
  if (news || !Number.isFinite(now)) return null;
  if (status === 'fading') return 'fading';
  if (!rising && Number.isFinite(startedAt) && now - startedAt > OLD_DAYS * DAY_SECONDS) return 'old';
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

module.exports = { on, sinkOf, takeFirst, pageTally, OLD_DAYS };
