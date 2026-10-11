'use strict';
/*
 * The feed (ios/IDEAS-FEED.md D): each audience's list, the per-trend details and the bundles, from one cycle's rows and their
 * measured state (lib/history.js `step`). Nothing is written here; lib/publish.js does that. Every list is checked with the same
 * validator the samples ship (samples/validate.cjs): one bad row is left out and the rest ranked again, never the list held back.
 */
const V = require('../samples/validate.cjs');
const M = require('./measure');
const D = require('./describe');
const H = require('./history');
const ID = require('./identity');
const { AUDIENCES, TIME_ZONE, HOUR, DAY, instant, instantOrNull, localDay, noonIn, hashHex, minify } = require('./util');

const SCHEMA_VERSION = 1;
const PAGE_SIZE = 20;
const CYCLE_MINUTES = 15;
const ROWS_MAX = 80;
const LIST_BYTES_MAX = 120000;
const BUNDLE_ROWS = 30;
const BUNDLE_BYTES_MAX = 150000;
const EARLY_ROWS = [4, 9, 14];
const EARLY_IN_LIST = 12;
const DRAMA_ON_PAGE = 12;
const TITLE_MAX = 90;
const LINE_MAX = 200;
const GRAPH_STEPS = [[48 * HOUR, 30], [8 * DAY, 120], [24 * DAY, 360], [Infinity, 1440]];
const GRAPH_MAX_POINTS = 96;
const GRAPH_MIN_POINTS = 4;
const GRAPH_MIN_SPAN = 2 * HOUR;
const REBUILT_SCALE_MAX = 3;

/** Cut at a word, never mid-word, with an ellipsis; a text that fits is returned as it is. */
function cutText(text, max) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), Math.floor(max / 2))).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * A start as the audience's list carries it: an hour-precision start as it is; a start known only to the day as noon in the audience's
 * own time zone on that day there (C4), never a day that has not begun for them.
 */
function startFor(next, audience, t) {
  if (!Number.isFinite(next.startedAt)) return { startedAt: null };
  if (next.startedPrecision === 'hour') return { startedAt: next.startedAt, startedPrecision: 'hour' };
  const zone = TIME_ZONE[audience];
  const ref = Math.min(next.startedAt, t);
  return { startedAt: noonIn(localDay(ref, zone), zone), startedPrecision: 'day' };
}

/**
 * An outlet's name without the slogan its feed appends ("ABC News - Breaking News, Latest News and Videos" is "ABC News"), nor the
 * separator a feed leaves hanging on it ("What's Trending ·", as Google News names that outlet: seen on the first joined run).
 */
const outletName = (s) => String(s).split(/\s+[-–—|:·•]\s+/)[0].replace(/[\s·•|:–—-]+$/, '').trim();

/**
 * The series as the graph draws it: the rebuilt stretch (B1: the press's and the creators' shape only, no search, no reads) scaled up
 * to meet the first observed sample, by what that sample's whole interest is to its own press and creators' parts, three times at
 * most and never above the observed peak. A level the collector never saw is not drawn as a jump where it began to watch, and the
 * peak stays where it was measured. Only the drawing: the stored samples and everything measured from them are untouched.
 */
function joinRebuilt(series) {
  const seen = series.filter((s) => !s.backfilled && Number.isFinite(s.interest));
  const rebuilt = series.filter((s) => s.backfilled && Number.isFinite(s.interest));
  const first = seen.find((s) => s.observed);
  if (!first || !rebuilt.length) return series;
  const own = M.K.WEIGHTS.n * ((first.p && first.p.n) || 0) + M.K.WEIGHTS.c * ((first.p && first.p.c) || 0);
  const top = Math.max(...rebuilt.map((s) => s.interest));
  if (!(first.interest > 0) || !(top > 0)) return series;
  // (a story met between its headlines has no press in its first observed sample's look-back, so no ratio to give: the three times
  // decide. Left unscaled, as it was until the first joined run, its graph was a flat dashed line and a cliff at the last point:
  // "Kelly Clarkson says NYC store treated her like Julia Roberts", a day old and searched 100K times, drew as 11, 11, 11, 100)
  const byParts = own > 0 ? first.interest / own : Infinity;
  const k = Math.min(byParts, Math.max(...seen.map((s) => s.interest)) / top, REBUILT_SCALE_MAX);
  return k > 1 ? series.map((s) => (s.backfilled && Number.isFinite(s.interest) ? { ...s, interest: s.interest * k } : s)) : series;
}

