'use strict';
/*
 * The feed (ios/IDEAS-FEED.md D): each audience's list, the per-trend details and the bundles, from one cycle's rows and their
 * measured state (lib/history.js `step`). Nothing is written here; lib/publish.js does that. Every list is checked with the same
 * validator the samples ship (samples/validate.cjs): one bad row is left out and the rest ranked again, never the list held back.
 */
const V = require('../samples/validate.cjs');
const PRE = require('./precursor');
const M = require('./measure');
const D = require('./describe');
const H = require('./history');
const ID = require('./identity');
const SG = require('./signals');
const SURE = require('./topics-sure');
const SHEET = require('./sheet');
const SIZE = require('./size/detail');
const IDEAS = require('./editor/ideas');
const ENTITY = require('./entity');
const EXT = require('./extension');
const { OUTLET_BY_DOMAIN } = require('./outlets');
const { AUDIENCES, TIME_ZONE, HOUR, DAY, instant, instantOrNull, localDay, noonIn, hashHex, minify, keyOf } = require('./util');

const SCHEMA_VERSION = 1;
const PAGE_SIZE = 20;
const CYCLE_MINUTES = 15;
// (the main list's 80, laid out as ever, and the extension after them: lib/extension.js, D3 as of 2026-10-31)
const MAIN_ROWS = EXT.MAIN_ROWS;
const ROWS_MAX = 160;
const MAIN_BYTES_MAX = 120000;
const LIST_BYTES_MAX = 240000;
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
// (a line of two or three levels is no curve: a young trend's graph waits until it has this many different values to draw)
const GRAPH_MIN_LEVELS = 4;
const GRAPH_YOUNG = 24 * HOUR;
// (the rebuilt stretch counts headlines in a three-hour look-back, so each one drew as a flat-topped block three hours wide: a
// running mean this wide makes them the hills they stand for. Reviewers, 2026-10-12: "a square wave, not interest")
const GRAPH_SOFTEN = 3 * HOUR;
// names a headline's "outlet" carries that are no outlet: a social site hosts what someone posted, it reported nothing
const NOT_AN_OUTLET = /^(?:google news|twitch|kick|facebook|instagram|tiktok|youtube|reddit|bluesky|x|twitter|threads|tumblr|pinterest|linkedin|snapchat|discord|telegram|medium|substack|msn)$/i;
const DOMAIN_LIKE = /^[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}$/i;

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
  // (known only to the month, a row the month's list dates: the phone says "Started this month")
  return { startedAt: noonIn(localDay(ref, zone), zone), startedPrecision: next.startedPrecision === 'month' ? 'month' : 'day' };
}

/**
 * An outlet's name without the slogan its feed appends ("ABC News - Breaking News, Latest News and Videos" is "ABC News"), nor the
 * separator a feed leaves hanging on it ("What's Trending ·", as Google News names that outlet: seen on the first joined run).
 */
const outletName = (s) => String(s).split(/\s+[-–—|:·•]\s+/)[0].replace(/[\s·•|:–—-]+$/, '').trim();
/**
 * A source as "Reported by" names it, or null for what is no outlet's name: a social site, a clip chart, a bare web address nobody
 * knows by a name ("Howl.Link", "uknip.co.uk"). An outlet Google News names by its address reads as it calls itself ("People.com"
 * is "People"). Reviewers, 2026-10-12: "primetimer.com", "Facebook" and "Howl.Link" under Reported by.
 */
function sourceName(s) {
  const name = outletName(s);
  if (!name || NOT_AN_OUTLET.test(name)) return null;
  const known = OUTLET_BY_DOMAIN[name.toLowerCase().replace(/^www\./, '')];
  if (known) return known;
  return DOMAIN_LIKE.test(name) ? null : name;
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
 * trend's age, the last point this cycle's. A step with no sample lies on the line between its neighbours, and the rebuilt stretch
 * is softened (a running mean three hours wide) so its headlines draw as hills. null with fewer than 4 points, under 2 hours of
 * them, nothing above 0, or fewer than four different levels (no curve yet: the sheet then shows nothing in its place).
 * series: the trend's samples, oldest first. opts: { t, startedAt, peaked (the list sends a peak), peakAt (the time it sends),
 * firstObserved, line ({ kind, searches }: how lib/measure.js `oneScale` draws a trend met after it began), joinQuiet (seconds:
 * the first window of watching such a trend, in which nothing is rung) }.
 * A trend with a rebuilt stretch is one line on one scale, so all of it is softened alike and its ring stands on its highest step
 * wherever that is, but never inside the first window the collector watched it (reviewers, 2026-10-12: equal levels drew as 69 and
 * 100 either side of the join, and every such trend was rung where tracking began).
 */
