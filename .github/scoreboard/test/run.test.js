'use strict';
/*
 * The daily job offline, end to end (run.js three times over one cache, as three mornings would): an invented state and invented
 * comparator replies, every number of the scored day worked out by hand below. Also: what is written is aggregate only, the
 * branch's days.jsonl is read back and appended to, and the cache holds name-free values only (never a matched pair).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('./fixture');
const { main } = require('../run');

const HOUR = 3600;
const D = '2026-10-17';
const S = Date.parse(`${D}T00:00:00Z`) / 1000;
const WORDS = ['amber', 'birch', 'cobalt', 'delta', 'ember', 'fjord', 'garnet', 'harbor', 'indigo', 'jasper', 'kestrel', 'lumen', 'marble', 'nectar', 'onyx', 'pebble'];
const cap = (w) => w[0].toUpperCase() + w.slice(1);

/** The invented world: 16 stories Google Trends shares with us (10 first, 3 ties, 3 late), a meme, a sound, an X trend, one row only here. */
function world() {
  const trends = []; const samples = []; const gt = [];
  WORDS.forEach((w, i) => {
    const listed = S + (2 + i * 0.5) * HOUR;
    trends.push({ id: `L${i}`, title: `${cap(w)} Vantor feud`, kind: 'talk', sub: 'drama', firstSeen: listed - HOUR, listed });
    if (i < 10) { gt.push({ keyword: `${w} vantor`, start: listed + 4 * HOUR, volume: 50000 }); samples.push({ id: `L${i}`, t: listed + 4.25 * HOUR, sv_us: 20000, interest: 30 }); }
    else if (i < 13) { gt.push({ keyword: `${w} vantor`, start: listed - 0.5 * HOUR, volume: 50000 }); samples.push({ id: `L${i}`, t: listed - 0.25 * HOUR, sv_us: 20000, interest: 30 }); }
    else gt.push({ keyword: `${w} vantor`, start: listed - 2 * HOUR, volume: 50000 });
  });
  for (let i = 0; i < 4; i++) gt.push({ keyword: `qwertz ${i} gala`, start: S + 10 * HOUR, volume: 20000 });
  trends.push({ id: 'G1', title: 'Glimmerdoo dance', kind: 'word', sub: 'craze', firstSeen: S + 4 * HOUR, listed: S + 5 * HOUR });
  trends.push({ id: 'Q1', title: 'Quillo by Brindle', kind: 'sound', sub: 'sound', firstSeen: S, listed: S + HOUR });
  trends.push({ id: 'P1', title: 'Pelloran Quade feud', kind: 'talk', sub: 'drama', firstSeen: S + 2 * HOUR, listed: S + 3 * HOUR });
  trends.push({ id: 'O1', title: 'Amber Vantor feud', kind: 'talk', sub: 'drama', firstSeen: S + 11 * HOUR, listed: S + 12 * HOUR });
  samples.push({ id: 'O1', t: S + 12 * HOUR, outlets: 3, interest: 20 });
  const page = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'G1', 'Q1', 'P1', 'O1'];
  const lists = [{ name: `${D}-0900`, t: S + 13 * HOUR }, { name: `${D}-1800`, t: S + 22 * HOUR }].map((l) => ({ ...l, items: page.map((id, k) => {
    const tr = trends.find((x) => x.id === id);
    return { id, title: tr.title, kind: tr.kind, sub: tr.sub, rank: k + 1, status: k < 2 ? 'fading' : 'peaking', statusMeasured: true, isEarly: false,
      startedAt: F.iso(id === 'L2' ? S - 10 * 24 * HOUR : S), people: [], keys: [] };
  }) }));
  for (const l of lists) for (const id of page) {
    samples.push({ id, t: l.t - HOUR, interest: 50 });
    const dead = id === 'L3' || id === 'L4';
    samples.push({ id, t: l.t + 24 * HOUR, interest: dead ? 10 : 40, n24: dead ? 0 : 1 });
  }
  samples.push({ id: 'L5', t: S + 54 * HOUR, interest: 20 });
  const state = F.writeState({ firstCycleAt: S - 3 * 24 * HOUR, trends, samples, lists, kym: [{ url: 'https://knowyourmeme.com/memes/glimmerdoo-dance', seenFirst: S + 3.5 * HOUR }] });
  return { state, gt };
}

