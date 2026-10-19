'use strict';
/*
 * The P6 back-test from the command line (ios/IDEAS-SUPER.md P6), on the Mac only: it reads saved Trends replies and, optionally, a
 * COPY of a collector.db, and prints aggregate numbers. Nothing per trend is printed or written.
 *
 *   node lib/forecast/run.js --snaps <folder> [--snaps <folder> ...] [--db <copy of collector.db>] [--json <file>]
 *
 * --snaps   folders searched, with all their subfolders, for saved i0OFE replies, plain or .gz; the same reply saved twice counts once
 * --db      a copy of a collector state's collector.db: the GT end offset is calibrated on it (lib/forecast/offset.js); opened read-only
 * --json    also writes the whole report there
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const GT = require('./gt');
const BT = require('./backtest');
const OFF = require('./offset');
const SC = require('./score');

function argsOf(argv) {
  const out = { snaps: [], db: null, json: null };
  for (let i = 0; i < argv.length; i++) {
    const [k, v] = [argv[i], argv[i + 1]];
    if (k === '--snaps' && v) { out.snaps.push(v); i += 1; } else if (k === '--db' && v) { out.db = v; i += 1; } else if (k === '--json' && v) { out.json = v; i += 1; } else throw new Error(`unknown argument ${k}`);
  }
  if (!out.snaps.length) throw new Error('--snaps <folder> is required');
  return out;
}
/** Every file under `dir` (depth-first). */
function filesUnder(dir) {
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...filesUnder(p)); else if (d.isFile()) out.push(p);
  }
  return out;
}
/** The distinct snapshots found under the folders. */
function loadSnapshots(dirs) {
  const seen = new Set();
  const out = [];
  for (const file of dirs.flatMap(filesUnder)) {
    let buf;
    try { buf = fs.readFileSync(file); if (file.endsWith('.gz')) buf = zlib.gunzipSync(buf); } catch { continue; }
    if (!buf.includes('i0OFE')) continue;
    const hash = crypto.createHash('sha1').update(buf).digest('hex');
    if (seen.has(hash)) continue;
    seen.add(hash);
    const s = GT.snapshotOf(buf.toString('utf8'));
    if (s) out.push(s);
  }
  return out;
}

