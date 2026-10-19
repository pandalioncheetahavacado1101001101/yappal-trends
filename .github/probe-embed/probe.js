#!/usr/bin/env node
'use strict';
/*
 * The embedding probe (ios/IDEAS-SUPER.md P8): can story clustering's embedder (lib/cluster/embed.js) run inside the collect job,
 * at most 30 seconds a cycle, or must it go to an enrich job? Measured on GitHub's own runner, with Ollama serving each candidate:
 *
 *   pull       seconds to fetch the model and its size on disk (what the Actions cache would hold and restore every cycle)
 *   load       seconds for the first vector of a cold model (paid by every cycle: each job is a fresh machine)
 *   batches    2,000 invented headlines (headlines.js: nobody real) at batch sizes 16, 64 and 256: seconds, texts a second, the
 *              Ollama processes' peak memory and the machine's least available memory while it ran
 *   cycle      restore + load + new texts / best rate, for a typical cycle, a busy one and a cold start (the 14-day cache empty);
 *              "collect" when the typical cycle fits the budget, else "enrich"
 *   separation how far apart the model holds what clustering must keep apart: cosines of headline pairs of one story, of one
 *              person's two stories, of two people's stories of the same kind, of anything else; AUCs; the cosine that best
 *              separates one story from the same person's other one; the same at 256 numbers (Matryoshka) when the model is longer
 *   editor     (--editor <model>) the editor model loaded beside it: memory with both, and embedding while the editor writes
 *
 * Publishes nothing itself: writes results.json and results.md (numbers, model names, fixed labels and instants; never a headline)
 * for the workflow to put on the "probe-embed" branch after `--check` passes.
 *
 *   node probe.js --models "nomic-embed-text all-minilm" [--texts 2000] [--out probe-embed-out] [--editor <model>] [--install-seconds n]
 *   node probe.js --check probe-embed-out/results.json
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { headlines } = require('./headlines');

const BASE = process.env.OLLAMA_BASE || 'http://127.0.0.1:11434';
const BATCHES = [16, 64, 256];
const BUDGET_SECONDS = 30; // the most a collect cycle may spend on vectors (ios/IDEAS-SUPER.md P8)
// texts a cycle must embed, from a frozen day's pool (distinct texts by quarter hour: median about 120, p90 about 300, top 510;
// a cold start holds about 27,000): a typical cycle, a busy one, and the 14-day cache empty
const PER_CYCLE = { typical: 300, peak: 1000, cold: 27000 };
const RESTORE_MBPS = 100; // an assumption, not a measure: the Actions cache restores at about this rate (the model's 5.2 GB in ~60 s)
const PAIRS = 20000;
const PULL_TIMEOUT_MS = 600000;
const EMBED_TIMEOUT_MS = 300000;
const LABELS = new Set(['collect', 'enrich', 'pull-failed', 'load-failed', 'embed-failed', 'no-vectors', 'editor-failed', 'not-linux']);

// ---------- numbers ----------
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function unit(v, dims = 0) {
  const x = dims && v.length > dims ? v.slice(0, dims) : v;
  const n = Math.sqrt(dot(x, x));
  return n > 0 ? Float32Array.from(x, (y) => y / n) : null;
}
function quantiles(xs) {
  const s = Float64Array.from(xs).sort();
  const at = (p) => (s.length ? round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null);
  return { n: s.length, p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}
/** The chance a positive pair scores above a negative one (ties count half). */
function auc(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const all = [...pos.map((x) => [x, 1]), ...neg.map((x) => [x, 0])].sort((a, b) => a[0] - b[0]);
  let sum = 0; let i = 0;
  while (i < all.length) {
    let j = i; while (j < all.length && all[j][0] === all[i][0]) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (all[k][1]) sum += rank;
    i = j;
  }
  return round((sum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length));
}
/** The cosine that best tells positives from negatives (most positives above, fewest negatives above: Youden's J). */
function bestCut(pos, neg) {
  if (!pos.length || !neg.length) return null;
  const cuts = [...new Set([...pos, ...neg].map((x) => round(x, 2)))].sort((a, b) => a - b);
  let best = { cut: null, j: -1 };
  for (const c of cuts) {
    const tp = pos.filter((x) => x >= c).length / pos.length;
    const fp = neg.filter((x) => x >= c).length / neg.length;
    if (tp - fp > best.j) best = { cut: c, j: tp - fp };
  }
  return { cut: best.cut, j: round(best.j) };
}

