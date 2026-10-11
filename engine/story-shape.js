'use strict';
/*
 * Story step, making each line name the real story (story.js calls these after the story is chosen):
 *   article    a Wikipedia page named for the controversy tells it: the backlash against the main name when three independent
 *              titles show it ("Ed Sheeran faces backlash over alleged Palestine stance", the page's own cause as a noun, "alleged"
 *              when the name's own coverage blames someone else), what set it off going to the why ("Macklemore dropped from Ed
 *              Sheeran tour after onstage ‘Free Palestine’ statements"); else the saved title that tells the page's cause, a third
 *              party's hand in it "reportedly", never "<page title>: <line>"
 *   co-mention the story the moment's own headlines name ("... amid reported Tucker Wetmore romance") beats the moment's own
 *              aftermath, with who the other person is ("country singer Tucker Wetmore")
 *   gate       a context story must share the moment's own words or be the same event (a day either side): an award three days
 *              later is not why a tunnel collision spread; else the moment's own context tells it
 *   topic      a story-shaped headline (a meme database's label) is told as who did what and why it is contested
 *   report     a ratings release is no moment: the clip people shared that day stands in, and "figures revealed as fans divided
 *              over new hosts" is told by its conflict
 *   moment     the moment line names the show or host its coverage names ("mid-interview on Piers Morgan Uncensored") and keeps
 *              the hedge its reported claim carries ("Platforms reportedly reject ...")
 * Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const F = require('./story-focus');
const L = require('./story-lines');
const T = require('./story-terms');
const PICK = require('./story-pick');
const SW = require('./story-why');
const { contains, uniqByKey } = require('./util');

const { DAY, words, stem } = T;
const norm = (s) => words(s).join(' ');
const STORY_LIMITS = { words: 16, chars: 100, long: 15 };
const MOMENT_TERM_SHARE = 0.3; // a word this share of the moment's coverage uses is the moment's own
const SAME_EVENT_DAYS = 1;
const FRAME_WORD = /^(controvers\w*|feud|scandal|dispute|backlash|boycott|tour|row|saga|affair|incident|the|and|of)$/;
const REPORT = SW.REPORT;

// ---------- article ----------
/** The cause the page gives in its first sentence: "... after Macklemore's onstage "free Palestine" statements in support of ...". */
function articleCause(art, skip, others) {
  const first = (art.extract || '').split(/(?<=[.!?])\s+/)[0] || '';
  const m = first.match(/\b(?:after|over|following|because of)\s+(.+?)(?:\s+(?:during|in support|in response|amid)\b|[,;.]|$)/i);
  if (!m) return [];
  const own = new Set(others.map(stem));
  return F.contentStems(m[1], skip).filter((s) => !own.has(s) && !T.ANGLE_STOP.has(s) && s.length >= 4);
}
const hasCause = (it, cause) => cause.some((c) => [...it.textStems].some((s) => s.includes(c.slice(0, Math.min(7, c.length)))));

/** A saved line minus the words the page title already says ("from Ed Sheeran tour"). */
function withoutTitleWords(text, titleWords) {
  const toks = text.split(/\s+/);
  for (let i = 1; i < toks.length - 1; i++) {
    if (!/^(from|off|on|of)$/i.test(toks[i])) continue;
    let j = i + 1;
    while (j < toks.length && j - i <= 4 && words(toks[j]).every((w) => titleWords.has(w) || titleWords.has(w.replace(/s$/, '')) || /^(the|his|her)$/.test(w))) j++;
    if (j - i < 2) continue;
    const particle = /^off$/i.test(toks[i]) && /^(forced|kicked|booted|thrown|pushed)$/i.test(toks[i - 1]);
    return [...toks.slice(0, particle ? i + 1 : i), ...toks.slice(j)].join(' ');
  }
  return text;
}

/**
 * The page title with its cause: the best saved title that names the page's other party, says what was done to them and carries the
 * page's own cause ("Palestine"), minus what the title already says.
 */
