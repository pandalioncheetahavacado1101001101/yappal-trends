'use strict';
/*
 * History (ios/IDEAS-FEED.md A3 steps 4-6, B): every engine row of a cycle gets its trend (lib/identity.js), each trend its sample of
 * this slot (lib/signals.js) and its measured state (lib/measure.js), all worked out in memory by `step`; `commit` then writes the
 * slot in ONE transaction, `INSERT OR REPLACE` on its keys, so the same slot run twice leaves the same rows. Compaction and pruning
 * (B2) follow.
 */
const M = require('./measure');
const TN = require('../engine/talk-nouns');
const ID = require('./identity');
const SG = require('./signals');
const D = require('./describe');
const { SAMPLE_COLUMNS, FLAG, transaction } = require('./state');
const { AUDIENCES, AUDIENCE_COLUMN, GEOS, HOUR, DAY, SLOT_SECONDS, keyOf, homeGeos } = require('./util');

const SERIES_BACK = 15 * DAY; // what a cycle reads of a trend's series: three windows of a word, a week of quiet, and every rebuilt hour (BACKFILL_MAX)
const CARRY_UNSEEN = 48 * HOUR; // a trend the engine no longer lists is sampled on, carried, this long: its decay is measured, its end found
const BACKFILL_MAX = 14 * DAY;
const FINE_KEPT = 48 * HOUR;
const HOURLY_KEPT = 14 * DAY;
const DAILY_KEPT = 400 * DAY;
const PRIMARY_ORDER = ['US', 'mixed', 'GB', 'AU', 'CA'];
const COUNTRY = { US: 'the US', GB: 'the UK', AU: 'Australia', CA: 'Canada' };
const LATEST_GAP = 6 * HOUR;
const START_TEXT_WITHIN = 12 * HOUR;
const SEEN_LATELY = 3 * HOUR; // a measured fact is dated only when the collector was watching: its last observed sample is this near
const FRESH_ENTRY = HOUR; // or, at first sight, when the search itself began inside the last hour
const TIMELINE_MAX = 6;
const TIMELINE_MIDDLE = 3;
const LATEST_KEPT = 3; // the newest "latest" entries a trend keeps: the timeline shows one, the older ones are superseded

// ---------- reading ----------
const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };
/** A `trends` row as the code reads it. */
function trendOf(r) {
  return { id: r.id, natural: r.natural_key, kind: r.kind, sub: r.sub, class: r.class, firstSeen: r.first_seen, lastSeen: r.last_seen, startedAt: r.started_at,
    startedPrecision: r.started_precision, startedDay: r.started_day, peakAt: r.peak_at, peakInterest: r.peak_interest, earlyAt: r.early_at, earlyGoneAt: r.early_gone_at,
    promotedAt: r.promoted_at, chapterAt: r.chapter_at, endedAt: r.ended_at, closedAt: r.closed_at, firstListedAt: parse(r.first_listed_at, {}), firstPageAt: parse(r.first_page_at, {}),
    status: r.status, statusTest: r.status_test, faded: !!r.faded, notClimbing: r.not_climbing || 0, title: r.title, info: parse(r.info, {}) };
}
/** The trends that can still be matched or sampled, and every alias: the index lib/identity.js matches against. */
function loadIndex(db, t) {
  const trends = new Map();
  for (const r of db.prepare('SELECT * FROM trends WHERE closed_at IS NULL AND last_seen >= ?').all(t - 31 * DAY)) trends.set(r.id, trendOf(r));
  const aliases = new Map();
  for (const r of db.prepare('SELECT key, trend_id FROM aliases').all()) aliases.set(r.key, r.trend_id);
  return { trends, aliases };
}
/** A `samples` row as lib/measure.js reads it. */
function sampleOfRow(r) {
  const max = (xs) => { const v = xs.filter((x) => x !== null && x !== undefined); return v.length ? Math.max(...v) : null; };
  return { t: r.t, res: r.res, interest: r.interest, observed: !(r.flags & (FLAG.backfilled | FLAG.carried)), backfilled: !!(r.flags & FLAG.backfilled),
    p: { s: r.p_s, n: r.p_n, c: r.p_c, r: r.p_r, w: r.p_w }, sv: max([r.sv_us, r.sv_gb, r.sv_au, r.sv_ca]), sg: max([r.sg_us, r.sg_gb, r.sg_au, r.sg_ca]), cr: r.cr, ytH: r.yt_h,
    ttVideos: r.tt_videos, rdRank: r.rd_rank, soc: r.soc, n24: r.n24, outlets: r.outlets, sLive: r.s_live, flags: r.flags || 0 };
}
/** A trend's `samples` rows from `since` on, oldest first, as stored. */
const rawSeries = (db, id, since = 0, until = Infinity) => db.prepare('SELECT * FROM samples WHERE trend_id = ? AND t >= ? AND t <= ? ORDER BY t, res').all(id, since, Number.isFinite(until) ? until : 9e15);
/** A trend's samples from `since` on, oldest first, as lib/measure.js reads them. */
const seriesOf = (db, id, since = 0, until = Infinity) => rawSeries(db, id, since, until).map(sampleOfRow);

// ---------- the cycle, in memory ----------
/** The row a trend is described by when several audiences list it: the US list's, then the mixed one's. */
const primaryOf = (rows) => PRIMARY_ORDER.map((a) => rows[a]).find(Boolean);

const STORY_START_LATER = 6 * HOUR;
const PAGE_OWN_HEAT = 40;
/** Merges first-seen times, the earliest of each kind. */
function earliest(a, b) {
  const out = { ...(a || {}) };
  for (const [k, at] of Object.entries(b || {})) if (Number.isFinite(at) && (!Number.isFinite(out[k]) || at < out[k])) out[k] = at;
  return out;
}
/**
 * A start as the trend keeps it: it only ever moves earlier, and an hour beats a day (a new chapter never moves it: C4). `found`:
 * lib/signals.js startOf. Returns { startedAt, startedPrecision, startedDay }.
 */
