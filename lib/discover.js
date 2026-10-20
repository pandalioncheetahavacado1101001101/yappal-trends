'use strict';
/*
 * What the creator-native lists newly show that is worth a look of its own (ios/IDEAS-FEED.md A4): pure, nothing fetched here.
 *   games   Twitch's thirty most-watched categories, read every cycle: a category NEW to the chart (a release, a surprise event) is a
 *           gaming moment's first sign. New by observation only: the collector had watched the chart for three hours and read it
 *           inside the last hour, so a cold start, or a chart back from back-off, finds nothing new.
 *   gdelt   GDELT's quarter-hour file, the one the cycle already reads for the list's own people (lib/sources/gdelt.js), read again
 *           for the names it does not hold that break out in the press (lib/sources/gdelt-names.js; ios/IDEAS-SUPER.md P13, the
 *           first part of B9). No request of its own. Counted every cycle the file is read, so the 7-day baseline is warm whenever it
 *           is switched on; it acts only when on (IDEAS_GDELT=1). Off by default: the gate is 6 in 10 of what it passes being a
 *           trend, and on the two frozen days it minted no row and 2 of the 5 names it passed were one (7 of 31 over all of 12
 *           October, labelled by hand against the days' gold). On, each name that breaks out has the slot's headlines naming it
 *           join the store as press rows (the rows a sitemap gives), so the engine weighs it as any press story and the desk decides
 *           whether it is a row at all; and a name the collector has not searched lately, nor the list holds, is searched in the
 *           same cycle, last in its third round, within the budget.
 *           What it did is counted for the ledger (counts only, never a name): names seen, passed, sent for a search, and the rows
 *           of the list it minted (new this cycle, about a name it passed in the last six hours) or boosted (already listed, about a
 *           name breaking out now).
 */
const GDELT = require('./sources/gdelt');
const GN = require('./sources/gdelt-names');
const { HOUR, DAY, keyOf } = require('./util');

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

// (the gate, ios/IDEAS-SUPER.md P13: on by default only once 6 in 10 of what it passes on a frozen day are a trend; 2 in 5 today)
const GDELT_ON_DEFAULT = false;
const GDELT_MINT_WITHIN_SECONDS = 6 * HOUR;
const GDELT_PAGE = 20;
/** Whether GDELT name discovery acts this cycle: IDEAS_GDELT=1 on, 0 off, unset the default (off). */
const gdeltOn = (env = {}) => { const v = String(env.IDEAS_GDELT ?? '').trim(); return v === '' ? GDELT_ON_DEFAULT : v === '1'; };

/**
 * One cycle of GDELT name discovery. state: what the last cycle left (meta) or null; articles: GDELT.parse of the slot the cycle read
 * (null when it read none); slot: that slot; on: whether it acts; searched(name), known(name): searched lately, held by the list.
 * Returns { state, fresh: names to search now (on only), rows: store rows of the slot's headlines naming a name that broke out (on
 * only), keys: those names' keys, stats: { seen, passed, fresh, baseSlots, weekly } } or, with no slot read, the state unchanged and
 * stats null.
 */
function gdeltStep(state, articles, { slot, on = false, searched = () => false, known = () => false, nowMs = Date.now() } = {}) {
  if (!Array.isArray(articles) || !Number.isFinite(slot)) return { state, fresh: [], rows: [], keys: [], stats: null };
  const found = GN.discover(state, articles, { slot, searched, known });
  const keys = found.surging.map((x) => x.key);
  // (a headline dated over an hour ahead of the clock is no headline of this slot: as the reader of the list's own people has it)
  const named = on && keys.length ? GDELT.namedIn(articles, keys) : new Map();
  const rows = [...new Map([...named.values()].flat().filter((a) => a.t <= nowMs + HOUR * 1000).map((a) => GDELT.rowOf(a)).map((r) => [r.key, r])).values()];
  const fresh = on ? found.fresh.map((x) => x.name) : [];
  return { state: found.state, fresh, rows, keys: on ? keys : [], stats: { seen: found.stats.names, passed: found.stats.surging, fresh: fresh.length, baseSlots: found.stats.baseSlots, weekly: found.stats.weekly } };
}

/**
 * What discovery did to the list, counts only: { minted, boosted, page }. items: the list as published ({ id, rank, title }); nameOf(id):
 * the name a row's searches are kept under, or null; mintedIds: the trends minted this cycle; keys: the names breaking out now;
 * state: discovery's state (the names it put first and when); slot: now. A row is GDELT's when its title or its name is one of those
 * names: minted when its trend is new this cycle and the name was put first in the last six hours or breaks out now, boosted when it
 * was already listed and its name breaks out now. page: of those, the ones on page one.
 */
function gdeltTally(items, { nameOf = () => null, mintedIds = new Set(), keys = [], state = null, slot }) {
  const recent = new Set(Object.entries((state && state.found) || {}).filter(([, at]) => Number.isFinite(at) && slot - at <= GDELT_MINT_WITHIN_SECONDS).map(([k]) => k));
  const now = new Set(keys);
  const about = (it, set) => { const hay = ` ${keyOf(it.title)} `; const name = keyOf(nameOf(it.id) || ''); return [...set].some((k) => k === name || hay.includes(` ${k} `)); };
  let minted = 0;
  let boosted = 0;
  let page = 0;
  for (const it of items || []) {
    const isNew = mintedIds.has(it.id);
    const mine = isNew ? about(it, new Set([...recent, ...now])) : about(it, now);
    if (!mine) continue;
    if (isNew) minted += 1; else boosted += 1;
    if (Number.isFinite(it.rank) && it.rank <= GDELT_PAGE) page += 1;
  }
  return { minted, boosted, page };
}

module.exports = { gameMoves, NOT_A_GAME, GAME_MIN_VIEWERS, GAME_WATCHED_SECONDS, gdeltOn, gdeltStep, gdeltTally, GDELT_ON_DEFAULT, GDELT_MINT_WITHIN_SECONDS };
