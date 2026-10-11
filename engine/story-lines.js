'use strict';
/*
 * Story step, reading one story's pool: which items are the moment's own coverage (its action word, the other name it opens with,
 * its story words), the pool's angles (recurring second names, quoted phrases and story words, with their independent sources),
 * the Trends queries and "amid/after" clauses that point at an angle, the title that best stands for an angle, and the trace
 * entries every line carries. Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const { contains, uniqByKey, outletKey } = require('./util');
const { outletQuality, VAGUE } = require('./story-focus');
const {
  DAY, ANGLE_STOP, FRAME_RE, AFTERMATH, ORIGIN_RE, ORIGIN_VERB, CAUSE_RE, CAUSE_STORY, ARTICLE_STORY, REACTIONS, PLAIN_VERB,
  ORG_NAMES, DANGLING, FASHION, ASKS, EXPLAINER_TITLE, words, stem, SYN, ymd, fmtVolume, uniq, sourceLabel, sameName, nameLike,
  surfaceOf, namesIn, isPlaceWord, carries, labelOf, probe, hasVerb, openQuoteAtEnd, cutDangles, peakDay, surfacePhrase,
} = require('./story-terms');

const AMBIGUOUS_FRAME = new Set(['drama', 'row', 'saga', 'crisis', 'beef']);

/** The angle's name only inside a longer name: "Primetime" in "Jesse Watters Primetime" is another show. */
function inLongerName(text, key, lex) {
  if (key.startsWith('w:')) return false;
  const label = labelOf(key);
  const names = namesIn(text, lex);
  return !names.includes(label) && names.some((n) => n !== label && contains(n, label));
}

const MIN_REP_SCORE = 2; // a title that scores lower (no verb, cut short, a listicle) does not stand for its angle
const MIN_STORY_SCORE = 3; // and a story line needs a little more
const SAGA_LEAD_DAYS = 5; // an angle that peaked this long before the moment is a saga: its origin title tells it best
const TRACE_MAX = 4;

/**
 * The terms that make an item the moment's own coverage: the headline's action word ("roasts", "flinches", "reacting"), the
 * other name it opens with ("Amelia Dimoldenberg"), its quoted phrase or role noun, its other story words and hooks. Names after
 * the action are context ("her husband Matthew Rhys’s first Emmy win"), not the moment.
 */
function momentModel(c, E, text = c.headline, opts = {}) {
  const raw = text.split(/\s+/);
  const hw = words(text).join(' ');
  // the main name's words, and those of longer names holding it ("donald" in "Donald Trump" when the main name is "trump")
  const eParts = new Set(E ? [...c.entSet].filter((n) => contains(n, E)).concat(E).join(' ').split(' ') : []);
  const names = [...c.entSet].filter((n) => contains(hw, n) && (!E || (!sameName(n, E) && !contains(n, E) && !contains(E, n))) && nameLike(n));
  const opener = names.filter((n) => (hw + ' ').startsWith(n + ' ') || (E && (hw + ' ').startsWith(`${E} ${n} `)));
  const nameWords = new Set(names.join(' ').split(' '));
  // words after a context name describe it, not the moment: "reacting to her husband | Matthew Rhys’s first Emmy win"
  const ctxNames = names.filter((n) => !opener.includes(n));
  const ws = words(text);
  const cut = ctxNames.map((n) => ws.findIndex((w, i) => ws.slice(i, i + n.split(' ').length).join(' ') === n)).filter((i) => i > 0);
  const head = cut.length ? ws.slice(0, Math.min(...cut)) : ws;
  const stems = uniq(head.filter((w) => w.length >= 3 && !W.STOP.has(w) && !W.GENERIC.has(w) && !PLAIN_VERB.has(w) && !eParts.has(w) && !nameWords.has(w))
    .map(stem).filter((x) => !ANGLE_STOP.has(x) && !isPlaceWord(x)));
  const titleCased = W.isTitleCase(raw);
  const verb = raw.slice(1).filter((w) => titleCased || !/^[^\p{L}]*\p{Lu}/u.test(w)).map((w) => words(w)[0]).find((w) => w && (W.looksVerb(w) || /^[a-z]{4,}ing$/.test(w)) && !PLAIN_VERB.has(w) &&
    !W.STOP.has(w) && !W.GENERIC.has(w) && !eParts.has(w) && !nameWords.has(w));
  const pseudo = c.topPseudo && (opts.pseudo || contains(hw, c.topPseudo.slice(2))) ? [c.topPseudo] : [];
  const action = verb ? `w:${stem(verb)}` : null;
  const context = ctxNames.map((n) => `n:${n}`);
  // the cluster's hooks can be context ("unraveled" in the dress clip's coverage): only the aftermath reading, which has lost its
  // action, borrows them
  const hooks = (opts.hooks ? c.hooks : []).filter((h) => !isPlaceWord(h) && (!cut.length || head.map(stem).includes(h)));
  const all = uniq([...stems, ...hooks]).map((x) => `w:${x}`).filter((k) => k !== action);
  // a headline of names and a generic verb ("Rory Stewart becomes a meme after Newsnight moment"): its names mark the moment
  return { opener: opener.map((n) => `n:${n}`), pseudo, action, stems: all.length || action ? all : context, context: all.length || action ? context : [] };
}

