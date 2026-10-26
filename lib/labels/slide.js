'use strict';
/*
 * A row's place on a ranked list as the trend-list mechanics measured it (ios/.review/datasets-knowledge.md B4, B5; x-trends-es: X
 * lists every 15 minutes, 5.7M readings; mechanics, not levels):
 *   slid      Fading's third signal: it sits in the bottom quarter of a list of known size, or fell two places or more in the last
 *             hour. Lists flicker (14.8% of drop-offs are back at the next read), so a slide is read only between two real readings.
 *   holds     Early on a ranked list: top 2 and not falling at one hour (a life over 6 h: precision 0.39-0.46 against a base of
 *             0.15-0.19), or top 4 for a claim of 4 hours or more (0.62-0.64 against 0.32-0.36).
 * The ranked list the collector reads per row is Reddit's (its best place today, lib/signals.js rd_rank: 1 is the top). Pure, no I/O.
 */
const HOUR = 3600;
const SLIDE_PLACES = 2;
const BOTTOM_SHARE = 0.75;
const EARLY_TOP = 2;
const EARLY_TOP_4H = 4;
// (a reading an hour back: the nearest one between 45 and 90 minutes before the newest)
const BACK = [45 * 60, 90 * 60];

/** The newest rank and the rank about an hour before it, from samples [{ t, rdRank }] up to `t`: { now, hourAgo } (null where none). */
function ranksOf(samples, t, key = 'rdRank') {
  const xs = (samples || []).filter((s) => s && Number.isFinite(s.t) && s.t <= t && Number.isFinite(s[key]) && s[key] >= 1 && !s.reseeded).sort((a, b) => a.t - b.t);
  const now = xs[xs.length - 1] || null;
  if (!now || t - now.t > HOUR) return { now: null, hourAgo: null };
  const back = xs.filter((s) => now.t - s.t >= BACK[0] && now.t - s.t <= BACK[1]).pop() || null;
  return { now: now[key], hourAgo: back ? back[key] : null };
}

/** Fading's ranked-list signal: in the bottom quarter of a list of known `size`, or two places or more lower than an hour ago. */
function slid({ now = null, hourAgo = null, size = null } = {}) {
  if (!Number.isFinite(now)) return false;
  if (Number.isFinite(size) && size > 0 && now > BOTTOM_SHARE * size) return true;
  return Number.isFinite(hourAgo) && now - hourAgo >= SLIDE_PLACES;
}

/** Early on a ranked list: top 2 (top 4 for a 4 h+ claim) and no lower than an hour ago (unknown an hour ago is not falling). */
function holds({ now = null, hourAgo = null } = {}, { fourHours = false } = {}) {
  if (!Number.isFinite(now)) return false;
  return now <= (fourHours ? EARLY_TOP_4H : EARLY_TOP) && !(Number.isFinite(hourAgo) && now > hourAgo);
}

module.exports = { ranksOf, slid, holds, SLIDE_PLACES, EARLY_TOP, EARLY_TOP_4H };
