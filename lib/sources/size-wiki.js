'use strict';
/*
 * Wikipedia for the size series (lib/size; ios/.review/trend-size-scale.md): which page a trend's subject has, which former titles
 * carry its history, and its daily views. All keyless: the MediaWiki Action API (en.wikipedia.org/w/api.php) for the search, the
 * redirects and the titles; the Wikimedia REST pageviews API (wikimedia.org/api/rest_v1) for the views, one title a request over
 * any range of days.
 *
 * The views API is its own service with its own limits (the Action API is what answered 429 in M6), so its requests are their own
 * host group here; the next wave sets its cap. Requests are { id, source, kind, args, url, host, file, tier } as lib/fetch.js sends
 * them; replies are read by the parsers below.
 */
const { request } = require('./fixed');
const { keyOf, hash32 } = require('../util');
const D = require('../size/days');
const { restTitle } = require('../size/wiki');

const SOURCE = 'size-wiki';
const ACTION = 'https://en.wikipedia.org/w/api.php';
const VIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user';
const VIEWS_HOST = 'wikimedia.org/pageviews';
const SEARCH_LIMIT = 6;
const SEARCH_DAYS = 30;
const MOVES_CATEGORY = 'Category:Redirects from moves';
// the titles of one subject read for its views: the article and the former titles a move left behind (the other redirects add 1-2%)
const TITLES_PER_SUBJECT = 5;
const INFO_BATCH = 50;
const TIER = 3;

const qs = (params) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const actionUrl = (params) => `${ACTION}?${qs({ action: 'query', format: 'json', formatversion: 2, ...params })}`;

/** A subject's lookup: a search whose results carry their short description, whether each is a disambiguation page, and 30 days of views. */
const searchUrl = (query) => actionUrl({ generator: 'search', gsrsearch: query, gsrlimit: SEARCH_LIMIT, gsrnamespace: 0, prop: 'description|pageprops|pageviews', ppprop: 'disambiguation', pvipdays: SEARCH_DAYS });
/** Every redirect to a page (by its id, which a move does not change), with whether a move left it. */
const redirectsUrl = (pageid) => actionUrl({ pageids: pageid, generator: 'redirects', grdlimit: 'max', grdnamespace: 0, prop: 'categories', clcategories: MOVES_CATEGORY, cllimit: 'max' });
/** Pages' current titles, 50 a request (a page moved since it was found is read under its new title). */
const infoUrl = (pageids) => actionUrl({ pageids: pageids.join('|'), prop: 'info' });
/** One title's daily views from `from` to `to` (days, both included). */
const viewsUrl = (title, from, to) => `${VIEWS}/${restTitle(title)}/daily/${D.compact(from)}00/${D.compact(to)}00`;

const searchRequest = (subject) => request({ id: `size-search-${hash32(subject.query, 10)}`, source: SOURCE, kind: 'size-search', args: { subject: subject.id, query: subject.query },
  url: searchUrl(subject.query), file: `size-search-${hash32(subject.query, 10)}.json`, tier: TIER });
const redirectsRequest = (pageid) => request({ id: `size-redirects-${pageid}`, source: SOURCE, kind: 'size-redirects', args: { pageid }, url: redirectsUrl(pageid), file: `size-redirects-${pageid}.json`, tier: TIER });
const infoRequest = (pageids) => request({ id: `size-info-${hash32(pageids.join('|'), 8)}`, source: SOURCE, kind: 'size-info', args: { pageids }, url: infoUrl(pageids), file: `size-info-${hash32(pageids.join('|'), 8)}.json`, tier: TIER });
const viewsRequest = (title, from, to) => request({ id: `size-views-${hash32(`${title}|${from}|${to}`, 10)}`, source: SOURCE, kind: 'size-views', args: { title, from, to },
  url: viewsUrl(title, from, to), host: VIEWS_HOST, file: `size-views-${hash32(title, 10)}-${D.compact(from)}-${D.compact(to)}.json`, tier: TIER });

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

/**
 * A search reply -> [{ pageid, title, description, disambiguation, index, views: Map(day -> views or null) }] in the search's own
 * order; null when the reply is not one. (A view count the API has not filled in yet is null: unknown, never zero.)
 */
function parseSearch(text) {
  const j = json(text);
  if (!j || (j.error && !j.query)) return null;
  const pages = (j.query && j.query.pages) || [];
  return pages.filter((p) => p && !p.missing && Number.isFinite(p.pageid)).map((p) => ({
    pageid: p.pageid, title: p.title, description: p.description || '', disambiguation: !!(p.pageprops && 'disambiguation' in p.pageprops), index: p.index || 0,
    views: p.pageviews ? new Map(Object.entries(p.pageviews).map(([d, v]) => [d, Number.isFinite(v) ? v : null])) : null,
  })).sort((a, b) => a.index - b.index);
}

/** A redirects reply -> [{ title, fromMove }]; null when the reply is not one. */
function parseRedirects(text) {
  const j = json(text);
  if (!j || (j.error && !j.query)) return null;
  const pages = (j.query && j.query.pages) || [];
  return pages.filter((p) => p && p.title && !p.missing).map((p) => ({ title: p.title, fromMove: Array.isArray(p.categories) && p.categories.some((c) => c.title === MOVES_CATEGORY) }));
}

/** An info reply -> Map(pageid -> current title); a page gone is left out. */
function parseInfo(text) {
  const j = json(text);
  const pages = (j && j.query && j.query.pages) || [];
  return new Map(pages.filter((p) => p && !p.missing && Number.isFinite(p.pageid)).map((p) => [p.pageid, p.title]));
}

/**
 * The titles a subject's views are read under: the page's own, then the former titles a move left that carry its name, the most like
 * it first; TITLES_PER_SUBJECT at most.
 */
function titlesOf(canonical, redirects) {
  const own = keyOf(canonical);
  const moved = (redirects || []).filter((r) => r.fromMove && r.title !== canonical);
  // (the page's own name with a qualifier first, "6-7 (meme)"; then a name holding it; then the rest)
  const near = (t) => { const base = keyOf(t.replace(/\s*\([^)]*\)\s*$/, '')); const k = keyOf(t); return base === own ? 0 : k.includes(own) || own.includes(base) ? 1 : 2; };
  // (a former title that shares nothing with the page's name is another subject merged into it: a singer's page holds her old
  // residency's page as a move, and its views are the residency's)
  return [canonical, ...moved.filter((r) => near(r.title) < 2).sort((a, b) => near(a.title) - near(b.title)).map((r) => r.title)].slice(0, TITLES_PER_SUBJECT);
}

module.exports = { SOURCE, VIEWS_HOST, SEARCH_LIMIT, TITLES_PER_SUBJECT, INFO_BATCH, searchUrl, redirectsUrl, infoUrl, viewsUrl, searchRequest, redirectsRequest, infoRequest, viewsRequest,
  parseSearch, parseRedirects, parseInfo, titlesOf };
