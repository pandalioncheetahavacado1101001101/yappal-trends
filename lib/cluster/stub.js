'use strict';
/*
 * A deterministic stand-in for an embedding model (ios/IDEAS-SUPER.md P8): every word, and its three-letter pieces at a lower weight,
 * hashed into `dims` signed buckets, then made a unit vector. Lexical, not semantic: two texts are close when they share words, which
 * is what the rules already see. Tests run the clustering on it with no model and no network, and a bench run on it measures the
 * clustering's own logic; what only a real model can add (paraphrase, "booking photo" near "mugshot") it cannot show.
 *
 * Same text, same vector, on every machine: FNV-1a over the word, no randomness, no clock.
 */
const V = require('./vec');

const DIMS = 256;
const GRAM_WEIGHT = 0.35;
const STOP = new Set(('a an the and or but of to in on at for with by from as is are was were be been being it its this that these those '
  + 'his her their our your my he she they we you i after over into about up out new says said say just than then so not no').split(' '));

/** FNV-1a, 32 bits, of a string's UTF-16 units. */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Lower-case words without accents, an "s" plural folded ("stories" stays, "streams" is "stream"); stop words gone. */
function tokens(text) {
  const plain = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]s\b/g, '').replace(/['’]/g, '');
  return plain.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** One text's vector. weightOf(token): an optional weight (a corpus IDF, say); 1 for every word when absent. */
function vectorOf(text, { dims = DIMS, gramWeight = GRAM_WEIGHT, weightOf = null } = {}) {
  const v = new Float32Array(dims);
  const add = (key, w) => { const h = fnv(key); v[h % dims] += (h & 0x80000000 ? -1 : 1) * w; };
  for (const tok of tokens(text)) {
    const w = weightOf ? weightOf(tok) : 1;
    if (!(w > 0)) continue;
    add(`w:${tok}`, w);
    const padded = `#${tok}#`;
    const grams = Math.max(1, padded.length - 2);
    for (let i = 0; i + 3 <= padded.length; i++) add(`g:${padded.slice(i, i + 3)}`, (gramWeight * w) / grams);
  }
  return V.unit(v);
}

/** The stand-in as an embedder: { model, dims, embed(texts) -> unit vectors (null for a text with no word) }. */
function stubEmbedder({ dims = DIMS, gramWeight = GRAM_WEIGHT, weightOf = null, model = 'stub-hash' } = {}) {
  return { model, dims, async embed(texts) { return texts.map((t) => vectorOf(t, { dims, gramWeight, weightOf })); } };
}

module.exports = { stubEmbedder, vectorOf, tokens, fnv, STOP };
