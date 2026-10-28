'use strict';
/*
 * Sources for the Ideas list: what the phone fetches on each daily refresh, and how each raw response becomes rows for the
 * rolling 14-day store. The prototype saves every raw response under ideas-raw/live-<local date>/. snapshotFiles() finds
 * earlier saved responses of the same source (root-level probe files and older live-* folders) for the first-run backfill.
 */
const fs = require('fs');
const path = require('path');
const { RE } = require('./rules');

const DAY = 86400000;
const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const UA_WIKI = 'MyVideoPal-Ideas/0.2 (personal iOS app prototype)';
// Know Your Meme entry pages (robots.txt allows /memes/; it disallows /search, /users, /comments and similar): identified, a few a day
const UA_KYM = 'MyVideoPal-Ideas/0.3 (personal iOS app prototype; reads a meme entry page when no feed defines a new term)';
const TRENDS_URL = 'https://trends.google.com/_/TrendsUi/data/batchexecute';
const TRENDS_GEOS = [{ geo: 'US', w: 1.0 }, { geo: 'GB', w: 0.8 }, { geo: 'AU', w: 0.8 }];
const TRENDS_POP_CATEGORIES = new Set([2, 4, 6, 8]); // Beauty & Fashion, Entertainment, Games, Hobbies
// Sports and Other trends are search signals only ("mirey voraby" 200k the day his daughter walked out); they never become items.
// Law & Government (10) is a signal too: a death or a court case people are searching ("rouade trevick") stands behind a sensitive story.
const TRENDS_SIGNAL_CATEGORIES = new Set([...TRENDS_POP_CATEGORIES, 10, 11, 17]);
const TRENDS_RESOLVE_MAX = 40;
const BSKY_CATEGORIES = new Set(['culture', 'entertainment', 'other']);
// A sports trend is kept only when it is a moment ("Hollinrel Yarrurn flagged for taunting"), never a result.
const bskySportsMoment = (t) => t.category === 'sports' && !RE.sportsDry.test(t.displayName) && [RE.moment, RE.viral, RE.sportsMoment].some((re) => re.test(`${t.displayName} ${t.description || ''}`));
// the whole About text: the definition opens it, the dating sentence ("first started going viral as early as December 2024") is
// usually in its second paragraph
const KYM_DESC_MAX = 2000;
const DEK_MAX = 400; // an outlet's summary line: its first sentence is the meaning material
// r/popular cannot join a multireddit, so it is a second request, at least 61 s after the first (Reddit: ~1 RSS req/min).
// (r/Fauxmoi is where celebrity stories break first: "Pellia Sorrenko checks on a 'sad' staffer"; one request still covers all five)
const REDDIT_MULTI = 'popculturechat+Fauxmoi+entertainment+OutOfTheLoop+TikTokCringe';
const REDDIT_GAP_MS = 61000;

// ---------- small helpers ----------
const safeJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
const ymdUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Device-local calendar day, "YYYY-MM-DD" (Calendar.current on the phone). */
function ymdLocal(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Local midnight of the day `ms` falls in, shifted by `days` calendar days (DST-safe). */
function localMidnight(ms, days = 0) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decode(s) {
  const once = (x) => x.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return XML_ENT[e.toLowerCase()] ?? m;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
  return once(once(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))).replace(/\s+/g, ' ').trim();
}
function xmlTag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}
function xmlAttr(block, name, attr) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*?${attr}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
}
/** RSS 2.0 and Atom in one pass. */
function parseFeed(xml) {
  const blocks = (xml || '').match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => ({
    title: xmlTag(b, 'title'),
    url: xmlTag(b, 'link') || xmlAttr(b, 'link', 'href'),
    t: Date.parse(xmlTag(b, 'pubDate') || xmlTag(b, 'dc:date') || xmlTag(b, 'published') || xmlTag(b, 'updated')),
    publisher: xmlTag(b, 'source'),
    publisherUrl: xmlAttr(b, 'source', 'url'),
    sub: xmlAttr(b, 'category', 'term'),
    desc: xmlTag(b, 'description'),
  })).filter((x) => x.title && Number.isFinite(x.t));
}
/** RSS descriptions are escaped HTML: tags out, first paragraph only. */
function plainText(html) {
  const firstPara = (html || '').split(/<\/p>/i)[0];
  return firstPara.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DEK_MAX);
}
/** A Know Your Meme description: every paragraph (the first defines the entry, a later one says when it went viral), no "Read More". */
function kymText(html) {
  return (html || '').split(/<\/p>/i).map((p) => p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^read more$/i.test(p)).join(' ').slice(0, KYM_DESC_MAX);
}

