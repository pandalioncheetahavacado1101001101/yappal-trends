'use strict';
/*
 * The labels (P5: ios/.review/datasets-knowledge.md B3, B4, B5), read each cycle over what the measured series said, never written
 * back into it: the state keeps its own status and Early (lib/measure.js), and the labels change only what this cycle publishes and how
 * the page is laid out (lib/page-sink.js). Switched with the page's sink (IDEAS_PAGE_SINK=0 turns both off).
 *
 *   B3  returning (its age counts from the run it is on now), weekly, always-on, evergreen: the last three are never Early
 *   B4  Fading from three signals: its measured series falls (lib/measure.js, as before), its daily curve, turned down, says "gone
 *       within a week" (lib/labels/curve.js), or it slid on a ranked list (lib/labels/slide.js); never while it is still told (two of its own
 *       headlines in the day, its search trending in the day, a new chapter or turn in the day) and never while it is rising
 *   B5  Early only when its curve does not say "will fade", and, when a ranked list led it, only from the top 2 and not falling
 *   spent  will not last the day (lib/labels/lasts.js): it sinks on the page, it is not called Fading for it
 *
 * `apply` is the one call collect.js makes; `sinkOf` is what the desk's sink reads of a row (lib/desk.js `order`, opts.seriesOf).
 */
const CU = require('./curve');
const RC = require('./recur');
const SL = require('./slide');
const LA = require('./lasts');
const TI = require('./title');

const HOUR = 3600;
const DAY = 86400;
const TOLD_MIN = 2;
const HISTORY_DAYS = 35;
const ALWAYS_BACK = 15 * DAY;
// (the creator-native kinds a ranked list stands for: Reddit's places)
const RANKED_KINDS = new Set(['reddit']);
const LISTED = '(COALESCE(r_us, 0) > 0 OR COALESCE(r_gb, 0) > 0 OR COALESCE(r_au, 0) > 0 OR COALESCE(r_ca, 0) > 0 OR COALESCE(r_mx, 0) > 0)';
// (a reading the collector made: never a rebuilt hour or a re-seeded point, lib/state.js FLAG)
const NOT_OWN = 4 | 32;

