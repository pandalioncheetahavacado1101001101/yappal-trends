'use strict';
/*
 * Each audience's own song charts (wave 12, the depth lane; ios/IDEAS-FEED.md D3 `charts`): until this wave every list's charts rows were
 * the US's (Trending TikTok Songs' US charts, Spotify's US daily chart by way of Kworb, Shazam's US discovery chart), the same rows on the
 * UK's, Australia's and Canada's lists. Here each country's own charts are read, a little at a time, and kept as a small private history
 * (meta `countryCharts`: per chart, its rows as last read and when each song was first and last seen, with its places): the charts desk
 * (lib/desks/charts.js) makes each audience's rows from its own countries' charts.
 *
 * Reads (each its own request, ONE A CYCLE AT MOST, in turn, the chart read longest ago first, and only in a cycle that has asked fewer
 * than HEADROOM requests: a busy cycle asks none of them. About 16 a day in all):
 *   apple-music     Apple Music's most played songs, the top 50 of a storefront, from Apple's marketing RSS (the feed Apple makes for
 *                   showing its charts): us, gb, au, ca, every 12 hours. Keyless; robots.txt allows every agent.
 *                   needs permission: Apple (its chart's places shown as rows).
 *   kworb-country   Kworb's mirror of Spotify's daily chart (lib/sources/kworb.js reads the US one): gb, au, ca, every 24 hours (the page is
 *                   daily and two days behind). robots.txt allows every agent. needs permission: Spotify (its ranks shown as rows).
 *   shazam-country  Shazam's discovery chart, the ten songs people are newly looking up, the file behind the site's download button: the UK,
 *                   Australia, Canada, every 24 hours. robots.txt disallows /shazam/v1/ and /shazam/v3/, not /services/charts/.
 *                   needs permission: Apple (Shazam's owner).
 *   tts-country     Trending TikTok Songs' Canada viral chart (the only one of the four audiences' countries besides the US the site
 *                   charts: it has no UK or Australian chart), every 12 hours. robots.txt allows all; no flag.
 * And, +0 requests, the US pages the collector already reads (lib/sources/kworb.js, lib/sources/shazam.js), parsed again from the copy
 * the cycle saved under engine/raw: Kworb's page says each song's move on the day before, which the platform ledger does not keep.
 *
 * Off: IDEAS_SOURCES_OFF=country-charts (every read here), or a source id above (apple-music, kworb-country, shazam-country, tts-country),
 * or one chart's id (apple-music-gb, kworb-au, shazam-ca, tts-ca ...). The charts desk's own switch (IDEAS_KINDS_OFF=charts) and
 * IDEAS_EXTENSION=0 read none of them either (collect.js). A replay asks only what its recording holds (`recordedOnly`).
 * Nothing here is published as it is: no history, no place series, no reading leaves the state; a row says one chart's fact in a line.
 */
const fs = require('fs');
const path = require('path');
const { request } = require('./fixed');
const KWORB = require('./kworb');
const SHAZAM = require('./shazam');
const TTS = require('./tts');
const { HOUR, DAY } = require('../util');

const APPLE = (cc) => `https://rss.marketingtools.apple.com/api/v2/${cc}/music/most-played/50/songs.json`;
const KWORB_PAGE = (cc) => `https://kworb.net/spotify/country/${cc}_daily.html`;
const SHAZAM_FILE = (place) => `https://www.shazam.com/services/charts/csv/discovery/${place}`;
const GEO_WORDS = { US: 'the US', GB: 'the UK', AU: 'Australia', CA: 'Canada' };
const GEO_ADJ = { US: 'US', GB: 'UK', AU: 'Australian', CA: 'Canadian' };
const CHARTS = [
  ...['US', 'GB', 'AU', 'CA'].map((geo) => ({ id: `apple-music-${geo.toLowerCase()}`, source: 'apple-music', geo, kind: 'apple', every: 12 * HOUR, url: APPLE(geo.toLowerCase()),
    label: `Apple Music's most played songs in ${GEO_WORDS[geo]}`, credit: 'Apple Music' })),
  ...['GB', 'AU', 'CA'].map((geo) => ({ id: `kworb-${geo.toLowerCase()}`, source: 'kworb-country', geo, kind: 'kworb', every: 24 * HOUR, url: KWORB_PAGE(geo.toLowerCase()),
    label: `Spotify's ${GEO_ADJ[geo]} daily chart`, credit: 'Kworb' })),
  ...[['GB', 'united-kingdom'], ['AU', 'australia'], ['CA', 'canada']].map(([geo, place]) => ({ id: `shazam-${geo.toLowerCase()}`, source: 'shazam-country', geo, kind: 'shazam', every: 24 * HOUR,
    url: SHAZAM_FILE(place), label: `Shazam's ${GEO_ADJ[geo]} discovery chart`, credit: 'Shazam' })),
  { id: 'tts-ca', source: 'tts-country', geo: 'CA', kind: 'tts', every: 12 * HOUR, url: 'https://trendingtiktoksongs.com/charts/ca/viral', label: 'the Canadian viral TikTok chart', credit: 'Trending TikTok Songs' },
];
// (the US pages the cycle already reads and saves: parsed again from disk, never asked here)
const LOCAL = [
  { id: 'kworb-us', source: 'kworb', geo: 'US', kind: 'kworb', file: 'kworb-us-daily.html', label: "Spotify's US daily chart", credit: 'Kworb' },
  { id: 'shazam-us', source: 'shazam', geo: 'US', kind: 'shazam', file: 'shazam-discovery.csv', label: "Shazam's US discovery chart", credit: 'Shazam' },
];
const ALL = [...CHARTS, ...LOCAL];
const BY_ID = new Map(ALL.map((c) => [c.id, c]));
// (a cycle that has asked this many requests asks none of these: the ledger's revert line is 110 on three normal cycles in a row)
const HEADROOM = 100;
// (a song off the chart for four weeks that comes back is new to it again: 20% of drop-offs return inside 4 weeks, data/knowledge/music-charts-43.md)
const SEEN_KEPT = 28 * DAY;
const RANKS_KEPT = 8;
// (Kworb's 200: the desk reads its top 100, and a climb into them is the row's own move)
const ROWS_KEPT = 100;
const NAME_MAX = 80;

