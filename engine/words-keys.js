'use strict';
/*
 * "Words & trends" term keys: variants of one term share a key ("mog"/"mogging"/"mogged", "big back"/"bigbacked", "6-7"/"67").
 * Stemmed words, kind words dropped, doubled letters squeezed. Plain string arithmetic, so it ports 1:1 to Swift.
 */
const W = require('./wording');

const KEY_TAIL = new Set('trend trends challenge meme memes audio sound song slang term word phrase catchphrase quote craze format'.split(' '));
const KEY_HEAD = new Set('the a an tiktok viral this'.split(' '));
/** "mogging" -> "mog", "mogged" -> "mog", "sleepmaxxing" -> "sleepmax", "blockin" -> "block". */
function termStem(w) {
  let s = w;
  if (s.length >= 5 && s.endsWith('in') && !W.inDict(s) && W.inDict(`${s}g`)) s += 'g';
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  return s.replace(/([a-z])\1+/g, '$1');
}
function termSeq(term) {
  const ws = W.words(term);
  while (ws.length > 1 && KEY_HEAD.has(ws[0])) ws.shift();
  while (ws.length > 1 && KEY_TAIL.has(ws[ws.length - 1])) ws.pop();
  return ws.map(termStem);
}
const termKey = (term) => termSeq(term).join('');

function hasSeq(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length && ok; j++) ok = hay[i + j] === needle[j];
    if (ok) return true;
  }
  return false;
}

module.exports = { termStem, termSeq, termKey, hasSeq };
