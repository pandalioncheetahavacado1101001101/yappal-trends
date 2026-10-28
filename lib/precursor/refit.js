'use strict';
/*
 * The precursor's daily label join, judgement and refit (2026-10-31, wave 9 lane precursor; run by the scoreboard's step,
 * scoreboard-steps/precursor.js, and on the VM by its learn job). Pure: the caller reads the private log and the comparators and
 * writes the result; nothing here touches a file or the network.
 *
 *   examples   one per logged row per decision time: its first logged cycle + 0, 1, 2 and 4 hours, with what was logged then
 *   labels     graded, from comparator entries the caller joins to our rows with the scoreboard's own matcher (match.js, read only):
 *              Google Trends (US/GB/AU/CA, not sport, 2K+: tier 1, 20K+: 2, 100K+: 3), Know Your Meme, the Viral 50, and when the VM
 *              holds them the virality truth's verdicts (proven: tier 3). An entry labels a row when it surfaced inside 48 h before to
 *              24 h after the decision. Never a feature Google Trends' numbers move for a Google Trends label (features.GT_DERIVED).
 *   judge      a day's picks at the SAME Early budget as the hand rule (the rows it tagged that day), by the refit and by the frozen
 *              day-0 twin, and K = 4, 8 against the list's own order: positives and "first" (picked before the entry surfaced)
 *   promote    over the last 14 judged days with 60+ positives in the pools, the day-bootstrap lower 95% bound of (refit first - hand
 *              rule first) at the same budget above 0. Weights bounded (model.W_MAX around the day-0 prior) and blended (7-day EMA).
 * Output is counts and weights: no id, title or time of a row ever leaves this module's caller's memory.
 */
const F = require('./features');
const M = require('./model');

const HOUR = 3600;
const DAY = 86400;
const DECISION_H = [0, 1, 2, 4];
const NEAR = 45 * 60;
const LABEL_BEFORE_H = 48;
const LABEL_AFTER_H = 24;
const SPORT = 17;
const TIERS = [[100000, 3], [20000, 2], [2000, 1]];
const PROMOTE_DAYS = 14;
const PROMOTE_POSITIVES = 60;
const KS = [4, 8];

const dayOf = (t) => new Date(t * 1000).toISOString().slice(0, 10);

/** The day-0 prior seen through a narrower set of names (a Google Trends learner never reads GT_DERIVED): the same weights, those left out. */
function project(model, names) {
  const idx = names.map((n) => model.names.indexOf(n));
  if (idx.some((i) => i < 0)) throw new Error('a name the prior lacks');
  return { ...model, names: [...names], mean: idx.map((i) => model.mean[i]), scale: idx.map((i) => model.scale[i]), w: idx.map((i) => model.w[i]) };
}
const safeNames = (names) => names.filter((n) => !F.GT_DERIVED.has(n));

/**
 * Examples from the log's home-list records ({ t, a, id, rank, p, el, early, pick, x }), one per id per decision time. names: the
 * names the logged x follows (the shipped model's). Returns [{ id, k, tau, day, x (object by name), el, early, pick, rank, p0,
 * handAt (first tagged Early), pickAt (first picked) }].
 */
function examplesOf(records, names) {
  const byId = new Map();
  for (const r of records || []) {
    if (!r || !r.id || !Array.isArray(r.x) || !Number.isFinite(r.t)) continue;
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }
  const out = [];
  for (const [id, rs] of byId) {
    rs.sort((a, b) => a.t - b.t);
    const L = rs[0].t;
    const handAt = (rs.find((r) => r.early) || {}).t ?? null;
    const pickAt = (rs.find((r) => r.pick) || {}).t ?? null;
    for (const k of DECISION_H) {
      const tau = L + k * HOUR;
      let at = null;
      for (const r of rs) { if (r.t <= tau) at = r; else break; }
      if (!at || tau - at.t > NEAR) continue;
      const x = Object.fromEntries(names.map((n, j) => [n, Number.isFinite(at.x[j]) ? at.x[j] : 0]));
      out.push({ id, k, tau: at.t, day: dayOf(at.t), x, el: !!at.el, early: !!at.early, pick: !!at.pick, rank: at.rank, p0: at.p, handAt, pickAt });
    }
  }
  return out;
}

