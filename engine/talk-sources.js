'use strict';
/*
 * Sources for the talking points [talking-points.js]: what people are searching and saying about a name this week, all keyless.
 *   Trends      Google Trends "Trending now" (the same 7-day reply the moments read), every category kept: keyword, search volume,
 *               growth, categories and every related query ("kai cenat" 100K+ +500%: reggie, rakai, reggie travers)
 *   name news   one Google News RSS search per trending name, '"<name>" when:7d': every outlet counts (blocked ones too, for counting
 *               only), YouTube uploads among them are creators already posting about it, and the nouns its titles repeat are the
 *               talking point ("allegations" in 21 of 54)
 *   YouTube     YouTube search suggestions for '<name> ' (one request a name): Google marks completions people only started typing
 *               lately (subtype 3: "kai cenat allegations", "kai cenat responds to reggie"); they confirm the wording
 *   drama       three Google News RSS searches for people-drama as headlines word it, a role word crossed with the nouns a talking
 *               point carries ('(streamer OR youtuber OR tiktoker OR influencer) (allegations OR accused OR arrested ...) when:3d', the
 *               same roles with what was said and answered, and '(rapper OR singer OR actor OR actress) (...) when:2d'): the creator
 *               and celebrity stories no search list carries yet ("Streamer BenDaDonnn, security guard arrested ...", "Lady Gaga
 *               apologizes to Golloria ..."). Sixteen plain terms at most and no quoted phrase: a longer query makes Google News
 *               drop its "when:" window, so every row older than TALK_DRAMA_MAX_DAYS is dropped on reading. Talk-only rows
 *   beat        two more Google News RSS searches, by where a story is filed instead of what its headline says: the creators' beat
 *               ('site:sportskeeda.com/us/streamers OR site:dexerto.com/twitch OR site:dexerto.com/kick OR site:dexerto.com/youtube OR
 *               site:dexerto.com/tiktok when:3d': every streamer's and YouTuber's story of the last three days, about twenty rows, each
 *               flagged `beat`: its headline is a creator's whatever words it uses: "Mizkif leaks Malena Tudi's private Instagram
 *               Story ...", "Who is TokyoHarri? Kick streamer's associate gets attacked ...") and a pop-culture desk
 *               ('site:complex.com/pop-culture when:2d': a second outlet for the celebrity and rapper stories of the day)
 *   roster      who is a creator, from Wikipedia's own categories (keyless, MediaWiki's search API, 500 pages a request with each
 *               page's short description, refreshed once a week): every page under "Twitch (service) streamers" and "Kick
 *               (service) streamers" not described as something else first (a rapper, a wrestler, a chess grandmaster who also
 *               streams), and the pages under "TikTokers" and "YouTubers" (the 1,000 and 1,500 most linked) whose description
 *               says so ("American YouTuber and educator"). Nothing typed in: the list is the editors'
 *   Reddit      top of the week of r/LivestreamFail and r/youtubedrama, 100 posts (where streamer and YouTuber drama is talked about
 *               first; the list's lower half is the last day's posts), the run's FIRST Reddit request; then
 *               r/OutOfTheLoop (what people ask to have explained: "What is going on with Chris Hansen accusing the movie Primetime"),
 *               its last, each 61 s after the one before (Reddit allows ~1 anonymous RSS request a minute; Reddit is reported
 *               to end its RSS feeds in November 2026 and its free API in March 2027: the creators'-world signal then has to come from
 *               keyless feeds already read, Dexerto's RSS, Bluesky's trending topics, YouTube's completions and the uploads among a
 *               name's Google News results, and Know Your Meme's newsroom for "what is going on with ..."). Their rows
 *               keep their place in the week's list (rankWeek) under their own key, and feed the talking points only (talkOnly),
 *               never the moments or "Words & trends" (a top-of-day row of the same post stays the moments')
 *   Wikipedia   Wikimedia's daily top 1000 of English Wikipedia (keyless, one request a day, a past day's list never changes): a
 *               page read 10x its week-old level, 25K+ views, is a name the week's lists missed ("Shivon Zilis" 1K -> 50K a day,
 *               below the most-read feed's ~50 articles)
 *   crazes      NewEngen's monthly "<Month> TikTok Trends" page (robots allows it; one request a few days apart, last month's once):
 *               the month's named formats ("Pumpkin Head Illusion", "Ramalama Costume Walk") with what each one is; a format the
 *               previous month's page already listed is a carry-over, not new
 *               then the same two subreddits' top of the day (the run's SECOND Reddit request: a story that broke last night is not
 *               in the week's hundred yet)
 * Saved under the run's raw folder as tp-news-<key>.xml, tp-yt-<key>.txt, tp-drama-<id>.xml, tp-reddit-streamers.rss, tp-reddit-today.rss,
 * tp-reddit-ootl.rss, wiki-top-<day>.json, wiki-roster-<category>-<offset>.json and tp-crazes-<year>-<month>.html, so a cached rebuild
 * replays them.
 */
const fs = require('fs');
const path = require('path');
const S = require('./sources');
const ST = require('./store');
const W = require('./wording');

