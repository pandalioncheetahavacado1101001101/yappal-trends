'use strict';
/*
 * How a card's clauses are worded (ios/IDEAS-FEED.md P3, P7): the text helpers the gate (lib/editor/gate.js) and the why and angles
 * check (lib/editor/ideas.js) share. A line as the card prints it (`printed`), a later clause's small first word (`asLater`), a
 * Title Case headline set in sentence case by the story's own names, "reportedly" set where the check asks for it (`hedged`), the
 * longest clause cut short (`cutLongest`); and `wordingOf`, one dossier's wording tools: which shown sentence a clause is copied
 * from, whether it is an in-order cut of it, that sentence's own rule-built wording, and the line a set of clauses prints as.
 * Pure: no clock, no I/O.
 */
const TL = require('../../engine/talk-lines');
const TN = require('../../engine/talk-nouns');
const W = require('../../engine/wording');
const T = require('../line-text');
const R = require('../line-roles');
const SRC = require('../line-sources');
const COMPOSE = require('../line-compose');
const PROMPT = require('./prompt');
const D = require('./dossier');
const { keyOf } = require('../util');

// a clause is a sentence's own when it holds this share of the clause's words
const SAME_SENTENCE = 0.7;

// what an outlet hangs before a name: a role, and the word that sells it
const LED_BY = '(?:controversial|embattled|disgraced|popular|former|ex|fellow|youtuber|tiktoker|streamer|influencer|rapper|singer|actor|actress|comedian|podcaster|creator|musician|star|twitch|kick|youtube|tiktok)';
/** A line as the card prints it: the card's typography, a full name once, a full stop. */
function printed(text, subject = '') {
  const s = TL.tidyLine(String(text || '').replace(/[‐‑‒]/g, '-').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim());
  const own = String(subject || '').trim();
  let out = s;
  // (a full name said twice is its surname the second time, as the card says it: "Mara Voss ...; Voss denies")
  // (a possessive is the same name: "Tobin Hale ...; Voss denies Tobin Hale’s allegations")
  for (const name of new Set((s.match(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]+\s+\p{Lu}[\p{L}'’-]+(?![\p{L}\p{N}])/gu) || []).map((x) => x.replace(/[’']s?$/, '')))) {
    const [first, last] = name.split(/\s+/);
    // (a name: it opens with a given name, or with a word no dictionary has ("Tobin Hale"), or is the row's own subject. "New York"
    // and "Velvet Comet" are said whole, and the check then refuses a line that says them twice)
    const given = W.isFirstName(first.toLowerCase()) || !W.isDictWord(first.toLowerCase());
    if (!(given || name === own) || (W.isDictWord(last.toLowerCase()) && !given)) continue;
    const at = out.indexOf(name);
    if (at < 0 || out.indexOf(name, at + name.length) < 0) continue;
    // (and the label that led the name goes with it: "...; controversial YouTuber Tobin Hale ..." is "...; Hale ...")
    const later = out.slice(at + name.length).replace(new RegExp(`(?:${LED_BY}\\s+){1,3}(?=${esc(name)})`, 'giu'), '');
    out = out.slice(0, at + name.length) + later.split(name).join(last);
  }
  return out && !/[.!?]['’"”)]?$/.test(out) ? `${out}.` : out;
}

