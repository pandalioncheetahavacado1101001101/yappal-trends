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
 * finds the lock and exits 2. Exit 0: a feed was published; 1: nothing new was published (the feed already out is untouched).
 * stdout: one JSON line { cycle, slot, requests, blocked, items, modelLines, ms }; everything else goes to stderr.
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
const M = require('./lib/measure');
const NM = require('./lib/names');
const LLM = require('./lib/llm');
const LW = require('./lib/line-writer');
const HY = require('./lib/hygiene');
const DESK = require('./lib/desk');
const V = require('./samples/validate.cjs');
const { AUDIENCES, slotOf, instant, HOUR, DAY, SLOT_SECONDS, localDay } = require('./lib/util');

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
  'gql.twitch.tv': 'twitch', 'kick.com': 'kick', 'trends24.in': 'x-trends24', 'www.tiktok.com': 'tiktok-web' };
const X_NAMES_PER_CYCLE = 2;
const THREAD_BACK_MS = 72 * 3600e3;
const TIKTOK_TAGS_KEPT = 40;

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
    else if (flag === '--audiences') out.audiences = value().split(',').map((x) => x.trim()).filter((x) => AUDIENCES.includes(x));
    else if (flag === '--max-requests') out.maxRequests = Math.max(0, Number(value()) || 0);
    else if (flag === '--deadline-seconds') out.deadlineSeconds = Math.max(30, Number(value()) || 420);
    else if (flag === '--record') out.record = value();
    else if (flag === '--replay') out.replay = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.state || !out.out) throw new Error('usage: node collect.js --state <dir> --out <dir> [--now=ISO] [--offline] [--audiences=US,GB,AU,CA,mixed] [--max-requests=80] [--deadline-seconds=420]');
  if (out.now !== undefined && !Number.isFinite(out.now)) throw new Error('--now must be an ISO instant');
  if (!out.audiences.length) throw new Error('--audiences names none of US, GB, AU, CA, mixed');
  return out;
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
    state = STATE.openState(opts.state);
    const { db, paths, meta } = state;
    const cycle = (meta.get('cycle', 0) || 0) + 1;
    // never backwards: a slot before the last one published (a clock set back, a stray --now on the live state) would write over newer
    // samples and put an older list out. The same slot again is fine (A3)
    const lastPublish = meta.get('lastPublish', null);
    if (lastPublish && Number.isFinite(lastPublish.t) && t < lastPublish.t) {
      log(`[collect] slot ${instant(t)} is before the last published slot ${instant(lastPublish.t)}: nothing done, the feed already out stays`);
      return { code: 1, summary: null };
    }
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
    const hosts = new Map(db.prepare('SELECT * FROM hosts').all().map((r) => [r.host, { ...r }]));
    const off = new Set((env.IDEAS_SOURCES_OFF || '').split(',').map((x) => x.trim()).filter(Boolean));
    const budget = B.createBudget({ cap: opts.offline ? 0 : opts.maxRequests, hosts, now: nowS, off });
    const transport = opts.offline ? null : opts.transport || (opts.replay ? replayTransport(opts.replay, t) : F.netTransport(env));
    const fetchDeadline = started + Math.min(B.FETCH_DEADLINE_SECONDS, opts.deadlineSeconds) * 1000;
    const recorded = {};
    const lastRead = new Map(Object.entries(meta.get('lastRead', {}) || {}));
    const outcome = { sent: 0, ok: 0, gnSent: 0, gnOk: 0, byHost: {} };
    const putFetch = db.prepare('INSERT OR REPLACE INTO fetches (cycle, source, host, t, status, bytes, ms) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const putHost = db.prepare('INSERT OR REPLACE INTO hosts (host, blocked_until, strikes, last_ok_at, last_status, first_turned_away_at, timeouts, last_request_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

    /** Sends a round, saves and reads every reply in the order asked, and books what happened. */
    const round = async (requests) => {
      if (!transport || !requests.length) return [];
      const results = await F.send(requests, { budget, hosts, clock, deadlineMs: fetchDeadline, transport, ...(opts.replay || opts.transport ? { gap: () => 0 } : {}) });
      for (const r of results) {
        const { request } = r;
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
      for (const [host, row] of hosts) putHost.run(host, row.blocked_until ?? null, row.strikes || 0, row.last_ok_at ?? null, row.last_status ?? null, row.first_turned_away_at ?? null, row.timeouts || 0, row.last_request_at ?? null);
      return results;
    };

    // ---- step 2: fetch (tier 0, then the names that need a look now, the rotation, and what is owed) ----
    if (transport) {
      // (the clip charts are tier 0 too: what stands in for the streamer boards where Reddit turns the host away. A4)
      await round([...FIXED.tier0({ rssTrends: !B.hostOpen(hosts.get('trends.google.com'), nowS) }), CLIPS.twitchRequest(env), CLIPS.kickRequest()]);
      const inputs0 = engineInputs(paths.wiki, nowMs);
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
      // the origin searches owed (C4): a listed story whose start sits where its week's search began to look; each asked once
      const origins = (meta.get('originsWanted', []) || []).map((w) => NAMES.originRequest(w.name, w.edge))
        .filter((r) => !(lastRead.has(r.id) && t - lastRead.get(r.id) < ORIGIN_ASK_AGAIN_SECONDS)).slice(0, B.ORIGINS_PER_CYCLE);
      const second = [
        ...(trendNews ? [trendNews] : []),
        ...picked.now.flatMap((key) => NAMES.nameRequests(nameOf(key), 1)),
        // (a listed row with no start is a gap to close: its origin search goes before the feeds in rotation. C4)
        ...origins,
        ...rotation.slice(0, B.ROTATION_PER_CYCLE + 4),
        // (X's trends: one country's page a cycle, the one read longest ago, so each about hourly)
        SOCIAL.xRequest(SOCIAL.xTurn(lastRead)),
        OWED.redditRequest(B.redditTurn(cycle)),
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
        ...tiktok,
      ];
      await round(second);
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
      const games = obs.games ? DISC.gameMoves(meta.get('twitchGames', null), obs.games, t) : null;
      if (games) meta.set('twitchGames', games.state);
      const shown = [...SOCIAL.newCreators(obs.x, inputs0.roster, t).slice(0, X_NAMES_PER_CYCLE), ...(games ? games.fresh.map((g) => g.name) : [])].filter((name) => !lately(name) && !picked.now.includes(TS.talkKey(name)));
      if (shown.length) log(`[discover] ${shown.join(', ')}`);
      const wantedNow = [...new Set([...flared, ...shown])];
      if (wantedNow.length) await round(wantedNow.flatMap((name) => NAMES.nameRequests(name, 1)).filter((r) => r.kind === 'name-news'));
      meta.set('rosterWatch', { cursor: watch.cursor, carried });
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
    let built;
    try {
      built = ENGINE.build({ store, ...inputs, now: nowMs, audiences: opts.audiences });
    } catch (e) {
      log(`[collect] the engine failed, the feed already out stays: ${e.stack || e.message}`);
      meta.set('cycle', cycle);
      return { code: 1, summary: null };
    }
    // the desk (lib/desk.js): an editor's pass over the engine's rows, before they are matched to trends and measured
    const recent = [...store.rows.values()].filter((r) => (r.fam === 'gnews' || r.fam === 'celeb') && Number.isFinite(r.t) && nowMs - r.t < THREAD_BACK_MS && r.t <= nowMs)
      .map((r) => ({ t: r.t, title: r.title, outlet: r.publisher || r.label || null }));
    const isBeat = (outlet) => TC.CREATOR_PRESS.test(outlet) || TN.MAJOR.test(outlet);
    // (the desk never holds a list back: should it fail on a row nobody foresaw, that audience's rows go out as the engine made them)
    const deskOf = (a) => { const rows = ROWS.rowsOf(a, built.byAudience[a], built); try { return DESK.edit(rows, { recent, now: nowMs, isBeat }); } catch (e) { log(`[desk] ${a}: failed, the engine's rows stand: ${e.message}`); return { rows, notes: [] }; } };
    const edited = Object.fromEntries(opts.audiences.map((a) => [a, deskOf(a)]));
    const rowsByAudience = Object.fromEntries(opts.audiences.map((a) => [a, edited[a].rows]));
    const deskNotes = (edited[opts.audiences.includes('US') ? 'US' : opts.audiences[0]] || { notes: [] }).notes;
    for (const n of deskNotes.slice(0, 40)) log(`[desk] "${n.title}": ${n.did}`);
    lap('build');

    // ---- steps 4-6: identity, this slot's samples, measured status ----
    const warm = !!db.prepare('SELECT 1 FROM fetches WHERE status = 200 AND t >= ? AND t < ? LIMIT 1').get(t - WARM_SECONDS, t);
    const newestWiki = fs.readdirSync(paths.wiki).filter((n) => /^wiki-(?:top|featured-feed)-\d{4}-\d\d-\d\d\.json$/.test(n)).map((n) => Date.parse(n.match(/(\d{4}-\d\d-\d\d)/)[1]) / 1000).sort().pop();
    obs.origins = ING.originsOf(store);
    const cycleState = H.step(db, { t, rowsByAudience, obs, warm, wikiFresh: Number.isFinite(newestWiki) && nowS - newestWiki <= 36 * HOUR + DAY, lifetimes: H.lifetimesOf(db, t) });
    lap('measure');

    // ---- step 6, lines (G): at most 6 model calls, 60 s in all; a line is shown as the model's only when the claim check passes it ----
    // (no calls offline or in a replay, unless a test hands the model's transport in; a line written before is still read from its cache)
    const llm = opts.offline || ((opts.replay || opts.transport) && !opts.llmCall) ? null : LLM.configOf(env);
    // (the page laid out once each row's status and start are known: what is still going leads, what is fading follows. lib/desk.js `order`)
    const statusOf = (row) => { const c = cycleState.trends.get(row.id); return !c ? row.engineStatus : Object.values(c.early || {}).some(Boolean) ? 'rising' : c.status; };
    const startedOf = (row) => { const c = cycleState.trends.get(row.id); return c && Number.isFinite(c.next.startedAt) ? c.next.startedAt : null; };
    const orderOf = (a, rows) => { try { return DESK.order(rows, { statusOf, startedOf, now: t }); } catch (e) { log(`[desk] ${a}: order failed, the engine's order stands: ${e.message}`); return rows; } };
    // (the writer asks for the rows a reader meets first: the page as it will be laid out, not as the engine ranked it)
    const laidOut = Object.fromEntries(Object.entries(rowsByAudience).map(([a, rows]) => [a, orderOf(a, rows)]));
    let lined = { lines: new Map(), stats: { asked: 0, calls: 0, passed: 0, failedCheck: 0, unanswered: 0, shown: 0, headlinesChanged: 0, off: null } };
    try {
      lined = await LW.writeLines({ db, meta, t, rowsByAudience: laidOut, isEarly: (row) => { const c = cycleState.trends.get(row.id); return !!c && Object.values(c.early || {}).some(Boolean); },
        lex: built.lex, config: llm, ...(opts.llmCall ? { call: opts.llmCall } : {}), ...(opts.llmWait ? { wait: opts.llmWait } : {}), log });
    } catch (e) { log(`[lines] the writer failed, every line stays its headline: ${e.message}`); }
    const linedRows = Object.fromEntries(Object.entries(LW.applyLines(rowsByAudience, lined.lines)).map(([a, rows]) => [a, orderOf(a, DESK.respellLines(rows))]));
    lap('lines');

    // ---- step 7: the feed, validated ----
    const coreRead = Object.keys(obs.trends).length > 0 && outcome.gnSent > 0 && outcome.gnOk * 2 >= outcome.gnSent;
    const sourcesAt = coreRead ? t : meta.get('sourcesAt', null) ?? (store.lastRefresh ? slotOf(store.lastRefresh) : null);
    const lags = meta.get('publishLags', []) || [];
    const lag = lags.length ? [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)] : DEFAULT_LAG_SECONDS;
    const stale = [...hosts.entries()].filter(([, row]) => !B.hostOpen(row, clock())).map(([host]) => HOST_NAMES[host] || host).sort();
    const generatedAt = Math.max(clock(), t);
    const feeds = FEED.build({ t, generatedAt, cycle: cycleState, rowsByAudience: linedRows, roster: inputs.roster, db, sourcesAt, nextExpectedAt: t + SLOT_SECONDS + lag, stale });
    lap('feed');
    const good = opts.audiences.filter((a) => feeds.lists[a] && !feeds.problems[a].length);
    for (const a of opts.audiences) {
      if (feeds.lists[a] && feeds.problems[a].length) log(`[feed] ${a}: not published: ${feeds.problems[a].slice(0, 4).join('; ')}`);
      for (const d of (feeds.dropped[a] || []).slice(0, 5)) log(`[feed] ${a}: row left out "${d.title}": ${d.problems[0]}`);
    }

    // ---- step 5 (written once the ranks are final): history, in one transaction ----
    H.commit(db, cycleState, feeds.published);
    Q.sync(db, Object.values(OWED.owedRequests(built.owed)).flat().concat((built.owed.recent || []).filter((n) => {
      const l = store.lookups.get(`talk-${TS.talkKey(n)}`);
      return !(l && l.tprecentAt && nowMs - l.tprecentAt < 20 * HOUR * 1000);
    }).slice(0, 9).map(NAMES.recentRequest)), nowS);
    // the origin searches the next cycles owe: the listed rows first, by rank
    const rankOf = (c) => Math.min(999, ...Object.values((feeds.published.get(c.id) || { ranks: {} }).ranks).filter(Number.isFinite));
    meta.set('originsWanted', [...cycleState.trends.values()].filter((c) => c.originOwed).sort((a, b) => rankOf(a) - rankOf(b)).slice(0, ORIGINS_WANTED_KEPT).map((c) => c.originOwed));
    // what the next cycle's tier 1 reads: the rows as published, each with the name its searches are stored under
    const us = feeds.lists[good.includes('US') ? 'US' : good[0]] || { items: [] };
    meta.set('lastRows', us.items.map((it) => { const c = cycleState.trends.get(it.id); return { name: c && c.info.name, rank: it.rank, rising: it.status === 'rising', early: it.isEarly,
      accelerating: !!(c && c.measure.a > 0 && c.measure.v > 0) }; }).filter((r) => r.name));

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
      rowsLeftOut: Object.fromEntries(opts.audiences.map((a) => [a, (feeds.dropped[a] || []).length])),
      // (the line writer this cycle: calls made, lines the check passed and refused, headline lines the no-model path bettered. G)
      lines: { model: llm ? llm.model : null, ...lined.stats } };
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
    const written = PUB.publish(opts.out, { cycle, feeds, audiences: good, status, names });
    if (names) meta.set('namesDay', today);
    PUB.pruneDetails(opts.out);
    PUB.archive(paths.archive, Object.fromEntries(good.map((a) => [a, feeds.lists[a]])), t);
    if (coreRead) meta.set('sourcesAt', t);
    meta.set('publishLags', [...lags, Math.max(0, clock() - t)].slice(-LAG_KEPT));
    meta.set('lastPublish', { cycle, t, at: clock() });
    const hour = Math.floor(t / HOUR);
    if (meta.get('compactedHour', 0) < hour) { const folded = H.compact(db, t); meta.set('compactedHour', hour); if (folded) log(`[history] compacted ${folded} samples`); }
    H.prune(db, t);
    for (const name of fs.readdirSync(paths.raw)) { const file = path.join(paths.raw, name); if (Date.now() / 1000 - fs.statSync(file).mtimeMs / 1000 > RAW_KEPT_SECONDS) fs.rmSync(file, { force: true }); }
    for (const name of fs.readdirSync(paths.wiki)) {
      const day = (name.match(/^wiki-(?:top|featured-feed)-(\d{4}-\d\d-\d\d)\.json$/) || [])[1];
      if (day && nowS - Date.parse(day) / 1000 > (OWED.WIKI_DAYS + 3) * DAY) fs.rmSync(path.join(paths.wiki, name), { force: true });
    }
    STATE.backupDaily(state, localDay(t, 'UTC'));
    meta.set('cycle', cycle);
    lap('publish');
    log(`[time] fetch ${timing.fetch}s, build ${timing.build}s, identity + history ${timing.measure}s, lines ${timing.lines}s, feed ${timing.feed}s, write + publish ${timing.publish}s`);
    const summary = { cycle, slot: instant(t), requests: outcome.sent, blocked: stale, items: Object.fromEntries(good.map((a) => [a, feeds.lists[a].items.length])), modelLines, ms: Date.now() - started,
      answered: outcome.ok, seconds: timing, byHost: status.requests.byHost, bytes: Object.fromEntries(good.map((a) => [a, written.bytes[`${PUB.fileOf(a)}.json`]])), counts };
    return { code: 0, summary };
  } finally {
    if (state) state.close();
    STATE.releaseLock(opts.state);
  }
}

module.exports = { runCycle, parseArgs, replayTransport, engineInputs, beatNames };

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { log(e.message); process.exit(1); }
  runCycle(opts).then(({ code, summary }) => {
    // (the line is flushed before the process ends: stdout may be a pipe, and a pipe is written behind the call)
    if (summary) process.stdout.write(`${JSON.stringify(summary)}\n`, () => process.exit(code));
    else process.exit(code);
  }).catch((e) => { log(e.stack || String(e)); process.exit(1); });
}
