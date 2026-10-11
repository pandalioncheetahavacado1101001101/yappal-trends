'use strict';
/*
 * Measured status (ios/IDEAS-FEED.md section C): everything the feed says about a trend's motion, as pure functions of its series. No
 * I/O, no clock: `t` is always handed in (epoch seconds), so every definition is unit-tested on hand-made series (test/measure.test.js).
 *
 * A sample here is one row of `samples` as lib/history.js reads it:
 *   { t, res, interest (0-100 or null), observed (bool), backfilled (bool),
 *     p: { s, n, c, r, w } (each part of I as sampled, 0-1, or null when that part was not read this cycle),
 *     sv (largest home search band, or null), sg, cr, ytH, ttVideos, rdRank, soc }
 * Windows are measured in time, never in sample counts: a cycle that never ran leaves a gap, nothing else.
 */
const { clamp, median, mean, HOUR, DAY } = require('./util');

// ---------- the constants (tuned with the scoreboard; the feed carries results, never these) ----------
const K = {
  WEIGHTS: { s: 45, n: 20, c: 15, r: 12, w: 8 },
  // how long a part not sampled this cycle keeps its last value: as long as that part's own sampling gap (A4)
  HOLD: { s: 45 * 60, n: 3 * HOUR, nPastPage: 8 * HOUR, c: 3 * HOUR, r: 6 * HOUR, w: 36 * HOUR },
  SEARCH_HALF_LIFE: 12 * HOUR,
  WINDOW: { talk: 3 * HOUR, moment: 3 * HOUR, word: 24 * HOUR, sound: 24 * HOUR },
  V_RISE: { talk: 1.5, moment: 1.5, word: 0.25, sound: 0.25 },
  SHARE_RISING: 0.85,
  SHARE_FADING: 0.5,
  // (a peak under this is no signal to measure: the engine's own status stands)
  PEAK_MIN: 5,
  WINDOW_MIN_SAMPLES: 2,
  CLIMB_BACK: [30 * 60, 60 * 60],
  CLIMB_YOUNG: 6 * HOUR,
  RISING_MET_WITHIN: 2 * HOUR,
  NOT_FALLEN_SLACK: 1,
  QUIET: { talk: 24 * HOUR, moment: 24 * HOUR, word: 7 * DAY, sound: 7 * DAY },
  STILL_TOLD_DAYS: 8,
  STILL_TOLD_N24: 2,
  // (by a story's own items, each carrying its own time: collapsed is at most one of its own in the last day where its busiest day,
  // a day and a half behind or more, had four or more; young and arriving faster is what Early reads before any series exists)
  COLLAPSE_SHARE: 0.25,
  COLLAPSE_PEAK_BEHIND: 36 * HOUR,
  COLLAPSE_PEAK_ITEMS: 4,
  ITEMS_RISING_SPAN: 12 * HOUR,
  ITEMS_RISING_MIN: 2,
  ITEMS_RISING_FRESH: 6 * HOUR,
  // Early (C3)
  // (judges, 2026-10-11: a story 32 hours old with four outlets is small, not early. The tag is given inside a story's first day,
  // goes two days after its start, and a start inside the last twelve hours with a curve that climbs is evidence at first sight)
  EARLY_ENTRY_AGE: 24 * HOUR,
  EARLY_MAX_AGE: 48 * HOUR,
  EARLY_FRESH: 12 * HOUR,
  EARLY_OUTLETS: 5,
  EARLY_SEARCH: 50000,
  EARLY_KIND_SPAN: 6 * HOUR,
  EARLY_GAP: 40 * 60,
  EARLY_HOURLY_SPAN: 4 * HOUR,
  EARLY_GROWTH: 1.5,
  EARLY_NOT_CLIMBING: 3,
  EARLY_LIFE: 24 * HOUR,
  EARLY_KINDS: ['search', 'beat', 'reddit', 'creators', 'tiktok', 'social', 'clips', 'meme'],
  // started (C4)
  START_RUN: 36 * HOUR,
  START_SEARCH_SLACK: 48 * HOUR,
  // (a name's own search looks back this far; a start found within START_EDGE of where the looking began is no start)
  NAME_SEARCH_WINDOW: 7 * DAY,
  START_EDGE: 24 * HOUR,
  // peak (C5), urgency (C6)
  PEAK_BEHIND: 2 * HOUR,
  URGENT_AGE: 36 * HOUR,
  URGENT_LEFT_MAX: 72,
  URGENT_MAX: 3,
  SPIKE_AGE: 24 * HOUR,
  SPIKE_SEARCH: 100000,
  SPIKE_KINDS: 3,
  FLARE_AGE: 12 * HOUR,
  // time left (C7)
  END_SHARE: 0.25,
  END_STAY: { talk: 6 * HOUR, moment: 6 * HOUR, word: 48 * HOUR, sound: 48 * HOUR },
  LEFT_COMPARABLES: 15,
  LEFT_SPREAD: 1.5,
  LEFT_MIN_AGE: 2 * HOUR,
  LEFT_MIN: 6,
  LEFT_MAX: 168,
  LEFT_FIT_SAMPLES: 6,
  LEFT_FIT_R2: 0.6,
  LEFT_CHAPTER_QUIET: 24 * HOUR,
  LEFT_DAY_PRECISION_MIN: 48,
  COMPARABLE_DAYS: 120,
  // (what a class typically lives, in hours, used only until fifteen ended trends of the class give a measured answer: IDEAS-SPEC
  // "Buzz", a talking point is gone about three days past its peak and the week's people-drama stays up to eight days while told.
  // A story with a 100K search lives a day longer. A new collector would otherwise show no time left on any card for weeks)
  LIFE_PRIOR: { 'creator-drama': 120, 'celebrity-drama': 96, story: 72 },
  LIFE_PRIOR_BIG: 24,
  LEFT_FADING_MAX: 48,
  BIG_SEARCH: 100000,
};
const SEARCH_BANDS = [200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
/** A search volume's band index (0 = under 200). */
const bandIndex = (v) => SEARCH_BANDS.filter((b) => (v || 0) >= b).length;
const windowOf = (kind) => K.WINDOW[kind] || K.WINDOW.talk;

// ---------- C1 interest ----------
/** band(v): 20K 0.39, 100K 0.61, 1M 0.91. */
const band = (v) => clamp(Math.log10(Math.max(1, v || 0) / 1000) / 3.3);
/**
 * The five parts of I as one cycle read them, each 0-1, or null when that part was not sampled:
 *   search    { volume (largest home band), live, endedAgo (seconds since it stopped trending) } or null
 *   press     own headlines in the look-back (3 hours for a talking point or a moment, the window W for a word or a sound) or null
 *   creators  creator-native items in the same look-back, and the hourly growth of yt_h / tt_videos when an adapter gives one
 *   community { rdRank (1 = top, null in none), soc (0-1) } or null
 *   reads     Wikipedia views on the last full day, or null
 */
function partsOf({ search = null, press = null, creators = null, community = null, reads = null } = {}) {
  const s = search === null ? null : band(search.volume) * (search.live ? 1 : Math.pow(0.5, Math.max(0, search.endedAgo || 0) / K.SEARCH_HALF_LIFE));
  const n = press === null ? null : clamp(Math.log2(1 + Math.max(0, press)) / 6);
  const c = creators === null ? null : Math.max(clamp(Math.log2(1 + Math.max(0, creators.items || 0)) / 5), clamp(Math.log2(1 + Math.max(0, creators.growth || 0)) / 5));
  const r = community === null ? null : Math.max(Number.isFinite(community.rdRank) ? clamp(1 - (community.rdRank - 1) / 50) : 0, clamp(community.soc || 0));
  const w = reads === null ? null : clamp(Math.log10(Math.max(1, reads) / 10000) / 2);
  return { s, n, c, r, w };
}
/**
 * Each part with carrying done (C1): a part not sampled at `t` keeps the value of the newest earlier sample that did sample it, for
 * that part's hold time, then counts 0. `earlier`: the trend's samples before `t`, oldest first. pastPage: its name is searched only
 * every 8 hours, so its press holds that long.
 */
function carried(parts, earlier, t, { pastPage = false } = {}) {
  const out = {};
  for (const key of ['s', 'n', 'c', 'r', 'w']) {
    if (parts[key] !== null && parts[key] !== undefined) { out[key] = parts[key]; continue; }
    const hold = key === 'n' && pastPage ? K.HOLD.nPastPage : K.HOLD[key];
    let value = 0;
    for (let i = earlier.length - 1; i >= 0; i--) {
      const smp = earlier[i];
      if (smp.t >= t) continue;
      if (t - smp.t > hold) break;
      if (smp.p && smp.p[key] !== null && smp.p[key] !== undefined) { value = smp.p[key]; break; }
    }
    out[key] = value;
  }
  return out;
}
/** I = 45 S + 20 N + 15 C + 12 R + 8 W, 0-100, one decimal. */
const interestOf = (p) => Math.round(10 * (K.WEIGHTS.s * p.s + K.WEIGHTS.n * p.n + K.WEIGHTS.c * p.c + K.WEIGHTS.r * p.r + K.WEIGHTS.w * p.w)) / 10;
/** Whether a cycle observed the trend (B1): one of its own fast parts was actually read (search, press, creators or community). */
const isObserved = (p) => ['s', 'n', 'c', 'r'].some((k) => p[k] !== null && p[k] !== undefined);

/** The smoothed series Ī: at each sample, the median of the last three samples' interest. [{ t, i, observed, backfilled }], oldest first. */
function smooth(samples) {
  const rows = samples.filter((s) => Number.isFinite(s.interest)).sort((a, b) => a.t - b.t);
  return rows.map((s, at) => ({ t: s.t, i: median(rows.slice(Math.max(0, at - 2), at + 1).map((x) => x.interest)), observed: !!s.observed, backfilled: !!s.backfilled }));
}

/**
 * C1 at `t`: { ibar (Ī now), L0, L1, L2 (window means, null with fewer than two samples), v, v1 (points an hour), a, peak (P), peakAt,
 * share (L0 / P), nowShare (Ī now / P), measured, climbing (true, false, or null when unknown) }. `known`: the peak the trend already holds
 * ({ peakInterest, peakAt }: compaction never lowers it).
 */
function measure(samples, t, kind, known = {}) {
  // (the rebuilt stretch is the press's and the creators' shape alone, no search and no reads: B1. Its level is another scale, so the
  // windows, the velocity and the climb are read from what the collector sampled itself; where it began to watch is no jump. The
  // peak is the trend's whole life's, rebuilt hours included: a story met after its peak still has one)
  const life = smooth(samples).filter((x) => x.t <= t);
  const series = smooth(samples.filter((s) => !s.backfilled)).filter((x) => x.t <= t);
  const W = windowOf(kind);
  const hours = W / HOUR;
  const inWindow = (k) => series.filter((x) => x.t > t - (k + 1) * W && x.t <= t - k * W);
  const win = [0, 1, 2].map(inWindow);
  const level = (xs) => (xs.length >= K.WINDOW_MIN_SAMPLES ? mean(xs.map((x) => x.i)) : null);
  const [L0, L1, L2] = win.map(level);
  const v = L0 !== null && L1 !== null ? (L0 - L1) / hours : null;
  const v1 = L1 !== null && L2 !== null ? (L1 - L2) / hours : null;
  const a = v !== null && v1 !== null ? (v - v1) / hours : null;
  let peak = Number.isFinite(known.peakInterest) ? known.peakInterest : 0;
  let peakAt = Number.isFinite(known.peakAt) ? known.peakAt : null;
  // (the latest, on a tie)
  for (const x of life) if (x.i > peak || (x.i === peak && x.i > 0 && (peakAt === null || x.t >= peakAt))) { peak = x.i; peakAt = x.t; }
  const observedIn = (xs) => xs.filter((x) => x.observed).length;
  const measured = L0 !== null && L1 !== null && observedIn(win[0]) >= K.WINDOW_MIN_SAMPLES && observedIn(win[1]) >= K.WINDOW_MIN_SAMPLES && peak >= K.PEAK_MIN;
  const ibar = series.length ? series[series.length - 1].i : null;
  // (share: the last window against the peak, what fading and the half-life read; nowShare: the newest point against it, what rising
  // reads: a climb's window mean trails its own newest point, so a fast riser would never be "at its peak" by its window)
  return { t, ibar, L0, L1, L2, v, v1, a, peak, peakAt, share: L0 !== null && peak > 0 ? L0 / peak : null, nowShare: ibar !== null && peak > 0 ? ibar / peak : null, measured,
    climbing: climbingAt(series, t) };
}

/**
 * Climbing (the quick test for rows too young for v): the newest observed Ī is above the observed Ī of 30 to 60 minutes before. null
 * when there is no such pair (the caller then reads a start inside the last 6 hours as yes).
 */
function climbingAt(series, t) {
  const seen = series.filter((x) => x.observed && x.t <= t);
  if (seen.length < 2) return null;
  const newest = seen[seen.length - 1];
  const before = seen.filter((x) => newest.t - x.t >= K.CLIMB_BACK[0] && newest.t - x.t <= K.CLIMB_BACK[1]).pop();
  return before ? newest.i > before.i : null;
}
/** Climbing as Early and the unmeasured rising rule read it: yes, no, or (unknown) yes only for a start to the hour inside the last 6 hours. */
function isClimbing(m, { t, startedAt, startedPrecision }) {
  if (m.climbing !== null) return m.climbing;
  return startedPrecision === 'hour' && Number.isFinite(startedAt) && t - startedAt <= K.CLIMB_YOUNG && t >= startedAt;
}

// ---------- C2 rising, peaking, fading ----------
/**
 * The test of one cycle, before hysteresis: 'rising', 'fading', 'peaking', or null when nothing is measured and no unmeasured rule
 * speaks (the engine's own status then stands). ctx: { t, kind, startedAt, startedPrecision, firstSeen, chapterAt, n24, liveHome
 * (still trending in a home country), lastSignalAt (the newest sample with interest above 0, else the first sample) }.
 */
function statusTest(m, samples, ctx) {
  const { t, kind } = ctx;
  const W = windowOf(kind);
  const vRise = K.V_RISE[kind] || K.V_RISE.talk;
  const byHour = ctx.startedPrecision === 'hour' && Number.isFinite(ctx.startedAt);
  const newChapter = Number.isFinite(ctx.chapterAt) && t - ctx.chapterAt <= W && t >= ctx.chapterAt;
  // 1 rising
  if (m.measured && m.v >= vRise && m.nowShare >= K.SHARE_RISING) return 'rising';
  if (m.measured && newChapter && m.v > 0) return 'rising';
  // (flared again: after half a day of nothing its own people answered, inside this window, by a headline's own time: lib/desk.js)
  if (newChapter && ctx.flare) return 'rising';
  // (young by its own start, never by when the collector happened to meet it: a cold start makes nothing rising)
  if (byHour && t - ctx.startedAt <= W && t >= ctx.startedAt && Number.isFinite(ctx.firstSeen) && ctx.firstSeen - ctx.startedAt <= K.RISING_MET_WITHIN && notFallen(samples, t)) return 'rising';
  // 2 fading: never while it is still told or searched within 8 days of its start
  const stillTold = ((ctx.n24 || 0) >= K.STILL_TOLD_N24 || !!ctx.liveHome) && Number.isFinite(ctx.startedAt) && t - ctx.startedAt <= K.STILL_TOLD_DAYS * DAY;
  // (by its own items' times, measured or not: nothing of its own for a day while no search is live at home; or, for a story, one
  // item at most in the last day where its busiest day had four or more, a day and a half behind. A card whose own graph has fallen
  // to a fifth of its peak does not say "Peaking" on a status nobody measured: judges, 2026-10-11)
  const items = ctx.items || null;
  if (items && !ctx.liveHome && !newChapter) {
    const quiet = K.QUIET[kind] || K.QUIET.talk;
    if (Number.isFinite(items.lastAt) && t - items.lastAt >= quiet) return 'fading';
    // (never while it is still told: two or more of its own in the last day keep it at its peak, however old. IDEAS-SPEC "Buzz")
    if ((kind === 'talk' || kind === 'moment') && items.peakDay >= K.COLLAPSE_PEAK_ITEMS && Number.isFinite(items.peakDayAt) && t - items.peakDayAt >= K.COLLAPSE_PEAK_BEHIND &&
      items.lastDay < K.STILL_TOLD_N24 && items.lastDay <= K.COLLAPSE_SHARE * items.peakDay) return 'fading';
  }
  if (!stillTold) {
    if (m.measured && m.share < K.SHARE_FADING && m.v <= 0 && m.v1 !== null && m.v1 <= 0) return 'fading';
    if (Number.isFinite(ctx.lastSignalAt) && t - ctx.lastSignalAt >= (K.QUIET[kind] || K.QUIET.talk)) return 'fading';
  }
  // 3 peaking: everything else that is measured
  return m.measured ? 'peaking' : null;
}
/** Its observed Ī has not fallen since it was first met: the newest observed point is no lower than any before it (a point of slack). */
function notFallen(samples, t) {
  const seen = smooth(samples).filter((x) => x.observed && x.t <= t);
  if (!seen.length) return false;
  const newest = seen[seen.length - 1].i;
  return seen.every((x) => newest >= x.i - K.NOT_FALLEN_SLACK);
}
/**
 * A trend's own items by their own times (seconds): { lastAt (the newest), lastDay (how many in the 24 hours to `t`), peakDay (the
 * most in any 24 hours), peakDayAt (when that day ended), rising (young evidence: two or more in the last 12 hours, more than in the
 * 12 before, the newest inside 6 hours) }; null with none.
 */
function itemStats(times, t) {
  const xs = (times || []).filter((x) => Number.isFinite(x) && x <= t).sort((a, b) => a - b);
  if (!xs.length) return null;
  const within = (end, span) => xs.filter((x) => x > end - span && x <= end).length;
  let peakDay = 0;
  let peakDayAt = null;
  // (the busiest 24 hours end at one of the items: the latest of equals)
  for (const x of xs) { const n = within(x, DAY); if (n >= peakDay) { peakDay = n; peakDayAt = x; } }
  const now = within(t, K.ITEMS_RISING_SPAN);
  const before = within(t - K.ITEMS_RISING_SPAN, K.ITEMS_RISING_SPAN);
  const lastAt = xs[xs.length - 1];
  return { lastAt, lastDay: within(t, DAY), peakDay, peakDayAt, rising: now >= K.ITEMS_RISING_MIN && now > before && t - lastAt <= K.ITEMS_RISING_FRESH };
}

/** The newest time the trend's own signal was above 0 (else its first sample's time): what "no own signal for 24 hours" counts from. */
function lastSignalAt(samples, t) {
  const rows = samples.filter((s) => s.t <= t && Number.isFinite(s.interest)).sort((a, b) => a.t - b.t);
  if (!rows.length) return null;
  const live = rows.filter((s) => s.interest > 0).pop();
  return live ? live.t : rows[0].t;
}
/**
 * Hysteresis (C2): leaving rising, and entering fading, each need the test to hold on two cycles in a row; fading back to rising
 * needs a new chapter or v >= 2 x V_RISE (and sets chapter_at, never a new start).
 * prev: the status last published from a measurement (or null); testPrev: the last cycle's test; test: this cycle's; ctx.faded: it has
 * faded since it last rose.
 * Returns { status (null when no test spoke), chapter (true when a comeback from fading starts a new chapter) }. Whether the status is
 * a measurement is the caller's to say (C1: `measured`); an unmeasured rule's answer goes through the same hysteresis.
 */
function settle(prev, testPrev, test, m, ctx) {
  if (test === null) return { status: null, chapter: false };
  const vRise = K.V_RISE[ctx.kind] || K.V_RISE.talk;
  // (a comeback: from fading, or from the peaking a faded story passes through on its way back up)
  if ((prev === 'fading' || (ctx.faded && prev !== 'rising')) && test === 'rising') {
    const newChapter = Number.isFinite(ctx.chapterAt) && ctx.t - ctx.chapterAt <= windowOf(ctx.kind);
    if (newChapter) return { status: 'rising', chapter: false };
    if (m.v !== null && m.v >= 2 * vRise) return { status: 'rising', chapter: true };
    return { status: 'peaking', chapter: false };
  }
  if (prev === 'rising' && test !== 'rising' && testPrev === 'rising') return { status: 'rising', chapter: false };
  if (test === 'fading' && prev !== 'fading' && testPrev !== 'fading') return { status: 'peaking', chapter: false };
  return { status: test, chapter: false };
}

// ---------- C3 Early ----------
/**
 * Evidence by acceleration: one search or creator-native signal rising over three consecutive observed samples: each at least the one
 * before, the last 1.5x the first or one band higher, gaps of 40 minutes at most (an hourly source: three samples inside 4 hours).
 */
const ACCEL_SIGNALS = [
  { key: 'sv', of: (s) => s.sv, banded: true },
  { key: 'sg', of: (s) => s.sg },
  { key: 'cr', of: (s) => s.cr },
  { key: 'ytH', of: (s) => s.ytH },
  { key: 'ttVideos', of: (s) => s.ttVideos },
  // (a place in a list: higher is better)
  { key: 'rdRank', of: (s) => (Number.isFinite(s.rdRank) ? 51 - s.rdRank : null), hourly: true },
  { key: 'soc', of: (s) => s.soc, hourly: true },
];
function accelerating(samples, t) {
  const seen = samples.filter((s) => s.observed && s.t <= t).sort((a, b) => a.t - b.t);
  for (const sig of ACCEL_SIGNALS) {
    const pts = seen.map((s) => ({ t: s.t, x: sig.of(s) })).filter((p) => Number.isFinite(p.x)).slice(-3);
    // (three samples, the newest of them fresh: an old climb is no evidence now)
    if (pts.length < 3 || t - pts[2].t > (sig.hourly ? K.EARLY_HOURLY_SPAN : K.EARLY_GAP)) continue;
    const gaps = pts[1].t - pts[0].t <= K.EARLY_GAP && pts[2].t - pts[1].t <= K.EARLY_GAP;
    if (!gaps && !(sig.hourly && pts[2].t - pts[0].t <= K.EARLY_HOURLY_SPAN)) continue;
    if (!(pts[1].x >= pts[0].x && pts[2].x >= pts[1].x)) continue;
    const grew = sig.banded ? bandIndex(pts[2].x) > bandIndex(pts[0].x) || (pts[0].x > 0 && pts[2].x >= K.EARLY_GROWTH * pts[0].x) : pts[0].x > 0 ? pts[2].x >= K.EARLY_GROWTH * pts[0].x : pts[2].x > 0;
    if (grew) return sig.key;
  }
  return null;
}
/** Evidence by corroboration: two independent source kinds first seen within 6 hours of each other. kindFirst: { kind: epoch seconds }. */
function corroborated(kindFirst) {
  const times = K.EARLY_KINDS.map((k) => (kindFirst || {})[k]).filter(Number.isFinite).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] <= K.EARLY_KIND_SPAN) return true;
  return false;
}
/** How many of the Early kinds a trend has been seen in. */
const kindCount = (kindFirst) => K.EARLY_KINDS.filter((k) => Number.isFinite((kindFirst || {})[k])).length;
/** Proven for an audience: on its first page on its own heat, told by 5 outlets, or a 50K search at home. */
const proven = ({ onPage, outlets, homeSearch }) => !!onPage || (outlets || 0) >= K.EARLY_OUTLETS || (homeSearch || 0) >= K.EARLY_SEARCH;
/**
 * One cycle of the Early tag's life (a trend is Early once in its life). state: { earlyAt, earlyGoneAt, promotedAt, notClimbing (observed
 * cycles in a row without climbing) }. ctx: { t, startedAt, startedPrecision, sayable, grim, observed, evidence (accelerating or
 * corroborated), outlets, audiences: { US: { onPage, homeSearch }, ... } }.
 * Returns { state, early: { US: bool, ... } }: the tag an audience sees needs it unproven there; promotion anywhere, or decay, ends it
 * for good everywhere.
 */
