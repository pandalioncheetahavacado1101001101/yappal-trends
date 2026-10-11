'use strict';
/*
 * Who did what to whom (ios/IDEAS-FEED.md G3 rule 6): for a word that says what happened, the one who did it and the one it was
 * done to, read the same way from the written line and from the source sentence that carries it. An active sentence reads its doer
 * on the left; a passive ("was accused by", "arrested in") reads it after "by"; a noun ("Reggie's allegations against Kai Cenat")
 * reads its owner and who it is against. A possessive is never its owner's act ("Jack Doherty's girlfriend pulled a gun" is not Jack
 * Doherty pulling one), and "he" or "she" is whoever the sentence last named that way. Pure: no clock, no I/O.
 */
const W = require('../engine/wording');
const TN = require('../engine/talk-nouns');
const T = require('./line-text');

const PASSIVE_NEXT = new Set(['by', 'of', 'for', 'with', 'from', 'over', 'after', 'in', 'on', 'at', 'as', 'to', 'amid', 'during', 'following', 'outside', 'while', 'into', 'and']);
const BE = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'gets', 'got', 'get']);
const HAVE = new Set(['has', 'have', 'had', 'having']);
const SUBJECT_PRONOUN = new Set(['he', 'she', 'they']);
const OBJECT_PRONOUN = new Set(['him', 'her', 'them', 'himself', 'herself', 'themselves']);
const RELATIVE = new Set(['who', 'which', 'whose']);
const PREPOSITION = new Set(['to', 'of', 'with', 'for', 'about', 'against', 'on', 'at', 'from', 'by', 'in', 'over']);
const JOINS = new Set(['and', 'or', 'as']);
// a claim told as a thing: its owner makes it, "against" says whom
const NOMINAL = /^(?:allegations?|accusations?|claims?|lawsuits?|suit|apolog(?:y|ies)|denials?|admissions?|confessions?|threats?|complaints?|rumou?rs?|charges)$/;
const NOMINAL_BY = new Set(['by', 'from']);
const NOMINAL_AGAINST = new Set(['against', 'about', 'involving', 'surrounding']);
const BY = new Set(['by']);
const SAY = /^(?:says?|said|tells?|told|claims?|claimed|alleges?|alleged|admits?|admitted|insists?|insisted|calls?|called|writes?|wrote|posts?|posted|tweets?|tweeted|reveals?|revealed|explains?|explained|adds?|added|declares?|declared|jokes?|joked|slams?|slammed|responds?|responded|den(?:y|ies|ied))$/;
// what is done to someone, as a headline clips it ("Halle Berry accused of ...", "Jack Doherty arrested in Miami"): the engine's own list
const DONE_TO = new Set(['accused', 'arrested', 'booked', 'charged', 'sued', 'hospitalized', 'hospitalised', 'disqualified', 'slammed', 'criticized', 'criticised', 'banned',
  'suspended', 'fired', 'sentenced', 'tased', 'removed', 'attacked', 'slapped', 'stabbed', 'detained', 'indicted', 'jailed', 'evicted', 'dropped', 'blasted', 'mocked', 'trolled',
  'swatted', 'robbed', 'rushed', 'taken', 'seen', 'spotted', 'caught', 'filmed', 'ordered', 'granted', 'hit', 'struck', 'injured', 'ejected', 'exposed', 'questioned', 'released',
  'convicted', 'acquitted', 'cleared', 'named', 'found', 'forced', 'kicked', 'shot', 'killed', 'assaulted', 'threatened', 'harassed', 'scammed', 'groomed', 'abused', 'executed']);
// what is done to a thing, clipped the same way after any noun: "character revealed", "series renewed", "tour cancelled"
const DONE_TO_THING = new Set(['revealed', 'announced', 'confirmed', 'renewed', 'cancelled', 'canceled', 'postponed', 'leaked', 'unveiled', 'delayed', 'recalled', 'axed', 'scrapped', 'linked',
  'hired', 'replaced', 'nominated', 'rejected', 'approved', 'preserved', 'deleted']);
