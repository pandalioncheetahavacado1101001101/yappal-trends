'use strict';
/*
 * Wikipedia's hourly page-view dumps (ios/IDEAS-FEED.md M4): one file an hour for every Wikimedia site, a line a page ("en Title
 * views 0" for desktop, "en.m Title views 0" for mobile). Wikimedia's own public files, keyless.
 *
 * One file is sixty megabytes gzipped, so it is never read into memory: it is streamed, gunzipped and read a line at a time for
 * the pages the list already holds, and the download is dropped the moment the English blocks are behind (the file is sorted by
 * site, and English ends about half way in). One file an hour, never one a cycle: a file appears about two and a quarter hours
 * after its hour began, and one that is not there yet (404) is asked for again the cycle after.
 *
 * What comes out is a page's views in that hour, desktop and mobile added: an hourly curve where the daily lists give one point a
 * day. Only a thing with a page has one, and a small creator's sits near the noise floor.
 */
const zlib = require('node:zlib');
const readline = require('node:readline');
const { Readable } = require('node:stream');
const { HOUR } = require('../util');

const HOST = 'dumps.wikimedia.org';
const BASE = `https://${HOST}/other/pageviews`;
// a file is there about 2 h 10 min to 2 h 20 min after its hour began
const READY_AFTER = 2 * HOUR + 20 * 60;
const TIMEOUT_MS = 90000;
const SITES = new Set(['en', 'en.m']);
const pad = (n) => String(n).padStart(2, '0');

/** An hour's file: its address and name. hour: epoch seconds, the start of the hour. */
function fileOf(hour) {
  const d = new Date(hour * 1000);
  const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const name = `pageviews-${ymd}-${pad(d.getUTCHours())}0000.gz`;
  return { hour, name, url: `${BASE}/${d.getUTCFullYear()}/${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}/${name}` };
}
/**
 * The hour to read this cycle, or null: the newest hour whose file should be out, unless it was read. When that file was asked for
 * and was not out yet (`notYet`), the hour before it is read first if it never was; a collector that slept reads the newest and
 * does not catch up file by file. readHours: Set(hour starts already read).
 */
function hourDue(now, readHours = new Set(), notYet = null) {
  const newest = Math.floor((now - READY_AFTER) / HOUR) * HOUR;
  if (readHours.has(newest)) return null;
  return notYet === newest && !readHours.has(newest - HOUR) ? newest - HOUR : newest;
}
/** A page's title as the dumps spell it, from a name ("Bexan Tamard" -> "Glibmo"). */
const titleOf = (name) => String(name || '').trim().replace(/\s+/g, '_');

/**
 * Reads the lines of a dump: the views of the wanted titles, desktop and mobile added. lines: an async iterable of lines; wanted:
 * Set(title). Resolves { views: Map(title -> views), lines, english (lines of the English blocks), early (stopped once they were
 * behind) }. The blocks are in the order of their site codes, so the first site after "en.m" that does not begin "en" ends the read.
 */
async function scan(lines, wanted) {
  const views = new Map();
  let n = 0;
  let english = 0;
  let early = false;
  for await (const line of lines) {
    n += 1;
    const a = line.indexOf(' ');
    if (a < 1) continue;
    const site = line.slice(0, a);
    if (!SITES.has(site)) { if (english && site > 'en.m' && !site.startsWith('en')) { early = true; break; } continue; }
    english += 1;
    const b = line.indexOf(' ', a + 1);
    if (b < 0) continue;
    const title = line.slice(a + 1, b);
    if (!wanted.has(title)) continue;
    const v = Number(line.slice(b + 1, line.indexOf(' ', b + 1) < 0 ? undefined : line.indexOf(' ', b + 1)));
    if (Number.isFinite(v)) views.set(title, (views.get(title) || 0) + v);
  }
  return { views, lines: n, english, early };
}

/**
 * A gzipped buffer or stream as lines (what `scan` reads). A read that stops early cuts the stream short, and the gunzip then
 * complains of a file that ended too soon: that complaint has a listener here, so it ends nothing; a failure while the lines are
 * still being read rejects the read all the same.
 */
function linesOf(gz) {
  const quiet = () => {};
  const source = Buffer.isBuffer(gz) ? Readable.from([gz]) : gz;
  const gunzip = zlib.createGunzip();
  source.on('error', (e) => gunzip.destroy(e));
  gunzip.on('error', quiet);
  const lines = readline.createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  lines.on('error', quiet);
  return lines;
}

/**
 * Downloads one hour's file as a stream and scans it. Resolves { status, hour, views, bytes (downloaded), lines, english, early, ms,
 * date (the server's clock) }; a file that is not out yet resolves { status: 404 }; a failure rejects.
 * opts: { agent (the collector's user agent), fetch, timeoutMs }.
 */
async function read(hour, wanted, { agent = 'YapPalIdeas/1', fetch: get = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const started = Date.now();
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), timeoutMs);
  try {
    // (identity: the file is gzip already, and it is this code that gunzips it, a line at a time)
    const res = await get(fileOf(hour).url, { headers: { 'User-Agent': agent, 'Accept-Encoding': 'identity' }, signal: control.signal, redirect: 'follow' });
    const date = res.headers.get('date');
    if (res.status !== 200 || !res.body) { control.abort(); return { status: res.status, hour, views: new Map(), bytes: 0, lines: 0, english: 0, early: false, ms: Date.now() - started, date, retryAfter: res.headers.get('retry-after') }; }
    let bytes = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (chunk) => { bytes += chunk.length; });
    const lines = linesOf(body);
    const found = await scan(lines, wanted);
    // (dropping the download once the English blocks are behind: that is the plan, not a failure)
    lines.close();
    control.abort();
    // (a file that ended before its English blocks did is a download cut short, and no reading of anything)
    if (!found.early && found.english === 0) throw new Error('the file held no English block');
    return { status: 200, hour, ...found, bytes, ms: Date.now() - started, date };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { HOST, READY_AFTER, fileOf, hourDue, titleOf, scan, linesOf, read };
