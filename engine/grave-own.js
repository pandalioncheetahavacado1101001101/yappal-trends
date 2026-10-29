'use strict';
/*
 * Whose a grave noun is (wave 12 release, collector only). A card titled "<name> death", "<name> execution", "<name> verdict",
 * "<name> sentencing", "<name> arrest", "<name> shooting", "<name> stabbing", "<name> attack", "<name> firing" or "<name> exit" says a
 * grave thing happened to that name. The noun step counts the family's words near the name, so three shapes of someone else's news
 * passed it: the name wounded in an ambush that killed another ("<name> reportedly wounded in ambush that killed ..."), the name the
 * speaker of another's sentence ("<name> says firing squad execution of ... will be public"), and an opinion ("<name> gives verdict on
 * ... dancing"). Such a card stands only when one of its headlines says the family of the title's own name: the name whole and first
 * (nothing but a role before it), the family's word in the clause right after it, as the verb's subject, and nobody else's between.
 *
 * Used by lib/desks/more.js (the cards under the talking points' cut): a grave card without such a headline is no row there; it stays
 * where it was before More, under the cut. The main list is unchanged (measured: see the wave-12 release note). Pure: no clock, no I/O.
 */
const TN = require('./talk-nouns');
const R = require('./rules');
const { words } = require('./wording');

const fam = (key) => TN.FAMILY.get(key);
// (a grave noun in a card's title word, in the order a mixed noun is read: "shot death" is a death)
const GRAVE = [
  { key: 'execution', noun: /\bexecution\b/i, re: () => fam('execution').re },
  { key: 'death', noun: /\b(?:death|dies|died)\b/i, re: () => fam('death').re },
  { key: 'verdict', noun: /\bverdict\b/i, re: () => fam('verdict').re },
  { key: 'sentencing', noun: /\bsentencing\b/i, re: () => fam('sentencing').re },
  { key: 'arrest', noun: /\barrest\b/i, re: () => fam('arrest').re },
  { key: 'stabbing', noun: /\bstabbing\b/i, re: () => fam('stabbing').re },
  { key: 'shooting', noun: /\b(?:shooting|shot)\b/i, re: () => /\b(?:shot|shooting|shoots|gunned down)\b/i },
  { key: 'attack', noun: /\b(?:attack|assault)\b/i, re: () => fam('attack').re },
  { key: 'firing', noun: /\b(?:firing|fired|sacking)\b/i, re: () => /\b(?:fired|firing|sacked|axed|ousted|dismissed|terminated|let go)\b/i },
  { key: 'exit', noun: /\bexit\b/i, re: () => /\b(?:exits?|exited|quits?|quitting|leaves|leaving|left|steps? down|stepping down|stepped down|resigns?|resigned|departs?|departure|walks? away|walked away)\b/i },
];
/** The grave family of a card's noun word ("shot death" -> death), or null. */
function graveOf(noun) {
  const s = String(noun || '');
  if (!s) return null;
  const g = GRAVE.find((x) => x.noun.test(s));
  return g ? g.key : null;
}

