'use strict';
/*
 * The editor pass (ios/IDEAS-FEED.md P): for the rows a reader meets first, a small open model writes the card from the story's
 * own dossier (lib/editor/dossier.js, lib/editor/prompt.js) and the gate decides whether it may be shown (lib/editor/gate.js).
 *   which rows    the first forty of the page as laid out, and any row the engine hands over (`row.editorWanted`); the page first
 *   when          only when the dossier changed since the story's last card: a card is kept by the hash of what it was written from
 *   one story     one request; a refused card goes back ONCE with what to mend; refused again, the rule-built card stands
 *   the budget    so many first asks a cycle and so much time in all (a 15-minute schedule): what is left over waits a cycle
 *   never         a cycle held up or failed for the model: an endpoint that does not answer is left alone for a while
 *   cards only    the host's collect has no model (ios/IDEAS-SUPER.md P11; lib/editor/cards.js `cardsOnlyConfig`): it imports the
 *                 cards an enrich pass wrote, each only for the very dossier it was written from, shows kept cards as ever, asks
 *                 nothing, and leaves the rows still owed (up to rank 80) in a plan for the next pass (lib/editor/enrich.js), whose
 *                 shards ask them through `askQueue`, this very loop and gate
 *   why, angles   with its card the model writes why the story is talked about now and up to three videos a creator could film
 *                 (ios/IDEAS-SUPER.md P12); each is held to the claim check (lib/editor/ideas.js) and travels with the card the gate
 *                 passed, judged again whenever the card is kept
 * The model is behind `call`, so tests run it against a stub. Nothing is read from a file and no key is needed.
 */
const fs = require('node:fs');
const LLM = require('../llm');
const P = require('./prompt');
const G = require('./gate');
const D = require('./dossier');
const XC = require('./cards');
const I = require('./ideas');
const { HOUR, DAY, hash32 } = require('../util');

const PAGE = 40;
const FIRST_PAGE = 20;
const CARDS = 20;
const BUDGET_MS = 300000;
const CALL_MS = 90000;
const MIN_CALL_MS = 8000;
const REWRITE_AFTER_SECONDS = 2 * HOUR;
const TURN_AFTER_SECONDS = 30 * 60;
const NEW_SENTENCES = 3;
const UNANSWERED_AGAIN_SECONDS = 15 * 60;
const UNANSWERED_RUN_MAX = 3;
const OFF_SECONDS = 24 * HOUR;
const BACKOFF_FIRST_SECONDS = 15 * 60;
const BACKOFF_MAX_SECONDS = 6 * HOUR;
const WHY_MAX = 400;
const { CACHE_V, LEGACY_V } = XC;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const shownKeys = (d) => d.shown.map((s) => hash32(s.text, 8));
const isAnswer = (row) => !!row && row.basis && row.basis.v === CACHE_V && (row.ok === 1 || !/^call:/.test(row.why || ''));

/**
 * One ask: the request, the reply read as a card, the gate. Resolves { outcome: 'passed' | 'refused' | 'unreadable' | 'turned-away' |
 * 'call-refused' | 'failed', card (the gate's, when it passed), raw, line, why, status, retryAfter, ms }.
 */
