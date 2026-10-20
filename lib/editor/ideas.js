'use strict';
/*
 * The why and the angles (ios/IDEAS-SUPER.md P12; ios/IDEAS-FEED.md P7): what an editor's card adds for a creator. The model writes
 * them with the card (lib/editor/prompt.js); here each is held to the claim check exactly as the card's line is, or left out:
 *   why       why it is talked about now: one clause (two when a claim it tells was answered) of the story's newest development,
 *             from an outlet or page sentence of the last 7 days in its own words (a cut of it, else its rule-built wording), with
 *             "reportedly" and the answer a claim got where the check asks for them, passing every rule of the claim check on the
 *             shown sentences and on the story behind them (lib/editor/gate.js `judgeLine`). The card's length and its title are the
 *             card's own business, not the why's
 *   an angle  { kind, do, about }: what a creator could film today, and what it is about. "do" is the video in one instruction that
 *             stands alone on the sheet (P12 quality, 2026-10-20: "Explain the situation in a minute" told a creator nothing): it opens
 *             on its kind's own verbs, says how to film it ("in a minute", "on camera"), and names the story's subject and the
 *             reported fact with who reports, says or alleges it ("Break down what Tobin Hale alleges about $40,000 in pay, and Mara
 *             Voss's denial"). It is held to the claim check's own reading (`doFails`): every name one the story's outlet or page
 *             sentences or its line print; every other word a filming word or one of those sentences' own; a claim, a crime, a death
 *             or anything the sentences only report, hedge or deny is said as somebody's ("what X alleges about ...", "the theft
 *             claims"), never as a fact; whoever is said to say, allege, report or deny something is one the sentences show doing
 *             it, and a name is said to have done what a sentence says it did; the answer a claim got goes with it ("and her
 *             denial"); no he or she, no number but a length or one the sentences give, nothing turned round. The model's own
 *             instruction stands when it passes and names the story; else one is made from the fact it chose (`composedDo`: "Explain
 *             in a minute what Dexerto reports about the Mara Voss allegations, and the denial"), else the kind's plain one. "about"
 *             is the fact, held as a why is (any age), the answer it got kept with it (an official's "no credible threat" included).
 *             An opinion is the creator's: a story that tells a crime, violence, abuse or another wrongdoing (misconduct, pay
 *             withheld) is offered only explain and timeline, a death only timeline; a sound, a format, a meme or a word only try and
 *             take, and explain for where a meme comes from. A timeline is two facts or more of different days, oldest first, or it
 *             is explained instead. The angles are ranked: one the model made specific first, a made one next, a plain one last
 * Published (`publishedOf`), the instruction and the fact stay apart: the detail prints the fact after the instruction only where
 * its row's line and why lines do not already tell it and the two fit (`angleFor`).
 * Kept from an earlier cycle, each is judged again on the story as it is now (`standing`), as a kept card's line is. Nothing here
 * is a name or a story: the vocabulary is of filming and of saying who says so, and every fact is the sources'.
 * Pure: no clock (now is handed in), no I/O.
 */
const T = require('../line-text');
const TN = require('../../engine/talk-nouns');
const RP = require('../line-replies');
const P = require('./prompt');
const D = require('./dossier');
const G = require('./gate');
const WD = require('./wording');
const W = require('../../engine/wording');
const { keyOf } = require('../util');

const DAY_MS = 86400e3;
const WHY_FRESH_MS = 7 * DAY_MS;
const WHY_WORDS = [4, 30];
const ABOUT_WORDS = [4, 30];
// (the feed's own caps: a why line and an angle are 160 characters at most, ios/IDEAS-FEED.md D4)
const WHY_CHARS = 160;
const ANGLE_CHARS = 160;
// an instruction stands alone on the sheet when its fact is told above it or does not fit beside it
const DO_WORDS = [2, 24];
const DO_CHARS = 140;
const LENGTH_SECONDS_MAX = 90;
const TRIES_MAX = 12;
const REASON_MAX = 300;
// (what may say a fact: a headline or a reference page. A post's or a video's title proves nothing, P2)
const SUPPORT = new Set(['outlet', 'page']);
// how far back from a verb of saying its speaker may stand ("Ex-editor Tobin Hale alleges"), and from a verb the one who did it
const SPEAKER_SPAN = 6;
const AGENT_SPAN = 4;
const OUTLET_CHARS = 40;
// how far past "denies" or "refuses" what it turns down reaches, and the words that end it ("... in new stream", "... at the show")
const TURNED_SPAN = 4;
const SCENE = new Set(['in', 'on', 'at', 'during', 'after', 'while', 'as', 'amid', 'following', 'before', 'since', 'because', 'when', 'from']);
// an angle's rank: the model's own instruction that names the story, one made from its fact, the kind's plain instruction
const RANK = { own: 2, made: 1, plain: 0 };

// each kind: the verbs its instruction opens on, and the plain instruction that stands when no other does
const KIND = {
  explain: { verbs: ['explain', 'break', 'green', 'sum', 'walk', 'show', 'unpack', 'split', 'clear'], stock: 'Explain it in a minute' },
  react: { verbs: ['react', 'stitch', 'duet', 'watch', 'film'], stock: 'React to it on camera' },
  take: { verbs: ['give', 'share', 'pick', 'say', 'tell', 'rate', 'weigh'], stock: 'Give your take on it' },
  ask: { verbs: ['ask', 'poll', 'let', 'get', 'start'], stock: 'Ask your viewers what they think' },
  timeline: { verbs: ['tell', 'list', 'lay', 'recap', 'walk', 'go', 'show', 'put', 'run'], stock: 'Tell it in order, oldest first' },
  try: { verbs: ['try', 'film', 'make', 'recreate', 'do', 'join', 'use', 'show', 'put', 'take'], stock: 'Try it yourself' },
};
// the words an instruction to film is made of: how to film it, who watches, a creator's own opinion, and who says so. None tells a
// fact of the story by itself (no "not", no "real", no "wrong", no "confirmed" or "is over"), none is first person
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
  'situation incident update details key moments timeline might could his her trending ',
  'report reports according tells told fans fan reacted reacts responded response responses answered reply replied filmed began begins came ',
  'started starts made makes behind against between doing getting predict prediction predictions breakdown versions remake',
].join('').split(' ').filter(Boolean), ...Object.values(KIND).flatMap((k) => k.verbs)]);
// (a word an instruction never says: who, without a name; what was done, unless somebody is said to say so)
const PRONOUN_SAYS = new Set(['he', 'she', 'him', 'hers', 'himself', 'herself']);
const DONE = new Set(['did', 'does', 'done']);
// (a possessive is a determiner and nothing else: a noun follows it. "React to her" says who; "her side", "their take" do not)
const POSSESSIVE = new Set(['his', 'her', 'their']);
// the filming words that are things, and may follow a possessive
const FRAME_NOUN = new Set(('side sides story take takes opinion version words point points part reaction moment moments headline headlines '
  + 'facts thing things way ways time update details timeline summary situation incident response responses reply report').split(' '));
