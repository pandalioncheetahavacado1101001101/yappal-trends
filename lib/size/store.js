'use strict';
/*
 * The size series' own part of the state (ios/IDEAS-FEED.md A2, D4 `size`): what each listed row is (its spec, written by the detail
 * builder each cycle), each subject's lookup, each page's titles, each title's daily views, and the field each row last made. Tables of collector.db, made here on first
 * use, so a state from before them reads as one with nothing cached yet. Every write replaces a row on its key: a cycle that runs
 * twice writes the same rows. This is per-trend history, so it lives in the state alone: never in a published file.
 */
const { transaction } = require('../state');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS size_rows (trend_id TEXT PRIMARY KEY, seen_t INTEGER NOT NULL, spec TEXT NOT NULL, earlier INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS size_lookups (subject TEXT PRIMARY KEY, at INTEGER NOT NULL, used_t INTEGER NOT NULL, candidates TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS size_pages (pageid INTEGER PRIMARY KEY, title TEXT NOT NULL, titles TEXT, info_at INTEGER, used_t INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS size_views (title TEXT PRIMARY KEY, entry TEXT NOT NULL, asked_at INTEGER, used_t INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS size_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS size_last (trend_id TEXT PRIMARY KEY, at INTEGER NOT NULL, field TEXT NOT NULL);
`;
// a row not built for this long is no longer listed: its spec goes
const ROW_KEPT_SECONDS = 3 * 86400;
// a lookup, a page or a title no listed row has used for this long goes (a row listed again is looked up again)
const UNUSED_KEPT_SECONDS = 7 * 86400;

const made = new WeakSet();
/** The tables, made once per open database. */
function ensure(db) {
  if (made.has(db)) return;
  db.exec(SCHEMA);
  made.add(db);
}

const json = (text, fallback = null) => { try { return JSON.parse(text); } catch { return fallback; } };

// a spec that has not changed is written again only this often (each write is a synced one, and a list has 80 rows a cycle)
const SPEC_AGAIN_SECONDS = 50 * 60;

/** A row's spec as the detail builder saw it at slot `t`. */
function putSpec(db, id, t, spec) {
  const text = JSON.stringify(spec);
  const old = db.prepare('SELECT seen_t, spec, earlier FROM size_rows WHERE trend_id = ?').get(id);
  if (old && old.spec === text && t >= old.seen_t && t - old.seen_t < SPEC_AGAIN_SECONDS) return;
  db.prepare('INSERT OR REPLACE INTO size_rows (trend_id, seen_t, spec, earlier) VALUES (?, ?, ?, ?)').run(id, t, text, old ? old.earlier : 0);
}
/** A row whose life reaches back past what is held: its titles' history is wanted from the daily series' start. */
const setEarlier = (db, id, on) => { db.prepare('UPDATE size_rows SET earlier = ? WHERE trend_id = ?').run(on ? 1 : 0, id); };
/** The rows built at the newest slot (and within an hour of it): [{ id, seenT, spec, earlier }]. */
function recentRows(db) {
  const top = db.prepare('SELECT MAX(seen_t) t FROM size_rows').get();
  if (!top || !Number.isFinite(top.t)) return [];
  return db.prepare('SELECT trend_id, seen_t, spec, earlier FROM size_rows WHERE seen_t >= ?').all(top.t - 3600)
    .map((r) => ({ id: r.trend_id, seenT: r.seen_t, spec: json(r.spec), earlier: !!r.earlier })).filter((r) => r.spec);
}
const earlierOf = (db, id) => { const r = db.prepare('SELECT earlier FROM size_rows WHERE trend_id = ?').get(id); return !!(r && r.earlier); };

/** A search's candidates as kept: each one's views a plain list of [day, views]. */
const packCandidates = (cs) => cs.map((c) => ({ ...c, views: c.views ? [...c.views] : null }));
const unpackCandidates = (cs) => (Array.isArray(cs) ? cs.map((c) => ({ ...c, views: Array.isArray(c.views) ? new Map(c.views) : null })) : null);
/** The lookups held for `subjects`: Map(subject id -> [candidate]). */
function lookups(db, subjects) {
  const get = db.prepare('SELECT candidates FROM size_lookups WHERE subject = ?');
  const out = new Map();
  for (const s of subjects) { const r = get.get(s); const cs = r ? unpackCandidates(json(r.candidates)) : null; if (cs) out.set(s, cs); }
  return out;
}
const putLookup = (db, subject, at, candidates) => {
  db.prepare('INSERT OR REPLACE INTO size_lookups (subject, at, used_t, candidates) VALUES (?, ?, ?, ?)').run(subject, at, at, JSON.stringify(packCandidates(candidates)));
};

/** A page as held: { pageid, title, titles (null until its redirects are read), infoAt }, or null. */
function page(db, pageid) {
  const r = db.prepare('SELECT pageid, title, titles, info_at FROM size_pages WHERE pageid = ?').get(pageid);
  return r ? { pageid: r.pageid, title: r.title, titles: r.titles ? json(r.titles) : null, infoAt: r.info_at ?? null } : null;
}
function putPage(db, p, usedT) {
  db.prepare('INSERT OR REPLACE INTO size_pages (pageid, title, titles, info_at, used_t) VALUES (?, ?, ?, ?, ?)')
    .run(p.pageid, p.title, p.titles ? JSON.stringify(p.titles) : null, Number.isFinite(p.infoAt) ? p.infoAt : null, usedT);
}

/** The cache entries of `titles` (lib/size/wiki.js mergeFetch), each with `askedAt`: { title: entry }. */
function views(db, titles) {
  const get = db.prepare('SELECT entry, asked_at FROM size_views WHERE title = ?');
  const out = {};
  for (const t of new Set(titles)) { const r = get.get(t); const e = r ? json(r.entry) : null; if (e) out[t] = { ...e, askedAt: r.asked_at ?? null }; }
  return out;
}
function putViews(db, title, entry, askedAt, usedT) {
  const { askedAt: _, ...plain } = entry;
  db.prepare('INSERT OR REPLACE INTO size_views (title, entry, asked_at, used_t) VALUES (?, ?, ?, ?)').run(title, JSON.stringify(plain), askedAt, usedT);
}

/**
 * The field a row's size last made (lib/size/series.js feedField, its 60 points at most) and when: { at, field }, or null. It stands
 * in while the row's size is on its way again (a new title or a new subject to look up), so the chart does not blink out.
 */
function last(db, id) {
  const r = db.prepare('SELECT at, field FROM size_last WHERE trend_id = ?').get(id);
  const field = r ? json(r.field) : null;
  return field ? { at: r.at, field } : null;
}
/** Keeps a row's newest field (null lets it go); one that has not changed is written again only as often as a spec is. */
function putLast(db, id, at, field) {
  if (!field) { db.prepare('DELETE FROM size_last WHERE trend_id = ?').run(id); return; }
  const text = JSON.stringify(field);
  const old = db.prepare('SELECT at, field FROM size_last WHERE trend_id = ?').get(id);
  if (old && old.field === text && at >= old.at && at - old.at < SPEC_AGAIN_SECONDS) return;
  db.prepare('INSERT OR REPLACE INTO size_last (trend_id, at, field) VALUES (?, ?, ?)').run(id, at, text);
}

const metaGet = (db, key) => { const r = db.prepare('SELECT value FROM size_meta WHERE key = ?').get(key); return r ? json(r.value) : null; };
const metaSet = (db, key, value) => { db.prepare('INSERT OR REPLACE INTO size_meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(value)); };

/** What the listed rows use is kept: its `used_t` is now. */
function touch(db, { subjects = [], pageids = [], titles = [] }, now) {
  transaction(db, () => {
    const s = db.prepare('UPDATE size_lookups SET used_t = ? WHERE subject = ?');
    const p = db.prepare('UPDATE size_pages SET used_t = ? WHERE pageid = ?');
    const v = db.prepare('UPDATE size_views SET used_t = ? WHERE title = ?');
    for (const x of new Set(subjects)) s.run(now, x);
    for (const x of new Set(pageids)) p.run(now, x);
    for (const x of new Set(titles)) v.run(now, x);
  });
}

/** Rows no longer built, and whatever no listed row has used for a week, go. */
function prune(db, now) {
  transaction(db, () => {
    db.prepare('DELETE FROM size_rows WHERE seen_t < ?').run(now - ROW_KEPT_SECONDS);
    db.prepare('DELETE FROM size_last WHERE at < ?').run(now - ROW_KEPT_SECONDS);
    for (const table of ['size_lookups', 'size_pages', 'size_views']) db.prepare(`DELETE FROM ${table} WHERE used_t < ?`).run(now - UNUSED_KEPT_SECONDS);
  });
}

module.exports = { SCHEMA, ROW_KEPT_SECONDS, UNUSED_KEPT_SECONDS, ensure, putSpec, setEarlier, earlierOf, recentRows, lookups, putLookup, page, putPage, views, putViews,
  last, putLast, metaGet, metaSet, touch, prune, transaction };