function ledger() {
  const lines = [];
  for (let slot = S - 15 * 60; slot < S + 24 * HOUR; slot += 15 * 60) {
    lines.push(JSON.stringify({ slot: F.iso(slot), started: F.iso(slot), published: F.iso(slot + 600), rows: 80, requests: 70, modelCards: 20, seconds: 500, code: 0, by: 'chain', run: 1, ...(slot >= S ? { probeAgeSeconds: 600 } : {}) }));
  }
  const dir = F.tmp('ledger');
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), `${lines.join('\n')}\n`);
  return path.join(dir, 'ledger.jsonl');
}

async function threeMornings() {
  const { state, gt } = world();
  const cache = F.tmp('cache');
  const outs = [F.tmp('out1'), F.tmp('out2'), F.tmp('out3')];
  const kym = F.rssReply([{ url: 'https://knowyourmeme.com/memes/glimmerdoo-dance', title: 'Glimmerdoo Dance', at: S + 3 * HOUR }, { url: 'https://knowyourmeme.com/memes/frobnic-wave', title: 'Frobnic Wave', at: S + 4 * HOUR }]);
  const day1 = F.writeReplies({ 'gt-us-168h.txt': F.gtReply([]), 'kym-memes.xml': F.rssReply([]), 'tts-viral.html': F.viralReply([{ title: 'Zent', artist: 'Arko', id: '700000000002' }], 'October 16, 2026') });
  const day2 = F.writeReplies({ 'gt-us-168h.txt': F.gtReply([]), 'kym-memes.xml': F.rssReply([]), 'tts-viral.html': F.viralReply([{ title: 'Quillo', artist: 'Brindle', id: '700000000001' }, { title: 'Zent', artist: 'Arko', id: '700000000002' }], 'October 17, 2026'),
    'getdaytrends-us.html': F.xReply(['Pelloran Quade', 'Zzyzx']) });
  const day3 = F.writeReplies({ 'gt-us-168h.txt': F.gtReply(gt), 'kym-memes.xml': kym, 'kym-subs.xml': F.rssReply([]), 'tts-viral.html': F.viralReply([{ title: 'Quillo', artist: 'Brindle', id: '700000000001' }, { title: 'Zent', artist: 'Arko', id: '700000000002' }], 'October 19, 2026'),
    'getdaytrends-us.html': F.xReply(['Zzyzx']) });
  const write = process.stdout.write;
  const printed = [];
  process.stdout.write = (s) => { printed.push(String(s)); return true; };
  try {
    const codes = [];
    codes.push(await main(['--state', state, '--cache', cache, '--out', outs[0], '--replies', day1, '--now', F.iso(S - 17 * HOUR - 40 * 60)]));
    codes.push(await main(['--state', state, '--cache', cache, '--out', outs[1], '--branch', outs[0], '--replies', day2, '--now', F.iso(S + 6 * HOUR + 20 * 60)]));
    codes.push(await main(['--state', state, '--cache', cache, '--out', outs[2], '--branch', outs[1], '--replies', day3, '--ledger', ledger(), '--now', F.iso(S + 54 * HOUR + 20 * 60)]));
    return { codes, state, cache, out: outs[2], printed };
  } finally { process.stdout.write = write; }
}

