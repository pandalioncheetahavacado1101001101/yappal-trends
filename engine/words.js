'use strict';
/*
 * "Words & trends", steps 2-4: merge what words-extract.js finds into one entry per viral word, catchphrase, sound or craze,
 * pick its plainest sourced meaning (never written from scratch), measure cross-source heat and freshness, and rank.
 *   merge    variants share a key: stemmed words, kind words dropped, joined ("mog"/"mogging"/"mogged", "big back"/"bigbacked",
 *            "6-7"/"67"); an explainer's second name, a KYM entry's aliases and "also called 'X'" join the first; two craze names
 *            first seen within a week that share a rare word in titles about the same thing join too ("salt stepping" /
 *            "Epsom salt foot stomping")
 *   meaning  Know Your Meme definition (feed or entry page) > an outlet's own summary line or a title that defines it > Wikipedia
 *            (a slang/meme page of exactly that name) > Wiktionary (coinages only) > a title's noun phrase. Below quality 3, or a
 *            line that is only another name ("‘Family Guy’ trend and memes"), is no meaning: the entry waits in "bubbling"
 *   heat     independent sources (each outlet once, a syndicated title once, KYM, Reddit, Bluesky, a Trends search, Wikipedia
 *            daily views), softened by the days since it was last seen
 *   origin   when the term began: the earliest start date its KYM/Wikipedia/summary text gives ("went viral in late 2025") and an
 *            open-ended news search. Older than 45 days = established: discounted unless hot, shown as "back" or "still big"
 *   floor    the main list needs two independent sources, a KYM pick or a search spike; single-source entries wait in "bubbling"
 * Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const X = require('./words-extract');
const R = require('./rules');
const { TOKEN_IDF_MIN } = require('./cluster');
const { termStem, termSeq, termKey, hasSeq } = require('./words-keys');
const { CONTEXT_FOR_PLAIN_WORD, parseWikiBatch, parseWikt, okSummary, wikiMeaning, wiktMeaning, kymPageMeanings, wikiEvidence, wikiDirection,
  sinceOf } = require('./words-answers');

const { RE } = R;
const DAY = 86400000;
const WORDS_MAX = 30;
const BUBBLING_MAX = 10;
const WORDS_MIN_SCORE = 0.8;
const FRESH_HALF_LIFE_DAYS = 4;
const NEW_DAYS = 7;
const NEW_BONUS = 1.15;
const ESTABLISHED_DAYS = 45; // a term that began longer ago than this is not new, however fresh its coverage
const STALE_DAYS = 21; // a term older than this that one source names this fortnight is not current
const EVERGREEN_MULT = 0.6;
const DICTIONARY_ONLY_MULT = 0.5; // "added to Merriam-Webster" proves a word is real, not that it is having a moment
const HEAT_HOT = 6;
const HEAT_WARM = 3;
const SEARCH_SPIKE_VOLUME = 20000;
const PERSON_ROW_MULT = 0.3; // a term in the related queries of a person's trend ("clavicular" -> "looksmaxxing") is their news
const MEANING_MIN_QUALITY = 3;
const MEANING_USE_MAX_WORDS = 22; // "meaning — use" for a sound, phrase or craze: one line, not two
const WINDOW_DAYS = 14;
const FRESH_DAYS = 7; // an established term lists only while 3+ sources wrote about it this week
const FRESH_MIN = 3;
const FRESH_MIN_OLDER = 2; // a term that began before this fortnight, not yet established, needs two sources this week
const REDATED_DAYS = 60; // an explainer whose term headlines go back further than this, alone in the window, was re-dated
const REDATED_MULT = 0.2;
const SINCE_MENTION_W = 0.8; // an outlet the term-exact search found naming it this fortnight
const HN_W = 0.6;
const DISPLAY_MAX_WORDS = 8; // a caption-length name shows its alias or its first words
const TITLE_CASE_PENALTY = 0.6; // a Title Case headline's noun phrase loses to a sentence-case summary or KYM line of the same rank

// evidence weight per role; each independent source counts once, at its strongest
const ROLE_W = { 'kym-entry': 2.0, 'kym-explainer': 2.0, 'kym-roundup': 1.8, 'kym-sub': 1.2, asked: 1.8, explainer: 1.5, mention: 1.0,
  roundup: 0.7, dictionary: 0.5, column: 0.3 };
const SURFACE_W = { 'kym-entry': 3, 'kym-explainer': 2.5, 'kym-sub': 2.5, 'kym-roundup': 2.5, asked: 2, explainer: 2, mention: 1, roundup: 1,
  dictionary: 1, column: 1, search: 0.5 };
// Know Your Meme's own picks list without a second source: an entry, a submission, an explainer it wrote, its weekly roundup
// (not a submission: the new-submissions feed lists every entry anyone starts, so it needs a second source)
const KYM_OWN_ROLES = new Set(['kym-entry', 'kym-explainer', 'kym-roundup']);
// coverage that proves a word is known, not that it is having a moment
const LIST_ROLES = new Set(['roundup', 'dictionary', 'column']);
const DEF_FROM_W = { 'Know Your Meme': 0.3, Wikipedia: 0.2, Wiktionary: 0.1 };

// what never becomes a word to film: the prepared item's drop reasons that are about safety, and hazards inside "trends"
// ('evergreen': "10 Years Ago, The 'Nestle Crunch' Meme Began" is an anniversary, not a word of the moment)
const SAFETY_DROPS = new Set(['spam', 'publisher', 'crypto', 'unsafe', 'violence', 'tragedy', 'crime', 'politics', 'hard-news', 'evergreen']);
// Google News also indexes social posts; a Facebook or YouTube post is not an outlet explaining anything
const SOCIAL_OUTLET = /^(facebook|youtube|instagram|tiktok|x|twitter|threads|pinterest|linkedin|reddit\.com|m\.facebook)(\.com)?$/i;
// a brand's content-marketing blog explains trends to sell something; it is not coverage
const BRAND_OUTLET = /\b(verizon|sprout ?social|perfect ?corp|exploding ?topics|all ?about ?cookies|cmmonline)\b/i;
const HAZARD = /\b(crash(?:es|ed)?|accidents?|dangerous|hazard\w*|poison\w*|toxic|burns?|burned|burning|sunburn\w*|chok\w*|injur\w*|hospital\w*|surgery|surgical|overdos\w*|drugs?|drugged|inhal\w*|chroming|blood|hiv|door[- ]?kick\w*|arrest\w*|charged|police|threat\w*|abort\w*|self-harm|eating disorders?|kratom|vap(e|es|ing)|nicotine|laughing gas|nitrous|scam\w*|fraud|lawsuit|sued|died|dies|death|dead(?! internet))\b/i;
const SENSITIVE_TERM = /bomb|killer|murder|terror|\b(goon\w*|bluetoothing|chroming|nigg\w*|fag\w*|retard\w*|tranny|kike|spic|chink|resistard|incel\w*|porn\w*|nsfw|onlyfans|nude\w*|sex\w*|penis|abuse\w*|kkk|lynch\w*|nazi\w*|suicid\w*|kill\w*)\b/i;
// "One Warning From the Future" is a meme title, not a safety warning: the generic warning words alone do not drop an item
const WARN_WORDS = /\bwarn(?:s|ed|ing)?\b|\bwarnings?\b/gi;
// long-established slang: still searched, rarely news. Discounted, not dropped (a real comeback still ranks). The origin check
// below finds most of these on its own; this list covers terms whose sources give no start date.
const EVERGREEN = ['w', 'l', 'rizz', 'gyatt', 'skibidi', 'sigma', 'slay', 'bussin', 'no cap', 'cap', 'sus', 'based', 'ratio', 'ick', 'delulu',
  'mid', 'goat', 'goated', 'bet', 'periodt', 'yeet', 'simp', 'stan', 'lit', 'kekw', 'pog', 'poggers', 'copium', 'rickroll', 'fanum tax', 'ohio',
  'npc', 'touch grass', 'main character', 'understood the assignment', 'love bomb', 'trash panda', 'vibe', 'lowkey', 'highkey', 'unc',
  '67', '6-7', 'mog', 'mogging', 'mewing', 'looksmaxxing', 'sleepmaxxing', 'skill issue', 'absolute cinema', 'fambushing', 'scuba',
  'google giggles', 'beckham test'];
// a Trends row about something else that shares a word: a match, a film, a TV series
const OFF_TOPIC_QUERY = /\bvs\.?\b|\bv\b|\(film\)|\(tv series\)/i;
// a one-word term counts in a Trends query only when the query asks about it as a word or a meme ("verity meme", "mogging meaning")
const SEARCH_CUE = /\b(mean|meaning|slang|memes?|trend|tiktok|song|dance|challenge)\b/i;
// two names of one craze share the kind of thing they are about
const CRAZE_CUE = /\b(sleep|bedtime|shower|skin|skincare|hair|nails?|food|makeup|workout)\b/gi;
const CRAZE_JOIN_DAYS = 10; // grazia's "salt stepping" (9-26) and Woman's World's "Epsom salt foot stomping" (9-17) are 9 days apart

const EVERGREEN_KEYS = new Set(EVERGREEN.map(termKey));

// ---------- item safety ----------
/** An item dropped as unsafe only for "warning"-type words, with nothing else unsafe in it ("Polar Bear 2026 Meme ... One Warning From the Future"). */
function onlyWarned(it) {
  const text = it.desc ? `${it.title} ${it.desc}` : it.title;
  const safety = it.kymDesc ? `${text} ${it.kymDesc}` : text;
  return !RE.unsafe.test(safety.replace(WARN_WORDS, ' ')) && !RE.menace.test(it.title) && !RE.violent.test(safety) && !RE.tragedy.test(safety) &&
    !RE.evergreen.test(it.title) && !RE.hardNews.test(text) && !RE.legal.test(it.title) && !it.political;
}
const nonOutlet = (it) => SOCIAL_OUTLET.test(it.outlet || '') || BRAND_OUTLET.test(it.outlet || '');
function safeForWords(it) {
  if (it.drop === 'unsafe' ? !onlyWarned(it) : it.drop && SAFETY_DROPS.has(it.drop)) return false;
  if (nonOutlet(it)) return false;
  return !X.PROFANE.test(it.title);
}
/**
 * No content filter (the owner's rule): a term a tragedy, an arrest, a hazard or a menace is about still lists when it is popular,
 * flagged `sensitive` ("Cat in the Hat" trend: AI-made threats, school warnings, teen arrests).
 */
