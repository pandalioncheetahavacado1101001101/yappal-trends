'use strict';
/*
 * One trend's sample of one cycle (ios/IDEAS-FEED.md B1): what its evidence says at the slot, column by column, with NULL for every
 * part the cycle did not actually read (carrying is done on reading: lib/measure.js). Pure: the row's timed evidence, what the cycle
 * observed (lib/ingest.js) and the trend's earlier samples go in; nothing is fetched or written here.
 */
const TS = require('../engine/talk-sources');
const TN = require('../engine/talk-nouns');
const W = require('../engine/wording');
const LT = require('./line-text');
const M = require('./measure');
const CLIPS = require('./sources/clips');
const SOCIAL = require('./sources/social');
const TIKTOK = require('./sources/tiktok');
const { GEOS, GEO_BIT, HOUR, DAY, keyOf } = require('./util');

// the feeds read every cycle whose rows carry a story's headlines: a cycle that read one of them sampled the press (A4)
const PRESS_FEEDS = ['tp-drama-beat', 'tp-drama-creators', 'tp-drama-said', 'tp-drama-celebs', 'dexerto', 'tmz'];
const REDDIT_TODAY = DAY;
const KIND_LIVE = 6 * HOUR;
const NEW_BY_OBSERVATION = 3 * HOUR;
const SEARCH_STEPS = [20000, 100000, 500000, 1000000];
const ORIGIN_TIMES_KEPT = 120;
const ORIGIN_HEADS_KEPT = 4;
const X_LIST = 50;
const BLUESKY_LIST = 25;
// TikTok's growth on the creators' scale (C1): half a percent of a hashtag's videos in an hour reads as half of C, 3% as all of it
const TT_GROWTH_SCALE = 930;
const TT_SMALL_TAG = 1000;

/** A row's own items with their time in seconds and what each is: 'outlet', 'beat', 'upload', 'clip' (a clip chart's), 'post', 'social' or 'meme'. */
function itemsOf(row) {
  const own = (row.meta && row.meta.own) || [];
  const mine = own.filter((r) => Number.isFinite(r.t)).map((r) => ({ t: Math.floor(r.t / 1000), title: r.title || null, outlet: r.outlet || null, sub: r.sub || null,
    rank: Number.isFinite(r.rank) ? r.rank : null, week: Number.isFinite(r.week) ? r.week : null,
    k: CLIPS.isClipOutlet(r.outlet) ? 'clip' : r.k || (r.fam === 'reddit' ? 'post' : r.fam === 'bluesky' ? 'social' : r.fam === 'kym' ? 'meme' : /^(?:youtube|youtu\.be)$/i.test(r.outlet || '') ? 'upload' : 'outlet') }));
  // (the creators' side the keyless sources read, L: a roster cluster's videos, a clip with its score, a thread people are commenting
  // in, a question newly typed, what the platform shows. Each carries its own kind and time; `native` marks where it came from)
  const native = nativeOf(row).items.filter((r) => Number.isFinite(r.t) && NATIVE_ITEM_KINDS.has(r.k)).map((r) => ({ t: Math.floor(r.t / 1000), title: r.title || null, outlet: r.outlet || null, sub: r.sub || null,
    rank: Number.isFinite(r.rank) ? r.rank : null, week: null, k: r.k, native: true }));
  return native.length ? [...mine, ...native] : mine;
}
const NATIVE_ITEM_KINDS = new Set(['upload', 'clip', 'post', 'asked', 'platform']);
// the Early kinds the keyless sources can give a row, each first seen when lib/native-signals.js says (a cluster forms with its second channel)
const NATIVE_KINDS = ['creators', 'asked', 'clips', 'reddit', 'platform'];
// a hundred thousand views an hour on the roster's videos about a story reads as all of C, ten thousand as two fifths (C1)
const VIEWS_AN_HOUR_SCALE = 3200;
/** What lib/native-desk.js attached to a row: { items, kinds: { kind: first seen, seconds }, viewsAnHour, why, live }, empty when nothing. */
const nativeOf = (row) => { const n = row && row.meta && row.meta.native; return n && Array.isArray(n.items) ? { kinds: {}, viewsAnHour: null, why: [], live: 0, ...n } : { items: [], kinds: {}, viewsAnHour: null, why: [], live: 0 }; };
/** What lib/platform-desk.js put on a row of its own: { signal (its own measured number on the creators' scale, 0-1, or null), videos (a sound's count, or null), startedAt (seconds, when it was new by observation) }. */
const platformOf = (row) => { const p = row && row.meta && row.meta.platform; return { signal: p && Number.isFinite(p.signal) ? p.signal : null, videos: p && Number.isFinite(p.videos) ? p.videos : null, startedAt: p && Number.isFinite(p.startedAt) ? p.startedAt : null }; };
const isPress = (i) => i.k === 'outlet' || i.k === 'beat';
/**
 * Whether a sentence names a row's subject: its whole name, as keyed or as spelt, or (a name of one or two words) its last word
 * when that is no dictionary word. What a chapter, a flare and a timeline's own line must do: a headline about the people around
 * a story is not about the row's subject (reviewers, 2026-10-12).
 */