function earlyStep(state, m, ctx) {
  const next = { earlyAt: state.earlyAt ?? null, earlyGoneAt: state.earlyGoneAt ?? null, promotedAt: state.promotedAt ?? null, notClimbing: state.notClimbing || 0 };
  const none = Object.fromEntries(Object.keys(ctx.audiences || {}).map((a) => [a, false]));
  // (its own items arriving faster is a climb the items themselves date: it needs no series, so it holds from the first cycle)
  const climbs = isClimbing(m, ctx) || (m.measured && m.v > 0) || !!ctx.itemsRising;
  if (ctx.observed) next.notClimbing = climbs ? 0 : next.notClimbing + 1;
  if (next.earlyGoneAt !== null || next.promotedAt !== null) return { state: next, early: none };
  const { t } = ctx;
  const byHour = ctx.startedPrecision === 'hour' && Number.isFinite(ctx.startedAt) && t >= ctx.startedAt;
  const young = byHour && t - ctx.startedAt <= K.EARLY_MAX_AGE;
  const firstDay = byHour && t - ctx.startedAt <= K.EARLY_ENTRY_AGE;
  // (at first sight: one board's post or one outlet's story, hours old, whose own curve or own items are climbing)
  const fresh = byHour && t - ctx.startedAt <= K.EARLY_FRESH && (m.climbing === true || !!ctx.itemsRising);
  const sayable = !!ctx.sayable && !ctx.grim;
  const provenIn = Object.fromEntries(Object.entries(ctx.audiences || {}).map(([a, x]) => [a, proven({ ...x, outlets: ctx.outlets })]));
  if (next.earlyAt !== null) {
    // promotion: it is then an ordinary rising row
    if (Object.values(provenIn).some(Boolean)) { next.promotedAt = t; return { state: next, early: none }; }
    // decay: the tag goes for good
    const decayed = next.notClimbing >= K.EARLY_NOT_CLIMBING || (m.measured && m.v <= 0 && m.v1 !== null && m.v1 <= 0) || t - next.earlyAt >= K.EARLY_LIFE || !young;
    if (decayed) { next.earlyGoneAt = t; return { state: next, early: none }; }
    // (it stays while it is still sayable and unproven; not climbing is the decay rule's to count)
    return { state: next, early: Object.fromEntries(Object.keys(provenIn).map((a) => [a, sayable && !provenIn[a]])) };
  }
  const holds = (!!ctx.evidence || fresh) && firstDay && climbs && sayable;
  const early = Object.fromEntries(Object.keys(provenIn).map((a) => [a, holds && !provenIn[a]]));
  if (Object.values(early).some(Boolean)) next.earlyAt = t;
  return { state: next, early };
}

