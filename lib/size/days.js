'use strict';
/*
 * UTC calendar days for the size series (lib/size): "YYYY-MM-DD" strings, and their day numbers (days since 1970-01-01) for
 * arithmetic. A Wikipedia day is a UTC day, so every day here is one.
 */
const DAY_MS = 86400000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value is a "YYYY-MM-DD" day that exists. */
const isDay = (d) => typeof d === 'string' && DAY_RE.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
/** A day's number (days since 1970-01-01). Throws on a value that is no day, so a bad input never becomes NaN days later. */
function dayNum(d) {
  if (!isDay(d)) throw new Error(`not a day: ${d}`);
  return Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS);
}
/** The day of a day number. */
const dayOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** The day `n` days after `d` (before, when n is negative). */
const addDays = (d, n) => dayOf(dayNum(d) + n);
/** The UTC day of an instant: epoch seconds, or an ISO string. */
const dayOfInstant = (at) => new Date(typeof at === 'number' ? at * 1000 : Date.parse(at)).toISOString().slice(0, 10);
/** Every day from `a` to `b`, both included; empty when b is before a. */
function daysBetween(a, b) {
  const out = [];
  for (let n = dayNum(a), end = dayNum(b); n <= end; n += 1) out.push(dayOf(n));
  return out;
}
/** "YYYY-MM-DD" -> "YYYYMMDD" (what the pageviews API takes and gives). */
const compact = (d) => d.replace(/-/g, '');
/** "YYYYMMDD" or "YYYYMMDDHH" -> "YYYY-MM-DD". */
const expand = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

module.exports = { isDay, dayNum, dayOf, addDays, dayOfInstant, daysBetween, compact, expand };
