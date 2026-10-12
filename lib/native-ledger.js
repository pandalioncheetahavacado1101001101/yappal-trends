'use strict';
/*
 * The ledger of the creator-native sources (ios/IDEAS-FEED.md L9): what each cycle read of them, kept in the state's own db so the
 * next cycle can say what is NEW and what MOVED. Three small tables, every write `INSERT OR REPLACE` on its key, so a slot run twice
 * leaves the same rows (A3):
 *   native_items    one row per thing a source showed: a video, a clip, a thread, a completion, a channel. Its own time when it
 *                   carries one (`t`), when the collector first and last saw it, and `fresh`: whether it was new BY OBSERVATION.
 *   native_series   a number read of it per cycle: a video's views and likes, a clip's score, a channel's followers, a thread's
 *                   comments of the board's newest hundred, a post's replies. Written only when it changed or hourly.
 *   native_reads    when each list was read, which is what "new by observation" is decided on.
 * New by observation (C3): a thing with no time of its own (a completion, a place in a table) is new only when the same list was
 * read WITHOUT it inside the three hours before. Met at a cold start, or after a gap, it is known from now on and never new.
 *
 * The platform, word and craze sources (M) keep a second ledger of the same shape under `platform_*` (`platform` below): charts are
 * read daily, so a list may say how long "watched" is for it (`watch` on a read), a number may carry its own time (`at`: a chart's
 * day, an hourly file's hour), and the daily numbers are kept for forty days.
 *
 * The ledgers live in the state folder and nowhere else: they are never written under the published folder (A6), and they hold
 * public figures' public numbers and public titles, nobody's account, nothing personal.
 */
const { transaction } = require('./state');
const { HOUR, DAY } = require('./util');

const NEW_BY_OBSERVATION = 3 * HOUR;
// (a completion unseen for a week is new again: "New = unseen in the last 7 days")
const SEEN_AGAIN_AFTER = 7 * DAY;
const SERIES_EVERY = HOUR;
const NATIVE = { itemsKept: 14 * DAY, seriesKept: 5 * DAY, readsKept: 2 * DAY, loadBack: 3 * DAY, seriesBack: 26 * HOUR, slow: [], slowKept: 0 };
// (the charts' own days are a sound's curve: kept forty days; a list read once a day is "watched" for two)
const PLATFORM = { itemsKept: 30 * DAY, seriesKept: 5 * DAY, readsKept: 4 * DAY, loadBack: 10 * DAY, seriesBack: 3 * DAY, slow: ['tts', 'tts-song', 'kworb', 'shazam', 'reels', 'apps', 'tiktok-sound'], slowKept: 40 * DAY };

const schemaOf = (p) => `
CREATE TABLE IF NOT EXISTS ${p}_items (source TEXT NOT NULL, key TEXT NOT NULL, t INTEGER, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, fresh INTEGER NOT NULL DEFAULT 0,
  title TEXT, who TEXT, data TEXT, PRIMARY KEY (source, key)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ${p}_items_seen ON ${p}_items (last_seen);
CREATE TABLE IF NOT EXISTS ${p}_series (source TEXT NOT NULL, key TEXT NOT NULL, t INTEGER NOT NULL, v REAL, w REAL, PRIMARY KEY (source, key, t)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ${p}_reads (source TEXT NOT NULL, scope TEXT NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (source, scope, t)) WITHOUT ROWID;
`;
const SCHEMA = schemaOf('native');

/** What one cycle's readers hand a ledger: { items: [{ source, key, scope, t, title, who, data, watch }], series: [{ source, key, v, w, at }], reads: [{ source, scope }] }. */
const newBatch = () => ({ items: [], series: [], reads: [] });
const parse = (text) => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } };
const num = (x) => (Number.isFinite(x) ? x : null);

