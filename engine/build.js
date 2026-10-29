'use strict';
/*
 * The collector's engine: the Ideas pipeline (a COPY of scripts/ideas-proto, free to diverge: ios/IDEAS-FEED.md A1) as one call with
 * no network and no files. The collector fetches (lib/), upserts every reply into the store (engine/ingest.js) and calls build() once
 * a cycle: the words and the moments are built once, the talking points and the one hot list once per audience ("My audience" only
 * changes how searches are weighed and how the page is laid out).
 *
 * What differs from the prototype's ideas.js: no command line, no fetching, no raw folder (the store carries the talking points'
 * Trends rows as the app's does; the Wikipedia lists, the crazes and the roster are handed in), "now" is an argument, and every
 * listed row carries `meta`: the timed evidence the collector measures (lib/history.js).
 */
const MEMO = require('./memo');
const W = require('./wording');
const S = require('./sources');
const ST = require('./store');
const R = require('./rules');
const H = require('./headline');
const C = require('./cluster');
const WD = require('./words');
const WT = require('./words-targets');
const X = require('./words-extract');
const HL = require('./hot-list');
const STY = require('./story');
const SW = require('./story-why');
const TS = require('./talk-sources');
const TP = require('./talking-points');
const TC = require('./talk-candidates');
const { sum, median, stripParen, contains, uniqByKey, outletKey } = require('./util');

const { words, stem, uniq, STOP, GENERIC, TREND_NOISE } = W;
const { RE } = R;
const { squeeze, utcDay, TOKEN_IDF_MIN } = C; // days are UTC calendar days: "3 days ago" is the same on every device


const DAY = S.DAY;
const WINDOW_DAYS = 14;
const TOP_N = 40; // candidates for the story step, which vetoes the stale and thin ones
const MAX_PER_ENTITY = 1;
const REDDIT_TOP_RANK = 15; // per-day rank that counts as "top of Reddit today"
const REDDIT_TOP_RANK_CHAT = 3; // r/popculturechat and r/entertainment: only their top three a day are a viral signal on their own
const REDDIT_POPULAR_GATE_RANK = 50; // r/popular's top 50 is enough to let a sports moment through
const REDDIT_POPULAR_POP_RANK = 5; // r/popular's top five, with an outlet calling it viral, is pop culture whatever its subject
// Format trends (memes, TikTok trends) now lead the "Words & trends" list, so no moment slots are reserved for them; one that
// is not listed there can still make the moments on merit.
const TREND_QUOTA = 0;
const HEAT_MIN_OUTLETS = 2; // "rising" needs the last 48 h to come from two separate outlets
const VAGUE_HEADLINE_MULT = 0.7; // a story whose best headline is only "X responds to viral video" says too little to film
const MIN_OUTLETS_FOR_MOMENT = 3;
const WIKI_MIN_VIEWS = 40000;
const WIKI_MIN_SPIKE = 3;
const SEARCH_SPIKE_VOLUME = 20000;
const SEARCH_SURGE_VOLUME = 50000; // a keyword search surge this big, on the story's own words, is proof on its own with 3+ outlets
const RECENCY_HALF_LIFE_DAYS = 7;
// the listed order: a moment's heat and a three-day half-life on its newest coverage
const HEAT_ORDER = { rising: 1, 'second wave': 1, peak: 0.85, fading: 0.6 };
const ORDER_HALF_LIFE_DAYS = 3;
// what leads is also what a creator can film: a moment the card itself calls a meme, a clip gone viral or a troll lifts its story; a
// death, a crime or an assault (listed, no content filter, but nobody films a bit about it) and a story only British and Irish
// press and searches carry sink below the moments everyone is copying
const MEME_SHAPED = /\b(?:becom\w*|became)\s+(?:an?\s+)?(?:instant\s+|viral\s+|internet\s+|hilarious\s+|new\s+)*meme\b|\b(?:goes|went|going|gone)\s+viral\b|\bmeme\s+fuel\b|\btroll(?:s|ed|ing)?\b|\brecreat\w*\b[^,;]{0,40}\bmeme\b|\bhits?\s+[\d.,]+\s*(?:k|m|million)?\s+views\b/i;
const MEME_ORDER = 1.5;
const GRAVE_ORDER = 0.6;
const GRAVE_WHY = new Set(['tragedy', 'crime', 'violence']);
const REGIONAL_ORDER = 0.6;
const REGIONAL_SHARE = 0.75;
/** The story's outlets and searches are British or Irish only: three of four outlets, and no US search. */
function regionalOnly(st) {
  // (a re-host, AOL's or inkl's copy, is from nowhere in particular)
  const items = st.unit.clusters.flatMap((x) => x.items).filter((i) => i.fam !== 'reddit' && i.fam !== 'bluesky' && i.fam !== 'kym' && i.outlet &&
    !R.REHOST.test(i.outlet));
  const outlets = [...new Set(items.map((i) => outletKey(i.outlet)))];
  if (outlets.length < 2) return false;
  const uk = outlets.filter((k) => items.some((i) => outletKey(i.outlet) === k && R.UK_OUTLET.test(i.outlet))).length;
  const usSearch = st.unit.clusters.some((c) => c.trends.some(({ tr }) => tr.geo === 'US'));
  return !usSearch && uk >= REGIONAL_SHARE * outlets.length;
}
/** The order factor of what the card shows: a meme-shaped moment line lifts it, a grave story or a regional one sinks it. */
function filmableOrder(st) {
  const lines = [st.headline, st.moment].filter(Boolean).join(' | ');
  const why = sensitiveOf(st).sensitiveWhy;
  return (MEME_SHAPED.test(lines) ? MEME_ORDER : 1) * (GRAVE_WHY.has(why) ? GRAVE_ORDER : 1) * (regionalOnly(st) ? REGIONAL_ORDER : 1);
}

let NOW = Date.now();

// ---------- small helpers ----------
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const RESTAGE_ALL = new RegExp(R.RE.restage.source, 'gi');

// ---------- step 2: clean and filter ----------
function cleanTitle(raw) {
  let s = raw.title;
  if (raw.publisher && s.endsWith(' - ' + raw.publisher)) s = s.slice(0, -(raw.publisher.length + 3));
  // "MEMES EXPLAINED! | LA PEACE": that series names its meme after the bar, so the bar stays
  if (!/^memes explained!?\s*\|/i.test(s)) s = s.replace(/\s+\|\s+[^|]+$/, '');
  return s.replace(/\s*\((updating live!?|exclusive|video|photos?|watch)\)/gi, '').trim();
}

/** The outlet that published an item: the publisher for aggregated news, the feed's own name otherwise. */
function outletOf(raw) {
  if ((raw.fam === 'gnews' || raw.fam === 'trends') && raw.publisher) return raw.publisher.replace(/\s+\|\s+.*$/, ''); // "Indy100 | News"
  return raw.label;
}
/** Interview accounts ("X says his kid roasted him") do not count as footage of a moment. */
const toldFirst = (title, re) => { const t = title.search(RE.told); const c = title.search(re); return t >= 0 && c >= 0 && t < c; };

/**
 * No content filter (the owner's rule: anything popular shows): tragedy, crime, violence and unsafe items are kept with a
 * `sensitive` flag instead of dropped; a story made of them lists only with strong proof it is popular (sensitiveProof). Routine
 * political news still stays out of the moments (a political moment, a viral one, always could list): it is the story step's context.
 */
