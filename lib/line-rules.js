'use strict';
/*
 * The claim check's rules that are decided over all the sources at once (ios/IDEAS-FEED.md G3 rules 8 to 12): reported stays
 * reported, the denial is the subject's own, the line says what happened, the title is not surer than the line, and the line does
 * not tell an angle the sources have since moved on from. They lean on the engine's own wording rules, so a written line is held to
 * what a headline line already is. Pure: no clock, no I/O.
 */
const TN = require('../engine/talk-nouns');
const TP = require('../engine/talking-points');
const T = require('./line-text');
const R = require('./line-roles');
const RP = require('./line-replies');
const SAID = require('./line-said');
const { saidTail, attributedAt, TAIL_SAYS, TAIL_MAX, SAYING } = SAID;

const OUTLETS_TO_STATE = 2;
const SAYS_WHAT_WORDS = 4;
const SAID_WORDS = 2;
const HEADLINE_SAYS_WHAT_WORDS = 3;
const HEDGE_NEAR = 4;
// (two sources dated to the hour say their own order: no slack. The newer-says-the-opposite test keeps half a day's)
const ORDER_SLACK_MS = 0;
const OPPOSITE_SLACK_MS = 12 * 3600 * 1000;
const STORY_SHARED_WORDS = 2;
const NO_ONE = new Set(['twitch', 'kick', 'youtube', 'tiktok', 'instagram', 'x', 'twitter', 'netflix', 'reddit', 'snl', 'streamer', 'youtuber', 'tiktoker']);
// titles that are a claim against their subject (the engine's own list)
const CLAIM_TITLED = new Set(['allegations', 'arrest', 'threats', 'scam', 'rumors']);
const LEAD_WORDS = 6;

const familyOf = (key) => (key && TN.FAMILY.get(key)) || null;
// how a sentence tells a backlash as it happens: who slams, blasts, criticises or calls out
const BACKLASH_TOLD = /\b(?:slams?|blasts?|rips?|drags?|condemns?|criticis\w+|criticiz\w+|calls? out|called out|under fire|hits? back at|outraged?|furious|angers?|angry)\b/i;

// ---------- rule 8: reported stays reported ----------
// (an "accuser" is who someone is, not a hedge on what the line says of them: "Tobin Hale accuser was forced to ..." states it)
const HEDGE_WORD = /^(?:accus(?!ers?$)\w+|alleg\w+|reportedly|claims?|claimed|claiming|suspect\w*|rumou?r\w*|den(?:y|ies|ied|ial|ials|ying)|investigat\w+|unconfirmed|possible|possibly|according|apparently|supposedly|purportedly|seemingly)$/;
// (in a SOURCE the word still marks what stands by it as someone's account: the line that takes those words hedges them itself)
const SOURCE_HEDGE = /^accusers?$/;
// a hedge that says only that it is reported, of the whole clause: it cannot stand in for the claim's own noun ("misconduct
// allegations" is never "reportedly ... misconduct")
const HEDGE_ADVERB = /^(?:reportedly|allegedly|apparently|supposedly|purportedly|seemingly|possible|possibly|unconfirmed|according)$/;
const CLAIM_NOUN = /^(?:allegations?|claims?|accusations?|charges?|rumou?rs?|lawsuit|suit|case|investigation|probe|complaints?)$/;
/**
 * Whether the word at `i` is told as reported, in its own clause `c`: a hedging word before it ("accused of", "alleged", "allegedly",
 * "denies") or someone given as saying it; a claim's noun right after it ("abuse allegations"); or who says so after a comma at the
 * clause's end (", police say", ", Reggie alleges": `saidTail`). A hedge elsewhere hedges something else: "Abuser Kai Cenat responds
 * to abuse allegations" states the first word flat. claimOnly: a hedge that names the claim ("accused of", "alleged", a claim's
 * noun, who says so); "reportedly" and its kind, which say only that something is reported, do not count.
 */
function hedgedAt(L, c, i, saidBy = () => true, { claimOnly = false } = {}) {
  const { toks } = L;
  for (let j = c.from; j < i; j++) {
    if (L.names.has(j) || (toks[j].q && toks[j].q !== toks[i].q)) continue;
    if (claimOnly && HEDGE_ADVERB.test(toks[j].k)) continue;
    // (what someone admits to is told as theirs: "admits to assault"; a "says" hedges only when a source has that one saying it)
    const hedge = HEDGE_WORD.test(toks[j].k) || T.ADMIT.test(toks[j].k) || (SAYING.has(toks[j].k) && R.leftOf(L, j) && saidBy(j));
    if (hedge && governs(L, c, j, i)) return true;
  }
  if (toks.slice(i + 1, Math.min(c.to, i + 2) + 1).some((t) => CLAIM_NOUN.test(t.k))) return true;
  if (!claimOnly && tailHedged(L)) return true;
  for (let j = i + 1; j <= c.to; j++) {
    if (!T.commaAfter(toks[j - 1]) || c.to - j >= TAIL_MAX) continue;
    // (who says so, and nothing else: a tail that tells something more is no attribution. "..., sparking backlash and a police report")
    const tail = toks.slice(j, c.to + 1);
    if (tail.some((t, n) => TAIL_SAYS.test(t.k) && !L.names.has(j + n)) && !tail.some((t, n) => !L.names.has(j + n) && !TAIL_SAYS.test(t.k) && t.k !== 'according' && R.verbShaped(t))) return true;
  }
  return false;
}
/** Where the who-says-so tail of the part of a line that holds `i` begins (the part runs from one semicolon, colon or dash to the next), or -1. */
function partTail(L, i) {
  let from = i;
  while (from > 0 && !T.breaksAfter(L.toks[from - 1])) from -= 1;
  let to = i;
  while (to < L.toks.length - 1 && !T.breaksAfter(L.toks[to])) to += 1;
  return saidTail(L, from, to);
}
const HEDGE_PARTICIPLE = /^(?:accused|alleged|suspected|rumou?red|claimed|unconfirmed|possible|purported|supposed|apparent)$/;
const AFTER_PARTICIPLE = new Set(['of', 'by', 'to', 'in', 'for', 'that', 'over', 'with', 'as', 'on', 'at']);
const DETERMINER = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'this', 'that']);
const ADJECTIVE_REACH = 2;
/**
 * Whether the hedge at `h` governs the word at `i` after it, in the clause `c` (rule 8, as built 2026-10-12): no comma between
 * them (an aside's two commas apart), and the hedge is no mere describing word. "Accused streamer Kai Cenat assaulted a fan" hedges
 * nothing of the assault: a hedging participle that opens its clause or follows "the" and stands right before what it describes
 * reaches the two words after it and no further ("an alleged investment fraud"). "allegedly", "is accused of", "alleges ..." and a
 * sourced "says" govern what follows them in the clause.
 */
function governs(L, c, h, i) {
  const { toks } = L;
  const hedge = toks[h];
  const prev = h > c.from ? toks[h - 1] : null;
  const next = toks[h + 1];
  const describes = HEDGE_PARTICIPLE.test(hedge.k) && (!prev || DETERMINER.has(prev.k) || T.CONNECTIVE.has(prev.k)) && !!next && !AFTER_PARTICIPLE.has(next.k);
  if (describes) {
    let reach = 0;
    for (let j = h + 1; j <= i; j++) {
      if (T.commaAfter(toks[j - 1]) && j - 1 > h) return false;
      if (!T.isContent(toks[j]) || T.FREE.has(toks[j].k)) continue;
      reach += 1;
      if (reach > ADJECTIVE_REACH) return false;
      // (what it describes ends at the name it leads to: "accused streamer Kai Cenat" stops there)
      if (L.names.has(j) && j < i) return false;
    }
    return true;
  }
  // (a comma between them ends the hedge's reach, unless it only closes an aside the hedge stands after: ", Gorgeous Doll, alleges")
  for (let j = h; j < i; j++) if (T.commaAfter(toks[j])) return false;
  return true;
}
/**
 * Whether a sentence hedges all it says with a word at its very end: "..., reportedly", "... not The Flash (rumor)", "...: report".
 * Only "reportedly" or "allegedly" as its last word, or a hedging word set off from the sentence (in brackets, or after a comma, a
 * colon or a dash). A noun the sentence happens to end on hedges nothing: "... sparking backlash and a police report".
 */
