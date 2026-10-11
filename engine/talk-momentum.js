'use strict';
/*
 * A talking point's momentum [talking-points.js]: its Wikipedia days from the daily top-1000 lists (its own page, its film's or show's,
 * its subject's; the list an all-time box office record tops), the press's day curve (the last 24 hours against the three days
 * before and against its busiest day), and whether people type its story into YouTube's search.
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const { keyOf, DAY, WIKI_SUSTAIN_VIEWS } = require('./talk-candidates');

const { words } = W;
// momentum, from the press's day curve (the last 24 hours against the three days before, and against its busiest day) and
// Wikipedia's (the daily top 1000): a story still climbing leads ("Russia plague outbreak" 3 > 5 > 26 > 66 items a day), one back at
// its baseline sinks ("Candace Owens lesbian rumors": no item after Oct 2, her page 20K -> under the list's floor)
const RISE_MIN = 8; // items in the last 24 hours before a rise counts
const RISE_W = 0.06; // per doubling against the three days before (a story's first day is at the cap by construction: demand leads)
const RISE_LOG_CAP = 4;
const DECAY_FROM = 0.5; // the last 24 hours under this share of the busiest day: decaying
const DECAY_W = 0.4; // (a story two or three days on keeps most of its demand: its buzz lasts about 72 hours)
const DECAY_WIKI_LIVE = 0.5; // a page still read 50K+ a day halves the decay ("Christa Pike": 462K four days on)
const STALE_SHARE = 0.25;
const STALE_MULT = 0.75; // and with no live search and no page read 50K+: back at its baseline
const STALE_AGE = 3; // days since the busiest day
const STALE_SHARE_WIKI = 0.4; // the press under this share and the page back under 30% of its peak ("Jacob Geller": 31K -> under the floor)
const WIKI_LIVE_VIEWS = 50000;
const WIKI_DEAD_SHARE = 0.3; // a page read 20K+ this week now under this share of its peak
const WIKI_DEAD_PEAK = 20000;
const FADING_MULT = 0.85; // a fading card costs more than its recency alone ("Candace Owens" at 69 over the rising "Lanterns" at 52)
const NO_DEMAND_MULT = 0.8; // YouTube's completions name none of the card's story words: nobody types it ("Sass Jordan" + her songs)
const NO_DEMAND_MIN = 2;
const NO_DEMAND_FRESH = 3;
const WIKI_LOOKUP_MIN = 50000;
const WIKI_LOOKUP_SPIKE = 1.5;
const WIKI_LOOKUP_W = 0.8;

const WIKI_CURVE_DAYS = 7;
/** Every page of the saved daily top-1000 lists by its words, a "(film)" tail off: Map(key -> Map(ymd -> views)), the most read page per key; .names: Map(key -> article name). */
function wikiDaysIndex(lists) {
  const out = new Map();
  // (and each key's article name, as Wikipedia spells it: "Flydubai")
  out.names = new Map();
  for (const [day, list] of lists || []) {
    for (const [article, views] of list.views) {
      const name = String(article).replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*$/, '');
      const key = keyOf(name);
      if (!key) continue;
      if (!out.names.has(key)) out.names.set(key, name);
      const m = out.get(key) || new Map();
      m.set(day, Math.max(m.get(day) || 0, views));
      out.set(key, m);
    }
  }
  return out;
}
// (an all-time box office record is read on the list it tops as much as on the film's page: "List of highest-grossing films" 36K -> 88K)
const RECORD_LIST = 'list of highest grossing films';
/**
 * A card's Wikipedia days over the last week of saved lists: its own page, its film's or show's without the "movie", its subject's
 * (the most read of them each day), plus the list an all-time box office record tops: { last, prev (the three days before, a mean),
 * peak, recent (the last two days' best), sustained (100K+ on 3 of the last 4 days) }, or null when no list prints any of them.
 */
