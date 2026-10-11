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

const OUTLETS_TO_STATE = 2;
const SAYS_WHAT_WORDS = 4;
const SAID_WORDS = 2;
const HEADLINE_SAYS_WHAT_WORDS = 3;
const HEDGE_NEAR = 4;
const ORDER_SLACK_MS = 12 * 3600 * 1000;
// titles that are a claim against their subject (the engine's own list)
const CLAIM_TITLED = new Set(['allegations', 'arrest', 'threats', 'scam', 'rumors']);
const LEAD_WORDS = 6;

const familyOf = (key) => (key && TN.FAMILY.get(key)) || null;
// how a sentence tells a backlash as it happens: who slams, blasts, criticises or calls out
const BACKLASH_TOLD = /\b(?:slams?|blasts?|rips?|drags?|condemns?|criticis\w+|criticiz\w+|calls? out|called out|under fire|hits? back at|outraged?|furious|angers?|angry)\b/i;

// ---------- rule 8: reported stays reported ----------
const HEDGE_WORD = /^(?:accus\w+|alleg\w+|reportedly|claims?|claimed|claiming|suspect\w*|rumou?r\w*|den(?:y|ies|ied|ial|ials|ying)|investigat\w+|unconfirmed|possible|possibly|according|apparently|supposedly|purportedly|seemingly)$/;
const CLAIM_NOUN = /^(?:allegations?|claims?|accusations?|charges?|rumou?rs?|lawsuit|suit|case|investigation|probe|complaints?)$/;
const SAYING = new Set(['says', 'said', 'say', 'tells', 'told']);
const TAIL_SAYS = /^(?:says?|said|alleges?|alleged|claims?|claimed|reports?|reported)$/;
const TAIL_MAX = 6;
/**
 * Whether the word at `i` is told as reported, in its own clause `c`: a hedging word before it ("accused of", "alleged", "allegedly",
 * "denies") or someone given as saying it; a claim's noun right after it ("abuse allegations"); or who says so after a comma at the
 * clause's end (", police say", ", Reggie alleges"). A hedge elsewhere hedges something else: "Abuser Kai Cenat responds to abuse
 * allegations" states the first word flat.
 */
