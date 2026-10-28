'use strict';
/*
 * The depth-150 shadow line (depth.js) offline on an invented state: run.js scores the day at 80 as ever, then depth.js reads the same
 * state at 150. A row listed only past the main list covers its Google Trends entry at 150 and never at 80 (tail first); the v4
 * hash is the one run.js computes; what is written is aggregate. Every name here is invented. Run where the scoreboard's files are
 * (SCOREBOARD_LIB, default this folder): node --test depth.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// (beside depth.js, or in the scoreboard's test/ folder; SCOREBOARD_LIB: where the scoreboard's own files are)
const HERE = fs.existsSync(path.join(__dirname, 'depth.js')) ? __dirname : path.join(__dirname, '..');
const LIB = process.env.SCOREBOARD_LIB || HERE;
const F = require(path.join(LIB, 'test', 'fixture.js'));
const RUN = require(path.join(LIB, 'run.js'));
const DEPTH = require(path.join(HERE, 'depth.js'));

const HOUR = 3600;
const D = '2026-10-17';
const S = Date.parse(`${D}T00:00:00Z`) / 1000;
const WORDS = ['amber', 'birch', 'cobalt', 'delta', 'ember', 'fjord'];
const cap = (w) => w[0].toUpperCase() + w.slice(1);

/** Six stories on the main list, one listed only at 85 under "Still searched"; each with a Google Trends entry 4 h after listing. */
function world() {
  const trends = []; const samples = []; const gt = [];
  WORDS.forEach((w, i) => {
    const listed = S + (2 + i) * HOUR;
    trends.push({ id: `L${i}`, title: `${cap(w)} Vantor feud`, kind: 'talk', sub: 'drama', firstSeen: listed - HOUR, listed });
    gt.push({ keyword: `${w} vantor`, start: listed + 4 * HOUR, volume: 50000 });
  });
  trends.push({ id: 'E0', title: 'Quorrel Tamsy', kind: 'talk', firstSeen: S + HOUR, listed: S + 2 * HOUR, rank: 85 });
  gt.push({ keyword: 'quorrel tamsy', start: S + 6 * HOUR, volume: 100000 });
  // (a search nobody built: read by us, never a row)
  gt.push({ keyword: 'brindle morrow', start: S + 7 * HOUR, volume: 100000 });
  const main = WORDS.map((w, k) => ({ id: `L${k}`, title: `${cap(w)} Vantor feud`, kind: 'talk', sub: 'drama', rank: k + 1, status: 'peaking', statusMeasured: true, isEarly: false, startedAt: F.iso(S), people: [], keys: [] }));
  const ext = { id: 'E0', title: 'Quorrel Tamsy', kind: 'talk', rank: 85, section: 'stillSearched', status: 'rising', statusMeasured: false, isEarly: false, startedAt: F.iso(S + HOUR), people: [], keys: [] };
  const lists = [{ name: `${D}-0900`, t: S + 13 * HOUR, items: [...main, ext] }];
  for (const id of ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'E0']) samples.push({ id, t: S + 13 * HOUR - HOUR, interest: 50 }, { id, t: S + 37 * HOUR, interest: 40, n24: 1 }, { id, t: S + 45 * HOUR, interest: 30 });
  const state = F.writeState({ firstCycleAt: S - 3 * 24 * HOUR, trends, samples, lists, talkTrends: [{ geo: 'US', keyword: 'brindle morrow' }] });
  return { state, gt, main, ext };
}

function ledger() {
  const lines = [];
  for (let slot = S; slot < S + 24 * HOUR; slot += 15 * 60) {
    const ext = slot < S + 2 * HOUR ? null : { stillSearched: 14, more: 4 };
    lines.push(JSON.stringify({ slot: F.iso(slot), published: F.iso(slot + 600), rows: ext ? 98 : 80, ...(ext ? { rowsExtension: ext, extFresh: 0.4 } : {}), code: 0 }));
  }
  const dir = F.tmp('ledger');
  fs.writeFileSync(path.join(dir, 'ledger.jsonl'), `${lines.join('\n')}\n`);
  return path.join(dir, 'ledger.jsonl');
}

async function quiet(fn) {
  const write = process.stdout.write;
  const printed = [];
  process.stdout.write = (s) => { printed.push(String(s)); return true; };
  try { return { code: await fn(), printed }; } finally { process.stdout.write = write; }
}

