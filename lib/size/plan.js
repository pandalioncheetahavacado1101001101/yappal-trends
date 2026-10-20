'use strict';
/*
 * What a cycle asks Wikipedia for the size series, and in what order (ios/IDEAS-FEED.md A4: polite, bounded, cached). Each subject is
 * looked up once; each page's redirects once (its title checked weekly, 50 pages a request); each title's days fetched once: its
 * history the first time (from the daily series' start when its life reaches back past what is held), then only the days after
 * what is held, at most once in 4 hours while a day is due (the API's own cache holds a reply 4 hours). On the Action API a row's
 * lookups and then its pages' redirects go by the row's rank, so the first page's rows are complete before the rest begin; on the
 * views API a row with no chart yet comes before a row whose chart is a day old, and within each the rank decides.
 * Pure: the cycle sends what this returns (lib/size/cycle.js through lib/fetch.js), and lib/size/run.js does the same by hand.
 */
const W = require('./wiki');
const SW = require('../sources/size-wiki');
const D = require('./days');
const { capOf } = require('../budget');

const ASK_AGAIN_SECONDS = 4 * 3600;
const INFO_EVERY_SECONDS = 7 * 86400;
// a cycle's share, per host group: the Action API's 10 a cycle are shared with the dictionary lookups (M6), the views API is its own
// group, held to what the cycle's budget gives a host it names no cap for (lib/budget.js), so the plan never asks what the budget refuses
const PER_CYCLE = { action: 3, views: Math.min(6, capOf(SW.VIEWS_HOST)) };

/**
 * A cycle's size requests. rows: [{ id, rank, trendStart, historyFrom (optional: the first day wanted, when the life reaches back past
 * what is held), subjects: [subject], lookups: { subjectId: {...} }, articles: [{ pageid, verdict, titles (null until its redirects
 * are read), infoAt }] }]; cache: { title: entry with askedAt }; now: epoch seconds. A subject or a page two rows share is asked once.
 * Returns { requests (in the order to send), waiting: { action, views } (what is left for later cycles) }.
 */
function planCycle({ rows, cache = {}, now, perCycle = PER_CYCLE }) {
  const yesterday = D.addDays(D.dayOfInstant(now), -1);
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  const action = [];
  const asked = new Set();
  const live = ranked.flatMap((r) => (r.articles || []).filter((a) => a.verdict !== 'refuse').map((a) => ({ row: r, a })));
  for (const r of ranked) {
    for (const s of r.subjects || []) if (!(r.lookups || {})[s.id] && !asked.has(s.id)) { asked.add(s.id); action.push(SW.searchRequest(s)); }
    for (const a of (r.articles || []).filter((x) => x.verdict !== 'refuse' && !x.titles)) if (!asked.has(a.pageid)) { asked.add(a.pageid); action.push(SW.redirectsRequest(a.pageid)); }
  }
  const stale = [...new Set(live.filter(({ a }) => a.titles && (!Number.isFinite(a.infoAt) || now - a.infoAt >= INFO_EVERY_SECONDS)).map(({ a }) => a.pageid))];
  for (let i = 0; i < stale.length; i += SW.INFO_BATCH) action.push(SW.infoRequest(stale.slice(i, i + SW.INFO_BATCH)));
  const backfill = [];
  const refresh = [];
  const seen = new Set();
  for (const { row, a } of live) {
    for (const title of a.titles || []) {
      if (seen.has(title)) continue;
      seen.add(title);
      const entry = cache[title];
      for (const range of W.wantRanges(entry, row.historyFrom || W.historyFrom(row.trendStart), yesterday)) {
        const before = !entry || !entry.to || range.to < entry.from;
        if (before) { backfill.push(SW.viewsRequest(title, range.from, range.to)); continue; }
        if (!Number.isFinite(entry.askedAt) || now - entry.askedAt >= ASK_AGAIN_SECONDS) refresh.push(SW.viewsRequest(title, range.from, range.to));
      }
    }
  }
  const views = [...backfill, ...refresh];
  return { requests: [...action.slice(0, perCycle.action), ...views.slice(0, perCycle.views)],
    waiting: { action: Math.max(0, action.length - perCycle.action), views: Math.max(0, views.length - perCycle.views) } };
}

/**
 * Requests a day for `rows` listed rows (the arithmetic of the review file): newPerDay rows met each day, subjects a new row looks up,
 * the share of rows with a page, titles read per page, and a refresh that sometimes lands before the day is published (retries).
 * Returns { lookups, redirects, info, backfill, refresh, total, perCycle (a day is 96 cycles), coldStart: { action, views, cycles }
 * (every row new at once, at the cycle's share) }.
 */
// (measured on the 80 rows of the US list of 2026-10-19 14:40Z: 84 subjects, 40 pages, 50 titles; newPerDay and retries are
// assumptions: rows met a day, and a refresh asked before the day's figure lands)
function requestsPerDay({ rows = 80, newPerDay = 25, subjectsPerRow = 1.05, withPage = 0.5, titlesPerPage = 1.25, retries = 1.25, cycles = 96 } = {}) {
  const lookups = newPerDay * subjectsPerRow;
  const redirects = newPerDay * withPage;
  const info = Math.ceil((rows * withPage) / SW.INFO_BATCH) / 7;
  const backfill = newPerDay * withPage * titlesPerPage;
  const refresh = rows * withPage * titlesPerPage * retries;
  const total = lookups + redirects + info + backfill + refresh;
  const cold = { action: rows * subjectsPerRow + rows * withPage, views: rows * withPage * titlesPerPage };
  const coldStart = { ...cold, cycles: Math.ceil(Math.max(cold.action / PER_CYCLE.action, cold.views / PER_CYCLE.views)) };
  return { lookups, redirects, info, backfill, refresh, total, perCycle: total / cycles, coldStart };
}

module.exports = { PER_CYCLE, ASK_AGAIN_SECONDS, INFO_EVERY_SECONDS, planCycle, requestsPerDay };
