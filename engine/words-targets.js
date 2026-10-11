'use strict';
/*
 * "Words & trends", step 3 (live refresh only): which entries need a lookup, strongest first, within each lookup's budget.
 *   Wikimedia   a page named exactly like the term (summary + daily views) and a coinage's Wiktionary sense
 *   origin      one open-ended Google News search per entry that can show, plus up to 12 re-dating suspects (one outlet's explainers only)
 *   KYM page    the entry page of a term no source defines, or of a Know Your Meme pick dated only by the day it was seen: 7 exact
 *               entry URLs (a feed item's link, the weekly roundup's link, an entry title Google News indexed) and 3 guessed ones a day
 *   KYM roundup Know Your Meme's weekly roundup editorial, read once: every pick's name and exact entry page
 * Plain string/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const X = require('./words-extract');
const { termKey } = require('./words-keys');
const { wikiMeaning } = require('./words-answers');
const { scoreGroup, kindOfGroup, passesFloor, explained, safeTerm } = require('./words');

const DAY = 86400000;
const LOOKUP_MAX = 60; // Wikimedia lookups per refresh: the strongest candidates only (answers are kept for a week)
const SINCE_MAX = 30; // open-ended news searches per refresh (answers are kept for a month)
const SUSPECT_MAX = 12; // extra origin searches per refresh for terms whose only coverage is one outlet's explainers
const KYM_PAGE_MAX = 10; // Know Your Meme entry pages per UTC day: KYM_KNOWN_MAX for exact entry URLs, the rest for guessed ones
const KYM_KNOWN_MAX = 7;
const KYM_GUESS_MAX = 3;
const KYM_SLUGS_PER_TERM = 2;
const ROUNDUP_MAX = 2; // Know Your Meme weekly roundup pages per refresh (each read once)
const SUMMARY_TTL = 7 * DAY;
const WIKT_TTL = 7 * DAY;
const VIEWS_TTL = 20 * 3600000;
const SINCE_TTL = 30 * DAY;
const KYM_TTL = 30 * DAY;
const { kymSlug, roundupSlug } = X;

/** Step 3 (live refresh only): which candidates need a Wikimedia answer, strongest first. */
function lookupTargets(groups, lookups, now) {
  const pre = groups.map((g) => ({ g, s: scoreGroup(g, null, now).score })).sort((a, b) => b.s - a.s).slice(0, LOOKUP_MAX);
  const out = [];
  pre.forEach(({ g }) => {
    // the strongest surface without its kind word: "Chile Memes" is looked up as "Chile"
    const best = [...g.surfaces.entries()].sort((a, b) => b[1].w - a[1].w || a[0].length - b[0].length)[0][0];
    const term = best.replace(/\s+(trends?|memes?|challenges?|audio|sound|song)$/i, '');
    const nWords = term.split(' ').length;
    const l = lookups.get(g.key) || {};
    const kind = kindOfGroup(g, null);
    // the Wikipedia batch brings the summary and the daily views together; views go stale within a day
    const wantWiki = nWords <= 3 && (!l.summaryAt || now - l.summaryAt > SUMMARY_TTL ||
      (l.summary && l.summary.accepted && (!l.viewsAt || now - l.viewsAt > VIEWS_TTL)));
    const coinage = nWords > 1 || X.isCoinage(W.words(term)[0] || '');
    const goodDef = g.defs.some((d) => d.quality >= 4) || !!wikiMeaning(l);
    const wantWikt = kind !== 'trend' && nWords <= 3 && coinage && term.length > 1 && !goodDef && (!l.wiktAt || now - l.wiktAt > WIKT_TTL);
    if (wantWiki || wantWikt) out.push({ key: g.key, term, wantWiki, wantWikt });
  });
  return out;
}

