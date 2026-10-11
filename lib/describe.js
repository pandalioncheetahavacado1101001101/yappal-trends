'use strict';
/*
 * What a row says about itself beyond its title and line (ios/IDEAS-FEED.md D3, D4): the finer kind, who it is about, the topics a
 * creator makes (the app's ContentTopic: a port of IdeaTopics' word rules), what a follow is matched against, the example searches,
 * the app's own card input, the demand number and why it is hot. Pure functions of a row (lib/rows.js) and its evidence.
 *
 * Honesty rules held here: demand is how much something is wanted or watched, never how many videos exist; a count of creators'
 * uploads among a name's coverage is a tiny sample and is never a number anywhere ("Creators are already posting about it").
 */
const HL = require('../engine/hot-list');
const R = require('../engine/rules');
const W = require('../engine/wording');
const { keyOf, homeGeos } = require('./util');

// ---------- topics: MyVideoPal/Ideas/IdeaTopics.swift, rule for rule ----------
const TOPIC_RULES = [
  ['celebs', 'actor|actress|singer|rapper|celebrit(?:y|ies)|celeb|influencer|streamer|youtuber|feud|beef|drama|slams|claps back|responds|roasts|booed|rejects|defends|apologi[sz]es|splits?|divorce|breakup|dating|engaged|engagement|wedding|married|pregnant|red carpet|emmys?|oscars?|grammys?|vmas|met gala|mugshot|arrest|lookalike|paparazzi|royals?|prince|princess|lawsuit|controversy|backlash|interview|podcast|scandal', 'star|stars'],
  ['memes', 'memes?|viral|internet|online|tiktok|tiktoker|trend|trending|challenge|reddit|reacts|react|filter|prank|gifs?|catchphrase|slang|brainrot|aura', 'clips?|edits?'],
  ['music', 'songs?|singer|rapper|album|concert|tour|festival|music|dance|dances|dancing|choreography|lyrics?|audio|remix|band|billboard|spotify|karaoke|dj|rap|k-?pop', 'single|sounds?'],
  ['screen', 'movies?|films?|trailer|series|season|episode|tv|netflix|hbo|disney|marvel|pixar|anime|books?|novel|author|documentary|sitcom|premiere|snl|box office|sequel|reboot|streaming', 'shows?|cast'],
  ['sports', 'nfl|nba|mlb|nhl|wnba|mls|ufc|wwe|f1|football|soccer|basketball|baseball|hockey|tennis|golf|boxing|olympics?|world cup|super bowl|coach|quarterback|player|stadium|league|workout|gym|fitness|marathon|athletes?|touchdown|on-field', null],
  ['beauty', 'makeup|skincare|skin care|blush|lipstick|mascara|nails|manicure|hair|haircut|hairstyle|fashion|outfit|dress|gown|red carpet|met gala|style|beauty|perfume|fragrance|runway|sephora|contour|cleansing', 'models?'],
  ['food', 'food|recipes?|cook|cooking|chef|restaurant|snacks?|drinks?|coffee|latte|pizza|burger|fries|mcdonald\'?s|starbucks|tacos?|sushi|bake|baking|cake|cookies?|dessert|dinner|lunch|breakfast|meals?|eat|eating|diet|steakhouse|menu|candy|chocolate|protein|mcdouble', 'kitchens?'],
  ['lifeHacks', 'hacks?|tips?|productivity|habits?|routine|self-improvement|self improvement|mindset|motivation|mental health|therapy|therapist|sleep|study|budget|money|saving|finance|career|jobs?|job interviews?|workplace|boss|resume|cortisol|anxiety|wellness|\\w+maxxing', null],
  ['lifestyle', 'dating|relationships?|boyfriend|girlfriend|husband|wife|marriage|family|mom|dad|parents?|parenting|kids|baby|pets?|dog|cat|travel|vacation|apartment|house|decor|day in my life|vlog|gen z|gen alpha|millennials?|friends|roommate|hometown|school|college', 'home'],
  ['shopping', 'products?|brand|sale|deals?|amazon|walmart|costco|ikea|stanley|haul|unboxing|iphone|merch|collab|collaboration|prices?|shop|shopping|store|sold out|labubu|dupe', 'target|launch(?:es|ed)?'],
].map(([topic, sure, loose]) => ({ topic, sure: new RegExp(`\\b(?:${sure})\\b`, 'i'), loose: loose ? new RegExp(`\\b(?:${loose})\\b`, 'gi') : null }));
const TOPIC_ORDER = TOPIC_RULES.map((r) => r.topic);
const TOPICS_MAX = 4;

