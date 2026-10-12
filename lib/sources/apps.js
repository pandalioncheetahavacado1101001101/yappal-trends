'use strict';
/*
 * Apple's top free iPhone apps in the US (ios/IDEAS-FEED.md M9): the fifty most downloaded overall (Apple's own marketing feed) and
 * the fifty of Photo & Video (the App Store's older RSS, as JSON), each app with its rank and the day it was released. Apple's
 * public feeds, keyless, one of the two an hour in turn.
 *
 * Ranks only, no downloads. What it gives the list is an app a creator can film with or about: one that is weeks old and already
 * on a chart (an AI video maker, a new editor, a new social app), and its place on the chart read hour by hour.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const CHARTS = [
  { id: 'top', label: 'free iPhone apps', url: 'https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/50/apps.json', file: 'apps-top-free.json' },
  { id: 'photo-video', label: 'free Photo & Video apps', url: 'https://itunes.apple.com/us/rss/topfreeapplications/limit=50/genre=6008/json', file: 'apps-photo-video.json' },
];
const EVERY = 2 * HOUR;
const NAME_MAX = 60;

/** The chart to read this cycle: the one read longest ago, when two hours have passed since it was. lastReadAt: Map(id -> epoch seconds). */
function chartRequest(lastReadAt = new Map(), now = 0) {
  const due = CHARTS.map((c, i) => ({ c, i, at: lastReadAt.get(`apps-${c.id}`) ?? -Infinity })).filter((x) => now - x.at >= EVERY).sort((a, b) => a.at - b.at || a.i - b.i)[0];
  return due ? request({ id: `apps-${due.c.id}`, source: 'apps', kind: 'apps', args: { chart: due.c.id }, url: due.c.url, file: due.c.file, tier: 3 }) : null;
}
const labelOf = (id) => (CHARTS.find((c) => c.id === id) || {}).label || null;

/** An app's name without the tagline a store listing hangs on it ("CapCut: Photo & Video Editor" is "CapCut"). */
const shortName = (name) => { const s = String(name || '').replace(/\s+/g, ' ').trim(); const cut = s.split(/\s*[:|–—]\s+|\s+-\s+/)[0].trim(); return (cut.length >= 2 ? cut : s).slice(0, NAME_MAX); };
const day = (iso) => (/^\d{4}-\d\d-\d\d/.test(String(iso || '')) ? String(iso).slice(0, 10) : null);

/**
 * A chart's reply as [{ rank, id, name (without its tagline), full, maker, released ("2026-09-08"), genres: [names] }] in rank
 * order; null when it is neither feed. Both shapes are read: `feed.results` (the marketing feed) and `feed.entry` (the older one).
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const feed = j && j.feed;
  if (!feed) return null;
  if (Array.isArray(feed.results)) {
    const rows = feed.results.filter((r) => r && r.id && r.name).map((r, i) => ({ rank: i + 1, id: String(r.id), name: shortName(r.name), full: String(r.name), maker: r.artistName || null, released: day(r.releaseDate),
      genres: (r.genres || []).map((g) => g && g.name).filter(Boolean) }));
    return rows.length ? rows : null;
  }
  if (Array.isArray(feed.entry)) {
    const label = (x) => (x && typeof x.label === 'string' ? x.label : null);
    const rows = feed.entry.map((e, i) => ({ rank: i + 1, id: e && e.id && e.id.attributes ? String(e.id.attributes['im:id'] || '') : '', name: shortName(label(e && e['im:name'])), full: label(e && e['im:name']) || '',
      maker: label(e && e['im:artist']), released: day(label(e && e['im:releaseDate'])), genres: [e && e.category && e.category.attributes ? e.category.attributes.label : null].filter(Boolean) }))
      .filter((r) => r.id && r.name);
    return rows.length ? rows : null;
  }
  return null;
}

module.exports = { CHARTS, EVERY, chartRequest, labelOf, parse, shortName };
