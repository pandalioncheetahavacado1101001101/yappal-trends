'use strict';
/*
 * The Steam store's own lists (lib/kinds-desk.js, the `games` section): its featured categories (top sellers, new releases, coming
 * soon: store.steampowered.com/api/featuredcategories, the US store, once an hour), and a top seller's own store facts (its kind and
 * the day it comes out: /api/appdetails, once per game, kept). robots.txt allows /api/ on the store.
 *
 * needs permission: Valve (owner's letter pending). Keyless, but the Steam store's and Steam Web API's terms ask for Valve's consent
 * before its data is shown in a commercial product (as for the chart lib/sources/steam.js already reads).
 *
 * The chart of what is played (lib/sources/steam.js) has no day of release; the store's top sellers name the games people are paying
 * for now, a launch among them days before and after its day. Pure: requests to send and replies read into small records.
 */
const { hostOfUrl } = require('../budget');
const { HOUR } = require('../util');

const STORE = 'https://store.steampowered.com/api';
const EVERY = HOUR;
const NAME_MAX = 60;
const TOP_KEPT = 15;

const request = (r) => ({ tier: 3, init: {}, host: hostOfUrl(r.url), source: 'kinds-steam', ...r });
/** The featured categories of the US store. */
const featuredRequest = () => request({ id: 'kinds-steam-featured', kind: 'kinds-steam-featured', args: {}, url: `${STORE}/featuredcategories?cc=US&l=english`, file: 'kinds-steam-featured.json' });
/** One app's kind and day. */
const appRequest = (id) => (/^\d{1,10}$/.test(String(id)) ? request({ id: `kinds-steam-app-${id}`, kind: 'kinds-steam-app', args: { id: String(id) },
  url: `${STORE}/appdetails?appids=${id}&cc=US&l=english&filters=basic,release_date`, file: `kinds-steam-app-${id}.json` }) : null);

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };
const cleanName = (s) => String(s || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/** A category's items as [{ id, name, rank }], one row a game (the lists repeat a game), in the store's order. */
function itemsOf(cat) {
  const seen = new Set();
  const out = [];
  for (const it of (cat && Array.isArray(cat.items) ? cat.items : [])) {
    if (!it || !Number.isFinite(Number(it.id)) || seen.has(String(it.id))) continue;
    const name = cleanName(it.name);
    if (!name) continue;
    seen.add(String(it.id));
    out.push({ id: String(it.id), name, rank: out.length + 1 });
  }
  return out.slice(0, TOP_KEPT);
}

/** The reply as { top, fresh, soon } (top sellers, new releases, coming soon), or null when it is not that reply. */
function parseFeatured(text) {
  const j = json(text);
  if (!j || !j.top_sellers || !Array.isArray(j.top_sellers.items)) return null;
  return { top: itemsOf(j.top_sellers), fresh: itemsOf(j.new_releases), soon: itemsOf(j.coming_soon) };
}

/** "Oct 28, 2026" / "28 Oct, 2026" as "2026-10-28", else null ("Coming soon", "Q1 2027", "2026"). */
function dayOf(s) {
  const t = String(s || '').trim();
  if (!/\b\d{1,2}\b/.test(t) || !/\b\d{4}\b/.test(t) || !/[A-Za-z]{3}/.test(t)) return null;
  const at = Date.parse(`${t.replace(/,/g, ' ')} 12:00 UTC`);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null;
}

/** The reply for app `id` as { id, type ('game', 'dlc', 'hardware' ...), name, day, soon, free }, or null. */
function parseApp(text, id) {
  const j = json(text);
  const x = j && j[String(id)];
  if (!x || typeof x !== 'object') return null;
  if (!x.success || !x.data) return { id: String(id), type: null, name: null, day: null, soon: false, free: false };
  const d = x.data;
  return { id: String(id), type: typeof d.type === 'string' ? d.type : null, name: cleanName(d.name) || null, day: dayOf(d.release_date && d.release_date.date),
    soon: !!(d.release_date && d.release_date.coming_soon), free: !!d.is_free };
}

module.exports = { EVERY, featuredRequest, appRequest, parseFeatured, parseApp, dayOf, cleanName, HOUR };