function sensitiveItem(it) {
  const text = `${it.title} ${it.kymDesc || ''} ${it.dek || ''} ${it.desc || ''}`;
  return !!it.sensitive || HAZARD.test(text) || RE.menace.test(it.title) || RE.tragedy.test(it.title) || RE.unsafe.test(it.title.replace(WARN_WORDS, ' '));
}
// a controversy or a feud is a moment (listed with the moments), not a word
const MOMENT_TERM = /\b(controvers\w*|drama|discourse|feud|scandal|debate|beef|backlash|lawsuit)\b/i;
// politicians and tycoons the shared politics rule does not name: a meme about them is a political moment, not a word
const POLITICAL_NAMES = /\b(mcconnell|pelosi|schumer|desantis|newsom|kamala|aoc|ocasio-cortez|rfk|hegseth|rubio|leavitt|musk|bezos|zuckerberg)\b/i;
// kinds the owner asked for first: words and catchphrases people say, then sounds and crazes
const KIND_BOOST = { word: 1.25, phrase: 1.1, sound: 1.1, trend: 1 };
function safeTerm(term) {
  return !SENSITIVE_TERM.test(term) && !X.PROFANE.test(term) && !RE.politics.test(term) && !RE.politicsCase.test(term) &&
    !RE.crypto.test(term) && !RE.techBiz.test(term) && !MOMENT_TERM.test(term) && !POLITICAL_NAMES.test(term);
}
const safeMeaning = (text) => !SENSITIVE_TERM.test(text) && !POLITICAL_NAMES.test(text) && !X.PROFANE.test(text);
/**
 * A Know Your Meme entry page keeps its term off the list when it describes something unsafe, or a person or a one-off moment
 * rather than a word, sound or craze ("Jean Phil is a French internet persona"), whatever the headlines said.
 */
const offPage = (lookup) => {
  const k = lookup && lookup.kym;
  if (!k || !k.desc) return false;
  return X.kymPersonOrMoment(X.kymPredicate(k.desc, k.name), k.name);
};
/** A Know Your Meme page that describes something dangerous or tragic: shown, flagged. */
const pageSensitive = (lookup) => {
  const k = lookup && lookup.kym;
  return !!(k && k.desc) && (HAZARD.test(k.desc) || RE.tragedy.test(k.desc) || RE.unsafe.test(k.desc.replace(WARN_WORDS, ' ')) || SENSITIVE_TERM.test(k.desc));
};
/** The kind an entry page gives: KYM's own classification, or a sound when the video it describes is sung ("... while singing, ..."). */
function pageKind(lookup) {
  const k = lookup && lookup.kym;
  const pred = k && k.desc ? X.kymPredicate(k.desc, k.name) : null;
  if (!pred) return null;
  return X.kymKind(pred, k.name || '') || (/\b(sing\w*|sung|songs?|remix\w*|audio|sounds?)\b/i.test(pred) ? 'sound' : null);
}

const CRAZE_QUERY = /\b(week|day|challenge|trend|craze|dance)\b/i;
const CRAZE_SEARCH_VOLUME = 200000;
/** A US Trends query of 200K+ that names a craze (a "week", a "challenge"), not a person, a game or a year's event listing. */
function crazeSearch(tr) {
  const ws = W.words(tr.keyword);
  return tr.geo === 'US' && tr.volume >= CRAZE_SEARCH_VOLUME && tr.pop !== false && ws.length >= 2 && ws.length <= 4 && CRAZE_QUERY.test(tr.keyword) &&
    !/\bvs\b|\b(nfl|nba|mlb|nhl|game|score|weather|forecast|holiday)\b/i.test(tr.keyword) && safeTerm(tr.keyword);
}

// ---------- groups ----------
function newGroup(key) {
  // items: the item objects themselves (clustering later rewrites an item's key, so the moments check compares objects);
  // own: the items that name the term themselves (not a passing mention), whose summaries may say when it began
  // kymSlugs: exact Know Your Meme entry slugs its sources link to; kymNames: entry names KYM files it under
  return { key, surfaces: new Map(), kinds: new Map(), ev: [], defs: [], olderDefs: [], rowKeys: new Set(), items: new Set(), own: new Set(), secondary: new Set(),
    withKind: null, withKindW: 0, kymSlugs: new Set(), kymNames: new Set() };
}