test('three mornings over one cache: the scored day\'s numbers, worked out by hand', async () => {
  const { codes, out } = await threeMornings();
  assert.deepEqual(codes, [0, 0, 0]);
  const lines = fs.readFileSync(path.join(out, 'days.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.day), ['2026-10-14', '2026-10-15', D], 'read back and appended, one line a scored day');
  const l = lines[2];
  // lead: 10 first at +4 h, 3 ties (listed after our own Google Trends read showed them), 3 late at -2 h; median of 16 = +4
  assert.deepEqual({ ...l.lead.gt }, { n: 16, first: 10, tie: 3, late: 3, medianHours: 4, shareFirst: 0.625, status: 'ok', excluded: 0, listedLate: 0 });
  assert.equal(l.lead.kym.n, 1); assert.equal(l.lead.kym.tie, 1); assert.equal(l.lead.kym.status, 'insufficient'); assert.equal(l.lead.kym.medianHours, null);
  assert.equal(l.lead.viral50.n, 1); assert.equal(l.lead.viral50.late, 1, 'charted the day we listed it, an hour after the chart day began');
  assert.equal(l.pooled.gt.n, 16); assert.equal(l.pooled.gt.medianHours, 4); assert.equal(l.pooled.gt.ci.length, 2);
  assert.ok(l.pooled.gt.ci[0] <= 4 && l.pooled.gt.ci[1] >= 4);
  assert.equal(l.pooled.kym.status, 'insufficient');
  // coverage: 20 GT scope starts (anchored on their own start), 16 listed in time; first only when listed before the surface (the
  // earlier of the start and our own read showing it), as lead counts: the 10 listed 4 h ahead. Via: the 3 ties (listed after our
  // read showed them) and the 3 listed 2 h after the start, which our read never linked
  assert.deepEqual({ ...l.coverage.gt }, { n: 20, covered: 16, first: 10, via: 6, excluded: 0, share: 0.8, firstShare: 0.625, status: 'ok', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 4 } });
  // (under 15 scope entries a day: counts, never a share)
  assert.deepEqual({ ...l.coverage.kym }, { n: 2, covered: 1, first: 0, via: 1, excluded: 0, share: null, firstShare: null, status: 'insufficient', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 1 } });
  assert.deepEqual({ ...l.coverage.viral50 }, { n: 2, covered: 1, first: 0, via: 1, excluded: 0, share: null, firstShare: null, status: 'insufficient', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 1 } }, 'charted from 00:00, listed at 01:00: via, as lead calls it late');
  assert.deepEqual({ ...l.coverage.x }, { n: 2, covered: 1, first: 1, via: 0, excluded: 0, share: null, firstShare: null, status: 'insufficient', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: null, unseen: null } }, 'the collector does not read X: what it read cannot be said');
  // breadth, flow over flow: 20 page-one rows are 19 stories ("Amber Vantor feud" twice is one), all first on page one that day and
  // all shared, over 20 Google Trends scope starts; pooled over the 7 days (one scored day so far, the same numbers)
  assert.deepEqual({ ...l.breadth, pooled: undefined }, { pageStories: 19, newStories: 19, shared: 19, onlyHere: 0, onlyHereConfirmed: 0, stories: 19, gtStarts: 20, ratio: 0.95, status: 'ok', pooled: undefined });
  assert.deepEqual({ ...l.breadth.pooled }, { days: 1, stories: 19, gtStarts: 20, ratio: 0.95, status: 'ok' });
  assert.equal(l.precision.lists.length, 2);
  for (const p of l.precision.lists) assert.deepEqual({ ...p, mark: undefined }, { mark: undefined, rows: 20, checked: true, live: 18, fading: 2, duplicates: 1, old: 1, gate: false });
  assert.equal(l.precision.gate, false, 'a duplicate on page one fails the gate');
  assert.deepEqual({ ...l.speed }, { runs: 96, published: 96, failed: 0, lagMedianMinutes: 10, lagP90Minutes: 10, meanAgeMinutes: 17.5, ageCoveredShare: 1, maxGapMinutes: 15, probeN: 96, probeMeanAgeMinutes: 10 });
  assert.deepEqual({ ...l.meets, coverage: undefined }, { lead: false, breadth: false, precision: false, coverage: undefined, speed: false });
  assert.deepEqual({ ...l.meets.coverage }, { gt: true, kym: false, viral50: false });
  assert.deepEqual({ ...l.reads }, { gt: 'ok', kym: 'ok', viral50: 'ok', x: 'ok' });
  const latest = JSON.parse(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'));
  assert.equal(latest.latest.day, D);
  assert.deepEqual({ ...latest.claim }, { consecutiveDays: 0, needed: 14, holds: false });
  assert.equal(latest.matcher.version, 3);
  assert.equal(latest.spec.version, 3);
  // (the rolling window: shares only from minN entries; breadth on the window's stories over its Google Trends starts)
  assert.deepEqual({ ...latest.rolling.coverage.gt }, { days: 1, n: 20, covered: 16, first: 10, share: 0.8, firstShare: 0.625, status: 'ok', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 4 } });
  assert.deepEqual({ ...latest.rolling.coverage.kym }, { days: 1, n: 2, covered: 1, first: 0, share: null, firstShare: null, status: 'insufficient', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 1 } });
  assert.deepEqual({ ...latest.rolling.breadth }, { days: 1, stories: 19, gtStarts: 20, ratio: 0.95, status: 'ok' });
  assert.ok(latest.matcher.audit === null || (Number.isFinite(latest.matcher.audit.rate) && latest.matcher.audit.audited > 0), 'the matcher\'s audited false-match rate, when there is one');
  assert.ok(Buffer.byteLength(JSON.stringify(latest)) < 10 * 1024, 'latest.json stays under 10 KB');
});

