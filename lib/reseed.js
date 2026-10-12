'use strict';
/*
 * A collector that starts with no state re-seeds itself from the feed that is already out (ios/IDEAS-FEED.md section N). On a free
 * host the state lives in a cache that can be lost; a cold start would mint every id again (and with them every hide, filmed and
 * follow mark a phone holds), lose every start date and every graph. The history itself is never published, so nothing new is: what
 * is read back is only what the feed already says in public, per listed trend: its id and card keys, kind, title and line, when it
 * started and peaked, its status, the points of its graph and its timeline.
 *
 * What is re-seeded is marked as such and is never taken for the collector's own measurement: every sample carries the `reseeded`
 * flag (lib/state.js: drawn, never observed, never in a window, a velocity or a lifetime), every trend `info.reseeded`, and the
 * state's `meta` says when and from which feed. A graph is published as shares of a peak the feed never states, so its points are
 * stored as those shares and given their level where the collector's own samples take over (lib/measure.js `rejoined`).
 *
 * `readFeedOut` reads a feed folder and keeps only what the collector's own validator passes; `planOf` is pure (the rows to
 * write, nothing written); `apply` writes them in one transaction; `reseed` is the three in order.
 */
const fs = require('node:fs');
const path = require('node:path');
const V = require('../samples/validate.cjs');
const TN = require('../engine/talk-nouns');
const ID = require('./identity');
const M = require('./measure');
const { SAMPLE_COLUMNS, FLAG, transaction } = require('./state');
const { AUDIENCES, AUDIENCE_COLUMN, TIME_ZONE, SLOT_SECONDS, HOUR, keyOf, localDay, slotOf } = require('./util');

const FILE_OF = { US: 'us', GB: 'gb', AU: 'au', CA: 'ca', mixed: 'mixed' };
const PRIMARY_ORDER = ['US', 'mixed', 'GB', 'AU', 'CA'];
const PAGE_SIZE = 20;
const ID_RE = /^[a-z0-9]{8,16}$/;
// (a feed dated further ahead of this cycle than a slot was written with a wrong clock somewhere: nothing is seeded from it)
const AHEAD_MAX_SECONDS = SLOT_SECONDS;
const FINE_STEP_SECONDS = 30 * 60;
const NAMES_KEPT = 80;
const LIST_BYTES_MAX = 2e6;