async function ask(config, d, retry, { call, timeoutMs, nowMs, lex = null, now = Date.now } = {}) {
  const started = now();
  // (never under what a card with its why and angles takes: a reply cut short is unreadable, not a smaller card)
  const body = P.bodyFor(d, { model: config.model, maxTokens: Math.max(config.editorTokens || 0, P.MAX_TOKENS), json: config.json !== false, reasoning: config.reasoning || null }, retry);
  const res = await LLM.chat(config, body, { ...(call ? { call } : {}), timeoutMs });
  const ms = now() - started;
  if (res.outcome !== 'ok') return { outcome: res.outcome === 'refused' ? 'call-refused' : res.outcome, card: null, raw: null, line: null, why: `call: ${res.status || res.error || 'no answer'}`, status: res.status, retryAfter: res.retryAfter, ms };
  const parsed = P.parseCard(P.contentOf(res.text) || '');
  if (!parsed) return { outcome: 'unreadable', card: null, raw: null, line: null, why: 'reply: no card in it', status: 200, ms };
  const g = G.gate(parsed, d, { nowMs, lex });
  if (g.ok) {
    // (its why and angles, each held to the check on its own: one that does not pass is left out, never the card)
    const ideas = I.ideasOf(parsed, d, { nowMs, lex });
    const card = { ...g.card, ...(ideas.why ? { why: ideas.why } : {}), ...(ideas.angles.length ? { angles: ideas.angles } : {}) };
    return { outcome: 'passed', card, raw: parsed.raw, line: g.card.line, why: null, titleWhy: g.titleWhy || null, ideas: { counts: ideas.counts, refused: ideas.refused }, status: 200, ms };
  }
  return { outcome: 'refused', card: null, raw: parsed.raw, line: g.line || parsed.line, title: parsed.title, why: g.why, failures: g.failures, status: 200, ms };
}

/** How long the editor stays off after an answer: a day after a refusal; fifteen minutes doubling to six hours, or what Retry-After says, after being turned away. */
function offFor(outcome, strikes, retryAfter) {
  if (outcome === 'call-refused') return OFF_SECONDS;
  const asked = Number(retryAfter);
  return Math.max(Number.isFinite(asked) && asked > 0 ? asked : 0, Math.min(BACKOFF_MAX_SECONDS, BACKOFF_FIRST_SECONDS * 2 ** Math.min(10, strikes)));
}

/**
 * What to show for one row and whether to ask, from the cards kept: { card (a kept card that still passes the gate, or null), ask,
 * first (never written for) }. A card written from these very sentences is the answer, whatever it was. A card written from an
 * earlier state of the story is shown while it still passes the gate on today's sentences, and written again once the story has
 * moved: three new sentences among those shown and two hours gone, or a turn (a reply, a step, an outcome) newer than the card.
 */
function decide({ exact, newest, d, t, nowMs }) {
  // (the very judge the gate is: the claim check with the story behind it, the words in the sentences the line rests on, the reply
  // anyone gave to a claim it tells, and the title by the gate's own test. A denial that came in since, whoever made it, takes a
  // kept card down as it would have refused a new one; and a title is never shown one cycle and taken back the next for a rule the
  // gate did not ask about. Reviewers, 2026-10-12)
  const stands = (row) => {
    const card = row && row.ok === 1 && row.basis && row.basis.card ? row.basis.card : null;
    if (!card) return null;
    // (a card that no longer passes is dropped whole; one that passes all but its own title keeps the line under the engine's)
    if (G.judgeLine(d, card.line, { named: null }).failures.length) return null;
    const titled = card.title && G.whyNotTitle(d, card.title, card.line) ? { ...card, title: null } : card;
    // (and its why and angles, each judged again on the sentences as they are now: one that no longer passes is left out)
    if (!titled.why && !titled.angles) return titled;
    const { why, angles, ...rest } = titled;
    const now = I.standing(titled, d, { nowMs });
    return { ...rest, ...(now.why ? { why: now.why } : {}), ...(now.angles.length ? { angles: now.angles } : {}) };
  };
  if (isAnswer(exact)) {
    const card = stands(exact);
    // (a kept card the check now refuses, a rule learnt since or a denial newly in hand, is asked for again)
    return { card, ask: exact.ok === 1 && !card && t - exact.t >= UNANSWERED_AGAIN_SECONDS, first: false };
  }
  // (a card of the version before, P.CARD_V: shown while it still passes, its story asked again for the card as it is now asked)
  if (newest && newest.basis && LEGACY_V.has(newest.basis.v)) return { card: newest.ok === 1 ? stands(newest) : null, ask: true, first: true };
  if (!newest || !newest.basis || newest.basis.v !== CACHE_V) return { card: null, ask: true, first: true };
  if (!isAnswer(newest)) return { card: null, ask: t - newest.t >= UNANSWERED_AGAIN_SECONDS, first: true };
  const card = stands(newest);
  const had = new Set(newest.basis.shown || []);
  const fresh = d.shown.filter((s) => !had.has(hash32(s.text, 8)));
  const turned = fresh.some((s) => s.type === 'outlet' && s.t > newest.t * 1000 && D.TURN.test(s.text));
  const moved = fresh.length >= NEW_SENTENCES || !card;
  return { card, ask: (turned && t - newest.t >= TURN_AFTER_SECONDS) || (moved && t - newest.t >= REWRITE_AFTER_SECONDS) || (!card && newest.ok === 1), first: false };
}

