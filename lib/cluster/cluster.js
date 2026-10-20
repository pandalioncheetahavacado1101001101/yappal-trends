'use strict';
/*
 * Stories by meaning (ios/IDEAS-SUPER.md P8; ios/.review/super-intelligence.md 1). The rules (engine/cluster.js) stay as a signal:
 * this builds stories from vectors an embedder hands in (lib/cluster/embed.js), with the rules' stories as seeds, links between texts
 * the rules kept apart, and a veto that splits what the rules chained. Nothing here knows a model, a name or a story: every
 * threshold is a number, tuned on one frozen day and reported on another (lib/cluster/bench.js, lib/cluster/tuned.js).
 *
 *   storyGroups(items, vectors, opts) -> { groups: [[item index]], links: [{ why, cos }], vetoed, stats }
 *
 *   items    [{ text, t (ms), names: [name keys the text names], kind }]: headlines, posts and clips alike
 *   vectors  one unit vector an item, in order (null: the item links to nothing; it stays with its seed's biggest story)
 *   seeds    the rules' stories as [[item index]] (an item in at most one); optional
 *
 * Every distinct text starts alone (a wire story printed a hundred times is one text). Two stories join, closest first and with
 * their centroids recomputed after each join (so a chain of near misses never makes one story), when their centroids are close
 * enough for what they share:
 *   the rules put every text of both in one seed     cosine >= seeded
 *   a name and a distinctive word                    cosine >= named
 *   a name alone                                     cosine >= nameOnly
 *   a distinctive word alone                         cosine >= rare
 *   nothing                                          cosine >= free   (only texts with minWordsFree story words or more)
 * THE VETO keeps one person's two stories apart, the rules' or not: two stories whose story nouns differ (engine/talk-nouns.js
 * families, "allegations" against "record") join only at cosine >= cross AND when the smaller one's texts sit as close to the
 * larger one's centroid as the larger one's own texts do, less `slack` (the centroid test). Stories whose mean times are more than
 * `days` apart never join.
 *
 * WHOLE SEEDS (`whole`, the shape P8 ships with: lib/cluster/tuned.js): a seed is one story unless the veto splits it. The texts of
 * each seed are first joined among themselves (every pair of a seed up to `seedAllMax` texts compared, at `seeded`); a piece of
 * `splitMin` texts or more whose centroid is under `split` from the rest of its seed is a story of its own, and every other piece
 * goes back to the rest. A seed's pieces never join again; then stories join across seeds by the rules above, two stories of
 * `splitMin` texts or more only at `big` or more. With no vectors the seeds come out as they went in.
 *
 * Cost: what does not depend on the thresholds (distinct texts, candidate pairs, their cosines in order) is prepare()'s, once; a
 * join adds two vector sums. On a frozen day (15,000 texts, 5 million candidate pairs) prepare takes about 9 s on a laptop and a
 * run about 1 s; the enrich pass's stories (lib/cluster/stories.js: a cycle's rows and 72 hours of the store, about 5,500 texts)
 * about 2 s, and only texts new since the pass before need vectors (lib/cluster/embed.js caches the rest).
 */
const V = require('./vec');
const { tokens } = require('./stub');

const DAY_MS = 86400000;
/** The proposal's numbers for a real model (ios/.review/super-intelligence.md 1); tuned rows are in lib/cluster/tuned.js. */
const THRESHOLDS = Object.freeze({
  seeded: 0.70, named: 0.80, nameOnly: 0.85, rare: 0.84, free: 0.88, cross: 0.90, slack: 0.05, days: 5,
  idfMin: 3.2, minWordsFree: 3, famShare: 0.34, famWeightMin: 0.6, postingMax: 400, lsh: true,
  // a seed this small is compared pair by pair
  seedAllMax: 40,
  // whole: a seed stands as one story unless the veto splits it (a piece of splitMin texts or more, its centroid under split)
  whole: false, splitMin: 3, split: 0.6, big: -1,
});
const SEED_POSTING_MAX = 1500; // inside one seed a shared name links candidates up to this many texts
const LSH_BANDS = 16;
const LSH_BITS = 10;
const LSH_BUCKET_MAX = 48;
const LSH_SEED = 0x5eed;
const PAIR_BASE = 1 << 22; // pair codes: a * PAIR_BASE + b (up to four million texts)

