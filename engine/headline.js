'use strict';
/*
 * Step 7 of the Ideas pipeline: pick one headline per story. Every member title is rewritten (wording.js), scored, and the
 * best one that names a subject wins; a story with no nameable subject gets no headline and is dropped.
 * On the phone the rewrite step can hand the winning title and its cluster to the on-device Foundation Models instead.
 */
const W = require('./wording');
const R = require('./rules');
const { sum, stripParen, contains, uniqByKey } = require('./util');

const { words, STOP, GENERIC } = W;
const { HEARSAY } = require('./story-focus');
const SW = require('./story-why');
const { RE } = R;
const HEADLINE_PREF = { bluesky: 1.0, kym: 0.6, celeb: 0.5, gnews: 0.3, trends: 0.2, reddit: -0.3 };

/** A headline must name who or what: a cluster name, a quoted phrase, a role noun, or a proper noun. */
function hasSubject(text, c, lex) {
  const hw = words(text).join(' ');
  if ([...c.entSet].some((e) => contains(hw, e)) || [...c.pentSet].some((p) => contains(hw, p.slice(2)))) return true;
  if ([...text.matchAll(R.QUOTE_RE)].length) return true;
  // after un-Title-Casing, a capital inside the headline is a name; the first word counts only if it is not a plain word
  const ws = text.split(/\s+/);
  const nameLike = (w) => { const k = words(w).join(' '); return k.length >= 3 && !R.isPlaceOrTeam(k) && !STOP.has(k) && !GENERIC.has(k); };
  const known = (k) => lex.names.has(k) || lex.firstNames.has(k);
  const midIsName = (w) => { const k = words(w).join(' '); return nameLike(w) && (!W.inDict(k) || known(k)); };
  const firstIsName = (w) => { const k = words(w).join(' '); return nameLike(w) && !W.inDict(k) && (known(k) || lex.proper.has(k) || W.isProperWord(k)); };
  return ws.some((w, i) => (i > 0 ? W.isCapWord(w) && midIsName(w) : firstIsName(w)));
}

// The follow-up, not the moment: "defends husband", "responds to its viral moment", "react to Verity meme".
const AFTERMATH = /\b(responds?|defends?|reacts?|react|addresses|speaks out|breaks silence|squashes|clarifies|confirms)\b/i;
const AFTERMATH_PENALTY = 2;
const HEARSAY_PENALTY = 6;
// ... and names the moment only as "its viral moment" / "viral video": the reader never learns what happened
const VAGUE_AFTERMATH = /\b(responds?|reacts?|speaks out|breaks (his |her |their )?silence|addresses|defends?|apologi[sz]es|clarifies)\b( (to|on|after|following|over|about|amid))? (the |a |an |its |his |her |their )?viral (video|clip|moment|post|photo)s?\b/i;
const VAGUE_AFTERMATH_PENALTY = 2;
// filler predicate: "... has Giants fans talking"
const FANS_TALKING = /\bha(s|ve) (\w+ ){0,2}(fans|people|internet|everyone|viewers) (talking|buzzing|divided|in stitches|obsessed)\b/i;
const FANS_TALKING_PENALTY = 1.5;
// "as the actor portrays him": a role noun standing in for a name the story has
const BARE_ROLE = /\b(actor|actress|singer|star|rapper|picture|photo)\b/i;
const BARE_ROLE_PENALTY = 2.5;
// "A truck driver went viral on TikTok": the only predicate is "went viral", so it says nothing
const ONLY_VIRAL = /^(an? |the )?[\w’'-]+( [\w’'-]+){0,2} (goes|went|is going) viral( on \w+)?$/i;
const ONLY_VIRAL_PENALTY = 4;
// a cut that ends on a word that needs another after it
const DANGLING_END = /\b(this|that|these|those|the|a|an|of|to|for|with|about|from|into|and|or|his|her|their|its|my|your|our)$/i;
const DANGLING_END_PENALTY = 3;
// a political line when the story has another ("Plonker announces 'Free Palestine' tour" for the SNL UK roast of Tavix Ostiss)
const POLITICAL_PENALTY = 1.5;

