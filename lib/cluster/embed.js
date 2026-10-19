'use strict';
/*
 * The embedder behind an interface (ios/IDEAS-SUPER.md P8). Clustering never knows where vectors come from: it is handed
 * `embed(texts) -> unit vectors`, one a text, in order. Three makers here:
 *
 *   ollamaEmbedder({ model })        a model served on this machine or the runner by Ollama: POST /api/embed, in batches. No key.
 *   cachedEmbedder(inner, { cache }) only texts missing from a 14-day cache are asked; every vector is cut to `dims` (Matryoshka)
 *                                    and kept as int8, so a cached and a fresh vector of one text are the same numbers
 *   embedWithin(embedder, texts, ms) the vectors, or null and why: a slow or failed model never fails a cycle, the rules stand
 *
 * The cache is the collector's private state (never published: it is per-text, so per-trend). It is model-bound: a cache made by
 * another model or at another size is dropped whole, never mixed.
 */
const crypto = require('node:crypto');
const V = require('./vec');

const DEFAULT_BASE = 'http://127.0.0.1:11434';
const BATCH = 64;
const TIMEOUT_MS = 60000;
const CACHE_DAYS = 14;
const DIMS = 256;
const DAY_MS = 86400000;
const HASH_BYTES = 12;
const MAGIC = 'YPE1';

/** The task prefix a model was trained with: nomic-embed-text reads "clustering: " before a text to cluster; others take it bare. */
const prefixFor = (model, task = 'clustering') => (/nomic-embed/i.test(String(model || '')) ? `${task}: ` : '');
/** A text as embedded and as cached: trimmed, one space between words. */
const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/**
 * One model served by Ollama. Every reply is checked: one finite, non-zero vector a text, all of one length, or the batch fails.
 * fetchImpl: the fetch to use (tests hand in their own).
 */
