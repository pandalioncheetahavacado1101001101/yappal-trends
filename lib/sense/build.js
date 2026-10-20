'use strict';
/*
 * Builds lib/data/word-senses.json, the word-sense file collect reads (B8), from the Wiktionary sense list in
 * scripts/build-data/slang-senses.json (17.7 MB, CC BY-SA 4.0), never shipped whole. Run on the Mac when that file is rebuilt
 * (monthly; data/datasets/wiktionary/analysis/build.py):
 *
 *   node lib/sense/build.js [--from <slang-senses.json>] [--met <file>]... [--never <gold.json>]... [--out <word-senses.json>]
 *
 * --met: what the collector has met, any number of files: a feed (`items`, its word rows' titles and keys), a list of names (a JSON
 * array), or the word inventory (`rows[].title`). Kept: every sense of each word met (and the slang senses of its lemma), plus a
 * reserve for the words it will meet next: every word with an Internet or neologism sense, or a slang sense first seen in 2020 or
 * later, with only those senses, its informal ones and its first usable one. Every sense keeps its words and its labels (an
 * offensive, vulgar or derogatory one is shown with that label, lib/sense/register.js: nothing is withheld). The file stays CC BY-SA
 * 4.0, credited inside and in word-senses.LICENCE.md.
 *
 * As built on 2026-10-20, from scripts/ideas-collector (the inventory is the Wiktionary study's list of every word row and typed word
 * the collector met, 2026-10-06 to 10-19; the feed, the live US list of that morning):
 *
 *   node lib/sense/build.js --met ../../data/datasets/wiktionary/analysis/out/inventory.json --met test/fixtures/word-sense-check.json \
 *     --met eval/days/2026-10-12/baseline/us.json --met eval/days/2026-10-12b/baseline/us.json --met <the live us.json> \
 *     --never eval/days/2026-10-12/gold.json --never eval/days/2026-10-12b/gold.json
 *
 * --never: a frozen day's answer key (eval/days/<day>/gold.json, local, never published). A word whose entry names a story the
 * key matches by (by the publish script's own rule: a name with a word the lexicon does not know) is left out, so the public copy
 * carries no benchmark's name. The names are read here and never written or printed.
 */
const fs = require('node:fs');
const path = require('node:path');
const T = require('./text');
const P = require('./pick');

const HERE = path.join(__dirname, '..', '..');
const DEFAULT_FROM = path.join(HERE, '..', 'build-data', 'slang-senses.json');
const DEFAULT_OUT = path.join(HERE, 'lib', 'data', 'word-senses.json');
const STRONG = P.STRONG;
const RESERVE_YEAR = 2020;
const RESERVE_KINDS = new Set(['Internet', 'neologism']);
const LEMMA_KINDS = new Set(['slang', 'Internet', 'neologism', 'informal']);
const GLOSS_MAX = 240;

const argsOf = (argv) => {
  const out = { from: DEFAULT_FROM, out: DEFAULT_OUT, met: [], never: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') out.from = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--met') out.met.push(argv[++i]);
    else if (argv[i] === '--never') out.never.push(argv[++i]);
  }
  return out;
};

/**
 * The names an answer key matches its stories by that the publish script scans for (scripts/publish-ideas-collector.sh, step 3):
 * each alternative of each story's match names with a word of four letters or more the lexicon does not know, or one mixing
 * letters and digits. common: the lexicon's words.
 */