// ---------- source registry ----------
const gnSearch = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
const gnEnt = (gl) => `https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-${gl}&gl=${gl}&ceid=${gl}:en`;

// Google News searches; {w} is "when:Nd" on a warm store, or the 7-day + 8-14-day pair on a cold (first-run) store.
const GN_QUERIES = [
  { id: 'gn-goes-viral', q: '"goes viral" {w}', w: 1.0, files: /^(gnews-rss-search-goes-viral-.+|gn-goes-viral(-.+)?)\.xml$/ },
  { id: 'gn-viral', q: 'viral -coin -crypto {w}', w: 0.9, files: /^(gnews-rss-search-viral-14d-US|gn-viral-(\d+d|8-14d|14d))\.xml$/ },
  { id: 'gn-meme', q: 'meme -coin -coins -crypto -token -presale -stocks {w}', w: 1.0, files: /^(gnews-rss-search-meme-7d-US|gn-meme-.+)\.xml$/ },
  { id: 'gn-clip', q: '"viral clip" OR "viral video" OR "instant meme" {w}', w: 1.0, files: /^gn-clip-.+\.xml$/ },
  { id: 'gn-reacts', q: '"internet reacts" OR "the internet is" {w}', w: 0.9, files: /^(gnews-rss-search-internet-reacts-14d-US|gn-reacts-.+)\.xml$/ },
  { id: 'gn-tiktok', q: 'tiktok trend OR "viral on tiktok" {w}', w: 1.0, files: /^(gnews-rss-search-tiktok-trend-7d-US|gn-tiktok-.+)\.xml$/ },
  // Collector only (decision 9: product crazes): what sold out or was copied because it went viral ("Viral US air fryer that sold
  // out in 8 days", "Walmart dupes $620 jeans"); the moments' own gates decide what of it is a story
  { id: 'gn-product', q: '(viral OR tiktok) ("sold out" OR "selling out" OR "sells out" OR dupe OR "everyone is buying") -stock -shares {w}', w: 0.8, files: /^gn-product-.+\.xml$/ },
];
const GN_SECTIONS = ['US', 'GB', 'AU'].map((gl) => ({ id: `gn-ent-${gl}`, gl, w: gl === 'US' ? 0.6 : 0.5,
  files: new RegExp(`^(gnews-rss-ENTERTAINMENT-${gl}|gn-ent-${gl})\\.xml$`) }));
