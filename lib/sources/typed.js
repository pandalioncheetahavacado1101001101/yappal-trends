'use strict';
/*
 * What people type into a search box about a word, a trend or a thing to buy, with nothing handed in (ios/IDEAS-FEED.md M7):
 * Google's completions for templates that leave the term open ("what does * mean slang", "what is the * trend on tiktok", "ai
 * trend "), and Google Shopping's for what shoppers call viral and what they want a dupe of ("viral ", "dupe ", with `ds=sh`).
 * Keyless, on the host the other completions use, three templates a cycle in turn (each every three quarters of an hour). (Shopping's box
 * for "tiktok " was probed and left out: it completes the app's own coins and gift cards.)
 *
 * A completion is a question, never an answer, with no time and no volume: it says people are asking, and what they call the
 * thing. So it is NEW only by observation (lib/native-ledger.js), and CLIMBING when it stands in its list's first five, three
 * places or more above where it stood a day before. One met at a cold start is known from then on and never new.
 */
const { request } = require('./fixed');
const ASKED = require('./asked');
const { keyOf } = require('../util');

const GOOGLE = 'https://suggestqueries.google.com/complete/search';
const PER_CYCLE = 3;
const FILL_WORDS_MAX = 4;

// Each template: what is sent (`q`), where (`ds`: Google Shopping's box), how a completion is read back (`re`: group 1 the term)
// and what kind of thing the term then is: a word, a trend (a format people film), an AI trend or a product.
const TEMPLATES = [
  { id: 'means', kind: 'word', q: 'what does ', re: /^what does (.+?) mean(?: in (?:text|texting|slang)| on (?:tiktok|snapchat|instagram))?$/ },
  { id: 'means-slang', kind: 'word', q: 'what does * mean slang', re: /^what does (.+?) mean (?:in )?slang$/ },
  { id: 'means-tiktok', kind: 'word', q: 'what does * mean on tiktok', re: /^what does (.+?) mean on tiktok$/ },
  { id: 'means-genz', kind: 'word', q: 'what does * mean gen z', re: /^what does (.+?) mean (?:in )?gen z$/ },
  { id: 'trend-is', kind: 'trend', q: 'what is the * trend on tiktok', re: /^what is the (.+?) trend on tiktok$/ },
  { id: 'trend', kind: 'trend', q: 'tiktok trend ', re: /^tiktok trend (.+)$/ },
  { id: 'ai', kind: 'ai', q: 'ai trend ', re: /^ai trend (.+)$/ },
  { id: 'shop-viral', kind: 'product', ds: 'sh', q: 'viral ', re: /^viral (.+)$/ },
  { id: 'shop-dupe', kind: 'product', ds: 'sh', q: 'dupe ', re: /^(.+?) dupes?$|^dupes? (?:for )?(.+)$/ },
];
const templateOf = (id) => TEMPLATES.find((t) => t.id === id) || null;
const enc = (q) => encodeURIComponent(q).replace(/%20/g, '+').replace(/%2A/g, '*');

/** The templates asked this cycle: the next `n` after `cursor`, in turn. Returns { requests, cursor }. */
function requests(cursor = 0, n = PER_CYCLE) {
  const start = ((cursor % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length;
  const picked = Array.from({ length: Math.min(n, TEMPLATES.length) }, (_, i) => TEMPLATES[(start + i) % TEMPLATES.length]);
  return { cursor: (start + picked.length) % TEMPLATES.length,
    requests: picked.map((t) => request({ id: `typed-${t.id}`, source: 'typed', kind: 'typed', args: { template: t.id },
      url: `${GOOGLE}?client=chrome&hl=en&gl=us${t.ds ? `&ds=${t.ds}` : ''}&q=${enc(t.q)}`, file: `typed-${t.id}.json`, tier: 2 })) };
}

// a fill that names nothing: the question's own filler, a word about the list itself, a place to buy
const GENERIC = { word: /^(?:this|that|it|the|a|an|mean|slang|word|emoji|\W+|you|i|he|she|they)$/,
  trend: /^(?:new|newest|latest|best|longest|biggest|current|top|first|this|that|right now|songs?|dances?|music|ideas?|tracker|discovery|games?|reviewer|video|videos|documentary|report|\d{4}|songs? \d{4}|on tiktok|today|now|sounds?)$/,
  ai: /^(?:photos?|video|videos|video maker|prompts?|photo prompts?|spotter|slope|forecasting|report|right now|on (?:facebook|instagram|tiktok)|s|trends?|tools?|app|apps|generator|free|\d{4}|today|now|news|analysis|micro)$/,
  product: /^(?:products?|items?|stuff|things?|shop|store|finds|gifts?|deals?|sale|near me|amazon|walmart|target|video|videos|tiktok|shop|made me buy it)$/ };
const NEAR_ME = /\s+near me$|\s+(?:amazon|walmart|target|costco|reddit|review|reviews)$/;

/**
 * What a completion names: { template, kind, term (as typed, lower case), key } or null when it does not fit its template or its
 * fill names nothing (the question's own filler, more than four words, a number alone that is no word).
 */
function fillOf(templateId, completion) {
  const t = templateOf(templateId);
  if (!t) return null;
  const m = String(completion || '').toLowerCase().trim().match(t.re);
  if (!m) return null;
  let term = (m[1] || m[2] || '').replace(NEAR_ME, '').trim();
  // ("what does 6 7 mean": a number said as slang is one term)
  if (t.kind === 'word' && /^\d(?: \d)+$/.test(term)) term = term.replace(/ /g, '');
  const key = keyOf(term);
  // (a trend or a thing of one or two letters names nothing; a number does: "the 67 trend")
  if (!key || key.split(' ').length > FILL_WORDS_MAX || GENERIC[t.kind].test(key) || (t.kind !== 'word' && key.length < 3 && !/^\d{2}$/.test(key))) return null;
  return { template: t.id, kind: t.kind, term, key };
}

module.exports = { TEMPLATES, PER_CYCLE, templateOf, requests, fillOf, parse: ASKED.parse };