function ollamaEmbedder({ base = DEFAULT_BASE, model, batch = BATCH, timeoutMs = TIMEOUT_MS, task = 'clustering', keepAlive = '30m', fetchImpl = globalThis.fetch } = {}) {
  if (!model) throw new Error('ollamaEmbedder: no model named');
  if (typeof fetchImpl !== 'function') throw new Error('ollamaEmbedder: no fetch');
  const prefix = prefixFor(model, task);
  async function one(texts) {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/api/embed`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: texts.map((t) => prefix + clean(t)), keep_alive: keepAlive, truncate: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`embed: HTTP ${res.status}`);
    const reply = await res.json();
    const raw = reply && Array.isArray(reply.embeddings) ? reply.embeddings : null;
    if (!raw || raw.length !== texts.length) throw new Error(`embed: ${raw ? raw.length : 'no'} vectors for ${texts.length} texts`);
    const out = raw.map((e) => (Array.isArray(e) ? V.unit(e) : null));
    if (out.some((v) => !v) || out.some((v) => v.length !== out[0].length)) throw new Error('embed: a vector is empty, zero or of another length');
    return out;
  }
  return {
    model,
    async embed(texts) {
      const out = [];
      for (let i = 0; i < texts.length; i += batch) out.push(...await one(texts.slice(i, i + batch)));
      return out;
    },
  };
}

/** A new, empty cache for one model at one size. */
const newCache = (model, dims = DIMS) => ({ model: String(model), dims, rows: new Map() });
/** The cache key of a text: the first 12 bytes of its sha256, as hex (the text itself is never kept). */
const keyOf = (text) => crypto.createHash('sha256').update(clean(text)).digest().subarray(0, HASH_BYTES).toString('hex');
/** Days since 1970 (the cache dates a row by the day it was last used). */
const dayOf = (ms) => Math.floor(ms / DAY_MS);

/**
 * Wraps an embedder: texts the cache holds are answered from it (and dated today), the rest are asked once each, cut to `dims`,
 * stored as int8 and answered from what was stored. Returns { model, dims, embed(texts), stats() } where stats is
 * { hits, asked, ms } summed over calls. now: the clock (ms) for the day a row is dated.
 */
function cachedEmbedder(inner, { cache = null, dims = DIMS, now = () => Date.now() } = {}) {
  const store = cache && cache.model === inner.model && cache.dims === dims ? cache : newCache(inner.model, dims);
  const stats = { hits: 0, asked: 0, ms: 0 };
  return {
    model: inner.model, dims, cache: store,
    stats: () => ({ ...stats }),
    async embed(texts) {
      const today = dayOf(now());
      const keys = texts.map(keyOf);
      const missing = new Map();
      keys.forEach((k, i) => { if (!store.rows.has(k) && !missing.has(k)) missing.set(k, clean(texts[i])); });
      stats.hits += texts.length - missing.size; // (a text twice in one call is asked once: the second is a hit)
      if (missing.size) {
        const started = Date.now();
        const fresh = await inner.embed([...missing.values()]);
        stats.ms += Date.now() - started;
        stats.asked += missing.size;
        [...missing.keys()].forEach((k, i) => {
          const v = V.truncate(fresh[i], dims);
          if (v) store.rows.set(k, { q: V.toInt8(v), day: today });
        });
      }
      return keys.map((k) => {
        const row = store.rows.get(k);
        if (!row) return null;
        if (row.day !== today) store.rows.set(k, { q: row.q, day: today });
        return V.fromInt8(row.q);
      });
    },
  };
}

/** The cache without rows unused for `days` days (a new cache object; the old one is left as it was). */
function pruneCache(cache, nowMs, days = CACHE_DAYS) {
  const floor = dayOf(nowMs) - days;
  const out = newCache(cache.model, cache.dims);
  for (const [k, row] of cache.rows) if (row.day > floor) out.rows.set(k, { q: row.q, day: row.day });
  return out;
}

/** The cache as bytes: "YPE1", the model's name, the size, then a row each (12-byte key, 2-byte day, `dims` int8 numbers). */
function cacheToBuffer(cache) {
  const model = Buffer.from(cache.model, 'utf8');
  const head = Buffer.alloc(4 + 2 + model.length + 2 + 4);
  let o = head.write(MAGIC, 0, 'latin1');
  o = head.writeUInt16LE(model.length, o);
  o += model.copy(head, o);
  o = head.writeUInt16LE(cache.dims, o);
  head.writeUInt32LE(cache.rows.size, o);
  const rowBytes = HASH_BYTES + 2 + cache.dims;
  const body = Buffer.alloc(rowBytes * cache.rows.size);
  let p = 0;
  for (const [k, row] of cache.rows) {
    Buffer.from(k, 'hex').copy(body, p);
    body.writeUInt16LE(Math.max(0, Math.min(65535, row.day)), p + HASH_BYTES);
    Buffer.from(row.q.buffer, row.q.byteOffset, row.q.byteLength).copy(body, p + HASH_BYTES + 2);
    p += rowBytes;
  }
  return Buffer.concat([head, body]);
}

/** Bytes back to a cache, or null when they are not one (a truncated or foreign file reads as no cache, never as a wrong one). */
function cacheFromBuffer(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 12 || buf.toString('latin1', 0, 4) !== MAGIC) return null;
    let o = 4;
    const ml = buf.readUInt16LE(o); o += 2;
    const model = buf.toString('utf8', o, o + ml); o += ml;
    const dims = buf.readUInt16LE(o); o += 2;
    const n = buf.readUInt32LE(o); o += 4;
    const rowBytes = HASH_BYTES + 2 + dims;
    if (!dims || buf.length !== o + n * rowBytes) return null;
    const cache = newCache(model, dims);
    for (let i = 0; i < n; i++) {
      const p = o + i * rowBytes;
      const k = buf.toString('hex', p, p + HASH_BYTES);
      const day = buf.readUInt16LE(p + HASH_BYTES);
      const q = new Int8Array(dims);
      for (let j = 0; j < dims; j++) q[j] = buf.readInt8(p + HASH_BYTES + 2 + j);
      cache.rows.set(k, { q, day });
    }
    return cache;
  } catch { return null; }
}

/**
 * The vectors of `texts` within `ms` milliseconds: { vectors, ms } or { vectors: null, error, ms }. Never throws: the caller keeps
 * the rules' stories when the model is slow, missing or wrong.
 */
async function embedWithin(embedder, texts, ms) {
  const started = Date.now();
  let timer = null;
  try {
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no vectors within ${ms} ms`)), ms); });
    const vectors = await Promise.race([embedder.embed(texts), late]);
    if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('the embedder gave a vector count that is not the text count');
    return { vectors, ms: Date.now() - started };
  } catch (e) {
    return { vectors: null, error: e && e.message ? e.message : String(e), ms: Date.now() - started };
  } finally { clearTimeout(timer); }
}

module.exports = { ollamaEmbedder, cachedEmbedder, newCache, pruneCache, cacheToBuffer, cacheFromBuffer, embedWithin, prefixFor, keyOf, clean, DIMS, CACHE_DAYS };
