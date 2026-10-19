'use strict';
/*
 * Small statistics for the scoreboard: medians, quantiles, rounding, UTC days, and a seeded bootstrap (scoreboard-spec.json
 * lead.bootstrap: the same day always gives the same interval). Pure, zero dependencies.
 */

const HOUR = 3600;
const DAY = 86400;

const round = (x, digits = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** digits) / 10 ** digits : null);
const share = (n, of) => (of > 0 ? round(n / of, 3) : null);

function quantile(values, q) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = (xs.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return xs[lo] + (xs[hi] - xs[lo]) * (at - lo);
}
const median = (values) => quantile(values, 0.5);
const mean = (values) => { const xs = values.filter(Number.isFinite); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };

/** "2026-10-17" -> { start, end } in epoch seconds (UTC). */
function dayBounds(day) {
  const start = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  if (!Number.isFinite(start)) throw new Error('a day is YYYY-MM-DD');
  return { start, end: start + DAY };
}
const dayOfSeconds = (s) => new Date(s * 1000).toISOString().slice(0, 10);
const instant = (s) => new Date(Math.floor(s) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const addDays = (day, n) => dayOfSeconds(dayBounds(day).start + n * DAY);

/** FNV-1a, 32 bits: the bootstrap's seed from the scored day. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** mulberry32: a small seeded generator in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap of `stat` over `values`: [low, high] at `level`, or null with fewer than two values. Resamples with replacement,
 * `resamples` times, from a generator seeded with `seed`.
 */
function bootstrap(values, stat, { resamples, level, seed }) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const next = rng(seed);
  const out = new Array(resamples);
  const pick = new Array(xs.length);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < xs.length; i++) pick[i] = xs[Math.floor(next() * xs.length)];
    out[b] = stat(pick);
  }
  const tail = (1 - level) / 2;
  return [quantile(out, tail), quantile(out, 1 - tail)];
}

module.exports = { HOUR, DAY, round, share, quantile, median, mean, dayBounds, dayOfSeconds, instant, addDays, fnv1a, rng, bootstrap };
