'use strict';
/*
 * Source hygiene: what never reaches the engine, whatever feed carried it. A content farm's page is no source for a title, a line, a
 * noun or a count (judges, 2026-10-11: "Essard Quillent backlash", titled and told by "Essard Quillent Viral Video Controversy Full Story"
 * from a host that printed three of them, while the real outlets told a split). Two tells, neither a list of names:
 *   an empty headline   a name, then only the words such pages string around any name ("viral video", "full story", "sparks massive
 *                       backlash"), a random tail or none: it claims nothing about anyone;
 *   a page generator's  marks no newsroom prints ("®√viral▷☀!!", "++VIDEOS!!", "(=LTUBE=)"): the same kind of page;
 *   a spam host         an outlet two or more of whose headlines are those, and at least three in ten of all it printed (a
 *                       hijacked or rented host: one such host held 250 of a store's 3,600 rows): everything it printed goes.
 * Pure but for `scrubStore`, which drops the rows from the engine's store in memory (rows and the name searches' replies).
 */
const W = require('../engine/wording');
const { keyOf } = require('./util');

const SPAM_HOST_HEADLINES = 2;
const SPAM_HOST_SHARE = 0.3;
const NAME_WORDS_MAX = 4;
// what such a page is sold as
const MARK = /\b(?:viral (?:video|clip|mms|link)|leaked (?:video|clip|mms)|full (?:story|video|clip)|video (?:link|leak)|(?:original|real) (?:video|link))\b/i;
// the words strung around the name: none of them says who did what
const BUZZ = new Set(['viral', 'video', 'videos', 'clip', 'clips', 'mms', 'link', 'links', 'leaked', 'leak', 'leaks', 'full', 'story', 'controversy', 'explained', 'sparks', 'spark',
  'sparking', 'massive', 'huge', 'backlash', 'outrage', 'debate', 'trending', 'trend', 'trends', 'original', 'watch', 'online', 'download', 'telegram', 'twitter', 'reddit', 'x', 'tiktok',
  'instagram', 'real', 'truth', 'behind', 'what', 'happened', 'who', 'is', 'why', 'the', 'a', 'an', 'of', 'and', 'to', 'on', 'in', 'goes', 'went', 'new', 'latest', 'news', 'update',
  'updates', 'details', 'reaction', 'reactions', 'internet', 'social', 'media', 'scandal', 'exposed', 'shocking', 'everything', 'know', 'you', 'need', 'we', 'about', 'here', 'after',
  'over', 'amid', 'as', 'with', 'for', 'from', 'her', 'his', 'their', 'now', 'today', 'hd', 'free', 'exclusive', 'breaking']);

/** A row's outlet as the feeds give it: the publisher field, else the " - Outlet" a Google News title ends with. */
const outletOf = (row) => String((row && (row.publisher || row.outlet)) || ((String((row && row.title) || '').match(/\s[-–—]\s([^–—-]{2,60})$/) || [])[1]) || '').trim();
/** The headline without its outlet's tail. */
const headlineOf = (row) => { const o = outletOf(row); const t = String((row && row.title) || ''); return o && t.endsWith(o) ? t.slice(0, -o.length).replace(/\s[-–—|]\s*$/, '').trim() : t.trim(); };

