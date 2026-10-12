'use strict';
/*
 * Kworb's mirror of Spotify's US daily chart (ios/IDEAS-FEED.md M3): two hundred songs with the day's streams and the change on the
 * day before. A hobby site's public page, two days behind, read twice a day.
 *
 * It says a sound has crossed into streaming, with a number: a second opinion on a sound the TikTok charts already hold, never a
 * row by itself. The streams are Spotify's as Kworb prints them.
 */
const { request } = require('./fixed');
const { textOf, countOf } = require('./html');
const { HOUR } = require('../util');

const PAGE = 'https://kworb.net/spotify/country/us_daily.html';
const EVERY = 12 * HOUR;
const ROWS_MAX = 200;

/** The page, asked every twelve hours. lastReadAt: epoch seconds or undefined. */
const kworbRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY ? null
  : request({ id: 'kworb-us-daily', source: 'kworb', kind: 'kworb', args: {}, url: PAGE, file: 'kworb-us-daily.html', tier: 3, conditional: true }));

/** The page as { day ("2026-10-09"), rows: [{ rank, artist, title, days (on the chart), streams, change }] }, or null when it is not that page. */
function parse(html) {
  const day = ((String(html || '').match(/Spotify Daily Chart - United States - (\d{4})\/(\d\d)\/(\d\d)/) || []).slice(1, 4).join('-')) || null;
  const body = (String(html || '').match(/<tbody>[\s\S]*?<\/tbody>/) || [])[0];
  if (!body) return null;
  const rows = [];
  for (const tr of body.split(/<tr[\s>]/).slice(1)) {
    const td = tr.split(/<td[^>]*>/).slice(1).map((c) => textOf(c.split('</td>')[0]));
    const names = [...tr.matchAll(/<a href="[^"]*">([\s\S]*?)<\/a>/g)].map((m) => textOf(m[1]));
    if (td.length < 8 || names.length < 2 || !/^\d+$/.test(td[0])) continue;
    rows.push({ rank: Number(td[0]), artist: names[0], title: names[1], days: countOf(td[3]), streams: countOf(td[6]), change: /^[+-]/.test(td[7]) ? countOf(td[7]) : null });
    if (rows.length >= ROWS_MAX) break;
  }
  return rows.length ? { day: /^\d{4}-\d\d-\d\d$/.test(day || '') ? day : null, rows } : null;
}

module.exports = { kworbRequest, parse, EVERY };