function namesSubject(row, text) {
  const subject = keyOf((row && row.subject) || '');
  if (!subject || !text) return false;
  const hay = ` ${keyOf(text)} `;
  const surface = keyOf((row && row.surface) || '');
  if (hay.includes(` ${subject} `) || (surface && hay.includes(` ${surface} `))) return true;
  const words = subject.split(' ');
  const last = words[words.length - 1];
  return words.length <= 2 && last.length > 3 && !W.isDictWord(last) && hay.includes(` ${last} `);
}
const STORY_WORDS = 2;
/**
 * Whether a headline tells a talking point's own story, beyond naming its subject: it says the card's noun family, or shares two
 * words with the row's title and line beyond the subject's name (who else it is about, what it is over). "Megyn Kelly presses
 * Meghan Markle's former agent ..." names Megyn Kelly and is no chapter of "Megyn Kelly criticism", her remarks on a rape suit
 * at Cornell: another story of the same name moves no badge and alerts nobody. A row with no noun family is its subject's, and
 * a headline that carries a claim, an answer or an outcome (accuses, denies, admits, sued, arrested) is a turn of a story about
 * its subject whatever else it says.
 */
function tellsStory(row, text) {
  const fam = row && row.family ? TN.FAMILY.get(row.family) || null : null;
  if (!fam || !text) return true;
  if (TN.says(text, fam)) return true;
  if (LT.tokensOf(text).some((t) => !!LT.claimClass(t.k))) return true;
  const own = new Set([...keyOf(row.subject || '').split(' '), ...keyOf(row.surface || '').split(' ')]);
  const stems = (s) => new Set(keyOf(s).split(' ').filter((w) => w.length > 3 && !own.has(w) && !W.STOP.has(w)).map((w) => W.stem(w)));
  const mine = stems(`${row.title || ''} ${row.line || ''}`);
  let shared = 0;
  for (const w of stems(text)) if (mine.has(w)) shared += 1;
  return shared >= STORY_WORDS;
}
/** Whether a chapter's headline is the row's own: it names the row's subject and tells the row's story. */
const ownChapter = (row, text) => namesSubject(row, text) && tellsStory(row, text);
/** A row's new chapter as the series may read it: one that names the row's subject and tells its story (a thread's is marked so by the desk); else null. */
function chapterOf(row) {
  const ch = row && row.meta && row.meta.timeline ? row.meta.timeline.chapter : null;
  if (!ch || !Number.isFinite(ch.t)) return null;
  return ch.named === true || ownChapter(row, ch.text || '') ? ch : null;
}
/** The search entries the engine tied to the row, times in seconds. */
const searchesOf = (row) => ((row.meta && row.meta.trends) || []).map((x) => ({ key: x.key, geo: x.geo, keyword: x.keyword, volume: x.volume || 0, growth: x.growth || 0,
  start: Math.floor(x.start / 1000), end: x.end === null || x.end === undefined ? null : Math.floor(x.end / 1000) }));
/** The name whose searches are the row's own (the key its Google News and YouTube lookups are stored under), or null. */
const lookupKeyOf = (row) => (row.type === 'point' && row.meta && row.meta.key ? TS.talkKey(row.meta.key) : null);

