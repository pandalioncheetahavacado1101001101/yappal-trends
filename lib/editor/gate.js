'use strict';
/*
 * The gate (ios/IDEAS-FEED.md P3): whether an editor model's card may be shown. Rules, no model, and never looser than the claim
 * check (lib/lines.js), which it runs as it stands and then holds tighter:
 *   the line     the claim check on the sentences the model was shown (every name, number and word; each clause whole from one
 *                sentence; the same people on the same sides; the negation; reported stays reported; the denial; the title) and
 *                once more with every sentence the collector holds of the story behind them: a hedge, a denial or a later
 *                retraction in a sentence the model never saw still binds the line;
 *   its sources  every word of the line stands in the sentences its clauses rest on, and those are the ones published as its
 *                support: the check finds them itself, and a number the model gives is believed only when the check agrees;
 *   its parts    each an in-order cut of ONE shown sentence: a part that is none is told in that sentence's own wording, or left out;
 *   the reply    a sentence the model names as the accused side's reply is told in the line, and the answer any claim the line
 *                tells got, whoever the answering sentence calls the denier, is never dropped (`denialsOwed`);
 *   the title    "<name> <noun>": the row's own subject, every word it adds said by the line the gate passed, a number only when
 *                the line has it, and its noun said OF the subject there (outside a quotation, not denied, not someone else's, not
 *                a claim's unless the title ends in the claim's own noun: `titleReading`); then the claim check again under that
 *                title, by every rule, so a title is never surer than its line. A title that fails leaves the engine's standing:
 *                the line may still pass on its own. `whyNotTitle` is the one test, here and when a card is kept;
 *   the advice   the day it began (the cited sentence is dated that day), whether anything is new (the cited outlet sentence is of
 *                the last 24 hours), its kind, and whether it is trade, local, political or death news (only where the story's own
 *                outlet sentences bear it out: two of them say that family's words, or tell the subject's own death; local news is
 *                about nobody the engine or an outlet gives a public role): passed on with the sentence each rests on, for the
 *                ranking to weigh, never printed on a card.
 * `judgeLine` is the line's whole judge, the same for a card just written and for one kept from an earlier cycle, and for the
 * card's why and angles' clauses (lib/editor/ideas.js). How a part is worded (its sentence, its cut, its casing, the line the parts
 * print as) is lib/editor/wording.js, shared with them.
 * Pure: no clock (now is handed in), no I/O.
 */
const TN = require('../../engine/talk-nouns');
const TP = require('../../engine/talking-points');
const T = require('../line-text');
const RP = require('../line-replies');
const R = require('../line-roles');
const { checkLine, prepare, saysWhat, clausesOf, negatedAt, aheadGoverns } = require('../lines');
const RULES = require('../line-rules');
const COMPOSE = require('../line-compose');
const PROMPT = require('./prompt');
const D = require('./dossier');
const { keyOf } = require('../util');
const WD = require('./wording');
const { wordingOf, printed, asLater, headlineCased, sentenceCased, esc, hedged, cutLongest, FIT_WORDS, FIT_CHARS, CUTS_MAX } = WD;

const DAY_MS = 86400e3;
const TITLE_WORDS_MAX = 7;
const TITLE_CHARS_MAX = 60;
const NOUN_WORDS_MAX = 3;
const BARE_NAME_WORDS = 2;
const WHY_MAX = 600;
// how many wordings of one card are judged, and how many mendings deep: the model's own first, then the smallest mending that passes
const TRIES_MAX = 60;
const MEND_DEPTH = 4;
const CLAIMS_TRIED = 2;
// a clause that carries on from the one before it
const CONTINUES = /^(?:then|and|but|so|it|its|they|their|this|that|these|those|he|she|his|her)(?![\p{L}\p{N}])/iu;
const CLAIM_TOLD = /(?<![\p{L}\p{N}])(?:alleg\w+|accus\w+|claims?|claimed|sues?|sued|charged)(?![\p{L}\p{N}])/iu;
// what a thing people post is called: a word row's title may add one, when its page says it or it is what the row is
const THING_NOUN = new Set(['meme', 'memes', 'trend', 'sound', 'song', 'audio', 'challenge', 'format', 'filter', 'dance', 'edit', 'slang', 'craze', 'app', 'game']);
// small words a title may hold between its names and its noun ("Slow Tide by Ines Varga", "Close the window trend")
const TITLE_SMALL = new Set(['by', 'the', 'of', 'and', 'a', 'in', 'on', 'at', 'to', 'for', 'vs']);
// rules whose verdict is the same or stricter with more sentences in hand: a hedge, a denial and a staleness anywhere bind the line
const BINDING_BEHIND = new Set([8, 9, 12]);


const same = (a, b) => a.rule === b.rule && a.why === b.why;
/**
 * The line against the dossier: the claim check on the shown sentences, and again with the rest of the story behind them. What the
 * second finds of a hedge, a denial or a staleness is added; an act on record the first calls "stated flat" for want of a second
 * outlet is let through only when the story's other sentences supply it. { failures, carried: [index into shown, or -1] }.
 */
function checkAgainst(d, line, over = {}) {
  const kind = d.kind === 'word' ? 'word' : 'talk';
  const shown = checkLine({ ...D.inputsOf(d), ...over, line, kind, card: true });
  if (!d.behind.length) return { failures: shown.failures, carried: shown.carried };
  const all = checkLine({ ...D.inputsOf(d, { behind: true }), ...over, line, kind, card: true });
  const flat = (f) => f.rule === 8 && /stated flat: two outlets/.test(f.why);
  const failures = [...shown.failures.filter((f) => !flat(f) || all.failures.some((g) => same(f, g))), ...all.failures.filter((f) => BINDING_BEHIND.has(f.rule) && !shown.failures.some((g) => same(f, g)))];
  return { failures, carried: shown.carried };
}

