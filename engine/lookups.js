'use strict';
/*
 * "Words & trends" lookups, step 3 of words.js: per-term answers fetched after the feeds, kept in the store's lookups and saved
 * raw so a cached rebuild replays them.
 *   Wikipedia   one Action API batch per 20 terms: the summary of a page named exactly like the term and its 30 daily views
 *   Wiktionary  a coinage's senses (a handful a refresh: it throttles unregistered apps)
 *   origin      one open-ended Google News RSS search per strong term: how far back headlines naming it go (kept a month)
 *   KYM page    a Know Your Meme entry page's About section for a term no source defines (7 exact + 3 guessed a day, kept a month)
 *   KYM roundup Know Your Meme's weekly roundup page, read once: every pick's name and exact entry page
 *   story       per listed moment (story-lookups.js): a Google News search for the story's main name over 14 days (25 a refresh,
 *               kept 20 hours) and a Wikipedia search (8 a refresh, 3 s apart, kept 3 days)
 * One request at a time, spaced out. Every fetch is keyless and identified by its User-Agent.
 */
const fs = require('fs');
const path = require('path');
const S = require('./sources');
const ST = require('./store');
const WD = require('./words');
const X = require('./words-extract');
const STY = require('./story-lookups');

const LOOKUP_GAP_MS = 800;
const WIKT_MAX = 8; // Wiktionary throttles an app without a registered contact after a handful of requests; the rest wait a day
const SINCE_GAP_MS = 1000; // open-ended Google News searches, one at a time
const KYM_GAP_MS = 2500; // Know Your Meme entry pages: a handful a day, well spaced
const STORY_WIKI_GAP_MS = 3000; // Wikipedia searches for the listed stories: Wikimedia answered 429 after ten at 0.8-2 s

