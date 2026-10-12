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
const TP = require('../engine/talking-points');
const W = require('../engine/wording');
const HL = require('../engine/hot-list');
const TL = require('../engine/talk-lines');
const { keyOf, homeGeos } = require('./util');

const PAGE = 20;
// (one thing to film after every two stories: judges, 2026-10-12, six of them back to back at rows 9 to 14)
const FORMAT_ROWS = [3, 6, 9, 12, 15, 18];
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
// what is called off, as headlines name it, and the word a title says it by
const CALLED_OFF_THING = '(concerts?|shows?|tour dates|tour|dates|gigs?|festival|performances?|appearances?|events?|residency|wedding|premiere|screening|panel|podcast|interview|series|season)';
const CALLED_OFF = '(?:cancell?ed|called off|scrapped|axed|postponed|removed from)';
const THING_THEN_OFF = new RegExp(`(?<![\\p{L}\\p{N}])${CALLED_OFF_THING}(?![\\p{L}\\p{N}])[^.;:!?—–]{0,70}?(?<![\\p{L}\\p{N}])${CALLED_OFF}(?![\\p{L}\\p{N}])`, 'iu');
const OFF_THEN_THING = new RegExp(`(?<![\\p{L}\\p{N}])(?:cancel(?:s|l?ed|l?ing)?|calls? off|scraps?|axes?|postpones?)\\s+(?:[\\p{L}\\p{N}&’'-]+\\s+){0,3}?${CALLED_OFF_THING}(?![\\p{L}\\p{N}])`, 'iu');
const THING_WORD = { concerts: 'concert', shows: 'show', 'tour dates': 'tour', dates: 'tour', gigs: 'gig', performances: 'performance', appearances: 'appearance', events: 'event' };
/**
 * What a person's "cancellation" is a cancellation of, as two of the row's own outlets (and half of those that tell it) say:
 * "concert", "tour", "show"; or null when they tell no thing, so it is the person who was dropped. "Chris Brown cancellation" over
 * "Usher, Chris Brown concert at Paycor Stadium canceled" said he had been cancelled: reviewers, 2026-10-12.
 */