const tierOf = (v) => { for (const [min, tier] of TIERS) if (v >= min) return tier; return 0; };
/** Whether a Google Trends entry counts for a label: not sport, 2K+ (the volume read), and dated. */
const gtCounts = (e) => Number.isFinite(e.own) && (e.volume || 0) >= TIERS[TIERS.length - 1][0] && !(e.categories || []).includes(SPORT);

/**
 * Labels examples from joined entries. joins: [{ id (our trend id), own (when it surfaced, s), tier (1-3), comparator }] (the caller's
 * match.js join). Returns new examples with { y (0/1), tier, firstAt (the earliest joined entry's surface in the window) }.
 */
function label(examples, joins) {
  const byId = new Map();
  for (const j of joins || []) { if (!j || !j.id || !Number.isFinite(j.own)) continue; if (!byId.has(j.id)) byId.set(j.id, []); byId.get(j.id).push(j); }
  return examples.map((e) => {
    const hits = (byId.get(e.id) || []).filter((j) => j.own >= e.tau - LABEL_BEFORE_H * HOUR && j.own <= e.tau + LABEL_AFTER_H * HOUR);
    const tier = hits.reduce((m, j) => Math.max(m, j.tier || 1), 0);
    return { ...e, y: hits.length ? 1 : 0, tier, firstAt: hits.length ? Math.min(...hits.map((j) => j.own)) : null };
  });
}

/** Entries of the comparators as joinable labels: Google Trends with its tier, the others tier 1 (the truth's proven: tier 3). */
function joinsOf(entries, matchOf) {
  const out = [];
  for (const e of entries || []) {
    if (!e) continue;
    if (e.comparator === 'gt' && !gtCounts(e)) continue;
    let id = null;
    try { id = matchOf(e); } catch { id = null; }
    if (!id) continue;
    out.push({ id, own: e.own, comparator: e.comparator, tier: e.comparator === 'gt' ? tierOf(e.volume || 0) : e.comparator === 'truth' ? 3 : 1 });
  }
  return out;
}

const scorer = (model) => (e) => M.predict(model, model.names.map((n) => e.x[n] ?? 0));

/**
 * One rule's picks of a day: the `budget` distinct rows with the best score among the day's eligible examples, each picked at its
 * first decision time that reached the threshold (the budget-th best). Returns Map(id -> example at pick).
 */
function picksOf(exs, score, budget) {
  if (budget <= 0) return new Map();
  const best = new Map();
  for (const e of exs) { if (!e.el) continue; const s = score(e); if (!best.has(e.id) || s > best.get(e.id)) best.set(e.id, s); }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, budget);
  if (!ranked.length) return new Map();
  const cut = ranked[ranked.length - 1][1];
  const chosen = new Set(ranked.map(([id]) => id));
  const out = new Map();
  for (const e of [...exs].sort((a, b) => a.tau - b.tau)) if (chosen.has(e.id) && !out.has(e.id) && e.el && score(e) >= cut) out.set(e.id, e);
  return out;
}
/** Positives and firsts of a pick set (an id once: its label at the pick). */
function tally(picks) {
  let pos = 0; let first = 0;
  for (const e of picks.values()) { if (e.y) { pos += 1; if (Number.isFinite(e.firstAt) && e.tau <= e.firstAt) first += 1; } }
  return { n: picks.size, pos, first };
}

/**
 * One day's judgement (counts only). exs: the day's labelled examples; refit, twin: models; Returns { day, examples, pool (distinct
 * eligible ids), poolPos (of them labelled), budget (the hand rule's distinct Early rows that day), hand, refit, twin, k4, k8 }.
 */
