'use strict';
/*
 * The cards the enrich pass writes and collect imports (ios/IDEAS-SUPER.md P11). Collect runs with no model; a separate workflow,
 * enrich.yml, writes the cards from the plan collect left in its state, and the next collect imports them. Three files, all private
 * (the state's and the cards' own Actions cache keys: never the feed, an artifact or a log):
 *
 *   plan    state/enrich/plan.json, written by collect every cycle: the rows whose card is owed (lib/editor `decide`), the most
 *           valuable first, each with the very dossier its card is to be written from; the slot and the clock the dossiers were built
 *           at; the build's lexicon (the gate's casing). { v, cacheV, t, nowMs, made, lex, jobs: [{ id, rank, first, d }] }
 *   part    one shard's answers (lib/editor/enrich.js): JSON lines, a header ({ v, kind: 'part', ... counts }) then one card a line
 *   cards   the pass's answers merged with the passes before it that are still young: what collect restores (the cache key
 *           cards-<run>-<attempt>) and imports. A header ({ v, kind: 'cards', run, made, slot, model, counts, perCard }) then cards
 *
 * A card line is the card cache's own row (lib/line-writer.js cacheOf): { id, hash, t, line, ok, why, basis }, keyed by the trend and
 * the hash of the dossier it was written from (lib/editor/dossier.js hashOf: the sentences shown, the title, the denial). Only
 * answers travel: a card the gate passed, or one it refused twice (an answer about that story: not asked again). A call that was never
 * answered stays behind, and the row is planned again.
 *
 * THE IMPORT (`importCard`): a card is taken into collect's card cache only when its hash is the hash of the row's dossier this cycle,
 * the same story sentence for sentence; then the editor's own `decide` shows it while the gate still passes it, exactly as a card
 * written in the cycle itself. A card written for a story that has moved since is dropped, never shown.
 * Pure but for the files read and written (atomically: a .new beside, then renamed). Zero dependencies.
 */
const fs = require('node:fs');
const path = require('node:path');
const D = require('./dossier');
const P = require('./prompt');

