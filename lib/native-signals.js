'use strict';
/*
 * The creator-native signals (ios/IDEAS-FEED.md L9, L10): who the keyless sources are about right now, and by how many independent
 * KINDS of signal. Pure: the readers' replies go in and a ledger batch comes out (`from*`); the ledger as loaded goes in and people
 * with their signals come out (`peopleOf`). Nothing is fetched or written here.
 *
 * The kinds, each independent of the others (C3):
 *   creators   a roster CLUSTER: two or more commentary channels, each with a video that names the person, published within 24 hours
 *              of each other. One channel ranting, however often, is one voice and no signal.
 *   asked      a question people newly type into a search box that names the person ("what did blixlo do streamer"): new by
 *              observation, or climbing its list.
 *   clips      a clip on r/LivestreamFail that tells something (a noun people argue about, another creator's name) or whose score
 *              is climbing fast.
 *   reddit     a thread on a drama board that people are commenting in right now, or a fresh post there with a drama flair.
 *   platform   what the platform itself shows: a ban flag that flipped, followers falling within the hour, a ban event.
 * A title, a clip's label and a thread's title are each a claim by whoever wrote it; a ban flag is a fact with no reason attached.
 */
const TN = require('../engine/talk-nouns');
const W = require('../engine/wording');
const ASKED = require('./sources/asked');
const { keyOf, HOUR, DAY } = require('./util');

const VIDEO_SERIES_SECONDS = 4 * DAY;
const CLUSTER_SPAN = DAY;
const CLUSTER_CHANNELS = 2;
const ITEM_BACK = 48 * HOUR;
const SIGNAL_BACK = 36 * HOUR;
const ASKED_BACK = DAY;
const ASKED_CLIMB = 3;
const ASKED_TOP = 5;
const CLIP_SPIKE_AN_HOUR = 200;
const CLIP_BIG_SCORE = 1000;
const CLIP_BIG_AGE = 12 * HOUR;
const THREAD_BUSY = 8;
const THREAD_READ_WITHIN = 2 * HOUR;
const FRESH_POST_AGE = 6 * HOUR;
const ONTD_REPLIES = 40;
const DIP_WINDOW = 75 * 60;
const DIP_MIN = 300;
const DIP_SHARE = 0.0003;
const PURGE_CHANNELS = 5;
const BAN_BACK = 6 * HOUR;
const SULLY_SHARE = 0.002;
const FAMOUS_MOVE = 100;
const VIEWS_READ_WITHIN = 90 * 60;
const VIEWS_GAP = [20 * 60, 3 * HOUR];
const HANDLE_MIN = 5;
// (what lib/native-desk.js counts voices over: two days, the window a story told by commentary channels and clips stays the creators' talk)
const VOICE_BACK = 48 * HOUR;
// the nouns a row told only by creators' own posts and videos may carry: never an arrest, a charge, a suit or an attack, which a
// post alone does not establish (C3)
const NATIVE_FAMS = new Set(['allegations', 'feud', 'backlash', 'apology', 'split', 'leak', 'argument', 'rumors', 'quit', 'remarks', 'tears']);
const LEAD_BOARDS = new Set(['livestreamfail', 'youtubedrama']);
const DRAMA_FLAIR = /^(?:expos[eé]|response|news|drama|discussion|callout|call-out|allegations?|update)$/i;
const PLAY = /\b(?:gta|rp|roleplay|role-play|in-game|in game|skit|parody|prank|pranked|staged|acting|speedrun)\b/i;
// (a creator word said beside a name: "Twitch streamer <name>", "YouTuber <name>", "<name>'s stream", "<name> on Kick")
const CREATOR_NOUN = 'streamers?|youtubers?|tiktokers?|influencers?|content creators?|vloggers?|podcasters?|twitch|kick|youtube';
const CREATOR_PLACE = 'stream|streams|livestream|channel|twitch|kick|podcast|vlog';
const CREATOR_WORD = /\b(?:streamers?|youtubers?|tiktokers?|influencers?|content creators?|vloggers?|podcasters?|twitch|kick|onlyfans|stream|streaming|livestream)\b/i;
// a token no dictionary spells that is still nobody's handle
const NOT_A_HANDLE = /^(?:youtube|tiktok|twitch|instagram|onlyfans|twitter|reddit|snapchat|facebook|netflix|spotify|fortnite|minecraft|roblox|valorant|warzone|podcast|livestream|vlog|vlogs|gameplay|reaction|reacts|compilation|shorts|ft|feat|pt|ep|vs|irl|asmr|mukbang|gta|nba|nfl|ufc|wwe|mlb|fifa|iphone|ps5|xbox|lol|wtf|omg|gonna|wanna|gotta|aint|dont|cant|wont|didnt|doesnt|isnt|thats|whats|hes|shes|theyre|youre|im|ive)$/;

// ---------- the readers' replies as a ledger batch ----------
const batchOf = (items = [], series = [], reads = []) => ({ items, series, reads });