const LEADS_IN = new Set(['after', 'amid', 'over', 'following']);
const GAP_MAX = 4;
const SCAN_MAX = 14;

const quiet = (t) => T.STOP.has(t.k) || T.ADVERB.has(t.k) || T.FREE.has(t.k) || BE.has(t.k) || HAVE.has(t.k) || t.unit || !!t.num || /ly$/.test(t.k) || T.NEG_GRAMMAR.has(t.k) || t.nt;
/** Whether a token has the shape of a verb: an ending, a past form, a word of the engine's verb list. (A plural noun is none.) */
const verbShaped = (t) => /(?:ed|ing)$/.test(t.k) || T.PAST_FORMS.has(t.k) || W.VERB_RE.test(t.k);

/** A sentence ready to be read: its tokens, which are name words, the names as mentions, the mention each name word belongs to, and who each "he", "she" or "they" is. */
function sentenceOf(text, known = new Set()) {
  const toks = T.tokensOf(text);
  const names = T.nameIndexes(toks, known);
  const mentions = T.mentionsOf(toks, names);
  const at = new Map();
  for (const m of mentions) for (let i = m.start; i <= m.end; i++) at.set(i, m);
  const S = { text, toks, names, mentions, at, title: T.isTitleCase(toks), who: new Map() };
  bindPronouns(S);
  return S;
}
/**
 * Who each pronoun is, left to right: the name it was bound to before, else the nearest name before it that no other pronoun
 * has; never the doer of the very verb it follows ("Kai Cenat paid her": she is not Kai Cenat). S.who: token index -> mention.
 */
function bindPronouns(S) {
  const bound = {};
  S.toks.forEach((t, i) => {
    const p = T.PRONOUN[t.k];
    if (!p || p === 'it' || S.names.has(i)) return;
    if (!bound[p]) {
      const taken = Object.entries(bound).filter(([k]) => k !== p).map(([, m]) => m);
      const left = OBJECT_PRONOUN.has(t.k) && i > 0 && !S.names.has(i - 1) ? leftOf(S, i - 1) : null;
      const doer = left && left.m ? left.m : null;
      const free = S.mentions.filter((m) => m.end < i && !taken.includes(m) && m !== doer);
      const pick = [...free].reverse().find((m) => !m.poss) || free[free.length - 1];
      if (pick) bound[p] = pick;
    }
    if (bound[p]) S.who.set(i, bound[p]);
  });
}
const pronounAt = (S, j) => (S.who.has(j) ? { kind: 'name', m: S.who.get(j), gap: [], preps: [], pronoun: T.PRONOUN[S.toks[j].k] } : { kind: 'pronoun', p: T.PRONOUN[S.toks[j].k], gap: [], preps: [] });

/** Whether the word at `i` is a claim told as a thing: a claim's noun after a possessive, a determiner or a describing word, or with no doer before it. */
function isNominal(S, i) {
  const t = S.toks[i];
  if (!NOMINAL.test(t.k)) return false;
  if (!/^(?:claims?|charges|threats?)$/.test(t.k)) return true;
  // ("Reggie claims ..." is a verb; "Reggie's claims", "the claims", "abuse claims" are the noun)
  const prev = S.toks[i - 1];
  return !prev || prev.poss || T.commaAfter(prev) || !(S.names.has(i - 1) || SUBJECT_PRONOUN.has(prev.k) || prev.k === 'and' || T.ADVERB.has(prev.k));
}
/** Whether the word at `i` can be read for who did it and to whom: a verb's form, or a claim's noun. A bare noun ("abuse", "arrest") cannot. */
function readable(S, i) {
  const t = S.toks[i];
  if (S.names.has(i) || !T.isContent(t) || t.num || T.NEG_GRAMMAR.has(t.k)) return false;
  if (isNominal(S, i)) return true;
  // (a participle that describes the thing after it is no verb: "the failed execution", "an alleged incident", "leaked DMs")
  const prev = S.toks[i - 1];
  const next = S.toks[i + 1];
  if (/(?:ed|en)$/.test(t.k) && (!prev || T.STOP.has(prev.k) || LEADS_IN.has(prev.k)) && !(prev && (BE.has(prev.k) || HAVE.has(prev.k) || SUBJECT_PRONOUN.has(prev.k) || RELATIVE.has(prev.k))) &&
    next && !T.commaAfter(t) && !T.breaksAfter(t) && T.isContent(next) && !T.FREE.has(next.k)) return false;
  if (/ers?$/.test(t.k) && !W.VERB_RE.test(t.k)) return false;
  if (verbShaped(t)) return true;
  return /[^s]s$/.test(t.k) && !!prev && !prev.poss && (S.names.has(i - 1) || SUBJECT_PRONOUN.has(prev.k) || prev.k === 'who');
}