const V = 1;
// (the card cache's version: the dossier's and what a card asks for, P.CARD_V. Cards of every version before stay shown while their
// stories are asked again, lib/editor/index.js `decide` (each judged again by today's check first); they never travel in a plan or
// a cards file. Version 1 was written "e1", the later ones "e1.<n>": the cards live when a version moves are the fallback until the
// new version's first pass lands)
const CACHE_V = `e${D.VERSION}.${P.CARD_V}`;
const LEGACY_V = new Set([`e${D.VERSION}`, ...Array.from({ length: Math.max(0, P.CARD_V - 2) }, (_, i) => `e${D.VERSION}.${i + 2}`)]);
const SLOT_SECONDS = 900;
// (a plan older than this is no story the next cycle still shows: nothing is asked from it)
const PLAN_MAX_AGE_SECONDS = 40 * 60;
// (cards kept in the merged file: long enough to land after a collect outage of a few hours, few enough to read in milliseconds)
const KEPT_SECONDS = 6 * 3600;
const CARDS_MAX = 800;
const PER_CARD_KEPT = 8;
// the pass's arithmetic (enrich.yml; measured on the runner 2026-10-19, ledger.jsonl): a card was about 27 s of the model's time
// (189 s for 7 first asks and 9 calls) before it carried a why and three angles; with them, 70 s is a guess until llm-test or the
// first passes measure it (ios/IDEAS-SUPER.md P12: the passes' own perCard then sizes the shards), a shard is answering about 260 s after the plan (pickup 20, set-up 10, the state and the
// cards 5, the model restored 47 and started 143, p90 60 and 156), the merge needs about 45 s (75 kept). The cards are merged before
// the next quarter-hour after the plan's slot, when the next collect cycle restores them (collect.yml restores them after its wait
// for the quarter-hour): one slot late (`shardsFor`)
// THROUGHPUT (2026-10-20, the pass of the 02:00 slot: 18 asked of 100 planned on 6 shards, 541 s, 86.8 s a card). A shard's window
// for cards is the deadline less its model's start: about 810 - 350 - 225 = 235 s, so 2 to 3 cards a shard at 87 s each. The shard
// now asks LANES stories at once (enrich.js shardStep; the server serves as many sequences side by side, model.sh): decode on a CPU
// is bound by memory bandwidth, so the weights read once per step serve every sequence in the batch, and the shard's cards a second
// rise while each call takes longer. Per card about 1.3 calls of ~470 new prompt tokens (~8 s, compute-bound, not shared) and ~410
// reply tokens (~59 s at ~7 tokens a second alone): one lane 87 s a card; three, at ~2.2x the reply tokens a second, about 45 s a
// card a shard. The passes' own seconds a card (perCard, effective per shard) and their shards' measured start (ready) size the
// next pass; READY_SECONDS is the guess until a pass has measured it (the install fetched behind the restores, model.sh: ~180 s).
// THE WINDOW (2026-10-27): with one story at a time (LANES; the first three passes) a shard answered a call in ~76 s (~3,455 prompt
// tokens read whole in ~18 s, ~512 reply tokens in ~58 s) but had only ~145 s to write in: its model answered ~205 to 254 s after a
// plan made ~7.5 min into its slot, and the cards stopped 90 s before the next quarter-hour. A shard asked ~1.45 stories, a pass
// asked 73% of what was owed and passed ~7. Now the
// cards are merged before the quarter-hour LAND_SLOTS (2) after the plan's slot: a pass writes for up to ~17 minutes and its cards
// are shown one slot later than before, rather than not at all (IDEAS_ENRICH_LAND_SLOTS 1 is the old window). The shards are still
// dealt to write every owed card by the next quarter-hour where a minute of it is left (`shardsFor`), so a short plan lands as
// early as before; what is left over, a retry, a slow call, is written on until the later mark. A shard never writes for more than
// WINDOW_MAX_SECONDS after its model answers. One pass at a time (enrich.yml's group): a pass that runs past the next dispatch
// holds it, and that one starts when this one has merged, with the newest plan and the cards this one wrote.
// The seconds a card (`merge` perCard) are a shard's wall clock over the stories it got an ANSWER for (asked less unanswered),
// not over the stories it started: a call cut at the deadline costs time and writes nothing. CARD_SECONDS is the guess until a
// pass of this kind has measured it (the compact prompt, lib/editor/prompt.js: ~2,150 prompt tokens in ~9 s, ~310 reply tokens in
// ~33 s, ~1.15 calls a card: ~50 s; 60 to be safe)
const CARD_SECONDS = 60;
const PER_CARD_BY = 'answered';
const LAND_SLOTS = 2;
const LAND_SLOTS_MAX = 3;
const WINDOW_MAX_SECONDS = 20 * 60;
const READY_SECONDS = 260;
const READY_MIN_SECONDS = 60;
const READY_MAX_SECONDS = 600;
const MERGE_RESERVE_SECONDS = 75;
const SAFETY_SECONDS = 15;
const PASS_SECONDS = SLOT_SECONDS;
const MIN_CARDS_SECONDS = 60;
// (a pass that started this long after its plan was made waited behind another pass: collect publishes, saves and dispatches in under
// a minute, and the runner takes it up in seconds)
const QUEUED_SECONDS = 180;
// (the account runs 20 jobs at once: 12 shards leave 8, for collect's gate, cycle and sleeping "next" (3), the stories job, the plan
// or the merge, the daily scoreboard, a probe or llm-test, and one to spare. enrich.yml has a part step for each)
const SHARDS_MAX = 12;
// (the stories a shard asks at once, and the most it may: the server's OLLAMA_NUM_PARALLEL is set to the same, model.sh)
// (measured 2026-10-20 to 10-26 on the runner, the last 40 passes: with 3 lanes only 31% of calls were answered before the deadline,
// each answered one reading ~3,450 prompt tokens in ~50 s and writing ~495 tokens at ~4.9 a second a lane, ~150 s a call; the
// prompt was read whole every call and the 4-core runner shared it three ways, so the rows holding a card fell from ~80 to ~20.
// One lane until a pass measures better)
const LANES = 1;
const LANES_MAX = 4;
const LINE_MAX = 1000;
const WHY_MAX = 400;
const HASH = /^[0-9a-f]{64}$/;