const DAY = S.DAY;
const TALK_NEWS_DAYS = 7;
const TALK_NEWS_GAP_MS = 1000; // Google News searches, one at a time
const TALK_YT_GAP_MS = 600;
const TALK_FRESH_HOURS = 20; // a name searched within this many hours is not searched again
// (the list's head is searched again on a refresh three hours on: a card's title and line follow its newest headline, "Caleb Flynn
// guilty verdict" becomes his life sentence the day he is sentenced)
const TALK_HEAD = 12;
const TALK_HEAD_FRESH_HOURS = 3;
const TALK_LOOKUP_MAX = 70; // names searched per refresh (each one Google News search and one YouTube suggestion request)
// the week's top posts: streamer and YouTuber drama, then what people ask to have explained
// (the creators' list is the run's first Reddit request, 100 posts deep: the week's top 50 are days old, the next 50 reach today's)
const TALK_REDDIT_FIRST = { file: 'tp-reddit-streamers.rss', url: 'https://www.reddit.com/r/LivestreamFail+youtubedrama/top/.rss?t=week&limit=100' };
// (and their top of the day, the run's second: last night's story is not in the week's hundred yet)
const TALK_REDDIT_TODAY = { file: 'tp-reddit-today.rss', url: 'https://www.reddit.com/r/LivestreamFail+youtubedrama/top/.rss?t=day&limit=50' };
const TALK_REDDIT = [
  { file: 'tp-reddit-ootl.rss', url: 'https://www.reddit.com/r/OutOfTheLoop/top/.rss?t=week&limit=50' },
];
// people-drama as headlines word it: who (a role word) crossed with the nouns a talking point carries. Sixteen plain terms at most and
// no quoted phrase: Google News drops the "when:" window of a longer query
const TALK_DRAMA = [
  { id: 'creators', days: 3, q: '(streamer OR youtuber OR tiktoker OR influencer) (allegations OR accused OR arrested OR lawsuit OR backlash OR apology OR drama OR feud OR banned OR exposed OR breakup OR divorce)' },
  { id: 'said', days: 3, q: '(streamer OR youtuber OR tiktoker OR influencer) (responds OR slammed OR controversy OR leaked OR claims OR denies OR apologizes OR quits OR slapped OR criticized OR beef OR comments)' },
  { id: 'celebs', days: 2, q: '(rapper OR singer OR actor OR actress) (allegations OR accused OR arrested OR lawsuit OR backlash OR apologizes OR feud OR slammed OR responds OR denies OR threats OR custody)' },
  // by where a story is filed, whatever its headline says: the creators' beat (every row a creator's story: `beat`), a pop-culture desk
  { id: 'beat', days: 3, beat: true, q: 'site:sportskeeda.com/us/streamers OR site:dexerto.com/twitch OR site:dexerto.com/kick OR site:dexerto.com/youtube OR site:dexerto.com/tiktok' },
  { id: 'pop', days: 2, q: 'site:complex.com/pop-culture' },
  // Collector only (decision 9: streamer clips and moments): what happened on a stream, as the outlets that watch streams word it
  // ("OhnePixel cries on stream after reading a Reddit post ...", "Asmongold vs Macaiyla: xQc's remark adds fresh tension ...")
  { id: 'stream', days: 2, q: '(streamer OR "twitch streamer" OR "kick streamer") ("on stream" OR "live on stream" OR "during stream" OR "mid-stream" OR livestream)' },
];
const TALK_BEAT_IDS = new Set(TALK_DRAMA.filter((d) => d.beat).map((d) => d.id));
const TALK_DRAMA_FILES = /^tp-drama-([a-z]+)\.xml$/;
const TALK_DRAMA_MAX_DAYS = 5; // (a reply whose window Google News dropped: rows months old)
const talkDramaUrl = (d) => S.gnSearch(`${d.q} when:${d.days}d`);
const TALK_REDDIT_FILES = /^tp-reddit-[a-z]+\.rss$/;
const TALK_NEWS_FILES = /^tp-news-([a-z0-9]+)\.xml$/;
// the newest two days of a creators'-world story, searched apart: a new accuser lands after the week's 100 results
const TALK_RECENT_FILES = /^tp-recent-([a-z0-9]+)\.xml$/;
const TALK_RECENT_DAYS = 2;
const TALK_RECENT_MAX = 9;
const TALK_YT_FILES = /^tp-yt-([a-z0-9]+)\.txt$/;
const TRENDS_FILES = /^(?:google-trends-batchexecute-i0OFE-(US|GB|AU)-168\.txt|trends-i0OFE-(US|GB|AU)-168h\.txt)$/;
const GEO_W = { US: 1.0, GB: 0.6, AU: 0.6 };
// a YouTube completion Google marks as recent: people only started typing it lately
const FRESH_SUBTYPE = 3;

const talkKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
// an outlet on a country domain far from every audience the list is built for (US, UK, Australia, Canada): a region's own story
const FAR_DOMAIN = /\.(?:in|pk|bd|lk|np|ng|gh|ke|za|ph|my|id|vn|ae|sa|qa|eg|tr|kr|jp|cn|hk|tw|th)(?:\/|$)/i;
const talkNewsUrl = (name, days = TALK_NEWS_DAYS) => S.gnSearch(`"${name.replace(/["“”]/g, '')}" when:${days}d`);
const talkSuggestUrl = (name) => `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&hl=en&gl=us&q=${encodeURIComponent(`${name} `)}`;