/** An entry whose only rows in the window are one outlet's explainers: it may be an old article Google News re-dated. */
function oneOutletExplainers(g) {
  const rows = g.ev.filter((e) => e.rowKey);
  return rows.length > 0 && new Set(rows.map((e) => e.key)).size === 1 && rows.every((e) => e.role === 'asked' || e.role === 'explainer');
}
/**
 * Step 3a (live refresh only): when did it begin, for the 30 strongest terms that can show (listed, bubbling, then any other with a
 * meaning or a Know Your Meme pick), plus up to 12 re-dating suspects (one outlet's explainers only, which the moments list may also
 * carry): one open-ended news search each, under the name as shown ("Chile memes", not "Chile").
 */
function sinceTargets({ listed, bubblingRows, candidates, all }, lookups, now) {
  // due when never asked, a month old, or asked under another name than the one shown now ("Chile" before it read "Chile memes")
  const asked = (l) => ((l.since && l.since.term) || '').toLowerCase();
  const due = (r) => { const l = lookups.get(r.g.key); return !(l && l.sinceAt && now - l.sinceAt < SINCE_TTL && asked(l) === r.term.replace(/…$/, '').toLowerCase()); };
  const main = [...new Set([...listed, ...bubblingRows, ...candidates.filter((r) => r.meaning || r.hasKym)])].slice(0, SINCE_MAX);
  const suspects = (all || []).filter((r) => !main.includes(r) && oneOutletExplainers(r.g) && safeTerm(r.term)).sort((a, b) => b.score - a.score)
    .slice(0, SUSPECT_MAX);
  return [...main, ...suspects].filter(due).map((r) => ({ key: r.g.key, term: r.term.replace(/…$/, '') }));
}

const KYM_OUTLET = /^(?:know ?your ?meme\b|(?:trending\.)?knowyourmeme\.com$)/i;
/**
 * Entry pages to try for a term. known: slugs a source links to (a KYM feed item's URL, the weekly roundup's link) or the title of a
 * KYM entry page Google News indexed under one of the entry's names ("Parent Split-Face / Family Resemblance Trend"). guesses: a
 * KYM entry name the origin search found ("Wawario and Wawaluigi"), both names of a one-subject question ("Who Are 'Wawario' And
 * 'Wawaluigi'?" -> wawario-and-wawaluigi), then its names with and without the kind word.
 */