const readText = (p) => fs.readFileSync(p, 'utf8');
const liveDirOf = (rawDir, now) => {
  const dir = path.join(rawDir, 'live-' + S.ymdLocal(now));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
// a log per run, named by the wall clock: two runs on one saved store share "now" and must not overwrite each other
const logName = (part) => `lookups-${Date.now()}-${part}.json`;

function applyWikiBatch(store, replies, pairs, at) {
  for (const [key, v] of WD.parseWikiBatch(replies, pairs)) {
    ST.upsertLookup(store, key, 'summary', v.summary, at);
    if (v.views) ST.upsertLookup(store, key, 'views', v.views, at);
  }
}

/**
 * One run's Know Your Meme fetches -> the store's lookups: entry pages ({ key, part: 'kym', term, slug, known, status, file } per
 * request) and weekly roundup pages ({ key, part: 'roundup', slug, status, file }).
 */
function applyLookupLog(store, entries, read, at) {
  const pages = new Map();
  for (const e of entries) {
    const body = e.file ? read(e.file) : null;
    if (e.part === 'roundup') {
      if (e.status === 200 && body) ST.upsertLookup(store, e.key, 'roundup', { entries: X.kymRoundupEntries(body) }, at);
      continue;
    }
    if (e.part !== 'kym') continue;
    const p = pages.get(e.key) || { n: 0, guessN: 0, page: null };
    const summary = e.status === 200 && body ? X.kymPageSummary(body) : null;
    pages.set(e.key, { n: p.n + 1, guessN: p.guessN + (e.known ? 0 : 1), page: p.page || (summary ? { slug: e.slug, ...summary } : null) });
  }
  for (const [key, p] of pages) {
    ST.upsertLookup(store, key, 'kym', p.page, at);
    ST.upsertLookup(store, key, 'kymN', p.n, at);
    ST.upsertLookup(store, key, 'kymGuessN', p.guessN, at);
  }
}

/** Every saved lookup answer, oldest first so the newest wins (the cached rebuild and a first run's seed). */
function replayLookups(store, rawDir) {
  for (const f of S.snapshotFiles(rawDir, S.WIKI_BATCH_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const pairs = S.safeJson(readText(f.path)) || [];
    const stem = f.name.replace(/\.keys\.json$/, '');
    const replies = fs.readdirSync(f.dir).filter((n) => n.startsWith(`${stem}-`) && n.endsWith('.json')).sort()
      .map((n) => S.safeJson(readText(path.join(f.dir, n)))).filter(Boolean);
    if (replies.length) applyWikiBatch(store, replies, pairs, f.mtime);
  }
  for (const f of S.snapshotFiles(rawDir, S.WIKT_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const json = S.safeJson(readText(f.path)); // a rate-limit page is no answer
    if (json) ST.upsertLookup(store, f.name.match(S.WIKT_FILES)[1], 'wikt', WD.parseWikt(json), f.mtime);
  }
  for (const f of S.snapshotFiles(rawDir, S.SINCE_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const xml = readText(f.path);
    const term = S.sinceTermOf(xml);
    if (term) ST.upsertLookup(store, f.name.match(S.SINCE_FILES)[1], 'since', WD.sinceOf(S.parseFeed(xml), term, f.mtime), f.mtime);
  }
  for (const f of S.snapshotFiles(rawDir, S.STORY_GN_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const xml = readText(f.path);
    const query = storyQueryOf(xml);
    if (query) ST.upsertLookup(store, `story-${f.name.match(S.STORY_GN_FILES)[1]}`, 'deep', { query, rows: S.storyRows(xml) }, f.mtime);
  }
  for (const f of S.snapshotFiles(rawDir, S.STORY_WIKI_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const j = S.safeJson(readText(f.path));
    if (j && j.query && j.reply) ST.upsertLookup(store, `story-${f.name.match(S.STORY_WIKI_FILES)[1]}`, 'wiki', { query: j.query, pages: STY.parseWikiSearch(j.reply) }, f.mtime);
  }
  for (const f of S.snapshotFiles(rawDir, S.LOOKUP_LOG_FILES).sort((a, b) => a.mtime - b.mtime)) {
    const read = (name) => (fs.existsSync(path.join(f.dir, name)) ? readText(path.join(f.dir, name)) : null);
    applyLookupLog(store, S.safeJson(readText(f.path)) || [], read, f.mtime);
  }
}

/** Fetches one text body after a pause and saves it. Returns { status, text }, or null when the request failed. */
async function politeGet(url, file, ua, gapMs, log) {
  await new Promise((r) => setTimeout(r, gapMs));
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    fs.writeFileSync(file, text);
    return { status: res.status, text };
  } catch (e) {
    log(`[lookups] ${path.basename(file)}: ${e.message}`);
    return null;
  }
}

/**
 * Wikimedia answers for the strongest "Words & trends" candidates: the Wikipedia summary of a page named exactly like the term,
 * that page's daily views for 30 days, a coinage's Wiktionary sense.
 */
async function refreshLookups(store, targets, { rawDir, now, log }) {
  const liveDir = liveDirOf(rawDir, now);
  let calls = 0;
  let limited = false;
  // one request at a time, spaced out: Wikimedia throttles bursts from an app without a registered contact
  const get = async (url, name) => {
    if (limited) return null;
    if (calls++) await new Promise((r) => setTimeout(r, LOOKUP_GAP_MS));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': S.UA_WIKI }, signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      const json = S.safeJson(text);
      if (res.status === 429 || !json) { limited = true; log(`[lookups] ${new URL(url).host} throttled (${res.status}); the rest wait for the next refresh`); return null; }
      fs.writeFileSync(path.join(liveDir, name), text);
      return { ok: res.ok, json };
    } catch (e) {
      log(`[lookups] ${name}: ${e.message}`);
      return null;
    }
  };
  // a number used as slang has its page under the hyphenated form ("67" -> "6-7")
  const wikiPairs = targets.filter((t) => t.wantWiki).flatMap((t) => [[t.key, S.wmTitle(t.term)],
    ...(/^\d{2,3}$/.test(t.term) ? [[t.key, t.term.split('').join('-')]] : [])]);
  for (let b = 0; b * S.WIKI_BATCH < wikiPairs.length; b++) {
    const pairs = wikiPairs.slice(b * S.WIKI_BATCH, (b + 1) * S.WIKI_BATCH);
    const stem = `wm-wiki-${Date.now()}${b}`; // wall clock: runs on one saved store share "now"
    fs.writeFileSync(path.join(liveDir, `${stem}.keys.json`), JSON.stringify(pairs));
    const replies = [];
    let cont = null;
    for (let part = 0; part <= S.WIKI_BATCH_CONTINUE; part++) {
      const r = await get(S.wikiBatchUrl(pairs.map((p) => p[1]), cont), `${stem}-${part}.json`);
      if (!r || !r.ok) break;
      replies.push(r.json);
      cont = r.json.continue;
      if (!cont) break;
    }
    if (replies.length) applyWikiBatch(store, replies, pairs, now);
  }
  for (const t of targets.filter((x) => x.wantWikt).slice(0, WIKT_MAX)) {
    let r = await get(S.wiktionaryUrl(t.term), `wm-wikt-${t.key}.json`);
    let parsed = r && r.ok ? WD.parseWikt(r.json) : null;
    if (parsed && !parsed.senses.length && parsed.lemma) { // saved under the same name, so a cached rebuild reads the lemma's page
      r = await get(S.wiktionaryUrl(parsed.lemma), `wm-wikt-${t.key}.json`);
      parsed = r && r.ok ? WD.parseWikt(r.json) : parsed;
    }
    // a missing entry is an answer too (no sense), so it is not asked again for a week
    if (r) ST.upsertLookup(store, t.key, 'wikt', parsed, now);
  }
  log(`[lookups] ${targets.length} terms, ${calls} Wikipedia/Wiktionary requests`);
}

/** When each strong candidate began: one open-ended Google News search per term. */
async function refreshSince(store, targets, { rawDir, now, log }) {
  const liveDir = liveDirOf(rawDir, now);
  let done = 0;
  for (const t of targets) {
    const r = await politeGet(S.sinceUrl(t.term), path.join(liveDir, `gn-since-${t.key}.xml`), S.UA_BROWSER, SINCE_GAP_MS, log);
    if (!r || r.status !== 200) continue;
    ST.upsertLookup(store, t.key, 'since', WD.sinceOf(S.parseFeed(r.text), t.term, now), now);
    done++;
  }
  log(`[lookups] ${done}/${targets.length} origin searches`);
}

/**
 * Know Your Meme entry pages for terms no source defines, until today's budgets are spent (exact entry pages and guessed ones
 * separately): a term's next slug only after a 404; a block or throttle stops the run.
 */
async function refreshKymPages(store, { known, guess, targets }, { rawDir, now, log }) {
  const liveDir = liveDirOf(rawDir, now);
  const entries = [];
  const left = { known, guess };
  let blocked = false;
  for (const t of targets) {
    if (blocked || left.known + left.guess <= 0) break;
    let page = null;
    let n = 0;
    let guessN = 0;
    for (const { slug, known: isKnown } of t.slugs) {
      const pool = isKnown ? 'known' : 'guess';
      if (left[pool] <= 0) continue;
      left[pool]--;
      const file = `kym-page-${t.key}-${n}.html`;
      const r = await politeGet(S.kymPageUrl(slug), path.join(liveDir, file), S.UA_KYM, KYM_GAP_MS, log);
      n++;
      if (!isKnown) guessN++;
      entries.push({ key: t.key, part: 'kym', term: t.term, slug, known: isKnown, status: r ? r.status : 0, file: r ? file : null });
      const summary = r && r.status === 200 ? X.kymPageSummary(r.text) : null;
      if (summary) { page = { slug, ...summary }; break; }
      if (!r || r.status !== 404) { blocked = !r || r.status === 403 || r.status === 429; break; }
    }
    if (!n) continue;
    ST.upsertLookup(store, t.key, 'kym', page, now);
    ST.upsertLookup(store, t.key, 'kymN', n, now);
    ST.upsertLookup(store, t.key, 'kymGuessN', guessN, now);
  }
  if (entries.length) fs.writeFileSync(path.join(liveDir, logName('kym')), JSON.stringify(entries));
  log(`[lookups] ${entries.filter((e) => e.status === 200).length}/${entries.length} Know Your Meme entry pages${blocked ? ' (stopped: blocked)' : ''}`);
}

/** Know Your Meme's weekly roundup pages not read yet: each pick's name and exact entry page, read once. */
async function refreshRoundups(store, targets, { rawDir, now, log }) {
  const liveDir = liveDirOf(rawDir, now);
  const entries = [];
  for (const t of targets) {
    const file = `kym-roundup-${t.slug}.html`.slice(0, 200);
    const r = await politeGet(S.kymEditorialUrl(t.slug), path.join(liveDir, file), S.UA_KYM, KYM_GAP_MS, log);
    entries.push({ key: t.key, part: 'roundup', slug: t.slug, status: r ? r.status : 0, file: r ? file : null });
    if (r && r.status === 200) ST.upsertLookup(store, t.key, 'roundup', { entries: X.kymRoundupEntries(r.text) }, now);
    if (!r || r.status === 403 || r.status === 429) break;
  }
  if (entries.length) fs.writeFileSync(path.join(liveDir, logName('roundup')), JSON.stringify(entries));
  log(`[lookups] ${entries.filter((e) => e.status === 200).length}/${entries.length} Know Your Meme roundup pages`);
}

/** The query a saved story search asked for, read back from the feed's channel link, without its date window. */
function storyQueryOf(xml) {
  const q = ((xml || '').match(/<channel>[\s\S]*?<link>[^<]*?[?&](?:amp;)?q=([^&<]+)/) || [])[1];
  if (!q) return null;
  try { return decodeURIComponent(q.replace(/\+/g, ' ')).replace(/\s+when:\d+d$/, '').trim() || null; } catch { return null; }
}

/**
 * Story lookups for the listed moments (story.js lookupTargets), one at a time: first a Google News search per story name, then
 * (ideas.js picks them after the news is in: a story's own news names the saga partner its Wikipedia search pairs the main name
 * with) a Wikipedia search per story. A throttle or block stops that kind for this refresh. Each returns how many it saved.
 */
async function refreshStoryNews(store, deep, { rawDir, now, log }) {
  const liveDir = liveDirOf(rawDir, now);
  let news = 0;
  for (const t of deep) {
    const r = await politeGet(S.storyNewsUrl(t.query), path.join(liveDir, `gn-story-${t.key.slice(6)}.xml`), S.UA_BROWSER, SINCE_GAP_MS, log);
    if (!r || r.status === 429 || r.status === 503) break;
    if (r.status !== 200) continue;
    ST.upsertLookup(store, t.key, 'deep', { query: t.query, rows: S.storyRows(r.text) }, now);
    news++;
  }
  log(`[lookups] story searches: ${news}/${deep.length} Google News`);
  return news;
}

async function refreshStoryWiki(store, wiki, { rawDir, now, log }) {
  const liveDir = liveDirOf(rawDir, now);
  let pages = 0;
  for (const t of wiki) {
    await new Promise((res) => setTimeout(res, STORY_WIKI_GAP_MS));
    try {
      const res = await fetch(S.wikiSearchUrl(t.query), { headers: { 'User-Agent': S.UA_WIKI }, signal: AbortSignal.timeout(15000) });
      const reply = S.safeJson(await res.text());
      if (res.status === 429 || !reply) { log(`[lookups] Wikipedia search throttled (${res.status}); the rest wait for the next refresh`); break; }
      fs.writeFileSync(path.join(liveDir, `wm-story-${t.key.slice(6)}.json`), JSON.stringify({ query: t.query, reply }));
      ST.upsertLookup(store, t.key, 'wiki', { query: t.query, pages: STY.parseWikiSearch(reply) }, now);
      pages++;
    } catch (e) {
      log(`[lookups] story search ${t.query}: ${e.message}`);
    }
  }
  log(`[lookups] story searches: ${pages}/${wiki.length} Wikipedia`);
  return pages;
}

module.exports = { replayLookups, refreshLookups, refreshSince, refreshKymPages, refreshRoundups, refreshStoryNews, refreshStoryWiki };
