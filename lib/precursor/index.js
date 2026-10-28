'use strict';
/*
 * The learned precursor (2026-10-31, wave 9 lane precursor; ios/.review/learn/2026-10-30-5x-plan.md L1, L0, L6): a calibrated score of
 * each listed row, "will this prove viral by its own measured attention", from what is known at this cycle only. An internal ranking
 * score: never a field of the feed, never a prediction shown to anyone (C7: no kind has passed the P6 gate).
 *
 * IDEAS_PRECURSOR
 *   unset    shadow (the default): the lists are exactly as without it. Each cycle scores the rows, logs them privately (lib/precursor/
 *            log.js) and prints one line of counts: "[precursor] would list <n> early (hand rule <m>), agree <k>".
 *   act      the same, and the list's Early rows (the hand rule's, lib/measure.js earlyStep: which rows, unchanged) are ORDERED by the
 *            score: the strongest three take the page's Early places (lib/feed.js spliceEarly). No row gains or loses the tag.
 *   off / 0  nothing: no score, no log, no line.
 * IDEAS_PRECURSOR_WEIGHTS=<file>: weights a refit promoted (the VM's private learn folder); else the day-0 weights shipped here.
 *
 * Hooks (wired by the merge, collect.js / lib/feed.js): `cycle(...)` after FEED.build; `orderEarly(...)` inside FEED.build's Early
 * order; `observePoints(...)` from the engine's talking-point build (every candidate, kept or dropped). Every hook is wrapped: a
 * failure here costs the score, never the cycle.
 */
const fs = require('node:fs');
const F = require('./features');
const MODEL = require('./model');
const LOG = require('./log');
const PTS = require('./points');
const DAY0 = require('./day0.json');

const HOUR = 3600;
const EARLY_AGE = 36 * HOUR;
const EARLY_SEARCH = 50000;
const PAGE = 20;
const PAST_HOURS = 6;
const COLUMN = { US: 'us', GB: 'gb', AU: 'au', CA: 'ca', mixed: 'mx' };

/** 'off' | 'shadow' | 'act' from the environment (unset: shadow). */
function mode(env = process.env) {
  const v = String(env.IDEAS_PRECURSOR || '').trim().toLowerCase();
  if (v === 'act') return 'act';
  if (v === 'off' || v === '0' || v === 'false') return 'off';
  return 'shadow';
}

/** A model object is usable: names known to the features, numbers where numbers belong. */
function usable(m) {
  if (!m || !Array.isArray(m.names) || !m.names.length || !m.platt) return false;
  const n = m.names.length;
  const nums = (xs) => Array.isArray(xs) && xs.length === n && xs.every(Number.isFinite);
  return m.names.every((x) => F.NAMES.includes(x)) && nums(m.mean) && nums(m.scale) && nums(m.w) && Number.isFinite(m.b) &&
    Number.isFinite(m.platt.a) && Number.isFinite(m.platt.c) && Number.isFinite(m.theta);
}
/** The model to score with: a promoted file when it is set and sound, else the day-0 weights. { model, source }. */
function loadModel(env = process.env) {
  const file = String(env.IDEAS_PRECURSOR_WEIGHTS || '').trim();
  if (file) {
    try { const m = JSON.parse(fs.readFileSync(file, 'utf8')); if (usable(m)) return { model: m, source: 'file' }; } catch { /* (the day-0 weights stand) */ }
  }
  return { model: DAY0, source: 'day0' };
}

const seconds = F.seconds;
/**
 * Whether the hand rule's own gates (lib/measure.js earlyStep, all but its evidence) would let a row be Early: a story or a moment,
 * dated to the hour, under 36 hours old, not grim, not already proven by a big home search, and not on the page on its own place.
 */
function eligible(item, { t, grim = false }) {
  if (!item || (item.kind !== 'talk' && item.kind !== 'moment')) return false;
  const started = seconds(item.startedAt);
  if (item.startedPrecision !== 'hour' || started === null || t < started || t - started > EARLY_AGE) return false;
  if (grim || /death/.test(String(item.sensitiveWhy || ''))) return false;
  const d = item.demand;
  if (d && d.kind === 'search' && Number.isFinite(d.value) && d.value >= EARLY_SEARCH) return false;
  return !!item.isEarly || !(item.rank <= PAGE);
}

