'use strict';
/*
 * LivestreamFails' clip list (ios/IDEAS-FEED.md L3): the newest clips posted to r/LivestreamFail that have a hundred points or more,
 * each with its Reddit score, served off Reddit. Keyless, one request a cycle (the reply is cached for a minute). Read every cycle,
 * the score of one clip is a real curve of how fast a streamer's moment is being voted up, on a host Reddit itself turns away.
 *
 * A clip's label is the post's title, written by whoever posted it: it names a streamer and what the poster says happened, and it
 * is told as reported. (`querySort=hot` answers with rows from 2018: `new` with a score floor is the form that works.)
 */
const { request } = require('./fixed');

const URL_NEW = 'https://api.livestreamfails.com/clips?querySort=new&queryMinScore=100';
const TITLE_MAX = 200;

const lsfRequest = () => request({ id: 'lsf', source: 'lsf', kind: 'lsf', args: {}, url: URL_NEW, file: 'lsf-clips.json' });

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const seconds = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };

/**
 * The reply as [{ id (the Reddit post's id), title, score, t (posted, epoch seconds), streamer (the channel the clip is of, when the
 * site knows it), category, platform ('twitch', 'kick', 'reddit' ...) }], newest first; null when it is not that list.
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(j)) return null;
  const clips = [];
  for (const c of j) {
    const t = c ? seconds(c.createdAt) : null;
    const id = c && (c.redditId || c.sourceId);
    if (!c || c.deletedAt || !id || !c.label || t === null || !Number.isFinite(Number(c.redditScore))) continue;
    clips.push({ id: String(id), title: clean(c.label).slice(0, TITLE_MAX), score: Number(c.redditScore), t, streamer: c.streamer && c.streamer.label ? clean(c.streamer.label) : null,
      category: c.category && c.category.label ? clean(c.category.label) : null, platform: String(c.sourcePlatform || '').toLowerCase() || null });
  }
  // (an empty list from a host that answered is still a reply: a quiet board, not a block page)
  return clips.sort((a, b) => b.t - a.t);
}

module.exports = { lsfRequest, parse };
