'use strict';
/*
 * Stories by meaning at the desk (ios/IDEAS-SUPER.md P8). The clustering (lib/cluster/cluster.js) needs an embedding model, and
 * collect has none since P11; a model's vectors for a cycle's new headlines would cost the model's install (about 57 s on the
 * runner: probe-embed, 2026-10-19) on top of their 3 to 7 s, over P8's 30 s a cycle. So the stories are made in the enrich pass,
 * which starts a model anyway, and imported one slot late like the cards. Three files, all private (the state's and the cards'
 * own Actions cache entries: never the feed, an artifact or a log):
 *
 *   plan     <state>/enrich/stories.json, written by collect every cycle (`writePlan`): the desk's rows as the engine made them,
 *            each the sentences it holds as its own (meta.own), the seeds of the clustering. { v, kind: 'stories-plan', t, nowMs,
 *            made, rows: [[{ text, t }]] }
 *   stories  the enrich pass's answer (`build`, `writeStories`), merged into the cards entry the next collect restores:
 *            { v, kind: 'stories', slot, made, model, dims, tuned, stats, groups: [[text key]] }: every story of two texts or more
 *            over the plan's rows and the store's sentences of the 72 hours before it, each text by its key (lib/cluster/embed.js
 *            keyOf: 12 bytes of its sha256; the text itself never travels)
 *   the desk `indexOf(file)`, then `twin(a, b)`: two rows are one story by meaning when most of the own sentences each has that
 *            the stories know sit in one story (lib/desk.js asks also that their headlines name each other)
 *
 * With no stories file, one too old, of a model with no tuned thresholds, or one that does not read, the desk decides as it always
 * has (its string rules): nothing here is needed for a cycle to run.
 */
const fs = require('node:fs');
const path = require('node:path');
const E = require('./embed');
const CL = require('./cluster');
const TUNED = require('./tuned');

const V = 1;
const HOUR_MS = 3600e3;
// (the sentences the stories are made over: the store's of the last three days, as the frozen days' pools hold them)
const WINDOW_MS = 72 * HOUR_MS;
// (a plan this old is no cycle's any more: the pass makes nothing from it)
const PLAN_MAX_AGE_SECONDS = 40 * 60;
// (stories this old are still what they were about the sentences they name; past this the desk goes on without them)
const STORIES_MAX_AGE_SECONDS = 6 * 3600;
const ROWS_MAX = 400;
const OWN_MAX = 80;
const TEXT_MAX = 400;
const EMBED_CHUNK = 256;
// a row's story: the one holding most of its known own sentences, at least this many of them and at least this share
const KNOWN_MIN = 2;
const SHARE_MIN = 0.5;

/** Writes text to a file atomically: built whole beside it, then renamed into place. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.new`, text);
  fs.renameSync(`${file}.new`, file);
}

const textOf = (x) => String((x && x.title) || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
/** The rows a plan seeds the stories with: talking points that are no word, and moments; each its own sentences. */
const seedRow = (row) => !!row && ((row.type === 'point' && !row.wordish) || row.type === 'moment');

