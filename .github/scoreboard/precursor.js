#!/usr/bin/env node
'use strict';
/*
 * The precursor's daily step (2026-10-31, wave 9 lane precursor). Runs after the scoreboard (run.js) in its job, and on the VM after
 * the virality truth's job:
 *
 *   node precursor.js --state <collector state, read only> --cache <the scoreboard's cache dir> [--truth <verdicts.json>]
 *        [--log <dir>] [--weights-out <file>] [--now <ISO>]
 *
 * It reads the collector's private precursor log (<state>/precursor, or --log), the comparators' entries the scoreboard already holds
 * (its history.json: Google Trends US, Know Your Meme, the Viral 50) and the collector's own Google Trends reads of US, GB, AU and CA
 * (the state's store), joins them to the logged rows with the scoreboard's matcher (match.js, read only: its hash is untouched, this
 * file is not one of report.js SCORING_FILES), judges the day two days back at the hand rule's Early budget, refits, and keeps in
 * <cache>/precursor.json only counts and weights. Zero requests. Never a title, a name, an id or a per-row time in a file or a line.
 * --weights-out (the VM's private folder): the weights are written there only once the promotion rule holds.
 * Exit 0 always (a missing log or state is a line that says so): the scoreboard's own result never depends on this step.
 */
const fs = require('node:fs');
const path = require('node:path');

// (beside the scoreboard in the host repository, .github/scoreboard/, with the collector's lib two folders up; or in the collector's
// working tree, scoreboard-steps/, with the host checked out beside it)
const first = (xs) => xs.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
const SB = process.env.SCOREBOARD_DIR || first([__dirname, path.resolve(__dirname, '../../ideas-collector-host/.github/scoreboard')].map((d) => path.join(d, 'match.js')))?.replace(/match\.js$/, '');
const LIB = first([path.resolve(__dirname, '../../lib/precursor'), path.resolve(__dirname, '../lib/precursor')]);

const SCHEMA = 1;
const LAG_DAYS = 2;
const LOG_DAYS = 16;
const JUDGED_KEPT = 28;
const DAY = 86400;