/** An item is the moment's coverage when it carries the action, or at least half of the moment's story words. */
function momentHits(it, m) {
  const n = m.stems.filter((k) => carries(it, k)).length;
  return { act: !!m.action && carries(it, m.action), n, who: m.opener.concat(m.pseudo).some((k) => carries(it, k)) };
}

function isMomentItem(it, m) {
  const h = momentHits(it, m);
  return h.act || h.n >= Math.max(1, Math.ceil(0.6 * m.stems.length)) || (h.who && h.n >= 1);
}

/** Surely the moment itself: two of its marks together, one of them the name it opens with when it has one ("Amelia Dimoldenberg"). */
function isStrongMoment(it, m) {
  const h = momentHits(it, m);
  if (m.opener.length && !m.opener.some((k) => carries(it, k))) return false;
  return (h.act ? 1 : 0) + Math.min(2, h.n) + (h.who ? 1 : 0) >= 2;
}

function angleKeysOf(it, E, eParts, lex) {
  const out = new Set();
  for (const n of it.allNames) {
    if (E && (sameName(n, E) || contains(n, E) || contains(E, n))) continue;
    if (eParts.has(n) || !nameLike(n) || ORG_NAMES.has(n)) continue;
    out.add(`n:${n}`);
  }
  for (const p of it.quoteP || []) {
    const q = p.slice(2);
    if (E && (contains(q, E) || contains(E, q))) continue;
    if (q.split(' ').every((w) => W.STOP.has(w) || ANGLE_STOP.has(stem(w)))) continue;
    out.add(p);
  }
  for (const t0 of it.toks || []) {
    const t = SYN[t0] || t0;
    if (t.length < 4 || ANGLE_STOP.has(t) || /^\d/.test(t) || eParts.has(t) || R.HOOK_STOP.has(t) || isPlaceWord(t) || (lex && lex.proper.has(t))) continue;
    out.add(`w:${t}`);
  }
  return out;
}

/** The pool's angles: every recurring term with its items, independent sources and how much of it is the moment's coverage. */
function anglesOf(pool, E, m, lex, isMom) {
  const eParts = new Set(E ? E.split(' ') : []);
  const own = new Set([...m.opener, ...m.pseudo, ...m.stems, ...(m.action ? [m.action] : [])]);
  const byKey = new Map();
  for (const it of pool) {
    for (const k of angleKeysOf(it, E, eParts, lex)) {
      if (own.has(k)) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(it);
    }
  }
  const out = [];
  for (const [key, list] of byKey) {
    const items = uniqByKey(list);
    const ts = items.map((i) => i.t);
    out.push({ key, items, srcs: new Set(items.map((i) => i.src)), days: new Set(items.map((i) => ymd(i.t))), first: Math.min(...ts),
      last: Math.max(...ts), momentShare: items.filter(isMom).length / items.length });
  }
  return out;
}