const fmt = (x, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : '-');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(100 * x)}%` : '-');
const w = (x, n) => String(x).padStart(n);
/** One method's three scores: error, +-50% share, interval held. */
const three = (s, iqr = true) => `${w(fmt(s.medianError), 5)} ${w(pct(s.within50), 4)}${iqr ? ` ${w(pct(s.iqrCover), 4)}` : ''}`;
function printRows(title, rows) {
  process.stdout.write(`\n${title}\n`);
  process.stdout.write(`${'class'.padEnd(12)} cases shown srchs   kw known |  model: err +-50%  IQR | plain: err +-50%  IQR | typ-age: err +-50% | climate: err +-50%  IQR | naive: err +-50% | gate\n`);
  for (const r of rows) {
    process.stdout.write(`${r.cls.padEnd(12)} ${w(r.cases, 5)} ${w(r.shown, 5)} ${w(r.searches, 5)} ${w(r.keywords, 4)} ${w(r.model.known, 5)} | ${three(r.model).padStart(22)} | ${three(r.plain).padStart(20)} | ${three(r.typical, false).padStart(17)} |`
      + ` ${three(r.climate).padStart(22)} | ${three(r.naive, false).padStart(15)} | ${r.gate.pass ? 'PASS' : `fail: ${r.gate.why.join('; ')}`}\n`);
  }
}
function printChance(title, rows) {
  process.stdout.write(`\n${title}\n${'class'.padEnd(12)}     n known  brier climate skill\n`);
  for (const r of rows) {
    const c = r.chance;
    process.stdout.write(`${r.cls.padEnd(12)} ${w(c.n, 5)} ${w(c.known, 5)} ${w(fmt(c.brier, 3), 6)} ${w(fmt(c.climateBrier, 3), 7)} ${w(fmt(c.skill, 2), 5)}\n`);
  }
  const all = rows[rows.length - 1].chance;
  process.stdout.write(`calibration, all: ${all.bins.map((b) => `${b.from.toFixed(1)}-${b.to.toFixed(1)} said ${fmt(b.said, 2)} seen ${fmt(b.seen, 2)} (n ${b.n})`).join(' | ')}\n`);
}

function main() {
  const args = argsOf(process.argv.slice(2));
  const snaps = loadSnapshots(args.snaps);
  const entries = GT.mergeSnapshots(snaps);
  const times = GT.snapshotTimes(snaps);
  const span = snaps.length ? [Math.min(...snaps.map((s) => s.at)), Math.max(...snaps.map((s) => s.at))] : [0, 0];
  const ended = entries.filter((e) => GT.lastReading(e).end !== null).length;
  process.stdout.write(`snapshots ${snaps.length} (${Object.entries(times).map(([g, ts]) => `${g} ${ts.length}`).join(', ')}), ${new Date(span[0] * 1000).toISOString()} to ${new Date(span[1] * 1000).toISOString()}\n`);
  process.stdout.write(`searches ${entries.length}, ended ${ended}, still going at their newest reading ${entries.length - ended}\n`);
  const real = BT.runReal(entries, times);
  printRows(`REAL moments (volume as read then; outcome from the newest reading since; only forecasts followed ${SC.MIN_FOLLOW_UP} h or more)`, real.rows);
  printChance(`REAL: the chance it is still trending in ${SC.CHANCE_HOURS} h (Brier; skill against one pooled chance for all)`, real.rows);
  const leak = BT.runReal(entries, times, { volume: 'final' });
  const a = real.rows[real.rows.length - 1];
  const b = leak.rows[leak.rows.length - 1];
  process.stdout.write(`\nleak check, REAL moments classed by the newest volume instead: all ${b.shown} shown, err ${fmt(b.model.medianError)} h, ${pct(b.model.within50)} within, IQR ${pct(b.model.iqrCover)}, chance skill ${fmt(b.chance.skill, 2)} (as read then: ${a.shown}, ${fmt(a.model.medianError)} h, ${pct(a.model.within50)}, ${pct(a.model.iqrCover)}, ${fmt(a.chance.skill, 2)})\n`);
  const land = BT.runLandmark(entries, times);
  const shownL = land.forecasts.filter((c) => c.cls && !c.model.hidden);
  const later = shownL.filter((c) => c.volumeSeen === 'later').length;
  printRows(`LANDMARK moments (72-144 h before a later snapshot; ${later} of ${shownL.length} shown forecasts class a search by a volume read after the moment)`, land.rows);
  printChance(`LANDMARK: the chance it is still trending in ${SC.CHANCE_HOURS} h`, land.rows);
  const out = { snapshots: snaps.length, searches: entries.length, ended, span, real: real.rows, realFinalVolume: leak.rows, landmark: land.rows, landmarkLaterVolume: later };
  if (args.db) {
    out.offset = OFF.calibrateFromDb(args.db, entries);
    const o = out.offset;
    process.stdout.write(`\nGT end -> our end: ${o.pairs} pairs where both ends were watched (of ${o.candidates} ended talk trends with a search), median ${fmt(o.median)} h, IQR ${fmt(o.q25)} to ${fmt(o.q75)} h, ${o.agree} agree within +-${o.agreeWithin} h: ${o.ready ? 'READY' : `not ready (needs ${o.need})`}\n`);
    process.stdout.write(`own archive: ${o.ownLives} talk trends watched from before their peak to an end (C7 needs 15 comparables per class)\n`);
  }
  if (args.json) fs.writeFileSync(args.json, `${JSON.stringify(out, null, 1)}\n`);
}

if (require.main === module) {
  try { main(); } catch (err) { process.stderr.write(`${err.message}\n`); process.exitCode = 1; }
}
module.exports = { loadSnapshots, filesUnder };