const readJson = (file, maxBytes = LIST_BYTES_MAX) => {
  try { if (!fs.existsSync(file) || fs.statSync(file).size > maxBytes) return null; return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
const seconds = (iso) => { const ms = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };

/**
 * The feed in a folder, as far as it reads: { lists: { audience: list }, details: Map(id -> detail), status, names }, or null when no
 * list reads. A list is kept when it is this schema's and its header is whole; a row or a detail only when the collector's own
 * validator passes it (a file cut short, or another schema's, seeds nothing).
 */
function readFeedOut(outDir) {
  const dir = path.join(outDir, 'v1');
  if (!fs.existsSync(dir)) return null;
  const lists = {};
  for (const audience of AUDIENCES) {
    const list = readJson(path.join(dir, `${FILE_OF[audience]}.json`));
    if (!list || list.schemaVersion !== V.SCHEMA_VERSION || list.audience !== audience || !Array.isArray(list.items) || seconds(list.generatedAt) === null) continue;
    const items = list.items.filter((item, i) => item && typeof item === 'object' && ID_RE.test(String(item.id || '')) && V.validateRow(item, i, list.generatedAt).length === 0);
    if (items.length) lists[audience] = { ...list, items };
  }
  if (!Object.keys(lists).length) return null;
  const details = new Map();
  const keep = (d) => { if (d && typeof d === 'object' && ID_RE.test(String(d.id || '')) && !details.has(d.id) && V.validateDetail(d, { name: `d/${d.id}` }).length === 0) details.set(d.id, d); };
  const ids = new Set(Object.values(lists).flatMap((l) => l.items.map((it) => it.id)));
  for (const id of ids) keep(readJson(path.join(dir, 'd', `${id}.json`), 2e5));
  // (a detail whose own file is missing may still be in a bundle)
  for (const audience of Object.keys(lists)) {
    const bundle = readJson(path.join(dir, `${FILE_OF[audience]}.details.json`), 4e6);
    if (bundle && Array.isArray(bundle.details)) for (const d of bundle.details) if (d && ids.has(d.id)) keep(d);
  }
  const status = readJson(path.join(dir, 'status.json'), 2e5);
  const names = readJson(path.join(dir, 'names.json'), 2e5);
  return { lists, details, status: status && typeof status === 'object' ? status : null, names: names && Array.isArray(names.names) ? names : null };
}

/**
 * One instant that reads as each audience's own published day: a start known only to the day is published as noon in the audience's
 * time zone on its day there (C4), so each list may carry another instant, and now and then another day. Stored once, it must give
 * every list its own day back. days: { audience: 'YYYY-MM-DD' }. Null when no instant does (never seen: the lists disagree by more
 * than the time zones can).
 */
function instantForDays(days) {
  const entries = Object.entries(days).filter(([, day]) => /^\d{4}-\d\d-\d\d$/.test(String(day)));
  if (!entries.length) return null;
  const base = Date.parse(`${entries[0][1]}T12:00:00Z`) / 1000;
  // (noon UTC first: the same calendar day in all four zones nearly always; then hour by hour either side)
  const offsets = [0, ...Array.from({ length: 36 }, (_, i) => (i + 1) * HOUR).flatMap((x) => [x, -x])];
  for (const off of offsets) if (entries.every(([a, day]) => localDay(base + off, TIME_ZONE[a]) === day)) return base + off;
  return null;
}

/** A talking point's subject and noun as its row shows them: the name its title leads with (its first person's), and what follows. */
function subjectOf(item) {
  const title = String(item.title || '');
  const person = (item.people || []).find((p) => p && p.name && title.toLowerCase().startsWith(`${String(p.name).toLowerCase()} `));
  if (!person) return { subject: keyOf(((item.people || [])[0] || {}).key || ''), noun: null };
  return { subject: keyOf(person.key || person.name), noun: title.slice(String(person.name).length).trim() || null };
}
/** The noun family a talking point's title says, as the engine keys it ("allegations", "apology"), or null. */
function familyOf(item) {
  const { noun } = subjectOf(item);
  return item.kind === 'talk' && noun ? ((TN.familiesIn(noun).pop() || {}).f || {}).key || null : null;
}
/** The natural key a row of the feed would have had, as near as the feed tells (lib/identity.js `naturalKey`): its card keys are what it is matched by. */
function naturalOf(item) {
  const key = String((item.keys || [])[0] || '');
  if (item.kind === 'word' || item.kind === 'sound') return ID.naturalKey({ kind: item.kind, term: key.replace(/^(?:word|point):/, '') || item.title });
  if (item.kind === 'moment') return ID.naturalKey({ kind: 'moment', headline: key.replace(/^story:/, '') || item.title });
  const { subject, noun } = subjectOf(item);
  return ID.naturalKey({ kind: 'talk', subject, family: familyOf(item), noun, title: item.title });
}

/**
 * A published graph as re-seeded samples: one per step that says something, at the step's own time, its interest the share the
 * graph drew (0-100). The steps before `observedFrom` were the rebuilt stretch of a trend met late and keep that flag; a run of
 * empty steps before the first sample is not stored (the graph draws it again from the start). Returns [{ t, res, interest, flags }].
 */
function samplesOf(graph, at) {
  if (!graph || !Array.isArray(graph.v) || seconds(graph.t0) === null || !Number.isFinite(graph.stepMinutes)) return [];
  const t0 = seconds(graph.t0);
  const step = graph.stepMinutes * 60;
  const res = step <= FINE_STEP_SECONDS ? SLOT_SECONDS : HOUR;
  const from = Number.isInteger(graph.observedFrom) ? graph.observedFrom : graph.v.length - 1;
  const rebuilt = graph.v.slice(0, from).some((x) => x > 0);
  const firstSaid = graph.v.findIndex((x) => x > 0);
  const out = [];
  graph.v.forEach((share, i) => {
    const t = t0 + i * step;
    if (!Number.isFinite(share) || t > at || t % res !== 0 || firstSaid < 0 || i < firstSaid) return;
    out.push({ t, res, interest: Math.min(100, Math.max(0, share)), flags: FLAG.reseeded | (rebuilt && i < from ? FLAG.backfilled : 0) });
  });
  return out;
}

/**
 * What a feed re-seeds, nothing written: { at (the feed's slot), generatedAt, trends: [row of `trends`], aliases: [[key, id]],
 * samples: [{ trend_id, t, res, ...columns }], events, texts, meta: { key: value }, hosts: [row of `hosts`] }, or null when the feed
 * cannot be seeded from (none, or dated ahead of this cycle).
 * feed: `readFeedOut`'s; t: this cycle's slot; hostOf: (source name in status.json) => host, for the back-off a lost state forgot.
 */
function planOf(feed, { t, hostOf = () => null } = {}) {
  if (!feed || !feed.lists || !Object.keys(feed.lists).length) return null;
  const first = PRIMARY_ORDER.map((a) => feed.lists[a]).find(Boolean);
  const generatedAt = Math.max(...Object.values(feed.lists).map((l) => seconds(l.generatedAt)));
  const statusSlot = feed.status ? seconds(feed.status.slot) : null;
  const feedAt = statusSlot !== null && statusSlot <= generatedAt && generatedAt - statusSlot < 2 * SLOT_SECONDS ? statusSlot : slotOf(generatedAt * 1000);
  if (feedAt > t + AHEAD_MAX_SECONDS) return null;
  // (the feed of this very slot, published before the state was lost: seeded a slot back, so this cycle's own samples are its own)
  const at = Math.min(feedAt, t - SLOT_SECONDS);
  const byId = new Map();
  for (const audience of PRIMARY_ORDER) {
    for (const item of (feed.lists[audience] || { items: [] }).items) {
      if (!byId.has(item.id)) byId.set(item.id, { item, per: {} });
      byId.get(item.id).per[audience] = item;
    }
  }
  const trends = [];
  const aliases = [];
  const samples = [];
  const events = [];
  const texts = [];
  const blank = Object.fromEntries(SAMPLE_COLUMNS.map((c) => [c, null]));
  for (const [id, { item, per }] of byId) {
    const detail = feed.details.get(id) || null;
    const graph = detail ? detail.graph : null;
    const seeded = samplesOf(graph, at);
    const observedFrom = graph && Number.isInteger(graph.observedFrom) ? Math.min(at, seconds(graph.t0) + graph.observedFrom * graph.stepMinutes * 60) : at;
    // the start: an hour as it is; a day or a month as one instant every list reads as its own day
    let startedAt = seconds(item.startedAt);
    let precision = startedAt === null ? null : item.startedPrecision || 'hour';
    let startedDay = null;
    if (startedAt !== null && precision !== 'hour') {
      const days = Object.fromEntries(Object.entries(per).filter(([, it]) => seconds(it.startedAt) !== null).map(([a, it]) => [a, localDay(seconds(it.startedAt), TIME_ZONE[a])]));
      const found = instantForDays(days);
      startedAt = found ?? startedAt;
      startedDay = new Date(startedAt * 1000).toISOString().slice(0, 10);
    }
    const early = Object.values(per).some((it) => it.isEarly);
    // (a status the collector had measured, or read by a rule of its own, is what its hysteresis holds on to; an Early row's
    // "rising" is the tag's and the engine's one-snapshot word is nobody's: neither is kept)
    const status = !early && item.statusMeasured !== false && ['rising', 'peaking', 'fading'].includes(item.status) ? item.status : null;
    const flare = seconds(item.flareAt);
    const { subject } = item.kind === 'talk' ? subjectOf(item) : { subject: keyOf(item.title) };
    const person = item.kind === 'talk' && (item.people || []).length ? keyOf(item.people[0].key || item.people[0].name) : null;
    const searchMax = item.demand && item.demand.kind === 'search' && Number.isFinite(item.demand.value) ? item.demand.value : 0;
    const info = { subject, family: familyOf(item), lineWords: ID.lineWords(item.kind === 'moment' ? item.title : item.line || ''), heads: [], keys: (item.keys || []).slice(0, ID.KEYS_KEPT), name: person,
      drama: !!item.drama, tier: item.tier || null, searchMax, reseeded: { at: t, from: at, observedFrom } };
    trends.push({ id, natural_key: naturalOf(item), kind: item.kind, sub: item.sub || null, class: M.classOf({ kind: item.kind, drama: !!item.drama, tier: item.tier, searchMax }),
      first_seen: Math.min(observedFrom, at), last_seen: at, started_at: startedAt, started_precision: precision, started_day: startedDay, peak_at: seconds(item.peakAt), peak_interest: null,
      // (the tag was given at its flare at the latest: the newest of its start, a chapter and the tag itself)
      early_at: early ? Math.min(at, flare ?? at) : null, early_gone_at: null, promoted_at: null,
      // (a flare that is neither its start nor its Early tag was a new chapter)
      chapter_at: !early && flare !== null && startedAt !== null && flare > startedAt ? flare : null, ended_at: null, closed_at: null, first_listed_at: '{}', first_page_at: '{}',
      status, status_test: status, faded: status === 'fading' ? 1 : 0, not_climbing: 0, title: item.title, info: JSON.stringify(info) });
    for (const key of item.keys || []) aliases.push([key, id]);
    for (const s of seeded) samples.push({ ...blank, trend_id: id, ...s });
    // the row as the lists had it when the feed was written: its ranks and heats, and the line's last point when no step fell on it
    // (a step that fell on that very time already says it)
    const lastSeeded = seeded.length ? seeded[seeded.length - 1] : null;
    const now = { ...blank, trend_id: id, t: at, res: SLOT_SECONDS, interest: lastSeeded && lastSeeded.t < at ? lastSeeded.interest : null,
      flags: FLAG.reseeded | (early ? FLAG.early : 0) | (Object.values(per).some((it) => it.rank <= PAGE_SIZE) ? FLAG.page : 0) };
    for (const [audience, it] of Object.entries(per)) { now[`r_${AUDIENCE_COLUMN[audience]}`] = it.rank; now[`h_${AUDIENCE_COLUMN[audience]}`] = it.heat; }
    const same = samples.findIndex((s) => s.trend_id === id && s.t === at && s.res === SLOT_SECONDS);
    if (same >= 0) samples[same] = { ...now, interest: samples[same].interest, flags: now.flags | (samples[same].flags & FLAG.backfilled) }; else samples.push(now);
    for (const e of (detail && detail.timeline) || []) {
      const eventAt = seconds(e.at);
      if (eventAt === null || eventAt > at || typeof e.text !== 'string' || !e.text) continue;
      const kind = e.text === 'Interest peaks.' ? 'peak' : ['start', 'chapter', 'reply', 'measure', 'latest'].includes(e.kind) ? e.kind : 'latest';
      events.push({ trend_id: id, at: eventAt, kind, precision: e.precision === 'hour' ? 'hour' : 'day', text: e.text, seen: t });
    }
    const textAt = seconds(item.updatedAt);
    texts.push({ trend_id: id, t: textAt !== null && textAt <= at ? textAt : at, title: item.title, line: item.line || null, line_written_by: item.lineWrittenBy === 'model' ? 'model' : 'headline' });
  }
  // what the next cycles ask first: the page's own names, by rank (A4), and whose pages and press are read (M4, M5)
  const lastRows = first.items.filter((it) => it.kind === 'talk' && (it.people || []).length).map((it) => ({ name: keyOf(it.people[0].key || it.people[0].name), rank: it.rank, rising: it.status === 'rising',
    early: !!it.isEarly, accelerating: false, person: true })).filter((r) => r.name);
  const named = new Map();
  for (const it of first.items) for (const p of it.people || []) { const key = keyOf(p.key || p.name); if (p.name && key.split(' ').length >= 2 && !named.has(key)) named.set(key, { key, title: String(p.name).trim().replace(/\s+/g, '_') }); }
  const listed = {};
  for (const n of (feed.names && feed.names.names) || []) if (n && n.key && n.name && !listed[n.key]) listed[n.key] = { name: n.name, ...(n.role ? { role: n.role } : {}), at };
  for (const l of Object.values(feed.lists)) for (const it of l.items) for (const p of it.people || []) if (p && p.key && p.name) listed[p.key] = { name: p.name, ...(p.role ? { role: p.role } : {}), at };
  const sourcesAt = seconds(first.sourcesAt);
  const expected = seconds(first.nextExpectedAt);
  const cycle = feed.status && Number.isInteger(feed.status.cycle) && feed.status.cycle > 0 ? feed.status.cycle : 0;
  const meta = { cycle, lastPublish: { cycle, t: at, at: generatedAt, reseeded: true }, ...(sourcesAt !== null ? { sourcesAt: Math.min(sourcesAt, at) } : {}),
    ...(expected !== null && expected - feedAt - SLOT_SECONDS >= 0 && expected - feedAt - SLOT_SECONDS < SLOT_SECONDS ? { publishLags: [expected - feedAt - SLOT_SECONDS] } : {}),
    lastRows, platformNames: [...named.values()].slice(0, NAMES_KEPT), namesListed: listed, reseed: { at: t, from: at, trends: trends.length, samples: samples.length } };
  // the back-off a lost state forgot: a host that had turned the collector away is still not asked until it said it may be
  const hosts = [];
  for (const [name, s] of Object.entries((feed.status && feed.status.sources) || {})) {
    const host = hostOf(name);
    const until = s ? seconds(s.blockedUntil) : null;
    if (!host || !s || until === null || until <= t) continue;
    hosts.push({ host, blocked_until: until, strikes: Number.isInteger(s.strikes) ? Math.max(1, s.strikes) : 1, last_ok_at: seconds(s.lastOkAt), last_status: Number.isInteger(s.lastStatus) ? s.lastStatus : null,
      first_turned_away_at: at, timeouts: 0, last_request_at: null });
  }
  return { at, generatedAt, trends, aliases, samples, events, texts, meta, hosts };
}

/**
 * Writes a plan in one transaction. Nothing of it replaces a row the state already holds (a trend it knows is never seeded over).
 * bookkeeping: false for a state that has its own (one restored from a day-old backup): only the trends it does not know are
 * written, and `meta.reseed` says so; its cycle counter, last publish and back-off are its own.
 */
function apply(db, meta, plan, { bookkeeping = true } = {}) {
  const TREND = ['id', 'natural_key', 'kind', 'sub', 'class', 'first_seen', 'last_seen', 'started_at', 'started_precision', 'started_day', 'peak_at', 'peak_interest', 'early_at', 'early_gone_at',
    'promoted_at', 'chapter_at', 'ended_at', 'closed_at', 'first_listed_at', 'first_page_at', 'status', 'status_test', 'faded', 'not_climbing', 'title', 'info'];
  const putTrend = db.prepare(`INSERT OR IGNORE INTO trends (${TREND.join(', ')}) VALUES (${TREND.map(() => '?').join(', ')})`);
  const putAlias = db.prepare('INSERT OR IGNORE INTO aliases (key, trend_id) VALUES (?, ?)');
  const putSample = db.prepare(`INSERT OR IGNORE INTO samples (trend_id, t, res, ${SAMPLE_COLUMNS.join(', ')}) VALUES (?, ?, ?, ${SAMPLE_COLUMNS.map(() => '?').join(', ')})`);
  const putEvent = db.prepare('INSERT OR IGNORE INTO events (trend_id, at, kind, precision, text, seen) VALUES (?, ?, ?, ?, ?, ?)');
  const putText = db.prepare('INSERT OR IGNORE INTO texts (trend_id, t, title, line, line_written_by) VALUES (?, ?, ?, ?, ?)');
  const putHost = db.prepare('INSERT OR IGNORE INTO hosts (host, blocked_until, strikes, last_ok_at, last_status, first_turned_away_at, timeouts, last_request_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const known = new Set(db.prepare('SELECT id FROM trends').all().map((r) => r.id));
  const fresh = new Set(plan.trends.filter((tr) => !known.has(tr.id)).map((tr) => tr.id));
  const val = (x) => (x === undefined || (typeof x === 'number' && !Number.isFinite(x)) ? null : x);
  transaction(db, () => {
    for (const tr of plan.trends) if (fresh.has(tr.id)) putTrend.run(...TREND.map((c) => val(tr[c])));
    for (const [key, id] of plan.aliases) if (fresh.has(id)) putAlias.run(key, id);
    for (const s of plan.samples) if (fresh.has(s.trend_id)) putSample.run(s.trend_id, s.t, s.res, ...SAMPLE_COLUMNS.map((c) => val(s[c])));
    for (const e of plan.events) if (fresh.has(e.trend_id)) putEvent.run(e.trend_id, e.at, e.kind, e.precision, e.text, e.seen);
    for (const x of plan.texts) if (fresh.has(x.trend_id)) putText.run(x.trend_id, x.t, x.title, x.line, x.line_written_by);
    if (bookkeeping) for (const h of plan.hosts) putHost.run(h.host, h.blocked_until, h.strikes, val(h.last_ok_at), val(h.last_status), val(h.first_turned_away_at), h.timeouts, val(h.last_request_at));
    for (const [key, value] of Object.entries(plan.meta)) if (bookkeeping || key === 'reseed') meta.set(key, key === 'reseed' ? { ...value, trends: fresh.size } : value);
  });
  return { trends: fresh.size };
}

/** Whether a state has never finished a cycle and knows no trend: the only state that is re-seeded. */
const isBlank = (db, meta) => !(meta.get('cycle', 0) > 0) && db.prepare('SELECT COUNT(*) AS n FROM trends').get().n === 0;

/**
 * Re-seeds a blank state from the feed in `out`: { trends, samples, from (the feed's slot) }, or null when there is nothing to do
 * (the state is not blank, no feed is out, or the feed cannot be seeded from). missing: the state was restored from a daily
 * backup this cycle, so it has a history and a day's gap: only the trends the feed lists and it does not know are read back.
 * Never throws: a feed that does not read costs the history it held and nothing else, and the cycle goes on as a first one.
 */
function reseed({ db, meta, out, t, hostOf, missing = false, log = () => {} }) {
  try {
    const blank = isBlank(db, meta);
    if (!blank && !missing) return null;
    const plan = planOf(readFeedOut(out), { t, hostOf });
    if (!plan || !plan.trends.length) return null;
    const done = apply(db, meta, plan, { bookkeeping: blank });
    if (!done.trends) return null;
    return { trends: done.trends, samples: plan.samples.length, from: plan.at };
  } catch (e) {
    log(`[reseed] the feed already out was not read back: ${e && e.message ? e.message : e}`);
    return null;
  }
}

module.exports = { readFeedOut, planOf, apply, reseed, isBlank, samplesOf, instantForDays, naturalOf, subjectOf, familyOf };