function articleLine(P, art) {
  const flat = art.title.replace(/[–—-]/g, ' ');
  const titleWords = new Set(norm(flat).split(' '));
  const eParts = new Set((P.E || '').split(' '));
  const others = norm(flat).split(' ').filter((w) => !eParts.has(w) && !FRAME_WORD.test(w) && !W.STOP.has(w));
  if (!others.length) return null;
  const cause = articleCause(art, P.skip, others);
  if (!cause.length) return null;
  const rows = uniqByKey(P.field).filter((it) => others.every((o) => it.textStems.has(stem(o))) && F.CONFLICT.test(it.title) && hasCause(it, cause) &&
    !F.OPINION.test(it.title) && !F.REVIEW.test(it.title) && !F.EXPLAINER.test(it.title));
  const lead = others.join(' ');
  const cands = rows.map((it) => PICK.lineOf(it, P, lead, STORY_LIMITS)).filter(Boolean).map((x) => {
    const text = withoutTitleWords(x.text, titleWords);
    const s = F.outletQuality(x.it) + ((norm(text) + ' ').startsWith(`${lead} `) ? 2 : 0) + (hasCause(T.probe(text), cause) ? 2 : -5) +
      (F.CONFLICT.test(text) ? 1 : -3) - (text.split(/\s+/).length > 11 ? 1 : 0) - (x.cut ? 0.5 : 0);
    return { ...x, text, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  if (P.dbg) for (const x of cands.slice(0, 4)) P.dbg(`      article-cause ${x.s.toFixed(2)} ${x.text} <= ${x.it.outlet}`);
  const pick = cands[0];
  if (!pick) return null;
  const trace = L.traceItems(pick.it, rows).map(L.traceTitle);
  // the saved line alone, never "<page title>: <line>"; a third party's action one outlet reports stays "reportedly"
  const text = THIRD_PARTY.test(pick.text) && !/\breportedly\b/i.test(pick.text) ? pick.text.replace(THIRD_PARTY, (m) => `reportedly ${m}`) : pick.text;
  return { text, trace: [L.traceArticle(art), ...trace], keys: others.length ? [`n:${lead}`] : [] };
}
const THIRD_PARTY = /\b(?:forced|pressured|pushed|kicked|booted) (?:off|out)\b(?= .*\bby\b)|\bbanned by\b/i;

// ---------- the backlash a controversy page names ----------
// E on the receiving end: the internet outraged with them, a country disowning them, followers lost, their neutrality attacked
const AT_E = /\b(outrag\w*|disowns?|disowned|backlash|boycott\w*|lost .{0,40}followers|criticis\w*|criticiz\w*|neutrality|coward\w*|which side|slamm?\w*|rips?|ripped|blast\w*|calls? out|called out|under fire|protest\w*)\b/i;
const E_ACTS = /^(?:\S+\s+){0,1}(?:slams|rips|blasts|criticis\w+|criticiz\w+|calls out|protests)\b/i;
const DENIES = /\b(blames?|blamed|not mine|not my (?:call|decision)|denies|denied|made (?:the )?['‘]?final|clarif\w+)\b/i;
const STANCE = /\b(stance|neutrality|silence|position|views|remarks|comments)\b/i;
const DROPPED = /\b(dropped|removed|cut|axed|booted|kicked off|forced off|pulled from|ousted|ouster|removal|firing)\b/i;
// "... after Macklemore was dropped over pro-Palestinian comments": the other party's drop told inside another outlet's title
const DROP_CLAUSE = /\b(?:after|as)\s+(.+?)\s+((?:(?:was|is|got|gets|were)\s+)?(?:dropped|removed|cut|axed|booted|kicked off|forced off|pulled)\b.*)$/i;

/** The drop clause of a line when it names the other party ("Macklemore was dropped over pro-Palestinian comments"), else null. */
function dropClause(text, other) {
  const m = text.match(DROP_CLAUSE);
  if (!m || norm(m[1]) !== other) return null;
  const out = `${m[1]} ${m[2]}`.replace(/[\s.,;:]+$/, '');
  return out.split(/\s+/).length >= 4 && !/\b(?:in|of|to|for|with|at|on|by|about|from|the|a|an|and|or|but|over)$/i.test(out) ? out : null;
}

/**
 * "Ed Sheeran faces backlash over alleged Palestine stance": when the page named for a controversy holds the main name and three
 * independent saved titles show the main name on the receiving end, the story is the backlash against them, told calmly: the
 * page's own cause ("free Palestine") as a noun, "alleged" when their own coverage blames someone else or denies it. The event
 * that set it off ("Macklemore dropped from Ed Sheeran tour after onstage ‘Free Palestine’ statements") goes to the why.
 */
function backlashLine(P, art) {
  if (!P.E || !/\b(controvers\w*|feud|scandal|backlash|boycott|row|dispute)\b/i.test(art.title)) return null;
  const flat = norm(art.title.replace(/[–—-]/g, ' '));
  if (!contains(flat, P.E)) return null;
  const Es = T.surfaceOf(P.E, P.field);
  const lead = (it) => (norm(it.title) + ' ').startsWith(`${P.E} `);
  const named = uniqByKey(P.field).filter((it) => T.namesE(it, P.E) && !F.REVIEW.test(it.title));
  const target = named.filter((it) => AT_E.test(it.title) && !(lead(it) && E_ACTS.test(norm(it.title).slice(P.E.length).trim())));
  const groups = new Set(SW.firstCopies(target).map((it) => (it.fam === 'reddit' || it.fam === 'bluesky' ? it.fam : String(it.outlet || it.src).toLowerCase())));
  if (P.dbg) P.dbg(`      backlash targets=${target.length} groups=${groups.size}`);
  if (groups.size < BACKLASH_MIN_SOURCES) return null;
  // the cause, as the page's first sentence names it: its capitalised word that is no one's name ("free Palestine" -> Palestine)
  const first = (art.extract || '').split(/(?<=[.!?])\s+/)[0] || '';
  const m = first.match(/\b(?:after|over|following|because of)\s+(.+?)(?:\s+(?:during|in support|in response|amid)\b|[,;.]|$)/i);
  const titleWords = new Set(flat.split(' '));
  const causeWord = m ? (W.curlQuotes(m[1]).match(/\b\p{Lu}[\p{Ll}]{3,}\b/gu) || []).find((w) => !titleWords.has(w.toLowerCase()) &&
    named.filter((it) => it.textWords.includes(w.toLowerCase().slice(0, 7))).length >= 2) : null;
  if (!causeWord) return null;
  const stanceRows = named.filter((it) => STANCE.test(it.title));
  const denies = named.filter((it) => DENIES.test(it.title) && lead(it));
  const hedge = denies.length ? 'alleged ' : '';
  const text = `${Es} faces backlash over ${hedge}${causeWord} stance`;
  const trace = [L.traceArticle(art), ...L.traceItems(target[0], [...target, ...stanceRows, ...denies]).map(L.traceTitle)];
  if (!L.traceable(trace.slice(1))) return null;
  // the event that set it off, for the why: the other party dropped, with the cause, never a third party's claimed hand in it
  const other = flat.split(' ').filter((w) => !P.E.split(' ').includes(w) && !FRAME_WORD.test(w) && !W.STOP.has(w));
  const causeRows = uniqByKey(P.field).filter((it) => other.length && other.every((o) => it.textStems.has(stem(o))) && DROPPED.test(it.title) &&
    it.textWords.includes(causeWord.toLowerCase().slice(0, 7)) && !THIRD_PARTY.test(it.title) && !F.OPINION.test(it.title) && !F.REVIEW.test(it.title));
  const causeHead = causeWord.toLowerCase().slice(0, 7);
  const causeOk = (x) => DROPPED.test(x.text) && x.text.toLowerCase().includes(causeHead) && (norm(x.text) + ' ').startsWith(`${other.join(' ')} `);
  const lines = causeRows.map((it) => PICK.lineOf(it, P, other.join(' '), STORY_LIMITS)).filter(Boolean);
  const direct = lines.filter(causeOk);
  // (no title leads with the other party: the drop clause inside one, "after Macklemore was dropped over ...", tells it)
  const clauses = direct.length ? [] : lines.map((x) => { const t = dropClause(x.text, other.join(' ')); return t ? { ...x, text: t, cut: true } : null; })
    .filter((x) => x && causeOk(x));
  const causeLines = [...direct, ...clauses]
    .map((x) => ({ ...x, s: F.outletQuality(x.it) + F.consensusOf(x.text, P.df, P.skip) - (x.cut ? 0.5 : 0) - 0.1 * x.text.split(/\s+/).length }))
    .sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  if (P.dbg) P.dbg(`      backlash cause rows=${causeRows.length} lines=${causeLines.map((x) => x.text).join(' | ')}`);
  const c = causeLines[0];
  const causeTrace = c ? L.traceItems(c.it, causeRows).map(L.traceTitle) : null;
  const causeLine = c && L.traceable(causeTrace) ? { text: c.text, trace: causeTrace } : null;
  if (P.dbg) P.dbg(`      backlash "${text}" cause=${causeLine ? causeLine.text : '-'}`);
  return { text, trace, keys: [`n:${other.join(' ')}`], causeLine, backlash: true };
}
const BACKLASH_MIN_SOURCES = 3;

// ---------- the story the moment's own headlines name ----------
/**
 * "... rejects fan's date proposal amid reported Tucker Wetmore romance": the story two of the moment's own titles give. A romance
 * stays "reported" and the other person is named with who they are.
 */
function coMentionStory(P, A, pool) {
  if (SW.isPrivateSubject(P)) return null;
  const REL = /^(?:(?:reported|rumou?red|new|alleged)\s+)?(.+?)\s+(romance|relationship|engagement|split|breakup|feud|drama|controversy|row|scandal)$/;
  const found = new Map();
  for (const c of A.causes) {
    const m = c.words.match(REL);
    const first = m ? m[1].split(' ')[0] : '';
    if (!m || !(W.isFirstName(first) || P.lex.firstNames.has(first) || P.lex.names.has(m[1])) || m[1].split(' ').length < 2 || contains(m[1], P.E)) continue;
    const k = `${m[1]}|${m[2]}`;
    found.set(k, (found.get(k) || new Set()).add(c.it));
  }
  // the other person's story must be told beyond the moment too: three rows name them with the relationship
  if (P.dbg) P.dbg(`      co-mention causes=${A.causes.map((c) => c.words).join(' | ')} found=${[...found.keys()].join(',')}`);
  const best = [...found.entries()].map(([k, its]) => {
    const [name, frame] = k.split('|');
    const rows = uniqByKey(pool).filter((it) => contains(it.textWords, name) && (frame === 'romance' ? F.ROMANCE.test(it.title) || /\bromance\b/i.test(it.title) : true));
    return { name, frame, its: [...its], rows };
  }).filter((x) => x.rows.length >= 3).sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!best) return null;
  const since = Math.min(...best.rows.map((i) => i.t));
  // the moment's own headline that names both what happened and the other story is the story ("Country star Ella Langley
  // rejects fan's date proposal amid reported Tucker Wetmore romance"): the side plot alone is not what went viral
  const own = [...(P.momentOwn || [])];
  const told = best.its.filter((it) => own.some((st) => it.textStems.has(st)))
    .map((it) => PICK.lineOf(it, P, P.E, STORY_LIMITS)).filter((x) => x && contains(norm(x.text), best.name))
    .sort((a, b) => F.outletQuality(b.it) - F.outletQuality(a.it) || a.it.t - b.it.t)[0];
  if (told) {
    const trace = L.traceItems(told.it, [...best.its, ...best.rows]).map(L.traceTitle);
    if (L.traceable(trace)) return { kind: 'cause', text: told.text, trace, it: told.it, items: best.rows, since, keys: [`n:${best.name}`] };
  }
  const gloss = SW.glossPerson(best.name, P);
  const surface = T.surfaceOf(best.name, best.rows);
  const who = gloss && gloss.desc ? `${gloss.desc} ${surface}` : surface;
  const Es = T.surfaceOf(P.E, P.field);
  // a statement, not a label: "Ella Langley is reportedly dating country singer Tucker Wetmore"
  const text = /romance|relationship/.test(best.frame) ? `${Es} is reportedly dating ${who}` : /engagement/.test(best.frame) ? `${Es} is reportedly engaged to ${who}` :
    `${Es}’s ${best.frame} with ${who}`;
  const trace = L.traceItems(best.its[0], [...best.its, ...best.rows]).map(L.traceTitle);
  if (!L.traceable(trace)) return null;
  return { kind: 'cause', text, trace, it: best.its[0], items: best.rows, since, keys: [`n:${best.name}`] };
}

// ---------- the gate ----------
/** Words most of the moment's coverage uses, beyond the main name, leagues, teams and places. */
function momentTerms(P) {
  const rows = SW.firstCopies([...P.momItems, ...P.momentRows]);
  const srcs = new Set(rows.map((i) => i.src)).size || 1;
  const by = new Map();
  for (const it of rows) for (const s of F.contentStems(it.title, P.skip)) { if (!by.has(s)) by.set(s, new Set()); by.get(s).add(it.src); }
  const eParts = new Set((P.E || '').split(' '));
  // a name or a title (a word no dictionary has, or one the corpus prints as a name) ties with two rows; a plain word needs a share
  const named = (s) => P.lex.proper.has(s) || !W.inDict(s) || (P.titled && P.titled.has(s));
  return new Set([...by].filter(([s, set]) => set.size >= (named(s) ? 2 : Math.max(2, MOMENT_TERM_SHARE * srcs)) && !eParts.has(s) && !T.ANGLE_STOP.has(s) &&
    !T.ORG_NAMES.has(s) && !R.TEAM_WORDS.has(s) && !R.PLACES.has(s) && !W.GENERIC.has(s)).map(([s]) => s));
}

/** A context story shares the moment's own words or happened at the same event (a day either side). */
function linkedToMoment(P, story) {
  if (!story || !['saga', 'context'].includes(story.kind) || story.article) return true;
  const terms = momentTerms(P);
  const st = F.contentStems(story.text, P.skip);
  if (P.dbg) P.dbg(`      gate terms=${[...terms].join(',')} story=${st.join(',')}`);
  if (st.some((s) => terms.has(s))) return true;
  // what happened to the moment's people (a death, an arrest) is tied by the titles that tell it, however short the line is
  // ("Cindy Crawford’s son dies at 27" beside "Presley Gerber, son of Cindy Crawford, dies at 27")
  const told = [...(story.items || []), ...(story.it ? [story.it] : [])];
  if (F.RESULT.test(story.text) && told.some((it) => F.contentStems(it.title, P.skip).some((s) => terms.has(s)))) return true;
  // a name or title the moment's own rows print ("Primetime" beside Pattinson's kitchen meme)
  const named = (x) => P.lex.proper.has(x) || !W.inDict(x) || (P.titled && P.titled.has(x));
  const rows = [...(P.hookRows || []), ...P.momItems];
  if (st.some((x) => named(x) && !T.ORG_NAMES.has(x) && !(P.E || '').split(' ').includes(x) && rows.some((it) => it.textStems.has(x)))) return true;
  const t = story.it ? story.it.t : story.since;
  return Number.isFinite(t) && Math.abs(t - P.momentFirst) <= SAME_EVENT_DAYS * DAY && F.EVENT.test(story.text);
}

/**
 * The moment's own context, when no bigger story is tied to it: the line its coverage uses that says where and when it happened
 * ("A'ja Wilson plows into WNBA staffer ahead of regular season finale").
 */
function momentContextStory(P) {
  const WHERE = /\b(ahead of|before|after|during|at|in the)\b.*\b(finale|game|match|show|concert|premiere|opener|tunnel|interview|wedding|summit|visit|ceremony|broadcast|season)\b/i;
  const own = [...(P.momentOwn || [])];
  const rows = SW.firstCopies([...(P.hookRows || []), ...P.momItems]).filter((it) => Math.abs(it.t - P.momentFirst) <= 2 * DAY);
  const cands = rows.flatMap((it) => [PICK.lineOf(it, P, P.E, STORY_LIMITS), SW.rawLine(it, P)]).filter(Boolean)
    .filter((x) => WHERE.test(x.text) && (!P.E || contains(norm(x.text), P.E)) && !F.OPINION.test(x.text) && !/\?/.test(x.text) &&
      !F.MOMENT_FRAME.test(x.text.replace(/\bgoes viral for\b/i, '')) && !F.unsafeLine(x.text))
    .map((x) => {
      const text = x.text.replace(/\bgoes viral for (\w+)ing\b/i, (m, v) => `${v}s`).replace(/\s+/g, ' ');
      const st = T.probe(text).textStems;
      const s = F.consensusOf(text, P.df, P.skip) + F.outletQuality(x.it) + own.filter((o) => st.has(o)).length + (x.cut ? -0.5 : 0);
      return { ...x, text, s };
    }).sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  if (P.dbg) for (const x of cands.slice(0, 4)) P.dbg(`      moment-context ${x.s.toFixed(2)} ${x.text} <= ${x.it.outlet}`);
  for (const x of cands) {
    const trace = L.traceItems(x.it, rows).map(L.traceTitle);
    if (L.traceable(trace)) return { kind: 'moment', text: x.text, trace, it: x.it, items: rows, since: P.momentFirst };
  }
  return null;
}

// ---------- a story-shaped headline ----------
/**
 * "Last Ditch bar mask-optional controversy" is a meme database's label: the story is told by the best title that names the topic,
 * says what happened and that people fought over it ("Greenfield lesbian bar Last Ditch eases mask rule, faces furious backlash").
 */
function topicStory(P, A, headline, queryWords) {
  const key = P.E ? P.E.split(' ') : [...queryWords].filter((w) => w.length > 2);
  const names = (it) => key.length && key.every((w) => it.textWords.split(' ').some((x) => stem(x) === stem(w) || x === w));
  const pool = uniqByKey([...A.cov, ...P.field]).filter((it) => names(it) && (F.CONFLICT.test(it.title) || /\b(debate|divid|split)\w*\b/i.test(it.title)) &&
    !F.OPINION.test(it.title) && !F.REVIEW.test(it.title) && !F.EXPLAINER.test(it.title) && !/\?/.test(it.title) && !SW.SENSITIVE.test(it.title));
  const cands = pool.map((it) => PICK.lineOf(it, P, P.E, STORY_LIMITS)).filter(Boolean).filter((x) => norm(x.text) !== norm(headline) && names(T.probe(x.text)) &&
    (F.CONFLICT.test(x.text) || /\b(debate|divid|split)\w*\b/i.test(x.text)) && !F.MOMENT_FRAME.test(x.text) && !F.META.test(x.text));
  cands.forEach((x) => {
    x.s = F.consensusOf(x.text, P.df, P.skip) + F.outletQuality(x.it) + (T.hasVerb(x.text) ? 1 : -2) - (x.cut ? 1 : 0) +
      (P.E && (norm(x.text) + ' ').includes(`${P.E} `) ? 1.5 : 0) + 0.5 * Math.max(0, 1 - Math.abs(x.it.t - A.momentFirst) / (3 * DAY));
  });
  cands.sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  if (P.dbg) for (const x of cands.slice(0, 4)) P.dbg(`      topic ${x.s.toFixed(2)} ${x.text} <= ${x.it.outlet}`);
  for (const x of cands) {
    const trace = L.traceItems(x.it, pool).map(L.traceTitle);
    if (L.traceable(trace)) return { text: x.text, trace, it: x.it };
  }
  return null;
}

/** Where a story-shaped moment began, as its own coverage tells it: "A Globe story about a mask controversy at a lesbian bar went viral". */
function originViral(P, A) {
  const rows = uniqByKey([...A.cov, ...P.field]).filter((it) => T.ORIGIN_RE.test(it.title) && /\b(went viral|goes viral|broke the internet|viral (?:story|article|post|video))\b/i.test(it.title) &&
    it.t <= A.momentFirst + 2 * DAY && !F.OPINION.test(it.title));
  const cands = rows.map((it) => SW.rawLine(it, P, 14)).filter(Boolean).filter((x) => T.ORIGIN_RE.test(x.text) && /\bviral|internet\b/i.test(x.text));
  cands.sort((a, b) => F.outletQuality(b.it) - F.outletQuality(a.it) || a.it.t - b.it.t);
  const x = cands[0];
  return x ? { text: x.text, trace: L.traceItems(x.it, [x.it, ...A.cov]).map(L.traceTitle) } : null;
}

// ---------- a trailer's work ----------
const TRAILER = /\b(trailer|teaser)\b/i;
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
/**
 * A trailer that went viral is a turn of its work's story: "Nathan Fielder’s Elizabeth Holmes documentary ‘You Can See Everything’
 * (in theaters October 16)", its maker, subject, kind and title as the titles print them, and its date when two say it.
 */
function workStory(P) {
  if (!P.E || !TRAILER.test(P.momentText)) return null;
  const rows = uniqByKey(P.field).filter((it) => /\b(doc|documentary|film|movie|series)\b/i.test(it.title));
  if (rows.length < 3) return null;
  const Es = T.surfaceOf(P.E, P.field);
  const titles = new Map();
  const makers = new Map();
  const dates = new Map();
  const count = (m, k, it) => m.set(k, (m.get(k) || new Set()).add(it.src));
  for (const it of rows) {
    const t = W.curlQuotes(it.title);
    for (const q of t.matchAll(/[‘“]([^’”]{4,40})[’”]/g)) if (/^\p{Lu}/u.test(q[1]) && !contains(norm(q[1]), P.E)) count(titles, q[1].replace(/[.,!?]+$/, ''), it);
    const mk = t.match(new RegExp(`((?:\\p{Lu}[\\p{L}.’'-]+\\s+){1,2}\\p{Lu}[\\p{L}’'-]+?)['’]s\\s+(?:(?:secret|new|wild|upcoming)\\s+)?${Es.split(' ').join('\\s+')}\\s+(doc|documentary|film|movie|series)`, 'iu'));
    if (mk) count(makers, `${mk[1]}|${/^doc/i.test(mk[2]) ? 'documentary' : mk[2].toLowerCase()}`, it);
    const d = t.match(new RegExp(`\\b(?:in theaters|out|arrives|opens|releases?|premieres?|hits theaters)\\s+(?:on\\s+)?(${MONTH}\\.?\\s+\\d{1,2})\\b`, 'i'));
    if (d) count(dates, d[1].replace(/\.$/, ''), it);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0];
  const ti = top(titles);
  const mk = top(makers);
  if (!ti || ti[1].size < 3 || !mk || mk[1].size < 2) return null;
  const [maker, kind] = mk[0].split('|');
  const date = top(dates);
  // (a release date is the why's business, never a parenthetical in the story)
  const text = `${maker}’s ${Es} ${kind} ‘${ti[0]}’`;
  const its = rows.filter((it) => contains(it.textWords, norm(ti[0])) && contains(it.textWords, norm(maker)));
  const trace = L.traceItems(its[0] || rows[0], its.length ? its : rows).map(L.traceTitle);
  return L.traceable(trace) ? { kind: 'context', text, trace, it: its[0], items: its, since: Math.min(...its.map((i) => i.t)), keys: [`p:${norm(ti[0])}`] } : null;
}

// ---------- a report is no moment ----------
/** A ratings release is a report: the clip people shared that day stands in (two sources, a named person, a moment or conflict). */
function reportMoment(P, story) {
  if (!REPORT.test(P.momentText)) return null;
  const keys = story ? new Set(F.contentStems(story.text, P.skip).filter((s) => !T.ANGLE_STOP.has(s))) : new Set();
  const rows = uniqByKey(P.field).filter((it) => Math.abs(it.t - P.momentFirst) <= 1.5 * DAY && !REPORT.test(it.title) && !F.EXPLAINER.test(it.title) &&
    !F.LOGISTICS.test(it.title) && !F.REVIEW.test(it.title) && (R.RE.moment.test(it.title) || /\b(warning|asks|jokes?|clash\w*|swipe|dig|confront\w*)\b/i.test(it.title)));
  const VAGUE_ONE = /\b(one thing|same (?:thing|complaint|remark|detail)|this detail|what happened)\b/i;
  const LIST = /\b(unveils?|reveals?|announces?|confirms?|releases?)\b.*\b(dances|songs|line-?up|list|pairings|couples|scores|leaderboard)\b/i;
  // a person other than the show did something: a named first name in the line
  const person = (text) => (text.match(/\b\p{Lu}[\p{L}’'-]+\s+\p{Lu}[\p{L}’'-]+/gu) || []).some((n) => W.isFirstName(words(n)[0]) && !(P.E && contains(norm(n), P.E)));
  const cands = rows.filter((it) => !VAGUE_ONE.test(it.title) && !F.VAGUE.test(it.title) && !LIST.test(it.title)).map((it) => PICK.lineOf(it, P, P.E, STORY_LIMITS)).filter(Boolean)
    .filter((x) => T.hasVerb(x.text) && !F.OPINION.test(x.text) && !/\?/.test(x.text) && person(x.text));
  cands.forEach((x) => {
    const st = T.probe(x.text).textStems;
    x.s = F.consensusOf(x.text, P.df, P.skip) + F.outletQuality(x.it) + [...keys].filter((k) => st.has(k)).length +
      (x.it.allNames.filter((n) => n !== P.E && n.includes(' ')).length ? 1 : 0);
  });
  cands.sort((a, b) => b.s - a.s || a.it.t - b.it.t);
  if (P.dbg) for (const x of cands.slice(0, 4)) P.dbg(`      report-swap ${x.s.toFixed(2)} ${x.text} <= ${x.it.outlet}`);
  for (const x of cands) {
    const trace = L.traceItems(x.it, [x.it, ...rows.filter((it) => F.contentStems(x.text, P.skip).filter((s) => it.textStems.has(s)).length >= 2)]).map(L.traceTitle);
    if (L.traceable(trace)) return { text: x.text, trace, it: x.it };
  }
  return null;
}

/** "Strictly week one viewing figures revealed as fans divided over new hosts" -> "Strictly Come Dancing fans divided over new hosts". */
function reportStoryText(text, P) {
  if (!REPORT.test(text)) return text;
  const m = text.match(/\s+as\s+(.+)$/i);
  if (!m || !(F.CONFLICT.test(m[1]) || /\bdivid|split/i.test(m[1]))) return text;
  const rest = m[1].replace(/^(?:the\s+)?/i, '');
  const who = P.E ? T.surfaceOf(P.E, P.field) : '';
  return who && /^(fans|viewers|critics|people)\b/i.test(rest) ? `${who} ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1);
}

// ---------- the moment line ----------
/**
 * The show or host most of the moment's coverage names, when the line lacks it: "mid-interview" -> "mid-interview on Piers Morgan
 * Uncensored" (the show's own name when a title gives it, else "with Piers Morgan").
 */
function withVenue(text, P) {
  const rows = SW.firstCopies([...(P.hookRows || []), ...P.momItems]);
  if (rows.length < 3) return text;
  const counts = new Map();
  let show = null;
  for (const it of rows) {
    const t = W.curlQuotes(it.title);
    const m = t.match(/\b(?:[Oo]n|[Dd]uring|[Ii]n|[Ww]ith)\s+(?:an?\s+)?(?:[Ii]nterview [Ww]ith\s+)?((?:\p{Lu}[\p{L}’'-]+\s+){0,2}\p{Lu}[\p{L}’'-]+?)(?:['’]s)?\s+([Ii]nterview|[Ss]how|[Aa]ppearance|[Uu]ncensored|[Pp]odcast)\b/u);
    if (m) {
      const name = m[1].replace(/['’]s$/, '');
      counts.set(name, (counts.get(name) || new Set()).add(it.src));
      if (/uncensored|tonight/i.test(m[2])) show = `${name} ${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()}`;
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].size - a[1].size)[0];
  if (P.dbg) P.dbg(`      venue ${top ? `${top[0]}:${top[1].size}/${rows.length}` : '-'} show=${show}`);
  if (!top || top[1].size < Math.max(3, 0.25 * rows.length) || contains(norm(text), norm(top[0])) || (P.E && contains(norm(top[0]), P.E))) return text;
  const where = show ? `on ${show}` : `with ${top[0]}`;
  const paren = text.match(/^(.*?)(\s+\([^)]*\))?$/);
  const body = paren[1];
  const tail = paren[2] || '';
  const withIt = /\binterview\b/i.test(body) ? body.replace(/\b(mid-)?interview\b/i, (m) => `${m} ${where}`) : `${body} ${where}`;
  return `${withIt}${tail}`;
}

/**
 * A reported claim keeps its hedge in the moment line: when an established outlet among the moment's coverage says "reportedly"
 * ("Major Social Media Platforms Reportedly Rejected Ads for Musk"), "Platforms reject Musk doc ads" becomes "Platforms reportedly
 * reject Musk doc ads".
 */
function hedgedClaim(text, P) {
  if (/\b(reportedly|allegedly|report|says|claims?)\b/i.test(text)) return text;
  const st = F.contentStems(text, P.skip);
  const rows = uniqByKey([...(P.hookRows || []), ...P.momItems, ...P.field]).filter((it) => /\breportedly\b/i.test(it.title) && F.MAJOR.test(it.outlet || '') &&
    st.filter((s) => it.textStems.has(s) || [...it.textStems].some((x) => x.startsWith(s.slice(0, 5)))).length >= 2);
  return rows.length ? SW.withHedge(text, 'x reportedly x') : text;
}

module.exports = {
  REPORT, workStory, articleLine, backlashLine, coMentionStory, momentTerms, linkedToMoment, momentContextStory, topicStory, originViral, reportMoment,
  reportStoryText, withVenue, hedgedClaim,
};
