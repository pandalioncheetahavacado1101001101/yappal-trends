'use strict';
/*
 * Talking points: the simple things everyone is searching and talking about this week, titled the way people search them ("Kai
 * Cenat allegations", "Christa Pike execution", "Taylor Swift SNL cameo"), biggest first by what a creator chasing views would film.
 * One card per talking point, each with a one-line reported "what", a heat and the signals behind it. Video ideas are not attached:
 * the app asks for them when a card is opened (ideas.js --ideas-for=TITLE).
 *
 *   1 names     who or what is trending, from every source with its own seats (the week's big press, Reddit and Wikipedia stories
 *               carry no search of their own): Google Trends "Trending now" over 7 days, every category (a keyword, its related
 *               queries, its volume and growth; facets like "aaron rodgers wife" fold into "aaron rodgers", a double-barrelled name
 *               its related queries hyphenate stays whole, "robert kelker-kelly"; fixtures, service
 *               searches, leagues and broadcasters out); people a big trend's related queries name ("tom cruise" under "verity
 *               movie", with all of its search when a film they are searched with is read on and on: "film digger tom cruise");
 *               Wikipedia's most read, a spike or read on and on (100K+ views on 3 of the last 4 days: "Ted Kaczynski" for
 *               Netflix's Unabomber); the week's top posts of r/LivestreamFail, r/youtubedrama and r/OutOfTheLoop ("What is going on
 *               with Chris Hansen ...") and the day's top of the pop-culture subreddits; names eight or more outlets printed this
 *               week, in the store and in every Google News search the run made; people Wikipedia's daily top 1000 shows read 10x
 *               their week-old level ("Shivon Zilis" 1K -> 50K, below the most-read feed's cut). Every name with a 20K+ search of its
 *               own is evaluated, whatever its category (no story is filtered for its subject: "Nolan Wells"). The strongest 25 by
 *               prior demand, then seats for Reddit, Wikipedia, press and related names, then names with demand of their own (a page
 *               read 10x, a press story breaking in 8+ outlets, a 20K+ search), get the name searches; the creators' world's five
 *               biggest names also get a newest-first search of their last two days (a new accuser lands after the week's 100
 *               results: "TikToker Gorgeous Doll"), and so does a person trending for the first time in the last half day, at any
 *               volume, searched first ("andrew mountbatten-windsor" the morning his legal challenge broke); Know Your Meme's memes
 *               of the week get name searches too ("jean phil")                                    [talk-sources.js, talk-candidates.js]
 *   2 evidence  per name: one Google News search '"<name>" when:7d' (every outlet counts, blocked ones too; YouTube uploads are
 *               creators already posting about it), the store's own rows naming it (a name the store hardly names and nobody
 *               searched yet: the moments' story searches for it), fresh YouTube search completions (a cut one, "lesbia", ends as
 *               the titles spell it)
 *   3 noun      the talking-point noun its titles repeat near the name (allegations, arrest, death, execution, mistrial, shirt, cameo, long-lost son ...),
 *               related queries and fresh completions (what people type) counting double; a response is the aftermath and never
 *               the noun on its own; a noun in a sliver of a well-covered name's titles is an aside; a newer outcome replaces the
 *               noun it settles ("Caleb Flynn guilty verdict" over the trial; a mistrial is never a verdict, a motion to be found not guilty no
 *               acquittal: "Lindsay Clancy mistrial"; a league's suspension over the arrest: "Jed York suspension"); an old arrest back
 *               for its footage is the footage ("Luigi Mangione bodycam"); a rumour about who someone is, is "rumors", never "allegations" ("Candace
 *               Owens lesbian rumors"); a stabbing the press reports inside a brawl is the
 *               fight ("Lucki ComplexCon fight"); a film searched in the hundreds of thousands is the film, not an interview's facet
 *               ("Verity movie"); a shoot that stopped is a production pause; one name going at another with nobody answering is
 *               criticism, not a feud ("Chris Hansen Primetime criticism"); a title is never surer than its line: an outbreak its
 *               line only suspects is a scare ("Russia plague scare"), a show's facet no line tells is the show as searched ("East
 *               of Eden"), a split its line only looks back on is no talking point                              [talk-nouns.js]
 *   4 title     2-5 words in sentence case: the subject (the person the noun is about: "Ken Urker death", not "Gypsy Rose death";
 *               "Taylor Swift SNL cameo", not "Dakota Johnson cameo"; whose it is when a relative's: "Chad Lowe daughter death"),
 *               a related query or fresh completion of that shape, or subject + a word people search with it + the noun
 *               ("Flydubai pilot attack", "Tom Cruise Digger flop", "Candace Owens lesbian allegations"); a film or show a name is
 *               read and searched for ("Unabomber movie", "Monster Lizzie Borden", "Nathan Fielder Elizabeth Holmes doc", a dispute
 *               with it: "Chris Hansen Primetime criticism"); an official by the job, never by a team from the fixture ("Adrian Hill
 *               referee suspension"); a paused shoot by the film its searches name ("Batman Part II production pause"); a reveal
 *               that is a crossover ("Fortnite FNAF collab"); a split or a romance
 *               with a far more famous partner leads with the partner ("Elon Musk Shivon Zilis split"), a feud says who with ("Phil
 *               Collins McCartney feud"); names as spelt, Wikipedia's spelling where the outlets split on case ("Flydubai")
 *   5 what      the best reported headline naming the subject and the noun (never a blocked outlet's or YouTube's, never a claim
 *               stated as fact; not a column, an explainer, a question, an interview, a list, a review's verdict, a call to look, a
 *               how-to-watch, someone else's reaction or the outlet's own tone; never the name only in an aside, "amid Ed Sheeran
 *               controversy"; a claim best told with who makes it and what it is), the subject's denial as a short clause ("; he
 *               denies it"), an age the sources disagree on left out ("has died", and who they were), the name spelt as the title
 *               spells it, without a middle name ("Christa Pike"); what most outlets say, each counted once (their word for the
 *               person, "partner", "co-pilot"; the other name they print, Paul McCartney, not one tabloid's Lily Collins; a hedge they
 *               keep, "suspected plague case"), never a blog's post, a teaser's lead, a teaser that withholds what happened ("one
 *               particular aspect"), a satire site's joke (The Onion), a line led by someone of the subject's ("Caleb Flynn's daughter
 *               confronts ...") or by a namesake ("Jair Bolsonaro" under Flavio Bolsonaro), or a dangling clause; told plainly (a tabloid
 *               verb aimed at someone "criticizes", a film that "bombs" flops, "disgraced" before a role and an "amid" backdrop out; a
 *               claim's bare heading is its case, "... in the Cornell 7 case"; a small count spelt out, "one game"; who said so
 *               as a clause, "..., FDA says"; a work's name in single quotes); never a hedge on the wrong verb ("allegedly speaks
 *               out") or who did it withheld ("defended by Oscar-winning filmmaker"); a sentence's or a verdict's line says who
 *               and what for ("Former 'American Idol' singer Caleb Flynn sentenced to life for wife's murder"); a bare first name given the full name a role-led
 *               headline prints ("streamer Reggie Travers"), and a person the line names whole is named by surname in the denial
 *               ("; Cenat denies it") [talk-lines.js]; a new
 *               chapter in the last two days is the card's "latest", and a claim's line says one came, naming the newcomer once she
 *               leads three headlines, joined on as a clause so the line stays one sentence ("..., as TikToker Gorgeous Doll makes
 *               claims too."); a claim's line says who is accused of what, never "Allegations spark ..."; a recall's says what for;
 *               a finale's never who did it; a work is quoted as the card's own headlines quote it ("‘Lanterns’ writers ...");
 *               a new film or show searched as itself is "<Work> reviews" once its searches ask, told by a line about the reviews
 *               as a whole; an official nobody searches by name is titled by the league and the job ("NFL referee suspension")
 *   6 heat      demand the way a creator weighs it: the search people typed (each country's weighed for "My audience", US by default:
 *               the audience's own in full, the others by how much it watches from there; weighed by its category; broad press stands in for
 *               it when nobody searched, below a real search and only when the headlines lead with the name; a person read 10x in
 *               Wikipedia is weighed as a person whatever the search's category; a long news query about a name nobody searches on
 *               its own counts half: "greg lui doj charges"), creators already uploading (count and share of the coverage), a top post of the week
 *               where creators' drama is argued or explained, two sides to take, a creators'-world subject, Wikipedia read on and
 *               on, fresh completions; the press by its busiest day; times recency (full for two days past the coverage peak,
 *               halving every six to day four, then every two and a half; full again for a new chapter, high while it keeps
 *               coming, or while creators still upload); a death, tribute or trial nobody argues about counts less (0.6; 0.65 when
 *               read 150K+ a day or still trending), as does a region's press alone or a search outside the US; the press alone is
 *               supply, not demand: with no 16K+ search, no uploads, thread, page read, fresh completions or denial it counts 0.6 of
 *               itself ("Wanying Zhang arrest", a 10K search and 53 outlets); drama (a claim, an
 *               arrest, a fight, a split) counts more, a story with a clip to react to (a cameo, something worn on stage, a blowup)
 *               a little more, and a soft noun (an engagement, a wedding, a collab; never a finale, an event of its own) less; a
 *               story with no 100K search at home climbs no faster than x1.1 (demand leads status); a sports name lists
 *               only for drama, a name with no noun only for a film or show with a big search; a press story nobody searched lists
 *               only with a noun in 15%+ of its coverage (never "controversy": "Dua Lipa dress", "Ed Sheeran controversy" out); every
 *               outlet counts (60 is wider than 24); a death with no uploads and no denial counts less whatever Reddit says;
 *               times momentum [talk-momentum.js]: the press's last 24 hours against the three days before (a rise of eight items or
 *               more: "Russia plague outbreak" 3 > 5 > 26 > 66), against its busiest day (decaying, half as much while its page is
 *               still read 50K+ a day), back at its baseline three days past the peak with no live search and no page read 50K+
 *               (fading, and a fading card costs more: "Candace Owens lesbian rumors", "Aaron Rodgers sideline blowup"); a page in
 *               Wikipedia's daily top 1000 read half again its week's low stands in for a search nobody made ("Avengers: Endgame"
 *               and the list it tops); a name whose YouTube completions are all about something else counts less ("Sass Jordan"
 *               and her songs); a long news query with no creator, Reddit or Wikipedia signal never lists ("greg lui doj charges")
 *   7 merge     one card per talking point (same subject, title or line; the same noun about one family or institution; one
 *               film, under two names too: "Chris Hansen Primetime criticism", "Primetime movie"; the same headlines; a card whose
 *               line leads with another card's name is that card's story: "Michael Douglas makes rare comment on ... Catherine
 *               Zeta-Jones separation" under "Michael Douglas affair"); each card carries the other people its coverage names
 *               (`also`), so a moment about one of them is its story and never a second row [hot-list.js]; a name trending
 *               for another trend's story folds into it ("Anne Hathaway" into Verity);
 *               then the moments whose headline puts a noun right after their subject, the listed words and crazes of "Words & trends"
 *               and up to three of the month's TikTok formats (NewEngen's monthly page: "Pumpkin head illusion"; one a headline
 *               names as a trend first, one blog's word alone well below), and Know Your Meme's memes of the week with two kinds of
 *               signal ("Tony Stark looking meme": an entry, an explainer, a roundup, outlets, Reddit) join at their own heat; no seat
 *               holds a stale craze up; a craze, a meme or a word ranks by its own demand (its own name search's outlets and creators'
 *               uploads, what people lately type after it) and, when a creator can film it (a craze, a sound, a trend, a meme the press
 *               calls a trend), in a fair blend: the hottest format at half the hottest story, the rest by their own demand against it
 *               ("Pumpkin head illusion" among the week's stories, not under them)                              [talk-extras.js]
 *   6b people-  (2026-10-07) a story is weighed by its own headlines (ownStory: the ones that name the subject and say the noun, tell
 *      drama    its line or, for a claim, its fallout): a name the drama headlines gave with no search of its own is read by the outlets
 *               that tell its story (READ_OWN_W, 40+), five make its press demand, and under three (two for a creator) it does not list
 *               when the name is in the news anyway ("Meghan Markle backlash": two tabloids of her week's 51 outlets); the week's
 *               people-drama is still told (two own headlines or creators' uploads about it in three days, within eight of its first)
 *               and stays at its peak: recency STILL_RECENCY at least, never stale or fading ("Rick Ross arrest" five days on); a claim,
 *               an arrest, a stabbing or an attack x CLAIM_MULT, any other drama x DRAMA_MULT, one its own line says was answered
 *               x ANSWERED_MULT; something worn or done on stage that ARGUED_MIN headlines say was answered is people-drama too ("Zach
 *               Bryan Free Palestine shirt"); a royal is weighed like politics. Titles: a name and a noun, four words at most; "death
 *               threats" when a claim's line says so; "<topic> post" for a post its headlines quote; "$250K loss" for money lost to a
 *               fraud; "failed execution" when the line says she survived; a stabbing once STABBING_SAID headlines state it; a claim
 *               the subject admitted is told by the admission (admittedLine).
 *   8 heat no.  0-100, smooth and never clipped (100 x (1 - e^(-score/10))): the top of the list keeps its order
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const TS = require('./talk-sources');
const TN = require('./talk-nouns');
const TC = require('./talk-candidates');
const TW = require('./talk-works');
const TX = require('./talk-extras');
const TM = require('./talk-momentum');
const TL = require('./talk-lines');
const SF = require('./story-focus');
const { outletKey, contains } = require('./util');

const { words } = W;
const { candidates, relatedCandidates, lookupNames, leadName, keyOf, hay, mentions, catWeight, searchScore, homeGeos, audienceOf, CREATOR_REL, DAY, WINDOW_DAYS,
  WIKI_MIN_VIEWS, WIKI_SUSTAIN_VIEWS, BURST_MIN_OUTLETS, REDDIT_TOP_RANK, REDDIT_WEEK_RANK, CREATOR_SUBS } = TC;
const { workOf, crossoverOf } = TW;
const { crazePoints, crazeTitle, wordPoints, momentPoints, memePoints, kymMemes, heatNumber } = TX;
const { wikiDaysIndex, wikiCurveOf, momentumOf, typedOf, RISE_W, STALE_MULT, FADING_MULT, NO_DEMAND_MULT, WIKI_LOOKUP_MIN, WIKI_LOOKUP_SPIKE, WIKI_LOOKUP_W } = TM;
const LIST_MAX = 40;
// recency: full heat for two days past the coverage peak, then halving every six days, floored: the week's biggest talking points
// stay listed while creators are still posting about them ("Kai Cenat allegations" four days on), the newest lead among equals
const RECENCY_GRACE_DAYS = 2;
const RECENCY_HALF_LIFE_DAYS = 6;
const RECENCY_STEEP_AFTER = 4; // days past the peak after which a story with no new wave fades fast
const RECENCY_STEEP_HALF_LIFE = 2.5;
const RECENCY_FLOOR = 0.2;
const ONGOING_SHARE = 0.3; // the last two days still this share of the busiest day: still going
const ONGOING_RECENCY = 0.9;
const NO_NOUN_MULT = 0.6;
const SEARCH_W = 1.5; // the search leads: demand people typed
const PRESS_W = 0.3;
const PRESS_DEMAND_OUTLETS = 40;
const PRESS_DEMAND_W = 0.5;
const CREATORS_W = 0.9; // creators already uploading about it: the reaction video is proven
const YT_SHARE_W = 4;
const YT_SHARE_CAP = 0.25;
const WIKI_SUSTAINED_W = 1.5;
const DISPUTE_BONUS = 0.5; // a claim and a denial: two sides to take
const NATIVE_BONUS = 0.5; // a streamer, a YouTuber, a rapper: the short-form audience's own world
const GRAVE_NOUNS = new Set(['death', 'tribute', 'trial', 'crash', 'verdict', 'guilty verdict', 'sentencing', 'mistrial']);
const GRAVE_MULT = 0.6;
const GRAVE_EXEMPT_VOLUME = 1000000;
const GRAVE_EXEMPT_WIKI = 150000;
const GRAVE_READ_MULT = 0.65; // a death read 150K+ a day or still trending: less of a discount
// the press alone is what newsrooms supply, not what people ask for: with no search of 16K+ in the audience's weighing, no creators'
// uploads, no thread, no page read, no fresh completions and no denial, a story's press counts at this share ("Wanying Zhang arrest":
// a 10K search and 53 outlets on a DOJ case)
const PRESS_ONLY_MULT = 0.6;
const CREATOR_PRESS_MIN = 2;
const AUDIENCE_SEARCH = 1.2;
const AUDIENCE_UPLOADS = 2;
const WIKI_TOP_CAT = 0.9;
const CREATORS_STILL = 3;
const CREATORS_RECENCY = 0.85;
const DRAMA = new Set(['allegations', 'arrest', 'fight', 'stabbing', 'attack', 'feud', 'split', 'rumors', 'lawsuit', 'leak', 'argument', 'quit', 'prison', 'execution',
  'mistrial', 'verdict', 'backlash', 'flop', 'apology', 'threats', 'scam']);
const SOFT = new Set(['romance', 'ending', 'trailer', 'boxoffice', 'performance', 'speech', 'tribute', 'injury', 'comeback', 'collab', 'election', 'reviews']);
const DRAMA_MULT = 1.1;
// a claim of wrongdoing about a person, an arrest, an attack: the benchmark's own kind ("Kai Cenat allegations"), argued about harder
// than a remark and its backlash
const CLAIM_DRAMA = new Set(['allegations', 'arrest', 'threats', 'stabbing', 'attack', 'scam']);
const CLAIM_MULT = 1.5;
const SOFT_MULT = 0.8;
// (an engagement or a wedding announced is noted, not argued about: "Kash Patel engagement" sinks below a fight, a recall or a finale)
const REVEALED = new Set(['affair', 'pregnancy', 'box office record', 'record']);
// a soft family's noun that is an event of its own: a finale aired this week is what a fandom films about ("Lanterns finale")
const EVENT_NOUNS = new Set(['finale']);
// a story with a clip to react to (a cameo, something worn on stage, a blowup on camera) is one a creator can film today: it counts
// more than one only read about ("Taylor Swift SNL cameo", "Zach Bryan Free Palestine shirt")
const CLIP = new Set(['cameo', 'look', 'argument', 'knockout']);
const CLIP_MULT = 1.15;
// one name going at another with nobody answering is a remark, not a feud ("Chris Hansen Primetime criticism")
const ONE_SIDED = new Set(['controversy', 'criticism']);
// a story nobody searched in the hundreds of thousands at home climbs no faster than this: the press's own rush is supply, and a
// 20K-50K search that reads "rising" never outranks a 100K+ story a day older ("Lanterns finale", "Zach Bryan Free Palestine shirt")
const RISE_CAP_SMALL = 1.1;
const READ_CAP = 1.2; // about 0.6 of a 100K search's
const READ_OWN_W = 0.7;
const READ_OWN_CAP = 1.9; // (a story 45 outlets tell in their own headlines: near a 100K search's)
const STILL_RECENCY = 0.75;
const STILL_DAYS = 3;
const STILL_MIN = 2;
const STILL_WEEK = 8; // days since the story's first headline
const OWN_LINE_WORDS = 2;
const UPLOAD_ABOUT_WORDS = 2;
const ARGUED = /\b(?:def(?:ies|iant|ying|ied)|backlash|boycott\w*|slams?|slammed|blasts?|criticis\w+|criticiz\w+|outrage|controvers\w+|drama|reacts?|responds?|divides?|debate|stirs?)\b/i;
const ARGUED_MIN = 4;
const ARGUED_SHARE = 0.05;
const OWN_ASKED_OUTLETS = 5; // (a drama story this many outlets tell in their own headlines is talked about, not only printed)
const ANSWERED_MULT = 0.85;
// a line that tells the subject's own answer: what was said or done has been answered, the argument is winding down
const ANSWERED = /\b(?:explains?|clarif(?:y|ies|ied)|responds? to|addresses|breaks? (?:his|her|their) silence|sets? the record straight|speaks? out)\b/i;
const TYPED_W = 0.45;
const TYPED_CAP = 1.6;
const READ_LEAD_SHARE = 0.4;
const LEAD_WORDS = 5;
const LONG_TAIL_MULT = 0.5;
const CAT_FLOOR = 0.6;
const ABROAD_MULT = 0.6; // searched only abroad: an Australian story never holds a seat in a US top 20 ("Sam Wood charges")
// a search still trending in the audience's country, 100K+, that began in the last two days: what people are typing right now leads
// what the press printed all week ("Robert Kelker-Kelly death" 200K and 12 hours old over "Kash Patel engagement" 50K and 3 days old)
const LIVE_SEARCH_MULT = 1.15;
const LIVE_SEARCH_VOLUME = 100000;
const LIVE_SEARCH_DAYS = 2;
const LIVE_LONG_MULT = 1.1; // still trending after two days ("Cornell 7 case", 500K and active all week)
const NOUN_MIN_SHARE = 0.06; // a noun in fewer of a well-covered name's titles is an aside ("Jerry Hall ... divorce" under her Traitors casting)
const REGIONAL_SHARE = 0.6;
const REGIONAL_SHARE_UNSEARCHED = 0.3;
const SUSTAINED_RECENCY = 0.9;
const REGIONAL_MULT = 0.4;
const UK_SHARE = 0.6;
const UK_MULT = 0.7;
const RESPONSE_MULT = 0.75;

// ---------- 2 evidence ----------
/**
 * Every row the run's name searches returned, by the search that asked, each with its words: a headline another name's search found
 * is evidence for every name it prints ("Pete Davidson faces backlash as Olivia O'Brien speaks out", found for Olivia O'Brien). Built
 * once per lookups map.
 */
const NEWS_INDEX = new WeakMap();
function newsIndexOf(lookups) {
  if (!lookups || typeof lookups !== 'object') return [];
  const old = NEWS_INDEX.get(lookups);
  if (old) return old;
  const out = [];
  for (const [k, l] of lookups) {
    if (!k.startsWith('talk-')) continue;
    for (const r of [...((l.tpnews && l.tpnews.rows) || []), ...((l.tprecent && l.tprecent.rows) || [])]) {
      const title = TN.cleanHeadline(r.title, r.publisher);
      out.push({ k, title, h: hay(title), t: r.t, outlet: r.publisher || 'Google News', fam: 'gnews', url: r.url, searched: true, ...(TS.FAR_DOMAIN.test(r.publisherUrl || '') ? { far: true } : {}) });
    }
  }
  NEWS_INDEX.set(lookups, out);
  return out;
}
const OTHERS_NAME_WORDS = 2;

