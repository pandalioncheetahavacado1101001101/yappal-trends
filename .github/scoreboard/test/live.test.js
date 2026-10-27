'use strict';
/*
 * Spec v4: precision's kind-aware "live a day on" (metrics.js liveAfter) and X's scope classed by Google Trends (metrics.js
 * xClassed), on invented states and entries. A story is judged as v3 judged every kind; a sound by a TikTok chart still listing it
 * or its count still growing; a word by a ranking list still carrying its title or a new sighting of its own. Every name is made up.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./fixture');
const spec = require('../scoreboard-spec.json');
const { readState } = require('../ours');
const MX = require('../metrics');

const HOUR = 3600;
const S = Date.parse('2026-10-17T00:00:00Z') / 1000;
const T = S + 13 * HOUR; // the 09:00 list
const row = (id, kind, title, extra = {}) => ({ id, title, kind, sub: kind === 'sound' ? 'sound' : kind === 'word' ? 'craze' : 'drama', rank: 1, status: 'peaking', statusMeasured: true,
  isEarly: false, startedAt: F.iso(S), people: [], keys: [], ...extra });

/** One list's page with a row of every case, the samples, list items and sightings each needs, read back as the scoreboard reads a state. */
function world({ noCount = false } = {}) {
  const items = [
    row('SA', 'sound', 'Ombrel by Kestra', { sound: { id: '700000000011' } }), // on a TikTok chart at +22 h
    row('SB', 'sound', 'Vantle by Orrin', { sound: { id: '700000000012' } }), // off the chart, count up 3% in a day
    row('SC', 'sound', 'Pemble by Quorr', { sound: { id: '700000000013' } }), // off the chart, count up 0.5%
    row('SD', 'sound', 'Zarrow by Lume', { sound: { id: '700000000014' } }), // only the scoreboard's own Viral 50 read shows it
    row('SE', 'sound', 'Tibble by Arko', { sound: { id: '700000000015' } }), // charted, but ended at +10 h
    row('WA', 'word', 'Glorbo dance'), // a Roblox list still carries it at +21 h
    row('WB', 'word', 'Zibzab'), // a new board post at +21 h
    row('WC', 'word', 'Fennix trend'), // only a roundup carries it forward
    row('WD', 'word', 'Vexlo'), // people still type it at +30 h
    row('WE', 'word', 'Mornet challenge'), // a ranked item first seen only after +28 h
    row('WF', 'word', 'Quabble'), // headlines a day on: the story rule
    row('TA', 'talk', 'Velma Orrin feud'), // headlines a day on
    row('TB', 'talk', 'Tamsin Kell split'), // nothing a day on
    row('TC', 'talk', 'Brimvale lawsuit', {}), // a Roblox item of its title: a story is never judged by lists
  ].map((x, i) => ({ ...x, rank: i + 1 }));
  const trends = items.map((x) => ({ id: x.id, title: x.title, kind: x.kind, sub: x.sub, firstSeen: S - 24 * HOUR, ended: x.id === 'SE' ? T + 10 * HOUR : null,
    info: x.id === 'WB' ? { seen: { 'reddit:popculturechat': { first: T - 5 * HOUR, last: T + 21 * HOUR } } } : x.id === 'WC' ? { seen: { roundup: { first: T - 50 * HOUR, last: T + 25 * HOUR } } } : {} }));
  const samples = [
    ...items.map((x) => ({ id: x.id, t: T - HOUR, interest: 40 })),
    ...items.map((x) => ({ id: x.id, t: T + 22 * HOUR, interest: 5, n24: ['WF', 'TA'].includes(x.id) ? 2 : 0 })),
    { id: 'SB', t: T - HOUR, interest: 40, tt_videos: 100000 }, { id: 'SB', t: T + 23 * HOUR, interest: 5, n24: 0, tt_videos: 103000 },
    { id: 'SC', t: T - HOUR, interest: 40, tt_videos: 100000 }, { id: 'SC', t: T + 23 * HOUR, interest: 5, n24: 0, tt_videos: 100500 },
    { id: 'TB', t: T + 30 * HOUR, interest: 1 },
  ];
  const platform = [
    { source: 'tts', key: 'viral:700000000011', title: 'Ombrel', who: 'Kestra', data: { id: '700000000011' }, firstSeen: T - 48 * HOUR, lastSeen: T + 22 * HOUR },
    { source: 'tts', key: 'popular:700000000012', title: 'Vantle', who: 'Orrin', data: { id: '700000000012' }, firstSeen: T - 48 * HOUR, lastSeen: T + 10 * HOUR },
    { source: 'tts', key: 'viral:700000000013', title: 'Pemble', who: 'Quorr', data: { id: '700000000013' }, firstSeen: T - 48 * HOUR, lastSeen: T + 10 * HOUR },
    { source: 'tts', key: 'viral:700000000015', title: 'Tibble', who: 'Arko', data: { id: '700000000015' }, firstSeen: T - 48 * HOUR, lastSeen: T + 22 * HOUR },
    { source: 'roblox', key: '9100001', title: 'Glorbo Dance', data: { players: 9000 }, firstSeen: T - 30 * HOUR, lastSeen: T + 21 * HOUR },
    { source: 'roundup', key: 'later|fennix', title: 'Fennix', data: { page: 'later' }, firstSeen: T - 50 * HOUR, lastSeen: T + 25 * HOUR },
    { source: 'typed', key: 'means-genz|vexlo', title: 'what does vexlo mean gen z', who: 'what does vexlo mean gen z', data: { term: 'vexlo' }, firstSeen: T - 30 * HOUR, lastSeen: T + 30 * HOUR },
    { source: 'apps', key: 'top:9100002', title: 'Mornet Challenge', data: { rank: 3 }, firstSeen: T + 29 * HOUR, lastSeen: T + 30 * HOUR },
    { source: 'roblox', key: '9100003', title: 'Brimvale Lawsuit', data: { players: 500 }, firstSeen: T - 30 * HOUR, lastSeen: T + 21 * HOUR },
  ];
  const lists = [{ name: '2026-10-17-0900', t: T, items }];
  const state = F.writeState({ firstCycleAt: S - 3 * 24 * HOUR, trends, samples, lists, platform, noCount });
  return { state, items, lists };
}
const viral50 = { 700000000014: { firstRead: T - 30 * HOUR, lastRead: T + 41 * HOUR } };

