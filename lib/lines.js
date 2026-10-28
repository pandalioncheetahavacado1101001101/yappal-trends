'use strict';
/*
 * The claim check (ios/IDEAS-FEED.md G3): whether a written line may be shown. Rules, no model: every name, number and content word
 * of the line stands in one of the item's own source sentences; every claim is carried whole by a single one of them, with the same
 * people on the same sides of it; a negation and a reported wording are kept; nothing is surer than its sources. The model's own
 * citations are never trusted: the check finds the carrying sentence itself. Pure: no clock, no I/O.
 *
 * checkLine({ line, title, subject, family, sources: [{ text, type, outlet, t }], denied, admitted, headline, kind, card })
 *   (headline: the engine's line it would replace; kind 'headline': the line is itself a headline, held to a headline's length)
 *   -> { ok, failures: [{ rule, why }], carried: [source index per claim] }
 */
const W = require('../engine/wording');
const T = require('./line-text');
const R = require('./line-roles');
const RULES = require('./line-rules');
const RP = require('./line-replies');
const { ownerDropped, givenDiffers, QUIET_HEAD } = require('./line-owners');
const TN = require('../engine/talk-nouns');

const WORDS_MIN = 8;
// (a headline is terse: the no-model path holds its own lines to the same check with a headline's length, G4)
const HEADLINE_WORDS_MIN = 6;
const WORDS_MAX = 28;
const WORD_LINE_MAX = 22;
// (an editor's card, lib/editor: the latest development, the claim and the reply in one sentence, as long as the feed lets a line be.
// `card: true` changes these two lengths and nothing else: every rule below reads such a line as it reads any other)
const CARD_WORDS_MAX = 36;
const CARD_CHARS_MAX = 200;
// (a label: a quoted name and a colon, or a colon that opens a headline's second half, "...: The viral trend", "...: What to know";
// never a work's own name, "Hellraiser: Revival")
const LABEL_LEAD = /^[‘“"'][^’”"']{2,60}[’”"']:\s+\p{Lu}|^[^:]{2,60}:\s+(?:The|An?|What|Why|How|Here|Everything|Inside|Meet)\s/u;
const COMMENT = /\b(?:shows?|showed|proves?|proved|is|are)\s+(?:exactly\s+)?why\b|\bhere['’]s\s+(?:why|what|how)\b|\bwhat\s+(?:it|this|that)\s+(?:means|says|tells)\b|\b(?:the\s+)?(?:problem|trouble|lesson)\s+(?:with|in|of|for)\b|\bwhy\s+(?:it|this|that)\s+matters\b/i;
const COUNTED_BACK = 3;
const CHARS_MAX = 180;
const CARRIED_SHARE = 0.8;
const SHOUT_MIN = 5;
const SECOND_SENTENCE = /(?<!\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|No|Gov|Sen|Rep|Gen|Lt|Col|Sgt|Inc|Ltd|Co|U\.S|U\.K|\p{Lu}))[.!?]["”’']?\s+["“‘']?\p{Lu}/u;
const PERSON = /(?<![\p{L}\p{N}’'])(?:I|I['’](?:m|ve|d|ll)|[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Ww]e|[Ww]e['’](?:re|ve|ll)|us|[Oo]ur|[Oo]urs|[Yy]ou|[Yy]ou['’](?:re|ve|ll)|[Yy]our|[Yy]ours)(?![\p{L}\p{N}])/u;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u;
const TIME_WORD = new Set(['days', 'day', 'hours', 'hour', 'weeks', 'week', 'months', 'month', 'years', 'year', 'moments', 'shortly', 'soon', 'just', 'long']);
const AS_NO_CLAUSE = new Set(['such', 'known', 'same', 'well', 'far', 'long', 'much', 'many', 'soon', 'described', 'seen', 'named']);
const LINKS = new Set([...T.CONNECTIVE, 'over', 'for', 'as', 'amid', 'following', 'after']);

/** Whether a token says what happened: a claim word or a word shaped like a verb; a word in -s only right after who does it. */
function saysWhat(S, i) {
  const t = S.toks[i];
  if (!T.isContent(t) || t.num || S.names.has(i) || T.FREE.has(t.k) || T.NEG_GRAMMAR.has(t.k)) return false;
  if (/ers?$/.test(t.k) && !W.VERB_RE.test(t.k)) return false;
  if (T.claimClass(t.k) || T.PAST_FORMS.has(t.k) || /(?:ed|ing)$/.test(t.k) || W.VERB_RE.test(t.k)) return true;
  const prev = S.toks[i - 1];
  return /[^s]s$/.test(t.k) && !!prev && !prev.poss && (S.names.has(i - 1) || ['he', 'she', 'it', 'who'].includes(prev.k));
}

// ---------- what the check reads ----------
/** The line and its sources as sentences, with one set of names known to all of them. */
function prepare(input) {
  const subjectKeys = T.tokensOf(input.subject || '').map((t) => t.k).filter(Boolean);
  const known = new Set(subjectKeys);
  for (const text of [input.line, ...input.sources.map((s) => s.text)]) {
    const toks = T.tokensOf(text);
    if (T.isTitleCase(toks)) continue;
    // (a plain word shouted in capitals tells no name: "ARRESTED")
    for (const i of T.nameIndexes(toks)) if (!(toks[i].s.length >= 2 && toks[i].s === toks[i].s.toUpperCase() && W.inDict(toks[i].k))) known.add(toks[i].k);
  }
  const L = R.sentenceOf(input.line, known);
  // (the engine's own way of telling a flat claim as reported, ", reports say", is part of a headline line and no claim of its own)
  if (input.kind === 'headline') L.toks.forEach((t, i) => { if (t.k === 'reports' && (L.toks[i + 1] || {}).k === 'say' && i > 0 && T.commaAfter(L.toks[i - 1])) t.unit = true; });
  const sources = input.sources.map((s, n) => {
    const S = R.sentenceOf(s.text, known);
    return { ...s, n, S, keys: S.toks.map((t) => t.k), stems: new Set(S.toks.map((t) => t.st)), numbers: S.toks.filter((t) => t.num).map((t) => t.num),
      negates: S.toks.some((t) => T.NEG_GRAMMAR.has(t.k) || t.nt), question: /\?\s*["”’']?$/.test(s.text.trim()) };
  });
  return { input, L, sources, subjectKeys, subject: { keys: subjectKeys }, family: RULES.familyOf(input.family) };
}

/** Whether a line opens with a name and "is": "Malfoid is a nickname ...", "The pumpkin head illusion is back ...". */
function opensWithName(text, name) {
  const src = String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return !!src && new RegExp(`^(?:the\\s+)?${src}\\s+(?:is|are|was|refers)\\b`, 'i').test(String(text || ''));
}

// ---------- rule 1: shape ----------
function shape(ctx) {
  const { line } = ctx.input;
  const out = [];
  const text = String(line || '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  const min = ctx.input.kind === 'headline' ? HEADLINE_WORDS_MIN : WORDS_MIN;
  const max = ctx.input.card ? CARD_WORDS_MAX : ctx.input.kind === 'word' ? WORD_LINE_MAX : WORDS_MAX;
  if (words.length < min || words.length > max) out.push(`${words.length} words, not ${min} to ${max}`);
  // (a word's line says what people do with it: an encyclopedia's "X is a ..." is what the judges of 2026-10-11 kept marking down)
  if (ctx.input.kind === 'word' && opensWithName(text, ctx.input.subject)) out.push('it opens with its own name and "is": start with what it is or what people do');
  if (text.length > (ctx.input.card ? CARD_CHARS_MAX : CHARS_MAX)) out.push(`${text.length} characters`);
  if (!/\.["”’']?$/.test(text)) out.push('no full stop at the end');
  if (/\?/.test(text)) out.push('a question');
  if (EMOJI.test(text)) out.push('an emoji');
  if (SECOND_SENTENCE.test(text.replace(/\.["”’']?$/, ''))) out.push('more than one sentence');
  const first = ctx.L.toks[0];
  if (first && !first.cap && !first.num && !(T.isHandle(first) && spelt(ctx, first))) out.push('does not open with a capital');
  if (W.isTitleCase(words)) out.push('Title Case');
  // (a written line is a sentence: never a headline's label and its colon, "‘Lunch in My City’: The viral trend ...")
  if (ctx.input.kind !== 'headline' && LABEL_LEAD.test(text)) out.push('it opens with a label and a colon: write a sentence');
  // (nor a writer's comment on the story in place of the story: "... shows why family channels can never really log off")
  if (COMMENT.test(text)) out.push('it comments on the story and does not tell it: say what happened');
  for (const t of ctx.L.toks) if (t.s.length >= SHOUT_MIN && /^\p{Lu}+$/u.test(t.s) && !ctx.sources.some((s) => s.S.toks.some((x) => x.s === t.s))) out.push(`"${t.s}" in capitals`);
  const outside = ctx.L.toks.filter((t) => !t.q).map((t) => t.pre + t.s + t.post).join(' ');
  if (PERSON.test(outside)) out.push('first or second person');
  if (ctx.L.toks.open || (text.match(/"/g) || []).length % 2 || (text.match(/“/g) || []).length !== (text.match(/”/g) || []).length) out.push('a quotation mark left open');
  for (const q of R.quotesOf(ctx.L)) if (!ctx.sources.some((s) => holdsRun(s.keys, q.keys))) out.push(`the quoted words "${q.keys.join(' ')}" stand in no source`);
  // (two sentences about one thing stitched together say it twice: "... into a tiger enclosure ... after entering tiger enclosure")
  const said = ctx.L.toks.filter((t, i) => T.isContent(t) && !T.FREE.has(t.k) && !t.num && !ctx.L.names.has(i)).map((t) => t.st);
  const pairs = said.slice(1).map((st, n) => `${said[n]} ${st}`);
  const twice = pairs.find((p, n) => pairs.indexOf(p) !== n);
  if (twice) out.push(`it says "${twice}" twice`);
  // (and names someone in full twice: "Bexade Tamenko survived ..., and ... survivor Bexade Tamenko released ...")
  // (someone: a work's or a phrase's name in quotation marks, "‘Night Shift’ treatment", may be said in each clause that is about it)
  // (a name with no shorter form, "Art of Play", may open the reply clause after a semicolon: "...; Art of Play disputes it".
  // A person is named the second time by the surname, as the cards print one)
  const opensReply = (m) => m.start > 0 && ctx.L.toks[m.start - 1].post.includes(';') && (() => { const s = ctx.L.toks.slice(m.start, m.end + 1).map((t) => t.s).join(' ').replace(/[’']s?$/, ''); return RP.surnameOf(s) === s; })();
  const full = ctx.L.mentions.filter((m) => m.keys.length > 1 && !ctx.L.toks[m.start].q).map((m) => ({ m, name: m.keys.join(' ') }));
  const again = full.find((x, n) => full.findIndex((y) => y.name === x.name) !== n && !opensReply(x.m));
  if (again) out.push(`it names ${again.name} in full twice`);
  return out;
}
/** Whether `run` stands in `keys` word for word, side by side. */
function holdsRun(keys, run) {
  if (!run.length) return true;
  for (let i = 0; i + run.length <= keys.length; i++) if (run.every((k, n) => keys[i + n] === k)) return true;
  return false;
}
const spelt = (ctx, t) => ctx.sources.some((s) => s.S.toks.some((x) => x.s === t.s)) || T.tokensOf(ctx.input.subject || '').some((x) => x.s === t.s);

// ---------- rules 2, 3, 4: no new names, numbers, words ----------
function names(ctx) {
  const out = [];
  // (a word's own name is given to the writer: a line may say it whatever its page calls the thing)
  const own = ctx.input.kind === 'word' ? new Set(ctx.subjectKeys) : new Set();
  for (const i of ctx.L.names) {
    const t = ctx.L.toks[i];
    if (own.has(t.k)) continue;
    if (T.isHandle(t) ? !spelt(ctx, t) : !ctx.sources.some((s) => s.keys.includes(t.k))) out.push(`"${t.s}" stands in no source`);
  }
  for (const m of ctx.L.mentions) if (m.keys.length > 1 && !m.keys.every((k) => own.has(k)) && !ctx.sources.some((s) => holdsRun(s.keys, m.keys))) out.push(`no source has the name "${m.keys.join(' ')}"`);
  return [...new Set(out)];
}
function numbers(ctx) {
  const out = ctx.L.toks.filter((t) => t.num && !ctx.sources.some((s) => s.numbers.some((n) => T.sameNumber(t.num, n)))).map((t) => `the number "${t.s}" stands in no source`);
  return [...out, ...quarrels(ctx)];
}
/** What a sum counts in its sentence: the verb that leads to it and the word right after it, as stems ("paid her $200K to get": paid; "$200K abortion deal": abortion). */
function countedBy(S, i) {
  const keys = new Set();
  const verb = verbBefore(S, i, 0);
  if (verb) keys.add(verb);
  const next = S.toks.slice(i + 1, i + 4).find((t) => !t.unit && T.isContent(t) && !t.num && !T.FREE.has(t.k));
  if (next) keys.add(next.st);
  // (and what it is a sum of: the plain words right before it, "memecoin hits $30 million", "memecoin capitalization reaches 4 million")
  let seen = 0;
  for (let j = i - 1; j >= 0 && seen < COUNTED_BACK; j--) {
    const t = S.toks[j];
    if (T.breaksAfter(t)) break;
    if (t.num || t.unit || S.names.has(j) || !T.isContent(t) || T.FREE.has(t.k)) continue;
    seen += 1;
    if (!R.verbShaped(t) && t.k.length > 3) keys.add(t.st);
  }
  return keys;
}
/**
 * A sum the sources quarrel over is left out (judges, 2026-10-11: "$200K" on a card whose own sources say she was promised $200K
 * and sent $150K; "$30 million" tied to the wrong threat): a sum of money in the line fails when another source sentence gives a
 * different sum for the same thing (led to by the same verb, or followed by the same word), unless the line itself tells both.
 */
function quarrels(ctx) {
  const out = [];
  const sums = ctx.sources.flatMap((src) => src.S.toks.map((t, j) => (t.num && t.num.money ? { src, num: t.num, s: t.s, keys: countedBy(src.S, j) } : null)).filter(Boolean));
  ctx.L.toks.forEach((t, i) => {
    if (!t.num || !t.num.money) return;
    const mine = new Set([...countedBy(ctx.L, i), ...sums.filter((x) => T.sameNumber(t.num, x.num)).flatMap((x) => [...x.keys])]);
    const other = sums.find((x) => !T.sameNumber(t.num, x.num) && Math.abs(x.num.value - t.num.value) > 1e-9 && [...x.keys].some((k) => mine.has(k)));
    if (!other) return;
    // (a line that tells both sums tells the quarrel itself: "agreed to $200K but sent $150K")
    if (ctx.L.toks.some((x) => x.num && x.num.money && T.sameNumber(x.num, other.num))) return;
    out.push(`the sources give "${t.s}" and "${other.s}" for the same thing: leave the number out`);
  });
  return [...new Set(out)];
}
// the plain word for what a headline shouts: the engine tells "slams", "rips into", "lashes out at", "takes aim at" as "criticizes"
// (engine/talk-lines.js), so a line's "criticizes" is carried by a sentence that says it that way. Plainer, never surer
const SHOUTED_CRITICISM = /(?<![\p{L}\p{N}])(?:(?:rips?|ripped|slams?|slammed|blasts?|blasted|lambasts?|lambasted|torch(?:es|ed)|skewers?|skewered|eviscerat(?:es|ed))|(?:rips|tears|lays|laces|ripped|tore|laid|laced) into|(?:hits|hit|lashes|lashed) out at|(?:takes|took) aim at)(?![\p{L}\p{N}])/iu;
const plainFor = (t, src) => /^critici[sz]/.test(t.k) && SHOUTED_CRITICISM.test(src.text);
/**
 * Whether a source is read by the engine as the subject's own denial ("Quoria Brannith calls BS on claim he had ...", "pushes back on
 * the allegations"): what lets a line say "denies" where the source says it another way. Plainer, never surer: the engine words
 * that sentence as "he denies it" (engine/talk-nouns.js `denialClause`), and rule 9 already reads the line by the same function.
 */
const deniesBySubject = (ctx, src) => src.type === 'outlet' && !src.question && !!TN.denialClause(src.text, ctx.subjectKeys.join(' '), null, ctx.input.subject || '', 10);
/**
 * Whether the line's denying word at `i` is said by a name the source has say it is not so (lib/line-replies.js `saysNo`): "Art
 * of Play disputes it" beside "Art of Play responds to her complaint, claiming she tried to buy an item not for sale"; "Wexwy
 * denies it" beside "Wexwy rejects Dovette’s claim". The reported "<name> denies it" is what the engine itself words such a sentence
 * as (2026-10-13: the answer a claim got sat in the sources under a line that left it off, because no source said "denies").
 */
function deniesByMaker(ctx, src, i) {
  if (src.type !== 'outlet' || src.question) return false;
  const r = R.rolesAt(ctx.L, i);
  const m = r && r.maker && r.maker.m && r.maker.kind !== 'pronoun' ? r.maker.m : null;
  if (!m) return false;
  // (the name as the source spells it, so a short name in the line finds the full one there)
  const spelt = T.tokensOf(src.text).filter((t, j) => m.keys.includes(t.k) && (src.S.names.has(j) || t.cap)).map((t) => t.s.replace(/[’']s?$/, ''));
  return spelt.length > 0 && !!RP.saysNo(src.text, m.keys.map((k) => spelt.find((w) => w.toLowerCase() === k) || k).join(' '));
}
/**
 * Whether the line's denying word at `i` is said by a party the line names by what it is ("the store denies ...", "police deny
 * ...") and a source has that party deny right before the same kind of word: "New York Store denies she got the ‘Pretty Woman’
 * treatment". Told in the sentence's own words, by whoever the sentence says denies (lib/line-replies.js `partyBefore`, `saysNo`).
 */
function deniesByParty(ctx, src, i) {
  if (src.type !== 'outlet' || src.question) return false;
  const party = RP.partyBefore(ctx.L.toks, i);
  return !!party && !!RP.saysNo(src.text, party);
}
const deniesIn = (ctx, src, i) => (T.DENY.test(ctx.L.toks[i].k) && deniesBySubject(ctx, src)) || (T.DENIES.test(ctx.L.toks[i].k) && (deniesByMaker(ctx, src, i) || deniesByParty(ctx, src, i)));
function words(ctx) {
  const out = [];
  const own = ctx.input.kind === 'word' ? new Set(ctx.subjectKeys) : new Set();
  ctx.L.toks.forEach((t, i) => {
    if (!T.isContent(t) || t.num || ctx.L.names.has(i) || T.FREE.has(t.k) || own.has(t.k)) return;
    if (T.NEG_GRAMMAR.has(t.k) || t.nt) { if (!ctx.sources.some((s) => s.negates)) out.push(`"${t.s}": no source says no`); return; }
    if (!ctx.sources.some((s) => s.stems.has(t.st) || plainFor(t, s) || deniesIn(ctx, s, i))) out.push(`${T.claimClass(t.k) ? 'the claim word' : 'the word'} "${t.s}" stands in no source`);
  });
  return [...new Set(out)];
}

// ---------- rule 5: one claim, one sentence ----------
const SAYS_TAIL = new Set(['says', 'said', 'say', 'alleges', 'claims', 'reports']);
/** Whether the name at `i` stands inside an aside that a later comma closes before any verb ("Wexmo's ex, Plonlo, alleges"). */
function asideAt(L, i, from) {
  const m = L.at.get(i);
  if (!m) return false;
  // (the aside's own opening: something named or described stands right before the comma)
  return T.commaAfter(L.toks[m.end]) && m.start - 1 >= from;
}
/**
 * The line's claims: its clauses, each { from, to (token indexes), link (the word that joins it to the one before, or null),
 * mentions, heir (the name it inherits when it names nobody: who the clause before it was about) }. A clause opens after a
 * semicolon, a colon or a dash, at a joining word ("after", "amid", "while", "but" ...), at an "and" or "as" that leads to a verb,
 * and at a comma where a new name starts doing something new; never at who says so, hung on the end (", UK prosecutors claim"),
 * which belongs to the clause before it. verbAt(i): whether the word at `i`, in -s at a clause's start, is a verb by the sources
 * (they have it right after who does it): the clause's doer was cut, "...; threatens to sue Tobin Hale".
 */
function clausesOf(L, verbAt = () => false) {
  const { toks } = L;
  // (where the part of the sentence that holds `i` ends: the next semicolon, colon or dash, or the sentence's end)
  const partEnd = (i) => { for (let j = i; j < toks.length; j++) if (T.breaksAfter(toks[j])) return j; return toks.length - 1; };
  const saysWho = (i) => RULES.saidTail(L, i - 1, partEnd(i)) === i;
  const starts = [0];
  const verbAfter = (i) => { for (let j = i + 1; j < toks.length && !T.breaksAfter(toks[j - 1]) && !T.CONNECTIVE.has(toks[j].k); j++) if (saysWhat(L, j)) return true; return false; };
  const verbBefore = (i) => { for (let j = i - 1; j >= starts[starts.length - 1]; j--) if (saysWhat(L, j)) return true; return false; };
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    const prev = toks[i - 1];
    if (t.q && prev.q === t.q) continue;
    const last = starts[starts.length - 1];
    if (T.breaksAfter(prev)) starts.push(i);
    else if (T.CONNECTIVE.has(t.k)) {
      // (how long before or after belongs to what follows: ", days after Tamard denied ...")
      let at = i;
      if (at - 1 > last && TIME_WORD.has(toks[at - 1].k)) {
        at -= 1;
        // ("two days after", "a week before": the count belongs to the time word, and only to it)
        while (at - 1 > last && (toks[at - 1].num || ['a', 'few', 'just'].includes(toks[at - 1].k))) at -= 1;
      }
      if (at > last) starts.push(at);
    } else if (t.k === 'and' && verbAfter(i) && verbBefore(i)) starts.push(i);
    else if (t.k === 'as' && !['a', 'an'].includes((toks[i + 1] || {}).k) && !AS_NO_CLAUSE.has(prev.k) && verbAfter(i) && verbBefore(i)) starts.push(i);
    else if (T.commaAfter(prev) && L.at.has(i) && L.at.get(i).start === i) {
      // (a run-on: after a comma a new name does something, said flat: never the ", Dovette says" that ends a sentence. With no verb
      // before the comma it is a roundup's second item all the same, when someone was named before it: "X and Y's beef, Prince
      // Rouet 'slipped into depression'")
      const m = L.at.get(i);
      const next = toks[m.end + 1];
      const namedBefore = L.mentions.some((x) => x.end < i && x.start >= last && !T.sameName(x, m));
      const lone = !SAYS_TAIL.has((next || {}).k) || m.end + 2 < toks.length;
      if (!m.poss && next && !saysWho(i) && saysWhat(L, m.end + 1) && !T.commaAfter(toks[m.end]) && (verbBefore(i) || (namedBefore && lone && !asideAt(L, i, last)))) starts.push(i);
    }
  }
  const spans = [...new Set(starts)].sort((a, b) => a - b).map((from, n, all) => ({ from, to: (all[n + 1] ?? toks.length) - 1 }));
  const clauses = [];
  for (const span of spans) {
    const content = toks.slice(span.from, span.to + 1).filter((t) => T.isContent(t) && !T.FREE.has(t.k));
    if (!content.length && clauses.length) { clauses[clauses.length - 1].to = span.to; continue; }
    const head = toks[span.from];
    // (the word that joins it to the clause before: its first word, or the joining word after "two days", "a week")
    const joiner = toks.slice(span.from, span.from + 4).find((t) => T.CONNECTIVE.has(t.k));
    clauses.push({ ...span, link: span.from === 0 ? null : head.k === 'and' || head.k === 'as' ? head.k : joiner ? joiner.k : null });
  }
  let heir = null;
  for (const c of clauses) {
    c.mentions = L.mentions.filter((m) => m.start >= c.from && m.end <= c.to);
    // (a clause that opens on what was done, with nobody doing it, carries on the clause before it even when it names whom it was
    // done to: "...; threatens possible defamation lawsuit against Tobin Hale" is said of whoever the line last told of, and the
    // sentence that carries it must name that one. Reviewers, 2026-10-12: another person's threat passed under the subject's name)
    c.lead = c.from > 0 ? leadVerb(L, c, verbAt) : null;
    c.heir = c.mentions.length && c.lead === null ? null : heir;
    if (c.mentions.length) heir = aboutOf(L, c) || heir;
  }
  return clauses;
}
const LEAD_SKIP = new Set(['and', 'as', 'then', 'also', 'later', 'now']);
/**
 * The index of the verb a clause opens on with no doer of its own, or null: its first word past a joining word or an adverb
 * ("after allegedly assaulting ...", "and denies ...", "; threatens ...") says what was done, and no name stands before it. A word
 * in -ed or -ing, a past form or one of the engine's verbs; a word in -s only when the sources have it as a verb (`verbAt`).
 */
function leadVerb(L, c, verbAt) {
  for (let i = c.from; i <= c.to; i++) {
    const t = L.toks[i];
    if (L.names.has(i) || t.q) return null;
    if (T.CONNECTIVE.has(t.k) || LEAD_SKIP.has(t.k) || T.FREE.has(t.k) || T.ADVERB.has(t.k) || TIME_WORD.has(t.k) || t.num || /ly$/.test(t.k) || T.AUX.has(t.k) || !T.isContent(t)) continue;
    if (R.isNominal(L, i)) return null;
    // (a participle that describes the thing after it opens a noun phrase, not a deed: "leaked footage shows ...")
    // (a word in -s: a claim's own verb, "sues", "denies", "attacks"; else one the sources have right after who does it)
    const verb = /[^s]s$/.test(t.k) && !R.verbShaped(t) ? !!T.claimClass(t.k) || verbAt(i) : R.verbShaped(t) && R.readable(L, i);
    return verb ? i : null;
  }
  return null;
}
/**
 * Who a clause is about, for the clause after it that names nobody: the doer of its first verb (the one it was done to, in the
 * passive), else the last name before that verb. A name that only stands after the verb is where or to whom, not who: "A man
 * jumped into a tiger enclosure in Yorkshire and died" is not about Yorkshire.
 */
function aboutOf(L, c) {
  for (let i = c.from; i <= c.to; i++) {
    if (!R.readable(L, i) || R.isNominal(L, i)) continue;
    const r = R.rolesAt(L, i);
    const who = r.voice === 'passive' ? r.target : r.maker;
    if (who && who.m && who.kind !== 'poss') return who.m;
    const before = c.mentions.filter((m) => m.end < i && !m.poss);
    return before.length ? before[before.length - 1] : null;
  }
  return c.mentions.find((m) => !m.poss) || null;
}

const hasName = (src, m) => m.keys.every((k) => src.keys.includes(k));
/**
 * Whether a source names the row's own subject where the line gives it in full: by the name's last word, as a name of its own
 * ("Voss filmed ..." under Mara Voss). Never as a part of somebody else's name: "Aldric Moreau" does not name Prince Aldric.
 */
function namesSubject(ctx, src, m) {
  if (!ctx.subjectKeys.length || m.keys.length !== ctx.subjectKeys.length || !m.keys.every((k, n) => k === ctx.subjectKeys[n])) return false;
  const last = ctx.subjectKeys[ctx.subjectKeys.length - 1];
  return src.S.mentions.some((x) => x.keys.includes(last) && x.keys.every((k) => ctx.subjectKeys.includes(k)));
}
/** Why a source sentence does not carry a clause whole, or null when it does: every name and number, its verb, 80% of its words. */
function notCarried(ctx, c, src, { slack = false } = {}) {
  const { L } = ctx;
  const subjectShort = (i) => { const m = L.at.get(i); return !!m && namesSubject(ctx, src, m); };
  for (const m of [...c.mentions, ...(c.heir ? [c.heir] : [])]) if (!hasName(src, m) && !namesSubject(ctx, src, m)) return `it does not name ${m.keys.join(' ')}`;
  let all = 0;
  let held = 0;
  for (let i = c.from; i <= c.to; i++) {
    const t = L.toks[i];
    if (t.num) { if (!src.numbers.some((n) => T.sameNumber(t.num, n))) return `it does not have "${t.s}"`; all += 1; held += 1; continue; }
    if (!T.isContent(t) || T.FREE.has(t.k) || T.NEG_GRAMMAR.has(t.k) || t.nt) continue;
    let there = L.names.has(i) ? src.keys.includes(t.k) || subjectShort(i) : src.stems.has(t.st) || plainFor(t, src) || deniesIn(ctx, src, i);
    // (more careful than its source: "alleges" or "claims" where the sentence has the same one saying it)
    if (!there && /^(?:alleg|claim)/.test(t.st) && !L.names.has(i)) { const who = R.rolesAt(L, i).maker; there = !!who && !!who.m && who.kind !== 'poss' && saysIn(src.S, who.m); }
    if (!there && saysWhat(L, i)) return `it does not say "${t.s}"`;
    all += 1;
    if (there) held += 1;
  }
  // (one word in five may come from another sentence, never in a clause that makes a claim of someone named: there every word is
  // the carrier's. "accused of sending explicit messages to a minor fan" took its "minor" from a sentence that says no minor)
  const claims = (c.mentions.length || c.heir) && L.toks.slice(c.from, c.to + 1).some((t, n) => !L.names.has(c.from + n) && ['report', 'record', 'guilt'].includes(T.claimClass(t.k)));
  return all && held / all < (claims && !slack ? 1 : CARRIED_SHARE) ? `it has ${held} of its ${all} words` : null;
}

// ---------- rule 6: who did what to whom ----------
const SAYER_NEAR = 3;
const NUMBER_VERB_NEAR = 6;
/** The stem of the verb that leads to the number at `i`: the nearest verb-shaped word before it in its part of the sentence, or null. */
function verbBefore(S, i, from) {
  for (let j = i - 1; j >= from && i - j <= NUMBER_VERB_NEAR; j--) {
    if (T.breaksAfter(S.toks[j]) || T.commaAfter(S.toks[j])) return null;
    if (!S.names.has(j) && T.isContent(S.toks[j]) && !S.toks[j].num && R.verbShaped(S.toks[j])) return S.toks[j].st;
  }
  return null;
}
/** A possessive keeps its owner: "<owner>'s <thing>" in the line is the same owner's same thing in the source ("Wexmo's ex"). */
function ownerDiffers(L, c, src) {
  for (let i = c.from; i <= c.to; i++) {
    const t = L.toks[i];
    if (!t.poss || T.PRONOUN[t.k]) continue;
    const head = L.toks.slice(i + 1, i + 4).find((x) => !QUIET_HEAD(x));
    if (!head) continue;
    const toks = src.S.toks;
    const owned = toks.some((x, j) => x.k === t.k && x.poss && toks.slice(j + 1, j + 5).some((y) => y.st === head.st));
    const of = toks.some((x, j) => x.st === head.st && toks.slice(j + 1, j + 4).some((y, n) => ['of', 'by', 'from'].includes(y.k) && toks.slice(j + 2 + n, j + 6 + n).some((z) => z.k === t.k)));
    if (!owned && !of) return `"${t.s}’s ${head.s}" is not ${t.s}’s in the source`;
  }
  return ownerDropped(L, c, src) || givenDiffers(L, c, src);
}
/** The line's reading of one word, the doer it leaves out taken from the verb before it ("... and denies it"). */
function rolesIn(S, i) {
  const r = R.rolesAt(S, i);
  if (r.maker || r.voice !== 'active') return r;
  for (let j = i - 1; j >= 0; j--) {
    if (!R.readable(S, j) || R.isNominal(S, j) || S.toks[j].q !== S.toks[i].q) continue;
    const before = R.rolesAt(S, j);
    const who = before.voice === 'passive' ? before.target : before.maker;
    if (who && who.kind !== 'pronoun') return { ...r, maker: { ...who, gap: [], inherited: true } };
  }
  return r;
}
// the saying words a line may give someone: only when a source has that very one making a saying (or a claim) of their own
const TELLS = /^(?:says?|said|tells?|told|claims?|claimed|alleges?|alleged|admits?|admitted|insists?|insisted|writes?|wrote|posts?|posted|tweets?|tweeted|reveals?|revealed|explains?|explained|adds?|added|declares?|declared)$/;
/**
 * Whether a source has `mention` as the maker of a saying word of its own ("Dovette says ...", "Dovette accuses ...", "... & claims
 * he's saving evidence"): what lets a line write "<name> says". Being the doer of anything will not do: "Dovette says Bexan Tamard
 * abused him" has Bexan Tamard doing the alleged act, and "Bexan Tamard says he abused Dovette" is no reading of it (reviewers, 2026-10-12).
 */
function saysIn(S, mention) {
  return S.toks.some((t, i) => !S.names.has(i) && (R.SAY.test(t.k) || T.REPORT.test(t.k)) && (() => {
    const r = rolesIn(S, i);
    return !!r.maker && (r.maker.kind === 'name' || r.maker.kind === 'owner') && T.sameName(r.maker.m, mention);
  })());
}
/** Whether the word at `i` has a doer or a target the line names (or a pronoun it bound to a name). */
const namedSide = (r) => [r.maker, r.target].some((np) => np && (np.kind === 'name' || np.kind === 'owner' || np.kind === 'poss'));
/** Why a source that carries a clause gives its people other sides, or null when the sides hold. */
function sidesDiffer(ctx, c, src) {
  const { L } = ctx;
  const owner = ownerDiffers(L, c, src);
  if (owner) return owner;
  for (let i = c.from; i <= c.to; i++) {
    const t = L.toks[i];
    if (t.q) continue;
    if (['says', 'said', 'say'].includes(t.k)) {
      if (i > 0 && L.toks[i - 1].unit) continue;
      // (who is given as saying it, when no name is: ", police say", "her attorneys say". The source has them saying something)
      const sayers = [];
      for (let j = i - 1; j >= c.from && i - j <= SAYER_NEAR && !T.commaAfter(L.toks[j]) && !T.breaksAfter(L.toks[j]); j--) if (T.isContent(L.toks[j]) && !T.FREE.has(L.toks[j].k) && !L.names.has(j)) sayers.push(L.toks[j]);
      const told = (st) => src.S.toks.some((x, j) => x.st === st && src.S.toks.slice(Math.max(0, j - SAYER_NEAR), j + SAYER_NEAR + 1).some((y) => R.SAY.test(y.k) || y.k === 'say' || y.k === 'according'));
      const unsaid = sayers.find((x) => !told(x.st));
      if (unsaid) return `the source does not have "${unsaid.s}" saying it`;
      // (the one right before it: "Bexan Tamard says", ", the DA says"; never a name further back in the sentence)
      const who = R.leftOf(L, i);
      if (who && who.kind === 'name' && !(who.gap || []).length && i - who.m.end <= SAYER_NEAR && !saysIn(src.S, who.m)) return `the source does not have ${who.m.keys.join(' ')} saying it`;
      continue;
    }
    // ("<name> tells", "<name> admits", "<name> claims": the same test as "says")
    if (TELLS.test(t.k) && !L.names.has(i) && !R.isNominal(L, i)) {
      const who = R.leftOf(L, i);
      if (who && who.kind === 'name' && !(who.gap || []).length && i - who.m.end <= SAYER_NEAR && !saysIn(src.S, who.m)) return `the source does not have ${who.m.keys.join(' ')} saying it`;
    }
    if (!R.readable(L, i) && c.lead !== i) continue;
    // (read where the source has the same word in a form that can be read: a bare noun there says nothing of who)
    // (a verb the line's clause opens on is read in the source wherever it stands as a verb, after "and" as after a name: "... &
    // claims he's saving evidence" gives the claiming to whoever the sentence was about, as the line's clause does)
    const there = src.S.toks.map((x, j) => (x.st === t.st && (R.readable(src.S, j) || (c.lead === i && !src.S.names.has(j) && !R.isNominal(src.S, j))) ? j : -1)).filter((j) => j >= 0);
    const line = rolesIn(L, i);
    if (!there.length) {
      // (a wrongdoing, an act on record or a claim the line gives a doer or a target, where the source has only the bare noun:
      // "accused of abuse by Dovette" does not say Dovette abused anyone, "call for arrest of attacker" arrests nobody named. The
      // noun with its owner right before it is the owner's all the same: "Wynory Pymith's arrest")
      const cls = T.claimClass(t.k);
      // (whose a death or an arrest is, the engine's own readings say for every source at once: rule 8)
      if (!['guilt', 'record', 'report'].includes(cls) || t.st === 'die' || t.st === 'arrest' || !namedSide(line) || !src.S.toks.some((x) => x.st === t.st)) continue;
      const whose = line.voice === 'passive' ? line.target : line.maker || line.target;
      const owned = !!whose && !!whose.m && src.S.toks.some((x, j) => x.st === t.st && j > 0 && src.S.toks[j - 1].poss && src.S.at.has(j - 1) && T.sameName(src.S.at.get(j - 1), whose.m));
      if (owned) continue;
      return `"${t.s}": the source does not say who did it`;
    }
    if (!line.maker && !line.target) continue;
    // (where the source's own word opens a part of its sentence, after a comma or "and", it carries on that sentence's doer as the
    // line's clause does: never whoever happens to be named last before the comma, "... on Tobin Hale's allegations, threatens ...")
    const carriesOn = (j) => { const prev = src.S.toks[j - 1]; return c.lead === i && !!prev && (T.commaAfter(prev) || T.breaksAfter(prev) || prev.k === 'and' || prev.k === 'then'); };
    const sourceRoles = (j) => {
      const r = rolesIn(src.S, j);
      if (!carriesOn(j)) return r;
      for (let k = j - 1; k >= 0; k--) {
        if (!R.readable(src.S, k) || R.isNominal(src.S, k)) continue;
        const before = R.rolesAt(src.S, k);
        const who = before.voice === 'passive' ? before.target : before.maker;
        return { ...r, maker: who && who.kind !== 'pronoun' ? { ...who, gap: [], inherited: true } : null };
      }
      return { ...r, maker: null };
    };
    const diffs = there.map((j) => R.rolesDiffer(line, sourceRoles(j)));
    if (diffs.every(Boolean)) return `"${t.s}": ${diffs[0]}`;
  }
  // a number stays with what it counts: the verb before it in the line is the verb before it in the source ("paid $150K after
  // discussing a $200K deal" never pays $200K)
  for (let i = c.from; i <= c.to; i++) {
    const t = L.toks[i];
    if (!t.num) continue;
    // (what leads to it: the verb before it, else the word right before it: "dies at 86", "dead at 86" and "has died at 86" are one)
    const leadOf = (S, j, from) => verbBefore(S, j, from) || (() => {
      for (let k = j - 1; k >= from && j - k <= 3; k--) {
        if (T.breaksAfter(S.toks[k]) || T.commaAfter(S.toks[k]) || S.names.has(k)) return null;
        if (T.isContent(S.toks[k]) && !S.toks[k].num && !T.FREE.has(S.toks[k].k)) return S.toks[k].st;
      }
      return null;
    })();
    const mine = leadOf(L, i, c.from);
    const theirs = src.S.toks.map((x, j) => (x.num && T.sameNumber(t.num, x.num) ? leadOf(src.S, j, 0) : undefined)).filter((v) => v !== undefined);
    // (a number the source gives no verb for is not the count of the line's verb: an age is no number of fans)
    if (mine && theirs.length && theirs.every((v) => v !== mine)) return `"${t.s}" goes with another word in the source`;
    // (and it counts the same thing: "300 fans ... 7 million viewers" never scams 7 million fans)
    // (in a Title Case headline a capital tells no name: "Four Kids ‘Demons’" counts kids, as the line's "four kids" does)
    const counted = (S, j) => { const next = S.toks.slice(j + 1, j + 4).find((x) => !x.unit && T.isContent(x) && !x.num && !T.FREE.has(x.k) && (S.title || !S.names.has(x.i))); return next ? next.st : null; };
    const what = counted(L, i);
    const whats = src.S.toks.map((x, j) => (x.num && T.sameNumber(t.num, x.num) ? counted(src.S, j) : undefined)).filter((v) => v !== undefined);
    if (what && whats.length && whats.every((v) => v && v !== what) && !t.num.money) return `"${t.s}" counts something else in the source`;
  }
  // a quote stays with the speaker its source gives
  for (const q of R.quotesOf(L)) {
    if (q.from < c.from || q.from > c.to || q.keys.length < 2 || !holdsRun(src.keys, q.keys)) continue;
    const mine = R.speakerOf(L, q);
    const sq = R.quotesOf(src.S).find((x) => holdsRun(x.keys, q.keys)) || null;
    const theirs = sq ? R.speakerOf(src.S, sq) : null;
    if (mine && theirs && !R.sameOne(mine, theirs)) return 'the quote is someone else’s in the source';
  }
  return null;
}

// ---------- rule 7: negation kept ----------
const NEAR_BEFORE = 3;
const NEAR_AFTER = 2;
const NEAR_WORD = 2;
/**
 * Whether the word at `i` is said not to be so: a "not", a "never" or a denial up to three content words before it in its part of
 * the sentence, "dropped" or "false" up to two after. Names and small words between them do not count ("charges against Bexan Tamard
 * dropped"), so a line that adds "the" reads as its source does.
 */
function negatedAt(S, i) {
  const { toks } = S;
  const counts = (j) => !S.names.has(j) && T.isContent(toks[j]) && !T.FREE.has(toks[j].k);
  for (let j = i - 1, seen = 0; j >= 0 && seen < NEAR_BEFORE; j--) {
    // (nor past a word that joins another part on: "will not apologise after he assaulted a fan" says no of the apology alone)
    if (T.breaksAfter(toks[j]) || T.commaAfter(toks[j]) || toks[j].q !== toks[i].q || T.CONNECTIVE.has(toks[j].k)) break;
    // ("not" and "never" reach three words on; a word that denies reaches what it denies and what describes it: two)
    if (toks[j].neg && !S.names.has(j)) { if (T.NEG_GRAMMAR.has(toks[j].k) || toks[j].nt || seen < NEAR_WORD) return true; break; }
    if (counts(j)) seen += 1;
  }
  for (let j = i + 1, seen = 0; j < toks.length && seen < NEAR_AFTER; j++) {
    if (T.breaksAfter(toks[j - 1]) || toks[j].q !== toks[i].q) break;
    if (!S.names.has(j) && (T.UNDONE.test(toks[j].k) || /^(?:hoax(?:es)?|false|fake|untrue|debunked)$/.test(toks[j].k))) return true;
    if (counts(j)) seen += 1;
  }
  return false;
}
/** Whether the word at `i` is only looked ahead to: "could face", "if convicted", "set to be executed", a headline that asks. */
function aheadAt(S, i) {
  const { toks } = S;
  if (/\?\s*["”’']?$/.test(S.text.trim())) return true;
  for (let j = i - 1; j >= 0 && i - j <= 8; j--) {
    if (T.breaksAfter(toks[j]) || T.commaAfter(toks[j])) break;
    if (T.AHEAD.has(toks[j].k) && !(toks[j].cap && j > 0)) return true;
    if (toks[j].k === 'be' && j > 0 && toks[j - 1].k === 'to') return true;
  }
  return false;
}
const AHEAD_STOPS = new Set([...T.CONNECTIVE, 'and', 'as', 'or', 'who', 'which', 'that', 'he', 'she', 'they']);
const AHEAD_HOPS = 2;
/**
 * Whether a word that looks ahead governs the very word at `i` (rule 8): it stands right before it or its helping words ("could
 * face charges", "set to be sentenced", "if convicted"), or right before the word that does ("could be charged with assault"),
 * inside the same clause. A name, a comma, "after", "amid", "as", "and" or "while" between them ends it: "faces backlash after
 * assaulting a fan" looks ahead to no assault, it states one (reviewers, 2026-10-12).
 */
function aheadGoverns(S, i, hops = AHEAD_HOPS) {
  const { toks } = S;
  if (/\?\s*["”’']?$/.test(S.text.trim())) return true;
  for (let j = i - 1; j >= 0; j--) {
    const t = toks[j];
    if (T.breaksAfter(t) || T.commaAfter(t) || t.q !== toks[i].q || S.names.has(j) || AHEAD_STOPS.has(t.k)) return false;
    if (T.AHEAD.has(t.k) && !(t.cap && j > 0)) return true;
    if (t.k === 'be' && j > 0 && toks[j - 1].k === 'to') return true;
    if (T.STOP.has(t.k) || T.ADVERB.has(t.k) || T.AUX.has(t.k) || T.NEG_GRAMMAR.has(t.k) || t.nt || t.num || t.unit) continue;
    // (the word before it is not one that looks ahead: it may itself be governed by one, a step back)
    return hops > 1 ? aheadGoverns(S, j, hops - 1) : false;
  }
  return false;
}
/** Why a source that carries a clause says no where the line says yes (or the other way), or null. */
function negationDiffers(ctx, c, src) {
  const { L } = ctx;
  for (let i = c.from; i <= c.to; i++) {
    const t = L.toks[i];
    if (L.names.has(i)) continue;
    if (T.NEG_GRAMMAR.has(t.k) || t.nt) { if (!src.negates) return `the source has no "${t.s}"`; continue; }
    if (t.neg) { if (!src.stems.has(t.st) && !deniesIn(ctx, src, i)) return `the source has no "${t.s}"`; continue; }
    // (how sure it is said to be is the source's to say: "will be charged" is no "could be charged")
    if (T.AHEAD.has(t.k) && !t.cap && !src.stems.has(t.st)) return `the source does not say "${t.s}"`;
    // (every word of the claim, not its verb alone: "has read a book" is no "has never read a book")
    if (!T.isContent(t) || t.num || T.FREE.has(t.k) || T.REPORT.test(t.k)) continue;
    const there = src.S.toks.map((x, j) => (x.st === t.st && !src.S.names.has(j) ? j : -1)).filter((j) => j >= 0);
    if (!there.length) continue;
    const mine = negatedAt(L, i);
    if (there.every((j) => negatedAt(src.S, j)) !== mine) return mine ? `the source does not say no by "${t.s}"` : `the source says no by "${t.s}"`;
    if ((T.RECORD.test(t.k) || T.GUILT.test(t.k)) && there.every((j) => aheadAt(src.S, j)) && !aheadAt(L, i)) return `the source only looks ahead to "${t.s}"`;
  }
  return null;
}

// ---------- one story (the claims of a line belong together) ----------
/** Whether a source joins two of its parts with a word that says so ("after", "amid", "over"), between positions a and b. */
const linked = (src, a, b) => src.S.toks.slice(Math.min(a, b), Math.max(a, b) + 1).some((t) => LINKS.has(t.k));
/** The clauses that are no part of the subject's story: they name others only, and no source ties them to it. */
function strays(ctx, clauses, carriers) {
  const isSubject = (m) => T.sameName(m, ctx.subject) || m.keys.some((k) => ctx.subjectKeys.includes(k) && ctx.subjectKeys.length === 1);
  // (a subject that is no person may stand in small letters: "green card program suspension")
  const saysSubject = (c) => holdsRun(ctx.L.toks.slice(c.from, c.to + 1).map((t) => t.k), ctx.subjectKeys);
  // (a quote belongs to whoever says it: it is no clause of its own to tie)
  const quoted = (c) => ctx.L.toks.slice(c.from, c.to + 1).every((t) => t.q);
  // (nor is a clause with no doer of its own, which carries on the one before it: "... was attacked and robbed in West Hollywood")
  const ownDoer = (c) => {
    for (let i = c.from; i <= c.to; i++) {
      if (!R.readable(ctx.L, i)) continue;
      const r = R.rolesAt(ctx.L, i);
      const who = r.voice === 'passive' ? r.target : r.maker;
      if (who && who.m && who.m.start >= c.from && !isSubject(who.m)) return true;
    }
    // (a clause that opens on someone else and what they did, in quotes or out of them: a roundup's next item)
    const first = c.mentions[0];
    return !!first && first.start === c.from && !first.poss && !isSubject(first) && first.end + 1 <= c.to && saysWhat(ctx.L, first.end + 1);
  };
  const names = (c) => c.mentions.some(isSubject) || saysSubject(c);
  // (a line that never names the subject is one story all the same, its first clause's: a moment's subject is a loose thing)
  const anchored = clauses.some(names);
  const tied = clauses.map((c, n) => !ctx.subjectKeys.length || !c.mentions.length || quoted(c) || names(c) || !ownDoer(c) || (!anchored && n === 0));
  // (what follows a colon is said of its heading: "'Other Mommy' review: Pellus Sorrley commits ...", "Orrane Neskwyn dies at 86: Bears icon shaped ...")
  clauses.forEach((c, n) => { if (n > 0 && tied[n - 1] && ctx.L.toks[c.from - 1].post.includes(':')) tied[n] = true; });
  for (let pass = 0; pass < clauses.length; pass++) {
    clauses.forEach((c, n) => {
      if (tied[n]) return;
      // (it shares someone with a clause that is tied, or one source carries both and joins them in so many words)
      // (the same one: the same full name, or a short name for someone a tied clause gave in full, "Tobin Hale ...; Hale
      // threatens". Never a fuller name than the tied clause said, and never by the subject's own short name: "Aldric ‘crushed’
      // ...; Aldric Moreau humiliated ..." is two people, and under a row about one brother a bare surname does not bring in
      // the other. Reviewers, 2026-10-12)
      const sameOne = (m, x) => (m.keys.length === x.keys.length ? m.keys.every((k, n) => k === x.keys[n]) : x.keys.length < m.keys.length && x.keys.every((k) => m.keys.includes(k)));
      const shares = clauses.some((d, k) => tied[k] && d.mentions.some((m) => c.mentions.some((x) => !isSubject(m) && sameOne(m, x))));
      // (joined to a clause that is tied in its own right: one that names nobody only carries on the clause before it, and ties
      // nothing. "<another> humiliated as unseen footage goes viral" is not the row's story for its own tail's sake)
      const joined = clauses.some((d, k) => tied[k] && k !== n && (d.mentions.length > 0 || k === 0) && carriers[n].some((src) => carriers[k].includes(src) && linked(src, firstAt(ctx, d, src), firstAt(ctx, c, src))));
      if (shares || joined) tied[n] = true;
    });
  }
  return clauses.filter((c, n) => !tied[n]);
}
/** Where a clause's first own word stands in a source (its first name, else its first word that is there). */
function firstAt(ctx, c, src) {
  for (let i = c.from; i <= c.to; i++) {
    const t = ctx.L.toks[i];
    if (!T.isContent(t) || T.FREE.has(t.k)) continue;
    const at = src.S.toks.findIndex((x) => (ctx.L.names.has(i) ? x.k === t.k : x.st === t.st));
    if (at >= 0) return at;
  }
  return 0;
}

/**
 * Two accusers, one line (the Bexan Tamard card of 2026-10-12 told one woman's claim and another man's in one sentence): the clauses
 * of a line that each tell a claim name the same other people, or one source names them together. A semicolon joins what its
 * sources tell as one story, never two stories that share a subject. Returns the two names, or null.
 */
function twoAccusers(ctx, clauses) {
  const isSubject = (m) => T.sameName(m, ctx.subject) || m.keys.every((k) => ctx.subjectKeys.includes(k));
  // (a country's or an agency's initials name no accuser to tell apart, nor does a shouted word: "UK prosecutors claim", "calls BS on")
  const initials = (m) => m.keys.length === 1 && /^\p{Lu}{2,5}$/u.test(ctx.L.toks[m.start].s) && !W.isFirstName(m.keys[0]);
  const others = (c) => c.mentions.filter((m) => !isSubject(m) && !m.poss && !ctx.L.toks[m.start].q && !m.keys.every((k) => NOT_A_PERSON.has(k)) && !initials(m));
  const claims = (c) => ctx.L.toks.slice(c.from, c.to + 1).some((t, n) => !ctx.L.names.has(c.from + n) && (['report', 'guilt', 'record'].includes(T.claimClass(t.k)) || R.SAY.test(t.k)));
  const told = clauses.map((c) => ({ c, who: others(c) })).filter((x) => x.who.length && claims(x.c));
  for (let a = 0; a < told.length; a++) {
    for (let b = a + 1; b < told.length; b++) {
      if (told[a].who.some((m) => told[b].who.some((x) => T.sameName(m, x)))) continue;
      const [m, x] = [told[a].who[0], told[b].who[0]];
      const together = ctx.sources.some((src) => m.keys.every((k) => src.keys.includes(k)) && x.keys.every((k) => src.keys.includes(k)));
      if (!together) return [m.keys.join(' '), x.keys.join(' ')];
    }
  }
  return null;
}

const NOT_A_PERSON = new Set(['tiktok', 'twitch', 'kick', 'youtube', 'instagram', 'x', 'twitter', 'netflix', 'reddit', 'snapchat', 'discord', 'ai', 'gen', 'z', 'alpha']);
const quotedSpan = (L, c) => L.toks.slice(c.from, c.to + 1).every((t) => t.q);

// ---------- the check ----------
function checkLine(input) {
  const failures = [];
  const fail = (rule, whys) => { for (const why of [].concat(whys || [])) failures.push({ rule, why }); };
  if (!input || typeof input.line !== 'string' || !input.line.trim()) return { ok: false, failures: [{ rule: 1, why: 'no line' }], carried: [] };
  if (!Array.isArray(input.sources) || !input.sources.length) return { ok: false, failures: [{ rule: 5, why: 'no source sentences' }], carried: [] };
  const ctx = prepare(input);
  fail(1, shape(ctx));
  fail(2, names(ctx));
  fail(3, numbers(ctx));
  fail(4, words(ctx));
  // (a word's, a meme's or a format's line says what a thing is, of nobody: its shape, and that every name, number and word of it
  // stands in what its page says. Who did what to whom is a story's question: "a meme based on a video" has no doer to check)
  // (but a meme is often about someone: a line that names a person beyond the thing itself, or carries a claim's word, is held to
  // who did what, the negation, the hedge and the denial exactly as a story's line is. Reviewers, 2026-10-12: "Memes about streamer
  // Bexan Tamard, who abused his former moderator ..." passed on its shape alone)
  const own = new Set(ctx.subjectKeys);
  // (a person: a name of two words or more outside quotes, or a given name; a platform, a brand or a work's name in quotes is none)
  const person = (m) => !m.keys.every((k) => own.has(k) || NOT_A_PERSON.has(k)) && !ctx.L.toks[m.start].q && (m.keys.length >= 2 || W.isFirstName(m.keys[0]));
  const ofPeople = input.kind === 'word' && (ctx.L.mentions.some(person) ||
    ctx.L.toks.some((t, i) => !ctx.L.names.has(i) && ['report', 'record', 'guilt', 'deny'].includes(T.claimClass(t.k))));
  if (input.kind === 'word' && !ofPeople) return { ok: failures.length === 0, failures, carried: [] };
  // (a word in -s that opens a clause is a verb when a source has that very word right after who does it)
  const verbAt = (i) => ctx.sources.some((src) => src.S.toks.some((x, j) => x.k === ctx.L.toks[i].k && !src.S.names.has(j) && j > 0 && R.readable(src.S, j) && !R.isNominal(src.S, j)));
  const clauses = clausesOf(ctx.L, verbAt);
  const carriers = [];
  const carried = [];
  for (const c of clauses) {
    const said = ctx.L.toks.slice(c.from, c.to + 1).map((t) => t.s).join(' ');
    let able = ctx.sources.filter((src) => !notCarried(ctx, c, src));
    if (!able.length) {
      // (the nearest miss says why: the source that names its people)
      const near = ctx.sources.map((src) => notCarried(ctx, c, src)).find((why) => !/does not name/.test(why)) || 'no sentence names its people together';
      fail(5, `no single source carries "${said}": ${near}`);
      // (a clause refused only for a word of a claim that is another sentence's is still read against the sentence that has the
      // rest of it: who did what, and what was said not to be, are said of it all the same)
      able = ctx.sources.filter((src) => !notCarried(ctx, c, src, { slack: true }));
      if (!able.length) {
        carriers.push([]);
        carried.push(-1);
        continue;
      }
    }
    const sided = able.filter((src) => !sidesDiffer(ctx, c, src));
    if (!sided.length) fail(6, `"${said}": ${sidesDiffer(ctx, c, able[0])}`);
    const kept = (sided.length ? sided : able).filter((src) => !negationDiffers(ctx, c, src));
    if (!kept.length) fail(7, `"${said}": ${negationDiffers(ctx, c, (sided.length ? sided : able)[0])}`);
    carriers.push(kept.length ? kept : sided.length ? sided : able);
    carried.push((kept[0] || sided[0] || able[0]).n);
  }
  if (input.kind !== 'word') for (const c of strays(ctx, clauses, carriers)) fail(5, `"${ctx.L.toks.slice(c.from, c.to + 1).map((t) => t.s).join(' ')}" is another story: nothing ties it to ${input.subject}`);
  const two = input.kind !== 'word' && clauses.length > 1 ? twoAccusers(ctx, clauses) : null;
  if (two) fail(5, `it tells what ${two[0]} and ${two[1]} each say in one line and no one source tells both: two stories, tell one`);
  // (73) a word that joins two clauses says the two belong together: one source must hold both and join them itself. "after" and
  // "before" are held to the order their sources are dated in instead (rule 12); anything else is two stories in one line
  clauses.forEach((c, n) => {
    if (n === 0 || !c.link || ['after', 'following', 'before', 'and', 'as'].includes(c.link)) return;
    if (!carriers[n].length || !carriers[n - 1].length || quotedSpan(ctx.L, c)) return;
    const one = carriers[n].some((src) => carriers[n - 1].includes(src));
    if (!one) fail(5, `"${c.link}" joins what no one source joins: tell them apart, or tell one`);
  });
  const saidBy = (j) => { const who = R.leftOf(ctx.L, j); return !!who && who.kind === 'name' && ctx.sources.some((src) => saysIn(src.S, who.m)); };
  const more = { clauses, carriers, saysWhat, negatedAt, aheadAt, aheadGoverns, rolesIn, saidBy };
  fail(8, RULES.reported(ctx, more));
  // (and never surer than its sources: wanted, tried, possible, rumoured or only asked there, stated here)
  fail(8, RULES.softer(ctx, more));
  fail(9, RULES.denials(ctx, more));
  if (input.kind !== 'word') fail(10, RULES.saysWhatHappened(ctx));
  if (input.kind !== 'word') fail(11, RULES.titleHolds(ctx, more));
  fail(12, RULES.stale(ctx, more));
  return { ok: failures.length === 0, failures, carried };
}

module.exports = { checkLine, clausesOf, prepare, saysWhat, saysIn, negatedAt, aheadAt, aheadGoverns, holdsRun, WORDS_MIN, WORDS_MAX, CHARS_MAX, CARD_WORDS_MAX, CARD_CHARS_MAX };
