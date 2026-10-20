'use strict';
/*
 * The size step of a cycle (ios/IDEAS-FEED.md A4, D4 `size`): a few Wikipedia requests for the rows the last cycle listed, in the order
 * and within the share lib/size/plan.js gives (3 on the Action API, inside its shared cap; 4 on the views API), sent through the
 * cycle's own budget and back-off, and every reply kept in the state (lib/size/store.js) so nothing is asked twice. A cold list fills
 * over hours, the first page first; after that it is a refresh a title a day. The detail reads what this keeps (lib/size/detail.js).
 * Keyless, and only with a contact in the user agent (Wikimedia's policy: the bare agent lost a third of its requests by hand).
 */
const SW = require('../sources/size-wiki');
const ST = require('./store');
const P = require('./plan');
const R = require('./resolve');
const W = require('./wiki');
const D = require('./days');

const CONTACT = /\(\+.+\)/;
// a rank no audience gave: the row was built and not listed
const UNLISTED = 999;

/** The best rank a row has in any audience's list, as its newest sample says (lib/history.js writes them), or UNLISTED. */
function rankOf(db, id) {
  const r = db.prepare('SELECT r_us, r_gb, r_au, r_ca, r_mx FROM samples WHERE trend_id = ? ORDER BY t DESC LIMIT 1').get(id);
  const ranks = r ? Object.values(r).filter((x) => Number.isFinite(x) && x > 0) : [];
  return ranks.length ? Math.min(...ranks) : UNLISTED;
}

/**
 * What the plan reads, from the state: { rows (lib/size/plan.js planCycle's), cache, used: { subjects, pageids, titles } }. A page an
 * article names is written down the first time it is met, so its redirects can be asked.
 */
function planInput(db, now) {
  const rows = [];
  const used = { subjects: [], pageids: [], titles: [] };
  const titles = [];
  for (const r of ST.recentRows(db)) {
    const rank = rankOf(db, r.id);
    if (rank === UNLISTED) continue;
    const spec = r.spec;
    const subjects = R.subjectsOf(spec);
    const looked = ST.lookups(db, subjects.map((s) => s.id));
    used.subjects.push(...subjects.map((s) => s.id));
    const articles = [];
    if (subjects.every((s) => looked.has(s.id))) {
      for (const a of R.resolve(spec, looked, spec.trendStart).articles) {
        let p = ST.page(db, a.pageid);
        if (!p) { p = { pageid: a.pageid, title: a.title, titles: null, infoAt: null }; ST.putPage(db, p, now); }
        used.pageids.push(a.pageid);
        let verdict = a.verdict;
        if (p.titles) {
          titles.push(...p.titles);
          used.titles.push(...p.titles);
          const cache = ST.views(db, p.titles);
          const entries = p.titles.map((title) => cache[title]);
          if (entries.every((e) => e && e.to)) verdict = R.confirm(a, (W.subjectViews(entries) || {}).views || null, spec.trendStart).verdict;
        }
        articles.push({ pageid: a.pageid, verdict, titles: p.titles, infoAt: p.infoAt });
      }
    }
    rows.push({ id: r.id, rank, trendStart: spec.trendStart, ...(r.earlier ? { historyFrom: W.DAILY_FROM } : {}), subjects,
      lookups: Object.fromEntries([...looked.keys()].map((k) => [k, true])), articles });
  }
  return { rows, cache: ST.views(db, titles), used };
}

/**
 * How many Action API requests the step will send this cycle (0 to the plan's share): what the cycle keeps back on the Wikimedia
 * group from its earlier rounds, freed just before the step. The dictionary lookups (M6) filled the group's 10 on two cycles of three
 * run on the Mac (2026-10-20), and the size then waited a cycle with its share refused. The same input as the step's own plan: the
 * rows the last cycle wrote down. 0 without a contact in the user agent (nothing is sent then).
 */