// ---------- the lexicon, as JSON (Maps and Sets of strings, numbers and arrays) ----------
const encodeLex = (lex) => (lex ? JSON.parse(JSON.stringify(lex, (k, v) => (v instanceof Map ? { $map: [...v.entries()] } : v instanceof Set ? { $set: [...v] } : v))) : null);
function decodeLex(value) {
  if (Array.isArray(value)) return value.map(decodeLex);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value.$map)) return new Map(value.$map.map(([k, v]) => [k, decodeLex(v)]));
  if (Array.isArray(value.$set)) return new Set(value.$set.map(decodeLex));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decodeLex(v)]));
}

/** Writes text to a file atomically: built whole beside it, then renamed into place. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.new`, text);
  fs.renameSync(`${file}.new`, file);
}

// ---------- the plan ----------
/** The plan of one cycle: queue as lib/editor `run` sorts it ([{ row, rank, first, d }]). Returns the number of jobs written. */
function writePlan(file, { t, nowMs, lex = null, queue, made = Math.floor(Date.now() / 1000) }) {
  const jobs = queue.filter((q) => q && q.row && q.row.id && q.d && HASH.test(q.d.hash || '')).map((q) => ({ id: q.row.id, rank: q.rank, first: !!q.first, d: q.d }));
  writeAtomic(file, JSON.stringify({ v: V, cacheV: CACHE_V, t, nowMs, made, lex: encodeLex(lex), jobs }));
  return jobs.length;
}

/** The plan in a file: { plan } or { plan: null, why }. A plan of another version, another card cache or older than its age is none. */
function readPlan(file, { nowS = Math.floor(Date.now() / 1000), maxAge = PLAN_MAX_AGE_SECONDS } = {}) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { plan: null, why: e.code === 'ENOENT' ? 'no plan' : 'the plan does not read' }; }
  if (!raw || raw.v !== V || !Array.isArray(raw.jobs) || !Number.isFinite(raw.t) || !Number.isFinite(raw.nowMs)) return { plan: null, why: 'the plan is of another kind' };
  if (raw.cacheV !== CACHE_V) return { plan: null, why: `the plan was made for cards ${raw.cacheV}, this code writes ${CACHE_V}` };
  if (!Number.isFinite(raw.made) || nowS - raw.made > maxAge) return { plan: null, why: 'the plan is too old' };
  const jobs = raw.jobs.filter((j) => j && typeof j.id === 'string' && j.id && j.d && typeof j.d === 'object' && HASH.test(j.d.hash || '') && Array.isArray(j.d.shown) && Number.isFinite(j.rank));
  return { plan: { t: raw.t, nowMs: raw.nowMs, made: raw.made, lex: decodeLex(raw.lex), jobs } };
}

// ---------- cards: one a line, after a header ----------
/** A card line as it may be imported, or null: an answer of this card cache about one dossier. */
function cardOf(x) {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id || x.id.length > 120 || !HASH.test(x.hash || '') || !Number.isFinite(x.t)) return null;
  if (x.ok !== 0 && x.ok !== 1) return null;
  const basis = x.basis && typeof x.basis === 'object' ? x.basis : null;
  if (!basis || basis.v !== CACHE_V) return null;
  // (a passed card carries the card the gate passed; a refused one carries its reason, never a call that was not answered)
  if (x.ok === 1 && !(basis.card && typeof basis.card === 'object' && typeof basis.card.line === 'string' && basis.card.line)) return null;
  if (x.ok === 0 && (typeof x.why !== 'string' || /^call:/.test(x.why))) return null;
  const line = typeof x.line === 'string' ? x.line.slice(0, LINE_MAX) : null;
  const why = typeof x.why === 'string' ? x.why.slice(0, WHY_MAX) : null;
  return { id: x.id, hash: x.hash, t: Math.floor(x.t), line, ok: x.ok, why: x.ok === 1 ? null : why, basis };
}

