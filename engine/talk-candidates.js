'use strict';
/*
 * Talking-point names [talking-points.js]: who or what is trending this week, from every source with its own seats, by prior demand.
 *   Google Trends "Trending now" over 7 days, every category (facets fold into their name; fixtures, service searches, leagues and
 *   broadcasters out); people a big trend's related queries name; Wikipedia's most read (a spike, or read on and on: 100K+ views on
 *   3 of the last 4 days); the week's top posts of r/LivestreamFail, r/youtubedrama and r/OutOfTheLoop and the day's top of the
 *   pop-culture subreddits; names eight or more outlets printed this week, in the store and in every Google News search the run made;
 *   people Wikipedia's daily top 1000 shows read 10x their week-old level. Every name with a 20K+ search of its own is evaluated.
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const TS = require('./talk-sources');
const TN = require('./talk-nouns');
const { outletKey, contains } = require('./util');

const { words } = W;
const DAY = 86400000;
const WINDOW_DAYS = 7;
const WIKI_MIN_VIEWS = 150000;
// read on and on: 100K+ views on 3 of the last 4 days (a Netflix true-crime hit: "Ted Kaczynski", "Lizzie Borden", "Digger")
const WIKI_SUSTAIN_VIEWS = 100000;
const BURST_MIN_OUTLETS = 8;
const REDDIT_TOP_RANK = 10;
const REDDIT_WEEK_RANK = 25; // a post in a talk subreddit's top 25 of the week
// where creators' own world is argued about: a streamer, a YouTuber, what people ask to have explained
const CREATOR_SUBS = new Set(['livestreamfail', 'youtubedrama', 'outoftheloop']);
// a league, a tour or a broadcaster is never the talking point's name ("mlb", "nba", "bbc iplayer")
const TREND_MIN_VOLUME = 10000;
const FRESH_TREND_HOURS = 24;
const FRESH_TREND_MIN_VOLUME = 200;
const CANDIDATE_MAX = 240; // names evaluated a run, by prior demand
// seats a source keeps among the evaluated names, whatever the Trends names' priors (the week's biggest press, Reddit and Wikipedia
// stories carry no search of their own: "Chris Hansen", "Candace Owens", "Ted Kaczynski")
const CREATOR_SEATS = 120;
const CANDIDATE_RESERVE = { drama: 80, press: 25, reddit: 30, wiki: 15, wikitop: 12, related: 10, wikiclimb: 8 };
// and among the names searched each refresh: the strongest by prior first, then these seats, then the names with demand of their own
// (a 20K+ search in any category, a page read 10x, a press story in 20+ outlets: "nolan wells", "shivon zilis", "avengers endgame"),
// then the rest
const LOOKUP_HEAD = 25;
const LOOKUP_RESERVE = { reddit: 6, wiki: 4, wikitop: 4, press: 4, related: 2 };
const LOOKUP_DEMAND_VOLUME = 20000;
const LOOKUP_DEMAND_OUTLETS = 20;
const LOOKUP_FRESH = 6;
const WIKI_MIN_SPIKE = 3;
const WIKI_HOLD_DAYS = 5; // a most-read spike stays attached this long (the week's #1 article)
const WIKI_SUSTAIN_DAYS = 3;
const WIKI_SUSTAIN_SPAN = 4;
const BURST_DAYS = 7;
const CLIP_PRIOR = 0.5;
const REDDIT_SUBS = new Set(['livestreamfail', 'youtubedrama', 'outoftheloop', 'popculturechat', 'fauxmoi', 'entertainment', 'popular', 'tiktokcringe', ...TS.CREATOR_BOARDS_SNARK]);
const SPORTS_CAT = 17;
// a search that is a game, a result or a service, never a talking point
const FIXTURE_KW = /\b(?:vs\.?|v\.?)\s|\s[-–]\s|\s(?:at|@)\s/i;
const SERVICE_KW = /\b(?:where to watch|how to watch|what time|when is|what channel|channel|tickets?|score|scores|standings|schedule|stats|lineups?|odds|predictions?|highlights|results|weather|forecast|server status|servers?|outage|codes?|login|near me|recalls?|refunds?|checks?|stimulus|deadline|hours|tonight|today|live ?stream|release date|time|cast|spoilers?|episode \d+|season \d+|game|games|draft|rankings?|playoffs?|bracket|polls?|calculator|lottery|powerball|mega millions|jackpot|numbers|prices?|rates?|update)\b/i;
const RECALL_KW = /^\S+(?: \S+)? recall$/;
const RECALL_MIN_VOLUME = 100000;
const WIKI_SKIP = /^(?:deaths in|list of|\d{4}\b|main page|special:|wikipedia|portal:|file:|xxx|cleopatra)/i;
const LEAGUE_KW = /^(?:nfl|nba|mlb|nhl|wnba|mls|ncaa|ufc|wwe|f1|formula 1|nrl|afl|epl|premier league|champions league|la liga|serie a|pga|lpga|atp|wta|nascar|bbc|bbc iplayer|bbc news|itv|itvx|channel 4|sky news|cnn|fox news|msnbc|abc|nbc|cbs|pbs|hbo|netflix|hulu|disney|disney plus|prime video|hbo max|max|peacock|paramount plus|espn|youtube|tiktok|instagram|twitter|x|facebook|meta|google|apple|amazon|microsoft|spotify|snl|saturday night live|white house|congress|senate|supreme court|fbi|doj)$/i;
const LOWER_MIN = 3;
// "My audience" (IDEAS-SPEC: US, UK, Australia, Canada or mixed; US by default): how much each country's search counts, the
// audience's own country in full and the others by how much of what it watches comes from there
const AUDIENCE_GEO_W = {
  US: { US: 1, CA: 0.8, GB: 0.6, AU: 0.6 },
  GB: { GB: 1, US: 0.7, AU: 0.6, CA: 0.5 },
  AU: { AU: 1, US: 0.7, GB: 0.7, CA: 0.5 },
  CA: { CA: 1, US: 0.9, GB: 0.6, AU: 0.5 },
  mixed: { US: 1, GB: 0.9, AU: 0.8, CA: 0.8 },
};
const OTHER_GEO_W = 0.5;
const audienceOf = (a) => (Object.prototype.hasOwnProperty.call(AUDIENCE_GEO_W, a) ? a : 'US');
const geoWeight = (geo, audience) => AUDIENCE_GEO_W[audienceOf(audience)][geo] ?? OTHER_GEO_W;
/** The audience's own countries: its one, or all four for a mixed audience. */
const homeGeos = (audience) => (audienceOf(audience) === 'mixed' ? ['US', 'GB', 'AU', 'CA'] : [audienceOf(audience)]);
/** The trends weighed for an audience: each row's geoW its country's weight for it. */
const forAudience = (trends, audience) => (trends || []).map((t) => ({ ...t, geoW: geoWeight(t.geo, audience) }));

// ---------- 1 names ----------
// (each distinct string's key once a process: the collector builds every 15 minutes)
const KEYS = new Map();
const keyOf = (s) => {
  const text = s || '';
  const hit = KEYS.get(text);
  if (hit !== undefined) return hit;
  const out = words(text).join(' ');
  if (KEYS.size >= 500000) KEYS.clear();
  KEYS.set(text, out);
  return out;
};
const hay = (title) => ` ${keyOf(title)} `;
const mentions = (h, key) => h.includes(` ${key} `);
/** A one-word key a dictionary spells or a given name ("sketch", "destiny", "ninja"): the strict rule below holds for it. */
const isStrictKey = (key) => !key.includes(' ') && (W.inDict(key) || W.isFirstName(key) || key.length < 3);
const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, (m) => `\\${m}`);
/**
 * Whether a headline names a key, as lib/native-signals.js namedIn reads a post: a name of two words or more, or a handle no dictionary
 * spells, wherever it stands; a strict one-word name (a dictionary word, a given name) only printed with its capital, and only where
 * the text says streamer, YouTuber, Twitch, Kick ... or, in a text about creators (`creatorText`: a creators' board, a clip, the
 * creators' beat), opens with it. A small dictionary word mid-headline is the word, never the name: "Shane Gillis drops F-bomb during
 * SNL sketch" names no streamer called Sketch, "Destiny 2 players ..." no streamer called Destiny. Collector only, 2026-10-19: a
 * streamer's row was filled with a comedian's story, and a meme's with tax news.
 */
