'use strict';
/*
 * A story's dossier (ios/IDEAS-FEED.md P1): what an editor reads to write its card. The row's own sentences, then what the
 * collector's searches for its names returned and never counted, kept only where they tell the same story (the words and the people
 * of its own sentences); each with who published it, what kind it is and when; and the measured facts (when the searches began,
 * how many sources, the day the collector dates it from). A few are SHOWN to the model, numbered newest first; the rest stand behind
 * them for the gate, which reads a hedge or a denial wherever the collector holds one. An own sentence that is not plainly this
 * row's story (`plainlyOwn`: another person of the same first name, a stranger's story that shares one word) is never shown.
 * Pure: no clock, no I/O.
 *
 * dossierOf(row, { store, nowMs, facts, max }) -> null, or
 *   { id, kind ('talk' | 'word'), title, subject, family, denied, admitted, person, headline, spelt,
 *     shown: [{ text, type, outlet, t, own? }]   the numbered sentences, newest first (a word's page sentences first, as its page has
 *                                           them); own: the collector counted the sentence for this very row
 *     behind: [{ text, type, outlet, t, own? }]  the same story's other sentences: read by the gate, never by the model
 *     facts: { today, searchStart, searches, sources, last24h, firstSource, started }, hash }
 */
const RULES = require('../../engine/rules');
const TN = require('../../engine/talk-nouns');
const SRC = require('../line-sources');
const RP = require('../line-replies');
const T = require('../line-text');
const { sha256, keyOf } = require('../util');

const VERSION = 1;
const SHOWN_MAX = 16;
const BEHIND_MAX = 60;
const HOUR_MS = 3600e3;
const DAY_MS = 24 * HOUR_MS;
// how far before a story's first own sentence a searched sentence may still be its beginning
const BEFORE_MS = 36 * HOUR_MS;
// a story's own words: said by this many of its own sentences (one, where it has few)
const VOCAB_SHARE = 2;
const FEW_OWN = 4;
const SHARED_WORDS = 2;
const ALSO_NAMES = 3;
const WORDS_MIN = 4;
const TURN_BONUS = 2;
const CLAIM_BONUS = 2;
const REPLY_BONUS = 3;
const RECENT_BONUS = 3;
const RECENT_MS = 72 * 3600e3;
const EARLIEST_KEPT = 2;
// how alike two sentences may be before the second adds nothing a reader has not seen
const SAME_SHARE = 0.75;
const TYPE_OF_KIND = { outlet: 'outlet', beat: 'outlet', post: 'post', social: 'post', upload: 'video', clip: 'video' };
const VIDEO_OUTLET = /^(?:youtube|tiktok|twitch|kick|rumble)(?:\.com)?$/i;
const POST_OUTLET = /^(?:reddit|r\/\S+|x|twitter|bluesky|threads|instagram|facebook)(?:\.com)?$/i;
const JUNK = /%%|\.\.\.$|…$|^\W*$/;
// how a story turns: a reply, an outcome, a step someone took
const TURN = /(?<![\p{L}\p{N}])(?:den(?:y|ies|ied)|refut\w+|disput\w+|reject\w+|respond\w*|repl(?:y|ies|ied)|apolog\w+|sorry|retract\w*|admit\w*|confirm\w*|sue[sd]?|suing|lawsuit|legal action|lawyer\w*|arrest\w*|charged|banned|suspended|fired|cancel\w*|postpon\w+|quits?|retir\w+|deletes?|deleted|breaks? (?:his|her|their) silence|speaks? out|hits? back|claps? back|fires? back|pushes back|addresses|statement|defends?|defended|jokes?|joked)(?![\p{L}\p{N}])/iu;

// words every creator's week is told in: sharing them makes no two sentences one story
const GENERIC = new Set(['streamer', 'streamers', 'stream', 'streams', 'streaming', 'livestream', 'twitch', 'kick', 'youtube', 'youtuber', 'tiktok', 'tiktoker', 'instagram', 'influencer', 'creator', 'star', 'fans', 'fan', 'viral',
  'video', 'videos', 'clip', 'new', 'latest', 'social', 'media', 'online', 'internet', 'watch', 'drama', 'controversy', 'explained', 'reacts', 'reaction', 'show', 'live', 'post', 'posts', 'news', 'update', 'world', 'first', 'time', 'year', 'week', 'day']);
