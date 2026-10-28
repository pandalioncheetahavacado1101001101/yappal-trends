'use strict';
/*
 * Text side of the Ideas prototype: word lists, the name lexicon learned from the corpus, un-Title-Casing, and the
 * rule-based rewrite of a source title into a 3-12 word "who + what happened" headline.
 * The word lists are bundled (lexicon/*.txt, from the public-domain Webster's 2nd list) so the phone and this prototype
 * make identical casing decisions; iOS has no /usr/share/dict.
 */
const fs = require('fs');
const path = require('path');
const { RE, PLACES, TEAM_WORDS, isPlaceOrTeam } = require('./rules');

const MAX_WORDS = 12;
const MAX_CHARS = 70;

// ---------- word lists ----------
const splitList = (s) => s.split(/\s+/).filter(Boolean);
const STOP = new Set(splitList(`a an the and or but nor of to in on at for with by from as is are was were be been being it its this
  that these those his her hers their our your my he she they we you i me him them us who whom what when where why how not no yes up
  down out off over after before about into than then so if just says say said amid via vs will can could would should has have had
  do does did get gets got more most very all any some one two three first last also again still here there now per even ever never
  really only much many like well back way make made take took going come came want wants need needs`));
const GENERIC = new Set(splitList(`viral goes went going video videos clip clips meme memes tiktok tiktoker instagram youtube internet
  online fan fans people user users watch watching photo photos pic pics post posts react reacts reaction reactions moment moments
  trend trending news report star stars celebrity celeb today week year day night time official new latest update exclusive wild
  everyone social media x twitter reddit thread shares share reveals season episode show`));
const TREND_NOISE = new Set(splitList(`lyrics lyric meaning cast season voting vote new release releases movie film trailer today game
  time net worth age wife husband kids tour tickets score how what who where when is did does 2026 2027 update news live stream`));
// Platforms and places: never the topic of a cluster, though multi-word ones still keep their capitals.
const ENTITY_STOP = new Set(['tiktok', 'youtube', 'instagram', 'netflix', 'reddit', 'twitter', 'facebook', 'google', 'amazon',
  'disney', 'hbo', 'apple', 'new york', 'los angeles', 'united states', 'the internet', 'white house', 'north america',
  'rotten tomatoes', 'prime video', 'apple tv', 'hot 100', 'billboard hot', 'hbo max', 'disney plus', 'hollywood', 'fox news', 'cnn',
  'nbc news', 'abc news', 'cbs news', 'sky news', 'the new york times', 'the washington post', 'new york post']);
const CALENDAR = new Set(splitList(`january february march april may june july august september october november december monday
  tuesday wednesday thursday friday saturday sunday`));
const SUFFIXY = /(s|ed|ing|ly|tion|ment|ness|able|ible|ful|ous|ive|al|er|est)$/i;
const VERBS = splitList(`slaps slapped roasts roasted eats ate bites melts goes becomes slams rips responds shuts sparks breaks drops
  reveals calls wins loses dances cries falls trips flinches flinched booed crashes surprises kisses splits confirms denies jokes
  mocks trolls joins quits sings performs recreates recreated returns shares posts hosts stuns shocks admits apologizes defends
  reacts hits gets shows brings makes takes gives says tells asks leaves pokes disintegrates glitches completes raises debuts
  proves supports celebrates claps fires storms walks pranks recalls wants cancels canceled cancelled engaged marries announces
  launches demolishes hunts climbs stashes urges replaces spots caught filmed turns went feminize debate rejects offers plays
  throws steals faces trends explodes begs blasts shades stops watches beams fixes speaks removed dropped`);