/** Cause clauses in the moment's coverage: "amid reported Tucker Wetmore romance" -> its words. */
function causeClauses(coverage) {
  const out = [];
  for (const it of coverage) {
    for (const mm of it.text.matchAll(CAUSE_RE)) out.push({ it, words: words(mm[1]).join(' '), stems: new Set(words(mm[1]).map(stem)) });
  }
  return out;
}

function trendLinks(trends, E, now) {
  if (!E) return [];
  return trends.filter((t) => (t.end ?? now) >= now - 14 * DAY).map((t) => ({
    t, kw: words(t.keyword).join(' '), rel: (t.related || []).map((r) => words(r).join(' ')) }))
    .filter((x) => contains(x.kw, E) || x.rel.some((r) => contains(r, E)));
}

/** A Trends query that pairs the angle with the main name: "tucker wetmore" (related: "ella langley"), "justin verlander" (related: "kate upton"). */
function trendFor(angle, links, E) {
  const label = labelOf(angle.key);
  const is = (s) => (angle.key.startsWith('w:') ? words(s).map(stem).includes(label) && s.split(' ').length <= 2 : s === label || contains(s, label));
  return links.filter((x) => (is(x.kw) && x.rel.some((r) => contains(r, E))) || (x.kw === E && x.rel.some(is)))
    .sort((a, b) => b.t.volume - a.t.volume)[0] || null;
}

/** A story word the titles write as a name ("Olivia Rodrigo launches Unraveled tour"), not a plain word ("arena staffer"). */
function titledWord(a) {
  const plain = a.items.filter((it) => !it.titleCase);
  const capped = plain.filter((it) => it.capToks && it.capToks.has(labelOf(a.key)));
  return plain.length > 0 && capped.length >= Math.max(1, 0.5 * plain.length);
}

/**
 * The title that best stands for an angle, rewritten like any headline: it carries the angle and its common companions, names the
 * main name, has a verb, reads whole, and is not a listicle, a game preview or a question. A saga (it peaked days before the
 * moment) is told by its earliest titles, anything else by its busiest day.
 */
