#!/usr/bin/env node
'use strict';
/*
 * One polite question to each candidate source, from wherever this runs. On GitHub's servers that is the collector's own host: a
 * source that answers a home address may refuse a datacenter, and this is how to find out before an adapter is written.
 *
 * Plain Node, no dependencies. One GET per source, one at a time, a second apart (five seconds before the same host is asked again),
 * 15 seconds each at most, with the collector's own honest user agent. Recorded per source: name, HTTP status, bytes, content type,
 * milliseconds and ONE structural check ("items parsed: 15"). Never the content itself.
 *
 * Usage: node probe.js [--out <dir>]   (default: probe-out). Writes results.json and results.md there. A source that refuses is a
 * finding, not a failure: the exit code is 0 unless the probe itself broke.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TIMEOUT_MS = 15_000;
const GAP_MS = 1_000;
const SAME_HOST_GAP_MS = 5_000;
const DEFAULT_OUT = 'probe-out';
// GDELT writes a file at these minutes of the hour; the newest is asked for only once it is this old
const GDELT_SLOTS = [46, 31, 16, 1];
const GDELT_LAG_MS = 8 * 60_000;
// an hour's page-view file appears about two hours later: the month's folder is the one that hour belongs to
const DUMPS_LAG_MS = 3 * 3_600_000;
const HOUR_MS = 3_600_000;

// ---------- reading a reply (counts and yes/no only) ----------
const count = (text, re) => (text.match(re) || []).length;
const distinct = (text, re) => new Set(text.match(re) || []).size;
const listOf = (value) => (Array.isArray(value) ? value : []);
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
const stripTags = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
const found = (n, label) => ({ ok: n > 0, check: `${label}: ${n}` });
const has = (yes, label) => ({ ok: yes, check: `${label}: ${yes ? 'yes' : 'no'}` });
const both = (n, label, m, second) => ({ ok: n > 0 && m > 0, check: `${label}: ${n}, ${second}: ${m}` });

const rssItems = (text) => found(count(text, /<item[\s>]/g), 'items parsed');
const sitemapUrls = (text) => found(count(text, /<url>/g), 'urls parsed');
const completions = (text) => found(listOf(listOf(parse(text))[1]).length, 'completions');
const nextData = (html) => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); return m ? parse(m[1]) : null; };

/** The longest schema.org ItemList in a page's JSON-LD blocks: 0 when there is none. */
function longestItemList(html) {
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => parse(m[1])).filter(Boolean);
  const nodes = blocks.flatMap((b) => (Array.isArray(b) ? b : b['@graph'] || [b]));
  return Math.max(0, ...nodes.filter((n) => n && n['@type'] === 'ItemList').map((n) => listOf(n.itemListElement).length));
}

/** The newest hourly page-view file a folder listing names, as { files, ageHours }. */
function dumpFiles(html, now) {
  const stamps = [...new Set([...html.matchAll(/pageviews-(\d{4})(\d{2})(\d{2})-(\d{2})0000\.gz/g)].map((m) => Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4])))];
  const newest = Math.max(0, ...stamps);
  return { files: stamps.length, ageHours: stamps.length ? Math.round((now - newest) / HOUR_MS) : null };
}

// ---------- addresses that depend on the clock ----------
const two = (n) => String(n).padStart(2, '0');

/** GDELT's newest table-of-contents file that should exist by now. */
function gdeltUrl(now) {
  const t = new Date(now.getTime() - GDELT_LAG_MS);
  const slot = GDELT_SLOTS.find((m) => m <= t.getUTCMinutes());
  const at = slot === undefined
    ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours() - 1, GDELT_SLOTS[0]))
    : new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours(), slot));
  const stamp = `${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}${two(at.getUTCHours())}${two(at.getUTCMinutes())}00`;
  return `https://storage.googleapis.com/data.gdeltproject.org/gdeltv5/weblegacy/ngrams/${stamp}.toc.json.gz`;
}
function dumpsUrl(now) {
  const t = new Date(now.getTime() - DUMPS_LAG_MS);
  return `https://dumps.wikimedia.org/other/pageviews/${t.getUTCFullYear()}/${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}/`;
}
const pinterestUrl = (now) => `https://trends.pinterest.com/top_trends_filtered/?endDate=${now.toISOString().slice(0, 10)}&country=US&trendsPreset=3&normalizeAgainstGroup=None&lookbackWindow=1&numTermsToReturn=50`;

