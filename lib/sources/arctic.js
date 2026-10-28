'use strict';
/*
 * The drama boards by way of Arctic Shift (ios/IDEAS-FEED.md L4): a volunteer's public mirror of Reddit that answers a host Reddit
 * itself turns away. Keyless. Two boards a cycle, two calls each, strictly one at a time and seconds apart (parallel calls and big
 * searches are answered 422 "slow down"): a board's newest hundred comments, counted per thread, say which threads people are
 * arguing in right now; its newest posts give those threads their titles and flair.
 *
 * The mirror freezes a post's score at the moment it copied it, so nothing here is ranked by score: only by how many of the board's
 * newest comments a thread holds. A post's title is its poster's claim and is told as reported.
 *
 * Wave 9 (plan #2, E2): the boards where people's drama is posted first have their newest posts read again whenever a half hour has
 * passed since the last read, and the leaks board's newest posts once an hour as a private census (lib/voices/boards.js). These
 * take only what the host's cap (five a cycle) leaves after the rotation below and the busy threads' titles: they are asked last,
 * at tier 2, so the rotation of before is sent as it was. IDEAS_BOARDS_OFF=lead drops the re-reads, =census the census.
 * needs license: Reddit (post titles and flair through the Arctic Shift mirror).
 */
const { request } = require('./fixed');
const { DAY } = require('../util');

const BASE = 'https://arctic-shift.photon-reddit.com/api';
// (the two boards where creators' drama is argued first take every other cycle; the rest take turns behind them)
const LEAD = ['LivestreamFail', 'youtubedrama'];
const REST = ['Fauxmoi', 'popculturechat', 'TikTokCringe', 'OutOfTheLoop', 'Kaicenat', 'hiphopheads', 'BeautyGuruChatter', 'SubredditDrama'];
const SUBS = [...LEAD, ...REST];
// (wave 9: the boards whose newest posts are read again every half hour, the streamers' board aside: its posts search times out, and
// its clips come from LivestreamFails; and the leaks board, read hourly as a census only)
const LEAD_POSTS = ['youtubedrama', 'popculturechat', 'Fauxmoi'];
const LEAD_EVERY_SECONDS = 25 * 60;
const CENSUS = 'GamingLeaksAndRumours';
const CENSUS_EVERY_SECONDS = 55 * 60;
const CENSUS_BACK_SECONDS = 6 * 3600;
const COMMENTS = 100;
const POSTS = 25;
const POSTS_BACK_SECONDS = 2 * DAY;
const IDS_MAX = 8;
const TITLE_MAX = 200;
const POST_ID = /^[a-z0-9]{5,10}$/;

// (the newest-posts search of the biggest board times out on the mirror even with its bound, 2026-10-12: that board's new posts
// are read with their scores from LivestreamFails, and its busy threads' titles by id)
const NO_POSTS_SEARCH = new Set(['livestreamfail']);
const SLOW_SECONDS = 6 * 3600;
/**
 * A board's calls this cycle: its comments, and its newest posts unless the mirror said "slow down" to that search inside the last
 * six hours (`slow`: { sub: epoch seconds it last answered 422 }).
 */
function boardRequests(sub, nowSeconds, slow = {}) {
  const key = subKey(sub);
  const held = NO_POSTS_SEARCH.has(key) || (Number.isFinite(slow[key]) && nowSeconds - slow[key] < SLOW_SECONDS);
  return held ? [commentsRequest(sub)] : [commentsRequest(sub), postsRequest(sub, nowSeconds)];
}
/** The two boards of a cycle: one of the lead pair in turn, one of the rest in turn. */
const turn = (cycle) => [LEAD[cycle % LEAD.length], REST[cycle % REST.length]];
/**
 * Wave 9: the lead boards' newest posts not read for a half hour (the one read longest ago first), then the leaks board's census when an
 * hour has passed: tier 2, asked after the rotation and the busy threads' titles, so they take only what the host's cap leaves.
 * lastReadAt: Map request id -> epoch seconds of its last answered read; slow: the mirror's "slow down" times; off: { lead, census }.
 * The re-reads are their own kind ('arctic-lead', lib/ingest.js): their posts go to the boards' private record only, never to the native
 * store, so the lists' inputs are those of the rotation alone. A board's rotation read (its 'arctic-posts' id) counts as a read too.
 */
function leadRequests(nowSeconds, lastReadAt = new Map(), slow = {}, off = {}) {
  const ago = (id) => (Number.isFinite(lastReadAt.get(id)) ? nowSeconds - lastReadAt.get(id) : Infinity);
  const lead = off.lead ? [] : LEAD_POSTS.filter((sub) => !(Number.isFinite(slow[subKey(sub)]) && nowSeconds - slow[subKey(sub)] < SLOW_SECONDS))
    .map((sub) => ({ sub, ago: Math.min(ago(`arctic-posts-${subKey(sub)}`), ago(`arctic-lead-${subKey(sub)}`)) })).filter((x) => x.ago >= LEAD_EVERY_SECONDS).sort((a, b) => b.ago - a.ago || a.sub.localeCompare(b.sub))
    .map((x) => leadRequest(x.sub, nowSeconds));
  const census = !off.census && ago(`arctic-census-${subKey(CENSUS)}`) >= CENSUS_EVERY_SECONDS ? [censusRequest(nowSeconds)] : [];
  return [...lead, ...census];
}
/** A lead board's newest posts read again (the rotation's posts search, as its own kind and id: lib/voices/boards.js only). */
const leadRequest = (sub, nowSeconds) => request({ id: `arctic-lead-${subKey(sub)}`, source: 'arctic', kind: 'arctic-lead', args: { sub: subKey(sub) },
  url: `${BASE}/posts/search?subreddit=${sub}&limit=${POSTS}&sort=desc&after=${Math.floor(nowSeconds - POSTS_BACK_SECONDS)}&fields=id,title,created_utc,link_flair_text`, file: `arctic-lead-${subKey(sub)}.json`, tier: 2 });
