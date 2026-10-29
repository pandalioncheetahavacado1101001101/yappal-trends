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
 *
 * The creator-native voice (wave 11): a third family beside the outlets and the boards. What the creators' own world shows of a person
 * in the last 36 hours, as lib/native-signals.js reads the ledger it already keeps (no request more): another roster channel's upload
 * naming them in a title about trouble (toldOf's upload voice: a reaction video), two such channels inside a day (the creators
 * cluster), and the platform's own act (a ban flag that flipped, a ban event, followers falling). One family however many channels:
 * a name one outlet tells and the creators' world tells too meets the two-voice rule. A reaction's title is a voice only: only its
 * time and its kind reach here, never its words, so it is never a line, a title or a claim.
 * IDEAS_CREATOR_NATIVE unset: the default below (shadow); `on` (or 1): the voice counts for the seats; `shadow`: counted only
 * ("[creator-native] would add n early names (v told names with the voice), s research seats (u uploads, c clusters, p platform)"); `0` or `off`:
 * not read at all (the cycle as wave 10). Counts only in the log and the summary (`early.native`), never a name.
 * Measured (ios/.review/learn/2026-11-02-creator-native.md): a reaction upload as a voice joined a proven story, a 20K+ search or a
 * gold story within 48 hours on 10 of 42 names (0.24) over 8 replayed days and 2 of 26 (0.08) over a second week; with one outlet
 * voice 4 of 12. Under the 0.5 on 20 the seats ask for: shadow until the live counts say otherwise.
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
// (the creator-native family: one voice whatever the channel; and its switch's default while no signal of it is measured at 0.5 on 20)
const NATIVE_VOICE = 'creator-native';
const NATIVE_DEFAULT = 'shadow';
const NATIVE_KINDS = new Set(['upload', 'cluster', 'platform']);

/** The switch: 'on', 'shadow' or 'off'. */
function mode(env = process.env) {
  const v = String((env && env.IDEAS_SEARCH_EARLY) || '').trim().toLowerCase();
  if (v === 'on' || v === '1' || v === 'act' || v === 'true') return 'on';
  if (v === 'shadow') return 'shadow';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return DEFAULT_MODE;
}

/** The creator-native switch (IDEAS_CREATOR_NATIVE): 'on', 'shadow' or 'off'. */
function nativeMode(env = process.env) {
  const v = String((env && env.IDEAS_CREATOR_NATIVE) || '').trim().toLowerCase();
  if (v === 'on' || v === '1' || v === 'act' || v === 'true') return 'on';
  if (v === 'shadow') return 'shadow';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return NATIVE_DEFAULT;
}

/**
 * The creators' own world's voices for each person the native signals are about (lib/native-signals.js peopleOf), as the early rule
 * counts them: Map(person key -> [{ t (ms), k: 'upload' | 'cluster' | 'platform' }]) inside the chapter window. Only times and kinds:
 * a reaction's title never travels with it. people: the Map peopleOf returns; now: ms.
 */
function creatorVoices(people, now) {
  const out = new Map();
  const within = (ms) => Number.isFinite(ms) && ms <= now && now - ms <= CHAPTER_MS;
  for (const p of (people && people.values ? people.values() : [])) {
    if (!p || typeof p.key !== 'string' || !p.key) continue;
    const vs = [];
    // (another channel's upload naming them in a title about trouble: toldOf's upload voice, a channel's own uploads never in it)
    for (const i of p.told || []) if (i && i.k === 'upload' && within(i.t * 1000)) vs.push({ t: i.t * 1000, k: 'upload' });
    const kinds = p.kinds || {};
    if (kinds.creators && within(kinds.creators.at * 1000)) vs.push({ t: kinds.creators.at * 1000, k: 'cluster' });
    if (kinds.platform && within(kinds.platform.at * 1000)) vs.push({ t: kinds.platform.at * 1000, k: 'platform' });
    if (vs.length) out.set(p.key, vs.sort((a, b) => a.t - b.t));
  }
  return out;
}

/**
 * One name's voices at `now`: { first (ms, its chapter's first row), two (ms the second voice spoke, or null), voices (count) }.
 * rows: the told rows ([{ t, title, outlet, fam, blocked, far }], and the creator-native ones { t, native: true, k }); table: the
 * build's syndication table or null; native: whether the creator-native rows count (else they are not read at all).
 */
