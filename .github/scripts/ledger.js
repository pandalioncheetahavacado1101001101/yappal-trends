#!/usr/bin/env node
'use strict';
/*
 * One line of the ledger (ledger.jsonl on the feed branch; .github/scripts/ledger.sh fetches and publishes the file):
 *
 *   node .github/scripts/ledger.js <ledger.jsonl>
 *
 * Appends this run's line and drops every line older than 7 days (and anything past 800 lines: a week is 672 quarter-hours).
 * Each line: { slot, started, published, rows, requests, answered, modelCards, seconds, code, by, run, phases, cache }
 *   slot        the collector's own slot when a feed was published (status.json), else the quarter-hour nearest the job's start
 *   started     when the cycle job started (its clock, LEDGER_STARTED: epoch seconds)
 *   published   the feed's generatedAt when this run published one, else null: lead time is published minus slot
 *   rows        rows in the US list published, else null
 *   requests    requests the cycle sent, else null (a cycle that publishes nothing prints no summary); answered: of them, answered
 *   modelCards  rows whose line the editor model wrote, else null
 *   seconds     seconds from the job's start to this line
 *   code        the cycle's exit code (0 published, 1 nothing new, 2 lock, 3 failed), null when it never ran
 *   by          how the run was started: schedule (the cron), chain (the run before it), hand
 *   run         the Actions run id
 *   phases      where the job's time went, seconds (0.1 s), in the job's order; null where a step did not run or a mark is missing:
 *                 setup         checkout and node, from the job's clock
 *                 stateRestore  the state's cache restore
 *                 feedRead      the feed already out, fetched (restore.sh)
 *                 modelRestore  the editor model's cache restore (several GB)
 *                 modelStart    the model server installed, started, the model loaded and warmed (model.sh)
 *                 cycle         collect.js as a process, start to exit; inside it, its own steps (its summary's `seconds`,
 *                               only when it published): fetch, build, measure, lines (less the editor), editor, feed, publish
 *                 push          the feed pushed to the branch (publish-feed.sh)
 *                 stateSave     the state's health check and its cache save
 *                 cachePrune    the superseded state entries deleted (cache-prune.js)
 *   cache       the repository's Actions cache after the prune, else null: { gb, entries, model (an editor model is in it),
 *               deleted (state entries deleted this run), failed (deletes refused) }
 * Marks: MARK_BEGIN, MARK_SETUP, MARK_STATE, MARK_FEED, MARK_MODEL, MARK_CYCLE, MARK_CYCLE_END, MARK_PUSHED, MARK_SAVED, MARK_LEDGER
 * (epoch milliseconds, set by collect.yml's steps; seconds are read as such). Reads cycle.json (the collector's one-line summary,
 * empty unless it published), out/v1/status.json and cache-prune.json from the working folder.
 * Nothing private: instants, counts and seconds only, never a name, a key or a per-trend number. Zero dependencies.
 * Exit 0 when the line is written, 1 when not.
 */
const fs = require('node:fs');
const path = require('node:path');

const KEPT_MS = 7 * 24 * 3600 * 1000;
const MAX_LINES = 800;
const SLOT_MS = 15 * 60 * 1000;
const PHASE_MAX_SECONDS = 24 * 3600;
// the collector's own steps, as its summary names them (collect.js `seconds`)
const CYCLE_STEPS = ['fetch', 'build', 'measure', 'lines', 'editor', 'feed', 'publish'];

const instant = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (file) => { try { const text = fs.readFileSync(file, 'utf8').trim(); return text ? JSON.parse(text.split('\n').pop()) : null; } catch { return null; } };
const numberOrNull = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const tenth = (s) => Math.round(s * 10) / 10;

/** A mark as epoch milliseconds: 13 digits are milliseconds, 10 are seconds; anything else (a `date` with no %N reads "…3N") is null. */
function markOf(v) {
  const s = String(v ?? '').trim();
  if (/^\d{13}$/.test(s)) return Number(s);
  if (/^\d{10}$/.test(s)) return Number(s) * 1000;
  return null;
}

/** Seconds from one mark to the next, or null when either is missing or the two are out of order. */
function between(from, to) {
  if (from === null || to === null || to < from) return null;
  const s = (to - from) / 1000;
  return s > PHASE_MAX_SECONDS ? null : tenth(s);
}