// what a page generator decorates a headline with, and no newsroom does
const MARKUP = /[®√▷☀™]|\+\+|!!\*|\[\[|~\(|\(=\w|\+@!|\(\+\+|\bHQx\d|\b18\s*\+\+?\s*(?:videos?|clip)/i;
const junkMarkup = (headline) => MARKUP.test(String(headline || ''));
/** A word that can be part of a name: no dictionary word (a first name may be one). */
const nameWord = (w) => !W.isDictWord(w) || W.isFirstName(w);

/** A random tail a page generator leaves on a headline: one lowercase token of letters no dictionary knows and no one could say ("qnkkd"). */
function randomTail(word) {
  const w = String(word || '');
  if (!/^[a-z]{4,8}$/.test(w) || W.inDict(w)) return false;
  const vowels = (w.match(/[aeiouy]/g) || []).length;
  return vowels === 0 || /[^aeiouy]{4,}/.test(w);
}

/**
 * Whether a headline claims nothing: it carries a page-seller's mark, and all it has beside the name that leads it are the words
 * strung around any name. "Essard Quillent Viral Video Controversy Full Story" is one; "Truth behind viral video of fans chasing a
 * buffalo" is not (it leads with what it explains), nor is "Dovory Kelmott's Halloween video goes viral, AI claims".
 */
function emptyHeadline(headline) {
  const text = String(headline || '');
  if (!MARK.test(text)) return false;
  let ws = keyOf(text).split(' ').filter(Boolean);
  if (ws.length && randomTail(text.trim().split(/\s+/).pop())) ws = ws.slice(0, -1);
  const firstBuzz = ws.findIndex((w) => BUZZ.has(w));
  if (firstBuzz < 1 || firstBuzz > NAME_WORDS_MAX) return false;
  // (what leads it is a name, never a clause: "Botany bandit foiled by viral video" says who did what)
  return ws.slice(0, firstBuzz).every(nameWord) && ws.slice(firstBuzz).every((w) => BUZZ.has(w));
}

/**
 * The spam among rows: { hosts: Set(outlet key), isSpam(row) }. A host is spam with two empty or generated headlines that are three
 * in ten of all it printed; a row is spam when its host is, or when its own headline is empty or generated.
 */
function spamOf(rows) {
  const bad = new Map();
  const all = new Map();
  const hostOf = (row) => keyOf(outletOf(row)) || outletOf(row).toLowerCase();
  const isBad = (row) => { const head = headlineOf(row); return emptyHeadline(head) || junkMarkup(head); };
  for (const row of rows) {
    const outlet = hostOf(row);
    if (!outlet) continue;
    all.set(outlet, (all.get(outlet) || 0) + 1);
    if (isBad(row)) bad.set(outlet, (bad.get(outlet) || 0) + 1);
  }
  const hosts = new Set([...bad].filter(([outlet, n]) => n >= SPAM_HOST_HEADLINES && n >= SPAM_HOST_SHARE * all.get(outlet)).map(([outlet]) => outlet));
  const isSpam = (row) => { const outlet = hostOf(row); return (!!outlet && hosts.has(outlet)) || isBad(row); };
  return { hosts, isSpam };
}

/** Every headline row a store holds: its rows, and the rows of each name search's reply. */
function* storeRows(store) {
  for (const row of store.rows.values()) yield row;
  for (const lookup of store.lookups.values()) {
    for (const part of Object.values(lookup)) if (part && Array.isArray(part.rows)) for (const row of part.rows) if (row && row.title) yield row;
  }
}

/** Drops the spam from a store in memory, before the engine reads it: { dropped, hosts: [names] }. The store's own save then keeps it out. */
function scrubStore(store) {
  const { hosts, isSpam } = spamOf([...storeRows(store)].filter((r) => r.fam === undefined || r.fam === 'gnews' || r.fam === 'celeb'));
  let dropped = 0;
  for (const [key, row] of [...store.rows]) if ((row.fam === 'gnews' || row.fam === 'celeb') && isSpam(row)) { store.rows.delete(key); dropped += 1; }
  for (const [key, lookup] of [...store.lookups]) {
    let changed = null;
    for (const [name, part] of Object.entries(lookup)) {
      if (!part || !Array.isArray(part.rows)) continue;
      const kept = part.rows.filter((row) => !(row && row.title && isSpam(row)));
      if (kept.length !== part.rows.length) { dropped += part.rows.length - kept.length; changed = { ...(changed || lookup), [name]: { ...part, rows: kept } }; }
    }
    if (changed) store.lookups.set(key, changed);
  }
  return { dropped, hosts: [...hosts].sort() };
}

module.exports = { emptyHeadline, junkMarkup, randomTail, spamOf, scrubStore, outletOf, headlineOf, MARK };
