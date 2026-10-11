'use strict';
/*
 * The feeds a cycle reads whoever is trending (ios/IDEAS-FEED.md A4): tier 0, first and always, and tier 2, the other feeds in
 * rotation. A request is { id (also its row in `fetches`), source (the adapter's id: IDEAS_SOURCES_OFF names it), kind + args (how
 * lib/ingest.js reads the reply), url, init, host (a host group), file (its name under engine/raw), tier }.
 */
const S = require('../../engine/sources');
const TS = require('../../engine/talk-sources');
const { hostOfUrl } = require('../budget');
const { DAY } = require('../util');

const TREND_GEOS = ['US', 'GB', 'AU', 'CA'];
const TRENDS_RSS = (geo) => `https://trends.google.com/trending/rss?geo=${geo}`;
const BLUESKY = 'https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrends?limit=25';
const WINDOW_DAYS = 14;

const request = (r) => ({ tier: 0, init: {}, host: hostOfUrl(r.url), ...r });

/** Google Trends "Trending now" for one country: the realtime request, or the public RSS when that request is being turned away. */
function trendsRequest(geo, { rss = false } = {}) {
  if (rss) return request({ id: `trends-rss-${geo}`, source: 'trends', kind: 'trends-rss', args: { geo }, url: TRENDS_RSS(geo), file: `trends-rss-${geo}.xml`, host: 'trends.google.com/rss' });
  const { url, init } = S.trendsRequest(geo);
  return request({ id: `trends-${geo}`, source: 'trends', kind: 'trends', args: { geo }, url, init, file: `trends-i0OFE-${geo}-168h.txt` });
}

/** The creators' beat and the people-drama searches (Google News), the beat first. */
function dramaRequests(ids) {
  return TS.TALK_DRAMA.filter((d) => ids.includes(d.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    .map((d) => request({ id: `tp-drama-${d.id}`, source: 'gnews', kind: 'drama', args: { id: d.id }, url: TS.talkDramaUrl(d), file: `tp-drama-${d.id}.xml` }));
}
const outletRequest = (spec, tier) => request({ id: spec.id, source: spec.id.startsWith('kym-') ? 'kym' : spec.id, kind: 'feed', args: { spec: spec.id }, url: spec.url, file: `${spec.id}.xml`, tier });

/**
 * Tier 0: Google Trends for US, GB, AU and CA, Bluesky's trends, the creators' beat search, the three people-drama searches, and
 * Dexerto's and TMZ's own feeds. rssTrends: the realtime Trends request is in back-off, so the public RSS stands in.
 */
function tier0({ rssTrends = false } = {}) {
  const specs = S.feedSpecs();
  return [
    ...TREND_GEOS.map((geo) => trendsRequest(geo, { rss: rssTrends })),
    request({ id: 'bluesky', source: 'bluesky', kind: 'bluesky', args: {}, url: BLUESKY, file: 'bluesky-getTrends.json' }),
    ...dramaRequests(['beat', 'creators', 'said', 'celebs']),
    ...['dexerto', 'tmz'].map((id) => outletRequest(specs.find((s) => s.id === id), 0)),
  ];
}

/** The moments' Trends headlines: one batched request for the biggest trends' first article, when this cycle's replies name any. */
function trendNewsRequest(trends) {
  const calls = S.trendNewsCalls(trends.filter((t) => !t.headline));
  if (!calls.length) return null;
  const { url, init } = S.trendNewsRequest(calls);
  return request({ id: 'trends-news', source: 'trends', kind: 'trend-news', args: { tags: calls.map((c) => [c.tag, c.id]) }, url, init, file: 'trends-w4opAf-news.txt' });
}

/** Tier 2's ids, in the order the rotation breaks ties: every feed here is read at least hourly, 8 a cycle. */
function rotationIds() {
  const specs = S.feedSpecs().filter((s) => !s.dynamic);
  // (and the streamers' moments search, Dexerto's entertainment desk, an Australian pop-culture desk)
  return ['eonline', 'usweekly', 'justjared', 'perez', 'tp-drama-pop', 'tp-drama-stream', 'dexerto-ent', ...specs.filter((s) => s.id.startsWith('gn-ent-')).map((s) => s.id),
    ...specs.filter((s) => s.q && !s.wordsOnly).map((s) => s.id), ...specs.filter((s) => s.q && s.wordsOnly).map((s) => s.id),
    ...specs.filter((s) => s.fam === 'kym').map((s) => s.id), 'hn', 'pedestrian'];
}

/**
 * One rotation id's requests this cycle. A Google News search the collector has never read backfills its own 14 days first (two
 * requests, as the prototype's first run does); after that it asks for the last two days. lastReadAt: epoch seconds, or undefined.
 */
function rotationRequests(id, { nowMs, lastReadAt }) {
  if (id === 'tp-drama-pop' || id === 'tp-drama-stream') return dramaRequests([id.slice(9)]).map((r) => ({ ...r, tier: 2 }));
  if (id === 'hn') {
    const since = Number.isFinite(lastReadAt) ? lastReadAt * 1000 - DAY * 1000 : nowMs - WINDOW_DAYS * DAY * 1000;
    return [request({ id: 'hn', source: 'hn', kind: 'hn', args: {}, url: S.hnUrl(since), file: 'hn-stories.json', tier: 2 })];
  }
  const spec = S.feedSpecs().find((s) => s.id === id);
  if (!spec) return [];
  if (!spec.q) return [outletRequest(spec, 2)];
  const windows = S.gnWindows(nowMs, Number.isFinite(lastReadAt) ? lastReadAt * 1000 : 0);
  return windows.map((w) => request({ id: windows.length > 1 ? `${spec.id}-${w.tag}` : spec.id, rotationId: spec.id, source: 'gnews', kind: 'feed', args: { spec: spec.id },
    url: S.gnSearch(spec.q.replace('{w}', w.w)), file: `${spec.id}-${w.tag}.xml`, tier: 2 }));
}

module.exports = { TREND_GEOS, tier0, trendsRequest, trendNewsRequest, rotationIds, rotationRequests, request };
