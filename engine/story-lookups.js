'use strict';
/*
 * Story step, units and lookups: which listed moments are one story (the same main name plus a second name both carry), each
 * story's main name, and the two story searches a refresh makes for it: a Google News search for the name over 14 days (a busy
 * name like Trump with the headline's second name or rarest word, a nameless moment by its quoted phrase or role noun) and a
 * Wikipedia search with the second name the moment's coverage carries. Plain string/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const { contains, uniqByKey } = require('./util');
const {
  DAY, HOUR, CONTEXT_DROPS, ROLE_WORDS, ANGLE_STOP, stem, words, readyItem, surfaceOf, sameName, nameLike, trimName,
} = require('./story-terms');

const DEEP_MAX = 30; // story lookups per refresh, at most one per listed moment (30 at most): Google News searches for the names
const WIKI_STORY_MAX = 8; // and Wikipedia searches (Wikimedia throttled an unregistered app after ten in 20 s; the rest wait a refresh)
const DEEP_TTL = 20 * HOUR;
const WIKI_STORY_TTL = 3 * DAY;

/** The story's main name: the cluster's main name when its headline names it, else the name its headline opens with. */
function anchorOf(c, lex) {
  const hw = words(c.headline).join(' ');
  // a plain word the lexicon picked up as a name ("money") is no main name; a one-word name the headline capitalises is ("LongHorn")
  const capitalised = (e) => c.headline.split(/\s+/).some((w, i) => words(w)[0] === e && (/\p{Ll}\p{Lu}/u.test(w) || (i > 0 && /^\p{Lu}/u.test(w) &&
    !W.isTitleCase(c.headline.split(/\s+/)))));
  const anchorLike = (e) => nameLike(e) && !(!e.includes(' ') && W.isDictWord(e) && !lex.proper.has(e) && !capitalised(e));
  const inHeadline = [...c.entSet].filter((e) => anchorLike(e) && contains(hw, e));
  if (c.topEnt && anchorLike(c.topEnt) && contains(hw, c.topEnt)) return trimName(c.topEnt, lex);
  if (inHeadline.length) {
    const first = inHeadline.sort((a, b) => hw.indexOf(a) - hw.indexOf(b) || b.length - a.length)[0];
    return trimName(first, lex);
  }
  return null;
}

function namesCount(items) {
  const m = new Map();
  for (const it of uniqByKey(items)) for (const n of it.allNames) m.set(n, (m.get(n) || 0) + 1);
  return m;
}

/**
 * A later moment joins an earlier one when both have the same main name and a second name both carry (not a busy one):
 * "Ed Sheeran's shows at Robert Kraft's Gillette Stadium are canceled" joins the SNL UK roast through "Macklemore".
 */
function mergeUnits(top, lex, busy) {
  const units = [];
  for (const c of top) {
    c.items.forEach((it) => readyItem(it, lex));
    const anchor = anchorOf(c, lex);
    const names = namesCount(c.items);
    const unit = anchor && units.find((u) => u.anchor && sameName(u.anchor, anchor) && [...names.keys()].some((n) =>
      !sameName(n, anchor) && !contains(n, anchor) && !contains(anchor, n) && nameLike(n) && !busy(n) && u.names.has(n)));
    if (unit) {
      unit.clusters.push(c);
      for (const [n, k] of names) unit.names.set(n, (unit.names.get(n) || 0) + k);
    } else {
      units.push({ anchor, clusters: [c], names });
    }
  }
  return units;
}
const slug = (q) => words(q).join('').slice(0, 60);

/** A headline's content words, cleaned, with their stems ("Trump, 80, Gets Loudly Booed" -> gets, loudly, booed, ...). */
function headlineWords(headline) {
  return headline.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/, ''))
    .filter((w) => w && /\p{L}/u.test(w)).map((w) => ({ w, k: words(w).join(''), s: stem(words(w).join('')) }))
    .filter((x) => x.k.length >= 3 && !W.STOP.has(x.k) && !W.GENERIC.has(x.k));
}

/** The rarest story word of a headline (by the corpus' own word counts), not a frame or filler word. */
function rarestWord(headline, skip, idf) {
  return headlineWords(headline).filter((x) => !ANGLE_STOP.has(x.s) && !skip.has(x.k) && !/^\d/.test(x.k))
    .sort((a, b) => idf(b.s) - idf(a.s) || a.k.localeCompare(b.k))[0] || null;
}

/**
 * The news search for a story: its main name; a busy name (Trump) with the headline's second name or its rarest word ("booed");
 * a name made of plain words ("Last Ditch") with the headline word after it ("bar"); a nameless moment by its quoted phrase or
 * role noun and its rarest words. The Wikipedia search adds the second name the moment's coverage carries.
 */
