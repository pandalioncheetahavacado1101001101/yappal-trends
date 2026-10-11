'use strict';
/*
 * TikTok's own numbers for a hashtag (ios/IDEAS-FEED.md A5, `tiktok-web`): OFF unless IDEAS_SOURCES_ON names it. The endpoint is the
 * one TikTok's own hashtag page reads, keyless but undocumented, and TikTok's terms forbid scraping: switching it on is the owner's
 * call, never a default. It answers one question only, about a hashtag the list ALREADY has: how many videos and views it holds now.
 * Sampled every cycle that is a real growth curve ("rising on TikTok itself", measured). It cannot discover anything: TikTok has no
 * keyless list of rising hashtags or sounds (its Creative Center asks for signed requests), and no keyless count for a sound.
 */
const { request } = require('./fixed');
const { keyOf } = require('../util');

const TIKTOK_PER_CYCLE = 8;
const TAG_MAX = 40;
const GROWTH_SHARE_AN_HOUR = 0.005; // half a percent of everything it holds, in an hour: about 12% a day
const GROWTH_FLOOR_AN_HOUR = 50;

/** Whether the adapter is switched on. */
const tiktokOn = (env = {}) => String(env.IDEAS_SOURCES_ON || '').split(',').map((x) => x.trim()).includes('tiktok-web');

/** A trend's hashtag: its name run together ("Stop the wedding" -> "stopthewedding"), or null when that is no usable tag. */
function tagOf(name) {
  const tag = keyOf(String(name || '').replace(/\s+(?:trend|meme|challenge|sound|filter)$/i, '')).replace(/ /g, '');
  return tag.length >= 3 && tag.length <= TAG_MAX ? tag : null;
}
const tiktokRequest = (tag) => request({ id: `tiktok-${tag}`, source: 'tiktok-web', kind: 'tiktok-tag', args: { tag }, url: `https://www.tiktok.com/api/challenge/detail/?challengeName=${encodeURIComponent(tag)}`,
  file: `tiktok-tag-${tag}.json`, tier: 3 });

/** A hashtag's totals: { tag, videos, views }, null when the reply is not a hashtag's detail (a block page, an unknown tag). */
function parseTag(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const info = j && j.challengeInfo;
  const stats = info && (info.statsV2 || info.stats);
  const title = info && info.challenge && info.challenge.title;
  if (!stats || !title) return null;
  const videos = Number(stats.videoCount);
  const views = Number(stats.viewCount);
  if (!Number.isFinite(videos) || !Number.isFinite(views) || (videos <= 0 && views <= 0)) return null;
  return { tag: String(title).toLowerCase(), videos, views };
}

/**
 * The hashtags to read this cycle: the list's words, sounds and formats, the ones read longest ago first, `max` at most.
 * rows: [{ tag }] in rank order; readAt: { tag: slot last read }.
 */
function pickTags(rows, readAt = {}, max = TIKTOK_PER_CYCLE) {
  const tags = [...new Set(rows.map((r) => r.tag).filter(Boolean))];
  return tags.map((tag, i) => ({ tag, i, at: readAt[tag] ?? -Infinity })).sort((a, b) => a.at - b.at || a.i - b.i).slice(0, max).map((x) => x.tag);
}

/** Videos gained an hour between an earlier reading and this one, or null when there is no earlier reading inside three hours. */
function growthAnHour(now, earlier) {
  if (!now || !earlier || !Number.isFinite(now.videos) || !Number.isFinite(earlier.videos) || !(now.t > earlier.t) || now.t - earlier.t > 3 * 3600) return null;
  return Math.max(0, (now.videos - earlier.videos) / ((now.t - earlier.t) / 3600));
}
/** Whether that growth is "rising on TikTok itself": half a percent of the hashtag's videos in an hour, and never fewer than fifty. */
const isRising = (growth, videos) => Number.isFinite(growth) && growth >= Math.max(GROWTH_FLOOR_AN_HOUR, GROWTH_SHARE_AN_HOUR * (videos || 0));

module.exports = { tiktokOn, tagOf, tiktokRequest, parseTag, pickTags, growthAnHour, isRising, TIKTOK_PER_CYCLE };
