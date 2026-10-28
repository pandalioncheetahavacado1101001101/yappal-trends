'use strict';
/*
 * Step 8 of the Ideas pipeline: the story behind each moment. A listed moment is often one jab in a bigger story ("Pellelle
 * Sorrmott roasts Tavix Ostiss on SNL UK" is a turn in the Plonker–Tavix Ostiss tour controversy), so every moment gets:
 *   story   the real story people are talking about, as a short headline
 *   moment  the specific clip or post
 *   why     one line on why it is blowing up now
 * and a trace of the saved texts each line rests on. Nothing is stated that the saved sources do not carry: the story and every
 * clause of the why need two independent saved titles, or one Google Trends related query (or Wikipedia spike) plus one title.
 *
 *   units    moments that are one story merge: the same main name plus a second name both carry ("Tavix Ostiss" and "Plonker"
 *            in the SNL UK roast and in the cancelled Gillette shows)
 *   pool     the story's evidence: the moments' own items, every other saved item naming the main name within 14 days (items
 *            dropped as politics, hard news, industry, sport or a blocked outlet count as context here, never as a headline),
 *            and two story lookups: a Google News search for the name over 14 days and a Wikipedia search (a story told by
 *            the game or show it happened at also searches that event's Trends query: "falcons packers" finds the result)
 *   moment   the headline's own terms mark the moment's coverage in the pool: its action word ("roasts"), the name it opens with
 *            when that is not the main name ("Pellelle Sorrmott"), its hooks and quoted phrase. Names after the action are
 *            context ("her husband Tavelle Ostenko’s first Emmy win"), not the moment
 *   angles   the pool's recurring terms (a second name, a quoted phrase, a story word; never a place, a team, a verb or a frame
 *            word), each with its independent sources. The story is the best-covered angle the moment's coverage points at: it
 *            names it in two sources, says it happened "amid/after" it, or a Trends query pairs it with the main name
 *   shapes   a headline that is already the story ("Debate over iced coffee at interviews") keeps it and finds its origin
 *            ("Recruiter says ..."); an aftermath headline ("... defends her husband") shows the original clip and moves the
 *            aftermath into the why; with no angle, the crowd's framing of the moment ("ignited a debate") is the story
 *   why      the strongest one or two of (170 characters at most, nothing the headline, story or moment already says): what set a
 *            backlash off and the subject's own account, the maker's account of a designed moment, the moment's own detail, the
 *            aftermath, a second big angle the same week, the crowd's reaction, a search surge, a Wikipedia spike; never a count of
 *            stories. With nothing sourced to add, the best-covered other title; else none (the card lists last)
 *   headline the story when it is what people are talking about (a backlash, a reversal, a debate, a meme database's topic) and
 *            names the moment's subject; else the listed headline, never a clickbait one; no trailing parenthetical anywhere
 * Plain string/regex/set arithmetic only, so it ports 1:1 to Swift. On the phone the on-device model may reword the three lines
 * using only their trace; it may not add facts.
 */
const W = require('./wording');
const R = require('./rules');
const FOCUS = require('./story-focus');
const PICK = require('./story-pick');
const SHAPE = require('./story-shape');
const SW = require('./story-why');
const T = require('./story-terms');
const { contains, uniqByKey } = require('./util');
const {
  DAY, HOUR, CONTEXT_DROPS, ANGLE_STOP, STORY_HEADLINE, AFTERMATH, AFTERMATH_PHRASE, words, stem, ymd, capFirst, fmtVolume,
  uniq, readyItem, sameName, namesE, nameLike, surfaceOf, carries, labelOf, probe, peakDay, quoteSurface,
} = require('./story-terms');
const {
  SAGA_LEAD_DAYS, momentModel, momentHits, isMomentItem, isStrongMoment, anglesOf, causeClauses, trendLinks, trendFor, titledWord,
  representative, traceTitle, traceTrend, traceWiki, traceArticle, traceItems, traceable, frameOf, articleFor, reactionOf,
  originOf, causeStory,
} = require('./story-lines');
const {
  mergeUnits, lookupQuery, lookupTargets, parseWikiSearch, lookupsFor, allStoryRows, slug, DEEP_MAX, WIKI_STORY_MAX, eventQuery,
} = require('./story-lookups');

const FOCUS_SHARE = 0.35; // a name whose own coverage is mostly this story's: every item naming it is story evidence
const BUSY_NAME_ITEMS = 25; // a name in this many saved items (Neskova) needs a shared second name or story word to join
const MIN_ANGLE_SOURCES = 2;
const MOMENT_SHARE_MAX = 0.5; // an angle whose items are mostly the moment's own coverage is the moment, not the story
const CAUSE_BONUS = 6; // the moment's coverage says it happened "amid/after" this angle
const TRENDS_LINK_BONUS = 2;
const NAMED_ANGLE_BONUS = 1;
const SAGA_MIN_DAYS = 4;
const RECENT_HOURS = 72;
const SECOND_MIN_SOURCES = 3;
const SECOND_WINDOW_DAYS = 7; // a second big angle counts as "the same week" when it ran this close to the moment
const SECOND_MAX_OVERLAP = 0.3;
const SEARCH_MIN_VOLUME = 20000;
const WIKI_MIN_SPIKE = 5;
const SIGNAL_DAYS = 2; // a search surge or page spike counts for a moment only within two days of it
const MOMENT_LEAD_DAYS = 7;
const DBG = process.env.STORY_DEBUG || '';
const dlog = (...a) => process.stderr.write(a.join(' ') + '\n');

/** STORY_DEBUG=text: a log for the story whose headline holds the text, else none. */
const debugFor = (c) => (DBG && c.headline.toLowerCase().includes(DBG) ? dlog : null);

// ---------- pool and angles ----------
function storyPool(unit, universe, deepItems, busy) {
  const members = uniqByKey(unit.clusters.flatMap((c) => c.items));
  const memberKeys = new Set(members.map((i) => i.key));
  const E = unit.anchor;
  if (!E) return { members, pool: uniqByKey([...members, ...deepItems]) };
  const withE = universe.filter((it) => namesE(it, E));
  const share = withE.length ? withE.filter((i) => memberKeys.has(i.key)).length / withE.length : 1;
  // a busy name (Neskova): only items that also carry a second name or a story word of the moment's coverage
  const memberNames = new Set([...unit.names.entries()].filter(([n, k]) => k >= 2 && !sameName(n, E) && nameLike(n) && !busy(n)).map(([n]) => n));
  const hooks = new Set(unit.clusters.flatMap((c) => c.hooks));
  // the story search's own second name counts even when it is busy too ("Neskova" "Bexette Tamwyn": Thalo's handshake with Vorlen)
  const searched = unit.busy && unit.query ? (unit.query.gn.match(/"([^"]+)"/g) || []).map((q) => words(q).join(' ')).filter((q) => q && !sameName(q, E)) : [];
  const onStory = (it) => it.allNames.some((n) => memberNames.has(n)) || [...hooks].some((h) => it.textStems.has(h)) || searched.some((q) => contains(it.textWords, q));
  // (the unit's share counts its own second names too: see buildStories)
  const extra = !unit.busy && Math.max(share, unit.share || 0) >= FOCUS_SHARE ? withE : withE.filter(onStory);
  // the story search matched every row it returned (often in the article body, so the title need not name E)
  const pool = uniqByKey([...members, ...extra, ...deepItems]);
  // (a one-word name also finds its namesakes: "Pellard Sorriss wins national award" is not BLACKPINK's Yolkstro; a Title Case title
  // capitalises every word, so it cannot tell)
  const namesake = (it) => !W.isTitleCase(it.title.split(/\s+/)) && FOCUS.otherBearer(it.title, E, pool);
  return { members: members.filter((it) => !namesake(it)), pool: pool.filter((it) => !namesake(it)) };
}

