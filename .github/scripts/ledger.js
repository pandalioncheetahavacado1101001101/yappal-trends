#!/usr/bin/env node
'use strict';
/*
 * One line of the ledger (ledger.jsonl on the feed branch; .github/scripts/ledger.sh fetches and publishes the file):
 *
 *   node .github/scripts/ledger.js <ledger.jsonl>
 *
 * Appends this run's line and drops every line older than 7 days (and anything past 800 lines: a week is 672 quarter-hours).
 * Each line: { slot, started, published, rows, requests, modelCards, seconds, code, by, run }
 *   slot        the collector's own slot when a feed was published (status.json), else the quarter-hour nearest the job's start
 *   started     when the cycle job started (its clock, LEDGER_STARTED: epoch seconds)
 *   published   the feed's generatedAt when this run published one, else null: lead time is published minus slot
 *   rows        rows in the US list published, else null
 *   requests    requests the cycle sent, else null (a cycle that publishes nothing prints no summary)
 *   modelCards  rows whose line the editor model wrote, else null
 *   seconds     seconds from the job's start to this line
 *   code        the cycle's exit code (0 published, 1 nothing new, 2 lock, 3 failed), null when it never ran
 *   by          how the run was started: schedule (the cron), chain (the run before it), hand
 *   run         the Actions run id
 * Reads cycle.json (the collector's one-line summary, empty unless it published) and out/v1/status.json from the working folder.
 * Nothing private: instants and counts only. Zero dependencies. Exit 0 when the line is written, 1 when not.
 */
const fs = require('node:fs');
const path = require('node:path');

const KEPT_MS = 7 * 24 * 3600 * 1000;
const MAX_LINES = 800;
const SLOT_MS = 15 * 60 * 1000;

const instant = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (file) => { try { const text = fs.readFileSync(file, 'utf8').trim(); return text ? JSON.parse(text.split('\n').pop()) : null; } catch { return null; } };
const numberOrNull = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function lineOf(env, nowMs, summary, status) {
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
    modelCards: summary ? numberOrNull(summary.modelLines) : null,
    seconds: Math.max(0, Math.round((nowMs - startedMs) / 1000)),
    code: numberOrNull(env.LEDGER_CODE),
    by: env.STARTED_BY || null,
    run: numberOrNull(env.GITHUB_RUN_ID),
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
  const line = lineOf(process.env, nowMs, summary, status);
  let before = '';
  try { before = fs.readFileSync(file, 'utf8'); } catch { before = ''; }
  const lines = [...keep(before, nowMs), JSON.stringify(line)];
  fs.writeFileSync(`${file}.new`, `${lines.join('\n')}\n`);
  fs.renameSync(`${file}.new`, file);
  console.log(`ledger: ${JSON.stringify(line)}`);
  return 0;
}

module.exports = { lineOf, keep };
if (require.main === module) process.exit(main());