function benchmarkNames(gold, common) {
  const out = new Set();
  for (const story of (gold && gold.stories) || []) {
    for (const raw of (story.match && story.match.names) || []) {
      for (const alt of String(raw).split('|')) {
        const a = alt.trim().replace(/\*+$/, '').trim().toLowerCase();
        if (!a || a.startsWith('@') || (a.startsWith('/') && a.endsWith('/'))) continue;
        const ws = a.match(/[a-z0-9]+/g) || [];
        if (ws.some((w) => (/[a-z]/.test(w) && /[0-9]/.test(w)) || (/^[a-z]+$/.test(w) && w.length >= 4 && !common.has(w)))) out.add(a);
      }
    }
  }
  return out;
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A test for text that names one of `names`, as the publish script's scan reads it (lower case, not inside a longer word). */
const namesTest = (names) => { const res = [...names].map((n) => new RegExp(`(?<![a-z0-9])${esc(n)}(?![a-z0-9])`)); return (text) => res.some((re) => re.test(String(text).toLowerCase())); };

/** The names a file of the collector's holds: a feed's word rows (title and card keys), a list of names, the inventory's titles. */
function namesIn(json) {
  if (Array.isArray(json)) return json.filter((x) => typeof x === 'string');
  if (json && Array.isArray(json.items)) {
    return json.items.filter((i) => i && i.kind === 'word').flatMap((i) => [i.title, ...(i.keys || []).map((k) => String(k).replace(/^(?:word|point):/, ''))]).filter(Boolean);
  }
  if (json && Array.isArray(json.rows)) return json.rows.flatMap((r) => [r.title, r.term]).filter((x) => typeof x === 'string');
  return [];
}

const cutGloss = (g) => { const s = String(g || '').replace(/\s+/g, ' ').trim(); return s.length <= GLOSS_MAX ? s : `${s.slice(0, s.lastIndexOf(' ', GLOSS_MAX - 1))}…`; };
/** One sense as the file keeps it: [kind, firstYear, label, gloss, pos]. */
const packed = (s) => [s.kind, s.firstYear ?? null, s.label || '', cutGloss(s.gloss), s.pos || null];
const asRecord = (s) => ({ kind: s.kind, year: s.firstYear ?? null, label: s.label || '', gloss: s.gloss, pos: s.pos || null });

function build({ source, met, never = () => false }) {
  const words = new Map();
  for (const [w, ss] of Object.entries(source.words || {})) { const k = T.termKey(w); if (k) words.set(k, [...(words.get(k) || []), ...ss]); }
  // (no entry that names a benchmark's story: the word, its labels and its glosses)
  for (const [k, ss] of [...words]) if (never(k) || ss.some((s) => never(`${s.label || ''} ${s.gloss || ''}`))) words.delete(k);
  const aliases = new Map();
  for (const [a, ls] of Object.entries(source.aliases || {})) { const k = T.termKey(a); const L = (ls || []).map(T.termKey).filter((x) => x && x !== k && words.has(x)); if (k && L.length && !never(k)) aliases.set(k, [...new Set([...(aliases.get(k) || []), ...L])]); }
  // every sense of a word the collector met, and of each lemma it leads to
  const whole = new Set();
  for (const name of met) {
    const form = T.formsOf(name).find((f) => words.has(f) || aliases.has(f));
    if (!form) continue;
    if (words.has(form)) whole.add(form);
    for (const L of aliases.get(form) || []) whole.add(L);
  }
  const out = new Map();
  for (const k of whole) out.set(k, words.get(k).map(packed));
  // the reserve: the words most likely met next, with the senses the picker can use
  for (const [k, ss] of words) {
    if (out.has(k) || !ss.some((s) => RESERVE_KINDS.has(s.kind) || (s.kind === 'slang' && s.firstYear >= RESERVE_YEAR))) continue;
    const first = P.usable(ss.map(asRecord))[0] || null;
    out.set(k, ss.filter((s) => STRONG.has(s.kind) || LEMMA_KINDS.has(s.kind) || (first && s.gloss === first.gloss)).map(packed));
  }
  const keptAliases = new Map([...aliases].map(([a, L]) => [a, L.filter((x) => out.has(x))]).filter(([, L]) => L.length));
  const sortObj = (m) => Object.fromEntries([...m].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
  const all = [...out.values()].flat();
  return {
    _licence: 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/) and GFDL. This file stays under CC BY-SA 4.0; anything shown from it credits "Wiktionary, CC BY-SA 4.0".',
    _attribution: 'English Wiktionary contributors (https://en.wiktionary.org), via wiktextract on kaikki.org (T. Ylonen, LREC 2022). CC BY-SA 4.0 and GFDL; files built from it stay CC BY-SA.',
    _changed: 'Selected and trimmed for the Ideas collector: the senses of words it met and a reserve of recent slang; glosses cut to 240 characters. Every kept sense keeps its words and its labels.',
    source: source.source || 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz',
    from: `scripts/build-data/slang-senses.json, built ${source.built || '?'}`,
    fields: 'words: term key -> senses in dictionary order, each [kind, firstYear, label, gloss, pos]; kind is slang, Internet, neologism, informal, name or ordinary; firstYear is at most an upper bound on age (mostly a quotation year); label is the dictionary’s own (its register too: offensive, vulgar, derogatory). aliases: another form of a word -> its lemmas.',
    counts: { words: out.size, met: whole.size, senses: all.length, aliases: keptAliases.size },
    words: sortObj(out),
    aliases: sortObj(keptAliases),
  };
}

if (require.main === module) {
  const a = argsOf(process.argv.slice(2));
  const source = JSON.parse(fs.readFileSync(a.from, 'utf8'));
  const met = a.met.flatMap((f) => namesIn(JSON.parse(fs.readFileSync(f, 'utf8'))));
  const common = new Set(fs.readFileSync(path.join(HERE, 'engine', 'lexicon', 'words.txt'), 'utf8').split(/\s+/).map((w) => w.trim().toLowerCase()).filter(Boolean));
  const names = new Set(a.never.flatMap((f) => [...benchmarkNames(JSON.parse(fs.readFileSync(f, 'utf8')), common)]));
  const doc = build({ source, met, never: names.size ? namesTest(names) : () => false });
  const text = `${JSON.stringify(doc)}\n`;
  fs.writeFileSync(`${a.out}.new`, text);
  fs.renameSync(`${a.out}.new`, a.out);
  console.log(`[sense] ${a.out}: ${doc.counts.words} words (${doc.counts.met} met), ${doc.counts.senses} senses, ${doc.counts.aliases} aliases, ${text.length} bytes`);
}

module.exports = { build, namesIn, packed, benchmarkNames, namesTest, RESERVE_YEAR };
