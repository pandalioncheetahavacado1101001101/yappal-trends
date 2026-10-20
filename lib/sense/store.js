'use strict';
/*
 * The word-sense file (lib/data/word-senses.json, CC BY-SA 4.0: word-senses.LICENCE.md beside it), read once a process and only
 * when a word row needs it. A row's word is looked up by its forms (lib/sense/text.js formsOf): its own senses in the dictionary's
 * order, then the slang senses of its lemma ("glazing" -> glaze).
 */
const fs = require('node:fs');
const path = require('node:path');
const T = require('./text');

const FILE = path.join(__dirname, '..', 'data', 'word-senses.json');
const LEMMA_KINDS = new Set(['slang', 'Internet', 'neologism', 'informal']);
const PREFIX_MIN = 20;

/** A packed sense ([kind, firstYear, label, gloss, pos]) as the picker reads it. */
const unpack = (p) => ({ kind: p[0], year: Number.isFinite(p[1]) ? p[1] : null, label: p[2] || '', gloss: p[3] ?? null, pos: p[4] || null });

/** A data file's contents as { words: Map, aliases: Map } (a parsed file, or one handed in by a test). */
function index(doc) {
  return { words: new Map(Object.entries((doc && doc.words) || {})), aliases: new Map(Object.entries((doc && doc.aliases) || {})), built: (doc && doc.from) || null };
}
let cached = null;
/** The shipped file, read once. */
function load(file = FILE) {
  if (cached && cached.file === file) return cached.data;
  const data = index(JSON.parse(fs.readFileSync(file, 'utf8')));
  cached = { file, data };
  return data;
}

/**
 * The senses for the first of `forms` the file knows: { form, senses, own } (own: how many are the word's own, the rest its
 * lemma's), or null when it knows none.
 */
function sensesOf(data, forms) {
  for (const f of forms || []) {
    const own = (data.words.get(f) || []).map(unpack);
    const lemma = (data.aliases.get(f) || []).filter((L) => L !== f).flatMap((L) => (data.words.get(L) || []).map(unpack).filter((s) => LEMMA_KINDS.has(s.kind)));
    if (own.length || lemma.length) return { form: f, senses: [...own, ...lemma], own: own.length };
  }
  return null;
}

/** Whether a line is one of the word's own dictionary senses, as a reader would have printed it (the line read live, or an older one). */
function isGlossOf(data, forms, line) {
  const k = T.termKey(String(line || '').replace(/[.…]+$/, ''));
  if (!k) return false;
  const hit = sensesOf(data, forms);
  // (the same words, or one cut short of the other: a reader cuts a long sense at a clause)
  const same = (g) => g === k || (Math.min(g.length, k.length) >= PREFIX_MIN && (g.startsWith(k) || k.startsWith(g)));
  return !!hit && hit.senses.some((s) => s.gloss && same(T.termKey(s.gloss)));
}

module.exports = { FILE, load, index, sensesOf, isGlossOf, unpack };