function lookupQuery(unit, busy, idf) {
  const c = unit.clusters[0];
  const members = uniqByKey(unit.clusters.flatMap((x) => x.items));
  const hw = words(c.headline).join(' ');
  if (unit.anchor) {
    const E = unit.anchor;
    const main = `"${surfaceOf(E, members).replace(/’/g, "'")}"`;
    const eParts = new Set(E.split(' '));
    const second = [...c.entSet].filter((n) => !sameName(n, E) && !contains(n, E) && !contains(E, n) && nameLike(n) && contains(hw, n) &&
      !n.split(' ').every((w) => W.isDictWord(w)))[0]; // "college football game" is not a name to search for
    const partner = second ? surfaceOf(second, members) : partnerOf(unit, members, busy);
    if (unit.busy) {
      const rare = second ? null : rarestWord(c.headline, eParts, idf);
      const extra = second ? `"${surfaceOf(second, members)}"` : rare ? rare.w.toLowerCase() : '';
      return { gn: `${main} ${extra}`.trim(), wiki: `${main} ${second ? surfaceOf(second, members) : extra}`.trim(), specific: false };
    }
    if (E.split(' ').every((w) => W.isDictWord(w))) { // "last ditch" is also a phrase: "Last Ditch" bar
      const after = headlineWords(c.headline).find((x) => !eParts.has(x.k) && !ANGLE_STOP.has(x.s));
      const q = after ? `${main} ${after.w.toLowerCase()}` : main;
      return { gn: q, wiki: q };
    }
    // "Jennifer Lopez lookalike’s mugshot": the story is the lookalike, not Jennifer Lopez
    const hws = words(c.headline);
    const at = hws.findIndex((w, i) => hws.slice(i, i + E.split(' ').length).join(' ') === E);
    const role = at >= 0 ? hws[at + E.split(' ').length] : null;
    const withRole = role && ROLE_WORDS.has(role) ? `${main} ${role}` : null;
    const saga = partnerOf(unit, members, busy) || partner;
    return { gn: withRole || main, wiki: withRole || (saga ? `${main} ${saga}` : main), specific: !!withRole };
  }
  const phrase = c.topPseudo ? c.topPseudo.slice(2) : '';
  const skip = new Set(words(phrase));
  const rare = headlineWords(c.headline).filter((x) => c.hooks.includes(x.s) && !skip.has(x.k)).slice(0, 1).map((x) => x.w.toLowerCase());
  rare.forEach((w) => skip.add(words(w).join('')));
  for (let i = rare.length; i < (phrase ? 1 : 3); i++) {
    const r = rarestWord(c.headline, skip, idf);
    if (!r) break;
    rare.push(r.w.toLowerCase());
    skip.add(r.k);
  }
  const q = [phrase ? `"${phrase}"` : '', ...rare].filter(Boolean).join(' ');
  return q ? { gn: q, wiki: null, specific: !!phrase } : null;
}

/**
 * The second name most of the moment's coverage carries, not a busy one; or the saga's partner, the name a third of the main
 * name's saved items (its own news search's rows included: see story.js buildStories) also carry, when the moment names it at all
 * (the SNL UK roast names Macklemore once, Ed Sheeran's news half the time).
 */