function keepStart(trend, found) {
  const kept = { startedAt: trend.startedAt ?? null, startedPrecision: trend.startedPrecision || null, startedDay: trend.startedDay || null };
  if (!found) return kept;
  const next = { startedAt: found.at, startedPrecision: found.precision, startedDay: found.day || null };
  if (kept.startedAt === null) return next;
  // (an old thing's new flare is the start its card says, wherever the old one was: lib/signals.js startOf)
  if (found.flare && found.at !== kept.startedAt) return next;
  // (nor is a start kept that was only the name's coverage before the thing happened: the story's own first report is hours
  // later, and that is when it started. Only a move of six hours or more, so a start never creeps)
  if (found.story && kept.startedPrecision === 'hour' && found.precision === 'hour' && found.at - kept.startedAt >= STORY_START_LATER) return next;
  if (kept.startedPrecision === 'day' && found.precision === 'hour') return next;
  if (kept.startedPrecision === found.precision && found.at < kept.startedAt) return next;
  return kept;
}

/**
 * The samples a trend met late is given back to its start (B1): one an hour, rebuilt from what carries its own time (its headlines,
 * its creator-native items), flagged backfilled. A search band cannot be rebuilt (Trends gives only today's), so these carry the
 * press's and the creators' shape and no search, and they never count as observed. From the start's hour to the hour before `until`.
 */
function backfill(row, { from, until, kind, now = until, earlier = [] }) {
  if (!Number.isFinite(from) || !Number.isFinite(until) || until - from < HOUR) return [];
  const items = SG.itemsOf(row);
  // (earlier: the times of its own headlines before the week its name search shows, from its origin search)
  const press = [...items.filter((i) => i.k === 'outlet' || i.k === 'beat'), ...earlier.map((t) => ({ t, k: 'outlet', outlet: null }))];
  const native = items.filter((i) => i.k === 'upload' || i.k === 'beat');
  const lookback = Math.max(3 * HOUR, M.windowOf(kind));
  const within = (xs, t, seconds) => xs.filter((i) => i.t <= t && i.t > t - seconds).length;
  const out = [];
  // (14 days back from this cycle at most, whenever the stretch is rebuilt: the same slot run twice rebuilds the same hours)
  const first = Math.max(Math.ceil(from / HOUR) * HOUR, Math.floor((now - BACKFILL_MAX) / HOUR) * HOUR);
  for (let t = first; t <= until - HOUR; t += HOUR) {
    // (a week of headlines is sparse by the hour: a rebuilt hour reads the day's rate, in the look-back's own unit, so the dashed
    // stretch is a shape and not a comb)
    const rate = (xs) => Math.max(within(xs, t, lookback), (within(xs, t, DAY) * lookback) / DAY);
    const parts = M.partsOf({ press: rate(press), creators: { items: rate(native) } });
    const p = M.carried(parts, [], t);
    const cols = Object.fromEntries(SAMPLE_COLUMNS.map((c) => [c, null]));
    out.push({ ...cols, t, res: HOUR, n1: within(press, t, HOUR), n24: within(press, t, DAY), outlets: new Set(press.filter((i) => i.t <= t && i.t > t - 7 * DAY && i.outlet).map((i) => keyOf(i.outlet))).size,
      cr: within(native, t, HOUR), interest: M.interestOf(p), flags: FLAG.backfilled, p_s: null, p_n: parts.n, p_c: parts.c, p_r: null, p_w: null });
  }
  return out;
}

/**
 * The press of a trend's earlier samples, read again once its own name search has answered (B1, A4 "what a sample of the press rests
 * on"): between two searches of its name the collector knows only the headlines the every-cycle feeds happened to carry, so the
 * cycle the search lands the count jumps, and that jump is the collector catching up, not the story moving. A headline carries its
 * own time, so each earlier sample's count is recomputed from the full set now in hand, and its interest with it (the other parts as
 * they were sampled). Returns the rows that changed, as stored rows; `rows` are the trend's earlier rows, oldest first.
 */
function revisePress(rows, row, kind) {
  const items = SG.itemsOf(row);
  const press = items.filter((i) => i.k === 'outlet' || i.k === 'beat');
  const native = items.filter((i) => i.k === 'upload' || i.k === 'beat');
  const lookback = Math.max(3 * HOUR, M.windowOf(kind));
  const within = (xs, t, seconds) => xs.filter((i) => i.t <= t && i.t > t - seconds).length;
  const done = [];
  const changed = [];
  for (const r of rows) {
    const rebuilt = !!(r.flags & FLAG.backfilled);
    const rate = (xs) => (rebuilt ? Math.max(within(xs, r.t, lookback), (within(xs, r.t, DAY) * lookback) / DAY) : within(xs, r.t, lookback));
    const fresh = M.partsOf({ press: rate(press), creators: { items: rate(native) } });
    // (what people only lately typed was counted when it was seen and cannot be rebuilt: the creators' part never goes down here)
    // (a rebuilt hour keeps what it was given: the name's search shows a week, and a week on its oldest headlines are no longer in
    // the reply. They were printed all the same; a second search of the name must not empty the stretch its first one drew. Found
    // 2026-10-11, when a rerun of a slot searched a name again and its fortnight-old hours went to nothing)
    const keep = (was, now) => (rebuilt ? Math.max(was || 0, now) : now);
    const next = { ...r, n1: keep(r.n1, within(press, r.t, HOUR)), n24: keep(r.n24, within(press, r.t, DAY)),
      // (nor does any sample lose an outlet it had counted: the oldest of a week's outlets leave the reply, they did tell it)
      outlets: Math.max(r.outlets || 0, new Set(press.filter((i) => i.t <= r.t && i.t > r.t - 7 * DAY && i.outlet).map((i) => keyOf(i.outlet))).size),
      cr: Math.max(r.cr || 0, within(native, r.t, HOUR)), p_n: keep(r.p_n, fresh.n), p_c: Math.max(r.p_c || 0, fresh.c) };
    next.interest = M.interestOf(M.carried({ s: next.p_s, n: next.p_n, c: next.p_c, r: next.p_r, w: next.p_w }, done, r.t));
    done.push(sampleOfRow(next));
    if (next.interest !== r.interest || next.n1 !== r.n1 || next.n24 !== r.n24 || next.p_n !== r.p_n || next.p_c !== r.p_c || next.outlets !== r.outlets) changed.push(next);
  }
  return { series: done, changed };
}