/** How far apart the vectors hold the invented stories (see the header). labels: [{ person, story, kind }]. */
function separation(vectors, labels, seed = 7) {
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const n = vectors.length;
  const byStory = new Map();
  labels.forEach((l, i) => { if (vectors[i]) { if (!byStory.has(l.story)) byStory.set(l.story, []); byStory.get(l.story).push(i); } });
  const same = []; const person = []; const kind = []; const other = [];
  for (const ids of byStory.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) same.push(dot(vectors[ids[a]], vectors[ids[b]]));
  const stories = [...byStory.keys()];
  for (const st of stories) {
    if (st % 2) continue;
    const xs = byStory.get(st) || []; const ys = byStory.get(st + 1) || [];
    for (const a of xs) for (const b of ys) person.push(dot(vectors[a], vectors[b]));
  }
  for (let k = 0; k < PAIRS * 4 && (kind.length < PAIRS || other.length < PAIRS); k++) {
    const a = Math.floor(rand() * n); const b = Math.floor(rand() * n);
    if (!vectors[a] || !vectors[b] || labels[a].person === labels[b].person) continue;
    const c = dot(vectors[a], vectors[b]);
    if (labels[a].kind === labels[b].kind) { if (kind.length < PAIRS) kind.push(c); } else if (other.length < PAIRS) other.push(c);
  }
  // story level: a story's two halves against one person's two stories (what the veto's centroid test sees)
  const centroid = (ids) => { const v = new Float32Array(vectors[ids[0]].length); for (const i of ids) for (let k = 0; k < v.length; k++) v[k] += vectors[i][k]; return unit(v); };
  const halves = []; const twoStories = [];
  for (const st of stories) {
    const ids = byStory.get(st);
    if (ids.length >= 4) halves.push(dot(centroid(ids.filter((_, k) => k % 2 === 0)), centroid(ids.filter((_, k) => k % 2 === 1))));
    if (st % 2 === 0 && byStory.has(st + 1)) twoStories.push(dot(centroid(ids), centroid(byStory.get(st + 1))));
  }
  return {
    pairs: { sameStory: quantiles(same), samePersonOtherStory: quantiles(person), sameKindOtherPerson: quantiles(kind), unrelated: quantiles(other) },
    auc: { storyOverPerson: auc(same, person), storyOverKind: auc(same, kind), storyOverUnrelated: auc(same, other) },
    cut: bestCut(same, person),
    centroids: { storyHalves: quantiles(halves), personTwoStories: { ...quantiles(twoStories), max: round(Math.max(...twoStories)) } },
  };
}

/** The seconds a cycle would spend: restoring the model from the cache, loading it, and embedding `texts` new texts. */
function cycleSeconds({ mb, loadSeconds, perSecond }, texts) {
  if (!(perSecond > 0)) return null;
  return round(mb / RESTORE_MBPS + loadSeconds + texts / perSecond, 1);
}

// ---------- the machine ----------
const mb = (kb) => Math.round(kb / 1024);
/** The resident memory of every Ollama process and the machine's available memory, in MB; nulls off Linux. */
function memoryNow() {
  if (process.platform !== 'linux') return { ollamaMb: null, availableMb: null };
  let rss = 0;
  for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      if (!fs.readFileSync(`/proc/${pid}/comm`, 'utf8').startsWith('ollama')) continue;
      rss += parseStatusKb(fs.readFileSync(`/proc/${pid}/status`, 'utf8'), 'VmRSS') || 0;
    } catch { /* gone */ }
  }
  let avail = null;
  try { avail = parseStatusKb(fs.readFileSync('/proc/meminfo', 'utf8'), 'MemAvailable'); } catch { /* none */ }
  return { ollamaMb: mb(rss), availableMb: avail === null ? null : mb(avail) };
}
/** A "Key:   1234 kB" line's number (kB), or null. */
function parseStatusKb(text, key) {
  const m = String(text).match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm'));
  return m ? Number(m[1]) : null;
}
/** Samples memoryNow every 250 ms until stopped: { peakMb, availableMinMb }. */
function sampler() {
  let peak = 0; let avail = Infinity;
  const take = () => { const m = memoryNow(); if (m.ollamaMb !== null) peak = Math.max(peak, m.ollamaMb); if (m.availableMb !== null) avail = Math.min(avail, m.availableMb); };
  take();
  const timer = setInterval(take, 250);
  return { stop() { clearInterval(timer); take(); return { peakMb: peak || null, availableMinMb: Number.isFinite(avail) ? avail : null }; } };
}

