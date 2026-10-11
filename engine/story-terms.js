'use strict';
/*
 * Story step, shared vocabulary: the word lists and patterns story.js reads titles with, and the per-item helpers (who an item
 * names, which independent source it is, what it says). Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const C = require('./cluster');
const { contains, outletKey } = require('./util');

const { words } = W;

// the story step's own synonyms, so "mocking", "roasting" and "trolls" are one action (clustering keeps wording.js's stems)
const SYN = { mock: 'roast', troll: 'roast', dunk: 'roast', torch: 'roast', ridicul: 'roast', cockroach: 'roach', dropp: 'drop', onstage: 'stage', heckl: 'boo', jeer: 'boo', documentary: 'doc', documentari: 'doc', staffer: 'worker', employe: 'worker', employee: 'worker', ads: 'ad', resign: 'quit', withdraw: 'quit', depart: 'quit', exit: 'quit', opener: 'act', winc: 'flinch', wince: 'flinch', startl: 'flinch', startle: 'flinch', spook: 'flinch', collision: 'collid', furiou: 'backlash', fury: 'backlash', outrage: 'backlash', outcry: 'backlash', refus: 'reject', refuse: 'reject',
  // one act told two ways ("smears" / "wipes" the blood, "dress" / "minidress", a "fan" / an "influencer" asking her out)
  wip: 'smear', wipe: 'smear', minidress: 'dress', influencer: 'fan' };
const stem = (w) => { const x = W.stem(w); return SYN[x] || x; };
const DAY = 86400000;
const HOUR = 3600000;

// items dropped for these reasons may still be context inside a story (never its headline); safety drops never are
// (a platform's ad policy is "tech business" as a headline, but it is the Musk documentary's story)
// a lawsuit is part of a public figure's story ("Musk threatens lawsuit over 'Musk' documentary"); story lines about the law must
// name a public figure (story-pick.js)
const CONTEXT_DROPS = new Set(['politics', 'hard-news', 'publisher', 'industry', 'service', 'question', 'sports', 'satire', 'tech-business', 'crime']);
const splitList = (s) => s.split(/\s+/).filter(Boolean);

// a role noun right after a name makes the story someone else ("Jennifer Lopez lookalike", "Taylor Swift fan")
const ROLE_WORDS = new Set(splitList('lookalike doppelganger impersonator fan fans superfan stalker parody'));

// words that never carry an angle on their own: reporting and action verbs, frames, time words, people and plain nouns
const ANGLE_STOP = new Set(splitList(`respond react slam speak break reveal share call claim admit address defend explain watch show star
  say tell ask get set make take give turn leave join open close start end return hit drop dropp cancel apologi apologiz sorry
  attend announce confirm deny praise blast rip mock troll roast spark fuel hold host launch release tease unveil post perform sing
  play meet move sign quit walk run beat lead follow bring receive send put keep help find try feel honor honour celebrate
  controversy controversi backlash drama row fallout feud beef scandal debate situation crisis criticism boycott outrage fury
  week weekend night morning saturday sunday monday tuesday wednesday thursday friday today tonight yesterday year month
  first last new big huge major latest next years old one two three four five six seven eight nine ten
  after amid over during following before ahead inside behind about against since
  viral video clip photo photos picture pictures moment meme memes internet online social media post posts fans fan people
  report reports source sources insider update exclusive watch look looks see seen here there what why how who
  thing things way time times day days star stars singer rapper actor actress host celebrity music song songs album show
  shows movie film series episode interview podcast game games team player woman women man men girl boy guy person
  win wins won lose loss news story stories life love family wife husband daughter son kid kids mom dad mother father parent
  brutal wild epic iconic stunning shocking emotional massive rare real true full official public private good great best
  would could should will can may might must need needs want wants think thinks know knows go goes went gone come comes came
  back down out off up right left still even just only also`).map(stem));
const FRAME_RE = /\b(controvers(?:y|ies)|drama|backlash|row|fallout|feud|beef|scandal|firestorm|uproar|rift|saga|crisis|boycott)\b/gi;

// the headline is already a story, not a clip: "Debate over iced coffee at interviews", "Last Ditch bar mask-optional controversy",
// "The internet is arguing about ..."
const STORY_HEADLINE = /\b(debate|debates|debating|arguing|argue|discourse|controvers(?:y|ies)|backlash|feud|drama|row|divided|theory|theories|trend)\b/i;

// the headline is an aftermath: the clip itself came earlier
const AFTERMATH = /\b(responds?|defends?|reacts? to|addresses|speaks out|breaks (?:his |her |their )?silence|clarifies|apologi[sz]es|explains|says (?:she|he|they)|issues|calls out|flags|denies|reveals truth)\b/i;

// the aftermath part of a headline, stripped to find the original clip ("... defends her husband", "breaks silence on ...")
const AFTERMATH_PHRASE = /\b(?:responds?|defends?|reacts? to|addresses|speaks out|breaks (?:his |her |their )?silence|clarifies|apologi[sz]es|explains|issues|calls out|flags|denies)\b(?:\s+(?:to|on|over|about|after|following|amid|his|her|their|the|a|an))*(?:\s+(?:husband|wife|boyfriend|girlfriend|partner|son|daughter|mom|dad|family|fans?))?/i;

// who or what started a story ("A recruiter said ...", "A Globe story about ... went viral")
const ORIGIN_RE = /\b(recruiter|article|story|video|clip|post|tweet|tiktok|op-?ed|column|thread|photo|meeting|speech|report|survey|poll|essay|review)\b/i;
const ORIGIN_VERB = /\b(says?|said|claims?|posted|wrote|shared|filmed|required|went viral|goes viral|sparks?|sparked|ignit\w+)\b/i;

// "amid reported Tucker Wetmore romance", "after Macklemore drama", "Amid Tour Controversy": what the moment's coverage says it follows
const CAUSE_RE = /\b(?:amid|after|over|following|during|since)\s+((?:[^\s,;:.!?]+\s+){0,5}?(?:controvers\w*|drama|backlash|row|fallout|feud|romance|relationship|split|engagement|wedding|release|retirement|scandal|comments?|remarks?|statements?|stance|exit|departure|breakup|announcement|reunion|snub|win|wins|loss|defeat|diss|record|visit|summit|premiere|opener|finale|arrest|firing|removal|ban|boycott|cancellation))\b/gi;

/**
 * A story named by the moment's coverage itself: the same "amid/after X" clause in two sources ("Amid Amaal Mallik Credit Row",
 * "amid Amaal Mallik’s credit row"). The commonest wording wins; a romance or relationship is the main name's.
 */
