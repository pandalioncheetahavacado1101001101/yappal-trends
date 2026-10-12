'use strict';
/*
 * CreatorDB's "Trending Instagram Audio" page (ios/IDEAS-FEED.md M3): fourteen audios a week with the format each is used for, a
 * heat the page gives it and a count of Reels. Keyless, read once a day (the page is weekly).
 *
 * It is a paid product's free page compiled from other reports: a digest with counts, not a measurement, and it can vanish. It is
 * the one keyless number on the Reels side, so it is only ever a second opinion on a sound the TikTok charts already hold, and the
 * name of the format an audio is used for. What the page says of a format is kept in the state for the line and never published
 * beyond that one line.
 */
const { request } = require('./fixed');
const { textOf, countOf, dayOf, ldJson, decode } = require('./html');
const { DAY } = require('../util');

const PAGE = 'https://creatordb.app/free-tools/trending-instagram-audio/';
const EVERY = DAY;
const ABOUT_MAX = 420;

/** The page, asked once a day. lastReadAt: epoch seconds or undefined. */
const reelsRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY ? null
  : request({ id: 'reels-audio', source: 'reels', kind: 'reels', args: {}, url: PAGE, file: 'reels-audio.html', tier: 3 }));

/**
 * The page as { week ("2026-10-07"), rows: [{ rank, title, artist, format, heat, momentum, reels, id, about }] }, or null when it is
 * not that page. The ranks and names are the page's JSON-LD list; the format, heat and count are the table's row of that rank; the
 * audio's own id and what the page says creators do with it are the card under the table that carries the same format.
 */
function parse(html) {
  const list = ldJson(html).find((n) => n['@type'] === 'ItemList' && Array.isArray(n.itemListElement));
  const table = (String(html || '').match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!list || !table) return null;
  const cells = table.split(/<tr[\s>]/).slice(1).map((tr) => tr.split(/<td[\s>]/).slice(1).map((td) => textOf(`<td ${td}`.replace(/^<td [^>]*>/, ''))));
  const cards = String(html).split(/<div class="tk-lbl">/).slice(1).map((c) => ({ format: textOf(c.split('</div>')[0]), about: textOf((c.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1]).slice(0, ABOUT_MAX) || null,
    id: (c.match(/instagram\.com\/reels\/audio\/(\d{5,25})/) || [])[1] || null }));
  const rows = [];
  for (const el of list.itemListElement) {
    const item = (el && el.item) || {};
    const rank = Number(el && el.position);
    const row = cells.find((c) => c.length >= 6 && Number(c[0]) === rank);
    if (!item.name || !Number.isFinite(rank)) continue;
    const format = row ? row[2] || null : null;
    const card = format ? cards.find((c) => c.format === format) || null : null;
    rows.push({ rank, title: decode(item.name).trim(), artist: decode(typeof item.byArtist === 'string' ? item.byArtist : (item.byArtist && item.byArtist.name) || '').trim() || null,
      format, heat: row && /^\d{1,3}$/.test(row[3]) ? Number(row[3]) : null, momentum: row ? row[4].toLowerCase() || null : null,
      reels: row ? countOf(row[row.length - 1]) : null, id: card ? card.id : null, about: card ? card.about : null });
  }
  if (!rows.length) return null;
  return { week: dayOf((textOf(html).match(/Week of ([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1]), rows };
}

module.exports = { reelsRequest, parse, EVERY };