function namesKey(title, key, { creatorText = false } = {}) {
  if (!key || !mentions(hay(title), key)) return false;
  if (!isStrictKey(key)) return true;
  const text = String(title || '');
  const cap = key.charAt(0).toUpperCase() + key.slice(1);
  const printed = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(cap)}(?:['’]s)?(?![\\p{L}\\p{N}])`, 'u');
  if (!printed.test(text)) return false;
  return CREATOR_ROLE.test(text) || (creatorText && words(text)[0] === key);
}

/**
 * A trend keyword's name: a facet search folds into its name ("aaron rodgers wife" -> "aaron rodgers"), and a long keyword keeps the
 * leading part that is itself trending, a related query or a known name ("sass jordan passing age 63" -> "sass jordan"); a two-word
 * name stays whole ("christa pike", never "christa").
 */
const ORG_TAIL = new Set(['doj', 'fbi', 'sec', 'dhs', 'irs', 'ice', 'nypd', 'lapd', 'police', 'federal', 'feds']);
const NOUN_TAIL = new Set(['charges', 'charged', 'arrest', 'arrested', 'lawsuit', 'allegations', 'trial', 'indictment', 'sentencing', 'verdict']);
const TAIL = new Set(['case', 'situation', 'saga', 'update', 'updates', 'news', 'latest', 'story', 'drama']);
function baseOf(kw, known, lex, own = new Set()) {
  const ws = kw.split(' ');
  if (ws.length >= 2 && TAIL.has(ws[ws.length - 1])) return { base: ws.slice(0, -1).join(' '), rest: ws[ws.length - 1] };
  // (a double-barrelled name its own related queries hyphenate is whole: "robert kelker kelly" of "robert kelker-kelly", never
  // "robert kelker")
  if (own.has(kw) && ws.length <= 4) return { base: kw, rest: '' };
  for (let n = ws.length - 1; n >= 1; n--) {
    const p = ws.slice(0, n).join(' ');
    const rest = ws.slice(n);
    const facet = rest.every((w) => TN.FACETS.has(w) || /^\d+$/.test(w));
    if (!facet && ws.length < 3) continue;
    if (n === 1 && W.inDict(p)) continue;
    if (known.has(p) || (n >= 2 && lex && lex.names && lex.names.has(p))) return { base: p, rest: rest.join(' ') };
  }
  // a keyword that already says its noun ("greg lui doj charges"): the words before it, the noun as its rest
  if (ws.length >= 3 && NOUN_TAIL.has(ws[ws.length - 1]) && !W.STOP.has(ws[0])) {
    // (and the agency that brought them: "greg lui doj charges" -> "greg lui")
    const head = ws.slice(0, -1);
    while (head.length > 2 && ORG_TAIL.has(head[head.length - 1])) head.pop();
    return { base: head.join(' '), rest: ws[ws.length - 1] };
  }
  return { base: kw, rest: '' };
}

/** A keyword of plain dictionary words ("plague", "lawsuit", "fat"): a name only through a related query that says more ("russia plague outbreak"). */
const genericKey = (k) => (k.includes(' ') ? k.split(' ').every((w) => W.inDict(w) && !W.isFirstName(w)) : W.inDict(k));

// how much a Trends category is talking-point material: pop culture and court/crime and "other" news lead; politics, health,
// business, shopping, weather and sport (results) trail (a sports name still lists for drama, see lists())
const CAT_W = { 2: 1, 4: 1, 6: 1, 8: 0.9, 10: 0.9, 11: 0.8, 13: 0.6, 19: 0.6, 7: 0.6, 14: 0.5, 15: 0.45, 18: 0.45, 3: 0.35, 16: 0.35, 20: 0.35, 5: 0.35,
  1: 0.35, 9: 0.35, 17: 0.3 };
const catWeight = (cats) => (cats.length ? cats.reduce((s, x) => s + (CAT_W[x] ?? 0.6), 0) / cats.length : 0.6);
/**
 * A trend name's prior demand, which decides who gets a name search: its search, times its category's weight, plus a related query that
 * already says the noun ("rick ross arrest", "lucki stabbed"), a second person in its related queries (a dispute: "reggie", "rakai"),
 * and a search lasting a day or more; a plain word ("snow") counts for little unless a related query names its story.
 */
const CREATOR_REL = /\b(?:twitch|stream|streamer|streaming|youtube|youtuber|tiktok|tiktoker|kick|podcast|rapper|ig live|instagram live)\b/;
function priorOf(c, now) {
  const talk = [...c.related, ...c.rests].some((q) => TN.familiesIn(q).some((x) => x.f.key !== 'response' && x.f.key !== 'injury'));
  const others = c.related.filter((q) => !contains(q, c.key) && !contains(c.key, q) && (W.isFirstName(q.split(' ')[0]) || TN.personLike(q, null)) && q.split(' ').length <= 3);
  const day = c.trends.some((t) => (t.end ?? now) - t.start >= DAY);
  // creators' own world: a streamer, a YouTuber, a rapper (people search the name with its platform: "kai cenat twitch")
  const creator = c.related.some((q) => CREATOR_REL.test(q));
  const cats = c.trends.map((t) => t.cats || []).sort((a, b) => b.length - a.length)[0] || [];
  // (a sports name with a second person or a noun in its searches is drama, "aaron rodgers and mike mccarthy", not a result)
  const pair = c.related.some((q) => contains(q, c.key) && others.some((o) => contains(q, o)));
  const sportsDrama = cats.length > 0 && cats.every((x) => x === SPORTS_CAT) && TN.personLike(c.key, null) && (talk || pair);
  const w = sportsDrama ? SPORTS_DRAMA_W : catWeight(cats);
  return (searchScore(c.trends) + (talk ? 0.6 : 0) + (others.length ? 0.3 : 0) + (day ? 0.2 : 0) + (creator ? 0.4 : 0)) * w * (c.generic && !talk ? 0.4 : 1);
}
const SPORTS_DRAMA_W = 0.8;

const searchScore = (trends) => {
  if (!trends.length) return 0;
  const best = Math.max(...trends.map((t) => t.geoW * Math.max(0, Math.log10(Math.max(1, t.volume)) - 3)));
  const geos = new Set(trends.filter((t) => t.volume >= 5000).map((t) => t.geo)).size;
  const growth = Math.max(...trends.map((t) => t.growth || 0));
  return best + 0.25 * Math.max(0, geos - 1) + (growth >= 500 ? 0.2 : 0);
};

function trendCandidates(trends, now, lex) {
  const live = trends.filter((t) => t.start <= now + DAY && (t.end ?? now) >= now - WINDOW_DAYS * DAY);
  const known = new Set();
  for (const t of live) { known.add(keyOf(t.keyword)); for (const q of t.related) known.add(keyOf(q)); }
  const byBase = new Map();
  for (const t of live) {
    const kw = keyOf(t.keyword);
    // (a brand's recall searched 100K+ is a story, not a service search: "gatorade recall"; "product recall" is nobody's)
    const recall = RECALL_KW.test(kw) && t.volume >= RECALL_MIN_VOLUME && !W.inDict(kw.split(' ')[0]);
    if (!kw || FIXTURE_KW.test(` ${t.keyword} `) || (SERVICE_KW.test(t.keyword) && !recall) || TN.QUESTION.test(t.keyword) || LEAGUE_KW.test(kw)) continue;
    // (its related queries that hyphenate a name: "robert kelker-kelly")
    const { base, rest } = baseOf(kw, known, lex, new Set(t.related.filter((q) => /\p{L}-\p{L}/u.test(q)).map(keyOf)));
    if (LEAGUE_KW.test(base)) continue;
    const restWs = rest.split(' ').filter(Boolean);
    // a facet search ("aaron rodgers wife") is the name's, not a story; a long rest ("passing age 63") still tells the noun
    const c = byBase.get(base) || { key: base, from: 'trends', trends: [], related: [], rests: [], cats: new Set(), wiki: [], reddit: [] };
    c.trends.push(t);
    c.related.push(...t.related.map(keyOf).filter((q) => q && q !== base));
    if (restWs.length && !restWs.every((w) => TN.FACETS.has(w) || /^\d+$/.test(w))) c.rests.push(rest);
    (t.cats || []).forEach((x) => c.cats.add(x));
    byBase.set(base, c);
  }
  // (a person trending for the first time in the last day is in at any volume: a story breaking today, "andrew mountbatten-windsor"
  // at 500+ the morning his legal challenge broke, gets its name search in the same refresh)
  const fresh = (c) => c.trends.some((t) => t.end === null && now - t.start < FRESH_TREND_HOURS * 3600000 && t.volume >= FRESH_TREND_MIN_VOLUME) &&
    TN.personLike(c.key, lex) && !c.trends.every((t) => (t.cats || []).length && (t.cats || []).every((x) => x === SPORTS_CAT));
  return [...byBase.values()].filter((c) => Math.max(...c.trends.map((t) => t.volume)) >= TREND_MIN_VOLUME || fresh(c)).map((c) => ({
    ...c, related: [...new Set(c.related)], generic: genericKey(c.key), fresh: fresh(c),
    sports: [...c.cats].length > 0 && ([...c.cats].every((x) => x === SPORTS_CAT) || c.trends.every((t) => (t.cats || [])[0] === SPORTS_CAT)),
  })).map((c) => ({ ...c, prior: priorOf(c, now) }));
}

/**
 * A name's Wikipedia most-read rows of the last few days, by key: { rows, days: Map(utc day -> views), sustained, daily } (daily: the
 * median of its last days' views). Spikes count for WIKI_HOLD_DAYS; "sustained" is 100K+ views on 3 of the last 4 days.
 */
function wikiByKey(wiki, now) {
  const by = new Map();
  const page = (w) => w.key && !WIKI_SKIP.test(w.name) && !/disambiguation|calendar year|wikimedia/i.test(w.desc || '');
  const dayOf = (w) => Math.floor(w.t / DAY) * DAY;
  let newest = -Infinity;
  for (const w of wiki) {
    if (!page(w) || now - w.t > WIKI_HOLD_DAYS * DAY) continue;
    const e = by.get(w.key) || { rows: [], days: new Map() };
    e.rows.push(w);
    by.set(w.key, e);
    newest = Math.max(newest, dayOf(w));
  }
  // (the last days with a most-read list, not the calendar's: a day's list comes out the next day, so a refresh just past midnight
  // UTC never reads the day nobody has counted yet as a day nobody read, nor drops the window's first day: "Digger (2026 film)" read
  // on and on all weekend)
  const from = (Number.isFinite(newest) ? newest + DAY : Math.floor(now / DAY) * DAY) - WIKI_SUSTAIN_SPAN * DAY;
  for (const w of wiki) {
    const e = page(w) && by.get(w.key);
    if (!e || dayOf(w) < from) continue;
    e.days.set(dayOf(w), Math.max(e.days.get(dayOf(w)) || 0, w.views));
  }
  for (const e of by.values()) {
    const recent = [...e.days.entries()].filter(([d]) => d >= from).map(([, v]) => v).sort((a, b) => a - b);
    e.sustained = recent.filter((v) => v >= WIKI_SUSTAIN_VIEWS).length >= WIKI_SUSTAIN_DAYS;
    e.daily = recent.length ? recent[Math.floor(recent.length / 2)] : 0;
    e.spike = e.rows.some((w) => w.views >= WIKI_MIN_VIEWS && w.spike >= WIKI_MIN_SPIKE);
  }
  return by;
}

/**
 * People Wikipedia's daily top 1000 shows read 10x their week-old level (talk-sources.js wikiTopSpikes), below the most-read feed's
 * cut: "Shivon Zilis" 1K -> 50K a day, "Michael McDonald (musician)" 2K -> 68K. A person's page only (two or three capitalised words,
 * a given name or no dictionary word at either end: never "Halifax Explosion", "Doctors' plot"); the strongest day per name.
 */
function wikiTopCandidates(rows, lex) {
  const by = new Map();
  for (const w of rows || []) {
    const bare = String(w.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const key = keyOf(bare);
    const ws = key.split(' ');
    if (ws.length < 2 || ws.length > 3 || !bare.split(/\s+/).every((x) => /^\p{Lu}/u.test(x)) || /\d/.test(key) || R.isPlaceOrTeam(key)) continue;
    const plain = (x) => W.inDict(x) && !W.isFirstName(x);
    if (!TN.personLike(key, lex) && (plain(ws[0]) || plain(ws[ws.length - 1]))) continue;
    const old = by.get(key);
    if (!old || old.views < w.views) by.set(key, { ...w, key });
  }
  return [...by.values()].map((w) => ({ key: w.key, from: 'wikitop', trends: [], related: [], rests: [], cats: new Set(), wiki: [w], reddit: [],
    sports: false, wikiTop: w.spike, prior: Math.min(2.5, Math.log10(w.views / 10000)) + WIKI_TOP_PRIOR }));
}
const WIKI_TOP_PRIOR = 0.5;

/**
 * Pages climbing Wikipedia's daily top 1000 that are no person (talk-sources.js wikiTopSpikes' climbers): a film, a show, an outbreak
 * people look up when the news breaks, searched or not ("Avengers: Endgame" 30K -> 54K the day it passed "Avatar" again). One to four
 * words, no place, team or year; the strongest day per page; at most WIKI_CLIMB_MAX, the most read first.
 */
function wikiClimbCandidates(rows, lex) {
  const by = new Map();
  for (const w of rows || []) {
    if (!w.climb) continue;
    const bare = String(w.name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const key = keyOf(bare);
    const ws = key.split(' ');
    if (!key || ws.length > 4 || WIKI_SKIP.test(bare) || CLIMB_SKIP.test(key) || /^\d+$/.test(ws[0]) || R.isPlaceOrTeam(key) || TN.personLike(key, lex) ||
      LEAGUE_KW.test(key)) continue;
    const old = by.get(key);
    if (!old || old.views < w.views) by.set(key, { ...w, key });
  }
  // (the most read for how far it climbed: 54K at 1.8x over 65K at 1.1x)
  const strength = (w) => w.views * Math.log2(w.climb);
  return [...by.values()].sort((a, b) => strength(b) - strength(a) || a.key.localeCompare(b.key)).slice(0, WIKI_CLIMB_MAX)
    .map((w) => ({ key: w.key, from: 'wikiclimb', trends: [], related: [], rests: [], cats: new Set(), wiki: [w], reddit: [], sports: false,
      wikiClimb: w.climb, prior: Math.min(2.5, Math.log10(w.views / 10000)) + WIKI_CLIMB_PRIOR }));
}
const WIKI_CLIMB_MAX = 8;
// (a country's part in a games, a medal table: a results page)
const CLIMB_SKIP = /\bat the\b|\bmedal table\b|\bresults?\b|\bseason\b|\bchampionship\b/;
const WIKI_CLIMB_PRIOR = 0.3;

/** Wikipedia's most-read names: a spike (150K+ views at 3x the usual) in the last five days, or read on and on (sustained). */
function wikiCandidates(wiki, now) {
  const out = [];
  for (const [key, e] of wikiByKey(wiki, now)) {
    if (!e.spike && !e.sustained) continue;
    const best = e.rows.reduce((a, b) => (b.views > a.views ? b : a));
    out.push({ key, from: 'wiki', trends: [], related: [], rests: [], cats: new Set(), wiki: [best], reddit: [], sustained: e.sustained,
      wikiDaily: e.daily, sports: R.ATHLETE.test(best.desc || ''), prior: Math.min(2.5, Math.log10(Math.max(best.views, e.daily) / 10000)) });
  }
  return out;
}

/** The name a post or headline leads with: a capitalised run of two or three words, or one word no dictionary spells ("Pokimane"). */
function leadName(title, lex, known) {
  const runs = TN.nameRuns(title).map((n) => ({ n, at: hay(title).indexOf(` ${n} `) })).filter((x) => x.at >= 0);
  const singles = String(title || '').split(/\s+/).map((tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, ''))
    .filter((core) => core.length > 3 && (/\p{Ll}\p{Lu}/u.test(core) || (/^\p{Lu}/u.test(core) && !W.inDict(core.toLowerCase()) && !W.isFirstName(core.toLowerCase()))) &&
      !R.PLACES.has(core.toLowerCase()) && !(lex && lex.low && lex.low.get(core.toLowerCase()) > 5))
    .map((core) => ({ n: keyOf(core), at: hay(title).indexOf(` ${keyOf(core)} `) })).filter((x) => x.n && x.at >= 0);
  const all = [...runs, ...singles].sort((a, b) => a.at - b.at || b.n.length - a.n.length);
  if (!all.length) return null;
  const n = all[0].n;
  // (a possessive misspelt onto the name: "Candace Owen’s being gay" is Candace Owens, whom the corpus prints)
  return known && !known(n) && known(`${n}s`) ? `${n}s` : n;
}

/**
 * The week's top posts where people argue about creators and ask what is going on (r/LivestreamFail, r/youtubedrama,
 * r/OutOfTheLoop: a top-25 post of the week counts like a 100K search), and the top of the day of the pop-culture subreddits.
 */
function redditCandidates(items, now, lex, known) {
  const byName = new Map();
  const seen = new Set();
  for (const i of items) {
    if (i.fam !== 'reddit' || !REDDIT_SUBS.has(i.sub) || now - i.t > WINDOW_DAYS * DAY) continue;
    const week = Number.isFinite(i.rankWeek) && i.rankWeek < REDDIT_WEEK_RANK;
    if (!week && !(i.rankDay < REDDIT_TOP_RANK)) continue;
    const k = `${i.url}|${week ? 'w' : 'd'}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const n = leadName(i.title, lex, known);
    if (!n || R.isPlaceOrTeam(n) || LEAGUE_KW.test(n)) continue;
    const c = byName.get(n) || { key: n, from: 'reddit', trends: [], related: [], rests: [], cats: new Set(), wiki: [], reddit: [], sports: false, prior: 0 };
    c.reddit.push(i);
    // (r/LivestreamFail's top posts are mostly clips, "Emiru does a cosplay": its drama, an allegation or a ban, is the talking point)
    const clip = i.sub === 'livestreamfail' && !TN.familiesIn(i.title).some((x) => x.f.key !== 'response');
    c.prior = Math.min(3, c.prior + (week ? (i.rankWeek < 3 ? 2.0 : i.rankWeek < 10 ? 1.5 : 1.0) : i.rankDay < 3 ? 1.0 : 0.6) * (clip ? CLIP_PRIOR : 1));
    byName.set(n, c);
  }
  return [...byName.values()];
}

/**
 * Names many outlets printed this week (the press-only story no search list carries: "Madonna" at the VMAs): in the store's rows
 * and in the Google News searches already made (the talking points' own and the moments' story searches), each title once.
 */
function burstCandidates(items, now, lookups, lex) {
  const outlets = new Map();
  const recent = new Map(); // the outlets of the last two days: a story just breaking ("Avengers: Endgame" passing "Avatar")
  const seen = new Set();
  const count = (title, outlet, t) => {
    const k = keyOf(title);
    if (!k || seen.has(k) || now - t > BURST_DAYS * DAY || t > now + DAY) return;
    seen.add(k);
    // (a Title Case headline capitalises every word, so its names are the lexicon's: "Primetime Turns Chris Hansen Into a Horror Show")
    const runs = W.isTitleCase(title.split(/\s+/)) ? knownNamesIn(k, lex) : TN.nameRuns(title);
    // (a former title is no part of the name: "Ex-Prince Andrew" is "prince andrew")
    for (const n of new Set(runs.map((r) => r.replace(/^(?:ex|former) /, '')))) {
      if (R.isPlaceOrTeam(n) || !n.includes(' ')) continue;
      const s = outlets.get(n) || new Set();
      s.add(outletKey(outlet));
      outlets.set(n, s);
      if (now - t < BURST_RECENT_DAYS * DAY) recent.set(n, (recent.get(n) || new Set()).add(outletKey(outlet)));
    }
  };
  for (const i of items) if (i.fam !== 'reddit' && i.fam !== 'bluesky') count(i.title, i.outlet, i.t);
  for (const r of lookupRows(lookups)) count(TN.cleanHeadline(r.title, r.publisher), r.publisher || 'Google News', r.t);
  // (never an outlet's own name, "york times" of The New York Times, nor a plain phrase, "box office", "this morning")
  const outletNames = new Set([...items.map((i) => i.outlet), ...lookupRows(lookups).map((r) => r.publisher)].filter(Boolean).map((o) => keyOf(o)));
  const outletLike = (n) => [...outletNames].some((o) => contains(o, n));
  // (and no phrase the titles print lowercase: "box office")
  const phrase = (n) => n.split(' ').every((w) => W.inDict(w) || (lex && lex.low && lex.low.get(w) >= LOWER_MIN));
  return [...outlets.entries()].filter(([n, s]) => s.size >= BURST_MIN_OUTLETS && !outletLike(n) && !((genericKey(n) || phrase(n)) && !TN.personLike(n, null)))
    .map(([n, s]) => ({ key: n, from: 'press', trends: [], related: [],
    rests: [], cats: new Set(), wiki: [], reddit: [], sports: false, outlets: s.size, recentOutlets: (recent.get(n) || new Set()).size, prior: 0.5 * Math.log2(s.size) }));
}
const BURST_RECENT_DAYS = 2;
/** The lexicon's names of two or three words in a lowercase word string ("chris hansen"). */
function knownNamesIn(k, lex) {
  if (!lex || !lex.byFirst) return [];
  const ws = k.split(' ');
  const out = [];
  ws.forEach((w, i) => {
    for (const n of lex.byFirst.get(w) || []) {
      const nw = n.split(' ');
      if (nw.length >= 2 && nw.length <= 3 && lex.names.has(n) && ws.slice(i, i + nw.length).join(' ') === n) out.push(n);
    }
  });
  return out;
}

// ---------- people-drama names ----------
// what the list leads with (IDEAS-SPEC "Top 20"): a person and a noun people argue about. Their names come from where such stories
// break, before any search list carries them: the celebrity and creator feeds (TMZ, Dexerto, E! News ...), the people-drama searches
// (talk-sources.js TALK_DRAMA), the entertainment sections, and the week's top of r/LivestreamFail and r/youtubedrama
const DRAMA_DAYS = 4;
const DRAMA_REDDIT_RANK = 100;
const DRAMA_MIN_OUTLETS = 2;
const DRAMA_PRIOR = 1;
const DRAMA_CREATOR_PRIOR = 0.5;
const DRAMA_TODAY_PRIOR = 0.3;
const DRAMA_BEAT_PRIOR = 0.4;
const DRAMA_PRIOR_MAX = 3;
// a role word a headline gives a creator ("Kick streamer JohnWhatsGoingOn", "TikToker Dakota Harper", "influencer Jack Doherty")
const CREATOR_ROLE = /\b(?:streamers?|youtubers?|tiktokers?|influencers?|content creators?|vloggers?|podcasters?|twitch|kick|onlyfans|tiktok stars?|youtube stars?)\b/i;
const CAP_WORD = /^\p{Lu}[\p{L}\p{N}’'.-]*$/u;
const PLACE_PREP = new Set(['in', 'at', 'from', 'near', 'to', 'of', 'outside', 'across', 'around']);
const PLACE_TAIL = new Set(['beach', 'city', 'state', 'county', 'island', 'islands', 'park', 'street', 'university', 'college', 'school', 'hospital', 'airport', 'bridge', 'mall',
  'lake', 'river', 'valley', 'hills', 'springs', 'station', 'based']);
// outlets whose beat is creators (a static list, like the entertainment press's): their headline counts for a name whatever else the
// moments block them for
const CREATOR_PRESS = /^(?:sportskeeda|soap central|primetimer(?:\.com)?|dexerto|hitc(?:\.com)?|the tab|daily dot|distractify|dot esports|win\.gg|tubefilter|spilled\.gg|dexerto\.com)$/i;
// (where someone is from is no handle: "slapped by Vietnamese ...")
const DEMONYM = /^(?:american|british|english|canadian|australian|indian|chinese|japanese|korean|vietnamese|german|french|italian|spanish|mexican|russian|irish|scottish|welsh|egyptian|thai|filipino|brazilian|nigerian|pakistani|israeli|palestinian|ukrainian|european|african|asian|dutch|swedish|turkish|iranian|saudi)s?$/;

// what a person does in a headline, right after the name ("Nadeshot calls ...", "BenDaDonnn Booked for ...", "Lizzo Says ...")
const PERSON_VERB = /^(?:says?|said|calls?|called|responds?|responded|reacts?|apologi[sz]es|apologi[sz]ed|arrested|booked|charged|accused|accuses|denies|denied|slams|slammed|claims?|claimed|announces|sues|sued|faces|reveals|admits|threatens|quits|banned|released|suffers|speaks|breaks|addresses|fires|hits|gets|got|goes|went|wants|shows|tells|told|posts|posted|shares|ends|leaves|left|loses|lost|is|was|has|had|pays?|paid|hacked|pelted|slapped|attacked|exposed|exposes|leaks|leaked|confirms|confirmed|opens|returns|defends)$/i;

/**
 * A handle no dictionary spells, as a headline's subject: one capitalised or camel-case word of four letters or more, no given name,
 * place or lowercase corpus word, standing right after a role word ("German streamer Benjamool pelted ...", "Rapper Lucki Suffers ..."),
 * or opening the headline before what a person does ("Nadeshot calls ...", "BenDaDonnn Booked ..."), or capitalised mid-sentence in a
 * sentence-case headline about a creator ("What did Asmongold say ...? Streamer responds ..."); never a brand or a place a headline
 * merely opens with ("Cornell Frat ...", "Nutrafol's New ...").
 */
function handlesIn(title, lex, titleCase = false, beat = false) {
  const toks = String(title || '').split(/\s+/).filter(Boolean);
  const core = (tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  // (a row of the creators' beat is about a creator whatever its words)
  const aboutCreator = beat || CREATOR_ROLE.test(title);
  const asks = ASKS.test(title);
  const out = [];
  toks.forEach((tok, i) => {
    const c = core(tok).replace(/[’']s$/, '');
    const low = c.toLowerCase();
    // (a contraction is no handle, "He'd"; a name spelt with an apostrophe is: "Da'Vinchi")
    // (nor a brand or an agency in capitals: "ASOS hacked ...", "NASA says ...")
    const before = i > 0 ? core(toks[i - 1]).toLowerCase() : '';
    const after = i + 1 < toks.length ? core(toks[i + 1]) : '';
    // Collector only (coverage, 2026-10-11): a handle a dictionary happens to spell is still a handle where a sentence-case headline
    // gives it a capital right after a creator's role word and before what a person does ("influencer Clavicular charged with
    // rape", "streamer Destiny says ..."): a headline in sentence case capitalises nothing else there
    const roleNamed = !titleCase && i > 0 && /^\p{Lu}\p{Ll}{3,}$/u.test(c) && CREATOR_ROLE.test(before) && PERSON_VERB.test(after) && !W.isFirstName(low);
    if (c.length <= 3 || (c.length <= BRAND_CAPS && c === c.toUpperCase()) || /[’'](?:d|ll|re|ve|t|m)$/i.test(c) || !(/\p{Ll}\p{Lu}/u.test(c) || (/^\p{Lu}/u.test(c) && (!W.inDict(low) || roleNamed) && !W.isFirstName(low))) || R.PLACES.has(low) ||
      TN.ROLE.has(low) || CREATOR_ROLE.test(low) || DEMONYM.test(low) || (lex && lex.low && lex.low.get(low) > 5 && !roleNamed)) return;
    const afterRole = !!before && (TN.ROLE.has(before) || CREATOR_ROLE.test(before));
    // (a headline opens again after a quote and its colon: "'Incredibly stupid': Da'Vinchi faces backlash ...")
    const opens = (i === 0 || /:$/.test(toks[i - 1])) && !/[’']s[^\p{L}]*$/u.test(tok) && PERSON_VERB.test(after);
    // (a sentence-case headline capitalises only names past its first word: one that does something, owns something or is asked
    // about, never where something happened, "arrested in Miramar")
    // (and the one a question headline asks about: "Why was BenDaDonnn reportedly arrested?", "What did Asmongold say ...?")
    const midSentence = !titleCase && aboutCreator && i > 0 && !/[.!?:]['’"”]?$/.test(toks[i - 1]) && !PLACE_PREP.has(before) &&
      (PERSON_VERB.test(after) || /[’']s[^\p{L}]*$/u.test(tok) || (before === 'is' && /\?$/.test(tok)) || (asks && i <= ASK_AT && ASK_AUX.has(before)));
    if (afterRole || opens || midSentence) out.push(keyOf(c));
  });
  return out.filter(Boolean);
}

const BRAND_CAPS = 5;
const ASKS = /^(?:who|what|why|how|where|when)\b/i;
const ASK_AUX = new Set(['is', 'was', 'did', 'does', 'has', 'are', 'were']);
const ASK_AT = 3;

/**
 * The roster's creators a headline names (talk-sources.js rosterNames: Wikipedia's categories), by their whole name of one to three
 * words: "Hasan Piker", "xQc", "Ms. Rachel"; never a one-word name a dictionary spells or a given name ("Destiny", "Ninja", "Shroud":
 * "Destiny 2 players ..." is the game).
 */
function rosterIn(title, roster) {
  if (!roster || !roster.size) return [];
  const ws = words(title);
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    for (let n = Math.min(ROSTER_NAME_WORDS, ws.length - i); n >= 1; n--) {
      const k = ws.slice(i, i + n).join(' ');
      if (!roster.has(k)) continue;
      if (n === 1 && (k.length < ROSTER_HANDLE_MIN || W.inDict(k) || W.isFirstName(k) || R.PLACES.has(k))) continue;
      out.push(k);
      i += n - 1;
      break;
    }
  }
  return out;
}
const ROSTER_NAME_WORDS = 3;
const CHANNEL_WORDS = 3;
const ROSTER_HANDLE_MIN = 3;

/** Two spellings of one handle: seven letters or more, one letter added, dropped or changed ("BennDaDonnn", "BendDaDonnn" for "BenDaDonnn"). */
function sameHandle(a, b) {
  if (a === b || a.includes(' ') || b.includes(' ') || Math.min(a.length, b.length) < SAME_HANDLE_MIN || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j <= 1;
}
const SAME_HANDLE_MIN = 7;

/**
 * Names in a Title Case headline, where every word is capitalised: the lexicon's, and a pair opening with a given name or a word no
 * dictionary spells, followed by a word no dictionary spells that is nothing a person does ("Mikayla Nogueira Says ...", never
 * "BenDaDonnn Booked", "Cenat Paid"); pairs never overlap.
 */
function titleCaseNames(title, lex) {
  const toks = String(title || '').split(/\s+/).map((tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  const out = knownNamesIn(keyOf(title), lex);
  for (let i = 0; i + 1 < toks.length; i++) {
    const [a, b] = [toks[i], toks[i + 1].replace(/[’']s$/, '')];
    if (!CAP_WORD.test(a) || !CAP_WORD.test(b) || /[’']s$/.test(a)) continue;
    const [x, y] = [keyOf(a), keyOf(b)];
    if (!x || !y || x.includes(' ') || y.includes(' ') || TN.ROLE.has(x) || R.PLACES.has(x) || PERSON_VERB.test(y) || LEAGUE_KW.test(y)) continue;
    // (or a title and a name: "Lady Gaga Apologizes ...")
    if ((W.isFirstName(x) || !W.inDict(x) || HONORIFIC.has(x)) && !W.inDict(y)) { out.push(`${x} ${y}`); i += 1; }
  }
  return out;
}

/**
 * A person's name among a headline's capitalised runs, or null: it opens with a given name, or the corpus prints its first word as
 * one before a surname no dictionary spells, or no dictionary spells any of it; a role word before it is off ("Streamer BenDaDonnn"),
 * and a place or a two-letter word after it ("Joe Rogan US"). Never a place, a team, initials or an institution ("Arizona State",
 * "Laguna Beach", "TMZ NYP").
 */
/**
 * A given name that is also a city's is still a person's where the corpus prints the two words as one name and the second is nobody's
 * place and no dictionary's word: "Sydney Sweeney", "Brooklyn Beckham", never "Sydney Harbour" or "Austin Texas" (nor, by the name
 * alone, a surname a dictionary spells: "Austin Butler" still needs a headline that gives him a role).
 * Collector only, 2026-10-12: three outlets' backlash headlines led with such a name and made no candidate, and no person.
 */
function placeGiven(name, lex) {
  const ws = String(name || '').split(' ');
  if (ws.length !== 2) return false;
  const [first, last] = ws;
  return R.PLACES.has(first) && !R.PLACES.has(last) && !W.inDict(last) && !PLACE_TAIL.has(last) && !PERSON_VERB.test(last) && !!lex && !!lex.names && lex.names.has(name);
}
function personName(run, lex) {
  const ws = run.split(' ');
  while (ws.length > 1 && (TN.ROLE.has(ws[0]) || CREATOR_ROLE.test(ws[0]))) ws.shift();
  while (ws.length > 2 && (R.PLACES.has(ws[ws.length - 1]) || ws[ws.length - 1].length <= 2 || PERSON_VERB.test(ws[ws.length - 1]))) ws.pop();
  const n = ws.join(' ');
  const last = ws[ws.length - 1];
  const cityGiven = placeGiven(n, lex);
  if (ws.length < 2 || ws.length > 3 || R.isPlaceOrTeam(n) || ws.every((w) => w.length <= 3) || ws.some((w) => w.length < 2 || (R.PLACES.has(w) && !W.isFirstName(w) && !cityGiven)) ||
    ws[0].length <= 2 || PLACE_TAIL.has(last) || PERSON_VERB.test(last)) return null;
  // (the corpus's own names count when they open with a word no dictionary spells: "Dakota Harper")
  const given = W.isFirstName(ws[0]) || (HONORIFIC.has(ws[0]) && !W.inDict(last)) || (!!lex && !W.inDict(ws[0]) &&
    ((!!lex.firstNames && lex.firstNames.has(ws[0]) && !W.inDict(last)) || (!!lex.names && lex.names.has(n))));
  return given || ws.every((w) => !W.inDict(w)) ? n : null;
}

/**
 * The people a drama headline names, in the order it names them (the first is who it leads with): names of two or three words, and
 * handles (handlesIn); a name inside a longer one is the longer one's.
 */
function dramaNames(title, lex, { roster = null, beat = false } = {}) {
  const h = hay(title);
  const titleCase = W.isTitleCase(String(title || '').split(/\s+/));
  // (a headline half in Title Case runs its names together, "Olivia O'Brian Calls Out Pete Davidson in ...": both readings, a person's kept)
  const runs = [...TN.nameRuns(title), ...titleCaseNames(title, lex)].map((r) => personName(r, lex)).filter(Boolean);
  // (and the roster's creators it names, a one-word handle too: "xQc on Hasan ...", "Asmongold Says ...")
  const listed = rosterIn(title, roster);
  // (a channel's name of three words is whole in a sentence-case headline: "Mighty Mike Plays dad ..." is no "Mike Plays")
  const whole = titleCase ? [] : TN.nameRuns(title).filter((r) => r.split(' ').length === CHANNEL_WORDS && runs.some((p) => r.endsWith(` ${p}`)));
  const all = [...new Set([...runs, ...whole, ...handlesIn(title, lex, titleCase, beat), ...listed])].map((n) => ({ n, at: h.indexOf(` ${n} `) })).filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || b.n.length - a.n.length);
  return all.filter((x, i) => !all.some((y, j) => j !== i && y.n !== x.n && contains(y.n, x.n))).map((x) => x.n);
}
/**
 * Whether a headline calls a name a creator: a creator's role word in the three words before the name ("Kick streamer
 * JohnWhatsGoingOn", "Influencer Mikayla Nogueira"); never a role word that is someone else's or the story's ("Lady Gaga apologizes
 * to beauty influencer Golloria", "Pete Davidson's influencer criticism").
 */
function calledCreator(title, name) {
  const ws = words(title);
  const nw = name.split(' ');
  for (let i = 0; i + nw.length <= ws.length; i++) {
    if (ws.slice(i, i + nw.length).join(' ') !== name) continue;
    if (ws.slice(Math.max(0, i - CREATOR_NEAR), i).some((w) => CREATOR_ROLE.test(w))) return true;
  }
  return false;
}
const CREATOR_NEAR = 3;
/** The person a drama headline leads with, or null. */
const dramaName = (title, lex) => dramaNames(title, lex)[0] || null;

/**
 * People the last DRAMA_DAYS' drama headlines name: a headline with a noun people argue about (an allegation, an arrest, a lawsuit, a
 * backlash, an apology, a split, a feud, a ban ...; never a response alone) in a celebrity or creator feed, a people-drama search, an
 * entertainment section, or a post of the week's top of r/LivestreamFail or r/youtubedrama. A name lists with two outlets or more, or
 * when a celebrity or creator feed's own headline, or a creators' subreddit's post, leads with it (where the story broke). A story
 * most of whose outlets are a region's the moments block (India's, Pakistan's ...) is that region's: no name. Prior: how many
 * outlets, a creator (a role word in the headline, a creators' subreddit) ahead, a story of the last day ahead.
 */
function dramaCandidates(items, now, lex, roster = null) {
  const by = new Map();
  const seen = new Set();
  for (const i of items) {
    // (the week's top of the creators' boards is the week's: a story five days on that still tops it is still argued, "Jacob Geller")
    const weekTop = i.fam === 'reddit' && (i.sub === 'livestreamfail' || i.sub === 'youtubedrama') && Number.isFinite(i.rankWeek) && i.rankWeek < DRAMA_WEEK_TOP;
    if (now - i.t > (weekTop ? DRAMA_WEEK_DAYS : DRAMA_DAYS) * DAY || i.t > now + DAY) continue;
    // (the week's top hundred of the creators' subreddits, and their top of the day)
    // (Collector only: and the day's top of the boards that follow influencers and TikTokers)
    const creators = i.fam === 'reddit' && TS.isCreatorBoard(i.sub) &&
      ((Number.isFinite(i.rankWeek) && i.rankWeek < DRAMA_REDDIT_RANK) || Number.isFinite(i.rankToday));
    // (and the day's top of the pop-culture subreddits, where a celebrity's is argued first)
    const pop = i.fam === 'reddit' && (i.sub === 'popculturechat' || i.sub === 'fauxmoi') && !Number.isFinite(i.rankWeek) && i.rankDay < DRAMA_POP_RANK;
    const sub = creators || pop;
    if (!sub && i.fam !== 'celeb' && i.fam !== 'gnews') continue;
    // (someone answering or calling someone out is a dispute too: a name's own noun is found once it is searched)
    if (!TN.familiesIn(i.title).some((x) => TN.DRAMA_FAMS.has(x.f.key) || x.f.key === 'response')) {
      // (one of the roster's creators a post or a row of the creators' beat names, whatever its words, is worth its own search once
      // ROSTER_NAMED_MIN of them do: the search finds what the story is, "Hasan Piker" under a Vanity Fair list and a trivia clip the
      // week Texas argues about him; a name of two words or more, never a handle a clip title drops)
      if (roster && (sub || i.beat === true || CREATOR_PRESS.test(i.outlet || ''))) {
        for (const n of rosterIn(i.title, roster)) {
          if (!n.includes(' ')) continue;
          const c = by.get(n) || { key: n, outlets: new Set(), blocked: new Set(), own: false, creator: true, beat: false, newest: 0, reddit: [], named: new Set() };
          c.named = (c.named || new Set()).add(keyOf(i.title));
          // (one post is enough when it is a top post of the creators' own week: their audience voted the name there)
          if (weekTop) c.topped = true;
          c.newest = Math.max(c.newest, i.t);
          by.set(n, c);
        }
      }
      continue;
    }
    const beat = !sub && (i.beat === true || CREATOR_PRESS.test(i.outlet || ''));
    // (a blocked outlet's row, or one from a country domain far from the audience's, counts for a region's story only)
    const blocked = !sub && !beat && (R.PUBLISHER_BLOCK.test(i.outlet || '') || i.far === true);
    const k = keyOf(i.title);
    const named = dramaNames(i.title, lex, { roster, beat: i.beat === true }).slice(0, DRAMA_NAMES_MAX);
    // (a beat row that names one of the roster's creators after its lead is about that creator: "Tyrese Gibson calls Kai Cenat ...")
    const aboutListed = !!roster && named.slice(1).some((x) => roster.has(x));
    named.forEach((n0, at) => {
      // (a handle one outlet misspells is the handle the others print: "BennDaDonnn" is "BenDaDonnn")
      const n = by.has(n0) ? n0 : [...by.keys()].find((x) => sameHandle(x, n0)) || n0;
      const listed = !!roster && roster.has(n);
      if (seen.has(`${n}|${k}`) || LEAGUE_KW.test(n) || (genericKey(n) && !TN.personLike(n, null) && !listed)) return;
      seen.add(`${n}|${k}`);
      const c = by.get(n) || { key: n, outlets: new Set(), blocked: new Set(), own: false, creator: false, beat: false, newest: 0, reddit: [] };
      if (sub) c.reddit.push(i); else (blocked ? c.blocked : c.outlets).add(outletKey(i.outlet));
      // (a feed's own headline, a subreddit's post, or a people-drama search's headline about a creator, that leads with the name is
      // enough on its own)
      // (a handle in a creator's headline is the creator: "What did Asmongold say ...? Streamer responds to backlash ...")
      // (the roster's creators are creators wherever they are named; the lead name of a row of the creators' beat is one)
      const called = calledCreator(i.title, n) || (!n.includes(' ') && CREATOR_ROLE.test(i.title)) || listed || (i.beat === true && at === 0 && (!n.includes(' ') || !aboutListed));
      if (at === 0 && (sub || i.fam === 'celeb' || (i.drama && called))) c.own = true;
      if (creators || called) c.creator = true;
      // (where creators' drama is covered day in, day out: its subreddits, the outlets whose beat it is)
      if (creators || beat || /^dexerto$/i.test(i.outlet || '')) c.beat = true;
      if (!blocked) c.newest = Math.max(c.newest, i.t);
      by.set(n, c);
    });
  }
  const listedOnly = (c) => !(c.own || c.outlets.size >= DRAMA_MIN_OUTLETS) && !!c.named && (c.named.size >= ROSTER_NAMED_MIN || !!c.topped);
  return [...by.values()].filter((c) => (c.own || c.outlets.size >= DRAMA_MIN_OUTLETS || listedOnly(c)) && c.blocked.size <= c.outlets.size + c.reddit.length + (listedOnly(c) ? 1 : 0)).map((c) => {
    const n = Math.max(1, c.outlets.size + c.reddit.length);
    // (a roster name no drama headline leads with yet is searched after the ones a headline does)
    const prior = listedOnly(c) ? ROSTER_NAMED_PRIOR : Math.min(DRAMA_PRIOR_MAX, DRAMA_PRIOR + 0.5 * Math.log2(n) + (c.creator ? DRAMA_CREATOR_PRIOR : 0) + (c.beat ? DRAMA_BEAT_PRIOR : 0) + (now - c.newest < DAY ? DRAMA_TODAY_PRIOR : 0));
    return { key: c.key, from: 'drama', trends: [], related: [], rests: [], cats: new Set(), wiki: [], reddit: c.reddit, sports: false, drama: n, creator: c.creator,
      ...(listedOnly(c) ? { listed: true } : {}), dramaPrior: prior, prior };
  });
}
const DRAMA_NAMES_MAX = 3;
const DRAMA_WEEK_TOP = 50;
const DRAMA_WEEK_DAYS = 8;
const ROSTER_NAMED_MIN = 2;
const ROSTER_NAMED_PRIOR = 0.9;
const ROSTER_LOOKUPS = 6;
const DRAMA_POP_RANK = 15;
const HONORIFIC = new Set(['lady', 'sir', 'dame', 'lord', 'prince', 'princess', 'king', 'queen', 'dr', 'mr', 'mrs', 'ms', 'miss']);

/** Every Google News row the run's searches returned: the talking points' name searches and the moments' story searches. */
const lookupRows = (lookups) => (lookups ? [...lookups.values()].flatMap((l) => [...((l.tpnews && l.tpnews.rows) || []), ...((l.deep && l.deep.rows) || [])]) : []);

/**
 * People a big trend's related queries name ("tom cruise" under "verity movie", "ken urker" under "gypsy rose"): their own story may be
 * the talking point ("Tom Cruise Digger flop"). They inherit part of the trend's search, all of it when the name, or a film the
 * trend's searches pair it with ("film digger tom cruise"), is read on and on in Wikipedia; a duplicate merges later.
 */
function relatedCandidates(trendCands, { lex, lookups, wikiBy }) {
  const out = [];
  // (every trend's searches: "film digger tom cruise" is the British "verity" trend's)
  const allRelated = trendCands.flatMap((c) => c.related);
  for (const c of trendCands) {
    if (searchScore(c.trends) < RELATED_MIN_SEARCH || c.sports) continue;
    // (once the trend's own name search is in, a name in most of its titles is the same story and one in none is noise)
    const look = lookups && lookups.get(`talk-${TS.talkKey(c.key)}`);
    const titles = look && look.tpnews ? look.tpnews.rows.map((r) => hay(r.title)) : null;
    for (const q of c.related) {
      const known = lex && ((lex.names && lex.names.has(q)) || (lex.capNames && lex.capNames.has(q)));
      if (!TN.personLike(q, null) || !known || q.split(' ').some((w) => c.key.split(' ').includes(w) || TN.FACETS.has(w))) continue;
      const share = titles ? titles.filter((h) => mentions(h, q)).length / Math.max(1, titles.length) : null;
      if (share !== null && (share < RELATED_SHARE[0] || share > RELATED_SHARE[1])) continue;
      // its own Wikipedia reading, or a film the trend's searches pair with it
      const own = wikiBy && wikiBy.get(q);
      const paired = wikiBy ? c.related.filter((r) => r !== q && wikiBy.has(r) && wikiBy.get(r).sustained && allRelated.some((x) => contains(x, r) && contains(x, q))) : [];
      const strong = (own && (own.sustained || own.daily >= RELATED_WIKI_VIEWS)) || paired.some((r) => wikiBy.get(r).daily >= RELATED_WIKI_VIEWS);
      const wikiRows = [...(own ? [own.rows.reduce((a, b) => (b.views > a.views ? b : a))] : []), ...paired.map((r) => wikiBy.get(r).rows.reduce((a, b) => (b.views > a.views ? b : a)))];
      out.push({ key: q, from: 'related', parent: c.key, parentSearch: searchScore(c.trends), parentFull: !!strong, parentRelated: c.related, trends: [], related: [],
        rests: [], cats: new Set(c.cats), wiki: wikiRows, consumed: paired, reddit: [], sports: c.sports, prior: (strong ? 1 : RELATED_PRIOR) * searchScore(c.trends) });
    }
  }
  return out;
}
const RELATED_SHARE = [0.01, 0.45];
const RELATED_MIN_SEARCH = 2.5; // a trend of about 300K US searches or more
const RELATED_PRIOR = 0.6;
const RELATED_WIKI_VIEWS = 150000;

/**
 * Collector only (ios/IDEAS-FEED.md L10). The creators the keyless creator-native signals are about right now (a roster cluster, a
 * question newly typed, a clip, a ban): each is a people-drama name worth evaluating and searching, as a name a drama headline
 * leads with is. A candidate is only a name to look at: whether it lists is decided on its headlines, like any other.
 * native: [{ key, kinds (how many kinds of signal), creator }].
 */
const NATIVE_PRIOR = 1.2;
const NATIVE_KIND_PRIOR = 0.3;
function nativeCandidates(native) {
  return (native || []).filter((n) => n && typeof n.key === 'string' && n.key && n.key.split(' ').length <= 3 && !LEAGUE_KW.test(n.key)).map((n) => {
    const prior = Math.min(DRAMA_PRIOR_MAX, NATIVE_PRIOR + NATIVE_KIND_PRIOR * Math.max(1, n.kinds || 1) + (n.creator === false ? 0 : DRAMA_CREATOR_PRIOR));
    return { key: n.key, from: 'drama', trends: [], related: [], rests: [], cats: new Set(), wiki: [], reddit: [], sports: false, drama: Math.max(1, n.kinds || 1), creator: n.creator !== false, native: true, dramaPrior: prior, prior };
  });
}

/** Every candidate name, merged (a contained name folds into a trend's: "gypsy rose blanchard" into "gypsy rose"), by prior demand. */
function candidates({ trends, wiki, wikiTop, items, now, lex, lookups, audience, roster, native }) {
  const out = trendCandidates(forAudience(trends, audience), now, lex);
  const wikiBy = wikiByKey(wiki, now);
  // (a related name already trending on its own, or already related under a bigger trend, is that candidate)
  for (const r of relatedCandidates(out, { lex, lookups, wikiBy })) if (!out.some((o) => o.key === r.key || contains(o.key, r.key) || contains(r.key, o.key))) out.push(r);
  // names the corpus prints, for a Reddit title's misspelt possessive
  const names = new Set([...out.map((c) => c.key), ...(lex && lex.names ? lex.names : [])]);
  const known = (n) => names.has(n) || items.some((i) => i.fam !== 'reddit' && mentions(i.h || hay(i.title), n));
  const consumed = new Set(out.flatMap((c) => c.consumed || []));
  const fold = (c) => {
    if (c.from === 'wiki' && consumed.has(c.key)) return;
    // (a page read 10x folds into a trend of its whole name, never one word of it: "whitney houston" is no "houston" search)
    // (nor a drama headline's whole name into a one-word search: "chris rock" is no "rock")
    const host = out.find((o) => o.key === c.key || (o.from === 'trends' && (contains(c.key, o.key) || contains(o.key, c.key)) &&
      ((c.from !== 'wikitop' && c.from !== 'drama') || o.key.includes(' ') || !c.key.includes(' '))));
    // (a drama headline's whole name of a one-word sports search is that athlete: "daniil medvedev" of "medvedev")
    if (!host && c.from === 'drama' && out.some((o) => o.from === 'trends' && o.sports && contains(c.key, o.key))) { out.push({ ...c, sports: true }); return; }
    if (!host) { out.push(c); return; }
    host.wiki.push(...c.wiki);
    host.reddit.push(...c.reddit);
    if (c.sustained) host.sustained = true;
    if (c.wikiTop) host.wikiTop = Math.max(host.wikiTop || 0, c.wikiTop);
    if (c.wikiClimb) host.wikiClimb = Math.max(host.wikiClimb || 0, c.wikiClimb);
    // (a searched name the drama headlines lead with too is a drama name: it keeps its place among them)
    if (c.drama) { host.drama = Math.max(host.drama || 0, c.drama); host.creator = host.creator || c.creator; host.dramaPrior = Math.max(host.dramaPrior || 0, c.dramaPrior || 0); }
    // (a trend's search outweighs its press; a Reddit or Wikipedia name with a press burst has both; a person whose page is read
    // 10x is a person story whatever the search's category: "shivon zilis", a business search)
    if (host.from === 'trends' && c.from === 'wikitop') host.prior = Math.max(host.prior, c.prior) + 0.3 * Math.min(host.prior, c.prior);
    else if (host.from === 'trends') host.prior += c.from === 'press' ? 0 : 0.3 * c.prior;
    else host.prior = Math.max(host.prior, c.prior) + 0.3 * Math.min(host.prior, c.prior);
    // (the press burst's outlet count stays known: a press story wide enough gets its name search)
    if (c.outlets) host.outlets = Math.max(host.outlets || 0, c.outlets);
    if (c.recentOutlets) host.recentOutlets = Math.max(host.recentOutlets || 0, c.recentOutlets);
  };
  [...dramaCandidates(items, now, lex, roster), ...nativeCandidates(native), ...wikiCandidates(wiki, now), ...wikiTopCandidates((wikiTop || []).filter((w) => !w.climb), lex), ...wikiClimbCandidates(wikiTop, lex),
    ...redditCandidates(items, now, lex, known), ...burstCandidates(items, now, lookups, lex)].forEach(fold);
  const sorted = out.sort((a, b) => b.prior - a.prior || a.key.localeCompare(b.key));
  // (each source keeps its seats, then the strongest of the rest)
  const picked = new Set();
  // (the drama names' seats are theirs whichever source named them first: a small search the drama headlines lead with is one of them)
  for (const [from, n] of Object.entries(CANDIDATE_RESERVE)) sorted.filter((c) => (from === 'drama' ? !!c.drama : c.from === from)).slice(0, n).forEach((c) => picked.add(c));
  // (a creator the drama headlines lead with is never cut for seats: the list leads with creators, and on a busy day the eighty
  // seats went to names with bigger searches while a charged influencer two outlets and two boards told was never weighed at all.
  // Collector only, 2026-10-12)
  sorted.filter((c) => !!c.drama && !!c.creator).slice(0, CREATOR_SEATS).forEach((c) => picked.add(c));
  // (and the roster's creators the creators' posts name: a few seats of their own)
  sorted.filter((c) => c.listed).slice(0, ROSTER_LOOKUPS).forEach((c) => picked.add(c));
  for (const c of sorted) { if (picked.size >= CANDIDATE_MAX) break; picked.add(c); }
  // (and every name with a 20K+ search of its own, whatever its category: no story is filtered out for its subject, "nolan wells")
  sorted.filter(hasDemand).forEach((c) => picked.add(c));
  return sorted.filter((c) => picked.has(c));
}

/** A name with a search of its own big enough to be a story (not a result: no sports name). */
const hasDemand = (c) => !c.sports && c.trends.some((t) => t.volume >= LOOKUP_DEMAND_VOLUME);

/**
 * The names worth a Google News search and a YouTube suggestion request this refresh, strongest first (with seats for the week's
 * Reddit, Wikipedia and press names): not a long news query, a place, or a plain word no related query explains (none of them can
 * list), and a sports name only with a strong prior.
 */
function lookupNames(ctx) {
  const ok = lookupPool(ctx);
  // (a person trending for the first time today first of all: the story broke today)
  const fresh = ok.filter((c) => c.fresh).slice(0, LOOKUP_FRESH);
  // (then the names with demand of their own, whatever their category's weight: a big search, a page read 10x or climbing Wikipedia's
  // top 1000, a press story in 20+ outlets: "pneumonic plague" (health), "shivon zilis", "avengers endgame")
  const big = ok.filter((c) => bigDemand(c, ctx.audience));
  // (and the people-drama names before every other: the list leads with them, so their searches are the refresh's first; creators ahead)
  const { sought, drama, listed } = dramaHead(ok, ctx.audience);
  // (and a name everyone is searching that a drama headline of the last days names at all, whoever it leads with: "kai cenat" at
  // 100K, named in the week's drama headlines and leading none of them, is the benchmark's own kind)
  const told = ctx.items.filter((i) => ctx.now - i.t <= DRAMA_DAYS * DAY && i.t <= ctx.now + DAY && (i.fam === 'celeb' || i.fam === 'gnews' || i.fam === 'reddit') &&
    TN.familiesIn(i.title).some((x) => TN.DRAMA_FAMS.has(x.f.key))).map((i) => i.h || hay(i.title));
  const named = big.filter((c) => !drama.includes(c) && told.some((h) => mentions(h, c.key)));
  const head = [...fresh, ...sought, ...named, ...drama, ...listed, ...big, ...ok.slice(0, LOOKUP_HEAD)];
  const seats = Object.entries(LOOKUP_RESERVE).flatMap(([from, n]) => ok.filter((c) => c.from === from && !head.includes(c)).slice(0, n));
  const demand = [...ok.filter((c) => !c.trends.length && (c.recentOutlets || 0) >= BURST_MIN_OUTLETS), ...ok.filter(hasDemand)];
  return [...new Set([...head, ...seats, ...demand, ...ok])].map((c) => c.key);
}
/** The candidates worth a search at all: no long news query, no place, no plain word no related query explains, a sports name only with a strong prior. */
function lookupPool(ctx) {
  // (a sports name the drama headlines lead with is searched too: "Daniil Medvedev removed from match after striking spectator")
  return candidates(ctx).filter((c) => (!c.sports || c.prior >= 2 || !!c.drama) && c.key.split(' ').length <= 4 && !R.isPlaceOrTeam(c.key) &&
    !(c.generic && !c.related.some((q) => TN.familiesIn(q).length)));
}
/**
 * The people-drama names in the order they are searched: one everyone is already searching first of all ("kai cenat", 100K: the
 * benchmark's own kind), then the creators' own (streamers, YouTubers and TikTokers lead the list, so their names lead the
 * searches), then the musicians' and celebrities'; and the roster's creators the creators' posts name without a drama word yet, a
 * few of them a refresh, the most named first.
 */
function dramaHead(ok, audience) {
  const dramaAll = ok.filter((c) => c.drama).sort((a, b) => (b.dramaPrior || 0) - (a.dramaPrior || 0) || b.drama - a.drama || a.key.localeCompare(b.key));
  const sought = dramaAll.filter((c) => bigDemand(c, audience));
  const rest = dramaAll.filter((c) => !sought.includes(c));
  const drama = [...sought, ...rest.filter((c) => c.creator).slice(0, LOOKUP_DRAMA), ...rest.filter((c) => !c.creator).slice(0, LOOKUP_DRAMA_STARS)];
  const listed = ok.filter((c) => c.listed && !drama.includes(c)).slice(0, ROSTER_LOOKUPS);
  return { sought, drama, listed };
}
/**
 * The creators' people-drama names alone: what a refresh searches again once a source that names them lands late (the creators'
 * Reddit list, the roster: on the phone neither is in hand when the round's names are picked). A musician's or celebrity's waits for
 * the next refresh.
 */
function dramaLookupNames(ctx) {
  const ok = lookupPool(ctx);
  // (every creator's, the strongest first: the ones the round's own pick had no seat for are searched now)
  const creators = ok.filter((c) => c.drama && c.creator).sort((a, b) => (b.dramaPrior || 0) - (a.dramaPrior || 0) || b.drama - a.drama || a.key.localeCompare(b.key));
  return [...new Set([...creators, ...dramaHead(ok, ctx.audience).listed])].map((c) => c.key);
}
/** Demand of a name's own: a search of about 100K in the audience's country, a page read 10x or climbing, a press story in 20+ outlets. */
const bigDemand = (c) => !c.sports && (searchScore(c.trends) >= LOOKUP_BIG_SEARCH || !!c.wikiTop || !!c.wikiClimb ||
  (!c.trends.length && (c.outlets || 0) >= LOOKUP_DEMAND_OUTLETS));
const LOOKUP_BIG_SEARCH = 2;
const LOOKUP_DRAMA = 20;
const LOOKUP_DRAMA_STARS = 8;


module.exports = { placeGiven, candidates, lookupNames, dramaLookupNames, relatedCandidates, dramaCandidates, dramaName, dramaNames, calledCreator, rosterIn, sameHandle, PERSON_VERB, CREATOR_ROLE, CREATOR_PRESS, HONORIFIC, leadName, keyOf, hay, mentions, namesKey, isStrictKey, genericKey, catWeight, searchScore, CREATOR_REL, LEAGUE_KW,
  AUDIENCE_GEO_W, audienceOf, geoWeight, homeGeos, forAudience,
  DAY, WINDOW_DAYS, WIKI_MIN_VIEWS, WIKI_SUSTAIN_VIEWS, BURST_MIN_OUTLETS, REDDIT_TOP_RANK, REDDIT_WEEK_RANK, CREATOR_SUBS };
