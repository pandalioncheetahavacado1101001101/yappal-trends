'use strict';
/*
 * What a line is written from (ios/IDEAS-FEED.md G1) and what it falls back to (G4): a row's own source sentences, each with its
 * type; the hash that says whether the same sources were sent before; and the headline path, which picks the source sentence that
 * says who did what when the engine's own line does not. Pure: no clock, no I/O.
 */
const TN = require('../engine/talk-nouns');
const TL = require('../engine/talk-lines');
const W = require('../engine/wording');
const T = require('./line-text');
const R = require('./line-roles');
const RP = require('./line-replies');
const { checkLine, prepare } = require('./lines');
const { sha256, hash32, keyOf } = require('./util');

const SOURCES_MAX = 12;
const SOURCE_CHARS = 300;
const SOURCE_WORDS_MIN = 4;
const HEADS_KEPT = 60;
const NEW_HEADLINES = 3;
const TYPE_OF_KIND = { outlet: 'outlet', beat: 'outlet', post: 'post', social: 'post', upload: 'video', clip: 'video' };
const TYPE_OF_FAM = { reddit: 'post', bluesky: 'post', hn: 'post', youtube: 'video', twitch: 'video', kick: 'video' };
const JUNK = /%%|\.\.\.$|…$|^\W*$/;
const NOUN_NEAR = 5;
const TURN_BONUS = 3;
// a line cut where it should go on: "... of her posed vs."
const DANGLES = /(?<![\p{L}\p{N}])(?:vs|the|a|an|of|for|to|in|on|at|with|and|or|by|from|as|after|over|about|into|her|his|their|its)\.$/iu;
const LINE_CHARS_MAX = 200;

// a word a headline shouts before it starts: capitals, a dictionary word, and the sentence goes on in ordinary case after it
const SHOUT_LEAD = /^(\p{Lu}{4,})[:!]?\s+(?=\S*\p{Ll})/u;
/** A sentence without the word shouted ahead of it ("BANNED YouTuber Wynory Pymith ..." is "YouTuber Wynory Pymith ..."); an acronym stays ("SNL host ..."). */
function dropShout(text) {
  const s = String(text || '');
  const m = s.match(SHOUT_LEAD);
  if (!m || !W.inDict(m[1].toLowerCase())) return s;
  const rest = s.slice(m[0].length);
  return rest.split(/\s+/).length >= SOURCE_WORDS_MIN ? rest.charAt(0).toUpperCase() + rest.slice(1) : s;
}
// a list or a round-up is about its list, never about the one name in it: "SNL hosts who dropped F-bomb on air as ...", "7 times ...",
// "... and more"
const LIST_LEAD = /^(?:\d+|every|all the|the (?:\d+|best|worst|most|biggest|funniest|wildest))\b|^(?:\S+\s+){1,3}who\s+(?:\S+ed|have|has|were|are)\b|\b(?:and|&|,) more\.?$|\bround-?up\b|\bfrom\s+\S+(?:\s+\S+){0,3}\s+to\s+\S+(?:\s+\S+){0,3}:/i;
/** Whether a sentence is a list or round-up, or names the subject only in an "as ..." aside after telling something else. */
function aboutSomethingElse(text, subjectKey) {
  const s = String(text || '');
  if (LIST_LEAD.test(s)) return true;
  const last = subjectKey.split(' ').slice(-1)[0];
  if (!last) return false;
  const ws = W.words(s);
  const at = ws.indexOf(last);
  const as = ws.indexOf('as');
  // (the name comes only after an "as" past the opening: what leads the sentence is someone or something else)
  return at > 0 && as >= 3 && as < at && at - as <= 3;
}
/** A content word a line says twice in two forms a headline writer doubled for effect ("BANNED ... banned"). */
function saysTwice(text, subjectKey) {
  const subject = new Set(subjectKey.split(' '));
  const seen = new Set();
  for (const w of W.words(String(text || ''))) {
    if (w.length < 5 || subject.has(w) || W.STOP.has(w)) continue;
    const st = W.stem(w);
    if (seen.has(st)) return true;
    seen.add(st);
  }
  return false;
}
const SEMI_WORDS_MIN = 8;
const SEMI_CHARS = 120;
/** A long headline of two halves told by its first: "...; faces severe backlash" goes when what stands before the semicolon is a sentence. */
function firstHalf(line) {
  const s = String(line || '');
  const at = s.indexOf('; ');
  if (s.length <= SEMI_CHARS || at < 0) return s;
  const head = s.slice(0, at).trim();
  return head.split(/\s+/).length >= SEMI_WORDS_MIN ? `${head.replace(/[.,:]+$/, '')}.` : s;
}

