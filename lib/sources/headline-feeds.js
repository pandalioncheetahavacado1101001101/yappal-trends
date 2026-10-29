'use strict';
/*
 * Outlets that print people's news first (ios/IDEAS-FEED.md L7, beside lib/sources/press.js): four feeds that, over the eight days
 * the headline-coverage lane measured (2026-10-19..27, every Google Trends person entry and every creator story of the time travel,
 * the first headline anywhere by GDELT's web table of contents and by Google News), most often carried a person's story before Google
 * Trends listed the person or before any feed the collector already read: a celebrity desk of a British tabloid's US site, a showbiz
 * wire's copy on a film site, a trade paper's news sitemap and a celebrity gossip site. Keyless, ordinary published files.
 *
 * One feed a cycle, in turn (the one read longest ago first), each no more often than its interval: at most one request a cycle in all
 * (the two read by default, hourly: one cycle in two; all four: about one a cycle, each read every 45-75 minutes). Their
 * rows are the press outlets' rows exactly (lib/sources/press.js `rows`: a headline with its outlet and its own time, talking points
 * only, nothing older than four days, read by the same reader, kind 'press'), so a name they print reaches the candidate step as a
 * press outlet's does, and a line taken from one stays in reported wording and names its outlet. They widen and time the coverage;
 * they weigh nothing by themselves and remove nothing.
 *
 * Flags (any source free for us to read, flagged for the owner):
 *   - Film-News.co.uk (www.film-news.co.uk/rss/UK/news): robots.txt allows it, names no AI crawler: none. On.
 *   - RadarOnline (radaronline.com/rss/): robots.txt allows it, names no AI crawler: none. On.
 *   - Daily Mail (www.dailymail.com/tvshowbiz/index.rss): robots.txt allows every agent this feed and bars named AI crawlers from the
 *     whole site: needs permission: DMG Media (Daily Mail). OFF unless IDEAS_SOURCES_ON names it (lib/sources/switch.js): besides the
 *     flag, its celebrity copy is dense with headlines whose noun belongs to someone other than the name they print first ("<A>
 *     reunites with <B> as he returns from suspension", "<A> receives apology from ...", "late pal <A> ... before her death"), which
 *     the noun step titles under the wrong person today.
 *   - Variety (variety.com/news-sitemap.xml): the same robots.txt: needs permission: Penske Media (Variety). OFF unless
 *     IDEAS_SOURCES_ON names it: a show's plot ("<character>'s fakeout death") is titled as a death today.
 * The outlets the collector already reads that bar named AI crawlers the same way (E! News, Page Six, Dexerto's feeds) carry the same
 * flag. People and TV Insider printed several of the same stories first but turn this agent away (402, 403): not read.
 *
 * Off: IDEAS_SOURCES_OFF=<feed id> turns one off (the budget refuses it), "headlines" all four; IDEAS_SOURCES_ON=hl-dailymail,hl-variety
 * turns the owner's two on. In a replay only what the recording holds is asked (a frozen day never asked them: it stays that day's).
 */
const fs = require('node:fs');
const path = require('node:path');
const { request } = require('./fixed');
const SWITCH = require('./switch');
const { HOUR } = require('../util');

const FEEDS = [
  // (a hundred-odd celebrity and influencer stories a day, 150 deep: about thirty hours, so the shortest interval)
  { id: 'hl-dailymail', label: 'Daily Mail', url: 'https://www.dailymail.com/tvshowbiz/index.rss', shape: 'rss', every: 45 * 60, owner: true },
  // (a showbiz wire's interviews, health news and deaths, about twenty a day, fifty deep)
  { id: 'hl-filmnews', label: 'Film-News.co.uk', url: 'https://www.film-news.co.uk/rss/UK/news', shape: 'rss', every: HOUR },
  // (the trade paper's news sitemap: everything it published in two days, about thirty a day)
  { id: 'hl-variety', label: 'Variety', url: 'https://variety.com/news-sitemap.xml', shape: 'sitemap', every: HOUR, owner: true },
  // (thirty deep, about ten hours)
  { id: 'hl-radar', label: 'RadarOnline', url: 'https://radaronline.com/rss/', shape: 'rss', every: HOUR },
];
const PER_CYCLE = 1;
const GROUP = 'headlines';

const feedOf = (id) => FEEDS.find((f) => f.id === id) || null;
/** Whether a feed may be read: not switched off, and an owner's feed only when IDEAS_SOURCES_ON names it. */
const allowed = (f, { off = new Set(), env = {} } = {}) => !off.has(GROUP) && !off.has(f.id) && (!f.owner || SWITCH.isOn(env, f.id));
/**
 * The feeds due this cycle: allowed, not read nor tried for their interval, the one whose turn came longest ago first, its host not
 * turned away (back-off), `n` at most. lastReadAt: Map(id -> epoch seconds of the last proper reply); switches: { off: the
 * IDEAS_SOURCES_OFF set, env, tried: Map(id -> epoch seconds of the last try, any reply), open: (host) => whether the host may be asked }.
 * A feed that was asked and did not answer properly has had its turn all the same (as the roster's feeds, rosterTried): one failing
 * feed is asked again after its interval, never every cycle, and never takes the other feeds' turns.
 */
function due(lastReadAt = new Map(), now = 0, n = PER_CYCLE, switches = {}) {
  const { tried = new Map(), open = () => true } = switches;
  const turnAt = (f) => Math.max(lastReadAt.get(f.id) ?? -Infinity, tried.get(f.id) ?? -Infinity);
  return FEEDS.map((f, i) => ({ f, i, at: turnAt(f) })).filter((x) => allowed(x.f, switches) && now - x.at >= x.f.every && open(new URL(x.f.url).host))
    .sort((a, b) => a.at - b.at || a.i - b.i).slice(0, n).map((x) => x.f);
}
/** The turns to keep (meta 'hlTried'): the feeds asked this cycle (a try that reached the host, whatever the reply) over the day's earlier ones. */
const triedAfter = (tried = {}, asked = [], now = 0, keepSeconds = 24 * HOUR) => Object.fromEntries([
  ...Object.entries(tried || {}).filter(([id, at]) => feedOf(id) && Number.isFinite(at) && now - at < keepSeconds),
  ...asked.filter((id) => feedOf(id)).map((id) => [id, now])]);
/** One feed, read as an outlet's (lib/ingest.js `press`). */
const feedRequest = (f) => request({ id: f.id, source: f.id, kind: 'press', args: { outlet: f.id }, url: f.url, file: `${f.id}.xml`, tier: 2 });

/** In a replay, only what the recording holds. folder: the slot's recorded folder, or null live. */
function recordedOnly(requests, folder) {
  if (!folder) return requests;
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')); } catch { manifest = {}; }
  return requests.filter((r) => manifest[r.id]);
}

/**
 * This cycle's request (collect.js, beside the press outlets' in the second round). lastReadAt: Map(id -> epoch seconds); off: the
 * IDEAS_SOURCES_OFF set; env: the cycle's environment (IDEAS_SOURCES_ON); tried: Map(id -> epoch seconds of the last try); open: (host)
 * => whether the host may be asked (lib/budget.js hostOpen); folder: the replay's slot folder, or null.
 */
const requests = (lastReadAt, now, { off = new Set(), env = {}, tried = new Map(), open = () => true, folder = null } = {}) =>
  recordedOnly(due(lastReadAt, now, PER_CYCLE, { off, env, tried, open }).map(feedRequest), folder);

module.exports = { FEEDS, PER_CYCLE, GROUP, allowed, due, feedOf, feedRequest, recordedOnly, requests, triedAfter };
