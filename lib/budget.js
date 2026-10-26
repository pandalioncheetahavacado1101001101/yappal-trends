'use strict';
/*
 * The request budget of one cycle and the back-off of a host (ios/IDEAS-FEED.md A4). Pure: the caps are constants here, raised only
 * after a week of `fetches` shows a host is never turned away and lowered the day it is. Nothing here sends a request.
 */
const { HOUR } = require('./util');

// (130 since the keyless drama sources, 2026-10-12: about 45 more requests a cycle, 17 of them the commentary roster's feeds. L)
// (150 since the platform, word and craze sources, the same day: about 8 more a cycle, 20 more the cycle a cold start reads the daily lists. M)
const CYCLE_CAP = 150;
const FETCH_DEADLINE_SECONDS = 240;
// per-host caps a cycle (a host group: every Wikimedia site is one)
// (the unofficial ones are one a cycle or less: the clip charts, X's trends by way of a third party's page; TikTok's is opt-in. A5)
// (completions: 28 since the wildcard templates share the host with the name completions, so names are not starved. L1)
// (completions: 32 since three more templates a cycle ask what a word means, what a trend is and what shoppers call viral: with
// the eleven questions about people, ten names, six of the roster watch and two re-searched names that is 32. M7)
// (Wikimedia stays 10: it was tried at 14 for Wiktionary's categories and entries, and the host answered 429 in the third live
// cycle, so it was lowered the same day, as the rule above says. The dictionary's calls take what the cap leaves. M6, M14)
const HOST_CAPS = { 'news.google.com': 24, 'suggestqueries.google.com': 32, wikimedia: 10, 'trends.google.com': 5, 'knowyourmeme.com': 4, 'www.reddit.com': 1,
  'gql.twitch.tv': 1, 'kick.com': 1, 'trends24.in': 1, 'www.tiktok.com': 8,
  // the keyless drama sources (L): the roster's feeds, the drama boards' mirror (one call at a time), and one request a cycle or less each for the rest
  // (YouTube: the roster's 17 feeds, and room for the two results pages of the owner's `youtube-results` switch when it is on: M11)
  'www.youtube.com': 19, 'arctic-shift.photon-reddit.com': 5, 'api.livestreamfails.com': 1, 'api.ivr.fi': 1, 'sullygnome.com': 1, 'streamerbans.com': 1, 'www.famousbirthdays.com': 1,
  'ohnotheydidnt.livejournal.com': 1, 'pagesix.com': 1, 'www.ladbible.com': 1, 'www.complex.com': 1, 'theshaderoom.com': 1, 'www.hotnewhiphop.com': 1, 'api.bing.com': 2, 'www.bing.com': 4,
  // (the drama desks, each hourly, one a cycle: lib/sources/drama-desks.js)
  'thejasminebrand.com': 1, 'popculture.com': 1,
  // the platform, word and craze sources (M): the sound charts and one sound's page, a page or a file a cycle or less each for the rest
  'trendingtiktoksongs.com': 3, 'later.com': 1, 'www.ramd.am': 1, 'creatordb.app': 1, 'www.shazam.com': 1, 'kworb.net': 1, 'dumps.wikimedia.org': 1, 'storage.googleapis.com': 1, 'trends.pinterest.com': 1,
  'rss.marketingtools.apple.com': 1, 'itunes.apple.com': 1, 'apis.roblox.com': 1, 'games.roblox.com': 1, 'api.steampowered.com': 2 };
const DEFAULT_HOST_CAP = 4;
// one request at a time per host, this far apart (Google News with a little jitter on top)
const HOST_GAP_MS = { 'news.google.com': 1500, 'suggestqueries.google.com': 500, wikimedia: 1000, 'trends.google.com': 700, 'knowyourmeme.com': 2500, 'www.tiktok.com': 3000,
  // (the mirror answers 422 to calls close together: seconds apart, strictly one at a time. L4)
  'www.youtube.com': 1000, 'arctic-shift.photon-reddit.com': 3500, 'www.bing.com': 1500, 'api.bing.com': 700, 'trendingtiktoksongs.com': 2000, 'api.steampowered.com': 1000 };