// ---------- the sources ----------
// rank: the source's place in the ranked note (keyless-sources.md); gap: which of the collector's six gaps it is for.
// switch: true marks a page the site's robots file or terms speak against: it is asked once here, and using it is the owner's call.
const YT = 'https://www.youtube.com';
const ARCTIC = 'https://arctic-shift.photon-reddit.com/api';
const SUGGEST = 'https://suggestqueries.google.com/complete/search?client=chrome&hl=en&gl=us';
const CREATORDB = 'https://creatordb.app/free-tools';

const SOURCES = [
  { rank: 1, name: 'google-complete-wildcard', gap: '1,4', url: `${SUGGEST}&q=what+did+*+do+streamer`, check: completions },
  { rank: 2, name: 'youtube-channel-feed', gap: '1,3', url: `${YT}/feeds/videos.xml?channel_id=UCq6VFHwMzcMXbuKyG7SQYIg`,
    check: (t) => both(count(t, /<entry>/g), 'entries', count(t, /<media:statistics /g), 'with view counts') },
  { rank: 3, name: 'wikipedia-hourly-dumps-index', gap: '3', url: dumpsUrl,
    check: (t, _b, now) => { const d = dumpFiles(t, now.getTime()); return { ok: d.files > 0, check: `hourly files listed: ${d.files}, newest is ${d.ageHours ?? '?'} h old` }; } },
  { rank: 4, name: 'trendingtiktoksongs-viral-us', gap: '2,3', url: 'https://trendingtiktoksongs.com/charts/us/viral', check: (t) => found(longestItemList(t), 'chart rows') },
  { rank: 5, name: 'wiktionary-internet-slang', gap: '4',
    url: 'https://en.wiktionary.org/w/api.php?action=query&list=categorymembers&cmtitle=Category:English_internet_slang&cmsort=timestamp&cmdir=desc&cmlimit=40&cmprop=title|timestamp&format=json',
    check: (t) => found(listOf(parse(t)?.query?.categorymembers).length, 'members') },
  { rank: 6, name: 'google-complete-shopping', gap: '5', url: `${SUGGEST}&ds=sh&q=viral+`, check: completions },
  { rank: 7, name: 'livestreamfails-hot', gap: '1,6', url: 'https://api.livestreamfails.com/clips?querySort=new&queryMinScore=500',
    check: (t) => { const clips = listOf(parse(t)); return both(clips.length, 'clips', clips.filter((c) => Number.isFinite(c?.redditScore)).length, 'with a score'); } },
  { rank: 8, name: 'arctic-shift-comments', gap: '6,1', url: `${ARCTIC}/comments/search?subreddit=LivestreamFail&limit=100&sort=desc&fields=link_id,created_utc`,
    check: (t) => { const rows = listOf(parse(t)?.data); return both(rows.length, 'comments', new Set(rows.map((c) => c?.link_id)).size, 'threads'); } },
  { rank: 8, name: 'arctic-shift-posts', gap: '6,1', url: `${ARCTIC}/posts/search?subreddit=youtubedrama&limit=25&sort=desc&fields=id,title,created_utc,link_flair_text`,
    check: (t) => found(listOf(parse(t)?.data).length, 'posts') },
  { rank: 9, name: 'famous-birthdays-trending', gap: '1', url: 'https://www.famousbirthdays.com/trending/', check: (t) => found(count(t, /tile__ranking-move/g), 'people with a rank move') },
  { rank: 10, name: 'sportskeeda-news-sitemap', gap: '1', url: 'https://www.sportskeeda.com/news-sitemap.xml',
    check: (t) => both(count(t, /<url>/g), 'urls', count(t, /<loc>[^<]*\/us\/streamers\//g), 'streamer desk') },
  { rank: 11, name: 'ivr-twitch-users', gap: '1,3', url: 'https://api.ivr.fi/v2/twitch/user?login=kaicenat,xqc,adinross,hasanabi',
    check: (t) => { const users = listOf(parse(t)); return both(users.length, 'users', users.filter((u) => Number.isFinite(u?.followers)).length, 'with a follower count'); } },
  { rank: 12, name: 'roblox-explore', gap: '5,3', url: 'https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=11111111-1111-1111-1111-111111111111&device=computer&country=all',
    check: (t) => { const sorts = listOf(parse(t)?.sorts); return both(sorts.length, 'sorts', sorts.reduce((n, s) => n + listOf(s?.games).length, 0), 'games'); } },
  { rank: 13, name: 'pagesix-news-sitemap', gap: '3,1', url: 'https://pagesix.com/news-sitemap.xml', check: sitemapUrls },
  { rank: 13, name: 'ladbible-googlenews', gap: '1,3', url: 'https://www.ladbible.com/googlenews.xml', check: sitemapUrls },
  { rank: 13, name: 'complex-news-sitemap', gap: '1,3', url: 'https://www.complex.com/sitemap/v3/news.xml', check: sitemapUrls },
  { rank: 14, name: 'shaderoom-feed', gap: '1', url: 'https://theshaderoom.com/feed/', check: rssItems },
  { rank: 14, name: 'hotnewhiphop-feed', gap: '1', url: 'https://www.hotnewhiphop.com/feed', check: rssItems },
  { rank: 14, name: 'ontd-rss', gap: '1,6', url: 'https://ohnotheydidnt.livejournal.com/data/rss',
    check: (t) => both(count(t, /<item[\s>]/g), 'items', count(t, /<lj:reply-count>/g), 'with a reply count') },
  { rank: 15, name: 'apple-top-free-apps', gap: '5', url: 'https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/50/apps.json',
    check: (t) => found(listOf(parse(t)?.feed?.results).length, 'apps') },
  { rank: 16, name: 'gdelt-ngrams-toc', gap: '3', url: gdeltUrl,
    check: (_t, buf) => { const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf; return found(count(raw.toString('utf8'), /^\{/gm), 'articles'); } },
  { rank: 17, name: 'creatordb-instagram-audio', gap: '2', url: `${CREATORDB}/trending-instagram-audio/`,
    check: (t) => both(longestItemList(t), 'chart rows', distinct(t, /instagram\.com\/reels\/audio\/\d+/g), 'audio ids') },
  { rank: 18, name: 'later-tiktok-trends', gap: '2', url: 'https://later.com/blog/tiktok-trends/',
    check: (t) => both(count(t, />\s*Trend:/g), 'trend entries', distinct(t, /tiktok\.com\/music\/[\w%.-]+/g), 'sound links') },
  { rank: 18, name: 'ramdam-tiktok-trends', gap: '2', url: 'https://www.ramd.am/blog/trends-tiktok', check: (t) => found(distinct(t, /tiktok\.com\/[^"'\s<]+/g), 'tiktok links') },
  { rank: 19, name: 'youtube-results-today', gap: '1,3', switch: true, url: `${YT}/results?search_query=responds+to+allegations&sp=CAMSBAgCEAE%3D&hl=en&gl=US`,
    check: (t) => found(count(t, /"videoRenderer":\{/g), 'videos parsed') },
  { rank: 20, name: 'creatordb-youtube-trending', gap: '1', url: `${CREATORDB}/whats-trending-on-youtube/`, check: (t) => found(distinct(t, /watch\?v=[\w-]{11}/g), 'video ids') },
  { rank: 20, name: 'creatordb-controversy', gap: '1', url: `${CREATORDB}/most-controversial-youtube-videos/`, check: (t) => found(distinct(t, /watch\?v=[\w-]{11}/g), 'video ids') },
  { rank: 21, name: 'shazam-discovery-csv', gap: '2', url: 'https://www.shazam.com/services/charts/csv/discovery/united-states', check: (t) => found(count(t, /^\d+,/gm), 'rows') },
  { rank: 22, name: 'steam-concurrent-players', gap: '3', url: 'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/',
    check: (t) => found(listOf(parse(t)?.response?.ranks).length, 'ranks') },
  { rank: 23, name: 'kworb-spotify-us-daily', gap: '3,2', url: 'https://kworb.net/spotify/country/us_daily.html', check: (t) => found(Math.max(0, count(t, /<tr[\s>]/g) - 1), 'rows') },
  { rank: 24, name: 'sullygnome-follower-losers', gap: '1', url: 'https://sullygnome.com/api/tables/channeltables/getchannels/3/0/0/8/asc/0/25',
    check: (t) => { const rows = listOf(parse(t)?.data); return both(rows.length, 'rows', rows.filter((r) => Number.isFinite(r?.followersgained)).length, 'with a follower change'); } },
  { rank: 25, name: 'afterschool-feed', gap: '4,5', url: 'https://afterschool.substack.com/feed', check: rssItems },
  { rank: 26, name: 'bing-completions', gap: '4,1', url: 'https://api.bing.com/osjson.aspx?query=why+is+everyone+&market=en-US', check: completions },
  { rank: 27, name: 'streamerbans-feed', gap: '1', url: 'https://streamerbans.com/', check: (t) => found(listOf(nextData(t)?.props?.pageProps?.feed).length, 'ban events') },
  { rank: 28, name: 'bing-news-rss', gap: '1,3', url: 'https://www.bing.com/news/search?q=%22Kai+Cenat%22&format=rss&qft=sortbydate%3d%221%22', check: rssItems },
  { rank: 29, name: 'pinterest-trends', gap: '5', url: pinterestUrl, check: (t) => found(listOf(parse(t)?.values).length, 'terms') },
  { rank: 30, name: 'revid-tiktok-today', gap: '2', url: 'https://www.revid.ai/tiktok-viral-trends-today', check: (t) => found(count(stripTags(t), /\+[\d.,]+[KMB]?\s*views in 24h/g), 'gaining posts') },
  { rank: 31, name: 'youtube-hashtag-page', gap: '4,3', url: `${YT}/hashtag/mogging`, check: (t) => has(/[\d.,]+[KMB]? videos[^"]{0,40}channels/i.test(t), 'has the videos-and-channels line') },
  { rank: 32, name: 'tiktok-embed-sound', gap: '2,3', switch: true, url: 'https://www.tiktok.com/embed/music/7609830978302887953',
    check: (t) => has(/__FRONTITY_CONNECT_STATE__/.test(t) && /"videoCount":\d+/.test(t), 'has a video count') },
  { rank: 33, name: 'tiktok-profile-page', gap: '1,2', switch: true, url: 'https://www.tiktok.com/@charlidamelio', check: (t) => has(/"statsV2":\{[^}]*"followerCount":"\d+"/.test(t), 'has an exact follower count') },
];

// ---------- a refusal that arrives as a page ----------
// (only looked for when the structure was NOT found: a healthy page may mention any of these words)
const WALLS = [
  ['cloudflare challenge', /<title>Just a moment\.\.\.<\/title>|cf_chl_opt|cf-chl-|Attention Required! \| Cloudflare/i],
  ['human-verification page', /Human Verification/i],
  ['tiktok waf challenge', /_wafchallengeid|SlardarWAF/],
  ['overload refusal', /overload-protect triggered/i],
  ['unusual-traffic page', /unusual traffic|\/sorry\/index/i],
  ['consent page', /consent\.(?:youtube|google)\.com/i],
  ['login page', /accounts\/login|"loginPage"|log in to continue/i],
];
const wallOf = (text) => (WALLS.find(([, re]) => re.test(text)) || [null])[0];

// ---------- asking ----------
/** The collector's own user agent (lib/budget.js): honest, with the repository's address as the contact on a CI run. */
function userAgent(env = process.env) {
  const contact = (env.IDEAS_UA_CONTACT || '').trim() || (env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : '');
  return contact ? `YapPalIdeas/1 (+${contact})` : 'YapPalIdeas/1';
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });
const urlOf = (source, now) => (typeof source.url === 'function' ? source.url(now) : source.url);
/** Why a request never got an answer, as a fixed word or the network's own error code: never a message. */
function failureOf(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return `timed out after ${TIMEOUT_MS / 1000} s`;
  const code = String(error?.cause?.code || error?.code || '');
  return /^[A-Z][A-Z0-9_]{2,40}$/.test(code) ? `request failed (${code})` : 'request failed';
}

/** What a reply's body says about its structure: the source's own check, or the wall it turned out to be. */
function verdict(source, res, buf, now) {
  const text = buf.toString('utf8');
  let read;
  try { read = res.ok ? source.check(text, buf, now) : { ok: false, check: `not read (HTTP ${res.status})` }; } catch { read = { ok: false, check: 'unreadable reply' }; }
  if (read.ok) return read;
  const wall = wallOf(text.slice(0, 200_000));
  return wall ? { ok: false, check: `${wall} (${read.check})` } : read;
}

/** One source, asked once. */
async function ask(source, agent) {
  const now = new Date();
  const url = urlOf(source, now);
  const base = { rank: source.rank, name: source.name, gap: source.gap, switch: Boolean(source.switch) };
  const started = performance.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': agent, Accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const buf = Buffer.from(await res.arrayBuffer());
    const finalHost = new URL(res.url || url).host;
    return { ...base, status: res.status, bytes: buf.length, contentType: res.headers.get('content-type') || '', ms: Math.round(performance.now() - started),
      ...(finalHost !== new URL(url).host ? { redirectedTo: finalHost } : {}), ...verdict(source, res, buf, now) };
  } catch (error) {
    return { ...base, status: 0, bytes: 0, contentType: '', ms: Math.round(performance.now() - started), ok: false, check: failureOf(error) };
  }
}

/** Every source in turn: a second between requests, five before a host is asked a second time. */
function askAll(sources, agent, log) {
  return sources.reduce(async (before, source, i) => {
    const { rows, askedAt } = await before;
    const host = new URL(urlOf(source, new Date())).host;
    await sleep(Math.max(i === 0 ? 0 : GAP_MS, SAME_HOST_GAP_MS - (Date.now() - (askedAt[host] ?? 0))));
    const row = await ask(source, agent);
    log(`${String(i + 1).padStart(2)}/${sources.length} ${row.name}: ${row.status || 'no answer'}, ${row.bytes} bytes, ${row.ms} ms, ${row.check}`);
    return { rows: [...rows, row], askedAt: { ...askedAt, [host]: Date.now() } };
  }, Promise.resolve({ rows: [], askedAt: {} })).then((done) => done.rows);
}

// ---------- writing ----------
const cell = (value) => String(value).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
function markdown(report) {
  const good = report.results.filter((r) => r.ok).length;
  const lines = report.results.map((r, i) => `| ${i + 1} | ${cell(r.name)}${r.switch ? ' (owner\'s switch)' : ''} | ${cell(r.rank)} | ${cell(r.gap)} | ${r.status || 'none'} | ${r.bytes} | ${cell(r.contentType.split(';')[0]) || '-'} | ${r.ms} | ${r.ok ? 'yes' : 'NO'} | ${cell(r.check)}${r.redirectedTo ? ` (redirected to ${cell(r.redirectedTo)})` : ''} |`);
  return [
    '# Keyless source probe',
    '',
    `Ran ${report.ranAt} from ${report.where} (Node ${report.node}). ${good} of ${report.results.length} answered with the structure expected.`,
    'One GET each, an honest user agent, 15 seconds at most. The check is a count or a yes/no: no content is kept.',
    '',
    '| # | source | rank | gap | status | bytes | type | ms | as expected | check |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...lines,
    '',
  ].join('\n');
}

function outDir(argv) {
  const i = argv.indexOf('--out');
  const inline = argv.find((a) => a.startsWith('--out='));
  return path.resolve(inline ? inline.slice('--out='.length) : i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_OUT);
}

async function main() {
  const out = outDir(process.argv.slice(2));
  const ranAt = new Date().toISOString();
  const results = await askAll(SOURCES, userAgent(), (line) => process.stdout.write(`${line}\n`));
  const report = { ranAt, where: process.env.GITHUB_ACTIONS === 'true' ? 'a GitHub Actions runner' : 'a local machine', node: process.version,
    timeoutSeconds: TIMEOUT_MS / 1000, asExpected: results.filter((r) => r.ok).length, asked: results.length, results };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'results.md'), markdown(report));
  process.stdout.write(`\n${report.asExpected} of ${report.asked} as expected; wrote results.json and results.md\n`);
}

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`the probe broke: ${error?.name || 'Error'}\n`); process.exitCode = 1; });
}

module.exports = { SOURCES, gdeltUrl, dumpsUrl, dumpFiles, longestItemList, wallOf, userAgent, markdown };