// ---------- Google Trends, every category ----------
/** One geo's "Trending now" rows with everything the talking points read (the moments' trendRows keeps pop and signal categories only). */
function talkTrendRows(text, geo) {
  const list = parseBatch(text).find((r) => r.rpc === 'i0OFE')?.data?.[1] || [];
  return list.filter((r) => r && r[0] && r[3]).map((r) => ({
    key: `${geo}|${r[0]}|${r[3][0]}`, geo, geoW: GEO_W[geo] || 0.6, keyword: String(r[0]), start: r[3][0] * 1000,
    end: r[4] ? r[4][0] * 1000 : null, volume: r[6] || 0, growth: r[8] || 0, cats: r[10] || [],
    related: (r[9] || []).map(String).filter((q) => q !== r[0]),
  }));
}
function parseBatch(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    if (!line.startsWith('[["wrb.fr"')) continue;
    for (const e of S.safeJson(line) || []) if (e[0] === 'wrb.fr' && e[2]) out.push({ rpc: e[1], tag: e[6], data: S.safeJson(e[2]) });
  }
  return out;
}

/**
 * Every saved Trends reply under the raw folder, merged: one row per geo|keyword|start with its biggest volume and growth, the
 * newest reply's end (null while it is still trending) and the longest related list.
 */
