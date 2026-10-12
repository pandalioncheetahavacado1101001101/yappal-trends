'use strict';
/*
 * What Twitch itself shows of a streamer (ios/IDEAS-FEED.md L5), by way of api.ivr.fi: a community lookup with public docs, read
 * without a key. One batched request a cycle for the streamer roster (fifty logins): each one's exact follower count, the ban flag
 * and the title they are live under. Read every cycle, a ban is seen the cycle it lands and a drop in followers within the quarter
 * hour. Unofficial, so isolated here, one request a cycle, and simply absent the cycle it is turned away.
 *
 * A ban flag or a follower count is the platform's own figure: it says THAT something happened, never why.
 */
const ROSTER = require('../data/streamer-roster.json');
const { request } = require('./fixed');

const IVR = 'https://api.ivr.fi/v2/twitch/user?login=';
const BATCH = 50;
const LOGIN = /^[a-z0-9_]{2,25}$/;

/** The roster as shipped: [{ login, name, also }], only well-formed logins. */
const streamers = () => (ROSTER.streamers || []).filter((s) => s && LOGIN.test(s.login) && s.name).map((s) => ({ login: s.login, name: s.name, also: Array.isArray(s.also) ? s.also : [] }));

/** The roster's one batched lookup. */
const ivrRequest = () => request({ id: 'ivr', source: 'ivr', kind: 'ivr', args: {}, url: `${IVR}${streamers().slice(0, BATCH).map((s) => s.login).join(',')}`, file: 'ivr-users.json' });

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const seconds = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };

/**
 * The reply as [{ login, name, followers, banned, banReason, live: { title, viewers, game } | null, lastLiveAt }]; null when it is
 * not that reply. A login the lookup does not know is simply not in it.
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(j)) return null;
  return j.filter((u) => u && LOGIN.test(String(u.login || '')) && Number.isFinite(Number(u.followers))).map((u) => ({ login: String(u.login), name: clean(u.displayName || u.login), followers: Number(u.followers),
    banned: u.banned === true, banReason: u.banned === true && u.banReason ? clean(u.banReason).slice(0, 60) : null,
    live: u.stream && u.stream.title ? { title: clean(u.stream.title).slice(0, 140), viewers: Number(u.stream.viewersCount) || 0, game: u.stream.game && u.stream.game.displayName ? clean(u.stream.game.displayName) : null } : null,
    lastLiveAt: u.lastBroadcast ? seconds(u.lastBroadcast.startedAt) : null }));
}

module.exports = { streamers, ivrRequest, parse, BATCH, LOGIN };
