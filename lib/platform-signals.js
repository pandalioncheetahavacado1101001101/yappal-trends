'use strict';
/*
 * The platform, word and craze sources as the list can use them (ios/IDEAS-FEED.md M). Two halves, both pure:
 *   from*      a parsed reply (lib/sources/*.js) as a batch for the platform ledger (lib/native-ledger.js `platform`): what the
 *              source showed, the number it gave, and that its list was read;
 *   thingsOf   the ledger read back into the things a row can be made of: sounds with their counts and their days, formats a
 *              roundup dates, words a dictionary defines, things shoppers call viral, apps and games new to a chart.
 * Nothing here is a headline and nothing is fetched. A number is always its source's own, read when the ledger says.
 */
const TYPED = require('./sources/typed');
const { UNNAMED_SOUND } = require('./sources/roundups');
const { newBatch } = require('./native-ledger');
const { keyOf, HOUR, DAY } = require('./util');

const DAILY_WATCH = 30 * HOUR;
const WEEKLY_WATCH = 8 * DAY;
const ROUNDUP_BACK = 60 * DAY;
const CHART_LIVE = 3 * DAY;
const LIST_LIVE = 4 * DAY;
const HOURLY_LIVE = 4 * HOUR;
const SERIES_PLAYERS_MIN = 5000;
const CLIMB_TOP = 5;
const CLIMB_PLACES = 3;

const batchOf = (items = [], series = [], reads = []) => ({ ...newBatch(), items, series, reads });
/** The start of a calendar day ("2026-10-11") in epoch seconds, or null. */
const dayStart = (day) => { const ms = Date.parse(`${day}T00:00:00Z`); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };
/** A song as lists name it, for telling one list's row from another's: its title without what stands in brackets, and its first artist. */
function songKey(title, artist) {
  const core = String(title || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+-\s+.*$/, ' ').replace(/\s+(?:feat|ft)\.?\s.*$/i, ' ');
  const first = String(artist || '').split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bwith\b)\s*/i)[0];
  return `${keyOf(core)}|${keyOf(first)}`;
}

// ---------- replies as ledger batches ----------
/** A chart of Trending TikTok Songs (lib/sources/tts.js parseChart). */
function fromChart(parsed) {
  const { chart } = parsed;
  return batchOf(parsed.rows.map((r) => ({ source: 'tts', key: `${chart}:${r.id}`, scope: chart, watch: DAILY_WATCH, t: null, title: r.title, who: r.artist, data: { id: r.id, slug: r.slug, chart, rank: r.rank, videos: r.videos, day: parsed.day } })),
    parsed.rows.filter((r) => Number.isFinite(r.videos)).map((r) => ({ source: 'tts', key: r.id, v: r.videos, w: r.rank })), [{ source: 'tts', scope: chart }]);
}
/** One sound's page (parseSong): what it is, and its days, each a number at that day. */
function fromSong(song) {
  // (a page is its own list: reading another sound's page says nothing of this one's being new)
  return batchOf([{ source: 'tts-song', key: song.id, scope: `song:${song.id}`, t: dayStart(song.created), title: song.title, who: song.artist,
    data: { slug: song.slug, created: song.created, firstSeen: song.firstSeen, category: song.category, videos: song.videos, days: song.days.slice(0, 14) } }],
  song.days.map((d) => ({ source: 'tts-song', key: song.id, at: dayStart(d.day), v: d.videos, w: d.change })).filter((p) => p.at !== null), [{ source: 'tts-song', scope: `song:${song.id}` }]);
}
/** A roundup's rows (lib/sources/roundups.js), the last two months of them. now: epoch seconds. */
function fromRoundup(pageId, rows, now) {
  const items = rows.map((r) => ({ r, at: dayStart(r.day) })).filter((x) => x.at !== null && now - x.at <= ROUNDUP_BACK && x.at <= now + DAY)
    .map(({ r, at }) => ({ source: 'roundup', key: `${pageId}|${keyOf(r.name)}|${r.day}`, scope: pageId, watch: 2 * DAY, t: at, title: r.name, who: pageId, data: { page: pageId, day: r.day, sound: r.sound || null, about: r.about || null } }));
  return batchOf(items, [], [{ source: 'roundup', scope: pageId }]);
}
/** The Reels audio page (lib/sources/reels.js). */
function fromReels(parsed) {
  return batchOf(parsed.rows.map((r) => ({ source: 'reels', key: songKey(r.title, r.artist), scope: 'reels', watch: 2 * DAY, t: null, title: r.title, who: r.artist,
    data: { rank: r.rank, format: r.format, heat: r.heat, momentum: r.momentum, reels: r.reels, id: r.id, about: r.about, week: parsed.week } })),
  parsed.rows.filter((r) => Number.isFinite(r.reels)).map((r) => ({ source: 'reels', key: songKey(r.title, r.artist), v: r.reels, w: r.heat })), [{ source: 'reels', scope: 'reels' }]);
}
/** Shazam's discovery chart (lib/sources/shazam.js). */
const fromShazam = (parsed) => batchOf(parsed.rows.map((r) => ({ source: 'shazam', key: songKey(r.title, r.artist), scope: 'discovery', watch: DAILY_WATCH, t: null, title: r.title, who: r.artist, data: { rank: r.rank, day: parsed.day } })),
  [], [{ source: 'shazam', scope: 'discovery' }]);
