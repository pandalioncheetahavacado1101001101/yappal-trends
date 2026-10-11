'use strict';
/*
 * Tier 3, slow and owed (ios/IDEAS-FEED.md A4): Reddit's one request a cycle, the lookups the engine's last build still wants (story
 * and word lookups, Know Your Meme entry pages and roundups, the most-read discovery searches), and the daily, weekly and three-day
 * pages (Wikipedia's top 1000 and most-read, the creators' roster, the month's crazes). Each builder gives requests in the order they
 * should be spent; the budget decides how many go this cycle, and what does not fit is simply owed again by the next build.
 */
const S = require('../../engine/sources');
const TS = require('../../engine/talk-sources');
const { request } = require('./fixed');
const { DAY } = require('../util');

const REDDIT = {
  'creators-day': { url: TS.TALK_REDDIT_TODAY.url, file: 'tp-reddit-today.rss' },
  'creators-week': { url: 'https://www.reddit.com/r/LivestreamFail+youtubedrama/top/.rss?t=week&limit=100', file: 'tp-reddit-streamers.rss' },
  'ootl-week': { url: 'https://www.reddit.com/r/OutOfTheLoop/top/.rss?t=week&limit=50', file: 'tp-reddit-ootl.rss' },
  'multi-day': { url: `https://www.reddit.com/r/${S.REDDIT_MULTI}/top/.rss?t=day&limit=50`, file: 'reddit-multi4-top-day.rss' },
  'popular-day': { url: 'https://www.reddit.com/r/popular/top/.rss?t=day&limit=50', file: 'reddit-popular-top-day.rss' },
  // (where influencers', TikTokers' and beauty creators' drama is argued: small boards, read for names and corroboration only)
  'snark-day': { url: TS.TALK_REDDIT_SNARK.url, file: TS.TALK_REDDIT_SNARK.file },
};
/** Reddit's one request of this cycle (lib/budget.js redditTurn). */
const redditRequest = (turn) => request({ id: `reddit-${turn}`, source: 'reddit', kind: 'reddit', args: { turn }, url: REDDIT[turn].url, file: REDDIT[turn].file, tier: 3 });

