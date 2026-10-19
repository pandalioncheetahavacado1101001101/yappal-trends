#!/usr/bin/env node
'use strict';
/*
 * The clustering bench (ios/IDEAS-SUPER.md P8). A frozen day's pool (eval/days/<day>/pool.jsonl: headlines, threads, videos, clips
 * and posts, one entry per distinct text), labelled by the day's gold stories (lib/cluster/gold.js), grouped five ways and scored by
 * B-cubed F1 over the labelled texts:
 *
 *   rows             what the day's published rows held: each text with the first row (dossier) that claims it, else alone
 *   rules            engine/cluster.js alone over every text, on the names the engine's own lexicon finds in them
 *   vectors          lib/cluster/cluster.js alone (every text starts alone)
 *   rules+vectors    the rules' stories as seeds: links between them, the veto splitting what they chained
 *   rows+vectors     the rows as seeds (what P8 ships on: two rows of one story join, a row holding two stories splits)
 *
 * Gold's same-person pairs (two stories whose match names share a name) must stay apart: "apart" below.
 *
 *   node lib/cluster/bench.js --day 2026-10-12                       the stub embedder (lexical, deterministic), tuned numbers
 *   node lib/cluster/bench.js --day 2026-10-12 --tune [--arm rows|rules]   coordinate search of the thresholds on this day for
 *                                                                    that arm (tune on 2026-10-12 ONLY; report on 2026-10-12b)
 *   node lib/cluster/bench.js --day 2026-10-12 --embedder ollama --model nomic-embed-text [--base http://127.0.0.1:11434]
 *   node lib/cluster/bench.js --day 2026-10-12 --oracle 0.3,0.5      what-if: each labelled text's vector leans toward its gold
 *                                                                    story by that share; how far apart a model must hold stories
 *   ... --json                                                       one JSON object on stdout
 *
 * Reads the day's files (private, on the Mac only: never published). Writes only a cache of the rules' stories under $TMPDIR
 * (two and a half minutes to compute). Prints counts, rates and cosines, never a text.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const G = require('./gold');
const V = require('./vec');
const CL = require('./cluster');
const E = require('./embed');
const { stubEmbedder, tokens } = require('./stub');
const TUNED = require('./tuned');

const ROOT = path.join(__dirname, '..', '..');
const KINDS = new Set(['headline', 'thread', 'video', 'clip', 'social']);
const PAIRS_MAX = 20000;
const RULES_CACHE = 1; // raise when loadDay changes which texts it keeps or their order (the cached rules' stories are by index)
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

function args(argv) {
  const a = { day: null, embedder: 'stub', model: null, base: undefined, tune: false, oracle: [], json: false, dims: 256, arm: 'rows' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--day') a.day = v();
    else if (k === '--embedder') a.embedder = v();
    else if (k === '--model') a.model = v();
    else if (k === '--base') a.base = v();
    else if (k === '--dims') a.dims = Number(v());
    else if (k === '--tune') a.tune = true;
    else if (k === '--oracle') a.oracle = v().split(',').map(Number).filter((x) => x > 0 && x < 1);
    else if (k === '--json') a.json = true;
    else if (k === '--arm') a.arm = v() === 'rules' ? 'rules' : 'rows';
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.day || !/^\d{4}-\d\d-\d\d[a-z]?$/.test(a.day)) throw new Error('usage: node lib/cluster/bench.js --day <day> [--embedder stub|ollama --model m] [--tune] [--oracle a,b] [--json]');
  return a;
}

/** The day's distinct texts as items: { text, t, kind, fam, label }. */
function loadDay(day) {
  const dir = path.join(ROOT, 'eval', 'days', day);
  const gold = JSON.parse(fs.readFileSync(path.join(dir, 'gold.json'), 'utf8'));
  const stories = G.matchers(gold);
  const items = [];
  const seen = new Map();
  const poolFile = path.join(dir, 'pool.jsonl');
  for (const line of fs.readFileSync(poolFile, 'utf8').split('\n')) {
    if (!line) continue;
    let s; try { s = JSON.parse(line); } catch { continue; }
    if (!KINDS.has(s.kind) || !s.text) continue;
    const key = G.norm(s.text);
    if (!key) continue;
    if (seen.has(key)) { const it = items[seen.get(key)]; for (const d of s.dossiers || []) if (!it.rows.includes(d)) it.rows.push(d); continue; }
    seen.set(key, items.length);
    const fam = s.kind === 'thread' ? 'reddit' : s.kind === 'social' ? (/bluesky/i.test(s.outlet || '') ? 'bluesky' : 'x') : s.kind === 'video' ? 'yt' : s.kind === 'clip' ? 'clips' : 'gnews';
    items.push({ text: s.text, t: Date.parse(s.at || s.seen), kind: s.kind, fam, label: G.labelOf(s.text, stories), rows: [...(s.dossiers || [])] });
  }
  const stat = fs.statSync(poolFile);
  return { items, stories, pairs: G.samePersonPairs(stories), poolId: `${day}:${stat.size}:${Math.floor(stat.mtimeMs)}` };
}

