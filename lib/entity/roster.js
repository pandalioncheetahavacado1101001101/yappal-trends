'use strict';
/*
 * The entity roster as the collector reads it (P14, B2): public figures from Wikidata (CC0 1.0), built from
 * scripts/build-data/entity-roster.json by lib/entity/build-roster.js into one small binary file, lib/data/entity-roster.bin, so a
 * cycle loads it in milliseconds (the 20 MB JSON takes about a second to parse and index, and 200 MB of heap). No name is held
 * as text: a name is looked up by the first bytes of the SHA-1 of its folded key (lib/entity/fold.js), the way the roster's own
 * resolver matches "the exact fold() key of a label, alias or handle". Each person keeps only what the resolver scores with: the
 * QID, the occupation class, the size tier (stale: a coarse prior, never a live size) and the notability (floor(log2(1 + sitelinks))).
 *
 * File layout (little-endian unless said):
 *   0   8 bytes  magic "YPROST01"
 *   8   uint32   people P;  12 uint32 key entries K;  16 uint32 built (YYYYMMDD);  20 uint8 hash bytes H;  21-31 zero
 *   32  P x 6    uint32 QID number, uint8 (class << 4 | tier: 0 none, 1 nano .. 5 mega), uint8 notability
 *   ..  K x (H+3)  H bytes of SHA-1(key), then 3 bytes big-endian: (type << 22) | person index; type 0 label, 1 alias, 2 handle.
 *                  Sorted by hash, then type, then index.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fold } = require('./fold');

const MAGIC = 'YPROST01';
const HEADER_BYTES = 32;
const PERSON_BYTES = 6;
const CLASSES = ['creator', 'streamer', 'musician', 'athlete', 'actor', 'politician', 'other'];
const TIERS = [null, 'nano', 'micro', 'mid', 'macro', 'mega'];
// the follower count a tier stands for in the resolver's score (the roster's tierBounds; "nano" counts as 1, as the evaluation did)
const TIER_SIZE = { nano: 1, micro: 10000, mid: 100000, macro: 1000000, mega: 10000000 };
const TYPES = ['label', 'alias', 'handle'];
const DEFAULT_FILE = path.join(__dirname, '..', 'data', 'entity-roster.bin');

const hashOf = (key, bytes) => crypto.createHash('sha1').update(key, 'utf8').digest().subarray(0, bytes);

/**
 * A roster read from a buffer: { people, entries, built, candidates(name) }. candidates: the people whose label, alias or handle
 * folds to the name's key, as Map(qid -> { qid, type, cls, tier, notability, sitelinks, size }) (one entry a person: a label beats
 * an alias beats a handle).
 */
function fromBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_BYTES || buf.toString('latin1', 0, 8) !== MAGIC) throw new Error('not an entity roster file');
  const people = buf.readUInt32LE(8);
  const entries = buf.readUInt32LE(12);
  const built = buf.readUInt32LE(16);
  const H = buf.readUInt8(20);
  const keyBytes = H + 3;
  const keysAt = HEADER_BYTES + people * PERSON_BYTES;
  if (H < 4 || H > 16 || buf.length !== keysAt + entries * keyBytes) throw new Error('entity roster file is truncated or malformed');
  const person = (i) => {
    const at = HEADER_BYTES + i * PERSON_BYTES;
    const packed = buf.readUInt8(at + 4);
    const tier = TIERS[packed & 15] || null;
    const notability = buf.readUInt8(at + 5);
    return { qid: `Q${buf.readUInt32LE(at)}`, cls: CLASSES[packed >> 4] || 'other', tier, notability, sitelinks: 2 ** notability - 1, size: tier ? TIER_SIZE[tier] : null };
  };
  // (the sign of entry i's hash against h: Buffer#compare gives source against target)
  const cmp = (i, h) => buf.compare(h, 0, H, keysAt + i * keyBytes, keysAt + i * keyBytes + H);
  /** The entries of one folded key: [{ index, type }]. */
  function lookupKey(key) {
    if (!key) return [];
    const h = hashOf(key, H);
    let lo = 0;
    let hi = entries;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cmp(mid, h) < 0) lo = mid + 1; else hi = mid;
    }
    const out = [];
    for (let i = lo; i < entries && cmp(i, h) === 0; i++) {
      const at = keysAt + i * keyBytes + H;
      const v = buf.readUIntBE(at, 3);
      out.push({ index: v & 0x3fffff, type: TYPES[v >> 22] || 'alias' });
    }
    return out;
  }
  /** Map(qid -> candidate) for a folded key; the best type per person. */
  function candidatesOfKey(key) {
    const out = new Map();
    for (const e of lookupKey(key)) {
      const p = person(e.index);
      const had = out.get(p.qid);
      if (!had || TYPES.indexOf(e.type) < TYPES.indexOf(had.type)) out.set(p.qid, { ...p, type: e.type });
    }
    return out;
  }
  return { people, entries, built, hashBytes: H, candidatesOfKey, candidates: (name) => candidatesOfKey(fold(name)) };
}

let shared = null;
/**
 * The roster file, read once a process: { roster, ms (read and checked), bytes, file } or { roster: null, error } when it is
 * missing or does not read (the graph then joins by full name alone, never by a guess).
 */
function load(file = DEFAULT_FILE) {
  if (shared && shared.file === file) return shared;
  const started = process.hrtime.bigint();
  try {
    const buf = fs.readFileSync(file);
    const roster = fromBuffer(buf);
    shared = { roster, ms: Number(process.hrtime.bigint() - started) / 1e6, bytes: buf.length, file };
  } catch (e) {
    shared = { roster: null, error: e.message, ms: Number(process.hrtime.bigint() - started) / 1e6, bytes: 0, file };
  }
  return shared;
}

module.exports = { fromBuffer, load, hashOf, MAGIC, HEADER_BYTES, PERSON_BYTES, CLASSES, TIERS, TIER_SIZE, TYPES, DEFAULT_FILE };