const WIKI_DAYS = 16; // the most-read feeds the engine reads: the window and two days
const WIKI_TOP_DAYS = 10;
const ymd = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** The Wikipedia daily lists not saved yet, the newest day first: most-read feeds (a past day's never changes) and the top-1000 lists. */
function wikiDailyRequests(nowSeconds, have) {
  const out = [];
  for (let back = 0; back <= WIKI_DAYS; back++) {
    const day = ymd(nowSeconds - back * DAY);
    const file = `wiki-featured-feed-${day}.json`;
    // (today's feed is asked again until tomorrow: it carries yesterday's most-read, which is whole only once a day)
    if (!have.has(file)) out.push(request({ id: file.replace(/\.json$/, ''), source: 'wikipedia', kind: 'wiki-file', args: { check: 'featured', day }, url: S.wikiUrl(day), file, tier: 3, toWiki: true }));
  }
  for (let back = 1; back <= WIKI_TOP_DAYS; back++) {
    const day = ymd(Date.parse(`${ymd(nowSeconds)}T00:00:00Z`) / 1000 - back * DAY);
    const file = `wiki-top-${day}.json`;
    if (!have.has(file)) out.push(request({ id: file.replace(/\.json$/, ''), source: 'wikipedia', kind: 'wiki-file', args: { check: 'top', day }, url: TS.wikiTopUrl(day), file, tier: 3, toWiki: true }));
  }
  // (the two lists in turn, the newest days of each first: yesterday's lists matter most)
  const featured = out.filter((r) => r.args.check === 'featured');
  const top = out.filter((r) => r.args.check === 'top');
  return Array.from({ length: Math.max(featured.length, top.length) }, (_, i) => [featured[i], top[i]]).flat().filter(Boolean);
}

const ROSTER_REFRESH_DAYS = 7;
/** The creators' roster pages older than a week (or never read): one page a cycle. savedAt: Map(file -> epoch seconds). */
function rosterRequests(nowSeconds, savedAt) {
  const out = [];
  for (const spec of TS.ROSTER_CATS) {
    for (let page = 0; page < spec.pages; page++) {
      const file = `wiki-roster-${spec.id}-${page * 500}.json`;
      const at = savedAt.get(file);
      if (Number.isFinite(at) && nowSeconds - at < ROSTER_REFRESH_DAYS * DAY) continue;
      out.push(request({ id: file.replace(/\.json$/, ''), source: 'wikipedia', kind: 'wiki-file', args: { check: 'roster' }, url: TS.rosterUrl(spec.cat, page * 500), file, tier: 3, toWiki: true }));
    }
  }
  return out;
}

const CRAZE_REFRESH_DAYS = 3;
/** This month's crazes page when the saved copy is three days old or missing, and last month's once. */
function crazeRequests(nowSeconds, savedAt) {
  const d = new Date(nowSeconds * 1000);
  const months = [[d.getUTCFullYear(), d.getUTCMonth()], d.getUTCMonth() === 0 ? [d.getUTCFullYear() - 1, 11] : [d.getUTCFullYear(), d.getUTCMonth() - 1]];
  const out = [];
  months.forEach(([y, m], i) => {
    const file = `tp-crazes-${y}-${String(m + 1).padStart(2, '0')}.html`;
    const at = savedAt.get(file);
    if (Number.isFinite(at) && (i > 0 || nowSeconds - at < CRAZE_REFRESH_DAYS * DAY)) return;
    out.push(request({ id: file.replace(/\.html$/, ''), source: 'crazes', kind: 'wiki-file', args: { check: 'crazes', year: y, month: m }, url: TS.crazeUrl(m), file, tier: 3, toWiki: true }));
  });
  return out;
}

/**
 * The engine's owed lookups as requests, by kind: { story (Google News story searches, then Wikipedia searches), words (a Wikipedia
 * batch, Wiktionary senses, origin searches), kym (entry pages, one slug each with the next as its fallback), roundups, discover }.
 * owed: engine/build.js `owed`.
 */
function owedRequests(owed) {
  const key = (k) => String(k).replace(/[^a-z0-9-]/gi, '').slice(0, 80);
  const story = [
    ...(owed.storyNews || []).map((t) => request({ id: `gn-story-${key(t.key.slice(6))}`, source: 'gnews', kind: 'story-news', args: { key: t.key, query: t.query }, url: S.storyNewsUrl(t.query), file: `gn-story-${key(t.key.slice(6))}.xml`, tier: 3 })),
    ...(owed.storyWiki || []).map((t) => request({ id: `wm-story-${key(t.key.slice(6))}`, source: 'wikipedia', kind: 'story-wiki', args: { key: t.key, query: t.query }, url: S.wikiSearchUrl(t.query), file: `wm-story-${key(t.key.slice(6))}.json`, tier: 3 })),
  ];
  // a number used as slang has its page under the hyphenated form ("67" -> "6-7")
  const pairs = (owed.words || []).filter((t) => t.wantWiki).flatMap((t) => [[t.key, S.wmTitle(t.term)], ...(/^\d{2,3}$/.test(t.term) ? [[t.key, t.term.split('').join('-')]] : [])]);
  const batches = [];
  for (let b = 0; b * S.WIKI_BATCH < pairs.length; b++) batches.push(pairs.slice(b * S.WIKI_BATCH, (b + 1) * S.WIKI_BATCH));
  const words = [
    ...batches.map((batch, b) => request({ id: `wm-wiki-${b}`, source: 'wikipedia', kind: 'word-wiki', args: { pairs: batch }, url: S.wikiBatchUrl(batch.map((p) => p[1])), file: `wm-wiki-${b}.json`, tier: 3 })),
    ...(owed.since || []).map((t) => request({ id: `gn-since-${key(t.key)}`, source: 'gnews', kind: 'word-since', args: { key: t.key, term: t.term }, url: S.sinceUrl(t.term), file: `gn-since-${key(t.key)}.xml`, tier: 3 })),
    ...(owed.words || []).filter((t) => t.wantWikt).map((t) => request({ id: `wm-wikt-${key(t.key)}`, source: 'wikipedia', kind: 'word-wikt', args: { key: t.key, term: t.term }, url: S.wiktionaryUrl(t.term), file: `wm-wikt-${key(t.key)}.json`, tier: 3 })),
  ];
  const left = { known: (owed.kym && owed.kym.known) || 0, guess: (owed.kym && owed.kym.guess) || 0 };
  const kym = [];
  for (const t of (owed.kym && owed.kym.targets) || []) {
    const slugs = t.slugs.filter((x) => (x.known ? left.known : left.guess) > 0);
    if (!slugs.length) continue;
    if (slugs[0].known) left.known -= 1; else left.guess -= 1;
    const [first, ...rest] = slugs;
    kym.push(request({ id: `kym-page-${key(t.key)}`, source: 'kym', kind: 'kym-page', args: { key: t.key, term: t.term, slug: first.slug, known: first.known }, url: S.kymPageUrl(first.slug), file: `kym-page-${key(t.key)}.html`, tier: 3,
      // (a term's next slug only after a 404)
      fallbacks: rest.map((x) => ({ url: S.kymPageUrl(x.slug), args: { key: t.key, term: t.term, slug: x.slug, known: x.known } })) }));
  }
  const roundups = (owed.roundups || []).map((t) => request({ id: `kym-roundup-${key(t.slug)}`, source: 'kym', kind: 'kym-roundup', args: { key: t.key, slug: t.slug }, url: S.kymEditorialUrl(t.slug), file: `kym-roundup-${key(t.slug)}.html`.slice(0, 200), tier: 3 }));
  const discover = (owed.wikiDiscover || []).map((w) => request({ id: `gn-wiki-${key(w.key.replace(/[^a-z0-9]/g, ''))}`, source: 'gnews', kind: 'feed', args: { spec: S.WIKI_DISCOVER.id }, url: S.wikiDiscoverUrl(w.name), file: `gn-wiki-${key(w.key.replace(/[^a-z0-9]/g, ''))}.xml`, tier: 3 }));
  return { story, words, kym, roundups, discover };
}

module.exports = { redditRequest, wikiDailyRequests, rosterRequests, crazeRequests, owedRequests, WIKI_DAYS, WIKI_TOP_DAYS };
