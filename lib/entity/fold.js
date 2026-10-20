'use strict';
/*
 * The entity roster's one way of spelling a name (P14, B2): the scoreboard matcher's fold(), as the roster was built and measured
 * with it (scripts/build-data/entity-roster.README.md). Lower case, accents off, "&" as "and", possessives and apostrophes off,
 * anything else not a letter or a digit a space. A hashtag's words are split at its capitals first ("#VelmaOrrin" is "velma orrin").
 */

/** A name as the roster's keys spell it. */
function fold(text) {
  let s = String(text || '');
  if (s.trim().startsWith('#')) s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  s = s.replace(/&/g, ' and ').replace(/['’](s)\b/g, '').replace(/['’`]/g, '');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** A name's words as folded. */
const wordsOf = (text) => fold(text).split(' ').filter(Boolean);

/**
 * A one-word name that is a platform handle, not a word: six characters or more with a digit, or a capital after its first letter
 * ("Zap2Zork", "quillCast"). The matcher's rule; such a name may stand alone, a plain one-word name ("Brimvale") may not.
 */
function handleLike(name) {
  const w = String(name || '').trim();
  return !/\s/.test(w) && w.length >= 6 && /\d|.[A-Z]/.test(w);
}

/** A full name: two words or more as folded. */
const isFullName = (name) => wordsOf(name).length >= 2;

module.exports = { fold, wordsOf, handleLike, isFullName };
