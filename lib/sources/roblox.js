'use strict';
/*
 * Roblox's own explore lists (ios/IDEAS-FEED.md M10): Top Trending, Up-and-Coming and Top Playing Now, each game with how many are
 * playing it right now, and a game's own record for the day it was made. The calls behind Roblox's public pages, keyless and
 * undocumented, read once an hour.
 *
 * What it gives the list is a craze a creator can film: a game weeks old that is already among the most played. The players are
 * Roblox's own count at the moment of reading, read hour by hour.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const EXPLORE = 'https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=00000000-0000-4000-8000-000000000000&device=computer&country=all';
const GAMES = 'https://games.roblox.com/v1/games';
const EVERY = HOUR;
const SORTS = new Set(['top-trending', 'up-and-coming', 'top-playing-now']);
const DETAIL_IDS_MAX = 50;
const NAME_MAX = 60;

/** The explore lists, asked hourly. (The session id is any UUID: a fixed, made-up one, nobody's.) lastReadAt: epoch seconds or undefined. */
const exploreRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY ? null
  : request({ id: 'roblox-explore', source: 'roblox', kind: 'roblox', args: {}, url: EXPLORE, file: 'roblox-explore.json', tier: 3 }));
/** The records of the games whose day of making is not known yet, fifty a call at most; null with none. ids: universe ids. */
const gamesRequest = (ids) => { const list = [...new Set(ids.map(String).filter((id) => /^\d{3,20}$/.test(id)))].slice(0, DETAIL_IDS_MAX);
  return list.length ? request({ id: 'roblox-games', source: 'roblox', kind: 'roblox-games', args: { ids: list }, url: `${GAMES}?universeIds=${list.join(',')}`, file: 'roblox-games.json', tier: 3 }) : null; };

/** A game's name without the decorations a listing wears: "[🎃] Adopt Me!" is "Adopt Me!", "Game [UPD]" is "Game". */
const cleanName = (name) => String(name || '').replace(/[\[(][^\])]{0,24}[\])]/g, ' ').replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\ufe0f\u200d]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

/**
 * The explore reply as [{ id (universe id), name, players, sorts: [sort ids], place (its best place in a sort, 1 = first) }], the
 * most played first; null when it is not that reply.
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || !Array.isArray(j.sorts)) return null;
  const games = new Map();
  for (const sort of j.sorts) {
    if (!sort || !SORTS.has(sort.sortId) || !Array.isArray(sort.games)) continue;
    sort.games.forEach((g, i) => {
      const name = cleanName(g && g.name);
      if (!g || !g.universeId || !name || g.isSponsored || !Number.isFinite(Number(g.playerCount))) return;
      const id = String(g.universeId);
      const old = games.get(id);
      games.set(id, { id, name, players: Math.max(Number(g.playerCount), old ? old.players : 0), sorts: [...new Set([...(old ? old.sorts : []), sort.sortId])], place: Math.min(i + 1, old ? old.place : Infinity) });
    });
  }
  return games.size ? [...games.values()].sort((a, b) => b.players - a.players) : null;
}
/** The games' records as [{ id, created ("2026-08-31"), visits, genre }]; null when it is not that reply. */
function parseGames(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || !Array.isArray(j.data)) return null;
  return j.data.filter((g) => g && g.id && /^\d{4}-\d\d-\d\d/.test(String(g.created || ''))).map((g) => ({ id: String(g.id), created: String(g.created).slice(0, 10), visits: Number.isFinite(Number(g.visits)) ? Number(g.visits) : null,
    genre: g.genre_l1 || g.genre || null }));
}

module.exports = { EVERY, exploreRequest, gamesRequest, parse, parseGames, cleanName };
