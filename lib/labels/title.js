'use strict';
/*
 * A title no surer than its sources (P5, item 4): "<name> <noun>" says the noun of the name. A row titled "<name> allegations" whose
 * line has the name accusing someone else, or reacting to someone else's allegations, puts a claim on the wrong person. The title's
 * kind is kept when one of the row's own texts of now (its line, its headlines, threads' and clips' titles of the last two days, the
 * searches people type for it) says the noun's family about the name (a claim may be said as "allegedly", "exposed", "caught"). An
 * earlier chapter's headlines do not hold a title up: a story whose newest line is about something else is titled by that:
 *   after it    the family's word with the name close behind it: "allegations against <name>", "accused <name>"
 *   before it   the name a few words before the word, the name not its maker ("<name> was charged", "<name> faces backlash", "<name>'s
 *               accuser"); never "<name> accuses ...", "<name> slams ..." for a claim (the name is who makes it; a fight or a feud has
 *               both sides in it), nor "<name>'s <someone> accused ...", nor a word another name owns ("<Other>'s allegations")
 *   a pronoun   "accuses him of", "sued her": the word with the story's person as its object
 *   a relative  "allegations about <her> father", "<name> Dad allegations", "<name> told dad <Other> <Name> ...": the claim is about
 *               someone of the name's, never the name. And a word of the name after another given name is someone else's ("<Other>
 *               <Surname>" is not "<Given> <Surname>")
 *   another's   for a word that says what someone is or did (a scam, an arrest, a split...), not a claim by its nature: the word only in
 *               quotes, or after a third person's "posts", "tags", "calls", "says" with the name its object, is that person's word
 * Else the title is made again from the line (lib/desk.js nounTitle: the name and what the line is about, in its own words, quoted
 * words left out), with a claim word whose maker is the name taken out first; a claim about a relative is titled "<name> <relative>
 * <noun>". And whatever its texts say (review, 2026-10-27):
 *   negated     a split whose newest chapter (its line, its timeline's latest) is a reunion is titled "<name> reunion"; one the
 *               newest chapter calls a hoax "<name> <noun> hoax"
 *   cut short   a moment's title cut from its headline before the end of its object ("<name> reacts to his outing" of "... his outing
 *               on <sister>'s birthday going viral": what follows the cut still holds a verb) is its whole headline, or a noun phrase of
 *               its line when the headline runs long
 *   broken      a moment's title that ends on a number ("... served cheaper steak three") or on a phrasal verb's last word with its first
 *               dropped ("<name> back" of "... clap back") is its whole headline, the headline its outlet wrote out, or a noun phrase
 *               of its line (2026-10-28)
 * And a word only watched, answered or mourned is not said of the name ("<name> reacts to arrest of <other>", "<name> witnesses
 * stabbing", engine/talk-nouns.js onlooker), nor one only rumoured ("arrest rumours"), nor "<Other> <Surname> <noun>". A comments or
 * reveal title needs the name to be the one speaking: "<Other> makes rare comment on <name>'s kids" is no "<name> comments"
 * (2026-10-28).
 * Pure: strings in, a row out; no I/O.
 */
const TN = require('../../engine/talk-nouns');
const W = require('../../engine/wording');
const { keyOf } = require('../util');