const CELEB = [
  { id: 'tmz', label: 'TMZ', url: 'https://www.tmz.com/rss.xml', files: /^(tmz_rss(_page2)?|tmz)\.xml$/ },
  { id: 'eonline', label: 'E! News', url: 'https://www.eonline.com/syndication/feeds/rssfeeds/topstories.xml', files: /^(eonline_rss|eonline)\.xml$/ },
  { id: 'dexerto', label: 'Dexerto', url: 'https://www.dexerto.com/feed/', files: /^(dexerto_rss(_paged5)?|dexerto)\.xml$/ },
  { id: 'usweekly', label: 'Us Weekly', url: 'https://www.usmagazine.com/feed/', files: /^(usweekly_rss|usweekly)\.xml$/ },
  { id: 'justjared', label: 'Just Jared', url: 'https://www.justjared.com/feed/', files: /^(justjared_rss(_paged10)?|justjared)\.xml$/ },
  { id: 'perez', label: 'Perez Hilton', url: 'https://perezhilton.com/feed/', files: /^(perezhilton_rss|perez)\.xml$/ },
  // Collector only. Dexerto's entertainment desk, fifty stories deep (its main feed is mostly games: a creator's story of two days
  // ago has left it), and an Australian pop-culture desk (the AU audience's own influencers and reality casts)
  { id: 'dexerto-ent', label: 'Dexerto', url: 'https://www.dexerto.com/entertainment/feed/', files: /^dexerto-ent\.xml$/ },
  { id: 'pedestrian', label: 'Pedestrian.TV', url: 'https://www.pedestrian.tv/feed/', files: /^pedestrian\.xml$/ },
];
// KYM newsroom and confirmed memes list only memes (inherent); submissions are unvetted, so they only corroborate.
const KYM = [
  { id: 'kym-news', url: 'https://knowyourmeme.com/newsfeed.rss', w: 2.0, inherent: true, files: /^(kym_newsroom_rss|kym-news)\.xml$/ },
  { id: 'kym-memes', url: 'https://knowyourmeme.com/memes.rss', w: 1.5, inherent: true, files: /^(kym_memes_rss|kym-memes)\.xml$/ },
  { id: 'kym-subs', url: 'https://knowyourmeme.com/memes/submissions.rss', w: 0.6, inherent: false, files: /^(kym_memes_submissions_rss(_p2)?|kym-subs)\.xml$/ },
];
// "Words & trends" searches: slang explainers ("What does 'mogging' mean on TikTok?"), slang roundups ("From '67' to 'aura'") and
// trend/meme explainers (Know Your Meme's own, syndicated on Yahoo). Words only: they never feed the moments list.
const GN_WORD_QUERIES = [
  { id: 'gn-w-mean', q: '"what does" mean (tiktok OR slang OR meme OR trend) {w}', w: 1.0 },
  { id: 'gn-w-slang', q: '(slang OR "slang term" OR "slang word") (tiktok OR "gen z" OR "gen alpha" OR teens OR kids OR viral) {w}', w: 0.9 },
  { id: 'gn-w-explained', q: '(trend OR meme OR challenge OR slang) explained -coin -crypto -stock {w}', w: 1.0 },
  { id: 'gn-w-whatis', q: '"what is the" (trend OR challenge OR meme) tiktok {w}', w: 1.0 },
  // Know Your Meme's weekly roundup ("Weekly Meme Roundup: Bexena Tamaby Lyrics, Glibly GTA, Quorey Brannard And More"), on Yahoo:
  // its own list of the week's memes. A separate search (not an OR on gn-w-explained) so a new store backfills its 14 days.
  { id: 'gn-w-roundup', q: '"weekly meme roundup" {w}', w: 1.0 },
  // Collector only (decision 9): formats and challenges as outlets explain them ("What to know about the viral 'Cat in the Hat'
  // trend", "What are BORGs? The college drinking trend taking over TikTok"), and AI trends and filters by name
  { id: 'gn-w-format', q: '(tiktok OR instagram OR reels) (challenge OR trend) ("taking over" OR "everyone is" OR "how to do" OR "what is the") {w}', w: 1.0 },
  { id: 'gn-w-ai', q: '"AI trend" OR "AI filter" OR "AI challenge" OR "AI prank" OR "ChatGPT trend" OR "Sora trend" OR "Gemini trend" {w}', w: 1.0 },
].map((g) => ({ ...g, wordsOnly: true, files: new RegExp(`^${g.id}-.+\\.xml$`) }));
// Hacker News stories that reached the front page (Algolia's public search API, keyless and meant for reading): a words-only,
// low-weight second family. It caught "'That's so AI!' What gen Alpha's biggest insult tells us" the week the Guardian ran it.
const HN_MIN_POINTS = 100;
const HN_FILES = /^hn-stories(?:-[\w-]+)?\.json$/;
const hnUrl = (sinceMs) => 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=1000' +
  `&numericFilters=${encodeURIComponent(`created_at_i>${Math.floor(sinceMs / 1000)},points>=${HN_MIN_POINTS}`)}`;
