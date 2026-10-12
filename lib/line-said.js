'use strict';
/*
 * Who says so, and which claim a reply answers (ios/IDEAS-FEED.md G3 rules 8 and 9, R2, R4): the readers the claim check's
 * rules lean on for attribution.
 *   saidTail       where a sentence ends in who says so and nothing else ("..., UK prosecutors claim", "...: Journalist")
 *   attributedAt   whether a source gives a word as someone's account: before such a tail, or after a saying word
 *   repliesAstray  a reply set after another claim than the one its sentence answers
 * Pure: no clock, no I/O.
 */
const T = require('./line-text');
const R = require('./line-roles');
const RP = require('./line-replies');

const SAYING = new Set(['says', 'said', 'say', 'tells', 'told']);
const TAIL_SAYS = /^(?:says?|said|alleges?|alleged|claims?|claimed|reports?|reported|tells?|told)$/;
const TAIL_MAX = 6;
// who a headline gives as its source with no verb at all, set off at its end: "...: Journalist", "...: report", "... - sources"
const BARE_SAYER = /^(?:reports?|sources?|journalists?|reporters?|insiders?|police|cops|prosecutors?|officials?|authorities|lawyers?|attorneys?|docs|documents|filings?|lawsuit|complaint|affidavit|witness(?:es)?|friends?|pals?|experts?|biographers?)$/;
const TAIL_SMALL = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'to', 'of', 'for']);
// who may not stand in a sayer's place: a clause of its own follows the saying word ("..., says he's sorry" is no attribution)
const NOT_A_SAYER = new Set(['he', 'she', 'they', 'it', 'i', 'we', 'you', 'that', 'there', 'this', 'is', 'are', 'was', 'were', 'will', 'would', 'has', 'have', 'had', 'not', 'no']);
/**
 * Where a part of a sentence ends in who says so and nothing else, between token indexes `from` and `to`: the index its tail
 * begins at, or -1. The tail is set off by a comma, a colon or a dash, is six words at most, and is
 *   a sayer and the saying word     "..., UK prosecutors claim", "..., police say", "..., lawsuit says", "..., UK alleges"
 *   the saying word and a sayer     "..., claims friend", "..., says Lisbon police", "..., according to court documents"
 *   a sayer alone                   "...: Journalist", "...: report", "... - sources"
 * A tail that tells something more is no attribution: "..., sparking backlash and a police report", "..., says he's sorry".
 */
function saidTail(S, from = 0, to = S.toks.length - 1) {
  const { toks } = S;
  for (let j = Math.max(from + 1, to - TAIL_MAX + 1); j <= to; j++) {
    const set = toks[j - 1];
    if (!T.commaAfter(set) && !T.breaksAfter(set)) continue;
    const tail = toks.slice(j, to + 1);
    // (a quotation is somebody's words, never who says so; and the tail is the sentence's last part, whole)
    if (tail.some((t) => t.q) || tail.some((t, n) => n < tail.length - 1 && (T.commaAfter(t) || T.breaksAfter(t)))) continue;
    const says = (n) => TAIL_SAYS.test(tail[n].k) && !S.names.has(j + n);
    // (who: a name, a role, "reports", "sources"; never a word that says something more, a helping verb or a pronoun)
    const sayer = (n) => S.names.has(j + n) || BARE_SAYER.test(tail[n].k) || TAIL_SMALL.has(tail[n].k) || (!R.verbShaped(tail[n]) && !T.AUX.has(tail[n].k) && !NOT_A_SAYER.has(tail[n].k) && !tail[n].num && T.isContent(tail[n]));
    const others = (at) => tail.every((_, n) => n === at || sayer(n)) && tail.some((t, n) => n !== at && !TAIL_SMALL.has(t.k));
    if (tail.length >= 2 && says(tail.length - 1) && others(tail.length - 1)) return j;
    if (tail.length >= 2 && says(0) && others(0)) return j;
    if (tail.length >= 3 && tail[0].k === 'according' && tail[1].k === 'to' && tail.slice(2).every((_, n) => sayer(n + 2))) return j;
    // (a sayer alone: after a colon or a dash; "reports" and "sources" after a comma too)
    const last = tail[tail.length - 1];
    if (tail.length <= 3 && BARE_SAYER.test(last.k) && !S.names.has(to) && tail.every((_, n) => sayer(n)) && (T.breaksAfter(set) || /^(?:reports?|sources?)$/.test(last.k))) return j;
  }
  return -1;
}
const TAILS = new WeakMap();
/** The same for a whole source sentence, kept: where its who-says-so tail begins, or -1. */
function tailOf(S) {
  if (!TAILS.has(S)) TAILS.set(S, saidTail(S));
  return TAILS.get(S);
}
const SAID_NEAR = 6;
/**
 * Whether a source gives its word at `j` as someone's account: the word stands before the sentence's who-says-so tail
 * ("..., UK prosecutors claim", "...: Journalist"), or after a saying word in its own part ("Accuser says she was forced ...").
 * Such a sentence states nothing itself: a line that takes its words keeps who says so, or hedges them.
 */