/** A clause that follows another: its first word small when it is a plain word and no name ("Streamer Mara Voss ..." after a semicolon). */
function asLater(text, names = new Set()) {
  const m = String(text || '').match(/^(\p{Lu}\p{Ll}+)(\s+)(.*)$/su);
  if (!m) return text;
  const k = m[1].toLowerCase();
  // (never a word the story's own sentences print as a name: "Hale alleges ...", "House of Kites responds ...")
  return !names.has(k) && W.inDict(k) && !W.isFirstName(k) && !W.isProperWord(k) ? `${k}${m[2]}${m[3]}` : text;
}
/** Whether a clause is set as a headline: most of its words past the first open with a capital. */
function headlineCased(text) {
  const ws = String(text || '').split(/\s+/).filter((w) => /\p{L}/u.test(w)).slice(1);
  if (ws.length < 4) return false;
  return W.isTitleCase(String(text).split(/\s+/)) || ws.filter((w) => /^[‘“"'(]?\p{Lu}/u.test(w)).length / ws.length >= 0.6;
}
/**
 * A headline's clause in sentence case, by the story's own names: a word past the first keeps its capital only when the story's
 * sentences print it as a name, when it is all capitals ("SNL", "NYC") or when no dictionary has it; every other word is small.
 */
function sentenceCased(text, names) {
  return String(text || '').split(/(\s+)/).map((w, i, all) => {
    const m = w.match(/^([^\p{L}\p{N}]*)(\p{Lu}[\p{Ll}'’-]+)([^\p{L}\p{N}]*)$/u);
    if (!m || i === 0) return w;
    const k = m[2].toLowerCase().replace(/[’']s$/, '');
    // (the word after a given name is a surname, whatever a dictionary makes of it: "Tobin Hale")
    if (i >= 2 && /^\p{Lu}\p{Ll}+$/u.test(all[i - 2]) && W.isFirstName(all[i - 2].toLowerCase())) return w;
    return names.has(k.replace(/[^a-z0-9]/g, '')) || W.isFirstName(k) || W.isProperWord(k) || !(W.inDict(k) || W.STOP.has(k)) ? w : `${m[1]}${m[2].toLowerCase()}${m[3]}`;
  }).join('');
}
/** The people some sentences name in full, by surname: Map(surname as written -> full name), where they give one full name for it. */
function fullNames(sentences, names) {
  const seen = new Map();
  // (a headline set in capitals says nothing of which two words are a name)
  for (const s of sentences.filter((x) => !headlineCased(x.text))) for (const m of String(s.text).matchAll(/(?<![\p{L}\p{N}])(\p{Lu}[\p{L}'-]+)\s+(\p{Lu}[\p{L}-]+)(?![\p{L}\p{N}])/gu)) {
    // (a given name and a surname: never the word a sentence opens on, a label with a hyphen, or a name's own middle)
    const given = W.isFirstName(m[1].toLowerCase()) || (m.index > 0 && !m[1].includes('-') && !W.isDictWord(m[1].toLowerCase()));
    if (!given || W.STOP.has(m[2].toLowerCase()) || W.isFirstName(m[2].toLowerCase()) || !names.has(m[1].toLowerCase()) || !names.has(m[2].toLowerCase())) continue;
    const by = seen.get(m[2]) || new Map();
    by.set(`${m[1]} ${m[2]}`, (by.get(`${m[1]} ${m[2]}`) || 0) + 1);
    seen.set(m[2], by);
  }
  const out = new Map();
  for (const [last, by] of seen) if (by.size === 1) out.set(last, [...by.keys()][0]);
  return out;
}
/** The words a dossier's sentences print as names (a capital inside a sentence-case sentence), and its subject's own. */
function namesOf(d) {
  const out = new Set(T.tokensOf(d.subject).map((t) => t.k));
  // (a headline set in capitals, wholly or after a quoted kicker, says nothing of which of its words are names)
  for (const s of d.shown) { const toks = T.tokensOf(s.text); if (T.isTitleCase(toks) || headlineCased(s.text)) continue; for (const i of T.nameIndexes(toks)) out.add(toks[i].k); }
  return out;
}

const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// where a part of a clause begins: after a comma, a semicolon, or a word that joins another clause on
const CLAUSE_BREAK = /[,;:]\s+|\s+(?:after|amid|while|before|following|when|since|because|but|though|although|despite|as)\s+/giu;
/**
 * A part with "reportedly" in it for the word the check says its sentences hedge, set in that word's own clause (the hedge reaches
 * no further), and only straight before a verb that tells what was done: the word itself when it is one ("Voss reportedly
 * withheld ..."), else the verb after the name the clause opens on ("...; Tobin Hale reportedly threatens ...", "Voss and Hale are
 * reportedly ...", and in a headline's short passive the participle: "Juno Pell shows reportedly cancelled ..."), else the
 * clause's own first verb ("... after reportedly canceling ..."); never inside a quotation, which is somebody's own words. A clause
 * with no such verb is not hedged by a word put somewhere ("following reportedly serious security threat", "as reportedly latest
 * results leak" read as another claim): the part is told as reported, ", reports say", as a line is, when it has no one saying it
 * already; else it is as it was, and the check refuses it. Once a clause; a part that has no such word, or whose clause is hedged
 * already, is as it was.
 */
function hedged(text, word) {
  const str = String(text);
  const m = str.match(new RegExp(`(?<![\\p{L}\\p{N}])(${esc(word)})(?![\\p{L}\\p{N}])`, 'iu'));
  if (!m) return text;
  let from = 0;
  for (const b of str.matchAll(CLAUSE_BREAK)) { if (b.index + b[0].length <= m.index) from = b.index + b[0].length; }
  const clause = str.slice(from);
  const at = m.index - from;
  if (/(?<![\p{L}])(?:reportedly|allegedly)(?![\p{L}])/iu.test(clause.slice(0, at)) || REPORTS_SAY.test(str)) return text;
  const put = verbAt(clause, at);
  if (put < 0) return /(?<![\p{L}])(?:says?|said|according)(?![\p{L}])[^;]*$/iu.test(str) ? text : `${str.replace(/[\s.!]+$/u, '')}, reports say`;
  return `${str.slice(0, from + put)}reportedly ${str.slice(from + put)}`;
}
const REPORTS_SAY = /,\s+reports say\.?$/iu;
// (what follows a headline's short passive, "shows cancelled due to ...", "concert canceled after ...": no noun the participle describes)
const AFTER_PASSIVE = new Set('due after amid over following as in at for by to from with until before during because despite since on'.split(' '));
/**
 * Where in a clause "reportedly" goes for the word at `at`: the offset of the verb it stands straight before, or -1 for none (a
 * clause of nouns alone). Never inside a quotation: before it.
 */
function verbAt(clause, at) {
  const words = [...clause.matchAll(/\S+/gu)].map((x) => ({ i: x.index, w: x[0], t: T.tokensOf(x[0])[0] || null }));
  const tells = (x) => !!x && !!x.t && /^[‘“"'(]?\p{Ll}/u.test(x.w) && (R.verbShaped(x.t) || W.looksVerb(x.t.k)) && !T.STOP.has(x.t.k);
  const participle = (x) => !!x && !!x.t && /^\p{Ll}/u.test(x.w) && (/(?:ed|en)$/.test(x.t.k) || T.PAST_FORMS.has(x.t.k));
  // (an -ed word before a noun describes it, "leaked texts"; before a small word, or at the end, it tells: "shows cancelled due to")
  const describes = (k) => participle(words[k]) && !!words[k + 1] && !!words[k + 1].t && T.isContent(words[k + 1].t) && !AFTER_PASSIVE.has(words[k + 1].t.k) && !T.CONNECTIVE.has(words[k + 1].t.k);
  const quoted = (pos) => { const before = clause.slice(0, pos); const open = Math.max(before.lastIndexOf('‘'), before.lastIndexOf('“')); return open >= 0 && !/[’”]/.test(before.slice(open)) ? open : pos; };
  const self = words.findIndex((x) => x.i <= at && at < x.i + x.w.length);
  // (the word itself, when it says what was done)
  if (self >= 0 && words[self].t && (R.verbShaped(words[self].t) || /ing$/.test(words[self].t.k)) && !describes(self)) return quoted(words[self].i);
  // (the name, or the names, the clause opens on, and the helping verb after them: "Voss and Hale are reportedly ‘wildly unhappy’")
  const lead = clause.match(/^(?:[\p{Ll}-]+\s+){0,2}(?:\p{Lu}[\p{L}\p{N}'’.-]*\s+){1,4}(?:and\s+(?:\p{Lu}[\p{L}\p{N}'’.-]*\s+){1,4})?(?:(?:is|are|was|were|has|have|had)\s+)?(?=[\p{Ll}‘“"'])/u);
  if (lead && lead[0].length <= at) {
    if (/(?:is|are|was|were|has|have|had)\s+$/u.test(lead[0])) return quoted(lead[0].length);
    const k = words.findIndex((x) => x.i >= lead[0].length);
    // (a headline's short passive: a noun, then its participle and no noun after it, "shows cancelled due to", "concert canceled")
    if (k >= 0 && participle(words[k + 1]) && !describes(k + 1) && !(words[k].t && T.claimClass(words[k].t.k))) return quoted(words[k + 1].i);
    // (straight after the name, a word in -ed tells, as the check reads it: "Voss leaked texts", "Voss called Hale ...")
    if (k >= 0 && tells(words[k])) return quoted(words[k].i);
    return -1;
  }
  // (else the clause's own first verb before the word: "after reportedly canceling the show")
  for (let k = 0; k < words.length && words[k].i <= at; k++) if (words[k].t && /^[‘“"'(]?\p{Ll}/u.test(words[k].w) && R.verbShaped(words[k].t) && !describes(k)) return quoted(words[k].i);
  return -1;
}
const CUT_AT = /,\s+|\s+(?:as|after|amid|while|following|because|despite)\s+|\s+[—–-]\s+|:\s+/giu;
const CUT_WORDS_MIN = 5;
const CUTS_MAX = 4;
const FIT_WORDS = 35;
const FIT_CHARS = 196;
/** The parts with the longest one cut at its last clause break, when five words or more are left of it; or null. */
function cutLongest(parts) {
  const order = parts.map((p, i) => ({ i, n: p.text.split(/\s+/).length })).sort((x, y) => y.n - x.n);
  for (const { i } of order) {
    const text = parts[i].text;
    const breaks = [...text.matchAll(CUT_AT)].map((m) => m.index).filter((at) => text.slice(0, at).trim().split(/\s+/).length >= CUT_WORDS_MIN);
    if (!breaks.length) continue;
    const kept = text.slice(0, breaks[breaks.length - 1]).trim();
    // (a quote left open by the cut is no clause)
    if ((kept.match(/[‘“]/g) || []).length !== (kept.match(/[’”]/g) || []).length - (kept.match(/\p{L}’\p{L}/gu) || []).length && /[‘“][^’”]*$/.test(kept)) continue;
    return parts.map((p, k) => (k === i ? { ...p, text: kept } : p));
  }
  return null;
}

/**
 * One dossier's wording tools (what the gate words a card's parts with, and the why and the angles their clauses): { names (the words
 * its sentences print as names), valid(n) (a shown sentence's number, or null), sourceText(n) (that sentence's own rule-built
 * wording, G4, in sentence case), cased(text, own) (a clause copied in Title Case, set as its sentence is), fromOf(part) (the number
 * of the shown sentence that holds the part's words, whatever number the model gave), isCut(text, n) (the clause is that sentence's
 * words in their order, nothing swapped in), print(parts) (the line the parts print as) }.
 */
function wordingOf(d, lex = null) {
  const inputs = D.inputsOf(d);
  const names = namesOf(d);
  const valid = (n) => (Number.isInteger(n) && n >= 1 && n <= d.shown.length ? n : null);
  const options = d.kind === 'word' ? [] : COMPOSE.optionsOf(inputs, lex);
  // (a sentence's own wording: the rule-built line of that one sentence, G4, its leftover headline capitals set small by the story's names)
  const sourceText = (n) => { const o = valid(n) ? options.find((x) => x.s === d.shown[n - 1]) : null; const own = o ? o.line.replace(/[.]$/, '') : null; return own && headlineCased(own) ? sentenceCased(own, names) : own; };
  // (a part copied in a headline's Title Case is set in sentence case as its own sentence is: the rule-built wording of that sentence,
  // or the engine's own recasing of the part)
  const cased = (text, own) => (headlineCased(text) ? own || sentenceCased(TN.sentenceLine(text, lex || null), names) : text);
  // (the sentence a part is copied from is the one that holds its words, whatever number the model gave: a part whose words are
  // another sentence's is that sentence's, and the same clause twice is one part)
  const stems = d.shown.map((x) => D.stemsOf(x.text));
  const fromOf = (p) => {
    const mine = D.stemsOf(p.text);
    const share = (n) => (valid(n) && mine.size ? [...mine].filter((st) => stems[n - 1].has(st)).length / mine.size : 0);
    const best = d.shown.map((_, i) => i + 1).sort((x, y) => share(y) - share(x))[0];
    return share(p.s) >= SAME_SENTENCE || !best || share(best) < SAME_SENTENCE ? valid(p.s) : best;
  };
  // (cut: the part is a CUT of its sentence, its words in its order with nothing swapped in. A part the model reworded stands only
  // as the model wrote it, when the whole card passes so: it is never hedged or trimmed further, its sentence's own words are)
  const isCut = (text, n) => {
    // (a word's line says what a thing is, of nobody: it is held to its page's words by the claim check, as written)
    if (d.kind === 'word') return true;
    if (!valid(n)) return false;
    const src = T.tokensOf(d.shown[n - 1].text).map((t) => t.k);
    let at = 0;
    for (const t of T.tokensOf(text)) { if (!T.isContent(t) && !t.num) continue; const found = src.indexOf(t.k, at); if (found < 0) return false; at = found + 1; }
    return true;
  };
  // (a label a clause opens on, said already before the same name in an earlier clause, is said once: "ex-editor Tobin Hale ...;
  // ex-editor Hale alleges ..." is "...; Hale alleges ...")
  const unlabelled = (text, before) => {
    const ws = String(text).split(/\s+/);
    const at = ws.findIndex((w) => /^\p{Lu}/u.test(w) && names.has(T.tokensOf(w).map((t) => t.k)[0]));
    if (at <= 0 || at > 3) return text;
    const label = keyOf(ws.slice(0, at).join(' '));
    return label && ` ${keyOf(before)} `.includes(` ${label} `) ? ws.slice(at).join(' ') : text;
  };
  // (cased as its sources case it: a word they write small is small, a name they print keeps its capital; and a person is given
  // in full the first time: a model told to say a surname the second time says it the first time too)
  const ownName = String(d.subject || '').trim().split(/\s+/);
  const inFull = (line, rests) => { let out = line; for (const [last, full] of [...(d.person && ownName.length === 2 ? [[ownName[1], d.subject]] : []), ...fullNames(rests, names)]) { if (out.includes(full)) continue; const m = out.match(new RegExp(`(?<![\\p{L}\\p{N}’'-])${esc(last)}(?![\\p{L}\\p{N}-])`, 'u')); if (m) out = `${out.slice(0, m.index)}${full}${out.slice(m.index + last.length)}`; } return out; };
  const print = (ps) => {
    const texts = ps.map((p) => p.text);
    const line = PROMPT.lineOf(texts.map((text, i) => ({ text: i ? asLater(unlabelled(text, texts.slice(0, i).join(' ')), names) : text })));
    // (a word's line says what the thing is, not its name and "is": "Sleepy Otter refers to a clip of ..." is "A clip of ...")
    if (d.kind === 'word') return printed(line.replace(new RegExp(`^(?:the\\s+)?${String(d.subject).trim().split(/\s+/).map(esc).join('\\s+')}(?:\\s+(?:meme|trend|sound|challenge))?\\s+(?:is|are|was|refers to|describes)\\s+(an?|the)\\s+`, 'i'), (m, article) => `${article.charAt(0).toUpperCase()}${article.slice(1).toLowerCase()} `));
    const plain = d.shown.filter((x) => !headlineCased(x.text));
    const rests = ps.map((p) => (p.s ? d.shown[p.s - 1] : null)).filter(Boolean);
    return SRC.namesRecased(SRC.recaseSmall(printed(inFull(line, rests), d.subject), plain), plain, (d.spelt || []).filter((x) => !headlineCased(x.text)));
  };
  return { inputs, names, valid, options, sourceText, cased, fromOf, isCut, print };
}

module.exports = { wordingOf, printed, asLater, headlineCased, sentenceCased, fullNames, namesOf, esc, hedged, cutLongest, LED_BY, FIT_WORDS, FIT_CHARS, CUTS_MAX, SAME_SENTENCE };
