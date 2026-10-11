'use strict';
/*
 * Rolling 14-day store. Bluesky trends, the KYM feeds and Reddit top lists are snapshots, so a moment from 11 days ago is
 * gone from them by today; each daily refresh upserts what it sees here and the list is built from the stored rows.
 * On the phone this is one SQLite file (rows keyed by URL, trends keyed by geo|keyword|start); here it is a JSON file.
 */
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 16; // the 14-day window plus a margin for time zones and late-dated rows
const DAY = 86400000;

function emptyStore() {
  // lookups: answers per "Words & trends" term key (Wikipedia summary and daily views, Wiktionary sense, the open-ended news
  // search's origin date, the Know Your Meme entry page's definition), refetched when stale
  return { version: 3, lastRefresh: 0, rows: new Map(), trends: new Map(), lookups: new Map() };
}

function openStore(file) {
  const store = emptyStore();
  if (!file || !fs.existsSync(file)) return store;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    store.lastRefresh = j.lastRefresh || 0;
    for (const r of j.rows || []) store.rows.set(r.key, r);
    for (const t of j.trends || []) store.trends.set(t.key, t);
    for (const l of j.lookups || []) store.lookups.set(l.key, l);
    // (the app's store keeps the talking points' Trends rows, every category, as talk-sources.js talkTrends merges them)
    // (a trend still trending has no end: the app leaves the field out, the talking points test it against null)
    if (Array.isArray(j.talkTrends)) store.talkTrends = new Map(j.talkTrends.map((t) => [t.key, { ...t, end: t.end ?? null }]));
  } catch (e) {
    process.stderr.write(`[store] unreadable ${file}: ${e.message}; starting empty\n`);
  }
  return store;
}

/** Writes to a temp file first and renames it over the old one, so a failed write never leaves a truncated store. */
function saveStore(store, file) {
  const body = JSON.stringify({ version: store.version, lastRefresh: store.lastRefresh,
    rows: [...store.rows.values()], trends: [...store.trends.values()], lookups: [...store.lookups.values()],
    // (the app's store keeps the talking points' Trends rows: a copy of it refreshed here keeps them too)
    ...(store.talkTrends ? { talkTrends: [...store.talkTrends.values()] } : {}) });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.new', body);
  fs.renameSync(file + '.new', file);
}

/** Merges a row seen at `seenAt`: keeps its first sighting and best rank, and the latest snapshot's live fields. */
function upsertRow(store, row, seenAt) {
  const old = store.rows.get(row.key);
  if (!old) {
    store.rows.set(row.key, { ...row, srcs: [row.src], seenFirst: seenAt, seenLast: seenAt });
    return;
  }
  const newer = seenAt >= old.seenLast;
  const stronger = (row.w || 0) > (old.w || 0);
  store.rows.set(row.key, {
    ...old,
    ...(stronger ? { src: row.src, w: row.w } : {}),
    ...(newer && row.status ? { status: row.status, postCount: row.postCount } : {}),
    // descriptions follow the newest snapshot (rows stored before a field existed pick it up on the next refresh)
    ...(newer && row.desc ? { desc: row.desc } : {}),
    ...(newer && row.kymDesc ? { kymDesc: row.kymDesc } : {}),
    ...(newer && row.dek ? { dek: row.dek } : {}),
    // a words-only search's row joins the moments list once a moments source has seen it too
    wordsOnly: !!(old.wordsOnly && row.wordsOnly),
    // (and a talking-points-only row, a drama search's, once a feed of the moments' has carried the same link)
    ...(old.talkOnly || row.talkOnly ? { talkOnly: !!(old.talkOnly && row.talkOnly) } : {}),
    // (a creators'-beat search's row stays one, whichever search carried the link first)
    ...(old.beat || row.beat ? { beat: true } : {}),
    // (a creators' post's best place in its day's list)
    ...(Number.isFinite(old.rankToday) || Number.isFinite(row.rankToday) ? { rankToday: Math.min(old.rankToday ?? Infinity, row.rankToday ?? Infinity) } : {}),
    srcs: [...new Set([...(old.srcs || [old.src]), row.src])],
    inherent: old.inherent || row.inherent,
    rankDay: Math.min(old.rankDay ?? Infinity, row.rankDay ?? Infinity),
    t: Math.min(old.t, row.t),
    seenFirst: Math.min(old.seenFirst, seenAt),
    seenLast: Math.max(old.seenLast, seenAt),
  });
}

/** Trends: the highest volume seen, and whether the newest snapshot still shows it as active. */
function upsertTrend(store, tr, seenAt) {
  const old = store.trends.get(tr.key);
  if (!old) { store.trends.set(tr.key, { ...tr, seenLast: seenAt }); return; }
  const newer = seenAt >= old.seenLast;
  store.trends.set(tr.key, {
    ...old,
    volume: Math.max(old.volume, tr.volume),
    end: newer ? tr.end : old.end,
    headline: old.headline || tr.headline,
    related: old.related.length >= tr.related.length ? old.related : tr.related,
    seenLast: Math.max(old.seenLast, seenAt),
  });
}

/**
 * Merges one answer (part: 'summary' | 'views' | 'wikt' | 'since' | 'kym' | 'kymN' | 'kymGuessN' | 'roundup', or a story's 'deep'
 * news search and 'wiki' search) into the term's or story's lookup record.
 */
function upsertLookup(store, key, part, value, fetchedAt) {
  const old = store.lookups.get(key) || { key };
  store.lookups.set(key, { ...old, [part]: value, [`${part}At`]: fetchedAt });
}

function prune(store, now) {
  const min = now - KEEP_DAYS * DAY;
  for (const [k, r] of store.rows) if (r.t < min) store.rows.delete(k);
  for (const [k, t] of store.trends) if ((t.end ?? t.start) < min) store.trends.delete(k);
  // (the collector's store keeps the talking points' Trends rows as the app's does: a search still trending is kept by when it was last seen)
  if (store.talkTrends) for (const [k, t] of store.talkTrends) if ((t.end ?? t.seen ?? t.start) < min) store.talkTrends.delete(k);
  // a term nobody has written about for a month no longer needs its dictionary answer; a name's week of headlines (35 KB a name) holds
  // nothing inside the window a week after it was searched, and a story's searches go with the window
  for (const [k, l] of store.lookups) {
    if (Math.max(l.summaryAt || 0, l.viewsAt || 0, l.wiktAt || 0, l.sinceAt || 0, l.kymAt || 0, l.roundupAt || 0, l.deepAt || 0,
      l.wikiAt || 0, l.tpnewsAt || 0, l.tpytAt || 0) < now - lookupDays(k) * DAY) store.lookups.delete(k);
  }
}
const TALK_LOOKUP_DAYS = 8;
const TERM_LOOKUP_DAYS = 30;
/** How long a lookup is kept after its newest answer: a name's searches a week and a day, a story's the window, a term's a month. */
const lookupDays = (key) => (key.startsWith('talk-') ? TALK_LOOKUP_DAYS : key.startsWith('story-') ? KEEP_DAYS : TERM_LOOKUP_DAYS);

module.exports = { emptyStore, openStore, saveStore, upsertRow, upsertTrend, upsertLookup, prune, KEEP_DAYS, TALK_LOOKUP_DAYS, lookupDays };