const VERB_RE = new RegExp(`\\b(${VERBS.join('|')})\\b`, 'i');
const LEADINS = [
  /^(watch|video|photos?|exclusive|breaking|update|listen|report)\s*[:\-–—|]\s*/i,
  /^watch:?\s+/i,
  /^see (the )?((wild|viral|hilarious|awkward|shocking|moment|video|clip) )*(of |when |where |as )?/i,
  /^why (the |a |this )?((viral|hilarious|awkward) )*(clip|video|photo|post|moment) of /i,
  /^(the )?((viral|hilarious|awkward|wild) )*moment (when |where )?/i,
  /^(so )?(what('?s|’s| is| are)|who('?s|’s| is)) (going on|up|happening) with (the )?/i,
  /^(here'?s|here’s|this is) (why|how|what) /i,
  /^why (is )?everyone (is )?/i,
  /^our queen,?\s*/i,
];
// "Why Fans Think X" -> "Fans think X" (a fan theory is the trend)
const THEORY_LEAD = /^why (fans|people|everyone|the internet|swifties) (think|thinks|believe|believes|are convinced)\b/i;
// "Country star Quorette Brannsy ..." -> "Quorette Brannsy ..." (only when a capitalised name follows)
const DESCRIPTOR = /^(?:(?:(?:former|ex-|country|pop|reality|tv|nfl|nba|k-pop|hollywood) )+star|singer|actress|actor|rapper|model|influencer|streamer|youtuber|tiktoker|comedian|musician|(?:[a-z.]+ )?(?:prime minister|president|senator|governor|mayor)) (\S)/i;
// Leading words a capitalised run sheds before it becomes a name ("Zornix" stays via Trends/Wikipedia; "Last Ditch" stays).
const RUN_NOISE = new Set(splitList(`the a an and or of in on at for with by from to as is are was were his her their its this that
  these those after before amid via vs when why how what who watch video exclusive breaking`));
const CLAUSE = new Set(splitList('after amid as while during following despite before since because who which that when where but and ahead weeks days months plus'));
const SOFT = new Set(splitList('at in on over from with for about into to of by near inside'));
const FILLER_ADJ = /\b(iconic|wild|epic|hilarious|bizarre|brutal|savage|stunning|shocking|emotional|rare|huge|massive|major|instant|magnificently)\s+(?=\S)/gi;
const FILLER_ADV = /\b(officially|finally|just|also|actually|seemingly|brutally|rudely|savagely|hilariously|boldly|publicly|casually|literally|totally|awkwardly|abruptly)\s+|\s+(once again|yet again|again|online)(?=$|[,.:;!?])/gi;
const ARTICLE_PREP = new Set(splitList('a an the of to in on at for with by from as into over about than and or but his her their its my your our'));
const TRAIL = new Set([...splitList('the a an and or of to in on at for with by from as but into over about his her their its new is are was were be been has have had will says'), ...CLAUSE]);
const PARTICLE = new Set(splitList('in out up down back off on over'));
// verbs that need an object: a headline must not stop on them ("fans think there needs")
const DANGLING = new Set(splitList('needs need think thinks wants says said is are was were has have gets makes takes gives brings becomes reveals shares admits calls tells asks launches unveils announces drops due'));

// Bundled word lists tell names from ordinary words when un-Title-Casing. words.txt: lowercase dictionary words;
// proper.txt: capitalised entries (first names, places, nationalities: "genevieve", "hollywood", "christian").
const readWordList = (file) => {
  try { return new Set(fs.readFileSync(path.join(__dirname, 'lexicon', file), 'utf8').split(/\s+/).filter(Boolean)); } catch { return null; }
};
// words.txt is the 1934 dictionary; modern.txt adds the words it predates ("intro", "meme", "podcast")
const DICT = (() => { const d = readWordList('words.txt'); const m = readWordList('modern.txt'); return d ? new Set([...d, ...(m || [])]) : m; })();
const PROPER_WORDS = readWordList('proper.txt');
// given names ("ellen", "will"); the dictionary's other capitalised words count as a given name only as a headline's first word
const FIRST_NAMES = new Set([...(readWordList('firstnames.txt') || [])].filter((w) => !STOP.has(w)));
if (!DICT) process.stderr.write('[wording] lexicon/words.txt missing: casing falls back to corpus counts only\n');
const inDictExact = (w) => !!DICT && DICT.has(w);
// Collector only. A British spelling's American form ("apologises" -> "apologizes", "favourite" -> "favorite", "theatre" -> "theater"):
// the word list is American, the outlets of the British and Australian audiences are not, and a capitalised word no dictionary spells
// reads as somebody's name ("Influencer Apologises For Cheating ..." in a Title Case headline became a card, "Apologises backlash")
const BRITISH = [[/is(e|es|ed|ing|ation|ations|er|ers)$/, 'iz$1'], [/ys(e|es|ed|ing)$/, 'yz$1'], [/our(s|ed|ing|ite|ites|able|ful|less|hood)?$/, 'or$1'],
  [/tre(s)?$/, 'ter$1'], [/ll(ed|ing|er|ers)$/, 'l$1'], [/ogue(s)?$/, 'og$1']];
/** Dictionary lookup that also accepts simple inflections (the macOS list has base forms only), in either spelling. */
function inDict(w) {
  if (!DICT) return false;
  if (inDictAmerican(w)) return true;
  return BRITISH.some(([re, to]) => re.test(w) && inDictAmerican(w.replace(re, to)));
}
function inDictAmerican(w) {
  if (DICT.has(w)) return true;
  const c = [];
  if (w.endsWith('ies')) c.push(w.slice(0, -3) + 'y');
  if (w.endsWith('s')) c.push(w.slice(0, -1), w.slice(0, -2));
  if (w.endsWith('ed')) c.push(w.slice(0, -1), w.slice(0, -2), w.slice(0, -3));
  if (w.endsWith('ing')) c.push(w.slice(0, -3), w.slice(0, -3) + 'e', w.slice(0, -4));
  if (w.endsWith('er') || w.endsWith('ly')) c.push(w.slice(0, -2));
  if (w.endsWith('est')) c.push(w.slice(0, -3), w.slice(0, -2), w.slice(0, -4));
  if (w.endsWith('iest')) c.push(w.slice(0, -4) + 'y');
  return c.some((x) => x.length > 2 && DICT.has(x));
}

// ---------- small text helpers ----------
const uniq = (xs) => [...new Set(xs)];
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const bare = (w) => w.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
const isCapWord = (w) => /^[^\p{L}\p{N}]*\p{Lu}/u.test(w);
const looksVerb = (w) => VERB_RE.test(w) || /^[a-z]{2,}[^s]s$|^[a-z]{3,}ed$/.test(w.toLowerCase()); // "kiss" is not a verb form
const verbIndex = (ws) => ws.findIndex((w, i) => i >= 1 && looksVerb(w));

const SYNONYM = { disintegrat: 'melt', disintegrate: 'melt', melt: 'melt', torch: 'roast', roast: 'roast', bite: 'eat',
  munch: 'eat', chomp: 'eat', eat: 'eat', ate: 'eat', smooch: 'kiss', kiss: 'kiss', wed: 'marry', marri: 'marry', marry: 'marry',
  wedding: 'marry', recreat: 'recreate', recreate: 'recreate', reenact: 'recreate', flinche: 'flinch', flinch: 'flinch' };
/** Crude suffix stemmer: enough for "melts"/"melting"/"melted" to meet. */
function stem(w) {
  let s = w;
  // g-dropping: "blockin’" (apostrophe already stripped by words()) meets "blocking"; "margin", "cousin" are words and stay
  if (s.length >= 5 && s.endsWith('in') && !inDict(s) && inDict(s + 'g')) s += 'g';
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return SYNONYM[s] || s;
}
const stems = (s) => new Set(words(s).map(stem));

/** Lowercase ASCII word list: strips accents, possessives and punctuation. Shared by names and tokens. */
// (the collector builds every 15 minutes: the tokenizer is the pipeline's hottest call, a third of a build, so each distinct string is
// split once a process and every caller gets its own copy of the list, as before)
const WORDS_CACHE = new Map();
const WORDS_CACHE_MAX = 500000;
function words(s) {
  const text = s || '';
  const hit = WORDS_CACHE.get(text);
  if (hit) return hit.slice();
  const out = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’]s\b/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (WORDS_CACHE.size >= WORDS_CACHE_MAX) WORDS_CACHE.clear();
  WORDS_CACHE.set(text, out);
  return out.slice();
}

function isTitleCase(ws) {
  const long = ws.filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 4);
  if (long.length < 3) return false;
  return long.filter(isCapWord).length / long.length >= 0.8;
}

/** Splits a word into leading punctuation, core, and tail (possessive + trailing punctuation). */
function splitWord(w) {
  const m = w.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}](?:[\p{L}\p{N}.&'’-]*[\p{L}\p{N}])?)((?:['’]s)?[^\p{L}\p{N}]*)$/u);
  return m ? { lead: m[1], core: m[2], tail: m[3] } : { lead: w, core: '', tail: '' };
}