/** What a social trend has to name to be about a row: a word's own name, a story's subject. */
const socialSubject = (row) => keyOf(row.type === 'word' || row.wordish ? row.title.replace(/\s+(?:trend|meme|challenge|sound)$/i, '') : row.subject || '');

/** The Bluesky trend that names the row (its subject as whole words in the topic, or the topic in its title), or null. obs.bluesky: [{ rank, name, posts, startedAt }]. */
function socialOf(row, bluesky) {
  if (!bluesky) return null;
  const subject = socialSubject(row);
  if (!subject || subject.length < 4) return null;
  const hit = bluesky.find((b) => { const name = ` ${keyOf(b.name)} `; return name.includes(` ${subject} `) || (keyOf(b.name).includes(' ') && ` ${subject} `.includes(name)); });
  return hit || null;
}

/**
 * The sample. ctx: { t (slot), kind, earlier (the trend's samples before t, oldest first), info (the trend's saved { fresh: { completion:
 * slot first seen }, ytReadAt, bands: { geo: highest band crossed } }), pastPage, wikiFresh (a Wikipedia list newer than 36 hours is in hand) }.
 * Returns { cols (the B1 columns this module owns), parts (S N C R W as sampled, null when not read), observed, liveHome, searchNow
 * (largest home volume still listed this cycle), kindSeen ({ kind: first seen, seconds }), kinds (live in the last 6 hours), fresh
 * (completions with when each was first seen), crossed ([{ geo, band, keyword, start (the entry's own) }] search bands passed this cycle), topPost (true when a
 * post of its own leads a creators' board right now) }.
 */