const DEFAULT_GAP_MS = 300;
const GAP_JITTER_MS = { 'news.google.com': 400 };
const REDDIT_GAP_SECONDS = 61;
// tiers (A4)
const NAMES_PER_CYCLE = 10;
const ROTATION_PER_CYCLE = 8;
const ROSTER_WATCH_PER_CYCLE = 6;
const RESEARCH_PER_CYCLE = 2;
const STORY_LOOKUPS_PER_CYCLE = 4;
const WORD_LOOKUPS_PER_CYCLE = 4;
const KYM_PAGES_PER_CYCLE = 2;
const ORIGINS_PER_CYCLE = 2;
const RISING_RESEARCH_SECONDS = 45 * 60;
const PAGE_RESEARCH_SECONDS = 3 * HOUR;
const MORE_RESEARCH_SECONDS = 8 * HOUR;
// back-off
const BACKOFF_FIRST_SECONDS = 15 * 60;
const BACKOFF_MAX_SECONDS = 6 * HOUR;
const BACKOFF_LONG_AFTER_SECONDS = 24 * HOUR;
const TURNED_AWAY = new Set([429, 403, 503]);
const TIMEOUTS_IN_A_ROW = 2;
// a host's own way of saying "slow down" that is none of the statuses above: the drama boards' mirror answers 422 (L4); and
// YouTube answers a channel's feed 404 (then 500) once it has had enough of an address, for channels whose feeds it served an
// hour before (the joined run of 2026-10-12, O5: ten 404s in one cycle, each of which also cleared the strike the 500 before had
// left, so the feeds were asked again every other cycle). Every id of the roster was a live channel when it was listed, so a 404
// there is a refusal; a channel that has since gone costs its turn's feeds a quarter hour and is named in the log
const HOST_SLOW_DOWN = { 'arctic-shift.photon-reddit.com': new Set([422]), 'www.youtube.com': new Set([404]) };

/** A host's group for caps, gaps and back-off: every Wikimedia site is one host, any other is itself. */
// (the dumps are another server, with a limit of its own: one file an hour, never counted against the API's cap. M4)
const hostGroup = (host) => (host !== 'dumps.wikimedia.org' && /(?:^|\.)(?:wikipedia|wikimedia|wiktionary)\.org$/.test(host) ? 'wikimedia' : host);
const hostOfUrl = (url) => hostGroup(new URL(url).host);
const capOf = (host) => HOST_CAPS[host] ?? DEFAULT_HOST_CAP;
const gapOf = (host, random = Math.random) => (HOST_GAP_MS[host] ?? DEFAULT_GAP_MS) + Math.round((GAP_JITTER_MS[host] || 0) * random());

/**
 * One honest user agent for every request: `YapPalIdeas/1 (+<contact>)`, the contact from IDEAS_UA_CONTACT, else the repository's own
 * URL where the host gives one (a CI run), else none. Never a browser's, never rotated.
 */
function userAgent(env = process.env) {
  const contact = (env.IDEAS_UA_CONTACT || '').trim() || (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : '');
  return contact ? `YapPalIdeas/1 (+${contact})` : 'YapPalIdeas/1';
}

// ---------- back-off ----------
/** Whether a host may be asked at `now`: not in back-off. row: the `hosts` row, or null for a host never asked. */
const hostOpen = (row, now) => !row || !Number.isFinite(row.blocked_until) || row.blocked_until <= now;
/**
 * A host's row after one request. outcome: { status (0 when the request failed or timed out), retryAfter (seconds, or null), timeout }.
 * A 429, a 403, a 503 or two timeouts in a row put it aside for 15 minutes, doubling to 6 hours, or for as long as Retry-After says;
 * after 24 hours of being turned away it is tried once every 6 hours. Any other answer clears it. host: the host's name, for a host
 * that says "slow down" in a status of its own (HOST_SLOW_DOWN); a row carries it once it has been asked.
 */
