#!/usr/bin/env node
'use strict';
/*
 * The daily scoreboard (ios/IDEAS-SUPER.md 1; .github/workflows/scoreboard.yml runs it at 06:20Z).
 *
 *   node .github/scoreboard/run.js --state <dir> --cache <dir> --out <dir> (--fetch | --replies <dir>)
 *        [--branch <dir>] [--feed <v1/us.json>] [--ledger <ledger.jsonl>] [--now <ISO>] [--read-at <ISO>] [--day <YYYY-MM-DD>]
 *
 *   --state    a restored copy of the collector's state: read only, never written
 *   --cache    the scoreboard's own cache folder: history.json (the comparators' history and each scored day's name-free lead values
 *              and breadth counts, never a matched pair) is read and written here, and nowhere else
 *   --out      where latest.json and days.jsonl are written (the scoreboard branch's two files)
 *   --fetch    read the comparators now, keyless (about five requests, spaced); --replies reads saved replies instead (a file or
 *              file.gz of each name in comparators.js READS)
 *   --branch   the scoreboard branch as it is (its days.jsonl is read back and appended to)
 *   --feed     the published US list (the people its rows name help the matcher); --ledger the feed branch's ledger.jsonl
 *   --now      the run's instant (default: now); --read-at when the saved replies were read (default: --now); --day the day to
 *              score (default: --now less the spec's lagDays)
 *
 * Prints one line of aggregate numbers. Never prints a title, a name, an address or a per-trend time, and never writes a matched pair
 * anywhere: they live in memory for the run. Exit 0: a day scored and written; 3: no state to read (nothing scored; the history is
 * still kept); 1: failed.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const C = require('./comparators');
const H = require('./history');
const R = require('./report');
const { readState } = require('./ours');
const { scoreDay } = require('./metrics');
const { addDays, dayOfSeconds, instant } = require('./stats');

const SPEC_FILE = path.join(__dirname, 'scoreboard-spec.json');
// (the matcher's last hand-check as counts: published with latest.json; not part of the spec, so a weekly audit never restarts the clock)
const AUDIT_FILE = path.join(__dirname, 'audit-result.json');

class SafeError extends Error { constructor(message) { super(message); this.safe = true; } }

function parseArgs(argv) {
  const out = { fetch: false };
  const names = { '--state': 'state', '--cache': 'cache', '--out': 'out', '--replies': 'replies', '--branch': 'branch', '--feed': 'feed', '--ledger': 'ledger', '--now': 'now', '--read-at': 'readAt', '--day': 'day' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    if (flag === '--fetch') { out.fetch = true; continue; }
    if (!names[flag]) throw new SafeError(`unknown argument ${flag}`);
    out[names[flag]] = inline !== undefined ? inline : argv[++i];
  }
  if (!out.state || !out.cache || !out.out || (!out.fetch && !out.replies)) throw new SafeError('usage: run.js --state <dir> --cache <dir> --out <dir> (--fetch | --replies <dir>) [--branch <dir>] [--feed <file>] [--ledger <file>] [--now <ISO>] [--read-at <ISO>] [--day <YYYY-MM-DD>]');
  for (const k of ['now', 'readAt']) if (out[k] !== undefined && !Number.isFinite(Date.parse(out[k]))) throw new SafeError(`--${k} is not an instant`);
  if (out.day !== undefined && !/^\d{4}-\d\d-\d\d$/.test(out.day)) throw new SafeError('--day is YYYY-MM-DD');
  return out;
}

const readText = (file) => { try { const b = fs.readFileSync(file); return (file.endsWith('.gz') ? zlib.gunzipSync(b) : b).toString('utf8'); } catch { return null; } };
const savedReply = (dir, file) => readText(path.join(dir, file)) ?? readText(path.join(dir, `${file}.gz`));
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.new`, text);
  fs.renameSync(`${file}.new`, file);
}

/** The comparators read now, one request at a time, spaced: { replies: { file: text | null }, http: { id: status | 0 } }. */
async function fetchReplies(spec, env = process.env) {
  const contact = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? ` (+${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY})` : '';
  const replies = {};
  const http = {};
  for (const [i, r] of C.READS.entries()) {
    if (i) await new Promise((done) => { setTimeout(done, spec.reads.gapMs); });
    try {
      const res = await fetch(r.url, { ...(r.init || {}), headers: { 'User-Agent': `YapPalIdeas/1${contact}`, ...((r.init && r.init.headers) || {}) }, redirect: 'follow', signal: AbortSignal.timeout(spec.reads.timeoutMs) });
      http[r.id] = res.status;
      replies[r.file] = res.ok ? await res.text() : null;
    } catch { http[r.id] = 0; replies[r.file] = null; }
  }
  return { replies, http };
}