/** Whether a line's first clause has a verb that says what was done: a claim's word, a past form, or a present form after who does it; never an -ing alone. */
function tellsSomethingDone(inputs, line) {
  // (who says so, hung on the end, is no part of what was done: ", reports say", ", police say")
  const first = String(line).split(/;\s/)[0].replace(/,\s+(?:[\p{L}’'-]+\s+){0,3}(?:say|says|said)\.?$/u, '');
  const ctx = prepare({ ...inputs, line: first });
  const { toks, names } = ctx.L;
  return toks.some((t, i) => {
    if (/ing$/.test(t.k) || ['reply', 'response', 'reaction', 'statement', 'update'].includes(t.k) || (i > 0 && toks[i - 1].poss) || !saysWhat(ctx.L, i)) return false;
    // (a word in -ed before a noun describes it, "naked reflection", "leaked footage"; after a name, or before a small word, it tells:
    // "Hale dropped ...", "shows cancelled amid ...")
    const next = toks[i + 1];
    return !/ed$/.test(t.k) || !!T.claimClass(t.k) || names.has(i - 1) || !next || !T.isContent(next) || T.CONNECTIVE.has(next.k) || !!next.num;
  });
}
/** Whether a line has `name` deny or dispute what is said of them, in its own words. */
function carriesReplyOf(line, name) {
  if (RP.replyOf(line, name)) return true;
  const last = String(name || '').trim().split(/\s+/).pop();
  return !!last && new RegExp(`(?<![\\p{L}\\p{N}])${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[’']s?\\s+\\S+)?\\s+(?:\\S+\\s+){0,2}?(?:den(?:y|ies|ied)|refut\\w+|disput\\w+|reject\\w+|rebut\\w*|dismiss\\w+)`, 'iu').test(line);
}
// a dispute said without the word "deny", of a claim by name: "hits back at ... claims", "calls BS on claim ...", "pushes back on the allegations"
const DISPUTES = new RegExp(`(?<![\\p{L}\\p{N}])(calls?|called|push(?:es|ed)|hits?|fires?|fired|claps?|clapped|shuts?|laughs?|laughed|brush(?:es|ed)|shrugs?|shrugged)\\s+(?:(?:bs|b\\.s\\.|bull\\S*|cap)\\s+on|back\\s+(?:on|against|at|over)|down|off)\\s+(?:[^\\s,;:—–]+\\s+){0,7}?[“"‘']?${RP.CLAIM}(?![\\p{L}\\p{N}])`, 'iu');
// the words a claim is told with: who makes it stands before them (or after "by")
const CLAIM_VERB = /^(?:alleges?|alleged|accuses?|accused|claims?|claimed|sues?|sued)$/;
const SAYS_VERB = /^(?:says?|said|tells?|told)$/;
const CLAIM_THING = /^(?:allegations?|accusations?|claims?|lawsuits?|complaints?)$/;
const ANSWER_SHARED = 2;
/** Where a sentence denies or disputes something: the token indexes of the words that do. Never a denial said not to be ("does not deny"). */
function deniesAt(S) {
  const out = S.toks.map((t, j) => (!S.names.has(j) && T.DENIES.test(t.k) && !/(?:ial|ials)$/.test(t.k) && !S.toks.slice(Math.max(0, j - 2), j).some((x) => T.NEG_GRAMMAR.has(x.k) || x.nt) ? j : -1)).filter((j) => j >= 0);
  const m = String(S.text || '').match(DISPUTES);
  const at = m ? S.toks.findIndex((t, j) => !S.names.has(j) && t.k === keyOf(m[1])) : -1;
  return at >= 0 ? [...out, at] : out;
}
/**
 * The claims a line tells: [{ claimant (a mention, or null when nobody is named as making it), words (what is claimed: the stems
 * and names of its part of the line, without the people) }]. A claim: someone alleges, accuses, claims or sues; someone is accused;
 * or someone named says something of someone else ("<name> says the shop treated her like ...").
 */
function claimsTold(ctx) {
  const { L } = ctx;
  const out = [];
  const subject = new Set(ctx.subjectKeys);
  for (const part of RULES.partsOf(L)) {
    let claim = null;
    for (let i = part.from; i <= part.to && !claim; i++) {
      const t = L.toks[i];
      if (L.names.has(i) || t.q) continue;
      const verb = CLAIM_VERB.test(t.k) && !R.isNominal(L, i);
      const says = SAYS_VERB.test(t.k);
      const thing = CLAIM_THING.test(t.k) && R.isNominal(L, i);
      if (!verb && !says && !thing) continue;
      const r = R.rolesAt(L, i);
      const who = r.maker && r.maker.m && r.maker.kind !== 'pronoun' && r.maker.kind !== 'poss' && r.maker.m.start >= part.from ? r.maker.m : null;
      // (a saying is a claim of someone only when it names them: "<name> says <someone else> ...")
      if (says && !(who && L.mentions.some((m) => m.start > i && m.end <= part.to && !T.sameName(m, who)))) continue;
      claim = { claimant: who };
    }
    if (!claim) continue;
    const people = new Set([...(claim.claimant ? claim.claimant.keys : []), ...subject]);
    const words = new Set();
    for (let i = part.from; i <= part.to; i++) {
      const t = L.toks[i];
      if (!T.isContent(t) || T.FREE.has(t.k) || t.num || t.k.length < 3 || people.has(t.k) || CLAIM_VERB.test(t.k) || SAYS_VERB.test(t.k) || CLAIM_THING.test(t.k)) continue;
      words.add(L.names.has(i) ? t.k : t.st);
    }
    out.push({ ...claim, words, part });
  }
  return out;
}
/**
 * The answers a line owes (reviewers, 2026-10-12: "<singer> says <shop> treated her like ..." passed alone while two outlets told
 * the shop's denial, because the denial called the shop "the store"). Any outlet sentence the collector holds that denies or
 * disputes something, names whoever makes the line's claim and shares a word of what is claimed, or shares two such words, is the
 * answer that claim got, whoever it calls the denier ("the store", "his attorney", "the streamer"). A line that tells the claim
 * tells that someone other than its maker denies or disputes it, or it does not tell the claim. Rule 9 reads the subject's own
 * denial; this reads everyone's. [{ n (index into the dossier's sentences, shown first), text }], the best answer of each claim.
 */
function denialsOwed(d, line) {
  if (d.kind === 'word') return [];
  const inputs = D.inputsOf(d, { behind: true });
  const ctx = prepare({ ...inputs, line });
  const claims = claimsTold(ctx);
  if (!claims.length) return [];
  const makerOf = (S, j) => { const r = R.rolesAt(S, j); return r && r.maker && r.maker.m && r.maker.kind !== 'pronoun' ? r.maker.m : null; };
  const byMaker = (claim, m) => !!claim.claimant && !!m && T.sameName(m, claim.claimant);
  // (the line carries an answer when someone other than the claim's maker denies or disputes in it)
  const lineDeniers = deniesAt(ctx.L).map((j) => makerOf(ctx.L, j));
  const out = [];
  for (const claim of claims) {
    if (lineDeniers.some((m) => !byMaker(claim, m))) continue;
    const answers = ctx.sources.filter((src) => src.type === 'outlet' && !src.question).map((src) => {
      const at = deniesAt(src.S);
      // (the claim's own maker denying something is no answer to their claim)
      if (!at.length || at.every((j) => byMaker(claim, makerOf(src.S, j)))) return null;
      const shared = [...claim.words].filter((w) => src.keys.includes(w) || src.stems.has(w)).length;
      const names = !!claim.claimant && src.keys.includes(claim.claimant.keys[claim.claimant.keys.length - 1]);
      return (names && shared >= 1) || shared >= ANSWER_SHARED ? { n: src.n, text: src.text, shared, shown: src.n < d.shown.length, t: src.t || 0 } : null;
    }).filter(Boolean).sort((a, b) => Number(b.shown) - Number(a.shown) || b.shared - a.shared || b.t - a.t);
    if (answers.length) out.push({ n: answers[0].n, text: answers[0].text });
  }
  return out.filter((x, i, all) => all.findIndex((y) => y.n === x.n) === i);
}

/** The family a title's noun belongs to (the engine's own list), or null for a noun of no family ("contract", "retirement"). */
function familyOfNoun(noun) {
  const k = String(noun || '').toLowerCase().trim();
  if (!k) return null;
  if (TN.FAMILY.has(k)) return k;
  // ("allegation" is the family of "allegations", "charge" of "charges": a title in the other number is read by the same rule)
  const same = (noun) => { const n = String(noun || '').toLowerCase(); return n === k || n === `${k}s` || `${n}s` === k; };
  const f = TN.FAMILIES.find((x) => { try { return typeof x.noun === 'function' && (x.re.test(k) || x.re.test(`${k}s`)) && (same(x.noun(k)) || same(x.noun(`${k}s`))); } catch { return false; } });
  return f ? f.key : null;
}
const loose = (st) => String(st || '').slice(0, 5);
/**
 * Why a model's title is no title by its shape, or null: "<name> <noun>", the row's own subject in it. A word row's: what its
 * page calls the thing, and no other word its line does not say. What a story's title SAYS is read by `titleReading`.
 */
function titleShape(d, title, line) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > TITLE_WORDS_MAX) return `${words.length} words: a title is a name and a noun`;
  if (title.length > TITLE_CHARS_MAX) return `${title.length} characters`;
  if (/[.!?:;]$/.test(title) || /[?!]/.test(title)) return 'a title has no punctuation of a sentence';
  const toks = T.tokensOf(title);
  const subjectKeys = T.tokensOf(d.subject).map((t) => t.k).filter(Boolean);
  const keys = toks.map((t) => t.k);
  if (!subjectKeys.every((k) => keys.includes(k))) return `it does not name ${d.subject}`;
  const engineKeys = new Set(T.tokensOf(d.title).map((t) => t.k));
  const lineToks = T.tokensOf(line);
  const lineStems = new Set(lineToks.map((t) => loose(t.st)));
  const lineKeys = new Set(lineToks.map((t) => t.k));
  const pageStems = new Set(d.shown.filter((s) => s.type === 'page').flatMap((s) => T.tokensOf(s.text).map((t) => loose(t.st))));
  // (the noun: the title's last words that are no part of the subject and are written small or are a thing's kind)
  let noun = 0;
  for (let i = toks.length - 1; i >= 0 && !subjectKeys.includes(toks[i].k) && noun < NOUN_WORDS_MAX; i--) noun += 1;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (subjectKeys.includes(t.k) || engineKeys.has(t.k) || TITLE_SMALL.has(t.k)) continue;
    if (d.kind === 'word') {
      // (a number only when the line has the same one)
      if (t.num) { if (!lineToks.some((x) => x.num && T.sameNumber(t.num, x.num))) return `the line does not have the number "${t.s}"`; continue; }
      // (a bare name gains the noun for what it is, "Sleepy otter meme"; a title that already says what it is, is left alone)
      if (THING_NOUN.has(t.k) && !engineKeys.has(t.k) && T.tokensOf(d.title).length > BARE_NAME_WORDS) return `"${d.title}" already says what it is`;
      if (THING_NOUN.has(t.k) && (pageStems.has(loose(t.st)) || lineStems.has(loose(t.st)) || keyOf(d.facts && d.facts.tier) === t.k || engineKeys.has(t.k))) continue;
      if (THING_NOUN.has(t.k)) return `nothing of its page calls it a ${t.s}`;
      if (lineKeys.has(t.k) || lineStems.has(loose(t.st))) continue;
      return `the line does not say "${t.s}"`;
    }
  }
  if (d.kind !== 'word' && !noun) return 'it has no noun after the name';
  return null;
}

