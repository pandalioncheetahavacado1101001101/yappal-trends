'use strict';
/*
 * One saved reply into the engine's store (ios/IDEAS-FEED.md A3 step 3), and what this cycle observed (B1): `obs` remembers which of a
 * trend's own parts were actually read, so nothing is ever called measured on values that were only carried.
 *
 * Every reader returns true when the reply was what it should be (a list that parses), false when it was not (a block page, an empty
 * body): only a true reply counts as read, moves a rotation on or deletes its queue row.
 */
const S = require('../engine/sources');
const ST = require('../engine/store');
const TS = require('../engine/talk-sources');
const WD = require('../engine/words');
const X = require('../engine/words-extract');
const STL = require('../engine/story-lookups');
const CLIPS = require('./sources/clips');
const SOCIAL = require('./sources/social');
const TIKTOK = require('./sources/tiktok');
const ASKED = require('./sources/asked');
const YT = require('./sources/yt-roster');
const LSF = require('./sources/lsf');
const ARCTIC = require('./sources/arctic');
const VB = require('./voices/boards');
const IVR = require('./sources/ivr');
const SULLY = require('./sources/sully');
const BANS = require('./sources/streamerbans');
const FAMOUS = require('./sources/famous');
const ONTD = require('./sources/ontd');
const PRESS = require('./sources/press');
const BING = require('./sources/bing');
const NS = require('./native-signals');
const PS = require('./platform-signals');
const TTS = require('./sources/tts');
const ROUNDUPS = require('./sources/roundups');
const REELS = require('./sources/reels');
const SHAZAM = require('./sources/shazam');
const KWORB = require('./sources/kworb');
const GDELT = require('./sources/gdelt');
const WIKT = require('./sources/wikt-slang');
const TYPED = require('./sources/typed');
const PINTEREST = require('./sources/pinterest');
const APPS = require('./sources/apps');
const ROBLOX = require('./sources/roblox');
const STEAM = require('./sources/steam');
const YTR = require('./sources/yt-results');
const TTSOUND = require('./sources/tiktok-sound');
const TTPROFILE = require('./sources/tiktok-profile');
const { keyOf } = require('./util');

const MOMENT_GEO_W = { US: 1.0, GB: 0.8, AU: 0.8, CA: 0.8 };
const TRAFFIC = /^([\d.,]+)\s*([KMB])?\+?$/i;

/** What one cycle observed, filled by the readers below. */
function newObservations(slot) {
  // (clips: the charts' clips as read; games: Twitch's most-watched categories; xRead: X's trends by country as read this cycle; x: those
  // and the lists held from the last hour and a half, set by the cycle; tiktok: hashtag totals; roster: who is a creator, for the readers)
  return { slot, read: new Set(), trends: {}, momentTrends: [], bluesky: null, reddit: new Map(), namesNews: new Set(), namesYt: new Set(), watch: [], origins: new Map(),
    clips: [], games: null, xRead: {}, x: null, tiktok: new Map(), roster: null,
    // (the creator-native sources, L: what their readers hand the ledger this cycle, the threads a board is commenting in whose titles
    // are not known yet, each roster channel's newest upload, and whether any of them answered: lib/native-ledger.js)
    native: [], nativeRead: false, arcticBusy: [], arcticKnown: new Set(), rosterNewest: {},
    // (the platform, word and craze sources, M: what their readers hand the platform ledger this cycle, and what GDELT's slot held;
    // gdeltArticles: that slot's English articles as parsed, for name discovery in the same cycle (lib/discover.js gdeltStep). Held
    // in memory for the cycle only: never in the summary, the state or a log)
    platform: [], gdelt: null, gdeltArticles: null };
}