// a sentence that tells a claim of someone, or what someone answered: the backbone of a card
const CLAIM = /(?<![\p{L}\p{N}])(?:alleg\w+|accus\w+|claims?|claimed|sues?|sued|lawsuit|charged|charges?)(?![\p{L}\p{N}])/iu;

const talkKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const typeOfOutlet = (outlet, blocked) => (VIDEO_OUTLET.test(outlet || '') ? 'video' : POST_OUTLET.test(outlet || '') ? 'post' : blocked ? 'post' : 'outlet');
/** The words of a sentence that say something, as stems: no grammar, no numbers, none of the names given. */
function stemsOf(text, names = new Set()) {
  return new Set(T.tokensOf(text).filter((t) => T.isContent(t) && !t.num && !T.FREE.has(t.k) && !names.has(t.k) && t.k.length > 2).map((t) => t.st));
}
/** The same, without the words every creator's week is told in: what two sentences of one story share. */
function storyStems(text, names) {
  return new Set(T.tokensOf(text).filter((t) => T.isContent(t) && !t.num && !T.FREE.has(t.k) && !names.has(t.k) && t.k.length > 2 && !GENERIC.has(t.k) && !(TN.ROLE && TN.ROLE.has(t.k))).map((t) => t.st));
}
/** How much of the smaller of two sets of words the other holds (0 to 1). */
function alike(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (!small.size) return 0;
  let n = 0;
  for (const x of small) if (big.has(x)) n += 1;
  return n / small.size;
}

/** One stored headline as a source sentence, or null when nothing can be read from it. */
function sentenceOf(r, more = {}) {
  if (!r || !r.title) return null;
  const outlet = r.outlet || r.publisher || r.label || null;
  const text = SRC.sentence(r.title, outlet);
  if (JUNK.test(text) || text.split(/\s+/).length < WORDS_MIN) return null;
  const blocked = !!r.blocked || RULES.PUBLISHER_BLOCK.test(outlet || '');
  const type = r.k ? (r.blocked ? 'post' : TYPE_OF_KIND[r.k] || 'outlet') : typeOfOutlet(outlet, blocked);
  const t = Number.isFinite(r.t) ? (r.t < 1e11 ? r.t * 1000 : r.t) : 0;
  return { text, type, outlet, t, key: keyOf(text), ...more };
}

/** What the collector's own searches for a name returned: the name's news, newest and oldest (engine/talk-sources.js). */
function searchedFor(store, name) {
  const look = store && store.lookups && typeof store.lookups.get === 'function' ? store.lookups.get(`talk-${talkKey(name)}`) : null;
  if (!look) return [];
  return ['tpnews', 'tprecent', 'tporigin'].flatMap((part) => ((look[part] && look[part].rows) || []));
}

/**
 * The story's other sentences among what was searched: after its beginning, naming its subject or one of the people its own
 * sentences name, and sharing two of its own words (one, when it names both the subject and one of those people). A name's other
 * news of the week shares neither: "Mara Voss pauses stream to check on a fan" is no part of her quarrel with an editor.
 */
