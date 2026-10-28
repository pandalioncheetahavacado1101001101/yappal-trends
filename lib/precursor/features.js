'use strict';
/*
 * The precursor's features (2026-10-31, wave 9 lane precursor; ios/.review/learn/2026-10-30-5x-plan.md L1). One vector per listed
 * row per audience per cycle, from what is known at that cycle only: the row as the list publishes it (kind, tier, heat, rank,
 * status, start, demand) and the row's own earlier ranks and heats in the same audience. The same code reads a live cycle and an
 * archived list, so a model fitted on the archive scores the runner's rows with the very same numbers.
 *
 * GROUPS: `gt` marks a feature Google Trends' own numbers move (a search's size, and heat, which weighs searches in). A model fitted
 * to a Google Trends label never reads those (no GT-derived feature for a GT label). Pure: no clock, no I/O, never a name.
 */

const HOUR = 3600;
const AGE_CAP_H = 168;
const LISTED_CAP_H = 24;

// (in this order in every vector; a refit may add names only at the end)
const FEATURES = [
  { name: 'talk' }, { name: 'moment' }, { name: 'word' }, { name: 'sound' },
  { name: 'drama' },
  { name: 'creator' }, { name: 'celebrity' }, { name: 'politics' }, { name: 'sports' },
  { name: 'sensitive' }, { name: 'grave' },
  { name: 'heat', gt: true }, { name: 'heatMax', gt: true }, { name: 'heatRise', gt: true },
  { name: 'logRank' }, { name: 'onPage' }, { name: 'bestLogRank' }, { name: 'rankRise' },
  { name: 'listedH' }, { name: 'ageLog' }, { name: 'byHour' }, { name: 'noStart' },
  { name: 'rising' }, { name: 'fading' }, { name: 'measured' },
  { name: 'spike' }, { name: 'flare' }, { name: 'film' },
  { name: 'searchLog', gt: true }, { name: 'charted' },
  { name: 'people' }, { name: 'card' }, { name: 'modelLine' },
];
const NAMES = FEATURES.map((f) => f.name);
const GT_DERIVED = new Set(FEATURES.filter((f) => f.gt).map((f) => f.name));

