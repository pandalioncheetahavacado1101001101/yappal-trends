'use strict';
/*
 * Which of a row's topics For you may rank by (ios/IDEAS-FEED.md K1): `topicsSure`. A row's `topics` are filed by the words of
 * its coverage, which is too loose to rank by ("sponsorship deal" filed a ban under shopping). This is the phone's own bar
 * (MVPCore IdeasTopicTrust), list for list, with the two things only the collector has: a role counts only when the creators'
 * roster gives it (never one guessed from a headline), and a topic's word that the row's own headlines keep saying counts as
 * its line does.
 *
 *   1. what the row is: a word or a sound is internet culture, a sound is music too, a show is the screen, a sports story
 *      sport, a product shopping, a people-drama talking point celebs and drama;
 *   2. what its card says: a word of the topic's own list standing whole in its title; or, on a talking point or a moment, in
 *      its line or in three of its headlines and three in ten of them, when `topics` carries that topic too;
 *   3. who it is about: a musician, an actor or an athlete by the roster, when `topics` carries that topic too.
 *
 * Pure: no I/O, nothing but its arguments.
 */
const { keyOf } = require('./util');

const TOPICS = ['celebs', 'memes', 'music', 'screen', 'sports', 'beauty', 'food', 'lifeHacks', 'lifestyle', 'shopping'];
const SURE_MAX = 4;

// A topic's own words, one normalised word each ("mcdonald's" reads "mcdonald"). Short on purpose: a word that is also an
// everyday one ("deal", "money", "boss", "family", "store") is in none. No list for celebs or memes: rule 1 only.
const WORDS = Object.fromEntries(Object.entries({
  music: 'song songs album albums concert concerts lyrics lyric remix spotify billboard karaoke kpop rapper singer choreography dance dances dancing coachella grammy grammys mixtape playlist',
  screen: 'movie movies film films trailer episode episodes netflix hbo disney marvel pixar anime sitcom premiere sequel reboot snl finale novel novels booktok oscars emmys',
  sports: 'nfl nba mlb nhl wnba mls ufc wwe f1 football soccer basketball baseball hockey tennis golf boxing olympics olympic quarterback touchdown playoff playoffs workout workouts gym fitness marathon pilates',
  beauty: 'makeup skincare lipstick mascara blush manicure nails haircut hairstyle hairstyles fashion outfit outfits perfume fragrance runway sephora ulta grwm',
  food: 'food foods foodie recipe recipes cooking chef chefs restaurant restaurants snack snacks coffee latte matcha pizza burger burgers fries mcdonald mcdonalds starbucks taco tacos sushi baking bakery cake cakes cookie cookies dessert desserts lunch breakfast brunch meal meals candy chocolate pasta noodles ramen sandwich sandwiches smoothie mukbang cocktail cocktails',
  lifeHacks: 'productivity routine routines mindset wellness habit habits budgeting',
  lifestyle: 'travel vacation apartment decor vlog vlogs vlogging parenting roommate roommates toddler puppy kitten thrifting millennial millennials',
  shopping: 'haul hauls unboxing dupe dupes walmart costco ikea labubu merch temu shein aldi sephora',
}).map(([topic, words]) => [topic, new Set(words.split(' '))]));

// A topic's own phrases, normalised: found as whole words.
const PHRASES = {
  music: ['k pop', 'music video', 'halftime show'],
  screen: ['box office', 'tv show', 'tv series'],
  sports: ['world cup', 'super bowl', 'world series', 'formula 1', 'premier league', 'grand prix'],
  beauty: ['skin care', 'get ready with me'],
  food: ['ice cream', 'fast food', 'air fryer'],
  lifeHacks: ['life hack', 'life hacks', 'self improvement', 'self care'],
  lifestyle: ['day in my life', 'day in the life', 'gen z', 'gen alpha'],
  shopping: ['sold out', 'black friday', 'prime day', 'tiktok shop'],
};
// A word that ends so is a self-improvement craze, whatever leads it ("looksmaxxing").
const HACK_SUFFIX = 'maxxing';
// What a role says a story may be about. A creator's or a streamer's says nothing: they make anything.
const ROLE_TOPIC = { musician: 'music', actor: 'screen', athlete: 'sports' };
// The finer kinds that are a topic by what they are.
const SUB_TOPIC = { music: 'music', show: 'screen', sports: 'sports', product: 'shopping' };
const HEADLINE_VOTES = 3;
const HEADLINE_SHARE = 0.3;

/** The topics a text's own words say: a word or a phrase of a topic's list standing whole in it. */
function saidBy(text) {
  const key = keyOf(text);
  const out = new Set();
  if (!key) return out;
  const tokens = key.split(' ');
  for (const [topic, list] of Object.entries(WORDS)) if (tokens.some((w) => list.has(w))) out.add(topic);
  for (const [topic, list] of Object.entries(PHRASES)) if (!out.has(topic) && list.some((p) => ` ${key} `.includes(` ${p} `))) out.add(topic);
  if (tokens.some((w) => w.length > HACK_SUFFIX.length && w.endsWith(HACK_SUFFIX))) out.add('lifeHacks');
  return out;
}

/** Rule 1: the topics a row is by what it is. */
function structural({ kind, sub, drama, tier }) {
  const out = new Set();
  if (kind === 'word' || kind === 'sound') out.add('memes');
  if (kind === 'sound') out.add('music');
  if (SUB_TOPIC[sub]) out.add(SUB_TOPIC[sub]);
  if (tier === 'sports') out.add('sports');
  if (drama) out.add('celebs');
  return out;
}

/** The topics a story's own headlines keep saying: a topic's word in three of them and three in ten of them. */
function headlinesSay(headlines) {
  const heads = (headlines || []).filter((h) => typeof h === 'string' && h.trim());
  const out = new Set();
  if (heads.length < HEADLINE_VOTES) return out;
  const votes = new Map();
  for (const h of heads) for (const topic of saidBy(h)) votes.set(topic, (votes.get(topic) || 0) + 1);
  for (const [topic, n] of votes) if (n >= HEADLINE_VOTES && n >= HEADLINE_SHARE * heads.length) out.add(topic);
  return out;
}

/**
 * A row's `topicsSure` (0-4 ContentTopic raw values, in the chips' order). item: the published row's own kind, sub, drama, tier,
 * title, line and topics. headlines: the row's own headlines' titles. rosterRoles: the roles the creators' roster gives its people.
 */
function sureOf(item, { headlines = [], rosterRoles = [] } = {}) {
  const filed = new Set(item.topics || []);
  const story = item.kind === 'talk' || item.kind === 'moment';
  // (a word's or a sound's line is its meaning, and a meaning names props: its title and what it is are all that count)
  const told = story ? new Set([...saidBy(item.line || ''), ...headlinesSay(headlines)]) : new Set();
  for (const role of rosterRoles) if (ROLE_TOPIC[role]) told.add(ROLE_TOPIC[role]);
  const sure = new Set([...structural(item), ...saidBy(item.title || ''), ...[...told].filter((t) => filed.has(t))]);
  return TOPICS.filter((t) => sure.has(t)).slice(0, SURE_MAX);
}

module.exports = { sureOf, saidBy, structural, headlinesSay, TOPICS, WORDS, PHRASES };
