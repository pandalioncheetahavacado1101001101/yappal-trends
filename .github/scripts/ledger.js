#!/usr/bin/env node
'use strict';
/*
 * One line of the ledger (ledger.jsonl on the feed branch; .github/scripts/ledger.sh fetches and publishes the file):
 *
 *   node .github/scripts/ledger.js <ledger.jsonl>
 *
 * Appends this run's line and drops every line older than 7 days (and anything past 800 lines: a week is 672 quarter-hours).
 * Each line: { slot, started, published, rows, requests, answered, modelCards, seconds, code, by, run, phases, cache, enrich, stories, gdelt }
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
 *                 wait          the wait for the quarter-hour (chain.sh align): a chained run is ready before its slot begins
 *                 cardsRestore  the enrich pass's newest cards, restored from their cache key after the wait (ios/IDEAS-SUPER.md P11)
 *                 modelRestore  the editor model's cache restore (several GB); null since P11: collect starts no model
 *                 modelStart    the model server installed, started, the model loaded and warmed (model.sh); null since P11
 *                 cycle         collect.js as a process, start to exit; inside it, its own steps (its summary's `seconds`,
 *                               only when it published): fetch, build, measure, lines (less the editor), editor, feed, publish
 *                 push          the feed pushed to the branch (publish-feed.sh)
 *                 stateSave     the state's health check and its cache save
 *                 cachePrune    the superseded state entries deleted (cache-prune.js)
 *   cache       the repository's Actions cache after the prune, else null: { gb, entries, model (an editor model is in it),
 *               deleted (state entries deleted this run), failed (deletes refused) }
 *   enrich      the enrich pass whose cards this cycle imported (enrich.yml, P11; the collector's summary), else null:
 *                 run           the pass's Actions run id (null: no cards restored); age: minutes since its merge
 *                 fresh         the first cycle to import this pass: its asked, passed, seconds and shards are counted once by
 *                               reading only the lines where it is true
 *                 asked         rows the pass's shards asked the model for (first asks); passed: cards the gate passed
 *                 seconds       the pass, plan to merge; shards: dealt; shardsDone: parts merged; perCard: the model's
 *                               measured seconds a card (the median of the last passes), what the next pass is sized from
 *                 imported      cards this cycle took into its cache, each for its row's dossier as it is now; held: already
 *                               in it; stale: rows whose cards were for a story that has moved since (dropped, never shown)
 *                 planned       rows this cycle left owed for the next pass; passPlanned: the pass's own
 *                 whys, angles  on the cards the gate passed, the whys and the angles the model offered; whysPassed, anglesPassed:
 *                               those the claim check passed (ios/IDEAS-SUPER.md P12: the gate's pass rate, published)
 *   stories     the enrich pass's stories by meaning this cycle read (ios/IDEAS-SUPER.md P8; the collector's summary), else null:
 *                 age           minutes since the pass made them (null: none read); size: sentences they hold
 *                 joined        rows the desk folded into another by meaning on the main list; planned: rows left for the next pass
 *                 texts         texts the pass clustered; vectors: of them, with a vector; seconds: the pass's own
 *   gdelt       GDELT name discovery this cycle (ios/IDEAS-SUPER.md P13; the collector's summary, lib/discover.js), else null:
 *                 on            whether it acted (IDEAS_GDELT); since: the slot it was switched on (null while off): P13's
 *                               7 days before and after on the scoreboard's lead and coverage "first" are read from there
 *                 read          GDELT's slot was read this cycle; seen: names in it; passed: names breaking out; fresh: of
 *                               them, the ones nobody searched lately and the list does not hold; searched: of those, sent
 *                 minted        rows of the US list new this cycle about a name it passed; boosted: rows already listed about
 *                               a name breaking out now; page: of those, on page one
 *                 baseHours     hours of baseline behind the test; weekly: the same quarter-hour last week was in it
 * Marks: MARK_BEGIN, MARK_SETUP, MARK_STATE, MARK_FEED, MARK_WAITED, MARK_MODEL, MARK_CYCLE, MARK_CYCLE_END, MARK_PUSHED, MARK_SAVED, MARK_LEDGER
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
  const m = Object.fromEntries(['BEGIN', 'SETUP', 'STATE', 'FEED', 'WAITED', 'MODEL', 'CYCLE', 'CYCLE_END', 'PUSHED', 'SAVED', 'LEDGER'].map((k) => [k, markOf(env[`MARK_${k}`])]));
  const begin = m.BEGIN ?? markOf(env.LEDGER_STARTED);
  const ledgerAt = m.LEDGER ?? nowMs;
  const own = summary && summary.seconds && typeof summary.seconds === 'object' ? summary.seconds : {};
  const pruneSeconds = prune ? numberOrNull(prune.seconds) : null;
  return {
    setup: between(begin, m.SETUP),
    stateRestore: between(m.SETUP, m.STATE),
    feedRead: between(m.STATE, m.FEED),
    // (P11: the wait for the quarter-hour, then the cards restored; both null for a job of the model's days)
    wait: m.WAITED === null ? null : between(m.FEED, m.WAITED),
    cardsRestore: m.WAITED === null || m.MODEL !== null ? null : between(m.WAITED, m.CYCLE),
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

const ENRICH_NUMBERS = ['run', 'age', 'asked', 'passed', 'seconds', 'shards', 'shardsDone', 'perCard', 'imported', 'held', 'stale', 'planned', 'passPlanned', 'whys', 'whysPassed', 'angles', 'anglesPassed',
  'calls', 'lanes', 'ready', 'metered', 'promptTokens', 'promptSeconds', 'replyTokens', 'replySeconds', 'loadSeconds',
  // (2026-10-27, enrich v2: the stories answered and the replies cut at the allowance, so the compact prompt's fallback triggers,
  // passed of answered under 0.72 or cut above 0, read from the ledger and not only the Actions log; unanswered is asked less answered)
  'answered', 'cut'];
/** The enrich pass as the collector's summary tells it (P11), numbers and one flag only, or null when the summary has none. */
function enrichOf(summary) {
  const e = summary && summary.enrich && typeof summary.enrich === 'object' ? summary.enrich : null;
  if (!e) return null;
  return { ...Object.fromEntries(ENRICH_NUMBERS.map((k) => [k, numberOrNull(e[k])])), fresh: e.fresh === true };
}

