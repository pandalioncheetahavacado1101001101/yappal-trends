'use strict';
/*
 * One engine build as rows: each entry of an audience's hot list with the card it came from (a talking point, a word, a moment), its
 * card key as the on-phone pipeline spells it (ios/IDEAS-FEED.md D2 `keys`), its natural key and the timed evidence the series reads.
 * Pure: no clock, no I/O.
 */
const HL = require('../engine/hot-list');
const TX = require('../engine/talk-extras');
const W = require('../engine/wording');
const { naturalKey } = require('./identity');
const { keyOf } = require('./util');

const STATUS = { rising: 'rising', peak: 'peaking', peaking: 'peaking', fading: 'fading' };
/** The engine's status as the feed spells it (an unknown one reads as peaking). */
const statusOf = (s) => STATUS[s] || 'peaking';

/** One audience's hot list as rows, in the engine's own order (its page rules already applied). */
function rowsOf(audience, { talkingPoints, hot }, { words, moments }) {
  const pointBy = new Map(talkingPoints.map((p) => [`point:${p.title}`, p]));
  const wordBy = new Map(words.map((w) => [`word:${w.term}`, w]));
  const momentBy = new Map(moments.map((m) => [`moment:${m.headline}`, m]));
  const out = [];
  hot.forEach((entry, i) => {
    const base = { audience, engineRank: i + 1, kind: entry.kind, title: entry.title, heat: entry.heat, engineStatus: statusOf(entry.status), drama: entry.drama === true };
    if (pointBy.has(entry.id)) {
      const p = pointBy.get(entry.id);
      const meta = p.meta || {};
      const wordish = HL.wordLike(p);
      const moment = wordish ? null : HL.toldMoment(p, moments);
      const word = wordish ? words.find((w) => keyOf(w.term) === keyOf(p.subject || '')) || null : null;
      out.push({ ...base, type: 'point', cardKey: `point:${p.title}`, point: p, word, moment, meta, wordish, line: p.what || null, subject: wordish ? p.subject : meta.subject || p.subject || '',
        surface: meta.surface || p.subject || null, family: wordish ? null : meta.family || null, noun: p.noun || null, tier: wordish ? null : p.tier || 'other',
        natural: naturalKey(wordish ? { kind: entry.kind, term: p.subject || p.title } : { kind: 'talk', subject: meta.subject || p.subject, family: meta.family, noun: p.noun, title: p.title }),
        heads: (meta.own || []).filter((r) => r.title).map((r) => keyOf(r.title)).slice(-40) });
    } else if (wordBy.has(entry.id)) {
      const w = wordBy.get(entry.id);
      out.push({ ...base, type: 'word', cardKey: `word:${w.term}`, word: w, meta: w.meta || {}, wordish: true, line: entry.line || TX.plainLine(null, w.meaning) || null, subject: w.term, surface: w.term,
        family: null, noun: null, tier: null, natural: naturalKey({ kind: entry.kind, term: w.term }), heads: [] });
    } else if (momentBy.has(entry.id)) {
      const m = momentBy.get(entry.id);
      const meta = m.meta || {};
      // (the app's card key for a story is its lead moment's headline as the pipeline wrote it)
      out.push({ ...base, type: 'moment', cardKey: `story:${m.headline}`, moment: m, meta, wordish: false, line: momentLine(m), subject: m.subject || '', surface: m.subject || null, family: null,
        noun: null, tier: null, natural: naturalKey({ kind: 'moment', headline: m.headline }), heads: (meta.own || []).filter((r) => r.title).map((r) => keyOf(r.title)).slice(-40) });
    }
  });
  return out;
}

const CUT_SUFFIXES = ['ing', 'ed', 'es', 'ion', 'ions', 'ment', 'ments', 'ly', 'er', 'ers', 'ation', 'ations'];
const CUT_MIN_WORDS = 5;
const DANGLING = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'and', 'or', 'by', 'from', 'as', 'after', 'over', 'about', 'into', 'her', 'his', 'their', 'its']);
/** A word its feed cut short: no dictionary word, but a dictionary word and the start of an ending ("hinderin": hinder + in(g)). */
function isCutWord(word) {
  const w = String(word || '');
  if (!/^\p{Ll}{4,}$/u.test(w) || W.inDict(w)) return false;
  return [1, 2, 3, 4].some((n) => { const base = w.slice(0, -n); const tail = w.slice(-n); return base.length >= 3 && W.inDict(base) && CUT_SUFFIXES.some((s) => s.length > n && s.startsWith(tail)); });
}
/**
 * A sentence without the tail a feed cut mid-word ("..., charged for hinderin"): back to where the cut word's clause began, else
 * without the cut word and what dangles before it; null when too little is left to say anything.
 */
function dropCutTail(sentence) {
  const s = String(sentence || '').replace(/[.…\s]+$/, '');
  const ws = s.split(/\s+/);
  if (!isCutWord(ws[ws.length - 1])) return sentence;
  const clause = Math.max(s.lastIndexOf(', '), s.lastIndexOf('; '), s.lastIndexOf(': '), s.lastIndexOf(' - '), s.lastIndexOf(' – '), s.lastIndexOf(' — '));
  let kept = clause > 0 ? s.slice(0, clause).split(/\s+/) : ws.slice(0, -1);
  while (kept.length && DANGLING.has(kept[kept.length - 1].toLowerCase())) kept = kept.slice(0, -1);
  return kept.length >= CUT_MIN_WORDS ? `${kept.join(' ')}.` : null;
}

/** A moment's one line: why it is blowing up, else the story behind it, else the clip (each a sentence the pipeline already vetted). */
function momentLine(m) {
  const text = m.why || m.story || m.moment || null;
  if (!text) return null;
  const first = (text.match(/^.*?[.!?](?=\s|$)/) || [text])[0].trim();
  return dropCutTail(/[.!?]['’"”]?$/.test(first) ? first : `${first}.`);
}

module.exports = { rowsOf, momentLine, statusOf, isCutWord, dropCutTail };