function hnRows(text) {
  return (safeJson(text)?.hits || []).filter((h) => h.title && Number.isFinite(h.created_at_i)).map((h) => ({
    key: `hn:${h.objectID}`, title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, t: h.created_at_i * 1000,
    src: 'hn', fam: 'hn', label: 'Hacker News', w: 0.6, wordsOnly: true, points: h.points || 0,
  }));
}
const REDDIT_FILES = /^(reddit-.+\.rss)$/;
const BSKY_FILES = /^bluesky-getTrends\.json$/;
const WIKI_FILES = /^wiki-featured-feed-(\d{4}-\d\d-\d\d)\.json$/;

// Wikipedia most-read discovery: a film, show or person article read 80K+ times on a day at 3x its usual views that nothing in the
// store names yet ("Monster: The Tavena Osturn Story", "Quavrrb") gets one Google News search for its title over three days, and
// its rows join the store like any feed's. Saved as gn-wiki-<key>.xml.
const WIKI_DISCOVER = { id: 'gn-wiki', w: 0.8, dynamic: true, files: /^gn-wiki-[a-z0-9]+\.xml$/ };
const WIKI_DISCOVER_VIEWS = 80000;
const WIKI_DISCOVER_SPIKE = 3;
const WIKI_DISCOVER_MAX = 6;
const WIKI_DISCOVER_DAYS = 3;
const WIKI_DISCOVER_DESC = /\b(film|television|tv series|miniseries|docuseries|documentary|web series|series|singer|actor|actress|rapper|comedian|musician|influencer|streamer|youtuber|tiktoker|personality|presenter|host|murderer|serial killer|criminal|terrorist|bomber|convicted|suspect|victim|case|trial|killing|murders?|death of)\b/i;
const wikiDiscoverUrl = (name) => gnSearch(`"${name.replace(/["“”]/g, '')}" when:${WIKI_DISCOVER_DAYS}d`);
/** The most-read articles worth a discovery search: recent, big, spiking, a film/show/person, not a sports page, not yet in the store. */
function wikiDiscoverTargets(wiki, now, known) {
  const seen = new Set();
  return wiki.filter((w) => now - w.t <= WIKI_DISCOVER_DAYS * DAY && w.views >= WIKI_DISCOVER_VIEWS && w.spike >= WIKI_DISCOVER_SPIKE &&
    WIKI_DISCOVER_DESC.test(w.desc || '') && !/\b(football|basketball|baseball|soccer|hockey|cricket|tennis|golf|nfl|nba|mlb|nhl|wnba|athlete|player|coach|election|politician)\b/i.test(w.desc || '') &&
    w.key && !known(w.key))
    .sort((a, b) => b.views - a.views)
    .filter((w) => (seen.has(w.key) ? false : seen.add(w.key)))
    .slice(0, WIKI_DISCOVER_MAX);
}

/** Every feed-shaped source with the parse metadata its rows carry (the discovery search's files included; it is fetched on its own). */
function feedSpecs() {
  return [
    ...GN_QUERIES.map((g) => ({ ...g, fam: 'gnews', label: 'Google News' })),
    { ...WIKI_DISCOVER, fam: 'gnews', label: 'Google News' },
    ...GN_WORD_QUERIES.map((g) => ({ ...g, fam: 'gnews', label: 'Google News' })),
    ...GN_SECTIONS.map((g) => ({ ...g, fam: 'gnews', label: 'Google News', url: gnEnt(g.gl) })),
    ...CELEB.map((c) => ({ ...c, fam: 'celeb', w: 0.8 })),
    ...KYM.map((k) => ({ ...k, fam: 'kym', label: 'Know Your Meme' })),
  ];
}

