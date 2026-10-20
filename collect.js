#!/usr/bin/env node
'use strict';
/*
 * One cycle of the Ideas collector (ios/IDEAS-FEED.md A1, A3):
 *
 *   node collect.js --state <dir> --out <dir>
 *        [--now=ISO] [--offline] [--audiences=US,GB,AU,CA,mixed] [--max-requests=80] [--deadline-seconds=420]
 *        [--record=<dir>] [--replay=<dir>]
 *
 * Fetches within the request budget, upserts every reply into the engine's store, builds once and ranks per audience, matches every
 * row to its trend, samples and measures it, builds and validates the feed, publishes it. Safe to run every 15 minutes: a second run
 * finds the lock and exits 2. Exit 0: a feed was published; 1: nothing new was published (the feed already out is untouched: the
 * slot is behind the last one out, the last network cycle began under ten minutes ago, or no list passed whole); 2: another cycle
 * holds the lock, or took it from this one before it wrote; 3: the cycle failed (the engine or an error nobody foresaw: the
 * host's job fails on it and shows the log) or its clock is not to be trusted.
 *        [--force]   run although the last network cycle began under ten minutes ago, or --now is given on a state a real cycle
 *                    published to inside the last two hours
 *        [--fresh]   start from nothing on purpose: a state with no history is not re-seeded from the feed already in <out>
 *        [--cards=<file>]  the host's collect, with no model of its own (ios/IDEAS-SUPER.md P11): the cards the enrich pass wrote are
 *                    imported from <file> wherever a card was written from the row's dossier as it is this cycle (a card for a story
 *                    that has moved since is dropped), kept cards are shown, nothing is asked, and the rows still owed are left in
 *                    <state>/enrich/plan.json for the next pass (lib/editor/cards.js). A file that is not there imports nothing.
 *                    Ignored when a model is named (IDEAS_LLM_BASE_URL): that cycle writes its own cards as before
 *        [--stories=<file>]  the enrich pass's stories by meaning (ios/IDEAS-SUPER.md P8, lib/cluster/stories.js): two rows they put
 *                    in one story, whose headlines name each other, are one row at the desk; and the rows of this cycle are left
 *                    in <state>/enrich/stories.json for the next pass. A file that is not there, too old or of an untuned model
 *                    changes nothing: the desk's own rules decide
 *        [--check-state]  no cycle: says whether <state> holds a state worth keeping ({ ok, why, cycle, trends } on stdout; exit 0
 *                    when it does, 4 when not). What the host asks before it saves the folder as the newest (A8)
 * stdout: one JSON line { cycle, slot, requests, blocked, items, modelLines, ms, answered, seconds, ... }; everything else goes to stderr.
 *        seconds: each step's { fetch, build, measure, lines, editor, feed, publish }, the editor model's time apart from the lines'.
 *
 * --record saves each reply under <dir>/<slot>/ with a manifest; --replay answers every request from such a folder instead of the
 * network (what test/replay.test.js runs). Zero npm dependencies; works with no environment at all (A7).
 *
 * The one line of a row may be written by a model (G): only when IDEAS_LLM_BASE_URL names an OpenAI-compatible endpoint (lib/llm.js),
 * at most six calls a cycle, and a line is the model's only when the claim check passes it (lib/lines.js). With none set, offline
 * or in a replay there are no calls, and every line is a headline's (lib/line-sources.js).
 */
const fs = require('node:fs');
const path = require('node:path');
const ENGINE = require('./engine/build');
const ST = require('./engine/store');
const S = require('./engine/sources');
const TS = require('./engine/talk-sources');
const W = require('./engine/wording');
const TC = require('./engine/talk-candidates');
const TN = require('./engine/talk-nouns');
const { median, stripParen } = require('./engine/util');
const B = require('./lib/budget');
const F = require('./lib/fetch');
const Q = require('./lib/queue');
const H = require('./lib/history');
const FEED = require('./lib/feed');
const PUB = require('./lib/publish');
const STATE = require('./lib/state');
const ING = require('./lib/ingest');
const ROWS = require('./lib/rows');
const FIXED = require('./lib/sources/fixed');
const NAMES = require('./lib/sources/names');
const OWED = require('./lib/sources/owed');
const SG = require('./lib/signals');
const CLIPS = require('./lib/sources/clips');
const SOCIAL = require('./lib/sources/social');
const TIKTOK = require('./lib/sources/tiktok');
const DISC = require('./lib/discover');
const LEDGER = require('./lib/native-ledger');
const NS = require('./lib/native-signals');
const NDESK = require('./lib/native-desk');
const ASKED = require('./lib/sources/asked');
const YT = require('./lib/sources/yt-roster');
const LSF = require('./lib/sources/lsf');
const ARCTIC = require('./lib/sources/arctic');
const IVR = require('./lib/sources/ivr');
const SULLY = require('./lib/sources/sully');
const BANS = require('./lib/sources/streamerbans');
const FAMOUS = require('./lib/sources/famous');
const ONTD = require('./lib/sources/ontd');
const PRESS = require('./lib/sources/press');
const BING = require('./lib/sources/bing');
const PS = require('./lib/platform-signals');
const PDESK = require('./lib/platform-desk');
const TTS = require('./lib/sources/tts');
const ROUNDUPS = require('./lib/sources/roundups');
const REELS = require('./lib/sources/reels');
const SHAZAM = require('./lib/sources/shazam');
const KWORB = require('./lib/sources/kworb');
const WIKIH = require('./lib/sources/wiki-hourly');
const SIZE = require('./lib/size/cycle');
const GDELT = require('./lib/sources/gdelt');
const WIKT = require('./lib/sources/wikt-slang');
const TYPED = require('./lib/sources/typed');
const PINTEREST = require('./lib/sources/pinterest');
const APPS = require('./lib/sources/apps');
const ROBLOX = require('./lib/sources/roblox');
const STEAM = require('./lib/sources/steam');
const YTR = require('./lib/sources/yt-results');
const TTSOUND = require('./lib/sources/tiktok-sound');
const TTPROFILE = require('./lib/sources/tiktok-profile');
const SWITCH = require('./lib/sources/switch');
const D = require('./lib/describe');
const M = require('./lib/measure');
const NM = require('./lib/names');
const LLM = require('./lib/llm');
const LW = require('./lib/line-writer');
const XC = require('./lib/editor/cards');
const CS = require('./lib/cluster/stories');
const HY = require('./lib/hygiene');
const RESEED = require('./lib/reseed');
const DESK = require('./lib/desk');
const PSINK = require('./lib/page-sink');
const SENSE = require('./lib/sense');
const V = require('./samples/validate.cjs');
const { AUDIENCES, slotOf, instant, HOUR, DAY, SLOT_SECONDS, localDay, keyOf } = require('./lib/util');

const RAW_KEPT_SECONDS = 48 * HOUR;
const TODAY_FEED_REFRESH_SECONDS = 6 * HOUR;
const WARM_SECONDS = 3 * HOUR;
const LAG_KEPT = 8;
const DEFAULT_LAG_SECONDS = 300;
const NAMES_WANTED_KEPT = 1000;
const ORIGINS_WANTED_KEPT = 40;
const ORIGIN_ASK_AGAIN_SECONDS = DAY;
const LAST_READ_KEPT_SECONDS = 30 * DAY;
const EMPTY_STORE_BYTES = 200;
const HOST_NAMES = { 'news.google.com': 'google-news', 'trends.google.com': 'google-trends', 'trends.google.com/rss': 'google-trends-rss', 'suggestqueries.google.com': 'youtube-completions',
  'www.reddit.com': 'reddit', wikimedia: 'wikipedia', 'knowyourmeme.com': 'knowyourmeme', 'public.api.bsky.app': 'bluesky', 'hn.algolia.com': 'hacker-news',
  'gql.twitch.tv': 'twitch', 'kick.com': 'kick', 'trends24.in': 'x-trends24', 'www.tiktok.com': 'tiktok-web',
  // (the keyless drama sources, L)
  'www.youtube.com': 'youtube-roster', 'arctic-shift.photon-reddit.com': 'arctic-shift', 'api.livestreamfails.com': 'livestreamfails', 'api.ivr.fi': 'ivr', 'sullygnome.com': 'sullygnome',
  'streamerbans.com': 'streamerbans', 'www.famousbirthdays.com': 'famous-birthdays', 'ohnotheydidnt.livejournal.com': 'ontd', 'api.bing.com': 'bing-completions', 'www.bing.com': 'bing-news',
  'pagesix.com': 'page-six', 'www.ladbible.com': 'ladbible', 'www.complex.com': 'complex', 'theshaderoom.com': 'the-shade-room', 'www.hotnewhiphop.com': 'hotnewhiphop',
  // (the platform, word and craze sources, M)
  'trendingtiktoksongs.com': 'trending-tiktok-songs', 'later.com': 'later', 'www.ramd.am': 'ramdam', 'creatordb.app': 'creatordb-reels-audio', 'www.shazam.com': 'shazam', 'kworb.net': 'kworb',
  'dumps.wikimedia.org': 'wikipedia-hourly', 'storage.googleapis.com': 'gdelt', 'trends.pinterest.com': 'pinterest-trends', 'rss.marketingtools.apple.com': 'apple-top-free', 'itunes.apple.com': 'apple-photo-video',
  'apis.roblox.com': 'roblox', 'games.roblox.com': 'roblox-games', 'api.steampowered.com': 'steam' };
// (a native row is never "on the page" by where it was put: it sits past the page until the series tags it. lib/native-desk.js)
const NATIVE_RANK_FROM = 21;
// every adapter id of the keyless drama sources (L): what IDEAS_SOURCES_OFF names to switch them off, one or all
const NATIVE_SOURCES = ['asked', 'asked-bing', 'yt-roster', 'lsf', 'arctic', 'ivr', 'sully', 'streamerbans', 'famous', 'ontd', 'bing-news', ...PRESS.OUTLETS.map((o) => o.id)];
// every adapter id of the platform, word and craze sources (M): what IDEAS_SOURCES_OFF names to switch them off, one or all
const PLATFORM_SOURCES = ['tts', ...ROUNDUPS.PAGES.map((p) => `roundup-${p.id}`), 'reels', 'shazam', 'kworb', 'wiki-hourly', 'gdelt', 'wikt-slang', 'typed', 'pinterest', 'apps', 'roblox', 'steam'];
// (how many of the list's people the hourly files and GDELT are read for, and how many hours read are remembered)
const PLATFORM_NAMES_KEPT = 80;
const WIKI_HOURS_KEPT = 48;
const HOURLY_DETAILS_SECONDS = HOUR;
const X_NAMES_PER_CYCLE = 2;
const THREAD_BACK_MS = 72 * 3600e3;
const TIKTOK_TAGS_KEPT = 40;
// (the budget is a cycle's, and a cycle is a quarter hour: two inside ten minutes send every host twice its share. A4)
const NETWORK_AGAIN_SECONDS = 10 * 60;
const LIVE_LATELY_SECONDS = 2 * HOUR;
const THIRD_ROUND_NEWS = 3;
const CLOCK_SKEW_MAX_SECONDS = SLOT_SECONDS;
const CLOCK_SAMPLES_MIN = 3;