// ---------- C4 started ----------
/**
 * The first moment the story's own signal appears: { at (epoch seconds), precision: 'hour' } from the earliest of
 *   the first own headline that has another within 36 hours (a lone earlier row is no start);
 *   the start of the current run of Trends entries for its own query, when no headline is earlier by more than 48 hours (nor is the
 *     entry itself more than 48 hours before the first headline: a name that trended for something else last week is no start);
 *   the first creator-native item (a post, an upload, a clip) followed by any other signal within 36 hours;
 *   `observedAt`: the first observed sample with interest above 0, handed in only when the trend is new by observation;
 * else { at: the origin day's noon UTC, precision: 'day' } when only a date is known (`originDay`, "YYYY-MM-DD"); else null.
 * headlines, creatorItems: epoch seconds; searches: [{ start, end (null while trending) }]; others: the times of signals that are no
 * start themselves but follow one (what people only lately type, a social trend); now: epoch seconds.
 */
function startedOf({ headlines = [], creatorItems = [], searches = [], others: more = [], observedAt = null, originDay = null, now }) {
  const hs = headlines.filter((x) => Number.isFinite(x) && x <= now).sort((a, b) => a - b);
  const cs = creatorItems.filter((x) => Number.isFinite(x) && x <= now).sort((a, b) => a - b);
  const candidates = [];
  const run = hs.find((h, i) => i + 1 < hs.length && hs[i + 1] - h <= K.START_RUN);
  if (run !== undefined) candidates.push(run);
  const search = searchRunStart(searches, now);
  if (search !== null && (!hs.length || (hs[0] >= search - K.START_SEARCH_SLACK && search >= hs[0] - K.START_SEARCH_SLACK))) candidates.push(search);
  const others = [...hs, ...(search !== null ? [search] : []), ...more.filter((x) => Number.isFinite(x) && x <= now)];
  const creator = cs.find((c, i) => (i + 1 < cs.length && cs[i + 1] - c <= K.START_RUN) || others.some((o) => o >= c && o - c <= K.START_RUN));
  if (creator !== undefined) candidates.push(creator);
  if (Number.isFinite(observedAt)) candidates.push(observedAt);
  if (candidates.length) return { at: Math.min(...candidates), precision: 'hour' };
  if (originDay && /^\d{4}-\d\d-\d\d$/.test(originDay)) return { at: Date.parse(`${originDay}T12:00:00Z`) / 1000, precision: 'day', day: originDay };
  return null;
}
/**
 * Whether a start is only where the looking began (C4): a name's own search shows its last 7 days, so a story older than that reads
 * as starting at the edge of the window, and the first headline found there is no start (a fortnight-old story would read "Started
 * 7 days ago"). found: startedOf's answer; edge: where the looking began (epoch seconds: the name's search time less
 * NAME_SEARCH_WINDOW, or the first day its origin search asked for; null for a row with no name search). A start known only to the
 * day, or one well inside the window, or before it (evidence the collector holds from its own earlier cycles), stands.
 */