const num = (x) => (Number.isFinite(x) ? x : null);
const seconds = (iso) => { const ms = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const flag = (b) => (b ? 1 : 0);

/**
 * The vector of one published row. item: the list's item (D3 shape: kind, sub, tier, drama, heat, rank, status, statusMeasured,
 * startedAt, startedPrecision, demand, spike, flareAt, filmWithin24h, people, sensitive, sensitiveWhy, editor, lineWrittenBy).
 * past: the same row's earlier readings in the same audience, [{ t, rank, heat }] with t < now (any order). firstListedAt: seconds,
 * the first time this audience listed it (null: now). now: seconds. Returns an object { name: number } over NAMES.
 */
function rowFeatures(item, { past = [], firstListedAt = null, now }) {
  const it = item || {};
  const earlier = (past || []).filter((p) => p && Number.isFinite(p.t) && p.t < now).sort((a, b) => a.t - b.t);
  const rank = Number.isFinite(it.rank) && it.rank > 0 ? it.rank : 80;
  const heat = num(it.heat) ?? 0;
  const hourAgo = earlier.filter((p) => p.t <= now - HOUR + 300).pop() || earlier[0] || null;
  const ranks = [rank, ...earlier.map((p) => p.rank).filter((r) => Number.isFinite(r) && r > 0)];
  const heats = [heat, ...earlier.map((p) => p.heat).filter(Number.isFinite)];
  const started = seconds(it.startedAt);
  const listedAt = Number.isFinite(firstListedAt) ? Math.min(firstListedAt, now) : now;
  const ageH = started !== null ? clip((now - started) / HOUR, 0, AGE_CAP_H) : null;
  const demand = it.demand && typeof it.demand === 'object' ? it.demand : null;
  const search = demand && demand.kind === 'search' && Number.isFinite(demand.value) && demand.value > 0 ? demand.value : 0;
  const why = String(it.sensitiveWhy || '');
  return {
    talk: flag(it.kind === 'talk'), moment: flag(it.kind === 'moment'), word: flag(it.kind === 'word'), sound: flag(it.kind === 'sound'),
    drama: flag(!!it.drama),
    creator: flag(it.tier === 'creator'), celebrity: flag(it.tier === 'celebrity'), politics: flag(it.tier === 'politics'), sports: flag(it.tier === 'sports'),
    sensitive: flag(!!it.sensitive), grave: flag(/death|crime/.test(why)),
    heat: heat / 100, heatMax: Math.max(...heats) / 100, heatRise: hourAgo && Number.isFinite(hourAgo.heat) ? clip((heat - hourAgo.heat) / 20, -2, 2) : 0,
    logRank: Math.log(rank), onPage: flag(rank <= 20), bestLogRank: Math.log(Math.min(...ranks)),
    rankRise: hourAgo && Number.isFinite(hourAgo.rank) && hourAgo.rank > 0 ? clip(Math.log(hourAgo.rank / rank), -2, 2) : 0,
    listedH: clip((now - listedAt) / HOUR, 0, LISTED_CAP_H) / LISTED_CAP_H,
    ageLog: ageH !== null ? Math.log1p(ageH) / Math.log1p(AGE_CAP_H) : 1, byHour: flag(it.startedPrecision === 'hour'), noStart: flag(started === null),
    rising: flag(it.status === 'rising'), fading: flag(it.status === 'fading'), measured: flag(!!it.statusMeasured),
    spike: flag(!!it.spike), flare: flag(!!it.flareAt), film: flag(!!it.filmWithin24h),
    searchLog: search ? clip(Math.log10(search) - 3, 0, 3) / 3 : 0, charted: flag(!!demand && demand.kind === 'listed'),
    people: clip(Array.isArray(it.people) ? it.people.length : 0, 0, 3) / 3, card: flag(!!it.editor), modelLine: flag(it.lineWrittenBy === 'model'),
  };
}

/** An object of features as an array in NAMES order (a missing name reads 0). */
const vectorOf = (f, names = NAMES) => names.map((n) => (Number.isFinite(f[n]) ? f[n] : 0));

/**
 * The live-only readings a refit may learn from once the private log holds them (never read by the day-0 model): the trend's
 * kinds of source and how far apart they came, headlines in the last hour and day, outlets, its own climb. c: the cycle's trend
 * (lib/history.js step). Numbers only.
 */
function extrasOf(c, now) {
  if (!c || typeof c !== 'object') return {};
  const kf = (c.info && c.info.kindFirst) || {};
  const times = Object.values(kf).filter((x) => Number.isFinite(x) && x <= now).sort((a, b) => a - b);
  const m = c.measure || {};
  const last = Array.isArray(c.series) && c.series.length ? c.series[c.series.length - 1] : {};
  const fin = (x) => (Number.isFinite(x) ? x : null);
  return {
    families: times.length,
    firstGapH: times.length >= 2 ? Math.round((times[1] - times[0]) / 36) / 100 : null,
    firstH: times.length ? Math.round((now - times[0]) / 36) / 100 : null,
    n1: fin(last.n1), n24: fin(last.n24), outlets: fin(last.outlets), wiki: fin(last.wiki), rd: fin(last.rd), cr: fin(last.cr),
    ytH: fin(last.ytH), ttVideos: fin(last.ttVideos), soc: fin(last.soc),
    v: fin(m.v), v1: fin(m.v1), climbing: m.climbing === true ? 1 : m.climbing === false ? 0 : null,
  };
}

module.exports = { FEATURES, NAMES, GT_DERIVED, rowFeatures, vectorOf, extrasOf, seconds };