/**
 * The timeline's raw material this cycle gives (D4): [{ at, kind, precision, text }], each written the cycle it is first seen.
 * watched: the trend's last observed sample is inside the last three hours, so what changed since changed now. A band a search had
 * already passed when the collector met it (a cold start, a story met late, the first cycle after hours down) was never seen being
 * passed: it is noted (`info.bands`) and never dated.
 */
function eventsOf({ row, trend, started, sample, t, firstObserved, watched = true }) {
  const tl = (row.meta && row.meta.timeline) || {};
  const out = [];
  const sec = (ms) => Math.floor(ms / 1000);
  if (Number.isFinite(started.startedAt)) {
    // (the first own headline tells the start only when it is the start's own: one of days later tells a later turn)
    const text = started.startedPrecision === 'hour' && tl.first && tl.first.text && Math.abs(sec(tl.first.t) - started.startedAt) <= START_TEXT_WITHIN ? tl.first.text : null;
    out.push({ at: started.startedAt, kind: 'start', precision: started.startedPrecision, text: text || (row.wordish || row.type === 'word' ? 'It starts to spread.' : 'The first reports appear.') });
  }
  if (tl.chapter && tl.chapter.text && Number.isFinite(tl.chapter.t)) out.push({ at: sec(tl.chapter.t), kind: 'chapter', precision: 'hour', text: tl.chapter.text });
  for (const r of tl.replies || []) if (r.text && Number.isFinite(r.t)) out.push({ at: sec(r.t), kind: 'reply', precision: 'hour', text: r.text });
  if (tl.latest && tl.latest.text && Number.isFinite(tl.latest.t)) out.push({ at: sec(tl.latest.t), kind: 'latest', precision: 'hour', text: tl.latest.text });
  // measured facts: only from an observed sample, dated when the collector saw it (never backfilled)
  if (sample.observed) {
    for (const c of sample.crossed) {
      const seen = watched || (Number.isFinite(c.start) && t >= c.start && t - c.start <= FRESH_ENTRY);
      if (seen && c.keyword && COUNTRY[c.geo]) out.push({ at: t, kind: 'measure', precision: 'hour', text: `Searches for “${c.keyword}” pass ${D.short(c.band)} in ${COUNTRY[c.geo]}.`, band: c.band });
    }
    if (watched && sample.topPost && !(trend.info && trend.info.topPost)) out.push({ at: t, kind: 'measure', precision: 'hour', text: 'It becomes the top post on Reddit’s streamer and drama boards.' });
  }
  return out.filter((e) => e.at <= t && (!Number.isFinite(started.startedAt) || e.kind === 'start' || e.at >= started.startedAt) && (e.kind !== 'measure' || firstObserved === null || e.at >= firstObserved));
}

/**
 * Steps 4 to 6 of a cycle for every trend, nothing written: { trends: Map(id -> cycle), minted, aliases, carried: [cycle] }.
 * input: { t (slot), rowsByAudience: { US: [rows], ... }, obs, warm (the collector had read its tier 0 sources inside the three hours
 * before this cycle: what "new by observation" needs), wikiFresh, lifetimes: (class) => [hours] }.
 * A cycle of one trend: { id, trend (as loaded, or new), rows: { audience: row }, primary, sample (the row to write), measure, status,
 * statusMeasured, early: { audience: bool }, next (the trend's next state), events, backfilled: [samples], timeLeftHours, text }.
 */