/** One template's completions (lib/sources/asked.js parse). engine: 'google' or 'bing'. */
function fromAsked(engine, templateId, completions) {
  const source = engine === 'bing' ? 'asked-bing' : 'asked';
  const scope = `${templateId}`;
  const items = completions.map((c) => ({ c, a: ASKED.askedOf(templateId, c.q) })).filter((x) => x.a)
    .map(({ c, a }) => ({ source, key: `${templateId}|${c.q}`, scope, t: null, title: c.q, who: a.key, data: { template: templateId, pos: c.pos, rel: c.rel, family: a.family, streamer: a.streamer, creator: a.creator } }));
  return batchOf(items, items.map((it) => ({ source, key: it.key, v: it.data.pos, w: it.data.rel })), [{ source, scope }]);
}
/** One channel's feed (lib/sources/yt-roster.js parse): its uploads, and the views and likes of the ones under four days old. */
function fromRoster(feed, nowSeconds, group = null) {
  const scope = feed.channelId;
  const items = feed.videos.map((v) => ({ source: 'yt', key: v.id, scope, t: v.t, title: v.title, who: feed.channel, data: { channel: feed.channelId, ...(group ? { group } : {}) } }));
  const series = feed.videos.filter((v) => nowSeconds - v.t <= VIDEO_SERIES_SECONDS && Number.isFinite(v.views)).map((v) => ({ source: 'yt', key: v.id, v: v.views, w: v.likes }));
  return batchOf(items, series, [{ source: 'yt', scope }]);
}
/** LivestreamFails' clips (lib/sources/lsf.js parse). */
function fromLsf(clips) {
  return batchOf(clips.map((c) => ({ source: 'lsf', key: c.id, scope: 'lsf', t: c.t, title: c.title, who: c.streamer, data: { category: c.category, platform: c.platform } })),
    clips.map((c) => ({ source: 'lsf', key: c.id, v: c.score })), [{ source: 'lsf', scope: 'lsf' }]);
}
/** A board's newest comments by thread (lib/sources/arctic.js parseComments): how many of the hundred each thread holds, and the window. */
function fromArcticComments(sub, parsed) {
  return batchOf([], parsed.threads.map((th) => ({ source: 'arctic', key: th.id, v: th.n, w: parsed.span })), [{ source: 'arctic', scope: `comments:${sub}` }]);
}
/** A board's posts (lib/sources/arctic.js parsePosts). */
function fromArcticPosts(posts, sub = null) {
  return batchOf(posts.map((p) => ({ source: 'arctic', key: p.id, scope: `posts:${p.sub || sub || ''}`, t: p.t, title: p.title, who: null, data: { sub: p.sub || sub || null, flair: p.flair } })), [],
    sub ? [{ source: 'arctic', scope: `posts:${sub}` }] : []);
}
/** The streamer roster's figures (lib/sources/ivr.js parse). */
function fromIvr(users) {
  return batchOf(users.map((u) => ({ source: 'ivr', key: u.login, scope: 'ivr', t: null, title: u.live ? u.live.title : null, who: u.name, data: { banned: u.banned, banReason: u.banReason, live: !!u.live, followers: u.followers } })),
    users.map((u) => ({ source: 'ivr', key: u.login, v: u.followers, w: u.banned ? 1 : 0 })), [{ source: 'ivr', scope: 'ivr' }]);
}
/** SullyGnome's follower losers (lib/sources/sully.js parse). */
function fromSully(rows) {
  return batchOf(rows.map((d) => ({ source: 'sully', key: d.login, scope: 'sully', t: null, title: null, who: d.name, data: { followers: d.followers, lost: d.lost, lostBefore: d.lostBefore, viewers: d.viewers, share: d.share } })), [],
    [{ source: 'sully', scope: 'sully' }]);
}
/** StreamerBans' ban events (lib/sources/streamerbans.js parse). */
function fromBans(events) {
  return batchOf(events.map((e) => ({ source: 'bans', key: `${e.login}|${e.at}`, scope: 'bans', t: e.at, title: null, who: e.name, data: { login: e.login, followers: e.followers, active: e.active } })), [], [{ source: 'bans', scope: 'bans' }]);
}
/** Famous Birthdays' trending names (lib/sources/famous.js parse). */
function fromFamous(rows) {
  return batchOf(rows.map((r) => ({ source: 'famous', key: keyOf(r.name), scope: 'famous', t: null, title: r.label, who: r.name, data: { move: r.move, creator: r.creator } })).filter((it) => it.key), [],
    [{ source: 'famous', scope: 'famous' }]);
}
/** ONTD's posts with their reply counts (lib/sources/ontd.js parse). */
function fromOntd(posts) {
  return batchOf(posts.map((p) => ({ source: 'ontd', key: p.id, scope: 'ontd', t: p.t, title: p.title, who: null, data: {} })), posts.map((p) => ({ source: 'ontd', key: p.id, v: p.replies })), [{ source: 'ontd', scope: 'ontd' }]);
}
/** Several batches as one. */
const merge = (...batches) => batchOf(batches.flatMap((b) => (b ? b.items : [])), batches.flatMap((b) => (b ? b.series : [])), batches.flatMap((b) => (b ? b.reads : [])));

// ---------- who a text names ----------
/** A one-word name a dictionary spells, or a given name: it names a creator only where the text says it is about one. */
const isStrict = (key) => !key.includes(' ') && (W.inDict(key) || W.isFirstName(key) || key.length < 3);