function attributedAt(S, j) {
  if (tailOf(S) > j) return true;
  for (let k = j - 1, seen = 0; k >= 0 && seen < SAID_NEAR; k--) {
    const t = S.toks[k];
    if (T.breaksAfter(t) || T.commaAfter(t) || T.CONNECTIVE.has(t.k) || t.q !== S.toks[j].q) return false;
    if (S.names.has(k)) continue;
    if (SAYING.has(t.k)) return true;
    if (T.isContent(t)) seen += 1;
  }
  return false;
}
// what a reply is made with, what a claim is called, and what any story's sentence may hold: none of them says WHICH claim
const REPLY_WORD = /^(?:den(?:y|ies|ied|ial|ials|ying)|refut\w+|disput\w+|rebut\w*|reject\w*|dismiss\w*|respond\w*|response|repl(?:y|ies|ied)|address\w*|react\w*|answer\w*|calls?|called|bs|bull\w*|cap|push\w*|back|hits?|fires?|claps?|shuts?|down|laughs?|brush\w*|shrugs?|off|slams?|blasts?|silence|breaks?|broke|speaks?|spoke|out|comments?|statements?|says?|said|insists?|maintains?|false|untrue|baseless|fabricated|lies?|liar|wild|shocking|explosive|bombshell)$/;
const ANY_STORY = new Set(['new', 'latest', 'fresh', 'stream', 'livestream', 'video', 'interview', 'post', 'podcast', 'show', 'today', 'live', 'first', 'time', 'again', 'publicly', 'fans', 'viral', 'online',
  'social', 'media', 'twitter', 'instagram', 'tiktok', 'youtube', 'twitch', 'kick', 'amid', 'drama', 'controversy', 'backlash', 'made', 'make', 'against', 'him', 'her', 'them', 'serious', 'recent']);
/** The parts of a line as its semicolons cut them: [{ from, to }] (token indexes). */
function partsOf(L) {
  const out = [];
  let from = 0;
  L.toks.forEach((t, i) => { if (t.post.includes(';') || i === L.toks.length - 1) { out.push({ from, to: i }); from = i + 1; } });
  return out;
}
/**
 * A reply set after another claim than the one it answers (reviewers, 2026-10-12: a man's answer to one accusation, cut to
 * "calls BS on the claim" or "denies it", passed after a second accusation he never spoke to). A part of the line that only says
 * someone denies or disputes "it", "the claim" or "the allegations" is read as the answer to the part before it: the sentence that
 * carries it must be about that part's claim, sharing with it whoever makes the claim or a word of what is claimed. A sentence
 * that says no more itself ("<name> denies the allegations") answers whatever stands before it; a reply that keeps what it is
 * about ("denies rape allegation during Vancouver concert") says so itself, and is read by the other rules alone.
 */
function repliesAstray(ctx, more, { CLAIM_NOUN, RUMOUR_NOUN }) {
  const { L } = ctx;
  const parts = partsOf(L);
  const out = [];
  const own = new Set(ctx.subjectKeys);
  const specific = (S, i) => { const t = S.toks[i]; return T.isContent(t) && !T.FREE.has(t.k) && !t.num && !t.unit && !own.has(t.k) && !REPLY_WORD.test(t.k) && !CLAIM_NOUN.test(t.k) && !RUMOUR_NOUN.test(t.k) && !T.REPORT.test(t.k) && !ANY_STORY.has(t.k) && t.k.length > 2; };
  const wordOf = (S, i) => (S.names.has(i) ? S.toks[i].k : S.toks[i].st);
  for (let n = 1; n < parts.length; n++) {
    const p = parts[n];
    const idx = []; for (let i = p.from; i <= p.to; i++) idx.push(i);
    const text = idx.map((i) => L.toks[i].s).join(' ');
    const denies = idx.find((i) => !L.names.has(i) && (T.DENIES.test(L.toks[i].k) || T.DENY.test(L.toks[i].k)));
    const reply = denies !== undefined || (() => { const r = RP.replyOf(text, ctx.input.subject || ''); return !!r && r.kind !== 'answer'; })();
    // (bare: it says nothing of its own about what is denied)
    if (!reply || idx.some((i) => specific(L, i))) continue;
    const at = more.clauses.findIndex((c) => c.from >= p.from && c.to <= p.to);
    const carriers = at >= 0 ? (more.carriers[at] || []) : [];
    if (!carriers.length) continue;
    const prev = parts[n - 1];
    const before = new Set(); for (let i = prev.from; i <= prev.to; i++) if (T.isContent(L.toks[i])) before.add(wordOf(L, i));
    // (and what the sentences that carry that part say: a clause cut from a longer sentence is still that sentence's claim)
    more.clauses.forEach((c, k) => { if (c.from < prev.from || c.to > prev.to) return; for (const src of more.carriers[k] || []) src.S.toks.forEach((_, j) => { if (specific(src.S, j)) before.add(wordOf(src.S, j)); }); });
    const said = (src) => src.S.toks.map((_, j) => j).filter((j) => specific(src.S, j)).map((j) => wordOf(src.S, j));
    const fits = carriers.some((src) => { const words = said(src); return !words.length || words.some((w) => before.has(w)); });
    if (!fits) { const src = carriers[0]; out.push(`the reply "${text}" is set after another claim than the one it answers: S${src.n + 1} is about "${said(src).slice(0, 3).join(' ')}"`); }
  }
  return out;
}

module.exports = { saidTail, tailOf, attributedAt, partsOf, repliesAstray, SAYING, TAIL_SAYS, TAIL_MAX };
