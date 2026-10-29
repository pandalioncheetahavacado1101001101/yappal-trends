'use strict';
/*
 * The commentary and drama roster on YouTube (ios/IDEAS-FEED.md L2): each channel's own upload feed, the Atom file every channel
 * page links to. Keyless. Sixteen or seventeen feeds a cycle, the ones read longest ago first, so each of about 65 channels is
 * read about once an hour (the feed itself is cached for fifteen minutes).
 *
 * A feed gives each of the channel's newest fifteen uploads with its title, when it was published, its views and its likes. A
 * video title is a claim by whoever made the video: it names who the channel is talking about, and it is never a fact to repeat.
 * Read twice an hour apart, the views are a real curve (views an hour), which nothing else keyless gives.
 * needs permission: YouTube (youtube.com/robots.txt disallows /feeds/videos.xml for every agent; read 2026-10-29).
 */
const ROSTER = require('../data/drama-roster.json');
const { request } = require('./fixed');
const { DAY } = require('../util');

const FEED = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
const PER_CYCLE = 17;
const SILENT_DAYS = 21;
const SILENT_RETRY_SECONDS = DAY;
const TITLE_MAX = 160;
const CHANNEL_ID = /^UC[\w-]{22}$/;

/** The roster as shipped: [{ id, name, group }], only well-formed ids. */
const channels = () => (ROSTER.channels || []).filter((c) => c && CHANNEL_ID.test(c.id) && c.name);
const idOf = (channelId) => `yt-roster-${channelId}`;

/**
 * The channels whose feeds are read this cycle: the `n` read longest ago, never read first. A channel whose newest upload is 21
 * days old or more has gone quiet: it takes a turn only once a day, until it uploads again.
 * lastReadAt: Map(request id -> epoch seconds); newest: { channelId: epoch seconds of its newest upload } as last read.
 */
function turn(lastReadAt = new Map(), newest = {}, now = 0, n = PER_CYCLE) {
  const silent = (c) => Number.isFinite(newest[c.id]) && now - newest[c.id] >= SILENT_DAYS * DAY;
  return channels().map((c, i) => ({ c, i, at: lastReadAt.get(idOf(c.id)) ?? -Infinity }))
    .filter((x) => !silent(x.c) || now - x.at >= SILENT_RETRY_SECONDS)
    .sort((a, b) => a.at - b.at || a.i - b.i).slice(0, n).map((x) => x.c);
}
/** One channel's feed. */
const feedRequest = (c) => request({ id: idOf(c.id), source: 'yt-roster', kind: 'yt-roster', args: { channel: c.id }, url: `${FEED}${c.id}`, file: `${idOf(c.id)}.xml` });

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };
const attr = (block, name, key) => { const m = block.match(new RegExp(`<${name}\\s[^>]*?${key}="([^"]*)"`)); return m ? m[1] : null; };

/**
 * A channel feed as { channelId, channel (its own name), videos: [{ id, title, t (published, epoch seconds), views, likes }] },
 * newest first; null when the reply is not a channel's feed (an error page, a consent page).
 */
function parse(text) {
  const xml = String(text || '');
  if (!/<feed[\s>]/.test(xml) || !/<yt:channelId>/.test(xml)) return null;
  const head = xml.split(/<entry>/)[0];
  const channelId = `UC${tag(head, 'yt:channelId').replace(/^UC/, '')}`;
  const videos = [];
  for (const block of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const id = tag(block, 'yt:videoId');
    const t = Date.parse(tag(block, 'published'));
    const title = tag(block, 'title').slice(0, TITLE_MAX);
    if (!/^[\w-]{6,20}$/.test(id) || !title || !Number.isFinite(t)) continue;
    const views = Number(attr(block, 'media:statistics', 'views'));
    const likes = Number(attr(block, 'media:starRating', 'count'));
    videos.push({ id, title, t: Math.floor(t / 1000), views: Number.isFinite(views) ? views : null, likes: Number.isFinite(likes) ? likes : null });
  }
  return { channelId, channel: tag(head, 'title') || null, videos: videos.sort((a, b) => b.t - a.t) };
}

module.exports = { channels, turn, feedRequest, parse, idOf, PER_CYCLE, SILENT_DAYS };