/** A story's noun families by default: engine/talk-nouns.js, the families that name a story (not "responds", not "box office"). */
function defaultFamilies(weightMin = THRESHOLDS.famWeightMin) {
  const TN = require('../../engine/talk-nouns');
  return (text) => TN.familiesIn(text).filter((x) => x.f.w >= weightMin).map((x) => x.f.key);
}

/** Seeded uniform numbers in [0, 1): mulberry32. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A max-heap of (score, a, b). */
function heap() {
  const s = []; const a = []; const b = [];
  const swap = (i, j) => { [s[i], s[j]] = [s[j], s[i]]; [a[i], a[j]] = [a[j], a[i]]; [b[i], b[j]] = [b[j], b[i]]; };
  return {
    size: () => s.length,
    peek: () => s[0],
    push(score, x, y) {
      s.push(score); a.push(x); b.push(y);
      let i = s.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (s[p] >= s[i]) break; swap(p, i); i = p; }
    },
    pop() {
      const top = [s[0], a[0], b[0]];
      swap(0, s.length - 1); s.pop(); a.pop(); b.pop();
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1; let m = i;
        if (l < s.length && s[l] > s[m]) m = l;
        if (r < s.length && s[r] > s[m]) m = r;
        if (m === i) break;
        swap(i, m); i = m;
      }
      return top;
    },
  };
}

const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[(s.length - 1) >> 1] : 0; };
const addCounts = (m, keys) => { for (const k of keys) m.set(k, (m.get(k) || 0) + 1); return m; };
const shares = (x, y) => { const [small, big] = x.size <= y.size ? [x, y] : [y, x]; for (const k of small.keys()) if (big.has(k)) return true; return false; };

/**
 * The distinct texts: one entry per text however many outlets printed it, with its vector, middle time, names, story words, rare
 * words (by how few distinct texts carry them) and noun families. Returns { texts, of: item index -> text index }.
 */
function distinctTexts(items, vectors, familiesOf, th) {
  const byKey = new Map();
  const texts = [];
  const of = new Array(items.length).fill(-1);
  items.forEach((it, i) => {
    const key = String((it && it.text) || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) return;
    let k = byKey.get(key);
    if (k === undefined) {
      k = texts.length;
      byKey.set(key, k);
      texts.push({ text: it.text, items: [], vector: null, ts: [], names: new Set() });
    }
    const tx = texts[k];
    tx.items.push(i);
    if (!tx.vector && vectors[i]) tx.vector = vectors[i];
    if (Number.isFinite(it.t)) tx.ts.push(it.t);
    for (const n of it.names || []) tx.names.add(n);
    of[i] = k;
  });
  const df = new Map();
  for (const tx of texts) {
    // (a word of a name is the name's, not a story word)
    const nameWords = new Set([...tx.names].flatMap((n) => tokens(n)));
    tx.words = [...new Set(tokens(tx.text))].filter((w) => !nameWords.has(w) && w.length > 2);
    for (const w of tx.words) df.set(w, (df.get(w) || 0) + 1);
  }
  const n = Math.max(1, texts.length);
  for (const tx of texts) {
    tx.t = tx.ts.length ? median(tx.ts) : null;
    tx.rare = tx.words.filter((w) => Math.log(n / df.get(w)) >= th.idfMin);
    tx.fams = [...new Set(familiesOf(tx.text))];
  }
  return { texts, of };
}

/**
 * A story of one distinct text. A story keeps the sum of its texts' unit vectors: its centroid is that sum made a unit vector,
 * and its cohesion (the mean cosine of its texts to the centroid) is the sum's length over its texts, so a join costs one vector
 * addition, never a pass over every text.
 */
function single(k, texts, seedOf) {
  const tx = texts[k];
  return {
    members: [k], sum: tx.vector ? Float32Array.from(tx.vector) : null, centroid: tx.vector || null, cohesion: tx.vector ? 1 : 0, live: tx.vector ? 1 : 0,
    tSum: tx.t === null ? 0 : tx.t, tN: tx.t === null ? 0 : 1, t: tx.t,
    seed: seedOf[k], names: addCounts(new Map(), tx.names), rare: addCounts(new Map(), tx.rare), fams: addCounts(new Map(), tx.fams),
    famTexts: tx.fams.length ? 1 : 0, wordSum: tx.words.length, words: tx.words.length,
  };
}
const length = (v) => Math.sqrt(V.dot(v, v));
/**
 * Two stories as one. The larger one's lists and counts are reused (it is gone after the join), so joining a text to a story of
 * thousands costs what the text brings, not what the story holds.
 */