// a claim's own noun: what a title ends in when its line only reports the thing ("<name> rape charge", "<name> abuse allegations")
const CLAIM_HEAD = /^(?:allegations?|accusations?|claims?|charges?|rumou?rs?|lawsuits?|suit|case|investigation|probe|complaints?|denial|trial)$/;
// what is done on record to someone as a claim, said before what it is a claim of: "charged with rape", "arrested for assault"
const CLAIM_LEAD = /^(?:charged|charges|arrested|sued|sues|indicted|investigat\w+|suspected|booked|questioned|probed|wanted|tried|cited)$/;
const isWrong = (k) => ['guilt', 'record'].includes(T.claimClass(k)) || TN.WRONGDOING.test(k);
const CLAIM_STEM = [/^(?:alleg|accus)/, /^(?:lawsuit|sue|suit)$/];
/** Whether a line's word says the claim a title's last word names: the same word, or "accused" for "allegations", "sues" for "lawsuit". */
const sameClaim = (head, x) => loose(head.st) === loose(x.st) || CLAIM_STEM.some((re) => re.test(head.st) && re.test(x.st));
/** The possessive that owns the word at `i` ("her husband's affair", "his arrest"), as a token index within three words before it; or -1. */
function ownerAt(L, i) {
  for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
    const t = L.toks[k];
    if (T.breaksAfter(t) || T.commaAfter(t)) return -1;
    if (t.poss || ['his', 'her', 'their', 'its'].includes(t.k)) return k;
    if (R.verbShaped(t) || (T.STOP.has(t.k) && !['the', 'a', 'an'].includes(t.k))) return -1;
  }
  return -1;
}
/**
 * What a model's title says, read against the line the gate passed (reviewers, 2026-10-12: a title was held only to words that
 * stood somewhere in the dossier, so a hostile video title supplied the noun: "<name> Fired" from a question nobody showed the
 * model, "<name> rapist" from the man's own "I'm not a rapist", "<name> 12 charges" with a count no line had). Why it may not
 * stand, or null:
 *   every word the title adds to the subject (and to the engine's own title) is said by the line, whatever its case; a number only
 *   when the line has the same number;
 *   its last word, the noun, stands in the line outside a quotation, not denied or said not to be, not as someone else's
 *   ("her husband's affair"), not as a claim's ("rape allegation", "accused of ...", "charged with ...") and not only looked ahead to;
 *   a wrongdoing or an act on record anywhere in it, and a noun of no family the engine reads, only where the line states it of
 *   the subject with no hedge at all;
 *   unless the title ends in the claim's own noun, which the line itself uses ("<name> rape charge", "<name> doping denial"):
 *   then it says no more than the line does.
 */
