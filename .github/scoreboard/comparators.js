'use strict';
/*
 * The comparators (scoreboard-spec.json "comparators"): what is read, and each reply as entries. Pure parsers, zero dependencies and
 * none of the collector's code, so the bar is read the same way whatever the collector becomes. Every entry: { key, title, own (its
 * own time, epoch seconds, or null), rank, ... }.
 *   gt       Google Trends "Trending now", US, the 168-hour list (the collector's own keyless request)
 *   kym      Know Your Meme's confirmed and submitted entries (two RSS feeds)
 *   viral50  Trending TikTok Songs' US Viral chart (the collector reads the same page)
 *   x        X's US trends as getdaytrends shows them (refused or unreadable: X unmeasured that day)
 */

const GT_URL = 'https://trends.google.com/_/TrendsUi/data/batchexecute?rpcids=i0OFE&source-path=%2Ftrending&hl=en-US&rt=c';
const gtBody = (geo) => `f.req=${encodeURIComponent(JSON.stringify([[['i0OFE', JSON.stringify([null, null, geo, 0, 'en-US', 168, 1]), null, 'generic']]]))}`;

/** The reads, in order, one file each (the saved replies use the same names). */
const READS = [
  { id: 'gt', file: 'gt-us-168h.txt', url: GT_URL, init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: gtBody('US') } },
  { id: 'kym-memes', file: 'kym-memes.xml', url: 'https://knowyourmeme.com/memes.rss' },
  { id: 'kym-subs', file: 'kym-subs.xml', url: 'https://knowyourmeme.com/memes/submissions.rss' },
  { id: 'viral50', file: 'tts-viral.html', url: 'https://trendingtiktoksongs.com/charts/us/viral' },
  { id: 'x', file: 'getdaytrends-us.html', url: 'https://getdaytrends.com/united-states/' },
];

const safeJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** Google's batchexecute reply: ")]}'" then length-prefixed JSON chunks; each wrb.fr entry is [_, rpc, payloadJson, ...]. */
function batchPayload(text, rpc) {
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('[["wrb.fr"')) continue;
    for (const e of safeJson(line) || []) if (e && e[0] === 'wrb.fr' && e[1] === rpc && e[2]) return safeJson(e[2]);
  }
  return null;
}

/**
 * Google Trends: [{ key, title, own (start), end, volume, categories, active, related (its first ten related searches) }]. A row is
 * [keyword, _, geo, [start], [end] | null, _, volume, _, growth, related, categories, news ...]. Rows with no start are left out.
 */
function parseGt(text) {
  const rows = (batchPayload(text, 'i0OFE') || [])[1];
  if (!Array.isArray(rows)) return null;
  const out = [];
  rows.forEach((r, i) => {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !Array.isArray(r[3]) || !Number.isFinite(r[3][0])) return;
    const end = Array.isArray(r[4]) && Number.isFinite(r[4][0]) ? r[4][0] : null;
    out.push({ key: `${r[0]}|${r[3][0]}`, title: r[0], own: r[3][0], end, volume: Number.isFinite(r[6]) ? r[6] : 0,
      categories: Array.isArray(r[10]) ? r[10].filter(Number.isFinite) : [], active: end === null, rank: i + 1,
      related: Array.isArray(r[9]) ? r[9].filter((q) => typeof q === 'string').slice(0, 10) : [] });
  });
  return out;
}

