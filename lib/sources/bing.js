'use strict';
/*
 * Bing News as a second opinion on a name (ios/IDEAS-FEED.md L8): its search as RSS, newest first, for the names the list already
 * carries, four a cycle. Keyless. It reaches desks the Google News search does not (a streamer desk that refuses a direct fetch).
 * No cookie it sets is ever sent back (the collector keeps none).
 *
 * Its dates read early: the finder measured about seven hours, a Pacific wall clock printed as GMT. A headline that is dated early
 * would start a story before it began, so a Bing item's time is read as Pacific, seven hours on, and never after now: the cautious
 * side of a doubt. (Bing's completions, the other second opinion, are asked by lib/sources/asked.js.)
 */
const { request } = require('./fixed');
const { HOUR, DAY, keyOf } = require('../util');

const SEARCH = 'https://www.bing.com/news/search';
const PER_CYCLE = 4;
const AGAIN_SECONDS = 6 * HOUR;
const DATE_SHIFT_SECONDS = 7 * HOUR;
// (a second opinion on what is being written NOW: a name's story of last week is another story, and its headlines would tilt the
// row's noun toward it. Seen on the first live run: a week-old arrest's headlines beside this week's ban)
const MAX_AGE_SECONDS = 2 * DAY;
const TITLE_MAX = 220;

const idOf = (name) => `bing-news-${keyOf(name).replace(/ /g, '-')}`;
/** A name's news search, newest first. */
const newsRequest = (name) => request({ id: idOf(name), source: 'bing-news', kind: 'bing-news', args: { name },
  url: `${SEARCH}?q=${encodeURIComponent(`"${String(name).replace(/["“”]/g, '')}"`)}&format=rss&qft=${encodeURIComponent('sortbydate="1"')}`, file: `${idOf(name)}.xml`, tier: 2 });

/**
 * The names asked this cycle: the names of the listed rows that are about a person, not asked for six hours, an Early or rising creators' row first, then by
 * rank; `n` at most. rows: [{ name, rank, rising, early }] as last published; lastReadAt: Map(request id -> epoch seconds).
 */
function pick(rows = [], lastReadAt = new Map(), now = 0, n = PER_CYCLE) {
  // (a person's name only: a game's or a show's name brings its reviews, which are no second opinion on anybody's story)
  const due = rows.filter((r) => r && r.name && r.person !== false && now - (lastReadAt.get(idOf(r.name)) ?? -Infinity) >= AGAIN_SECONDS);
  const first = (r) => (r.early ? 0 : r.rising ? 1 : 2);
  return [...new Set(due.sort((a, b) => first(a) - first(b) || (a.rank ?? 999) - (b.rank ?? 999)).map((r) => r.name))].slice(0, n);
}

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };
/** The article's own address out of Bing's click-through link, or null. */
function target(link) {
  const m = String(link || '').match(/[?&]url=([^&]+)/);
  if (!m) return null;
  try { const url = decodeURIComponent(m[1]); return /^https?:\/\//.test(url) ? url : null; } catch { return null; }
}

/**
 * A reply as rows of the engine's store (talking points only): each headline with the outlet Bing names and the article's own
 * address, nothing older than two days; null when the reply is not that feed. A row needs an outlet's name and an address of its own.
 */
function rows(text, nowMs) {
  const xml = String(text || '');
  if (!/<rss[\s>]/i.test(xml)) return null;
  const out = [];
  for (const block of xml.match(/<item>[\s\S]*?<\/item>/g) || []) {
    const title = tag(block, 'title').replace(/\s*\[(?:video|watch|photos?)\]\s*$/i, '').slice(0, TITLE_MAX);
    const printed = Date.parse(tag(block, 'pubDate'));
    const url = target(tag(block, 'link'));
    const publisher = tag(block, 'News:Source');
    if (!title || !Number.isFinite(printed) || !url || !publisher) continue;
    const t = Math.min(nowMs, printed + DATE_SHIFT_SECONDS * 1000);
    if (nowMs - t > MAX_AGE_SECONDS * 1000) continue;
    out.push({ key: url, title, url, t, publisher, src: 'bing-news', fam: 'gnews', label: 'Bing News', w: 0.7, talkOnly: true });
  }
  return out;
}

module.exports = { newsRequest, pick, rows, target, idOf, PER_CYCLE, AGAIN_SECONDS, DATE_SHIFT_SECONDS };