function graphOf(series, { t, startedAt, peaked, peakAt, firstObserved, line = {}, joinQuiet = 0 }) {
  const rebuiltBefore = M.hasRebuilt(series);
  const pts = M.drawn(series, line).filter((x) => x.t <= t);
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
    // (the mean of what fell in the step; before the first sample, nothing; a step with no sample is filled below)
    raw.push(inStep.length ? inStep.reduce((a, b) => a + b, 0) / inStep.length : g < pts[0].t ? 0 : null);
    if (i === n - 1 && raw[i] === null) raw[i] = held;
  }
  // (a step with no sample lies on the line between the steps either side: never a shelf carried flat to the next sample)
  for (let i = 0; i < n; i++) {
    if (raw[i] !== null) continue;
    let b = i;
    while (b < n && raw[b] === null) b += 1;
    const from = i > 0 ? raw[i - 1] : 0;
    const to = b < n ? raw[b] : from;
    for (let k = i; k < b; k++) raw[k] = from + ((to - from) * (k - i + 1)) / (b - i + 1);
    i = b;
  }
  const index0 = (seconds) => Math.min(n - 1, Math.max(0, Math.floor((seconds - t0) / step)));
  const seenFrom = Number.isFinite(firstObserved) ? index0(firstObserved) : n - 1;
  // (softened: each point the mean of the three hours around it. A trend with a rebuilt stretch is press counts in a look-back all
  // the way, one scale, so the whole line is softened alike; a trend seen from its start is drawn as it was measured)
  const half = Math.max(1, Math.round(GRAPH_SOFTEN / 2 / step));
  // (but for its last point, which is now and is drawn as it stands: a mean with the steps before it would lag the badge)
  const softTo = rebuiltBefore ? n - 1 : 0;
  const unsoft = raw.slice();
  for (let i = 0; i < softTo; i++) {
    const part = unsoft.slice(Math.max(0, i - half), Math.min(n, i + half + 1));
    raw[i] = part.reduce((a, b) => a + b, 0) / part.length;
  }
  const top = Math.max(...raw);
  if (!(top > 0)) return null;
  const v = raw.map((x) => Math.round((100 * x) / top));
  // (a young trend's two or three levels are no curve yet; an older line that is flat is flat)
  if (t - from < GRAPH_YOUNG && new Set(v).size < GRAPH_MIN_LEVELS) return null;
  const index = index0;
  let peak = peaked ? peakIndex(v, Number.isFinite(peakAt) ? Math.min(n - 1, Math.max(0, Math.ceil((peakAt - t0) / step))) : null) : null;
  // (nothing is rung where the collector began to watch a trend it met after it began: the two hours before, the first window after)
  if (peak !== null && rebuiltBefore && Number.isFinite(firstObserved)) {
    const ringAt = t0 + peak * step;
    if (ringAt > firstObserved - Math.max(step, H.JOIN_BEFORE) && ringAt < firstObserved + joinQuiet) peak = null;
  }
  return { t0: instant(t0), stepMinutes, v, start: Number.isFinite(startedAt) ? Math.min(n - 1, Math.max(0, Math.ceil((startedAt - t0) / step))) : 0, peak: peak !== null && peak >= 0 ? peak : null,
    observedFrom: Number.isFinite(firstObserved) ? index(firstObserved) : n - 1 };
}

/**
 * A "peaking" held to the graph its own card draws (C2): fading when the graph's last point is under 40% of a peak six hours behind
 * or more (two days for a word or a sound), or under half of one two days behind. Any other status, and a row with no graph, stand.
 */
// how recent an outlet headline of the row's own must be for the printed badge never to say "fading" (seconds)
const TOLD_INSIDE = 12 * HOUR;
/**
 * Whether the row has an outlet headline of its own (a post, a clip or a video is none) published inside `span` seconds before `t`.
 * A blocked outlet's headline counts as the engine counts one (engine/build.js: it never words a line, and it is still the story
 * being written up).
 */
function toldInside(row, t, span) {
  return SG.itemsOf(row).some((i) => !i.native && (i.k === 'outlet' || i.k === 'beat') && i.title && Number.isFinite(i.t) && i.t <= t && t - i.t <= span);
}
/**
 * One way, at publish time: a talking point with an outlet headline of its own inside the last twelve hours, by the headline's own
 * time, never prints "fading", whatever its state or its line's shape says: the story is being written up now. Unless its own graph
 * has collapsed under an old peak, which a "peaking" is held to (samples/validate.cjs `statusAgainstGraph`): the badge never says
 * what the graph denies. The state keeps its word: nothing here moves a status, starts a chapter or alerts anyone, the lifted badge
 * prints unmeasured (`statusMeasured: false`), and a row the guard lets go of prints what the state held all along. 2026-10-13: a
 * singer's cancelled show, seventeen headlines in twelve hours, read "Fading" off a graph that had dipped.
 */
function toldNow(row, t, detail) {
  return !!row && row.kind === 'talk' && toldInside(row, t, TOLD_INSIDE) && !V.statusAgainstGraph({ status: 'peaking' }, detail).length;
}
function statusByGraph(status, graph, { t, kind }) {
  if (status !== 'peaking' || !graph || !Array.isArray(graph.v) || !graph.v.length) return status;
  const top = graph.v.lastIndexOf(Math.max(...graph.v));
  const peakAt = Date.parse(graph.t0) / 1000 + top * graph.stepMinutes * 60;
  return M.byShape(status, { share: graph.v[graph.v.length - 1] / 100, peakAt }, { t, kind });
}