test('depth 150 beside v4: the row listed only at 85 covers its entry at 150, first, in the tail; v4 at 80 the same either way; aggregate only', async () => {
  const { state, gt, main, ext } = world();
  const cache = F.tmp('cache'); const out = F.tmp('out'); const led = ledger();
  const feedDir = F.tmp('feed');
  const feed = path.join(feedDir, 'us.json');
  fs.writeFileSync(feed, JSON.stringify({ schemaVersion: 1, audience: 'US', sections: [{ key: 'stillSearched', title: 'Still searched', count: 1 }], items: [...main, ext] }));
  const replies = F.writeReplies({ 'gt-us-168h.txt': F.gtReply(gt), 'kym-memes.xml': F.rssReply([]) });
  const now = F.iso(S + 2 * 24 * HOUR + 6 * HOUR + 20 * 60);
  // (run.js reads the feed's main rows, as scoreboard.yml hands it: depth.js --slice-feed)
  const sliced = path.join(feedDir, 'us80.json');
  const s = await quiet(() => DEPTH.main(['--slice-feed', feed, sliced]));
  assert.equal(s.code, 0);
  const cut = JSON.parse(fs.readFileSync(sliced, 'utf8'));
  assert.deepEqual([cut.items.length, cut.sections], [6, undefined]);
  const r = await quiet(() => RUN.main(['--state', state, '--cache', cache, '--out', out, '--replies', replies, '--feed', sliced, '--ledger', led, '--now', now]));
  assert.equal(r.code, 0);
  const latest = JSON.parse(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'));
  const d = await quiet(() => DEPTH.main(['--state', state, '--cache', cache, '--out', out, '--feed', feed, '--ledger', led, '--now', now]));
  assert.equal(d.code, 0, d.printed.join(''));
  assert.match(d.printed.join(''), /^depth 2026-10-17 \(v4 [0-9a-f]{12}, depth spec 1\)/);
  const doc = JSON.parse(fs.readFileSync(path.join(out, 'depth.json'), 'utf8'));
  assert.equal(doc.spec.v4, latest.spec.hash, 'the v4 hash run.js published');
  const v4 = latest.latest.coverage.gt;
  const at150 = doc.at150.coverage.gt;
  assert.deepEqual([v4.n, v4.covered, v4.stages.notListed, v4.stages.readOnly], [8, 6, 1, 1], 'at 80 the extension row is built and not listed');
  assert.deepEqual([at150.n, at150.covered, at150.first, at150.stages.notListed, at150.stages.readOnly], [8, 7, 7, 0, 1]);
  assert.deepEqual(doc.tailFirst.gt, 1);
  assert.equal(doc.check.v4At80, true);
  assert.deepEqual(doc.sections.stillSearched, { rows: 1, checked: 1, live: 1, sounds: 0, soundsLive: 0, under72: 1 });
  assert.deepEqual([doc.rows.lines, doc.rows.median, doc.rows.at150Lines, doc.rows.under120Lines, doc.rows.extension, doc.rows.fresh], [96, 98, 0, 96, { stillSearched: 14, more: 4 }, 0.4]);
  assert.deepEqual(doc.meets, { rowsLines: false, rowsFloor: false, extLive: true, soundLive: null, fresh: true, notListed150: true });
  assert.equal(doc.fivex.status, 'shadow');
  // (nothing per trend: no title, id or keyword anywhere in what is written)
  const text = fs.readFileSync(path.join(out, 'depth.json'), 'utf8');
  for (const word of ['Quorrel', 'quorrel', 'E0', 'Vantor', 'vantor', 'brindle']) assert.ok(!text.includes(word), word);
});

test('the guard refuses a free string or an unknown key; the slice keeps the main rows and drops the sections', () => {
  assert.throws(() => DEPTH.assertDepth({ day: 'Quorrel Tamsy' }), /a free string/);
  assert.throws(() => DEPTH.assertDepth({ title: 1 }), /an unknown key/);
  assert.doesNotThrow(() => DEPTH.assertDepth({ sections: { stillSearched: { rows: 3, under72: 0.5 } }, fivex: { status: 'shadow' } }));
  const list = DEPTH.sliceFeed(JSON.stringify({ audience: 'US', sections: [{ key: 'more', title: 'More', count: 1 }], items: [{ id: 'a', rank: 1 }, { id: 'b', rank: 2, section: 'more' }] }));
  assert.deepEqual(list, { audience: 'US', items: [{ id: 'a', rank: 1 }] });
  assert.equal(DEPTH.sliceFeed('not json'), null);
});