function judgeDay(day, exs, { refit, twin }) {
  const sr = scorer(refit); const st = scorer(twin);
  // (the hand rule's picks: every row it first tagged Early that day, at the cycle it did, whenever that was; the model only gets
  // its four decision times, so the comparison leans the hand rule's way)
  const hand = new Map();
  for (const e of [...exs].sort((a, b) => a.tau - b.tau)) {
    const at = Number.isFinite(e.handAt) ? e.handAt : e.early ? e.tau : null;
    if (at === null || dayOf(at) !== day || hand.has(e.id)) continue;
    const near = exs.filter((x) => x.id === e.id && x.tau <= at).sort((a, b) => b.tau - a.tau)[0] || e;
    hand.set(e.id, { ...near, tau: at });
  }
  const pool = new Map();
  for (const e of exs) if (e.el && (!pool.has(e.id) || e.y)) pool.set(e.id, e);
  const budget = hand.size;
  const out = { day, examples: exs.length, pool: pool.size, poolPos: [...pool.values()].filter((e) => e.y).length, budget,
    hand: tally(hand), refit: tally(picksOf(exs, sr, budget)), twin: tally(picksOf(exs, st, budget)) };
  for (const K of KS) out[`k${K}`] = { refit: tally(picksOf(exs, sr, K)), twin: tally(picksOf(exs, st, K)), list: tally(picksOf(exs, (e) => -(e.rank || 99), K)) };
  return out;
}

/**
 * The promotion rule over judged days (newest last): the last PROMOTE_DAYS, PROMOTE_POSITIVES or more pool positives, and the
 * day-bootstrap lower 95% bound of sum(refit first - hand first) above 0. Also the compounding check: days the refit beat the twin at
 * K = 8. Returns { days, positives, gain: { lo, mid, hi }, promote (bool), why, refitBeatTwin, twinBeatRefit }.
 */
function promotion(judged, { seed = 7 } = {}) {
  const last = (judged || []).slice(-PROMOTE_DAYS);
  const positives = last.reduce((s, d) => s + (d.poolPos || 0), 0);
  const gain = last.length ? M.dayBootstrap(last, (ds) => ds.reduce((s, d) => s + d.refit.first - d.hand.first, 0), { seed }) : { lo: null, mid: null, hi: null };
  const refitBeatTwin = last.filter((d) => d.k8 && d.k8.refit.pos > d.k8.twin.pos).length;
  const twinBeatRefit = last.filter((d) => d.k8 && d.k8.refit.pos < d.k8.twin.pos).length;
  const why = last.length < PROMOTE_DAYS ? `${last.length} of ${PROMOTE_DAYS} days` : positives < PROMOTE_POSITIVES ? `${positives} of ${PROMOTE_POSITIVES} positives` :
    !(gain.lo > 0) ? 'the lower bound does not beat the hand rule' : 'holds';
  return { days: last.length, positives, gain: { lo: gain.lo, mid: gain.mid, hi: gain.hi }, promote: why === 'holds', why, refitBeatTwin, twinBeatRefit };
}

/**
 * The next weights: a fit on the labelled examples (names: the learner's), blended into the previous weights (7-day EMA), held near
 * the prior. Returns the previous model unchanged when the examples hold too few positives or negatives (MIN_EACH).
 */
const MIN_EACH = 20;
function refit(examples, { names, prior, previous = null, lambda = 10, theta = prior.theta }) {
  const rows = examples.filter((e) => e.y === 0 || e.y === 1).map((e) => ({ x: names.map((n) => e.x[n] ?? 0), y: e.y, day: e.day }));
  const pos = rows.filter((r) => r.y).length;
  if (pos < MIN_EACH || rows.length - pos < MIN_EACH) return { model: previous || prior, fitted: false, n: rows.length, positives: pos };
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const cal = days.length >= 3 ? days[days.length - 1] : null;
  const fresh = M.train(cal ? rows.filter((r) => r.day < cal) : rows, names, { lambda, calibrate: cal ? rows.filter((r) => r.day === cal) : null });
  const blended = M.emaBlend(previous || prior, fresh, { prior, halfLifeDays: 7, days: 1 });
  return { model: { ...blended, theta }, fitted: true, n: rows.length, positives: pos };
}

module.exports = { LOGGED_NAMES: F.NAMES, DECISION_H, PROMOTE_DAYS, PROMOTE_POSITIVES, LABEL_BEFORE_H, LABEL_AFTER_H, project, safeNames, examplesOf, label, joinsOf, gtCounts, tierOf, picksOf, tally,
  judgeDay, promotion, refit, dayOf };
