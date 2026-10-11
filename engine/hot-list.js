'use strict';
/*
 * The Ideas tab's one list (ios/IDEAS-SPEC.md), ranked purely by how hot each thing is right now: every talking point, every
 * "Words & trends" entry no talking point already is, and every viral moment no talking point already tells, on the talking points'
 * own 0-100 heat (talk-extras.js: a listed word and a moment score as they would joining the talking points).
 *
 *   audience  "My audience" (US by default): the talking points were already weighed for it when built (their searches); a moment
 *             only British and Irish press carry counts as a British story, at Britain's weight for the audience (0.6 to the US, in
 *             full to the UK)
 *   buzz      older items sink by their heat and drop off once their buzz ends: a story or a moment fading three days past its peak
 *             (a story still searched or still covered is at its peak, however old: it sinks by its heat, it never vanishes: "Ken
 *             Urker death", 2M searches four days on), a word, sound, craze or meme fading 14 days on (a craze fades once no
 *             headline named it for a week, a meme once nothing new came for five days: talk-extras.js)
 *   order     heat, then rising before peaking before fading, then the pipeline's own order (talking points, words, moments)
 *   drama     the first TOP rows lead with people-drama talking points (owner, 2026-10-06: "Kai Cenat allegations" is the kind to see
 *             more of): a person, or the creators' own world, and a noun people argue about (talking-points.js marks them `drama`,
 *             with a `tier`). The page gives them DRAMA_MIN of its story rows before anything else gets one, when that many are live
 *             (still going, at DRAMA_MIN_HEAT or more: never padded with weak ones). Tier first, heat second: the creators' stories
 *             (streamers, YouTubers, TikTokers) at CREATOR_LEAD_HEAT or more lead in heat order, ahead of every musician's and
 *             celebrity's whatever its heat, when the page can lead with them (`known`: told by KNOWN_OUTLETS outlets, searched, or
 *             one creators already upload about); those keep STAR_ROWS rows of the page for their hottest, a person's death everyone
 *             is searching among them (`sought`: DEATH_BIG_SEARCH); a creators' story under CREATOR_LEAD_HEAT, or one only a post
 *             tells, is weighed among them (x TIER_W.creator against x TIER_W.celebrity); politics, royals and sport only when
 *             huge (a HUGE_SEARCH search), else from row TOP + 1. After the page the mix holds through row SPACED_TO in turns of
 *             MORE_EVERY rows: a creators' story still waiting (from DRAMA_MORE_HEAT), a musician's or celebrity's, then the
 *             hottest of everything else. Hard news never sits among them: once the drama has its rows, a
 *             row left over goes to something else only when everyone is searching it (an OTHER_PAGE_SEARCH search) and its heat x
 *             OTHER_W beats the next drama row's; with no drama left to show, the hottest of everything else fills the page
 *   formats   the first TOP rows are things to film, not a news digest: every FORMAT_EVERY-th row at the latest (3, 6, 9, 12, 15, 18) is
 *             a word, a craze, a meme or a sound still going; one a creator can film today first (a craze of the month's page, or a
 *             row whose line says what creators do with it: "Creators hold ...", "... used to ...", "Viral AI trend puts ..."), then
 *             the hottest ("Pumpkin head illusion" and "Hotel Lobby AI trend" before a meme that is only defined); the rows between
 *             stay in heat order
 *   somber    the first TOP rows carry no death, tribute, sentence or verdict (SOMBER) unless everyone is searching it (500K+: "Ken
 *             Urker death"), and no film or show titled bare over a casting or release line ("East of Eden": "Florence Pugh stars in
 *             ..."); they follow from the next row in heat order, the somber ones one in every SOMBER_EVERY rows at most through row
 *             SPACED_TO, so "Show more" never opens on a block of obituaries; nor any other film, show or game news (a finale, a
 *             box office, a review, a paused shoot: `screen`), which follows from row TOP + 1 too
 *   urgent    "Film within 24h" on the fastest climbers: rising, started today or yesterday and climbing hard (a search up 500%+, a
 *             search spike, what people only lately type into YouTube), the URGENT_MAX hottest of them; never a death, a tribute,
 *             a sentence or an execution (GRIM)
 *   spike     worth an alert ("Kai Cenat allegations is spiking"): a talking point rising, a day old at most, with a 100K+ search or
 *             three kinds of signal at once (a 20K+ search, creators' uploads, Reddit, a page read 50K+, 5+ outlets, fresh
 *             completions, a search spike); never a grim one
 *   moments   a moment's row is titled by its headline, cut at a clause when it runs past MOMENT_TITLE_WORDS words, never mid-word
 *             (momentTitle)
 *   words     a "Words & trends" row is titled in sentence case, a quote too long to search by the names in it ("Verity Backrooms
 *             meme"), and carries its meaning as one plain line (talk-extras.js plainLine)
 *
 * Nothing twice: a word a talking point already is (or a plain word's sense the talking points leave out, or a meme a story's own line
 * already tells: "... 'Verity' ... topping the box office, and a Minecraft meme helped" over "Verity Backrooms meme"), a moment a talking point's
 * card in full already tells (its line's, else the first about the same name), and every other moment of a talking point's story: one
 * about the shorter name its title leads with ("At Cornell, ..." under "Cornell 7 allegations") or naming someone else its coverage names
 * (`also`: "Trey McBride's fiery interaction with NFL official ..." under the referees' suspension).
 * Entries: { id, kind: 'talk' | 'word' | 'sound' | 'moment', title, heat, status, urgent, spike, line (a word row's only) }. The ids are
 * the app's card keys: "point:<title>", "word:<term>", "moment:<headline>".
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift (MVPCore IdeasHotList).
 */
