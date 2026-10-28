#!/usr/bin/env node
'use strict';
/*
 * The scoreboard at depth 150 (a shadow line beside v4; ios/.review plan section 3, "Scoreboard secondary metric"). Unhashed: this
 * file and its inline depth spec (DEPTH_SPEC, once depth-spec.json) are not among report.js SCORING_FILES, so the v4 hash (012e34e60c54) and its 14-day clock never move. It
 * runs after run.js in scoreboard.yml with run.js's own inputs and the same exported functions (ours.readState, metrics.scoreDay),
 * at listDepth 150 instead of 80, and writes one file of aggregate numbers, depth.json, which the guard below checks key by key.
 *
 *   node .github/scoreboard/depth.js --state <dir> --cache <dir> --out <dir> [--feed <v1/us.json>] [--ledger <ledger.jsonl>]
 *        [--now <ISO>] [--day <YYYY-MM-DD>]
 *   node .github/scoreboard/depth.js --slice-feed <v1/us.json> <out.json>    the list's main rows alone (no `section`): what run.js
 *        is handed, so the people an extension row names never reach v4 (scoreboard.yml, before "Score the day")
 *
 *   --cache   read only: run.js has already merged the day's reads into history.json and saved it; nothing here writes it
 *
 * depth.json (aggregate numbers only; never a title, a name, an address or a per-trend time):
 *   at150      lead (n, first, tie, late, median) and coverage (n, covered, first, via, stages) of each comparator at listDepth 150,
 *              and breadth over ranks 1-150 (the stories first listed that deep that day, shared or confirmed, over Google Trends'
 *              starts), as metrics.js computes them
 *   tailFirst  of the comparator entries covered at depth 150, those whose first listing was at ranks 81-150 (before any at 1-80)
 *   rows       the ledger's lines of the day: how many, the median and least rows, lines at 150 or more, lines under 120; the
 *              extension's rows by section (median a line) and its share started under 72 h (median), from `rowsExtension`/`extFresh`
 *   sections   the day's archived lists (09:00, 18:00) past the main list, per section: rows, rows checked a day on, live a day on
 *              (v4's kind-aware rule, metrics.liveAfter) and of them sounds, and the share started under 72 h
 *   check      v4At80: whether scoring at 80 gives the same numbers with the whole list as with its main rows alone (the extension
 *              moves nothing v4 counts); v4Hash: the hash of scoreboard-spec.json and the scoring files, as run.js computes it
 *   fivex      shadow, unregistered: the readouts a v5 spec would hold (lead share first at 80, breadth ratio at 150)
 *   meets      the depth targets of DEPTH_SPEC, each true or false (null when unmeasured)
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// (the scoreboard's own folder; SCOREBOARD_LIB points a copy kept elsewhere at it)
const LIB = process.env.SCOREBOARD_LIB || __dirname;
const R = require(path.join(LIB, 'report.js'));
const H = require(path.join(LIB, 'history.js'));
const { readState } = require(path.join(LIB, 'ours.js'));
const MX = require(path.join(LIB, 'metrics.js'));
const { addDays, dayOfSeconds, instant, median, share, round } = require(path.join(LIB, 'stats.js'));

const SPEC_FILE = path.join(LIB, 'scoreboard-spec.json');
// (the depth spec, inline: the publish's privacy scan admits .github/scoreboard/<name>.js files and scoreboard-spec.json only, so the
// spec that was depth-spec.json lives here; it is still no scoring file of report.js)
const DEPTH_SPEC = Object.freeze({
  "name": "yappal-ideas-depth",
  "version": 1,
  "registered": "2026-10-31",
  "rule": "Shadow, unhashed: depth.js and this file are not scoring files of report.js, so the v4 hash and its 14-day clock never move. Every number is computed by depth.js with v4's own functions (ours.readState, metrics.scoreDay, metrics.liveAfter) and v4's every value, except the list depth read (listDepth) and, for breadth at 150, the depth a story counts as reached. Lead is claimed only at depth 80 (v4); nothing here is a claim.",
  "listDepth": 150,
  "mainRows": 80,
  "freshHours": 72,
  "sections": [
    "justStarting",
    "stillSearched",
    "tonight",
    "charts",
    "games",
    "niche",
    "remembered",
    "rightNow",
    "rumours",
    "more"
  ],
  "targets": {
    "rowsLinesShare": 0.95,
    "rowsFloor": 120,
    "rowsUnder120LinesMax": 2,
    "extLive": 0.5,
    "soundLive": 0.6,
    "fresh": 0.6,
    "notListed": 0,
    "why": "Plan section 3: 150+ rows on 95% of ledger lines, never under 120 on 2 lines; extension rows live a day on 0.5 or more (sounds 0.6); started under 72 h 0.6 or more; Google Trends entries lost as notListed at depth 150: 0. rowsFloor and rowsUnder120LinesMax read per day."
  },
  "publish": "depth.json"
});
const HOUR = 3600;

class SafeError extends Error { constructor(message) { super(message); this.safe = true; } }

// ---------- the guard: report.js assertAggregate's rule, with the keys this file writes ----------
const ENUMS = new Set(['ok', 'insufficient', 'unmeasured', 'refused', 'unreadable', 'nolists', 'noledger', 'yappal-ideas-depth', 'shadow']);
const SHAPES = [/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, /^\d{4}-\d\d-\d\d$/, /^[0-9a-f]{12}$/, /^\d{4}$/];
const KEYS = new Set(['schema', 'name', 'version', 'spec', 'v4', 'depth', 'generatedAt', 'day', 'at', 'listDepth', 'mainRows', 'at150', 'lead', 'coverage', 'breadth',
  'gt', 'kym', 'viral50', 'x', 'n', 'first', 'tie', 'late', 'excluded', 'listedLate', 'medianHours', 'shareFirst', 'status', 'covered', 'via', 'share', 'firstShare',
  'stages', 'outside', 'notListed', 'readOnly', 'unseen', 'top', 'classed', 'pageStories', 'newStories', 'shared', 'onlyHere', 'onlyHereConfirmed', 'stories', 'gtStarts',
  'ratio', 'tailFirst', 'rows', 'lines', 'median', 'least', 'at150Lines', 'under120Lines', 'extension', 'fresh', 'sections', 'checked', 'live', 'sounds', 'soundsLive',
  'under72', 'check', 'v4At80', 'v4Hash', 'fivex', 'leadShareFirst80', 'breadthRatio150', 'meets', 'rowsLines', 'rowsFloor', 'extLive', 'soundLive', 'notListed150',
  'lists', 'mark', 'justStarting', 'stillSearched', 'tonight', 'charts', 'games', 'niche', 'remembered', 'rightNow', 'rumours', 'more']);

/** Throws unless every key and value of `doc` is aggregate (report.js's rule with this file's keys). Returns doc. */
function assertDepth(doc, where = 'depth') {
  const walk = (v, at) => {
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`not a finite number at ${at}`); return; }
    if (typeof v === 'string') { if (!ENUMS.has(v) && !SHAPES.some((re) => re.test(v))) throw new Error(`a free string at ${at}`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) { if (!KEYS.has(k)) throw new Error(`an unknown key at ${at}`); walk(x, `${at}.${k}`); }
      return;
    }
    throw new Error(`an unexpected value at ${at}`);
  };
  walk(doc, where);
  return doc;
}