function step(db, { t, rowsByAudience, obs, warm = false, wikiFresh = true, lifetimes = () => [] }) {
  const index = loadIndex(db, t);
  const flat = AUDIENCES.flatMap((a) => rowsByAudience[a] || []);
  const matched = ID.match(flat, index, t);
  flat.forEach((row, i) => { row.id = matched.ids[i]; });
  const mintedBy = new Map(matched.minted.map((m) => [m.id, m]));
  const groups = new Map();
  for (const row of flat) { if (!groups.has(row.id)) groups.set(row.id, {}); if (!groups.get(row.id)[row.audience]) groups.get(row.id)[row.audience] = row; }
  const trends = new Map();
  for (const [id, rows] of groups) {
    const primary = primaryOf(rows);
    const minted = mintedBy.get(id);
    const loaded = index.trends.get(id) || { id, natural: minted.natural, kind: primary.kind, firstSeen: t, lastSeen: t, startedAt: null, startedPrecision: null, startedDay: null, peakAt: null,
      peakInterest: null, earlyAt: null, earlyGoneAt: null, promotedAt: null, chapterAt: null, endedAt: null, closedAt: null, firstListedAt: {}, firstPageAt: {}, status: null, statusTest: null,
      faded: false, notClimbing: 0, title: null, info: {} };
    // (the same slot run again starts from what the trend was before this slot's first run, so it ends where that run did: A3)
    const trend = loaded.info.steppedAt === t && loaded.info.before ? { ...loaded, ...loaded.info.before } : loaded;
    const kind = primary.kind;
    // (first met in this slot: this run, or an earlier run of the same slot)
    const met = trend.firstSeen === t;
    const stored = met ? [] : rawSeries(db, id, t - SERIES_BACK, t - 1);
    // (its own name search answered this cycle: the press of its earlier samples is read again from the full set of headlines)
    const lookKey = SG.lookupKeyOf(primary);
    const again = stored.length && lookKey && obs.namesNews.has(lookKey) ? revisePress(stored, primary, kind) : null;
    const earlier = again ? again.series : stored.map(sampleOfRow);
    const pastPage = Math.min(...Object.values(rows).map((r) => r.engineRank)) > 20;
    const sample = SG.sampleOf(primary, obs, { t, kind, earlier, info: trend.info, pastPage, wikiFresh });
    const p = M.carried(sample.parts, earlier, t, { pastPage });
    const interest = M.interestOf(p);
    // started: its own evidence; the cycle it was first met only when it is new by observation (never at a cold start)
    const newByObservation = met && warm && sample.observed && interest > 0;
    // (a name whose own search has not answered yet is known only by what the every-cycle feeds happened to carry: the first headline
    // they hold is no start, a week-old story would read "Started yesterday". Its card says nothing until the search lands: C4)
    const dated = !lookKey || !!(primary.meta && primary.meta.searched);
    // (its origin search, asked once when its start sat at the edge of its week: the fortnight before, which dates it and nothing else)
    const asked = lookKey ? obs.origins && obs.origins.get(lookKey) : null;
    const origin = asked ? SG.originOf(asked, primary) : trend.info.origin || null;
    const found = dated ? SG.startOf(primary, { t, observedAt: newByObservation ? t : null, earlier: origin ? origin.times : [] }) : null;
    // (nor is a start at the edge of what its name's search could show: the search looks back a week, and the first headline of a
    // story older than that is where the looking began. The card says nothing rather than "Started 7 days ago", and the origin
    // search is owed: C4)
    const searchedAt = lookKey && primary.meta && Number.isFinite(primary.meta.newsAt) ? Math.floor(primary.meta.newsAt / 1000) : null;
    const edge = origin ? origin.from : searchedAt === null ? null : searchedAt - M.K.NAME_SEARCH_WINDOW;
    const censored = M.startCensored(found, edge);
    // (a headline of the weeks before carries its day and no hour: a start it gives is known to the day)
    const dayOnly = !censored && !!found && !!origin && origin.times.includes(found.at) && SG.isDateOnly(found.at);
    const started = keepStart(trend, censored ? null : dayOnly ? { at: found.at, precision: 'day', day: new Date(found.at * 1000).toISOString().slice(0, 10) } : found);
    // met late, or its start just moved back before everything it has: the stretch from its start to its first sample is rebuilt
    const movedBack = (started.startedPrecision === 'hour' || !!origin) && Number.isFinite(started.startedAt) && (met || started.startedAt !== trend.startedAt || trend.startedPrecision !== started.startedPrecision);
    const earliestAt = !movedBack || met ? t : db.prepare('SELECT MIN(t) m FROM samples WHERE trend_id = ? AND t < ?').get(id, t).m ?? t;
    const backfilled = movedBack && earliestAt - started.startedAt >= 2 * HOUR ? backfill(primary, { from: started.startedAt, until: earliestAt, kind, now: t, earlier: origin ? origin.times : [] }) : [];
    const before = [...backfilled.map(sampleOfRow), ...earlier];
    const now = { t, res: SLOT_SECONDS, interest, observed: sample.observed, backfilled: false, p: sample.parts, sv: Math.max(0, ...GEOS.map((g) => sample.cols[`sv_${g.toLowerCase()}`] || 0)) || (sample.cols.s_live === null ? null : 0),
      sg: Math.max(0, ...GEOS.map((g) => sample.cols[`sg_${g.toLowerCase()}`] || 0)) || null, cr: sample.cols.cr, ytH: null, ttVideos: sample.cols.tt_videos, rdRank: sample.cols.rd_rank, soc: sample.cols.soc };
    const series = [...before, now];
    const kindFirst = earliest(trend.info.kindFirst, sample.kindSeen);
    const tl = (primary.meta && primary.meta.timeline) || {};
    // ("on the page on its own heat": a creators' story the page leads with at a low heat is there by its tier, and is not proven by
    // being there. Judges, 2026-10-11: a day-old story with four outlets and a 5K search, on the page, is exactly what Early is for)
    const audiences = Object.fromEntries(AUDIENCES.filter((a) => rowsByAudience[a]).map((a) => { const r = rows[a]; return [a, { onPage: !!r && r.engineRank <= 20 && r.heat >= PAGE_OWN_HEAT, homeSearch: D.homeSearchOf(r || primary, a) }]; }));
    const state = { kind, status: trend.status, statusTest: trend.statusTest, faded: trend.faded, startedAt: started.startedAt, startedPrecision: started.startedPrecision, firstSeen: trend.firstSeen,
      peakAt: trend.peakAt, peakInterest: trend.peakInterest, earlyAt: trend.earlyAt, earlyGoneAt: trend.earlyGoneAt, promotedAt: trend.promotedAt, chapterAt: trend.chapterAt, endedAt: trend.endedAt,
      notClimbing: trend.notClimbing };
    const grim = D.isGrim(primary);
    // (its own items by their own times: what quiet, collapsed and "arriving faster" read. A name not searched yet is known only by
    // what the every-cycle feeds carried, which is no shape of its story at all)
    const ownItems = dated ? SG.itemsOf(primary).filter((i) => i.k !== 'meme') : [];
    const stats = M.itemStats(ownItems.map((i) => i.t), t);
    // ("arriving faster" is read from the items that themselves say the card's noun, from two sources or more: a streamer's daily
    // clips and one post are one signal, however many items: C3)
    const fam = primary.family ? TN.FAMILY.get(primary.family) || null : null;
    const telling = ownItems.filter((i) => !fam || (!!i.title && TN.says(i.title, fam)));
    const told = M.itemStats(telling.map((i) => i.t), t);
    const tellers = new Set(telling.filter((i) => i.t > t - M.K.ITEMS_RISING_SPAN).map((i) => keyOf(i.outlet || i.sub || i.k))).size;
    const items = stats ? { ...stats, rising: !!(told && told.rising) && tellers >= 2 } : null;
    const adv = M.advance(state, series, { t, engineStatus: primary.engineStatus, items, flare: !!(tl.chapter && tl.chapter.flare), chapterAt: tl.chapter && Number.isFinite(tl.chapter.t) ? Math.floor(tl.chapter.t / 1000) : null, n24: sample.n24,
      liveHome: sample.liveHome, outlets: D.outletsOf(primary), kindFirst, sayable: !!primary.title && !!primary.line, grim, observed: sample.observed, audiences });
    const searchMax = Math.max(0, ...GEOS.map((g) => D.homeSearchOf(primary, g)));
    const cls = M.classOf({ kind, drama: primary.drama, tier: primary.tier, searchMax });
    const firstObserved = (earlier.find((s) => s.observed) || (sample.observed ? { t } : { t: null })).t;
    const anyEarly = Object.values(adv.early).some(Boolean);
    const status = anyEarly ? null : adv.status;
    const W = M.windowOf(kind);
    const recent = M.smooth(series).filter((x) => x.t > t - 2 * W);
    const timeLeftHours = M.timeLeft({ t, kind, status: adv.status, measured: adv.statusMeasured, startedAt: started.startedAt, startedPrecision: started.startedPrecision, chapterAt: adv.state.chapterAt,
      grim, somber: D.isSomber(primary), early: anyEarly, share: adv.m.share, lifetimes: lifetimes(cls), prior: M.lifePrior(cls), recent });
    const events = eventsOf({ row: primary, trend, started, sample, t, firstObserved, watched: earlier.some((s) => s.observed && t - s.t <= SEEN_LATELY) });
    const bands = { ...((trend.info && trend.info.bands) || {}) };
    for (const c of sample.crossed) bands[c.geo] = Math.max(bands[c.geo] || 0, c.band);
    const { before: dropBefore, steppedAt: dropStepped, ...infoWas } = trend.info;
    const snapshot = { firstListedAt: trend.firstListedAt, firstPageAt: trend.firstPageAt, startedAt: trend.startedAt, startedPrecision: trend.startedPrecision, startedDay: trend.startedDay, peakAt: trend.peakAt,
      peakInterest: trend.peakInterest, earlyAt: trend.earlyAt, earlyGoneAt: trend.earlyGoneAt, promotedAt: trend.promotedAt, chapterAt: trend.chapterAt, endedAt: trend.endedAt, status: trend.status,
      statusTest: trend.statusTest, faded: trend.faded, notClimbing: trend.notClimbing, info: infoWas };
    const info = { ...ID.infoAfter(infoWas, primary), steppedAt: t, before: snapshot, kindFirst, fresh: Object.fromEntries(Object.entries(sample.fresh).slice(-40)), ytReadAt: sample.ytRead ? t : trend.info.ytReadAt ?? null, bands,
      topPost: !!(trend.info && trend.info.topPost) || sample.topPost, name: SG.lookupKeyOf(primary) ? primary.meta.key : null, ...(origin ? { origin } : {}), drama: primary.drama, tier: primary.tier || null, searchMax };
    trends.set(id, { id, trend, minted: !!minted, met, revised: again ? again.changed : [], rows, primary, kind, cls, sample: { ...sample.cols, interest, p_s: sample.parts.s, p_n: sample.parts.n, p_c: sample.parts.c, p_r: sample.parts.r, p_w: sample.parts.w,
      flags: (sample.observed ? 0 : FLAG.carried) | (['s', 'n', 'c', 'r'].some((k) => sample.parts[k] === null) ? FLAG.partial : 0) },
    measure: adv.m, status: adv.status, engineStatus: primary.engineStatus, publishedStatus: status, statusMeasured: adv.statusMeasured, early: adv.early, endedNow: adv.endedNow,
    next: { ...adv.state, ...started }, events, backfilled, timeLeftHours, info, grim, firstObserved, kinds: sample.kinds, searchNow: sample.searchNow, series,
    // (its start is not said because it sits where the looking began, and nothing has looked further back yet: the origin search is owed)
    originOwed: censored && started.startedAt === null && !origin && Number.isFinite(edge) ? { name: primary.meta.key, edge } : null });
  }
  // the trends the engine no longer lists: sampled on, carried, so their decay is measured and their end found
  const carried = [];
  for (const trend of index.trends.values()) {
    if (trends.has(trend.id) || Number.isFinite(trend.endedAt) || t - trend.lastSeen > CARRY_UNSEEN || trend.lastSeen >= t) continue;
    // (already carried for this slot by an earlier run of it)
    if (db.prepare('SELECT 1 FROM samples WHERE trend_id = ? AND t = ? AND res = ?').get(trend.id, t, SLOT_SECONDS)) continue;
    const earlier = seriesOf(db, trend.id, t - SERIES_BACK, t - 1);
    if (!earlier.length) continue;
    const blank = { s: null, n: null, c: null, r: null, w: null };
    const interest = M.interestOf(M.carried(blank, earlier, t));
    const series = [...earlier, { t, res: SLOT_SECONDS, interest, observed: false, backfilled: false, p: blank }];
    const state = { kind: trend.kind, status: trend.status, statusTest: trend.statusTest, faded: trend.faded, startedAt: trend.startedAt, startedPrecision: trend.startedPrecision, firstSeen: trend.firstSeen,
      peakAt: trend.peakAt, peakInterest: trend.peakInterest, earlyAt: trend.earlyAt, earlyGoneAt: trend.earlyGoneAt, promotedAt: trend.promotedAt, chapterAt: trend.chapterAt, endedAt: trend.endedAt,
      notClimbing: trend.notClimbing };
    const adv = M.advance(state, series, { t, engineStatus: 'fading', n24: 0, liveHome: false, outlets: 0, kindFirst: trend.info.kindFirst, sayable: false, grim: false, observed: false, audiences: {} });
    carried.push({ id: trend.id, trend, sample: { ...Object.fromEntries(SAMPLE_COLUMNS.map((c) => [c, null])), interest, flags: FLAG.carried }, next: adv.state, endedNow: adv.endedNow, measure: adv.m });
  }
  return { t, trends, minted: matched.minted, aliases: matched.aliases, carried };
}

