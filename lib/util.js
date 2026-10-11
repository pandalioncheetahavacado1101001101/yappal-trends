'use strict';
/*
 * Small things every part of the collector shares (ios/IDEAS-FEED.md): the slot, instants, the audiences and their time zones, the
 * normalised key of section D6, hashes and stable JSON.
 */
const crypto = require('node:crypto');

const SLOT_SECONDS = 900;
const HOUR = 3600;
const DAY = 86400;
const AUDIENCES = ['US', 'GB', 'AU', 'CA', 'mixed'];
const GEOS = ['US', 'GB', 'AU', 'CA'];
/** An audience's column suffix in `samples` (h_us ... h_mx, r_us ... r_mx). */
const AUDIENCE_COLUMN = { US: 'us', GB: 'gb', AU: 'au', CA: 'ca', mixed: 'mx' };
const GEO_BIT = { US: 1, GB: 2, AU: 4, CA: 8 };
// (B3: where an audience's day starts and ends; a start known only to the day is noon there, C4)
const TIME_ZONE = { US: 'America/New_York', GB: 'Europe/London', AU: 'Australia/Sydney', CA: 'America/Toronto', mixed: 'America/New_York' };
/** The audience's own countries: its one, or all four for a mixed audience. */
const homeGeos = (audience) => (audience === 'mixed' ? GEOS : [audience]);

/** Start of the slot `ms` falls in, epoch seconds. */
const slotOf = (ms) => Math.floor(ms / 1000 / SLOT_SECONDS) * SLOT_SECONDS;
/** An instant: ISO 8601 UTC with seconds and a Z, no fractions. Takes epoch seconds. */
const instant = (seconds) => new Date(Math.floor(seconds) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const instantOrNull = (seconds) => (Number.isFinite(seconds) && seconds !== null ? instant(seconds) : null);
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** The normalised key of section D6 (people, tags, follows): the engine's keyOf, as samples/validate.cjs checks it. */
const keyOf = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]s\b/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const sha256 = (text) => crypto.createHash('sha256').update(String(text)).digest();
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
/** The first `n` base-32 characters (a-z, 2-7) of a text's sha256. */
function hash32(text, n = 12) {
  const bytes = sha256(text);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < n) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= n) break;
  }
  return out;
}
const hashHex = (text, n = 6) => sha256(text).toString('hex').slice(0, n);

/** The wall clock of an instant in a time zone: { y, m, d, hh, mm } (m is 1-12). */
function localParts(seconds, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(seconds * 1000));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
}
const pad2 = (n) => String(n).padStart(2, '0');
/** "YYYY-MM-DD" of an instant in a time zone. */
const localDay = (seconds, zone) => { const p = localParts(seconds, zone); return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`; };
/** The instant (epoch seconds) of a wall-clock time in a time zone, daylight saving included. */
function zonedTime(ymd, zone, hh = 12, mm = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  let guess = wanted;
  // (two passes settle any offset, a change of clocks that day too)
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, zone);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) / 1000;
    if (shown === wanted) break;
    guess += wanted - shown;
  }
  return guess;
}
/** Noon in a time zone on a calendar day: what a start known only to the day is published as (C4). */
const noonIn = (ymd, zone) => zonedTime(ymd, zone, 12, 0);

/** JSON with the keys in the order given (objects keep insertion order: built that way everywhere), minified. */
const minify = (value) => JSON.stringify(value);

module.exports = { SLOT_SECONDS, HOUR, DAY, AUDIENCES, GEOS, AUDIENCE_COLUMN, GEO_BIT, TIME_ZONE, homeGeos, slotOf, instant, instantOrNull, clamp, median, mean, keyOf,
  sha256, hash32, hashHex, localParts, localDay, zonedTime, noonIn, pad2, minify };