function hostAfter(row, outcome, now, host = (row && row.host) || null) {
  const old = { host: null, blocked_until: null, strikes: 0, last_ok_at: null, last_status: null, first_turned_away_at: null, timeouts: 0, last_request_at: null, ...(row || {}) };
  const next = { ...old, last_status: outcome.status || 0, last_request_at: now };
  const timeouts = outcome.timeout ? old.timeouts + 1 : 0;
  // (any 5xx is the host failing: a 502 from the realtime Trends host went on being asked every cycle, with no back-off and so no
  // RSS in its place. Reviewers, 2026-10-12)
  const away = TURNED_AWAY.has(outcome.status) || (outcome.status >= 500 && outcome.status < 600) || timeouts >= TIMEOUTS_IN_A_ROW || !!(host && HOST_SLOW_DOWN[host] && HOST_SLOW_DOWN[host].has(outcome.status));
  if (!away) {
    next.timeouts = timeouts;
    // (an answer that is no refusal: the host is reachable again)
    if (outcome.status >= 200 && outcome.status < 500) { next.strikes = 0; next.blocked_until = null; next.first_turned_away_at = null; }
    if (outcome.status >= 200 && outcome.status < 400) next.last_ok_at = now;
    return next;
  }
  next.timeouts = 0;
  next.strikes = old.strikes + 1;
  next.first_turned_away_at = old.first_turned_away_at ?? now;
  const long = now - next.first_turned_away_at >= BACKOFF_LONG_AFTER_SECONDS;
  const stepped = Math.min(BACKOFF_MAX_SECONDS, BACKOFF_FIRST_SECONDS * Math.pow(2, Math.min(20, next.strikes - 1)));
  const wait = long ? BACKOFF_MAX_SECONDS : Number.isFinite(outcome.retryAfter) && outcome.retryAfter > 0 ? Math.max(outcome.retryAfter, BACKOFF_FIRST_SECONDS) : stepped;
  next.blocked_until = now + wait;
  return next;
}
/** Retry-After as seconds: a number of seconds, or an HTTP date; null when absent or unreadable. */
function retryAfterSeconds(header, nowSeconds) {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n)) return n > 0 ? n : null;
  const at = Date.parse(header);
  return Number.isFinite(at) && at / 1000 > nowSeconds ? Math.ceil(at / 1000 - nowSeconds) : null;
}

// ---------- the cycle's budget ----------
/**
 * What one cycle may still send: `take(request)` says yes and counts it, or says why not ('cap', 'host-cap', 'back-off', 'off',
 * 'reddit-gap'). requests: { id, host (a host group), source (the adapter's id) }. hosts: Map(host -> row). off: adapter ids turned off.
 */
function createBudget({ cap = CYCLE_CAP, hosts = new Map(), now, off = new Set(), reserve = {} } = {}) {
  const perHost = new Map();
  // (requests of a host kept back for a later round of the same cycle: `release` frees them)
  const held = new Map(Object.entries(reserve));
  let used = 0;
  const refused = [];
  const blocked = new Set();
  return {
    take(request) {
      const host = request.host;
      const why = off.has(request.source) ? 'off' : !hostOpen(hosts.get(host), now) ? 'back-off' : used >= cap ? 'cap' : (perHost.get(host) || 0) >= capOf(host) - (held.get(host) || 0) ? 'host-cap' :
        host === 'www.reddit.com' && hosts.get(host) && Number.isFinite(hosts.get(host).last_request_at) && now - hosts.get(host).last_request_at < REDDIT_GAP_SECONDS ? 'reddit-gap' : null;
      if (why) { refused.push({ id: request.id, host, why }); if (why === 'back-off') blocked.add(host); return false; }
      used += 1;
      perHost.set(host, (perHost.get(host) || 0) + 1);
      return true;
    },
    /** A request that was counted but never sent (its host was put aside mid-cycle) gives its place back. */
    /** Frees what was kept back on a host: the round it was kept for is about to be sent. */
    release(host) { held.delete(host); },
    giveBack(request) { used = Math.max(0, used - 1); perHost.set(request.host, Math.max(0, (perHost.get(request.host) || 0) - 1)); },
    get used() { return used; },
    get left() { return Math.max(0, cap - used); },
    usedOn: (host) => perHost.get(host) || 0,
    leftOn: (host) => Math.max(0, Math.min(cap - used, capOf(host) - (perHost.get(host) || 0))),
    refused,
    blocked,
  };
}

/** Tier 2: the `n` feeds in rotation read longest ago (never read first, then the oldest), in the list's own order among equals. */
function rotation(ids, lastReadAt, n = ROTATION_PER_CYCLE) {
  return ids.map((id, i) => ({ id, i, at: lastReadAt.get(id) ?? -Infinity })).sort((a, b) => a.at - b.at || a.i - b.i).slice(0, n).map((x) => x.id);
}

/**
 * The rotation's ids that can be asked this cycle: not turned off, and their host not in back-off. A feed that cannot be asked must
 * not take a turn: it would be picked first every cycle (never read), and the feeds behind it would wait for hours.
 * requestsOf: (id) => that id's requests this cycle; ctx: { hosts: Map(host -> row), off: Set(source ids), now }.
 */