const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

function parseArgs(argv) {
  const out = { audiences: AUDIENCES, maxRequests: B.CYCLE_CAP, deadlineSeconds: 420, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.split(/=(.*)/s);
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (flag === '--state') out.state = value();
    else if (flag === '--out') out.out = value();
    else if (flag === '--now') out.now = Date.parse(value());
    else if (flag === '--offline') out.offline = true;
    else if (flag === '--force') out.force = true;
    else if (flag === '--fresh') out.fresh = true;
    else if (flag === '--check-state') out.checkState = true;
    else if (flag === '--audiences') out.audiences = value().split(',').map((x) => x.trim()).filter((x) => AUDIENCES.includes(x));
    else if (flag === '--max-requests') out.maxRequests = Math.max(0, Number(value()) || 0);
    else if (flag === '--deadline-seconds') out.deadlineSeconds = Math.max(30, Number(value()) || 420);
    else if (flag === '--record') out.record = value();
    else if (flag === '--replay') out.replay = value();
    else if (flag === '--cards') out.cards = value();
    else if (flag === '--stories') out.stories = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (out.checkState && out.state) return out;
  if (!out.state || !out.out) throw new Error('usage: node collect.js --state <dir> --out <dir> [--now=ISO] [--offline] [--audiences=US,GB,AU,CA,mixed] [--max-requests=80] [--deadline-seconds=420]');
  if (out.now !== undefined && !Number.isFinite(out.now)) throw new Error('--now must be an ISO instant');
  if (!out.audiences.length) throw new Error('--audiences names none of US, GB, AU, CA, mixed');
  return out;
}

/**
 * The stories by meaning this cycle read, for the ledger (P8): counts and minutes only, never a row. { slot, age, size, joined,
 * planned, model, texts, vectors, seconds, why }: joined, the rows the desk folded by meaning in the main list.
 */
function storiesSummary(index, why, edited, nowMs) {
  const joined = ((edited && edited.notes) || []).filter((n) => /\(by meaning\)$/.test(n.did || '')).length;
  if (!index) return { slot: null, age: null, size: 0, joined: 0, planned: null, model: null, texts: null, vectors: null, seconds: null, why: why || null };
  const st = index.stats || {};
  return { slot: index.slot, age: Number.isFinite(index.made) ? Math.max(0, Math.round((nowMs / 1000 - index.made) / 60)) : null, size: index.size, joined, planned: null,
    model: index.model || null, texts: Number.isFinite(st.texts) ? st.texts : null, vectors: Number.isFinite(st.vectors) ? st.vectors : null, seconds: Number.isFinite(st.seconds) ? st.seconds : null, why: null };
}

/** A transport that answers from a recorded cycle folder: <dir>/<slot>/<request id>, with manifest.json naming each reply's status. */
function replayTransport(dir, slot) {
  const folder = path.join(dir, String(slot));
  const manifest = fs.existsSync(path.join(folder, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) : {};
  return async (request) => {
    const entry = manifest[request.id];
    const file = path.join(folder, encodeURIComponent(request.id));
    if (!entry || !fs.existsSync(file)) return { status: 404, text: '', retryAfter: null };
    return { status: entry.status, text: fs.readFileSync(file, 'utf8'), retryAfter: entry.retryAfter || null };
  };
}

/** What the engine reads beside its store: Wikipedia's most-read rows and daily top lists, the month's crazes, the creators' roster. */
function engineInputs(wikiDir, nowMs) {
  const wiki = [];
  for (const name of fs.readdirSync(wikiDir).filter((n) => S.WIKI_FILES.test(n)).sort().reverse()) {
    wiki.push(...S.wikiRows(fs.readFileSync(path.join(wikiDir, name), 'utf8'), stripParen, W.words, median));
  }
  return { wiki, wikiLists: TS.wikiTopLists(wikiDir), crazes: TS.crazeRows(wikiDir, nowMs), roster: TS.rosterNames(wikiDir) };
}

const BEAT_BACK_MS = 72 * 3600e3;
const BEAT_NAME_WORDS = 3;
/** Every run of one to three words the creators' beat printed in a headline of the last two days, squeezed as a name's search key is. */
function beatNames(store, nowMs) {
  const keys = new Set();
  for (const r of store.rows.values()) {
    if (!Number.isFinite(r.t) || nowMs - r.t > BEAT_BACK_MS || !(r.src === 'dexerto' || TC.CREATOR_PRESS.test(r.publisher || r.label || ''))) continue;
    const ws = W.words(String(r.title || '').replace(/\s[-–—]\s[^–—-]{2,60}$/, ''));
    for (let i = 0; i < ws.length; i++) for (let n = 1; n <= BEAT_NAME_WORDS && i + n <= ws.length; n++) keys.add(TS.talkKey(ws.slice(i, i + n).join(' ')));
  }
  return keys;
}

/** One cycle. opts: parseArgs' result, plus `transport` (tests) and `env`. Resolves { code, summary }. */
async function runCycle(opts) {
  const started = Date.now();
  const env = opts.env || process.env;
  const nowMs = opts.now ?? Date.now();
  const nowS = Math.floor(nowMs / 1000);
  const t = slotOf(nowMs);
  // (the clock back-off and spacing run on: the pinned one plus what has really passed)
  const clock = () => nowS + Math.floor((Date.now() - started) / 1000);
  // how long each step took, for the summary and the report (seconds)
  const timing = {};
  let lapAt = started;
  const lap = (name) => { const at = Date.now(); timing[name] = Math.round((at - lapAt) / 100) / 10; lapAt = at; };
  if (!STATE.takeLock(opts.state, nowS)) { log('[collect] another cycle holds the lock'); return { code: 2, summary: null }; }
  let state = null;
  try {
    // (a collector.db that does not read is set aside, never opened and never written over: the cycle starts from the newest daily
    // backup in the folder, else from nothing. A6, N)
    const recovered = STATE.recover(opts.state);
    if (recovered.setAside) log(`[collect] collector.db did not read: set aside as ${path.basename(recovered.setAside)}${recovered.restored ? `, restored from backup/${recovered.restored}` : ', starting from no state'}`);
    state = STATE.openState(opts.state);
    const { db, paths, meta } = state;
    // (a state with no history, and a feed already out: the collector re-seeds itself from what that feed says in public, so every
    // listed id, start and graph survives a lost cache and nothing new is ever published to keep them. lib/reseed.js, N)
    const hostOfName = (name) => (Object.entries(HOST_NAMES).find(([, n]) => n === name) || [name.includes('.') ? name : null])[0];
    const reseeded = opts.fresh ? null : RESEED.reseed({ db, meta, out: opts.out, t, hostOf: hostOfName, missing: !!recovered.restored, log });
    if (reseeded) log(`[reseed] no state, and a feed out: ${reseeded.trends} trends and ${reseeded.samples} graph points read back from the feed of ${instant(reseeded.from)} (marked re-seeded)`);
    const cycle = (meta.get('cycle', 0) || 0) + 1;
    // never backwards: a slot before the last one published (a clock set back, a stray --now on the live state) would write over newer
    // samples and put an older list out. The same slot again is fine (A3)
    let lastPublish = meta.get('lastPublish', null);
    const wall = Math.floor(Date.now() / 1000);
    const pinned = opts.now !== undefined;
    const real = !opts.replay && !opts.transport;
    // (a pinned clock on a state a real cycle published to lately is a stray --now on the live state: one such run with a clock a
    // day ahead froze the list until real time passed it. Refused unless forced)
    if (pinned && real && !opts.force && lastPublish && !lastPublish.pinned && Number.isFinite(lastPublish.at) && wall - lastPublish.at < LIVE_LATELY_SECONDS && Math.abs(nowS - wall) > SLOT_SECONDS) {
      log(`[collect] --now ${instant(nowS)} on a state a real cycle published to ${wall - lastPublish.at} s ago: nothing done (use --force, or a copy of the state)`);
      return { code: 3, summary: null };
    }
    // (and a last publish that is ahead of the real clock is no guard to hold a real cycle back by: a wrong clock, once. Loudly)
    if (!pinned && lastPublish && Number.isFinite(lastPublish.t) && lastPublish.t > slotOf(Date.now()) + SLOT_SECONDS) {
      log(`[collect] WARNING: the last published slot ${instant(lastPublish.t)} is ahead of the clock ${instant(wall)}: it was written with a wrong clock and is set aside`);
      meta.set('lastPublishBogus', lastPublish);
      lastPublish = null;
      meta.set('lastPublish', null);
    }
    if (lastPublish && Number.isFinite(lastPublish.t) && t < lastPublish.t) {
      log(`[collect] slot ${instant(t)} is before the last published slot ${instant(lastPublish.t)}: nothing done, the feed already out stays`);
      return { code: 1, summary: null };
    }
    // (every cap is a cycle's: a second network cycle inside ten minutes of the last, a delayed run and the next one back to back or
    // a slot run again by hand, would send each host its share twice. It does nothing; --force, a replay and --offline are not held)
    const lastNetworkAt = meta.get('lastNetworkAt', null);
    if (real && !opts.offline && !opts.force && Number.isFinite(lastNetworkAt) && wall >= lastNetworkAt && wall - lastNetworkAt < NETWORK_AGAIN_SECONDS) {
      log(`[collect] the last network cycle began ${wall - lastNetworkAt} s ago: nothing done (the request budget is a quarter hour's; use --force)`);
      return { code: 1, summary: null };
    }
    if (real && !opts.offline) meta.set('lastNetworkAt', wall);
    if (meta.get('firstCycleAt') === null) meta.set('firstCycleAt', t);
    const store = ST.openStore(paths.store);
    // (the store is only ever renamed into place, so one that is there and does not read is a damaged disk or a bad restore: it is
    // set aside for a person to look at, never silently written over; the cycle goes on as a cold start would)
    if (!store.rows.size && !store.lastRefresh && fs.existsSync(paths.store) && fs.statSync(paths.store).size > EMPTY_STORE_BYTES) {
      fs.renameSync(paths.store, `${paths.store}.unreadable`);
      log(`[collect] engine/store.json did not read: set aside as store.json.unreadable, starting from an empty store`);
    }
    if (!store.talkTrends) store.talkTrends = new Map();
    const obs = ING.newObservations(t);
    // (who is a creator, as the last cycles' roster pages say: the clip charts' reader asks it which names a clip's title carries)
    obs.roster = TS.rosterNames(paths.wiki);
    // the creator-native sources (L): who is already known as a creator, and the ledger of what those sources showed. Each step is
    // fenced: a source that died, or a reply nobody foresaw, costs its own signal and nothing else of the cycle
    let nativeIndex = { byKey: new Map(), alias: new Map() };
    try { LEDGER.ensure(db); nativeIndex = NS.peopleIndex({ roster: obs.roster, streamers: IVR.streamers() }); } catch (e) { log(`[native] the roster did not read: ${e.message}`); }
    let nativeBooked = 0;
    const nativeStats = { fresh: 0, research: [] };
    const bookNative = () => {
      const batches = obs.native.slice(nativeBooked);
      nativeBooked = obs.native.length;
      if (!batches.length) return;
      try { nativeStats.fresh += LEDGER.record(db, t, NS.merge(...batches)).fresh; } catch (e) { log(`[native] the ledger was not written: ${e.message}`); }
    };
    const peopleNow = (index = nativeIndex) => { try { return NS.peopleOf(LEDGER.load(db, t), index, t); } catch (e) { log(`[native] the signals did not read: ${e.message}`); return new Map(); } };
    // the platform, word and craze sources (M): their own ledger, and what it holds read into things. Fenced like the creators' side:
    // a source that died, or a reply nobody foresaw, costs its own rows and nothing else of the cycle
    const PL = LEDGER.platform;
    try { PL.ensure(db); } catch (e) { log(`[platform] the ledger was not made: ${e.message}`); }
    let platformBooked = 0;
    const platformStats = { fresh: 0, wiki: null };
    const bookPlatform = () => {
      const batches = obs.platform.slice(platformBooked);
      platformBooked = obs.platform.length;
      if (!batches.length) return;
      try { platformStats.fresh += PL.record(db, t, LEDGER.merge(...batches)).fresh; } catch (e) { log(`[platform] the ledger was not written: ${e.message}`); }
    };
    const EMPTY_LEDGER = { items: [], series: new Map(), reads: new Map() };
    const platformLedger = () => { try { return PL.load(db, t); } catch (e) { log(`[platform] the ledger did not read: ${e.message}`); return EMPTY_LEDGER; } };
    const thingsOf = (ledger) => { try { return PS.thingsOf(ledger, t); } catch (e) { log(`[platform] the things did not read: ${e.message}`); return PS.thingsOf(EMPTY_LEDGER, t); } };
    // (who the engine is asked to evaluate: everyone the signals are about that can be named, and the shortlist)
    const nativeNames = (people) => [...people.values()].filter((p) => NDESK.nameable(p) && (Object.keys(p.kinds).length || p.shortlist)).map((p) => ({ key: p.key, kinds: Object.keys(p.kinds).length, creator: p.creator }));
    const hosts = new Map(db.prepare('SELECT * FROM hosts').all().map((r) => [r.host, { ...r }]));
    const off = new Set((env.IDEAS_SOURCES_OFF || '').split(',').map((x) => x.trim()).filter(Boolean));
    // (a few Google News requests are kept back for the third round: the name a roster flare or a new game on the chart wants
    // searched in the same cycle. The second round spent the whole cap on 35 of 39 recorded cycles. Reviewers, 2026-10-12)
    // (and the size step's share of the Wikimedia Action API, freed just before it: the dictionary lookups fill the group's cap)
    let sizeHold = 0;
    try { sizeHold = real ? SIZE.actionShare({ db, now: nowS, agent: B.userAgent(env) }) : 0; } catch (e) { log(`[size] its share was not kept back: ${e.message}`); }
    const budget = B.createBudget({ cap: opts.offline ? 0 : opts.maxRequests, hosts, now: nowS, off, reserve: { 'news.google.com': THIRD_ROUND_NEWS, ...(sizeHold ? { wikimedia: sizeHold } : {}) } });
    const skews = [];
    const transport = opts.offline ? null : opts.transport || (opts.replay ? replayTransport(opts.replay, t) : F.netTransport(env));
    const fetchDeadline = started + Math.min(B.FETCH_DEADLINE_SECONDS, opts.deadlineSeconds) * 1000;
    const recorded = {};
    const lastRead = new Map(Object.entries(meta.get('lastRead', {}) || {}));
    const outcome = { sent: 0, ok: 0, gnSent: 0, gnOk: 0, byHost: {} };
    const putFetch = db.prepare('INSERT OR REPLACE INTO fetches (cycle, source, host, t, status, bytes, ms) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const putHost = db.prepare('INSERT OR REPLACE INTO hosts (host, blocked_until, strikes, last_ok_at, last_status, first_turned_away_at, timeouts, last_request_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    // (what a page that changes once a day answered with last time: it is asked for again only if it has changed. M)
    const validators = { ...(meta.get('validators', {}) || {}) };

    /** Sends a round, saves and reads every reply in the order asked, and books what happened. */
    const round = async (requests) => {
      if (!transport || !requests.length) return [];
      const results = await F.send(requests.map((r) => (r.conditional && validators[r.id] && fs.existsSync(path.join(paths.raw, r.file)) ? { ...r, validators: validators[r.id] } : r)),
        { budget, hosts, clock, deadlineMs: fetchDeadline, transport, ...(opts.replay || opts.transport ? { gap: () => 0 } : {}) });
      for (const r of results) {
        const { request } = r;
        // (the server's own clock against this machine's, from every reply that carries one)
        if (r.date && Number.isFinite(Date.parse(r.date))) skews.push(Date.parse(r.date) / 1000 - Date.now() / 1000);
        outcome.sent += r.tried;
        outcome.byHost[request.host] = (outcome.byHost[request.host] || 0) + r.tried;
        // the raw reply first: `.new`, then renamed
        const proper = r.status === 200 || (request.kind === 'kym-page' && r.status === 404);
        let ok = false;
        if (proper) {
          if (request.toWiki) {
            ok = ING.wikiFileOk(request.args, r.text);
            if (ok) STATE.writeAtomic(path.join(paths.wiki, request.file), r.text);
          } else {
            STATE.writeAtomic(path.join(paths.raw, request.file), r.text);
            ok = ING.ingest(store, obs, request, r.text, nowMs, { status: r.status, tried: r.tried, guessed: r.guessed });
          }
        }
        // (not changed since it was last read: the saved reply is what the page still says, and it is read again as this cycle's)
        if (r.status === 304 && request.conditional) {
          const saved = path.join(paths.raw, request.file);
          if (fs.existsSync(saved)) { ok = ING.ingest(store, obs, request, fs.readFileSync(saved, 'utf8'), nowMs, { status: 200, tried: r.tried, guessed: r.guessed }); if (ok) { const at = new Date(); fs.utimesSync(saved, at, at); } }
          if (!ok) delete validators[request.id];
        } else if (request.conditional) {
          if (ok && (r.etag || r.lastModified)) validators[request.id] = { ...(r.etag ? { etag: r.etag } : {}), ...(r.lastModified ? { lastModified: r.lastModified } : {}) };
          else delete validators[request.id];
        }
        if (request.host === 'news.google.com') { outcome.gnSent += 1; if (ok) outcome.gnOk += 1; }
        if (ok) { outcome.ok += 1; lastRead.set(request.rotationId || request.id, t); if (request.queued) Q.done(db, request.id); } else if (request.queued) Q.failed(db, request.id, nowS);
        putFetch.run(cycle, request.id, request.host, t, r.status, r.bytes, r.ms);
        if (opts.record) {
          const folder = path.join(opts.record, String(t));
          fs.mkdirSync(folder, { recursive: true });
          fs.writeFileSync(path.join(folder, encodeURIComponent(request.id)), r.text || '');
          recorded[request.id] = { status: r.status, kind: request.kind, host: request.host, bytes: r.bytes };
        }
        if (!ok) log(`[fetch] ${request.id}: ${r.status || r.error || 'failed'}${proper ? ' (not a proper reply)' : ''}`);
      }
      meta.set('validators', validators);
      for (const [host, row] of hosts) putHost.run(host, row.blocked_until ?? null, row.strikes || 0, row.last_ok_at ?? null, row.last_status ?? null, row.first_turned_away_at ?? null, row.timeouts || 0, row.last_request_at ?? null);
      return results;
    };

    const saveHost = (host) => { const row = hosts.get(host); if (row) putHost.run(host, row.blocked_until ?? null, row.strikes || 0, row.last_ok_at ?? null, row.last_status ?? null, row.first_turned_away_at ?? null, row.timeouts || 0, row.last_request_at ?? null); };
    /**
     * Wikipedia's newest hourly file, read for the pages the list holds (M4): sixty megabytes gzipped, so it is streamed and never
     * held, one file an hour and never one a cycle, behind the budget and the host's own back-off like any request. A file that is
     * not out yet (404) is asked for again next cycle; a failure costs this hour's reading and nothing else. names: [{ key, title }].
     */
    const wikiHourly = async (names) => {
      // (never the network in a replay or a test: there the reader is handed in, or nothing is read)
      const read = opts.wikiRead || (real ? WIKIH.read : null);
      if (!read || opts.offline || !names.length) return;
      const hours = new Set(meta.get('wikiHours', []) || []);
      const hour = WIKIH.hourDue(nowS, hours, meta.get('wikiHourNotYet', null));
      const host = WIKIH.HOST;
      const request = { id: `wiki-hourly-${hour}`, host, source: 'wiki-hourly' };
      if (hour === null || Date.now() > fetchDeadline - 60000 || !budget.take(request)) return;
      const titles = new Map(names.map((n) => [n.title, n.key]));
      let result = null;
      try { result = await read(hour, new Set(titles.keys()), { agent: B.userAgent(env) }); } catch (e) {
        result = { status: 0, error: e && e.message ? e.message : String(e), timeout: !!e && (e.name === 'TimeoutError' || e.name === 'AbortError'), bytes: 0, ms: 0 };
      }
      hosts.set(host, { ...B.hostAfter(hosts.get(host), { status: result.status, retryAfter: B.retryAfterSeconds(result.retryAfter, clock()), timeout: !!result.timeout }, clock(), host), host });
      saveHost(host);
      if (result.date && Number.isFinite(Date.parse(result.date))) skews.push(Date.parse(result.date) / 1000 - Date.now() / 1000);
      outcome.sent += 1;
      outcome.byHost[host] = (outcome.byHost[host] || 0) + 1;
      putFetch.run(cycle, request.id, host, t, result.status, result.bytes || 0, result.ms || 0);
      if (result.status === 200) {
        outcome.ok += 1;
        obs.platform.push(PS.fromWikiHourly(hour, new Map([...result.views].map(([title, views]) => [titles.get(title), views]))));
        meta.set('wikiHours', [...new Set([...hours, hour])].sort((a, b) => a - b).slice(-WIKI_HOURS_KEPT));
        platformStats.wiki = { hour: instant(hour), pages: result.views.size, bytes: result.bytes, ms: result.ms };
        log(`[platform] wikipedia hour ${instant(hour)}: ${result.views.size} of ${titles.size} pages, ${Math.round(result.bytes / 1e6)} MB read in ${Math.round(result.ms / 100) / 10} s`);
      } else if (result.status === 404) {
        meta.set('wikiHourNotYet', hour);
        log(`[platform] wikipedia hour ${instant(hour)} is not out yet`);
      } else log(`[fetch] ${request.id}: ${result.status || result.error || 'failed'}`);
    };

    // (GDELT name discovery, P13: whether it acts this cycle, and what it did; lib/discover.js gdeltStep)
    const gdeltOn = DISC.gdeltOn(env);
    let gdeltCycle = null;
    // ---- step 2: fetch (tier 0, then the names that need a look now, the rotation, and what is owed) ----
    if (transport) {
      // (the clip charts are tier 0 too: what stands in for the streamer boards where Reddit turns the host away. A4)
      // (and the creator-native sources that say who to look at in this very cycle: the questions people type, the commentary roster's
      // feeds in turn, the clips with their scores, the streamers' own figures, two drama boards' comments. L1-L5)
      const rosterNewest = meta.get('rosterNewest', {}) || {};
      // (a feed that was asked and did not answer has had its turn all the same: a channel whose feed is gone is asked again in an
      // hour with the rest, never every cycle. L2)
      const rosterTried = meta.get('rosterTried', {}) || {};
      const rosterTurns = new Map([...lastRead, ...Object.entries(rosterTried).filter(([id, at]) => Number.isFinite(at) && at > (lastRead.get(id) ?? -Infinity))]);
      const nativeFirst = [...ASKED.googleRequests(), ...YT.turn(rosterTurns, rosterNewest, nowS).map(YT.feedRequest), LSF.lsfRequest(), IVR.ivrRequest(),
        ...ARCTIC.turn(cycle).flatMap((sub) => ARCTIC.boardRequests(sub, nowS, meta.get('arcticSlow', {}) || {}))];
      const firstRound = await round([...FIXED.tier0({ rssTrends: !B.hostOpen(hosts.get('trends.google.com'), nowS) }), CLIPS.twitchRequest(env), CLIPS.kickRequest(), ...nativeFirst]);
      // (the mirror's "slow down" to a board's posts search is remembered: that search is not sent again for six hours. L4)
      const feedsTried = firstRound.filter((r) => r.request.kind === 'yt-roster').map((r) => [r.request.id, t]);
      if (feedsTried.length) meta.set('rosterTried', Object.fromEntries([...Object.entries(rosterTried).filter(([, at]) => t - at < DAY), ...feedsTried]));
      const slowed = firstRound.filter((r) => r.request.kind === 'arctic-posts' && r.status === 422).map((r) => r.request.args.sub);
      if (slowed.length) meta.set('arcticSlow', { ...(meta.get('arcticSlow', {}) || {}), ...Object.fromEntries(slowed.map((sub) => [sub, nowS])) });
      bookNative();
      const people0 = peopleNow();
      const inputs0 = { ...engineInputs(paths.wiki, nowMs), native: nativeNames(people0) };
      const lastRows = meta.get('lastRows', []) || [];
      const searchedAt = new Map([...store.lookups.entries()].filter(([k, l]) => k.startsWith('talk-') && l.tpnewsAt).map(([k, l]) => [k.slice(5), Math.floor(l.tpnewsAt / 1000)]));
      let wanted = { lookup: [], drama: [] };
      try { wanted = ENGINE.names({ store, ...inputs0, now: nowMs }); } catch (e) { log(`[collect] names pass failed: ${e.message}`); }
      // the names never searched, the people-drama names first (creators lead them), then the engine's own order: the ones that first
      // showed this cycle are tier 1's "new"; the ones already waiting (a cold start's whole backlog) drain behind the list's own rows
      const wantedNames = [...new Set([...wanted.drama, ...wanted.lookup])];
      const fresh = wantedNames.filter((n) => !searchedAt.has(TS.talkKey(n)));
      const byKey = new Map(fresh.map((n) => [TS.talkKey(n), n]));
      const wantedBefore = meta.get('namesWanted', null);
      const waiting = new Set(Array.isArray(wantedBefore) ? wantedBefore : []);
      const isNew = (key) => Array.isArray(wantedBefore) && !waiting.has(key);
      // (among the names waiting, the ones the creators' beat wrote about in the last two days go first: a streamer's story with
      // three beat headlines must not wait an evening behind a backlog of "hospital" and "plague". Judges, 2026-10-11: OhnePixel,
      // Clavicular and a GTA 6 leaker were all in the store, unsearched, two hours after a cold start)
      const beatKeys = beatNames(store, nowMs);
      const beatFirst = (keys) => [...keys.filter((k) => beatKeys.has(k)), ...keys.filter((k) => !beatKeys.has(k))];
      const picked = B.pickNames({ fresh: beatFirst([...byKey.keys()].filter(isNew)), backlog: beatFirst([...byKey.keys()].filter((key) => !isNew(key))), rows: lastRows.map((r) => ({ ...r, name: TS.talkKey(r.name) })), searchedAt, now: nowS });
      const keep = (names) => { if (names.length) meta.set('namesWanted', [...new Set(names.map((n) => TS.talkKey(n)))].slice(0, NAMES_WANTED_KEPT)); };
      keep(wantedNames);
      const nameOf = (key) => byKey.get(key) || (lastRows.find((r) => TS.talkKey(r.name) === key) || {}).name || key;
      const trendNews = FIXED.trendNewsRequest(obs.momentTrends);
      // (a feed that cannot be asked takes no turn: one turned off, one whose host is in back-off)
      const turnOf = (id) => FIXED.rotationRequests(id, { nowMs, lastReadAt: lastRead.get(id) });
      const rotation = B.rotation(B.askable(FIXED.rotationIds(), turnOf, { hosts, off, now: nowS }), lastRead).flatMap(turnOf);
      // TikTok's totals for the list's own hashtags: only with the owner's switch on (IDEAS_SOURCES_ON=tiktok-web), last in the round
      const tiktokReadAt = meta.get('tiktokReadAt', {}) || {};
      const tiktok = TIKTOK.tiktokOn(env) ? TIKTOK.pickTags((meta.get('tiktokTags', []) || []).map((tag) => ({ tag })), tiktokReadAt).map(TIKTOK.tiktokRequest) : [];
      const watchState = meta.get('rosterWatch', { cursor: 0, carried: {} }) || { cursor: 0, carried: {} };
      const watch = NAMES.watchTurn(NAMES.watchNames(inputs0.roster), watchState.cursor, B.ROSTER_WATCH_PER_CYCLE);
      const haveWiki = new Set(fs.readdirSync(paths.wiki).filter((name) => {
        // (today's most-read feed is asked again every six hours: it fills through the day)
        const today = name === `wiki-featured-feed-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
        return !today || nowS - fs.statSync(path.join(paths.wiki, name)).mtimeMs / 1000 < TODAY_FEED_REFRESH_SECONDS;
      }));
      const savedAt = new Map(fs.readdirSync(paths.wiki).map((name) => [name, fs.statSync(path.join(paths.wiki, name)).mtimeMs / 1000]));
      const owed = Q.due(db, nowS).map((r) => ({ ...r, queued: true }));
      // the creators' roster: a page never read goes out at once (a cold start reads all eight in its first cycle: who is a creator
      // decides which names are searched first and what leads the list); a saved page is read again weekly, one page a cycle
      const roster = OWED.rosterRequests(nowS, savedAt);
      const rosterNew = roster.filter((r) => !savedAt.has(r.file));
      const ofKind = (kinds, n) => owed.filter((r) => kinds.includes(r.kind)).slice(0, n);
      // the slower creator-native sources and the outlets read at their own address (L5-L8): Bing's completions in turn, the ban
      // feed, the hourly tables, the outlets that are due, Bing News for a few listed names, and the titles of busy threads
      const askedBing = ASKED.bingRequests(meta.get('askedBingCursor', 0) || 0);
      const threadKnown = db.prepare('SELECT 1 FROM native_items WHERE source = ? AND key = ?');
      const nativeSecond = [...askedBing.requests, BANS.bansRequest(), SULLY.sullyRequest(lastRead.get('sully-losers'), nowS), FAMOUS.famousRequest(lastRead.get('famous-trending'), nowS),
        ONTD.ontdRequest(lastRead.get('ontd'), nowS), ...PRESS.due(lastRead, nowS).map(PRESS.pressRequest), ...BING.pick(lastRows, lastRead, nowS).map(BING.newsRequest),
        ARCTIC.idsRequest(obs.arcticBusy.filter((id) => !obs.arcticKnown.has(id) && !threadKnown.get('arctic', id)))].filter(Boolean);
      // the origin searches owed (C4): a listed story whose start sits where its week's search began to look; each asked once
      const origins = (meta.get('originsWanted', []) || []).map((w) => NAMES.originRequest(w.name, w.edge))
        .filter((r) => !(lastRead.has(r.id) && t - lastRead.get(r.id) < ORIGIN_ASK_AGAIN_SECONDS)).slice(0, B.ORIGINS_PER_CYCLE);
      // the platform, word and craze sources (M): what people type about a word, a trend and a thing to buy, in turn; GDELT's newest
      // slot for the list's own people; and, each when it is due, the sound charts and one sound's own page, the roundups, the Reels
      // page, Shazam and Kworb, Wiktionary's newest slang and two entries, Pinterest, an App Store chart, Roblox and Steam
      const platformNames = (meta.get('platformNames', []) || []).filter((n) => n && n.key && n.title);
      const want = (() => { try { return PDESK.wanted(thingsOf(platformLedger()), t); } catch (e) { log(`[platform] nothing asked for: ${e.message}`); return { songs: [], entries: [], roblox: [], steam: [] }; } })();
      const typed = TYPED.requests(meta.get('typedCursor', 0) || 0);
      const gdelt = platformNames.length ? GDELT.tocRequest(nowS, meta.get('gdeltSlot', null)) : null;
      const song = TTS.songTurn(want.songs, lastRead, nowS);
      const hourly = (id) => !(Number.isFinite(lastRead.get(id)) && nowS - lastRead.get(id) < HOURLY_DETAILS_SECONDS);
      // (the owner's switches, off unless IDEAS_SOURCES_ON names them: M11)
      const ytResults = SWITCH.isOn(env, 'youtube-results') ? YTR.requests(meta.get('ytResultsCursor', 0) || 0) : null;
      const switched = [...(ytResults ? ytResults.requests : []), ...(SWITCH.isOn(env, 'tiktok-sound') ? TTSOUND.turn(want.songs, lastRead) : []), ...(SWITCH.isOn(env, 'tiktok-profile') ? TTPROFILE.turn(lastRead, nowS) : [])];
      const platformSecond = [...typed.requests, gdelt ? { ...gdelt, args: { ...gdelt.args, names: platformNames.map((n) => n.key) } } : null, ...TTS.chartRequests(lastRead, nowS), song ? TTS.songRequest(song) : null,
        ...ROUNDUPS.roundupRequests(lastRead, nowS), REELS.reelsRequest(lastRead.get('reels-audio'), nowS), SHAZAM.shazamRequest(lastRead.get('shazam-discovery'), nowS), KWORB.kworbRequest(lastRead.get('kworb-us-daily'), nowS),
        ...WIKT.categoryRequests(lastRead, nowS), ...WIKT.entryTurn(want.entries, lastRead, nowS), PINTEREST.pinterestRequest(lastRead.get('pinterest-trends'), nowS), APPS.chartRequest(lastRead, nowS),
        ROBLOX.exploreRequest(lastRead.get('roblox-explore'), nowS), hourly('roblox-games') ? ROBLOX.gamesRequest(want.roblox) : null, STEAM.chartRequest(lastRead.get('steam-chart'), nowS),
        hourly('steam-names') ? STEAM.namesRequest(want.steam) : null, ...switched].filter(Boolean);
      // Wikipedia's newest hourly file, for the pages the list holds: streamed beside the round, never one a cycle (M4)
      const wikiJob = wikiHourly(platformNames);
      const second = [
        ...(trendNews ? [trendNews] : []),
        ...picked.now.flatMap((key) => NAMES.nameRequests(nameOf(key), 1)),
        // (a listed row with no start is a gap to close: its origin search goes before the feeds in rotation. C4)
        ...origins,
        ...rotation.slice(0, B.ROTATION_PER_CYCLE + 4),
        // (X's trends: one country's page a cycle, the one read longest ago, so each about hourly)
        SOCIAL.xRequest(SOCIAL.xTurn(lastRead)),
        OWED.redditRequest(B.redditTurn(cycle)),
        ...nativeSecond,
        ...rosterNew,
        ...watch.names.filter((n) => !picked.now.includes(TS.talkKey(n))).map(NAMES.watchRequest),
        ...picked.later.flatMap((key) => NAMES.nameRequests(nameOf(key), 3)),
        ...ofKind(['story-news', 'story-wiki'], B.STORY_LOOKUPS_PER_CYCLE),
        ...ofKind(['word-wiki', 'word-wikt', 'word-since'], B.WORD_LOOKUPS_PER_CYCLE),
        ...ofKind(['kym-page', 'kym-roundup'], B.KYM_PAGES_PER_CYCLE),
        ...OWED.wikiDailyRequests(nowS, haveWiki),
        ...roster.filter((r) => savedAt.has(r.file)).slice(0, 1),
        ...OWED.crazeRequests(nowS, savedAt),
        ...ofKind(['feed', 'name-recent'], 3),
        ...platformSecond,
        ...tiktok,
      ];
      await round(second);
      bookNative();
      await wikiJob;
      bookPlatform();
      // (a sound's page that was asked for and did not answer has had its turn all the same: the next sound is asked next cycle)
      if (song && !obs.read.has(`tts-song-${song.id}`)) lastRead.set(`tts-song-${song.id}`, t);
      // (the turn moves on by what was read: a template the budget refused is the first asked next cycle)
      const typedRead = typed.requests.filter((r) => obs.read.has(r.id)).length;
      if (typedRead) meta.set('typedCursor', ((meta.get('typedCursor', 0) || 0) + typedRead) % TYPED.TEMPLATES.length);
      if (obs.gdelt) meta.set('gdeltSlot', obs.gdelt.slot);
      if (ytResults && ytResults.requests.some((r) => obs.read.has(r.id))) meta.set('ytResultsCursor', ytResults.cursor);
      if (askedBing.requests.some((r) => obs.read.has(r.id))) meta.set('askedBingCursor', askedBing.cursor);
      if (Object.keys(obs.rosterNewest).length) meta.set('rosterNewest', { ...rosterNewest, ...obs.rosterNewest });
      if (obs.tiktok.size) meta.set('tiktokReadAt', Object.fromEntries([...Object.entries(tiktokReadAt), ...[...obs.tiktok.keys()].map((tag) => [tag, t])].slice(-4 * TIKTOK_TAGS_KEPT)));
      // X's trends: the lists read now and the ones held from the last hour and a half (the page is hourly)
      obs.x = SOCIAL.heldLists(meta.get('xTrends', {}) || {}, obs.xRead, t);
      meta.set('xTrends', obs.x.lists);
      // the roster watch: a drama noun a name has not carried in two weeks makes it a tier 1 name in the same cycle
      const carried = { ...(watchState.carried || {}) };
      const flared = [];
      for (const w of obs.watch) {
        const key = TS.talkKey(w.name);
        const sig = NAMES.watchSignal(w.completions, carried[key], nowS);
        // (never at a first sight: only a name whose completions were read before can be said to carry something new)
        if (sig.fresh.length && carried[key]) flared.push(w.name);
        carried[key] = sig.carried;
      }
      // and what the creator-native lists newly show: a creator of the roster X began to talk about inside the last three hours, a
      // game new to Twitch's most-watched (lib/discover.js). Each is worth its own search now, unless it was searched lately
      const lately = (name) => searchedAt.has(TS.talkKey(name)) && nowS - searchedAt.get(TS.talkKey(name)) < B.PAGE_RESEARCH_SECONDS;
      const gamesWas = meta.get('twitchGames', null);
      const games = obs.games ? DISC.gameMoves(gamesWas, obs.games, t) : null;
      const shown = [...SOCIAL.newCreators(obs.x, inputs0.roster, t).slice(0, X_NAMES_PER_CYCLE), ...(games ? games.fresh.map((g) => g.name) : [])].filter((name) => !lately(name) && !picked.now.includes(TS.talkKey(name)));
      if (shown.length) log(`[discover] ${shown.join(', ')}`);
      // (and who the creator-native signals are about, or the shortlist names, that no search has looked at lately: L6, L10)
      nativeStats.research = NDESK.research(peopleNow(), { lately: (name) => lately(name) || picked.now.includes(TS.talkKey(name)) });
      if (nativeStats.research.length) log(`[native] worth a search: ${nativeStats.research.join(', ')}`);
      // GDELT's slot, read again for the names the list does not hold that break out in the press (lib/discover.js gdeltStep, P13):
      // no request of its own. Counted whether or not it acts, so its baseline is warm the day it is switched on; on, a name that
      // breaks out has the slot's headlines naming it in the store, and one nobody searched lately is searched now, last in the round
      try {
        const held = new Set([...lastRows.map((r) => keyOf(r.name || '')), ...platformNames.map((n) => n.key)].filter(Boolean));
        gdeltCycle = DISC.gdeltStep(meta.get('gdeltNames', null), obs.gdeltArticles, { slot: obs.gdelt ? obs.gdelt.slot : null, on: gdeltOn, nowMs,
          searched: (name) => lately(name) || picked.now.includes(TS.talkKey(name)), known: (name) => held.has(keyOf(name)) });
        if (gdeltCycle.stats) {
          meta.set('gdeltNames', gdeltCycle.state);
          for (const row of gdeltCycle.rows) ST.upsertRow(store, row, nowMs);
        }
      } catch (e) { log(`[gdelt] name discovery failed, the cycle goes on without it: ${e.message}`); gdeltCycle = null; }
      const wantedNow = [...new Set([...flared, ...shown, ...nativeStats.research, ...(gdeltCycle ? gdeltCycle.fresh : [])])];
      budget.release('news.google.com');
      const thirdRound = wantedNow.length ? await round(wantedNow.flatMap((name) => NAMES.nameRequests(name, 1)).filter((r) => r.kind === 'name-news')) : [];
      // (a signal is used up only when its search was sent: a name the budget refused flares again next cycle, with its noun still
      // new, and a game whose search was not sent is still new to the chart then)
      const sent = new Set(thirdRound.map((r) => TS.talkKey((r.request.args || {}).name || '')));
      if (gdeltCycle) gdeltCycle.searched = gdeltCycle.fresh.filter((name) => sent.has(TS.talkKey(name))).length;
      for (const name of flared) { const key = TS.talkKey(name); if (!sent.has(key)) { if (watchState.carried && watchState.carried[key]) carried[key] = watchState.carried[key]; else delete carried[key]; } }
      const gamesSent = !games || games.fresh.every((g) => sent.has(TS.talkKey(g.name)) || lately(g.name) || picked.now.includes(TS.talkKey(g.name)));
      if (games && gamesSent) meta.set('twitchGames', games.state);
      meta.set('rosterWatch', { cursor: watch.cursor, carried });
      // the trends' size over their lives (D4 `size`): its share kept back from the rounds before, by rank, kept in the state (lib/size/cycle.js)
      budget.release('wikimedia');
      if (real) {
        try {
          await SIZE.step({ db, now: nowS, agent: B.userAgent(env), log, send: (requests) => F.send(requests, { budget, hosts, clock, deadlineMs: fetchDeadline, transport }),
            booked: (r) => { outcome.sent += r.tried; outcome.byHost[r.request.host] = (outcome.byHost[r.request.host] || 0) + r.tried; if (r.status === 200) outcome.ok += 1; putFetch.run(cycle, r.request.id, r.request.host, t, r.status, r.bytes, r.ms); saveHost(r.request.host); } });
        } catch (e) { log(`[size] the step failed, the details keep what the state held: ${e.message}`); }
      }
      // (the first plan ever was made on tier 0 alone: the names the rest of this cycle's replies brought are already waiting, they
      // are not "new" to the next cycle, which reads the list's own rows first)
      if (!Array.isArray(wantedBefore)) {
        try { const after = ENGINE.names({ store, ...engineInputs(paths.wiki, nowMs), now: nowMs }); keep([...after.drama, ...after.lookup]); } catch (e) { log(`[collect] names pass failed: ${e.message}`); }
      }
      if (obs.read.size) store.lastRefresh = nowMs;
    }
    // (with no network the lists held from the last hour and a half still stand)
    if (!obs.x) obs.x = SOCIAL.heldLists(meta.get('xTrends', {}) || {}, {}, t);
    // (what was read more than a month ago is asked as if never read: the table stays small however long the collector runs)
    meta.set('lastRead', Object.fromEntries([...lastRead].filter(([, at]) => t - at < LAST_READ_KEPT_SECONDS)));
    lap('fetch');
    if (opts.record && Object.keys(recorded).length) {
      // (a slot run twice keeps what both runs recorded)
      const file = path.join(opts.record, String(t), 'manifest.json');
      const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      fs.writeFileSync(file, JSON.stringify({ ...before, ...recorded }));
    }

    // ---- step 3: the store, the build, the ranking ----
    // (what a content farm printed never reaches the engine: no title, line, noun or count rests on it. lib/hygiene.js)
    const scrubbed = HY.scrubStore(store);
    if (scrubbed.dropped) log(`[hygiene] ${scrubbed.dropped} spam rows dropped${scrubbed.hosts.length ? ` (hosts: ${scrubbed.hosts.slice(0, 4).join(', ')})` : ''}`);
    ST.prune(store, nowMs);
    ST.saveStore(store, paths.store);
    const inputs = engineInputs(paths.wiki, nowMs);
    // (the creators' side as this cycle leaves it; with no network, as the ledger last had it)
    const people = peopleNow();
    let built;
    try {
      built = ENGINE.build({ store, ...inputs, now: nowMs, audiences: opts.audiences, native: nativeNames(people) });
    } catch (e) {
      log(`[collect] the engine failed, the feed already out stays: ${e.stack || e.message}`);
      meta.set('cycle', cycle);
      return { code: 3, summary: null };
    }
    // the desk (lib/desk.js): an editor's pass over the engine's rows, before they are matched to trends and measured
    const recent = [...store.rows.values()].filter((r) => (r.fam === 'gnews' || r.fam === 'celeb') && Number.isFinite(r.t) && nowMs - r.t < THREAD_BACK_MS && r.t <= nowMs)
      .map((r) => ({ t: r.t, title: r.title, outlet: r.publisher || r.label || null }));
    const isBeat = (outlet) => TC.CREATOR_PRESS.test(outlet) || TN.MAJOR.test(outlet);
    // (the desk never holds a list back: should it fail on a row nobody foresaw, that audience's rows go out as the engine made them)
    // (the enrich pass's stories by meaning, P8: one slot late, imported here; none and the desk's own rules decide alone)
    const storiesRead = opts.stories ? CS.indexOf(opts.stories, { nowS: Math.floor(nowMs / 1000) }) : { index: null, why: null };
    const stories = storiesRead.index;
    const deskOf = (a) => { const rows = ROWS.rowsOf(a, built.byAudience[a], built); try { return DESK.edit(rows, { recent, now: nowMs, isBeat, lex: built.lex, roster: obs.roster, stories }); } catch (e) { log(`[desk] ${a}: failed, the engine's rows stand: ${e.message}`); return { rows, notes: [] }; } };
    const edited = Object.fromEntries(opts.audiences.map((a) => [a, deskOf(a)]));
    // (and this cycle's rows, as the engine made them, for the next pass to make its stories from: the state's, never published)
    const mainAudience = opts.audiences.includes('US') ? 'US' : opts.audiences[0];
    const storiesOut = opts.stories ? storiesSummary(stories, storiesRead.why, edited[mainAudience], nowMs) : null;
    if (storiesOut) {
      try {
        storiesOut.planned = CS.writePlan(path.join(opts.state, 'enrich', 'stories.json'), CS.planOf(ROWS.rowsOf(mainAudience, built.byAudience[mainAudience], built), { t, nowMs }));
      } catch (e) { log(`[stories] the plan was not written: ${e.message}`); }
      // (counts only: this line reaches the job's public log)
      log(`[stories] ${stories ? `${storiesOut.size} sentences in the stories of slot ${storiesOut.slot ? instant(storiesOut.slot) : '?'} (${storiesOut.age} min old): ${storiesOut.joined} rows joined by meaning` : `none: ${storiesRead.why}`}; ${storiesOut.planned ?? '?'} rows planned for the next pass`);
    }
    // the creators' side (lib/native-desk.js): attached to the rows the engine lists for the same people, and, where two kinds of
    // creator-native signal agree on a creator no row tells yet, a row of its own for the series to tag Early
    // (read again with the list's own subjects known by name: what the boards, the roster and the questions say of a celebrity the
    // list already carries reaches that row. Nobody is made a row for it: lib/native-desk.js nameable)
    const listedNow = Object.values(edited).flatMap((e) => e.rows).filter((r) => r.type === 'point' && !r.wordish && r.subject).map((r) => ({ key: r.subject, name: r.surface || null }));
    let listedIndex = nativeIndex;
    try { listedIndex = NS.peopleIndex({ roster: obs.roster, streamers: IVR.streamers(), listed: listedNow }); } catch (e) { log(`[native] the list's names did not read: ${e.message}`); }
    const peopleListed = peopleNow(listedIndex);
    // (taken: everyone the engine already lists, under the name its row uses and under the one the rosters know them by)
    const taken = new Set(Object.values(edited).flatMap((e) => e.rows).filter((r) => r.type === 'point' && !r.wordish).flatMap((r) => [keyOf(r.subject || ''), keyOf(r.surface || '')])
      .flatMap((k) => [k, nativeIndex.alias.get(k)]).filter(Boolean));
    let nativeRows = {};
    try {
      nativeRows = NDESK.rowsOf(peopleListed, { t, audiences: opts.audiences, taken, rankFrom: Object.fromEntries(opts.audiences.map((a) => [a, Math.max(NATIVE_RANK_FROM, 1 + edited[a].rows.reduce((m, r) => Math.max(m, r.engineRank || 0), 0))])) });
    } catch (e) { log(`[native] no rows made: ${e.message}`); }
    const withNative = (a) => { try { return [...NDESK.attach(edited[a].rows, peopleListed, listedIndex, t), ...(nativeRows[a] || [])]; } catch (e) { log(`[native] ${a}: nothing attached: ${e.message}`); return edited[a].rows; } };
    const nativeByAudience = Object.fromEntries(opts.audiences.map((a) => [a, withNative(a)]));
    // the platform, word and craze sources (lib/platform-desk.js): a sound with its count, a format a roundup dates, a word a
    // dictionary defines, a thing shoppers call viral, an app or a game new to a chart, each a row of its kind after the engine's
    // own; and on the rows the list has for a person, the hourly reading of their page and the news titles that named them
    const ledgerP = platformLedger();
    const things = thingsOf(ledgerP);
    let platformRows = {};
    try {
      // (taken: what the list already holds as a word, a format or a sound, by its name without its kind word)
      const taken = new Set(Object.values(nativeByAudience).flat().filter((r) => r.type === 'word' || r.wordish).flatMap((r) => [keyOf(D.ownName(r.title)), keyOf(r.subject || '')]).filter(Boolean));
      const nextRank = (a) => 1 + nativeByAudience[a].reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
      platformRows = PDESK.rowsOf(things, { t, audiences: opts.audiences, taken, rankFrom: Object.fromEntries(opts.audiences.map((a) => [a, Math.max(NATIVE_RANK_FROM, nextRank(a))])) });
    } catch (e) { log(`[platform] no rows made: ${e.message}`); }
    const withPlatform = (a) => { try { return [...PDESK.attach(nativeByAudience[a], ledgerP, t), ...(platformRows[a] || [])]; } catch (e) { log(`[platform] ${a}: nothing added: ${e.message}`); return nativeByAudience[a]; } };
    // (word sense, P9 and B8, lib/sense: each word row's line is the dictionary sense people mean, a dossier line where none can be
    // shown, or a format's own recap. IDEAS_SENSE "off" stops it; should it fail, that audience's rows go on as they came)
    const sensed = Object.fromEntries(opts.audiences.map((a) => {
      const rows = withPlatform(a);
      if (!SENSE.on(env)) return [a, { rows, notes: [], counts: null }];
      try { return [a, SENSE.lineRows(rows, { typed: things.typed })]; } catch (e) { log(`[sense] ${a}: the lines stand: ${e.message}`); return [a, { rows, notes: [], counts: null }]; }
    }));
    const rowsByAudience = Object.fromEntries(opts.audiences.map((a) => [a, sensed[a].rows]));
    for (const n of sensed[opts.audiences.includes('US') ? 'US' : opts.audiences[0]].notes) log(`[sense] "${n.title}": ${n.did}`);
    for (const r of platformRows[opts.audiences.includes('US') ? 'US' : opts.audiences[0]] || []) log(`[platform] ${r.platform.sub} "${r.title}"${r.platform.status ? ` (${r.platform.status})` : ''}${r.platform.page ? ' [page]' : ''}: ${r.line}`);
    for (const r of nativeRows[opts.audiences.includes('US') ? 'US' : opts.audiences[0]] || []) log(`[native] "${r.title}": ${Object.keys(r.meta.native.kinds).join(' + ')} | ${r.line}`);
    const deskNotes = (edited[opts.audiences.includes('US') ? 'US' : opts.audiences[0]] || { notes: [] }).notes;
    for (const n of deskNotes.slice(0, 40)) log(`[desk] "${n.title}": ${n.did}`);
    // (every row folded by meaning, P8, past the forty too: what the stories changed is always in the cycle's own log)
    for (const n of deskNotes.slice(40).filter((x) => /\(by meaning\)$/.test(x.did || ''))) log(`[desk] "${n.title}": ${n.did}`);
    lap('build');

    // ---- steps 4-6: identity, this slot's samples, measured status ----
    const warm = !!db.prepare('SELECT 1 FROM fetches WHERE status = 200 AND t >= ? AND t < ? LIMIT 1').get(t - WARM_SECONDS, t);
    const newestWiki = fs.readdirSync(paths.wiki).filter((n) => /^wiki-(?:top|featured-feed)-\d{4}-\d\d-\d\d\.json$/.test(n)).map((n) => Date.parse(n.match(/(\d{4}-\d\d-\d\d)/)[1]) / 1000).sort().pop();
    obs.origins = ING.originsOf(store);
    const cycleState = H.step(db, { t, rowsByAudience, obs, warm, wikiFresh: Number.isFinite(newestWiki) && nowS - newestWiki <= 36 * HOUR + DAY, lifetimes: H.lifetimesOf(db, t),
      // (every timeline sentence is told by the desk's one function: lib/desk.js tellEvent)
      tell: (row, r) => DESK.tellEvent(row, r, built.lex) });
    for (const f of cycleState.failed || []) log(`[history] "${f.title}" left out of this cycle: ${f.error}`);
    lap('measure');

    // ---- step 6, lines (G): at most 6 model calls, 60 s in all; a line is shown as the model's only when the claim check passes it ----
    // (no calls offline or in a replay, unless a test hands the model's transport in; a line written before is still read from its cache)
    // (a replayed benchmark day may call one when EVAL_LLM=1, every reply kept on disk: lib/llm.js cachedCall, eval/README.md)
    const evalLlm = !!opts.replay && !opts.llmCall && LLM.evalOn(env);
    const llm = opts.offline || ((opts.replay || opts.transport) && !opts.llmCall && !evalLlm) ? null : LLM.configOf(env);
    if (llm && llm.keyIgnored) log(`[lines] IDEAS_LLM_API_KEY is set and ${llm.host} takes no key: it is not sent`);
    // (no model here and the enrich pass's cards named: cards only, P11. lib/editor/cards.js; the plan goes in the state, never out)
    let cardsOnly = null;
    if (!llm && opts.cards) { try { cardsOnly = XC.cardsOnlyConfig({ env, file: opts.cards, plan: path.join(opts.state, 'enrich', 'plan.json') }); } catch (e) { log(`[enrich] the cards did not read, none imported: ${e.message}`); } }
    // (the page laid out once each row's status and start are known: what is still going leads, what is fading follows. lib/desk.js `order`)
    // (a row whose "fading" is not said, a young story or one with a turn inside the last day and a half, is still going: the
    // page places it among what is, as its card words it. lib/measure.js heatWordSaid)
    const statusOf = (row) => { const c = cycleState.trends.get(row.id); return !c ? row.engineStatus : Object.values(c.early || {}).some(Boolean) ? 'rising' : c.plain && c.status === 'fading' ? 'peaking' : c.status; };
    // (how long a row has been going, for the page: from its start, or from its newest chapter. A second accuser, or the accused
    // answering, starts a story's week again, as it does for "still told": lib/measure.js. The benchmark row, thirteen days old with
    // a new chapter that morning, is this week's story and not "nobody's heads-up")
    const startedOf = (row) => {
      const c = cycleState.trends.get(row.id);
      if (!c || !Number.isFinite(c.next.startedAt)) return null;
      // (or from its newest turn: a headline of the story's own people that does not print its subject's name moves no badge and
      // alerts nobody, and is still the story going on. lib/desk.js withThread)
      return Math.max(c.next.startedAt, ...[c.next.chapterAt, c.turnAt].filter((x) => Number.isFinite(x) && x <= t));
    };
    // (what the measured series says of a row, for what sinks on the page (P5, lib/page-sink.js): its word where a rule of the
    // collector's own gave it and the card says it, an Early row's "rising"; the card's own start; its newest chapter or turn)
    const seriesOf = (row) => {
      const c = cycleState.trends.get(row.id);
      if (!c) return null;
      const turns = [c.next.chapterAt, c.turnAt].filter((x) => Number.isFinite(x) && x <= t);
      return { status: Object.values(c.early || {}).some(Boolean) ? 'rising' : c.statusOwn !== false ? c.status : null,
        startedAt: Number.isFinite(c.next.startedAt) ? c.next.startedAt : null, newsAt: turns.length ? Math.max(...turns) : null };
    };
    const orderOf = (a, rows) => { try { return DESK.order(rows, { statusOf, startedOf, seriesOf, sink: PSINK.on(env), now: t }); } catch (e) { log(`[desk] ${a}: order failed, the engine's order stands: ${e.message}`); return rows; } };
    // (the writer asks for the rows a reader meets first: the page as it will be laid out, not as the engine ranked it)
    const laidOut = Object.fromEntries(Object.entries(rowsByAudience).map(([a, rows]) => [a, orderOf(a, rows)]));
    let lined = { lines: new Map(), casing: new Map(), stats: { asked: 0, calls: 0, passed: 0, failedCheck: 0, unanswered: 0, shown: 0, headlinesChanged: 0, off: null } };
    try {
      lined = await LW.writeLines({ db, meta, t, rowsByAudience: laidOut, isEarly: (row) => { const c = cycleState.trends.get(row.id); return !!c && Object.values(c.early || {}).some(Boolean); },
        lex: built.lex, config: llm || cardsOnly, ...(opts.llmCall ? { call: opts.llmCall } : evalLlm ? { call: LLM.cachedCall(env) } : {}), ...(opts.llmWait ? { wait: opts.llmWait } : {}), log,
        // (what an editor's dossier is built from, lib/editor: the store's searches, the cycle's clock, the start the series measured)
        // (and this cycle's own timeline events, not yet saved: a line led by the row's newest entry reads them with the saved ones)
        store, nowMs, measured: (row) => { const c = cycleState.trends.get(row.id); return c ? { startedAt: c.next.startedAt, startedPrecision: c.next.startedPrecision, events: c.events || [] } : null; } });
    } catch (e) { log(`[lines] the writer failed, every line stays its headline: ${e.message}`); }
    for (const [id, w] of lined.lines) if (w.drop) log(`[lines] "${(Object.values(rowsByAudience).flat().find((r) => r.id === id) || {}).title || id}" left out: ${w.drop}`);
    // (and a card's why and angles on its row, for the detail: lib/editor/ideas.js, D4)
    const linedRows = Object.fromEntries(Object.entries(LW.applyLines(rowsByAudience, lined.lines, lined.casing, lined.ideas)).map(([a, rows]) => [a, orderOf(a, DESK.advise(DESK.respellLines(rows)))]));
    // (the enrich pass whose cards this cycle imported, for the ledger: counts and seconds only, never a row)
    const enrich = cardsOnly ? XC.enrichOf(cardsOnly.enrichHeader, lined.stats.editor, { nowS: clock(), seenRun: meta.get('enrichSeen', null) }) : null;
    if (enrich) log(`[enrich] cards of pass ${enrich.run ?? 'none'}${enrich.age !== undefined && enrich.age !== null ? ` (${enrich.age} min old)` : ''}: ${enrich.imported} imported, ${enrich.held} held already, ${enrich.stale} dropped for a story that moved; ${enrich.planned ?? '?'} rows planned for the next pass`);
    lap('lines');

    // ---- step 7: the feed, validated ----
    const coreRead = Object.keys(obs.trends).length > 0 && outcome.gnSent > 0 && outcome.gnOk * 2 >= outcome.gnSent;
    const sourcesAt = coreRead ? t : meta.get('sourcesAt', null) ?? (store.lastRefresh ? slotOf(store.lastRefresh) : null);
    const lags = meta.get('publishLags', []) || [];
    const lag = lags.length ? [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] : DEFAULT_LAG_SECONDS;
    const stale = [...hosts.entries()].filter(([, row]) => !B.hostOpen(row, clock())).map(([host]) => HOST_NAMES[host] || host).sort();
    const generatedAt = Math.max(clock(), t);
    // (related: Google Trends' related queries of each entry, for the sheet, D4: the store keeps them beside the entry, the engine's rows do not carry them)
    const related = (key) => { const tr = store.talkTrends && store.talkTrends.get(key); return tr && Array.isArray(tr.related) ? tr.related : []; };
    const feeds = FEED.build({ t, generatedAt, cycle: cycleState, rowsByAudience: linedRows, roster: inputs.roster, db, sourcesAt, nextExpectedAt: t + SLOT_SECONDS + lag, stale, related });
    lap('feed');
    const good = opts.audiences.filter((a) => feeds.lists[a] && !feeds.problems[a].length);
    for (const a of opts.audiences) {
      if (feeds.lists[a] && feeds.problems[a].length) log(`[feed] ${a}: not published: ${feeds.problems[a].slice(0, 4).join('; ')}`);
      for (const d of (feeds.dropped[a] || []).slice(0, 5)) log(`[feed] ${a}: row left out "${d.title}": ${d.problems[0]}`);
    }
    // (what page one carries of what sinks, P5: counts alone, never a row's name or times)
    for (const a of good) { const p = PSINK.pageTally(feeds.lists[a]); log(`[desk] ${a} page one: ${p.fading} Fading (${p.fadingMeasured} measured), ${p.old} over ${PSINK.OLD_DAYS} days old and not rising, of ${p.rows}`); }

    // ---- step 5 (written once the ranks are final): history, in one transaction ----
    // (fenced: the lock is still this run's and nothing newer was published while it worked. A cycle that slept through its turn,
    // or had its lock taken, writes nothing and publishes nothing: A3)
    const fenced = () => {
      if (!STATE.holdsLock(opts.state, nowS)) return 'the lock is no longer this run’s';
      const lp = meta.get('lastPublish', null);
      return lp && Number.isFinite(lp.t) && lp.t > t ? `slot ${instant(lp.t)} was published while this one ran` : null;
    };
    try {
      H.commit(db, cycleState, feeds.published, { guard: () => { const why = fenced(); if (why) { const e = new Error(why); e.fenced = true; throw e; } } });
    } catch (e) {
      if (!e.fenced) throw e;
      log(`[collect] ${e.message}: nothing written, nothing published`);
      return { code: 2, summary: null };
    }
    Q.sync(db, Object.values(OWED.owedRequests(built.owed)).flat().concat((built.owed.recent || []).filter((n) => {
      const l = store.lookups.get(`talk-${TS.talkKey(n)}`);
      return !(l && l.tprecentAt && nowMs - l.tprecentAt < 20 * HOUR * 1000);
    }).slice(0, 9).map(NAMES.recentRequest)), nowS);
    // the origin searches the next cycles owe: the listed rows first, by rank
    const rankOf = (c) => Math.min(999, ...Object.values((feeds.published.get(c.id) || { ranks: {} }).ranks).filter(Number.isFinite));
    meta.set('originsWanted', [...cycleState.trends.values()].filter((c) => c.originOwed).sort((a, b) => rankOf(a) - rankOf(b)).slice(0, ORIGINS_WANTED_KEPT).map((c) => c.originOwed));
    // what the next cycle's tier 1 reads: the rows as published, each with the name its searches are stored under
    const us = feeds.lists[good.includes('US') ? 'US' : good[0]] || { items: [] };
    // what GDELT name discovery did this cycle, for the ledger: counts only, never a name (P13; lib/discover.js). since: the slot it was
    // first on (this switch-on): P13's 7 days before and after are read from there
    const gdeltSince = gdeltOn ? (meta.get('gdeltOnSince', null) ?? t) : null;
    meta.set('gdeltOnSince', gdeltSince);
    const gdeltOut = (() => {
      const s = gdeltCycle && gdeltCycle.stats;
      let tally = { minted: 0, boosted: 0, page: 0 };
      try {
        if (s && gdeltOn) tally = DISC.gdeltTally(us.items, { nameOf: (id) => { const c = cycleState.trends.get(id); return c && c.info ? c.info.name : null; },
          mintedIds: new Set(cycleState.minted.map((m) => m.id)), keys: gdeltCycle.keys, state: gdeltCycle.state, slot: t });
      } catch (e) { log(`[gdelt] the rows were not counted: ${e.message}`); }
      return { on: gdeltOn, since: Number.isFinite(gdeltSince) ? instant(gdeltSince) : null, read: !!s, seen: s ? s.seen : 0, passed: s ? s.passed : 0, fresh: s ? s.fresh : 0,
        searched: s ? gdeltCycle.searched || 0 : 0, minted: tally.minted, boosted: tally.boosted, page: tally.page, baseHours: s ? Math.floor(s.baseSlots / 4) : 0, weekly: !!(s && s.weekly) };
    })();
    if (gdeltOut.read) log(`[gdelt] ${gdeltOut.on ? 'on' : 'off (counting only)'}: ${gdeltOut.seen} names in the slot, ${gdeltOut.passed} breaking out (${gdeltOut.baseHours} h of baseline${gdeltOut.weekly ? ', last week\'s slot in it' : ''}), ${gdeltOut.searched} of ${gdeltOut.fresh} searched; ${gdeltOut.minted} rows minted, ${gdeltOut.boosted} boosted, ${gdeltOut.page} on page one`);
    // (person: the row is about someone, which is what Bing News is asked a second opinion on. L8)
    meta.set('lastRows', us.items.map((it) => { const c = cycleState.trends.get(it.id); return { name: c && c.info.name, rank: it.rank, rising: it.status === 'rising', early: it.isEarly,
      accelerating: !!(c && c.measure.a > 0 && c.measure.v > 0), person: it.people.length > 0 }; }).filter((r) => r.name));

    // whose pages and whose press the next cycle's hourly file and GDELT slot are read for: the people the lists hold, by rank (M4, M5)
    try {
      const named = new Map();
      for (const r of Object.values(rowsByAudience).flat().filter((x) => x.type === 'point' && !x.wordish && x.meta && x.meta.person && x.surface).sort((a, b) => a.engineRank - b.engineRank)) {
        const key = keyOf(r.surface);
        if (key.split(' ').length >= 2 && !named.has(key)) named.set(key, { key, title: WIKIH.titleOf(r.surface.charAt(0).toUpperCase() + r.surface.slice(1)) });
      }
      meta.set('platformNames', [...named.values()].slice(0, PLATFORM_NAMES_KEPT));
    } catch (e) { log(`[platform] the list's names were not kept: ${e.message}`); }
    // the hashtags TikTok's adapter reads next, when it is on: the list's words, sounds and formats by rank
    if (TIKTOK.tiktokOn(env)) meta.set('tiktokTags', [...new Set(us.items.filter((it) => it.kind === 'word' || it.kind === 'sound').map((it) => TIKTOK.tagOf(it.title)).filter(Boolean))].slice(0, TIKTOK_TAGS_KEPT));
    if (!good.length) {
      log('[collect] no list passed as a whole: nothing published');
      meta.set('cycle', cycle);
      return { code: 1, summary: null };
    }

    // ---- step 8: publish; step 9: archive, compact, prune ----
    const counts = { trends: cycleState.trends.size, minted: cycleState.minted.length, carried: cycleState.carried.length,
      measured: [...cycleState.trends.values()].filter((c) => c.statusMeasured).length,
      early: Object.fromEntries(good.map((a) => [a, feeds.lists[a].items.filter((x) => x.isEarly).length])),
      startedUnknown: Object.fromEntries(good.map((a) => [a, feeds.lists[a].items.filter((x) => x.startedAt === null).length])),
      originsOwed: (meta.get('originsWanted', []) || []).length,
      // (the creator-native lists as read this cycle: clips on the charts and how many of them tell something, X's lists in hand)
      clips: obs.clips.length, clipsTelling: CLIPS.clipRows(obs.clips, obs.roster).length, xLists: Object.keys(obs.x.lists).length, tiktokTags: obs.tiktok.size,
      // (the creator-native sources, L: people with a signal, how many of them two kinds agree on, the rows made of them, the engine's
      // rows they are attached to, what was new by observation this cycle, and who was sent for a search)
      native: { people: [...peopleListed.values()].filter((p) => Object.keys(p.kinds).length).length, corroborated: [...peopleListed.values()].filter((p) => NDESK.corroborated(p.kinds, t)).length,
        rows: (nativeRows[opts.audiences.includes('US') ? 'US' : opts.audiences[0]] || []).map((r) => r.title), attached: [...new Set(Object.values(rowsByAudience).flat().filter((r) => !r.native && r.meta && r.meta.native).map((r) => r.title))],
        // (who was sent for a search is a count here: status.json is published, and a bare name there would say nothing true of anyone)
        fresh: nativeStats.fresh, research: nativeStats.research.length },
      // (the platform, word and craze sources, M: the rows made of them by kind, what the ledger holds, what was new by observation,
      // this cycle's hourly file and GDELT slot)
      platform: (() => { const made = platformRows[opts.audiences.includes('US') ? 'US' : opts.audiences[0]] || [];
        return { rows: Object.fromEntries([...new Set(made.map((r) => r.platform.sub))].map((sub) => [sub, made.filter((r) => r.platform.sub === sub).map((r) => r.title)])),
          measured: made.filter((r) => r.platform.status).map((r) => r.title), sounds: things.sounds.size, formats: things.formats.length, words: things.words.length, apps: things.apps.length, games: things.games.length,
          fresh: platformStats.fresh, wiki: platformStats.wiki, gdelt: obs.gdelt }; })(),
      rowsLeftOut: Object.fromEntries(opts.audiences.map((a) => [a, (feeds.dropped[a] || []).length])),
      // (this cycle began with no state and read its history back from the feed already out: how much. N)
      ...(reseeded ? { reseeded: { trends: reseeded.trends, from: instant(reseeded.from) } } : {}),
      // (the line writer this cycle: calls made, lines the check passed and refused, headline lines the no-model path bettered. G)
      lines: { model: llm ? llm.model : cardsOnly ? cardsOnly.model : null, ...lined.stats } };
    // model lines on the lists as published: distinct trends, whichever audience lists them
    const modelLines = new Set(good.flatMap((a) => feeds.lists[a].items.filter((x) => x.lineWrittenBy === 'model').map((x) => x.id))).size;
    const status = { schemaVersion: FEED.SCHEMA_VERSION, generatedAt: instant(generatedAt), cycle, slot: instant(t), sourcesAt: Number.isFinite(sourcesAt) ? instant(sourcesAt) : null,
      requests: { sent: outcome.sent, answered: outcome.ok, byHost: Object.fromEntries(Object.entries(outcome.byHost).map(([h, n]) => [HOST_NAMES[h] || h, n])) },
      sources: Object.fromEntries([...hosts.entries()].map(([host, row]) => [HOST_NAMES[host] || host, { lastStatus: row.last_status ?? null, lastOkAt: Number.isFinite(row.last_ok_at) ? instant(row.last_ok_at) : null,
        blockedUntil: Number.isFinite(row.blocked_until) && row.blocked_until > nowS ? instant(row.blocked_until) : null, strikes: row.strikes || 0 }])),
      lists: Object.fromEntries(good.map((a) => [a, feeds.lists[a].items.length])), counts, modelLines };
    // names.json (D6): everyone listed in the last 14 days and the creators' roster, refreshed once a day
    const listed = NM.listedAfter(meta.get('namesListed', {}), Object.fromEntries(good.map((a) => [a, feeds.lists[a]])), t);
    meta.set('namesListed', listed);
    const today = localDay(t, 'UTC');
    let names = meta.get('namesDay') !== today || !fs.existsSync(path.join(opts.out, 'v1', 'names.json')) ? NM.namesFile({ listed, roster: inputs.roster, generatedAt, schemaVersion: FEED.SCHEMA_VERSION }) : null;
    if (names) {
      const bad = V.validateNames(names, { bytes: Buffer.byteLength(JSON.stringify(names)) });
      if (bad.length) { log(`[feed] names.json not written: ${bad[0]}`); names = null; }
    }
    // (the slot against a clock that can be trusted: the Date header of this cycle's own replies. A machine whose clock is out by
    // more than a slot publishes nothing: lists dated ahead would hold every later cycle back)
    const skew = skews.length >= CLOCK_SAMPLES_MIN ? [...skews].sort((a, b) => a - b)[Math.floor(skews.length / 2)] : null;
    if (!pinned && real && skew !== null && Math.abs(skew) > CLOCK_SKEW_MAX_SECONDS) {
      log(`[collect] this machine's clock is ${Math.round(-skew)} s off the servers' own: nothing published`);
      meta.set('cycle', cycle);
      return { code: 3, summary: null };
    }
    const lost = fenced();
    if (lost) { log(`[collect] ${lost}: nothing published`); return { code: 2, summary: null }; }
    const written = PUB.publish(opts.out, { cycle, feeds, audiences: good, status, names });
    if (names) meta.set('namesDay', today);
    if (enrich && enrich.run !== null) meta.set('enrichSeen', enrich.run);
    // (by what the state knows: every trend seen inside the last 48 hours keeps its detail, any other file goes)
    PUB.pruneDetails(opts.out, Date.now() / 1000, { keep: new Set([...db.prepare('SELECT id FROM trends WHERE last_seen >= ?').all(t - PUB.DETAIL_KEPT_SECONDS).map((r) => r.id), ...feeds.details.keys()]) });
    PUB.archive(paths.archive, Object.fromEntries(good.map((a) => [a, feeds.lists[a]])), t);
    if (coreRead) meta.set('sourcesAt', t);
    meta.set('publishLags', [...lags, Math.max(0, clock() - t)].slice(-LAG_KEPT));
    meta.set('lastPublish', { cycle, t, at: Math.floor(Date.now() / 1000), ...(pinned ? { pinned: true } : {}) });
    const hour = Math.floor(t / HOUR);
    if (meta.get('compactedHour', 0) < hour) { const folded = H.compact(db, t); meta.set('compactedHour', hour); if (folded) log(`[history] compacted ${folded} samples`); }
    H.prune(db, t);
    try { LEDGER.prune(db, t); } catch (e) { log(`[native] the ledger was not pruned: ${e.message}`); }
    try { PL.prune(db, t); } catch (e) { log(`[platform] the ledger was not pruned: ${e.message}`); }
    for (const name of fs.readdirSync(paths.raw)) { const file = path.join(paths.raw, name); if (Date.now() / 1000 - fs.statSync(file).mtimeMs / 1000 > RAW_KEPT_SECONDS) fs.rmSync(file, { force: true }); }
    for (const name of fs.readdirSync(paths.wiki)) {
      const day = (name.match(/^wiki-(?:top|featured-feed)-(\d{4}-\d\d-\d\d)\.json$/) || [])[1];
      if (day && nowS - Date.parse(day) / 1000 > (OWED.WIKI_DAYS + 3) * DAY) fs.rmSync(path.join(paths.wiki, name), { force: true });
    }
    STATE.backupDaily(state, localDay(t, 'UTC'));
    meta.set('cycle', cycle);
    lap('publish');
    // (the editor model's own time is inside the lines step: told apart, so the steps add up to the cycle and the cycle less the editor
    // reads straight off the summary, which the host's ledger copies. Seconds only)
    const editorS = Math.round((lined.stats.editor && Number.isFinite(lined.stats.editor.ms) ? lined.stats.editor.ms : 0) / 100) / 10;
    const seconds = { fetch: timing.fetch, build: timing.build, measure: timing.measure, lines: Math.max(0, Math.round((timing.lines - editorS) * 10) / 10), editor: editorS, feed: timing.feed, publish: timing.publish };
    log(`[time] fetch ${seconds.fetch}s, build ${seconds.build}s, identity + history ${seconds.measure}s, lines ${seconds.lines}s, editor ${seconds.editor}s, feed ${seconds.feed}s, write + publish ${seconds.publish}s`);
    const summary = { cycle, slot: instant(t), requests: outcome.sent, blocked: stale, items: Object.fromEntries(good.map((a) => [a, feeds.lists[a].items.length])), modelLines, ms: Date.now() - started,
      answered: outcome.ok, seconds, byHost: status.requests.byHost, bytes: Object.fromEntries(good.map((a) => [a, written.bytes[`${PUB.fileOf(a)}.json`]])), counts, ...(enrich ? { enrich } : {}),
      ...(storiesOut ? { stories: storiesOut } : {}), gdelt: gdeltOut };
    return { code: 0, summary };
  } finally {
    if (state) state.close();
    STATE.releaseLock(opts.state);
  }
}

module.exports = { runCycle, parseArgs, replayTransport, engineInputs, beatNames, NATIVE_SOURCES, PLATFORM_SOURCES };

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { log(e.message); process.exit(1); }
  if (opts.checkState) {
    const h = STATE.health(opts.state);
    process.stdout.write(`${JSON.stringify(h)}\n`, () => process.exit(h.ok ? 0 : 4));
    return;
  }
  runCycle(opts).then(({ code, summary }) => {
    // (the line is flushed before the process ends: stdout may be a pipe, and a pipe is written behind the call)
    if (summary) process.stdout.write(`${JSON.stringify(summary)}\n`, () => process.exit(code));
    else process.exit(code);
  // (an error nobody foresaw is not "nothing new": 3, so the host's job fails and shows the log. A row that makes a step throw
  // stays in the store for days, and with 1 every one of those runs was green)
  }).catch((e) => { log(e.stack || String(e)); process.exit(3); });
}
