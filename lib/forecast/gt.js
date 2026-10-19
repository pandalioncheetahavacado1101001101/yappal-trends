'use strict';
/*
 * Google Trends' "Trending now" list (the 168-hour i0OFE reply the collector already saves, one per country) read as lifetimes, for
 * the survival forecast of ios/IDEAS-SUPER.md P6. Pure: replies in, entries and survival records out; no I/O, no clock.
 *
 * One reply is a snapshot: every search that began in the 168 hours before it, each with its start, its end (null while it still
 * trends: right-censored at the snapshot) and its volume so far. Many snapshots of one country merge into entries keyed by
 * country, keyword and start, each keeping every reading in time order, so what was known at any moment can be read back.
 *
 * The list samples by start, not by survival: a search is in it if it began inside the window, however long it lived, so lives are
 * not length-biased. No life over 168 hours is ever seen to end (it leaves the window first): that tail is censored, never guessed.
 * A forecast made at age A conditions on surviving to A (lib/forecast/survival.js: delayed entry), which is the left truncation.
 */
const { safeJson } = require('../../engine/sources');
const { HOUR } = require('../util');

const WINDOW = 168 * HOUR;
// Trends' own categories: Beauty and Fashion, Entertainment, Games, Hobbies and Leisure are the creators' scope (engine/sources.js
// TRENDS_POP_CATEGORIES); Sports lives shortest by far; everything else (news, politics, law, business, technology) is "other"
const POP_CATEGORIES = new Set([2, 4, 6, 8]);
const SPORTS_CATEGORY = 17;
const GROUPS = ['pop', 'sports', 'other'];

/** A search's group from Trends' categories: pop, sports or other. */
const groupOf = (cats) => ((cats || []).some((c) => POP_CATEGORIES.has(c)) ? 'pop' : (cats || []).includes(SPORTS_CATEGORY) ? 'sports' : 'other');

/** The i0OFE rows of one saved batchexecute reply: [{ keyword, geo, start, end, volume, growth, cats }] (seconds), or null when it is no reply. */
function rowsOf(text) {
  for (const line of String(text || '').split('\n')) {
    if (!line.startsWith('[["wrb.fr"')) continue;
    for (const e of safeJson(line) || []) {
      if (e[0] !== 'wrb.fr' || e[1] !== 'i0OFE' || !e[2]) continue;
      const list = (safeJson(e[2]) || [])[1];
      if (!Array.isArray(list)) return null;
      return list.filter((r) => Array.isArray(r) && r[0] && Array.isArray(r[3]) && Number.isFinite(r[3][0])).map((r) => ({
        keyword: String(r[0]), geo: r[2] || null, start: r[3][0], end: Array.isArray(r[4]) && Number.isFinite(r[4][0]) ? r[4][0] : null,
        volume: Number.isFinite(r[6]) ? r[6] : 0, growth: Number.isFinite(r[8]) ? r[8] : 0, cats: Array.isArray(r[10]) ? r[10].filter(Number.isFinite) : [] }));
    }
  }
  return null;
}

/**
 * One reply as a snapshot: { geo, at, rows }, or null. `at`: when it was read; by default the newest start or end it carries
 * (Trends stamps both to ten minutes and refreshes about that often, so the newest stamp is the reading's time to within that).
 */
function snapshotOf(text, { geo = null, at = null } = {}) {
  const rows = rowsOf(text);
  if (!rows || !rows.length) return null;
  const newest = rows.reduce((m, r) => Math.max(m, r.start, r.end || 0), 0);
  return { geo: geo || rows[0].geo, at: Number.isFinite(at) ? at : newest, rows };
}

/**
 * Snapshots merged into entries: [{ key, geo, keyword, start, cats, group, obs: [{ at, end, volume, growth }] }], each `obs` in
 * time order, one reading per snapshot. A reading is what that snapshot said: an end Trends later took back (the search trending
 * again) is read as it was, then as it is.
 */
