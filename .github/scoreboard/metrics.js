'use strict';
/*
 * One scored day's numbers (scoreboard-spec.json lead, coverage, breadth, precision, speed), from the comparators' history (the
 * scoreboard's cache), our side (ours.js, a read-only state) and the ledger. Pure: everything comes in as arguments.
 *
 * Returns { result, store }:
 *   result  aggregate numbers only (counts, shares, hours, minutes): what may be published
 *   store   what the next days pool, for the scoreboard's cache: the day's lead values ({ h, o } a shared trend: hours and outcome, no
 *           name, id or instant) and breadth counts. Never a matched pair: the cache of a public repository is not private (a fork's
 *           pull request can restore it), so nothing of ours per trend ever leaves this function
 */
const M = require('./match');
const { urlKey } = require('./ours');
const { entriesOf } = require('./history');
const { HOUR, DAY, round, share, median, quantile, mean, dayBounds, dayOfSeconds, addDays } = require('./stats');

const COMPARATORS = ['gt', 'kym', 'viral50', 'x'];

/** An entry's own time (epoch s) or null: GT's start, KYM's pubDate, the Viral 50's first chart day (null when the scoreboard's first read already showed it), X: the scoreboard's first read. */
function ownTime(c, e, comp) {
  if (c === 'gt' || c === 'kym') return Number.isFinite(e.own) ? e.own : null;
  if (c === 'viral50') return e.firstRead === comp.firstReadAt || !e.firstChartDay ? null : dayBounds(e.firstChartDay).start;
  if (c === 'x') return Number.isFinite(e.firstRead) ? e.firstRead : null;
  return null;
}

/** When the collector's own read of the comparator first showed the entry (null: never, or the collector cannot read it). */
function collectorSighting(c, e, trendId, ours) {
  if (c === 'gt') return trendId ? ours.sightings.gt.get(trendId) ?? null : null;
  if (c === 'kym') return ours.sightings.kym.get(urlKey(e.key)) ?? null;
  if (c === 'viral50') return ours.sightings.viral50.get(e.key) ?? null;
  return null;
}

const minOf = (...xs) => { const v = xs.filter(Number.isFinite); return v.length ? Math.min(...v) : null; };

/**
 * Whether our own read of the comparator showed the entry, whatever was made of it (ours.reads): Google Trends by the keyword as
 * typed, Know Your Meme by its address, the Viral 50 by its sound. X: the collector does not read getdaytrends (null).
 */
function readByUs(c, e, ours) {
  const reads = ours.reads || {};
  if (c === 'gt') return !!reads.gt && reads.gt.has(String(e.title || '').toLowerCase().replace(/\s+/g, ' ').trim());
  if (c === 'kym') return !!reads.kym && reads.kym.has(urlKey(e.key));
  if (c === 'viral50') return !!reads.viral50 && reads.viral50.has(e.key);
  return null;
}

/**
 * Every comparator entry of the history, matched: Map(comparator -> [{ key, e, own, surface, sighting, match, built, read }]).
 * built: the entry's match among the trends we built and never listed inside listDepth (only when it matched no listed one);
 * read: whether our own read of the comparator showed it (readByUs).
 */
function matchHistory(history, ours, spec) {
  const index = M.prepareOurs([...ours.trends.values()].filter((t) => t.listed !== null), spec);
  const unlisted = M.prepareOurs([...ours.trends.values()].filter((t) => t.listed === null), spec);
  const out = new Map();
  for (const c of COMPARATORS) {
    const comp = history.comparators[c];
    if (!comp) { out.set(c, null); continue; }
    out.set(c, entriesOf(history, c).map((e) => {
      const own = ownTime(c, e, comp);
      const match = M.matchEntry({ title: e.title, artist: e.artist || null, related: e.related || [], t: own ?? e.firstRead }, c, index);
      const sighting = collectorSighting(c, e, match && match.id, ours);
      const built = match ? null : M.matchEntry({ title: e.title, artist: e.artist || null, related: e.related || [], t: own ?? e.firstRead }, c, unlisted);
      return { key: e.key, e, own, sighting, surface: minOf(own, sighting), match, built, read: readByUs(c, e, ours) };
    }));
  }
  return out;
}