function join(a, b) {
  const [big, small] = a.members.length >= b.members.length ? [a, b] : [b, a];
  for (const k of small.members) big.members.push(k);
  for (const [m, from] of [[big.names, small.names], [big.rare, small.rare], [big.fams, small.fams]]) for (const [k, n] of from) m.set(k, (m.get(k) || 0) + n);
  let sum = big.sum;
  if (small.sum) { sum = sum ? sum : new Float32Array(small.sum.length); for (let i = 0; i < sum.length; i++) sum[i] += small.sum[i]; }
  const live = big.live + small.live;
  const centroid = sum ? V.unit(sum) : null;
  const tSum = big.tSum + small.tSum; const tN = big.tN + small.tN;
  const wordSum = big.wordSum + small.wordSum;
  return {
    members: big.members, sum, centroid, cohesion: centroid && live ? length(sum) / live : 0, live, tSum, tN, t: tN ? tSum / tN : null,
    seed: big.seed >= 0 && big.seed === small.seed ? big.seed : -1, names: big.names, rare: big.rare, fams: big.fams,
    famTexts: big.famTexts + small.famTexts, wordSum, words: wordSum / big.members.length,
  };
}

/** The families most of a story's texts with a family carry. */
function dominant(g, th) {
  if (!g.famTexts) return new Set();
  return new Set([...g.fams].filter(([, n]) => n >= Math.max(1, th.famShare * g.famTexts)).map(([f]) => f));
}

/** Mean cosine of a story's texts to a centroid: its vector sum against the centroid, over its texts. */
const fit = (g, c) => (g.live && g.sum && c ? V.dot(g.sum, c) / g.live : 0);

/**
 * Whether two stories are one: { ok, why, cos }. why: the rule that joined them ("seeded", "named", "nameOnly", "rare", "free",
 * "cross") or the refusal ("apart", "far", "veto", "short").
 */
function judge(a, b, th) {
  const cos = V.cosine(a.centroid, b.centroid);
  if (!a.centroid || !b.centroid) return { ok: false, why: 'apart', cos };
  if (a.t !== null && b.t !== null && Math.abs(a.t - b.t) > th.days * DAY_MS) return { ok: false, why: 'far', cos };
  const name = shares(a.names, b.names);
  const rare = shares(a.rare, b.rare);
  const da = dominant(a, th);
  const db = dominant(b, th);
  const cross = da.size > 0 && db.size > 0 && ![...da].some((f) => db.has(f));
  const why = a.seed >= 0 && a.seed === b.seed ? 'seeded' : name && rare ? 'named' : name ? 'nameOnly' : rare ? 'rare' : 'free';
  if (why === 'free' && Math.min(a.words, b.words) < th.minWordsFree) return { ok: false, why: 'short', cos };
  if (cross) {
    if (cos < Math.max(th.cross, th[why])) return { ok: false, why: 'veto', cos };
    const [small, big] = a.live <= b.live ? [a, b] : [b, a];
    return fit(small, big.centroid) >= big.cohesion - th.slack ? { ok: true, why: 'cross', cos } : { ok: false, why: 'veto', cos };
  }
  // (two stories of `splitMin` texts or more each: their centroids are averages, closer than any two of their texts, so they join
  // only at `big` or more)
  const need = Math.max(th[why], why !== 'seeded' && Math.min(a.live, b.live) >= th.splitMin ? th.big : -1);
  return cos >= need ? { ok: true, why, cos } : { ok: false, why: 'apart', cos };
}

/**
 * Candidate pairs of texts: every pair inside a small seed; pairs sharing a name or a rare word (inside one seed up to
 * SEED_POSTING_MAX texts a key, across seeds up to postingMax: Trump's name is everyone's); near neighbours by random planes.
 */
