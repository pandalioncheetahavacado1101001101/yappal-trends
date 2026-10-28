'use strict';
/*
 * The precursor's model (2026-10-31, wave 9 lane precursor): L2-regularised logistic regression on standardised features, fitted by
 * Newton's method (a few dozen features, a few thousand rows: exact and deterministic), then Platt-calibrated on a later slice.
 * Plus the numbers it is judged by: AUC, expected calibration error, and a day bootstrap. Pure JS, zero dependencies, no I/O.
 *
 * A model is plain data: { version, names, mean, scale, w (one per name), b, platt: { a, c }, fitted: { n, positives, ... } }.
 * Weights are bounded (|w| <= W_MAX in standard units) so no single feature can run away, and a refit blends into the weights it
 * replaces (emaBlend) rather than jumping.
 */

const W_MAX = 3;
const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Solves A x = y (A symmetric positive definite, small) by Gaussian elimination with partial pivoting. */
function solve(A, y) {
  const n = y.length;
  const M = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** Column means and scales (a constant column scales by 1). X: [[number]]. */
function standardiser(X) {
  const d = X[0] ? X[0].length : 0;
  const mean = new Array(d).fill(0);
  const scale = new Array(d).fill(1);
  if (!X.length) return { mean, scale };
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
  for (let j = 0; j < d; j++) {
    let v = 0;
    for (const x of X) v += (x[j] - mean[j]) ** 2;
    const sd = Math.sqrt(v / X.length);
    scale[j] = sd > 1e-9 ? sd : 1;
  }
  return { mean, scale };
}

/**
 * Fits w, b minimising the weighted log loss + lambda/2 |w|^2 (the intercept unpenalised). X standardised already. weights: one per
 * row (1 when omitted). Newton steps until the change is tiny. Returns { w, b, iterations }.
 */
function fitLogistic(X, y, { lambda = 1, weights = null, iterations = 50 } = {}) {
  const n = X.length;
  const d = n ? X[0].length : 0;
  let w = new Array(d).fill(0);
  const pos = y.reduce((s, v) => s + v, 0);
  let b = n && pos > 0 && pos < n ? Math.log(pos / (n - pos)) : 0;
  let it = 0;
  for (; it < iterations; it++) {
    const g = new Array(d + 1).fill(0);
    const H = Array.from({ length: d + 1 }, () => new Array(d + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const x = X[i];
      const s = weights ? weights[i] : 1;
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * x[j];
      const p = sigmoid(z);
      const r = s * (p - y[i]);
      const h = s * p * (1 - p);
      for (let j = 0; j < d; j++) {
        g[j] += r * x[j];
        const hx = h * x[j];
        for (let k = 0; k <= j; k++) H[j][k] += hx * x[k];
        H[d][j] += hx;
      }
      g[d] += r;
      H[d][d] += h;
    }
    for (let j = 0; j < d; j++) { g[j] += lambda * w[j]; H[j][j] += lambda; }
    for (let j = 0; j <= d; j++) for (let k = 0; k < j; k++) H[k][j] = H[j][k];
    const step = solve(H, g);
    let moved = 0;
    for (let j = 0; j < d; j++) { w[j] -= step[j]; moved = Math.max(moved, Math.abs(step[j])); }
    b -= step[d];
    moved = Math.max(moved, Math.abs(step[d]));
    if (moved < 1e-7) break;
  }
  w = w.map((v) => clip(v, -W_MAX, W_MAX));
  return { w, b, iterations: it + 1 };
}

/** Platt scaling: p = sigmoid(a * z + c) fitted on raw margins z against y (a 1-feature logistic fit, lightly held to a = 1, c = 0). */
function fitPlatt(z, y) {
  if (!z.length || y.every((v) => v === y[0])) return { a: 1, c: 0 };
  // (Platt's target smoothing: no slice is ever certain)
  const pos = y.reduce((s, v) => s + v, 0);
  const neg = y.length - pos;
  const t = y.map((v) => (v ? (pos + 1) / (pos + 2) : 1 / (neg + 2)));
  let a = 1;
  let c = 0;
  for (let it = 0; it < 100; it++) {
    let ga = 0; let gc = 0; let haa = 1e-6; let hac = 0; let hcc = 1e-6;
    for (let i = 0; i < z.length; i++) {
      const p = sigmoid(a * z[i] + c);
      const r = p - t[i];
      const h = p * (1 - p);
      ga += r * z[i]; gc += r; haa += h * z[i] * z[i]; hac += h * z[i]; hcc += h;
    }
    ga += 0.01 * (a - 1); haa += 0.01; gc += 0.01 * c; hcc += 0.01;
    const det = haa * hcc - hac * hac || 1e-12;
    const da = (hcc * ga - hac * gc) / det;
    const dc = (haa * gc - hac * ga) / det;
    a -= da; c -= dc;
    if (Math.abs(da) + Math.abs(dc) < 1e-9) break;
  }
  return { a, c };
}

/**
 * A model from rows. rows: [{ x: [number] (raw, in `names` order), y: 0|1, w?: weight }]; calibrate: rows the Platt step reads
 * (later than `rows` in time; none: the fit's own rows). Returns the model object.
 */
function train(rows, names, { lambda = 1, calibrate = null, version = 1, meta = {} } = {}) {
  const X = rows.map((r) => r.x);
  const { mean, scale } = standardiser(X);
  const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / scale[j]));
  const y = rows.map((r) => (r.y ? 1 : 0));
  const weights = rows.some((r) => Number.isFinite(r.w)) ? rows.map((r) => (Number.isFinite(r.w) ? r.w : 1)) : null;
  const { w, b, iterations } = fitLogistic(Z, y, { lambda, weights });
  const model = { version, names: [...names], mean, scale, w, b, platt: { a: 1, c: 0 }, fitted: { n: rows.length, positives: y.reduce((s, v) => s + v, 0), lambda, iterations, ...meta } };
  const cal = calibrate && calibrate.length ? calibrate : rows;
  model.platt = fitPlatt(cal.map((r) => margin(model, r.x)), cal.map((r) => (r.y ? 1 : 0)));
  return model;
}

