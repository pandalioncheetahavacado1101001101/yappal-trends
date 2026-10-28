'use strict';
/*
 * The precursor's private log (2026-10-31, wave 9 lane precursor): each cycle's candidates with their features, appended to one file a
 * UTC day. PRIVATE BY PLACE: it lives inside the collector's state folder (`<state>/precursor/`), which on the runner is kept only
 * under the never-published "state-" cache key and on the VM in its private state; the publish step copies `out/v1` and never the
 * state. Never in the feed, the ledger, status.json, a log line or a repository: lines out of this module are counts.
 *
 * Bounded: a day's file stops growing at DAY_BYTES_MAX (gzip members, so a half-written member never spoils the rest), and files
 * older than KEEP_DAYS are deleted. Every write is wrapped: a full disk or a read-only folder costs the log, never the cycle.
 * IDEAS_PRECURSOR_LOG=<dir> moves it (the VM's private learn folder); IDEAS_PRECURSOR_LOG=off writes nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DAY = 86400;
const KEEP_DAYS = 16;
const DAY_BYTES_MAX = 3 * 1024 * 1024;
const FILE = /^log-(\d{4}-\d\d-\d\d)\.jsonl\.gz$/;

const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/** The log's folder: IDEAS_PRECURSOR_LOG when set (off/0: none), else `<state>/precursor`. */
function dirOf(stateDir, env = process.env) {
  const v = String(env.IDEAS_PRECURSOR_LOG || '').trim();
  if (v === 'off' || v === '0') return null;
  if (v) return v;
  return stateDir ? path.join(stateDir, 'precursor') : null;
}

/**
 * Appends one cycle's records (plain objects) to the day's file of slot t. Returns { written (records), bytes (compressed), skipped
 * (records refused: the day is full or the write failed), error (message or null) }.
 */
function append(dir, t, records) {
  const none = { written: 0, bytes: 0, skipped: (records || []).length, error: null };
  if (!dir || !records || !records.length) return { ...none, skipped: 0 };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `log-${dayOf(t)}.jsonl.gz`);
    const have = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const body = zlib.gzipSync(Buffer.from(`${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8'));
    if (have + body.length > DAY_BYTES_MAX) return none;
    fs.appendFileSync(file, body);
    return { written: records.length, bytes: body.length, skipped: 0, error: null };
  } catch (e) {
    return { ...none, error: e.message };
  }
}

/** Deletes day files older than keepDays before slot t. Returns the number deleted. */
function prune(dir, t, keepDays = KEEP_DAYS) {
  if (!dir || !fs.existsSync(dir)) return 0;
  const cut = dayOf(t - keepDays * DAY);
  let n = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(FILE);
      if (m && m[1] < cut) { fs.rmSync(path.join(dir, name), { force: true }); n += 1; }
    }
  } catch { /* (a prune that fails is retried next cycle) */ }
  return n;
}

/** Every record of the days from..to (YYYY-MM-DD, inclusive), oldest day first. A file that cannot be read whole gives what it can. */
function read(dir, from, to) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const m = name.match(FILE);
    if (!m || m[1] < from || m[1] > to) continue;
    let text = '';
    try { text = zlib.gunzipSync(fs.readFileSync(path.join(dir, name)), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf8'); } catch { continue; }
    for (const line of text.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* (a torn line) */ } }
  }
  return out;
}

/** The bytes the log holds on disk, by day: { day: bytes }. */
function sizes(dir) {
  if (!dir || !fs.existsSync(dir)) return {};
  return Object.fromEntries(fs.readdirSync(dir).map((n) => [n, n.match(FILE)]).filter(([, m]) => m).map(([n, m]) => [m[1], fs.statSync(path.join(dir, n)).size]));
}

module.exports = { KEEP_DAYS, DAY_BYTES_MAX, dirOf, append, prune, read, sizes, dayOf };
