'use strict';
/*
 * Steam's hundred most played games right now (ios/IDEAS-FEED.md M10): rank, how many are in game and the day's peak, by app id,
 * and a second keyless method for the names. Valve's own public web API, read once an hour.
 *
 * PC games only, and no day of release: so a game counts as a craze only by observation, when it is new to the hundred (the chart
 * was read without it inside the three hours before) or has climbed it. A cold start lists nothing from here, which is correct.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const CHART = 'https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/';
const APPS = 'https://api.steampowered.com/ICommunityService/GetApps/v1/';
const EVERY = HOUR;
const NAMES_MAX = 20;

/** The chart, asked hourly. lastReadAt: epoch seconds or undefined. */
const chartRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY ? null
  : request({ id: 'steam-chart', source: 'steam', kind: 'steam', args: {}, url: CHART, file: 'steam-chart.json', tier: 3 }));
/** The names of app ids not named yet, twenty a call at most; null with none. */
const namesRequest = (ids) => { const list = [...new Set(ids.map(String).filter((id) => /^\d{1,10}$/.test(id)))].slice(0, NAMES_MAX);
  return list.length ? request({ id: 'steam-names', source: 'steam', kind: 'steam-names', args: { ids: list }, url: `${APPS}?${list.map((id, i) => `appids%5B${i}%5D=${id}`).join('&')}`, file: 'steam-names.json', tier: 3 }) : null; };

/** The chart as [{ rank, id (app id), players, peak }]; null when it is not that reply. */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const ranks = j && j.response && j.response.ranks;
  if (!Array.isArray(ranks)) return null;
  const rows = ranks.filter((r) => r && r.appid && Number.isFinite(Number(r.concurrent_in_game))).map((r) => ({ rank: Number(r.rank), id: String(r.appid), players: Number(r.concurrent_in_game), peak: Number(r.peak_in_game) || null }));
  return rows.length ? rows : null;
}
/** The names as [{ id, name }]; null when it is not that reply. */
function parseNames(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const apps = j && j.response && j.response.apps;
  if (!Array.isArray(apps)) return null;
  return apps.filter((a) => a && a.appid && typeof a.name === 'string' && a.name.trim()).map((a) => ({ id: String(a.appid), name: a.name.replace(/[™®]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) }));
}

module.exports = { EVERY, chartRequest, namesRequest, parse, parseNames };
