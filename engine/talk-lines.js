'use strict';
/*
 * What most outlets say, for a talking point's one-line "what" [talk-nouns.js whatOf]: each outlet counted once, so one tabloid's
 * framing syndicated five times never outvotes fifteen outlets ("Feno Zellenko ... Hollinette Yarrard feud ... deathbed" against the
 * Lyselle Marrova feud everyone else reports).
 *   role     the word most outlets call the person ("partner" or "ex-fiance", never one outlet's "fiance"; "co-pilot", not "pilot")
 *   name     the other person most outlets name with the subject ("Lyselle Marrova" for Feno Zellenko, not "Hollinette Yarrard")
 *   hedge    a disease, an attack or a crash most outlets call suspected or unknown is never told flatly ("Plague outbreak expands")
 * and the line's punctuation as the card prints it (curly quotes, "and" for "&", "six decades", the title's spelling of the name).
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const { outletKey } = require('./util');

// the words a line calls the person by, in slots: the first of a slot's words in a line is its role
const ROLE_SLOTS = [
  [['ex-husband', /\bex-husband\b/i], ['ex-wife', /\bex-wife\b/i], ['ex-boyfriend', /\bex-boyfriend\b/i], ['ex-girlfriend', /\bex-girlfriend\b/i],
    ['ex-fiance', /\bex-fianc[eé]e?(?!\p{L})/iu], ['fiance', /(?<![\p{L}-])fianc[eé]e?(?!\p{L})/iu], ['partner', /\bpartner\b/i], ['husband', /(?<!ex-)\bhusband\b/i],
    ['wife', /(?<!ex-)\bwife\b/i], ['boyfriend', /(?<!ex-)\bboyfriend\b/i], ['girlfriend', /(?<!ex-)\bgirlfriend\b/i], ['baby daddy', /\bbaby daddy\b/i]],
  [['co-pilot', /\bco-?pilot\b|\bfirst officer\b/i], ['pilot', /(?<!co-?)\bpilot\b/i]],
];
// slots where the first word is the more exact one: once three outlets say it, a line saying only the loose word gets the penalty
// ("pilot" is also the victim in "co-pilot attacked pilot"; the attacker was the co-pilot)
const EXACT_SLOTS = new Set([1]);
const EXACT_MIN = 3;
const ROLE_MIN = 2; // outlets saying the top word
const ROLE_PENALTY = 1.5;
const NAME_MIN = 3;
const NAME_LEAD = 2; // the top name in at least twice the outlets of the next
const NAME_PENALTY = 1.5;
const NAME_BONUS = 1.5;
const NAME_MISSING = 1.5;
const HEDGE = /\b(?:suspected|possible|possibly|unknown|unexplained|mystery|mysterious|probable|likely|feared|alleged(?:ly)?|reported(?:ly)?|unconfirmed|is said to|investigat\w+)\b/i;
const HEDGED_FAMILIES = new Set(['outbreak', 'attack', 'crash', 'collapse']);
const HEDGE_SHARE = 0.4;
const HEDGE_PENALTY = 1.5;

/** The first role word of each slot in a line: Map(slot index -> word). */
function rolesIn(line) {
  const out = new Map();
  ROLE_SLOTS.forEach((slot, i) => {
    const hits = slot.map(([w, re]) => ({ w, m: line.match(re) })).filter((x) => x.m).sort((a, b) => a.m.index - b.m.index);
    if (hits.length) out.set(i, hits[0].w);
  });
  return out;
}

/** Outlets per key: Map(key -> Set(outlet)), each line's keys once. */
function outletsBy(lines, keysOf) {
  const by = new Map();
  for (const x of lines) for (const k of new Set(keysOf(x))) { const s = by.get(k) || new Set(); s.add(outletKey(x.outlet || '')); by.set(k, s); }
  return by;
}

/**
 * The majority checks over a name's usable lines ([{ line, outlet }]): a function scoring one line (a penalty for a minority role, a
 * minority other name, a flat claim most outlets hedge; a bonus for the majority name). nameRuns: talk-nouns.js nameRuns; subject: its
 * lowercase words.
 */
