'use strict';
/*
 * The collector's own measurements of a trend as the size series reads them (ios/IDEAS-FEED.md B1 `samples`): one observation per
 * kind per UTC day. Searches are the US band (`sv_us`) of observed samples only (a band cannot be backfilled, B1), and only on the
 * day it first reaches a new level: a band is the trend's running total, held for as long as Google lists the trend (a week or
 * more), so it estimates the peak so far on that day and says nothing of any later one. Outlets are the
 * day's largest count (a backfilled row is rebuilt from dated headlines, so it counts); TikTok video totals, YouTube uploads and
 * the hourly Wikipedia figure give shape only. Players come from the row's own `demand` (no column holds them). Pure.
 */
const { FLAG } = require('../state');
const D = require('./days');

const NOT_OBSERVED = FLAG.backfilled | FLAG.carried | FLAG.reseeded;
const NOT_READ = FLAG.carried | FLAG.reseeded;

/**
 * samples: [{ t (epoch seconds), sv_us, outlets, tt_videos, yt_h, wiki, flags }] of one trend, any resolution. extra: [{ day, kind,
 * value }] to add (players from the row's demand). Returns [{ day, kind, value }]: each day's largest value of each kind.
 */
function trackedFromSamples(samples, extra = []) {
  const best = new Map();
  const put = (day, kind, value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const k = `${day}|${kind}`;
    if (!best.has(k) || best.get(k).value < value) best.set(k, { day, kind, value });
  };
  // (in time order, so a band is read where it first reaches each new level)
  const ordered = (samples || []).filter((s) => s && Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
  let band = 0;
  for (const s of ordered) {
    const day = D.dayOfInstant(s.t);
    const flags = s.flags || 0;
    if (!(flags & NOT_OBSERVED) && Number.isFinite(s.sv_us) && s.sv_us > band) { put(day, 'searches', s.sv_us); band = s.sv_us; }
    if (!(flags & NOT_READ)) {
      put(day, 'outlets', s.outlets);
      put(day, 'tiktok-videos', s.tt_videos);
      put(day, 'youtube-uploads', s.yt_h);
      put(day, 'wiki-hourly', s.wiki);
    }
  }
  for (const e of extra) if (e && D.isDay(e.day)) put(e.day, e.kind, e.value);
  return [...best.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.kind < b.kind ? -1 : 1));
}

/**
 * A published row's demand as one observation on `day` (what a live row says about itself with no state at hand): a US searches
 * band, an outlets count or a players count; null for anything else (a "listed" row, a search from another country, a TikTok view
 * total: no calibrated size). A band is a running total: give the day it was most likely reached (the row's `peakAt`), not the day
 * the list was made, which can be days after the trend's peak.
 */
function trackedFromDemand(demand, day) {
  if (!demand || !Number.isFinite(demand.value) || !D.isDay(day)) return null;
  if (demand.kind === 'search') return demand.geo === 'US' ? { day, kind: 'searches', value: demand.value } : null;
  if (demand.kind === 'outlets') return { day, kind: 'outlets', value: demand.value };
  if (demand.kind === 'players') return { day, kind: 'players', value: demand.value };
  return null;
}

module.exports = { trackedFromSamples, trackedFromDemand };