/** Google News windows: the first run backfills 14 days, later runs cover the days since the last refresh (+1 overlap). */
function gnWindows(now, lastRefresh) {
  if (!lastRefresh) {
    const from = ymdUtc(now - 14 * DAY);
    const to = ymdUtc(now - 7 * DAY);
    return [{ tag: '7d', w: 'when:7d' }, { tag: '8-14d', w: `after:${from} before:${to}` }];
  }
  const n = Math.min(7, Math.max(2, Math.ceil((now - lastRefresh) / DAY) + 1));
  return [{ tag: `${n}d`, w: `when:${n}d` }];
}

// ---------- row builders (one raw response -> store rows) ----------
function feedRows(spec, xml) {
  return parseFeed(xml).map((x) => ({
    key: x.url || `${spec.id}|${x.title}`, title: x.title, url: x.url, t: x.t, publisher: x.publisher, publisherUrl: x.publisherUrl,
    src: spec.id, fam: spec.fam, label: spec.label, w: spec.w, inherent: !!spec.inherent,
    // KYM's description opens with what the meme is ("Barf Simmons ... is a series of memes ... based around ..."): headline material
    ...(spec.fam === 'kym' ? { kymDesc: kymText(x.desc) } : {}),
    // an outlet's own one-line summary ("The 'AI Shirtless Plumber' prank is a viral trend on TikTok that uses ..."): meaning material
    ...(spec.fam === 'celeb' && x.desc ? { dek: plainText(x.desc) } : {}),
    ...(spec.wordsOnly ? { wordsOnly: true } : {}),
  }));
}

/**
 * Reddit rows with rankDay: the item's rank among same-day posts of the same feed. For a top-of-week/month feed this equals its
 * daily rank, because every same-day post that outscored it is also in that feed.
 */
function redditRows(xml) {
  const items = parseFeed(xml);
  // r/popular's own feed: its top posts are viral whatever subreddit they come from
  const feedCat = ((xml || '').split(/<entry[\s>]/)[0].match(/<category term="([^"]+)"/) || [])[1] || '';
  const popular = feedCat.toLowerCase() === 'popular';
  const perDay = new Map();
  return items.map((x) => {
    const day = ymdLocal(x.t);
    const rankDay = perDay.get(day) || 0;
    perDay.set(day, rankDay + 1);
    const sub = (x.sub || '').toLowerCase();
    return { key: x.url, title: x.title, url: x.url, t: x.t, src: 'reddit', fam: 'reddit', label: 'Reddit', sub: popular ? 'popular' : sub, rankDay,
      w: 1.6 - Math.min(1, rankDay / 30) };
  });
}

function blueskyRows(text) {
  return (safeJson(text)?.trends || []).filter((t) => BSKY_CATEGORIES.has(t.category) || bskySportsMoment(t)).map((t) => ({
    key: `bsky:${t.topic || t.displayName}`, title: t.displayName, desc: t.description || '', t: Date.parse(t.startedAt),
    url: `https://bsky.app${t.link || ''}`, src: 'bluesky', fam: 'bluesky', label: 'Bluesky', category: t.category,
    w: 0.8 + Math.log10(Math.max(10, t.postCount || 10)) / 4, inherent: t.category === 'culture', status: t.status,
    postCount: t.postCount || 0,
  })).filter((r) => Number.isFinite(r.t));
}

// ---------- Google Trends ("Trending now", 7 days, pop-culture categories) ----------
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' };
const batchBody = (calls) => 'f.req=' + encodeURIComponent(JSON.stringify([calls]));
const trendsRequest = (geo) => ({ url: `${TRENDS_URL}?rpcids=i0OFE&source-path=%2Ftrending&hl=en-US&rt=c`,
  init: { method: 'POST', headers: FORM, body: batchBody([['i0OFE', JSON.stringify([null, null, geo, 0, 'en-US', 168, 1]), null, 'generic']]) } });