const SENSITIVE_DROPS = new Set(['unsafe', 'violence', 'tragedy', 'crime', 'politics']);
/** The first sensitive topic an item is about, or null. */
function sensitiveReason(it) {
  const text = it.desc ? `${it.title} ${it.desc}` : it.title;
  const safety = it.kymDesc ? `${text} ${it.kymDesc}` : text;
  if (RE.unsafe.test(safety) || RE.menace.test(it.title)) return 'unsafe';
  if (RE.violent.test(safety)) return 'violence';
  if (RE.tragedy.test(safety)) return 'tragedy';
  if (RE.legal.test(it.title)) return 'crime';
  return null;
}

/**
 * Crypto news is not pop culture, but a meme or a persona a token rides on still is: no content filter, so only a title about the coin
 * itself drops ("Who is Fenette Zelliss? AI character behind multimillion-dollar meme coin sparks fake persona trend" stays, and so does
 * Know Your Meme's entry whose definition names the token).
 */
const cryptoItem = (it) => RE.crypto.test(it.title) && !RE.coinMeme.test(it.title.replace(RE.cryptoAll, ' '));

/**
 * Returns why an item is dropped, or null to keep it. Explicit viral proof or a meme-only source survives topic filters. With
 * `keepSensitive`, the sensitive topics are not reasons (the item is flagged instead, see SENSITIVE_DROPS).
 */
function dropReason(it, keepSensitive = false) {
  const text = it.desc ? `${it.title} ${it.desc}` : it.title;
  // what is never an idea is checked on the KYM definition too ("an anniversary meme ... assassination")
  const safety = it.kymDesc ? `${text} ${it.kymDesc}` : text;
  const viral = it.viral || it.inherent;
  // "What is the X trend? ... explained" is the best proof a format exists; a lyric theory is a trend too
  const trendish = viral || RE.trendWord.test(it.title);
  const entertainmentSource = ['celeb', 'reddit', 'kym'].includes(it.fam) || String(it.src).startsWith('gn-ent');
  if (RE.spam.test(it.title) || RE.govDomain.test(it.publisherUrl || '') || (RE.eduDomain.test(it.publisherUrl || '') && RE.eduSpam.test(it.title))) return 'spam';
  if (R.PUBLISHER_BLOCK.test(it.publisher || '') || R.PUBLISHER_BLOCK.test(it.publisherUrl || '')) return 'publisher';
  if (cryptoItem(it)) return 'crypto';
  if (!keepSensitive && (RE.unsafe.test(safety) || RE.menace.test(it.title))) return 'unsafe';
  if (!keepSensitive && RE.violent.test(safety)) return 'violence';
  if (RE.techBiz.test(it.title) && !it.inherent) return 'tech-business';
  if (!keepSensitive && RE.tragedy.test(safety)) return 'tragedy';
  if (RE.evergreen.test(it.title)) return 'evergreen';
  if (RE.satire.test(it.title) || (it.political && RE.satireShow.test(it.title))) return 'satire';
  if (RE.gossip.test(text)) return 'gossip';
  if (RE.paparazzi.test(text) && !it.viral) return 'gossip';
  if (RE.service.test(it.title) && !trendish) return 'service';
  if (RE.question.test(it.title) && !RE.explainer.test(it.title) && !trendish) return 'question';
  if (RE.science.test(it.title) && !viral) return 'science';
  if (!keepSensitive && it.political && !viral && !entertainmentSource && !RE.politicalMoment.test(it.title)) return 'politics';
  if (RE.hardNews.test(text) && !viral) return 'hard-news';
  if (!keepSensitive && RE.legal.test(it.title) && !viral) return 'crime';
  if (RE.sportsDry.test(it.title) && !viral && !it.moment) return 'sports';
  if (it.industry && !viral && !it.clip) return 'industry';
  return null;
}

const KYM_OUTLET = /^(?:know ?your ?meme\b|(?:trending\.)?knowyourmeme\.com$)/i;
// a format people can copy scores ahead of a meme that is only a persona or a one-off video
const FORMAT_COPY = /\b(trend|challenge|dance|filter|format|template|sound|edits?)\b/i;
const FORMAT_COPY_BONUS = 1;

function prepare(raw) {
  // a Know Your Meme article is KYM's editorial pick whichever feed delivered it (Google News carries their explainers)
  // (its trend and meme write-ups only: KYM's photo and submission pages show up in the same searches)
  const title = cleanTitle(raw); // without the " - Know Your Meme" suffix, whose "Meme" says nothing
  if (raw.fam === 'gnews' && KYM_OUTLET.test(raw.publisher || '') && (/\b(trends?|memes?|challenge)\b/i.test(title) || RE.explainer.test(title))) {
    raw = { ...raw, fam: 'kym', label: 'Know Your Meme', w: Math.max(raw.w, 1.5), inherent: true };
  }
  const text = raw.desc ? `${title} ${raw.desc}` : title;
  // a paparazzi stroll's "kiss" is not a moment; restaging an old meme is not a new one
  const gossipy = RE.gossip.test(text) || RE.paparazzi.test(text);
  const it = { ...raw, title, outlet: outletOf(raw),
    viral: !RE.pastViral.test(title) && (RE.viral.test(title) || (raw.fam === 'bluesky' && RE.viral.test(raw.desc || ''))),
    moment: !gossipy && RE.moment.test(title) && !toldFirst(title, RE.moment),
    restage: RE.restage.test(title) && !RE.moment.test(title.replace(RESTAGE_ALL, '')),
    reaction: RE.reaction.test(title) && !toldFirst(title, RE.reaction),
    soft: RE.soft.test(title), industry: RE.industry.test(title), offField: RE.offField.test(text),
    political: RE.politics.test(text) || RE.politicsCase.test(text) };
  // an award-show reaction or red-carpet moment is the "Caeliel Demaby slaps Caelix Demley" kind of item, not industry news
  it.clip = it.moment || /\breact(s|ed|ing|ion)? to\b/i.test(title) ||
    (RE.awardShow.test(title) && (it.reaction || it.soft || RE.moment.test(title) || /\bmoment\b/i.test(title)));
  it.drop = dropReason(it);
  // a sensitive topic is kept and flagged; what else would drop the item still does
  if (SENSITIVE_DROPS.has(it.drop)) {
    it.sensitive = it.drop;
    it.drop = dropReason(it, true);
  } else {
    // (a viral item is never dropped for its topic, but it is still flagged: a crash on camera, an arrest that went viral)
    const why = it.drop ? null : sensitiveReason(it);
    it.sensitive = why;
  }
  it.mult = it.political && !RE.politicalMoment.test(title) ? 0.6 : 1;
  return it;
}

// ---------- step 5: signals ----------
/**
 * A Trends keyword attaches when it is the story (every keyword word is in the cluster and one is a distinctive non-name
 * word), or when it names the cluster's person around the peak ("mirey voraby" the day his daughter walked out).
 * Related queries no longer attach on their own: "hassmott" under "primetime movie" says nothing about Esselle Quillith.
 * Wikipedia spikes attach only around the peak day.
 */