/** A cards or part file: { header, cards } (header null and cards empty when there is none; a line that does not read is skipped). */
function readCards(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { header: null, cards: [] }; }
  const lines = text.split('\n').filter((l) => l.trim());
  let header = null;
  const cards = [];
  lines.forEach((l, i) => {
    let x;
    try { x = JSON.parse(l); } catch { return; }
    if (i === 0 && x && x.v === V && (x.kind === 'cards' || x.kind === 'part')) { header = x; return; }
    const card = cardOf(x);
    if (card) cards.push(card);
  });
  return { header, cards };
}

/** Writes a cards or part file: the header, then each card that is one. Returns the cards written. */
function writeCards(file, header, cards) {
  const good = cards.map(cardOf).filter(Boolean);
  writeAtomic(file, `${[JSON.stringify({ ...header, v: V }), ...good.map((c) => JSON.stringify(c))].join('\n')}\n`);
  return good.length;
}

/** The cards by trend: Map(id -> [card]). */
function indexCards(cards) {
  const by = new Map();
  for (const c of cards) { if (!by.has(c.id)) by.set(c.id, []); by.get(c.id).push(c); }
  return by;
}

/** The (trend, dossier) pairs the cards answer: a Set of "id hash". */
const answeredOf = (cards) => new Set(cards.map((c) => `${c.id} ${c.hash}`));

// ---------- the import ----------
const isAnswer = (row) => !!row && row.basis && row.basis.v === CACHE_V && (row.ok === 1 || !/^call:/.test(row.why || ''));
/**
 * One row's imported cards into collect's card cache (lib/line-writer.js cacheOf). list: the cards for this trend ([] or undefined).
 * Returns 'used' (the card for this very dossier was put in the cache), 'held' (the cache already holds that answer, as new), 'stale'
 * (cards came for this trend, none for its dossier as it is now: dropped), or null (none came).
 */
function importCard(cache, id, hash, list) {
  if (!Array.isArray(list) || !list.length) return null;
  const match = list.filter((c) => c.hash === hash).sort((a, b) => b.t - a.t)[0];
  if (!match) return 'stale';
  const have = cache.exact(id, hash);
  if (isAnswer(have) && have.t >= match.t) return 'held';
  cache.put(id, hash, match.t, match.line, match.ok === 1, match.why, match.basis);
  return 'used';
}

