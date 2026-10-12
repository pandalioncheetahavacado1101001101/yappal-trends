'use strict';
/*
 * Pinterest Trends' growing searches in the US (ios/IDEAS-FEED.md M8): fifty terms with how each moved on the week, the month and
 * the year before. The call behind Pinterest's own public trends tool, keyless and undocumented; the data is weekly, read once a day.
 *
 * It is a second opinion on a thing people make or buy: a term here that a shopping search also completes is two lists agreeing.
 * Most of what it holds is the calendar ("october nails", "happy october") and that is left out; so is anything that reads as a
 * person's name. Pinterest turns some cloud addresses away: then this is silent and costs nothing.
 */
const { request } = require('./fixed');
const W = require('../../engine/wording');
const { DAY, keyOf } = require('../util');

const API = 'https://trends.pinterest.com/top_trends_filtered/';
const EVERY = DAY;
const TERMS = 50;
const TERM_WORDS_MAX = 5;
// the calendar and its greetings, a year, a caption to copy: every year's, nobody's trend
const SEASONAL = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|octubre|noviembre|diciembre|halloween|christmas|thanksgiving|easter|hoco|homecoming|prom|happy|hello|welcome|bienvenido|national \w+ day|20\d\d|captions?|quotes?|images?|wallpapers?|calendar|bulletin|bulliten)\b/i;

/** The list, asked once a day. `endDate` is required and snaps to the last weekly close. lastReadAt: epoch seconds or undefined. */
const pinterestRequest = (lastReadAt, now) => (Number.isFinite(lastReadAt) && now - lastReadAt < EVERY ? null
  : request({ id: 'pinterest-trends', source: 'pinterest', kind: 'pinterest', args: {},
    url: `${API}?endDate=${new Date(now * 1000).toISOString().slice(0, 10)}&country=US&trendsPreset=3&normalizeAgainstGroup=None&lookbackWindow=1&numTermsToReturn=${TERMS}`, file: 'pinterest-trends.json', tier: 3 }));

const change = (x) => (x && Number.isFinite(Number(x.value)) ? Number(x.value) : null);
/**
 * The reply as { week ("2026-10-05": the week it closes on), terms: [{ term, week, month, year (each the change on that span, as
 * Pinterest gives it; its 100 is "at least doubled") }] } without the calendar's terms and without names; null when it is not that reply.
 */
function parse(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || !Array.isArray(j.values)) return null;
  const terms = [];
  for (const v of j.values) {
    const term = String((v && v.term) || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const ws = keyOf(term).split(' ').filter(Boolean);
    // (a word no dictionary knows may be somebody's name: a list of things is read here, never people)
    if (!term || !ws.length || ws.length > TERM_WORDS_MAX || SEASONAL.test(term) || !ws.every((w) => W.inDict(w) || /^\d+$/.test(w))) continue;
    terms.push({ term, week: change(v.wow_change), month: change(v.mom_change), year: change(v.yoy_change) });
  }
  return { week: /^\d{4}-\d\d-\d\d$/.test(String(j.endDate || '')) ? j.endDate : null, terms };
}

module.exports = { pinterestRequest, parse, EVERY };
