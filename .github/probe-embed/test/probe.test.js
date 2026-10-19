'use strict';
/* The embedding probe's own logic, with no model and no network: the invented headlines, the numbers, the cycle cost, the guard. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../headlines');
const P = require('../probe');

test('headlines: the same seed gives the same 2,000 distinct invented headlines, two stories of different kinds a person', () => {
  const a = H.headlines();
  const b = H.headlines();
  assert.equal(a.length, 2000);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((x) => x.text)).size, a.length);
  const kinds = new Map();
  for (const x of a) { if (!kinds.has(x.person)) kinds.set(x.person, new Set()); kinds.get(x.person).add(x.kind); }
  assert.equal(kinds.size, 50);
  for (const ks of kinds.values()) assert.equal(ks.size, 2);
  assert.notDeepEqual(H.headlines({ seed: 1 }).slice(0, 5), a.slice(0, 5));
});

test('quantiles, AUC and the best cut', () => {
  assert.deepEqual(P.quantiles([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]), { n: 10, p10: 0.2, p50: 0.6, p90: 1 });
  assert.equal(P.auc([0.9, 0.8], [0.1, 0.2]), 1);
  assert.equal(P.auc([0.1, 0.2], [0.9, 0.8]), 0);
  assert.equal(P.auc([0.5], [0.5]), 0.5);
  const cut = P.bestCut([0.8, 0.85, 0.9], [0.3, 0.4, 0.82]);
  assert.ok(cut.cut > 0.4 && cut.cut <= 0.85, `cut ${cut.cut}`);
});

test('separation: a model that holds stories apart scores 1; one that sees only the person scores 0.5 or less', () => {
  const items = H.headlines({ people: 6, perStory: 6 });
  const dims = 32;
  const axis = (k) => Float32Array.from({ length: dims }, (_, i) => (i === k ? 1 : 0));
  const mix = (a, b, w) => P.unit(Float32Array.from(a, (x, i) => x * w + b[i] * (1 - w)));
  const byStory = items.map((x) => mix(axis(x.story % dims), axis((x.person + 20) % dims), 0.8));
  const good = P.separation(byStory, items);
  assert.equal(good.auc.storyOverPerson, 1);
  assert.ok(good.pairs.sameStory.p50 > good.pairs.samePersonOtherStory.p90);
  assert.ok(good.centroids.personTwoStories.max < good.centroids.storyHalves.p10);
  const byPerson = items.map((x) => axis(x.person % dims));
  assert.ok(P.separation(byPerson, items).auc.storyOverPerson <= 0.5);
});

test('the cycle cost: restore, load and the new texts at the measured rate; the typical cycle decides collect or enrich', () => {
  assert.equal(P.cycleSeconds({ mb: 300, loadSeconds: 4, perSecond: 100 }, 300), 10);
  assert.equal(P.cycleSeconds({ mb: 50, loadSeconds: 1, perSecond: 0 }, 300), null);
  assert.ok(P.PER_CYCLE.typical < P.PER_CYCLE.peak && P.PER_CYCLE.peak < P.PER_CYCLE.cold);
  assert.equal(P.BUDGET_SECONDS, 30);
});

test('memory: the kB figure of a /proc status line', () => {
  assert.equal(P.parseStatusKb('Name:\tollama\nVmRSS:\t  123456 kB\nThreads: 9\n', 'VmRSS'), 123456);
  assert.equal(P.parseStatusKb('MemTotal: 16000 kB\nMemAvailable:   8000 kB\n', 'MemAvailable'), 8000);
  assert.equal(P.parseStatusKb('nothing here', 'VmRSS'), null);
});

test('the guard: numbers, model names, labels and instants pass; a headline, an unknown key or a stray string does not', () => {
  const good = { schema: 1, at: '2026-10-20T10:00:00Z', runner: { cores: 4, memoryMb: 16000 }, install: { seconds: 21 }, texts: 2000,
    perCycle: P.PER_CYCLE, budgetSeconds: 30, assumedRestoreMBps: 100, editor: null,
    models: [{ model: 'nomic-embed-text', pull: { seconds: 9, mb: 262 }, load: { seconds: 3 }, dims: 768, batches: [{ batch: 64, seconds: 10, perSecond: 200, peakMb: 900, availableMinMb: 12000 }],
      best: { batch: 64, perSecond: 200 }, cycle: { typical: 7, peak: 10, cold: 140 }, verdict: 'collect', inMemoryMb: 600,
      separation: { pairs: { sameStory: { n: 1, p10: 0.8, p50: 0.9, p90: 0.95 } }, auc: { storyOverPerson: 0.9 }, cut: { cut: 0.8, j: 0.6 }, centroids: { personTwoStories: { n: 1, p10: 0.5, p50: 0.6, p90: 0.7, max: 0.8 } } },
      separation256: null }, { model: 'all-minilm', error: 'pull-failed' }] };
  assert.deepEqual(P.check(good), []);
  const leak = JSON.parse(JSON.stringify(good));
  leak.models[0].model = 'Livo Dovane breaks viewer record';
  assert.ok(P.check(leak).length > 0);
  const extra = JSON.parse(JSON.stringify(good));
  extra.models[0].sample = 'x';
  assert.ok(P.check(extra).length > 0);
  const label = JSON.parse(JSON.stringify(good));
  label.models[1].error = 'connect ECONNREFUSED 127.0.0.1:11434';
  assert.ok(P.check(label).length > 0);
  const nan = JSON.parse(JSON.stringify(good));
  nan.texts = 'many';
  assert.ok(P.check(nan).length > 0);
});

test('the markdown names no headline and carries every model row', () => {
  const r = { at: '2026-10-20T10:00:00Z', runner: { cores: 4, memoryMb: 16000 }, install: { seconds: 21 }, texts: 2000, perCycle: P.PER_CYCLE, budgetSeconds: 30, assumedRestoreMBps: 100,
    models: [{ model: 'all-minilm', error: 'pull-failed' }], editor: null };
  const md = P.markdown(r);
  assert.match(md, /all-minilm \| \| \| \| \| pull-failed/);
  for (const h of H.headlines().slice(0, 50)) assert.ok(!md.includes(h.text));
});

test('arguments: a model name that could not be published is refused before anything runs', () => {
  assert.throws(() => P.args(['--models', 'nomic-embed-text "quoted name"']));
  assert.deepEqual(P.args(['--models', 'nomic-embed-text all-minilm', '--texts', '500']).models, ['nomic-embed-text', 'all-minilm']);
});
