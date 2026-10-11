'use strict';
/*
 * Requests about one name (ios/IDEAS-FEED.md A4): tier 1's Google News name search and YouTube completions, the newest-first search of
 * the creators' world's biggest names, and the roster watch (completions for the roster's names, a few a cycle).
 */
const S = require('../../engine/sources');
const TS = require('../../engine/talk-sources');
const TN = require('../../engine/talk-nouns');
const { request } = require('./fixed');
const { DAY } = require('../util');

const ROSTER_WATCH_NAMES = 150;
const ORIGIN_BACK_DAYS = 14;
const ROSTER_NOUN_DAYS = 14;

/** A name's Google News search of the week and its YouTube completions: [news, yt]. */
function nameRequests(name, tier = 1) {
  const k = TS.talkKey(name);
  return [
    request({ id: `tp-news-${k}`, source: 'gnews', kind: 'name-news', args: { name }, url: TS.talkNewsUrl(name), file: `tp-news-${k}.xml`, tier }),
    request({ id: `tp-yt-${k}`, source: 'youtube', kind: 'name-yt', args: { name }, url: TS.talkSuggestUrl(name), file: `tp-yt-${k}.txt`, tier }),
  ];
}
/** The newest two days of a creators'-world story, searched apart: a new accuser lands after the week's 100 results. */
function recentRequest(name) {
  const k = TS.talkKey(name);
  return request({ id: `tp-recent-${k}`, source: 'gnews', kind: 'name-recent', args: { name }, url: TS.talkNewsUrl(name, 2), file: `tp-recent-${k}.xml`, tier: 3 });
}

const ymd = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
/**
 * A name's origin search (C4): the fortnight before its week, asked once, for a story whose start sits at the edge of what the week's
 * search could show. edge: where that search began to look (epoch seconds). args.from: the first moment this one can show.
 */
function originRequest(name, edge) {
  const k = TS.talkKey(name);
  const day = ymd(edge - ORIGIN_BACK_DAYS * DAY);
  return request({ id: `tp-origin-${k}`, source: 'gnews', kind: 'name-origin', args: { name, from: Date.parse(`${day}T00:00:00Z`) / 1000 },
    url: S.gnSearch(`"${name.replace(/["“”]/g, '')}" after:${day} before:${ymd(edge + 2 * DAY)}`), file: `tp-origin-${k}.xml`, tier: 3 });
}

/**
 * The roster watch's names: the roster's creators, the head of each of Wikipedia's lists in turn (each list is most linked first),
 * `ROSTER_WATCH_NAMES` of them. roster: the engine's Map(key -> { name }) in file order.
 */
function watchNames(roster, max = ROSTER_WATCH_NAMES) {
  return [...(roster ? roster.values() : [])].map((r) => r.name).filter((n) => n && n.split(' ').length <= 3).slice(0, max);
}
/** The watch's next `n` names after `cursor` (wrapping), and the cursor to save. */
function watchTurn(names, cursor, n) {
  if (!names.length) return { names: [], cursor: 0 };
  const start = cursor % names.length;
  const picked = Array.from({ length: Math.min(n, names.length) }, (_, i) => names[(start + i) % names.length]);
  return { names: picked, cursor: (start + picked.length) % names.length };
}
const watchRequest = (name) => { const k = TS.talkKey(name); return request({ id: `tp-yt-${k}`, source: 'youtube', kind: 'name-yt', args: { name, watch: true }, url: TS.talkSuggestUrl(name), file: `tp-yt-${k}.txt`, tier: 3 }); };

/**
 * What a watched name's completions newly say: the drama nouns ("mizkif leak") the name has not carried in the last 14 days. carried:
 * { noun: epoch seconds last seen }. Returns { fresh: [nouns], carried (updated) }: a fresh noun is a `creators` signal and makes the
 * name a tier 1 name in the same cycle.
 */
function watchSignal(completions, carried, nowSeconds) {
  const seen = { ...(carried || {}) };
  const fresh = [];
  for (const c of completions || []) {
    for (const x of TN.familiesIn(c.q || '')) {
      if (!TN.DRAMA_FAMS.has(x.f.key)) continue;
      const last = seen[x.f.key];
      if (!Number.isFinite(last) || nowSeconds - last > ROSTER_NOUN_DAYS * DAY) fresh.push(x.f.key);
      seen[x.f.key] = nowSeconds;
    }
  }
  return { fresh: [...new Set(fresh)], carried: seen };
}

module.exports = { nameRequests, recentRequest, originRequest, ORIGIN_BACK_DAYS, watchNames, watchTurn, watchRequest, watchSignal, ROSTER_WATCH_NAMES };
