'use strict';
/*
 * What the creator-native lists newly show that is worth a look of its own (ios/IDEAS-FEED.md A4): pure, nothing fetched here.
 *   games   Twitch's thirty most-watched categories, read every cycle: a category NEW to the chart (a release, a surprise event) is a
 *           gaming moment's first sign. New by observation only: the collector had watched the chart for three hours and read it
 *           inside the last hour, so a cold start, or a chart back from back-off, finds nothing new.
 */
const { HOUR, DAY } = require('./util');

const GAME_WATCHED_SECONDS = 3 * HOUR;
const GAME_READ_WITHIN_SECONDS = HOUR;
const GAME_MIN_VIEWERS = 20000;
const GAME_FORGET_SECONDS = 7 * DAY;
const GAMES_PER_CYCLE = 1;
// a category that is no game: where people talk, sleep or gamble on camera
const NOT_A_GAME = /^(?:just chatting|irl|asmr|slots|always on|music|art|sports|special events|talk shows? & podcasts|pools, hot tubs, and beaches|virtual casino|i'm only sleeping|retro|animals, aquariums, and zoos|food & drink|travel & outdoors|politics|software and game development|makers & crafting|beauty & body art|science & technology|chess|poker)$/i;

/**
 * The chart's memory after this cycle's reading, and what is new on it.
 * state: { since (slot the chart was first read), readAt (slot last read), games: { name: { first, last, peak } } } or null.
 * games: [{ name, viewers, rank }] as read now. Returns { state, fresh: [{ name, viewers, rank }] }.
 */
function gameMoves(state, games, t) {
  const old = state && state.games ? state : { since: t, readAt: null, games: {} };
  const watched = t - old.since >= GAME_WATCHED_SECONDS && Number.isFinite(old.readAt) && t - old.readAt <= GAME_READ_WITHIN_SECONDS;
  const next = {};
  for (const [name, g] of Object.entries(old.games)) if (t - g.last <= GAME_FORGET_SECONDS) next[name] = g;
  const fresh = [];
  for (const g of games) {
    const was = next[g.name];
    if (!was && watched && g.viewers >= GAME_MIN_VIEWERS && !NOT_A_GAME.test(g.name)) fresh.push(g);
    next[g.name] = was ? { first: was.first, last: t, peak: Math.max(was.peak || 0, g.viewers) } : { first: t, last: t, peak: g.viewers };
  }
  // (a chart never read before, or not read for over an hour, is watched from now: what it shows then is not new, it is unseen)
  const since = Number.isFinite(old.readAt) && t - old.readAt > GAME_READ_WITHIN_SECONDS ? t : old.since;
  return { state: { since, readAt: t, games: next }, fresh: fresh.sort((a, b) => b.viewers - a.viewers).slice(0, GAMES_PER_CYCLE) };
}

module.exports = { gameMoves, NOT_A_GAME, GAME_MIN_VIEWERS, GAME_WATCHED_SECONDS };
