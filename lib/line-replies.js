'use strict';
/*
 * The reply a claim got (ios/IDEAS-FEED.md G4, section N): how a sentence has the subject, or the subject's side (an attorney, a
 * representative), deny, dispute or answer what is said of them, and that reply as a short clause in the sentence's own words. A
 * line that tells an accusation carries it whenever a source does: "Quoria Brannith is accused of ...; Brannith calls BS on the claim."
 * The clause is cut from the sentence, never worded anew ("denies" stands in a line only where a source says "denies"), so the
 * claim check carries it by that one sentence. Pure: no clock, no I/O.
 */
const W = require('../engine/wording');

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// who answers for someone: "Quoria Brannith's attorney", "her legal team", "a rep for ..."
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
// what is denied never opens on a preposition: there the denying word was a noun ("the Clover Boys dispute into focus", "a Voss
// denial over the test") and the sentence has nobody deny anything
const OBJECT_PREPOSITION = /^(?:into|over|on|onto|with|about|amid|after|before|against|at|by|for|from|in|of|to|under|between|during|within|without)(?![\p{L}\p{N}])/iu;
// a party to a story that an outlet names by what it is, not by its name: who answers for someone (SIDE), or the shop, the
// school, the organiser, the police the story is with. "New York Store denies she got the ‘Pretty Woman’ treatment" is the
// store's denial, told in the sentence's own words: "the store denies ..."
const PARTY = '(?:stores?|shops?|retailers?|compan(?:y|ies)|firms?|brands?|labels?|studios?|networks?|schools?|universit(?:y|ies)|colleges?|venues?|organi[sz]ers?|promoters?|festivals?|leagues?|clubs?|bands?|hospitals?|airlines?|restaurants?|hotels?|agenc(?:y|ies)|departments?|police|prosecutors?|boards?|councils?|committees?|unions?|publishers?|developers?|platforms?|sites?|owners?|employers?|organi[sz]ations?)';
const PARTY_WORD = new RegExp(`^${PARTY}$`, 'iu');
const PARTY_SPELT = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:\\p{Lu}[\\p{L}’'.-]*\\s+){0,2}${PARTY}|${SIDE})(?![\\p{L}\\p{N}])`, 'giu');

/** A name as a second mention: the surname when the name opens with a given name ("Brannith"), else the name as it is ("Plonlo", "nimvaneb"). */
function shortName(subject) {
  const ws = String(subject || '').trim().split(/\s+/).filter(Boolean);
  if (ws.length < 2 || ws.length > 3) return ws.join(' ');
  const [first, last] = [ws[0].toLowerCase(), ws[ws.length - 1].toLowerCase()];
  // (a surname: after a given name, or a word no dictionary has. "Plonlo" and "Koro Fenniss" stay whole)
  return W.isFirstName(first) || (!W.isDictWord(last) && /^\p{Lu}\p{Ll}/u.test(ws[ws.length - 1]) && !W.isDictWord(first)) || (W.isDictWord(first) && !W.isDictWord(last) && !W.isProperWord(first) && first.length <= 4) ? ws[ws.length - 1] : ws.join(' ');
}
/**
 * A name as a card prints its second mention (lib/editor/gate.js `printed`): the surname of a two-word name that opens with a given
 * name or with a word no dictionary has ("Tobin Hale" is "Hale"); a name of one word, of three, or of two dictionary words
 * ("Flour Hour", "New York") is said whole.
 */
function surnameOf(name) {
  const ws = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (ws.length !== 2) return ws.join(' ');
  const [first, last] = ws.map((w) => w.toLowerCase());
  const given = W.isFirstName(first) || !W.isDictWord(first);
  return given && !(W.isDictWord(last) && !given) ? ws[1] : ws.join(' ');
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
    if (OBJECT_PREPOSITION.test(object)) continue;
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

// what someone says when they say it is not so, beyond a plain "denies": the denying words, which need the name right before them
// ("Wexwy rejects Dovette’s claim"), and a few phrases said of the thing itself ("an item not for sale", "never happened", "calls
// it false"), which the engine words as a denial too (engine/talk-nouns.js DENIAL)
const SAYS_NO_VERB = new RegExp(`(?<![\\p{L}\\p{N}])${DENY}(?![\\p{L}\\p{N}])`, 'iu');
const SAYS_NO_PHRASE = /(?<![\p{L}\p{N}])(?:not for sale|never (?:happened|took place|touched|got touched|did (?:it|that|so|anything)|was|were|made)|call(?:s|ed|ing)? (?:[\p{L}’'-]+\s+){1,4}?(?:false|fake|a lie|lies|untrue)|(?:is|are|was|were) (?:false|untrue|not true|fabricated|baseless))(?![\p{L}\p{N}])/iu;
// a reporting clause that belongs to the sentence's own subject: "..., claiming she tried to buy an item not for sale"
const REPORTING = /(?<![\p{L}\p{N}])(?:claiming|saying|insisting|adding|stating|explaining|arguing|maintaining|says|said|insists|insisted|maintains|explains|argues)(?![\p{L}\p{N}])/iu;
// a denial taken back, or said not to have been made
const NO_NOT = /(?:no longer|not|never|refuses to|declines to|stops short of|doesn['’]t|didn['’]t|won['’]t)\s+(?:[\p{L}-]+\s+){0,2}$/iu;
const NO_NEAR = 6;
/**
 * Whether a sentence has `name` say it is not so: the name (its last word will do, or "<name>'s attorney") within six words before
 * a denying word or phrase with no clause break between; or the name opening the sentence and the phrase in a reporting clause of
 * the sentence's own ("Art of Play responds to her complaint, claiming she tried to buy an item not for sale"), no other full name
 * after the reporting word. { kind: 'denial' (a denying word) | 'dispute' (a phrase), phrase } or null. Plainer, never surer:
 * what the engine itself words as "<name> denies it".
 */
function saysNo(text, name) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!s || !words.length) return null;
  const full = words.map(esc).join('\\s+');
  const last = esc(words[words.length - 1]);
  const nameRe = new RegExp(`(?<![\\p{L}\\p{N}])(?:${full}|${words.length > 1 ? last : full})(?:[’']s?\\s+${SIDE})?(?![\\p{L}\\p{N}])`, 'giu');
  // (the sentence opens on the name, after a label at most: "Singer Mara Voss ..."; never after another name or a verb, "Wexwy rejects Dovette’s")
  const opens = new RegExp(`^(?<label>(?:[\\p{L}’'.-]+\\s+){0,2}?)${full}(?![\\p{L}\\p{N}])`, 'iu').exec(s);
  const labelled = !!opens && opens.groups.label.trim().split(/\s+/).filter(Boolean).every((w) => W.inDict(w.toLowerCase()) && !W.isFirstName(w.toLowerCase()));
  for (const hit of s.matchAll(new RegExp(`${SAYS_NO_VERB.source}|${SAYS_NO_PHRASE.source}`, 'giu'))) {
    const pre = s.slice(0, hit.index);
    if (NO_NOT.test(pre)) continue;
    const kind = SAYS_NO_VERB.test(hit[0]) ? 'denial' : 'dispute';
    const near = [...pre.matchAll(nameRe)].pop();
    if (near) {
      const between = pre.slice(near.index + near[0].length);
      // (nobody else named between, and no new clause: "Pello Sorrent responds after New York store denies ..." is the store's denial)
      const quoted = /^\s+(?:says|said|insists|insisted|claims|claimed|maintains)\b/i.test(between);
      const other = !quoted && between.split(/\s+/).some((w) => /^[^\p{L}\p{N}]*\p{Lu}/u.test(w));
      if (!/[,;:—–]/.test(between) && !CLAUSE_END.test(between) && !other && between.trim().split(/\s+/).filter(Boolean).length <= NO_NEAR) return { kind, phrase: hit[0] };
    }
    if (!opens || !labelled) continue;
    const rep = [...pre.slice(opens[0].length).matchAll(new RegExp(REPORTING.source, 'giu'))].pop();
    if (!rep) continue;
    const tail = pre.slice(opens[0].length + rep.index + rep[0].length);
    // (a full name after the reporting word is someone else's saying: "... says Tobin Hale denies it")
    if (!/\p{Lu}[\p{L}’'-]+\s+\p{Lu}[\p{L}’'-]+/u.test(tail)) return { kind, phrase: hit[0] };
  }
  return null;
}

// a line that tells a claim of someone: "is accused of", "alleges", "allegations", "claims"
const TELLS_CLAIM = /(?<![\p{L}\p{N}])(?:accus(?:es|ed|ing|ation|ations)|alleg(?:es|ed|edly|ing|ation|ations)|claims?|claimed|sued|sues|lawsuit)(?![\p{L}\p{N}])/iu;
/** Whether a line tells a claim made of someone (an accusation's line), by its own words. */
const tellsClaim = (line) => TELLS_CLAIM.test(String(line || ''));

/**
 * The parties a sentence names by what they are, each as the sentence spells it with the capitalised words right before it
 * ("New York Store", "Brooklyn store", "his attorney"): [{ noun (the party word, lower case, singular as it stands), spelt }].
 * What a denial may be said by when nobody is named as saying it (lib/line-compose.js `withAnswer`).
 */
function partiesOf(text) {
  const out = [];
  for (const m of String(text || '').replace(/\s+/g, ' ').matchAll(PARTY_SPELT)) {
    const ws = m[0].trim().split(/\s+/);
    out.push({ noun: ws[ws.length - 1].toLowerCase(), spelt: m[0].trim() });
  }
  return out;
}
/** The party word right before a token (a line's "the store denies", "police deny"), as the token's key, or null. toks: [{ k }]. */
function partyBefore(toks, i) {
  for (let j = i - 1; j >= 0 && j >= i - 2; j--) {
    const k = toks[j] && toks[j].k;
    if (!k) return null;
    if (PARTY_WORD.test(k) || new RegExp(`^${SIDE}$`, 'iu').test(k)) return k;
    // (one word of the party's own may stand between: "the store flatly denies")
    if (!/^(?:has|have|had|now|again|also|finally|publicly|flatly|strongly|vehemently|categorically|quickly)$/.test(k)) return null;
  }
  return null;
}

module.exports = { replyOf, saysNo, shortName, surnameOf, tellsClaim, partiesOf, partyBefore, SIDE, CLAIM };