function sampleOf(row, obs, ctx) {
  const { t, kind } = ctx;
  const info = ctx.info || {};
  const items = itemsOf(row).filter((i) => i.t <= t + 900);
  const searches = searchesOf(row);
  const lookKey = lookupKeyOf(row);
  const lookback = M.windowOf(kind) > 3 * HOUR ? M.windowOf(kind) : 3 * HOUR;
  const within = (xs, seconds) => xs.filter((i) => i.t > t - seconds).length;
  const cols = { sv_us: null, sv_gb: null, sv_au: null, sv_ca: null, sg_us: null, sg_gb: null, sg_au: null, sg_ca: null, s_live: null, n1: null, n24: null, outlets: null, cr: null,
    yt_h: null, tt_videos: null, tt_views: null, rd_rank: null, rd: null, soc: null, wiki: null, kinds: null };

  // search: this cycle's own reading, country by country. Only the whole realtime list of a country says a search is gone from it
  // (reads 0: not trending there). A country not read this cycle, and the public RSS (which holds only the current top and no ended
  // entries) when it lacks the row's search, say nothing: those columns stay NULL, and while one of the row's own live searches
  // is in such a country the search part is not sampled at all (it is carried: lib/measure.js). Reviewers, 2026-10-12: a missing
  // GB reply read a live 200K search as 0, and a spell on the RSS ended every search it did not carry
  let anyGeo = false;
  let unknownOwn = false;
  let heldLive = false;
  let live = 0;
  let volumeNow = 0;
  let liveNow = false;
  let endedAgo = Infinity;
  const crossed = [];
  for (const geo of GEOS) {
    const read = obs.trends[geo];
    const own = searches.filter((s) => s.geo === geo);
    const mine = read ? own.map((s) => ({ s, now: read.rows.get(s.key) })).filter((x) => x.now) : [];
    // (what the store still holds as trending there, unanswered this cycle)
    const openOwn = own.filter((s) => s.end === null && !mine.some((x) => x.s === s));
    if (!read || (!read.full && !mine.length)) { if (openOwn.length) { unknownOwn = true; heldLive = true; } continue; }
    if (!read.full && openOwn.length) { unknownOwn = true; heldLive = true; }
    anyGeo = true;
    const volume = Math.max(0, ...mine.map((x) => x.now.volume || 0));
    const col = geo.toLowerCase();
    cols[`sv_${col}`] = volume;
    cols[`sg_${col}`] = read.full && mine.length ? Math.max(0, ...mine.map((x) => x.now.growth || 0)) : read.full ? 0 : null;
    if (mine.some((x) => x.now.end === null)) { live |= GEO_BIT[geo]; liveNow = true; }
    for (const x of mine) if (x.now.end !== null && Number.isFinite(x.now.end)) endedAgo = Math.min(endedAgo, Math.max(0, t - Math.floor(x.now.end / 1000)));
    volumeNow = Math.max(volumeNow, volume);
    const before = (info.bands && info.bands[geo]) || 0;
    const step = [...SEARCH_STEPS].reverse().find((b) => volume >= b);
    const top = ([...mine].sort((a, b) => (b.now.volume || 0) - (a.now.volume || 0))[0] || { s: {} }).s;
    if (step && step > before) crossed.push({ geo, band: step, keyword: top.keyword || null, start: Number.isFinite(top.start) ? top.start : null });
  }
  if (anyGeo) cols.s_live = live;
  // (a search of its own that could not be read this cycle and is bigger than anything that was: the part is unknown, not smaller)
  const unreadBigger = unknownOwn && searches.some((s) => s.end === null && (s.volume || 0) > volumeNow && (!obs.trends[s.geo] || !obs.trends[s.geo].rows.get(s.key)));
  const search = anyGeo && !unreadBigger ? { volume: volumeNow, live: liveNow, endedAgo: Number.isFinite(endedAgo) ? endedAgo : 0 } : null;
  const searchUnknown = search === null && searches.length > 0;

  // press: the story's own headlines, read in full only when its own name was searched, in part whenever a tier 0 feed was read
  const press = items.filter(isPress);
  const pressRead = PRESS_FEEDS.some((id) => obs.read.has(id)) || (!!lookKey && obs.namesNews.has(lookKey));
  if (pressRead) {
    cols.n1 = within(press, HOUR);
    cols.n24 = within(press, DAY);
    cols.outlets = new Set(press.filter((i) => i.t > t - 7 * DAY && i.outlet).map((i) => keyOf(i.outlet))).size;
  }

  // creators: uploads among its coverage, the creators' beat's rows, completions people only lately type (new this cycle)
  const ytRead = !!lookKey && obs.namesYt.has(lookKey);
  const fresh = { ...(info.fresh || {}) };
  const newByObservation = ytRead && Number.isFinite(info.ytReadAt) && t - info.ytReadAt <= NEW_BY_OBSERVATION;
  // (a completion met for the first time is new only by observation: the same name's completions were read without it inside the last
  // three hours. One met at a cold start, or after a long gap, is known from now on and never counted as new: saved as 0)
  const typedNow = [];
  if (ytRead) {
    for (const q of (row.meta && row.meta.fresh) || []) {
      if (Number.isFinite(fresh[q])) continue;
      fresh[q] = newByObservation ? t : 0;
      if (newByObservation) typedNow.push(q);
    }
  }
  // (a clip chart's clip counts beside an upload, and only when it says the card's own noun: a streamer has a clip on the chart every
  // day, and lib/sources/clips.js lets in only the clips that tell something)
  const family = row.family ? TN.FAMILY.get(row.family) : null;
  const clips = items.filter((i) => i.k === 'clip' && (!family || TN.says(i.title || '', family)));
  // (and what the platform shows or people newly ask about the subject: creator-native items too, each timed by the cycle that saw it)
  const native = [...items.filter((i) => i.k === 'upload' || i.k === 'beat' || i.k === 'asked' || i.k === 'platform'), ...clips];
  const typedWithin = (seconds) => Object.values(fresh).filter((at) => at > t - seconds).length;
  const clipsRead = obs.read.has('twitch') || obs.read.has('kick');
  // TikTok's own count for its hashtag, when that adapter is on and read it this cycle: totals, and videos gained an hour since the
  // reading before (inside three hours: growth is measured between two readings, never guessed from one)
  const tag = row.wordish || row.type === 'word' ? TIKTOK.tagOf(row.title) : null;
  const tt = tag && obs.tiktok ? obs.tiktok.get(tag) || null : null;
  const ttBefore = tt ? [...(ctx.earlier || [])].reverse().find((s) => Number.isFinite(s.ttVideos)) : null;
  const ttGrowth = tt ? TIKTOK.growthAnHour({ t, videos: tt.videos }, ttBefore ? { t: ttBefore.t, videos: ttBefore.ttVideos } : null) : null;
  const ttRising = !!tt && TIKTOK.isRising(ttGrowth, tt.videos);
  if (tt) { cols.tt_videos = tt.videos; cols.tt_views = tt.views; }
  // (the roster's own curve: views an hour of the videos about it, measured between two readings of each: lib/native-signals.js)
  const nat = nativeOf(row);
  const rosterGrowth = Number.isFinite(nat.viewsAnHour) && nat.viewsAnHour > 0 ? nat.viewsAnHour / VIEWS_AN_HOUR_SCALE : 0;
  // (a platform row's own number, M: a chart's count of a sound and what it gained in its last day, a game's players, an app's place.
  // The desk hands it over already on the creators' scale; it is the source's own latest reading, said again every cycle while it is fresh)
  const plat = platformOf(row);
  if (plat.videos !== null && !tt) cols.tt_videos = plat.videos;
  const platGrowth = plat.signal !== null ? Math.pow(2, 5 * Math.min(1, Math.max(0, plat.signal))) - 1 : 0;
  const creatorsRead = pressRead || ytRead || clipsRead || !!tt || !!obs.nativeRead || plat.signal !== null;
  if (creatorsRead) cols.cr = within(native, HOUR) + typedWithin(HOUR);

  // community: its best place today in a Reddit list, and whether it is trending on Bluesky now
  const posts = items.filter((i) => i.k === 'post');
  const today = posts.filter((i) => i.t > t - REDDIT_TODAY);
  // (the drama boards by way of their mirror count as a reading of the boards: a thread's place there is by comments, never 0 = top. L4)
  const redditRead = obs.reddit.size > 0 || (!!obs.nativeRead && items.some((i) => i.native && i.k === 'post'));
  const bestRank = Math.min(Infinity, ...today.map((i) => (i.rank !== null ? i.rank + 1 : Infinity)));
  if (redditRead) { cols.rd_rank = Number.isFinite(bestRank) ? bestRank : null; cols.rd = today.length; }
  const social = socialOf(row, obs.bluesky);
  // (X's trends, a country's page an hour: the lists read this cycle and the ones held from the last hour and a half. A5)
  const xHit = SOCIAL.xOf(socialSubject(row), obs.x);
  const xReadNow = !!(obs.x && obs.x.read.size);
  const place = (rank, n) => Math.round(100 * Math.max(0.2, 1 - (rank - 1) / n)) / 100;
  if (obs.bluesky || xReadNow) cols.soc = Math.max(social ? place(social.rank, BLUESKY_LIST) : 0, xHit ? place(xHit.rank, X_LIST) : 0);
  // (Reddit is read one list a cycle: between its turns the place it gave holds for the community part's own hold time)
  const heldRank = redditRead ? cols.rd_rank : [...(ctx.earlier || [])].reverse().filter((s) => t - s.t <= M.K.HOLD.r).map((s) => s.rdRank).find(Number.isFinite) ?? null;
  const community = redditRead || obs.bluesky || xReadNow ? { rdRank: heldRank, soc: cols.soc || 0 } : null;

  // reads: its Wikipedia page on the last full day
  // (or, where the hourly files hold its page, the last day as they count it: an hourly reading where the daily lists give one a day. M4)
  const hourly = row.meta && row.meta.wikiHourly && Number.isFinite(row.meta.wikiHourly.day) ? row.meta.wikiHourly.day : null;
  const reads = hourly !== null ? hourly : ctx.wikiFresh ? (row.meta && Number.isFinite(row.meta.wiki) ? row.meta.wiki : 0) : null;
  if (reads !== null) cols.wiki = reads;

  const parts = M.partsOf({ search, press: pressRead ? within(press, lookback) : null,
    creators: creatorsRead ? { items: within(native, lookback) + typedWithin(lookback), growth: Math.max(Number.isFinite(ttGrowth) ? (TT_GROWTH_SCALE * ttGrowth) / Math.max(tt.videos, TT_SMALL_TAG) : 0, rosterGrowth, platGrowth) } : null,
    community, reads });

  // the kinds of source it has been seen in, each from the time its own item carries (C3); a completion counts only when new by observation
  const first = (xs) => (xs.length ? Math.min(...xs.map((i) => i.t)) : null);
  const kindSeen = {};
  const put = (k, at) => { if (Number.isFinite(at) && at <= t) kindSeen[k] = at; };
  put('search', M.searchRunStart(searches, t));
  put('beat', first(items.filter((i) => i.k === 'beat')));
  put('reddit', first(posts.filter((i) => !i.native)));
  put('creators', first(items.filter((i) => i.k === 'upload' && !i.native)));
  if (newByObservation && typedNow.length && !Number.isFinite(kindSeen.creators)) put('creators', t);
  put('social', Math.min(...[social && Number.isFinite(social.startedAt) ? Math.floor(social.startedAt / 1000) : null, xHit ? xHit.since : null].filter(Number.isFinite)));
  put('clips', first(clips.filter((i) => !i.native)));
  // (what the keyless sources add, each kind from when they say it was first seen; the earlier of the two where both have it)
  for (const k of NATIVE_KINDS) { const at = nat.kinds[k]; if (Number.isFinite(at) && at <= t && (!Number.isFinite(kindSeen[k]) || at < kindSeen[k])) kindSeen[k] = at; }
  // (rising on TikTok itself: measured between two readings, so new by observation by construction)
  if (ttRising) put('tiktok', t);
  const memeT = [...((row.meta && row.meta.memeT) || []).map((ms) => Math.floor(ms / 1000)), ...items.filter((i) => i.k === 'meme').map((i) => i.t)];
  if (memeT.length) put('meme', Math.min(...memeT));
  const liveKinds = [liveNow, within(items.filter((i) => i.k === 'beat'), KIND_LIVE) > 0, within(posts, KIND_LIVE) > 0 || Number.isFinite(bestRank),
    within(items.filter((i) => i.k === 'upload'), KIND_LIVE) > 0 || typedNow.length > 0, !!social || !!xHit, memeT.some((at) => at > t - KIND_LIVE), within(clips, KIND_LIVE) > 0, ttRising,
    within(items.filter((i) => i.k === 'asked'), KIND_LIVE) > 0, within(items.filter((i) => i.k === 'platform'), KIND_LIVE) > 0].filter(Boolean).length;
  cols.kinds = liveKinds;

  const topPost = redditRead && posts.some((i) => (i.rank === 0 || i.week === 0) && (i.sub === 'livestreamfail' || i.sub === 'youtubedrama'));
  // observed (B1): one of its own fast parts was actually read. A community list that does not carry it says nothing about it: Bluesky
  // answering every cycle must not make every sample "observed" while its search and its press went unread
  // (nor does an X list held from an earlier cycle: only one read now)
  const observed = parts.s !== null || parts.n !== null || parts.c !== null || (community !== null && ((redditRead && cols.rd_rank !== null) || !!social || !!(xHit && xHit.fresh)));
  return { cols, parts, observed, liveHome: liveNow || heldLive, searchUnknown, searchNow: volumeNow, kindSeen, kinds: liveKinds, fresh, ytRead, crossed, topPost,
    n24: cols.n24 ?? within(press, DAY), outletsNow: cols.outlets ?? new Set(press.filter((i) => i.outlet).map((i) => keyOf(i.outlet))).size };
}

