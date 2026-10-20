#!/usr/bin/env node
'use strict';
/*
 * Checks a feed folder against ios/IDEAS-FEED.md section D (schema version 1), and against what a published row can show of
 * section C: a status the row's own times cannot carry (Early on something old, time left with no basis, a stale flare) fails here.
 *
 *   node validate.cjs <feed dir>      <feed dir> holds us.json, gb.json ... (any of them), *.details.json and d/<id>.json
 *
 * Exit 0 when every file found is valid, 1 otherwise (each problem on its own line). No dependencies. The collector runs the same
 * checks on a feed before it publishes it; `validateList`, `validateDetail` and `validateBundle` are exported for that.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;
const AUDIENCES = { us: 'US', gb: 'GB', au: 'AU', ca: 'CA', mixed: 'mixed' };
const KINDS = ['talk', 'word', 'sound', 'moment'];
const STATUSES = ['rising', 'peaking', 'fading'];
const WRITERS = ['model', 'headline'];
const PRECISIONS = ['hour', 'day'];
// (a row's start may also be known only to the month: what the month's list of trends dates. The phone says "Started this month")
const START_PRECISIONS = ['hour', 'day', 'month'];
// the badge and the graph are one story (C2): "peaking" is not said over a line that ends under this share of a peak this far behind
const PEAKING_MIN_SHARE = 40;
const PEAKING_PEAK_BEHIND_HOURS = 24;
// (demand is how much something is wanted or watched: never a count of the videos that already exist, IDEAS-FEED D3)
// (players: how many are in a game right now, as its platform counts them: M10)
const DEMAND_KINDS = ['search', 'reads', 'outlets', 'views', 'listed', 'players'];
const SUBS = ['drama', 'story', 'show', 'music', 'sports', 'game', 'word', 'phrase', 'meme', 'craze', 'format', 'challenge', 'hashtag', 'sound', 'filter', 'ai', 'product', 'clip', 'gaming'];
const TOPICS = ['celebs', 'memes', 'music', 'screen', 'sports', 'beauty', 'food', 'lifeHacks', 'lifestyle', 'shopping'];
const IDEA_KINDS = ['word', 'trend', 'story'];
const TIMELINE_KINDS = ['start', 'chapter', 'reply', 'measure', 'latest'];
const POST_KINDS = ['video', 'clip', 'thread'];
// (what a creator could film, D4 `angles`: lib/editor/prompt.js ANGLE_KINDS)
const ANGLE_KINDS = ['explain', 'react', 'take', 'ask', 'timeline', 'try'];
// (what joins a row to another, D4 `relatedRows`: lib/entity/graph.js)
const RELATED_KINDS = ['person', 'work', 'sound', 'query'];
const GRAPH_STEPS = [15, 30, 60, 120, 360, 1440];
const LIMITS = { rows: 80, minRows: 5, listBytes: 120000, detailBytes: 6000, bundleBytes: 150000, title: 90, line: 200, query: 60,
  timelineText: 120, earlyOnPage: 3, earlyInList: 12, urgent: 3, namesBytes: 60000, posts: 3, related: 5, spread: 6, why: 6, whyText: 160, angles: 3, angleText: 160, relatedRows: 3, via: 60 };
// Section C, as far as a row can show it: how old an Early row, an urgent row, a spike and a flare may be, and the shortest time left
// a start known only to the day may carry.
const HOUR = 3600e3;
const RULES = { earlyHours: 36, urgentHours: 36, spikeHours: 24, flareHours: 12, dayPrecisionLeft: 48, daySlackHours: 14 };

const ID = /^[a-z0-9]{8,16}$/;
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const isInstant = (v) => typeof v === 'string' && INSTANT.test(v) && Number.isFinite(Date.parse(v));
const isInt = (v) => Number.isInteger(v);
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
/** The normalised key of section D6 (the engine's keyOf). */
const keyOf = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/['’]s\b/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** now: the list's `generatedAt` in ms (NaN when it has none): what a row's ages are measured from. */
function validateItem(item, index, pageSize, say, now = NaN) {
  const at = `items[${index}]${item && item.title ? ` "${item.title}"` : ''}`;
  const need = (ok, what) => { if (!ok) say(`${at}: ${what}`); };
  if (!item || typeof item !== 'object') return say(`${at}: not an object`);
  need(typeof item.id === 'string' && ID.test(item.id), 'id must match ^[a-z0-9]{8,16}$');
  need(Array.isArray(item.keys) && item.keys.length >= 1 && item.keys.length <= 5 && item.keys.every((k) => isText(k, 200)), 'keys: 1-5 card keys');
  need(KINDS.includes(item.kind), `kind must be one of ${KINDS.join(', ')}`);
  need(isText(item.title, LIMITS.title), `title: 1-${LIMITS.title} characters`);
  need(item.line === null || isText(item.line, LIMITS.line), `line: null or 1-${LIMITS.line} characters`);
  need(WRITERS.includes(item.lineWrittenBy), 'lineWrittenBy must be model or headline');
  need(STATUSES.includes(item.status), `status must be one of ${STATUSES.join(', ')}`);
  need(typeof item.isEarly === 'boolean', 'isEarly must be a boolean');
  need(item.startedAt === null || isInstant(item.startedAt), 'startedAt: an instant or null');
  need(item.startedAt === null || START_PRECISIONS.includes(item.startedPrecision), 'startedPrecision: hour, day or month when startedAt is set');
  need(item.peakAt === null || isInstant(item.peakAt), 'peakAt: an instant or null');
  // (rounded by the collector: to 6 hours under 36, to whole days from 48, a week at most)
  const left = item.timeLeftHours;
  need(left === null || (isInt(left) && left >= 6 && left <= 168 && (left < 36 ? left % 6 === 0 : left % 24 === 0)), 'timeLeftHours: null, 6-30 in sixes, or 48-168 in whole days');
  need(isInt(item.heat) && item.heat >= 0 && item.heat <= 100, 'heat: 0-100');
  const d = item.demand;
  need(d === null || (d && isText(d.label, 60) && DEMAND_KINDS.includes(d.kind) && (d.kind === 'listed' || (typeof d.value === 'number' && d.value > 0))),
    'demand: null or { label, kind, value }');
  need(!d || !/\bvideos?\b/i.test(d.label || ''), 'demand: never a count of videos (creator videos or any other)');
  need(item.rank === index + 1, `rank must be ${index + 1} (its place in items)`);
  need(typeof item.filmWithin24h === 'boolean', 'filmWithin24h must be a boolean');
  need(typeof item.spike === 'boolean', 'spike must be a boolean');
  need(item.flareAt === null || isInstant(item.flareAt), 'flareAt: an instant or null');
  need(!(item.isEarly && (item.filmWithin24h || item.spike)), 'an Early row carries neither filmWithin24h nor spike');
  need(!item.isEarly || item.status === 'rising', 'an Early row is rising');
  need(Array.isArray(item.people) && item.people.length <= 4 &&
    item.people.every((p) => p && isText(p.name, 80) && typeof p.key === 'string' && p.key && p.key === keyOf(p.key)), 'people: 0-4 of { key (normalised), name }');
  need(Array.isArray(item.topics) && item.topics.length >= 1 && item.topics.length <= 4 && item.topics.every((t) => TOPICS.includes(t)), 'topics: 1-4 ContentTopic raw values');
  // (the topics For you may rank by, K1: each a ContentTopic, none twice)
  const sure = item.topicsSure;
  need(sure === undefined || (Array.isArray(sure) && sure.length <= 4 && sure.every((t) => TOPICS.includes(t)) && new Set(sure).size === sure.length), 'topicsSure: 0-4 ContentTopic raw values, none twice, when present');
  need(Array.isArray(item.tags) && item.tags.length <= 12 && item.tags.every((t) => typeof t === 'string' && t && t === keyOf(t)), 'tags: 0-12 normalised keys');
  need(item.examples && isText(item.examples.tiktok, LIMITS.query) && isText(item.examples.youtube, LIMITS.query), 'examples: { tiktok, youtube } search queries');
  const idea = item.idea;
  need(idea && isText(idea.id, 200) && IDEA_KINDS.includes(idea.kind) && isText(idea.title, 200), 'idea: { id, kind, title } as IdeaCardInput');
  need(!idea || !Array.isArray(item.keys) || idea.id === item.keys[0], 'idea.id must equal keys[0]');
  need(isText(item.detailRev, 32), 'detailRev: a short string');
  need(item.updatedAt === undefined || isInstant(item.updatedAt), 'updatedAt: an instant when present');
  const topic = item.topic;
  need(topic === undefined || (topic && isText(topic.name, 80) && typeof topic.key === 'string' && topic.key && topic.key === keyOf(topic.key) &&
    Array.isArray(item.tags) && item.tags.includes(topic.key)), 'topic: { key (normalised, one of tags), name } when present');

  need(item.sub === undefined || SUBS.includes(item.sub), `sub must be one of ${SUBS.join(', ')} when present`);
  // (a sound's count as a chart gives it, K7: on a sound row only, each part of the right shape, and the day's change never without the total)
  const snd = item.sound;
  need(snd === undefined || (item.kind === 'sound' && snd && typeof snd === 'object' && Object.keys(snd).length > 0), 'sound: an object with at least one part, on a sound row only');
  if (snd && typeof snd === 'object') {
    need(snd.id === undefined || (typeof snd.id === 'string' && /^\d{5,25}$/.test(snd.id)), 'sound.id: 5 to 25 digits');
    need(snd.slug === undefined || (typeof snd.slug === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(snd.slug)), 'sound.slug: 1 to 80 letters, digits and hyphens');
    need(snd.videos === undefined || (isInt(snd.videos) && snd.videos >= 0), 'sound.videos: a whole number');
    need(snd.videosToday === undefined || (isInt(snd.videosToday) && snd.videos !== undefined), 'sound.videosToday: a whole number, beside sound.videos');
    need(snd.asOf === undefined || (isInstant(snd.asOf) && (!Number.isFinite(now) || Date.parse(snd.asOf) <= now)), 'sound.asOf: an instant, never after the list was built');
  }

  // ---------- section C: a status a row cannot honestly carry ----------
  const started = isInstant(item.startedAt) ? Date.parse(item.startedAt) : null;
  const byHour = item.startedPrecision === 'hour';
  const ageHours = started !== null && Number.isFinite(now) ? (now - started) / HOUR : null;
  // (a start known only to the day is noon in the audience's time zone: it may still be ahead of the list's own clock)
  need(ageHours === null || ageHours >= (byHour ? 0 : -RULES.daySlackHours), 'startedAt is after the list was built');
  const young = (hours) => started !== null && byHour && ageHours !== null && ageHours <= hours;
  need(!item.isEarly || young(RULES.earlyHours), `an Early row started at most ${RULES.earlyHours} hours ago, by a start known to the hour`);
  need(!item.isEarly || left === null, 'an Early row carries no time left');
  need(left === null || item.kind === 'talk', 'timeLeftHours: talking points only');
  need(left === null || started !== null, 'timeLeftHours needs a start');
  need(left === null || byHour || left >= RULES.dayPrecisionLeft, `a start known only to the day gives whole days of time left (${RULES.dayPrecisionLeft}+)`);
  need(!item.filmWithin24h || (item.status === 'rising' && young(RULES.urgentHours)), `filmWithin24h: rising and started at most ${RULES.urgentHours} hours ago, to the hour`);
  need(!item.spike || (item.status === 'rising' && young(RULES.spikeHours)), `spike: rising and started at most ${RULES.spikeHours} hours ago, to the hour`);
  const flare = isInstant(item.flareAt) ? Date.parse(item.flareAt) : null;
  need(flare === null || item.status === 'rising', 'flareAt: only on a rising row');
  need(flare === null || !Number.isFinite(now) || (flare <= now && now - flare <= RULES.flareHours * HOUR), `flareAt: inside the last ${RULES.flareHours} hours`);
  need(flare === null || started === null || flare >= started - (byHour ? 0 : RULES.daySlackHours * HOUR), 'flareAt is before startedAt');
  // (a status nobody measured, the engine's one-snapshot word, alerts and hurries nobody and forecasts nothing: C1, J9)
  const unmeasured = item.statusMeasured === false && !item.isEarly;
  need(!unmeasured || (flare === null && !item.spike && !item.filmWithin24h), 'an unmeasured status carries no flareAt, spike or filmWithin24h');
  need(!unmeasured || left === null, 'an unmeasured status carries no time left');
  const peak = isInstant(item.peakAt) ? Date.parse(item.peakAt) : null;
  need(peak === null || item.status !== 'rising', 'peakAt: null while the row is rising');
  need(peak === null || !Number.isFinite(now) || peak <= now, 'peakAt is after the list was built');
  need(peak === null || started === null || peak >= started - (byHour ? 0 : RULES.daySlackHours * HOUR), 'peakAt is before startedAt');
  return undefined;
}

/**
 * One row's problems (none when valid), at its place in the list (0-based) and against the list's `generatedAt`. The collector leaves
 * a failing row out and ranks the rest again, rather than hold a whole list back for one row.
 */
function validateRow(item, index, generatedAt) {
  const out = [];
  validateItem(item, index, 0, (m) => out.push(m), isInstant(generatedAt) ? Date.parse(generatedAt) : NaN);
  return out;
}

/** A list file's problems (none when valid). */
function validateList(list, { bytes = 0, audience = null } = {}) {
  const out = [];
  const say = (m) => out.push(m);
  if (!list || typeof list !== 'object') return ['not a JSON object'];
  if (list.schemaVersion !== SCHEMA_VERSION) say(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Object.values(AUDIENCES).includes(list.audience)) say('audience must be US, GB, AU, CA or mixed');
  if (audience && list.audience !== audience) say(`audience must be ${audience} in this file`);
  if (!isInstant(list.generatedAt)) say('generatedAt must be an instant');
  // (how fresh the list's data is: the phone ages the list by it, so it can never be ahead of the build)
  if (list.sourcesAt !== undefined && !isInstant(list.sourcesAt)) say('sourcesAt must be an instant when present');
  else if (isInstant(list.sourcesAt) && isInstant(list.generatedAt) && Date.parse(list.sourcesAt) > Date.parse(list.generatedAt)) say('sourcesAt must not be after generatedAt');
  if (!isInstant(list.nextExpectedAt)) say('nextExpectedAt must be an instant');
  else if (isInstant(list.generatedAt) && Date.parse(list.nextExpectedAt) <= Date.parse(list.generatedAt)) say('nextExpectedAt must be after generatedAt');
  if (!isInt(list.cycleMinutes) || list.cycleMinutes <= 0) say('cycleMinutes must be a positive integer');
  if (!isInt(list.pageSize) || list.pageSize <= 0) say('pageSize must be a positive integer');
  if (bytes > LIMITS.listBytes) say(`the list is ${bytes} bytes, over ${LIMITS.listBytes}`);
  const items = Array.isArray(list.items) ? list.items : null;
  if (!items) return [...out, 'items must be an array'];
  if (items.length < LIMITS.minRows || items.length > LIMITS.rows) say(`items: ${LIMITS.minRows}-${LIMITS.rows} rows, found ${items.length}`);
  const now = isInstant(list.generatedAt) ? Date.parse(list.generatedAt) : NaN;
  items.forEach((item, i) => validateItem(item, i, list.pageSize, say, now));
  const ids = items.map((x) => x && x.id);
  if (new Set(ids).size !== ids.length) say('ids must be unique');
  const early = items.filter((x) => x && x.isEarly);
  if (early.filter((x) => x.rank <= list.pageSize).length > LIMITS.earlyOnPage) say(`at most ${LIMITS.earlyOnPage} Early rows on the first page`);
  if (early.length > LIMITS.earlyInList) say(`at most ${LIMITS.earlyInList} Early rows in a list`);
  if (items.filter((x) => x && x.filmWithin24h).length > LIMITS.urgent) say(`at most ${LIMITS.urgent} rows with filmWithin24h`);
  return out;
}

/** A detail's problems (none when valid). */
function validateDetail(detail, { bytes = 0, name = 'detail' } = {}) {
  const out = [];
  const say = (m) => out.push(`${name}: ${m}`);
  if (!detail || typeof detail !== 'object') return [`${name}: not a JSON object`];
  if (detail.schemaVersion !== SCHEMA_VERSION) say(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof detail.id !== 'string' || !ID.test(detail.id)) say('id must match ^[a-z0-9]{8,16}$');
  if (!isText(detail.rev, 32)) say('rev: a short string');
  if (!isInstant(detail.generatedAt)) say('generatedAt must be an instant');
  if (bytes > LIMITS.detailBytes) say(`${bytes} bytes, over ${LIMITS.detailBytes}`);
  const g = detail.graph;
  if (g !== null) {
    if (!g || typeof g !== 'object') say('graph: an object or null');
    else {
      const n = Array.isArray(g.v) ? g.v.length : 0;
      const index = (i) => isInt(i) && i >= 0 && i < n;
      if (!isInstant(g.t0)) say('graph.t0 must be an instant');
      if (!GRAPH_STEPS.includes(g.stepMinutes)) say(`graph.stepMinutes must be one of ${GRAPH_STEPS.join(', ')}`);
      if (n < 4 || n > 96 || !g.v.every((x) => isInt(x) && x >= 0 && x <= 100)) say('graph.v: 4-96 integers 0-100');
      else if (Math.max(...g.v) !== 100) say('graph.v is a share of its own peak: its highest point must be 100');
      if (!index(g.start)) say('graph.start: an index into v');
      if (g.peak !== null && !index(g.peak)) say('graph.peak: an index into v, or null');
      if (index(g.peak) && g.v[g.peak] !== 100) say('graph.peak must point at the highest point');
      if (!index(g.observedFrom)) say('graph.observedFrom: an index into v');
      // (the last point is now: a graph that ends hours back, or ahead of its own file, draws its "now" dot in the wrong place)
      if (isInstant(g.t0) && isInstant(detail.generatedAt) && GRAPH_STEPS.includes(g.stepMinutes) && n >= 4) {
        const last = Date.parse(g.t0) + (n - 1) * g.stepMinutes * 60e3;
        const made = Date.parse(detail.generatedAt);
        if (last > made || made - last > g.stepMinutes * 60e3) say('graph: the last point must be within one step before generatedAt');
      }
    }
  }
  const tl = detail.timeline;
  if (!Array.isArray(tl) || tl.length > 6) say('timeline: 0-6 entries');
  else {
    tl.forEach((e, i) => {
      if (!e || !isInstant(e.at) || !PRECISIONS.includes(e.precision) || !isText(e.text, LIMITS.timelineText) || !TIMELINE_KINDS.includes(e.kind)) {
        say(`timeline[${i}]: { at, precision, text (1-${LIMITS.timelineText}), kind }`);
      }
    });
    if (tl.some((e, i) => i > 0 && isInstant(e.at) && isInstant(tl[i - 1].at) && Date.parse(e.at) < Date.parse(tl[i - 1].at))) say('timeline: oldest first');
    if (isInstant(detail.generatedAt) && tl.some((e) => e && isInstant(e.at) && Date.parse(e.at) > Date.parse(detail.generatedAt))) say('timeline: no entry after generatedAt');
    // (a measured fact is dated when the collector saw it: never inside the backfilled stretch of the graph, IDEAS-FEED B1, D4)
    if (g && isInstant(g.t0) && isInt(g.observedFrom) && GRAPH_STEPS.includes(g.stepMinutes)) {
      const observed = Date.parse(g.t0) + g.observedFrom * g.stepMinutes * 60e3;
      if (tl.some((e) => e && e.kind === 'measure' && isInstant(e.at) && Date.parse(e.at) < observed)) say('timeline: a measure entry is dated before the graph was observed');
    }
  }
  if (!Array.isArray(detail.why) || detail.why.length > LIMITS.why || !detail.why.every((w) => isText(w, LIMITS.whyText))) say(`why: 0-${LIMITS.why} lines`);
  else if (detail.why.some((w) => /\b\d+\s+(?:creator videos?|creators have)/i.test(w))) say('why: no count of creator videos');
  if (!Array.isArray(detail.sources) || detail.sources.length > 6 || !detail.sources.every((s) => isText(s, 60))) say('sources: 0-6 outlet names');
  // (the sheet's own fields, optional, added 2026-10-18: example posts, related searches, where it was seen)
  if (detail.posts !== undefined) {
    const ps = detail.posts;
    if (!Array.isArray(ps) || ps.length > LIMITS.posts) say(`posts: 0-${LIMITS.posts} entries`);
    else {
      ps.forEach((p, i) => {
        const ok = p && typeof p === 'object' && POST_KINDS.includes(p.kind) && isText(p.title, LIMITS.title) && (p.who === null || isText(p.who, 80)) && isText(p.where, 40)
          && typeof p.url === 'string' && /^https:\/\/\S{4,500}$/.test(p.url) && (p.number === null || (isInt(p.number) && p.number >= 0)) && isInstant(p.at);
        if (!ok) say(`posts[${i}]: { kind (video, clip, thread), title (1-${LIMITS.title}), who (string or null, never a Reddit username), where, url (https), number (integer or null), at }`);
      });
      if (ps.some((p, i) => i > 0 && p && ps[i - 1] && (p.number ?? -1) > (ps[i - 1].number ?? -1))) say('posts: ranked by number, the biggest first');
      if (isInstant(detail.generatedAt) && ps.some((p) => p && isInstant(p.at) && Date.parse(p.at) > Date.parse(detail.generatedAt))) say('posts: none after generatedAt');
    }
  }
  if (detail.related !== undefined && (!Array.isArray(detail.related) || detail.related.length > LIMITS.related || !detail.related.every((q) => isText(q, LIMITS.query)))) say(`related: 0-${LIMITS.related} queries of up to ${LIMITS.query} characters`);
  // (added 2026-10-20: what a creator could film, each held to the claim check by the collector, lib/editor/ideas.js)
  if (detail.angles !== undefined) {
    const an = detail.angles;
    if (!Array.isArray(an) || an.length < 1 || an.length > LIMITS.angles || !an.every((a) => a && typeof a === 'object' && isText(a.text, LIMITS.angleText) && ANGLE_KINDS.includes(a.kind))) say(`angles: 1-${LIMITS.angles} entries of { text (1-${LIMITS.angleText}), kind (${ANGLE_KINDS.join(', ')}) }`);
    else if (new Set(an.map((a) => a.kind)).size !== an.length) say('angles: one kind once');
  }
  if (detail.spread !== undefined) {
    const sp = detail.spread;
    if (!Array.isArray(sp) || sp.length < 1 || sp.length > LIMITS.spread || !sp.every((e) => e && typeof e === 'object' && isText(e.where, 40) && isInstant(e.at))) say(`spread: 1-${LIMITS.spread} entries of { where, at }`);
    else {
      if (sp.some((e, i) => i > 0 && Date.parse(e.at) < Date.parse(sp[i - 1].at))) say('spread: oldest first');
      if (isInstant(detail.generatedAt) && sp.some((e) => Date.parse(e.at) > Date.parse(detail.generatedAt))) say('spread: no entry after generatedAt');
      if (new Set(sp.map((e) => e.where)).size !== sp.length) say('spread: one name once');
    }
  }
  // (the other rows of this cycle's lists that name the same person, work or sound, and an earlier story of its people: D4
  // `relatedRows`, 2026-10-20. A listed row is { id, title, via, kind }, an earlier story { id: null, title, via, kind, at })
  if (detail.relatedRows !== undefined) {
    const rr = detail.relatedRows;
    const one = (r) => r && typeof r === 'object' && isText(r.title, LIMITS.title) && isText(r.via, LIMITS.via) && RELATED_KINDS.includes(r.kind)
      && (r.id === null ? isInstant(r.at) : typeof r.id === 'string' && /^[a-z0-9]{6,32}$/.test(r.id) && r.at === undefined);
    if (!Array.isArray(rr) || rr.length < 1 || rr.length > LIMITS.relatedRows || !rr.every(one)) say(`relatedRows: 1-${LIMITS.relatedRows} entries of { id (a row's id, or null for an earlier story with its at), title (1-${LIMITS.title}), via (1-${LIMITS.via}), kind (${RELATED_KINDS.join(', ')}) }`);
    else if (rr.some((r) => r.id && r.id === detail.id) || new Set(rr.filter((r) => r.id).map((r) => r.id)).size !== rr.filter((r) => r.id).length) say('relatedRows: another row, once');
  }
  return out;
}

/** A bundle's problems (none when valid). */
function validateBundle(bundle, { bytes = 0, audience = null } = {}) {
  if (!bundle || typeof bundle !== 'object') return ['not a JSON object'];
  const out = [];
  if (bundle.schemaVersion !== SCHEMA_VERSION) out.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (audience && bundle.audience !== audience) out.push(`audience must be ${audience} in this file`);
  if (!isInstant(bundle.generatedAt)) out.push('generatedAt must be an instant');
  if (bytes > LIMITS.bundleBytes) out.push(`the bundle is ${bytes} bytes, over ${LIMITS.bundleBytes}`);
  if (!Array.isArray(bundle.details)) return [...out, 'details must be an array'];
  bundle.details.forEach((d, i) => out.push(...validateDetail(d, { name: `details[${i}]` })));
  return out;
}

/**
 * A row against its own detail (C2, C5, as built 2026-10-12): the badge never says what the card's graph denies. A "peaking" row
 * whose graph ends under 40% of a peak a day or more behind is a problem; so is "Interest peaks." in the timeline of a row that is
 * rising or tagged Early. No detail, or no graph: nothing to hold the row to.
 */
function statusAgainstGraph(item, detail) {
  const out = [];
  if (!item || !detail) return out;
  const g = detail.graph;
  if (g && Array.isArray(g.v) && g.v.length && isInstant(g.t0) && GRAPH_STEPS.includes(g.stepMinutes) && item.status === 'peaking') {
    const top = g.v.lastIndexOf(Math.max(...g.v));
    const behindHours = ((g.v.length - 1 - top) * g.stepMinutes) / 60;
    const last = g.v[g.v.length - 1];
    if (last < PEAKING_MIN_SHARE && behindHours >= PEAKING_PEAK_BEHIND_HOURS) out.push(`peaking, but its graph ends at ${last}% of a peak ${Math.round(behindHours)} hours behind`);
  }
  if ((item.status === 'rising' || item.isEarly) && Array.isArray(detail.timeline) && detail.timeline.some((e) => e && e.text === 'Interest peaks.')) out.push('rising or Early, but its timeline says "Interest peaks."');
  return out;
}

/** The names file's problems (none when valid): D6. */
function validateNames(file, { bytes = 0 } = {}) {
  if (!file || typeof file !== 'object') return ['not a JSON object'];
  const out = [];
  if (file.schemaVersion !== SCHEMA_VERSION) out.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (!isInstant(file.generatedAt)) out.push('generatedAt must be an instant');
  if (bytes > LIMITS.namesBytes) out.push(`the names file is ${bytes} bytes, over ${LIMITS.namesBytes}`);
  if (!Array.isArray(file.names)) return [...out, 'names must be an array'];
  const bad = file.names.findIndex((n) => !n || !isText(n.name, 80) || typeof n.key !== 'string' || !n.key || n.key !== keyOf(n.key) || (n.role !== undefined && !isText(n.role, 20)));
  if (bad >= 0) out.push(`names[${bad}]: { key (normalised), name, role? }`);
  if (new Set(file.names.map((n) => n && n.key)).size !== file.names.length) out.push('names: a key once');
  return out;
}

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8');
  try { return { json: JSON.parse(text), bytes: Buffer.byteLength(text) }; } catch (e) { return { json: null, bytes: Buffer.byteLength(text), error: e.message }; }
}