// ---------- reading ----------
function parseArgs(argv) {
  if (argv[0] === '--slice-feed') {
    if (argv.length !== 3) throw new SafeError('usage: depth.js --slice-feed <v1/us.json> <out.json>');
    return { slice: { from: argv[1], to: argv[2] } };
  }
  const out = {};
  const names = { '--state': 'state', '--cache': 'cache', '--out': 'out', '--feed': 'feed', '--ledger': 'ledger', '--now': 'now', '--day': 'day' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (!names[flag]) throw new SafeError(`unknown argument ${flag}`);
    out[names[flag]] = inline !== undefined ? inline : argv[++i];
  }
  if (!out.state || !out.cache || !out.out) throw new SafeError('usage: depth.js --state <dir> --cache <dir> --out <dir> [--feed <file>] [--ledger <file>] [--now <ISO>] [--day <YYYY-MM-DD>]');
  if (out.now !== undefined && !Number.isFinite(Date.parse(out.now))) throw new SafeError('--now is not an instant');
  if (out.day !== undefined && !/^\d{4}-\d\d-\d\d$/.test(out.day)) throw new SafeError('--day is YYYY-MM-DD');
  return out;
}
const readText = (file) => { try { const b = fs.readFileSync(file); return (file.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8'); } catch { return null; } };
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.new`, text);
  fs.renameSync(`${file}.new`, file);
}
/** A list's main rows: those without a section (the extension's are after them). */
const mainItems = (items) => (items || []).filter((x) => x && x.section === undefined);
/** The list with its main rows alone (what run.js reads), or null when it does not read. */
function sliceFeed(text) {
  let list;
  try { list = JSON.parse(text); } catch { return null; }
  if (!list || !Array.isArray(list.items)) return null;
  const { sections, ...rest } = list;
  return { ...rest, items: mainItems(list.items) };
}

// ---------- the numbers ----------
/** The spec at another depth: v4's every value, the list read that deep (page: what breadth counts as reached). */
const atDepth = (spec, depth, page = spec.ours.page) => ({ ...spec, ours: { ...spec.ours, listDepth: depth, page } });

/** Lead and coverage of each comparator, as v4 publishes them (metrics.scoreDay's result), without anything per trend. */
const leadCoverage = (result) => ({ lead: result.lead, coverage: result.coverage });

/**
 * tailFirst: of each comparator's scope entries of the day covered at depth 150, how many were first listed at 81-150 (listed at
 * depth 150 before any listing at 1-80, or never at 1-80). ours80, ours150: readState at the two depths.
 */
function tailFirstOf({ day, now, spec, history, ours80, ours150 }) {
  const bounds = { start: Date.parse(`${day}T00:00:00Z`) / 1000, end: Date.parse(`${day}T00:00:00Z`) / 1000 + 86400 };
  const matched = MX.matchHistory(history, ours150, spec);
  const out = {};
  for (const c of MX.COMPARATORS) {
    const scope = MX.scopeOf(c, matched.get(c), history, bounds, spec);
    if (!scope) { out[c] = null; continue; }
    let n = 0;
    for (const r of scope) {
      const tr150 = r.match && ours150.trends.get(r.match.id);
      if (!tr150 || tr150.listed === null) continue;
      if (tr150.listed > r.anchor + spec.coverage.withinHours * HOUR || tr150.listed < r.anchor - spec.lead.window.days * 86400) continue;
      const tr80 = ours80.trends.get(r.match.id);
      if (!tr80 || tr80.listed === null || tr80.listed > tr150.listed) n += 1;
    }
    out[c] = n;
  }
  return out;
}

/** The ledger's lines of the day (by slot): rows, the extension's rows by section and its fresh share, medians. */
function rowsOf(ledger, day, depthSpec) {
  const lines = ledger.filter((l) => typeof l.slot === 'string' && l.slot.slice(0, 10) === day);
  const rows = lines.map((l) => l.rows).filter(Number.isFinite);
  if (!rows.length) return { lines: lines.length, status: 'noledger' };
  const ext = lines.map((l) => (l.rowsExtension && typeof l.rowsExtension === 'object' ? l.rowsExtension : null)).filter(Boolean);
  const sections = {};
  for (const k of depthSpec.sections) {
    const v = ext.map((e) => (Number.isFinite(e[k]) ? e[k] : 0));
    if (v.some((x) => x > 0)) sections[k] = round(median(v), 1);
  }
  const fresh = lines.map((l) => l.extFresh).filter(Number.isFinite);
  return { lines: lines.length, median: round(median(rows), 1), least: Math.min(...rows), at150Lines: rows.filter((x) => x >= depthSpec.listDepth).length,
    under120Lines: rows.filter((x) => x < depthSpec.targets.rowsFloor).length, extension: ext.length ? sections : null, fresh: fresh.length ? round(median(fresh), 3) : null, status: 'ok' };
}

/** Per section, the day's archived lists past the main list: rows, checked and live a day on (v4's rule), sounds and their live, under 72 h. */
function sectionsOf({ lists, ours, now, spec, history, depthSpec }) {
  const viral50 = history.comparators && history.comparators.viral50 ? history.comparators.viral50.entries || {} : null;
  const out = {};
  for (const l of lists) {
    const ext = l.items.filter((x) => x && typeof x.section === 'string' && depthSpec.sections.includes(x.section) && x.rank <= depthSpec.listDepth);
    for (const x of ext) {
      const s = out[x.section] || (out[x.section] = { rows: 0, checked: 0, live: 0, sounds: 0, soundsLive: 0, young: 0 });
      s.rows += 1;
      if (x.startedAt && l.t - Date.parse(x.startedAt) / 1000 < depthSpec.freshHours * HOUR) s.young += 1;
      const v = now >= l.t + spec.precision.live.toHours * HOUR ? MX.liveAfter(x, l.t, ours, spec, viral50) : null;
      if (!v) continue;
      s.checked += 1;
      if (v.v4) s.live += 1;
      if (v.group === 'sound') { s.sounds += 1; if (v.v4) s.soundsLive += 1; }
    }
  }
  for (const s of Object.values(out)) { s.under72 = share(s.young, s.rows); delete s.young; }
  return out;
}

/** The depth targets met, each true, false or null (unmeasured). */
function meetsOf(doc, depthSpec) {
  const t = depthSpec.targets;
  const r = doc.rows;
  const secs = Object.values(doc.sections || {});
  const checked = secs.reduce((a, s) => a + s.checked, 0);
  const live = secs.reduce((a, s) => a + s.live, 0);
  const sounds = secs.reduce((a, s) => a + s.sounds, 0);
  const soundsLive = secs.reduce((a, s) => a + s.soundsLive, 0);
  const rows = secs.reduce((a, s) => a + s.rows, 0);
  const young = secs.reduce((a, s) => a + s.under72 * s.rows, 0);
  const gtNotListed = doc.at150.coverage.gt && doc.at150.coverage.gt.stages ? doc.at150.coverage.gt.stages.notListed : null;
  return {
    rowsLines: r.status === 'ok' ? share(r.at150Lines, r.lines) >= t.rowsLinesShare : null,
    rowsFloor: r.status === 'ok' ? r.under120Lines < t.rowsUnder120LinesMax : null,
    extLive: checked ? share(live, checked) >= t.extLive : null,
    soundLive: sounds ? share(soundsLive, sounds) >= t.soundLive : null,
    fresh: rows ? share(young, rows) >= t.fresh : null,
    notListed150: Number.isFinite(gtNotListed) ? gtNotListed <= t.notListed : null,
  };
}

/** depth.json for the day: { doc } (aggregate, guarded). */
function depthDay({ day, now, spec, depthSpec, history, state, feedItems = [], ledger = [], hash }) {
  const depth = depthSpec.listDepth;
  // (v4 at 80, with the whole list and with its main rows alone: the same numbers, or the extension moved something v4 counts)
  const whole = readState(state, spec, { feedItems });
  let r80; let r80main;
  try { r80 = MX.scoreDay({ day, now, spec, history, ours: whole, ledger }).result; } finally { whole.close(); }
  const mainOnly = readState(state, spec, { feedItems: mainItems(feedItems) });
  let ours80;
  try { r80main = MX.scoreDay({ day, now, spec, history, ours: mainOnly, ledger }).result; ours80 = mainOnly; } catch (e) { mainOnly.close(); throw e; }
  // (at 150: lead and coverage read the list that deep; breadth counts a story reached at 150 as v4 counts page one)
  const deep = readState(state, atDepth(spec, depth, depth), { feedItems });
  try {
    const r150 = MX.scoreDay({ day, now, spec: atDepth(spec, depth, depth), history, ours: deep, ledger }).result;
    const pageOnes = readState(state, atDepth(spec, depth), { feedItems });
    let sections;
    try { sections = sectionsOf({ lists: pageOnes.lists.filter((l) => l.day === day), ours: pageOnes, now, spec, history, depthSpec }); } finally { pageOnes.close(); }
    const doc = {
      schema: 1, name: depthSpec.name, spec: { v4: hash, depth: depthSpec.version }, generatedAt: instant(now), day, listDepth: depth, mainRows: depthSpec.mainRows,
      at150: { ...leadCoverage(r150), breadth: r150.breadth },
      tailFirst: tailFirstOf({ day, now, spec: atDepth(spec, depth), history, ours80, ours150: deep }),
      rows: rowsOf(ledger, day, depthSpec),
      sections,
      check: { v4At80: JSON.stringify(r80) === JSON.stringify(r80main), v4Hash: hash },
      fivex: { status: 'shadow', leadShareFirst80: r80main.lead.gt ? r80main.lead.gt.shareFirst ?? null : null, breadthRatio150: r150.breadth ? r150.breadth.ratio ?? null : null },
    };
    return assertDepth({ ...doc, meets: meetsOf(doc, depthSpec) });
  } finally { deep.close(); ours80.close(); }
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.slice) {
    const list = sliceFeed(readText(opts.slice.from));
    if (!list) throw new SafeError('the feed did not read: nothing written');
    writeAtomic(opts.slice.to, JSON.stringify(list));
    process.stdout.write(`depth: the feed's main rows, ${list.items.length}\n`);
    return 0;
  }
  const spec = JSON.parse(fs.readFileSync(SPEC_FILE, 'utf8'));
  const depthSpec = DEPTH_SPEC;
  const hash = R.specHash(spec, R.scoringCode(LIB));
  const now = Math.floor((opts.now ? Date.parse(opts.now) : Date.now()) / 1000);
  const day = opts.day || addDays(dayOfSeconds(now), -spec.scoredDay.lagDays);
  if (!fs.existsSync(path.join(opts.state, 'collector.db'))) { process.stdout.write(`depth ${day}: no state to read: nothing scored\n`); return 3; }
  const history = H.fromText(readText(path.join(opts.cache, 'history.json')));
  let feedItems = [];
  if (opts.feed) { try { feedItems = JSON.parse(readText(opts.feed) || '{}').items || []; } catch { feedItems = []; } }
  const ledger = (opts.ledger ? readText(opts.ledger) || '' : '').split('\n').map((t) => { try { return t.trim() ? JSON.parse(t) : null; } catch { return null; } }).filter(Boolean);
  const doc = depthDay({ day, now, spec, depthSpec, history, state: opts.state, feedItems, ledger, hash });
  writeAtomic(path.join(opts.out, depthSpec.publish), `${JSON.stringify(doc, null, 1)}\n`);
  const g = doc.at150.coverage.gt || {};
  process.stdout.write(`depth ${day} (v4 ${hash}, depth spec ${depthSpec.version}): rows median ${doc.rows.median ?? '-'}; GT at 150 ${g.covered ?? '-'} of ${g.n ?? '-'}, notListed ${g.stages ? g.stages.notListed ?? '-' : '-'}; tail first ${doc.tailFirst.gt ?? '-'}; v4 at 80 the same: ${doc.check.v4At80}\n`);
  return 0;
}

module.exports = { assertDepth, sliceFeed, mainItems, atDepth, tailFirstOf, rowsOf, sectionsOf, meetsOf, depthDay, parseArgs, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    // (never the message of an error that is not this file's own: a parser's message can quote what it read)
    process.stderr.write(`depth: failed: ${e && e.safe ? e.message : (e && e.name) || 'error'}\n`);
    process.exitCode = 1;
  });
}
