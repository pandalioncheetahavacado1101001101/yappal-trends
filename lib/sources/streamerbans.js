'use strict';
/*
 * StreamerBans' front page (ios/IDEAS-FEED.md L5): the newest eight ban and unban events on Twitch, read from the page's own data
 * block. Keyless, once a cycle. Most are small channels; it is here to find a banned name that is off the streamer roster. A ban is
 * the platform's act: it says that a channel was suspended, never why.
 */
const { request } = require('./fixed');

const PAGE = 'https://streamerbans.com/';
const MIN_FOLLOWERS = 100000;
const LOGIN = /^[a-z0-9_]{2,25}$/;

const bansRequest = () => request({ id: 'streamerbans', source: 'streamerbans', kind: 'streamerbans', args: {}, url: PAGE, file: 'streamerbans.html', tier: 2 });

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const seconds = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };

/**
 * The page as its ban events: [{ login, name, followers, partner, at (when the ban began, epoch seconds), active (still banned) }]
 * for channels with 100,000 followers or more (`minFollowers`), newest first. An unban is no event of its own (it ends one). null
 * when the page is not that page.
 */
function parse(html, { minFollowers = MIN_FOLLOWERS } = {}) {
  const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let j = null;
  try { j = m ? JSON.parse(m[1]) : null; } catch { j = null; }
  const feed = j && j.props && j.props.pageProps && j.props.pageProps.feed;
  if (!Array.isArray(feed)) return null;
  const seen = new Set();
  return feed.filter((e) => e && e.is_ban === true && e.suspensionable && e.suspensionable.login_name).map((e) => ({ login: String(e.suspensionable.login_name).toLowerCase(), name: clean(e.suspensionable.display_name || e.suspensionable.login_name),
    followers: Number(e.suspensionable.followers) || 0, partner: e.suspensionable.is_partner === true, at: seconds(e.created_at), active: e.is_active === true }))
    .filter((e) => LOGIN.test(e.login) && e.at !== null && e.followers >= minFollowers && !seen.has(`${e.login}|${e.at}`) && seen.add(`${e.login}|${e.at}`)).sort((a, b) => b.at - a.at);
}

module.exports = { bansRequest, parse, MIN_FOLLOWERS };