function voicesOf(rows, now, table = null, { native = false } = {}) {
  const own = (rows || []).filter((r) => r && Number.isFinite(r.t) && r.t <= now && now - r.t <= CHAPTER_MS && (!r.native || (native && NATIVE_KINDS.has(r.k)))).sort((a, b) => a.t - b.t);
  if (!own.length) return { first: null, two: null, voices: 0 };
  // (a headline another outlet printed first, word for word, is the first printer's voice)
  const printed = new Map();
  for (const r of own) { const k = r.native ? null : SYN.copyKey(r.title); if (k && !printed.has(k)) printed.set(k, r); }
  const by = new Map();
  for (const r of own) {
    // (the creators' world: one family, timed by its first voice)
    if (r.native) { if (!by.has(NATIVE_VOICE)) by.set(NATIVE_VOICE, r.t); continue; }
    const k = SYN.copyKey(r.title);
    const src = k && printed.has(k) ? printed.get(k) : r;
    // (a far or blocked outlet's copy speaks for its own region, not for the audiences' world)
    const v = src.far || src.blocked ? null : FL.voiceOf(src, table);
    if (v && !by.has(v)) by.set(v, r.t);
  }
  const ts = [...by.values()].sort((a, b) => a - b);
  return { first: own[0].t, two: ts.length >= VOICES_MIN ? ts[VOICES_MIN - 1] : null, voices: ts.length, native: by.has(NATIVE_VOICE) };
}

/**
 * The early names of a cycle. told: the names pass's `told`; now: ms; searchedAt: Map(talk key -> epoch seconds of its news search);
 * talkKey: (name) => its search key; table: the syndication table (or null); native: whether the creator-native voice counts (its rows
 * are `n.native`, earlyTold's). Returns { names: [{ key, name, creator, voices, two, native }] in seat order (every name the rule meets,
 * the queue's to cut), met (how many meet it), withNative (how many of them a creator-native voice is one of the two) }.
 */
function pick(told, { now, searchedAt = new Map(), talkKey = (n) => n, table = null, native = false } = {}) {
  const out = [];
  for (const n of told || []) {
    const v = voicesOf(native ? [...(n.rows || []), ...(n.native || []).map((r) => ({ ...r, native: true }))] : n.rows, now, table, { native });
    if (v.two === null) continue;
    const at = searchedAt.get(talkKey(n.key));
    // (searched since the chapter's first row: the queue's own)
    if (Number.isFinite(at) && at * 1000 >= v.first) continue;
    // (every row of the chapter names someone else searched since that row: the story is in hand through that search, and a search of
    // this name would only move the story to another name's row)
    const young = (n.rows || []).filter((r) => Number.isFinite(r.t) && r.t <= now && now - r.t <= CHAPTER_MS);
    const covered = (r) => (r.others || []).some((o) => { const t = searchedAt.get(talkKey(o)); return Number.isFinite(t) && t * 1000 >= r.t; });
    if (young.length && young.every(covered)) continue;
    out.push({ key: talkKey(n.key), name: n.key, creator: !!n.creator, late: !!n.late, voices: v.voices, two: v.two, first: v.first, native: !!v.native });
  }
  out.sort((a, b) => Number(b.creator) - Number(a.creator) || b.voices - a.voices || b.two - a.two || a.key.localeCompare(b.key));
  return { names: out, met: out.length, withNative: out.filter((x) => x.native).length };
}

/**
 * The creator-native line, counts only: added (early names the voice adds to the rule's: met with it and not without it), seated (of
 * them, research seats they take, or would take in shadow), voiced (told names carrying the voice at all), the kinds of voice the added names carry, and of the names it added a day ago,
 * how many a search or the list then joined (lib/voices/native-log.js). null when off.
 */
function nativeLine(m, { added = 0, voiced = 0, seated = 0, uploads = 0, clusters = 0, platform = 0, joined = null, settled = null } = {}) {
  if (m === 'off') return null;
  const kinds = `${uploads} uploads, ${clusters} clusters, ${platform} platform`;
  const day = Number.isFinite(joined) && Number.isFinite(settled) ? `; joined ${joined} of ${settled} a day on` : '';
  return m === 'on' ? `[creator-native] added ${added} early names (${voiced} told names with the voice), ${seated} seated (${kinds})${day}` : `[creator-native] would add ${added} early names (${voiced} told names with the voice), ${seated} research seats (${kinds})${day}; shadow`;
}

/**
 * The cycle's log line, counts only: met (names the rule meets), searched (of them, the queue searched anyway this cycle), seated
 * (research seats they take, or would take in shadow).
 */
function line(m, { met = 0, searched = 0, seated = 0 } = {}) {
  if (m === 'off') return null;
  return m === 'on' ? `[early-names] searched ${seated} of ${met} (${searched} searched by the queue anyway)` : `[early-names] would search ${met} (${searched} searched), ${seated} research seats`;
}

module.exports = { mode, nativeMode, creatorVoices, voicesOf, pick, line, nativeLine, SEATS, VOICES_MIN, CHAPTER_MS, DEFAULT_MODE, NATIVE_DEFAULT, NATIVE_VOICE };
