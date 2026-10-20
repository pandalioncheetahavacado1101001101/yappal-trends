'use strict';
/*
 * What the entity graph keeps in the state (P14, B2), never published: where each node was listed (for the chapters: an entity that
 * returns in a new story), and the live Wikidata lookups of names the roster does not hold, each kept 30 days. Tables of their own,
 * made once per open database; every row older than KEPT_SECONDS goes.
 */
const { transaction } = require('../state');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entity_seen (trend_id TEXT NOT NULL, kind TEXT NOT NULL, qid TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, first_t INTEGER NOT NULL, last_t INTEGER NOT NULL, PRIMARY KEY (trend_id, kind, qid, name)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS entity_seen_qid ON entity_seen (qid);
CREATE INDEX IF NOT EXISTS entity_seen_name ON entity_seen (name);
CREATE TABLE IF NOT EXISTS entity_lookups (key TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL, used_t INTEGER NOT NULL,
  result TEXT);
`;
// a node listed this long ago is forgotten, and so is a lookup (cached 30 days: B2)
const KEPT_SECONDS = 30 * 86400;
// a node still listed is written again only this often (each write is a synced one, and a list has 80 rows)
const SEEN_AGAIN_SECONDS = 3600;

const made = new WeakSet();
function ensure(db) {
  if (made.has(db)) return;
  db.exec(SCHEMA);
  made.add(db);
}
const json = (text) => { try { return JSON.parse(text); } catch { return null; } };
const inTransaction = (db, work) => (db.isTransaction ? work() : transaction(db, work));

/**
 * Writes down where this cycle's nodes are listed: seen: [{ id, title, nodes: [{ kind, qid, name }] }] at slot t. A node still
 * listed is touched again once an hour; its first time stays.
 */
function recordSeen(db, t, seen) {
  ensure(db);
  const get = db.prepare('SELECT first_t, last_t, title FROM entity_seen WHERE trend_id = ? AND kind = ? AND qid = ? AND name = ?');
  const put = db.prepare('INSERT OR REPLACE INTO entity_seen (trend_id, kind, qid, name, title, first_t, last_t) VALUES (?, ?, ?, ?, ?, ?, ?)');
  inTransaction(db, () => {
    for (const s of seen) {
      for (const n of s.nodes) {
        const qid = n.qid || '';
        const name = n.name || '';
        if (!qid && !name) continue;
        const old = get.get(s.id, n.kind, qid, name);
        if (old && old.title === s.title && t >= old.last_t && t - old.last_t < SEEN_AGAIN_SECONDS) continue;
        put.run(s.id, n.kind, qid, name, s.title, old ? Math.min(old.first_t, t) : t, old ? Math.max(old.last_t, t) : t);
      }
    }
    db.prepare('DELETE FROM entity_seen WHERE last_t < ?').run(t - KEPT_SECONDS);
  });
}

/** The first time a trend was listed with any node, or null. */
function firstListed(db, id) {
  ensure(db);
  const r = db.prepare('SELECT MIN(first_t) t FROM entity_seen WHERE trend_id = ?').get(id);
  return r && Number.isFinite(r.t) ? r.t : null;
}

/**
 * The other stories a node was listed in: [{ id, title, firstT, lastT }], the newest first (last listed, then begun). A QID matches a QID; a name matches the
 * same name when the two sides do not hold different QIDs (the graph's own rule).
 */
function storiesOf(db, node, { exceptId = null, since = -Infinity, until = Infinity } = {}) {
  ensure(db);
  const rows = [];
  if (node.qid) rows.push(...db.prepare('SELECT trend_id, qid, name, title, first_t, last_t FROM entity_seen WHERE kind = ? AND qid = ?').all(node.kind, node.qid));
  if (node.name) rows.push(...db.prepare('SELECT trend_id, qid, name, title, first_t, last_t FROM entity_seen WHERE kind = ? AND name = ?').all(node.kind, node.name)
    .filter((r) => !(node.qid && r.qid && r.qid !== node.qid)));
  const byId = new Map();
  for (const r of rows) {
    if (r.trend_id === exceptId || r.last_t < since || r.last_t > until) continue;
    const had = byId.get(r.trend_id);
    if (!had || r.last_t > had.lastT) byId.set(r.trend_id, { id: r.trend_id, title: r.title, firstT: had ? Math.min(had.firstT, r.first_t) : r.first_t, lastT: r.last_t });
  }
  return [...byId.values()].sort((a, b) => b.lastT - a.lastT || b.firstT - a.firstT || (a.id < b.id ? -1 : 1));
}

// ---------- the live lookups ----------
/** A held lookup: { key, name, state ('wanted' | 'searched' | 'done'), at, usedT, result } or null. */
function lookup(db, key) {
  ensure(db);
  const r = db.prepare('SELECT key, name, state, at, used_t, result FROM entity_lookups WHERE key = ?').get(key);
  return r ? { key: r.key, name: r.name, state: r.state, at: r.at, usedT: r.used_t, result: json(r.result) } : null;
}
/** Names the graph met that the roster does not hold: wanted once, touched when used again (a lookup used inside 30 days stays). */
function want(db, t, names) {
  ensure(db);
  const get = db.prepare('SELECT state, at, used_t FROM entity_lookups WHERE key = ?');
  const put = db.prepare('INSERT INTO entity_lookups (key, name, state, at, used_t, result) VALUES (?, ?, ?, ?, ?, NULL)');
  const touch = db.prepare('UPDATE entity_lookups SET used_t = ? WHERE key = ?');
  const again = db.prepare("UPDATE entity_lookups SET state = 'wanted', at = ?, used_t = ?, result = NULL WHERE key = ?");
  inTransaction(db, () => {
    for (const { key, name } of names) {
      const old = get.get(key);
      if (!old) put.run(key, name, 'wanted', t, t);
      else if (old.state === 'done' && t - old.at >= KEPT_SECONDS) again.run(t, t, key);
      else if (t - old.used_t >= SEEN_AGAIN_SECONDS) touch.run(t, key);
    }
    db.prepare('DELETE FROM entity_lookups WHERE used_t < ?').run(t - KEPT_SECONDS);
  });
}
/** The lookups in a state, the most recently used first: [{ key, name, at, usedT, result }]. */
function inState(db, state, limit = 50) {
  ensure(db);
  return db.prepare('SELECT key, name, at, used_t, result FROM entity_lookups WHERE state = ? ORDER BY used_t DESC, key LIMIT ?').all(state, limit)
    .map((r) => ({ key: r.key, name: r.name, at: r.at, usedT: r.used_t, result: json(r.result) }));
}
function setLookup(db, key, state, at, result) {
  ensure(db);
  db.prepare('UPDATE entity_lookups SET state = ?, at = ?, result = ? WHERE key = ?').run(state, at, result === null ? null : JSON.stringify(result), key);
}

module.exports = { ensure, recordSeen, firstListed, storiesOf, lookup, want, inState, setLookup, inTransaction, KEPT_SECONDS, SEEN_AGAIN_SECONDS };
