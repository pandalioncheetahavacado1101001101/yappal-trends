#!/usr/bin/env node
'use strict';
/*
 * Compares the feed a cycle wrote with a local model against the feed of the same state without one:
 *   node report.js <name> <baseline out dir> <model out dir> <cycle.json> <seconds>  ->  appends to results.md / results.json
 * Only what a published feed carries anyway (titles and lines) is written.
 */
const fs = require('node:fs');
const path = require('node:path');

const [name, baseDir, modelDir, cycleFile, seconds] = process.argv.slice(2);
const read = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'v1', 'us.json'), 'utf8')).items || []; } catch { return []; } };
const base = new Map(read(baseDir).map((x) => [x.id, x]));
const items = read(modelDir);
let stats = {};
try { stats = JSON.parse(fs.readFileSync(cycleFile, 'utf8').trim().split('\n').pop()); } catch { stats = {}; }
const lines = (stats.counts && stats.counts.lines) || {};
const written = items.filter((x) => x.lineWrittenBy === 'model');
const pairs = written.slice(0, 14).map((x) => ({ title: x.title, headline: (base.get(x.id) || {}).line || null, model: x.line }));

const out = { name, seconds: Number(seconds) || null, rows: items.length, modelLines: written.length, asked: lines.asked ?? null, passed: lines.passed ?? null,
  failedCheck: lines.failedCheck ?? null, unanswered: lines.unanswered ?? null, off: lines.off ?? null, pairs };
const all = fs.existsSync('results.json') ? JSON.parse(fs.readFileSync('results.json', 'utf8')) : [];
all.push(out);
fs.writeFileSync('results.json', JSON.stringify(all, null, 1));
const md = ['# Local model line-writing test', ''];
for (const r of all) {
  md.push(`## ${r.name}`, '', `rows ${r.rows} | asked ${r.asked} | passed the claim check ${r.passed} | failed it ${r.failedCheck} | unanswered ${r.unanswered} | off: ${r.off} | cycle ${r.seconds}s`, '');
  for (const p of r.pairs) md.push(`- **${p.title}**`, `  - headline: ${p.headline}`, `  - model: ${p.model}`);
  md.push('');
}
fs.writeFileSync('results.md', md.join('\n'));