function representative(angle, E, lex, momentFirst, opts = {}) {
  const eParts = new Set(E ? E.split(' ') : []);
  const base = angle.items; // lines that retell the moment are turned away by opts.notMoment; the rest prefer the angle's own items
  if (!base.length) return null;
  const co = new Map();
  for (const it of base) for (const k of angleKeysOf(it, E, eParts, lex)) if (k !== angle.key) co.set(k, (co.get(k) || 0) + 1);
  const coTop = [...co.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  const peak = peakDay(base);
  const saga = Date.parse(peak) < momentFirst - SAGA_LEAD_DAYS * DAY;
  const target = opts.origin || saga ? Math.min(...base.map((i) => i.t)) : Date.parse(peak);
  const hook = labelOf(angle.key) && angle.key.startsWith('w:') ? [labelOf(angle.key)] : [];
  const first = base.slice().sort((a, b) => a.t - b.t)[0];
  const scored = uniqByKey(base).map((it) => {
    // a name angle picks the clause that names it ("Matthew Rhys just made Emmys history. He didn't thank Keri Russell ...")
    const h = W.rewrite(it.title, angle.key.startsWith('n:') ? labelOf(angle.key) : E, lex, hook);
    const ws = h.text.split(/\s+/);
    const p = probe(h.text);
    if (openQuoteAtEnd(h.text) || DANGLING.test(h.text) || ws.length < 4) return null;
    if (labelOf(angle.key) && !opts.loose && (!carries(p, angle.key) || inLongerName(h.text, angle.key, lex))) return null; // it must still say the angle
    if (opts.notMoment && opts.notMoment(h.text)) return null;
    if (opts.must && !opts.must.test(h.text)) return null;
    let s = coTop.filter(([k]) => carries(p, k)).reduce((a, [, n]) => a + n / base.length, 0) * 2;
    if (EXPLAINER_TITLE.test(it.title) || ((opts.strict || opts.clip) && ASKS.test(h.text)) || (opts.strict && h.cut)) return null;
    if (W.quoteImbalance(h.text)) s -= 1.5;
    if (opts.noAftermath && AFTERMATH.test(h.text)) s -= 3;
    if (E && contains(p.textWords, E)) s += (p.textWords + ' ').startsWith(`${E} `) ? 1.5 : 1;
    if (hasVerb(h.text)) s += 1.5;
    else if (opts.story) s -= 1.5; // "Nathan Fielder Elizabeth Holmes doc" names things but says nothing happened
    if (ws.length >= 5 && ws.length <= W.MAX_WORDS) s += 1;
    if (h.lostHook) s -= 1.5;
    if (h.cut) s -= opts.story ? 1.5 : 0.3;
    if (opts.story && (cutDangles(it.title, h.text) || FASHION.test(it.title))) s -= 4;
    if (opts.story && VAGUE.test(h.text)) return null; // a teaser is no story line ("Prince William's plan to ‘destroy’ Harry ... exposed")
    if (h.cut && /\b(is|are|was|were|be)\s+(a|an|the)\s+\S+$/i.test(h.text)) return null; // "... romance is a full-on" 
    if (opts.story && AFTERMATH.test(h.text)) s -= 3;
    if (/^(inside|here|everything|all about|watch)\b/i.test(h.text) || ASKS.test(h.text) || /\?$/.test(h.text) || R.RE.question.test(it.title)) s -= 3;
    if (R.RE.service.test(it.title) || R.RE.evergreen.test(it.title)) s -= 5;
    if (R.RE.sportsDry.test(it.title) || R.GAME_RE.test(it.title) || /\b(look to|set to face|preview|takeaways|rebound)\b/i.test(it.title)) s -= 3;
    if (/^["“‘']/.test(h.text)) s -= 2;
    if (it.fam === 'reddit') s -= 0.5;
    if (opts.isMom && !opts.isMom(it)) s += 0.5;
    if (R.RE.tragedy.test(it.title) || R.RE.unsafe.test(it.title)) s -= 10;
    if (opts.origin) s += (ORIGIN_RE.test(it.title) ? 1.5 : 0) + (ORIGIN_VERB.test(it.title) && !opts.clip ? 1 : 0) - (AFTERMATH.test(it.title) ? 3 : 0) + (it === first ? 2 : 0);
    if (opts.clip && /\b(says|said|claims|reveals|tells|admits|insists)\b/i.test(it.title)) s -= 2; // what they said after is not the clip
    s += 1.5 * Math.max(0, 1 - Math.abs(it.t - target) / (4 * DAY));
    return { it, text: h.text, s };
  }).filter(Boolean).sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  if (opts.dbg) for (const x of scored.slice(0, 6)) opts.dbg(`      rep ${x.s.toFixed(2)} ${x.text} <= ${x.it.title.slice(0, 80)}`);
  return scored[0] && scored[0].s >= (opts.story ? MIN_STORY_SCORE : MIN_REP_SCORE) ? { ...scored[0], coKeys: coTop.map(([k]) => k) } : null;
}
const traceTitle = (it) => ({ kind: 'title', source: sourceLabel(it), date: ymd(it.t), text: it.title });
const traceTrend = (t) => ({ kind: 'trends', source: `Google Trends ${t.geo}`, date: ymd(t.start),
  text: `“${t.keyword}” ${fmtVolume(t.volume)}+ searches${(t.related || []).length ? ` (related: ${t.related.slice(0, 3).join(', ')})` : ''}` });
const traceWiki = (w) => ({ kind: 'signal', source: 'Wikipedia most-read', date: ymd(w.t), text: `${w.name}: ${w.views.toLocaleString('en-US')} views (${w.spike.toFixed(1)}x usual)` });
const traceArticle = (a) => ({ kind: 'wikipedia', source: 'Wikipedia', date: '', text: `${a.title}${a.desc ? ` (${a.desc})` : ''}: ${a.extract.slice(0, 200)}` });

/** Up to TRACE_MAX items from distinct sources, the representative first, then outlets before Reddit posts (or the given order). */
function traceItems(first, items, keepOrder = false) {
  const out = [];
  const seen = new Set();
  // the named outlets first (Variety before Her Campus), then the earliest
  const rest = keepOrder ? items : items.slice().sort((a, b) => (a.fam === 'reddit') - (b.fam === 'reddit') ||
    Number(outletQuality(b) > 0) - Number(outletQuality(a) > 0) || a.t - b.t);
  for (const it of [first, ...rest]) {
    if (!it || seen.has(it.src) || out.length >= TRACE_MAX) continue;
    seen.add(it.src);
    out.push(it);
  }
  return out;
}
// (a publishing group's mastheads, the Mirror and the Irish Mirror, are one source)
const titleSources = (entries) => new Set(entries.filter((e) => e.kind === 'title' || e.kind === 'wikipedia').map((e) => (e.kind === 'title' ? outletKey(e.source) : e.source))).size;

/** Two independent saved titles, or one Trends related query or Wikipedia spike plus one title. */
const traceable = (entries) => titleSources(entries) >= 2 || (titleSources(entries) >= 1 && entries.some((e) => e.kind === 'trends' || e.kind === 'signal'));

/** The frame the angle's coverage uses most ("controversy"), named when a name comes with it in two titles ("Macklemore controversy"). */
function frameOf(angle) {
  const counts = new Map();
  for (const it of angle.items) {
    for (const mm of it.text.matchAll(FRAME_RE)) {
      const f = mm[1].toLowerCase().replace(/^controversies$/, 'controversy');
      if (!counts.has(f)) counts.set(f, new Set());
      counts.get(f).add(it.src);
    }
  }
  const namedIn = (f) => angle.key.startsWith('n:') && new Set(angle.items.filter((it) => contains(it.textWords, `${labelOf(angle.key)} ${f}`))
    .map((i) => i.src)).size >= 2;
  // "drama", "row", "saga" and "crisis" are also a genre, "in a row" and a book: they frame a story only with its name before them
  const best = [...counts.entries()].filter(([f]) => !AMBIGUOUS_FRAME.has(f) || namedIn(f))
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
  if (!best || best[1].size < 2) return null;
  return { frame: best[0], named: namedIn(best[0]) };
}

/** A Wikipedia page named for the story ("Macklemore–Ed Sheeran tour controversy"): it carries the angle and a story word. */
function articleFor(angle, articles, E) {
  const label = labelOf(angle.key);
  return articles.find((a) => {
    const t = words(a.title).join(' ');
    return ARTICLE_STORY.test(a.title) && (contains(t, label) || (E && contains(t, E))) && !/^list of\b/i.test(a.title);
  }) || null;
}

function reactionOf(coverage, onlyFraming = false) {
  let best = null;
  for (const r of REACTIONS) {
    if (onlyFraming && !r.framing) continue;
    const hits = uniqByKey(coverage.filter((it) => r.re.test(it.title) || (it.dek && r.re.test(it.dek))));
    const srcs = new Set(hits.map((i) => i.src));
    if (srcs.size >= 2 && (!best || srcs.size > best.srcs.size)) best = { ...r, hits, srcs };
  }
  return best;
}

/** Where a story-shaped headline began: a recruiter's post, a newspaper story, a video, told by its earliest well-covered title. */
function originOf(coverage, E, lex, c, dbg = null) {
  const items = coverage.filter((it) => ORIGIN_RE.test(it.title) && !AFTERMATH.test(it.title));
  const earliest = coverage.filter((it) => !AFTERMATH.test(it.title) && it.fam !== 'reddit').sort((a, b) => a.t - b.t)[0];
  if (dbg) dbg(`   [origin] cov=${coverage.length} items=${items.map((i) => i.title.slice(0, 60)).join(' | ')}`);
  if (!items.length) return null;
  const counts = new Map();
  for (const it of items) { const k = (it.title.match(ORIGIN_RE) || [])[1].toLowerCase(); counts.set(k, (counts.get(k) || new Set()).add(it.src)); }
  const key = [...counts.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
  if (!key || key[1].size < 2) return null;
  const withKey = items.filter((it) => new RegExp(`\\b${key[0]}\\b`, 'i').test(it.title));
  // the story that started it is often the earliest title itself ("A Western Mass. lesbian bar required KN-95 masks ...")
  const cands = uniqByKey(earliest ? [earliest, ...withKey] : withKey);
  const rep = representative({ key: 'w:', items: cands, first: c.first }, E, lex, c.first,
    { anyItem: true, origin: true, dbg });
  if (!rep || words(rep.text).join(' ') === words(c.headline).join(' ')) return null;
  return { text: rep.text, trace: traceItems(rep.it, withKey).map(traceTitle) };
}

function causeStory(causes, E, pool) {
  const groups = [];
  for (const c of causes) {
    const ws = c.words.split(' ').filter((w) => !/^(the|a|an|his|her|their|its|reported|alleged|rumou?red|new|latest|ongoing)$/.test(w));
    const phrase = ws.join(' ');
    if (!CAUSE_STORY.test(phrase) || ws.length < 2 || (E && phrase === E)) continue;
    const content = new Set(ws.slice(0, -1).filter((w) => !W.GENERIC.has(w) && !W.STOP.has(w)).map(stem)
      .filter((x) => !(E && E.split(' ').includes(x)) && !ANGLE_STOP.has(x)));
    if (!content.size) continue;
    const g = groups.find((x) => x.frame === ws[ws.length - 1] && [...content].some((k) => x.content.has(k)));
    if (g) { g.items.push(c.it); g.phrases.push(phrase); content.forEach((k) => g.content.add(k)); } else groups.push({ frame: ws[ws.length - 1], content, items: [c.it], phrases: [phrase] });
  }
  const best = groups.map((g) => ({ ...g, srcs: new Set(g.items.map((i) => i.src)) })).filter((g) => g.srcs.size >= 2)
    .sort((a, b) => b.srcs.size - a.srcs.size || a.frame.localeCompare(b.frame))[0];
  if (!best) return null;
  const counts = new Map();
  best.phrases.forEach((p) => counts.set(p, (counts.get(p) || 0) + 1));
  const phrase = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
  const shown = surfacePhrase(phrase, best.items);
  const text = /romance|relationship|engagement|split|breakup/.test(best.frame) && E ? `${surfaceOf(E, pool)}’s ${shown}` : `The ${shown}`;
  return { text, trace: traceItems(best.items[0], best.items).map(traceTitle) };
}

module.exports = {
  MIN_REP_SCORE, MIN_STORY_SCORE, SAGA_LEAD_DAYS, TRACE_MAX, momentModel, momentHits, isMomentItem, isStrongMoment,
  angleKeysOf, anglesOf, causeClauses, trendLinks, trendFor, titledWord, representative, traceTitle, traceTrend, traceWiki,
  traceArticle, traceItems, titleSources, traceable, frameOf, articleFor, reactionOf, originOf, causeStory,
};
