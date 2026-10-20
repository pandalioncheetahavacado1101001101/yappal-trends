'use strict';
/*
 * Which dictionary sense a word row means (ios/IDEAS-SUPER.md P9; B8 in ios/.review/datasets-knowledge.md): a rule with no fitted
 * numbers, as the Wiktionary study found it (data/knowledge/wiktionary.md, P4).
 *
 *   1. candidates: the word's senses in dictionary order, then the slang senses of its lemma ("glazing" -> glaze)
 *   2. a usage note is no sense ("Used other than figuratively or idiomatically"), nor a sense in a trade's vocabulary
 *      ("automotive": "Having a vehicle's height reduced ..."); a name only when nothing else is left
 *   3. with a slang, Internet or neologism sense left: the one nearest what people search, +0.1 for a sense first seen in 2010
 *      or later. Nearness has no model here (collect has none since P11): the share of the searches' telling words the sense also
 *      uses. Most searches tell nothing but the word ("what does chopped mean slang"); then the newest slang sense leads, and on a
 *      tie, the dictionary's order.
 *   4. with none: abstain when the searches ask for slang (the plain sense is not what they mean); else the first sense
 *   5. a sense the dictionary marks offensive, vulgar or derogatory is weighed as any other and shown with that label
 *      (lib/sense/register.js): no content filtering. A sense the file somehow holds no words for is never swapped for the next
 *      one down (the wrong sense): the row keeps the line it came with
 *
 * No cosine floor: the study found the best wrong sense clears any floor the right one clears.
 */
const T = require('./text');

const STRONG = new Set(['slang', 'Internet', 'neologism']);
const RECENT_YEAR = 2010;
const RECENT_BONUS = 0.1;
// a sense that is a usage note or a pointer, not a meaning (engine/words-answers.js keeps the same list for the live reads)
const USAGE_NOTE = /^(?:used other than\b|used (?:literally|attributively|in phrases)\b|only used in\b|see\b|in phrases\b)/i;
// a label that puts a sense in a trade's own vocabulary, whatever else it says ("automotive, slang"): not the word people are saying
const TRADE = /\b(?:automotive|vehicles?|motor(?:ing|sport)?|finance|financial|banking|economics|law|legal|medicine|medical|pathology|anatomy|pharmacology|chemistry|physics|mathematics|geometry|statistics|computing|programming|engineering|electronics|electrical|mechanics|nautical|aviation|aeronautics|military|botany|zoology|biology|biochemistry|genetics|genomics|geology|astronomy|architecture|construction|carpentry|printing|typography|linguistics|grammar|phonetics|music theory|cricket|baseball|golf|chess|poker|card games|bridge|knitting|sewing|textiles|agriculture|forestry|mining|metallurgy|surveying|cartography|heraldry|philately|numismatics|numismatic)\b/i;

const isName = (s) => s.pos === 'name' || s.kind === 'name';
const recent = (s) => Number.isFinite(s.year) && s.year >= RECENT_YEAR;

/** The senses a picker may weigh: no usage note, no trade's term; names only when nothing else is left. */
function usable(senses) {
  const kept = senses.filter((s) => !(s.gloss && USAGE_NOTE.test(s.gloss)) && !TRADE.test(s.label || ''));
  const plain = kept.filter((s) => !isName(s));
  return plain.length ? plain : kept;
}

/**
 * pick(senses, searches, { term }) -> { sense, index, why } or { sense: null, abstain } (abstain: why there is no line from the
 * dictionary; keep: the row keeps its line, it is no abstention of the rule). senses: [{ kind, year, label, gloss, pos }] in dictionary order.
 * searches: what people type about the word (Google's completions, the row's own search), any number.
 */
function pick(senses, searches = [], { term = '' } = {}) {
  const all = (senses || []).filter(Boolean);
  if (!all.length) return { sense: null, abstain: 'not in the dictionary file' };
  const keep = usable(all);
  if (!keep.length) return { sense: null, abstain: 'only usage notes and trade terms' };
  const strong = keep.filter((s) => STRONG.has(s.kind));
  const out = (s, why) => (!s.gloss ? { sense: null, abstain: 'the file holds no words for the sense people mean', keep: true } : { sense: s, index: all.indexOf(s), why });
  if (strong.length) {
    const own = T.contentStems(term);
    const said = T.contentStems((searches || []).join(' . '), own);
    const scored = strong.map((s) => ({ s, v: T.overlap(said, s) + (recent(s) ? RECENT_BONUS : 0) }));
    const best = scored.reduce((a, b) => (b.v > a.v + 1e-9 ? b : a));
    const near = best.v > (recent(best.s) ? RECENT_BONUS : 0) + 1e-9;
    return out(best.s, near ? 'the slang sense nearest the searches' : recent(best.s) ? 'the newest slang sense' : 'the first slang sense');
  }
  if (T.asksSlang(searches)) return { sense: null, abstain: 'the searches ask for slang and no slang sense fits' };
  return out(keep[0], 'the first sense (no slang sense)');
}

module.exports = { pick, usable, STRONG, RECENT_YEAR, RECENT_BONUS, USAGE_NOTE, TRADE };