const statusOf = (n, spec) => (n >= spec.minN ? 'ok' : spec.insufficient);

/** Whether the state covers an entry's whole window: it surfaced after the cold start ended and the state reaches 24 h past it. */
const reaches = (ours, at, spec) => at > ours.coldEnd && Number.isFinite(ours.lastSampleAt) && at + spec.coverage.withinHours * HOUR <= ours.lastSampleAt;

/**
 * Lead for one comparator: the day's shared trends, one each at its earliest surface. Every matched pair whose first listing falls
 * within lead.window.days either side of its surface is in n (spec lead.window): first when listed before the surface, tie when
 * listed at or after our own read of the comparator showed it, else late with its real hours. listedLate is a sub-count of the late.
 */
function leadOf(c, rows, ours, { start, end }, spec) {
  const earliest = new Map();
  for (const r of rows) {
    if (!r.match || r.own === null || r.surface === null) continue;
    const old = earliest.get(r.match.id);
    if (!old || r.surface < old.surface) earliest.set(r.match.id, r);
  }
  const values = [];
  let excluded = 0;
  let listedLate = 0;
  const window = spec.lead.window.days * DAY;
  for (const [id, r] of earliest) {
    if (r.surface < start || r.surface >= end) continue;
    const tr = ours.trends.get(id);
    if (!tr || tr.cold || tr.reseeded || !reaches(ours, r.surface, spec)) { excluded += 1; continue; }
    if (Math.abs(tr.listed - r.surface) > window) continue;
    const tie = r.sighting !== null && tr.listed >= r.sighting;
    const h = tie ? 0 : (r.surface - tr.listed) / HOUR;
    const o = tie || h === 0 ? 'tie' : h > 0 ? 'first' : 'late';
    if (o === 'late' && tr.listed > r.surface + spec.lead.listedLate.hours * HOUR) listedLate += 1;
    values.push({ h: round(h, 2), o });
  }
  return { values, excluded, listedLate };
}

/** Lead numbers from values [{ h, o }]: n, first, tie, late, median, share first (null under minN). */
function leadNumbers(values, spec) {
  const n = values.length;
  const first = values.filter((v) => v.o === 'first').length;
  const ok = n >= spec.minN;
  return { n, first, tie: values.filter((v) => v.o === 'tie').length, late: values.filter((v) => v.o === 'late').length,
    medianHours: ok ? round(median(values.map((v) => v.h)), 1) : null, shareFirst: ok ? share(first, n) : null, status: statusOf(n, spec) };
}

/**
 * The scope entries of a comparator for the day, each with its anchor (when it counts from: spec coverage.anchor). Google Trends and
 * Know Your Meme are anchored on the entry's own time, never on our read of it, so a link our read made later never moves an entry
 * between days.
 */
function scopeOf(c, rows, history, { start, end }, spec) {
  const comp = history.comparators[c];
  const def = spec.comparators[c];
  if (!rows || !comp) return null;
  const inDay = (r) => r.anchor !== null && r.anchor >= start && r.anchor < end;
  if (c === 'gt') {
    return rows.filter((r) => (r.e.categories || []).some((k) => def.scope.categories.includes(k)) && (r.e.volume || 0) >= def.scope.minVolume)
      .map((r) => ({ ...r, anchor: r.own })).filter(inDay);
  }
  if (c === 'kym') return rows.map((r) => ({ ...r, anchor: r.own })).filter(inDay);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  if (c === 'viral50') {
    // (the chart dated that day, else the next day's, else the day before's: the page runs a day or two behind)
    const day = dayOfSeconds(start);
    const charts = comp.charts || {};
    const pick = [day, addDays(day, 1), addDays(day, -1)].find((d) => charts[d]);
    return pick ? charts[pick].slice(0, def.scope.top).map((k) => byKey.get(k)).filter(Boolean).map((r) => ({ ...r, anchor: start })) : null;
  }
  const snap = (comp.snapshots || []).find((s) => s.t >= start && s.t < end);
  return snap ? snap.keys.slice(0, def.scope.top).map((k) => byKey.get(k)).filter(Boolean).map((r) => ({ ...r, anchor: snap.t })) : null;
}