// ---------- Ollama ----------
async function call(route, body, timeoutMs) {
  const res = await fetch(`${BASE}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const prefixFor = (model) => (/nomic-embed/i.test(model) ? 'clustering: ' : '');
async function embed(model, texts, batch) {
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const j = await call('/api/embed', { model, input: texts.slice(i, i + batch).map((t) => prefixFor(model) + t), truncate: true, keep_alive: '30m' }, EMBED_TIMEOUT_MS);
    if (!Array.isArray(j.embeddings) || j.embeddings.length !== Math.min(batch, texts.length - i)) throw new Error('no-vectors');
    out.push(...j.embeddings);
  }
  return out;
}
async function sizeMb(model) {
  const tags = await call('/api/tags', null, 30000);
  const want = model.includes(':') ? model : `${model}:latest`;
  const row = (tags.models || []).find((m) => m.name === want || m.model === want || m.name === model);
  return row ? Math.round(row.size / 1048576) : null;
}
async function inMemoryMb(model) {
  try {
    const ps = await call('/api/ps', null, 30000);
    const row = (ps.models || []).find((m) => m.name === model || m.name === `${model}:latest` || m.model === model);
    return row ? Math.round(row.size / 1048576) : null;
  } catch { return null; }
}
const stop = (model) => { spawnSync('ollama', ['stop', model], { stdio: 'ignore', timeout: 60000 }); };
const seconds = (t0) => round((Date.now() - t0) / 1000, 2);

/** Everything about one model (the header). Errors become fixed labels, never messages. */
async function probeModel(model, items) {
  const texts = items.map((x) => x.text);
  const row = { model };
  let t0 = Date.now();
  try { await call('/api/pull', { model, stream: false }, PULL_TIMEOUT_MS); } catch { return { ...row, error: 'pull-failed' }; }
  row.pull = { seconds: seconds(t0), mb: await sizeMb(model).catch(() => null) };
  t0 = Date.now();
  let first;
  try { first = await embed(model, texts.slice(0, 1), 1); } catch { return { ...row, error: 'load-failed' }; }
  row.load = { seconds: seconds(t0) };
  row.dims = first[0].length;
  row.batches = [];
  let vectors = null;
  for (const batch of BATCHES) {
    const mem = sampler();
    t0 = Date.now();
    try {
      const vs = await embed(model, texts, batch);
      const s = seconds(t0);
      row.batches.push({ batch, seconds: s, perSecond: round(texts.length / s, 1), ...mem.stop() });
      vectors = vs;
    } catch {
      mem.stop();
      row.batches.push({ batch, error: 'embed-failed' });
    }
  }
  row.inMemoryMb = await inMemoryMb(model);
  const ok = row.batches.filter((b) => b.perSecond);
  if (!ok.length || !vectors) return { ...row, error: 'embed-failed' };
  const best = ok.reduce((a, b) => (b.perSecond > a.perSecond ? b : a));
  row.best = { batch: best.batch, perSecond: best.perSecond };
  const cost = { mb: row.pull.mb || 0, loadSeconds: row.load.seconds, perSecond: best.perSecond };
  row.cycle = Object.fromEntries(Object.entries(PER_CYCLE).map(([k, n]) => [k, cycleSeconds(cost, n)]));
  row.verdict = row.cycle.typical !== null && row.cycle.typical <= BUDGET_SECONDS ? 'collect' : 'enrich';
  const full = vectors.map((v) => unit(v));
  row.separation = separation(full, items);
  row.separation256 = row.dims > 256 ? separation(vectors.map((v) => unit(v, 256)), items) : null;
  return row;
}

/** The editor model beside an embedder: memory with both loaded, and embedding while the editor writes. */
async function probeEditor(editor, embedder, items) {
  const texts = items.map((x) => x.text);
  const ask = () => call('/v1/chat/completions', { model: editor, temperature: 0, max_tokens: 256, reasoning_effort: 'none',
    messages: [{ role: 'user', content: 'Write a plain two-hundred-word description of a quiet harbour town at dawn.' }] }, 600000);
  const rate = (reply, t0) => { const n = reply && reply.usage && reply.usage.completion_tokens; return n ? round(n / ((Date.now() - t0) / 1000), 1) : null; };
  const out = { model: editor };
  try {
    let t0 = Date.now();
    await ask();
    out.loadSeconds = seconds(t0);
    t0 = Date.now();
    out.generationAlone = rate(await ask(), t0);
    const mem = sampler();
    t0 = Date.now();
    await embed(embedder, texts, 64);
    out.embedIdlePerSecond = round(texts.length / ((Date.now() - t0) / 1000), 1);
    t0 = Date.now();
    const writing = ask().then((r) => rate(r, t0));
    const e0 = Date.now();
    await embed(embedder, texts, 64);
    out.embedBusyPerSecond = round(texts.length / ((Date.now() - e0) / 1000), 1);
    out.generationBusy = await writing;
    Object.assign(out, mem.stop());
    return out;
  } catch { return { ...out, error: 'editor-failed' }; }
}

// ---------- the guard ----------
const KEYS = new Set(['schema', 'at', 'runner', 'cores', 'memoryMb', 'install', 'seconds', 'texts', 'perCycle', 'typical', 'peak', 'cold', 'budgetSeconds',
  'assumedRestoreMBps', 'models', 'model', 'pull', 'mb', 'load', 'dims', 'batches', 'batch', 'perSecond', 'peakMb', 'availableMinMb', 'inMemoryMb', 'best',
  'cycle', 'verdict', 'separation', 'separation256', 'pairs', 'sameStory', 'samePersonOtherStory', 'sameKindOtherPerson', 'unrelated', 'n', 'p10', 'p50',
  'p90', 'max', 'auc', 'storyOverPerson', 'storyOverKind', 'storyOverUnrelated', 'cut', 'j', 'centroids', 'storyHalves', 'personTwoStories', 'error',
  'editor', 'loadSeconds', 'generationAlone', 'embedIdlePerSecond', 'embedBusyPerSecond', 'generationBusy']);
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
/** The problems that stop a publish: a key the probe does not write, a string that is not a model, a label or an instant. */
function check(result) {
  const problems = [];
  const walk = (v, where, key) => {
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) problems.push(`${where}: not a finite number`); return; }
    if (typeof v === 'string') {
      const ok = (key === 'at' && INSTANT.test(v)) || ((key === 'error' || key === 'verdict') && LABELS.has(v)) || (key === 'model' && MODEL.test(v));
      if (!ok) problems.push(`${where}: a string that is not a model, a label or an instant`);
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${where}[${i}]`, key)); return; }
    if (typeof v === 'object') { for (const [k, x] of Object.entries(v)) { if (!KEYS.has(k)) problems.push(`${where}: unknown key`); else walk(x, `${where}.${k}`, k); } return; }
    problems.push(`${where}: unexpected value`);
  };
  walk(result, 'results', null);
  return problems;
}

