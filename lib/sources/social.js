'use strict';
/*
 * X's trends by country (ios/IDEAS-FEED.md A4, A5), read from trends24.in: a third party's page that keeps each country's hourly
 * lists of the last day, so one request gives fifty trends now AND when each of them began (the first of the unbroken run of hourly
 * lists that carry it). One country's page an hour, in rotation; unofficial, so isolated here and absent the cycle it is turned away.
 *
 * A trend is a name and a place in a list, nothing else: it says what X is talking about, never why. So it corroborates a trend the
 * list already has (the `social` kind, beside Bluesky), and a creator of the roster it names is worth that name's search now; it
 * never makes a row on its own.
 */
const { request } = require('./fixed');
const { keyOf, HOUR } = require('../util');

const X_PAGES = { US: 'united-states', GB: 'united-kingdom', AU: 'australia', CA: 'canada' };
const X_GEOS = Object.keys(X_PAGES);
const RUN_GAP_SECONDS = 2 * HOUR + 600; // (an hourly list missed once breaks no run)
const HELD_SECONDS = 90 * 60; // the page is hourly: a list read inside the last hour and a half is the current one
const LISTS_KEPT = 50;
const X_NEW_SECONDS = 3 * HOUR;
const PAGE_STALE_SECONDS = 3 * HOUR;
const ROSTER_NAME_WORDS = 2;

const xId = (geo) => `x-${geo}`;
/** The country whose page is read this cycle: one a cycle, the one read longest ago (each about hourly). lastReadAt: Map(request id -> seconds). */
const xTurn = (lastReadAt = new Map()) => X_GEOS.map((geo, i) => ({ geo, i, at: lastReadAt.get(xId(geo)) ?? -Infinity })).sort((a, b) => a.at - b.at || a.i - b.i)[0].geo;
/** One country's page. */
const xRequest = (geo) => request({ id: xId(geo), source: 'x-trends24', kind: 'x-trends', args: { geo }, url: `https://trends24.in/${X_PAGES[geo]}/`, file: `x-trends24-${geo}.html`, tier: 2 });

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** The page's hourly lists, newest first: [{ at (epoch seconds), names: [as X spells them, in the list's order] }]. [] when the page is not that page. */
function parseTrends24(html) {
  const blocks = String(html || '').split(/<h3 class="?title"? data-timestamp="?/).slice(1);
  const lists = [];
  for (const b of blocks) {
    const at = Math.floor(parseFloat(b));
    if (!Number.isFinite(at) || at <= 0) continue;
    const list = b.split(/<\/ol>/)[0];
    const names = [...list.matchAll(/class="?trend-link"?[^>]*>([^<]{1,80})<\/a>/g)].map((m) => decode(m[1])).filter(Boolean).slice(0, LISTS_KEPT);
    if (names.length) lists.push({ at, names });
  }
  return lists.sort((a, b) => b.at - a.at);
}

/**
 * The newest list as trends: [{ name, key, rank (1 = top), since (epoch seconds: the oldest list of the unbroken run that carries it),
 * hours (how long that run is) }]. A trend whose run reaches the page's oldest list began before the page did: `since` is then null
 * (older than a day: no start to say).
 */
function trendsOf(lists) {
  if (!lists.length) return [];
  const [now, ...older] = lists;
  const oldest = lists[lists.length - 1].at;
  return now.names.map((name, i) => {
    const key = xKey(name);
    let since = now.at;
    for (const l of older) {
      if (since - l.at > RUN_GAP_SECONDS) break;
      if (!l.names.some((n) => xKey(n) === key)) continue;
      since = l.at;
    }
    // (one list alone dates nothing: its own time is the page's edge too)
    return { name, key, rank: i + 1, since: since <= oldest ? null : since, hours: Math.round((now.at - since) / HOUR) };
  });
}
/** A trend's name as a key: a hashtag without its sign ("#StopTheWedding" -> "stopthewedding"). */
const xKey = (name) => keyOf(String(name).replace(/^#/, ''));

/**
 * Whether an X trend names a subject: the subject as whole words in the trend, the trend (two words or more) inside the subject, or a
 * hashtag that is the subject run together ("#StopTheWedding" for "stop the wedding").
 */
function namesSubject(trend, subject) {
  const s = keyOf(subject || '');
  if (!s || s.length < 4) return false;
  const name = ` ${trend.key} `;
  if (name.includes(` ${s} `) || (trend.key.includes(' ') && ` ${s} `.includes(name))) return true;
  return /^#/.test(trend.name) && trend.key === s.replace(/ /g, '');
}

/**
 * The countries' lists this cycle can read: the ones just fetched, and the ones held from the last hour and a half (the page is
 * hourly; a list is not re-read every cycle). held: { geo: { at (slot read), trends } } from the state; read: { geo: trends } this
 * cycle. Returns { lists: { geo: { at, trends } } (what to save), read: Set(geos read this cycle) }.
 */
function heldLists(held, read, t) {
  const lists = {};
  for (const geo of X_GEOS) {
    if (read && read[geo]) lists[geo] = { at: t, trends: read[geo] };
    else if (held && held[geo] && Number.isFinite(held[geo].at) && t - held[geo].at <= HELD_SECONDS && t >= held[geo].at) lists[geo] = held[geo];
  }
  // (a list this very slot read counts as read now, so the same slot run again reads as its first run did: A3)
  return { lists, read: new Set(X_GEOS.filter((geo) => lists[geo] && lists[geo].at === t)) };
}

/** The best-placed trend of any country's list that names the subject: { name, rank, since, geo, fresh (read this cycle) }, or null. x: heldLists' result. */
function xOf(subject, x) {
  if (!x || !x.lists) return null;
  let best = null;
  for (const [geo, list] of Object.entries(x.lists)) {
    for (const tr of list.trends) {
      if (!namesSubject(tr, subject)) continue;
      const hit = { name: tr.name, rank: tr.rank, since: tr.since, geo, fresh: x.read.has(geo) };
      // (a list read this cycle before a held one, then the better place)
      if (!best || Number(hit.fresh) - Number(best.fresh) > 0 || (hit.fresh === best.fresh && hit.rank < best.rank)) best = hit;
      break;
    }
  }
  return best;
}

/**
 * The roster's creators a list read this cycle newly names: a trend that began inside the last three hours and is one of the roster's
 * names of two words or more ("Shane Gillis"). Each is worth its own search now: [names]. Never at a first read (a run that reaches
 * the page's edge has no start).
 */
function newCreators(x, roster, t) {
  if (!x || !roster || !roster.size) return [];
  const out = [];
  for (const geo of x.read) {
    for (const tr of (x.lists[geo] || { trends: [] }).trends) {
      if (!Number.isFinite(tr.since) || t - tr.since > X_NEW_SECONDS || tr.key.split(' ').length < ROSTER_NAME_WORDS) continue;
      const hit = roster.get(tr.key);
      if (hit && !out.includes(hit.name)) out.push(hit.name);
    }
  }
  return out;
}

module.exports = { X_GEOS, xId, xTurn, xRequest, parseTrends24, trendsOf, xKey, namesSubject, heldLists, xOf, newCreators, HELD_SECONDS, X_NEW_SECONDS, PAGE_STALE_SECONDS };