/**
 * When the story started (C4), from the row's own timed evidence: its headlines, its creator-native items, its searches; a word's or
 * a meme's origin day. observedAt: this slot, handed in only when the trend is new by observation.
 */
function startOf(row, { t, observedAt = null, earlier = [] }) {
  const items = itemsOf(row);
  const meta = row.meta || {};
  const originT = Number.isFinite(meta.originT) ? meta.originT : null;
  const wordish = row.wordish || row.type === 'word';
  const dayOf = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
  // (a word's or a meme's start is its origin date from its sources: a date, never an hour)
  if (wordish) {
    // (a platform row that was new by observation: it began the cycle its list first showed it, to the hour. M)
    const seenAt = platformOf(row).startedAt;
    if (seenAt !== null && seenAt <= t) return { at: seenAt, precision: 'hour' };
    const day = originT !== null ? new Date(originT).toISOString().slice(0, 10) : null;
    const press = items.filter(isPress).map((i) => i.t).filter((x) => x <= t).sort((a, b) => a - b);
    // (an old thing flaring again started this flare when its headlines began again: a toy of last winter back in the news this week
    // is "Started 4 days ago", never "Around for 8 months" under a Peaking badge. The run of its headlines that reaches now, each
    // within a week of the next, when that run began well inside what the collector can see)
    if (day && press.length && t - originT / 1000 > FLARE_ORIGIN_AGE) {
      let at = press.length - 1;
      while (at > 0 && press[at] - press[at - 1] <= FLARE_RUN_GAP) at -= 1;
      if (t - press[press.length - 1] <= FLARE_RUN_GAP && t - press[at] <= FLARE_WINDOW) return { at: press[at], precision: 'day', day: dayOf(press[at]), flare: true };
    }
    if (day) return M.startedOf({ originDay: day, now: t });
    // (a format of the month's page: first listed when its page says, or when the press first named it, whichever is earlier.
    // Judges, 2026-10-11: one explainer of the 6th dated a format the page had carried since the month began)
    const listed = Number.isFinite(meta.listedT) && meta.listedT / 1000 <= t ? Math.floor(meta.listedT / 1000) : null;
    // (a row only the month's page dates is known to the month: "Started this month", never "Started 10 days ago" on the 11th for
    // a trend the page had carried since it was written. Reviewers, 2026-10-12)
    if (listed !== null) { const at = press.length ? Math.min(press[0], listed) : listed; return { at, precision: at === listed ? 'month' : 'day', day: dayOf(at) }; }
    const s = M.startedOf({ headlines: press, creatorItems: items.filter((i) => i.k === 'upload' || i.k === 'post' || i.k === 'clip').map((i) => i.t), now: t });
    // (a format the press began to name: its first run of headlines, to the day)
    if (s) return { at: s.at, precision: 'day', day: dayOf(s.at) };
    // (one explainer is all a month's format may have: its day is when the press began to name it. Every card shows a start)
    return press.length ? { at: press[0], precision: 'day', day: dayOf(press[0]) } : null;
  }
  // (what follows a post without starting anything itself: a completion people only lately type, read after it; a social trend)
  const others = [...((meta.fresh || []).length && Number.isFinite(meta.ytAt) ? [Math.floor(meta.ytAt / 1000)] : []), ...items.filter((i) => i.k === 'social' || i.k === 'asked').map((i) => i.t)];
  const creatorItems = items.filter((i) => i.k === 'upload' || i.k === 'post' || i.k === 'clip' || i.k === 'platform').map((i) => i.t);
  // (earlier: the story's own headlines of the fortnight before its week, from its origin search)
  const told = storyPress(row, items);
  const narrowed = told.length < items.filter(isPress).length;
  const firstTold = told.length ? Math.min(...told.map((i) => i.t)) : null;
  // (a name already searched for what it was doing before the thing happened: that search is no start of this story either)
  const searches = searchesOf(row).filter((x) => !narrowed || firstTold === null || x.start >= firstTold - SEARCH_BEFORE_STORY);
  const found = M.startedOf({ headlines: [...told.map((i) => i.t), ...earlier], creatorItems, searches, others, observedAt, firm: earlier, now: t });
  // (`story`: found among the headlines that tell the story itself, with the name's other coverage set aside: lib/history.js keepStart)
  if (found) return narrowed && firstTold !== null && found.at >= firstTold - SEARCH_BEFORE_STORY ? { ...found, story: true } : found;
  // (a story only posts and clips tell has no headline to start it: its first post is its start, however long the next took. A
  // six-day-old clip then reads "Started 6 days ago", never nothing at all)
  const posts = items.filter((i) => i.k === 'post' || i.k === 'clip' || (i.native && (i.k === 'upload' || i.k === 'platform'))).map((i) => i.t).filter((x) => x <= t).sort((a, b) => a - b);
  return !items.some(isPress) && posts.length ? { at: posts[0], precision: 'hour' } : null;
}