// what "is" or "are" may say in an instruction: that it is trending or happening, never what someone or something is ("it is over",
// "they are out"). The creator's own "you are" is no claim
const IS_SAYS = new Set(['trending', 'happening', 'about', 'going']);
// (a pronoun's "'s" or "'re" is "is": "it's over" is "it is over")
const UNCONTRACTED = (text) => String(text).replace(/(?<![\p{L}\p{N}])(it|they|he|she|that|this|what|who|there|we|you)['’](s|re)(?![\p{L}\p{N}])/giu, (m, w, c) => `${w} ${c.toLowerCase() === 're' ? 'are' : 'is'}`);
// the things a story is told through: an instruction may point at one when the story's own outlet or page sentences name it
const MEDIA = new Set(('clip clips video videos post posts photo photos picture pictures song songs sound audio dance meme memes trend '
  + 'challenge filter format game app episode trailer interview stream livestream podcast series movie film show book album tour match '
  + 'lyrics performance speech scene moment outfit recipe product edit look').split(' '));
// the things a story is made of that are themselves facts: one is pointed at only when an outlet or a page says it happened, plainly
// (not "no apology", not "denies breakup rumours", not "reportedly reach a deal"), or as somebody's account of it
const EVENT = new Set('apology lawsuit ban breakup deal contract feud rant clapback statement reply response announcement'.split(' '));
const OBJECT = new Set([...MEDIA, ...EVENT]);
// (what makes a sentence's thing a rumour or somebody's account rather than a thing that happened)
const RUMOUR = /^(?:rumou?r\w*|speculat\w*|reportedly|allegedly|alleged|unconfirmed|purported\w*)$/;
// (and the words that turn it down: "denies", "disputes", "refuses to apologize", "declines to comment")
const TURNS_DOWN = (t) => T.DENIES.test(t.k) || /^(?:refus|declin)/.test(t.k);
// who says so: a word that makes what follows it somebody's account. A claim, a crime or a death in an instruction comes after one
// ("calls the owner a liar" is the caller's account too: who calls whom what is held to the sentences by the doer's check below)
const CALLS = /^(?:calls?|called|calling)$/;
const REPORTED = /^(?:alleg\w*|accus\w*|claim\w*|says?|said|tells?|told|reports?|reported|reportedly|allegedly|according|rumou?r\w*|speculat\w*|den(?:y|ies|ied|ial|ials|ying)|disput\w*|reject\w*|refut\w*|calls?|called|calling)$/;
// (the hedges an instruction may always say: they assert nothing)
const HEDGE_WORD = /^(?:reportedly|allegedly|purportedly)$/;
// a noun that makes the words just before it somebody's claim: "the pay allegations", "theft claims", "breakup rumours"
const CLAIM_NOUN = /^(?:allegations?|accusations?|claims?|rumou?rs?|reports?|speculation|lawsuits?|complaints?)$/;
// the words an answer is told with: a denial, a response, a side
const ANSWER = /^(?:den(?:y|ies|ied|ial|ials|ying)|disput\w*|reject\w*|refut\w*|rebut\w*|dismiss\w*|respon\w+|answer\w*|repl(?:y|ies|ied)|side|sides)$/;
// the verbs of saying, by family: whoever an instruction says says, reports, alleges, denies or answers something is one the
// sentences show doing it
const SPEAKS = [['say', /^(?:says?|said|tells?|told)$/], ['report', /^(?:reports?|reported)$/], ['claim', /^(?:alleg\w*|accus\w*|claims?|claimed|claiming)$/],
  ['deny', /^(?:den(?:y|ies|ied|ial|ials|ying)|disput\w*|reject\w*|refut\w*)$/], ['answer', /^(?:respon\w+|answer\w*|repl(?:y|ies|ied))$/]];
const familyOf = (k) => (SPEAKS.find(([, re]) => re.test(k)) || [null])[0];
// (a noun of saying names its speaker only by a possessive: "Hale's allegations" are Hale's, "the Mara Voss allegations" are about her)
const SAYING_NOUN = /^(?:\w+ations?|denials?|report|response|responses|reply|answer|claim)$/;
// people no source has to name: "reports say", "fans react"
const ANYONE = new Set(['reports', 'report', 'media', 'outlets', 'fans', 'fan', 'viewers', 'people', 'internet', 'critics', 'users']);
// a clause of an instruction begins after a comma or on one of these: a "says" reaches no further
const CLAUSE_WORD = new Set(['why', 'how', 'then', 'but', 'while', 'when', 'after', 'before', 'because', 'since', 'so']);
// a sentence told as somebody's at its end: "..., network says", "... 'no credible threat,' says city police"
const TAIL_SAYS = /^(?:says?|said|tells?|told|reports?|according)$/;
const QUESTION = /\?\s*["”’']?$/;
// the platforms a creator posts on, the one capital an instruction may hold that no sentence prints
const PLATFORM = new Set(['tiktok', 'youtube', 'reels', 'shorts']);
// what a word's, a meme's or a sound's own row is: always there to point at
const THING = new Set(['meme', 'memes', 'trend', 'sound', 'audio', 'song', 'challenge', 'format', 'filter', 'dance', 'edit', 'clip', 'video', 'game', 'app']);
const LENGTH = new Set(['second', 'seconds', 'minute', 'minutes']);
// a story with a death in it is told in order or not at all; one with a crime, violence or abuse is only explained or told in order
const DEATH = /(?<![\p{L}\p{N}])(?:dies|died|dead|death|deaths|killed|passed away|obituary|funeral|tribute|overdose|suicide|memorial)(?![\p{L}\p{N}])/iu;
const CRIME = /(?<![\p{L}\p{N}])(?:arrest\w*|charged|charges|jail\w*|prison|sentenc\w*|convict\w*|guilty|police|murder\w*|shot dead|mass shooting|gunman|gunfire|opened fire|stabb\w*|assault\w*|abus\w*|rap(?:e|ed|es|ist)|groom\w*|harass\w*|traffick\w*|kidnap\w*|violen\w*)(?![\p{L}\p{N}])/iu;
// (and the accusations of wrongdoing that are no crime word: misconduct, money owed and kept, theft by another name)
const WRONG = /(?<![\p{L}\p{N}])(?:misconduct|embezzl\w*|extort\w*|blackmail\w*|scamm\w*|steal\w*|stolen|stole|theft|fraud\w*|withh(?:e|o)ld\w*\s+(?:\S+\s+){0,3}?(?:pay|wages?|salar\w*|payments?|money|earnings|royalt\w*)|unpaid\s+(?:\S+\s+){0,2}?(?:wages?|pay|invoices?|staff|editors?|workers?))(?![\p{L}\p{N}])/iu;
// (a word of these, by itself: never said of anyone as a fact in an instruction)
const WRONG_WORD = /^(?:misconduct|embezzl\w*|extort\w*|blackmail\w*|scamm\w*|steal\w*|stolen|stole|theft|fraud\w*|withh(?:e|o)ld\w*|unpaid)$/;
const GRAVE_KINDS = { death: new Set(['timeline']), crime: new Set(['explain', 'timeline']) };
// a sound's, a format's, a meme's or a word's row: done, or given a take on; explained only where a meme comes from; never a timeline
const WORD_KINDS = new Set(['try', 'take', 'explain']);
// (a past tense the claim check's own verb test does not know: "Voss withheld", "Hale stole")
const PAST = /^(?:withheld|held|stole|stolen|took|gave|made|sent|paid|kept|left|lost|won|broke|wrote|spoke|threw|hit|beat|quit|sold|bought|fought|caught|brought|fled|led|met|ran|came|went|saw|knew|drove|wore|hid|bit|shot|cut|put|shut|struck)$/;
const verbLike = (t) => T.isVerbish(t) || PAST.test(t.k);
const ORIGIN = /(?<![\p{L}\p{N}])(?:origin\w*|comes? from|came from|began|begins|started|starts|first|coined|created|traced)(?![\p{L}\p{N}])/iu;

/** How grave a text is by its words: 'death', 'crime' (a crime, violence, abuse or another wrongdoing), or null (lib/entity/graph.js reads it too). */
const graveTextOf = (text) => (DEATH.test(text) ? 'death' : CRIME.test(text) || TN.WRONGDOING.test(text) || WRONG.test(text) ? 'crime' : null);
/** How grave the story is: 'death', 'crime', or null. Its title and every outlet sentence shown are read: an opinion is never asked for on such a story. */
function graveOf(d) {
  const told = [d.title, ...d.shown.filter((s) => s.type === 'outlet').map((s) => s.text)].join('\n');
  const family = typeof d.family === 'string' ? d.family : d.family && d.family.key;
  return family === 'death' ? 'death' : graveTextOf(told);
}

/** Why a kind may not be offered on this story, or null. about: the fact's own words (and the model's instruction), for a meme's origin. */
function kindRefused(d, kind, grave, about = '') {
  if (grave && !GRAVE_KINDS[grave].has(kind)) return `a ${grave} story is offered only ${[...GRAVE_KINDS[grave]].join(' and ')}`;
  if (d.kind !== 'word') return null;
  if (!WORD_KINDS.has(kind)) return 'a sound, format, meme or word is offered only try and take (and explain, for where a meme comes from)';
  if (kind === 'explain' && !(d.sub === 'meme' && ORIGIN.test(about))) return 'only a meme is explained, and only where it comes from';
  return null;
}
/**
 * The kinds a story may be offered, as the dossier tells the model (lib/editor/prompt.js `storyText`): "explain, timeline (a story
 * of a crime, abuse or wrongdoing)". A talking point is not offered try; a meme's explain is for where it comes from.
 */
function kindsLine(d) {
  const grave = graveOf(d);
  if (grave === 'death') return 'timeline (a story of a death)';
  if (grave === 'crime') return 'explain, timeline (a story of a crime, abuse or wrongdoing)';
  if (d.kind === 'word') return d.sub === 'meme' ? 'try, take, explain (where it comes from)' : 'try, take';
  return 'explain, react, take, ask, timeline';
}

/** The instruction a kind stands on when no other does: a word row's explain says where it comes from. */
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
  return d.shown.map((x, i) => ({ x, i })).filter(({ x }) => x.type === 'outlet' && !QUESTION.test(x.text)).map(({ x, i }) => {
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

/** An outlet's name as a creator would say it: "ABC News - Breaking News" is ABC News, "People.com" is People; null for none fit to name. */
function outletName(outlet) {
  const s = String(outlet || '').replace(/\s+on MSN$/i, '').split(/\s+[-|–—]\s+/)[0].replace(/\.(?:com|co\.uk|net|org)$/i, '').trim();
  return s && s.length <= OUTLET_CHARS && /\p{L}/u.test(s) && !/[:;?"“”]/.test(s) ? s : null;
}
// a word's keys: its stem, and its first five letters for a word of four or more ("cancellation" where an outlet says "cancels")
// (and its stem's stem: "took" is "take", which meets "takes")
const keysOf = (t) => [...new Set([t.st, T.stemOf(t.st)]), ...(t.k.length >= 4 ? [`~${t.k.slice(0, 5)}`] : [])];
const anyKey = (set, t) => keysOf(t).some((k) => set.has(k));
// (a word that tells a claim, a crime, a wrongdoing or a death by itself: never said of anyone as a fact)
const graveWord = (t) => ['record', 'guilt', 'report'].includes(T.claimClass(t.k)) || WRONG_WORD.test(t.k) || DEATH.test(t.s) || CRIME.test(t.s) || TN.WRONGDOING.test(t.s);

// the words before a verb that make its subject the one it was done to: "Calder was dropped", "Voss got banned"
const BE = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'get', 'gets', 'got', 'gotten', 'getting']);
// the words after a past participle that make a headline's verb a passive one, its "was" left out: "Mara Voss fired from
// Harbor Lights", "Rook Calder dropped by label", "Tobin Hale charged after ..."
const PASSIVE_NEXT = new Set(['by', 'from', 'after', 'over', 'for', 'as', 'in', 'at', 'during', 'amid', 'following', 'with', 'on', 'before', 'since', 'until', 'despite', 'due', 'ahead']);
// (an adverb a doer may stand before its verb with: "Mara Voss reportedly withheld", "Calder publicly calls")
const isAdverb = (t) => !t.cap && t.k.length > 4 && /ly$/.test(t.k);
/** Whether the verb at j is said as done TO its subject: followed by "by", or a past participle a headline's passive leaves bare. */
function passiveAt(toks, j) {
  const next = toks[j + 1];
  if (next && next.k === 'by') return true;
  const participle = /ed$/.test(toks[j].k) || PAST.test(toks[j].k);
  return participle && (!next || PASSIVE_NEXT.has(next.k));
}
/**
 * Who a sentence says did the verb at j (proper: the words the sentences print as names): the names straight before it, an adverb
 * between them allowed ("Mara Voss withheld", "Juno Pell and Rook Calder cancel", "Rook Calder, Juno Pell cancel"). Nobody when the sentence
 * says it was done to them ("Rook Calder dropped by label", "Calder was dropped", "Mara Voss fired from Harbor Lights"), when the word
 * before it is no name (the name only qualifies a noun: "Rook Calder, Juno Pell concert at Velmor Stadium canceled"), or when a comma
 * stands between (a second verb's doer is the first verb's: storyLex). [the doers' keys].
 */
function doersOf(toks, j, proper) {
  if (passiveAt(toks, j)) return [];
  let b = j - 1;
  if (b < 0 || /[,;:]/.test(toks[b].post)) return [];
  while (b >= 0 && isAdverb(toks[b])) b -= 1;
  if (b < 0 || BE.has(toks[b].k)) return [];
  const named = (y) => !y.poss && (proper.has(y.k) || (y.cap && !T.STOP.has(y.k)));
  const out = [];
  while (b >= 0) {
    const y = toks[b];
    if (named(y)) { out.push(y.k); b -= 1; continue; }
    // ("Juno Pell and Rook Calder": a name joined to the one after it)
    if ((y.k === 'and' || y.k === '&') && out.length && b > 0 && named(toks[b - 1])) { b -= 1; continue; }
    break;
  }
  return out;
}

/**
 * What the story's outlet and page sentences and its line say, read once a dossier: the words they print (by stem and by their first
 * five letters), their names, the words they say plainly somewhere and those they only report, hedge or turn down, who they show
 * saying what (`spoke`: "hale|claim") and doing what (`agent`: "voss|withheld"), their numbers and negations, and whether the accused
 * side's answer is in hand.
 */
const LEXES = new WeakMap();
function storyLex(d) {
  const hit = LEXES.get(d);
  if (hit) return hit;
  const support = d.shown.filter((s) => SUPPORT.has(s.type));
  const sents = [...support.map((s) => s.text), ...(d.headline ? [d.headline] : [])].map((text) => ({ text, toks: T.tokensOf(text) }));
  const outlets = [...new Set(support.map((s) => outletName(s.outlet)).filter(Boolean))];
  const outletKeys = new Set(outlets.flatMap((o) => T.tokensOf(o).map((t) => t.k)));
  const subjectKeys = new Set(T.tokensOf(d.subject || '').map((t) => t.k));
  const words = new Set();
  const names = new Set([...subjectKeys, ...outletKeys]);
  const flat = new Set();
  const held = new Set();
  const turned = new Set();
  const spoke = new Set();
  const agent = new Set();
  const negated = new Set();
  const numbers = [];
  // (how many sentences say a word plainly: an act on record is said flat as the claim check says it, by two and denied by none)
  const flatIn = new Map();
  // (the words the sentences print as names: in a sentence-case sentence by its capitals, in a Title Case one those known as names)
  const proper = new Set([...subjectKeys, ...outletKeys]);
  for (const pass of [false, true]) for (const { toks } of sents) { if (T.isTitleCase(toks) !== pass) continue; for (const j of T.nameIndexes(toks, proper)) proper.add(toks[j].k); }
  for (const { text, toks } of sents) {
    const plainHere = new Set();
    // (the doers of the sentence's first verb, for a second verb after a comma: "Juno Pell Responds to Brooklyn Store, Calls Owner ...")
    const first = toks.findIndex((y, p) => p > 0 && verbLike(y) && !T.STOP.has(y.k) && !proper.has(y.k) && !y.cap);
    const firstAt = first >= 0 ? first : toks.findIndex((y, p) => p > 0 && verbLike(y) && !T.STOP.has(y.k) && !proper.has(y.k));
    const firstDoers = firstAt > 0 ? doersOf(toks, firstAt, proper) : [];
    // (told as somebody's at its end, ", network says": every word before the comma is that speaker's account)
    const comma = toks.map((t, j) => (/[,，]/.test(t.post) ? j : -1)).filter((j) => j >= 0).pop();
    const tail = comma !== undefined && toks.length - comma - 1 <= 5 && toks.slice(comma + 1).some((t) => TAIL_SAYS.test(t.k)) ? comma + 1 : toks.length;
    const whole = QUESTION.test(text);
    toks.forEach((t, j) => {
      for (const k of keysOf(t)) words.add(k);
      names.add(t.k);
      if (t.num) numbers.push(t.num);
      const before = toks.slice(0, j);
      // (what a denial or a refusal turns down is its object, not the rest of the sentence: "denies the claims | in new stream")
      const down = before.map((y, p) => (TURNS_DOWN(y) ? p : -1)).filter((p) => p >= 0).pop();
      const object = down !== undefined && j - down <= TURNED_SPAN && !toks.slice(down + 1, j).some((y) => SCENE.has(y.k) || /[,;:]/.test(y.post)) && !SCENE.has(t.k);
      const isTurned = before.slice(-3).some((y) => T.NEG_GRAMMAR.has(y.k) || y.nt) || object || RUMOUR.test(t.k);
      const isHeld = whole || j < tail && tail < toks.length || before.some((y) => REPORTED.test(y.k)) || toks.slice(j + 1, j + 3).some((y) => CLAIM_NOUN.test(y.k));
      for (const k of keysOf(t)) (isTurned ? turned : isHeld ? held : flat).add(k);
      if (!isTurned && !isHeld) for (const k of keysOf(t)) plainHere.add(k);
      if (T.NEG_GRAMMAR.has(t.k) || t.nt) for (const y of toks.slice(j + 1, j + 3)) for (const k of keysOf(y)) negated.add(k);
      const fam = familyOf(t.k);
      if (fam) {
        // (who stands before a verb of saying, back to another such verb or a comma; and after a "says" at the end, "says city police")
        for (let b = j - 1; b >= 0 && b >= j - SPEAKER_SPAN; b--) { if (familyOf(toks[b].k) || /[,;:]/.test(toks[b].post)) break; spoke.add(`${toks[b].k}|${fam}`); }
        if (j >= tail) for (const y of toks.slice(j + 1)) spoke.add(`${y.k}|${fam}`);
      } else if (!T.STOP.has(t.k) && verbLike(t)) {
        // (who did it: the names the sentence puts straight before the verb as its doer, never a name that only qualifies a noun, one
        // before a "was", or one before "dropped by")
        for (const y of doersOf(toks, j, proper)) for (const k of keysOf(t)) agent.add(`${y}|${k}`);
        // (a headline's second verb after a comma has its first one's doer: "Juno Pell Responds to Brooklyn Store, Calls Owner ...",
        // when that first verb has one: "Juno Pell, Rook Calder concert to be held in Denver, canceled" says nobody canceled it)
        if (j > 0 && /,/.test(toks[j - 1].post) && j !== firstAt && !passiveAt(toks, j)) for (const y of firstDoers) for (const k of keysOf(t)) agent.add(`${y}|${k}`);
      }
    });
    for (const k of plainHere) flatIn.set(k, (flatIn.get(k) || 0) + 1);
  }
  for (const k of outletKeys) { spoke.add(`${k}|say`); spoke.add(`${k}|report`); }
  // (the accused side answered: a denial, a dispute or a reply of the subject's in an outlet's sentence)
  const answerInHand = d.kind !== 'word' && support.some((s) => s.type === 'outlet' && !QUESTION.test(s.text) && (!!RP.replyOf(s.text, d.subject) || !!TN.denialClause(s.text, keyOf(d.subject), null, d.subject, 10)));
  const denial = sents.some(({ toks }) => toks.some((t) => T.DENIES.test(t.k)));
  const lex = { outlets, outletKeys, subjectKeys, proper, words, names, flat, flatIn, held, turned, spoke, agent, negated, numbers, answerInHand, denial };
  LEXES.set(d, lex);
  return lex;
}

/** A token that is a name in an instruction: a capital past its first word, a capital inside it ("varoTessin"), or the subject's own. */
const nameLike = (L, y, b) => (b > 0 && y.cap) || /\p{Lu}/u.test(y.s.slice(1)) || L.subjectKeys.has(y.k);
/**
 * Whether whoever an instruction says says, reports, alleges, denies or answers something is one the sentences show doing so: the
 * names just before the verb ("what Tobin Hale alleges", "Hale's pay claims"), or for saying, reporting and answering a plain word
 * just before it ("what the network says"). A noun of saying names its speaker only by a possessive. A reason, or null.
 */
function speakerFails(L, toks, i) {
  const t = toks[i];
  const fam = familyOf(t.k);
  const run = [];
  let plain = null;
  for (let b = i - 1; b >= 0 && b >= i - 4; b--) {
    const y = toks[b];
    if (familyOf(y.k) || /[,;]/.test(y.post)) break;
    if (nameLike(L, y, b) || (y.poss && !POSSESSIVE.has(y.k))) { run.push(y); continue; }
    if (run.length) break;
    if (y.k === 'the' && b === i - 1) continue;
    if (FRAME.has(y.k) || T.STOP.has(y.k)) break;
    // ("the network says": a plain word just before it; "pay claims" is what is claimed, not who claims it)
    if (plain === null && b >= i - 2) plain = y;
  }
  const noun = SAYING_NOUN.test(t.k);
  const who = run.length ? (noun && !run[0].poss ? [] : run) : plain && !noun && fam !== 'claim' && !ANYONE.has(plain.k) ? [plain] : [];
  if (!who.length) return null;
  return who.some((y) => L.spoke.has(`${y.k}|${fam}`)) ? null : `"${who.map((y) => y.s).reverse().join(' ')} ${t.s}": no sentence shows ${who.length > 1 || who[0].cap ? 'them' : 'it'} saying so`;
}

/**
 * Why an instruction to film may not stand as written, or null. It opens on its kind's verbs and says how to film it; every name in
 * it is one the story's outlet or page sentences or its line print (`composed`: and the row's own title, for one made here); every
 * other word is a filming word or one of those sentences' own; a claim, a crime, a wrongdoing or a death, and anything the sentences
 * only report or hedge, follows a word that says whose account it is ("what X alleges about ...") or comes before a claim's noun
 * ("the theft claims"), and what they turn down is said turned down ("the breakup rumours"); whoever it says says, alleges, reports
 * or denies something is shown doing so, and a name is said to have done only what a sentence says it did; the answer the claim
 * got goes with it (`answer`: the fact it is about carries one). No he or she, no "did", no number but a length or one the
 * sentences give, no "not" a sentence does not say, no "it is over".
 */
function doFails(d, kind, text, { answer = false, composed = false } = {}) {
  const what = UNCONTRACTED(String(text || '').trim()).replace(/[‐‑‒]/g, '-').replace(/[.!]+$/, '');
  if (!what) return 'no instruction';
  // (a title in quotes may hold a colon of its own: "‘Lantern: Rebirth’")
  if (/[?:;]/.test(what.replace(/[‘“"][^’”"]{1,60}[’”"]/g, 'x'))) return 'a question or a second sentence';
  if (what.length > DO_CHARS) return `${what.length} characters, over ${DO_CHARS}`;
  const toks = T.tokensOf(what);
  if (toks.length < DO_WORDS[0] || toks.length > DO_WORDS[1]) return `${toks.length} words, not ${DO_WORDS[0]} to ${DO_WORDS[1]}`;
  if (!KIND[kind].verbs.includes(toks[0].k)) return `a ${kind} angle opens on ${KIND[kind].verbs.slice(0, 4).join(', ')}`;
  const L = storyLex(d);
  // (whose account an outlet's is, only one the sheet credits under "Reported by", and never a trend roundup: an instruction that
  // names another sends a creator to an outlet the sheet never shows, reviewers 2026-10-20: "what <an outlet the sheet never names> reports")
  if (Array.isArray(d.credited)) {
    const credited = creditedOf(d);
    const named = L.outlets.find((o) => (ROUNDUP.test(o) || !credited.has(outletKey(o))) && new RegExp(`(?<![\\p{L}\\p{N}])${WD.esc(o)}(?![\\p{L}\\p{N}])`, 'iu').test(what));
    if (named) return `"${named}" is no outlet the sheet credits`;
  }
  const titled = composed ? new Set(T.tokensOf(d.title || '').map((t) => t.k)) : new Set();
  const named = (t) => L.names.has(t.k) || titled.has(t.k);
  // (a word's, a meme's or a sound's own name is the thing itself, never a person: "the Sleepy otter meme")
  const own = d.kind === 'word' ? L.subjectKeys : new Set();
  const clauseOf = [];
  toks.forEach((t, i) => clauseOf.push(i === 0 ? 0 : clauseOf[i - 1] + (/[,;]/.test(toks[i - 1].post) || CLAUSE_WORD.has(t.k) ? 1 : 0)));
  const inClause = (i, test) => toks.slice(0, i).some((y, j) => clauseOf[j] === clauseOf[i] && test(y));
  const claimAfter = (i) => toks.slice(i + 1, i + 3).some((y) => CLAIM_NOUN.test(y.k));
  // (a "calls" reaches its object only, "calling Hale a liar | in the leaked documents"; a "says" or "alleges" its whole clause)
  const calledUpTo = (m) => { const end = toks.findIndex((y, j) => j > m && (SCENE.has(y.k) || clauseOf[j] !== clauseOf[m])); return end < 0 ? toks.length : end; };
  const reported = (i) => toks.slice(0, i).some((y, m) => clauseOf[m] === clauseOf[i] && REPORTED.test(y.k) && (!CALLS.test(y.k) || i < calledUpTo(m))) || claimAfter(i);
  const turnedDown = (i) => inClause(i, (y) => T.NEG_GRAMMAR.has(y.k) || y.nt || TURNS_DOWN(y) || RUMOUR.test(y.k)) || claimAfter(i);
  let owner = false;
  let accuses = false;
  let answered = false;
  for (const [i, t] of toks.entries()) {
    const after = owner;
    owner = false;
    if (t.num) {
      if (LENGTH.has((toks[i + 1] || {}).k) ? t.num.value > LENGTH_SECONDS_MAX : !L.numbers.some((n) => T.sameNumber(n, t.num))) return `the number "${t.s}"`;
      continue;
    }
    if (i > 0 && (t.cap || /\p{Lu}/u.test(t.s.slice(1))) && !PLATFORM.has(t.k) && !named(t) && !own.has(t.k)) return `"${t.s}" is a name the story's sentences do not print`;
    if (PRONOUN_SAYS.has(t.k)) return `"${t.s}" says who without a name`;
    if (POSSESSIVE.has(t.k)) { if (!toks[i + 1]) return `"${t.s}" is no determiner here: it says who`; owner = true; continue; }
    if (after && FRAME.has(t.k) && !FRAME_NOUN.has(t.k) && !familyOf(t.k)) return `"${toks[i - 1].s}" is no determiner here: it says who`;
    if ((t.k === 'is' || t.k === 'are') && toks[i + 1] && !IS_SAYS.has(toks[i + 1].k) && !(toks[i - 1] && toks[i - 1].k === 'you')) return `"${t.k} ${toks[i + 1].s}" says what something is`;
    if (DONE.has(t.k)) { if (!reported(i)) return `"${t.s}" says what was done`; continue; }
    if (T.NEG_GRAMMAR.has(t.k) || t.nt) {
      const next = toks.slice(i + 1).find((y) => !T.STOP.has(y.k));
      if (!next || !anyKey(L.negated, next)) return `"${t.s}" turns round what no sentence does`;
      continue;
    }
    const fam = familyOf(t.k);
    if (fam) {
      if (fam === 'deny' && !L.denial) return `"${t.s}": no sentence carries a denial`;
      const who = speakerFails(L, toks, i);
      if (who) return who;
      if (fam === 'claim') accuses = true;
      if (fam === 'deny' || fam === 'answer') answered = true;
      continue;
    }
    if (ANSWER.test(t.k)) { answered = true; continue; }
    // (a hedge only makes what follows it less sure: "was reportedly charged", "allegedly shooting")
    if (HEDGE_WORD.test(t.k)) continue;
    if (own.has(t.k)) continue;
    if (FRAME.has(t.k) || T.STOP.has(t.k)) continue;
    if (MEDIA.has(t.k) && d.kind === 'word' && THING.has(t.k)) continue;
    // (an event only where an outlet says plainly it happened, or as somebody's account of it, or turned down as they turn it down)
    if (EVENT.has(t.k) && !eventSaid(d, t) && !reported(i) && !turnedDown(i)) return `"${t.s}" is no event the story's outlets say happened`;
    if (L.proper.has(t.k) && !graveWord(t)) continue;
    if (!anyKey(L.words, t) && !titled.has(t.k)) return `"${t.s}" is no word of the story's outlet or page sentences`;
    // (said only as turned down, "denies breakup rumours": said so, or not at all)
    if (!anyKey(L.flat, t) && !anyKey(L.held, t) && anyKey(L.turned, t) && !turnedDown(i)) return `"${t.s}" is what the sentences turn down: say it as they do`;
    // (an act on record, "banned", "fired", is said flat where two sentences say it so and none denies anything)
    const onRecord = T.claimClass(t.k) === 'record' && !L.denial && keysOf(t).some((k) => (L.flatIn.get(k) || 0) >= 2) && !WRONG_WORD.test(t.k) && !CRIME.test(t.s) && !DEATH.test(t.s);
    const grave = graveWord(t) && !onRecord;
    // (a thing a story is told through, "the stream", "the video", is no claim however the sentences tell it)
    if ((grave || (!anyKey(L.flat, t) && !MEDIA.has(t.k))) && !reported(i) && !turnedDown(i)) return `"${t.s}" is ${grave ? 'a claim' : 'only reported'}: say whose account it is before it`;
    if (grave) accuses = true;
  }
  // (a name is said to have done what a sentence says it did, as its doer: "Voss withheld" where one says "Mara Voss withheld", never
  // "Hale withheld"; never "Calder dropped Juno Pell" where the sentence says "Rook Calder dropped by label", nor "Juno Pell and Rook Calder
  // canceled their concert" where it says "Juno Pell, Rook Calder concert ..., canceled" (storyLex `doersOf`). A name joined to the next
  // ("Juno Pell and Rook Calder canceled") or an adverb between ("Calder reportedly dropped") is the verb's doer all the same; a verb said
  // as done to the name ("Voss was fired", "Voss fired from") makes no claim of what the name did)
  if (!composed) {
    const nameAt = (p) => !!toks[p] && L.proper.has(toks[p].k) && nameLike(L, toks[p], p) && !toks[p].poss;
    // (from the last word back, so that the name next to its verb is the one a refusal quotes: "Hale withheld")
    for (const [i, t] of [...toks.entries()].reverse()) {
      if (!nameAt(i)) continue;
      let at = i + 1;
      while (at < toks.length && (nameAt(at) || ((toks[at].k === 'and' || toks[at].k === '&') && nameAt(at + 1)) || isAdverb(toks[at]))) at += 1;
      const v = toks[at];
      if (!v || FRAME.has(v.k) || T.STOP.has(v.k) || familyOf(v.k) || L.proper.has(v.k) || !verbLike(v) || SAYING_NOUN.test(v.k) || /(?:ss|us|is|ics)$/.test(v.k) || passiveAt(toks, at)) continue;
      if (!keysOf(v).some((k) => L.agent.has(`${t.k}|${k}`))) return `"${t.s} ${v.s}": no sentence says so of ${t.s}`;
    }
  }
  if (accuses && (answer || L.answerInHand) && !answered) return 'it tells the claim and not the answer it got: say "and the denial" or "and the response"';
  return null;
}

/** Whether an instruction that passed names the story: its subject, a name its sentences print, or a word of theirs that is no filming word. */
function namesStory(d, text) {
  const L = storyLex(d);
  const toks = T.tokensOf(UNCONTRACTED(text));
  const names = toks.some((t, i) => L.subjectKeys.has(t.k) || (nameLike(L, t, i) && !PLATFORM.has(t.k) && L.proper.has(t.k)));
  const fact = toks.some((t) => !t.num && !FRAME.has(t.k) && !T.STOP.has(t.k) && !LENGTH.has(t.k) && anyKey(L.words, t));
  return names && fact;
}
/** Whether an instruction is a plain one, by its words alone: no name and nothing but filming words (a kept row's, ranked last). */
function isPlain(text) {
  const toks = T.tokensOf(UNCONTRACTED(String(text || '')));
  return toks.every((t, i) => t.num || FRAME.has(t.k) || T.STOP.has(t.k) || LENGTH.has(t.k) || (i === 0 && t.cap)) || Object.values(KIND).some((k) => k.stock === text);
}

/** What a row is called in an instruction made here: its title, and a word's with what it is ("the Sleepy otter meme"). */
function topicOf(d) {
  const title = String(d.title || '').trim().replace(/^the\s+/i, '');
  if (!title) return null;
  if (d.kind !== 'word') return title;
  const last = T.tokensOf(title).map((t) => t.k).pop();
  return THING.has(last) ? title : `${title} ${d.sub && THING.has(d.sub) ? d.sub : 'trend'}`;
}
/** Whether the fact an angle is about carries the answer its claim got: a denial, a reply, or an official's "no". */
function carriesAnswer(d, parts) {
  return (parts || []).some((n) => {
    const s = Number.isInteger(n) ? d.shown[n - 1] : null;
    if (!s) return false;
    const toks = T.tokensOf(s.text);
    return !!RP.replyOf(s.text, d.subject) || toks.some((t) => T.DENIES.test(t.k)) || (toks.some((t) => SAYS.test(t.k)) && toks.some((t) => T.NEG_GRAMMAR.has(t.k)));
  });
}
// the trend roundups and agencies a format's page comes from: never named as whose account a story is ("Give your take on what
// NewEngen says: ..." named a roundup that tells a format and reports nothing)
const ROUNDUP = /^(?:newengen|later|later\.com|tokchart|tokboard)$/i;
// (an outlet's name as a key: "PrimeTimer" and "primetimer.com" are one)
const outletKey = (name) => String(outletName(name) || name || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** The outlets the row's sheet credits under "Reported by" (the dossier's `credited`, the row's own sources), as keys. */
const creditedOf = (d) => new Set((Array.isArray(d.credited) ? d.credited : []).map(outletKey).filter(Boolean));
/**
 * Whose account a fact is, as an instruction says it: "what Dexerto and Sportskeeda report", "Dexerto’s report", by the outlet sentences
 * it rests on, else "what reports say". Only an outlet the sheet itself credits under "Reported by" (an outlet only the searches
 * brought in, one under a sheet that never names it, is not), and never a trend roundup.
 */
function whoseOf(d, parts) {
  const rests = (parts || []).map((n) => (Number.isInteger(n) ? d.shown[n - 1] : null)).filter((s) => s && SUPPORT.has(s.type));
  const credited = creditedOf(d);
  const from = [...new Set(rests.map((s) => outletName(s.outlet)).filter((o) => o && !ROUNDUP.test(o) && credited.has(outletKey(o))))].slice(0, 2);
  const page = rests.length > 0 && rests.every((s) => s.type === 'page');
  const verb = page ? (from.length > 1 ? 'say' : 'says') : (from.length > 1 ? 'report' : 'reports');
  return { rests, whose: [...(from.length ? [`what ${from.join(' and ')} ${verb}`] : []), ...(from.length > 1 ? [`what ${from[0]} ${page ? 'says' : 'reports'}`] : []), 'what reports say'],
    // (a question for viewers is about one account: the first outlet's report, or the reports)
    report: [...(from.length ? [`${from[0]}’s ${page ? 'page' : 'report'}`] : []), 'the reports'] };
}

// a made instruction tells its fact in this many of its words at most (DO_WORDS less the kind's lead), at least MOMENT_WORDS
const MOMENT_WORDS = 5;
// where a fact's clause may be cut to fit an instruction: before its tail ("... after his walkout", ", then Tobin Hale ...")
const CLAUSE_CUT = /(?:,\s+|\s+(?=(?:after|as|amid|despite|following|while|before|over|during|then|with)\s))/g;
const DETERMINER = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'this', 'that', 'these', 'those']);
const coreOf = (w) => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
/**
 * The fact an angle is about as the clause a made instruction tells it with ("the subject's moment"): its first part, the answer it got
 * said apart, in sentence case (a headline's capitals set small: "Tobin Hale faces lamp theft allegations"), and with
 * the "was" a headline leaves out put back ("Mara Voss fired from Harbor Lights" is "Mara Voss was fired from Harbor Lights", "Rook
 * Calder, Juno Pell concert at Velmor Stadium canceled" is "the Rook Calder, Juno Pell concert at Velmor Stadium was canceled": a passive kept
 * passive, never turned into who did it). { clause, passive } or null: a part told ", reports say" (whose account it is sits after
 * it, out of an instruction's reach), or one with no verb to tell it by.
 */
// (a sentence told as somebody's at its end: ", reports say", ", network says", ", according to police")
const TOLD_AFTER = /,\s+(?:(?:[\p{L}\p{N}’'.-]+\s+){0,3}(?:says?|said|reports?|reported|tells?|told)|according to\b.*)$/iu;
function momentOf(d, about) {
  // (the claim, where the fact is a claim and the answer it got: the answer is said after it, "and the denial")
  const parts = String(about || '').replace(/[.!]+$/, '').split(/;\s+/).map((x) => x.trim()).filter(Boolean);
  let s = parts.find((x) => !ANSWER_SAID(x)) || parts[0] || '';
  if (!s || TOLD_AFTER.test(s)) return null;
  // (a part copied in Title Case is set as a sentence; one with a few names in it is no headline: "Rook Calder, Juno Pell concert at
  // Velmor Stadium canceled". ideasOf sets a fact from a headline in sentence case before it is kept)
  if (T.isTitleCase(T.tokensOf(s))) s = WD.sentenceCased(s, WD.namesOf(d));
  // (a word a headline shouts, "shows CANCELLED", is said as the dictionary word it is; an acronym, "UCLA", stays as it is)
  const words = s.split(/\s+/).map((w) => { const core = coreOf(w); return /^\p{Lu}{4,}$/u.test(core) && W.inDict(core.toLowerCase()) ? w.replace(core, core.toLowerCase()) : w; });
  const said = words.join(' ');
  const tok = (w) => T.tokensOf(coreOf(w))[0] || null;
  const toks = words.map(tok);
  // (its verb: the first that is no part of its subject, "concert to be held in Denver" being one: "X, Y concert to be held in
  // Denver, canceled" is told by "canceled". A sentence whose only verb is still to come, "X to sue Y", tells nothing done)
  const infinitive = (p) => toks.slice(Math.max(0, p - 2), p).some((t) => t && t.k === 'to');
  // (and no plural noun a headline's bare passive follows: "Geordie shows cancelled due to ..." is told by "cancelled")
  const nounBefore = (p) => /s$/.test(toks[p].k) && !!toks[p + 1] && (/ed$/.test(toks[p + 1].k) || PAST.test(toks[p + 1].k)) && passiveAt(toks.map((t) => t || { k: '' }), p + 1);
  const v = toks.findIndex((t, p) => p > 0 && t && !t.cap && verbLike(t) && !T.STOP.has(t.k) && !/ing$/.test(t.k) && !infinitive(p) && !nounBefore(p));
  if (v < 1 || toks.slice(0, v).every((t) => !t || isAdverb(t))) return null;
  const before = toks.slice(0, v).filter(Boolean);
  // (a verb after a "be" is told as the sentence tells it: "Tobin Hale is accused of ...")
  let a = v;
  while (a > 0 && toks[a - 1] && isAdverb(toks[a - 1])) a -= 1;
  if (a > 0 && toks[a - 1] && BE.has(toks[a - 1].k)) return { clause: said, passive: true };
  const bare = passiveAt(toks.map((t) => t || { k: '' }), v);
  if (!bare) return /ed$/.test(toks[v].k) || PAST.test(toks[v].k) || /s$/.test(toks[v].k) ? { clause: said, passive: false } : null;
  // (who or what it was done to: names, or a thing they qualify, which a sentence calls "the ...": "the Rook Calder, Juno Pell concert")
  const L = storyLex(d);
  const sub = toks.slice(0, a);
  const isName = (t, p) => !!t && (L.proper.has(t.k) || (p > 0 && (t.cap || /\p{Lu}/u.test(t.s.slice(1)))));
  const head = sub.findIndex((t, p) => t && !isName(t, p) && !T.STOP.has(t.k) && !t.poss && !isAdverb(t));
  const headEnd = head < 0 ? -1 : (() => { let e = head; while (e + 1 < sub.length && sub[e + 1] && !T.STOP.has(sub[e + 1].k) && !isName(sub[e + 1], e + 1)) e += 1; return e; })();
  const many = sub.some((t) => t && (t.k === 'and' || t.k === '&')) || (headEnd >= 0 && /[^su]s$/.test(sub[headEnd].k));
  const the = head >= 0 && sub[0] && !DETERMINER.has(sub[0].k) && !sub[0].poss ? 'the ' : '';
  const first = words[0];
  const small = the && !isName(sub[0], 0) && /^\p{Lu}\p{Ll}+$/u.test(coreOf(first)) ? `${first.charAt(0).toLowerCase()}${first.slice(1)}` : first;
  const subject = [`${the}${small}`, ...words.slice(1, a)];
  subject[subject.length - 1] = subject[subject.length - 1].replace(/[,;:]+$/, '');
  return { clause: [...subject, many ? 'were' : 'was', ...words.slice(a)].join(' '), passive: true };
}
/** The clause and its cuts, longest first: whole, then before each tail from the last back, MOMENT_WORDS words at least. */
function cutsOf(clause) {
  const at = [...clause.matchAll(CLAUSE_CUT)].map((m) => m.index).filter((i) => clause.slice(0, i).split(/\s+/).length >= MOMENT_WORDS).reverse();
  return [clause, ...at.map((i) => clause.slice(0, i).replace(/[,;:\s]+$/, '').replace(/[,;:]+(['’"”])$/, '$1'))];
}
/**
 * An instruction made from the fact an angle is about, when the model's own does not stand or names nothing of the story (P12, the
 * reviewers of 2026-10-20: "what <an outlet> reports about the <row title>" told a creator no fact): first the kind's way of
 * filming and the fact itself ("Explain in a minute why Mara Voss was fired from Harbor Lights", "React on camera to the news that
 * Mara Voss called Tobin Hale a liar in reportedly leaked court documents"), the answer the claim got said after it;
 * else whose account it is and the row's own title ("Explain in a minute what reports say about the Mara Voss allegations, and the
 * denial"). Held to the same check, the one made from the fact as the model's own is (a name said to do only what a sentence says
 * it did); null when none passes. { text, moment (it tells its fact: printed alone) }. parts: the numbers of the sentences the fact
 * rests on; about: the fact as printed.
 */
function composedDo(d, kind, parts, { answer = false, about = '' } = {}) {
  // (a talking point is not done, and a word's "try it yourself" says what the phone's own first idea says: no instruction is made)
  if (kind === 'try') return null;
  const topic = topicOf(d);
  if (!topic) return null;
  const L = storyLex(d);
  const { rests, whose, report } = whoseOf(d, parts);
  const deny = rests.some((s) => T.tokensOf(s.text).some((t) => T.DENIES.test(t.k))) || (!rests.length && L.denial);
  const tail = (base) => `${base}, and the ${deny ? 'denial' : 'response'}`;
  const told = d.kind === 'word' || kind === 'timeline' ? null : momentOf(d, about);
  if (told) {
    const lead = { explain: `Explain in a minute ${told.passive ? 'why' : 'how'}`, react: 'React on camera to the news that', take: 'Give your take on the news that', ask: 'Ask your viewers what they think of the news that' }[kind];
    // (the clause goes on after the lead: its first word small unless the sentences print it as a name, "how ex-editor Tobin Hale ...")
    // (a label before a name, "Ex-editor Tobin Hale", or a word that leads no name: never the first word of one, "New York Comic Con")
    const [first, second] = T.tokensOf(told.clause);
    const label = first && new RegExp(`^${WD.LED_BY}(?:-|$)`, 'i').test(first.s);
    const small = first && !L.proper.has(first.k) && (label || !(second && second.cap));
    const clauseOf = (c) => (small && /^\p{Lu}\p{Ll}/u.test(c) ? `${c.charAt(0).toLowerCase()}${c.slice(1)}` : c);
    for (const clause of lead ? cutsOf(told.clause).map(clauseOf) : []) {
      const base = `${lead} ${clause}`;
      // (a clause that is itself the answer, "Mara Voss denies ...", takes no "and the denial" after it)
      const answers = T.tokensOf(clause).some((t) => ANSWER.test(t.k) || T.DENIES.test(t.k));
      for (const text of answers ? [base] : answer ? [tail(base)] : [base, tail(base)]) if (!doFails(d, kind, text, { answer })) return { text, moment: true };
    }
  }
  const make = {
    explain: (w) => (d.kind === 'word' ? `Explain in a minute ${w} about where the ${topic} comes from` : `Explain in a minute ${w} about the ${topic}`),
    react: (w) => `React on camera to ${w} about the ${topic}`,
    take: (w) => (d.kind === 'word' ? `Give your take on the ${topic}` : `Give your take on ${w} about the ${topic}`),
    ask: (w) => `Ask your viewers what they think of ${w} on the ${topic}`,
    timeline: (w) => `Tell in order, oldest first, ${w} about the ${topic}`,
  };
  for (const w of kind === 'ask' ? report : whose) {
    const base = make[kind](w);
    // (a claim told with the answer it got: the instruction says it was answered)
    const tries = d.kind === 'word' ? [base] : answer ? [tail(base)] : [base, tail(base)];
    for (const text of tries) if (!doFails(d, kind, text, { answer, composed: true })) return { text, moment: false };
  }
  return null;
}
/**
 * The instruction a made angle is printed with when its fact is printed beside it (the sheet does not tell it yet): its kind's way
 * of filming and whose account the fact is, "Explain in a minute what Dexerto reports: <the fact>", shortened to fit, the kind's
 * plain one at the last. A word's take is on the word itself ("Give your take on the Pumpkin head illusion trend"), never on what a
 * roundup says. about: the fact as printed.
 */
function leadOf(d, kind, parts, about) {
  if (kind === 'try') return null;
  const { whose, report } = whoseOf(d, parts);
  const topic = topicOf(d);
  const make = {
    explain: (w) => `Explain in a minute ${w}`,
    react: (w) => `React on camera to ${w}`,
    take: (w) => (d.kind === 'word' ? (topic ? `Give your take on the ${topic}` : null) : `Give your take on ${w}`),
    ask: (w) => `Ask your viewers about ${w}`,
    timeline: (w) => `Tell in order, oldest first, ${w}`,
  };
  const stock = stockOf(d, kind);
  // (a fact told ", reports say" says whose account it is already)
  const leads = (d.kind === 'word' && kind === 'explain') || /,\s+reports say\.?$/i.test(about) ? [] : (kind === 'ask' ? report : whose).map((w) => make[kind](w)).filter(Boolean);
  return [...new Set([...leads, stock])].find((lead) => `${lead}: ${about}`.length <= ANGLE_CHARS && (lead === stock || !doFails(d, kind, lead, { composed: true }))) || null;
}

/** The instruction as a card prints it: a capital, no stop at the end. */
const doText = (text) => { const s = String(text || '').trim().replace(/[‐‑‒]/g, '-').replace(/[.!?\s]+$/, ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
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
 * An angle's instruction on this story: the model's own where it passes the check and names the story; else one made from its fact;
 * else the model's own where it passes (plain); else the kind's plain one. { do, rank, own (the model's stood), why (the model's
 * refusal, or null) }.
 */
function instructionOf(d, kind, given, parts, answer, about = '') {
  const mine = doText(given);
  const why = mine ? doFails(d, kind, mine, { answer }) : 'no instruction';
  if (!why && namesStory(d, mine)) return { do: mine, rank: RANK.own, own: true, why: null };
  const made = composedDo(d, kind, parts, { answer, about });
  if (made) return { do: made.text, rank: RANK.made, own: false, why, made: true, moment: made.moment };
  // (a try with nothing of the trend's own in it, "Try it yourself", is the phone's own first idea for the row said again: left out)
  if (kind === 'try') return { do: null, rank: RANK.plain, own: false, why: why || 'a try that names nothing of the trend says what the card already leads with' };
  if (!why) return { do: mine, rank: RANK.plain, own: true, why: null };
  return { do: stockOf(d, kind), rank: RANK.plain, own: false, why };
}

// one fact once (reviewers, 2026-10-20: "Rook Calder swearing on a live show" as the explain, the react and the take, a
// firing three times): two instructions are one video when this share of the fewer words that tell a fact are the other's
const SAME_FACT_SHARE = 0.7;
const FRAME_STEMS = D.stemsOf([...FRAME, ...LENGTH].join(' '));
/**
 * What an instruction (or a printed angle) tells, its filming words and its names aside (every angle of a story names its people:
 * "what Mara Voss says about suing Tobin Hale" and "what Tobin Hale alleges about $40,000 in pay" are two facts): the stems of its
 * other words.
 */
const factOf = (text) => new Set([...D.stemsOf(T.tokensOf(String(text || '')).filter((t, i) => i === 0 || !(t.cap || /\p{Lu}/u.test(t.s.slice(1)))).map((t) => t.k).join(' '))].filter((x) => !FRAME_STEMS.has(x)));
/** Whether two facts (factOf) are one: most of the smaller is in the other. Two that tell nothing are never one. */
function sameFact(a, b) {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return [...small].filter((x) => big.has(x)).length / small.size >= SAME_FACT_SHARE;
}
// (an instruction a kept card's angle is given again ranks this far below one it kept)
const REMADE = 0.5;
/** The angles in their order on the sheet: the model's specific ones first, the made ones next, the plain ones last (as given, within each). */
const ranked = (list) => list.map((x, i) => ({ x, i })).sort((a, b) => b.x.rank - a.x.rank || a.i - b.i).map(({ x }) => x);
/** An angle's rank on this story (`RANK`): what a test and a kept card are ordered by. */
function rankOf(d, a) {
  if (!a || typeof a.do !== 'string') return RANK.plain;
  if (isPlain(a.do) || !namesStory(d, a.do)) return RANK.plain;
  return RANK.made;
}

/**
 * The why and the angles of one reply (prompt.js `parseCard`), each held to the check. Returns { why: { text, src } | null, angles:
 * [{ kind, do, about, src }] (ranked: the model's specific instructions first, those made from a fact next, plain ones last),
 * counts: { whys, whysPassed, angles (judged), anglesPassed, dosKept (the model's own instruction stood), specific (an instruction
 * that names the story, the model's or one made), made (one made from the fact), anglesRepeated (a kind or a fact another angle had:
 * left out, not judged) }, refused: [{ what, text, why }] (an angle left out, or an instruction of the model's that did not stand) }.
 * tools: the dossier's wording tools (lib/editor/wording.js `wordingOf`), when the caller has them.
 */
function ideasOf(card, d, { nowMs = NaN, lex = null, tools = null } = {}) {
  const counts = { whys: 0, whysPassed: 0, angles: 0, anglesPassed: 0, dosKept: 0, specific: 0, made: 0, anglesRepeated: 0 };
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
    // (the room the fact has: beside the kind's plain instruction, so that it can always be printed with one)
    const r = mended(d, wording, about, { words: ABOUT_WORDS, chars: ANGLE_CHARS - stockOf(d, a.kind).length - 2 });
    if (!r.ok) { no(r.why); continue; }
    // (one fact, or facts of one day, is no timeline: explained instead, where explain may be offered and is not offered already)
    let kind = a.kind;
    if (kind === 'timeline' && !inOrder(d, r.parts)) {
      if (kindRefused(d, 'explain', grave, said) || angles.some((x) => x.kind === 'explain')) { no('a timeline tells two things of different days, oldest first'); continue; }
      kind = 'explain';
    }
    // (a fact copied from a headline is set in sentence case: "Tobin Hale Faces lamp Theft allegations" read broken)
    const line = r.parts.some((n) => Number.isInteger(n) && d.shown[n - 1] && WD.headlineCased(d.shown[n - 1].text)) ? WD.sentenceCased(r.line, wording.names) : r.line;
    const ins = instructionOf(d, kind, kind === a.kind ? a.do : '', r.parts, carriesAnswer(d, r.parts), line);
    if (!ins.do) { no(ins.why); continue; }
    // (one fact once: a second video of a fact another angle tells stands only as the model's own instruction, another video than
    // the first's, and is printed alone, its fact said once on the sheet; and never one whose instruction tells what another's
    // does, the verb aside: a react and a take on one firing are one video)
    const same = angles.some((x) => keyOf(x.about) === keyOf(line));
    // (what the angle tells: an instruction that names its fact tells that; one made of whose account it is and the row's title is
    // printed with its fact, which is what it tells)
    const fact = factOf(ins.own || ins.moment ? ins.do : line);
    if (angles.some((x) => sameFact(x.fact, fact)) || (same && (ins.rank !== RANK.own || angles.some((x) => keyOf(x.do) === keyOf(ins.do))))) { counts.angles -= 1; counts.anglesRepeated += 1; no('the same fact as another angle'); continue; }
    if (ins.why && kind === a.kind) refused.push({ what: `do ${kind}`, text: doText(a.do), why: ins.why });
    const lead = ins.made && !ins.moment ? leadOf(d, kind, r.parts, line) : null;
    angles.push({ kind, do: ins.do, about: line, src: r.src, ...(lead ? { lead } : {}), ...(same || ins.moment ? { alone: true } : {}), rank: ins.rank, fact });
    counts.anglesPassed += 1;
    if (ins.own) counts.dosKept += 1;
    if (ins.rank > RANK.plain) counts.specific += 1;
    if (ins.rank === RANK.made) counts.made += 1;
  }
  return { why, angles: ranked(angles).map(({ rank, fact, ...x }) => x), counts, refused };
}

/**
 * A kept card's why and angles on the story as it is now (lib/editor/index.js `decide`): each as it was written, judged again by
 * every rule (a denial newly in hand, a hedge, a story that has turned grave, an instruction the check now refuses, a timeline that
 * is one fact; a why that is no longer of the last 7 days), and left out when it no longer passes. An instruction the check now
 * refuses gives way to one made from the angle's fact, or to the kind's plain one. Returns { why, angles } (angles ranked).
 */
function standing(card, d, { nowMs = NaN } = {}) {
  const why = card && card.why && typeof card.why.text === 'string' ? card.why : null;
  const kept = card && Array.isArray(card.angles) ? card.angles.filter((a) => a && KIND[a.kind] && typeof a.do === 'string' && typeof a.about === 'string') : [];
  const whyStands = why && (() => {
    const r = judgeClause(d, why.text, null, { words: WHY_WORDS, chars: WHY_CHARS });
    return !r.failures.length && Number.isFinite(nowMs) && r.src.some((i) => nowMs - d.shown[i].t <= WHY_FRESH_MS);
  })();
  const grave = graveOf(d);
  const topic = topicOf(d);
  // (what a kept angle tells: its instruction when it is printed alone or names the story by its fact, else its fact)
  const toldBy = (y) => factOf(y.x.alone === true || y.rank === RANK.own ? y.x.do : y.x.about);
  const angles = kept.map((a) => {
    if (kindRefused(d, a.kind, grave, `${a.do} ${a.about}`)) return null;
    const parts = partsOf(d, a.about);
    if (judgeClause(d, a.about, null, { chars: ANGLE_CHARS - stockOf(d, a.kind).length - 2 }).failures.length) return null;
    if (a.kind === 'timeline' && !inOrder(d, parts)) return null;
    const answer = carriesAnswer(d, parts);
    const plain = a.do === stockOf(d, a.kind) || isPlain(a.do);
    // (a try that is no more than "Try the <title> yourself", or plain: what the card already leads with, as a new card leaves it out)
    if (a.kind === 'try' && (plain || (topic && a.do === `Try the ${topic} yourself`))) return null;
    const { lead, alone, ...rest } = a;
    // (a plain instruction a card of before carried, "Explain the situation in a minute", gives way to one that tells its fact)
    if (!plain && !doFails(d, a.kind, a.do, { answer })) return { x: a, rank: rankOf(d, a) };
    const made = composedDo(d, a.kind, parts, { answer, about: a.about });
    if (!made && a.kind === 'try') return null;
    if (!made) return plain ? { x: a, rank: RANK.plain } : { x: { ...rest, do: stockOf(d, a.kind) }, rank: RANK.plain };
    const led = made.moment ? null : leadOf(d, a.kind, parts, a.about);
    // (made again here, it ranks after the instructions a card kept as written: they were the model's own)
    return { x: { ...rest, do: made.text, ...(led ? { lead: led } : {}), ...(made.moment || alone === true ? { alone: true } : {}) }, rank: RANK.made - REMADE };
  }).filter(Boolean)
    // (one fact once, as a new card's are: the first of two that tell the same thing stands)
    .filter((y, i, all) => !all.slice(0, i).some((z) => sameFact(toldBy(z), toldBy(y))));
  return { why: whyStands ? why : null, angles: ranked(angles.map(({ x, rank }) => ({ ...x, rank }))).map(({ rank, ...x }) => x) };
}

/**
 * What the feed publishes of a card's why and angles (D4), the instruction and the fact kept apart for the detail to print (it knows
 * the row's line and why lines, which a fact may only say again: `angleFor`): { why: the line with no stop at its end, or null;
 * angles: [{ kind, do, about, lead (a made one's: `leadOf`), alone (a second video of a fact another angle tells: printed alone) }] },
 * in the card's order.
 */
function publishedOf(card) {
  const why = card && card.why && typeof card.why.text === 'string' ? card.why.text.replace(/\.$/, '') : null;
  const angles = (card && Array.isArray(card.angles) ? card.angles : []).filter((a) => a && KIND[a.kind] && typeof a.do === 'string' && typeof a.about === 'string')
    .map((a) => ({ kind: a.kind, do: a.do, about: a.about, ...(typeof a.lead === 'string' ? { lead: a.lead } : {}), ...(a.alone === true ? { alone: true } : {}) })).filter((a) => a.do.length <= ANGLE_CHARS).slice(0, P.ANGLES_MAX);
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
 * One angle as the detail prints it (D4 `angles[]`): its instruction alone when the sheet already tells every part of its fact
 * (`said`: the row's line and its why lines: the fact said a second or third time under the line is clutter, and the instruction
 * names the story by itself); else "<do>: <about>" where the two fit, a made one's lead and the fact where they do not ("Explain in
 * a minute what Dexerto reports: <the fact>"), or the instruction alone. { text, kind }. An angle a row carried before the two were
 * kept apart is as it was.
 */
function angleFor(a, said) {
  if (typeof a.do !== 'string' || typeof a.about !== 'string') return typeof a.text === 'string' ? { text: a.text, kind: a.kind } : null;
  const parts = a.about.replace(/\.$/, '').split(/;\s+/).filter(Boolean);
  if (a.alone === true || parts.every((p) => toldShare(p, said) >= TOLD_SHARE) || answerTold(parts, said)) return { text: a.do, kind: a.kind };
  const both = angleText(a);
  const led = typeof a.lead === 'string' ? `${a.lead}: ${a.about}` : null;
  return { text: both.length <= ANGLE_CHARS ? both : led && led.length <= ANGLE_CHARS ? led : a.do, kind: a.kind };
}

// a claim the sheet tells in its own words with the answer it got (the line "Tobin Hale is accused of ...; he denies it" under an
// angle about "Tobin Hale faces ... allegations; Hale calls BS on the claim"): this share of the claim's words is told already
const CLAIM_TOLD_SHARE = 0.5;
// (an answer by its words: a denial, a response, or the claim called false, "Hale calls BS on the claim", "pushes back")
const CALLED_FALSE = /(?<![\p{L}\p{N}])(?:calls?|called|calling)\b.*\b(?:false|bs|b\.s\.|lies?|untrue|fake|nonsense|baseless|ridiculous)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:hits?|pushes|push|fires?|claps?) back(?![\p{L}\p{N}])/iu;
const ANSWER_SAID = (text) => CALLED_FALSE.test(text) || T.tokensOf(text).some((t) => ANSWER.test(t.k) || T.DENIES.test(t.k));
/** Whether a fact of two parts, a claim and the answer it got, is a claim the sheet already tells with an answer. */
function answerTold(parts, said) {
  if (parts.length !== 2 || !ANSWER_SAID(parts[1]) || !(said || []).some((x) => typeof x === 'string' && ANSWER_SAID(x))) return false;
  return toldShare(parts[0], said) >= CLAIM_TOLD_SHARE;
}
/**
 * The angles as the detail prints them (D4 `angles[]`), each by `angleFor` and one fact once: an angle whose printed words tell what
 * one printed above it tells is left out (a react and a take on one firing are one video), and of the angles that only tell the
 * fact the sheet's line and why lines tell already, the first stands alone. said: the row's line and its why lines.
 */
function printedAngles(angles, said = []) {
  const kept = [];
  const saidFact = new Set((said || []).flatMap((x) => [...factOf(x)]));
  let onLine = false;
  for (const a of angles || []) {
    const p = a && typeof a === 'object' ? angleFor(a, said) : null;
    if (!p || typeof p.text !== 'string' || !p.text) continue;
    const fact = factOf(p.text);
    if (kept.some((k) => k.p.text === p.text || sameFact(k.fact, fact))) continue;
    const told = fact.size > 0 && [...fact].filter((x) => saidFact.has(x)).length / fact.size >= TOLD_SHARE;
    if (told && onLine) continue;
    if (told) onLine = true;
    kept.push({ p, fact });
  }
  return kept.map((k) => k.p);
}

module.exports = { ideasOf, printedAngles, graveTextOf, sameFact, factOf, momentOf, standing, publishedOf, judgeClause, doFails, composedDo, leadOf, namesStory, isPlain, rankOf, kindsLine, graveOf, angleText, angleFor, toldShare, inOrder, outletName,
  KIND, FRAME, OBJECT, MEDIA, EVENT, RANK, WHY_FRESH_MS, ANGLE_CHARS, WHY_CHARS, DO_CHARS, TOLD_SHARE, WHY_TOLD_SHARE };