/** One geo's "Trending now" rows merged into the store's talking-point trends, as the app merges them reply by reply. */
function mergeTalkTrends(store, rows, geo, nowMs, { whole = true } = {}) {
  if (!store.talkTrends) store.talkTrends = new Map();
  const seen = new Set();
  for (const t of rows) {
    seen.add(t.key);
    const old = store.talkTrends.get(t.key);
    store.talkTrends.set(t.key, old ? { ...old, volume: Math.max(old.volume, t.volume), growth: Math.max(old.growth || 0, t.growth || 0), end: t.end,
      related: (old.related || []).length >= t.related.length ? old.related : t.related, seen: nowMs } : { ...t, seen: nowMs });
  }
  // (a search this country's whole list no longer carries is no longer trending there: it ends now, it never stays live for ever.
  // Only the realtime list is whole: the public RSS holds the current top and nothing else, and a search it lacks is unknown)
  if (!whole) return;
  for (const [k, t] of store.talkTrends) if (t.geo === geo && t.end === null && !seen.has(k)) store.talkTrends.set(k, { ...t, end: nowMs });
}

/** "200+", "2K+", "1M+" as a number. */
function trafficOf(text) {
  const m = String(text || '').trim().match(TRAFFIC);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toUpperCase();
  return Math.round(n * (unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1));
}
/**
 * The public Trends RSS as talking-point trend rows: bands and start times only (no growth, no categories, no related searches), each
 * search live while it is still in the feed (A1).
 */
function trendsRssRows(xml, geo) {
  const items = String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : ''; };
  return items.map((b) => {
    const keyword = tag(b, 'title').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"');
    const start = Date.parse(tag(b, 'pubDate'));
    return { keyword, start, volume: trafficOf(tag(b, 'ht:approx_traffic')) };
  }).filter((r) => r.keyword && Number.isFinite(r.start)).map((r) => ({ key: `${geo}|${r.keyword}|${Math.floor(r.start / 1000)}`, geo, geoW: TS.GEO_W[geo] || 0.6,
    keyword: r.keyword, start: r.start, end: null, volume: r.volume, growth: 0, cats: [], related: [] }));
}

const HOLLOW_WITHIN_MS = 7 * 864e5;
const HOLLOW_SHARE = 0.25;
const HOLLOW_MIN_ROWS = 8;
/**
 * Whether a name's search came back hollow: a well-formed reply with no rows, or with under a quarter of the rows the saved one of
 * the last week holds (eight or more). It is no answer: the saved week stands and the name is asked again. (Reviewers, 2026-10-12:
 * one empty reply replaced 60 stored headlines with none and rewrote the trend's past.)
 */
function hollow(store, key, part, rows, nowMs) {
  const old = (store.lookups.get(key) || {})[part];
  const at = (store.lookups.get(key) || {})[`${part}At`];
  const had = old && Array.isArray(old.rows) ? old.rows.length : 0;
  const recent = Number.isFinite(at) && nowMs - at < HOLLOW_WITHIN_MS;
  if (!rows.length) return had > 0 && recent;
  return had >= HOLLOW_MIN_ROWS && recent && rows.length < HOLLOW_SHARE * had;
}

