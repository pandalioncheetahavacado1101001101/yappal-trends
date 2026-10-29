'use strict';
/*
 * Clip charts (ios/IDEAS-FEED.md A4, A5): Twitch's and Kick's most-watched clips of the day, one request each a cycle. They are the
 * raw material of the streamer boards, and what stands in for those boards on a host Reddit turns away. Both are public web endpoints
 * nobody documents, so each is isolated here, capped at one request a cycle, and simply absent the cycle it is turned away.
 *
 * A chart is mostly play ("wow", "poop", "breakup advice"): every big streamer has a clip on it every day, and that is no signal of
 * any story. Only a clip that TELLS something becomes a row the engine reads: its title says a noun people argue about (a ban, a
 * leak, an apology ...) or names another creator of the roster. Such a row counts like a creator's upload: it names its streamer, it
 * is timed by the clip itself, and it never words a line.
 * needs permission: Kick (kick.com/robots.txt disallows "/*?*sort=", which the clips URL is; read 2026-10-29). owner sign-up: a registered
 * Twitch application's client id for IDEAS_TWITCH_CLIENT_ID (gql.twitch.tv/robots.txt allows every path).
 */
const TN = require('../../engine/talk-nouns');
const { request } = require('./fixed');
const { keyOf } = require('../util');

const TWITCH_URL = 'https://gql.twitch.tv/gql';
// The id Twitch's own website sends with every public request (it is printed in the site's pages: an identifier, not a secret, and
// not this project's). IDEAS_TWITCH_CLIENT_ID replaces it with a registered application's.
const TWITCH_WEB_CLIENT = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const TWITCH_BOARDS = [['chat', 'Just Chatting', 25], ['irl', 'IRL', 10]];
const TWITCH_GAMES = 30;
const KICK_URL = 'https://kick.com/api/v2/clips?sort=view&time=day';
const TITLE_MAX = 140;
const ROSTER_NAME_WORDS = 2;

const clipFields = 'slug title viewCount createdAt broadcaster { login displayName } game { name }';
const twitchQuery = () => `query { ${TWITCH_BOARDS.map(([alias, name, n]) => `${alias}: game(name: ${JSON.stringify(name)}) { clips(first: ${n}, criteria: { period: LAST_DAY, languages: [EN], sort: VIEWS_DESC }) { edges { node { ${clipFields} } } } }`).join(' ')} games(first: ${TWITCH_GAMES}) { edges { node { name viewersCount } } } }`;

/** Twitch: the day's most-watched English clips of its two talk categories, and its thirty most-watched categories right now. */
function twitchRequest(env = {}) {
  const client = String(env.IDEAS_TWITCH_CLIENT_ID || '').trim() || TWITCH_WEB_CLIENT;
  return request({ id: 'twitch', source: 'twitch', kind: 'twitch', args: {}, url: TWITCH_URL, file: 'twitch-clips.json',
    init: { method: 'POST', headers: { 'Client-Id': client, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: twitchQuery() }) } });
}
/** Kick: the day's most-watched clips. */
const kickRequest = () => request({ id: 'kick', source: 'kick', kind: 'kick', args: {}, url: KICK_URL, file: 'kick-clips.json' });

const safeJson = (text) => { try { return JSON.parse(text); } catch { return null; } };
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
const seconds = (iso) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };

/**
 * Twitch's reply as { clips: [{ src, id, channel, login, title, views, t (epoch seconds), board, rank, url }], games: [{ name,
 * viewers, rank }] }, or null when it is not a proper reply (an error page, a reply with no data).
 */
