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
  // (a search that could not be read: a country's reply missing, the realtime host in back-off and only the RSS in its place. Its
  // last reading holds this long, where one read and found gone holds 45 minutes: absence is unknown, never zero)
  HOLD_SEARCH_UNKNOWN: 24 * HOUR,
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
  // (a long story is told in turns, a day apart: four of its own items in the last two days, the newest inside a day, is still told.
  // The run after the judges of 2026-10-11: the benchmark row, with a new headline every day of its second week, read "Fading" the
  // hour its last one was three hours old)
  STILL_TOLD_N48: 4,
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
  BIG_SEARCH: 100000,
  // the badge and the card's own graph are one story (reviewers, 2026-10-12: "Peaking" over a line at a fifth of a peak ten days
  // behind). By the series as the graph draws it: its newest point under 40% of its peak, the peak six hours behind or more (48 for
  // a word or a sound), is fading; so is one under half of a peak two days behind. Once faded it is back at its peak only at half
  // of it again, so a line that hovers at the bar does not flip the badge
  SHAPE_FADED: 0.4,
  SHAPE_HALF: 0.5,
  SHAPE_HALF_BEHIND: 48 * HOUR,
  SHAPE_BACK: 0.5,
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
 * every 8 hours, so its press holds that long. searchUnknown: the row has a search this cycle could not read (lib/signals.js): its
 * last reading holds for a day.
 */