function wikiCurveOf(keys, index, now, record) {
  if (!index || !index.size) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  const days = [...new Set([...index.values()].flatMap((m) => [...m.keys()]))].filter((d) => d < today).sort().slice(-WIKI_CURVE_DAYS);
  const pages = [...new Set(keys.filter(Boolean))].map((k) => index.get(k)).filter(Boolean);
  if (!days.length || !pages.length) return null;
  const extra = record ? index.get(RECORD_LIST) : null;
  const v = days.map((d) => Math.max(0, ...pages.map((m) => m.get(d) || 0)) + (extra ? extra.get(d) || 0 : 0));
  if (!v.some((x) => x > 0)) return null;
  const n = v.length;
  const before = v.slice(Math.max(0, n - 4), n - 1);
  return { last: v[n - 1], prev: before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0, peak: Math.max(...v), low: Math.min(...v),
    recent: Math.max(v[n - 1], n > 1 ? v[n - 2] : 0), sustained: v.slice(-4).filter((x) => x >= WIKI_SUSTAIN_VIEWS).length >= 3 };
}

/**
 * The card's momentum: { rise (x1 or more: the last 24 hours against the three days before, from eight items), decay (x1 or less: the
 * last 24 hours against the busiest day, halved while the page is still read 50K+ a day), stale (no live search, no page read 50K+,
 * and the press under a quarter of its busiest day or the page back under 30% of its week's peak), newsLast }.
 */
function momentumOf(c, ev, curve, now) {
  const inDay = (b) => ev.press.filter((r) => now - r.t >= b * DAY && now - r.t < (b + 1) * DAY).length;
  const last = inDay(0);
  const prev = (inDay(1) + inDay(2) + inDay(3)) / 3;
  const byDay = [0, 1, 2, 3, 4, 5, 6].map(inDay);
  const peak = Math.max(...byDay);
  // (a story gets three days to fade before it is back at its baseline: "Shivon Zilis split" two days on is still decaying)
  const peakAge = byDay.indexOf(peak);
  const rise = last >= RISE_MIN ? 1 + RISE_W * Math.min(RISE_LOG_CAP, Math.max(0, Math.log2((last + 1) / (prev + 1)))) : 1;
  const share = (last + 1) / (peak + 1);
  const wikiLive = !!curve && (curve.last >= WIKI_LIVE_VIEWS || curve.sustained);
  const decay = peak >= 5 ? 1 - DECAY_W * (wikiLive ? DECAY_WIKI_LIVE : 1) * Math.max(0, DECAY_FROM - share) : 1;
  // (a search still trending is people still typing it: "chad lowe", 1M and live)
  const liveSearch = c.trends.some((t) => t.end === null || (t.end ?? 0) >= now - DAY / 2);
  const wikiDead = !!curve && curve.peak >= WIKI_DEAD_PEAK && curve.last < WIKI_DEAD_SHARE * curve.peak;
  const stale = !liveSearch && !wikiLive && peak >= 5 && peakAge >= STALE_AGE && (share < STALE_SHARE || (wikiDead && share < STALE_SHARE_WIKI));
  return { rise, decay, stale, newsLast: last, share };
}

/** Whether people type the card's story: a YouTube completion of its name carries a word of its title or line, or three or more are ones people only started typing. */
function typedOf(ev, title, what, subject) {
  const comps = ev.completions || [];
  // (a handful of completions people only started typing is a live name whatever they say: "cornell 7 case deep dive")
  if (comps.length < NO_DEMAND_MIN || comps.filter((x) => x.fresh).length >= NO_DEMAND_FRESH) return true;
  const subj = new Set(subject.split(' '));
  const story = new Set([...words(title), ...words(what || '')].filter((w) => !subj.has(w) && !W.STOP.has(w) && w.length > 2));
  return comps.some((x) => words(x.q).some((w) => story.has(w)));
}

module.exports = { wikiDaysIndex, wikiCurveOf, momentumOf, typedOf, RISE_W, STALE_MULT, FADING_MULT, NO_DEMAND_MULT, WIKI_LOOKUP_MIN, WIKI_LOOKUP_SPIKE, WIKI_LOOKUP_W };
