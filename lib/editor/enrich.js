'use strict';
/*
 * The enrich pass (ios/IDEAS-SUPER.md P11; the host's enrich.yml, through .github/scripts/enrich.js): the cards collect no longer
 * writes, written from the plan its last cycle left in the state (lib/editor/cards.js). Three steps, each a job of the workflow:
 *
 *   plan    reads the plan and the cards already merged; the rows still owed (the plan less what the cards answer), how many shards
 *           to deal them to and until when the shards write (`shardsFor`: merged before the next cycle restores the cards, at the next
 *           quarter-hour after the plan's slot, at the measured seconds a card)
 *   shard   one shard's rows, dealt round-robin from the most valuable, asked through the editor's own loop and gate (lib/editor
 *           `askQueue`) on the model this job started; its answers to a part file
 *   merge   the parts and the cards before them, merged (`merge`): what collect restores and imports
 *
 * The state is read and never written: the shards read the plan alone. A shard's log (a refused card's wording) is the caller's to
 * keep private; what these steps return is counts. Every step is fenced: a plan that does not read, a model that never answered or
 * a part that is missing costs its own cards and nothing else.
 */
const EDITOR = require('./index');
const C = require('./cards');

const SHARD_CARDS = 1000;
const SHARD_BUDGET_MS = 3600e3;

/** An in-memory card cache, as lib/line-writer.js `cacheOf` reads and writes: the shard's answers, kept in `rows`. */
function memoryCache(rows = []) {
  const find = (id, hash) => rows.find((r) => r.id === id && r.hash === hash) || null;
  return { rows,
    exact: (id, hash) => find(id, hash),
    newest: (id) => rows.filter((r) => r.id === id).sort((a, b) => b.t - a.t)[0] || null,
    callsSince: () => 0,
    put: (id, hash, t, line, ok, why, basis) => { const i = rows.findIndex((r) => r.id === id && r.hash === hash); const row = { id, hash, t, line, ok: ok ? 1 : 0, why, basis }; if (i >= 0) rows[i] = row; else rows.push(row); } };
}
/** The meta a shard reads and writes (the day's allowance, the endpoint left alone): its own, in memory, never the state's. */
function memoryMeta() {
  const m = new Map();
  return { get: (k, d = null) => (m.has(k) ? m.get(k) : d), set: (k, v) => { m.set(k, v); } };
}

/**
 * The plan step. plan: lib/editor/cards.js `readPlan`'s; previous: `readCards` of the cards already merged. Returns
 * { owed, shards, until, budget, lands, cardSeconds, slot, why } (shards 0 and a why when nothing is to be asked). lands: which
 * cycle imports the cards (`shardsFor`): 'next', the one at the next quarter-hour after the plan's slot; 'later', the one after.
 */
function planStep({ plan, why = null, previous = { header: null, cards: [] }, startedS, nowS = Math.floor(Date.now() / 1000), off = false, max = C.SHARDS_MAX, cardSeconds = null }) {
  const none = { owed: 0, shards: 0, until: null, budget: null, lands: null, cardSeconds: null, slot: null };
  if (off) return { ...none, why: 'the editor is off' };
  if (!plan) return { ...none, why: why || 'no plan' };
  const owed = C.pending(plan.jobs, C.answeredOf(previous.cards)).length;
  const pace = Number.isFinite(cardSeconds) && cardSeconds > 0 ? cardSeconds : C.cardSecondsOf(previous.header);
  const dealt = C.shardsFor({ owed, cardSeconds: pace, startedS, nowS, slot: plan.t, made: plan.made, max });
  return { owed, shards: dealt.shards, until: dealt.until, budget: dealt.budget, lands: dealt.lands, cardSeconds: pace, slot: plan.t,
    why: !owed ? 'every planned card is written' : dealt.shards ? null : 'no time left before the next cycle imports the cards' };
}

/**
 * One shard. config: lib/llm.js `configOf` (null when no model answered: nothing is asked). Resolves { header, cards }: the part,
 * the shard's answers only (a card the gate passed, or one it refused twice), never a call that went unanswered.
 */
async function shardStep({ plan, previous = { header: null, cards: [] }, shard, shards, config, until = null, call, now = Date.now, wait, log = () => {} }) {
  const stats = { rows: 0, asked: 0, calls: 0, passed: 0, mended: 0, reworded: 0, shortened: 0, refused: 0, unreadable: 0, unanswered: 0, kept: 0, titled: 0, shown: 0, waiting: 0, ms: 0, off: null,
    whys: 0, whysPassed: 0, angles: 0, anglesPassed: 0, dosKept: 0, anglesRepeated: 0 };
  const header = { kind: 'part', shard, shards, slot: plan ? plan.t : null, model: config ? config.model : null };
  if (!plan || !Number.isInteger(shard) || !Number.isInteger(shards) || shards < 1 || shard < 0 || shard >= shards) return { header: { ...header, ...stats, why: 'no plan for this shard' }, cards: [] };
  const jobs = C.shardJobs(C.pending(plan.jobs, C.answeredOf(previous.cards)), shard, shards);
  stats.rows = jobs.length;
  if (!config) return { header: { ...header, ...stats, waiting: jobs.length, why: 'no model answered' }, cards: [] };
  const cache = memoryCache();
  // (a shard has the slot's time, not a cycle's count: every row dealt to it is asked while the clock allows)
  const own = { ...config, editor: true, editorCards: SHARD_CARDS, editorBudgetMs: SHARD_BUDGET_MS, editorUntil: Number.isFinite(until) && until > 0 ? until : config.editorUntil };
  const queue = jobs.map((j) => ({ row: { id: j.id, title: j.d.title }, rank: j.rank, d: j.d, first: j.first }));
  await EDITOR.askQueue(queue, { cache, meta: memoryMeta(), t: plan.t, nowMs: plan.nowMs, lex: plan.lex, config: own, call, now, ...(wait ? { wait } : {}), log, stats, cards: new Map() });
  const cards = cache.rows.map(C.cardOf).filter(Boolean);
  return { header: { ...header, ...stats }, cards };
}

/** The merge step: { header, cards } to write (`writeCards`), or null when no shard left a part (the cards before stay the newest). */
function mergeStep({ previous = { header: null, cards: [] }, parts = [], run = null, attempt = null, startedS = null, nowS = Math.floor(Date.now() / 1000), planned = null, shards = null, slot = null }) {
  const read = parts.filter((p) => p && p.header && p.header.kind === 'part');
  if (!read.length) return null;
  return C.merge({ previous, parts: read, run, attempt, startedS, nowS, planned, shards, slot });
}

module.exports = { planStep, shardStep, mergeStep, memoryCache, memoryMeta };