function hedgedAt(L, c, i) {
  const { toks } = L;
  for (let j = c.from; j < i; j++) {
    if (L.names.has(j) || (toks[j].q && toks[j].q !== toks[i].q)) continue;
    // (what someone admits to is told as theirs: "admits to assault")
    if (HEDGE_WORD.test(toks[j].k) || T.ADMIT.test(toks[j].k) || (SAYING.has(toks[j].k) && R.leftOf(L, j))) return true;
  }
  if (toks.slice(i + 1, Math.min(c.to, i + 2) + 1).some((t) => CLAIM_NOUN.test(t.k))) return true;
  if (tailHedged(L)) return true;
  for (let j = i + 1; j <= c.to; j++) {
    if (!T.commaAfter(toks[j - 1]) || c.to - j >= TAIL_MAX) continue;
    if (toks.slice(j, c.to + 1).some((t, n) => TAIL_SAYS.test(t.k) && !L.names.has(j + n))) return true;
  }
  return false;
}
/** Whether a sentence hedges all it says with a word at its very end: "... not The Flash (rumor)", "..., reportedly". (A sentence that ends on "allegations" hedges nothing by it.) */
const TAIL_HEDGE = /^(?:reportedly|allegedly|rumou?rs?|rumou?red|unconfirmed|report)$/;
const tailHedged = (S) => S.toks.slice(-2).some((t, n, last) => TAIL_HEDGE.test(t.k) && (n === last.length - 1 || /[()]/.test(t.pre + t.post)));
/** Whether a source hedges its word at `j`: a hedging word within four words before it, in the same part of the sentence, or at the sentence's very end. */
function hedgeNear(S, j) {
  if (tailHedged(S) && j < S.toks.length - 2) return true;
  for (let k = j - 1, seen = 0; k >= 0 && seen < HEDGE_NEAR; k--) {
    const t = S.toks[k];
    // ("Apparently, a man jumped ...": a hedge that opens a sentence hedges what follows its comma)
    if (HEDGE_WORD.test(t.k) && !S.names.has(k) && T.commaAfter(t) && /ly$/.test(t.k)) return true;
    if (T.breaksAfter(t) || T.commaAfter(t) || T.CONNECTIVE.has(t.k)) return false;
    if (S.names.has(k)) continue;
    if (HEDGE_WORD.test(t.k)) return true;
    seen += 1;
  }
  return false;
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
      if (L.names.has(i) || !more.saysWhat(L, i) || benign(L, i) || HEDGE_WORD.test(t.k)) continue;
      const cls0 = T.claimClass(t.k);
      const unsourced = (cls0 === 'record' || cls0 === 'guilt') && !more.negatedAt(L, i) && aboutNamed(ctx, more, c, i) && !ctx.sources.some((src) => src.type === 'outlet' && src.stems.has(t.st));
      // (a wrongdoing or an act on record that only a post's or a video's title says is not told at all, hedged or not: one anonymous title)
      if (unsourced) { out.push(`only a post or a video says "${t.s}"`); continue; }
      if (hedgedAt(L, c, i) || more.negatedAt(L, i) || more.aheadAt(L, i) || (t.q && quoteGiven(L, t.q))) continue;
      // if any source hedges the claim, the line hedges it: whichever sentence the model chose to cite
      const hedger = ctx.sources.find((src) => people.every((m) => m.keys.every((k) => src.keys.includes(k))) && src.S.toks.some((x, j) => x.st === t.st && hedgeNear(src.S, j)));
      if (hedger) { out.push(`S${hedger.n + 1} hedges "${t.s}" and the line does not`); continue; }
      const cls = T.claimClass(t.k);
      if ((cls !== 'record' && cls !== 'guilt') || ctx.input.admitted || !aboutNamed(ctx, more, c, i)) continue;
      if (cls === 'record' && established(ctx, more, i)) continue;
      out.push(cls === 'record' ? `"${t.s}" is stated flat: two outlets must state it and no source hedge or deny it` : `"${t.s}" is stated flat: a wrongdoing is told as reported`);
    }
  }
  // (the engine's own rule, as on a headline: a claim its title's family makes is told as reported; a quote given to its speaker is)
  const last = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  const given = R.quotesOf(L).some((q) => !!R.speakerOf(L, q));
  if (!out.length && ctx.family && !ctx.input.admitted && !given && TN.statesClaim(ctx.input.line, ctx.family, last) && !TN.REPORTED.test(ctx.input.line)) out.push(`the ${ctx.family.key} claim is told flat`);
  return out;
}

// ---------- rule 9: denials ----------
function denials(ctx, more) {
  const { line, denied, admitted } = ctx.input;
  const subject = ctx.subjectKeys.join(' ');
  const { L } = ctx;
  const words = L.toks.map((t, i) => (T.DENY.test(t.k) && !L.names.has(i) ? i : -1)).filter((i) => i >= 0);
  const has = TN.DENIAL.test(line) || words.length > 0;
  // (a denial someone else makes is theirs to tell, and rule 6 keeps it theirs: "James Gunn denies Matthew Lillard is playing ...")
  const others = words.length > 0 && words.every((i) => { const who = more.rolesIn(L, i).maker; return !!who && (who.kind === 'name' || who.kind === 'owner') && !who.inherited && !T.sameName(who.m, ctx.subject); });
  const out = [];
  if (admitted && has && !others) out.push('it says "denies" though the sources carry an admission');
  if (denied && !TN.denialClause(line, subject, null, ctx.input.subject, 10)) out.push('the sources carry the subject’s denial and the line does not, in the subject’s own clause');
  if (!denied && has && !admitted && !others) out.push('it carries a denial the sources do not give the subject');
  return out;
}

// ---------- rule 10: it says what happened ----------
/**
 * A line whose only verb is a reaction ("stirs controversy", "responds", "goes viral") must also say over what, in four content
 * words or more; a line with another verb in it says what happened ("says she has never read a book, sparking backlash").
 */