/** Kworb's Spotify US daily chart (lib/sources/kworb.js). */
const fromKworb = (parsed) => batchOf(parsed.rows.map((r) => ({ source: 'kworb', key: songKey(r.title, r.artist), scope: 'us-daily', watch: DAILY_WATCH, t: null, title: r.title, who: r.artist,
  data: { rank: r.rank, streams: r.streams, change: r.change, days: r.days, day: parsed.day } })), [], [{ source: 'kworb', scope: 'us-daily' }]);
/** A Wiktionary category's newest members (lib/sources/wikt-slang.js). */
const fromWiktCategory = (category, members) => batchOf(members.map((m) => ({ source: 'wikt', key: `${keyOf(m.term)}|${category}`, scope: category, watch: 5 * HOUR, t: m.at, title: m.term, who: keyOf(m.term), data: { category } })),
  [], [{ source: 'wikt', scope: category }]);
/** A word's entry: what it means and when the entry was first written (an entry with no meaning is kept too: it was asked). */
const fromWiktEntry = (entry) => batchOf([{ source: 'wikt-entry', key: keyOf(entry.term), scope: 'entry', t: entry.created, title: entry.term, who: keyOf(entry.term), data: { meaning: entry.meaning, label: entry.label } }], [], []);
/** A template's completions (lib/sources/typed.js): what each names, and its place in the list. */
function fromTyped(templateId, completions) {
  const items = completions.map((c) => ({ c, f: TYPED.fillOf(templateId, c.q) })).filter((x) => x.f)
    .map(({ c, f }) => ({ source: 'typed', key: `${templateId}|${c.q}`, scope: templateId, t: null, title: c.q, who: f.key, data: { template: templateId, kind: f.kind, term: f.term, pos: c.pos, rel: c.rel } }));
  return batchOf(items, items.map((it) => ({ source: 'typed', key: it.key, v: it.data.pos, w: it.data.rel })), [{ source: 'typed', scope: templateId }]);
}
/** Pinterest's growing terms (lib/sources/pinterest.js). */
const fromPinterest = (parsed) => batchOf(parsed.terms.map((x) => ({ source: 'pinterest', key: keyOf(x.term), scope: 'us', watch: WEEKLY_WATCH, t: null, title: x.term, who: null, data: { week: x.week, month: x.month, year: x.year, closes: parsed.week } })),
  [], [{ source: 'pinterest', scope: 'us' }]);
/** One of Apple's charts (lib/sources/apps.js). */
const fromApps = (chartId, rows) => batchOf(rows.map((r) => ({ source: 'apps', key: `${chartId}:${r.id}`, scope: chartId, watch: 6 * HOUR, t: dayStart(r.released), title: r.name, who: r.maker,
  data: { id: r.id, chart: chartId, rank: r.rank, released: r.released, genres: r.genres, full: r.full } })), rows.map((r) => ({ source: 'apps', key: `${chartId}:${r.id}`, v: r.rank })), [{ source: 'apps', scope: chartId }]);