function titleReading(d, title, line) {
  const ctx = prepare({ ...D.inputsOf(d), line });
  const { L } = ctx;
  const toks = T.tokensOf(title);
  const subjectKeys = ctx.subjectKeys;
  const engineKeys = new Set(T.tokensOf(d.title).map((t) => t.k));
  const added = toks.filter((t) => !subjectKeys.includes(t.k) && !TITLE_SMALL.has(t.k) && !engineKeys.has(t.k));
  if (!added.length) return null;
  const head = toks[toks.length - 1];
  const claimHead = CLAIM_HEAD.test(head.k) && !subjectKeys.includes(head.k);
  const at = (t) => L.toks.map((x, i) => i).filter((i) => { const x = L.toks[i]; return t.num ? !!x.num && T.sameNumber(t.num, x.num) : x.k === t.k || loose(x.st) === loose(t.st) || (t === head && claimHead && !L.names.has(i) && sameClaim(t, x)); });
  for (const t of added) if (!at(t).length) return t.num ? `the line does not have the number "${t.s}"` : `the line does not say "${t.s}"`;
  if (claimHead || subjectKeys.includes(head.k)) return null;
  const clauses = clausesOf(L);
  const clauseOf = (i) => clauses.find((c) => i >= c.from && i <= c.to) || clauses[0];
  const own = (m) => !!m && T.sameName(m, ctx.subject);
  const others = (i) => { const k = ownerAt(L, i); if (k < 0) return null; const m = T.PRONOUN[L.toks[k].k] ? L.who.get(k) : L.at.get(k); return (T.PRONOUN[L.toks[k].k] ? !m : false) || own(m) ? null : L.toks[k]; };
  const claimed = (i) => { const c = clauseOf(i); return RULES.hedgedAt(L, c, i, () => true, { claimOnly: true }) || !!RULES.softAfter(L, i, 3) || L.toks.slice(c.from, i).some((x, n) => !L.names.has(c.from + n) && CLAIM_LEAD.test(x.k) && !L.toks.slice(c.from + n, i).some((y) => T.commaAfter(y))); };
  const ahead = (i) => !!RULES.softBefore(L, i) || aheadGoverns(L, i) || RULES.askedAt(L, i);
  // (said of the subject: the subject does it or it is done to the subject, in a form that says who; a bare noun only as the
  // subject's own, "<name>'s arrest", "arrest of <name>", or, when it names no wrongdoing, in a clause that is about the subject)
  const ofSubject = (i, wrong) => {
    if (!d.person) return true;
    const c = clauseOf(i);
    const k = ownerAt(L, i);
    if (k >= 0 && !others(i)) return true;
    const readable = R.readable(L, i) || R.isNominal(L, i);
    if (readable) {
      const r = R.rolesAt(L, i);
      const sides = [r.maker, r.target].filter((np) => np && np.m && np.kind !== 'pronoun');
      if (sides.some((np) => np.kind !== 'poss' && own(np.m))) return true;
      if (sides.length) return false;
    }
    const of = L.toks[i + 1] && L.toks[i + 1].k === 'of' ? L.mentions.find((m) => m.start > i + 1 && m.start <= i + 4) : null;
    if (own(of)) return true;
    if (wrong && !readable) return false;
    return own(c.mentions.find((m) => !m.poss) || c.heir);
  };
  const reading = (t, strict) => {
    const whys = at(t).map((i) => {
      if (L.toks[i].q) return `the line has "${t.s}" only in a quotation`;
      if (negatedAt(L, i)) return `the line says no by "${t.s}"`;
      const owner = others(i);
      if (owner) return `"${t.s}" is ${owner.s}’s in the line, not ${d.subject}’s`;
      if (claimed(i)) return `the line only reports "${t.s}" as a claim: end the title in the claim’s own noun`;
      if (ahead(i)) return `the line only looks ahead to "${t.s}"`;
      if (strict && (RULES.hedgedAt(L, clauseOf(i), i, () => true) || !ofSubject(i, isWrong(t.k)))) return `the line does not state "${t.s}" of ${d.subject}`;
      return null;
    });
    return whys.includes(null) ? null : whys[0];
  };
  const strictHead = isWrong(head.k) || (!familyOfNoun(head.k) && !engineKeys.has(head.k));
  const why = engineKeys.has(head.k) ? null : reading(head, strictHead);
  if (why) return why;
  for (const t of added) { if (t === head || t.num || !isWrong(t.k)) continue; const w = reading(t, true); if (w) return w; }
  return null;
}
/**
 * Why a model's title may not stand for dropping a word of the engine's own title that the passed line still says, or null
 * (2026-10-13: "<name> payment allegations" came back as "<name> allegations" over a line about the payments). The engine's noun,
 * its last word, may be swapped for one the line says ("allegations" to "lawsuit", read by `titleReading`); every other word of the
 * engine's title that the line still says stays in the title.
 */
function droppedWord(d, title, line) {
  if (d.kind === 'word') return null;
  const engine = T.tokensOf(d.title);
  if (engine.length < 2) return null;
  const mine = new Set(T.tokensOf(title).map((t) => t.k));
  const subjectKeys = new Set(T.tokensOf(d.subject).map((t) => t.k));
  const lineToks = T.tokensOf(line);
  const lineKeys = new Set(lineToks.map((t) => t.k));
  const lineStems = new Set(lineToks.map((t) => loose(t.st)));
  const noun = engine[engine.length - 1].k;
  for (const t of engine) {
    if (mine.has(t.k) || subjectKeys.has(t.k) || TITLE_SMALL.has(t.k) || t.k === noun) continue;
    if (lineKeys.has(t.k) || (t.st && lineStems.has(loose(t.st)))) return `it drops "${t.s}" from "${d.title}", which the line still says`;
  }
  return null;
}
/**
 * Why a model's title may not stand over a line the gate passed, or null: its shape, a word of the engine's title it drops
 * (`droppedWord`), what it says (`titleReading`), and then the claim check again under that title. The line passed under the engine's title, so whatever fails under this one is this
 * title's doing: any rule, not rules 10 and 11 alone. The gate and the keeping of a card (lib/editor/index.js) both ask this, so a
 * title is never shown one cycle and taken back the next.
 */