const READERS = {
  trends(store, obs, { geo }, text, nowMs) {
    const rows = TS.talkTrendRows(text, geo);
    if (!rows.length) return false;
    mergeTalkTrends(store, rows, geo, nowMs);
    const moments = S.trendRows(text, geo, MOMENT_GEO_W[geo] || 0.8);
    for (const tr of moments) ST.upsertTrend(store, tr, nowMs);
    obs.momentTrends.push(...moments);
    obs.trends[geo] = { full: true, rows: new Map(rows.map((t) => [t.key, { volume: t.volume, growth: t.growth || 0, start: t.start, end: t.end, keyword: t.keyword }])) };
    return true;
  },
  'trends-rss'(store, obs, { geo }, text, nowMs) {
    const rows = trendsRssRows(text, geo);
    if (!rows.length) return false;
    mergeTalkTrends(store, rows, geo, nowMs, { whole: false });
    // (growth is not in the feed: sg_* stays NULL for this cycle)
    obs.trends[geo] = { full: false, rows: new Map(rows.map((t) => [t.key, { volume: t.volume, growth: null, start: t.start, end: null, keyword: t.keyword }])) };
    return true;
  },
  'trend-news'(store, obs, { tags }, text, nowMs) {
    if (!/"wrb\.fr"/.test(text || '')) return false;
    S.applyTrendNews(obs.momentTrends, text, new Map(tags));
    for (const tr of obs.momentTrends) if (tr.headline) ST.upsertTrend(store, tr, nowMs);
    return true;
  },
  bluesky(store, obs, args, text, nowMs) {
    const j = S.safeJson(text);
    if (!j || !Array.isArray(j.trends)) return false;
    for (const row of S.blueskyRows(text)) ST.upsertRow(store, row, nowMs);
    obs.bluesky = j.trends.map((t, i) => ({ rank: i + 1, name: String(t.displayName || t.topic || ''), posts: t.postCount || 0, startedAt: Date.parse(t.startedAt) || null, hot: t.status === 'hot' }));
    return true;
  },
  feed(store, obs, { spec: id }, text, nowMs) {
    const spec = S.feedSpecs().find((s) => s.id === id);
    if (!spec || !/<(?:rss|feed)[\s>]/i.test(text || '')) return false;
    for (const row of S.feedRows(spec, text)) ST.upsertRow(store, row, nowMs);
    return true;
  },
  drama(store, obs, { id }, text, nowMs) {
    if (!/<rss[\s>]/i.test(text || '')) return false;
    for (const row of TS.talkDramaRows(text, nowMs, id)) ST.upsertRow(store, row, nowMs);
    return true;
  },
  reddit(store, obs, { turn }, text, nowMs) {
    if (!/<feed[\s>]/i.test(text || '')) return false;
    const rows = turn === 'creators-day' ? TS.talkRedditTodayRows(text) : turn === 'snark-day' ? TS.talkRedditSnarkRows(text) : turn === 'creators-week' || turn === 'ootl-week' ? TS.talkRedditRows(text) : S.redditRows(text);
    for (const row of rows) ST.upsertRow(store, row, nowMs);
    obs.reddit.set(turn, rows.length);
    return true;
  },
  // (a clip chart: the clips that tell something join the store as creator-native rows; the whole chart is kept for the cycle)
  twitch(store, obs, args, text, nowMs) {
    const chart = CLIPS.parseTwitch(text);
    if (!chart) return false;
    for (const row of CLIPS.clipRows(chart.clips, obs.roster)) ST.upsertRow(store, row, nowMs);
    obs.clips.push(...chart.clips);
    if (chart.games.length) obs.games = chart.games;
    return true;
  },
  kick(store, obs, args, text, nowMs) {
    const chart = CLIPS.parseKick(text);
    if (!chart) return false;
    for (const row of CLIPS.clipRows(chart.clips, obs.roster)) ST.upsertRow(store, row, nowMs);
    obs.clips.push(...chart.clips);
    return true;
  },
  // (X's trends for one country: nothing joins the store, a trend is a name and a place in a list)
  'x-trends'(store, obs, { geo }, text, nowMs) {
    const lists = SOCIAL.parseTrends24(text);
    // (a page whose newest list is hours old has stopped being kept: it is not what X is talking about now)
    if (!lists.length || nowMs / 1000 - lists[0].at > SOCIAL.PAGE_STALE_SECONDS) return false;
    obs.xRead[geo] = SOCIAL.trendsOf(lists);
    return true;
  },
  'tiktok-tag'(store, obs, { tag }, text) {
    const totals = TIKTOK.parseTag(text);
    if (!totals) return false;
    obs.tiktok.set(tag, { videos: totals.videos, views: totals.views });
    return true;
  },
  // ---- the keyless drama sources (L): each reply as a ledger batch; the outlets' rows join the store as the drama searches' do ----
  asked(store, obs, { template, engine }, text) {
    const completions = ASKED.parse(text);
    if (!completions) return false;
    obs.native.push(NS.fromAsked(engine, template, completions));
    obs.nativeRead = true;
    return true;
  },
  'yt-roster'(store, obs, { channel }, text, nowMs) {
    const feed = YT.parse(text);
    // (the feed asked for, and no other: a reply for another channel is no reply)
    if (!feed || feed.channelId !== channel) return false;
    const listed = YT.channels().find((c) => c.id === channel);
    obs.native.push(NS.fromRoster({ ...feed, channel: (listed && listed.name) || feed.channel }, Math.floor(nowMs / 1000), listed ? listed.group : null));
    if (feed.videos.length) obs.rosterNewest[channel] = feed.videos[0].t;
    obs.nativeRead = true;
    return true;
  },
  lsf(store, obs, args, text) {
    const clips = LSF.parse(text);
    if (!clips) return false;
    obs.native.push(NS.fromLsf(clips));
    obs.nativeRead = true;
    return true;
  },
  'arctic-comments'(store, obs, { sub }, text) {
    const parsed = ARCTIC.parseComments(text);
    if (!parsed) return false;
    obs.native.push(NS.fromArcticComments(sub, parsed));
    for (const th of parsed.threads.filter((x) => x.n >= NS.THREAD_BUSY)) obs.arcticBusy.push(th.id);
    obs.nativeRead = true;
    return true;
  },
  'arctic-posts'(store, obs, { sub }, text) {
    const posts = ARCTIC.parsePosts(text, sub);
    if (!posts) return false;
    obs.native.push(NS.fromArcticPosts(posts, sub));
    for (const p of posts) obs.arcticKnown.add(p.id);
    // (wave 9: the lead boards' posts, kept by the cycle for their re-read, lib/voices/boards.js)
    (obs.boardPosts || (obs.boardPosts = [])).push(...posts);
    return true;
  },
  // (wave 9: a lead board's half-hourly re-read: its posts go to the boards' private record only, never to the native store or the
  // threads known, so every list reads what it read without the fast lane. lib/sources/arctic.js leadRequests)
  'arctic-lead'(store, obs, { sub }, text) {
    const posts = ARCTIC.parsePosts(text, sub);
    if (!posts) return false;
    (obs.boardPosts || (obs.boardPosts = [])).push(...posts);
    return true;
  },
  // (wave 9: the leaks board's census and the lead boards' re-reads, lib/voices/boards.js: kept by the cycle, never a row or a signal)
  'arctic-census'(store, obs, { sub }, text) {
    const posts = ARCTIC.parsePosts(text, sub);
    if (!posts) return false;
    (obs.censusPosts || (obs.censusPosts = [])).push(...posts);
    return true;
  },
  'reddit-new'(store, obs, { sub }, text) {
    const parsed = VB.parseNew(text);
    if (!parsed) return false;
    (obs.boardChecks || (obs.boardChecks = [])).push({ sub, parsed });
    return true;
  },
  ivr(store, obs, args, text) {
    const users = IVR.parse(text);
    if (!users) return false;
    obs.native.push(NS.fromIvr(users));
    obs.nativeRead = true;
    return true;
  },
  sully(store, obs, args, text) {
    const rows = SULLY.parse(text);
    if (!rows) return false;
    obs.native.push(NS.fromSully(rows));
    return true;
  },
  streamerbans(store, obs, args, text) {
    const events = BANS.parse(text);
    if (!events) return false;
    obs.native.push(NS.fromBans(events));
    return true;
  },
  famous(store, obs, args, text) {
    const rows = FAMOUS.parse(text);
    if (!rows) return false;
    obs.native.push(NS.fromFamous(rows));
    return true;
  },
  ontd(store, obs, args, text) {
    const posts = ONTD.parse(text);
    if (!posts) return false;
    obs.native.push(NS.fromOntd(posts));
    return true;
  },
  press(store, obs, { outlet }, text, nowMs) {
    const rows = PRESS.rows(outlet, text, nowMs);
    if (!rows) return false;
    for (const row of rows) ST.upsertRow(store, row, nowMs);
    return true;
  },
  // (a second opinion on a name: only the headlines that print the name's last word join the store)
  'bing-news'(store, obs, { name }, text, nowMs) {
    const rows = BING.rows(text, nowMs);
    if (!rows) return false;
    const last = keyOf(name).split(' ').pop();
    for (const row of rows) if (last && ` ${keyOf(row.title)} `.includes(` ${last} `)) ST.upsertRow(store, row, nowMs);
    return true;
  },
  // ---- the platform, word and craze sources (M): each reply as a batch for the platform ledger ----
  'tts-chart'(store, obs, { chart }, text) {
    const parsed = TTS.parseChart(text, chart);
    if (!parsed) return false;
    obs.platform.push(PS.fromChart(parsed));
    return true;
  },
  'tts-song'(store, obs, { id }, text) {
    const song = TTS.parseSong(text);
    // (the sound asked for, and no other)
    if (!song || song.id !== String(id)) return false;
    obs.platform.push(PS.fromSong(song));
    return true;
  },
  roundup(store, obs, { page }, text, nowMs) {
    const rows = ROUNDUPS.parse(page, text);
    if (!rows) return false;
    obs.platform.push(PS.fromRoundup(page, rows, Math.floor(nowMs / 1000)));
    return true;
  },
  reels(store, obs, args, text) {
    const parsed = REELS.parse(text);
    if (!parsed) return false;
    obs.platform.push(PS.fromReels(parsed));
    return true;
  },
  shazam(store, obs, args, text) {
    const parsed = SHAZAM.parse(text);
    if (!parsed) return false;
    obs.platform.push(PS.fromShazam(parsed));
    return true;
  },
  kworb(store, obs, args, text) {
    const parsed = KWORB.parse(text);
    if (!parsed) return false;
    obs.platform.push(PS.fromKworb(parsed));
    return true;
  },
  // (GDELT's slot: the titles that name someone the list holds join the store as headlines, each with its own time and its
  // outlet's address, as a sitemap's rows do; how many named each is kept as a curve)
  gdelt(store, obs, { slot, names = [] }, text, nowMs) {
    const articles = GDELT.parse(text);
    if (!articles) return false;
    const named = GDELT.namedIn(articles, names);
    for (const list of named.values()) for (const a of list) if (a.t <= nowMs + 3600e3) ST.upsertRow(store, GDELT.rowOf(a), nowMs);
    obs.platform.push(PS.fromGdelt(slot, new Map([...named].map(([name, list]) => [name, list.length]))));
    obs.gdelt = { slot, articles: articles.length, named: named.size };
    obs.gdeltArticles = articles;
    return true;
  },
  'wikt-cat'(store, obs, { category }, text) {
    const members = WIKT.parseCategory(text);
    if (!members) return false;
    obs.platform.push(PS.fromWiktCategory(category, members));
    return true;
  },
  'wikt-entry'(store, obs, { term }, text) {
    const entry = WIKT.parseEntry(text);
    if (!entry) return false;
    // (kept under the term that was asked: a redirect's page has another title)
    obs.platform.push(PS.fromWiktEntry({ ...entry, term }));
    return true;
  },
  typed(store, obs, { template }, text) {
    const completions = TYPED.parse(text);
    if (!completions) return false;
    obs.platform.push(PS.fromTyped(template, completions));
    return true;
  },
  pinterest(store, obs, args, text) {
    const parsed = PINTEREST.parse(text);
    if (!parsed) return false;
    obs.platform.push(PS.fromPinterest(parsed));
    return true;
  },
  apps(store, obs, { chart }, text) {
    const rows = APPS.parse(text);
    if (!rows) return false;
    obs.platform.push(PS.fromApps(chart, rows));
    return true;
  },
  roblox(store, obs, args, text) {
    const games = ROBLOX.parse(text);
    if (!games) return false;
    obs.platform.push(PS.fromRoblox(games));
    return true;
  },
  'roblox-games'(store, obs, args, text) {
    const rows = ROBLOX.parseGames(text);
    if (!rows) return false;
    obs.platform.push(PS.fromRobloxGames(rows));
    return true;
  },
  steam(store, obs, args, text) {
    const rows = STEAM.parse(text);
    if (!rows) return false;
    obs.platform.push(PS.fromSteam(rows));
    return true;
  },
  'steam-names'(store, obs, args, text) {
    const rows = STEAM.parseNames(text);
    if (!rows) return false;
    obs.platform.push(PS.fromSteamNames(rows));
    return true;
  },
  // (the owner's switches, M11: only ever asked when IDEAS_SOURCES_ON names them)
  'yt-results'(store, obs, { q }, text) {
    const videos = YTR.parse(text);
    if (!videos) return false;
    obs.platform.push(PS.fromYtResults(q, videos));
    return true;
  },
  'tiktok-sound'(store, obs, { id }, text) {
    const sound = TTSOUND.parse(text, id);
    if (!sound) return false;
    obs.platform.push(PS.fromTiktokSound(sound));
    return true;
  },
  'tiktok-profile'(store, obs, { handle }, text) {
    const profile = TTPROFILE.parse(text, handle);
    if (!profile) return false;
    obs.platform.push(PS.fromTiktokProfile(profile));
    return true;
  },
  hn(store, obs, args, text, nowMs) {
    const j = S.safeJson(text);
    if (!j || !Array.isArray(j.hits)) return false;
    for (const row of S.hnRows(text)) ST.upsertRow(store, row, nowMs);
    return true;
  },
  'name-news'(store, obs, { name }, text, nowMs) {
    if (!/<rss[\s>]/i.test(text || '')) return false;
    const rows = S.storyRows(text);
    if (hollow(store, `talk-${TS.talkKey(name)}`, 'tpnews', rows, nowMs)) return false;
    ST.upsertLookup(store, `talk-${TS.talkKey(name)}`, 'tpnews', { query: name, rows }, nowMs);
    obs.namesNews.add(TS.talkKey(name));
    return true;
  },
  'name-recent'(store, obs, { name }, text, nowMs) {
    if (!/<rss[\s>]/i.test(text || '')) return false;
    const rows = S.storyRows(text);
    if (hollow(store, `talk-${TS.talkKey(name)}`, 'tprecent', rows, nowMs)) return false;
    ST.upsertLookup(store, `talk-${TS.talkKey(name)}`, 'tprecent', { query: name, rows }, nowMs);
    obs.namesNews.add(TS.talkKey(name));
    return true;
  },
  // (the fortnight before a name's week: it dates the story and nothing else. Kept beside the name's searches under a part the engine
  // never reads, so the same slot run twice dates it the same: C4)
  'name-origin'(store, obs, { name, from }, text, nowMs) {
    if (!/<rss[\s>]/i.test(text || '')) return false;
    ST.upsertLookup(store, `talk-${TS.talkKey(name)}`, 'tporigin', { query: name, from, rows: S.storyRows(text).filter((r) => Number.isFinite(r.t) && r.title)
      .map((r) => ({ t: Math.floor(r.t / 1000), title: String(r.title), publisher: r.publisher || null })) }, nowMs);
    return true;
  },
  'name-yt'(store, obs, { name, watch }, text, nowMs) {
    const s = TS.parseSuggest(text);
    if (!s) return false;
    const key = TS.talkKey(name);
    const old = (store.lookups.get(`talk-${key}`) || {}).tpyt;
    ST.upsertLookup(store, `talk-${key}`, 'tpyt', { ...s, query: s.query || name }, nowMs);
    obs.namesYt.add(key);
    if (watch) obs.watch.push({ name, completions: s.completions, before: old ? old.completions || [] : null });
    return true;
  },
  'story-news'(store, obs, { key, query }, text, nowMs) {
    if (!/<rss[\s>]/i.test(text || '')) return false;
    ST.upsertLookup(store, key, 'deep', { query, rows: S.storyRows(text) }, nowMs);
    return true;
  },
  'story-wiki'(store, obs, { key, query }, text, nowMs) {
    const reply = S.safeJson(text);
    if (!reply) return false;
    ST.upsertLookup(store, key, 'wiki', { query, pages: STL.parseWikiSearch(reply) }, nowMs);
    return true;
  },
  'word-wiki'(store, obs, { pairs }, text, nowMs) {
    const reply = S.safeJson(text);
    if (!reply) return false;
    for (const [key, v] of WD.parseWikiBatch([reply], pairs)) {
      ST.upsertLookup(store, key, 'summary', v.summary, nowMs);
      if (v.views) ST.upsertLookup(store, key, 'views', v.views, nowMs);
    }
    return true;
  },
  'word-wikt'(store, obs, { key }, text, nowMs) {
    const json = S.safeJson(text);
    if (!json) return false;
    // (a missing entry is an answer too: no sense, not asked again for a week)
    ST.upsertLookup(store, key, 'wikt', WD.parseWikt(json), nowMs);
    return true;
  },
  'word-since'(store, obs, { key, term }, text, nowMs) {
    if (!/<rss[\s>]/i.test(text || '')) return false;
    ST.upsertLookup(store, key, 'since', WD.sinceOf(S.parseFeed(text), term, nowMs), nowMs);
    return true;
  },
  'kym-page'(store, obs, { key, slug }, text, nowMs, { status, tried = 1, guessed = 0 } = {}) {
    const summary = status === 200 && text ? X.kymPageSummary(text) : null;
    // (a page that is not there is an answer too: the term is not asked again for a month)
    if (status !== 200 && status !== 404) return false;
    const old = store.lookups.get(key) || {};
    const today = Math.floor(nowMs / 864e5) * 864e5;
    const sameDay = (old.kymAt || 0) >= today;
    ST.upsertLookup(store, key, 'kym', summary ? { slug, ...summary } : null, nowMs);
    ST.upsertLookup(store, key, 'kymN', (sameDay ? old.kymN || 0 : 0) + tried, nowMs);
    ST.upsertLookup(store, key, 'kymGuessN', (sameDay ? old.kymGuessN || 0 : 0) + guessed, nowMs);
    return true;
  },
  'kym-roundup'(store, obs, { key }, text, nowMs, { status } = {}) {
    if (status !== 200 || !text) return false;
    ST.upsertLookup(store, key, 'roundup', { entries: X.kymRoundupEntries(text) }, nowMs);
    return true;
  },
};

