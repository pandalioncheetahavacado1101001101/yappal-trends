'use strict';
/*
 * Wikipedia's deaths page (lib/kinds-desk.js, the `remembered` section): the year's "Deaths in <year>" article, which holds the
 * current month by day of death, and in the first days of a month the closed month's own "Deaths in <Month> <year>". Read through
 * the Action API (one request: the newest revision's wikitext), once an hour.
 *
 * needs permission: Wikimedia (owner's letter pending). robots.txt disallows /w/ (the Action API's path) for every agent; the
 * collector already asks it for the size step and the dictionary, under Wikimedia's user-agent policy.
 * The page's text is CC BY-SA: a row made from it names Wikipedia.
 *
 * A confirming voice only (the owner's rule, 2026-10-27): an entry here says a person has died and gives the report it rests on; it
 * never words a row by itself and never lists one alone (lib/kinds-desk.js asks for an outlet's report and for people reading
 * about the person). Pure: requests to send and replies read into small records.
 */
const { hostOfUrl } = require('../budget');
const { HOUR, DAY } = require('../util');

const API = 'https://en.wikipedia.org/w/api.php';
const EVERY = HOUR;
// (the month just closed is read in a month's first days, when the year's page has moved it to a page of its own)
const CLOSED_MONTH_DAYS = 3;
const CLOSED_EVERY = 6 * HOUR;
// (what the desk can use: deaths of the last days before the revision, the newest days first)
const DAYS_KEPT = 5;
const ENTRIES_KEPT = 300;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TEXT_MAX = 160;

const slug = (title) => title.replace(/\s+/g, '_');
const request = (r) => ({ tier: 3, init: {}, host: hostOfUrl(r.url), source: 'kinds-deaths', ...r });

/** The page titles worth reading at `nowS`: the year's page, and the month just closed in a month's first days. */
function titlesAt(nowS) {
  const d = new Date(nowS * 1000);
  const year = d.getUTCFullYear();
  const out = [{ title: `Deaths in ${year}`, every: EVERY }];
  if (d.getUTCDate() <= CLOSED_MONTH_DAYS) {
    const prev = new Date(Date.UTC(year, d.getUTCMonth() - 1, 1));
    out.push({ title: `Deaths in ${MONTHS[prev.getUTCMonth()]} ${prev.getUTCFullYear()}`, every: CLOSED_EVERY });
  }
  return out;
}

/** One page's newest revision, its wikitext. */
const pageRequest = (title) => request({ id: `kinds-deaths-${slug(title)}`, kind: 'kinds-deaths', args: { title },
  url: `${API}?action=query&format=json&formatversion=2&prop=revisions&titles=${encodeURIComponent(slug(title))}&rvprop=ids%7Ctimestamp%7Ccontent&rvslots=main&rvlimit=1&maxlag=5`,
  file: `kinds-deaths-${slug(title)}.json` });

const plain = (s, max = TEXT_MAX) => String(s || '')
  .replace(/<ref[^>]*\/>/gi, ' ').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ')
  .replace(/\{\{[^{}]*\}\}/g, ' ')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
  .replace(/'{2,}/g, '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim().slice(0, max);
const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return null; } };

/** The report an entry rests on: its first reference, as { title, url, host, work } (a bare link's own words, or a citation template's). */
function refOf(line) {
  const m = line.match(/<ref[^>/]*>([\s\S]*?)<\/ref>/i);
  if (!m) return null;
  const body = m[1];
  const bare = body.match(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/);
  if (bare) return { title: plain(bare[2]), url: bare[1], host: hostOf(bare[1]), work: null };
  const field = (k) => { const f = body.match(new RegExp(`\\|\\s*${k}\\s*=\\s*([^|}]*)`, 'i')); return f ? plain(f[1]) : null; };
  const url = field('url');
  const title = field('title');
  if (!title || !url) return null;
  return { title, url, host: hostOf(url), work: field('work') || field('website') || field('publisher') };
}

/**
 * One entry line ("*[[Article|Name]], 80, American actor (''Show''), cancer.<ref>...</ref>") as { article, name, age, desc, ref,
 * announced }, or null (an entry with no English article: an interlanguage link or plain text, is no one most readers look up).
 */
function entryOf(line) {
  const m = line.match(/^\*\s*\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]\s*,\s*(.*)$/);
  if (!m) return null;
  const article = m[1].trim();
  const name = plain(m[2] || m[1]).replace(/\s*\([^)]*\)\s*$/, '');
  if (!name || /^(?:List|Deaths) of\b/i.test(article)) return null;
  const rest = m[3];
  const ageM = rest.match(/^(\d{1,3})\s*,\s*/);
  const desc = plain(ageM ? rest.slice(ageM[0].length) : rest).replace(/\s*\(death announced on this date\)\s*$/i, '').replace(/\.\s*$/, '');
  return { article, name, age: ageM ? Number(ageM[1]) : null, desc, ref: refOf(rest), announced: /death announced on this date/i.test(rest) };
}

/**
 * A page's reply as { title, revid, at (epoch s of the revision), entries: [{ day ("YYYY-MM-DD", the date of death), article, name,
 * age, desc, ref, announced }] }, or null when it is not that reply. The year's page heads each month "==October==" and each day
 * "===26==="; a month's own page heads only its days.
 */
function parse(text, title) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const page = j && j.query && Array.isArray(j.query.pages) ? j.query.pages[0] : null;
  const rev = page && Array.isArray(page.revisions) ? page.revisions[0] : null;
  const content = rev && rev.slots && rev.slots.main ? rev.slots.main.content : rev ? rev.content : null;
  if (typeof content !== 'string') return null;
  const titleM = String(title || page.title || '').match(/Deaths in (?:(\w+) )?(\d{4})$/);
  if (!titleM) return null;
  const year = Number(titleM[2]);
  let month = titleM[1] ? MONTHS.indexOf(titleM[1]) : -1;
  let day = null;
  const entries = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    const mh = line.match(/^==\s*([A-Za-z]+)\s*==$/);
    if (mh) { const k = MONTHS.indexOf(mh[1]); if (k >= 0) { month = k; day = null; } else day = null; continue; }
    const dh = line.match(/^===\s*(\d{1,2})\s*===$/);
    if (dh) { day = Number(dh[1]); continue; }
    if (month < 0 || !day || !line.startsWith('*')) continue;
    const e = entryOf(line);
    if (!e) continue;
    const ymd = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    entries.push({ day: ymd, ...e });
  }
  const at = Date.parse(rev.timestamp || '');
  const from = Number.isFinite(at) ? new Date(at - DAYS_KEPT * DAY * 1000).toISOString().slice(0, 10) : '';
  const kept = entries.filter((e) => e.day >= from).sort((a, b) => b.day.localeCompare(a.day)).slice(0, ENTRIES_KEPT);
  return { title: page.title || title, revid: rev.revid || null, at: Number.isFinite(at) ? Math.floor(at / 1000) : null, entries: kept };
}

module.exports = { EVERY, CLOSED_EVERY, MONTHS, titlesAt, pageRequest, parse, entryOf, refOf, plain, DAY };