function whyNotTitle(d, title, line) {
  const shape = titleShape(d, title, line);
  if (shape || d.kind === 'word') return shape;
  const dropped = droppedWord(d, title, line);
  if (dropped) return dropped;
  const said = titleReading(d, title, line);
  if (said) return said;
  const under = checkAgainst(d, line, { title, family: familyOfNoun(title.trim().split(/\s+/).pop()), headline: null });
  return under.failures.length ? under.failures[0].why : null;
}

// what a line of trade news says: who runs, makes, sells or schedules a production; and what a line of politics says: an office
// or a vote. Never a word that is as often something else: an ad "campaign", a record "label", a "bill" or a "law" in a name, a
// show's "finale", a company's "CEO" (reviewers, 2026-10-12: an ad campaign was politics and took a live story off the list)
const TRADE_SAID = /(?<![\p{L}\p{N}])(?:showrunners?|studios?|networks?|box office|casting|cast as|recast|renew(?:s|ed|al)|greenlit|green-lit|sequel|reboot|spin-?off|distribut\w+|acquir\w+|merger|layoffs|streaming deal|development deal|release date|season \d+)(?![\p{L}\p{N}])/iu;
const POLITICS_SAID = /(?<![\p{L}\p{N}])(?:president|senators?|senate|congress\w*|governors?|ministers?|parliament|elections?|ballot|voters?|tariffs?|white house|supreme court|mayor|republicans?|democrats?)(?![\p{L}\p{N}])/iu;
const MORE_HEADLINES = 2;
// a role an outlet gives someone before the name: a public figure, whatever else the story is
const PUBLIC_ROLE = new Set([...TN.ROLE, 'musician', 'artist', 'athlete', 'creator', 'personality', 'celebrity', 'vlogger', 'podcaster', 'comic', 'author', 'icon', 'legend', 'champion', 'quarterback', 'coach', 'director', 'producer']);
const ROLE_BEFORE = 3;
const dayOfSource = (d, n) => (Number.isInteger(n) && n >= 1 && n <= d.shown.length && d.shown[n - 1].t > 0 ? d.shown[n - 1] : null);
/**
 * The model's judgments as advice, each with the sentence it rests on, checked as far as a rule can: a day it began is the day its
 * cited sentence is dated (a day either side), and that sentence is an outlet's or a reference page's (a post or a video dates
 * nothing); "new" is true only on a sentence of the last 24 hours, and carries that sentence's own time (`freshAt`, epoch seconds)
 * so that whoever reads the advice on a later cycle can see how old it has grown. Nothing here reaches a card.
 */
function adviceOf(d, card, { nowMs, src, line = '' }) {
  const out = {};
  if (card.kind) out.kind = card.kind;
  // ("Show more" is weighed like the rest of the advice: a label is passed on only where the story's own outlet sentences bear it
  // out, never on the model's word and one word of the line. Reviewers, 2026-10-12: "local" on a singer's cancelled concert and
  // "political" on an ad campaign each took a live story off the list.)
  //   local       the engine gives the row no creator or celebrity tier, and no outlet gives its subject a public role;
  //   political,  two of its outlet sentences, and the line itself, say that family's words;
  //   trade
  //   death       two of its outlet sentences tell the subject's own death, and the line says a death.
  // (the row's own sentences, where the dossier says which they are: what a search for the name returned is not the row's)
  const every = [...d.shown, ...d.behind];
  const marked = every.some((s) => s.own);
  const outlets = every.filter((s) => s.type === 'outlet' && (!marked || s.own));
  const said = (re) => re.test(line) && outlets.filter((s) => re.test(s.text)).length >= MORE_HEADLINES;
  const first = (T.tokensOf(d.subject)[0] || {}).k;
  const roleGiven = outlets.some((s) => { const ks = T.tokensOf(s.text).map((t) => t.k); const at = ks.indexOf(first); return at > 0 && ks.slice(Math.max(0, at - ROLE_BEFORE), at).some((k) => PUBLIC_ROLE.has(k)); });
  const tier = d.facts && d.facts.tier;
  const subjectKey = keyOf(d.subject);
  const deaths = outlets.filter((s) => TN.whoseDeath(subjectKey, TN.FAMILY.get('death'), [s.text]).own === 1).length;
  const fits = { local: card.kind === 'news' && tier !== 'creator' && tier !== 'celebrity' && !roleGiven, political: card.kind === 'news' && said(POLITICS_SAID), trade: (card.kind === 'news' || card.kind === 'celebrity') && said(TRADE_SAID),
    death: deaths >= MORE_HEADLINES && TN.FAMILY.get('death').re.test(line) };
  if (card.more && fits[card.more]) out.more = card.more;
  const b = dayOfSource(d, card.beganSrc);
  if (card.began && b && (b.type === 'outlet' || b.type === 'page') && Math.abs(Date.parse(`${card.began}T12:00:00Z`) - b.t) <= 1.5 * DAY_MS) { out.began = card.began; out.beganSrc = card.beganSrc; }
  const n = dayOfSource(d, card.newSrc);
  // ("new" rests on an outlet's sentence, as the day it began does: a post or a video dates nothing and proves nothing)
  if (card.isNew === true && n && n.type === 'outlet' && Number.isFinite(nowMs) && nowMs - n.t <= DAY_MS && nowMs - n.t >= -DAY_MS) { out.fresh = true; out.freshSrc = card.newSrc; out.freshAt = Math.floor(n.t / 1000); }
  else if (card.isNew === false) out.fresh = false;
  if (src.length) out.src = src;
  return out;
}