const blank = () => ({ charts: {} });
/** The cache as kept in meta, or a blank one: { charts: { id: { first, at, tried, day, local, rows: [...], seen: { key: { first, last, ranks: [[t, rank]] } } } } }. */
function cacheOf(c) { return c && typeof c === 'object' && c.charts && typeof c.charts === 'object' ? c : blank(); }

/** Whether a chart's read is off: IDEAS_SOURCES_OFF names it, its source, or "country-charts". off: a Set of words. */
const isOff = (off, c) => !!off && (off.has('country-charts') || off.has(c.source) || off.has(c.id));
const chartRequest = (c) => request({ id: `cc-${c.id}`, source: c.source, kind: 'country-chart', args: { chart: c.id }, url: c.url, file: `cc-${c.id}.txt`, tier: 3 });

/**
 * The read due now, as a list of one request or none: the chart whose last proper read or try is oldest, once its interval has passed,
 * whose host is not in back-off (open(host)), and only while the cycle has asked fewer than HEADROOM requests (sent).
 */
function due(cache0, nowS, { off = new Set(), sent = 0, open = () => true } = {}) {
  if (!(sent < HEADROOM)) return [];
  const cache = cacheOf(cache0);
  const last = (c) => { const x = cache.charts[c.id] || {}; return Math.max(Number.isFinite(x.at) ? x.at : -Infinity, Number.isFinite(x.tried) ? x.tried : -Infinity); };
  const next = CHARTS.map((c, i) => ({ c, i, at: last(c) }))
    .filter(({ c, at }) => !isOff(off, c) && nowS - at >= c.every && open(chartRequest(c).host))
    .sort((a, b) => a.at - b.at || a.i - b.i)[0];
  return next ? [chartRequest(next.c)] : [];
}

/** A replay asks only what its recording holds (a frozen day's recordings hold none of these: nothing is asked). */
function recordedOnly(requests, folder) {
  if (!folder) return requests;
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); } catch { manifest = {}; }
  return requests.filter((r) => manifest[r.id]);
}

// ---------- the replies ----------
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
/** Apple's marketing feed: [{ rank, title, artist, released ("2026-10-23") }], or null when it is not that feed. */
function parseApple(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const results = j && j.feed && Array.isArray(j.feed.results) ? j.feed.results : null;
  if (!results) return null;
  const rows = results.filter((r) => r && r.name && r.kind === 'songs').map((r, i) => ({ rank: i + 1, title: clean(r.name), artist: clean(r.artistName), released: /^\d{4}-\d\d-\d\d/.test(String(r.releaseDate || '')) ? String(r.releaseDate).slice(0, 10) : null }));
  const ms = Date.parse(j.feed.updated || '');
  return rows.length ? { day: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null, rows } : null;
}
/** One chart's reply as { day, rows: [{ rank, title, artist, released?, days?, move?, entry?, id? }] }, or null. */
function parseOf(c, text) {
  if (c.kind === 'apple') return parseApple(text);
  if (c.kind === 'kworb') { const p = KWORB.parse(text, { moves: true }); return p ? { day: p.day, rows: p.rows.map((r) => ({ rank: r.rank, title: clean(r.title), artist: clean(r.artist), days: r.days, move: r.move, entry: r.entry })) } : null; }
  if (c.kind === 'shazam') { const p = SHAZAM.parse(text); return p ? { day: p.day, rows: p.rows.map((r) => ({ rank: r.rank, title: clean(r.title), artist: clean(r.artist) })) } : null; }
  if (c.kind === 'tts') { const p = TTS.parseChart(text, 'viral'); return p ? { day: p.day, rows: p.rows.map((r) => ({ rank: r.rank, title: clean(r.title), artist: clean(r.artist), id: r.id, slug: r.slug, videos: r.videos })) } : null; }
  return null;
}