/**
 * The asks of one cycle or one enrich shard (lib/editor/enrich.js), most valuable first: one request a story, a refused card sent back
 * once with what to mend, every answer put in `cache` and every card the gate passed in `cards`; bounded by the first asks a cycle
 * (config.editorCards), the time (config.editorBudgetMs, config.editorUntil), the day's allowance, and an endpoint that refuses, turns
 * the editor away or does not answer (it is then left alone: meta 'editorOff'). Counts into `stats`.
 * queue: [{ row, rank, d, first }]; ctx: { cache, meta, t, nowMs, lex, config, call, now, wait, log, stats, cards, trace, off }.
 */
async function askQueue(queue, { cache, meta, t, nowMs, lex = null, config, call, now = Date.now, wait = sleep, log = () => {}, stats, cards, trace = null, off = null }) {
  const started = now();
  const until = Number.isFinite(config.editorUntil) && config.editorUntil > 0 ? config.editorUntil * 1000 : Infinity;
  const left = () => Math.min((config.editorBudgetMs || BUDGET_MS) - (now() - started), until - now());
  const callMs = config.editorTimeoutMs || CALL_MS;
  const gapMs = call && call.paced ? 0 : Math.ceil(60000 / (config.rpm || 600));
  const asked = (meta.get('llmAsked', []) || []).filter((x) => Array.isArray(x) && x[0] > t - DAY);
  let allowance = Math.max(0, config.daily - asked.reduce((a, x) => a + (x[1] || 0), 0));
  let unansweredRun = meta.get('editorUnanswered', 0) || 0;
  let firsts = 0;
  let slowest = MIN_CALL_MS;
  let stop = false;
  const one = async (d, retry) => {
    if (stats.calls && gapMs) await wait(gapMs);
    const r = await ask(config, d, retry, { call, timeoutMs: Math.max(1000, Math.min(callMs, left())), nowMs, lex, now });
    stats.calls += 1;
    allowance -= 1;
    asked.push([t, 1]);
    meta.set('llmAsked', asked);
    if (r.status === 200) slowest = Math.max(slowest, Math.min(callMs, r.ms || 0));
    // (a replay answered from disk alone, EVAL_LLM_OFFLINE: a request that was never asked is no endpoint gone quiet)
    const unasked = r.why === 'call: not in the cache';
    const silent = !unasked && !['passed', 'refused', 'unreadable', 'call-refused', 'turned-away'].includes(r.outcome);
    unansweredRun = silent ? unansweredRun + 1 : 0;
    meta.set('editorUnanswered', unansweredRun);
    const strikes = off && off.until > t - DAY ? (off.strikes || 0) + 1 : 0;
    if (r.outcome === 'call-refused' || r.outcome === 'turned-away') {
      meta.set('editorOff', { until: t + offFor(r.outcome, strikes, r.retryAfter), why: `${r.outcome === 'call-refused' ? 'refused' : 'turned away'} (${r.status})`, strikes });
      stats.off = `${r.outcome} (${r.status})`;
      stop = true;
    } else if (unansweredRun >= UNANSWERED_RUN_MAX) {
      meta.set('editorOff', { until: t + offFor('turned-away', strikes, null), why: 'no answer', strikes });
      meta.set('editorUnanswered', 0);
      stats.off = 'no answer';
      stop = true;
    } else if (r.status === 200) meta.set('editorOff', null);
    return r;
  };
  for (const q of queue) {
    // (none is started with too little time left to answer in: a card takes about as long as the slowest so far)
    if (stop || firsts >= (config.editorCards || CARDS) || allowance <= 0 || left() < Math.max(MIN_CALL_MS, slowest)) break;
    firsts += 1;
    stats.asked += 1;
    const began = now();
    let r = await one(q.d, null);
    let tries = 1;
    if (r.outcome === 'refused' && !stop && allowance > 0 && left() >= Math.max(MIN_CALL_MS, slowest)) {
      log(`[editor] "${q.row.title}": "${r.line}" sent back: ${r.why}`);
      const second = await one(q.d, { reply: r.raw, why: r.why });
      tries = 2;
      // (a second try that was never answered leaves the first refusal standing as the answer)
      if (['passed', 'refused', 'unreadable'].includes(second.outcome)) { if (second.outcome === 'passed') stats.mended += 1; r = second; }
    }
    const ok = r.outcome === 'passed';
    const basis = { v: CACHE_V, shown: shownKeys(q.d), tries, model: config.model, ...(ok ? { card: r.card } : {}) };
    if (r.why !== 'call: not in the cache') cache.put(q.row.id, q.d.hash, t, r.line || null, ok, ok ? null : String(r.why || '').slice(0, WHY_MAX), basis);
    if (ok && r.ideas) {
      // (the gate on the why and the angles, P12: counts for the ledger; what it refused, for the job's own log)
      for (const k of ['whys', 'whysPassed', 'angles', 'anglesPassed', 'dosKept', 'anglesRepeated']) stats[k] = (stats[k] || 0) + (r.ideas.counts[k] || 0);
      for (const x of r.ideas.refused) log(`[editor] "${q.row.title}": its ${x.what} "${x.text || ''}" left out: ${x.why}`);
    }
    if (ok) { stats.passed += 1; cards.set(q.row.id, r.card); if (r.card.title) stats.titled += 1; if (r.card.by === 'reworded from its sentences') stats.reworded += 1; if (r.card.by === 'shortened') stats.shortened += 1; if (r.titleWhy) log(`[editor] "${q.row.title}": the title "${JSON.parse(r.raw).title}" does not stand: ${r.titleWhy}`); }
    else if (r.outcome === 'refused') { stats.refused += 1; log(`[editor] "${q.row.title}": "${r.line}" refused: ${r.why}`); }
    else if (r.outcome === 'unreadable') { stats.unreadable += 1; log(`[editor] "${q.row.title}": ${r.why}`); }
    else { stats.unanswered += 1; log(`[editor] "${q.row.title}": ${r.why}`); }
    if (trace) trace.push({ id: q.row.id, rank: q.rank, outcome: r.outcome, tries, ms: now() - began, why: ok ? null : r.why, titleWhy: r.titleWhy || null, before: { title: q.row.title, line: q.row.line || null },
      after: ok ? { title: r.card.title || q.row.title, line: r.card.line, by: r.card.by } : null, tried: ok ? null : { title: r.title || null, line: r.line || null }, advice: ok ? r.card.advice : null,
      ideas: ok && r.ideas ? { why: r.card.why || null, angles: r.card.angles || [], counts: r.ideas.counts, refused: r.ideas.refused } : null, dossier: config.traceDossiers ? q.d : undefined });
  }
  stats.waiting = Math.max(0, queue.length - firsts);
  stats.ms = now() - started;
}