function startCensored(found, edge) {
  if (!found || found.precision !== 'hour' || !Number.isFinite(edge)) return false;
  return Math.abs(found.at - edge) <= K.START_EDGE;
}
/** The start of the current run of search entries: back from the newest, each entry that ended within 48 hours of the next one's start. */
function searchRunStart(searches, now) {
  const xs = (searches || []).filter((s) => Number.isFinite(s.start) && s.start <= now).sort((a, b) => a.start - b.start);
  if (!xs.length) return null;
  let at = xs.length - 1;
  while (at > 0 && xs[at].start - (xs[at - 1].end ?? now) <= K.START_SEARCH_SLACK) at -= 1;
  return xs[at].start;
}

// ---------- C5 peak, C6 urgency ----------
/** The peak time the feed sends: only once the trend has left rising and the peak is two hours or more behind. */
const peakToSend = (status, peakAt, t) => (status !== 'rising' && Number.isFinite(peakAt) && t - peakAt >= K.PEAK_BEHIND ? peakAt : null);
/** A candidate for "Film within 24h": measured rising, started at most 36 hours ago to the hour, not grim, not Early, little time left or none known. */
const urgentCandidate = ({ t, measured, status, startedAt, startedPrecision, grim, early, timeLeftHours }) => !!measured && status === 'rising' &&
  startedPrecision === 'hour' && Number.isFinite(startedAt) && t >= startedAt && t - startedAt <= K.URGENT_AGE && !grim && !early &&
  (timeLeftHours === null || timeLeftHours === undefined || timeLeftHours <= K.URGENT_LEFT_MAX);