/** The rules' stories on these items, and the names the engine found in each (cached under $TMPDIR by pool and code). */
function rulesOf(day, loaded) {
  const W = require('../../engine/wording');
  const C = require('../../engine/cluster');
  const code = ['engine/cluster.js', 'engine/wording.js', 'engine/rules.js'].map((f) => fs.readFileSync(path.join(ROOT, f))).join('\n');
  const key = crypto.createHash('sha256').update(`${RULES_CACHE}:${loaded.poolId}:${loaded.items.length}`).update(code).digest('hex').slice(0, 16);
  const file = path.join(os.tmpdir(), `ideas-cluster-rules-${key}.json`);
  if (fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* computed again */ } }
  const engineItems = loaded.items.map((it, i) => ({ title: it.text, t: it.t, fam: it.fam, idx: i,
    ...(/\b(?:viral|goes viral|went viral)\b/i.test(it.text) ? { viral: true } : {}) }));
  const lex = W.buildLexicon(engineItems.map((i) => i.title), [], [], []);
  engineItems.forEach((it) => C.annotate(it, lex));
  const { clusters } = C.clusterItems(engineItems);
  const out = { groups: clusters.map((c) => c.items.map((i) => i.idx)), names: engineItems.map((it) => it.ents) };
  try { fs.writeFileSync(file, JSON.stringify(out)); } catch { /* a cache only */ }
  return out;
}

/** The embedder a run asks for. */
function embedderOf(a, items) {
  if (a.embedder === 'ollama') {
    if (!a.model) throw new Error('--embedder ollama needs --model');
    return E.cachedEmbedder(E.ollamaEmbedder({ model: a.model, base: a.base }), { dims: a.dims });
  }
  // the stand-in, its words weighed by how rare they are in the day (a lexical TF-IDF: what the rules see, as a vector)
  const df = new Map();
  for (const it of items) for (const w of new Set(tokens(it.text))) df.set(w, (df.get(w) || 0) + 1);
  const n = items.length;
  return stubEmbedder({ dims: a.dims, weightOf: (w) => Math.log((n + 1) / ((df.get(w) || 0) + 1)) });
}

/** Mixes each labelled text's vector toward a fixed random direction of its gold story (the what-if of --oracle). */
function oracleVectors(vectors, items, share) {
  const dirs = new Map();
  const dims = vectors.find(Boolean).length;
  const dirOf = (label) => {
    if (!dirs.has(label)) {
      const seed = crypto.createHash('sha256').update(label).digest();
      const v = Float32Array.from({ length: dims }, (_, i) => (seed[i % 32] / 255 - 0.5) + Math.sin(i * (seed[(i * 7) % 32] + 1)));
      dirs.set(label, V.unit(v));
    }
    return dirs.get(label);
  };
  return vectors.map((v, i) => {
    if (!v || !items[i].label) return v;
    const d = dirOf(items[i].label);
    return V.unit(Float32Array.from(v, (x, k) => (1 - share) * x + share * d[k]));
  });
}

/** Cosine statistics of labelled text pairs: same story; one person's two stories; two stories sharing an engine name; any two. */
function pairStats(items, vectors, names, samePairs) {
  const byLabel = new Map();
  items.forEach((it, i) => { if (it.label && vectors[i]) { if (!byLabel.has(it.label)) byLabel.set(it.label, []); byLabel.get(it.label).push(i); } });
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const labels = [...byLabel.keys()];
  const same = []; const person = []; const named = []; const any = [];
  for (let k = 0; k < PAIRS_MAX && labels.length; k++) {
    const l = pick(labels); const xs = byLabel.get(l);
    if (xs.length > 1) { const i = pick(xs); const j = pick(xs); if (i !== j) same.push(V.cosine(vectors[i], vectors[j])); }
    const m = pick(labels);
    if (m !== l) any.push(V.cosine(vectors[pick(xs)], vectors[pick(byLabel.get(m))]));
  }
  for (const [a, b] of samePairs) {
    const xa = byLabel.get(a) || []; const xb = byLabel.get(b) || [];
    for (const i of xa) for (const j of xb) person.push(V.cosine(vectors[i], vectors[j]));
  }
  const byName = new Map();
  items.forEach((it, i) => { if (it.label && vectors[i]) for (const n of names[i] || []) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(i); } });
  const busy = [...byName.values()].filter((xs) => new Set(xs.map((i) => items[i].label)).size > 1);
  for (let k = 0; k < PAIRS_MAX && busy.length; k++) {
    const xs = pick(busy); const i = pick(xs); const j = pick(xs);
    if (items[i].label !== items[j].label) named.push(V.cosine(vectors[i], vectors[j]));
  }
  const q = (xs) => { const s = [...xs].sort((x, y) => x - y); const at = (p) => (s.length ? round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) : null); return { n: s.length, p10: at(0.1), p50: at(0.5), p90: at(0.9) }; };
  // how often a same-story pair outranks a different-story pair that shares a name (AUC): the separation a model must give
  const auc = (pos, neg) => {
    if (!pos.length || !neg.length) return null;
    const all = [...pos.map((x) => [x, 1]), ...neg.map((x) => [x, 0])].sort((x, y) => x[0] - y[0]);
    let rank = 0; let sumPos = 0;
    all.forEach(([, y], i) => { rank = i + 1; if (y) sumPos += rank; });
    return round((sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length));
  };
  return { same: q(same), person: q(person), sharedName: q(named), any: q(any), aucNamed: auc(same, [...named, ...person]), aucAny: auc(same, any) };
}

