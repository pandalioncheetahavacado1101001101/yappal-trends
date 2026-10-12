'use strict';
/*
 * The line with no model (ios/IDEAS-FEED.md G4, section N): one sentence composed from ALL of an item's own source sentences by
 * rules, and shown only when the claim check passes it (lib/lines.js), exactly as a model's line would be. It starts from the
 * headline path's line (lib/line-sources.js: the engine's, or the most telling outlet sentence) and then:
 *   the newest development   on a story days old, the sentence that tells where it stands now leads, not the day-one headline;
 *   no outlet filler         a label an outlet hangs on a name, a teaser's tail, a shock word: cut, and the line checked again;
 *   by whom                  a claim told with nobody making it gives way to the sentence that tells the same claim and who by;
 *   the reply                an accusation's line carries the denial, dispute or answer its sources hold, as a short clause in
 *                            the replying sentence's own words;
 *   one story                never two accusers or two stories in one line: the clauses a line is joined from come from sentences
 *                            that name the same people, and the check refuses the rest.
 * Every step is a candidate, never a rewrite: a candidate the check refuses is dropped and the line before it stands. Pure.
 */
const TN = require('../engine/talk-nouns');
const W = require('../engine/wording');
const TP = require('../engine/talking-points');
const SRC = require('./line-sources');
const RP = require('./line-replies');
const R = require('./line-roles');
const T = require('./line-text');
const { checkLine, prepare } = require('./lines');
const { keyOf } = require('./util');

const HOUR_MS = 3600e3;
// a story is old once its own outlets span this long; a development is a day or more newer than what the line tells
const OLD_STORY_MS = 48 * HOUR_MS;
const BEHIND_MS = 24 * HOUR_MS;
// the kinds of story that have a later beat: a claim and what answers it, a dispute, a case. A death, a split, a trailer and a
// record are told by the day they happened
const DEVELOPING = new Set(['allegations', 'arrest', 'threats', 'scam', 'rumors', 'lawsuit', 'feud', 'fight', 'attack', 'argument']);
// (a newer sentence leads when it says nearly as much as the one it replaces)
const THINNER_BY = 2;
const NEW_SCORE_MIN = 3;
const LINE_CHARS_MAX = 200;
const WORDS_MIN = 6;
// a reply answers the claim the line tells: it is not older than that claim's own sentence by more than this
const REPLY_BEFORE_MS = 6 * HOUR_MS;

