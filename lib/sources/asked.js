'use strict';
/*
 * What people ask a search box about a person, with no name handed in (ios/IDEAS-FEED.md L1): Google's completions for templates
 * with a wildcard where the name goes ("what did * do streamer"), and Bing's for the same questions as a second opinion. Keyless,
 * a dozen small requests a cycle on the host the name completions already use.
 *
 * A completion is a question, never an answer: it says people are asking about a name, and sometimes what about (a ban, a
 * cancelling). It carries no time and no volume, so it is NEW only by observation: the same template was read without it inside the
 * three hours before, and it was not seen in the seven days before that (lib/native-ledger.js). An evergreen question ("why is
 * everyone so mean to me") is seen once and never new again.
 */
const { request } = require('./fixed');
const { keyOf } = require('../util');

const GOOGLE = 'https://suggestqueries.google.com/complete/search';
const BING = 'https://api.bing.com/osjson.aspx';
const COMPLETIONS_MAX = 25;
const NAME_WORDS_MAX = 3;

// Each template: what is sent (`q`, the wildcard where a name goes), how a completion is read back (`re`: group 1 the name, group
// 2 what trails it), the noun family the question itself says (talk-nouns' keys; null when it only asks what someone did), and
// `streamer`: the question itself calls the name a streamer.
const TEMPLATES = [
  { id: 'did-streamer', q: 'what did * do streamer', re: /^what did (.+?) do streamer(?: (.+))?$/, family: null, streamer: true },
  { id: 'did-tiktok', q: 'what did * do tiktok', re: /^what did (.+?) do (?:on )?tiktok(?:er)?(?: (.+))?$/, family: null, creator: true },
  { id: 'banned-twitch', q: 'why was * banned on twitch', re: /^why was (.+?) banned on twitch(?: (.+))?$/, family: 'quit', streamer: true },
  { id: 'got-banned', q: 'why did * get banned', re: /^why did (.+?) get banned(?: (?:from|on|in) (.+))?$/, family: 'quit' },
  { id: 'cancelled', q: 'why is * getting cancelled', re: /^why is (.+?) getting cancell?ed(?: (.+))?$/, family: 'backlash' },
  { id: 'hate', q: 'why is * getting hate', re: /^why is (.+?) getting hate(?: (.+))?$/, family: 'backlash' },
  { id: 'happened-streamer', q: 'what happened to streamer *', re: /^what happened to streamer (.+?)()$/, family: null, streamer: true },
  { id: 'allegations', q: '* allegations explained', re: /^(.+?) allegations explained()$/, family: 'allegations' },
  { id: 'everyone', q: 'why is everyone ', re: /^why is everyone (?:so )?(?:mad at|angry at|upset with|hating on|dragging|cancell?ing|boycotting|unfollowing|talking about) (.+?)()$/, family: null },
  { id: 'everyone-yt', q: 'why is everyone ', ds: 'yt', re: /^why is everyone (?:so )?(?:mad at|angry at|upset with|hating on|dragging|cancell?ing|boycotting|unfollowing|talking about) (.+?)()$/, family: null },
  { id: 'everyone-mad', q: 'why is everyone mad at ', re: /^why is everyone mad at (.+?)()$/, family: 'backlash' },
];
// (the same questions put to Bing, two a cycle in turn: a completion on both engines is a safer call than one on either)
const BING_TEMPLATES = ['did-streamer', 'banned-twitch', 'cancelled', 'everyone', 'everyone-mad', 'got-banned'];
const BING_PER_CYCLE = 2;

const templateOf = (id) => TEMPLATES.find((t) => t.id === id) || null;
const enc = (q) => encodeURIComponent(q).replace(/%20/g, '+');

/** Google's completions for every template: one request each, tier 0 (they say who to look at in this very cycle). */
function googleRequests() {
  return TEMPLATES.map((t) => request({ id: `asked-${t.id}`, source: 'asked', kind: 'asked', args: { template: t.id, engine: 'google' },
    url: `${GOOGLE}?client=chrome&hl=en&gl=us${t.ds ? `&ds=${t.ds}` : ''}&q=${enc(t.q)}`, file: `asked-${t.id}.json` }));
}
/** Bing's completions for the next `n` of its templates after `cursor`: { requests, cursor }. */
function bingRequests(cursor = 0, n = BING_PER_CYCLE) {
  const start = ((cursor % BING_TEMPLATES.length) + BING_TEMPLATES.length) % BING_TEMPLATES.length;
  const ids = Array.from({ length: Math.min(n, BING_TEMPLATES.length) }, (_, i) => BING_TEMPLATES[(start + i) % BING_TEMPLATES.length]);
  return { cursor: (start + ids.length) % BING_TEMPLATES.length,
    requests: ids.map((id) => request({ id: `asked-bing-${id}`, source: 'asked-bing', kind: 'asked', args: { template: id, engine: 'bing' },
      url: `${BING}?query=${enc(templateOf(id).q)}&market=en-US`, file: `asked-bing-${id}.json`, tier: 2 })) };
}

/**
 * A completions reply (Google's and Bing's are one shape: [query, [completions], ...]) as [{ q, pos (1 = first), rel (Google's own
 * score, or null) }], or null when it is not that reply (a block page, an error).
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(String(text || '').replace(/^\)\]\}'\s*/, '')); } catch { return null; }
  if (!Array.isArray(j) || typeof j[0] !== 'string' || !Array.isArray(j[1])) return null;
  const rel = j[4] && Array.isArray(j[4]['google:suggestrelevance']) ? j[4]['google:suggestrelevance'] : [];
  return j[1].filter((q) => typeof q === 'string' && q.trim()).slice(0, COMPLETIONS_MAX)
    .map((q, i) => ({ q: q.replace(/\s+/g, ' ').trim().toLowerCase(), pos: i + 1, rel: Number.isFinite(rel[i]) ? rel[i] : null }));
}

// what trails a name in a question and is no part of it
const TRAILING = /\s+(?:right now|today|now|lately|recently|this week|tonight|again|so much|all of a sudden|suddenly|on (?:tiktok|twitter|x|twitch|kick|youtube|instagram|reddit|stream)|in \d{4}|\d{4})$/;
// a fill that is no name at all: a pronoun, the platform itself, a thing everyone is "mad at"
const NOT_A_NAME = /^(?:i|me|you|he|she|we|they|it|us|them|my \w+|your \w+|everyone|everybody|people|someone|tiktok|twitch|kick|youtube|youtubers?|streamers?|tiktokers?|instagram|twitter|x|roblox|fortnite|minecraft|america|americans|the \w+|a \w+|an \w+)$/;

/**
 * Who a completion asks about: { template, name (as typed, lower case), key, family, streamer, creator, rest } or null when the
 * completion does not fit its template or its fill is no name (a pronoun, the platform, more than three words).
 */
function askedOf(templateId, completion) {
  const t = templateOf(templateId);
  if (!t) return null;
  const m = String(completion || '').toLowerCase().trim().match(t.re);
  if (!m) return null;
  let name = m[1].trim();
  while (TRAILING.test(name)) name = name.replace(TRAILING, '').trim();
  const key = keyOf(name);
  if (!key || key.length < 2 || NOT_A_NAME.test(key) || key.split(' ').length > NAME_WORDS_MAX || /^\d+$/.test(key)) return null;
  return { template: t.id, name, key, family: t.family, streamer: !!t.streamer, creator: !!t.creator || !!t.streamer, rest: (m[2] || '').trim() || null };
}

module.exports = { TEMPLATES, BING_TEMPLATES, BING_PER_CYCLE, templateOf, googleRequests, bingRequests, parse, askedOf };