const TAIL_ADVERB = /^(?:reportedly|allegedly)$/;
const TAIL_HEDGE = /^(?:reportedly|allegedly|rumou?rs?|rumou?red|unconfirmed|reports?)$/;
function tailHedged(S) {
  const n = S.toks.length;
  if (!n) return false;
  const last = S.toks[n - 1];
  if (TAIL_ADVERB.test(last.k)) return true;
  if (!TAIL_HEDGE.test(last.k)) return false;
  const before = S.toks[n - 2];
  return /[()[\]]/.test(last.pre + last.post) || (!!before && (T.commaAfter(before) || T.breaksAfter(before)));
}
/** Whether a source hedges its word at `j`: a hedging word within four words before it, in the same part of the sentence, or at the sentence's very end. */
function hedgeNear(S, j) {
  if (tailHedged(S) && j < S.toks.length - 2) return true;
  for (let k = j - 1, seen = 0; k >= 0 && seen < HEDGE_NEAR; k--) {
    const t = S.toks[k];
    // ("Apparently, a man jumped ...": a hedge that opens a sentence hedges what follows its comma)
    if (HEDGE_WORD.test(t.k) && !S.names.has(k) && T.commaAfter(t) && /ly$/.test(t.k)) return true;
    if (T.breaksAfter(t) || T.commaAfter(t) || T.CONNECTIVE.has(t.k)) return false;
    if (S.names.has(k)) continue;
    if (HEDGE_WORD.test(t.k) || SOURCE_HEDGE.test(t.k)) return true;
    seen += 1;
  }
  return false;
}
const COMPLEMENT_WORDS = 2;
/**
 * The words of a source its own hedge covers: for each hedging word, the next two content words after it in its part of the sentence
 * ("accused of explicit chats": explicit, chats; "allegedly sending explicit messages": sending, explicit). Set of token indexes.
 */
function hedgedComplement(S) {
  const out = new Set();
  S.toks.forEach((t, h) => {
    if (S.names.has(h) || !(HEDGE_WORD.test(t.k) || SOURCE_HEDGE.test(t.k))) return;
    let seen = 0;
    for (let j = h + 1; j < S.toks.length && seen < COMPLEMENT_WORDS; j++) {
      if (T.breaksAfter(S.toks[j - 1]) || (T.commaAfter(S.toks[j - 1]) && j - 1 > h) || T.CONNECTIVE.has(S.toks[j].k)) break;
      if (S.names.has(j) || !T.isContent(S.toks[j]) || T.FREE.has(S.toks[j].k) || S.toks[j].num) continue;
      out.add(j);
      seen += 1;
    }
  });
  return out;
}
/** Whether a clause of the line carries any hedge at all: a hedging word, an admission, a sourced "says", a hedging tail. */
function clauseHedged(L, c, saidBy) {
  if (tailHedged(L) || partTail(L, c.to) > c.to || saidTail(L, c.from, c.to) >= 0) return true;
  for (let j = c.from; j <= c.to; j++) {
    if (L.names.has(j)) continue;
    if (HEDGE_WORD.test(L.toks[j].k) || T.ADMIT.test(L.toks[j].k) || CLAIM_NOUN.test(L.toks[j].k) || TAIL_SAYS.test(L.toks[j].k) || (SAYING.has(L.toks[j].k) && R.leftOf(L, j) && saidBy(j))) return true;
  }
  return false;
}
/**
 * Whether a source says the act at `i` of the very one the line says it of (rule 8: "reportedly" hedges a claim, it never makes
 * one). An arrest and a death by the engine's own readings of whose they are; anything else by the source having the word in a form
 * that says who, of the same one.
 */
function saidOfSame(ctx, more, i) {
  const t = ctx.L.toks[i];
  const who = actOf(ctx, more, i);
  const last = who.split(' ').slice(-1)[0];
  if (t.st === 'arrest') return ctx.sources.some((src) => src.keys.includes(last) && src.stems.has('arrest') && (TP.arrestOf(src.text, who) === 'own' || TP.arrestGiven(src.text, who)));
  if (t.st === 'die') return ctx.sources.some((src) => { const d = TN.whoseDeath(who, TN.FAMILY.get('death'), [src.text]); return d.own === 1; });
  return true;
}
/**
 * Whether the subject owned up to the act at `i` (rule 8): a source has an admitting word with the subject as its maker, and the
 * act's own word after it in that part of the sentence ("Jacob Geller admits to assault"). Another act, or another's, keeps its hedge.
 */
function ownedUp(ctx, more, i) {
  if (!ctx.input.admitted) return false;
  const t = ctx.L.toks[i];
  return ctx.sources.some((src) => src.S.toks.some((x, a) => {
    if (src.S.names.has(a) || !T.ADMIT.test(x.k)) return false;
    const r = more.rolesIn(src.S, a);
    if (r.maker && r.maker.kind !== 'pronoun' && r.maker.m && !T.sameName(r.maker.m, ctx.subject)) return false;
    for (let j = a + 1; j < src.S.toks.length; j++) {
      if (T.breaksAfter(src.S.toks[j - 1]) || T.CONNECTIVE.has(src.S.toks[j].k) || src.S.toks[j].k === 'as') return false;
      if (src.S.toks[j].st === t.st) return true;
    }
    return false;
  }));
}
/**
 * Whether the word at `i` is about someone named: its doer or the one it was done to is a name or a pronoun; with neither given,
 * the clause's own name, the one it inherits, or "his", "her", "their" before it. "A man was stabbed" and "fans attacked a guard at
 * Kai Cenat's event" tell a wrongdoing of nobody named.
 */
function aboutNamed(ctx, more, c, i) {
  const { toks } = ctx.L;
  // ("his arrest", "the influencer's arrest": someone the line has named)
  if (i > 0 && (['his', 'her', 'their'].includes(toks[i - 1].k) || (toks[i - 1].poss && TN.ROLE.has(toks[i - 1].k)))) return true;
  const r = more.rolesIn(ctx.L, i);
  const nps = [r.maker, r.target].filter(Boolean);
  if (nps.some((np) => np.kind === 'name' || np.kind === 'owner' || np.kind === 'pronoun')) return true;
  if (nps.length) return false;
  return c.mentions.some((m) => !m.poss) || !!c.heir;
}
/** A guilt word that is none: "threat of legal action", "heart attack", "fired back". */
function benign(L, i) {
  const t = L.toks[i];
  const after = L.toks.slice(i + 1, i + 4).map((x) => x.k);
  const before = (L.toks[i - 1] || {}).k;
  if (/^threat/.test(t.k)) return after.some((k) => ['legal', 'sue', 'lawsuit', 'action', 'boycott', 'quit'].includes(k));
  if (/^attack/.test(t.k)) return ['heart', 'panic', 'asthma', 'anxiety'].includes(before);
  if (t.k === 'fired') return ['back', 'up', 'off', 'shots'].includes(after[0]);
  if (/^crimes?$/.test(t.k)) return before === 'true';
  return false;
}
/** Whose act the word at `i` tells, as a name key: the one it was done to, else the one who did it, else the subject. */
function actOf(ctx, more, i) {
  const r = more.rolesIn(ctx.L, i);
  const np = r.target || r.maker;
  const m = np && np.kind !== 'pronoun' ? np.m : null;
  return !m || T.sameName(m, ctx.subject) ? ctx.subjectKeys.join(' ') : m.keys.join(' ');
}
/**
 * Whether an act on record is established (rule 8): two outlets state it of the same one, with no hedge and no question, and no
 * sentence of any kind hedges or denies it. A post or a video establishes nothing, however flatly it is worded.
 */