const CAUSE_STORY = /(?:controvers\w*|drama|backlash|row|fallout|feud|romance|relationship|split|engagement|scandal|boycott|breakup)$/i;

// a Wikipedia page that names a story ("Macklemore–Ed Sheeran tour controversy")
const ARTICLE_STORY = /\b(controvers(?:y|ies)|feud|scandal|dispute|incident|affair|row|saga|backlash|boycott)\b/i;

// the crowd's reaction to the moment, strongest first; `framing` reactions can be a story ("ignited a debate")
const REACTIONS = [
  { key: 'split', framing: true, re: /\b(divided|divides|debate|debating|arguing|split over|torn over|sparks? (?:a )?debate|ignit\w+ (?:a )?debate|hot take)\b/i, text: 'people are split over it' },
  { key: 'backlash', framing: true, re: /\b(backlash|slammed|slams?|ripped|savaged|criticis\w+|criticiz\w+|outrage|outraged|fury|furious|fuming|enrag\w+|called out|under fire|boycott\w*)\b/i, text: 'it drew backlash' },
  { key: 'meme', re: /\b(memes?|instant meme|meme format|becomes? a meme|became a meme)\b/i, text: 'it became a meme' },
  { key: 'roast', re: /\b(roast\w*|mock\w*|troll\w*|dunk\w*)\b/i, text: 'people are piling on with jokes' },
  { key: 'love', re: /\b(wholesome|heartwarming|adorable|sweet|tears|cries|cried|sobs|sobbing|sobbed|internet loves|fans love)\b/i, text: 'people love it' },
];

// verbs that say nothing about what happened ("becomes a meme", "goes viral", "gets booed")
const PLAIN_VERB = new Set(splitList('becomes become goes gets makes takes gives says shows has have is are was were does brings'));

// leagues, broadcasters and outlets are where a story is told, not what it is about
const ORG_NAMES = new Set(splitList(`nfl nba wnba mlb nhl ncaa mls sec fifa uefa espn fox cbs nbc abc cnn bbc itv hbo mtv tmz
  pagesix billboard variety deadline`).concat(['big ten', 'premier league', 'fox news', 'monday night football', 'sunday night football',
  'good morning america', 'the athletic', 'new york times', 'new york post', 'daily mail', 'rolling stone', 'hollywood reporter', 'us weekly']));
const DANGLING = /\b(this|that|the|a|an|of|to|for|with|about|from|into|and|or|his|her|their|its|my|your|our|let|me|needs|think|thinks|wants|says|is|are|was|has|have|will|would|could|can|likely|reportedly|apparently|allegedly|after|amid|as|while|reports?|sources?|says)$/i;