/** The leaks board's newest posts of the last hours, with flair: a census only (lib/voices/boards.js), never a voice, a signal or a row. */
const censusRequest = (nowSeconds) => request({ id: `arctic-census-${subKey(CENSUS)}`, source: 'arctic', kind: 'arctic-census', args: { sub: subKey(CENSUS) },
  url: `${BASE}/posts/search?subreddit=${CENSUS}&limit=${POSTS}&sort=desc&after=${Math.floor(nowSeconds - CENSUS_BACK_SECONDS)}&fields=id,title,created_utc,link_flair_text`, file: `arctic-census-${subKey(CENSUS)}.json`, tier: 2 });
const subKey = (sub) => String(sub).toLowerCase();

/** A board's newest hundred comments, each with the thread it is in. */
const commentsRequest = (sub) => request({ id: `arctic-comments-${subKey(sub)}`, source: 'arctic', kind: 'arctic-comments', args: { sub: subKey(sub) },
  url: `${BASE}/comments/search?subreddit=${sub}&limit=${COMMENTS}&sort=desc&fields=link_id,created_utc`, file: `arctic-comments-${subKey(sub)}.json` });
/**
 * A board's newest posts of the last two days (the bound is what keeps the search quick: without it the mirror answered 422 twice
 * running on 2026-10-12, with it in under three seconds).
 */
const postsRequest = (sub, nowSeconds) => request({ id: `arctic-posts-${subKey(sub)}`, source: 'arctic', kind: 'arctic-posts', args: { sub: subKey(sub) },
  url: `${BASE}/posts/search?subreddit=${sub}&limit=${POSTS}&sort=desc&after=${Math.floor(nowSeconds - POSTS_BACK_SECONDS)}&fields=id,title,created_utc,link_flair_text`, file: `arctic-posts-${subKey(sub)}.json` });
/** The titles of threads people are commenting in that the newest posts did not carry: one call, a handful of ids. */
function idsRequest(ids) {
  const wanted = [...new Set(ids)].filter((id) => POST_ID.test(id)).slice(0, IDS_MAX);
  if (!wanted.length) return null;
  return request({ id: 'arctic-ids', source: 'arctic', kind: 'arctic-posts', args: { sub: null }, url: `${BASE}/posts/ids?ids=${wanted.join(',')}&fields=id,title,created_utc,link_flair_text,subreddit`, file: 'arctic-ids.json', tier: 2 });
}

const dataOf = (text) => { try { const j = JSON.parse(text); return j && Array.isArray(j.data) ? j.data : null; } catch { return null; } };

/**
 * A comments reply as { span (seconds from its oldest comment to its newest), newest (epoch seconds), threads: [{ id, n (comments
 * of the hundred), last }] busiest first }; null when it is not that reply (the mirror's "slow down" has no data).
 */
function parseComments(text) {
  const data = dataOf(text);
  if (!data) return null;
  const by = new Map();
  let newest = -Infinity;
  let oldest = Infinity;
  for (const c of data) {
    const id = String((c && c.link_id) || '').replace(/^t3_/, '');
    const at = Number(c && c.created_utc);
    if (!POST_ID.test(id) || !Number.isFinite(at)) continue;
    newest = Math.max(newest, at);
    oldest = Math.min(oldest, at);
    const old = by.get(id) || { id, n: 0, last: 0 };
    by.set(id, { id, n: old.n + 1, last: Math.max(old.last, at) });
  }
  if (!by.size) return { span: 0, newest: null, threads: [] };
  return { span: Math.max(0, newest - oldest), newest, threads: [...by.values()].sort((a, b) => b.n - a.n || b.last - a.last) };
}

/** A posts reply as [{ id, title, t (posted, epoch seconds), flair, sub }]; null when it is not that reply. */
function parsePosts(text, sub = null) {
  const data = dataOf(text);
  if (!data) return null;
  return data.filter((p) => p && POST_ID.test(String(p.id || '')) && p.title && Number.isFinite(Number(p.created_utc)))
    .map((p) => ({ id: String(p.id), title: String(p.title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX), t: Number(p.created_utc),
      // (a flair's emoji shortcodes are decoration: ":twitch:", "Funny:lul:")
      flair: p.link_flair_text ? String(p.link_flair_text).replace(/:[\w-]+:/g, '').trim() || null : null, sub: subKey(p.subreddit || sub || '') || null }));
}

/** Comments an hour a thread is getting, by its share of the board's newest hundred (a window under ten minutes is too short to say). */
const perHour = (n, span) => (span >= 600 ? Math.round((n * 3600) / span) : null);

module.exports = { SUBS, LEAD, REST, LEAD_POSTS, CENSUS, turn, leadRequests, leadRequest, censusRequest, boardRequests, NO_POSTS_SEARCH, SLOW_SECONDS, commentsRequest, postsRequest, idsRequest, parseComments,
  parsePosts, perHour, subKey, IDS_MAX };
