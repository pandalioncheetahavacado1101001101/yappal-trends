'use strict';
/*
 * The why and the angles (ios/IDEAS-SUPER.md P12; ios/IDEAS-FEED.md P7): what an editor's card adds for a creator. The model writes
 * them with the card (lib/editor/prompt.js); here each is held to the claim check exactly as the card's line is, or left out:
 *   why       why it is talked about now: one clause (two when a claim it tells was answered) of the story's newest development,
 *             from an outlet or page sentence of the last 7 days in its own words (a cut of it, else its rule-built wording), with
 *             "reportedly" and the answer a claim got where the check asks for them, passing every rule of the claim check on the
 *             shown sentences and on the story behind them (lib/editor/gate.js `judgeLine`). The card's length and its title are the
 *             card's own business, not the why's
 *   an angle  { kind, do, about }: what a creator could film today. "do" says what to film in plain filming words: it opens on its
 *             kind's own verbs, names nobody (no "he" or "she"), gives no number but a length ("in 60 seconds"), says nothing of the
 *             story (no "did", "confirmed", "it is over"), and a thing it points at is one the story's outlet or page sentences name
 *             ("the clip"), an event only where one says it happened, plainly ("the apology": not "refuses to apologize", not
 *             "denies breakup rumours"); else the kind's own plain instruction stands. "about" is the fact the video is about, held
 *             as a why is (any age), the answer it got kept with it (an official's "no credible threat" included). An opinion is the
 *             creator's: a story that tells a crime, violence, abuse or another wrongdoing (misconduct, pay withheld) is offered only
 *             explain and timeline, a death only timeline; a sound, a format, a meme or a word only try and take, and explain for
 *             where a meme comes from. A timeline is two facts or more of different days, oldest first, or it is explained instead
 * Published (`publishedOf`), the instruction and the fact stay apart: the detail prints the fact only where its row's line and why
 * lines do not already tell it (`angleFor`).
 * Kept from an earlier cycle, each is judged again on the story as it is now (`standing`), as a kept card's line is. Nothing here
 * is a name or a story: the vocabulary is of filming, and every fact is the sources'.
 * Pure: no clock (now is handed in), no I/O.
 */
const T = require('../line-text');
const TN = require('../../engine/talk-nouns');
const RP = require('../line-replies');
const P = require('./prompt');
const D = require('./dossier');
const G = require('./gate');
const WD = require('./wording');
const { keyOf } = require('../util');

const DAY_MS = 86400e3;
const WHY_FRESH_MS = 7 * DAY_MS;
const WHY_WORDS = [4, 30];
const ABOUT_WORDS = [4, 30];
// (the feed's own caps: a why line and an angle are 160 characters at most, ios/IDEAS-FEED.md D4)
const WHY_CHARS = 160;
const ANGLE_CHARS = 160;
const DO_WORDS = [2, 12];
const LENGTH_SECONDS_MAX = 90;
const TRIES_MAX = 12;
const REASON_MAX = 300;
// (what may say a fact: a headline or a reference page. A post's or a video's title proves nothing, P2)
const SUPPORT = new Set(['outlet', 'page']);