function candidates(texts, seedOf, seeds, th) {
  const pairs = new Set();
  const add = (x, y) => { if (x !== y) pairs.add(x < y ? x * PAIR_BASE + y : y * PAIR_BASE + x); };
  for (const members of seeds) if (members.length <= th.seedAllMax) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) add(members[i], members[j]);
  const post = new Map();
  texts.forEach((tx, k) => {
    for (const key of [...[...tx.names].map((n) => `n:${n}`), ...tx.rare.map((w) => `w:${w}`)]) {
      if (!post.has(key)) post.set(key, []);
      post.get(key).push(k);
    }
  });
  for (const ks of post.values()) {
    if (ks.length < 2) continue;
    if (ks.length <= th.postingMax) { for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) add(ks[i], ks[j]); continue; }
    const bySeed = new Map();
    for (const k of ks) if (seedOf[k] >= 0) { if (!bySeed.has(seedOf[k])) bySeed.set(seedOf[k], []); bySeed.get(seedOf[k]).push(k); }
    for (const same of bySeed.values()) if (same.length <= SEED_POSTING_MAX) for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length; j++) add(same[i], same[j]);
  }
  if (th.lsh) for (const [x, y] of lshPairs(texts)) add(x, y);
  return [...pairs].map((p) => [Math.floor(p / PAIR_BASE), p % PAIR_BASE]);
}

/**
 * Near neighbours without comparing every pair: the vectors, centred on their mean (embedding models put every text in one narrow
 * cone, where a plane through the origin separates nothing), signed against seeded random planes; two texts that agree on every
 * plane of one band are candidates. A bucket over LSH_BUCKET_MAX is a topic, not a story, and gives no pairs.
 */
function lshPairs(texts) {
  const live = texts.map((tx, k) => [k, tx.vector]).filter(([, v]) => v);
  if (live.length < 2) return [];
  const dims = live[0][1].length;
  const mean = new Float32Array(dims);
  for (const [, v] of live) for (let i = 0; i < dims; i++) mean[i] += v[i] / live.length;
  const rand = rng(LSH_SEED);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const planes = Array.from({ length: LSH_BANDS * LSH_BITS }, () => Float32Array.from({ length: dims }, gauss));
  const out = [];
  for (let band = 0; band < LSH_BANDS; band++) {
    const buckets = new Map();
    for (const [k, v] of live) {
      let code = 0;
      for (let bit = 0; bit < LSH_BITS; bit++) {
        const p = planes[band * LSH_BITS + bit];
        let s = 0;
        for (let i = 0; i < dims; i++) s += (v[i] - mean[i]) * p[i];
        code = (code << 1) | (s > 0 ? 1 : 0);
      }
      if (!buckets.has(code)) buckets.set(code, []);
      buckets.get(code).push(k);
    }
    for (const ks of buckets.values()) {
      if (ks.length < 2 || ks.length > LSH_BUCKET_MAX) continue;
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) out.push([ks[i], ks[j]]);
    }
  }
  return out;
}

/** The seeds over distinct texts: seedOf (text -> seed, -1 for none) and each seed's texts. A text in two seeds keeps the first. */
function seedIndex(seeds, of, nTexts) {
  const seedOf = new Array(nTexts).fill(-1);
  const members = [];
  for (const seed of seeds || []) {
    const ks = [];
    for (const i of seed) { const k = of[i]; if (k >= 0 && seedOf[k] === -1) { seedOf[k] = members.length; ks.push(k); } }
    if (ks.length) members.push(ks);
  }
  return { seedOf, seeds: members };
}

/**
 * What does not change with the thresholds, done once: the distinct texts, the seeds over them, the candidate pairs with their
 * cosines, closest first. A bench tuning the thresholds hands the same `prepared` to every run. Returns { texts, of, seedOf,
 * seedTexts, a, b, cos } (a, b, cos: the pairs, in cosine order, down to cosine 0).
 */
function prepare(items, vectors, { seeds = null, familiesOf = null, ...over } = {}) {
  const th = { ...THRESHOLDS, ...over };
  const { texts, of } = distinctTexts(items, vectors || [], familiesOf || defaultFamilies(th.famWeightMin), th);
  const { seedOf, seeds: seedTexts } = seedIndex(seeds, of, texts.length);
  const pairs = candidates(texts, seedOf, seedTexts, th);
  const cs = new Float32Array(pairs.length);
  let kept = 0;
  const idx = new Uint32Array(pairs.length);
  pairs.forEach(([x, y], i) => { const c = V.cosine(texts[x].vector, texts[y].vector); if (c > 0) { cs[i] = c; idx[kept++] = i; } });
  const order = Array.from(idx.subarray(0, kept)).sort((i, j) => cs[j] - cs[i] || i - j);
  return {
    texts, of, seedOf, seedTexts, candidates: pairs.length,
    a: Uint32Array.from(order, (i) => pairs[i][0]), b: Uint32Array.from(order, (i) => pairs[i][1]), cos: Float32Array.from(order, (i) => cs[i]),
  };
}