// ---------- writing ----------
const TREND_COLUMNS = ['id', 'natural_key', 'kind', 'sub', 'class', 'first_seen', 'last_seen', 'started_at', 'started_precision', 'started_day', 'peak_at', 'peak_interest', 'early_at',
  'early_gone_at', 'promoted_at', 'chapter_at', 'ended_at', 'closed_at', 'first_listed_at', 'first_page_at', 'status', 'status_test', 'faded', 'not_climbing', 'title', 'info'];
const num = (x) => (Number.isFinite(x) ? x : null);

/**
 * Writes one slot: trends, aliases, samples (this slot's and any backfilled), texts, events and lifetimes, in one transaction.
 * published: Map(id -> { ranks: { audience: rank }, heats: { audience: heat }, early: bool, onPage: bool, title, line, lineWrittenBy, sub }).
 */
function commit(db, cycle, published = new Map()) {
  const { t } = cycle;
  const putTrend = db.prepare(`INSERT OR REPLACE INTO trends (${TREND_COLUMNS.join(', ')}) VALUES (${TREND_COLUMNS.map(() => '?').join(', ')})`);
  const putAlias = db.prepare('INSERT OR REPLACE INTO aliases (key, trend_id) VALUES (?, ?)');
  const putSample = db.prepare(`INSERT OR REPLACE INTO samples (trend_id, t, res, ${SAMPLE_COLUMNS.join(', ')}) VALUES (?, ?, ?, ${SAMPLE_COLUMNS.map(() => '?').join(', ')})`);
  const lastText = db.prepare('SELECT title, line, line_written_by FROM texts WHERE trend_id = ? AND t <= ? ORDER BY t DESC LIMIT 1');
  const putText = db.prepare('INSERT OR REPLACE INTO texts (trend_id, t, title, line, line_written_by) VALUES (?, ?, ?, ?, ?)');
  const dropStarts = db.prepare("DELETE FROM events WHERE trend_id = ? AND kind = 'start' AND at <> ?");
  const hasEvent = db.prepare('SELECT 1 FROM events WHERE trend_id = ? AND at = ? AND kind = ?');
  const putEvent = db.prepare('INSERT OR REPLACE INTO events (trend_id, at, kind, precision, text, seen) VALUES (?, ?, ?, ?, ?, ?)');
  const putLife = db.prepare('INSERT OR REPLACE INTO lifetimes (trend_id, class, start, peak, end, peak_interest) VALUES (?, ?, ?, ?, ?, ?)');
  const sampleValues = (s) => SAMPLE_COLUMNS.map((c) => (s[c] === undefined || s[c] === null || Number.isNaN(s[c]) ? null : s[c]));
  const lifetime = (id, cls, next, firstSeen) => {
    // (observed lifetimes only: a trend met after its peak, or with no start, writes none)
    if (!Number.isFinite(next.endedAt) || !Number.isFinite(next.startedAt) || !Number.isFinite(next.peakAt) || firstSeen > next.peakAt || !cls) return;
    putLife.run(id, cls, next.startedAt, next.peakAt, next.endedAt, next.peakInterest || 0);
  };
  transaction(db, () => {
    for (const [key, id] of cycle.aliases) putAlias.run(key, id);
    for (const c of cycle.trends.values()) {
      const pub = published.get(c.id) || { ranks: {}, heats: {} };
      const listed = { ...c.trend.firstListedAt };
      const paged = { ...c.trend.firstPageAt };
      for (const [a, rank] of Object.entries(pub.ranks || {})) {
        if (!Number.isFinite(rank)) continue;
        if (!Number.isFinite(listed[a])) listed[a] = t;
        if (rank <= 20 && !Number.isFinite(paged[a])) paged[a] = t;
      }
      const n = c.next;
      putTrend.run(c.id, c.trend.natural, c.kind, pub.sub || c.trend.sub || null, c.cls, c.trend.firstSeen, t, num(n.startedAt), n.startedPrecision || null, n.startedDay || null, num(n.peakAt),
        num(n.peakInterest), num(n.earlyAt), num(n.earlyGoneAt), num(n.promotedAt), num(n.chapterAt), num(n.endedAt), null, JSON.stringify(listed), JSON.stringify(paged), n.status || null,
        n.statusTest || null, n.faded ? 1 : 0, n.notClimbing || 0, pub.title || c.primary.title, JSON.stringify(c.info));
      for (const b of c.backfilled) putSample.run(c.id, b.t, b.res, ...sampleValues(b));
      for (const r of c.revised) putSample.run(c.id, r.t, r.res, ...sampleValues(r));
      const s = { ...c.sample };
      for (const a of AUDIENCES) {
        const col = AUDIENCE_COLUMN[a];
        s[`h_${col}`] = Number.isFinite((pub.heats || {})[a]) ? pub.heats[a] : c.rows[a] ? c.rows[a].heat : null;
        s[`r_${col}`] = Number.isFinite((pub.ranks || {})[a]) ? pub.ranks[a] : null;
      }
      s.flags = (s.flags || 0) | (pub.early ? FLAG.early : 0) | (pub.onPage ? FLAG.page : 0);
      putSample.run(c.id, t, SLOT_SECONDS, ...sampleValues(s));
      const title = pub.title || c.primary.title;
      const line = pub.line === undefined ? c.primary.line : pub.line;
      const by = pub.lineWrittenBy || 'headline';
      const old = lastText.get(c.id, t);
      if (!old || old.title !== title || (old.line || null) !== (line || null) || old.line_written_by !== by) putText.run(c.id, t, title, line || null, by);
      for (const e of c.events) {
        if (e.kind === 'start') dropStarts.run(c.id, e.at);
        if (!hasEvent.get(c.id, e.at, e.kind)) putEvent.run(c.id, e.at, e.kind, e.precision, e.text, t);
      }
      // (the peak, once it is behind and was seen by the collector itself)
      const peak = M.peakToSend(c.publishedStatus || c.status, n.peakAt, t);
      if (peak !== null && c.firstObserved !== null && peak >= c.firstObserved && !db.prepare("SELECT 1 FROM events WHERE trend_id = ? AND kind = 'peak'").get(c.id)) {
        putEvent.run(c.id, peak, 'peak', 'hour', 'Interest peaks.', t);
      }
      if (c.endedNow) lifetime(c.id, c.cls, n, c.trend.firstSeen);
    }
    const carry = db.prepare('UPDATE trends SET peak_at = ?, peak_interest = ?, ended_at = ?, status = ?, status_test = ?, faded = ?, not_climbing = ?, early_gone_at = ?, promoted_at = ? WHERE id = ?');
    for (const c of cycle.carried) {
      putSample.run(c.id, t, SLOT_SECONDS, ...sampleValues(c.sample));
      const n = c.next;
      carry.run(num(n.peakAt), num(n.peakInterest), num(n.endedAt), n.status || null, n.statusTest || null, n.faded ? 1 : 0, n.notClimbing || 0, num(n.earlyGoneAt), num(n.promotedAt), c.id);
      if (c.endedNow) lifetime(c.id, c.trend.class, n, c.trend.firstSeen);
    }
  });
}

