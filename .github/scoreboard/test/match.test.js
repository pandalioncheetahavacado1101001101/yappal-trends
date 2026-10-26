'use strict';
/*
 * The frozen matcher (match.js, scoreboard-spec.json "matcher"). Every name and story here is invented: the programme's gates that
 * name a real story live with the hand-checked audit in the private, never-published folder, and run in the last test, on the
 * owner's Mac only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../match');
const spec = require('../scoreboard-spec.json');

const HOUR = 3600;
const row = (over) => ({ id: over.id || 'a', kind: 'talk', sub: 'drama', titles: [], aliases: [], people: [], tags: [], subject: null, listed: 1000 * HOUR, ...over });
const one = (rows, entry, comparator = 'gt') => M.matchEntry(entry, comparator, M.prepareOurs(rows, spec));

test('a place\'s shooting joins our row on the same shooting: "velmor shooting" and "Velmor school shooting" (title cores overlap 2 of 3)', () => {
  const hit = one([row({ titles: ['Velmor school shooting'], kind: 'talk', sub: 'story' })], { title: 'velmor shooting' });
  assert.deepEqual(hit, { id: 'a', how: 'jaccard', score: 0.667 });
});

test('a sound is matched only by a chart of sounds: "Velma Orrin by Quorra" is never the actress', () => {
  const rows = [row({ id: 's', kind: 'sound', sub: 'sound', titles: ['Velma Orrin by QUÖRRA'], aliases: ['word|velma orrin by quorra'] })];
  assert.equal(one(rows, { title: 'velma orrin' }), null);
  assert.equal(one(rows, { title: 'velma orrin quorra' }), null);
  assert.deepEqual(one(rows, { title: 'Velma Orrin', artist: 'QUÖRRA' }, 'viral50'), { id: 's', how: 'alias', score: 1 });
  // (the same song by another artist is another sound)
  assert.equal(one(rows, { title: 'Velma Orrin', artist: 'Somebody Else' }, 'viral50'), null);
  // (and a chart of sounds never matches a story)
  assert.equal(one([row({ titles: ['Velma Orrin feud'] })], { title: 'Velma Orrin', artist: 'QUÖRRA' }, 'viral50'), null);
});

test('folding: case, accents, possessives, "&", hashtags in camel case, singulars; our framing words carry no weight', () => {
  assert.equal(M.fold("Orrin's Clubhouse & Friends"), 'orrin clubhouse and friends');
  assert.equal(M.fold('#VelmorGrandGala'), 'velmor grand gala');
  assert.equal(M.fold('Zélie Café'), 'zelie cafe');
  assert.deepEqual([...M.coreOf('The Shootings at the Velmors', spec.matcher)], ['shooting', 'velmor']);
  assert.deepEqual([...M.coreOf('Boss status crisis', spec.matcher)], ['boss', 'status', 'crisis']);
  assert.deepEqual(one([row({ kind: 'word', sub: 'meme', titles: ['Glorptastic meme'] })], { title: 'Glorptastic' }, 'kym'), { id: 'a', how: 'jaccard', score: 1 });
});

test('below the threshold nothing joins: one shared word of four is no match', () => {
  assert.equal(one([row({ titles: ['Velmor Quist trailer reaction'] })], { title: 'velmor arena' }), null);
  assert.equal(one([row({ titles: ['Brimvale Ostrander movie trailer'] })], { title: 'brimvale ostrander' }), null, 'two of four is 0.5: no match (frozen; recall is given up for precision)');
});

test('person: only for a row about the person (the name and at most two more words), and only a name of two words or a handle', () => {
  const people = [{ name: 'Velma Orrin' }];
  const related = ['velma orrin trial'];
  assert.deepEqual(one([row({ titles: ['Velma Orrin court date set'], people })], { title: 'velma orrin', related: ['velma orrin court'] }), null,
    'a headline that opens with a name is not about the person: no person join, and 2 of 5 words is no jaccard');
  assert.deepEqual(one([row({ titles: ['Velma Orrin trial delay'], people })], { title: 'velma orrin', related }), { id: 'a', how: 'person', score: 1 });
  assert.equal(one([row({ titles: ['Brimvale allegations'], people: [{ name: 'Brimvale' }] })], { title: 'brimvale', related: ['brimvale allegations'] }), null, 'a one-word name never joins on its own');
  assert.deepEqual(one([row({ titles: ['Zap2Zork ban'], people: [{ name: 'Zap2Zork' }] })], { title: 'zap2zork', related: ['zap2zork ban'] }), { id: 'a', how: 'person', score: 1 }, 'a handle may');
  assert.ok(M.joinableName('ZapZork', spec.matcher) && !M.joinableName('Zapzork', spec.matcher) && M.joinableName('Two Words', spec.matcher));
});

test('a bare name holds only when corroborated: related searches that share a word with the row, or a surface near our first listing', () => {
  const listed = 500 * HOUR;
  const rows = [row({ titles: ['Velma Orrin split'], people: [{ name: 'Velma Orrin' }], tags: ['dorian vell'], listed })];
  // a name trending for some other reason, days after we listed her split, with nothing in its searches about it
  assert.equal(one(rows, { title: 'velma orrin', related: ['velma orrin'], t: listed + 6 * 24 * HOUR }), null);
  assert.equal(one(rows, { title: 'velma orrin', related: ['velma orrin new film'], t: listed + 6 * 24 * HOUR }), null);
  // corroborated by a search about the split, or by another person the row names
  assert.deepEqual(one(rows, { title: 'velma orrin', related: ['velma orrin divorce', 'velma orrin split'], t: listed + 6 * 24 * HOUR }), { id: 'a', how: 'person', score: 1 });
  assert.deepEqual(one(rows, { title: 'velma orrin', related: ['dorian vell'], t: listed + 6 * 24 * HOUR }), { id: 'a', how: 'person', score: 1 });
  // or by time: surfaced from 24 h before to 48 h after our first listing
  assert.deepEqual(one(rows, { title: 'velma orrin', related: [], t: listed + 47 * HOUR }), { id: 'a', how: 'person', score: 1 });
  assert.deepEqual(one(rows, { title: 'velma orrin', related: [], t: listed - 23 * HOUR }), { id: 'a', how: 'person', score: 1 });
  assert.equal(one(rows, { title: 'velma orrin', related: [], t: listed - 25 * HOUR }), null);
  // (not a bare name: "velma orrin divorce" joins by its own words, near our listing or corroborated)
  const alias = [row({ titles: ['Velma Orrin split'], aliases: ['point:Velma Orrin divorce'], people: [{ name: 'Velma Orrin' }], listed })];
  assert.deepEqual(one(alias, { title: 'velma orrin divorce', t: listed + 30 * HOUR }), { id: 'a', how: 'alias', score: 1 });
  assert.deepEqual(one(alias, { title: 'velma orrin divorce', related: ['velma orrin split'], t: listed + 6 * 24 * HOUR }), { id: 'a', how: 'alias', score: 1 });
});

test('stopwords and framing words around a name leave it a bare name: "velma orrin now", "where is velma orrin from", "velma orrin news" are corroborated or refused', () => {
  const listed = 500 * HOUR;
  const rows = [row({ titles: ['Velma Orrin backlash'], people: [{ name: 'Velma Orrin' }], listed })];
  const late = listed + 5 * 24 * HOUR;
  for (const title of ['velma orrin', 'where is velma orrin from', 'velma orrin now', 'velma orrin news', 'Velma Orrin!']) {
    assert.equal(one(rows, { title, related: [title], t: late }), null, `"${title}" five days after we listed her backlash, nothing about it in its searches`);
    assert.ok(one(rows, { title, related: [title], t: listed + 20 * HOUR }), `"${title}" the day we listed it (corroborated by time)`);
  }
  // (a related search that adds a word of the row corroborates; "backlash" is framing, so it is no word of the row)
  const withTag = [row({ titles: ['Velma Orrin backlash'], people: [{ name: 'Velma Orrin' }], tags: ['perfume ad'], listed })];
  assert.deepEqual(one(withTag, { title: 'velma orrin now', related: ['velma orrin perfume ad'], t: late }), { id: 'a', how: 'jaccard', score: 1 });
  // (the subject is a name too)
  assert.equal(one([row({ titles: ['Velmor Arena collapse'], subject: 'Velmor Arena', listed })], { title: 'velmor arena latest', related: [], t: late }), null);
  assert.ok(M.isBareName(M.prepareOurs(rows, spec).rows[0], M.fold('where is velma orrin from'), M.coreOf('where is velma orrin from', spec.matcher)));
});

test('a long lead needs related searches that corroborate it: a join more than 48 h after our first listing, on Google Trends', () => {
  const listed = 500 * HOUR;
  const rows = [row({ titles: ['Quorra Bellwind lawsuit filed'], tags: ['label dispute'], listed })];
  const entry = { title: 'quorra bellwind lawsuit', t: listed + 4 * 24 * HOUR };
  assert.equal(one(rows, { ...entry, related: ['quorra bellwind lawsuit'] }), null, 'four days on, its searches say nothing the row says beyond its own words');
  assert.deepEqual(one(rows, { ...entry, related: ['quorra bellwind label dispute'] }), { id: 'a', how: 'jaccard', score: 0.75 });
  assert.deepEqual(one(rows, { ...entry, related: [], t: listed + 47 * HOUR }), { id: 'a', how: 'jaccard', score: 0.75 }, 'within 48 h of our listing it needs nothing');
  assert.deepEqual(one(rows, { ...entry, related: [], t: listed - 3 * 24 * HOUR }), { id: 'a', how: 'jaccard', score: 0.75 }, 'an entry before our listing credits no lead');
  // (comparators that give no related searches are not held to it)
  assert.deepEqual(one([row({ kind: 'word', sub: 'meme', titles: ['Glorptastic meme'], listed })], { title: 'Glorptastic', t: listed + 5 * 24 * HOUR }, 'kym'), { id: 'a', how: 'jaccard', score: 1 });
});

test('the best candidate wins: the stronger step, then the higher score, then the earlier listing', () => {
  const rows = [row({ id: 'late', titles: ['Brimvale Ostrander feud'], listed: 900 * HOUR }), row({ id: 'early', titles: ['Brimvale Ostrander feud'], listed: 800 * HOUR }),
    row({ id: 'alias', titles: ['Brimvale arena'], aliases: ['point:Brimvale Ostrander'] })];
  assert.equal(one(rows, { title: 'brimvale ostrander' }).id, 'alias');
  assert.equal(one(rows.slice(0, 2), { title: 'brimvale ostrander' }).id, 'early');
  assert.equal(one(rows.slice(0, 2), { title: 'brimvale ostrander feud night' }).score, 0.75);
});

test('matchAll keeps the entries\' order and only the ones that matched', () => {
  const index = M.prepareOurs([row({ titles: ['Quorra Bellwind lawsuit'] })], spec);
  assert.deepEqual(M.matchAll([{ key: 'x', title: 'unrelated thing' }, { key: 'y', title: 'quorra bellwind lawsuit' }], 'gt', index), [{ key: 'y', id: 'a', how: 'alias', score: 1 }]);
});

// ---------- the hand-checked audit (private inputs; runs on the owner's Mac only) ----------
const PRIVATE = path.join(__dirname, '..', 'private');
const haveAudit = fs.existsSync(path.join(PRIVATE, 'audit', 'pairs-checked.json'));
test('the hand-checked audit: the matcher makes exactly the checked Google Trends pairs, 36 or more, at most 3 not the same story, and the private gates hold', { skip: !haveAudit && 'private audit inputs absent (they never leave the owner\'s Mac)' }, () => {
  const { auditPairs, auditCounts } = require('../audit');
  const labelled = JSON.parse(fs.readFileSync(path.join(PRIVATE, 'audit', 'pairs-checked.json'), 'utf8'));
  const checked = labelled.pairs;
  const made = auditPairs(PRIVATE, spec);
  const key = (p) => `${p.set}|${p.gt}|${p.gtStart}|${p.ours}`;
  assert.deepEqual(made.map(key).sort(), checked.map(key).sort(), 'a matcher that makes other pairs needs a new hand-check (and, as match.js is hashed, restarts the clock)');
  assert.ok(checked.length >= spec.matcher.audit.pairs);
  const wrong = checked.filter((p) => !p.same).length;
  assert.ok(wrong <= spec.matcher.audit.falseMax, `${wrong} false matches`);
  // (the gates that name a real story: counts only here)
  const gates = JSON.parse(fs.readFileSync(path.join(PRIVATE, 'audit', 'gates.json'), 'utf8')).pairs;
  assert.ok(gates.length > 0, 'the private gates are listed');
  const held = gates.filter((g) => checked.some((p) => p.set === g.set && p.gt === g.gt && p.ours === g.ours && p.same) && made.some((p) => p.set === g.set && p.gt === g.gt && p.ours === g.ours));
  assert.equal(held.length, gates.length, `${gates.length - held.length} of ${gates.length} private gates not made or not the same story`);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'audit-result.json'), 'utf8')), auditCounts(labelled),
    'audit-result.json is the labelled audit\'s counts (node .github/scoreboard/audit.js --record)');
});

test('alternates: a Know Your Meme entry titled two ways is matched whole and as each name; Google Trends titles are never split', () => {
  const rows = [row({ id: 'f', kind: 'word', sub: 'meme', titles: ['Glorp face meme'] }), row({ id: 'k', titles: ['Velma Orrin cheating allegations'], people: [{ name: 'Velma Orrin' }] })];
  // (whole, neither name joins: "zib zab staring glorp face" against "glorp face" is 2 of 5)
  assert.deepEqual(one(rows, { title: 'Zib Zab Staring / Glorp Face Meme' }, 'kym'), { id: 'f', how: 'alias', score: 1 });
  assert.deepEqual(one(rows, { title: 'Velma Orrin Cheating Controversy / Quorra Affair Scandal' }, 'kym'), { id: 'k', how: 'jaccard', score: 0.75 });
  assert.equal(one(rows, { title: 'Zib Zab Staring / Glorp Face Meme' }, 'gt'), null, 'only the comparators the spec names');
  assert.equal(one(rows, { title: 'Zib Zab / Quorra' }, 'kym'), null, 'no name of it joins: nothing');
});