/** The chips a text's words point to: any sure word, or two different loose ones. */
function matchedTopics(text) {
  const s = String(text || '');
  return TOPIC_RULES.filter((r) => r.sure.test(s) || (r.loose && new Set((s.match(r.loose) || []).map((w) => w.toLowerCase())).size >= 2)).map((r) => r.topic);
}
// what a person's role says a story is about, beside the drama: a singer's is music, an actor's the screen, an athlete's sport
const ROLE_TOPIC = { musician: 'music', actor: 'screen', athlete: 'sports' };
const HEADLINE_VOTES = 3;
const HEADLINE_SHARE = 0.3;
const HEADLINES_READ = 30;
// (nor the one whose words are every story's: "boss", "money", "jobs")
const HEADLINE_UNFILED = new Set(['celebs', 'memes', 'lifeHacks']);
/**
 * The topics a story’s own headlines point to: one that three of them, and three in ten of them, say in so many words ("makeup", "recipe",
 * "sold out"). A card's title and one line are a dozen words and seldom say what a story is about beyond who is in it: at the
 * recheck of 2026-10-12, 61 of 80 rows were filed under "celebs" alone, so For you had nothing to rank a beauty, food or shopping
 * creator's list by. Strongest first.
 */
function headlineTopics(row) {
  const heads = ((row.meta && row.meta.own) || []).filter((r) => r && r.title && r.fam !== 'reddit' && r.k !== 'post' && r.k !== 'thread').slice(-HEADLINES_READ).map((r) => String(r.title));
  if (heads.length < HEADLINE_VOTES) return [];
  // (never the two topics nearly every row carries: a headline that says "viral" or "star" files nothing)
  return TOPIC_RULES.filter((r) => !HEADLINE_UNFILED.has(r.topic)).map((r) => ({ topic: r.topic, n: heads.filter((h) => r.sure.test(h)).length })).filter((x) => x.n >= HEADLINE_VOTES && x.n >= HEADLINE_SHARE * heads.length)
    .sort((a, b) => b.n - a.n).map((x) => x.topic);
}
/**
 * A row's topics, 1 to 4 of the app's ContentTopic raw values, as IdeaTopics gives them: a word, craze or meme is internet culture by
 * nature (a sound is music too); a story about people is celebs and drama when nothing narrower fits, and a people-drama row always.
 * As built 2026-10-12, a talking point and a moment are also filed by what their own headlines keep saying (`headlineTopics`) and by
 * what the people in them do (about: lib/describe.js aboutOf): what the card's own words point to first, then those.
 */
function topicsOf(row, about = null) {
  const tags = new Set();
  const more = [];
  if (row.type !== 'word') {
    for (const t of headlineTopics(row)) more.push(t);
    for (const p of (about && about.people) || []) if (ROLE_TOPIC[p.role]) more.push(ROLE_TOPIC[p.role]);
  }
  if (row.type === 'word') {
    for (const t of matchedTopics(`${row.word.term}. ${row.word.meaning || ''}`)) tags.add(t);
    tags.add('memes');
    if (row.word.kind === 'sound') tags.add('music');
  } else if (row.type === 'moment') {
    const m = row.moment;
    const parts = [m.headline];
    for (const line of [m.story, m.moment]) if (line && !parts.includes(line)) parts.push(line);
    for (const t of matchedTopics(parts.join('. '))) tags.add(t);
    if (![...tags].some((t) => t !== 'memes')) tags.add('celebs');
  } else {
    const p = row.point;
    for (const t of matchedTopics(`${row.title || p.title}. ${row.line || p.what || ''}`)) tags.add(t);
    if (row.wordish) tags.add('memes');
    if (p.kind === 'music') tags.add('music');
    if (p.kind === 'show') tags.add('screen');
    if (p.kind === 'sports') tags.add('sports');
    if (p.kind === 'sound') tags.add('music');
    // (a people-drama row is "Celebs & drama" whatever else its line's words point to: the first joined run filed the benchmark row
    // under life hacks alone, for "saving evidence", so For you lifted it for the wrong creators and not for the right ones)
    if (row.drama) tags.add('celebs');
    if (![...tags].some((t) => t !== 'memes') && !row.wordish) tags.add('celebs');
  }
  // (the card's own words first, in the chips' order; then what its headlines and its people add, strongest first; four at most)
  const own = TOPIC_ORDER.filter((t) => tags.has(t));
  return [...own, ...more.filter((t, i) => !tags.has(t) && more.indexOf(t) === i)].slice(0, TOPICS_MAX);
}

