'use strict';
/*
 * Vector arithmetic for story clustering (ios/IDEAS-SUPER.md P8): unit vectors as Float32Array, cosine as a dot product,
 * Matryoshka truncation (the first `dims` numbers of a nomic-style vector, renormalised) and int8 storage for the 14-day cache.
 * Pure: no I/O, no clock.
 */

/** The dot product of two vectors of one length. */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** A unit vector in the direction of `v` (a copy), or null when `v` is empty, all zeros or holds a number that is not finite. */
function unit(v) {
  if (!v || !v.length) return null;
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) return null;
    s += x * x;
  }
  if (s <= 0) return null;
  const n = Math.sqrt(s);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Cosine of two unit vectors (their dot product); 0 when either is missing or the lengths differ. */
const cosine = (a, b) => (a && b && a.length === b.length ? dot(a, b) : 0);

/** The first `dims` numbers of a vector, renormalised (Matryoshka truncation). A vector already that short is only renormalised. */
function truncate(v, dims) {
  if (!v) return null;
  if (!dims || v.length <= dims) return unit(v);
  return unit(Array.prototype.slice.call(v, 0, dims));
}

/**
 * The weighted mean direction of unit vectors: a unit vector, or null when there are none. weights: one number a vector (1 each by
 * default); a story's centroid weighs each distinct text once, so a wire story printed a hundred times does not pull it.
 */
function centroid(vectors, weights = null) {
  const first = vectors.find(Boolean);
  if (!first) return null;
  const sum = new Float32Array(first.length);
  vectors.forEach((v, k) => {
    if (!v) return;
    const w = weights ? weights[k] : 1;
    for (let i = 0; i < v.length; i++) sum[i] += w * v[i];
  });
  return unit(sum);
}

/** A unit vector as int8 (127 is 1.0): a quarter of the bytes; cosine moves by under 0.01 at 256 numbers. */
function toInt8(v) {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  return out;
}
/** Back from int8 to a unit vector. */
function fromInt8(q) {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / 127;
  return unit(out);
}

module.exports = { dot, unit, cosine, truncate, centroid, toInt8, fromInt8 };
