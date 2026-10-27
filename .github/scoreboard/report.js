'use strict';
/*
 * What the scoreboard branch holds (scoreboard-spec.json "publish"), and the guard that refuses anything else:
 *   days.jsonl   one line a scored day: that day's numbers, the 7 days pooled for lead (with a bootstrap 95% interval once n allows)
 *                and for breadth, what met its target, how each comparator read went; read back, the day's line replaced or appended,
 *                60 days kept
 *   latest.json  the newest line, 14 days rolled up, the targets, and the 3x claim's run of consecutive passing days
 * Aggregate numbers only. assertAggregate() walks every value: a key must be one of the keys this file writes, a string one of a
 * few fixed words or an instant, a day, a list mark or the spec's hash. A title, a name or an address can never pass it.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { round, share, median, mean, bootstrap, fnv1a, addDays } = require('./stats');

const ENUMS = new Set(['ok', 'insufficient', 'unmeasured', 'refused', 'unreadable', 'nolists', 'noledger', 'yappal-ideas-scoreboard']);
const STRING_SHAPES = [/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, /^\d{4}-\d\d-\d\d$/, /^[0-9a-f]{12}$/, /^\d{4}$/];
const KEYS = new Set(['schema', 'name', 'spec', 'version', 'hash', 'generatedAt', 'day', 'at', 'lead', 'pooled', 'coverage', 'breadth', 'precision',
  'speed', 'meets', 'reads', 'gt', 'kym', 'viral50', 'x', 'n', 'first', 'tie', 'late', 'excluded', 'listedLate', 'medianHours', 'shareFirst',
  'status', 'ci', 'shareFirstCi', 'days', 'covered', 'via', 'share', 'firstShare', 'pageStories', 'shared', 'onlyHere', 'onlyHereConfirmed',
  'stories', 'newStories', 'gtStarts', 'ratio', 'lists', 'gate', 'mark', 'rows', 'checked', 'live', 'fading', 'duplicates', 'old', 'runs', 'published',
  'failed', 'lagMedianMinutes', 'lagP90Minutes', 'meanAgeMinutes', 'ageCoveredShare', 'maxGapMinutes', 'probeN', 'probeMeanAgeMinutes',
  'latest', 'rolling', 'from', 'to', 'gateDays', 'checkedDays', 'targets', 'ciLowAbove', 'liveMin', 'duplicatesMax', 'fadingMax',
  'speedMeanAgeMinutes', 'claim', 'consecutiveDays', 'needed', 'holds', 'minN', 'matcher', 'audit', 'audited', 'wrong', 'rate',
  // (coverage's misses by stage, metrics.js coverageOf: counts only)
  'stages', 'outside', 'notListed', 'readOnly', 'unseen',
  // (v4: precision's kind-aware live beside v3's rule, by kind group; X's scope as classed by Google Trends: counts only)
  'liveV3', 'kinds', 'story', 'sound', 'word', 'top', 'classed']);

/** Throws unless every key and value of `doc` is aggregate (see above). Returns doc. */
function assertAggregate(doc, where = 'doc') {
  const walk = (v, at) => {
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`not a finite number at ${at}`); return; }
    if (typeof v === 'string') { if (!ENUMS.has(v) && !STRING_SHAPES.some((re) => re.test(v))) throw new Error(`a free string at ${at}`); return; }
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

/** The files whose code computes a published number: a change to any of them, as to the spec, restarts the clock (spec "rule"). */
const SCORING_FILES = ['comparators.js', 'history.js', 'match.js', 'metrics.js', 'ours.js', 'report.js', 'stats.js'];

