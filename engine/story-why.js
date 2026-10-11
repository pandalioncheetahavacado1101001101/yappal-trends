'use strict';
/*
 * Story step, the parts of the why line that tie it to the moment itself (story-pick.js joins them):
 *   hook     the moment's own detail, told by its coverage and missing from the moment line ("Trump breaks his salute after
 *            being startled by a military fly-over"; "calls him a ‘red-headed puppet’"). For a private person's clip, the
 *            rebuttal ("the clip did not tell the full story") and never a shaming headline
 *   latest   the story's newest on-topic row, only when it really is the newest (the story's rows plus the story search) and
 *            newer than the moment; a newer row that cannot be shown means no "latest" at all
 *   search   a search surge that measures the moment, not the game ("fever vs aces" and "minnesota football" are fixtures), with a
 *            gloss for a person the reader may not know ("her reported boyfriend, country singer Tucker Wetmore")
 *   hedge    a reported claim keeps its "reportedly" / "(report)" / "…, X says"
 *   heat     from the moment's own coverage: a second wave (a late-night roast days later), a cap on "rising" for an old moment
 *   sensitive  accusations about a real person (grooming, abuse, fraud) never ride along in an earlier or same-week clause
 * Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const F = require('./story-focus');
const L = require('./story-lines');
const T = require('./story-terms');
const { uniqByKey, contains } = require('./util');

const { DAY, HOUR, words, stem, ymd } = T;

// accusations and diagnoses that never ride along with a meme about a real person
const SENSITIVE = /\b(groom(?:ing|ers?|ed)|grooming gangs?|abus(?:e|ed|er|ers|ive)|pa?edo\w*|paedophil\w*|pedophil\w*|dementia|fraudster|paranoid|rap(?:e|ed|ist)|molest\w*|traffick\w*|predator|sex offender|mental(?:ly)? ill|profane accusation|accusations?)\b/i;
// headlines that shame a private person; their rebuttal is told instead
const SHAMING = /\b(worthless|lazy|useless|deadbeat|slammed|smack(?:ed)? him|destroyed|shamed|shaming|loser|disgrace\w*)\b/i;
// a headline aimed at the private person beside the subject ("MLB fans call out man")
const TARGETS_PRIVATE = /\b(?:call(?:s|ed)? out|slam(?:s|med)?|rip(?:s|ped)?|roast(?:s|ed)?|troll(?:s|ed)?|drag(?:s|ged)?|sham(?:e|es|ed)|blast(?:s|ed)?)\s+(?:the\s+|her\s+)?(?:\w+\s+)?(man|husband|woman|wife|dad|mom|mother|father|boyfriend|girlfriend|partner|guy)\b/i;
// the private person's side of it: the clip was not the whole story, the fallout went too far
// the rebuttal proper: the clip was not the whole story, the fallout went too far
const REBUTTAL_STRONG = /\b(grieving|did(?:n['’]t| not) tell|full story|what (?:you|she|he|they) (?:didn['’]t|did not) see|death threats?|threats|context)\b/i;
const REBUTTAL = /\b(grieving|did(?:n['’]t| not) tell|full story|what (?:you|she|he|they) (?:didn['’]t|did not) see|death threats?|threats|defends?|speaks? out|breaks? (?:her|his|their)? ?silence|responds?|context|(?:confirms|says) (?:she|he|they)(?:['’](?:s|re)| is| are) (?:ok|okay|fine)|opens? up)\b/i;
// a search that measures the game, not the moment ("fever vs aces", "minnesota football", "twins vs giants")
const FIXTURE_WORD = /^(?:vs|v|versus|football|basketball|baseball|soccer|hockey|game|games|match|score|scores|highlights|live|today|tonight|stream|tickets|schedule|playoffs?|wnba|nba|nfl|mlb|nhl|ncaa|college|cfb)$/;
// the hedge a reported claim carries in its title
const HEDGE_WORD = /\b(reportedly|allegedly|rumou?red)\b/i;
// (and one a title leads with: "Report: Drake paid ...", "Sources: ...")
const HEDGE_LEAD = /^\W*(?:reports?|sources?|rumou?rs?)\s*:\s/i;
// the verb a reported claim turns on ("refuse", "reject", "dating")
const CLAIM_VERB = /^(?:refus(?:e|es|ed)|reject(?:s|ed)?|ban(?:s|ned)?|block(?:s|ed)?|drop(?:s|ped)?|pull(?:s|ed)?|cancel(?:s|led|ed)?|split(?:s)?|quit(?:s)?|sign(?:s|ed)?|join(?:s|ed)?|leav(?:e|es)|left|fire(?:s|d)?|sue(?:s|d)?|dat(?:e|es|ed|ing)|plan(?:s|ned)?|face(?:s|d)?|lost|lose(?:s)?|won|win(?:s)?)$/i;
const HEDGE_TAIL = /[:,]\s*(?:report|reports|sources?)\s*$|\((?:report|reports)\)\s*$/i;
const SAYS_TAIL = /,\s*((?:[\p{L}’'.-]+\s+){0,4}[\p{L}’'.-]+)\s+(says|claims|reports|alleges)\s*$/iu;
// hype says nothing about what happened
const HYPE = /\b(jaw-?dropping|incredible|insane|wild|stunning|shocking|epic|unbelievable|mind-?blowing|iconic|hilarious|immediately|bizarre)\b/i;
const LATEST_SLACK_HOURS = 6; // "latest" is the newest showable row, within this of the newest on-topic row
const HOOK_MIN_NEW = 2; // a hook adds at least this many specific words the moment line lacks
const COMMON_PREFIX_MIN = 3;

const norm = (s) => words(s).join(' ');
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const dayLabel = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

/** Syndicated or re-dated copies of one title count once, at their first date (Mashable's 28 Sep copy of its 20 Sep story). */
function firstCopies(rows) {
  const seen = new Set();
  return uniqByKey(rows).slice().sort((a, b) => a.t - b.t).filter((it) => { const k = F.titleKey(it).replace(/^(?:video|watch) /, ''); return seen.has(k) ? false : seen.add(k); });
}

