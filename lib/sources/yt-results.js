'use strict';
/*
 * YouTube's results page for a phrase, uploaded today, by views (ios/IDEAS-FEED.md M11, `youtube-results`): OFF unless
 * IDEAS_SOURCES_ON names it. `youtube.com/robots.txt` lists `Disallow: /results` and YouTube's terms point at its API, so this is
 * the owner's call to switch on, the same standing as `tiktok-web`. About 1.2 MB a call: two phrasings a cycle in turn.
 *
 * It answers what no roster can: which videos about trouble, from any channel, are being watched today. A result is a video's
 * title, its channel and its views as the page prints them; read again, the views are a curve.
 */
const { request } = require('./fixed');
const { countOf } = require('./html');

const RESULTS = 'https://www.youtube.com/results';
// (uploaded today, sorted by view count: the page's own filter)
const TODAY_BY_VIEWS = 'CAMSBAgCEAE%3D';
const PHRASES = ['responds to allegations', 'exposed', 'situation', 'apology', 'leaked', 'banned', 'called out', 'beef'];
const PER_CYCLE = 2;
const VIDEOS_MAX = 20;
const TITLE_MAX = 200;

/** The phrasings asked this cycle: the next two after `cursor`. Returns { requests, cursor }. */
function requests(cursor = 0, n = PER_CYCLE) {
  const start = ((cursor % PHRASES.length) + PHRASES.length) % PHRASES.length;
  const picked = Array.from({ length: Math.min(n, PHRASES.length) }, (_, i) => PHRASES[(start + i) % PHRASES.length]);
  return { cursor: (start + picked.length) % PHRASES.length,
    requests: picked.map((q) => request({ id: `yt-results-${q.replace(/ /g, '-')}`, source: 'youtube-results', kind: 'yt-results', args: { q },
      url: `${RESULTS}?search_query=${encodeURIComponent(q).replace(/%20/g, '+')}&sp=${TODAY_BY_VIEWS}&hl=en&gl=US`, file: 'yt-results.html', tier: 3 })) };
}

const textOf = (x) => (x && typeof x.simpleText === 'string' ? x.simpleText : x && Array.isArray(x.runs) ? x.runs.map((r) => r.text || '').join('') : '');
/** Every `videoRenderer` in the page's data, wherever it sits. */
function renderers(node, out = []) {
  if (!node || typeof node !== 'object' || out.length >= VIDEOS_MAX) return out;
  if (node.videoRenderer && node.videoRenderer.videoId) out.push(node.videoRenderer);
  else for (const v of Array.isArray(node) ? node : Object.values(node)) renderers(v, out);
  return out;
}

/**
 * The page as [{ id, title, channel, channelId, views, age ("19h ago") }], the page's own order; null when it is not a results
 * page (a consent page, an "unusual traffic" page: neither carries the data).
 */
function parse(html) {
  const m = String(html || '').match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  let data = null;
  try { data = JSON.parse(m[1]); } catch { return null; }
  const videos = renderers(data).map((v) => {
    const owner = (v.ownerText && v.ownerText.runs && v.ownerText.runs[0]) || {};
    return { id: String(v.videoId), title: textOf(v.title).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX), channel: owner.text || null,
      channelId: (owner.navigationEndpoint && owner.navigationEndpoint.browseEndpoint && owner.navigationEndpoint.browseEndpoint.browseId) || null,
      views: countOf(textOf(v.viewCountText)), age: textOf(v.publishedTimeText) || null };
  }).filter((v) => /^[\w-]{11}$/.test(v.id) && v.title);
  return videos.length ? videos : null;
}

module.exports = { PHRASES, PER_CYCLE, requests, parse };