// ---------- the timeline, as a detail shows it ----------
/**
 * A trend's timeline (D4), oldest first, six entries at most: the start and the latest always, then the newest chapters and replies
 * (three at most), then the peak and the highest search band crossed. The latest shows only when it is six hours or more after the
 * entry before it. No entry before the start or after `until`. events: rows of `events`.
 */
function timelineOf(events, { startedAt, until }) {
  const rows = events.filter((e) => e.at <= until && (e.kind === 'start' || !Number.isFinite(startedAt) || e.at >= startedAt));
  const start = rows.filter((e) => e.kind === 'start').sort((a, b) => a.at - b.at)[0] || null;
  // (one sentence once: a reply the start already tells is not told again)
  const told = new Set(start ? [start.text] : []);
  const middle = rows.filter((e) => e.kind === 'chapter' || e.kind === 'reply').sort((a, b) => b.at - a.at).filter((e) => !told.has(e.text) && told.add(e.text)).slice(0, TIMELINE_MIDDLE);
  const peak = rows.find((e) => e.kind === 'peak') || null;
  const bands = rows.filter((e) => e.kind === 'measure');
  const band = bands.filter((e) => /^Searches /.test(e.text)).sort((a, b) => b.at - a.at)[0] || null;
  const board = bands.find((e) => !/^Searches /.test(e.text)) || null;
  const chosen = [start, ...middle, peak, band, board].filter(Boolean);
  const lastAt = Math.max(-Infinity, ...chosen.map((e) => e.at));
  const said = new Set(chosen.map((e) => e.text));
  const latest = rows.filter((e) => e.kind === 'latest' && e.at - lastAt >= LATEST_GAP && !said.has(e.text)).sort((a, b) => b.at - a.at)[0] || null;
  const kindOut = (e) => (e.kind === 'peak' ? 'measure' : e.kind);
  const all = [start, latest, ...middle, peak, band, board].filter(Boolean).slice(0, TIMELINE_MAX).sort((a, b) => a.at - b.at || (a.kind === 'start' ? -1 : 1));
  return all.map((e) => ({ at: e.at, precision: e.precision === 'day' ? 'day' : 'hour', text: e.text, kind: kindOut(e) }));
}