/** Worth an alert to anyone: measured rising, started at most 24 hours ago, a 100K+ home search or three kinds at once; never grim, never Early. */
const isSpike = ({ t, measured, status, startedAt, startedPrecision, grim, early, homeSearch, kinds }) => !!measured && status === 'rising' &&
  startedPrecision === 'hour' && Number.isFinite(startedAt) && t >= startedAt && t - startedAt <= K.SPIKE_AGE && !grim && !early &&
  ((homeSearch || 0) >= K.SPIKE_SEARCH || (kinds || 0) >= K.SPIKE_KINDS);
/** The start of what is happening now (the newest of start, chapter and Early) when it is inside the last 12 hours and the row is rising; never grim. */
function flareOf({ t, status, grim, startedAt, startedPrecision, chapterAt, earlyAt }) {
  if (status !== 'rising' || grim) return null;
  const times = [startedPrecision === 'hour' ? startedAt : null, chapterAt, earlyAt].filter((x) => Number.isFinite(x) && x <= t);
  if (!times.length) return null;
  const newest = Math.max(...times);
  return t - newest <= K.FLARE_AGE ? newest : null;
}

// ---------- C7 time left ----------
/** When a trend ended: the first time after its peak that Ī stays under 25% of P for 6 hours (48 for a word or a sound); else null. */
function endedAt(samples, t, kind, peak, peakAt) {
  if (!Number.isFinite(peakAt) || !(peak >= K.PEAK_MIN)) return null;
  const stay = K.END_STAY[kind] || K.END_STAY.talk;
  // (an end is seen, never rebuilt: a quiet stretch of the hours before the collector met it ends nothing)
  const series = smooth(samples.filter((s) => !s.backfilled)).filter((x) => x.t > peakAt && x.t <= t);
  let low = null;
  for (const x of series) {
    if (x.i < K.END_SHARE * peak) { if (low === null) low = x.t; if (x.t - low >= stay) return low; } else low = null;
  }
  return null;
}
/** A trend's class: family x search. family: creator drama, celebrity drama, other story, moment, word, sound. */
function classOf({ kind, drama, tier, searchMax }) {
  const family = kind === 'word' || kind === 'sound' || kind === 'moment' ? kind : drama && tier === 'creator' ? 'creator-drama' : drama ? 'celebrity-drama' : 'story';
  const search = !(searchMax > 0) ? 'none' : searchMax >= K.BIG_SEARCH ? 'big' : 'small';
  return `${family}/${search}`;
}
/** What a class typically lives, in hours (K.LIFE_PRIOR), or null for a class with none (a word, a sound, a moment). */
function lifePrior(cls) {
  const [family, search] = String(cls || '').split('/');
  const base = K.LIFE_PRIOR[family];
  return Number.isFinite(base) ? base + (search === 'big' ? K.LIFE_PRIOR_BIG : 0) : null;
}
/** A straight-line fit of ln Ī against time over points [{ t, i }] with i > 0: { halfLife (seconds; Infinity when not decaying), r2 }, or null under 3 points. */
function halfLifeFit(points) {
  const pts = points.filter((p) => p.i > 0);
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.t);
  const ys = pts.map((p) => Math.log(p.i));
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const syy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  if (!sxx) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const r2 = syy ? (slope * slope * sxx) / syy : 0;
  return { halfLife: slope < 0 ? Math.LN2 / -slope : Infinity, r2 };
}
/** Hours left, rounded as the feed sends them: sixes under 36 (6 ... 30), whole days from there (36 to 47 reads as two days), a week at most. */
function roundLeft(hours) {
  if (hours < 36) return Math.max(6, Math.min(30, Math.round(hours / 6) * 6));
  return Math.min(K.LEFT_MAX, Math.max(48, Math.round(hours / 24) * 24));
}
/**
 * The forecast (hours until the buzz ends, rounded), or null when it must be hidden. ctx: { t, kind, status, measured, startedAt,
 * startedPrecision, chapterAt, grim, somber, early, share, lifetimes (hours lived by ended trends of the same class, the last 120
 * days), recent (the smoothed points of the last two windows, for the trend's own fit) }.
 */
