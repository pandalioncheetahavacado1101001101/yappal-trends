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

/**
 * When the line was published (ms): the time of the outlet sentence it was made from, the first of them when several say it
 * (`dated`: the outlet sentences as lines, each with its source), else of the sentence that carries its first claim; null when
 * nothing dates it.
 */
function lineAt(inputs, line, dated) {
  const said = keyOf(line);
  const first = keyOf(line.split(';')[0]);
  const own = dated.filter((x) => { const k = keyOf(x.line); return k === said || said.startsWith(k) || k.startsWith(first); }).sort((a, b) => a.s.t - b.s.t)[0];
  return own ? own.s.t : carriedAt(inputs, passes(inputs, line));
}

// a timeline entry leads the line when it is this much newer than the sentence the line was made from, and this many outlets carry it
const ENTRY_NEWER_MS = 6 * HOUR_MS;
const ENTRY_OUTLETS = 2;
const ENTRY_SHARED_MIN = 3;
const ENTRY_SHARED_PART = 0.6;
// where an entry's own lead ends: what it says first, before what it is set against
const ENTRY_LEAD_END = /[,;:—–]|\s(?:after|amid|as|following|over|while|before|when|because|despite|since|at|in)\s/i;
const outletKey = (o) => keyOf(String(o || '').replace(/\.(?:com|net|org|co\.uk|tv|news|us|uk)$/i, ''));
// a word's stem as the gate reads one (lib/editor/gate.js `loose`): its first five letters, so "cancels" and "cancellation" are one
const looseStem = (st) => String(st || '').slice(0, 5);
/**
 * The line led by the newest entry of the row's own timeline (2026-10-13: a card told the day a story began while its own timeline
 * held the reply that answered it a day later): a reply, a chapter or a latest entry six hours or more newer than the sentence
 * the line was made from, which names the subject and the card's noun, and which two outlets or more carry (a sentence of theirs
 * says the same thing, by its words). The line leads with that entry; when the entry's own lead does not say the card's noun (a
 * "reinstated" on a cancellation row), the line's first clause follows it as a trailing clause, so the start is still told, and
 * so does any reply clause the line carried. The joined line passes the check whole, with the entry's sentence among its sources,
 * or the line stands. { line, from, entry: { at, kind, text, outlets } } or null. inputs.timeline: lib/history.js `timelineOf`.
 */
