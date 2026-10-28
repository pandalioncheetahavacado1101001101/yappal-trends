'use strict';
/*
 * Wiktionary's newest slang (ios/IDEAS-FEED.md M6): the pages most lately added to four of its categories (internet slang, fandom
 * slang, neologisms, and the words its editors mark as hot and under a year old), each with the day it joined, and a word's own
 * entry for what it means and the day the entry was first written. Wikimedia's public API, keyless, inside the Wikimedia cap.
 *
 * A dictionary confirms and defines; it does not spot first (a word can be months old the day it gets an entry). So a word listed
 * from here says where its meaning comes from, starts the day its entry was written, and is never "rising" by being here.
 *
 * Flags (2026-10-29): needs permission: Wikimedia (robots.txt disallows /w/ for every agent, and api.php is under it; the deaths page,
 * lib/sources/deaths-page.js, carries the same flag). The meanings are CC BY-SA: credited as Wiktionary on every row that shows one.
 */
const { request } = require('./fixed');
const WA = require('../../engine/words-answers');
const { HOUR, keyOf } = require('../util');

const API = 'https://en.wiktionary.org/w/api.php';
const CATEGORIES = [
  { id: 'internet', title: 'English_internet_slang' },
  { id: 'hot', title: 'Hot_words_newer_than_a_year' },
  { id: 'fandom', title: 'English_fandom_slang' },
  { id: 'neologisms', title: 'English_neologisms' },
];
const EVERY = 3 * HOUR;
const MEMBERS = 40;
const ENTRIES_PER_CYCLE = 2;
const ENTRY_AGAIN = 7 * 24 * HOUR;
const TERM_MAX = 40;
const MEANING_MAX = 180;
// a label that says the word is slang of the internet's: what makes a sense the one a creator would mean
const SLANG_LABEL = /\b(?:internet|slang|fandom|neologism|online|social media|tiktok|gen z|memes?|humorous|informal|gaming|twitch)\b/i;

/** The categories due: each every three hours. lastReadAt: Map(id -> epoch seconds). */
const categoryRequests = (lastReadAt = new Map(), now = 0) => CATEGORIES.filter((c) => now - (lastReadAt.get(`wikt-cat-${c.id}`) ?? -Infinity) >= EVERY)
  .map((c) => request({ id: `wikt-cat-${c.id}`, source: 'wikt-slang', kind: 'wikt-cat', args: { category: c.id },
    url: `${API}?action=query&list=categorymembers&cmtitle=Category:${c.title}&cmsort=timestamp&cmdir=desc&cmlimit=${MEMBERS}&cmprop=title%7Ctimestamp&format=json`, file: `wikt-cat-${c.id}.json`, tier: 3 }));

/** A category's newest members as [{ term, at (epoch seconds: when it joined the category) }]; null when the reply is not that list. */
function parseCategory(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const members = j && j.query && j.query.categorymembers;
  if (!Array.isArray(members)) return null;
  // (English only, a main-namespace page, a term somebody could say)
  return members.filter((m) => m && m.ns === 0 && typeof m.title === 'string' && m.title.length <= TERM_MAX && /^[\p{Script=Latin}\d][\p{Script=Latin}\d '’.+-]*$/u.test(m.title))
    .map((m) => ({ term: m.title, at: Math.floor(Date.parse(m.timestamp) / 1000) })).filter((m) => Number.isFinite(m.at));
}

/** A word's entry with the day it was first written: the extract and the first revision's time. */
const entryRequest = (term) => request({ id: `wikt-entry-${keyOf(term).replace(/ /g, '-')}`, source: 'wikt-slang', kind: 'wikt-entry', args: { term },
  url: `${API}?action=query&format=json&formatversion=2&redirects=1&prop=extracts%7Crevisions&explaintext=1&rvlimit=1&rvdir=newer&rvprop=timestamp&titles=${encodeURIComponent(term)}`,
  file: 'wikt-entry.json', tier: 3 });
/** The entries to read this cycle: the terms wanted (strongest first) not read for a week, two at most. readAt: Map(request id -> epoch seconds). */
const entryTurn = (terms, readAt = new Map(), now = 0, max = ENTRIES_PER_CYCLE) => terms.map(entryRequest).filter((r) => now - (readAt.get(r.id) ?? -Infinity) >= ENTRY_AGAIN).slice(0, max);

/**
 * An entry as { term, meaning, label, created (epoch seconds: its first revision) } or { term, meaning: null } when the page has no
 * English sense (an answer too: it is not asked again for a week); null when the reply is not an entry. The meaning is the first
 * sense whose label says slang, else the first, as one sentence.
 */
function parseEntry(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  const page = j && j.query && Array.isArray(j.query.pages) ? j.query.pages[0] : null;
  if (!page || typeof page.title !== 'string') return null;
  const parsed = page.missing ? null : WA.parseWikt(j);
  const senses = (parsed && parsed.senses) || [];
  const sense = senses.find((s) => SLANG_LABEL.test(s.label || '')) || senses[0] || null;
  const created = Math.floor(Date.parse(((page.revisions || [])[0] || {}).timestamp) / 1000);
  if (!sense) return { term: page.title, meaning: null, label: null, created: Number.isFinite(created) ? created : null };
  // (a label the entry prints before the sense, "(neologism, US politics) ...", is no part of the meaning)
  let meaning = sense.text.replace(/\s+/g, ' ').trim().replace(/^(?:\([^)]{1,80}\)\s*)+/, '');
  if (!meaning) return { term: page.title, meaning: null, label: sense.label || null, created: Number.isFinite(created) ? created : null };
  if (meaning.length > MEANING_MAX) meaning = `${meaning.slice(0, meaning.lastIndexOf(' ', MEANING_MAX)).replace(/[,;:]$/, '')}…`;
  if (!/[.!?…]$/.test(meaning)) meaning = `${meaning}.`;
  return { term: page.title, meaning: meaning.charAt(0).toUpperCase() + meaning.slice(1), label: sense.label || null, created: Number.isFinite(created) ? created : null };
}

module.exports = { CATEGORIES, EVERY, ENTRIES_PER_CYCLE, categoryRequests, parseCategory, entryRequest, entryTurn, parseEntry };