function timeLeft(ctx) {
  const { t } = ctx;
  if (ctx.kind !== 'talk' || ctx.early || ctx.grim || ctx.somber || !ctx.measured || !Number.isFinite(ctx.startedAt)) return null;
  if (Number.isFinite(ctx.chapterAt) && t - ctx.chapterAt < K.LEFT_CHAPTER_QUIET) return null;
  const age = t - ctx.startedAt;
  if (age < K.LEFT_MIN_AGE) return null;
  const ageHours = age / HOUR;
  const remaining = (ctx.lifetimes || []).filter((life) => life >= ageHours).map((life) => life - ageHours).sort((a, b) => a - b);
  const mid = median(remaining);
  const q = (p) => remaining[Math.min(remaining.length - 1, Math.max(0, Math.round(p * (remaining.length - 1))))];
  const comparable = remaining.length >= K.LEFT_COMPARABLES && mid > 0 && q(0.75) - q(0.25) <= K.LEFT_SPREAD * mid ? mid : null;
  let own = null;
  let goodFit = false;
  if (ctx.status === 'fading' && (ctx.recent || []).length >= K.LEFT_FIT_SAMPLES && ctx.share > K.END_SHARE) {
    const fit = halfLifeFit(ctx.recent);
    if (fit && Number.isFinite(fit.halfLife)) { own = (fit.halfLife / HOUR) * Math.log2(ctx.share / K.END_SHARE); goodFit = fit.r2 >= K.LEFT_FIT_R2; }
  }
  // (with too few comparables yet: what is left of its class's typical life, never for a row still rising, and no more than two
  // days for one already fading; a row that has outlived its class says nothing)
  const typicalLeft = comparable === null && Number.isFinite(ctx.prior) && ctx.status !== 'rising' && ctx.prior > ageHours ? Math.min(ctx.prior - ageHours, ctx.status === 'fading' ? K.LEFT_FADING_MAX : Infinity) : null;
  const base = comparable !== null ? comparable : typicalLeft;
  // (the smaller of the two; the trend's own fit alone will do when it is good)
  const answer = base !== null && own !== null ? Math.min(base, own) : base !== null ? base : goodFit ? own : null;
  if (answer === null || answer < K.LEFT_MIN) return null;
  const rounded = roundLeft(answer);
  if (ctx.startedPrecision !== 'hour' && rounded < K.LEFT_DAY_PRECISION_MIN) return null;
  return rounded;
}