// ---------- compaction and pruning (B2) ----------
const MAX_COLS = ['sv_us', 'sv_gb', 'sv_au', 'sv_ca', 'sg_us', 'sg_gb', 'sg_au', 'sg_ca', 'outlets', 'kinds', 'n24', 'rd', 'wiki', 'yt_h', 'tt_videos', 'tt_views', 'soc'];
const MEAN_COLS = ['interest', 'h_us', 'h_gb', 'h_au', 'h_ca', 'h_mx', 'p_s', 'p_n', 'p_c', 'p_r', 'p_w'];
const BEST_COLS = ['r_us', 'r_gb', 'r_au', 'r_ca', 'r_mx', 'rd_rank'];
/** One coarser row from finer ones (B2): the maximum of the bands and the counts that only grow, the mean of interest and the heats, the best of the ranks, flags or-ed. */
function fold(rows, t, res) {
  const vals = (c) => rows.map((r) => r[c]).filter((x) => x !== null && x !== undefined);
  const out = { t, res };
  for (const c of MAX_COLS) { const v = vals(c); out[c] = v.length ? Math.max(...v) : null; }
  for (const c of MEAN_COLS) { const v = vals(c); out[c] = v.length ? Math.round(100 * (v.reduce((a, b) => a + b, 0) / v.length)) / 100 : null; }
  for (const c of BEST_COLS) { const v = vals(c); out[c] = v.length ? Math.min(...v) : null; }
  // (n1 and cr are counts of one hour: the hour's own is its last sample's; a day's is the sum of its hours')
  for (const c of ['n1', 'cr']) { const v = vals(c); out[c] = !v.length ? null : res === HOUR ? v[v.length - 1] : v.reduce((a, b) => a + b, 0); }
  const live = vals('s_live');
  out.s_live = live.length ? live.reduce((a, b) => a | b, 0) : null;
  out.flags = rows.reduce((a, r) => a | (r.flags || 0), 0);
  // (a bucket holding any observed sample is observed: the carried and backfilled bits stand only when every sample had them)
  for (const bit of [FLAG.carried, FLAG.backfilled]) if (!rows.every((r) => (r.flags || 0) & bit)) out.flags &= ~bit;
  return out;
}
/**
 * Compaction, in one transaction: 15-minute samples older than 48 hours become one row an hour, hourly rows older than 14 days one
 * a day (the UTC day, a storage bucket only), daily rows older than 400 days go. Returns how many rows it folded away.
 */