/** Google batchexecute replies are ")]}'" + length-prefixed JSON chunks; each wrb.fr entry is [_, rpc, payloadJson, _, _, _, tag]. */
function parseBatch(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    if (!line.startsWith('[["wrb.fr"')) continue;
    for (const e of safeJson(line) || []) if (e[0] === 'wrb.fr' && e[2]) out.push({ rpc: e[1], tag: e[6], data: safeJson(e[2]) });
  }
  return out;
}

function trendRows(text, geo, w) {
  const rows = parseBatch(text).find((r) => r.rpc === 'i0OFE')?.data?.[1] || [];
  return rows.filter((r) => (r[10] || []).some((c) => TRENDS_SIGNAL_CATEGORIES.has(c)) && r[3]).map((r) => ({
    key: `${geo}|${r[0]}|${r[3][0]}`, geo, geoW: w, keyword: r[0], start: r[3][0] * 1000, end: r[4] ? r[4][0] * 1000 : null,
    pop: (r[10] || []).some((c) => TRENDS_POP_CATEGORIES.has(c)),
    volume: r[6] || 0, related: (r[9] || []).slice(1, 6), news: (r[11] || [])[0] || null, headline: null,
  }));
}

/** The biggest trends' first news ids, batched into one w4opAf request; the tag of each call is its index. */
function trendNewsCalls(trends) {
  return trends.filter((t) => t.news && t.pop).sort((a, b) => b.volume - a.volume).slice(0, TRENDS_RESOLVE_MAX)
    .map((t, i) => ({ tag: String(i), id: t.news[0], call: ['w4opAf', JSON.stringify([[[t.news[0], t.news[1], t.news[2]]], 1]), null, String(i)] }));
}
const trendNewsRequest = (calls) => ({ url: `${TRENDS_URL}?rpcids=w4opAf&source-path=%2Ftrending&hl=en-US&rt=c`,
  init: { method: 'POST', headers: FORM, body: batchBody(calls.map((c) => c.call)) } });

/** Attaches resolved article titles to the trends whose news id was in the batch. */
function applyTrendNews(trends, text, idByTag) {
  const byId = new Map();
  for (const r of parseBatch(text)) {
    const a = r.data?.[0]?.[0];
    if (a && idByTag.has(r.tag)) byId.set(idByTag.get(r.tag), { title: a[0], url: a[1], publisher: a[2], t: a[3][0] * 1000 });
  }
  for (const t of trends) if (t.news && byId.has(t.news[0])) t.headline = byId.get(t.news[0]);
}

// ---------- Wikipedia most-read (signal only) ----------
/** The featured feed for day D carries most-read for D-1 (UTC), with a 5-day view history per article. */
function wikiRows(text, stripParen, words, median) {
  const mr = safeJson(text)?.mostread;
  if (!mr) return [];
  return (mr.articles || []).map((a) => {
    const hist = (a.view_history || []).map((h) => h.views);
    const base = median(hist.slice(0, -1)) || a.views;
    const name = stripParen(a.normalizedtitle || a.titles?.normalized);
    return { name, key: words(name).join(' '), desc: a.description || '', views: a.views, spike: a.views / Math.max(1, base),
      t: Date.parse(mr.date), rising: hist.length > 1 && hist[hist.length - 1] > hist[hist.length - 2] };
  });
}
const wikiUrl = (d) => `https://en.wikipedia.org/api/rest_v1/feed/featured/${d.replace(/-/g, '/')}`;

// ---------- Wikimedia lookups for "Words & trends" (a slang page's summary, its daily views, a coinage's dictionary sense) ----------
// Keyless REST endpoints meant for reuse (CC BY-SA text: the app credits Wikipedia / Wiktionary beside a meaning taken from them).
// Wikipedia: one Action API request answers 20 terms at once (lead sentences, short description, 30 days of views; redirects
// followed), with up to WIKI_BATCH_CONTINUE follow-ups for the views. Wiktionary: one REST request per coinage still lacking a meaning.
const WIKI_BATCH = 20;
const WIKI_BATCH_CONTINUE = 3;
const wmTitle = (term) => term.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());
const wikiBatchUrl = (titles, cont = null) => 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1' +
  '&prop=extracts%7Cdescription%7Cpageviews&exintro=1&explaintext=1&exsentences=2&exlimit=max&pvipdays=30' +
  `&titles=${encodeURIComponent(titles.join('|'))}${cont ? Object.entries(cont).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join('') : ''}`;