// ---------- the plan (collect) ----------
/** The plan of one cycle: the rows' own sentences ([{ text, t }] a row). rows: the desk's input rows of one audience. */
function planOf(rows, { t, nowMs, made = Math.floor(Date.now() / 1000) }) {
  const out = [];
  for (const row of (rows || []).filter(seedRow).slice(0, ROWS_MAX)) {
    const own = ((row.meta && row.meta.own) || []).map((r) => ({ text: textOf(r), t: Number.isFinite(r.t) ? r.t : null })).filter((x) => x.text).slice(-OWN_MAX);
    if (own.length) out.push(own);
  }
  return { v: V, kind: 'stories-plan', t, nowMs, made, rows: out };
}
/** Writes the plan; returns the rows written. */
function writePlan(file, plan) {
  writeAtomic(file, JSON.stringify(plan));
  return plan.rows.length;
}
/** The plan in a file: { plan } or { plan: null, why }. */
function readPlan(file, { nowS = Math.floor(Date.now() / 1000), maxAge = PLAN_MAX_AGE_SECONDS } = {}) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { plan: null, why: e.code === 'ENOENT' ? 'no plan' : 'the plan does not read' }; }
  if (!raw || raw.v !== V || raw.kind !== 'stories-plan' || !Array.isArray(raw.rows) || !Number.isFinite(raw.t) || !Number.isFinite(raw.nowMs)) return { plan: null, why: 'the plan is of another kind' };
  if (!Number.isFinite(raw.made) || nowS - raw.made > maxAge) return { plan: null, why: 'the plan is too old' };
  const rows = raw.rows.filter(Array.isArray).map((r) => r.filter((x) => x && typeof x.text === 'string' && x.text).map((x) => ({ text: x.text.slice(0, TEXT_MAX), t: Number.isFinite(x.t) ? x.t : null }))).filter((r) => r.length);
  return { plan: { t: raw.t, nowMs: raw.nowMs, made: raw.made, rows } };
}

// ---------- the stories (enrich) ----------
/** The store's sentences of the window before `nowMs`: [{ text, t, fam }], the engine's own reading of each title. */
function windowTexts(store, nowMs, { cleanTitle = (r) => r.title } = {}) {
  const out = [];
  for (const r of (store && store.rows ? store.rows.values() : [])) {
    if (!r || !Number.isFinite(r.t) || r.t < nowMs - WINDOW_MS || r.t > nowMs + HOUR_MS) continue;
    let title;
    try { title = cleanTitle(r); } catch { title = r.title; }
    const text = textOf({ title });
    if (text) out.push({ text, t: r.t, fam: r.fam || null });
  }
  return out;
}

/**
 * Vectors for texts, as many as `deadlineMs` allows: asked in chunks (the cached embedder answers what it holds at once), a text
 * not reached in time has none (it links to nothing; the next pass asks it). Returns { vectors, asked, error }.
 */
async function embedUntil(embedder, texts, deadlineMs, { now = Date.now } = {}) {
  const vectors = new Array(texts.length).fill(null);
  let error = null;
  for (let i = 0; i < texts.length; i += EMBED_CHUNK) {
    const left = deadlineMs - now();
    if (left <= 0) { error = 'out of time'; break; }
    const part = await E.embedWithin(embedder, texts.slice(i, i + EMBED_CHUNK), left);
    if (!part.vectors) { error = part.error; break; }
    part.vectors.forEach((v, j) => { vectors[i + j] = v; });
  }
  return { vectors, error };
}

/** The engine's names in each text, by a lexicon of the texts themselves (as the bench reads them: lib/cluster/bench.js). */
function namesOf(items) {
  const W = require('../../engine/wording');
  const C = require('../../engine/cluster');
  const its = items.map((it) => ({ title: it.text, t: it.t, fam: it.fam || 'gnews' }));
  const lex = W.buildLexicon(its.map((i) => i.title), [], [], []);
  return its.map((it) => { C.annotate(it, lex); return it.ents || []; });
}

/**
 * The stories of one plan. texts: windowTexts' (the store's sentences); embedder: a cached embedder (lib/cluster/embed.js) of a
 * model with tuned thresholds; deadlineMs: when the vectors must be in. Resolves { stories, why }: the stories file's content, or
 * null and why (no tuned thresholds, no vectors at all).
 */