/** The origin searches the store holds, by the name each dates: what lib/history.js reads as `obs.origins`. */
function originsOf(store) {
  const out = new Map();
  for (const [k, l] of store.lookups) if (k.startsWith('talk-') && l.tporigin && Array.isArray(l.tporigin.rows)) out.set(k.slice(5), l.tporigin);
  return out;
}

/** Whether a Wikipedia list or a crazes page is what was asked for (only a whole, right reply is saved: a failed one is asked again). */
function wikiFileOk({ check, year, month }, text) {
  if (check === 'featured') { const j = S.safeJson(text); return !!(j && (j.mostread || j.tfa || j.onthisday)); }
  if (check === 'top') return !!TS.parseWikiTop(text, 'x');
  if (check === 'roster') return !!TS.parseRoster(text);
  if (check === 'crazes') return !!TS.parseCrazePage(text, year, month);
  return false;
}

/** Reads one reply into the store: true when it was a proper reply of its kind. `extra`: { status, tried, guessed } for the kinds that read them. */
function ingest(store, obs, request, text, nowMs, extra = {}) {
  const reader = READERS[request.kind];
  if (!reader) return request.kind === 'wiki-file' ? wikiFileOk(request.args, text) : false;
  const ok = reader(store, obs, request.args || {}, text, nowMs, extra);
  if (ok) obs.read.add(request.rotationId || request.id);
  return ok;
}

module.exports = { ingest, newObservations, originsOf, wikiFileOk, trendsRssRows, trafficOf, mergeTalkTrends, hollow };