/** Every problem in a feed folder, as "file: problem" lines, and how many files were read. */
function validateFolder(dir) {
  const problems = [];
  let files = 0;
  const revs = new Map();
  const rowsOf = new Map();
  for (const [stem, audience] of Object.entries(AUDIENCES)) {
    const file = path.join(dir, `${stem}.json`);
    if (!fs.existsSync(file)) continue;
    files += 1;
    const { json, bytes, error } = readJson(file);
    const found = error ? [`not JSON: ${error}`] : validateList(json, { bytes, audience });
    problems.push(...found.map((p) => `${stem}.json: ${p}`));
    for (const item of (json && Array.isArray(json.items) ? json.items : [])) if (item && item.id) { revs.set(item.id, item.detailRev); rowsOf.set(item.id, [...(rowsOf.get(item.id) || []), { stem, item }]); }
    const bundleFile = path.join(dir, `${stem}.details.json`);
    if (!fs.existsSync(bundleFile)) continue;
    files += 1;
    const b = readJson(bundleFile);
    problems.push(...(b.error ? [`not JSON: ${b.error}`] : validateBundle(b.json, { bytes: b.bytes, audience })).map((p) => `${stem}.details.json: ${p}`));
    for (const d of (b.json && Array.isArray(b.json.details) ? b.json.details : [])) {
      if (d && !revs.has(d.id)) problems.push(`${stem}.details.json: detail ${d.id} is for no row of ${stem}.json`);
    }
  }
  const namesFile = path.join(dir, 'names.json');
  if (fs.existsSync(namesFile)) {
    files += 1;
    const n = readJson(namesFile);
    problems.push(...(n.error ? [`not JSON: ${n.error}`] : validateNames(n.json, { bytes: n.bytes })).map((p) => `names.json: ${p}`));
  }
  const detailDir = path.join(dir, 'd');
  for (const name of fs.existsSync(detailDir) ? fs.readdirSync(detailDir).sort() : []) {
    if (!name.endsWith('.json')) continue;
    files += 1;
    const { json, bytes, error } = readJson(path.join(detailDir, name));
    const found = error ? [`d/${name}: not JSON: ${error}`] : validateDetail(json, { bytes, name: `d/${name}` });
    problems.push(...found);
    if (json && `${json.id}.json` !== name) problems.push(`d/${name}: the file is named by its id`);
    if (json && revs.has(json.id) && revs.get(json.id) !== json.rev) problems.push(`d/${name}: rev ${json.rev} is not the row's detailRev ${revs.get(json.id)}`);
    for (const { stem, item } of (json && rowsOf.get(json.id)) || []) if (item.detailRev === json.rev) problems.push(...statusAgainstGraph(item, json).map((p) => `${stem}.json: "${item.title}": ${p}`));
  }
  return { problems, files };
}

module.exports = { validateRow, validateList, validateDetail, validateBundle, validateNames, validateFolder, statusAgainstGraph, keyOf, LIMITS, RULES, SCHEMA_VERSION, ANGLE_KINDS, RELATED_KINDS };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) {
    process.stderr.write('usage: node validate.cjs <feed dir>\n');
    process.exit(1);
  }
  const { problems, files } = validateFolder(path.resolve(dir));
  if (!files) problems.push('no feed files found (us.json, gb.json, au.json, ca.json, mixed.json)');
  for (const p of problems) process.stderr.write(`${p}\n`);
  process.stdout.write(problems.length ? `${problems.length} problem(s) in ${files} file(s)\n` : `ok: ${files} file(s)\n`);
  process.exit(problems.length ? 1 : 0);
}