/**
 * One trend's detail (D4), the same for every audience, and its rev (a hash of what it shows, not of when it was written). ideas: the
 * editor card's why and angles as the row carries them (`editorIdeas`, lib/editor/ideas.js `publishedOf`), and line: the row's line as
 * listed, which a why that only says it again gives way to, and whose words (and the why lines') an angle's fact is not told again in.
 */
function detailOf(c, { t, generatedAt, db, peaked, related = null, roster = null, ideas = null, line = null, relatedRows = [], size = true }) {
  const row = c.primary;
  // (as this cycle leaves them: the samples whose press was read again are drawn as revised, before they are written)
  const revised = new Map((c.revised || []).map((r) => [`${r.t}|${r.res}`, r]));
  const stored = c.met ? [] : H.rawSeries(db, c.id, 0, t - 1).map((r) => H.sampleOfRow(revised.get(`${r.t}|${r.res}`) || r));
  const series = [...c.backfilled.map(H.sampleOfRow), ...stored, c.series[c.series.length - 1]];
  const graph = graphOf(series, { t, startedAt: c.next.startedPrecision === 'hour' ? c.next.startedAt : null, peaked, peakAt: c.next.peakAt, firstObserved: c.firstObserved,
    line: c.line || { kind: c.kind }, joinQuiet: M.windowOf(c.kind) });
  const saved = c.met ? [] : db.prepare('SELECT at, kind, precision, text FROM events WHERE trend_id = ?').all(c.id);
  // (the start is one: this cycle's, told by its own headline where an earlier cycle or this one could; its turns are this cycle's)
  const startNow = c.events.find((e) => e.kind === 'start');
  const start = startNow && H.STOCK_START.has(startNow.text) ? saved.find((e) => e.kind === 'start' && e.at === startNow.at && !H.STOCK_START.has(e.text)) || startNow : startNow;
  const turnsNow = c.events.some((e) => e.kind === 'turn');
  // (a chapter saved by an earlier cycle that does not name the row's subject is not the row's: reviewers, 2026-10-12, a concert
  // cancelled at Ravenmoor in the timeline of "Koro Fenniss criticism")
  const kept = saved.filter((e) => e.kind !== 'peak' && !(e.kind === 'start' && start) && !(e.kind === 'turn' && turnsNow))
    .filter((e) => e.kind !== 'chapter' || row.type !== 'point' || row.wordish || SG.ownChapter(row, e.text));
  const fresh = c.events.filter((e) => e.kind !== 'start' && (e.kind === 'turn' || !saved.some((s) => s.at === e.at && s.kind === e.kind)));
  // (the peak: this cycle's alone, and only where the graph rings one. A peak an earlier cycle wrote is not shown on a row that is
  // rising again or tagged Early, nor at a time the peak has since left: C5. Reviewers, 2026-10-12: "Rising · Early" over
  // "Interest peaks.")
  const peakNow = peaked && graph && graph.peak !== null ? peakEventOf(c, graph, t) : null;
  const events = [...kept, ...(start ? [start] : []), ...fresh, ...(peakNow !== null ? [{ at: peakNow, kind: 'peak', precision: 'hour', text: 'Interest peaks.' }] : [])];
  const observedAt = graph ? Date.parse(graph.t0) / 1000 + graph.observedFrom * graph.stepMinutes * 60 : null;
  const told = H.timelineOf(events, { startedAt: c.next.startedAt, until: t })
    // (a start nothing tells is not a line: the card's own row and the graph's caption already say when it started)
    .filter((e) => !H.isStock(e))
    // (a measured fact is never dated inside the stretch the graph draws as rebuilt)
    .filter((e) => e.kind !== 'measure' || observedAt === null || e.at >= observedAt)
    // (a date and no hour: the one file every audience reads dates it at noon UTC of its day, the same calendar day on nearly every
    // phone. Google News dates a week-old headline at midnight Pacific, 07:00Z, which is the evening before in Alaska and Hawaii)
    .map((e) => (e.precision === 'day' ? { ...e, at: Math.min(Math.floor(e.at / DAY) * DAY + 12 * HOUR, t) } : e))
    .sort((x, y) => x.at - y.at || (x.kind === 'start' ? -1 : y.kind === 'start' ? 1 : 0))
    // (a site's own tag after its mark is no part of a sentence, whenever the entry was saved: "... ᐉ News from Fakti.bg - Curious.")
    .map((e) => ({ at: instant(e.at), precision: e.precision, text: cutText(String(e.text).replace(/\s*[ᐉ►▶»›⟶➤➜]\s.*$/u, '.').replace(/\.\.$/, '.'), 120), kind: e.kind }));
  // (how a story unfolded takes two things that happened: one line, or a start and "Interest peaks.", is no timeline)
  const timeline = told.filter((e) => e.text !== 'Interest peaks.').length >= 2 ? told : [];
  const src = row.type === 'word' ? row.word : row.type === 'moment' ? row.moment : row.point;
  // (a clip chart or a social site reported nothing: never a source to name under "Reported by")
  const sources = [...new Set((src.sources || []).filter((s) => typeof s === 'string' && s.trim()).map(sourceName).filter(Boolean).map((s) => cutText(s, 60)))].slice(0, 6);
  // (the sheet's own fields, D4 as of 2026-10-18: the posts the collector linked, the related searches, where it was seen. Each only when there is one)
  const about = D.aboutOf(row, roster);
  // (a post's title and a related search are held to the same rule: nobody the row's own sources never print is named by either)
  const heads = D.headlinesOf(row);
  const posts = SHEET.postsOf(row, t, { people: about.people, tags: about.tags, heads });
  const rel = SHEET.relatedOf(row, related, { audience: row.audience || 'US', people: about.people, tags: about.tags, heads });
  const spread = SHEET.spreadOf(c.info && c.info.seen, t);
  // (why it is hot: the editor's why first, the story's newest development held to the claim check (P7), unless the row's own line
  // already says it: in so many words, or with a hedge moved or a quote mark dropped (WHY_TOLD_SHARE of its words); then the measured
  // reasons, the demand first. And the angles: what a creator could film, P7, each its instruction alone where the line and the why
  // lines above it already tell its fact: reviewers, 2026-10-20, one allegation three times on one sheet)
  const whyNow = ideas && typeof ideas.why === 'string' && ideas.why && !` ${keyOf(line)} `.includes(` ${keyOf(ideas.why)} `) && IDEAS.toldShare(ideas.why, [line]) < IDEAS.WHY_TOLD_SHARE ? [ideas.why] : [];
  const why = [...whyNow, ...D.whyOf(row, 'mixed')].map((w) => cutText(w, 160)).slice(0, V.LIMITS.why);
  // (and one fact once: a react and a take on the same firing are one video, and of those only telling the line's own fact the first)
  const angles = IDEAS.printedAngles(ideas && Array.isArray(ideas.angles) ? ideas.angles : [], [line, ...why])
    .filter((a) => a.text.length <= V.LIMITS.angleText && V.ANGLE_KINDS.includes(a.kind)).slice(0, V.LIMITS.angles);
  // (the other rows of the list that name the same person, work or sound, and an earlier story of its people: P14, lib/entity)
  const shown = { graph, timeline, why, sources, ...(posts.length ? { posts } : {}), ...(rel.length ? { related: rel } : {}), ...(relatedRows.length ? { relatedRows } : {}),
    ...(spread.length ? { spread } : {}), ...(angles.length ? { angles } : {}) };
  // (how big it got over its life, D4 `size`, from what the size step keeps in the state and in the room the 6 KB leaves: lib/size/detail.js)
  // (not for an extension row, size false: the size step plans the rows whose details asked, and an extension row asks for nothing)
  const body = { ...shown, ...(size ? SIZE.part(db, c, { t, generatedAt, about, shown }) : {}) };
  const rev = hashHex(minify(body), 6);
  return { schemaVersion: SCHEMA_VERSION, id: c.id, rev, generatedAt: instant(generatedAt), ...body };
}

