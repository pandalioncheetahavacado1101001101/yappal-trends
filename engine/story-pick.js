'use strict';
/*
 * Story step, choosing the three lines. The story is the real thing people are talking about: a Wikipedia page named for the
 * controversy when there is one, else the title the story's coverage repeats most that says who did what to whom (a conflict
 * outranks a defence, a review, an explainer or day-one logistics), else the event the moment happened at (the game, the show,
 * the tour, the summit). The moment is told the way most of its coverage tells it, in neutral words. A correction rewrites or
 * vetoes both. The why is one line of stakes: the story's biggest turn, its latest escalation and how big it is, each clause
 * resting on saved titles from the moment's days. Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const { contains, uniqByKey } = require('./util');
const T = require('./story-terms');
const L = require('./story-lines');
const F = require('./story-focus');
const SW = require('./story-why');

const { DAY, HOUR, words, stem, uniq, ymd, fmtVolume, surfaceOf, carries, probe, hasVerb, openQuoteAtEnd, DANGLING, AFTERMATH, namesE, cutDangles } = T;

const STORY_MIN = 5; // a story line scores at least this
const CONTEXT_MIN = 3.5;
const LINK_WEIGHT = 2.5;
const POINTER_BONUS = 1.5;
const EARLY_BONUS = 1.5;
const FRESH_MAX_DAYS = 7; // a moment older than a week needs a follow-up in the last 72 h
const QUIET_MAX_DAYS = 5; // coverage that stopped this long ago is over
const MIN_SOURCES = 3; // independent sources for a listed idea
const POPULAR_TOP_RANK = 5; // r/popular's top five posts of the day ...
const POPULAR_TOP_WEIGHT = 2; // ... count as two independent sources
const FOLLOW_UP_HOURS = 72;
const LATEST_HOURS = 96;
const WHY_MAX_CHARS = 170; // one or two clauses a viewer takes in at a glance
const WHY_MAX_CLAUSES = 2;
const WHY_FALLBACK_NEW = 3;
const WHY_DUP_OVERLAP = 0.5; // two clauses sharing more than half their words say one thing
const WHY_SAID_ALL = 0.5; // a clause whose words the headline, story and moment together already hold says nothing new
// words that add nothing a viewer can use ("became an instant hilarious meme")
const FILLER_STEMS = new Set(['instant', 'hilariou', 'hilarious', 'became', 'becom', 'become', 'viral', 'meme', 'internet', 'fan', 'people', 'video', 'clip',
  'moment', 'goe', 'go', 'went', 'wild', 'crazy', 'react', 'reaction', 'online', 'social', 'media', 'user', 'post', 'watch']);
const WHY_SAID_OVERLAP = 0.5; // a clause sharing this much with the headline, story or moment says it again
// an accident most outlets reported: a maker's claim that it was on purpose is said against it
const GLITCH = /\b(glitch\w*|malfunction\w*|bugs? out|bugged out)\b/i;
const GLITCH_MIN_SOURCES = 3;
// a roundup of the night is no reason one moment spread ("Best and worst moments of the 2026 MTV Video Music Awards")
// someone said or did something: the substance a fallback why tells
const SAID_DID = /\b(says?|said|reveals?|revealed|explains?|explained|smacks? down|pushes back|pushed back|hits back|calls? (?:\w+ )?out|called (?:\w+ )?out|urges?|urged|tells?|told|responds?|responded|defends?|defended|claps? back|ghosted|admits?|jokes?|joked|encourages?|slams?|slammed|speaks? out|addresses|apologi[sz]\w*|shares?|posts?|thanks?)\b/i;
const LISTICLE = /\b(?:best and worst|best|worst|biggest|top \d+|every|all the)\b.{0,40}\b(?:moments|looks|outfits|performances|winners|highlights|reactions)\b/i;
const SIBLING_MIN_SOURCES = 2;
const CONTEXT_BEFORE_DAYS = 3;
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const dayLabel = (t) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

const lowerFirst = (s, lex) => {
  const first = words(s.split(/\s+/)[0])[0] || '';
  const keep = /^\p{Lu}{2,}/u.test(s) || lex.proper.has(first) || lex.firstNames.has(first) || [...lex.names].some((n) => n.startsWith(`${first} `) || n === first);
  return keep ? s : s.charAt(0).toLowerCase() + s.slice(1);
};
const norm = (s) => words(s).join(' ');

/** A title whose first sentence only sets up the next ("A bar required KN-95 masks. When it changed the rules, ..."). */
const SETUP_NEXT = /[.!?]['’"”]?\s+(when|then|until|but then|that['’]s when)\b/i;
function setupFragment(title, text) {
  const t = W.curlQuotes(title);
  const cut = t.search(SETUP_NEXT);
  if (cut < 0) return false;
  return norm(t.slice(0, cut + 1)).startsWith(norm(text).split(' ').slice(0, 5).join(' '));
}

// verbs the suffix test misses ("Gophers get 27-24 upset win")
const VERBISH = /\s(?:get|gets|got|win|wins|won|beat|beats|lose|loses|lost|top|tops|take|takes|took|hit|hits|hold|holds|run|runs|draw|draws|drew|split|splits|quit|quits)\b/i;

