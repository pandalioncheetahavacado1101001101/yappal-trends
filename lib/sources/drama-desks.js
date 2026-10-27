'use strict';
/*
 * Two more outlets read at their own address for people-drama (ios/IDEAS-FEED.md L7, beside lib/sources/press.js): The Jasmine
 * Brand (Black-culture celebrity and influencer news, where an influencer's own row broke with no other outlet in the 72-hour audit
 * of 2026-10-27) and PopCulture.com (a celebrity desk that printed a co-star's claim almost three hours before the outlets already
 * read). Keyless, ordinary RSS feeds their robots.txt allows; each read once an hour, one of them a cycle at most.
 *
 * Their rows are the press outlets' rows exactly (lib/sources/press.js `rows`: a headline with its outlet and its own time, talking
 * points only, nothing older than four days), read by the same reader (kind 'press'), so a line taken from one stays in reported
 * wording and names its outlet. They are press: they widen and time the coverage, they are never creator-native signals.
 *
 * The audit's other candidates, and why not: a British tabloid's showbiz feed carried the most stories first, but its robots.txt
 * shuts out AI agents (our lines are written from headlines by a model); a gossip site carried one story nobody else had, from a
 * source with a record of invented stories; a games desk was first on one death by an hour and a half and is otherwise games.
 *
 * Not wired into collect.js: two paired A/Bs (2026-10-27: five recorded cycles replayed with and without them, twice) moved no story
 * of the drama audit on or off a list and one page-one row in twenty-five. They add rows to the store, not to the lists.
 */
const { request } = require('./fixed');
const { HOUR } = require('../util');

const DESKS = [
  { id: 'desk-jasminebrand', label: 'The Jasmine Brand', url: 'https://thejasminebrand.com/feed/', shape: 'rss', every: HOUR },
  { id: 'desk-popculture', label: 'PopCulture.com', url: 'https://popculture.com/rss', shape: 'rss', every: HOUR },
];
const PER_CYCLE = 1;

const deskOf = (id) => DESKS.find((d) => d.id === id) || null;
/** The desks due this cycle: not read for an hour, the one read longest ago first, `n` at most. lastReadAt: Map(id -> epoch seconds). */
function due(lastReadAt = new Map(), now = 0, n = PER_CYCLE) {
  return DESKS.map((d, i) => ({ d, i, at: lastReadAt.get(d.id) ?? -Infinity })).filter((x) => now - x.at >= x.d.every)
    .sort((a, b) => a.at - b.at || a.i - b.i).slice(0, n).map((x) => x.d);
}
/** One desk's feed, read as an outlet's (lib/ingest.js `press`). */
const deskRequest = (d) => request({ id: d.id, source: d.id, kind: 'press', args: { outlet: d.id }, url: d.url, file: `${d.id}.xml`, tier: 2 });
/** This cycle's desk requests (collect.js, beside the press outlets' in the second round). lastReadAt: Map(id -> epoch seconds). */
const requests = (lastReadAt, now) => due(lastReadAt, now).map(deskRequest);

module.exports = { DESKS, PER_CYCLE, due, deskRequest, deskOf, requests };