function talkTrends(rawDir) {
  const byKey = new Map();
  for (const f of S.snapshotFiles(rawDir, TRENDS_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const m = f.name.match(TRENDS_FILES);
    for (const t of talkTrendRows(fs.readFileSync(f.path, 'utf8'), m[1] || m[2])) {
      const old = byKey.get(t.key);
      byKey.set(t.key, old ? { ...old, volume: Math.max(old.volume, t.volume), growth: Math.max(old.growth, t.growth), end: t.end,
        related: old.related.length >= t.related.length ? old.related : t.related, seen: f.mtime } : { ...t, seen: f.mtime });
    }
  }
  return [...byKey.values()];
}

/** The moments' store trends as talking-point trends (an offline rebuild of the app's store has no raw Trends replies). */
const fromStoreTrends = (trends) => trends.map((t) => ({ key: t.key, geo: t.geo, geoW: t.geoW || GEO_W[t.geo] || 0.6, keyword: t.keyword,
  start: t.start, end: t.end ?? null, volume: t.volume || 0, growth: 0, cats: t.pop === false ? [] : [4], related: t.related || [] }));

// ---------- YouTube suggestions ----------
/** window.google.ac.h(["kai cenat ",[["kai cenat allegations r",0,[3]], ...],{...}]) -> { query, completions: [{ q, fresh }] }. */
function parseSuggest(text) {
  const body = String(text || '').replace(/^[^(]*\(/, '').replace(/\)\s*;?\s*$/, '');
  const j = S.safeJson(body);
  if (!Array.isArray(j) || !Array.isArray(j[1])) return null;
  return { query: String(j[0] || '').trim(), completions: j[1].filter((c) => Array.isArray(c) && typeof c[0] === 'string')
    .map((c) => ({ q: c[0], fresh: Array.isArray(c[2]) && c[2].includes(FRESH_SUBTYPE) })) };
}

// ---------- name news ----------
/** The name a saved name search asked for, read back from the feed's own channel link ('"kai cenat" when:7d' -> "kai cenat"). */
function newsNameOf(xml) {
  const q = ((xml || '').match(/<channel>[\s\S]*?<link>[^<]*?[?&](?:amp;)?q=([^&<]+)/) || [])[1];
  if (!q) return null;
  try {
    const d = decodeURIComponent(q.replace(/\+/g, ' '));
    return (d.match(/^"([^"]+)"/) || [])[1] || null;
  } catch { return null; }
}

// ---------- Reddit: streamer and YouTuber drama, and what people ask about ----------
/**
 * A talk subreddit's top-of-week posts, for the talking points only: each with its place in the week's list (rankWeek, 0 = the week's
 * top post), keyed apart from the same post's top-of-day row (which the moments read with its own rank).
 */
const talkRedditRows = (xml) => S.redditRows(xml).map((r, i) => ({ ...r, key: `${r.key}#week`, src: 'reddit-talk', talkOnly: true, rankWeek: i }));
/**
 * The creators' subreddits' top-of-day posts, for the talking points only: each with its place in the day's list (rankToday, 0 = the
 * day's top post), keyed apart from the same post's place in the week's.
 */
const talkRedditTodayRows = (xml) => S.redditRows(xml).map((r, i) => ({ ...r, key: `${r.key}#today`, src: 'reddit-talk', talkOnly: true, rankToday: i }));
const TALK_REDDIT_TODAY_FILE = /^tp-reddit-today\.rss$/;
// Collector only. Where creators' drama is argued first: the two big boards (their week's and their day's top), and the boards that
// follow influencers, TikTokers and beauty creators (their day's top only: "Johnnysips and Daynele divorce rumors?"). Those are small
// boards, so a post there names a story and corroborates it; it is never a measure of demand: its place counts as the big boards'
// twenty-fifth and on (SNARK_RANK_FROM), never a top post of the day, and only their day's first five can give a card its noun
const CREATOR_BOARDS_BIG = new Set(['livestreamfail', 'youtubedrama']);
const CREATOR_BOARDS_SNARK = new Set(['tiktokgossip', 'nycinfluencersnark', 'beautyguruchatter']);
const isCreatorBoard = (sub) => CREATOR_BOARDS_BIG.has(sub) || CREATOR_BOARDS_SNARK.has(sub);
const TALK_REDDIT_SNARK = { file: 'tp-reddit-snark.rss', url: 'https://www.reddit.com/r/tiktokgossip+NYCinfluencersnark+BeautyGuruChatter/top/.rss?t=day&limit=50' };
const SNARK_RANK_FROM = 25;
const talkRedditSnarkRows = (xml) => S.redditRows(xml).filter((r) => CREATOR_BOARDS_SNARK.has(r.sub))
  .map((r, i) => ({ ...r, key: `${r.key}#today`, src: 'reddit-talk', talkOnly: true, rankToday: SNARK_RANK_FROM + i, rankDay: SNARK_RANK_FROM + r.rankDay, w: 0.6 }));

// ---------- people-drama searches ----------
/**
 * A drama search's rows, for the talking points only (talkOnly: never the moments' or "Words & trends"): each headline with its
 * outlet, none older than TALK_DRAMA_MAX_DAYS before the reply was saved.
 */
const talkDramaRows = (xml, seenAt, id = '') => S.parseFeed(xml).filter((x) => x.url && seenAt - x.t <= TALK_DRAMA_MAX_DAYS * DAY).map((x) => ({ key: x.url, title: x.title, url: x.url, t: x.t,
  publisher: x.publisher, publisherUrl: x.publisherUrl, src: 'tp-drama', fam: 'gnews', label: 'Google News', w: 0.8, talkOnly: true,
  // (a row of the creators' beat: its headline is a creator's story whatever words it uses)
  ...(TALK_BEAT_IDS.has(id) ? { beat: true } : {}) }));

/** The people-drama searches, one Google News request each. */
async function refreshTalkDrama(store, liveDir, now, log) {
  let n = 0;
  for (const d of TALK_DRAMA) {
    const r = await politeGet(talkDramaUrl(d), path.join(liveDir, `tp-drama-${d.id}.xml`), TALK_DRAMA_GAP_MS, log);
    if (!r || r.status !== 200) { log(`[talk] drama search ${d.id}: ${r ? `http ${r.status}` : 'failed'}`); continue; }
    const rows = talkDramaRows(r.text, now, d.id);
    for (const row of rows) ST.upsertRow(store, row, now);
    n += rows.length;
  }
  log(`[talk] drama searches: ${n} rows`);
}
const TALK_DRAMA_GAP_MS = 300;

// ---------- Wikipedia: the daily top 1000 ----------
const WIKI_TOP_FILES = /^wiki-top-(\d{4}-\d\d-\d\d)\.json$/;
const WIKI_TOP_DAYS = 10; // yesterday back to ten days: the last two days against the five days a week before each
const WIKI_TOP_GAP_MS = 400;
const WIKI_TOP_MIN_VIEWS = 25000;
const WIKI_TOP_SPIKE = 10; // views against the page's own level a week before
const WIKI_TOP_FLOOR_SPIKE = 3; // a page missing from the week-old lists: against those lists' last place
const WIKI_TOP_BASE_MIN = 3; // week-old lists needed before a missing page counts as new
// (namespaces and the site's own pages, never a name)
const WIKI_TOP_SKIP = /^(?:Special|Wikipedia|File|Portal|Help|Category|Template|Talk|User|Draft|Module|MediaWiki|Main_Page|XXX|\.xxx)\b|^Main_Page$/;
const wikiTopUrl = (ymd) => `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${ymd.replace(/-/g, '/')}`;

/** One saved top list: { day, floor (its last place's views), views: Map(article -> views) }, or null. */
function parseWikiTop(text, day) {
  const j = S.safeJson(text);
  const arts = j && Array.isArray(j.items) && j.items[0] && Array.isArray(j.items[0].articles) ? j.items[0].articles : null;
  if (!arts || !arts.length) return null;
  const views = new Map(arts.filter((a) => a && typeof a.article === 'string' && Number.isFinite(a.views)).map((a) => [a.article, a.views]));
  return { day, floor: Math.min(...views.values()), views };
}

/** Every saved top list, the newest copy per UTC day: Map(ymd -> list). */
function wikiTopLists(rawDir) {
  const out = new Map();
  for (const f of S.snapshotFiles(rawDir, WIKI_TOP_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const day = f.name.match(WIKI_TOP_FILES)[1];
    const list = parseWikiTop(fs.readFileSync(f.path, 'utf8'), day);
    if (list) out.set(day, list);
  }
  return out;
}

/**
 * The pages of the last two days' top lists read 10x their level a week before (or, missing from three or more of the week-old
 * lists, 3x those lists' last place), 25K+ views: [{ name, views, t, spike, desc: '', top: true }], the same shape as the most-read
 * feed's rows (the key is the caller's). Then the climbers: 50K+ views and 1.6x the three days before, the story breaking today
 * ("Avengers: Endgame" 30K -> 54K the day it passed "Avatar"), flagged climb (that ratio).
 */
function wikiTopSpikes(lists, now) {
  const out = [];
  const today = Date.parse(S.ymdUtc(now));
  for (const back of [1, 2]) {
    const day = S.ymdUtc(today - back * DAY);
    const list = lists.get(day);
    if (!list) continue;
    const base = [5, 6, 7, 8, 9].map((d) => lists.get(S.ymdUtc(today - (back + d - 1) * DAY))).filter(Boolean);
    if (!base.length) continue;
    const floor = Math.max(...base.map((b) => b.floor));
    for (const [article, views] of list.views) {
      if (views < WIKI_TOP_MIN_VIEWS || WIKI_TOP_SKIP.test(article)) continue;
      const before = Math.max(0, ...base.map((b) => b.views.get(article) || 0));
      const spike = before ? views / before : views / floor;
      if (before ? spike < WIKI_TOP_SPIKE : base.length < WIKI_TOP_BASE_MIN || spike < WIKI_TOP_FLOOR_SPIKE) continue;
      out.push({ name: article.replace(/_/g, ' '), views, t: Date.parse(day) + DAY / 2, spike, desc: '', top: true });
    }
  }
  for (const back of [1, 2]) {
    const day = S.ymdUtc(today - back * DAY);
    const list = lists.get(day);
    const prev = [1, 2, 3].map((d) => lists.get(S.ymdUtc(today - (back + d) * DAY))).filter(Boolean);
    if (!list || prev.length < WIKI_CLIMB_DAYS) continue;
    for (const [article, views] of list.views) {
      if (views < WIKI_CLIMB_MIN_VIEWS || WIKI_TOP_SKIP.test(article)) continue;
      const mean = prev.reduce((a, b) => a + (b.views.get(article) || b.floor), 0) / prev.length;
      const climb = views / Math.max(1, mean);
      if (climb < WIKI_CLIMB_RATIO || out.some((o) => o.name === article.replace(/_/g, ' ') && !o.climb)) continue;
      out.push({ name: article.replace(/_/g, ' '), views, t: Date.parse(day) + DAY / 2, spike: climb, climb, desc: '', top: true });
    }
  }
  return out;
}
const WIKI_CLIMB_MIN_VIEWS = 50000;
const WIKI_CLIMB_RATIO = 1.6;
const WIKI_CLIMB_DAYS = 3;

/** The days of the last WIKI_TOP_DAYS not saved yet, fetched (only a whole day's list is saved: a failed one is asked again next time). */
async function refreshWikiTop(rawDir, liveDir, now, log) {
  const saved = wikiTopLists(rawDir);
  let n = 0;
  for (let back = 1; back <= WIKI_TOP_DAYS; back++) {
    const day = S.ymdUtc(Date.parse(S.ymdUtc(now)) - back * DAY);
    if (saved.has(day)) continue;
    await new Promise((r) => setTimeout(r, WIKI_TOP_GAP_MS));
    try {
      const res = await fetch(wikiTopUrl(day), { headers: { 'User-Agent': S.UA_WIKI }, signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      if (res.status !== 200 || !parseWikiTop(text, day)) { log(`[talk] wiki-top-${day}: http ${res.status}`); continue; }
      fs.mkdirSync(liveDir, { recursive: true });
      fs.writeFileSync(path.join(liveDir, `wiki-top-${day}.json`), text);
      n++;
    } catch (e) { log(`[talk] wiki-top-${day}: ${e.message}`); }
  }
  log(`[talk] Wikipedia top lists: ${n} new`);
}

// ---------- the creators' roster: Wikipedia's own categories ----------
// who is a streamer, a YouTuber or a TikToker, read from the categories Wikipedia's editors keep: `pages` requests of 500 pages each, the
// most linked first, each with its short description. `strict`: the category holds anyone with an account there (Taylor Swift is
// under "YouTubers"), so a page counts only when its description says creator; the streamers' categories count unless the description
// says something else first ("American rapper", "Dutch chess grandmaster")
const ROSTER_CATS = [
  { id: 'twitch', cat: 'Twitch (service) streamers', pages: 2, strict: false },
  { id: 'kick', cat: 'Kick (service) streamers', pages: 1, strict: false },
  { id: 'tiktokers', cat: 'TikTokers', pages: 2, strict: true },
  { id: 'youtubers', cat: 'YouTubers', pages: 3, strict: true },
];
const ROSTER_PAGE = 500;
const ROSTER_FILES = /^wiki-roster-([a-z]+)-(\d+)\.json$/;
const ROSTER_REFRESH_DAYS = 7;
const ROSTER_GAP_MS = 500;
const ROSTER_CREATOR = /\b(?:streamer|live ?streamer|youtuber|tiktoker|influencer|internet personality|internet celebrity|social media personality|content creator|vlogger|podcaster|online personality)\b/i;
const ROSTER_OTHER = /\b(?:rapper|singer|musician|songwriter|band|guitarist|drummer|dj|record producer|actor|actress|comedian|wrestler|footballer|basketball|baseball|football|racing|driver|boxer|martial artist|grandmaster|chess|politician|journalist|broadcaster|television|radio|novelist|author|writer|animator|model|company|website|organization|team)\b/i;
const rosterUrl = (cat, offset) => `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`deepcat:"${cat}"`)}&gsrlimit=${ROSTER_PAGE}&gsroffset=${offset}&gsrnamespace=0&gsrsort=incoming_links_desc&prop=description&format=json`;

/**
 * One saved roster reply's pages: [{ name, desc }], or null when it is no reply: no page list, or a category search that failed on
 * Wikipedia's side (a 200 with a warning, "Deep category search SPARQL query failed", beside the dozen pages a plain text search
 * found: never the category's, so never saved as it and asked again).
 */
const rosterSearchFailed = (j) => !!(j && j.warnings && j.warnings.search);
function parseRoster(text) {
  const j = S.safeJson(text);
  if (rosterSearchFailed(j)) return null;
  const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : null;
  if (!pages) return null;
  return pages.filter((p) => p && typeof p.title === 'string').map((p) => ({ name: p.title, desc: typeof p.description === 'string' ? p.description : '' }));
}

/**
 * The roster: Map(name's key -> { name, desc }) of every saved reply's creators (the newest copy per category and offset), a page's
 * bracketed tail off its name ("Jack Doherty (YouTuber)", "Clavicular (influencer)"). Empty when nothing is saved.
 */
function rosterNames(rawDir) {
  const out = new Map();
  const newest = new Map();
  for (const f of S.snapshotFiles(rawDir, ROSTER_FILES).sort((a, b) => a.mtime - b.mtime)) newest.set(f.name, f);
  for (const f of [...newest.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const spec = ROSTER_CATS.find((c) => c.id === f.name.match(ROSTER_FILES)[1]);
    const pages = spec ? parseRoster(fs.readFileSync(f.path, 'utf8')) : null;
    for (const p of pages || []) {
      // (called a creator before anything else: "English comedian, actor, and podcaster" is a comedian with a podcast)
      const made = p.desc.search(ROSTER_CREATOR);
      const other = p.desc.search(ROSTER_OTHER);
      const creator = (made >= 0 && (other < 0 || made < other)) || ROSTER_CREATOR.test(p.name);
      if (spec.strict ? !creator : (!creator && (ROSTER_OTHER.test(p.desc) || !p.desc))) continue;
      const bare = p.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
      const key = W.words(bare).join(' ');
      if (key && !out.has(key)) out.set(key, { name: bare, desc: p.desc });
    }
  }
  return out;
}

/** The roster's pages not saved within ROSTER_REFRESH_DAYS, fetched (eight requests a week at most; a failed one is asked again next time). */
async function refreshRoster(rawDir, liveDir, now, log) {
  const saved = new Map();
  for (const f of S.snapshotFiles(rawDir, ROSTER_FILES)) saved.set(f.name, Math.max(saved.get(f.name) || 0, f.mtime));
  let n = 0;
  for (const spec of ROSTER_CATS) {
    for (let page = 0; page < spec.pages; page++) {
      const name = `wiki-roster-${spec.id}-${page * ROSTER_PAGE}.json`;
      if (saved.has(name) && now - saved.get(name) < ROSTER_REFRESH_DAYS * DAY) continue;
      await new Promise((r) => setTimeout(r, ROSTER_GAP_MS));
      try {
        const res = await fetch(rosterUrl(spec.cat, page * ROSTER_PAGE), { headers: { 'User-Agent': S.UA_WIKI }, signal: AbortSignal.timeout(25000) });
        const text = await res.text();
        const pages = res.status === 200 ? parseRoster(text) : null;
        if (!pages) { log(`[talk] ${name}: http ${res.status}`); break; }
        fs.mkdirSync(liveDir, { recursive: true });
        fs.writeFileSync(path.join(liveDir, name), text);
        n++;
        // (the category's last page)
        if (pages.length < ROSTER_PAGE) break;
      } catch (e) { log(`[talk] ${name}: ${e.message}`); break; }
    }
  }
  log(`[talk] roster pages: ${n} new`);
}

// ---------- crazes: NewEngen's monthly TikTok trends ----------
const CRAZE_FILES = /^tp-crazes-(\d{4})-(\d\d)\.html$/;
const CRAZE_REFRESH_DAYS = 3; // the page is updated through its month
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const crazeUrl = (month) => `https://newengen.com/insights/${MONTHS[month]}-tiktok-trends/`;
const unescapeHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&#39;|&#x27;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

/**
 * A monthly page's formats: { year, month, updated (ms or null), crazes: [{ rank, name, about }] } (about: the paragraph under the
 * format's heading), or null when the page is not that month's (the address is reused every year).
 */
function parseCrazePage(html, year, month) {
  const h1 = unescapeHtml((String(html || '').match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
  if (!new RegExp(`^${MONTHS[month]}\\s+${year}\\b`, 'i').test(h1)) return null;
  const up = (String(html).match(/updated:?\s*(?:<[^>]+>\s*)*([A-Z][a-z]+ \d{1,2}, \d{4})/i) || [])[1];
  const crazes = [];
  const re = /<h3[^>]*>\s*Trend #(\d+):\s*([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[1-3][\s>])/g;
  for (const m of String(html).matchAll(re)) {
    const name = unescapeHtml(m[2]);
    const about = unescapeHtml((m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
    if (name && name.split(/\s+/).length <= 5) crazes.push({ rank: Number(m[1]), name, about });
  }
  return { year, month, updated: up ? Date.parse(`${up} 12:00 UTC`) || null : null, crazes };
}

/** The saved monthly pages, the newest copy per month: Map("yyyy-mm" -> { ...page, savedAt }). */
function crazePages(rawDir) {
  const out = new Map();
  for (const f of S.snapshotFiles(rawDir, CRAZE_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const [, y, m] = f.name.match(CRAZE_FILES);
    const page = parseCrazePage(fs.readFileSync(f.path, 'utf8'), Number(y), Number(m) - 1);
    if (page) out.set(`${y}-${m}`, { ...page, savedAt: f.mtime });
  }
  return out;
}

/**
 * The crazes of the month "now" is in (or, in its first days, the last month's): [{ name, rank, about, updated, fresh (not on the
 * previous month's page) }].
 */
function crazeRows(rawDir, now) {
  const pages = crazePages(rawDir);
  const d = new Date(now);
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const prevOf = (y, m) => (m === 0 ? [y - 1, 11] : [y, m - 1]);
  let [y, m] = [d.getUTCFullYear(), d.getUTCMonth()];
  if (!pages.has(ym(y, m))) [y, m] = prevOf(y, m);
  const page = pages.get(ym(y, m));
  if (!page) return [];
  const prev = pages.get(ym(...prevOf(y, m)));
  const before = new Set((prev ? prev.crazes : []).map((c) => c.name.toLowerCase()));
  // Collector only (every card shows a start): when a format was first listed. The page is written as its month begins and updated
  // through it, so a format new on it was first listed when the month began (or when the page was last updated, if that is earlier);
  // one carried over from the month before, when that month began. A day, never an hour.
  const monthT = Date.UTC(y, m, 1, 12);
  const [py, pm] = prevOf(y, m);
  const prevMonthT = Date.UTC(py, pm, 1, 12);
  return page.crazes.map((c) => { const fresh = !!prev && !before.has(c.name.toLowerCase()); const updated = page.updated || page.savedAt;
    return { ...c, updated, fresh, listedT: !prev ? null : fresh ? Math.min(updated, monthT) : prevMonthT, source: 'NewEngen' }; });
}

/** This month's page when the saved copy is CRAZE_REFRESH_DAYS old or missing, and last month's once. */
async function refreshCrazes(rawDir, liveDir, now, log) {
  const pages = crazePages(rawDir);
  const d = new Date(now);
  const months = [[d.getUTCFullYear(), d.getUTCMonth()], d.getUTCMonth() === 0 ? [d.getUTCFullYear() - 1, 11] : [d.getUTCFullYear(), d.getUTCMonth() - 1]];
  for (const [i, [y, m]] of months.entries()) {
    const k = `${y}-${String(m + 1).padStart(2, '0')}`;
    const have = pages.get(k);
    if (have && (i > 0 || now - have.savedAt < CRAZE_REFRESH_DAYS * DAY)) continue;
    const file = path.join(liveDir, `tp-crazes-${k}.html`);
    const r = await politeGet(crazeUrl(m), `${file}.part`, TALK_NEWS_GAP_MS, log);
    // (only the month's own page is kept: a failed or last year's page is asked again next time)
    if (r && r.status === 200 && parseCrazePage(r.text, y, m)) fs.renameSync(`${file}.part`, file);
    else { fs.rmSync(`${file}.part`, { force: true }); log(`[talk] crazes ${k}: ${r ? `http ${r.status} or not that month's page` : 'failed'}`); }
  }
}

// ---------- replay (cached rebuild) and refresh (live) ----------
/** Every saved talking-point reply under the raw folder into the store, oldest first so the newest answer wins. */
function replayTalk(store, rawDir) {
  const files = (re) => S.snapshotFiles(rawDir, re).sort((a, b) => a.mtime - b.mtime);
  for (const f of files(TALK_NEWS_FILES)) {
    const xml = fs.readFileSync(f.path, 'utf8');
    const name = newsNameOf(xml);
    if (name) ST.upsertLookup(store, `talk-${talkKey(name)}`, 'tpnews', { query: name, rows: S.storyRows(xml) }, f.mtime);
  }
  for (const f of files(TALK_RECENT_FILES)) {
    const xml = fs.readFileSync(f.path, 'utf8');
    const name = newsNameOf(xml);
    if (name) ST.upsertLookup(store, `talk-${talkKey(name)}`, 'tprecent', { query: name, rows: S.storyRows(xml) }, f.mtime);
  }
  for (const f of files(TALK_YT_FILES)) {
    const s = parseSuggest(fs.readFileSync(f.path, 'utf8'));
    if (s && s.query) ST.upsertLookup(store, `talk-${talkKey(s.query)}`, 'tpyt', s, f.mtime);
  }
  for (const f of files(TALK_REDDIT_FILES)) {
    const xml = fs.readFileSync(f.path, 'utf8');
    for (const row of (TALK_REDDIT_TODAY_FILE.test(f.name) ? talkRedditTodayRows(xml) : talkRedditRows(xml))) ST.upsertRow(store, row, f.mtime);
  }
  for (const f of files(TALK_DRAMA_FILES)) for (const row of talkDramaRows(fs.readFileSync(f.path, 'utf8'), f.mtime, f.name.match(TALK_DRAMA_FILES)[1])) ST.upsertRow(store, row, f.mtime);
}

async function politeGet(url, file, gapMs, log) {
  if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': S.UA_BROWSER }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    fs.writeFileSync(file, text);
    return { status: res.status, text };
  } catch (e) {
    log(`[talk] ${path.basename(file)}: ${e.message}`);
    return null;
  }
}

/** The creators' drama list: the run's first Reddit request, sent at once (the others follow REDDIT_GAP_MS apart). */
async function refreshTalkRedditFirst(store, liveDir, now, log) {
  const r = await politeGet(TALK_REDDIT_FIRST.url, path.join(liveDir, TALK_REDDIT_FIRST.file), 0, log);
  if (!r || r.status !== 200) { log(`[talk] ${TALK_REDDIT_FIRST.file}: ${r ? `http ${r.status}` : 'failed'}`); return; }
  for (const row of talkRedditRows(r.text)) ST.upsertRow(store, row, now);
}

/** The creators' top of the day: the run's second Reddit request (the caller waits REDDIT_GAP_MS before it). */
async function refreshTalkRedditToday(store, liveDir, now, log) {
  const r = await politeGet(TALK_REDDIT_TODAY.url, path.join(liveDir, TALK_REDDIT_TODAY.file), 0, log);
  if (!r || r.status !== 200) { log(`[talk] ${TALK_REDDIT_TODAY.file}: ${r ? `http ${r.status}` : 'failed'}`); return; }
  for (const row of talkRedditTodayRows(r.text)) ST.upsertRow(store, row, now);
}

/** The other talk subreddits' top of the week, each request at least REDDIT_GAP_MS after the run's last Reddit request. */
async function refreshTalkReddit(store, liveDir, now, log) {
  for (const feed of TALK_REDDIT) {
    const r = await politeGet(feed.url, path.join(liveDir, feed.file), S.REDDIT_GAP_MS, log);
    if (!r || r.status !== 200) { log(`[talk] ${feed.file}: ${r ? `http ${r.status}` : 'failed'}`); continue; }
    for (const row of talkRedditRows(r.text)) ST.upsertRow(store, row, now);
  }
}

/** Names not searched within TALK_FRESH_HOURS (the first TALK_HEAD, the strongest: within TALK_HEAD_FRESH_HOURS), at most TALK_LOOKUP_MAX: [{ key, name }] in the order given. */
function talkTargets(names, lookups, now, max = TALK_LOOKUP_MAX) {
  const out = [];
  for (const [i, name] of names.entries()) {
    const key = `talk-${talkKey(name)}`;
    const l = lookups.get(key);
    const fresh = (i < TALK_HEAD ? TALK_HEAD_FRESH_HOURS : TALK_FRESH_HOURS) * 3600000;
    if (out.some((t) => t.key === key) || (l && l.tpnewsAt && now - l.tpnewsAt < fresh)) continue;
    out.push({ key, name });
    if (out.length >= max) break;
  }
  return out;
}

/** One Google News name search and one YouTube suggestion request per target name. */
async function refreshTalkLookups(store, targets, { liveDir, now, log }) {
  let news = 0;
  let yt = 0;
  let newsBlocked = false;
  let ytBlocked = false;
  for (const t of targets) {
    const k = t.key.slice(5);
    if (!newsBlocked) {
      const r = await politeGet(talkNewsUrl(t.name), path.join(liveDir, `tp-news-${k}.xml`), TALK_NEWS_GAP_MS, log);
      if (!r || r.status === 429 || r.status === 503) newsBlocked = true;
      else if (r.status === 200) { ST.upsertLookup(store, t.key, 'tpnews', { query: t.name, rows: S.storyRows(r.text) }, now); news++; }
    }
    if (!ytBlocked) {
      const r = await politeGet(talkSuggestUrl(t.name), path.join(liveDir, `tp-yt-${k}.txt`), TALK_YT_GAP_MS, log);
      const s = r && r.status === 200 ? parseSuggest(r.text) : null;
      if (!r || r.status === 429 || r.status === 503) ytBlocked = true;
      else if (s) { ST.upsertLookup(store, t.key, 'tpyt', { ...s, query: s.query || t.name }, now); yt++; }
    }
  }
  log(`[talk] name searches: ${news}/${targets.length} Google News, ${yt}/${targets.length} YouTube suggestions`);
}

/** The creators' world's biggest names not searched newest-first within TALK_FRESH_HOURS, at most TALK_RECENT_MAX: [{ key, name }]. */
function recentTargets(names, lookups, now) {
  return names.map((name) => ({ key: `talk-${talkKey(name)}`, name })).filter((t, i, all) => all.findIndex((x) => x.key === t.key) === i && !((l) => l && l.tprecentAt &&
    now - l.tprecentAt < TALK_FRESH_HOURS * 3600000)(lookups.get(t.key))).slice(0, TALK_RECENT_MAX);
}

/** One Google News search of the last two days per target name. */
async function refreshTalkRecent(store, targets, { liveDir, now, log }) {
  let n = 0;
  for (const t of targets) {
    const r = await politeGet(talkNewsUrl(t.name, TALK_RECENT_DAYS), path.join(liveDir, `tp-recent-${t.key.slice(5)}.xml`), TALK_NEWS_GAP_MS, log);
    if (!r || r.status === 429 || r.status === 503) break;
    if (r.status === 200) { ST.upsertLookup(store, t.key, 'tprecent', { query: t.name, rows: S.storyRows(r.text) }, now); n++; }
  }
  log(`[talk] newest-first searches: ${n}/${targets.length}`);
}

module.exports = {
  TALK_RECENT_FILES, recentTargets, refreshTalkRecent, refreshTalkRedditToday, talkRedditTodayRows, TALK_REDDIT_TODAY,
  ROSTER_CATS, ROSTER_FILES, rosterUrl, parseRoster, rosterNames, refreshRoster,
  TALK_NEWS_DAYS, TALK_REDDIT_FILES, TALK_NEWS_FILES, TALK_YT_FILES, TRENDS_FILES, GEO_W, talkKey, talkNewsUrl, talkSuggestUrl,
  TALK_DRAMA, TALK_DRAMA_FILES, talkDramaUrl, talkDramaRows, refreshTalkDrama, refreshTalkRedditFirst, FAR_DOMAIN,
  talkTrendRows, talkTrends, fromStoreTrends, parseSuggest, newsNameOf, talkRedditRows, replayTalk, refreshTalkReddit, talkTargets,
  refreshTalkLookups, WIKI_TOP_FILES, wikiTopUrl, parseWikiTop, wikiTopLists, wikiTopSpikes, refreshWikiTop, CRAZE_FILES, crazeUrl, parseCrazePage,
  crazePages, crazeRows, refreshCrazes,
  CREATOR_BOARDS_BIG, CREATOR_BOARDS_SNARK, isCreatorBoard, TALK_REDDIT_SNARK, SNARK_RANK_FROM, talkRedditSnarkRows,
};