/** When a graph's ring stands (epoch seconds), or null for a graph that rings none. */
const ringAt = (graph) => (graph && graph.peak !== null && graph.peak !== undefined ? Date.parse(graph.t0) / 1000 + graph.peak * graph.stepMinutes * 60 : null);
/**
 * The one peak a row shows (C5): the time the list sends, the day the graph's ring stands on and the timeline's "Interest peaks."
 * are one. With a graph: its ring (the trend's own peak time when that falls on the ring's step, else the step itself); a graph
 * that rings none sends none. Without a graph: the trend's own, unless it falls in the first window of watching a trend met late.
 */
function peakShown(c, graph, { t, status }) {
  const own = M.peakToSend(status, c.next.peakAt, t);
  if (own === null) return null;
  if (!graph) return H.atJoin(c, own) ? null : own;
  const ring = ringAt(graph);
  if (ring === null) return null;
  const step = graph.stepMinutes * 60;
  return Math.abs(own - ring) <= step ? own : Math.min(ring, t);
}
/** When "Interest peaks." is dated: where the ring stands, on a row that has left rising and is not Early, and only where the collector was watching. */
function peakEventOf(c, graph, t) {
  if (Object.values(c.early || {}).some(Boolean)) return null;
  const at = peakShown(c, graph, { t, status: c.status });
  return at !== null && c.firstObserved !== null && at >= c.firstObserved && !H.atJoin(c, at) ? at : null;
}

