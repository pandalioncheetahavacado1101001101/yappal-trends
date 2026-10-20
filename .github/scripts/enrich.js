#!/usr/bin/env node
'use strict';
/*
 * The enrich pass's three steps (enrich.yml; ios/IDEAS-SUPER.md P11; the logic is the collector's own, lib/editor/enrich.js and
 * lib/editor/cards.js):
 *
 *   node .github/scripts/enrich.js plan  --state <dir> --cards <file>
 *       Reads the plan collect left in <dir>/enrich/plan.json and the cards already merged (<file>, may be absent): the rows still
 *       owed, how many shards to deal them to (at the measured seconds a card) and until when they write: merged before the next
 *       quarter-hour after the plan's slot, when the next cycle restores them (lib/editor/cards.js shardsFor).
 *       To $GITHUB_OUTPUT: count, shards (a JSON list, [0, 1, ...]), shard_count, until (epoch seconds), slot, card_seconds, lands
 *       (next: the cycle at the next quarter-hour imports the cards; later: the one after; none).
 *   node .github/scripts/enrich.js shard --state <dir> --cards <file> --shard <i> --shards <n> --out <part file>
 *       Asks the model this job started (IDEAS_LLM_BASE_URL and IDEAS_LLM_MODEL, set by model.sh; none set: nothing is asked) for
 *       shard i's rows, through the editor's own loop and gate, until ENRICH_UNTIL; writes the part (always: a header of counts at
 *       the least). The editor's log (titles, and a refused card's wording) goes to stderr ONLY: the workflow keeps it in a file
 *       that is never printed, uploaded or published. stdout: counts.
 *   node .github/scripts/enrich.js merge --cards <file> --parts <dir> --out <file>
 *       Merges every part in <dir> (cards-<i>.jsonl) with the cards before them (<file>): written to <out> when a part was read.
 *       To $GITHUB_OUTPUT: wrote=true|false, cards. Environment: ENRICH_STARTED (the pass's start, epoch seconds), ENRICH_PLANNED,
 *       ENRICH_SHARDS, ENRICH_SLOT, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT.
 *
 * Never reads or writes the state's database: the plan is a file. Never writes the feed. Prints counts only, never a row.
 * Exit 0 whatever happens to the cards (a step that cannot work says so and leaves nothing behind); 2 on a wrong command line.
 * IDEAS_COLLECTOR_ROOT names the collector's code (default: the repository root, two folders up).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.IDEAS_COLLECTOR_ROOT || path.resolve(__dirname, '../..');
const C = require(path.join(ROOT, 'lib/editor/cards'));
const E = require(path.join(ROOT, 'lib/editor/enrich'));
const LLM = require(path.join(ROOT, 'lib/llm'));

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

function plan(o, env) {
  const read = C.readPlan(path.join(o.state || 'state', 'enrich', 'plan.json'), { nowS: nowS() });
  const previous = o.cards ? C.readCards(o.cards) : { header: null, cards: [] };
  const started = intOf(env.ENRICH_STARTED) || nowS();
  const r = E.planStep({ plan: read.plan, why: read.why, previous, startedS: started, nowS: nowS(), off: env.ENRICH_OFF === '1',
    max: Math.max(1, Math.min(C.SHARDS_MAX, intOf(env.ENRICH_SHARDS_MAX) || C.SHARDS_MAX)), cardSeconds: Number(env.ENRICH_CARD_SECONDS) || null });
  const shards = Array.from({ length: r.shards }, (_, i) => i);
  console.log(r.shards ? `plan: ${r.owed} cards owed, ${r.shards} shard(s) at ${r.cardSeconds} s a card, writing until ${new Date(r.until * 1000).toISOString()} (${r.budget} s a shard once its model answers; for the ${r.lands === 'next' ? 'next cycle' : 'cycle after next'})`
    : `plan: nothing asked this pass (${r.why}; ${r.owed} owed)`);
  out({ count: r.shards ? r.owed : 0, shards: JSON.stringify(shards), shard_count: r.shards, until: r.until || 0, slot: r.slot || 0, card_seconds: r.cardSeconds || 0, lands: r.lands || 'none' });
  return 0;
}

async function shard(o, env) {
  const i = intOf(o.shard);
  const n = intOf(o.shards);
  if (i === null || n === null || !o.out) { console.error('usage: enrich.js shard --state <dir> --cards <file> --shard <i> --shards <n> --out <file>'); return 2; }
  // (the plan the plan job accepted: a shard starts a little later, so the age is the plan job's to judge, with a pass's slot to spare)
  const read = C.readPlan(path.join(o.state || 'state', 'enrich', 'plan.json'), { nowS: nowS(), maxAge: C.PLAN_MAX_AGE_SECONDS + C.PASS_SECONDS });
  const previous = o.cards ? C.readCards(o.cards) : { header: null, cards: [] };
  // (the model this job started, model.sh: none answering, none named, and nothing is asked)
  const config = String(env.IDEAS_EDITOR || '') === '1' ? LLM.configOf(env) : null;
  const until = intOf(env.ENRICH_UNTIL);
  const log = (s) => process.stderr.write(`${s}\n`);
  let r;
  try { r = await E.shardStep({ plan: read.plan, previous, shard: i, shards: n, config, until, log }); } catch (e) { log(`[enrich] the shard failed: ${e.stack || e.message}`); r = { header: { kind: 'part', shard: i, shards: n, why: 'the shard failed' }, cards: [] }; }
  const wrote = C.writeCards(o.out, r.header, r.cards);
  const h = r.header;
  console.log(`shard ${i} of ${n}: ${h.rows ?? 0} rows dealt, ${h.asked ?? 0} asked in ${h.calls ?? 0} calls, ${h.passed ?? 0} passed, ${h.refused ?? 0} refused, ${h.unreadable ?? 0} unreadable, `
    + `${h.unanswered ?? 0} unanswered, ${h.waiting ?? 0} left for the next pass; ${Math.round((h.ms || 0) / 1000)} s of the model; ${wrote} cards in the part; `
    + `on the cards passed, the why ${h.whysPassed ?? 0} of ${h.whys ?? 0} and the angles ${h.anglesPassed ?? 0} of ${h.angles ?? 0} passed the check${h.why ? ` (${h.why})` : ''}${h.off ? ` (the model stood back: ${h.off})` : ''}`);
  return 0;
}

function merge(o, env) {
  if (!o.out || !o.parts) { console.error('usage: enrich.js merge --cards <file> --parts <dir> --out <file>'); return 2; }
  const previous = o.cards ? C.readCards(o.cards) : { header: null, cards: [] };
  let names = [];
  try { names = fs.readdirSync(o.parts).filter((n) => /^cards-\d+\.jsonl$/.test(n)).sort(); } catch { names = []; }
  const parts = names.map((n) => C.readCards(path.join(o.parts, n)));
  const r = E.mergeStep({ previous, parts, run: intOf(env.GITHUB_RUN_ID), attempt: intOf(env.GITHUB_RUN_ATTEMPT), startedS: intOf(env.ENRICH_STARTED), nowS: nowS(),
    planned: intOf(env.ENRICH_PLANNED), shards: intOf(env.ENRICH_SHARDS), slot: intOf(env.ENRICH_SLOT) });
  if (!r) { console.log('merge: no shard left a part: the cards before stay the newest'); out({ wrote: 'false', cards: previous.cards.length }); return 0; }
  const n = C.writeCards(o.out, r.header, r.cards);
  const h = r.header;
  console.log(`merge: ${h.shardsDone} of ${h.shards ?? '?'} parts; ${h.asked} asked, ${h.passed} passed, ${h.refused} refused, ${h.unanswered} unanswered; ${n} cards kept in all; `
    + `the why ${h.whysPassed} of ${h.whys} and the angles ${h.anglesPassed} of ${h.angles} passed the check; the pass took ${h.seconds ?? '?'} s; the model's seconds a card, the last passes: ${JSON.stringify(h.perCard)}`);
  out({ wrote: 'true', cards: n });
  return 0;
}

async function main() {
  const o = args(process.argv.slice(2));
  const mode = (o._ || [])[0];
  if (mode === 'plan') return plan(o, process.env);
  if (mode === 'shard') return shard(o, process.env);
  if (mode === 'merge') return merge(o, process.env);
  console.error('usage: enrich.js plan | shard | merge (see the head of this file)');
  return 2;
}

if (require.main === module) main().then((code) => process.exit(code), (e) => { console.error(`enrich: ${e.stack || e.message}`); process.exit(0); });
module.exports = { args };
