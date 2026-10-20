#!/usr/bin/env node
'use strict';
/*
 * Builds the collector's copy of the entity roster (lib/data/entity-roster.bin, read by lib/entity/roster.js) from the shipped
 * Wikidata roster (scripts/build-data/entity-roster.json, CC0 1.0). Run on the Mac whenever that roster is rebuilt (monthly):
 *
 *   node lib/entity/build-roster.js <entity-roster.json> lib/data/entity-roster.bin
 *
 * What it keeps of each person: the QID, the occupation class, the size tier and the notability; the label, up to three aliases and
 * the handles (YouTube @handles, TikTok, Twitch, Instagram, X; never a channel id, which is joined by id, not by name) only as the
 * hashes of their folded keys. Country, birth day and the dead flag are left out: nothing in the graph reads them. Who is kept: see
 * `kept` (TRIM): the people a trend row can plausibly name, measured on the roster's own evaluation.
 */
const fs = require('node:fs');
const { fold } = require('./fold');
const R = require('./roster');

const HASH_BYTES = 6;
const MAX_INDEX = 0x3fffff;

/**
 * Who stays in the collector's copy: everyone with a size reading (any tier), every creator and streamer, and anyone else with 7
 * Wikipedia sitelinks or more (notability 3+): 213,974 of the 229,824 people, 5.8 MB. Measured on the roster's 278 labelled person
 * mentions (data/knowledge/wikidata.md finding 1): 199 resolved and 198 right, against 203 and 200 with everyone; the two it gives up
 * were right, and the two wrong ones it drops were obscure namesakes of absent people. The 60 related pairs score the same (20 of 20).
 * minNotability is a parameter for the measurement.
 */
const TRIM = { minNotability: 3 };
function kept(p, cls, trim = TRIM) {
  const [, , , , , , tier, , notability] = p;
  if (tier !== null && tier !== undefined) return true;
  if (cls === 'creator' || cls === 'streamer') return true;
  return notability >= trim.minNotability;
}

/** The binary file's bytes for a roster as entity-roster.json holds it. */
function build(src, { trim = TRIM, built = null } = {}) {
  const classes = src.classes;
  const tiers = src.tiers;
  const people = [];
  const entries = [];
  for (const p of src.people) {
    const [qid, label, aliases, cls, , handles, tier, , notability] = p;
    const className = classes[cls];
    if (!kept(p, className, trim)) continue;
    const n = Number(String(qid).replace(/^Q/, ''));
    if (!Number.isInteger(n) || n <= 0 || n > 0xffffffff) continue;
    const index = people.length;
    if (index > MAX_INDEX) throw new Error('too many people for the file format');
    const tierCode = tier === null || tier === undefined ? 0 : 1 + R.TIERS.slice(1).indexOf(tiers[tier]);
    people.push({ n, packed: (Math.max(0, R.CLASSES.indexOf(className)) << 4) | Math.max(0, tierCode), notability: Math.min(255, notability | 0) });
    // (one entry a key a person, the best type: a label beats an alias beats a handle, as the resolver's index does it)
    const types = new Map();
    const add = (text, type) => { const k = fold(text); if (k && !types.has(k)) types.set(k, type); };
    add(label, 0);
    for (const a of aliases || []) add(a, 1);
    for (const [plat, h] of Object.entries(handles || {})) {
      if (plat === 'yt' && /^UC/.test(h)) continue;
      add(String(h).replace(/^@+/, ''), 2);
    }
    for (const [k, type] of types) entries.push({ hash: R.hashOf(k, HASH_BYTES), type, index });
  }
  entries.sort((a, b) => Buffer.compare(a.hash, b.hash) || a.type - b.type || a.index - b.index);
  const keyBytes = HASH_BYTES + 3;
  const buf = Buffer.alloc(R.HEADER_BYTES + people.length * R.PERSON_BYTES + entries.length * keyBytes);
  buf.write(R.MAGIC, 0, 'latin1');
  buf.writeUInt32LE(people.length, 8);
  buf.writeUInt32LE(entries.length, 12);
  const day = built || src.built || '';
  buf.writeUInt32LE(Number(String(day).replace(/-/g, '')) || 0, 16);
  buf.writeUInt8(HASH_BYTES, 20);
  people.forEach((p, i) => {
    const at = R.HEADER_BYTES + i * R.PERSON_BYTES;
    buf.writeUInt32LE(p.n, at);
    buf.writeUInt8(p.packed, at + 4);
    buf.writeUInt8(p.notability, at + 5);
  });
  const keysAt = R.HEADER_BYTES + people.length * R.PERSON_BYTES;
  entries.forEach((e, i) => {
    const at = keysAt + i * keyBytes;
    e.hash.copy(buf, at);
    buf.writeUIntBE((e.type << 22) | e.index, at + HASH_BYTES, 3);
  });
  return { buf, people: people.length, entries: entries.length, of: src.people.length };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  const minAt = process.argv.indexOf('--min-notability');
  const trim = minAt > 0 ? { minNotability: Number(process.argv[minAt + 1]) } : TRIM;
  if (!input || !output) { console.error('usage: node lib/entity/build-roster.js <entity-roster.json> <out.bin> [--min-notability N]'); process.exit(2); }
  const src = JSON.parse(fs.readFileSync(input, 'utf8'));
  const out = build(src, { trim });
  const tmp = `${output}.new`;
  fs.writeFileSync(tmp, out.buf);
  fs.renameSync(tmp, output);
  console.log(`${out.people} of ${out.of} people, ${out.entries} keys, ${(out.buf.length / 1e6).toFixed(2)} MB`);
}

module.exports = { build, kept, TRIM, HASH_BYTES };