/** The centroid cosine of each gold same-person pair: what the veto sees. */
function pairCentroids(items, vectors, samePairs) {
  const centroidOf = (label) => V.centroid(items.map((it, i) => (it.label === label ? vectors[i] : null)));
  return samePairs.map(([a, b]) => ({ pair: `${a} / ${b}`, cos: round(V.cosine(centroidOf(a), centroidOf(b))) }));
}

/** The day's rows as stories: each text with the first dossier that claims it; a text no dossier claims, alone. */
function rowGroups(items) {
  const by = new Map(); const alone = [];
  items.forEach((it, i) => { const d = it.rows[0]; if (!d) { alone.push([i]); return; } if (!by.has(d)) by.set(d, []); by.get(d).push(i); });
  return [...by.values(), ...alone];
}

/** One arm's score. groups: [[item index]]. */
function score(groups, items, samePairs) {
  const labels = new Map(items.map((it, i) => [i, it.label]));
  const b = G.bcubed(groups, labels);
  const pairs = samePairs.map(([x, y]) => ({ pair: `${x} / ${y}`, ...G.apart(groups, labels, x, y) }));
  return { f1: round(b.f1), precision: round(b.precision), recall: round(b.recall), stories: groups.length, apart: pairs.every((p) => p.apart), pairs };
}

/**
 * Coordinate search: each threshold over a coarse grid in turn, then finer steps around the best, keeping what raises F1 with every
 * same-person pair apart. A value of 1.01 turns a link kind off.
 */
function tune(run, start) {
  const coarse = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01];
  const keys = { seeded: coarse, named: coarse, nameOnly: coarse, rare: coarse, free: coarse, cross: coarse, slack: [0, 0.03, 0.06, 0.1, 0.15, 0.25] };
  let best = { th: { ...start }, s: run(start) };
  const trail = [];
  const tryValue = (k, v) => {
    if (v === best.th[k] || v < 0) return;
    const th = { ...best.th, [k]: Math.round(v * 1000) / 1000 };
    const s = run(th);
    if (s.apart && s.f1 > best.s.f1 + 1e-9) { best = { th, s }; trail.push({ [k]: th[k], f1: s.f1 }); }
  };
  for (const [k, values] of Object.entries(keys)) for (const v of values) tryValue(k, v);
  for (const step of [0.05, 0.025]) {
    for (const k of Object.keys(keys)) { const b = best.th[k]; if (b > 1) continue; tryValue(k, b - step); tryValue(k, b + step); }
  }
  return { ...best, trail };
}