/** The moment is a private person's ("Giants ‘mom of the year’ ..."), not a public figure's doing something to a fan. */
const isPrivateSubject = (P) => !P.E || (R.CROWD_SUBJECT.test(P.momentText) && !(norm(P.momentText) + ' ').startsWith(`${P.E} `));

// ---------- the hedge ----------
/** The line with its title's hedge kept: "reportedly" before the verb, "(report)" at the end, or ", X says". */
function withHedge(text, title) {
  if (!title || F.HEDGE.test(text) && /\b(reported(?:ly)?|report|allegedly|says|claims|rumou?red|sources?)\b/i.test(text)) return text;
  const t = W.curlQuotes(title).replace(/\s+[-–|]\s+[^-–|]+$/, '').trim();
  if ((HEDGE_WORD.test(t) || HEDGE_LEAD.test(t)) && !HEDGE_WORD.test(text)) {
    const toks = text.split(' ');
    const hedge = (t.match(HEDGE_WORD) || [null, 'reportedly'])[1].toLowerCase();
    const claim = toks.findIndex((w, i) => i > 0 && CLAIM_VERB.test(w));
    if (claim > 0) return [...toks.slice(0, claim), hedge, ...toks.slice(claim)].join(' ');
    const at = toks.findIndex((w, i) => i > 0 && /^[a-z]/.test(w) && (W.VERB_RE.test(w) || W.looksVerb(w.replace(/[^a-z]/g, ''))));
    // "Platforms reject Musk doc ads": a plural subject and a plain verb the suffix test misses
    const at2 = at > 0 ? at : toks.length >= 3 && /^[a-z]+$/.test(toks[1]) && !W.STOP.has(toks[1]) && /s$/i.test(toks[0]) ? 1 : -1;
    if (at2 > 0) return [...toks.slice(0, at2), hedge, ...toks.slice(at2)].join(' ');
    // (else right after the name the line opens with: "Drake reportedly paid ...")
    const at3 = toks.findIndex((w, i) => i > 0 && /^\p{Ll}/u.test(w) && toks.slice(0, i).every((x) => /^[^\p{L}]*\p{Lu}/u.test(x)));
    if (at3 > 0) return [...toks.slice(0, at3), hedge, ...toks.slice(at3)].join(' ');
    return `${text} (reportedly)`;
  }
  if (HEDGE_TAIL.test(t)) return `${text.replace(/[.;:,]+$/, '')} (report)`;
  const says = t.match(SAYS_TAIL);
  if (says && !norm(text).includes(norm(says[1]))) return `${text.replace(/[.;:,]+$/, '')}, ${says[1]} ${says[2]}`;
  return text;
}

/**
 * The rewriter can join a title's ends ("... still has no agent, [and her creator] says that's Hollywood's loss"): a line that is not
 * one stretch of its title is told by the title as written instead.
 */
function faithful(x, it, P) {
  if (!x) return rawLine(it, P, 14);
  if (norm(W.curlQuotes(it.title)).includes(norm(x.text).replace(/\bdrew boos reaction mixed\b/, 'booed'))) return x;
  return rawLine(it, P, 14) || null;
}

const DESCRIPTOR = /^(?:(?:British|American|English|Irish|Scottish|Welsh|Australian|Canadian|former|ex-Tory|Tory|Labour|Conservative|Democratic|Republican)\s+)+(?:politician|MP|minister|cabinet minister|lawmaker|senator)\s+(?=\p{Lu})/iu;
/** A quoted phrase in the casing most titles print it: "‘Red-Headed Puppet’" -> "‘red-headed puppet’". */
function quoteCase(text, items) {
  return text.replace(/‘([^’]{3,50})’/g, (m, q) => {
    const k = norm(q);
    const seen = new Map();
    for (const it of items) for (const mm of W.curlQuotes(it.title).matchAll(/[‘“]([^’”]{3,50})[’”]/g)) if (norm(mm[1]) === k) seen.set(mm[1], (seen.get(mm[1]) || 0) + (W.isTitleCase(it.title.split(/\s+/)) ? 0.5 : 1));
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
    // a Title Case headline's casing is no evidence: only a sentence-case title's quote replaces the line's
    return best && best[1] >= 1 ? `‘${best[0]}’` : m;
  });
}

// a late-night or sketch show taking up the moment days later is a second wave
const TV_SHOW = /\b(snl|saturday night live|weekend update|kimmel|colbert|fallon|late show|tonight show|daily show|seth meyers|last week tonight|john oliver)\b/i;

// ---------- the hook ----------
/** Stems a line adds beyond what is already said (the moment, the story, the main name, frame and filler words). */
function newStems(text, said, P) {
  return F.contentStems(text, P.skip).filter((s) => !said.has(s) && !T.ANGLE_STOP.has(s) && !W.GENERIC.has(s) &&
    !/^(viral|internet|react|onlin|social|media|clip|video|footag|watch|moment|meme|trend|goe|went|goes)$/.test(s));
}