/**
 * Where the graph marks the peak: on its highest step (the validator holds it to that), and of several steps that draw as the top,
 * the one nearest the time the row says it peaked (C5), so the ring and the caption are one day. With no time given: the last top
 * step. (Until the first joined run this was the last step at 100 whatever the row said: the benchmark row, whose steps of 1 and 5
 * October both round to 100, read "Peaked 1 Oct" under a ring on the 5th.)
 */
function peakIndex(v, at) {
  const tops = v.map((x, i) => (x === 100 ? i : -1)).filter((i) => i >= 0);
  if (!tops.length) return null;
  if (at === null) return tops[tops.length - 1];
  return tops.reduce((best, i) => (Math.abs(i - at) <= Math.abs(best - at) ? i : best));
}

/**
 * Interest over time as a detail draws it (D4): Ī as a share of its own peak (the peak is 100), on a grid whose step grows with the
 * trend's age, the last point this cycle's. null with fewer than 4 points, under 2 hours of them, or nothing above 0.
 * series: the trend's samples, oldest first. opts: { t, startedAt, peaked (the list sends a peak), peakAt (the time it sends),
 * firstObserved }.
 */
function graphOf(series, { t, startedAt, peaked, peakAt, firstObserved }) {
  const pts = M.smooth(joinRebuilt(series)).filter((x) => x.t <= t);
  if (!pts.length) return null;
  const from = Math.min(pts[0].t, Number.isFinite(startedAt) && startedAt >= pts[0].t - DAY ? startedAt : pts[0].t);
  let at = GRAPH_STEPS.findIndex(([age]) => t - from <= age);
  let stepMinutes;
  let n;
  let last;
  for (; at < GRAPH_STEPS.length; at++) {
    stepMinutes = GRAPH_STEPS[at][1];
    const step = stepMinutes * 60;
    last = Math.floor(t / step) * step;
    n = Math.floor((last - from) / step) + 1;
    if (n <= GRAPH_MAX_POINTS) break;
  }
  const step = stepMinutes * 60;
  if (n > GRAPH_MAX_POINTS) n = GRAPH_MAX_POINTS;
  if (n < GRAPH_MIN_POINTS || (n - 1) * step < GRAPH_MIN_SPAN) return null;
  const t0 = last - (n - 1) * step;
  const raw = [];
  let cursor = 0;
  let held = 0;
  for (let i = 0; i < n; i++) {
    const g = t0 + i * step;
    const inStep = [];
    while (cursor < pts.length && pts[cursor].t <= g) { if (pts[cursor].t > g - step) inStep.push(pts[cursor].i); held = pts[cursor].i; cursor += 1; }
    // (the mean of what fell in the step; a step with no sample holds the last value; before the first sample, nothing)
    raw.push(inStep.length ? inStep.reduce((a, b) => a + b, 0) / inStep.length : g < pts[0].t ? 0 : held);
  }
  const top = Math.max(...raw);
  if (!(top > 0)) return null;
  const v = raw.map((x) => Math.round((100 * x) / top));
  const index = (seconds) => Math.min(n - 1, Math.max(0, Math.floor((seconds - t0) / step)));
  const peak = peaked ? peakIndex(v, Number.isFinite(peakAt) ? Math.min(n - 1, Math.max(0, Math.ceil((peakAt - t0) / step))) : null) : null;
  return { t0: instant(t0), stepMinutes, v, start: Number.isFinite(startedAt) ? Math.min(n - 1, Math.max(0, Math.ceil((startedAt - t0) / step))) : 0, peak: peak !== null && peak >= 0 ? peak : null,
    observedFrom: Number.isFinite(firstObserved) ? index(firstObserved) : n - 1 };
}

