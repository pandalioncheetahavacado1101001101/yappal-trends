'use strict';
/*
 * The live lookups of the entity graph (P14, B2): a name the roster does not hold (a full name off a card, never a one-word one)
 * gets one Wikidata search, keyless, and the items that match it exactly get one batched question: is it a human, and how many
 * Wikipedia sitelinks does it have. The answer is kept 30 days in the state (lib/entity/store.js). The graph then reads it: the best
 * exact match (the most sitelinks) a human gives the name that QID; no human under it makes the "person" a thing (a park, a show, a
 * country: 11% of GDELT's person names are not people, and a live check like this one removes 42% of them while losing 1.5% of real
 * names, data/knowledge/wikidata.md finding 4); no exact match leaves the name as it was, a full name that crosses by itself.
 *
 * Polite, as Wikimedia asks: the collector's one user agent with a contact (nothing is sent without one), at most SEARCHES_PER_CYCLE
 * searches and one batched query a cycle, through the cycle's own budget and back-off (lib/fetch.js send). A refusal is not kept:
 * the name is asked again a later cycle.
 */
const { hash32 } = require('../util');
const { request } = require('../sources/fixed');
const ST = require('./store');
const { fold } = require('./fold');

const SOURCE = 'entity-wikidata';
const SEARCH = 'https://www.wikidata.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';
const SEARCHES_PER_CYCLE = 3;
const SEARCH_LIMIT = 7;
// the items one batched question asks about (each name brings up to SEARCH_LIMIT exact matches; the query stays a short GET)
const IDS_PER_QUERY = 40;
const CONTACT = /\(\+.+\)/;
const QID = /^Q[1-9]\d{0,11}$/;

const qs = (params) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const searchUrl = (name) => `${SEARCH}?${qs({ action: 'wbsearchentities', search: name, language: 'en', uselang: 'en', type: 'item', limit: SEARCH_LIMIT, format: 'json' })}`;
const sparqlOf = (ids) => `SELECT ?i ?h ?s WHERE { VALUES ?i { ${ids.map((q) => `wd:${q}`).join(' ')} } BIND(EXISTS { ?i wdt:P31 wd:Q5 } AS ?h) OPTIONAL { ?i wikibase:sitelinks ?s } }`;
const sparqlUrl = (ids) => `${SPARQL}?${qs({ format: 'json', query: sparqlOf(ids) })}`;

const searchRequest = (key, name) => request({ id: `entity-search-${hash32(key, 10)}`, source: SOURCE, kind: 'entity-search', args: { key }, url: searchUrl(name),
  file: `entity-search-${hash32(key, 10)}.json`, tier: 3 });
const classifyRequest = (ids) => request({ id: `entity-classify-${hash32(ids.join('|'), 8)}`, source: SOURCE, kind: 'entity-classify', args: { ids }, url: sparqlUrl(ids),
  file: `entity-classify-${hash32(ids.join('|'), 8)}.json`, tier: 3, init: { headers: { Accept: 'application/sparql-results+json' } } });

/** A search's exact matches for the folded key: [{ id, label }], or null when the reply does not read. */
function parseSearch(text, key) {
  let js;
  try { js = JSON.parse(text); } catch { return null; }
  if (!js || !Array.isArray(js.search)) return null;
  return js.search.filter((s) => s && QID.test(String(s.id || '')))
    .filter((s) => fold(s.label) === key || fold(s.match && s.match.text) === key)
    .map((s) => ({ id: s.id }));
}
/** The batched answer: Map(qid -> { human, sitelinks }), or null when the reply does not read. */
function parseClassify(text) {
  let js;
  try { js = JSON.parse(text); } catch { return null; }
  const rows = js && js.results && Array.isArray(js.results.bindings) ? js.results.bindings : null;
  if (!rows) return null;
  const out = new Map();
  for (const b of rows) {
    const id = String((b.i && b.i.value) || '').split('/').pop();
    if (!QID.test(id)) continue;
    const human = String((b.h && b.h.value) || '') === 'true';
    const sitelinks = Number((b.s && b.s.value) || 0);
    const had = out.get(id);
    out.set(id, { human: human || !!(had && had.human), sitelinks: Math.max(Number.isFinite(sitelinks) ? sitelinks : 0, had ? had.sitelinks : 0) });
  }
  return out;
}
/** A name's answer from its exact matches and what the batch said of them: { qid, human, sitelinks } of the best, or { qid: null }. */
function decide(hits, classes) {
  const known = hits.filter((h) => classes.has(h.id)).map((h) => ({ id: h.id, ...classes.get(h.id) }));
  if (!known.length) return { qid: null };
  const best = known.sort((a, b) => b.sitelinks - a.sitelinks || (a.id < b.id ? -1 : 1))[0];
  return { qid: best.id, human: best.human, sitelinks: best.sitelinks };
}