// ---------- outlet filler ----------
// what an outlet hangs on a name to sell the story: "Manosphere influencer Andrew Tate", "former MAGA star Tucker Carlson",
// "controversial streamer Hasan Piker". The role alone stays where it says who someone is ("YouTuber Jack Doherty")
const LABEL = '(?:controversial|embattled|disgraced|beloved|notorious|infamous|outspoken|troubled|firebrand|manosphere|maga|alt-right|far-right|far-left|self-proclaimed|self-styled|so-called|shock|problematic|polarizing|polarising|divisive)';
const ROLE = '(?:influencer|streamer|youtuber|tiktoker|podcaster|star|pundit|host|commentator|personality|rapper|singer|actor|actress|comedian|creator|figure|provocateur|activist|model)';
const LABELLED = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:former|ex|ex-)\\s+)?${LABEL}(?:\\s+${LABEL})?\\s+(?:(?:${ROLE}|twitch|kick|youtube|tiktok|kick)\\s+){0,2}(?=\\p{Lu})`, 'giu');
const LABEL_ONLY = new RegExp(`(?<![\\p{L}\\p{N}])${LABEL}\\s+(?=${ROLE}(?![\\p{L}\\p{N}]))`, 'giu');
// a teaser's tail: it promises more and tells nothing
const TEASER_TAIL = /\s*(?:[—–-]\s+|,\s+|:\s+|;\s+)(?:but\s+)?(?:(?:that|this|it)(?:’|')?s\s+not\s+(?:why|what|all)\b.*|here(?:’|')?s\s+(?:why|what|how|everything)\b.*|(?:everything|what)\s+(?:we|you)\s+(?:know|need to know)\b.*|what\s+to\s+know\b.*|what\s+happened\b.*|and\s+(?:fans|the internet|people|viewers)\s+(?:are|is|can(?:’|')?t)\b.*|(?:fans|the internet|social media|viewers)\s+(?:react|reacts|erupt|erupts|are\s+\w+)\b.*|full\s+story\b.*|details\s+inside\b.*|watch\b.*|see\s+(?:the\s+)?(?:video|photos?|pics?)\b.*)$/iu;
// a reaction hung on the end of something already told: ", sparking outrage", ", sparks backlash"
const REACTION_TAIL = /,\s+(?:spark(?:s|ing)|prompt(?:s|ing)|draw(?:s|ing)|ignit(?:es|ing)|fuel(?:s|ling|ing)|stir(?:s|ring)|trigger(?:s|ing)|caus(?:es|ing))\s+(?:[\p{L}-]+\s+){0,2}?(?:outrage|backlash|controversy|criticism|fury|uproar|debate|reactions?|concern|speculation)(?:\s+online|\s+on social media)?$/iu;
// a word that only says how shocking it is
const SHOCK = /(?<![\p{L}\p{N}])(?:(an?)\s+)?(?:shocking|stunning|bombshell|explosive|jaw-dropping|scathing|shock|sensational|astonishing)\s+(?=(\p{Ll}))/giu;
const TEMPLATE_JUNK = /\s*%%[^%\s]{1,24}%%/g;

/** A line without what an outlet added to sell it; the same line when nothing of it is filler or too little would be left. */
function dropFiller(line) {
  const end = /[.!?]["”’']?$/.test(line) ? '' : '.';
  let s = String(line || '').replace(TEMPLATE_JUNK, '').replace(/\s+([.,;:])/g, '$1');
  const body = s.replace(/[.]$/, '');
  let out = body.replace(TEASER_TAIL, '').replace(REACTION_TAIL, '').replace(LABELLED, '').replace(LABEL_ONLY, '')
    // (the article follows the word that is left: "a scathing attack" is "an attack")
    .replace(SHOCK, (m, article, next) => (article ? `${/^[aeiou]/i.test(next) ? 'an' : 'a'} ` : '')).replace(/\s{2,}/g, ' ').trim();
  if (out.split(/\s+/).length < WORDS_MIN) out = body.replace(TEMPLATE_JUNK, '').trim();
  // (a line that opened on a label now opens on the name, as the name is written: "xQc" keeps its small letter)
  if (out.charAt(0) !== body.charAt(0) && /^\p{Ll}/u.test(out) && !/^\p{Ll}+\p{Lu}/u.test(out.split(/\s/)[0])) out = out.charAt(0).toUpperCase() + out.slice(1);
  s = /[.!?]["”’']?$/.test(out) ? out : `${out}.`;
  return s === `${String(line || '')}${end}` ? String(line || '') : s;
}

// ---------- what a sentence is about ----------
const NO_ONE = new Set(['twitch', 'kick', 'youtube', 'tiktok', 'instagram', 'x', 'twitter', 'netflix', 'reddit', 'snl', 'spotify', 'onlyfans']);
/** The other people a line names beside its subject, as name keys ("gorgeous doll", "reggie"): who else its story is about. */
function othersOf(inputs, line) {
  const ctx = prepare({ ...inputs, line });
  return ctx.L.mentions.filter((m) => !T.sameName(m, ctx.subject) && !m.keys.every((k) => ctx.subjectKeys.includes(k) || NO_ONE.has(k)) && !ctx.L.toks[m.start].q).map((m) => m.keys.join(' '));
}
const sameOne = (a, b) => { const [x, y] = [a.split(' '), b.split(' ')]; const [small, big] = x.length <= y.length ? [x, y] : [y, x]; return small.every((k) => big.includes(k)); };
/** Whether two lines tell one story as far as their people say: neither names someone the other does not, or they share one. */
function oneStory(inputs, a, b) {
  const [x, y] = [othersOf(inputs, a), othersOf(inputs, b)];
  if (!x.length || !y.length) return true;
  return x.some((p) => y.some((q) => sameOne(p, q)));
}

// ---------- the candidates ----------
/** Every outlet sentence of the item as a line the engine's way, with its source, its time and how much it tells. */
function optionsOf(inputs, lex) {
  const subjectKey = keyOf(inputs.subject);
  const family = TN.FAMILY.get(inputs.family) || null;
  return inputs.sources.filter((s) => s.type === 'outlet').map((s) => {
    const line = dropFiller(SRC.recased(SRC.asLine(s.text, { subjectKey, family, lex }), inputs.sources, inputs.spelt || []));
    return { s, line, score: SRC.informative(line, { subjectKey, family, outlet: s.outlet }) };
  }).filter((x) => x.line.length <= LINE_CHARS_MAX && !SRC.unfit(x.line, subjectKey) && !(inputs.title && keyOf(x.line) === keyOf(inputs.title)));
}
const passes = (inputs, line) => checkLine({ ...inputs, line, kind: 'headline' });
/** When the sentence that carries a line's first claim was published (ms), or null when the check found none. */
function carriedAt(inputs, check) {
  const n = (check.carried || []).find((i) => Number.isInteger(i) && i >= 0);
  const src = n === undefined ? null : inputs.sources[n];
  return src && Number.isFinite(src.t) && src.t > 0 ? src.t : null;
}

/** The words of a line that say what happened, as stems: no names, no numbers, no grammar. */
function saidStems(inputs, line) {
  const ctx = prepare({ ...inputs, line });
  return new Map(ctx.L.toks.map((t, i) => [t, i]).filter(([t, i]) => !ctx.L.names.has(i) && T.isContent(t) && !t.num && !T.FREE.has(t.k)).map(([t]) => [t.st, t.k]));
}
/**
 * Whether a newer sentence is a turn of the story the line tells, not merely newer: someone the line does not name now makes a
 * claim (a second accuser), or it carries an answer or an outcome the line has not: a denial, an admission, an apology, a
 * retraction, an arrest, a charge, a suit, a ban, a firing. A rehash, a reaction, a profile and a sibling story are none of these.
 */
function isTurn(inputs, base, option) {
  const had = saidStems(inputs, base);
  const known = othersOf(inputs, base);
  const ctx = prepare({ ...inputs, line: option });
  const { L } = ctx;
  const isSubject = (m) => !!m && (T.sameName(m, ctx.subject) || m.keys.every((k) => ctx.subjectKeys.includes(k)));
  const inBase = (m) => !!m && known.some((q) => sameOne(m.keys.join(' '), q));
  const sideOf = (np) => (np && np.m && np.kind !== 'pronoun' ? np.m : null);
  for (let i = 0; i < L.toks.length; i++) {
    const t = L.toks[i];
    if (L.names.has(i) || t.q || !R.readable(L, i)) continue;
    const cls = T.claimClass(t.k);
    const r = R.rolesAt(L, i);
    const [maker, target] = [sideOf(r.maker), sideOf(r.target)];
    // an answer or a retraction, by the subject or by someone the line already names (the accuser taking it back)
    if ((cls === 'deny' || cls === 'admit' || T.RETRACT.test(t.k) || T.DENIES.test(t.k)) && !had.has(t.st) && (isSubject(maker) || inBase(maker))) return true;
    // an act on record, done to the subject or by the subject: arrested, charged, sued, banned, fired
    if (cls === 'record' && !had.has(t.st) && t.st !== 'die' && t.st !== 'death' && (isSubject(maker) || isSubject(target))) return true;
    // a claim by someone the line does not name, made of the subject: a second accuser
    if (cls === 'report' && maker && !isSubject(maker) && !inBase(maker) && (isSubject(target) || TP.claimedOf(option, ctx.subjectKeys.join(' ')))) return true;
  }
  return false;
}
/**
 * The newest development (the Kai Cenat rule: the latest beat, not the first): on a story whose own outlets span two days or
 * more, a sentence a day or more newer than the one that carries the line, when it is a turn of the story (`isTurn`), passes the
 * check and says nearly as much; the newest such. { line, from } or null. A death, a wedding or a trailer has no later beat by
 * this test: what follows them is reaction, and the day-one headline is the story.
 */
function newestDevelopment(inputs, lex, base, options = optionsOf(inputs, lex)) {
  const times = inputs.sources.filter((s) => s.type === 'outlet' && Number.isFinite(s.t) && s.t > 0).map((s) => s.t);
  if (!base.line || !DEVELOPING.has(inputs.family) || times.length < 3 || Math.max(...times) - Math.min(...times) < OLD_STORY_MS) return null;
  const subjectKey = keyOf(inputs.subject);
  const family = TN.FAMILY.get(inputs.family) || null;
  const baseAt = carriedAt(inputs, passes(inputs, base.line));
  const baseScore = SRC.informative(base.line, { subjectKey, family });
  const turns = options.filter((x) => Number.isFinite(x.s.t) && (baseAt === null || x.s.t - baseAt >= BEHIND_MS) && x.score >= Math.max(NEW_SCORE_MIN, baseScore - THINNER_BY) && keyOf(x.line) !== keyOf(base.line))
    .filter((x) => isTurn(inputs, base.line, x.line)).sort((a, b) => b.s.t - a.s.t);
  const fresh = turns.find((x) => passes(inputs, x.line).ok);
  return fresh ? { line: fresh.line, from: fresh.s.outlet || 'outlet', at: fresh.s.t } : null;
}

/**
 * The reply the line owes (item 2: "Andrew Tate is accused of ..." while a source holds his answer): for a line that tells a claim
 * and carries no reply, the newest outlet sentence in which the subject, or the subject's side, denies, disputes or answers it,
 * as a short clause after a semicolon; or, when no joined line passes the check, that sentence itself when it says what is
 * claimed. { line, from } or null (nothing owed, or nothing the check passes).
 */
function withReply(inputs, lex, line, options = optionsOf(inputs, lex)) {
  if (!line || !RP.tellsClaim(line) || RP.replyOf(line, inputs.subject) || TN.DENIAL.test(line)) return null;
  const check = passes(inputs, line);
  const claimAt = carriedAt(inputs, check);
  const replies = options.map((x) => ({ ...x, reply: RP.replyOf(x.line, inputs.subject) })).filter((x) => x.reply && (claimAt === null || !Number.isFinite(x.s.t) || x.s.t >= claimAt - REPLY_BEFORE_MS) && oneStory(inputs, line, x.line))
    // (a denial before a dispute before an answer; the newest of each)
    .sort((a, b) => ['denial', 'dispute', 'answer'].indexOf(a.reply.kind) - ['denial', 'dispute', 'answer'].indexOf(b.reply.kind) || b.s.t - a.s.t);
  for (const r of replies) {
    const joined = `${line.replace(/[.]$/, '')}; ${r.reply.clause}.`;
    // (the joined line is what must pass: the line alone may be refused for the very denial it lacks, rule 9)
    if (joined.length <= LINE_CHARS_MAX && passes(inputs, joined).ok) return { line: joined, from: r.s.outlet || 'outlet' };
  }
  // (the replying sentence alone, when it tells the claim too: "Geordie Greep denies sexual harassment allegations made towards him ...")
  const whole = replies.find((r) => RP.tellsClaim(r.line) && passes(inputs, r.line).ok);
  return whole ? { line: whole.line, from: whole.s.outlet || 'outlet' } : null;
}

// who a claim is by, as a sentence gives it: "<someone> accuses ...", "... accused by <someone>", "..., prosecutors say"
const MAKER_LEAD = /^(?:(?:the|a|an)\s+)?((?:[\p{L}’'.-]+\s+){1,4})(?:alleges?|accuses?|claims?|sues?)\s/iu;
const MAKER_BY = /(?<![\p{L}\p{N}])(?:accused|sued|alleged)\s+by\s+(?:[\p{L}’'.-]+)/iu;
const MAKER_TAIL = /,\s+(?:[\p{L}’'.-]+\s+){1,4}(?:say|says|said|claim|claims|allege|alleges)\.?$/iu;
const SAME_CLAIM_WORDS = 3;
/** Whether a line says who makes the claim it tells (and that one is not the subject). */
function saysByWhom(inputs, line) {
  const s = String(line || '');
  const subject = keyOf(inputs.subject).split(' ');
  const lead = s.match(MAKER_LEAD);
  if (lead && !keyOf(lead[1]).split(' ').some((w) => subject.includes(w))) return true;
  return MAKER_BY.test(s) || MAKER_TAIL.test(s);
}
/**
 * By whom, when the sources say: for a line that tells a claim and not who makes it ("Mizkif is accused of assaulting a fan"), the
 * most telling sentence that tells the same claim (three of its words) with its maker and passes the check. { line, from } or null.
 */
function withAccuser(inputs, lex, line, options = optionsOf(inputs, lex)) {
  if (!line || !RP.tellsClaim(line) || saysByWhom(inputs, line)) return null;
  const mine = saidStems(inputs, line);
  const subjectKey = keyOf(inputs.subject);
  const family = TN.FAMILY.get(inputs.family) || null;
  const floor = SRC.informative(line, { subjectKey, family }) - 1;
  const told = options.filter((x) => keyOf(x.line) !== keyOf(line) && x.score >= floor && saysByWhom(inputs, x.line) && [...saidStems(inputs, x.line).keys()].filter((st) => mine.has(st)).length >= SAME_CLAIM_WORDS)
    .sort((a, b) => b.score - a.score || b.s.t - a.s.t).find((x) => passes(inputs, x.line).ok);
  return told ? { line: told.line, from: told.s.outlet || 'outlet' } : null;
}

/**
 * The composed line of one item: { line, from ('engine' | an outlet's name), why: [what the engine's line lacked], steps: [what
 * was done] }. inputs: lib/line-sources.js `inputsOf`; lex: the build's lexicon.
 */
function compose(inputs, lex = null) {
  const base = SRC.headlineLine(inputs, lex);
  const steps = [];
  let best = { line: base.line, from: base.from };
  if (!best.line) return { ...base, steps };
  const options = optionsOf(inputs, lex);
  // (a line that opens with its own title, "Marvin Harrison Jr. trade rumors: Eagles not interested ...", is a label and a colon: the
  // card would say its title twice, and the feed sends no line at all for it. The most telling sentence that does not, when one passes)
  const titleKey = keyOf(inputs.title || '');
  const saysTitleAgain = (line) => { const k = keyOf(line); return !!titleKey && !!k && (k === titleKey || k.startsWith(`${titleKey} `)); };
  if (saysTitleAgain(best.line)) {
    const other = options.filter((x) => !saysTitleAgain(x.line)).map((x) => ({ ...x, check: passes(inputs, x.line) })).filter((x) => x.check.ok).sort((a, b) => b.score - a.score || b.s.t - a.s.t)[0];
    if (other) { best = { line: other.line, from: other.s.outlet || 'outlet' }; steps.push('more than its title'); }
  }
  // (the gate: a line that tells a claim of someone and that the check does not carry, by rules 5 to 8, gives way to the most
  // telling sentence the check does carry. "Pete Davidson is accused of being an absolute joke" was nobody's sentence)
  if (RP.tellsClaim(best.line)) {
    const refused = passes(inputs, best.line).failures.filter((f) => f.rule >= 5 && f.rule <= 8);
    if (refused.length) {
      const carried = options.map((x) => ({ ...x, check: passes(inputs, x.line) })).filter((x) => x.check.ok).sort((a, b) => b.score - a.score || b.s.t - a.s.t)[0];
      if (carried) { best = { line: carried.line, from: carried.s.outlet || 'outlet' }; steps.push('a sentence the check carries'); }
    }
  }
  // the newest development first: what follows is said of the line that stands
  const fresh = newestDevelopment(inputs, lex, best, options);
  if (fresh) { best = { line: fresh.line, from: fresh.from }; steps.push('the newest development'); }
  // filler: cut only when the line is no worse by the check for it
  const lean = dropFiller(best.line);
  if (lean !== best.line) {
    const [was, now] = [passes(inputs, best.line), passes(inputs, lean)];
    const rulesWas = new Set(was.failures.map((f) => f.rule));
    if (now.failures.every((f) => rulesWas.has(f.rule))) { best = { ...best, line: lean }; steps.push('filler cut'); }
  }
  // by whom, when a sentence says so; never at the price of the reply the line owes
  const answered = TN.DENIAL.test(best.line) || !!RP.replyOf(best.line, inputs.subject);
  let replied = withReply(inputs, lex, best.line, options);
  const accuser = answered ? null : withAccuser(inputs, lex, best.line, options);
  if (accuser) {
    const there = withReply(inputs, lex, accuser.line, options);
    if (!replied || (there && there.line.startsWith(accuser.line.replace(/[.]$/, '')))) { best = { line: accuser.line, from: accuser.from }; replied = there; steps.push('by whom'); }
  }
  if (replied) { best = { line: replied.line, from: best.from === 'engine' && replied.line.startsWith(best.line.replace(/[.]$/, '')) ? 'engine' : replied.from }; steps.push('the reply'); }
  return { line: best.line, from: best.from, why: base.why || [], steps };
}

module.exports = { compose, dropFiller, newestDevelopment, isTurn, withAccuser, saysByWhom, withReply, optionsOf, othersOf, oneStory };