test('live a day on, by kind: a sound on a chart or with a growing count, a word still ranked or newly used, a story as v3', () => {
  const { state, items } = world();
  const ours = readState(state, spec);
  try {
    const got = Object.fromEntries(items.map((x) => [x.id, MX.liveAfter(x, T, ours, spec, viral50)]));
    const v4 = Object.fromEntries(Object.entries(got).map(([id, r]) => [id, r.v4]));
    assert.deepEqual(v4, { SA: true, SB: true, SC: false, SD: true, SE: false, WA: true, WB: true, WC: false, WD: true, WE: false, WF: true, TA: true, TB: false, TC: false });
    assert.deepEqual(Object.entries(got).filter(([, r]) => r.v3).map(([id]) => id), ['WF', 'TA'], 'v3\'s rule, beside it: only the rows with headlines a day on');
    for (const [id, r] of Object.entries(got)) if (r.v3) assert.equal(r.v4, true, `${id}: every row live under v3 is live under v4`);
    assert.deepEqual([...new Set(Object.values(got).map((r) => r.group))].sort(), ['sound', 'story', 'word']);
    const p = MX.precisionOf([{ mark: '0900', t: T, items }], ours, T + 30 * HOUR, spec, viral50);
    const l = p.lists[0];
    assert.deepEqual({ rows: l.rows, live: l.live, liveV3: l.liveV3, kinds: l.kinds }, { rows: 14, live: 8, liveV3: 2,
      kinds: { story: { rows: 3, live: 1 }, sound: { rows: 5, live: 3 }, word: { rows: 6, live: 4 } } });
    assert.equal(l.gate, false, 'a short page still needs all but 2 of its rows live: 18 less the 6 it lacks');
    assert.equal(MX.liveAfter(items[0], T + 10 * HOUR, ours, spec, viral50), null, 'a list the state does not reach a day past is not judged');
  } finally { ours.close(); }
});