function fromTimeline(inputs, lex, line) {
  const entries = (inputs.timeline || []).filter((e) => e && ['reply', 'chapter', 'latest'].includes(e.kind) && e.text && Number.isFinite(e.at)).sort((a, b) => b.at - a.at);
  if (!entries.length) return null;
  const subjectKey = keyOf(inputs.subject);
  const family = TN.FAMILY.get(inputs.family) || null;
  const nounKey = keyOf(inputs.noun || '');
  const name = subjectKey.split(' ').filter(Boolean);
  if (!name.length) return null;
  const last = name[name.length - 1];
  const every = inputs.sources.filter((s) => s.type === 'outlet').map((s) => ({ s, line: dropFiller(SRC.recased(SRC.asLine(s.text, { subjectKey, family, lex }), inputs.sources, inputs.spelt || [])) })).filter((x) => x.line);
  const baseAt = lineAt(inputs, line, every.filter((x) => Number.isFinite(x.s.t) && x.s.t > 0));
  if (baseAt === null) return null;
  // (the card's noun by its family, or by its stem where it has none: "cancels" says a cancellation, "reinstates" does not)
  const nounStem = nounKey ? looseStem((T.tokensOf(nounKey)[0] || {}).st || nounKey) : '';
  const saysNoun = (text) => (family ? !!TN.says(text, family) : !!nounStem && T.tokensOf(text).some((t) => looseStem(t.st || t.k) === nounStem));
  const carriers = [...inputs.sources, ...(inputs.spelt || [])].filter((s) => s && s.text && (s.type || 'outlet') === 'outlet');
  const parts = line.replace(/[.]$/, '').split(/;\s*/);
  for (const e of entries) {
    if (e.at * 1000 - baseAt < ENTRY_NEWER_MS) continue;
    const words = keyOf(e.text).split(' ');
    if (!words.includes(last) || !saysNoun(e.text)) continue;
    // (two outlets carry it: a sentence of each says the same thing, the same words or most of the words that say something)
    const eKey = keyOf(e.text);
    const eStems = new Set(saidStems(inputs, e.text).keys());
    const need = Math.max(ENTRY_SHARED_MIN, Math.ceil(ENTRY_SHARED_PART * eStems.size));
    const carried = carriers.filter((s) => keyOf(s.text) === eKey || [...saidStems(inputs, s.text).keys()].filter((st) => eStems.has(st)).length >= need);
    const outlets = [...new Set(carried.map((s) => outletKey(s.outlet)).filter(Boolean))];
    if (outlets.length < ENTRY_OUTLETS) continue;
    const eLine = dropFiller(SRC.recased(SRC.asLine(e.text, { subjectKey, family, lex }), inputs.sources, inputs.spelt || []));
    if (!eLine || /\?/.test(eLine) || keyOf(eLine) === keyOf(parts[0])) continue;
    // (the entry's own lead says the card's noun, or the start follows it as a trailing clause; a reply the line carried stays.
    // A person the entry names in full is named by the surname after it, as the cards print one)
    const lead = eLine.split(ENTRY_LEAD_END)[0];
    const trailing = [...(saysNoun(lead) ? [] : [parts[0]]), ...parts.slice(1)].filter((p) => p && !keyOf(eLine).includes(keyOf(p))).map((p) => surnamesAfter(inputs, eLine, p));
    const joined = `${[eLine.replace(/[.]$/, ''), ...trailing].join('; ')}.`;
    if (joined.length > LINE_CHARS_MAX) continue;
    const have = inputs.sources.some((s) => keyOf(s.text) === eKey);
    const carrier = carried.find((s) => s.outlet) || null;
    const sources = have ? inputs.sources : [...inputs.sources, { text: e.text, type: 'outlet', outlet: carrier ? carrier.outlet : null, t: e.at * 1000 }];
    if (!passes({ ...inputs, sources }, joined).ok) continue;
    return { line: joined, from: carrier && carrier.outlet ? carrier.outlet : 'outlet', entry: { at: e.at, kind: e.kind, text: e.text, outlets } };
  }
  return null;
}

// what a subject does next, as a headline leads with it: an answer, an explanation, a step taken
const NEXT_VERB =/^(?:responds?|reacts?|explains?|clarifies|addresses|defends?|justifies|jokes?|laughs?|apologi[sz]es|cancels?|postpones?|quits?|deletes?|sues?|denies|rejects|confirms|admits|retracts|returns|resigns|steps|hits|claps|fires|pushes|breaks|speaks|doubles|insists|brushes|shrugs)$/i;
const NEXT_SHARED_MIN = 1;
/**
 * Where it stands now (judges, 2026-10-12: a card that told day one of a story whose subject had since answered): on a story a
 * day old or more, the newest outlet sentence, a day or more newer than the one the line is, that LEADS with the subject doing
 * something next ("<name> responds to ...", "<name> explains why ...", "<name> cancels ...") which the line does not tell, as a
 * last clause in that sentence's own words, the name cut to its last word. It is the same story's (it shares a word that says
 * something with the line, and names nobody the line's story does not), and the joined line passes the check whole or the line
 * stands as it was. { line, from } or null. Any noun: a photo, a cancellation and a feud have a next day as an accusation has.
 */