/** Whether the word at `i` is told in the passive: "was accused", "is being sued by", a headline's clipped "arrested in", "accused of". */
function isPassive(S, i) {
  const { toks } = S;
  const t = toks[i];
  if (!/(?:ed|en)$/.test(t.k) && !T.PAST_FORMS.has(t.k)) return false;
  let j = i - 1;
  while (j >= 0 && (T.ADVERB.has(toks[j].k) || T.FREE.has(toks[j].k) || /ly$/.test(toks[j].k))) j -= 1;
  if (j >= 0 && BE.has(toks[j].k)) return true;
  if (j >= 0 && HAVE.has(toks[j].k)) return false;
  const next = toks[i + 1];
  if (next && next.k === 'by') return true;
  // (a headline leaves the helping verb out: what follows is who by, what for or where, never the one it was done to)
  const clipped = !next || PASSIVE_NEXT.has(next.k) || T.breaksAfter(t) || T.commaAfter(t);
  if (DONE_TO.has(t.k) && j >= 0 && (S.names.has(j) || T.commaAfter(toks[j])) && !toks[j].poss) return clipped;
  if (DONE_TO_THING.has(t.k) && j >= 0 && !toks[j].poss && (S.names.has(j) || (T.isContent(toks[j]) && !verbShaped(toks[j])))) return clipped;
  return false;
}

/** The noun phrase to the left of `i`: who does what the word at `i` says. null when the sentence leaves it out there (", and denies it"). */
function leftOf(S, i) {
  const { toks } = S;
  const inQuote = toks[i].q;
  let gap = [];
  let crossed = 0;
  for (let j = i - 1, seen = 0; j >= 0 && seen < SCAN_MAX; j--, seen++) {
    const t = toks[j];
    // (a quote is opaque from outside it, and closed from inside it)
    if (t.q !== inQuote) { if (inQuote) return null; continue; }
    if (T.breaksAfter(t)) return null;
    if (T.commaAfter(t)) {
      crossed += 1;
      // (", sparking backlash": what follows a comma in -ing has the sentence's own doer, not the nearest name)
      if (crossed === 1 && j === i - 1 && /ing$/.test(toks[i].k)) return null;
    }
    const m = S.at.get(j);
    if (m && m.end === j) {
      if (m.poss) return gap.length ? { kind: 'poss', m, head: gap[gap.length - 1], gap: gap.slice(0, -1) } : { kind: 'owner', m, gap: [] };
      // (an aside between two commas says who the doer is, it is not the doer: "Mike Ditka, legendary Chicago Bears coach, dies")
      const opened = crossed >= 1 && gap.length ? asideStart(S, m.start) : -1;
      if (opened >= 0) { j = opened + 1; gap = []; crossed = 0; continue; }
      // (a name between two commas is another name for what stands before them: "Future's ex, Gorgeous Doll, alleges")
      return { kind: 'name', m, gap, also: crossed >= 1 && m.start > 0 && T.commaAfter(toks[m.start - 1]) ? leftOf(S, m.start) : null };
    }
    if (m) continue;
    if (SUBJECT_PRONOUN.has(t.k) && !gap.length) return pronounAt(S, j);
    if (RELATIVE.has(t.k)) { const before = leftOf(S, j); return before ? { ...before, gap } : null; }
    if (T.CONNECTIVE.has(t.k) || JOINS.has(t.k)) return null;
    if (quiet(t) || verbShaped(t) || T.claimClass(t.k)) continue;
    gap.push(t.st);
    if (gap.length > GAP_MAX) return null;
  }
  return null;
}
/** Where the aside that holds the token before `start` opened: the index of the token its opening comma follows, or -1. */
function asideStart(S, start) {
  for (let j = start - 1; j >= 0; j--) {
    if (T.breaksAfter(S.toks[j])) return -1;
    if (T.commaAfter(S.toks[j])) return j;
  }
  return -1;
}

