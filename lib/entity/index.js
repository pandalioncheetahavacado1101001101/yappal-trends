'use strict';
/*
 * The entity graph's part of a cycle (ios/IDEAS-SUPER.md P14, ios/.review/datasets-knowledge.md B2): the detail's `relatedRows`.
 * Built once a cycle from every audience's rows, the same for every audience (a detail is): for each card, at most three other rows
 * of this cycle's lists that name the same person, work or sound, or that people who search for it also search for
 * (lib/entity/graph.js), and, when one of its people or its subject was in another story that is no longer listed, that earlier
 * story as a chapter (one at most: the newest). The state keeps where each node was listed and the live lookups (lib/entity/store.js);
 * nothing of it is published but the rows a card shows.
 *
 * An entry: { id, title, via, kind } for a row listed now (id: its feed id, title: as listed, via: the name the two share as this
 * card prints it, kind: person, work, sound or query), or { id: null, title, via, kind, at } for an earlier story (at: the last time
 * it was listed). Never one whose title only says the card's title again (P10).
 */
const D = require('../describe');
const SHEET = require('../sheet');
const ER = require('./roster');
const G = require('./graph');
const ST = require('./store');
const LK = require('./lookup');
const { fold, wordsOf } = require('./fold');
const { instant } = require('../util');

// the rows of a list the graph reads (the list's own cap)
const ROWS_READ = 80;
// an earlier story is a chapter once it has not been listed for this long (it ended), and for at most this long after (30 days: B2)
const CHAPTER_QUIET = 6 * 3600;
const CHAPTER_WITHIN = ST.KEPT_SECONDS;
const MAX_CHAPTERS = 1;
// the names a cycle may want looked up (the newest used are asked first; lib/entity/lookup.js asks three a cycle)
const WANTED_MAX = 40;