/**
 * Coverage for one comparator: of its scope entries of the day, the share we listed from 7 days before to 24 h after the anchor,
 * split first (listed before the surface, the rule lead uses) and via. Under minN entries: insufficient, no share.
 * stages (spec coverage.stages): where each entry we did not cover was lost, as counts: listedLate (listed, more than 24 h after the
 * anchor), outside (listed, but more than 7 days before it: another story of the same words), notListed (matched only a trend we
 * built and never listed inside listDepth), readOnly (matched nothing we built, but our own read of the comparator showed it),
 * unseen (neither); null for a comparator the collector does not read. They sum to n - covered.
 */
function coverageOf(scope, ours, spec, { readable: readsIt = true } = {}) {
  if (!scope) return null;
  let n = 0; let covered = 0; let first = 0; let excluded = 0;
  const stages = { listedLate: 0, outside: 0, notListed: 0, readOnly: 0, unseen: 0 };
  let readable = readsIt;
  for (const r of scope) {
    if (!reaches(ours, r.anchor, spec)) { excluded += 1; continue; }
    n += 1;
    const tr = r.match && ours.trends.get(r.match.id);
    if (!tr || tr.listed === null) {
      if (r.built) stages.notListed += 1;
      else if (r.read === null || !readable) readable = false;
      else if (r.read) stages.readOnly += 1;
      else stages.unseen += 1;
      continue;
    }
    if (tr.listed > r.anchor + spec.coverage.withinHours * HOUR) { stages.listedLate += 1; continue; }
    if (tr.listed < r.anchor - spec.lead.window.days * DAY) { stages.outside += 1; continue; }
    covered += 1;
    if (tr.listed < (r.surface ?? r.anchor)) first += 1;
  }
  const ok = n >= spec.minN;
  return { n, covered, first, via: covered - first, excluded, share: ok ? share(covered, n) : null, firstShare: ok ? share(first, covered) : null, status: statusOf(n, spec),
    stages: readable ? stages : { listedLate: stages.listedLate, outside: stages.outside, notListed: stages.notListed, readOnly: null, unseen: null } };
}

/** Page one of a list: its rows ranked inside the page, in rank order. */
const pageOf = (list, spec) => list.items.filter((x) => Number.isFinite(x.rank) && x.rank <= spec.ours.page).sort((a, b) => a.rank - b.rank);

/**
 * The day's page-one rows as distinct stories: the rows of every archived list of the day, joined when the matcher joins their
 * titles (M.sameStory), each story with its trend ids and its first page one (the earliest of its rows', ours.firstPage).
 */
function storiesOf(lists, ours, spec) {
  const m = spec.matcher;
  const stories = [];
  for (const l of lists) for (const x of pageOf(l, spec)) {
    const key = M.storyOf(x, m);
    const tr = ours.trends.get(x.id);
    const at = tr && Number.isFinite(tr.firstPage) ? tr.firstPage : null;
    const s = stories.find((y) => y.ids.has(x.id) || y.keys.some((k) => M.sameStory(k, key, m)));
    if (!s) { stories.push({ ids: new Set([x.id]), keys: [key], firstPage: at }); continue; }
    s.ids.add(x.id);
    s.keys.push(key);
    if (at !== null && (s.firstPage === null || at < s.firstPage)) s.firstPage = at;
  }
  return stories;
}

/**
 * Breadth for the day, flow over flow (spec breadth): the distinct stories that first reached page one that day, shared or only here
 * and confirmed, over Google Trends' scope entries that started that day. Both count from the end of the state's cold start: a
 * story on page one at a state's first cycle (or a reseed's) is not known to be new, so neither half counts those hours. Under minN
 * starts the day's ratio is insufficient; the target is judged on the pool (report.js).
 */