/**
 * Joins stories, closest pair first, while a pair's cosine is at least `floor` and `accept(textA, textB)` lets the pair be judged
 * (a pass inside the seeds, a pass across them). Returns { links, vetoed }.
 */
function agglomerate(P, S, th, floor, accept) {
  const { groups, find } = S;
  // the pairs in cosine order, and a heap for pairs whose stories moved since they were scored: the closest of the two goes next
  const q = heap();
  let p = 0;
  const links = [];
  let vetoed = 0;
  for (;;) {
    const sorted = p < P.cos.length && P.cos[p] >= floor;
    if (!sorted && !q.size()) break;
    let score; let x0; let y0;
    if (sorted && (!q.size() || P.cos[p] >= q.peek())) { score = P.cos[p]; x0 = P.a[p]; y0 = P.b[p]; p += 1; if (!accept(x0, y0)) continue; } else [score, x0, y0] = q.pop();
    const x = find(x0); const y = find(y0);
    if (x === y) continue;
    const now = V.cosine(groups[x].centroid, groups[y].centroid);
    if (now < floor) continue;
    if (now < score - 1e-6) { q.push(now, x, y); continue; } // a centroid moved since the pair was scored
    const verdict = apartBySplit(groups[x], groups[y]) ? { ok: false, why: 'split' } : judge(groups[x], groups[y], th);
    if (!verdict.ok) { if (verdict.why === 'veto') vetoed += 1; continue; }
    links.push({ why: verdict.why, cos: Math.round(verdict.cos * 1000) / 1000 });
    S.merge(x, y);
  }
  return { links, vetoed };
}

/** Whether two stories hold different pieces of one split seed (the seed's pieces never join again). */
function apartBySplit(a, b) {
  if (!a.pieces || !b.pieces) return false;
  for (const [sd, piece] of a.pieces) if (b.pieces.has(sd) && b.pieces.get(sd) !== piece) return true;
  return false;
}

/**
 * A seed as the rules or the rows made it, with the veto (`whole`): after the pass inside the seeds, a seed is one story again
 * but for its pieces that are stories of their own: `splitMin` texts with a vector or more whose centroid is under `split` from
 * the rest of the seed (every other text of it, the vectorless ones aside). Pieces split off that are within `split` of each other
 * are one story. Returns how many seeds split.
 */
function settleSeeds(P, S, th) {
  const { groups, alive } = S;
  const bySeed = new Map();
  groups.forEach((g, i) => { if (alive[i] && g && g.seed >= 0) { if (!bySeed.has(g.seed)) bySeed.set(g.seed, []); bySeed.get(g.seed).push(i); } });
  let split = 0;
  for (const [sd, pieces] of bySeed) {
    if (pieces.length < 2) continue;
    pieces.sort((x, y) => groups[y].live - groups[x].live || groups[y].members.length - groups[x].members.length || x - y);
    const total = new Float32Array((groups[pieces.find((i) => groups[i].sum)] || { sum: [] }).sum.length);
    for (const i of pieces) if (groups[i].sum) for (let d = 0; d < total.length; d++) total[d] += groups[i].sum[d];
    const off = [];
    for (const i of pieces) {
      const g = groups[i];
      if (g.live < th.splitMin || !g.centroid) continue;
      const rest = V.unit(Float32Array.from(total, (x, d) => x - g.sum[d]));
      if (rest && V.cosine(g.centroid, rest) < th.split) off.push(i);
    }
    if (!off.length) { for (const i of pieces.slice(1)) S.merge(pieces[0], i); continue; }
    // the stories split off, each joined to an earlier one it is close to; the rest of the seed one story
    const heads = [];
    for (const i of off) {
      const near = heads.find((h) => V.cosine(groups[S.find(h)].centroid, groups[i].centroid) >= th.split);
      if (near === undefined) heads.push(i); else S.merge(S.find(near), i);
    }
    const restOf = pieces.filter((i) => !off.includes(i));
    for (const i of restOf.slice(1)) S.merge(restOf[0], i);
    const kept = [...(restOf.length ? [restOf[0]] : []), ...heads].map((i) => S.find(i));
    if (kept.length < 2) continue;
    split += 1;
    kept.forEach((k, j) => { const g = groups[k]; g.pieces = new Map([...(g.pieces || []), [sd, j]]); });
  }
  return split;
}

