'use strict';
/*
 * Oh No They Didn't (ios/IDEAS-FEED.md L7): a gossip community on LiveJournal whose feed carries, for each of its newest 25 posts,
 * how many replies it has. Keyless, hourly. Read an hour apart, the replies are a count of people arguing about a post: the one
 * community number here that needs neither Reddit nor a login.
 *
 * It is a board, not an outlet: a post is a member's summary of someone else's story. It never words a line and is never named
 * under "Reported by"; who posted it is not read at all.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const FEED = 'https://ohnotheydidnt.livejournal.com/data/rss';
const EVERY_SECONDS = HOUR;
const TITLE_MAX = 200;

/** The feed, asked hourly at most. lastReadAt: epoch seconds or undefined. */
const ontdRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY_SECONDS ? null
  : request({ id: 'ontd', source: 'ontd', kind: 'ontd', args: {}, url: FEED, file: 'ontd.xml', tier: 2 }));

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };

/** The feed as [{ id (the post's number), title, t (posted, epoch seconds), replies }], newest first; null when it is not that feed. */
function parse(xml) {
  const text = String(xml || '');
  if (!/<rss[\s>]/.test(text) || !/lj:reply-count/.test(text)) return null;
  const out = [];
  for (const block of text.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const id = (tag(block, 'link').match(/\/(\d+)\.html/) || [])[1];
    const t = Date.parse(tag(block, 'pubDate'));
    const title = tag(block, 'title').slice(0, TITLE_MAX);
    const replies = Number(tag(block, 'lj:reply-count'));
    if (id && title && Number.isFinite(t) && Number.isFinite(replies)) out.push({ id, title, t: Math.floor(t / 1000), replies });
  }
  return out.sort((a, b) => b.t - a.t);
}

module.exports = { ontdRequest, parse, EVERY_SECONDS };