function withLatest(inputs, lex, line) {
  if (!line) return null;
  // (the row's own timeline first: its newest reply, chapter or latest entry, when two outlets carry it)
  const led = fromTimeline(inputs, lex, line);
  if (led) return led;
  // (every outlet sentence as a line, the ones that tell only how the subject took it too: "X reacts to ..." is no line of its own,
  // and it is exactly what happened next)
  const subjectKey = keyOf(inputs.subject);
  const family = TN.FAMILY.get(inputs.family) || null;
  const every = inputs.sources.filter((s) => s.type === 'outlet').map((s) => ({ s, line: dropFiller(SRC.recased(SRC.asLine(s.text, { subjectKey, family, lex }), inputs.sources, inputs.spelt || [])) }))
    .filter((x) => x.line && x.line.length <= LINE_CHARS_MAX && !/\?/.test(x.line));
  const dated = every.filter((x) => Number.isFinite(x.s.t) && x.s.t > 0);
  if (dated.length < 2) return null;
  const baseAt = lineAt(inputs, line, dated);
  if (baseAt === null) return null;
  const said = keyOf(line);
  const name = String(inputs.subject || '').trim().split(/\s+/).filter(Boolean);
  if (!name.length) return null;
  const nameKey = keyOf(name.join(' '));
  const had = saidStems(inputs, line);
  const next = dated.filter((x) => x.s.t - baseAt >= BEHIND_MS && keyOf(x.line) !== said).map((x) => {
    const ws = x.line.replace(/[.]$/, '').split(/\s+/);
    if (ws.length <= name.length + 2 || keyOf(ws.slice(0, name.length).join(' ')) !== nameKey) return null;
    const verb = ws[name.length].replace(/[^\p{L}]/gu, '');
    if (!NEXT_VERB.test(verb)) return null;
    const stems = saidStems(inputs, x.line);
    // (a turn the line already tells is no news: "denies" after "…; X denies it")
    const verbStem = ([...stems.entries()].find(([, k]) => k === keyOf(verb)) || [keyOf(verb)])[0];
    if (had.has(verbStem)) return null;
    const shared = [...stems.keys()].filter((st) => st !== verbStem && had.has(st)).length;
    if (shared < NEXT_SHARED_MIN || !oneStory(inputs, line, x.line)) return null;
    const who = name.length > 1 && said.includes(nameKey) ? ws[name.length - 1] : ws.slice(0, name.length).join(' ');
    return { ...x, clause: `${who} ${ws.slice(name.length).join(' ')}` };
  }).filter(Boolean).sort((a, b) => b.s.t - a.s.t);
  for (const x of next) {
    const joined = `${line.replace(/[.]$/, '')}; ${x.clause}.`;
    if (joined.length <= LINE_CHARS_MAX && passes(inputs, joined).ok) return { line: joined, from: x.s.outlet || 'outlet' };
  }
  return null;
}

// the families of people-drama whose line owes the answer a claim got: an accusation, a feud, a backlash, a charge or an arrest,
// a ban, a suit, a rumour. (The engine files a "charges" title under `arrest`, a "ban" under `backlash` or `arrest`)
const DRAMA_FAMILY = new Set(['allegations', 'feud', 'backlash', 'arrest', 'lawsuit', 'rumors', 'scam', 'threats']);
const SAYS_NO_IN_LINE = /(?<![\p{L}\p{N}])(?:den(?:y|ies|ied|ial)|disput(?:e|es|ed)|refut(?:e|es|ed)|rebut(?:s|ted)?|rejects?)(?![\p{L}\p{N}])/iu;
const CLAIMS_BACK = /^(?:doubles|doubled|doubling|stands|stood|insists|insisted|maintains|maintained)$/;
/** Whether a drama row's line owes an answer: it carries no denial or dispute of anyone's, and no reply of the subject's. */
function owesAnswer(inputs, line) {
  if (!line || !DRAMA_FAMILY.has(inputs.family)) return false;
  const reply = RP.replyOf(line, inputs.subject);
  return !TN.DENIAL.test(line) && !SAYS_NO_IN_LINE.test(line) && !(reply && reply.kind !== 'answer');
}
/** Who makes the claim a line tells, by the roles (the maker of a claim word, or of "doubles down"): name keys, never the subject. */
function claimantsOf(inputs, line) {
  const ctx = prepare({ ...inputs, line });
  const { L } = ctx;
  const out = [];
  L.toks.forEach((t, i) => {
    if (L.names.has(i) || t.q || !(T.claimClass(t.k) === 'report' || R.SAY.test(t.k) || CLAIMS_BACK.test(t.k))) return;
    const r = R.rolesAt(L, i);
    const m = r && r.maker && r.maker.m && r.maker.kind !== 'pronoun' ? r.maker.m : null;
    if (m && !T.sameName(m, ctx.subject)) out.push(m.keys.join(' '));
  });
  return [...new Set(out)];
}
/**
 * A clause that follows `lead` in a line, with every person `lead` names in full named by the surname instead, as the cards print a
 * second mention ("Voss denies Hale’s claim" after "Mara Voss is accused ... by Tobin Hale"). ctx: `lead` prepared, when the caller has it.
 */