function kymSlugs(g, term, lookup = null) {
  const known = [...g.kymSlugs];
  const keys = new Set([...g.surfaces.keys(), ...g.secondary].map(termKey));
  for (const it of g.items) {
    const m = (it.url || '').match(/knowyourmeme\.com\/memes\/([a-z0-9-]+)\/?(?:$|[?#])/);
    if (m) known.push(m[1]);
    const kymPage = it.fam === 'kym' || KYM_OUTLET.test(it.outlet || '');
    if (kymPage && it.src !== 'kym-news' && !/[?|]/.test(it.title) && !X.RX_ROUNDUP.test(it.title) && X.kymNames(it.title).some((n) => keys.has(termKey(n)))) {
      known.push(kymSlug(it.title));
    }
  }
  const guesses = [...((lookup && lookup.since && lookup.since.kymTitles) || []).map(kymSlug)];
  // the newsroom links a video or photo page named like the entry: /videos/440611-barf-simmons-barf-symptons
  for (const it of g.items) { const m = (it.url || '').match(/knowyourmeme\.com\/(?:videos|photos)\/\d+-([a-z0-9-]+)/); if (m) guesses.push(m[1]); }
  for (const it of g.items) {
    const pair = W.curlQuotes(it.title).match(/^(?:who|what)\b[^‘“"]*[‘“"]([^’”"?]{2,40})[’”"?]*\s+and\s+[‘“"]([^’”"?]{2,40})/i);
    if (pair) guesses.push(kymSlug(`${pair[1]} and ${pair[2]}`));
  }
  const names = [term, ...[...g.surfaces.entries()].sort((a, b) => b[1].w - a[1].w).map(([s]) => s)];
  if (g.withKind) guesses.push(kymSlug(g.withKind)); // the name with its kind: gg-ez-song
  for (const n of names) guesses.push(kymSlug(n), kymSlug(n.replace(new RegExp(`\\s+(${X.KIND_ANY})$`, 'i'), '')));
  const k = [...new Set(known.filter((x) => x.length >= 2))];
  return { known: k, guesses: [...new Set(guesses.filter((x) => x.length >= 2 && !k.includes(x)))] };
}
/**
 * Step 3b (live refresh only): terms that could show but have no usable meaning get their Know Your Meme entry page, each term's
 * answer kept for a month: up to KYM_KNOWN_MAX exact entry pages and KYM_GUESS_MAX guessed ones a UTC day, strongest terms first.
 * rows: finish()'s candidates, strongest first. Returns { known, guess: requests left today, targets: [{ key, term, slugs: [{ slug,
 * known }] }] }; the fetcher stops trying guesses when their budget is spent.
 */
function kymPageTargets(rows, lookups, now) {
  const today = Math.floor(now / DAY) * DAY;
  const todays = [...lookups.values()].filter((l) => l.kymAt >= today);
  const usedGuess = todays.reduce((n, l) => n + (l.kymGuessN || 0), 0);
  const usedKnown = todays.reduce((n, l) => n + Math.max(0, (l.kymN || 0) - (l.kymGuessN || 0)), 0);
  const known = Math.max(0, Math.min(KYM_KNOWN_MAX - usedKnown, KYM_PAGE_MAX - usedKnown - usedGuess));
  const guess = Math.max(0, Math.min(KYM_GUESS_MAX - usedGuess, KYM_PAGE_MAX - usedKnown - usedGuess));
  // no usable meaning yet; or listed on Know Your Meme's word alone with no date but the day it was seen (its entry page says when
  // it began: "Barf Simmons" was started in July)
  const undated = (r) => r.meaning && passesFloor(r) && r.sourceCount === 1 && r.hasKym && !Number.isFinite(r.originHint.t);
  const wanted = rows.filter((r) => (!r.meaning && (passesFloor(r) || r.hasKym || explained(r) || r.sourceCount >= 2)) || undated(r));
  const targets = wanted.filter((r) => { const l = lookups.get(r.g.key); return !(l && l.kymAt && now - l.kymAt < KYM_TTL); })
    .map((r) => {
      const sl = kymSlugs(r.g, r.term, lookups.get(r.g.key));
      // a guess is spent only on a name Know Your Meme could file: not a plain word or a number ("chic", "67")
      const plainWord = r.term.split(' ').length === 1 && (/^\d+$/.test(r.term) || !X.isCoinage(W.words(r.term)[0] || ''));
      const slugs = [...sl.known.map((slug) => ({ slug, known: true })), ...(plainWord ? [] : sl.guesses).map((slug) => ({ slug, known: false }))]
        .slice(0, KYM_SLUGS_PER_TERM);
      return { key: r.g.key, term: r.term, slugs };
    }).filter((t) => t.slugs.length);
  return { known, guess, targets };
}

/** Step 3c (live refresh only): Know Your Meme weekly roundup pages not read yet, newest first: [{ key, slug }]. */
function roundupTargets(items, lookups) {
  const slugs = [...new Set(items.filter((it) => X.RX_ROUNDUP.test(it.title.replace(/\s+-\s+[^-]+$/, ''))).sort((a, b) => b.t - a.t)
    .map((it) => roundupSlug(it.title)).filter(Boolean))];
  return slugs.filter((slug) => !lookups.has(`roundup-${slug}`)).slice(0, ROUNDUP_MAX).map((slug) => ({ key: `roundup-${slug}`, slug }));
}
/** The roundup pages read so far: Map(slug -> { entries: [{ name, slug }] }). */
function roundupPages(lookups) {
  const out = new Map();
  for (const [k, l] of lookups) if (k.startsWith('roundup-') && l.roundup) out.set(k.slice('roundup-'.length), l.roundup);
  return out;
}

module.exports = { lookupTargets, sinceTargets, kymPageTargets, roundupTargets, roundupPages };
