'use strict';
/*
 * Every source a size can rest on, as a wiki-equivalent estimate in log10 with its sigma (lib/data/size-anchors.json "combine",
 * "proxies"). Calibrated sources become views directly: Wikipedia itself (sigma 0.15), the US searches band (0.61), the outlets
 * count (0.55), Roblox players (0.5). Uncalibrated ones give shape only (lib/size/combine.js rescales them to the calibrated days
 * they share). TikTok chart rank has no magnitude and is never an estimate.
 */
const { ANCHORS } = require('./scale');

const SIGMA = ANCHORS.combine.sigma;
const fitOf = (id) => ANCHORS.proxies.find((p) => p.id === id);
const FITS = Object.fromEntries(['searches', 'outlets', 'players'].map((id) => { const p = fitOf(id); return [id, { a: p.fit.a, b: p.fit.b, sigma: p.sigma }]; }));
// (a Wikipedia day is never read below a tenth of the floor: log10(0) has no place in a weighted mean, and a day that small is 0%
// whatever it is exactly)
const LOG_MIN = Math.log10(ANCHORS.scale.floor / 10);
// a partial article: a calibrated proxy more than this many of its own sigmas above the Wikipedia estimate
const PARTIAL_SIGMAS = 2;
const PARTIAL_SIGMA = 0.6;
// what an uncalibrated series adds to the sigma of the calibrated days it was scaled to
const SHAPE_EXTRA_SIGMA = 0.1;
// a day drawn dotted: its combined sigma is above this (about 11 points)
const ESTIMATED_SIGMA = 0.3;

/** The kinds that are calibrated (a value becomes views), and those that give shape only. */
const CALIBRATED = new Set(['wiki', 'wiki-legacy', 'searches', 'outlets', 'players']);
const SHAPE_ONLY = new Set(['wiki-hourly', 'gdelt', 'tiktok-videos', 'youtube-uploads']);

/** What the chart calls each basis. */
const LABEL = {
  wiki: 'Wikipedia views',
  'wiki-legacy': 'Wikipedia views (converted)',
  'wiki-hourly': 'Wikipedia views',
  searches: 'searches',
  'searches-total': 'searches (running total)',
  outlets: 'news volume',
  gdelt: 'news volume',
  players: 'players',
  'tiktok-videos': 'TikTok videos',
  'youtube-uploads': 'YouTube uploads',
};

/**
 * One calibrated estimate: { kind, log (log10 wiki-equivalent views), sigma }, or null when the value cannot be one (none, zero,
 * not a number: a band of 0 means "not trending there", which is no measurement of size).
 * kind: wiki (excess views), wiki-legacy (converted pre-2015 views), searches (the US band's lower bound), outlets, players.
 */
function estimate(kind, value) {
  if (!Number.isFinite(value)) return null;
  if (kind === 'wiki' || kind === 'wiki-legacy') return { kind, log: Math.max(LOG_MIN, Math.log10(Math.max(value, 1))), sigma: SIGMA.wiki };
  const fit = FITS[kind];
  if (!fit || value <= 0) return null;
  return { kind, log: fit.a + fit.b * Math.log10(value), sigma: fit.sigma };
}

/** The views a proxy's value stands for (10^log of its estimate), or null. */
const viewsOf = (kind, value) => { const e = estimate(kind, value); return e ? Math.pow(10, e.log) : null; };

module.exports = { SIGMA, FITS, LOG_MIN, PARTIAL_SIGMAS, PARTIAL_SIGMA, SHAPE_EXTRA_SIGMA, ESTIMATED_SIGMA, CALIBRATED, SHAPE_ONLY, LABEL, estimate, viewsOf };