const STORIES_NUMBERS = ['age', 'size', 'joined', 'planned', 'texts', 'vectors', 'seconds'];
/** The stories by meaning as the collector's summary tells it (P8), numbers only, or null when the summary has none. */
function storiesOf(summary) {
  const s = summary && summary.stories && typeof summary.stories === 'object' ? summary.stories : null;
  return s ? Object.fromEntries(STORIES_NUMBERS.map((k) => [k, numberOrNull(s[k])])) : null;
}

const GDELT_NUMBERS = ['seen', 'passed', 'fresh', 'searched', 'minted', 'boosted', 'page', 'baseHours'];
/** GDELT name discovery as the collector's summary tells it (P13): flags, the switch-on instant and counts only, or null when none. */
function gdeltOf(summary) {
  const g = summary && summary.gdelt && typeof summary.gdelt === 'object' ? summary.gdelt : null;
  if (!g) return null;
  const since = typeof g.since === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(g.since) ? g.since : null;
  return { on: g.on === true, since, read: g.read === true, ...Object.fromEntries(GDELT_NUMBERS.map((k) => [k, numberOrNull(g[k])])), weekly: g.weekly === true };
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
    enrich: enrichOf(summary),
    stories: storiesOf(summary),
    gdelt: gdeltOf(summary),
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

module.exports = { lineOf, keep, phasesOf, markOf, enrichOf, storiesOf, gdeltOf };
if (require.main === module) process.exit(main());
