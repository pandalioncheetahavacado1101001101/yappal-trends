'use strict';
/*
 * The fast lane's private voice log (wave 9; plan #1): each person's young chapter the lane would list, once, with its voices (source
 * families, never a title) and when it was first met; a day on, whether it joined (a Google Trends search of its name began, or the
 * hand rule listed it). From it: the shadow line's counts, and the (voice, noun) hit rates the one-voice rule needs (RATE_N stories
 * or more at RATE_MIN or more, lib/voices/fastlane.js); until a pair has them, one voice lists nothing.
 *
 * Private data: the file lives in the collector's state folder (voices/fastlane.jsonl), never in the feed, the ledger or the
 * repository. The log line is counts only (the job's log is public). Collector only, wave 9.
 */
const fs = require('node:fs');
const path = require('node:path');
const FL = require('./fastlane');

const HOUR = 3600e3;
const JOIN_AFTER = 24 * HOUR;
const KEEP = 4 * 24 * HOUR;
const ENTRIES_MAX = 4000;
// (a search that began this long before the lane met the chapter was the story's already: it is no join of the lane's)
const SEARCH_BEFORE = 6 * HOUR;

const fileOf = (stateDir) => path.join(stateDir, 'voices', 'fastlane.jsonl');
function read(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
function write(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.new`;
  fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
/** When a search of the name began after the lane met it (or just before), or null: trends: [{ keyword, start }]. */
function searchedAfter(key, metAt, trends) {
  const starts = trends.filter((t) => Number.isFinite(t.start) && t.start >= metAt - SEARCH_BEFORE && words(t.keyword).includes(` ${key} `)).map((t) => t.start);
  return starts.length ? Math.max(metAt, Math.min(...starts)) : null;
}

/**
 * One cycle: the audience's young voiced chapters added (each (key, noun) once, with the rule its voices met, if any), the entries
 * marked when a search of the name began or the hand rule listed them, those a day old settled, old ones let go.
 * reports: FL.takeReports(); trends: the store's trends ([{ keyword, start }]); listed: the keys the hand rule listed this cycle.
 * Returns { entries, line (counts only), would, hand, joined, settled }.
 */
function step(entries, { reports, audience = 'US', now, trends = [], listed = new Set() }) {
  const r = reports && reports.get ? reports.get(audience) : null;
  const seen = r ? r.seen || [] : [];
  const byKey = new Map(entries.map((e) => [`${e.key}|${e.noun}`, e]));
  for (const w of seen) {
    const k = `${w.key}|${w.noun}`;
    const old = byKey.get(k);
    // (an entry first met by one voice takes the rule when a second voice comes: the time the lane would have listed it)
    if (old) { if (!old.rule && w.rule) byKey.set(k, { ...old, rule: w.rule, ruleAt: now }); continue; }
    byKey.set(k, { key: w.key, noun: w.noun, tier: w.tier, metAt: now, first: w.first, voice: (w.families || [])[0] || null, voices: w.voices, rule: w.rule || null,
      ruleAt: w.rule ? now : null, handAt: w.hand ? now : null, searchedAt: null, settled: false });
  }
  const next = [...byKey.values()].filter((e) => now - e.metAt <= KEEP).map((e) => {
    let x = e;
    if (x.handAt === null && listed.has(x.key)) x = { ...x, handAt: now };
    if (x.searchedAt === null) { const at = searchedAfter(x.key, x.metAt, trends); if (at !== null) x = { ...x, searchedAt: at }; }
    if (!x.settled && now - x.metAt >= JOIN_AFTER) x = { ...x, settled: true, hit: x.searchedAt !== null && x.searchedAt - x.metAt <= JOIN_AFTER };
    return x;
  }).slice(-ENTRIES_MAX);
  // (the build's own counts: what only the lane lists, and what the hand rule's list holds anyway; engine/talking-points.js laneReport)
  const fresh = seen.filter((w) => w.rule);
  const lane = r && Number.isFinite(r.would) ? r.would : fresh.filter((w) => !w.hand).length;
  const hand = r && Number.isFinite(r.hand) ? r.hand : fresh.filter((w) => w.hand).length;
  // (joined: of the lane's own listings a day old, how many a search of the name or the hand rule then joined)
  const settled = next.filter((e) => e.settled && e.rule && now - e.metAt < JOIN_AFTER + 24 * HOUR && (e.handAt === null || e.handAt > e.ruleAt));
  const joined = settled.filter((e) => e.searchedAt !== null || e.handAt !== null).length;
  const mode = r ? r.mode : FL.mode();
  const line = `[fastlane] would list ${lane} (hand rule ${hand}), joined ${joined} of ${settled.length} a day on${mode === 'act' ? '' : ` (${mode})`}`;
  return { entries: next, line, would: lane, hand, joined, settled: settled.length };
}

/** The (first voice, noun) hit rates of the settled entries (hit: a search of the name began within a day): Map rateKey -> { n, hits }. */
function rates(entries) {
  const out = new Map();
  for (const e of entries) {
    if (!e.settled || !e.voice) continue;
    const k = FL.rateKey(e.voice, e.noun);
    const x = out.get(k) || { n: 0, hits: 0 };
    out.set(k, { n: x.n + 1, hits: x.hits + (e.hit ? 1 : 0) });
  }
  return out;
}

module.exports = { fileOf, read, write, step, rates, JOIN_AFTER, KEEP };