async function build({ plan, texts, embedder, deadlineMs, now = Date.now, thresholds = null }) {
  const started = now();
  const th = thresholds || TUNED.thresholdsFor(embedder.model);
  if (!th.tuned) return { stories: null, why: `${embedder.model} has no tuned thresholds (lib/cluster/tuned.js)` };
  // the rows' sentences first (the seeds), then the window's newest first: what is asked first is what a slow model still answers
  const items = [];
  const seeds = [];
  for (const row of plan.rows) {
    seeds.push(row.map((x) => { items.push({ text: x.text, t: x.t, fam: null }); return items.length - 1; }));
  }
  for (const x of [...texts].sort((a, b) => b.t - a.t)) items.push({ text: x.text, t: x.t, fam: x.fam });
  const names = namesOf(items);
  const { vectors, error } = await embedUntil(embedder, items.map((it) => it.text), deadlineMs, { now });
  const live = vectors.filter(Boolean).length;
  if (!live) return { stories: null, why: `no vectors${error ? `: ${error}` : ''}` };
  const clustered = CL.storyGroups(items.map((it, i) => ({ text: it.text, t: Number.isFinite(it.t) ? it.t : null, kind: 'text', names: names[i] })), vectors, { ...th, seeds });
  const groups = clustered.groups.map((g) => [...new Set(g.map((i) => E.keyOf(items[i].text)))]).filter((g) => g.length >= 2);
  const st = embedder.stats ? embedder.stats() : {};
  const seededIn = new Set();
  const gOf = new Map();
  clustered.groups.forEach((g, k) => g.forEach((i) => gOf.set(i, k)));
  for (const seed of seeds) { const k = majorityOf(seed.map((i) => gOf.get(i))); if (k !== null) seededIn.add(k); }
  return {
    stories: { v: V, kind: 'stories', slot: plan.t, made: Math.floor(now() / 1000), model: embedder.model, dims: embedder.dims || null, tuned: true,
      stats: { rows: plan.rows.length, texts: items.length, vectors: live, asked: st.asked || 0, embedSeconds: Math.round((st.ms || 0) / 100) / 10,
        groups: groups.length, rowStories: seededIn.size, split: clustered.stats.split || 0, seconds: Math.round((now() - started) / 100) / 10, late: error || null },
      groups },
    why: null,
  };
}

/** The value most of `values` hold (undefined ones aside), when at least KNOWN_MIN and SHARE_MIN of the known hold it; else null. */
function majorityOf(values) {
  const counts = new Map();
  let known = 0;
  for (const v of values) { if (v === undefined || v === null) continue; known += 1; counts.set(v, (counts.get(v) || 0) + 1); }
  let best = null; let n = 0;
  for (const [v, c] of counts) if (c > n) { best = v; n = c; }
  return known >= KNOWN_MIN && n >= SHARE_MIN * known ? best : null;
}

/** Writes the stories file. */
function writeStories(file, stories) {
  writeAtomic(file, JSON.stringify(stories));
  return stories.groups.length;
}

/** The vector cache in a file, or null (none, or not one: a new one is started). */
function readCache(file) {
  try { return E.cacheFromBuffer(fs.readFileSync(file)); } catch { return null; }
}

/**
 * One pass from a state folder (the host's enrich job, .github/scripts/stories.js; a replayed day, eval/replay.sh EVAL_STORIES):
 * the plan collect left in <state>/enrich/stories.json, the store's sentences, their vectors from `model` served at `base` (an
 * Ollama /api/embed) through the cache in `vectors` (written back without the rows unused for 14 days, whatever comes of the
 * stories), the stories written to `out`. Resolves { wrote, stats, why, cacheRows }; never rejects.
 * deadlineMs: when the vectors must be in; maxAge: how old a plan may be (seconds); nowS: the clock the plan's age is read by.
 */
