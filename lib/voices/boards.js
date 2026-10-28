'use strict';
/*
 * The lead boards' posts as voices (wave 9 fast lane; plan #2, E2). The mirror (lib/sources/arctic.js) keeps posts the boards'
 * moderators remove, and a removed rumour is no voice: a post counts for the fast lane only once it survived a re-read SURVIVE_AFTER
 * or more after it was posted, on the boards' own public newest-posts feed (Reddit's /new/.rss of the five boards together: one
 * request covers about eight hours of their posts). It takes Reddit's one request of a cycle every two hours, in the place of one of
 * the four creators'-day reads (lib/budget.js redditTurn; the host cap stays one a cycle), and only at IDEAS_FASTLANE=act: in shadow
 * (unset) the lists read exactly what they read without the lane (offOf). The leaks board is read once an hour as a
 * census only (flair, minute, survival): it makes no row and no voice.
 *
 * Private data: post ids, times, flair and titles live in the collector's own state (meta `voiceBoards`), never in the feed, the
 * ledger or the repository; the log prints counts only. Pure: the cycle sends the requests and hands the replies back.
 *
 * Switches (IDEAS_BOARDS_OFF, comma-separated; the host passes it from a repository variable): `lead` reads the boards as before
 * (lib/sources/arctic.js), `census` drops the leaks board's hourly read, `survive` drops the re-reads (no board post is then a voice).
 * needs license: Reddit (post titles and flair, through the Arctic Shift mirror and Reddit's public RSS); needs permission: Reddit
 * (www.reddit.com/robots.txt reads "Disallow: /" for every agent, 2026-10-28; the re-read takes one of the Reddit reads the collector
 * already sends, so it adds no Reddit request). Collector only, wave 9.
 */
const { request } = require('../sources/fixed');

const HOUR = 3600;
const SURVIVE_AFTER = 1 * HOUR;
// (a post older than this unread is too old to be a young chapter's voice: it is let go unchecked)
const CHECK_UNTIL = 12 * HOUR;
const KEEP = 3 * 24 * HOUR;
const VOICE_FOR = 36 * HOUR;
const POSTS_MAX = 1500;
const RSS_LIMIT = 100;
const TITLE_MAX = 200;
const LEAD_BOARDS = ['livestreamfail', 'youtubedrama', 'popculturechat', 'fauxmoi'];
const CENSUS_BOARD = 'gamingleaksandrumours';
const POST_ID = /^[a-z0-9]{5,10}$/;

/**
 * Which of the reads are off: IDEAS_BOARDS_OFF=lead,census,survive (or all). The fast lane's switch decides too (lib/voices/fastlane.js
 * mode): IDEAS_FASTLANE=off (or 0) turns every read off; the survival re-read, which takes a creators'-day read of Reddit's, runs only
 * at IDEAS_FASTLANE=act, so the lane's shadow (unset) never changes what the lists read.
 */
function offOf(env = process.env) {
  const v = String((env && env.IDEAS_BOARDS_OFF) || '').toLowerCase();
  const set = new Set(v.split(/[\s,]+/).filter(Boolean));
  const lane = String((env && env.IDEAS_FASTLANE) || '').trim().toLowerCase();
  const laneOff = lane === '0' || lane === 'off' || lane === 'false';
  const act = lane === 'act' || lane === 'on' || lane === '1';
  const all = set.has('all') || laneOff;
  return { lead: set.has('lead') || all, census: set.has('census') || all, survive: set.has('survive') || all || !act };
}

const empty = () => ({ posts: {}, checks: 0, removed: 0, survived: 0 });
/** The saved state, made safe: { posts: { id: { sub, t, seenAt, flair, title, census, survived (true | false | null), checkedAt } }, ... }. */
function load(saved) {
  if (!saved || typeof saved !== 'object' || !saved.posts || typeof saved.posts !== 'object') return empty();
  return { ...empty(), ...saved, posts: { ...saved.posts } };
}

/** A posts reply of the mirror (lib/sources/arctic.js parsePosts' shape) kept: lead boards' posts and the census board's. Returns a new state. */
function seen(state, posts, nowS, { census = false } = {}) {
  const next = { ...state, posts: { ...state.posts } };
  for (const p of posts || []) {
    if (!p || !POST_ID.test(String(p.id || '')) || !Number.isFinite(p.t)) continue;
    const sub = String(p.sub || '').toLowerCase();
    if (!(LEAD_BOARDS.includes(sub) || sub === CENSUS_BOARD)) continue;
    const old = next.posts[p.id];
    next.posts[p.id] = old ? { ...old, flair: p.flair || old.flair || null } : { sub, t: p.t, seenAt: nowS, flair: p.flair || null, title: String(p.title || '').slice(0, TITLE_MAX), census: census || sub === CENSUS_BOARD, survived: null, checkedAt: null };
  }
  return prune(next, nowS);
}

