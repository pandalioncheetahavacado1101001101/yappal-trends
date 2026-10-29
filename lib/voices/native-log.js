'use strict';
/*
 * The creator-native voice's private join log (wave 11, lib/early-names.js): each name the creator-native voice adds to the early
 * names (met with it, not without it), once, with the kinds of voice it carried and when; a day on, whether it joined: a search of the
 * name began (a Google Trends entry naming it, from 6 hours before it was met to a day after), or the main list carried it. From it the
 * line's "joined k of s a day on", which is what the switch's default waits for: IDEAS_CREATOR_NATIVE stays shadow until 7 live days show
 * 0.5 or more on 20 or more settled names (offline, 8 replayed days measured 0.24 on 42; ios/.review/learn/2026-11-02-creator-native.md).
 *
 * Private data: the file lives in the collector's state folder (voices/creator-native.jsonl), never in the feed, the ledger or the
 * repository. The log line is counts only (the job's log is public). Collector only, wave 11.
 */
const path = require('node:path');
const VL = require('./log');

const HOUR = 3600e3;
const JOIN_AFTER = 24 * HOUR;
const KEEP = 4 * 24 * HOUR;
const ENTRIES_MAX = 2000;
const SEARCH_BEFORE = 6 * HOUR;

const fileOf = (stateDir) => path.join(stateDir, 'voices', 'creator-native.jsonl');
const words = (s) => ` ${String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/**
 * One cycle: the names added (each once while kept), marked when a search of the name began or the list carried it, settled a day on,
 * let go after 4 days. added: [{ key (the name's words), kinds: ['upload' | 'cluster' | 'platform'] }]; trends: [{ keyword, start }];
 * listed: Set of the names the main list carries (their words). Returns { entries, joined, settled } (settled in the last day).
 */
function step(entries, { added = [], now, trends = [], listed = new Set() }) {
  const byKey = new Map((entries || []).filter((e) => e && typeof e.key === 'string').map((e) => [e.key, e]));
  for (const a of added) {
    const key = words(a.key).trim();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { key, metAt: now, kinds: [...new Set(a.kinds || [])].sort(), searchedAt: null, listedAt: null, settled: false });
  }
  const searchedAfter = (key, metAt) => {
    const starts = trends.filter((t) => Number.isFinite(t.start) && t.start >= metAt - SEARCH_BEFORE && words(t.keyword).includes(` ${key} `)).map((t) => t.start);
    return starts.length ? Math.max(metAt, Math.min(...starts)) : null;
  };
  const next = [...byKey.values()].filter((e) => now - e.metAt <= KEEP).map((e) => {
    let x = e;
    if (x.listedAt === null && listed.has(x.key)) x = { ...x, listedAt: now };
    if (x.searchedAt === null) { const at = searchedAfter(x.key, x.metAt); if (at !== null) x = { ...x, searchedAt: at }; }
    if (!x.settled && now - x.metAt >= JOIN_AFTER) {
      const hit = (x.searchedAt !== null && x.searchedAt - x.metAt <= JOIN_AFTER) || (x.listedAt !== null && x.listedAt - x.metAt <= JOIN_AFTER);
      x = { ...x, settled: true, hit };
    }
    return x;
  }).slice(-ENTRIES_MAX);
  const settled = next.filter((e) => e.settled && now - e.metAt < JOIN_AFTER + 24 * HOUR);
  return { entries: next, joined: settled.filter((e) => e.hit).length, settled: settled.length };
}

module.exports = { fileOf, read: VL.read, write: VL.write, step, JOIN_AFTER, KEEP };
