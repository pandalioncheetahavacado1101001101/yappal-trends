'use strict';
/*
 * The day's numbers one by one (metrics.js), on invented rows: lead keeps every matched pair inside one symmetric window, coverage
 * calls a listing first only when it came before the surface, coverage and breadth publish no share or ratio under minN, and breadth
 * counts distinct stories new to page one that day against Google Trends' new starts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../metrics');
const spec = require('../scoreboard-spec.json');

const HOUR = 3600;
const DAY = 86400;
const S = Date.parse('2026-10-17T00:00:00Z') / 1000;
const BOUNDS = { start: S, end: S + DAY };
const oursOf = (trends, series = () => []) => ({ trends: new Map(trends.map((t) => [t.id, { cold: false, reseeded: false, firstPage: null, ...t }])), coldEnd: 0, lastSampleAt: S + 30 * DAY, series });
const gtEntry = (i, own, sighting, id) => ({ key: `e${i}`, e: { categories: [4], volume: 50000 }, own, sighting, surface: [own, sighting].filter(Number.isFinite).reduce((a, b) => Math.min(a, b), Infinity), match: id ? { id, how: 'jaccard', score: 1 } : null });
const HISTORY = { comparators: { gt: { entries: {} } } };

test('lead: one symmetric window, every matched pair in n; late pairs count late with their real hours (listedLate is only a sub-count)', () => {
  const trends = []; const rows = [];
  const add = (id, listed, sighting = null) => { trends.push({ id, listed }); rows.push(gtEntry(rows.length, S + 3 * HOUR, sighting, id)); };
  for (let i = 0; i < 4; i++) add(`early${i}`, S + HOUR); // listed 2 h before the entry started
  for (let i = 0; i < 10; i++) add(`late${i}`, S + 33 * HOUR); // listed 30 h after it, never seen by our read
  for (let i = 0; i < 2; i++) add(`tie${i}`, S + 33 * HOUR, S + 4 * HOUR); // listed after our read showed it
  add('farBefore', S + 3 * HOUR - 8 * DAY);
  add('farAfter', S + 3 * HOUR + 8 * DAY);
  const r = X.leadOf('gt', rows, oursOf(trends), BOUNDS, spec);
  assert.equal(r.values.length, 16, 'the 30 h-late pairs stay in n; only the pairs listed more than 7 days either side are out');
  assert.equal(r.listedLate, 10);
  assert.deepEqual(X.leadNumbers(r.values, spec), { n: 16, first: 4, tie: 2, late: 10, medianHours: -30, shareFirst: 0.25, status: 'ok' });
  // (the reviewers' case: 4 listed 2 h early and 6 listed 30 h late is n 10 with 4 first, never n 4 with every one first)
  const four = X.leadOf('gt', rows.slice(0, 4).concat(rows.slice(4, 10)), oursOf(trends), BOUNDS, spec);
  assert.deepEqual(four.values.map((v) => v.o).sort(), ['first', 'first', 'first', 'first', 'late', 'late', 'late', 'late', 'late', 'late']);
  assert.ok(four.values.filter((v) => v.o === 'late').every((v) => v.h === -30));
});

test('coverage: first only when listed before the surface (the earlier of the entry\'s start and our read of it), anchored on the start', () => {
  const trends = [{ id: 'a', listed: S + 12 * HOUR }, { id: 'b', listed: S + 12 * HOUR }, { id: 'c', listed: S + 8 * HOUR }, { id: 'd', listed: S + 20 * HOUR }];
  const rows = [
    gtEntry(0, S + 10 * HOUR, S + 17.5 * HOUR, 'a'), // our read linked it hours after we listed it, but it started before: via
    gtEntry(1, S + 10 * HOUR, null, 'b'), // never linked by our read: via, it started before we listed it
    gtEntry(2, S + 10 * HOUR, null, 'c'), // listed before it started: first
    gtEntry(3, S + 23 * HOUR, S + DAY + 5 * HOUR, 'd'), // started in the day, our read the next day: still the day's
    gtEntry(4, S - 2 * HOUR, S + 3 * HOUR, null), // started the day before: never the day's, whenever our read saw it
  ];
  const scope = X.scopeOf('gt', rows, HISTORY, BOUNDS, spec);
  assert.deepEqual(scope.map((r) => r.key), ['e0', 'e1', 'e2', 'e3']);
  const cov = X.coverageOf(scope, oursOf(trends), spec);
  assert.deepEqual({ ...cov }, { n: 4, covered: 4, first: 2, via: 2, excluded: 0, share: null, firstShare: null, status: 'insufficient', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 0 } });
  // (15 entries or more: a share)
  const many = Array.from({ length: 15 }, (_, i) => gtEntry(10 + i, S + 10 * HOUR, null, i < 6 ? 'c' : null));
  const big = X.coverageOf(X.scopeOf('gt', many, HISTORY, BOUNDS, spec), oursOf(trends), spec);
  assert.deepEqual({ ...big }, { n: 15, covered: 6, first: 6, via: 0, excluded: 0, share: 0.4, firstShare: 1, status: 'ok', stages: { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 9 } });
});

test('coverage\'s misses by stage: listed late, listed long before, built and never listed, read and nothing built, never seen; each entry once', () => {
  const trends = [{ id: 'on', listed: S + 11 * HOUR }, { id: 'late', listed: S + 40 * HOUR }, { id: 'old', listed: S - 9 * DAY }, { id: 'cut', listed: null }];
  const row = (i, id, extra = {}) => ({ ...gtEntry(i, S + 10 * HOUR, null, id), built: null, read: false, ...extra });
  const rows = [row(0, 'on'), row(1, 'late'), row(2, 'old'), row(3, null, { built: { id: 'cut', how: 'person', score: 1 }, read: true }), row(4, null, { read: true }), row(5, null), row(6, null)];
  const cov = X.coverageOf(X.scopeOf('gt', rows, HISTORY, BOUNDS, spec), oursOf(trends), spec);
  assert.deepEqual(cov.stages, { listedLate: 1, outside: 1, notListed: 1, readOnly: 1, unseen: 2 });
  assert.equal(cov.covered + Object.values(cov.stages).reduce((a, x) => a + x, 0), cov.n, 'every entry once');
  // (a comparator the collector does not read: what it read cannot be said)
  const x = X.coverageOf(X.scopeOf('gt', rows.map((r) => ({ ...r, read: null })), HISTORY, BOUNDS, spec), oursOf(trends), spec);
  assert.deepEqual(x.stages, { listedLate: 1, outside: 1, notListed: 1, readOnly: null, unseen: null });
  // (the reads ours.js gives: Google Trends by the keyword as typed, Know Your Meme by address, the Viral 50 by sound; X none)
  const ours = { reads: { gt: new Set(['velma orrin split']), kym: new Set(['https://knowyourmeme.com/memes/brimvale']), viral50: new Set(['123456789']) } };
  assert.deepEqual([X.readByUs('gt', { title: 'Velma  Orrin split' }, ours), X.readByUs('kym', { key: 'https://knowyourmeme.com/memes/brimvale/' }, ours), X.readByUs('viral50', { key: '123456789' }, ours),
    X.readByUs('gt', { title: 'velma orrin' }, ours), X.readByUs('x', { key: 'velma orrin' }, ours)], [true, true, true, false, null]);
});

test('breadth: distinct stories new to page one that day, over Google Trends\' new starts; stock, re-keyed rows and rotation earn nothing', () => {
  const page = (rows) => rows.map(([id, title], i) => ({ id, title, kind: 'talk', rank: i + 1 }));
  const yesterday = S - 10 * HOUR;
  const trends = [
    { id: 'A', listed: yesterday, firstPage: yesterday }, // on page one for days: stock
    { id: 'B1', listed: S + 8 * HOUR, firstPage: S + 8 * HOUR }, { id: 'B2', listed: S + 17 * HOUR, firstPage: S + 17 * HOUR }, // one story, re-keyed
    { id: 'C1', listed: yesterday, firstPage: yesterday }, { id: 'C2', listed: S + 17 * HOUR, firstPage: S + 17 * HOUR }, // re-keyed today, on page one since yesterday
    { id: 'D', listed: S + 6 * HOUR, firstPage: S + 6 * HOUR }, // only here, confirmed by two outlets
    { id: 'E', listed: S + 6 * HOUR, firstPage: S + 6 * HOUR }, // only here, one outlet
  ];
  const lists = [
    { mark: '0900', t: S + 13 * HOUR, items: page([['A', 'Velmor Quist feud'], ['B1', 'Brimvale Ostrander lawsuit'], ['C1', 'Orrel Vane comeback'], ['D', 'Tamsin Kell wedding'], ['E', 'Zap2Zork ban']]) },
    { mark: '1800', t: S + 22 * HOUR, items: page([['A', 'Velmor Quist feud'], ['B2', 'Brimvale Ostrander lawsuit'], ['C2', 'Orrel Vane comeback tour'], ['D', 'Tamsin Kell wedding'], ['E', 'Zap2Zork ban']]) },
  ];
  const series = (id) => [{ outlets: id === 'D' ? 2 : 1 }];
  const gt = Array.from({ length: 15 }, (_, i) => gtEntry(i, S + i * HOUR, null, i === 0 ? 'B1' : i === 1 ? 'A' : null));
  const matched = new Map([['gt', gt], ['kym', []], ['viral50', []], ['x', []]]);
  const b = X.breadthOf(lists, matched, oursOf(trends, series), HISTORY, BOUNDS, spec);
  assert.deepEqual({ ...b }, { pageStories: 5, newStories: 3, shared: 1, onlyHere: 2, onlyHereConfirmed: 1, stories: 2, gtStarts: 15, ratio: 0.13, status: 'ok' });
  // (rotating page one: forty rows, all on page one since yesterday, are no new stories)
  const rotated = Array.from({ length: 20 }, (_, i) => [`R${i}`, `Rotor${String.fromCharCode(97 + i)} Plimsoll${String.fromCharCode(97 + i)} saga`]);
  const rot = [{ mark: '0900', t: S + 13 * HOUR, items: page(rotated.slice(0, 10).concat(rotated.slice(0, 10))) }, { mark: '1800', t: S + 22 * HOUR, items: page(rotated.slice(10)) }];
  const rb = X.breadthOf(rot, matched, oursOf(rotated.map(([id]) => ({ id, listed: yesterday, firstPage: yesterday })), series), HISTORY, BOUNDS, spec);
  assert.equal(rb.pageStories, 20);
  assert.equal(rb.stories, 0);
  // (under 15 Google Trends starts: counts, never a ratio)
  const thin = X.breadthOf(lists, new Map([['gt', gt.slice(0, 10)]]), oursOf(trends, series), HISTORY, BOUNDS, spec);
  assert.deepEqual({ gtStarts: thin.gtStarts, ratio: thin.ratio, status: thin.status }, { gtStarts: 10, ratio: null, status: 'insufficient' });
});

test('breadth counts from the end of the cold start, both halves: page one at a state\'s first cycle is not known to be new', () => {
  const trends = [{ id: 'B', firstPage: S + 8 * HOUR }, { id: 'D', firstPage: S + 6 * HOUR }];
  const lists = [{ mark: '0900', t: S + 13 * HOUR, items: [{ id: 'B', title: 'Brimvale Ostrander lawsuit', kind: 'talk', rank: 1 }, { id: 'D', title: 'Tamsin Kell wedding', kind: 'talk', rank: 2 }] }];
  const gt = Array.from({ length: 40 }, (_, i) => gtEntry(i, S + i * 0.5 * HOUR, null, null)); // one every half hour, 00:00 to 19:30
  const ours = { ...oursOf(trends, () => [{ outlets: 3 }]), coldEnd: S + 7 * HOUR };
  const b = X.breadthOf(lists, new Map([['gt', gt]]), ours, HISTORY, BOUNDS, spec);
  assert.deepEqual({ pageStories: b.pageStories, newStories: b.newStories, stories: b.stories, gtStarts: b.gtStarts, ratio: b.ratio },
    { pageStories: 2, newStories: 1, stories: 1, gtStarts: 26, ratio: 0.04 }, 'the story first on page one at 06:00 is not new; the starts from 07:00 on are 26');
});

test('precision\'s duplicates and breadth\'s stories use one rule: the matcher\'s (M.sameStory)', () => {
  const rows = [{ title: 'Brimvale Ostrander lawsuit', kind: 'talk' }, { title: 'Brimvale Ostrander lawsuit filed', kind: 'talk' }, { title: 'Velma Orrin by Quorra', kind: 'sound' }, { title: 'Velma Orrin', kind: 'talk' }];
  assert.equal(X.duplicatesOf(rows, spec), 1, 'a sound named after a person is not that person\'s story');
});