const FLARE_ORIGIN_AGE = 30 * DAY;
const FLARE_RUN_GAP = 7 * DAY;
const FLARE_WINDOW = 12 * DAY;
const STORY_LINE_WORDS = 2;
const SEARCH_BEFORE_STORY = 2 * HOUR;
/**
 * The headlines that start a talking point's story: of its own press, the ones that say its noun or tell its line (two of the
 * line's own words that are not the title's). The coverage a name had before the thing happened is no start: a host's week of
 * previews ended the night he swore on air (judges, 2026-10-11: "Started yesterday" on a story eight hours old). With none such,
 * all of its own press, as before.
 */
function storyPress(row, items) {
  const press = items.filter(isPress);
  if (row.type !== 'point' || row.wordish || !row.family) return press;
  const family = TN.FAMILY.get(row.family) || null;
  // (the title as the engine gave it: a word the desk added to it is still one of the line's own)
  const title = new Set(keyOf(String(row.cardKey || '').replace(/^point:/, '') || row.title || '').split(' ').map((w) => W.stem(w)));
  const line = new Set(W.words(String(row.line || '')).filter((w) => w.length > 2 && !W.STOP.has(w)).map((w) => W.stem(w)).filter((w) => !title.has(w)));
  const tells = (i) => !!i.title && ((!!family && TN.says(i.title, family)) || new Set(W.words(i.title).map((w) => W.stem(w)).filter((w) => line.has(w))).size >= STORY_LINE_WORDS);
  const told = press.filter(tells);
  // (what led to it is part of the story only when the noun followed within a day and a half: a host's sketch hours before his
  // apology is, a tour's week of previews before four of its dates were called off is not. Judges, 2026-10-12: "Started 6d ago"
  // on a cancellation of three days before, by headlines that shared "Usher" and "concert" with its line)
  const saying = family ? told.filter((i) => TN.says(i.title, family)) : [];
  const first = saying.length >= STORY_SAID_MIN ? Math.min(...saying.map((i) => i.t)) : null;
  const near = first === null ? told : told.filter((i) => i.t >= first - STORY_PRELUDE);
  return near.length ? near : told.length ? told : press;
}
const STORY_SAID_MIN = 2;
const STORY_PRELUDE = 36 * HOUR;

