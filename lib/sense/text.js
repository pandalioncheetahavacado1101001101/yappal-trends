'use strict';
/*
 * Word sense (ios/IDEAS-SUPER.md P9, B8): the plain string work the picker needs. No model, no I/O: a search and a sense meet on
 * their words, so it ports 1:1 to Swift.
 */
const W = require('../../engine/wording');
const { keyOf } = require('../util');

// what a search says when it asks what a word means ("what does chopped mean slang", "red flag meaning", "rizz definition")
const MEANING_CUE = /\b(?:mean(?:s|ing|t)?|definition|defined|define|slang|what is|what are|what does|what do)\b/i;
// a search that asks for the slang sense in so many words (it is no plain "what does X mean")
const SLANG_CUE = /\b(?:slang|gen z|gen alpha|tiktok|snapchat|instagram|texting|text|internet|brainrot|meme)\b/i;
// the words of a meaning question itself: they say nothing about which sense is meant
const CUE_WORDS = new Set(['what', 'does', 'do', 'did', 'is', 'are', 'mean', 'means', 'meaning', 'meant', 'definition', 'define', 'defined',
  'slang', 'word', 'term', 'gen', 'z', 'alpha', 'tiktok', 'snapchat', 'instagram', 'text', 'texting', 'internet', 'in', 'on', 'a', 'an', 'the',
  'urban', 'dictionary', 'origin', 'example', 'examples', 'use', 'used', 'say', 'saying', 'when', 'someone', 'somebody', 'calls', 'call', 'you',
  'girl', 'guy', 'boy', 'from', 'by', 'it', 'like', 'so', 'how', 'to']);
// a row's kind word after its name ("Boo trend", "Ragebait word", "Red Flag meaning"): no part of the word looked up
const KIND_TAIL = /\s+(?:trends?|memes?|words?|meaning|meanings|slang|challenge|dance|sound|audio|aesthetic|edit|filter|phrase|term)$/i;

/** A term as the data file keys it: the collector's own key (lower case, plain letters and digits, single spaces). */
const termKey = (s) => keyOf(String(s || '').replace(/[‘’]/g, "'"));

/** The forms to look a row up by, best first: its term, then its title without a kind word, then each without "the" or spaces. */
function formsOf(...names) {
  const out = [];
  const add = (s) => { const k = termKey(s); if (k && !out.includes(k)) out.push(k); };
  for (const n of names.filter(Boolean)) {
    let s = String(n).trim();
    add(s);
    for (let i = 0; i < 2; i++) { const cut = s.replace(KIND_TAIL, ''); if (cut === s || !cut) break; s = cut; add(s); }
  }
  for (const k of [...out]) {
    if (k.startsWith('the ')) add(k.slice(4));
    if (k.includes(' ')) add(k.replace(/ /g, ''));
  }
  return out;
}

const STEM = (w) => W.stem(w);
/** The words of a text that can tell one sense from another: no stop word, no question word, none of the term's own. */
function contentStems(text, own = new Set()) {
  return new Set(W.words(text).filter((w) => w.length >= 2 && !W.STOP.has(w) && !CUE_WORDS.has(w) && !own.has(w)).map(STEM).filter((w) => !own.has(w)));
}

/**
 * How near a sense is to what people search, without a model: the share of the searches' telling words (all searches together,
 * the term's own words and the question's words left out) that the sense's label, gloss or example also uses. 0 when the
 * searches tell nothing but the word itself, which is most of them ("what does chopped mean slang").
 */
function overlap(searchStems, sense) {
  if (!searchStems.size) return 0;
  const said = contentStems(`${sense.label || ''} ${sense.gloss || ''} ${sense.example || ''}`);
  let hit = 0;
  for (const s of searchStems) if (said.has(s)) hit++;
  return hit / searchStems.size;
}

const asksMeaning = (searches) => (searches || []).some((q) => MEANING_CUE.test(String(q || '')));
const asksSlang = (searches) => (searches || []).some((q) => SLANG_CUE.test(String(q || '')));

module.exports = { MEANING_CUE, SLANG_CUE, KIND_TAIL, termKey, formsOf, contentStems, overlap, asksMeaning, asksSlang };