function established(ctx, more, i) {
  const t = ctx.L.toks[i];
  const who = actOf(ctx, more, i);
  const last = who.split(' ').slice(-1)[0];
  const having = ctx.sources.map((src) => ({ src, at: src.S.toks.map((x, j) => (x.st === t.st ? j : -1)).filter((j) => j >= 0) })).filter((x) => x.at.length);
  if (having.some((x) => x.at.some((j) => hedgeNear(x.src.S, j) || more.negatedAt(x.src.S, j)) || TN.HOAX.re.test(x.src.text))) return false;
  const outlets = ctx.sources.filter((src) => src.type === 'outlet');
  const count = (rows) => new Set(rows.map((src) => String(src.outlet || src.text).toLowerCase())).size;
  if (t.st === 'arrest' || t.st === 'charg') {
    const press = outlets.map((src) => ({ outlet: src.outlet || src.text, title: src.text, t: src.t || 0, fam: 'gnews', youtube: false, blocked: false }));
    return TP.arrestStated({ press }, who).outlets >= OUTLETS_TO_STATE;
  }
  if (t.st === 'die') return count(outlets.filter((src) => TN.whoseDeath(who, TN.FAMILY.get('death'), [src.text]).own === 1)) >= OUTLETS_TO_STATE;
  return count(outlets.filter((src) => src.keys.includes(last) && !src.question && src.S.toks.some((x, j) => x.st === t.st && !more.aheadAt(src.S, j)))) >= OUTLETS_TO_STATE;
}
/** Whether a quote in the line is given to someone as theirs ("Reggie says ..."): reported speech. */
const quoteGiven = (L, id) => { const q = R.quotesOf(L).find((x) => x.id === id); return !!q && !!R.speakerOf(L, q); };

function reported(ctx, more) {
  const out = [];
  const { L } = ctx;
  for (const c of more.clauses) {
    const people = [...c.mentions, ...(c.heir ? [c.heir] : [])];
    for (let i = c.from; i <= c.to; i++) {
      const t = L.toks[i];
      const cls0 = T.claimClass(t.k);
      // (a guilt word that is no verb is read too: "Scammer Logan Paul", "Abuser Kai Cenat", "a groomer")
      const reads = more.saysWhat(L, i) || cls0 === 'guilt' || cls0 === 'record';
      if (L.names.has(i) || !reads || benign(L, i) || HEDGE_WORD.test(t.k)) continue;
      const claim = (cls0 === 'record' || cls0 === 'guilt') && !more.negatedAt(L, i) && aboutNamed(ctx, more, c, i);
      const unsourced = claim && !ctx.sources.some((src) => src.type === 'outlet' && src.stems.has(t.st));
      // (a wrongdoing or an act on record that only a post's or a video's title says is not told at all, hedged or not: one anonymous title)
      if (unsourced) { out.push(`only a post or a video says "${t.s}"`); continue; }
      // (nor one no source says of that same person, hedged or not: "reportedly" makes no claim. "Reportedly died" from "death
      // threats", "reportedly arrested" from a call for someone else's arrest)
      if (claim && !saidOfSame(ctx, more, i)) { out.push(`no source says "${t.s}" of the one the line says it of`); continue; }
      if (hedgedAt(L, c, i, more.saidBy) || more.negatedAt(L, i) || (t.q && quoteGiven(L, t.q))) continue;
      // if any source hedges the claim, the line hedges it: whichever sentence the model chose to cite. Before anything that looks
      // ahead is let off: "faces backlash after assaulting a fan" where the source has "after allegedly assaulting"
      const hedger = ctx.sources.find((src) => people.every((m) => m.keys.every((k) => src.keys.includes(k))) && src.S.toks.some((x, j) => x.st === t.st && hedgeNear(src.S, j)));
      if (hedger) { out.push(`S${hedger.n + 1} hedges "${t.s}" and the line does not`); continue; }
      if ((more.aheadGoverns || more.aheadAt)(L, i)) continue;
      const cls = T.claimClass(t.k);
      if ((cls !== 'record' && cls !== 'guilt') || ownedUp(ctx, more, i) || !aboutNamed(ctx, more, c, i)) continue;
      if (cls === 'record' && established(ctx, more, i)) continue;
      out.push(cls === 'record' ? `"${t.s}" is stated flat: two outlets must state it and no source hedge or deny it` : `"${t.s}" is stated flat: a wrongdoing is told as reported`);
    }
  }
  // (and a hedge kept where no verb is left to read: when a source that names the clause's people hedges what it says, "accused of
  // explicit chats with a minor", a clause of the line that carries those words carries a hedge. "Dr Disrespect had explicit chats
  // with a minor" drops it on "had")
  if (!out.length) {
    for (const c of more.clauses) {
      if (clauseHedged(L, c, more.saidBy || (() => true))) continue;
      const people = [...c.mentions, ...(c.heir ? [c.heir] : [])];
      if (!people.length) continue;
      const words = [];
      for (let i = c.from; i <= c.to; i++) { const t = L.toks[i]; if (!L.names.has(i) && T.isContent(t) && !T.FREE.has(t.k) && !t.num && !more.negatedAt(L, i) && !(t.q && quoteGiven(L, t.q))) words.push(t); }
      const hedger = ctx.sources.map((src) => ({ src, cover: hedgedComplement(src.S) })).find(({ src, cover }) => cover.size && people.every((m) => m.keys.every((k) => src.keys.includes(k))) &&
        words.some((t) => [...cover].some((j) => src.S.toks[j].st === t.st)));
      if (hedger) { const t = words.find((w) => [...hedger.cover].some((j) => hedger.src.S.toks[j].st === w.st)); out.push(`S${hedger.src.n + 1} hedges "${t.s}" and the line does not`); break; }
    }
  }
  // (who says so, kept: a clause whose every carrying sentence gives its words as someone's account, by a who-says-so tail or after
  // a saying word, is told as theirs: it keeps the tail, or hedges those words. "Mara Voss withheld $40,000 in pay" from "...,
  // ex-editor says" states what one side says; so does "accuser was forced to ..." from "Accuser says she was forced to ...". An
  // act on record that two outlets state flat is let off, as it is above. Reviewers, 2026-10-12)
  if (!out.length) {
    more.clauses.some((c, n) => {
      const carriers = (more.carriers && more.carriers[n]) || [];
      if (!carriers.length) return false;
      const given = (src, i) => src.S.toks.some((x, j) => x.st === L.toks[i].st && !src.S.names.has(j) && attributedAt(src.S, j));
      // (the tail kept: who says so at the end of the clause's own part of the line hedges all of that part, as it does in the source)
      const kept = (i) => hedgedAt(L, c, i, more.saidBy) || partTail(L, i) > i || more.negatedAt(L, i) || (L.toks[i].q && quoteGiven(L, L.toks[i].q)) ||
        // (the line's own saying word before it: "accuser says she was forced ...". Who is given as saying it is rule 6's to read)
        L.toks.slice(c.from, i).some((t, k) => SAYING.has(t.k) && !L.names.has(c.from + k));
      for (let i = c.from; i <= c.to; i++) {
        const t = L.toks[i];
        if (L.names.has(i) || !T.isContent(t) || T.FREE.has(t.k) || t.num || t.unit || HEDGE_WORD.test(t.k) || CLAIM_NOUN.test(t.k) || TAIL_SAYS.test(t.k)) continue;
        // (the words of the line's own who-says-so tail say who, not what)
        const tail = partTail(L, i);
        if ((tail >= 0 && i >= tail) || !carriers.every((src) => given(src, i)) || kept(i)) continue;
        if (T.claimClass(t.k) === 'record' && established(ctx, more, i)) continue;
        out.push(`S${carriers[0].n + 1} hedges "${t.s}" and the line does not: its sentence gives it as someone’s account`);
        return true;
      }
      return false;
    });
  }
  // (the engine's own rule, as on a headline: a claim its title's family makes is told as reported; a quote given to its speaker is)
  const last = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  const given = R.quotesOf(L).some((q) => !!R.speakerOf(L, q));
  if (!out.length && ctx.family && !ctx.input.admitted && !given && TN.statesClaim(ctx.input.line, ctx.family, last) && !TN.REPORTED.test(ctx.input.line)) out.push(`the ${ctx.family.key} claim is told flat`);
  return out;
}