/** One trend's detail (D4), the same for every audience, and its rev (a hash of what it shows, not of when it was written). */
function detailOf(c, { t, generatedAt, db, peaked }) {
  const row = c.primary;
  // (as this cycle leaves them: the samples whose press was read again are drawn as revised, before they are written)
  const revised = new Map((c.revised || []).map((r) => [`${r.t}|${r.res}`, r]));
  const stored = c.met ? [] : H.rawSeries(db, c.id, 0, t - 1).map((r) => H.sampleOfRow(revised.get(`${r.t}|${r.res}`) || r));
  const series = [...c.backfilled.map(H.sampleOfRow), ...stored, c.series[c.series.length - 1]];
  const graph = graphOf(series, { t, startedAt: c.next.startedPrecision === 'hour' ? c.next.startedAt : null, peaked, peakAt: c.next.peakAt, firstObserved: c.firstObserved });
  const saved = c.met ? [] : db.prepare('SELECT at, kind, precision, text FROM events WHERE trend_id = ?').all(c.id);
  const fresh = c.events.filter((e) => !saved.some((s) => s.at === e.at && s.kind === e.kind));
  // (the start is one: this cycle's, when it moved)
  const start = c.events.find((e) => e.kind === 'start');
  const events = [...saved.filter((e) => e.kind !== 'start' || !start || e.at === start.at), ...fresh];
  const peakAt = peaked && Number.isFinite(c.next.peakAt) && c.firstObserved !== null && c.next.peakAt >= c.firstObserved && !events.some((e) => e.kind === 'peak') ? [{ at: c.next.peakAt, kind: 'peak', precision: 'hour', text: 'Interest peaks.' }] : [];
  const observedAt = graph ? Date.parse(graph.t0) / 1000 + graph.observedFrom * graph.stepMinutes * 60 : null;
  const timeline = H.timelineOf([...events, ...peakAt], { startedAt: c.next.startedAt, until: t })
    // (a measured fact is never dated inside the stretch the graph draws as rebuilt)
    .filter((e) => e.kind !== 'measure' || observedAt === null || e.at >= observedAt)
    // (a date and no hour: the one file every audience reads dates it at noon UTC of its day, the same calendar day on nearly every
    // phone. Google News dates a week-old headline at midnight Pacific, 07:00Z, which is the evening before in Alaska and Hawaii)
    .map((e) => (e.precision === 'day' ? { ...e, at: Math.min(Math.floor(e.at / DAY) * DAY + 12 * HOUR, t) } : e))
    .sort((x, y) => x.at - y.at || (x.kind === 'start' ? -1 : y.kind === 'start' ? 1 : 0))
    .map((e) => ({ at: instant(e.at), precision: e.precision, text: cutText(e.text, 120), kind: e.kind }));
  const src = row.type === 'word' ? row.word : row.type === 'moment' ? row.moment : row.point;
  const sources = [...new Set((src.sources || []).filter((s) => typeof s === 'string' && s.trim()).map(outletName)
    // (a clip chart reported nothing: a clip on it is a signal, never a source to name under "Reported by")
    .filter((s) => s && !/^(?:google news|twitch|kick)$/i.test(s)).map((s) => cutText(s, 60)))].slice(0, 6);
  const body = { graph, timeline, why: D.whyOf(row, 'mixed').map((w) => cutText(w, 160)), sources };
  const rev = hashHex(minify(body), 6);
  return { schemaVersion: SCHEMA_VERSION, id: c.id, rev, generatedAt: instant(generatedAt), ...body };
}

/** One row of one audience's list (D3 Item), without its rank and urgency (the list sets those once its order is final). */
function itemOf(row, c, audience, { t, roster, detail, textAt }) {
  const isEarly = !!c.early[audience];
  const status = isEarly ? 'rising' : c.status;
  const started = startFor(c.next, audience, t);
  const grim = c.grim;
  const about = D.aboutOf(row, roster);
  const homeSearch = D.homeSearchOf(row, audience);
  const peakAt = M.peakToSend(status, c.next.peakAt, t);
  const timeLeft = isEarly || row.kind !== 'talk' || started.startedAt === null ? null : c.timeLeftHours;
  const item = {
    id: c.id,
    keys: ID.withKey(c.info.keys, row.cardKey),
    kind: row.kind,
    sub: D.subOf(row),
    title: cutText(row.title, TITLE_MAX),
    line: row.line ? cutText(row.line, LINE_MAX) : null,
    // (G: "model" only for a line the claim check passed, lib/line-writer.js; everything else is a headline's)
    lineWrittenBy: row.line && row.lineWrittenBy === 'model' ? 'model' : 'headline',
    status,
    statusMeasured: c.statusMeasured,
    isEarly,
    startedAt: instantOrNull(started.startedAt),
    ...(started.startedAt !== null ? { startedPrecision: started.startedPrecision } : {}),
    peakAt: peakAt !== null && (started.startedAt === null || peakAt >= started.startedAt) ? instant(peakAt) : null,
    timeLeftHours: timeLeft ?? null,
    heat: Math.min(100, Math.max(0, Math.round(row.heat))),
    demand: D.demandOf(row, audience),
    rank: 0,
    filmWithin24h: false,
    spike: M.isSpike({ t, measured: c.statusMeasured, status, startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, grim, early: isEarly, homeSearch, kinds: c.kinds }),
    flareAt: instantOrNull(M.flareOf({ t, status, grim, startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, chapterAt: c.next.chapterAt, earlyAt: c.next.earlyAt })),
    ...(row.drama ? { drama: true } : {}),
    ...(row.kind === 'talk' && row.tier ? { tier: row.tier } : {}),
    people: about.people,
    topics: D.topicsOf(row),
    tags: about.tags,
    ...(about.topic ? { topic: about.topic } : {}),
    ...D.sensitiveOf(row),
    examples: D.examplesOf(row),
    idea: D.ideaOf(row),
    detailRev: detail ? detail.rev : 'none',
    ...(Number.isFinite(textAt) ? { updatedAt: instant(textAt) } : {}),
  };
  // (what the list ranks urgency by, kept off the published row)
  const urgent = M.urgentCandidate({ t, measured: c.statusMeasured, status, startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, grim, early: isEarly, timeLeftHours: item.timeLeftHours });
  return { item, urgent: urgent ? (c.measure.v || 0) * item.heat : null };
}

