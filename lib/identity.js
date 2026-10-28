'use strict';
/*
 * Stable ids (ios/IDEAS-FEED.md D2). Every engine row of a cycle is matched to a trend, or a trend is minted for it. The id is opaque
 * and never changes while the trend lives, whatever happens to its title ("Quavnix ComplexCon fight" becoming "Quavnix stabbing" is one
 * id); it is the same in every audience's list. Pure: the index is plain maps, lib/history.js loads and saves them.
 *
 * A row is what lib/rows.js makes of one hot-list entry: { audience, kind, cardKey, natural, subject, family, title, line, heads (the
 * keys of its own headlines) }.
 */
const { keyOf, hash32, DAY } = require('./util');

const CLOSE_AFTER_DAYS = { talk: 8, moment: 8, word: 30, sound: 30 };
const MATCH_WITHIN_DAYS = 8;
const KEYS_KEPT = 5;
const HEADS_KEPT = 40;
const SHARED_HEADLINES = 2;
const LINE_SHARE = 0.5;
// (a name listed bare is waiting for its noun only while it is new: the cycles its name search takes to land)
const BARE_YOUNG_SECONDS = 6 * 3600;
const LINE_STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'and', 'or', 'as', 'after', 'over', 'amid', 'is', 'was', 'his', 'her', 'their', 'he',
  'she', 'they', 'it', 'that', 'this', 'has', 'have', 'had', 'be', 'been', 'says', 'said', 'reportedly', 'allegedly']);

/** The content words of a line, as keys. */
const lineWords = (line) => [...new Set(keyOf(line).split(' ').filter((w) => w.length > 2 && !LINE_STOP.has(w)))];

/**
 * A row's natural key: a talking point's subject and story (its noun family, else its noun, else its whole title), a word's term, a
 * moment's lead headline.
 */
function naturalKey({ kind, subject, family, noun, title, term, headline }) {
  if (kind === 'word' || kind === 'sound') return `word|${keyOf(term || subject || title)}`;
  if (kind === 'moment') return `moment|${keyOf(headline || title)}`;
  const s = keyOf(subject || '');
  return s ? `talk|${s}|${family || keyOf(noun || '') || keyOf(title)}` : `talk||${keyOf(title)}`;
}

/** Whether a trend is closed at `now`: unseen for 8 days (30 for a word or a sound). Coming back later is a new trend. */
const isClosed = (trend, now) => Number.isFinite(trend.closedAt) || now - trend.lastSeen > (CLOSE_AFTER_DAYS[trend.kind] || 8) * DAY;
const sameClass = (a, b) => (a === 'word' || a === 'sound') === (b === 'word' || b === 'sound') && (a === 'moment') === (b === 'moment');

