'use strict';
/*
 * Which outlets are one voice (wave 9 fast lane; plan #1 and L5c), learned from the collector's own store each build: every name it
 * searched, each outlet's headlines of that name.
 *   - Time: two outlets whose first headlines of a story land within SAME_MINUTES of each other on SAME_SHARE or more of the SAME_MIN
 *     or more stories they both told are one voice (a wire service and its subscribers, sister sites).
 *   - Copies: a headline printed word for word by an outlet after another printed it is the first printer's voice; an outlet whose
 *     headlines are such copies on SAME_SHARE or more of SAME_MIN or more is a re-host (an aggregator) and never a voice of its own.
 * (Measured on the frozen days' stores and a recording, 904 stories, 4,466 outlets: no outlet pair met the time rule, while 8% of the
 * headlines were word-for-word copies of another outlet's, the two big aggregators copying 41-45% of theirs.)
 * The table is private data: it lives in memory for one build, is never written to the feed, the ledger or the repository, and
 * reaches the log only as totals. Collector only, wave 9. Sources: none new.
 */
const { outletKey } = require('../../engine/util');

const SAME_MINUTES = 10;
const SAME_SHARE = 0.7;
const SAME_MIN = 10;
// (a name's coverage falls into stories at a quiet day: a headline a day after the one before begins another story of the name)
const BURST_GAP_MS = 24 * 3600e3;
const OUTLETS_PER_STORY_MAX = 40;

/** A headline's words, without the outlet's own tail ("... - <Outlet>"): two outlets printing one headline print the same words. */
const copyKey = (title) => String(title || '').toLowerCase().replace(/\s[-–—|]\s[^-–—|]{2,60}$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A name's rows as stories: [[{ voice, t }]], each outlet's first headline of each burst. rows: [{ outlet, t }]. */
function burstsOf(rows) {
  const sorted = rows.filter((r) => r && Number.isFinite(r.t) && r.outlet).sort((a, b) => a.t - b.t);
  const out = [];
  let cur = null;
  let last = -Infinity;
  for (const r of sorted) {
    if (r.t - last > BURST_GAP_MS) { cur = new Map(); out.push(cur); }
    last = r.t;
    const v = outletKey(r.outlet);
    if (v && !cur.has(v)) cur.set(v, r.t);
  }
  return out.map((m) => [...m.entries()].map(([voice, t]) => ({ voice, t })).slice(0, OUTLETS_PER_STORY_MAX));
}

/** Every searched name's news rows: [[{ outlet, t, title }]] (talk- lookups' tpnews and tprecent). lookups: Map. */
function namesOf(lookups) {
  const out = [];
  if (!lookups || typeof lookups.entries !== 'function') return out;
  for (const [k, l] of lookups.entries()) {
    if (!String(k).startsWith('talk-') || !l) continue;
    out.push([...((l.tpnews && l.tpnews.rows) || []), ...((l.tprecent && l.tprecent.rows) || [])].map((r) => ({ outlet: r.publisher || null, t: r.t, title: r.title })));
  }
  return out;
}
const storiesOf = (lookups) => namesOf(lookups).flatMap(burstsOf);

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Per outlet, how many of its headlines copy an earlier one of another outlet: Map outlet -> { n, copies }. names: [[{ outlet, t, title }]]. */
function copiesOf(names) {
  const per = new Map();
  for (const rows of names) {
    const byKey = new Map();
    for (const r of rows) {
      const o = r && r.outlet ? outletKey(r.outlet) : null;
      const k = r ? copyKey(r.title) : '';
      if (!o || !k || !Number.isFinite(r.t)) continue;
      const list = byKey.get(k) || [];
      if (!list.some((x) => x.o === o)) list.push({ o, t: r.t });
      byKey.set(k, list);
    }
    for (const list of byKey.values()) {
      list.sort((a, b) => a.t - b.t || a.o.localeCompare(b.o));
      list.forEach((x, i) => { const p = per.get(x.o) || { n: 0, copies: 0 }; p.n += 1; if (i > 0) p.copies += 1; per.set(x.o, p); });
    }
  }
  return per;
}

/**
 * The table from a store's searched names ([[{ outlet, t, title }]]): { voiceOf(outlet key) -> the voice it is one with, rehost(outlet
 * key) -> whether it only re-hosts others' headlines, pairs, merged, rehosts, outlets, stories }. Pure.
 */
function learn(names) {
  const stories = names.flatMap(burstsOf);
  const pairs = new Map();
  for (const s of stories) {
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        if (s[i].voice === s[j].voice) continue;
        const k = pairKey(s[i].voice, s[j].voice);
        const p = pairs.get(k) || { n: 0, near: 0 };
        p.n += 1;
        if (Math.abs(s[i].t - s[j].t) <= SAME_MINUTES * 60e3) p.near += 1;
        pairs.set(k, p);
      }
    }
  }
  const parent = new Map();
  const find = (x) => { let r = x; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r); return r; };
  let merged = 0;
  for (const [k, p] of pairs) {
    if (p.n < SAME_MIN || p.near < SAME_SHARE * p.n) continue;
    merged += 1;
    const [a, b] = k.split('|');
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const rehosts = new Set([...copiesOf(names).entries()].filter(([, p]) => p.n >= SAME_MIN && p.copies >= SAME_SHARE * p.n).map(([o]) => o));
  const outlets = new Set(stories.flatMap((s) => s.map((x) => x.voice))).size;
  return { voiceOf: (v) => find(v), rehost: (v) => rehosts.has(v), pairs: pairs.size, merged, rehosts: rehosts.size, outlets, stories: stories.length };
}

const MEMO = new WeakMap();
/** The table of a store's lookups, learned once per lookups map. */
function tableOf(lookups) {
  if (!lookups || typeof lookups !== 'object') return learn([]);
  const old = MEMO.get(lookups);
  if (old) return old;
  const t = learn(namesOf(lookups));
  MEMO.set(lookups, t);
  return t;
}

module.exports = { learn, namesOf, storiesOf, burstsOf, copiesOf, copyKey, tableOf, pairKey, SAME_MINUTES, SAME_SHARE, SAME_MIN, BURST_GAP_MS };