/** The stories' working state: one story a distinct text, a union-find over them, and a merge that keeps both in step. */
function stateOf(texts, seedOf) {
  const groups = texts.map((_, k) => single(k, texts, seedOf));
  const alive = groups.map(() => true);
  const parent = groups.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const merge = (x, y) => {
    const pieces = groups[x].pieces || groups[y].pieces ? new Map([...(groups[x].pieces || []), ...(groups[y].pieces || [])]) : null;
    groups[x] = join(groups[x], groups[y]);
    if (pieces) groups[x].pieces = pieces;
    groups[y] = null;
    alive[y] = false;
    parent[y] = x;
  };
  return { groups, alive, parent, find, merge };
}

/** See the header. opts.prepared: what prepare() gave for these items, vectors and seeds (it is not checked: hand in the right one). */
function storyGroups(items, vectors, { seeds = null, familiesOf = null, prepared = null, ...over } = {}) {
  const th = { ...THRESHOLDS, ...over };
  const P = prepared || prepare(items, vectors, { seeds, familiesOf, ...over });
  const { texts, seedOf } = P;
  const S = stateOf(texts, seedOf);
  const { groups, alive } = S;
  const across = Math.min(th.named, th.nameOnly, th.rare, th.free);
  let links; let vetoed; let split = 0;
  if (th.whole) {
    // inside each seed, then each seed whole again but for the stories of its own, then across seeds
    const sameSeed = (x, y) => seedOf[x] >= 0 && seedOf[x] === seedOf[y];
    const inside = agglomerate(P, S, th, th.seeded, sameSeed);
    split = settleSeeds(P, S, th);
    const out = agglomerate(P, S, th, across, (x, y) => !sameSeed(x, y));
    links = [...inside.links, ...out.links];
    vetoed = inside.vetoed + out.vetoed;
  } else ({ links, vetoed } = agglomerate(P, S, th, Math.min(th.seeded, across), () => true));
  // a text with no vector stays with its seed: in the story holding the most of that seed's texts
  const homeOf = new Map();
  groups.forEach((g, i) => {
    if (!alive[i] || !g || !g.live) return;
    const counts = addCounts(new Map(), g.members.filter((k) => seedOf[k] >= 0).map((k) => seedOf[k]));
    for (const [sd, n] of counts) { const was = homeOf.get(sd); if (!was || n > was.n) homeOf.set(sd, { i, n }); }
  });
  const extra = new Map();
  groups.forEach((g, i) => {
    if (!alive[i] || !g || g.live || g.members.length !== 1) return;
    const home = homeOf.get(seedOf[g.members[0]]);
    if (!home) return;
    extra.set(home.i, [...(extra.get(home.i) || []), g.members[0]]);
    alive[i] = false;
  });
  const out = groups.map((g, i) => (alive[i] ? [...g.members, ...(extra.get(i) || [])] : null)).filter(Boolean)
    .map((ks) => ks.flatMap((k) => texts[k].items).sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
  const byWhy = links.reduce((m, l) => ({ ...m, [l.why]: (m[l.why] || 0) + 1 }), {});
  return { groups: out, links, vetoed, stats: { items: items.length, texts: texts.length, seeds: P.seedTexts.length, candidates: P.candidates, stories: out.length, links: byWhy, split } };
}

/**
 * A word's sense by what people type (ios/IDEAS-SUPER.md P9): each sense scored by the mean of its `top` closest typed queries.
 * senses, queries: unit vectors. Returns { index, score, margin, scores } or, under `min` (queries that match no sense),
 * { index: null, score, scores }: the caller shows a dossier line or keeps the row off page one, never a blank.
 */
function pickSense(senses, queries, { min = 0.45, top = 3 } = {}) {
  const qs = (queries || []).filter(Boolean);
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const scores = (senses || []).map((s) => {
    if (!s || !qs.length) return 0;
    const cs = qs.map((q) => V.cosine(s, q)).sort((a, b) => b - a).slice(0, Math.max(1, top));
    return cs.reduce((a, b) => a + b, 0) / cs.length;
  });
  if (!scores.length) return { index: null, score: 0, scores };
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const [best, index] = order[0];
  if (best < min) return { index: null, score: r3(best), scores: scores.map(r3) };
  return { index, score: r3(best), margin: r3(best - (order[1] ? order[1][0] : 0)), scores: scores.map(r3) };
}

module.exports = { storyGroups, prepare, pickSense, judge, THRESHOLDS, defaultFamilies };