function sameStory(candidates, own, { subjectKeys, from }) {
  const names = new Set(subjectKeys);
  const df = new Map();
  const people = new Map();
  for (const s of own) {
    for (const st of storyStems(s.text, names)) df.set(st, (df.get(st) || 0) + 1);
    const toks = T.tokensOf(s.text);
    if (T.isTitleCase(toks)) continue;
    for (const i of T.nameIndexes(toks)) if (!names.has(toks[i].k) && toks[i].k.length > 2) people.set(toks[i].k, (people.get(toks[i].k) || 0) + 1);
  }
  const min = own.length < FEW_OWN ? 1 : VOCAB_SHARE;
  const others = new Set([...people].filter(([, n]) => n >= min).map(([k]) => k));
  // (a person's name is no word of the story: naming them is counted once, as naming them. Until the review of 2026-10-12 a name
  // whose stem is not its spelling, "Blake", "Hale", slipped in as a word, so any sentence that named the subject and
  // that person was the same story on the name alone: a charity gift, a report about a marriage, under a row about leaked texts)
  const named = new Set([...others].map((k) => T.stemOf(k)));
  const vocab = new Set([...df].filter(([st, n]) => n >= min && !others.has(st) && !named.has(st)).map(([st]) => st));
  const last = subjectKeys[subjectKeys.length - 1];
  return candidates.filter((s) => {
    if (s.t && s.t < from) return false;
    const keys = new Set(T.tokensOf(s.text).map((t) => t.k));
    const subjectNamed = !!last && keys.has(last);
    const otherNamed = [...others].some((k) => keys.has(k));
    if (!subjectNamed && !otherNamed) return false;
    let shared = 0;
    for (const st of storyStems(s.text, names)) if (vocab.has(st)) shared += 1;
    return shared >= (subjectNamed && otherNamed ? 1 : SHARED_WORDS);
  });
}

/**
 * The sentences shown to the model, newest first: the ones that tell most (who did what, a reply, a step someone took), the newer
 * the better, never two that say the same thing in the same words; always the reply a claim got, the newest outlet sentence and the
 * earliest two (when it began).
 */
function choose(all, { subject, subjectKey, max, nowMs }) {
  const names = new Set(subjectKey.split(' ').filter(Boolean));
  const newest = Math.max(...all.map((s) => s.t || 0), 0);
  const end = Number.isFinite(nowMs) ? nowMs : newest;
  const score = (s) => {
    const reply = s.type === 'outlet' && !!RP.replyOf(s.text, subject);
    const age = s.t > 0 ? Math.max(0, end - s.t) : RECENT_MS;
    const last = subjectKey.split(' ').pop();
    // (who alleges what of the subject: the sentence a card about a claim cannot do without)
    const claim = s.type === 'outlet' && CLAIM.test(s.text) && !!last && T.tokensOf(s.text).some((t) => t.k === last);
    return SRC.informative(s.text, { subjectKey, family: null, outlet: s.outlet }) + (s.type === 'outlet' ? 2 : 0) + (s.own ? 1 : 0) + (TURN.test(s.text) ? TURN_BONUS : 0) + (reply ? REPLY_BONUS : 0) + (claim ? CLAIM_BONUS : 0) +
      RECENT_BONUS * Math.max(0, 1 - age / RECENT_MS) - (/\?\s*["”’']?$/.test(s.text) ? 3 : 0);
  };
  const ranked = all.map((s) => ({ s, stems: stemsOf(s.text, names), score: score(s) })).sort((a, b) => b.score - a.score || b.s.t - a.s.t);
  const picked = [];
  const take = (x, force = false) => {
    if (!x || picked.includes(x)) return;
    // (a syndicated copy and a rewrite of the same wire line say nothing twice)
    if (picked.some((p) => Math.min(p.stems.size, x.stems.size) >= 3 && alike(p.stems, x.stems) >= SAME_SHARE)) return;
    if (picked.length >= max) { if (!force) return; picked.pop(); }
    picked.push(x);
  };
  const outlets = ranked.filter((x) => x.s.type === 'outlet' && x.s.t > 0);
  for (const x of ranked) { if (picked.length >= max - EARLIEST_KEPT) break; take(x); }
  // (the reply a claim got is never left out: a card that tells the claim owes it)
  for (const x of ranked.filter((y) => y.s.type === 'outlet' && RP.replyOf(y.s.text, subject)).slice(0, 1)) take(x, true);
  take([...outlets].sort((a, b) => b.s.t - a.s.t)[0], true);
  for (const x of [...outlets].sort((a, b) => a.s.t - b.s.t).slice(0, EARLIEST_KEPT)) take(x);
  for (const x of ranked) { if (picked.length >= max) break; take(x); }
  return picked.map((x) => x.s).sort((a, b) => b.t - a.t);
}

const dayOf = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null);
// (own: the collector counted the sentence for this very row; what a search for the name returned carries no such mark)
const strip = ({ text, type, outlet, t, own }) => ({ text, type, outlet: outlet || null, t: t || 0, ...(own ? { own: true } : {}) });
// what any accusation's sentence says, as stems: sharing these makes no two sentences one story
const CLAIM_WORD = /^(?:alleg\w*|accus\w*|claim\w*|den(?:y|i\w*)|charg\w*|lawsuit|sue|rumou?r\w*|report\w*|respon\w*|scandal\w*)$/;
const OWN_SHARED = 2;
const OWN_KIN = 2;
/**
 * The row's own sentences that are shown to the model (reviewers, 2026-10-12: a footballer's story under a prince's row, an
 * actress's under a man accused of something else, each counted for the row by a shared first name or one shared word, each told
 * on a card). An own sentence is shown only when it is plainly this row's story: it gives the subject's name in full, or it shares
 * two words that say something with the row's own line, or with two other own sentences. The rest stand behind: the gate still
 * reads them for a hedge or a denial, and no card is written from them.
 */
function plainlyOwn(own, { subjectKeys, line }) {
  const names = new Set(subjectKeys);
  const words = (text) => new Set([...storyStems(text, names)].filter((st) => !CLAIM_WORD.test(st)));
  const told = own.map((s) => ({ s, keys: T.tokensOf(s.text).map((t) => t.k), words: words(s.text) }));
  const lineWords = line ? words(line) : new Set();
  const shares = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n += 1; return n >= OWN_SHARED; };
  const inFull = (keys) => subjectKeys.length > 0 && keys.some((_, i) => subjectKeys.every((k, n) => keys[i + n] === k));
  return told.filter((x) => inFull(x.keys) || shares(x.words, lineWords) || told.filter((y) => y !== x && shares(x.words, y.words)).length >= OWN_KIN).map((x) => x.s);
}

