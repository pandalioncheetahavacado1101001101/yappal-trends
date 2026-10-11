'use strict';
/*
 * Publishing (ios/IDEAS-FEED.md A6, B3): `<out>` is a folder of static files. Everything is written into `<out>/.tmp-<cycle>/` and
 * renamed into place one by one, details first, bundles next, lists last, so a list never names a detail that is not there. Nothing
 * from the state, the raw replies or the environment is ever written under `<out>`.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { TIME_ZONE, localParts, pad2, minify, HOUR } = require('./util');

const DETAIL_KEPT_SECONDS = 48 * HOUR;
const ARCHIVE_MARKS = [[9, 0], [18, 0]];
const ARCHIVE_WINDOW_MINUTES = 120;
const fileOf = (audience) => audience.toLowerCase();

/**
 * Writes one cycle's feed. feeds: lib/feed.js `build`; audiences: the lists that passed as a whole (the others stay as they were);
 * names: the names file (D6) on the cycles it is refreshed, else null. Returns { files, bytes: { 'us.json': n, ... } }.
 */
function publish(outDir, { cycle, feeds, audiences, status, names = null }) {
  const v1 = path.join(outDir, 'v1');
  const tmp = path.join(outDir, `.tmp-${cycle}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'd'), { recursive: true });
  fs.mkdirSync(path.join(v1, 'd'), { recursive: true });
  const bytes = {};
  const staged = { details: [], bundles: [], lists: [], status: [] };
  const stage = (group, name, value) => { const body = minify(value); fs.writeFileSync(path.join(tmp, name), body); bytes[name] = Buffer.byteLength(body); staged[group].push(name); };
  const listed = new Set(audiences.flatMap((a) => feeds.lists[a].items.map((x) => x.id)));
  for (const [id, detail] of feeds.details) if (listed.has(id)) stage('details', path.join('d', `${id}.json`), detail);
  for (const a of audiences) stage('bundles', `${fileOf(a)}.details.json`, feeds.bundles[a]);
  for (const a of audiences) stage('lists', `${fileOf(a)}.json`, feeds.lists[a]);
  if (names) stage('status', 'names.json', names);
  if (status) stage('status', 'status.json', status);
  // details first, bundles next, lists last
  for (const group of ['details', 'bundles', 'lists', 'status']) for (const name of staged[group]) fs.renameSync(path.join(tmp, name), path.join(v1, name));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { files: Object.keys(bytes).length, bytes };
}

/** Deletes the detail files whose trend left every list 48 hours ago (a listed trend's detail is rewritten every cycle). */
function pruneDetails(outDir, nowWallSeconds = Date.now() / 1000) {
  const dir = path.join(outDir, 'v1', 'd');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (name.endsWith('.json') && nowWallSeconds - fs.statSync(file).mtimeMs / 1000 > DETAIL_KEPT_SECONDS) { fs.rmSync(file, { force: true }); n += 1; }
  }
  return n;
}

/**
 * The archive of whole lists (B3): for each audience the lists published at 09:00 and 18:00 in its own time zone, the first cycle at
 * or after that minute (and within two hours of it: a list of the evening is never filed as the morning's), as
 * archive/<AUD>/<YYYY-MM-DD>-<HHMM>.json.gz. Returns the files written.
 */
function archive(archiveDir, lists, t) {
  const out = [];
  for (const [audience, list] of Object.entries(lists)) {
    const p = localParts(t, TIME_ZONE[audience]);
    const minutes = p.hh * 60 + p.mm;
    for (const [hh, mm] of ARCHIVE_MARKS) {
      const after = minutes - (hh * 60 + mm);
      if (after < 0 || after > ARCHIVE_WINDOW_MINUTES) continue;
      const file = path.join(archiveDir, audience, `${p.y}-${pad2(p.m)}-${pad2(p.d)}-${pad2(hh)}${pad2(mm)}.json.gz`);
      if (fs.existsSync(file)) continue;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.new`, zlib.gzipSync(minify(list)));
      fs.renameSync(`${file}.new`, file);
      out.push(file);
    }
  }
  return out;
}

module.exports = { publish, pruneDetails, archive, fileOf, ARCHIVE_MARKS };