/** The number of the part a refusal is about (1-based), by the words the check quotes, or null. */
function partOf(why, parts) {
  const quoted = (String(why).match(/"([^"]{6,})"/) || [])[1];
  if (!quoted) return null;
  const head = keyOf(quoted).split(' ').slice(0, 3).join(' ');
  const at = parts.findIndex((p) => head && keyOf(p.text).includes(head));
  return at >= 0 ? at + 1 : null;
}
/** What a refused card is told to mend, in plain words a small model can act on: which part, and the sentence to copy it from. */
function hintsFor(failures, d, parts = []) {
  const out = new Set();
  for (const f of failures) {
    const quoted = (f.why.match(/"([^"]+)"/) || [])[1] || null;
    const n = partOf(f.why, parts);
    const part = n ? parts[n - 1] : null;
    const where = part ? `part ${n}${part.s ? ` (sentence ${part.s})` : ''}` : quoted ? `"${quoted}"` : 'a part';
    const copy = part && part.s ? `: copy sentence ${part.s}'s own words and change nothing but its case` : ': copy the sentence it names, word for word';
    if (f.rule === 1) out.add(/words, not|characters/.test(f.why) ? `${f.why}: use fewer or shorter parts` : f.why);
    else if (f.rule === 2 || f.rule === 3 || f.rule === 4) out.add(`${quoted ? `"${quoted}"` : 'a word'} is in none of the numbered sentences: use only their own words`);
    else if (f.rule === 5 && /another story|two stories/.test(f.why)) out.add(`${where} is another story: tell one accuser's story and leave the other out`);
    else if (f.rule === 5 && /joins what no one source joins/.test(f.why)) out.add('two parts are joined as if one caused the other: make them separate parts');
    else if (f.rule === 5) out.add(`${where} is not one sentence's own wording${copy}`);
    else if (f.rule === 6) out.add(`${where} changes who did what to whom${copy}`);
    else if (f.rule === 7) out.add(`${where} drops a "not" or a denial${copy}`);
    else if (f.rule === 8) out.add(`${where} is surer than its sentence (${f.why.slice(0, 140)}): keep the sentence's own hedge, plan or question as it stands, or leave the part out`);
    else if (f.rule === 9 && /named as the reply/.test(f.why)) out.add(f.why);
    else if (f.rule === 9 && /does not/.test(f.why)) out.add(`the last part must be the denial, copied from the sentence that carries it (${f.why.slice(0, 160)})`);
    else if (f.rule === 9) out.add(/admission/.test(f.why) ? 'leave "denies" out: the sentences carry an admission' : 'leave the denial out: no sentence gives one');
    else if (f.rule === 10) out.add('the parts must say what happened: who did or is accused of what, not only that there was a reaction or an allegation');
    else if (f.rule === 11 && /claim is not against the subject|does not say the title/.test(f.why)) out.add(`no part says what ${d.subject} did or is accused of: add the part in which that is said, in its sentence's own words, naming ${d.subject}`);
    else if (f.rule === 11) out.add(`the title says more than the parts: ${f.why.replace(/^the title "[^"]*" is surer than the line: /, '')}`);
    else if (f.rule === 12) out.add(`it is out of date: ${f.why}`);
    else out.add(f.why);
  }
  return [...out].slice(0, 4).join('; ').slice(0, WHY_MAX);
}

/**
 * One line against every rule the gate holds, the same for a card just written and for one kept from an earlier cycle
 * (lib/editor/index.js): the claim check with the story behind it; every word in the sentences the line rests on; a first clause
 * that tells something done; the reply the model named, told; and the answer of anyone whose claim the line tells.
 * { line, failures: [{ rule, why, answer? (index of the sentence that answers a claim) }], src: [indexes into d.shown] }.
 * named: the numbers of the shown sentences the card's parts name (null for a kept card, whose parts' numbers are of another
 * day's dossier: its words are then held to the shown sentences by the claim check alone); replyAt: the number the model gave
 * as the reply, or null.
 */
function judgeLine(d, line, { named = [], replyAt = null } = {}) {
  const inputs = D.inputsOf(d);
  const first = checkAgainst(d, line);
  const failures = [...first.failures];
  const src = [...new Set(first.carried.filter((n) => Number.isInteger(n) && n >= 0 && n < d.shown.length))];
  if (!failures.length && d.kind !== 'word' && src.length && named) {
    const rests = [...new Set([...src, ...named.map((n) => n - 1)])].map((n) => d.shown[n]).filter(Boolean);
    const own = checkLine({ ...inputs, sources: rests, line, kind: 'talk', card: true });
    for (const f of own.failures.filter((x) => x.rule >= 2 && x.rule <= 4)) failures.push({ rule: f.rule, why: `${f.why} that the line rests on` });
  }
  // (a card tells something done: its first clause has a verb that says so. "Dale Okafor’s four-word reply after accidentally
  // sharing ..." is a headline's label, and the claim check, which reads claims, has no quarrel with a label)
  if (d.kind !== 'word' && !failures.length && !tellsSomethingDone(inputs, line)) failures.push({ rule: 10, why: 'its first part is a label, not a sentence: no verb says what was done' });
  if (d.kind !== 'word') {
    // (told from the sentence the model named, or from another in which the subject answers: what must not happen is a card
    // whose model saw a reply and whose line carries none)
    const answered = () => carriesReplyOf(line, d.subject) || !!TN.denialClause(line, keyOf(d.subject), null, d.subject, 10);
    if (replyAt !== null && !failures.length && !src.includes(replyAt - 1) && !answered()) failures.push({ rule: 9, why: `sentence ${replyAt} is named as the reply and no part tells it: make it the last part, in its own words` });
    for (const owed of denialsOwed(d, line)) failures.push({ rule: 9, why: `the claim was answered ("${owed.text.slice(0, 120)}") and the line does not say so`, answer: owed.n });
  }
  return { line, failures, src };
}

/**
 * The gate. card: lib/editor/prompt.js `parseCard`; d: lib/editor/dossier.js `dossierOf`; lex: the build's lexicon (how a Title
 * Case headline is set in sentence case). The model says which sentences tell the story and in what order, and words each part;
 * the line is its parts joined, and it must pass every rule whole. Where a part as the model worded it does not pass, the same
 * part in its own sentence's words is tried (the rule-built wording of that one sentence), "reportedly" before a word its sentences
 * hedge, the longest part cut at its last clause, then the card without a part: each such line is checked whole, exactly as the
 * model's own, and the first that passes is the card. Returns
 * { ok, failures: [{ rule, why }] (of the card as the model wrote it), why (what to mend, for the one second try), card: { line,
 *   title (null: the engine's stands), src: [numbers of the shown sentences its clauses rest on], reply, advice, by ('as written' |
 *   'reworded from its sentences' | 'shortened') }, titleWhy }.
 */