function attachSignals(clusters, trends, wiki, { idf, isRare }) {
  const useful = (w) => !TREND_NOISE.has(w) && !STOP.has(w) && !GENERIC.has(w) && w.length > 2;
  for (const tr of trends) {
    tr.kwKey = words(tr.keyword).join(' ');
    tr.kwWords = words(tr.keyword).filter(useful);
    tr.kwToks = tr.kwWords.map(stem);
  }
  for (const c of clusters) {
    const nameWords = new Set([...c.entSet].join(' ').split(' '));
    const vocab = new Set([...c.items.flatMap((i) => i.toks), ...[...nameWords].map(stem)]);
    const distinct = new Set(c.items.flatMap((i) => i.toks).filter((t) => idf(t) >= TOKEN_IDF_MIN && !nameWords.has(t)));
    // a name only: "games" (a plain word that happens to trend) must not pull in "asian games 2026"
    const subjects = [c.topEnt, ...c.mainEnts].filter((e) => e && (e.includes(' ') || !W.inDict(e)));
    // a one-word keyword ("jobs", "tea") must be the story's own word: a hook, its quoted name, or a word few titles use
    const ownWord = (w) => c.hooks.includes(stem(w)) || c.pentSet.has(`p:${w}`) || isRare(stem(w));
    for (const tr of trends) {
      if (tr.start > c.last + DAY || (tr.end ?? NOW) < c.first - 3 * DAY) continue;
      const own = c.items.some((it) => it.trendRef === tr);
      // a place is never the story word: "texas game" says nothing about the Texas luggage driver
      const kwHit = tr.kwToks.length > 0 && tr.kwToks.every((t) => vocab.has(t)) &&
        tr.kwWords.some((w) => distinct.has(stem(w)) && !R.isPlaceOrTeam(w)) && (tr.kwWords.length > 1 || ownWord(tr.kwWords[0]));
      const nearPeak = Math.abs(tr.start - c.peakT) <= 2 * DAY;
      // a two-word name inside the keyword ("mirey voraby stats"); a one-word name only as the whole keyword ("drublob")
      const nameHit = nearPeak && subjects.some((e) => (e.includes(' ') ? contains(tr.kwKey, e) : tr.kwKey === e) || squeeze(tr.kwKey) === squeeze(e));
      if (own || kwHit || nameHit) c.trends.push({ tr, strength: 1, how: own ? 'own' : kwHit ? 'keyword' : 'name' });
    }
    c.wiki = wiki.filter((w) => c.entSet.has(w.key) && w.views >= WIKI_MIN_VIEWS && w.spike >= WIKI_MIN_SPIKE &&
      Math.abs(w.t - c.peakT) <= 1.5 * DAY);
  }
}

// ---------- step 6: rank ----------
/** Distinct outlets, with re-hosts (AOL, Yahoo, MSN) at half weight and syndicated identical titles counted once. */
const outletWeight = (name, localW) => (R.LOCAL_OUTLET.test(name) ? localW : R.REHOST.test(name) ? 0.5 : 1);
function outletCount(items, localW = 0.5) {
  const byOutlet = new Map();
  const titleSeen = new Set();
  const sorted = [...items].sort((a, b) => Number(R.REHOST.test(a.outlet)) - Number(R.REHOST.test(b.outlet)));
  for (const it of sorted) {
    if (titleSeen.has(it.key)) continue;
    titleSeen.add(it.key);
    const k = outletKey(it.outlet);
    byOutlet.set(k, Math.max(byOutlet.get(k) || 0, outletWeight(it.outlet, localW)));
  }
  return sum([...byOutlet.values()]);
}

function isSportsStory(c, athletes) {
  const athleteSubject = c.topEnt && athletes.has(c.topEnt);
  const sporty = c.items.filter((i) => R.TEAM_RE.test(i.title) || R.ATHLETE.test(i.title) || RE.sportsDry.test(i.title) || R.GAME_RE.test(i.title) || R.COLLEGE_RE.test(i.title)).length;
  const crowd = c.items.filter((i) => R.CROWD_SUBJECT.test(i.title)).length;
  return (athleteSubject || sporty * 2 >= c.items.length) && crowd * 2 < c.items.length;
}

const popOutlet = (i) => R.POP_FAMS.has(i.fam) || R.ENT_PUBLISHER.test(i.outlet || '');
const searchSpike = (c) => c.wiki.length > 0 || c.trends.some(({ tr, strength }) => strength === 1 && tr.volume >= SEARCH_SPIKE_VOLUME);

/**
 * Independent evidence: each outlet once (syndicated identical titles count once), Reddit, Bluesky, Know Your Meme and a
 * search spike as one source each. One key is single-source evidence ("Just Jared + IMDb's copy of the same title").
 */
function evidenceKeys(c) {
  const keys = new Set();
  const titleSeen = new Set();
  const sorted = [...c.items].sort((a, b) => Number(R.REHOST.test(a.outlet)) - Number(R.REHOST.test(b.outlet)));
  for (const it of sorted) {
    if (it.fam === 'reddit' || it.fam === 'bluesky') { keys.add(it.fam); continue; }
    if (titleSeen.has(it.key)) continue;
    titleSeen.add(it.key);
    keys.add(it.fam === 'kym' ? 'kym' : `news:${outletKey(it.outlet)}`);
  }
  if (searchSpike(c)) keys.add('search');
  return keys;
}
/** Evidence families: news, Reddit, Bluesky, Know Your Meme, search. */
const evidenceFamilies = (keys) => new Set([...keys].map((k) => k.split(':')[0])).size;
// r/popular's front page is everything (a photo of fog, a 116th birthday): only the pop-culture subreddits make a story pop culture
const popItem = (i) => popOutlet(i) || (i.fam === 'reddit' && i.sub !== 'popular') || (i.srcs || [i.src]).some((s) => R.POP_QUERIES.test(s));
const LOCAL_NATIONAL_WEIGHT = 0.25; // four local stations carrying a story count as one national outlet