/** Whether a headline's time is a day and no hour: Google News dates what is older than a week to midnight Pacific (07:00 or 08:00 UTC, to the second). */
const isDateOnly = (seconds) => seconds % DAY === 7 * HOUR || seconds % DAY === 8 * HOUR;

/**
 * What a name's origin search dates (C4): { from (the first moment it could show), times (the story's own headlines in it, epoch
 * seconds, oldest first) }. Own: the headline names the subject and, when the card has a noun, says it (the family's own words); a
 * week of the name's other news is no start of this story. asked: lib/ingest.js `obs.origins` entry { from, rows: [{ t, title, publisher }] }.
 */
function originOf(asked, row) {
  const last = keyOf(row.subject || '').split(' ').pop();
  const family = row.family ? TN.FAMILY.get(row.family) : null;
  const own = (asked.rows || []).filter((r) => {
    const title = TN.cleanHeadline(r.title, r.publisher);
    return !!last && ` ${keyOf(title)} `.includes(` ${last} `) && (!family || TN.says(title, family));
  }).filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  // (heads: its first few headlines, for the timeline's start to be told from: lib/history.js eventsOf)
  return { from: asked.from, times: own.map((r) => r.t).slice(0, ORIGIN_TIMES_KEPT), heads: own.slice(0, ORIGIN_HEADS_KEPT).map((r) => ({ t: r.t, title: String(r.title || ''), outlet: r.publisher || null })) };
}

module.exports = { namesSubject, tellsStory, ownChapter, chapterOf, storyPress, sampleOf, startOf, originOf, isDateOnly, itemsOf, nativeOf, platformOf, searchesOf, lookupKeyOf, socialOf, socialSubject, PRESS_FEEDS, SEARCH_STEPS, NEW_BY_OBSERVATION, NATIVE_KINDS, VIEWS_AN_HOUR_SCALE };