const askable = (ids, requestsOf, { hosts = new Map(), off = new Set(), now }) => ids.filter((id) => requestsOf(id).some((r) => !off.has(r.source) && hostOpen(hosts.get(r.host), now)));

/**
 * Reddit's one request of a cycle, over eight cycles: creators' day, the pop-culture multireddit, creators' day, r/popular, creators'
 * day, the influencers' and TikTokers' boards' day, creators' day, then the creators' week and r/OutOfTheLoop's week in turn. (The
 * streamers' and YouTubers' boards every half hour; each other list every two hours.)
 */
const REDDIT_TURNS = ['creators-day', 'multi-day', 'creators-day', 'popular-day', 'creators-day', 'snark-day', 'creators-day', null];
const redditTurn = (cycle) => REDDIT_TURNS[cycle % 8] || (Math.floor(cycle / 8) % 2 === 0 ? 'creators-week' : 'ootl-week');

/**
 * Tier 1: the names that need a look now, 10 a cycle at most, in this order: new this cycle (creators first); an Early or rising row
 * not searched for 45 minutes; a row that is accelerating; then the backlog, the names never searched that were already waiting (a cold
 * start, a burst of more than ten): the listed rows first, by rank, so the page's own names are read before names no list shows, then
 * the engine's order. Then (tier 3, `research` a cycle) the rest of the page's names when not searched for 3 hours, and rows 21 on
 * when not searched for 8.
 * fresh: names never searched that first showed this cycle, in the engine's own order (its people-drama names lead it, creators
 * first); backlog: the other names never searched, in the same order;
 * rows: [{ name, rank, rising, early, accelerating }] as last published; searchedAt: Map(name -> epoch seconds).
 * Returns { now: [names], later: [names] }.
 */
function pickNames({ fresh = [], backlog = [], rows = [], searchedAt = new Map(), now, max = NAMES_PER_CYCLE, research = RESEARCH_PER_CYCLE }) {
  const since = (name) => now - (searchedAt.get(name) ?? -Infinity);
  const picked = [];
  const add = (name) => { if (name && !picked.includes(name) && picked.length < max) picked.push(name); };
  for (const name of fresh) if (!searchedAt.has(name)) add(name);
  for (const r of rows) if ((r.early || r.rising) && since(r.name) >= RISING_RESEARCH_SECONDS) add(r.name);
  for (const r of rows) if (r.accelerating && since(r.name) >= RISING_RESEARCH_SECONDS) add(r.name);
  for (const r of [...rows].filter((x) => x.name && !searchedAt.has(x.name)).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))) add(r.name);
  for (const name of backlog) if (!searchedAt.has(name)) add(name);
  const later = [];
  const owed = rows.filter((r) => r.name && !picked.includes(r.name) && since(r.name) >= (r.rank !== null && r.rank <= 20 ? PAGE_RESEARCH_SECONDS : MORE_RESEARCH_SECONDS))
    .sort((a, b) => since(b.name) - since(a.name) || (a.rank ?? 999) - (b.rank ?? 999));
  for (const r of owed) if (!later.includes(r.name) && later.length < research) later.push(r.name);
  return { now: picked, later };
}

module.exports = { CYCLE_CAP, FETCH_DEADLINE_SECONDS, HOST_CAPS, DEFAULT_HOST_CAP, HOST_GAP_MS, REDDIT_GAP_SECONDS, NAMES_PER_CYCLE, ROTATION_PER_CYCLE, ROSTER_WATCH_PER_CYCLE,
  RESEARCH_PER_CYCLE, STORY_LOOKUPS_PER_CYCLE, WORD_LOOKUPS_PER_CYCLE, KYM_PAGES_PER_CYCLE, ORIGINS_PER_CYCLE, RISING_RESEARCH_SECONDS, PAGE_RESEARCH_SECONDS, MORE_RESEARCH_SECONDS,
  BACKOFF_FIRST_SECONDS, BACKOFF_MAX_SECONDS, BACKOFF_LONG_AFTER_SECONDS, hostGroup, hostOfUrl, capOf, gapOf, userAgent, hostOpen, hostAfter, retryAfterSeconds, createBudget,
  rotation, askable, redditTurn, pickNames };
