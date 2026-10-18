'use strict';
/*
 * The sheet's own fields of a detail (ios/IDEAS-FEED.md D4, added 2026-10-18): the example posts the collector itself linked to the
 * story (`posts`), Google Trends' related queries for its own searches (`related`), and where the story was seen, kind by kind, with
 * the collector's own first-seen times (`spread`). Pure: a row, what the state kept of its trend and a lookup go in; nothing is
 * fetched or written here. Every rule is general; the examples in the comments are of stories other than any benchmark's.
 */
const W = require('../engine/wording');
const FOCUS = require('../engine/story-focus');
const SG = require('./signals');
const { BOARD } = require('./native-desk');
const { keyOf, instant, homeGeos, HOUR } = require('./util');

const POSTS_MAX = 3;
const POST_TITLE_MAX = 90;
const RELATED_MAX = 5;
const QUERY_MAX = 60;
const SPREAD_MAX = 6;
// (a kind nothing of the story has reached in two days has gone quiet: the list says where the story is, not where it has ever been)
const SPREAD_QUIET = 48 * HOUR;
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
const REDDIT_ID = /^[a-z0-9]{4,12}$/i;
const LJ_ID = /^\d{3,12}$/;
const CLIP_URL = /^https:\/\/(?:clips\.twitch\.tv|kick\.com)\/\S+$/;
const REDDIT_URL = /^https:\/\/(?:www\.|old\.)?reddit\.com\/\S+$/;
const WHERE = { search: 'Google searches', x: 'X', bluesky: 'Bluesky', press: 'the press', youtube: 'YouTube commentary', lsf: 'r/LivestreamFail', 'clips:twitch': 'Twitch', 'clips:kick': 'Kick',
  meme: 'Know Your Meme', tiktok: 'a TikTok chart', asked: 'a search box', platform: 'Twitch', ontd: 'ONTD', roundup: 'a trend roundup', apps: 'an app chart', games: 'a game chart', wikt: 'a dictionary' };