function actionShare({ db, now, agent }) {
  if (!CONTACT.test(agent || '')) return 0;
  ST.ensure(db);
  const { requests } = P.planCycle({ ...planInput(db, now), now });
  return requests.filter((r) => r.host !== SW.VIEWS_HOST).length;
}

/** One reply kept: true when it was read. */
function take(db, result, now, published) {
  const { request, status, text } = result;
  const a = request.args || {};
  if (request.kind === 'size-search') {
    const found = status === 200 ? SW.parseSearch(text) : null;
    if (!found) return false;
    ST.putLookup(db, a.subject, now, found);
    return true;
  }
  if (request.kind === 'size-redirects') {
    const found = status === 200 ? SW.parseRedirects(text) : null;
    const p = ST.page(db, a.pageid);
    if (!found || !p) return false;
    ST.putPage(db, { ...p, titles: SW.titlesOf(p.title, found), infoAt: Number.isFinite(p.infoAt) ? p.infoAt : now }, now);
    return true;
  }
  if (request.kind === 'size-info') {
    if (status !== 200) return false;
    const titles = SW.parseInfo(text);
    // (a page moved since it was found is read under its new title: its redirects are read again)
    for (const id of a.pageids || []) {
      const p = ST.page(db, id);
      if (!p) continue;
      const moved = titles.get(id);
      ST.putPage(db, moved && moved !== p.title ? { pageid: id, title: moved, titles: null, infoAt: now } : { ...p, infoAt: now }, now);
    }
    return true;
  }
  if (request.kind === 'size-views') {
    if (status !== 200 && status !== 404) return false;
    const items = W.parseRest(text);
    if (items === null) return false;
    const old = ST.views(db, [a.title])[a.title] || null;
    const covered = W.coveredTo(items, a.to, published);
    // (a range none of whose days is out yet is asked again in four hours, as a refresh is)
    ST.putViews(db, a.title, covered ? W.mergeFetch(old, a.title, items, { from: a.from, to: covered }) : old || { title: a.title, from: null, to: null, days: {} }, now, now);
    return true;
  }
  return false;
}

/**
 * One cycle's size requests, sent and kept. send: (requests) => results as lib/fetch.js `send` resolves them (the cycle's budget,
 * back-off and deadline inside it); booked: (result) => what the cycle counts of each; agent: the cycle's user agent. Resolves
 * { sent, read, waiting: { action, views } } (waiting: what later cycles will ask), or { sent: 0, why } when nothing could be asked.
 */
async function step({ db, now, send, agent, log = () => {}, booked = () => {} }) {
  ST.ensure(db);
  if (!CONTACT.test(agent || '')) { log('[size] no contact in the user agent (IDEAS_UA_CONTACT): Wikimedia asks for one, nothing sent'); return { sent: 0, why: 'no contact' }; }
  const input = planInput(db, now);
  ST.touch(db, input.used, now);
  const { requests, waiting } = P.planCycle({ rows: input.rows, cache: input.cache, now });
  if (!requests.length) { ST.prune(db, now); return { sent: 0, read: 0, waiting }; }
  const results = await send(requests);
  // (the newest day any reply of the cycle carries says what is published, for every quiet page's last day)
  const newest = results.filter((r) => r.request.kind === 'size-views').flatMap((r) => (W.parseRest(r.text) || []).slice(-1).map((i) => i.day));
  const published = [ST.metaGet(db, 'published'), ...newest].filter(D.isDay).sort().pop() || null;
  if (published) ST.metaSet(db, 'published', published);
  let read = 0;
  ST.transaction(db, () => { for (const r of results) if (take(db, r, now, published)) read += 1; });
  for (const r of results) booked(r);
  ST.prune(db, now);
  log(`[size] ${results.length} of ${requests.length} sent, ${read} read; for later cycles: ${waiting.action} on the Action API, ${waiting.views} on the views API`);
  return { sent: results.length, read, waiting };
}

module.exports = { CONTACT, UNLISTED, rankOf, planInput, actionShare, take, step };