// ---------- lines ----------
/** A title rewritten as a shown line, with the wording rules applied; null when it may not be shown. */
const STORY_LIMITS = { words: 16, chars: 100, long: 15 }; // a story line may say who did what to whom, and why
const WHY_LIMITS = { words: 14, chars: 90, long: 12 };
const HOOK_LIMITS = { words: 16, chars: 110, long: 14 }; // the moment's own detail may run a little longer
function lineOf(it, ctx, subject = ctx.E, limits = null) {
  if (F.CENSORED.test(it.title)) return null;
  // a verdict on a rumour ("Fact check: ...") would read as the rumour itself once its label goes
  if (F.VERDICT.test(W.curlQuotes(it.title))) return null;
  // (and so would unnamed experts' guess once their attribution goes: "... ‘furious’ ...: experts")
  if (F.HEARSAY.test(W.curlQuotes(it.title))) return null;
  const h = W.rewrite(it.title.replace(/\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?=\s+[-–|]\s+|$)/, ''), subject, ctx.lex, [], limits);
  const raw = F.recaseFrom(F.safeLine(h.text, { contested: ctx.contested }), ctx.caseItems.includes(it) ? ctx.caseItems : [it, ...ctx.caseItems], ctx.lex).replace(/\br-rat(ed|ing)\b/g, 'R-rat$1');
  // "British Politician Jasena Wickaby ...": a job label before the main name goes (it can be stale: a former MP)
  const text0 = ctx.E && contains(norm(raw.replace(DESCRIPTOR, '')), ctx.E) && (norm(raw.replace(DESCRIPTOR, '')) + ' ').startsWith(`${ctx.E.split(' ')[0]} `) ? raw.replace(DESCRIPTOR, '') : raw;
  // a Title Case title's quote is lowered but for its first word and names ("‘Way Too Caught Up in Pop Culture’" -> "‘Way too caught up in pop culture’")
  const text = W.isTitleCase(W.curlQuotes(it.title).split(/\s+/)) ? lowerQuotes(text0, ctx.lex) : text0;
  if (text.split(/\s+/).length < 4 || openQuoteAtEnd(text) || DANGLING.test(text) || ENDS_OPEN.test(text) || F.unsafeLine(text) || F.CLICKBAIT.test(text) || F.VAGUE.test(text) || F.NAME_GLOSS.test(W.curlQuotes(it.title)) || F.BAIT_TITLE.test(it.title)) return null;
  // a long title cut to five words or fewer has lost what it was saying ("Pellade Sorrova calls on men")
  if (text.split(/\s+/).length <= 5 && (h.cut || norm(it.title).split(' ').length >= 9)) return null;
  if (/\b(made|makes|make|says|said|calls|wants|gives|tells|told|reveals|shares|explains|slams|rips|blasts)$/i.test(text)) return null;
  if (F.namesPrivate(text, ctx.priv, ctx.keepNames) || setupFragment(it.title, text)) return null;
  if (h.cut && middleCutBreaks(it.title, text)) return null;
  // an arrest, a charge or a court case is shown only about a public figure the saved coverage names often
  if (R.RE.legal.test(text) && !publicName(text, ctx)) return null;
  if (h.cut && (/\b(?:but|and|or|while|as|with|vs\.?)\s+\S+$/i.test(text) || /^\s*(?:into|to|as|for|with|from|of|by|over)\b/i.test(restAfter(it.title, text)) || /\p{Lu}[\p{L}’'-]*$/u.test(text) && /^\s*(?:of|for|in|at)\s+(?:the\s+)?\p{Lu}/u.test(restAfter(it.title, text)))) return null;
  return { it, text, cut: h.cut, lostHook: h.lostHook };
}

// a line that stops mid-thought ("Obviously, Hollywood is interested in")
const ENDS_OPEN = /\b(?:in|of|to|for|with|at|on|by|about|from|the|a|an|and|or|but|is|are|was|were|as|than|that|into)[.,;:]?$/i;
/** Quotes of a Title Case title in sentence case: the first word and names keep their capitals. */
function lowerQuotes(text, lex) {
  return text.replace(/([‘“])([^’”]{3,60})([’”])/g, (m, a, q, b) => a + q.split(' ').map((w, i) => {
    const k = words(w)[0] || '';
    return i === 0 || lex.proper.has(k) || lex.firstNames.has(k) || /^\p{Lu}{2,}/u.test(w) || !W.inDict(k) ? w : w.toLowerCase();
  }).join(' ') + b);
}
const DESCRIPTOR = /^(?:(?:British|American|English|Irish|Scottish|Welsh|Australian|Canadian|former|ex-Tory|Tory|Labour|Conservative|Democratic|Republican)\s+)+(?:politician|MP|minister|cabinet minister|lawmaker|senator)\s+(?=\p{Lu})/iu;

/** A line that joins two parts of its title where the title went on with "of"/"for"/"to" ("AP player [of Year ...] as Aces"). */
function middleCutBreaks(title, text) {
  const src = norm(title);
  const ws = norm(text).split(' ');
  for (let i = 1; i < ws.length; i++) {
    if (src.includes(`${ws[i - 1]} ${ws[i]}`)) continue;
    const at = ` ${src} `.indexOf(` ${ws.slice(Math.max(0, i - 2), i).join(' ')} `);
    const next = at >= 0 ? ` ${src} `.slice(at).split(' ').filter(Boolean)[Math.min(2, i)] : '';
    return /^(of|for|to|the)$/.test(next || '');
  }
  return false;
}

/** A public figure the line names: a name many outlets print, or its surname alone ("Fennsy"). */
function publicName(text, ctx) {
  const tw = norm(text).split(' ');
  return [...ctx.keepNames].some((n) => n.includes(' ') && !R.isPlaceOrTeam(n) && (contains(tw.join(' '), n) || tw.includes(n.split(' ').pop())) && n.split(' ').pop().length > 3);
}

/** What the source title says after the words a cut line kept. */
function restAfter(title, text) {
  const t = W.curlQuotes(title).replace(/\s+/g, ' ');
  const last = text.split(/\s+/).slice(-2).join(' ').toLowerCase();
  const at = t.toLowerCase().indexOf(last);
  return at >= 0 ? t.slice(at + last.length) : '';
}

/** Share of the moment's coverage that carries the line's context words (a name or story word, not the moment's own). */
function linkOf(text, ctx) {
  if (!ctx.momItems.length) return 0;
  const own = ctx.momentOwn;
  const st = F.contentStems(text, ctx.skip).filter((s) => !own.has(s));
  let best = 0;
  for (const s of st) best = Math.max(best, ctx.momItems.filter((i) => i.textStems.has(s)).length / ctx.momItems.length);
  return best;
}

function storyScore(x, ctx, opts = {}) {
  const { it, text } = x;
  const tw = norm(text);
  const why = [];
  const add = (v, k) => { if (v) why.push(`${k}${v > 0 ? '+' : ''}${v.toFixed(1)}`); return v; };
  let s = add(1.4 * F.consensusOf(text, ctx.df, ctx.skip), 'cons');
  const conflict = F.CONFLICT.test(text);
  if (conflict) s += add(2.5, 'conflict');
  if (F.STAKES.test(text)) s += add(1.2, 'stakes');
  if (F.TURN.test(text)) s += add(1.2, 'turn');
  if (F.MOMENT_FRAME.test(text) && !opts.event) s += add(opts.reaction && conflict ? -1 : -3, 'moment-frame');
  if (F.META.test(text)) s += add(-3, 'meta');
  if (F.VAGUE.test(text)) s += add(-2, 'vague');
  if (F.FUTURE.test(text) && !opts.reaction) s += add(-1.5, 'future');
  if (ctx.placeClash && ctx.placeClash(text)) s += add(-3, 'place-clash');
  if (F.EVENT.test(text)) s += add(opts.event ? 2 : 0.6, 'event');
  if (F.SELF_DEFENSE.test(text)) s += add(conflict ? -1 : -3, 'defence');
  if (F.REVIEW.test(it.title)) s += add(-5, 'review');
  if (F.EXPLAINER.test(it.title) || F.EXPLAINER.test(text)) s += add(-3, 'explainer');
  if (F.LOGISTICS.test(text)) s += add(-2.5, 'logistics');
  if (F.OPINION.test(text)) s += add(-2, 'opinion'); else if (F.OPINION.test(it.title)) s += add(-0.8, 'opinion-src');
  if (/\?/.test(it.title)) s += add(-2, 'question');
  // what happened (a death, an arrest) before an interview or a look back at it
  if (F.RETRO.test(text) && F.GRAVE_EVENT.test(text)) s += add(-2, 'retro');
  else if (F.RESULT.test(text)) s += add(2, 'result');
  if (ctx.E) s += add(contains(tw, ctx.E) ? ((tw + ' ').startsWith(`${ctx.E} `) ? 1.5 : 1) : -0.5, 'E');
  s += add(hasVerb(text) || VERBISH.test(text) ? 1.2 : -2, 'verb');
  if (x.cut) s += add(-0.8, 'cut');
  s += add(F.outletQuality(it), 'outlet');
  if (it.drop === 'hard-news') s += add(-3, 'hard-news');
  if (!opts.reaction && ctx.retells(text)) s += add(-4, 'retells');
  const link = linkOf(text, ctx);
  s += add(LINK_WEIGHT * link, 'link');
  const caused = ctx.causePointers.some((k) => carries(probe(text), k));
  if (caused) s += add(POINTER_BONUS, 'cause');
  else if (ctx.pointers.some((k) => carries(probe(text), k))) s += add(0.5, 'trend-pair');
  // another story about the same name that the moment's coverage never mentions (her record, not the rejection)
  if (link < 0.05 && !caused && !opts.event && !opts.reaction) s += add(-3, 'unlinked');
  if (opts.early && it.t <= opts.early) s += add(EARLY_BONUS, 'early');
  x.s = s;
  x.why = why.join(' ');
  return s;
}

/** Other titles telling the same thing (two content words in common), for the trace. */
function supportOf(x, ctx, items = ctx.field, fresh = null) {
  const st = new Set(F.contentStems(x.text, ctx.supportSkip || ctx.skip));
  const own = new Set(F.contentStems(x.text, ctx.skip));
  // a nameless search's own words ("Fennsy") count half: they are in every row it returned
  const shared = (it) => [...st].reduce((a, s) => a + (it.textStems.has(s) ? (own.has(s) ? 1 : 0.5) : 0), 0);
  // a why clause's news ("lawsuit") needs a second title that says it too, not one that shares only the story's words
  const news = fresh ? [...own].filter((s) => !fresh.has(s) && !T.ANGLE_STOP.has(s)) : [];
  return items.filter((it) => it !== x.it && shared(it) >= Math.min(2, st.size) && (!news.length || news.some((s) => it.textStems.has(s))));
}
const traceFor = (x, ctx, items, fresh) => L.traceItems(x.it, [x.it, ...supportOf(x, ctx, items, fresh)]).map(L.traceTitle);

function best(cands, ctx, opts, min) {
  const sorted = cands.filter((x) => norm(x.text) !== norm(ctx.momentText)).sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  const grep = process.env.STORY_GREP ? new RegExp(process.env.STORY_GREP, 'i') : null;
  if (ctx.dbg) for (const x of sorted.filter((y, i) => i < 6 || (grep && grep.test(y.it.title)))) ctx.dbg(`      ${opts.label || 'cand'} ${x.s.toFixed(2)} ${x.text}  [${x.why}] <= ${x.it.outlet}`);
  for (const x of sorted) {
    if (x.s < min) return null;
    const trace = traceFor(x, ctx, opts.support, opts.fresh);
    const tre = opts.trend && opts.trend(x);
    if (tre) trace.push(tre);
    if (L.traceable(trace)) return { ...x, trace, support: supportOf(x, ctx, opts.support, opts.fresh) };
  }
  return null;
}

// ---------- the story ----------
/** A Wikipedia page named for the controversy that holds the main name ("Plonker–Tavix Ostiss tour controversy"). */
function controversyArticle(ctx) {
  if (!ctx.E) return null;
  return ctx.articles.find((a) => /\b(controvers(?:y|ies)|feud|scandal|dispute|backlash|boycott)\b/i.test(a.title) &&
    !/^list of\b/i.test(a.title) && contains(norm(a.title), ctx.E)) || null;
}

function controversyStory(ctx) {
  const art = controversyArticle(ctx);
  if (!art) return null;
  const eParts = new Set(ctx.E.split(' '));
  const other = norm(a2(art.title)).split(' ').filter((w) => !eParts.has(w) && !/^(controvers\w*|feud|scandal|dispute|backlash|boycott|tour|the|and|of)$/.test(w));
  const about = (it) => other.length ? other.every((w) => it.textStems.has(stem(w))) : true;
  const items = ctx.field.filter((it) => !ctx.isMom(it) && about(it));
  if (!items.length) return null;
  const first = Math.min(...items.map((i) => i.t));
  const cands = items.map((it) => lineOf(it, ctx, ctx.E, STORY_LIMITS)).filter(Boolean);
  const lead = new Set(F.contentStems(`${art.extract}`, ctx.skip));
  cands.forEach((x) => {
    storyScore(x, ctx, { early: first + 2 * DAY });
    const n = F.contentStems(x.text, ctx.skip).filter((s) => lead.has(s)).length;
    x.s += Math.min(3, 0.5 * n);
    x.why += ` lead+${Math.min(3, 0.5 * n).toFixed(1)}`;
  });
  const pick = best(cands, ctx, { label: 'saga', support: items }, STORY_MIN);
  if (!pick) return null;
  return { kind: 'saga', text: pick.text, trace: [L.traceArticle(art), ...pick.trace], article: art, it: pick.it, items, since: first };
}
const a2 = (s) => s.replace(/[–—-]/g, ' ');

/** The corrected story: a reversal ("Meta and YouTube reverse course") or a denial leads. */
function correctionStory(ctx) {
  for (const kind of ['reversal', 'denial']) {
    const rows = ctx.corr[kind];
    if (!rows.length) continue;
    const cands = rows.map((it) => lineOf(it, ctx, ctx.E, STORY_LIMITS)).filter(Boolean);
    cands.forEach((x) => storyScore(x, ctx, { reaction: true }));
    const pick = best(cands, ctx, { label: kind, support: ctx.field }, 2);
    if (pick) return { kind: kind === 'reversal' ? 'update' : 'denial', text: pick.text, trace: pick.trace, it: pick.it, items: pick.support.concat(pick.it), since: pick.it.t };
  }
  return null;
}

/** The best-covered title of the story that says who did what: conflict first, then stakes. */
function focusStory(ctx) {
  // the crowd turning on the moment is a story too ("... defends husband after clip sparks online backlash")
  const reaction = (it) => /\b(backlash|pile-?on|outrage|fury|ripped|slammed|criticis\w+|criticiz\w+|disgust\w*|divided|debate|boycott\w*|dark humou?r)\b/i.test(it.title);
  const cands = ctx.field.filter((it) => !ctx.isMom(it) || reaction(it)).map((it) => lineOf(it, ctx, ctx.E, STORY_LIMITS)).filter(Boolean);
  // the moment's own arc: people turned on it and the subject answered ("cites ‘dark humor’ amid backlash over viral video")
  const about = (it) => ctx.isMom(it) || [...ctx.momentOwn].some((s) => it.textStems.has(s)) || [...ctx.m.pseudo, ...ctx.m.opener].some((k) => carries(it, k)) || /\b(viral (?:video|clip|moment|post)|the (?:video|clip))\b/i.test(it.title);
  // a ratings release is no story while the field holds the backlash people are talking about ("... amid viewer backlash")
  const backlashed = ctx.field.some((it) => F.BACKLASH.test(it.title));
  cands.forEach((x) => {
    storyScore(x, ctx, { reaction: ctx.isMom(x.it) || reaction(x.it) });
    if (F.BACKLASH.test(x.it.title) && F.CONFLICT.test(x.text) && about(x.it)) { x.s += 4; x.why += ' arc+4.0'; }
    if (backlashed && SW.REPORT.test(x.text)) { x.s -= 4; x.why += ' report-4.0'; }
  });
  const pick = best(cands, ctx, { label: 'story', support: ctx.field }, STORY_MIN);
  if (!pick) return null;
  const arc = / arc\+/.test(pick.why);
  const since = Math.min(pick.it.t, ...pick.support.map((i) => i.t));
  const kind = arc || ctx.isMom(pick.it) ? 'reaction' : since < ctx.momentFirst - 5 * DAY ? 'saga' : 'context';
  return { kind, arc, text: pick.text, trace: pick.trace, it: pick.it, items: [pick.it, ...pick.support], since };
}

/**
 * The event the moment happened at, when nothing bigger is found: the game, the show, the tour, the summit. Candidates name the
 * main name or a team/place word most of the moment's coverage carries, from three days before the moment on; the whole saved
 * store is searched (the Packers' home-opener loss is in another story's search).
 */
function contextStory(ctx) {
  const anchors = ctx.anchorWords;
  const vocabHits = (it) => F.contentStems(it.title, ctx.skip).filter((s) => ctx.vocab && ctx.vocab.has(s) && !anchors.includes(s) && !T.ANGLE_STOP.has(s)).length;
  const on = (it) => (ctx.E && namesE(it, ctx.E)) || (anchors.some((w) => it.textStems.has(w)) && vocabHits(it) >= 1);
  const from = ctx.momentFirst - CONTEXT_BEFORE_DAYS * DAY;
  const items = uniqByKey([...ctx.field, ...ctx.contextPool.filter((it) => it.t >= from && it.t <= ctx.now && on(it))])
    .filter((it) => it.t >= from && !ctx.isMom(it) && F.EVENT.test(it.title) && on(it));
  const cands = items.map((it) => lineOf(it, ctx, ctx.E, STORY_LIMITS)).filter(Boolean);
  cands.forEach((x) => { storyScore(x, ctx, { event: true }); x.s += 0.5 * Math.max(0, 1 - Math.abs(x.it.t - ctx.momentFirst) / (3 * DAY)); });
  const tr = ctx.eventSearch;
  const trWords = tr ? words(tr.keyword).filter((w) => w.length > 2) : [];
  const withTrend = (x) => tr && trWords.length && trWords.every((w) => x.it.textStems.has(stem(w)));
  const pick = best(cands, ctx, { label: 'event', support: items, trend: (x) => (withTrend(x) ? L.traceTrend(tr) : null) }, CONTEXT_MIN);
  if (!pick) return null;
  return { kind: 'context', text: pick.text, trace: pick.trace, it: pick.it, items: [pick.it, ...pick.support], since: Math.min(pick.it.t, ...pick.support.map((i) => i.t)) };
}

// ---------- the moment ----------
/**
 * The moment as most of its coverage tells it: named, neutral, no single outlet's detail ("Mercury worker"), no opinion ("speaks
 * straight facts"), no accident words when the maker says it was designed. The listed headline stays unless a line beats it.
 */
function momentLine(ctx, headline, { replace = false } = {}) {
  const own = uniqByKey([...ctx.members, ...ctx.momItems, ...ctx.momentRows].filter((i) => i.t <= ctx.momentFirst + 4 * DAY));
  const df = F.docFreq(own);
  const total = new Set(own.map(F.titleKey)).size;
  const roles = new Map();
  const vote = (it) => (F.MAJOR.test(it.outlet || '') ? 1.5 : F.outletQuality(it) < -0.5 ? 0.5 : 1);
  for (const it of own) {
    for (const w of new Set(words(it.title))) {
      if (!ROLE_NOUN.has(w)) continue;
      const m = roles.get(w) || new Map();
      m.set(F.titleKey(it), Math.max(m.get(F.titleKey(it)) || 0, vote(it)));
      roles.set(w, m);
    }
  }
  const weight = (w) => [...roles.get(w).values()].reduce((a, v) => a + v, 0);
  // what is wrong with a line as the moment: a single outlet's name or detail, a role most outlets name differently, opinion,
  // a label, accident words for a designed moment, a setup clause, a question
  const flaws = (x) => {
    const t = x.text;
    const out = [];
    if (F.OPINION.test(t)) out.push('opinion');
    if (F.LABEL.test(t) || F.unsafeLine(t)) out.push('label');
    const minority = F.minorityWords(t, df, ctx.skip, total).filter((st) => t.split(/\s+/).slice(1).some((w) => /^[^\p{L}]*\p{Lu}/u.test(w) && stem(words(w)[0] || '') === st));
    if (minority.length) out.push(`single-source:${minority.join(',')}`);
    for (const w of words(t).filter((w) => roles.has(w))) {
      const mine = weight(w);
      const rival = [...roles.keys()].map((r) => [r]).find(([r]) => r !== w && (ROLE_GROUP[r] || r) !== (ROLE_GROUP[w] || w) && weight(r) > mine);
      if (rival) out.push(`role:${w}<${rival[0]}`);
    }
    if (ctx.corr.intentional.length && F.ACCIDENT.test(t)) out.push('accident');
    if (x.it && setupFragment(x.it.title, t)) out.push('setup');
    if (/\?/.test(t) || F.REVIEW.test(t) || F.EXPLAINER.test(t)) out.push('question');
    if (F.LOGISTICS.test(t) || F.VAGUE.test(t) || F.FUTURE.test(t)) out.push('logistics');
    if (F.NO_ACTION.test(t)) out.push('no-action');
    return out;
  };
  const score = (x) => {
    const t = x.text;
    let s = 1.5 * F.consensusOf(t, df, ctx.skip) + (hasVerb(t) ? 1.2 : -2) + (R.RE.moment.test(t) || R.RE.viral.test(t) ? 0.8 : 0);
    if (ctx.E) s += contains(norm(t), ctx.E) ? 1.5 : -1;
    s += x.it ? F.outletQuality(x.it) : 0.3;
    if (AFTERMATH.test(t)) s -= 2;
    x.flaws = flaws(x);
    x.s = s - 3 * x.flaws.length;
    return x.s;
  };
  const head = { text: F.recaseFrom(F.safeLine(headline, { contested: ctx.contested }), ctx.caseItems, ctx.lex), it: null };
  score(head);
  let pick = head;
  if (replace) head.flaws.push('story-shaped');
  if (head.flaws.length) {
    // the moment's surest coverage, told without the flaw (for a story-shaped headline: the story's first days)
    const strong = own.filter((it) => ctx.isStrong(it) && Math.abs(it.t - ctx.momentFirst) <= 2 * DAY);
    const early = replace ? ctx.field.filter((it) => it.t <= ctx.momentFirst + 2 * DAY && (R.RE.moment.test(it.title) || F.CONFLICT.test(it.title) || F.TURN.test(it.title))) : [];
    const cands = (replace ? uniqByKey([...own, ...early]) : strong.length >= 2 ? strong : own).map((it) => lineOf(it, ctx)).filter(Boolean).filter((x) => !AFTERMATH.test(x.text));
    cands.forEach(score);
    cands.sort((a, b) => b.s - a.s);
    if (ctx.dbg) for (const x of [head, ...cands.slice(0, 5)]) ctx.dbg(`      moment ${x.s.toFixed(2)} ${x.text}${x.it ? ` <= ${x.it.outlet}` : ' (headline)'} ${x.flaws.join(' ')}`);
    const clean = cands.find((x) => !x.flaws.length && (!replace || (R.RE.moment.test(x.text) || F.CONFLICT.test(x.text) || hasVerb(x.text)) && norm(x.text) !== norm(headline)));
    if (clean) pick = clean;
  }
  let text = pick.text;
  let note = null;
  // designed, not an accident: a designer's own account makes it "by design" in the line; a maker's claim ("creator says it was
  // intentional") is the why's first clause, in the correcting source's words, never a parenthetical in the line
  if (ctx.corr.intentional.length) {
    const rows = ctx.corr.intentional.slice().sort((a, b) => F.outletQuality(b) - F.outletQuality(a) || a.t - b.t);
    const clause = rows.map(F.correctionClause).find((c) => c && c.split(' ').length <= 7);
    const designed = rows.find((it) => /\bdesign(?:er|ed)\b/i.test(it.title));
    if (designed && !/\bby design\b/i.test(text)) text = `${text.replace(/\s+onstage$/i, ' onstage')} by design`;
    const src = rows.find((it) => F.correctionClause(it) === clause);
    if (clause) note = { text: clause.replace(/^(creator|designer|director|maker|producer|studio|team)\b/i, 'its $1'), trace: L.traceItems(src, rows).map(L.traceTitle), outlet: F.outletQuality(src) > -1 ? src.outlet : null };
  }
  return { text, it: pick.it, note, headFlaws: head.flaws.filter((f) => f !== 'story-shaped') };
}
const ROLE_GROUP = { worker: 'staff', staffer: 'staff', employee: 'staff', mom: 'parent', mother: 'parent', dad: 'parent', father: 'parent' };
const ROLE_NOUN = new Set('dancer teacher nurse worker staffer employee fan mom dad woman man student shopper customer passenger driver'.split(' '));

// ---------- siblings ----------
const STATED_CAUSE = /\b(?:due to|over|because of|for|amid|after)\b[^,;:]{0,30}\b(?:weather|storm|nor['’]?easter|rain|forecast|hurricane|flood\w*|illness|injur\w*)\b/i;
/**
 * Other viral moments of the same story ("Thalo Lorrurn’s ‘handshake snub’ with Tamwyn goes viral" beside Neskova's flinch): viral or
 * meme titles in the story's coverage, not the moment's own, from two sources.
 */
function siblingMoments(ctx, story) {
  if (!story) return [];
  const keys = new Set(F.contentStems(story.text, ctx.skip));
  const own = [...ctx.momentOwn];
  const aboutMoment = (it) => own.some((s) => it.textStems.has(s)) || [...ctx.m.pseudo, ...ctx.m.opener].some((k) => carries(it, k));
  const viral = ctx.field.filter((it) => !ctx.isMom(it) && !aboutMoment(it) && (R.RE.viral.test(it.title) || /\b(snub|flinch|meme)\w*/i.test(it.title)) &&
    it.t >= ctx.momentFirst - 3 * DAY && [...keys].some((k) => it.textStems.has(k)) && !F.REVIEW.test(it.title) && !F.EXPLAINER.test(it.title));
  if (ctx.dbg) ctx.dbg(`      siblings viral=${viral.map((i) => i.title.slice(0, 60)).join(' | ')}`);
  const groups = [];
  for (const it of viral) {
    const st = new Set(F.contentStems(it.title, ctx.skip).filter((s) => !keys.has(s)));
    const g = groups.find((x) => [...st].filter((s) => x.st.has(s)).length >= 2);
    if (g) { g.items.push(it); st.forEach((s) => g.st.add(s)); } else groups.push({ st, items: [it] });
  }
  const out = [];
  for (const g of groups) {
    const srcs = new Set(g.items.map((i) => i.src));
    if (srcs.size < SIBLING_MIN_SOURCES) continue;
    const all = g.items.map((it) => lineOf(it, ctx)).filter(Boolean).filter((x) => !ctx.retells(x.text));
    // a stated cause travels with the event: "shows canceled" beside a backlash reads as the backlash's doing when a storm did it
    const caused = all.filter((x) => STATED_CAUSE.test(x.text));
    const lines = caused.length ? caused : g.items.some((i) => STATED_CAUSE.test(i.title)) ? [] : all;
    lines.forEach((x) => { x.s = F.consensusOf(x.text, ctx.df, ctx.skip) + F.outletQuality(x.it) - (F.OPINION.test(x.text) ? 2 : 0); });
    const pick = lines.sort((a, b) => b.s - a.s)[0];
    if (pick) out.push({ text: pick.text, n: srcs.size, trace: L.traceItems(pick.it, g.items).map(L.traceTitle) });
  }
  return out.sort((a, b) => b.n - a.n).slice(0, 2);
}

/**
 * The same thing happening at another event ("booed" at the Tennessee game and at the Presidents Cup; fans pulled on stage in
 * London and Auckland): a name or place angle whose items carry the moment's action or key word and are not its own coverage.
 */
function repeatEvents(ctx) {
  const key = ctx.m.action;
  const out = [];
  for (const a of key ? ctx.angles : []) {
    // (a "name" that opens with a pronoun is a fragment of a sentence, "Here's How It Happened", never an event)
    if (!a.key.startsWith('n:') || a.srcs.size < SIBLING_MIN_SOURCES || PRONOUN_NAME.test(a.key.slice(2))) continue;
    const share = a.items.filter((i) => carries(i, key)).length / a.items.length;
    const ownShare = a.items.filter((i) => ctx.isStrong(i)).length / a.items.length;
    if (share < 0.5 || ownShare > 0.3) continue;
    out.push({ angle: a, label: surfaceOf(T.labelOf(a.key), a.items), items: a.items.filter((i) => carries(i, key)) });
  }
  // a fan brought on stage somewhere else on the tour: the same key word on another day, from two sources
  if (ctx.m.stems.includes('w:stage') || key === 'w:stage') {
    const withKey = uniqByKey(ctx.field.filter((it) => carries(it, 'w:stage')));
    const other = withKey.filter((it) => !ctx.isMom(it) && Math.abs(it.t - ctx.momentFirst) >= DAY && /\bfans?\b/i.test(it.title));
    if (new Set(other.map((i) => i.src)).size >= SIBLING_MIN_SOURCES) out.push({ angle: null, label: null, items: other });
  }
  return out;
}

const PRONOUN_NAME = /^(?:it|he|she|they|we|you|i|this|that|these|those|here|there|what|how|why|who)\b/;

/** "at the Presidents Cup", "at Tennessee vs. Texas Football Game": where the moment happened, as its coverage says it. */
function atPhrase(items, lex) {
  const counts = new Map();
  for (const it of items) {
    const t = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '');
    const m = t.match(/\b(?:at|during)\s+(?:the\s+)?((?:[A-Z][\w.’'-]*\.?(?:\s+(?:vs\.?|v\.?|of|&))?\s*){1,6})/);
    if (!m) continue;
    const ph = m[1].trim().replace(/\s+(On|In|As|After|With|For)$/i, '');
    if (ph.split(/\s+/).length < 2 && !/Cup|Bowl|Awards?|Emmys|Oscars|Grammys/.test(ph)) continue;
    const k = norm(ph);
    const c = counts.get(k) || { ph, srcs: new Set() };
    c.srcs.add(it.src);
    counts.set(k, c);
  }
  const top = [...counts.values()].sort((a, b) => b.srcs.size - a.srcs.size || b.ph.length - a.ph.length)[0];
  return top ? W.recase(top.ph, lex, true).replace(/\b(Football|Basketball|Baseball|Soccer|College)\b(?=\s+(?:game|match|Game|Match)\b)/g, (w) => w.toLowerCase()).replace(/\b(Game|Match|Stadium)\b$/, (w) => w.toLowerCase()) : null;
}

function repeatStory(ctx, repeats) {
  if (!repeats.length || !ctx.E) return null;
  const Es = surfaceOf(ctx.E, ctx.momItems.length ? ctx.momItems : ctx.field);
  const r = repeats[0];
  const items = uniqByKey([...ctx.momItems, ...r.items]);
  const trace = L.traceItems(ctx.momItems[0] || r.items[0], items).map(L.traceTitle);
  if (!L.traceable(trace)) return null;
  if (ctx.m.action === 'w:boo') {
    const here = atPhrase(ctx.momItems, ctx.lex);
    const there = r.label || atPhrase(r.items, ctx.lex);
    if (!here || !there) return null;
    // the boos were real, the size of them disputed: the why says the accounts differ
    const verb = ctx.contested ? 'drew boos' : 'was booed';
    return { kind: 'repeat', text: `${Es} ${verb} at ${the(here)} and ${the(there)} on consecutive days`, trace, items, since: Math.min(...items.map((i) => i.t)) };
  }
  // (a pattern, "fans pulled on stage keep going viral", is never claimed from one show's coverage)
  return null;
}
const the = (ph) => (/^(the|a|an)\s/i.test(ph) ? ph : `the ${ph}`);

// ---------- the why ----------
/**
 * A line about somebody else that names the main name only as an owner ("Tavia Ostow breaks Fenrel Zellsy's record"): the
 * rival's news, not a turn of this story.
 */
function otherSubject(text, E) {
  if (!E) return false;
  const flat = W.curlQuotes(text).toLowerCase().replace(/(\p{L})['’](\p{L}{2,})/gu, '$1$2');
  const at = flat.search(new RegExp(`\\b${E.split(' ').join('\\W+')}['’]s\\b`, 'u'));
  return at > 0 && !(norm(text) + ' ').startsWith(`${E} `);
}
// two clauses making the same claim ("facing closure", "faces collapse") say it once
const CLAIMS = [/\b(clos(?:e|es|ed|ure|ing)|collaps\w*|shut(?:s|ting)? down|fold(?:s|ed)?)\b/i, /\bapologi[sz]\w*/i, /\b(record|most[- ]awarded)\b/i,
  /\bboycott\w*/i, /\b(quit|quits|withdr[ae]w\w*|pull(?:s|ed)? out)\b/i, /\b(sue[sd]?|lawsuit|legal action)\b/i];
const claimOf = (text) => CLAIMS.findIndex((re) => re.test(text));
const sameClaim = (a, b) => { const k = claimOf(a); return k >= 0 && CLAIMS[k].test(b); };

const ESCALATION = /\b(announc\w+|sues|sued|apologi[sz]\w*|quits?|resign\w*|fires? back|hits? back|doubles? down|revers\w+|backtrack\w*|weighs? in|joins?|boycott\w*|protest\w*|threat\w*|blasts?|slams?|responds?|calls? (?:for|out)|eyed|eyeing|adaptation|opens to|record|[a-f][+-]? grade|grades?)\b/i;

const momWord = (s) => (s === 'mum' ? 'mom' : s);
/** A why clause is about this story: it shares a word the story's own coverage repeats. */
const related = (text, ctx) => F.contentStems(text, ctx.skip).some((s) => ctx.storyVocab.has(s));
const overlap = (text, said, ctx) => { const st = F.contentStems(text, ctx.skip); return st.filter((s) => said.has(s)).length / Math.max(1, st.length); };

function stakesClause(ctx, story, latest = null) {
  const said = new Set(F.contentStems(`${story ? story.text : ''} ${ctx.momentText} ${latest ? latest.text : ''}`, ctx.skip));
  const pool = (story && story.items ? uniqByKey([...story.items, ...ctx.field]) : ctx.field)
    .filter((it) => (!ctx.isMom(it) || it.t > ctx.momentFirst + DAY) && (!story || it !== story.it) && (F.CONFLICT.test(it.title) || F.STAKES.test(it.title) || F.TURN.test(it.title)) &&
      (!story || it.t >= (story.since || 0) - DAY) && it.drop !== 'hard-news' &&
      (!story || story.kind !== 'moment' || F.contentStems(it.title, ctx.skip).some((x) => (ctx.terms || new Set()).has(x))));
  // a private person is never shamed ("worthless husband", "slammed"), and a real business's collapse needs a major outlet saying it
  const privateSubject = SW.isPrivateSubject(ctx);
  const claimOk = (x) => claimOf(x.text) !== 0 || F.MAJOR.test(x.it.outlet || '');
  // under a story about the reaction itself ("fans divided over new hosts"), a stake must be about that ("hosts"), not another gripe
  // about the same show the day before ("week one dances")
  const storyOwn = new Set(story && ['reaction', 'topic'].includes(story.kind) ? F.contentStems(story.text, ctx.skip).filter((s) => !FILLER_STEMS.has(s) && !T.ANGLE_STOP.has(s)) : []);
  const onStory = (x) => !storyOwn.size || F.contentStems(x.text, ctx.skip).some((s) => storyOwn.has(s));
  const cands = pool.filter((it) => !(privateSubject && (SW.SHAMING.test(it.title) || SW.TARGETS_PRIVATE.test(it.title))) && (!SW.SENSITIVE.test(it.title) || ctx.sensitiveCard) &&
    F.outletQuality(it) > -1 && !F.VAGUE.test(it.title) && !F.byline(it.title, ctx.E))
    .map((it) => lineOf(it, ctx, ctx.E, WHY_LIMITS)).filter(Boolean).filter((x) => claimOk(x) && (F.CONFLICT.test(x.text) || F.STAKES.test(x.text) || F.TURN.test(x.text)) &&
    !(F.SELF_DEFENSE.test(x.text) && !F.CONFLICT.test(x.text)) && !F.EXPLAINER.test(x.it.title) && !F.REVIEW.test(x.it.title) && !F.META.test(x.text) &&
    overlap(x.text, said, ctx) < (ctx.topic ? 0.3 : 0.45) && related(x.text, ctx) && !F.FUTURE.test(x.text) && (ctx.topic || !ctx.retells(x.text)) &&
    !otherSubject(x.text, ctx.E) && !(latest && sameClaim(latest.text, x.text)) && onStory(x));
  cands.forEach((x) => storyScore(x, ctx, { reaction: true }));
  return best(cands, ctx, { label: 'stakes', support: ctx.field, fresh: said }, 3);
}

/**
 * The story's newest turn: the newest on-topic row that can be shown, when nothing on topic is newer and it came after the moment
 * (story-why.js latestTurn). It must say something new, not retell the moment, and not be the subject's damage control alone.
 */
function latestClause(ctx, story, used, avoid = null) {
  const said = new Set(F.contentStems(`${story ? story.text : ''} ${ctx.momentText}`, ctx.skip));
  const privateSubject = SW.isPrivateSubject(ctx);
  const accept = (it) => {
    if (F.REVIEW.test(it.title) || F.EXPLAINER.test(it.title) || (SW.SENSITIVE.test(it.title) && !ctx.sensitiveCard) || /\?/.test(it.title) || F.byline(it.title, ctx.E)) return null;
    if (privateSubject && SW.SHAMING.test(it.title)) return null;
    const x = SW.faithful(lineOf(it, ctx, ctx.E, WHY_LIMITS), it, ctx);
    if (!x || !hasVerb(x.text) || x.text.split(/\s+/).length < 5) return null; // "Day for the ages" says nothing
    const text = SW.withHedge(x.text, it.title);
    // (a turn told with the story's own words still counts when it brings a new name: "Hollywood is interested in that viral lesbian bar")
    const fresh = F.contentStems(text, ctx.skip).filter((s) => !said.has(s) && !FILLER_STEMS.has(s));
    const newName = fresh.some((s) => ctx.lex.proper.has(s) && !(ctx.E || '').split(' ').includes(s));
    if ((overlap(text, said, ctx) >= 0.45 && !(newName && fresh.length >= 2)) || F.FUTURE.test(text) || F.MOMENT_FRAME.test(text) || F.META.test(text) || F.LOGISTICS.test(text)) return null;
    if ((!ctx.topic && ctx.retells(text)) || otherSubject(text, ctx.E) || (avoid && sameClaim(avoid, text))) return null;
    if (F.SELF_DEFENSE.test(text) && !F.CONFLICT.test(text) && !ESCALATION.test(text)) return null;
    const trace = traceFor({ it, text }, ctx, ctx.field, said);
    return L.traceable(trace) ? { text, trace, fresh: newName && fresh.length >= 2 } : null;
  };
  return SW.latestTurn(ctx, story, used, accept);
}

/**
 * An earlier backlash about the main name, only when it shares the moment's own words (an unrelated accusation never rides along
 * with a meme) and says nothing sensitive about a real person.
 */
function earlierClause(ctx, story) {
  if (!ctx.E) return null;
  const said = new Set(F.contentStems(`${story ? story.text : ''} ${ctx.momentText}`, ctx.skip));
  const own = [...ctx.momentOwn];
  const vocab = ctx.vocab || new Set();
  const pool = ctx.field.filter((it) => it.t >= ctx.momentFirst - 10 * DAY && it.t < ctx.momentFirst - DAY && F.BACKLASH.test(it.title) &&
    !own.some((s) => it.textStems.has(s)) && (!story || it !== story.it) && !SW.SENSITIVE.test(it.title));
  const cands = pool.map((it) => lineOf(it, ctx, ctx.E, WHY_LIMITS)).filter(Boolean)
    .filter((x) => (norm(x.text) + ' ').startsWith(`${ctx.E} `) && overlap(x.text, said, ctx) < 0.4 && !otherSubject(x.text, ctx.E) &&
      F.contentStems(x.text, ctx.skip).filter((s) => vocab.has(s) && !T.ANGLE_STOP.has(s)).length >= 2);
  cands.forEach((x) => storyScore(x, ctx, { reaction: true }));
  return best(cands, ctx, { label: 'earlier', support: ctx.field, fresh: said }, 3);
}

/**
 * The subject's own account in a saga (a defence the moment mocks: "Tavix Ostiss blames US tour promoter for dropping Plonker",
 * "decision ... 'not mine'"), from the story's first days, told plainly.
 */
function defenceClause(ctx, story) {
  if (!ctx.E || !story || !story.article) return null;
  const said = new Set(F.contentStems(`${story.text} ${ctx.momentText}`, ctx.skip));
  const first = story.since || ctx.momentFirst;
  const pool = (story.items || ctx.field).filter((it) => it.t <= first + 3 * DAY && !ctx.isMom(it) && (/\b(blames?|blamed|not mine|not my (?:call|decision)|made (?:the )?['‘]?final|decision was)\b/i.test(it.title)) &&
    !F.REVIEW.test(it.title) && !F.OPINION.test(it.title));
  const cands = pool.map((it) => lineOf(it, ctx, ctx.E, WHY_LIMITS)).filter(Boolean).filter((x) => /\b(blames?|blamed|not mine|final|decision)\b/i.test(x.text) &&
    overlap(x.text, said, ctx) < 0.6);
  cands.forEach((x) => { x.s = F.outletQuality(x.it) + F.consensusOf(x.text, ctx.df, ctx.skip) + ((norm(x.text) + ' ').startsWith(`${ctx.E} `) ? 1 : 0); x.why = ''; });
  return best(cands, ctx, { label: 'defence', support: story.items || ctx.field }, -5);
}

/**
 * A search surge that belongs to a why clause rather than to the moment's own days ("fever vs aces" beside "scores 38 as Aces
 * steamroll Fever in Game 1"): every word of the query is in the clause, and it began within a day and a half of that title.
 */
function clauseSearch(ctx, clauses) {
  const trends = (ctx.searchArgs && ctx.searchArgs.trends) || [];
  let out = null;
  for (const x of clauses.filter(Boolean)) {
    const st = new Set(F.contentStems(x.text, new Set()));
    for (const t of trends) {
      const ws = words(t.keyword).filter((w) => w.length > 2 && !W.STOP.has(w) && !/^(vs|v)$/.test(w));
      if (SW.isFixtureSearch(t.keyword)) continue; // "fever vs aces" measures the game, not the moment
      if (ws.length < 2 || t.volume < CLAUSE_SEARCH_MIN || Math.abs(t.start - x.it.t) > 1.5 * DAY || !ws.every((w) => st.has(stem(w)))) continue;
      if (!out || t.volume > out.volume) out = t;
    }
  }
  return out;
}
const CLAUSE_SEARCH_MIN = 20000;

function scaleClause(ctx, story, clauses = []) {
  const names = story ? F.contentStems(story.text, ctx.skip).filter((s) => ctx.df.get(s) >= 3 && ctx.lex.proper.has(s) || /^[a-z]+$/.test(s) && ctx.titled.has(s)) : [];
  // (a place is never the story's name: "Texas" alone also finds a steakhouse chain's new restaurant)
  const nums = uniqByKey([...ctx.field, ...ctx.contextPool.filter((it) => names.some((n) => !R.isPlaceOrTeam(n) && it.textStems.has(n)))])
    .filter((it) => F.SCALE_NUM.test(it.title) && it.t >= ctx.momentFirst - 2 * DAY && (!story || it !== story.it));
  // the headline rewriter says "goes viral" for "hits 4 million views": the title as written keeps the number
  const numLine = (it) => { const x = lineOf(it, ctx, ctx.E, WHY_LIMITS); return x && F.SCALE_NUM.test(x.text) ? x : SW.rawLine(it, ctx, 18); };
  const numLines = nums.map(numLine).filter((x) => x && F.SCALE_NUM.test(x.text) && related(x.text, ctx));
  numLines.forEach((x) => { storyScore(x, ctx, { reaction: true }); x.s += 2 * (x.it.t - ctx.momentFirst) / DAY; });
  const num = best(numLines, ctx, { label: 'number', support: ctx.field }, 1);
  // a search for the game ("falcons vs packers") says how big the game was, not the moment
  // (and a search that names somebody else says nothing about this card: "esselle quillith" beside Pellia Sorrenko's clip)
  const aboutCard = (t) => { const kw = words(t.keyword).join(' '); return !ctx.E || contains(kw, ctx.E) || kw.split(' ').includes(ctx.E.split(' ').pop()) ||
    words(t.keyword).some((w) => ctx.momentOwn.has(stem(w))) || !(ctx.otherAnchors || []).some((a) => contains(kw, a)) && !ctx.lex.names.has(kw); };
  const tr = [ctx.search, clauseSearch(ctx, clauses)].find((t) => t && !SW.isFixtureSearch(t.keyword) && aboutCard(t)) || null;
  if (num) return { text: lowerFirst(num.text, ctx.lex), trace: num.trace, kind: 'number', extra: tr };
  if (tr) {
    const where = tr.geo === 'GB' ? 'UK' : tr.geo;
    // a person the reader may not know is named with who they are ("her reported boyfriend, country singer Korory Fennurn")
    const gloss = SW.glossPerson(tr.keyword, ctx);
    const what = gloss ? `${gloss.text}` : `“${tr.keyword}”`;
    return { text: `searches for ${what} hit ${fmtVolume(tr.volume)}+ in the ${where}`, trace: [L.traceTrend(tr), ...ctx.momTrace.slice(0, 1)], kind: 'search' };
  }
  if (ctx.wikiSpike) {
    const w = ctx.wikiSpike;
    return { text: `${w.name}’s Wikipedia page drew ${Math.round(w.w.spike)}x its usual views`, trace: [L.traceWiki(w.w), ...ctx.momTrace.slice(0, 1)], kind: 'wiki' };
  }
  // (a count of stories says nothing a viewer can use: never a why)
  return null;
}
const lowerFirstRaw = (s) => (/^\p{Lu}{2,}|^\p{Lu}\d|^[‘'“"$]/u.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** The same thing at an earlier show of the tour ("Dovix Kelenko invites fan on stage and her next move leaves people floored"). */
function repeatClause(ctx, story) {
  if (!story || !story.repeatItems) return null;
  const items = story.repeatItems.filter((it) => !ctx.isMom(it) && it.t < ctx.momentFirst);
  const cands = items.map((it) => lineOf(it, ctx, ctx.E, WHY_LIMITS)).filter(Boolean).filter((x) => !F.VAGUE.test(x.it.title) && !F.OPINION.test(x.text));
  cands.forEach((x) => storyScore(x, ctx, { reaction: true, event: true }));
  return best(cands, ctx, { label: 'repeat', support: items }, 0);
}

/** A line's words up to its first verb ("gofundme pulls"), or null when no verb follows its first word. */
function openingOf(text) {
  const ws = words(text);
  const v = ws.findIndex((w, i) => i >= 1 && W.looksVerb(w));
  return v > 0 ? ws.slice(0, v + 1).join(' ') : null;
}

function whyLine(ctx, story, extras) {
  // the story's own vocabulary: words two of its titles use, and the moment's own words
  const vc = new Map();
  for (const it of uniqByKey([...(story && story.items ? story.items : []), ...ctx.momItems])) for (const s of new Set(F.contentStems(it.title, ctx.skip))) vc.set(s, (vc.get(s) || 0) + 1);
  ctx.storyVocab = new Set([...[...vc].filter(([, n]) => n >= 2).map(([s]) => s), ...ctx.momentOwn]);
  ctx.lineOf = lineOf;
  ctx.WHY_LIMITS_LONG = HOOK_LIMITS;
  const clauses = [];
  const push = (role, c) => clauses.push({ ...c, role });
  const used = new Set(story && story.it ? [story.it] : []);
  // what the card already says: the headline, the story and the moment ("mum" and "mom" are one word)
  const said = (extras.said || []).filter(Boolean).map((t) => new Set(F.contentStems(t, ctx.skip).map(momWord)));
  const saidAll = new Set(said.flatMap((set) => [...set]));
  // (a clause that opens the way the headline does, "GoFundMe pulls ...", tells the headline again in other words)
  const saidOpenings = new Set((extras.said || []).filter(Boolean).map(openingOf).filter(Boolean));
  // the maker's own account of a designed moment ("its creator says it was intentional")
  // (one outlet's report of it is hedged, never cited: "its creator reportedly says ..."; when most outlets called it a glitch,
  // the why says so first: "most outlets called it a glitch, though its creator reportedly says it was intentional")
  if (extras.note) {
    const n = extras.note;
    const hedged = L.traceable(n.trace) ? n.text : n.text.replace(/^((?:its |her |his )?\w+)\s+(says|explains|claims|insists)\b/i, '$1 reportedly $2');
    const glitchRows = SW.firstCopies(ctx.field.filter((it) => GLITCH.test(it.title) && !F.correctionClause(it)));
    const glitchSrcs = new Set(glitchRows.map((it) => it.src)).size;
    if (glitchSrcs >= GLITCH_MIN_SOURCES) {
      const trace = [...n.trace, ...L.traceItems(glitchRows[0], glitchRows).map(L.traceTitle)];
      push(0.1, { text: `most outlets called it a glitch, though ${hedged}`, trace, w: 3.9, kind: 'note', fresh: true, attributed: true });
    // (a maker's account follows the moment's detail: "Gravmott’s Pellet Sorrner micro minidress melts away. Its designer explains ...")
    } else if (L.traceable(n.trace) || n.outlet) push(0.6, { text: hedged, trace: n.trace, w: 3.9, kind: 'note', fresh: true, attributed: true });
  }
  // what set the backlash off ("Plonker dropped from Tavix Ostiss tour after onstage ‘Free Palestine’ statements")
  if (story && story.causeLine) push(0.2, { text: lowerFirst(story.causeLine.text, ctx.lex), trace: story.causeLine.trace, w: 3.95, kind: 'cause', fresh: true });
  if (ctx.contested && ctx.contradict) {
    const c = ctx.contradict;
    push(0, { text: `accounts differ: some reports describe ‘${c.short}’`, trace: [L.traceTitle(c.it), ...ctx.momTrace.slice(0, 1)], w: 3.2 });
  }
  // the moment's own detail its line lacks: why this clip spread
  const hook = SW.hookClause(ctx, story, { avoid: extras.aftermath ? extras.aftermath.text : '' });
  if (hook) { used.add(hook.it); push(0.5, { text: lowerFirst(hook.text, ctx.lex), trace: hook.trace, w: 3.6, kind: 'hook' }); }
  // the argument the clip started ("block or charge?"), only when two titles pose it or one says people are split
  const debate = SW.debateClause(ctx);
  if (debate) push(0.8, { text: debate.text, trace: debate.trace, w: 3.3, kind: 'debate' });
  // a late-night show taking it up days later: the second wave
  const wave = SW.waveClause(ctx, used);
  if (wave) { used.add(wave.it); push(1.8, { text: lowerFirst(wave.text, ctx.lex), trace: wave.trace, w: 3.1, kind: 'wave' }); }
  // what the moment led to (its aftermath came after the clip, so it is "then", not necessarily the story's newest turn)
  if (extras.aftermath) push(2, { text: lowerFirst(extras.aftermath.text, ctx.lex), trace: extras.aftermath.trace, w: 3.4 });
  // the latest turn first, so the stake is an earlier one (the openers quitting, not the new tour twice)
  const latest = latestClause(ctx, story, used);
  if (latest) { used.add(latest.it); push(2.5, { text: lowerFirst(latest.text, ctx.lex), trace: latest.trace, w: 2.8, kind: 'latest', fresh: !!latest.fresh }); }
  const defence = defenceClause(ctx, story);
  // (under a backlash story, the subject's own account is why the stance is only "alleged")
  if (defence) { used.add(defence.it); push(1, { text: lowerFirst(defence.text, ctx.lex), trace: defence.trace, w: story && story.backlash ? 3.7 : 3.3, kind: 'defence' }); }
  const stakes = defence ? null : stakesClause(ctx, story, latest);
  if (stakes) { used.add(stakes.it); push(1, { text: lowerFirst(stakes.text, ctx.lex), trace: stakes.trace, w: 3 }); }
  const again = repeatClause(ctx, story);
  if (again) push(3, { text: lowerFirst(again.text, ctx.lex), trace: again.trace, w: 2.6 });
  const earlier = extras.second ? null : earlierClause(ctx, story);
  if (earlier) push(3, { text: lowerFirst(earlier.text, ctx.lex), trace: earlier.trace, w: 2.3 });
  // big news about the main name the same week outranks a generic stake
  if (extras.second) push(3, { text: lowerFirst(extras.second.text, ctx.lex), trace: extras.second.trace, w: extras.second.big ? 3.05 : 2.2, kind: 'second' });
  const scale = scaleClause(ctx, story, [latest, stakes]);
  // a measured spread ("4 million views", "several thousand new subscribers") is a strong why; a count of stories a weak one
  if (scale) push(4, { text: scale.text, trace: scale.trace, w: scale.kind === 'count' ? 1.2 : scale.kind === 'number' ? 3.2 : 2.5, kind: scale.kind });
  if (scale && scale.extra && scale.kind === 'number') {
    const tr = scale.extra;
    push(5, { text: `“${tr.keyword}” hit ${fmtVolume(tr.volume)}+ ${tr.geo === 'GB' ? 'UK' : tr.geo} searches`, trace: [L.traceTrend(tr), ...ctx.momTrace.slice(0, 1)], w: 1.5, kind: 'search' });
  }
  if (ctx.dbg) for (const c of clauses) ctx.dbg(`      clause r${c.role} w${c.w} ${L.traceable(c.trace) ? '' : '(untraceable) '}${c.text}`);
  // a reversal's story line is the new state: a clause from before it tells the old state, so it is said as what came before
  const storyDay = story && story.kind === 'update' && story.it ? T.ymd(story.it.t) : null;
  for (const c of clauses) if (storyDay && c.kind !== 'search' && c.kind !== 'wiki' && c.trace[0] && c.trace[0].date && c.trace[0].date < storyDay) c.before = true;
  const ok = clauses.filter((c) => (c.attributed || L.traceable(c.trace)) && !F.CLICKBAIT.test(c.text) && !ENDS_OPEN.test(c.text.trim()) && !otherCard(c, ctx) &&
    onAngle(c, ctx, story, extras) &&
    !(c.trace[0] && R.MEDIA_TRADE.test(c.trace[0].source || ''))).sort((a, b) => b.w - a.w);
  const picked = [];
  const skipped = [];
  for (const c of ok) {
    if (picked.length >= WHY_MAX_CLAUSES) break;
    if ([...picked, c].map((x) => x.text).join('. ').length > WHY_MAX_CHARS) continue;
    const st = F.contentStems(c.text, ctx.skip).map(momWord);
    // another big story about the main name the same week never displaces the moment's own detail or cause (the chart record
    // beside the rejection), unless it shares the moment's own words
    if (c.kind === 'second' && picked.some((p) => p.kind === 'hook' || p.kind === 'cause') && !st.some((s) => ctx.momentOwn.has(s))) continue;
    if (picked.some((p) => sameClaim(p.text, c.text))) continue;
    const cs = new Set(st);
    const share = (set) => st.filter((x) => set.has(x)).length / Math.max(1, st.length);
    // (a clause that shares its names with another but makes another claim stays: "blames US tour promoter" beside "dropped")
    // (what set a backlash off and the subject's account of it are two claims however many names they share)
    const twoSides = (p) => (p.kind === 'cause' && c.kind === 'defence') || (p.kind === 'defence' && c.kind === 'cause');
    if (picked.some((p) => norm(p.text) === norm(c.text) || (!twoSides(p) && (overlap(p.text, cs, ctx) > WHY_DUP_OVERLAP || share(new Set(F.contentStems(p.text, ctx.skip).map(momWord))) > WHY_DUP_OVERLAP)))) continue;
    // it must add something: not the headline, story or moment again
    // (or all of them together: "rejects fan's date proposal amid reported Korory Fennurn romance" is the moment plus the story)
    const sameOpening = saidOpenings.has(openingOf(c.text));
    if (!c.fresh && (sameOpening || said.some((set) => share(set) >= WHY_SAID_OVERLAP) || share(saidAll) >= WHY_SAID_ALL)) {
      if (ctx.dbg) ctx.dbg(`      why-skip (says it again) ${c.text}`);
      c.adds = sameOpening ? 0 : st.filter((x) => !said.some((set) => set.has(x)) && !FILLER_STEMS.has(x)).length;
      skipped.push(c);
      continue;
    }
    picked.push(c);
  }
  // nothing new said: the skipped clause that adds the most (three new words at least: "Orran Neskick's" documentary, "paid" ads),
  // else the best-covered other title of the moment and its story that says something the card does not
  const sizeOnly = (c) => c.kind === 'search' || c.kind === 'count' || c.kind === 'wiki';
  if (picked.every(sizeOnly)) {
    const fb = skipped.filter((c) => c.adds >= WHY_FALLBACK_NEW && c.kind !== 'search' && c.kind !== 'count' && c.kind !== 'wiki').sort((a, b) => b.adds - a.adds || b.w - a.w)[0];
    const other = fb ? null : otherTitleClause(ctx, story, said, extras);
    if (fb) picked.unshift(fb);
    else if (other) picked.unshift(other);
    picked.splice(WHY_MAX_CLAUSES);
  }
  // a search surge or a story count says how big, not why: never the whole why
  if (picked.length && picked.every((c) => c.kind === 'search' || c.kind === 'count' || c.kind === 'wiki')) return null;
  if (!picked.length) return null;
  // stakes first, then the latest turn, then how big it is
  picked.sort((a, b) => a.role - b.role);
  const text = picked.map((c, i) => sentenceOf(c, i, ctx)).join(' ');
  const seen = new Set();
  const trace = picked.flatMap((c) => c.trace).filter((e) => { const k = `${e.source}|${e.text}`; return seen.has(k) ? false : seen.add(k); });
  return { text, trace };
}

/**
 * A clause from elsewhere in the coverage (the latest turn, a stake, a second story, an earlier backlash) and the moment's own
 * detail say why THIS story is big only when they share a word with the headline, story, moment or the controversy page's title
 * beyond a show's initials and their own verb, and (all but the moment's own detail) beyond the main name: "SNL pokes fun at Yarrace-Neskova relationship" beside "... pokes fun ... as Knicks
 * crash SNL" is another sketch, "Quorette Brannsy's ‘Choosin' Texas' topples Orrey Neskace's chart record" another story about her,
 * "Tavix Ostiss concerts cancelled because of bad weather" not the backlash.
 */
const LIGHT_OBJECT = /^(?:fun|aim|shade|history|back|out|up|down|off|heat|flak|part)$/;
const bareWord = (w) => words(w)[0] || '';
function onAngle(c, ctx, story, extras) {
  const checked = ['latest', 'second', 'hook', 'other'].includes(c.kind) || (!c.kind && (c.role === 1 || c.role === 3));
  if (!checked) return true;
  const texts = [...(extras.said || []), story ? story.text : '', story && story.article ? story.article.title : ''];
  // (every content word counts, the search's own too: "iced coffee")
  const none = new Set();
  const angle = new Set(F.contentStems(texts.filter(Boolean).join(' '), none));
  // (a record is history: "makes VMAs history" under "breaks record for most MTV VMAs")
  const record = angle.has('record');
  if (record) angle.add('history');
  // (the moment's own detail may share only its main name: "Orrory Neskova breaks his salute ..."; a clause from elsewhere may not)
  const eParts = new Set(c.kind === 'hook' || c.kind === 'other' ? [] : F.contentStems(ctx.E || '', new Set()));
  const ws = c.text.split(/\s+/);
  const initials = new Set(ws.filter((w) => /^[^\p{L}]*\p{Lu}{2,}s?[^\p{L}]*$/u.test(w)).map((w) => stem(words(w)[0] || '')));
  // an idiom of its own ("pokes fun", "takes aim") shares no story with another line that uses it
  const idiom = ws.findIndex((w, i) => i > 0 && LIGHT_OBJECT.test(bareWord(ws[i + 1] || '')) && !(record && bareWord(ws[i + 1]) === 'history') && W.looksVerb(bareWord(w)));
  const verb = new Set(idiom > 0 ? words(ws.slice(idiom, idiom + 2).join(' ')).map(stem) : []);
  const own = F.contentStems(c.text, none);
  const ok = own.some((st) => angle.has(st) && !eParts.has(st) && !initials.has(st) && !verb.has(st) && !FILLER_STEMS.has(st) && !T.ANGLE_STOP.has(st));
  if (ctx.dbg) ctx.dbg(`      angle ${ok ? 'ok' : 'OFF'} [${c.kind || c.role}] ${c.text} | own=${own.join(',')} e=${[...eParts].join(',')} verb=${[...verb].join(',')} initials=${[...initials].join(',')}`);
  return ok;
}

/**
 * One clause as a sentence a viewer reads: a late-night show's take days later is "Days later, ...", the newest turn "Since then,
 * ...", the state a reversal undid "Before that, ..."; a repeated full name after the first sentence is the surname alone.
 */
function sentenceOf(c, i, ctx) {
  let t = c.text.replace(/[.;,]+$/, '').trim();
  if (c.before) t = `before that, ${lowerFirst(pastClause(t), ctx.lex)}`;
  else if (i > 0 && c.kind === 'wave') t = `days later, ${lowerFirst(pastClause(t), ctx.lex)}`;
  else if (i > 0 && c.kind === 'latest') t = `since then, ${lowerFirst(t, ctx.lex)}`;
  if (i > 0 && ctx.E) {
    const full = T.surfaceOf(ctx.E, ctx.field);
    const last = full.split(' ').pop();
    if (full.includes(' ') && last.length > 2) t = t.replace(new RegExp(`(^|\\s)${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=['’]s\\b|\\b)`), `$1${last}`);
  }
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?][’”'"]?$/.test(t) ? t : `${t}.`;
}

// verbs a headline clause turns on, beyond the wording rules' list, and their past forms
const CLAUSE_VERB = /^(refuses?|rejects?|roasts?|mocks?|slams?|breaks?|says?|calls?|joins?|responds?|hits?|drops?|quits?|urges?|runs?|wins?|gets?|makes?|takes?|gives?|reverses?|announces?|reveals?|shares?|opens?|tops?|topples?|defends?|confirms?|denies?|returns?|replays?|grades?|threatens?|releases?|addresses?|admits?|apologi[sz]es?|launches?|debuts?|hosts?|reacts?)$/i;
const PAST = { break: 'broke', say: 'said', run: 'ran', win: 'won', get: 'got', make: 'made', take: 'took', give: 'gave', hit: 'hit', top: 'topped', drop: 'dropped', quit: 'quit', slam: 'slammed', grade: 'graded' };
/** "‘SNL’ Weekend Update roasts wincing Neskova's China meeting" -> "... roasted ...": the clause's first verb in the past. */
function pastClause(text) {
  const toks = text.split(' ');
  for (let i = 1; i < toks.length; i++) {
    const w = toks[i];
    const hedged = /^(reportedly|allegedly)$/i.test(toks[i - 1]);
    if (!/^[a-z]+$/.test(w) || !(CLAUSE_VERB.test(w) || (hedged && /^[a-z]{3,}$/.test(w)) || (W.VERB_RE.test(w) && !/ed$/.test(w)))) continue;
    const base = /(?:ss|sh|ch|x|z)es$/.test(w) ? w.slice(0, -2) : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /[^s]s$/.test(w) ? w.slice(0, -1) : w;
    toks[i] = PAST[base] || (/e$/.test(base) ? `${base}d` : /[^aeiou]y$/.test(base) ? `${base.slice(0, -1)}ied` : `${base}ed`);
    return toks.join(' ');
  }
  return text;
}

/**
 * A clause about another listed card's subject ("Esselle Quillith debuts ‘Patient Zero’" on the Zorrr card), or one that opens with
 * another person's name and never names the card's own: that person's news, not why this card is blowing up.
 */
function otherCard(c, ctx) {
  if (c.kind === 'search' || c.kind === 'wiki' || c.kind === 'note') return false;
  const tw = norm(c.text);
  // (a clause that names the card's own subject is about it: "‘SNL’ Weekend Update roasts wincing Neskova's China meeting")
  const named = !!ctx.E && (contains(tw, ctx.E) || tw.split(' ').includes(ctx.E.split(' ').pop()));
  const lead = tw.split(' ').slice(0, 3);
  // led by another person ("Tavia Ostow breaks Fenrel Zellsy's record"): kept only when it names the card's subject as more than
  // an owner ("Rouelle Trevurn joins Mirey Voraby on field")
  const person = ctx.E && [3, 2].map((k) => lead.slice(0, k).join(' ')).find((n) => n.split(' ').length >= 2 && ctx.lex.names.has(n) && !R.isPlaceOrTeam(n) &&
    ctx.lex.firstNames.has(lead[0]) && !contains(n, ctx.E) && !contains(ctx.E, n));
  if (named) return !!person && otherSubject(c.text, ctx.E);
  if ((ctx.otherAnchors || []).some((a) => a && (tw + ' ').startsWith(`${a} `))) return true;
  return !!person;
}

/**
 * The best-covered other title of the moment's coverage and its story that the card does not already say (three new words, none of
 * them filler), traced by a second title that shares two of its words. Only when no other clause could be shown.
 */
function otherTitleClause(ctx, story, said, extras) {
  const privateSubject = SW.isPrivateSubject(ctx);
  // (and what the main name said or did around the moment, wherever it was saved: "Zorrr says Orrus Neskenko's team ghosted her")
  const near = ctx.E ? ctx.field.filter((it) => namesE(it, ctx.E) && Math.abs(it.t - ctx.momentFirst) <= 2 * DAY && (SAID_DID.test(it.title) || F.CONFLICT.test(it.title))) : [];
  const rows = SW.firstCopies(uniqByKey([...ctx.momItems, ...(ctx.hookRows || []), ...ctx.momentRows, ...(story && story.items ? story.items : []), ...near]))
    .filter((it) => it.t <= ctx.now + DAY && it.t >= ctx.momentFirst - 2 * DAY && !F.REVIEW.test(it.title) && !F.EXPLAINER.test(it.title) && !F.LOGISTICS.test(it.title) &&
      (!SW.SENSITIVE.test(it.title) || ctx.sensitiveCard) && !/\?/.test(it.title) && !F.VAGUE.test(it.title) && !LISTICLE.test(it.title) && it.drop !== 'publisher' &&
      // a private person is never shamed ("US man slammed as mom juggles baby"): her side of it is told instead
      !(privateSubject && (SW.SHAMING.test(it.title) || SW.TARGETS_PRIVATE.test(it.title) || F.LABEL.test(it.title))) &&
      !(SW.REPORT.test(it.title) && !SW.REPORT.test(ctx.momentText)) && (!ctx.E || namesE(it, ctx.E)));
  const cands = rows.map((it) => lineOf(it, ctx, ctx.E, WHY_LIMITS) || SW.rawLine(it, ctx, 16)).filter(Boolean).filter((x) => !F.OPINION.test(x.text) && !F.META.test(x.text) &&
    !F.FUTURE.test(x.text) && !F.CLICKBAIT.test(x.text) && (hasVerb(x.text) || VERBISH.test(x.text)))
    .map((x) => {
      const st = F.contentStems(x.text, ctx.skip).map(momWord);
      const adds = st.filter((s) => !said.some((set) => set.has(s)) && !FILLER_STEMS.has(s)).length;
      // what someone said or did beats a caption: "Zorrr says ...", "Orrus Neskenko defends herself after Zorrr calls her out"
      const deed = (SAID_DID.test(x.text) ? 1.5 : 0) + (F.CONFLICT.test(x.text) ? 1 : 0) + (privateSubject && SW.REBUTTAL.test(x.it.title) ? 1.5 : 0);
      return { ...x, adds, s: F.consensusOf(x.text, ctx.df, ctx.skip) + F.outletQuality(x.it) + 0.3 * Math.min(4, adds) + deed };
    }).filter((x) => x.adds >= WHY_FALLBACK_NEW && said.every((set) => F.contentStems(x.text, ctx.skip).map(momWord).filter((s) => set.has(s)).length / Math.max(1, F.contentStems(x.text, ctx.skip).length) < WHY_SAID_OVERLAP))
    .sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  // a quoted claim about a private person ("‘He was grieving’") needs a major outlet or another source saying it
  const quoteBacked = (x) => {
    const q = (W.curlQuotes(x.text).match(/[‘“]([^’”]{3,60})[’”]/g) || []).flatMap((m) => F.contentStems(m, ctx.skip));
    return !q.length || F.MAJOR.test(x.it.outlet || '') || rows.some((it) => it.src !== x.it.src && q.some((st) => it.textStems.has(st)));
  };
  for (const x of cands) {
    if (privateSubject && !quoteBacked(x)) continue;
    const trace = traceFor(x, ctx, rows);
    const c = { text: lowerFirst(x.text, ctx.lex), trace, w: 2, kind: 'other' };
    if (L.traceable(trace) && !otherCard(c, ctx) && !R.MEDIA_TRADE.test(x.it.outlet || '') && onAngle(c, ctx, story, extras)) return c;
  }
  return null;
}

// ---------- gates ----------
/**
 * Independent sources for the moment: a syndicated copy of one title once, a weak outlet, a re-host or a social repost at half weight,
 * and one of r/popular's top five posts of the day as two (millions saw it: "AMC butter isn't butter", with one outlet calling it viral).
 */
function sourceWeight(ctx, withMembers = true) {
  const bySrc = new Map();
  for (const it of SW.firstCopies([...ctx.momItems, ...(withMembers ? ctx.members : ctx.hookRows || []), ...ctx.momentRows])) {
    const w = it.fam === 'reddit' && it.sub === 'popular' && it.rankDay < POPULAR_TOP_RANK ? POPULAR_TOP_WEIGHT
      : it.fam === 'reddit' || it.fam === 'bluesky' || it.fam === 'kym' ? 1 : F.outletQuality(it) <= -1 || R.REHOST.test(it.outlet || '') || /^facebook/i.test(it.outlet || '') ? 0.5 : 1;
    bySrc.set(it.src, Math.max(bySrc.get(it.src) || 0, w));
  }
  return [...bySrc.values()].reduce((a, v) => a + v, 0);
}

/**
 * Freshness and evidence: a moment older than ten days needs a follow-up in the last 72 h, coverage that stopped five days ago
 * is over, and an idea needs three independent sources. A fact check or "fake"/"edited" row about the moment vetoes it.
 */
function gate(ctx) {
  if (ctx.corr.fake.length) return `fake (${ctx.corr.fake[0].outlet}: ${ctx.corr.fake[0].title.slice(0, 80)})`;
  const rows = ctx.onTopic;
  const age = Math.round((Math.floor(ctx.now / DAY) - Math.floor(ctx.momentFirst / DAY)));
  const own = (ctx.ownStory ? rows : rows.filter((i) => ctx.momItems.includes(i))).filter((i) => !R.REHOST.test(i.outlet || ''));
  const followUp = own.some((i) => i.t >= ctx.now - FOLLOW_UP_HOURS * HOUR && i.t > ctx.momentFirst + DAY);
  const last = own.length ? Math.max(...own.map((i) => i.t)) : ctx.momentFirst;
  if (age > FRESH_MAX_DAYS && !followUp) return `stale (${Math.round(age)} days, no follow-up in ${FOLLOW_UP_HOURS} h)`;
  if ((ctx.now - last) / DAY > QUIET_MAX_DAYS) return `quiet (last coverage ${ymd(last)})`;
  const srcs = sourceWeight(ctx);
  if (srcs < MIN_SOURCES) return `thin (${srcs} independent sources for the moment)`;
  return null;
}

module.exports = {
  STORY_MIN, lineOf, storyScore, controversyStory, correctionStory, focusStory, contextStory, momentLine, siblingMoments,
  repeatEvents, repeatStory, whyLine, gate, sourceWeight, setupFragment, lowerFirst, dayLabel, earlierClause,
};