/** A row's earlier ranks and heats in one audience: [{ t, rank, heat }] from the samples, the last PAST_HOURS before t. */
function pastOf(db, id, audience, t) {
  const col = COLUMN[audience];
  if (!db || !col) return [];
  try {
    return db.prepare(`SELECT t, r_${col} AS rank, h_${col} AS heat FROM samples WHERE trend_id = ? AND t >= ? AND t < ? ORDER BY t`).all(id, t - PAST_HOURS * HOUR, t)
      .filter((r) => Number.isFinite(r.rank));
  } catch { return []; }
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;
/**
 * Scores one audience's list. items: the list's items as built; cycleOf(id): the cycle's trend (lib/history.js step) or null.
 * Returns [{ id, p, eligible, early, rank, x (every features.NAMES, in order), extras }] in list order.
 */
function scoreList(items, { t, audience, db = null, cycleOf = () => null, model = DAY0 }) {
  const out = [];
  for (const it of items || []) {
    const c = cycleOf(it.id) || null;
    const listed = c && c.trend && c.trend.firstListedAt && Number.isFinite(c.trend.firstListedAt[audience]) ? c.trend.firstListedAt[audience] : null;
    const f = F.rowFeatures(it, { past: pastOf(db, it.id, audience, t), firstListedAt: listed, now: t });
    // (scored on the model's names; logged on every name the features know, whichever model scored it)
    out.push({ id: it.id, p: MODEL.predict(model, F.vectorOf(f, model.names)), eligible: eligible(it, { t, grim: !!(c && c.grim) }), early: !!it.isEarly, rank: it.rank,
      x: F.vectorOf(f, F.NAMES), extras: c ? F.extrasOf(c, t) : {} });
  }
  return out;
}

/** The shadow comparison of one scored list: picks (eligible, p >= theta), the hand rule's Early rows, and both. */
function compare(scored, theta) {
  const picks = new Set(scored.filter((s) => s.eligible && s.p >= theta).map((s) => s.id));
  const hand = new Set(scored.filter((s) => s.early).map((s) => s.id));
  const agree = [...picks].filter((id) => hand.has(id)).length;
  return { n: picks.size, m: hand.size, k: agree, picks, hand };
}

/**
 * One cycle (after FEED.build). lists: { audience: list }; audiences: those published; cycleOf(id); db (read only here); stateDir;
 * points: the US build's candidate records (observePoints), or null; log(line). Returns null when off, else { counts: { n, m, k,
 * modelOnly, handOnly, logged, bytes, source }, scoreOf: (audience, id) -> p | null }. Never throws.
 */
function cycle({ t, lists = {}, audiences = Object.keys(lists), cycleOf = () => null, db = null, stateDir = null, points = null, env = process.env, log = () => {} }) {
  const m = mode(env);
  if (m === 'off') return null;
  try {
    const { model, source } = loadModel(env);
    const scores = {};
    for (const a of audiences) if (lists[a]) scores[a] = scoreList(lists[a].items, { t, audience: a, db, cycleOf, model });
    const home = scores.US ? 'US' : audiences.find((a) => scores[a]);
    const cmp = home ? compare(scores[home], model.theta) : { n: 0, m: 0, k: 0, picks: new Set(), hand: new Set() };
    // (the private log: the home list's rows, every audience's Early tags, and the build's candidates. Numbers and ids; text only
    // for the candidates the gates weighed, which the label step needs to join them)
    const records = [];
    if (home) {
      for (const s of scores[home]) {
        records.push({ t, a: home, id: s.id, rank: s.rank, p: r4(s.p), el: s.eligible ? 1 : 0, early: s.early ? 1 : 0, pick: cmp.picks.has(s.id) ? 1 : 0,
          x: s.x.map(r4), e: s.extras });
      }
      for (const a of audiences) if (a !== home && scores[a]) for (const s of scores[a]) if (s.early) records.push({ t, a, id: s.id, rank: s.rank, early: 1 });
    }
    for (const r of (points && points.records) || []) records.push({ t, a: home || null, pt: r });
    const dir = LOG.dirOf(stateDir, env);
    const w = LOG.append(dir, t, records);
    LOG.prune(dir, t);
    const counts = { n: cmp.n, m: cmp.m, k: cmp.k, modelOnly: cmp.n - cmp.k, handOnly: cmp.m - cmp.k, logged: w.written, bytes: w.bytes, source, mode: m };
    log(`[precursor] would list ${cmp.n} early (hand rule ${cmp.m}), agree ${cmp.k}; model only ${counts.modelOnly}, hand only ${counts.handOnly}; ` +
      `${m}, ${source} weights; logged ${w.written}${w.error ? ' (log not written)' : w.skipped ? ` (${w.skipped} over the day's cap)` : ''}`);
    const byAud = Object.fromEntries(Object.entries(scores).map(([a, xs]) => [a, new Map(xs.map((s) => [s.id, s.p]))]));
    return { counts, mode: m, scoreOf: (a, id) => (byAud[a] && byAud[a].has(id) ? byAud[a].get(id) : null) };
  } catch (e) {
    log(`[precursor] not scored: ${e.message}`);
    return null;
  }
}

/**
 * Act mode's one change: the Early rows of a list, strongest score first (a row with no score keeps its place after the scored ones;
 * ties keep the hand rule's order). rows: the hand rule's Early rows in its order; scoreOf(row) -> p | null. Returns a new array.
 */
function orderEarly(rows, scoreOf) {
  const keyed = (rows || []).map((r, i) => { let p = null; try { p = scoreOf(r); } catch { p = null; } return { r, i, p: Number.isFinite(p) ? p : null }; });
  return keyed.sort((a, b) => (a.p === null) - (b.p === null) || (b.p ?? 0) - (a.p ?? 0) || a.i - b.i).map((x) => x.r);
}

/**
 * The engine's candidates of one build, for the private log: every kept point and 1 in 10 dropped ones. points: every pointOf;
 * keptOf(p): lists()'s verdict; nowMs: the build's clock. Returns { records, kept, dropped, sampled } (never throws: { records: [] }).
 */
function observePoints(points, keptOf, nowMs) {
  try { return PTS.recordsOf(points, keptOf, nowMs); } catch { return { records: [], kept: 0, dropped: 0, sampled: 0 }; }
}

module.exports = { mode, loadModel, usable, eligible, scoreList, compare, cycle, orderEarly, observePoints, DAY0 };