// ---------- rule 8, as built 2026-10-12: the line is never surer than its sources ----------
// (reviewers: 14 of 52 new lines passed that told as done what their source only said was wanted, tried, possible, rumoured or
// asked: "faces a felony battery charge" from "could face", "files for divorce" from "considering filing", "fought" from "wanted
// to fight", "splits" from "Fans think ... split", "is traded" from "trade rumors", "her arson" from "arson case", a headline's
// question told as its answer. A hedge does not mend any of them: "reportedly fought" is still a fight nobody says happened)
const SOFT_MODAL = new Set(['could', 'may', 'might', 'would', 'can']);
// (said with "to": "wanted to fight", "tried to exchange", "threatens to sue", "plans to leave", "set to be sentenced")
const SOFT_INTENT = /^(?:want(?:s|ed|ing)?|tr(?:y|ies|ied|ying)|plan(?:s|ned|ning)?|threaten(?:s|ed|ing)?|ready|hop(?:e|es|ed|ing)|intend(?:s|ed|ing)?|vow(?:s|ed|ing)?|seek(?:s|ing)?|sought|aim(?:s|ed|ing)?|set|expected|poised|prepar(?:es|ed|ing)|looking|attempt(?:s|ed|ing)?)$/;
// (said of what follows it: "considering filing for divorce", "mulls a lawsuit")
const SOFT_WEIGH = /^(?:consider(?:s|ed|ing)?|mull(?:s|ed|ing)?|weigh(?:s|ed|ing)?|contemplat(?:e|es|ed|ing))$/;
// (what somebody else only thinks, or what is only going round: it reaches across the name it is said of. "Fans think Tana Mongeau split")
const HEARSAY = /^(?:think(?:s|ing)?|thought|believe(?:s|d)?|speculat(?:e|es|ed|ing|ion)|fear(?:s|ed)?|wonder(?:s|ed|ing)?|convinced|theor(?:y|ies|ise|ize|ises|izes|ised|ized)|hint(?:s|ed|ing)?|rumou?r(?:s|ed)?|buzz)$/;
const SOFT_STOPS = new Set([...T.CONNECTIVE, 'and', 'as', 'who', 'which', 'or']);
const SOFT_REACH = 10;
const SOFT_HOPS = 2;
/**
 * The word that makes the word at `j` only wanted, tried, possible or heard, in its own part of the sentence; or null. A modal or a
 * word of intent stands before it with nothing but small words and at most two content words between ("could face a felony
 * battery charge"), and never across a name; a word of hearsay reaches across the name it is said of.
 */
function softBefore(S, j) {
  const { toks } = S;
  let named = false;
  let hops = 0;
  for (let k = j - 1; k >= 0 && j - k <= SOFT_REACH; k--) {
    const t = toks[k];
    if (T.breaksAfter(t) || T.commaAfter(t) || t.q !== toks[j].q || SOFT_STOPS.has(t.k)) return null;
    if (S.names.has(k)) { named = true; continue; }
    if (HEARSAY.test(t.k)) return t;
    if (!named) {
      if (SOFT_MODAL.has(t.k) && !(t.cap && k > 0 && t.k === 'may')) return t;
      if (SOFT_WEIGH.test(t.k)) return t;
      if (SOFT_INTENT.test(t.k) && (toks[k + 1] || {}).k === 'to') return t;
    }
    if (T.STOP.has(t.k) || T.ADVERB.has(t.k) || T.AUX.has(t.k) || T.NEG_GRAMMAR.has(t.k) || t.nt || t.num || t.unit) continue;
    hops += 1;
    if (hops > SOFT_HOPS) return null;
  }
  return null;
}
// what names the word before it as something only said or looked into: "trade rumors", "injury rumors"; "arson case", "rape charge"
const RUMOUR_NOUN = /^(?:rumou?rs?|speculation|buzz|whispers?|chatter)$/;
const CASE_NOUN = /^(?:allegations?|accusations?|claims?|case|charges?|probe|investigation|lawsuit|suit|complaints?|trial|scandal)$/;
// (a describing word before such a noun is no claim of its own: "court case", "new allegations")
const CASE_QUALIFIER = new Set(['court', 'criminal', 'federal', 'civil', 'police', 'legal', 'new', 'fresh', 'latest', 'recent', 'old', 'ongoing', 'pending', 'open', 'cold', 'landmark', 'class', 'action',
  'state', 'high', 'profile', 'first', 'second', 'third', 'earlier', 'previous', 'past', 'serious', 'multiple', 'several', 'two', 'three', 'felony', 'misdemeanor', 'misdemeanour', 'formal', 'public', 'own']);
// (a verb that takes such a noun is no part of it: "faces charges", "denies allegations", "files lawsuit")
const CASE_VERB = /^(?:fac(?:e|es|ed|ing)|den(?:y|ies|ied|ying)|fil(?:e|es|ed|ing)|drop(?:s|ped|ping)?|mak(?:e|es|ing)|made|bring(?:s|ing)?|brought|level(?:s|led|ed|ling|ing)?|address(?:es|ed|ing)?|respond(?:s|ed|ing)?|dismiss(?:es|ed|ing)?|reject(?:s|ed|ing)?|settl(?:e|es|ed|ing)|win(?:s|ning)?|won|los(?:e|es|ing)|lost|amid|over|after|following|pending|ongoing|spark(?:s|ed|ing)?|fuel(?:s|led|ed|ling|ing)?|prompt(?:s|ed|ing)?|spread(?:s|ing)?|swirl(?:s|ed|ing)?|shut(?:s|ting)?|quash(?:es|ed|ing)?|fan(?:s|ned|ning)?|stoke(?:s|d)?|ignit(?:e|es|ed|ing))$/;
/**
 * The noun that makes the word at `j` a rumour's or a case's ("trade rumors", "arson case"); or null. In a source: the very next
 * word. In the line (`reach`): up to three words on, so "facing a felony battery charge" is still a charge. Never a verb that
 * takes the noun, nor a word that only describes it.
 */