/** The scoring code as { file: text }, read from the scoreboard's folder (default: this file's). */
const scoringCode = (dir = __dirname) => Object.fromEntries(SCORING_FILES.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

/**
 * The published hash: the first 12 hex of the sha256 of the spec's canonical JSON and of every scoring file's name and text, in a
 * fixed order. A change to any value of the spec or any line of that code changes it. code: { file: text } (scoringCode()).
 */
function specHash(spec, code) {
  if (!code || SCORING_FILES.some((f) => typeof code[f] !== 'string')) throw new Error('the hash needs the spec and every scoring file');
  const h = crypto.createHash('sha256').update(JSON.stringify(spec));
  for (const f of SCORING_FILES) h.update(`\0${f}\0${code[f]}`);
  return h.digest('hex').slice(0, 12);
}

/** Lead pooled over the spec's poolDays ending at `day`, same spec hash only: n, median, share first and their bootstrap intervals. */
function pooledLead(history, day, hash, comparator, spec) {
  const values = [];
  for (let i = 0; i < spec.lead.poolDays; i++) {
    const d = history.days[addDays(day, -i)];
    if (d && d.spec === hash && d.lead && Array.isArray(d.lead[comparator])) values.push(...d.lead[comparator]);
  }
  const n = values.length;
  if (n < spec.minN) return { n, days: spec.lead.poolDays, status: spec.insufficient, medianHours: null, shareFirst: null, ci: null, shareFirstCi: null };
  const hours = values.map((v) => v.h);
  const firsts = values.map((v) => (v.o === 'first' ? 1 : 0));
  const b = { ...spec.lead.bootstrap, seed: fnv1a(`${day}|${comparator}`) };
  const ci = bootstrap(hours, median, b);
  const sci = bootstrap(firsts, mean, b);
  return { n, days: spec.lead.poolDays, status: 'ok', medianHours: round(median(hours), 1), shareFirst: share(firsts.reduce((a, x) => a + x, 0), n),
    ci: ci && ci.map((x) => round(x, 1)), shareFirstCi: sci && sci.map((x) => round(x, 3)) };
}

/** Breadth pooled over the spec's poolDays ending at `day`, same spec hash only: stories over Google Trends starts, insufficient under minN starts. */
function pooledBreadth(history, day, hash, spec, days = spec.lead.poolDays) {
  let stories = 0; let gtStarts = 0; let counted = 0;
  for (let i = 0; i < days; i++) {
    const d = history.days[addDays(day, -i)];
    const b = d && d.spec === hash ? d.breadth : null;
    if (!b || !Number.isFinite(b.stories) || !Number.isFinite(b.gtStarts)) continue;
    stories += b.stories; gtStarts += b.gtStarts; counted += 1;
  }
  const ok = gtStarts >= spec.minN;
  return { days: counted, stories, gtStarts, ratio: ok ? round(stories / gtStarts, 2) : null, status: ok ? 'ok' : spec.insufficient };
}

/** What met its target on a day line: lead and breadth on their 7-day pools, coverage and speed on the day. */
function meetsOf(line, spec) {
  const t = spec.targets;
  const lead = Object.entries(t.lead).every(([c, g]) => {
    const p = line.pooled && line.pooled[c];
    return !!p && p.status === 'ok' && p.shareFirst >= g.shareFirst && p.medianHours >= g.medianHours && !!p.ci && p.ci[0] > g.ciLowAbove;
  });
  const coverage = {};
  for (const [c, g] of Object.entries(t.coverage)) {
    if (c === 'firstShare') continue;
    const v = line.coverage[c];
    coverage[c] = !!v && Number.isFinite(v.share) && v.share >= g && Number.isFinite(v.firstShare) && v.firstShare >= t.coverage.firstShare;
  }
  const pb = line.breadth && line.breadth.pooled;
  return { lead, breadth: !!pb && pb.status === 'ok' && Number.isFinite(pb.ratio) && pb.ratio >= t.breadth, precision: line.precision.gate === true,
    coverage, speed: Number.isFinite(line.speed.meanAgeMinutes) && line.speed.meanAgeMinutes <= t.speedMeanAgeMinutes };
}

/** The day's line. result: metrics.scoreDay's result; history: with the day's store already in it; reads: today's read statuses. */
function dayLine({ result, history, hash, at, reads, spec }) {
  const pooled = {};
  for (const c of Object.keys(result.lead)) pooled[c] = pooledLead(history, result.day, hash, c, spec);
  const breadth = { ...result.breadth, pooled: pooledBreadth(history, result.day, hash, spec) };
  const line = { day: result.day, spec: hash, at, lead: result.lead, pooled, coverage: result.coverage, breadth,
    precision: result.precision, speed: result.speed, reads };
  return assertAggregate({ ...line, meets: meetsOf(line, spec) }, 'line');
}

/** days.jsonl read back: its lines (only those that parse and pass the guard), oldest first. */
function readDays(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    try { const line = assertAggregate(JSON.parse(t), 'line'); if (/^\d{4}-\d\d-\d\d$/.test(line.day)) out.push(line); } catch { /* a line that does not pass is dropped */ }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** The day's line in place of any line of the same day, the newest daysKept kept. */
function withLine(lines, line, spec) {
  return [...lines.filter((l) => l.day !== line.day), line].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-spec.publish.daysKept);
}

/** Consecutive passing days ending at the newest line: same spec hash, calendar days without a gap, lead, breadth and precision met. */
function claimRun(lines, hash) {
  let run = 0;
  let expect = null;
  for (const l of [...lines].reverse()) {
    if (l.spec !== hash || (expect !== null && l.day !== expect)) break;
    if (!(l.meets && l.meets.lead && l.meets.breadth && l.meets.precision)) break;
    run += 1;
    expect = addDays(l.day, -1);
  }
  return run;
}

/**
 * The matcher's last hand-check (audit-result.json, written on the Mac by audit.js --record): { day, pairs, wrong, rate }, or null when
 * there is none or it is not exactly a day and two counts. Published as { day, audited (pairs checked), wrong, rate }.
 */
function auditOf(audit) {
  if (!audit || !/^\d{4}-\d\d-\d\d$/.test(audit.day) || !Number.isInteger(audit.pairs) || !Number.isInteger(audit.wrong) || audit.pairs < 1 || audit.wrong < 0 || audit.wrong > audit.pairs) return null;
  return { day: audit.day, audited: audit.pairs, wrong: audit.wrong, rate: share(audit.wrong, audit.pairs) };
}

/** Coverage's misses by stage summed over day lines' coverage of one comparator (a stage no day measured stays null). */
function stagesOf(rows) {
  const out = {};
  for (const k of STAGES) {
    const vs = rows.map((v) => v.stages && v.stages[k]).filter(Number.isFinite);
    out[k] = vs.length ? vs.reduce((a, x) => a + x, 0) : null;
  }
  return out;
}
const STAGES = ['listedLate', 'outside', 'notListed', 'readOnly', 'unseen'];

/** The checked lists of day lines summed: rows on page one, live (the gate's rule) and liveV3 (v3's rule beside it); a line before v4 has no liveV3 and adds none. */
function precisionSums(lines) {
  const ls = lines.flatMap((l) => (l.precision.lists || []).filter((x) => x.checked));
  const sum = (k) => ls.reduce((a, x) => a + (Number.isFinite(x[k]) ? x[k] : 0), 0);
  return { lists: ls.length, rows: sum('rows'), live: sum('live'), liveV3: sum('liveV3') };
}

/** latest.json: the newest line, the rolling window, the targets, the claim, the matcher's audited false-match rate. history gives the pooled 14-day lead. */
function latestOf({ lines, history, hash, at, spec, audit = null }) {
  const newest = lines[lines.length - 1];
  const window = lines.filter((l) => l.spec === hash && l.day > addDays(newest.day, -spec.publish.rollingDays));
  const lead = {};
  for (const c of Object.keys(newest.lead)) lead[c] = pooledLead(history, newest.day, hash, c, { ...spec, lead: { ...spec.lead, poolDays: spec.publish.rollingDays } });
  const coverage = {};
  for (const c of Object.keys(newest.coverage)) {
    const rows = window.map((l) => l.coverage[c]).filter((v) => v && Number.isFinite(v.n));
    const n = rows.reduce((a, v) => a + v.n, 0); const covered = rows.reduce((a, v) => a + v.covered, 0); const first = rows.reduce((a, v) => a + v.first, 0);
    const ok = n >= spec.minN;
    coverage[c] = { days: rows.length, n, covered, first, share: ok ? share(covered, n) : null, firstShare: ok ? share(first, covered) : null, status: ok ? 'ok' : spec.insufficient, stages: stagesOf(rows) };
  }
  const br = window.map((l) => l.breadth).filter((b) => Number.isFinite(b.gtStarts) && Number.isFinite(b.stories));
  const stories = br.reduce((a, b) => a + b.stories, 0); const gtStarts = br.reduce((a, b) => a + b.gtStarts, 0);
  const brOk = gtStarts >= spec.minN;
  const checked = window.filter((l) => l.precision.gate !== null);
  const sp = window.map((l) => l.speed).filter((s) => Number.isFinite(s.meanAgeMinutes));
  const t = spec.targets;
  const doc = {
    schema: 1, name: spec.name, spec: { version: spec.version, hash }, generatedAt: at, minN: spec.minN,
    matcher: { version: spec.matcher.version, audit: auditOf(audit) },
    latest: newest,
    rolling: { days: window.length, from: window.length ? window[0].day : null, to: newest.day, lead, coverage,
      breadth: { days: br.length, stories, gtStarts, ratio: brOk ? round(stories / gtStarts, 2) : null, status: brOk ? 'ok' : spec.insufficient },
      precision: { checkedDays: checked.length, gateDays: checked.filter((l) => l.precision.gate).length, ...precisionSums(checked) },
      speed: { days: sp.length, meanAgeMinutes: round(mean(sp.map((s) => s.meanAgeMinutes)), 1), lagMedianMinutes: round(median(sp.map((s) => s.lagMedianMinutes)), 1) } },
    targets: { lead: t.lead, coverage: t.coverage, breadth: t.breadth, precision: t.precision, speedMeanAgeMinutes: t.speedMeanAgeMinutes },
    claim: { consecutiveDays: claimRun(lines, hash), needed: t.claim.days, holds: claimRun(lines, hash) >= t.claim.days },
  };
  return assertAggregate(doc, 'latest');
}

module.exports = { precisionSums, stagesOf, STAGES, assertAggregate, SCORING_FILES, scoringCode, specHash, pooledLead, pooledBreadth, meetsOf, dayLine, readDays, withLine, claimRun, auditOf, latestOf, KEYS, ENUMS };

// node .github/scoreboard/report.js --check <file>...   the guard alone, on files about to be published (exit 1 on anything not aggregate)
if (require.main === module) {
  const files = process.argv.slice(2).filter((a) => a !== '--check');
  let bad = 0;
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      const docs = file.endsWith('.jsonl') ? text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [JSON.parse(text)];
      docs.forEach((d, i) => assertAggregate(d, `${file.split('/').pop()}#${i + 1}`));
    } catch (e) { bad += 1; process.stderr.write(`guard: ${file.split('/').pop()} refused (${e instanceof SyntaxError ? 'not JSON' : e.message})\n`); }
  }
  if (!bad) process.stdout.write(`guard: ${files.length} file(s) hold aggregate numbers only\n`);
  process.exitCode = bad ? 1 : 0;
}