function compact(db, t) {
  const put = db.prepare(`INSERT OR REPLACE INTO samples (trend_id, t, res, ${SAMPLE_COLUMNS.join(', ')}) VALUES (?, ?, ?, ${SAMPLE_COLUMNS.map(() => '?').join(', ')})`);
  let folded = 0;
  const pass = (from, to, before) => {
    const cut = Math.floor((t - before) / to) * to;
    const rows = db.prepare('SELECT * FROM samples WHERE res = ? AND t < ? ORDER BY trend_id, t').all(from, cut);
    const groups = new Map();
    for (const r of rows) { const k = `${r.trend_id}|${Math.floor(r.t / to) * to}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    for (const [k, group] of groups) {
      const [id, bucket] = k.split('|');
      // (a coarser row already there, a backfilled hour, is folded in with the finer ones)
      const old = db.prepare('SELECT * FROM samples WHERE trend_id = ? AND t = ? AND res = ?').get(id, Number(bucket), to);
      const row = fold(old ? [old, ...group] : group, Number(bucket), to);
      put.run(id, row.t, to, ...SAMPLE_COLUMNS.map((c) => (row[c] === undefined ? null : row[c])));
    }
    db.prepare('DELETE FROM samples WHERE res = ? AND t < ?').run(from, cut);
    folded += rows.length;
  };
  transaction(db, () => {
    pass(SLOT_SECONDS, HOUR, FINE_KEPT);
    pass(HOUR, DAY, HOURLY_KEPT);
    db.prepare('DELETE FROM samples WHERE res = ? AND t < ?').run(DAY, t - DAILY_KEPT);
  });
  return folded;
}
/**
 * Closes the trends unseen for 8 days (30 for a word or a sound) and drops what nothing reads any more, so the state stays small
 * however long the collector runs: a closed trend's aliases (its keys are free for the trend that comes back) and all of its `info` but
 * its card keys and its name (nothing matches against it again; the scoreboard reads its columns); the "latest" timeline entries a
 * newer one has superseded (an active story gets one with every new headline); fetch rows older than 30 days.
 */
function prune(db, t) {
  transaction(db, () => {
    for (const [kind, days] of Object.entries(ID.CLOSE_AFTER_DAYS)) db.prepare('UPDATE trends SET closed_at = ? WHERE closed_at IS NULL AND kind = ? AND last_seen < ?').run(t, kind, t - days * DAY);
    const slim = db.prepare('UPDATE trends SET info = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, info FROM trends WHERE closed_at = ?').all(t)) {
      const info = parse(r.info, {});
      slim.run(JSON.stringify({ keys: info.keys || [], name: info.name ?? null }), r.id);
    }
    db.prepare('DELETE FROM aliases WHERE trend_id IN (SELECT id FROM trends WHERE closed_at = ?)').run(t);
    db.prepare(`DELETE FROM events WHERE kind = 'latest' AND at < (SELECT e.at FROM events e WHERE e.trend_id = events.trend_id AND e.kind = 'latest' ORDER BY e.at DESC LIMIT 1 OFFSET ${LATEST_KEPT - 1})`).run();
    db.prepare('DELETE FROM fetches WHERE t < ?').run(t - 30 * DAY);
  });
}

/** The lifetimes of ended trends of one class in the last 120 days, in hours (C7's comparables). */
function lifetimesOf(db, t) {
  const cache = new Map();
  return (cls) => {
    if (!cache.has(cls)) cache.set(cls, db.prepare('SELECT start, end FROM lifetimes WHERE class = ? AND end >= ?').all(cls, t - M.K.COMPARABLE_DAYS * DAY).map((r) => (r.end - r.start) / HOUR));
    return cache.get(cls);
  };
}

module.exports = { step, commit, compact, prune, loadIndex, seriesOf, rawSeries, revisePress, sampleOfRow, trendOf, backfill, eventsOf, timelineOf, keepStart, fold, lifetimesOf, primaryOf, homeGeos,
  SERIES_BACK, FINE_KEPT, HOURLY_KEPT };