function softAfter(S, j, reach = 1) {
  const { toks } = S;
  if (CASE_VERB.test(toks[j].k) || T.AHEAD.has(toks[j].k)) return null;
  for (let k = j + 1; k < toks.length && k <= j + reach; k++) {
    if (T.breaksAfter(toks[k - 1]) || T.commaAfter(toks[k - 1]) || S.names.has(k)) return null;
    if (RUMOUR_NOUN.test(toks[k].k)) return toks[k];
    if (CASE_NOUN.test(toks[k].k)) return CASE_QUALIFIER.has(toks[j].k) ? null : toks[k];
  }
  return null;
}
const LINE_REACH = 3;
/** Whether the word at `j` stands in a part of the sentence that only asks: the part ends in a question mark. "Did X and Y settle their feud? Star recounts ..." */
function askedAt(S, j) {
  for (let k = j; k < S.toks.length; k++) {
    if (/\?/.test(S.toks[k].post || '')) return true;
    if (T.breaksAfter(S.toks[k])) return false;
  }
  return false;
}
const POSSESSIVE = new Set(['his', 'her', 'their', 'its']);
/**
 * The possessive right before the word at `i` ("his abuse", "his bestiality porn", "Kai Cenat's abuse"), within two words; or null.
 * Never across a hedging word: "his alleged abuse" says whose the claim is of, not that it happened.
 */
function ownerBefore(S, i) {
  for (let k = i - 1; k >= 0 && k >= i - 2; k--) {
    const t = S.toks[k];
    if (T.breaksAfter(t) || T.commaAfter(t) || HEDGE_WORD.test(t.k)) return null;
    if (POSSESSIVE.has(t.k) || t.poss) return t;
    if (!T.isContent(t) || S.names.has(k)) return null;
  }
  return null;
}
/**
 * Rule 8's other half: every word of the line that says something of someone is no surer than the sources that carry it.
 *   wanted, tried, possible, heard   every source that has the word has it under "could", "wanted to", "tried to", "considering",
 *                                    "threatens to", "Fans think ...": the line keeps such a word on it ("could face" is never "faces")
 *   a rumour's, a case's             every source has it as "trade rumors", "arson case", "rape charge": the line says it the same
 *                                    way or hedges it, never bare ("is traded", "her arson")
 *   only asked                       every source has it in a part that ends in a question mark: a question carries no claim
 *   theirs                           "his abuse", "her arson": a possessive on a wrongdoing, or on a word its source hedges, says it
 *                                    happened and whose it is; the source must say it that way
 */
function softer(ctx, more) {
  const out = [];
  const { L } = ctx;
  for (const c of more.clauses) {
    const people = [...c.mentions, ...(c.heir ? [c.heir] : [])];
    for (let i = c.from; i <= c.to && !out.length; i++) {
      const t = L.toks[i];
      if (L.names.has(i) || !T.isContent(t) || T.FREE.has(t.k) || t.num || t.unit || HEDGE_WORD.test(t.k) || CLAIM_NOUN.test(t.k) || RUMOUR_NOUN.test(t.k)) continue;
      if (t.q && quoteGiven(L, t.q)) continue;
      const carriers = ctx.sources.filter((src) => people.every((m) => m.keys.every((k) => src.keys.includes(k))))
        .map((src) => ({ src, at: src.S.toks.map((x, j) => (x.st === t.st && !src.S.names.has(j) ? j : -1)).filter((j) => j >= 0) })).filter((x) => x.at.length);
      if (!carriers.length) continue;
      const every = (test) => carriers.every((x) => x.at.every((j) => test(x.src.S, j)));
      const first = carriers[0];
      const said = (j) => first.src.S.toks[j].s;
      if (every(askedAt)) { out.push(`S${first.src.n + 1} only asks about "${t.s}": a question says nothing happened`); break; }
      if (every(softBefore) && !softBefore(L, i)) { out.push(`S${first.src.n + 1} only says "${softBefore(first.src.S, first.at[0]).s} ... ${said(first.at[0])}": the line states "${t.s}"`); break; }
      // (a rumour's or a case's wherever the sources have it: named so by the noun after it, "misconduct allegations", or told as a
      // claim, "allegation of misconduct", "accused of misconduct". The line keeps the noun or names the claim: "reportedly" is no
      // stand-in for it. "Shows cancelled due to sexual misconduct allegations" is never "reportedly shows cancelled due to sexual
      // misconduct", which hedges the cancelling and takes the misconduct as given. Reviewers, 2026-10-12)
      const named = carriers.map((x) => ({ x, j: x.at.find((j) => softAfter(x.src.S, j)) })).find((y) => y.j !== undefined);
      if (named && every((S, j) => !!softAfter(S, j) || hedgeNear(S, j)) && !softAfter(L, i, LINE_REACH) && !softBefore(L, i) && !hedgedAt(L, c, i, more.saidBy, { claimOnly: true })) {
        out.push(`S${named.x.src.n + 1} says "${named.x.src.S.toks[named.j].s} ${softAfter(named.x.src.S, named.j).s}": the line says "${t.s}" itself`); break;
      }
      const owner = ownerBefore(L, i);
      // (hedged or not: "is accused over his abuse" takes the abuse as given and hedges only what he is accused over)
      if (owner && !softAfter(L, i, LINE_REACH)) {
        const cls = T.claimClass(t.k);
        const wrong = cls === 'guilt' || TN.WRONGDOING.test(t.k) || carriers.some((x) => x.at.some((j) => hedgeNear(x.src.S, j) || !!softAfter(x.src.S, j) || !!softBefore(x.src.S, j)));
        if (wrong && !carriers.some((x) => x.at.some((j) => !!ownerBefore(x.src.S, j)))) { out.push(`"${owner.s} ${t.s}" says it happened and whose it is: no source says it that way`); break; }
      }
    }
    if (out.length) break;
  }
  return out;
}

// ---------- rule 9: denials ----------
function denials(ctx, more) {
  const { line, admitted } = ctx.input;
  const subject = ctx.subjectKeys.join(' ');
  const { L } = ctx;
  // (the row's flag, or an outlet's own sentence: the subject as the maker of a denying word said of a claim. "Kai Cenat refutes new
  // video claims he paid ..." is a denial whatever the engine's list of denial words made of it. Reviewers, 2026-10-12)
  const denied = !!ctx.input.denied || (!admitted && ctx.sources.some((src) => src.type === 'outlet' && !src.question && src.S.toks.some((x, j) => {
    if (src.S.names.has(j) || !T.DENIES.test(x.k) || !src.S.toks.some((y) => CLAIM_NOUN.test(y.k) || T.REPORT.test(y.k))) return false;
    const r = more.rolesIn(src.S, j);
    return !!r.maker && (r.maker.kind === 'name' || r.maker.kind === 'owner') && !r.maker.inherited && T.sameName(r.maker.m, ctx.subject);
  // (or an outlet's sentence the engine itself reads as the subject's denial, however it is worded: "Andrew Tate calls BS on claim
  // he had ...", "pushes back on the allegations". Reviewers, 2026-10-12: his reply sat in the store under a line that left it off)
  // (or one in which the subject says it is not so in so many words, "claiming she tried to buy an item not for sale": lib/line-replies.js `saysNo`)
  })) || ctx.sources.some((src) => src.type === 'outlet' && !src.question && (!!TN.denialClause(src.text, subject, null, ctx.input.subject || '', 10, { kin: true }) || !!RP.saysNo(src.text, ctx.input.subject || ''))));
  const words = L.toks.map((t, i) => (T.DENIES.test(t.k) && !L.names.has(i) ? i : -1)).filter((i) => i >= 0);
  const has = TN.DENIAL.test(line) || words.length > 0;
  // (a denial someone else makes is theirs to tell, and rule 6 keeps it theirs: "James Gunn denies Matthew Lillard is playing ...")
  // (so is one a party the line names by what it is makes, "the store denies ...", when an outlet has that party deny: the words
  // rule holds each such word to a sentence, lib/lines.js `deniesByParty`)
  const byParty = (i) => { const party = RP.partyBefore(L.toks, i); return !!party && ctx.sources.some((src) => src.type === 'outlet' && !src.question && !!RP.saysNo(src.text, party)); };
  const others = words.length > 0 && words.every((i) => { const who = more.rolesIn(L, i).maker; return (!!who && (who.kind === 'name' || who.kind === 'owner') && !who.inherited && !T.sameName(who.m, ctx.subject)) || byParty(i); });
  const out = [];
  if (admitted && has && !others) out.push('it says "denies" though the sources carry an admission');
  // (kin: a denial the subject's own family makes keeps the claim's denial on record, engine/talk-nouns.js denialClause)
  const ownDenial = TN.denialClause(line, subject, null, ctx.input.subject, 10, { kin: true }) || words.some((i) => { const who = more.rolesIn(L, i).maker; return !!who && !!who.m && T.sameName(who.m, ctx.subject); });
  if (denied && !ownDenial) out.push('the sources carry the subject’s denial and the line does not, in the subject’s own clause');
  if (!denied && has && !admitted && !others) out.push('it carries a denial the sources do not give the subject');
  out.push(...SAID.repliesAstray(ctx, more, { CLAIM_NOUN, RUMOUR_NOUN }));
  return out;
}