function surnamesAfter(inputs, lead, clause, ctx = prepare({ ...inputs, line: lead })) {
  const saidInFull = ctx.L.mentions.filter((m) => m.keys.length > 1 && !ctx.L.toks[m.start].q).map((m) => ctx.L.toks.slice(m.start, m.end + 1).map((t) => t.s).join(' ').replace(/[’']s?$/, ''));
  return saidInFull.reduce((s, name) => { const short = RP.surnameOf(name); return short === name ? s : s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${name.split(/\\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}(?![\\p{L}\\p{N}])`, 'gu'), short); }, clause);
}
// a name's generation, said after it: "Sr.", "Jr.", "III"
const GENERATION = /\s+(?:sr|jr|ii|iii|iv)$/;
/** The name as a text spells it (its words in order, any case), or null. */
function speltIn(text, key) {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${key.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
  return m ? m[0] : null;
}
/**
 * The answer a drama row's line owes (reviewers, 2026-10-12; the gate's `denialsOwed` holds the model path to the same): when the
 * line carries no denial, the newest outlet sentence among `sentences` (the row's dossier: its own, and what its names' searches
 * returned) in which someone says it is not so. That someone is the subject, a name of the title or of the line, or the named
 * counterparty: a name of the sentence, when the sentence also names whoever makes the line's claim ("RaKai rejects Reggie’s
 * claim" under a line of Reggie's claim); never the claim's own maker. Told as the sentence's own reply clause (`RP.replyOf`) or,
 * where the sentence says it another way ("... claiming she tried to buy an item not for sale"), as the reported "<name> denies
 * it" / "<name> disputes it", which the check carries by that very sentence (lib/lines.js `deniesByMaker`). The joined line must
 * pass the check with that sentence among its sources. { line, from, answer: { text, outlet, t, by } } or null.
 */
function withAnswer(inputs, line, sentences = inputs.sources) {
  if (!owesAnswer(inputs, line)) return null;
  const claimants = claimantsOf(inputs, line);
  const isClaimant = (key) => claimants.some((c) => sameOne(c, key));
  const subjectKey = keyOf(inputs.subject);
  const ctx = prepare({ ...inputs, line });
  const named = (S) => S.mentions.filter((m) => !m.keys.every((k) => NO_ONE.has(k))).map((m) => m.keys.join(' '));
  const fixed = [...new Set([subjectKey, ...named(R.sentenceOf(inputs.title || '', new Set(ctx.subjectKeys))), ...named(ctx.L)])].filter((k) => k && !isClaimant(k));
  const family = TN.FAMILY.get(inputs.family) || null;
  const have = new Set(inputs.sources.map((s) => keyOf(s.text)));
  const candidates = (sentences || []).filter((s) => s && s.text && s.type === 'outlet' && !/\?\s*["”’']?$/.test(s.text.trim()))
    .map((s) => ({ s, text: SRC.recased(SRC.asLine(s.text, { subjectKey, family, lex: null }), inputs.sources, inputs.spelt || []) })).sort((a, b) => (b.s.t || 0) - (a.s.t || 0));
  const found = [];
  for (const x of candidates) {
    const S = R.sentenceOf(x.text, new Set(ctx.subjectKeys));
    const namesClaimant = claimants.length > 0 && named(S).some((k) => isClaimant(k));
    const who = [...new Set([...fixed, ...(namesClaimant ? named(S).filter((k) => !isClaimant(k)) : [])])];
    for (const key of who) {
      // (a name the line gives with its generation, "Bram Sr.", is the same one a sentence names without it: "father Bram denies ...")
      const spelt = speltIn(x.text, key) || (GENERATION.test(key) ? speltIn(x.text, key.replace(GENERATION, '')) : null);
      if (!spelt) continue;
      const reply = RP.replyOf(x.text, spelt);
      const no = reply && reply.kind !== 'answer' ? { kind: reply.kind, clause: reply.clause } : (() => { const n = RP.saysNo(x.text, spelt); return n ? { kind: n.kind, clause: `${RP.shortName(spelt)} ${n.kind === 'denial' ? 'denies' : 'disputes'} it` } : null; })();
      if (no) found.push({ ...no, x, by: spelt });
    }
    // (or a party the sentence names by what it is, the store, the school, the organisers, the police, when the sentence names the
    // subject or a name of the line, so it is this story's: "New York Store denies she got the ‘Pretty Woman’ treatment" is told as
    // the reported "the store denies it", by whoever the sentence says denies and no surer than it: the gate reads a card's denial
    // the same way, lib/editor/gate.js `denialsOwed`, and the check carries the word by that sentence, lib/lines.js `deniesByParty`)
    if (!found.some((f) => f.x === x) && named(S).some((k) => fixed.some((f) => sameOne(f, k)))) {
      for (const p of RP.partiesOf(x.text)) {
        const reply = RP.replyOf(x.text, p.spelt);
        const no = reply && reply.kind !== 'answer' ? reply : RP.saysNo(x.text, p.spelt);
        if (!no) continue;
        found.push({ kind: no.kind, clause: `the ${p.noun} ${no.kind === 'denial' ? 'denies' : 'disputes'} it`, x, by: p.spelt, party: p.noun });
      }
    }
  }
  // (a person the line already names in full is named by the surname in the clause, as the cards print one: "Voss denies Hale’s claim")
  const shortened = (clause) => surnamesAfter(inputs, line, clause, ctx);
  // (a denial before a dispute; a denier named before one told by what it is; the newest of each)
  found.sort((a, b) => ['denial', 'dispute'].indexOf(a.kind) - ['denial', 'dispute'].indexOf(b.kind) || Number(!!a.party) - Number(!!b.party) || (b.x.s.t || 0) - (a.x.s.t || 0));
  // (the joined line passes the check, or is no worse by it than the line that stands: an outlet's headline the check already faults
  // still carries the denial its sources hold. Review, 2026-10-27: a father's alleged abuse stood without his denial, the line's
  // own faults refusing every clause that would have added it)
  const was = new Set(passes(inputs, line).failures.map((x) => x.rule));
  for (const f of found) {
    const joined = `${line.replace(/[.]$/, '')}; ${shortened(f.clause)}.`;
    if (joined.length > LINE_CHARS_MAX) continue;
    const sources = have.has(keyOf(f.x.s.text)) ? inputs.sources : [...inputs.sources, { text: f.x.s.text, type: 'outlet', outlet: f.x.s.outlet || null, t: f.x.s.t || 0 }];
    const check = passes({ ...inputs, sources }, joined);
    if (check.ok || (was.size > 0 && check.failures.every((x) => was.has(x.rule)))) return { line: joined, from: f.x.s.outlet || 'outlet', answer: { text: f.x.s.text, outlet: f.x.s.outlet || null, t: f.x.s.t || 0, by: f.by } };
  }
  return null;
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
 * was done], answer? (the sentence a drama line's reply was cut from), entry? (the timeline entry a line was led by) }.
 * inputs: lib/line-sources.js `inputsOf`; lex: the build's lexicon; opts.dossier: () => the row's whole dossier as sentences
 * (its own, and what the collector's searches for its names returned: lib/editor/dossier.js), read only when the line owes the
 * answer a claim got, so the twelve sentences the line is written from are never the limit of where a denial is looked for.
 */
function compose(inputs, lex = null, opts = {}) {
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
  // the answer the claim got, when the line still carries none: read over the row's whole dossier, the subject's own reply, a
  // named party's, or a party's told by what it is (2026-10-13: a row's reply sat in a search result thirteen days old, and the
  // twelve sentences the line is written from never reach that far back)
  let answer = null;
  if (owesAnswer(inputs, best.line)) {
    const more = typeof opts.dossier === 'function' ? opts.dossier() || [] : [];
    answer = withAnswer(inputs, best.line, more.length ? [...inputs.sources, ...more] : inputs.sources);
    if (answer) { best = { line: answer.line, from: best.from }; steps.push('the answer'); }
  }
  // where it stands now: the newest entry of the row's own timeline, else what the subject did next, a day or more on, as a last clause
  const latest = withLatest(inputs, lex, best.line);
  if (latest) { best = { line: latest.line, from: best.from }; steps.push(latest.entry ? 'the newest entry' : 'where it stands now'); }
  return { line: best.line, from: best.from, why: base.why || [], steps, ...(answer ? { answer: answer.answer } : {}), ...(latest && latest.entry ? { entry: latest.entry } : {}) };
}

module.exports = { compose, dropFiller, newestDevelopment, isTurn, withAccuser, saysByWhom, withReply, withLatest, fromTimeline, withAnswer, owesAnswer, claimantsOf, optionsOf, othersOf, oneStory, DRAMA_FAMILY };