/** The noun phrase to the right of `i`: the one it was done to (or, with `only`, the one such a preposition leads to). */
function rightOf(S, i, only = null) {
  const { toks } = S;
  const inQuote = toks[i].q;
  const preps = [];
  let content = 0;
  for (let j = i + 1, seen = 0; j < toks.length && seen < SCAN_MAX; j++, seen++) {
    const t = toks[j];
    if (t.q !== inQuote) { if (inQuote) return null; continue; }
    if (T.breaksAfter(toks[j - 1])) return null;
    let m = S.at.get(j);
    if (m && m.start === j) {
      // (the word that leads to this very name: "accused by police of attacking Reggie" is not by Reggie)
      if (only && !only.has(preps[preps.length - 1])) { j = m.end; continue; }
      // (what a name is called leads to the name: "accuses Twitch streamer Kai Cenat" accuses Kai Cenat)
      for (;;) {
        const role = toks[m.end + 1];
        const next = role && TN.ROLE.has(role.k) && !m.poss ? S.at.get(m.end + 2) : null;
        if (!next || next.start !== m.end + 2) break;
        m = next;
      }
      const head = m.poss ? toks.slice(m.end + 1).find((x) => !quiet(x)) : null;
      return m.poss ? { kind: 'poss', m, head: head ? head.st : null, preps } : { kind: 'name', m, preps };
    }
    if (m) continue;
    if (OBJECT_PRONOUN.has(t.k) && j === i + 1 && !only) return { ...pronounAt(S, j), preps };
    if (T.CONNECTIVE.has(t.k) || t.k === 'and') return null;
    if (PREPOSITION.has(t.k) || NOMINAL_AGAINST.has(t.k)) { preps.push(t.k); continue; }
    if (quiet(t)) continue;
    content += 1;
    if (content > GAP_MAX) return null;
  }
  return null;
}

/**
 * Who does and who is done to, for the word at `i`: { voice ('active', 'passive', 'nominal'), maker, target }. Each is a noun
 * phrase ({ kind: 'name' | 'poss' | 'owner' | 'pronoun', m, head, gap, preps, also }) or null when the sentence does not say there.
 * A word that reports a claim ("alleges", "claims") has a maker and no target: what it claims is read at its own words.
 */
function rolesAt(S, i) {
  if (isNominal(S, i)) {
    const left = leftOf(S, i);
    const owner = left && (left.kind === 'owner' || (left.kind === 'poss' && left.gap.length <= 2)) ? { kind: 'name', m: left.m, gap: [] } : null;
    return { voice: 'nominal', maker: owner || rightOf(S, i, NOMINAL_BY), target: rightOf(S, i, NOMINAL_AGAINST) };
  }
  const telling = /^(?:alleg|claim)/.test(S.toks[i].st);
  if (isPassive(S, i)) return { voice: 'passive', maker: rightOf(S, i, BY), target: telling ? null : leftOf(S, i) };
  return { voice: 'active', maker: leftOf(S, i), target: telling ? null : rightOf(S, i) };
}

