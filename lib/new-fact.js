'use strict';
/*
 * Whether a headline tells something new of a story (P5, lib/page-sink.js): the news that keeps a row its measured series calls
 * Fading on page one. Live 2026-10-27 00:36Z, the first passes of the page sink: page one carried 8 Fading rows (6 on a measured
 * series) on US and 10 on the other lists, held up by "news" that was the story told again: a fight's anecdote retold three times
 * ("co-star says", "co-star claims", "co-star finally reveals why"), an apology a day's write-up told again, an artist's orders under
 * a fortnight-old feud. Something new is a new event: a family of the talk nouns (engine/talk-nouns.js: an arrest, a lawsuit, a
 * reply) or one of MORE_EVENTS that no coverage of the row before the day said, or a person its coverage never named (in a
 * sentence-case headline: a Title Case one capitalises every word, as engine/talking-points.js chapterOf reads names). How a story is
 * told is never an event of it: "reveals", "comments". A recap, an explainer or the anecdote dated again (RETOLD) names nobody new, and
 * is news only when it says a new event: "<name> charged: what to know" is a charge, "once-close friends now suing each other" a
 * lawsuit. An escalation (ESCALATIONS: an arrest, a lawsuit, a verdict, the police, a statement, ...) is news of a story whatever
 * noun it is told in: "<name> arrested" under "<name> allegations" (`escalates`). Pure: no clock, no I/O.
 */
const TN = require('../engine/talk-nouns');
const W = require('../engine/wording');
const { keyOf } = require('./util');

// a headline that tells the story again: an explainer (engine/talk-nouns.js EXPLAINED), a recap, a look back, the anecdote dated again
const RETOLD = new RegExp(`${TN.EXPLAINED.source}|\\b(?:explor(?:ed|es|ing)|unpack(?:s|ed|ing)?|recap\\w*|looks? back|looking back|recall(?:s|ed|ing)? (?:how|when|the|being|that|what|his|her|their)|remember(?:s|ed)? (?:when|the time)|resurfac\\w*|throwback|revisit\\w*|years? ago|once(?! again| more)|finally (?:reveals?|explains?|says|opens? up|addresses)|reveals? why|the real reason)\\b`, 'i');
// how a story is told, never what happened in it
const TELLING = new Set(['reveal', 'remarks']);
// what happened next that no noun family names (an admission is one: "reveal" is only the telling, so it is said here)
const MORE_EVENTS = [
  { key: 'cancel', re: /\b(?:cancel(?:s|led|ed|ling|lation|lations)?|postpon\w+|call(?:s|ed)? off|pull(?:s|ed)? out)\b/i },
  { key: 'police', re: /\b(?:police|investigat\w+|probe[sd]?|warrants?|raid(?:s|ed)?|detectives?|prosecutors?)\b/i },
  { key: 'court', re: /\b(?:files?|filed|filing|settle(?:s|d|ment)?|subpoena\w*|deposition|testif\w+|judge|hearing|dismiss(?:es|ed|al)?|appeal(?:s|ed)?|restraining order|custody)\b/i },
  { key: 'statement', re: /\b(?:statement|confirm(?:s|ed)?|announc(?:es|ed|ement))\b/i },
  { key: 'admit', re: /\b(?:admit(?:s|ted)?|admission|confess(?:es|ed|ion)?)\b/i },
  { key: 'ties', re: /\b(?:cut(?:s|ting)? ties|sever(?:s|ed)?|part(?:s|ed)? ways|resign(?:s|ed)?)\b/i },
];
const NAME_WORDS_MIN = 2;
// the events that move any story of a person on, whatever its title's noun: a headline that names the subject and says one of these,
// new to the story, is news of it ("<name> arrested on assault charge" under "<name> allegations"). Any other event must be told
// under the title's own noun (a relative's TV comeback under "<name> allegations" is the relative's story)
const ESCALATIONS = new Set(['arrest', 'lawsuit', 'verdict', 'sentencing', 'mistrial', 'prison', 'police', 'court', 'statement', 'response', 'admit', 'ties', 'cancel', 'apology', 'allegations']);
// (two of them are said of any news too, a tour "announced", an award "reacted" to: as an escalation they need their own words)
const ESCALATION_WORDS = { statement: /\bstatements?\b/i, response: /\b(?:responds?|response|breaks? (?:his |her |their )?silence|speaks? out|addresses|hits back|fires back|denies|denied)\b/i };

/** Whether a headline only tells the story again: a recap, an explainer, the anecdote retold. */
const retold = (text) => RETOLD.test(String(text || ''));

/** The events a headline says: the keys of its noun families (the telling aside) and of MORE_EVENTS. */
function eventsOf(text) {
  const s = String(text || '');
  return new Set([...TN.familiesIn(s).map((x) => x.f.key).filter((k) => !TELLING.has(k)), ...MORE_EVENTS.filter((e) => e.re.test(s)).map((e) => e.key)]);
}

/** The names a sentence-case headline gives (two words or three, as engine/talk-nouns.js nameRuns reads them); none from a Title Case one. */
function namesOf(text) {
  const s = String(text || '');
  return W.isTitleCase(s.split(/\s+/)) ? [] : TN.nameRuns(s).filter((n) => n.split(' ').length >= NAME_WORDS_MIN);
}

/**
 * What a row had told before: its title (its noun family is its story), its names, and the texts of its coverage before the day.
 * ({ title, family, names: [subject, surface, ...], texts: [...] }) => { events, words }
 */
function toldBefore({ title = '', family = null, names = [], texts = [] } = {}) {
  const events = new Set([...(family ? [family] : []), ...eventsOf(title), ...texts.flatMap((t) => [...eventsOf(t)])]);
  const words = new Set([title, ...names, ...texts].flatMap((t) => keyOf(String(t || '')).split(' ')).filter(Boolean));
  return { events, words };
}

/**
 * Whether a headline tells something new of the story before: an event its coverage never said (in any telling, a recap's or an
 * explainer's too), or, in a headline that is no retelling, a person never named before. before: toldBefore's.
 */
function newFact(text, before) {
  if (!text) return false;
  const { events, words } = before || toldBefore();
  if ([...eventsOf(text)].some((k) => !events.has(k))) return true;
  if (retold(text)) return false;
  return namesOf(text).some((n) => n.split(' ').every((w) => !words.has(w)));
}

/**
 * Whether a headline names the story's subject (every word of it) and says an escalation (ESCALATIONS) its coverage before never
 * said: news of the story though it never says the title's noun. subject: the row's name as shown; before: toldBefore's.
 */
function escalates(text, subject, before) {
  const name = keyOf(String(subject || '')).split(' ').filter(Boolean);
  if (!text || !name.length) return false;
  const said = new Set(keyOf(String(text)).split(' '));
  if (!name.every((w) => said.has(w))) return false;
  const { events } = before || toldBefore();
  return [...eventsOf(text)].some((k) => ESCALATIONS.has(k) && !events.has(k) && (!ESCALATION_WORDS[k] || ESCALATION_WORDS[k].test(text)));
}

module.exports = { newFact, escalates, toldBefore, eventsOf, namesOf, retold, RETOLD, MORE_EVENTS, ESCALATIONS };