// a name the entry says it shares longer than this is cut at a word (a topic can be a whole phrase)
const VIA_MAX = 60;
const short = (text) => { const s = String(text || '').trim(); if (s.length <= VIA_MAX) return s; const cut = s.slice(0, VIA_MAX - 1); return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 30)).trim()}…`; };

/** "Song by Artist" as its two parts, the last " by " dividing them. */
function soundParts(title) {
  const s = String(title || '').replace(/\s+/g, ' ').trim();
  const at = s.toLowerCase().lastIndexOf(' by ');
  return at > 0 ? { song: s.slice(0, at).trim(), artist: s.slice(at + 4).trim() || null } : { song: s, artist: null };
}

/**
 * The cards the graph reads, one a row id, from every audience's rows: { id, title, line, kind, tier, people, topic, sound, tags,
 * searches (its Google Trends keywords), queries (its related searches as its card shows them), rank (the best place in any list),
 * lists (how many lists carry it), audiences (which: a related row is one a list carries beside it) }. related(key): Google Trends'
 * related queries of one of the row's entries, by the entry's key.
 */
function cardsOf(rowsByAudience, { has = () => true, roster = null, related = null, titleOf = (row) => row.title } = {}) {
  const cards = new Map();
  for (const [audience, rows] of Object.entries(rowsByAudience || {})) {
    (rows || []).filter((r) => r && r.id && has(r.id)).slice(0, ROWS_READ).forEach((row, i) => {
      const had = cards.get(row.id);
      if (had) { had.rank = Math.min(had.rank, i + 1); had.lists += 1; had.audiences.add(audience); return; }
      const about = D.aboutOf(row, roster);
      // (its Google Trends keywords are its own searches; its related queries are the ones its card shows, "People also search" (D4
      // `related`, lib/sheet.js): the home country's first, nobody its sources never print. The raw list also carries the queries of an
      // entry the engine attached loosely, and a band's tour then "related" to a shooting through a query of another country's)
      const trends = ((row.meta && row.meta.trends) || []).filter((x) => x && x.key);
      // (a keyword is the row's own search only when it says a word of the row's own name: the engine attaches an entry loosely now
      // and then, and a shooting's row then "searched" for a band's tour dates)
      const own = new Set([row.title, row.subject, row.surface, ...about.people.map((p) => p.name), about.topic ? about.topic.name : ''].flatMap((x) => wordsOf(x || '')));
      const searches = [...new Set(trends.map((x) => x.keyword).filter((k) => typeof k === 'string' && wordsOf(k).some((w) => w.length >= 3 && own.has(w))))];
      const queries = typeof related === 'function' ? SHEET.relatedOf(row, related, { audience: row.audience || 'US', people: about.people, tags: about.tags, heads: D.headlinesOf(row) }) : [];
      const s = row.kind === 'sound' && row.platform && row.platform.sound ? row.platform.sound : null;
      cards.set(row.id, {
        id: row.id, title: titleOf(row), line: row.line || '', kind: row.kind, tier: row.kind === 'talk' && row.tier ? row.tier : null,
        people: about.people.map((p) => ({ name: p.name, role: p.role || null })), topic: about.topic || null,
        sound: row.kind === 'sound' ? { id: s && /^\d{5,25}$/.test(String(s.id || '')) ? String(s.id) : null, ...soundParts(row.title) } : null,
        tags: about.tags, searches, queries, rank: i + 1, lists: 1, audiences: new Set([audience]),
      });
    });
  }
  return [...cards.values()];
}

/**
 * The cycle's graph: { relatedOf(id) -> [entry], duplicates: [[id, id]] (two rows that tell one event: the desk's to merge), stats }. Never throws: a graph that fails leaves every detail without the field, and
 * a state that does not read or write costs the chapters and the lookups alone.
 * input: { t, db (the state, for the chapters and the lookups; null: neither), rowsByAudience, has (id -> listed this cycle),
 * roster (the creators' roster lib/describe.js reads), related, titleOf, entityRoster (lib/entity/roster.js; default the file) }.
 */
function forCycle({ t, db = null, rowsByAudience, has, roster = null, related = null, titleOf, entityRoster } = {}) {
  const started = process.hrtime.bigint();
  const loaded = entityRoster === undefined ? ER.load() : { roster: entityRoster, ms: 0 };
  const stats = { rosterMs: Math.round(loaded.ms * 10) / 10, roster: !!loaded.roster, cards: 0, related: 0, joins: { person: 0, work: 0, sound: 0, query: 0 }, chapters: 0, wanted: 0, duplicates: 0, ms: 0 };
  let duplicates = [];
  const done = (out) => { stats.ms = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10; return { relatedOf: (id) => out.get(id) || [], duplicates, stats }; };
  let cards;
  let links;
  let nodes;
  try {
    cards = cardsOf(rowsByAudience, { has, roster, related, titleOf });
    ({ related: links, nodes, duplicates } = G.relate(cards, { roster: loaded.roster, looked: db ? LK.lookedIn(db) : () => null }));
    stats.duplicates = duplicates.length;
  } catch (e) {
    stats.error = e.message;
    return done(new Map());
  }
  const listed = new Set(cards.map((c) => c.id));
  const out = new Map();
  for (const c of cards) {
    const live = links.get(c.id) || [];
    let chapters = [];
    if (db) { try { chapters = chaptersOf(db, c, nodes.get(c.id), { t, listed }); } catch (e) { stats.error = e.message; } }
    const rows = [...live.slice(0, G.MAX_RELATED - chapters.length), ...chapters].map((x) => ({ ...x, via: short(x.via) }));
    if (rows.length) out.set(c.id, rows);
    stats.related += live.length ? 1 : 0;
    stats.chapters += chapters.length;
    for (const x of live) stats.joins[x.kind] = (stats.joins[x.kind] || 0) + 1;
  }
  stats.cards = cards.length;
  if (db) {
    try {
      ST.recordSeen(db, t, cards.map((c) => ({ id: c.id, title: c.title, nodes: nodes.get(c.id).filter((n) => n.kind !== 'sound') })));
      const wanted = [];
      for (const c of cards.slice().sort((a, b) => a.rank - b.rank)) for (const n of nodes.get(c.id)) if (n.absent && n.key && !wanted.some((w) => w.key === n.key)) wanted.push({ key: n.key, name: n.via });
      ST.want(db, t, wanted.slice(0, WANTED_MAX));
      stats.wanted = Math.min(wanted.length, WANTED_MAX);
    } catch (e) { stats.error = e.message; }
  }
  return done(out);
}

/**
 * A card's chapter: the newest other story one of its people (its subject first) or its subject was listed in, that is no longer
 * listed (CHAPTER_QUIET) and began before this one, inside CHAPTER_WITHIN: [{ id: null, title, via, kind, at }], MAX_CHAPTERS at most.
 */
function chaptersOf(db, card, nodes, { t, listed }) {
  const firstHere = ST.firstListed(db, card.id) ?? t;
  const out = [];
  const crossing = nodes.filter((n) => (n.kind === 'person' || n.kind === 'work') && (n.qid || n.name)).sort((a, b) => Number(b.subject) - Number(a.subject));
  for (const n of crossing) {
    const earlier = ST.storiesOf(db, n, { exceptId: card.id, since: t - CHAPTER_WITHIN, until: t - CHAPTER_QUIET })
      .filter((s) => !listed.has(s.id) && s.firstT < firstHere && s.title && !G.restates(s.title, card.title) && fold(s.title) !== fold(card.title));
    if (!earlier.length) continue;
    const s = earlier[0];
    if (!out.some((x) => fold(x.title) === fold(s.title))) out.push({ id: null, title: s.title, via: n.via, kind: n.kind, at: instant(s.lastT) });
    if (out.length >= MAX_CHAPTERS) break;
  }
  return out;
}

module.exports = { forCycle, cardsOf, chaptersOf, soundParts, ROWS_READ, CHAPTER_QUIET, MAX_CHAPTERS, WANTED_MAX };