// ---------- rule 10: it says what happened ----------
const ALLEGED_TITLES = new Set(['allegations']);
const OF_WHAT = new Set(['of', 'that', 'over', 'about', 'for']);
/**
 * Under a title that is an allegation ("Kai Cenat allegations"), the line says what is alleged: the act itself (a wrongdoing's or
 * a record's own word), or a claim word and what it is a claim of ("accused of ...", "allegations of ...", "alleges Kai Cenat paid
 * her ..."). A line that only names the allegations says nothing a stranger can use: "Reggie doubles down on Kai Cenat allegations
 * and claims he's saving evidence for court" never says what Reggie alleges (judges' top complaint, reviewers 2026-10-12). Only
 * when a source sentence does say it, so there is something better to tell; else null.
 */
function namesTheClaimOnly(ctx) {
  if (!ctx.family || !ALLEGED_TITLES.has(ctx.family.key)) return null;
  const last = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  const says = (S) => S.toks.some((t, i) => {
    if (S.names.has(i)) return false;
    const cls = T.claimClass(t.k);
    if (cls === 'guilt' || cls === 'record') return true;
    if (cls !== 'report') return false;
    // ("accused of abuse", "allegations of misconduct", "claims that he ..."): a claim word and what it claims
    const next = S.toks[i + 1];
    // ("an alleged pregnancy story": what is alleged, named)
    if (/^(?:alleged|claimed)$/.test(t.k) && next && !S.names.has(i + 1) && T.isContent(next) && !T.FREE.has(next.k) && !T.REPORT.test(next.k)) return true;
    if (next && OF_WHAT.has(next.k) && S.toks.slice(i + 2, i + 6).some((x, n) => !S.names.has(i + 2 + n) && T.isContent(x) && !T.FREE.has(x.k) && !T.REPORT.test(x.k))) return true;
    // ("alleges Kai Cenat paid her ..."): the subject right after it, doing something
    for (let j = i + 1; j < Math.min(S.toks.length, i + 8); j++) {
      if (T.breaksAfter(S.toks[j - 1])) break;
      if (S.toks[j].k === last && S.toks.slice(j + 1, j + 3).some((x, n) => !S.names.has(j + 1 + n) && R.verbShaped(x) && !T.REPORT.test(x.k))) return true;
    }
    return false;
  });
  // (a line that tells the answer the claim got, a denial, an apology, an admission, tells the story's newest turn)
  if (says(ctx.L) || ctx.L.toks.some((t, i) => !ctx.L.names.has(i) && (T.RETRACT.test(t.k) || T.DENIES.test(t.k) || T.ADMIT.test(t.k)))) return null;
  // (of the same people: what another accuser alleged is another story, and telling it under this line's people would mix two.
  // "Reggie doubles down on Kai Cenat allegations ..." is not bettered by what Gorgeous Doll said a week before. N)
  const mine = ctx.L.mentions.filter((m) => !T.sameName(m, ctx.subject) && !m.keys.every((k) => ctx.subjectKeys.includes(k) || NO_ONE.has(k)));
  const sameStory = (src) => !mine.length || mine.some((m) => m.keys.every((k) => src.keys.includes(k)));
  const better = ctx.sources.some((src) => src.type === 'outlet' && !src.question && (!last || src.keys.includes(last)) && sameStory(src) && says(src.S));
  return better ? 'it names the allegations and never says what is alleged: say who alleges what, in a source’s own words' : null;
}
/**
 * A line whose only verb is a reaction ("stirs controversy", "responds", "goes viral") must also say over what, in four content
 * words or more; a line with another verb in it says what happened ("says she has never read a book, sparking backlash").
 */
function saysWhatHappened(ctx) {
  const { line } = ctx.input;
  const vague = namesTheClaimOnly(ctx);
  if (vague) return [vague];
  if (!TN.onlyReaction(line, ctx.subjectKeys.join(' '), ctx.input.kind === 'headline' ? HEADLINE_SAYS_WHAT_WORDS : SAYS_WHAT_WORDS)) return [];
  const rest = R.sentenceOf(String(line).replace(TN.REACTION_SAID, ' '), new Set(ctx.L.toks.filter((t, i) => ctx.L.names.has(i)).map((t) => t.k)));
  const tells = rest.toks.some((t, i) => !rest.names.has(i) && T.isContent(t) && !T.FREE.has(t.k) && !R.isNominal(rest, i) && R.verbShaped(t));
  // (or what someone said, in so many words: "says she has never read a book")
  const said = rest.toks.some((t, i) => SAYING.has(t.k) && rest.toks.slice(i + 1).filter((x) => T.isContent(x) && !T.FREE.has(x.k)).length >= SAID_WORDS);
  return tells || said ? [] : ['it only says there was a reaction, not over what'];
}