function talkDossier(row, { store, nowMs, facts, max }) {
  const inputs = SRC.inputsOf(row);
  if (!inputs) return null;
  const meta = row.meta || {};
  const subject = inputs.subject;
  const subjectKey = keyOf(row.subject || subject);
  const subjectKeys = T.tokensOf(subject).map((t) => t.k).filter(Boolean);
  const seen = new Set();
  const fresh = (s) => { if (!s || seen.has(s.key)) return false; seen.add(s.key); return true; };
  const own = (meta.own || []).map((r) => sentenceOf(r, { own: true })).filter(fresh);
  const around = (meta.around || []).map((r) => sentenceOf(r)).filter(fresh);
  // (the story began no later than its first own sentence, and no earlier than a day and a half before it)
  // (or the day the series dates it from, when that is earlier: a story whose own sentences were re-anchored on a later chapter
  // began with its first, and the claim that started it is dated there)
  const first = Math.min(...own.map((s) => s.t).filter((t) => t > 0), facts && Number.isFinite(facts.startedAt) && facts.startedAt > 0 ? facts.startedAt * 1000 : Infinity, Infinity);
  const from = Number.isFinite(first) ? first - BEFORE_MS : 0;
  const names = [subject, ...(meta.also || []).slice(0, ALSO_NAMES)];
  const searched = names.flatMap((name) => searchedFor(store, name)).map((r) => sentenceOf(r)).filter((s) => s && s.t <= nowMs + HOUR_MS).filter(fresh);
  const story = [...own, ...sameStory([...around, ...searched], own, { subjectKeys, from })];
  if (!story.length) return null;
  const family = inputs.family;
  // (an own sentence that is not plainly this row's story is never shown; with none that is, the row's own are all it has)
  const plain = new Set(plainlyOwn(own, { subjectKeys, line: row.line || '' }));
  const showable = plain.size ? story.filter((s) => !s.own || plain.has(s)) : story;
  const shown = choose(showable, { subject, subjectKey, max, nowMs });
  const behind = story.filter((s) => !shown.includes(s)).sort((a, b) => b.t - a.t).slice(0, BEHIND_MAX);
  const us = (meta.trends || []).filter((x) => x && x.geo === 'US');
  const searches = (us.length ? us : meta.trends || []).reduce((best, x) => (!best || (x.volume || 0) > (best.volume || 0) ? x : best), null);
  const searchStart = Math.min(...(meta.trends || []).map((x) => x.start).filter((x) => Number.isFinite(x) && x > 0), Infinity);
  const dated = story.map((s) => s.t).filter((t) => t > 0);
  return { id: row.id || null, kind: 'talk', title: row.title, subject, family, denied: inputs.denied, admitted: inputs.admitted, person: inputs.person, headline: row.line || null,
    spelt: story.map((s) => ({ text: s.text })).slice(0, 80), shown: shown.map(strip), behind: behind.map(strip),
    facts: { today: dayOf(nowMs), searchStart: dayOf(searchStart), searches: searches && searches.volume ? searches.volume : null, sources: story.length, last24h: dated.filter((t) => nowMs - t < DAY_MS).length,
      firstSource: dayOf(Math.min(...dated, Infinity)), started: facts && Number.isFinite(facts.startedAt) ? dayOf(facts.startedAt * 1000) : null, tier: row.tier || null } };
}

