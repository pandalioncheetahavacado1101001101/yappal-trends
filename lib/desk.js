'use strict';
/*
 * The desk: an editor's pass over the engine's rows before they are matched, measured and published. The engine (a copy of the
 * on-phone pipeline) finds the stories; what the judges of 2026-10-11 kept finding wrong was how a row was named, told and placed,
 * each time by a rule a desk editor would apply to any row, never to one name:
 *
 *   edit (before identity and the series; `edit`)
 *     nobody        a legal placeholder is no person ("Jane Doe"): the row is the story of what its headlines keep naming beside
 *                   it ("Cornell Jane Doe threats"), it is nobody's row to follow, and with nothing beside it there is no row
 *     bare name     a talking point with no noun says no what ("Susan Dell"): not listed
 *     one-sided     a feud is two sides: with no other side two outlets agree on it is one stale or stray headline, not listed
 *     surer title   a word between the name and the noun that neither the line nor the story's own headlines say is dropped
 *                   ("Nidal Hasan failed execution": the failed one was someone else's); a noun the line makes more exact is that
 *                   one ("attack" told as "robbed" is a robbery; a ban the headlines call a "social media ban" is that)
 *     led by whom   a row about a shop or a brand whose every headline names one person leads with that person ("Kelly Clarkson
 *                   Art of Play backlash")
 *     casing        a name is spelt as its own headlines spell it ("FGTeeV", in the title and the line alike); a word that is no
 *                   name is in lower case ("Avatar Seven Havens new series")
 *     same story    two rows whose headlines name each other's subject under the same noun are one story: the lower one goes
 *     words         a calendar day or a bare common noun is no trend ("Halloween trend"); an encyclopedia's definition is no
 *                   line (the row's own news headline is, else there is no row); a meme page's entry title is cut out of its
 *                   definition ("Malfoid or Malfoid Female Draco Malfoy Art Trend is ..."), a definition cut after "combines X" is
 *                   mended; a meme and its sound told by one definition are one row
 *     told by whom  a claim only posts or clips carry is told as theirs ("..., according to a clip"), never "reports say"
 *
 *   order (after the series, with each row's measured status; `order`)
 *     the page leads with creators' stories still going, then the rest of the people-drama still going and the creators' ones
 *     fading, then what is fading; things to film sit at rows 6, 9, 12, 15 and 18, never above the freshest dramas; a row the desk
 *     dropped leaves its place to the next people-drama row that has an outlet behind it.
 *
 * Pure: no clock but `now`, no I/O. Ids are untouched: `natural`, `cardKey`, `subject` and `family` stay the engine's, so a retitled
 * row is the same trend it was (D2).
 */
const TN = require('../engine/talk-nouns');
const W = require('../engine/wording');
const { keyOf } = require('./util');

const PAGE = 20;
const FORMAT_ROWS = [6, 9, 12, 15, 18];
const CREATOR_LEAD_HEAT = 24;
const TITLE_WORDS_MAX = 6;
const MODIFIER_HEADLINES = 2;
const MODIFIER_SHARE = 0.2;
const QUALIFIER_SHARE = 0.5;
const SAME_STORY_MENTIONS = 2;
const NOUN_PHRASE_HEADLINES = 2;
// the names courts give someone who must not be named: nobody's name
const PLACEHOLDER = /^(?:jane|john|baby|mary|richard|james) (?:doe|roe)$/;
// days of the calendar and seasons: everything is "a <day> trend" once a year
const CALENDAR = new Set(['halloween', 'christmas', 'xmas', 'thanksgiving', 'easter', 'hanukkah', 'diwali', 'ramadan', 'eid', 'new year', 'new years', 'new years eve', 'valentines day',
  'valentine day', 'black friday', 'cyber monday', 'mothers day', 'fathers day', 'labor day', 'memorial day', 'independence day', 'fourth of july', '4th of july', 'st patricks day',
  'back to school', 'spring break', 'summer', 'winter', 'autumn', 'fall', 'spring', 'pride month', 'prom', 'graduation']);
const KIND_TAIL = /\s+(?:trend|meme|challenge|craze|sound|audio|dance|filter)s?$/i;
const DEFINITION = /^(.{2,60}?)\s+(?:is|are|was|refers to)\s+(?:an?|the)\s+/i;
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'and', 'or', 'as', 'after', 'over', 'amid', 'is', 'was', 'his', 'her', 'their', 'he', 'she',
  'they', 'it', 'that', 'this', 'has', 'have', 'had', 'be', 'been', 'says', 'said', 'new', 's', 'who', 'what', 'how', 'why', 'us', 'vs', 'not', 'no', 'its', 'will', 'about', 'into', 'but']);

// (lib/line-sources.js PROFILE, said here so the desk needs nothing of the writer's)
const PROFILE_LINE = /^[^,;:]{3,40},\s+(?:the|an?)\s+[^,;:]+\.?$|^(?:inside|meet|behind|a look at|the rise of|the story of|the making of|portrait of)\b/i;
const ownOf = (row) => ((row.meta && row.meta.own) || []).filter((r) => r && r.title);
const kindOfItem = (r) => r.k || (r.fam === 'reddit' ? 'post' : r.fam === 'bluesky' ? 'social' : r.fam === 'kym' ? 'meme' : /^(?:youtube|youtu\.be)$/i.test(r.outlet || '') ? 'upload' : /^(?:twitch|kick)$/i.test(r.outlet || '') ? 'clip' : 'outlet');
const isOutlet = (r) => { const k = kindOfItem(r); return k === 'outlet' || k === 'beat'; };
const headOf = (r) => TN.cleanHeadline(String(r.title || ''), r.outlet || '').replace(/\s+-\s+[^-]{2,40}$/, (m) => (r.outlet && m.includes(r.outlet) ? '' : m)).trim();
const tokens = (text) => String(text || '').split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/i, '')).filter(Boolean);
const keysOf = (text) => keyOf(text).split(' ').filter(Boolean);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isTalk = (row) => row.type === 'point' && !row.wordish;
const isWordRow = (row) => row.type === 'word' || !!row.wordish;
const titleCase = (text) => W.isTitleCase(String(text || '').split(/\s+/));