const R = require('./rules');
const TC = require('./talk-candidates');
const TX = require('./talk-extras');
const SF = require('./story-focus');
const { outletKey } = require('./util');

const DAY = 864e5;
const STORY_BUZZ_DAYS = 3;
const WORD_BUZZ_DAYS = 14;
const URGENT_MAX = 3;
const URGENT_AGE_DAYS = 1;
const TOP = 20; // the list's first page
const DEATH_BIG_SEARCH = 500000;
const GRAVE = new Set(['death', 'tribute']);
// nothing a creator chasing views films: off the first page unless everyone is searching it
const SOMBER = new Set([...GRAVE, 'life sentence', 'sentencing', 'guilty verdict', 'verdict', 'guilty plea', 'funeral', 'prison life']);
// nothing to rush out a video about: no "Film within 24h", no spike alert
const GRIM = new Set([...SOMBER, 'execution', 'crash', 'shooting']);
const SOMBER_EVERY = 5;
const SPACED_TO = 40;
const FORMAT_EVERY = 3;
const FORMAT_FIRST = 3;
// a line that says what creators do with it: who films or posts what, how the clip is used, what the trend puts where
const DOABLE = /^(?:creators|people|users|couples|fans|everyone|the camera)\b|\b(?:creators?|people|users|couples|tiktokers)\s+(?:\w+\s+){0,2}(?:hold|film|post|use|lip-?sync|danc|walk|pose|record|shar|pair|swap|edit|put|turn|recreat|mak|add|stitch|duet)\w*|\bused (?:to|for|as|when|by)\b|\btrend (?:that\s+)?(?:puts|has|sees|shows|where|in which)\b|\b(?:challenge|dance|filter|transition|lip-?sync)\b/i;
// a film or show titled bare, told only by who is in it or that it is out: no talking point yet
const CASTING_LINE = /\b(?:stars? in|starring|premieres?|debuts?|now streaming|arrives on|lands on|drops on|adaptation|joins? (?:the )?cast)\b/i;
const DOING_LINE = /\b(?:box office|no\. ?1|number one|tops|topping|topped|opening weekend|record|chart|most-watched|top 10)\b/i;
// a story's line that tells a meme too
const MEME_SAID = /\b(?:memes?|trend|sound|audio)\b/i;
const MEME_WORD_MIN = 5;
const MEME_WORDS_SAID = 2;
const NAMES_ONLY = /^[^,]+,\s+[^,]+\s+reports$/i;
const MOMENT_TITLE_WORDS = 12;
const MOMENT_TITLE_MIN = 5;
const URGENT_GROWTH = 500;
const MOMENT_URGENT_DAYS = 1;
const SPIKE_AGE_DAYS = 1;
const SPIKE_SEARCH = 100000;
const SPIKE_KINDS = 3;
const REGIONAL_SHARE = 0.75;
const STATUS_RANK = { rising: 0, peak: 1, fading: 2 };
// the page leads with people-drama: at least DRAMA_MIN of its TOP rows when that many are live, creators first
const DRAMA_MIN = 14;
const DRAMA_MIN_HEAT = 28;
const DRAMA_MORE_HEAT = 20;
const MORE_EVERY = 3;
const MORE_DRAMA = 2;
const TIER_W = { creator: 1.25, celebrity: 1.1, politics: 1, sports: 1, other: 1 };
const STAR_TIERS = new Set(['creator', 'celebrity']);
const KNOWN_OUTLETS = 3;
const KNOWN_SEARCH = 20000;
const KNOWN_UPLOADS = 2;
// (or a top post of the week on the creators' own boards: where a streamer's story breaks before any outlet writes it up)
const KNOWN_REDDIT_WEEK = 10;
const OTHER_W = 0.9;
// tier first, heat second: a creators' story this hot leads the page ahead of every musician's and celebrity's, which keep STAR_ROWS
// rows of the page for their hottest
const CREATOR_LEAD_HEAT = 24;
const STAR_ROWS = 4;
// a musician's or celebrity's story sinks once its peak is behind it (the page is what people argue about right now): STAR_FRESH_DAYS
// days past its peak it counts x STAR_OLDER, STAR_OLD_DAYS past x STAR_OLD ("Rick Ross arrest", five days on, under "Chris Brown
// allegations")
const STAR_FRESH_DAYS = 2;
const STAR_OLD_DAYS = 4;
const STAR_OLDER = 0.85;
const STAR_OLD = 0.7;
// while people-drama is still waiting, a row of the page goes to anything else only when everyone is searching it (a search this big)
const OTHER_PAGE_SEARCH = 1000000;
// politics and sport only when huge: a search this big
const HUGE_SEARCH = 200000;
const MINOR_TIERS = new Set(['politics', 'sports']);