/** An RSS feed's items: [{ key (the address), title, own (pubDate) }]. */
function parseRss(xml) {
  const text = String(xml || '');
  if (!/<rss[\s>]/i.test(text)) return null;
  const out = [];
  for (const block of text.split(/<item[\s>]/i).slice(1)) {
    const item = block.split(/<\/item>/i)[0];
    const pick = (tag) => decode((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1] || '');
    const link = pick('link');
    const title = pick('title');
    const at = Date.parse(pick('pubDate'));
    if (!link || !title) continue;
    out.push({ key: link.replace(/[?#].*$/, '').replace(/\/$/, ''), title, own: Number.isFinite(at) ? Math.floor(at / 1000) : null, rank: out.length + 1 });
  }
  return out;
}

/** KYM: both feeds, one entry per address (the earlier pubDate), confirmed first. */
function parseKym(memesXml, subsXml) {
  const a = parseRss(memesXml);
  const b = parseRss(subsXml);
  if (!a && !b) return null;
  const by = new Map();
  for (const [feed, list] of [['confirmed', a || []], ['submitted', b || []]]) {
    for (const e of list) {
      const old = by.get(e.key);
      if (!old) by.set(e.key, { ...e, feed });
      else if (e.own !== null && (old.own === null || e.own < old.own)) by.set(e.key, { ...old, own: e.own });
    }
  }
  return [...by.values()];
}

/** The JSON-LD blocks of a page, flattened. */
function ldNodes(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    const j = safeJson(m[1]);
    if (!j) continue;
    for (const n of Array.isArray(j) ? j : j['@graph'] || [j]) if (n && typeof n === 'object') out.push(n);
  }
  return out;
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** "October 19, 2026" as "2026-10-19", else null. */
function dayOf(text) {
  const m = String(text || '').match(/([A-Z][a-z]{2,8}) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const month = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
  return month < 0 ? null : `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

/** The Viral 50: { day, rows: [{ key (sound id), title, artist, rank }] }, or null when the page holds no chart. */
function parseViral50(html) {
  const list = ldNodes(html).find((n) => n['@type'] === 'ItemList' && Array.isArray(n.itemListElement));
  if (!list) return null;
  const rows = [];
  for (const el of list.itemListElement) {
    const id = (String((el && el.url) || '').match(/-(\d{8,25})\/?$/) || [])[1];
    const rank = Number(el && el.position);
    if (!id || !Number.isFinite(rank) || !el.name) continue;
    const name = decode(el.name);
    const at = name.lastIndexOf(' by ');
    rows.push({ key: id, title: at > 0 ? name.slice(0, at).trim() : name, artist: at > 0 ? name.slice(at + 4).trim() : null, rank, own: null });
  }
  if (!rows.length) return null;
  const plain = String(html).replace(/<[^>]+>/g, ' ');
  return { day: dayOf((plain.match(/As of ([A-Z][a-z]{2,8} \d{1,2}, \d{4})/) || [])[1]), rows };
}

/** getdaytrends' "now" ranking (two tables on the page: 1-15 and 16-50): [{ key, title, rank }], or null when the page holds none. */
function parseX(html) {
  const byRank = new Map();
  for (const m of String(html || '').matchAll(/<th scope="row" class="pos">(\d+)<\/th>\s*<td class="main"><a [^>]*>([^<]+)<\/a>/g)) {
    const rank = Number(m[1]);
    const title = decode(m[2]);
    if (title && !byRank.has(rank)) byRank.set(rank, { key: title.toLowerCase(), title, rank, own: null });
  }
  const rows = [...byRank.values()].sort((a, b) => a.rank - b.rank);
  return rows.length ? rows : null;
}

/** Every comparator's entries from the replies by file name ({ file: text | null }): { gt, kym, viral50, x } each an array or null. */
function parseAll(replies) {
  const r = (file) => (replies[file] === undefined ? null : replies[file]);
  const v = r('tts-viral.html') !== null ? parseViral50(r('tts-viral.html')) : null;
  return {
    gt: r('gt-us-168h.txt') !== null ? parseGt(r('gt-us-168h.txt')) : null,
    kym: parseKym(r('kym-memes.xml'), r('kym-subs.xml')),
    viral50: v ? v.rows : null,
    viral50Day: v ? v.day : null,
    x: r('getdaytrends-us.html') !== null ? parseX(r('getdaytrends-us.html')) : null,
  };
}

module.exports = { READS, parseGt, parseRss, parseKym, parseViral50, parseX, parseAll, dayOf, decode };