test('nothing of ours per trend is written anywhere: the branch files and the printed line hold no title, id or per-trend instant, and the cache no pair', async () => {
  const { out, cache, printed } = await threeMornings();
  const branch = ['days.jsonl', 'latest.json'].map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n') + printed.join('');
  for (const leak of ['Vantor', 'vantor', 'Glimmerdoo', 'Quillo', 'Pelloran', 'qwertz', 'knowyourmeme', '"L0"', 'L15', 'O1', '700000000001', F.iso(S + 2 * HOUR)]) {
    assert.ok(!branch.includes(leak), `"${leak}" must not be published or printed`);
  }
  // (the cache is restorable by a fork's pull request: it holds the comparators' public entries and name-free values, nothing of ours)
  assert.deepEqual(fs.readdirSync(cache), ['history.json']);
  const text = fs.readFileSync(path.join(cache, 'history.json'), 'utf8');
  for (const leak of ['Vantor feud', 'Glimmerdoo dance', 'Quillo by Brindle', 'Pelloran Quade feud', '"L0"', '"O1"', '"G1"', '"Q1"', '"P1"', '"listed"', '"trend"', '"pairs"', `${S + 2 * HOUR}`]) {
    assert.ok(!text.includes(leak), `"${leak}" must not be cached`);
  }
  const days = JSON.parse(text).days;
  assert.deepEqual(Object.keys(days[D]).sort(), ['at', 'breadth', 'lead', 'spec']);
  assert.deepEqual({ ...days[D].breadth }, { stories: 19, gtStarts: 20 });
  assert.equal(days[D].lead.gt.length, 16);
  for (const vs of Object.values(days[D].lead)) for (const v of vs) assert.deepEqual(Object.keys(v), ['h', 'o']);
});

test('no state restored: nothing scored, nothing written to the branch, the comparators\' history kept (exit 3)', async () => {
  const cache = F.tmp('cache'); const out = F.tmp('out');
  const replies = F.writeReplies({ 'gt-us-168h.txt': F.gtReply([{ keyword: 'zent', start: S, volume: 20000 }]) });
  const write = process.stdout.write; process.stdout.write = () => true;
  try { assert.equal(await main(['--state', F.tmp('nostate'), '--cache', cache, '--out', out, '--replies', replies, '--now', F.iso(S)]), 3); } finally { process.stdout.write = write; }
  assert.deepEqual(fs.readdirSync(out), []);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(cache, 'history.json'), 'utf8')).comparators.gt.entries).length, 1);
});