// (what may stand between the name and the family's word when the word is still the name's: an appositive, an adverb, a passive)
const BETWEEN_WORDS = 6;
// (the name is the one hurt, the speaker, the judge or a watcher: the family's word is someone else's)
const NOT_OWN = /(?<![\p{L}\p{N}])(?:wounded|injured|hurt|survives?|survived|surviving|escapes?|escaped|rescued|witness\w*|sees|saw|watches|watched|says|said|tells|told|defends?|defended|announces?|announced|plans?|planned|condemns?|condemned|slams?|slammed|calls?|called|urges?|urged|backs?|backed|orders?|ordered|approves?|approved|signs?|signed|confirms?|confirmed|reacts?|reacted|responds?|responded|wants?|wanted|demands?|demanded|gives?|gave|asks?|asked|warns?|warned|praises?|praised|blasts?|blasted|vows?|vowed|reveals?|revealed|recalls?|recalled|mourns?|mourned|pays|paid|honou?rs?|remembers?|considers?|considered|weighs?|mulls?|threatens?|threatened|predicts?|predicted|denies|denied|blames?|blamed|accuses?|accused|reports?|reported|recounts?|describes?|described|discusses?|discussed|on|about|over|after|for|of|to|with|by|at|in)(?![\p{L}\p{N}])/iu;
// (a family's word said as a noun of someone else: "execution of <other>", "death of his son")
const OF_OTHER = /^\s*(?:of|for|on)\s/i;
// (the family's word as a noun, which "of <other>" makes someone else's; a verb's "of" is its own: "found guilty of fraud")
const AS_NOUN = /^(?:death|execution|arrest|verdict|sentencing|stabbing|shooting|attack|assault|firing|exit|departure|funeral|passing|obituary)$/i;
const STOP = /[;:|]|\s[—–-]\s|,\s+(?!\d)|\s(?:that|which|who|as|while|amid)\s/i;
const APPOSITIVE = /^\s*,\s*(?:\d{1,3}|[^,]{1,40}),/;
const PREFIX_WORDS = 5;
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether one text says the grave family `key` of `subject` (the title's name, any case): the name whole and first, the word its own. */
function saysOf(text, subject, key) {
  const g = GRAVE.find((x) => x.key === key);
  const s = String(text || '');
  const nw = String(subject || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!g || !s || !nw.length || /\?/.test(s)) return false;
  const m = s.match(new RegExp(`(?<![\\p{L}\\p{N}])${nw.map(esc).join('[\\s.-]+')}(?![\\p{L}\\p{N}])`, 'iu'));
  if (!m) return false;
  // (first: only a role or a show before the name, no other full name, no clause, no preposition or verb whose object it is)
  const prefix = s.slice(0, m.index);
  if (/[:;|,]/.test(prefix) || words(prefix).length > PREFIX_WORDS) return false;
  if (prefix.trim() && (/(?<![\p{L}\p{N}])(?:with|for|to|by|from|of|at|on|as|about|against|over|after|and|&|says|tells|slams|calls)\s*$/iu.test(prefix) ||
    /[’']s\s/.test(prefix) || TN.otherFullName(prefix, new Set(nw), false))) return false;
  let after = s.slice(m.index + m[0].length);
  // (the name's own possessive: its own death only when the word comes right after it, "<name>'s sudden death")
  const poss = after.match(/^[’']s\s+(?:(?:sudden|shock|shocking|tragic|untimely|unexpected|reported|alleged|surprise|public|recent|latest|abrupt|mysterious|planned|scheduled)\s+)?/iu);
  if (poss) {
    const rest = after.slice(poss[0].length);
    const hit = rest.match(g.re());
    return !!hit && hit.index === 0;
  }
  const app = after.match(APPOSITIVE);
  if (app) after = after.slice(app[0].length);
  const stop = after.search(STOP);
  const clause = stop < 0 ? after : after.slice(0, stop);
  const hit = clause.match(g.re());
  if (!hit) return false;
  // ("to be" is the name's own passive: "<name> to be executed")
  const between = clause.slice(0, hit.index).replace(/\bto be\b/gi, ' ');
  if (words(between).length > BETWEEN_WORDS || NOT_OWN.test(between) || TN.otherFullName(between, new Set(nw), false)) return false;
  // (said as a noun of someone else: "<name> backs execution of <other>" is caught above; "<name> execution of ..." too)
  if (AS_NOUN.test(hit[0]) && OF_OTHER.test(clause.slice(hit.index + hit[0].length))) return false;
  const x = { f: fam(key) || { key }, surface: hit[0], index: m.index + m[0].length + (app ? app[0].length : 0) + hit.index };
  if (fam(key) && (TN.onlooker(s, x, nw.join(' ')) || TN.othersSaid(s, fam(key), nw.join(' ')))) return false;
  return true;
}

/**
 * Whether a printed card (talking-points.js lists() output: { title, subject, noun, what, trace, latest }) may stand with a grave noun:
 * true when its noun is no grave family, when its subject is a place or a team (a place's shooting is the place's), or when one of its
 * headlines (its line, its trace, its latest) says the family of its own subject.
 */
function graveOwn(card) {
  if (!card) return false;
  const key = graveOf(card.noun) || graveOf(String(card.title || '').split(/\s+/).slice(-2).join(' '));
  if (!key) return true;
  const subject = String(card.subject || '').toLowerCase().trim();
  if (!subject) return false;
  if (R.isPlaceOrTeam(subject)) return true;
  const texts = [card.what, card.latest && card.latest.text, ...((card.trace || []).map((t) => t && t.text))].filter(Boolean);
  return texts.some((t) => saysOf(t, subject, key));
}

module.exports = { graveOf, graveOwn, saysOf, GRAVE };