async function buildFromState({ state, vectors, out, model = 'all-minilm', base, deadlineMs, maxAge = PLAN_MAX_AGE_SECONDS, nowS = Math.floor(Date.now() / 1000), dims = 384, fetchImpl }) {
  const read = readPlan(path.join(state, 'enrich', 'stories.json'), { nowS, maxAge });
  if (!read.plan) return { wrote: false, stats: null, why: read.why, cacheRows: null };
  const ST = require('../../engine/store');
  const ENGINE = require('../../engine/build');
  const store = ST.openStore(path.join(state, 'engine', 'store.json'));
  // (each title as the engine reads it, its outlet's suffix cut: what the rows' own sentences are)
  const texts = windowTexts(store, read.plan.nowMs, { cleanTitle: (r) => ENGINE.prepare(r).title });
  const embedder = E.cachedEmbedder(E.ollamaEmbedder({ model, base, ...(fetchImpl ? { fetchImpl } : {}) }), { cache: readCache(vectors), dims });
  let r;
  try { r = await build({ plan: read.plan, texts, embedder, deadlineMs }); } catch (e) { r = { stories: null, why: `the build failed: ${e.message}` }; }
  let cacheRows = null;
  try {
    const kept = E.pruneCache(embedder.cache, Date.now());
    writeAtomic(vectors, E.cacheToBuffer(kept));
    cacheRows = kept.rows.size;
  } catch { cacheRows = null; }
  if (!r.stories) return { wrote: false, stats: null, why: r.why, cacheRows };
  writeStories(out, r.stories);
  return { wrote: true, stats: r.stories.stats, why: null, cacheRows };
}

// ---------- the import (collect) ----------
const KEY = /^[0-9a-f]{24}$/;
/**
 * The stories in a file as the desk reads them: { index, why }. index: { slot, made, model, stats, of: Map(text key -> story),
 * storyOf(row), twin(a, b) } or null (no file, another kind, too old, a model with no tuned thresholds).
 */
function indexOf(file, { nowS = Math.floor(Date.now() / 1000), maxAge = STORIES_MAX_AGE_SECONDS } = {}) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { index: null, why: e.code === 'ENOENT' ? 'no stories' : 'the stories do not read' }; }
  if (!raw || raw.v !== V || raw.kind !== 'stories' || !Array.isArray(raw.groups) || !Number.isFinite(raw.made)) return { index: null, why: 'the stories are of another kind' };
  if (nowS - raw.made > maxAge) return { index: null, why: 'the stories are too old' };
  if (raw.tuned !== true || !TUNED.thresholdsFor(raw.model).tuned) return { index: null, why: 'the stories are of a model with no tuned thresholds' };
  const of = new Map();
  raw.groups.forEach((g, k) => { if (Array.isArray(g)) for (const key of g) if (typeof key === 'string' && KEY.test(key)) of.set(key, k); });
  return { index: indexFrom(of, raw), why: null };
}

/** An index over a Map(text key -> story): the row's story and the twin test, a row's keys hashed once. */
function indexFrom(of, { slot = null, made = null, model = null, stats = null } = {}) {
  const memo = new WeakMap();
  const storyOf = (row) => {
    if (!seedRow(row)) return null;
    if (memo.has(row)) return memo.get(row);
    const keys = ((row.meta && row.meta.own) || []).map(textOf).filter(Boolean).map(E.keyOf);
    const story = majorityOf(keys.map((k) => of.get(k)));
    memo.set(row, story);
    return story;
  };
  const twin = (a, b) => { const x = storyOf(a); return x !== null && x === storyOf(b); };
  return { slot, made, model, stats, size: of.size, of, storyOf, twin };
}

module.exports = { planOf, writePlan, readPlan, windowTexts, embedUntil, build, buildFromState, readCache, writeStories, indexOf, indexFrom, majorityOf, seedRow,
  V, WINDOW_MS, PLAN_MAX_AGE_SECONDS, STORIES_MAX_AGE_SECONDS, KNOWN_MIN, SHARE_MIN };

// (a replayed day's pass, eval/replay.sh EVAL_STORIES: node lib/cluster/stories.js <state> <vectors> <out> <base> [model]; counts only)
if (require.main === module) {
  const [state, vectors, out, base, model = 'all-minilm'] = process.argv.slice(2);
  if (!state || !vectors || !out || !base) { process.stderr.write('usage: node lib/cluster/stories.js <state> <vectors> <out> <base url> [model]\n'); process.exit(2); }
  buildFromState({ state, vectors, out, model, base, deadlineMs: Date.now() + 600e3, maxAge: Infinity }).then((r) => {
    process.stdout.write(`${JSON.stringify({ wrote: r.wrote, why: r.why, cacheRows: r.cacheRows, ...(r.stats || {}) })}\n`);
  });
}
