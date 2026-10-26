'use strict';
/*
 * Outlets read at their own address (ios/IDEAS-FEED.md L7): three news sitemaps (Page Six, LADbible, Complex: the complete, timed
 * list of what each published in two days, where a search shows a sample) and two feeds from the rap and Black-culture press
 * (The Shade Room, HotNewHipHop), which the celebrity desks already read run late on. Keyless, ordinary published files; each is
 * read every half hour (a sitemap) or hour (a feed), three of them a cycle at most.
 *
 * Their rows join the engine's store as the people-drama searches' rows do: a headline with its outlet and its own time, for the
 * talking points only. They are press: they widen and time the coverage, they are not creator-native signals.
 */
const { request } = require('./fixed');
const { HOUR, DAY } = require('../util');

const OUTLETS = [
  { id: 'press-pagesix', label: 'Page Six', url: 'https://pagesix.com/news-sitemap.xml', shape: 'sitemap', every: HOUR / 2 },
  { id: 'press-ladbible', label: 'LADbible', url: 'https://www.ladbible.com/googlenews.xml', shape: 'sitemap', every: HOUR / 2 },
  { id: 'press-complex', label: 'Complex', url: 'https://www.complex.com/sitemap/v3/news.xml', shape: 'sitemap', every: HOUR / 2 },
  { id: 'press-shaderoom', label: 'The Shade Room', url: 'https://theshaderoom.com/feed/', shape: 'rss', every: HOUR, kicker: true },
  { id: 'press-hnhh', label: 'HotNewHipHop', url: 'https://www.hotnewhiphop.com/feed', shape: 'rss', every: HOUR },
];
const PER_CYCLE = 3;
const MAX_AGE_SECONDS = 4 * DAY;
const TITLE_MAX = 220;

// (the drama desks, lib/sources/drama-desks.js, are read the same way on their own turn: their replies are rows as these are)
const outletOf = (id) => OUTLETS.find((o) => o.id === id) || require('./drama-desks').deskOf(id);
/** The outlets due this cycle: not read for their interval, the one read longest ago first, `n` at most. lastReadAt: Map(id -> epoch seconds). */
function due(lastReadAt = new Map(), now = 0, n = PER_CYCLE) {
  return OUTLETS.map((o, i) => ({ o, i, at: lastReadAt.get(o.id) ?? -Infinity })).filter((x) => now - x.at >= x.o.every)
    .sort((a, b) => a.at - b.at || a.i - b.i).slice(0, n).map((x) => x.o);
}
const pressRequest = (o) => request({ id: o.id, source: o.id, kind: 'press', args: { outlet: o.id }, url: o.url, file: `${o.id}.xml`, tier: 2 });

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };

// what a feed hangs on a headline that is no part of it: "(VIDEO)", "(PHOTOS)", "[WATCH]"
const TAIL = /\s*[([](?:videos?|photos?|watch|exclusive|updated?|update|clip|pics?)[)\]]\s*$/i;
// The Shade Room opens a headline with a shout of its own ("Prayers Up! ...", "Loud On The Creek? ..."): the headline is what follows
const KICKER = /^(?:[\p{L}\p{N}’'&-]+\s){0,4}[\p{L}\p{N}’'&-]+[!?]\s+(?=\p{Lu})/u;

/** A headline without the feed's own trimmings. */
function headline(title, { kicker = false } = {}) {
  let s = String(title || '').replace(TAIL, '').trim();
  if (kicker) { const cut = s.replace(KICKER, ''); if (cut.split(/\s+/).length >= 5) s = cut; }
  return s.slice(0, TITLE_MAX);
}

/** A news sitemap as [{ title, url, t (ms) }]: every <url> that carries a news title and a publication date. */
function parseSitemap(xml) {
  const out = [];
  for (const block of String(xml || '').match(/<url>[\s\S]*?<\/url>/g) || []) {
    const title = tag(block, 'news:title');
    const t = Date.parse(tag(block, 'news:publication_date') || tag(block, 'lastmod'));
    const url = tag(block, 'loc');
    if (title && Number.isFinite(t) && /^https?:\/\//.test(url)) out.push({ title, url, t });
  }
  return out;
}
/** An RSS feed as [{ title, url, t (ms) }]. */
function parseRss(xml) {
  const out = [];
  for (const block of String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/g) || []) {
    const title = tag(block, 'title');
    const t = Date.parse(tag(block, 'pubDate'));
    const url = tag(block, 'link');
    if (title && Number.isFinite(t) && /^https?:\/\//.test(url)) out.push({ title, url, t });
  }
  return out;
}

/**
 * One outlet's reply as rows of the engine's store (talking points only), or null when the reply is not that file (a challenge
 * page is HTML, a sitemap with no news entries is not a news sitemap). Nothing older than four days, nothing dated ahead of now.
 */
function rows(outletId, text, nowMs) {
  const o = outletOf(outletId);
  const xml = String(text || '');
  if (!o || !(o.shape === 'sitemap' ? /<urlset[\s>]/.test(xml) : /<rss[\s>]/.test(xml))) return null;
  const items = o.shape === 'sitemap' ? parseSitemap(xml) : parseRss(xml);
  if (!items.length) return null;
  return items.filter((x) => nowMs - x.t <= MAX_AGE_SECONDS * 1000 && x.t <= nowMs + HOUR * 1000).map((x) => ({ key: x.url, title: headline(x.title, o), url: x.url, t: x.t, publisher: o.label, src: o.id, fam: 'gnews',
    label: o.label, w: 0.8, talkOnly: true })).filter((r) => r.title.split(/\s+/).length >= 4);
}

module.exports = { OUTLETS, PER_CYCLE, due, pressRequest, rows, parseSitemap, parseRss, headline, outletOf };
