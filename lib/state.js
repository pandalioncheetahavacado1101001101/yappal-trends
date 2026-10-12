'use strict';
/*
 * The state folder (ios/IDEAS-FEED.md A2): the lock, collector.db (node:sqlite, one plain file at rest), and where the engine's store,
 * the raw replies and the Wikipedia lists live. Every write to the db is `INSERT OR REPLACE` on its key, so a step that ran twice for
 * the same slot leaves the same rows (A3).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const STATE_VERSION = 1;
const LOCK_STALE_SECONDS = 20 * 60;
const BACKUPS_KEPT = 7;

const SAMPLE_COLUMNS = ['sv_us', 'sv_gb', 'sv_au', 'sv_ca', 'sg_us', 'sg_gb', 'sg_au', 'sg_ca', 's_live', 'n1', 'n24', 'outlets', 'cr', 'yt_h', 'tt_videos', 'tt_views',
  'rd_rank', 'rd', 'soc', 'wiki', 'kinds', 'interest', 'h_us', 'h_gb', 'h_au', 'h_ca', 'h_mx', 'r_us', 'r_gb', 'r_au', 'r_ca', 'r_mx', 'flags',
  // (the five parts of I as sampled, NULL when a part was not read this cycle: carrying on reading needs no other row, C1)
  'p_s', 'p_n', 'p_c', 'p_r', 'p_w'];
// (reseeded: read back from the feed already out after the state was lost, lib/reseed.js: drawn, never counted as a sample of its own)
const FLAG = { early: 1, page: 2, backfilled: 4, partial: 8, carried: 16, reseeded: 32 };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS trends (
  id TEXT PRIMARY KEY, natural_key TEXT NOT NULL, kind TEXT NOT NULL, sub TEXT, class TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  started_at INTEGER, started_precision TEXT, started_day TEXT,
  peak_at INTEGER, peak_interest REAL,
  early_at INTEGER, early_gone_at INTEGER, promoted_at INTEGER, chapter_at INTEGER, ended_at INTEGER, closed_at INTEGER,
  first_listed_at TEXT, first_page_at TEXT,
  status TEXT, status_test TEXT, faded INTEGER, not_climbing INTEGER,
  title TEXT, info TEXT);
CREATE INDEX IF NOT EXISTS trends_last_seen ON trends (last_seen);
CREATE TABLE IF NOT EXISTS aliases (key TEXT PRIMARY KEY, trend_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS samples (
  trend_id TEXT NOT NULL, t INTEGER NOT NULL, res INTEGER NOT NULL,
  ${SAMPLE_COLUMNS.map((c) => `${c} ${c === 'interest' || c.startsWith('p_') || c === 'soc' || c.startsWith('h_') ? 'REAL' : 'INTEGER'}`).join(', ')},
  PRIMARY KEY (trend_id, t, res)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS texts (trend_id TEXT NOT NULL, t INTEGER NOT NULL, title TEXT, line TEXT, line_written_by TEXT, PRIMARY KEY (trend_id, t)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS events (trend_id TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, precision TEXT NOT NULL, text TEXT NOT NULL, seen INTEGER NOT NULL,
  PRIMARY KEY (trend_id, at, kind)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lifetimes (trend_id TEXT PRIMARY KEY, class TEXT NOT NULL, start INTEGER NOT NULL, peak INTEGER NOT NULL, end INTEGER NOT NULL, peak_interest REAL NOT NULL);
CREATE TABLE IF NOT EXISTS lines (trend_id TEXT NOT NULL, source_hash TEXT NOT NULL, t INTEGER NOT NULL, line TEXT, ok INTEGER NOT NULL, why TEXT, basis TEXT,
  PRIMARY KEY (trend_id, source_hash)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS queue (key TEXT PRIMARY KEY, kind TEXT NOT NULL, host TEXT NOT NULL, priority INTEGER NOT NULL, due INTEGER NOT NULL, not_before INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, payload TEXT);
CREATE TABLE IF NOT EXISTS hosts (host TEXT PRIMARY KEY, blocked_until INTEGER, strikes INTEGER NOT NULL DEFAULT 0, last_ok_at INTEGER, last_status INTEGER,
  first_turned_away_at INTEGER, timeouts INTEGER NOT NULL DEFAULT 0, last_request_at INTEGER);
CREATE TABLE IF NOT EXISTS fetches (cycle INTEGER NOT NULL, source TEXT NOT NULL, host TEXT, t INTEGER, status INTEGER, bytes INTEGER, ms INTEGER, PRIMARY KEY (cycle, source)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS fetches_source ON fetches (source, t);
`;

/** The folders and files of a state directory. */
function pathsOf(dir) {
  return { dir, lock: path.join(dir, 'lock'), db: path.join(dir, 'collector.db'), store: path.join(dir, 'engine', 'store.json'), raw: path.join(dir, 'engine', 'raw'),
    wiki: path.join(dir, 'engine', 'wiki'), archive: path.join(dir, 'archive'), backup: path.join(dir, 'backup') };
}