const wordLike = (p) => p.from === 'words' || p.from === 'crazes' || p.from === 'memes';
/** A talking point's kind of card: a sound, a word (a word, craze or meme), else a talking point. */
const pointKind = (p) => (p.kind === 'sound' ? 'sound' : wordLike(p) ? 'word' : 'talk');

/** Whole UTC days from a "2026-09-27" day to now's day; null when there is none. */
function daysSince(day, now) {
  const t = day ? Date.parse(`${day}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Math.floor(now / DAY) * DAY - t) / DAY));
}
/** How long a talking point has been going: since its first headline, else since its coverage peaked. */
const ageOf = (p, now) => daysSince(p.since, now) ?? p.daysAgo ?? null;

/** The kinds of signal a talking point shows at once. */
function signalKinds(s) {
  return [(s.search && s.search.volume) >= 20000, (s.youtube || 0) >= 1, s.reddit != null || s.redditWeek != null, (s.wikipedia || 0) >= 50000,
    (s.outlets || 0) >= 5, (s.fresh || []).length > 0, s.searchSpike === true].filter(Boolean).length;
}

/** The moment's outlets are British or Irish only: three of four, at least two (a re-host is from nowhere in particular). */
function britishOnly(m) {
  const outlets = [...new Set((m.sources || []).filter((o) => o && !R.REHOST.test(o)).map(outletKey))];
  if (outlets.length < 2) return false;
  const uk = outlets.filter((k) => (m.sources || []).some((o) => outletKey(o) === k && R.UK_OUTLET.test(o))).length;
  return uk >= REGIONAL_SHARE * outlets.length;
}

function pointEntry(p, now) {
  const s = p.signals || {};
  const age = ageOf(p, now);
  const climbing = (s.search && s.search.growth) >= URGENT_GROWTH || s.searchSpike === true || (s.fresh || []).length > 0;
  const grim = GRIM.has(p.noun || '');
  return { id: `point:${p.title}`, kind: pointKind(p), title: p.title, heat: p.heat, status: p.status,
    over: p.status === 'fading' && (p.daysAgo ?? 0) > (wordLike(p) ? WORD_BUZZ_DAYS : STORY_BUZZ_DAYS),
    // (a death, a tribute, a sentence or a verdict few are searching; a bare film or show over a casting line)
    sad: SOMBER.has(p.noun || '') && !((s.search && s.search.volume) >= DEATH_BIG_SEARCH),
    flat: p.kind === 'show' && !p.noun && !wordLike(p) && CASTING_LINE.test(p.what || '') && !DOING_LINE.test(p.what || ''),
    // (film, show and game news waits for "Show more"; so does politics and sport nobody is searching in the hundreds of thousands)
    screen: !wordLike(p) && (p.kind === 'show' || p.kind === 'game'),
    minor: !wordLike(p) && MINOR_TIERS.has(p.tier || '') && !((s.search && s.search.volume) >= HUGE_SEARCH),
    drama: !wordLike(p) && p.drama === true, tier: p.tier || 'other', big: (s.search && s.search.volume) >= OTHER_PAGE_SEARCH,
    // (a death everyone is searching, a person's: it keeps its place on the page among the musicians' and celebrities' stories)
    sought: !wordLike(p) && GRAVE.has(p.noun || '') && (s.search && s.search.volume) >= DEATH_BIG_SEARCH && STAR_TIERS.has(p.tier || ''),
    // (a creators' story the page can lead with: told by KNOWN_OUTLETS outlets, searched, or one creators already upload about; a
    // story only a post tells, about a name nobody has written up, is weighed with the rest)
    known: (s.outlets || 0) >= KNOWN_OUTLETS || (s.search && s.search.volume) >= KNOWN_SEARCH || (s.youtube || 0) >= KNOWN_UPLOADS ||
      (s.redditWeek != null && s.redditWeek <= KNOWN_REDDIT_WEEK),
    // (how long since it peaked: a story still rising or still at its peak today is new, whenever its first headline was)
    old: p.status === 'rising' ? 0 : p.daysAgo ?? null,
    // (a craze of the month's page is a format a creator can film today; any other format when its line says what creators do)
    film: p.from === 'crazes' || (wordLike(p) && DOABLE.test(p.what || '')),
    climber: !grim && p.status === 'rising' && age != null && age <= URGENT_AGE_DAYS && climbing,
    spike: !grim && p.status === 'rising' && age != null && age <= SPIKE_AGE_DAYS && ((s.search && s.search.volume) >= SPIKE_SEARCH || signalKinds(s) >= SPIKE_KINDS) };
}

function wordEntry(w) {
  const status = TX.wordStatusOf(w);
  // (the card's key keeps the list's spelling; the title is in sentence case: "Black cat clapping"; the line is its meaning, told plainly)
  const title = TX.wordName(w);
  const line = TX.plainLine(TX.shortTerm(w.term) ? null : w.kind === 'phrase' ? `“${title}”` : title, w.meaning);
  return { id: `word:${w.term}`, kind: w.kind === 'sound' ? 'sound' : 'word', title, heat: TX.heatNumber(TX.wordScore(w)), status,
    over: status === 'fading' && (w.lastSeenDaysAgo ?? w.daysAgo ?? 0) > WORD_BUZZ_DAYS, sad: false, flat: false, film: DOABLE.test(line || ''),
    climber: status === 'rising' && w.daysAgo <= URGENT_AGE_DAYS && w.searchSpike === true, spike: false, ...(line ? { line } : {}) };
}

function momentEntry(m, audience) {
  const weight = britishOnly(m) ? TC.geoWeight('GB', audience) : 1;
  return { id: `moment:${m.headline}`, kind: 'moment', title: momentTitle(m.headline), heat: Math.round(TX.heatNumber(TX.momentScore(m)) * weight), status: TX.momentStatusOf(m),
    over: m.heat === 'fading' && m.daysAgo > STORY_BUZZ_DAYS, sad: false, flat: false, film: false,
    climber: m.heat === 'rising' && m.daysAgo <= MOMENT_URGENT_DAYS && m.searchSpike === true, spike: false };
}

const CLAUSE = /[,;:]\s|\s[—–-]\s/g;
// who says so, or that it is only said: the part of a headline a cut never drops
const TITLE_SAYS_WHO = /\b(?:claims?|claimed|alleg\w+|says?|said|according to|report\w*|police|lawsuit|sources?|accus\w+|den(?:y|ies|ied|ial))\b/i;
const TITLE_JOINT = new Set(['after', 'as', 'while', 'amid', 'following', 'when', 'because', 'but']);
const TITLE_TAIL = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'and', 'or', 'as', 'after', 'over', 'amid', 'while', 'about', 'his', 'her', 'their']);
/**
 * A moment's row title: its headline, cut where a clause ends when it runs past MOMENT_TITLE_WORDS words ("..., charged for hinderin"
 * off), else before the clause a joining word starts; a headline with neither stays whole, and one its feed cut short loses the cut
 * word and a dangling "the" or "of". Never cut mid-word.
 */
function momentTitle(headline) {
  const cut = /(?:…|\.\.\.)\s*$/.test(String(headline || ''));
  const s = String(headline || '').replace(/\s*(?:…|\.\.\.)\s*$/, '').replace(/\s+/g, ' ').trim();
  const ws = s.split(' ');
  if (ws.length <= MOMENT_TITLE_WORDS && !cut) return s;
  // (a title is never surer than its line: a cut that drops who says so, ", a lawsuit filed on Monday claims", or leaves a line no
  // longer fit to show is not made, and the headline stays whole)
  const whole = (title) => (TITLE_SAYS_WHO.test(s.slice(title.length)) || (SF.unsafeLine(title) && !SF.unsafeLine(s)) ? s : title);
  let best = null;
  for (const m of s.matchAll(CLAUSE)) {
    const n = s.slice(0, m.index).split(' ').length;
    if (n >= MOMENT_TITLE_MIN && n <= MOMENT_TITLE_WORDS) best = s.slice(0, m.index);
  }
  if (best) return whole(best);
  // (else before the clause a joining word starts: "Gillian Anderson responds to backlash" for "... after telling fans to stop ...")
  const joint = ws.map((w, i) => (TITLE_JOINT.has(w.toLowerCase()) && i >= MOMENT_TITLE_MIN && i <= MOMENT_TITLE_WORDS ? i : -1)).filter((i) => i >= 0).pop();
  if (joint !== undefined) return whole(ws.slice(0, joint).join(' '));
  if (!cut) return s;
  const kept = ws.slice(0, ws.length - 1);
  while (kept.length > MOMENT_TITLE_MIN && TITLE_TAIL.has(kept[kept.length - 1].toLowerCase())) kept.pop();
  return kept.join(' ').replace(/[,;:]$/, '');
}

/**
 * The moment a talking point's card in full tells (the app's IdeasBoard.moment(for:)): the one whose headline is its line, else, for a
 * story about a name, the first moment about the same name; or null.
 */
function toldMoment(p, moments) {
  const line = p.what ? moments.find((m) => TC.keyOf(m.headline) === TC.keyOf(p.what)) : null;
  const subject = TC.keyOf(p.subject || '');
  return line || (!wordLike(p) && subject ? moments.find((m) => TC.keyOf(m.subject || '') === subject) : null) || null;
}

/**
 * The moments the talking points already tell: each card's own (toldMoment), and every other moment of a story's: one about the
 * shorter name its title leads with, or one whose headline names someone else the story's coverage names (`also`). Their headlines.
 */
function toldMoments(talkingPoints, moments) {
  const out = new Set();
  for (const p of talkingPoints) {
    const same = toldMoment(p, moments);
    if (same) out.add(same.headline);
    if (wordLike(p)) continue;
    const title = ` ${TC.keyOf(p.title)} `;
    const own = TC.keyOf(p.subject || '');
    for (const m of moments) {
      // (a second moment about the card's own name is another story: "Taylor Swift makes history at the VMAs" beside her SNL cameo)
      const subject = TC.keyOf(m.subject || '');
      const h = ` ${TC.keyOf(m.headline)} `;
      if ((subject && subject !== own && title.startsWith(` ${subject} `)) || (p.also || []).some((n) => h.includes(` ${n} `))) out.add(m.headline);
    }
  }
  return out;
}

/**
 * A listed word a story's own line already tells: the line calls it a meme, a trend or a sound and carries MEME_WORDS_SAID of the
 * word's longer words ("... 'Verity' ... and a Minecraft meme helped" for "Verity's from Minecraft, he belongs to Backrooms").
 */
function toldWord(w, talkingPoints) {
  const ks = [...new Set(TC.keyOf(w.term).split(' ').filter((k) => k.length >= MEME_WORD_MIN))];
  if (ks.length < MEME_WORDS_SAID) return false;
  return talkingPoints.some((p) => !wordLike(p) && p.what && MEME_SAID.test(p.what) &&
    ks.filter((k) => ` ${TC.keyOf(p.what)} `.includes(` ${k} `)).length >= MEME_WORDS_SAID);
}

/** The one list: { talkingPoints, words, moments } as the pipeline gives them, at `now` (ms) for `audience` (US, GB, AU, CA or mixed). */
function hotList({ talkingPoints = [], words = [], moments = [] } = {}, { now = Date.now(), audience } = {}) {
  // (a word a talking point already is, by its name or title, or a plain word's sense the talking points leave out)
  const named = new Set(talkingPoints.flatMap((p) => [TC.keyOf(p.subject || ''), TC.keyOf(p.title)]));
  const told = toldMoments(talkingPoints, moments);
  const all = [...talkingPoints.map((p) => pointEntry(p, now)), ...words.filter((w) => !named.has(TC.keyOf(w.term)) && !TX.plainMeaning(w) && !toldWord(w, talkingPoints)).map(wordEntry),
    // (nor a moment with no headline of its own, two names and "reports": "Jeffrey Archer, Jim Bakker reports" is no story's title)
    ...moments.filter((m) => !told.has(m.headline) && !NAMES_ONLY.test(m.headline)).map((m) => momentEntry(m, audience))].map((e, i) => ({ ...e, i }));
  // (equal heat: rising first, then the pipeline's own order, talking points, words, moments)
  const kept = all.filter((e) => !e.over)
    .sort((a, b) => b.heat - a.heat || STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.i - b.i);
  const urgent = new Set(kept.filter((e) => e.climber).slice(0, URGENT_MAX).map((e) => e.id));
  return firstPage(kept).map((e) => ({ id: e.id, kind: e.kind, title: e.title, heat: e.heat, status: e.status, urgent: urgent.has(e.id), spike: e.spike,
    ...(e.drama ? { drama: true } : {}), ...(e.line ? { line: e.line } : {}) }));
}

/**
 * The ranked rows with the first TOP laid out as a page of things to film: in heat order, but every FORMAT_EVERY-th row at the latest
 * (from row FORMAT_FIRST) a format still going (a word, a craze, a meme, a sound: one a creator can film today first, then the hottest),
 * and nothing somber or flat (a death few are searching, a bare film over a casting line): those wait and follow from the next row in
 * heat order with everything else, the somber ones SOMBER_EVERY rows apart at least through row SPACED_TO.
 */
function firstPage(ranked) {
  const isFormat = (e) => e.kind === 'word' || e.kind === 'sound';
  const queue = ranked.map((e, at) => ({ e, at })).filter((x) => isFormat(x.e) && x.e.status !== 'fading')
    .sort((a, b) => (b.e.film ? 1 : 0) - (a.e.film ? 1 : 0) || b.e.heat - a.e.heat || a.at - b.at).map((x) => x.e);
  // (the page's stories: nothing somber, flat, screen news or minor)
  const paged = (e) => !isFormat(e) && !e.sad && !e.flat && !e.screen && !e.minor;
  // (a musician's or celebrity's story by how fresh it is too; the creators' own keep their heat)
  // (nor a death everyone is still searching: it keeps its row)
  const aged = (e) => (e.tier === 'creator' || e.sought || e.old == null || e.old <= STAR_FRESH_DAYS ? 1 : e.old <= STAR_OLD_DAYS ? STAR_OLDER : STAR_OLD);
  const lead = (e) => e.heat * (TIER_W[e.tier] || 1) * aged(e);
  const byLead = (xs) => xs.map((e, at) => ({ e, at })).sort((a, b) => lead(b.e) - lead(a.e) || a.at - b.at).map((x) => x.e);
  const live = ranked.filter((e) => paged(e) && (e.drama || e.sought) && e.status !== 'fading' && e.heat >= (e.tier === 'creator' && e.drama ? CREATOR_LEAD_HEAT : DRAMA_MIN_HEAT));
  // (the formats' rows of the page, and the stories')
  const formatRows = Math.min(queue.length, TOP < FORMAT_FIRST ? 0 : Math.floor((TOP - FORMAT_FIRST) / FORMAT_EVERY) + 1);
  const storyRows = TOP - formatRows;
  // (tier first, heat second: the creators' stories hot enough to lead, in heat order, ahead of every musician's and celebrity's; the
  // hottest STAR_ROWS of those keep their rows of the page; a creators' story under CREATOR_LEAD_HEAT is weighed among them)
  const leads = (e) => e.drama && e.tier === 'creator' && e.heat >= CREATOR_LEAD_HEAT && e.known;
  const creators = live.filter(leads);
  const stars = live.filter((e) => !leads(e));
  const leadRows = Math.min(creators.length, Math.max(0, storyRows - Math.min(stars.length, STAR_ROWS)));
  const dramas = [...creators.slice(0, leadRows), ...byLead([...stars, ...creators.slice(leadRows)])];
  const leading = new Set(dramas.map((e) => e.id));
  const plain = ranked.filter((e) => paged(e) && !leading.has(e.id));
  // (how many of the page's story rows the drama is owed before anything else gets one)
  const owed = Math.min(dramas.length, DRAMA_MIN, storyRows);
  const used = new Set();
  const out = [];
  let formats = 0;
  let told = 0;
  while (out.length < TOP) {
    const slots = out.length + 1 < FORMAT_FIRST ? 0 : Math.floor((out.length + 1 - FORMAT_FIRST) / FORMAT_EVERY) + 1;
    const due = formats < slots ? queue.find((e) => !used.has(e.id)) : null;
    const drama = dramas.find((e) => !used.has(e.id)) || null;
    // (anything else: while drama is waiting, only what everyone is searching)
    const other = plain.find((e) => !used.has(e.id) && (!drama || e.big)) || null;
    // (a row for anything else only once the drama has its share of the page, and only when it is the hotter)
    const story = drama && (!other || told < owed || lead(drama) >= other.heat * OTHER_W) ? drama : other || drama;
    const pick = due || story;
    if (!pick) break;
    used.add(pick.id);
    out.push(pick);
    if (isFormat(pick)) formats += 1; else if (leading.has(pick.id)) told += 1;
  }
  // (after the page: heat order again, the people-drama still going weighed as on the page, a somber row only once SOMBER_EVERY - 1
  // others have gone by since the last)
  // (and "Show more" keeps the page's mix through row SPACED_TO, in turns of MORE_EVERY rows: a creators' story still waiting (a
  // smaller one too, from DRAMA_MORE_HEAT), then a musician's or celebrity's, then the hottest of everything else; a turn nobody is
  // waiting for goes to the other people-drama, then to the rest)
  const more = (e) => !used.has(e.id) && e.drama && !e.sad && !e.screen && !e.minor && e.status !== 'fading' && e.heat >= DRAMA_MORE_HEAT;
  const waiting = new Set(ranked.filter(more).map((e) => e.id));
  const weigh = (e) => (waiting.has(e.id) || leading.has(e.id) ? lead(e) : e.heat * OTHER_W);
  const rest = ranked.map((e, at) => ({ e, at })).filter((x) => !used.has(x.e.id)).sort((a, b) => weigh(b.e) - weigh(a.e) || a.at - b.at).map((x) => x.e);
  const somber = rest.filter((e) => e.sad);
  const dramas2 = rest.filter((e) => !e.sad && waiting.has(e.id));
  const others = rest.filter((e) => !e.sad && !waiting.has(e.id));
  const rank = new Map(rest.map((e, i) => [e.id, i]));
  let gap = SOMBER_EVERY - 1;
  let turn = 0;
  while (somber.length || others.length || dramas2.length) {
    const spaced = out.length < SPACED_TO;
    // (a drama row's turn: the first MORE_DRAMA of every MORE_EVERY rows through row SPACED_TO, a creators' story on the first of
    // them and a musician's or celebrity's on the second when one is waiting; after that row, by weight like the rest)
    const dramaTurn = dramas2.length > 0 && (spaced ? turn % MORE_EVERY < MORE_DRAMA || !(others.length || somber.length) :
      !others.length || rank.get(dramas2[0].id) < rank.get(others[0].id));
    if (dramaTurn || (!others.length && !somber.length)) {
      const creatorsTurn = turn % MORE_EVERY === 0;
      const at = spaced ? dramas2.findIndex((e) => (e.tier === 'creator') === creatorsTurn) : 0;
      out.push(dramas2.splice(at < 0 ? 0 : at, 1)[0]);
      gap += 1;
      turn += 1;
      continue;
    }
    const sadNext = somber.length > 0 && (!others.length || (rank.get(somber[0].id) < rank.get(others[0].id) && (!spaced || gap >= SOMBER_EVERY - 1)));
    if (sadNext) { out.push(somber.shift()); gap = 0; } else { out.push(others.shift()); gap += 1; }
    turn += 1;
  }
  return out;
}

module.exports = { hotList, toldMoment, toldMoments, momentTitle, daysSince, signalKinds, britishOnly, STORY_BUZZ_DAYS, WORD_BUZZ_DAYS, URGENT_MAX, SPIKE_SEARCH,
  // (the collector reads these: no alert, no Early tag and no time left on a grim row; no time left on a somber one)
  GRIM, SOMBER, TOP, wordLike, pointKind };