// ---------- the pass's arithmetic ----------
/** The rows still owed: the plan's jobs less those the cards already answer, in the plan's order. */
const pending = (jobs, answered = new Set()) => jobs.filter((j) => !answered.has(`${j.id} ${j.d.hash}`));
/** One shard's jobs, dealt round-robin: every shard starts on the most valuable it was dealt. */
const shardJobs = (jobs, shard, shards) => jobs.filter((_, i) => i % shards === shard);
const medianOf = (list) => { const s = (Array.isArray(list) ? list : []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
/** The model's measured seconds a card: the median of the last passes' (of cards of this version, measured over the answered stories: a card that asks for less is quicker), else the default. */
function cardSecondsOf(header, fallback = CARD_SECONDS) {
  const ours = !!header && header.cacheV === CACHE_V && header.perCardBy === PER_CARD_BY;
  return medianOf(ours ? header.perCard : null) ?? fallback;
}
/** A shard's measured seconds from the plan to its model answering: the median of the last passes', within bounds, else the default. */
function readySecondsOf(header, fallback = READY_SECONDS) {
  const seen = medianOf(header && header.readies);
  return seen === null ? fallback : Math.min(READY_MAX_SECONDS, Math.max(READY_MIN_SECONDS, Math.round(seen)));
}
/** The stories a shard asks at once: a whole number from 1 to LANES_MAX, LANES when none is given. */
function lanesOf(value, fallback = LANES) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(LANES_MAX, Math.floor(n)) : fallback;
}
/** The quarter-hours after the plan's slot by which a pass's cards are merged: a whole number from 1 to LAND_SLOTS_MAX, LAND_SLOTS when none is given. */
function landSlotsOf(value, fallback = LAND_SLOTS) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(LAND_SLOTS_MAX, Math.floor(n)) : fallback;
}
/**
 * How many shards, and until when they write: { shards, until, budget, soon, lands }. The cards stop at `until`, less the merge's
 * reserve before one of two marks, and never more than WINDOW_MAX_SECONDS after a shard's model answers (now + readySeconds). As
 * many shards are dealt as it takes for every owed card at the measured pace by `soon`, the first quarter-hour mark (where a minute
 * of it is left; else by `until`), at most `max`: what is not written by then is written on until `until`.
 *   lands 'next'   by the quarter-hour `landSlots` (LAND_SLOTS, 2) after the plan's slot (slot + landSlots x SLOT_SECONDS); the
 *                  first is `soon`, when the next chained cycle restores the cards: a short plan is shown one slot late, a long one two
 *   lands 'later'  a pass that starts too late for that (a cycle of the cron's at :07, a slow one) and did not wait behind another:
 *                  `landSlots` slots from its own start (startedS + landSlots x PASS_SECONDS), for the cycle after
 *   none           (shards 0, lands null) nothing owed; or under MIN_CARDS_SECONDS left; or too late for the next quarter-hour after
 *                  waiting behind another pass (startedS more than QUEUED_SECONDS after the plan was `made`): such a pass would end
 *                  after the next one's dispatch and hold that one back in turn, every pass a slot late for good. Its rows are owed
 *                  in the next cycle's plan, which the next pass writes in time
 * With no slot (a plan of an older kind), the pass's own slot alone. readySeconds: a shard's measured start after the plan
 * (`readySecondsOf`), READY_SECONDS until a pass has measured it.
 */
function shardsFor({ owed, cardSeconds = CARD_SECONDS, startedS, nowS, slot = null, made = null, max = SHARDS_MAX, readySeconds = READY_SECONDS, landSlots = LAND_SLOTS }) {
  const reserve = MERGE_RESERVE_SECONDS + SAFETY_SECONDS;
  const slots = landSlotsOf(landSlots);
  const ready = nowS + (Number.isFinite(readySeconds) && readySeconds > 0 ? readySeconds : READY_SECONDS);
  const deal = (mark, first, lands) => {
    const until = Math.min(mark, ready + WINDOW_MAX_SECONDS);
    const soon = Math.min(first, until);
    const budget = until - ready;
    if (!owed || budget < MIN_CARDS_SECONDS) return { shards: 0, until, budget, soon, lands: null };
    const window = soon - ready >= MIN_CARDS_SECONDS ? soon - ready : budget;
    return { shards: Math.max(1, Math.min(max, Math.ceil((owed * cardSeconds) / window))), until, budget, soon, lands };
  };
  const own = [startedS + slots * PASS_SECONDS - reserve, startedS + PASS_SECONDS - reserve];
  if (!Number.isFinite(slot)) return deal(...own, 'later');
  const next = deal(Math.min(own[0], slot + slots * SLOT_SECONDS - reserve), slot + SLOT_SECONDS - reserve, 'next');
  if (next.shards || !owed) return next;
  const queued = Number.isFinite(made) && startedS - made > QUEUED_SECONDS;
  return queued ? next : deal(...own, 'later');
}

// ---------- the merge ----------
/**
 * This pass's parts merged with the cards before it: the newest answer for each (trend, dossier), none older than KEPT_SECONDS before
 * the newest, at most CARDS_MAX. header: what the ledger is told of the pass. Returns { header, cards }.
 */