// a profile's headline says who someone is, never what happened: "Orria Neskley, the controversial streamer seducing America's radical left."
// (nor does a feature's: "Inside Orria Neskley's radical views on America, Israel and socialism.")
const PROFILE = /^[^,;:]{3,40},\s+(?:the|an?)\s+[^,;:]+\.?$|^(?:inside|meet|behind|a look at|the rise of|the story of|the making of|portrait of)\b/i;
/** Whether a line says who someone is, or opens a feature about them, and not what happened. */
const saysNoEvent = (line) => PROFILE.test(String(line || ''));
// a page title, not a sentence: a tag in square brackets ("... shows nudity [2026]", "[VIDEO]")
const PAGE_TAG = /\[[^\]]{1,24}\]/;
/**
 * A quote a Title Case headline left half recased ("says ‘life Has Opened up’"): once its first word is written small, the
 * dictionary words still capitalised inside it are small too. Names keep their capitals, and so does a work's name.
 */
function quoteCase(line) {
  return String(line || '').replace(/([‘“])([^’”]{6,120})([’”])/g, (m, open, inner, close) => {
    const ws = inner.split(' ');
    // (a quote left with a capital on its first word alone, "‘Tremendous blow’", is no work's name: a name keeps a capital on every main word)
    const small = (w) => /^\p{Ll}/u.test(w);
    if (ws.length >= 2 && /^\p{Lu}\p{Ll}+$/u.test(ws[0]) && ws.slice(1).every(small) && W.inDict(ws[0].toLowerCase()) && !W.isProperWord(ws[0].toLowerCase()) && !W.isFirstName(ws[0].toLowerCase())) return open + [ws[0].toLowerCase(), ...ws.slice(1)].join(' ') + close;
    // (only a quote whose first word is already small: a work's name starts with a capital and keeps every one of them)
    if (ws.length < 3 || !/^\p{Ll}/u.test(ws[0])) return m;
    return open + ws.map((w, i) => (/^\p{Lu}\p{Ll}+$/u.test(w) && (W.inDict(w.toLowerCase()) || W.STOP.has(w.toLowerCase())) && !W.isProperWord(w.toLowerCase()) && !W.isFirstName(w.toLowerCase()) && !(i > 0 && /[.!?]$/.test(ws[i - 1])) ? w.toLowerCase() : w)).join(' ') + close;
  });
}

/** A headline as a source sentence: the outlet's own tail and shout cut (the engine's cleanHeadline), 300 characters at most. */
function sentence(title, outlet) {
  const s = dropShout(TN.cleanHeadline(String(title || ''), outlet || '').replace(/\s+/g, ' ').trim());
  return s.length <= SOURCE_CHARS ? s : s.slice(0, s.lastIndexOf(' ', SOURCE_CHARS)).trim();
}

/**
 * How much a sentence says of who did what, for choosing among a story's own: it names the subject (early), says the card's noun,
 * has a verb and someone or something else named, and is no question, explainer, teaser or bare reaction.
 */
function informative(text, { subjectKey = '', family = null, outlet = null } = {}) {
  const ws = W.words(text);
  const last = subjectKey.split(' ').slice(-1)[0];
  const S = R.sentenceOf(text, new Set(subjectKey.split(' ').filter(Boolean)));
  let s = 0;
  if (last && ws.includes(last)) s += 3;
  if (last && ws.slice(0, 6).includes(last)) s += 1;
  if (family && TN.says(text, family)) s += 2;
  // (the subject doing the card's noun, said plainly by a wire or a national outlet, with no slogan or soundbite quoted in it)
  const said = family ? TN.familiesIn(text).find((x) => x.f.key === family.key) : null;
  if (said && last && ws.slice(Math.max(0, said.at - NOUN_NEAR), said.at).includes(last)) s += 1;
  if (outlet && TN.MAJOR.test(outlet)) s += 1;
  if (R.quotesOf(S).some((q) => q.keys.length >= 3)) s -= 1;
  if (TN.onlyReaction(text, subjectKey)) s -= 3;
  if (aboutSomethingElse(text, subjectKey)) s -= 4;
  if (/\?/.test(text) || TN.QUESTION.test(text) || TN.EXPLAINED.test(text)) s -= 3;
  if (ws.length < 7) s -= 2;
  if (ws.length > 24) s -= 1;
  s += Math.min(2, S.toks.filter((t, i) => R.readable(S, i) && !R.isNominal(S, i)).length);
  if (S.mentions.some((m) => !m.keys.includes(last))) s += 1;
  if (S.toks.some((t) => t.num)) s += 0.5;
  if (!S.title) s += 1;
  return s;
}