/** Union-find over term keys: an explainer's second name, a KYM entry's aliases and contained catchphrases join one entry. */
function makeUnion() {
  const parent = new Map();
  const find = (k) => { while (parent.has(k) && parent.get(k) !== k) k = parent.get(k); return k; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  return { find, union };
}

function kymEntry(it) {
  // the newsroom's title is a headline; its definition opens with the entry's name ("Happy Day, Ronaldo Day is a series of memes")
  if (it.src === 'kym-news') {
    const m = (it.kymDesc || '').match(/^(.{2,100}?)(?:,? (?:sometimes |also )?(?:known as|or) [^,]{2,80},)? (?:is|are|refers to)\s/);
    const names = m ? X.kymNames(m[1].replace(/,? (?:sometimes |also |often )?(?:known as|called|or) .*$/, '')) : [];
    return names.length ? { names, pred: X.kymPredicate(it.kymDesc, m[1]) } : null;
  }
  const names = X.kymNames(it.title);
  return names.length ? { names, pred: X.kymPredicate(it.kymDesc, names[0]) } : null;
}

/** "... salt stepping, or ‘salt stomping’ ..." in an entry's own definition or summary line: another name for the same entry. */
function withAliases(found, it) {
  const primary = found.find((f) => !f.secondary);
  if (!primary) return found;
  const names = new Set(found.map((f) => f.term.toLowerCase()));
  const aliases = X.aliasesIn(`${it.kymDesc || ''} ${it.dek || ''}`).filter((a) => !names.has(a.toLowerCase()));
  return [...found, ...aliases.map((a) => ({ term: a, kind: primary.kind, role: primary.role, secondary: true, defs: [] }))];
}

/** Terms and definitions one item names: [{ term, kind, role, secondary, defs: [{ text, quality, from }] }]. roundups: KYM roundup pages read. */
function termsOfItem(it, roundups = null) {
  const from = it.outlet || it.label;
  const titleCase = W.isTitleCase(it.title.split(' '));
  const rehost = R.REHOST.test(it.outlet || '');
  const withDefs = (term, extra = []) => [
    ...extra,
    ...X.meaningsFromTitle(it.title, term, { rehost }).map((d) => ({ ...d, from, titleCase })),
    // the explainer's own summary line: a definition when it says "X is ...", else its first plain sentence
    ...[X.meaningFromDek(it.dek, term) || X.meaningFromDek(it.dek, term, true)].filter(Boolean).map((d) => ({ ...d, from })),
  ];
  if (it.src === 'kym-memes' || it.src === 'kym-subs' || it.src === 'kym-news') {
    const e = kymEntry(it);
    const kind = e && X.kymKind(e.pred, e.names[0]);
    if (!kind) return [];
    const def = X.tidyMeaning(e.pred);
    const use = X.useLine(it.kymDesc);
    const role = it.src === 'kym-subs' ? 'kym-sub' : 'kym-entry';
    const slug = ((it.url || '').match(/knowyourmeme\.com\/memes\/([a-z0-9-]+)\/?(?:$|[?#])/) || [])[1];
    // KYM files entries under Title Case names ("That's My Husband"); its later sentences may say how people use it
    const defs = [def ? { text: def, quality: 5, from: 'Know Your Meme', raw: e.pred } : null, use ? { text: use, quality: 5, from: 'Know Your Meme', use: true } : null]
      .filter(Boolean);
    return withAliases(e.names.map((n, i) => ({ term: n, kind, role, secondary: i > 0, titleCase: true, kymName: true, ...(slug ? { kymSlug: slug } : {}),
      defs: i === 0 ? defs : [] })), it);
  }
  if (it.fam === 'bluesky') {
    const q = (it.title.match(/['‘"“]([^'’"”]{2,40})['’"”]/) || [])[1];
    if (it.category !== 'culture' || !q || !/\b(trend|meme|challenge|viral)\b/i.test(it.desc || '')) return [];
    const d = X.meaningFromBluesky(it.desc);
    return [{ term: q, kind: 'trend', role: 'explainer', secondary: false, defs: d ? [{ ...d, from: 'Bluesky' }] : [] }];
  }
  const kymPage = it.fam === 'kym' || X.RX.kymTemplate.test(it.title);
  const found = withAliases(X.termsFromTitle(it.title, { isReddit: it.fam === 'reddit' }).map((t) => ({
    ...t, role: kymPage && (t.role === 'explainer' || t.role === 'asked') ? 'kym-explainer' : t.role, titleCase, defs: t.secondary ? [] : withDefs(t.term),
  })), it);
  // Know Your Meme's weekly roundup names only three of its picks in the title; its page names them all, with their entry pages
  const page = roundups && roundups.get(X.roundupSlug(it.title));
  const listed = page ? page.entries.flatMap((e) => X.kymNames(e.name).map((n, i, all) => ({ term: n, kind: 'trend', role: 'kym-roundup',
    secondary: i > 0, ...(i > 0 ? { aliasOf: all[0] } : {}), titleCase: true, kymName: true, kymSlug: e.slug, defs: [] }))) : [];
  // the page names every pick exactly, so the title's short names ("Speed GTA" for "IShowSpeed GTA 4 Edit") give way to it
  return page ? [...found.filter((f) => f.role !== 'kym-roundup'), ...listed] : found;
}
/** The independent source an item stands for, and how much it counts. A news item also carries its title, so syndicated copies merge. */
function evidenceOf(it, role, outletKeyOf) {
  const kym = it.fam === 'kym' || role.startsWith('kym');
  const key = kym ? 'kym' : it.fam === 'reddit' || it.fam === 'bluesky' || it.fam === 'hn' ? it.fam : `news:${outletKeyOf(it)}`;
  let w = ROLE_W[role] ?? 1;
  if (it.fam === 'reddit') w = 1 + (it.rankDay < 15 ? 0.5 : 0);
  if (it.fam === 'bluesky') w = 1 + (it.status === 'trending' ? 0.5 : 0);
  if (it.fam === 'hn') w = HN_W; // Hacker News's front page: a community upvoted the story, a small second family
  // a re-host (Yahoo, AOL) counts half as coverage, but an explainer it carries is still an explainer
  const rehost = R.REHOST.test(it.outlet || '');
  if (!kym && rehost && role !== 'asked' && role !== 'explainer') w *= 0.6;
  if (!kym && R.LOCAL_OUTLET.test(it.outlet || '')) w *= 0.5;
  const label = kym ? 'Know Your Meme' : it.fam === 'reddit' ? 'Reddit' : it.fam === 'bluesky' ? 'Bluesky' : it.fam === 'hn' ? 'Hacker News' : it.outlet;
  const news = key.startsWith('news:');
  // (a Hacker News post linking an outlet's story carries its title: it is that outlet's story, counted once)
  // (the item itself rides along: clustering later rewrites an item's key)
  return { key, w, t: it.t, role, label, rowKey: it.key, item: it, ...(it.fam === 'hn' ? { titleKey: W.words(it.title).slice(0, 12).join(' '), link: true } : {}),
    ...(news ? { titleKey: W.words(it.title).slice(0, 12).join(' '), rehost, local: R.LOCAL_OUTLET.test(it.outlet || '') } : {}) };
}

/**
 * Syndicated copies are one source: news evidence with the same opening title words takes the key of the outlet that published it
 * (an original before a re-host), so five News Corp mastheads or USA Today plus its Yahoo copy count once. KYM, search and
 * Wikipedia evidence is left alone.
 */
function collapseSyndicated(ev) {
  const owner = new Map();
  for (const e of [...ev].sort((a, b) => Number(!!a.rehost) + 2 * Number(!!a.link) - Number(!!b.rehost) - 2 * Number(!!b.link))) if (e.titleKey && !owner.has(e.titleKey)) owner.set(e.titleKey, e);
  return ev.map((e) => (e.titleKey ? { ...e, key: owner.get(e.titleKey).key, label: owner.get(e.titleKey).label, local: owner.get(e.titleKey).local } : e));
}

function addToGroup(g, it, found, ev) {
  const sw = SURFACE_W[found.role] ?? 1;
  const sKey = found.term;
  const old = g.surfaces.get(sKey) || { w: 0, n: 0, titleCase: false };
  // a quoted name is the one the source actually uses ("How I Feel In My Hometown", not a bare "Hometown")
  const w = sw + (found.bare ? 0 : 0.5);
  if (!found.secondary) g.surfaces.set(sKey, { w: Math.max(old.w, w), n: old.n + 1, titleCase: old.titleCase || !!found.titleCase });
  else g.secondary.add(sKey);
  // the name with its kind word as a source wrote it ("Hotel Lobby AI trend"), for when the bare name is something else
  if (found.withKind && !found.secondary && w > g.withKindW) { g.withKind = found.withKind; g.withKindW = w; }
  // Know Your Meme's own classification outweighs how headlines happen to word it
  // (its weekly roundup only lists names, so the kind there is a guess)
  const kymClass = found.role.startsWith('kym-') && found.role !== 'kym-explainer' && found.role !== 'kym-roundup';
  if (!found.secondary) g.kinds.set(found.kind, (g.kinds.get(found.kind) || 0) + (kymClass ? 5 : found.kindWord ? 2 : 1));
  if (found.kymSlug) g.kymSlugs.add(found.kymSlug);
  if (found.kymName) g.kymNames.add(found.term);
  if (!g.rowKeys.has(it.key)) { g.ev.push(ev); g.rowKeys.add(it.key); g.items.add(it); }
  g.own.add(it);
  g.defs.push(...(found.defs || []));
}

/**
 * Step 2: every term the window's items and Trends rows name, merged into groups, with mention/search evidence attached.
 * items: prepared items (ideas.js prepare) in the window; trends: store trends in the window; lex: the corpus name lexicon.
 */
function collect(items, trends, { outletKeyOf, lex = null, roundups = null, older = [] }) {
  const safe = items.filter(safeForWords);
  // a Know Your Meme entry about a coin itself is crypto news, not a word (a meme a token rides on still lists: no content filter)
  const tainted = new Set(items.filter((it) => it.fam === 'kym' && it.drop === 'crypto').flatMap((it) => X.kymNames(it.title)).map(termKey));
  // a term a sensitive story is about ("'Cat in the Hat' trend lands teens in handcuffs") is flagged, however harmless its other
  // coverage sounds
  const flagged = new Set(items.filter((it) => sensitiveItem(it) && !nonOutlet(it) && !(it.drop === 'publisher' || it.drop === 'spam'))
    .flatMap((it) => X.termsFromTitle(it.title).map((t) => t.term)).map(termKey));
  const raw = [];
  for (const it of safe) for (const f of termsOfItem(it, roundups)) if (safeTerm(f.term) && termKey(f.term)) raw.push({ it, f });
  for (const tr of trends) {
    const term = X.termFromTrend(tr);
    if (term && safeTerm(term)) raw.push({ tr, f: { term, kind: term.split(' ').length > 1 ? 'phrase' : 'word', role: 'search', secondary: false, defs: [] } });
    // a huge US search for a yearly craze or a challenge is one on its own ("fat bear week", 200K+)
    else if (!term && crazeSearch(tr)) raw.push({ tr, f: { term: W.words(tr.keyword).join(' '), kind: 'trend', role: 'search', secondary: false, defs: [] } });
  }
  // union: secondary names join the primary term of the same item
  const U = makeUnion();
  const byItem = new Map();
  for (const r of raw) {
    if (!r.it) continue;
    if (!byItem.has(r.it.key)) byItem.set(r.it.key, []);
    byItem.get(r.it.key).push(r);
  }
  for (const list of byItem.values()) {
    const primary = list.find((r) => !r.f.secondary);
    if (!primary) continue;
    // secondary names, and every name of a one-subject question ("Who Are 'Wawario' And 'Wawaluigi'?"), are one entry
    const oneSubject = /^(?:so )?(?:what|who|wtf|why)\b/i.test(primary.it.title) &&
      list.every((r) => !['roundup', 'dictionary', 'column', 'kym-roundup'].includes(r.f.role));
    for (const r of list) {
      if (r.f.aliasOf) U.union(termKey(r.f.aliasOf), termKey(r.f.term)); // a roundup entry's second name ("Celebrity Lookalike Trend / Star By Face")
      else if (r !== primary && (r.f.secondary || oneSubject)) U.union(termKey(primary.f.term), termKey(r.f.term));
    }
  }
  // a catchphrase inside a longer one is the same entry ("blocking the street" / "we're all just blocking the street"), and so is
  // a one-word name that opens a longer one ("verity" / "Verity's from Minecraft")
  const keys = [...new Set(raw.map((r) => termKey(r.f.term)))].sort((a, b) => a.length - b.length);
  const oneWord = new Set(raw.filter((r) => termSeq(r.f.term).length === 1).map((r) => termKey(r.f.term)));
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if ((keys[i].length >= 8 && keys[j].includes(keys[i])) || (keys[i].length >= 6 && oneWord.has(keys[i]) && keys[j].startsWith(keys[i]))) U.union(keys[j], keys[i]);
    }
  }
  unionCrazes(raw, U, items);
  const groups = new Map();
  for (const { it, tr, f } of raw) {
    const k = U.find(termKey(f.term));
    if (!groups.has(k)) groups.set(k, newGroup(k));
    const g = groups.get(k);
    if (it) addToGroup(g, it, f, evidenceOf(it, f.role, outletKeyOf));
    else if (tr) {
      g.surfaces.set(f.term, g.surfaces.get(f.term) || { w: SURFACE_W.search, n: 1, titleCase: false });
      if (f.kind === 'trend') g.kinds.set('trend', (g.kinds.get('trend') || 0) + 1);
    }
  }
  // a group made only of secondary names is not a term of its own ("Family Guy" from "... The Viral 'Family Guy' Trend Explained");
  // one only Hacker News names is tech news, not a word people say
  for (const [k, g] of groups) {
    if (!g.surfaces.size || [...g.surfaces.keys()].some((sf) => tainted.has(termKey(sf))) ||
      (g.items.size && [...g.items].every((it) => it.fam === 'hn'))) groups.delete(k);
    else g.sensitive = [...g.surfaces.keys()].some((sf) => flagged.has(termKey(sf))) || [...g.items].some(sensitiveItem);
  }
  // a definition outlives the window: an item from just before it that defined a term still in the window ("'Cat in the Hat' Trend
  // Lands US Teens in Handcuffs Over AI-Made Threats", two weeks old) still gives its meaning when the window's own give none,
  // never its evidence
  for (const it of older.filter(safeForWords)) {
    for (const f of termsOfItem(it, roundups)) {
      if (f.secondary || !f.defs || !f.defs.length || !safeTerm(f.term) || !termKey(f.term)) continue;
      const g = groups.get(U.find(termKey(f.term)));
      if (g) g.olderDefs.push(...f.defs);
    }
  }
  // an item that explains one term gives no definitions to another term it merely names
  const explains = new Map();
  for (const { it, f } of raw) if (it && !f.secondary) explains.set(it, (explains.get(it) || new Set()).add(U.find(termKey(f.term))));
  attachMentions(groups, safe, outletKeyOf, explains);
  attachSearch(groups, trends, lex);
  return [...groups.values()];
}

/**
 * The same craze under two names ("salt stepping" / "Epsom salt foot stomping"): trend names first seen within a week of each
 * other that share a rare word (idf >= TOKEN_IDF_MIN over the window's titles), in titles about the same kind of thing (sleep).
 */
function unionCrazes(raw, U, items) {
  const df = new Map();
  for (const it of items) for (const s of new Set(W.words(it.title).map(termStem))) df.set(s, (df.get(s) || 0) + 1);
  const rare = (s) => s.length >= 4 && !W.STOP.has(s) && !W.GENERIC.has(s) && Math.log(items.length / (df.get(s) || 1)) >= TOKEN_IDF_MIN;
  const info = new Map();
  for (const { it, f } of raw) {
    if (!it || f.kind !== 'trend' || f.secondary) continue;
    const k = termKey(f.term);
    const cur = info.get(k) || { t: Infinity, stems: new Set(termSeq(f.term).filter(rare)), cues: new Set() };
    cur.t = Math.min(cur.t, it.t);
    for (const c of it.title.matchAll(CRAZE_CUE)) cur.cues.add(c[1].toLowerCase().replace(/s$/, ''));
    info.set(k, cur);
  }
  const list = [...info.entries()].filter(([, v]) => v.stems.size && v.cues.size);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [ka, a] = list[i];
      const [kb, b] = list[j];
      if (Math.abs(a.t - b.t) > CRAZE_JOIN_DAYS * DAY) continue;
      if ([...a.stems].some((s) => b.stems.has(s)) && [...a.cues].some((c) => b.cues.has(c))) U.union(ka, kb);
    }
  }
}

/** Titles that use a term without explaining it still show it spreading: each such outlet is one more source. */
function attachMentions(groups, items, outletKeyOf, explains) {
  const tokens = items.map((it) => ({ it, seq: W.words(it.title).map(termStem) }));
  for (const g of groups.values()) {
    g.seqs = uniqSeqs([...g.surfaces.keys()].map(termSeq));
    const plain = g.seqs.every((s) => s.length === 1) && [...g.surfaces.keys()].every((s) => !X.isCoinage(W.words(s)[0] || '') || /^\d+$/.test(s));
    // (a phrase of everyday words is as plain as one word: "crash out", "state property". It counts in a title about words or
    // trends, or one that shares a word with the entry's own sources; a quote-like catchphrase of three words or more is
    // distinctive on its own, as the term-exact search reads it (words-answers.js sinceOf). Collector only, 2026-10-19: a
    // meme's outlets were car crashes and tax news)
    const ordinary = !plain && [...g.surfaces.keys()].every((sf) => { const ws = W.words(sf); return ws.length >= 2 && !(ws.length >= 3 && X.QUOTE_LIKE.test(sf)) && ws.every((w) => !X.isCoinage(w) || /^\d+$/.test(w)); });
    const vocab = ordinary ? entryVocab(g) : null;
    // (and a headline that quotes the phrase uses it as the word: "Zelda fans obsessed with Dark Link's “aura farming” in ...")
    const quoted = ordinary ? new RegExp(`[‘“"']\\s*(?:${[...g.surfaces.keys()].map((sf) => W.words(sf).join('\\W+')).join('|')})\\W*[’”"']`, 'i') : null;
    // "67% Indian Travellers Find European Cruising Appealing" is a figure, not the meme
    const numbers = [...g.surfaces.keys()].filter((s) => /^\d+$/.test(s));
    const figure = numbers.length ? new RegExp(numbers.map((s) => `\\$\\s?${s}\\b|\\b${s}(?:\\s*%|\\s*(?:percent|per cent|million|billion|k)\\b)`).join('|'), 'i') : null;
    for (const { it, seq } of tokens) {
      if (g.rowKeys.has(it.key) || !g.seqs.some((s) => hasSeq(seq, s))) continue;
      // a plain word ("aura", "polyester", "67") counts only where the title is about words or trends
      if (plain && !CONTEXT_FOR_PLAIN_WORD.test(it.title)) continue;
      if (ordinary && !CONTEXT_FOR_PLAIN_WORD.test(it.title) && !quoted.test(it.title) && !W.words(it.title).some((w) => vocab.has(w))) continue;
      if (figure && figure.test(it.title)) continue;
      const surface = [...g.surfaces.keys()][0];
      // a dictionary story that names the word ("Looksmaxxing, Vibe Coding and Rickroll enter Merriam-Webster") is a dictionary addition
      g.ev.push(evidenceOf(it, X.DICTIONARY_CONTEXT.test(it.title) ? 'dictionary' : 'mention', outletKeyOf));
      g.rowKeys.add(it.key);
      g.items.add(it);
      if (explains.has(it) && !explains.get(it).has(g.key)) continue;
      const titleCase = W.isTitleCase(it.title.split(' '));
      g.defs.push(...X.meaningsFromTitle(it.title, surface).map((d) => ({ ...d, from: it.outlet || it.label, titleCase })));
      const dek = X.meaningFromDek(it.dek, surface);
      if (dek) g.defs.push({ ...dek, from: it.outlet || it.label });
      if (it.fam === 'bluesky' && it.category === 'culture') {
        const d = X.meaningFromBluesky(it.desc);
        if (d) g.defs.push({ ...d, from: 'Bluesky' });
      }
    }
  }
}
function uniqSeqs(seqs) {
  const seen = new Set();
  return seqs.filter((s) => s.length && !seen.has(s.join(' ')) && seen.add(s.join(' ')));
}

/**
 * A Trends keyword or related query that contains the term: people are searching it. A match, a film or a TV series that shares a
 * word is someone else's search ("canada vs chile", "verity (film)"); a one-word term needs the query to be the coinage itself or to
 * ask about it as a word or a meme; a term among a person's related queries is that person's news and counts at 0.3.
 */
function attachSearch(groups, trends, lex) {
  for (const g of groups.values()) {
    const coinages = new Set([...g.surfaces.keys()].filter((sf) => termSeq(sf).length === 1 && X.isCoinage(W.words(sf)[0] || '') && !/^\d+$/.test(sf)).map(termKey));
    let best = null;
    for (const tr of trends) {
      if (OFF_TOPIC_QUERY.test(tr.keyword)) continue;
      const personRow = !!lex && lex.names.has(W.words(tr.keyword).join(' '));
      [tr.keyword, ...(tr.related || [])].forEach((query, i) => {
        if (OFF_TOPIC_QUERY.test(query)) return;
        const q = W.words(query).map(termStem);
        const hit = g.seqs.some((s) => hasSeq(q, s) && (s.length > 1 || (q.length === 1 && coinages.has(s.join(''))) || SEARCH_CUE.test(query)));
        if (!hit) return;
        const w = Math.min(2.5, Math.log10(Math.max(1, tr.volume) / 500)) * (tr.geoW || 1) * (personRow && i > 0 ? PERSON_ROW_MULT : 1);
        if (w > 0 && (!best || w > best.w)) best = { key: 'search', w, t: tr.start, role: 'search', label: 'Google Trends', volume: tr.volume, personRow };
      });
    }
    if (best) g.ev.push(best);
  }
}

// ---------- origin ----------
/** Sentences of a summary line that name one of the group's surfaces (a line about something else says nothing about when it began). */
function sentencesNaming(text, g) {
  const firsts = [...g.surfaces.keys()].map((s) => (W.words(s)[0] || '')).filter((w) => w.length >= 2);
  return (text || '').split(/(?<=[a-z0-9)”"'’])[.!?]\s/).filter((s) => firsts.some((w) => W.words(s).includes(w)));
}
/** When the term began, as its own sources tell it: KYM definitions, summary lines naming it, its Wikipedia and KYM entry pages. */
function originOfGroup(g, lookup, now) {
  const texts = [];
  for (const it of g.own) {
    if (it.kymDesc) texts.push(it.kymDesc);
    if (it.dek) texts.push(...sentencesNaming(it.dek, g));
  }
  if (okSummary(lookup)) texts.push(lookup.summary.extract);
  if (lookup && lookup.kym && lookup.kym.desc) texts.push(lookup.kym.desc);
  // "uploaded to YouTube in 2024 ... went viral in 2026": when it went viral, if any source says, else when its source was made.
  // viral: a source dates the spread itself, which then outranks the open-ended news search (a 2024 "celebrity lookalike" contest is
  // not Star By Face's September 2026 trend)
  const parts = texts.map((t) => X.originParts(t, now));
  const t = X.originFromParts(parts);
  return { t, viral: Number.isFinite(t) && parts.some((p) => p.viralSeen) };
}
// ---------- ranking ----------
function kindOfGroup(g, lookup) {
  // Know Your Meme's entry page settles the kind ("We're All Just Blocking the Street is a song from a scene in Family Guy" -> sound)
  const page = pageKind(lookup);
  if (page) return page;
  const order = ['trend', 'sound', 'phrase', 'word'];
  return [...g.kinds.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))[0]?.[0] ||
    (g.seqs[0] && g.seqs[0].length > 1 ? 'phrase' : 'word');
}

/** Know Your Meme's names for the entry: from its feeds, its weekly roundup and its entry page ("Verity's From Minecraft, He Belongs To Backrooms"). */
function kymNamesOf(g, lookup) {
  const page = lookup && lookup.kym && lookup.kym.name ? X.kymNames(lookup.kym.name) : [];
  return [...new Set([...g.kymNames, ...page])];
}
const shortName = (s) => {
  const ws = s.split(' ');
  return ws.length > DISPLAY_MAX_WORDS ? `${ws.slice(0, DISPLAY_MAX_WORDS).join(' ').replace(/[,;:]$/, '')}…` : s;
};
/**
 * The name as sources write it: the strongest surface, un-Title-Cased. A catchphrase reads as said ("That's my husband"); a word or
 * trend made only of plain words is lowercase ("mogging", "parent split-face trend"); names keep capitals ("Cookie McDouble", "Chile").
 * When Wikipedia's page of that exact name is something else (the painting "Hotel Lobby"), the name keeps its kind ("Hotel Lobby AI trend").
 * A sound shows the whole line people sing (Know Your Meme's name for it, up to 10 words: "Verity's from Minecraft, he belongs to
 * Backrooms"); a caption-length name shows a shorter other name, or its first eight words.
 */
function displayOf(g, kind, lex, lookup) {
  const top = [...g.surfaces.entries()].sort((a, b) => b[1].w - a[1].w || b[0].length - a[0].length)[0];
  const refusedTitle = lookup && lookup.summary && !lookup.summary.accepted ? termKey(lookup.summary.title.replace(/\s*\([^)]*\)/g, '')) : null;
  const refused = refusedTitle && g.withKind && [...g.surfaces.keys()].some((sf) => termKey(sf) === refusedTitle);
  let surface = refused ? g.withKind : top[0];
  let info = top[1];
  const names = kymNamesOf(g, lookup);
  if (kind === 'sound') {
    const k = termKey(surface);
    const sung = names.filter((n) => n.split(' ').length <= 10 && termKey(n).includes(k)).sort((a, b) => b.length - a.length)[0];
    if (sung && sung.length > surface.length) { surface = sung; info = { ...info, titleCase: true }; }
  }
  if (surface.split(' ').length > DISPLAY_MAX_WORDS) {
    const others = [...new Set([...names, ...g.surfaces.keys(), ...g.secondary])].filter((n) => n.split(' ').length <= DISPLAY_MAX_WORDS && termKey(n) !== termKey(surface));
    if (others.length) surface = others.sort((a, b) => (g.surfaces.get(b)?.w || 0) - (g.surfaces.get(a)?.w || 0))[0];
  }
  const s = info.titleCase && lex ? W.recase(surface, lex, true) : surface;
  const ws = s.split(' ');
  const first = ws[0];
  const low = W.words(first)[0] || '';
  const cls = lex ? W.wordClass(first, lex) : 'lower';
  const plainFirst = (cls === 'lower' || cls === 'inflected' || (cls === 'unknown' && lex && lex.low.has(low))) &&
    !/^[A-Z0-9]{2,}$/.test(first) && !(lex && lex.proper.has(low)) && !R.PLACES.has(low);
  const restPlain = ws.slice(1).every((w) => !/\p{Lu}/u.test(w) || /^(AI|TikTok)$/.test(w));
  const fixI = (x) => x.replace(/\bi(?=$|\s|['’])/g, 'I'); // "Why would i deceive you" after un-Title-Casing
  // a caption-length name reads as a sentence ("How it feels to cook a yummy meal as a boy"); "Anti-Blush" -> "anti-blush"
  const sentence = kind === 'phrase' || kind === 'sound' && ws.length >= 4 || X.QUOTE_LIKE.test(s) || ws.length >= 4;
  // ... and a capital its own definition never uses goes too ("How I feel in my Hometown": "... locations in their hometown")
  const plain = sentence ? lowerInOwnText(g, lookup) : null;
  const out = sentence ? ws.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : /^\p{Lu}\p{Ll}+$/u.test(w) && plain.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ')
    : plainFirst && restPlain ? first.replace(/(^|-)(\p{Lu})/gu, (m, a, b) => a + b.toLowerCase()) + s.slice(first.length) : s;
  // a work's title the sentence-case headlines quote with its capitals ("‘Cat in the Hat’ trend") keeps them
  const quoted = quotedCasing(g, surface);
  const shown = quoted || fixI(out);
  // a list label starts with a capital ("Mogging", "Salt stepping", "Anti-blush")
  return shortName(shown.charAt(0).toUpperCase() + shown.slice(1)).replace(/’/g, "'");
}
/** The casing sentence-case headlines give the name inside quotes, when two of them agree and it has a capital after the first word. */
function quotedCasing(g, surface) {
  const k = termKey(surface.replace(/^the /i, ''));
  const seen = new Map();
  const ws = surface.replace(/^the /i, '').split(/\s+/).filter(Boolean);
  // unquoted too, when every word is capitalised in a sentence-case headline ("Fat Bear Week returns to crown ...")
  const bare = ws.length >= 2 ? new RegExp(`\\b(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')})\\b`, 'i') : null;
  for (const it of g.items) {
    if (W.isTitleCase(it.title.split(' '))) continue;
    for (const m of W.curlQuotes(it.title).matchAll(/[‘“]([^’”]{3,60})[’”]/g)) {
      if (termKey(m[1].replace(/^the /i, '')) !== k || !/\s\p{Lu}/u.test(m[1])) continue;
      seen.set(m[1], (seen.get(m[1]) || 0) + 2);
    }
    const b = bare && W.curlQuotes(it.title).match(bare);
    if (b && b[1].split(/\s+/).every((w) => /^\p{Lu}/u.test(w))) seen.set(b[1], (seen.get(b[1]) || 0) + 1);
  }
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 1 ? top[0] : null;
}
/** Words the entry's own definitions write in lowercase and never capitalise mid-sentence, its names left out. */
function lowerInOwnText(g, lookup) {
  const names = [...g.surfaces.keys(), ...kymNamesOf(g, lookup)].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length);
  // sentence-case text only: a Title Case headline capitalises everything
  const texts = [...g.defs.filter((d) => !d.titleCase).map((d) => d.text), ...[...g.own].map((it) => it.kymDesc || ''), (lookup && lookup.kym && lookup.kym.desc) || '']
    .map((t) => names.reduce((acc, n) => acc.split(n).join(' '), W.curlQuotes(t)));
  const low = new Set();
  const cap = new Set();
  // a capital counts as a name alone among lowercase words ("pull Verity into"); in a run of capitals it is another Title Case name
  // ("How It Feels In My Hometown")
  const capital = (w) => /^\p{Lu}/u.test(w.replace(/^[^\p{L}]+/u, ''));
  for (const t of texts) {
    t.split(/\s+/).forEach((w, i, all) => {
      const core = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (/^\p{Ll}+$/u.test(core)) low.add(core);
      else if (i > 0 && /^\p{Lu}\p{Ll}+$/u.test(core) && !/[.!?:]$/.test(all[i - 1]) && !capital(all[i - 1]) && !capital(all[i + 1] || '')) cap.add(core.toLowerCase());
    });
  }
  return new Set([...low].filter((w) => !cap.has(w)));
}

// what people do in a craze: "stomping", "pair", "puts", "lip-sync" (a line with none says what it is, not what to film)
const DOING = /\b([a-z]+ing|puts?|pairs?|films?|posts?|uses?|wears?|swaps?|stands?|stomps?|dances?|shares?|lists?|recreates?|combines?|turns?|tries?|lip[- ]?syncs?|edits?|draws?|hides?)\b/;
/** A craze's other name made of plain words ("Epsom Salt Foot Stomping"), to say what people do when its line does not. */
function plainAlias(g, shownKey) {
  return [...g.surfaces.keys(), ...g.secondary].find((n) => termKey(n) !== shownKey && n.split(' ').length >= 2 && n.split(' ').length <= 5 &&
    W.words(n).every((w) => /^[a-z]+$/.test(w)) && DOING.test(n.toLowerCase())) || null;
}
const SINCE_TITLE_PENALTY = 0.2; // a headline the daily feeds did not carry defines it a little less surely than one they did
/** Definitions in the headlines the term-exact search found ("What Is Anti-Blush? Meet the New Beauty Trend Replacing Rosy Cheeks"). */
function sinceMeanings(g, lookup) {
  const titles = (lookup && lookup.since && lookup.since.titles) || [];
  const surface = [...g.surfaces.keys()][0];
  // (a term already flagged sensitive keeps its threat and arrest headlines as meaning material: no content filter, the flag is enough)
  return titles.filter((x) => (g.sensitive || safeHeadline(x.title)) && !R.PUBLISHER_BLOCK.test(x.label || '') && !SOCIAL_OUTLET.test(x.label || '') && !BRAND_OUTLET.test(x.label || ''))
    .flatMap((x) => X.meaningsFromTitle(x.title, surface, { rehost: R.REHOST.test(x.label || '') })
      .map((d) => ({ ...d, quality: d.quality - SINCE_TITLE_PENALTY, from: x.label, titleCase: W.isTitleCase(x.title.split(' ')) })));
}
/**
 * The plainest sourced line: Know Your Meme's definition > an outlet's summary or defining title > Wikipedia > Wiktionary. For a
 * sound, catchphrase or craze, what it is is followed by what people do with it when Know Your Meme says both ("A song from a scene
 * in Family Guy — used as a lip dub audio and image macro, paired with captions about getting stuck in a crowd").
 */
function bestMeaning(g, lookup, lex, kind = null, shownKey = '') {
  // (the definitions from just before the window only when the window's own give no meaning)
  return meaningOf(g, lookup, lex, kind, shownKey, []) || (g.olderDefs.length ? meaningOf(g, lookup, lex, kind, shownKey, g.olderDefs) : null);
}
function meaningOf(g, lookup, lex, kind, shownKey, older) {
  const all = [...g.defs, ...sinceMeanings(g, lookup), ...kymPageMeanings(lookup), wikiMeaning(lookup), wiktMeaning(lookup, [...g.surfaces.keys()][0]), ...older]
    .filter(Boolean);
  // a headline's descriptor says who uses the word or how it feels, not what it means ("Gen Alpha's biggest insult", "A sleek fall
  // 2026 trend reignited by Zendaya"): below the bar, so the entry waits for a real definition
  const cands = all.map((d) => (!DEFINER_SOURCES.has(d.from) && descriptorOnly(d.text) ? { ...d, quality: Math.min(d.quality, DESCRIPTOR_QUALITY) } : d))
    // "A trend that targets schools": a headline predicate too short to say what the thing is or what people do
    .map((d) => (!DEFINER_SOURCES.has(d.from) && W.words(d.text).filter((w) => !W.STOP.has(w)).length < SHORT_MEANING_WORDS ? { ...d, quality: d.quality - SHORT_MEANING_PENALTY } : d))
    .filter((d) => !d.use && d.quality >= MEANING_MIN_QUALITY);
  if (!cands.length) return null;
  const rank = (d) => d.quality + (DEF_FROM_W[d.from] || 0) - (d.titleCase ? TITLE_CASE_PENALTY : 0);
  const best = cands.sort((a, b) => rank(b) - rank(a) || a.text.length - b.text.length)[0];
  const names = new Set([...g.surfaces.keys(), ...kymNamesOf(g, lookup)].flatMap((n) => W.words(n)));
  const caseOf = (t) => X.caseMeaning(t, lex, !!best.titleCase, names);
  let text = caseOf(best.text);
  let chosen = best;
  const use = kind && kind !== 'word' && best.from === 'Know Your Meme' ? all.find((d) => d.use && safeMeaning(d.text)) : null;
  if (use) {
    const budget = MEANING_USE_MAX_WORDS - use.text.split(' ').length;
    const short = best.raw ? X.tidyMeaning(best.raw, budget) : best.text;
    // (a definition cut to fit loses what it is: then the definition alone)
    if (short && short.split(' ').length >= 8 && short.split(' ').length <= budget + 4) text = `${caseOf(short)} — ${X.caseMeaning(use.text, lex, false, names)}`;
    // a trend's definition that only names the clip it is based on, with no room for what people do with it, gives way to a
    // sourced line that says what they do ("An AI trend that puts people into a Quavo and Takeoff video")
    else if (kind === 'trend' && /\bbased on\b/i.test(best.text)) {
      const alt = cands.find((d) => d !== best && d.quality >= MECHANIC_QUALITY && MECHANIC.test(d.text));
      if (alt) { chosen = alt; text = X.caseMeaning(alt.text, lex, !!alt.titleCase, names); }
    }
  } else if (kind === 'trend' && !DOING.test(text.toLowerCase().replace(/\btrend\w*\b/g, ''))) {
    const alias = plainAlias(g, shownKey);
    const keepCap = (w) => lex && (W.wordClass(w, lex) === 'proper' || W.isProperWord(w.toLowerCase()));
    // what people do leads, what it is follows: "Epsom salt foot stomping, a bedtime trend people say helps them sleep"
    if (alias) {
      const doing = alias.split(' ').map((w, i) => (i === 0 || keepCap(w) ? w : w.toLowerCase())).join(' ');
      text = `${doing.charAt(0).toUpperCase()}${doing.slice(1)}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    }
  }
  const plain = plainMeaning(text);
  return { text: plain.charAt(0).toUpperCase() + plain.slice(1), from: chosen.from, quality: chosen.quality };
}
// what people do in a trend they copy: put someone into a clip, swap one person for another
const MECHANIC = /\b(puts?|swaps?|replaces?|drops?|inserts?)\b/i;
const MECHANIC_QUALITY = 4;

const SHORT_MEANING_WORDS = 4;
const SHORT_MEANING_PENALTY = 1.5;
const MEANING_MAX_SHOWN_WORDS = 26;
// meme-wiki jargon in plain words
const PLAIN_WORDS = [[/\bimage macros? memes\b/gi, 'captioned-photo memes'], [/\ba series of captioned-photo memes\b/gi, 'captioned-photo memes'],
  [/\bai-(made|generated|created)\b/gi, 'AI-$1'], [/\bai\b(?!-)/g, 'AI'], [/\bus (teens|students|schools|kids|police|users)\b/g, 'US $1'],
  [/\bused as an? lip dub audio and image macros?\b/gi, 'used for lip-syncs and captioned photos'], [/\ban? lip dub audio\b/gi, 'lip-sync audio'],
  [/\bfrom the manosphere\b/gi, 'that grew out of men’s internet forums,'],
  [/\blip dub audio\b/gi, 'lip-sync audio'], [/\blip dubs?\b/gi, 'lip-syncs'], [/\bimage macros?\b/gi, 'captioned photos'],
  [/\bviral video clip\b/gi, 'viral clip'], [/\breaction GIFs?\b/g, 'reaction clip'], [/\breaction gifs?\b/g, 'reaction clip'], [/\bexploitable\b/gi, 'remixable'], [/\bsnowclone\b/gi, 'fill-in-the-blank phrase'],
  [/\bphotoshops?\b/gi, 'edits'], [/\bthe manosphere\b/gi, 'online men’s forums'], [/\bmanosphere\b/gi, 'online men’s forums'],
  // a headline's drama in plain words: "lands US teens in handcuffs over AI-made threats now terrifying their schools" says what
  // happened calmly ("gets US teens arrested over AI-made threats"), without the tail that only tells how scary it is
  [/\blands? ([\p{L}\d’' -]{2,40}?) in handcuffs\b/giu, 'gets $1 arrested'], [/,?\s+now\s+(?:terrifying|scaring|haunting|horrifying|alarming|panicking|frightening|worrying)\b.*$/i, '']];
/**
 * A meaning a viewer takes in at a glance: meme-wiki jargon in plain words, no em dash (", used as ..."), and no trailing detail past
 * the point ("... scoring a touchdown during a Kansas City Chiefs NFL game").
 */
function plainMeaning(text) {
  let t = PLAIN_WORDS.reduce((acc, [re, to]) => acc.replace(re, to), text).replace(/\s+[—–]\s+/g, ', ');
  t = t.replace(/\s+during an? (?:[\p{Lu}][\p{L}.]*\s+){1,4}(?:NFL|NBA|MLB|NHL|WNBA)?\s*game\b/u, '');
  const ws = t.split(/\s+/);
  if (ws.length > MEANING_MAX_SHOWN_WORDS) {
    // cut at the last clause break inside the limit
    // (never inside a quote: "singing, ‘Happy day, Ronaldo day’" keeps the whole line)
    let open = false;
    const cut = ws.slice(0, MEANING_MAX_SHOWN_WORDS).map((w, i) => { if (/^[‘“]/.test(w)) open = true; const at = !open && /[,;]$/.test(w) ? i + 1 : 0; if (/[’”][,.;]?$/.test(w) && !/^[‘“]?\p{L}+['’]\p{L}/u.test(w)) open = false; return at; }).filter((i) => i >= 8).pop();
    if (cut) t = ws.slice(0, cut).join(' ').replace(/[,;]$/, '');
  }
  return t;
}

const DEFINER_SOURCES = new Set(['Know Your Meme', 'Wikipedia', 'Wiktionary', 'Bluesky']);
const DESCRIPTOR_QUALITY = 2;
const DESCRIPTOR = /^(?:an? |the )?(?:[\p{L}\d’'-]+,? ){0,4}(?:insult|slang|trend|craze|term|phrase|word)(?:\s+(?:taking over [\p{L} ]+|reignited by [\p{L} ]+|for an? [\p{L}, ]+ look|on tiktok|among [\p{L} ]+|of (?:the )?(?:year|summer|fall|season)))?$/iu;
const DEMOGRAPHIC = /^(?:gen[- ]?(?:z|alpha|x)|millennials|zoomers|teens|tiktokers)\b/i;
const DEFINING = /\b(means?|meaning|when|where|refers? to|in which|that (?:puts|lets|turns|makes|uses|pairs|shows))\b/i;
const descriptorOnly = (text) => !DEFINING.test(text) && (DESCRIPTOR.test(text.trim()) || DEMOGRAPHIC.test(text.trim()));

/** A headline from the term-exact search that may count as coverage: nothing unsafe, sensitive or crypto. */
const safeHeadline = (t) => !HAZARD.test(t) && !RE.unsafe.test(t.replace(WARN_WORDS, ' ')) && !RE.menace.test(t) && !RE.violent.test(t) &&
  !RE.tragedy.test(t) && !RE.crypto.test(t) && !SENSITIVE_TERM.test(t) && !X.PROFANE.test(t);
/** Words the entry's own sources use besides its name ("taylor", "kelce", "touchdown"): a catchphrase headline must share one. */
function entryVocab(g) {
  const own = new Set(g.seqs.flat());
  const text = [...g.own].map((it) => `${it.title} ${(it.kymDesc || '').slice(0, 400)}`).join(' ');
  return new Set(W.words(text).filter((w) => w.length >= 4 && !W.STOP.has(w) && !W.GENERIC.has(w) && !own.has(termStem(w)) && !CONTEXT_FOR_PLAIN_WORD.test(w)));
}
/**
 * Outlets the term-exact news search found naming it this fortnight that the daily feeds missed: one mention each. A headline about
 * words or trends counts; a catchphrase in any other headline counts only when it shares a word with the entry's own sources
 * ("A Day In My Life" on a college blog is not the trend).
 */
function sinceMentions(g, lookup, now) {
  const recent = (lookup && lookup.since && lookup.since.recent) || [];
  const have = new Set(g.ev.map((e) => e.key));
  const vocab = recent.some((r) => !r.ctx) ? entryVocab(g) : null;
  const related = (r) => r.ctx !== false || W.words(r.title).some((w) => vocab.has(w));
  // a copy of a story the entry already has (Yahoo's copy of Know Your Meme's own explainer) is not another source
  const titleKeyOf = (t) => W.words(t.replace(/\s+-\s+[^-]+$/, '')).slice(0, 12).join(' ');
  const seen = new Set([...g.items].map((it) => titleKeyOf(it.title)));
  return recent.filter((r) => r.t >= now - WINDOW_DAYS * DAY && r.t <= now + DAY && !have.has(`news:${r.key}`) && r.key !== 'kym' && related(r) &&
    !seen.has(titleKeyOf(r.title)) &&
    !SOCIAL_OUTLET.test(r.label) && !BRAND_OUTLET.test(r.label) && !R.PUBLISHER_BLOCK.test(r.label) && safeHeadline(r.title)).map((r) => {
    const rehost = R.REHOST.test(r.label);
    const local = R.LOCAL_OUTLET.test(r.label);
    return { key: `news:${r.key}`, w: SINCE_MENTION_W * (rehost ? 0.6 : 1) * (local ? 0.5 : 1), t: r.t, role: 'mention', label: r.label, extra: true,
      titleKey: W.words(r.title).slice(0, 12).join(' '), rehost, local };
  });
}

function scoreGroup(g, lookup, now, originHint = { t: Infinity, viral: false }) {
  const wiki = wikiEvidence(lookup, now);
  const extra = sinceMentions(g, lookup, now);
  const ev = collapseSyndicated([...g.ev, ...(wiki ? [wiki] : []), ...extra]);
  const byKey = new Map();
  for (const e of ev) if (!byKey.has(e.key) || byKey.get(e.key).w < e.w) byKey.set(e.key, e);
  const heat = [...byKey.values()].reduce((s, e) => s + e.w, 0);
  const families = new Set([...byKey.keys()].map((k) => k.split(':')[0])).size;
  // independent sources for the listing floor: a weak search match and flat Wikipedia views are not a second source, and local
  // stations count once together (ABC10 and fox61 run the same TEGNA package)
  const counted = [...byKey.values()].filter((e) => (e.role !== 'search' || e.w >= 1) && (e.role !== 'wiki' || e.spike >= 1.5));
  const sourceCount = counted.filter((e) => !e.local).length + (counted.some((e) => e.local) ? 1 : 0);
  const kymOwn = ev.some((e) => e.key === 'kym' && KYM_OWN_ROLES.has(e.role));
  const rowEv = g.ev.filter((e) => e.rowKey);
  const dictionaryOnly = rowEv.length > 0 && rowEv.every((e) => e.role === 'dictionary');
  // slang lists, dictionary additions and word columns only: the word is known, not having a moment ("From rizz to unc and 67")
  const roundupOnly = rowEv.length > 0 && rowEv.every((e) => LIST_ROLES.has(e.role)) && !extra.length;
  const hasKym = ev.some((e) => e.key === 'kym');
  const seenEv = [...rowEv, ...extra];
  const times = (seenEv.length ? seenEv : ev).map((e) => e.t).filter(Number.isFinite);
  const first = times.length ? Math.min(...times) : now;
  const last = times.length ? Math.max(...times) : now;
  const since = lookup && lookup.since && Number.isFinite(lookup.since.t) ? lookup.since.t : Infinity;
  const origin = Math.min(first, originHint.t, originHint.viral ? Infinity : since);
  const established = now - origin > ESTABLISHED_DAYS * DAY;
  // an old explainer Google News re-dated into the window ("What is the F74 trend on TikTok?", 2022): the window's only rows are one
  // outlet's explainers, no other outlet named the term this fortnight, and headlines naming it go back months
  const rowKeys = new Set(rowEv.map((e) => e.key));
  const redated = rowEv.length > 0 && rowKeys.size === 1 && rowEv.every((e) => e.role === 'asked' || e.role === 'explainer') && !extra.length &&
    now - Math.min(since, originHint.t) > REDATED_DAYS * DAY;
  // this week's own coverage: distinct sources in the last 7 days that wrote about the term, not a list naming it
  const freshNonRoundup = new Set(ev.filter((e) => (e.rowKey || e.extra) && now - e.t <= FRESH_DAYS * DAY && !LIST_ROLES.has(e.role)).map((e) => e.key)).size;
  // ... and this fortnight's (Mogging: Dexerto, TODAY and Firstpost explained it in the last 14 days, none of them this week)
  // (the store's window: 14 days back from the start of today)
  const inWindow = (e) => e.t >= dayOf(now) - WINDOW_DAYS * DAY;
  const windowNonRoundup = new Set(ev.filter((e) => (e.rowKey || e.extra) && inWindow(e) && !LIST_ROLES.has(e.role)).map((e) => e.key)).size;
  // outlets that explained it this fortnight ("What does 'mogging' mean on TikTok?"): people are asking about it now
  const windowExplainers = new Set(ev.filter((e) => e.rowKey && inWindow(e) && (e.role === 'asked' || e.role === 'explainer')).map((e) => e.key)).size;
  // ... the national ones: local stations count once together ("Sleepmaxxing": one segment on ABC10 and fox61 is one source)
  const explainerEv = ev.filter((e) => e.rowKey && inWindow(e) && (e.role === 'asked' || e.role === 'explainer'));
  const nationalExplainers = new Set(explainerEv.filter((e) => !e.local).map((e) => e.key)).size + (explainerEv.some((e) => e.local) ? 1 : 0);
  const recency = 0.5 + 0.5 * Math.pow(0.5, Math.max(0, (now - last) / DAY) / FRESH_HALF_LIFE_DAYS);
  const isNew = !established && !redated && now - first <= NEW_DAYS * DAY;
  const evergreen = established || g.seqs.some((s) => EVERGREEN_KEYS.has(s.join('')));
  const score = heat * recency * (isNew ? NEW_BONUS : 1) * (evergreen && heat < HEAT_HOT ? EVERGREEN_MULT : 1) *
    (dictionaryOnly ? DICTIONARY_ONLY_MULT : 1) * (redated ? REDATED_MULT : 1);
  // direction: whether more independent sources are writing now than two days ago; news stops re-covering a meme after a day or
  // two, so a term still covered this week is steady, not fading. A Wikipedia page's daily views say it better when there is one.
  const recentKeys = new Set(ev.filter((e) => now - e.t < 2 * DAY).map((e) => e.key));
  const prevKeys = new Set(ev.filter((e) => now - e.t >= 2 * DAY && now - e.t < 4 * DAY).map((e) => e.key));
  const base = wikiDirection(lookup) || (recentKeys.size >= 2 && recentKeys.size > prevKeys.size ? 'rising' : now - last <= 5 * DAY ? 'steady' : 'fading');
  // a term that began this week and is still covered is "new", not "steady"
  const direction = (now - first < 2 * DAY || (now - origin <= NEW_DAYS * DAY && base === 'steady')) && !established && !redated ? 'new' : base;
  const level = heat >= HEAT_HOT || (families >= 3 && heat >= HEAT_HOT - 1.5) ? 'hot' : heat >= HEAT_WARM ? 'warm' : 'mild';
  const searchSpike = ev.some((e) => (e.role === 'search' && !e.personRow && e.volume >= SEARCH_SPIKE_VOLUME) || (e.role === 'wiki' && e.spike >= 2));
  // an established term covered again: "back" when searches or sources are surging, else "still big"
  const status = established ? (searchSpike || direction === 'rising' ? 'back' : 'still big') : direction;
  const labels = [...byKey.values()].sort((a, b) => b.w - a.w).map((e) => e.label).filter(Boolean);
  const older = now - origin > WINDOW_DAYS * DAY; // began before this fortnight ("How I Feel In My Hometown", late August)
  // Know Your Meme's editors picked it: one of the week's biggest memes this week ("Wawario and Wawaluigi" led the 9-25 roundup), or
  // an explainer they wrote this fortnight ("What's The 'Parent Split-Face Trend'?", 9-18, for a trend that began in August)
  const kymPick = ev.some((e) => (e.role === 'kym-roundup' && now - e.t <= FRESH_DAYS * DAY) ||
    (e.role === 'kym-explainer' && e.rowKey && now - e.t <= WINDOW_DAYS * DAY));
  return { heat, families, sourceCount, kymOwn, hasKym, dictionaryOnly, roundupOnly, redated, freshNonRoundup, windowNonRoundup, windowExplainers, nationalExplainers, first, last, origin, established, older, kymPick,
    score, direction, status, level, searchSpike, sources: [...new Set(labels)].slice(0, 8), evergreen };
}
/**
 * The main list's floor: two independent sources, a Know Your Meme pick, or a search spike. Lists alone never pass it (a dictionary
 * addition or "From rizz to unc and 67" proves the word is real, not that it is a moment), nor does a re-dated old explainer. A word
 * that began before this fortnight needs a search spike or sources writing about it this week: three when it is established (over
 * 45 days old), two before that (or a Know Your Meme editors' pick: this week's roundup, or an explainer this fortnight).
 */
const passesFloor = (r) => stillBig(r) || (!r.dictionaryOnly && !r.roundupOnly && !r.redated && (r.sourceCount >= 2 || r.kymOwn || r.searchSpike) &&
  (r.searchSpike || r.freshNonRoundup >= (r.established ? FRESH_MIN : r.older ? FRESH_MIN_OLDER : 0) || (r.older && !r.established && r.kymPick)));
/**
 * An established word still in the news lists as "still big": three sources explained it this fortnight (Mogging), or five
 * sources reported its dictionary addition (Looksmaxxing entering Merriam-Webster).
 */
const STILL_BIG_SOURCES = 3;
const DICTIONARY_BIG_SOURCES = 5;
const STILL_BIG_EXPLAINERS = 2;
const stillBig = (r) => r.established && !r.redated && (r.windowNonRoundup >= STILL_BIG_SOURCES || r.windowExplainers >= STILL_BIG_EXPLAINERS ||
  (r.dictionaryOnly && r.sourceCount >= DICTIONARY_BIG_SOURCES));
// fresh terms and comebacks lead; established terms merely covered again ("still big") follow them
const tierOf = (r) => (r.status === 'still big' ? 1 : 0);
// an entry someone asked about in the window ("What does 'A Day in My Life' mean?", a KYM explainer), so it is worth looking up
// (a mere "... trend" in a headline is not: "Can Giannis Snap a Miami Heat Superstar Trend?")
const explained = (r) => r.g.ev.some((e) => e.rowKey && (e.role === 'asked' || e.role === 'kym-explainer'));

const dayOf = (t) => Math.floor(t / DAY) * DAY;
/** Other names the entry was merged from ("salt stepping" is also "Epsom Salt Foot Stomping"), not mere spellings of the shown one. */
function alsoCalled(r) {
  const shown = termKey(r.term.replace(/…$/, ''));
  const seen = new Set([shown]);
  return [...r.g.surfaces.entries()].sort((a, b) => b[1].w - a[1].w).map(([s]) => s).filter((s) => {
    const k = termKey(s);
    if (seen.has(k) || shown.includes(k) || k.includes(shown)) return false;
    seen.add(k);
    return true;
  }).slice(0, 2);
}
/**
 * One output row. A new term: since = the day it began, daysAgo = days since then. An established one: since = the year it began
 * (the month when that was this year), daysAgo = days since sources last wrote about it. status: new|rising|steady|fading, or back|still big.
 */
function wordOut(r, now) {
  // an old word shows when it began as a year ("2023"), or a month when that was this year ("2026-07"), not "1040 days"
  const iso = new Date(r.origin).toISOString();
  const since = !r.established ? iso.slice(0, 10) : iso.slice(0, 4) === new Date(now).toISOString().slice(0, 4) ? iso.slice(0, 7) : iso.slice(0, 4);
  // daysAgo counts from the same origin as `since` (an established term: when sources last wrote about it, and `lastSeen` says so)
  return { term: r.term, alsoCalled: alsoCalled(r), kind: r.kind, meaning: r.meaning ? r.meaning.text : null, meaningFrom: r.meaning ? r.meaning.from : null,
    since, daysAgo: Math.max(0, Math.round((dayOf(now) - dayOf(r.origin)) / DAY)),
    ...(r.established ? { lastSeenDaysAgo: Math.max(0, Math.round((dayOf(now) - dayOf(r.last)) / DAY)) } : {}),
    heat: r.level, status: r.status, whyNow: r.whyNow ? r.whyNow.text : null, sources: r.sources, searchSpike: r.searchSpike, ...(r.g.sensitive ? { sensitive: true } : {}),
    // (the collector's timed evidence: when the term began, and every dated source that named it)
    meta: { originT: r.origin, established: !!r.established, lastT: r.last, listedBy: 'words',
      own: r.g.ev.filter((e) => Number.isFinite(e.t) && e.role !== 'search' && e.role !== 'wiki').map((e) => ({ t: e.t, title: e.item ? e.item.title : null, outlet: e.label || null,
        fam: e.item ? e.item.fam : e.role === 'mention' ? 'gnews' : e.role })),
      searches: r.g.ev.filter((e) => e.role === 'search' && Number.isFinite(e.t)).map((e) => ({ t: e.t, volume: e.volume || 0 })) } };
}

const WHY_NOW_DAYS = 10;
const DICTIONARY_NEWS = /\b(dictionar\w*|merriam|new words|words added|added to)\b/i;
const dictNews = (x) => x.e.role === 'dictionary' || DICTIONARY_NEWS.test(x.it.title);
const WHY_NOW_MAX_WORDS = 16;
// what it is, not why it is in the news: a definition, a list of slang, a roundup
const DEFINING_ROLES = new Set(['asked', 'explainer', 'kym-explainer', 'kym-entry', 'kym-sub', 'kym-roundup', 'roundup', 'column']);
const SENSITIVE_NEWS = /\b(charged|arrest\w*|rape\w*|sexual(?:ly)? assault\w*|indict\w*|died|dies|death|killed|murder\w*|suicid\w*|overdose)\b/i;
/**
 * Why the word is in the news this week: the newest outlet headline naming it that is not a definition or a slang list (a dictionary
 * addition, an arrest, a celebrity using it), as written, in sentence case. Null when there is none.
 */
const WHY_NOW_SAID = 0.6;
/** Most of a line's content words are already in the meaning. */
function saysAgain(text, meaning) {
  const content = (s) => W.words(s).filter((w) => w.length > 2 && !W.STOP.has(w)).map(W.stem);
  const said = new Set(content(meaning));
  const st = content(text);
  return st.length > 0 && st.filter((s) => said.has(s)).length / st.length >= WHY_NOW_SAID;
}

// a meme word right after a one-word name says the headline means the meme ("Dakota Johnson & Josh Hartnett react to Verity meme")
const WHY_NOW_CUE = new Set(['meme', 'memes', 'trend', 'trends', 'sound', 'sounds', 'audio', 'challenge', 'challenges']);
const WHY_NOW_CUE_REACH = 2;
/**
 * The headline names the term: one of its names of two words or more, the listed term itself ("Looksmaxxing"), or a one-word name
 * with a sign it means the meme (a meme word, or a word of the meaning beside it). One plain word alone is another story: "Anne
 * Hathaway banned from ‘Hot Ones’ on verity press tour" is the film, "... here to save parents these holidays" is not the split-face trend.
 */
function namesTerm(title, seqs, own, meaningStems) {
  const ws = W.words(title);
  const stems = ws.map(termStem);
  const cueAfter = (sq) => stems.some((s, i) => s === sq[0] && ws.slice(i + 1, i + 1 + WHY_NOW_CUE_REACH).some((w) => WHY_NOW_CUE.has(w)));
  return seqs.some((sq) => hasSeq(stems, sq) && (sq.length > 1 || sq.join(' ') === own || cueAfter(sq) ||
    ws.some((w, i) => w.length > 2 && !W.STOP.has(w) && !W.GENERIC.has(w) && !sq.includes(stems[i]) && meaningStems.has(W.stem(w)))));
}

function whyNowOf(r, now, lex) {
  const seqs = r.g.seqs.filter((sq) => sq.length);
  const own = termSeq(r.term.replace(/…$/, '')).join(' ');
  // (a meme word, "trend" or "viral", is in every meaning: it ties no headline to this one)
  const meaningStems = new Set(r.meaning ? W.words(r.meaning.text).filter((w) => w.length > 2 && !W.STOP.has(w) && !W.GENERIC.has(w)).map(W.stem) : []);
  const rows = r.g.ev.filter((e) => e.rowKey && !DEFINING_ROLES.has(e.role) && e.key.startsWith('news:') && now - e.t <= WHY_NOW_DAYS * DAY && e.t <= now + DAY)
    // (a crime in the news is said, flagged: no content filter; only profanity keeps a headline out)
    .map((e) => ({ e, it: e.item })).filter((x) => x.it && !X.PROFANE.test(x.it.title.replace(new RegExp(SENSITIVE_NEWS.source, 'gi'), ' ')) &&
      namesTerm(x.it.title, seqs, own, meaningStems) && !/\?/.test(x.it.title))
    // news first, a dictionary addition after; the newest first
    .sort((a, b) => Number(dictNews(a)) - Number(dictNews(b)) || b.e.t - a.e.t);
  for (const { it } of rows) {
    if (/\b(explained|what is|what does|what are|meaning|means)\b/i.test(it.title)) continue;
    // "Humor vs. Horror: the Cat in the Hat’s influence in recent arrests": the part after a short lead-in
    const parts = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '').split(/:\s+/);
    let t = (parts.length > 1 && parts[0].split(/\s+/).length < 4 ? parts.slice(1).join(': ') : parts[0]).trim();
    // (its first sentence: "Fat Bear Week Is Back. Meet Some Of Our Favorite Contenders" -> "Fat Bear Week is back")
    t = t.split(/(?<=[a-z0-9’”)])[.!?]\s+(?=\p{Lu})/u)[0];
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (W.isTitleCase(t.split(/\s+/)) && lex) t = W.recase(t, lex, true);
    const ws = t.split(/\s+/);
    if (ws.length < 4 || ws.length > WHY_NOW_MAX_WORDS) continue;
    // (a line that says the meaning again, "Fat Bear Week returns to crown Alaska’s fattest bear", says nothing about why now)
    if (r.meaning && saysAgain(t, r.meaning.text)) continue;
    return { text: /[.!?]$/.test(t) ? t : `${t}.`, from: it.outlet, sensitive: SENSITIVE_NEWS.test(it.title) };
  }
  return null;
}

/**
 * Step 4: meanings, heat and rank. The main list needs a meaning of quality 3+ and the source floor; "bubbling" holds up to 10
 * entries under 45 days old that do not list yet: one source so far, or an entry someone asked about (a KYM pick or a "what does X
 * mean?") still without a usable meaning. Returns both, plus what the moments list needs to skip them.
 */
function finish(groups, lookups, now, lex) {
  const rows = groups.map((g) => {
    const lookup = lookups.get(g.key);
    const kind = kindOfGroup(g, lookup);
    const originHint = originOfGroup(g, lookup, now);
    const s = scoreGroup(g, lookup, now, originHint);
    const term = displayOf(g, kind, lex, lookup);
    if (pageSensitive(lookup)) g.sensitive = true;
    return { g, term, kind, meaning: bestMeaning(g, lookup, lex, kind, termKey(term.replace(/…$/, ''))), offPage: offPage(lookup), originHint, ...s };
  }).map((r) => ({ ...r, rank: r.score * (KIND_BOOST[r.kind] || 1) }));
  // the meaning is checked too: "State-Mandated Girlfriend — controversial incel concept" is not a word to film
  // what the sources said about it counts too, used as its meaning or not ("... The Controversial Incel Concept And Memes Explained")
  // (a controversy is a moment; a slur, a politician or an unsafe line said about it keeps it off; anything else only flags it)
  const saidUnsafe = (g) => [...g.own].some((it) => SENSITIVE_TERM.test(it.title) || MOMENT_TERM.test(it.title));
  rows.forEach((r) => { if (r.g.defs.some((d) => !safeMeaning(d.text)) || (r.meaning && !safeMeaning(r.meaning.text))) r.g.sensitive = true; });
  // (a person's name is a moment's subject, never a word: "Lesley-Anne Scorgie")
  const personName = (t) => /^\p{Lu}[\p{Ll}'’]+(?:-\p{Lu}[\p{Ll}]+)? \p{Lu}[\p{L}'’-]+$/u.test(t) && t.split(/[\s-]/).slice(0, 2).some((p) => W.isFirstName(p.toLowerCase())) && !r0KymName(t);
  const r0KymName = (t) => rows.some((r) => r.term === t && r.hasKym);
  const candidates = rows.filter((r) => r.score >= WORDS_MIN_SCORE && safeTerm(r.term) && !r.offPage && !saidUnsafe(r.g) && !personName(r.term) && !namedWork(r.g, r.term) &&
    (!r.meaning || !SENSITIVE_TERM.test(r.meaning.text)))
    .sort((a, b) => b.rank - a.rank);
  // a term that began weeks ago and only one source still names this fortnight is old news to a regular (Wawario, 34 days); one
  // source alone lists only while the term is new and not fading (Know Your Meme's pick "Happy day, Ronaldo day", 3 days)
  // (Know Your Meme's weekly roundup picking it this week is the week's own proof: Wawario, the IShowSpeed GTA 4 edit)
  const roundupPick = (r) => r.g.ev.some((e) => e.role === 'kym-roundup' && now - e.t <= FRESH_DAYS * DAY && e.t <= now + DAY);
  const stale = (r) => !r.searchSpike && !stillBig(r) && !roundupPick(r) && ((now - r.origin > STALE_DAYS * DAY && r.windowNonRoundup < 2) ||
    (r.sourceCount < 2 && (r.direction === 'fading' || now - r.origin > NEW_DAYS * DAY)) || (r.older && r.direction === 'fading' && r.windowNonRoundup < 2));
  // an established term (begun over 45 days ago) lists only with a dated reason it is talked about now: a search spike, a news
  // headline naming it this week (its why-now: Looksmaxxing's streamer charged), or two national outlets explaining it this fortnight
  // (Mogging: Dexerto and TODAY). Local stations running one segment are one source ("Sleepmaxxing": ABC10 and fox61), and a plain
  // word unrelated headlines happen to use is no reason ("Tracksuit": a Prada tracksuit, a branding event)
  const current = (r) => !r.established || r.searchSpike || r.nationalExplainers >= STILL_BIG_EXPLAINERS || !!whyNowOf(r, now, lex);
  const listed = candidates.filter((r) => r.meaning && passesFloor(r) && !stale(r) && current(r)).slice(0, WORDS_MAX).sort((a, b) => tierOf(a) - tierOf(b) || b.rank - a.rank);
  // lists, re-dated explainers, established words and long-known slang ("W", "rizz") never bubble up, nor does a term that began
  // before this fortnight and is fading ("How I Feel In My Hometown", late August): bubbling is what may break out next
  // (entries with a meaning first: they are what the owner can read; the rest wait for a lookup)
  // (only with a meaning: an entry without one is a lookup target, not something to show)
  // (a Know Your Meme entry under 45 days old bubbles even while its coverage fades: its meaning is sourced and it may break out)
  const kymFresh = (r) => r.meaning && r.meaning.from === 'Know Your Meme' && now - r.origin <= ESTABLISHED_DAYS * DAY;
  const bubbling = candidates.filter((r) => !listed.includes(r) && !r.dictionaryOnly && !r.roundupOnly && !r.redated && !r.evergreen &&
    (kymFresh(r) || (!(r.older && r.direction === 'fading') && !stale(r))) && r.meaning && (!passesFloor(r) || stale(r))).sort((a, b) => b.rank - a.rank)
    .slice(0, BUBBLING_MAX);
  // the lookups still read the entries waiting for a meaning
  const lookupRows = candidates.filter((r) => !r.meaning && !r.dictionaryOnly && !r.roundupOnly && !r.redated && !r.evergreen && (r.hasKym || explained(r)));
  // what the moments list must not carry: the items of re-dated explainers
  const redatedItems = new Set(rows.filter((r) => r.redated).flatMap((r) => [...r.g.items]));
  for (const r of [...listed, ...bubbling]) {
    r.whyNow = whyNowOf(r, now, lex);
    // two or more of this fortnight's headlines naming it are about a crime or a death: flagged ("looksmaxxing" influencer charged)
    const recent = ((lookups.get(r.g.key) || {}).since || {}).recent || [];
    if (recent.filter((x) => x.t >= now - WINDOW_DAYS * DAY && SENSITIVE_NEWS.test(x.title || '')).length >= 2) r.g.sensitive = true;
    // a word back in the news for a crime or a tragedy ("Looksmaxxing": its best-known streamer charged with rape) is flagged
    if (r.whyNow && r.whyNow.sensitive) r.g.sensitive = true;
  }
  return { words: listed.map((r) => wordOut(r, now)), bubbling: bubbling.map((r) => wordOut(r, now)), listed, bubblingRows: bubbling, lookupRows, candidates, all: rows,
    redatedItems };
}

/**
 * A song, video or film title ("Taylor Swift's ‘Patient Zero’ music video", "‘Patient Zero’ lyrics") is a release, a moment's
 * subject, never a word: two of its sources and at least a third of those that quote it call it the work's title, and none calls it
 * a trend, a meme, a challenge or a sound.
 */
const WORK_NOUN = 'song|single|album|ep|music video|video|lyrics|film|movie|trailer|documentary|series|show|era';
function namedWork(g, term) {
  const t = term.replace(/…$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, "['’]");
  const quoted = new RegExp(`[‘'“"]${t}[’'”"]`, 'i');
  const asWork = new RegExp(`['’]s\\s+(?:new\\s+)?(?:(?:${WORK_NOUN})\\s+)?[‘'“"]${t}[’'”"]|[‘'“"]${t}[’'”"],?\\s+(?:${WORK_NOUN})\\b`, 'i');
  const titles = [...g.items].map((it) => W.curlQuotes(it.title)).filter((s) => quoted.test(s));
  const works = titles.filter((s) => asWork.test(s)).length;
  return works >= 2 && works * 3 >= titles.length && !titles.some((s) => /\b(?:trend|meme|challenge|sound|slang|dance craze)s?\b/i.test(s));
}

/**
 * True when a moment cluster is already shown under Words & trends: a meme/format that names a listed term, or any story two of
 * whose items are that term's own sources ("Taylor Swift's 'That's my husband!' becomes a meme" = the catchphrase entry).
 */
function coversCluster(c, listed, formatLike) {
  for (const r of listed) {
    const shared = c.items.filter((i) => r.g.items.has(i)).length;
    // (half the story's items: a word two of whose sources sit in a big story does not cover all of it)
    if (shared >= 2 && shared * 2 >= c.items.length) return true;
    const named = c.items.some((i) => r.g.seqs.some((s) => s.join('').length >= 4 && hasSeq(W.words(i.title).map(termStem), s)));
    if (formatLike && (shared >= 1 || named)) return true;
    // (a story whose own headline is the entry's, "Taylor Swift's ‘That's my husband!’ at Chiefs game becomes a meme", is its coverage
    // however many other items its chain picked up)
    if (shared >= 2 && c.headline && r.g.seqs.some((s) => s.join('').length >= 4 && hasSeq(W.words(c.headline).map(termStem), s))) return true;
  }
  return false;
}

/**
 * The reverse: a moment cluster that quotes a catchphrase or sound among the Words & trends candidates ("Deeper meaning behind
 * Robert Pattinson's 'you see how this looks, right' Primetime quote" in the Chris Hansen story) is that entry's coverage, so its
 * outlets move into the entry as mentions (it can then list, and the story is not repeated among the moments once it does). Only
 * lines of three or more words that read as said, so a shared plain word never pulls a story in. Returns whether any entry gained
 * sources.
 */
function absorbClusters(rows, clusters, outletKeyOf) {
  let changed = false;
  // a catchphrase whose Know Your Meme meaning names a listed story's film or person ("You see how this looks, right?": Robert
  // Pattinson as Chris Hansen in Primetime) shares that story's search surge: people searching the film are searching its line
  for (const r of rows) {
    if ((r.kind !== 'phrase' && r.kind !== 'sound') || !r.meaning || r.meaning.from !== 'Know Your Meme' || r.g.ev.some((e) => e.key === 'search')) continue;
    const mt = ` ${W.words(r.meaning.text).join(' ')} `;
    for (const c of clusters) {
      const names = [c.topEnt, c.topPseudo ? c.topPseudo.slice(2) : null].filter((n) => n && n.length > 3 && (n.includes(' ') || !W.inDict(n)));
      if (!names.some((n) => mt.includes(` ${n} `))) continue;
      const tr = c.trends.filter((x) => x.strength === 1 && x.tr.volume >= SEARCH_SPIKE_VOLUME).map((x) => x.tr).sort((a, b) => b.volume - a.volume)[0];
      if (!tr) continue;
      r.g.ev.push({ key: 'search', w: 1, t: tr.start, role: 'search', label: 'Google Trends', volume: tr.volume });
      changed = true;
      break;
    }
  }
  for (const r of rows) {
    if (r.kind !== 'phrase' && r.kind !== 'sound') continue;
    const seqs = r.g.seqs.filter((sq) => sq.length >= 3);
    const said = [...r.g.surfaces.keys()].some((sf) => X.QUOTE_LIKE.test(sf) && termSeq(sf).length >= 3);
    if (!seqs.length || !said) continue;
    for (const c of clusters) {
      if (!c.items.some((i) => seqs.some((sq) => hasSeq(W.words(i.title).map(termStem), sq)))) continue;
      // (only the items that quote it themselves: a VMAs article is no mention of "That's my husband")
      for (const it of c.items.filter((i) => seqs.some((sq) => hasSeq(W.words(i.title).map(termStem), sq)))) {
        if (r.g.rowKeys.has(it.key) || !safeForWords(it)) continue;
        r.g.ev.push(evidenceOf(it, 'mention', outletKeyOf));
        r.g.rowKeys.add(it.key);
        r.g.items.add(it);
        changed = true;
      }
    }
  }
  return changed;
}

module.exports = { collect, finish, coversCluster, absorbClusters, termKey, parseWikiBatch, parseWikt, sinceOf, safeForWords,
  // for words-targets.js
  scoreGroup, kindOfGroup, passesFloor, explained, safeTerm };