/**
 * The page with its Early rows spliced in (C3): at most three, at rows 4, 9 and 14, the strongest first; the page's last rows move
 * to "Show more", passing over a people-drama row while moving it would leave the page under 12 of them when that many are there.
 * rows: the engine's order (its page rules already applied); early: the Early rows, strongest first. Returns the new order.
 */
function spliceEarly(rows, early, pageSize = PAGE_SIZE) {
  const lift = early.slice(0, EARLY_ROWS.length);
  if (!lift.length) return rows;
  const lifted = new Set(lift);
  const rest = rows.filter((r) => !lifted.has(r));
  const page = rest.slice(0, pageSize);
  const more = rest.slice(pageSize);
  lift.forEach((r, i) => { page.splice(Math.min(EARLY_ROWS[i] - 1, page.length), 0, r); });
  const out = [];
  while (page.length > pageSize) {
    const dramas = page.filter((r) => r.drama).length;
    let at = page.length - 1;
    while (at >= 0 && (lifted.has(page[at]) || (page[at].drama && dramas === DRAMA_ON_PAGE))) at -= 1;
    if (at < 0) at = page.length - 1;
    out.unshift(page.splice(at, 1)[0]);
  }
  return [...page, ...out, ...more];
}
/** The Early rows of a list, strongest first: more kinds of source, then the higher velocity, then a creators' story. */
const earlyOrder = (rows, cycleOf) => rows.map((r, i) => ({ r, i, c: cycleOf(r) })).sort((a, b) => M.kindCount(b.c.info.kindFirst) - M.kindCount(a.c.info.kindFirst) ||
  (b.c.measure.v || 0) - (a.c.measure.v || 0) || Number(b.r.tier === 'creator') - Number(a.r.tier === 'creator') || a.i - b.i).map((x) => x.r);

/**
 * Every audience's list, the details and the bundles of one cycle.
 * input: { t (slot), generatedAt, cycle (history.step), rowsByAudience, roster, db, sourcesAt, nextExpectedAt, stale: [source ids] }.
 * Returns { lists: { audience: list }, details: Map(id -> detail), bundles: { audience: bundle }, published: Map(id -> what history
 * writes of it), dropped: { audience: [{ title, problems }] }, problems: { audience: [list problems] } }.
 */