/** Roblox's explore lists (lib/sources/roblox.js), and the games' own records. */
const fromRoblox = (games) => batchOf(games.map((g) => ({ source: 'roblox', key: g.id, scope: 'explore', t: null, title: g.name, who: null, data: { players: g.players, sorts: g.sorts, place: g.place } })),
  games.filter((g) => g.players >= SERIES_PLAYERS_MIN).map((g) => ({ source: 'roblox', key: g.id, v: g.players })), [{ source: 'roblox', scope: 'explore' }]);
const fromRobloxGames = (rows) => batchOf(rows.map((g) => ({ source: 'roblox-game', key: g.id, scope: 'games', t: dayStart(g.created), title: null, who: null, data: { created: g.created, visits: g.visits, genre: g.genre } })), [], []);
/** Steam's chart (lib/sources/steam.js), and the games' names. */
const fromSteam = (rows) => batchOf(rows.map((g) => ({ source: 'steam', key: g.id, scope: 'chart', t: null, title: null, who: null, data: { rank: g.rank, players: g.players, peak: g.peak } })),
  rows.map((g) => ({ source: 'steam', key: g.id, v: g.players, w: g.rank })), [{ source: 'steam', scope: 'chart' }]);
const fromSteamNames = (rows) => batchOf(rows.map((g) => ({ source: 'steam-app', key: g.id, scope: 'names', t: null, title: g.name, who: null, data: {} })), [], []);
/** One hourly dump's views of the list's own pages. views: Map(name key -> views); hour: epoch seconds. */
const fromWikiHourly = (hour, views) => batchOf([], [...views].map(([key, v]) => ({ source: 'wiki-hourly', key, at: hour, v })), [{ source: 'wiki-hourly', scope: 'file' }]);
/** One GDELT slot's count of titles naming each of the list's people. counts: Map(name key -> titles); slot: epoch seconds. */
const fromGdelt = (slot, counts) => batchOf([], [...counts].filter(([, n]) => n > 0).map(([key, n]) => ({ source: 'gdelt', key, at: slot, v: n })), [{ source: 'gdelt', scope: 'toc' }]);
// (the owner's switches, M11: recorded when they are on; nothing else reads them but a sound's own count)
const fromYtResults = (q, videos) => batchOf(videos.map((v) => ({ source: 'yt-results', key: v.id, scope: q, t: null, title: v.title, who: v.channel, data: { q, age: v.age } })),
  videos.filter((v) => Number.isFinite(v.views)).map((v) => ({ source: 'yt-results', key: v.id, v: v.views })), [{ source: 'yt-results', scope: q }]);
const fromTiktokSound = (sound) => batchOf([], [{ source: 'tiktok-sound', key: sound.id, v: sound.videos }], [{ source: 'tiktok-sound', scope: 'embed' }]);
const fromTiktokProfile = (profile) => batchOf([], [{ source: 'tiktok-profile', key: profile.handle, v: profile.followers }], [{ source: 'tiktok-profile', scope: 'profile' }]);

// ---------- the ledger read back ----------
const lastOf = (xs) => (xs && xs.length ? xs[xs.length - 1] : null);
/**
 * Whether a completion is climbing: it stands in its list's first five, three places or more above its first reading of the last
 * day (lower is higher). points: [{ t, v (its place) }], oldest first.
 */
function climbing(points, t) {
  const day = (points || []).filter((p) => t - p.t <= DAY);
  const now = lastOf(day);
  return !!now && day.length >= 2 && now.v <= CLIMB_TOP && day[0].v - now.v >= CLIMB_PLACES;
}

/**
 * The sounds the TikTok charts hold: Map(sound id -> { id, slug, title, artist, viral, popular (each { rank, fresh } or null),
 * videos (the chart's rounded count), asOf (when the collector read it), song (its own page: { created, firstSeen, category,
 * videos (exact), days: [{ day, rank, change, videos }] newest first, readAt } or null), shazam, kworb, reels (each that list's row
 * of the same song, or null), roundups: [{ page, name, day, about }] }).
 */