/** Old posts let go, and the newest POSTS_MAX kept. */
function prune(state, nowS) {
  const entries = Object.entries(state.posts).filter(([, p]) => nowS - p.t <= KEEP).sort((a, b) => b[1].t - a[1].t).slice(0, POSTS_MAX);
  return { ...state, posts: Object.fromEntries(entries) };
}

/** The board whose posts most want a re-read now (aged SURVIVE_AFTER, unchecked, under CHECK_UNTIL), or null. */
function due(state, nowS) {
  const by = new Map();
  for (const p of Object.values(state.posts)) {
    if (p.survived !== null || nowS - p.t < SURVIVE_AFTER || nowS - p.t > CHECK_UNTIL) continue;
    by.set(p.sub, (by.get(p.sub) || 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

const SUB_NAMES = ['LivestreamFail', 'youtubedrama', 'popculturechat', 'Fauxmoi', 'GamingLeaksAndRumours'];
/** The re-read: the five boards' newest posts together on Reddit's own public feed (one request, in Reddit's one slot of the cycle). */
const newRequest = () => request({ id: 'reddit-new-boards', source: 'reddit', kind: 'reddit-new', args: { sub: null }, url: `https://www.reddit.com/r/${SUB_NAMES.join('+')}/new/.rss?limit=${RSS_LIMIT}`,
  file: 'reddit-new-boards.rss', tier: 3 });
// (Reddit's one request of a cycle, over eight cycles, lib/budget.js REDDIT_TURNS: the re-read takes the seventh, a creators'-day read)
const SURVIVE_TURN = 6;
const TURNS = 8;
/** Whether this cycle's Reddit request is the re-read: its turn, the switch on, and a post waiting for it. */
const surviveTurn = (cycle, state, nowS, off = {}) => !off.survive && cycle % TURNS === SURVIVE_TURN && due(state, nowS) !== null;

/** A /new/.rss reply as { ids: Set, oldest (epoch seconds of its oldest entry) }, or null when it is not one. */
function parseNew(text) {
  const s = String(text || '');
  if (!/<feed[\s>]/.test(s)) return null;
  const ids = new Set([...s.matchAll(/<id>t3_([a-z0-9]{5,10})<\/id>/g)].map((m) => m[1]));
  const times = [...s.matchAll(/<(?:published|updated)>([^<]+)<\/(?:published|updated)>/g)].map((m) => Math.floor(Date.parse(m[1]) / 1000)).filter(Number.isFinite);
  return { ids, oldest: times.length ? Math.min(...times) : null };
}

/**
 * A board's re-read applied: each of its posts aged SURVIVE_AFTER or more and inside the feed's window is survived (still listed) or
 * removed. Posts older than the feed's oldest entry are left unread. Returns a new state.
 */
function checked(state, sub, parsed, nowS) {
  if (!parsed || !parsed.ids.size) return state;
  const next = { ...state, posts: { ...state.posts }, checks: (state.checks || 0) + 1 };
  for (const [id, p] of Object.entries(state.posts)) {
    if ((sub && p.sub !== sub) || p.survived !== null || nowS - p.t < SURVIVE_AFTER) continue;
    if (parsed.oldest !== null && p.t < parsed.oldest) continue;
    const ok = parsed.ids.has(id);
    next.posts[id] = { ...p, survived: ok, checkedAt: nowS };
    if (ok) next.survived = (next.survived || 0) + 1;
    else next.removed = (next.removed || 0) + 1;
  }
  return next;
}

/** The lead boards' posts that survived a re-read, of the last VOICE_FOR: [{ t (ms), title, sub }], the fast lane's board voices. */
const voices = (state, nowS) => Object.values(state.posts).filter((p) => !p.census && p.survived === true && nowS - p.t <= VOICE_FOR)
  .map((p) => ({ t: p.t * 1000, title: p.title, sub: p.sub }));

/** Counts for the log line: posts held, checked, survived share, the census board's flairs. Never a title. */
function counts(state) {
  const ps = Object.values(state.posts);
  const lead = ps.filter((p) => !p.census);
  const done = lead.filter((p) => p.survived !== null);
  const census = ps.filter((p) => p.census);
  const flairs = {};
  for (const p of census) { const f = String(p.flair || 'none').toLowerCase().slice(0, 20); flairs[f] = (flairs[f] || 0) + 1; }
  return { lead: lead.length, checked: done.length, survived: done.filter((p) => p.survived).length, census: census.length, censusChecked: census.filter((p) => p.survived !== null).length,
    censusSurvived: census.filter((p) => p.survived === true).length, flairs };
}

module.exports = { offOf, load, seen, prune, due, newRequest, surviveTurn, parseNew, checked, voices, counts, SUB_NAMES, LEAD_BOARDS, CENSUS_BOARD, SURVIVE_AFTER, CHECK_UNTIL, VOICE_FOR };