// ---------- rule 11: the title is not surer than the line ----------
/** The engine's own readings of a title's noun in a line: each must hold on the new line wherever it held on the headline it replaces. */
function titleChecks(ctx, more = null) {
  const f = ctx.family;
  const subject = ctx.subjectKeys.join(' ');
  const last = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  const leads = (s) => T.tokensOf(s).filter((t) => T.isContent(t)).slice(0, LEAD_WORDS).some((t) => t.k === last);
  const checks = [];
  if (!f || !subject) return checks;
  // (the engine's own gate: a noun its outlets say needs no line to say it again; one only the searches say does)
  // (said by a sentence that carries the line, or by an outlet's that tells the same story as the line: two of its words beyond
  // the names. Any outlet's will not do: under "Kai Cenat backlash" his subscriber record is another story of the same name)
  const saying = ctx.sources.filter((src) => src.type === 'outlet' && TN.says(src.text, f));
  const mine = new Set(ctx.L.toks.filter((t, i) => !ctx.L.names.has(i) && T.isContent(t) && !T.FREE.has(t.k) && !t.num).map((t) => t.st));
  const carrying = more ? new Set(more.carriers.flat()) : null;
  // (or it names someone else those sentences name: who else the story is about. A platform or a role is no one)
  const others = ctx.L.mentions.filter((m) => !T.sameName(m, ctx.subject) && !m.keys.every((k) => NO_ONE.has(k) || ctx.subjectKeys.includes(k)));
  const told = carrying === null ? saying.length > 0 : saying.some((src) => carrying.has(src) || new Set(src.S.toks.filter((x, j) => !src.S.names.has(j) && mine.has(x.st)).map((x) => x.st)).size >= STORY_SHARED_WORDS ||
    others.some((m) => m.keys.every((k) => src.keys.includes(k))));
  // (a line tells a backlash in the present tense where a headline's family reads the past: "Netizens slam ...", "faces criticism")
  // (under a title that is a claim, a line that tells a claim tells the title's: "Reggie says Kai Cenat abused him" under "allegations")
  const claimTold = (s) => (TN.CLAIMS.has(f.key) || CLAIM_TITLED.has(f.key)) && T.tokensOf(s).some((t) => ['guilt', 'record', 'report'].includes(T.claimClass(t.k)));
  checks.push(['it does not say the title’s noun, and no outlet does', (s) => told || TN.says(s, f) || (f.key === 'backlash' && BACKLASH_TOLD.test(s)) || claimTold(s)]);
  // (a row titled by a work and whose noun it is, "Hellraiser Revival YouTuber ban", says itself that the noun is someone's: lib/desk.js `roleLed`)
  const roleTitled = /(?:^|\s)(?:YouTuber|TikToker|streamer|influencer|content creator|vlogger|podcaster)\s+\S+$/i.test(String(ctx.input.title || ''));
  if (!roleTitled) checks.push(['the noun is someone else’s in it', (s) => { const x = TN.familiesIn(s).find((y) => y.f.key === f.key); return !x || !TN.othersNoun(s, x, subject); }]);
  // (what an outlet calls someone, in quotes between the claim's word and the name, is no one else: "accuses ‘bitter and jealous’
  // Pete Davidson of ..." is a claim against Pete Davidson)
  const unquoted = (s) => String(s || '').replace(/[‘“"'][^’”"']{1,40}[’”"']\s+(?=\p{Lu})/gu, '');
  if (CLAIM_TITLED.has(f.key)) checks.push(['the claim is not against the subject in it', (s) => leads(s) || TP.claimedOf(s, subject) || TP.claimedOf(unquoted(s), subject)]);
  if (f.key === 'arrest') checks.push(['the arrest is not the subject’s own in it', (s) => TP.arrestOf(s, subject) !== 'other']);
  if (f.key === 'death') checks.push(['the death is not the subject’s own in it', (s) => { const d = TN.whoseDeath(subject, f, [s]); return d.own === 1 || (d.others === 0 && !d.owner); }]);
  // (an apology is the subject's own to make; an execution, a firing, a ban or a suspension is done to the subject: a line in which
  // someone else apologises to the subject, or is the one executed, is under the wrong name. Live 2026-10-11: "Guillermo Rodriguez
  // apology" over the man who apologised to him)
  // (the act is read by the title's own last word as well as its family: a firing, a ban and a suspension are nouns of other
  // families, and were never read at all. Never under a title that says the noun is a role's: `roleTitled`)
  const nounKey = (T.tokensOf(ctx.input.title || '').pop() || {}).k || '';
  // (by the noun alone only under a person's name: "Green Card suspension" and "Hellraiser Revival gameplay ban" are a programme's
  // and a game's, and say nothing of who was suspended or banned)
  const act = roleTitled ? null : ACTS.find(([key]) => key === f.key || (key === nounKey && !!ctx.input.person));
  if (act) checks.push([`the ${act[0]} is not the subject’s own in it`, (s) => whoseAct(s, ctx, act[1], act[2])]);
  // (and by the row's own outlets, whatever the line says: when two of them give the act to someone else and none to the subject,
  // no line under this title is right. "Pete Hegseth public execution": the execution is Nidal Hasan's; "Brandon Rogers NYCC
  // apology": the apology is New York Comic Con's)
  if (act) {
    const sides = ctx.sources.filter((src) => src.type === 'outlet').map((src) => actSide(src.text, ctx, act[1], act[2]));
    if (sides.filter((x) => x === 'other').length >= OUTLETS_TO_STATE && !sides.includes('own')) checks.push([`the ${act[0]} is not the subject’s own in its sources`, () => false]);
  }
  // (a noun taken from a threat, a wish or a question is not the title's noun: "Kourtney Kardashian slap" over "threatens to
  // slap", "ready to slap" and "wanted to fight"; "... firing" over "wants Letitia James removed". Reviewers, 2026-10-12)
  if (WISHABLE.has(f.key)) {
    const saying = ctx.sources.filter((src) => src.type === 'outlet').map((src) => ({ src, at: TN.familiesIn(src.text).filter((x) => x.f.key === f.key).map((x) => x.at) })).filter((x) => x.at.length);
    if (saying.length && saying.every((x) => x.at.every((at) => wishedAt(x.src.text, at)))) checks.push([`the ${f.noun ? nounKey || f.key : f.key} is only threatened, wished or asked in its sources`, () => false]);
  }
  return checks;
}
// whose an act is: the one who makes it (an apology), or the one it is done to
const ACTS = [['apology', /^apolog/, 'maker'], ['execution', /^execut/, 'target'], ['firing', /^fir(?:ed|ing|es)$/, 'target'], ['ban', /^ban(?:s|ned|ning)?$/, 'target'], ['suspension', /^suspen(?:d|ds|ded|ding|sion)$/, 'target']];
// families whose noun is something done: one that is only threatened, wished or asked has not been done
const WISHABLE = new Set(['fight', 'attack', 'stabbing', 'arrest', 'quit', 'split', 'apology', 'lawsuit', 'execution', 'knockout', 'sentencing', 'verdict']);
const WISH_WORD = /^(?:wants?|wanted|wanting|ready|threatens?|threatened|threatening|vows?|vowed|plans?|planned|planning|tried|tries|trying|hopes?|hoped|hoping|could|would|may|might|will|gonna|calls?|called|calling|demands?|demanded|urges?|urged|seeks?|sought|considering|considers|mulls?|mulling|i['’]ll|she['’]ll|he['’]ll|they['’]ll|we['’]ll|if)$/i;
const WISH_BACK = 6;
/** Whether the word at word-index `at` of a sentence is only threatened, wished or asked: its part ends in a question mark, or a word of wishing stands within six words before it. */
function wishedAt(text, at) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!Number.isInteger(at) || at < 0 || at >= words.length) return false;
  for (let k = at; k < words.length; k++) { if (/\?/.test(words[k])) return true; if (/[.!;]["”’']?$/.test(words[k])) break; }
  for (let k = at - 1; k >= 0 && at - k <= WISH_BACK; k--) {
    if (/[,;:.!]["”’']?$/.test(words[k])) break;
    if (WISH_WORD.test(words[k].replace(/^[^\p{L}]+|[^\p{L}’']+$/gu, ''))) return true;
  }
  return false;
}
/**
 * Whether the act a title's noun names is the subject's own in a sentence: true unless the sentence gives it, in so many words, to
 * someone else (as its maker for an apology; as the one it is done to for an execution, a firing, a ban or a suspension).
 */
function whoseAct(s, ctx, stem, side) { return actSide(s, ctx, stem, side) !== 'other'; }
/**
 * 'own', 'other' or null: whose the act a title's noun names is in a sentence. The act is the title's when it is the subject's, or
 * the one's the title LEADS with: "Shane Gillis SNL apology" is his, and a title that names the venue after him says nothing
 * else. (Until the recheck of 2026-10-12 anyone the title named was no "other", so "Brandon Rogers NYCC apology" stood over an
 * apology New York Comic Con made, two rows under one where the same shape meant the man apologised. Such a row is now led by
 * who made the apology, "NYCC Brandon Rogers apology", or left out: lib/line-writer.js.) "<noun> of <name>" gives it to that name
 * ("execution of Nidal Hasan").
 */
function actSide(s, ctx, stem, side) {
  const S = R.sentenceOf(s, new Set(ctx.subjectKeys));
  const lead = (T.tokensOf(ctx.input.title || '')[0] || {}).k || null;
  let other = false;
  let own = false;
  // (a name and its initials are one: "New York Comic Con apologizes" under "NYCC apology")
  // (a sentence's first word may read as no part of the name, "New" of "New York Comic Con": the initials of the rest still close it)
  const short = ctx.subjectKeys.join('');
  const initials = (m) => { const made = m.keys.map((k) => k.charAt(0)).join(''); return m.keys.length >= 3 && short.length <= made.length + 1 && short.endsWith(made); };
  const read = (m) => { if (!m) return; if (T.sameName(m, ctx.subject) || (!!lead && m.keys[0] === lead) || initials(m)) own = true; else other = true; };
  S.toks.forEach((t, i) => {
    if (S.names.has(i) || (!stem.test(t.st) && !stem.test(t.k))) return;
    if (side === 'target' && (S.toks[i + 1] || {}).k === 'of') {
      const of = S.mentions.find((m) => m.start > i + 1 && m.start <= i + 4);
      if (of) { read(of); return; }
    }
    const r = R.rolesAt(S, i);
    const np = side === 'maker' ? r.maker : r.voice === 'passive' ? r.target : r.voice === 'nominal' ? r.maker : r.target;
    if (!np || !np.m || np.kind === 'pronoun') return;
    read(np.m);
  });
  return own ? 'own' : other ? 'other' : null;
}
function titleHolds(ctx, more = null) {
  const { line, title, headline } = ctx.input;
  const out = titleChecks(ctx, more).filter(([, test]) => (!headline || test(headline)) && !test(line)).map(([why]) => `the title "${title}" is surer than the line: ${why}`);
  // ("<name> admission", "<name> apology": the line says the subject owned up)
  if (/\b(?:admission|apology)$/i.test(title || '') && !ctx.L.toks.some((t) => T.ADMIT.test(t.k))) out.push(`the title "${title}" is surer than the line: it tells no admission`);
  return out;
}

// the saying words that carry a claim (a reply, a joke or a denial is not one its maker takes back)
const CLAIMING = /^(?:says?|said|tells?|told|insists?|insisted|writes?|wrote|posts?|posted|tweets?|tweeted|reveals?|revealed|shares?|shared)$/;

// ---------- rule 12: not a stale angle ----------
/**
 * A line is stale when it still looks ahead to what an outlet says has happened ("set to be executed" beside "executed"), when it
 * tells a claim its maker has since taken back (an apology, a retraction) without saying so, when a newer outlet sentence says the
 * opposite of a word of it ("has not regained consciousness" beside a later "is conscious and speaking"), or when it joins two
 * claims with "after" or "before" against the order their own sources are dated in.
 */
function stale(ctx, more) {
  const out = [];
  const { L } = ctx;
  const subjectLast = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  const retracts = L.toks.some((t) => T.RETRACT.test(t.k));
  L.toks.forEach((t, i) => {
    if (L.names.has(i)) return;
    const cls = T.claimClass(t.k);
    if ((cls === 'record' || cls === 'guilt') && more.aheadAt(L, i)) {
      const done = ctx.sources.find((src) => src.type === 'outlet' && !src.question && (!subjectLast || src.keys.includes(subjectLast)) &&
        src.S.toks.some((x, j) => x.st === t.st && /(?:ed|en)$/.test(x.k) && !more.aheadAt(src.S, j) && !more.negatedAt(src.S, j) && !hedgeNear(src.S, j)));
      if (done) out.push(`it still looks ahead to "${t.s}", which S${done.n + 1} says has happened`);
    }
    // (a claim told with any saying word, or as its maker's noun: "Gorgeous Doll says Kai Cenat paid her ..." is as stale as "alleges")
    if ((cls === 'report' || CLAIMING.test(t.k) || R.NOMINAL.test(t.k)) && !T.RETRACT.test(t.k) && !retracts) {
      const maker = more.rolesIn(L, i).maker;
      if (!maker || maker.kind === 'pronoun') return;
      const back = ctx.sources.find((src) => src.S.toks.some((x, j) => T.RETRACT.test(x.k) && (() => { const r = more.rolesIn(src.S, j); return !!r.maker && r.maker.kind !== 'pronoun' && T.sameName(r.maker.m, maker.m); })()));
      if (back) out.push(`${maker.m.keys.join(' ')} has since apologised or taken it back (S${back.n + 1}) and the line does not say so`);
    }
  });
  // a newer outlet says the opposite: "has not regained consciousness" beside a later "is now conscious and speaking"
  more.clauses.forEach((c, n) => {
    const times = more.carriers[n].map((src) => src.t).filter((x) => Number.isFinite(x) && x > 0);
    if (!times.length) return;
    const newest = Math.max(...times);
    // (a later sentence the line itself tells in another clause is no contradiction left out: "... is accused of doping ...; Voss
    // denies doping allegations" carries the denial that says the opposite of the claim)
    const told = new Set(more.carriers.flatMap((cs, k) => (k === n ? [] : cs)));
    const later = ctx.sources.filter((src) => src.type === 'outlet' && Number.isFinite(src.t) && src.t > newest + OPPOSITE_SLACK_MS && (!subjectLast || src.keys.includes(subjectLast)) && !told.has(src));
    for (let i = c.from; i <= c.to && later.length; i++) {
      const t = L.toks[i];
      if (L.names.has(i) || !T.isContent(t) || t.num || t.neg || T.FREE.has(t.k) || T.claimClass(t.k) === 'report') continue;
      const mine = more.negatedAt(L, i);
      const against = later.find((src) => { const at = src.S.toks.map((x, j) => (x.st === t.st && !src.S.names.has(j) ? j : -1)).filter((j) => j >= 0); return at.length > 0 && at.every((j) => more.negatedAt(src.S, j) !== mine); });
      if (against) { out.push(`S${against.n + 1}, newer, says the opposite of "${t.s}"`); return; }
    }
  });
  more.clauses.forEach((c, n) => {
    if (n === 0 || !['after', 'following', 'before'].includes(c.link)) return;
    const pairs = more.carriers[n - 1].flatMap((a) => more.carriers[n].map((b) => [a, b])).filter(([a, b]) => a !== b && Number.isFinite(a.t) && Number.isFinite(b.t) && a.t > 0 && b.t > 0);
    if (!pairs.length || more.carriers[n - 1].some((a) => more.carriers[n].includes(a))) return;
    // ("X after Y": what carries X is not older than what carries Y; "X before Y" the other way)
    const fits = ([a, b]) => (c.link === 'before' ? a.t <= b.t + ORDER_SLACK_MS : a.t >= b.t - ORDER_SLACK_MS);
    if (!pairs.some(fits)) out.push(`"${c.link}" goes against the order the sources are dated in`);
  });
  return out;
}

module.exports = { saidTail, attributedAt, partsOf: SAID.partsOf, wishedAt, softer, softBefore, softAfter, askedAt, familyOf, reported, denials, saysWhatHappened, titleHolds, titleChecks, stale, hedgedAt, hedgeNear, governs, tailHedged, hedgedComplement, established, CLAIM_TITLED };
