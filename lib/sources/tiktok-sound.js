'use strict';
/*
 * TikTok's own embed page for a sound (ios/IDEAS-FEED.md M11, `tiktok-sound`): OFF unless IDEAS_SOURCES_ON names it. TikTok's
 * terms forbid automated collection, the page refuses most requests ("overload-protect", or a page that asks a browser to prove
 * itself, which is never answered), and it is the owner's call to switch on.
 *
 * It answers one question about a sound the list ALREADY holds: how many videos use it now, as TikTok itself counts (rounded to
 * hundreds), where the charts give yesterday's figure. Four sounds a cycle at most, three seconds apart; the first refusal ends
 * the cycle's turn (the host is then in back-off).
 */
const { request } = require('./fixed');

const EMBED = 'https://www.tiktok.com/embed/music';
const PER_CYCLE = 4;

const soundRequest = (id) => request({ id: `tiktok-sound-${id}`, source: 'tiktok-sound', kind: 'tiktok-sound', args: { id: String(id) }, url: `${EMBED}/${id}`, file: 'tiktok-sound.html', tier: 3 });
/** The sounds read this cycle: the list's own, the ones read longest ago first, four at most. sounds: [{ id }]; readAt: Map(request id -> epoch seconds). */
const turn = (sounds, readAt = new Map(), max = PER_CYCLE) => [...new Set(sounds.map((s) => String(s.id)).filter((id) => /^\d{5,25}$/.test(id)))].map((id, i) => ({ id, i, at: readAt.get(`tiktok-sound-${id}`) ?? -Infinity }))
  .sort((a, b) => a.at - b.at || a.i - b.i).slice(0, max).map((x) => soundRequest(x.id));

/**
 * The page as { id, videos (rounded to hundreds, as the page gives it), topPlays: [plays of its ten lead videos] }; null when it is
 * not that page (a refusal, a challenge page, another sound's page).
 */
function parse(html, id) {
  const m = String(html || '').match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let state = null;
  try { state = JSON.parse(m[1]); } catch { return null; }
  const data = state && state.source && state.source.data;
  const page = data ? data[`/embed/music/${id}`] || Object.entries(data).filter(([k]) => k.startsWith('/embed/music/')).map(([, v]) => v)[0] : null;
  const info = page && page.embedInfo;
  if (!info || String(info.id) !== String(id) || !Number.isFinite(Number(info.videoCount)) || Number(info.videoCount) <= 0) return null;
  // (nothing of the videos but how often each was played: no caption, no account)
  return { id: String(info.id), videos: Number(info.videoCount), topPlays: (page.videoList || []).map((v) => Number(v && v.playCount)).filter(Number.isFinite).slice(0, 10) };
}

module.exports = { PER_CYCLE, soundRequest, turn, parse };