/** A ledger over the tables `<prefix>_items`, `<prefix>_series`, `<prefix>_reads`. k: how long each is kept and how far back a cycle reads. */
function ledgerOf(prefix, k) {
  const schema = schemaOf(prefix);
  /** Makes the three tables in a state's db (a state made before them gains them the first cycle after). */
  const ensure = (db) => { db.exec(schema); };

  /**
   * Writes one cycle's batch at slot `t`, in one transaction. An item is `fresh` when it is new (never seen, or unseen for a week) and
   * its list (`scope`) was read inside the three hours before this slot (or inside the item's own `watch`: a daily list's): new by
   * observation. An item first written by an earlier run of this very slot is worked out again the same way.
   */
  function record(db, t, batch) {
    if (!batch || (!batch.items.length && !batch.series.length && !batch.reads.length)) return { items: 0, fresh: 0 };
    ensure(db);
    const getItem = db.prepare(`SELECT first_seen, last_seen, fresh FROM ${prefix}_items WHERE source = ? AND key = ?`);
    const putItem = db.prepare(`INSERT OR REPLACE INTO ${prefix}_items (source, key, t, first_seen, last_seen, fresh, title, who, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const readBefore = db.prepare(`SELECT 1 FROM ${prefix}_reads WHERE source = ? AND scope = ? AND t >= ? AND t < ? LIMIT 1`);
    const putRead = db.prepare(`INSERT OR REPLACE INTO ${prefix}_reads (source, scope, t) VALUES (?, ?, ?)`);
    const lastPoint = db.prepare(`SELECT t, v, w FROM ${prefix}_series WHERE source = ? AND key = ? AND t < ? ORDER BY t DESC LIMIT 1`);
    const putPoint = db.prepare(`INSERT OR REPLACE INTO ${prefix}_series (source, key, t, v, w) VALUES (?, ?, ?, ?, ?)`);
    let fresh = 0;
    transaction(db, () => {
      const watched = new Map();
      const wasWatched = (source, scope, watch) => {
        const key = `${source}|${scope}|${watch}`;
        if (!watched.has(key)) watched.set(key, !!readBefore.get(source, scope, t - watch, t));
        return watched.get(key);
      };
      for (const it of batch.items) {
        if (!it || !it.source || !it.key) continue;
        const old = getItem.get(it.source, String(it.key));
        // (new: never seen, seen only by this very slot, or unseen for a week)
        const isNew = !old || old.first_seen === t || t - old.last_seen > SEEN_AGAIN_AFTER;
        const isFresh = isNew ? (wasWatched(it.source, it.scope || it.source, Number.isFinite(it.watch) ? it.watch : NEW_BY_OBSERVATION) ? 1 : 0) : old.fresh;
        if (isNew && isFresh) fresh += 1;
        putItem.run(it.source, String(it.key), num(it.t), isNew ? t : old.first_seen, t, isFresh, it.title ? String(it.title).slice(0, 240) : null, it.who ? String(it.who).slice(0, 80) : null,
          it.data ? JSON.stringify(it.data) : null);
      }
      for (const p of batch.series) {
        if (!p || !p.source || !p.key || !Number.isFinite(p.v)) continue;
        // (a number that carries its own time, a chart's day or a file's hour, is that time's and is simply written)
        if (Number.isFinite(p.at)) { if (p.at <= t) putPoint.run(p.source, String(p.key), p.at, p.v, num(p.w)); continue; }
        const last = lastPoint.get(p.source, String(p.key), t);
        // (a number that has not moved is written again only once an hour: the curve is the same, the table a tenth the size)
        if (last && last.v === p.v && (last.w ?? null) === (num(p.w) ?? null) && t - last.t < SERIES_EVERY) continue;
        putPoint.run(p.source, String(p.key), t, p.v, num(p.w));
      }
      for (const r of batch.reads) if (r && r.source) putRead.run(r.source, r.scope || r.source, t);
    });
    return { items: batch.items.length, fresh };
  }

  /**
   * What the signals read at slot `t`: { items: [{ source, key, t, firstSeen, lastSeen, fresh, title, who, data }] seen inside the
   * look-back, series: Map("source|key" -> [{ t, v, w }], oldest first), reads: Map("source|scope" -> newest slot read, up to `t`) }.
   */
  function load(db, t) {
    ensure(db);
    const items = db.prepare(`SELECT * FROM ${prefix}_items WHERE last_seen >= ? AND last_seen <= ?`).all(t - k.loadBack, t)
      .map((r) => ({ source: r.source, key: r.key, t: r.t, firstSeen: r.first_seen, lastSeen: r.last_seen, fresh: !!r.fresh, title: r.title, who: r.who, data: parse(r.data) }));
    const series = new Map();
    const push = (r) => { const key = `${r.source}|${r.key}`; if (!series.has(key)) series.set(key, []); series.get(key).push({ t: r.t, v: r.v, w: r.w }); };
    const slow = k.slow.map(() => '?').join(', ');
    for (const r of db.prepare(`SELECT source, key, t, v, w FROM ${prefix}_series WHERE t >= ? AND t <= ?${slow ? ` AND source NOT IN (${slow})` : ''} ORDER BY t`).all(t - k.seriesBack, t, ...k.slow)) push(r);
    if (slow) for (const r of db.prepare(`SELECT source, key, t, v, w FROM ${prefix}_series WHERE t >= ? AND t <= ? AND source IN (${slow}) ORDER BY t`).all(t - k.slowKept, t, ...k.slow)) push(r);
    const reads = new Map(db.prepare(`SELECT source, scope, MAX(t) AS t FROM ${prefix}_reads WHERE t <= ? GROUP BY source, scope`).all(t).map((r) => [`${r.source}|${r.scope}`, r.t]));
    return { items, series, reads };
  }

  /** Drops what nothing reads again: items long unseen, numbers past their keep, old reads. */
  function prune(db, t) {
    ensure(db);
    const slow = k.slow.map(() => '?').join(', ');
    db.prepare(`DELETE FROM ${prefix}_items WHERE last_seen < ?`).run(t - k.itemsKept);
    db.prepare(`DELETE FROM ${prefix}_series WHERE t < ?${slow ? ` AND source NOT IN (${slow})` : ''}`).run(t - k.seriesKept, ...k.slow);
    if (slow) db.prepare(`DELETE FROM ${prefix}_series WHERE t < ? AND source IN (${slow})`).run(t - k.slowKept, ...k.slow);
    db.prepare(`DELETE FROM ${prefix}_reads WHERE t < ?`).run(t - k.readsKept);
  }
  return { ensure, record, load, prune };
}

const native = ledgerOf('native', NATIVE);
const platform = ledgerOf('platform', PLATFORM);

/** Batches joined into one, in order. */
const merge = (...batches) => batches.filter(Boolean).reduce((a, b) => ({ items: [...a.items, ...b.items], series: [...a.series, ...b.series], reads: [...a.reads, ...b.reads] }), newBatch());

module.exports = { SCHEMA, ...native, platform, ledgerOf, newBatch, merge, NEW_BY_OBSERVATION, SEEN_AGAIN_AFTER };