function scoreCluster(c, athletes, celebs) {
  const famW = new Map();
  for (const it of c.items) famW.set(it.fam, Math.max(famW.get(it.fam) || 0, it.w * it.mult));
  const outlets = outletCount(c.items);
  // news outlets only: Reddit and Bluesky are evidence of their own, not coverage
  const national = outletCount(c.items.filter((i) => i.fam !== 'reddit' && i.fam !== 'bluesky'), LOCAL_NATIONAL_WEIGHT);
  const trendBoost = Math.max(0, ...c.trends.filter((x) => x.strength === 1).map(({ tr }) => tr.geoW * Math.log10(Math.max(1, tr.volume / 5000))));
  const wikiBoost = Math.max(0, ...c.wiki.map((w) => (R.ATHLETE.test(w.desc) ? 0.5 : 1) *
    Math.min(2.5, Math.log10(w.views / 20000) + 0.3 * Math.log2(w.spike))));
  const viral = c.items.some((i) => i.viral || i.inherent);
  const moment = c.items.some((i) => i.moment && !i.restage); // restaging an old meme is not a new moment
  const reaction = c.items.some((i) => i.reaction);
  const soft = c.items.some((i) => i.soft);
  const redditTopItems = c.items.filter((i) => i.fam === 'reddit' && i.rankDay < REDDIT_TOP_RANK &&
    (R.VIRAL_SUBS.has(i.sub) || moment || reaction || soft || viral));
  const redditTop = redditTopItems.length > 0;
  const bestRank = Math.min(...c.items.filter((i) => i.fam === 'reddit').map((i) => i.rankDay));
  const redditPosts = uniqByKey(c.items.filter((i) => i.fam === 'reddit' && i.rankDay < REDDIT_TOP_RANK)).length;
  const redditBoost = redditTop ? (bestRank < 5 ? 1.5 : 0.8) + 0.5 * Math.log2(redditPosts) : 0;
  const cue = viral ? 2 : moment || reaction ? 1 : soft ? 0.5 : 0;
  const evidence = sum([...famW.values()]) + (famW.size - 1) * 0.3 + 1.5 * Math.log2(1 + outlets) + redditBoost;
  const raw = evidence + 0.5 * trendBoost + 0.5 * wikiBoost + cue + (c.topEnt || c.topPseudo ? 0 : -0.8);
  const recency = 0.6 + 0.4 * Math.pow(0.5, Math.max(0, (NOW - c.last) / DAY) / RECENCY_HALF_LIFE_DAYS);
  const industry = !viral && c.items.filter((i) => i.industry && !i.clip).length * 2 >= c.items.length ? 0.6 : 1;
  c.families = famW;
  c.outlets = outlets;
  c.national = national;
  c.score = raw * recency * (cue ? 1 : 0.6) * industry;
  c.evidence = evidenceKeys(c);
  c.why = qualify(c, { moment, reaction, redditTopItems }, athletes, celebs);
  c.qualifies = !/^(none|not-|.*-gate)/.test(c.why);
  return c;
}

/**
 * A chat subreddit's post (r/popculturechat, r/entertainment) is a viral signal on its own only in that day's top three, as one
 * of two posts about it, or with a search spike; r/popular and the clip subs count anywhere in the top 15.
 */
function redditQualifies(c, redditTopItems) {
  // posted in two different subreddits' top 30 the same week ("Pellia Sorrenko checks on a 'sad' staffer" in r/popculturechat and r/Fauxmoi)
  const subs = new Set(c.items.filter((i) => i.fam === 'reddit' && i.rankDay < REDDIT_CROSS_RANK).map((i) => i.sub));
  // or a chat subreddit's top ten whose own title says it is going viral
  const chatViral = c.items.some((i) => i.fam === 'reddit' && i.rankDay < REDDIT_TOP_RANK_CHAT_VIRAL && RE.viral.test(i.title) && !RE.pastViral.test(i.title));
  if (subs.size >= 2 || chatViral) return true;
  if (!redditTopItems.length) return false;
  return redditTopItems.some((i) => R.VIRAL_SUBS.has(i.sub) || i.rankDay < REDDIT_TOP_RANK_CHAT) ||
    uniqByKey(redditTopItems).length >= 2 || searchSpike(c);
}
const REDDIT_CROSS_RANK = 30;
const REDDIT_TOP_RANK_CHAT_VIRAL = 10;

/**
 * Proof it went viral: viral wording from 1.5+ national outlets (or a pop-culture outlet), a meme-only source, today's top
 * of Reddit, a physical moment / crowd reaction covered by 3+ national outlets, or a moment seen in three evidence families
 * (Reddit, Bluesky, search: "Hollinrel Yarrurn flagged for taunting"). Then the topic gates. Returns the reason.
 */
function qualify(c, { moment, reaction, redditTopItems }, athletes, celebs) {
  const { national } = c;
  const sports = isSportsStory(c, athletes);
  // the daughter walking out, the taunt, the blood smear: a moment only inside a sports story
  const momentish = moment || reaction || (sports && c.items.some((i) => i.offField));
  const viralQ = c.items.some((i) => i.viral) && (national >= 1.5 || c.items.some((i) => i.viral && popOutlet(i)));
  const inherentQ = c.items.some((i) => i.inherent);
  const redditQ = redditQualifies(c, redditTopItems);
  const momentQ = momentish && national >= MIN_OUTLETS_FOR_MOMENT;
  const crossQ = momentish && evidenceFamilies(c.evidence) >= 3;
  // "patient zero lyrics" at 200k plus 3+ outlets and a fan-theory/reaction cue: people are searching the story itself
  const surge = c.trends.some(({ tr, how }) => how !== 'name' && tr.volume >= SEARCH_SURGE_VOLUME);
  const searchQ = surge && national >= MIN_OUTLETS_FOR_MOMENT && c.items.some((i) => i.soft || i.reaction || i.viral);
  // a big search on the story's own Trends headline ("quavwy" 200K+, its resolved headline in the cluster), or a Wikipedia page
  // read 80K+ times on the peak day with an outlet covering it: the whole internet is looking it up
  // (the trend's own headline must be in the story, and its query must name the story: "vmas 2026" is the whole night, not Nirvana)
  const bigSearchQ = c.trends.some(({ tr }) => tr.pop !== false && tr.volume >= (tr.geo === 'US' ? BIG_SEARCH_US : BIG_SEARCH_OTHER) &&
    c.items.some((i) => i.src === 'trends' && i.trendRef === tr) && [...c.entSet, ...c.hooks].some((n) => n.length > 2 && !RE.awardShow.test(n) && contains(tr.kwKey || words(tr.keyword).join(' '), n))) ||
    (c.wiki.some((w) => w.views >= BIG_WIKI_VIEWS) && national >= 1);
  if (!(viralQ || inherentQ || redditQ || momentQ || crossQ || searchQ || bigSearchQ)) return 'none';
  // a story mostly about a tragedy, a crime, violence or politics lists only when it is plainly popular (no content filter, but proof)
  c.sensitive = c.items.filter((i) => i.sensitive).length * 2 >= c.items.length;
  if (c.sensitive && !sensitiveProof(c)) return 'sensitive-gate';
  // (r/popular's top five with an outlet calling it viral is what everyone is talking about: "AMC butter isn't butter")
  const popCulture = c.items.some(popItem) || (c.topEnt && celebs.has(c.topEnt)) ||
    (c.items.some((i) => i.sub === 'popular' && i.rankDay < REDDIT_POPULAR_POP_RANK) && c.items.some((i) => i.viral && i.fam !== 'reddit'));
  if (!popCulture && national < MIN_OUTLETS_FOR_MOMENT) return 'not-pop-culture';
  const popOutlets = uniqByKey(c.items.filter((i) => popOutlet(i) && i.fam !== 'bluesky')).length;
  const seenBeyondSports = national >= MIN_OUTLETS_FOR_MOMENT || (viralQ && national >= 2) || popOutlets >= 2 ||
    c.items.some((i) => i.sub === 'popular' && i.rankDay < REDDIT_POPULAR_GATE_RANK) || c.items.some((i) => i.fam === 'bluesky');
  if (sports && !(momentish && seenBeyondSports)) return 'sports-gate';
  const politicalSubject = (c.topEnt && RE.politics.test(c.topEnt)) ||
    (c.items.filter((i) => i.political).length * 2 > c.items.length && c.items.every((i) => i.fam !== 'celeb'));
  // (no content filter: a political moment people plainly searched or upvoted lists like any other)
  if (politicalSubject && !(c.items.some((i) => RE.politicalMoment.test(i.title)) && (national >= 2 || sensitiveProof(c)))) return 'politics-gate';
  return viralQ ? 'viral' : inherentQ ? 'meme-source' : redditQ ? 'reddit-top' : momentQ ? 'moment+outlets' : crossQ ? 'cross-family' : searchQ ? 'search+outlets' : 'big-search';
}