// the Action API's plain-text page keeps each sense's labels ("(slang, derogatory) An obese person ..."), which the REST one drops
const wiktionaryUrl = (term) => 'https://en.wiktionary.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts' +
  `&explaintext=1&titles=${encodeURIComponent(/^[A-Z0-9]{2,}$/.test(term.trim()) ? term.trim() : term.trim().toLowerCase())}`;
// saved as wm-wiki-<batch>-<part>.json with wm-wiki-<batch>.keys.json ([term key, title] pairs), and wm-wikt-<term key>.json
const WIKI_BATCH_FILES = /^wm-wiki-(\d+)\.keys\.json$/;
const WIKT_FILES = /^wm-wikt-([a-z0-9]+)\.json$/;

// ---------- "Words & trends" origin and meaning lookups ----------
// When a term began: one open-ended Google News RSS search (no when:) for the exact name; the headlines' dates reach back years.
const sinceUrl = (term) => gnSearch(`"${term.replace(/["“”]/g, '')}"`);
// A term's Know Your Meme entry page, read only for its og:description (the entry's opening definition).
const kymPageUrl = (slug) => `https://knowyourmeme.com/memes/${slug}`;
// Know Your Meme's weekly roundup editorial (robots.txt allows /editorials/; it redirects to trending.knowyourmeme.com, same rules)
const kymEditorialUrl = (slug) => `https://knowyourmeme.com/editorials/${slug}`;
// saved as gn-since-<term key>.xml (the searched name is in the feed's own link), and kym-page-<term key>-<n>.html with one
// lookups-<time>-kym.json per run: [{ key, part: 'kym', term, slug, status, file }]
const SINCE_FILES = /^gn-since-([a-z0-9]+)\.xml$/;
const LOOKUP_LOG_FILES = /^lookups-(\d+)(?:-[a-z]+)?\.json$/;
/** The name an origin search asked for, read back from the feed's channel link ("...search?q=%22Anti-Blush%22&hl=..." -> "Anti-Blush"). */
function sinceTermOf(xml) {
  const q = ((xml || '').match(/<channel>[\s\S]*?<link>[^<]*?[?&](?:amp;)?q=([^&<]+)/) || [])[1];
  if (!q) return null;
  try { return decodeURIComponent(q.replace(/\+/g, ' ')).replace(/^"|"$/g, '').trim() || null; } catch { return null; }
}

// ---------- story lookups (step 8: the story behind each listed moment) ----------
// A Google News RSS search for the story's main name over the 14-day window (the same keyless feed the daily searches use), and a
// Wikipedia search (keyless Action API: the top pages with their short description and opening sentences). Saved as
// gn-story-<key>.xml and wm-story-<key>.json ({ query, reply }), key = the query's letters and digits.
const storyNewsUrl = (q) => gnSearch(`${q} when:14d`);
const wikiSearchUrl = (q) => 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search' +
  `&gsrsearch=${encodeURIComponent(q)}&gsrlimit=6&prop=extracts%7Cdescription&exintro=1&explaintext=1&exsentences=2&exlimit=max`;
const STORY_GN_FILES = /^gn-story-([a-z0-9]+)\.xml$/;
const STORY_WIKI_FILES = /^wm-story-([a-z0-9]+)\.json$/;
/** A story search's rows, as the store keeps them. */
const storyRows = (xml) => parseFeed(xml).map((x) => ({ title: x.title, url: x.url, t: x.t, publisher: x.publisher, publisherUrl: x.publisherUrl }));

// ---------- saved snapshots (prototype backfill) ----------
/**
 * Saved raw responses: root-level probe files plus every live-* folder, oldest folder first. A day's second refresh saves its
 * feeds beside the first ("live-2026-09-28-1000"), so it never overwrites the first one's snapshots.
 */