function soundsOf(ledger, t) {
  const live = (i, span = CHART_LIVE) => t - i.lastSeen <= span;
  const by = (source) => ledger.items.filter((i) => i.source === source);
  const sounds = new Map();
  for (const i of by('tts').filter((x) => live(x))) {
    const d = i.data || {};
    if (!d.id) continue;
    const s = sounds.get(d.id) || { id: d.id, slug: d.slug || null, title: i.title, artist: i.who || null, viral: null, popular: null, videos: null, asOf: null, song: null, shazam: null, kworb: null, reels: null, roundups: [] };
    if (d.chart === 'viral' || d.chart === 'popular') s[d.chart] = { rank: d.rank, fresh: i.fresh, day: d.day || null };
    if (Number.isFinite(d.videos) && (s.asOf === null || i.lastSeen >= s.asOf)) { s.videos = d.videos; s.asOf = i.lastSeen; }
    sounds.set(d.id, s);
  }
  const songs = new Map(by('tts-song').map((i) => [i.key, i]));
  const lists = { shazam: new Map(by('shazam').filter((i) => live(i, LIST_LIVE)).map((i) => [i.key, i.data])), kworb: new Map(by('kworb').filter((i) => live(i, LIST_LIVE)).map((i) => [i.key, i.data])),
    reels: new Map(by('reels').filter((i) => live(i, 9 * DAY)).map((i) => [i.key, i.data])) };
  const roundups = by('roundup');
  for (const s of sounds.values()) {
    const page = songs.get(s.id);
    if (page) s.song = { created: page.data.created || null, firstSeen: page.data.firstSeen || null, category: page.data.category || null, videos: Number.isFinite(page.data.videos) ? page.data.videos : null,
      days: Array.isArray(page.data.days) ? page.data.days : [], readAt: page.lastSeen };
    const key = songKey(s.title, s.artist);
    for (const name of ['shazam', 'kworb', 'reels']) s[name] = lists[name].get(key) || null;
    // (TikTok's own count, when the owner has that switch on: newer than any chart's)
    const embed = lastOf(ledger.series.get(`tiktok-sound|${s.id}`));
    if (embed && t - embed.t <= HOURLY_LIVE) s.live = { videos: embed.v, at: embed.t };
    s.roundups = roundups.filter((r) => r.data && r.data.sound && (r.data.sound.id === s.id || (!r.data.sound.id && r.data.sound.name && keyOf(r.data.sound.name) === keyOf(s.title))))
      .map((r) => ({ page: r.data.page, name: r.title, day: r.data.day, about: r.data.about || null }));
  }
  return sounds;
}

/**
 * The formats the roundups date: [{ key, name, names, day (the first day a roundup dated it), pages: [ids], sound ({ id, slug,
 * name } or null), abouts: [{ page, about }], fresh }], newest first. Two entries are one format when they are filmed to the same
 * sound (by its id, or by its name where a page gave only that) or carry the same name.
 */
function formatsOf(ledger, t, { within = 21 * DAY } = {}) {
  const groups = [];
  const items = ledger.items.filter((i) => i.source === 'roundup' && i.data && Number.isFinite(i.t) && t - i.t <= within && t - i.lastSeen <= LIST_LIVE).sort((a, b) => a.t - b.t || a.key.localeCompare(b.key));
  for (const i of items) {
    const sound = i.data.sound || null;
    const named = sound && sound.name && !UNNAMED_SOUND.test(sound.name) ? keyOf(sound.name) : null;
    const same = (g) => (sound && sound.id && g.sound && g.sound.id === sound.id) || (named && g.soundKey === named) || g.keys.has(keyOf(i.title));
    const g = groups.find(same);
    if (g) {
      g.names.push(i.title); g.keys.add(keyOf(i.title)); if (!g.pages.includes(i.data.page)) g.pages.push(i.data.page);
      g.abouts.push({ page: i.data.page, about: i.data.about || null });
      if (sound && (!g.sound || (!g.sound.id && sound.id))) g.sound = { ...sound, name: sound.name || (g.sound && g.sound.name) || null };
      else if (sound && g.sound && !g.sound.name && sound.name) g.sound = { ...g.sound, name: sound.name };
      g.soundKey = g.soundKey || named; g.fresh = g.fresh || i.fresh;
    } else groups.push({ key: keyOf(i.title), name: i.title, names: [i.title], keys: new Set([keyOf(i.title)]), day: i.data.day, at: i.t, pages: [i.data.page], sound, soundKey: named,
      abouts: [{ page: i.data.page, about: i.data.about || null }], fresh: i.fresh });
  }
  return groups.sort((a, b) => b.at - a.at || b.pages.length - a.pages.length).map(({ keys, soundKey, ...g }) => ({ ...g, names: [...new Set(g.names)] }));
}