const BIG_SEARCH_US = 100000; // a search this big on the story's own resolved Trends headline qualifies it on its own
const BIG_SEARCH_OTHER = 50000;
const BIG_WIKI_VIEWS = 80000;
const SENSITIVE_WIKI_VIEWS = 200000; // or a Wikipedia page read this much on the peak day
const SENSITIVE_SEARCH_VOLUME = 100000; // a US search surge this big on the story's own words or name
const SENSITIVE_REDDIT_RANK = 5; // or a top-five post of the day (r/popular, r/popculturechat, r/OutOfTheLoop)
/** Proof a sensitive story is popular: a 100K+ US search, a top-five Reddit post, or 3+ national outlets calling it viral or a moment. */
function sensitiveProof(c) {
  const search = c.trends.some(({ tr }) => tr.geo === 'US' && tr.volume >= SENSITIVE_SEARCH_VOLUME);
  const reddit = c.items.some((i) => i.fam === 'reddit' && i.rankDay < SENSITIVE_REDDIT_RANK);
  const outlets = c.national >= MIN_OUTLETS_FOR_MOMENT && c.items.some((i) => i.viral || i.moment || i.reaction);
  const wiki = c.wiki.some((w) => w.views >= SENSITIVE_WIKI_VIEWS) && c.national >= 1;
  return search || reddit || outlets || wiki;
}

/** The story's core: items that carry its quoted phrase or a hook word. Side items glued on by a shared name do not set its heat. */
function coreItems(c) {
  const core = c.items.filter((i) => (c.topPseudo && i.pents.includes(c.topPseudo)) || c.hooks.some((h) => i.toks.includes(h)));
  return uniqByKey(core.length >= 2 ? core : c.items);
}

/** Heat from daily counts of the core: rising when the last 48 h beat the 48 h before (from 2+ outlets), peak while at half the busiest day. */
function heatOf(c) { return heatOfItems(coreItems(c)); }
const HEAT_RANK = { fading: 0, peak: 1, rising: 2 };
/** The hotter of the moment's own heat and its story's (the subject answering the clip two days later keeps it live). */
const storyHeat = (c, onTopic) => { const a = heatOf(c); const b = onTopic && onTopic.length >= 3 ? heatOfItems(uniqByKey(onTopic)) : 'fading'; return HEAT_RANK[b] > HEAT_RANK[a] ? b : a; };
function heatOfItems(items) {
  const recent = items.filter((i) => NOW - i.t < 2 * DAY);
  const prev48 = items.filter((i) => NOW - i.t >= 2 * DAY && NOW - i.t < 4 * DAY).length;
  const recentOutlets = new Set(recent.map((i) => (i.fam === 'reddit' || i.fam === 'bluesky' ? i.fam : outletKey(i.outlet)))).size;
  const byDay = new Map();
  for (const i of items) byDay.set(utcDay(i.t), (byDay.get(utcDay(i.t)) || 0) + 1);
  const busiest = Math.max(...byDay.values());
  if (items.some((i) => i.status === 'trending') && recent.length > 0) return 'rising';
  if (recent.length > prev48 && recentOutlets >= HEAT_MIN_OUTLETS) return 'rising';
  if (recent.length > 0 && recent.length >= 0.5 * busiest) return 'peak';
  return 'fading';
}

/** Outlets that actually carried the story, strongest first. Search interest is a separate flag, not a source. */
function sourceLabels(c) {
  const w = new Map();
  for (const it of uniqByKey(c.items)) {
    const k = outletKey(it.outlet);
    const cur = w.get(k);
    // known outlets before bare domains, entertainment outlets first among equals
    const v = outletWeight(it.outlet, 0.3) * it.w + (/\./.test(it.outlet) ? 0 : 0.1) + (R.ENT_PUBLISHER.test(it.outlet) ? 0.2 : 0);
    if (!cur || cur.v < v) w.set(k, { name: it.outlet, v: Math.max(v, cur?.v || 0) });
  }
  return [...w.values()].sort((a, b) => b.v - a.v).map((x) => x.name).slice(0, 8);
}
/** What a list item is about: its main name, the name it opens with, and quoted titles in it ("SNL", "Verity"). */
function subjectKeys(c) {
  const hw = words(c.headline).join(' ');
  const opener = [...c.entSet].filter((e) => (hw + ' ').startsWith(e + ' '));
  return longestOnly(uniq([c.topEnt, c.topPseudo, ...opener, ...[...c.pentSet].filter((p) => contains(hw, p.slice(2)))].filter(Boolean)));
}

/**
 * Every name and quoted phrase of the story that its headline mentions ("Pellelle Sorrmott roasts Tavix Ostiss": both), the longest
 * of any that nest ("snl uk", not the "snl" inside it: the SNL premiere is another story).
 */
function headlineNames(c) {
  const hw = words(c.headline).join(' ');
  return longestOnly([...c.entSet, ...[...c.pentSet].map((p) => p.slice(2))].filter((n) => contains(hw, n)));
}
const bareKey = (k) => (/^[pn]:/.test(k) ? k.slice(2) : k);
const longestOnly = (names) => names.filter((n) => !names.some((m) => m !== n && bareKey(m) !== bareKey(n) && contains(bareKey(m), bareKey(n))));

/** Two headlines share a story word beyond the names they share ("flinches" and "booed" do not). */
function sharedStem(a, b, names) {
  const nameWords = new Set(names.flatMap((n) => bareKey(n).split(' ')));
  const st = (h) => new Set(words(h).filter((w) => w.length > 2 && !STOP.has(w) && !GENERIC.has(w) && !nameWords.has(w)).map(stem));
  const sa = st(a);
  return [...st(b)].some((x) => sa.has(x));
}

/**
 * Format trends: a meme or TikTok format people can copy. KYM newsroom and confirmed entries, trend explainers from the
 * TikTok/meme searches, and Bluesky culture trends with outside evidence.
 */
function isFormatTrend(c) {
  return c.items.some((i) => i.src === 'kym-news' || i.src === 'kym-memes' ||
    ((i.srcs || [i.src]).some((x) => /^gn-(tiktok|meme)/.test(x)) && /\b(trend|challenge)\b/i.test(i.title)) ||
    (i.fam === 'bluesky' && i.category === 'culture' && c.evidence.size >= 2));
}

/**
 * Evidence floor for the main list: two independent sources, or a search spike, or a strict Reddit top post. Single-family
 * stories (Bluesky only, KYM only, one outlet plus its syndicated copies) wait for a second family.
 */
const passesFloor = (c) => c.evidence.size >= 2 || searchSpike(c) || c.why === 'reddit-top';

/**
 * One item per subject: a later story whose headline names a subject already shown (its main name, opening name, or any
 * name it mentions) is a near-duplicate, unless it is its own moment with 3+ outlets. TREND_QUOTA slots go to format trends.
 */