function wordDossier(row, { nowMs, facts, max }) {
  const inputs = SRC.wordInputs(row);
  if (!inputs) return null;
  const meta = row.meta || {};
  const pageT = Number.isFinite(meta.pageT) ? meta.pageT : 0;
  return { id: row.id || null, kind: 'word', title: row.title, subject: inputs.subject, family: null, denied: false, admitted: false, person: false, headline: row.line || null, spelt: [],
    shown: inputs.sources.slice(0, max).map(strip), behind: [],
    facts: { today: dayOf(nowMs), searchStart: null, searches: null, sources: inputs.sources.length, last24h: inputs.sources.filter((s) => s.t > 0 && nowMs - s.t < DAY_MS).length, firstSource: dayOf(pageT),
      started: facts && Number.isFinite(facts.startedAt) ? dayOf(facts.startedAt * 1000) : null, tier: row.kind || 'word' } };
}

/** A row's dossier, or null for a row with nothing to write a card from (a row its signals alone tell: lib/native-desk.js). */
function dossierOf(row, { store = null, nowMs, facts = null, max = SHOWN_MAX } = {}) {
  if (!row || row.native) return null;
  const d = row.wordish || row.type === 'word' ? wordDossier(row, { nowMs, facts, max }) : talkDossier(row, { store, nowMs, facts, max });
  if (!d || !d.shown.length) return null;
  return { ...d, hash: hashOf(d) };
}
/** What a card was written from: the title the engine gave, the two flags and the sentences shown. A new sentence among them is a new dossier. */
const hashOf = (d) => sha256([`e${VERSION}`, d.kind, d.title, d.denied ? 1 : 0, d.admitted ? 1 : 0, ...d.shown.map((s) => s.text).sort()].join('\n')).toString('hex');

/** The dossier as the gate reads it: the claim check's inputs, the shown sentences first so that a source's number is its index. */
function inputsOf(d, { behind = false } = {}) {
  // (headline: the engine's own line under the engine's title, as the line writer hands it to the check: what the title's noun was
  // read from. A card under another title is read with none: lib/editor/gate.js)
  return { id: d.id, kind: d.kind === 'word' ? 'word' : 'talk', title: d.title, subject: d.subject, family: d.family, denied: d.denied, admitted: d.admitted, person: d.person, headline: d.headline || null,
    sources: behind ? [...d.shown, ...d.behind] : d.shown, spelt: d.spelt || [] };
}

module.exports = { dossierOf, inputsOf, hashOf, sameStory, plainlyOwn, choose, sentenceOf, stemsOf, alike, dayOf, TURN, VERSION, SHOWN_MAX };
