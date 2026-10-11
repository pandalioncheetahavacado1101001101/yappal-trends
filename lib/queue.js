'use strict';
/*
 * Owed work (ios/IDEAS-FEED.md A2 `queue`, A4): the lookups the engine's last build still wants. Each build says what is owed now;
 * `sync` makes the table say the same (keeping how often a row was tried), `due` hands a cycle the rows it may spend, a row is deleted
 * only once its reply is saved, and one that failed waits longer each time so it never eats the budget every cycle.
 */
const { transaction } = require('./state');
const { HOUR } = require('./util');

const RETRY_FIRST_SECONDS = 15 * 60;
const RETRY_MAX_SECONDS = 6 * HOUR;

/** Makes the queue hold exactly `requests` (in priority order) for the kinds they cover; rows already there keep their attempts and their wait. */
function sync(db, requests, now) {
  const old = new Map(db.prepare('SELECT key, attempts, not_before FROM queue').all().map((r) => [r.key, r]));
  const put = db.prepare('INSERT OR REPLACE INTO queue (key, kind, host, priority, due, not_before, attempts, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  transaction(db, () => {
    const keep = new Set(requests.map((r) => r.id));
    for (const key of old.keys()) if (!keep.has(key)) db.prepare('DELETE FROM queue WHERE key = ?').run(key);
    requests.forEach((r, i) => {
      const was = old.get(r.id);
      put.run(r.id, r.kind, r.host, i, now, was ? was.not_before : 0, was ? was.attempts : 0, JSON.stringify(r));
    });
  });
}
/** The owed requests a cycle may send now, in priority order. */
const due = (db, now) => db.prepare('SELECT payload FROM queue WHERE not_before <= ? ORDER BY priority').all(now).map((r) => JSON.parse(r.payload));
/** A reply was saved: the row goes. */
const done = (db, key) => { db.prepare('DELETE FROM queue WHERE key = ?').run(key); };
/** A request failed: it waits 15 minutes, doubling to 6 hours. */
function failed(db, key, now) {
  const row = db.prepare('SELECT attempts FROM queue WHERE key = ?').get(key);
  if (!row) return;
  const wait = Math.min(RETRY_MAX_SECONDS, RETRY_FIRST_SECONDS * Math.pow(2, Math.min(10, row.attempts)));
  db.prepare('UPDATE queue SET attempts = ?, not_before = ? WHERE key = ?').run(row.attempts + 1, now + wait, key);
}

module.exports = { sync, due, done, failed };