function build({ t, generatedAt, cycle, rowsByAudience, roster, db, sourcesAt, nextExpectedAt, stale = [] }) {
  const lists = {};
  const bundles = {};
  const dropped = {};
  const problems = {};
  const details = new Map();
  const published = new Map();
  const lastText = db.prepare('SELECT t, title, line FROM texts WHERE trend_id = ? ORDER BY t DESC LIMIT 1');
  const detailFor = (c, peaked) => {
    if (!details.has(c.id)) {
      const d = detailOf(c, { t, generatedAt, db, peaked });
      const bad = V.validateDetail(d, { bytes: Buffer.byteLength(minify(d)), name: `d/${c.id}` });
      // (a detail that fails is not written: the sheet stands without one, E2)
      details.set(c.id, bad.length ? null : d);
    }
    return details.get(c.id);
  };
  const generated = instant(generatedAt);
  for (const audience of AUDIENCES) {
    const all = (rowsByAudience[audience] || []).filter((r) => r.id && cycle.trends.has(r.id));
    if (!all.length) continue;
    const cycleOf = (r) => cycle.trends.get(r.id);
    // at most 12 Early rows in a list: the strongest keep the tag
    const earlyAll = earlyOrder(all.filter((r) => cycleOf(r).early[audience]), cycleOf);
    const early = new Set(earlyAll.slice(0, EARLY_IN_LIST));
    let ordered = spliceEarly(all, earlyAll.slice(0, EARLY_IN_LIST)).slice(0, ROWS_MAX);
    dropped[audience] = [];
    let items = [];
    // one bad row never holds the list back: it is left out and the rest ranked again
    for (let pass = 0; pass < 5; pass++) {
      const built = ordered.map((row) => {
        const c = cycleOf(row);
        const cTagged = early.has(row) ? c : { ...c, early: { ...c.early, [audience]: false } };
        const status = cTagged.early[audience] ? 'rising' : c.status;
        const detail = detailFor(c, M.peakToSend(status, c.next.peakAt, t) !== null);
        const old = c.met ? null : lastText.get(c.id);
        const textAt = old && old.title === row.title && (old.line || null) === (row.line || null) ? old.t : t;
        return { row, c, ...itemOf(row, cTagged, audience, { t, roster, detail, textAt }) };
      });
      built.forEach((b, i) => { b.item.rank = i + 1; });
      const urgent = new Set(built.filter((b) => b.urgent !== null).sort((a, b) => b.urgent - a.urgent).slice(0, M.K.URGENT_MAX).map((b) => b.item.id));
      for (const b of built) b.item.filmWithin24h = urgent.has(b.item.id);
      const bad = built.map((b, i) => ({ b, found: V.validateRow(b.item, i, generated) })).filter((x) => x.found.length);
      items = built;
      if (!bad.length) break;
      for (const x of bad) dropped[audience].push({ title: x.b.item.title, problems: x.found });
      const out = new Set(bad.map((x) => x.b.row));
      ordered = ordered.filter((r) => !out.has(r));
    }
    const header = { schemaVersion: SCHEMA_VERSION, audience, generatedAt: generated, ...(Number.isFinite(sourcesAt) ? { sourcesAt: instant(Math.min(sourcesAt, generatedAt)) } : {}),
      nextExpectedAt: instant(Math.max(nextExpectedAt, generatedAt + 60)), cycleMinutes: CYCLE_MINUTES, pageSize: PAGE_SIZE, ...(stale.length ? { health: { stale } } : {}) };
    let list = { ...header, items: items.map((b) => b.item) };
    // the lowest rows go to stay under 120 KB raw
    while (list.items.length > V.LIMITS.minRows && Buffer.byteLength(minify(list)) > LIST_BYTES_MAX) list = { ...header, items: list.items.slice(0, -1) };
    items = items.slice(0, list.items.length);
    problems[audience] = V.validateList(list, { bytes: Buffer.byteLength(minify(list)), audience });
    lists[audience] = list;
    for (const b of items) {
      // (the line as published: the written one where a row has one, lib/line-writer.js)
      const p = published.get(b.item.id) || { ranks: {}, heats: {}, early: false, onPage: false, title: b.c.primary.title, line: b.row.line ?? b.c.primary.line, lineWrittenBy: b.item.lineWrittenBy, sub: b.item.sub };
      p.ranks[audience] = b.item.rank;
      p.heats[audience] = b.item.heat;
      p.early = p.early || b.item.isEarly;
      p.onPage = p.onPage || b.item.rank <= PAGE_SIZE;
      published.set(b.item.id, p);
    }
    // the bundle: the details of the first 30 rows and of the Early rows, 150 KB at most
    const wanted = items.filter((b) => b.item.rank <= BUNDLE_ROWS || b.item.isEarly).map((b) => details.get(b.item.id)).filter(Boolean);
    let bundle = { schemaVersion: SCHEMA_VERSION, audience, generatedAt: generated, details: wanted };
    while (bundle.details.length && Buffer.byteLength(minify(bundle)) > BUNDLE_BYTES_MAX) bundle = { ...bundle, details: bundle.details.slice(0, -1) };
    bundles[audience] = bundle;
  }
  for (const [id, d] of [...details]) if (!d || !published.has(id)) details.delete(id);
  return { lists, details, bundles, published, dropped, problems };
}

module.exports = { build, itemOf, detailOf, graphOf, peakIndex, joinRebuilt, spliceEarly, earlyOrder, startFor, cutText, outletName, SCHEMA_VERSION, PAGE_SIZE, ROWS_MAX, LIST_BYTES_MAX, EARLY_ROWS };