// each kind: the verbs its instruction opens on, and the plain instruction that stands when the model's does not
const KIND = {
  explain: { verbs: ['explain', 'break', 'green', 'sum', 'walk', 'show', 'unpack', 'split', 'clear'], stock: 'Explain it in a minute' },
  react: { verbs: ['react', 'stitch', 'duet', 'watch', 'film'], stock: 'React to it on camera' },
  take: { verbs: ['give', 'share', 'pick', 'say', 'tell', 'rate', 'weigh'], stock: 'Give your take on it' },
  ask: { verbs: ['ask', 'poll', 'let', 'get', 'start'], stock: 'Ask your viewers what they think' },
  timeline: { verbs: ['tell', 'list', 'lay', 'recap', 'walk', 'go', 'show', 'put', 'run'], stock: 'Tell it in order, oldest first' },
  try: { verbs: ['try', 'film', 'make', 'recreate', 'do', 'join', 'use', 'show', 'put', 'take'], stock: 'Try it yourself' },
};
// the words an instruction to film is made of: how to film it, who watches, a creator's own opinion. None tells a fact of the story
// (no "not", no "real", no "wrong", no "did", "confirmed" or "is over"), none names anyone or says "he" or "she" (a pronoun makes the
// instruction a sentence about someone: "Say she did it"), none is first person. "his", "her" and "their" only open a noun ("her side")
const FRAME = new Set([...[
  'a about after again all an and any anyone are as at audience back before best both break but by camera can catch chat ',
  'clear comes comment comments compare debate decide do down duet each earliest easy end ',
  'everyone everything explain explained explainer face facts far fast feel film filming first followers for from full ',
  'get give go green guess happen happened happening happens has have headline headlines hear here honest how if in into ',
  'is it its join just keep kind know known last latest lay learn let like list look make minute minutes miss missed more ',
  'most much need new newest news next now of off oldest on one only opinion or order other out over own part people pick ',
  'plain play point points poll put quick quickly rank rate react reacting reaction recap recreate reels reported run ',
  'said say says screen second seconds see share short shorts show side sides simple so split start step stitch story sum ',
  'summary take takes talk tell that the their them then they thing things think this those through tiktok time to today ',
  'top try turn under unpack up use version viewers vote walk want watch way ways weigh what when where whether which ',
  'while who whose why will with without words would you your yours yourself youtube ',
  'situation incident update details key moments timeline might could his her trending',
].join('').split(' '), ...Object.values(KIND).flatMap((k) => k.verbs)]);
// what opens a thing's name: a word of the story's own is pointed at only inside such a phrase ("the store's response")
const DETERMINER = new Set(['the', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'its']);
// (a possessive is a determiner and nothing else: a noun follows it. "React to her" says who; "her side", "their take" do not)
const POSSESSIVE = new Set(['his', 'her', 'their']);
// the filming words that are things, and may follow a possessive
const FRAME_NOUN = new Set(('side sides story take takes opinion version words point points part reaction moment moments headline headlines '
  + 'facts thing things way ways time update details timeline summary situation incident').split(' '));