/** Whether a lock's holder is known to be gone: it ran on this very host and no process has its pid any more (a cycle that was killed). */
function holderGone(held, host = os.hostname()) {
  if (!held || held.host !== host || !Number.isInteger(held.pid) || held.pid <= 0) return false;
  try { process.kill(held.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
}

/** Whether a lock's holder is known to be alive: it ran on this very host and a process still has its pid (asleep with the lid closed, or slow). */
function holderAlive(held, host = os.hostname()) {
  if (!held || held.host !== host || !Number.isInteger(held.pid) || held.pid <= 0) return false;
  try { process.kill(held.pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const LOCK_WRITING_SECONDS = 5;
/**
 * Takes the lock: true when this run holds it; false when another cycle does. The lock is { pid, host, startedAt, wallAt }. One whose
 * holder died on this host is broken at once (a killed cycle never costs the next one its turn). One older than 20 minutes by the
 * wall clock is stale and is broken (staleness is real time, whatever --now says), but never while its holder is alive on this host:
 * a cycle that slept with the lid closed wakes holding its lock, and nobody else has run under it (reviewers, 2026-10-12: it woke
 * hours later and wrote its old slot over the newer one). A lock from another host is only ever broken by its age.
 * A stale lock is broken by renaming it aside, so of two starters that both read it stale one wins and the other finds the winner's
 * lock; a lock file caught between its making and its writing is not stale.
 */
function takeLock(dir, nowSeconds, pid = process.pid) {
  const p = pathsOf(dir);
  fs.mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ pid, host: os.hostname(), startedAt: nowSeconds, wallAt: Math.floor(Date.now() / 1000) });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(p.lock, body, { flag: 'wx' }); return true; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let text = null;
      let held = null;
      try { text = fs.readFileSync(p.lock, 'utf8'); held = JSON.parse(text); } catch { held = null; }
      if (!held) {
        // (empty or half-written: another starter is writing it right now, unless it has sat like that for seconds)
        let age = Infinity;
        try { age = Date.now() / 1000 - fs.statSync(p.lock).mtimeMs / 1000; } catch { continue; }
        if (age < LOCK_WRITING_SECONDS) return false;
      }
      const old = !held || !Number.isFinite(held.wallAt) || Math.floor(Date.now() / 1000) - held.wallAt > LOCK_STALE_SECONDS;
      const stale = holderGone(held) || (old && !holderAlive(held));
      if (!stale) return false;
      const aside = `${p.lock}.broken-${pid}-${Date.now()}`;
      try { fs.renameSync(p.lock, aside); } catch (err) { if (err.code === 'ENOENT') continue; throw err; }
      // (what was moved aside must be the very lock read as stale: a fresh one another starter took in between goes back)
      let moved = null;
      try { moved = fs.readFileSync(aside, 'utf8'); } catch { moved = null; }
      if (moved !== text) {
        try { fs.linkSync(aside, p.lock); } catch { /* a newer lock stands: the one moved aside lost its turn */ }
        fs.rmSync(aside, { force: true });
        return false;
      }
      fs.rmSync(aside, { force: true });
    }
  }
  return false;
}
/** Whether the lock is still this run's: the same pid on this host, taken at the same `nowSeconds`. What a cycle asks again before it writes (A3). */
function holdsLock(dir, nowSeconds, pid = process.pid) {
  let held = null;
  try { held = JSON.parse(fs.readFileSync(pathsOf(dir).lock, 'utf8')); } catch { held = null; }
  return !!held && held.pid === pid && (!held.host || held.host === os.hostname()) && held.startedAt === nowSeconds;
}
/** Releases the lock, when it is still this run's: a cycle that overran and had its lock broken never removes the lock of the run that took over. */
function releaseLock(dir, pid = process.pid) {
  const file = pathsOf(dir).lock;
  let held = null;
  try { held = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { held = null; }
  if (held && (held.pid !== pid || (held.host && held.host !== os.hostname()))) return false;
  fs.rmSync(file, { force: true });
  return true;
}

/** Opens (and creates) the state: { db, paths, meta: { get, set }, close }. */
function openState(dir) {
  const paths = pathsOf(dir);
  for (const d of [dir, path.dirname(paths.store), paths.raw, paths.wiki, paths.archive, paths.backup]) fs.mkdirSync(d, { recursive: true });
  const db = new DatabaseSync(paths.db);
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=OFF;');
  db.exec(SCHEMA);
  // (a state made before the line writer: `lines` gains what a rewrite is decided on, G5)
  if (!db.prepare('PRAGMA table_info(lines)').all().some((c) => c.name === 'basis')) db.exec('ALTER TABLE lines ADD COLUMN basis TEXT');
  const getStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
  const setStmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  const meta = {
    get: (key, fallback = null) => { const row = getStmt.get(key); if (!row) return fallback; try { return JSON.parse(row.value); } catch { return fallback; } },
    set: (key, value) => { setStmt.run(key, JSON.stringify(value)); },
  };
  if (meta.get('stateVersion') === null) meta.set('stateVersion', STATE_VERSION);
  return { db, paths, meta, close: () => db.close() };
}

/**
 * Whether a state folder holds a state worth keeping: { ok, why, cycle, trends }. What the host asks before it saves the folder as
 * the newest (a state born empty by a missed restore, or cut short by a killed job, is never saved over a good one) and what a
 * cycle asks before it trusts the folder it was handed. Whole means: collector.db opens and passes SQLite's own check, a cycle
 * has been counted in it, it knows at least one trend, and the engine's store, when there is one, reads as JSON. Opens the db
 * read-only and writes nothing.
 */
function health(dir) {
  const p = pathsOf(dir);
  const bad = (why) => ({ ok: false, why, cycle: 0, trends: 0 });
  if (!fs.existsSync(p.db)) return bad('no collector.db');
  if (fs.statSync(p.db).size < DB_MIN_BYTES) return bad('collector.db is cut short');
  let db = null;
  try {
    db = new DatabaseSync(p.db, { readOnly: true });
    const check = db.prepare('PRAGMA quick_check').all();
    if (!(check.length === 1 && Object.values(check[0])[0] === 'ok')) return bad('collector.db fails its integrity check');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    for (const name of ['meta', 'trends', 'samples', 'aliases']) if (!tables.has(name)) return bad(`collector.db has no ${name} table`);
    const row = db.prepare("SELECT value FROM meta WHERE key = 'cycle'").get();
    const cycle = row ? Number(JSON.parse(row.value)) || 0 : 0;
    const trends = db.prepare('SELECT COUNT(*) AS n FROM trends').get().n;
    if (cycle < 1) return { ok: false, why: 'no cycle has finished on it', cycle, trends };
    if (trends < 1) return { ok: false, why: 'it knows no trend', cycle, trends };
    if (fs.existsSync(p.store) && fs.statSync(p.store).size > 0) { try { JSON.parse(fs.readFileSync(p.store, 'utf8')); } catch { return { ok: false, why: 'engine/store.json does not read', cycle, trends }; } }
    return { ok: true, why: null, cycle, trends };
  } catch (e) {
    return bad(`collector.db does not open: ${e && e.message ? e.message : e}`);
  } finally {
    if (db) { try { db.close(); } catch { /* it never opened */ } }
  }
}
const DB_MIN_BYTES = 4096;
/**
 * A collector.db that is there and does not read (a restore cut short, a disk that lied) is moved aside, with its journal, as
 * collector.db.unreadable-<stamp>, never written over and never opened again: the cycle then starts from the newest daily backup
 * the folder holds, else from nothing (and re-seeds itself from the feed already out: lib/reseed.js). Returns
 * { setAside: file | null, restored: backup name | null }. A folder with no db, or a db that reads, is left as it is.
 */
function recover(dir, stamp = Date.now()) {
  const p = pathsOf(dir);
  if (!fs.existsSync(p.db)) return { setAside: null, restored: null };
  let reads = fs.statSync(p.db).size === 0;
  if (!reads) {
    let db = null;
    try {
      db = new DatabaseSync(p.db);
      const check = db.prepare('PRAGMA quick_check').all();
      reads = check.length === 1 && Object.values(check[0])[0] === 'ok';
    } catch { reads = false; } finally { if (db) { try { db.close(); } catch { /* it never opened */ } } }
  }
  if (reads) return { setAside: null, restored: null };
  const aside = `${p.db}.unreadable-${stamp}`;
  fs.renameSync(p.db, aside);
  if (fs.existsSync(`${p.db}-journal`)) fs.renameSync(`${p.db}-journal`, `${aside}-journal`);
  const backups = fs.existsSync(p.backup) ? fs.readdirSync(p.backup).filter((n) => /^collector-\d{4}-\d\d-\d\d\.db\.gz$/.test(n)).sort().reverse() : [];
  for (const name of backups) {
    try {
      fs.writeFileSync(`${p.db}.new`, zlib.gunzipSync(fs.readFileSync(path.join(p.backup, name))));
      fs.renameSync(`${p.db}.new`, p.db);
      if (health(dir).ok) return { setAside: aside, restored: name };
    } catch { /* a backup that does not read is passed over */ }
    fs.rmSync(p.db, { force: true });
    fs.rmSync(`${p.db}.new`, { force: true });
  }
  return { setAside: aside, restored: null };
}

/** Runs `work` inside one transaction; a throw rolls it back and is rethrown. */
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = work();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* the first error is the one that matters */ }
    throw e;
  }
}

/** Writes a file as `.new`, then renames it into place: a failed write never leaves a cut file behind. */
function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.new`, body);
  fs.renameSync(`${file}.new`, file);
}

/** One gzipped copy of the db a day (taken after a checkpointed close of the writes: the journal is DELETE, the file is whole), seven kept. */
function backupDaily(state, ymd) {
  const file = path.join(state.paths.backup, `collector-${ymd}.db.gz`);
  if (fs.existsSync(file)) return false;
  writeAtomic(file, zlib.gzipSync(fs.readFileSync(state.paths.db)));
  const old = fs.readdirSync(state.paths.backup).filter((n) => /^collector-\d{4}-\d\d-\d\d\.db\.gz$/.test(n)).sort();
  for (const n of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) fs.rmSync(path.join(state.paths.backup, n), { force: true });
  return true;
}

module.exports = { STATE_VERSION, SAMPLE_COLUMNS, FLAG, LOCK_STALE_SECONDS, pathsOf, takeLock, releaseLock, holdsLock, holderGone, holderAlive, openState, transaction, writeAtomic, backupDaily, health, recover };
