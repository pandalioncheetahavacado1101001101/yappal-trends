'use strict';
/*
 * The candidate clusters the engine weighed in a build (engine/talking-points.js build: every pointOf, kept by lists() or dropped),
 * as the precursor's private log keeps them (2026-10-31, wave 9 lane precursor): what was known of each at this cycle, never after.
 * A dropped candidate is kept 1 in 10 (a stable hash of its key, so the same candidate is kept or skipped every cycle); every kept one
 * is logged. The label step joins them to the comparators later (scoreboard-steps/precursor.js), so a story the gates held back still
 * teaches the model what an early one looked like. Pure: no clock, no I/O. Text (key, title) goes to the private log only.
 */

const DROP_SAMPLE = 10;
const HOUR_MS = 3600 * 1000;

/** FNV-1a of a string, 32 bits. */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** Whether a dropped candidate of this key is one of the 1 in DROP_SAMPLE kept. */
const sampled = (key) => fnv(String(key || '')) % DROP_SAMPLE === 0;

const fin = (x) => (Number.isFinite(x) ? x : null);
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);

/**
 * One point's record. p: a talking point (pointOf: { c, ev, noun, title, out }); kept: whether lists() kept it; nowMs: the build's
 * clock (ms, as the engine's). Returns null for a point with no candidate (a word or a meme: their rows are logged from the list).
 */
function recordOf(p, kept, nowMs) {
  if (!p || !p.c || !p.ev) return null;
  const ev = p.ev;
  const rows = Array.isArray(ev.rows) ? ev.rows.filter((r) => Number.isFinite(r.t) && r.t <= nowMs) : [];
  const press = Array.isArray(ev.press) ? ev.press.filter((r) => Number.isFinite(r.t) && r.t <= nowMs) : [];
  const within = (h) => press.filter((r) => r.t > nowMs - h * HOUR_MS).length;
  const fams = new Set(rows.map((r) => (r.youtube ? 'youtube' : r.fam || 'press')));
  const first = press.length ? Math.min(...press.map((r) => r.t)) : null;
  const out = p.out || {};
  const sig = out.signals || {};
  return {
    key: String(p.c.key || ''), title: String(p.title || out.title || ''), stage: kept ? 'kept' : 'dropped', from: p.c.from || null,
    f: {
      firstH: first !== null ? round2((nowMs - first) / HOUR_MS) : null,
      n1: within(1), n6: within(6), n24: within(24), news: press.length,
      outlets: fin(ev.outlets), youtube: fin(ev.youtube), families: fams.size,
      redditBest: Number.isFinite(ev.redditBest) && ev.redditBest < 99 ? ev.redditBest + 1 : null, redditSubs: fin(ev.redditSubs), creatorSub: ev.creatorSub ? 1 : 0,
      fresh: Array.isArray(ev.completions) ? ev.completions.filter((x) => x && x.fresh).length : 0,
      drama: out.drama ? 1 : 0, tier: out.tier || null, family: p.noun && p.noun.f ? p.noun.f.key : null, sensitive: out.sensitive ? 1 : 0,
      wiki: fin(sig.wikipedia),
      // (Google Trends' own numbers: never read by a model fitted to a Google Trends label)
      gtHeat: fin(out.heat), gtSearch: sig.search && Number.isFinite(sig.search.volume) ? sig.search.volume : null,
    },
  };
}

/**
 * The records of one build. points: every pointOf of the build; keptOf(p): lists()'s verdict. Every kept point, and the dropped ones
 * the stable 1-in-10 keeps. Returns { records, kept, dropped, sampled }.
 */
function recordsOf(points, keptOf, nowMs) {
  const records = [];
  let kept = 0; let dropped = 0; let taken = 0;
  for (const p of points || []) {
    let ok = false;
    try { ok = !!keptOf(p); } catch { ok = false; }
    if (ok) kept += 1; else dropped += 1;
    if (!ok && !sampled(p && p.c && p.c.key)) continue;
    const r = recordOf(p, ok, nowMs);
    if (!r) continue;
    if (!ok) taken += 1;
    records.push(r);
  }
  return { records, kept, dropped, sampled: taken };
}

module.exports = { DROP_SAMPLE, fnv, sampled, recordOf, recordsOf };
