'use strict';
/*
 * The owner's switches (ios/IDEAS-FEED.md A5, M11): adapters that are OFF unless IDEAS_SOURCES_ON names them. Each reads a page whose
 * site's own rules or terms speak against automated reading, so switching one on is the owner's call and never a default; nothing
 * else in the collector depends on any of them.
 */
// (and two of the outlets that print people first, whose robots.txt bars named AI crawlers: lib/sources/headline-feeds.js)
const SWITCHED = ['tiktok-web', 'youtube-results', 'tiktok-sound', 'tiktok-profile', 'hl-dailymail', 'hl-variety'];

/** Whether the adapter `id` is switched on in this environment. */
const isOn = (env = {}, id) => SWITCHED.includes(id) && String(env.IDEAS_SOURCES_ON || '').split(',').map((x) => x.trim()).includes(id);

module.exports = { SWITCHED, isOn };
