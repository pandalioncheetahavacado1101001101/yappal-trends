'use strict';
/*
 * The one absolute size scale (ios/.review/trend-size-scale.md; constants in lib/data/size-anchors.json "scale"): English Wikipedia
 * views a day above the article's baseline, averaged over a stretch of days, on a log scale in two parts. 95 to 100 is the mega band,
 * kept for the all-time mega-trends: its edge (95%) is Among Us's best 30 days (73,919 a day) and its top (100%) the biggest anchor's
 * (Squid Game, 576,658 a day), with the anchors between ranked in log space (about 1.7 points a doubling). Under the band the scale
 * runs from the floor (0% at 500 a day) up to the band's edge (about 13.2 points a doubling).
 *
 *   under the band: pct = 95 * log10(views / floor) / log10(mega / floor)        (floor <= views < mega)
 *   in the band:    pct = 95 + 5 * min(1, log10(views / mega) / log10(top / mega)) (views >= mega)
 *
 * A trend's size (the headline) is its best 30-day mean on this scale; its line is the mean of the 7 days centred on each day, inside
 * the life (SIZE_DAYS, LINE_DAYS), so a day's line touches the band only when the week around it held a mega-trend's month, and a
 * spike's ring is on the day it broke, not a week on (series.js). One day's lookups never decide
 * either: a news spike that held half its peak for 3 days or fewer (SPIKE_DAYS) tops out at SPIKE_CEILING, under the band.
 *
 * Pure. Nothing here reads anything but the anchors file, once.
 */
const ANCHORS = require('../data/size-anchors.json');

const FLOOR = ANCHORS.scale.floor;
const MEGA = ANCHORS.scale.band.views;
const BAND = ANCHORS.scale.band.pct;
const TOP = ANCHORS.scale.top;
const CAP = ANCHORS.scale.cap;
const LOG_FLOOR = Math.log10(FLOOR);
const LOG_MEGA = Math.log10(MEGA);
// (the decades under the band, floor to its edge, and the decades inside it, its edge to the top)
const DECADES = Math.log10(MEGA / FLOOR);
const BAND_DECADES = Math.log10(TOP / MEGA);
const LINE_DAYS = ANCHORS.scale.lineDays;
const SIZE_DAYS = ANCHORS.scale.sizeDays;
const SPIKE_DAYS = ANCHORS.scale.spike.days;
const SPIKE_CEILING = ANCHORS.scale.spike.ceiling;

/** The size of a level, 0-100 (unrounded), from log10 of its wiki-equivalent views a day. */
function pctOfLog(lv) {
  if (!Number.isFinite(lv)) return 0;
  if (lv < LOG_MEGA) return BAND * Math.max(0, (lv - LOG_FLOOR) / DECADES);
  return BAND + (CAP - BAND) * Math.min(1, (lv - LOG_MEGA) / BAND_DECADES);
}
/** The size of a level, 0-100 (unrounded), from its wiki-equivalent views a day; none, zero or less reads 0. */
const pctOf = (views) => (Number.isFinite(views) && views > 0 ? pctOfLog(Math.log10(views)) : 0);
/** The views a day a size stands for (the inverse of pctOf on 0-100). */
function viewsAt(pct) {
  const p = Math.min(CAP, Math.max(0, pct));
  return p < BAND ? FLOOR * Math.pow(10, (p / BAND) * DECADES) : MEGA * Math.pow(10, ((p - BAND) / (CAP - BAND)) * BAND_DECADES);
}
/** A size as a trend reads it: a spike's never above SPIKE_CEILING. */
const shown = (pct, spike) => (spike ? Math.min(pct, SPIKE_CEILING) : pct);
/** Whether a trend is a spike: it held half its own peak day on SPIKE_DAYS days or fewer. */
const isSpike = (daysAboveHalf) => Number.isFinite(daysAboveHalf) && daysAboveHalf <= SPIKE_DAYS;
/** One decimal, as the feed carries a size. */
const round1 = (x) => Math.round(x * 10) / 10;

module.exports = { ANCHORS, FLOOR, MEGA, BAND, TOP, CAP, LOG_FLOOR, DECADES, BAND_DECADES, LINE_DAYS, SIZE_DAYS, SPIKE_DAYS, SPIKE_CEILING, pctOf, pctOfLog, viewsAt, shown, isSpike, round1 };
