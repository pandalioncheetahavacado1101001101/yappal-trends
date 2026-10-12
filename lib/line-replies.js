'use strict';
/*
 * The reply a claim got (ios/IDEAS-FEED.md G4, section N): how a sentence has the subject, or the subject's side (an attorney, a
 * representative), deny, dispute or answer what is said of them, and that reply as a short clause in the sentence's own words. A
 * line that tells an accusation carries it whenever a source does: "Andrew Tate is accused of ...; Tate calls BS on the claim."
 * The clause is cut from the sentence, never worded anew ("denies" stands in a line only where a source says "denies"), so the
 * claim check carries it by that one sentence. Pure: no clock, no I/O.
 */
const W = require('../engine/wording');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// who answers for someone: "Andrew Tate's attorney", "her legal team", "a rep for ..."
const SIDE = '(?:attorneys?|lawyers?|legal team|reps?|representatives?|spokes(?:man|woman|person|people)|team|camp|manager|publicist)';
// what a claim is called
const CLAIM = '(?:claims?|allegations?|accusations?|rumou?rs?|reports?|charges|lawsuit|suit|accusers?)';
const DENY = '(?:den(?:y|ies|ied)|refut(?:e|es|ed)|disput(?:e|es|ed)|rebut(?:s|ted)?|reject(?:s|ed)?|dismiss(?:es|ed)?)';
// a dispute said without the word "deny": it needs a claim named as what it is said of
const DISPUTE = '(?:calls? (?:bs|b\\.s\\.|bull\\S*|cap) on|call(?:s|ed) out|push(?:es|ed) back (?:on|against|at)|hits? back (?:at|on|over)|fires? back (?:at|on|over)|claps? back (?:at|on)|shuts? down|laughs? off|brush(?:es|ed) off|shrugs? off|slams|blasts|counters|challenges|contests)';
// an answer that takes no side on the claim: the subject has spoken to it
const ANSWER = '(?:responds? to|responded to|addresses|addressed|reacts? to|reacted to|answers|answered|speaks? out (?:on|about|over|against)|spoke out (?:on|about|over|against)|breaks? (?:(?:his|her|their) )?silence (?:on|over|about)|broke (?:(?:his|her|their) )?silence (?:on|over|about)|comments? on|commented on)';
const QUIET = '(?:(?:has|have|had|now|again|also|finally|publicly|flatly|strongly|vehemently|categorically|quickly)\\s+){0,2}';
const OBJECT_WORDS = 6;
const DENIED_WORDS = 7;
const CLAUSE_END = /[,;:—–]|\s-\s|\s(?:after|amid|as|while|following|before|when|because|but|and)\s/i;

/** A name as a second mention: the surname when the name opens with a given name ("Tate"), else the name as it is ("Gorgeous Doll", "xQc"). */
function shortName(subject) {
  const ws = String(subject || '').trim().split(/\s+/).filter(Boolean);
  if (ws.length < 2 || ws.length > 3) return ws.join(' ');
  const [first, last] = [ws[0].toLowerCase(), ws[ws.length - 1].toLowerCase()];
  // (a surname: after a given name, or a word no dictionary has. "Gorgeous Doll" and "Megyn Kelly" stay whole)
  return W.isFirstName(first) || (!W.isDictWord(last) && /^\p{Lu}\p{Ll}/u.test(ws[ws.length - 1]) && !W.isDictWord(first)) || (W.isDictWord(first) && !W.isDictWord(last) && !W.isProperWord(first) && first.length <= 4) ? ws[ws.length - 1] : ws.join(' ');
}
/**
 * How a sentence has `subject` reply to a claim: { kind ('denial' | 'dispute' | 'answer'), by ('subject' | 'side'), clause } or
 * null. The subject, or "<subject>'s attorney", stands right before a word of denying, disputing or answering, and what it is said
 * of is a claim by name ("the claim", "new bestiality allegations"); a plain "denies" may also be said of the act itself ("denies
 * supporting ICE"). clause: the reply in the sentence's own words, led by the subject's short name, cut after the claim's noun.
 * text: a sentence as a line tells it (sentence case); subject: the name as the row spells it.
 */
function replyOf(text, subject) {
  const s = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  const words = String(subject || '').trim().split(/\s+/).filter(Boolean);
  if (!s || !words.length) return null;
  const full = words.map(esc).join('\\s+');
  const last = esc(words[words.length - 1]);
  const name = words.length > 1 ? `(?:${full}|${last})` : full;
  const who = `(?<![\\p{L}\\p{N}])${name}(?<side>[’']s?\\s+${SIDE})?\\s+${QUIET}`;
  const upTo = `(?<object>(?:[^\\s,;:—–]+\\s+){0,${OBJECT_WORDS}}?[“"‘']?${CLAIM}[”"’']?)(?![\\p{L}\\p{N}])`;
  const tries = [
    ['denial', new RegExp(`${who}(?<verb>${DENY})\\s+${upTo}`, 'iu')],
    ['dispute', new RegExp(`${who}(?<verb>${DISPUTE})\\s+${upTo}`, 'iu')],
    ['answer', new RegExp(`${who}(?<verb>${ANSWER})\\s+${upTo}`, 'iu')],
    // ("denies supporting ICE", "denies it": what is denied is the act itself, told to the end of its part of the sentence)
    ['denial', new RegExp(`${who}(?<verb>${DENY})\\s+(?<object>[^,;:—–]{2,80})`, 'iu')],
  ];
  for (const [kind, re] of tries) {
    const m = s.match(re);
    if (!m) continue;
    const side = m.groups.side ? m.groups.side.replace(/^[’']s?\s+/, '').toLowerCase() : null;
    let object = m.groups.object.trim();
    object = object.replace(/[“"‘']?(\p{L}+)[”"’']?$/u, '$1');
    if (!new RegExp(`${CLAIM}$`, 'i').test(object)) {
      // (the act itself: to where its part of the sentence ends, seven words at most)
      const cut = object.search(CLAUSE_END);
      object = (cut > 0 ? object.slice(0, cut) : object).trim().split(/\s+/).slice(0, DENIED_WORDS).join(' ');
    } else if (new RegExp(`^${CLAIM}$`, 'i').test(object)) object = `the ${object.toLowerCase()}`;
    if (!object) continue;
    const short = shortName(subject);
    return { kind, by: side ? 'side' : 'subject', clause: `${short}${side ? `’s ${side}` : ''} ${m.groups.verb} ${object}`.replace(/\s+/g, ' ') };
  }
  return null;
}

// a line that tells a claim of someone: "is accused of", "alleges", "allegations", "claims"
const TELLS_CLAIM = /(?<![\p{L}\p{N}])(?:accus(?:es|ed|ing|ation|ations)|alleg(?:es|ed|edly|ing|ation|ations)|claims?|claimed|sued|sues|lawsuit)(?![\p{L}\p{N}])/iu;
/** Whether a line tells a claim made of someone (an accusation's line), by its own words. */
const tellsClaim = (line) => TELLS_CLAIM.test(String(line || ''));

module.exports = { replyOf, shortName, tellsClaim, SIDE, CLAIM };
