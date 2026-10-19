'use strict';
/*
 * The comparators' history, kept between daily runs in the scoreboard's own cache (scoreboard-spec.json "cache"): every entry a
 * comparator showed in the last days, when the scoreboard first and last read it, the Viral 50's charts by day, X's snapshots, and
 * each scored day's name-free values (lead hours and outcomes, breadth counts) for the pools. Never a matched pair or anything of
 * ours per trend: this repository is public and a fork's pull request can restore its caches. The cache is still never put on a
 * branch, in an artifact or in a log line. A new history is returned on every change (nothing is changed in place).
 */
const { DAY, dayOfSeconds } = require('./stats');

const SCHEMA = 2;
const empty = () => ({ schema: SCHEMA, comparators: {}, reads: {}, days: {} });

/** A history from the cache's file text, or an empty one (no file, another schema, unreadable). */
function fromText(text) {
  try {
    const h = JSON.parse(text);
    return h && h.schema === SCHEMA && h.comparators && h.days ? { ...empty(), ...h } : empty();
  } catch { return empty(); }
}

const touch = (old, readAt, fields) => ({ ...(old || {}), ...fields, firstRead: Math.min(old && Number.isFinite(old.firstRead) ? old.firstRead : readAt, readAt), lastRead: readAt });

function mergeList(prev, list, readAt, pick) {
  const entries = { ...((prev && prev.entries) || {}) };
  for (const e of list) entries[e.key] = touch(entries[e.key], readAt, pick(e, entries[e.key]));
  return { ...(prev || {}), firstReadAt: prev && Number.isFinite(prev.firstReadAt) ? prev.firstReadAt : readAt, entries };
}

/**
 * Today's read merged in. parsed: comparators.parseAll's result; statuses: { gt, kym, viral50, x } each 'ok', 'refused' or
 * 'unreadable' (a comparator not 'ok' is left as it was); readAt: epoch s.
 */
function mergeRead(history, parsed, statuses, readAt, spec) {
  const c = { ...history.comparators };
  if (statuses.gt === 'ok' && parsed.gt) {
    c.gt = mergeList(c.gt, parsed.gt, readAt, (e) => ({ title: e.title, own: e.own, volume: e.volume, categories: e.categories, related: e.related || [] }));
  }
  if (statuses.kym === 'ok' && parsed.kym) c.kym = mergeList(c.kym, parsed.kym, readAt, (e) => ({ title: e.title, own: e.own, feed: e.feed }));
  if (statuses.viral50 === 'ok' && parsed.viral50) {
    const day = parsed.viral50Day || dayOfSeconds(readAt);
    const rows = parsed.viral50.slice(0, spec.comparators.viral50.depth);
    const next = mergeList(c.viral50, rows, readAt, (e, old) => ({ title: e.title, artist: e.artist, firstChartDay: old && old.firstChartDay && old.firstChartDay < day ? old.firstChartDay : day }));
    c.viral50 = { ...next, charts: { ...((c.viral50 && c.viral50.charts) || {}), [day]: rows.map((e) => e.key) } };
  }
  if (statuses.x === 'ok' && parsed.x) {
    const rows = parsed.x.slice(0, spec.comparators.x.depth);
    const next = mergeList(c.x, rows, readAt, (e) => ({ title: e.title }));
    c.x = { ...next, snapshots: [...((c.x && c.x.snapshots) || []), { t: readAt, keys: rows.map((e) => e.key) }] };
  }
  return { ...history, comparators: c, reads: { ...history.reads, [dayOfSeconds(readAt)]: { ...statuses } } };
}

/** Entries, charts, snapshots and read statuses older than the spec keeps; scored days older than it keeps. */
function prune(history, now, spec) {
  const entryCut = now - spec.cache.entriesKeptDays * DAY;
  const dayCut = dayOfSeconds(now - spec.cache.scoredDaysKeptDays * DAY);
  const comparators = {};
  for (const [id, c] of Object.entries(history.comparators)) {
    const entries = Object.fromEntries(Object.entries(c.entries || {}).filter(([, e]) => e.lastRead >= entryCut || (Number.isFinite(e.own) && e.own >= entryCut)));
    const next = { ...c, entries };
    if (c.charts) next.charts = Object.fromEntries(Object.entries(c.charts).filter(([d]) => d >= dayOfSeconds(entryCut)));
    if (c.snapshots) next.snapshots = c.snapshots.filter((s) => s.t >= entryCut);
    comparators[id] = next;
  }
  const keep = (obj, cut) => Object.fromEntries(Object.entries(obj || {}).filter(([d]) => d >= cut));
  return { ...history, comparators, reads: keep(history.reads, dayOfSeconds(entryCut)), days: keep(history.days, dayCut) };
}

/** A comparator's entries as an array [{ key, ...entry }] ([] when never read). */
const entriesOf = (history, id) => Object.entries((history.comparators[id] && history.comparators[id].entries) || {}).map(([key, e]) => ({ key, ...e }));

/**
 * A scored day's pooled values stored (replacing that day's): { spec, at, lead: { comparator: [{ h, o }] }, breadth: { stories,
 * gtStarts } | null }, and nothing else (no pair, id, title or instant of ours can be stored by mistake).
 */
function withDay(history, day, { spec, at, lead = {}, breadth = null }) {
  const values = Object.fromEntries(Object.entries(lead).map(([c, vs]) => [c, (vs || []).map((v) => ({ h: v.h, o: v.o }))]));
  const b = breadth && Number.isFinite(breadth.stories) && Number.isFinite(breadth.gtStarts) ? { stories: breadth.stories, gtStarts: breadth.gtStarts } : null;
  return { ...history, days: { ...history.days, [day]: { spec, at, lead: values, breadth: b } } };
}

module.exports = { SCHEMA, empty, fromText, mergeRead, prune, entriesOf, withDay };
