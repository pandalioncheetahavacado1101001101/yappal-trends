#!/usr/bin/env node
'use strict';
/*
 * The enrich pass's stories by meaning (enrich.yml, the "stories" job; ios/IDEAS-SUPER.md P8; the logic is the collector's own,
 * lib/cluster/stories.js, lib/cluster/cluster.js and lib/cluster/embed.js):
 *
 *   node .github/scripts/stories.js due --state <dir>
 *       Whether a pass is due: the plan collect left in <dir>/enrich/stories.json reads and is young, IDEAS_STORIES is not "off",
 *       and the plan's slot is on the pace IDEAS_STORIES_EVERY sets (minutes between passes, a multiple of 15; default 30: a pass
 *       for every second cycle, the stories are good for hours, only the newest headlines wait). To $GITHUB_OUTPUT: due=true|false.
 *   node .github/scripts/stories.js build --state <dir> --vectors <file> --out <file>
 *       Makes the stories of the plan: the plan's rows and the store's sentences of the 72 hours before it, their vectors from the
 *       model this job serves (embedder.sh: STORIES_MODEL, default all-minilm, at OLLAMA_BASE, default http://127.0.0.1:11434)
 *       through the vector cache in <file> (read, then written back without the rows unused for 14 days), clustered with the rows
 *       as seeds (lib/cluster/tuned.js thresholds), written to <out>. The vectors stop 45 s before STORIES_UNTIL (epoch seconds:
 *       the job's own end) or after STORIES_EMBED_SECONDS (240); a text not reached links to nothing. To $GITHUB_OUTPUT: wrote=true|false, groups, texts,
 *       asked, seconds.
 *
 * The state is read and never written. Never writes the feed. Prints counts, never a text, a name or a key. Exit 0 whatever happens
 * to the stories (a step that cannot work says so and leaves no file); 2 on a wrong command line. IDEAS_COLLECTOR_ROOT names the
 * collector's code (default: the repository root, two folders up).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.IDEAS_COLLECTOR_ROOT || path.resolve(__dirname, '../..');
const CS = require(path.join(ROOT, 'lib/cluster/stories'));

const DEFAULT_MODEL = 'all-minilm';
const DEFAULT_EVERY_MINUTES = 30;
const SLOT_SECONDS = 900;
const EMBED_SECONDS = 240;
// (the clustering and the writes after the vectors: about 15 s for a pass's few thousand texts)
const CLUSTER_RESERVE_SECONDS = 45;
// (all-minilm's own size: its 384 numbers kept whole, P8's bench tuned it so)
const DIMS = 384;

const nowS = () => Math.floor(Date.now() / 1000);
const out = (pairs) => {
  const file = process.env.GITHUB_OUTPUT;
  const text = Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\n');
  if (file) fs.appendFileSync(file, `${text}\n`);
  console.log(text.split('\n').map((l) => `  ${l}`).join('\n'));
};
const intOf = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : null; };

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (!flag.startsWith('--')) { o._ = o._ || []; o._.push(argv[i]); continue; }
    o[flag.slice(2)] = inline !== undefined ? inline : argv[++i];
  }
  return o;
}

/** Whether a pass is due for this plan's slot: { due, why }. Pure. */
function dueOf({ plan, why = null, off = false, everyMinutes = DEFAULT_EVERY_MINUTES }) {
  if (off) return { due: false, why: 'IDEAS_STORIES is off' };
  if (!plan) return { due: false, why: why || 'no plan' };
  const every = Math.max(1, Math.round((Number(everyMinutes) || DEFAULT_EVERY_MINUTES) * 60 / SLOT_SECONDS)) * SLOT_SECONDS;
  if (Math.floor(plan.t / SLOT_SECONDS) * SLOT_SECONDS % every !== 0) return { due: false, why: `not this slot (a pass every ${every / 60} minutes)` };
  return { due: true, why: null };
}

function due(o, env) {
  const read = CS.readPlan(path.join(o.state || 'state', 'enrich', 'stories.json'), { nowS: nowS() });
  const r = dueOf({ plan: read.plan, why: read.why, off: env.IDEAS_STORIES === 'off', everyMinutes: intOf(env.IDEAS_STORIES_EVERY) || DEFAULT_EVERY_MINUTES });
  console.log(r.due ? `stories: a pass is due (${read.plan.rows.length} rows planned)` : `stories: no pass (${r.why})`);
  out({ due: r.due ? 'true' : 'false' });
  return 0;
}

async function build(o, env) {
  if (!o.out || !o.vectors) { console.error('usage: stories.js build --state <dir> --vectors <file> --out <file>'); return 2; }
  const started = Date.now();
  const until = intOf(env.STORIES_UNTIL);
  const budgetMs = (intOf(env.STORIES_EMBED_SECONDS) || EMBED_SECONDS) * 1000;
  const deadlineMs = Math.min(Date.now() + budgetMs, until ? (until - CLUSTER_RESERVE_SECONDS) * 1000 : Infinity);
  // (the plan the due step accepted: this job starts a little later, so a pass's slot to spare)
  const r = await CS.buildFromState({ state: o.state || 'state', vectors: o.vectors, out: o.out, model: env.STORIES_MODEL || DEFAULT_MODEL, base: env.OLLAMA_BASE || undefined,
    deadlineMs, maxAge: CS.PLAN_MAX_AGE_SECONDS + SLOT_SECONDS, dims: DIMS });
  if (r.cacheRows !== null) console.log(`stories: vector cache ${r.cacheRows} texts`);
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!r.wrote) { console.log(`stories: none written (${r.why})`); out({ wrote: 'false', groups: 0, texts: 0, asked: 0, seconds }); return 0; }
  const s = r.stats;
  console.log(`stories: ${s.groups} stories of two texts or more over ${s.texts} texts (${s.vectors} with a vector, ${s.asked} asked of the model in ${s.embedSeconds} s); `
    + `${s.rows} rows planned in ${s.rowStories} stories, ${s.split} rows split; ${s.seconds} s${s.late ? ` (the vectors stopped: ${s.late})` : ''}`);
  out({ wrote: 'true', groups: s.groups, texts: s.texts, asked: s.asked, seconds });
  return 0;
}

async function main() {
  const o = args(process.argv.slice(2));
  const mode = (o._ || [])[0];
  if (mode === 'due') return due(o, process.env);
  if (mode === 'build') return build(o, process.env);
  console.error('usage: stories.js due | build (see the head of this file)');
  return 2;
}

if (require.main === module) main().then((code) => process.exit(code), (e) => { console.error(`stories: ${e.stack || e.message}`); process.exit(0); });
module.exports = { args, dueOf };
