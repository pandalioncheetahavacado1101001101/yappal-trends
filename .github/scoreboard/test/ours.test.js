'use strict';
/*
 * Our side (ours.js) on an invented state: the Google Trends sighting is the collector's own read only (a backfilled or reseeded
 * sample never counts), trends met in the cold start are marked, our first listing and first page one are the first own reads
 * ranking a trend inside listDepth and the page, and the state is only read (its file is byte for byte the same).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const F = require('./fixture');
const spec = require('../scoreboard-spec.json');
const { readState } = require('../ours');

const HOUR = 3600;
const S = Date.parse('2026-10-17T00:00:00Z') / 1000;
const digest = (dir) => fs.readdirSync(dir).sort().map((f) => {
  const p = path.join(dir, f);
  return fs.statSync(p).isFile() ? `${f}:${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}` : `${f}/`;
}).join(',');

test('the Google Trends sighting is our own read only; cold-start trends are marked; the state is never written', () => {
  const state = F.writeState({
    firstCycleAt: S,
    trends: [
      { id: 'A', title: 'Orrel Vane feud', kind: 'talk', sub: 'drama', firstSeen: S + HOUR, listed: S + 2 * HOUR },
      { id: 'B', title: 'Tamsin Kell split', kind: 'talk', sub: 'drama', firstSeen: S + 5 * HOUR, listed: S + 6 * HOUR },
    ],
    samples: [
      { id: 'B', t: S - 30 * HOUR, sv_us: 5000, flags: 4 }, // rebuilt from a source's past series
      { id: 'B', t: S + 4 * HOUR, sv_us: 9000, flags: 32 }, // read back from the feed
      { id: 'B', t: S + 7 * HOUR, sv_us: 20000, flags: 0 }, // the collector's own read
      { id: 'A', t: S + 3 * HOUR, sv_us: 0, interest: 10 },
    ],
  });
  const before = digest(state);
  const ours = readState(state, spec);
  try {
    assert.equal(ours.sightings.gt.get('B'), S + 7 * HOUR);
    assert.equal(ours.sightings.gt.has('A'), false, 'no sample with a search volume: never shown by our read');
    assert.equal(ours.trends.get('A').cold, true, 'met in the first 3 hours');
    assert.equal(ours.trends.get('B').cold, false);
    assert.equal(ours.trends.get('B').listed, S + 6 * HOUR);
    assert.equal(ours.coldEnd, S + spec.ours.coldStartHours * HOUR);
  } finally { ours.close(); }
  assert.equal(digest(state), before, 'the restored state is read, never written');
});

test('our first listing is the first own read ranking a trend 1 to listDepth (80): a row ranked 81 never counts, however many rows are published', () => {
  const state = F.writeState({
    firstCycleAt: S,
    trends: [
      { id: 'D', title: 'Orrel Vane feud', kind: 'talk', sub: 'drama', firstSeen: S + 4 * HOUR, listed: S + 5 * HOUR, rank: 81 },
      { id: 'E', title: 'Tamsin Kell split', kind: 'talk', sub: 'drama', firstSeen: S + 4 * HOUR, listed: S + 5 * HOUR, rank: 30 },
      { id: 'F', title: 'Quorra Bellwind lawsuit', kind: 'talk', sub: 'drama', firstSeen: S + 4 * HOUR, listed: S + 5 * HOUR, rank: 90 },
    ],
    samples: [
      { id: 'D', t: S + 6 * HOUR, r_us: 95 },
      { id: 'D', t: S + 7 * HOUR, r_us: 80 }, // inside the depth from here
      { id: 'D', t: S + 8 * HOUR, r_us: 12 }, // and on page one from here
      { id: 'E', t: S + 4.5 * HOUR, r_us: 3, flags: 32 }, // read back from the feed: never our own listing
      { id: 'E', t: S + 9 * HOUR, r_us: 15 },
    ],
  });
  const ours = readState(state, spec);
  try {
    assert.equal(spec.ours.listDepth, 80);
    assert.equal(ours.trends.get('D').listed, S + 7 * HOUR, 'ranked 81, then 95: listed only when ranked 80');
    assert.equal(ours.trends.get('D').firstPage, S + 8 * HOUR);
    assert.equal(ours.trends.get('E').listed, S + 5 * HOUR);
    assert.equal(ours.trends.get('E').firstPage, S + 9 * HOUR, 'a reseeded sample on page one is not ours');
    assert.equal(ours.trends.get('F').listed, null, 'never ranked inside the depth: never listed, so never matched');
    assert.equal(ours.trends.get('F').firstPage, null);
  } finally { ours.close(); }
});

test('a compacted hour is dated from its start, never before the collector\'s own first listing', () => {
  const { firstRanked } = require('../ours');
  assert.equal(firstRanked(S, S + 1800), S + 1800);
  assert.equal(firstRanked(S + 3600, S), S + 3600);
  assert.equal(firstRanked(S, undefined), S);
  assert.equal(firstRanked(undefined, S), null);
});