/**
 * What people type, by what it names: Map(kind -> Map(term key -> { key, term, kind, templates: [ids], pos (its best place now),
 * fresh (new by observation on some template), firstFresh (when, epoch seconds), climbing, said: [completions] })), from the
 * completions read inside the last four hours.
 */
function typedOf(ledger, t) {
  const out = new Map();
  for (const i of ledger.items.filter((x) => x.source === 'typed' && t - x.lastSeen <= HOURLY_LIVE && x.data && x.who)) {
    const kind = i.data.kind;
    if (!out.has(kind)) out.set(kind, new Map());
    const g = out.get(kind).get(i.who) || { key: i.who, term: i.data.term, kind, templates: [], pos: Infinity, fresh: false, firstFresh: null, climbing: false, said: [] };
    if (!g.templates.includes(i.data.template)) g.templates.push(i.data.template);
    g.pos = Math.min(g.pos, i.data.pos || Infinity);
    if (i.fresh) { g.fresh = true; g.firstFresh = g.firstFresh === null ? i.firstSeen : Math.min(g.firstFresh, i.firstSeen); }
    g.climbing = g.climbing || climbing(ledger.series.get(`typed|${i.key}`), t);
    g.said.push(i.title);
    out.get(kind).set(i.who, g);
  }
  return out;
}

/**
 * The words a dictionary lately took in: [{ key, term, cats: [category ids], added (epoch seconds: when it first joined one),
 * meaning, created (when its entry was first written), asked (what people type about it, or null) }], newest first. A word with no
 * entry read yet has `meaning: undefined`; one whose entry holds no sense has `meaning: null`.
 */
function wordsOf(ledger, t, typed = typedOf(ledger, t)) {
  const words = new Map();
  for (const i of ledger.items.filter((x) => x.source === 'wikt' && t - x.lastSeen <= LIST_LIVE)) {
    const w = words.get(i.who) || { key: i.who, term: i.title, cats: [], added: i.t, meaning: undefined, created: null, asked: null };
    if (!w.cats.includes(i.data.category)) w.cats.push(i.data.category);
    w.added = Math.min(w.added, i.t);
    words.set(i.who, w);
  }
  const asked = typed.get('word') || new Map();
  // (and a word people newly ask the meaning of that no category holds: it is a word too once an entry defines it)
  for (const a of asked.values()) if (!words.has(a.key) && (a.fresh || a.climbing)) words.set(a.key, { key: a.key, term: a.term, cats: [], added: a.firstFresh || t, meaning: undefined, created: null, asked: a });
  for (const i of ledger.items.filter((x) => x.source === 'wikt-entry')) {
    const w = words.get(i.key);
    if (w) { w.meaning = i.data.meaning ?? null; w.label = i.data.label ?? null; w.created = Number.isFinite(i.t) ? i.t : null; w.term = i.title || w.term; w.entryAt = i.lastSeen; }
  }
  for (const w of words.values()) w.asked = w.asked || asked.get(w.key) || null;
  return [...words.values()].sort((a, b) => b.added - a.added || a.key.localeCompare(b.key));
}

/** The apps on Apple's charts as last read: [{ id, name, full, maker, chart, rank, released, genres, fresh, ranks: [{ t, v }] }], by rank. */
function appsOf(ledger, t) {
  return ledger.items.filter((i) => i.source === 'apps' && t - i.lastSeen <= 2 * HOURLY_LIVE && i.data).map((i) => ({ id: i.data.id, name: i.title, full: i.data.full || i.title, maker: i.who || null, chart: i.data.chart, rank: i.data.rank,
    released: i.data.released || null, genres: i.data.genres || [], fresh: i.fresh, ranks: ledger.series.get(`apps|${i.key}`) || [], seenAt: i.lastSeen })).sort((a, b) => a.rank - b.rank);
}