// ---------- one cycle of one trend ----------
/**
 * Everything section C says about one trend at `t`, from its series and what this cycle read: the pure heart of lib/history.js.
 * state (the trend's row): { kind, status (last published from a measurement, or null), statusTest (last cycle's test), faded, startedAt,
 *   startedPrecision, firstSeen, peakAt, peakInterest, earlyAt, earlyGoneAt, promotedAt, chapterAt, endedAt, notClimbing }
 * input: { t, engineStatus ('rising' | 'peaking' | 'fading': the engine's own, used while nothing is measured), chapterAt (a new claim by
 *   the engine's own rule, or null), n24, liveHome, outlets, kindFirst, sayable, grim, observed, audiences: { US: { onPage, homeSearch } } }
 * Returns { state (the row's next values), m, status, statusMeasured, early: { US: bool, ... }, kinds, endedNow }.
 */
function advance(state, samples, input) {
  const { t } = input;
  const kind = state.kind || 'talk';
  let chapterAt = [state.chapterAt, input.chapterAt].filter(Number.isFinite).reduce((a, b) => Math.max(a, b), -Infinity);
  chapterAt = Number.isFinite(chapterAt) ? chapterAt : null;
  const m = measure(samples, t, kind, { peakInterest: state.peakInterest, peakAt: state.peakAt });
  const ctx = { t, kind, startedAt: state.startedAt, startedPrecision: state.startedPrecision, firstSeen: state.firstSeen, chapterAt, n24: input.n24,
    liveHome: input.liveHome, lastSignalAt: lastSignalAt(samples, t), faded: !!state.faded, items: input.items || null, flare: !!input.flare };
  const test = statusTest(m, samples, ctx);
  const settled = settle(state.status || null, state.statusTest || null, test, m, ctx);
  if (settled.chapter) chapterAt = t;
  // (young evidence, C3 as built 2026-10-11: with no series yet, a story whose own items, each dated by itself, arrive faster than
  // they did twelve hours before. It is the same test as acceleration, read from the items instead of the samples, so a cold start
  // can tag what is plainly starting and still tags nothing merely because the collector is new)
  const itemsRising = !!(input.items && input.items.rising);
  const evidence = !!accelerating(samples, t) || corroborated(input.kindFirst) || itemsRising;
  const e = earlyStep(state, m, { t, startedAt: state.startedAt, startedPrecision: state.startedPrecision, sayable: input.sayable, grim: input.grim,
    observed: input.observed, evidence, itemsRising, outlets: input.outlets, audiences: input.audiences || {} });
  const ended = Number.isFinite(state.endedAt) ? state.endedAt : endedAt(samples, t, kind, m.peak, m.peakAt);
  const published = settled.status || state.status || null;
  // (it has faded since it last rose: rising again is a comeback, C2)
  const faded = published === 'fading' ? true : published === 'rising' ? false : !!state.faded;
  const next = { ...state, status: published, statusTest: test, faded, peakAt: m.peakAt, peakInterest: m.peak, chapterAt,
    earlyAt: e.state.earlyAt, earlyGoneAt: e.state.earlyGoneAt, promotedAt: e.state.promotedAt, notClimbing: e.state.notClimbing, endedAt: ended };
  return { state: next, m, status: settled.status || input.engineStatus || 'peaking', statusMeasured: settled.status !== null && !!m.measured, early: e.early,
    kinds: kindCount(input.kindFirst), endedNow: ended !== null && !Number.isFinite(state.endedAt) };
}

module.exports = { advance, itemStats, K, SEARCH_BANDS, bandIndex, band, windowOf, partsOf, carried, interestOf, isObserved, smooth, measure, climbingAt, isClimbing, statusTest, notFallen,
  lastSignalAt, settle, accelerating, corroborated, kindCount, proven, earlyStep, startedOf, startCensored, searchRunStart, peakToSend, urgentCandidate, isSpike, flareOf, endedAt,
  classOf, lifePrior, halfLifeFit, roundLeft, timeLeft };