/** Whether a line only says its title again: the same words, or the title's (cut or whole) and nothing before them. */
function saidAgain(title, line) {
  const key = (s) => String(s || '').replace(/…$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const [a, b] = [key(title), key(line)];
  if (!a || !b) return false;
  if (a === b || a.startsWith(`${b} `)) return true;
  if (!b.startsWith(`${a} `)) return false;
  // (a line that goes on from its title says it again only when the title was cut from it or it adds a word or two: a short title the
  // line goes on to tell, "<name> firing" over "<name> firing case: court remands four accused ...", or a bare name over its story, is
  // the card's whole story. Rows of a live top 40 showed no line for this)
  return /…$/.test(String(title).trim()) || b.split(' ').length - a.split(' ').length <= SAID_AGAIN_EXTRA;
}
const SAID_AGAIN_EXTRA = 2;
const SOUND_ID = /^\d{5,25}$/;
const SOUND_SLUG = /^[A-Za-z0-9-]{1,80}$/;
/**
 * A sound row's count as a chart gives it (K7): { sound: { id, slug, videos, videosToday, asOf } }, each part only when it reads;
 * nothing for any other row, or a sound with no part that reads. The one count of videos a row ever shows: never a `demand`.
 */
function soundOf(row, t) {
  const s = row.kind === 'sound' && row.platform ? row.platform.sound : null;
  if (!s) return {};
  const out = {};
  if (SOUND_ID.test(String(s.id || ''))) out.id = String(s.id);
  if (SOUND_SLUG.test(String(s.slug || ''))) out.slug = String(s.slug);
  if (Number.isInteger(s.videos) && s.videos >= 0) out.videos = s.videos;
  if (Number.isInteger(s.videosToday) && Number.isInteger(s.videos)) out.videosToday = s.videosToday;
  if (Number.isFinite(s.asOf) && s.asOf <= t && (out.videos !== undefined)) out.asOf = instant(s.asOf);
  return Object.keys(out).length ? { sound: out } : {};
}
/** One row of one audience's list (D3 Item), without its rank and urgency (the list sets those once its order is final). */
function itemOf(row, c, audience, { t, roster, detail, textAt }) {
  const isEarly = !!c.early[audience];
  // (one-way, at publish time: a row whose own outlet headline is inside the last twelve hours never prints "fading": `toldNow`.
  // The list's loop lifts the badge once it has the graph the row is held to and says so (`c.told`); a caller that hands a state's
  // "fading" straight here is read by the same rule)
  const lifted = !isEarly && (c.told === true || (c.status === 'fading' && toldNow(row, t, detail)));
  // (and the other way: a "peaking" no rule measured, the word a row told again by its own items or the engine's one snapshot gave
  // it, prints "fading" where the row's own graph has collapsed under an old peak: the badge never says what the graph denies)
  const graphDenies = !isEarly && c.status === 'peaking' && c.statusOwn === false && V.statusAgainstGraph({ status: 'peaking' }, detail).length > 0;
  const status = isEarly ? 'rising' : lifted ? 'peaking' : graphDenies ? 'fading' : c.status;
  const started = startFor(c.next, audience, t);
  const grim = c.grim;
  const about = D.aboutOf(row, roster);
  const homeSearch = D.homeSearchOf(row, audience);
  const peakAt = peakShown(c, detail ? detail.graph : null, { t, status });
  const timeLeft = isEarly || row.kind !== 'talk' || started.startedAt === null ? null : c.timeLeftHours;
  // (a line that is its own title said again is no line: the card would say one sentence twice. Whoever wrote it)
  const title = cutText(row.title, TITLE_MAX);
  const line = row.line && !saidAgain(title, row.line) ? cutText(row.line, LINE_MAX) : null;
  const sub = D.subOf(row);
  const tier = row.kind === 'talk' && row.tier ? row.tier : null;
  const topics = D.topicsOf(row, about);
  const item = {
    id: c.id,
    keys: ID.withKey(c.info.keys, row.cardKey),
    kind: row.kind,
    sub,
    title,
    line,
    // (G: "model" only for a line the claim check passed, lib/line-writer.js; everything else is a headline's)
    lineWrittenBy: line && row.lineWrittenBy === 'model' ? 'model' : 'headline',
    status,
    // (false: no rule of the collector's own gave the status, it is the engine's word off one snapshot, and the phone shows no heat
    // word for it. An Early row's "rising" is the tag's own evidence: C3)
    statusMeasured: isEarly || (!lifted && c.statusOwn !== false),
    isEarly,
    startedAt: instantOrNull(started.startedAt),
    ...(started.startedAt !== null ? { startedPrecision: started.startedPrecision } : {}),
    peakAt: peakAt !== null && (started.startedAt === null || peakAt >= started.startedAt) ? instant(peakAt) : null,
    timeLeftHours: timeLeft ?? null,
    heat: Math.min(100, Math.max(0, Math.round(row.heat))),
    demand: D.demandOf(row, audience),
    rank: 0,
    filmWithin24h: false,
    spike: M.isSpike({ t, measured: c.statusMeasured, status, startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, grim, early: isEarly, homeSearch, kinds: c.kinds, risingNow: c.risingNow !== false }),
    // (a follower is told "is taking off" only on a rising the collector read for itself, never on the engine's word)
    flareAt: isEarly || c.statusOwn !== false ? instantOrNull(M.flareOf({ t, status, grim, startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, chapterAt: c.next.chapterAt, earlyAt: c.next.earlyAt })) : null,
    ...(row.drama ? { drama: true } : {}),
    ...(tier ? { tier } : {}),
    people: about.people,
    topics,
    // (the ones For you may rank by: K1)
    topicsSure: SURE.sureOf({ kind: row.kind, sub, drama: !!row.drama, tier, title, line, topics }, { headlines: D.headlinesOf(row), rosterRoles: D.rosterRolesOf(about.people, roster) }),
    tags: about.tags,
    ...(about.topic ? { topic: about.topic } : {}),
    ...soundOf(row, t),
    ...D.sensitiveOf(row),
    examples: D.examplesOf(row),
    idea: D.ideaOf(row),
    detailRev: detail ? detail.rev : 'none',
    ...(Number.isFinite(textAt) ? { updatedAt: instant(textAt) } : {}),
    // (P4: the editor model's judgments of this card, each with the sentence it rests on. Advice, never shown: lib/editor/gate.js)
    ...(row.editor && typeof row.editor === 'object' ? { editor: row.editor } : {}),
  };
  // (what the list ranks urgency by, kept off the published row)
  const urgent = M.urgentCandidate({ t, measured: c.statusMeasured, status, startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, grim, early: isEarly, timeLeftHours: item.timeLeftHours, risingNow: c.risingNow !== false });
  return { item, urgent: urgent ? (c.measure.v || 0) * item.heat : null };
}

/**
 * The page with its Early rows spliced in (C3): at most three, at rows 4, 9 and 14, the strongest first; the page's last rows move
 * to "Show more", passing over a people-drama row while the page holds 12 of them or fewer (a page short of stories keeps the ones it
 * has: 2026-10-27, a GB page the sink left at 11 sent its two last stories, a court sentence of the day among them, under the page
 * for undated chart sounds); and over its twelve, the row that leaves is the last of the people-drama, never one of the things to
 * film (an Early creator's story takes a story's row: judges, 2026-10-12, the week's meme left the page for a thirteenth story).
 * rows: the engine's order (its page rules already applied); early: the Early rows, strongest first. Returns the new order.
 */
function spliceEarly(rows, early, pageSize = PAGE_SIZE) {
  const lift = early.slice(0, EARLY_ROWS.length);
  if (!lift.length) return rows;
  const lifted = new Set(lift);
  // (an Early row past the three lifted ones never stands on the page, its tag kept: the list's own check allows three there
  // (samples/validate.cjs earlyOnPage), so one the engine ranked inside the twenty waits at the head of "Show more". A fourth Early
  // row inside the twenty once refused a whole list)
  const extra = new Set(early.slice(EARLY_ROWS.length));
  const rest = rows.filter((r) => !lifted.has(r));
  const page = [];
  const waiting = [];
  let next = 0;
  for (; next < rest.length && page.length < pageSize; next++) (extra.has(rest[next]) ? waiting : page).push(rest[next]);
  const more = [...waiting, ...rest.slice(next)];
  lift.forEach((r, i) => { page.splice(Math.min(EARLY_ROWS[i] - 1, page.length), 0, r); });
  const out = [];
  while (page.length > pageSize) {
    const dramas = page.filter((r) => r.drama).length;
    const leaves = (r) => !lifted.has(r) && (dramas > DRAMA_ON_PAGE ? !!r.drama : !r.drama);
    let at = page.length - 1;
    while (at >= 0 && !leaves(page[at])) at -= 1;
    if (at < 0) { at = page.length - 1; while (at >= 0 && lifted.has(page[at])) at -= 1; }
    if (at < 0) at = page.length - 1;
    out.unshift(page.splice(at, 1)[0]);
  }
  return [...page, ...out, ...more];
}
/** The list's rows with every Early row inside its `max` (C3, 2026-10-18: the Early chip is never empty while Early rows exist; one the engine ranked below the eighty is lifted into the last rows). */
function keepEarly(rows, early, max = MAIN_ROWS) {
  const tail = rows.slice(max).filter((r) => early.has(r));
  return (tail.length ? [...rows.slice(0, max - tail.length), ...tail] : rows).slice(0, max);
}
/** The Early rows of a list, strongest first: more kinds of source, then the higher velocity, then a creators' story. */
const earlyOrder = (rows, cycleOf) => rows.map((r, i) => ({ r, i, c: cycleOf(r) })).sort((a, b) => M.kindCount(b.c.info.kindFirst) - M.kindCount(a.c.info.kindFirst) ||
  (b.c.measure.v || 0) - (a.c.measure.v || 0) || Number(b.r.tier === 'creator') - Number(a.r.tier === 'creator') || a.i - b.i).map((x) => x.r);

/**
 * Every audience's list, the details and the bundles of one cycle.
 * input: { t (slot), generatedAt, cycle (history.step), rowsByAudience, roster, db, sourcesAt, nextExpectedAt, stale: [source ids],
 *   related: (trend key) => Google Trends' related queries of that entry, as the store holds them (lib/sheet.js relatedOf), or null }.
 * Returns { lists: { audience: list }, details: Map(id -> detail), bundles: { audience: bundle }, published: Map(id -> what history
 * writes of it), dropped: { audience: [{ title, problems }] }, problems: { audience: [list problems] } }.
 */
function build({ t, generatedAt, cycle, rowsByAudience, roster, db, sourcesAt, nextExpectedAt, stale = [], related = null, extension = false, earlyScore = null }) {
  const lists = {};
  const bundles = {};
  const dropped = {};
  const problems = {};
  const details = new Map();
  const published = new Map();
  const lastText = db.prepare('SELECT t, title, line FROM texts WHERE trend_id = ? ORDER BY t DESC LIMIT 1');
  // (the entity graph, once for every audience, as a detail is: P14, lib/entity. One that fails leaves the details without the field)
  // (of the main rows alone: an extension row never becomes a main row's related row, so the main list's details are as before)
  const mainOf = (rows) => (rows || []).filter((r) => !EXT.isExt(r));
  const entity = ENTITY.forCycle({ t, db, rowsByAudience: Object.fromEntries(Object.entries(rowsByAudience).map(([a, rows]) => [a, mainOf(rows)])), has: (id) => cycle.trends.has(id), roster, related, titleOf: (row) => cutText(row.title, TITLE_MAX) });
  // (the extension's freshness budget: lib/extension.js)
  const budget = extension ? EXT.budgetOf({ t, cycleOf: (r) => cycle.trends.get(r.id) || null }) : null;
  const detailFor = (c, peaked, row = null) => {
    if (!details.has(c.id)) {
      const d = detailOf(c, { t, generatedAt, db, peaked, related, roster, ideas: row && row.editorIdeas ? row.editorIdeas : null, line: row ? row.line : null, relatedRows: entity.relatedOf(c.id), size: !EXT.isExt(row) });
      const bad = V.validateDetail(d, { bytes: Buffer.byteLength(minify(d)), name: `d/${c.id}` });
      // (a detail that fails is not written: the sheet stands without one, E2)
      details.set(c.id, bad.length ? null : d);
    }
    return details.get(c.id);
  };
  const generated = instant(generatedAt);
  for (const audience of AUDIENCES) {
    const every = (rowsByAudience[audience] || []).filter((r) => r.id && cycle.trends.has(r.id));
    // (the main rows; the extension's rows, with their sections, only when it is on)
    const all = every.filter((r) => !EXT.isExt(r));
    const extRows = extension ? every.filter(EXT.isExt) : [];
    // (the main rows by id: a row the layout listed under `more` is one of these, given back as itself when the list is laid out again)
    const mainById = new Map(all.map((r) => [r.id, r]));
    if (!all.length) continue;
    const cycleOf = (r) => cycle.trends.get(r.id);
    // at most 12 Early rows in a list: the strongest keep the tag
    const earlyHand = earlyOrder(all.filter((r) => cycleOf(r).early[audience]), cycleOf);
    // (IDEAS_PRECURSOR=act: the same Early rows, ordered by the precursor's score; lib/precursor orderEarly)
    const earlyAll = earlyScore ? PRE.orderEarly(earlyHand, (r) => earlyScore(audience, r.id)) : earlyHand;
    const early = new Set(earlyAll.slice(0, EARLY_IN_LIST));
    // (the main list laid out as ever, at most MAIN_ROWS; then, with the extension on, its rows after them: the extension's sections
    // and the main rows the layout left past its 80, `more`. lib/extension.js extend)
    const layout = (main, ext, lift) => {
      const spliced = spliceEarly(main, lift);
      const kept = keepEarly(spliced, early);
      if (!extension) return kept;
      const past = spliced.filter((r) => !kept.includes(r));
      return EXT.extend(kept, ext, { more: past, budget, max: ROWS_MAX });
    };
    let ordered = layout(all, extRows, earlyAll.slice(0, EARLY_IN_LIST));
    dropped[audience] = [];
    let items = [];
    // one bad row never holds the list back: it is left out and the rest ranked again
    for (let pass = 0; pass < 5; pass++) {
      // (and never a fourth Early row on the page, however short the list: one that a list too short to hold its page and its waiting
      // Early rows leaves inside the twenty keeps its row and loses the tag, so the list passes its own check, samples/validate.cjs)
      const overPage = new Set(ordered.slice(0, PAGE_SIZE).filter((row) => early.has(row)).slice(EARLY_ROWS.length));
      const built = ordered.map((row) => {
        const c = cycleOf(row);
        // (an extension row is never Early: lib/extension.js)
        const cTagged = early.has(row) && !overPage.has(row) && !EXT.isExt(row) ? c : { ...c, early: { ...c.early, [audience]: false } };
        const status = cTagged.early[audience] ? 'rising' : c.status;
        const detail = detailFor(c, M.peakToSend(status, c.next.peakAt, t) !== null, row);
        // (and the badge is held to the graph as published: lib/history.js reads the same line, this is the last word)
        // (one way, at publish time: a row with an outlet headline of its own inside the last twelve hours never prints "fading",
        // whatever its line's shape or its state says: `toldNow`. The printed badge alone is held, and prints unmeasured)
        const byGraph = statusByGraph(status, detail && detail.graph, { t, kind: row.kind });
        const told = byGraph === 'fading' && !cTagged.early[audience] && toldNow(row, t, detail);
        const shown = told ? 'peaking' : byGraph;
        const old = c.met ? null : lastText.get(c.id);
        const textAt = old && old.title === row.title && (old.line || null) === (row.line || null) ? old.t : t;
        const made = itemOf(row, shown === c.status && !told ? cTagged : { ...cTagged, status: shown, told, timeLeftHours: shown === 'fading' && c.status !== 'fading' ? null : cTagged.timeLeftHours }, audience, { t, roster, detail, textAt });
        // (an extension row says its section, and hurries nobody: never filmWithin24h, below)
        return { row, c, ...(EXT.isExt(row) ? { item: { ...made.item, section: row.section }, urgent: null } : made) };
      });
      built.forEach((b, i) => { b.item.rank = i + 1; });
      const urgent = new Set(built.filter((b) => b.urgent !== null).sort((a, b) => b.urgent - a.urgent).slice(0, M.K.URGENT_MAX).map((b) => b.item.id));
      for (const b of built) b.item.filmWithin24h = urgent.has(b.item.id);
      const bad = built.map((b, i) => ({ b, found: V.validateRow(b.item, i, generated) })).filter((x) => x.found.length);
      items = built;
      if (!bad.length) break;
      for (const x of bad) dropped[audience].push({ title: x.b.item.title, problems: x.found });
      const out = new Set(bad.map((x) => x.b.row));
      // (spliced again: a row left out above the page never lifts a waiting Early row into it. spliceEarly gives a spliced order back unchanged)
      // (the main rows as laid out, as before; the extension's after them. By id: a main row the layout listed under `more` is a copy
      // of itself, and one id is one row of a list)
      // (and a main row the layout listed under `more` is a main row again, so the row left out is refilled from below and the main
      // list keeps its 80; until 2026-10-29 the `more` copies stayed in the extension and a section row took rank 80 on every list)
      const outIds = new Set([...out].map((r) => r.id));
      const left = ordered.filter((r) => !outIds.has(r.id));
      ordered = layout(left.filter((r) => mainById.has(r.id)).map((r) => mainById.get(r.id)), left.filter((r) => !mainById.has(r.id)), earlyAll.slice(0, EARLY_IN_LIST).filter((r) => !outIds.has(r.id)));
    }
    const header = { schemaVersion: SCHEMA_VERSION, audience, generatedAt: generated, ...(Number.isFinite(sourcesAt) ? { sourcesAt: instant(Math.min(sourcesAt, generatedAt)) } : {}),
      nextExpectedAt: instant(Math.max(nextExpectedAt, generatedAt + 60)), cycleMinutes: CYCLE_MINUTES, pageSize: PAGE_SIZE, ...(stale.length ? { health: { stale } } : {}) };
    // the lowest rows go to stay under 120 KB raw; with the extension, its lowest rows (the lowest section first) to stay under 240 KB.
    // (lib/extension.js trim: the main rows are trimmed exactly as before, by themselves)
    const list = EXT.trim(items.map((b) => b.item), { header, bytesOf: (l) => Buffer.byteLength(minify(l)), mainBytesMax: MAIN_BYTES_MAX, bytesMax: LIST_BYTES_MAX, minRows: V.LIMITS.minRows });
    items = items.filter((b) => list.items.includes(b.item));
    const mainCount = items.filter((b) => !b.item.section).length;
    problems[audience] = V.validateList(list, { bytes: Buffer.byteLength(minify(list)), audience });
    lists[audience] = list;
    for (const b of items) {
      // (the line as published: the written one where a row has one, lib/line-writer.js)
      const p = published.get(b.item.id) || { ranks: {}, heats: {}, early: false, onPage: false, title: b.row.title || b.c.primary.title, line: b.row.line ?? b.c.primary.line, lineWrittenBy: b.item.lineWrittenBy, sub: b.item.sub,
        peakEventAt: details.get(b.item.id) ? peakEventOf(b.c, details.get(b.item.id).graph, t) : H.peakEventAt(b.c, t) };
      // (an extension row is recorded at MAIN_ROWS + its place in the extension, whatever the main list's length: lib/extension.js
      // historyRank. The scoreboard's listDepth 80 never counts it)
      p.ranks[audience] = EXT.historyRank(b.item, mainCount);
      p.heats[audience] = b.item.heat;
      p.early = p.early || b.item.isEarly;
      p.onPage = p.onPage || (b.item.rank <= PAGE_SIZE && !b.item.section);
      published.set(b.item.id, p);
    }
    // the bundle: the details of the first 30 rows and of the Early rows, 150 KB at most
    const wanted = items.filter((b) => !b.item.section && (b.item.rank <= BUNDLE_ROWS || b.item.isEarly)).map((b) => details.get(b.item.id)).filter(Boolean);
    let bundle = { schemaVersion: SCHEMA_VERSION, audience, generatedAt: generated, details: wanted };
    while (bundle.details.length && Buffer.byteLength(minify(bundle)) > BUNDLE_BYTES_MAX) bundle = { ...bundle, details: bundle.details.slice(0, -1) };
    bundles[audience] = bundle;
  }
  for (const [id, d] of [...details]) if (!d || !published.has(id)) details.delete(id);
  // (entity: the graph's counts and timings, for the cycle's log; never a name)
  return { lists, details, bundles, published, dropped, problems, entity: entity.stats };
}

module.exports = { soundOf, OUTLET_BY_DOMAIN, build, itemOf, detailOf, graphOf, saidAgain, peakIndex, peakShown, peakEventOf, statusByGraph, toldInside, toldNow, TOLD_INSIDE, sourceName, spliceEarly, keepEarly, earlyOrder, startFor, cutText, outletName, SCHEMA_VERSION, PAGE_SIZE, ROWS_MAX, MAIN_ROWS, LIST_BYTES_MAX, MAIN_BYTES_MAX, EARLY_ROWS };