function calledOffThing(row) {
  const heads = ownOf(row).filter(isOutlet).map(headOf);
  const counts = new Map();
  let told = 0;
  for (const head of heads) {
    if (!/cancel|called off|scrapped|axed|postponed|removed from/i.test(head)) continue;
    told += 1;
    const m = head.match(THING_THEN_OFF) || head.match(OFF_THEN_THING);
    if (!m) continue;
    const thing = THING_WORD[m[1].toLowerCase()] || m[1].toLowerCase();
    counts.set(thing, (counts.get(thing) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const all = [...counts.values()].reduce((a, b) => a + b, 0);
  return best && all >= 2 && all * 2 >= told ? best[0] : null;
}
// what a thing that got out is, when it was no leak; what a death at a place was
const MEDIA_NOUNS = ['photo', 'video', 'post', 'clip', 'picture', 'selfie'];
const DEATH_CAUSES = ['attack', 'crash', 'shooting', 'fire', 'collapse', 'explosion', 'stabbing'];
const NOUN_SAID_SHARE = 0.3;
const NOUN_UNSAID_SHARE = 0.2;
/**
 * The word of `options` most of the row's outlet headlines say (three in ten at least, and two), while they hardly say `instead`
 * (under two in ten; null: not asked); else null. A title's noun is what its headlines call the thing: "Tom Welling reflection
 * leak" stood over forty headlines of a photo he posted himself (judges, 2026-10-12).
 */
function thingSaid(row, instead, options) {
  const heads = ownOf(row).filter(isOutlet);
  if (heads.length < 3) return null;
  if (instead && headlinesSaying(row, instead) >= NOUN_UNSAID_SHARE * heads.length) return null;
  const best = options.map((w) => [w, headlinesSaying(row, w)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= Math.max(2, NOUN_SAID_SHARE * heads.length) ? best[0] : null;
}
const SEVERAL_OFF = /(?<![\p{L}\p{N}])(?:cancel\w*|call\w* off|scrap\w*|axe[sd]?|pull\w*)(?![\p{L}\p{N}])[^.;:!?]{0,50}?(?<![\p{L}\p{N}])(?:tour dates|dates|shows|concerts|gigs)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:tour dates|dates|shows|concerts|gigs)(?![\p{L}\p{N}])[^.;:!?]{0,40}?(?<![\p{L}\p{N}])(?:cancell?ed|called off|scrapped|axed|pulled)(?![\p{L}\p{N}])/iu;
/** Whether two of the row's outlets say several dates were called off: a tour's cancellations, never one concert's. */
const severalOff = (row) => new Set(ownOf(row).filter(isOutlet).filter((r) => SEVERAL_OFF.test(headOf(r))).map((r) => keyOf(r.outlet || ''))).size >= 2;
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
    // (what got out was no leak when its own headlines call it a photo he posted)
    if (keyOf(noun) === 'leak') { const thing = thingSaid(row, 'leak', MEDIA_NOUNS); if (thing) { noun = thing; did.push(`noun "${thing}"`); } }

    if (keyOf(noun) === 'ban' && !middle.length) {
      const phrase = nounPhrase(row, 'ban');
      if (phrase) { middle = phrase.split(' '); did.push(`"${phrase} ban"`); }
    }
    // (a title says what its headlines do: a concert that was called off is a concert cancellation, never the person's own)
    if (keyOf(noun) === 'cancellation' && !middle.length) {
      const thing = calledOffThing(row);
      if (thing) { middle = [thing]; did.push(`"${thing} cancellation"`); }
      // (several dates called off are a tour's: four stadiums are no one concert's cancellation. Judges, 2026-10-12)
      if (thing && severalOff(row)) { middle = ['tour']; noun = 'cancellations'; did.push('several dates'); }
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
  // (nor is an arrest, an allegation, a scam, a lawsuit, a threat, a ban or a firing at the shop the person's own: "Kelly Clarkson
  // Art of Play arrest" would say she was arrested where a clerk was. Unless the row's own line says it is theirs, the two names
  // stand without the noun. Reviewers, 2026-10-12)
  const personal = LED_PERSONAL.has(String(row.family || '')) || LED_PERSONAL.has(keyOf(row.noun || ''));
  const own = personal && !!row.line && (row.family === 'arrest' ? TP.arrestOf(row.line, keyOf(best[0])) === 'own' : TP.claimedOf(row.line, keyOf(best[0])));
  const theirs = row.family === 'backlash' || row.family === 'feud' || (personal && !own);
  const parts = theirs ? titleParts(row) : null;
  // (and once the thing has answered, the two names have a noun again: it is a feud, two sides, and the title says so. Judges,
  // 2026-10-12: "Kelly Clarkson Art of Play" has no noun)
  const answered = (row.family === 'backlash' || row.family === 'feud') && !!parts && !parts.middle.length &&
    heads.some((h) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(parts.surface).replace(/\s+/g, '\\s+')}(?:['’]s)?\\s+(?:\\p{L}+\\s+){0,2}?${ANSWERS}(?![\\p{L}\\p{N}])`, 'iu').test(h));
  const two = parts && !parts.middle.length ? `${best[0]} ${parts.surface}` : null;
  const title = two ? (answered && `${two} feud`.split(/\s+/).length <= TITLE_WORDS_MAX ? `${two} feud` : two) : `${best[0]} ${row.title}`;
  if (title.split(/\s+/).length > TITLE_WORDS_MAX) return row;
  const also = [keyOf(best[0]), ...((row.meta && row.meta.also) || []).filter((k) => k !== keyOf(best[0]))];
  // (and a feud's line tells both sides: the newest outlet headline in which the thing answers the person by name, in sentence case,
  // no question, says the claim and that it was answered. "Art of Play's Brooklyn store faces backlash from Kelly Clarkson" told
  // neither: judges, 2026-10-12)
  const answer = answered && title.endsWith(' feud') ? ownOf(row).filter((r) => isOutlet(r) && !r.blocked).map((r) => ({ r, head: headOf(r) }))
    .filter(({ head }) => !titleCase(head) && !QUESTION.test(head) && new RegExp(`(?<![\\p{L}\\p{N}])${ANSWERS}(?![\\p{L}\\p{N}])`, 'iu').test(head) && keyOf(head).includes(keyOf(best[0])) && keyOf(head).includes(keyOf(parts.surface)) && head.split(/\s+/).length >= 7)
    .sort((a, b) => (b.r.t || 0) - (a.r.t || 0))[0] : null;
  const line = answer ? asSentence(TL.tidyLine(answer.head)) : null;
  return { ...row, title, ...(line ? { line } : {}), meta: { ...row.meta, person: false, also }, desk: [...(row.desk || []), `led by ${best[0]}`, ...(line ? ['both sides'] : [])] };
}

const ANSWERS = '(?:responds?|responded|fires? back|fired back|hits? back|hit back|claps? back|clapped back|reacts?|reacted|answers?|answered|replies|replied|addresses|addressed)';
const LED_PERSONAL = new Set(['arrest', 'charges', 'allegations', 'scam', 'fraud', 'lawsuit', 'threats', 'death threats', 'ban', 'firing', 'quit', 'suspension']);

// ---------- a name is whole ----------
const NAME_SUFFIX = /^(?:Jr|Sr|II|III|IV)\.?$/;
/**
 * A person's name as their own headlines and the search print it: a title cut at a shorter name that is someone else's is given its
 * last word back. "Heather Thompson allegations" over headlines about Heather Thompson Day, searched as "heather thompson day", is
 * "Heather Thompson Day allegations"; "Marvin Harrison trade rumors" for "marvin harrison jr" is the son's. Only when most of the
 * headlines that name them print the longer run as one name and a search of the row's own spells it too. The subject and the id
 * are untouched (reviewers, 2026-10-12: the follow and the names file carried the wrong person).
 */
function wholeName(row) {
  if (!isTalk(row)) return row;
  const surface = String(row.surface || '').trim();
  if (!surface || surface.split(/\s+/).length < 2) return row;
  const heads = ownOf(row).map(headOf);
  const naming = heads.filter((h) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(surface).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(h));
  if (naming.length < 3) return row;
  const counts = new Map();
  for (const h of naming) {
    const m = h.match(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(surface).replace(/\s+/g, '\\s+')}\\s+(\\p{Lu}[\\p{L}’'-]*\\.?)`, 'iu'));
    if (m && (NAME_SUFFIX.test(m[1]) || !titleCase(h))) counts.set(m[1].replace(/\.$/, ''), (counts.get(m[1].replace(/\.$/, '')) || 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] * 2 <= naming.length) return row;
  const longer = `${surface} ${best[0]}`;
  const searched = ((row.meta && row.meta.trends) || []).some((t) => ` ${keyOf(t.keyword)} `.includes(` ${keyOf(longer)} `));
  if (!searched || keyOf(row.title).includes(keyOf(longer))) return row;
  const title = String(row.title).replace(new RegExp(`^${escapeRe(surface)}(?![\\p{L}\\p{N}])`, 'iu'), longer);
  if (title === row.title || title.split(/\s+/).length > TITLE_WORDS_MAX) return row;
  return { ...row, title, surface: longer, desk: [...(row.desk || []), `the name is ${longer}`] };
}

// ---------- a format is no sound ----------
const SAYS_AUDIO = /\b(?:audio|sounds?|songs?|track|remix|lyrics?|sings?|sung|music|beat|voice-?over|soundbite|tune)\b/i;
/**
 * A row filed as a sound whose own line tells a format (photos with text, a way of filming) and names no audio is a format: it sits
 * under Words, its ideas say "trend", and "See examples" searches for the trend. The month's page calls "Stop the wedding" a
 * "trending TikTok audio turning wedding regrets into carousels", and the card's line is the carousels: the owner's own example of
 * a format was the only row under Sounds, with ideas about its "sound" (reviewers, 2026-10-12). The id is untouched: a word's and
 * a sound's natural key are one.
 */
function formatRow(row) {
  if (row.kind !== 'sound' || row.type !== 'point' || !row.point || !row.line || SAYS_AUDIO.test(row.line)) return row;
  return { ...row, kind: 'word', point: { ...row.point, kind: 'craze' }, desk: [...(row.desk || []), 'a format, not a sound'] };
}
// the platforms' own spellings, wherever a row's title or line names them in small letters ("... trend on tiktok")
const BRANDS = [['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['instagram', 'Instagram'], ['twitch', 'Twitch'], ['netflix', 'Netflix'], ['reddit', 'Reddit'], ['snapchat', 'Snapchat'], ['spotify', 'Spotify'], ['chatgpt', 'ChatGPT']];
const brandCase = (text) => BRANDS.reduce((s, [low, spelt]) => s.replace(new RegExp(`(?<![\\p{L}\\p{N}@#])${low}(?![\\p{L}\\p{N}])`, 'g'), spelt), String(text || ''));
/** A row's title and line with the platforms spelt their own way and its apostrophes curled as the cards print them. */
function spellRow(row) {
  const curl = (s) => String(s || '').replace(/(\p{L})'(\p{L})/gu, '$1’$2');
  const title = curl(brandCase(row.title));
  const line = row.line ? brandCase(row.line) : row.line;
  return title === row.title && line === row.line ? row : { ...row, title, line };
}

// ---------- a moment's card: a short title, and a line that is another sentence ----------
const MOMENT_TITLE_MAX = 64;
const MOMENT_SHARED = 2;
const MOMENT_NAME_MAX = 4;
const MOMENT_KEYWORD_WORDS = 6;
const CLAUSE_CUT = /\s+(?:as|after|amid|while|during|over|following|ahead of|because|despite)\s+|[,;:]\s+|\s+[–—-]\s+/g;
const SMALL_WORD_CUT = /\s+(?:for|to|with|at|in|on|by|from|about|into|of)\s+/g;
// what a headline says was done or felt, that its line must say too before a title may: the title is never surer than its line
const MOMENT_CLAIM = /(?<![\p{L}\p{N}])(?:boo(?:ed|s|ing)?|slam(?:med|s)?|blast(?:ed|s)?|mock(?:ed|s)?|troll(?:ed|s)?|roast(?:ed|s)?|dragged|ripped|accus\w+|criticis\w+|criticiz\w+|backlash|outrage\w*|furious|fury|humiliat\w+|shamed?|cancel(?:led|ed)|heckl\w+|jeer\w*)(?![\p{L}\p{N}])/iu;
// (a stop after an initial or a short title ends no sentence: "... since U.K. return" was cut at "U.K.", review run of 2026-10-12)
const SENTENCE_STOP = /[.!?](?=\s|$)/g;
const NOT_AN_END = /(?:^|[\s.(‘“'"])(?:\p{L}|Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|No)\.$/u;
const firstSentence = (text) => {
  const s = String(text || '').trim();
  if (!s) return null;
  let first = s;
  for (const m of s.matchAll(SENTENCE_STOP)) {
    const upTo = s.slice(0, m.index + 1);
    if (m[0] === '.' && upTo.length < s.length && NOT_AN_END.test(upTo)) continue;
    first = upTo;
    break;
  }
  first = first.trim();
  return /[.!?]['’"”]?$/.test(first) ? first : `${first}.`;
};
/** Whether a headline prints its subject's name (its last word, owned or not). */
const namedIn = (head, subject) => {
  const key = keysOf(subject);
  const last = key[key.length - 1];
  return !!last && String(head || '').split(/\s+/).some((w) => keyOf(w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/i, '')) === last);
};
const sameText = (a, b) => { const [x, y] = [keyOf(String(a || '').replace(/…$/, '')), keyOf(String(b || '').replace(/…$/, ''))]; return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x)); };
/** The subject as its headline prints it in full: the capitalised run that holds the subject's last word ("Prince Harry", "Strictly Come Dancing"). */
function momentName(head, subject) {
  const key = keysOf(subject);
  if (!key.length) return String(subject || '').trim();
  const raw = String(head || '').split(/\s+/).filter(Boolean);
  const bare = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const at = raw.findIndex((w) => keyOf(bare(w).replace(/[’']s$/i, '')) === key[key.length - 1]);
  if (at < 0 || titleCase(head)) return String(subject).trim();
  const cap = (w) => /^\p{Lu}/u.test(bare(w));
  const ends = (w) => /[’']s$/i.test(bare(w)) || /[,;:]$/.test(w);
  let from = at;
  let to = at;
  while (from > 0 && cap(raw[from - 1]) && !ends(raw[from - 1])) from -= 1;
  while (to + 1 < raw.length && cap(raw[to + 1]) && !ends(raw[to])) to += 1;
  let words = raw.slice(from, to + 1).map((w) => bare(w).replace(/[’']s$/i, ''));
  // (an outlet's own tag before the name is no part of it: "BBC Strictly Come Dancing")
  while (words.length > key.length && /^\p{Lu}{2,5}$/u.test(words[0]) && !key.includes(keyOf(words[0]))) words = words.slice(1);
  return words.length && words.length <= MOMENT_NAME_MAX ? words.join(' ') : String(subject).trim();
}
/**
 * A moment as a card (reviewers, 2026-10-12: titles were raw headlines three lines long, with the same headline under them as the
 * line; "Prince Harry booed by rugby fans ..." stood over a line that says he attended a match):
 *   the line   its own sentence: why it is blowing up, the clip or the story, the first that tells the headline's story (two of its
 *              words beyond the name) and is not the headline said again
 *   the title  the name and the noun the headline and that line both say ("... backlash"); else the search people type for it, when
 *              one of the row's own searches names the subject and says a word of the headline ("Prince Harry rugby game
 *              appearance"); else the headline, cut where a clause ends. A claim the line does not make is never in the title.
 * With a short title the headline itself is the line when nothing better tells it. The card key and the id are untouched.
 */
/**
 * Whether a sentence tells the story a moment's headline tells: the same subject and the same event (reviewers, 2026-10-12:
 * "Strictly Come Dancing’s Amy Dowden praised" stood over "... Amy Dowden dealt another devastating blow as first contestant
 * eliminated", a week-old story that shares her name and nothing that happened; "The liberation London Film Festival premiere
 * interviews" over another film's). Two of the headline's words beyond the row's own name, one of them at least a word of what
 * happened and not somebody's name. And not its sibling: when the headline opens with words of its own before the row's subject
 * ("The liberation" before "London Film Festival") and the sentence has none of them and opens with something the headline never
 * says ("Ray Gunn ..."), the two are different things at the same place.
 */
function sameMoment(head, line, nameKeys, subjectKeys = []) {
  const parts = (text) => tokens(text).map((w) => ({ w, k: keyOf(w) })).filter(({ k }) => k.length > 2 && !k.includes(' ') && !STOP.has(k) && !nameKeys.has(k));
  const isTag = ({ w }) => /^\p{Lu}{2,5}$/u.test(w);
  const isName = ({ w, k }) => /^\p{Lu}/u.test(w) && !isTag({ w }) && (!W.isDictWord(k) || W.isFirstName(k) || W.isProperWord(k));
  const [h, l] = [parts(head), parts(line)];
  const headNames = new Set(h.filter(isName).map((x) => x.k));
  const headEvents = new Set(h.filter((x) => !isName(x) && !isTag(x)).map((x) => W.stem(x.k)));
  const lineNames = l.filter(isName);
  // (a sibling: the headline's own opening words are missing and the sentence opens with its own)
  const all = tokens(head).map((w) => keyOf(w));
  const at = all.findIndex((k) => subjectKeys.includes(k));
  const opening = at > 0 ? all.slice(0, at).filter((k) => k.length > 2 && !STOP.has(k) && !nameKeys.has(k)).map((k) => W.stem(k)) : [];
  const lineStems = new Set(l.map((x) => W.stem(x.k)));
  const headStems = new Set(h.map((x) => W.stem(x.k)));
  if (opening.length && !opening.some((k) => lineStems.has(k)) && l.length && !headStems.has(W.stem(l[0].k))) return false;
  const events = new Set(l.filter((x) => !isName(x) && !isTag(x)).map((x) => W.stem(x.k)).filter((k) => headEvents.has(k)));
  const names = new Set(lineNames.map((x) => x.k).filter((k) => headNames.has(k)));
  return events.size >= 1 && events.size + names.size >= MOMENT_SHARED;
}
/** What a moment's headline is named by, beyond its words: the name it prints for the row's subject, the subject, and an outlet's tag in capitals ("BBC"). */
function momentNameKeys(row, head) {
  const tags = String(head || '').split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => /^\p{Lu}{2,5}$/u.test(w)).map((w) => keyOf(w));
  return new Set([...keysOf(momentName(head, row.subject || '')), ...keysOf(row.subject || ''), ...tags]);
}
/** Whether a sentence tells a moment's own story (`sameMoment`), and is not the headline or the title said again (the headline itself will do under a short title). */
function momentTells(row, line) {
  if (!row || row.type !== 'moment' || !row.moment || !line) return false;
  const head = String(row.moment.headline || '').trim();
  if (sameText(line, row.title)) return false;
  return sameText(line, head) ? !sameText(row.title, head) : sameMoment(head, line, momentNameKeys(row, head), keysOf(row.subject || ''));
}
/**
 * The searches that are a moment's own: one that names its subject and whose words beyond the name are its headline's (two of them,
 * and half at least). A search for the subject alone, "london film festival", "strictly come dancing week 3", is the wider thing's:
 * its figure is not the headline's to carry (reviewers, 2026-10-12: "500K+ searches" on one film's premiere interviews).
 */
function momentSearches(row, head, nameKeys) {
  const subject = keysOf(row.subject || '');
  const headStems = [...new Set(keysOf(head).filter((k) => k.length > 2 && !STOP.has(k) && !nameKeys.has(k)).map((k) => W.stem(k)))];
  const tells = (ks) => { const rest = ks.filter((k) => !nameKeys.has(k) && k.length > 2); const hit = rest.filter((k) => headStems.includes(W.stem(k))).length; return hit >= Math.min(MOMENT_SHARED, rest.length) && hit > 0 && hit * 2 >= rest.length; };
  return ((row.meta && row.meta.trends) || []).filter((t) => { const ks = keysOf(t.keyword); return ks.length > subject.length && ks.length <= MOMENT_KEYWORD_WORDS && subject.every((w) => ks.includes(w)) && tells(ks); });
}
function momentRow(row) {
  if (row.type !== 'moment' || !row.moment) return row;
  const m = row.moment;
  const head = String(m.headline || row.title || '').trim();
  if (!head) return row;
  const name = momentName(head, row.subject || '');
  // (an outlet's or a channel's tag in capitals is no word of the story: "BBC")
  const nameKeys = momentNameKeys(row, head);
  const stems = (text) => [...new Set(keysOf(text).filter((k) => k.length > 2 && !STOP.has(k) && !nameKeys.has(k)).map((k) => W.stem(k)))];
  const headStems = stems(head);
  const tells = (s) => !!s && !sameText(s, head) && sameMoment(head, s, nameKeys, keysOf(row.subject || ''));
  const own = [firstSentence(m.why), firstSentence(m.moment), firstSentence(m.story)].filter(Boolean).find(tells) || null;
  // (the searches that are this headline's own: the only ones whose figure its card may carry. lib/describe.js demandOf)
  const headSearches = momentSearches(row, head, nameKeys).map((t) => t.key).filter(Boolean);
  const claim = head.match(MOMENT_CLAIM);
  const backed = (s) => !claim || (!!s && keysOf(s).some((k) => W.stem(k) === W.stem(keyOf(claim[0]))));
  const did = [];
  let title = null;
  // (a short title leads with the subject's name: only over a headline that prints it. "Harry" over a headline about Meghan Markle
  // made "Harry Meghan prince rugby game appearance", review run of 2026-10-12)
  const named = namedIn(head, row.subject || '');
  const fam = TN.familiesIn(head).find((x) => TN.DRAMA_FAMS.has(x.f.key));
  if (named && fam && own && TN.says(own, fam.f) && keysOf(name).length) title = `${name} ${fam.f.noun(fam.surface)}`;
  if (!title && named) {
    const subject = keysOf(row.subject || '');
    // (the search is this headline's story when its words beyond the name are the headline's: two of them, and half at least; one
    // shared "appearance" tied a rugby match to another person's lunch)
    const typedTells = (ks) => { const rest = ks.filter((k) => !nameKeys.has(k) && k.length > 2); const hit = rest.filter((k) => headStems.includes(W.stem(k))).length; return hit >= Math.min(MOMENT_SHARED, rest.length) && hit > 0 && hit * 2 >= rest.length; };
    const typed = ((row.meta && row.meta.trends) || []).map((t) => ({ t, ks: keysOf(t.keyword) }))
      .filter(({ ks }) => ks.length > subject.length && ks.length <= MOMENT_KEYWORD_WORDS && subject.every((w) => ks.includes(w)) && typedTells(ks) &&
        !ks.some((k) => MOMENT_CLAIM.test(k)))
      .sort((a, b) => (b.t.volume || 0) - (a.t.volume || 0))[0];
    if (typed && keysOf(name).length) title = `${name} ${typed.ks.filter((k) => !nameKeys.has(k)).join(' ')}`;
  }
  let line;
  if (title) {
    did.push('a short title');
    line = own || firstSentence(head);
  } else {
    // (the headline, cut where a clause ends when it runs long; a claim in it that no line of its own makes leaves it without a line)
    // (where a clause ends; else before the last small word that fits: "... Amy Dowden praised" for "... praised for ‘perfect’
    // response to Brendan Cole’s criticism". Never mid-phrase with an ellipsis)
    const at = (re) => [...head.matchAll(re)].map((x) => x.index).filter((i) => i >= 24 && i <= MOMENT_TITLE_MAX);
    const cuts = at(CLAUSE_CUT).length ? at(CLAUSE_CUT) : at(SMALL_WORD_CUT);
    title = head.length > MOMENT_TITLE_MAX && cuts.length ? head.slice(0, cuts[cuts.length - 1]) : head;
    line = own && backed(own) ? own : null;
    if (title !== head) did.push('title cut at a clause');
  }
  if (sameText(line, title)) line = null;
  if ((line || null) !== (row.line || null)) did.push(line ? 'its own line' : 'no line of its own');
  return { ...row, title, line, meta: { ...row.meta, headSearches }, desk: [...(row.desk || []), ...did] };
}

// ---------- one function for every timeline sentence ----------
const REPORTS_SAY = /,\s+reports say\.?$/i;
/** A sentence told on reports where no outlet is among the row's own: told as the posts' or the clip's ("reports say" needs a report). */
function toldTail(row, text) {
  if (!text || !REPORTS_SAY.test(text)) return text;
  const own = ownOf(row);
  if (!own.length || own.some(isOutlet)) return text;
  const clips = own.some((r) => kindOfItem(r) === 'clip' || kindOfItem(r) === 'upload');
  return text.replace(REPORTS_SAY, `, ${clips ? 'according to a clip going around' : 'according to posts on the streamer boards'}.`);
}
/**
 * One headline of a row told as a timeline sentence (D4), or null when it cannot be: the engine's own telling (cleaned, sentence
 * case, a question or a line too long to cut refused, a cut that drops an outcome refused, a flat claim told as reported), then
 * told as the posts' where no outlet is among the row's own. Every sentence a timeline shows goes through here: the start, a
 * turn, a thread's new chapter (reviewers, 2026-10-12: a chapter was written from a raw Title Case question).
 * r: { t (ms), title, outlet, k? }; lex: the engine's lexicon. thread: the row's subject need not be named (a thread's headline
 * names the people the story is about, not always its subject).
 */
function tellEvent(row, r, lex, { thread = false } = {}) {
  if (!isTalk(row) || !r || !r.title || !lex) return null;
  if (W.isTitleCase(String(TN.cleanHeadline(r.title, r.outlet || '')).split(/\s+/))) return null;
  const meta = row.meta || {};
  const subject = thread ? '' : String(meta.subject || keyOf(row.subject || ''));
  const kind = kindOfItem(r);
  const family = row.family ? TN.FAMILY.get(row.family) || null : null;
  let text = null;
  // (the name as the engine spells it: a surface the desk made whole, "Marvin Harrison Jr", would be written into a headline that already has its "Jr.")
  try { text = TP.eventText({ title: r.title, outlet: r.outlet || null, fam: kind === 'post' ? 'reddit' : null, youtube: kind === 'upload' }, subject || keyOf(row.subject || ''), meta.surface || row.surface || row.subject || '', family, lex, []); } catch { text = null; }
  if (!text || QUESTION.test(text)) return null;
  return toldTail(row, text);
}
/** A row's timeline as the engine told it, held to the same: a tail that claims reports where there are none is the posts'. */
function timelineTold(row) {
  const tl = row.meta && row.meta.timeline;
  if (!isTalk(row) || !tl) return row;
  const fix = (x) => (x && x.text ? { ...x, text: toldTail(row, x.text) } : x);
  const next = { ...tl, first: fix(tl.first), latest: fix(tl.latest), chapter: fix(tl.chapter), replies: (tl.replies || []).map(fix) };
  return JSON.stringify(next) === JSON.stringify(tl) ? row : { ...row, meta: { ...row.meta, timeline: next } };
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
  // (nameless: its headlines name no creator anyone searches for, only a role. The page places it under the stories with a name)
  return { ...row, title, tier: 'creator', drama: true, nameless: true, meta: { ...row.meta, creator: true }, desk: [...(row.desk || []), `a ${role}'s ${parts.noun}`] };
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
  // (a description is nobody's name: "Ex Twitch firing", from "Ex-Twitch exec calls ...", had no person, no firing and no start.
  // Reviewers, 2026-10-12)
  if (DESCRIPTION_LED.test(keyOf(row.subject || ''))) return 'a description is no name';
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
  // (an everyday word with a years-old entry is a trend only while people are explaining the word itself: "Bro" listed on
  // "Warner Bros.", "tech bro" and a meme that ends in it. Judges, 2026-10-12)
  const spike = (row.word && row.word.searchSpike === true) || signals.searchSpike === true;
  if (row.meta && row.meta.established === true && ws.length <= 2 && !spike) {
    const explaining = new Set(ownOf(row).filter((r) => aboutTheWord(headOf(r), term)).map((r) => keyOf(r.outlet || ''))).size;
    if (explaining < ABOUT_WORD_OUTLETS) return 'an established word nobody is explaining';
  }
  return null;
}
const ABOUT_WORD_OUTLETS = 2;
const WORD_CUE = /\b(?:mean(?:s|ing)?|slang|term|word|phrase|definition|defined|explained|explainer|what is|what does|what are|gen z|gen alpha)\b/i;
const QUOTED = /[‘'"“]([^‘’'"“”]{1,80})[’'"”]/g;
/**
 * Whether a headline is about a word itself: it quotes the word alone, or it explains a word and carries this one outside any
 * longer quote ("What does ‘Just put the fries in the bag bro’ mean" explains the phrase, not "bro").
 */
function aboutTheWord(head, term) {
  const h = String(head || '');
  const t = keyOf(term);
  if (!t) return false;
  if ([...h.matchAll(QUOTED)].some((m) => keyOf(m[1]) === t)) return true;
  if (!WORD_CUE.test(h)) return false;
  return ` ${keyOf(h.replace(QUOTED, ' '))} `.includes(` ${t} `);
}
const DESCRIPTION_LED = /^(?:ex|former|ex wife|ex husband|late|then|self proclaimed|so called)(?:\s|$)/;
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
  // (and a word a Title Case blurb left with its capital right after a quoted name: "the ‘Mickey Mouse Clubhouse’ Inspired series")
  const afterQuote = (s) => String(s || '').replace(/([’”])\s+(\p{Lu}\p{Ll}+)(?=\s+\p{Ll})/gu, (m, q, w) => (W.inDict(w.toLowerCase()) && !W.isProperWord(w.toLowerCase()) && !W.isFirstName(w.toLowerCase()) ? `${q} ${w.toLowerCase()}` : m));
  const mended = afterQuote(plainDefinition(mendDefinition(row.line), row));
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
 *
 * **Only a headline that names the row's subject is its chapter or its press** (reviewers, 2026-10-12: "Megyn Kelly criticism",
 * six days old, read "Rising" and carried a flare for her followers on "Cornell University Cancels Homecoming Concert Amid Alleged
 * Gang Rape Fallout"). A headline of the thread that does not name the subject says the story is still told and nothing more: it
 * joins the row as kind `thread`, which is no press (it moves no count, no velocity, no graph), tells no line of the timeline and
 * flares nothing. It is still a turn of the story (`meta.threadAt`: after half a day of nothing, inside the last six hours): the
 * page counts the story's age from its newest turn, so the benchmark row, whose people answered each other that morning, is this
 * week's story whether or not the headline printed "Kai Cenat".
 */
function withThread(row, recent, now, isBeat = () => false, lex = null) {
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
    .map(({ r }) => ({ t: r.t, title: r.title, outlet: r.outlet || null, k: !mentionsName(headOf(r), row.subject) ? 'thread' : isBeat(r.outlet || '') ? 'beat' : 'outlet', thread: true }));
  // (the chapter is the first of them that names the subject, after half a day in which nothing of the row's own did)
  const first = added.find((r) => r.k !== 'thread') || null;
  const flared = !!first && first.t - newest >= FLARE_GAP_MS && now - first.t <= FLARE_FRESH_MS && isBeat(first.outlet || '');
  // (a turn of the story, whoever its headline names: what the page's order reads, never an alert, a badge or a line)
  const turned = added[0].t - newest >= FLARE_GAP_MS && now - added[0].t <= FLARE_FRESH_MS && isBeat(added[0].outlet || '');
  const timeline = row.meta.timeline || {};
  // (the chapter's sentence is told as every timeline sentence is, from the first of the thread's headlines that can be: a Title Case
  // question is no sentence. With none that can, the row has still flared again, and the timeline says nothing new)
  const told = flared ? added.filter((r) => r.k !== 'thread').map((r) => tellEvent(row, r, lex, { thread: true })).find(Boolean) || null : null;
  const chapter = flared && !(timeline.chapter && timeline.chapter.t >= first.t) ? { t: first.t, text: told, source: first.outlet, name: null, flare: true, named: true } : timeline.chapter || null;
  return { ...row, meta: { ...row.meta, own: [...row.meta.own, ...added], timeline: { ...timeline, chapter }, ...(turned ? { threadAt: added[0].t } : {}) },
    desk: [...(row.desk || []), `thread +${added.length}${flared ? ', flared again' : turned ? ', a turn' : ''}`] };
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

const OWN_ACT = /^(?:(?:already|now|also|again|still|publicly)\s+)*(?:threatens?|vows?|plans?|eyes|eyeing|teases?|announces?|says|tells|posts?|shares?|deletes?|apologi[sz]es|responds?|reacts?|addresses|confirms?|admits?|reveals?|may|might|could|will|wants?)(?![\p{L}\p{N}])/iu;
const OWN_SLIP = /^(?:accidentally|mistakenly|inadvertently)\s+\p{L}+s\s+(?:himself|herself|themself|themselves|an?\s|his\s|her\s|their\s)/iu;
const SOMEONE_SAYS = /(?<![\p{L}\p{N}])(?:accus\w+|alleg\w+|claims?|claimed|sued|suing|lawsuit|according to|police|prosecutors?|charged|arrest\w*)(?![\p{L}\p{N}])/iu;
/**
 * A line that opens with the subject's own public act, a threat, a plan, a post, a slip of their own, with nobody accusing anybody
 * in it, is on the record: it needs no "reports say" (judges, 2026-10-12: a leaker's own ultimatum, an actor's own Story, a
 * boxer's own plans, each told as if only rumoured). A claim someone else makes keeps its hedge.
 */
function ownAct(row) {
  if (!isTalk(row) || !row.line || !REPORTS_SAY.test(row.line)) return row;
  const surface = String(row.surface || '').trim();
  if (!surface || !row.line.toLowerCase().startsWith(surface.toLowerCase())) return row;
  const rest = row.line.slice(surface.length).trim();
  if (SOMEONE_SAYS.test(row.line) || !(OWN_ACT.test(rest) || OWN_SLIP.test(rest))) return row;
  return { ...row, line: row.line.replace(REPORTS_SAY, '.'), desk: [...(row.desk || []), 'the subject’s own act'] };
}
const PLACE_TAIL = /(?:^|\s)(?:park|zoo|stadium|arena|university|college|school|hospital|airport|mall|hotel|resort|museum|church|bridge|station|beach|island|county|festival|theatre|theater|restaurant|cafe|prison|jail|centre|center|gardens?)$/i;
/**
 * A row about a place is nobody's (judges, 2026-10-12, "Yorkshire Wildlife Park tiger death" filed under celebrity, and read as
 * if the tiger had died): it is never a celebrity's or a creator's, and a death there is titled by what happened, as its own
 * headlines call it ("... tiger attack"). The noun, the family and the id are untouched: it is still death news, under the page.
 */
function placeTier(row) {
  if (!isTalk(row) || row.drama) return row;
  const place = PLACE_TAIL.test(String(row.surface || ''));
  if (!place && !(row.meta && row.meta.person === false)) return row;
  const cause = place && keyOf(row.noun || '') === 'death' && /(?<![\p{L}\p{N}])death$/i.test(row.title) ? thingSaid(row, null, DEATH_CAUSES) : null;
  const title = cause ? row.title.replace(/death$/i, cause) : row.title;
  const tier = row.tier === 'celebrity' || row.tier === 'creator' ? 'other' : row.tier;
  if (title === row.title && tier === row.tier) return row;
  return { ...row, title, tier, meta: { ...row.meta, person: false }, desk: [...(row.desk || []), place ? 'a place is nobody' : 'no person', ...(cause ? [`noun "${cause}"`] : [])] };
}

/**
 * The editor's pass over one audience's rows, in the engine's order. Returns { rows, notes: [{ title, did }] }: the rows that
 * stand (a new object where one changed), ranked again from 1. opts: { recent: [{ t (ms), title, outlet }] (the store's outlet headlines
 * of the last days, for a story's thread), now (ms), isBeat(outlet) }.
 */
function edit(rows, { recent = [], now = Date.now(), isBeat = () => false, lex = null } = {}) {
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
    next = spellRow(momentRow(formatRow(next)));
    next = timelineTold(withThread(ownAct(toldBy(placeTier(roleLed(personLed(wholeName(retitle(next))))))), recent, now, isBeat, lex));
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
// (and a line the writer put in its place is held to `ownAct` as the engine's was: the subject's own act needs no "reports say";
// and it is said plainly, `plainLine`)
const respellLines = (rows) => rows.map((row) => { if (!row.spelt || !row.line) return row; const line = respellAll(row.line, row.spelt); return line === row.line ? row : { ...row, line }; }).map(ownAct).map(plainLine);
const DOUBLE_HEDGE = /(?<![\p{L}\p{N}])(accused of|accusations? of|allegations? of|alleged|allegedly|reportedly)\s+(?:an?\s+)?alleged(?:ly)?\s+/giu;
const QUOTED_WORD = /(\s[‘“])(\p{Lu}\p{Ll}+)(?=[’”])/gu;
/**
 * A line said plainly (judges, 2026-10-12): an accusation is hedged once ("accused of alleged sexual misconduct" is "accused of
 * sexual misconduct"), and one quoted word a Title Case headline capitalised is in lower case unless it is a name ("calls wife
 * and four kids ‘Demons’" is ‘demons’).
 */
function plainLine(row) {
  if (!row.line) return row;
  const line = String(row.line).replace(DOUBLE_HEDGE, '$1 ').replace(QUOTED_WORD, (m, open, w) => { const k = w.toLowerCase(); return W.inDict(k) && !W.isProperWord(k) && !W.isFirstName(k) ? `${open}${k}` : m; });
  return line === row.line ? row : { ...row, line };
}

// ---------- order ----------
const DAY_SECONDS = 86400;
const FADING_PAGE_DAYS = 7;
const CELEBRITY_LIFT_HEAT = 40;
const THIN_OUTLETS = 2;
const FORMAT_LIFT_HEAT = 30;
const FILM_PAGE_MAX = 7;
const FRESH_DAYS = 4;
const PAGE_FILL_HEAT = 28;
const MORE_TURN = 3;
// done to the subject, not by them: a robbery is the day's crime news about a name, nothing anyone argues over
const VICTIM_NOUN = /(?:^|\s)(?:robbery|burglary|carjacking|break-in|mugging|home invasion)$/i;
/** How many different outlets tell a row. */
/** How many kinds of creator-native signal are live on a row inside the last six hours (lib/native-desk.js nativeMeta), 0 with none. */
const nativeLive = (row) => { const n = row.meta && row.meta.native; return n && Number.isFinite(n.live) ? n.live : 0; };
const NATIVE_LEAD_KINDS = 2;
const CREATOR_WEIGHT = 2.1;
const RISING_WEIGHT = 1.2;
const NAMELESS_WEIGHT = 0.6;
const THIN_WEIGHT = 0.45;
const FRESH_FULL_DAYS = 2;
const SIMILAR_HEAT = 8;
/**
 * A list with the rows creators are talking about lifted: a row with a live creator-native signal goes ahead of the row before it
 * when that one has none and is of similar heat (eight points at most above it). Order is otherwise the list's own; a row never
 * passes one that is far hotter.
 */
function liftNative(rows) {
  const out = [...rows];
  for (let pass = 0; pass < out.length; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      if (nativeLive(out[i]) > 0 && nativeLive(out[i - 1]) === 0 && out[i - 1].heat - out[i].heat <= SIMILAR_HEAT) { [out[i - 1], out[i]] = [out[i], out[i - 1]]; moved = true; }
    }
    if (!moved) break;
  }
  return out;
}
const outletCount = (row) => new Set(ownOf(row).filter(isOutlet).map((r) => keyOf(r.outlet || '')).filter(Boolean)).size;
/**
 * The day of a row's newest sign of life (whole days since the epoch). Things to film are ordered by it, then by heat, then the
 * younger first: a chart read this cycle and one read an hour ago are equally alive, and between an app five weeks old and a game
 * three months old at the same heat the page takes the newer (live 2026-10-12: a Roblox game of July took the page's one row for
 * things over the month's No. 1 app, because its chart happened to be read later).
 */
const pulseDay = (row) => Math.floor(pulseOf(row) / 864e5);
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
  // (a game's story with no person in it, a leak, a build, a ban around a game, is a gaming moment: it takes a row for things to
  // film, never a people-drama row, and it never counts among them. Judges, 2026-10-12: "Cyberleek GTA 6 leak" at row 3)
  const gameMoment = (r) => gaming(r) && !r.drama;
  // (politics-as-usual, whoever it is about: a row whose line and half of whose outlet headlines are about a race, a party or an
  // office waits under the page. Judges, 2026-10-12: a councilmember, a candidate and a fundraiser under "Hasan Piker backlash")
  const politicsNews = (r) => {
    if (r.kind !== 'talk' || !POLITICS_SAID.test(String(r.line || ''))) return false;
    const heads = ownOf(r).filter(isOutlet).map(headOf);
    return heads.length >= 2 && heads.filter((h) => POLITICS_SAID.test(h)).length * 2 >= heads.length;
  };
  // (death news, a sentence, a verdict: under the page, whatever its search. IDEAS-SPEC, top 20)
  const somber = (r) => r.kind === 'talk' && HL.SOMBER.has(String(r.noun || ''));
  // (sport only when it turns into drama: a trade rumour is the sports page's, whatever its search. Owner, 2026-10-08)
  const sportsNews = (r) => r.tier === 'sports' && (!r.family || r.family === 'rumors' || !TN.DRAMA_FAMS.has(r.family));
  const victimNews = (r) => r.kind === 'talk' && VICTIM_NOUN.test(String(r.title || ''));
  // (a row whose one line is a profile or a feature's opening says no event: it keeps its place in the list and gets none on the page)
  const noEvent = (r) => PROFILE_LINE.test(String(r.line || ''));
  // (a casting rumour is film news, whoever it is about: under "Show more" with the rest of it. IDEAS-SPEC, top 20)
  const rumourNews = (r) => r.kind === 'talk' && r.family === 'rumors' && !creators(r);
  // (a row whose only demand is another country's searches is in the list, under "Show more", whatever it is: J5. Reviewers,
  // 2026-10-12: a US list's moments led with "100K+ searches in the UK". And since the joined run of 2026-10-12 a game's story
  // too: the engine never calls a story searched only abroad people-drama, but a game's was brought up to lead here on its noun
  // alone, so "Cyberleek GTA 6 leak" led the British and Australian lists under "50K+ US searches")
  const away = (r) => !!r.audience && r.audience !== 'mixed' && awayOnly(r);
  // (every card on the page says when it started: a story whose start is not known yet waits under it. Judges, 2026-10-11)
  const drama = rows.filter((r) => r.kind === 'talk' && (r.drama || gaming(r)) && !gameMoment(r) && !away(r) && !noEvent(r) && !sportsNews(r) && !victimNews(r) && !rumourNews(r) && !politicsNews(r) && !somber(r) && hasStart(r));
  const thin = (r) => outletCount(r) < THIN_OUTLETS;
  // (what creators are actually talking about right now, L10: a creators' story with two kinds of creator-native signal live comes
  // up to lead at a heat a little under the bar, and among the lead it goes ahead of a row of similar heat that has none)
  const talked = (r) => nativeLive(r) >= NATIVE_LEAD_KINDS;
  const leadAll = drama.filter((r) => creators(r) && live(r) && sourced(r) && (r.heat >= CREATOR_LEAD_HEAT || wasOnPage(r) || (talked(r) && r.heat >= CREATOR_LEAD_HEAT - SIMILAR_HEAT)));
  // (a story with a name leads; one its headlines give only a role, "a YouTuber", follows the rest that is still going)
  const named = leadAll.filter((r) => !r.nameless);
  const lead = [...liftNative(named.filter((r) => !thin(r))), ...liftNative(named.filter(thin))];
  const leadSet = new Set(leadAll);
  // (a people-drama row comes up to the page only with an outlet behind it: a celebrity's only while it is rising at a heat the
  // page would have listed; a sports rumour or a quiet celebrity row the engine kept off the page stays off)
  const lifted = (r) => sourced(r) && r.heat >= CELEBRITY_LIFT_HEAT && (r.tier === 'celebrity' || r.tier === 'creator') && (statusOf(r) === 'rising' || talked(r) || (ageDays(r) !== null && ageDays(r) <= FRESH_DAYS));
  const second = [...drama.filter((r) => !leadSet.has(r) && live(r) && (wasOnPage(r) || lifted(r))), ...leadAll.filter((r) => r.nameless)];
  const fadingFill = drama.filter((r) => !live(r) && !stale(r) && (wasOnPage(r) || (creators(r) && sourced(r) && r.heat >= CREATOR_LEAD_HEAT)));
  const third = [...fadingFill.filter(creators), ...fadingFill.filter((r) => !creators(r))];
  // (a thing to film has a line that says what it is: its own page's, a meme page's, a dictionary's, or one written from them. A
  // word known only by a news headline about it, "Internet trend bringing customers to Great Falls restaurants", tells a creator
  // nothing to do: it waits under the page until something defines it. Judges, 2026-10-11)
  const filmable = rows.filter((r) => (r.kind === 'word' || r.kind === 'sound') && live(r) && !!r.line && hasStart(r) && saysWhatItIs(r));
  // (the engine's own page picks and what is rising under them at a heat worth a row, by the newest sign of life: a meme written
  // up this week sits above one nobody has touched in a fortnight. Judges, 2026-10-11: a three-week-old meme held a row while
  // fresher ones sat outside the page)
  // (and what the platform sources picked for the page, M: a sound with its count, a format two roundups name, a craze with a number
  // of its own. The kinds take turns, so the things to film are a word, a sound, a format, a craze, and never five of one kind)
  // (and a gaming moment still going, told by an outlet, at a heat worth a row: it takes its turn among the things)
  const moments = rows.filter((r) => gameMoment(r) && live(r) && hasStart(r) && sourced(r) && !away(r) && (wasOnPage(r) || r.heat >= FORMAT_LIFT_HEAT));
  const formats = mixKinds([...filmable.filter((r) => wasOnPage(r) || (statusOf(r) === 'rising' && r.heat >= FORMAT_LIFT_HEAT) || (r.platform && r.platform.page)), ...moments].map((r, i) => ({ r, i })).sort((a, b) => pulseDay(b.r) - pulseDay(a.r) || b.r.heat - a.r.heat || (startAt(b.r) ?? 0) - (startAt(a.r) ?? 0) || a.i - b.i).map((x) => x.r));
  const stories = [...lead, ...second];
  // (what is still going is laid out by how much of a row it is worth today: its heat, doubled and a little more for a creators'
  // story, lifted while it is rising, cut for one a single outlet tells, one with no name in
  // it, and one whose newest turn is days behind. So the creators' stories lead, a celebrity's passes one only at more than twice
  // its heat, and a two-day-old story never sits under a fortnight-old one of the same size. Judges, 2026-10-12)
  const freshness = (r) => { const d = ageDays(r); return d === null || d <= FRESH_FULL_DAYS ? 1 : d <= FRESH_DAYS ? 0.85 : d <= FADING_PAGE_DAYS ? 0.7 : 0.55; };
  const pageScore = (r) => r.heat * (creators(r) ? CREATOR_WEIGHT : 1) * (statusOf(r) === 'rising' ? RISING_WEIGHT : 1) * (r.nameless ? NAMELESS_WEIGHT : 1) * (thin(r) ? THIN_WEIGHT : 1) * freshness(r);
  const byScore = (xs) => xs.map((r, i) => ({ r, i, s: pageScore(r) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.r);
  // (with room still on the page: the rest of the people-drama that is still going, a creator's or a celebrity's with an outlet
  // behind it, as the engine ranked it. Anything still going comes before anything fading)
  const taken = new Set(stories);
  // (never padded with weak ones: IDEAS-SPEC, heat under 28, a creators' under 24)
  // (nor with a story that has been going for more than a week without rising: that is the week's news, not today's argument)
  const thisWeek = (r) => statusOf(r) === 'rising' || ageDays(r) === null || ageDays(r) <= FADING_PAGE_DAYS;
  const liveRest = drama.filter((r) => !taken.has(r) && live(r) && sourced(r) && thisWeek(r) && ((creators(r) && r.heat >= CREATOR_LEAD_HEAT) || (r.tier === 'celebrity' && r.heat >= PAGE_FILL_HEAT)));
  const storySet = new Set([...stories, ...liveRest, ...third]);
  const formatSet = new Set(formats);
  // (the engine's own page rows that are neither: a moment or a huge story it gave a row; never a fading one a week old)
  // (nor a row whose only demand is another country's searches: `away`, above)
  const others = rows.filter((r) => wasOnPage(r) && !away(r) && !storySet.has(r) && !formatSet.has(r) && !stale(r) && hasStart(r) && !(r.kind === 'word' || r.kind === 'sound') && !(r.kind === 'talk' && (noEvent(r) || victimNews(r) || rumourNews(r) || politicsNews(r) || somber(r) || gameMoment(r) || (r.drama && sportsNews(r)))));
  const placed = new Set();
  const page = [];
  const capped = formats.some((r) => r.platform);
  let filmed = 0;
  const fq = [...formats];
  // (and among them a row creators are talking about goes ahead of one of similar heat that nobody is: liftNative)
  const sq = liftNative(byScore([...stories, ...liveRest]));
  const tq = [...third];
  const lq = [];
  const oq = [...others];
  for (let at = 1; at <= pageSize; at++) {
    // (a thing to film a platform source picked takes one of the page's own rows for things to film and no other: off those rows it
    // waits behind every story, still going or fading, so the page keeps its people-drama and the things to film stay about every
    // third row. The engine's own picks fill as they always did. M12)
    // (and with such rows among the picks the page holds seven things to film at most, about every third row: past that a story
    // that is fading still comes before an eighth, as it does before any pick off its own rows)
    const room = !capped || filmed < FILM_PAGE_MAX;
    // (and off those rows the people-drama comes first, what is still going and then what is fading, before anything else the
    // engine gave a row and before one more thing to film: judges, 2026-10-12, eleven people-drama rows on a page of twenty with
    // five more waiting under it)
    const next = (room && FORMAT_ROWS.includes(at) && fq.length ? fq.shift() : null) || sq.shift() || lq.shift() || tq.shift() || oq.shift() || (room ? takeOwn(fq) : null) || fq.shift();
    if (!next) break;
    if (formatSet.has(next)) filmed += 1;
    page.push(next);
    placed.add(next);
  }
  // under the page: who is still waiting among the people-drama (the creators' first, what is still going first) and the things to
  // film, in turns of three; then everything else as the engine ranked it
  const rest = rows.filter((r) => !placed.has(r));
  const people = (r) => r.kind === 'talk' && (r.drama || gaming(r)) && (creators(r) || r.tier === 'celebrity') && !sportsNews(r) && !victimNews(r) && !rumourNews(r) && !politicsNews(r) && !somber(r) && !stale(r) && sourcedOrPosted(r);
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
// (or the creators' side alone carries it: a row two kinds of creator-native signal made has no headline, and is still a story
// waiting under the page, never past the list's end. Judges, 2026-10-12: tracker-first rows buried or unlisted)
const sourcedOrPosted = (r) => ownOf(r).length > 0 || nativeLive(r) > 0;
/** Takes the first row of a queue that no platform source made (the engine's own pick), or null: the queue is changed in place, as `shift` changes it. */
const takeOwn = (queue) => { const at = queue.findIndex((r) => !r.platform); return at < 0 ? null : queue.splice(at, 1)[0]; };
const FILM_FAMILY = { sound: 'sound', format: 'format', challenge: 'format', craze: 'format', trend: 'format', filter: 'format', meme: 'format', product: 'thing', ai: 'thing', gaming: 'thing', game: 'thing' };
const POLITICS_SAID = /(?<![\p{L}\p{N}])(?:council ?members?|councilman|councilwoman|congress\w*|candidates?|campaign(?:s|ing)?|fundraisers?|senat(?:e|or|ors)|governor|mayor\w*|elections?|democrat\w*|republicans?|GOP|DSA|voters?|votes|ballot|primary|radical left|far[- ]right|far[- ]left|socialis[mt]|White House|Trump|Biden|Israel|Gaza|Palestin\w+)(?![\p{L}\p{N}])/iu;
// the order the kinds take their turns in: viral words, then sounds, then memes, formats and challenges, then games, products and AI trends
// (and, since 2026-10-12, a gaming moment before them: IDEAS-SPEC's own order)
const FILM_TURNS = ['word', 'sound', 'format', 'moment', 'thing'];
/** What kind of thing to film a row is, for the turns the kinds take: a word, a sound, a format (a meme, a craze, a challenge) or a thing (a game, a product, an AI trend). */
const filmFamily = (r) => (r.kind === 'talk' ? 'moment' : r.kind === 'sound' ? 'sound' : FILM_FAMILY[(r.platform && r.platform.sub) || (r.point && r.point.kind) || (r.word && r.word.kind) || ''] || 'word');
/**
 * The things to film with their kinds taking turns: a word, a sound, a format, a thing, and round again, each kind in the list's
 * own order (the newest sign of life first). So the page's five rows for things to film are never five sounds, or five games, while
 * a viral word or a meme waits. With no row a platform source made the list comes back as it was (the engine's picks keep the
 * order they had).
 */
function mixKinds(rows) {
  if (!rows.some((r) => r.platform)) return rows;
  const queues = FILM_TURNS.map((family) => rows.filter((r) => filmFamily(r) === family));
  const out = [];
  while (out.length < rows.length) for (const queue of queues) if (queue.length) out.push(queue.shift());
  return out;
}
const AWAY_SEARCH_MIN = 5000;
/** Whether the biggest search a row has is abroad for its audience and it has none at home worth a number (lib/describe.js awayOnly, said here on the row's own searches). */
function awayOnly(row) {
  const home = new Set(homeGeos(row.audience));
  const trends = (row.meta && row.meta.trends) || [];
  const best = (xs) => Math.max(0, ...xs.map((t) => t.volume || 0));
  return best(trends.filter((t) => !home.has(t.geo))) >= 4 * AWAY_SEARCH_MIN && best(trends.filter((t) => home.has(t.geo))) < AWAY_SEARCH_MIN;
}
const DEFINING_PAGE = /know your meme|wiktionary|wikipedia|dictionary|newengen|urban/i;
/** Whether a word's line rests on something that defines it: the month's formats page, a meme page, a dictionary (a line written from a news headline defines nothing more than the headline did). */
function saysWhatItIs(row) {
  if (row.meta && row.meta.listedBy === 'crazes') return true;
  // (a row a platform source made says so itself: its line is its page's, its dictionary's or its chart's, or only a question people type)
  if (row.platform) return !!row.platform.says;
  const from = (row.word && row.word.meaningFrom) || '';
  return !from || DEFINING_PAGE.test(from);
}

module.exports = { plainLine, ownAct, placeTier, aboutTheWord, thingSaid, severalOff, notATrend, calledOffThing, liftNative, nativeLive, sameMoment, momentSearches, mentionsName, edit, order, momentRow, momentTells, momentName, formatRow, wholeName, tellEvent, toldTail, timelineTold, spellRow, awayOnly, respellLines, respellAll, verbTail, ledTwin, sharedNames, withTwin, roleLed, plainDefinition, withThread, coNames, personLed, nobodyRow, qualifierOf, retitle, titleParts, speltAs, nounPhrase, notARow, feudSide, notATrend, wordRow, newsLine, mendDefinition, joinSounds, sameStory, toldBy,
  PLACEHOLDER, CALENDAR, FORMAT_ROWS, mixKinds, filmFamily, saysWhatItIs };
