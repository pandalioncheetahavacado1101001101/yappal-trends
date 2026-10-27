'use strict';
/*
 * Release calendars (ios/IDEAS-SUPER.md, lead): what is known to come out before anyone searches for it. Keyless and read rarely.
 *   TVmaze's schedule (api.tvmaze.com: an open API with no key and no robots.txt; its data is CC BY-SA, so every row made from it
 *     names TVmaze): the US networks' episodes of a day and the streaming services' episodes of a day, for today and tomorrow (US
 *     Eastern), each read again after six hours; and one show's seasons (how many episodes, so which one is the finale), read weekly
 *     and only for a show a row may be made for.
 *   Wikipedia's list of American films of the year: the article page itself (en.wikipedia.org/wiki/, which robots.txt allows; the
 *     API paths it does not), read once a day: the day each film opens.
 * Pure: requests to send and replies read into small records. lib/release-desk.js asks, keeps the calendar and makes the rows.
 */
const { hostOfUrl } = require('../budget');
const { HOUR, DAY } = require('../util');

const TVMAZE = 'https://api.tvmaze.com';
const FILMS_PAGE = (year) => `https://en.wikipedia.org/wiki/List_of_American_films_of_${year}`;
const TV_EVERY = 6 * HOUR;
const FILMS_EVERY = DAY;
const SEASONS_EVERY = 7 * DAY;
// (what a day's schedule keeps: shows people follow, in English, from a US network or a streaming service. TVmaze's own weight, 0-100,
// is how followed a show is; news, talk and sports are never a release)
const WEIGHT_KEPT = 90;
const NOT_RELEASES = new Set(['News', 'Talk Show', 'Sports']);
const ITEMS_KEPT = 400;

const request = (r) => ({ tier: 3, init: {}, host: hostOfUrl(r.url), source: 'releases', ...r });

/** One day's schedule: `which` 'net' (US networks) or 'web' (streaming services, any country). day: "YYYY-MM-DD" (US Eastern). */
const tvRequest = (which, day) => request({ id: `releases-tv-${which}-${day}`, kind: 'releases-tv', args: { which, day },
  url: which === 'net' ? `${TVMAZE}/schedule?country=US&date=${day}` : `${TVMAZE}/schedule/web?date=${day}`, file: `releases-tv-${which}-${day}.json` });
/** A show's seasons. */
const seasonsRequest = (showId) => request({ id: `releases-seasons-${showId}`, kind: 'releases-seasons', args: { showId: String(showId) },
  url: `${TVMAZE}/shows/${encodeURIComponent(showId)}/seasons`, file: `releases-seasons-${showId}.json` });
/** The year's film list. */
const filmsRequest = (year) => request({ id: `releases-films-${year}`, kind: 'releases-films', args: { year }, url: FILMS_PAGE(year), file: `releases-films-${year}.html` });

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };
const clean = (s, max = 120) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * A day's schedule as [{ id, showId, show, weight, stype, season, number, name, type, at (epoch s), day, channel, web, country }],
 * the shows worth keeping only (WEIGHT_KEPT, English, never news, talk or sports, a US channel or a streaming service). null when
 * the reply is not a schedule.
 */
function parseTv(text, { which, day }) {
  const j = json(text);
  if (!Array.isArray(j)) return null;
  const out = [];
  for (const x of j) {
    const show = x && (x._embedded ? x._embedded.show : x.show);
    if (!show || !show.name || !Number.isFinite(x.season)) continue;
    // (a streaming service's schedule lists its own shows, a network's its own: a show carried by both is read where it is asked for)
    const ch = which === 'web' ? show.webChannel : show.network;
    if (!ch) continue;
    const country = ch.country && ch.country.code ? ch.country.code : null;
    if (show.language !== 'English' || NOT_RELEASES.has(show.type) || !((show.weight || 0) >= WEIGHT_KEPT)) continue;
    if (which === 'net' ? country !== 'US' : country && country !== 'US') continue;
    const at = Date.parse(x.airstamp || '');
    out.push({ id: String(x.id), showId: String(show.id), show: clean(show.name, 80), weight: show.weight || 0, stype: show.type || null, season: x.season,
      number: Number.isFinite(x.number) ? x.number : null, name: clean(x.name, 100), type: x.type || 'regular', at: Number.isFinite(at) ? Math.floor(at / 1000) : null,
      day, channel: clean(ch.name, 40) || null, web: which === 'web', country });
    if (out.length >= ITEMS_KEPT) break;
  }
  return out;
}

/** A show's seasons as [{ number, episodes (episodeOrder), first, last ("YYYY-MM-DD") }]; null when the reply is not that. */
function parseSeasons(text) {
  const j = json(text);
  if (!Array.isArray(j)) return null;
  return j.filter((s) => s && Number.isFinite(s.number)).map((s) => ({ number: s.number, episodes: Number.isFinite(s.episodeOrder) ? s.episodeOrder : null,
    first: s.premiereDate || null, last: s.endDate || null }));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// (a table's month cell: its sort value is the month's number, and its label the month's name, misspelt now and then: "Decmber")
const MONTH_CELL = /<th[^>]*?(?:data-sort-value="(\d{1,2})")?[^>]*>\s*<span aria-label="([A-Za-z]{3,})"/;
const monthOf = (m) => { const n = Number(m[1]); if (n >= 1 && n <= 12) return n; const i = MONTHS.indexOf(String(m[2]).slice(0, 3).toLowerCase()); return i >= 0 ? i + 1 : null; };
const pad = (n) => String(n).padStart(2, '0');
const articleOf = (href) => { try { return decodeURIComponent(String(href).replace(/^.*\/wiki\//, '')).replace(/_/g, ' '); } catch { return null; } };

/**
 * The year's film list (the article's HTML) as [{ day ("YYYY-MM-DD"), title, article (the film's own article, spaces), studio }]:
 * every row of the release tables, its month from the table's month cell and its day from the day cell above it (both span rows).
 * A film with no article of its own is left out (nothing can say how much it is read). null when the page holds no release table.
 */
function parseFilms(html, year) {
  const text = String(html || '');
  const start = text.search(MONTH_CELL);
  if (start < 0) return null;
  let month = null;
  let day = null;
  const out = [];
  for (const tr of text.slice(Math.max(0, start - 2000)).split(/<tr[\s>]/).slice(1)) {
    const m = tr.match(MONTH_CELL);
    if (m) month = monthOf(m);
    const d = tr.match(/<td[^>]*>\s*<b[^>]*>\s*(\d{1,2})\s*<\/b>\s*<\/td>/);
    if (d) day = Number(d[1]);
    const f = tr.match(/<td[^>]*>\s*<i[^>]*>\s*<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>\s*<\/i>/);
    if (!f || !month || !day || day > 31) continue;
    const article = articleOf(f[1]);
    if (!article || /[?#]|redlink/.test(f[1])) continue;
    const cells = tr.split(/<\/td>/);
    const studio = cells.length > 2 ? clean(cells[cells.findIndex((c) => c.includes(f[1])) + 1] || '', 80) : '';
    out.push({ day: `${year}-${pad(month)}-${pad(day)}`, title: clean(f[2], 80), article, studio: studio || null });
  }
  return out.length ? out : null;
}

module.exports = { tvRequest, seasonsRequest, filmsRequest, parseTv, parseSeasons, parseFilms, TV_EVERY, FILMS_EVERY, SEASONS_EVERY, WEIGHT_KEPT, TVMAZE, FILMS_PAGE };