// what "is" or "are" may say in an instruction: that it is trending or happening, never what someone or something is ("it is over",
// "they are out")
const IS_SAYS = new Set(['trending', 'happening', 'about', 'going']);
// (a pronoun's "'s" or "'re" is "is": "it's over" is "it is over")
const UNCONTRACTED = (text) => String(text).replace(/(?<![\p{L}\p{N}])(it|they|he|she|that|this|what|who|there|we|you)['’](s|re)(?![\p{L}\p{N}])/giu, (m, w, c) => `${w} ${c.toLowerCase() === 're' ? 'are' : 'is'}`);
// a story's own word that is a fact said of someone: never pointed at from an instruction, only told in the fact it is about
const FACT_WORD = (t) => !!T.claimClass(t.k) || T.isVerbish(t) || T.NEG_GRAMMAR.has(t.k) || !!t.nt || DEATH.test(t.s) || CRIME.test(t.s) || TN.WRONGDOING.test(t.s);
// the things a story is told through: an instruction may point at one when the story's own outlet or page sentences name it
const MEDIA = new Set(('clip clips video videos post posts photo photos picture pictures song songs sound audio dance meme memes trend '
  + 'challenge filter format game app episode trailer interview stream livestream podcast series movie film show book album tour match '
  + 'lyrics performance speech scene moment outfit recipe product edit look').split(' '));
// the things a story is made of that are themselves facts: one is pointed at only when an outlet or a page says it happened, plainly
// (not "no apology", not "denies breakup rumours", not "reportedly reach a deal"); else the kind's own instruction stands
const EVENT = new Set('apology lawsuit ban breakup deal contract feud rant clapback statement reply response announcement'.split(' '));
const OBJECT = new Set([...MEDIA, ...EVENT]);
// (what makes a sentence's thing a rumour or somebody's account rather than a thing that happened)
const RUMOUR = /^(?:rumou?r\w*|speculat\w*|reportedly|allegedly|alleged|unconfirmed|purported\w*)$/;
// (and the words that turn it down: "denies", "disputes", "refuses to apologize", "declines to comment")
const TURNS_DOWN = (t) => T.DENIES.test(t.k) || /^(?:refus|declin)/.test(t.k);
// the platforms a creator posts on, the one capital an instruction may hold
const PLATFORM = new Set(['tiktok', 'youtube', 'reels', 'shorts']);
// what a word's, a meme's or a sound's own row is: always there to point at
const THING = new Set(['meme', 'memes', 'trend', 'sound', 'audio', 'song', 'challenge', 'format', 'filter', 'dance', 'edit', 'clip', 'video', 'game', 'app']);
const LENGTH = new Set(['second', 'seconds', 'minute', 'minutes']);
// a story with a death in it is told in order or not at all; one with a crime, violence or abuse is only explained or told in order
const DEATH = /(?<![\p{L}\p{N}])(?:dies|died|dead|death|deaths|killed|passed away|obituary|funeral|tribute|overdose|suicide|memorial)(?![\p{L}\p{N}])/iu;
const CRIME = /(?<![\p{L}\p{N}])(?:arrest\w*|charged|charges|jail\w*|prison|sentenc\w*|convict\w*|guilty|police|murder\w*|shot dead|mass shooting|gunman|gunfire|opened fire|stabb\w*|assault\w*|abus\w*|rap(?:e|ed|es|ist)|groom\w*|harass\w*|traffick\w*|kidnap\w*|violen\w*)(?![\p{L}\p{N}])/iu;
// (and the accusations of wrongdoing that are no crime word: misconduct, money owed and kept, theft by another name)
const WRONG = /(?<![\p{L}\p{N}])(?:misconduct|embezzl\w*|extort\w*|blackmail\w*|scamm\w*|steal\w*|stolen|stole|theft|fraud\w*|withh(?:e|o)ld\w*\s+(?:\S+\s+){0,3}?(?:pay|wages?|salar\w*|payments?|money|earnings|royalt\w*)|unpaid\s+(?:\S+\s+){0,2}?(?:wages?|pay|invoices?|staff|editors?|workers?))(?![\p{L}\p{N}])/iu;
const GRAVE_KINDS = { death: new Set(['timeline']), crime: new Set(['explain', 'timeline']) };
// a sound's, a format's, a meme's or a word's row: done, or given a take on; explained only where a meme comes from; never a timeline
const WORD_KINDS = new Set(['try', 'take', 'explain']);
const ORIGIN = /(?<![\p{L}\p{N}])(?:origin\w*|comes? from|came from|began|begins|started|starts|first|coined|created|traced)(?![\p{L}\p{N}])/iu;

/** How grave the story is: 'death', 'crime', or null. Its title and every outlet sentence shown are read: an opinion is never asked for on such a story. */
function graveOf(d) {
  const told = [d.title, ...d.shown.filter((s) => s.type === 'outlet').map((s) => s.text)].join('\n');
  const family = typeof d.family === 'string' ? d.family : d.family && d.family.key;
  return DEATH.test(told) || family === 'death' ? 'death' : CRIME.test(told) || TN.WRONGDOING.test(told) || WRONG.test(told) ? 'crime' : null;
}

/** Why a kind may not be offered on this story, or null. about: the fact's own words (and the model's instruction), for a meme's origin. */
function kindRefused(d, kind, grave, about = '') {
  if (grave && !GRAVE_KINDS[grave].has(kind)) return `a ${grave} story is offered only ${[...GRAVE_KINDS[grave]].join(' and ')}`;
  if (d.kind !== 'word') return null;
  if (!WORD_KINDS.has(kind)) return 'a sound, format, meme or word is offered only try and take (and explain, for where a meme comes from)';
  if (kind === 'explain' && !(d.sub === 'meme' && ORIGIN.test(about))) return 'only a meme is explained, and only where it comes from';
  return null;
}

/** The instruction a kind stands on when the model's own does not: a word row's explain says where it comes from. */
const stockOf = (d, kind) => (d.kind === 'word' && kind === 'explain' ? 'Explain where it comes from' : KIND[kind].stock);

/** The shown sentences that hold most of a clause's words (a word's line, whose check finds no carrier): indexes into d.shown. */
function holding(d, line) {
  const mine = D.stemsOf(line);
  if (!mine.size) return [];
  const share = d.shown.map((s, i) => { const st = D.stemsOf(s.text); return { i, n: [...mine].filter((x) => st.has(x)).length / mine.size }; }).sort((a, b) => b.n - a.n);
  const held = share.filter((x) => x.n >= WD.SAME_SENTENCE).map((x) => x.i);
  return held.length ? held : share.length && share[0].n > 0 ? [share[0].i] : [];
}
const IGNORED = (f) => (f.rule === 1 && /words, not|characters/.test(f.why)) || f.rule === 11;
/**
 * One clause (a why's, an angle's "about") against every rule of the claim check the card's line meets, less the card's length and
 * its title: { line, failures, src (indexes into d.shown) }. named: the numbers of the shown sentences its parts were copied from (null
 * for one kept from an earlier cycle). The sentences it rests on must be outlets' or pages'.
 */
function judgeClause(d, line, named, { words = ABOUT_WORDS, chars = ANGLE_CHARS } = {}) {
  const r = G.judgeLine(d, line, { named, replyAt: null });
  const failures = r.failures.filter((f) => !IGNORED(f));
  const n = line.split(/\s+/).filter(Boolean).length;
  if (n < words[0] || n > words[1]) failures.push({ rule: 1, why: `${n} words, not ${words[0]} to ${words[1]}` });
  if (line.length > chars) failures.push({ rule: 1, why: `${line.length} characters, over ${chars}` });
  const rests = [...new Set([...r.src, ...(named ? named.map((x) => x - 1) : r.src.length ? [] : holding(d, line))])].filter((i) => i >= 0 && i < d.shown.length);
  if (!rests.length) failures.push({ rule: 5, why: 'no numbered sentence says it' });
  else if (rests.some((i) => !SUPPORT.has(d.shown[i].type))) failures.push({ rule: 5, why: 'it rests on a post or a video title: only an outlet or a page says a fact' });
  const against = contradiction(d, line, rests);
  if (against) failures.push({ rule: 9, why: `sentence ${against.i + 1} says there was no "${against.word}", and the clause does not say so`, answer: against.i });
  return { line, failures, src: rests };
}

// (who says so: a sentence that gives its "no" as somebody's word, "no credible threat, police say")
const SAYS = /^(?:say|says|said|tell|tells|told|according|confirm|confirms|confirmed|state|states|stated)$/;
/**
 * An outlet's sentence that says what a clause tells did not happen, as someone's word: "Canceled concert had 'no credible
 * threat,' says city police" against "... following serious security threat". It is the answer the clause's claim got
 * (P7), kept with it or the clause is not told. { i (index into d.shown), word }, or null. rests: the sentences the clause rests on.
 */
function contradiction(d, line, rests) {
  const own = T.tokensOf(line);
  const unsaid = (toks, j) => toks.slice(Math.max(0, j - 3), j).some((y) => T.NEG_GRAMMAR.has(y.k) || y.nt);
  const subject = new Set(T.tokensOf(d.subject || '').map((t) => t.k));
  const told = new Set(own.filter((t, j) => T.isContent(t) && !t.num && !t.cap && t.k.length >= 4 && !subject.has(t.k) && !T.FREE.has(t.k) && !/(?:ed|ing)$/.test(t.k) && !unsaid(own, j)).map((t) => t.st));
  if (!told.size) return null;
  for (const [i, s] of d.shown.entries()) {
    if (rests.includes(i) || s.type !== 'outlet') continue;
    const toks = T.tokensOf(s.text);
    if (!toks.some((x) => SAYS.test(x.k))) continue;
    for (const [j, x] of toks.entries()) {
      const hit = T.NEG_GRAMMAR.has(x.k) ? toks.slice(j + 1, j + 3).find((y) => told.has(y.st)) : null;
      if (hit) return { i, word: hit.s };
    }
  }
  return null;
}

/** The subject's own denial among the shown sentences, as a part: its newest, in its own words (as the gate finds it), or null. */
function owedOf(d, tools) {
  if (d.kind === 'word') return null;
  return d.shown.map((x, i) => ({ x, i })).filter(({ x }) => x.type === 'outlet' && !/\?\s*["”’']?$/.test(x.text)).map(({ x, i }) => {
    const reply = RP.replyOf(x.text, d.subject);
    const own = tools.sourceText(i + 1);
    if (reply && reply.kind !== 'answer') return { s: i + 1, text: WD.headlineCased(x.text) ? WD.sentenceCased(reply.clause, tools.names) : reply.clause };
    return own && TN.denialClause(x.text, keyOf(d.subject), null, d.subject, 10) ? { s: i + 1, text: own } : null;
  }).find(Boolean) || null;
}

/**
 * The model's parts for one clause, mended the gate's way until one wording passes or none is left: as written when each is a cut of
 * its sentence (else that sentence's own wording); every part in its own sentence's words; "reportedly" where the check asks; the
 * answer a claim got, or the subject's own denial, as a second part; one part left out (never every part the model chose). { ok, line, src (numbers), why (what failed
 * first, when none passed) }. extra: (judged) -> a reason it still may not stand (the why's freshness), or null.
 */
function mended(d, tools, given, { words, chars, extra = () => null }) {
  // (mine: a part the model chose. A wording that keeps none of them is not the model's, whatever else could be made to pass)
  const made = given.map((p) => { const n = tools.fromOf(p); const own = tools.sourceText(n); return { s: n, text: tools.isCut(p.text, n) ? tools.cased(p.text, own) : own, own, mine: true }; })
    .filter((p) => p.text).filter((p, i, all) => all.findIndex((x) => keyOf(x.text) === keyOf(p.text)) === i);
  if (!made.length) return { ok: false, line: null, why: 'no part is a cut of one numbered sentence' };
  const owed = owedOf(d, tools);
  const seen = new Set();
  const queue = [];
  const push = (ps) => { const k = ps.map((p) => p.text).join('|'); if (ps.length && ps.length <= P.ABOUT_PARTS_MAX && ps.every((p) => p.text) && ps.some((p) => p.mine) && !seen.has(k)) { seen.add(k); queue.push(ps); } };
  push(made);
  let first = null;
  for (let i = 0; i < queue.length && i < TRIES_MAX; i++) {
    const ps = queue[i];
    const line = tools.print(ps);
    const r = judgeClause(d, line, ps.map((p) => p.s).filter(Boolean), { words, chars });
    const late = r.failures.length ? null : extra(r);
    if (late) r.failures.push({ rule: 12, why: late });
    if (!first) first = r;
    if (!r.failures.length) return { ok: true, line, src: r.src.map((n) => n + 1), parts: ps.map((p) => p.s), why: null };
    if (ps.some((p) => p.own && p.own !== p.text)) push(ps.map((p) => (p.own ? { ...p, text: p.own } : p)));
    let hedgedParts = ps;
    for (const f of r.failures) {
      const word = f.rule === 8 ? (f.why.match(/hedges "([^"]+)" and the line does not|^"([^"]+)" is stated flat/) || []).slice(1).find(Boolean) : null;
      if (word) hedgedParts = hedgedParts.map((p) => ({ ...p, text: WD.hedged(p.text, word) }));
    }
    if (hedgedParts !== ps) push(hedgedParts);
    for (const f of r.failures.filter((x) => x.rule === 9 && Number.isInteger(x.answer) && x.answer < d.shown.length)) {
      const text = tools.cased(String(d.shown[f.answer].text).replace(/[.!]+$/, ''), null);
      if (text && !ps.some((p) => p.s === f.answer + 1)) push([ps[0], { s: f.answer + 1, text, mine: false }]);
    }
    if (owed && r.failures.some((f) => f.rule === 9 && /carry the subject’s denial/.test(f.why)) && !ps.some((p) => p.s === owed.s)) push([ps[0], { ...owed, mine: false }]);
    if (ps.length > 1) { push([ps[0]]); push([ps[1]]); }
  }
  return { ok: false, line: first ? first.line : null, why: first ? first.failures.map((f) => `rule ${f.rule}: ${f.why}`).join('; ').slice(0, REASON_MAX) : 'nothing to judge' };
}

/**
 * Whether a story's event (an apology, a ban, a breakup, a deal) is one its outlet or page sentences say happened: named in one
 * plainly, not after a "no" or a refusal ("no ban", "refuses to apologize"), not as the thing a denial turns down ("denies breakup
 * rumours"), and in no sentence that tells it as a rumour or somebody's account ("reportedly", "rumours").
 */
function eventSaid(d, t) {
  return d.shown.filter((s) => SUPPORT.has(s.type)).some((s) => {
    const toks = T.tokensOf(s.text);
    if (toks.some((x) => RUMOUR.test(x.k))) return false;
    return toks.some((x, j) => x.st === t.st && !toks.slice(Math.max(0, j - 3), j).some((y) => T.NEG_GRAMMAR.has(y.k) || y.nt)
      && !toks.slice(0, j).some(TURNS_DOWN));
  });
}

/** Why an instruction to film may not stand as the model wrote it, or null: its kind's verbs first, plain filming words, nothing of the story's. */
function doFails(d, kind, text) {
  const what = UNCONTRACTED(String(text || '').trim());
  if (!what) return 'no instruction';
  if (/[?:;“”"‘]|['’](?![a-z])/i.test(what.replace(/[.!?]+$/, ''))) return 'a question, a quotation or a second clause';
  const toks = T.tokensOf(what);
  if (toks.length < DO_WORDS[0] || toks.length > DO_WORDS[1]) return `${toks.length} words, not ${DO_WORDS[0]} to ${DO_WORDS[1]}`;
  if (!KIND[kind].verbs.includes(toks[0].k)) return `a ${kind} angle opens on ${KIND[kind].verbs.slice(0, 4).join(', ')}`;
  const support = d.shown.filter((s) => SUPPORT.has(s.type)).flatMap((s) => T.tokensOf(s.text));
  const said = new Set(support.map((t) => t.st));
  // (a word of the story's own, as loosely as the gate reads a noun: "cancellation" where an outlet says "cancels")
  const loose = new Set(support.filter((t) => t.k.length >= 4).map((t) => t.k.slice(0, 5)));
  // (a word's, a meme's or a sound's own name is the thing itself, never a person: "the Sleepy otter meme")
  const own = d.kind === 'word' ? new Set(T.tokensOf(d.subject || '').map((t) => t.k)) : new Set();
  let phrase = false;
  let owner = false;
  for (const [i, t] of toks.entries()) {
    const after = owner;
    owner = false;
    if (t.num) { if (!(LENGTH.has((toks[i + 1] || {}).k) && t.num.value <= LENGTH_SECONDS_MAX)) return `the number "${t.s}"`; phrase = false; continue; }
    if (own.has(t.k)) continue;
    if (i > 0 && t.cap && !PLATFORM.has(t.k)) return `"${t.s}" is a name`;
    // (after "his", "her" or "their", a thing: a filming word that is a noun, or a thing of the story's own below)
    if (after && FRAME.has(t.k) && !FRAME_NOUN.has(t.k)) return `"${toks[i - 1].s}" is no determiner here: it says who`;
    if ((t.k === 'is' || t.k === 'are') && toks[i + 1] && !IS_SAYS.has(toks[i + 1].k)) return `"${t.k} ${toks[i + 1].s}" says what something is`;
    if (FRAME.has(t.k)) {
      phrase = DETERMINER.has(t.k);
      if (POSSESSIVE.has(t.k)) { if (!toks[i + 1]) return `"${t.s}" is no determiner here: it says who`; owner = true; }
      continue;
    }
    if (MEDIA.has(t.k) && (said.has(t.st) || (d.kind === 'word' && THING.has(t.k)))) continue;
    if (EVENT.has(t.k) && eventSaid(d, t)) continue;
    // (a thing of the story's own, inside "the ...", that is no fact said of anyone: "the incident", "the store's response")
    if (phrase && t.k.length >= 4 && (said.has(t.st) || loose.has(t.k.slice(0, 5))) && !FACT_WORD(t) && !OBJECT.has(t.k)) continue;
    if (EVENT.has(t.k)) return `"${t.s}" is no event the story's outlets say happened`;
    return `"${t.s}" is no plain filming word${MEDIA.has(t.k) ? ' the story\'s own sentences give it' : ''}`;
  }
  return null;
}

/** The instruction as a card prints it: a capital, no stop at the end. */
const doText = (text) => { const s = String(text || '').trim().replace(/[.!?\s]+$/, ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
const angleText = (a) => `${a.do}: ${a.about}`;

/** When a shown sentence came out (epoch ms), by its number; Infinity for none. */
const timeOf = (d, n) => (Number.isInteger(n) && n >= 1 && n <= d.shown.length && d.shown[n - 1].t > 0 ? d.shown[n - 1].t : Infinity);
/**
 * Whether a timeline's parts (the numbers of the sentences they tell) are a timeline: two or more, each from a dated sentence, every
 * one on a later day than the one before. One fact, or two of the same day, is no timeline ("concert at the other stadium canceled"
 * under a line about another stadium reads as a correction, not as what came first).
 */
function inOrder(d, parts) {
  const days = (parts || []).map((n) => timeOf(d, n)).map((t) => (Number.isFinite(t) ? Math.floor(t / DAY_MS) : NaN));
  return days.length >= 2 && days.every((x, i) => Number.isFinite(x) && (i === 0 || x > days[i - 1]));
}
/** The sentence each printed part of a kept clause comes from (its number, or null): a kept angle carries no parts of its own. */
const partsOf = (d, text) => String(text).replace(/\.$/, '').split(/;\s+/).map((part) => { const h = holding(d, part); return h.length ? h[0] + 1 : null; });

/**
 * The why and the angles of one reply (prompt.js `parseCard`), each held to the check. Returns { why: { text, src } | null, angles:
 * [{ kind, do, about, src }], counts: { whys, whysPassed, angles (judged), anglesPassed, dosKept (the model's own instruction stood),
 * anglesRepeated (a kind or a fact another angle had: left out, not judged) }, refused: [{ what, text, why }] }. tools: the
 * dossier's wording tools (lib/editor/wording.js `wordingOf`), when the caller has them.
 */
function ideasOf(card, d, { nowMs = NaN, lex = null, tools = null } = {}) {
  const counts = { whys: 0, whysPassed: 0, angles: 0, anglesPassed: 0, dosKept: 0, anglesRepeated: 0 };
  const refused = [];
  if (!card || !d) return { why: null, angles: [], counts, refused };
  const wording = tools || WD.wordingOf(d, lex);
  const fresh = (r) => (!Number.isFinite(nowMs) ? 'no clock to say what is new' : r.src.some((i) => nowMs - d.shown[i].t <= WHY_FRESH_MS) ? null : 'no sentence it rests on is of the last 7 days');
  let why = null;
  if (Array.isArray(card.why) && card.why.length) {
    counts.whys = 1;
    const r = mended(d, wording, card.why, { words: WHY_WORDS, chars: WHY_CHARS, extra: fresh });
    if (r.ok) { why = { text: r.line, src: r.src }; counts.whysPassed = 1; } else refused.push({ what: 'why', text: r.line, why: r.why });
  }
  const grave = graveOf(d);
  const angles = [];
  // (counted: each angle the check judged. One of a kind already offered, or of a fact another angle tells, is a repeat: left out,
  // and counted apart, `anglesRepeated`, since the check never refused it)
  for (const a of (card.angles || []).slice(0, P.ANGLES_MAX)) {
    const no = (why) => refused.push({ what: `angle ${a.kind}`, text: `${a.do}: ${a.about.map((p) => p.text).join('; ')}`, why });
    if (!KIND[a.kind]) { counts.angles += 1; no('no such kind'); continue; }
    if (angles.some((x) => x.kind === a.kind)) { counts.anglesRepeated += 1; no('a kind already offered'); continue; }
    counts.angles += 1;
    const said = `${a.do} ${a.about.map((p) => p.text).join(' ')}`;
    const notHere = kindRefused(d, a.kind, grave, said);
    if (notHere) { no(notHere); continue; }
    // (a timeline is told oldest first: its parts in the order their sentences came out)
    const about = a.kind === 'timeline' ? [...a.about].sort((x, y) => timeOf(d, x.s) - timeOf(d, y.s)) : a.about;
    const own = !doFails(d, a.kind, a.do);
    const stock = stockOf(d, a.kind);
    // (the room the fact has: an instruction of the model's own that runs the angle long gives way to the kind's shorter one)
    const r = mended(d, wording, about, { words: ABOUT_WORDS, chars: ANGLE_CHARS - Math.min(own ? doText(a.do).length : stock.length, stock.length) - 2 });
    if (!r.ok) { no(r.why); continue; }
    // (one fact, or facts of one day, is no timeline: explained instead, where explain may be offered and is not offered already)
    let kind = a.kind;
    if (kind === 'timeline' && !inOrder(d, r.parts)) {
      if (kindRefused(d, 'explain', grave, said) || angles.some((x) => x.kind === 'explain')) { no('a timeline tells two things of different days, oldest first'); continue; }
      kind = 'explain';
    }
    const kept = kind === a.kind && own && doText(a.do).length + 2 + r.line.length <= ANGLE_CHARS;
    const what = kept ? doText(a.do) : stockOf(d, kind);
    if (angles.some((x) => keyOf(x.about) === keyOf(r.line))) { counts.angles -= 1; counts.anglesRepeated += 1; no('the same fact as another angle'); continue; }
    angles.push({ kind, do: what, about: r.line, src: r.src });
    counts.anglesPassed += 1;
    if (kept) counts.dosKept += 1;
  }
  return { why, angles, counts, refused };
}

/**
 * A kept card's why and angles on the story as it is now (lib/editor/index.js `decide`): each as it was written, judged again by
 * every rule (a denial newly in hand, a hedge, a story that has turned grave, an instruction the check now refuses, a timeline that
 * is one fact; a why that is no longer of the last 7 days), and left out when it no longer passes. Returns { why, angles }.
 */
function standing(card, d, { nowMs = NaN } = {}) {
  const why = card && card.why && typeof card.why.text === 'string' ? card.why : null;
  const kept = card && Array.isArray(card.angles) ? card.angles.filter((a) => a && KIND[a.kind] && typeof a.do === 'string' && typeof a.about === 'string') : [];
  const whyStands = why && (() => {
    const r = judgeClause(d, why.text, null, { words: WHY_WORDS, chars: WHY_CHARS });
    return !r.failures.length && Number.isFinite(nowMs) && r.src.some((i) => nowMs - d.shown[i].t <= WHY_FRESH_MS);
  })();
  const grave = graveOf(d);
  const angles = kept.filter((a) => !kindRefused(d, a.kind, grave, `${a.do} ${a.about}`) && (a.do === stockOf(d, a.kind) || !doFails(d, a.kind, a.do))
    && !judgeClause(d, a.about, null, { chars: ANGLE_CHARS - a.do.length - 2 }).failures.length && (a.kind !== 'timeline' || inOrder(d, partsOf(d, a.about))));
  return { why: whyStands ? why : null, angles };
}

/**
 * What the feed publishes of a card's why and angles (D4), the instruction and the fact kept apart for the detail to print (it knows
 * the row's line and why lines, which a fact may only say again: `angleFor`): { why: the line with no stop at its end, or null;
 * angles: [{ kind, do, about }] }.
 */
function publishedOf(card) {
  const why = card && card.why && typeof card.why.text === 'string' ? card.why.text.replace(/\.$/, '') : null;
  const angles = (card && Array.isArray(card.angles) ? card.angles : []).filter((a) => a && KIND[a.kind] && typeof a.do === 'string' && typeof a.about === 'string')
    .map((a) => ({ kind: a.kind, do: a.do, about: a.about })).filter((a) => angleText(a).length <= ANGLE_CHARS).slice(0, P.ANGLES_MAX);
  return { why: why && why.length <= WHY_CHARS ? why : null, angles };
}

// a fact the sheet already tells this much of (its words, hedges, quotes and punctuation aside) is not told again under it
const TOLD_SHARE = 0.7;
// a why the row's own line already tells this much of gives way to the line
const WHY_TOLD_SHARE = 0.8;
/**
 * How much of a clause's words one of `texts` already says, 0 to 1: its content words as stems, "reportedly", "allegedly" and
 * "reports say" aside, so a hedge moved or a quote mark dropped is the same sentence ("Mara Voss reportedly called ..." and
 * "Mara Voss called ..., reports say").
 */
function toldShare(clause, texts) {
  const mine = D.stemsOf(clause);
  if (!mine.size) return 1;
  return Math.max(0, ...(texts || []).filter((t) => typeof t === 'string' && t).map((t) => { const st = D.stemsOf(t); return [...mine].filter((x) => st.has(x)).length / mine.size; }));
}
/**
 * One angle as the detail prints it (D4 `angles[]`): "<do>: <about>", or its instruction alone when the sheet already tells every
 * part of its fact (`said`: the row's line and its why lines): the fact said a second or third time under the line is clutter, and
 * the video to film is still worth showing. { text, kind }. An angle a row carried before the two were kept apart is as it was.
 */
function angleFor(a, said) {
  if (typeof a.do !== 'string' || typeof a.about !== 'string') return typeof a.text === 'string' ? { text: a.text, kind: a.kind } : null;
  const parts = a.about.replace(/\.$/, '').split(/;\s+/).filter(Boolean);
  return { text: parts.every((p) => toldShare(p, said) >= TOLD_SHARE) ? a.do : angleText(a), kind: a.kind };
}

module.exports = { ideasOf, standing, publishedOf, judgeClause, doFails, graveOf, angleText, angleFor, toldShare, inOrder, KIND, FRAME, OBJECT, MEDIA, EVENT, WHY_FRESH_MS, ANGLE_CHARS, WHY_CHARS, TOLD_SHARE, WHY_TOLD_SHARE };
