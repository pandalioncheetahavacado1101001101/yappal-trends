'use strict';
/*
 * A creator's public TikTok profile page (ios/IDEAS-FEED.md M11, `tiktok-profile`): OFF unless IDEAS_SOURCES_ON names it. TikTok's
 * terms forbid automated collection and its edge serves most cloud addresses a page that asks a browser to prove itself, which is
 * never answered: the owner's call to switch on, and often silent even then.
 *
 * It answers one question about a public creator of a short roster (lib/data/tiktok-roster.json): the exact follower count the
 * page prints. Read every few hours, that is a curve, and a fall in it is what an unfollowing looks like. Nothing else of the
 * page is read or kept.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const SITE = 'https://www.tiktok.com';
const EVERY = 4 * HOUR;
const PER_CYCLE = 4;
const HANDLE = /^[a-z0-9._]{2,24}$/;

let roster = null;
/** The roster: [{ handle, name }], public creators' public handles. */
function creators() {
  if (!roster) roster = require('../data/tiktok-roster.json').creators.filter((c) => c && HANDLE.test(c.handle));
  return roster;
}
const profileRequest = (handle) => request({ id: `tiktok-profile-${handle}`, source: 'tiktok-profile', kind: 'tiktok-profile', args: { handle }, url: `${SITE}/@${handle}`, file: 'tiktok-profile.html', tier: 3 });
/** The profiles read this cycle: the ones not read for four hours, read longest ago first, four at most. readAt: Map(request id -> epoch seconds). */
const turn = (readAt = new Map(), now = 0, max = PER_CYCLE) => creators().map((c, i) => ({ c, i, at: readAt.get(`tiktok-profile-${c.handle}`) ?? -Infinity })).filter((x) => now - x.at >= EVERY)
  .sort((a, b) => a.at - b.at || a.i - b.i).slice(0, max).map((x) => profileRequest(x.c.handle));

/**
 * The page as { handle, followers (exact) }; null when it is not that profile's page (a challenge page, an empty shell, another
 * account's page). Only the newer `statsV2` block is read: the older one is rounded.
 */
function parse(html, handle) {
  const text = String(html || '');
  const stats = text.match(/"statsV2":\{[^{}]*?"followerCount":"(\d{1,12})"/);
  const id = (text.match(/"uniqueId":"([^"]{2,24})"/) || [])[1];
  if (!stats || !id || id.toLowerCase() !== String(handle).toLowerCase()) return null;
  return { handle: id.toLowerCase(), followers: Number(stats[1]) };
}

module.exports = { EVERY, PER_CYCLE, creators, profileRequest, turn, parse };