// (the families whose title says something about the name that a line can get wrong: claims, conflicts, what happened to someone)
// (and a cheating claim: who cheated is what such a title can get wrong. 2026-10-28)
const CHECKED = new Set(['allegations', 'arrest', 'lawsuit', 'feud', 'backlash', 'apology', 'split', 'leak', 'fight', 'attack', 'stabbing', 'argument', 'rumors', 'threats', 'scam', 'quit', 'cheating']);
// a name followed by one of these makes the claim: it is not about the name. Only for the families that are something said or done
// to the name (a fight, a feud or a lawsuit has both sides in it: "<name> punched ..." is still the name's fight)
const MAKER_FAMS = new Set(['allegations', 'backlash', 'arrest', 'rumors', 'scam', 'cheating']);
const MAKER = /^(?:accuses|accused|accusing|alleges|alleged|alleging|claims|claimed|slams|slammed|blasts|blasted|rips|ripped|mocks|mocked|criticizes|criticises|criticized|criticised|calls|called|attacks|attacked|sues|sued|suing|threatens|threatened|reacts|reacted|responds|responded|exposes|exposed|confronts|confronted|roasts|roasted|disses|dissed)$/i;
// "accused of", "alleged to", "sued by", "called out by": what follows makes the maker's verb a passive one, about the name
const PASSIVE_NEXT = /^(?:of|to|by|in|for|over|with)$/i;
const AFTER_WORDS = new Set(['against', 'on', 'about', 'involving', 'toward', 'towards', 'at', 'over', 'of', 'vs', 'versus', 'from', 'with']);
const PRONOUN = /^(?:him|her|them|his|hers)$/i;
// (the words a claim is reported in beside the family's own: "allegedly cheating", "exposed for", "caught faking")
// (never someone exposed to a danger: "was exposed to toxic mold")
const REPORTED = { allegations: /\b(?:allegedly|alleged|exposed(?!\s+(?:to|in|on|at|after|during)\b)|caught)\b/ };
const NEAR_AFTER = 3;
const TITLE_CASE_SHARE = 0.7;
// someone of the name's: the claim is theirs, not the name's ("allegations about estranged father")
const RELATION = /^(?:father|dad|daddy|mother|mom|mum|mommy|parents?|brother|sister|son|daughter|husband|wife|ex|ex-wife|ex-husband|ex-girlfriend|ex-boyfriend|exes|boyfriend|girlfriend|fianc[eé]e?|partner|uncle|aunt|cousin|nephew|niece|grandfather|grandmother|grandpa|grandma|stepfather|stepmother|stepdad|stepmom|half-brother|half-sister|family|in-laws?)$/i;
const RELATION_NOUN = { dad: 'father', daddy: 'father', mom: 'mother', mum: 'mother', mommy: 'mother', stepdad: 'stepfather', stepmom: 'stepmother', grandpa: 'grandfather', grandma: 'grandmother' };
// what may stand between "about" and the relative: "allegations about her estranged father"
const RELATION_LEAD = /^(?:her|his|their|the|a|an|own|estranged|late|former|alleged)$/i;
const RELATION_AFTER = 3;
// the families whose noun says what someone is or did, not a claim by its nature: in quotes, or a third person's, it is that one's word
const CLAIM_FAMS = new Set(['allegations', 'rumors', 'lawsuit', 'feud', 'fight', 'argument', 'backlash', 'threats', 'cheating']);
const THIRD = /^(?:posts|posted|posting|tags|tagged|tagging|calls|called|calling|says|said|brands|branded|labels|labelled|labeled|dubs|dubbed|mocks|mocked|mocking|accuses|accused|claims|claimed|suggests|suggested|jokes|joked)$/i;
const CLAUSE_BREAK = /[,;:—–]$/;