async function main() {
  const a = args(process.argv.slice(2));
  const started = Date.now();
  const loaded = loadDay(a.day);
  const { items, pairs } = loaded;
  const rules = rulesOf(a.day, loaded);
  const clusterItems = items.map((it, i) => ({ text: it.text, t: it.t, kind: it.kind, names: rules.names[i] || [] }));
  const embedder = embedderOf(a, items);
  const t0 = Date.now();
  let vectors = await embedder.embed(items.map((it) => it.text));
  const embedSeconds = round((Date.now() - t0) / 1000, 1);
  const famOf = CL.defaultFamilies(CL.THRESHOLDS.famWeightMin);
  const famCache = new Map();
  const familiesOf = (text) => { if (!famCache.has(text)) famCache.set(text, famOf(text)); return famCache.get(text); };
  const base = TUNED.thresholdsFor(embedder.model);
  const preparedFor = new Map();
  const runArm = (th, seeds, vs = vectors) => {
    const key = `${seeds === null ? 'none' : seeds === rules.groups ? 'rules' : 'rows'}:${vs === vectors ? 'model' : 'oracle'}`;
    if (!preparedFor.has(key) || preparedFor.get(key).vs !== vs) preparedFor.set(key, { vs, prepared: CL.prepare(clusterItems, vs, { ...th, seeds, familiesOf }) });
    return score(CL.storyGroups(clusterItems, vs, { ...th, seeds, familiesOf, prepared: preparedFor.get(key).prepared }).groups, items, pairs);
  };
  const out = {
    day: a.day, model: embedder.model, texts: items.length, labelled: items.filter((it) => it.label).length, goldStories: new Set(items.map((it) => it.label).filter(Boolean)).size,
    samePersonPairs: pairs.length, embedSeconds,
    rules: score(rules.groups, items, pairs),
    // what the published rows held: each text with the first row (dossier) that claims it, a text no row claims alone
    rows: score(rowGroups(items), items, pairs),
  };
  const rows = rowGroups(items);
  const seedsOf = (arm) => (arm === 'rows' ? rows : rules.groups);
  let th = base;
  if (a.tune) {
    const t = tune((x) => runArm(x, seedsOf(a.arm)), base);
    out.tuned = { arm: a.arm, thresholds: t.th, trail: t.trail };
    th = t.th;
  }
  const t1 = Date.now();
  out.vectors = runArm(th, null);
  out.rulesPlusVectors = runArm(th, rules.groups);
  out.rowsPlusVectors = runArm(th, rows);
  out.thresholds = th;
  out.clusterSeconds = round((Date.now() - t1) / 3000, 1);
  out.gain = round(out.rulesPlusVectors.f1 - out.rules.f1);
  out.gainRows = round(out.rowsPlusVectors.f1 - out.rows.f1);
  out.pairStats = pairStats(items, vectors, rules.names, pairs);
  out.pairCentroids = pairCentroids(items, vectors, pairs);
  if (a.oracle.length) {
    out.oracle = a.oracle.map((share) => {
      const vs = oracleVectors(vectors, items, share);
      const s = runArm(th, seedsOf(a.arm), vs);
      const ps = pairStats(items, vs, rules.names, pairs);
      return { share, f1: s.f1, gain: round(s.f1 - out[a.arm].f1), apart: s.apart, aucNamed: ps.aucNamed, aucAny: ps.aucAny, same: ps.same, sharedName: ps.sharedName };
    });
  }
  out.seconds = round((Date.now() - started) / 1000, 1);
  if (a.json) { process.stdout.write(`${JSON.stringify(out)}\n`); return; }
  const arm = (name, s) => `  ${name.padEnd(15)} F1 ${s.f1.toFixed(3)}  P ${s.precision.toFixed(3)}  R ${s.recall.toFixed(3)}  stories ${s.stories}  same-person pairs ${s.apart ? 'apart' : 'MERGED'} (${s.pairs.map((p) => p.worst).join(', ')})`;
  const lines = [
    `${a.day}: ${out.texts} distinct texts, ${out.labelled} labelled into ${out.goldStories} gold stories, ${pairs.length} same-person pairs; model ${out.model} (${embedSeconds} s)`,
    arm('rows', out.rows), arm('rules', out.rules), arm('vectors', out.vectors), arm('rules+vectors', out.rulesPlusVectors), arm('rows+vectors', out.rowsPlusVectors),
    `  gain over the rules: ${out.gain >= 0 ? '+' : ''}${out.gain.toFixed(3)}; over the rows: ${out.gainRows >= 0 ? '+' : ''}${out.gainRows.toFixed(3)} (P8's gate: +0.100)`,
    `  thresholds ${JSON.stringify(out.thresholds)}${out.tuned ? ` (tuned on ${out.tuned.arm}+vectors)` : ''}`,
    `  pair cosines: same story ${JSON.stringify(out.pairStats.same)}; one person's two stories ${JSON.stringify(out.pairStats.person)}; two stories sharing a name ${JSON.stringify(out.pairStats.sharedName)}; any two ${JSON.stringify(out.pairStats.any)}`,
    `  separation (AUC, same story over different stories sharing a name): ${out.pairStats.aucNamed}; over any two: ${out.pairStats.aucAny}`,
    `  same-person centroids: ${out.pairCentroids.map((p) => `${p.cos}`).join(', ')}`,
    ...(out.oracle || []).map((o) => `  what-if lean ${o.share}: F1 ${o.f1} (gain ${o.gain}), AUC named ${o.aucNamed}, any ${o.aucAny}, same-person ${o.apart ? 'apart' : 'MERGED'}`),
    ...(out.tuned ? [`  tuning trail: ${out.tuned.trail.map((x) => JSON.stringify(x)).join(' ')}`] : []),
    `  ${out.seconds} s`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

if (require.main === module) main().catch((e) => { process.stderr.write(`${e && e.stack ? e.stack : e}\n`); process.exit(1); });

module.exports = { loadDay, score, pairStats, tune };
