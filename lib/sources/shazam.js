'use strict';
/*
 * Shazam's US discovery chart (ios/IDEAS-FEED.md M3): the ten songs people are newly looking up, as the file behind the site's own
 * download button. Keyless, read three times a day (the file is cached an hour).
 *
 * Ranks only. A song on it that is also on the TikTok charts is two independent lists agreeing a sound is breaking: a leading
 * indicator for a sound the list already holds, never a row by itself.
 *
 * Flags (2026-10-29): robots.txt disallows /shazam/v1/ and /shazam/v3/, not /services/charts/ (no robots flag). needs permission: Apple
 * (Shazam's owner), for the chart's ranks shown as rows: the charts desk (lib/desks/charts.js) lists a song new to it by observation.
 */
const { request } = require('./fixed');
const { dayOf } = require('./html');
const { HOUR } = require('../util');

const FILE = 'https://www.shazam.com/services/charts/csv/discovery/united-states';
const EVERY = 8 * HOUR;
const ROWS_MAX = 200;

/** The file, asked every eight hours. lastReadAt: epoch seconds or undefined. */
const shazamRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY ? null
  : request({ id: 'shazam-discovery', source: 'shazam', kind: 'shazam', args: {}, url: FILE, file: 'shazam-discovery.csv', tier: 3 }));

/** One CSV line's fields ("a","b, c",d). */
const fields = (line) => [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]).trim());

/** The file as { day ("2026-10-11"), rows: [{ rank, artist, title }] }: a date line, a header, then `Rank,Artist,Title`. null when it is not that file. */
function parse(csv) {
  const lines = String(csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.findIndex((l) => /^Rank,Artist,Title$/i.test(l));
  if (head < 0) return null;
  const rows = lines.slice(head + 1).map(fields).filter((f) => f.length >= 3 && /^\d+$/.test(f[0])).map((f) => ({ rank: Number(f[0]), artist: f[1], title: f[2] })).slice(0, ROWS_MAX);
  if (!rows.length) return null;
  return { day: dayOf((lines[0].match(/(\d{1,2} [A-Z][a-z]+ \d{4})/) || [])[1]), rows };
}

module.exports = { shazamRequest, parse, EVERY };
