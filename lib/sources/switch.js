'use strict';
/*
 * The owner's switches (ios/IDEAS-FEED.md A5, M11): adapters that are OFF unless IDEAS_SOURCES_ON names them. Each reads a page whose
 * site's own rules or terms speak against automated reading, so switching one on is the owner's call and never a default; nothing
 * else in the collector depends on any of them.
 */
const SWITCHED = ['tiktok-web', 'youtube-results', 'tiktok-sound', 'tiktok-profile'];

/** Whether the adapter `id` is switched on in this environment. */
const isOn = (env = {}, id) => SWITCHED.includes(id) && String(env.IDEAS_SOURCES_ON || '').split(',').map((x) => x.trim()).includes(id);

module.exports = { SWITCHED, isOn };
