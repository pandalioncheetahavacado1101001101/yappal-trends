'use strict';
/*
 * Early names (wave 10): a people-drama name that two independent voices tell in the store's last 36 hours is searched in the same
 * cycle, before it lists. Until now a name only the newer readings make (`late`, engine/talk-candidates.js) waited for its listing
 * to be searched, and a name made before waited behind the backlog: the hours a person's story sat before lists() were the hours
 * nobody searched the name (ios/.review/learn/2026-10-31-fast-lane.md: 77-98% of them).
 *
 *   told    the engine's names pass (engine/build.js names: TC.earlyTold): each people-drama name of the pool with the rows of the
 *           last 36 hours that name it and say a drama family of its own.
 *   voices  as the fast lane hears them (lib/voices/fastlane.js voiceOf): one outlet (outlets the store shows printing one headline
 *           are the first printer's voice; a re-host none, lib/voices/syndication.js), the boards (Reddit), Bluesky. A far or blocked
 *           outlet's copy is no voice.
 *   rule    two voices, the first inside the 36 hours (a young chapter), and no search of the name since that first row: a name
 *           searched since its chapter began is the queue's own (lib/budget.js re-searches it as its row rises); nor a name whose
 *           chapter rows all name someone else searched since (the story is in hand: on a recording, searching the other party of a
 *           listed split moved the story to that name's row and off every list). Only a name tied to the audiences' world (the
 *           drama step's `home`, a search in an audience's country, the roster): a far region's own story is its own press's.
 *   seats   inside the search budget, never a request more: early names take the research seats of the cycle (lib/budget.js
 *           pickNames `later`, RESEARCH_PER_CYCLE = 2 of the cycle's 12 name searches: a listed row's search again after 3 or 8
 *           hours, the stale end of the queue), creators first, then the most voices, then the newest second voice. A research
 *           name a seat goes to waits a cycle.
 *
 * Rank, never filter: a search only brings a name's headlines; every gate, title, line and claim rule of lists() is unchanged.
 * IDEAS_SEARCH_EARLY unset: the default below (on); `on` (or 1): the names are searched ("[early-names] searched s of n (k searched
 * by the queue anyway)"); `shadow`: counted only ("[early-names] would search n (k searched), s research seats"); `0` or `off`: today's
 * behaviour, no count. Counts only in the log and the cycle summary (`early`), never a name.
 * Collector only, wave 10. Sources: none new (the store's own rows).
 */
const FL = require('./voices/fastlane');
const SYN = require('./voices/syndication');
const { HOUR } = require('./util');

const CHAPTER_MS = 36 * HOUR * 1000;
const VOICES_MIN = 2;
// (the research seats of a cycle, lib/budget.js RESEARCH_PER_CYCLE: early names take them, never more)
const SEATS = 2;
// the default when IDEAS_SEARCH_EARLY is unset: on (wave 10's measurement: the frozen days hold, 0.799 / 0.596 / 0.342, with as many
// requests every cycle; page one unchanged in every count on 35 recorded lists; the rule's names joined a proven story, a 20K+ search
// or a gold story 7 of 14 times over 8 replayed days, the queue's own people-drama searches 20 of 51)
const DEFAULT_MODE = 'on';

/** The switch: 'on', 'shadow' or 'off'. */
function mode(env = process.env) {
  const v = String((env && env.IDEAS_SEARCH_EARLY) || '').trim().toLowerCase();
  if (v === 'on' || v === '1' || v === 'act' || v === 'true') return 'on';
  if (v === 'shadow') return 'shadow';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return DEFAULT_MODE;
}

/**
 * One name's voices at `now`: { first (ms, its chapter's first row), two (ms the second voice spoke, or null), voices (count) }.
 * rows: the told rows ([{ t, title, outlet, fam, blocked, far }]); table: the build's syndication table or null.
 */
function voicesOf(rows, now, table = null) {
  const own = (rows || []).filter((r) => r && Number.isFinite(r.t) && r.t <= now && now - r.t <= CHAPTER_MS).sort((a, b) => a.t - b.t);
  if (!own.length) return { first: null, two: null, voices: 0 };
  // (a headline another outlet printed first, word for word, is the first printer's voice)
  const printed = new Map();
  for (const r of own) { const k = SYN.copyKey(r.title); if (k && !printed.has(k)) printed.set(k, r); }
  const by = new Map();
  for (const r of own) {
    const k = SYN.copyKey(r.title);
    const src = k && printed.has(k) ? printed.get(k) : r;
    // (a far or blocked outlet's copy speaks for its own region, not for the audiences' world)
    const v = src.far || src.blocked ? null : FL.voiceOf(src, table);
    if (v && !by.has(v)) by.set(v, r.t);
  }
  const ts = [...by.values()].sort((a, b) => a - b);
  return { first: own[0].t, two: ts.length >= VOICES_MIN ? ts[VOICES_MIN - 1] : null, voices: ts.length };
}

/**
 * The early names of a cycle. told: the names pass's `told`; now: ms; searchedAt: Map(talk key -> epoch seconds of its news search);
 * talkKey: (name) => its search key; table: the syndication table (or null). Returns { names: [{ key, name, creator, voices, two }]
 * in seat order (every name the rule meets, the queue's to cut), met (how many meet it) }.
 */
function pick(told, { now, searchedAt = new Map(), talkKey = (n) => n, table = null } = {}) {
  const out = [];
  for (const n of told || []) {
    const v = voicesOf(n.rows, now, table);
    if (v.two === null) continue;
    const at = searchedAt.get(talkKey(n.key));
    // (searched since the chapter's first row: the queue's own)
    if (Number.isFinite(at) && at * 1000 >= v.first) continue;
    // (every row of the chapter names someone else searched since that row: the story is in hand through that search, and a search of
    // this name would only move the story to another name's row)
    const young = (n.rows || []).filter((r) => Number.isFinite(r.t) && r.t <= now && now - r.t <= CHAPTER_MS);
    const covered = (r) => (r.others || []).some((o) => { const t = searchedAt.get(talkKey(o)); return Number.isFinite(t) && t * 1000 >= r.t; });
    if (young.length && young.every(covered)) continue;
    out.push({ key: talkKey(n.key), name: n.key, creator: !!n.creator, late: !!n.late, voices: v.voices, two: v.two, first: v.first });
  }
  out.sort((a, b) => Number(b.creator) - Number(a.creator) || b.voices - a.voices || b.two - a.two || a.key.localeCompare(b.key));
  return { names: out, met: out.length };
}

/**
 * The cycle's log line, counts only: met (names the rule meets), searched (of them, the queue searched anyway this cycle), seated
 * (research seats they take, or would take in shadow).
 */
function line(m, { met = 0, searched = 0, seated = 0 } = {}) {
  if (m === 'off') return null;
  return m === 'on' ? `[early-names] searched ${seated} of ${met} (${searched} searched by the queue anyway)` : `[early-names] would search ${met} (${searched} searched), ${seated} research seats`;
}

module.exports = { mode, voicesOf, pick, line, SEATS, VOICES_MIN, CHAPTER_MS, DEFAULT_MODE };