function gate(card, d, { nowMs = NaN, lex = null, debug = null } = {}) {
  if (!card || !Array.isArray(card.parts) || !card.parts.length) return { ok: false, failures: [{ rule: 1, why: 'no parts' }], why: 'reply with the JSON object, with "parts"', card: null };
  // (the dossier's wording tools, lib/editor/wording.js: the same for the card's parts and for the why and angles' clauses)
  const { inputs, names, valid, sourceText, cased, fromOf, isCut, print } = wordingOf(d, lex);
  // (mine: a part the model chose. A card that keeps none of them is not the model's card, whatever else could be made to pass)
  // (a part is an in-order cut of ONE shown sentence, as the prompt asks: its words in its order, nothing swapped in, nothing
  // turned around. A part that is none, "‘repeated disturbance’ from actor <name>" made of a sentence in which a fan made the
  // disturbance and the actor answered it, is told in its sentence's own wording, or left out when it has none. Reviewers,
  // 2026-10-12: only verbs were read for who did what, so a reordered noun phrase passed as written)
  const made = card.parts.map((p) => { const n = fromOf(p); const own = sourceText(n); const cut = isCut(p.text, n); return { s: n, text: cut ? cased(p.text, own) : own, own, mine: true, cut: true, reworded: !cut }; });
  const parts = made.filter((p) => p.text).filter((p, i, all) => all.findIndex((x) => keyOf(x.text) === keyOf(p.text)) === i);
  if (!parts.length) {
    const why = 'no part is a cut of one numbered sentence: copy a sentence’s own words in their own order and cut the rest, changing nothing but the case';
    return { ok: false, failures: [{ rule: 5, why }], why, card: null, line: PROMPT.lineOf(card.parts) };
  }
  const replyAt = valid(card.reply);
  /** One line against every rule (`judgeLine`): the claim check with the story behind it, its words in the sentences it rests on, the replies. */
  const judge = (line, named) => judgeLine(d, line, { named, replyAt });
  // (the sentence in which the subject denies or disputes what is said: the newest the model was shown, as a clause of its own words)
  const owed = d.kind === 'word' ? null : d.shown.map((x, i) => ({ x, i })).filter(({ x }) => x.type === 'outlet' && !/\?\s*["”’']?$/.test(x.text))
    // (cut from a headline set in capitals, the clause is set in sentence case as any part is: "Voss calls BS on the claim")
    .map(({ x, i }) => { const reply = RP.replyOf(x.text, d.subject); const own = sourceText(i + 1); return reply && reply.kind !== 'answer' ? { s: i + 1, text: headlineCased(x.text) ? sentenceCased(reply.clause, names) : reply.clause, own } : own && TN.denialClause(x.text, keyOf(d.subject), null, d.subject, 10) ? { s: i + 1, text: own, own } : null; })
    .find(Boolean) || null;
  // (the sentences in which someone makes a claim of the subject: what a card about a claim cannot do without)
  const subjectKeys = T.tokensOf(d.subject).map((t) => t.k).filter(Boolean);
  const claims = d.kind === 'word' ? [] : d.shown.map((x, i) => ({ x, i })).filter(({ x }) => x.type === 'outlet' && !/\?\s*["”’']?$/.test(x.text) && CLAIM_TOLD.test(x.text) && TP.claimedOf(x.text, keyOf(d.subject)))
    .map(({ i }) => ({ s: i + 1, text: sourceText(i + 1), own: sourceText(i + 1) })).filter((c) => c.text);
  // The card as the model worded it. Where that does not pass, the nearest card that does, by the smallest mending first, each
  // judged whole exactly as the model's own: "reportedly" set before a word the check says its sentences hedge; a part in its own
  // sentence's words; the longest part cut at its last clause when the card runs long; a part left out (never the last one left).
  const start = { parts: parts.map((p) => ({ ...p })), by: made.some((p) => p.reworded) ? 'reworded from its sentences' : 'as written' };
  // (what a refused card is told first: which of its parts was no cut)
  const notCut = made.map((p, i) => (p.reworded ? i + 1 : 0)).filter(Boolean);
  const cutHint = notCut.length ? `part ${notCut.join(' and ')} is not a cut of one sentence (a word swapped in, or its words turned around): copy the sentence’s own words in their own order; ` : '';
  const stateKey = (st) => st.parts.map((p) => p.text).join('|');
  const seen = new Set([stateKey(start)]);
  let queue = [start];
  let first = null;
  let passed = null;
  let judged = 0;
  const rank = { 'as written': 0, 'reworded from its sentences': 1, shortened: 2 };
  const worse = (x, y) => (rank[x] >= rank[y] ? x : y);
  for (let depth = 0; depth <= MEND_DEPTH && queue.length && !passed; depth++) {
    const next = [];
    for (const st of queue) {
      if (judged >= TRIES_MAX) break;
      judged += 1;
      const r = judge(print(st.parts), st.parts.map((p) => p.s).filter(Boolean));
      if (debug) debug(depth, st.by, r);
      if (!first) first = r;
      if (!r.failures.length) { passed = { ...r, by: st.by }; break; }
      const push = (ps, by) => { const n = { parts: ps, by: worse(st.by, by) }; const k = stateKey(n); if (ps.length && ps.every((p) => p.text) && ps.some((p) => p.mine) && !seen.has(k)) { seen.add(k); next.push(n); } };
      const at = (why) => { const n = partOf(why, st.parts); return n ? n - 1 : null; };
      // a part the check names, in its own sentence's words; then every part so
      for (const f of r.failures) { const i = at(f.why); if (i !== null && st.parts[i].own && st.parts[i].own !== st.parts[i].text) push(st.parts.map((p, k) => (k === i ? { ...p, text: p.own } : p)), 'reworded from its sentences'); }
      if (st.parts.some((p) => p.own && p.own !== p.text)) push(st.parts.map((p) => (p.own ? { ...p, text: p.own } : p)), 'reworded from its sentences');
      // every hedge the check asks for and the cut a long card needs, at once: they mend different failures
      let all = st.parts;
      const needs = r.failures.some((f) => (f.rule === 8 && /hedges "|is stated flat/.test(f.why)) || (f.rule === 1 && /words, not|characters$/.test(f.why)));
      if (needs && all.some((p) => !p.cut && p.own && p.own !== p.text)) all = all.map((p) => (!p.cut && p.own ? { ...p, text: p.own, cut: true } : p));
      for (const f of r.failures) {
        const word = f.rule === 8 ? (f.why.match(/hedges "([^"]+)" and the line does not|^"([^"]+)" is stated flat/) || []).slice(1).find(Boolean) : null;
        if (word) all = all.map((p) => (hedged(p.text, word) === p.text ? p : { ...p, text: hedged(p.text, word) }));
      }
      // (as many tails as it takes to fit: a card of three headlines is three tails too long)
      if (r.failures.some((f) => f.rule === 1 && /words, not|characters$/.test(f.why))) {
        const fits = (ps) => { const text = ps.map((p) => p.text).join('; '); return text.split(/\s+/).length <= FIT_WORDS && text.length <= FIT_CHARS; };
        for (let n = 0; n < CUTS_MAX && !fits(all); n++) { const cut = cutLongest(all); if (!cut) break; all = cut; }
      }
      if (all !== st.parts) push(all, 'reworded from its sentences');
      // the subject's denial the card owes: the replying sentence's own clause as the last part (in place of a third)
      if (owed && r.failures.some((f) => f.rule === 9 && /carry the subject’s denial/.test(f.why)) && !st.parts.some((p) => p.s === owed.s)) {
        push([...st.parts.slice(0, PROMPT.PARTS_MAX - 1), owed], 'reworded from its sentences');
        if (st.parts.length > 1) push([st.parts[0], owed], 'reworded from its sentences');
      }
      // the answer a claim got from someone else, when a shown sentence holds it: that sentence's own wording as the last part
      for (const f of r.failures.filter((x) => x.rule === 9 && Number.isInteger(x.answer) && x.answer < d.shown.length)) {
        // (the sentence as it stands, set in sentence case: the engine's plain wording of it, "responds to", would lose the denial)
        const text = cased(String(d.shown[f.answer].text).replace(/[.!]+$/, ''), null);
        if (!text || st.parts.some((p) => p.s === f.answer + 1)) continue;
        const answer = { s: f.answer + 1, text, own: text, mine: false, cut: true };
        push([...st.parts.slice(0, PROMPT.PARTS_MAX - 1), answer], 'reworded from its sentences');
        if (st.parts.length > 1) push([st.parts[0], answer], 'reworded from its sentences');
      }
      // under a title that is a claim of the subject, the part that names the subject leads ("Mara Voss pushes back on ...; Hale ...")
      if (r.failures.some((f) => f.rule === 11 && /claim is not against the subject/.test(f.why))) {
        const last = subjectKeys[subjectKeys.length - 1];
        // (the part that opens on the subject, before one that only names it)
        const opens = (p) => T.tokensOf(p.own || p.text).slice(0, 3).some((t) => t.k === last);
        const lead = st.parts.findIndex((p, k) => k > 0 && opens(p));
        const i = lead > 0 ? lead : st.parts.findIndex((p, k) => k > 0 && T.tokensOf(p.own || p.text).some((t) => t.k === last));
        // (the subject's own reply leads, then what the model chose: "Mara Voss pushes back on ...; Hale threatens ...")
        if (owed && !st.parts.some((p) => p.s === owed.s)) {
          const reply = { ...owed, text: owed.own || owed.text };
          push([reply, st.parts[0]], 'reworded from its sentences');
          push([reply, ...st.parts].slice(0, PROMPT.PARTS_MAX), 'reworded from its sentences');
        }
        if (i > 0) push([{ ...st.parts[i], text: st.parts[i].own && !new RegExp(`(?<![\\p{L}])${esc(d.subject)}(?![\\p{L}])`, 'iu').test(st.parts[i].text) ? st.parts[i].own : st.parts[i].text }, ...st.parts.filter((_, k) => k !== i)], 'reworded from its sentences');
      }
      // what is claimed of the subject, when no part says it: the claim's own sentence between the model's first part and the denial
      if (r.failures.some((f) => (f.rule === 10 && /never says what is alleged/.test(f.why)) || (f.rule === 11 && /claim is not against the subject|does not say the title/.test(f.why)))) {
        const told = new Set(st.parts.map((p) => p.s));
        const mine = new Set(st.parts.flatMap((p) => T.tokensOf(p.text).filter((t) => t.cap && names.has(t.k)).map((t) => t.k)).filter((k) => !subjectKeys.includes(k)));
        const shares = (c) => T.tokensOf(c.text).some((t) => mine.has(t.k));
        // (a claim by someone the model's own parts name, when there is one: another accuser's is another story)
        const open = claims.filter((x) => !told.has(x.s));
        for (const c of (open.some(shares) ? open.filter(shares) : open).slice(0, CLAIMS_TRIED)) {
          push([st.parts[0], c, ...(owed && owed.s !== c.s && !told.has(owed.s) ? [owed] : st.parts.slice(1, 2))].slice(0, PROMPT.PARTS_MAX), 'reworded from its sentences');
          push([st.parts[0], c], 'reworded from its sentences');
        }
      }
      // a part left out: the one the check names first, then the last, then each other
      if (st.parts.length > 1) {
        const named = [...new Set(r.failures.map((f) => at(f.why)).filter((i) => i !== null))];
        // (what is left must stand on its own: never a card that opens on "Then it ...", "It ...", "They ..." with what that was gone)
        for (const i of [...named, ...st.parts.map((_, k) => st.parts.length - 1 - k)]) { const left = st.parts.filter((_, k) => k !== i); if (!CONTINUES.test(left[0].text)) push(left, 'shortened'); }
      }
    }
    queue = next;
  }
  // (the denial a line owes, when the model left it out: the replying sentence's own clause, as the rule-built line adds it)
  if (!passed && d.kind !== 'word' && first && first.failures.length && first.failures.every((f) => f.rule === 9)) {
    const base = print(start.parts);
    const replied = COMPOSE.withReply(inputs, lex, base);
    // (the model's own line with the reply after it: never the replying sentence in its place)
    if (replied && replied.line !== base && replied.line.startsWith(base.replace(/[.]$/, ''))) { const r = judge(replied.line, start.parts.map((p) => p.s).filter(Boolean)); if (!r.failures.length) passed = { ...r, by: 'reworded from its sentences' }; }
  }
  if (!passed) return { ok: false, failures: first.failures, why: `${cutHint}${hintsFor(first.failures, d, parts)}`.slice(0, WHY_MAX), card: null, line: first.line };
  const { line } = passed;
  // the title: the model's when it holds, else the engine's
  let title = null;
  let titleWhy = null;
  if (card.title && keyOf(card.title) !== keyOf(d.title)) {
    titleWhy = whyNotTitle(d, card.title, line);
    if (!titleWhy) title = card.title;
  }
  const numbers = passed.src.map((n) => n + 1);
  return { ok: true, failures: [], why: null, titleWhy,
    card: { line, title, src: numbers, reply: replyAt !== null && numbers.includes(replyAt) ? replyAt : null, advice: adviceOf(d, card, { nowMs, src: numbers, line }), by: passed.by } };
}

module.exports = { gate, checkAgainst, judgeLine, whyNotTitle, titleReading, denialsOwed, claimsTold, titleShape, familyOfNoun, adviceOf, hintsFor, printed, asLater };