// ---------- nobody ----------
/** The proper word a placeholder's headlines keep naming beside it (at least half of its outlets' headlines), as they spell it; or null. */
function qualifierOf(row) {
  const subject = new Set(keysOf(row.subject));
  const heads = ownOf(row).filter(isOutlet).map(headOf);
  if (heads.length < 2) return null;
  const counts = new Map();
  for (const head of heads) {
    const seen = new Set();
    for (const w of tokens(head)) {
      const k = keyOf(w);
      if (!k || k.includes(' ') || subject.has(k) || STOP.has(k) || seen.has(k) || !/^\p{Lu}/u.test(w) || /^\d+$/.test(k)) continue;
      // (a dictionary word capitalised by a Title Case headline is no name)
      if (W.isDictWord(k) && !W.isProperWord(k)) continue;
      seen.add(k);
      const c = counts.get(k) || { n: 0, spelt: new Map() };
      c.n += 1;
      c.spelt.set(w, (c.spelt.get(w) || 0) + 1);
      counts.set(k, c);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (!best || best[1].n < QUALIFIER_SHARE * heads.length) return null;
  return [...best[1].spelt.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
/** A row about a placeholder name: titled by what its headlines name beside it and nobody's row; null when nothing is named. */
function nobodyRow(row) {
  if (!isTalk(row) || !PLACEHOLDER.test(keyOf(row.subject))) return row;
  const qualifier = qualifierOf(row);
  if (!qualifier) return null;
  const surface = row.surface || row.subject;
  const title = row.title.toLowerCase().startsWith(qualifier.toLowerCase()) ? row.title : `${qualifier} ${row.title.replace(new RegExp(`^${escapeRe(surface)}`, 'i'), surface)}`;
  return { ...row, title, tier: 'other', meta: { ...row.meta, person: false, creator: false }, desk: [...(row.desk || []), 'placeholder'] };
}

// ---------- a title no surer than its line ----------
/** The title as [surface words, modifier words, noun words], or null when it is not built that way. */
function titleParts(row) {
  const surface = String(row.surface || '').trim();
  const noun = String(row.noun || '').trim();
  const title = String(row.title || '').trim();
  if (!surface || !noun || !title.toLowerCase().startsWith(surface.toLowerCase()) || !title.toLowerCase().endsWith(noun.toLowerCase())) return null;
  const middle = title.slice(surface.length, title.length - noun.length).trim();
  return { surface: title.slice(0, surface.length), middle: middle ? middle.split(/\s+/) : [], noun: title.slice(title.length - noun.length) };
}
const stemOf = (w) => W.stem(keyOf(w));
/** How many of a row's own outlet headlines say a word (by stem). */
const headlinesSaying = (row, word) => { const s = stemOf(word); return ownOf(row).filter(isOutlet).filter((r) => keysOf(headOf(r)).some((k) => W.stem(k) === s)).length; };
/** The phrase the story's own headlines put right before a noun ("social media ban"), said by two of them; or null. */
function nounPhrase(row, noun) {
  const subject = new Set(keysOf(row.subject));
  const counts = new Map();
  for (const r of ownOf(row).filter(isOutlet)) {
    const ks = keysOf(headOf(r));
    const at = ks.lastIndexOf(keyOf(noun));
    if (at < 2) continue;
    const pair = ks.slice(at - 2, at);
    if (pair.some((k) => STOP.has(k) || subject.has(k) || /^\d/.test(k) || !W.inDict(k))) continue;
    counts.set(pair.join(' '), (counts.get(pair.join(' ')) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= NOUN_PHRASE_HEADLINES ? best[0] : null;
}
// what a line says exactly where a title's noun is loose: [the loose noun, what the line must say, the exact noun]
const EXACT_NOUNS = [['attack', /\brobb(?:ed|ery)\b/i, 'robbery'], ['attack', /\bstabb(?:ed|ing)\b/i, 'stabbing'], ['attack', /\bcarjack(?:ed|ing)\b/i, 'carjacking']];

/** A name as its own headlines spell it, when most of them agree on a spelling with a capital inside it ("FGTeeV"); else as given. */
function speltAs(word, heads) {
  const lower = word.toLowerCase();
  const counts = new Map();
  for (const head of heads) for (const w of tokens(head)) if (w.toLowerCase() === lower) counts.set(w, (counts.get(w) || 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[0] === word) return word;
  const inner = /^.+\p{Lu}/u.test(best[0]) && best[0] !== best[0].toUpperCase();
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return inner && best[1] * 2 > total ? best[0] : word;
}
/** A text with each of `names` spelt the given way wherever it stands as a whole word, whatever its case there. */
const respell = (text, names) => names.reduce((s, [from, to]) => (from === to ? s : s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(from)}(?![\\p{L}\\p{N}])`, 'giu'), to)), String(text || ''));

/** A text with each of `names` spelt the given way wherever it stands, the same spelling too ("CyberLeek" under a title's "Cyberleek"). */
const respellAll = (text, names) => names.reduce((s, [from, to]) => s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(from)}(?![\\p{L}\\p{N}])`, 'giu'), to), String(text || ''));

const VERB_FOLLOWS = new Set(['in', 'on', 'up', 'out', 'off', 'to', 'for', 'at', 'about', 'with', 'over', 'back', 'down', 'into', 'after', 'against']);
/**
 * A name without the verb a Title Case headline left on it: "Holly Madison Weighs backlash" is "Holly Madison backlash". The last
 * word of a name of three words or more is no name when it is a dictionary word in -s that a headline of its own follows with a
 * small word ("Weighs in on ..."), and no headline prints it lowercase-less as a surname would be (after a given name alone).
 */
function verbTail(row) {
  const ws = tokens(row.surface || '');
  if (ws.length < 3) return null;
  const last = ws[ws.length - 1];
  const low = last.toLowerCase();
  if (!/^\p{Lu}\p{Ll}+s$/u.test(last) || !W.inDict(low) || W.isFirstName(low) || W.isProperWord(low)) return null;
  const follows = ownOf(row).some((r) => { const hs = tokens(headOf(r)); const at = hs.findIndex((w) => w.toLowerCase() === low); return at > 0 && at + 1 < hs.length && VERB_FOLLOWS.has(hs[at + 1].toLowerCase()); });
  return follows ? last : null;
}
/** A talking point's title made no surer than its line, its noun as exact as its line, its names as their headlines spell them. */
function retitle(row0) {
  if (!isTalk(row0)) return row0;
  const did = [];
  // (the verb a headline left on the name goes from the title and is small in the line)
  const verb = verbTail(row0);
  const cut = (text) => String(text || '').replace(new RegExp(`\\s+${escapeRe(verb)}(?![\\p{L}\\p{N}])`, 'u'), '');
  const row = verb ? { ...row0, title: cut(row0.title), surface: cut(row0.surface), line: row0.line ? row0.line.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(verb)}(?![\\p{L}\\p{N}])`, 'gu'), verb.toLowerCase()) : row0.line } : row0;
  if (verb) did.push(`"${verb}" is no name`);
  let { title, line } = row;
  const heads = ownOf(row).map(headOf);
  // names: the subject's own words as its headlines spell them, in the title and the line alike
  const names = tokens(row.surface || '').map((w) => [w, speltAs(w, heads)]).filter(([a, b]) => a !== b);
  if (names.length) { title = respell(title, names); line = line ? respell(line, names) : line; did.push('spelling'); }
  // (and where the headlines are split on a handle's capitals, the title's spelling is the row's: the line never spells it another
  // way. "Cyberleek GTA 6 leak" over "CyberLeek threatens ...": judges, 2026-10-11. Only a word no dictionary knows: a handle)
  const handles = tokens(respell(row.surface || '', names)).filter((w) => w.length >= 4 && !W.inDict(w.toLowerCase()) && !W.isFirstName(w.toLowerCase())).map((w) => [w, w]);
  if (line && handles.length) { const same = respellAll(line, handles); if (same !== line) { line = same; did.push('one spelling'); } }
  const parts = titleParts({ ...row, title, surface: respell(row.surface || '', names) });
  if (parts) {
    const lineKeys = new Set(keysOf(line || '').map((k) => W.stem(k)));
    const need = Math.max(MODIFIER_HEADLINES, Math.ceil(MODIFIER_SHARE * ownOf(row).filter(isOutlet).length));
    let middle = parts.middle.filter((w) => {
      // (a name between them is who else it is about: "Chet Hanks Andre feud" stays)
      if (lineKeys.has(stemOf(w)) || headlinesSaying(row, w) >= need) return true;
      did.push(`dropped "${w}"`);
      return false;
    });
    // (a word that is no name is in lower case: the line writes it small)
    middle = middle.map((w) => {
      const small = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u').test(String(line || '').slice(1));
      const capital = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'u').test(String(line || '').slice(1));
      if (/^\p{Lu}\p{Ll}+$/u.test(w) && small && !capital && W.isDictWord(w.toLowerCase())) { did.push('sentence case'); return w.toLowerCase(); }
      return w;
    });
    let noun = parts.noun;
    const exact = EXACT_NOUNS.find(([loose, re]) => keyOf(noun) === loose && re.test(line || ''));
    if (exact) { noun = exact[2]; did.push(`noun "${exact[2]}"`); }
    if (keyOf(noun) === 'ban' && !middle.length) {
      const phrase = nounPhrase(row, 'ban');
      if (phrase) { middle = phrase.split(' '); did.push(`"${phrase} ban"`); }
    }
    const next = [parts.surface, ...middle, noun].join(' ');
    if (next.split(/\s+/).length <= TITLE_WORDS_MAX) title = next;
  }
  if (title === row0.title && line === row0.line && !handles.length) return row0;
  return { ...row, title, line, ...(names.length || handles.length ? { spelt: [...names, ...handles] } : {}), desk: [...(row.desk || []), ...did] };
}

// ---------- a thing's row is led by the person it is about ----------
/**
 * People-drama about a shop, a brand or a show is searched by the person in it: when a row's subject is no person's name and every
 * one of its own headlines (three or more) names the same person, the title leads with that person ("Kelly Clarkson Art of Play
 * backlash"), and the person is who the row is about. The subject, the noun and the id are untouched.
 */
function personLed(row) {
  if (!isTalk(row) || !row.drama) return row;
  const surface = String(row.surface || '');
  const first = keysOf(surface)[0];
  // (a thing's name, told from a person's by what no person's name has: a small word inside it, an ampersand, a number. A name the
  // dictionary of first names does not know is still a person's: "Kourtney Kardashian")
  if (!first || !/\b(?:of|the|and|for|in|at|with)\b|&|\d/i.test(surface)) return row;
  const heads = ownOf(row).map(headOf);
  if (heads.length < 3) return row;
  const counts = new Map();
  for (const head of heads) {
    const seen = new Set();
    const ws = tokens(head);
    for (let i = 0; i + 1 < ws.length; i++) {
      const [a, b] = [ws[i], ws[i + 1]];
      if (!/^\p{Lu}\p{Ll}+$/u.test(a) || !/^\p{Lu}[\p{L}'’-]+$/u.test(b) || !W.isFirstName(a.toLowerCase()) || W.isDictWord(b.toLowerCase())) continue;
      const name = `${a} ${b}`;
      if (!seen.has(name)) { seen.add(name); counts.set(name, (counts.get(name) || 0) + 1); }
    }
  }
  const best = [...counts].sort((x, y) => y[1] - x[1])[0];
  if (!best || best[1] < heads.length || keyOf(row.title).includes(keyOf(best[0]))) return row;
  // (a backlash against the shop is not against the person who called it out: led by the person, the row is titled by the two
  // names, the way it is searched, and the line says who did what to whom. Judges, 2026-10-11: "Kelly Clarkson Art of Play
  // backlash" read as a backlash against her)
  const theirs = row.family === 'backlash' || row.family === 'feud';
  const parts = theirs ? titleParts(row) : null;
  const title = parts && !parts.middle.length ? `${best[0]} ${parts.surface}` : `${best[0]} ${row.title}`;
  if (title.split(/\s+/).length > TITLE_WORDS_MAX) return row;
  const also = [keyOf(best[0]), ...((row.meta && row.meta.also) || []).filter((k) => k !== keyOf(best[0]))];
  return { ...row, title, meta: { ...row.meta, person: false, also }, desk: [...(row.desk || []), `led by ${best[0]}`] };
}

// ---------- a work's row is about the creator it happened to ----------
const CREATOR_ROLE = /(?<![\p{L}\p{N}])(YouTuber|streamer|TikToker|influencer|content creator|vlogger|podcaster)(?:['’]s)?(?![\p{L}\p{N}])/iu;
// what happens to a person, never to a game or a show
const PERSONAL_NOUNS = new Set(['ban', 'arrest', 'apology', 'firing', 'suspension', 'lawsuit', 'allegations', 'charges', 'death threats', 'threats']);
/**
 * A row titled by a game, a film or a show whose noun is something that happens to a person ("Hellraiser Revival ban") is a
 * creator's story when most of its headlines say so ("YouTuber permanently banned for Hellraiser: Revival video"): the title says
 * whose ban it is ("Hellraiser Revival YouTuber ban"), and the row is the creators' own. The subject, the noun and the id are untouched.
 */
function roleLed(row) {
  if (!isTalk(row) || !row.point || !['game', 'show', 'film', 'work'].includes(row.point.kind) || !PERSONAL_NOUNS.has(keyOf(row.noun || ''))) return row;
  const parts = titleParts(row);
  const heads = ownOf(row).filter(isOutlet).map(headOf);
  if (!parts || parts.middle.length || heads.length < 3) return row;
  const counts = new Map();
  for (const head of heads) { const m = head.match(CREATOR_ROLE); if (m) { const k = m[1].toLowerCase(); counts.set(k, { n: ((counts.get(k) || {}).n || 0) + 1, spelt: m[1] }); } }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  if (!best || best.n * 2 < heads.length) return row;
  const role = /^(?:youtuber|tiktoker)$/i.test(best.spelt) ? (best.spelt.toLowerCase() === 'youtuber' ? 'YouTuber' : 'TikToker') : best.spelt.toLowerCase();
  const title = `${parts.surface} ${role} ${parts.noun}`;
  if (title.split(/\s+/).length > TITLE_WORDS_MAX) return row;
  return { ...row, title, tier: 'creator', drama: true, meta: { ...row.meta, creator: true }, desk: [...(row.desk || []), `a ${role}'s ${parts.noun}`] };
}

// ---------- rows that are no talking point ----------
/** The other side of a feud two outlets agree on (a name both print beside the subject), as spelt; null when there is none. */
function feudSide(row) {
  const family = TN.FAMILY.get(row.family) || null;
  const subject = new Set(keysOf(row.subject));
  // (who the feud is with is the name its own headlines keep printing beside the subject, whether or not each says "feud": a
  // remark that fed a feud is told by one headline and named a feud by the next. Judges, 2026-10-11: "xQc feud", live, unlisted)
  const said = ownOf(row).filter(isOutlet);
  void family;
  const by = new Map();
  for (const r of said) {
    const seen = new Set();
    for (const w of tokens(headOf(r))) {
      const k = keyOf(w);
      if (!k || k.includes(' ') || subject.has(k) || STOP.has(k) || seen.has(k) || !/^\p{Lu}/u.test(w)) continue;
      if (W.isDictWord(k) && !W.isProperWord(k) && !W.isFirstName(k)) continue;
      seen.add(k);
      const c = by.get(k) || { outlets: new Set(), spelt: w };
      c.outlets.add(keyOf(r.outlet || ''));
      by.set(k, c);
    }
  }
  const best = [...by.values()].filter((c) => c.outlets.size >= 2).sort((a, b) => b.outlets.size - a.outlets.size)[0];
  return best ? best.spelt : null;
}
/** Why a talking point is no row at all, or null. */
function notARow(row) {
  if (!isTalk(row)) return null;
  const kind = row.point && row.point.kind;
  if (!row.noun && kind !== 'show' && kind !== 'game' && keyOf(row.title) === keyOf(row.surface || row.subject)) return 'a bare name says no what';
  if (row.family === 'feud') {
    const parts = titleParts(row);
    if (parts && !parts.middle.length && !feudSide(row)) return 'a feud with no other side two outlets agree on';
  }
  return null;
}

// ---------- words ----------
const termOf = (row) => keyOf(String(row.subject || row.title || '').replace(KIND_TAIL, ''));
/** Why a word row is no trend, or null: a day of the calendar, or one common noun with no meme page of its own behind it. */
function notATrend(row) {
  if (!isWordRow(row)) return null;
  const term = termOf(row);
  if (CALENDAR.has(term)) return 'a day of the calendar is no trend';
  const ws = term.split(' ').filter(Boolean);
  const signals = (row.point && row.point.signals) || {};
  const entry = signals.entry === true || (row.word && row.word.meaningFrom === 'Know Your Meme') || (row.meta && row.meta.listedBy === 'crazes');
  if (ws.length === 1 && W.isDictWord(ws[0]) && !W.isProperWord(ws[0]) && !entry) return 'a bare common noun is no trend';
  return null;
}
const QUESTION = /\?|^(?:what|who|why|how|where|when|is|are|does|do|did|can|should)\b|\b(?:explained|what to know|everything (?:we|you) know|here['’]s (?:what|how|why))\b/i;
/** A headline as a plain sentence: its outlet's tail and a kicker cut, a full stop. */
function asSentence(head) {
  const s = String(head || '').replace(/\s+/g, ' ').replace(/:\s+(?:what|here|everything|how|why)\b.*$/i, '').trim().replace(/[.…]+$/, '');
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : null;
}
/** The row's own news headline that says what is happening with a word: names it, is a statement in sentence case, no question or explainer; newest first. */
function newsLine(row) {
  const term = termOf(row);
  const first = term.split(' ')[0];
  const fits = ownOf(row).filter(isOutlet).filter((r) => !/know your meme|wikipedia/i.test(r.outlet || '')).map((r) => ({ r, head: headOf(r).replace(/\s+-\s+[^-]{2,40}$/, '') }))
    .filter(({ head }) => { const ks = keysOf(head); return ks.some((k) => k === first || W.stem(k) === W.stem(first)) && ks.length >= 5 && !titleCase(head) && !QUESTION.test(head.replace(/:\s+(?:what|here|everything|how|why)\b.*$/i, '')); })
    .sort((a, b) => (b.r.t || 0) - (a.r.t || 0));
  return fits.length ? asSentence(fits[0].head) : null;
}
/** A meme page's definition without its entry title ("X or X Female Draco Malfoy Art Trend is a ..." is "X is a ..."), nor a clause cut off after "combines". */
function mendDefinition(line) {
  let s = String(line || '');
  s = s.replace(/^(\S+(?:\s+\S+){0,3}?)\s+or\s+[^,.;]{3,80}?\s+(is|are|was|refers to)\s+/i, '$1 $2 ');
  // ("combines A" with no "with B" or "and B" after it was cut mid-thought: the half that is left says what it is built on)
  if (/\bthat combines\b/i.test(s) && !/\bthat combines\b.*\b(?:with|and)\b/i.test(s)) s = s.replace(/\bthat combines\b/i, 'based on');
  return s;
}
/**
 * A definition told as what the thing is, without its own name said again under its title: "Black cat clapping is a green-screen
 * meme ..." under "Black cat clapping meme" is "A green-screen meme ...". Only where the line opens with the row's own name.
 */
function plainDefinition(line, row) {
  const s = String(line || '');
  const m = s.match(/^(.{2,60}?)\s+(?:is|are|was)\s+(an?|the)\s+(.+)$/i);
  if (!m) return line;
  const name = keyOf(m[1].replace(/^the\s+/i, ''));
  const own = [termOf(row), keyOf(String(row.title || '').replace(KIND_TAIL, ''))].filter(Boolean);
  if (!name || !own.some((k) => k === name || k.includes(name) || name.includes(k))) return line;
  const rest = `${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()} ${m[3]}`;
  return rest.split(/\s+/).length >= 5 ? rest : line;
}
/** A word row with a line that says what is happening, or null when it has none to say. */
function wordRow(row) {
  if (!isWordRow(row)) return row;
  const from = row.word && row.word.meaningFrom;
  const encyclopedia = from === 'Wikipedia' || from === 'Wiktionary';
  if (encyclopedia && DEFINITION.test(row.line || '')) {
    const line = newsLine(row);
    return line ? { ...row, line, desk: [...(row.desk || []), 'news line'] } : null;
  }
  const mended = plainDefinition(mendDefinition(row.line), row);
  return mended !== row.line ? { ...row, line: mended, desk: [...(row.desk || []), 'definition mended'] } : row;
}
/** The meme a sound row belongs to: another word row told by the very same definition. The sound joins its line and its row goes. */
function joinSounds(rows) {
  const out = [];
  const gone = new Set();
  const meaningOf = (r) => (r.word && r.word.meaning ? keyOf(r.word.meaning) : null);
  for (const row of rows) {
    if (gone.has(row)) continue;
    const meaning = isWordRow(row) ? meaningOf(row) : null;
    const twin = meaning ? rows.find((r) => r !== row && !gone.has(r) && isWordRow(r) && meaningOf(r) === meaning) : null;
    if (!twin) { out.push(row); continue; }
    const [meme, sound] = row.kind === 'sound' ? [twin, row] : [row, twin];
    gone.add(twin);
    // (the first of the two keeps the place; told as the meme, with its sound named when the line does not already)
    const named = keysOf(meme.line || '').join(' ').includes(keysOf(sound.title).slice(0, 2).join(' '));
    const line = sound.kind === 'sound' && meme.line && !named ? `${meme.line.replace(/[.]$/, '')}, set to ‘${sound.title}’.` : meme.line;
    out.push({ ...meme, engineRank: row.engineRank, heat: Math.max(meme.heat, sound.heat), line, desk: [...(meme.desk || []), `joined "${sound.title}"`] });
  }
  return out;
}

// ---------- one story, one row ----------
const mentionsName = (head, subject) => { const ks = ` ${keyOf(head)} `; const s = keyOf(subject); const last = s.split(' ').pop(); return ks.includes(` ${s} `) || (s.split(' ').length <= 2 && last.length > 3 && ks.includes(` ${last} `) && !W.isDictWord(last)); };
/**
 * A row led by a person (`personLed`: a shop's or a brand's row about one person) and that person's own row are one story when
 * the person's own headlines keep naming the thing: "Kelly Clarkson Art of Play" and "Kelly Clarkson controversy".
 */
function ledTwin(a, b) {
  const led = (x, y) => isTalk(x) && isTalk(y) && (x.desk || []).some((d) => /^led by /.test(d)) && ((x.meta && x.meta.also) || [])[0] === keyOf(y.subject) &&
    // (the person's own headlines name the thing, or both rows' headlines keep printing the same other names: "Pretty Woman", "Brooklyn")
    (ownOf(y).filter((r) => mentionsName(headOf(r), x.surface || x.subject)).length >= SAME_STORY_MENTIONS || sharedNames(x, y).length >= SAME_STORY_MENTIONS);
  return led(a, b) || led(b, a);
}
/** The capitalised words, neither row's subject, that two or more headlines of each row print. */
function sharedNames(a, b) {
  const subjects = new Set([...keysOf(a.subject), ...keysOf(b.subject), ...keysOf(a.surface || ''), ...keysOf(b.surface || ''), ...((a.meta && a.meta.also) || []).flatMap((k) => k.split(' '))]);
  const namesOf = (row) => {
    const counts = new Map();
    for (const r of ownOf(row)) {
      const seen = new Set();
      for (const w of tokens(headOf(r))) { const k = keyOf(w); if (k.length < 4 || k.includes(' ') || subjects.has(k) || STOP.has(k) || seen.has(k) || !/^\p{Lu}/u.test(w)) continue; seen.add(k); counts.set(k, (counts.get(k) || 0) + 1); }
    }
    return new Set([...counts].filter(([, n]) => n >= SAME_STORY_MENTIONS).map(([k]) => k));
  };
  const mine = namesOf(a);
  return [...namesOf(b)].filter((k) => mine.has(k));
}
const TWIN_BACK_MS = 72 * 3600e3;
/** A row with what its folded twin's headlines of the last three days say, for the line writer to read (`meta.around`): nothing is counted or dated by them. */
function withTwin(row, twin, now) {
  const have = new Set([...ownOf(row), ...((row.meta && row.meta.around) || [])].map((r) => keyOf(r.title)));
  const more = ownOf(twin).filter((r) => (r.t || 0) >= now - TWIN_BACK_MS && !have.has(keyOf(r.title))).sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, 10);
  return more.length ? { ...row, meta: { ...row.meta, around: [...more, ...((row.meta && row.meta.around) || [])] }, desk: [...(row.desk || []), `reads "${twin.title}"`] } : row;
}
/** Whether two talking points are one story: the same noun family, and each one's headlines name the other's subject. */
function sameStory(a, b) {
  if (ledTwin(a, b)) return true;
  const storyOf = (row) => row.family || keyOf(row.noun || '');
  if (!isTalk(a) || !isTalk(b) || !storyOf(a) || storyOf(a) !== storyOf(b) || keyOf(a.subject) === keyOf(b.subject)) return false;
  const count = (row, other) => ownOf(row).filter((r) => mentionsName(headOf(r), other.surface || other.subject)).length;
  return count(a, b) >= SAME_STORY_MENTIONS && count(b, a) >= SAME_STORY_MENTIONS;
}

// ---------- the story's thread ----------
const THREAD_MIN_HEADLINES = 6;
const THREAD_NAME_HEADLINES = 3;
const THREAD_NAMES = 2;
const FLARE_FRESH_MS = 6 * 3600e3;
const FLARE_GAP_MS = 12 * 3600e3;
/** The other names a story's own headlines keep printing (three of them or more): who else it is about, as keys. */
function coNames(row) {
  const subject = new Set(keysOf(row.subject));
  const counts = new Map();
  for (const r of ownOf(row).filter(isOutlet)) {
    const seen = new Set();
    for (const w of tokens(headOf(r))) {
      const k = keyOf(w);
      if (!k || k.includes(' ') || k.length < 3 || subject.has(k) || STOP.has(k) || seen.has(k) || !/^\p{Lu}/u.test(w) || (W.isDictWord(k) && !W.isProperWord(k))) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return new Set([...counts].filter(([, n]) => n >= THREAD_NAME_HEADLINES).map(([k]) => k));
}
/**
 * A big story goes on in headlines that no longer print its subject's name: the people it is about answer each other ("RaKai
 * responds to Reggie's recent allegations against him" under "Kai Cenat allegations"). A newer outlet headline that says the story's
 * noun and names two of the people its own headlines keep naming is the story's own. One that lands after half a day of nothing,
 * inside the last six hours, from the creators' beat or a national outlet, is a new chapter: the row has flared again.
 * recent: [{ t (ms), title, outlet }] of the last days; isBeat(outlet): the creators' beat or a national outlet.
 */
function withThread(row, recent, now, isBeat = () => false) {
  if (!isTalk(row) || !row.drama || !row.family || !recent || !recent.length) return row;
  const own = ownOf(row);
  if (own.filter(isOutlet).length < THREAD_MIN_HEADLINES) return row;
  const family = TN.FAMILY.get(row.family) || null;
  const names = coNames(row);
  if (!family || names.size < THREAD_NAMES) return row;
  const have = new Set(own.map((r) => keyOf(headOf(r))));
  const newest = Math.max(...own.map((r) => r.t || 0));
  const more = recent.filter((r) => r.t > newest && r.t <= now && r.title && TN.says(r.title, family)).map((r) => ({ r, head: headOf(r) }))
    .filter(({ head }) => !have.has(keyOf(head)) && new Set(keysOf(head).filter((k) => names.has(k))).size >= THREAD_NAMES)
    .sort((a, b) => a.r.t - b.r.t);
  if (!more.length) return row;
  const seen = new Set();
  const added = more.filter(({ head }) => { const k = keyOf(head); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(({ r }) => ({ t: r.t, title: r.title, outlet: r.outlet || null, k: isBeat(r.outlet || '') ? 'beat' : 'outlet', thread: true }));
  const first = added[0];
  const flared = first.t - newest >= FLARE_GAP_MS && now - first.t <= FLARE_FRESH_MS && isBeat(first.outlet || '');
  const timeline = row.meta.timeline || {};
  const chapter = flared && !(timeline.chapter && timeline.chapter.t >= first.t) ? { t: first.t, text: asSentence(headOf(first)), source: first.outlet, name: null, flare: true } : timeline.chapter || null;
  return { ...row, meta: { ...row.meta, own: [...row.meta.own, ...added], timeline: { ...timeline, chapter } }, desk: [...(row.desk || []), `thread +${added.length}${flared ? ', flared again' : ''}`] };
}

// ---------- told by whom ----------
/** A claim only posts or clips carry, told as theirs: "..., according to a clip of the stream." Never "reports say" with no report. */
function toldBy(row) {
  if (!isTalk(row) || !row.line || !/,\s+reports say\.?$/i.test(row.line)) return row;
  const own = ownOf(row);
  if (!own.length || own.some(isOutlet)) return row;
  const clips = own.some((r) => kindOfItem(r) === 'clip' || kindOfItem(r) === 'upload');
  const tail = clips ? 'according to a clip going around' : 'according to posts on the streamer boards';
  return { ...row, line: row.line.replace(/,\s+reports say\.?$/i, `, ${tail}.`), desk: [...(row.desk || []), 'told by posts'] };
}

/**
 * The editor's pass over one audience's rows, in the engine's order. Returns { rows, notes: [{ title, did }] }: the rows that
 * stand (a new object where one changed), ranked again from 1. opts: { recent: [{ t (ms), title, outlet }] (the store's outlet headlines
 * of the last days, for a story's thread), now (ms), isBeat(outlet) }.
 */
function edit(rows, { recent = [], now = Date.now(), isBeat = () => false } = {}) {
  const notes = [];
  const note = (row, did) => notes.push({ title: row.title, did });
  let kept = [];
  for (const row of rows) {
    const why = notARow(row) || notATrend(row);
    if (why) { note(row, `left out: ${why}`); continue; }
    let next = nobodyRow(row);
    if (!next) { note(row, 'left out: a placeholder name with nothing beside it'); continue; }
    next = wordRow(next);
    if (!next) { note(row, 'left out: only an encyclopedia defines it, no headline says what is happening'); continue; }
    next = withThread(toldBy(roleLed(personLed(retitle(next)))), recent, now, isBeat);
    if (next !== row) note(row, `${next.title !== row.title ? `now "${next.title}"; ` : ''}${(next.desk || []).join(', ')}`);
    kept.push(next);
  }
  // one story, one row: the higher row stands
  const merged = [];
  const absorbed = new Map();
  for (const row of kept) {
    // (a third row of a story may name only the second's subject: what a row took in still speaks for it)
    const twin = merged.find((m) => sameStory(m, row) || (absorbed.get(m) || []).some((x) => sameStory(x, row)));
    if (twin) {
      note(row, `left out: the same story as "${twin.title}"`);
      // (a person's own row folded into the row that person leads: its headlines are that story's too, for the line)
      const kept = ledTwin(twin, row) ? withTwin(twin, row, now) : twin;
      if (kept !== twin) merged[merged.indexOf(twin)] = kept;
      absorbed.set(kept, [...(absorbed.get(twin) || []), row]);
      if (kept !== twin) absorbed.delete(twin);
      continue;
    }
    merged.push(row);
  }
  // (nor is a moment a second row of a talking point's story: its headline names the point's subject and says its noun)
  const told = merged.filter((r) => isTalk(r) && r.noun);
  const sameWord = (a, b) => a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5);
  const repeats = (m) => told.find((p) => mentionsName(m.title, p.surface || p.subject) && keysOf(m.title).some((k) => sameWord(k, keyOf(p.noun).split(' ').pop())));
  kept = joinSounds(merged.filter((row) => { const twin = row.type === 'moment' ? repeats(row) : null; if (twin) note(row, `left out: the moment of "${twin.title}"`); return !twin; }));
  // (two rows never share a title: the later one keeps the engine's)
  const titles = new Set();
  kept = kept.map((row) => { if (!titles.has(keyOf(row.title))) { titles.add(keyOf(row.title)); return row; } const back = rows.find((r) => r.cardKey === row.cardKey); return back ? { ...row, title: back.title } : row; });
  return { rows: kept.map((row, i) => (row.engineRank === i + 1 ? row : { ...row, engineRank: i + 1 })), notes };
}

/** The rows with their names spelt the desk's way in whatever line they now carry: a line written after the desk's pass is respelt too. */
const respellLines = (rows) => rows.map((row) => { if (!row.spelt || !row.line) return row; const line = respellAll(row.line, row.spelt); return line === row.line ? row : { ...row, line }; });

// ---------- order ----------
const DAY_SECONDS = 86400;
const FADING_PAGE_DAYS = 7;
const CELEBRITY_LIFT_HEAT = 40;
const THIN_OUTLETS = 2;
const FORMAT_LIFT_HEAT = 30;
const FRESH_DAYS = 4;
const MORE_TURN = 3;
// done to the subject, not by them: a robbery is the day's crime news about a name, nothing anyone argues over
const VICTIM_NOUN = /(?:^|\s)(?:robbery|burglary|carjacking|break-in|mugging|home invasion)$/i;
/** How many different outlets tell a row. */
const outletCount = (row) => new Set(ownOf(row).filter(isOutlet).map((r) => keyOf(r.outlet || '')).filter(Boolean)).size;
/** The newest sign of life a row has (ms), 0 with none: its newest own item, or for a format only its page lists, when that page was last written. */
const pulseOf = (row) => Math.max(0, ...ownOf(row).map((r) => r.t || 0), Number.isFinite(row.meta && row.meta.pageT) ? row.meta.pageT : 0);
/**
 * The page laid out again once each row's status and start are known. opts: { statusOf(row): 'rising' | 'peaking' | 'fading',
 * startedOf(row): epoch seconds or null, now (epoch seconds), pageSize }.
 *
 * The page is what is argued about today (judges, 2026-10-11: five fading rows on a page of twenty, a six-day-old fading story at
 * row 10 above three rising ones):
 *   1 creators' stories still going, told by an outlet (the engine's own order; one a single outlet tells follows the ones two tell)
 *   2 the rest of the people-drama still going: the engine's own page rows, and a celebrity's rising story it kept under the page
 *   3 only when the page still has room: people-drama that is fading, a week old at most, the creators' first
 * Things to film take rows 6, 9, 12, 15 and 18: a word, a sound or a format still going that has a start to show, the ones rising
 * first, then the ones with the newest sign of life; never one that is fading. A robbery or a break-in is crime news about a name,
 * a trade rumour is the sports page's, a profile says no event: none of them is brought up to the page.
 * Under the page, through "Show more": the people-drama still waiting and the things to film, in turns, ahead of politics, sport,
 * film and hard news, whatever their search.
 */
function order(rows, { statusOf = (r) => r.engineStatus, startedOf = null, now = null, pageSize = PAGE } = {}) {
  if (rows.length <= 1) return rows;
  const live = (r) => statusOf(r) !== 'fading';
  const sourced = (r) => ownOf(r).some(isOutlet);
  const wasOnPage = (r) => r.engineRank <= pageSize;
  const startAt = (r) => (startedOf ? startedOf(r) : null);
  // (with no starts handed in, none is held against a row)
  const hasStart = (r) => !startedOf || Number.isFinite(startedOf(r));
  const ageDays = (r) => { const at = startAt(r); return Number.isFinite(at) && Number.isFinite(now) ? (now - at) / DAY_SECONDS : null; };
  // (a fading row a week old or more is nobody's heads-up: never on the page. One whose age is unknown is not held to it)
  const stale = (r) => !live(r) && (ageDays(r) ?? 0) > FADING_PAGE_DAYS;
  // (a gaming moment people argue about is the creators' world too: a leak, a ban, a feud around a game. Owner, 2026-10-08, "cover more")
  const gaming = (r) => r.kind === 'talk' && isTalk(r) && !!r.point && r.point.kind === 'game' && !!r.family && TN.DRAMA_FAMS.has(r.family);
  const creators = (r) => r.tier === 'creator' || gaming(r);
  // (sport only when it turns into drama: a trade rumour is the sports page's, whatever its search. Owner, 2026-10-08)
  const sportsNews = (r) => r.tier === 'sports' && (!r.family || r.family === 'rumors' || !TN.DRAMA_FAMS.has(r.family));
  const victimNews = (r) => r.kind === 'talk' && VICTIM_NOUN.test(String(r.title || ''));
  // (a row whose one line is a profile or a feature's opening says no event: it keeps its place in the list and gets none on the page)
  const noEvent = (r) => PROFILE_LINE.test(String(r.line || ''));
  // (a casting rumour is film news, whoever it is about: under "Show more" with the rest of it. IDEAS-SPEC, top 20)
  const rumourNews = (r) => r.kind === 'talk' && r.family === 'rumors' && !creators(r);
  // (every card on the page says when it started: a story whose start is not known yet waits under it. Judges, 2026-10-11)
  const drama = rows.filter((r) => r.kind === 'talk' && (r.drama || gaming(r)) && !noEvent(r) && !sportsNews(r) && !victimNews(r) && !rumourNews(r) && hasStart(r));
  const thin = (r) => outletCount(r) < THIN_OUTLETS;
  const leadAll = drama.filter((r) => creators(r) && live(r) && sourced(r) && (r.heat >= CREATOR_LEAD_HEAT || wasOnPage(r)));
  const lead = [...leadAll.filter((r) => !thin(r)), ...leadAll.filter(thin)];
  const leadSet = new Set(lead);
  // (a people-drama row comes up to the page only with an outlet behind it: a celebrity's only while it is rising at a heat the
  // page would have listed; a sports rumour or a quiet celebrity row the engine kept off the page stays off)
  const lifted = (r) => sourced(r) && r.heat >= CELEBRITY_LIFT_HEAT && (r.tier === 'celebrity' || r.tier === 'creator') && (statusOf(r) === 'rising' || (ageDays(r) !== null && ageDays(r) <= FRESH_DAYS));
  const second = drama.filter((r) => !leadSet.has(r) && live(r) && (wasOnPage(r) || lifted(r)));
  const fadingFill = drama.filter((r) => !live(r) && !stale(r) && (wasOnPage(r) || (creators(r) && sourced(r) && r.heat >= CREATOR_LEAD_HEAT)));
  const third = [...fadingFill.filter(creators), ...fadingFill.filter((r) => !creators(r))];
  const filmable = rows.filter((r) => (r.kind === 'word' || r.kind === 'sound') && live(r) && !!r.line && hasStart(r));
  // (the engine's own page picks and what is rising under them at a heat worth a row, by the newest sign of life: a meme written
  // up this week sits above one nobody has touched in a fortnight. Judges, 2026-10-11: a three-week-old meme held a row while
  // fresher ones sat outside the page)
  const formats = filmable.filter((r) => wasOnPage(r) || (statusOf(r) === 'rising' && r.heat >= FORMAT_LIFT_HEAT)).map((r, i) => ({ r, i })).sort((a, b) => pulseOf(b.r) - pulseOf(a.r) || a.i - b.i).map((x) => x.r);
  const stories = [...lead, ...second];
  const storySet = new Set([...stories, ...third]);
  const formatSet = new Set(formats);
  // (the engine's own page rows that are neither: a moment or a huge story it gave a row; never a fading one a week old)
  const others = rows.filter((r) => wasOnPage(r) && !storySet.has(r) && !formatSet.has(r) && !stale(r) && hasStart(r) && !(r.kind === 'word' || r.kind === 'sound') && !(r.kind === 'talk' && (noEvent(r) || victimNews(r) || rumourNews(r) || (r.drama && sportsNews(r)))));
  const placed = new Set();
  const page = [];
  const fq = [...formats];
  const sq = [...stories];
  const tq = [...third];
  const oq = [...others];
  for (let at = 1; at <= pageSize; at++) {
    const next = (FORMAT_ROWS.includes(at) && fq.length ? fq.shift() : null) || sq.shift() || oq.shift() || fq.shift() || tq.shift();
    if (!next) break;
    page.push(next);
    placed.add(next);
  }
  // under the page: who is still waiting among the people-drama (the creators' first, what is still going first) and the things to
  // film, in turns of three; then everything else as the engine ranked it
  const rest = rows.filter((r) => !placed.has(r));
  const people = (r) => r.kind === 'talk' && (r.drama || gaming(r)) && (creators(r) || r.tier === 'celebrity') && !sportsNews(r) && !victimNews(r) && !rumourNews(r) && !stale(r) && sourcedOrPosted(r);
  const waiting = rest.filter(people);
  const peopleQ = [...waiting.filter((r) => creators(r) && live(r)), ...waiting.filter((r) => !creators(r) && live(r)), ...waiting.filter((r) => creators(r) && !live(r)), ...waiting.filter((r) => !creators(r) && !live(r))];
  const filmQ = rest.filter((r) => (r.kind === 'word' || r.kind === 'sound' || r.kind === 'moment') && live(r));
  const inQueues = new Set([...peopleQ, ...filmQ]);
  const tail = rest.filter((r) => !inQueues.has(r));
  const more = [];
  while (peopleQ.length || filmQ.length) {
    const turn = more.length % MORE_TURN === MORE_TURN - 1 && filmQ.length ? filmQ : peopleQ.length ? peopleQ : filmQ;
    more.push(turn.shift());
  }
  return [...page, ...more, ...tail];
}
const sourcedOrPosted = (r) => ownOf(r).length > 0;

module.exports = { edit, order, respellLines, respellAll, verbTail, ledTwin, sharedNames, withTwin, roleLed, plainDefinition, withThread, coNames, personLed, nobodyRow, qualifierOf, retitle, titleParts, speltAs, nounPhrase, notARow, feudSide, notATrend, wordRow, newsLine, mendDefinition, joinSounds, sameStory, toldBy,
  PLACEHOLDER, CALENDAR, FORMAT_ROWS };