/** When a trend (and an earlier one of the same key) was listed in the last five weeks: [{ t, res }], oldest first. */
function listedOf(db, c, t) {
  if (!db || !c || !c.trend) return [];
  try {
    const ids = [c.id, ...db.prepare('SELECT id FROM trends WHERE natural_key = ? AND id != ?').all(c.trend.natural || '', c.id).map((r) => r.id)];
    const stmt = db.prepare(`SELECT t, res FROM samples WHERE trend_id = ? AND t >= ? AND t <= ? AND ${LISTED} AND (COALESCE(flags, 0) & ${NOT_OWN}) = 0`);
    return ids.flatMap((id) => stmt.all(id, t - HISTORY_DAYS * DAY, t)).map((r) => ({ t: r.t, res: r.res })).sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

// the timeline entries that tell something of the story (lib/history.js eventsOf): never a peak the series measured
const TOLD_KINDS = new Set(['start', 'chapter', 'turn', 'reply', 'latest']);
/** The newest timeline entry that told something, saved or of this cycle, up to `t` (epoch seconds), or null. */
function toldAtOf(db, c, t) {
  const fresh = (c.events || []).filter((e) => e && TOLD_KINDS.has(e.kind) && Number.isFinite(e.at) && e.at <= t).map((e) => e.at);
  let saved = [];
  try {
    if (db) saved = db.prepare(`SELECT MAX(at) at FROM events WHERE trend_id = ? AND at <= ? AND kind IN (${[...TOLD_KINDS].map(() => '?').join(', ')})`).all(c.id, t, ...TOLD_KINDS).map((r) => r.at);
  } catch { saved = []; }
  const all = [...fresh, ...saved].filter(Number.isFinite);
  return all.length ? Math.max(...all) : null;
}

const anyEarly = (c) => Object.values(c.early || {}).some(Boolean);
const within = (at, t, span) => Number.isFinite(at) && at <= t && t - at <= span;

/** What the labels say of one trend of the cycle at `t`: listed, its times listed (lib/labels/recur.js). */
function labelsOf(c, { t, listed = [], lastYear = null, toldAt = null } = {}) {
  const series = c.series || [];
  const next = c.next || {};
  const info = c.info || {};
  const m = c.measure || {};
  const early = anyEarly(c);
  const rising = c.status === 'rising';
  const newsAt = Math.max(-Infinity, ...[next.chapterAt, c.turnAt].filter((x) => Number.isFinite(x) && x <= t));
  const searches = Array.isArray(info.searches) ? info.searches : [];
  const searchedToday = searches.some((x) => Number.isFinite(x.start) && x.start <= t && (x.end === null || x.end === undefined || x.end > t - DAY));
  const told = ((c.sample && c.sample.n24) || 0) >= TOLD_MIN || searchedToday || within(newsAt, t, DAY);
  const run = RC.returningOf(listed.map((x) => x.t), t);
  // (weekly is a recurrence, never one long run: the listings of the run it is on now say nothing of a week back)
  const runs = RC.runsOf(listed.map((x) => x.t));
  const nowRun = runs.length && t - runs[runs.length - 1].to <= DAY ? runs[runs.length - 1] : null;
  const earlier = nowRun ? listed.filter((x) => x.t < nowRun.from) : listed;
  const weekly = RC.weeklyOf([...earlier, ...searches.filter((x) => Number.isFinite(x.start)).map((x) => ({ t: x.start, res: 0 }))], t);
  const firstSeen = c.trend && Number.isFinite(c.trend.firstSeen) ? c.trend.firstSeen : null;
  const daily = CU.dailyOf(series, { from: Math.max(t - ALWAYS_BACK, Number.isFinite(firstSeen) ? firstSeen : t - ALWAYS_BACK), now: t }).map((d) => d.v);
  const alwaysOn = RC.alwaysOnOf(daily);
  const evergreen = RC.evergreenOf(info.wikiTitle || null, lastYear);
  const fade = c.kind === 'talk' || c.kind === 'moment' ? CU.fadeCall(series, { startedAt: next.startedAt, firstSeen, now: t }) : null;
  const ranks = SL.ranksOf(series, t);
  const slid = SL.slid(ranks);
  // (B5: a ranked list led it when Reddit's places were its first creator-native sign; then only the top 2, not falling, is Early)
  const kf = info.kindFirst || {};
  const firstKinds = Object.entries(kf).filter(([k, at]) => k !== 'press' && k !== 'beat' && Number.isFinite(at));
  const ledAt = Math.min(Infinity, ...firstKinds.map(([, at]) => at));
  const rankedLed = firstKinds.some(([k, at]) => RANKED_KINDS.has(k) && at === ledAt);
  const rankedFails = rankedLed && Number.isFinite(ranks.now) && !SL.holds(ranks);
  const willFade = !!(fade && fade.willFade);
  const neverEarly = weekly || alwaysOn || evergreen;
  const noEarly = neverEarly || willFade || rankedFails;
  // (Fading by the curve only once it has turned down: a story at its peak is not said to fade, however short its life will be. Its
  // onset's "will fade" still takes Early away, B5)
  const turned = willFade && fade.anchor === 'turn';
  const fadingBy = rising || told || c.status === 'fading' ? null : turned ? 'curve' : slid ? 'list' : null;
  const spent = LA.spentOf({ kind: c.kind, nowShare: m.nowShare, peak: m.peak, peakAt: m.peakAt, n24: c.sample ? c.sample.n24 : 0, rising, early: early && !noEarly, newsAt: Number.isFinite(newsAt) ? newsAt : null, toldAt }, t);
  return { returning: run.returning, runFrom: run.returning ? run.runFrom : null, weekly, alwaysOn, evergreen, willFade, fadeP: fade ? fade.p : null, slid, rankedFails, neverEarly, noEarly, fadingBy, spent, told };
}

/** The trend as this cycle publishes it under its labels: Early taken away where B3/B5 forbid it, Fading where B4 says it. */
function publishedWith(c, lab) {
  let out = c;
  if (lab.noEarly && anyEarly(c)) out = { ...out, early: Object.fromEntries(Object.keys(c.early).map((a) => [a, false])) };
  if (lab.fadingBy && !anyEarly(out)) out = { ...out, status: 'fading', statusOwn: true, plain: false, timeLeftHours: null };
  return out === c ? c : { ...out, labels: lab };
}

/**
 * The cycle's labels: reads each trend, puts the published reading back in the cycle's map (the state's own `next` untouched) and
 * returns { labels: Map(id -> labels), counts }. db: the state (read only); lastYear: a Set of last year's Wikipedia top titles, or null.
 */
function apply(cycleState, { t, db = null, lastYear = null } = {}) {
  const labels = new Map();
  const counts = { returning: 0, weekly: 0, alwaysOn: 0, evergreen: 0, willFade: 0, slid: 0, earlyTaken: 0, fadingCurve: 0, fadingList: 0, spent: 0 };
  for (const [id, c] of [...cycleState.trends.entries()]) {
    let lab;
    try { lab = labelsOf(c, { t, listed: listedOf(db, c, t), lastYear, toldAt: toldAtOf(db, c, t) }); } catch { continue; }
    labels.set(id, lab);
    const next = publishedWith(c, lab);
    if (next !== c) cycleState.trends.set(id, next);
    for (const k of ['returning', 'weekly', 'alwaysOn', 'evergreen', 'willFade', 'slid', 'spent']) if (lab[k]) counts[k] += 1;
    if (anyEarly(c) && !anyEarly(next)) counts.earlyTaken += 1;
    if (lab.fadingBy === 'curve' && next.status === 'fading') counts.fadingCurve += 1;
    if (lab.fadingBy === 'list' && next.status === 'fading') counts.fadingList += 1;
  }
  return { labels, counts };
}

/** What the page's sink reads of a row (lib/page-sink.js sinkOf): { spent, runFrom }, or null with no labels for it. */
function sinkOf(labelled, id) {
  const lab = labelled && labelled.labels && labelled.labels.get(id);
  return lab ? { spent: lab.spent, runFrom: lab.runFrom } : null;
}

/** The rows with titles their sources of now bear out (lib/labels/title.js), each made again from its line where they do not. nowMs: the cycle's clock. */
// (its idea card says the same noun: the point's own title, where it ends with the noun the sources do not bear out)
const titled = (rows, nounTitle, nowMs = null) => rows.map((r) => {
  const x = TI.checked(r, nounTitle, nowMs);
  const noun = String(r.noun || '').toLowerCase();
  return x === r || !x.point || !noun || !String(x.point.title || '').toLowerCase().endsWith(noun) ? x : { ...x, point: { ...x.point, title: x.title } };
});

module.exports = { apply, labelsOf, publishedWith, listedOf, toldAtOf, sinkOf, titled };