/** Where the job's time went (the `phases` above), from the marks and the collector's and the prune's own seconds. */
function phasesOf(env, nowMs, summary, prune) {
  const m = Object.fromEntries(['BEGIN', 'SETUP', 'STATE', 'FEED', 'MODEL', 'CYCLE', 'CYCLE_END', 'PUSHED', 'SAVED', 'LEDGER'].map((k) => [k, markOf(env[`MARK_${k}`])]));
  const begin = m.BEGIN ?? markOf(env.LEDGER_STARTED);
  const ledgerAt = m.LEDGER ?? nowMs;
  const own = summary && summary.seconds && typeof summary.seconds === 'object' ? summary.seconds : {};
  const pruneSeconds = prune ? numberOrNull(prune.seconds) : null;
  return {
    setup: between(begin, m.SETUP),
    stateRestore: between(m.SETUP, m.STATE),
    feedRead: between(m.STATE, m.FEED),
    // (no model step this run, the editor off or the owner's endpoint: both null)
    modelRestore: m.MODEL === null ? null : between(m.FEED, m.MODEL),
    modelStart: m.MODEL === null ? null : between(m.MODEL, m.CYCLE),
    cycle: between(m.CYCLE, m.CYCLE_END),
    ...Object.fromEntries(CYCLE_STEPS.map((k) => { const s = numberOrNull(own[k]); return [k, s === null || s < 0 ? null : tenth(s)]; })),
    push: between(m.CYCLE_END, m.PUSHED),
    stateSave: between(m.PUSHED, m.SAVED ?? ledgerAt),
    cachePrune: pruneSeconds === null || pruneSeconds < 0 ? null : tenth(pruneSeconds),
  };
}

/** The cache's counts after the prune (cache-prune.json), or null when the prune did not run or could not list the cache. */
function cacheOf(prune) {
  if (!prune || numberOrNull(prune.gb) === null) return null;
  return { gb: numberOrNull(prune.gb), entries: numberOrNull(prune.entries), model: typeof prune.model === 'boolean' ? prune.model : null,
    deleted: numberOrNull(prune.deleted) ?? 0, failed: numberOrNull(prune.failed) ?? 0 };
}

function lineOf(env, nowMs, summary, status, prune = null) {
  const startedMs = Number(env.LEDGER_STARTED) > 0 ? Number(env.LEDGER_STARTED) * 1000 : nowMs;
  const published = env.LEDGER_PUBLISHED === 'true';
  const items = summary && summary.items && typeof summary.items === 'object' ? summary.items : null;
  const rows = items ? numberOrNull(items.US !== undefined ? items.US : Object.values(items)[0]) : null;
  return {
    slot: published && status && typeof status.slot === 'string' ? status.slot : instant(Math.round(startedMs / SLOT_MS) * SLOT_MS),
    started: instant(startedMs),
    published: published ? (status && typeof status.generatedAt === 'string' ? status.generatedAt : instant(nowMs)) : null,
    rows,
    requests: summary ? numberOrNull(summary.requests) : null,
    answered: summary ? numberOrNull(summary.answered) : null,
    modelCards: summary ? numberOrNull(summary.modelLines) : null,
    seconds: Math.max(0, Math.round((nowMs - startedMs) / 1000)),
    code: numberOrNull(env.LEDGER_CODE),
    by: env.STARTED_BY || null,
    run: numberOrNull(env.GITHUB_RUN_ID),
    phases: phasesOf(env, nowMs, summary, prune),
    cache: cacheOf(prune),
  };
}

// the lines kept: those that parse and started inside the last 7 days, newest MAX_LINES
function keep(text, nowMs) {
  const kept = [];
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    let line;
    try { line = JSON.parse(t); } catch { continue; }
    const at = Date.parse(line && line.started);
    if (!Number.isFinite(at) || nowMs - at > KEPT_MS) continue;
    kept.push(t);
  }
  return kept.slice(-MAX_LINES);
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: ledger.js <ledger.jsonl>'); return 1; }
  const nowMs = Date.now();
  const summary = readJson(process.env.LEDGER_CYCLE || 'cycle.json');
  const status = readJson(process.env.LEDGER_STATUS || path.join('out', 'v1', 'status.json'));
  const prune = readJson(process.env.LEDGER_PRUNE || 'cache-prune.json');
  const line = lineOf(process.env, nowMs, summary, status, prune);
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch { before = ''; }
  const lines = [...keep(before, nowMs), JSON.stringify(line)];
  fs.writeFileSync(`${file}.new`, `${lines.join('\n')}\n`);
  fs.renameSync(`${file}.new`, file);
  console.log(`ledger: ${JSON.stringify(line)}`);
  return 0;
}

module.exports = { lineOf, keep, phasesOf, markOf };
if (require.main === module) process.exit(main());