/**
 * The games on Roblox's lists and Steam's chart as last read: [{ platform: 'roblox' | 'steam', id, name, players, created (a
 * Roblox game's day of making, or null), sorts, rank, fresh (new to its list by observation), series: [{ t, v }] }], most played first.
 */
function gamesOf(ledger, t) {
  const made = new Map(ledger.items.filter((i) => i.source === 'roblox-game').map((i) => [i.key, i.data]));
  const names = new Map(ledger.items.filter((i) => i.source === 'steam-app').map((i) => [i.key, i.title]));
  const roblox = ledger.items.filter((i) => i.source === 'roblox' && t - i.lastSeen <= HOURLY_LIVE && i.data).map((i) => ({ platform: 'roblox', id: i.key, name: i.title, players: i.data.players, created: (made.get(i.key) || {}).created || null,
    sorts: i.data.sorts || [], rank: i.data.place || null, fresh: i.fresh, series: ledger.series.get(`roblox|${i.key}`) || [], seenAt: i.lastSeen }));
  const steam = ledger.items.filter((i) => i.source === 'steam' && t - i.lastSeen <= HOURLY_LIVE && i.data).map((i) => ({ platform: 'steam', id: i.key, name: names.get(i.key) || null, players: i.data.players, created: null, sorts: [],
    rank: i.data.rank, fresh: i.fresh, series: ledger.series.get(`steam|${i.key}`) || [], seenAt: i.lastSeen }));
  return [...roblox, ...steam].sort((a, b) => b.players - a.players);
}

/** Pinterest's growing terms as last read: [{ term, key, week, month, year }]. */
const pinsOf = (ledger, t) => ledger.items.filter((i) => i.source === 'pinterest' && t - i.lastSeen <= WEEKLY_WATCH && i.data).map((i) => ({ term: i.title, key: i.key, week: i.data.week, month: i.data.month, year: i.data.year, fresh: i.fresh }));

/**
 * A page's hourly views as the dumps count them: { hours (read inside the last day), last (the newest hour's views), at (that
 * hour), day (the last day as they count it: the mean of the hours read, times twenty-four) }, or null when no hour of the last
 * four was read. key: the name's key.
 */
function wikiOf(ledger, key, t) {
  const points = (ledger.series.get(`wiki-hourly|${key}`) || []).filter((p) => t - p.t <= DAY + 3 * HOUR);
  const newest = lastOf(points);
  // (an hour's file is out two to three hours after it began: "fresh" allows for that)
  if (!newest || t - newest.t > HOURLY_LIVE + 3 * HOUR) return null;
  return { hours: points.length, last: newest.v, at: newest.t, day: Math.round((points.reduce((a, p) => a + p.v, 0) / points.length) * 24) };
}
/** The news titles that named someone, by GDELT's count: { h3, h24 } (the last three hours, the last day). key: the name's key. */
function pressOf(ledger, key, t) {
  const points = ledger.series.get(`gdelt|${key}`) || [];
  const within = (span) => points.filter((p) => t - p.t <= span && p.t <= t).reduce((a, p) => a + p.v, 0);
  return { h3: within(3 * HOUR), h24: within(DAY) };
}

/** Everything the platform ledger holds, read into things: { sounds, formats, typed, words, apps, games, pins }. ledger: `platform.load()`. */
function thingsOf(ledger, t) {
  const typed = typedOf(ledger, t);
  return { sounds: soundsOf(ledger, t), formats: formatsOf(ledger, t), typed, words: wordsOf(ledger, t, typed), apps: appsOf(ledger, t), games: gamesOf(ledger, t), pins: pinsOf(ledger, t) };
}

module.exports = { songKey, dayStart, climbing, fromChart, fromSong, fromRoundup, fromReels, fromShazam, fromKworb, fromWiktCategory, fromWiktEntry, fromTyped, fromPinterest, fromApps, fromRoblox, fromRobloxGames,
  fromSteam, fromSteamNames, fromWikiHourly, fromGdelt, fromYtResults, fromTiktokSound, fromTiktokProfile, soundsOf, formatsOf, typedOf, wordsOf, appsOf, gamesOf, pinsOf, wikiOf, pressOf, thingsOf };