// ---------- the finer kind ----------
const PRODUCT = /\b(?:toys?|fidgets?|plush(?:ies)?|dolls?|collectibles?|gadgets?|snacks?|cand(?:y|ies)|drinks?|sneakers?|tumblers?|lip ?gloss|skincare|product lines?|products?)\b/i;
function subOf(row) {
  const text = `${row.title} ${row.line || ''}`;
  if (row.kind === 'moment') return /\b(?:clip|video|stream|livestream|footage)\b/i.test(text) ? 'clip' : 'story';
  if (row.kind === 'sound') return 'sound';
  if (row.kind === 'word') {
    const p = row.point;
    const kind = p ? p.kind : row.word.kind;
    if (/\bchallenge\b/i.test(text)) return 'challenge';
    if (/\bfilters?\b/i.test(text)) return 'filter';
    if (/\bA\.?I\.?\b/.test(text)) return 'ai';
    if (/#\w|\bhashtag\b/i.test(text)) return 'hashtag';
    if (kind === 'meme') return 'meme';
    // (a craze for a thing people buy: "NeeDoh is a line of sensory fidget toys ...". Decision 9's product crazes)
    if (kind === 'craze' || kind === 'trend') return p && p.from === 'crazes' ? 'format' : PRODUCT.test(text) ? 'product' : 'craze';
    return kind === 'phrase' ? 'phrase' : 'word';
  }
  const p = row.point;
  if (row.drama) return 'drama';
  return { show: 'show', music: 'music', sports: 'sports', game: 'game', moment: 'clip' }[p.kind] || 'story';
}

// ---------- people, tags, topic ----------
const ROLES = [
  ['streamer', /\b(?:live ?streamers?|streamers?)\b/i], ['youtuber', /\byoutubers?\b|\byoutube stars?\b/i], ['tiktoker', /\btiktokers?\b|\btiktok stars?\b/i],
  ['creator', /\b(?:influencers?|content creators?|podcasters?|vloggers?)\b/i], ['musician', /\b(?:rappers?|singers?|musicians?|pop stars?|songwriters?)\b/i],
  ['actor', /\b(?:actors?|actress(?:es)?)\b/i], ['athlete', /\b(?:quarterback|qb|athlete|boxer|fighter|wrestler|striker|pitcher|golfer|sprinter|nba star|nfl star)\b/i],
  ['politician', /\b(?:senator|sen\.|rep\.|congressman|congresswoman|governor|mayor|president|minister|lawmaker|mp)\b/i],
];
const ROLE_NEAR_WORDS = 2;
/**
 * A person's role as its own headlines call it: the role word right before the name ("Kick streamer Jack Doherty", "pop star ..."),
 * the commonest of them; else what Wikipedia's roster says, else what the engine's tier says; undefined when nothing says. A role
 * word elsewhere in the line is someone else's ("Pete Davidson mocks influencers").
 */
function roleOf(name, titles, { creator = false, tier = null, kind = null, rosterDesc = '' } = {}) {
  const key = keyOf(name);
  const counts = new Map();
  for (const title of titles || []) {
    const text = ` ${keyOf(title)} `;
    const at = text.indexOf(` ${key} `);
    if (at < 0) continue;
    const before = text.slice(0, at).trim().split(' ').slice(-ROLE_NEAR_WORDS);
    // (the role ends right at the name: its last word, or its last two)
    for (const [role, re] of ROLES) if (re.test(before.slice(-1).join(' ')) || (before.length === 2 && new RegExp(`^(?:${re.source})$`, 'i').test(before.join(' ')))) counts.set(role, (counts.get(role) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || ROLES.findIndex((r) => r[0] === a[0]) - ROLES.findIndex((r) => r[0] === b[0]))[0];
  if (best) return best[0];
  const listed = ROLES.find(([, re]) => re.test(rosterDesc || ''));
  if (listed) return listed[0];
  if (creator) return 'creator';
  if (tier === 'sports' || kind === 'sports') return 'athlete';
  if (kind === 'music') return 'musician';
  return undefined;
}

// what a creator follows besides a person: the platform, the show, the game, the league a row names
const FOLLOWABLE = ['twitch', 'kick', 'youtube', 'tiktok', 'instagram', 'onlyfans', 'netflix', 'hbo', 'disney', 'marvel', 'snl', 'nfl', 'nba', 'mlb', 'nhl', 'wnba', 'ufc', 'wwe', 'f1',
  'minecraft', 'fortnite', 'roblox', 'gta', 'valorant', 'call of duty', 'love island', 'love island usa', 'big brother', 'the traitors', 'spotify', 'stanley', 'labubu', 'halloween', 'christmas',
  'vmas', 'grammys', 'oscars', 'emmys', 'met gala', 'coachella', 'complexcon', 'twitchcon', 'ai'];
const KIND_WORD = /\s+(?:trend|trends|meme|memes|challenge|sound|audio|song|filter)$/i;
const TAGS_MAX = 12;
const NOBODY = new Set(['jane doe', 'john doe']);
const PEOPLE_MAX = 4;
const MOMENT_NAME_WORDS = 3;

/** The name people would follow a word, a sound or a format by: its title without the kind word ("Stop the wedding trend" -> "Stop the wedding"). */
const ownName = (title) => { const bare = String(title || '').replace(KIND_WORD, '').trim(); return bare.split(/\s+/).length >= 1 && bare ? bare : String(title || ''); };

/**
 * Who and what a row is about: { people: [{ key, name, role? }] (0-4: the subject, the new chapter's name, another its own line names), tags (0-12 normalised keys: the subject, the other names its
 * coverage gives, the platform, show, game or brand it names; never the card's noun), topic ({ key, name }: the one thing to follow
 * on a row with no person, or undefined) }. roster: the engine's creators (Map(key -> { name, desc })).
 */
function aboutOf(row, roster = null) {
  const meta = row.meta || {};
  const titles = (meta.own || []).map((r) => r.title).filter(Boolean);
  const people = [];
  const addPerson = (name, extra = {}) => {
    const key = keyOf(name);
    if (!key || people.some((p) => p.key === key) || people.length >= PEOPLE_MAX) return;
    const role = roleOf(name, titles, extra);
    people.push({ key, name, ...(role ? { role } : {}) });
  };
  const text = keyOf(`${row.title} ${row.line || ''}`);
  // (names its coverage gives that the card itself does not: followed, they find the row; they are not who it is about)
  const beside = [];
  if (row.type === 'point' && !row.wordish) {
    const p = row.point;
    const listed = roster && roster.get(keyOf(row.subject));
    if (meta.person || listed) addPerson(row.surface || p.subject, { creator: !!meta.creator || !!listed, tier: p.tier, kind: p.kind, rosterDesc: listed ? listed.desc : '' });
    const chapter = meta.timeline && meta.timeline.chapter ? meta.timeline.chapter.name : null;
    if (chapter) addPerson(chapter);
    const lastOf = (k) => k.split(' ').slice(-1)[0];
    for (const other of meta.also || []) {
      // (the same person under a longer or a shorter name, or nobody at all: "Christa Gail Pike", "Gypsy Rose", "Jane Doe")
      if (NOBODY.has(other) || people.some((p) => ` ${p.key} `.includes(` ${other} `) || ` ${other} `.includes(` ${p.key} `) || (lastOf(p.key) === lastOf(other) && p.key.split(' ')[0] === other.split(' ')[0]))) continue;
      // (as its headlines spell it: the engine keeps the key; the first headline that carries it gives the spelling)
      const shown = titles.map((t) => (t.match(new RegExp(other.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\'’-]+'), 'i')) || [])[0]).find(Boolean);
      // (who the row is about is who its own title or line names. A name that only shares the subject's week of headlines is a tag:
      // the benchmark row offered "Kevin Hart" to follow beside Kai Cenat on the first joined run, and so a menu for a button)
      if (!` ${text} `.includes(` ${other} `)) { beside.push(other); continue; }
      const listedOther = roster && roster.get(other);
      addPerson(shown || other.replace(/\b\p{L}/gu, (c) => c.toUpperCase()), { creator: !!listedOther, rosterDesc: listedOther ? listedOther.desc : '' });
    }
  } else if (row.type === 'moment' && row.subject && /\s/.test(row.subject.trim())) {
    const listed = roster && roster.get(keyOf(row.subject));
    const extra = { creator: !!listed, rosterDesc: listed ? listed.desc : '' };
    // (a moment's subject is a person when the roster lists it, its headlines give it a role or it opens with a given name; a team,
    // a place with a plain word after it or a longer thing is none: "Arizona State cheerleader shoved ..." is no one to follow, it is
    // the row's topic. "Paris Hilton" is still a person: no dictionary knows her surname)
    const ws = keyOf(row.subject).split(' ');
    const placed = R.PLACES.has(ws[0]) && W.inDict(ws[ws.length - 1]);
    const person = !!listed || !!roleOf(row.subject, titles, extra) || W.isFirstName(ws[0]) || (ws.length <= MOMENT_NAME_WORDS && !R.isPlaceOrTeam(ws.join(' ')) && !placed);
    if (person) addPerson(row.subject, extra);
  }
  const tags = [];
  const add = (t) => { const k = keyOf(t); if (k && k.length >= 2 && !tags.includes(k) && tags.length < TAGS_MAX) tags.push(k); };
  for (const p of people) add(p.key);
  for (const other of beside) add(other);
  let topic;
  if (!people.length) {
    // (a word's own name; a story's subject without the card's noun: "Gatorade", never "Gatorade recall")
    const noun = keyOf(row.noun || '');
    const bare = (n) => (noun && keyOf(n).endsWith(` ${noun}`) ? n.trim().split(/\s+/).slice(0, -noun.split(' ').length).join(' ') : n);
    const name = row.wordish ? ownName(row.type === 'word' ? row.title : row.point.title) : row.type === 'point' ? bare(row.surface || row.subject || '') : row.type === 'moment' ? (row.subject || '').trim() : null;
    if (name && keyOf(name)) { topic = { key: keyOf(name), name: name.charAt(0).toUpperCase() + name.slice(1) }; add(topic.key); }
  }

  for (const f of FOLLOWABLE) if (` ${text} `.includes(` ${f} `) || titles.filter((t) => ` ${keyOf(t)} `.includes(` ${f} `)).length >= Math.max(3, 0.2 * titles.length)) add(f);
  return { people, tags, ...(topic && tags.includes(topic.key) ? { topic } : {}) };
}

// ---------- examples ----------
const QUERY_MAX = 60;
const QUERY_NOISE = new Set(['viral', 'goes', 'went', 'video', 'clip', 'internet', 'reacts', 'react', 'moment', 'after', 'with', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'his',
  'her', 'their', 'is', 'as', 'over', 'amid', 'from', 'by', 'that', 'this', 'says', 'said']);
const cutQuery = (q) => { const ws = q.trim().split(/\s+/); let out = ''; for (const w of ws) { if (`${out} ${w}`.trim().length > QUERY_MAX) break; out = `${out} ${w}`.trim(); } return out || q.slice(0, QUERY_MAX).trim(); };
/** A title as people type it: lowercase, its punctuation off ("$250K" keeps its sign). */
const asTyped = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]s\b/g, 's').replace(/['’]/g, '').replace(/[^a-z0-9$#]+/g, ' ').trim();
/** The searches "See examples" opens: { tiktok, youtube }, plain text, 60 characters at most. A search, not a citation. */
function examplesOf(row) {
  if (row.type === 'moment') {
    const subject = asTyped(row.subject);
    const rest = asTyped(row.title).split(' ').filter((w) => !QUERY_NOISE.has(w) && !subject.split(' ').includes(w)).slice(0, 2);
    const q = cutQuery([subject, ...rest].filter(Boolean).join(' ') || asTyped(row.title));
    return { tiktok: q, youtube: q };
  }
  const q = cutQuery(asTyped(row.title));
  if (row.kind === 'sound') { const name = cutQuery(asTyped(ownName(row.title))); return { tiktok: cutQuery(`${name} sound`), youtube: q }; }
  return { tiktok: q, youtube: q };
}

// ---------- the app's own card input ----------
/** Curly quotes and apostrophes as the cards print them ("Ethan’s Clubhouse", never a straight one beside curly quotes). */
const straight = (s) => String(s || '').replace(/(\p{L})'(\p{L})/gu, '$1’$2');
const withoutFullStop = (line) => (line && line.endsWith('.') && !line.endsWith('..') ? line.slice(0, -1) : line);
const nonEmpty = (s) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);
/** A sensitive word's why from its meaning (MVPCore IdeaCardInput.sensitiveWhy(meaning:)). */
function sensitiveWhyOfMeaning(meaning) {
  const m = String(meaning || '').toLowerCase();
  if (!m) return undefined;
  if (/\b(died|dies|death|dead|killed|overdos\w*|suicid\w*|funeral|tragedy|tragic)\b/.test(m)) return 'tragedy';
  if (/\b(arrest\w*|handcuffs?|charged|police|threats?|crimes?|criminal|jail|prison|stabb\w*|shoot\w*|rap(?:e|ed|es|ing|ist)|indict\w*|convict\w*)\b/.test(m)) return 'crime';
  if (/\b(assault\w*|attack\w*|violen\w*|fights?|beat(en|ing)?)\b/.test(m)) return 'violence';
  return undefined;
}
/** Encoded as MVPCore IdeaCardInput encodes itself: absent facts left out, `sensitive` and `isTalkingPoint` only when true. */
function encodeIdea({ id, kind, title, wordKind, meaning, story, moment, why, sensitive, sensitiveWhy, isTalkingPoint }) {
  const out = { id, kind, title };
  const put = (k, v) => { const x = nonEmpty(v); if (x !== undefined) out[k] = x; };
  put('wordKind', wordKind);
  put('meaning', meaning);
  put('story', story);
  put('moment', moment);
  put('why', why);
  if (sensitive) { out.sensitive = true; put('sensitiveWhy', sensitiveWhy); }
  if (isTalkingPoint) out.isTalkingPoint = true;
  return out;
}
const wordIdea = (w, id, extra = {}) => encodeIdea({ id, kind: w.kind === 'trend' ? 'trend' : 'word', title: extra.title || w.term, wordKind: w.kind, meaning: w.meaning, why: w.whyNow, sensitive: !!w.sensitive,
  sensitiveWhy: w.sensitive ? sensitiveWhyOfMeaning(w.meaning) || sensitiveWhyOfMeaning(w.whyNow) : undefined, ...extra });
/**
 * What the app's idea writer needs (MyVideoPal IdeaCardPlan.input): `id` is the card key, so the same card gets the same ideas from the
 * feed and from the fallback (E4).
 */
function ideaOf(row) {
  const id = row.cardKey;
  // (a word's, a meme's or a format's ideas name it as its card does: the row's own title in its own sentence case, without the
  // kind word. "Black cat clapping", never the source's "Black Cat Clapping" under that title, nor "the 'Stop the wedding trend' sound")
  const named = row.wordish || row.type === 'word' ? straight(ownName(row.title)) : null;
  if (row.type === 'word') return wordIdea(row.word, id, { title: named });
  if (row.type === 'moment') {
    const m = row.moment;
    return encodeIdea({ id, kind: 'story', title: m.headline, story: nonEmpty(m.story) || m.headline, moment: m.moment, why: m.why, sensitive: !!m.sensitive, sensitiveWhy: m.sensitiveWhy });
  }
  const p = row.point;
  const line = withoutFullStop(row.line || p.what || '');
  if (row.wordish) {
    if (row.word) return wordIdea(row.word, id, { isTalkingPoint: true, title: named });
    const trend = p.kind === 'craze' || p.kind === 'meme';
    return encodeIdea({ id, kind: trend ? 'trend' : 'word', title: named || p.title, wordKind: trend ? 'trend' : p.kind === 'sound' ? 'sound' : 'word', meaning: line, sensitive: !!p.sensitive,
      sensitiveWhy: p.sensitiveWhy, isTalkingPoint: true });
  }
  const m = row.moment;
  return encodeIdea({ id, kind: 'story', title: p.title, story: line, moment: m ? m.moment || m.headline : line, why: m && m.why ? m.why : p.latest ? p.latest.text : undefined,
    sensitive: !!p.sensitive, sensitiveWhy: p.sensitiveWhy, isTalkingPoint: true });
}

// The engine's one word list calls both a death and an accusation of sexual violence or abuse a "tragedy". The phone reads the word as
// a death or a loss (For you never lifts one, E5; nothing alerts on one), and people-drama is mostly accusations.
const WRONGED = /\b(?:rape\w*|sexual(?:ly)? assault\w*|abuse\w*|molest\w*)\b/i;
const LOSS = /\b(?:dies|died|dead|deaths?|killed|killing|murder\w*|homicide|suicid\w*|overdose|funeral|obituary|memorial|tribute|pass(?:ed|es) away|cremat\w*|shooting|shot|fatal\w*|tragic|cancer|hospitali[sz]ed|grief|mourn\w*)\b/i;
/**
 * { sensitive, sensitiveWhy } as the feed carries them (both absent when the row is not flagged). A talking point is a "tragedy" only
 * when it is one: its noun is a grim or somber one, or its title or line tells a death or a loss. One the engine calls so for a word
 * of sexual violence or abuse in its line alone is a "crime" (live 2026-10-11: "Myron Gaines backlash", over what he said of an
 * assault case, went out as a tragedy, so For you would not lift it and a follower of his would never have heard of it).
 */
function sensitiveOf(row) {
  const src = row.type === 'word' ? row.word : row.type === 'moment' ? row.moment : row.point;
  if (!src || !src.sensitive) return {};
  let why = src.sensitiveWhy || (row.type === 'word' ? sensitiveWhyOfMeaning(src.meaning) : undefined);
  const said = `${row.title || ''}. ${row.line || src.what || ''}`;
  if (why === 'tragedy' && row.type === 'point' && !row.wordish && !isGrim(row) && !isSomber(row) && WRONGED.test(said) && !LOSS.test(said)) why = 'crime';
  return { sensitive: true, ...(['tragedy', 'crime', 'violence', 'unsafe', 'politics'].includes(why) ? { sensitiveWhy: why } : {}) };
}

// ---------- demand, and why it is hot ----------
const COUNTRY = { US: 'the US', GB: 'the UK', AU: 'Australia', CA: 'Canada' };
// (on a card the country goes before the noun, so the row stays one line: "100K+ UK searches")
const COUNTRY_SHORT = { US: 'US', GB: 'UK', AU: 'Australian', CA: 'Canadian' };
const LISTED_LABEL = 'TikTok trend';
const SEARCH_DEMAND_MIN = 5000;
const ABROAD_DEMAND_MIN = 20000;
const READS_DEMAND_MIN = 50000;
const OUTLET_STEPS = [5, 10, 20, 40, 80];
const READS_STEPS = [50000, 100000, 200000, 500000, 1000000, 2000000, 5000000];
/** 100000 -> "100K", 2000000 -> "2M". */
const short = (n) => (n >= 1e9 ? `${trim1(n / 1e9)}B` : n >= 1e6 ? `${trim1(n / 1e6)}M` : n >= 1e3 ? `${trim1(n / 1e3)}K` : String(n));
const trim1 = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, '');
const stepUnder = (steps, n) => [...steps].reverse().find((s) => n >= s) || null;
/** Outlets that told the story itself (a name in the news every day lends its week to no one), else the name's when the card has no noun. */
const outletsOf = (row) => { const meta = row.meta || {}; return row.type === 'point' && !row.wordish ? (row.family ? meta.outletsOwn || 0 : meta.outletsAll || 0) : new Set((meta.own || []).filter((r) => r.outlet && r.fam !== 'reddit').map((r) => r.outlet.toLowerCase())).size; };
/** A row's biggest search per country, from the searches the engine tied to it: Map(geo -> { volume, growth, keyword, live }). */
function searchesOf(row, { shown = false } = {}) {
  const by = new Map();
  // (shown: a figure a card carries. A moment titled by one headline carries only the searches that are that headline's own, never
  // the wider search its subject has: lib/desk.js momentSearches)
  const own = shown && row.type === 'moment' && row.meta && Array.isArray(row.meta.headSearches) ? new Set(row.meta.headSearches) : null;
  for (const t of (row.meta && row.meta.trends) || []) {
    if (own && !own.has(t.key)) continue;
    const old = by.get(t.geo);
    if (!old || t.volume > old.volume) by.set(t.geo, { volume: t.volume || 0, growth: t.growth || 0, keyword: t.keyword, live: t.end === null });
  }
  return by;
}
/**
 * The demand number (D3), or null: a search at home, else a search abroad said where, else Wikipedia reads, else outlets in steps,
 * else "TikTok trend" for what the month's crazes page lists (a kind, not a measure: the page gives no number). Never a count of
 * videos, creators' or anyone's. Short enough that the card's row stays one line beside "Started ..." (reviewers, 2026-10-12).
 */
function demandOf(row, audience) {
  const by = searchesOf(row, { shown: true });
  const home = homeGeos(audience).map((geo) => ({ geo, ...(by.get(geo) || { volume: 0 }) })).sort((a, b) => b.volume - a.volume)[0];
  if (home && home.volume >= SEARCH_DEMAND_MIN) return { label: `${short(home.volume)}+ searches`, kind: 'search', value: home.volume, geo: home.geo };
  const away = [...by.entries()].filter(([geo]) => !homeGeos(audience).includes(geo)).map(([geo, x]) => ({ geo, ...x })).sort((a, b) => b.volume - a.volume)[0];
  if (away && away.volume >= ABROAD_DEMAND_MIN && COUNTRY[away.geo]) return { label: `${short(away.volume)}+ ${COUNTRY_SHORT[away.geo]} searches`, kind: 'search', value: away.volume, geo: away.geo };
  const reads = (row.meta && row.meta.wiki) || 0;
  if (reads >= READS_DEMAND_MIN) return { label: `${short(stepUnder(READS_STEPS, reads))}+ Wikipedia reads`, kind: 'reads', value: reads };
  const outlets = outletsOf(row);
  if (outlets >= OUTLET_STEPS[0]) return { label: `${stepUnder(OUTLET_STEPS, outlets)}+ outlets`, kind: 'outlets', value: outlets };
  if (row.meta && row.meta.listedBy === 'crazes') return { label: LISTED_LABEL, kind: 'listed' };
  return null;
}
/** Whether the only demand a row has for this audience is another country's searches: it is kept off that audience's first page (lib/desk.js). */
const awayOnly = (row, audience) => { const d = demandOf(row, audience); return !!d && d.kind === 'search' && !homeGeos(audience).includes(d.geo); };
/** The largest search the row has had in the audience's own countries (0 when none): what "a 50K home search" and "100K+" read. */
const homeSearchOf = (row, audience) => { const by = searchesOf(row); return Math.max(0, ...homeGeos(audience).map((g) => (by.get(g) || { volume: 0 }).volume)); };

const WHY_MAX = 6;
/**
 * Why it is hot, one plain line each, the demand first (D4). No count of creator videos: "Creators are already posting about it".
 */
function whyOf(row, audience) {
  const meta = row.meta || {};
  const out = [];
  const by = searchesOf(row, { shown: true });
  const best = [...by.entries()].map(([geo, x]) => ({ geo, ...x })).sort((a, b) => (homeGeos(audience).includes(b.geo) ? 1 : 0) - (homeGeos(audience).includes(a.geo) ? 1 : 0) || b.volume - a.volume)[0];
  if (best && best.volume >= SEARCH_DEMAND_MIN && COUNTRY[best.geo]) out.push(`${short(best.volume)}+ Google searches for “${best.keyword}” in ${COUNTRY[best.geo]}${best.growth >= 100 ? `, up ${Math.round(best.growth)}%` : ''}`);
  const outlets = outletsOf(row);
  // (the one figure the card's own row gives: "10+ outlets" there is never "13 outlets" here)
  if (outlets >= 2) out.push(`Covered by ${outlets >= OUTLET_STEPS[0] ? `${stepUnder(OUTLET_STEPS, outlets)}+` : outlets} outlets`);
  const own = meta.own || [];
  if (own.some((r) => r.k === 'upload')) out.push('Creators are already posting about it');
  const typed = (meta.fresh || []).map((q) => q.replace(/\s+\S$/, '').trim()).find((q) => q.split(' ').length >= 2);
  if (typed) out.push(`People are typing “${typed}” into YouTube`);
  const posts = own.filter((r) => r.k === 'post');
  const week = Math.min(Infinity, ...posts.map((r) => (Number.isFinite(r.week) ? r.week + 1 : Infinity)));
  const day = Math.min(Infinity, ...posts.map((r) => (Number.isFinite(r.rank) ? r.rank + 1 : Infinity)));
  const creators = posts.some((r) => r.sub === 'livestreamfail' || r.sub === 'youtubedrama');
  const board = creators ? 'Reddit’s streamer and drama boards' : 'Reddit';
  if (week === 1) out.push(`The week’s top post on ${board}`);
  else if (week <= 25) out.push(`A top ${week <= 10 ? 10 : 25} post this week on ${board}`);
  else if (day <= 10) out.push(`A top ${day <= 3 ? 3 : 10} post today on ${board}`);
  if ((meta.wiki || 0) >= READS_DEMAND_MIN) out.push(`Its Wikipedia page was read ${short(stepUnder(READS_STEPS, meta.wiki))}+ times in a day`);
  if (meta.listedBy === 'crazes') out.push('Listed among this month’s TikTok trends');
  if (meta.listedBy === 'kym') out.push('One of Know Your Meme’s memes of the week');
  return out.slice(0, WHY_MAX);
}

/** Grim (no alert, no Early tag, no time left) and somber (no time left): by the card's noun, as the hot list reads them. */
function isGrim(row) { return HL.GRIM.has(row.noun || ''); }
function isSomber(row) { return HL.SOMBER.has(row.noun || ''); }

module.exports = { matchedTopics, topicsOf, subOf, roleOf, aboutOf, ownName, examplesOf, asTyped, ideaOf, encodeIdea, sensitiveOf, demandOf, awayOnly, homeSearchOf, searchesOf, outletsOf, whyOf, short,
  isGrim, isSomber, TOPIC_ORDER };