test('the gate is unchanged: 18 of 20 live under the kind-aware rule, and a sound or a word earns nothing it has not shown', () => {
  assert.equal(spec.version, 4);
  assert.deepEqual({ ...spec.precision.gate }, { liveMin: 18, duplicatesMax: 0, fadingMax: 3 });
  const live = spec.precision.live;
  assert.deepEqual({ from: live.fromHours, to: live.toHours, ended: live.notEndedHours, n24: live.n24Min, share: live.interestShare }, { from: 20, to: 28, ended: 24, n24: 1, share: 0.5 });
  assert.equal(live.kinds.sound.growthShareADay, 0.015);
  assert.ok(!live.kinds.word.rankedSources.includes('roundup') && !live.kinds.word.rankedSources.includes('reels') && !live.kinds.word.rankedSources.includes('wikt'),
    'a re-read article, digest or dictionary page is no ranking');
  for (const k of ['roundup', 'apps', 'games', 'wikt']) assert.ok(live.kinds.word.notPosts.includes(k), `${k}: carried forward by a list row, never a sighting of its own`);
});

test('a state older than the TikTok count column: counts read as none, the other evidence still judged', () => {
  const { state, items } = world({ noCount: true });
  const ours = readState(state, spec);
  try {
    assert.equal(MX.liveAfter(items[1], T, ours, spec, viral50).v4, false, 'no count: no growth');
    assert.equal(MX.liveAfter(items[0], T, ours, spec, viral50).v4, true, 'the chart still counts');
    assert.ok(ours.ranked.some((i) => i.source === 'typed' && i.title === 'vexlo'), 'a completion is listed by its term');
    assert.ok(!ours.ranked.some((i) => i.source === 'roundup'), 'only the ranking lists are read');
  } finally { ours.close(); }
});

test('X\'s scope: an entry of the top is kept only when the matcher joins it to a Google Trends entry in Google Trends\' scope, started near the snapshot', () => {
  const snapAt = S + 6 * HOUR;
  const gt = { 'velmor ashgrove|1': { title: 'velmor ashgrove', own: snapAt - 5 * HOUR, volume: 50000, categories: [4], related: [] },
    'brimfield hawks|2': { title: 'brimfield hawks', own: snapAt - 2 * HOUR, volume: 500000, categories: [17], related: [] },
    'quorra lune|3': { title: 'quorra lune', own: snapAt - 2 * HOUR, volume: 10000, categories: [4], related: [] },
    'tamsin kell|4': { title: 'tamsin kell', own: snapAt - 96 * HOUR, volume: 100000, categories: [4], related: [] },
    'zent arko tour|5': { title: 'zent arko tour', own: snapAt + 2 * HOUR, volume: 20000, categories: [2, 17], related: ['zentarko'] } };
  const names = ['Velmor Ashgrove', 'Brimfield Hawks', '#MondayZorp', 'Quorra Lune', 'Tamsin Kell', 'zentarko'];
  const history = { comparators: { gt: { entries: gt }, x: { entries: Object.fromEntries(names.map((n) => [n.toLowerCase(), { title: n }])), snapshots: [{ t: snapAt, keys: names.map((n) => n.toLowerCase()) }] } } };
  const byKey = new Map(names.map((n) => [n.toLowerCase(), { key: n.toLowerCase(), e: { title: n } }]));
  const k = MX.xClassed(history.comparators.x.snapshots[0], byKey, history, spec);
  assert.equal(k.top, 6);
  assert.equal(k.classed, 4, 'four joined to a Google Trends entry of the 72 h before to 24 h after (the 96 h old one and the hashtag Google Trends lacks are not)');
  assert.deepEqual(k.kept.map((r) => r.key), ['velmor ashgrove', 'zentarko'], 'in scope: an entertainment search and one Google Trends files under beauty as well as sports; never sports alone or under 20K');
  const scope = MX.scopeOf('x', [...byKey.values()], history, { start: S, end: S + 24 * HOUR }, spec);
  assert.deepEqual(scope.map((r) => [r.key, r.anchor]), [['velmor ashgrove', snapAt], ['zentarko', snapAt]]);
  const top20 = { ...history, comparators: { ...history.comparators, x: { ...history.comparators.x, snapshots: [{ t: snapAt, keys: [...Array.from({ length: 20 }, (_, i) => `filler ${i}`), 'velmor ashgrove'] }] } } };
  assert.equal(MX.xClassed(top20.comparators.x.snapshots[0], byKey, top20, spec).top, 0, 'only the top 20 are read: the 21st is never classed');
});