/** A song as two charts name it (lib/platform-signals.js songKey's rule): its title without brackets or a feature, and its first artist. */
function songKey(title, artist) {
  const PS = require('../platform-signals');
  return PS.songKey(title, artist);
}

/** The chart's cache after a proper read at `t` of `parsed`: its rows, and each song's first and last sight with its places. */
function withRead(chart0, parsed, t) {
  const chart = { ...(chart0 || {}) };
  const seen = { ...(chart.seen || {}) };
  const rows = parsed.rows.slice(0, ROWS_KEPT).map((r) => ({ ...r, key: songKey(r.title, r.artist) })).filter((r) => r.key && r.key !== '|');
  for (const r of rows) {
    const was = seen[r.key];
    const ranks = [...((was && was.ranks) || []), [t, r.rank]].slice(-RANKS_KEPT);
    seen[r.key] = { first: was ? was.first : t, last: t, ranks };
  }
  for (const [k, v] of Object.entries(seen)) if (!v || t - v.last > SEEN_KEPT) delete seen[k];
  return { ...chart, first: Number.isFinite(chart.first) ? chart.first : t, at: t, day: parsed.day || null, rows, seen };
}

/** The cache after this cycle's results ([{ request, status, text }]) at nowS: each proper reply read; every try remembered. */
function read(cache0, results, nowS) {
  const cache = cacheOf(cache0);
  const charts = { ...cache.charts };
  let n = 0;
  for (const r of results || []) {
    const id = r && r.request && r.request.args ? r.request.args.chart : null;
    const c = BY_ID.get(id);
    if (!c) continue;
    const parsed = r.status === 200 ? parseOf(c, r.text) : null;
    charts[id] = parsed ? withRead(charts[id], parsed, nowS) : { ...(charts[id] || {}), tried: nowS };
    if (parsed) { charts[id].tried = nowS; n += 1; }
  }
  return { cache: { ...cache, charts }, read: n };
}

/**
 * The US pages the cycle saved (LOCAL), read again when a copy newer than the last one read is on disk: +0 requests. rawDir: engine/raw.
 * off: a Set; a page whose own source is off is not read here either. A copy counts as read when it was written, and never later than
 * the cycle's own clock nowS (a replay writes its recorded pages at the wall clock's time, days after the cycle it replays).
 */
function readLocal(cache0, rawDir, { off = new Set(), nowS = Infinity } = {}) {
  const cache = cacheOf(cache0);
  if (!rawDir) return { cache, read: 0 };
  const charts = { ...cache.charts };
  let n = 0;
  for (const c of LOCAL) {
    if (off.has(c.source)) continue;
    let st = null;
    try { st = fs.statSync(path.join(rawDir, c.file)); } catch { st = null; }
    if (!st) continue;
    const mt = Math.floor(st.mtimeMs / 1000);
    if (charts[c.id] && Number.isFinite(charts[c.id].local) && charts[c.id].local >= mt) continue;
    let parsed = null;
    try { parsed = parseOf(c, fs.readFileSync(path.join(rawDir, c.file), 'utf8')); } catch { parsed = null; }
    if (!parsed) continue;
    charts[c.id] = { ...withRead(charts[c.id], parsed, Math.min(mt, nowS)), local: mt };
    n += 1;
  }
  return { cache: { ...cache, charts }, read: n };
}

/**
 * One cycle's step: the saved US pages read again, then the one read due (if any) sent and read. send(requests) -> results (lib/fetch.js
 * send, with the budget and the hosts' back-off). Returns { cache, results, read }.
 */
async function step({ cache, nowS, send, off = new Set(), sent = 0, open = () => true, rawDir = null }) {
  const local = readLocal(cache, rawDir, { off, nowS });
  const requests = due(local.cache, nowS, { off, sent, open });
  if (!requests.length) return { cache: local.cache, results: [], read: local.read };
  const results = await send(requests);
  const out = read(local.cache, results, nowS);
  return { cache: out.cache, results, read: local.read + out.read };
}