function markdown(r) {
  const lines = ['# Embedding probe', '', `${r.at}. Runner: ${r.runner.cores} cores, ${r.runner.memoryMb} MB. ${r.texts} invented headlines. Install: ${r.install.seconds ?? '?'} s.`, '',
    `Budget ${r.budgetSeconds} s a collect cycle; texts a cycle: typical ${r.perCycle.typical}, busy ${r.perCycle.peak}, cold ${r.perCycle.cold}; cache restore assumed at ${r.assumedRestoreMBps} MB/s.`, '',
    '| model | MB | pull s | load s | dims | best texts/s (batch) | Ollama peak MB | cycle s typical / busy / cold | verdict | story over person AUC | cut | person centroids p90 / max |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const m of r.models) {
    if (m.error && !m.best) { lines.push(`| ${m.model} | | | | | ${m.error} | | | | | | |`); continue; }
    const peak = Math.max(...m.batches.map((b) => b.peakMb || 0));
    const s = m.separation;
    lines.push(`| ${m.model} | ${m.pull.mb} | ${m.pull.seconds} | ${m.load.seconds} | ${m.dims} | ${m.best.perSecond} (${m.best.batch}) | ${peak || '?'} | ${m.cycle.typical} / ${m.cycle.peak} / ${m.cycle.cold} | ${m.verdict} | ${s.auc.storyOverPerson} | ${s.cut ? s.cut.cut : '?'} | ${s.centroids.personTwoStories.p90} / ${s.centroids.personTwoStories.max} |`);
  }
  lines.push('', '| model | batch | s | texts/s | Ollama peak MB | least available MB |', '|---|---|---|---|---|---|');
  for (const m of r.models) for (const b of m.batches || []) lines.push(`| ${m.model} | ${b.batch} | ${b.seconds ?? b.error} | ${b.perSecond ?? ''} | ${b.peakMb ?? ''} | ${b.availableMinMb ?? ''} |`);
  lines.push('', '| model | pairs: one story p10 / p50 | one person, two stories p50 / p90 | same kind, two people p50 / p90 | unrelated p50 / p90 | AUC over kind / unrelated |', '|---|---|---|---|---|---|');
  for (const m of r.models) {
    for (const [label, s] of [[m.model, m.separation], [`${m.model} at 256`, m.separation256]]) {
      if (!s) continue;
      const p = s.pairs;
      lines.push(`| ${label} | ${p.sameStory.p10} / ${p.sameStory.p50} | ${p.samePersonOtherStory.p50} / ${p.samePersonOtherStory.p90} | ${p.sameKindOtherPerson.p50} / ${p.sameKindOtherPerson.p90} | ${p.unrelated.p50} / ${p.unrelated.p90} | ${s.auc.storyOverKind} / ${s.auc.storyOverUnrelated} |`);
    }
  }
  if (r.editor) {
    const e = r.editor;
    lines.push('', `Editor ${e.model} beside the first embedder: ${e.error || `loaded in ${e.loadSeconds} s; writes ${e.generationAlone} tokens/s alone, ${e.generationBusy} while embedding; embeds ${e.embedIdlePerSecond} texts/s beside it idle, ${e.embedBusyPerSecond} while it writes; Ollama peak ${e.peakMb} MB, least available ${e.availableMinMb} MB`}.`);
  }
  return `${lines.join('\n')}\n`;
}