const num = (x) => (Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
/**
 * A maker's title quoted as such, with its shouting made ordinary. Shouting is a run of two or more words in capitals ("MARA QUILL
 * JUST GOT BANNED", "BREAKING NEWS:"), written as a title ("Mara Quill Just Got Banned"), or one word in capitals that a dictionary
 * spells small ("BANNED", "WORSE"), written as the rest of the title is written (capitalised in a Title Case title or first, small
 * otherwise). A word in capitals on its own that no dictionary spells is an acronym and stays ("WWE", "SNL", "DWTS"): "WWE star
 * BANNED after SNL joke" reads "WWE star banned after SNL joke". Cut at a word.
 */
function ordinaryCase(title, max) {
  const ws = String(title || '').replace(/[“”"]/g, '').replace(/\s+/g, ' ').replace(/[.!?…]+$/, '').trim().split(' ');
  const letters = (w) => w.replace(/[^\p{L}]/gu, '');
  const isLong = (w) => letters(w).length >= 3;
  const shouted = (w) => isLong(w) && letters(w) === letters(w).toUpperCase();
  // ("OF", "A", "I": a short word in capitals joins the run of shouting around it)
  const joins = (w) => letters(w).length > 0 && !isLong(w) && letters(w) === letters(w).toUpperCase();
  const plain = (w) => W.inDict(letters(w).toLowerCase()) && !W.isProperWord(letters(w).toLowerCase());
  const inRun = new Array(ws.length).fill(false);
  for (let i = 0; i < ws.length;) {
    if (!shouted(ws[i])) { i += 1; continue; }
    let k = i;
    let last = i;
    let count = 0;
    while (k < ws.length && (shouted(ws[k]) || joins(ws[k]))) { if (shouted(ws[k])) { count += 1; last = k; } k += 1; }
    if (count >= 2) for (let x = i; x <= last; x += 1) inRun[x] = true;
    i = k;
  }
  const ordinary = ws.map((w, x) => inRun[x] || (shouted(w) && plain(w)));
  const long = ws.filter(isLong);
  // (a title shouted throughout, names and all, is written as a title)
  const allShout = long.length > 0 && ws.filter((w, x) => ordinary[x] && isLong(w)).length * 2 >= long.length;
  const titled = allShout || W.isTitleCase(ws);
  const cap = (w) => w.replace(/[\p{L}']+/gu, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
  const small = (w) => w.replace(/[\p{L}']+/gu, (m) => m.toLowerCase());
  const calm = ws.map((w, x) => {
    if (!ordinary[x]) return w;
    if (inRun[x] || x === 0 || titled) return cap(w);
    return small(w);
  }).join(' ');
  // (cut at a word, as a line's quote is; the case is settled above and not touched again: lib/native-signals.js quotable, which
  // writes every run of four capitals small, would read "DWTS" as "Dwts")
  return cutAtWord(calm, max);
}
/** A title cut at a word with an ellipsis when it runs past `max` characters, never shorter than 30. */
function cutAtWord(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 30)).replace(/[,;:\s]+$/, '')}…`;
}
const boardName = (sub) => BOARD[sub] || `r/${sub}`;
/** "<channel>: <title>", as a clip chart's row is titled (lib/sources/clips.js clipRows), as { who, title }. */
const splitClip = (title) => { const m = String(title || '').match(/^([^:]{1,40}):\s+(.+)$/); return m ? { who: m[1].trim(), title: m[2].trim() } : { who: null, title: String(title || '').trim() }; };

/**
 * The example posts (D4 `posts`): the videos, clips and threads the collector linked to the row for itself, three at most, ranked by
 * what their source counts (views, points, replies), the newest first on ties, an unknown count last. Only what carries its own
 * address: a roster channel's upload (its id), a clip on r/LivestreamFail (its post id), a thread on a board or ONTD (its id), and
 * the clip charts' and the creators' boards' rows the engine linked with their own addresses. A Reddit username is never stored,
 * so none is ever shown. A streamer's clip of a game night, say, that names nobody and says nothing was never linked, and is not here.
 * A post's title is quoted as its maker wrote it, so it is held to what the engine holds every line to (engine/story-focus.js):
 * one with a slur or a censored word, one that states a wrongdoing claim flat, or one naming a person the row's own sources never
 * print (namesStranger: a board's title routinely names an ex, an accuser or a minor the outlets never print) is not shown; and
 * only a title that names the row's subject is (a person by their surname at least, as the engine reads a line). people, tags,
 * heads: as lib/describe.js gives them (aboutOf, headlinesOf), the same the related searches are checked against.
 */
function postsOf(row, t, { people = [], tags = [], heads = [] } = {}) {
  const out = [];
  const subject = keyOf(row.subject || row.surface || '');
  const sw = subject.split(' ').filter(Boolean);
  const last = sw.length >= 2 && row.meta && row.meta.person ? sw[sw.length - 1] : null;
  const aboutRow = (title) => { const k = ` ${keyOf(title)} `; return (!!subject && k.includes(` ${subject} `)) || (!!last && k.includes(` ${last} `)); };
  const own = keyOf(`${row.title || ''} ${row.subject || ''} ${row.surface || ''}`).split(' ').filter(Boolean);
  const named = [...people.map((p) => p && p.key).filter(Boolean), ...tags.filter(Boolean)];
  const fit = (title) => aboutRow(title) && !FOCUS.unsafeLine(String(title)) && !namesStranger(keyOf(title), named, heads, own);
  const push = (p) => { if (p.title && p.url && Number.isFinite(p.at) && p.at <= t && fit(p.title)) out.push(p); };
  for (const i of SG.nativeOf(row).items) {
    if (!i || !i.id || !i.title || !Number.isFinite(i.t)) continue;
    const at = Math.floor(i.t / 1000);
    if (i.k === 'upload' && YT_ID.test(i.id)) push({ kind: 'video', title: i.title, who: i.who || (i.outlet && !/^youtube$/i.test(i.outlet) ? i.outlet : null), where: 'YouTube', url: `https://www.youtube.com/watch?v=${i.id}`, number: num(i.n), at });
    else if (i.k === 'clip' && i.sub === 'livestreamfail' && REDDIT_ID.test(i.id)) push({ kind: 'clip', title: i.title, who: i.who || null, where: 'r/LivestreamFail', url: `https://www.reddit.com/r/LivestreamFail/comments/${i.id}/`, number: num(i.n), at });
    else if (i.k === 'post' && i.sub === 'ontd' && LJ_ID.test(i.id)) push({ kind: 'thread', title: i.title, who: null, where: 'ONTD', url: `https://ohnotheydidnt.livejournal.com/${i.id}.html`, number: num(i.n), at });
    else if (i.k === 'post' && i.sub && /^[a-z0-9_]{2,30}$/i.test(i.sub) && REDDIT_ID.test(i.id)) push({ kind: 'thread', title: i.title, who: null, where: boardName(i.sub), url: `https://www.reddit.com/r/${i.sub}/comments/${i.id}/`, number: null, at });
  }
  // (what the engine linked with an address of its own: a clip chart's clip, a creators' board's thread. Never a headline)
  for (const r of (row.meta && row.meta.own) || []) {
    if (!r || !r.url || !r.title || !Number.isFinite(r.t)) continue;
    const at = Math.floor(r.t / 1000);
    if (/^(?:twitch|kick)$/i.test(r.outlet || '') && CLIP_URL.test(r.url)) { const c = splitClip(r.title); push({ kind: 'clip', title: c.title, who: c.who, where: /^kick$/i.test(r.outlet) ? 'Kick' : 'Twitch', url: r.url, number: null, at }); }
    else if (r.fam === 'reddit' && REDDIT_URL.test(r.url)) push({ kind: 'thread', title: r.title, who: null, where: r.sub ? boardName(String(r.sub).toLowerCase()) : 'Reddit', url: r.url, number: null, at });
  }
  const seen = new Set();
  return out.filter((p) => !seen.has(p.url) && seen.add(p.url))
    .sort((a, b) => (b.number ?? -1) - (a.number ?? -1) || b.at - a.at)
    .slice(0, POSTS_MAX)
    .map((p) => ({ kind: p.kind, title: ordinaryCase(p.title, POST_TITLE_MAX), who: p.who ? String(p.who).slice(0, 80) : null, where: p.where, url: p.url, number: p.number, at: instant(p.at) }));
}

// what people type beside a name that no dictionary spells: the platforms, the sites, the shows and leagues, the creators' own words
const TYPED_WORDS = new Set(['tiktok', 'youtube', 'twitch', 'kick', 'instagram', 'reddit', 'snapchat', 'spotify', 'netflix', 'onlyfans', 'twitter', 'discord', 'hulu', 'bluesky', 'facebook',
  'roblox', 'fortnite', 'minecraft', 'snl', 'nfl', 'nba', 'mlb', 'nhl', 'wwe', 'ufc', 'mma', 'dwts', 'vmas', 'emmys', 'oscars', 'grammys', 'usa', 'livestream', 'vtuber', 'esports', 'podcast',
  'mods', 'mod', 'vod', 'vods', 'subs', 'sub', 'dms', 'fyp', 'pov', 'irl', 'youtuber', 'tiktoker', 'vlog', 'vlogger', 'brainrot', 'stan', 'stans', 'rizz', 'cringe', 'sus', 'lol', 'lmao', 'bro', 'bruh', 'ngl', 'imo', 'tbh', 'wtf', 'omg']);
/**
 * A word the dictionary spells small ("ban", "state" and "will" are words it also capitalises, and still words), an inflection of
 * one, or a compound of two ("girlfriend", "livestream"); never a word only its capitalised list spells ("john", "jessica", "elon").
 */
function plainWord(w) {
  const word = (x) => (W.isDictWord(x) || (W.inDict(x) && !W.isProperWord(x))) && !W.isFirstName(x);
  if (W.isDictWord(w) || (W.inDict(w) && !W.isProperWord(w))) return true;
  for (let i = 3; i + 4 <= w.length; i++) if (word(w.slice(0, i)) && word(w.slice(i))) return true;
  return false;
}
/**
 * Whether a query or a title names someone the row's own sources never print (D4 `related` and `posts`): it is kept only when every
 * word of it is a dictionary word, a number, a word of two letters, a platform's or the creators' own word, or a word the row's own
 * title, subject, people, tags or headlines print (an acronym the headlines print counts: "DWTS"); a word no dictionary spells
 * small is somebody's name ("john", "jessica", "zaid", "oakley"), and so is a given name the dictionary also spells as a word
 * ("grace", "dale", "will") when such a word follows it. A surname the dictionary spells, "smith", "baker", is a plain word on its
 * own: "kai cenat girlfriend name", "why was mara quill banned", "mara quill twitch ban clip" and "will mara quill get banned"
 * pass; "kai cenat jessica smith", "kai cenat john baker", "mara quill marisol vega" and "tyler oakley" do not. Google's related
 * queries for a creator in a drama are exactly where an accuser's or an ex's name turns up, and a board's post title names them
 * too (2026-10-19). named: people keys and tags; heads: the row's headlines; own: the words the row's own title, subject and
 * surface print.
 */
function namesStranger(key, named = [], heads = [], own = []) {
  const printed = new Set([...own, ...named.flatMap((n) => String(n || '').split(' ')), ...heads.flatMap((h) => keyOf(h).split(' '))].filter(Boolean));
  const ws = String(key || '').split(' ').filter(Boolean);
  const known = (w) => printed.has(w) || /^\d/.test(w) || w.length <= 2 || TYPED_WORDS.has(w);
  const nameWord = (w) => !known(w) && !plainWord(w);
  const givenBefore = (w, next) => !known(w) && W.isFirstName(w) && next !== undefined && nameWord(next);
  return ws.some((w, i) => nameWord(w) || givenBefore(w, ws[i + 1]));
}
/**
 * The related searches (D4 `related`): Google Trends' related queries of the row's own searches, the home country's first and the
 * bigger search first within it, five at most. Dropped: one that only repeats the title or the subject (every word of it is the
 * card's), and one naming a person the row's own sources never print (namesStranger: a co-star's name under a singer's cancelled
 * show is that co-star's story, and nobody the card is about). lookup(key): the entry's related queries, as the store holds them.
 */
function relatedOf(row, lookup, { audience = 'US', people = [], tags = [], heads = [] } = {}) {
  if (typeof lookup !== 'function') return [];
  const home = new Set(homeGeos(audience));
  const entries = ((row.meta && row.meta.trends) || []).filter((x) => x && x.key).map((x) => ({ key: x.key, home: home.has(x.geo), volume: x.volume || 0 }))
    .sort((a, b) => Number(b.home) - Number(a.home) || b.volume - a.volume);
  const own = new Set(keyOf(`${row.title || ''} ${row.subject || ''} ${row.surface || ''}`).split(' ').filter(Boolean));
  const named = [...people.map((p) => p && p.key).filter(Boolean), ...tags.filter(Boolean)];
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    for (const q of lookup(e.key) || []) {
      const text = String(q || '').trim();
      const k = keyOf(text);
      if (!k || seen.has(k) || text.length > QUERY_MAX) continue;
      if (k.split(' ').every((w) => own.has(w))) continue;
      if (namesStranger(k, named, heads, [...own])) continue;
      seen.add(k);
      out.push(text);
      if (out.length >= RELATED_MAX) return out;
    }
  }
  return out;
}

/** The plain name of a kind of source (lib/signals.js seenOf keys), or null for one the sheet does not name. */
function whereName(key) {
  if (WHERE[key]) return WHERE[key];
  const m = key.match(/^reddit:([a-z0-9_]+)$/);
  return m ? boardName(m[1]) : null;
}
/**
 * Where the story was seen (D4 `spread`): each kind of source with the collector's own first-seen time for it, oldest first, six at
 * most, a kind that went quiet (nothing of it inside the last 48 hours) left out, one name once (a ban flag and a clip chart both
 * say "Twitch": the earlier stands). seen: { kind: { first, last } } as lib/history.js keeps it (epoch seconds).
 */
function spreadOf(seen, t) {
  const names = new Set();
  return Object.entries(seen || {})
    .filter(([, v]) => v && Number.isFinite(v.first) && v.first <= t && Number.isFinite(v.last) && t - v.last <= SPREAD_QUIET)
    .map(([k, v]) => ({ where: whereName(k), at: v.first })).filter((x) => x.where)
    .sort((a, b) => a.at - b.at || a.where.localeCompare(b.where))
    .filter((x) => !names.has(x.where) && names.add(x.where))
    .slice(0, SPREAD_MAX)
    .map((x) => ({ where: x.where, at: instant(x.at) }));
}

module.exports = { postsOf, relatedOf, spreadOf, namesStranger, whereName, ordinaryCase, POSTS_MAX, RELATED_MAX, SPREAD_MAX, SPREAD_QUIET };