/** The graph's reader of what is held: (folded name) => { qid, human } once a name is done, else null (and null when the state does not read). */
const lookedIn = (db) => (key) => {
  try {
    const r = ST.lookup(db, key);
    return r && r.state === 'done' && r.result ? r.result : null;
  } catch { return null; }
};

/**
 * One cycle's lookups: the batched question for every name already searched, then up to SEARCHES_PER_CYCLE new searches, then the
 * question for those. send(requests) -> results as lib/fetch.js send gives them; booked(result) books each in the cycle's ledger.
 * Returns { searched, classified, sent, why? }.
 */
async function step({ db, now, send, agent, log = () => {}, booked = () => {}, searches = SEARCHES_PER_CYCLE }) {
  ST.ensure(db);
  if (!CONTACT.test(agent || '')) { log('[entity] no contact in the user agent (IDEAS_UA_CONTACT): Wikimedia asks for one, nothing sent'); return { searched: 0, classified: 0, sent: 0, why: 'no contact' }; }
  let sent = 0;
  let searched = 0;
  let classified = 0;
  const classify = async () => {
    const waiting = ST.inState(db, 'searched', IDS_PER_QUERY);
    const ids = [];
    const names = [];
    for (const w of waiting) {
      const hits = (w.result && w.result.hits) || [];
      if (ids.length + hits.length > IDS_PER_QUERY && names.length) break;
      names.push(w);
      for (const h of hits) if (!ids.includes(h.id)) ids.push(h.id);
    }
    if (!names.length) return;
    // (no exact match at all: nothing to ask, the answer is "nobody")
    const none = names.filter((w) => !((w.result && w.result.hits) || []).length);
    for (const w of none) { ST.setLookup(db, w.key, 'done', now, { qid: null }); classified += 1; }
    if (!ids.length) return;
    const results = await send([classifyRequest(ids)]);
    sent += results.length;
    for (const r of results) booked(r);
    const answer = results[0] && results[0].status === 200 ? parseClassify(results[0].text) : null;
    if (!answer) return;
    for (const w of names.filter((x) => !none.includes(x))) { ST.setLookup(db, w.key, 'done', now, decide(w.result.hits, answer)); classified += 1; }
  };
  await classify();
  const wanted = ST.inState(db, 'wanted', searches);
  if (wanted.length) {
    const results = await send(wanted.map((w) => searchRequest(w.key, w.name)));
    sent += results.length;
    for (const r of results) {
      booked(r);
      const key = r.request.args && r.request.args.key;
      const hits = r.status === 200 ? parseSearch(r.text, key) : null;
      if (hits) { ST.setLookup(db, key, 'searched', now, { hits }); searched += 1; }
    }
    if (searched) await classify();
  }
  if (sent) log(`[entity] ${searched} names searched on Wikidata, ${classified} answered (${sent} requests)`);
  return { searched, classified, sent };
}

module.exports = { step, lookedIn, parseSearch, parseClassify, decide, searchUrl, sparqlUrl, searchRequest, classifyRequest, SOURCE, SEARCHES_PER_CYCLE, IDS_PER_QUERY, CONTACT };