function args(argv) {
  const a = { models: ['nomic-embed-text', 'all-minilm'], texts: 2000, out: 'probe-embed-out', editor: null, installSeconds: null, check: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; const v = () => argv[++i];
    if (k === '--models') a.models = v().split(/[\s,]+/).filter(Boolean);
    else if (k === '--texts') a.texts = Math.max(100, Math.min(10000, Number(v()) || 2000));
    else if (k === '--out') a.out = v();
    else if (k === '--editor') a.editor = v() || null;
    else if (k === '--install-seconds') a.installSeconds = Number(v());
    else if (k === '--check') a.check = v();
    else throw new Error(`unknown argument ${k}`);
  }
  if (a.models.some((m) => !MODEL.test(m)) || (a.editor && !MODEL.test(a.editor))) throw new Error('a model name the probe cannot publish');
  return a;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.check) {
    const problems = check(JSON.parse(fs.readFileSync(a.check, 'utf8')));
    if (problems.length) { process.stderr.write(`the results are not aggregates only: ${problems.length} problem(s), first: ${problems[0]}\n`); process.exit(1); }
    process.stdout.write('aggregates only: clean\n');
    return;
  }
  const perStory = 20;
  const items = headlines({ people: Math.ceil(a.texts / (2 * perStory)), perStory }).slice(0, a.texts);
  const result = {
    schema: 1, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), runner: { cores: os.cpus().length, memoryMb: Math.round(os.totalmem() / 1048576) },
    install: { seconds: Number.isFinite(a.installSeconds) ? a.installSeconds : null }, texts: items.length, perCycle: PER_CYCLE, budgetSeconds: BUDGET_SECONDS,
    assumedRestoreMBps: RESTORE_MBPS, models: [], editor: null,
  };
  for (const model of a.models) {
    process.stdout.write(`probing ${model}\n`);
    const row = await probeModel(model, items);
    result.models.push(row);
    process.stdout.write(`  ${row.error || `${row.best.perSecond} texts/s, typical cycle ${row.cycle.typical} s: ${row.verdict}`}\n`);
    if (!a.editor) stop(model);
  }
  const firstOk = result.models.find((m) => !m.error);
  if (a.editor && firstOk) result.editor = await probeEditor(a.editor, firstOk.model, items);
  fs.mkdirSync(a.out, { recursive: true });
  const problems = check(result);
  if (problems.length) throw new Error(`the probe wrote something that is not an aggregate (${problems[0]})`);
  fs.writeFileSync(path.join(a.out, 'results.json'), `${JSON.stringify(result, null, 1)}\n`);
  fs.writeFileSync(path.join(a.out, 'results.md'), markdown(result));
  process.stdout.write('wrote results.json and results.md\n');
}

if (require.main === module) main().catch((e) => { process.stderr.write(`probe failed: ${e && e.message ? e.message : e}\n`); process.exit(1); });

module.exports = { separation, auc, bestCut, quantiles, cycleSeconds, check, markdown, parseStatusKb, unit, args, PER_CYCLE, BUDGET_SECONDS };