function merge({ previous = { header: null, cards: [] }, parts = [], run = null, attempt = null, startedS = null, nowS = Math.floor(Date.now() / 1000), planned = null, shards = null, slot = null }) {
  const best = new Map();
  for (const c of [...previous.cards, ...parts.flatMap((p) => p.cards)]) {
    const key = `${c.id} ${c.hash}`;
    if (!best.has(key) || best.get(key).t < c.t) best.set(key, c);
  }
  const newest = Math.max(0, ...[...best.values()].map((c) => c.t));
  const cards = [...best.values()].filter((c) => c.t >= newest - KEPT_SECONDS).sort((a, b) => b.t - a.t).slice(0, CARDS_MAX);
  const sum = (k) => parts.reduce((n, p) => n + (Number(p.header && p.header[k]) || 0), 0);
  const tenth = (x) => Math.round(x * 10) / 10;
  const asked = sum('asked');
  // (the stories that got an answer: a passed card, a refused one, one that did not read. Not one whose call was cut or failed)
  const answered = Math.max(0, asked - sum('unanswered'));
  const ms = sum('ms');
  // (ms: each shard's own wall time, so with lanes this is the seconds a card a shard: what a shard's window is divided by)
  const perCard = answered > 0 ? Math.round(ms / answered / 100) / 10 : null;
  const model = parts.map((p) => p.header && p.header.model).find((m) => typeof m === 'string' && m) || (previous.header && previous.header.model) || null;
  const lanes = lanesOf(parts.map((p) => p.header && p.header.lanes).find((n) => Number.isFinite(n) && n > 0), 1);
  // (the prompt the shards wrote in, lib/editor/prompt.js styleOf: the compact one reads and writes less, so it is quicker)
  const style = parts.map((p) => p.header && p.header.style).find((x) => typeof x === 'string' && x) || null;
  // (the seconds a card of the passes before, while they asked for the same card, lib/editor/prompt.js CARD_V, as many at once, in
  // the same prompt, measured the same way)
  const same = !!previous.header && previous.header.cacheV === CACHE_V && lanesOf(previous.header.lanes, 1) === lanes && previous.header.perCardBy === PER_CARD_BY
    && (previous.header.style || null) === style;
  const before = same && Array.isArray(previous.header.perCard) ? previous.header.perCard : [];
  // (a shard's start, plan to model answering: this pass's median, after the passes before)
  const ready = medianOf(parts.map((p) => p.header && p.header.ready));
  const readiesBefore = previous.header && Array.isArray(previous.header.readies) ? previous.header.readies : [];
  const header = { kind: 'cards', cacheV: CACHE_V, run, attempt, made: nowS, slot, model, planned, shards, shardsDone: parts.length, lanes, style, asked, answered, calls: sum('calls'), passed: sum('passed'),
    refused: sum('refused'), unreadable: sum('unreadable'), unanswered: sum('unanswered'), ms, seconds: Number.isFinite(startedS) ? Math.max(0, nowS - startedS) : null,
    // (the gate on the cards' why and angles, P12: what the model offered of them on the cards the gate passed, and what passed)
    whys: sum('whys'), whysPassed: sum('whysPassed'), angles: sum('angles'), anglesPassed: sum('anglesPassed'),
    // (where the model's time went, summed over every call the server timed: the prompt it had to read (what its cache did not
    // hold), the reply, the model's load; each call's own seconds, so with lanes they add up to more than the shard's)
    metered: sum('metered'), promptTokens: sum('promptTokens'), promptSeconds: tenth(sum('promptSeconds')), replyTokens: sum('replyTokens'), replySeconds: tenth(sum('replySeconds')),
    loadSeconds: tenth(sum('loadSeconds')), ready, readies: [...readiesBefore, ...(ready ? [ready] : [])].slice(-PER_CARD_KEPT),
    // (the replies: the longest any call wrote, and the calls the reply's allowance cut short: the allowance's own measure)
    replyMax: Math.max(0, ...parts.map((p) => Number(p.header && p.header.replyMax) || 0)), cut: sum('cut'),
    perCardBy: PER_CARD_BY, perCard: [...before, ...(perCard ? [perCard] : [])].slice(-PER_CARD_KEPT), cards: cards.length };
  return { header, cards };
}