function partnerOf(unit, members, busy) {
  const ok = (n) => !sameName(n, unit.anchor) && !contains(n, unit.anchor) && !contains(unit.anchor, n) && nameLike(n) && !busy(n);
  const co = unit.coNames;
  const saga = co ? [...unit.names.keys()].filter((n) => ok(n) && (co.get(n) || 0) >= Math.max(SAGA_PARTNER_MIN, SAGA_PARTNER_SHARE * (unit.withE || 0)))
    .sort((a, b) => co.get(b) - co.get(a) || a.localeCompare(b))[0] : null;
  const best = [...unit.names.entries()].filter(([n]) => ok(n)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const own = best && best[1] >= 2 ? best[0] : null;
  // (the saga's partner wins only when it is plainly the bigger story: twice the moment's own partner's items)
  if (saga && (!own || co.get(saga) >= 2 * (co.get(own) || 0))) return surfaceOf(saga, members);
  return own ? surfaceOf(own, members) : null;
}
const SAGA_PARTNER_MIN = 4;
const SAGA_PARTNER_SHARE = 0.3;

/**
 * The event search for a story told by the game or show it happened at: the words of its Trends query ("falcons vs packers" ->
 * falcons packers), so the context step can read the result ("35-14 home-opener loss"). One per story, from the same budget.
 */
function eventQuery(keyword) {
  const ws = words(keyword).filter((w) => !/^(vs|v)$/.test(w));
  return ws.length >= 2 ? ws.join(' ') : null;
}

/** Which stories need a fresh lookup this refresh: never-searched stories first, then stale ones, within each budget. */
function lookupTargets(units, lookups, now, stories = []) {
  const deep = [];
  const wiki = [];
  const seen = new Set();
  for (const pass of ['missing', 'stale']) {
    for (const u of units) {
      if (!u.query) continue;
      const key = `story-${slug(u.query.gn)}`;
      const l = lookups.get(key) || {};
      const want = pass === 'missing' ? !l.deepAt : l.deepAt && now - l.deepAt > DEEP_TTL;
      if (want && deep.length < DEEP_MAX && !seen.has(`d${key}`)) { seen.add(`d${key}`); deep.push({ key, query: u.query.gn }); }
      if (!u.query.wiki) continue;
      const wkey = `story-${slug(u.query.wiki)}`;
      const lw = lookups.get(wkey) || {};
      const wantW = pass === 'missing' ? !lw.wikiAt : lw.wikiAt && now - lw.wikiAt > WIKI_STORY_TTL;
      if (wantW && wiki.length < WIKI_STORY_MAX && !seen.has(`w${wkey}`)) { seen.add(`w${wkey}`); wiki.push({ key: wkey, query: u.query.wiki }); }
    }
    for (const st of stories) {
      if (!st.eventQuery) continue;
      const key = `story-${slug(st.eventQuery)}`;
      const l = lookups.get(key) || {};
      const want = pass === 'missing' ? !l.deepAt : l.deepAt && now - l.deepAt > DEEP_TTL;
      if (want && deep.length < DEEP_MAX && !seen.has(`d${key}`)) { seen.add(`d${key}`); deep.push({ key, query: st.eventQuery }); }
    }
  }
  return { deep, wiki };
}

/** Wikipedia search pages -> [{ title, desc, extract }], search order. */
function parseWikiSearch(json) {
  return (json?.query?.pages || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => ({ title: p.title, desc: p.description || '', extract: (p.extract || '').replace(/\s+/g, ' ').trim().slice(0, 600) }));
}

function lookupsFor(unit, lookups, prepareRaw, lex, universeKeys, universeByKey = null) {
  if (!unit.query) return { deep: [], articles: [] };
  const l = lookups.get(`story-${slug(unit.query.gn)}`) || {};
  const deep = [];
  for (const r of (l.deep && l.deep.rows) || []) {
    const it = prepareRaw({ key: r.url || `story|${r.title}`, title: r.title, url: r.url, t: r.t, publisher: r.publisher, publisherUrl: r.publisherUrl,
      src: 'gn-story', fam: 'gnews', label: 'Google News', w: 0.5 });
    if (it.drop && !CONTEXT_DROPS.has(it.drop)) continue;
    // a row the store already holds is the story search's too (it need not name the main name: "Maher blasts ... lesbian bar")
    if (universeKeys.has(it.key)) { if (universeByKey && universeByKey.has(it.key)) deep.push(universeByKey.get(it.key)); continue; }
    deep.push(readyItem(it, lex));
  }
  const lw = unit.query.wiki ? lookups.get(`story-${slug(unit.query.wiki)}`) || {} : {};
  return { deep: uniqByKey(deep), articles: (lw.wiki && lw.wiki.pages) || [] };
}

/** Every saved story search's rows, prepared like the store's (safety drops out, context drops kept), for the context step. */
function allStoryRows(lookups, prepareRaw, lex, universeKeys) {
  const out = [];
  for (const [key, l] of lookups) {
    if (!key.startsWith('story-') || !l.deep) continue;
    for (const r of l.deep.rows || []) {
      const it = prepareRaw({ key: r.url || `story|${r.title}`, title: r.title, url: r.url, t: r.t, publisher: r.publisher, publisherUrl: r.publisherUrl,
        src: 'gn-story', fam: 'gnews', label: 'Google News', w: 0.5 });
      if ((it.drop && !CONTEXT_DROPS.has(it.drop)) || universeKeys.has(it.key)) continue;
      out.push(readyItem(it, lex));
    }
  }
  return uniqByKey(out);
}

module.exports = {
  DEEP_MAX, WIKI_STORY_MAX, DEEP_TTL, WIKI_STORY_TTL, anchorOf, namesCount, mergeUnits, slug, headlineWords, rarestWord,
  lookupQuery, partnerOf, lookupTargets, parseWikiSearch, lookupsFor, allStoryRows, eventQuery,
};