function evidenceOf(c, { items, lookups, now }) {
  const look = lookups.get(`talk-${TS.talkKey(c.key)}`) || {};
  const gn = (r) => ({ title: TN.cleanHeadline(r.title, r.publisher), t: r.t, outlet: r.publisher || 'Google News', fam: 'gnews', url: r.url, searched: true,
    ...(TS.FAR_DOMAIN.test(r.publisherUrl || '') ? { far: true } : {}) });
  // (the week's search, and for the creators' world's biggest stories the last two days' newest-first: "Gorgeous Doll" on day five)
  const news = [...((look.tpnews && look.tpnews.rows) || []), ...((look.tprecent && look.tprecent.rows) || [])].map(gn);
  // (a Reddit, press or Wikipedia name the talking points have not searched yet and the store hardly names, the moments' story
  // searches for it: "Chris Hansen"; a trend's searches, or the store's own rows, already tell its story)
  const tk = TS.talkKey(c.key);
  const ownRows = items.filter((i) => mentions(i.h, c.key)).length;
  const story = look.tpnews || c.trends.length || ownRows >= STORY_OWN_MAX ? [] : [...lookups.entries()].filter(([k, l]) => k.startsWith(`story-${tk}`) && l.deep && l.deep.rows)
    .flatMap(([, l]) => l.deep.rows).map(gn).filter((r) => mentions(hay(r.title), c.key));
  const own = items.filter((i) => mentions(i.h, c.key)).map((i) => ({ title: i.title, t: i.t, outlet: i.outlet, fam: i.fam, sub: i.sub, rankDay: i.rankDay,
    rankWeek: i.rankWeek, ...(Number.isFinite(i.rankToday) ? { rankToday: i.rankToday } : {}), url: i.url, ...(i.far ? { far: true } : {}), ...(i.beat ? { beat: true } : {}) }));
  // (and what the other names' searches found about this one: a whole name of two words or more, or a handle no dictionary spells)
  // (for a name the drama headlines lead with and nobody searches by the tens of thousands: a searched name's own results tell its story)
  const whole = !!c.drama && !c.trends.some((t) => t.volume >= WAVE_SEARCH_MAX) && (c.key.split(' ').length >= OTHERS_NAME_WORDS || !W.inDict(c.key));
  const others = whole ? newsIndexOf(lookups).filter((r) => r.k !== `talk-${tk}` && mentions(r.h, c.key)).map((r) => ({ title: r.title, t: r.t, outlet: r.outlet, fam: r.fam,
    url: r.url, searched: true, ...(r.far ? { far: true } : {}) })) : [];
  const seen = new Set();
  const rows = [...news, ...story, ...own, ...others].filter((r) => r.t >= now - WINDOW_DAYS * DAY && r.t <= now + DAY).filter((r) => {
    const k = keyOf(r.title);
    return k && !seen.has(k) && seen.add(k);
  // (a blocked outlet's row, or one from a country domain far from the audience's: it counts, it never words a line)
  }).map((r) => ({ ...r, blocked: R.PUBLISHER_BLOCK.test(r.outlet || '') || r.far === true, youtube: YOUTUBE_OUTLET.test(r.outlet || '') }));
  const press = rows.filter((r) => r.fam !== 'reddit' && r.fam !== 'bluesky');
  const byDay = new Map();
  for (const r of press) { const d = Math.floor(r.t / DAY) * DAY; byDay.set(d, (byDay.get(d) || 0) + 1); }
  const days = [...byDay.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const trendPeak = c.trends.length ? Math.max(...c.trends.map((t) => t.start)) : null;
  const peakT = days.length ? days[0][0] + DAY / 2 : trendPeak ?? (c.wiki[0] ? c.wiki[0].t : now);
  const reddit = [...rows.filter((r) => r.fam === 'reddit'), ...c.reddit];
  const youtube = press.filter((r) => r.youtube).length;
  return {
    rows, press, byDay, peakT, peakCount: days.length ? days[0][1] : 0,
    lastT: Math.max(0, ...rows.map((r) => r.t), ...c.trends.map((t) => t.end ?? now)),
    firstT: Math.min(...[...press.map((r) => r.t), ...c.trends.map((t) => t.start)].filter(Number.isFinite), now),
    outlets: new Set(press.filter((r) => !r.youtube).map((r) => outletKey(r.outlet))).size,
    youtube,
    // creators' share of the name's coverage: Kai Cenat's 20 uploads in 100 results, not 4 in a film's 100 reviews
    ytShare: youtube / Math.max(10, press.length),
    // (the coverage still coming in: the last two days, uploads included, against the busiest day)
    recent: press.filter((r) => now - r.t < 2 * DAY).length,
    redditBest: Math.min(99, ...reddit.filter((r) => !Number.isFinite(r.rankWeek)).map((r) => r.rankDay ?? 99)),
    redditWeek: Math.min(99, ...reddit.filter((r) => Number.isFinite(r.rankWeek) && CREATOR_SUBS.has(r.sub)).map((r) => r.rankWeek)),
    redditSubs: new Set(reddit.map((r) => r.sub)).size,
    creatorSub: reddit.some((r) => TS.isCreatorBoard(r.sub)),
    completions: (look.tpyt && look.tpyt.completions) || [],
    searched: !!look.tpnews || story.length > 0,
    // (when the name's own searches were last answered: the collector's series counts a part as read only then)
    newsAt: Math.max(look.tpnewsAt || 0, look.tprecentAt || 0) || null, ytAt: look.tpytAt || null,
  };
}

/**
 * A new chapter: a story past its first wave (its busiest day two and a half days back or more) whose last two days' sentence-case
 * titles, from two or more outlets, name someone its earlier coverage never did, with the card's own noun ("TikToker Gorgeous Doll
 * makes new allegations against Kai Cenat"): { name, rows } of the newest, or null.
 */
function chapterOf(ev, subject, family, now) {
  if (!family || now - ev.peakT < CHAPTER_AFTER_DAYS * DAY) return null;
  const subj = subject.split(' ');
  // (every outlet counts, blocked ones and Title Case headlines too; the new name is read from sentence-case lines, its role word off:
  // "TikToker Gorgeous Doll" -> "gorgeous doll")
  const recent = ev.press.filter((r) => now - r.t < 2 * DAY && !r.youtube && family.re.test(r.title) && mentions(hay(r.title), subj[subj.length - 1]));
  const older = new Set(ev.rows.filter((r) => now - r.t >= 2 * DAY).flatMap((r) => [...TN.nameRuns(r.title), ...words(r.title)]));
  const names = new Set();
  for (const r of recent) {
    if (W.isTitleCase(r.title.split(/\s+/))) continue;
    for (const run of TN.nameRuns(r.title)) {
      const ws = run.split(' ');
      while (ws.length && TN.ROLE.has(ws[0])) ws.shift();
      const n = ws.join(' ');
      if (ws.length < 2 || ws.some((w) => subj.includes(w)) || R.isPlaceOrTeam(n) || older.has(n) || ws.every((w) => older.has(w))) continue;
      names.add(n);
    }
  }
  // (the new name is the one making it: "Gorgeous Doll alleges ...", "Gorgeous Doll's allegations", "claims made by Gorgeous Doll" in two
  // outlets; someone who defends, backs or reacts to the subject makes no claim: "Kevin Hart defends Kai Cenat amid allegations")
  const best = [...names].map((n) => ({ n, rows: recent.filter((r) => mentions(hay(r.title), n)) }))
    .filter((x) => new Set(x.rows.filter((r) => !CLAIM_CHAPTER.has(family.key) || makesClaim(r.title, x.n)).map((r) => outletKey(r.outlet))).size >= 2)
    .sort((a, b) => b.rows.length - a.rows.length || a.n.localeCompare(b.n))[0];
  if (!best) return null;
  // (who the new name is, as the lines call them: "TikToker")
  const roles = best.rows.map((r) => (hay(r.title).match(new RegExp(` (\\S+) ${best.n} `)) || [])[1]).filter((w) => w && TN.ROLE.has(w));
  return { name: best.n, rows: best.rows, role: roles[0] || null, surface: TN.nameSurface(best.n, best.rows.map((r) => r.title)) };
}
/**
 * Whether a headline has a name making a claim: the name right before a claiming verb ("alleges", "accuses", "claims", "sues", "files",
 * "comes forward", "makes allegations"), owning one ("X's allegations") or named as its maker ("claims made by X").
 */
function makesClaim(title, name) {
  const n = name.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+');
  const made = '(?:alleges|accuses|claims|sues|files|filed|comes forward|came forward|speaks out against|(?:alleged|accused|claimed|sued)(?! of\\b| by\\b)|(?:makes?|made|levels?|levell?ed|details?|shares?) (?:\\S+ ){0,2}(?:allegations?|claims?|accusations?))';
  return new RegExp(`(?<![\\p{L}\\p{N}])${n}[”"’']?,? (?:\\S+ ){0,1}${made}(?![\\p{L}\\p{N}])`, 'iu').test(title) ||
    new RegExp(`(?<![\\p{L}\\p{N}])${n}[’']s? (?:\\S+ ){0,2}(?:allegations?|claims?|accusations?|lawsuit|suit|complaint)(?![\\p{L}\\p{N}])`, 'iu').test(title) ||
    new RegExp(`(?:allegations?|claims?|accusations?|lawsuit|suit|complaint) (?:made |filed |brought |levell?ed )?(?:by|from) (?:\\S+ ){0,2}${n}(?![\\p{L}\\p{N}])`, 'iu').test(title);
}
// families whose new chapter is a new claim: the newcomer must be the one making it
const CLAIM_CHAPTER = new Set(['allegations', 'lawsuit', 'threats', 'rumors', 'attack', 'stabbing', 'fight', 'leak', 'scam']);
const ROLE_SURFACE = { tiktoker: 'TikToker', youtuber: 'YouTuber', streamer: 'streamer', rapper: 'rapper', singer: 'singer', model: 'model', influencer: 'influencer',
  actress: 'actress', actor: 'actor', creator: 'creator' };
/**
 * A claim's line with its new chapter joined on as a clause, one sentence still: told without the new name (the card is the first
 * claim's: "..., as a TikToker makes claims too."), named once three or more of the last two days' headlines lead with her ("..., as
 * TikToker Gorgeous Doll makes claims too."); the unnamed clause when the named one runs past CHAPTER_LINE_MAX characters, none when
 * that does too.
 */
function withChapter(told, chapter) {
  const role = chapter.role && ROLE_SURFACE[chapter.role];
  const base = told.replace(/[.!]+(['’"”]?)$/, '$1');
  const named = chapter.rows.length >= CHAPTER_NAMED ? `${base}, as ${role ? `${role} ` : ''}${chapter.surface} makes claims too.` : null;
  const plain = `${base}, as ${role ? `a ${role}` : 'someone new'} makes claims too.`;
  return named && named.length <= CHAPTER_LINE_MAX ? named : plain.length <= CHAPTER_LINE_MAX ? plain : told;
}
/**
 * A new chapter's own line: the best reported headline of the last two days that names the newcomer and the subject ("TikToker
 * Gorgeous Doll alleges Kai Cenat paid her $200K ..."), with the first chapter's denial kept as a clause when the card's line carried
 * one ("..., days after Kai Cenat denied earlier allegations."); null when no headline tells it in reported wording or it runs long.
 */
function chapterLine(chapter, subject, surface, f, lex, now, traced, told) {
  if (chapter.rows.length < CHAPTER_NAMED) return null;
  const own = TN.whatOf(chapter.rows, subject, f, now, lex, chapter.name.split(' '), { now });
  if (!own.what || own.unsaid || !mentions(hay(own.what), chapter.name.split(' ').slice(-1)[0])) return null;
  const line = TL.tidyLine(TN.recaseName(TN.recaseName(own.what, subject, surface), chapter.name, chapter.surface)).replace(/;[^;]*$/, '').replace(/[.!]+(['’"”]?)$/, '$1');
  const denied = traced.denied || TN.DENIAL.test(told);
  // (the subject by surname the second time: "..., days after Cenat denied earlier allegations")
  const again = subject.includes(' ') && surface.includes(' ') ? surface.split(' ').slice(-1)[0] : surface;
  const out = denied ? `${line}, days after ${again} denied earlier allegations.` : `${line}.`;
  return out.length <= CHAPTER_OWN_MAX ? out : null;
}
const CHAPTER_OWN_MAX = 190;
/**
 * The words of a card about money lost to a fraud: the subject, the kind of fraud its line names right before the noun ("an alleged
 * investment fraud", "a crypto scam") and the noun; null when the line does not say the subject lost, or names no kind.
 */
function lostTo(line, subject, noun) {
  const last = subject.split(' ').slice(-1)[0];
  if (!LOST_MONEY.test(line) || !mentions(hay(line), last)) return null;
  const m = line.match(/([\p{L}-]+)\s+(?:fraud|scam|scheme)\b/iu);
  const kind = m ? m[1].toLowerCase() : null;
  if (!kind || W.STOP.has(kind) || LOST_STOP.has(kind) || subject.split(' ').includes(kind)) return null;
  return [...subject.split(' '), kind, ...words(noun.noun || '')];
}
/** The sum a line says was lost, printed short: "$250,000" -> "$250K", "$1.5 million" -> "$1.5M"; null when it names none. */
function lostSum(line) {
  const m = String(line || '').match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|thousand|million|billion)?\b/i);
  if (!m) return null;
  const unit = (m[2] || '').toLowerCase();
  const n = Number(m[1].replace(/,/g, '')) * (unit === 'k' || unit === 'thousand' ? 1e3 : unit === 'm' || unit === 'million' ? 1e6 : unit === 'billion' ? 1e9 : 1);
  if (!Number.isFinite(n) || n < 1000) return null;
  const short = (v) => String(Math.round(v * 10) / 10);
  return n >= 1e9 ? `$${short(n / 1e9)}B` : n >= 1e6 ? `$${short(n / 1e6)}M` : `$${short(n / 1e3)}K`;
}
const LOST_MONEY = /\b(?:lost|loses|losing|scammed out of|was scammed|got scammed|defrauded of|duped|conned|victim)\b/i;
const LOST_STOP = new Set(['alleged', 'apparent', 'massive', 'huge', 'major', 'big', 'elaborate', 'suspected', 'reported', 'possible', 'same', 'new', 'latest', 'online', 'ponzi']);
const CHAPTER_LINE_MAX = 140;
const CHAPTER_NAMED = 3;
const CHAPTER_AFTER_DAYS = 2.5;
const ADMITTED = /\b(?:confirms?|admits?|removed|dropped|fired|apologi[sz]es|suspended|cuts? ties|parts? ways|steps? down|resigns?)\b/i;
const ADMISSION_DAYS = 3;
/**
 * A claim the subject has admitted: ADMISSION_SOURCES rows of any kind (an outlet's, a blocked one's, a post's) say the subject
 * admits or confirms it, the verb right after the name and the claim in the same line, and an outlet that may word a line says so in
 * a sentence: that line, or null.
 */
function admittedLine(ev, subject, surface, f, lex, now) {
  const last = subject.split(' ').slice(-1)[0];
  // (the claim itself, said in the same line: "... admits to assault ... in wake of allegations", never "confirms engagement")
  const says = (r) => { const ws = words(r.title); const at = ws.indexOf(last); return at >= 0 && f.re.test(r.title) && ws.slice(at + 1, at + 1 + CONFESSED_NEAR).some((w) => CONFESSED.test(w)); };
  const rows = ev.rows.filter(says);
  if (rows.length < ADMISSION_SOURCES) return null;
  const own = TN.whatOf(rows.filter((r) => !r.blocked && !r.youtube && r.fam !== 'reddit'), subject, null, now, lex, [], { now });
  if (!own.what || !says({ title: own.what })) return null;
  return { what: TL.tidyLine(TN.recaseName(own.what, subject, surface)), trace: own.trace };
}
/**
 * What followed a death the list has carried for days: the last AFTERMATH_DAYS' headlines that name the subject and tell something
 * "after" the death, when AFTERMATH_OUTLETS outlets' share one plain word (a petition, a lawsuit, a vigil): the best of those lines
 * ("Gypsy Rose Blanchard launches petition to combat 'harassment and cyberbullying' after partner Ken Urker's death"), or null. Never
 * in a death's first AFTERMATH_AFTER_DAYS: the news is still the death.
 */
function aftermathLine(ev, subject, f, lex, now) {
  const last = subject.split(' ').slice(-1)[0];
  const said = ev.press.filter((r) => !r.youtube && f.re.test(r.title) && mentions(hay(r.title), last));
  if (!said.length || now - Math.min(...said.map((r) => r.t)) < AFTERMATH_AFTER_DAYS * DAY) return null;
  const recent = said.filter((r) => !r.blocked && now - r.t < AFTERMATH_DAYS * DAY && AFTER_IT.test(r.title));
  // (the names its headlines print are no topic: "Gypsy", "Rose")
  const named = new Set(ev.rows.filter((r) => !W.isTitleCase(r.title.split(/\s+/))).flatMap((r) => TN.nameRuns(r.title).flatMap((n) => n.split(' '))));
  const outlets = new Map();
  for (const r of recent) {
    for (const w of new Set(words(r.title))) {
      if (w.length < AFTERMATH_WORD || W.STOP.has(w) || !W.inDict(w) || W.isFirstName(w) || named.has(w) || f.re.test(w)) continue;
      outlets.set(w, (outlets.get(w) || new Set()).add(outletKey(r.outlet)));
    }
  }
  const topic = [...outlets.entries()].map(([w, o]) => ({ w, n: o.size })).filter((x) => x.n >= AFTERMATH_OUTLETS).sort((a, b) => b.n - a.n || a.w.localeCompare(b.w))[0];
  if (!topic) return null;
  const topical = recent.filter((r) => words(r.title).includes(topic.w));
  // (a Title Case headline with a word nobody can tell from a name is passed over while another tells it: "... To Stop Cyberbullying")
  const known = (w) => W.inDict(w) || W.STOP.has(w) || W.isFirstName(w) || named.has(w) || /^\d/.test(w);
  const plain = topical.filter((r) => !W.isTitleCase(r.title.split(/\s+/)) || words(r.title).every(known));
  const own = TN.whatOf(plain.length ? plain : topical, subject, f, now, lex, [topic.w], { now });
  if (!own.what || own.unsaid || !mentions(hay(own.what), last) || !words(own.what).includes(topic.w)) return null;
  // (a quote after "to" carries the sentence on, no capital: "launches petition to 'fight online harassment'")
  const what = own.what.replace(QUOTED_TO, (m, a, b, c) => (W.inDict(`${b}${c}`.toLowerCase()) ? `${a}${b.toLowerCase()}${c}` : m));
  return { what, trace: own.trace };
}
const QUOTED_TO = /(\bto\s+[‘'“"])(\p{Lu})(\p{Ll}+)/u;
const AFTERMATH_AFTER_DAYS = 3;
const AFTERMATH_DAYS = 3;
const AFTERMATH_OUTLETS = 3;
const AFTERMATH_WORD = 6;
const AFTER_IT = /\b(?:after|following|in (?:the )?wake of)\b/i;
const CONFESSED = /^(?:admits?|admitted|confirms?|confirmed|confess(?:es|ed)?)$/;
const CONFESSED_NEAR = 2;
const ADMISSION_SOURCES = 2;
/** A claim's newest fallout: a sentence-case line of the last three days naming the subject with an admission, a removal or an apology. */
function admissionOf(ev, subject, f, trace, now) {
  if (!f || f.key !== 'allegations') return null;
  const last = subject.split(' ').slice(-1)[0];
  const used = new Set((trace || []).map((x) => x.text));
  return ev.press.filter((r) => !r.blocked && !r.youtube && now - r.t < ADMISSION_DAYS * DAY && !used.has(r.title) && mentions(hay(r.title), last) &&
    ADMITTED.test(r.title) && !W.isTitleCase(r.title.split(/\s+/)) && !/\?/.test(r.title)).sort((a, b) => b.t - a.t)[0] || null;
}
const STORY_OWN_MAX = 5;
const SAID_TITLED = new Set(['backlash', 'remarks']);
// (a line of such a card says the comments or the backlash)
const SAID_LINE = /\b(?:comments?|remarks?|backlash|slammed|blasted|criticism|criticized|criticised|outrage|under fire|controvers\w*)\b/i;
const FIGHT_SPORT = /\b(?:ufc|mma|pfl|bellator|boxing|boxer|bout|octagon|title fight|fight card|fight night|main event|weigh-ins?|knockouts?|ko|fights|fighter|fighters|contract|wwe|wrestlemania|vs\.?)\b/i;
const APOLOGY_REFUSED = /\b(?:won['’]t|will not|doesn['’]t|does not|didn['’]t|did not|not|never|no|refus\w+|declin\w+)\b(?:\s+\S+){0,4}\s+['‘"“]?(?:need to |have to )?apolog/i;
const WAVE_DAYS = 3;
const WAVE_SEARCH_MAX = 50000;
// (the wave's noun stands right by the name: "Chris Brown accused of ...", never "Chris Rock ... for wrongfully accused friend's brother")
const WAVE_NEAR = 6;
const WAVE_MIN = 2;
// (Google News prints a creator's upload under either name: "YouTube", "youtu.be")
// (Collector only: a clip on Twitch's or Kick's chart of the day is creator-native too: it counts, it never words a line)
const YOUTUBE_OUTLET = /^(?:youtube|youtu\.be|(?:www\.|m\.)?youtube\.com|twitch|kick)$/i;

// ---------- who: the tier and the drama flag the one list leads by ----------
/**
 * Who a card is about, for the one list's order (IDEAS-SPEC "Top 20": people-drama leads, creators first, then musicians and
 * celebrities, politics and sport only when huge): { person, tier: creator | celebrity | politics | sports | other }.
 *   creator    a streamer, a YouTuber, a TikToker, an influencer: the roster lists it (Wikipedia's categories), its headlines call it one (a role word in CREATOR_SHARE of the
 *              headlines naming it, two at least), the week's top of r/LivestreamFail or r/youtubedrama names it, its searches
 *              pair it with a platform ("kai cenat twitch"), the drama headlines gave it a role; or the platform itself ("Twitch")
 *   sports     a sports search, a sports card, an athlete's page, or coverage of games and seasons
 *   politics   a politics search that is no entertainment search, or headlines that give the name an office
 *   celebrity  any other person: a given name first, a role word before the name in two headlines ("rapper Lucki"), a performer's page
 */
function whoOf(c, ev, subject, kind, lex, roster = null) {
  const last = subject.split(' ').slice(-1)[0];
  const own = ev.rows.filter((r) => mentions(hay(r.title), last));
  const count = (re) => own.filter((r) => re.test(r.title)).length;
  // (called a creator: the role word beside the name, never someone else's in the same headline)
  const called = own.filter((r) => TC.calledCreator(r.title, subject) || (subject.includes(' ') && TC.calledCreator(r.title, last))).length;
  // (a rapper is a musician here: the creators' tier is the platforms' own people)
  // (or the roster lists it: Wikipedia's own streamers, YouTubers and TikTokers)
  const listed = !!roster && (roster.has(subject) || roster.has(c.key));
  // (and a company's or its boss's dispute is business news, weighed like politics: "Sam Altman splits with Anthropic over AI regulation")
  const business = own.length >= 4 && count(BUSINESS) >= OFFICE_SHARE * own.length;
  // (a company is no creator, whichever board argues about it: "OpenAI safety leader quits ..." is business news)
  const corporate = business && !listed && !TN.personLike(subject, lex);
  const creator = !corporate && (TC.CREATOR_ROLE.test(subject) || ev.creatorSub || !!c.creator || c.related.some((q) => TC.CREATOR_ROLE.test(q)) || listed ||
    (called >= CREATOR_CALLED_MIN && called >= CREATOR_SHARE * own.length));
  const first = subject.split(' ')[0];
  const roleLed = own.filter((r) => { const ws = words(r.title); const at = ws.indexOf(first); return at > 0 && TN.ROLE.has(ws[at - 1]); }).length >= ROLE_LED_MIN;
  // (a person, never an institution or a case the lexicon lists like a name: "Cornell 7", "Madonna University", "RAF Fairford incident")
  // (nor a search that ends with what was done: "asos hacked" is no name)
  const person = !corporate && !NOT_A_PERSON.test(subject) && !R.isPlaceOrTeam(subject) && !(subject.includes(' ') && TC.PERSON_VERB.test(last)) && (TN.personLike(subject, lex) || roleLed || (subject.includes(' ') && TC.HONORIFIC.has(first)) ||
    c.wiki.some((w) => PERFORMER.test(w.desc || '') || R.ATHLETE.test(w.desc || '')) || (creator && !TC.CREATOR_ROLE.test(subject)));
  const cats = c.trends.map((t) => t.cats || []).sort((a, b) => b.length - a.length)[0] || [];
  const sporty = own.filter((r) => SPORTS_WORDS.test(r.title) || SPORT_TIER.test(r.title) || R.TEAM_RE.test(r.title) || R.GAME_RE.test(r.title)).length;
  const sports = kind === 'sports' || c.sports || c.wiki.some((w) => R.ATHLETE.test(w.desc || '')) || (own.length >= 10 && sporty >= SPORTSY_SHARE * own.length);
  const politics = (cats.includes(POLITICS_CAT) && !cats.includes(ENTERTAINMENT_CAT)) || (own.length >= 4 && count(OFFICE) >= OFFICE_SHARE * own.length);
  // (a royal's affairs are the state's: weighed like politics, "Prince Andrew lawsuit")
  const royal = ROYAL.test(subject);
  const tier = creator ? 'creator' : sports ? 'sports' : politics || business || royal ? 'politics' : person ? 'celebrity' : 'other';
  return { person, tier };
}
const CREATOR_CALLED_MIN = 2;
const ROYAL = /^(?:prince|princess|king|queen|duke|duchess) \S/;
const NOT_A_PERSON = /\d|\b(?:university|college|school|academy|institute|incident|police|department|airlines?|airways|airport|church|court|company|corp|inc|group|foundation|council|committee|association|league|club|fc|united|city|county|state|base|raf|hospital|festival|awards?|election|recall|movie|film|show|series|protests?|riots?)\b/;
const CREATOR_SHARE = 0.15;
const ROLE_LED_MIN = 2;
const POLITICS_CAT = 14;
const ENTERTAINMENT_CAT = 4;
const OFFICE = /\b(?:president|vice president|senator|sen\.|rep\.|congressman|congresswoman|governor|gov\.|mayor|minister|prime minister|chancellor|secretary|attorney general|lawmaker|candidate|mp|fbi director|white house|parliament|campaign)\b/i;
const OFFICE_SHARE = 0.4;
const SPORT_TIER = /\b(?:tennis|atp|wta|grand slam|semi-?finals?|quarter-?finals?|tournament|championship|ufc|mma|boxing|f1|grand prix|pga|golf|olympics?|medal|world cup|preseason|postseason|match|striker|goalkeeper|pitcher|wrestler|wwe|aew)\b/i;
const BUSINESS = /\b(?:ceo|openai|anthropic|startup|shareholders?|investors?|stock|shares|antitrust|merger|acquisition|ipo|regulation|regulators?|earnings|layoffs?|billion)\b/i;

// ---------- 6 heat ----------
/**
 * The heat: demand, the way a creator chasing views weighs it. The search people typed leads, and the creator-side signals weigh as
 * much: creators already uploading about it (count and share of its coverage), a top post of the week where creators' drama is argued
 * or explained (r/LivestreamFail, r/youtubedrama, r/OutOfTheLoop), two sides to take (a claim and a denial), a subject from creators'
 * own world, Wikipedia read on and on, fresh YouTube completions; the press counts by its busiest day (a search returns 100 at most,
 * so the outlet count saturates). Times recency (full for two days past the coverage peak, halving every six to day four, then every
 * two and a half; full again while a new chapter lands or coverage keeps coming), and down for a death, tribute or trial nobody is
 * arguing about (no uploads, no thread, no denial: listed, never filtered).
 */
function heatOf(c, ev, noun, now, extra = {}) {
  // (a politics, business or weather search is weighed as its category is: the same 100K says less there)
  const cats = c.trends.map((t) => t.cats || []).sort((a, b) => b.length - a.length)[0] || [];
  // (a person whose page is read 10x is a person story whatever the search's category: "shivon zilis", a business search)
  const catW = c.trends.length && !c.sports ? Math.max(CAT_FLOOR, catWeight(cats), c.wikiTop ? WIKI_TOP_CAT : 0) : 1;
  // (two dozen outlets or more in a week is people reading it, searched or not: "Nathan Fielder Elizabeth Holmes doc", "Chris Hansen")
  // (never as much as a real search, and only when the headlines lead with the name: a name in other stories' asides is not read for itself)
  const leadWs = extra.leadWords || [];
  const leads = leadWs.length ? ev.press.filter((r) => words(r.title).slice(0, LEAD_WORDS).some((w) => leadWs.includes(w))).length / Math.max(1, ev.press.length) : 1;
  // (and for a search that only started today, still behind its press: "andrew mountbatten-windsor", 20K in Britain and 65 outlets)
  const newSearch = c.trends.length > 0 && c.trends.every((t) => now - t.start < DAY);
  // (a name the drama headlines gave is read for its story, by the outlets that tell it: a name in the news every day lends a
  // two-outlet story nothing, "Meghan Markle criticised over bizarre pub food order" in 2 of her week's 51 outlets; a story two in
  // three of a day's outlets tell is read like a search of its own, "Halle Berry allegations" in 49)
  const told = extra.own ? extra.own.outlets : ev.outlets;
  const read = (!c.trends.length || newSearch) && told >= PRESS_DEMAND_OUTLETS && leads >= READ_LEAD_SHARE ?
    Math.min(extra.own ? READ_OWN_CAP : READ_CAP, (extra.own ? READ_OWN_W : PRESS_DEMAND_W) * Math.log2(told / BURST_MIN_OUTLETS)) : 0;
  // (a long news query about someone nobody searches by name, "greg lui doj charges", is a case, not a name people follow; a name its
  // own searches type on their own is followed: "lanterns finale" under "lanterns finale hal jordan")
  const longTail = c.rests.length && !c.trends.some((t) => keyOf(t.keyword) === c.key || t.related.some((q) => keyOf(q) === c.key)) && !c.wiki.length &&
    !c.reddit.length ? LONG_TAIL_MULT : 1;
  // (and a page read half again its week's low in the last two days is people looking it up, searched or not: "Avengers: Endgame" and
  // the list it tops, 60K -> 142K a day; a page read on and on is counted below, never twice)
  const curve0 = extra.curve || null;
  const looked = !c.trends.length && !c.parent && curve0 && !curve0.sustained && curve0.recent >= WIKI_LOOKUP_MIN && curve0.recent >= WIKI_LOOKUP_SPIKE * curve0.low ?
    WIKI_LOOKUP_W * (Math.log10(curve0.recent) - 3) : 0;
  // (and a name Google's list never carried that the drama headlines name and people only lately type into YouTube: a creators'-world
  // story's demand, "mikayla nogueira jay shetty" typed eight ways; never as much as a 50K search)
  const typed = !c.trends.length && !c.parent && (c.drama || ev.creatorSub) ?
    Math.min(TYPED_CAP, TYPED_W * Math.log2(1 + (c.drama || 0) + ev.completions.filter((x) => x.fresh).length)) : 0;
  const search = Math.max(catW * longTail * searchScore(c.trends), (c.parentFull ? 1 : 0.5) * (c.parentSearch || 0), read, looked, typed);
  // (every outlet counts: a story in 60 outlets is wider than one in 24)
  const press = PRESS_W * (Math.log2(1 + ev.outlets) + Math.log2(1 + ev.peakCount));
  // creators already posting about it: a reaction or explainer video is proven
  const creators = CREATORS_W * (Math.log2(1 + ev.youtube) + YT_SHARE_W * Math.min(YT_SHARE_CAP, ev.ytShare));
  const week = ev.redditWeek < 3 ? 2 : ev.redditWeek < 10 ? 1.5 : ev.redditWeek < REDDIT_WEEK_RANK ? 1 : ev.redditWeek < DRAMA_WEEK_RANK ? 0.5 : 0;
  const day = ev.redditBest < 3 ? 1 : ev.redditBest < REDDIT_TOP_RANK ? 0.6 : ev.redditBest < 25 ? 0.3 : 0;
  const reddit = Math.max(week, day) + (ev.redditSubs >= 2 ? 0.3 : 0);
  // (its page in the daily top 1000 too, read in the last two days: "Avengers: Endgame" and the list it tops, "Lanterns" on finale day)
  const curve = extra.curve || null;
  const wikiViews = Math.max(0, ...c.wiki.map((w) => w.views), c.wikiDaily || 0, curve ? curve.recent : 0);
  const sustained = c.sustained || (!!curve && curve.sustained);
  const daily = Math.max(c.wikiDaily || 0, curve && curve.sustained ? curve.last : 0);
  // (read on and on, 100K+ a day, is demand like a search: "Ted Kaczynski" for Netflix's 'Unabomber')
  const wiki = (wikiViews >= 50000 ? 0.6 * Math.min(1.5, Math.log10(wikiViews / 20000)) : 0) +
    (sustained ? WIKI_SUSTAINED_W * Math.max(0, Math.log10(Math.max(daily, WIKI_SUSTAIN_VIEWS) / 10000)) : 0);
  const fresh = noun && noun.f && ev.completions.some((x) => x.fresh && noun.f.re.test(x.q)) ? 0.4 : 0;
  const dispute = extra.denied ? DISPUTE_BONUS : 0;
  // (or someone the roster, the creators' beat or the headlines call a creator)
  const native = ev.creatorSub || !!c.creator || c.related.some((q) => CREATOR_REL.test(q)) ? NATIVE_BONUS : 0;
  const asked = search >= AUDIENCE_SEARCH || ev.youtube >= AUDIENCE_UPLOADS || reddit > 0 || wiki > 0 || fresh > 0 || dispute > 0 || native > 0 ||
    (!!extra.own && extra.own.outlets >= OWN_ASKED_OUTLETS);
  const demand = SEARCH_W * search + (asked ? 1 : PRESS_ONLY_MULT) * press + creators + reddit + wiki + fresh + dispute + native;
  const age = Math.max(0, (now - ev.peakT) / DAY - RECENCY_GRACE_DAYS);
  const steep = Math.max(0, age - (RECENCY_STEEP_AFTER - RECENCY_GRACE_DAYS));
  const live = c.trends.some((t) => t.end === null || (t.end ?? 0) >= now - DAY);
  let recency = Math.max(RECENCY_FLOOR, Math.pow(0.5, (age - steep) / RECENCY_HALF_LIFE_DAYS + steep / RECENCY_STEEP_HALF_LIFE) * (live ? 1 : 0.85));
  // (still going: a new chapter, or the last two days still a third of its busiest day)
  if (extra.chapter) recency = Math.max(recency, 1);
  // (creators still uploading about it: three or more uploads in the last three days)
  else if (ev.press.filter((r) => r.youtube && now - r.t < 3 * DAY).length >= CREATORS_STILL) recency = Math.max(recency, CREATORS_RECENCY);
  // (read on and on in Wikipedia this week: a Netflix hit is still being watched)
  else if (sustained) recency = Math.max(recency, SUSTAINED_RECENCY);
  else if (ongoing(ev, noun, now)) recency = Math.max(recency, ONGOING_RECENCY);
  // (the week's people-drama is still a talking point while it is still told: headlines or creators' uploads in the last three days)
  if (extra.still) recency = Math.max(recency, STILL_RECENCY);
  // (a film or show searched as such is the talking point itself, as a work is: "Verity movie")
  const nounMult = extra.work || extra.screen ? 1 : !noun || !noun.f ? NO_NOUN_MULT : noun.f.key === 'response' ? RESPONSE_MULT : 1;
  // a death, a tribute or a trial with no uploads, no thread and no denial: nothing to argue about
  // (a million searches is a talking point whatever its noun: "Ken Urker death" under "gypsy rose")
  const volume = Math.max(0, ...c.trends.map((t) => t.volume));
  // (nor one read by 150K+ a day in Wikipedia, or still trending: "Sass Jordan death", 224K views and live in two countries)
  const liveNow = c.trends.some((t) => t.end === null);
  // (Reddit's posts paying respects are no argument: only creators' uploads or a denial are)
  const grave = noun && noun.f && (GRAVE_NOUNS.has(noun.f.key) || GRAVE_NOUNS.has(noun.noun)) && ev.youtube < 3 &&
    !extra.denied && volume < GRAVE_EXEMPT_VOLUME ? (wikiViews >= GRAVE_EXEMPT_WIKI || liveNow ? GRAVE_READ_MULT : GRAVE_MULT) : 1;
  // a story only one region's press carries (the outlets the moments block: India's, Pakistan's, Bangladesh's) and no big search in
  // the audience's country ("My audience": the US by default)
  const blocked = ev.press.filter((r) => r.blocked).length;
  const home = homeGeos(extra.audience);
  const usVolume = Math.max(0, ...c.trends.filter((t) => home.includes(t.geo)).map((t) => t.volume));
  // (with no search in the US, Britain or Australia, a third of it from those outlets is enough: "Nivin Pauly box office")
  const share = c.trends.length || c.parent ? REGIONAL_SHARE : REGIONAL_SHARE_UNSEARCHED;
  // (never a creators'-world story: the outlets that write up every streamer's week are among the blocked ones)
  const creatorsWorld = ev.creatorSub || c.related.some((q) => CREATOR_REL.test(q)) || ev.press.filter((r) => TC.CREATOR_PRESS.test(r.outlet || '')).length >= CREATOR_PRESS_MIN;
  // (and a name only the drama headlines gave, that no outlet the audience reads, no creators' subreddit and no upload carries, is
  // another region's story whatever its outlets are called: "Surat influencer Simran Patel arrested ...")
  const unknownAtHome = c.from === 'drama' && !creatorsWorld && ev.youtube === 0 && !ev.press.some((r) => !r.blocked && (R.ENT_PUBLISHER.test(r.outlet || '') || TN.MAJOR.test(r.outlet || '')));
  const regional = (ev.press.length >= 5 && blocked >= share * ev.press.length && usVolume < 50000 && !creatorsWorld) || unknownAtHome ? REGIONAL_MULT : 1;
  // British and Irish press only, and no search at home: regional to an audience outside Britain (the moments sink these too)
  const named = ev.press.filter((r) => !r.blocked && !r.youtube && !R.REHOST.test(r.outlet || ''));
  const uk = named.filter((r) => R.UK_OUTLET.test(r.outlet || '')).length;
  const ukOnly = !home.includes('GB') && named.length >= 4 && uk >= UK_SHARE * named.length && usVolume < 20000 ? UK_MULT : 1;
  // searched only outside the audience's country: a British or Australian story to a US audience
  const usTrend = c.trends.some((t) => home.includes(t.geo) && t.volume >= 10000);
  // (a small search at home and a smaller one or none anywhere else is no story from abroad: "andrew tate", 5K in the US and 200 in
  // Britain the morning it breaks)
  const awayVolume = Math.max(0, ...c.trends.filter((t) => !home.includes(t.geo)).map((t) => t.volume));
  const abroad = awayVolume > usVolume && !usTrend ? ABROAD_MULT : 1;
  // what people argue about over what they only note: a claim, an arrest, a fight, a split before an engagement, a finale or a weekend's
  // takings (the benchmark's talking points are drama first)
  // (a relationship revealed, an affair confessed, an engagement announced is talked about like news, not noted: "Michael Douglas
  // affair", "Kash Patel engagement"; a dating rumour or a romance stays soft)
  // (a show titled as searched because no line told its facet weighs as that facet did: "East of Eden")
  const talk = noun && noun.f ? (CLAIM_DRAMA.has(noun.f.key) ? CLAIM_MULT : DRAMA.has(noun.f.key) && !ONE_SIDED.has(noun.noun) ? DRAMA_MULT : CLIP.has(noun.f.key) ? CLIP_MULT :
    REVEALED.has(noun.noun) || EVENT_NOUNS.has(noun.noun) ? 1 : SOFT.has(noun.f.key) ? SOFT_MULT : 1) : extra.soft ? SOFT_MULT : 1;
  // (something said or done that its own line says was answered: "Gillian Anderson explains confrontation ..."; never a claim, whose
  // denial is the other side of an open question)
  const answered = extra.answered && noun && noun.f && !CLAIM_DRAMA.has(noun.f.key) ? ANSWERED_MULT : 1;
  // the press's momentum: still climbing, decaying, or back at its baseline
  const m0 = extra.momentum || { rise: 1, decay: 1, stale: false };
  const m = usVolume < LIVE_SEARCH_VOLUME ? { ...m0, rise: Math.min(m0.rise, RISE_CAP_SMALL) } : m0;
  const stale = m.stale && !extra.still;
  const momentum = m.rise * m.decay * (stale ? STALE_MULT : 1);
  // what people are typing right now, at home: a big search still trending
  // (its own, and the ones that say more after its name: "lanterns finale hal jordan", "lanterns season 2" for "Lanterns finale")
  const liveBig = [...c.trends.filter((t) => t.end === null && t.volume >= LIVE_SEARCH_VOLUME).map((t) => ({ geo: t.geo, start: t.start })),
    ...(extra.live || []).filter((t) => t.key.startsWith(`${c.key} `))].filter((t) => home.includes(t.geo));
  const liveSearch = !liveBig.length ? 1 : liveBig.some((t) => now - t.start < LIVE_SEARCH_DAYS * DAY) ? LIVE_SEARCH_MULT : LIVE_LONG_MULT;
  return { score: demand * recency * nounMult * grave * regional * ukOnly * abroad * talk * answered * momentum * liveSearch,
    parts: { search, press: (asked ? 1 : PRESS_ONLY_MULT) * press, creators, reddit, wiki, fresh, dispute, native, recency, grave, regional: regional * ukOnly * abroad, talk: talk * answered, rise: m.rise, decay: m.decay,
      stale: stale ? STALE_MULT : 1, longTail, live: liveSearch } };
}

/**
 * Still going: the last two days' titles that say the card's noun (uploads included) are a third of its busiest day's, five or more
 * ("Olivia Rodrigo" is in the news every day; her dress is not).
 */
function ongoing(ev, noun, now) {
  // (a noun too sparse to follow, "Chris Hansen Primetime feud" in 5 titles, follows the name)
  const says = (r) => !noun || !noun.f || noun.count < ONGOING_NOUN_MIN || noun.f.re.test(r.title);
  const recent = ev.press.filter((r) => now - r.t < 2 * DAY && says(r)).length;
  const byDay = new Map();
  for (const r of ev.press) if (says(r)) { const d = Math.floor(r.t / DAY); byDay.set(d, (byDay.get(d) || 0) + 1); }
  const peak = Math.max(0, ...byDay.values());
  return recent >= ONGOING_MIN && recent >= ONGOING_SHARE * peak;
}
const ONGOING_MIN = 5;
const ONGOING_NOUN_MIN = 8;

/**
 * rising: growing right now, never a story days old that is only still talked about ("Michael Douglas affair" four days on is peaking):
 * a new chapter, a search that began in the last day and a half and still trends, a story under two days old whose last 24 hours beat
 * the 24 before, or the press's last 24 hours at twice the three days before; peak: the busiest day is within a day and a half, or the
 * coverage of its noun is still coming at a third of that day's; fading.
 */
const RISING_TREND_DAYS = 1.5;
const RISING_STORY_DAYS = 2;
function statusOf(c, ev, now, chapter, noun, momentum = null, still = false) {
  const inRange = (a, b) => ev.press.filter((r) => now - r.t >= a * DAY && now - r.t < b * DAY).length;
  const last = inRange(0, 1);
  const before = inRange(1, 2);
  const freshTrend = c.trends.some((t) => t.end === null && now - t.start < RISING_TREND_DAYS * DAY);
  const young = now - ev.firstT < RISING_STORY_DAYS * DAY && last > before && last >= 3;
  // (the last 24 hours twice the days before: climbing; back at its baseline: fading, whatever its busiest day)
  if (chapter || freshTrend || young || (momentum && momentum.rise >= 1 + RISE_W)) return 'rising';
  // (a people-drama story still told is at its peak however old: it sinks by its heat, it is not on its way out)
  if (still) return 'peak';
  if (momentum && momentum.stale) return 'fading';
  // (a search still trending is no fading story)
  if (now - ev.peakT <= 1.5 * DAY || ongoing(ev, noun, now) || c.trends.some((t) => t.end === null)) return 'peak';
  return 'fading';
}

// ---------- 3-5 noun, title, what ----------
/** A trend that is a film or show itself, not a person: Wikipedia calls it one, or its own searches pair it with a platform or its cast ("east of eden netflix cast"). */
const SCREEN_REL = /\b(?:netflix|hbo|hulu|prime video|disney|apple tv|peacock|cast|episode|episodes|season|trailer|series|movie|film)\b/;
// (queries: its related searches and the YouTube completions people type after it)
const screenWork = (c, lex, queries) => c.trends.length > 0 && !TN.personLike(c.key, lex) && (c.wiki.some((w) => /\b(?:film|television|series|miniseries)\b/i.test(w.desc || '')) ||
  queries.filter((q) => contains(q, c.key) && SCREEN_REL.test(q)).length >= SCREEN_REL_MIN);
const SCREEN_REL_MIN = 2;
function kindOf(c, noun, screen = false) {
  const k = noun && noun.f ? noun.f.key : '';
  if (c.sports) return 'sports';
  if (c.cats.has(6)) return 'game';
  if (['ending', 'boxoffice', 'flop', 'trailer', 'pause'].includes(k) || /\b(?:movie|film|show|series|season)\b/.test(c.key) ||
    c.wiki.some((w) => /\b(?:film|television|series|miniseries)\b/i.test(w.desc || '')) || screen) return 'show';
  if (k === 'performance' || c.related.some((q) => /\b(?:song|lyrics|album)\b/.test(q))) return 'music';
  return 'story';
}

/** People named in the trend's related queries and fresh completions, or in a third of its titles: who else the noun may be about. */
const EVENT_WORD = /(?:con|fest|festival|cup|bowl|awards|week|games|expo|summit)$/;
// (a venue is no person, whatever given name it opens with: "Gillette Stadium", "Madison Square Garden")
const VENUE_WORD = / (?:stadium|arena|coliseum|amphitheat(?:er|re)|theat(?:er|re)|gardens?|cent(?:er|re)|university|college|airport|hotel)$/;
function namesAround(c, titles, completions, lex) {
  const counts = new Map();
  for (const t of titles) for (const n of new Set(TN.nameRuns(t))) counts.set(n, (counts.get(n) || 0) + 1);
  const queries = [...c.related, ...completions.map((x) => keyOf(x.q))];
  const inQueries = (n) => queries.some((q) => contains(q, n));
  // (a name searched on its own, "reggie", "rakai", is a name word too: never a title's context word)
  // (an event searched on its own is no name: "complexcon", "twitchcon", "coachella fest")
  const alone = c.related.filter((q) => !q.includes(' ') && q !== c.key && !R.PLACES.has(q) && !EVENT_WORD.test(q) && (W.isFirstName(q) || (!W.inDict(q) && q.length >= 5)));
  return [...[...counts.entries()].filter(([n, k]) => TN.personLike(n, lex) && !VENUE_WORD.test(n) && (inQueries(n) ? k >= 2 : k >= Math.max(3, titles.length / 3)))
    .map(([n]) => n), ...alone];
}

/** Whether a plain-word key is a name after all: the lexicon knows it, or the name's own titles capitalise it mid-line ("Diddy"). */
function namedAfterAll(key, titles, lex) {
  if (lex && ((lex.names && lex.names.has(key)) || (lex.capNames && lex.capNames.has(key)))) return true;
  if (key.includes(' ')) return false;
  let cap = 0;
  let low = 0;
  for (const t of titles) {
    const toks = t.split(/\s+/);
    if (W.isTitleCase(toks)) continue;
    toks.forEach((tok, i) => {
      if (i === 0 || /[:.!?]$/.test(toks[i - 1] || '')) return;
      const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '');
      if (core.toLowerCase() !== key) return;
      if (/^\p{Lu}/u.test(core)) cap++; else low++;
    });
  }
  return cap >= NAMED_MIN && cap >= NAMED_RATIO * Math.max(1, low);
}
const NAMED_MIN = 5;
const NAMED_RATIO = 4;

/**
 * The newest outcome replaces the noun it settles: a guilty verdict or a sentencing over the trial, the charges or the allegations,
 * once three or more titles near the name say it and they are newer than the noun's own ("Caleb Flynn guilty verdict").
 */
const SETTLED = new Set(['lawsuit', 'arrest', 'allegations']);
function outcomeOf(noun, rows, near) {
  if (!noun || !noun.f || !SETTLED.has(noun.f.key)) return noun;
  const medianT = (said) => {
    const ts = rows.filter((r) => said(r.title) && mentions(hay(r.title), near.split(' ').slice(-1)[0])).map((r) => r.t).sort((a, b) => a - b);
    return { n: ts.length, t: ts.length ? ts[Math.floor(ts.length / 2)] : 0 };
  };
  const own = medianT((t) => noun.f.re.test(t));
  // (the newest of the outcomes that landed: a mistrial, then a retrial's verdict, then its sentencing; a league's suspension or a
  // firing over the arrest it punishes: "Jed York suspension")
  // (one a headline only looks ahead to has not landed: "faces up to 20 years if convicted", "could be sentenced to ...")
  const outcomes = [...['sentencing', 'verdict', 'mistrial'].map((key) => ({ f: TN.FAMILY.get(key), found: (t) => TN.saidIn(t, TN.FAMILY.get(key)) })),
    ...(noun.f.key === 'lawsuit' ? [] : [{ f: TN.FAMILY.get('quit'), found: (t) => t.match(PUNISHED) }])];
  const landed = outcomes.map((o) => ({ ...o, ...medianT((t) => !!o.found(t)) })).filter((o) => o.n >= OUTCOME_MIN && o.t >= own.t).sort((a, b) => b.t - a.t);
  if (!landed.length) return footageOf(noun, rows, near);
  const { f, n, found } = landed[0];
  const surfaces = rows.map((r) => (found(r.title) || [])[0]).filter(Boolean);
  // (a sentence most of its headlines call life is the life sentence: "Caleb Flynn life sentence")
  const life = f.key === 'sentencing' && surfaces.filter((x) => /life/i.test(x)).length * 2 >= Math.max(1, surfaces.length);
  return { f, noun: life ? 'life sentence' : f.noun(surfaces[0] || ''), count: n, share: n / Math.max(1, rows.length), explained: noun.explained };
}
const OUTCOME_MIN = 3;
/**
 * A death that turned out to be none: HOAX_MIN of a name's headlines say hoax, rumour or alive, and no more say the death itself
 * ("Kai Cenat death hoax spreads", "Kai Cenat is not dead: streamer responds ..."); the hoax as the card's noun, or null.
 */
function hoaxOf(noun, titles, near) {
  const last = near.split(' ').slice(-1)[0];
  const named = titles.filter((t) => mentions(hay(t), last));
  const hoaxed = named.filter((t) => TN.HOAX.re.test(t)).length;
  if (hoaxed < HOAX_MIN || hoaxed < named.filter((t) => TN.says(t, TN.FAMILY.get('death'))).length) return null;
  return { f: TN.HOAX, noun: 'death hoax', count: hoaxed, share: hoaxed / Math.max(1, titles.length), explained: noun ? noun.explained : 0 };
}
const HOAX_MIN = 2;
const PUNISHED = /\b(?:suspended|suspends|suspension|fired|firing)\b/i;

/**
 * An old arrest back in the news for its footage is the footage: "Luigi Mangione bodycam" (the arrest was in 2024; this week is the
 * body-camera video), once two in five of the arrest's titles near the name say so.
 */
const BODYCAM = /\b(?:body ?cam(?:era)?|body-cam(?:era)?|bodycam)\b/i;
const FOOTAGE_SHARE = 0.4;
function footageOf(noun, rows, near) {
  if (!noun || !noun.f || noun.f.key !== 'arrest') return noun;
  const last = near.split(' ').slice(-1)[0];
  const own = rows.filter((r) => noun.f.re.test(r.title) && mentions(hay(r.title), last));
  const shot = own.filter((r) => BODYCAM.test(r.title)).length;
  return own.length >= OUTCOME_MIN && shot >= FOOTAGE_SHARE * own.length ? { ...noun, noun: 'bodycam' } : noun;
}

/**
 * A violent act the press reports alongside the fight it happened in: the card names the event, the fight, not the claim; a stabbing
 * three or more headlines report is what people search, never undersold as a fight ("Lucki ComplexCon stabbing", reported: "Rapper
 * Lucki reportedly stabbed during ComplexCon altercation").
 */
function neutralOf(noun, titles, near) {
  if (!noun || !noun.f || (noun.f.key !== 'stabbing' && noun.f.key !== 'attack')) return noun;
  const last = near.split(' ').slice(-1)[0];
  // (a title is never surer than its line: a stabbing half its own headlines only report, "reportedly stabbed", is the fight)
  const said = titles.filter((t) => noun.f.re.test(t) && mentions(hay(t), last));
  const hedged = said.filter((t) => HEDGED.test(t)).length * 2 >= Math.max(1, said.length);
  if (noun.f.key === 'stabbing' && noun.count >= STABBING_KEPT && !hedged) return noun;
  const fight = TN.FAMILY.get('fight');
  const n = titles.filter((t) => fight.re.test(t) && mentions(hay(t), last)).length;
  return n >= Math.max(3, NEUTRAL_SHARE * noun.count) ? { f: fight, noun: 'fight', count: n, share: n / Math.max(1, titles.length), explained: noun.explained } : noun;
}
const SUING = /\b(?:sues|sued|suing|lawsuits?|legal action|legal challenge)\b/i;
const SUING_MIN = 3;
const NEUTRAL_SHARE = 0.4;
const STABBING_KEPT = 3;
const UNLISTED_FAMS = new Set(['reveal', 'response']);
const ARGUED_NOUN_MIN = 4;
const STABBING_SAID = 5;
const STABBING_SHARE = 0.15;
const DRAMA_TITLE_WORDS = 4;
const PLACED_IN = /\bin (\p{Lu}\p{Ll}{3,})(?=[.;,]|$)/u;
const DEATH_THREATS = /\bdeath threats?\b/i;
const ANSWERED_MIN = 3;
const SINCE_RUN_HOURS = 36;
const SEX_ASSAULT = /\bsexual(?:ly)? (?:assault\w*|abus\w*|misconduct)|\bassault (?:allegations?|claims?|accusations?|record|finding)\b/i;
const SEX_ASSAULT_SHARE = 0.5;
const RETRO = /\b(?:recalls?|recalled|recalling|reflects? on|reflecting on|looks? back|looking back|remembers|revisits?|memoirs?|autobiography|tell-all)\b/i;
// the nouns a memoir's old stories carry
const MEMOIR_OVER = new Set(['split', 'romance', 'feud', 'rumors', 'reveal', 'allegations', 'backlash', 'remarks', 'fight', 'argument', 'apology', 'response', 'quit']);
const MEMOIR_MIN = 4;
const KIN = new Set(['dad', 'father', 'mom', 'mum', 'mother', 'brother', 'sister', 'wife', 'husband', 'son', 'daughter', 'girlfriend', 'boyfriend', 'manager']);
const KIN_MIN = 3;
const KIN_SHARE = 0.6;
/** Someone of the name's its headlines are about: the word right after the name in KIN_SHARE of the titles naming it ("Mighty Mike Plays' dad ..."), or null. */
function kinLed(subject, titles) {
  const sw = subject.split(' ');
  const counts = new Map();
  let named = 0;
  for (const t of titles) {
    const ws = words(t);
    const at = TN.nameAt(ws, subject)[0];
    if (at === undefined) continue;
    named += 1;
    const next = ws[at + sw.length] === 's' ? ws[at + sw.length + 1] : ws[at + sw.length];
    if (KIN.has(next)) counts.set(next, (counts.get(next) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best && best[1] >= KIN_MIN && best[1] >= KIN_SHARE * named ? best[0] : null;
}
const EXECUTION_FAILED = /\b(?:surviv\w+|botched|failed)\b/i;
const HEDGED = /\b(?:reportedly|allegedly|alleged|reported|reports?|suspected|rumou?red|unconfirmed|may have|appears to)\b/i;


/**
 * An aside: a name trending for another trend's story ("anne hathaway", searched with "verity" and "colleen hoover verity movie"), whose
 * own noun is a sliver of its titles ("pregnancy" in 13 of 100): it folds into that trend's card.
 */
function asideOf(c, noun, titles, trendKeys) {
  if (!c.trends.length || !trendKeys) return false;
  const host = [...trendKeys].filter((k) => k !== c.key && !contains(c.key, k) && !contains(k, c.key) && c.related.filter((q) => contains(q, k)).length >= ASIDE_RELATED);
  return host.length > 0 && (!noun || !noun.f || (ASIDE_FAMS.has(noun.f.key) && noun.count < ASIDE_SHARE * titles.length));
}
const ASIDE_RELATED = 2;
const ASIDE_SHARE = 0.2;
// (a personal side story; a performance or a speech at the host's event is that event's story told by its star: "Madonna VMAs performance")
const ASIDE_FAMS = new Set(['romance', 'look', 'rumors', 'injury', 'prison', 'split', 'apology']);
const ASIDE_HOST_SEARCH = 2.5; // a host trend of about 300K US searches or more

function pointOf(c, ctx) {
  const { now, lex } = ctx;
  const ev = evidenceOf(c, ctx);
  const titles = ev.rows.map((r) => r.title);
  // (a completion cut mid-word, "candace owens lesbia", ends as the titles spell that word: "lesbian")
  const titleWordSet = new Set(titles.flatMap((t) => words(t)));
  const complete = (q) => q.replace(/(\S{4,})$/, (w) => (titleWordSet.has(w) ? w : [...titleWordSet].filter((x) => x.startsWith(w) && x.length <= w.length + 3).sort()[0] || w));
  const fresh = ev.completions.filter((x) => x.fresh).map((x) => complete(x.q));
  // (a film's or show's titles name it without the "movie": "Verity" ending, "verity movie" searched)
  const near = c.key.replace(/ (?:movie|film|show|series|season \d+|song|album|trailer|recall)$/, '');
  // (a recall searched by its brand is the recall: "gatorade recall")
  const recalled = / recall$/.test(c.key) ? titles.filter((t) => TN.RECALL.re.test(t) && mentions(hay(t), near.split(' ').slice(-1)[0])).length : 0;
  // (a name the drama headlines lead with is told by its newest wave: what its last days' headlines argue about, "Chris Brown
  // allegations" the day his ex's claims land, not the tour its week's hundred results are about)
  // (a name with a big search of its own is told by what its searches and its week say: "Ken Urker death", 2M searches, never the
  // day's aside)
  // (and a creator's name the searches brought is told the same way: "Jack Doherty fight", the week's noun, stood over three days
  // of headlines about a posting ban, because the name came from a 10K search and not from the drama feeds. Judges, 2026-10-12)
  const creatorName = !!c.creator || (!!ctx.roster && ctx.roster.has(c.key)) || ev.rows.filter((r) => TC.calledCreator(r.title, near)).length >= CREATOR_CALLED_MIN;
  const wave0 = (c.drama || creatorName) && !c.parent && !c.trends.some((t) => t.volume >= WAVE_SEARCH_MAX) ? TN.nounOf(ev.rows.filter((r) => now - r.t < WAVE_DAYS * DAY).map((r) => r.title), { related: c.related, fresh, rest: c.rests.join(' '), name: near, only: TN.DRAMA_FAMS, nearWords: WAVE_NEAR, pool: TN.SAID_FAMS, thin: true }) : null;
  const wave = wave0 && wave0.f && wave0.count >= WAVE_MIN ? wave0 : null;
  const found0 = recalled ? { f: TN.RECALL, noun: 'recall', count: recalled, share: recalled / Math.max(1, titles.length), explained: 0 } :
    wave || TN.nounOf(titles, { related: c.related, fresh, rest: c.rests.join(' '), name: near });
  // (a drama name whose week says nothing that lists on its own, a "reveal" or a response, is told by what its week argues about when
  // two headlines say so right by the name: "Alix Earle says she's 'never read a book,' sparking fierce online backlash")
  // (and a creator in the news all week for a row, whose headlines word it a dozen ways: what ARGUED_NOUN_MIN of them say right by the
  // name, the backlash, the remarks and the feud counted together, is the card's noun however thin its share: "Hasan Piker backlash")
  const thin = !!found0 && !!found0.f && titles.length >= 20 && found0.count < Math.max(3, NOUN_MIN_SHARE * titles.length);
  const argued0 = !wave && !recalled && c.drama && !c.parent && (!found0 || !found0.f || UNLISTED_FAMS.has(found0.f.key) || (thin && !!c.creator)) ?
    TN.nounOf(titles, { related: c.related, fresh, rest: c.rests.join(' '), name: near, only: TN.DRAMA_FAMS, nearWords: WAVE_NEAR * 2, pool: TN.SAID_FAMS }) : null;
  const found = argued0 && argued0.f && argued0.count >= (thin ? ARGUED_NOUN_MIN : WAVE_MIN) ? { ...argued0, wave: true } : found0;
  // (a story a top post of a creators' subreddit broke, told nowhere else yet, is named by that post's noun)
  // (and one a post of its week's top POST_LEAD_RANK tells, whatever else the name's week was about: "Logan Paul fraud")
  const post = postNoun(ev, near);
  const posted = post && (!found || !found.f || (!wave && c.drama && post.rank < POST_LEAD_RANK)) ? post : null;
  let noun0 = posted || (!wave && found && !found.wave && found.f && titles.length >= 20 && found.count < Math.max(3, NOUN_MIN_SHARE * titles.length) ? null : found);
  // (a drama name's newest wave the headlines call a controversy is titled by what it is, a backlash: "controversy" says nothing)
  if (noun0 && (noun0 === wave || noun0 === posted)) noun0 = { ...noun0, wave: true, ...(noun0.noun === 'controversy' ? { noun: 'backlash' } : {}) };
  // (a sexual assault is a claim against the name, never an attack on it: "Jacob Geller allegations", whatever the post that broke it says)
  if (noun0 && noun0.f && noun0.f.key === 'attack') {
    const told = ev.rows.filter((r) => noun0.f.re.test(r.title));
    if (told.length && told.filter((r) => SEX_ASSAULT.test(r.title)).length >= SEX_ASSAULT_SHARE * told.length) noun0 = { ...noun0, f: TN.FAMILY.get('allegations'), noun: 'allegations' };
  }
  // (an apology refused is none: "Jeremy Strong says he doesn't 'need to apologise' for method acting")
  if (noun0 && noun0.f && noun0.f.key === 'apology') {
    const said = titles.filter((t) => noun0.f.re.test(t));
    if (said.length && said.filter((t) => APOLOGY_REFUSED.test(t)).length * 2 >= said.length) noun0 = null;
  }
  // (a fight on a card is sport, not a brawl: "Michael Page 'had some boring fights,' says Joe Rogan")
  if (noun0 && noun0.f && noun0.f.key === 'fight') {
    const said = titles.filter((t) => noun0.f.re.test(t) && mentions(hay(t), near.split(' ').slice(-1)[0]));
    if (said.length && said.filter((t) => FIGHT_SPORT.test(t)).length * 2 >= said.length) noun0 = null;
  }
  // (an arrest is an arrest, never a fight: once ARREST_OUTLETS outlets state, with no hedge, that the name itself was arrested, charged
  // or booked, that is what happened to it and what the card says: "Jack Doherty arrest", never "Jack Doherty fight". Collector only:
  // IDEAS-FEED G4; a title follows what two outlets state, it is never surer than they are)
  if (noun0 && noun0.f && ARREST_OVER.has(noun0.f.key)) {
    const stated = arrestStated(ev, near, lex);
    if (stated.outlets >= ARREST_OUTLETS) noun0 = { f: TN.FAMILY.get('arrest'), noun: 'arrest', count: stated.rows.length, share: stated.rows.length / Math.max(1, titles.length), explained: noun0.explained };
  }
  // (a film or show searched in the hundreds of thousands is the talking point itself, not a facet a few interviews mention:
  // "Verity movie", not "Verity movie ending")
  const screenKey = /\b(?:movie|film|show|series)\b/.test(c.key) || c.wiki.some((w) => /\b(?:film|television|series|miniseries)\b/i.test(w.desc || ''));
  if (noun0 && noun0.f && screenKey && SCREEN_FACETS.has(noun0.f.key) && Math.max(0, ...c.trends.map((t) => t.volume)) >= SCREEN_SEARCH &&
    noun0.count < SCREEN_FACET_SHARE * titles.length) noun0 = null;
  // (someone suing is a lawsuit, wherever it is heard: "Prince Andrew lawsuit", the police he took to the High Court)
  if (noun0 && noun0.f && noun0.f.key === 'lawsuit' && noun0.noun === 'court case' && titles.filter((t) => SUING.test(t) && mentions(hay(t), near.split(' ').slice(-1)[0])).length >= SUING_MIN) {
    noun0 = { ...noun0, noun: 'lawsuit' };
  }
  // (a death its headlines call a hoax is the hoax: "Kai Cenat death hoax", never a death)
  noun0 = hoaxOf(noun0, titles, near) || noun0;
  const settled = outcomeOf(noun0, ev.rows, near);
  noun0 = neutralOf(settled, titles, near);
  // (a fight in which someone was stabbed is searched as the stabbing once STABBING_SAID headlines state it without a hedge: "Rapper
  // Lucki stabbed in skirmish involving Playboi Carti's crew")
  if (noun0 && noun0.f && noun0.f.key === 'fight') {
    const stab = TN.FAMILY.get('stabbing');
    const lastN = near.split(' ').slice(-1)[0];
    const saidSo = ev.rows.filter((r) => !r.youtube && stab.re.test(r.title) && mentions(hay(r.title), lastN));
    if (saidSo.filter((r) => !HEDGED.test(r.title)).length >= STABBING_SAID && saidSo.length >= STABBING_SHARE * noun0.count) {
      noun0 = { f: stab, noun: 'stabbing', count: saidSo.length, share: saidSo.length / Math.max(1, titles.length), explained: noun0.explained };
    }
  }
  // (the reported verb the fight stands in for: "Rapper Lucki reportedly stabbed during ComplexCon altercation" over "injured")
  const stronger = settled && settled.f && noun0 && noun0.f !== settled.f ? settled.f : noun0 && noun0.f && noun0.f.key === 'fight' ? TN.FAMILY.get('stabbing') : null;
  // (an arrest is the name's own only when a headline says so. When its headlines only tell someone else's, "Mad Sandhu's shooter
  // arrested", "Mad Sandhu murder case: one accused arrested", the card never says the name was arrested: it says what they tell of the
  // name, a death when ARREST_OTHERS_MIN of them say it was killed, else nothing. Collector only)
  if (noun0 && noun0.f && noun0.f.key === 'arrest') {
    const whose = whoseArrest(titles, near);
    // (one headline that reads as the name's own does not outweigh sixteen that tell someone else's: "Nancy Guthrie arrest" was
    // published over the arrest of a man detained in the search for her. Reviewers, 2026-10-12)
    if (whose.others >= ARREST_OTHERS_MIN && whose.own * 2 < whose.others) {
      const killed = titles.filter((t) => KILLED.test(t) && mentions(hay(t), near.split(' ').slice(-1)[0])).length;
      noun0 = killed >= ARREST_OTHERS_MIN ? { f: TN.FAMILY.get('death'), noun: 'death', count: killed, share: killed / Math.max(1, titles.length), explained: noun0.explained } : null;
    }
  }
  const f0 = noun0 && noun0.f;
  const names = namesAround(c, titles, ev.completions, lex);
  let subject0 = TN.subjectOf(c.key, f0, titles, names);
  // (a death is the name's own only when a headline says so. When its headlines only tell someone else's, the name mourning, a
  // relative's funeral, the card says whose, "Michael Flatley wife death", or is the one they name, "Presley Gerber death" for
  // "George Clooney addresses death of Cindy Crawford's son Presley Gerber"; else it says no death at all. Collector only: a card
  // never says a living person died)
  if (f0 && f0.key === 'death') {
    const whose = TN.whoseDeath(subject0, f0, titles);
    if (!whose.own && whose.others && !TN.relationOf(subject0, f0, titles)) {
      if (whose.owner && whose.owner.n >= DEATH_OWNER_MIN && whose.owner.n * 2 >= whose.others) subject0 = whose.owner.name;
      else noun0 = null;
    }
  }
  // (a personal noun about someone else in the line is not the name's: "Rob Gronkowski says Caleb Williams' injury ...")
  let noun = TN.personalNear(subject0, f0, titles) && !(f0 && f0.key === 'romance' && !TN.personLike(subject0, lex)) ? noun0 : null;
  // (a romance is a person's: a film is never pregnant, "Verity pregnancy" is Anne Hathaway's aside)
  let f = noun && noun.f;
  const subject = f ? subject0 : c.key;
  const phrases = [...c.related, ...fresh.map(keyOf), ...c.trends.map((t) => keyOf(t.keyword))];
  // the words people search with the name: its related queries, fresh completions and trend keywords
  const searched = new Set([...phrases, ...(c.parentRelated || [])].flatMap((q) => q.split(' ')));
  let { ws: tw, how } = TN.titleWords(subject, noun ? noun.noun || '' : '', f, phrases, titles, names, searched);
  // (something said that people hit back at is searched by what it was about: "Asmongold women comments", "Da'Vinchi slavery comments";
  // a drama name's by its newest wave of headlines)
  let said = null;
  if (f && SAID_TITLED.has(f.key) && how === 'plain' && subject.split(' ').length <= 3) {
    const recent = c.drama ? ev.rows.filter((r) => now - r.t < WAVE_DAYS * DAY).map((r) => r.title) : titles;
    const topic = TN.saidTopic(recent, subject, names);
    if (topic) { said = { ...f, re: SAID_LINE }; tw = [...subject.split(' '), topic, 'comments']; how = 'said'; noun = { ...noun, noun: 'comments' }; }
    // (or a post, by the word its headlines quote from it: "Ms. Rachel genocide post")
    const posted = topic ? null : TN.postTopic(recent, subject);
    if (posted) { said = { ...f, re: SAID_LINE }; tw = [...subject.split(' '), posted, 'post']; how = 'said'; noun = { ...noun, noun: 'post' }; }
  }
  // (a shoot that stopped is the film's or the show's, as its searches name it: "Batman Part II production pause", not "Matt Reeves ...")
  if (f && f.key === 'pause' && how !== 'phrase') {
    const paused = pausedWork(subject, phrases, titles.filter((t) => f.re.test(t)));
    if (paused) { tw = [...paused, ...words(noun.noun)]; how = 'work'; }
  }
  // (one name going at another's work or words with nobody answering is criticism, not a feud: "Chris Hansen Primetime criticism")
  const oneSided = (n) => !!n && !!n.f && n.f.key === 'feud' && n.noun === 'feud' && titles.filter((t) => MUTUAL.test(t)).length < MUTUAL_MIN;
  if (oneSided(noun)) { tw = tw.map((w) => (w === 'feud' ? 'criticism' : w)); noun = { ...noun, noun: 'criticism' }; }
  // a reveal that is a crossover ("Fortnite FNAF collab"); a name read and searched for a film or show about it ("Unabomber movie")
  if (f && f.key === 'reveal' && how === 'plain') {
    const ip = crossoverOf(subject, titles);
    if (ip) { tw = [...subject.split(' '), ip.toLowerCase(), 'collab']; how = 'crossover'; noun = { ...noun, f: TN.FAMILY.get('collab'), noun: 'collab' }; f = noun.f; }
  }
  let work = null;
  // (a trend that already is a film or show, "verity movie", "east of eden" (searched with its cast and Netflix), is titled as searched,
  // never by a junket that names its stars: "East of Eden", not "Florence Pugh series")
  const screen = screenWork(c, lex, [...c.related, ...ev.completions.map((x) => keyOf(x.q))]);
  if (!f && (/\b(?:movie|film|show|series)$/.test(c.key) || screen)) how = 'search';
  // a film's ending or trailer is the film's, not the person it is about: "Unabomber ending", not "Ted Kaczynski ending"
  else if (f && WORK_FACETS.has(f.key) && TN.personLike(subject, lex)) {
    const w = workOf(subject, titles.filter((t, i) => !ev.rows[i].blocked), lex);
    if (w && !w.about) { work = w; tw = [...w.ws.slice(0, -1), ...words(noun.noun)]; how = 'work'; }
  }
  else if (!f || WEAK_FAMS.has(f.key)) {
    // a film, show or doc the name is read and searched for ("Unabomber movie", "Monster Lizzie Borden"), over a weak noun only when
    // it is about the name ("Nathan Fielder Elizabeth Holmes doc", not "Elizabeth Holmes prison life")
    const w = workOf(subject, titles.filter((t, i) => !ev.rows[i].blocked), lex);
    // (a performer is in the work, not its subject: "Bella Ramsey" in Celebrity Traitors is no "Celebrity Traitors series" card)
    const performer = c.wiki.some((x) => PERFORMER.test(x.desc || ''));
    if (w && (!f || (w.about && w.n >= noun.count)) && (w.about || !performer || (found && found.f && DISPUTE_FAMS.has(found.f.key)))) {
      work = w;
      // (a name searched for its own part in the work is said with it, "Jon Watts Star Wars movie"; one read about because of the
      // work, Wikipedia's "Ted Kaczynski", is the work's: "Unabomber movie")
      tw = !w.about && c.trends.length && !c.sustained && TN.personLike(subject, lex) && subject.split(' ').length + w.ws.length <= 5 ? [...subject.split(' '), ...w.ws] : w.ws;
      how = 'work';
      noun = null;
      f = null;
      // a dispute with the work, below a noun's share but there: "Chris Hansen Primetime feud"
      if (found && found.f && DISPUTE_FAMS.has(found.f.key) && found.count >= WORK_DISPUTE_MIN && !w.about) {
        noun = oneSided(found) ? { ...found, noun: 'criticism' } : found;
        tw = [...subject.split(' '), ...w.ws.slice(0, -1), ...words(noun.noun)];
        f = found.f;
      }
    }
  }
  // a rumour about who someone is, is a rumour, never an allegation of wrongdoing: "Candace Owens lesbian rumors"
  const rumor = !!f && f.key === 'allegations' && tw.some((w) => IDENTITY.has(w));
  if (rumor) { tw = tw.map((w) => (w === 'allegations' ? 'rumors' : w)); noun = { ...noun, noun: 'rumors' }; }
  // (a split or a romance with a far more famous partner leads with the partner, "Elon Musk Shivon Zilis split"; a feud says who with,
  // "Phil Collins McCartney feud"; an engagement or a wedding is searched by the famous one's name alone, "Kash Patel engagement")
  if (how !== 'work') tw = TL.pairedOf(tw, subject, f, ev.press, ctx.wikiIndex, TN, noun ? noun.noun : null);
  // (the name people search when they search a title by it: "Prince Andrew", not "Andrew Mountbatten-Windsor")
  const alias = searchedAlias(c, subject);
  if (alias && tw.slice(0, subject.split(' ').length).join(' ') === subject) tw = [...alias.split(' '), ...tw.slice(subject.split(' ').length)];
  // (a plain-word subject is searched by where it is, as its searches type it: "Russia plague outbreak", not "Pneumonic plague outbreak")
  const placed = c.generic && f && how !== 'work' ? placedPhrase(subject, noun, phrases) : null;
  if (placed) tw = placed;
  // (a story its headlines tell about someone of the name's is titled by them: "Mighty Mike Plays dad", never a firing he took back)
  const kin = f && TN.DRAMA_FAMS.has(f.key) && how === 'plain' ? kinLed(subject, titles) : null;
  if (kin) { tw = [...subject.split(' '), kin]; how = 'kin'; }
  // (a word the noun repeats is said once: "Lanterns finale", never "Lanterns finale finale")
  tw = tw.filter((w, i) => i === 0 || w !== tw[i - 1]);
  // (a people-drama card is a name and a noun, a word between them at most: "Gillian Anderson confrontation", "Dakota Harper charges")
  if (f && TN.DRAMA_FAMS.has(f.key) && how !== 'work' && tw.length > DRAMA_TITLE_WORDS) {
    const sw = subject.split(' ');
    const nw = noun ? words(noun.noun || '') : [];
    if (tw.slice(0, sw.length).join(' ') === subject && nw.length && sw.length + nw.length <= DRAMA_TITLE_WORDS) tw = [...sw, ...nw];
  }
  const visible0 = titles.filter((t, i) => !ev.rows[i].blocked);
  // (a name only the blocked outlets print is spelt as they spell it)
  const visible = visible0.some((t) => mentions(hay(t), subject)) ? visible0 : titles.filter((t, i) => !ev.rows[i].far);
  // (the name as Wikipedia spells it when the outlets split on its case and one of them spells it so: "Flydubai", not "FlyDubai")
  const surface0 = TN.nameSurface(subject, visible);
  const article = ctx.wikiIndex && ctx.wikiIndex.names ? ctx.wikiIndex.names.get(subject) : null;
  const surface = article && article !== surface0 && /\p{Lu}/u.test(surface0) && article.toLowerCase() === surface0.toLowerCase() &&
    visible.some((t) => t.includes(article)) ? article : surface0;
  // (a hyphenated noun keeps its hyphen: "long-lost son")
  const titleOf = (ws, n) => hyphenate(TN.caseTitle(ws, subject, work && work.work ? [...visible, ...visible.map((t) => t.replace(/[‘'“"]/g, ' '))] : visible, lex), n)
    .replace(surface0, surface);
  let title0 = titleOf(tw, noun);
  const lineWords = tw.filter((w) => !subject.split(' ').includes(w) && !(noun && words(noun.noun || '').includes(w)));
  const lineOpts = { rumor, stronger, now, debug: ctx.find && ctx.debug && (mentions(` ${c.key} `, keyOf(ctx.find)) || mentions(` ${keyOf(tw.join(' '))} `, keyOf(ctx.find))) ? ctx.debug : null };
  let traced = TN.whatOf(ev.rows, subject, said || f, ev.peakT, lex, lineWords, lineOpts);
  // (a creators'-world story only the outlets the moments block wrote up, the ones that write up every streamer's week, is told by
  // their headline: never a far country's own outlet's, never an upload's)
  if (!traced.what && f && (c.creator || ev.creatorSub)) {
    traced = TN.whatOf(ev.rows.map((r) => (r.blocked && !r.far ? { ...r, blocked: false } : r)), subject, said || f, ev.peakT, lex, lineWords, lineOpts);
  }
  // (a creators'-world story no outlet has written up yet is told by the post that broke it, reported: "German streamer Benjamool
  // reportedly pelted with rocks by kids in Cairo")
  if (!traced.what && f) {
    const post = postLine(ev, subject, f, lex);
    if (post) traced = { what: post.what, denied: false, trace: [{ source: 'Reddit', t: post.t, text: post.text }], unsaid: false };
  }
  // a title is never surer than its line: a show's facet no line tells ("East of Eden ending" over "Florence Pugh stars in ...") is
  // the show as searched, and an outbreak its line only suspects is a scare ("Russia plague scare")
  const unsaidSoft = !!(traced.unsaid && f && screen && !work && SOFT.has(f.key));
  if (traced.unsaid && f && screen && !work) { noun = null; f = null; how = 'search'; title0 = titleOf(subject.split(' '), null); }
  // (a film or show searched as itself, nothing argued about it yet, is searched for what critics make of it: "East of Eden reviews",
  // told by a line about the reviews, never by who stars in it)
  if (!f && how === 'search' && screen && !work && subject.split(' ').length <= 4) {
    const reviewed = reviewsOf(c, titles, fresh);
    const line = reviewed ? TN.whatOf(ev.rows, subject, TN.REVIEWS, ev.peakT, lex, [], { now, debug: ctx.find && ctx.debug && mentions(` ${c.key} `, keyOf(ctx.find)) ? ctx.debug : null }) : null;
    if (line && line.what && !line.unsaid) {
      noun = { f: TN.REVIEWS, noun: 'reviews', count: reviewed, share: reviewed / Math.max(1, titles.length), explained: 0 };
      f = noun.f;
      how = 'reviews';
      tw = [...subject.split(' '), 'reviews'];
      title0 = titleOf(tw, noun);
      traced = line;
    }
  }
  // (a name whose week is its memoir is told as the memoir: the book's old stories are nothing people argue about today, "Michael
  // Douglas memoir" over a separation of 2013; when more of its headlines say memoir than say the card's noun)
  if (f && !work && how !== 'work' && how !== 'reviews' && MEMOIR_OVER.has(f.key)) {
    const lastM = subject.split(' ').slice(-1)[0];
    const told = ev.press.filter((r) => !r.youtube && mentions(hay(r.title), lastM) && TN.MEMOIR.re.test(r.title)).length;
    const line = told >= MEMOIR_MIN && told >= noun.count ? TN.whatOf(ev.rows, subject, TN.MEMOIR, ev.peakT, lex, [], { now }) : null;
    if (line && line.what && !line.unsaid) {
      noun = { f: TN.MEMOIR, noun: 'memoir', count: told, share: told / Math.max(1, titles.length), explained: 0 };
      f = noun.f;
      how = 'memoir';
      said = null;
      tw = [...subject.split(' '), 'memoir'];
      title0 = titleOf(tw, noun);
      traced = line;
    }
  }
  const softer = noun && traced.what && SOFTER.get(noun.noun) && TL.HEDGE.test(traced.what) ? SOFTER.get(noun.noun) : null;
  if (softer) { title0 = titleOf(tw.map((w) => (w === noun.noun ? softer : w)), noun); noun = { ...noun, noun: softer }; }
  // (the line spells the name as the title does)
  const chapter = f && f.key === 'reviews' ? null : chapterOf(ev, subject, f, now);
  // (a claim's new chapter, told without the new name: the card stays the first claim's)
  // (and a two-word name without the middle name a line gives it: "Christa Gail Pike" -> "Christa Pike")
  // (and a work's name in quotes where its own headlines quote it: "‘Lanterns’ writers ...", "‘Canadian Idol’ judge ...")
  const ownShow = work && work.work ? work.work : work || kindOf(c, noun, screen) === 'show' ? surface : null;
  // (and a word a headline capitalised that the others print lowercase is no name: "‘distracting’ superfans", "cops tasing him")
  const tidy = (line) => TL.decap(TL.quoteWorks(TL.dropMiddleName(TN.recaseName(line, subject, surface), subject, surface), visible, ownShow), titles, subject);
  const told = tidy(traced.what);
  // (an election its line tells by the country, never naming the candidate whole, is searched by the country: "Brazil election
  // runoff" for "Brazil gears up for Lula-Bolsonaro presidential runoff", not "Flavio Bolsonaro election")
  // (an official nobody searches by name, by the league and the job its searches type: "NFL referee suspension")
  const official = officialWords(how, tw, noun, phrases, told);
  // (someone who lost money to a fraud is no fraudster: the card says which fraud, "Logan Paul investment fraud")
  const lost = f && f.key === 'scam' && how === 'plain' && told ? lostTo(told, subject, noun) : null;
  // (and by what was lost when the line gives the sum: "Logan Paul $250K loss", never a title that reads as his fraud)
  const sum = lost ? lostSum(told) : null;
  // (a claim whose line says what the accused is said to have done, death threats, is searched by that: "Chris Brown death threats")
  const threats = f && f.key === 'allegations' && (how === 'plain' || how === 'context') && told && DEATH_THREATS.test(told) && tw.length <= subject.split(' ').length + 2 ?
    [...subject.split(' '), 'death', 'threats'] : null;
  // (an execution its line says she survived is a failed one: "Christa Pike failed execution")
  const failed = f && f.key === 'execution' && told && EXECUTION_FAILED.test(told) && title0.split(' ').length <= DRAMA_TITLE_WORDS ?
    title0.replace(/ execution$/, ' failed execution') : null;
  // (a handle's attack is placed where its line says it happened, so the row says more than a name: "Benjamool Cairo attack")
  const where = f && f.key === 'attack' && !subject.includes(' ') && tw.length === 2 && told ? (told.match(PLACED_IN) || [])[1] : null;
  const placedAt = where && !W.isFirstName(where.toLowerCase()) ? `${titleOf([subject], null)} ${where} ${noun.noun}` : null;
  const title1 = electionTitle(f, told, subject) || (official ? titleOf(official, noun) : null) || placedAt || (sum ? `${titleOf(subject.split(' '), null)} ${sum} loss` : null) ||
    (lost ? titleOf(lost, noun) : null) || (threats ? titleOf(threats, noun) : null) || failed || title0;
  // (a claim's new chapter leads its line when a headline of its own tells it: who now claims what, then that the first claims were denied)
  const fresh2 = traced.what && chapter && f && f.key === 'allegations' ? chapterLine(chapter, subject, surface, f, lex, now, traced, told) : null;
  // (a claim the subject has admitted is told by the admission, never as a bare accusation: "Jacob Geller admits to assault as ...")
  const owned = !fresh2 && traced.what && !chapter && f && f.key === 'allegations' ? admittedLine(ev, subject, surface, f, lex, now) : null;
  // (and it ends "allegations" on the card: once ADMISSION_OUTLETS outlets carry the admission the noun is what the subject did, an
  // apology when they apologised, else an admission: "Jacob Geller admission", its line leading with it. Collector only: IDEAS-FEED G4)
  const admittedNoun = owned && noun && noun.noun === 'allegations' ? admissionNoun(ev, subject) : null;
  const title = admittedNoun && /\ballegations$/i.test(title1) ? title1.replace(/\ballegations$/i, admittedNoun) : title1;
  if (admittedNoun && title !== title1) noun = { ...noun, noun: admittedNoun };
  // (a death the list has carried for days is told by what followed it, once several outlets tell the same follow-up: "Gypsy Rose
  // Blanchard launches petition to combat 'harassment and cyberbullying' after partner Ken Urker's death")
  const after = traced.what && f && f.key === 'death' ? aftermathLine(ev, subject, f, lex, now) : null;
  const what = fresh2 || (owned ? owned.what : null) || (after ? tidy(after.what) : null) || (traced.what && chapter && f && f.key === 'allegations' ? withChapter(told, chapter) : told);
  const denied = owned ? false : traced.denied;
  const trace = owned ? [...owned.trace, ...traced.trace] : after ? [...after.trace, ...traced.trace] : traced.trace;
  const generic = c.generic && how !== 'search' && how !== 'reviews' && !namedAfterAll(c.key, titles, lex);
  const aside = asideOf(c, noun, titles, ctx.trendKeys);
  // (the words a headline about this card leads with: its subject, or the work or name its title says: "Unabomber", "Primetime")
  const leadWords = [subject.split(' ').slice(-1)[0], ...words(title).filter((w) => !W.inDict(w) && !(noun && words(noun.noun || '').includes(w)))];
  // (its Wikipedia days: its own page, the film's or show's, the subject's; and the press's momentum)
  const curve = wikiCurveOf([c.key, near, subject, work && work.ws ? work.ws.filter((w) => !/^(?:movie|film|show|series|doc)$/.test(w)).join(' ') : null], ctx.wikiIndex, now,
    !!noun && noun.noun === 'box office record');
  // (a story never peaked before it began: its days, momentum and status are its own headlines' when they came later than the name's)
  const sev = storyEvidence(ev, f, subject, c.drama ? STORY_OWN_DRAMA : STORY_OWN_MIN);
  const momentum = momentumOf(c, sev, curve, now);
  // (the story's own headlines, and whether it is still told)
  const own = ownStory(ev, said || f, subject, what, now);
  const lastWord0 = subject.split(' ').slice(-1)[0];
  const began = Math.min(now, ...ev.press.filter((r) => mentions(hay(r.title), lastWord0) && (!f || f.re.test(r.title))).map((r) => r.t));
  const still = !!f && TN.DRAMA_FAMS.has(f.key) && !work && own.lately >= STILL_MIN && now - began <= STILL_WEEK * DAY;
  // (a name the drama headlines gave, with no search of its own, is weighed by its story's outlets)
  const unsearchedDrama = !!c.drama && !c.trends.length && !c.parent && !!f;
  const heat0 = heatOf(c, sev === ev ? ev : { ...ev, peakT: sev.peakT }, noun, now, { denied, chapter, work, leadWords, curve, momentum, screen: !f && how === 'search',
    audience: ctx.audience, live: ctx.liveSearches, soft: unsaidSoft, still, answered: !!what && !!f && TN.DRAMA_FAMS.has(f.key) && ((words(what).slice(0, subject.split(' ').length).join(' ') === subject && ANSWERED.test(what)) ||
      // (or ANSWERED_MIN of its own headlines lead with the subject answering: the card's line may tell what happened instead)
      ev.press.filter((r) => !r.youtube && words(r.title).slice(0, subject.split(' ').length).join(' ') === subject && ANSWERED.test(r.title)).length >= ANSWERED_MIN),
    ...(unsearchedDrama ? { own } : {}) });
  const status = statusOf(c, sev, now, chapter, noun, momentum, still);
  // a fading card costs more than its recency alone; one whose name people type only for something else (her songs, his films) less
  // (a film's or show's completions are the show's: "east of eden trailer" is demand for it)
  const kind = work ? 'show' : kindOf(c, noun, screen);
  // (who it is about, and whether it is the kind the list leads with: a person, or the creators' own world, and a noun people argue about)
  const who0 = whoOf(c, ev, subject, kind, lex, ctx.roster);
  // (a person's story about the creators themselves is the creators' world's own: "Pete Davidson influencer comments")
  const who = who0.person && who0.tier !== 'creator' && !!f && TN.DRAMA_FAMS.has(f.key) &&
    words(title).slice(subject.split(' ').length).some((w) => TC.CREATOR_ROLE.test(w)) ? { ...who0, tier: 'creator' } : who0;
  // (a look back is nothing people argue about right now: "Selma Blair recalls career fallout ...")
  const retro = !!what && RETRO.test(what);
  // (never a story only another region's press carries: it leads nothing for this audience)
  // (or something a person wore or did on stage that the headlines say people answer and argue about: "Zach Bryan defies ...",
  // "... reacts to Zach Bryan wearing ...", "... stirs Ed Sheeran drama")
  const answeredBy = !!f && CLIP.has(f.key) && !TN.DRAMA_FAMS.has(f.key) ? ev.press.filter((r) => !r.youtube && mentions(hay(r.title), lastWord0) && ARGUED.test(r.title)).length : 0;
  const argued = answeredBy >= ARGUED_MIN && answeredBy >= ARGUED_SHARE * ev.press.length;
  const drama = !!f && (TN.DRAMA_FAMS.has(f.key) || argued) && kind !== 'show' && (who.person || who.tier === 'creator') && heat0.parts.regional >= 1 && !retro;
  // (nor a search that started today: YouTube's completions lag a story that broke this morning)
  // (nor a press story that broke in the last two days: "Prince Andrew lawsuit" the morning after)
  // (nor a drama name's story of the last two days: what people type into YouTube lags it, "Halle Berry allegations" the day after)
  const typed = kind === 'show' || how === 'search' || (c.trends.length > 0 && c.trends.every((t) => now - t.start < DAY)) || brokeLately(c, ev, now) ||
    (!!c.drama && (still || now - sev.peakT <= YOUNG_DRAMA_DAYS * DAY)) || typedOf(ev, title, traced.what, subject);
  const heat = { ...heat0, score: heat0.score * (status === 'fading' ? FADING_MULT : 1) * (typed ? 1 : NO_DEMAND_MULT),
    parts: { ...heat0.parts, fading: status === 'fading' ? FADING_MULT : 1, typed: typed ? 1 : NO_DEMAND_MULT } };
  // (a debug find names a whole name or title words: "andrew mountbatten", never every Andrew)
  if (ctx.find && ctx.debug && (mentions(` ${c.key} `, keyOf(ctx.find)) || mentions(` ${keyOf(title)} `, keyOf(ctx.find)))) {
    ctx.debug(`\n## ${c.key} (${c.from}) titles=${titles.length} noun=${noun ? `${noun.noun}:${noun.count}` : '-'} subject=${subject} how=${how} title=${title}`);
    ctx.debug(`   found=${found ? `${found.noun}:${found.count}` : '-'} kept=${noun0 ? 'y' : 'n'} near=${TN.personalNear(subject0, f0, titles)} | names=${names.join(', ')} | phrases=${phrases.slice(0, 12).join('; ')}`);
    for (const t of titles.slice(0, 12)) ctx.debug(`   - ${t}`);
    ctx.debug(`   fresh=${fresh.join('; ')} | what=${what} | chapter=${chapter ? chapter.name : '-'} generic=${generic} aside=${aside} parts=${JSON.stringify(heat.parts)}`);
    ctx.debug(`   wiki=${curve ? JSON.stringify(curve) : '-'} momentum=${JSON.stringify(momentum)} status=${status}`);
  }
  const bestTrend = [...c.trends].sort((a, b) => b.geoW * b.volume - a.geoW * a.volume)[0] || null;
  const searchVolume = Math.max(0, ...c.trends.map((t) => t.volume));
  // (a rumour about who someone is, is no crime: "Candace Owens lesbian rumors" takes its flag from its own line, if any)
  const sensitiveWhy = (f && f.sensitive && !rumor) ? f.sensitive : (what && !rumor && (R.RE.tragedy.test(what) ? 'tragedy' : R.RE.legal.test(what) ? 'crime' : null)) || null;
  // since: the first headline that names the subject and says the noun, not the search window's first day
  const lastWord = subject.split(' ').slice(-1)[0];
  const sinceRows = ev.press.filter((r) => mentions(hay(r.title), lastWord) && (!f || f.re.test(r.title)));
  // (a lone early headline that says the noun is another day's story: this one begins where its headlines keep coming, at the first
  // with another within SINCE_RUN_HOURS: "Gillian Anderson confrontation" began the day of the clip, not with a row from days before)
  const sinceTs = sinceRows.map((r) => r.t).sort((a, b) => a - b);
  const runAt = sinceTs.findIndex((t, i) => i + 1 < sinceTs.length && sinceTs[i + 1] - t <= SINCE_RUN_HOURS * 3600000);
  const sinceT = sinceTs.length ? sinceTs[runAt < 0 ? 0 : runAt] : ev.firstT;
  // (who else the story is about: the people its searches or a third of its titles name, whole names only: "trey mcbride" and "jeff
  // seeman" under the referees' suspension; a moment about one of them is this card's story, never a second row)
  const also = [...new Set(names.filter((n) => n.includes(' ') && n !== subject && !contains(n, subject) && !contains(subject, n) &&
    titles.filter((t) => mentions(hay(t), n)).length >= ALSO_MIN))].slice(0, ALSO_MAX);
  // (the newest line of a new chapter from an outlet that may word one)
  // (or, for a claim, the subject's own admission or its fallout in the last three days: "Jacob Geller confirms ... removed from MinnMax")
  const latest = chapter ? [...chapter.rows].filter((r) => !r.blocked).sort((a, b) => b.t - a.t)[0] || null : admissionOf(ev, subject, f, traced.trace, now);
  return {
    c, ev, noun, subject, title, how, what, denied, kind, generic, aside, work, own, score: heat.score, parts: heat.parts, searchVolume,
    out: {
      title, kind, what, subject: surface, noun: noun ? noun.noun : work ? work.noun : null,
      heat: heatNumber(heat.score), status,
      // (a story never peaked before it began: a name's busiest day may be an older story's, "Tom Cruise" before 'Digger' flopped)
      since: new Date(sinceT).toISOString().slice(0, 10), daysAgo: Math.max(0, Math.round((now - Math.max(sev.peakT, Math.min(sinceT, now))) / DAY)),
      ...(latest ? { latest: { text: TN.recaseName(TN.cleanHeadline(latest.title, latest.outlet), subject, surface), date: new Date(latest.t).toISOString().slice(0, 10),
        source: latest.outlet } } : {}),
      sources: sourcesOf(ev.press),
      signals: {
        search: bestTrend ? { geo: bestTrend.geo, query: bestTrend.keyword, volume: bestTrend.volume, growth: bestTrend.growth || null } : null,
        countries: new Set(c.trends.filter((t) => t.volume >= 5000).map((t) => t.geo)).size,
        news: ev.press.length, outlets: ev.outlets, youtube: ev.youtube,
        reddit: ev.redditBest < 99 ? ev.redditBest + 1 : null,
        ...(ev.redditWeek < 99 ? { redditWeek: ev.redditWeek + 1 } : {}),
        wikipedia: c.wiki.length ? Math.max(...c.wiki.map((w) => w.views)) : null,
        // (a completion cut mid-word, "kai cenat allegations r", without its stub)
        fresh: fresh.filter((q) => contains(keyOf(q), subject.split(' ')[0])).map((q) => q.replace(/\s+\S$/, '')).slice(0, 3),
      },
      ...(sensitiveWhy ? { sensitive: true, sensitiveWhy } : {}),
      ...(denied ? { denied: true } : {}),
      ...(also.length ? { also } : {}),
      tier: who.tier, ...(drama ? { drama: true } : {}),
      from: c.from,
      trace: trace.map((x) => ({ source: x.source, date: new Date(x.t).toISOString().slice(0, 10), text: x.text })),
      meta: metaOf({ c, ev, f, said, noun, subject, surface, what, lex, now, chapter, denied, owned: !!owned, sinceT, sinceRun: runAt >= 0, fresh, who, also, trace }),
    },
  };
}

// ---------- the collector's evidence (IDEAS-FEED B1, C4, D3, D4) ----------
const ARREST_OVER = new Set(['fight', 'attack', 'argument']);
const ARREST_OUTLETS = 2;
const ARREST_NEAR = 3;
// (the name inside someone else's clause is not the one arrested: "Man who punched Jack Doherty arrested", "suspect in attack on ...")
const NOT_THE_SUBJECT = new Set(['who', 'whom', 'after', 'by', 'with', 'against', 'of', 'on', 'at', 'for', 'over', 'near', 'beside']);
/** The outlet headlines (no upload, no post, no blocked outlet) that state, with no hedge and no question, that the name itself was arrested: { rows, outlets }. */
function arrestStated(ev, near, lex = null) {
  const arrest = TN.FAMILY.get('arrest');
  const last = near.split(' ').slice(-1)[0];
  const rows = ev.press.filter((r) => {
    if (r.youtube || r.blocked || r.fam === 'reddit' || /\?/.test(r.title)) return false;
    if (arrestGiven(r.title, near, lex)) return true;
    if (HEDGED.test(r.title)) return false;
    const m = TN.saidIn(r.title, arrest);
    if (!m) return false;
    const pre = words(r.title.slice(0, m.index));
    const at = pre.lastIndexOf(last);
    if (at < 0 || pre.length - 1 - at > ARREST_NEAR) return false;
    const start = at - (near.split(' ').length - 1);
    if (pre.slice(Math.max(0, start - 3), Math.max(0, start)).some((w) => NOT_THE_SUBJECT.has(w))) return false;
    // (nor someone of the name's, or the one who wronged it: "Jack Doherty's attacker arrested" is no arrest of his)
    return arrestOf(r.title, near) !== 'other';
  });
  return { rows, outlets: new Set(rows.map((r) => outletKey(r.outlet))).size };
}
// who a headline has arrested when it is not the name: the one who wronged it, or the case about it ("Mad Sandhu's shooter arrested",
// "Mad Sandhu murder case: one accused arrested", "Jack Doherty reacts after his attacker is arrested")
const ARRESTED_OTHER = /(?<![\p{L}\p{N}])(?:shooters?|killers?|murderers?|attackers?|stalkers?|assailants?|gunm[ae]n|suspects?|accused|intruders?|burglars?|robbers?|kidnappers?|abusers?|harassers?|m[ae]n|wom[ae]n|teens?|teenagers?|fans?|drivers?|murder|murdered|killing|slaying|homicide|shooting|stabbing|death|case|probe)(?![\p{L}\p{N}])/iu;
// (between an arrest and the name it is said of: "arrested for the murder of ...", "arrests man in ... case" are someone else's)
const ARREST_OF_ANOTHER = new Set(['for', 'in', 'over', 'after', 'of', 'who', 'whom', 'near', 'outside', 'at', 'with', 'against']);
/**
 * Whose arrest a headline tells, by where the name stands in it (collector only: a card never says someone was arrested on the
 * strength of a headline about the one who wronged them):
 *   'own'    "Jack Doherty arrested in Miami", "Jack Doherty's arrest", "Jack Doherty, 22, booked ...", "police arrest streamer Jack Doherty"
 *   'other'  "Mad Sandhu's shooter arrested", "Mad Sandhu murder case: one accused arrested", "six arrested for murder of ... Mad
 *            Sandhu", "man who punched Jack Doherty arrested"
 *   null     the line names no arrest, or not the name, or does not say whose it is
 */
function arrestOf(title, near) {
  const m = TN.saidIn(title, TN.FAMILY.get('arrest'));
  const nw = near.split(' ');
  const last = nw[nw.length - 1];
  if (!m || !mentions(hay(title), last)) return null;
  const mid = TN.spanAfter(title, last, m.index);
  if (!mid) {
    // the name comes after the noun: its own only right after it ("police arrest streamer Jack Doherty")
    const upTo = words(title.slice(m.index + m[0].length));
    const at = upTo.indexOf(last);
    const before = upTo.slice(0, Math.max(0, at - (nw.length - 1)));
    if (at < 0) return null;
    // (and only when nobody else stands before the noun, and the name is there whole: "Luke Daley Arrested Again As Guthrie Case
    // Lingers" arrests Luke Daley)
    const lead = title.slice(0, m.index).split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '')).filter(Boolean);
    const someoneElse = lead.some((w, i) => /^\p{Lu}[\p{L}’'-]+$/u.test(w) && !nw.includes(w.toLowerCase()) && (W.isFirstName(w.toLowerCase()) || (i > 0 && !W.inDict(w.toLowerCase()))));
    const whole = nw.every((w, i) => upTo[at - (nw.length - 1) + i] === w);
    if (someoneElse) return 'other';
    if (!whole) return null;
    return before.length <= ARREST_NEAR - 1 && !before.some((w) => ARREST_OF_ANOTHER.has(w) || ARRESTED_OTHER.test(w)) ? 'own' : 'other';
  }
  const pre = words(title.slice(0, m.index));
  const start = pre.lastIndexOf(last) - (nw.length - 1);
  const lead = pre.slice(Math.max(0, start - 3), Math.max(0, start));
  // (the name inside someone else's clause: theirs when the clause names who, else the line does not say)
  if (lead.some((w) => NOT_THE_SUBJECT.has(w))) return ARRESTED_OTHER.test(pre.slice(0, Math.max(0, start)).join(' ')) ? 'other' : null;
  const text = mid.text.replace(/^[’']s(?![\p{L}\p{N}])/u, '');
  if (ARRESTED_OTHER.test(text) || /[:;]/.test(text) || words(text).some((w) => TN.RELATION.has(w))) return 'other';
  if (/^\s*,[^,]{1,80},\s*$/.test(text)) return 'own';
  return words(text).length <= ARREST_NEAR ? 'own' : null;
}
/** Whose arrest a name's headlines tell: { own, others } (headlines counted once each; a question says nothing). */
function whoseArrest(titles, near) {
  const out = { own: 0, others: 0 };
  for (const t of titles) {
    if (/\?/.test(t)) continue;
    const whose = arrestGiven(t, near) ? 'own' : arrestOf(t, near);
    if (whose === 'own') out.own += 1;
    else if (whose === 'other') out.others += 1;
  }
  return out;
}
const ARREST_OTHERS_MIN = 2;
// what the name's headlines call it when the arrest is of the one who killed them
const KILLED = /(?<![\p{L}\p{N}])(?:murder|murdered|killing|killed|slain|slaying|shot dead|homicide)(?![\p{L}\p{N}])/iu;
// (an arrest a headline takes as given is stated too, whatever else the line hedges: "... allegedly threatened to shoot him during
// 'explosive' fight before his arrest" hedges the threat, never the arrest)
const ARREST_GIVEN = /(?<![\p{L}\p{N}])(?:before|after|following|since|amid|ahead of|prior to|wake of|led to|leading to)\s+(?:the\s+)?(?:(his|her|their)|((?:[\p{L}\p{N}.-]+\s+){0,2}[\p{L}\p{N}.-]+)[’']s)\s+arrest(?![\p{L}\p{N}])/iu;
/**
 * Whether a headline takes the name's own arrest as given: "... after Jack Doherty's arrest", "... before his arrest", "... before the
 * streamer's arrest". A pronoun or a role is the name's only when the line names nobody else; with someone of the name's in it (a
 * girlfriend, a brother) only a pronoun that cannot be theirs counts.
 */
function arrestGiven(title, near, lex = null) {
  const m = String(title || '').match(ARREST_GIVEN);
  if (!m || /\?/.test(title)) return false;
  const nw = near.split(' ');
  if (!mentions(hay(title), nw[nw.length - 1])) return false;
  // ("after Jack Doherty's arrest", "before the Kick streamer's arrest": whose it is, is the possessive's last word)
  const whose = m[2] ? keyOf(m[2]).split(' ').slice(-1)[0] : null;
  if (whose && nw.includes(whose)) return true;
  if (whose && !TN.ROLE.has(whose)) return false;
  if (TN.nameRuns(title).some((n) => !n.split(' ').some((w) => nw.includes(w)) && TN.personLike(n, lex))) return false;
  // (nor a handle or a lone name no dictionary knows, "Jack Doherty slams N3on after his arrest": whose "his" is, the line does not say)
  const others = String(title).slice(0, m.index).split(/\s+/).map((tok) => tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, ''))
    .filter((tok) => /^\p{Lu}/u.test(tok) && !nw.includes(keyOf(tok)) && !keyOf(tok).split(' ').every((w) => W.inDict(w) || TN.ROLE.has(w)));
  if (others.length) return false;
  const rel = words(title).map((w) => TN.RELATION.get(w)).find(Boolean) || (/(?<![\p{L}\p{N}])(?:gf|bf)(?![\p{L}\p{N}])/i.test(title) ? 'partner' : null);
  if (!rel) return true;
  if (whose) return false;
  return (/^his$/i.test(m[1]) && TN.RELATION_HER.has(rel)) || (/^her$/i.test(m[1]) && TN.RELATION_HIS.has(rel));
}
const DEATH_OWNER_MIN = 2;
const ADMISSION_OUTLETS = 2;
const ADMITS = /\b(?:admits?|admitted|admitting|admission|confirms?|confirming|confess(?:es|ed|ion)?|owns up|acknowledg\w+)\b/i;
const NOT_ADMITTED = /\b(?:den(?:y|ies|ied)|not|never|no|refus\w+|won['’]t|doesn['’]t|didn['’]t|yet to)\b(?:\s+\S+){0,3}\s+(?:admit|confirm|confess|acknowledg)/i;
const APOLOGISES = /\b(?:apologi[sz]es|apologi[sz]ed|apologi[sz]ing|issues? (?:an? )?(?:\S+ )?apology)\b/i;
/**
 * What an admitted claim is called once outlets carry the admission (admittedLine has already read it strictly: the verb right after the
 * name in two rows, and a line that says so): 'apology' when ADMISSION_OUTLETS outlets' headlines naming the subject say it apologised,
 * 'admission' when that many say it admits, confirms or confesses; else null, and the card stays "allegations". Every outlet counts,
 * a blocked one too; a post or an upload never does; nor a question or an admission the line says was refused.
 */
function admissionNoun(ev, subject) {
  const last = subject.split(' ').slice(-1)[0];
  const rows = ev.press.filter((r) => !r.youtube && r.fam !== 'reddit' && !/\?/.test(r.title) && mentions(hay(r.title), last));
  const count = (xs) => new Set(xs.map((r) => outletKey(r.outlet))).size;
  if (count(rows.filter((r) => ADMITS.test(r.title) && !NOT_ADMITTED.test(r.title))) < ADMISSION_OUTLETS) return null;
  return count(rows.filter((r) => APOLOGISES.test(r.title) && !APOLOGY_REFUSED.test(r.title))) >= ADMISSION_OUTLETS ? 'apology' : 'admission';
}

const EVENT_TEXT_MAX = 120;
/**
 * A headline without its kicker: two or more words shouted in capitals before the sentence, one of them a plain dictionary word
 * ("STREAMER ARREST British streamer ..."). A run of acronyms before a name is no kicker ("NFL MVP Josh Allen responds ...").
 */
function dropKicker(line) {
  const ws = String(line || '').split(/\s+/);
  let n = 0;
  while (n < ws.length && /^\p{Lu}{2,}[:,–—-]?$/u.test(ws[n])) n += 1;
  const plain = (w) => { const core = w.replace(/[^\p{L}]/gu, '').toLowerCase(); return core.length >= 4 && W.inDict(core); };
  return n >= 2 && n < ws.length && /^\p{Lu}\p{Ll}/u.test(ws[n]) && ws.slice(0, n).some(plain) ? ws.slice(n).join(' ') : String(line || '');
}
const EVENT_TEXT_WORDS = 4;
/**
 * One headline told as a timeline sentence (IDEAS-FEED D4): cleaned, sentence case, the names as the card spells them, the outlet's tone
 * out, a full stop; a post's or an upload's flat claim told as reported. null for a question, a line not fit to show, one too long
 * to cut at a clause, or too short to say anything. spelt: other names to respell, [[key, surface]].
 */
function eventText(row, subject, surface, f, lex, spelt = []) {
  // (an outlet's kicker in capitals before the headline is no part of the sentence: "STREAMER ARREST British streamer ... arrested")
  const clean = dropKicker(TN.cleanHeadline(row.title, row.outlet));
  if (!clean || /\?/.test(clean) || SF.unsafeLine(clean)) return null;
  const posted = row.fam === 'reddit' || row.youtube;
  if (posted && (TN.WRONGDOING.test(clean) || TN.POST_CLAIM.test(clean) || /\b(?:i|my|me|we|our)\b/i.test(clean))) return null;
  const last = subject.split(' ').slice(-1)[0];
  // (a flat claim is told as reported whoever printed it, as the card's own line is: "Kai Cenat paid Gorgeous Doll $200K to get an
  // abortion." in a timeline is as flat as it would be on the card. Collector only, 2026-10-12)
  const flat = !!f && TN.statesClaim(clean, f, last) && !(posted ? POST_HEDGE : TN.REPORTED).test(clean);
  const said = flat ? (posted ? TN.reported(clean, f) : TN.reportedClaim(clean, f)) : clean;
  let line = TN.recaseName(TN.sentenceLine(said, lex), subject, surface);
  for (const [key, shown] of spelt) line = TN.recaseName(line, key, shown);
  line = TL.tidyLine(TL.plainWords(line)).replace(/[.!…]+(['’"”]?)$/, '$1');
  if (line.length + 1 > EVENT_TEXT_MAX) {
    // (cut where a clause ends, never dropping who says so)
    const cut = [...line.matchAll(/[,;:]\s|\s[—–-]\s/g)].map((m) => m.index).filter((i) => i + 1 <= EVENT_TEXT_MAX && i >= 30).pop();
    if (cut === undefined || EVENT_SAYS_WHO.test(line.slice(cut))) return null;
    // (nor a cut that drops how it ended, or that it was not so: "... arrested in Miami on Saturday night, charges dropped hours later")
    if (EVENT_OUTCOME.test(line.slice(cut))) return null;
    line = line.slice(0, cut);
  }
  // (a sentence that no longer names who the row is about is someone else's: a heading cut off its headline. "From sneaking into
  // Edinburgh pubs at 15 to WrestleMania." under "Logan Paul $250K loss")
  if (mentions(hay(clean), last) && !mentions(hay(line), last)) return null;
  return line.split(/\s+/).length >= EVENT_TEXT_WORDS ? `${line}.` : null;
}
const EVENT_OUTCOME = /(?<![\p{L}\p{N}])(?:not|never|no|denies|denied|deny|dropped|dismissed|cleared|acquitted|released|withdrawn|withdrew|retracted|apologi[sz]\w+|false|fake|hoax|overturned|tossed)(?![\p{L}\p{N}])/iu;
const EVENT_SAYS_WHO = /\b(?:claims?|alleg\w+|says?|said|according to|report\w*|police|lawsuit|sources?|accus\w+|den(?:y|ies|ied|ial))\b/i;
// a headline that is a label and a clause ("Kai Cenat Threatens Lawsuit: Streamer rejects ...") reads worse than a plain one
const LABELLED = /[:;|]/;
const REPLY_NEAR = 1;
// the subject's own reply: its name, then the verb (a word between at most: "Kai Cenat finally responds")
const REPLY_KINDS = [['apology', /\b(?:apologi[sz]es|apologi[sz]ed)\b/i], ['admission', /\b(?:admits|admitted|confirms|confesses|confessed)\b/i],
  ['statement', /\b(?:responds|responded|addresses|addressed|speaks out|breaks (?:his|her|their) silence|issues (?:a )?statement)\b/i]];
const EVENT_FIRST_HOURS = 24;
const AROUND_BEFORE_HOURS = 12;
const AROUND_MAX = 16;
/**
 * A card's timed evidence, for the collector: the story's own rows (the ones that name the subject and say its noun, tell its line, or
 * its fallout: ownStory's reading), each with its time and what it is (an outlet's headline, a creators'-beat row, an upload, a post);
 * its searches as the store holds them; what people only lately type; who it is about; and the timeline's raw material (the first own
 * headline, the subject's replies, the new chapter, the newest own headline), each told as a sentence from one sentence-case headline of
 * an outlet that may word a line.
 */
function metaOf({ c, ev, f, said, noun, subject, surface, what, lex, now, chapter, denied, owned, sinceT, sinceRun, fresh, who, also, trace }) {
  const last = subject.split(' ').slice(-1)[0];
  const subj = new Set(subject.split(' '));
  const fam = said || f;
  const story = new Set(words(what || '').filter((w) => !subj.has(w) && !W.STOP.has(w) && w.length > 2));
  const claim = !!f && CLAIM_DRAMA.has(f.key);
  const tells = (r) => (!!fam && fam.re.test(r.title)) || (!!f && f.re.test(r.title)) || (claim && ADMITTED.test(r.title)) || new Set(words(r.title).filter((w) => story.has(w))).size >= OWN_LINE_WORDS;
  const named = ev.rows.filter((r) => mentions(hay(r.title), last) && r.t <= now + DAY);
  // (with no noun, a film or a show searched as itself, every row naming it is its own)
  const ownRows = named.filter((r) => !f || tells(r) || (r.youtube && keyOf(r.title) !== subject)).sort((a, b) => a.t - b.t);
  const kindOfRow = (r) => (r.fam === 'reddit' ? 'post' : r.fam === 'bluesky' ? 'social' : r.youtube ? 'upload' : r.beat || TC.CREATOR_PRESS.test(r.outlet || '') ? 'beat' : 'outlet');
  const own = ownRows.map((r) => ({ t: r.t, title: r.title, outlet: r.outlet || null, k: kindOfRow(r), ...(r.blocked ? { blocked: true } : {}),
    ...(r.fam === 'reddit' ? { sub: r.sub || null, rank: Number.isFinite(r.rankToday) ? r.rankToday : Number.isFinite(r.rankDay) ? r.rankDay : null, week: Number.isFinite(r.rankWeek) ? r.rankWeek : null } : {}) }));
  // Collector only (lines, 2026-10-11): what else the name's coverage says since the story began. The headline that tells a story
  // best often never says its noun ("... claims he's not allowed to post online anymore after signing a new contract" under a
  // "ban"): the line writer reads these beside the story's own rows; nothing is counted or dated by them.
  const ownSet = new Set(ownRows);
  const storyFrom = ownRows.length ? Math.max(sinceT || 0, ownRows[0].t) - AROUND_BEFORE_HOURS * 3600000 : Infinity;
  const around = named.filter((r) => !ownSet.has(r) && r.t >= storyFrom && r.fam !== 'reddit' && r.fam !== 'bluesky' && !r.youtube).sort((a, b) => b.t - a.t).slice(0, AROUND_MAX)
    .map((r) => ({ t: r.t, title: r.title, outlet: r.outlet || null, k: kindOfRow(r), ...(r.blocked ? { blocked: true } : {}) }));
  const spelt = chapter ? [[chapter.name, chapter.surface || chapter.name]] : [];
  const wordable = ownRows.filter((r) => !r.blocked && !r.youtube && r.fam !== 'reddit' && r.fam !== 'bluesky' && !W.isTitleCase(r.title.split(/\s+/)));
  const told = (r) => { const text = r ? eventText(r, subject, surface, f, lex, spelt) : null; return text ? { t: r.t, text, source: r.outlet || null } : null; };
  // (a plain line before a labelled one, an outlet's own before a re-host's copy, then the earliest)
  const plainFirst = (rows) => [...rows].sort((a, b) => Number(LABELLED.test(a.title)) - Number(LABELLED.test(b.title)) || Number(R.REHOST.test(a.outlet || '')) - Number(R.REHOST.test(b.outlet || '')));
  const firstOf = (rows) => plainFirst(rows).map(told).find(Boolean) || null;
  const replies = [];
  const denial = wordable.filter((r) => TN.DENIAL.test(r.title) && TN.denialClause(TN.cleanHeadline(r.title, r.outlet), subject, null, surface));
  if (denial.length) { const x = firstOf(denial.slice(0, 4)); if (x) replies.push({ ...x, kind: 'denial' }); }
  for (const [kind, re] of REPLY_KINDS) {
    const hits = wordable.filter((r) => { const m = r.title.match(re); if (!m || (kind === 'apology' && APOLOGY_REFUSED.test(r.title))) return false; const pre = words(r.title.slice(0, m.index)); const at = pre.lastIndexOf(last); return at >= 0 && pre.length - 1 - at <= REPLY_NEAR; });
    const x = firstOf(hits.slice(0, 4));
    if (x && !replies.some((y) => y.text === x.text)) replies.push({ ...x, kind });
  }
  const start = wordable.length ? Math.max(sinceT, wordable[0].t) : sinceT;
  const first = firstOf(wordable.filter((r) => r.t >= start && r.t <= start + EVENT_FIRST_HOURS * 3600000)) || firstOf(ownRows.filter((r) => r.fam === 'reddit').slice(0, 2));
  const newest = [...wordable].sort((a, b) => b.t - a.t).slice(0, 6).map(told).find(Boolean) || null;
  const chapterRows = chapter ? [...chapter.rows].filter((r) => !r.blocked).sort((a, b) => a.t - b.t) : [];
  const chapterText = chapterRows.length ? firstOf(chapterRows.filter((r) => !W.isTitleCase(r.title.split(/\s+/)))) || firstOf(chapterRows) : null;
  return {
    key: c.key, subject, surface, family: f ? f.key : null, noun: noun ? noun.noun : null, from: c.from,
    own, around, outletsOwn: new Set(ownRows.filter((r) => !r.youtube && r.fam !== 'reddit' && r.fam !== 'bluesky').map((r) => outletKey(r.outlet))).size, outletsAll: ev.outlets,
    trends: c.trends.map((t) => ({ key: t.key, geo: t.geo, keyword: t.keyword, volume: t.volume || 0, growth: t.growth || 0, start: t.start, end: t.end ?? null })),
    fresh: fresh.slice(0, 8), searched: !!ev.searched, newsAt: ev.newsAt || null, ytAt: ev.ytAt || null,
    wiki: c.wiki.length ? Math.max(...c.wiki.map((w) => w.views)) : null,
    sinceT, sinceRun: !!sinceRun, denied: !!denied, admitted: !!owned, creator: who.tier === 'creator', person: !!who.person,
    also: also || [], sources: (trace || []).map((x) => ({ source: x.source, t: x.t, text: x.text })),
    timeline: { first, replies, chapter: chapterText ? { ...chapterText, t: chapterRows[0].t, name: chapter.surface || chapter.name } : null, latest: newest },
  };
}
/**
 * The story's own headlines among a name's coverage: the ones that name the subject and say the card's noun, tell its line (two of
 * the line's own words), or, for a claim, its fallout ("... removed from MinnMax", "... confirms ..."); a creator's upload naming the
 * subject is the story still told. { outlets (who tell it), lately (rows of the last STILL_DAYS days, uploads included) }.
 */
function ownStory(ev, f, subject, what, now) {
  const last = subject.split(' ').slice(-1)[0];
  const subj = new Set(subject.split(' '));
  const story = new Set(words(what || '').filter((w) => !subj.has(w) && !W.STOP.has(w) && w.length > 2));
  const claim = !!f && CLAIM_DRAMA.has(f.key);
  const tells = (r) => (!!f && f.re.test(r.title)) || (claim && ADMITTED.test(r.title)) || new Set(words(r.title).filter((w) => story.has(w))).size >= OWN_LINE_WORDS;
  const named = ev.press.filter((r) => mentions(hay(r.title), last));
  const rows = named.filter((r) => !r.youtube && tells(r));
  // (an upload titled with the name alone is the name's own channel, no one talking about the story: "Candace Owens")
  const about = (r) => r.youtube && keyOf(r.title) !== subject && words(r.title).length >= subj.size + UPLOAD_ABOUT_WORDS;
  const lately = named.filter((r) => now - r.t < STILL_DAYS * DAY && (about(r) || (!r.youtube && tells(r)))).length;
  return { outlets: new Set(rows.map((r) => outletKey(r.outlet))).size, lately };
}

/**
 * A line from the post that broke a creators'-world story, when no outlet's headline tells it: the best-placed post of the week's top
 * of r/LivestreamFail or r/youtubedrama that names the subject and says the card's noun, six to twenty words, a plain statement (no
 * question, no first person, no quote, no loaded word), never one that states a wrongdoing claim; told as reported ("reportedly"
 * before what happened, unless the post already hedges). { what, t, text } or null.
 */
function postLine(ev, subject, f, lex) {
  const last = subject.split(' ').slice(-1)[0];
  // (a post that leads with the subject: its name in the first POST_LEAD_WORDS words)
  // (an arrest or a charge is never told by a post alone: one outlet says so too, or there is no line)
  if (f.key === 'arrest' && !outletSays(ev, f, last)) return null;
  const posts = ev.rows.filter((r) => r.fam === 'reddit' && TS.isCreatorBoard(r.sub) && Number.isFinite(postRank(r)) &&
    words(r.title).slice(0, POST_LEAD_WORDS).includes(last) && TN.says(r.title, f) && !POST_PLAY.test(r.title)).sort((a, b) => postRank(a) - postRank(b) || a.t - b.t);
  for (const r of posts) {
    const text = r.title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/[.…!\s]+$/, '').replace(/\s+/g, ' ').trim();
    const n = text.split(' ').length;
    if (n < POST_WORDS[0] || n > POST_WORDS[1] || /[?"“”]|\b(?:i|my|me|we|our|lul|lol|wtf|insane|notorious|disgusting|pathetic|clown|scammer|idiot)\b/i.test(text) ||
      TN.WRONGDOING.test(text) || TN.POST_CLAIM.test(text) || W.isTitleCase(text.split(' '))) continue;
    // (a post is hedged unless it hedges itself in so many words: its own verb, "police" or "says" hedge nothing)
    const told = POST_HEDGE.test(text) ? text : TN.reported(text, f);
    const what = TL.tidyLine(TN.recaseName(`${told.charAt(0).toUpperCase()}${told.slice(1)}`, subject, TN.nameSurface(subject, [r.title])));
    return { what: `${what}.`, t: r.t, text: r.title };
  }
  return null;
}
/** The drama noun of the best-placed post of the week's top POST_NOUN_RANK of r/LivestreamFail or r/youtubedrama naming a subject, or null. */
function postNoun(ev, near) {
  const last = near.split(' ').slice(-1)[0];
  const posts = ev.rows.filter((r) => r.fam === 'reddit' && TS.isCreatorBoard(r.sub) && Number.isFinite(postRank(r)) &&
    postRank(r) < POST_NOUN_RANK && mentions(hay(r.title), last) && !POST_PLAY.test(r.title)).sort((a, b) => postRank(a) - postRank(b) || a.t - b.t);
  for (const r of posts) {
    // (an arrest or a charge only a post tells is no card: one outlet's headline says it too)
    const x = TN.familiesIn(r.title).filter((y) => TN.DRAMA_FAMS.has(y.f.key) && (y.f.key !== 'arrest' || outletSays(ev, y.f, last)))
      .sort((a, b) => b.f.w - a.f.w || a.f.key.localeCompare(b.f.key))[0];
    if (x) return { f: x.f, noun: x.f.noun(x.surface), count: 1, share: 1 / Math.max(1, ev.rows.length), explained: 0, rank: postRank(r) };
  }
  return null;
}
/** A creators' post's place: in the week's top list, else twice its place in the day's (the day's tenth is about the week's twentieth). */
const postRank = (r) => (Number.isFinite(r.rankWeek) ? r.rankWeek : Number.isFinite(r.rankToday) ? POST_TODAY_W * r.rankToday : NaN);
const POST_TODAY_W = 2;
const POST_NOUN_RANK = 60;
const POST_LEAD_RANK = 25;
const POST_WORDS = [6, 20];
const POST_LEAD_WORDS = 5;
// a post that hedges itself, in so many words
const POST_HEDGE = /\b(?:reportedly|allegedly|alleged|accused|claims?|rumou?r\w*|unconfirmed)\b/i;
// a post about a game or a bit is no news of the person: "xQc gets arrested live on stream during GTA RP"
const POST_PLAY = /\b(?:gta|rp|roleplay|role-play|role play|in-game|in game|skit|parody|prank|pranked|fake|staged|acting)\b/i;
/** Whether an outlet's headline (no post, no upload) naming the subject says the family's noun. */
const outletSays = (ev, f, last) => ev.press.some((r) => !r.youtube && r.fam !== 'reddit' && TN.says(r.title, f) && mentions(hay(r.title), last));

/**
 * A story never peaked before it began: when the headlines that say the card's noun about its subject are busiest STORY_LATER_DAYS or
 * more after the name's own busiest day, that day was an older story's ("Tom Cruise" at the premiere, five days before 'Digger'
 * flopped), and the card's days are its own story's: the evidence with only those headlines and their busiest day, else as it is.
 */
function storyEvidence(ev, f, subject, min = STORY_OWN_MIN) {
  if (!f) return ev;
  const last = subject.split(' ').slice(-1)[0];
  const own = ev.press.filter((r) => f.re.test(r.title) && mentions(hay(r.title), last));
  if (own.length < min) return ev;
  const byDay = new Map();
  for (const r of own) { const d = Math.floor(r.t / DAY) * DAY; byDay.set(d, (byDay.get(d) || 0) + 1); }
  const [day, n] = [...byDay.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const peakT = day + DAY / 2;
  if (peakT - ev.peakT < STORY_LATER_DAYS * DAY) return ev;
  return { ...ev, press: own, peakT, peakCount: n, firstT: Math.min(...own.map((r) => r.t)) };
}
const STORY_OWN_MIN = 12; // (a noun in a handful of a name's headlines is an aside, whenever it came: "Anne Hathaway pregnancy" in 9 of 100)
const STORY_LATER_DAYS = 2;
// (a name the drama headlines lead with is thinly covered: two headlines saying its noun date its story)
const STORY_OWN_DRAMA = 2;
/**
 * A press story with no search of its own that broke in the last two days, in outlets enough to be read for itself: nine in ten of
 * its headlines are that new ("Prince Andrew lawsuit" the morning after, 63 outlets): YouTube's completions lag it.
 */
const brokeLately = (c, ev, now) => !c.trends.length && ev.outlets >= PRESS_DEMAND_OUTLETS && ev.press.filter((r) => now - r.t < 2 * DAY).length >= YOUNG_SHARE * ev.press.length;
const YOUNG_SHARE = 0.9;
const YOUNG_DRAMA_DAYS = 2;
/**
 * A new film or show searched as itself, with nothing argued about it yet, is searched for what critics make of it: how many of its
 * headlines are reviews, once its searches ask for them ("east of eden netflix review") and a share of the headlines are; else 0.
 */
function reviewsOf(c, titles, fresh) {
  if (![...c.related, ...fresh.map(keyOf)].some((q) => REVIEW_QUERY.test(q))) return 0;
  const n = titles.filter((t) => TN.REVIEWS.re.test(t)).length;
  return n >= Math.max(REVIEWS_MIN, REVIEWS_SHARE * titles.length) ? n : 0;
}
const REVIEW_QUERY = /\b(?:reviews?|rotten tomatoes)\b/;
const REVIEWS_MIN = 5;
const REVIEWS_SHARE = 0.1;
/**
 * An official nobody searches by name is titled by the league and the job, once a search says it so ("nfl referee suspended" under
 * "adrian hill": "NFL referee suspension"), in the plural when the line tells of more than one ("NFL suspends two officials ..."): the
 * title's words, or null.
 */
const LEAGUES = new Set(['nfl', 'nba', 'mlb', 'nhl', 'wnba', 'mls', 'ufc', 'fifa', 'uefa', 'ncaa', 'nrl', 'afl']);
const SEVERAL_OFFICIALS = /\b(?:officials|referees|refs|umpires|two)\b/i;
function officialWords(how, tw, noun, phrases, what) {
  if (how !== 'role' || !noun || !noun.f) return null;
  const roles = new Set(TN.OFFICIAL.values());
  const role = tw.find((w) => roles.has(w));
  const nw = words(noun.noun || '');
  if (!role || !nw.length) return null;
  const said = phrases.map(keyOf).map((q) => q.split(' ')).find((ws) => ws.length >= 2 && ws.length <= 4 && LEAGUES.has(ws[0]) &&
    ws.slice(1).some((w) => TN.OFFICIAL.get(w) === role) && noun.f.re.test(ws.join(' ')));
  if (!said) return null;
  const several = SEVERAL_OFFICIALS.test(what || '') && !/s$/.test(nw[nw.length - 1]);
  return [said[0], role, ...nw.slice(0, -1), `${nw[nw.length - 1]}${several ? 's' : ''}`];
}
/** An election's title by the country its line opens with, when the line never names the subject whole: "Brazil election runoff"; else null. */
function electionTitle(f, what, subject) {
  if (!f || f.key !== 'election' || !what || mentions(hay(what), subject)) return null;
  const first = (what.match(/^\p{Lu}[\p{L}]+/u) || [''])[0];
  if (!first || !R.PLACES.has(first.toLowerCase())) return null;
  return `${first} election${/\brun-?off\b/i.test(what) ? ' runoff' : ''}`;
}
/**
 * The name people search a person by when their searches type a title with the first name ("prince andrew" for "andrew mountbatten
 * windsor"): that query, or null.
 */
const ALIAS_TITLE = /^(?:prince|princess|king|queen|duke|duchess|lady|lord|sir|dame) \S+$/;
const searchedAlias = (c, subject) => [...c.related, ...c.trends.flatMap((t) => t.related || [])].map(keyOf)
  .find((q) => ALIAS_TITLE.test(q) && q.split(' ')[1] === subject.split(' ')[0] && !subject.split(' ').includes(q.split(' ')[0])) || null;
/** A searched phrase of places, the subject's last word and the noun ("russia plague outbreak" for "pneumonic plague"): its words, or null. */
function placedPhrase(subject, noun, phrases) {
  const head = subject.split(' ').slice(-1)[0];
  const nw = words((noun && noun.noun) || '');
  if (!nw.length) return null;
  for (const q of phrases.map(keyOf)) {
    const ws = q.split(' ');
    const rest = ws.filter((w) => w !== head && !nw.includes(w));
    if (ws.length <= 4 && ws.includes(head) && nw.every((w) => ws.includes(w)) && rest.length >= 1 && rest.every((w) => R.PLACES.has(w))) return [...rest, head, ...nw];
  }
  return null;
}
/** A title with its noun's hyphen back ("Michael McDonald long-lost son"): the words of a title lose it. */
const hyphenate = (title, noun) => (noun && /-/.test(noun.noun || '') ? title.replace(new RegExp(`\\b${noun.noun.replace(/-/g, ' ')}\\b`, 'i'), noun.noun) : title);
const IDENTITY = new Set(['lesbian', 'gay', 'bisexual', 'queer', 'closeted', 'trans', 'transgender', 'sexuality']);
const SOFTER = new Map([['outbreak', 'scare']]);
const ALSO_MIN = 2;
const ALSO_MAX = 4;
// a feud is two sides: its coverage says so in so many words
const MUTUAL = /\b(?:feud|feuding|beef|fallout|clash|clashes|rift|war of words|diss track|trade (?:barbs|blows|insults|shots)|back[- ]and[- ]forth)\b/i;
const MUTUAL_MIN = 2;
const PAUSED_SHARE = 0.4;
const PAUSED_MAX_WORDS = 3;
/**
 * The film or show a paused shoot is: the longest search of three words at most (its "the" off) that names no word of the subject
 * and that PAUSED_SHARE of the pause's titles carry whole ("the batman part ii" under "matt reeves"); its words, or null.
 */
function pausedWork(subject, phrases, famTitles) {
  const subj = subject.split(' ');
  const hays = famTitles.map((t) => words(t));
  const seen = new Set();
  const cands = [];
  for (const q of phrases.map(keyOf)) {
    const ws = q.split(' ').filter((w, i) => !(i === 0 && w === 'the'));
    const k = ws.join(' ');
    if (!ws.length || ws.length > PAUSED_MAX_WORDS || seen.has(k) || ws.some((w) => subj.includes(w)) || TN.familiesIn(k).length) continue;
    seen.add(k);
    const n = hays.filter((h) => ws.every((w) => h.includes(w))).length;
    if (n >= Math.max(2, PAUSED_SHARE * hays.length)) cands.push({ ws, n });
  }
  cands.sort((a, b) => b.ws.length - a.ws.length || b.n - a.n || a.ws.join(' ').localeCompare(b.ws.join(' ')));
  return cands.length ? cands[0].ws : null;
}
const SCREEN_FACETS = new Set(['ending', 'reveal', 'trailer', 'romance', 'look']);
const WORK_FACETS = new Set(['ending', 'trailer']);
const WEAK_FAMS = new Set(['prison', 'look', 'romance', 'reveal', 'ending', 'trailer', 'speech', 'performance', 'record', 'comeback', 'boxoffice']);
const DISPUTE_FAMS = new Set(['feud', 'lawsuit', 'backlash', 'allegations']);
const WORK_DISPUTE_MIN = 3;
const PERFORMER = /\b(?:actor|actress|singer|rapper|musician|comedian|presenter|host|personality|model|dancer|songwriter|band|youtuber|streamer|influencer)\b/i;
const SCREEN_SEARCH = 200000;
const SCREEN_FACET_SHARE = 0.15;

/** Named outlets that carried it, entertainment first, never a blocked one (it counts, it is not shown). */
function sourcesOf(rows) {
  const seen = new Map();
  for (const r of rows) {
    if (r.blocked || !r.outlet || /^google news$/i.test(r.outlet)) continue;
    const k = outletKey(r.outlet);
    const v = (R.ENT_PUBLISHER.test(r.outlet) ? 2 : 1) + (r.youtube ? -0.5 : 0);
    if (!seen.has(k) || seen.get(k).v < v) seen.set(k, { name: r.outlet, v, n: (seen.get(k)?.n || 0) + 1 });
  }
  return [...seen.values()].sort((a, b) => b.v - a.v || a.name.localeCompare(b.name)).map((x) => x.name).slice(0, 6);
}

// ---------- gates ----------
/** Whether a point lists: enough demand, still talked about, a noun (or a big search, or a film it is read for), and a sports name only for drama. */
function lists(p, now, ctxLex) {
  const { c, ev, noun } = p;
  const words5 = p.title.split(/\s+/).length;
  if (words5 < 1 || words5 > 5) return false;
  // a plain word alone is no talking point ("Prison", a trend over the Christa Pike coverage); a film's one-word name is
  if (words5 === 1 && W.inDict(keyOf(p.title)) && p.kind !== 'show') return false;
  // a talking point is told by a line that names it; a long news query is no name ("trump administration media workspace ban")
  if (!p.what || (c.key.split(' ').length > 4 && !(ctxLex && ctxLex.names && ctxLex.names.has(c.key)))) return false;
  // (a name the drama headlines lead with needs three outlets, or a post in the week's top 60 where creators' drama is argued)
  // (Collector only: or two creator-native signals alone, nativePair below: what Early is for, before any press volume exists)
  const demand = p.searchVolume >= 20000 || ev.outlets >= 5 || ev.redditBest < 3 || ev.redditWeek < REDDIT_WEEK_RANK || c.sustained ||
    c.wiki.some((w) => w.views >= WIKI_MIN_VIEWS) || (!!c.drama && (ev.outlets >= (c.creator ? DRAMA_CREATOR_OUTLETS : DRAMA_OUTLETS) || ev.redditWeek < DRAMA_WEEK_RANK)) ||
    nativePair(c, ev, noun).length >= NATIVE_PAIR;
  const live = c.trends.some((t) => t.end === null || (t.end ?? 0) >= now - DAY);
  const recent = live || ev.lastT >= now - 4 * DAY;
  if (!demand || !recent) return false;
  // a long news query about someone nobody searches by name, with no creator, Reddit or Wikipedia signal: a case, not a talking point
  // ("greg lui doj charges")
  if (p.parts.longTail < 1 && ev.youtube === 0) return false;
  // a plain word ("plague") lists only through a related query that named it ("Russia plague outbreak"); a name trending for
  // another trend's story folds into it
  if ((p.generic && p.how !== 'phrase') || p.aside) return false;
  // no noun: a film or show people are searching or reading about, or a person with a big search and a Wikipedia spike
  if (!noun || !noun.f) {
    if (p.work) return p.kind !== 'sports';
    return p.searchVolume >= 100000 && p.kind !== 'sports' && (p.kind === 'show' || (TN.personLike(c.key, ctxLex) && c.wiki.length > 0));
  }
  // (a noun no headline of the name says, only its searches ("country music" searched with "trailer"), under a line that does not say
  // it either, is no card: a title is never surer than its line. Collector only)
  if (noun.count === 0 && !TN.says(p.what, noun.f)) return false;
  if (p.kind === 'sports' && !TN.SPORTS_TALK.has(noun.f.key)) return false;
  // an event's performances and speeches are nobody's: the talking point is who gave one ("Madonna VMAs performance", never "VMAs 2026
  // performance")
  if (EVENT_FACETS.has(noun.f.key) && p.subject === c.key && c.related.filter((q) => EVENT_QUERY.test(q) && contains(q, c.key)).length >= EVENT_QUERIES) return false;
  // (a name whose coverage is games and seasons is a sports name, whatever its source: "Marcus Mariota injury" is a game report)
  if (!TN.SPORTS_TALK.has(noun.f.key) && ev.press.length >= 10 && ev.press.filter((r) => SPORTS_WORDS.test(r.title)).length >= SPORTSY_SHARE * ev.press.length) return false;
  // a press story nobody searched: "controversy" says nothing, and a noun in a sliver of the name's coverage is an aside, not what
  // people talk about ("Dua Lipa dress" in 6 of 90 titles), unless creators are already posting about it
  const unsearched = !c.trends.length && !c.parent;
  if (unsearched && noun.noun === 'controversy') return false;
  // (a name the drama headlines lead with is listed for its story, told by three outlets, a creator's by two, or by a post of the
  // week's top where creators' drama is argued: never for two tabloids' aside about a name in the news every day)
  if (unsearched && !!c.drama && p.own && p.own.outlets < (c.creator ? DRAMA_CREATOR_OUTLETS : DRAMA_OUTLETS) && ev.outlets >= OWN_BUSY_OUTLETS &&
    ev.redditWeek >= DRAMA_WEEK_RANK && ev.redditBest >= 3 && ev.youtube < 3) return false;
  // (nor the newest wave of a name the drama headlines lead with: its week's other coverage is no measure of it)
  // (nor a name a top-three post of the day is about where celebrities' drama is argued: "Ms. Rachel backlash")
  if (unsearched && !noun.wave && noun.count < PRESS_NOUN_SHARE * ev.rows.length && ev.youtube < 3 && ev.redditWeek >= REDDIT_WEEK_RANK && ev.redditBest >= 3) return false;
  // a name only the drama headlines gave is titled with a claim against it only when its line leads with it: the claim is that name's,
  // never someone else's in the same headline ("Olivia Dean song accused of copying Bill Withers classic" is no "Bill Withers allegations")
  // (or names it as the one the claim is made against, however late in the line: "Future's ex, Gorgeous Doll, alleges Kai Cenat paid
  // her $200K ..." is a claim against Kai Cenat. Collector only: the benchmark row left the list the cycle its name search landed)
  if (c.from === 'drama' && CLAIM_TITLED.has(noun.f.key) && !words(p.what).slice(0, CLAIM_LEAD_WORDS).includes(p.subject.split(' ').slice(-1)[0]) && !claimedOf(p.what, p.subject)) return false;
  // a split its line only looks back on is no news ("Michael Douglas makes rare comment on brief Catherine Zeta-Jones separation")
  // (never a split that is happening: "Mia Goth files for divorce from Shia LaBeouf after a decade of marriage" looks back at nothing.
  // Collector only: a 100K-search story left the list on the word "decade")
  if (noun.f.key === 'split' && LOOKS_BACK.test(p.what) && !SPLIT_NOW.test(p.what)) return false;
  // a response on its own is the aftermath of something the card does not name; "X reveal" says nothing until a context word does
  if (noun.f.key === 'reveal' && p.how === 'plain') return false;
  return noun.f.key !== 'response';
}

const PRESS_NOUN_SHARE = 0.15;
/**
 * Collector only (ios/IDEAS-FEED.md C3, "two creator-native signals alone"). The kinds of creator-native signal that tell a creator's
 * story with its own noun: a post on a creators' board (`post`), a creator's upload or a clip on a chart of the day (`made`), what
 * people only lately type into YouTube (`typed`), a headline of the creators' beat (`beat`). Each must name the subject AND say the
 * card's noun: a streamer's daily clips, or a name's standing completions, are no signal of any story. Two different kinds list the
 * story with no search, no second outlet and no top post behind it; whether it is tagged Early is the series' to say (lib/measure.js).
 */
function nativePair(c, ev, noun) {
  if (!noun || !noun.f || !(c.creator || ev.creatorSub)) return [];
  const last = c.key.split(' ').slice(-1)[0];
  const tells = (title) => mentions(hay(title), last) && TN.says(title, noun.f);
  const kinds = [];
  if (ev.rows.some((r) => r.fam === 'reddit' && TS.isCreatorBoard(r.sub) && Number.isFinite(postRank(r)) && postRank(r) < POST_NOUN_RANK && tells(r.title) && !POST_PLAY.test(r.title))) kinds.push('post');
  if (ev.rows.some((r) => r.youtube && tells(r.title))) kinds.push('made');
  if ((ev.completions || []).some((x) => x.fresh && TN.says(x.q, noun.f))) kinds.push('typed');
  if (ev.press.some((r) => !r.youtube && !r.blocked && (r.beat === true || TC.CREATOR_PRESS.test(r.outlet || '')) && tells(r.title))) kinds.push('beat');
  return kinds;
}
const NATIVE_PAIR = 2;
const DRAMA_OUTLETS = 3;
const OWN_BUSY_OUTLETS = 20; // (a name this many outlets print in a week is in the news whatever it does)
const DRAMA_CREATOR_OUTLETS = 2; // (a creator's story: the beat's outlet and one more)
const CLAIM_TITLED = new Set(['allegations', 'arrest', 'threats', 'scam', 'rumors']);
/**
 * Whether a line makes its claim against the name, wherever the name stands in it: right after the claim's verb ("... alleges Kai
 * Cenat paid her", "... accuses streamer Kai Cenat of ..."), or after "against" ("allegations against Kai Cenat"). Never a name the
 * claim only mentions further on ("Olivia Dean song accused of copying Bill Withers classic" is no claim against Bill Withers).
 */
function claimedOf(line, subject) {
  const sw = subject.split(' ');
  const last = sw[sw.length - 1];
  const text = String(line || '');
  for (const m of text.matchAll(CLAIM_VERB)) {
    const after = words(text.slice(m.index + m[0].length)).slice(0, CLAIMED_NEAR + 1);
    const start = after[0] === 'that' ? 1 : 0;
    const at = after.indexOf(last, start);
    // (between the verb and the name only who the name is: its own first names, its role, where it streams)
    if (at >= 0 && after.slice(start, at).every((w) => sw.includes(w) || TN.ROLE.has(w) || CLAIMED_ROLE.has(w))) return true;
  }
  return false;
}
const CLAIM_VERB = /(?<![\p{L}\p{N}])(?:alleges?|alleged|alleging|accus(?:es|ed|ing)|claims?|claimed|claiming|sues?|sued|suing|against)(?![\p{L}\p{N}])/giu;
const CLAIMED_NEAR = 4;
const CLAIMED_ROLE = new Set(['twitch', 'kick', 'youtube', 'tiktok', 'instagram', 'onlyfans', 'the', 'fellow', 'former', 'popular', 'famous', 'controversial', 'ex']);
const CLAIM_LEAD_WORDS = 6;
const DRAMA_WEEK_RANK = 60;
// (the verb, never the noun a line looks back on: "her split from")
const SPLIT_NOW = /\b(?:files?|filed|filing|divorc(?:es|ing|ed)|splits|splitting|(?<!\b(?:his|her|their|the|a|on|of|about)\s)split|separat(?:es|ing|ed)|calls? it quits|calling it quits|breaks? up|broke up|ends? (?:(?:his|her|their) )?marriage|finali[sz]\w+)\b/i;
const LOOKS_BACK = /\b(?:brief|decades?|years ago|rare comment|looks? back|looking back|recalls?|reconcil\w+|opens up about)\b/i;
const EVENT_FACETS = new Set(['performance', 'speech']);
// (an event: people ask where to watch it and who won: "where to watch vmas", "vma winners")
const EVENT_QUERY = /\b(?:where to watch|how to watch|what time|winners?|nominees?|performers?|lineup|red carpet|tickets?)\b/;
const EVENT_QUERIES = 2;
const SPORTS_WORDS = /\b(?:quarterback|qb|touchdown|nfl|nba|mlb|nhl|wnba|playoffs?|roster|coach|week \d+|innings|kickoff|halftime|league|fixture)\b/i;
const SPORTSY_SHARE = 0.3;

// ---------- 7 merge ----------
function samePoint(a, b) {
  if (a.title.toLowerCase() === b.title.toLowerCase() || a.subject === b.subject || (a.what && a.what === b.what)) return true;
  if (contains(keyOf(a.title), b.subject) && contains(keyOf(b.title), a.subject)) return true;
  // (a card whose line leads with the other card's name is that card's story, told by its second name: "Michael Douglas makes rare
  // comment on ... Catherine Zeta-Jones separation" under "Michael Douglas affair"; one card per person per news cycle)
  const ledBy = (p, q) => !!p.what && q.subject.includes(' ') && q.subject !== p.subject && contains(words(p.what).slice(0, q.subject.split(' ').length + LED_WORDS).join(' '), q.subject) &&
    !contains(words(p.what).slice(0, q.subject.split(' ').length + LED_WORDS).join(' '), p.subject);
  if (a.c && b.c && (ledBy(a, b) || ledBy(b, a))) return true;
  // the same noun about one family ("Presley Gerber death", "Cindy Crawford death": her son's): the other's name in its line
  const fam = (p) => (p.noun && p.noun.f ? p.noun.f.key : null);
  const surname = (p) => p.subject.split(' ').slice(-1)[0];
  if (fam(a) && fam(a) === fam(b) && a.what && b.what && (contains(keyOf(b.what), surname(a)) || contains(keyOf(a.what), surname(b)))) return true;
  // (the same noun, and one's titles mostly name the other: "Cornell University allegations" is the "Cornell 7" story)
  const names = (p, q) => p.ev.press.filter((r) => mentions(hay(r.title), q.subject)).length >= SAME_NAMED_SHARE * Math.max(1, p.ev.press.length);
  if (fam(a) && fam(a) === fam(b) && (names(a, b) || names(b, a))) return true;
  // (what one said and who hit back are one story: "Olivia O'Brien criticism" is the "Pete Davidson influencer comments" card, the
  // one whose headlines mostly name the other)
  const said = (p) => !!fam(p) && TN.SAID_FAMS.has(fam(p));
  if (a.c && b.c && said(a) && said(b) && a.subject.includes(' ') && b.subject.includes(' ') && (names(a, b) || names(b, a))) return true;
  // (one film or show: "Josh Hartnett Verity movie" is the "Verity movie" card)
  const screenName = (p) => p.subject.replace(/ (?:movie|film|show|series)$/, '');
  if (a.kind === 'show' && b.kind === 'show' && (contains(keyOf(a.title), b.subject) || contains(keyOf(b.title), a.subject) ||
    (a.what && contains(keyOf(a.what), screenName(b)) && b.c && b.c.trends.length) || (b.what && contains(keyOf(b.what), screenName(a)) && a.c && a.c.trends.length))) return true;
  // (one work under two names: "Chris Hansen Primetime feud" and Robert Pattinson's "Primetime movie")
  if (a.work && b.work && a.work.work && b.work.work && keyOf(a.work.work) === keyOf(b.work.work)) return true;
  // (the same noun, and one's line names the institution the other is titled by: "Jane Doe allegations", told by "... in Cornell rape
  // case", is the "Cornell 7 allegations" story)
  const house = (p) => (!TN.personLike(p.subject, null) && !W.inDict(p.subject.split(' ')[0]) && !W.isFirstName(p.subject.split(' ')[0]) ? p.subject.split(' ')[0] : null);
  if (fam(a) && fam(a) === fam(b) && ((house(a) && b.what && contains(keyOf(b.what), house(a))) || (house(b) && a.what && contains(keyOf(a.what), house(b))))) return true;
  // (the same noun about one institution: "Cornell 7 allegations", "Cornell University allegations")
  const lead = (p) => p.subject.split(' ')[0];
  if (fam(a) && fam(a) === fam(b) && lead(a) === lead(b) && !W.inDict(lead(a)) && !TN.personLike(a.subject, null) && !TN.personLike(b.subject, null)) return true;
  const ka = new Set(a.ev.press.map((r) => keyOf(r.title)));
  const shared = b.ev.press.filter((r) => ka.has(keyOf(r.title))).length;
  return shared >= 3 && shared >= 0.4 * Math.min(a.ev.press.length, b.ev.press.length);
}

const SAME_NAMED_SHARE = 0.15;
const LED_WORDS = 2;

/** The film or show a card is about: its work's name, else a show card's own subject without the "movie"; null for any other card. */
const filmName = (p) => (p.work && p.work.work ? keyOf(p.work.work) : p.c && p.kind === 'show' ? p.subject.replace(/ (?:movie|film|show|series)$/, '') : null);
const sameFilm = (a, b) => !!filmName(a) && filmName(a) === filmName(b);
/**
 * One film under several names ("verity", "verity movie", "josh hartnett" and his junket) is one card: the film's own with a
 * talking-point noun when there is one ("Verity box office" over "Josh Hartnett Verity movie"), else the hottest; at the group's top
 * score, or its own with the group's biggest search when that is more (one film's searches are one demand), and that search shown.
 */
function filmCard(group) {
  const own = (p) => !p.work && p.kind === 'show' && !!(p.noun && p.noun.f);
  const lead = group.find(own) || group[0];
  const best = Math.max(...group.map((p) => p.parts.search || 0));
  const demand = SEARCH_W * (lead.parts.search || 0) + ['press', 'creators', 'reddit', 'wiki', 'fresh', 'dispute', 'native'].reduce((n, k) => n + (lead.parts[k] || 0), 0);
  const rescored = own(lead) && demand > 0 ? lead.score * (demand + SEARCH_W * (best - (lead.parts.search || 0))) / demand : lead.score;
  const score = Math.max(rescored, ...group.map((p) => p.score));
  const searched = [...group].sort((a, b) => b.searchVolume - a.searchVolume)[0];
  return { ...lead, score, searchVolume: searched.searchVolume,
    out: { ...lead.out, heat: heatNumber(score), signals: { ...lead.out.signals, search: searched.out.signals.search || lead.out.signals.search } } };
}

/**
 * The talking points, biggest first. ctx: { trends (talk-sources rows), wiki, items ([{ title, t, outlet, fam, sub, rankDay, url }]:
 * every store row in the window, dropped and talk-only rows included), lookups (store.lookups), now, lex, words (the listed words) }.
 */
function build(ctx) {
  const items = ctx.items.map((i) => ({ ...i, h: hay(i.title) }));
  // (every page of Wikipedia's daily top 1000 by its words: a card's days of reading)
  const full = { ...ctx, items, wikiIndex: wikiDaysIndex(ctx.wikiLists) };
  const cands = candidates(full);
  // (the trending names, for a name that trends for another one's story)
  full.trendKeys = new Set(cands.filter((c) => c.from === 'trends' && searchScore(c.trends) >= ASIDE_HOST_SEARCH).map((c) => c.key));
  // (every big search still trending, by its words: what people are typing right now)
  full.liveSearches = (ctx.trends || []).filter((t) => t.end === null && t.volume >= LIVE_SEARCH_VOLUME && t.start <= ctx.now + DAY)
    .map((t) => ({ key: keyOf(t.keyword), geo: t.geo, start: t.start }));
  const points = cands.map((c) => pointOf(c, full)).filter((p) => lists(p, ctx.now, ctx.lex)).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  const kept = [];
  const films = new Map();
  for (const p of points) {
    const at = kept.findIndex((k) => samePoint(k, p));
    if (at < 0) kept.push(p);
    else if (sameFilm(kept[at], p)) films.set(at, [...(films.get(at) || [kept[at]]), p]);
    // (one story under two names is the card of the one the list leads with, at the pair's heat: "Jay Cinco split", a creator's, over
    // "Lala Baptiste split", the same breakup told by the name nobody is called a creator for)
    else if (p.out.drama && !kept[at].out.drama && p.noun && p.noun.f && kept[at].noun && kept[at].noun.f && p.noun.f.key === kept[at].noun.f.key) {
      kept[at] = { ...p, score: kept[at].score, out: { ...p.out, heat: kept[at].out.heat } };
    }
    // (a name whose week is its memoir is one card, the memoir's, whichever of the book's old stories is searched most: "Michael
    // Douglas memoir" over an affair of 1992 its co-star trends for, at that search's heat and with that search shown)
    else if (p.how === 'memoir' && kept[at].how !== 'memoir' && kept[at].subject === p.subject && kept[at].noun && kept[at].noun.f && MEMOIR_OVER.has(kept[at].noun.f.key)) {
      kept[at] = { ...p, score: kept[at].score, searchVolume: kept[at].searchVolume,
        out: { ...p.out, heat: kept[at].out.heat, signals: { ...p.out.signals, search: kept[at].out.signals.search || p.out.signals.search } } };
    }
  }
  // (one film under several names: its own card with a talking-point noun tells it, at the group's heat and biggest search)
  for (const [at, group] of films) kept[at] = filmCard(group);
  const taken = (w) => kept.some((k) => contains(keyOf(k.title), w.subject) || contains(w.subject, k.subject));
  const moments = momentPoints(ctx.moments, ctx.lex);
  // (a card the moments list tells under the same title takes the moments' vetted line: "Ed Sheeran faces backlash over alleged
  // Palestine stance")
  // (and a card with no search of its own, a Reddit or press name, takes the moments' title too when they tell its subject: the
  // moments' story step has weighed what that name's week is about, "Ed Sheeran backlash", not "Ed Sheeran diss")
  // (a searched card keeps its own plain line: the moments' headline is cut for a moment, "... talks affair with Kathleen Turner, growing up")
  const told = kept.map((k) => {
    const same = k.c && !k.c.trends.length && !k.c.parent && moments.find((x) => x.title.toLowerCase() === k.title.toLowerCase() && x.out.what);
    // (never over a drama name's newest wave: its last days' headlines say what it is about now, "Pete Davidson influencer comments")
    const unsearched = !same && k.c && !k.c.trends.length && !k.c.parent && !(k.noun && k.noun.wave) && moments.find((x) => x.subject === k.subject && x.out.noun && x.out.what);
    const m = same || unsearched;
    if (!m) return k;
    const said = TL.plainWords(TN.recaseName(m.out.what, k.subject, k.out.subject));
    const what = /[.!?]['’"”]?$/.test(said) ? said : `${said}.`;
    return { ...k, what, title: m.title, out: { ...k.out, title: m.title, noun: m.out.noun, what, trace: [...m.out.trace, ...k.out.trace] } };
  });
  kept.splice(0, kept.length, ...told);
  for (const m of moments) if (!taken(m)) kept.push(m);
  // (the words, crazes and the month's TikTok formats rank by their own heat: no seat holds a stale one up)
  // (Know Your Meme's memes of the week: a word "Words & trends" lists for the same meme keeps its card, at the higher heat)
  const memes0 = memePoints(full).filter((m) => !taken(m) && !m.keys.some((k) => kept.some((x) => contains(keyOf(x.title), k))));
  const covers = (w, m) => m.keys.some((k) => contains(w.subject, k) || contains(k, w.subject));
  const words0 = wordPoints(ctx.words, full.items).filter((w) => !taken(w)).map((w) => {
    const m = memes0.find((x) => covers(w, x));
    return m && m.score > w.score ? { ...w, score: m.score, out: { ...w.out, heat: m.out.heat, kind: 'meme', signals: { ...w.out.signals, ...m.out.signals } } } : w;
  });
  const memes = memes0.filter((m) => !words0.some((w) => covers(w, m)));
  const crazes = crazePoints(ctx.crazes, full).filter((w) => !taken(w) && ![...words0, ...memes].some((x) => contains(x.subject, w.subject) || contains(w.subject, x.subject)));
  const all = blend(kept, [...words0, ...memes, ...crazes]).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  if (ctx.debug) for (const p of all.slice(0, 50)) ctx.debug(`${p.score.toFixed(2)} ${p.title} | ${p.c ? `${p.c.from} ${p.c.key} ${JSON.stringify(Object.fromEntries(Object.entries(p.parts).map(([k, v]) => [k, +v.toFixed(2)])))} out=${p.ev.outlets} yt=${p.ev.youtube} n=${p.noun ? `${p.noun.noun}:${p.noun.count}` : '-'}` : 'word'}`);
  // (the list's first LIST_MAX by heat, and the people-drama cards just under the cut: the one list leads with them)
  // (the creators' own first among them: a small streamer's story has its turn under "Show more" before a celebrity's aside)
  const under = all.slice(LIST_MAX).filter((p) => p.out.drama && p.out.heat >= DRAMA_EXTRA_HEAT);
  const extra = new Set([...under.filter((p) => p.out.tier === 'creator'), ...under.filter((p) => p.out.tier !== 'creator')].slice(0, DRAMA_EXTRA));
  const listed = [...all.slice(0, LIST_MAX), ...under.filter((p) => extra.has(p))];
  // (every card's line printed the card's way: curly quotes, "and" for "&")
  return listed.map((p) => ({ ...p.out, what: p.out.what ? TL.tidyLine(p.out.what) : p.out.what,
    ...(p.out.latest ? { latest: { ...p.out.latest, text: TL.tidyLine(p.out.latest.text) } } : {}) }));
}

/**
 * A fair blend: what a creator can film today (the month's crazes, a sound, a trend, a meme the press calls a trend) has no search or
 * press of the size a story has, so the formats rank by their own demand against each other, the hottest of them at FORMAT_TOP_SHARE of
 * the hottest story ("Pumpkin head illusion" among the week's big stories, not under them), never below its own score and lifted at
 * most FORMAT_LIFT_MAX; the rest (a word, a fan-art meme) keep their own heat.
 */
function blend(stories, extras) {
  const storyTop = Math.max(0, ...stories.map((p) => p.score));
  const formatTop = Math.max(0, ...extras.filter((p) => p.filmable).map((p) => p.score));
  if (!storyTop || !formatTop) return [...stories, ...extras];
  return [...stories, ...extras.map((p) => {
    if (!p.filmable) return p;
    const score = Math.max(p.score, Math.min(p.score * FORMAT_LIFT_MAX, (p.score / formatTop) * FORMAT_TOP_SHARE * storyTop));
    return { ...p, score, out: { ...p.out, heat: heatNumber(score) } };
  })];
}
const FORMAT_TOP_SHARE = 0.5;
const FORMAT_LIFT_MAX = 1.6;
const DRAMA_EXTRA = 30;
const DRAMA_EXTRA_HEAT = 12; // (a small creators' story still has its row under "Show more")

/**
 * The creators' world's biggest names (a streamer, a YouTuber, a rapper: searched with their platform, or a top post of r/LivestreamFail
 * or r/youtubedrama), strongest first: each gets a newest-first search of its last two days, where a new chapter shows first.
 */
function recentNames(ctx) {
  const items = ctx.items.map((i) => ({ ...i, h: hay(i.title) }));
  const cands = candidates({ ...ctx, items });
  // (and a person trending for the first time today: the last two days are the whole story, "andrew mountbatten-windsor")
  return [...cands.filter((c) => c.fresh).slice(0, RECENT_FRESH),
    ...cands.filter((c) => c.related.some((q) => CREATOR_REL.test(q)) || c.reddit.some((r) => r.sub === 'livestreamfail' || r.sub === 'youtubedrama')).slice(0, RECENT_NAMES)]
    .map((c) => c.key);
}
const RECENT_NAMES = 5;
const RECENT_FRESH = 4;

/** Every name the run searches: the candidates' (talk-candidates.js lookupNames), Know Your Meme's memes of the week and the month's crazes after the head. */
function lookupNamesAll(ctx) {
  const names = lookupNames(ctx);
  const memes = kymMemes(ctx.items, ctx.now).filter((m) => m.entryT || m.explainerT || m.roundupT).map((m) => keyOf(TX.searchName(m))).filter((k) => k.split(' ').length <= 4);
  // (and the month's TikTok crazes: what people type after "pumpkin head illusion", who is already uploading it)
  const crazes = TX.crazeLookupNames(ctx.crazes);
  return [...new Set([...names.slice(0, MEME_LOOKUP_AT), ...memes.slice(0, MEME_LOOKUP_MAX), ...crazes, ...names.slice(MEME_LOOKUP_AT)])];
}
const MEME_LOOKUP_AT = 20;
const MEME_LOOKUP_MAX = 6;

module.exports = { build, lists, nativePair, candidates, relatedCandidates, lookupNames: lookupNamesAll, dramaLookupNames: (ctx) => TC.dramaLookupNames({ ...ctx, items: ctx.items.map((i) => ({ ...i, h: hay(i.title) })) }), recentNames, evidenceOf, pointOf, leadName, wordPoints, momentPoints, crazePoints, crazeTitle, WINDOW_DAYS,
  wikiDaysIndex, wikiCurveOf, momentumOf, makesClaim, hoaxOf, POST_PLAY, POST_HEDGE,
  // (the collector's own rules, held by test/honesty.test.js)
  arrestStated, arrestGiven, arrestOf, whoseArrest, claimedOf, admissionNoun, eventText, dropKicker, ARREST_OVER };