function parseTwitch(text) {
  const d = (safeJson(text) || {}).data;
  if (!d || typeof d !== 'object' || !TWITCH_BOARDS.some(([alias]) => d[alias] && d[alias].clips) ) return null;
  const clips = [];
  for (const [alias, board] of TWITCH_BOARDS) {
    const edges = (d[alias] && d[alias].clips && d[alias].clips.edges) || [];
    edges.forEach((e, i) => {
      const n = e && e.node;
      const t = n ? seconds(n.createdAt) : null;
      if (!n || !n.title || !n.broadcaster || !n.broadcaster.login || t === null) return;
      clips.push({ src: 'twitch', id: String(n.slug || `${n.broadcaster.login}-${t}`), channel: clean(n.broadcaster.displayName || n.broadcaster.login), login: String(n.broadcaster.login).toLowerCase(),
        title: clean(n.title), views: Number(n.viewCount) || 0, t, board, rank: i + 1, url: n.slug ? `https://clips.twitch.tv/${encodeURIComponent(n.slug)}` : null });
    });
  }
  const games = ((d.games && d.games.edges) || []).map((e, i) => ({ name: clean(e && e.node && e.node.name), viewers: Number(e && e.node && e.node.viewersCount) || 0, rank: i + 1 })).filter((g) => g.name);
  return { clips, games };
}

/** Kick's reply as { clips: [...] } in the same shape, or null when it is not a proper reply. */
function parseKick(text) {
  const j = safeJson(text);
  if (!j || !Array.isArray(j.clips)) return null;
  const clips = [];
  j.clips.forEach((c, i) => {
    const t = c ? seconds(c.created_at) : null;
    const channel = c && c.channel;
    if (!c || !c.title || !channel || !channel.username || t === null) return;
    const slug = String(channel.slug || channel.username).toLowerCase();
    clips.push({ src: 'kick', id: String(c.id || `${slug}-${t}`), channel: clean(channel.username), login: slug, title: clean(c.title), views: Number(c.view_count ?? c.views) || 0, t,
      board: clean(c.category && c.category.name) || null, rank: i + 1, url: c.id ? `https://kick.com/${encodeURIComponent(slug)}/clips/${encodeURIComponent(c.id)}` : null });
  });
  return { clips };
}

/** The roster's creators a title names, of two words or more (a handle a clip title drops is nobody's): [name keys]. roster: Map(key -> { name }). */
function rosterNamed(title, roster) {
  if (!roster || !roster.size) return [];
  const h = ` ${keyOf(title)} `;
  const out = [];
  for (const key of roster.keys()) if (key.split(' ').length >= ROSTER_NAME_WORDS && h.includes(` ${key} `)) out.push(key);
  return out;
}

/**
 * Whether a clip tells something (see the head of this file): { tells, families: [family keys], names: [roster keys it names beside
 * its own channel] }. Never a clip of a game or a bit ("gets arrested in GTA RP").
 */
function clipTells(clip, roster = null) {
  const own = new Set([keyOf(clip.channel), keyOf(clip.login)]);
  const families = TN.familiesIn(clip.title).filter((x) => TN.DRAMA_FAMS.has(x.f.key)).map((x) => x.f.key);
  const names = rosterNamed(clip.title, roster).filter((k) => !own.has(k) && !own.has(k.replace(/ /g, '')));
  const play = /\b(?:gta|rp|roleplay|role-play|in-game|in game|skit|parody|prank|pranked|fake|staged|acting)\b/i.test(`${clip.title} ${clip.board || ''}`);
  return { tells: !play && (families.length > 0 || names.length > 0), families: [...new Set(families)], names };
}

const LABEL = { twitch: 'Twitch', kick: 'Kick' };
/**
 * The telling clips as rows of the engine's store: talking points only, led by the streamer's name as the chart spells it
 * ("Vexmo: addresses the leak"), published by the chart ("Twitch": the engine counts it as a creator's upload), timed by the clip.
 */
function clipRows(clips, roster = null) {
  return clips.filter((c) => clipTells(c, roster).tells).map((c) => ({ key: `clip:${c.src}:${c.id}`, title: `${c.channel}: ${c.title}`, url: c.url, t: c.t * 1000, publisher: LABEL[c.src],
    src: `clips-${c.src}`, fam: 'gnews', label: LABEL[c.src], w: 0.6, talkOnly: true, clip: true, views: c.views }));
}

/** Whether an outlet's name is a clip chart's (what lib/signals.js reads as the `clips` kind). */
const isClipOutlet = (outlet) => /^(?:twitch|kick)$/i.test(String(outlet || ''));

module.exports = { twitchRequest, kickRequest, parseTwitch, parseKick, clipTells, clipRows, rosterNamed, isClipOutlet, TWITCH_BOARDS, TWITCH_GAMES };
