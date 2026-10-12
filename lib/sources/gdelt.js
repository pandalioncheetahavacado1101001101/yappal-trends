'use strict';
/*
 * GDELT's table of contents of the web's news, a file every quarter hour (ios/IDEAS-FEED.md M5): every article it crawled in that
 * slot as { date, lang, title, url }, about fifteen hundred a file, a quarter of them English. A public bucket, keyless, one small
 * gzipped file a cycle (about 200 KB), named by the clock: the slots are minutes 01, 16, 31 and 46.
 *
 * It is measured press volume: the complete list of what was published in a slot, where a search shows a hundred results. Only the
 * titles that name someone the list already holds are kept: each joins the engine's store as a headline with its own time and its
 * outlet's address, exactly as a sitemap's rows do, and the count of them per slot is kept as a curve. It sees the mainstream
 * press and next to nothing of the creators' beat, so it measures a story's breakout, never its beginning.
 */
const { request } = require('./fixed');
const { OUTLET_BY_DOMAIN } = require('../outlets');
const { keyOf } = require('../util');

const BASE = 'https://storage.googleapis.com/data.gdeltproject.org/gdeltv5/weblegacy/ngrams';
const SLOT = 900;
const SLOT_MINUTE = 60;
// (a slot's file is there a few minutes into the next one: the newest slot at least eight minutes old is asked)
const READY_AFTER = 8 * 60;
const TITLE_MAX = 220;
const NAME_WORDS_MIN = 2;
const pad = (n) => String(n).padStart(2, '0');

/** The newest slot whose file should be out at `now` (epoch seconds): a time at minute 01, 16, 31 or 46. */
const slotDue = (now) => Math.floor((now - READY_AFTER - SLOT_MINUTE) / SLOT) * SLOT + SLOT_MINUTE;
/** One slot's file, unless that slot was read. lastSlot: the slot read last (epoch seconds) or undefined. */
function tocRequest(now, lastSlot) {
  const slot = slotDue(now);
  if (Number.isFinite(lastSlot) && lastSlot >= slot) return null;
  const d = new Date(slot * 1000);
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
  return request({ id: 'gdelt-toc', source: 'gdelt', kind: 'gdelt', args: { slot }, url: `${BASE}/${stamp}.toc.json.gz`, file: 'gdelt-toc.jsonl', tier: 2, gzip: true });
}

/** An address's host without "www.": what an article's outlet is known by here. */
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
/** A title without the outlet a page hangs on it ("... – NBC4 Washington", "... | The Guardian"). */
const headline = (title) => String(title || '').replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);

/**
 * A file's English articles as [{ t (ms), title, url, host }], one a title; null when the text is not that file (no line of it
 * parses). text: the file gunzipped, a JSON object a line.
 */
function parse(text) {
  const out = [];
  const seen = new Set();
  let any = false;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let j = null;
    try { j = JSON.parse(line); } catch { continue; }
    if (!j || typeof j.title !== 'string' || typeof j.url !== 'string') continue;
    any = true;
    const t = Date.parse(j.date);
    const host = hostOf(j.url);
    const title = headline(j.title);
    const key = keyOf(title);
    if (!/^en/i.test(String(j.lang || '')) || !Number.isFinite(t) || !host || title.split(' ').length < 4 || seen.has(key)) continue;
    seen.add(key);
    out.push({ t, title, url: j.url, host });
  }
  return any ? out : null;
}

/**
 * The articles that name someone the list holds: Map(name key -> [article]). names: the normalised keys of the list's subjects;
 * only a name of two words or more is matched (one word is anybody's), as whole words of the title.
 */
function namedIn(articles, names) {
  const wanted = [...new Set(names)].filter((k) => k && k.split(' ').length >= NAME_WORDS_MIN);
  const out = new Map();
  for (const a of articles) {
    const hay = ` ${keyOf(a.title)} `;
    for (const name of wanted) if (hay.includes(` ${name} `)) out.set(name, [...(out.get(name) || []), a]);
  }
  return out;
}

// a country's second-level names: "bbc.co.uk" is the site, not "co.uk"
const SECOND_LEVEL = /\.(?:co|com|org|net|gov|ac|edu)\.[a-z]{2}$/;
/** A host's own site: its last two labels, or three under a country's second-level name ("943wsc.iheart.com" is "iheart.com"). */
const siteOf = (host) => String(host || '').split('.').slice(SECOND_LEVEL.test(host) ? -3 : -2).join('.');
/**
 * An article's outlet: the name it goes by where that is known (so one outlet is one outlet, whichever feed carried the headline),
 * else its site's address. A chain's hundred local pages are one outlet: a wire story they all reprint is told once.
 */
const outletOf = (host) => OUTLET_BY_DOMAIN[host] || OUTLET_BY_DOMAIN[siteOf(host)] || siteOf(host);
/**
 * An article as a row of the engine's store: a headline with its own time and its outlet, for the talking points only. Its key is
 * its outlet and its title, so the same headline on a chain's other pages, or in a later slot, is the same row.
 */
const rowOf = (a) => { const outlet = outletOf(a.host); return { key: `gdelt|${outlet}|${keyOf(a.title)}`, title: a.title, url: a.url, t: a.t, publisher: outlet, src: 'gdelt', fam: 'gnews', label: outlet, w: 0.6, talkOnly: true }; };

module.exports = { SLOT, slotDue, tocRequest, parse, namedIn, rowOf, hostOf, siteOf, outletOf, headline };
