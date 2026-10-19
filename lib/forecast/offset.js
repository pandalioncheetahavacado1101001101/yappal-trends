'use strict';
/*
 * Trends' end against ours (ios/IDEAS-SUPER.md P6, "GT's end is not ours"). Trends stops listing a search when its searches drop;
 * the collector ends a trend when its interest stays under 25% of its peak for 6 hours (C7). A forecast of Trends' end becomes one
 * of ours only through the offset between the two, measured on trends where the collector watched both: met before its own peak,
 * before Trends' end, and its own end seen happening (not met already over). Until NEED of those agree, nothing is offset and the
 * forecast stays Trends' own (lib/forecast/backtest.js scores that).
 *
 * The collector's db is opened read-only, and only a copy of a state should be handed in.
 */
const M = require('../measure');
const { HOUR, keyOf, median } = require('../util');

const NEED = 15;
const AGREE_WITHIN = 6; // hours: the feed's own step under 36 hours
const MIN_TOKEN = 4;

/** The offsets (hours, ours minus Trends') calibrated: { pairs, median, q25, q75, agree, need, agreeWithin, ready }. */
function calibrate(offsets, { need = NEED, agreeWithin = AGREE_WITHIN } = {}) {
  const xs = (offsets || []).filter(Number.isFinite).sort((a, b) => a - b);
  const mid = xs.length ? median(xs) : null;
  const q = (p) => (xs.length ? xs[Math.min(xs.length - 1, Math.round(p * (xs.length - 1)))] : null);
  const agree = mid === null ? 0 : xs.filter((x) => Math.abs(x - mid) <= agreeWithin).length;
  return { pairs: xs.length, median: mid, q25: q(0.25), q75: q(0.75), agree, need, agreeWithin, ready: agree >= need };
}

const tokensOf = (text) => new Set(keyOf(text).split(' ').filter((w) => w.length >= MIN_TOKEN));
/** Whether a Trends keyword names the trend: a word of four letters or more in common with its subject. */
function names(keyword, subjectTokens) {
  for (const w of tokensOf(keyword)) if (subjectTokens.has(w)) return true;
  return false;
}

/**
 * The trend's main search as Trends ended it: its largest search (the earliest of equals), its end read from the merged snapshots
 * where one of them shows that search (same start, a keyword naming the trend), else as the trend kept it. null when it has none
 * that ended.
 */
function mainSearchEnd(trend, entriesByStart) {
  const searches = [...(trend.searches || [])].filter((s) => Number.isFinite(s.start)).sort((a, b) => (b.volume || 0) - (a.volume || 0) || a.start - b.start);
  const main = searches[0];
  if (!main) return null;
  const subject = tokensOf(trend.subject || '');
  const seen = (entriesByStart.get(main.start) || []).filter((e) => names(e.keyword, subject));
  const ends = seen.map((e) => e.obs[e.obs.length - 1].end).filter(Number.isFinite);
  const end = ends.length ? Math.max(...ends) : main.end;
  return Number.isFinite(end) ? end : null;
}

/**
 * Pairs from trends ({ firstSeen, peakAt, endedAt, subject, searches: [{ start, end, volume }] }, seconds): [{ offset (hours) }] for
 * each whose two ends were both watched. Also `ownLives`: trends watched from before their peak to their end.
 */
function pairsOf(trends, entries) {
  const byStart = new Map();
  for (const e of entries || []) { if (!byStart.has(e.start)) byStart.set(e.start, []); byStart.get(e.start).push(e); }
  const stay = M.K.END_STAY.talk;
  const out = [];
  let ownLives = 0;
  let candidates = 0;
  for (const t of trends) {
    if (!Number.isFinite(t.endedAt)) continue;
    const watchedRise = Number.isFinite(t.peakAt) && t.firstSeen <= t.peakAt;
    const endSeen = t.endedAt - t.firstSeen >= stay;
    if (watchedRise && endSeen) ownLives += 1;
    if (!(t.searches || []).length) continue;
    candidates += 1;
    const gtEnd = mainSearchEnd(t, byStart);
    if (!watchedRise || !endSeen || !Number.isFinite(gtEnd) || t.firstSeen >= gtEnd) continue;
    out.push({ offset: (t.endedAt - gtEnd) / HOUR });
  }
  return { pairs: out, ownLives, candidates };
}

/** The trends of a collector.db (read-only) as pairsOf reads them. */
function trendsOfDb(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT first_seen, peak_at, ended_at, natural_key, info FROM trends WHERE kind = 'talk'").all().map((r) => {
      let info = {};
      try { info = JSON.parse(r.info || '{}') || {}; } catch { info = {}; }
      return { firstSeen: r.first_seen, peakAt: r.peak_at, endedAt: r.ended_at, subject: info.subject || info.name || String(r.natural_key || '').split('|')[1] || '', searches: info.searches || [] };
    });
  } finally { db.close(); }
}

/** calibrate() over a db copy's talk trends, with how many trends could be paired and how many lives the archive watched. */
function calibrateFromDb(file, entries) {
  const { pairs, ownLives, candidates } = pairsOf(trendsOfDb(file), entries);
  return { ...calibrate(pairs.map((p) => p.offset)), ownLives, candidates };
}

module.exports = { NEED, AGREE_WITHIN, calibrate, pairsOf, mainSearchEnd, trendsOfDb, calibrateFromDb };