function quoteImbalance(s) {
  const count = (re) => (s.match(re) || []).length;
  if (count(/"/g) % 2 || count(/“/g) !== count(/”/g)) return true;
  return count(/(^|\s)[‘']/g) !== count(/[’'](?=\s|$|[,.!?:;])/g);
}

// ---------- name lexicon ----------
/** Scans sentence-case titles: capitalised runs become names, and per-word case counts decide what stays capitalised. */
function scanCase(titles) {
  const cap = new Map();
  const solo = new Map();
  const surface = new Map();
  const low = new Map();
  const runs = new Set();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const isNoise = (r) => RUN_NOISE.has(r.w.toLowerCase()) || (r.brk && inDict(r.w.toLowerCase()) && !(PROPER_WORDS && PROPER_WORDS.has(r.w.toLowerCase())));
  for (const title of titles) {
    const ws = title.split(/\s+/);
    for (const w of ws) if (/^[^\p{L}]*\p{Ll}/u.test(w)) words(w).forEach((p) => bump(low, p));
    if (isTitleCase(ws)) continue; // Title Case hides which words are names
    let run = [];
    const flush = () => {
      while (run.length && isNoise(run[0])) run.shift(); // "Accepting Parkinson's" -> "Parkinson"
      if (run.length === 1 && !run[0].brk) bump(solo, words(run[0].w).join(''));
      if (run.length >= 2 && run.length <= 4) runs.add(words(run.map((r) => r.w).join(' ')).join(' '));
      run = [];
    };
    ws.forEach((w, i) => {
      const { core } = splitWord(w);
      if (!core) { flush(); return; }
      const brk = i === 0 || /[:!?.—–|"“]$/.test(ws[i - 1]) || /^["“‘']/.test(w);
      if (isCapWord(core)) {
        run.push({ w: core, brk });
        if (!brk) for (const p of words(core)) { bump(cap, p); bump(surface, `${p}\t${core}`); }
      } else flush();
      if (/[,;:!?”"’']$/.test(w) || /['’]s$/i.test(w)) flush();
    });
    flush();
  }
  return { cap, solo, surface, low, runs };
}

const PERSON_DESC = /\((born |c\. )?\d{4}\s*[–-]|\(born |\b(actor|actress|singer|rapper|model|musician|comedian|personality|influencer|youtuber|streamer|presenter|songwriter|businessman|businesswoman|film|series|song|album)\b/i;

/** Names come from capitalised runs, internal-caps handles, Trends keywords, Wikipedia person/work pages and KYM entry names. */
function collectNames(scan, titles, trends, wiki, memeNames) {
  const names = new Set(scan.runs);
  for (const m of memeNames || []) { const k = words(m).join(' '); if (k.split(' ').length <= 4) names.add(k); }
  for (const [k, n] of scan.solo) if (n >= 2 && k.length >= 4 && !scan.low.has(k) && !STOP.has(k) && !GENERIC.has(k)) names.add(k);
  for (const title of titles) for (const w of title.split(/\s+/)) {
    const { core } = splitWord(w);
    if (/\p{Ll}\p{Lu}/u.test(core) && !GENERIC.has(core.toLowerCase())) names.add(words(core).join('')); // GlibVane, gRimvane
  }
  for (const tr of trends) {
    for (const k of [tr.keyword, ...tr.related.slice(0, 3)]) {
      const ws = words(k);
      if (!ws.length || ws.some((x) => TREND_NOISE.has(x) || /^\d+$/.test(x)) || STOP.has(ws[0])) continue;
      if (ws.length >= 2 && ws.length <= 3) names.add(ws.join(' '));
      if (ws.length === 1 && k === tr.keyword && tr.volume >= 50000 && !GENERIC.has(ws[0])) names.add(ws[0]);
    }
  }
  for (const w of wiki) if (w.key && PERSON_DESC.test(w.desc) && w.key.split(' ').length <= 4) names.add(w.key);
  for (const n of [...names]) {
    if (n.split(' ').length > 1 && n.split(' ').some((x) => ENTITY_STOP.has(x) && !['disney', 'apple', 'amazon', 'google'].includes(x))) { names.delete(n); continue; }
    if (ENTITY_STOP.has(n) || n.split(' ').every((x) => STOP.has(x) || GENERIC.has(x) || CALENDAR.has(x))) names.delete(n);
  }
  return names;
}

/** Places, teams and calendar words keep their capitals but are never the topic of a story ("Texas", "New York Knicks"). */
function topicNames(names) {
  return new Set([...names].filter((n) => !isPlaceOrTeam(n) && !n.split(' ').every((x) => PLACES.has(x) || TEAM_WORDS.has(x) ||
    CALENDAR.has(x) || STOP.has(x))));
}

/** Unambiguous surnames of two- or three-word names ("demner" -> "caelan demner"); "gravard" has two owners, so it maps to none. */
function surnames(names) {
  const owners = new Map();
  for (const n of names) {
    const ws = n.split(' ');
    const last = ws[ws.length - 1];
    if (ws.length < 2 || ws.length > 3 || ws.some((w) => w.length < 2) || last.length < 5 || inDictExact(last) || GENERIC.has(last) || ENTITY_STOP.has(last) ||
      (PROPER_WORDS && PROPER_WORDS.has(last)) || PLACES.has(last) || TEAM_WORDS.has(last)) continue;
    if (!owners.has(last)) owners.set(last, new Set());
    owners.get(last).add(n);
  }
  const out = new Map();
  for (const [last, set] of owners) if (set.size === 1) out.set(last, [...set][0]);
  return out;
}

function buildLexicon(titles, trends, wiki, memeNames) {
  const scan = scanCase(titles);
  const allNames = collectNames(scan, titles, trends, wiki, memeNames);
  const names = topicNames(allNames);
  const lowN = (k) => scan.low.get(k) || 0;
  // (a dictionary noun's plural seen capitalised once, "Burns", "Essays", is no name on that alone)
  const plural = (k) => k.length >= 5 && /[^s]s$/.test(k) && inDictExact(k.slice(0, -1));
  const proper = new Set([...scan.cap.keys()].filter((k) => !STOP.has(k) &&
    ((scan.cap.get(k) >= 2 && scan.cap.get(k) > lowN(k)) || (lowN(k) === 0 && !inDictExact(k) && !plural(k)))));
  for (const n of allNames) {
    for (const p of n.split(' ')) if (!STOP.has(p) && !GENERIC.has(p) && !scan.low.has(p) && !inDictExact(p)) proper.add(p);
  }
  const surface = new Map();
  for (const [kv] of [...scan.surface.entries()].sort((a, b) => b[1] - a[1])) {
    const [k, form] = kv.split('\t');
    if (!surface.has(k)) surface.set(k, form);
  }
  const index = (list) => {
    const m = new Map();
    for (const n of list) { const f = n.split(' ')[0]; if (!m.has(f)) m.set(f, []); m.get(f).push(n); }
    return m;
  };
  // places and teams are not topics but keep their capitals ("New York Knicks")
  // (a name known only from a Trends query carries no casing: "cornell gang rape" must not capitalise "Gang")
  const capSeen = new Set([...scan.runs, ...(memeNames || []).map((m) => words(m).join(' ')), ...wiki.filter((w) => w.key).map((w) => w.key)]);
  const cased = (n) => capSeen.has(n) || n.split(' ').every((w) => !inDictExact(w) || FIRST_NAMES.has(w) || PLACES.has(w));
  const phrases = [...[...allNames].filter(cased), ...[...ENTITY_STOP, ...PLACES].filter((n) => n.includes(' '))];
  // first words of known two/three-word person names ("esselle", "quorette") extend the bundled given-name list
  const firstNames = new Set([...names].filter((n) => /^\S+ \S+( \S+)?$/.test(n)).map((n) => n.split(' ')[0])
    .filter((f) => f.length > 2 && !STOP.has(f) && !inDictExact(f) && !PLACES.has(f) && !TEAM_WORDS.has(f)));
  // names seen capitalised in sentence-case text (not Trends queries, which carry no casing): what may capitalise a word in a line
  const capNames = new Set([...scan.runs, ...(memeNames || []).map((m) => words(m).join(' ')), ...wiki.filter((w) => w.key).map((w) => w.key)]);
  return { names, proper, low: scan.low, surface, byFirst: index(names), phrasesByFirst: index(phrases), bySurname: surnames(names), firstNames, capNames };
}

// ---------- casing ----------
/** 'proper' keeps its capital, 'lower' is lowercased, 'inflected'/'unknown' (not a plain dictionary word) depend on neighbours. */
function wordClass(core, lex) {
  const parts = words(core);
  if (!parts.length || parts.every((p) => STOP.has(p))) return 'lower';
  if (/^[A-Z0-9]{2,3}s?$/.test(core) || /\p{Ll}\p{Lu}/u.test(core)) return 'proper'; // SNL, VMAs, GlibVane, LorrMott
  if (parts.every((p) => lex.proper.has(p))) return 'proper';
  if (!DICT) return parts.some((p) => lex.low.has(p)) || SUFFIXY.test(core) ? 'lower' : 'unknown';
  // a team no dictionary spells ("Knicks") keeps its capital; "Giants", "Jets" are words too, so they go by the neighbours
  if (parts.every((p) => TEAM_WORDS.has(p) && !DICT.has(p))) return 'proper';
  if (parts.some((p) => DICT.has(p) || lex.low.has(p))) return 'lower';
  if (parts.some((p) => inDict(p))) return 'inflected'; // "surprises"
  if (PROPER_WORDS && parts.every((p) => PROPER_WORDS.has(p))) return 'proper';
  return 'unknown';
}

/** Maps word positions covered by a known multi-word name ("Saturday Night Live", "New York") to that name. */
function nameSpans(ws, lex) {
  const norm = ws.map((w) => words(w).join(' '));
  const covered = new Map();
  norm.forEach((first, i) => {
    for (const n of lex.phrasesByFirst.get(first.split(' ')[0]) || []) {
      const len = n.split(' ').length;
      if (len > 1 && norm.slice(i, i + len).join(' ') === n) for (let k = i; k < i + len; k++) covered.set(k, n);
    }
  });
  return covered;
}

function classify(parts, named, lex, titleCase) {
  let inQuote = false;
  return parts.map((p, i) => {
    const opening = /["“‘']/.test(p.lead);
    const closing = /["”’']/.test(p.tail.replace(/^['’]s/, '')) || /[”’'"]-/.test(p.core); // ‘Pretty Little Liars’-Inspired
    const quoted = inQuote || opening;
    if (opening && !closing) inQuote = true;
    else if (closing) inQuote = false;
    if (!p.core) return 'keep';
    if (BRAND_CAPS.test(p.core)) return 'keep'; // a magazine spelled in capitals ("PEOPLE") is its name, not shouting
    if (/^[A-Z]{4,}$/.test(p.core) && lex.surface.get(words(p.core).join('')) !== p.core && inDict(p.core.toLowerCase())) return 'shout'; // ROASTED, not WNBA
    if (i === 0 || quoted || named.has(i) || !titleCase) return 'keep';
    return wordClass(p.core, lex);
  });
}

const BRAND_CAPS = /^(?:PEOPLE|VOGUE|ELLE|TIME|NME)$/;

/** Un-Title-Cases a headline: names keep capitals, other words go lowercase. ALL-CAPS shouting is normalised everywhere. */
function recase(s, lex, titleCase) {
  const ws = s.split(' ');
  const parts = ws.map(splitWord);
  const named = nameSpans(ws, lex);
  const kind = classify(parts, named, lex, titleCase);
  const isName = (k) => k === 'proper' || k === 'keep';
  return ws.map((w, i) => {
    const { lead, core, tail } = parts[i];
    if (kind[i] === 'shout') {
      const proper = wordClass(core, lex) === 'proper';
      return lead + (proper ? lex.surface.get(words(core).join('')) || capFirst(core.toLowerCase()) : core.toLowerCase()) + tail;
    }
    const nextToName = (i > 0 && isName(kind[i - 1]) && isCapWord(ws[i - 1])) || (i + 1 < ws.length && kind[i + 1] === 'proper');
    const afterPlace = i > 0 && (ENTITY_STOP.has(named.get(i - 1)) || PLACES.has(named.get(i - 1))) && !named.has(i) && /s$/.test(core); // New York Knicks
    if (kind[i] === 'inflected' && afterPlace) return w;
    // Title Case only: "Korus Fennent", "Esselle Quillith" (a word after a first name), "Plonzo's “Choosin’ Texas”" (possessive before a title)
    const low = words(core).join('');
    const prevWord = i > 0 ? words(parts[i - 1].core).join('') : '';
    const runStart = i < 2 || !isCapWord(ws[i - 2]) || /[,;:]$/.test(ws[i - 2]); // the previous word opens a name run
    const afterFirstName = i > 0 && runStart && isCapWord(ws[i - 1]) && !PLACES.has(prevWord) && !TEAM_WORDS.has(prevWord) && !STOP.has(prevWord) &&
      (FIRST_NAMES.has(prevWord) || (lex.firstNames && lex.firstNames.has(prevWord)) || (i === 1 && PROPER_WORDS && PROPER_WORDS.has(prevWord)));
    // a dictionary noun's plural the lexicon learned as a name goes lowercase after a lowercase word: "horrific burns", not "Velia Burns"
    if (titleCase && kind[i] === 'proper' && i > 0 && (kind[i - 1] === 'lower' || kind[i - 1] === 'inflected') && low.length >= 5 && /[^s]s$/.test(low) &&
      inDictExact(low.slice(0, -1)) && !TEAM_WORDS.has(low) && !PLACES.has(low)) return lead + core.toLowerCase() + tail;
    // (a plain word after a first name is a surname only when the pair is seen capitalised in sentence-case text: "Korus Brook", not
    // "Cornell Gang rape")
    const seenPair = !lex.capNames || lex.capNames.has(`${prevWord} ${low}`) || !inDictExact(low) || lex.proper.has(low);
    // (a word no dictionary knows, between a first name and a verb, is a surname whatever it ends in: "Quorade Lampos Gets ...",
    // "Rouey Hornis Says ..." lost their capital to the rule that reads a word ending in one "s" as a verb. "Plonzo Disses
    // Quoret" has no verb after it and stays one. Collector, the joined run of 2026-10-12: "Quorade Lampos gets over ...")
    const nextLow = i + 1 < ws.length ? words(parts[i + 1].core).join('') : '';
    // ("no dictionary knows": not the word, nor the word without its ending. The dictionary's own reading of endings is too
    // generous here: in a surname ending in "s" it finds "lamp" in "Lampos" and "horn" in "Hornis")
    const stemKnown = inDictExact(low) || (low.endsWith('s') && inDictExact(low.slice(0, -1))) || (low.endsWith('es') && inDictExact(low.slice(0, -2))) || (low.endsWith('ies') && inDictExact(`${low.slice(0, -3)}y`));
    const surnameBeforeVerb = !stemKnown && !!nextLow && looksVerb(parts[i + 1].core) && inDict(nextLow);
    if (titleCase && (kind[i] === 'lower' || kind[i] === 'inflected') && !STOP.has(low) && (!looksVerb(core) || surnameBeforeVerb) && afterFirstName && seenPair) return w;
    if (titleCase && /['’]s$/.test(w) && kind[i] === 'lower' && i + 1 < ws.length && isCapWord(ws[i + 1]) && isName(kind[i + 1])) return w;
    // a word no dictionary knows (even inflected) is most likely a name or a brand: "Minecraft", "Hyrox"
    if (kind[i] === 'lower' || kind[i] === 'inflected') return lead + core.toLowerCase() + tail;
    return w;
  }).join(' ');
}


// ---------- headline rewrite ----------
/** "shutting" -> "shuts", "colliding" -> "collides" (for "X goes viral for <verb>ing ..."). The dictionary picks the base form. */
function gerundToPresent(g) {
  const irregular = { being: 'is', having: 'has', doing: 'does', going: 'goes', saying: 'says', lying: 'lies', dying: 'dies' };
  if (irregular[g.toLowerCase()]) return irregular[g.toLowerCase()];
  const s = g.slice(0, -3);
  const low = s.toLowerCase();
  const undoubled = /([bdgmnprtl])\1$/i.test(s) ? s.slice(0, -1) : null;
  let base;
  if (DICT) {
    base = [s, undoubled, s + 'e'].find((x) => x && DICT.has(x.toLowerCase()));
  }
  if (!base) {
    if (undoubled && /([bdgmnprt])\1$/i.test(low)) base = undoubled;
    else if (/(^|[^aeiou])[aeiou][cgkvz]$/i.test(low) || /[^aeiou][cvz]$/i.test(low)) base = s + 'e';
    else base = s;
  }
  if (/(s|sh|ch|x|z)$/i.test(base)) return base + 'es';
  if (/[^aeiou]y$/i.test(base)) return base.slice(0, -1) + 'ies';
  return base + 's';
}

/** "Bexena Tamaby" -> "Bexena Tamaby’s" */
const possessive = (s) => (/s$/i.test(s) ? `${s}’` : `${s}’s`);

/**
 * Explainer titles name the trend: "What is the Demace test? Caelia & Brinane TikTok trend explained" -> "The ‘Demace test’
 * TikTok trend"; "Who Is 'Fenette Zellissander' And Is He AI?" -> "The ‘Fenette Zellissander’ trend".
 */
const EXPLAINER_QUOTED_MAX_WORDS = 7; // "‘We’re All Just Blocking The Street’"
const EXPLAINER_PLAIN_MAX_WORDS = 5;
function explainerHeadline(title) {
  // "What does ‘mogging’ mean on TikTok?" -> "The TikTok term ‘mogging’"
  const term = title.match(/^what does ['‘"“]((?:[^'’"”]|['’](?=\w)){2,30})['’"”] mean( on tiktok)?\b/i);
  if (term) return `The ${term[2] ? 'TikTok ' : ''}term ‘${term[1]}’`;
  const m = title.match(/^(?:so )?(?:what|who|wtf)(?:['’]s| is| are)\s+(?:the |a |this )?(.+?)(?:\?|$)/i);
  if (!m || /^(going on|up|happening|behind)\b/i.test(m[1])) return null;
  const quoted = m[1].match(/^['‘"“]((?:[^'’"”]|['’](?=\w)){2,40})['’"”]/); // "‘We’re All Just Blocking The Street’"
  const subject = (quoted ? quoted[1] : m[1].split(/\s+(?:and|&)\s+(?:why|is|are|how|what|who)\b/i)[0]
    .replace(/\s+(explained|trend|meme|challenge)$/i, '')).trim();
  if (!subject || subject.split(/\s+/).length > (quoted ? EXPLAINER_QUOTED_MAX_WORDS : EXPLAINER_PLAIN_MAX_WORDS)) return null;
  if (!quoted && !/\b(trend|meme|challenge|explained|tiktok)\b/i.test(title)) return null;
  const kind = /\bmemes?\b/i.test(title) ? 'meme' : /\bchallenge\b/i.test(title) ? 'challenge' : 'trend';
  const onTikTok = /tiktok/i.test(title);
  const name = subject.replace(/\s+on tiktok$/i, '');
  // "Parent Split-Face Trend" already says what it is: "The ‘Parent Split-Face Trend’ on TikTok"
  if (/\b(trend|challenge|meme)$/i.test(name)) return `The ‘${name}’${onTikTok ? ' on TikTok' : ''}`;
  return `The ‘${name}’${onTikTok ? ' TikTok' : ''} ${kind}`;
}

// Sentence rewrites that keep what happened and drop the "goes viral" wrapper.
const REPLY_BY = /^(.+?) (?:fires back at|claps back at|hits back at|responds to|trolls|mocks|pokes fun at|takes aim at|reacts to) (.+?) by (\w+ing) (?:his|her|their) (.+)$/i;
const VIDEO_OF = /^(?:a |the )?(?:viral )?(?:video|clip|footage) of (?:an? |the )?(.+?) (\w+ing) (.+?) (?:goes|went|is going|has gone) viral\b.*$/i;
const VIRAL_FOR = /\b(?:goes|went|is going|has gone|is) viral(?: on (?:tiktok|x|instagram|youtube|social media))? (?:after|for|by|while) (?:\w+ly )?(?!(?:being|having|striking|stunning|amazing|shocking|surprising|uncanny|hilarious|interesting|touching|heartwarming)\b)(\w+ing)\b/i;
const VIEWS = /\b(?:hits|racks up|gets|tops|nears|surpasses|reaches|passes) [\d.,]+ ?(?:million|m|billion|bn) views(?: in (?:one|a|1|just one|a single) day)?/i;
const BECOMES_MEME = /\b(?:became|becomes|has become|turned into|turns into|is now|is) (?:an? |the )?(?:[\w’']+ ){0,3}meme\b/i;
// The phrase that says what happened; a cut must not drop it when the title had one.
const CUE = new RegExp(`${RE.viral.source}|${RE.moment.source}|${RE.reaction.source}|\\bbecomes a meme\\b`, 'i');

// "X reacting to Y is the wholesome content we needed" -> "X reacting to Y"
const PRAISE_TAIL = /\s+(?:is|was|are) (?:the|our|my|all|just) (?:\w+ ){0,2}(?:content|energy|thing|moment|vibe)s? (?:we|i) (?:all )?(?:needed|need|love|deserve)\b.*$/i;
// "Zanane Ulmenko participating in a dance" -> "Zanane Ulmenko participates in a dance" (a caption with no main verb)
const GERUND_LEAD = /^((?:[A-Z][\w’'.-]+ ){1,3})([a-z]{4,}ing)\b/;

/**
 * A headline that opens with a bare surname gets the full name: "Demner’s latest ad" -> "Caelan Demner’s latest ad". A plain
 * word that opens a sentence is not a surname unless it owns something ("Quillith’s tour"): "Sounds kind of good" is not "BBC Sounds".
 */
function expandSurname(s, lex) {
  const [first, second] = s.split(' ');
  const key = words(first)[0];
  const full = lex.bySurname && lex.bySurname.get(key);
  if (!full || !isCapWord(first) || words(first).length !== 1) return s;
  if (inDict(key) && !/['’]s\W*$/.test(first)) return s;
  // Collector only. A first name that opens its own full name is no bare surname: "Quoro Branniss Makes First Public Appearance ..."
  // read "Rouet Quoro’s Branniss makes ..." once a search for "rouet quoro" had been learned as a name (seen on the review run of
  // 2026-10-12). Nor does a surface learned with its possessive lend it to the name.
  const next = second && isCapWord(second) && !/['’]s\W*$/.test(first) ? words(second)[0] : null;
  if (next && (FIRST_NAMES.has(key) || (lex.firstNames && lex.firstNames.has(key)) || ((lex.byFirst && lex.byFirst.get(key)) || []).includes(`${key} ${next}`))) return s;
  const pretty = full.split(' ').map((w) => (lex.surface.get(w) || capFirst(w)).replace(/['’]s$/, '')).join(' ');
  return pretty + (first.match(/['’]s\W*$/) || [''])[0] + s.slice(first.length);
}

function transform(title) {
  const s = title.replace(PRAISE_TAIL, '');
  const lead = s.match(GERUND_LEAD);
  const t = lead && verbIndex(['x', ...s.slice(lead[0].length).trim().split(' ')]) < 0
    ? lead[1] + gerundToPresent(lead[2]) + s.slice(lead[0].length) : s;
  return t.replace(REPLY_BY, (m, a, b, g, rest) => `${a} ${gerundToPresent(g)} ${possessive(b)} ${rest}`)
    .replace(VIDEO_OF, (m, a, g, rest) => `${a} ${gerundToPresent(g)} ${rest}`)
    .replace(VIRAL_FOR, (m, g) => gerundToPresent(g))
    // (how big it got is the hook: "hits 4 million views in one day" stays, told plainly)
    .replace(VIEWS, (m) => m.replace(/^(?:racks up|gets|tops|nears|surpasses|reaches|passes)\b/i, 'hits'))
    .replace(BECOMES_MEME, 'becomes a meme')
    .replace(/,? and it .*$/i, '').replace(/\s+explained$/i, '');
}

/** Picks the clause of "A: B – C" that names the cluster's main person, else the first real clause. */
// a clause that only says something went viral ("AMC Popcorn Post Goes Viral"): the other clause says what happened
const ONLY_VIRAL_CLAUSE = /^(?:an?\s+|the\s+)?[\w’'-]+(?:\s+[\w’'-]+){0,2}\s+(?:goes|went|is going)\s+viral$/i;
function pickClause(s, topEnt) {
  const all = s.split(/\s*(?::\s|\s[–—]\s|\s--\s|\s-\s|;\s|!\s|\?\s)\s*|(?<=(?:[a-z]{3}|[A-Z]{3})[.!?]['’"”]?)\s+(?=[A-Z‘'"“])/)
    .map((p) => (p || '').trim()).filter(Boolean);
  const good = (p) => p.split(/\s+/).length >= 3 && !/^["“‘']/.test(p);
  const parts = all.filter((p) => !ONLY_VIRAL_CLAUSE.test(p)).some(good) ? all.filter((p) => !ONLY_VIRAL_CLAUSE.test(p)) : all;
  const named = parts.filter((p) => good(p) && topEnt && (' ' + words(p).join(' ') + ' ').includes(' ' + topEnt + ' '));
  return named.find((p) => CUE.test(p)) || named[0] || parts.find((p) => good(p) && CUE.test(p)) || parts.find(good) || parts[0] || s;
}

function stripTrail(ws) {
  const a = [...ws];
  while (a.length > 3 && TRAIL.has(bare(a[a.length - 1]))) {
    if (PARTICLE.has(bare(a[a.length - 1])) && looksVerb(a[a.length - 2])) break; // keep "weighs in", "shuts down"
    a.pop();
  }
  return a;
}

/** A cut must not stop on a possessive, a preposition or an article ("mocks Orrory Neskova's", "plows into"). */
function badEnding(ws) {
  const last = ws[ws.length - 1] || '';
  if (/['’]s[,.:;!?]?$/.test(last) && !/['’]s['’"”]$/.test(last)) return true;
  const b = bare(last);
  // "... Gen Zers bringing this", "... after losing his", "... resonates due": a word that points at what the cut dropped
  if (/^(this|these|those|his|their|its|my|your|our|due)$/.test(b)) return true;
  return (ARTICLE_PREP.has(b) || CLAUSE.has(b)) && !(PARTICLE.has(b) && looksVerb(ws[ws.length - 2] || ''));
}

/**
 * A quoted Title (‘You Can See Everything’) after a noun can go; a quoted catchphrase stays, and so does a quoted phrase after an
 * article or a possessive ("photos from a ‘Big Albanian Wedding,’ complete with ..." would read "from a complete with").
 */
function quotedTitleSpan(ws) {
  const q = ws.findIndex((w, i) => i >= 1 && /^[‘'“"]/.test(w) && !SOFT.has(bare(ws[i - 1])) && !CLAUSE.has(bare(ws[i - 1])) && !ARTICLE_PREP.has(bare(ws[i - 1])));
  if (q < 0) return null;
  const end = ws.findIndex((w, i) => i >= q && /[’'”"][,.:;!?]?$/.test(w.replace(/['’]s$/, '')) && !/['’]s$/.test(w));
  return end > q && ws.slice(q, end + 1).every(isCapWord) ? [q, end] : null;
}

// the limits a rewrite works to: a headline's by default, a longer story line's when rewrite() is asked for one
const LIMIT = { words: MAX_WORDS, chars: MAX_CHARS, long: 10 };
const fits = (ws) => ws.length >= 3 && ws.length <= LIMIT.words && ws.join(' ').length <= LIMIT.chars;

/**
 * A middle phrase (ws[i] up to ws[j]) that must stay: what "hit", "slapped", "charged", "met" or "branded" were hit with ("hit
 * [with ‘lip syncing’] accusations" says an assault), a quoted word that says what the accusations are, and the preposition before
 * a place or an event ("reunite [at MTV] VMAs").
 */
function keepsMiddle(ws, i, j) {
  const first = bare(ws[i] || '');
  if (first === 'with' && /^(?:hit|slapped|charged|met|branded)$/.test(bare(ws[i - 1] || ''))) return true;
  if (/^(?:accusations|claims|allegations|rumou?rs)$/.test(bare(ws[j] || '')) && ws.slice(i, j).some((w) => /^[‘'“"]/.test(w))) return true;
  return /^(?:at|in|on|during)$/.test(first) && /^[‘'“"]?\p{Lu}/u.test(ws[i + 1] || '');
}

/**
 * A middle cut that sets two capitalised words side by side where the title kept them apart joins two people into one ("Essade
 * Quillard [and Quorix Brannwyn ‘struggling emotionally’ to plan] Orret’s funeral").
 */
function joinsNames(src, a) {
  const pairs = new Set(src.slice(1).map((w, i) => `${src[i]} ${w}`));
  return a.some((w, i) => i >= 1 && isCapWord(a[i - 1]) && isCapWord(w) && !pairs.has(`${a[i - 1]} ${w}`));
}

/** Shortening options: cut a trailing clause, drop a modifier between subject and verb, or drop a middle phrase. */
function trimVariants(ws) {
  const out = [];
  const add = (arr, cut, middle = false, next = '', stop = null) => {
    const a = stripTrail(arr);
    if (middle && SOFT.has(bare(next))) return; // "went viral [for his photos] of NYC" leaves "went viral of NYC"
    if (middle && joinsNames(ws, a)) return;
    if (fits(a) && (!cut || (!badEnding(a) && !quoteImbalance(a.join(' '))))) out.push({ ws: a, cut, middle, stop });
  };
  add(ws, false);
  const v = verbIndex(ws);
  const marks = ws.map((w, i) => (i >= 2 && (CLAUSE.has(bare(w)) || SOFT.has(bare(w))) ? i : -1)).filter((i) => i > 0);
  const commas = ws.map((w, i) => (i >= 3 && /,['’"”]?$/.test(ws[i - 1]) ? i : -1)).filter((i) => i > 0);
  for (const i of [...marks, ...commas]) {
    // (never between two names one "and" joins: "cremated as Essade Quillard [and Quorix Brannwyn plan ...]")
    if (/^(?:and|or|&)$/i.test(ws[i]) && isCapWord(ws[i - 1]) && isCapWord(ws[i + 1] || '')) continue;
    // (nor inside a list of names: "as Fenia Zellner, [Fenane Zellace and Dovelle Kelova accept ...]")
    if (commas.includes(i) && isCapWord(ws[i - 1]) && isCapWord(ws[i])) continue;
    const minI = CLAUSE.has(bare(ws[i])) || commas.includes(i) ? v + 1 : v + 2;
    if (v < 0 || i >= minI) add(ws.slice(0, i), true, false, '', [ws[i], ws[i + 1] || '']);
  }
  const participle = ws.findIndex((w, i) => i >= 1 && i < v && /^[a-z]+ing$/.test(w)); // "Packers fan checking her pulse became"
  if (participle > 0 && !keepsMiddle(ws, participle, v)) add([...ws.slice(0, participle), ...ws.slice(v)], true, true, ws[v]);
  for (const i of v > 0 ? marks.filter((m) => m < v && !keepsMiddle(ws, m, v)) : []) {
    add([...ws.slice(0, i), ...ws.slice(v)], true, true, ws[v]);
    for (const j of marks.filter((m) => m > v + 1)) add([...ws.slice(0, i), ...ws.slice(v, j)], true, true, ws[v]);
  }
  for (const i of marks.filter((m) => SOFT.has(bare(ws[m])))) {
    for (const j of marks) if (j > i && (v < 0 || i >= v + 2) && !keepsMiddle(ws, i, j)) add([...ws.slice(0, i), ...ws.slice(j)], true, true, ws[j]);
  }
  const app = ws.findIndex((w, i) => i >= 1 && /,$/.test(w) && /^(a|an|the)$/i.test(ws[i + 1] || '')); // "Mirus Vorurn, a teen from X, won"
  const appEnd = app < 0 ? -1 : ws.findIndex((w, i) => i > app + 1 && /,$/.test(w));
  if (appEnd > app) {
    const rest = [...ws.slice(0, app), ws[app].replace(/,$/, ''), ...ws.slice(appEnd + 1)];
    out.push(...trimVariants(rest).map((x) => ({ ...x, cut: true })));
  }
  const span = quotedTitleSpan(ws);
  if (span) out.push(...trimVariants([...ws.slice(0, span[0]), ...ws.slice(span[1] + 1)]).map((x) => ({ ...x, cut: true })));
  if (!out.length) {
    let a = stripTrail(ws.slice(0, LIMIT.words));
    while (a.length > 3 && (a.join(' ').length > LIMIT.chars || badEnding(a) || quoteImbalance(a.join(' ')))) a = stripTrail(a.slice(0, -1));
    out.push({ ws: a, cut: true, forced: true });
  }
  return out;
}

function variantScore(v) {
  const n = v.ws.length;
  let s = n < 5 ? -(5 - n) * 0.5 : n > LIMIT.long ? -(n - LIMIT.long) * 0.4 : 0;
  s += 0.35 * Math.min(4, v.ws.slice(1).filter(isCapWord).length);
  if (verbIndex(v.ws) >= 0) s += 1;
  if (v.ws.slice(3).some((w) => ['which', 'that', 'when', 'where'].includes(bare(w)))) s -= 0.8;
  if (quoteImbalance(v.ws.join(' '))) s -= 1.2;
  if (DANGLING.has(bare(v.ws[v.ws.length - 1]))) s -= 1.5;
  if (v.forced) s -= 2;
  if (v.middle) s -= 0.6;
  // "slams fan page | for writing an anti-LGBTQ+ message": the cut drops what the verb was about
  if (v.cut && v.stop && bare(v.stop[0]) === 'for' && /ing$/i.test(bare(v.stop[1]))) s -= 2;
  return v.cut ? s - 0.5 : s;
}

// what a sentence says of its subject is no filler (collector, the joined run of 2026-10-12: "Quorade Brannner Gets Emotional Over
// Tidewaves' Rouane Trevmott's Health Struggles" went out as "gets over ... health struggles", which says the opposite)
const LINKING = new Set(splitList('get gets got getting is are was were be been being become becomes became go goes went going look looks looked feel feels felt turn turns turned grow grows grew seem seems seemed so too very more most how as'));
/** A filler adjective goes where it dresses a noun ("an emotional tribute"); after a linking verb, or before a preposition or a clause, it is what the sentence says and stays ("gets emotional over", "was brutal", "goes wild after"). */
const dropFillerAdj = (s) => s.replace(FILLER_ADJ, (m, adj, at) => {
  const before = bare(s.slice(0, at).trim().split(/\s+/).pop() || '');
  const after = bare(s.slice(at + m.length).split(/\s+/)[0] || '');
  return LINKING.has(before) || SOFT.has(after) || CLAUSE.has(after) ? m : '';
});
/** Filler words always go; passive/perfect verbs and mid-sentence "the" go only when the title is too long. */
function compact(s, tooLong) {
  const t = dropFillerAdj(s.replace(FILLER_ADV, ''));
  if (!tooLong) return t;
  let quoted = false;
  return t.replace(/\b(has|have) been (given|handed|awarded)\b/gi, 'gets').replace(/\b(has|have) been\b/gi, 'is')
    .replace(/([’”])\s+(lyrics|song|track|verse)s? (is|are)\b/gi, '$1 is') // "‘Pink Clouding’ lyrics are an apology" -> "‘Pink Clouding’ is an apology"
    .replace(/\b(has|have) (\w+ed)\b/gi, '$2').split(' ').filter((w, i, all) => {
      if (/^[‘“]/.test(w)) quoted = true;
      const keep = i === 0 || quoted || !/^the$/i.test(w) || ROLE_AFTER_THE.test(all[i + 1] || '');
      if (/[’”][,.:;!?]?$/.test(w) && !/[’]s$/.test(w)) quoted = false;
      return keep;
    }).join(' ');
}

const ROLE_AFTER_THE = /^(actor|actress|singer|star|rapper|picture|photo)\b/i;

/**
 * KYM descriptions open with a definition: "Barf Simmons, sometimes known as Barf Symptons is a series of memes using a creepy
 * aesthetic based around a blue, elongated version of the character Bart Simpson from The Simpsons."
 * -> "‘Barf Simmons’: creepy memes of a blue, elongated Bart Simpson". Null when no short definition can be cut from it.
 */
const KYM_DEF_MAX_WORDS = 8;
const KYM_NAME_MAX_WORDS = 5;
const KYM_CLAUSE = /,|;|\s(?:based (?:on|around)|about|that|which|who|using|including|in which|where|when|created|posted|made|featuring|marking|following|emerged|for|by)\s/i;
// where a "based on ..." phrase ends: a quote after a comma, a new clause, a relative pronoun
const KYM_BASIS_END = /,\s(?=["“‘'])|,\s(?:then|and|or|but|which|who|where|in which)\b|;|\s(?:in which|where|when|which|who|then)\s/i;
const KYM_BARE_KIND = /^(memes?|trends?|meme format|format|series|video|character)$/i;
function kymHeadline(name, desc) {
  const n = (name || '').trim();
  if (!n || n.split(/\s+/).length > KYM_NAME_MAX_WORDS || !desc) return null;
  const first = desc.split(/(?<=[a-z0-9)”"'’])\.\s/)[0];
  const m = first.match(/\s(?:is|are|refers to)\s+(.+)$/i);
  if (!m) return null;
  const def = m[1].replace(/^(?:an?|the)\s+/i, '');
  const adj = (def.match(/\busing an? (\w+) aesthetic\b/i) || [])[1];
  const kind = def.split(KYM_CLAUSE)[0].replace(/^series of /i, '').trim();
  const basisM = def.match(/\bbased (?:on|around) (.+)$/i);
  let text = null;
  if (basisM && /\bmemes?\b|\bformat\b|\btrend\b/i.test(kind)) {
    const basis = basisM[1].split(KYM_BASIS_END)[0]
      .replace(/\bversion of (?:the )?(?:character )?/i, '').replace(/^((?:\S+\s)*?\p{Lu}[\w’']*(?:\s\p{Lu}[\w’']*)*)\sfrom\s.+$/u, '$1').trim();
    const noun = /\btrend\b/i.test(kind) ? 'trend' : /\bformat\b/i.test(kind) ? 'meme format' : 'memes';
    if (basis.split(/\s+/).length <= KYM_DEF_MAX_WORDS) text = `‘${n}’: ${adj ? adj.toLowerCase() + ' ' : ''}${noun} ${noun === 'memes' ? 'of' : 'based on'} ${basis}`;
  }
  if (!text && kind && !KYM_BARE_KIND.test(kind) && kind.split(/\s+/).length <= KYM_DEF_MAX_WORDS - 2) text = `‘${n}’: ${kind}`;
  if (!text) return null;
  const ws = text.split(/\s+/);
  return ws.length <= MAX_WORDS && text.length <= MAX_CHARS ? text : null;
}

/** "blockin’ the street" -> "blocking the street" (only when the g-form is a dictionary word), so quoted catchphrases compare. */
const foldGDrop = (s) => s.replace(/\b([A-Za-z]{3,}in)['’](?=\s|$)/g, (m, w) => (!inDict(w.toLowerCase()) && inDict(`${w.toLowerCase()}g`) ? `${w}g` : m));

const tidy = (text) => capFirst(text.replace(/[\s,.:;!—–-]+$/, '').replace(/[.,!](['’"”])$/, '$1').replace(/\s{2,}/g, ' ').trim());

/** Straight quotes used as quotation marks become curly ones, so mixed ‘…' pairs balance. Apostrophes stay. */
function curlQuotes(s) {
  return s.replace(/(^|[\s(—–-])'(?=\S)/g, '$1‘').replace(/(\S)'(?=$|[\s,.:;!?)—–-])/g, '$1’')
    .replace(/(^|[\s(—–-])"(?=\S)/g, '$1“').replace(/(\S)"(?=$|[\s,.:;!?)—–-])/g, '$1”');
}

/** Strips emoji, bracketed tags and dates, and lead-ins like "WATCH:". */
function cleanForHeadline(title) {
  let s = curlQuotes(title).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\((?:[A-Z][a-z]+ \d{1,2},? ?\d{4}|\d{4}|WATCH|VIDEO|PHOTOS?)\)/gi, '').replace(/\s+[-–|]\s+(IG|TikTok|X)\b.*$/i, '')
    .replace(/\s+[-–]\s+[A-Z][a-z]+ \d{4}$/, '').split(' / ')[0].replace(/\s+/g, ' ').trim();
  for (const re of LEADINS) s = s.replace(re, '');
  return s;
}

/**
 * Source title -> { text, cut, keptHook, lostHook } for a 3-12 word, <= 70 character headline.
 * hooks: stemmed words that carry the story ("mugshot", "pulse"); a cut that had one and drops it is rejected, as is a cut
 * that drops the words saying what happened.
 */
const IMPERATIVE_CLIP = /^(?:[Ww]atch|[Ss]ee)\s+((?:\p{Lu}[\p{L}.-]*\s+){0,2}\p{Lu}[\p{L}.-]*['’]s\s+\p{L}+)\s+(\p{L}+)(?=[\s,.:;!?]|$)/u;
/** "melt" -> "melts", "reach" -> "reaches", "cry" -> "cries" (the capital kept). */
function thirdPerson(v) {
  const low = v.toLowerCase();
  const out = /(?:s|sh|ch|x|z|o)$/.test(low) ? `${low}es` : /[^aeiou]y$/.test(low) ? `${low.slice(0, -1)}ies` : `${low}s`;
  return /^\p{Lu}/u.test(v) ? capFirst(out) : out;
}

// the words that say a title is only reported: a headline cut from it keeps them ("Reportedly arrested", "accused of", "... claims")
const TEXT_HEDGE = /\b(?:reportedly|allegedly|alleged|accused|accuses|alleges|claims?|claimed|rumou?red|reports?|sources?)\b/i;
// a statement with a question mark tacked on ("nimvaneb banned from Kick?"), never one that opens as a question
const ASKED_LEAD = /^(?:what|who|whom|whose|why|how|when|where|which|did|does|do|is|are|was|were|will|would|can|could|should|has|have|had)\b/i;

function rewrite(title, topEnt, lex, hooks = [], limits = null) {
  if (limits) {
    const saved = { ...LIMIT };
    Object.assign(LIMIT, limits);
    try { return rewrite(title, topEnt, lex, hooks); } finally { Object.assign(LIMIT, saved); }
  }
  const explained = explainerHeadline(cleanForHeadline(title));
  if (explained) return { text: explained, cut: false, keptHook: true, lostHook: false, explainer: true };
  // "Watch Veley Gravmott's dress melt away" -> "Veley Gravmott's dress melts away": the imperative's bare verb is told
  const told = title.replace(IMPERATIVE_CLIP, (m, np, verb) => (inDictExact(verb.toLowerCase()) && !STOP.has(verb.toLowerCase()) ? `${np} ${thirdPerson(verb)}` : m));
  let s = pickClause(cleanForHeadline(told), topEnt).replace(THEORY_LEAD, (m, who, verb) => `${capFirst(who.toLowerCase())} ${verb.toLowerCase()}`);
  for (const re of LEADINS) s = s.replace(re, '');
  s = s.replace(DESCRIPTOR, (m, next) => (/\p{Lu}/u.test(next) ? next : m));
  s = expandSurname(s, lex);
  const titleCase = isTitleCase(s.split(' '));
  // (a statement someone only asks, "nimvaneb banned from Kick?", stays a question: without its mark it would state it)
  const asked = /\?+$/.test(s) && !ASKED_LEAD.test(s);
  s = transform(s.replace(/\?+$/, ''));
  s = recase(s, lex, titleCase);
  s = compact(s, s.split(/\s+/).length > LIMIT.words || s.length > LIMIT.chars);
  const need = hooks.filter((h) => stems(s).has(h));
  const needCue = CUE.test(s);
  // (the hedge is a hook too: a cut that drops "reportedly" or "accused" states what the title only reported)
  const needHedge = TEXT_HEDGE.test(s);
  const keeps = (v) => { const st = stems(v.ws.join(' ')); return need.every((h) => st.has(h)); };
  const scored = trimVariants(s.split(/\s+/)).map((v) => {
    const ok = keeps(v) && (!needCue || CUE.test(v.ws.join(' '))) && (!needHedge || TEXT_HEDGE.test(v.ws.join(' ')));
    return { v, ok, s: variantScore(v) + (ok ? 0 : -6) };
  }).sort((a, b) => b.s - a.s);
  const best = scored[0];
  const text = tidy(best.v.ws.join(' '));
  return { text: asked ? `${text}?` : text, cut: best.v.cut, keptHook: need.length > 0 && best.ok, lostHook: !best.ok, ...(asked ? { question: true } : {}) };
}

/** Last resort: the cleaned source title up to its first ':' or ' - ', trimmed to the length limits. */
function fallbackHeadline(title, lex) {
  const raw = cleanForHeadline(title).split(/:\s|\s[-–—]\s|\?\s/)[0];
  const first = recase(raw, lex, isTitleCase(raw.split(' ')));
  const ws = first.split(/\s+/).slice(0, MAX_WORDS);
  while (ws.length > 3 && (ws.join(' ').length > MAX_CHARS || badEnding(ws))) ws.pop();
  return tidy(ws.join(' '));
}

module.exports = {
  MAX_WORDS, MAX_CHARS, STOP, GENERIC, TREND_NOISE, ENTITY_STOP, VERB_RE, CUE,
  foldGDrop, words, stem, stems, isCapWord, quoteImbalance, verbIndex, uniq, buildLexicon, wordClass, rewrite, fallbackHeadline, kymHeadline,
  recase, curlQuotes, looksVerb,
  gerundToPresent, explainerHeadline, cleanForHeadline, isTitleCase, isDictWord: (w) => inDictExact(w), inDict,
  isProperWord: (w) => !!PROPER_WORDS && PROPER_WORDS.has(w), isFirstName: (w) => FIRST_NAMES.has(w),
  expandSurname,
};