// ---------- what a chart says of its songs, for the charts desk ----------
const CLIMB_PLACES = 3;
const CLIMB_SHARE = 0.25;
const READS_APART = 10 * HOUR;
const CLIMB_DAYS = 3;
const dayStart = (day) => { const ms = Date.parse(`${day}T00:00:00Z`); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };
/** Whether a move from place `from` to place `to` is a climb: CLIMB_PLACES or more, and a CLIMB_SHARE of the old place (a reshuffle at a chart's foot is none). */
const climbs = (from, to) => Number.isFinite(from) && Number.isFinite(to) && from - to >= Math.max(CLIMB_PLACES, Math.ceil(CLIMB_SHARE * from));

/**
 * Each song a chart of `geos` holds now, with what the chart itself says of it: [{ chart (id), geo, label, credit, kind, rank, title,
 * artist, key, entered: { at, how } | null, climb: { from, to, at } | null, readAt, every }]. entered: when it came onto the chart, by the
 * chart's own count of days (Kworb), a release inside the chart's first days (Apple), or by the collector's own reads (it was not on the
 * chart at the first read, and is now). climb: in its LAST read, by the chart's own move (Kworb's day-on-day places) or between the
 * collector's last two reads of the chart (READS_APART or more apart). t: epoch seconds. A chart not read for 2 of its intervals says nothing.
 */
function entriesOf(cache0, geos, t, { off = new Set() } = {}) {
  const cache = cacheOf(cache0);
  const out = [];
  for (const c of ALL) {
    if (!geos.includes(c.geo) || (CHARTS.includes(c) ? isOff(off, c) : off.has(c.source))) continue;
    const x = cache.charts[c.id];
    const every = c.every || 24 * HOUR;
    if (!x || !Array.isArray(x.rows) || !Number.isFinite(x.at) || t - x.at > 2 * Math.max(every, 24 * HOUR) || x.at > t + HOUR) continue;
    for (const r of x.rows) {
      const s = (x.seen || {})[r.key] || null;
      // (when it came onto the chart: Kworb counts its days; any other chart, by the collector's own reads (not there at the first read,
      // there now); a song Apple says came out after the chart's first read, or one on it at that read and out since, from its release day)
      let entered = null;
      const rel = c.kind === 'apple' && r.released ? dayStart(r.released) : null;
      if (c.kind === 'kworb' && Number.isFinite(r.days) && r.days >= 1 && x.day && dayStart(x.day) !== null) entered = { at: dayStart(x.day) - (r.days - 1) * DAY, how: 'days' };
      else if (s && Number.isFinite(x.first) && s.first > x.first) entered = { at: s.first, how: 'seen' };
      else if (rel !== null && rel <= t) entered = { at: rel, how: 'released' };
      if (entered && rel !== null && rel <= t) entered = { ...entered, released: r.released };
      let climb = null;
      if (c.kind === 'kworb' && Number.isFinite(r.move) && r.move > 0 && climbs(r.rank + r.move, r.rank)) climb = { from: r.rank + r.move, to: r.rank, at: dayStart(x.day) ?? x.at, own: true };
      else if (s && Array.isArray(s.ranks) && s.ranks.length >= 2) {
        const [lt, lr] = s.ranks[s.ranks.length - 1];
        const prev = [...s.ranks].reverse().find(([pt]) => lt - pt >= READS_APART && lt - pt <= CLIMB_DAYS * DAY);
        if (lt === x.at && lr === r.rank && prev && climbs(prev[1], r.rank)) climb = { from: prev[1], to: r.rank, at: lt, fromAt: prev[0] };
      }
      out.push({ chart: c.id, geo: c.geo, label: c.label, credit: c.credit, kind: c.kind, rank: r.rank, size: Math.max(x.rows.length, r.rank), title: r.title, artist: r.artist, key: r.key, id: r.id || null, slug: r.slug || null, videos: Number.isFinite(r.videos) ? r.videos : null,
        entered, climb, readAt: x.at, every, day: x.day || null });
    }
  }
  return out;
}

/** Counts for the cycle's log: charts held, read this cycle, songs held. Never a title. */
function census(cache0, t) {
  const cache = cacheOf(cache0);
  const held = Object.entries(cache.charts).filter(([, x]) => x && Number.isFinite(x.at));
  return { charts: held.length, fresh: held.filter(([, x]) => t - x.at < 2 * DAY).length, songs: held.reduce((n, [, x]) => n + ((x.rows || []).length), 0) };
}

module.exports = { CHARTS, LOCAL, HEADROOM, GEO_WORDS, cacheOf, isOff, due, recordedOnly, parseApple, parseOf, withRead, read, readLocal, step, entriesOf, climbs, census, songKey };