function breadthOf(lists, matched, ours, history, { start, end }, spec) {
  if (!lists.length) return null;
  const from = Number.isFinite(ours.coldEnd) ? Math.max(start, ours.coldEnd) : start;
  const stories = storiesOf(lists, ours, spec);
  const surfaces = new Map();
  for (const rows of matched.values()) for (const r of rows || []) {
    const at = r.surface ?? r.own ?? r.e.firstRead;
    if (!r.match || !Number.isFinite(at)) continue;
    if (!surfaces.has(r.match.id)) surfaces.set(r.match.id, []);
    surfaces.get(r.match.id).push(at);
  }
  const conf = spec.breadth.onlyHere.confirm;
  let fresh = 0; let shared = 0; let onlyHere = 0; let confirmed = 0;
  for (const s of stories) {
    const t = s.firstPage;
    if (t === null || t < from || t >= end) continue;
    fresh += 1;
    const near = [...s.ids].some((id) => (surfaces.get(id) || []).some((x) => Math.abs(x - t) <= spec.breadth.sharedDays * DAY));
    if (near) { shared += 1; continue; }
    onlyHere += 1;
    if ([...s.ids].some((id) => ours.series(id, t - conf.hoursBefore * HOUR, t + conf.hoursAfter * HOUR).some((x) => (x.outlets || 0) >= conf.outletsMin))) confirmed += 1;
  }
  const gtRows = matched.get('gt');
  const gtScope = gtRows ? scopeOf('gt', gtRows, history, { start, end }, spec) : null;
  const gtStarts = gtScope ? gtScope.filter((r) => r.anchor >= from).length : null;
  const counted = shared + confirmed;
  const ok = Number.isFinite(gtStarts) && gtStarts >= spec.minN;
  return { pageStories: stories.length, newStories: fresh, shared, onlyHere, onlyHereConfirmed: confirmed, stories: counted, gtStarts,
    ratio: ok ? round(counted / gtStarts, 2) : null, status: gtStarts === null ? 'unmeasured' : statusOf(gtStarts, spec) };
}

/** Whether a page-one row was live a day after the list (spec precision.live), or null when the state does not reach that far. */
function liveAfter(id, t, ours, live) {
  if (!ours.lastSampleAt || ours.lastSampleAt < t + live.toHours * HOUR) return null;
  const tr = ours.trends.get(id);
  if (!tr) return false;
  if (tr.endedAt !== null && tr.endedAt !== undefined && tr.endedAt <= t + live.notEndedHours * HOUR) return false;
  const before = ours.series(id, t - 6 * HOUR, t).filter((s) => Number.isFinite(s.interest)).pop();
  const base = before ? before.interest : null;
  return ours.series(id, t + live.fromHours * HOUR, t + live.toHours * HOUR)
    .some((s) => (s.n24 || 0) >= live.n24Min || (base > 0 && Number.isFinite(s.interest) && s.interest >= live.interestShare * base));
}

/** Rows that repeat a row ranked above them: the same story to the matcher (M.sameStory: the same title folded, or title cores it joins). */
function duplicatesOf(rows, spec) {
  const m = spec.matcher;
  const seen = [];
  let dup = 0;
  for (const x of rows) {
    const key = M.storyOf(x, m);
    if (seen.some((s) => M.sameStory(s, key, m))) dup += 1;
    seen.push(key);
  }
  return dup;
}

/** Precision for the day: each archived list's page one, checked 24 hours on. */
function precisionOf(lists, ours, now, spec) {
  const p = spec.precision;
  const out = [];
  for (const l of lists) {
    const rows = pageOf(l, spec);
    const checks = rows.map((x) => (now >= l.t + p.live.toHours * HOUR ? liveAfter(x.id, l.t, ours, p.live) : null));
    const checked = checks.every((v) => v !== null) && rows.length > 0;
    const old = rows.filter((x) => Date.parse(x.startedAt) / 1000 < l.t - p.oldDays * DAY && x.status !== 'rising' && !x.isEarly).length;
    const res = { mark: l.mark, rows: rows.length, checked, live: checked ? checks.filter(Boolean).length : null,
      fading: rows.filter((x) => x.status === 'fading' && x.statusMeasured).length, duplicates: duplicatesOf(rows, spec), old };
    const liveMin = p.gate.liveMin - Math.max(0, spec.ours.page - rows.length);
    out.push({ ...res, gate: checked ? res.live >= liveMin && res.duplicates <= p.gate.duplicatesMax && res.fading <= p.gate.fadingMax : null });
  }
  const checked = out.filter((x) => x.checked);
  return { lists: out, gate: checked.length ? checked.every((x) => x.gate) : null };
}