/** Whether two noun phrases are the same one: the same name, the same owner's same thing, the same pronoun. */
function sameOne(a, b) {
  if (!a || !b) return false;
  if (a.also && sameOne(a.also, { ...b, also: null })) return true;
  if (b.also && sameOne({ ...a, also: null }, b.also)) return true;
  if (a.kind === 'pronoun' || b.kind === 'pronoun') return a.kind === b.kind && a.p === b.p;
  const plainA = a.kind === 'name' || a.kind === 'owner';
  const plainB = b.kind === 'name' || b.kind === 'owner';
  if (plainA !== plainB) return false;
  if (!T.sameName(a.m, b.m)) return false;
  return plainA || a.head === b.head;
}
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * Why the line's reading of one word disagrees with a source's, or null when it holds. line, source: rolesAt results for the same word.
 * The line may say less than its source (leave the doer out), never something else: a doer the source does not give that word, a
 * different one, another's possession made the owner's act, a thing between the doer and the act the source does not have there.
 */
function rolesDiffer(line, source) {
  if (line.maker) {
    if (!source.maker) { if (!line.maker.inherited) return 'the source does not say who did it'; } else {
      if (!sameOne(line.maker, source.maker)) return 'someone else does it in the source';
      const plain = line.voice === 'active' && source.voice === 'active' && !line.maker.inherited && !source.maker.inherited;
      if (plain && !sameSet(line.maker.gap || [], source.maker.gap || [])) return 'the source puts something else between who and what';
    }
  }
  if (line.target) {
    // (a noun's "against" may go unsaid in the source: then it only must not be the one who made the claim there)
    if (!source.target) return line.voice === 'nominal' && source.voice === 'nominal' && !(source.maker && sameOne(line.target, source.maker)) ? null : 'the source does not say who it was done to';
    if (!sameOne(line.target, source.target)) return 'it is done to someone else in the source';
    if (line.voice === source.voice && line.voice !== 'nominal' && !sameSet(line.target.preps || [], source.target.preps || [])) return 'the source joins them differently';
  }
  if (line.maker && source.target && !source.maker && sameOne(line.maker, source.target)) return 'the sides are changed over';
  return null;
}

/** Whether a name is the doer of anything a sentence says: what lets a line write "<name> says". */
function speaksIn(S, mention) {
  return S.toks.some((t, i) => (readable(S, i) || SAY.test(t.k)) && !S.names.has(i) && (() => { const r = rolesAt(S, i); return !!r.maker && (r.maker.kind === 'name' || r.maker.kind === 'owner') && T.sameName(r.maker.m, mention); })());
}

/** The quotes of a sentence: [{ id, from, to (token indexes), keys }]. */
function quotesOf(S) {
  const out = new Map();
  S.toks.forEach((t, i) => { if (!t.q) return; const q = out.get(t.q) || { id: t.q, from: i, to: i, keys: [] }; q.to = i; q.keys.push(t.k); out.set(t.q, q); });
  return [...out.values()];
}
/**
 * Who a sentence gives a quote to, when it says: the doer of the saying word before it ("Reggie says ...", "Ryan Garcia slams ..."),
 * else, for a quote that opens a headline ('"He's grooming RaKai": Reggie responds ...'), the first name after it. null when it
 * names nobody as saying it (a work's name in quotes has no speaker).
 */
function speakerOf(S, quote) {
  for (let j = quote.from - 1; j >= 0 && quote.from - j <= SCAN_MAX; j--) {
    const t = S.toks[j];
    if (S.names.has(j) || t.q || !SAY.test(t.k)) continue;
    const who = isPassive(S, j) ? rightOf(S, j, BY) : leftOf(S, j);
    if (who) return who;
  }
  // (a soundbite before its headline, '"...": Reggie responds'; a work's name that opens a sentence is nobody's words)
  if (quote.from !== 0 || !/[:,]/.test(S.toks[quote.to].post)) return null;
  const after = S.mentions.find((m) => m.start > quote.to);
  return after && !after.poss ? { kind: 'name', m: after } : null;
}

module.exports = { sentenceOf, rolesAt, rolesDiffer, sameOne, leftOf, rightOf, isPassive, isNominal, readable, verbShaped, speaksIn, quotesOf, speakerOf, NOMINAL, SAY };