function majorityChecks(lines, { nameRuns, subject, family }) {
  const subj = subject.split(' ');
  // roles: per slot, the word most outlets use
  const topRole = ROLE_SLOTS.map((slot, i) => {
    if (EXACT_SLOTS.has(i)) {
      const exact = outletsBy(lines.filter((x) => slot[0][1].test(x.line)), () => ['e']).get('e');
      return exact && exact.size >= EXACT_MIN ? slot[0][0] : null;
    }
    const by = outletsBy(lines, (x) => (rolesIn(x.line).has(i) ? [rolesIn(x.line).get(i)] : []));
    const ranked = [...by.entries()].map(([w, s]) => [w, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return ranked.length && ranked[0][1] >= ROLE_MIN && (ranked.length < 2 || ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
  });
  // other names, from sentence-case lines (a Title Case line capitalises every word)
  const namesOf = (line) => (W.isTitleCase(line.split(/\s+/)) ? [] : nameRuns(line).filter((n) => !n.split(' ').some((w) => subj.includes(w))));
  const byName = outletsBy(lines, (x) => namesOf(x.line));
  const names = [...byName.entries()].map(([n, s]) => [n, s.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topName = names.length && names[0][1] >= NAME_MIN && (names.length < 2 || names[0][1] >= NAME_LEAD * names[1][1]) ? names[0][0] : null;
  const minority = new Set(topName ? names.slice(1).map(([n]) => n) : []);
  // hedges: a family most outlets hedge
  const famLines = family ? lines.filter((x) => family.re.test(x.line)) : [];
  const hedged = family && HEDGED_FAMILIES.has(family.key) && famLines.length >= 3 &&
    outletsBy(famLines.filter((x) => HEDGE.test(x.line)), () => ['h']).get('h')?.size >= HEDGE_SHARE * outletsBy(famLines, () => ['a']).get('a').size;
  return (line) => {
    let s = 0;
    const roles = rolesIn(line);
    topRole.forEach((w, i) => {
      if (!w || !roles.has(i)) return;
      if (EXACT_SLOTS.has(i) ? !ROLE_SLOTS[i][0][1].test(line) : roles.get(i) !== w) s -= ROLE_PENALTY;
    });
    if (topName) {
      const ns = namesOf(line);
      if (ns.includes(topName)) s += NAME_BONUS;
      else if (ns.length && ns.every((n) => minority.has(n))) s -= NAME_PENALTY;
      // (a line that names nobody else when most outlets name who it is with says less: "reveals romance with 1980s co-star")
      else if (!ns.length) s -= NAME_MISSING;
    }
    if (hedged && family.re.test(line) && !HEDGE.test(line)) s -= HEDGE_PENALTY;
    return s;
  };
}

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
// a small count before what it counts is a word in a plain sentence ("1 game" -> "one game"; never a rank, a season or a sum: "No. 1",
// "Season 2", "$8 million", "Top 5")
const SMALL_COUNT = /(?<![\d.,$£€#-]|(?:No\.|Season|Series|Part|Episode|Chapter|Week|Game|Round|Day|Top|Vol\.|Volume|Act|Level|Phase|Stage) )\b(\d) (decades?|games?|years?|months?|weeks?|days?|hours?|minutes?|times|counts?|people|men|women|children|kids|officials|players|officers|students|victims|suspects|fans)\b/g;
// a work's name in double quotes is printed as every other card prints one, in single quotes: “East of Eden” -> ‘East of Eden’ (a
// name: capitalised, five words at most, never a sentence someone said)
const WORK_QUOTE = /“(\p{Lu}[^“”,.!?]{0,40})”/gu;
const WORK_QUOTE_MAX = 5;
const workQuoted = (inner) => {
  const ws = inner.split(' ');
  return ws.length <= WORK_QUOTE_MAX && /^\p{Lu}/u.test(ws[ws.length - 1]) && !/^(?:I|We|You|He|She|They|It|This|That|My|Our)$/.test(ws[0]);
};
/** A line as the card prints it: curly quotes, "and" for a lone "&", "six decades" for "6 decades", a work's name in single quotes. */
function tidyLine(line) {
  let s = String(line || '').replace(/\s&\s/g, ' and ').replace(SMALL_COUNT, (m, n, d) => `${SMALL[Number(n)]} ${d}`);
  // (an article before a consonant: "An remixable green-screen meme" -> "A remixable ...")
  s = s.replace(/\b([Aa])n (?=[bcdfgjklmnpqrstvwxz][a-z])/g, '$1 ');
  // (a sum keeps its capital: "$200K", "$40M"; and to tase is a verb, whatever the brand: "cops tasing him")
  s = s.replace(/(\$\d+(?:\.\d+)?)([kmb])(?![\p{L}\p{N}])/gu, (m, n, u) => `${n}${u.toUpperCase()}`).replace(/(?<=\p{Ll}\s)Tas(ing|ed|es)\b/gu, 'tas$1');
  s = s.replace(/(^|[\s(\[{“‘—–-])'/g, '$1‘').replace(/'/g, '’');
  return s.replace(/(^|[\s(\[{‘—–-])"/g, '$1“').replace(/"/g, '”').replace(WORK_QUOTE, (m, inner) => (workQuoted(inner) ? `‘${inner}’` : m));
}

/**
 * A work's name the card's own headlines print in quotes is quoted in its line too, as every other card prints one: "Canadian Idol
 * judge Zaniel Ulmiss dies" -> "‘Canadian Idol’ judge ..." once QUOTED_MIN of them write 'Canadian Idol'. A name: capitalised, five words
 * at most, its last word capitalised or a number; one word only when it is the card's own film or show (own: "‘Lanterns’ writers
 * explain ..."), never a nickname ("Glibbleb"). The first mention, when it is not quoted already.
 */
const QUOTED_SPAN = /(?<![\p{L}\p{N}])[‘'“"](\p{Lu}[^‘’'“”"]{1,40}?)[’'”"](?![\p{L}\p{N}])/gu;
const QUOTED_MIN = 2;
function quoteWorks(line, titles, own = null) {
  if (!line) return line;
  const seen = new Map();
  for (const t of titles || []) {
    const inTitle = new Set();
    for (const m of String(t).matchAll(QUOTED_SPAN)) {
      const span = m[1].trim();
      const ws = span.split(/\s+/);
      const k = ws.join(' ').toLowerCase();
      if (ws.length > WORK_QUOTE_MAX || !/^[\p{Lu}\p{N}]/u.test(ws[ws.length - 1]) || /[.!?,:;]$/.test(span) || inTitle.has(k)) continue;
      inTitle.add(k);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  const ownKey = own ? String(own).trim().toLowerCase() : null;
  let out = line;
  for (const k of [...seen.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))) {
    if (seen.get(k) < QUOTED_MIN || (!k.includes(' ') && k !== ownKey)) continue;
    const src = k.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    // (quoted somewhere already: the line prints it its own way)
    if (new RegExp(`[‘'“"]${src}[’'”"]`, 'iu').test(out)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}‘'“"-])${src}(?![\\p{L}\\p{N}’'”"-])`, 'iu');
    const m = out.match(re);
    // (as a name: capitalised where the line prints it)
    if (m && /^\p{Lu}/u.test(m[0])) out = `${out.slice(0, m.index)}‘${m[0]}’${out.slice(m.index + m[0].length)}`;
  }
  return out;
}

/** A two-word name's middle name out, as the title spells it: "Jasade Quellin Wickenko" -> "Jasade Wickenko". */
function dropMiddleName(line, subject, surface) {
  const ws = String(surface || '').split(' ');
  if (!line || subject.split(' ').length !== 2 || ws.length !== 2) return line;
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (the line spells the name as the title does by now: a capitalised word between its two words is a middle name)
  return line.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(ws[0])}\\s+\\p{Lu}\\p{Ll}+\\.?\\s+${esc(ws[1])}(?![\\p{L}\\p{N}])`, 'u'), surface);
}

const PAIRED = new Set(['split', 'romance', 'feud']);
const PAIR_SHARE = 0.3; // the other name in this share of the family's outlets
const PAIR_FAME = 3; // and named this many times as often outside the story to lead the title
const HONORIFIC = new Set(['sir', 'dame', 'lord', 'lady', 'dr', 'president', 'prince', 'princess', 'king', 'queen']);
/**
 * The title's words with the other person of a split, a romance or a feud, when most of its outlets name one: a far more famous
 * partner leads ("Korette Fennsy Thalrel Lorrick split"), a feud says who with ("Feno Zellenko Marrova feud"), and an engagement or a wedding
 * is the famous one's, searched by their name alone ("Orrelle Neskiss engagement", not "Rouan Trevley engagement"). TN: talk-nouns.js
 * (passed in: it requires this module); noun: the card's noun word.
 */
const OWNED = new Set(['engagement', 'wedding']);
function pairedOf(tw, subject, f, press, wikiIndex, TN, noun = null) {
  if (!f || !PAIRED.has(f.key)) return tw;
  const subj = subject.split(' ');
  if (tw.slice(0, subj.length).join(' ') !== subject) return tw;
  const fam = press.filter((r) => !r.blocked && !r.youtube && f.re.test(r.title) && !W.isTitleCase(r.title.split(/\s+/)));
  if (fam.length < PAIR_MIN) return tw;
  const by = new Map();
  for (const r of fam) {
    for (const n0 of new Set(TN.nameRuns(r.title))) {
      const ws = n0.split(' ');
      const n = ws.length === 3 && HONORIFIC.has(ws[0]) ? ws.slice(1).join(' ') : n0;
      if (n.split(' ').some((w) => subj.includes(w))) continue;
      by.set(n, (by.get(n) || new Set()).add(outletKey(r.outlet)));
    }
  }
  const outlets = new Set(fam.map((r) => outletKey(r.outlet))).size;
  const ranked = [...by.entries()].map(([n, o]) => [n, o.size]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length || ranked[0][1] < PAIR_SHARE * outlets || (ranked[1] && ranked[0][1] < 2 * ranked[1][1])) return tw;
  const other = ranked[0][0];
  // (a person: a given name, or a page Wikipedia's top lists print: "korette fennsy")
  if (!(TN.personLike(other, null) || (wikiIndex && wikiIndex.has(other))) || tw.some((w) => other.split(' ').includes(w))) return tw;
  if (f.key === 'feud') return tw.length < 5 ? [...subj, other.split(' ').slice(-1)[0], ...tw.slice(subj.length)] : tw;
  // (fame: read every day, the median of the week's Wikipedia top-1000 days, a day off the list counting nothing: Korette Fennsy's page is
  // in it every day, Thalrel Lorrick's only the days of the split)
  const fame = (n) => {
    const m = wikiIndex && wikiIndex.get(n);
    const days = wikiIndex ? [...new Set([...wikiIndex.values()].flatMap((x) => [...x.keys()]))].sort().slice(-7) : [];
    const v = days.map((d) => (m && m.get(d)) || 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  };
  if (fame(other) < PAIR_FAME * Math.max(PAIR_FAME_FLOOR, fame(subject))) return tw;
  if (OWNED.has(noun)) return [...other.split(' '), ...tw.slice(subj.length)];
  return other.split(' ').length + tw.length <= 5 ? [...other.split(' '), ...tw] : tw;
}
const PAIR_MIN = 4;
const PAIR_FAME_FLOOR = 5000;

// ---------- a plain line: who + what, not a headline ----------
// a tabloid's tail after the account ("... as family left in the dark about sudden loss", "..., leaving fans heartbroken") and a quoted
// soundbite after a colon ("...: 'Light of our lives'")
const TABLOID_TAIL = /(?:,?\s+as\s+(?:(?:his|her|their|the)\s+)?(?:family|fans|friends|loved ones|co-?stars?|kids|children|wife|husband|widow|mother|father)\b.*|,\s+leaving\s+(?:fans|family|friends|viewers)\b.*)$/i;
const SOUNDBITE = /:\s*[‘'“"].{2,}[’'”"]\s*$/;
// (an aggregator's tail: "...: who 10 outlets blamed")
const AGGREGATOR_TAIL = /:\s+(?:who|how|what)\s+\d+\s+(?:outlets|sources)\b.*$/i;
// (the backdrop after "amid", never naming the card's subject: "... says he plans legal action amid Clover Boys drama")
const AMID_TAIL = /,?\s+amid\s+[^,;:]{2,60}$/i;
// (a second sentence of comment after the account: "A 'Verity' meme is outshining the 'Verity' movie. They have nothing to do with
// each other."; never after a title's abbreviation, "Dr. Fremtt")
const SECOND_SENTENCE = /(?<!\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Gov|Sen|Rep|Gen|Lt|Col|Sgt|Capt|No|Inc|Ltd|Co|Corp|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec))(?<=[\p{Ll}\p{N}’'”"])\.\s+\p{Lu}[^.!?]{2,}$/u;
// (who said so, tagged on after a colon, is told as a clause: "... receives risk warning: FDA" -> "... receives risk warning, FDA says")
const SAID_BY = /:\s+(FDA|CDC|DOJ|FBI|NFL|NBA|NTSB|TSA|DHS|LAPD|NYPD|[Pp]olice|[Cc]ops|[Oo]fficials|[Aa]uthorities|[Pp]rosecutors|[Ss]heriff|[Cc]oroner|[Ff]amily|[Ll]awyer|[Aa]ttorney|[Rr]ep|[Ss]tudy|[Dd]octors)$/;
const SAID_BY_PLURAL = /^(?:police|cops|officials|authorities|prosecutors|doctors)$/i;
// (an outlet's name in capitals after a dash: "... affair with Hollinelle Yarrsy - CHOSUNBIZ")
const CAPS_TAIL = /\s+[-–—|]\s+[\p{Lu}\p{N}][\p{Lu}\p{N} .&'’]{2,30}$/u;
// (a second story tagged on by how long ago it was, naming someone else: "..., weeks after Tavix Ostiss tour uproar")
const LATER_TAIL = /,\s+(?:just\s+)?(?:(?:a|two|three|four|five|six|several|\d+)\s+)?(?:hours?|days?|weeks?|months?|years?)\s+after\s+.+$/i;
const PLAIN_MIN_WORDS = 6;
const FULL_NAME_MIN = 2; // titles naming the full name
const ROLE_NAMED_MIN = 2; // titles giving the role right before it
// the outlet's tone told plainly, the reported account kept: a tabloid verb aimed at someone ("Feniel Zellova rips Bexena Tamaby's
// 'Primetime'" -> "criticizes"; never "ripped his shirt off"), a film that "bombs" flops, a cameo that "pops into" a show appears on
// it, "passes away" dies, and a label the outlet pins on a person before their role ("disgraced former House Speaker") or a
// "bombshell" before a noun is left out
const AIMED = String.raw`(?=\s+(?:[‘'“"]?\p{Lu}|the\b|for\b))`;
const PLAIN_SWAPS = [
  [/\b(?:rips|tears|lays|laces) into\b/gu, 'criticizes'],
  [/\b(?:ripped|tore|laid|laced) into\b/gu, 'criticized'],
  [new RegExp(String.raw`\b(?:rips|slams|blasts|lambasts|torches|skewers|eviscerates)${AIMED}`, 'gu'), 'criticizes'],
  [new RegExp(String.raw`\b(?:ripped|slammed|blasted|lambasted|torched|skewered|eviscerated)${AIMED}`, 'gu'), 'criticized'],
  [/\b(?:hits|lashes) out at\b/gu, 'criticizes'],
  [/\blashed out at\b/gu, 'criticized'],
  [/\btakes aim at\b/gu, 'criticizes'],
  [/\btook aim at\b/gu, 'criticized'],
  [/\b(?:claps|fires|hits) back at\b/gu, 'responds to'],
  [/\b(?:clapped|fired) back at\b/gu, 'responded to'],
  [/\bbombs at the box office\b/gu, 'flops at the box office'],
  [/\bbombed at the box office\b/gu, 'flopped at the box office'],
  [/\bpops (?:into|up on|up in)\b/gu, 'appears on'],
  [/\bpopped (?:into|up on|up in)\b/gu, 'appeared on'],
  [/\bspark(s?) fury\b/gu, 'spark$1 anger'],
  [/\bsparked fury\b/gu, 'sparked anger'],
  [/\bpasses away\b/gu, 'dies'],
  [/\bpassed away\b/gu, 'died'],
  [/(?<![\p{L}\p{N}])(?:[Dd]isgraced|[Ee]mbattled|[Bb]ombshell)\s+(?=\p{Ll})/gu, ''],
  // (an affair is not forty years old: "admits 40-year-old affair with Hollinelle Yarrsy" -> "admits affair with Hollinelle Yarrsy 40 years
  // ago"; with nobody named after it, "admits affair from 40 years ago")
  // (the name's words, an initial's stop only inside it: "H. Yarrsy", "Lysette K. Marrner", never the sentence's own full stop)
  [/\b(\d+)-year-old (affair|romance|fling|feud|grudge|rift) with (\p{Lu}[\p{L}'’-]*(?:\.(?= \p{Lu}))?(?: \p{Lu}[\p{L}'’-]*(?:\.(?= \p{Lu}))?){0,2})(?![\p{L}\p{N}])/gu, '$2 with $3 $1 years ago'],
  [/\b(\d+)-year-old (affair|romance|fling|feud|grudge|rift)\b/gu, '$2 from $1 years ago'],
  // (an outlet's intensifier after a name says nothing: "why Kerry really killed ..." -> "why Kerry killed ..."; never inside what
  // someone said: "I really messed up")
  [/(?<=\p{Lu}\p{Ll}{1,20} )(?:really|truly|actually) (?=\p{Ll})/gu, ''],
  // (a death in one tense on every card: "has died at 57" -> "dies at 57")
  [/\bhas died\b/gu, 'dies'],
];
/** A line with the outlet's tone out (PLAIN_SWAPS), its first letter capitalised again when a label it led with is left out. */
function plainWords(s) {
  let out = s;
  for (const [re, to] of PLAIN_SWAPS) out = out.replace(re, to);
  return out !== s && /^\p{Ll}/u.test(out) && /^\p{Lu}/u.test(s) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}
/**
 * A reported line as a plain account of who did what: a tabloid's tail and a soundbite after a colon cut (when six words or more
 * stay), "dead at 57" told as "has died at 57" (the chosen line says "dies at 57": plainWords), and, with the card's name index (nameIndex), a bare first name given its surname and
 * role as the card's titles print them ("Dovette's allegations" -> "streamer Dovette Kelner's allegations"). A denial clause after "; "
 * stays as it is. TN: talk-nouns.js's nameRuns, ROLE and nameSurface (passed in: it requires this module). The outlet's tone is told
 * plainly only in the line chosen (plainWords): the noun families read the outlet's own verbs ("rips" is a feud's).
 */
function plainLine(line, index, subject, TN) {
  if (!line) return line;
  const end = (line.match(/[.]$/) || [''])[0];
  let s = line.slice(0, line.length - end.length);
  const semi = s.indexOf('; ');
  const tail = semi > 0 ? s.slice(semi) : '';
  if (semi > 0) s = s.slice(0, semi);
  for (const re of [SECOND_SENTENCE, CAPS_TAIL, AGGREGATOR_TAIL, SOUNDBITE, TABLOID_TAIL]) {
    const t = s.replace(re, '');
    if (t !== s && t.split(/\s+/).length >= PLAIN_MIN_WORDS) s = t;
  }
  const amid = s.match(AMID_TAIL);
  const last = String(subject || '').split(' ').slice(-1)[0];
  if (amid && !(last && W.words(amid[0]).includes(last)) && s.slice(0, amid.index).split(/\s+/).length >= PLAIN_MIN_WORDS) s = s.slice(0, amid.index);
  // (the same for an older story about someone else: a capitalised name in the tail, never the subject's own)
  const later = s.match(LATER_TAIL);
  if (later && /\s\p{Lu}/u.test(later[0]) && !(last && W.words(later[0]).includes(last)) && s.slice(0, later.index).split(/\s+/).length >= PLAIN_MIN_WORDS) s = s.slice(0, later.index);
  s = s.replace(/\b(?:is\s+)?dead\s+(?:at(?:\s+the)?\s+age(?:\s+of)?|at|aged)\s+(\d{1,3})\b/i, 'has died at $1');
  s = s.replace(SAID_BY, (m, who) => `, ${/^\p{Lu}\p{Ll}/u.test(who) ? who.toLowerCase() : who} ${SAID_BY_PLURAL.test(who) ? 'say' : 'says'}`);
  return `${index ? fullNames(s, index, subject, TN) : s}${tail}${end}`;
}

/** The full names a card's titles print, each with the titles naming it and the roles they give it: { titles, runs, roles }. */
function nameIndex(titles, subject, TN) {
  const subj = subject.split(' ');
  const runs = new Map(); // full name -> titles naming it
  const roles = new Map(); // full name -> Map(role -> titles)
  for (const t of titles || []) {
    const h = ` ${W.words(t).join(' ')} `;
    // (a Title Case headline capitalises every word, so its name is the two words after a role: "Streamer Dovette Kelner Alleges ...")
    if (W.isTitleCase(t.split(/\s+/))) {
      const hw = h.trim().split(' ');
      const seen = new Set();
      hw.forEach((w, i) => {
        if (!TN.ROLE.has(w) || i + 2 >= hw.length) return;
        const n = `${hw[i + 1]} ${hw[i + 2]}`;
        if (TN.ROLE.has(hw[i + 1]) || hw.slice(i + 1, i + 3).some((x) => subj.includes(x)) || seen.has(n)) return;
        seen.add(n);
        runs.set(n, (runs.get(n) || 0) + 1);
        const by = roles.get(n) || new Map();
        by.set(w, (by.get(w) || 0) + 1);
        roles.set(n, by);
      });
      continue;
    }
    for (const r0 of new Set(TN.nameRuns(t))) {
      const ws = r0.split(' ');
      while (ws.length && TN.ROLE.has(ws[0])) ws.shift();
      if (ws.length < 2 || ws.some((w) => subj.includes(w))) continue;
      const n = ws.join(' ');
      runs.set(n, (runs.get(n) || 0) + 1);
      const m = h.match(new RegExp(` (\\S+) ${n} `));
      if (m && TN.ROLE.has(m[1])) { const by = roles.get(n) || new Map(); by.set(m[1], (by.get(m[1]) || 0) + 1); roles.set(n, by); }
    }
  }
  return { titles: titles || [], runs, roles };
}

/** Each bare first name in a line given its surname, and its role once most titles give one ("streamer Dovette Kelner"). */
function fullNames(line, index, subject, TN) {
  const subj = subject.split(' ');
  const { runs, roles, titles } = index;
  const toks = line.split(' ');
  const core = (tok) => tok.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/[’']s$/, '');
  const capped = (tok) => /^\p{Lu}/u.test(core(tok || ''));
  return toks.map((tok, i) => {
    const c = core(tok);
    if (!/^\p{Lu}\p{Ll}+$/u.test(c) || capped(toks[i + 1]) || (i > 0 && capped(toks[i - 1]) && !/[.:;!?]$/.test(toks[i - 1]))) return tok;
    const k = c.toLowerCase();
    // (a given name, or a word no dictionary spells that the titles give a role: "streamer Dovette Kelner", never "Harvard Experiments")
    if (subj.includes(k) || (W.inDict(k) && !W.isFirstName(k)) || /[’']s?$/.test(toks[i - 1] || '')) return tok;
    // (a name the titles spell whole twice, or once with a role before it: "streamer Dovette Kelner" after the week's first headlines
    // have aged out; never a headline's capitalised lead, "Dovette Quits Twitch")
    const best = [...runs.entries()].filter(([n, x]) => n.split(' ')[0] === k && (x >= FULL_NAME_MIN || roles.has(n)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best) return tok;
    // (its role once most of the titles naming it give one)
    const roleMin = Math.min(ROLE_NAMED_MIN, best[1]);
    const role = [...(roles.get(best[0]) || new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!W.isFirstName(k) && !(role && role[1] >= roleMin)) return tok;
    const surface = TN.nameSurface(best[0], titles);
    const said = role && role[1] >= roleMin && !TN.ROLE.has(core(toks[i - 1] || '').toLowerCase()) ? `${i === 0 ? role[0].charAt(0).toUpperCase() + role[0].slice(1) : role[0]} ` : '';
    return tok.replace(c, `${said}${surface}`);
  }).join(' ');
}

/**
 * A word a headline capitalises that is no name: one the other headlines print lowercase mid-sentence at least as often as capitalised
 * ("‘Distracting’ superfans" beside "... is 'distracting'", "cops Tasing him" beside "tasing"), never a word of the subject's name or
 * the line's first. titles: the card's own headlines.
 */
function decap(line, titles, subject) {
  if (!line) return line;
  const subj = new Set(String(subject || '').split(' '));
  const low = new Map();
  const cap = new Map();
  for (const t of titles) {
    const toks = String(t).split(/\s+/);
    if (W.isTitleCase(toks)) continue;
    toks.forEach((tok, k) => {
      const core = tok.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (k === 0 || !core || /[.!?:]['’"”]?$/.test(toks[k - 1])) return;
      const key = core.toLowerCase();
      if (core === key) low.set(key, (low.get(key) || 0) + 1);
      else if (/^\p{Lu}\p{Ll}+$/u.test(core)) cap.set(key, (cap.get(key) || 0) + 1);
    });
  }
  const toks = line.split(/(\s+)/);
  let at = 0;
  // (the word before was a capital this pass took down)
  let lowered = false;
  return toks.map((tok, k) => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const first = at === 0;
    at += 1;
    const prev = k >= 2 ? toks[k - 2] : '';
    const m = tok.match(/^([^\p{L}]*)(\p{Lu}\p{Ll}+)([^\p{L}]*)$/u);
    const carried = lowered;
    lowered = false;
    if (first || !m || /[.!?:]['’"”]?$/.test(prev)) return tok;
    const key = m[2].toLowerCase();
    if (subj.has(key)) return tok;
    // (and the capital right after one the headlines took down, a dictionary word no headline capitalises mid-sentence with a plain
    // word after it: the pair was no name, "sexualised Videos involving a child"; one word on, never a run)
    const plain = low.get(key) >= 1 && (cap.get(key) || 0) <= low.get(key);
    const next = toks[k + 2] || '';
    if (!plain && !(carried && !cap.get(key) && W.inDict(key) && !W.isFirstName(key) && (!next || /^[^\p{L}]*\p{Ll}/u.test(next)))) return tok;
    lowered = plain;
    return `${m[1]}${key}${m[3]}`;
  }).join('');
}

// what was done to someone, as a headline clips it ("Esso Quillley accused of ...", "Zordot booked for ...")
const DONE_TO = new Set(['accused', 'arrested', 'booked', 'charged', 'sued', 'hospitalized', 'hospitalised', 'disqualified', 'slammed', 'criticized', 'criticised', 'banned',
  'suspended', 'fired', 'sentenced', 'tased', 'defended', 'removed', 'pelted', 'attacked', 'slapped', 'stabbed', 'detained', 'indicted', 'jailed', 'evicted', 'dropped',
  'blasted', 'mocked', 'trolled', 'swatted', 'robbed', 'rushed', 'taken', 'seen', 'spotted', 'caught', 'filmed', 'ordered', 'denied', 'granted', 'hit', 'struck', 'injured',
  'defaulted', 'ejected', 'exposed', 'questioned', 'released', 'convicted', 'acquitted', 'cleared', 'named', 'found', 'forced', 'kicked', 'called']);
// (told in the present: a claim stands, a search goes on)
const DONE_NOW = new Set(['accused', 'wanted', 'suspected']);
const DONE_HEDGE = new Set(['reportedly', 'allegedly']);
// what follows something done to someone: who by or what for ("accused of", "booked for", "fired by"), how they were found ("found
// dead", "seen bleeding"), and, for a verb that is never what its subject did in a headline, where or when ("arrested in", "taken to")
const DONE_PREP = /^(?:by|for|with|from|over|of|after)$/i;
const DONE_STATE = /^(?:bleeding|guilty|dead|alive)$/i;
const DONE_WHERE = /^(?:in|on|at|as|to|amid|during|following|outside|while|into)$/i;
// verbs a headline also uses for what its subject did ("kicked off Mafiathon 3", "dropped out of Wireless", "denied in court filing the
// allegations", "called for a boycott"): "was" goes in only before who by or what for, never before a word that carries the verb on
// ("off", "out", "in", "to") or when what was done to follows ("fired for his ...", "hit with a ...")
const DONE_ACTIVE = new Set(['called', 'kicked', 'dropped', 'denied', 'found', 'hit', 'fired', 'named', 'ordered', 'granted', 'struck', 'caught', 'filmed', 'exposed', 'released',
  'forced', 'defended', 'questioned', 'removed']);
// (and these only before "by": what was called for or denied comes after any other word)
const DONE_BY_ONLY = new Set(['called', 'denied']);
const OBJECT_LEAD = /^(?:a|an|the|his|her|their|its|this|that|these|those|him|them|it|us|me|you|himself|herself|themselves|some|any|another)$/i;
const NAME_LEAD_WORDS = 6;
/**
 * A clipped headline told as a sentence: the helping verb a headline leaves out goes back in when the line opens with its subject and
 * what was done to it comes right after ("Esso Quillley accused of child abuse ..." -> "Esso Quillley is accused of ...", "Zordot booked
 * for evading arrest ..." -> "Zordot was booked for ...", "Quavnix reportedly seen bleeding ..." -> "Quavnix was reportedly seen ...").
 * Only before a joining word (never "X called the claims false"), never after a verb the line already has.
 */
function sentenceVerb(line, subject) {
  if (!line || !subject) return line;
  const toks = line.split(/\s+/);
  const last = subject.split(' ').slice(-1)[0];
  const key = (t) => (t || '').toLowerCase().replace(/[’']s$/, '').replace(/[^\p{L}\p{N}]+/gu, '');
  const at = toks.slice(0, NAME_LEAD_WORDS).findIndex((t) => key(t) === last && !/[’']s[^\p{L}]*$/u.test(t) && !/[,:;]$/.test(t));
  if (at < 0) return line;
  // (nothing between the line's start and the name but the name's own words and what it is called: "Rapper Quavnix", "German streamer Nimdot")
  if (toks.slice(0, at).some((t) => /[,:;.!?]$/.test(t) || /^(?:after|as|while|when|amid|and|but|says|said)$/i.test(t))) return line;
  const hedged = DONE_HEDGE.has(key(toks[at + 1]));
  const verbAt = at + (hedged ? 2 : 1);
  const verb = key(toks[verbAt]);
  if (!DONE_TO.has(verb) && !DONE_NOW.has(verb)) return line;
  const next = key(toks[verbAt + 1]);
  if (!next) return line;
  if (next !== 'by') {
    if (DONE_BY_ONLY.has(verb)) return line;
    const told = DONE_PREP.test(next) || DONE_STATE.test(next);
    if (DONE_ACTIVE.has(verb)) {
      // (what was done to: a determiner, a pronoun or a name right after the joining word; "from" and "of" lead to where or what, never to it)
      const obj = toks[verbAt + 2] || '';
      const object = OBJECT_LEAD.test(key(obj)) || (!/^(?:from|of)$/i.test(next) && /^[^\p{L}\p{N}]*\p{Lu}/u.test(obj));
      if (!told || (!DONE_STATE.test(next) && object)) return line;
    } else if (!told && !DONE_WHERE.test(next)) return line;
  }
  const aux = DONE_NOW.has(verb) ? 'is' : 'was';
  return [...toks.slice(0, at + 1), aux, ...toks.slice(at + 1)].join(' ');
}

module.exports = { decap, sentenceVerb, majorityChecks, rolesIn, tidyLine, dropMiddleName, quoteWorks, pairedOf, plainLine, plainWords, nameIndex, fullNames, HEDGE };