function rankAngles(angles, { causes, links, coverage, members, alsoHeadlines, context, E, busyE, isMom }) {
  const out = [];
  for (const a of angles) {
    const label = labelOf(a.key);
    const trend = E ? trendFor(a, links, E) : null;
    const inCause = causes.some((c) => (a.key.startsWith('w:') ? c.stems.has(label) : contains(c.words, label)));
    const inAlso = alsoHeadlines.some((h) => carries(probe(h), a.key));
    const inContext = context.includes(a.key);
    // pointed at explicitly (a cause clause, a Trends pairing, a name the headline gives as context): the moment's coverage may carry it
    const pointed = inCause || !!trend || inContext || inAlso;
    if (a.momentShare >= MOMENT_SHARE_MAX && !pointed) continue;
    if (a.momentShare >= 0.9 && !trend && !inContext) continue; // "shoplifting arrest" retells the mugshot, whatever the clause says
    if (a.srcs.size < MIN_ANGLE_SOURCES && !(a.srcs.size >= 1 && trend)) continue;
    // or only carried by the moment's coverage: then by two of the moment's own items for a busy name, and three sources in all
    // a story word the moment's own coverage shares ("staffer") mostly retells the moment: only names and quoted titles link that way
    const carriers = (busyE ? members.filter(isMom) : coverage).filter((it) => carries(it, a.key));
    const covered = !!E && (!a.key.startsWith('w:') || titledWord(a)) && new Set(carriers.map((i) => i.src)).size >= 2 && a.srcs.size >= 3;
    if (!pointed && !covered) continue;
    const ownSrcs = new Set(a.items.filter((i) => !isMom(i)).map((i) => i.src)).size;
    const s = ownSrcs + 0.5 * a.days.size + (a.key.startsWith('w:') ? 0 : NAMED_ANGLE_BONUS) + (trend ? TRENDS_LINK_BONUS : 0) +
      (inCause ? CAUSE_BONUS : 0) + (inContext ? CAUSE_BONUS / 2 : 0);
    const causeWords = uniq(causes.filter((c) => (a.key.startsWith('w:') ? c.stems.has(label) : contains(c.words, label)))
      .flatMap((c) => [...c.stems]).filter((x) => !label.split(' ').map(stem).includes(x) && !ANGLE_STOP.has(x) && !W.STOP.has(x) &&
        !/^(controvers|drama|backlash|row|fallout|feud)/.test(x)));
    out.push({ a, s, trend, inCause, pointed, causeWords: inCause ? causeWords : [] });
  }
  return out.sort((x, y) => y.s - x.s || x.a.key.localeCompare(y.a.key));
}

// ---------- signals tied to the moment's days ----------
const telling = (t) => t.keyword.trim().includes(' ') || !W.isDictWord(words(t.keyword)[0] || ''); // "money" says nothing

/**
 * The search surge behind the moment: a Trends query attached to its cluster, one naming the main name, or one whose every word
 * the moment's coverage uses and that holds a name, a team or a place ("falcons vs packers", "minnesota football": a query
 * already anchored to a named entity is kept, though its words are plain). It must start within two days of the moment, unless
 * it is the story angle's own Trends pairing. Highest volume wins.
 */
function searchOf(unit, story, links, E, { momentFirst, vocab, anchorOf, trends, now }) {
  const near = (t) => Math.abs(t.start - momentFirst) <= SIGNAL_DAYS * DAY;
  const attached = unit.clusters.flatMap((c) => c.trends.filter((x) => x.strength === 1).map((x) => x.tr));
  const own = !unit.busy && E ? links.filter((x) => contains(x.kw, E)).map((x) => x.t) : [];
  const angled = story && story.rank && story.rank.trend ? [story.rank.trend.t] : [];
  const worded = trends.filter((t) => {
    if (!near(t) || (t.end ?? now) < momentFirst - SIGNAL_DAYS * DAY) return false;
    const ws = words(t.keyword).filter((w) => w.length > 2 && !W.STOP.has(w));
    return ws.length >= 2 && ws.every((w) => vocab.has(stem(w))) && ws.some(anchorOf);
  });
  return [...angled, ...[...attached, ...own, ...worded].filter(near)].filter((t) => t.volume >= SEARCH_MIN_VOLUME && telling(t))
    .sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword))[0] || null;
}

/** A Wikipedia most-read spike for the main name within two days of the moment (not the cluster's busiest day). */
function wikiOf(E, wiki, members, momentFirst) {
  if (!E) return null;
  const hits = wiki.filter((w) => sameName(w.key, E) && w.spike >= WIKI_MIN_SPIKE && Math.abs(w.t - momentFirst) <= SIGNAL_DAYS * DAY)
    .sort((a, b) => b.spike - a.spike);
  return hits[0] ? { w: hits[0], name: surfaceOf(E, members) } : null;
}

// ---------- the story of one listed moment ----------
/** The shape of a moment's headline: already the story, an aftermath, or the clip itself. */
const shapeOf = (headline) => (STORY_HEADLINE.test(headline) ? 'story' : AFTERMATH.test(headline) ? 'aftermath' : 'clip');

/**
 * The moment's coverage and the angles around it, for one reading of what the moment is (the headline, or the original clip
 * when the headline is an aftermath). A search built from the moment itself (a role noun, a nameless moment, a busy name plus the
 * moment's own word) returns the moment's coverage by construction.
 */
function analyze(unit, ctx, text) {
  const { E, pool, members, deepSet, links, lex } = ctx;
  const c = unit.clusters[0];
  const m = momentModel(c, E, text);
  const specific = !!(unit.query && unit.query.specific);
  // a search built from the moment itself returns mostly its coverage: there one of its marks is enough
  const oneMark = (it) => { const h = momentHits(it, m); return h.act || h.who || h.n >= 1; };
  const mset = new Set(pool.filter((it) => (specific && deepSet.has(it) && oneMark(it)) || isMomentItem(it, m)));
  const isMom = (it) => mset.has(it);
  const cov = uniqByKey([...members, ...pool.filter(isMom)]);
  // when the moment itself began: its surest coverage's first day (a jab inside a two-week saga is days old, not two weeks); a
  // story search can find it up to a week before the post that listed it, except for a busy name that has many such moments or
  // a nameless moment whose search is broad
  const strong = cov.filter((i) => isStrongMoment(i, m) && i.t >= c.first - (unit.busy || !E ? 1 : MOMENT_LEAD_DAYS) * DAY);
  const strongFirst = strong.length ? Math.min(...strong.map((i) => i.t)) : c.first;
  // the clip's own first post can come a few hours before the outlets that tell it best (a Reddit post the night before)
  // (the name the moment opens with and the main name together are the moment: "Pellelle Sorrmott on SNL UK going for Tavix Ostiss's jugular")
  const early = cov.filter((i) => i.t < strongFirst && i.t >= strongFirst - DAY && (isMomentItem(i, m) || (m.opener.length > 0 && momentHits(i, m).who)) && (!E || namesE(i, E)));
  const momentFirst = early.length ? Math.min(...early.map((i) => i.t)) : strongFirst;
  const angles = anglesOf(pool, E, m, lex, isMom);
  // what the moment's coverage says it happened "amid/after"
  const causes = causeClauses(cov);
  const ranked = rankAngles(angles, { causes, links, coverage: cov, members, alsoHeadlines: unit.clusters.slice(1).map((x) => x.headline),
    context: m.context, E, busyE: unit.busy, isMom });
  return { m, cov, momentFirst, angles, ranked, causes, isMom };
}

/**
 * An aftermath headline ("... defends her husband"): the moment is the original clip, told by the earliest titles of the
 * moment's own coverage before the aftermath began. Returns the clip and the headline's text without its aftermath part.
 */
function aftermathClip(c, E, A, { pool, members, lex, now, dbg }) {
  const origText = c.headline.replace(AFTERMATH_PHRASE, ' ').replace(/\s+/g, ' ').trim();
  const mo = momentModel(c, E, origText, { hooks: true, pseudo: true });
  const later = members.filter((i) => AFTERMATH.test(i.title)).map((i) => i.t);
  const until = (later.length ? Math.min(...later) : now) + 12 * HOUR;
  // (the clip is about what the aftermath is about: "Pellade Sorrova on the entertainment industry" is not what she addressed)
  const about = (i) => !c.hooks.length || c.hooks.some((h) => i.textStems.has(h));
  const before = pool.filter((i) => !AFTERMATH.test(i.title) && i.t <= until && i.t >= c.first - 3 * DAY && (members.includes(i) || isMomentItem(i, mo)) && about(i));
  if (dbg) dbg(`   [aftermath] orig="${origText}" before=${before.length} mo=${JSON.stringify(mo)}`);
  const clip = before.length ? representative({ key: 'w:', items: before }, E, lex, c.first, { anyItem: true, origin: true, clip: true, dbg }) : null;
  return clip && !AFTERMATH.test(clip.text) ? { clip, before, origText } : null;
}