// a clash people take sides on is what spreads ("calls her out", "ghosted her"); a contest framing is one outlet's spin ("showdown")
const CLASH = /\b(calls? (?:out|her out|him out|them out)|called (?:out|her out|him out)|ghost(?:ed|s|ing)|snub(?:s|bed)?|feud\w*|claps? back|throws? shade|disses|roasts?|roasted|awkward)\b/i;
const CLASH_BONUS = 1.2;
const CONTEST_FRAME = /\b(showdown|face-?off|battle of)\b/i;
const CONTEST_PENALTY = 1.5;
// a curiosity gap or tabloid shout: the reader never learns what happened ("fans beg BBC to fix glaring mistake")
const BAIT = /\b(begs?|begging|glaring|what happens next|floor(?:s|ed)|with a twist|feels? sick|have demands|yet another|goes crazy|a-lister|you won['’]t believe|(?:this|these) (?:to|at|in|on|for|during|while)|this (?:one )?(?:thing|detail|item|drink|habit))\b|\bexposed\s*$/i;
const BAIT_PENALTY = 4;
// a preview is not the moment ("Zorrr Set to Perform at VMAs for First Time Since ...")
const PREVIEW = /\b(set to|is to perform|to perform at|will (?:perform|attend|host|appear)|ahead of (?:the|her|his|their)|how to watch|what time)\b/i;
const PREVIEW_PENALTY = 3;
// a name glossed with the one people use ("Bexane Tamurn, globetrotting wrestler known as Swivdot, dies at 40"): another title names
// them the way fans do ("AEW star Swivdot dead at 40")
const NAME_GLOSS = /,\s+(?:[\w’'-]+\s+){0,6}(?:(?:also|better)\s+)?known as\b|\baka\b/i;
const NAME_GLOSS_PENALTY = 3;

const saysWhatHappened = (t) => RE.moment.test(t) || RE.viral.test(t) || RE.reaction.test(t) || /\b(becomes a meme|meme|trend)\b/i.test(t);

function scoreHeadline(h, it, c) {
  const ws = h.text.split(/\s+/);
  const hw = words(h.text).join(' ');
  let s = ws.length >= 4 && ws.length <= 10 ? 3 : ws.length <= W.MAX_WORDS ? 2 : -Math.abs(ws.length - 8);
  if (c.topEnt && contains(hw, c.topEnt)) s += 2;
  s += 0.8 * c.mainEnts.filter((e) => contains(hw, e)).length; // names both sides of the story
  if ([...c.entSet].some((e) => (hw + ' ').startsWith(e + ' '))) s += 1; // who first
  if (W.verbIndex(ws) >= 0 || W.VERB_RE.test(h.text)) s += 1.5;
  if (saysWhatHappened(h.text)) s += 1.2;
  if (c.hooks.some((t) => W.stems(h.text).has(t))) s += 2;
  if (h.lostHook) s -= 1.5;
  if (RE.told.test(h.text) && !RE.moment.test(h.text) && !RE.viral.test(h.text)) s -= 1.5; // an account, not the moment
  s += it.viral || it.inherent ? 1.5 : it.moment ? 1 : it.reaction ? 0.5 : 0; // the item that proves it went viral
  if (RE.question.test(h.text) || /\?$/.test(h.text)) s -= 3;
  if (W.quoteImbalance(h.text)) s -= 1.5;
  if (h.cut) s -= 0.5;
  if (/\b(needs|think|thinks|wants|says|is|are|was|has|have)$/i.test(h.text)) s -= 2; // stops before its object
  if (DANGLING_END.test(h.text)) s -= DANGLING_END_PENALTY; // cut mid-phrase: "... Gen Zers bringing this"
  if (!h.named) s -= 4;
  if (BARE_ROLE.test(h.text) && c.mainEnts.some((e) => !contains(hw, e))) s -= BARE_ROLE_PENALTY;
  if (ONLY_VIRAL.test(h.text)) s -= ONLY_VIRAL_PENALTY;
  if (VAGUE_AFTERMATH.test(h.text)) s -= VAGUE_AFTERMATH_PENALTY;
  if (FANS_TALKING.test(h.text)) s -= FANS_TALKING_PENALTY;
  if (CLASH.test(h.text)) s += CLASH_BONUS;
  if (CONTEST_FRAME.test(h.text)) s -= CONTEST_PENALTY;
  if (BAIT.test(h.text) || BAIT.test(it.title)) s -= BAIT_PENALTY;
  if (PREVIEW.test(it.title)) s -= PREVIEW_PENALTY;
  if (NAME_GLOSS.test(h.text) || NAME_GLOSS.test(it.title)) s -= NAME_GLOSS_PENALTY;
  if ((RE.politics.test(h.text) || RE.politicsCase.test(h.text)) && !RE.politicalMoment.test(h.text)) s -= POLITICAL_PENALTY;
  s += 0.2 * Math.min(4, ws.slice(1).filter(W.isCapWord).length);
  return s + (HEADLINE_PREF[it.fam] || 0) + it.w * 0.2;
}

/** Summed Jaccard overlap with the other members: the title that best represents the story, not a side note. */
function centrality(it, c) {
  const own = new Set([...it.toks, ...it.ents.filter((e) => e !== c.topEnt), ...it.pents]);
  return sum(c.items.filter((o) => o !== it && o.key !== it.key).map((o) => {
    const other = new Set([...o.toks, ...o.ents.filter((e) => e !== c.topEnt), ...o.pents]);
    const shared = [...own].filter((x) => other.has(x)).length;
    return shared / (own.size + other.size - shared || 1);
  }));
}

/** Bluesky's display names are already short human headlines; add the example from the description when unnamed. */
function blueskyHeadline(it) {
  const eg = (it.desc || '').match(/\blike ([A-Z][^.,;]{2,30})\.?$/);
  return eg && !/[‘'"“]/.test(it.title) ? `${it.title} (‘${eg[1]}’)` : it.title;
}

/**
 * KYM entry titles are meme names ("Fenette Zellissander / Fenette Zelliss"), Bluesky's are headlines; everything else is rewritten.
 * A KYM title that only names the meme ("Who Is 'Barf Simmons'?") takes its definition from the entry's description instead.
 */
function candidateFor(it, c, lex) {
  if (it.src === 'kym-memes') {
    const name = stripParen(it.title.split(' / ')[0]);
    return { text: W.kymHeadline(name, it.kymDesc) || `The ‘${name}’ meme`, cut: false, named: true };
  }
  if (it.fam === 'bluesky') return { text: blueskyHeadline(it), cut: false, named: true };
  const h = W.rewrite(it.title, c.topEnt, lex, c.hooks);
  if (h.explainer && it.src === 'kym-news') {
    const name = (h.text.match(/‘([^’]+)’/) || [])[1];
    const defined = W.kymHeadline(name, it.kymDesc);
    if (defined) return { text: defined, cut: false, named: true };
  }
  // (a headline never states what its title only reported: a hedge the cut lost goes back in, "Report: Plonzo paid ..." -> "Plonzo
  // reportedly paid ..."; and a statement its title only asks is no headline for the name it is asked about)
  const text = h.explainer ? h.text : SW.withHedge(h.text, it.title);
  return { ...h, text, named: !h.question && hasSubject(text, c, lex) };
}

function headlineCandidates(c, lex) {
  const cands = uniqByKey(c.items).map((it) => {
    const h = candidateFor(it, c, lex);
    // (unnamed experts' guess about real people loses its attribution in a headline: any other title first)
    const hearsay = HEARSAY.test(W.curlQuotes(it.title)) ? HEARSAY_PENALTY : 0;
    return { text: h.text, named: h.named, it, s: scoreHeadline(h, it, c) + 0.5 * Math.min(3, centrality(it, c)) - hearsay };
  });
  // the user wants the moment itself ("slaps"), not the follow-up, whenever some other named title has the moment
  const momentShown = (x) => x.named && !AFTERMATH.test(x.text) && (RE.moment.test(x.text) || RE.viral.test(x.text));
  return cands.map((x) => (AFTERMATH.test(x.text) && cands.some((o) => o !== x && momentShown(o)) ? { ...x, s: x.s - AFTERMATH_PENALTY } : x))
    .sort((a, b) => b.s - a.s);
}

// names and nothing that happened: "CAELANE and Lysory Marrmott" (from r/OutOfTheLoop's "So what's up with CAELANE and Lysory Marrmott?")
const saysNothing = (t) => W.verbIndex(t.split(/\s+/)) < 0 && !W.VERB_RE.test(t) && !saysWhatHappened(t) &&
  !/\b(controvers\w*|debate|drama|feud|challenge)\b/i.test(t);

/**
 * Best rewrite with a named subject; else a cleaned source title that names one; else null (the story is dropped). A story only
 * Reddit carries needs a headline that says what happened: its posts are often bare questions or captions.
 */
function headlineFor(c, lex) {
  const cands = headlineCandidates(c, lex);
  // a Reddit post asking "What is going on with X?" names who, not what happened; a quoted caption ("“my coffee tasted like
  // coffee”") or a picture with no one in it ("Great demonstration of Tyndall effect") names no one; a raw caption cut short says less
  const redditOnly = c.items.every((i) => i.fam === 'reddit');
  const bare = (t) => t.replace(/^[\s“"‘']+/, '');
  const asked = (it) => RE.question.test(bare(it.title)) || RE.explainer.test(bare(it.title)) || /^(?:so )?what(?:['’]s| is) going on with\b/i.test(bare(it.title));
  const ok = (x) => !(redditOnly && (!(c.topEnt || c.topPseudo) || /^[“"‘']/.test(x.text) || saysNothing(x.text) ||
    (asked(x.it) && !saysWhatHappened(x.text))));
  const named = cands.find((x) => x.named && ok(x));
  if (named) return named.text;
  if (redditOnly) return null;
  for (const x of cands) {
    const fb = W.fallbackHeadline(x.it.title, lex);
    if (hasSubject(fb, c, lex)) return fb;
  }
  return null;
}

module.exports = { headlineFor, headlineCandidates, hasSubject, VAGUE_AFTERMATH };
