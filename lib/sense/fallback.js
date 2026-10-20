'use strict';
/*
 * The dossier line (B8): what a word row shows when no dictionary sense can be shown, and what a format a roundup named shows when
 * its page says what creators do in words the desk's own rule does not read. Only what the collector holds about the row, never a
 * meaning it does not have, and never blank.
 */
const PD = require('../platform-desk');
const T = require('./text');

// the verbs a roundup's instruction opens with ("Pick something from your niche, then give your honest opinion ..."): what creators film
const DOING = new Set(`pick give film show use post put pair record start share take try hold walk dance turn add rate rank tell reveal recreate react
  choose list make sing grab set stitch duet point zoom cut switch pretend act play wear dress answer ask write type text call hide drop open flip swap
  jump mouth lip-sync lipsync say describe explain compare review hit let sit stand look stare spin slide snap clap wave run place line match mimic
  copy freeze fake prank roast unbox transform edit overlay caption narrate count fill stack build draw paint cook bake pour shake tap swipe
  flex pose strike reenact rewind replay`.split(/\s+/).filter(Boolean));
// what a sentence names when it tells the scene a creator films
const SCENE = /\b(?:creators?|shots?|camera|on[- ]screen|text overlay|overlays?|captions?|background|transitions?|lip[- ]?syncs?|voiceovers?|duets?|stitch(?:es)?|filmed|filming|clips?|pov|outfits?|dances?|dancing|lyrics|hand gestures)\b/i;
// a sentence that sells the format rather than telling it ("Super easy to film", "Easy for any niche", "save it and recreate it asap")
const HYPE = /\b(?:easy|easiest|perfect (?:for|if)|great for|works for|any niche|every niche|so many ways|save (?:it|this)|asap|alert|officially|don['’]t miss|you['’]ll love|jump on)\b/i;
// a word before the instruction's verb that says nothing ("Just dance, add a bold ...")
const LEAD = /^(?:just|simply|then|now|first|next)\s+/i;
const MIN_WORDS = 6;
const SCENE_MIN_WORDS = 8;
const OBJECT_BEFORE = /\b(?:to|for|with|at|on|about|from|of|by|let|lets|make|makes|help|helps|tell|tells|show|shows|give|gives|ask|asks|get|gets|keep|keeps|see|sees|like|likes|than|into|onto|around|behind|past)\s+$/i;

/**
 * A roundup's second person as a creator's third ("your niche" -> "their niche"), so the line tells what creators do. Words in
 * quotes are the on-screen text or a sound's line, quoted as they are.
 */
function third(text) {
  return String(text || '').split(/(“[^”]*”|"[^"]*")/).map((part, i) => (i % 2 ? part : swapped(part))).join('');
}
function swapped(text) {
  const cap = (m, to) => (/^[A-Z]/.test(m) ? to.charAt(0).toUpperCase() + to.slice(1) : to);
  // (the apostrophe as the page wrote it: "you’re" -> "they’re")
  let s = String(text || '').replace(/\byou(['’])(re|ve|ll|d)\b/gi, (m, q, tail) => cap(m, `they${q}${tail}`));
  const swaps = [[/\byourselves\b/gi, 'themselves'], [/\byourself\b/gi, 'themselves'], [/\byours\b/gi, 'theirs'], [/\byour\b/gi, 'their']];
  s = swaps.reduce((acc, [re, to]) => acc.replace(re, (m) => cap(m, to)), s);
  return s.replace(/\byou\b/gi, (m, at, all) => cap(m, OBJECT_BEFORE.test(all.slice(0, at)) ? 'them' : 'they'));
}
const sentencesOf = (text) => (String(text || '').replace(/\s+/g, ' ').match(/[^.!?…]+(?:[.!?…]+["”’']?|$)/g) || []).map((x) => x.trim()).filter(Boolean);
const curly = (s) => s.replace(/"([^"]+)"/g, '“$1”').replace(/(^|\s)'([^']+)'/g, '$1‘$2’');
// the words that open a list or a range ("..., whether that's work stress, personal chaos, or ..."): a sentence cut inside one is cut
// before it instead, never half a list (reviewers, 2026-10-20: "... whether that's work stress, personal chaos." left out the end of
// the list, and the phone's idea writer then read "personal" as the trend's style)
const LIST_OPENER = /,?\s+(?:whether|like|such as|including|from|be it|either|ranging)\s/gi;
const MIN_KEPT_WORDS = 6;
/** A sentence cut where a clause ends (lib/platform-desk.js cutClause), and where it was cut inside a list, before the list. */
function cutWhole(text) {
  const cut = PD.cutClause(text);
  if (!cut || cut.length >= text.length) return cut;
  const opener = [...cut.matchAll(LIST_OPENER)].pop();
  if (!opener) return cut;
  const before = cut.slice(0, opener.index).replace(/[,;:\s]+$/, '');
  return before.split(/\s+/).length >= MIN_KEPT_WORDS ? before : null;
}
const finish = (s) => {
  const cut = cutWhole(curly(s.replace(/[.…]+$/, '')));
  if (!cut) return null;
  const t = `${cut.charAt(0).toUpperCase()}${cut.slice(1).replace(/[,;:\s]+$/, '')}`;
  return /[.!?…]["”’']?$/.test(t) ? t : `${t}.`;
};

/**
 * What creators do in a format, from its roundup's own recap, when the desk's rule found no "creators are ..." sentence in it:
 * the first instruction the recap gives ("Pick something ..." -> "Creators pick something ..."), else the first sentence that
 * tells the scene ("One shot, one creator glued to their phone, ..."). null when the recap only sells it.
 */
function formatLine(about) {
  const ss = sentencesOf(about).filter((s) => s.split(/\s+/).length >= MIN_WORDS && !HYPE.test(s));
  const told = ss.map((s) => s.replace(LEAD, '')).find((s) => DOING.has(s.split(/\s+/)[0].toLowerCase().replace(/[^a-z-]/g, '')));
  if (told) return finish(third(`Creators ${told.charAt(0).toLowerCase()}${told.slice(1)}`));
  const scene = ss.find((s) => SCENE.test(s) && s.split(/\s+/).length >= SCENE_MIN_WORDS);
  return scene ? finish(third(scene)) : null;
}

/**
 * A word row's line when no dictionary sense of it can be shown: what people search about it, else what its source says of it,
 * else that its meaning here is not written up yet. Never a meaning.
 */
function wordLine({ term, asked = [], title = '', why = [] }) {
  const q = (asked || []).find(Boolean);
  if (q) return `People are searching “${q}”.`;
  if (T.MEANING_CUE.test(title || '')) return `People are searching what “${term}” means.`;
  const said = (why || []).find((w) => typeof w === 'string' && w.trim());
  if (said) return /[.!?…]$/.test(said.trim()) ? said.trim() : `${said.trim()}.`;
  return `What “${term}” means here has not been written up yet.`;
}

module.exports = { formatLine, wordLine, third, sentencesOf };