function mergeSnapshots(snapshots) {
  const byKey = new Map();
  for (const s of [...snapshots].filter(Boolean).sort((a, b) => a.at - b.at)) {
    for (const r of s.rows) {
      if (r.start > s.at) continue;
      const key = `${s.geo}|${r.keyword}|${r.start}`;
      let e = byKey.get(key);
      if (!e) { e = { key, geo: s.geo, keyword: r.keyword, start: r.start, cats: r.cats, group: groupOf(r.cats), obs: [] }; byKey.set(key, e); }
      const reading = { at: s.at, end: Number.isFinite(r.end) && r.end <= s.at ? r.end : null, volume: r.volume, growth: r.growth };
      if (e.obs.length && e.obs[e.obs.length - 1].at === s.at) e.obs[e.obs.length - 1] = reading;
      else e.obs.push(reading);
    }
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : 1));
}

/** The newest reading of an entry taken at or before `t`, or null. */
function readingAt(entry, t) {
  let out = null;
  for (const o of entry.obs) { if (o.at <= t) out = o; else break; }
  return out;
}
/** The entry's newest reading of all. */
const lastReading = (entry) => entry.obs[entry.obs.length - 1];

/** Every snapshot's time, by country, oldest first: { US: [at, ...] }. */
function snapshotTimes(snapshots) {
  const out = {};
  for (const s of snapshots.filter(Boolean)) (out[s.geo] = out[s.geo] || []).push(s.at);
  for (const g of Object.keys(out)) out[g] = [...new Set(out[g])].sort((a, b) => a - b);
  return out;
}
/**
 * The last moment any snapshot could have shown how an entry ends: the newest snapshot of its country inside its 168 hours. What
 * a back-test can follow it to, whatever happened to it (administrative censoring: the same for a search that ended and one that
 * did not).
 */
function horizonOf(entry, times) {
  const ts = times[entry.geo] || [];
  let out = null;
  for (const at of ts) if (at >= entry.start && at <= entry.start + WINDOW) out = at;
  return out;
}

/**
 * A survival record ({ key, geo, group, volume, entry: 0, exit, event }, hours) of each entry as it was known at `t`, from the
 * readings taken by then: ended (event, exit = its life) or still trending at its newest reading (censored there). An entry no
 * reading had shown by `t` is not known and is left out. `volume`: its volume at that reading.
 */
function recordsAsOf(entries, t) {
  const out = [];
  for (const e of entries) {
    if (e.start >= t) continue;
    const r = readingAt(e, t);
    if (!r) continue;
    const exit = ((r.end !== null ? r.end : r.at) - e.start) / HOUR;
    if (exit > 0) out.push({ key: e.key, geo: e.geo, group: e.group, volume: r.volume, entry: 0, exit, event: r.end !== null });
  }
  return out;
}
/**
 * The same, read back from everything the snapshots later showed of the time before `t`: an entry that began before `t` ended by
 * `t` (event) or was still trending at `t` (censored at its age then); one no later reading shows is as recordsAsOf has it. A life
 * that had ended by `t` carries its final volume; one still going carries its volume as read by `t` where a reading had it, else
 * the newest (later than `t`: a landmark back-test that classes by it sees a little of the future, and says so).
 */
function recordsAt(entries, t) {
  const out = [];
  for (const e of entries) {
    if (e.start >= t) continue;
    const last = lastReading(e);
    if (last.at < t) {
      const exit = ((last.end !== null ? last.end : last.at) - e.start) / HOUR;
      if (exit > 0) out.push({ key: e.key, geo: e.geo, group: e.group, volume: last.volume, entry: 0, exit, event: last.end !== null });
      continue;
    }
    const ended = last.end !== null && last.end <= t;
    const then = readingAt(e, t);
    const exit = ((ended ? last.end : t) - e.start) / HOUR;
    if (exit > 0) out.push({ key: e.key, geo: e.geo, group: e.group, volume: ended || !then ? last.volume : then.volume, entry: 0, exit, event: ended });
  }
  return out;
}

module.exports = { WINDOW, GROUPS, POP_CATEGORIES, SPORTS_CATEGORY, groupOf, rowsOf, snapshotOf, mergeSnapshots, readingAt, lastReading, snapshotTimes, horizonOf, recordsAsOf, recordsAt };