// red-carpet captions are no story line ("Matthew Rhys and Keri Russell (in Khaite)")
const FASHION = /\(in [A-Z][\w’'-]+\)|\b(wears?|wearing|outfit|red carpet|gown|masterfully match|couple goals|daring .* look)\b/i;

// a cut that leaves a verb without its object: "Olivia Rodrigo turns ‘Unraveled’ tour opener [into a birthday party]"
const CUT_BEFORE = /^(into|to|as|for|with|from|of|on|at|by|over|in)\b/i;
const ASKS = /^(did|does|do|is|are|was|were|can|could|will|would|should|has|have|who|what|why|how|when|where)\b/i;

// explainers and listicles are no story line ("Matthew Rhys and Keri Russell’s relationship timeline")
const EXPLAINER_TITLE = /\b(timeline|explained|everything to know|what to know|things to know|guide|ranked|best moments|in photos|photos|tickets?|setlist|presale|dates|how to|stays fit|workout|diet|net worth)\b|^(get to know|meet|who is)\b/i;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtVolume = (v) => (v >= 1e6 ? `${Math.round(v / 1e5) / 10}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v));
const uniq = (xs) => [...new Set(xs)];

/** One independent source per outlet; each Reddit post is its own poster; Bluesky, Know Your Meme and Hacker News once each. */
function sourceKey(it) {
  if (it.fam === 'reddit') return `reddit:${it.key}`;
  if (it.fam === 'bluesky' || it.fam === 'kym' || it.fam === 'hn') return it.fam;
  return `news:${outletKey(it.outlet)}`;
}

/** What an item says: its title, an outlet's summary line, a Bluesky trend's description, the opening of a KYM definition. */
const textOf = (it) => [it.title, it.dek || '', it.fam === 'bluesky' ? it.desc || '' : '', it.fam === 'kym' ? (it.kymDesc || '').slice(0, 400) : '']
  .filter(Boolean).join(' ');
const sourceLabel = (it) => (it.fam === 'reddit' ? `Reddit r/${it.sub || 'popular'}` : it.outlet || it.label || it.fam);

/** Known names in a text (title and summary line), longest match only. */
function namesIn(text, lex) {
  const ws = words(text);
  const padded = ws.join(' ');
  const ents = new Set();
  for (const w of new Set(ws)) for (const n of lex.byFirst.get(w) || []) if (contains(padded, n)) ents.add(n);
  for (const w of new Set(ws)) { const full = lex.bySurname.get(w); if (full) ents.add(full); }
  const all = [...ents];
  return all.filter((n) => !all.some((o) => o !== n && contains(o, n)));
}

function readyItem(it, lex) {
  if (!it.toks) C.annotate(it, lex);
  if (!it.allNames) {
    it.text = textOf(it);
    it.textWords = words(it.text).join(' ');
    it.textStems = new Set(words(it.text).map(stem));
    it.allNames = namesIn(it.text, lex);
    it.src = sourceKey(it);
  }
  return it;
}
const sameName = (a, b) => a === b || C.squeeze(a) === C.squeeze(b);

/** An item names E: the name itself, a spelling variant, or a longer name holding it ("ed sheeran tour"). */
const namesE = (it, E) => it.allNames.some((n) => sameName(n, E) || contains(n, E)) || contains(it.textWords, E);
const teamish = (e) => e.split(' ').some((w) => R.TEAM_WORDS.has(w));

/** A name that can anchor a story: a person, a group, a show, a bar; not a place, a team, a platform or a generic word. */
function nameLike(e) {
  return !!e && e.length >= 3 && !R.isPlaceOrTeam(e) && !teamish(e) && !W.ENTITY_STOP.has(e) && !W.GENERIC.has(e) && !W.STOP.has(e) &&
    !e.split(' ').some((w) => W.VERB_RE.test(w) || /^(gets|got|is|are|was|has|have)$/.test(w));
}

/** "elizabeth holmes documentary" is Elizabeth Holmes. */
function trimName(e, lex) {
  let ws = e.split(' ');
  while (ws.length > 2 && R.HOOK_STOP.has(ws[ws.length - 1])) ws = ws.slice(0, -1);
  const t = ws.join(' ');
  return t !== e && lex.names.has(t) ? t : ws.length === e.split(' ').length ? e : t;
}

/** A readable form of a name as the titles spell it ("Tucker Wetmore", "P.J. Fleck"): the most common matching span of tokens. */
function surfaceOf(name, items) {
  const n = name.split(' ').length;
  const counts = new Map();
  for (const it of items) {
    const toks = it.title.split(/\s+/);
    for (let i = 0; i < toks.length; i++) {
      let got = [];
      for (let j = i; j < toks.length && got.length < n; j++) {
        got = words(toks.slice(i, j + 1).join(' '));
        if (got.join(' ') !== name) continue;
        const s = toks.slice(i, j + 1).join(' ').replace(/^[^\p{L}\p{N}]+/u, '').replace(/['’]s?$/, '').replace(/[^\p{L}\p{N}.]+$/u, '');
        if (s && !(/^[\p{Lu}\s.'’&-]+$/u.test(s) && s.length > 4)) counts.set(s, (counts.get(s) || 0) + 1); // not ALL CAPS
        break;
      }
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : name.split(' ').map(capFirst).join(' ');
}
const isPlaceWord = (t) => R.PLACES.has(t) || R.PLACES.has(`${t}s`) || R.TEAM_WORDS.has(t) || R.TEAM_WORDS.has(`${t}s`);

/** Does a text carry an angle key? */
function carries(it, key) {
  if (key.startsWith('n:') || key.startsWith('p:')) return contains(it.textWords, key.slice(2));
  return it.textStems.has(key.slice(2));
}
const labelOf = (key) => key.slice(2);
const probe = (text) => ({ textWords: words(text).join(' '), textStems: new Set(words(text).map(stem)) });

/** A lower-case verb after the first word: "Holmes" and "Rhys" look like verbs to a suffix test, but they are capitalised. */
// plural nouns the verb test mistakes for "-s" verbs ("lyrics", "news")
const NOT_VERBS = new Set(['lyrics', 'news', 'series', 'species', 'looks', 'clothes', 'comics', 'politics', 'physics', 'thanks', 'odds', 'stats', 'ages', 'tracks', 'vibes', 'memes']);
const hasVerb = (text) => text.split(/\s+/).slice(1).some((w) => /^[a-z]/.test(w) && !NOT_VERBS.has(w.replace(/[^a-z]/g, '')) && (W.VERB_RE.test(w) || W.looksVerb(w.replace(/[^a-z]/g, ''))));

/** A cut that leaves a quote open: "... says ‘Choosin’ Texas’ success is ‘changing". */
function openQuoteAtEnd(text) {
  const open = Math.max(text.lastIndexOf('‘'), text.lastIndexOf('“'));
  if (open < 0) return false;
  return !/[’”](?!\p{L})/u.test(text.slice(open + 1));
}

function cutDangles(title, text) {
  const t = W.curlQuotes(title).replace(/\s+/g, ' ');
  const last = text.split(/\s+/).slice(-2).join(' ').toLowerCase();
  const at = t.toLowerCase().indexOf(last);
  return at >= 0 && CUT_BEFORE.test(t.slice(at + last.length).trim());
}
const peakDay = (items) => {
  const byDay = new Map();
  for (const it of items) { const d = ymd(it.t); byDay.set(d, (byDay.get(d) || new Set()).add(it.src)); }
  return [...byDay.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0][0];
};

/** A quoted phrase as its titles print it ("red-headed puppet"), without its quote marks. */
function quoteSurface(phrase, items) {
  for (const it of items) {
    for (const mm of W.curlQuotes(it.title).matchAll(R.QUOTE_RE)) {
      const q = (mm[1] || mm[2] || '').trim();
      if (words(q).join(' ') === phrase) return q.replace(/[.,!?]+$/, '');
    }
  }
  return null;
}

/** A lower-case phrase back in its titles' own casing ("amaal mallik credit row" -> "Amaal Mallik credit row"). */
function surfacePhrase(phrase, items) {
  return phrase.split(' ').map((w) => {
    for (const it of items) {
      const tok = it.title.split(/\s+/).find((t) => words(t)[0] === w);
      if (tok && /^\p{Lu}\p{Ll}/u.test(tok.replace(/^[^\p{L}]+/u, '')) && !W.inDict(w)) return tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/, '');
    }
    return w;
  }).join(' ');
}

module.exports = {
  SYN, stem, DAY, HOUR, CONTEXT_DROPS, splitList, ROLE_WORDS, ANGLE_STOP, FRAME_RE, STORY_HEADLINE, AFTERMATH,
  AFTERMATH_PHRASE, ORIGIN_RE, ORIGIN_VERB, CAUSE_RE, CAUSE_STORY, ARTICLE_STORY, REACTIONS, PLAIN_VERB, ORG_NAMES, DANGLING,
  FASHION, CUT_BEFORE, ASKS, EXPLAINER_TITLE, ymd, capFirst, fmtVolume, uniq, sourceKey, textOf, sourceLabel, namesIn,
  readyItem, sameName, namesE, teamish, nameLike, trimName, surfaceOf, isPlaceWord, carries, labelOf, probe, hasVerb,
  openQuoteAtEnd, cutDangles, peakDay, quoteSurface, surfacePhrase, words,
};