const wordsOf = (text) => String(text || '').split(/\s+/).filter(Boolean);
const bare = (w) => String(w || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const possessive = (w) => { const tail = String(w || '').replace(/[^\p{L}\p{N}’']+$/u, ''); return /[’']s$/i.test(tail) || /s[’']$/i.test(tail); };
const base = (w) => keyOf(bare(w).replace(/[’']s$/i, ''));

/** The words that stand for the name in a text, as keys: each of its words (a given name, a surname, a handle). */
function nameKeys(name) {
  return new Set(wordsOf(name).map(base).filter((k) => k && k.length >= 2));
}

/** A word a dictionary knows, in its plain form or as a plural or a verb's -s form: no name. */
const dictish = (k) => !!k && (W.isDictWord(k) || (k.endsWith('s') && W.isDictWord(k.slice(0, -1))) || (k.endsWith('es') && W.isDictWord(k.slice(0, -2))));
/** Another name's word: capitalised, not the story's name, and no word a dictionary knows. */
const otherName = (w, keys) => /^\p{Lu}/u.test(bare(w)) && !keys.has(base(w)) && !dictish(base(w));

/**
 * Whether `text` names `name` and says family `f` of it: one of the family's words (or a claim's reported words) is the name's unless
 *   it is someone else's: "<Other>'s allegations", "<Other>s allegations";
 *   it is about someone else: "allegations on <Other>", "against <Other>" (with the name not there instead);
 *   the name makes it, for a claim: "<name> accuses ...", "<name> slams ...";
 *   it is about someone of the name's: "<name>'s dad accused of ...".
 * "Allegations against <name>", "accuses him of", "accused <name>" always are the name's.
 */
function saysAbout(text, f, name, legacy = false) {
  if (!f || !f.re || !name) return false;
  const ws = wordsOf(text);
  if (!ws.length) return false;
  const keys = nameKeys(name);
  const first = base(wordsOf(name)[0] || '');
  // (a word of the name after another given name is someone else's: "Bram <Surname>" is not "<Given> <Surname>")
  const someoneElse = (i) => i > 0 && base(ws[i]) !== first && otherName(ws[i - 1], keys) && !possessive(ws[i - 1]);
  const isName = (i) => i >= 0 && i < ws.length && keys.has(base(ws[i])) && !someoneElse(i);
  const names = ws.map((w, i) => i).filter(isName);
  if (!names.length) return false;
  const s = ws.join(' ');
  const claimFam = CLAIM_FAMS.has(f.key);
  const long = ws.map(bare).filter((w) => w.length >= 4);
  const titleCaseText = long.length >= 3 && long.filter((w) => /^\p{Lu}/u.test(w)).length >= TITLE_CASE_SHARE * long.length;
  // (a quote's span, in words: a word inside it is someone's words, not the outlet's)
  const quoted = new Set();
  let open = -1;
  ws.forEach((w, i) => {
    const opens = /^[“‘"']/u.test(w) && !/^['’]s$/i.test(w);
    const closes = /[”’"'][^\p{L}\p{N}]*$/u.test(w) && !possessive(w);
    if (open < 0 && opens) open = i;
    if (open >= 0) { quoted.add(i); if (closes && (i > open || w.length > 2)) open = -1; }
  });
  if (open >= 0) for (let i = open; i < ws.length; i++) quoted.delete(i);
  // (a third person's word: another name right before "posts", "tags", "calls", "says", with the name after it)
  const thirdAt = ws.findIndex((w, i) => i + 1 < ws.length && otherName(w, keys) && !isName(i) && THIRD.test(bare(ws[i + 1])) && names.some((p) => p > i + 1));
  for (const m of matches(s, f)) {
    const at = wordsOf(s.slice(0, m.index)).length;
    const span = Math.max(1, wordsOf(m[0]).length);
    const after = at + span;
    // the name right after it: "allegations against <name>", "accused <name>"
    const nextName = names.find((j) => j >= after && j <= after + NEAR_AFTER);
    if (Number.isFinite(nextName) && ws.slice(after, nextName).map(base).every((k) => keys.has(k) || AFTER_WORDS.has(k) || k === 'the')) return true;
    // a pronoun as its object: "accuses him of", "sued her"
    if (PRONOUN.test(bare(ws[after] || ''))) return true;
    // someone of the name's: "allegations about her estranged father"
    let j = after;
    if (AFTER_WORDS.has(base(ws[j] || '')) && base(ws[j] || '') !== 'with') {
      j += 1;
      while (j < ws.length && j <= after + RELATION_AFTER && RELATION_LEAD.test(bare(ws[j]))) j += 1;
      if (RELATION.test(bare(ws[j] || ''))) continue;
    }
    // or one between the name and the word, in the clause: "<name> Dad allegations", "<name> told dad <Other> <Surname> ..."
    const lastName = names.filter((p) => p < at).pop();
    if (Number.isFinite(lastName)) {
      const between = ws.slice(lastName + 1, at);
      if (!between.some((w) => CLAUSE_BREAK.test(w)) && (between.some((w) => RELATION.test(bare(w))) || between.some((w, k) => keys.has(base(w)) && someoneElse(lastName + 1 + k)))) continue;
    }
    // another's word: in quotes, or after a third person's verb with the name as its object
    if (!claimFam && (quoted.has(at) || (thirdAt >= 0 && thirdAt < at))) continue;
    // one the name only watches, answers or mourns: "<name> reacts to arrest of <other>", "<name> witnesses stabbing outside venue"
    // (engine/talk-nouns.js onlooker); one only rumoured, "<name> reacts to arrest rumours", is no arrest (2026-10-28)
    // (legacy: the rules before 2026-10-28, to tell a title only the newer rules refuse)
    if (!legacy && TN.onlooker(s, { f, surface: m[0], index: m.index }, name)) continue;
    if (!legacy && !RUMOURED_OK.has(f.key) && TN.rumoured(s, { f, surface: m[0], index: m.index })) continue;
    // another's whole name right before it: "<name> speaks about <Other> <Surname> arrest"
    // (in a sentence-case text only: in Title Case every word is capitalised)
    const pair = at >= 2 ? [ws[at - 1], ws[at - 2]] : [];
    if (!legacy && pair.length && !claimFam && !titleCaseText && pair.every((w, k) => /^\p{Lu}/u.test(bare(w)) && !isName(at - 1 - k) && !keys.has(base(w)) && !possessive(w)) &&
      pair.some((w) => otherName(w, keys))) continue;
    // someone else's: "<Other>'s allegations", "<Other>s allegations"
    const owner = at > 0 ? ws[at - 1] : '';
    if (at > 0 && !isName(at - 1) && (possessive(owner) ? /^\p{Lu}/u.test(bare(owner)) : otherName(owner, keys) && /s$/.test(bare(owner)))) continue;
    // (and "<Other> <Surname> allegations": a relative's name, the name's surname after another given name)
    if (at > 0 && keys.has(base(owner)) && someoneElse(at - 1)) continue;
    // about someone else: "allegations on <Other>"
    const k1 = base(ws[after] || '');
    if (AFTER_WORDS.has(k1) && k1 !== 'over' && ws[after + 1] && otherName(ws[after + 1], keys) && !isName(after + 1)) continue;
    // the name makes the claim: "<name> accuses ..."
    if (MAKER_FAMS.has(f.key) && names.some((p) => p < at && p + 1 <= at && MAKER.test(bare(ws[p + 1] || '')) && !PASSIVE_NEXT.test(bare(ws[p + 2] || '')))) continue;
    // someone of the name's: "<name>'s dad accused of ..."
    if (names.some((p) => p < at && possessive(ws[p]) && p + 1 < at) && !names.some((p) => p < at && !possessive(ws[p]) && !isName(p + 1))) continue;
    return true;
  }
  return false;
}

// (the families a rumour is said of as itself: "<name> cheating rumours" are the cheating claims', "<name> dating rumors" the rumours')
const RUMOURED_OK = new Set(['rumors', 'allegations', 'cheating', 'scam', 'threats', 'feud', 'backlash']);
/** The family's words (and a claim's reported words) in a text, as RegExp matches. */
const matches = (s, f) => [f.re, REPORTED[f.key]].filter(Boolean).flatMap((r) => [...s.matchAll(new RegExp(r.source, 'gi'))]);

/** The family a talk row's title says: its own family when its title ends with that family's noun, else null. */
function titleFamily(row) {
  if (!row || row.kind !== 'talk' || !row.family || !CHECKED.has(row.family)) return null;
  const f = TN.FAMILY.get(row.family);
  if (!f) return null;
  const noun = keyOf(String(row.noun || ''));
  return noun && keyOf(String(row.title || '')).endsWith(noun) ? f : null;
}

// (a headline older than this is an earlier chapter's: the title says what the story is about now)
const RECENT_MS = 48 * 3600 * 1000;
/**
 * The texts a row's title may rest on: its line, its own items' titles of the last two days (all of them with no clock), and what
 * people search and type for it (its searches' keywords, the completions it was named by).
 */
const textsOf = (row, nowMs = null) => [row.line,
  ...(((row.meta && row.meta.own) || []).filter((x) => x && (!Number.isFinite(nowMs) || (Number.isFinite(x.t) && x.t <= nowMs + RECENT_MS && nowMs - x.t <= RECENT_MS))).map((x) => x.title)),
  ...(((row.meta && row.meta.trends) || []).map((x) => x && x.keyword)),
  ...(((row.point && row.point.signals && row.point.signals.fresh) || []))].filter((x) => typeof x === 'string' && x.trim());

// (a comments or a reveal title says the name spoke: "<name> comments" over "<Other> makes rare comment on <name>'s kids" pins someone
// else's words on the name. 2026-10-28)
const SPEAKER_FAMS = new Set(['remarks', 'reveal']);
// (never a word as often a noun: "comments", "remarks", "details", "issues" are the family's own rule, famWord below)
const SPEAKS = /^(?:says|said|makes|made|reveals|revealed|admits|admitted|shares|shared|commented|remarked|tells|told|opens|opened|speaks|spoke|addresses|addressed|talks|talked|jokes|joked|writes|wrote|posts|posted|breaks|broke|responds|responded|reacts|reacted|claims|claimed|confirms|confirmed|discusses|discussed|weighs|weighed|explains|explained|insists|insisted|denies|denied|teases|teased|hints|hinted|confesses|confessed|recalls|recalled|reflects|reflected|gushes|gushed|praises|praised|slams|slammed|calls|called|gives|gave|offers|offered|issued|dropped|doubles|doubled|fires|fired|clarifies|clarified|announces|announced|detailed|spills|spilled|unveils|unveiled|exposes|exposed|apologizes|apologises|apologized|apologised)$/i;
// (what may stand between the name and its verb: "<name>, 41, reveals", "<name> finally speaks")
const SPEAK_SKIP = /^(?:also|finally|now|reportedly|publicly|candidly|openly|again|just|has|have|had|first|briefly|quietly|\d{1,3})$/i;
const SPEAK_SKIP_MAX = 3;
const OBJECT_BEFORE = /^(?:with|about|over|on|of|for|to|at|against|from|by|toward|towards|regarding|into)$/i;
// (a family word that is a noun as often as a verb, and what follows it as a verb)
const PLURAL_NOUN = /^(?:comments|remarks)$/i;
const VERB_NEXT = /^(?:on|about|that|after|as|amid|following|over|regarding|to|upon)$/i;
const POSSESSED_NOUN_WORDS = 3;
/** The talk row's family when its title says the name spoke (a comments or a reveal title ending with its noun), else null. */
function speakerFamily(row) {
  if (!row || row.kind !== 'talk' || !SPEAKER_FAMS.has(row.family)) return null;
  const f = TN.FAMILY.get(row.family);
  const noun = keyOf(String(row.noun || ''));
  return f && noun && keyOf(String(row.title || '')).endsWith(noun) ? f : null;
}
/**
 * Whether a text has the name speaking: the name, then (an age, an adverb) a speaking verb or the family's word ("<name> reveals",
 * "<name>, 41, makes rare comment"); the name's own family noun ("<name>'s candid comments"); or the noun said to be the name's
 * ("comments by <name>", "remarks from <name>").
 */
function speaks(text, f, name) {
  const ws = wordsOf(text);
  const keys = nameKeys(name);
  const first = base(wordsOf(name)[0] || '');
  const isName = (i) => i >= 0 && i < ws.length && keys.has(base(ws[i])) && !(i > 0 && base(ws[i]) !== first && otherName(ws[i - 1], keys) && !possessive(ws[i - 1]));
  const famWord = (w) => !!w && f.re.test(bare(w));
  for (let e = 0; e < ws.length; e++) {
    if (!isName(e) || isName(e + 1)) continue;
    if (possessive(ws[e])) {
      if (ws.slice(e + 1, e + 1 + POSSESSED_NOUN_WORDS).some(famWord)) return true;
      continue;
    }
    // (a name some small word governs is an object, never the speaker: "... controversy with <Other> and <name> comments in interview")
    let s0 = e;
    while (isName(s0 - 1)) s0 -= 1;
    // (and the second of two names a small word governs: "with <Other> and <name> comments")
    let k = s0 - 1;
    if (k > 0 && /^(?:and|&)$/i.test(bare(ws[k]))) { k -= 1; let n = 0; while (k > 0 && n < 3 && /^\p{Lu}/u.test(bare(ws[k]))) { k -= 1; n += 1; } }
    if ((s0 > 0 && OBJECT_BEFORE.test(bare(ws[s0 - 1]))) || (k >= 0 && k < s0 - 1 && OBJECT_BEFORE.test(bare(ws[k])))) continue;
    let j = e + 1;
    while (j < ws.length && j - e <= SPEAK_SKIP_MAX && (SPEAK_SKIP.test(bare(ws[j])) || /^\d{1,3},?$/.test(ws[j]))) j += 1;
    if (j >= ws.length) continue;
    if (SPEAKS.test(bare(ws[j]))) return true;
    // (the family's own word right after the name is its verb only with what it is about after it: "<name> comments on ...", "<name>
    // reveals ..."; "<name> comments in interview" is a noun, someone's comments about the name)
    if (famWord(ws[j]) && (!PLURAL_NOUN.test(bare(ws[j])) || j + 1 >= ws.length || VERB_NEXT.test(bare(ws[j + 1])) || /[:—–]$/.test(ws[j]))) return true;
  }
  return ws.some((w, i) => famWord(w) && /^(?:by|from)$/i.test(bare(ws[i + 1] || '')) && (isName(i + 2) || isName(i + 3)));
}

/**
 * Who speaks in a line, when it is someone other than the name: the capitalised words (three at most) right before its first speaking
 * verb or the family's word, "<Other>" of "<Other> makes rare comments about partner <name>"; or null.
 */
function speakerOf(line, f, name) {
  const ws = wordsOf(line);
  const keys = nameKeys(name);
  const j = ws.findIndex((w, i) => i > 0 && (SPEAKS.test(bare(w)) || (!!f && f.re.test(bare(w)))));
  if (j < 1) return null;
  let k = j;
  while (k > 0 && (SPEAK_SKIP.test(bare(ws[k - 1])) || /^\d{1,3},?$/.test(ws[k - 1]))) k -= 1;
  const run = [];
  for (let i = k - 1; i >= 0 && run.length < SPEAKER_WORDS && /^\p{Lu}/u.test(bare(ws[i])) && !possessive(ws[i]) && !/[,;:]$/.test(ws[i]); i--) run.unshift(bare(ws[i]));
  if (!run.length || run.some((w) => keys.has(base(w))) || run.every((w) => dictish(base(w)))) return null;
  return run.join(' ');
}
const SPEAKER_WORDS = 3;

/**
 * Whether a row's title kind is borne out by its own texts (rows of other kinds, and titles of no checked family, always are). legacy:
 * by the rules before 2026-10-28 (no speaker, onlooker, rumour or another's-name rule).
 */
function supported(row, nowMs = null, legacy = false) {
  const name = row.surface || row.subject || '';
  const said = speakerFamily(row);
  if (said) return legacy || textsOf(row, nowMs).some((x) => speaks(x, said, name));
  const f = titleFamily(row);
  if (!f) return true;
  return textsOf(row, nowMs).some((x) => saysAbout(x, f, name, legacy));
}

/**
 * The relative a row's claim is about, when its texts say the family's word of one ("allegations about her estranged father", "<name>'s
 * dad accused of"): the relation's noun ("father"), or null.
 */
function relativeOf(row, nowMs = null) {
  const f = titleFamily(row);
  if (!f) return null;
  const counts = new Map();
  for (const text of textsOf(row, nowMs)) {
    const ws = wordsOf(text);
    const s = ws.join(' ');
    for (const m of matches(s, f)) {
      const at = wordsOf(s.slice(0, m.index)).length;
      const near = ws.slice(Math.max(0, at - 4), at + 1 + RELATION_AFTER + 1).map(bare).find((w) => RELATION.test(w));
      if (near) { const k = near.toLowerCase(); counts.set(RELATION_NOUN[k] || k, (counts.get(RELATION_NOUN[k] || k) || 0) + 1); }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// what the newest chapter says of a split that undoes it: a reunion, or a hoax
const REUNION = /\b(?:reconcil\w*|reunit\w*|reunion|back together|takes? (?:\w+ ){0,3}back|took (?:\w+ ){0,3}back|gets? back together|got back together)\b/i;
const HOAX = /\b(?:hoax|fake|faked|staged|prank(?:ed)?|publicity stunt)\b/i;
const NEGATED_FAMS = new Set(['split']);
/** The title a row's newest chapter (its line, its timeline's latest) gives a noun it undoes, or null. */
function negatedTitle(row) {
  if (!row || row.kind !== 'talk' || !NEGATED_FAMS.has(row.family) || !titleFamily(row)) return null;
  const name = row.surface || row.subject || '';
  const tl = (row.meta && row.meta.timeline) || {};
  const newest = [row.line, tl.latest && tl.latest.text].filter((x) => typeof x === 'string' && x.trim());
  if (newest.some((x) => REUNION.test(x))) return `${name} reunion`;
  if (newest.some((x) => HOAX.test(x))) return `${name} ${row.noun} hoax`;
  return null;
}

// what may follow a moment's title cut at a small word: a verb there means the cut fell inside its object
const SMALL_CUT = /^(?:for|to|with|at|in|on|by|from|about|into|of)$/i;
const TAIL_VERB = /^(?:going|gone|goes|went|getting|gets|got|being|is|are|was|were|sparking|sparks|sparked|leaving|leaves|left|making|makes|made|taking|takes|took|turning|turns|turned|drawing|draws|drew|becoming|becomes|became|causing|causes|caused|trending|blowing|blows|blew|racking|racks|racked|earning|earns|earned|raising|raises|raised|prompting|prompts|prompted|fueling|fuels|fueled|fuelling|igniting|ignites|ignited|breaking|breaks|broke)$/i;
const HEADLINE_TITLE_MAX = 90;
/** A moment's headline its title was cut from before the end of its object (a small word, then a verb before any clause break), or null. */
function cutShort(row) {
  if (!row || row.kind !== 'moment') return null;
  const head = String((row.moment && row.moment.headline) || '').trim();
  const title = String(row.title || '').trim();
  if (!head || !title || keyOf(head) === keyOf(title)) return null;
  const hw = wordsOf(head);
  const tw = wordsOf(title);
  if (tw.length >= hw.length || !tw.every((w, i) => keyOf(w) === keyOf(hw[i]))) return null;
  const rest = hw.slice(tw.length);
  if (!SMALL_CUT.test(bare(rest[0]))) return null;
  const clause = [];
  for (const w of rest.slice(1)) { clause.push(bare(w)); if (/[,;:—–]$/.test(w)) break; }
  return clause.some((w) => TAIL_VERB.test(w)) ? head : null;
}

// a moment's title broken at its end (2026-10-28): a number cut from what it counts ("... served cheaper steak three" of "... three times,
// goes viral"), or a phrasal verb's last word with its first dropped ("<name> back" of "... clap back")
const NUMBER = /^(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)$/i;
// (what may follow a number that completes it: an age, a score, a date's end: "dies at 90 after ...")
const AFTER_NUMBER = /^(?:after|as|while|amid|following|when|because|but|and|or|in|on|at|for|with|to|from|by|of|over|into|than|since|before|during|is|was|are|were)$/i;
// (a number a label goes before is whole: "week 3", "season 2", "at 90", "turns 30")
const NUMBER_LABEL = /^(?:week|day|season|episode|ep|part|chapter|round|game|stage|level|volume|vol|no|number|act|series|gen|generation|phase|year|class|grade|top|at|aged|age|turns|turned|turning|of|vs|v|to|gta|ios|iphone|pixel|galaxy|windows|chapter|leg|lap|heat|race|match|title|ufc|wwe|nba|nfl)$/i;
const PARTICLE = /^(?:back|up|off|out|down|over|away|around|through)$/i;
/** Whether a moment's title ends broken, read against the texts it was made from (its headline, its line, its outlets' headlines). */
function brokenEnd(title, sources) {
  const tw = wordsOf(title);
  if (tw.length < 2) return false;
  const last = base(tw[tw.length - 1]);
  const prev = base(tw[tw.length - 2]);
  // (a phrasal verb some source says whole after the title's own word is whole: "... <name> clap back" of its headline)
  if (PARTICLE.test(last) && sources.some((src) => wordsOf(src).some((w, i, sw) => i > 0 && base(w) === last && base(sw[i - 1]) === prev))) return false;
  return sources.some((src) => {
    const sw = wordsOf(src);
    return sw.some((w, i) => {
      if (base(w) !== last || i === 0) return false;
      // (the number its source goes on from: the title's last two words there, a word after with no clause break between)
      if (NUMBER.test(last)) return base(sw[i - 1]) === prev && !NUMBER_LABEL.test(prev) && i + 1 < sw.length && !/[,;:.!?—–]$/.test(w) && !AFTER_NUMBER.test(bare(sw[i + 1])) && /^\p{L}/u.test(bare(sw[i + 1]));
      // (the particle its source says after another lowercase word than the title's: "clap back")
      return PARTICLE.test(last) && base(sw[i - 1]) !== prev && /^\p{Ll}+$/u.test(bare(sw[i - 1])) && !tw.some((t) => base(t) === base(sw[i - 1]));
    });
  });
}
/**
 * A whole title for a moment whose title ends broken: its phrasal verb's first word put back ("<...> clap back"); else the headline an
 * outlet wrote that goes on from the title, to its clause's end; else its headline when that is whole and short enough; else a noun phrase
 * of its line; or null. (A title the line starts with leaves the card no line, lib/feed.js saidAgain: the headline comes after the rest)
 */
function mended(row, nounTitle, nowMs) {
  const name = row.surface || row.subject || '';
  const keys = new Set(wordsOf(name).map(base));
  const title = String(row.title || '').trim();
  const head = String((row.moment && row.moment.headline) || '').trim();
  const own = textsOf(row, nowMs).slice(1);
  const sources = [head, row.line, ...own].filter(Boolean);
  const ok = (t) => !!t && t.length <= HEADLINE_TITLE_MAX && keyOf(t) !== keyOf(title) && !brokenEnd(t, sources);
  const tw = wordsOf(title);
  const last = base(tw[tw.length - 1]);
  if (PARTICLE.test(last)) {
    for (const src of sources) {
      const sw = wordsOf(src);
      const i = sw.findIndex((w, k) => k > 0 && base(w) === last && /^\p{Ll}+$/u.test(bare(sw[k - 1])) && !tw.some((t) => base(t) === base(sw[k - 1])));
      const t = i > 0 ? [...tw.slice(0, -1), bare(sw[i - 1]), tw[tw.length - 1]].join(' ') : null;
      if (ok(t)) return t;
    }
  }
  for (const o of own) {
    const ow = wordsOf(o);
    if (ow.length <= tw.length || !tw.every((w, i) => base(w) === base(ow[i]))) continue;
    const more = [];
    for (const w of ow.slice(tw.length)) { more.push(w.replace(/[,;:—–]+$/, '')); if (/[,;:—–]$/.test(w)) break; }
    // (the outlet's Title Case is not the title's: a word a dictionary spells goes on in lowercase)
    const t = [...tw, ...more.map((w) => (dictish(base(w)) && !/^\p{Lu}{2,}$/u.test(bare(w)) ? w.toLowerCase() : w))].join(' ');
    if (ok(t)) return t;
  }
  if (ok(head)) return head;
  const phrase = typeof nounTitle === 'function' && row.line ? nounTitle(unquoted(row.line), name, keys) : null;
  return ok(phrase) ? phrase : null;
}

/** The line with a third person's name before its "posts", "calls", "says" taken out, for a title made from it: the title is the name's ("<Other> posts meme tagging <name>" reads "posts meme tagging <name>"). */
function withoutThird(line, name) {
  const keys = nameKeys(name);
  const ws = wordsOf(line);
  const named = (w) => /^\p{Lu}/u.test(bare(w)) && !keys.has(base(w));
  const at = ws.findIndex((w, i) => i + 1 < ws.length && named(w) && THIRD.test(bare(ws[i + 1])) && ws.slice(i + 2).some((x) => keys.has(base(x))));
  if (at < 0) return line;
  let from = at;
  while (from > 0 && named(ws[from - 1])) from -= 1;
  return [...ws.slice(0, from), ...ws.slice(at + 1)].join(' ');
}

/** The line with every quoted span taken out, for a title made from it: a quote is someone's words, never a title's noun. */
const unquoted = (line) => String(line || '').replace(/[“‘"](?:[^”’"]{1,80})[”’"]/gu, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();

/** The line with a claim word whose maker is the name taken out ("<name> accuses X" reads "<name> says X"), for a title made from it. */
function withoutMakers(line, name) {
  const keys = nameKeys(name);
  const ws = wordsOf(line);
  return ws.map((w, i) => (i > 0 && keys.has(base(ws[i - 1])) && MAKER.test(bare(w)) && !PASSIVE_NEXT.test(bare(ws[i + 1] || '')) ? 'says' : w)).join(' ');
}

/**
 * The row with a title its sources bear out: unchanged when they do; else made again from its line (`nounTitle(line, name, keys)`,
 * lib/desk.js), its noun the new title's last word, with a note in `desk`. Unchanged when no title can be made from the line.
 */
function checked(row, nounTitle, nowMs = null) {
  const name = row.surface || row.subject || '';
  const keys = new Set(wordsOf(name).map(base));
  const retitled = (title, why) => {
    if (!title || keyOf(title) === keyOf(row.title) || keyOf(title) === keyOf(name)) return row;
    const noun = keyOf(title).startsWith(keyOf(name)) ? title.slice(name.length).trim() : '';
    return { ...row, title, noun: row.kind === 'talk' ? noun || row.noun : row.noun, desk: [...(row.desk || []), why] };
  };
  const negated = negatedTitle(row);
  if (negated) return retitled(negated, `title kind "${row.noun}" undone by its newest chapter`);
  if (row.kind === 'moment' && brokenEnd(row.title, [row.moment && row.moment.headline, row.line, ...textsOf(row, nowMs).slice(1)].filter(Boolean))) {
    const whole = mended(row, nounTitle, nowMs);
    if (whole) return retitled(whole, 'title broken at its end');
  }
  const head = cutShort(row);
  if (head) {
    const phrase = head.length <= HEADLINE_TITLE_MAX ? head : typeof nounTitle === 'function' && row.line ? nounTitle(unquoted(row.line), name, keys) : null;
    return retitled(phrase, 'title cut before the end of its object');
  }
  if (supported(row, nowMs) || typeof nounTitle !== 'function' || !row.line) return row;
  // (a claim, a charge, a scam said of a relative is never the name's: "<name> <relative> <noun>". A court case or a feud a relative is
  // in is still the name's story, titled as before: the frozen day 2026-10-12b keeps "<name> court case" over a daughter's hearing)
  const relative = MAKER_FAMS.has(row.family) ? relativeOf(row, nowMs) : null;
  if (relative && name) return retitled(`${name} ${relative} ${row.noun}`, `title kind "${row.noun}" said of the name's ${relative}`);
  // (someone else's words under a comments or reveal title: the line's own words say who spoke, "<Other> makes rare comment on <name>'s
  // kids", where a noun phrase of it would not)
  const by = speakerFamily(row) ? speakerOf(row.line, TN.FAMILY.get(row.family), name) : null;
  if (by) return retitled(`${by} ${row.noun}`, `title kind "${row.noun}" not the name's words: titled by who spoke`);
  const spoken = speakerFamily(row) ? lineClause(row.line, name) : null;
  if (spoken) return retitled(spoken, `title kind "${row.noun}" not the name's words: its line's words`);
  const said = CLAIM_FAMS.has(row.family) ? unquoted(row.line) : withoutThird(unquoted(row.line), name);
  const phrase = nounTitle(withoutMakers(said, name), name, keys);
  // (a noun phrase of the line that says the same noun of the name again is no new title: the line's own words, to its first clause
  // break, are. "<name> speaks about <Other> <Surname> arrest", never "<name> arrest". 2026-10-28)
  const same = (t) => !t || keyOf(t) === keyOf(row.title) || (!!row.noun && keyOf(t).endsWith(` ${keyOf(row.noun)}`));
  if (!same(phrase)) return retitled(phrase, `title kind "${row.noun}" not in its sources`);
  // (only a title the newer rules refuse: one the older rules refused too stays as it was, as it did)
  const clause = supported(row, nowMs, true) ? lineClause(row.line, name) : null;
  return clause ? retitled(clause, `title kind "${row.noun}" not in its sources: its line's words`) : row;
}

const CLAUSE_TITLE_WORDS = 3;
/** A line's words up to its first clause break, as a title: with the name in it, CLAUSE_TITLE_WORDS words or more and no longer than a headline title; or null. */
function lineClause(line, name) {
  const keys = nameKeys(name);
  const head = String(line || '').split(/[,;:—–]\s|\s-\s/)[0].replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  const ws = wordsOf(head);
  return ws.length >= CLAUSE_TITLE_WORDS && head.length <= HEADLINE_TITLE_MAX && ws.some((w) => keys.has(base(w))) ? head : null;
}

module.exports = { saysAbout, supported, checked, titleFamily, withoutMakers, nameKeys, relativeOf, negatedTitle, cutShort, brokenEnd, speaks, speakerFamily, CHECKED };
