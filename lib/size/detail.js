'use strict';
/*
 * The detail's `size` (ios/IDEAS-FEED.md D4): how big a trend got over its life, as a % of the mega-trends (lib/size/scale.js), from
 * what the size step has cached in the state (lib/size/cycle.js). Built with the detail, the same for every audience: the row's spec
 * is written down for the next cycle's requests, and the field is read off what is held. No request is made here. A row whose lookups,
 * redirects or histories are still on their way has no size yet, never a partial one; nor has a row nothing calibrated measures.
 */
const DESC = require('../describe');
const V = require('../../samples/validate.cjs');
const ST = require('./store');
const R = require('./resolve');
const W = require('./wiki');
const T = require('./tracked');
const S = require('./series');
const D = require('./days');
const { instant } = require('../util');

// what the field may take: the detail's limit, less what the rest of the detail holds, the key and a margin for the rev it gets
const DETAIL_BYTES = V.LIMITS.detailBytes;
const FIELD_OVERHEAD = 16;
const SAMPLE_COLUMNS = 't, sv_us, outlets, tt_videos, yt_h, wiki, flags';
// a row whose size is on its way again (a new title or subject to look up) shows the last one it made for this long
const LAST_KEPT_SECONDS = 86400;

/**
 * What the size step reads of a row: its title, kind, sub, tier, people, topic and home demand as the list publishes them, and the
 * day it began (its start, else when the collector first saw it, else this slot). c: the cycle's trend (lib/history.js); about:
 * lib/describe.js aboutOf of its row.
 */
function specOf(c, { t, about }) {
  const row = c.primary;
  const start = [c.next && c.next.startedAt, c.firstObserved, t].find(Number.isFinite);
  return {
    title: row.title,
    kind: row.kind,
    sub: DESC.subOf(row),
    tier: row.kind === 'talk' && row.tier ? row.tier : null,
    people: ((about && about.people) || []).map((p) => ({ name: p.name, ...(p.role ? { role: p.role } : {}) })),
    ...(about && about.topic && about.topic.name ? { topic: { name: about.topic.name } } : {}),
    demand: DESC.demandOf(row, 'US'),
    trendStart: D.dayOfInstant(start),
  };
}

/**
 * The articles a row's size is read from, as held: { status: 'pending' | 'ready', subjects (the titles' entries by subject: [{ kind,
 * titles: [entry] }]), articles: [judgement with its titles] }. Pending while a lookup, a page's redirects or a title's first history
 * is not in. A page that needed its move to be attached is judged on its history (R.confirm).
 */
function articlesOf(db, spec) {
  const subjects = R.subjectsOf(spec);
  const looked = ST.lookups(db, subjects.map((s) => s.id));
  if (subjects.some((s) => !looked.has(s.id))) return { status: 'pending', subjects: [], articles: [] };
  const resolved = R.resolve(spec, looked, spec.trendStart);
  const held = [];
  const articles = [];
  for (const a of resolved.articles) {
    const p = ST.page(db, a.pageid);
    if (!p || !p.titles) return { status: 'pending', subjects: [], articles: [] };
    const cache = ST.views(db, p.titles);
    const entries = p.titles.map((title) => cache[title]);
    if (entries.some((e) => !e || !e.to)) return { status: 'pending', subjects: [], articles: [] };
    const judged = R.confirm(a, (W.subjectViews(entries) || {}).views || null, spec.trendStart);
    articles.push({ ...judged, titles: p.titles });
    if (judged.verdict !== 'refuse') held.push({ kind: a.kind, titles: entries });
  }
  return { status: 'ready', subjects: held, articles };
}

/** The collector's own measurements of a row (B1 samples), or its published demand when none is stored yet. */
function trackedOf(db, id, spec, today) {
  const samples = db.prepare(`SELECT ${SAMPLE_COLUMNS} FROM samples WHERE trend_id = ? ORDER BY t`).all(id);
  const players = spec.demand && spec.demand.kind === 'players' ? [{ day: today, kind: 'players', value: spec.demand.value }] : [];
  if (samples.length) return T.trackedFromSamples(samples, players);
  return [T.trackedFromDemand(spec.demand, today)].filter(Boolean);
}

/**
 * A row's size on `today`: { status: 'pending' | 'ready', size (lib/size/series.js sizeOf, or null), earlier (its life reaches back
 * past what is held: the history from the daily series' start is wanted first) }.
 */
function measure(db, id, spec, today) {
  const held = articlesOf(db, spec);
  if (held.status === 'pending') return { status: 'pending', size: null, earlier: false };
  const wiki = held.subjects.length ? W.wikiSize(held.subjects, spec.trendStart) : null;
  if (W.wantsEarlier(wiki)) return { status: 'pending', size: null, earlier: true };
  return { status: 'ready', size: S.sizeOf({ wiki, tracked: trackedOf(db, id, spec, today), trendStart: spec.trendStart, today }), earlier: false };
}

/**
 * The detail's size part: { size } to spread into its body, or {} (nothing measures it yet, or the detail has no room for it). The
 * row's spec is written down for the size step whatever comes of it. shown: the rest of the detail's body; generatedAt: its time.
 * While a row's size is on its way again (its title changed and the new title's page is being looked up), the last field it made
 * stands for up to a day, so the sheet's chart does not blink out for the cycles that takes. A failure here never costs the detail:
 * it is told on stderr and the detail stands without a size.
 */
function part(db, c, { t, generatedAt, about, shown }) {
  try {
    ST.ensure(db);
    const spec = specOf(c, { t, about });
    try { ST.putSpec(db, c.id, t, spec); } catch (e) { process.stderr.write(`[size] ${c.id}: the spec was not written (${e.message})\n`); }
    const m = measure(db, c.id, spec, D.dayOfInstant(t));
    if (m.earlier && !ST.earlierOf(db, c.id)) ST.setEarlier(db, c.id, true);
    const around = { schemaVersion: 1, id: c.id, rev: 'xxxxxx', generatedAt: instant(generatedAt), ...shown };
    const room = DETAIL_BYTES - Buffer.byteLength(JSON.stringify(around)) - FIELD_OVERHEAD;
    if (m.status === 'ready') {
      const whole = m.size ? S.feedField(m.size) : null;
      try { ST.putLast(db, c.id, t, whole); } catch (e) { process.stderr.write(`[size] ${c.id}: the field was not kept (${e.message})\n`); }
      const size = whole ? S.feedFieldWithin(m.size, room) : null;
      return size ? { size } : {};
    }
    const last = ST.last(db, c.id);
    const size = last && t - last.at <= LAST_KEPT_SECONDS ? S.fieldWithin(last.field, room) : null;
    return size ? { size } : {};
  } catch (e) {
    process.stderr.write(`[size] ${c && c.id}: no size this cycle (${e.message})\n`);
    return {};
  }
}

module.exports = { DETAIL_BYTES, LAST_KEPT_SECONDS, specOf, articlesOf, trackedOf, measure, part };