const lineStemsOf = (text, P) => F.contentStems(text, P.skip);
// a ratings or figures release is a report, not a detail of the moment
const REPORT = /\b(viewing figures|tv figures|ratings?|viewers? figures|audience figures|overnight figures|box office|brings? in (?:an? )?(?:\w+ )?audience)\b/i;
const act = (P) => (P.m && P.m.action && P.m.action.startsWith('w:') ? P.m.action.slice(2) : null);
const probeStems = (text) => new Set(words(text).map(stem));
/** New words that are a name (capitalised mid-line), a number or inside quotes. */
function concreteCount(text, fresh, lex) {
  const set = new Set(fresh);
  // a Title Case title capitalises every word: only a known name or a word no dictionary has counts as a name
  const nameWord = (w) => lex.proper.has(w) || lex.firstNames.has(w) || !W.inDict(w);
  let n = 0;
  const toks = W.curlQuotes(text).split(/\s+/);
  let inQuote = false;
  toks.forEach((tok, i) => {
    const opens = /^[‘“]/.test(tok);
    const w = words(tok)[0];
    const st = w ? stem(w) : '';
    if (w && set.has(st) && ((i > 0 && /^[^\p{L}\p{N}]*\p{Lu}/u.test(tok) && nameWord(w)) || /\d/.test(tok) || inQuote || opens)) { n++; set.delete(st); }
    if (opens) inQuote = true;
    if (/[’”](?:[,.;:!?])?$/.test(tok) && !/^[‘“]?\p{L}+['’]\p{L}/u.test(tok)) inQuote = false;
  });
  return n + (/\b\d[\d.,]*\s?(?:million|m|billion|bn|k)\b/i.test(text) ? 1 : 0);
}

/**
 * A roundup's other item after a comma ("SNL Weekend Update roasts wincing Trump's China meeting, Pete Hegseth's ..."): a last segment
 * that names someone else and shares no word with the moment's coverage goes.
 */
function dropTrailingSubject(text, P) {
  const parts = text.split(/,\s+/);
  if (parts.length < 2) return text;
  const last = parts[parts.length - 1];
  const vocab = P.vocab || new Set();
  const namesOther = /\p{Lu}\p{Ll}+['’]s\b|\b\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+/u.test(last) && !(P.E && contains(norm(last), P.E));
  const shares = F.contentStems(last, P.skip).some((s) => vocab.has(s) && !T.ANGLE_STOP.has(s));
  return namesOther && !shares ? parts.slice(0, -1).join(', ') : text;
}

// openers and tails that frame a title rather than tell it
const RAW_OPENER = /^(?:(?:obviously|of course|clearly|naturally|unsurprisingly),\s+|(?:the\s+)?internet reacts (?:as|after|to)\s+|watch:?\s+|video:?\s+|see\s+|breaking:?\s+|exclusive:?\s+|['‘“][^’”]{3,60}[’”]\s*[:–—-]\s+)/i;
const RAW_TAIL = /\s+(?:in|on) (?:a )?viral (?:clip|video|footage|post)\b.*$|\s+[-–—|:]\s*(?:watch|video|see (?:it|the video|photos?))\b.*$/i;

/** The tokens that spell a name, in the casing most titles use. */
function withSurface(text, name, items) {
  const toks = text.split(' ');
  const n = name.split(' ').length;
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j <= Math.min(toks.length, i + n + 1); j++) {
      if (words(toks.slice(i, j).join(' ')).join(' ') !== name) continue;
      const tail = (toks[j - 1].match(/(['’]s)?[^\p{L}\p{N}.]*$/u) || [''])[0];
      // (the opening quote stays: "‘Cornell 7’ website")
      const lead = (toks[i].match(/^[^\p{L}\p{N}]*/u) || [''])[0];
      const surface = T.surfaceOf(name, items);
      return [...toks.slice(0, i), `${lead}${surface}${tail}`, ...toks.slice(j)].join(' ');
    }
  }
  return text;
}

/**
 * A title told as it was written, for a hook: the headline rewriter turns "hits 4 million views" into "goes viral", which is the
 * one detail the hook is for. The outlet, a framing opener ("The Internet Reacts As"), a "... in viral clip: ‘quote’" tail and a
 * second sentence go; Title Case is lowered the rules' way; the wording rules still apply.
 */
function rawLine(it, P, maxWords = 16) {
  let t = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '').trim().replace(/\bliterally\s+/gi, '');
  // "‘He Was Grieving’: ‘Multitasking’ Giants Mum Defends Husband, but ..." -> "... defends husband: ‘He was grieving’"
  const lead = t.match(/^([‘“][^’”]{3,60}[’”])\s*[:–—-]\s+(.+)$/);
  if (lead) t = `${lead[2].split(/,\s+(?:but|as|and)\s+/i)[0]}: ${lead[1]}`;
  for (let i = 0; i < 2; i++) t = t.replace(RAW_OPENER, '');
  t = t.replace(RAW_TAIL, '');
  if (!lead) t = t.split(/(?<=[a-z0-9’”])[.!?]\s+(?=\p{Lu})|:\s+(?=[‘“'"]?\p{Lu})/u)[0].trim();
  const toks = t.split(/\s+/);
  if (toks.length < 4) return null;
  // a feed cut the title short ("... captures unexpected off-court mo"): the half-word goes with its clause, or the line does
  const raw0 = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '').trim();
  const lastTok = words(toks[toks.length - 1])[0] || '';
  if (raw0.length >= 90 && t === raw0 && lastTok.length <= 4 && !W.inDict(lastTok) && !/\d/.test(lastTok)) return null;
  if (toks.length > maxWords) {
    // cut at a clause boundary inside the limit, never mid-quote
    // (never inside a list of names: "as Dave Grohl, [Krist Novoselic and Pat Smear ...]")
    const nameList = (w, i) => W.isCapWord(w) && W.isCapWord(toks[i + 1] || '');
    const cutAt = toks.slice(0, maxWords).map((w, i) => ((/[,;]$/.test(w) && !nameList(w, i)) || /^(as|while|amid|but)$/i.test(toks[i + 1] || '') ? i + 1 : 0)).filter((i) => i >= 5).pop();
    if (!cutAt) return null;
    t = toks.slice(0, cutAt).join(' ').replace(/[,;]$/, '');
  }
  const titleCase = W.isTitleCase(t.split(/\s+/));
  let text = F.safeLine(titleCase ? W.recase(t, P.lex, true) : t, { contested: P.contested });
  // a Title Case quote is lowered too, but for its first word and names ("‘He Was Grieving’" -> "‘He was grieving’")
  if (titleCase) text = text.replace(/([‘“])([^’”]{3,60})([’”])/g, (m, a, q, b) => a + q.split(' ').map((w, i) => (i === 0 || P.lex.proper.has(words(w)[0] || '') || P.lex.firstNames.has(words(w)[0] || '') ? w : w.toLowerCase())).join(' ') + b);
  text = F.recaseFrom(text, [it, ...P.caseItems], P.lex);
  // names as the titles spell them ("P.J. Fleck", not "p.j. Fleck")
  for (const n of [P.E, ...((P.m && P.m.opener) || []).filter((k) => k.startsWith('n:')).map((k) => k.slice(2))].filter(Boolean)) text = withSurface(text, n, P.field);
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (T.openQuoteAtEnd(text) || T.DANGLING.test(text) || F.unsafeLine(text) || F.CENSORED.test(text) || F.namesPrivate(text, P.priv, P.keepNames)) return null;
  return { it, text, cut: t !== W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '').trim() };
}

/** A line told by someone new doing something ("Newsnight host encouraged Rory Stewart ..."), not the main name or the crowd. */
function newActor(text, P) {
  const lead = norm(text).split(' ').slice(0, 3).join(' ');
  if (!P.E || contains(lead, P.E) || contains(lead, P.E.split(' ').pop()) || /^(the )?(internet|fans?|people|viewers|social media|users|everyone|critics)\b/.test(lead)) return 0;
  return /\b(host|presenter|producer|director|creator|designer|wife|husband|mum|mom|team|rep|studio|network)\b/.test(lead) ? 1.5 : 0.5;
}
/** "Rory Stewart mocked for ...": the crowd's verdict on the main name retells the reaction, it adds no detail. */
function crowdVerdict(text, P) {
  return P.E && (norm(text) + ' ').startsWith(`${P.E} `) && /^\S+\s+\S+\s+(?:is\s+|was\s+|gets?\s+)?(mocked|ridiculed|slammed|roasted|trolled|praised|hailed|dragged|blasted)\b/i.test(text) ? 1 : 0;
}

/** The tail of a hook that repeats the moment line's opening words ("Amelia Dimoldenberg roasts Ed Sheeran on SNL UK, calls him ..."). */
function dropSharedOpening(text, momentText, P) {
  const a = text.split(/\s+/);
  const b = norm(momentText).split(' ');
  let i = 0;
  while (i < a.length && i < b.length && norm(a[i]) === b[i]) i++;
  if (i < COMMON_PREFIX_MIN) return text;
  const rest = a.slice(i).join(' ').replace(/^[,;:–—-]+\s*/, '');
  const first = words(rest.split(/\s+/)[0] || '')[0] || '';
  if (rest.split(/\s+/).length < 3 || !/^[a-z]/.test(rest) || !(W.VERB_RE.test(first) || W.looksVerb(first))) return text;
  // the subject of what follows: the name the moment opens with ("Dimoldenberg calls him ...")
  const opener = (P.m.opener || []).map((k) => k.slice(2)).find(Boolean);
  const who = opener ? T.surfaceOf(opener, P.field).split(' ').pop() : null;
  return who ? `${who} ${rest}` : rest;
}

/**
 * The moment's own detail its coverage repeats and its line lacks. Candidates are the moment's coverage (not the story's), told
 * in the rules' neutral words; a private person's clip is told by its rebuttal, never by a shaming headline.
 */
function hookClause(P, story, extras = {}) {
  const privateSubject = isPrivateSubject(P);
  const grep = P.dbg && process.env.HOOK_GREP ? new RegExp(process.env.HOOK_GREP, 'i') : null;
  // a private person's rebuttal is told in rows that need not repeat the clip's words ("'He was grieving': ... defends husband")
  const vocab = P.vocab || new Set();
  const rebuttals = privateSubject ? P.field.filter((it) => REBUTTAL_STRONG.test(it.title) && F.contentStems(it.title, P.skip).filter((x) => vocab.has(x)).length >= 2) : [];
  if (grep) for (const it of P.field) if (grep.test(it.title)) P.dbg(`      hook-field ${REBUTTAL_STRONG.test(it.title)} ${F.contentStems(it.title, P.skip).filter((x) => vocab.has(x)).join(',')} ${ymd(it.t)} ${it.title.slice(0, 80)}`);
  const rows = firstCopies([...(P.hookRows || []), ...P.momItems, ...P.momentRows, ...rebuttals]).filter((it) => it.t <= P.now + DAY && it.t >= P.momentFirst - DAY && !F.CENSORED.test(it.title) &&
    it.fam !== 'kym' && it.fam !== 'bluesky' && it.drop !== 'publisher' && !/\s\/\s/.test(it.title) && !F.BAIT_TITLE.test(it.title) && (!P.E || T.namesE(it, P.E) || rebuttals.includes(it)) &&
    !F.REVIEW.test(it.title) && !F.EXPLAINER.test(it.title) && !SENSITIVE.test(it.title) && !F.byline(it.title, P.E));
  const said = new Set(F.contentStems(`${P.momentText} ${story ? story.text : ''} ${extras.avoid || ''}`, P.skip));
  // how many separate sources use each stem among the moment's rows: a detail two of them give is not one outlet's aside
  const bySrc = new Map();
  for (const it of rows) for (const s of it.textStems) { if (!bySrc.has(s)) bySrc.set(s, new Set()); bySrc.get(s).add(it.src); }
  const cands = [];
  // the moment's own marks: its action, the name it opens with, its own words
  // (a word most of the story's rows carry, like "Musk" under a nameless moment, marks nothing)
  const fieldN = new Set(P.field.map(F.titleKey)).size || 1;
  const own = [...(P.momentOwn || [])].filter((x) => (P.df.get(x) || 0) <= 0.5 * fieldN);
  const openers = (P.m.opener || []).filter((k) => k.startsWith('n:')).map((k) => k.slice(2));
  const marked = (it) => openers.some((n) => contains(it.textWords, n)) || (act(P) && it.textStems.has(act(P))) ||
    own.filter((x) => it.textStems.has(x)).length >= Math.min(P.E && own.length <= 2 ? 1 : 2, own.length) || (privateSubject && REBUTTAL_STRONG.test(it.title));
  // a detail only one title gives, capitalised as a name ("Mercury worker" where the rest say "arena staffer"), is that outlet's aside
  const rowDf = F.docFreq(rows);
  const rowTotal = new Set(rows.map(F.titleKey)).size;
  // (only a name in front of a role noun: a new fact like the dress's designer is not a rival to anything)
  const ROLE_AFTER = /^(worker|staffer|employee|fan|fans|official|guard|reporter|host|player|coach|mom|dad|woman|man)$/i;
  const singleSource = (text) => {
    if (rowTotal < 4) return false;
    const toks = text.split(/\s+/);
    const minority = new Set(F.minorityWords(text, rowDf, P.skip, rowTotal));
    return toks.some((w, i) => i > 0 && i + 1 < toks.length && /^[^\p{L}]*\p{Lu}/u.test(w) && minority.has(stem(words(w)[0] || '')) && ROLE_AFTER.test(words(toks[i + 1])[0] || ''));
  };
  for (const it of rows) for (const x of [P.lineOf(it, P, P.E, P.WHY_LIMITS_LONG), rawLine(it, P)]) {
    const why = (reason) => { if (grep && grep.test(it.title)) P.dbg(`      hook? ${reason}: ${it.title.slice(0, 90)}`); };
    if (!x) { why('no line'); continue; }
    let text = dropTrailingSubject(dropSharedOpening(x.text, P.momentText, P), P).replace(/^(?:video|watch|see)\s+/i, '')
      .replace(/\b(?:wild|shocking|bizarre|stunning|jaw-dropping|incredible|insane|brutally|savagely)\s+/gi, '').replace(/\s+in (?:a |the )?(?:\w+ )?(?:scene|moment)$/i, '');
    text = quoteCase(text.replace(DESCRIPTOR, ''), P.field);
    if (P.E) text = withSurface(text, P.E, P.field);
    text = text.charAt(0).toUpperCase() + text.slice(1);
    why(`line "${text}"`);
    // a line that lost its subject ("Captures Packers fan ...") says nothing on its own
    const w0 = words(text.split(/\s+/)[0] || '')[0] || '';
    if (W.looksVerb(w0) && !P.lex.proper.has(w0) && !P.lex.firstNames.has(w0) && !(P.m.opener || []).some((k) => k.endsWith(w0))) { why('no subject'); continue; }
    // a late-night show's take is the second wave, told on its own; a reversal the story already tells is no detail
    if ((REPORT.test(it.title) && !REPORT.test(P.momentText)) || (TV_SHOW.test(it.title) && !TV_SHOW.test(P.momentText)) || (story && story.kind === 'update' && F.CORRECTION[1].re.test(`${it.title} ${text}`)) || /\bnow accepted\b/i.test(text)) { why('wave/reversal'); continue; }
    // a disputed crowd reaction is told once, by the "accounts differ" clause
    if (P.contested && /\bboo/i.test(text)) { why('contested'); continue; }
    if (privateSubject && TARGETS_PRIVATE.test(it.title)) { why('targets private'); continue; }
    if (F.MOMENT_FRAME.test(text) && newStems(text, said, P).length < 3) { why('frame'); continue; }
    if (F.OPINION.test(text) || F.VAGUE.test(it.title) || /\?/.test(text) || F.META.test(text) || F.LOGISTICS.test(text)) { why('opinion/vague/meta'); continue; }
    // a preview is no detail of what happened ("France predicted XI: Lepaul and Jacquet to start as Zidane rotates Les Bleus")
    if (F.FUTURE.test(text)) { why('preview'); continue; }
    if (P.placeClash && P.placeClash(text)) { why('place'); continue; }
    if (privateSubject && (SHAMING.test(it.title) || F.LABEL.test(it.title))) { why('shaming'); continue; }
    // (a private person speaking out after the clip spread is the clip's aftermath, not damage control)
    if (F.SELF_DEFENSE.test(text) && !REBUTTAL.test(text) && !F.CONFLICT.test(text) && !(privateSubject && /\bspeaks? out\b/i.test(text))) { why('defence'); continue; }
    // a designed moment is never told with accident words ("glitches out" beside "creator says it was intentional")
    if (P.corr && P.corr.intentional.length && F.ACCIDENT.test(text)) { why('accident'); continue; }
    // the hook is about the moment: it carries one of the moment's own words (its action or what it is told with)
    const tst = probeStems(text);
    if (!marked(it)) { why('unmarked row'); continue; }
    if (singleSource(text)) { why('single-source detail'); continue; }
    if (own.length && !own.some((x) => tst.has(x)) && !openers.some((n) => contains(norm(text), n.split(' ').pop())) && !(privateSubject && REBUTTAL.test(it.title))) { why('off-moment'); continue; }
    // what most of the moment's rows already say ("stare", "guest") is no detail; a detail two of them give is not one outlet's aside
    const srcCount = new Set(rows.map((r) => r.src)).size;
    const common = (st) => srcCount >= 6 && (bySrc.get(st) || new Set()).size > 0.4 * srcCount;
    const fresh = newStems(text, said, P).filter((st) => !common(st));
    const shared = fresh.filter((st) => (bySrc.get(st) || new Set()).size >= 2);
    const rebuttal = privateSubject && REBUTTAL.test(it.title) && it.t > P.momentFirst + DAY ? (REBUTTAL_STRONG.test(text) ? 3 : 1) : 0;
    if (fresh.length < HOOK_MIN_NEW && !rebuttal) { why(`few new ${fresh}`); continue; }
    // a new claim about a private person ("‘He was grieving’") needs a major outlet or a second source saying it
    if (privateSubject && /[‘“]/.test(text) && !F.MAJOR.test(it.outlet || '') && !fresh.some((st) => (bySrc.get(st) || new Set()).size >= 2)) { why('single-source private claim'); continue; }
    text = withHedge(text, it.title);
    if (P.hedgeClaim) text = P.hedgeClaim(text);
    // concrete details: a name, a number or a quoted phrase the moment line does not have ("Hussein Chalayan", "4 million views")
    const concrete = concreteCount(text, fresh, P.lex);
    const retell = act(P) && probeStems(text).has(act(P)) ? 1.5 : 0;
    const aftermath = T.AFTERMATH.test(text) && !rebuttal ? 2 : 0;
    const hype = (HYPE.test(text) ? 1.5 : 0) + (SHAMING.test(text) ? 1 : 0) + (F.outletQuality(it) <= -1 ? 1.5 : 0);
    // the story line already says the story's names ("amid reported Tucker Wetmore romance" under that story)
    const storyStems = new Set(story ? F.contentStems(story.text, P.skip) : []);
    const retold = story ? 2 * lineStemsOf(text, P).filter((x) => storyStems.has(x)).length / Math.max(1, lineStemsOf(text, P).length) : 0;
    // what the moment line already says is retelling ("Comedian roasts 'red-headed puppet' Ed Sheeran on SNL UK ...")
    const lineStems = F.contentStems(text, P.skip);
    const momStems = new Set(F.contentStems(P.momentText, P.skip));
    const repeat = 3 * lineStems.filter((x) => momStems.has(x)).length / Math.max(1, lineStems.length);
    // a cause or a new actor ("host encouraged him ... before"), a number ("4 million views")
    const causal = /\b(before|after|because|when|while|during)\b/i.test(text) ? 0.8 : 0;
    const scale = F.SCALE_NUM.test(text) ? 1.5 : 0;
    const s = 1.0 * Math.min(4, fresh.length) + 0.8 * Math.min(3, shared.length) + 0.9 * Math.min(3, concrete) + F.outletQuality(it) +
      rebuttal + (T.hasVerb(text) ? 1 : -2) - (x.cut ? 0.6 : 0) - (text.split(/\s+/).length > 16 ? 1 : 0) - retell - aftermath - hype + causal + scale +
      newActor(text, P) - crowdVerdict(text, P) - repeat - 1.5 * retold;
    cands.push({ it, text, s, fresh, shared, cut: !!x.cut, len: text.length });
  }
  cands.sort((a, b) => b.s - a.s || Number(a.cut) - Number(b.cut) || b.len - a.len || a.it.t - b.it.t);
  if (P.dbg) for (const c of cands.slice(0, 5)) P.dbg(`      hook ${c.s.toFixed(2)} ${c.text} [new ${c.fresh.join(',')}] <= ${c.it.outlet}`);
  for (const c of cands) {
    // the titles that give the same detail, then the moment's own marked coverage; never an unrelated row
    const support = rows.filter((it) => it !== c.it && c.fresh.some((s) => it.textStems.has(s)) && marked(it));
    const trace = L.traceItems(c.it, [c.it, ...support, ...rows.filter(marked)]).map(L.traceTitle);
    if (L.traceable(trace)) return { it: c.it, text: c.text, trace };
  }
  return null;
}

/** A late-night or sketch show taking up the moment days later ("‘SNL’ Weekend Update roasts wincing Trump's China meeting"). */
function waveClause(P, used) {
  if (TV_SHOW.test(P.momentText)) return null; // the moment is itself a show's sketch
  const rows = firstCopies([...(P.hookRows || []), ...P.momItems]).filter((it) => TV_SHOW.test(it.title) && it.t >= P.momentFirst + 2 * DAY && !used.has(it));
  for (const it of rows.sort((a, b) => b.t - a.t)) {
    const x = faithful(P.lineOf(it, P, P.E, P.WHY_LIMITS_LONG), it, P);
    if (!x || F.OPINION.test(x.text)) continue;
    const text = quoteCase(dropTrailingSubject(x.text, P), P.field);
    const trace = L.traceItems(it, [it, ...rows, ...P.momItems]).map(L.traceTitle);
    if (L.traceable(trace)) return { it, text, trace, date: dayLabel(it.t) };
  }
  return null;
}

/**
 * "Block or charge?": the question the moment's own coverage asks is the argument it started, but only when people are shown to be
 * split: two separate titles pose it, or a title says viewers are divided. One outlet's question headline is its own joke.
 */
const SPLIT_WORDS = /\b(divided|divides|split|debate\w*|torn|argu(?:e|ing|ment)|can'?t agree)\b/i;
function debateClause(P) {
  const rows = firstCopies([...(P.hookRows || []), ...P.momItems]).filter((it) => Math.abs(it.t - P.momentFirst) <= 3 * DAY);
  const asked = new Map();
  for (const it of rows) {
    const m = W.curlQuotes(it.title).match(/^((?:[\p{L}’'-]+\s+){0,2}[\p{L}’'-]+\s+or\s+(?:[\p{L}’'-]+\s+){0,2}[\p{L}’'-]+)\?\s/u);
    if (!m) continue;
    const k = m[1].toLowerCase();
    if (!asked.has(k)) asked.set(k, { q: k, items: [] });
    asked.get(k).items.push(it);
  }
  for (const { q, items } of asked.values()) {
    const sides = q.split(/\s+or\s+/).map((s) => stem(words(s).pop() || ''));
    const split = rows.some((it) => SPLIT_WORDS.test(it.title) && sides.some((s) => it.textStems.has(s)));
    if (new Set(items.map((it) => it.src)).size < 2 && !split) continue;
    const trace = L.traceItems(items[0], [...items, ...rows]).map(L.traceTitle);
    if (L.traceable(trace)) return { it: items[0], text: `it split viewers: ‘${q}?’`, trace };
  }
  return null;
}

// ---------- the newest turn ----------
/**
 * The story's on-topic rows: the moment's rows and the story's, plus every saved row (the story search included) that carries two of
 * the story line's words; re-dated copies once, at their first date.
 */
function topicRows(P, story) {
  const st = story ? F.contentStems(story.text, P.skip).filter((s) => !T.ANGLE_STOP.has(s)) : [];
  const need = Math.min(2, st.length);
  const on = (it) => need > 0 && st.filter((s) => it.textStems.has(s)).length >= need && (!P.E || T.namesE(it, P.E));
  const keys = ((story && story.keys) || []).filter((k) => k.startsWith('n:') || k.startsWith('p:'));
  const keyed = (it) => keys.some((k) => T.carries(it, k)) && (!P.E || T.namesE(it, P.E));
  // a busy name's field holds only the rows the story search's second name narrows it to (Trump with Xi): all on topic
  const extra = P.busy ? P.field : P.field.filter((it) => on(it) || keyed(it));
  return firstCopies([...P.onTopic, ...extra]).filter((it) => it.t <= P.now + DAY && !F.CENSORED.test(it.title));
}

/**
 * "latest": the newest on-topic row of the story (not the moment's own coverage) that can be shown, only when nothing newer is
 * on topic (within a few hours) and it came after the moment. Otherwise there is no latest.
 */
/** A feed cut the title mid-word ("... interested in that viral lesbian bar masking s"): it cannot be shown, and it is no newer turn. */
function truncatedTitle(it) {
  const t = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '').trim();
  const last = words(t.split(/\s+/).pop() || '')[0] || '';
  const half = (last.length <= 2 && !/^(a|i|tv|uk|us|ai|dj|go|no|so|up|on|in|me|my|we|he|it|is|to|of|do|be)$/.test(last)) || (last.length <= 4 && !W.inDict(last));
  return t.length >= 60 && half && !/\d/.test(last) && !/[.!?”’"')]$/.test(t);
}

function latestTurn(P, story, used, accept) {
  // (a story-shaped headline's moment is where it began: the rest of its coverage is the story's)
  const rows = topicRows(P, story).filter((it) => (P.topic || !P.isMom(it)) && it.t > P.momentFirst && !truncatedTitle(it));
  if (!rows.length) return null;
  // the newest on-topic row, whether or not a line already tells it: nothing older is "latest"
  const newest = Math.max(...rows.map((i) => i.t));
  for (const it of rows.slice().sort((a, b) => b.t - a.t)) {
    if (it.t < newest - LATEST_SLACK_HOURS * HOUR) break;
    if (used.has(it)) continue;
    const x = accept(it);
    if (x) return { ...x, it, date: dayLabel(it.t) };
  }
  if (P.dbg) P.dbg(`      latest: none (newest ${ymd(newest)} ${rows.find((i) => i.t === newest).title.slice(0, 70)})`);
  return null;
}

// ---------- search surges ----------
/** A search for the game or the match, not the moment: "fever vs aces", "minnesota football", "twins vs giants". */
function isFixtureSearch(keyword) {
  const ws = words(keyword);
  if (ws.some((w) => /^(vs|v|versus)$/.test(w))) return true;
  const rest = ws.filter((w) => !FIXTURE_WORD.test(w));
  const teamOrPlace = (w) => R.TEAM_WORDS.has(w) || R.TEAM_WORDS.has(`${w}s`) || R.PLACES.has(w);
  return rest.length < ws.length && rest.every(teamOrPlace) || rest.length > 0 && rest.every(teamOrPlace) && ws.length <= 2;
}

/**
 * Who a searched person is, as the titles put it right before the name ("country singer Tucker Wetmore", "Ella Langley’s boyfriend
 * Tucker Wetmore"): a relationship is "reported" unless the titles confirm it. Null when the keyword is no person's name.
 */
function glossPerson(keyword, P) {
  const kw = norm(keyword);
  const first = kw.split(' ')[0];
  if (kw.split(' ').length < 2 || !(W.isFirstName(first) || P.lex.firstNames.has(first) || P.lex.names.has(kw)) || (P.E && (kw === P.E || contains(kw, P.E)))) return null;
  const counts = new Map();
  let romance = 0;
  let pron = 0;
  for (const it of P.field) {
    const t = W.curlQuotes(it.title);
    if (P.E && T.namesE(it, P.E)) pron += (t.match(/\bher\b/gi) || []).length - (t.match(/\bhis\b/gi) || []).length;
    if (!contains(it.textWords, kw)) continue;
    if (/\b(dating|romance|boyfriend|girlfriend|beau|item)\b/i.test(t)) romance++;
    const m = t.match(new RegExp(`\\b((?:fellow\\s+)?(?:country(?: music)?|pop|rock|k-pop|british|american)\\s+(?:singer|star|rapper|musician|artist|singer-songwriter))\\s+${kw.split(' ').map((w) => `${w}[\\p{L}’']*`).join('\\s+')}`, 'iu'));
    if (m) { const d = m[1].toLowerCase().replace(/^fellow\s+/, '').replace(/country music/, 'country'); counts.set(d, (counts.get(d) || 0) + 1); }
  }
  const desc = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const name = T.surfaceOf(kw, P.field);
  const rel = romance >= 2 && P.E ? `${pron > 0 ? 'her' : pron < 0 ? 'his' : `${T.surfaceOf(P.E, P.field)}’s`} reported boyfriend` : null;
  if (!desc && !rel) return null;
  return { name, desc: desc ? desc[0] : null, rel, text: [rel, desc && desc[0] ? `${desc[0]} ${name}` : name].filter(Boolean).join(', ') };
}

// ---------- heat ----------
/**
 * The moment's heat from its own coverage (re-dated copies once): a second wave when, three days on, the last 72 h bring at least as
 * much as its first two days did from two or more outlets; "rising" when the last 48 h beat the 48 h before; an old moment (over
 * seven days) is never "rising" without new rows of its own in the last 48 h.
 */
function momentHeat(rows, momentFirst, now, dbg = null) {
  const own = firstCopies(rows).filter((i) => i.t <= now + HOUR);
  if (dbg) for (const i of own) dbg(`   heat ${new Date(i.t).toISOString().slice(0, 16)} ${i.outlet} | ${i.title.slice(0, 70)}`);
  if (!own.length) return 'fading';
  const age = (now - momentFirst) / DAY;
  const outlets = (xs) => new Set(xs.map((i) => (i.fam === 'reddit' || i.fam === 'bluesky' ? i.fam : i.src))).size;
  const last48 = own.filter((i) => now - i.t < 2 * DAY);
  const prev48 = own.filter((i) => now - i.t >= 2 * DAY && now - i.t < 4 * DAY);
  const first = own.filter((i) => i.t < momentFirst + 2 * DAY);
  const late = own.filter((i) => i.t >= Math.max(momentFirst + 2 * DAY, now - 3 * DAY));
  // a second wave: days on, a late-night show or a fresh run of coverage after a quiet day
  const days = new Set(own.map((i) => ymd(i.t)));
  const lull = late.length > 0 && [...Array(Math.max(0, Math.round((Math.min(...late.map((i) => i.t)) - momentFirst) / DAY)))].some((_, k) => !days.has(ymd(momentFirst + (k + 1) * DAY)));
  if (age >= 3 && outlets(late) >= 2 && (late.some((i) => TV_SHOW.test(i.title)) || (lull && late.length >= 3))) return 'second wave';
  const byDay = new Map();
  for (const i of own) byDay.set(ymd(i.t), (byDay.get(ymd(i.t)) || 0) + 1);
  const busiest = Math.max(...byDay.values());
  const rising = last48.length > prev48.length && outlets(last48) >= 2;
  if (rising && !(age > 7 && !last48.length)) return 'rising';
  if (last48.length > 0 && last48.length >= 0.5 * busiest) return 'peak';
  return 'fading';
}

module.exports = {
  debateClause, REPORT, isPrivateSubject, waveClause, quoteCase, rawLine, faithful, TARGETS_PRIVATE, TV_SHOW, SENSITIVE, SHAMING, REBUTTAL, firstCopies, withHedge, hookClause, topicRows, latestTurn, isFixtureSearch, glossPerson, momentHeat,
  dayLabel,
};
