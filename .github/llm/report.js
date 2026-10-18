#!/usr/bin/env node
'use strict';
/*
 * What one model did with the editor pass (lib/editor) on one recorded cycle, beside the same cycle with no model:
 *   node report.js <model> <baseline out dir> <model out dir> <cycle.json> <cards.jsonl> <seconds> <seconds to load> <exit>
 * Appends to results.md and results.json. cards.jsonl is the pass's own trace (IDEAS_EDITOR_TRACE): one line a story asked.
 *
 * ONLY what a published feed carries anyway is written: the title and the line of a card the gate PASSED, beside the rule-built
 * title and line of the same row. A card the gate refused is counted, with the number of the rule that refused it and how long
 * it took, and its wording is never written: it is unchecked text about real people, and this branch is public.
 */
const fs = require('node:fs');
const path = require('node:path');

const [name, baseDir, modelDir, cycleFile, cardsFile, seconds, loaded, exitCode] = process.argv.slice(2);
const read = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'v1', 'us.json'), 'utf8')).items || []; } catch { return []; } };
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const base = new Map(read(baseDir).map((x) => [x.id, x]));
const items = read(modelDir);
let stats = {};
try { stats = JSON.parse(fs.readFileSync(cycleFile, 'utf8').trim().split('\n').pop()); } catch { stats = {}; }
const editor = ((stats.counts && stats.counts.lines) || {}).editor || {};
let cards = [];
try { cards = fs.readFileSync(cardsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { cards = []; }
// (a story still waiting its turn when the budget ran out was never asked: counted as waiting, never as asked or unanswered)
const asked = cards.filter((c) => c.outcome !== 'kept' && c.outcome !== 'waiting');
const ms = asked.map((c) => c.ms).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
const median = ms.length ? ms[Math.floor(ms.length / 2)] : null;
// (the rules that refused, by number: "rule 5 x3". The check's own words quote the line, so they stay in the job)
const rules = {};
for (const c of asked.filter((x) => x.outcome === 'refused')) for (const r of new Set(String(c.why || '').match(/\b(?:part \d|title|denial|reply|numbered sentences|surer|out of date|words, not|another story)\b/g) || ['other'])) rules[r] = (rules[r] || 0) + 1;
const onList = new Map(items.map((x) => [x.id, x]));
const pairs = asked.filter((c) => c.outcome === 'passed' && c.after).map((c) => {
  const now = onList.get(c.id) || null;
  const was = base.get(c.id) || null;
  return { rank: now ? now.rank : c.rank, tries: c.tries, seconds: Number.isFinite(c.ms) ? Math.round(c.ms / 100) / 10 : null, by: c.after.by || null,
    rule: { title: was ? was.title : c.before.title, line: was ? was.line : c.before.line }, model: { title: now ? now.title : c.after.title, line: now ? now.line : c.after.line },
    advice: c.advice ? { kind: c.advice.kind || null, more: c.advice.more || null, fresh: c.advice.fresh ?? null, began: c.advice.began || null } : null };
}).sort((a, b) => a.rank - b.rank);

const out = { name, exit: exitCode ?? null, seconds: num(seconds), loadSeconds: num(loaded), rows: items.length, modelLines: items.filter((x) => x.lineWrittenBy === 'model').length,
  asked: asked.length, calls: editor.calls ?? null, passed: pairs.length, mended: editor.mended ?? null, reworded: editor.reworded ?? null, shortened: editor.shortened ?? null,
  refused: asked.filter((c) => c.outcome === 'refused').length, unreadable: asked.filter((c) => c.outcome === 'unreadable').length,
  unanswered: asked.filter((c) => !['passed', 'refused', 'unreadable'].includes(c.outcome)).length, titled: editor.titled ?? null, waiting: editor.waiting ?? null, off: editor.off ?? null,
  cardSeconds: { median: median === null ? null : Math.round(median / 100) / 10, slowest: ms.length ? Math.round(ms[ms.length - 1] / 100) / 10 : null, all: editor.ms ? Math.round(editor.ms / 1000) : null },
  refusedBy: rules, pairs };
const all = fs.existsSync('results.json') ? JSON.parse(fs.readFileSync('results.json', 'utf8')) : [];
all.push(out);
fs.writeFileSync('results.json', JSON.stringify(all, null, 1));

const md = ['# The editor pass on the runner', '', 'One recorded cycle, the same for every model. A card is shown only when the gate (the claim check) passes it; a refused card is counted and never printed.', ''];
for (const r of all) {
  const per = r.cardSeconds || {};
  md.push(`## ${r.name}`, '',
    `loaded in ${r.loadSeconds ?? '?'} s | asked ${r.asked} cards in ${r.calls ?? '?'} calls, ${per.all ?? '?'} s in all (median ${per.median ?? '?'} s a card, slowest ${per.slowest ?? '?'} s) | **passed the gate ${r.passed}** (${r.mended ?? 0} on the second try, ${r.reworded ?? 0} in their sentences' own words, ${r.shortened ?? 0} shortened) | refused ${r.refused} | unreadable ${r.unreadable} | unanswered ${r.unanswered} | still waiting ${r.waiting ?? '?'} | titles changed ${r.titled ?? 0} | off: ${r.off} | exit ${r.exit}`,
    // (the pace is the calls': the seconds the pass spent in all over the calls it made, second tries included)
    '', `at this pace a 5-minute budget writes about ${per.all && r.calls ? Math.floor(300 / (per.all / r.calls)) : '?'} cards a cycle`, '');
  if (Object.keys(r.refusedBy || {}).length) md.push(`refused for: ${Object.entries(r.refusedBy).map(([k, n]) => `${k} x${n}`).join(', ')}`, '');
  for (const p of r.pairs) {
    md.push(`- #${p.rank} **${p.model.title}**${p.model.title !== p.rule.title ? ` (was: ${p.rule.title})` : ''} [${p.seconds ?? '?'} s, try ${p.tries}${p.by && p.by !== 'as written' ? `, ${p.by}` : ''}]`, `  - rule-built: ${p.rule.line}`, `  - model: ${p.model.line}`);
    if (p.advice) md.push(`  - advice: kind ${p.advice.kind}, show more ${p.advice.more}, new today ${p.advice.fresh}, began ${p.advice.began}`);
  }
  md.push('');
}
fs.writeFileSync('results.md', md.join('\n'));