/**
 * A test for lines that retell the moment rather than tell its story: the moment's own terms, a word most of its coverage uses
 * and the rest of the pool rarely does ("daughter", "stare", "roaches"), or a quarter of the story words of one of its titles.
 */
function retellTest(A, { E, pool, members, momentText }) {
  const { m, momentFirst, isMom } = A;
  const eParts = new Set(E ? E.split(' ') : []);
  const bag = (t) => new Set(words(t).filter((w) => !W.STOP.has(w) && !W.GENERIC.has(w) && !eParts.has(w) && w.length > 2).map(stem));
  const momentBags = [momentText, ...members.filter((i) => i.t >= momentFirst - DAY && isMom(i)).map((i) => i.title)].map(bag);
  const momentItems = uniqByKey(pool.filter(isMom));
  const otherItems = uniqByKey(pool.filter((i) => !isMom(i)));
  const freq = (items) => { const f = new Map(); for (const it of items) for (const x of bag(it.title)) f.set(x, (f.get(x) || 0) + 1); return f; };
  const fm = freq(momentItems);
  const fo = freq(otherItems);
  const distinctive = new Set([...fm.entries()].filter(([x, n]) => momentItems.length >= 3 && n >= 0.4 * momentItems.length &&
    (fo.get(x) || 0) <= 0.1 * Math.max(1, otherItems.length) && !ANGLE_STOP.has(x)).map(([x]) => x));
  const near = (x, mb) => mb.has(x) || (x.length >= 4 && [...mb].some((y) => y.length >= 4 && (x.endsWith(y) || y.endsWith(x))));
  const retells = (text, key = '') => {
    const b = bag(text);
    const own = new Set(words(labelOf(key)).map(stem)); // the angle's own name is not the moment ("You Can See Everything")
    return isMomentItem(probe(text), m) || [...b].some((x) => distinctive.has(x) && !own.has(x)) || momentBags.some((mb) => {
      const shared = [...b].filter((x) => near(x, mb)).length;
      return shared >= 2 && shared / (b.size + mb.size - shared || 1) >= 0.25;
    });
  };
  return { retells, distinctive };
}

/**
 * The story: an angle the moment's coverage says it happened "amid/after"; else the story those clauses name ("amid Zanelle
 * Ulmwyn’s credit row"); else the best other angle the moment points at. Each told by its most representative title, and
 * only when that title's trace holds two independent sources (or a Trends pairing and one).
 */
function pickStory(A, { E, lex, articles, momentText, retells, dbg, pool }) {
  const { ranked, causes, momentFirst, isMom, m, cov } = A;
  const causeNamed = causeStory(causes, E, pool);
  if (dbg) dbg(`   [story] m=${JSON.stringify(m)} momentFirst=${ymd(momentFirst)} cov=${cov.length}`);
  const order = [...ranked.filter((r) => r.inCause), ...(causeNamed ? [{ causeNamed }] : []), ...ranked.filter((r) => !r.inCause)];
  for (const r of order.slice(0, 8)) {
    if (r.causeNamed) {
      if (traceable(r.causeNamed.trace) && !retells(r.causeNamed.text)) return { kind: 'cause', ...r.causeNamed };
      continue;
    }
    if (dbg) dbg(`    angle ${r.a.key} s=${r.s.toFixed(1)}`);
    // a cause-linked angle must still say the cause ("credit" in "Zanelle Ulmwyn credit row"), unless a Trends pairing ties it
    const notMoment = (t) => retells(t, r.a.key) || (r.causeWords.length > 0 && !r.trend && !r.causeWords.some((k) => probe(t).textStems.has(k)));
    const rep = representative(r.a, E, lex, momentFirst, { dbg, isMom, story: true, loose: !!r.trend && r.a.momentShare >= MOMENT_SHARE_MAX, notMoment });
    if (!rep || words(rep.text).join(' ') === words(momentText).join(' ')) continue;
    if (r.a.first > momentFirst + DAY) continue; // a story behind the moment began before it
    const nonMoment = r.a.items.filter((i) => !isMom(i));
    const trace = traceItems(rep.it, nonMoment.length >= 2 ? nonMoment : r.a.items).map(traceTitle);
    if (r.trend) trace.push(traceTrend(r.trend.t));
    if (!traceable(trace)) continue;
    const article = r.a.key.startsWith('n:') ? articleFor(r.a, articles, E) : null;
    if (article) trace.unshift(traceArticle(article));
    const kind = Date.parse(peakDay(r.a.items)) < momentFirst - SAGA_LEAD_DAYS * DAY ? 'saga' : 'context';
    return { kind, angle: r.a, text: rep.text, it: rep.it, trace, rank: r, article, keys: [r.a.key, ...rep.coKeys.slice(0, 3)] };
  }
  return null;
}

/** No deeper story: the crowd's framing of the moment ("ignited a debate", "enraged people online") when it is not the headline. */
function framingStory(A, { E, lex, momentText, dbg }) {
  const fr = reactionOf(A.cov, true);
  if (dbg) dbg(`   [framing] ${fr ? fr.key + ' ' + fr.hits.map((i) => i.title.slice(0, 60)).join(' | ') : 'none'}`);
  const rep = fr ? representative({ key: 'w:', items: fr.hits }, E, lex, A.momentFirst, { anyItem: true, noAftermath: true, must: fr.re, story: true, dbg }) : null;
  if (!rep || rep.s < 3 || words(rep.text).join(' ') === words(momentText).join(' ')) return null;
  return { kind: 'framing', text: rep.text, trace: traceItems(rep.it, fr.hits).map(traceTitle) };
}

/**
 * A second big angle the same week (another story about the same name: "Velix Graviss approved to move to a halfway house"),
 * the saga's newest turn, or an earlier row about the main name that week ("Jasena Wickaby sparks outrage after claiming ...").
 * An angle the moment does not point at must be about the main name itself and big that week, or a conflict about it.
 */
