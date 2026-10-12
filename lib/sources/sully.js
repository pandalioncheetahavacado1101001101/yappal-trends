'use strict';
/*
 * SullyGnome's table of the Twitch channels that lost the most followers in three days (ios/IDEAS-FEED.md L5): who is being
 * unfollowed, on or off the roster. Keyless, the site's own table call, slow (three to seven seconds a reply), so asked once an
 * hour at most. It names who to look at; it never says why, and it never makes a row by itself.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const URL_LOSERS = 'https://sullygnome.com/api/tables/channeltables/getchannels/3/0/0/8/asc/0/25';
const EVERY_SECONDS = HOUR;
const MIN_VIEWERS = 500;
const PURGE_SHARE = 0.2;
const LOGIN = /^[a-z0-9_]{2,25}$/;

/** The table, asked hourly at most. lastReadAt: epoch seconds or undefined. */
const sullyRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY_SECONDS ? null
  : request({ id: 'sully-losers', source: 'sully', kind: 'sully', args: {}, url: URL_LOSERS, file: 'sully-losers.json', tier: 2 }));

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * The table as the channels people watch that are losing followers: [{ login, name, followers, lost (a positive number, over three
 * days), lostBefore (the three days before; negative when it was gaining then), viewers, share (lost / followers) }], the biggest
 * share first. English channels with 500 average viewers or more: bot purges top the raw table, and a channel that lost a fifth of
 * its followers at once was purged, which is no story. null when it is not that reply.
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || !Array.isArray(j.data)) return null;
  return j.data.filter((d) => d && d.url && Number(d.followersgained) < 0 && Number(d.avgviewers) >= MIN_VIEWERS && /^english$/i.test(String(d.language || '')) && Number(d.followers) > 0)
    .map((d) => ({ login: String(d.url).toLowerCase(), name: clean(d.displayname || d.url), followers: Number(d.followers), lost: -Number(d.followersgained), lostBefore: -Number(d.previousfollowergain || 0),
      viewers: Number(d.avgviewers), share: -Number(d.followersgained) / Number(d.followers) }))
    .filter((d) => LOGIN.test(d.login) && d.share < PURGE_SHARE).sort((a, b) => b.share - a.share);
}

module.exports = { sullyRequest, parse, EVERY_SECONDS, MIN_VIEWERS, PURGE_SHARE };