function carried(parts, earlier, t, { pastPage = false, searchUnknown = false } = {}) {
  const out = {};
  for (const key of ['s', 'n', 'c', 'r', 'w']) {
    if (parts[key] !== null && parts[key] !== undefined) { out[key] = parts[key]; continue; }
    const hold = key === 'n' && pastPage ? K.HOLD.nPastPage : key === 's' && searchUnknown ? K.HOLD_SEARCH_UNKNOWN : K.HOLD[key];
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
function measure(samples, t, kind, known = {}, line = {}) {
  // (the rebuilt stretch is the press's and the creators' shape alone, no search and no reads: B1. Its level is another scale, so the
  // windows, the velocity and the climb are read from what the collector sampled itself; where it began to watch is no jump. The
  // peak is the trend's whole life's, rebuilt hours included: a story met after its peak still has one)
  // (a trend met after it began: its life on the one scale its card draws, `oneScale`)
  const life = (hasRebuilt(samples) ? drawn(samples, { kind, ...line }) : smooth(samples)).filter((x) => x.t <= t);
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
function statusTest(m, samples, ctx) { return statusRule(m, samples, ctx).test; }
/** statusTest's answer and whether the rule that gave it read the measured windows: { test, measured }. An unmeasured rule's "rising" (young, flared again) alerts nobody: C6. */
function statusRule(m, samples, ctx) {
  const { t, kind } = ctx;
  const said = (test, measured) => ({ test, measured: !!measured });
  const W = windowOf(kind);
  const vRise = K.V_RISE[kind] || K.V_RISE.talk;
  const byHour = ctx.startedPrecision === 'hour' && Number.isFinite(ctx.startedAt);
  const newChapter = Number.isFinite(ctx.chapterAt) && t - ctx.chapterAt <= W && t >= ctx.chapterAt;
  // 1 rising
  if (m.measured && m.v >= vRise && m.nowShare >= K.SHARE_RISING) return said('rising', true);
  if (m.measured && newChapter && m.v > 0) return said('rising', true);
  // (flared again: after half a day of nothing its own people answered, inside this window, by a headline's own time: lib/desk.js)
  if (newChapter && ctx.flare) return said('rising', false);
  // (young by its own start, never by when the collector happened to meet it: a cold start makes nothing rising)
  if (byHour && t - ctx.startedAt <= W && t >= ctx.startedAt && Number.isFinite(ctx.firstSeen) && ctx.firstSeen - ctx.startedAt <= K.RISING_MET_WITHIN && notFallen(samples, t)) return said('rising', false);
  // 2 fading: never while it is still told or searched within 8 days of its start
  const toldLately = !!ctx.items && (ctx.items.lastTwoDays || 0) >= K.STILL_TOLD_N48 && Number.isFinite(ctx.items.lastAt) && t - ctx.items.lastAt <= DAY;
  // (the eight days run from its start, or from its newest chapter: a second accuser a week on starts them again)
  // (or from its newest turn: its people answering each other in a headline that does not print its subject's name)
  const since = Math.max(Number.isFinite(ctx.startedAt) ? ctx.startedAt : -Infinity, Number.isFinite(ctx.chapterAt) && ctx.chapterAt <= t ? ctx.chapterAt : -Infinity,
    Number.isFinite(ctx.turnAt) && ctx.turnAt <= t ? ctx.turnAt : -Infinity);
  const stillTold = ((ctx.n24 || 0) >= K.STILL_TOLD_N24 || !!ctx.liveHome || toldLately) && Number.isFinite(since) && t - since <= K.STILL_TOLD_DAYS * DAY;
  // (by its own items' times, measured or not: nothing of its own for a day while no search is live at home; or, for a story, one
  // item at most in the last day where its busiest day had four or more, a day and a half behind. A card whose own graph has fallen
  // to a fifth of its peak does not say "Peaking" on a status nobody measured: judges, 2026-10-11)
  // (nor while a search of its own trended inside the last day: the story is being looked for, whatever its headlines' dates say)
  const items = ctx.items || null;
  if (items && !ctx.liveHome && !newChapter && !ctx.searchedLately) {
    const quiet = K.QUIET[kind] || K.QUIET.talk;
    if (Number.isFinite(items.lastAt) && t - items.lastAt >= quiet) return said('fading', m.measured);
    // (never while it is still told: two or more of its own in the last day keep it at its peak, however old. IDEAS-SPEC "Buzz")
    if ((kind === 'talk' || kind === 'moment') && items.peakDay >= K.COLLAPSE_PEAK_ITEMS && Number.isFinite(items.peakDayAt) && t - items.peakDayAt >= K.COLLAPSE_PEAK_BEHIND &&
      items.lastDay < K.STILL_TOLD_N24 && items.lastDay <= K.COLLAPSE_SHARE * items.peakDay && !toldLately) return said('fading', m.measured);
  }
  if (!stillTold) {
    if (m.measured && m.share < K.SHARE_FADING && m.v <= 0 && m.v1 !== null && m.v1 <= 0) return said('fading', true);
    if (Number.isFinite(ctx.lastSignalAt) && t - ctx.lastSignalAt >= (K.QUIET[kind] || K.QUIET.talk)) return said('fading', m.measured);
  }
  // 3 peaking: everything else that is measured
  return said(m.measured ? 'peaking' : null, m.measured);
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
  return { lastAt, lastDay: within(t, DAY), lastTwoDays: within(t, 2 * DAY), peakDay, peakDayAt, rising: now >= K.ITEMS_RISING_MIN && now > before && t - lastAt <= K.ITEMS_RISING_FRESH };
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
  // (leaving fading is held to what entering it is: the window back at half of the peak, on two cycles in a row. One more headline
  // in the look-back is no return to a peak: a story flat at a third of it read Fading, Peaking for eight hours, Fading, Peaking)
  if (prev === 'fading' && test === 'peaking' && !(m.share !== null && m.share >= K.SHARE_FADING && testPrev === 'peaking')) return { status: 'fading', chapter: false };
  // (a trend met for the first time has no standing status to hold on to: a week-old story whose name was searched again today is
  // fading from its first cycle, never "Peaking" for a slot on the strength of nothing. Judges, 2026-10-11, and the run after)
  if (test === 'fading' && prev === null && testPrev === null && !m.measured) return { status: 'fading', chapter: false };
  if (test === 'fading' && prev !== 'fading' && testPrev !== 'fading') return { status: 'peaking', chapter: false };
  return { status: test, chapter: false };
}

// ---------- the series as the card's graph draws it ----------
/** A sample's part of I with carrying done over the samples before it in `rows` (oldest first): its own value, else the newest inside `hold`, else 0. */
function heldPart(rows, at, key, hold) {
  for (let i = at; i >= 0; i--) {
    if (rows[at].t - rows[i].t > hold) break;
    const v = rows[i].p ? rows[i].p[key] : null;
    if (v !== null && v !== undefined) return v;
  }
  return 0;
}
/** The newest value of a column at or before a sample, inside `hold`; else 0. */
function heldCol(rows, at, col, hold) {
  for (let i = at; i >= 0; i--) {
    if (rows[at].t - rows[i].t > hold) break;
    if (Number.isFinite(rows[i][col])) return rows[i][col];
  }
  return 0;
}
/**
 * A search's part of I at `at`, from the Trends entries a trend carries ({ start, end (null while trending), volume }, seconds), as
 * C1 reads one: nothing before an entry began, its band while it trended, halving every 12 hours once it had ended; the largest of
 * the entries'. cap ({ at, s }): an entry still trending at `cap.at` counts no higher than `cap.s`, the search part the collector
 * first sampled: its volume has grown since, and the hours before the collector looked stand at the level it first read. An entry
 * that had ended by then has its final volume, and is read as it is.
 */
function searchPartAt(entries, at, cap = null) {
  let top = 0;
  for (const e of entries || []) {
    if (!Number.isFinite(e.start) || e.start > at) continue;
    const ended = Number.isFinite(e.end) && e.end <= at;
    const liveAtCap = !!cap && e.start <= cap.at && !(Number.isFinite(e.end) && e.end <= cap.at);
    const level = liveAtCap ? Math.min(band(e.volume), cap.s) : band(e.volume);
    top = Math.max(top, level * (ended ? Math.pow(0.5, (at - e.end) / K.SEARCH_HALF_LIFE) : 1));
  }
  return top;
}
/**
 * The series on ONE scale, as the card's graph draws it and as its peak is read (reviewers, 2026-10-12: every trend met after it
 * began drew a step where the collector began to watch, and its ring, its caption and "Interest peaks." sat on those first hours:
 * a rebuilt hour was the press's and the creators' shape alone, and the collector's own samples added a search whose past nobody
 * had read). For a trend with a rebuilt stretch:
 *   a rebuilt hour is its press and creators (as stored) and an ESTIMATE of its search: the trend's own Trends entries say when each
 *     search began and ended, so the hour has none before the entry began, the level the collector first read while it trended,
 *     and the same halving the collector applies once it had ended. A search still trending when the collector arrived stands at
 *     the first search part the collector sampled (so the two stretches meet, whatever it has grown to since);
 *   an observed sample is the same three parts: its search as sampled, its creators', and its press read as a rebuilt hour's is
 *     (the look-back's own count, or the day's rate in that unit). Community and reads cannot be rebuilt and are left out of both.
 * So where the collector began to watch is no step, and the highest point is where the story's own press stood highest on its
 * search, wherever that was. A trend seen from its own start has no rebuilt stretch and is drawn by its whole interest, as it was.
 * Only the drawing and the peak: the stored samples, the windows and the velocity are untouched, and no measured fact (a band
 * passed, B1) is ever read from the estimate.
 * opts: { kind, searches: [{ start, end, volume }] }.
 */
function oneScale(series, { kind = 'talk', searches = [] } = {}) {
  if (!hasRebuilt(series)) return series;
  const rows = [...series].sort((a, b) => a.t - b.t);
  const lookback = Math.max(3 * HOUR, windowOf(kind));
  // (the join: the first search part the collector sampled, against what the entries give at that moment)
  const join = rows.find((s) => !s.backfilled && s.p && Number.isFinite(s.p.s));
  const cap = join ? { at: join.t, s: join.p.s } : null;
  return rows.map((s, at) => {
    if (!Number.isFinite(s.interest)) return s;
    if (s.backfilled) {
      const search = s.p && Number.isFinite(s.p.s) ? 0 : searchPartAt(searches, s.t, cap);
      return search > 0 ? { ...s, interest: Math.round(10 * (s.interest + K.WEIGHTS.s * search)) / 10 } : s;
    }
    const inLook = Math.pow(2, 6 * heldPart(rows, at, 'n', K.HOLD.n)) - 1;
    const press = clamp(Math.log2(1 + Math.max(inLook, (heldCol(rows, at, 'n24', K.HOLD.n) * lookback) / DAY)) / 6);
    return { ...s, interest: Math.round(10 * (K.WEIGHTS.n * press + K.WEIGHTS.c * heldPart(rows, at, 'c', K.HOLD.c) + K.WEIGHTS.s * heldPart(rows, at, 's', K.HOLD_SEARCH_UNKNOWN))) / 10 };
  });
}
/** Whether a series has a rebuilt stretch (B1): the trend was met after it began. */
const hasRebuilt = (series) => series.some((s) => s.backfilled && Number.isFinite(s.interest));
/**
 * The line a card's graph draws, oldest first: [{ t, i, observed, backfilled }]. On one scale (`oneScale`), the rebuilt stretch and
 * the observed one each smoothed on its own: the first point the collector saw for itself is never the median of two rebuilt hours
 * and itself.
 */
function drawn(series, opts = {}) {
  const one = oneScale(series, opts);
  return [...smooth(one.filter((s) => s.backfilled)), ...smooth(one.filter((s) => !s.backfilled))].sort((a, b) => a.t - b.t);
}
/**
 * Where the drawn line stands at `t`: { share (its newest point over its highest), peakAt (when the highest was, the latest of
 * equals) }, or null with nothing above 0 to draw. What the badge is held to (`byShape`).
 */
function shapeOf(series, t, opts = {}) {
  const pts = drawn(series, opts).filter((x) => x.t <= t);
  if (!pts.length) return null;
  let top = 0;
  let peakAt = null;
  for (const x of pts) if (x.i > 0 && x.i >= top) { top = x.i; peakAt = x.t; }
  if (!(top > 0)) return null;
  return { share: pts[pts.length - 1].i / top, peakAt };
}
/** How far behind a peak must be before the line under it says "fading": a story's six hours, a word's two days (as an end is read, C7). */
const shapeBehind = (kind) => K.END_STAY[kind] || K.END_STAY.talk;
/**
 * A status held to the drawn line (C2, as built 2026-10-12): "peaking" is said only of a line that is still near its peak. Fading
 * when the newest point is under 40% of a peak six hours behind or more (two days for a word or a sound), or under half of a peak two
 * days behind; a row already fading stays so until its line is back at half. A rising a rule gave this cycle is never touched:
 * the caller hands in only a peaking, or a rising nothing tested.
 */
function byShape(status, shape, { t, kind, wasFading = false }) {
  if (!shape || status === 'fading' || !Number.isFinite(shape.peakAt)) return status;
  const behind = t - shape.peakAt;
  if (wasFading && shape.share < K.SHAPE_BACK && behind >= shapeBehind(kind)) return 'fading';
  if (shape.share < K.SHAPE_FADED && behind >= shapeBehind(kind)) return 'fading';
  if (shape.share < K.SHAPE_HALF && behind >= K.SHAPE_HALF_BEHIND) return 'fading';
  return status;
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
/** (risingNow: this cycle's own test said rising, measured: a rising only held over from the cycle before alerts nobody.) */
/** A candidate for "Film within 24h": measured rising, started at most 36 hours ago to the hour, not grim, not Early, little time left or none known. */
const urgentCandidate = ({ t, measured, status, startedAt, startedPrecision, grim, early, timeLeftHours, risingNow = true }) => !!measured && status === 'rising' && !!risingNow &&
  startedPrecision === 'hour' && Number.isFinite(startedAt) && t >= startedAt && t - startedAt <= K.URGENT_AGE && !grim && !early &&
  (timeLeftHours === null || timeLeftHours === undefined || timeLeftHours <= K.URGENT_LEFT_MAX);
/** Worth an alert to anyone: measured rising, started at most 24 hours ago, a 100K+ home search or three kinds at once; never grim, never Early. */
const isSpike = ({ t, measured, status, startedAt, startedPrecision, grim, early, homeSearch, kinds, risingNow = true }) => !!measured && status === 'rising' && !!risingNow &&
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
/**
 * Whether a trend's fall over its last two windows is only the collector's own halving of a search that has ended (C1's S): its
 * search part is lower at the end than at the start, and everything else of its interest stood still. A half-life fitted to that
 * is the constant read back. samples: the trend's, oldest first.
 */
function onlySearchDecay(samples, t, kind) {
  const W = windowOf(kind);
  const xs = samples.filter((s) => !s.backfilled && s.t > t - 2 * W && s.t <= t && Number.isFinite(s.interest) && s.p && Number.isFinite(s.p.s)).sort((a, b) => a.t - b.t);
  if (xs.length < 2 || !(xs[xs.length - 1].p.s < xs[0].p.s)) return false;
  const rest = xs.map((s) => s.interest - K.WEIGHTS.s * s.p.s);
  return Math.max(...rest) - Math.min(...rest) <= 0.5;
}
/** Hours left, rounded as the feed sends them: sixes under 36 (6 ... 30), whole days from there (36 to 47 reads as two days), a week at most. */
function roundLeft(hours) {
  if (hours < 36) return Math.max(6, Math.min(30, Math.round(hours / 6) * 6));
  return Math.min(K.LEFT_MAX, Math.max(48, Math.round(hours / 24) * 24));
}
/**
 * The forecast (hours until the buzz ends, rounded), or null when it must be hidden. ctx: { t, kind, status, measured, startedAt,
 * startedPrecision, chapterAt, grim, somber, early, share, nowShare (the drawn line's newest point over its peak), lifetimes (hours
 * lived by ended trends of the same class, the last 120 days), recent (the smoothed points of the last two windows, for the trend's
 * own fit) }. Never a class's typical life less the row's age: that is a constant, no forecast (reviewers, 2026-10-12: nine cards
 * said "About 2 days left" off an empty archive). With fewer than fifteen comparables and no good fit of its own the card says nothing.
 */
function timeLeft(ctx) {
  const { t } = ctx;
  if (ctx.kind !== 'talk' || ctx.early || ctx.grim || ctx.somber || !ctx.measured || !Number.isFinite(ctx.startedAt)) return null;
  if (Number.isFinite(ctx.chapterAt) && t - ctx.chapterAt < K.LEFT_CHAPTER_QUIET) return null;
  const age = t - ctx.startedAt;
  if (age < K.LEFT_MIN_AGE) return null;
  // (a line already under the bar an end is read at has no time left to forecast: the badge says Fading)
  if (Number.isFinite(ctx.nowShare) && ctx.nowShare < K.END_SHARE) return null;
  const ageHours = age / HOUR;
  const remaining = (ctx.lifetimes || []).filter((life) => life >= ageHours).map((life) => life - ageHours).sort((a, b) => a - b);
  const mid = median(remaining);
  const q = (p) => remaining[Math.min(remaining.length - 1, Math.max(0, Math.round(p * (remaining.length - 1))))];
  const comparable = remaining.length >= K.LEFT_COMPARABLES && mid > 0 && q(0.75) - q(0.25) <= K.LEFT_SPREAD * mid ? mid : null;
  // (no forecast without comparables: reviewers, 2026-10-12. The trend's own fit alone gave "About a day left" on three rows of a
  // collector eight hours old with an empty archive, each a half-life fitted to the collector's own halving of an ended search:
  // the decay constant of C1 read back as a forecast. The fit now only ever shortens what the comparables gave, and only when it
  // is a fit of something that moved: `ownFit` false when the fall is that halving alone, or the collector has watched the trend
  // for two windows or less)
  if (comparable === null) return null;
  let own = null;
  if (ctx.ownFit !== false && ctx.status === 'fading' && (ctx.recent || []).length >= K.LEFT_FIT_SAMPLES && ctx.share > K.END_SHARE) {
    const fit = halfLifeFit(ctx.recent);
    if (fit && Number.isFinite(fit.halfLife) && fit.r2 >= K.LEFT_FIT_R2) own = (fit.halfLife / HOUR) * Math.log2(ctx.share / K.END_SHARE);
  }
  // (the smaller of the two)
  const answer = own !== null ? Math.min(comparable, own) : comparable;
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
  const line = { kind, searches: input.searches || [] };
  const m = measure(samples, t, kind, { peakInterest: state.peakInterest, peakAt: state.peakAt }, line);
  const ctx = { t, kind, startedAt: state.startedAt, startedPrecision: state.startedPrecision, firstSeen: state.firstSeen, chapterAt, n24: input.n24,
    liveHome: input.liveHome, lastSignalAt: lastSignalAt(samples, t), faded: !!state.faded, items: input.items || null, flare: !!input.flare, searchedLately: !!input.searchedLately, turnAt: input.turnAt };
  const rule = statusRule(m, samples, ctx);
  const test = rule.test;
  const settled = settle(state.status || null, state.statusTest || null, test, m, ctx);
  // (the badge is held to the line its own card draws: a peaking, or a rising no rule of this cycle gave, over a line far under an
  // old peak is fading)
  const shape = shapeOf(samples, t, line);
  const unshaped = settled.status || input.engineStatus || 'peaking';
  const status = settled.status === 'rising' ? unshaped : byShape(unshaped, shape, { t, kind, wasFading: state.status === 'fading' });
  const byLine = status !== unshaped;
  // (a status kept by the hold is as measured as the test it holds: a row that was "rising" only by being young is not measured
  // rising the cycle its windows fill. C6 alerts on measured rising alone)
  const held = settled.status !== null && settled.status !== test;
  const testMeasured = held ? !!state.testMeasured && !!m.measured : rule.measured;
  // (a climb back that follows samples whose search could not be read is the collector seeing again, not the story moving: it
  // starts no chapter and alerts nobody. Reviewers, 2026-10-12: six hours on the RSS, then "Rising" by the comeback rule)
  const recovered = !!input.recovered;
  if (settled.chapter && !recovered) chapterAt = t;
  // (young evidence, C3 as built 2026-10-11: with no series yet, a story whose own items, each dated by itself, arrive faster than
  // they did twelve hours before. It is the same test as acceleration, read from the items instead of the samples, so a cold start
  // can tag what is plainly starting and still tags nothing merely because the collector is new)
  const itemsRising = !!(input.items && input.items.rising);
  const evidence = !!accelerating(samples, t) || corroborated(input.kindFirst) || itemsRising;
  const e = earlyStep(state, m, { t, startedAt: state.startedAt, startedPrecision: state.startedPrecision, sayable: input.sayable, grim: input.grim,
    observed: input.observed, evidence, itemsRising, outlets: input.outlets, audiences: input.audiences || {} });
  const ended = Number.isFinite(state.endedAt) ? state.endedAt : endedAt(samples, t, kind, m.peak, m.peakAt);
  const published = byLine ? status : settled.status || state.status || null;
  // (it has faded since it last rose: rising again is a comeback, C2)
  const faded = published === 'fading' ? true : published === 'rising' ? false : !!state.faded;
  const next = { ...state, status: published, statusTest: test, testMeasured: rule.measured, faded, peakAt: m.peakAt, peakInterest: m.peak, chapterAt,
    earlyAt: e.state.earlyAt, earlyGoneAt: e.state.earlyGoneAt, promotedAt: e.state.promotedAt, notClimbing: e.state.notClimbing, endedAt: ended };
  // (statusOwn: a rule of the collector's own gave the word: its measured windows, the trend's own dated items, its own observed samples
  // or the line its card draws. False: no rule spoke and the word is the engine's, read off one snapshot: the audit's finding. The
  // feed says so and the phone then shows no heat word: reviewers, 2026-10-12, "Rising" on a row two days after its event)
  return { state: next, m, status, statusMeasured: settled.status !== null && testMeasured, statusOwn: settled.status !== null || byLine, risingNow: test === 'rising' && rule.measured && !recovered, shape, early: e.early,
    kinds: kindCount(input.kindFirst), endedNow: ended !== null && !Number.isFinite(state.endedAt) };
}

module.exports = { advance, itemStats, K, SEARCH_BANDS, bandIndex, band, windowOf, partsOf, carried, interestOf, isObserved, smooth, measure, climbingAt, isClimbing, statusTest, statusRule, notFallen,
  oneScale, searchPartAt, hasRebuilt, drawn, shapeOf, byShape, onlySearchDecay,
  lastSignalAt, settle, accelerating, corroborated, kindCount, proven, earlyStep, startedOf, startCensored, searchRunStart, peakToSend, urgentCandidate, isSpike, flareOf, endedAt,
  classOf, halfLifeFit, roundLeft, timeLeft };