/**
 * A row's inputs for the writer and the check (G1), or null for a row with nothing to write from:
 * { id, kind ('talk' | 'word'), title, subject, family, denied, admitted, headline (the engine's line), sources: [{ text, type, outlet, t }] }.
 * A story's sentences: the headlines its line rests on first (the engine's trace), then its newest outlets' (a line must be able to
 * tell where the story stands today), then its own and what else the name's coverage has said since it began (`meta.around`: the
 * headline that tells a story best often never says its noun), the most telling first; never a cut or empty title, twelve at most.
 * An outlet the engine lets word no line (the sites that write up every streamer's week) is given as a "post": its words can be
 * used, and it proves nothing (rule 8). A word's, a meme's or a format's sentences: what its page says of it, sentence by
 * sentence, and the headlines that name it.
 */
function inputsOf(row) {
  // (a row lib/native-desk.js made is told by its signals, as reported, and by nothing else: no model and no headline rewrites it. L10)
  if (!row || row.native) return null;
  if (row.wordish || row.type === 'word') return wordInputs(row);
  const meta = row.meta || {};
  const subject = row.surface || row.subject || '';
  const subjectKey = keyOf(row.subject || subject);
  const family = row.type === 'point' ? TN.FAMILY.get(row.family) || null : null;
  const typeOf = (r) => (r.blocked ? 'post' : TYPE_OF_KIND[r.k] || TYPE_OF_FAM[r.fam] || 'outlet');
  const traced = new Set((meta.sources || []).map((x) => keyOf(x.text)));
  const sentences = (rows, own) => rows.filter((r) => r && r.title).map((r) => ({ text: sentence(r.title, r.outlet), type: typeOf(r), outlet: r.outlet || null, t: r.t || 0, traced: own && !r.blocked && traced.has(keyOf(r.title)), own }))
    .filter((x) => !JUNK.test(x.text) && x.text.split(/\s+/).length >= SOURCE_WORDS_MIN);
  // (what else the name's coverage says is read only where the story's own rows are few: beside a dozen of its own, the name's
  // other news of the week is another story, and a line was written about a costume under "allegations")
  const ownAll = sentences(meta.own || [], true);
  const all = [...ownAll, ...sentences(meta.around || [], false).slice(0, Math.max(AROUND_MIN, AROUND_UNDER - ownAll.length))];
  const seen = new Set();
  const unique = all.filter((x) => { const k = keyOf(x.text); if (seen.has(k)) return false; seen.add(k); return true; });
  // (a sentence in which someone apologises, takes a claim back, denies or admits is how a story turned: the check must see it,
  // or a line could tell the claim as if nothing had followed. Rules 9 and 12)
  const turns = (x) => x.type === 'outlet' && T.tokensOf(x.text).some((t) => T.RETRACT.test(t.k) || T.DENY.test(t.k) || T.ADMIT.test(t.k));
  const score = new Map(unique.map((x) => [x, informative(x.text, { subjectKey, family, outlet: x.outlet }) + (x.type === 'outlet' ? 1 : 0) + (x.own ? 1 : 0) + (turns(x) ? TURN_BONUS : 0)]));
  // (where the story stands today: its newest outlet sentences that name the subject are always among them)
  const last = subjectKey.split(' ').slice(-1)[0];
  const newest = new Set(unique.filter((x) => x.type === 'outlet' && (!last || W.words(x.text).includes(last)) && !/\?/.test(x.text)).sort((a, b) => b.t - a.t).slice(0, NEWEST_KEPT));
  // (and the sentences in which the subject, or the subject's side, denies, disputes or answers a claim: a line that tells an
  // accusation carries the reply its sources hold, and the check can only carry what it is shown. The newest two. N)
  const replies = new Set(unique.filter((x) => x.type === 'outlet' && !/\?/.test(x.text) && RP.replyOf(x.text, subject)).sort((a, b) => b.t - a.t).slice(0, REPLIES_KEPT));
  const picked = [...unique].sort((a, b) => Number(b.traced) - Number(a.traced) || Number(replies.has(b)) - Number(replies.has(a)) || Number(newest.has(b)) - Number(newest.has(a)) || score.get(b) - score.get(a) || b.t - a.t).slice(0, SOURCES_MAX)
    // (shown oldest first: the order they were published in is part of what they say)
    .sort((a, b) => a.t - b.t).map(({ traced: _, own: __, ...x }) => x);
  if (!picked.length || !subject) return null;
  // (person: the engine reads the subject as a person. A firing, a ban or a suspension under a person's name is that person's or nobody's)
  // (spelt: every sentence the row has, the twelve and the rest: how a name is written is read from all of them, and which outlets
  // carry a timeline entry is counted over them. lib/line-compose.js)
  const spelt = unique.filter((x) => !picked.some((p) => p.text === x.text)).slice(0, SPELT_MAX).map((x) => ({ text: x.text, type: x.type, outlet: x.outlet, t: x.t }));
  return { id: row.id || null, kind: 'talk', title: row.title, subject, family: family ? family.key : null, noun: row.noun || null, denied: !!meta.denied, admitted: !!meta.admitted, headline: row.line || null, sources: picked, spelt,
    person: !!meta.person && !['game', 'show', 'film', 'work'].includes((row.point && row.point.kind) || '') };
}
const NEWEST_KEPT = 4;
const REPLIES_KEPT = 2;
const SPELT_MAX = 60;
const AROUND_UNDER = 8;
const AROUND_MIN = 2;
const WORD_SOURCES_MAX = 8;
const WORD_NAME_TAIL = /\s+(?:trend|meme|challenge|craze|sound|audio|dance|filter)s?$/i;
/** A text as sentences: cut at a full stop, a question mark or an exclamation mark that ends one. */
const sentencesOf = (text) => (String(text || '').match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
/**
 * A word's, a meme's, a sound's or a format's inputs: what its page says of it (the month's formats page, a meme page, a
 * dictionary), sentence by sentence, as "page" sentences, and the headlines that name it. Its subject is its own name.
 */
function wordInputs(row) {
  const meta = row.meta || {};
  const word = row.word || {};
  const point = row.point || {};
  const term = String(word.term || point.subject || row.subject || row.title || '').replace(WORD_NAME_TAIL, '').trim();
  if (!term) return null;
  const from = word.meaningFrom || (meta.listedBy === 'crazes' ? 'NewEngen' : null) || ((point.sources || word.sources || [])[0] || null);
  const page = [...sentencesOf(meta.about), ...sentencesOf(word.meaning), ...(meta.about || word.meaning ? [] : sentencesOf(row.line))]
    .map((text) => ({ text: text.length <= SOURCE_CHARS ? text : text.slice(0, text.lastIndexOf(' ', SOURCE_CHARS)).trim(), type: 'page', outlet: from, t: Number.isFinite(meta.pageT) ? meta.pageT : 0 }));
  const heads = (meta.own || []).filter((r) => r && r.title && !/know your meme|wikipedia/i.test(r.outlet || '')).map((r) => ({ text: sentence(r.title, r.outlet), type: 'outlet', outlet: r.outlet || null, t: r.t || 0 }))
    .filter((x) => !JUNK.test(x.text) && x.text.split(/\s+/).length >= SOURCE_WORDS_MIN).sort((a, b) => b.t - a.t).slice(0, 3);
  const seen = new Set();
  const sources = [...page.filter((x) => x.text.split(/\s+/).length >= SOURCE_WORDS_MIN), ...heads].filter((x) => { const k = keyOf(x.text); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, WORD_SOURCES_MAX);
  if (!sources.length) return null;
  return { id: row.id || null, kind: 'word', title: row.title, subject: term, family: null, denied: false, admitted: false, headline: row.line || null, sources };
}

/** sha256 of what was sent: the title, the two flags and the sorted source sentences (G5). */
/** The writer's version: what is asked of the model and what it is given. What an earlier one could not write is asked for again (lib/line-writer.js `decide`). */
const WRITER_VERSION = 5;
// (the version is part of what was sent: a refusal an earlier writer got for these very sentences is no answer to what is asked now)
const sourceHash = (inputs) => sha256([`v${WRITER_VERSION}`, inputs.title, inputs.denied ? 1 : 0, inputs.admitted ? 1 : 0, ...inputs.sources.map((s) => s.text).sort()].join('\n')).toString('hex');

/** What a rewrite is decided on (G5): the title, the noun, the flags, the chapter, and the story's own headlines as short hashes. */
function basisOf(row, inputs) {
  const meta = row.meta || {};
  const chapter = meta.timeline && meta.timeline.chapter ? meta.timeline.chapter.t || null : null;
  return { v: WRITER_VERSION, title: inputs.title, family: inputs.family, noun: row.noun || null, denied: inputs.denied, admitted: inputs.admitted, chapterAt: chapter,
    heads: (meta.own || []).filter((r) => r && r.title && !r.blocked && (TYPE_OF_KIND[r.k] || 'outlet') === 'outlet').map((r) => hash32(keyOf(r.title), 8)).slice(-HEADS_KEPT) };
}
/** Whether the story changed since a line was written for it: the title or noun, a new chapter, a flag flipped, three new own headlines. */
function storyChanged(before, now) {
  if (!before) return true;
  if ((before.v || 1) !== (now.v || 1)) return true;
  return storyMoved(before, now);
}
/** Whether the story itself moved, whichever writer wrote for it: the title or noun, a new chapter, a flag flipped, three new own headlines. */
function storyMoved(before, now) {
  if (!before) return true;
  if (before.title !== now.title || before.family !== now.family || before.noun !== now.noun || before.denied !== now.denied || before.admitted !== now.admitted) return true;
  if ((before.chapterAt || null) !== (now.chapterAt || null)) return true;
  const had = new Set(before.heads || []);
  return (now.heads || []).filter((h) => !had.has(h)).length >= NEW_HEADLINES;
}

// ---------- the headline path (G4) ----------
/** A source headline as a line, the engine's own way: plain account, recased with the build's lexicon, a flat claim told as reported. */
function asLine(text, { subjectKey, family, lex }) {
  const bare = TL.plainLine(text, null, subjectKey, null);
  const last = subjectKey.split(' ').slice(-1)[0];
  const said = TN.statesClaim(bare, family, last) && !TN.REPORTED.test(bare) ? TN.reportedClaim(bare, family) : bare;
  const what = TL.tidyLine(TL.sentenceVerb(TL.plainWords(TN.sentenceLine(said, lex || null)), subjectKey));
  return /[.!?]['’"”]?$/.test(what) ? what : `${what}.`;
}
/**
 * A line with the names its sentence-case sources spell with capitals given their capitals back ("plonlo" is "Plonlo"):
 * a Title Case headline recased by the lexicon loses a name no dictionary tells from two plain words.
 */
function recaseNames(line, sources, { min = 1 } = {}) {
  let out = String(line || '');
  const plain = sources.map((src) => T.tokensOf(src.text)).filter((toks) => !T.isTitleCase(toks));
  // (min: how many sentence-case sources must spell a name that way before a line no writer composed is changed for it)
  const seen = new Map();
  for (const toks of plain) for (const key of new Set(capitalRuns(toks).map((run) => run.join(' ')))) seen.set(key, (seen.get(key) || 0) + 1);
  // (words a sentence-case source also writes small are no name: "ice cream" beside "Coldstuff Ice Cream")
  const small = (run) => plain.some((toks) => toks.some((t, i) => run.every((w, n) => toks[i + n] && toks[i + n].s === w.toLowerCase())));
  for (const toks of plain) {
    for (const run of capitalRuns(toks)) {
      if (small(run) || (seen.get(run.join(' ')) || 0) < min) continue;
      // (a plain word an outlet shouts is no part of a name: "her EX Rouo Trevova")
      if (run.some((w) => w.length >= 2 && w === w.toUpperCase() && /\p{L}/u.test(w) && W.inDict(w.toLowerCase()))) continue;
      // (however the line cased it: "plonlo", "Pretty woman")
      const any = new RegExp(`(?<![\\p{L}\\p{N}])${run.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(any, run.join(' '));
    }
  }
  return out;
}
/**
 * A line with the words its sentence-case sources write small written small too: a Title Case headline recased by the lexicon keeps
 * the capital of a word no dictionary knows ("its GTA 6 Memecoin hits ..."), and a lone quoted word keeps its headline's ("calls wife
 * and four kids ‘Demons’"). A word is made small when a sentence-case source writes it small inside a sentence and none writes it
 * with a capital there. Never the line's first word, never one that opens a sentence, never a given name.
 */
function recaseSmall(line, sources) {
  const plain = sources.map((src) => T.tokensOf(src.text)).filter((toks) => !T.isTitleCase(toks));
  const small = new Set();
  const big = new Set();
  for (const toks of plain) toks.forEach((t, i) => { if (i === 0 || /[.!?:]/.test(toks[i - 1].post)) return; if (/^\p{Ll}/u.test(t.s)) small.add(t.k); else if (/^\p{Lu}/u.test(t.s)) big.add(t.k); });
  const s = String(line || '');
  return s.replace(/(?<![\p{L}\p{N}'’-])\p{Lu}\p{Ll}{2,}(?![\p{L}\p{N}])/gu, (w, at) => {
    // (what stands before it, an opening quote mark or bracket aside: "‘Looksmaxxing’ influencer ..." opens the line)
    const before = s.slice(0, at).replace(/^[\s"“‘'([{]+/u, '');
    if (!before.trim() || /[.!?:]\s*["“‘']?$/.test(before)) return w;
    const k = w.toLowerCase();
    if (big.has(k) || W.isFirstName(k) || W.isProperWord(k)) return w;
    if (small.has(k)) return k;
    return w;
  });
}
/**
 * A line with the one-word names its sentence-case sources spell with a capital given it back ("unless take-two ships discs" is
 * "unless Take-Two ships discs"): a word they print with a capital inside a sentence and never small there.
 */
function recaseBig(line, sources) {
  const plain = sources.map((src) => T.tokensOf(src.text)).filter((toks) => !T.isTitleCase(toks));
  const small = new Set();
  const big = new Map();
  for (const toks of plain) toks.forEach((t, i) => { if (i === 0 || /[.!?:]/.test(toks[i - 1].post) || (t.q && toks[i - 1].q !== t.q)) return; if (/^\p{Ll}/u.test(t.s)) small.add(t.s.toLowerCase()); else if (/^\p{Lu}[\p{L}\p{N}'’-]*\p{Ll}/u.test(t.s)) big.set(t.s.toLowerCase(), t.s); });
  // (and a hyphened name, which the tokens split: "Take-Two")
  for (const src of sources) { if (W.isTitleCase(String(src.text || '').split(/\s+/))) continue; for (const m of String(src.text || '').matchAll(/(?<=[\p{L}\p{N},]\s)\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)+/gu)) big.set(m[0].toLowerCase(), m[0]); }
  let out = String(line || '');
  for (const [low, spelt] of big) {
    if (small.has(low) || low.length < 4) continue;
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}'’-])${low.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}'’-])`, 'gu'), spelt);
  }
  return out;
}
// two capitals that are no one's initials: a country, a medium, a word
const NOT_INITIALS = new Set(['UK', 'US', 'EU', 'UN', 'AI', 'TV', 'OK', 'LA', 'NY', 'DC', 'VP', 'PM', 'ER', 'PR', 'HR', 'IT', 'ID', 'AD', 'FX', 'HQ', 'DM', 'AP', 'ET', 'EW', 'SI', 'GQ', 'CW', 'RT', 'VR', 'AR', 'PC', 'F1', 'NZ', 'SA', 'GB', 'CA', 'AU', 'QB', 'WR', 'TE', 'RB']);
/**
 * A line with the surname after someone's initials given its capital back ("Velory Gravace calls out ..." is "Velory Gravace calls out ..."):
 * a Title Case headline says nothing by its capitals, and a surname that is also a plain word ("watt") was recased small. Only
 * after two capitals (or dotted initials) that are no country, medium or position, and only where a source has the two side by side.
 */
function recaseInitials(line, sources) {
  return String(line || '').replace(/(?<![\p{L}\p{N}.])(\p{Lu}{2}|(?:\p{Lu}\.){2,3})\s+(\p{Ll}[\p{Ll}'’-]{2,})(?![\p{L}\p{N}])/gu, (m, init, word) => {
    if (NOT_INITIALS.has(init.replace(/\./g, ''))) return m;
    const spelt = `${init} ${word.charAt(0).toUpperCase()}${word.slice(1)}`;
    return sources.some((src) => String(src.text || '').includes(spelt)) ? spelt : m;
  });
}
/**
 * A line as its sources spell it: names' capitals back, small words small, a quote recased whole. more: the row's other
 * sentences, read for how a name of two words or more is written and for nothing else (a stray capital in sixty headlines is
 * no evidence of a one-word name).
 */
const recased = (line, sources, more = []) => (line ? recaseInitials(recaseBig(recaseSmall(quoteCase(firstHalf(recaseNames(line, [...sources, ...more]))), sources), sources), [...sources, ...more]) : line);
/** A line with its people's names as two of its sentence-case sources write them, and nothing else touched: what a line no writer composed is put through. */
const namesRecased = (line, sources, more = []) => (line ? recaseInitials(recaseNames(line, [...sources, ...more], { min: 2 }), [...sources, ...more]) : line);
/** Whether a line cannot stand as a card's: an aftermath of something unsaid, a cut-off end, a list, a doubled word, a question, a page title, a profile. */
const unfit = (line, subjectKey) => AFTERMATH.test(line) || DANGLES.test(line) || aboutSomethingElse(line, subjectKey) || saysTwice(line, subjectKey) || /\?/.test(line) || PAGE_TAG.test(line) || PROFILE.test(line) || /%%/.test(line);
const RUN_JOINS = new Set(['of', 'the', 'and', 'de', 'la']);
/**
 * The names a sentence-case sentence spells with capitals, two words or more, as written: capitalised words side by side past its
 * first word, small words between them kept ("Plonlo", "Man of Tomorrow", "The Flash").
 */
function capitalRuns(toks) {
  const runs = [];
  let run = [];
  const flush = () => { while (run.length && RUN_JOINS.has(run[run.length - 1].k) && !run[run.length - 1].cap) run.pop(); if (run.length >= 2 && run.some((t) => t.cap && !T.STOP.has(t.k))) runs.push(run.map((t) => t.s)); run = []; };
  // (a work's name in quotes is one: two to five words, each capitalised but the small ones: "Pretty Woman")
  const titled = new Set(R.quotesOf({ toks }).filter((q) => q.keys.length >= 2 && q.keys.length <= 5 && toks.slice(q.from, q.to + 1).every((t) => t.cap || RUN_JOINS.has(t.k))).map((q) => q.id));
  toks.forEach((t, i) => {
    const opens = i === 0 || /[.!?:]/.test(toks[i - 1].post) || (t.q && toks[i - 1].q !== t.q && !titled.has(t.q));
    const capital = t.cap && !t.num && !opens && !t.joined && !(toks[i - 1] && toks[i - 1].joined);
    if (capital || (run.length && RUN_JOINS.has(t.k) && !t.cap)) run.push(t); else flush();
    if (run.length && (t.poss || /[,;:.!?()—–]/.test(t.post) || (toks[i + 1] && toks[i + 1].q !== t.q))) flush();
  });
  flush();
  return runs;
}
// a line that tells the aftermath of something it does not say: "provides update ... in aftermath of bizarre rant", "responds to ..."
const AFTERMATH = /\b(?:in (?:the )?(?:aftermath|wake) of|(?:provides?|gives?|shares?|issues?|posts?) (?:an? )?(?:update|statement)|addresses|respond(?:s|ed)? to|react(?:s|ed)? to|speaks? out|breaks? (?:(?:his|her|their) )?silence|clarif(?:y|ies|ied))\b/i;
/** Why a line does not say who did what, by the claim check's own rules; [] when it does. `line`: the engine's, its names recased. */
function headlineFaults(inputs, line = inputs.headline) {
  if (!line) return ['no line'];
  const last = keyOf(inputs.subject).split(' ').slice(-1)[0];
  const r = checkLine({ ...inputs, line, kind: 'headline' });
  // (a headline cannot say a claim and its maker's later apology in one line: that staleness is the model's to mend, rule 12)
  // (nor a sum its own sources quarrel over: a headline that gives one of two figures is replaced by one that gives none)
  const faults = r.failures.filter((f) => f.rule === 10 || (f.rule === 12 && /looks ahead/.test(f.why)) || (f.rule === 5 && /another story/.test(f.why)) || (f.rule === 3 && /for the same thing/.test(f.why))).map((f) => f.why);
  // (and the title's noun must be the subject's own in it: rule 11 as the check reads any line, with no headline to compare against.
  // "Lysena Marrard arrest" went out over "Lysiel Marrick, briefly detained in Lysena Marrard disappearance probe, arrested again", and
  // "Bexo Tamick apology" over the man who apologised to him. Reviewers, 2026-10-12)
  const alone = checkLine({ ...inputs, line, kind: 'headline', headline: null });
  faults.push(...alone.failures.filter((f) => f.rule === 11 && /is not the subject’s own|someone else’s|not against the subject/.test(f.why)).map((f) => f.why));
  if (last && !W.words(line).includes(last)) faults.push('it does not name the subject');
  // (judges, 2026-10-11: a list's headline, a shouted lead and a doubled word were each a top-20 line)
  if (aboutSomethingElse(line, keyOf(inputs.subject))) faults.push('it is a list or leads with something else');
  if (PAGE_TAG.test(line)) faults.push('it is a page title, not a sentence');
  if (PROFILE.test(line)) faults.push('it is a profile, not what happened');
  if (r.failures.some((f) => f.rule === 1 && /comments on the story/.test(f.why))) faults.push('it comments on the story and does not tell it');
  if (SHOUT_LEAD.test(line) && dropShout(line) !== line) faults.push('it shouts');
  else if (saysTwice(line, keyOf(inputs.subject))) faults.push('it says a word twice');
  if (!faults.length && AFTERMATH.test(line)) faults.push('it tells the aftermath of something it does not say');
  return faults;
}
// a role said in place of a name: "slams beloved pop star", "feuds with fellow streamer"
const ROLE_ALONE = /(?<![\p{L}\p{N}])(?:pop star|movie star|reality star|rock star|star|singer|actor|actress|rapper|comedian|host|streamer|youtuber|tiktoker|influencer|podcaster|model|musician|co-star|costar|celebrity|a-lister)(?![\p{L}\p{N}’'])/giu;
const NOBODY = /^(?:jane|john|baby|mary|richard|james) (?:doe|roe)$/;
const WHO_OUTLETS = 2;
/**
 * Who a line withholds (the judges' first complaint, still on the page at the recheck of 2026-10-12: "Koro Fenniss slams beloved
 * pop star for speaking out ..." where four of its own outlets say Veley Gravmott). The line says a role with no name beside it
 * and names nobody but its subject, while two outlets of its own name the same other person: that name, as they spell it; else null.
 */
function withheldWho(inputs, line) {
  const text = String(line || '');
  // (a role with a name right after it, or a possessive right before, is that person's: "Twitch streamer Bexan Tamard", "Glass Hounds’ star")
  // (nor is a role said of the subject after a comma anyone withheld: "Orria Neskley, the controversial streamer, ...")
  const alone = [...text.matchAll(ROLE_ALONE)].some((m) => !/^\s+[‘“"']?\p{Lu}/u.test(text.slice(m.index + m[0].length)) && !/(?:\p{Lu}[\p{L}]*|[’']s?)\s+$/u.test(text.slice(0, m.index)) &&
    !/,\s+(?:the|an?)\s+(?:\S+\s+){0,2}$/iu.test(text.slice(0, m.index)));
  if (!alone || !inputs.sources.length) return null;
  // (names as the claim check reads them: a name one sentence-case source prints is a name in every source)
  const ctx = prepare({ ...inputs, line: text });
  const other = (m) => m.keys.length >= 2 && !T.sameName(m, ctx.subject) && !m.keys.every((k) => ctx.subjectKeys.includes(k)) && !NOBODY.test(m.keys.join(' '));
  if (ctx.L.mentions.some(other)) return null;
  const counts = new Map();
  for (const src of ctx.sources.filter((x) => x.type === 'outlet')) {
    for (const m of src.S.mentions.filter(other)) {
      const k = m.keys.join(' ');
      const c = counts.get(k) || { name: src.S.toks.slice(m.start, m.end + 1).map((t) => t.s).join(' '), outlets: new Set() };
      c.outlets.add(keyOf(src.outlet || src.text));
      counts.set(k, c);
    }
  }
  const best = [...counts.values()].filter((c) => c.outlets.size >= WHO_OUTLETS).sort((a, b) => b.outlets.size - a.outlets.size)[0];
  return best ? best.name : null;
}
/**
 * The no-model line (G4): the engine's line with its names' capitals back; or, when that line only says there was a reaction, tells
 * an angle its own sources have moved on from, joins two stories or does not name the subject, the most telling outlet sentence
 * that passes the same claim check, told the engine's way. { line, from ('engine' | the outlet), why }.
 */
function headlineLine(inputs, lex = null) {
  const subjectKey = keyOf(inputs.subject);
  const family = TN.FAMILY.get(inputs.family) || null;
  // (a page's template left in a title, "... %%page%% %%sep%%", is no word of anyone's)
  const kept = { line: inputs.headline ? recased(String(inputs.headline).replace(/\s*%%[^%\s]{1,24}%%/g, '').replace(/\s+([.,;:])/g, '$1'), inputs.sources, inputs.spelt || []) : null, from: 'engine', why: [] };
  const faults = headlineFaults(inputs, kept.line);
  // (a role where its own outlets name who: an outlet's sentence that names them is preferred, when one passes the check)
  const who = kept.line ? withheldWho(inputs, kept.line) : null;
  if (who) faults.push(`it says a role where its sources name ${who}`);
  if (!faults.length) return kept;
  const base = kept.line ? informative(kept.line, { subjectKey, family }) : -Infinity;
  const sameAs = (a, b) => keyOf(a) === keyOf(b);
  const options = inputs.sources.filter((s) => s.type === 'outlet').map((s) => ({ s, line: recased(asLine(s.text, { subjectKey, family, lex }), inputs.sources, inputs.spelt || []) }))
    // (never the title said again, never the line it would replace, never one with the same fault)
    .filter((x) => !sameAs(x.line, inputs.title) && !(kept.line && sameAs(x.line, kept.line)) && !AFTERMATH.test(x.line) && !DANGLES.test(x.line))
    .filter((x) => !aboutSomethingElse(x.line, subjectKey) && !saysTwice(x.line, subjectKey) && !/\?/.test(x.line) && !PAGE_TAG.test(x.line) && !PROFILE.test(x.line))
    .map((x) => ({ ...x, score: informative(x.line, { subjectKey, family, outlet: x.s.outlet }), check: checkLine({ ...inputs, line: x.line, kind: 'headline' }) }))
    .filter((x) => x.check.ok && x.line.length <= LINE_CHARS_MAX).sort((a, b) => b.score - a.score || b.s.t - a.s.t);
  // (withholding who is mended only by a sentence that says who; with no other fault the line stands when none does)
  const naming = who ? options.filter((x) => keyOf(x.line).includes(keyOf(who))) : [];
  if (who && !naming.length && faults.length === 1) return kept;
  const best = (naming.length ? naming : options)[0];
  // (a line that is wrong by a rule gives way to any that is not; one that is merely thin, to one that says at least as much)
  const wrong = faults.some((f) => !/reaction|aftermath/.test(f));
  if (!best || (!wrong && best.score < base)) return { ...kept, why: faults };
  return { line: best.line, from: best.s.outlet || 'outlet', why: faults };
}

module.exports = { recased, namesRecased, recaseInitials, unfit, withheldWho, storyMoved, recaseBig, recaseSmall, inputsOf, wordInputs, sentencesOf, WRITER_VERSION, sourceHash, basisOf, storyChanged, informative, sentence, dropShout, aboutSomethingElse, saysTwice, firstHalf, quoteCase, saysNoEvent, asLine, recaseNames, capitalRuns, headlineFaults, headlineLine, SOURCES_MAX, SOURCE_CHARS };