function parseArgs(argv) {
  const out = {};
  const names = { '--state': 'state', '--cache': 'cache', '--truth': 'truth', '--log': 'log', '--weights-out': 'weightsOut', '--now': 'now' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (!names[flag]) throw new Error(`unknown argument ${flag}`);
    out[names[flag]] = inline !== undefined ? inline : argv[++i];
  }
  if (!out.cache || (!out.state && !out.log)) throw new Error('usage: precursor.js --state <dir> --cache <dir> [--truth <file>] [--log <dir>] [--weights-out <file>] [--now <ISO>]');
  return out;
}
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.new`, text);
  fs.renameSync(`${file}.new`, file);
}

/** The comparator entries to label with: [{ comparator, title, artist, related, own, volume, categories }]. */
function entriesOf({ history, store, truth, H }) {
  const out = [];
  for (const e of H.entriesOf(history, 'gt')) out.push({ comparator: 'gt', title: e.title, related: e.related || [], own: e.own, volume: e.volume, categories: e.categories || [] });
  for (const e of H.entriesOf(history, 'kym')) out.push({ comparator: 'kym', title: e.title, own: Number.isFinite(e.own) ? e.own : e.firstRead });
  for (const e of H.entriesOf(history, 'viral50')) out.push({ comparator: 'viral50', title: e.title, artist: e.artist || null, own: e.firstChartDay ? Date.parse(`${e.firstChartDay}T00:00:00Z`) / 1000 : e.firstRead });
  // (the collector's own reads of the four countries' lists: the store keeps each entry with its start, ms; one the scoreboard's
  // history already holds is not counted twice)
  const held = new Set(out.filter((e) => e.comparator === 'gt').map((e) => `${String(e.title).toLowerCase()}|${Math.floor((e.own || 0) / DAY)}`));
  for (const t of (store && store.talkTrends) || []) {
    if (!t || typeof t.keyword !== 'string' || !Number.isFinite(t.start)) continue;
    const own = Math.floor(t.start / 1000);
    const key = `${t.keyword.toLowerCase()}|${Math.floor(own / DAY)}`;
    if (held.has(key)) continue;
    held.add(key);
    out.push({ comparator: 'gt', title: t.keyword, related: t.related || [], own, volume: t.volume || 0, categories: t.cats || [] });
  }
  for (const v of truth || []) if (v && typeof v.title === 'string' && Number.isFinite(v.onset) && v.proven) out.push({ comparator: 'truth', title: v.title, own: v.onset });
  return out;
}

function main(argv, { log = (s) => console.log(s) } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (e) { log(`[precursor] ${e.message}`); return 2; }
  if (!SB || !LIB) { log('[precursor] the scoreboard or the collector\'s lib/precursor is not beside this file: nothing done'); return 0; }
  const M = require(path.join(SB, 'match.js'));
  const H = require(path.join(SB, 'history.js'));
  const { readState } = require(path.join(SB, 'ours.js'));
  const spec = readJson(path.join(SB, 'scoreboard-spec.json'), null);
  const LOG = require(path.join(LIB, 'log.js'));
  const R = require(path.join(LIB, 'refit.js'));
  const DAY0 = require(path.join(LIB, 'day0.json'));
  const now = args.now ? Math.floor(Date.parse(args.now) / 1000) : Math.floor(Date.now() / 1000);
  const day = R.dayOf(now - LAG_DAYS * DAY);
  const cacheFile = path.join(args.cache, 'precursor.json');
  const kept = readJson(cacheFile, null);
  const saved = kept && kept.schema === SCHEMA ? kept : { schema: SCHEMA, judged: [], weights: null, promoted: null };

  const dir = args.log || path.join(args.state, 'precursor');
  const records = LOG.read(dir, R.dayOf(now - LOG_DAYS * DAY), day);
  const rows = records.filter((r) => r && Array.isArray(r.x));
  if (!rows.length || !spec) { log(`[precursor] no log to learn from (${records.length} records through ${day}): nothing judged`); return 0; }

  // our side: the logged rows' titles and aliases as the scoreboard reads them (read only)
  let ours = null;
  try { ours = args.state && fs.existsSync(path.join(args.state, 'collector.db')) ? readState(args.state, spec) : null; } catch { ours = null; }
  const ids = new Set(rows.map((r) => r.id));
  const firstAt = new Map();
  for (const r of rows) if (!firstAt.has(r.id) || r.t < firstAt.get(r.id)) firstAt.set(r.id, r.t);
  const trends = ours ? [...ids].map((id) => ours.trends.get(id)).filter(Boolean).map((tr) => ({ ...tr, listed: firstAt.get(tr.id) ?? tr.listed })) : [];
  if (ours) ours.close();
  const index = M.prepareOurs(trends, spec);
  const history = H.fromText(fs.existsSync(path.join(args.cache, 'history.json')) ? fs.readFileSync(path.join(args.cache, 'history.json'), 'utf8') : '');
  const store = args.state ? readJson(path.join(args.state, 'engine', 'store.json'), null) : null;
  const truth = args.truth ? readJson(args.truth, []) : [];
  const entries = entriesOf({ history, store, truth: Array.isArray(truth) ? truth : truth.verdicts || [], H });
  const comparatorOf = (c) => (c === 'truth' ? 'gt' : c);
  const joins = R.joinsOf(entries, (e) => { const hit = M.matchEntry({ title: e.title, artist: e.artist || null, related: e.related || [], t: e.own }, comparatorOf(e.comparator), index); return hit && hit.id; });

  const examples = R.label(R.examplesOf(rows, R.LOGGED_NAMES), joins);
  const safe = R.safeNames(DAY0.names);
  const twin = R.project(DAY0, safe);
  const current = saved.weights && Array.isArray(saved.weights.names) ? saved.weights : twin;
  // judge the day two days back with the weights fitted before it (once a day)
  const judged = [...saved.judged];
  const ofDay = examples.filter((e) => e.day === day);
  if (ofDay.length && !judged.some((d) => d.day === day)) judged.push(R.judgeDay(day, ofDay, { refit: current, twin }));
  judged.sort((a, b) => (a.day < b.day ? -1 : 1));
  // refit on the settled days (labels read two days on), blended into the current weights
  const settled = examples.filter((e) => e.day <= day);
  // (once a day: a second run for the same day keeps the day's weights, so the 7-day blend is a blend of days, not of runs)
  const fit = saved.fittedThrough === day && saved.weights ? { model: saved.weights, fitted: false, n: settled.length } : R.refit(settled, { names: safe, prior: twin, previous: saved.weights || null });
  const promo = R.promotion(judged);
  const next = { schema: SCHEMA, judged: judged.slice(-JUDGED_KEPT), weights: fit.model, fittedThrough: fit.fitted ? day : saved.fittedThrough || null, promoted: promo.promote ? { day, gainLo: promo.gain.lo } : saved.promoted || null };
  writeAtomic(cacheFile, `${JSON.stringify(next)}\n`);
  if (promo.promote && args.weightsOut) writeAtomic(args.weightsOut, `${JSON.stringify(fit.model)}\n`);
  const d = judged.find((x) => x.day === day);
  const pos = examples.filter((e) => e.y).length;
  log(`[precursor] ${day}: ${d ? `budget ${d.budget}, first hand ${d.hand.first} / refit ${d.refit.first} / twin ${d.twin.first}; K8 positives refit ${d.k8.refit.pos}, twin ${d.k8.twin.pos}, list ${d.k8.list.pos}` : 'not judged (no examples that day)'}; ` +
    `examples ${examples.length} (${pos} labelled), joins ${joins.length}; refit ${fit.fitted ? 'fitted' : 'kept'} on ${fit.n}; promotion ${promo.why} (${promo.days} days, ${promo.positives} positives, ` +
    `lower bound ${promo.gain.lo ?? 'none'}); refit beat twin ${promo.refitBeatTwin} of ${promo.days} days`);
  return 0;
}

if (require.main === module) {
  let code = 0;
  try { code = main(process.argv.slice(2)); } catch (e) { console.log(`[precursor] not run: ${e.message}`); code = 0; }
  process.exitCode = code;
}
module.exports = { main, parseArgs, entriesOf, SCHEMA, LAG_DAYS };
