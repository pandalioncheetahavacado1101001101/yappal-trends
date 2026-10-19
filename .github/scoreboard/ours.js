'use strict';
/*
 * Our side of the scoreboard, read from a restored copy of the collector's state and never written: the database opens read-only,
 * the archive and the store are only read. What it reads (scoreboard-spec.json "ours"):
 *   trends     id, kind, titles (the trend's, every title it was listed under, the archived ones), alias keys, subject, people and
 *              tags named on its archived or published rows, first seen, ended, reseeded; its first listing and first page one from
 *              its samples (ours.listed, ours.firstPage: the first own read ranking it 1 to listDepth, 1 to page, in the US list), so
 *              rows ranked below listDepth never count however many the collector publishes
 *   sightings  when our own read of each comparator first showed a thing: Google Trends (the trend's first sample with sv_us > 0),
 *              Know Your Meme (the store's seenFirst of the entry's address), the Viral 50 (platform_items first_seen)
 *   lists      the archived US lists (09:00 and 18:00 US time), whole
 *   series     a trend's samples between two instants (precision and breadth read them)
 * Everything returned is per trend and stays in memory: none of it is ever printed, written or cached.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const HOUR = 3600;
// (the collector's sample flags, lib/state.js FLAG: a reseeded sample was read back from the feed, a backfilled one rebuilt from a
// source's past series; neither is a read the collector made at that instant)
const RESEEDED_FLAG = 32;
const NOT_OWN_READ = 4 | RESEEDED_FLAG;
const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };
const urlKey = (u) => String(u || '').replace(/[?#].*$/, '').replace(/\/$/, '');
const hasTable = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);

/** The archived lists of an audience: [{ name ("2026-10-11-0900"), day ("2026-10-11", US time), mark ("0900"), t (built), items }], oldest first. */
function readLists(archiveDir, audience, marks) {
  const dir = path.join(archiveDir, audience);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const m = name.match(/^(\d{4}-\d\d-\d\d)-(\d{4})\.json\.gz$/);
    if (!m || !marks.includes(m[2])) continue;
    let list = null;
    try { list = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).toString('utf8')); } catch { list = null; }
    const t = list ? Math.floor(Date.parse(list.generatedAt) / 1000) : NaN;
    if (list && Number.isFinite(t) && Array.isArray(list.items)) out.push({ name: `${m[1]}-${m[2]}`, day: m[1], mark: m[2], t, items: list.items });
  }
  return out;
}