/** Speed for the day from the ledger's lines: publish lag, the feed's mean age at a random moment, gaps, failures, the probe. */
function speedOf(lines, { start, end }, spec) {
  const parsed = lines.map((l) => ({ ...l, slotAt: Date.parse(l.slot) / 1000, pubAt: l.published ? Date.parse(l.published) / 1000 : null }))
    .filter((l) => Number.isFinite(l.slotAt));
  const day = parsed.filter((l) => l.slotAt >= start && l.slotAt < end);
  if (!day.length) return null;
  const pubs = parsed.filter((l) => Number.isFinite(l.pubAt)).sort((a, b) => a.pubAt - b.pubAt);
  const lags = day.filter((l) => Number.isFinite(l.pubAt)).map((l) => (l.pubAt - l.slotAt) / 60);
  // (the age at a random moment of the day: piecewise, from each publish to the next, minutes since the newest feed's slot)
  let area = 0; let span = 0; let gap = 0; let prev = null;
  for (let i = 0; i < pubs.length; i++) {
    const from = Math.max(pubs[i].pubAt, start);
    const to = Math.min(i + 1 < pubs.length ? pubs[i + 1].pubAt : end, end);
    if (to > from) {
      const a0 = from - pubs[i].slotAt; const a1 = to - pubs[i].slotAt;
      area += ((a0 + a1) / 2) * (to - from);
      span += to - from;
    }
    if (pubs[i].pubAt >= start && pubs[i].pubAt < end) { if (prev !== null) gap = Math.max(gap, pubs[i].pubAt - prev); prev = pubs[i].pubAt; }
  }
  const probes = day.map((l) => spec.speed.probeFields.map((f) => l[f]).find(Number.isFinite)).filter(Number.isFinite).map((s) => s / 60);
  return { runs: day.length, published: lags.length, failed: day.filter((l) => Number.isFinite(l.code) && l.code >= 3).length,
    lagMedianMinutes: round(median(lags), 1), lagP90Minutes: round(quantile(lags, 0.9), 1), meanAgeMinutes: span ? round(area / span / 60, 1) : null,
    ageCoveredShare: share(span, end - start), maxGapMinutes: gap ? round(gap / 60, 1) : null, probeN: probes.length, probeMeanAgeMinutes: round(mean(probes), 1) };
}

/** The scored day: { result (aggregates), store (name-free values the next days pool: the cache's) }. */
function scoreDay({ day, now, spec, history, ours, ledger = [] }) {
  const bounds = dayBounds(day);
  const matched = matchHistory(history, ours, spec);
  const lead = {}; const leadStore = {};
  for (const c of COMPARATORS) {
    if (!spec.comparators[c].lead) continue;
    const rows = matched.get(c);
    if (!rows) { lead[c] = { n: 0, status: 'unmeasured' }; continue; }
    const r = leadOf(c, rows, ours, bounds, spec);
    lead[c] = { ...leadNumbers(r.values, spec), excluded: r.excluded, listedLate: r.listedLate };
    leadStore[c] = r.values;
  }
  const coverage = {};
  for (const c of COMPARATORS) {
    const cov = coverageOf(scopeOf(c, matched.get(c), history, bounds, spec), ours, spec, { readable: readByUs(c, { title: '', key: '' }, ours) !== null });
    coverage[c] = cov || { status: 'unmeasured' };
  }
  const lists = ours.lists.filter((l) => l.day === day);
  const breadth = breadthOf(lists, matched, ours, history, bounds, spec) || { status: 'nolists' };
  const precision = lists.length ? precisionOf(lists, ours, now, spec) : { lists: [], gate: null };
  const speed = speedOf(ledger, bounds, spec) || { status: 'noledger' };
  const breadthStore = Number.isFinite(breadth.gtStarts) ? { stories: breadth.stories, gtStarts: breadth.gtStarts } : null;
  return { result: { day, lead, coverage, breadth, precision, speed }, store: { lead: leadStore, breadth: breadthStore } };
}

module.exports = { COMPARATORS, scoreDay, matchHistory, readByUs, leadOf, leadNumbers, scopeOf, coverageOf, storiesOf, breadthOf, precisionOf, duplicatesOf, liveAfter, speedOf, ownTime };