/** Each comparator's read: 'ok', 'refused' (no reply, or an error status) or 'unreadable' (a reply that held no list). */
function statusesOf(replies, parsed) {
  const st = (files, ok) => (files.every((f) => replies[f] === null || replies[f] === undefined) ? 'refused' : ok ? 'ok' : 'unreadable');
  return {
    gt: st(['gt-us-168h.txt'], !!(parsed.gt && parsed.gt.length)),
    kym: st(['kym-memes.xml', 'kym-subs.xml'], !!(parsed.kym && parsed.kym.length)),
    viral50: st(['tts-viral.html'], !!(parsed.viral50 && parsed.viral50.length)),
    x: st(['getdaytrends-us.html'], !!(parsed.x && parsed.x.length)),
  };
}

function summary(line) {
  const lead = Object.entries(line.lead).map(([c, v]) => `${c} n=${v.n} first=${v.first ?? '-'} median=${v.medianHours ?? '-'}h (${v.status})`).join(', ');
  const cov = Object.entries(line.coverage).map(([c, v]) => `${c} ${v.share ?? '-'} of ${v.n ?? '-'}`).join(', ');
  const pb = line.breadth.pooled;
  return `scoreboard ${line.day} (spec ${line.spec}): lead ${lead}; coverage ${cov}; breadth ${line.breadth.ratio ?? '-'} (pooled ${pb ? pb.ratio ?? '-' : '-'}); ` +
    `precision gate ${line.precision.gate ?? '-'}; speed mean age ${line.speed.meanAgeMinutes ?? '-'} min; reads ${Object.entries(line.reads).map(([c, s]) => `${c} ${s}`).join(', ')}`;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const spec = JSON.parse(fs.readFileSync(SPEC_FILE, 'utf8'));
  const hash = R.specHash(spec, R.scoringCode(__dirname));
  const now = Math.floor((opts.now ? Date.parse(opts.now) : Date.now()) / 1000);
  const readAt = opts.readAt ? Math.floor(Date.parse(opts.readAt) / 1000) : now;
  const day = opts.day || addDays(dayOfSeconds(now), -spec.scoredDay.lagDays);

  const replies = {};
  if (opts.fetch) Object.assign(replies, (await fetchReplies(spec)).replies);
  else for (const r of C.READS) replies[r.file] = savedReply(opts.replies, r.file);
  const parsed = C.parseAll(replies);
  const reads = statusesOf(replies, parsed);

  const cacheFile = path.join(opts.cache, 'history.json');
  let history = H.prune(H.mergeRead(H.fromText(readText(cacheFile)), parsed, reads, readAt, spec), now, spec);
  if (!fs.existsSync(path.join(opts.state, 'collector.db'))) {
    writeAtomic(cacheFile, JSON.stringify(history));
    process.stdout.write(`scoreboard ${day}: no state to read: nothing scored (the comparators' history is kept)\n`);
    return 3;
  }
  let feedItems = [];
  if (opts.feed) { try { feedItems = JSON.parse(readText(opts.feed) || '{}').items || []; } catch { feedItems = []; } }
  const ledger = (opts.ledger ? readText(opts.ledger) || '' : '').split('\n').map((t) => { try { return t.trim() ? JSON.parse(t) : null; } catch { return null; } }).filter(Boolean);

  const ours = readState(opts.state, spec, { feedItems });
  let result; let store;
  try { ({ result, store } = scoreDay({ day, now, spec, history, ours, ledger })); } finally { ours.close(); }
  history = H.withDay(history, day, { spec: hash, at: now, lead: store.lead, breadth: store.breadth });

  const at = instant(now);
  const line = R.dayLine({ result, history, hash, at, reads, spec });
  const lines = R.withLine(R.readDays(opts.branch ? readText(path.join(opts.branch, spec.publish.days)) : ''), line, spec);
  let audit = null;
  try { audit = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch { audit = null; }
  const latest = R.latestOf({ lines, history, hash, at, spec, audit });

  writeAtomic(cacheFile, JSON.stringify(history));
  writeAtomic(path.join(opts.out, spec.publish.days), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  writeAtomic(path.join(opts.out, spec.publish.latest), `${JSON.stringify(latest, null, 1)}\n`);
  process.stdout.write(`${summary(line)}\n`);
  return 0;
}

module.exports = { parseArgs, statusesOf, main };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    // (never the message of an error that is not this file's own: a parser's message can quote what it read)
    process.stderr.write(`scoreboard: failed: ${e && e.safe ? e.message : (e && e.name) || 'error'}\n`);
    process.exitCode = 1;
  });
}