/** Store rows the collector read from Know Your Meme: Map(address -> first seen, epoch seconds). */
function kymSightings(storeFile) {
  const out = new Map();
  let store = null;
  try { store = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch { return out; }
  for (const r of (store && store.rows) || []) {
    if (!r || r.fam !== 'kym' || !Number.isFinite(r.seenFirst)) continue;
    const key = urlKey(r.url || r.key);
    const at = Math.floor(r.seenFirst / 1000);
    if (!out.has(key) || at < out.get(key)) out.set(key, at);
  }
  return out;
}

/**
 * The first own read ranking each trend 1 to `depth` in the audience's list: (depth) -> Map(trend id -> epoch s). A sample the
 * collector did not read itself (backfilled, reseeded) never counts.
 */
function rankedFrom(db, audience) {
  const col = `r_${audience.toLowerCase()}`;
  const stmt = db.prepare(`SELECT trend_id id, MIN(t) t FROM samples WHERE ${col} BETWEEN 1 AND ? AND (COALESCE(flags, 0) & ${NOT_OWN_READ}) = 0 GROUP BY trend_id`);
  return (depth) => new Map(stmt.all(depth).map((r) => [r.id, r.t]));
}

/**
 * The instant from the samples, never before the collector's own column (first_listed_at, first_page_at: the first cycle ranking it
 * at all, or inside the page): a compacted hour or day is dated from its start, and the column bounds it from below. Null when no
 * sample ranks it that deep.
 */
const firstRanked = (fromSamples, column) => (Number.isFinite(fromSamples) ? Math.max(fromSamples, Number.isFinite(column) ? column : fromSamples) : null);

/**
 * Opens a state folder read-only. feedItems: the published US list's rows (v1/us.json items), for the people it names; optional.
 * Returns { firstCycleAt, coldEnd, lastSampleAt, trends: Map(id -> trend), lists, sightings: { gt: Map(trend id -> s), kym: Map(address
 * -> s), viral50: Map(sound id -> s) }, series(id, from, to), close() }.
 */
function readState(stateDir, spec, { feedItems = [] } = {}) {
  const audience = spec.audience;
  const db = new DatabaseSync(path.join(stateDir, 'collector.db'), { readOnly: true });
  const meta = new Map(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, parse(r.value, null)]));
  const firstCycleAt = Number(meta.get('firstCycleAt')) || null;
  const reseedAt = meta.get('reseed') && Number.isFinite(meta.get('reseed').at) ? meta.get('reseed').at : null;
  const coldEnd = Math.max(firstCycleAt || 0, reseedAt || 0) + spec.ours.coldStartHours * HOUR;
  const lastSampleAt = (db.prepare('SELECT MAX(t) t FROM samples').get() || {}).t || null;
  const lists = readLists(path.join(stateDir, 'archive'), audience, spec.ours.archives);

  const ranked = rankedFrom(db, audience);
  const listedAt = ranked(spec.ours.listDepth);
  const pagedAt = ranked(spec.ours.page);
  const trends = new Map();
  for (const r of db.prepare('SELECT id, kind, sub, title, first_seen, ended_at, first_listed_at, first_page_at, info FROM trends').all()) {
    const info = parse(r.info, {}) || {};
    trends.set(r.id, { id: r.id, kind: r.kind, sub: r.sub, titles: [r.title].filter(Boolean), aliases: Array.isArray(info.keys) ? [...info.keys] : [], people: [], tags: [],
      subject: typeof info.name === 'string' ? info.name : null,
      listed: firstRanked(listedAt.get(r.id), parse(r.first_listed_at, {})[audience]), firstPage: firstRanked(pagedAt.get(r.id), parse(r.first_page_at, {})[audience]),
      firstSeen: r.first_seen, endedAt: r.ended_at, reseeded: !!info.reseeded, cold: r.first_seen <= coldEnd });
  }
  for (const r of db.prepare('SELECT key, trend_id FROM aliases').all()) { const tr = trends.get(r.trend_id); if (tr) tr.aliases.push(r.key); }
  for (const r of db.prepare('SELECT DISTINCT trend_id, title FROM texts WHERE title IS NOT NULL').all()) { const tr = trends.get(r.trend_id); if (tr && !tr.titles.includes(r.title)) tr.titles.push(r.title); }
  const rowsSeen = [...lists.flatMap((l) => l.items), ...feedItems];
  for (const it of rowsSeen) {
    const tr = it && trends.get(it.id);
    if (!tr) continue;
    if (it.title && !tr.titles.includes(it.title)) tr.titles.push(it.title);
    for (const k of it.keys || []) if (!tr.aliases.includes(k)) tr.aliases.push(k);
    for (const p of it.people || []) if (p && p.name && !tr.people.some((q) => q.name === p.name)) tr.people.push({ name: p.name });
    for (const g of it.tags || []) if (typeof g === 'string' && !tr.tags.includes(g)) tr.tags.push(g);
  }

  const gt = new Map(db.prepare(`SELECT trend_id id, MIN(t) t FROM samples WHERE sv_${audience.toLowerCase()} > 0 AND (COALESCE(flags, 0) & ${NOT_OWN_READ}) = 0 GROUP BY trend_id`).all().map((r) => [r.id, r.t]));
  const viral50 = new Map();
  if (hasTable(db, 'platform_items')) {
    for (const r of db.prepare("SELECT key, first_seen FROM platform_items WHERE source = 'tts' AND key LIKE 'viral:%'").all()) viral50.set(r.key.slice('viral:'.length), r.first_seen);
  }
  const kym = kymSightings(path.join(stateDir, 'engine', 'store.json'));

  const seriesStmt = db.prepare(`SELECT t, interest, n24, outlets FROM samples WHERE trend_id = ? AND t >= ? AND t <= ? AND (COALESCE(flags, 0) & ${RESEEDED_FLAG}) = 0 ORDER BY t`);
  return {
    firstCycleAt, reseedAt, coldEnd, lastSampleAt, trends, lists, sightings: { gt, kym, viral50 },
    series: (id, from, to) => seriesStmt.all(id, from, to),
    close: () => db.close(),
  };
}

module.exports = { readState, readLists, kymSightings, urlKey, firstRanked };