function snapshotDirs(rawDir) {
  const lives = fs.readdirSync(rawDir).filter((d) => /^live-\d{4}-\d\d-\d\d(?:-\d{4})?$/.test(d)).sort();
  return [rawDir, ...lives.map((d) => path.join(rawDir, d))];
}
/** A feed snapshot a refresh saves (not a lookup answer): a feed, Reddit, Bluesky, Hacker News or Google Trends reply. */
const isFeedSnapshot = (name) => feedSpecs().some((s) => s.files.test(name)) || [REDDIT_FILES, BSKY_FILES, HN_FILES].some((re) => re.test(name)) ||
  /^trends-(?:i0OFE|w4opAf)-/.test(name);
function snapshotFiles(rawDir, re) {
  const out = [];
  for (const dir of snapshotDirs(rawDir)) {
    // name order, so a rebuild reads files in the same order on every file system
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f);
      if (re.test(f) && fs.statSync(p).isFile() && fs.statSync(p).size > 0) out.push({ dir, name: f, path: p, mtime: fs.statSync(p).mtimeMs });
    }
  }
  return out;
}

/** Trends snapshots per folder: the geo files, plus the w4opAf reply and the tag->news-id map that produced it. */
function trendSnapshots(rawDir) {
  const out = [];
  for (const dir of snapshotDirs(rawDir)) {
    const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null);
    const geoText = (geo) => read(`google-trends-batchexecute-i0OFE-${geo}-168.txt`) || read(`trends-i0OFE-${geo}-168h.txt`);
    const trends = TRENDS_GEOS.flatMap(({ geo, w }) => trendRows(geoText(geo), geo, w));
    if (!trends.length) continue;
    const idByTag = new Map();
    const probeReq = safeJson(read('freq-w4opAf-batch.txt') || '');
    const liveReq = safeJson(read('trends-w4opAf-request.json') || '');
    if (probeReq) for (const c of probeReq[0]) idByTag.set(c[3], JSON.parse(c[1])[0][0][0]);
    else if (liveReq) for (const [tag, id] of liveReq) idByTag.set(tag, id);
    else for (const c of trendNewsCalls(trends)) idByTag.set(c.tag, c.id); // same deterministic order as the live request
    const news = read('google-trends-batchexecute-w4opAf-ent12-US.txt') || read('trends-w4opAf-news.txt');
    if (news) applyTrendNews(trends, news, idByTag);
    const mtime = fs.statSync(path.join(dir, fs.readdirSync(dir).sort().find((f) => /i0OFE/.test(f)))).mtimeMs;
    out.push({ trends, mtime });
  }
  return out;
}

module.exports = {
  DAY, UA_BROWSER, UA_WIKI, UA_KYM, TRENDS_GEOS, REDDIT_MULTI, REDDIT_GAP_MS, REDDIT_FILES, BSKY_FILES, WIKI_FILES, WIKI_BATCH_FILES, WIKT_FILES,
  HN_FILES, hnUrl, hnRows, kymEditorialUrl,
  SINCE_FILES, LOOKUP_LOG_FILES, WIKI_BATCH, WIKI_BATCH_CONTINUE, wmTitle, wikiBatchUrl, wiktionaryUrl, sinceUrl, sinceTermOf, kymPageUrl, plainText,
  safeJson, ymdUtc, ymdLocal, localMidnight, parseFeed, gnSearch, feedSpecs, gnWindows, feedRows, redditRows, blueskyRows,
  trendsRequest, trendRows, trendNewsCalls, trendNewsRequest, applyTrendNews, wikiRows, wikiUrl, snapshotDirs, snapshotFiles, isFeedSnapshot,
  trendSnapshots, storyNewsUrl, wikiSearchUrl, STORY_GN_FILES, STORY_WIKI_FILES, storyRows, wikiDiscoverTargets, wikiDiscoverUrl, WIKI_DISCOVER,
};