/**
 * Everyone the collector already knows as a creator, by every name each goes by: { byKey: Map(key -> { key, name, creator: true }),
 * alias: Map(any name's key -> key) }. roster: the engine's Map(key -> { name }) from Wikipedia's creator lists; streamers: the
 * streamer roster ([{ login, name, also }]). A streamer the engine's roster also lists goes by the engine's key, so a row made here
 * and a row the engine makes later are one subject. listed: [{ key, name }], the subjects of the rows the list already carries: a
 * whole name of two words or more is known too, so the signals about a celebrity reach that celebrity's row; it is no creator, and
 * no row is ever made here for it.
 */
function peopleIndex({ roster = null, streamers = [], listed = [] } = {}) {
  const byKey = new Map();
  const alias = new Map();
  for (const [key, r] of roster || []) { byKey.set(key, { key, name: r.name, creator: true }); alias.set(key, key); }
  for (const s of streamers) {
    const names = [s.name, ...(s.also || [])];
    const listed = names.map((n) => keyOf(n)).find((k) => byKey.has(k));
    const key = listed || keyOf(s.name);
    if (!key) continue;
    // (a streamer is spelt as the streamer roster spells them where the key is their own name: Wikipedia's page is "Blixka", everyone writes "blixka")
    if (!byKey.has(key) || keyOf(s.name) === key) byKey.set(key, { ...(byKey.get(key) || {}), key, name: s.name, creator: true });
    byKey.get(key).login = byKey.get(key).login || s.login;
    for (const n of [...names, s.login]) { const k = keyOf(n); if (k && !alias.has(k)) alias.set(k, key); }
  }
  for (const l of listed) {
    const key = keyOf((l && l.key) || '');
    if (!key || key.split(' ').length < 2 || key.split(' ').length > 3 || alias.has(key)) continue;
    byKey.set(key, { key, name: l.name || null, creator: false });
    alias.set(key, key);
  }
  return { byKey, alias };
}

/**
 * The known creators a text names: whole names anywhere; a strict one-word name (a dictionary word, a given name) only where the
 * text is about creators (`creatorText`) and opens with it, or the text itself says streamer, YouTuber, TikToker ...
 */
function namedIn(text, index, { creatorText = false } = {}) {
  const ws = keyOf(text).split(' ').filter(Boolean);
  const says = CREATOR_WORD.test(String(text || ''));
  const out = [];
  for (let i = 0; i < ws.length; i++) {
    for (let n = 3; n >= 1; n--) {
      if (i + n > ws.length) continue;
      const gram = ws.slice(i, i + n).join(' ');
      const key = index.alias.get(gram);
      if (!key) continue;
      if (isStrict(gram) && !(says || (creatorText && i === 0))) continue;
      if (!out.includes(key)) out.push(key);
      i += n - 1;
      break;
    }
  }
  return out;
}

/**
 * The names in a video title nobody has listed: a given name and a surname no dictionary spells ("wynory pymith"), or one handle no
 * dictionary spells ("plonix"). Only what two channels' titles share ever counts (the cluster rule), so a stray word here is no harm.
 */
function unknownNames(title, index) {
  const ws = keyOf(title).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i < ws.length; i++) {
    const [a, b] = [ws[i], ws[i + 1]];
    if (b && W.isFirstName(a) && !W.inDict(b) && !W.isFirstName(b) && b.length >= 3 && !/^\d+$/.test(b) && !index.alias.has(`${a} ${b}`)) { out.add(`${a} ${b}`); continue; }
    if (a.length >= HANDLE_MIN && !W.inDict(a) && !W.isFirstName(a) && !/^\d/.test(a) && !NOT_A_HANDLE.test(a) && !index.alias.has(a) && !(i > 0 && W.isFirstName(ws[i - 1]))) out.add(a);
  }
  return [...out];
}

