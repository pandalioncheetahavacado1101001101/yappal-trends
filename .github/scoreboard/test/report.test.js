'use strict';
/*
 * What may be published (report.js), the spec and the scoring code as registered, the pools, the statistics, and the workflow's shape:
 * restore-only state, its own concurrency group, no artifact, no "state-" save, its own history key holding no pair.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../report');
const S = require('../stats');
const H = require('../history');
const spec = require('../scoreboard-spec.json');

// The spec and the scoring code as registered on 2026-10-27 (spec version 4: precision's live is kind-aware, a sound by a TikTok
// chart or its growing count, a word by a ranking list or a new sighting of its own, a story as before, with v3's rule published
// beside it as liveV3; X's scope is its top 20 as Google Trends classes them. Version 3 was 4b9feb14a703 and never scored a day;
// version 2 was e59adec9a786). A change to any value of the spec or any line of
// comparators, history, match, metrics, ours, report or stats .js changes this hash and restarts the 14-day clock (ios/IDEAS-SUPER.md
// 1): update it here only on purpose, with the reason in the commit.
const REGISTERED = '012e34e60c54';

test('the spec and the scoring code are the ones registered: the hash, the minimum n, the matcher threshold, the list depth, the scoring lag', () => {
  assert.equal(R.specHash(spec, R.scoringCode()), REGISTERED);
  assert.equal(spec.version, 4);
  assert.equal(spec.minN, 15);
  assert.equal(spec.matcher.jaccardMin, 0.6);
  assert.equal(spec.ours.listDepth, 80);
  assert.equal(spec.matcher.audit.pairs, 36);
  assert.equal(spec.matcher.audit.falseMax, 3);
  assert.equal(spec.publish.daysKept, 60);
  for (const c of ['gt', 'kym', 'viral50', 'x']) assert.ok(spec.comparators[c].depth && spec.comparators[c].scope, `${c}: scope and depth registered`);
});

test('the published hash covers the spec and every file whose code computes a number: a change to any of them changes it', () => {
  const code = R.scoringCode();
  assert.deepEqual(R.SCORING_FILES, ['comparators.js', 'history.js', 'match.js', 'metrics.js', 'ours.js', 'report.js', 'stats.js']);
  for (const f of ['comparators.js', 'match.js', 'metrics.js', 'ours.js', 'stats.js', 'report.js', 'history.js']) {
    assert.notEqual(R.specHash(spec, { ...code, [f]: `${code[f]}\n` }), REGISTERED, `${f}: one more line, another hash`);
  }
  assert.notEqual(R.specHash({ ...spec, minN: 16 }, code), REGISTERED);
  assert.notEqual(R.specHash(spec, { ...code, 'match.js': code['metrics.js'], 'metrics.js': code['match.js'] }), REGISTERED, 'each file\'s text is hashed with its name');
  assert.throws(() => R.specHash(spec), /every scoring file/);
  assert.throws(() => R.specHash(spec, { ...code, 'ours.js': undefined }), /every scoring file/);
  // (run.js publishes that hash, read from the files beside it)
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'run.js'), 'utf8'), /R\.specHash\(spec, R\.scoringCode\(__dirname\)\)/);
});

test('the guard: numbers, booleans, null, fixed words, instants, days, list marks and the hash pass; a title or an unknown key never does', () => {
  const ok = { day: '2026-10-17', spec: 'c71b812b5c8b', at: '2026-10-19T06:21:00Z', lead: { gt: { n: 3, medianHours: null, status: 'insufficient', ci: [1.5, 2] } }, precision: { lists: [{ mark: '0900', gate: false }] } };
  assert.equal(R.assertAggregate(ok), ok);
  assert.throws(() => R.assertAggregate({ day: 'Velmor school shooting' }), /free string/);
  assert.throws(() => R.assertAggregate({ lead: { 'velmor arena': 3 } }), /unknown key/);
  assert.throws(() => R.assertAggregate({ pairs: [] }), /unknown key/);
  assert.throws(() => R.assertAggregate({ n: Infinity }), /finite/);
  assert.throws(() => R.assertAggregate({ status: 'https://knowyourmeme.com/memes/zorp' }), /free string/);
});

test('the matcher\'s audited false-match rate: counts only, published with latest.json; anything else is left out', () => {
  assert.deepEqual(R.auditOf({ day: '2026-10-19', pairs: 42, wrong: 3 }), { day: '2026-10-19', audited: 42, wrong: 3, rate: 0.071 });
  for (const bad of [null, { day: 'today', pairs: 42, wrong: 3 }, { day: '2026-10-19', pairs: 0, wrong: 0 }, { day: '2026-10-19', pairs: 4, wrong: 5 }, { day: '2026-10-19', pairs: '42', wrong: 3 }]) {
    assert.equal(R.auditOf(bad), null);
  }
  const published = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'audit-result.json'), 'utf8'));
  assert.deepEqual(Object.keys(published).sort(), ['day', 'pairs', 'wrong'], 'the published audit is a day and two counts, nothing per pair');
  assert.ok(published.pairs >= spec.matcher.audit.pairs && published.wrong <= spec.matcher.audit.falseMax);
});

const line = (day, meets, hash = REGISTERED) => ({ day, spec: hash, at: `${day}T06:21:00Z`, meets: { lead: meets, breadth: meets, precision: meets } });
test('days.jsonl: lines that do not pass are dropped, a day is replaced not repeated, 60 days kept', () => {
  const text = [JSON.stringify(line('2026-10-01', true)), '{"day":"2026-10-02","title":"leak"}', 'not json', JSON.stringify(line('2026-10-03', false))].join('\n');
  assert.deepEqual(R.readDays(text).map((l) => l.day), ['2026-10-01', '2026-10-03']);
  const lines = R.withLine(R.readDays(text), line('2026-10-03', true), spec);
  assert.deepEqual(lines.map((l) => [l.day, l.meets.lead]), [['2026-10-01', true], ['2026-10-03', true]]);
  let many = [];
  for (let i = 0; i < 70; i++) many = R.withLine(many, line(S.addDays('2026-08-01', i), true), spec);
  assert.equal(many.length, 60);
  assert.equal(many[0].day, S.addDays('2026-08-01', 10));
});

test('the claim\'s run: consecutive calendar days, one spec hash, lead, breadth and precision all met', () => {
  const days = Array.from({ length: 16 }, (_, i) => line(S.addDays('2026-11-01', i), true));
  assert.equal(R.claimRun(days, REGISTERED), 16);
  assert.equal(R.claimRun([...days.slice(0, 15), line(S.addDays('2026-11-01', 15), false)], REGISTERED), 0);
  assert.equal(R.claimRun([...days.slice(0, 7), ...days.slice(8)], REGISTERED), 8, 'a missing day breaks the run');
  assert.equal(R.claimRun(days.map((l, i) => (i < 10 ? { ...l, spec: '000000000000' } : l)), REGISTERED), 6, 'a spec change restarts it');
});

test('lead pooled over 7 days: "insufficient" under 15, then the median and share first with a seeded bootstrap interval', () => {
  const values = (n, h, o = 'first') => Array.from({ length: n }, () => ({ h, o }));
  let h = H.empty();
  h = H.withDay(h, '2026-10-10', { spec: REGISTERED, lead: { gt: values(7, 3) } });
  h = H.withDay(h, '2026-10-11', { spec: REGISTERED, lead: { gt: values(7, -1, 'late') } });
  assert.equal(R.pooledLead(h, '2026-10-11', REGISTERED, 'gt', spec).status, 'insufficient');
  h = H.withDay(h, '2026-10-12', { spec: REGISTERED, lead: { gt: [...values(2, 6), { h: 0, o: 'tie' }] } });
  h = H.withDay(h, '2026-10-02', { spec: REGISTERED, lead: { gt: values(30, 9) } }); // (outside the 7 days)
  h = H.withDay(h, '2026-10-09', { spec: 'ffffffffffff', lead: { gt: values(30, 9) } }); // (another spec)
  const p = R.pooledLead(h, '2026-10-12', REGISTERED, 'gt', spec);
  assert.equal(p.n, 17); assert.equal(p.medianHours, 3); assert.equal(p.shareFirst, 0.529); assert.equal(p.status, 'ok');
  assert.deepEqual(p, R.pooledLead(h, '2026-10-12', REGISTERED, 'gt', spec), 'the same day gives the same interval');
  assert.ok(p.ci[0] <= 3 && p.ci[1] >= 3 && p.shareFirstCi[0] < 0.529 && p.shareFirstCi[1] > 0.529);
});

test('breadth pooled over 7 days, same spec only: "insufficient" under 15 Google Trends starts, and only the pool meets the target', () => {
  let h = H.empty();
  h = H.withDay(h, '2026-10-10', { spec: REGISTERED, lead: {}, breadth: { stories: 23, gtStarts: 10 } });
  assert.deepEqual(R.pooledBreadth(h, '2026-10-10', REGISTERED, spec), { days: 1, stories: 23, gtStarts: 10, ratio: null, status: 'insufficient' }, 'one thin day is never a ratio');
  h = H.withDay(h, '2026-10-11', { spec: REGISTERED, lead: {}, breadth: { stories: 9, gtStarts: 12 } });
  h = H.withDay(h, '2026-10-12', { spec: REGISTERED, lead: {}, breadth: null });
  h = H.withDay(h, '2026-10-03', { spec: REGISTERED, lead: {}, breadth: { stories: 90, gtStarts: 10 } }); // (outside the 7 days)
  h = H.withDay(h, '2026-10-09', { spec: 'ffffffffffff', lead: {}, breadth: { stories: 90, gtStarts: 10 } }); // (another spec)
  assert.deepEqual(R.pooledBreadth(h, '2026-10-12', REGISTERED, spec), { days: 2, stories: 32, gtStarts: 22, ratio: 1.45, status: 'ok' });
  const day = (ratio, pooled) => ({ coverage: {}, breadth: { ratio, pooled }, precision: { gate: true }, speed: {}, pooled: {} });
  assert.equal(R.meetsOf(day(9, { ratio: 1.45, status: 'ok' }), spec).breadth, false, 'a high day does not meet the target');
  assert.equal(R.meetsOf(day(null, { ratio: 3.1, status: 'ok' }), spec).breadth, true, 'the pool does');
  assert.equal(R.meetsOf(day(null, { ratio: null, status: 'insufficient' }), spec).breadth, false);
});

test('coverage under 15 scope entries is "insufficient" in the rolling window too, and never meets its target', () => {
  const l = (n, covered, first) => ({ day: '2026-10-17', spec: REGISTERED, lead: {}, coverage: { gt: { n, covered, first, share: null, firstShare: null, status: 'insufficient' } },
    breadth: { status: 'nolists' }, precision: { lists: [], gate: null }, speed: { status: 'noledger' }, pooled: {}, meets: {} });
  const latest = R.latestOf({ lines: [l(4, 0, 0)], history: H.empty(), hash: REGISTERED, at: '2026-10-19T06:21:00Z', spec });
  assert.deepEqual({ ...latest.rolling.coverage.gt }, { days: 1, n: 4, covered: 0, first: 0, share: null, firstShare: null, status: 'insufficient', stages: { listedLate: null, outside: null, notListed: null, readOnly: null, unseen: null } });
  assert.equal(latest.rolling.breadth.status, 'insufficient');
  assert.equal(R.meetsOf({ ...l(4, 4, 4), breadth: {} }, spec).coverage.gt, false);
});

test('statistics: quantiles, days, the seeded generator', () => {
  assert.equal(S.median([3, 1, 2]), 2); assert.equal(S.median([1, 2, 3, 4]), 2.5); assert.equal(S.quantile([], 0.5), null);
  assert.equal(S.addDays('2026-10-31', 1), '2026-11-01');
  const a = S.rng(7); const b = S.rng(7);
  assert.equal(a(), b());
});

test('the history keeps what the spec says and drops the rest', () => {
  const now = Date.parse('2026-10-20T06:20:00Z') / 1000;
  let h = H.mergeRead(H.empty(), { gt: [{ key: 'a|1', title: 'a', own: now - 20 * 86400, volume: 1, categories: [] }, { key: 'b|2', title: 'b', own: now - 86400, volume: 1, categories: [] }] },
    { gt: 'ok', kym: 'refused', viral50: 'refused', x: 'refused' }, now - 12 * 86400, spec);
  h = H.mergeRead(h, { gt: [{ key: 'b|2', title: 'b', own: now - 86400, volume: 1, categories: [] }] }, { gt: 'ok' }, now, spec);
  h = H.withDay(h, '2026-09-01', { spec: REGISTERED, lead: {} });
  const p = H.prune(h, now, spec);
  assert.deepEqual(Object.keys(p.comparators.gt.entries), ['b|2']);
  assert.equal(p.comparators.gt.entries['b|2'].firstRead, now - 12 * 86400);
  assert.deepEqual(Object.keys(p.days), []);
});

test('scoreboard.yml: 06:20Z, its own group, the state restored read only, its own history key, no artifact, no "state-" save', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '..', 'workflows', 'scoreboard.yml'), 'utf8');
  const code = yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(code, /cron: '20 6 \* \* \*'/);
  assert.match(code, /concurrency:\s*\n\s*group: scoreboard\s*\n\s*cancel-in-progress: false/);
  assert.match(code, /path: state\s*\n\s*key: scoreboard-reads-state-\$\{\{ github\.run_id \}\}\s*\n\s*restore-keys: state-/);
  assert.ok(!/actions\/cache@/.test(code), 'actions/cache (which saves at the end) is never used: restore and save are separate');
  const saves = [...code.matchAll(/uses: actions\/cache\/save@v4\s*\n\s*with:\s*\n\s*path: (\S+)\s*\n\s*key: (\S+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(saves, [['sbcache', 'scoreboard-history-${{']], 'the only cache saved is the scoreboard\'s own history');
  assert.match(code, /path: sbcache\s*\n\s*key: scoreboard-history-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\s*\n\s*restore-keys: scoreboard-history-\n/);
  assert.ok(!/pairs/.test(code), 'no key or file named for pairs: none are kept');
  assert.ok(!/upload-artifact|actions\/upload/.test(code), 'no artifact');
  assert.ok(!/state\/|--state state[^\s]/.test(code.replace('--state state --cache', '')), 'the state folder is only handed to run.js');
  assert.ok(!/git push[^\n]*feed/.test(code), 'never the feed branch');
});

test('the branch script publishes only the two files, after the guard, and deletes only its own cache prefix', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'branches.sh'), 'utf8');
  assert.match(sh, /report\.js" --check sbout\/latest\.json sbout\/days\.jsonl/);
  assert.match(sh, /git add latest\.json days\.jsonl/);
  assert.match(sh, /git push -q -f "\$REMOTE" scoreboard/);
  assert.match(sh, /PREFIX="scoreboard-history-"/);
  assert.equal(spec.cache.keyPrefix, 'scoreboard-history-');
  assert.ok(!/state-|editor-model/.test(sh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')), 'no other key is named, so none can be deleted');
});