const WEATHER = /\b(weather|storm|nor['’]?easter|forecast|hurricane|rain(?:ed|out)?)\b/i;
function pickSecond(A, story, { E, lex, now, retells, safe, terms, momentLineText }) {
  const { angles, ranked, momentFirst, isMom } = A;
  const keys = story.keys || [];
  const onStory = (it) => keys.some((k) => carries(it, k));
  for (const r2 of angles.filter((x) => x !== story.angle && x.momentShare < MOMENT_SHARE_MAX && x.srcs.size >= SECOND_MIN_SOURCES)
    .sort((x, y) => y.srcs.size - x.srcs.size || x.key.localeCompare(y.key))) {
    const near = Math.abs(r2.last - momentFirst) <= SECOND_WINDOW_DAYS * DAY || Math.abs(r2.first - momentFirst) <= SECOND_WINDOW_DAYS * DAY;
    const sameStory = r2.items.filter(onStory).length / r2.items.length > SECOND_MAX_OVERLAP;
    const fresh = sameStory && r2.first >= now - RECENT_HOURS * HOUR;
    if (!near || (sameStory && !fresh)) continue;
    const rep = representative(r2, E, lex, momentFirst, { notMoment: retells, strict: true, isMom });
    if (!rep || isMom(rep.it) || rep.text.split(/\s+/).length > 12 || (story.angle && carries(probe(rep.text), story.angle.key))) continue;
    const text = safe(rep);
    if (!text || (story.text && words(text).join(' ') === words(story.text).join(' '))) continue;
    // an accusation about a real person never rides along with a meme, and the moment told again is no second story
    if (SW.SENSITIVE.test(rep.it.title) || SW.SENSITIVE.test(text)) continue;
    const lineSt = FOCUS.contentStems(text, new Set((E || '').split(' ')));
    if (momentLineText && lineSt.filter((x) => FOCUS.contentStems(momentLineText, new Set()).includes(x)).length / Math.max(1, lineSt.length) >= 0.4) continue;
    if (FOCUS.SELF_DEFENSE.test(text) && !FOCUS.CONFLICT.test(text)) continue;
    if (rep.it.drop === 'hard-news' || WEATHER.test(rep.it.title)) continue; // a storm cancelling the shows is padding, not a turn of the story
    if (FOCUS.FUTURE.test(text)) continue; // (an announcement, "new single dropping this Friday", is not what happened)
    if (story.text && FOCUS.contentStems(text, new Set()).filter((x) => FOCUS.contentStems(story.text, new Set()).includes(x)).length >= 3) continue;
    const trace = traceItems(rep.it, r2.items).map(traceTitle);
    if (!traceable(trace)) continue;
    const linked = ranked.some((r) => r.a === r2);
    const big = r2.srcs.size >= 8 && Math.abs(Date.parse(peakDay(r2.items)) - momentFirst) <= 2 * DAY;
    const aboutE = E && (words(rep.text).join(' ') + ' ').startsWith(`${E} `);
    const conflict = aboutE && FOCUS.CONFLICT.test(rep.text) && r2.srcs.size >= SECOND_MIN_SOURCES;
    // big news about the main name that week that accuses nobody ("‘Choosin’ Texas’ topples Orrey Neskace’s chart record")
    const bigE = r2.srcs.size >= 8 && aboutE && !FOCUS.CONFLICT.test(rep.text);
    if (!linked && !fresh && !(big && aboutE) && !conflict && !bigE) continue;
    // tied to the moment by its own words, or big news about the main name that accuses nobody
    const tied = terms && FOCUS.contentStems(text, new Set()).some((x) => terms.has(x));
    if (!tied && !(r2.srcs.size >= 8 && aboutE && !FOCUS.CONFLICT.test(text))) continue;
    return { angle: r2, text, trace, fresh, linked, big: big || bigE, earlier: r2.last < momentFirst - DAY };
  }
  return null;
}

/**
 * Cities the coverage disagrees on: a capitalised word after "in"/"to"/"at" that is a city or no dictionary word, when another such
 * word stands in the same slot elsewhere. Countries and states are never a clash (Kosovo holds both Peja and Prishtina).
 */
function placeClashOf(items, lex, E) {
  const slots = new Map();
  const broad = (w) => R.PLACES.has(w) && !CITY_WORDS.has(w);
  for (const it of items) {
    for (const m of W.curlQuotes(it.title).matchAll(/\b(?:in|to|at)\s+(\p{Lu}[\p{L}’'-]+)/gu)) {
      const w = words(m[1])[0];
      // (an awards night or a league is where it happened, never a disputed city: "at VMAs")
      if (!w || broad(w) || (E && E.split(' ').includes(w)) || lex.firstNames.has(w) || (W.inDict(w) && !CITY_WORDS.has(w)) || R.TEAM_WORDS.has(w) || SHOW_WORD.test(w)) continue;
      slots.set(w, (slots.get(w) || new Set()).add(it.src));
    }
  }
  const clash = [...slots.keys()];
  if (clash.length < 2) return null;
  return (text) => clash.some((w) => words(text).includes(w));
}
const CITY_WORDS = new Set(R.CITY_LIST);
const SHOW_WORD = /^(?:vmas?|emmys?|oscars?|grammys?|baftas?|tonys?|brits|amas|mtv|nfl|nba|mlb|nhl|wnba|snl)$/;

/** The rows a disputed crowd reaction rests on: "cheers for Neskova", "appears to be booed". */
function contradictionOf(field, E, momentFirst) {
  const rows = uniqByKey(field).filter((it) => FOCUS.CONTRADICT_BOO.test(it.title) && (!E || namesE(it, E)) && Math.abs(it.t - momentFirst) <= 2 * DAY);
  const cheer = (it) => (/\bcheer/i.test(it.title) ? 1 : 0) - (/\?/.test(it.title) ? 1 : 0);
  const it = rows.sort((a, b) => cheer(b) - cheer(a) || FOCUS.outletQuality(b) - FOCUS.outletQuality(a) || a.t - b.t)[0];
  if (!it) return null;
  const t = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '');
  const part = t.split(/\s+[—–]\s+|:\s+/).find((p) => FOCUS.CONTRADICT_BOO.test(p)) || t;
  return { it, outlet: it.outlet, short: part.split(/\s+/).slice(0, 8).join(' ').replace(/[,.;:!?]+$/, '').replace(/^[‘'“"]+|[’'”"]+$/g, '') };
}

/**
 * The context the choosing reads (story-pick.js): the story's field (its pool, nothing a heckler said), which of it is the
 * moment's coverage, how often each word is repeated, the moment's own words, the angles its coverage points at, the names
 * that must not be shown, and the signals tied to the moment's days.
 */
function pickContext(unit, A, env) {
  const { E, pool, lex, now, articles, retells, momentText, contextPool, nameSources, links, trends, wiki, members, dbg } = env;
  const personWord = (w) => [...lex.names].some((n) => n.includes(' ') && n.split(' ').includes(w) && !R.isPlaceOrTeam(n));
  const busyKey = unit.busy && E && unit.query ? words(unit.query.gn).map(stem).filter((w) => !E.split(' ').includes(w)) : [];
  const field = uniqByKey(pool).filter((it) => !FOCUS.CENSORED.test(it.title) && it.t <= now + DAY &&
    (!busyKey.length || (namesE(it, E) && busyKey.some((k) => it.textStems.has(k)))));
  const memberSet = new Set(members);
  // a nameless moment's coverage says more than the search's own words ("iced coffee" alone also finds a Wawa arrest)
  const queryWords = new Set(words(unit.query ? `${unit.query.gn} ${unit.query.wiki || ''}` : '').map(stem));
  const momentKey = E ? [] : FOCUS.contentStems(`${unit.clusters[0].headline} ${momentText}`, new Set()).filter((x) => !queryWords.has(x));
  // a nameless moment's row carries two of its own words ("Fennsy" alone also finds a fact check about a wedding photo)
  const keyHits = (it) => momentKey.filter((k) => it.textStems.has(k)).length;
  if (dbg) dbg(`   [momentKey] ${momentKey.join(',')} query=${unit.query ? unit.query.gn : '-'}`);
  // (a row that carries every word of the story search counts that as one of the two)
  const qAll = [...queryWords].filter((w) => w.length > 2);
  const hasQuery = (it) => qAll.length > 0 && qAll.every((w) => it.textStems.has(w));
  const isMom = (it) => A.isMom(it) && (E ? memberSet.has(it) || namesE(it, E) : !momentKey.length || keyHits(it) + (hasQuery(it) ? 1 : 0) >= Math.min(2, momentKey.length));
  const momItems = uniqByKey(field.filter(isMom));
  const eParts = new Set(E ? E.split(' ') : []);
  const qWords = !E && unit.query ? words(unit.query.gn).flatMap((w) => [w, w.replace(/s$/, ''), `${w}s`]) : [];
  const skip = new Set([...eParts, ...qWords, 'says', 'said', 'new', 'viral', 'video', 'watch']);
  const supportSkip = new Set([...eParts, 'says', 'said', 'new', 'viral', 'video', 'watch']);
  const momentOwn = new Set([...A.m.stems, ...(A.m.action ? [A.m.action] : []), ...A.m.opener, ...A.m.pseudo].filter((k) => k.startsWith('w:')).map((k) => k.slice(2)));
  // team, place and name words most of the moment's coverage carries ("packers", "minnesota", "aces")
  const anchorCount = new Map();
  for (const it of momItems) {
    for (const w of new Set(words(it.title))) {
      if (w.length > 2 && (R.TEAM_WORDS.has(w) || R.PLACES.has(w) || lex.proper.has(w)) && !W.STOP.has(w)) anchorCount.set(stem(w), (anchorCount.get(stem(w)) || 0) + 1);
    }
  }
  const anchorWords = [...anchorCount].filter(([, n]) => n >= Math.max(2, 0.3 * momItems.length)).map(([w]) => w).filter((w) => !eParts.has(w));
  const vocab = new Set(momItems.flatMap((it) => [...it.textStems]));
  const keepNames = new Set([E, ...(unit.clusters[0].mainEnts || [])].filter(Boolean));
  for (const [n, k] of nameSources) if (k >= 3) keepNames.add(n);
  for (const w of wiki) keepNames.add(w.key);
  const ctx = {
    E, lex, now, dbg, articles, retells, momentText, contextPool, field, momItems, skip, supportSkip, momentOwn, anchorWords,
    m: A.m, angles: A.angles, isMom, members, isStrong: (it) => isStrongMoment(it, A.m), momentFirst: A.momentFirst,
    df: FOCUS.docFreq(field), caseItems: field, keepNames,
    priv: FOCUS.privateNames(field, new Map([...nameSources].filter(([n]) => field.some((it) => it.allNames.includes(n))))),
    pointers: A.ranked.filter((r) => r.inCause || r.trend).map((r) => r.a.key),
    causePointers: A.ranked.filter((r) => r.inCause).map((r) => r.a.key),
  };
  const momentStems = [...momentOwn].filter((s) => !eParts.has(s));
  ctx.placeClash = placeClashOf(field.filter((it) => Math.abs(it.t - A.momentFirst) <= 3 * DAY && (!E || namesE(it, E))), lex, E);
  const specific = momentStems.filter((s) => !W.GENERIC.has(s) && (ctx.df.get(s) || 0) < 0.5 * field.length);
  ctx.momentRows = field.filter((it) => Math.abs(it.t - A.momentFirst) <= 3 * DAY && (E ? namesE(it, E) : true) &&
    specific.filter((s) => it.textStems.has(s)).length >= (E ? 1 : 2));
  ctx.corr = FOCUS.correctionsOf(field, { E, isMom, momentStems, momentFirst: A.momentFirst });
  ctx.contradict = contradictionOf(pool.filter((it) => !FOCUS.CENSORED.test(it.title)), E, A.momentFirst);
  ctx.contested = (A.m.action === 'w:boo' || /\bboo(?:s|ed)?\b/i.test(momentText)) && !!ctx.contradict;
  // a query of teams or places only ("twins vs giants") measures the game, not the moment: it counts only for an event story
  const anchorOf = (w) => eParts.has(w) || personWord(w);
  ctx.searchArgs = { momentFirst: A.momentFirst, vocab, anchorOf, trends, now };
  ctx.eventArgs = { ...ctx.searchArgs, anchorOf: (w) => anchorOf(w) || R.TEAM_WORDS.has(w) || R.PLACES.has(w) };
  ctx.titled = new Set(field.filter((it) => it.capToks).flatMap((it) => [...it.capToks]).filter((w) => !W.inDict(w)));
  ctx.search = searchOf(unit, null, links, E, ctx.searchArgs);
  ctx.eventSearch = searchOf(unit, null, links, E, ctx.eventArgs);
  ctx.wikiSpike = wikiOf(E, wiki, members, A.momentFirst);
  // the moment's own coverage wherever it was saved (a busy name's field keeps only the story's rows): the hook's candidates
  const act = A.m.action && A.m.action.startsWith('w:') ? A.m.action.slice(2) : null;
  const own = [...momentOwnStems(A.m)];
  const marked = (it) => (act && it.textStems.has(act)) || own.filter((s) => it.textStems.has(s)).length >= Math.min(2, own.length);
  ctx.hookRows = uniqByKey([...members, ...pool, ...(E && act ? contextPool.filter((it) => namesE(it, E) && it.textStems.has(act)) : [])])
    .filter((it) => it.t >= A.momentFirst - DAY && it.t <= now + DAY && (!E || namesE(it, E)) && (A.isMom(it) || marked(it)));
  return ctx;
}

/** The moment's own story words: its action and the words it is told with, not the main name. */
const momentOwnStems = (m) => new Set([...m.stems, ...(m.action ? [m.action] : [])].filter((k) => k.startsWith('w:')).map((k) => k.slice(2)).filter((s) => !ANGLE_STOP.has(s)));

const BIG_MARKETS = new Set(['com', 'org', 'net', 'uk', 'us', 'news', 'co', 'tv', 'io', 'media']);
/** Every outlet of the moment's coverage sits on one small country's domain (.nz): regional news, not a worldwide moment. */
function localOnly(rows) {
  const tlds = new Set();
  let n = 0;
  for (const it of SW.firstCopies(rows)) {
    const host = ((it.publisherUrl || '').match(/^https?:\/\/([^/]+)/) || [])[1];
    if (!host) { if (it.fam === 'reddit' || it.fam === 'bluesky' || it.fam === 'kym') return false; continue; }
    tlds.add(host.split('.').pop().toLowerCase());
    n++;
  }
  return n >= 2 && tlds.size === 1 && !BIG_MARKETS.has([...tlds][0]);
}

// whose wedding: "her cousin's wedding" in two outlets' titles
const REL_RE = /\b(her|his|their)\s+(cousin|sister|brother|best friend|friend|niece|nephew|son|daughter)['’]s\b[^.;:]{0,40}\bwedding\b/i;
/** "... videos from ‘big Albanian wedding’" -> "... from her cousin's ‘big Albanian wedding’", when two outlets say whose it was. */
function withRelation(text, P) {
  if (!/\bwedding\b/i.test(text) || /\b(her|his|their|own|cousin|sister|brother|friend)['’s]*\s+(?:[\p{L}‘’'-]+\s+){0,3}wedding\b/iu.test(text)) return text;
  const rels = new Map();
  for (const it of uniqByKey(P.field)) {
    const m = W.curlQuotes(it.title).match(REL_RE);
    if (!m || (P.E && !namesE(it, P.E))) continue;
    const k = `${m[1].toLowerCase()} ${m[2].toLowerCase()}’s`;
    rels.set(k, (rels.get(k) || new Set()).add(String(it.outlet || it.src).toLowerCase()));
  }
  const top = [...rels.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  if (!top || top[1].size < 2) return text;
  return text.replace(/\b(from|at|for)\s+(?:a\s+|the\s+)?([‘'“"]?(?:[\p{L}-]+\s+){0,3}wedding[’'”"]?)/iu, `$1 ${top[0]} $2`);
}

/** A trailing parenthetical is clutter in a shown line ("(reaction mixed)", "(in theaters October 16)"): the why carries such notes. */
const noParen = (text) => String(text || '').replace(/\s*\([^()]{2,60}\)\s*$/, '').trim();

// a nationality is no card's subject ("British tourist ...")
const DEMONYM = /^(?:british|american|english|irish|scottish|welsh|australian|canadian|french|german|italian|spanish|chinese|japanese|korean|russian|mexican|indian)$/;
const HEADLINE_MAX_WORDS = 14;
const RECORD = /\b(breaks? (?:the |a )?record|record for|makes history|most-awarded|most ever|first (?:ever|in \d+ years))\b/i;
// a game, a summit, a tour or a release: the story under the clip, never the card's headline
const RESULT_OR_REPORT = /\b(vs\.?|\d{1,3}-\d{1,3}|upset|wins?|won|beats?|loss|loses|lost|defeat\w*|summit|state visit|visit|launch\w*|farewell|career|tour|premiere\w*|opener|finale|ratings|box office|opens to|viewing figures)\b/i;
// what people are talking about, as a story line says it: a backlash, a fight, a debate, a reversal
const TALKED_ABOUT = /\b(backlash|debate|divid\w*|split|fury|outrage\w*|boycott\w*|feud\w*|row|slams|criticis\w+|defends?|responds?|denies|apologi[sz]\w*|reverse\w*|after all|backtrack\w*|go(?:es)? viral|went viral)\b/i;
/**
 * The story is the headline when it is what people are talking about and names the moment's subject (or the moment has none): a
 * backlash ("Tavix Ostiss faces backlash over alleged Palestine stance", the SNL UK roast its moment), a reversal ("Meta and YouTube say
 * they will run ads for ‘Fennsy’ documentary after all"), a debate or a meme database's topic told as who did what. A game result, a
 * summit or a tour launch stays the story under the clip.
 */
function headlineFromStory(story, P) {
  if (!story || !story.text) return false;
  const text = noParen(story.text);
  const n = text.split(/\s+/).length;
  if (n < 3 || n > HEADLINE_MAX_WORDS || /\?/.test(text) || FOCUS.CLICKBAIT.test(text) || FOCUS.OPINION.test(text) || FOCUS.VAGUE.test(text)) return false;
  if (story.backlash || story.kind === 'update' || story.kind === 'denial') return true;
  const namesSubject = !P.E || contains(words(text).join(' '), P.E);
  if (!namesSubject) return false;
  // a record or a first is what the night is remembered for ("Esselle Quillith makes history with most ever wins at MTV VMAs")
  if (RECORD.test(text) && (words(text).join(' ') + ' ').startsWith(`${P.E} `)) return true;
  if (story.kind === 'topic') return true;
  return ['saga', 'context', 'cause', 'reaction'].includes(story.kind) && TALKED_ABOUT.test(text) && !RESULT_OR_REPORT.test(text);
}

// a preview or a schedule is not the story happening ("Gophers open Big Ten play at Washington Saturday")
const PREVIEW_ROW = /\b(preview|how to watch|where to watch|what to know|set to|keys to|predictions?|odds|picks?|ahead of|opens? .{0,25}\bplay\b|to face|will (?:face|play|host|start))\b/i;
const GAME_RESULT = /\b\d{1,3}-\d{1,3}\b|\bupset\b|\b(?:wins?|won|beats?|loss|loses|lost)\b.*\b(?:at|over|to|against)\b/i;
/** When the story began: its own date, else the first of its angle's rows that tells it (two of its words), previews left out. */
function storyStart(story, momentFirst) {
  // a game's result happened when its title says it did (the Gophers' upset on the 27th, not the preview on the 21st)
  if (story.it && GAME_RESULT.test(story.text)) return story.it.t;
  const items = story.items || (story.angle ? story.angle.items : null);
  const fallback = story.since || (story.angle ? story.angle.first : momentFirst);
  if (!items || !items.length) return fallback;
  const st = new Set(FOCUS.contentStems(story.text, new Set()));
  const rows = items.filter((i) => !PREVIEW_ROW.test(i.title) && FOCUS.contentStems(i.title, new Set()).filter((x) => st.has(x)).length >= Math.min(3, st.size));
  return rows.length ? Math.max(Math.min(...rows.map((i) => i.t)), Math.min(fallback, momentFirst)) : fallback;
}

const STALE_STORY_DAYS = 3;
/** A story line that is out of date for the moment: an announcement of what was coming, or the moment's own arc from days before. */
const SPECULATIVE = /\b(?:could|might)\s+(?!have\b)\p{L}+/iu;
function staleStory(x, momentFirst, P = null) {
  // another listed card's story ("Esselle Quillith makes surprise appearance at 2026 Emmy Awards" under Pellia Sorrenko's doomscrolling clip)
  const tw = words(x.text).join(' ');
  if (P && !x.article && (P.otherAnchors || []).some((a) => (tw + ' ').startsWith(`${a} `))) return true;
  // a title with no verb is a label, not a story ("Brinena Hassiss’s Velix Graviss documentary ‘You Can See Everything’")
  if (!x.article && !T.hasVerb(x.text) && !/\s(?:get|gets|got|win|wins|won|beat|beats|hit|hits|top|tops|opens?|is|are|was|were|has|have|had)\s/i.test(x.text)) return true;
  // a guess, "... could interrupt coaches’ headsets, they warn", says what might happen, not what did
  if (!x.article && SPECULATIVE.test(x.text)) return true;
  const t = x.it ? x.it.t : null;
  if (!Number.isFinite(t)) return false;
  if (FOCUS.FUTURE.test(x.text) && t < momentFirst - DAY) return true;
  return x.kind === 'reaction' && t < momentFirst - STALE_STORY_DAYS * DAY;
}

/** A legacy angle story shown only when its line passes the wording rules. */
function safeStory(story, ctx) {
  if (!story) return null;
  if (FOCUS.CENSORED.test(story.text) || FOCUS.unsafeLine(story.text) || FOCUS.namesPrivate(story.text, ctx.priv, ctx.keepNames)) return null;
  const text = FOCUS.recaseFrom(FOCUS.safeLine(story.text, { contested: ctx.contested }), ctx.caseItems, ctx.lex);
  if (FOCUS.REVIEW.test(text) || FOCUS.OPINION.test(text) || FOCUS.SELF_DEFENSE.test(text) && !FOCUS.CONFLICT.test(text)) return null;
  return { ...story, text };
}

function storyFor(unit, { universe, universeKeys, universeByKey, busy, lex, trends, wiki, lookups, now, prepareRaw, contextPool, nameSources, otherAnchors }) {
  const c = unit.clusters[0];
  const E = unit.anchor;
  const { deep, articles } = lookupsFor(unit, lookups, prepareRaw, lex, universeKeys, universeByKey);
  const { members, pool } = storyPool(unit, universe, deep, busy);
  const ctx = { E, pool, members, deepSet: new Set(deep), links: trendLinks(trends, E, now), lex };
  const dbg = debugFor(c);
  const shape = shapeOf(c.headline);
  const queryWords0 = new Set(words(unit.query ? `${unit.query.gn} ${unit.query.wiki || ''}` : '').map(stem));
  let A = analyze(unit, ctx, c.headline);
  // the moment's trace: its surest coverage first, then the rest of it, nearest the moment first
  // (only the moment's own coverage when it has any: a cluster can carry an unrelated title that shares a name)
  const lineKey = FOCUS.contentStems(c.headline, new Set()).filter((x) => !queryWords0.has(x) && !W.GENERIC.has(x));
  const ordering = (An) => {
    const own = An.cov.filter((i) => An.isMom(i) && !FOCUS.CENSORED.test(i.title) && (E || lineKey.filter((k) => i.textStems.has(k)).length >= Math.min(2, lineKey.length) ||
      (lineKey.some((k) => i.textStems.has(k)) && [...queryWords0].filter((w) => w.length > 2).every((w) => i.textStems.has(w)))));
    return (own.length ? own : An.cov).slice().sort((a, b) => Number(isStrongMoment(b, An.m)) - Number(isStrongMoment(a, An.m)) ||
      Math.abs(a.t - An.momentFirst) - Math.abs(b.t - An.momentFirst));
  };
  let ordered = ordering(A);
  let moment = { text: c.headline, trace: traceItems(ordered.find((i) => i.fam !== 'reddit') || ordered[0], ordered, true).map(traceTitle) };
  let aftermath = null;
  const after = shape === 'aftermath' ? aftermathClip(c, E, A, { pool, members, lex, now, dbg }) : null;
  if (after) {
    aftermath = moment;
    moment = { text: after.clip.text, trace: traceItems(after.clip.it, after.before).map(traceTitle) };
    A = analyze(unit, ctx, `${after.clip.text} ${after.origText}`);
    ordered = ordering(A);
  }
  const { retells } = retellTest(A, { E, pool, members, momentText: moment.text });
  const P = pickContext(unit, A, { E, pool, lex, now, articles, retells, momentText: moment.text, contextPool, nameSources,
    links: ctx.links, trends, wiki, members, dbg });
  P.momTrace = moment.trace;
  // the other listed cards' main names: a why clause about one of them is that card's news, not this one's
  P.otherAnchors = (otherAnchors || []).filter((a) => a && E && a !== E && !contains(a, E) && !contains(E, a));
  // STORY_FIELD=regex with STORY_DEBUG: the story field's titles that match, oldest first
  if (dbg && process.env.STORY_FIELD) {
    const fre = new RegExp(process.env.STORY_FIELD, 'i');
    for (const it of P.field.filter((i) => fre.test(i.title)).sort((a, b) => a.t - b.t)) dbg(`      field ${ymd(it.t)} ${it.outlet} | ${it.title}${it.drop ? ` (${it.drop})` : ''}`);
  }
  P.topic = shape === 'story';
  // a card already flagged sensitive (a crime, a tragedy) may say what its sensitive rows say: that is its story (no content filter)
  P.sensitiveCard = unit.clusters.some((x) => x.sensitive);
  P.busy = !!unit.busy;
  if (dbg) dbg(`   [pick] E=${E} momentOwn=${[...P.momentOwn].join(',')} anchors=${P.anchorWords.join(',')} contested=${P.contested} corr=${Object.entries(P.corr).map(([k, v]) => `${k}:${v.length}`).join(' ')} search=${P.search ? P.search.keyword : '-'}`);
  // the moment as its coverage tells it (a story-shaped headline keeps its story and finds where it began, below)
  let headFlaws = [];
  if (shape !== 'story') {
    const ml = PICK.momentLine(P, moment.text);
    P.note = ml.note;
    if (shape === 'clip') headFlaws = ml.headFlaws;
    if (ml.text !== moment.text) {
      moment = { text: ml.text, trace: ml.it ? traceItems(ml.it, ordered).map(traceTitle) : moment.trace };
      P.momentText = moment.text;
    }
    // the show or host its coverage names ("on Bexia Tamiss Uncensored"), and a reported claim's hedge ("reportedly reject")
    const told = SHAPE.hedgedClaim(SHAPE.withVenue(moment.text, P), P);
    if (told !== moment.text) { moment = { ...moment, text: told }; P.momentText = told; }
  }
  const queryWords = new Set(words(unit.query ? `${unit.query.gn} ${unit.query.wiki || ''}` : '').map(stem));
  let story = PICK.correctionStory(P);
  P.vocab = new Set(P.momItems.flatMap((it) => [...it.textStems]));
  if (!story && shape === 'story') {
    // a headline that is already the story ("Debate over iced coffee at interviews"): the moment is where it began
    const origin = originOf(A.cov, E, lex, c, dbg);
    const originOk = origin && traceable(origin.trace) && !FOCUS.OPINION.test(origin.text) && !FOCUS.unsafeLine(origin.text) &&
      !A.cov.some((it) => PICK.setupFragment(it.title, origin.text));
    const ml = originOk ? { text: origin.text, it: null } : PICK.momentLine(P, c.headline, { replace: true });
    const text = ml.text !== c.headline ? ml.text : null;
    if (text && text !== c.headline) {
      // (a curiosity gap, "... bringing this to job interviews", is no story line: the moment's line that names it stands in)
      story = { kind: 'topic', text: FOCUS.safeLine(FOCUS.CLICKBAIT.test(c.headline) ? text : c.headline), trace: moment.trace, items: A.cov, since: A.momentFirst };
      moment = { text, trace: ml.it ? traceItems(ml.it, ordered).map(traceTitle) : originOk ? origin.trace : moment.trace };
      P.momentText = moment.text;
    }
    // a meme database's label is no story: who did what, and that people fought over it
    const told = story && SHAPE.topicStory(P, A, c.headline, queryWords);
    if (told) {
      story = { ...story, text: told.text, trace: told.trace, it: told.it };
      // the moment must not retell the story: where it began instead ("A Globe story about ... went viral")
      const same = FOCUS.contentStems(moment.text, P.skip).filter((x) => FOCUS.contentStems(told.text, P.skip).includes(x)).length;
      const origin2 = same >= 3 ? SHAPE.originViral(P, A) : null;
      if (origin2) { moment = origin2; P.momentText = moment.text; }
    }
  }
  const repeats = shape === 'story' ? [] : PICK.repeatEvents(P);
  if (!story && shape !== 'story') {
    // a private person's moment at a game or show ("Distraught Packers fan ..."): the event is the story unless the crowd turned on it
    const crowd = !E || R.CROWD_SUBJECT.test(c.headline);
    // the story the moment's own headlines name ("amid reported Korory Fennurn romance") beats the moment's own aftermath
    // (a story line from before the moment that only announced what was coming, or the moment's own arc told a week earlier, is
    // stale: "Zorrr is opening the VMAs", a friendship "backlash" twelve days before the clip)
    const fresh = (x) => { const bad = x && staleStory(x, A.momentFirst, P); if (bad && dbg) dbg(`   [stale story] ${x.text}`); return bad ? null : x; };
    const focus = fresh(PICK.correctionStory(P)) || fresh(PICK.controversyStory(P)) || fresh(PICK.repeatStory(P, repeats)) || fresh(SHAPE.coMentionStory(P, A, pool)) ||
      fresh(SHAPE.workStory(P)) || fresh(PICK.focusStory(P));
    story = (crowd && focus && focus.kind === 'context' && !focus.arc ? fresh(PICK.contextStory(P)) || focus : focus) ||
      fresh(safeStory(pickStory(A, { E, lex, articles, momentText: moment.text, retells, dbg, pool }), P)) || fresh(PICK.contextStory(P)) ||
      fresh(safeStory(framingStory(A, { E, lex, momentText: moment.text, dbg }), P));
  }
  // a Wikipedia page named for the controversy tells it: the backlash against the main name, else the page's cause
  if (story && story.article) {
    const al = SHAPE.backlashLine(P, story.article) || SHAPE.articleLine(P, story.article);
    if (al) story = { ...story, text: al.text, trace: al.trace, keys: [...(story.keys || []), ...al.keys], causeLine: al.causeLine || null, backlash: !!al.backlash };
  }
  // a context story must be tied to the moment (its words, or the same event): an award days later is not why a clip spread
  if (story && !SHAPE.linkedToMoment(P, story)) {
    if (dbg) dbg(`   [gate] context story not tied to the moment: ${story.text}`);
    story = SHAPE.momentContextStory(P);
  }
  // a ratings release is a report: its conflict is the story, and the clip people shared that day the moment
  if (story) story = { ...story, text: withRelation(SHAPE.reportStoryText(story.text, P), P) };
  const swapped = SHAPE.reportMoment(P, story);
  if (swapped) { moment = { text: swapped.text, trace: swapped.trace }; P.momentText = moment.text; }
  if (story && story.rank && story.rank.trend) P.search = searchOf(unit, story, ctx.links, E, P.searchArgs);
  if (story && story.kind === 'context' && !P.search) P.search = searchOf(unit, story, ctx.links, E, P.eventArgs);
  // the moment is a turn of this story (not an event found beside it): its coverage keeps the moment fresh
  P.ownStory = !!story && ['saga', 'update', 'reaction', 'topic', 'denial', 'repeat'].includes(story.kind);
  const safe = (rep) => {
    const x = PICK.lineOf(rep.it, P);
    return x && !FOCUS.REVIEW.test(rep.it.title) && !FOCUS.EXPLAINER.test(rep.it.title) && !FOCUS.LOGISTICS.test(x.text) && !FOCUS.META.test(x.text) ? x.text : null;
  };
  P.terms = SHAPE.momentTerms(P);
  // a reported claim keeps its hedge in the why too
  P.hedgeClaim = (text) => SHAPE.hedgedClaim(text, P);
  const second = story && !unit.busy && story.kind !== 'repeat' ? pickSecond(A, { ...story, keys: story.keys || [] }, { E, lex, now, retells, safe, terms: P.terms, momentLineText: moment.text }) : null;
  const siblings = PICK.siblingMoments(P, story);
  // on-topic rows: the moment's coverage and the story's own titles, syndicated copies once
  const keyTerms = FOCUS.contentStems(`${moment.text} ${story ? story.text : ''}`, P.skip).filter((x) => !queryWords.has(x) && !W.GENERIC.has(x));
  // a row beside the moment's own coverage needs two of its words (a fact check that only says "Fennsy" is another story)
  const momSet = new Set(P.momItems);
  const onTopicAll = uniqByKey([...P.momItems, ...P.momentRows, ...(story && story.items ? story.items : [])]).filter((i) => i.t <= now + DAY &&
    (!keyTerms.length || keyTerms.filter((k) => i.textStems.has(k)).length >= (E && momSet.has(i) ? 1 : Math.min(2, keyTerms.length))));
  const seen = new Set();
  P.onTopic = onTopicAll.filter((i) => { const k = FOCUS.titleKey(i); return seen.has(k) ? false : seen.add(k); }).sort((a, b) => a.t - b.t);
  const headText0 = FOCUS.recaseFrom(FOCUS.safeLine(c.headline, { contested: P.contested }), P.caseItems, P.lex);
  const why = PICK.whyLine(P, story, { aftermath, second: second && (second.linked || second.big || second.fresh || second.earlier) ? second : second,
    note: P.note, said: [moment.text, story ? story.text : '', headlineFromStory(story, P) ? '' : headText0] });
  const veto = PICK.gate(P);
  // one small market's press only (every outlet on one country domain, not the US or UK: "Auckland teacher ..."): it lists last
  // (the gate's weighting is in story-pick.js sourceWeight)
  const nearRows = [...P.momItems, ...(P.hookRows || []), ...P.momentRows].filter((it) => Math.abs(it.t - A.momentFirst) <= 1.5 * DAY && FOCUS.outletQuality(it) > -1);
  const isLocal = localOnly(nearRows);
  if (dbg) dbg(`   [gate] ${veto || 'ok'} onTopic=${P.onTopic.length} srcs=${new Set(P.onTopic.map((i) => i.src)).size}`);
  if (dbg) for (const i of [...P.onTopic.slice(0, 4), ...P.onTopic.slice(-3)]) dbg(`      onTopic ${ymd(i.t)} ${i.outlet} | ${i.title.slice(0, 90)}${P.momItems.includes(i) ? ' [mom]' : ''}`);
  // (another moment's headline passes the same wording rules: "becuase", no parentheticals)
  const also = [...unit.clusters.slice(1).map((x) => noParen(FOCUS.recaseFrom(FOCUS.safeLine(x.headline), P.caseItems, P.lex))), ...siblings.map((s) => s.text)];
  // the listed headline, shown where the story step is not used yet, passes the same wording rules or gives way to the moment
  const headText = headText0;
  const headBad = headFlaws.length > 0 || FOCUS.unsafeLine(headText) || FOCUS.OPINION.test(headText) || FOCUS.namesPrivate(headText, P.priv, P.keepNames) ||
    (!!swapped && SHAPE.REPORT.test(headText)) ||
    (P.corr.intentional.length > 0 && FOCUS.ACCIDENT.test(headText));
  // no trace repeats a heckler's accusation, a label on someone or a private person's name
  const clean = (tr) => tr.filter((e) => e.kind !== 'title' || !(FOCUS.CENSORED.test(e.text) || FOCUS.LABEL.test(e.text) || FOCUS.namesPrivate(e.text, P.priv, P.keepNames)));
  // the card's headline names the story, not the clip, when the story is what people are talking about (a backlash, a reversal,
  // a debate); the clip stays the moment
  // (a headline with no verb, "Esselle Quillith's 'Pink Clouding' lyrics", gives way to a story line about the same subject that has one)
  const verbless = (t) => !T.hasVerb(t);
  const storyNamesE = story && (!E || contains(words(story.text).join(' '), E)) && T.hasVerb(story.text) && story.text.split(/\s+/).length <= HEADLINE_MAX_WORDS;
  // (a flawed listed headline gives way to the story line when that names the subject and says what happened, else to the moment)
  // (a tabloid's framing of the listed headline, "Zorrr branded ...", gives way to the story line when that names the subject)
  const tabloid = headFlaws.includes('opinion') || headFlaws.includes('label');
  const shown = headBad || FOCUS.CLICKBAIT.test(headText) ? (tabloid && storyNamesE && !FOCUS.OPINION.test(story.text) ? story.text : moment.text) : headText;
  const headline = FOCUS.quoteWordCase(noParen(headlineFromStory(story, P) || (verbless(shown) && storyNamesE) ? story.text : shown), lex);
  return {
    unit, cluster: c, anchor: E, query: unit.query, headline, subject: E && nameLike(E) && !DEMONYM.test(E) ? surfaceOf(E, P.momItems.length ? P.momItems : members) : null,
    // told by the event it happened at (or by nothing bigger): search the event's Trends query for its result
    eventQuery: P.eventSearch && (!story || story.kind === 'context') ? eventQuery(P.eventSearch.keyword) : null, poolSize: pool.length, deepSize: deep.length, articles: articles.slice(0, 3), shape,
    story: FOCUS.quoteWordCase(noParen(story ? story.text : moment.text), lex), storyKind: story ? story.kind : 'moment', momentFirst: A.momentFirst,
    storySince: story ? Math.min(storyStart(story, A.momentFirst), ['reaction', 'update', 'denial', 'repeat', 'topic'].includes(story.kind) ? A.momentFirst : Infinity) : A.momentFirst,
    storyTrace: clean(story ? story.trace : moment.trace),
    moment: FOCUS.quoteWordCase(noParen(moment.text), lex), momentTrace: clean(moment.trace), also,
    why: why ? FOCUS.quoteWordCase(why.text, lex) : null, whyTrace: why ? clean(why.trace) : [], veto, localOnly: isLocal, onTopic: P.onTopic,
    // the moment's own coverage (a story-shaped headline's is the story's), for its heat
    heatRows: story && story.kind === 'topic' ? SW.topicRows(P, story) : uniqByKey([...P.momItems, ...P.momentRows, ...(P.hookRows || [])]),
    angles: A.angles.filter((a) => a.srcs.size >= 2).sort((x, y) => y.srcs.size - x.srcs.size).slice(0, 8), ranked: A.ranked.slice(0, 4), second,
  };
}

/**
 * Stories for the listed moments. `prepareRaw` turns a stored row into a prepared item (its drop reason included), so the story
 * search rows pass the same safety rules; `lookups` holds the story searches (see lookupTargets); `idf` is the corpus word weight.
 * The context step reads every saved story search too (the Packers' booed home opener sits in another story's search).
 */
function buildStories({ top, all, lex, trends, wiki, lookups, now, prepareRaw, idf }) {
  const universe = all.filter((it) => (!it.drop || CONTEXT_DROPS.has(it.drop))).map((it) => readyItem(it, lex));
  const nameItems = new Map();
  for (const it of universe) for (const n of it.allNames) nameItems.set(n, (nameItems.get(n) || 0) + 1);
  const busy = (n) => (nameItems.get(n) || 0) >= BUSY_NAME_ITEMS;
  const units = mergeUnits(top, lex, busy);
  // a nationality is no story's main name ("British tourist ...": a news search for "British" finds a terror plot)
  for (const u of units) if (u.anchor && DEMONYM.test(u.anchor)) u.anchor = null;
  for (const u of units) {
    // a name is busy for this story when it is in many saved items and this story holds few of them (Neskova, not Tavix Ostiss)
    const memberKeys = new Set(u.clusters.flatMap((c) => c.items.map((i) => i.key)));
    const withE = u.anchor ? universe.filter((it) => namesE(it, u.anchor)) : [];
    // (the story's own second names count too: Tavix Ostiss's items are mostly about Plonker, Neskova's are about everything)
    const seconds = new Set([...u.names.entries()].filter(([n, k]) => u.anchor && !sameName(n, u.anchor) && !contains(n, u.anchor) && !contains(u.anchor, n) &&
      nameLike(n) && (k >= 2 ? n.includes(' ') || !W.isDictWord(n) : !n.includes(' ') && !W.isDictWord(n))).map(([n]) => n));
    const own = (it) => memberKeys.has(it.key) || it.allNames.some((n) => seconds.has(n));
    const share = withE.length ? withE.filter(own).length / withE.length : 1;
    u.busy = !!u.anchor && withE.length >= BUSY_NAME_ITEMS && share < FOCUS_SHARE;
    u.share = share;
    // the names the main name's saved items carry with it, for the saga partner the Wikipedia search pairs it with
    u.withE = withE.length;
    u.coNames = new Map();
    for (const it of withE) for (const n of new Set(it.allNames)) u.coNames.set(n, (u.coNames.get(n) || 0) + 1);
    u.query = lookupQuery(u, busy, idf);
  }
  const universeKeys = new Set(universe.map((i) => i.key));
  // the main name's own story search counts toward its saga partner too: its news over the window ("Tavix Ostiss" when:14d, half of
  // it naming Plonker) says what the name's story is better than the few items the feeds saved
  for (const u of units) {
    if (!u.anchor || !u.query) continue;
    const searched = lookupsFor(u, lookups, prepareRaw, lex, universeKeys).deep.filter((it) => namesE(it, u.anchor));
    if (!searched.length) continue;
    u.withE += searched.length;
    for (const it of searched) for (const n of new Set(it.allNames)) u.coNames.set(n, (u.coNames.get(n) || 0) + 1);
    u.query = lookupQuery(u, busy, idf);
  }
  const searched = allStoryRows(lookups, prepareRaw, lex, universeKeys);
  const contextPool = uniqByKey([...universe, ...searched]);
  // how many separate outlets print each name: a name only one or two print is a private person's
  const nameSources = new Map();
  for (const it of contextPool) for (const n of it.allNames) { if (!nameSources.has(n)) nameSources.set(n, new Set()); nameSources.get(n).add(it.src); }
  const nameCounts = new Map([...nameSources].map(([n, s]) => [n, s.size]));
  const universeByKey = new Map(universe.map((i) => [i.key, i]));
  const otherAnchors = units.map((u) => u.anchor).filter(Boolean);
  const stories = units.map((u) => storyFor(u, { universe, universeKeys, universeByKey, busy, lex, trends, wiki, lookups, now, prepareRaw, contextPool, nameSources: nameCounts, otherAnchors }));
  return { units, stories };
}

module.exports = { buildStories, lookupTargets, parseWikiSearch, slug, CONTEXT_DROPS, DEEP_MAX, WIKI_STORY_MAX };