function saysWhatHappened(ctx) {
  const { line } = ctx.input;
  if (!TN.onlyReaction(line, ctx.subjectKeys.join(' '), ctx.input.kind === 'headline' ? HEADLINE_SAYS_WHAT_WORDS : SAYS_WHAT_WORDS)) return [];
  const rest = R.sentenceOf(String(line).replace(TN.REACTION_SAID, ' '), new Set(ctx.L.toks.filter((t, i) => ctx.L.names.has(i)).map((t) => t.k)));
  const tells = rest.toks.some((t, i) => !rest.names.has(i) && T.isContent(t) && !T.FREE.has(t.k) && !R.isNominal(rest, i) && R.verbShaped(t));
  // (or what someone said, in so many words: "says she has never read a book")
  const said = rest.toks.some((t, i) => SAYING.has(t.k) && rest.toks.slice(i + 1).filter((x) => T.isContent(x) && !T.FREE.has(x.k)).length >= SAID_WORDS);
  return tells || said ? [] : ['it only says there was a reaction, not over what'];
}

// ---------- rule 11: the title is not surer than the line ----------
/** The engine's own readings of a title's noun in a line: each must hold on the new line wherever it held on the headline it replaces. */
function titleChecks(ctx) {
  const f = ctx.family;
  const subject = ctx.subjectKeys.join(' ');
  const last = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  const leads = (s) => T.tokensOf(s).filter((t) => T.isContent(t)).slice(0, LEAD_WORDS).some((t) => t.k === last);
  const checks = [];
  if (!f || !subject) return checks;
  // (the engine's own gate: a noun its outlets say needs no line to say it again; one only the searches say does)
  const told = ctx.sources.some((src) => src.type === 'outlet' && TN.says(src.text, f));
  // (a line tells a backlash in the present tense where a headline's family reads the past: "Netizens slam ...", "faces criticism")
  checks.push(['it does not say the title’s noun, and no outlet does', (s) => told || TN.says(s, f) || (f.key === 'backlash' && BACKLASH_TOLD.test(s))]);
  // (a row titled by a work and whose noun it is, "Hellraiser Revival YouTuber ban", says itself that the noun is someone's: lib/desk.js `roleLed`)
  const roleTitled = /(?:^|\s)(?:YouTuber|TikToker|streamer|influencer|content creator|vlogger|podcaster)\s+\S+$/i.test(String(ctx.input.title || ''));
  if (!roleTitled) checks.push(['the noun is someone else’s in it', (s) => { const x = TN.familiesIn(s).find((y) => y.f.key === f.key); return !x || !TN.othersNoun(s, x, subject); }]);
  if (CLAIM_TITLED.has(f.key)) checks.push(['the claim is not against the subject in it', (s) => leads(s) || TP.claimedOf(s, subject)]);
  if (f.key === 'arrest') checks.push(['the arrest is not the subject’s own in it', (s) => TP.arrestOf(s, subject) !== 'other']);
  if (f.key === 'death') checks.push(['the death is not the subject’s own in it', (s) => { const d = TN.whoseDeath(subject, f, [s]); return d.own === 1 || (d.others === 0 && !d.owner); }]);
  return checks;
}
function titleHolds(ctx) {
  const { line, title, headline } = ctx.input;
  const out = titleChecks(ctx).filter(([, test]) => (!headline || test(headline)) && !test(line)).map(([why]) => `the title "${title}" is surer than the line: ${why}`);
  // ("<name> admission", "<name> apology": the line says the subject owned up)
  if (/\b(?:admission|apology)$/i.test(title || '') && !ctx.L.toks.some((t) => T.ADMIT.test(t.k))) out.push(`the title "${title}" is surer than the line: it tells no admission`);
  return out;
}

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
    if (cls === 'report' && !retracts) {
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
    const later = ctx.sources.filter((src) => src.type === 'outlet' && Number.isFinite(src.t) && src.t > newest + ORDER_SLACK_MS && (!subjectLast || src.keys.includes(subjectLast)));
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

module.exports = { familyOf, reported, denials, saysWhatHappened, titleHolds, titleChecks, stale, hedgedAt, hedgeNear, established, CLAIM_TITLED };