// ---------- collect's side ----------
/**
 * The editor's settings for a collect with no model of its own: cards only. The cards in `file` are imported where they still match
 * (`importCard`), kept cards are shown as ever, nothing is asked, and the rows still owed go to `plan` for the next enrich pass.
 * Rows: the first IDEAS_EDITOR_ROWS (80) of the page; dossiers of IDEAS_EDITOR_SOURCES (16) sentences, as the model's settings have.
 */
function cardsOnlyConfig({ env = process.env, file = null, plan = null } = {}) {
  const count = (v, d, max) => { const n = Number(v); return Math.min(max, Number.isFinite(n) && n > 0 ? Math.floor(n) : d); };
  const read = file ? readCards(file) : { header: null, cards: [] };
  return { editor: true, cardsOnly: true, model: (read.header && read.header.model) || null, editorRows: count(env.IDEAS_EDITOR_ROWS, 80, 80), editorShown: count(env.IDEAS_EDITOR_SOURCES, 16, 40),
    imported: indexCards(read.cards), enrichHeader: read.header, plan, trace: null };
}

/** What the ledger is told of the enrich pass whose cards this cycle imported: counts and seconds only. */
function enrichOf(header, editorStats, { nowS = Math.floor(Date.now() / 1000), seenRun = null } = {}) {
  const imp = (editorStats && editorStats.import) || {};
  const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const base = { imported: imp.used || 0, held: imp.held || 0, stale: imp.stale || 0, planned: n(editorStats && editorStats.planned) };
  if (!header) return { run: null, ...base };
  const run = n(header.run);
  return { run, age: Number.isFinite(header.made) ? Math.max(0, Math.round((nowS - header.made) / 60)) : null, fresh: run !== null && run !== seenRun,
    asked: n(header.asked), passed: n(header.passed), seconds: n(header.seconds), shards: n(header.shards), shardsDone: n(header.shardsDone), perCard: cardSecondsOf(header, null), ...base,
    // (the gate's pass rate on the why and the angles, P12: counts only)
    whys: n(header.whys), whysPassed: n(header.whysPassed), angles: n(header.angles), anglesPassed: n(header.anglesPassed),
    // (the pass's own planned count, beside this cycle's)
    passPlanned: n(header.planned),
    // (where the model's time went, counts and seconds only: the calls, the stories a shard asked at once, a shard's start after the
    // plan, and over the calls the server timed, the prompt tokens it read and their seconds, the reply's, the model's loads)
    calls: n(header.calls), lanes: n(header.lanes), ready: n(header.ready), metered: n(header.metered), promptTokens: n(header.promptTokens), promptSeconds: n(header.promptSeconds),
    replyTokens: n(header.replyTokens), replySeconds: n(header.replySeconds), loadSeconds: n(header.loadSeconds),
    // (2026-10-27: the stories answered, the longest reply and the replies cut short. The host's ledger.js keeps the numbers it lists)
    answered: n(header.answered), unanswered: n(header.unanswered), replyMax: n(header.replyMax), cut: n(header.cut) };
}

module.exports = { writePlan, readPlan, readCards, writeCards, cardOf, indexCards, answeredOf, importCard, pending, shardJobs, cardSecondsOf, readySecondsOf, lanesOf, landSlotsOf, medianOf, shardsFor, merge,
  cardsOnlyConfig, enrichOf, encodeLex, decodeLex, writeAtomic, isAnswer, V, CACHE_V, LEGACY_V, CARD_SECONDS, READY_SECONDS, MERGE_RESERVE_SECONDS, SAFETY_SECONDS, PASS_SECONDS,
  MIN_CARDS_SECONDS, QUEUED_SECONDS, SLOT_SECONDS, SHARDS_MAX, LANES, LANES_MAX, KEPT_SECONDS, PLAN_MAX_AGE_SECONDS, PER_CARD_BY, LAND_SLOTS, LAND_SLOTS_MAX, WINDOW_MAX_SECONDS };