/**
 * One cycle's cards. jobs: [{ row, rank, page }] in the order the page is laid out; cache: lib/line-writer.js `cacheOf`.
 * Resolves { cards: Map(trend id -> { line, title, src, reply, advice }), stats }.
 * opts: { jobs, cache, meta, t (slot, seconds), nowMs, store, measured (row -> { startedAt } | null), config (lib/llm.js `configOf`),
 *   call, now, wait, log }.
 */
async function run({ jobs, cache, meta, t, nowMs = t * 1000, store = null, measured = () => null, lex = null, config, call, now = Date.now, wait = sleep, log = () => {} }) {
  const cards = new Map();
  const stats = { rows: 0, asked: 0, calls: 0, passed: 0, mended: 0, reworded: 0, shortened: 0, refused: 0, unreadable: 0, unanswered: 0, kept: 0, titled: 0, shown: 0, waiting: 0, ms: 0, off: null,
    whys: 0, whysPassed: 0, angles: 0, anglesPassed: 0, dosKept: 0, anglesRepeated: 0 };
  const queue = [];
  const trace = config && config.trace ? [] : null;
  const rowsCap = (config && config.editorRows) || PAGE;
  // (cards an enrich pass wrote, lib/editor/cards.js: each taken into the cache only for the very dossier it was written from)
  const imported = config && config.imported instanceof Map ? config.imported : null;
  if (imported) stats.import = { used: 0, held: 0, stale: 0 };
  for (const job of jobs) {
    const { row } = job;
    if (!row || !row.id || !((job.rank <= rowsCap && (job.page || rowsCap > PAGE)) || row.editorWanted)) continue;
    let d = null;
    try { d = D.dossierOf(row, { store, nowMs, facts: measured(row), max: (config && config.editorShown) || D.SHOWN_MAX }); } catch (e) { log(`[editor] "${row.title}": no dossier: ${e.message}`); }
    if (!d) continue;
    stats.rows += 1;
    if (imported) { const how = XC.importCard(cache, row.id, d.hash, imported.get(row.id)); if (how) stats.import[how] += 1; }
    const dec = decide({ exact: cache.exact(row.id, d.hash), newest: cache.newest(row.id), d, t, nowMs });
    if (dec.card) { cards.set(row.id, dec.card); stats.kept += 1; }
    if (dec.ask) queue.push({ ...job, d, first: dec.first });
    else if (trace && dec.card) trace.push({ id: row.id, rank: job.rank, outcome: 'kept', before: { title: row.title, line: row.line || null }, after: { title: dec.card.title || row.title, line: dec.card.line }, advice: dec.card.advice || null,
      ideas: dec.card.why || dec.card.angles ? { why: dec.card.why || null, angles: dec.card.angles || [] } : null });
  }
  // the most valuable first: the first page, a row never written for before one whose story moved, then by its place
  const order = (q) => (q.rank <= FIRST_PAGE ? 0 : 2) + (q.first ? 0 : 1);
  queue.sort((a, b) => order(a) - order(b) || a.rank - b.rank);
  // (cards only: the rows still owed, in this order and with the dossiers they are to be written from, are the next enrich pass's plan)
  if (config && config.plan) { try { stats.planned = XC.writePlan(config.plan, { t, nowMs, lex, queue }); } catch (e) { stats.planned = null; log(`[editor] the plan was not written: ${e.message}`); } }
  const off = meta.get('editorOff', null);
  // (off until, and through, the slot its time runs out in: fifteen minutes off is one cycle left alone, not none)
  if (off && off.until >= t) stats.off = off.why;
  if (config && !config.cardsOnly && !stats.off && queue.length) await askQueue(queue, { cache, meta, t, nowMs, lex, config, call, now, wait, log, stats, cards, trace, off });
  else stats.waiting = queue.length;
  stats.shown = cards.size;
  // (the rows still waiting, for a person reading the trace: what they would be asked from)
  if (trace) { const done = new Set(trace.map((x) => x.id)); for (const q of queue) if (!done.has(q.row.id)) trace.push({ id: q.row.id, rank: q.rank, outcome: 'waiting', before: { title: q.row.title, line: q.row.line || null }, after: null, dossier: config.traceDossiers ? q.d : undefined }); }
  if (trace) { try { fs.appendFileSync(config.trace, trace.map((x) => `${JSON.stringify({ t, ...x })}\n`).join('')); } catch (e) { log(`[editor] the trace was not written: ${e.message}`); } }
  return { cards, stats };
}

module.exports = { run, askQueue, ask, decide, offFor, PAGE, FIRST_PAGE, CARDS, BUDGET_MS, CALL_MS, CACHE_V, LEGACY_V };