/** The drama noun families a text says, by key; "exposed" is a claim, never a leak. */
function familiesOf(text) {
  const out = new Set();
  for (const x of TN.familiesIn(String(text || ''))) {
    const key = x.f.key === 'leak' && /^expos/i.test(x.surface || '') ? 'allegations' : x.f.key;
    if (TN.DRAMA_FAMS.has(key)) out.add(key);
  }
  return [...out];
}
// a title that tells no noun and is still about trouble: "The Blixlo Situation", "He's done", "X responds". A gameplay video is not
const DRAMA_ISH = /\b(?:situation|drama|controvers\w+|scandal|expos\w+|respon(?:ds?|se|ding)|address(?:es|ed|ing)?|truth|downfall|cancell?ed|is done|is over|finished|mess|disaster|worse|problem|trouble|called out|calls out|goes off|speaks out|what happened|went wrong)\b/i;
/** Whether a video's title is about trouble at all: it says a drama noun, or one of the words such videos are titled with. */
const tellsTrouble = (title) => familiesOf(title).length > 0 || DRAMA_ISH.test(String(title || ''));
/** A title as a quote may carry it: shouted words set in ordinary case, the feed's trimmings off. */
const quotable = (title, max = 70) => {
  const calm = String(title || '').replace(/\b\p{Lu}{4,}\b/gu, (w) => w[0] + w.slice(1).toLowerCase()).replace(/[“”"]/g, '').replace(/\s+/g, ' ').replace(/[.!?…]+$/, '').trim();
  if (calm.length <= max) return calm;
  const cut = calm.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 30)).replace(/[,;:\s]+$/, '')}…`;
};

// a title that opens with a person and then their answer to someone: the noun it says is the other's ("<A> responds to <B>'s allegations")
const ANSWERS = /^(?:responds?|reacts?|replies|answers|addresses|defends|weighs in|speaks (?:out|up) (?:on|about)|calls? out|claps back|slams|roasts|mocks|says|explains why)\b/i;
/** Whether a text opens with the person named by `key` answering someone else (its next words are an answer: "responds to", "reacts to", "calls out"). */
function answers(text, key) {
  const words = keyOf(key).split(' ').filter(Boolean);
  if (!words.length) return false;
  const re = new RegExp(`^\\W*${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\'’-]*')}(?:['’]s)?\\s+`, 'i');
  const m = String(text || '').match(re);
  const verb = m ? String(text).slice(m[0].length).match(ANSWERS) : null;
  if (!verb) return false;
  // (answering someone: the next word names them. "<name> responds to the allegations" answers their own story)
  const next = String(text).slice(m[0].length + verb[0].length).replace(/^\s*(?:to|on|about|at)\s+/i, '').trim();
  return /^[@\p{Lu}]/u.test(next) && !NOT_SOMEONE.test(next);
}
/**
 * Whether a family's noun in a text is someone else's by possession: "<Other>'s allegations", "<Other>’s new allegations" (a word or
 * two between), while the name of `key` is not the possessor.
 */
function possessedByOther(text, family, key) {
  const f = family ? TN.FAMILY.get(family) : null;
  const m = f ? String(text || '').match(f.re) : null;
  if (!m) return false;
  const before = String(text).slice(0, m.index).trim().split(/\s+/).slice(-3);
  const own = new Set(keyOf(key).split(' '));
  return before.some((w) => { const p = w.match(/^([\p{L}\p{N}]+)['’]s$/u); return !!p && !own.has(keyOf(p[1])); });
}
// (words a channel's name shares with its owner's other channels that say nothing of who owns it)
const CHANNEL_WORDS = new Set(['tv', 'clips', 'clip', 'live', 'podcast', 'highlights', 'news', 'show', 'official', 'the', 'and', 'of', 'a', 'entertainment', 'media', 'daily', 'reacts',
  'channel', 'network', 'studios', 'music', 'radio', 'club', 'king', 'hollywood', 'her', 'his', 'call', 'say', 'we', 'do', 'know', 'them', 'in', 'just', 'right', 'full']);
const channelWords = (name) => new Set(keyOf(name || '').split(' ').filter((w) => w && !CHANNEL_WORDS.has(w)));
/** Whether two channels are one owner's: the same channel, or names sharing a word of their own ("<Name> TV" and "<Name> Clips"). */
function sameOwner(a, b) {
  if (!a || !b) return a === b;
  if (keyOf(a) === keyOf(b)) return true;
  const x = channelWords(a);
  return [...channelWords(b)].some((w) => x.has(w));
}
const NOT_SOMEONE = /^(?:the|his|her|their|my|our|a|an|this|that|these|those|all|it|being|getting|claims?|allegations?|accusations?|rumou?rs?|backlash|hate|criticism|drama|controversy|everything|everyone|people|fans|haters|chat|twitch|youtube|kick|tiktok|reddit)\b/i;

// ---------- the signals ----------
const pointsOf = (series, source, key) => series.get(`${source}|${key}`) || [];
/** Gain an hour between the newest point and the newest one at least `gapMin` before it (inside `gapMax`), or null. */
function gainAnHour(points, [gapMin, gapMax]) {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const before = [...points].reverse().find((p) => last.t - p.t >= gapMin && last.t - p.t <= gapMax);
  return before ? ((last.v - before.v) * HOUR) / (last.t - before.t) : null;
}

/**
 * Everyone the ledger's sources are about at slot `t`: Map(key -> person), a person being
 *   { key, name (as a roster or the first source spells it, or null), known (a roster's), creator (a roster's, or a source that itself calls them one), strict,
 *     kinds: { kind: { at, items: [{ t, k, title, outlet, sub, rank }], says: [what each signal says, for the card's line], n } },
 *     families: { family: votes }, texts: { family: a title that says it }, viewsAnHour (of the roster's videos about them, or null),
 *     channels: [roster channels in the cluster], confirmed (a question both engines show) }.
 * ledger: lib/native-ledger.js load(); index: peopleIndex().
 */
function peopleOf(ledger, index, t) {
  const people = new Map();
  const person = (key, name = null) => {
    if (!people.has(key)) {
      const known = index.byKey.get(key) || null;
      people.set(key, { key, name: (known && known.name) || name || null, known: !!known, creator: !!known && known.creator !== false, strict: isStrict(key), kinds: {}, families: {}, texts: {}, viewsAnHour: null, channels: [], confirmed: false, shortlist: false, told: [], slot: t, rostered: !!known && known.creator !== false });
    }
    const p = people.get(key);
    // (spelt as the first source that spells it does; a question typed into a search box spells nothing)
    if (!p.known && name && !p.name) p.name = name;
    return p;
  };
  // (a noun a title gives to someone else is no vote for this person's story: "<name> released his findings on the allegations
  // facing <other>" says nothing of the name's allegations. engine/talk-nouns.js othersSaid; collector only, 2026-10-19)
  // (nor is a title that opens with the person answering someone: "<name> reacts to <other>'s allegations" is the other's story)
  const vote = (p, families, text) => { for (const f of families) { if (text && (TN.othersSaid(text, TN.FAMILY.get(f), p.key) || answers(text, p.key) || possessedByOther(text, f, p.key))) continue; p.families[f] = (p.families[f] || 0) + 1; if (text && !p.texts[f]) p.texts[f] = text; } };
  const signal = (p, kind, at, item, say) => {
    if (!Number.isFinite(at) || at > t) return;
    const k = p.kinds[kind] || { at, items: [], says: [], n: 0 };
    k.at = Math.min(k.at, at);
    k.n += 1;
    if (item) k.items.push(item);
    if (say && !k.says.includes(say)) k.says.push(say);
    p.kinds[kind] = k;
  };
  const resolve = (name) => index.alias.get(keyOf(name)) || null;
  // (a name as its own source spells it: the first text that carries the key)
  const spelt = (key, text) => { const m = String(text || '').match(new RegExp(key.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\'’-]*'), 'i')); return m ? m[0].replace(/\s+/g, ' ').trim() : null; };
  const { items, series } = ledger;

  // creators: the roster cluster (two channels or more, each naming the person, inside 24 hours)
  const videos = items.filter((i) => i.source === 'yt' && Number.isFinite(i.t) && t - i.t <= ITEM_BACK && i.t <= t);
  const naming = new Map();
  // (a channel's own uploads are not a channel talking about someone: "Bexan Tamard Live" names Bexan Tamard in every title)
  const aliasesOf = new Map();
  for (const [a, k] of index.alias) { if (!aliasesOf.has(k)) aliasesOf.set(k, []); aliasesOf.get(k).push(a.replace(/ /g, '')); }
  for (const v of videos) {
    const own = keyOf(v.who || '').replace(/ /g, '');
    const isOwn = (key) => [key.replace(/ /g, ''), ...(aliasesOf.get(key) || [])].some((a) => a.length >= 3 && own.includes(a));
    // (only a video about trouble counts toward a cluster: celebrity desks name someone in every title, and that is no drama)
    if (!tellsTrouble(v.title)) continue;
    for (const key of [...namedIn(v.title, index, { creatorText: true }), ...unknownNames(v.title, index)]) {
      if (isOwn(key)) continue;
      if (!naming.has(key)) naming.set(key, []);
      naming.get(key).push(v);
    }
  }
  for (const [key, vs] of naming) {
    const sorted = [...vs].sort((a, b) => a.t - b.t);
    let formed = null;
    for (let j = 1; j < sorted.length && formed === null; j++) {
      // (two channels of one owner, "<Name> TV" and "<Name> Clips", are one voice)
      for (let i = 0; i < j; i++) if (sorted[i].data.channel !== sorted[j].data.channel && !sameOwner(sorted[i].who, sorted[j].who) && sorted[j].t - sorted[i].t <= CLUSTER_SPAN) { formed = { at: sorted[j].t, from: sorted[i].t }; break; }
    }
    if (!formed || t - formed.at > SIGNAL_BACK) continue;
    const cluster = sorted.filter((v) => v.t >= formed.from);
    const channels = [...new Set(cluster.map((v) => v.who).filter(Boolean))];
    if (channels.filter((c, i) => !channels.slice(0, i).some((d) => sameOwner(c, d))).length < CLUSTER_CHANNELS) continue;
    const p = person(key, spelt(key, cluster[0].title));
    p.channels = channels;
    for (const v of cluster) {
      // (id, who, n: what the sheet's example posts are built from, D4 `posts`: the video's own id, its channel, its newest view count)
      const read = pointsOf(series, 'yt', v.key);
      signal(p, 'creators', formed.at, { t: v.t, k: 'upload', title: v.title, outlet: v.who || 'YouTube', id: v.key, who: v.who || null, n: read.length ? read[read.length - 1].v : null }, null);
      vote(p, familiesOf(v.title), v.title);
      if (CREATOR_WORD.test(v.title)) p.creator = true;
    }
    p.kinds.creators.at = formed.at;
    // (views an hour of the cluster's videos: each read twice, at least twenty minutes apart, the newer read inside the last hour and a half)
    const rates = cluster.map((v) => { const pts = pointsOf(series, 'yt', v.key); return pts.length && t - pts[pts.length - 1].t <= VIEWS_READ_WITHIN ? gainAnHour(pts, VIEWS_GAP) : null; }).filter(Number.isFinite);
    if (rates.length) p.viewsAnHour = Math.max(0, Math.round(rates.reduce((a, b) => a + b, 0)));
  }

  // asked: a question newly typed that names the person, or one climbing its list
  const asked = items.filter((i) => (i.source === 'asked' || i.source === 'asked-bing') && i.lastSeen >= t - 2 * HOUR);
  const bingKeys = new Set(asked.filter((i) => i.source === 'asked-bing').map((i) => resolve(i.who) || i.who));
  for (const a of asked.filter((i) => i.source === 'asked')) {
    const pts = pointsOf(series, 'asked', a.key);
    // (climbing: in the list's first five now, three places or more above where the last day's first reading had it; dated by the
    // reading that first found it there, so a question that then sits at the top is one climb, not a new one every hour)
    const last = pts.length ? pts[pts.length - 1] : null;
    const reached = pts.length >= 2 && last.v <= ASKED_TOP && pts[0].v - last.v >= ASKED_CLIMB ? pts.find((x) => x.v <= ASKED_TOP && pts[0].v - x.v >= ASKED_CLIMB) : null;
    const isNew = a.fresh && t - a.firstSeen <= ASKED_BACK;
    if (!isNew && !reached) continue;
    const at = isNew ? a.firstSeen : reached.t;
    const key = resolve(a.who) || a.who;
    const p = person(key, null);
    // (fam: what the question itself asks about, by its template: a cancelling asked about is backlash, whatever the word reads as)
    signal(p, 'asked', at, { t: at, k: 'asked', title: a.title, outlet: 'Google', fam: a.data.family || null }, a.title);
    if (a.data.family) vote(p, [a.data.family], a.title);
    if (a.data.creator) p.creator = true;
    if (bingKeys.has(key)) p.confirmed = true;
  }
  // (a question only Bing newly shows is still what people type: the second engine's word, counted the same way)
  for (const a of asked.filter((i) => i.source === 'asked-bing' && i.fresh && t - i.firstSeen <= ASKED_BACK)) {
    const key = resolve(a.who) || a.who;
    const p = person(key, null);
    if (p.kinds.asked) continue;
    signal(p, 'asked', a.firstSeen, { t: a.firstSeen, k: 'asked', title: a.title, outlet: 'Bing', fam: a.data.family || null }, a.title);
    if (a.data.family) vote(p, [a.data.family], a.title);
    if (a.data.creator) p.creator = true;
  }

  // clips: r/LivestreamFail's clips that tell something, or whose score is climbing fast
  for (const c of items.filter((i) => i.source === 'lsf' && Number.isFinite(i.t) && t - i.t <= SIGNAL_BACK && i.t <= t)) {
    if (PLAY.test(`${c.title} ${c.data.category || ''}`)) continue;
    const pts = pointsOf(series, 'lsf', c.key);
    const score = pts.length ? pts[pts.length - 1].v : null;
    const streamer = c.who ? resolve(c.who) || keyOf(c.who) : null;
    const named = namedIn(c.title, index, { creatorText: true });
    const fams = familiesOf(c.title);
    // (another creator's name beside the clip's own: with no streamer known, two names in the title)
    const others = streamer ? named.filter((k) => k !== streamer) : named.length >= 2 ? named.slice(1) : [];
    const rate = gainAnHour(pts, [10 * 60, 2 * HOUR]);
    const spiking = (Number.isFinite(rate) && rate >= CLIP_SPIKE_AN_HOUR) || (Number.isFinite(score) && score >= CLIP_BIG_SCORE && t - c.t <= CLIP_BIG_AGE);
    // (it tells something: a noun people argue about, a word such clips are titled with ("drama", "responds"), another creator's name)
    if (!(tellsTrouble(c.title) || others.length || spiking)) continue;
    for (const key of [...new Set([...(streamer ? [streamer] : []), ...named])]) {
      // (a clip counts for whoever its title is about; its streamer when the title names nobody else, or says a noun)
      if (key === streamer && !named.includes(key) && others.length && !fams.length) continue;
      const p = person(key, key === streamer ? c.who : spelt(key, c.title));
      p.creator = true;
      signal(p, 'clips', c.t, { t: c.t, k: 'clip', title: c.title, outlet: 'LivestreamFail', sub: 'livestreamfail', score, id: c.key, who: c.who || null, n: Number.isFinite(score) ? score : null }, Number.isFinite(score) ? `${c.title}|${score}` : c.title);
      vote(p, fams, c.title);
    }
  }

  // reddit: a thread on a drama board people are commenting in right now, or a fresh post with a drama flair; ONTD's busy posts
  const threads = items.filter((i) => i.source === 'arctic' && Number.isFinite(i.t) && t - i.t <= SIGNAL_BACK && i.t <= t).map((i) => {
    const pts = pointsOf(series, 'arctic', i.key);
    const last = pts.length && t - pts[pts.length - 1].t <= THREAD_READ_WITHIN ? pts[pts.length - 1] : null;
    return { ...i, n: last ? last.v : 0, span: last ? last.w : null, sub: keyOf(i.data.sub || '').replace(/ /g, '') };
  });
  const rankIn = new Map();
  for (const sub of new Set(threads.map((x) => x.sub))) threads.filter((x) => x.sub === sub && x.n > 0).sort((a, b) => b.n - a.n).forEach((x, i) => rankIn.set(x.key, i + 1));
  for (const th of threads) {
    if (PLAY.test(th.title)) continue;
    const lead = LEAD_BOARDS.has(th.sub);
    const busy = th.n >= THREAD_BUSY;
    const flaired = lead && t - th.t <= FRESH_POST_AGE && DRAMA_FLAIR.test(th.data.flair || '');
    const fams = familiesOf(th.title);
    if (!(busy || flaired) || !(tellsTrouble(th.title) || DRAMA_FLAIR.test(th.data.flair || ''))) continue;
    for (const key of namedIn(th.title, index, { creatorText: lead })) {
      const p = person(key, spelt(key, th.title));
      if (lead) p.creator = true;
      // (id: the thread's, for the sheet's example posts. No keyless source reads a thread's comment count: `n` stays null, never the share of the newest hundred)
      signal(p, 'reddit', th.t, { t: th.t, k: 'post', title: th.title, outlet: 'Reddit', sub: th.sub, rank: rankIn.get(th.key) ?? null, id: th.key, who: null, n: null }, `${th.title}|${th.sub}`);
      vote(p, fams, th.title);
    }
  }
  for (const o of items.filter((i) => i.source === 'ontd' && Number.isFinite(i.t) && t - i.t <= SIGNAL_BACK && i.t <= t)) {
    const pts = pointsOf(series, 'ontd', o.key);
    const fams = familiesOf(o.title);
    if (!pts.length || pts[pts.length - 1].v < ONTD_REPLIES || !tellsTrouble(o.title)) continue;
    for (const key of namedIn(o.title, index, {})) {
      const p = person(key, spelt(key, o.title));
      signal(p, 'reddit', o.t, { t: o.t, k: 'post', title: o.title, outlet: 'ONTD', sub: 'ontd', rank: null, id: o.key, who: null, n: pts[pts.length - 1].v }, `${o.title}|ontd`);
      vote(p, fams, o.title);
    }
  }

  // platform: a ban flag that flipped, followers falling inside the hour, a ban event, a channel newly among the follower losers
  const dips = [];
  for (const u of items.filter((i) => i.source === 'ivr' && i.lastSeen >= t - HOUR)) {
    const pts = pointsOf(series, 'ivr', u.key);
    if (!pts.length) continue;
    const key = resolve(u.key) || resolve(u.who) || keyOf(u.who || u.key);
    const last = pts[pts.length - 1];
    // (a ban is seen landing: read unbanned inside the last six hours, banned now)
    const flipAt = (() => { for (let i = pts.length - 1; i > 0; i--) if (pts[i].w === 1 && pts[i - 1].w === 0) return t - pts[i].t <= BAN_BACK && last.w === 1 ? pts[i].t : null; return null; })();
    if (flipAt !== null) { const p = person(key, u.who); p.creator = true; signal(p, 'platform', flipAt, { t: flipAt, k: 'platform', title: `${p.name} banned on Twitch`, outlet: 'Twitch' }, 'ban'); vote(p, ['quit'], 'banned'); }
    const first = pts.find((x) => last.t - x.t <= DIP_WINDOW && last.t > x.t);
    if (first && last.t === t && first.v - last.v >= Math.max(DIP_MIN, DIP_SHARE * first.v)) dips.push({ key, who: u.who, lost: first.v - last.v, at: last.t });
  }
  // (many channels falling at once is the platform clearing out bots, which is nobody's story)
  if (dips.length < PURGE_CHANNELS) for (const d of dips) { const p = person(d.key, d.who); p.creator = true; signal(p, 'platform', d.at, { t: d.at, k: 'platform', title: `${p.name} losing followers on Twitch`, outlet: 'Twitch' }, `dip|${Math.round(d.lost)}`); }
  for (const b of items.filter((i) => i.source === 'bans' && Number.isFinite(i.t) && t - i.t <= DAY && i.t <= t)) {
    const key = resolve(b.data.login) || resolve(b.who) || keyOf(b.who || b.data.login);
    const p = person(key, b.who);
    p.creator = true;
    signal(p, 'platform', b.t, { t: b.t, k: 'platform', title: `${p.name} banned on Twitch`, outlet: 'Twitch' }, 'ban');
    vote(p, ['quit'], 'banned');
  }
  for (const s of items.filter((i) => i.source === 'sully' && i.fresh && t - i.firstSeen <= DAY && (i.data.share || 0) >= SULLY_SHARE && (i.data.lostBefore || 0) <= 0)) {
    const key = resolve(s.key) || resolve(s.who) || keyOf(s.who || s.key);
    const p = person(key, s.who);
    p.creator = true;
    signal(p, 'platform', s.firstSeen, { t: s.firstSeen, k: 'platform', title: `${p.name} losing followers on Twitch`, outlet: 'Twitch' }, `dip|${Math.round(s.data.lost)}`);
  }

  // the shortlist: names worth their own search that no signal above carries (never a kind, never a row)
  for (const f of items.filter((i) => i.source === 'famous' && i.fresh && t - i.firstSeen <= DAY && i.data.creator && (i.data.move || 0) >= FAMOUS_MOVE)) {
    const key = resolve(f.who) || f.key;
    const p = person(key, f.who);
    // (the site's own label calls them a creator: "TikTok Star")
    p.creator = true;
    p.shortlist = true;
  }
  for (const s of items.filter((i) => i.source === 'sully' && i.fresh && t - i.firstSeen <= DAY)) { const key = resolve(s.key) || resolve(s.who); if (key) person(key, s.who).shortlist = true; }
  toldOf(items, series, index, t, { person, resolve, spelt, aliasesOf });
  return people;
}

/**
 * `told`, on each person: every item of the last two days that tells trouble about them, whatever its kind's own bar (a cluster's
 * day, a thread's comments, a clip's score): what lib/native-desk.js counts independent voices from. Each item carries its `voice`:
 * one channel (however many of its videos), or one post, where a LivestreamFails clip IS a post on r/LivestreamFail and the mirror's
 * post of the same id is the same voice. Who posted is never read. `toldCreator`: the items themselves place the person among
 * creators: a clip of their own stream, or a title that calls them one beside their name ("streamer <name>", "<name>'s stream").
 * Being named in a clip's title or on a creators' board is not enough: streamers talk about everyone. It moves nothing of the kinds
 * above.
 */
function toldOf(items, series, index, t, { person, resolve, spelt, aliasesOf }) {
  const within = (i) => Number.isFinite(i.t) && i.t <= t && t - i.t <= VOICE_BACK;
  const add = (key, name, item, creator) => {
    if (!key) return;
    const p = person(key, name);
    if (creator) p.toldCreator = true;
    if (!p.told.some((x) => x.voice === item.voice && x.id === item.id)) p.told.push(item);
  };
  const newest = (pts) => (pts.length ? pts[pts.length - 1].v : null);
  const calledCreator = (text, key) => {
    const name = keyOf(key).split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\'’-]*');
    return new RegExp(`(?:${CREATOR_NOUN})\\W+(?:\\w+\\W+)?${name}\\b|\\b${name}(?:['’]s)?\\W+(?:\\w+\\W+)?(?:${CREATOR_PLACE})`, 'i').test(String(text || ''));
  };
  for (const v of items.filter((i) => i.source === 'yt' && within(i) && tellsTrouble(i.title))) {
    const own = keyOf(v.who || '').replace(/ /g, '');
    const isOwn = (key) => [key.replace(/ /g, ''), ...(aliasesOf.get(key) || [])].some((a) => a.length >= 3 && own.includes(a));
    const pts = pointsOf(series, 'yt', v.key);
    const rate = pts.length && t - pts[pts.length - 1].t <= VIEWS_READ_WITHIN ? gainAnHour(pts, VIEWS_GAP) : null;
    for (const key of [...namedIn(v.title, index, { creatorText: true }), ...unknownNames(v.title, index)]) {
      if (isOwn(key)) continue;
      add(key, spelt(key, v.title), { t: v.t, k: 'upload', voice: `yt:${v.data.channel || v.who}`, title: v.title, outlet: v.who || 'YouTube', id: v.key, who: v.who || null, n: newest(pts),
        rate: Number.isFinite(rate) ? Math.max(0, rate) : null }, calledCreator(v.title, key));
    }
  }
  for (const c of items.filter((i) => i.source === 'lsf' && within(i) && tellsTrouble(i.title) && !PLAY.test(`${i.title} ${i.data.category || ''}`))) {
    const pts = pointsOf(series, 'lsf', c.key);
    const streamer = c.who ? resolve(c.who) || keyOf(c.who) : null;
    const named = namedIn(c.title, index, { creatorText: true });
    const others = streamer ? named.filter((k) => k !== streamer) : [];
    const rate = gainAnHour(pts, [10 * 60, 2 * HOUR]);
    for (const key of [...new Set([...(streamer ? [streamer] : []), ...named])]) {
      // (a clip is its streamer's only when its title names nobody else, or says a noun: as the clips kind reads it)
      if (key === streamer && !named.includes(key) && others.length && !familiesOf(c.title).length) continue;
      add(key, key === streamer ? c.who : spelt(key, c.title), { t: c.t, k: 'clip', voice: `reddit:${c.key}`, title: c.title, outlet: 'LivestreamFail', sub: 'livestreamfail', id: c.key, who: c.who || null,
        n: newest(pts), score: newest(pts), rate: Number.isFinite(rate) ? rate : null }, key === streamer || calledCreator(c.title, key));
    }
  }
  for (const th of items.filter((i) => i.source === 'arctic' && within(i) && !PLAY.test(i.title || ''))) {
    const sub = keyOf(th.data.sub || '').replace(/ /g, '');
    if (!(tellsTrouble(th.title) || DRAMA_FLAIR.test(th.data.flair || ''))) continue;
    const lead = LEAD_BOARDS.has(sub);
    for (const key of namedIn(th.title, index, { creatorText: lead })) add(key, spelt(key, th.title), { t: th.t, k: 'post', voice: `reddit:${th.key}`, title: th.title, outlet: 'Reddit', sub, id: th.key, who: null, n: null }, calledCreator(th.title, key));
  }
  for (const o of items.filter((i) => i.source === 'ontd' && within(i) && tellsTrouble(i.title))) {
    for (const key of namedIn(o.title, index, {})) add(key, spelt(key, o.title), { t: o.t, k: 'post', voice: `ontd:${o.key}`, title: o.title, outlet: 'ONTD', sub: 'ontd', id: o.key, who: null, n: newest(pointsOf(series, 'ontd', o.key)) }, false);
  }
}

module.exports = { tellsTrouble, DRAMA_ISH, fromAsked, fromRoster, fromLsf, fromArcticComments, fromArcticPosts, fromIvr, fromSully, fromBans, fromFamous, fromOntd, merge, peopleIndex, namedIn, unknownNames, familiesOf, quotable, isStrict,
  peopleOf, toldOf, answers, possessedByOther, sameOwner, gainAnHour, NATIVE_FAMS, CLUSTER_SPAN, THREAD_BUSY, LEAD_BOARDS, VOICE_BACK };