function pickTop(clusters, lex, covered = () => false, skip = () => false) {
  const qualifying = clusters.filter((x) => x.qualifies && !skip(x));
  for (const c of qualifying) {
    c.headline = H.headlineFor(c, lex);
    const politicalHeadline = c.headline && (RE.politics.test(c.headline) || RE.politicsCase.test(c.headline));
    if (politicalHeadline && !RE.politicalMoment.test(c.headline)) c.score *= 0.8; // allowed only as a viral moment
    if (c.headline && H.VAGUE_AFTERMATH.test(c.headline)) c.score *= VAGUE_HEADLINE_MULT;
    c.format = isFormatTrend(c);
  }
  // a meme, format or catchphrase already under "Words & trends" is not repeated here
  const pool = qualifying.filter((c) => !covered(c, c.format || c.why === 'meme-source'));
  pool.sort((a, b) => b.score - a.score);
  const used = new Map();
  const seen = new Set();
  const out = [];
  const tryAdd = (c) => {
    if (!c.headline || out.includes(c)) return false;
    const key = words(c.headline).join(' ');
    // (an awards night is no one's subject: Zorrr, Esselle Quillith and Nirvana at the VMAs are three stories)
    const keys = uniq([...subjectKeys(c), ...headlineNames(c)]).filter((k) => !C.isEventName(bareKey(k)));
    const taken = keys.filter((k) => (used.get(k) || 0) >= MAX_PER_ENTITY);
    const ownMoment = c.items.some((i) => i.viral || i.moment || i.reaction) && c.outlets >= MIN_OUTLETS_FOR_MOMENT;
    // a second card about the same name is another story when it shares no story word with the first ("Neskova booed at a college
    // football game" beside "Neskova flinches beside Tamwyn")
    const firstOf = (k) => out.find((o) => uniq([...subjectKeys(o), ...headlineNames(o)]).includes(k));
    const disjoint = taken.length && (c.national >= 2 || c.why === 'reddit-top') &&
      taken.every((k) => { const o = firstOf(k); return o && !o.hooks.some((h) => c.hooks.includes(h)) && !sharedStem(o.headline, c.headline, keys); });
    const secondOk = taken.length && (ownMoment || disjoint) && taken.every((k) => used.get(k) < MAX_PER_ENTITY + 1);
    if (seen.has(key) || (taken.length && !secondOk)) return false;
    seen.add(key);
    keys.forEach((k) => used.set(k, (used.get(k) || 0) + 1));
    out.push(c);
    return true;
  };
  // main list first (formats that make it on merit count as main), then the reserved format slots, then any slack
  for (const c of pool) {
    if (out.length >= TOP_N - TREND_QUOTA) break;
    if (passesFloor(c)) tryAdd(c);
  }
  let formats = 0;
  const formatRank = (c) => c.score + (c.items.some((i) => FORMAT_COPY.test(`${i.title} ${i.kymDesc || ''}`)) ? FORMAT_COPY_BONUS : 0);
  const formatPool = pool.filter((c) => c.format).sort((a, b) => formatRank(b) - formatRank(a));
  for (const c of formatPool) if (formats < TREND_QUOTA && out.length < TOP_N && tryAdd(c)) formats++;
  for (const c of pool) {
    if (out.length >= TOP_N) break;
    if (passesFloor(c)) tryAdd(c);
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Not a moment at all, though it qualified: a stock joke caption on an unnamed clip ("Pellia Sorrenko has been real quiet since this
 * stunt dropped"), an observance day ("Today is the International Day of Sign Languages"), or a reported claim that qualified only on a moment verb and three outlets, where that verb is inside a quote
 * or is a decision ("Hollinet ‘rejects Zanory film to avoid fresh conflict with Rouet’"). Decided after the words are finished,
 * so "Words & trends" is unchanged.
 */
const QUOTED_SPAN = /[‘'“"][^‘'“"’”]{3,80}[’'”"]/g;
function notAMoment(c) {
  if (c.items.every((i) => RE.jokeTitle.test(i.title))) return true;
  if (c.items.filter((i) => RE.observance.test(i.title)).length * 2 >= c.items.length) return true;
  if (c.why !== 'moment+outlets' || c.items.some((i) => i.viral || i.inherent || i.reaction || i.soft)) return false;
  return c.items.every((i) => !i.moment || RE.decision.test(i.title) || !RE.moment.test(i.title.replace(QUOTED_SPAN, ' ')));
}


// ---------- main ----------
function buildList(store, wiki) {
  const from = utcDay(NOW) - WINDOW_DAYS * DAY;
  const inWindow = (t) => t >= from && t <= NOW + DAY;
  const trends = [...store.trends.values()].filter((t) => (t.end ?? NOW) >= from);
  // only pop-culture trends become items; sports and "other" trends are search signals
  const trendItems = uniqByKey(trends.filter((t) => t.pop !== false && t.headline && inWindow(t.headline.t)).map((t) => ({ ...t.headline,
    key: t.headline.url, src: 'trends', fam: 'trends', label: 'Google Trends', w: 0.5, trendRef: t })));
  // (the streamer subreddits' rows feed the talking points only)
  const rows = [...store.rows.values()].filter((r) => inWindow(r.t) && !r.talkOnly);
  const all = [...rows, ...trendItems].map(prepare);
  // rows only the words-only searches found feed "Words & trends", never the moments
  const kept = all.filter((it) => !it.drop && !it.wordsOnly);
  const memeNames = rows.filter((r) => r.src === 'kym-memes').flatMap((r) => r.title.split(' / ').map(stripParen));
  // dropped titles still teach casing, so the lexicon sees everything
  const lex = W.buildLexicon(all.filter((i) => !i.wordsOnly).map((i) => i.title), trends.filter((t) => inWindow(t.start)), wiki, memeNames);
  // the rows the store still keeps from just before the window: a term's definition outlives the window, its evidence does not
  const older = [...store.rows.values()].filter((r) => r.t < from && r.t >= NOW - ST.KEEP_DAYS * DAY).map(prepare);
  const wordGroups = WD.collect(all, trends.filter((t) => inWindow(t.start) || (t.end ?? NOW) >= from),
    { outletKeyOf: (it) => outletKey(it.outlet), lex, roundups: WT.roundupPages(store.lookups), older });
  const athletes = new Set(wiki.filter((w) => R.ATHLETE.test(w.desc)).map((w) => w.key));
  kept.forEach((it) => C.annotate(it, lex));
  const { clusters, ctx } = C.clusterItems(kept);
  attachSignals(clusters, trends, wiki, ctx);
  // people the entertainment press writes about, or with a Wikipedia person page in the most-read lists
  const celebs = new Set([...kept.filter(popItem).flatMap((i) => i.ents),
    ...wiki.filter((w) => /\b(actor|actress|singer|rapper|model|musician|comedian|personality|influencer|youtuber|streamer|presenter)\b/i.test(w.desc)).map((w) => w.key)]);
  clusters.forEach((c) => scoreCluster(c, athletes, celebs));
  return { all, kept, clusters, lex, wordGroups, trends, ctx, pick: (covered, skip) => pickTop(clusters, lex, covered, skip) };
}

/** Every row the talking points count: the window's items (dropped ones too: a blocked outlet counts, it never words a line) and talk-only rows. */
function talkItems(store, all) {
  const from = utcDay(NOW) - WINDOW_DAYS * DAY;
  // (a talk subreddit's post, or a people-drama search's headline with its outlet, flagged drama)
  const talk = [...store.rows.values()].filter((r) => r.talkOnly && r.t >= from && r.t <= NOW + DAY)
    .map((r) => (r.fam === 'gnews' ? { title: cleanTitle(r), t: r.t, outlet: outletOf(r), fam: 'gnews', url: r.url, drama: true, ...(r.beat ? { beat: true } : {}),
      ...(TS.FAR_DOMAIN.test(r.publisherUrl || '') ? { far: true } : {}) }
      : { title: r.title, t: r.t, outlet: 'Reddit', fam: 'reddit', sub: r.sub, rankDay: r.rankDay, rankWeek: r.rankWeek, url: r.url,
        ...(Number.isFinite(r.rankToday) ? { rankToday: r.rankToday } : {}) }));
  // (a Know Your Meme row keeps its feed and its description: the memes of the week, told by their entry)
  return [...all.map((i) => ({ title: i.title, t: i.t, outlet: i.outlet, fam: i.fam, sub: i.sub, rankDay: i.rankDay, url: i.url,
    ...(i.fam === 'kym' ? { src: i.src, kymDesc: i.kymDesc || null } : {}) })), ...talk];
}

/** { sensitive, sensitiveWhy } for a listed story: the commonest sensitive topic of its items, or politics when most are political. */
function sensitiveOf(st) {
  const items = st.unit.clusters.flatMap((x) => x.items);
  const counts = new Map();
  for (const it of items) if (it.sensitive) counts.set(it.sensitive, (counts.get(it.sensitive) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (st.unit.clusters.some((x) => x.sensitive) && top) return { sensitive: true, sensitiveWhy: top[0] };
  const political = items.filter((i) => i.political).length * 2 >= items.length || RE.politics.test(st.headline || '');
  return political ? { sensitive: true, sensitiveWhy: 'politics' } : {};
}

// ---------- the collector's entry points ----------
/** The talking points' Trends rows: the store's own (merged reply by reply as the app merges them), else the moments' store trends. */
const talkTrendList = (store) => (store.talkTrends && store.talkTrends.size ? [...store.talkTrends.values()] : TS.fromStoreTrends([...store.trends.values()]));

/** What every talking-points call reads, for one audience. */
function talkContext({ store, wiki, wikiLists, crazes, roster, native = null, voices = null, find = null, debug = null }, all, lex, audience) {
  // (find + debug: one name's reasoning printed, for a person reading a build; never set by a cycle)
  // (native: the creators the keyless signals are about, as names to evaluate: talk-candidates.js nativeCandidates)
  return { trends: talkTrendList(store), wiki, wikiTop: TS.wikiTopSpikes(wikiLists, NOW), wikiLists, crazes, roster, native,
    items: talkItems(store, all), lookups: store.lookups, now: NOW, lex, audience: TC.audienceOf(audience), ...(find && debug ? { find, debug } : {}),
    // (wave 9: the fast lane's board voices and measured hit rates, lib/voices/; the collector's private state, absent in a replay)
    ...(voices ? { voiceBoards: voices.boards || [], voiceRates: voices.rates || null } : {}),
    // (wave 11: the boards' flair by post id, from the reads already made, for the board noun: lib/board-noun.js)
    ...(voices && voices.flairs ? { boardFlairs: voices.flairs } : {}) };
}

/**
 * The names worth a search right now, strongest first, from the store as it stands (the cheap first half of a build: the rows prepared
 * and the lexicon, no clustering): { lookup (every name a refresh would search, in the prototype's order), drama (the people-drama
 * names among them: creators first), recent (the creators' world's biggest: a newest-first search) }. The collector plans its tier 1
 * with these in the same cycle the names first show (lib/budget.js).
 */
function names(input) {
  // (its three lists ask for the same names of the same reading: answered once. engine/memo.js)
  return MEMO.within(() => namesOnce(input));
}
function namesOnce(input) {
  NOW = input.now;
  const from = utcDay(NOW) - WINDOW_DAYS * DAY;
  const inWindow = (t) => t >= from && t <= NOW + DAY;
  const trends = [...input.store.trends.values()].filter((t) => (t.end ?? NOW) >= from);
  const rows = [...input.store.rows.values()].filter((r) => inWindow(r.t) && !r.talkOnly);
  const all = rows.map(prepare);
  const memeNames = rows.filter((r) => r.src === 'kym-memes').flatMap((r) => r.title.split(' / ').map(stripParen));
  const lex = W.buildLexicon(all.filter((i) => !i.wordsOnly).map((i) => i.title), trends.filter((t) => inWindow(t.start)), input.wiki, memeNames);
  const ctx = { ...talkBase(input, all, lex), audience: TC.audienceOf('mixed') };
  // (wave 10: and the people-drama names the last 36 hours tell, with their rows, for lib/early-names.js; wave 11: with the creators' own
  // world's voices (lib/early-names.js creatorVoices), and fenced: a fault there costs the early names only, never the names pass. Collector only)
  const told = () => { try { return TC.earlyTold({ ...ctx, items: ctx.items.map((i) => ({ ...i, h: TC.hay(i.title) })), creatorVoices: input.creatorVoices || null }); } catch { return []; } };
  return { lookup: TP.lookupNames(ctx), drama: TP.dramaLookupNames(ctx), recent: TP.recentNames(ctx), told: told() };
}

/** A listed moment's timed evidence, for the collector's series: its own rows, its searches, its page. */
function momentMeta(st, items) {
  const own = uniqByKey(items).filter((i) => Number.isFinite(i.t)).map((i) => ({ t: i.t, title: i.title, outlet: i.outlet, fam: i.fam, url: i.url || null,
    ...(i.fam === 'reddit' ? { sub: i.sub, rank: i.rankDay } : {}), ...(i.fam === 'bluesky' ? { posts: i.postCount || 0, live: i.status === 'hot' } : {}) }));
  const trends = uniqByKey(st.unit.clusters.flatMap((c) => c.trends.map(({ tr }) => ({ key: tr.key, geo: tr.geo, keyword: tr.keyword, volume: tr.volume || 0,
    growth: tr.growth || 0, start: tr.start, end: tr.end ?? null, ...(Array.isArray(tr.cats) && tr.cats.length ? { cats: tr.cats } : {}) }))));
  const wiki = Math.max(0, ...st.unit.clusters.flatMap((c) => c.wiki.map((w) => w.views)));
  return { firstT: st.momentFirst, storyT: st.storySince, own, trends, wiki: wiki || null };
}

/**
 * The part of a build every audience shares: the words, the moments and the stories behind them. Sets the build's clock.
 * input: { store, wiki (most-read rows), wikiLists (daily top lists), crazes, roster, now (ms), audiences, native }.
 */
function shared(input) {
  NOW = input.now;
  const { store, wiki } = input;
  const { all, clusters, lex, wordGroups, trends, ctx: clusterCtx, pick } = buildList(store, wiki);
  // (read, never written, for the rest of the build: the memos key them by identity. engine/memo.js)
  MEMO.readOnly(store.lookups, lex);
  // a moment story that quotes a candidate catchphrase is that entry's coverage ("You see how this looks, right?" / Feniel Zellova)
  const finishWords = () => {
    const once = WD.finish(wordGroups, store.lookups, NOW, lex);
    return WD.absorbClusters(once.all, clusters.filter((c) => c.qualifies), (it) => outletKey(it.outlet)) ? WD.finish(wordGroups, store.lookups, NOW, lex) : once;
  };
  const wordList = finishWords();
  // what "Words & trends" shows with a meaning (listed or bubbling) is not repeated among the moments, nor is an old explainer re-dated
  const shownWords = [...wordList.listed, ...wordList.bubblingRows.filter((r) => r.meaning)];
  const top = pick((c, formatLike) => WD.coversCluster(c, shownWords, formatLike),
    (c) => c.items.every((i) => wordList.redatedItems.has(i)) || notAMoment(c));
  // step 8: the story behind each moment, from the store and the story searches it already holds
  const built = STY.buildStories({ top, all, lex, trends, wiki, lookups: store.lookups, now: NOW, prepareRaw: prepare, idf: (t) => clusterCtx.idf(t) });
  const today = utcDay(NOW);
  const daysAgo = (t) => Math.max(0, Math.round((today - utcDay(t)) / DAY));
  const listed = built.stories.filter((st) => !st.veto);
  for (const st of listed) {
    st.heat = SW.momentHeat(st.heatRows, st.momentFirst, NOW, null);
    const newest = Math.max(st.momentFirst, ...(st.onTopic || []).filter((i) => i.t <= NOW + DAY).map((i) => i.t));
    st.rank = st.cluster.score * (HEAT_ORDER[st.heat] || HEAT_ORDER.fading) * Math.pow(0.5, Math.max(0, (NOW - newest) / DAY) / ORDER_HALF_LIFE_DAYS) *
      filmableOrder(st);
  }
  const byRank = (a, b) => b.rank - a.rank;
  const ordered = [...listed.filter((st) => !st.localOnly && st.why).sort(byRank), ...listed.filter((st) => !st.localOnly && !st.why).sort(byRank),
    ...listed.filter((st) => st.localOnly).sort(byRank)];
  const moments = ordered.map((st) => {
    const c = st.cluster;
    const unitItems = { ...c, items: st.unit.clusters.flatMap((x) => x.items) };
    const same = (a, b) => words(a || '').join(' ') === words(b || '').join(' ');
    return {
      headline: st.headline,
      story: same(st.story, st.headline) ? null : st.story,
      moment: same(st.moment, st.headline) || st.moment.split(/\s+/).length <= 5 ? null : st.moment,
      why: st.why,
      subject: st.subject || null,
      storyKind: st.storyKind,
      ...(st.also.length ? { alsoMoments: st.also } : {}),
      daysAgo: daysAgo(st.momentFirst),
      storyDaysAgo: daysAgo(st.storySince),
      heat: st.heat,
      sources: sourceLabels({ ...unitItems, items: [...unitItems.items, ...(st.onTopic || [])] }),
      searchSpike: st.unit.clusters.some(searchSpike),
      ...sensitiveOf(st),
      trace: { story: st.storyTrace, moment: st.momentTrace, why: st.whyTrace },
      meta: momentMeta(st, [...unitItems.items, ...(st.onTopic || [])]),
    };
  });
  return { all, lex, wordGroups, wordList, built, moments };
}

/** One audience's talking points and its one hot list, from the build's talking-points context (talkBase) and the shared part. */
function rankFrom(base, { words: listedWords, moments }, audience, now, onPoints = null) {
  NOW = now;
  const talkingPoints = TP.build({ ...base, audience: TC.audienceOf(audience), words: listedWords, moments, ...(onPoints ? { onPoints } : {}) });
  // (collector only, wave 12: the cards the talking points' cut left under it, for the extension's "More" past rank 80: lib/desks/more.js)
  return { talkingPoints, hot: HL.hotList({ talkingPoints, words: listedWords, moments }, { now: NOW, audience: TC.audienceOf(audience) }), overflow: TP.overflowOf(TC.audienceOf(audience)) };
}

/**
 * What every talking-points call of one build reads, whoever the list is for (talkContext's, its audience set by each call): made
 * once a build and read-only after, so that the steps every audience repeats are answered once (engine/memo.js).
 */
function talkBase(input, all, lex) {
  const base = talkContext(input, all, lex, 'US');
  MEMO.readOnly(base.trends, base.wiki, base.wikiTop, base.wikiLists, base.crazes, base.roster, base.native, base.items, base.lookups, base.lex);
  return base;
}

/** The lookups the lists still need, for the collector's queue (the prototype fetched them inside the run; here they land over the next cycles). */
function owedOf(input, { wordGroups, wordList, built }, base) {
  NOW = input.now;
  const { store, wiki } = input;
  const ctx = { ...base, audience: TC.audienceOf('mixed') };
  const inWindow = [...store.rows.values()].filter((r) => r.t >= NOW - WINDOW_DAYS * DAY);
  const titles = inWindow.map((r) => ` ${words(r.title).join(' ')} `);
  const known = (key) => titles.some((t) => t.includes(` ${key} `));
  const specific = (w) => w.key.includes(' ') || (!W.isFirstName(w.key) && !W.inDict(w.key));
  const story = STY.lookupTargets(built.units, store.lookups, NOW, built.stories);
  return {
    names: TP.lookupNames(ctx), drama: TP.dramaLookupNames(ctx), recent: TP.recentNames(ctx),
    words: WT.lookupTargets(wordGroups, store.lookups, NOW),
    since: WT.sinceTargets(wordList, store.lookups, NOW),
    kym: WT.kymPageTargets(wordList.candidates, store.lookups, NOW),
    roundups: WT.roundupTargets(inWindow, store.lookups),
    storyNews: story.deep, storyWiki: story.wiki,
    wikiDiscover: S.wikiDiscoverTargets(wiki.filter(specific), NOW, known),
  };
}

/**
 * One build: { words, bubbling, moments, byAudience: { [audience]: { talkingPoints, hot, overflow } }, owed, lex }. The words and the moments
 * once, the talking points and the hot list per audience, every step the audiences ask alike answered once (engine/memo.js: one
 * scope a build, nothing kept after it). `owed`: the lookups the lists still need, for the collector's queue.
 * input: { store, wiki (most-read rows), wikiLists (daily top lists), crazes, roster, now (ms), audiences, native }.
 */
function build(input) {
  // (a person reading one name's reasoning, find + debug, gets every step run and printed)
  if (input.find || input.debug) return buildOnce(input);
  return MEMO.within(() => buildOnce(input));
}
function buildOnce(input) {
  const sh = shared(input);
  const base = talkBase(input, sh.all, sh.lex);
  MEMO.readOnly(sh.wordList.words, sh.moments);
  const byAudience = {};
  for (const audience of (input.audiences && input.audiences.length ? input.audiences : ['US'])) {
    byAudience[audience] = rankFrom(base, { words: sh.wordList.words, moments: sh.moments }, audience, input.now, audience === 'US' && typeof input.onPoints === 'function' ? input.onPoints : null);
  }
  const owed = owedOf(input, sh, base);
  // (lex: the build's own name lexicon, for the collector's line writer, which recases a headline the way the engine does)
  return { words: sh.wordList.words, bubbling: sh.wordList.bubbling, moments: sh.moments, byAudience, owed, lex: sh.lex };
}

module.exports = { build, names, prepare, talkTrendList, WINDOW_DAYS };
