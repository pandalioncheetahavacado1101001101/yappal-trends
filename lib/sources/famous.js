'use strict';
/*
 * Famous Birthdays' trending page (ios/IDEAS-FEED.md L6): the 48 profiles climbing fastest on a site whose readers are the
 * creators' own audience, each with what the person is known as and how many places it climbed. Keyless, every two hours (the page
 * is cached for four).
 *
 * It gives no reason, and a football coach spikes it as easily as a TikToker: so it is a SHORTLIST of names worth their own search
 * and nothing more. A name here is never a row, and never one of the two signals a row needs.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const PAGE = 'https://www.famousbirthdays.com/trending/';
const EVERY_SECONDS = 2 * HOUR;
// what the site calls the people this list is about
const CREATOR_LABEL = /\b(?:tiktok|youtube|youtuber|twitch|streamer|instagram|influencer|web|vlogger|podcast|gamer|snapchat|kick|onlyfans|content creator|social)\b/i;

/** The page, asked every two hours at most. lastReadAt: epoch seconds or undefined. */
const famousRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY_SECONDS ? null
  : request({ id: 'famous-trending', source: 'famous', kind: 'famous', args: {}, url: PAGE, file: 'famous-trending.html', tier: 2 }));

const decode = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, '\'').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/**
 * The page as [{ name, label ("TikTok Star", "Movie Actor"), move (places climbed), creator (the label is a creator's) }] in the
 * page's own order; null when the page is not that page (a challenge page has no tiles).
 */
function parse(html) {
  const tiles = String(html || '').split(/<a class="tile"/).slice(1);
  if (!tiles.length) return null;
  const out = [];
  for (const block of tiles) {
    const tile = block.split(/<\/a>/)[0];
    const name = decode((tile.match(/<p class="type-16-18-small">([\s\S]*?)<\/p>/) || [])[1]);
    const label = decode((tile.match(/<p class="tile__description[^"]*">([\s\S]*?)<\/p>/) || [])[1]);
    const move = Number(decode((tile.match(/<p class="tile__ranking-move[^"]*">([\s\S]*?)<\/p>/) || [])[1]).replace(/[^\d]/g, ''));
    if (!name || name.length > 60) continue;
    out.push({ name, label: label || null, move: Number.isFinite(move) ? move : 0, creator: CREATOR_LABEL.test(label) });
  }
  return out.length ? out : null;
}

module.exports = { famousRequest, parse, EVERY_SECONDS, CREATOR_LABEL };