/** Whether one name is the other with a word or more added, as whole words ("jasade" and "jasade wickenko"; never "jas" and "jasade"). */
const wordsWithin = (a, b) => !!a && !!b && a !== b && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `));

/**
 * Whether a row tells the story a live trend already is: the same subject and either the same noun family, a noun where the other has
 * none, half of its line's words, or two shared headlines (a talking point); or, for a moment, half of its headline's words or two shared headlines.
 * A subject that only gained or lost a word of its name is the same one when the family is the same and the line or the headlines are.
 */
function sameStory(row, trend, now = null) {
  const info = trend.info || {};
  if (!sameClass(row.kind, trend.kind) || row.kind === 'word' || row.kind === 'sound') return false;
  const heads = new Set(info.heads || []);
  const sharedHeads = (row.heads || []).filter((h) => heads.has(h)).length >= SHARED_HEADLINES;
  const mine = lineWords(row.kind === 'moment' ? row.title : row.line || '');
  const theirs = new Set(info.lineWords || []);
  const sharedLine = mine.length >= 3 && mine.filter((w) => theirs.has(w)).length >= LINE_SHARE * mine.length;
  if (row.kind === 'moment') return sharedHeads || sharedLine;
  const subject = keyOf(row.subject || '');
  if (!subject) return false;
  if (subject !== info.subject) {
    // (a name that gains or loses a word is one subject only when the story is plainly the same one: the same noun family, and half of
    // its line's words or two shared headlines. Live 2026-10-11: "Jasade failed execution" became "Jasade Wickenko failed execution" the
    // cycle its name search landed, under the very same line, and was minted a second id)
    // (and when either side has no noun yet, the line or the headlines alone say so: "Yorkshire attack", listed before its name
    // search landed, became "Yorkshire Wildlife death" with half its line's words and was minted again. Reviewers, 2026-10-12)
    return wordsWithin(subject, info.subject) && (!row.family || !info.family || row.family === info.family) && (sharedLine || sharedHeads);
  }
  // (a name listed on its own, before its headlines gave it a noun, is the same trend once they do, and the other way round: "Carrie"
  // becoming "Carrie ending" the cycle its name search lands is one id. Two nouns are two stories)
  // (only that case: the bare trend is young, still waiting for its search, or the two share a headline or half a line. Last week's
  // "Bexan Tamard allegations", off the list three days, is not today's new card "Bexan Tamard" with another line and no headline in
  // common: that card would take its id, its start, its timeline and every mark made on it. Reviewers, 2026-10-12)
  if (!row.family !== !info.family) {
    const oneHead = (row.heads || []).some((h) => heads.has(h));
    const bareIsYoung = !Number.isFinite(now) || (!info.family && Number.isFinite(trend.firstSeen) && now - trend.firstSeen <= BARE_YOUNG_SECONDS);
    return bareIsYoung || oneHead || sharedLine;
  }
  return (!!row.family && row.family === info.family) || sharedLine || sharedHeads;
}

/**
 * Matches rows to trends. index: { trends: Map(id -> { id, kind, firstSeen, lastSeen, closedAt, info: { subject, family, lineWords,
 * heads, keys, naturals } }), aliases: Map(key -> id) }. now: this cycle's slot (epoch seconds).
 * Returns { ids (one per row, in order), minted: [{ id, natural, kind, firstSeen }], aliases: [[key, id]] }; the index itself is not
 * changed. One name can hold two stories at once: inside one audience's list a trend is given to one row only.
 */
function match(rows, index, now) {
  const live = (id) => { const tr = index.trends.get(id); return tr && !isClosed(tr, now) ? tr : null; };
  const claimed = new Map(); // audience -> Set(id)
  const taken = (row, id) => (claimed.get(row.audience) || new Set()).has(id);
  const claim = (row, id) => { if (!claimed.has(row.audience)) claimed.set(row.audience, new Set()); claimed.get(row.audience).add(id); };
  const minted = new Map(); // natural -> minted trend (this cycle)
  const added = new Map();
  const pool = [...index.trends.values()].filter((tr) => !isClosed(tr, now) && now - tr.lastSeen <= MATCH_WITHIN_DAYS * DAY).sort((a, b) => b.lastSeen - a.lastSeen || a.id.localeCompare(b.id));
  const mintedPool = [];
  const used = new Set(index.trends.keys());
  // one story, one id, whatever each audience's list titles it (D2): the rows of different audiences that tell the same story (the
  // same kind of card, a subject that is the other's or the other's with a word more, the same noun where both have one, two
  // headlines in common) are matched together. Live 2026-10-11: the US list had "Jasade Wickenko execution" and the GB list
  // "Jasade execution", 34 shared headlines, under two ids, each row finding its own alias every cycle
  const groupOf = new Map();
  const groups = [];
  rows.forEach((row, i) => {
    const heads = new Set(row.heads || []);
    const subject = keyOf(row.subject || '');
    const g = row.kind === 'talk' && heads.size >= SHARED_HEADLINES && subject ? groups.find((members) => members.every((j) => rows[j].audience !== row.audience) && members.some((j) => {
      const other = rows[j];
      const theirs = keyOf(other.subject || '');
      return other.kind === row.kind && (subject === theirs || wordsWithin(subject, theirs)) && (!row.family || !other.family || row.family === other.family) &&
        (other.heads || []).filter((h) => heads.has(h)).length >= SHARED_HEADLINES;
    })) : null;
    if (g) { g.push(i); groupOf.set(i, g); } else { const made = [i]; groups.push(made); groupOf.set(i, made); }
  });
  const ids = new Array(rows.length).fill(null);
  const give = (i, id) => { ids[i] = id; claim(rows[i], id); added.set(rows[i].natural, id); added.set(rows[i].cardKey, id); };
  // 1. the rows a saved alias names exactly, across every audience, before anything is matched by likeness: a likeness can never take
  // a trend that one of this cycle's rows holds by its own key (the bare card "Bexan Tamard" ranked above "Bexan Tamard allegations" in one
  // list took its id, and the benchmark row was minted a new one). A group takes its oldest such trend: the younger one's keys
  // are pointed at it, which is the merge of what were two ids for one story
  const exactOf = (row) => [index.aliases.get(row.natural), index.aliases.get(row.cardKey)].filter(Boolean).find((c) => live(c)) || null;
  const held = new Set();
  for (const members of groups) {
    const found = members.map((i) => exactOf(rows[i])).filter(Boolean);
    if (!found.length) continue;
    const oldest = [...new Set(found)].sort((x, y) => index.trends.get(x).firstSeen - index.trends.get(y).firstSeen || x.localeCompare(y))[0];
    for (const i of members) {
      const own = exactOf(rows[i]);
      const id = !taken(rows[i], oldest) ? oldest : own && !taken(rows[i], own) ? own : null;
      if (id) { give(i, id); held.add(id); }
    }
  }
  // 2. the rest, in the lists' order: what an earlier row of this cycle was given under the same key, then a live trend that tells
  // the same story (never one held exactly above), else a new trend
  rows.forEach((row, i) => {
    if (ids[i]) return;
    const fellow = groupOf.get(i).map((j) => ids[j]).find((x) => x && !taken(row, x)) || null;
    const candidates = [added.get(row.natural), added.get(row.cardKey)].filter(Boolean);
    let id = fellow || candidates.find((c) => (live(c) || mintedPool.some((m) => m.id === c)) && !taken(row, c)) || null;
    if (!id) {
      const hit = [...pool.filter((tr) => !held.has(tr.id)), ...mintedPool].find((tr) => !taken(row, tr.id) && sameStory(row, tr, now));
      id = hit ? hit.id : null;
    }
    if (!id) {
      // the first 12 base-32 characters of sha256(natural key | first seen); a clash (never seen) takes one more character
      let n = 12;
      id = hash32(`${row.natural}|${now}`, n);
      while (used.has(id) && n < 16) { n += 1; id = hash32(`${row.natural}|${now}`, n); }
      used.add(id);
      const trend = { id, kind: row.kind, natural: row.natural, firstSeen: now, lastSeen: now, closedAt: null,
        info: { subject: keyOf(row.subject || ''), family: row.family || null, lineWords: lineWords(row.kind === 'moment' ? row.title : row.line || ''), heads: (row.heads || []).slice(0, HEADS_KEPT) } };
      minted.set(id, trend);
      mintedPool.push(trend);
    }
    give(i, id);
  });
  return { ids, minted: [...minted.values()].map((t) => ({ id: t.id, natural: t.natural, kind: t.kind, firstSeen: t.firstSeen })), aliases: [...added.entries()] };
}

/** A trend's card keys with this cycle's first (newest first, five at most): what lets hide and filmed marks carry to the fallback (E4). */
const withKey = (keys, cardKey) => [cardKey, ...(keys || []).filter((k) => k !== cardKey)].slice(0, KEYS_KEPT);

/** What the next cycle matches against: the trend's subject, family, line words and the keys of its own headlines (the newest kept). */
function infoAfter(info, row) {
  const heads = [...new Set([...(row.heads || []), ...((info && info.heads) || [])])].slice(0, HEADS_KEPT);
  return { ...(info || {}), subject: keyOf(row.subject || ''), family: row.family || (info && info.family) || null, lineWords: lineWords(row.kind === 'moment' ? row.title : row.line || ''), heads,
    keys: withKey(info && info.keys, row.cardKey) };
}

module.exports = { naturalKey, match, sameStory, isClosed, withKey, infoAfter, lineWords, CLOSE_AFTER_DAYS, KEYS_KEPT };
