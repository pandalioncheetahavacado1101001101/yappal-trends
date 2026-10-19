'use strict';
/*
 * The comparators' parsers (comparators.js) on invented replies, then on the replies recorded once on 2026-10-19 07:32Z (private,
 * never published: they are other sites' pages; those tests run on the owner's Mac only).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const C = require('../comparators');
const F = require('./fixture');

test('Google Trends: keyword, start, end, volume, categories, related searches; rows with no start are left out', () => {
  const text = F.gtReply([{ keyword: 'velmor arena', start: 1791800000, volume: 50000, categories: [4, 17], related: ['velmor arena', 'velmor arena tickets'] }]);
  const [e] = C.parseGt(text);
  assert.deepEqual(e, { key: 'velmor arena|1791800000', title: 'velmor arena', own: 1791800000, end: null, volume: 50000, categories: [4, 17], active: true, rank: 1, related: ['velmor arena', 'velmor arena tickets'] });
  assert.equal(C.parseGt('<html>a challenge page</html>'), null);
});

test('Know Your Meme: both feeds, one entry per address, the earlier date, confirmed first', () => {
  const a = F.rssReply([{ url: 'https://knowyourmeme.com/memes/zorp', title: 'Zorp', at: 1791800000 }]);
  const b = F.rssReply([{ url: 'https://knowyourmeme.com/memes/zorp/', title: 'Zorp', at: 1791700000 }, { url: 'https://knowyourmeme.com/memes/quib', title: 'Quib &amp; Co', at: 1791750000 }]);
  const out = C.parseKym(a, b);
  assert.deepEqual(out.map((e) => [e.key, e.title, e.own, e.feed]), [['https://knowyourmeme.com/memes/zorp', 'Zorp', 1791700000, 'confirmed'], ['https://knowyourmeme.com/memes/quib', 'Quib & Co', 1791750000, 'submitted']]);
  assert.equal(C.parseKym(null, '<html></html>'), null);
});

test('the Viral 50: rank, sound id, song and artist from the JSON-LD list, and the chart\'s own day', () => {
  const v = C.parseViral50(F.viralReply([{ title: 'Quillo', artist: 'Brin by Dle', id: '700000000001' }], 'October 9, 2026'));
  assert.equal(v.day, '2026-10-09');
  assert.deepEqual(v.rows, [{ key: '700000000001', title: 'Quillo by Brin', artist: 'Dle', rank: 1, own: null }]);
  assert.equal(C.parseViral50('<html>no list</html>'), null);
});

test('X via getdaytrends: the ranking across both tables, first occurrence of each rank', () => {
  const html = `${F.xReply(['Zent', '#BigNight'])}<table>${'<tr><th scope="row" class="pos">3</th><td class="main"><a href="/t/">Third One</a></td></tr>'}</table>`;
  assert.deepEqual(C.parseX(html).map((e) => [e.rank, e.title]), [[1, 'Zent'], [2, '#BigNight'], [3, 'Third One']]);
  assert.equal(C.parseX('<html>refused</html>'), null);
});

const REPLIES = path.join(__dirname, '..', 'private', 'replies');
const have = fs.existsSync(path.join(REPLIES, 'gt-us-168h.txt.gz'));
const saved = (f) => zlib.gunzipSync(fs.readFileSync(path.join(REPLIES, `${f}.gz`))).toString('utf8');
test('the replies recorded on 2026-10-19 parse whole', { skip: !have && 'saved replies absent (private: the owner\'s Mac only)' }, () => {
  const p = C.parseAll(Object.fromEntries(C.READS.map((r) => [r.file, saved(r.file)])));
  assert.ok(p.gt.length > 3000, `${p.gt.length} Google Trends entries in 168 hours`);
  assert.ok(p.gt.every((e) => Number.isFinite(e.own) && typeof e.title === 'string'));
  assert.ok(p.gt.filter((e) => e.categories.some((c) => [2, 4, 6, 8].includes(c)) && e.volume >= 20000).length > 100);
  assert.equal(p.kym.length, 32);
  assert.ok(p.kym.every((e) => Number.isFinite(e.own) && /^https:\/\/knowyourmeme\.com\/memes\//.test(e.key)));
  assert.equal(p.viral50.length, 50);
  assert.equal(p.viral50Day, '2026-10-19');
  assert.ok(p.x.length >= 45 && p.x[0].rank === 1, `${p.x.length} X trends`);
});