/** The raw margin of one row (before calibration). x: raw features in model.names order. */
function margin(model, x) {
  let z = model.b;
  for (let j = 0; j < model.w.length; j++) z += model.w[j] * ((x[j] - model.mean[j]) / model.scale[j]);
  return z;
}
/** The calibrated probability of one row. */
const predict = (model, x) => sigmoid(model.platt.a * margin(model, x) + model.platt.c);

/** Area under the ROC curve (ties count half). scores, labels: same length. null when one class is missing. */
function auc(scores, labels) {
  const pairs = scores.map((s, i) => ({ s, y: labels[i] ? 1 : 0 })).sort((a, b) => a.s - b.s);
  const pos = pairs.filter((p) => p.y).length;
  const neg = pairs.length - pos;
  if (!pos || !neg) return null;
  let rankSum = 0;
  for (let i = 0; i < pairs.length;) {
    let j = i;
    while (j < pairs.length && pairs[j].s === pairs[i].s) j++;
    const avg = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k].y) rankSum += avg;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Expected calibration error over `bins` equal-width bins, plus the bins themselves ({ lo, n, mean p, observed }). */
function calibration(probs, labels, bins = 10) {
  const out = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, n: 0, p: 0, y: 0 }));
  probs.forEach((p, i) => { const b = out[Math.min(bins - 1, Math.floor(p * bins))]; b.n += 1; b.p += p; b.y += labels[i] ? 1 : 0; });
  const n = probs.length || 1;
  let ece = 0;
  for (const b of out) if (b.n) { ece += (b.n / n) * Math.abs(b.p / b.n - b.y / b.n); b.p /= b.n; b.y /= b.n; }
  return { ece, bins: out.filter((b) => b.n) };
}

/** A seeded generator (mulberry32): the same seed gives the same bootstrap. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/**
 * Day bootstrap: resamples whole days with replacement. groups: [[value]] per day; stat: (values of the drawn days, flattened per
 * day as an array of day arrays) -> number. Returns { lo, hi, mid } at the 2.5% / 97.5% / 50% quantiles over `draws`.
 */
function dayBootstrap(groups, stat, { draws = 2000, seed = 7 } = {}) {
  const next = rng(seed);
  const out = [];
  for (let i = 0; i < draws; i++) {
    const pick = groups.map(() => groups[Math.floor(next() * groups.length)]);
    const v = stat(pick);
    if (Number.isFinite(v)) out.push(v);
  }
  out.sort((a, b) => a - b);
  const q = (f) => (out.length ? out[Math.min(out.length - 1, Math.floor(f * out.length))] : null);
  return { lo: q(0.025), mid: q(0.5), hi: q(0.975), draws: out.length };
}

/**
 * A refit blended into the weights it replaces, in standard units: w = (1 - alpha) w_old + alpha w_new, each held within W_MAX of
 * the day-0 prior. alpha = 1 - 2^(-1/halfLifeDays) a day (7-day half life by default). Both models must share names, mean and
 * scale (the blend keeps the old standardiser: a refit's units are converted). Returns a new model; neither input changes.
 */
function emaBlend(old, fresh, { prior = old, halfLifeDays = 7, days = 1 } = {}) {
  if (!old) return fresh;
  const alpha = 1 - Math.pow(2, -days / halfLifeDays);
  const idx = new Map(fresh.names.map((n, j) => [n, j]));
  // (a fresh weight in the old units: w_old_units = w_fresh * scale_old / scale_fresh)
  const conv = old.names.map((n, j) => { const k = idx.get(n); return k === undefined ? 0 : fresh.w[k] * (old.scale[j] / fresh.scale[k]); });
  const priorW = old.names.map((n) => { const k = prior.names.indexOf(n); return k < 0 ? 0 : prior.w[k]; });
  const w = old.w.map((v, j) => clip((1 - alpha) * v + alpha * conv[j], priorW[j] - W_MAX, priorW[j] + W_MAX));
  // (and its intercept: b_old_units = b_fresh + sum w_fresh (mean_old - mean_fresh) / scale_fresh)
  const bConv = fresh.b + old.names.reduce((s, n, j) => { const k = idx.get(n); return k === undefined ? s : s + fresh.w[k] * ((old.mean[j] - fresh.mean[k]) / fresh.scale[k]); }, 0);
  const b = (1 - alpha) * old.b + alpha * bConv;
  const platt = { a: (1 - alpha) * old.platt.a + alpha * fresh.platt.a, c: (1 - alpha) * old.platt.c + alpha * fresh.platt.c };
  return { ...old, w, b, platt, fitted: { ...fresh.fitted, blended: alpha } };
}

module.exports = { W_MAX, sigmoid, standardiser, fitLogistic, fitPlatt, train, margin, predict, auc, calibration, rng, dayBootstrap, emaBlend, solve };
