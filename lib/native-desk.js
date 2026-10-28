'use strict';
/*
 * What the creator-native signals are made into (ios/IDEAS-FEED.md L10). Pure: people with their signals go in (lib/native-signals.js);
 * out come
 *   rows      a creator's story no outlet has told yet, as a row the series can tag Early: two independent kinds of signal inside
 *             six hours of each other, a title "<name> <noun>" whose noun the signals themselves say, and one line built from what
 *             they say, told as reported (a video's title is its maker's claim; a ban flag is a fact with no reason);
 *   attached  the same signals on the rows the engine already lists for that person, so their samples, their status and their graph
 *             read the creators' side, and the page can lead with the stories creators are actually talking about;
 *   research  the names worth their own search this cycle;
 *   ride      the name searches of a cycle with the drama names whose headlines are growing put ahead of the cold backlog.
 * A creator's story told only natively also lists when two INDEPENDENT voices tell it inside two days (lib/native-signals.js
 * `told`): two commentary channels, two posts, or one of each, every one of which says the story's noun or trouble with no other
 * noun. Its line says where it is being said and quotes a title as its maker wrote it. The fastest of them (three voices inside
 * six hours, a clip climbing or big, videos gaining views fast) are put among the page's own rows, where the desk weighs them.
 * Nothing here is a headline. A row made here has no outlet, no search and no "Reported by": it says so by what it carries.
 */
const TN = require('../engine/talk-nouns');
const NS = require('./native-signals');
const { naturalKey } = require('./identity');
const TS = require('../engine/talk-sources');
const W = require('../engine/wording');
const { keyOf, HOUR } = require('./util');

// (eighteen hours, as lib/measure.js K.EARLY_KIND_SPAN reads it since 2026-10-12)
const KIND_SPAN = 18 * HOUR;
const YOUNG = 30 * HOUR;
const LIVE_WITHIN = 12 * HOUR;
const LINE_MAX = 200;
const TITLE_WHOLE = 140;
const HEAT_BASE = 12;
const HEAT_PER_KIND = 6;
const HEAT_PER_ITEM = 2;
const HEAT_ITEMS_MAX = 8;
// (always under the heat a row is on the page for in its own right: a row made here is unproven by construction. lib/history.js PAGE_OWN_HEAT)
const HEAT_MAX = 38;
const RESEARCH_PER_CYCLE = 4;
const ROWS_PER_CYCLE = 6;
const ITEMS_KEPT = 24;
// a story told only natively (`told`): two independent voices, the newest inside a day (commentary uploads come at a day's pace)
const VOICES_MIN = 2;
const VOICED_LIVE = 24 * HOUR;
const HEAT_PER_VOICE = 4;
const HEAT_VOICES_MAX = 4;
// fast: two voices or more inside the last six hours, and a third, or one of its clips climbing, or its videos gaining views fast.
// Such a row is put among the page's own rows (lib/desk.js order: `wasOnPage`), two a cycle at most; the desk still weighs it.
// (a clip's score alone is no speed: half of LivestreamFails' clips under twelve hours old have a thousand points, 2026-10-27)
const FAST_SPAN = 6 * HOUR;
const FAST_RECENT = 2;
const FAST_VOICES = 3;
const FAST_CLIP_AN_HOUR = 200;
const FAST_VIEWS_AN_HOUR = 20000;
const HEAT_FAST = 4;
const PAGE_RANK = 20;
const PAGE_ROWS_MAX = 2;
const KIND_OF_ITEM = { upload: 'creators', clip: 'clips', post: 'reddit' };
// (what a person's own answer to a claim is titled with: "<name> denies", "<name> responds", "<name> suing <other>")
const ANSWER_SAID = /\b(?:denies|denied|deny|denying|responds?|responding|addresses|addressing|sues|suing|sued|clears? (?:his|her|their) name|speaks out|breaks (?:his|her) silence)\b/i;
// name searches: a drama name waiting in the backlog whose headlines grew (two or more in the last six hours, more than the six
// before) rides ahead of the names first met this cycle, four a cycle at most: the cycle's ten searches stay ten
const RIDE_MAX = 4;
const RIDE_SPAN = 6 * HOUR;
const RIDE_MIN = 2;
const RIDE_WORDS = 3;
// the order a line is told in: what the platform shows, what creators made, what was clipped, what is argued, what is asked
const TELL_ORDER = ['platform', 'creators', 'clips', 'reddit', 'asked'];
const BOARD = { livestreamfail: 'r/LivestreamFail', youtubedrama: 'r/youtubedrama', fauxmoi: 'r/Fauxmoi', popculturechat: 'r/popculturechat', tiktokcringe: 'r/TikTokCringe', outoftheloop: 'r/OutOfTheLoop',
  kaicenat: 'r/Kaicenat', hiphopheads: 'r/hiphopheads', beautyguruchatter: 'r/BeautyGuruChatter', subredditdrama: 'r/SubredditDrama', ontd: 'ONTD' };

const count = (n) => Math.round(n).toLocaleString('en-US');
/** A number said roundly: 12,400 is "about 12,000". */
const about = (n) => { const m = Math.pow(10, Math.max(2, Math.floor(Math.log10(Math.max(1, n))) - 1)); return count(Math.round(n / m) * m); };
const listOf = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** A name as a card prints it: a roster's or its source's own spelling ("blixka", "swivvaneb"), else each word capitalised ("wynory pymith" is "Wynory Pymith"). */
const shown = (p) => p.name || p.key.replace(/(?<![\p{L}\p{N}])\p{L}/gu, (c) => c.toUpperCase());

/** Whether two of a person's kinds were first seen inside six hours of each other, both inside the last thirty hours (C3: corroboration). */
function corroborated(kinds, t) {
  const times = Object.values(kinds).map((k) => k.at).filter((at) => Number.isFinite(at) && t - at <= YOUNG).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] <= KIND_SPAN) return true;
  return false;
}

/** The noun family a person's signals say most, of the ones a row told only by posts and videos may carry; null when they say none. */
function familyOf(p) {
  const top = Object.entries(p.families).filter(([f]) => NS.NATIVE_FAMS.has(f)).sort((a, b) => b[1] - a[1] || (TN.FAMILY.get(b[0]).w || 0) - (TN.FAMILY.get(a[0]).w || 0) || a[0].localeCompare(b[0]))[0];
  return top ? top[0] : null;
}
/** The noun as the title says it ("ban", "allegations", "beef"), from a text of the person's own signals that says the family. */
function nounOf(family, text) {
  const f = TN.FAMILY.get(family);
  if (!f) return null;
  // (asked, never stated: a question about a cancelling is backlash, not a cancelled show)
  if (family === 'quit' && /\bbanned\b/i.test(text || '')) return 'ban';
  if (family === 'backlash' && /getting (?:cancell?ed|hate)|mad at/i.test(text || '')) return 'backlash';
  return f.noun(String(text || ''));
}

/**
 * A person's signals as one family's row may read them: an item that says ANOTHER drama noun and not this one belongs to another
 * story and is left out; a kind with no item left is gone. family: a noun family's key.
 */
function signalsFor(p, family) {
  const f = family ? TN.FAMILY.get(family) : null;
  // (a video that says no noun at all still fits when its title is about trouble: "The Blixlo situation"; his gameplay video does not)
  const fits = (i) => { if (!f || !i.title) return true; if (i.fam !== undefined) return i.fam === null || i.fam === family; const said = NS.familiesOf(i.title); return said.includes(family) || (!said.length && (i.k !== 'upload' || NS.DRAMA_ISH.test(i.title))); };
  const kinds = {};
  // (a clip on LivestreamFails is a post on r/LivestreamFail: the mirror's post of the same id is the same voice, never a second kind)
  const clipIds = new Set(((p.kinds.clips || {}).items || []).map((i) => i.id).filter(Boolean));
  for (const [kind, k] of Object.entries(p.kinds)) {
    const items = k.items.filter((i) => fits(i) && !(kind === 'reddit' && i.id && clipIds.has(i.id)));
    // (a ban is a ban's signal and nobody else's; followers falling say nothing about why and stand beside any story)
    if (kind === 'platform' && k.says.includes('ban') && family && family !== 'quit' && !k.says.some((s) => s.startsWith('dip|'))) continue;
    if (!items.length) continue;
    kinds[kind] = { ...k, items, at: kind === 'creators' ? k.at : Math.min(...items.map((i) => i.t)) };
  }
  return kinds;
}

/**
 * One sentence for a kind of signal, with no full stop: what it says, as reported. brief: without the title it would quote;
 * max: how much of a title is quoted (TITLE_WHOLE: all of it; the default cut otherwise); compact: the title after a colon.
 * A clip or a thread is told by what its title says and where it is, never by how many points or comments it has: the count is
 * no part of the story (judges, 2026-10-12: a card whose one line was a board's score), and stays in the sheet's "why".
 */
function tell(kind, k, p, family, brief = false, { max = undefined, compact = false } = {}) {
  const name = shown(p);
  const f = TN.FAMILY.get(family);
  const saying = (titles) => titles.find((x) => f && TN.says(x, f)) || titles[0];
  if (kind === 'platform') {
    if (k.says.includes('ban')) return `Twitch shows ${name}’s channel as banned`;
    const dip = k.says.find((s) => s.startsWith('dip|'));
    return dip ? `${name}’s Twitch channel lost about ${about(Number(dip.slice(4)))} followers within hours` : null;
  }
  if (kind === 'creators') {
    const channels = [...new Set(k.items.map((i) => i.outlet).filter(Boolean))];
    if (channels.length < 2) return null;
    const title = saying(k.items.map((i) => i.title).filter(Boolean));
    return `${listOf(channels.slice(0, 2))}${channels.length > 2 ? ' and other commentary channels' : ''} posted videos about ${name}${title && !brief ? `; one is titled “${NS.quotable(title, max)}”` : ''}`;
  }
  if (kind === 'clips') {
    const best = [...k.items].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (!best) return null;
    return brief ? 'a clip about it is climbing on r/LivestreamFail' : `a clip on r/LivestreamFail${compact ? ':' : ' is titled'} “${NS.quotable(best.title, max)}”`;
  }
  if (kind === 'reddit') {
    const best = k.items.find((i) => f && TN.says(i.title || '', f)) || k.items[0];
    if (!best) return null;
    return brief ? `a thread about it is drawing comments on ${BOARD[best.sub] || 'Reddit'}` : `a thread on ${BOARD[best.sub] || 'Reddit'}${compact ? ':' : ' is titled'} “${NS.quotable(best.title, max)}”`;
  }
  if (kind === 'asked') {
    const q = saying(k.says);
    return q ? `people are searching “${q}”` : null;
  }
  return null;
}
// (a sentence that opens with a name keeps the name's own spelling: "yolktt and ...", "blixka’s Twitch channel ...")
const capital = (s) => (s && /^(?:a |an |people |the )/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const opening = (s) => (s && /^(?:a |an |clips |threads )/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The one line of a row made here: the two strongest kinds, each told as what its source shows, joined in one line of 200
 * characters at most. null when fewer than two kinds can be told. The titles are what the story is, so as much of them is told
 * as the line holds: both whole; both whole after a colon; both cut; then one of them, whole before cut, the other said without
 * its title; and only last neither.
 */
function lineOf(p, family, kinds) {
  const told = TELL_ORDER.filter((k) => kinds[k]).map((k) => ({ whole: tell(k, kinds[k], p, family, false, { max: TITLE_WHOLE }), tight: tell(k, kinds[k], p, family, false, { max: TITLE_WHOLE, compact: true }),
    full: tell(k, kinds[k], p, family), brief: tell(k, kinds[k], p, family, true) })).filter((x) => x.full && x.brief);
  if (told.length < 2) return null;
  const [a, b] = told;
  // (both as their sources word them; too long, the second and then the first is said without the title it would quote)
  for (const [x, y] of [[a.whole, b.whole], [a.tight, b.tight], [a.full, b.full], [a.whole, b.brief], [a.brief, b.whole], [a.full, b.brief], [a.brief, b.full], [a.brief, b.brief]]) {
    const line = `${capital(x)}, and ${y}.`;
    if (line.length <= LINE_MAX) return line;
  }
  return null;
}

/** Why it is listed, one plain line each, for the sheet: what each kind of signal shows, with the numbers the sources themselves give. */
function whyOf(p, kinds) {
  const out = [];
  if (kinds.platform) out.push(kinds.platform.says.includes('ban') ? 'Twitch shows the channel as banned' : 'The channel is losing followers on Twitch');
  if (kinds.creators) {
    const channels = [...new Set(kinds.creators.items.map((i) => i.outlet).filter(Boolean))];
    out.push(`Commentary channels are posting about it: ${channels.slice(0, 3).join(', ')}`);
    if (Number.isFinite(p.viewsAnHour) && p.viewsAnHour >= 1000) out.push(`Those videos are gaining about ${about(p.viewsAnHour)} views an hour`);
  }
  if (kinds.clips) { const best = [...kinds.clips.items].sort((a, b) => (b.score || 0) - (a.score || 0))[0]; if (best && Number.isFinite(best.score)) out.push(`A clip about it has ${count(best.score)} points on r/LivestreamFail`); }
  if (kinds.reddit) { const sub = kinds.reddit.items[0] && kinds.reddit.items[0].sub; out.push(`People are commenting on it on ${BOARD[sub] || 'Reddit'} right now`); }
  if (kinds.asked) out.push(`People are searching “${kinds.asked.says[0]}”${p.confirmed ? ' on Google and Bing' : ''}`);
  return out;
}

/** What a row carries of a person's signals (`meta.native`): the items by their own times, when each kind was first seen, views an hour, why. */
function nativeMeta(p, kinds, t) {
  const items = Object.values(kinds).flatMap((k) => k.items).filter((i) => Number.isFinite(i.t) && i.t <= t).sort((a, b) => a.t - b.t).slice(-ITEMS_KEPT)
    // (id, who, n: the item's own id, its maker and its source's count, where the signal carries them: what the sheet's example posts
    // are built from, lib/feed.js postsOf, D4 `posts`. Nothing the engine reads)
    .map((i) => ({ t: i.t * 1000, k: i.k, title: i.title || null, outlet: i.outlet || null, ...(i.sub ? { sub: i.sub } : {}), ...(Number.isFinite(i.rank) ? { rank: i.rank } : {}),
      ...(i.id ? { id: String(i.id) } : {}), ...(i.who ? { who: i.who } : {}), ...(Number.isFinite(i.n) ? { n: i.n } : {}) }));
  return { items, kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.at])), viewsAnHour: kinds.creators && Number.isFinite(p.viewsAnHour) ? p.viewsAnHour : null, why: whyOf(p, kinds),
    live: Object.values(kinds).filter((k) => k.items.some((i) => t - i.t <= KIND_SPAN)).length };
}

/**
 * Whether a person can be a row's subject: a creator a roster lists, or a name the sources themselves call a creator that is no
 * dictionary word or lone given name. Never someone who is no creator: a celebrity's story is an outlet's to tell.
 */
const nameable = (p) => p.key.split(' ').length <= 3 && !!p.creator && (p.known || !p.strict);
/**
 * The same, stricter, for a story told only natively: a creator a roster lists, or one the told items themselves call a creator
 * (a clip of their own stream, "streamer <name>": lib/native-signals.js toldCreator). Being named in a clip or a thread is not enough.
 */
// (a one-word name a dictionary spells, or a given name, only where the items call that person a creator: a streamer a roster lists
// under a common surname is not who two celebrity desks' titles name by it)
const voiceable = (p) => p.key.split(' ').length <= 3 && (p.strict ? !!p.toldCreator && p.known : !!p.rostered || !!p.toldCreator);

// ---------- a story told only natively: independent voices ----------
const saysOf = (p, f) => (i) => !!i.title && !!f && TN.says(i.title, f) && !TN.othersSaid(i.title, f, p.key) && !NS.answers(i.title, p.key) && !NS.possessedByOther(i.title, f.key, p.key);
/** The noun family the person's told items say most (a row told by posts and videos may carry it), never one a title gives to someone else; null when none. */
function voicedFamily(p) {
  const votes = {};
  for (const i of p.told || []) for (const fam of NS.familiesOf(i.title)) if (NS.NATIVE_FAMS.has(fam) && saysOf(p, TN.FAMILY.get(fam))(i)) votes[fam] = (votes[fam] || 0) + 1;
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1] || (TN.FAMILY.get(b[0]).w || 0) - (TN.FAMILY.get(a[0]).w || 0) || a[0].localeCompare(b[0]))[0];
  return top ? top[0] : null;
}
/**
 * The voices that tell one family's story of a person: the told items that say its noun, or say trouble and no other noun; one voice
 * per channel or post, and two posts with one title are one voice (a cross-post). null unless VOICES_MIN voices tell it, one of them
 * says the noun, and the newest is inside VOICED_LIVE. { items (oldest first), voices, recent (voices of the last six hours), newest, first,
 * clipRate (the fastest climbing clip of the six hours, points an hour), viewsAnHour (its videos together) }.
 */
function voicesOf(p, family, t) {
  const f = family ? TN.FAMILY.get(family) : null;
  if (!f) return null;
  const says = saysOf(p, f);
  const fits = (i) => { const said = NS.familiesOf(i.title); return says(i) || (!said.length && (i.k !== 'upload' || NS.DRAMA_ISH.test(i.title))); };
  const told = (p.told || []).filter((i) => Number.isFinite(i.t) && i.t <= t);
  const fitting = told.filter(fits);
  if (!fitting.some(says)) return null;
  // (and a title that says another noun of the same story: it names the same other party as one that says this noun. "<name>
  // accused by <other>" and "<name> suing <other>" are one story; "<name> feud with <third>" is another)
  const party = new Set(fitting.filter(says).flatMap((i) => partiesOf(i.title, p.key)));
  const items = [...fitting, ...told.filter((i) => !fitting.includes(i) && partiesOf(i.title, p.key).some((w) => party.has(w)))].sort((a, b) => a.t - b.t);
  // (a channel is one voice however many videos, and two channels of one owner are one voice; a post is one voice, and two posts
  // with one title are one: a cross-post)
  const owners = [];
  const voice = (i) => {
    if (i.k !== 'upload') return `title:${keyOf(i.title)}`;
    const o = owners.find((x) => NS.sameOwner(x, i.outlet)) || i.outlet;
    if (!owners.includes(o)) owners.push(o);
    return `yt:${keyOf(o)}`;
  };
  const voices = new Set(items.map(voice));
  if (voices.size < VOICES_MIN) return null;
  const newest = items[items.length - 1].t;
  if (t - newest > VOICED_LIVE) return null;
  const recent = new Set(items.filter((i) => t - i.t <= FAST_SPAN).map(voice)).size;
  const clips = items.filter((i) => i.k === 'clip');
  const rates = items.filter((i) => i.k === 'upload' && Number.isFinite(i.rate)).map((i) => i.rate);
  return { items, voices: voices.size, recent, newest, first: items[0].t, clipRate: Math.max(-Infinity, ...clips.filter((i) => t - i.t <= FAST_SPAN).map((i) => (Number.isFinite(i.rate) ? i.rate : -Infinity))),
    viewsAnHour: rates.length ? Math.round(rates.reduce((a, b) => a + b, 0)) : null };
}
/** The part of a title of several parts ("<A>! <B>? <C> | <D>") that names the person, or the whole title. */
function clauseOf(title, key) {
  const parts = String(title || '').split(/[!?|•]+\s*|\s[-–—]\s/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return title;
  const k = keyOf(key);
  const mine = parts.find((x) => ` ${keyOf(x)} `.includes(` ${k} `) || keyOf(x).replace(/ /g, '').includes(k.replace(/ /g, '')));
  return mine && mine.split(/\s+/).length >= 3 ? mine : title;
}
/** The other parties a title names beside the person: words of four letters or more no dictionary spells, not the person's own name. */
function partiesOf(title, key) {
  const own = new Set(keyOf(key).split(' '));
  const squeezed = keyOf(key).replace(/ /g, '');
  return keyOf(title).split(' ').filter((w) => w.length >= 4 && !own.has(w) && w !== squeezed && !W.inDict(w) && !/^\d/.test(w));
}
/** The told items as the kinds a row carries (creators, clips, reddit), each first seen at its oldest item. */
function kindsOfVoices(v) {
  const kinds = {};
  for (const i of v.items) {
    const kind = KIND_OF_ITEM[i.k];
    if (!kind) continue;
    const k = kinds[kind] || { at: i.t, items: [], says: [], n: 0 };
    k.at = Math.min(k.at, i.t);
    k.items.push(i);
    k.n += 1;
    kinds[kind] = k;
  }
  return kinds;
}
/** Whether a story told natively is fast: two voices inside the last six hours, and a third, or a clip of the six hours climbing, or its videos gaining views fast. */
const fastOf = (v, t) => !!v && t - v.newest <= FAST_SPAN && v.recent >= FAST_RECENT && (v.recent >= FAST_VOICES || v.clipRate >= FAST_CLIP_AN_HOUR || (v.viewsAnHour || 0) >= FAST_VIEWS_AN_HOUR);

/**
 * The one line of a story told only natively: where it is being said, each kind as what it is ("Commentary channels A and B
 * posted videos about <name>", "clips about it are on r/LivestreamFail"), and one title as its maker wrote it, in quotes: the one that
 * says the noun, the most watched or voted first. Never the claim in our words. 200 characters at most; the quote is cut before it
 * is dropped. null when nothing can be told.
 */
function voicedLine(p, family, kinds, noun = null) {
  const f = TN.FAMILY.get(family);
  const says = saysOf(p, f);
  const all = TELL_ORDER.filter((k) => kinds[k]).flatMap((k) => kinds[k].items);
  if (!all.length) return null;
  // (the person's own answer first, where one is told: a denial, a response, a suit of their own. Claims are told with the denial)
  const answered = (i) => ANSWER_SAID.test(i.title || '') && new RegExp(`(?:^|\\W)${keyOf(p.key).split(' ').join('\\W*')}\\W+(?:\\S+\\W+)?${ANSWER_SAID.source}`, 'i').test(keyOf(i.title || ''));
  const quote = [...all].sort((a, b) => Number(answered(b)) - Number(answered(a)) || Number(says(b)) - Number(says(a)) || (b.n || 0) - (a.n || 0) || b.t - a.t)[0];
  const quotedKind = KIND_OF_ITEM[quote.k];
  const others = TELL_ORDER.filter((k) => kinds[k] && k !== quotedKind).sort((a, b) => kinds[b].items.length - kinds[a].items.length);
  const order = TELL_ORDER.filter((k) => k === quotedKind || k === others[0]);
  // (a roundup's title tells several stories, "<A>! <B> album? <name> suing <other>": the part that names the person is what is
  // quoted, and it is said to be what the item says, not its title)
  const clause = clauseOf(quote.title, p.key);
  // (a quote that does not say the noun of the person, an answer to the claim, is told beside the noun: "videos about <name> and the
  // allegations; one says “<name> suing <other>”", so the title's noun is said of the name in the line itself)
  const name = noun && !says({ title: clause }) ? `${shown(p)} and the ${noun}` : shown(p);
  const verb = clause === quote.title ? { end: 'is titled', mid: 'titled' } : { end: 'says', mid: 'saying' };
  // (a title quoted where its kind is told: "; one is titled" at the end of the line, ", one titled" before the rest of it)
  const part = (kind, first, q, last) => {
    const items = kinds[kind].items;
    const who = first ? name : 'it';
    const one = (text) => (q ? `${text}${last ? `; one ${verb.end}` : `, one ${verb.mid}`} “${q}”` : text);
    if (kind === 'creators') {
      const channels = [...new Set(items.map((i) => i.outlet).filter(Boolean))];
      if (channels.length >= 2) return one(`${listOf(channels.slice(0, 2))}${channels.length > 2 ? ' and other commentary channels' : ''} posted videos about ${who}`);
      return `${channels[0]} posted a video about ${who}${q ? `, ${verb.mid} “${q}”` : ''}`;
    }
    if (kind === 'clips') {
      if (items.length >= 2) return one(`clips about ${who} are on r/LivestreamFail`);
      return q ? `a clip ${first ? `about ${name} ` : ''}on r/LivestreamFail ${verb.end} “${q}”` : `a clip about ${who} is on r/LivestreamFail`;
    }
    const boards = [...new Set(items.map((i) => BOARD[i.sub] || 'Reddit'))];
    if (items.length >= 2) return one(`threads on ${listOf(boards.slice(0, 2))} are about ${who}`);
    return q ? `a thread ${first ? `about ${name} ` : ''}on ${boards[0]} ${verb.end} “${q}”` : `a thread on ${boards[0]} is about ${who}`;
  };
  const named = (s) => ` ${keyOf(s)} `.includes(` ${keyOf(p.key)} `);
  for (const max of [TITLE_WHOLE, 90, 60, 0]) {
    const q = max ? NS.quotable(clause, max) : null;
    const parts = order.map((k, i) => part(k, i === 0, k === quotedKind ? q : null, i === order.length - 1));
    const line = `${opening(parts.join(', and '))}.`;
    if (line.length <= LINE_MAX && parts.some(named)) return line;
  }
  return null;
}

/**
 * The rows made this cycle: [row] in the shape lib/rows.js gives a talking point, for every audience named. A person lists when
 * they can be named, two kinds of signal corroborate inside six hours, the newest signal is inside twelve, the signals say a noun
 * a row told by posts alone may carry, and the engine does not already list them (`taken`: subject keys). Or, a creator's story
 * told only natively, when two independent voices tell it (`voicesOf`): two channels, two posts, or one of each, inside two days.
 * A fast one (`fastOf`) is put among the page's own rows, PAGE_ROWS_MAX a cycle: rank PAGE_RANK, where lib/desk.js order weighs it
 * with the page's stories; the rest sit past the page from `rankFrom`.
 * ctx: { t, audiences, taken: Set, rankFrom: { audience: first free engine rank } }.
 */
function rowsOf(people, { t, audiences = ['US'], taken = new Set(), rankFrom = {} }) {
  const made = [];
  const listed = (key) => listedIn(taken, key);
  // (a story half of whose posts and videos name someone the list already carries is that row's story told again: "<B> brings up
  // <A>" when the list has <B>'s row; "<B>s" is a possessive written without its apostrophe)
  const others = (p, m) => { const titles = Object.values(m.kinds).flatMap((k) => k.items.map((i) => i.title)).filter(Boolean);
    const says = (x, s) => { const k = ` ${keyOf(x)} `; return k.includes(` ${s} `) || k.includes(` ${s}s `); };
    return titles.filter((x) => [...taken].some((s) => s && s !== p.key && s.length >= 4 && says(x, s))).length * 2 >= titles.length; };
  for (const p of people.values()) {
    if (listed(p.key)) continue;
    const m = (nameable(p) && kindsRow(p, t)) || (voiceable(p) && voicedRow(p, t));
    if (m && !others(p, m)) made.push(m);
  }
  made.sort((a, b) => b.heat - a.heat || a.p.key.localeCompare(b.p.key));
  const kept = oneEach(made).slice(0, ROWS_PER_CYCLE);
  const paged = new Set(kept.filter((m) => m.fast).slice(0, PAGE_ROWS_MAX));
  const out = {};
  for (const audience of audiences) {
    let next = rankFrom[audience] || 1;
    out[audience] = kept.map((m) => {
      const surface = shown(m.p);
      const title = `${surface} ${m.noun}`;
      const meta = { key: m.p.key, subject: m.p.key, surface, family: m.family, noun: m.noun, from: 'native', own: [], outletsOwn: 0, outletsAll: 0, trends: [], fresh: [], wiki: null, also: [], creator: true, person: true,
        // (it has no name search to wait for: its signals carry their own times)
        searched: true, newsAt: null, ytAt: null, timeline: { first: null, replies: [], chapter: null, latest: null }, native: nativeMeta(m.voiced ? { ...m.p, viewsAnHour: m.views } : m.p, m.kinds, t) };
      const point = { title, kind: 'story', what: m.line, subject: surface, noun: m.noun, heat: m.heat, status: 'rising', sources: [], tier: 'creator', drama: true, from: 'native', meta };
      const engineRank = paged.has(m) ? PAGE_RANK : next++;
      return { audience, engineRank, kind: 'talk', title, heat: m.heat, engineStatus: 'rising', drama: true, type: 'point', cardKey: `point:${title}`, point, word: null, moment: null, meta, wordish: false,
        line: m.line, subject: m.p.key, surface, family: m.family, noun: m.noun, tier: 'creator', native: true, natural: naturalKey({ kind: 'talk', subject: m.p.key, family: m.family, noun: m.noun, title }), heads: [] };
    });
  }
  return out;
}
/** Whether the list already carries a person: their key, or a subject that holds it or that it holds, word for word. */
const listedIn = (taken, key) => [...taken].some((s) => s === key || ` ${s} `.includes(` ${key} `) || ` ${key} `.includes(` ${s} `));
const STORE_BACK = 72 * HOUR;
/** Whether a store row of the last three days names the person in its title, whole words (store: the engine's store; nowMs: its clock). */
function inStore(store, key, nowMs) {
  if (!store || !store.rows || !Number.isFinite(nowMs)) return false;
  const k = keyOf(key);
  for (const r of store.rows.values()) if (Number.isFinite(r.t) && r.t <= nowMs && nowMs - r.t <= STORE_BACK * 1000 && ` ${keyOf(String(r.title || ''))} `.includes(` ${k} `)) return true;
  return false;
}
/**
 * Counts only, for the cycle's summary (never a name): the stories two independent voices tell this cycle (`voicesOf`), of them
 * the creators' (`voiceable`), of those the ones the list already carries, the unlisted ones the store holds a headline of
 * (store-but-unlisted: the engine read it and left it off), the rows this desk made of them, the fast ones and the ones put among the
 * page's own rows. rows: one audience's rows from rowsOf.
 */
function census(people, { t, taken = new Set(), rows = [], store = null, nowMs = null }) {
  const out = { voiced: 0, creators: 0, listed: 0, stored: 0, rows: 0, fast: 0, paged: 0 };
  const made = new Map(rows.map((r) => [r.subject, r]));
  for (const p of people.values()) {
    if (!voicesOf(p, voicedFamily(p), t)) continue;
    out.voiced += 1;
    if (!voiceable(p)) continue;
    out.creators += 1;
    if (listedIn(taken, p.key)) { out.listed += 1; continue; }
    if (inStore(store, p.key, nowMs)) out.stored += 1;
    const row = made.get(p.key);
    if (!row) continue;
    out.rows += 1;
    const m = voicedRow(p, t);
    if (m && m.fast) out.fast += 1;
    if (row.engineRank === PAGE_RANK) out.paged += 1;
  }
  return out;
}
/**
 * One row a story: two rows whose items are mostly the same posts and videos ("<A> responds to <B> ...", "<A> apologizes to <B>"
 * make a row for each) are one story. It stays with the person the titles are about: not the one answering someone in most of them
 * (lib/native-signals.js answers), then the one most of them open with (the one who did it), then the hotter.
 */
function oneEach(made) {
  const idsOf = (m) => new Set(Object.values(m.kinds).flatMap((k) => k.items.map((i) => i.id || `${i.k}|${i.title}`)));
  const titlesOf = (m) => Object.values(m.kinds).flatMap((k) => k.items.map((i) => i.title)).filter(Boolean);
  const opens = (m, x) => new RegExp(`^\\W*${keyOf(m.p.key).split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\'’-]*')}\\b`, 'i').test(x);
  const worth = (m, titles) => [-(titles.filter((x) => NS.answers(x, m.p.key)).length * 2 > titles.length), titles.filter((x) => opens(m, x) && !NS.answers(x, m.p.key)).length, m.heat];
  const better = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  const kept = [];
  for (const m of made) {
    const mine = idsOf(m);
    const twin = kept.find((x) => { const theirs = idsOf(x); return [...mine].filter((id) => theirs.has(id)).length * 2 >= Math.min(mine.size, theirs.size); });
    if (!twin) { kept.push(m); continue; }
    const titles = [...new Set([...titlesOf(twin), ...titlesOf(m)])];
    if (better(worth(m, titles), worth(twin, titles))) kept.splice(kept.indexOf(twin), 1, m);
  }
  return kept.sort((a, b) => b.heat - a.heat || a.p.key.localeCompare(b.p.key));
}
/** A row two corroborating kinds make (the rule of 2026-10-12), or null; `fast` when its told voices are. */
function kindsRow(p, t) {
  const family = familyOf(p);
  if (!family) return null;
  const kinds = signalsFor(p, family);
  if (Object.keys(kinds).length < 2 || !corroborated(kinds, t)) return null;
  const newest = Math.max(...Object.values(kinds).flatMap((k) => k.items.map((i) => i.t)));
  if (t - newest > LIVE_WITHIN) return null;
  const noun = nounOf(family, p.texts[family]);
  const line = lineOf(p, family, kinds);
  if (!noun || !line) return null;
  const n = Object.values(kinds).reduce((a, k) => a + k.items.length, 0);
  const fast = fastOf(voicesOf(p, family, t), t);
  return { p, family, noun, line, kinds, fast, heat: Math.min(HEAT_MAX, HEAT_BASE + HEAT_PER_KIND * Object.keys(kinds).length + Math.min(HEAT_ITEMS_MAX, HEAT_PER_ITEM * n) + (p.confirmed ? 2 : 0) + (fast ? HEAT_FAST : 0)) };
}
/** A row for a creator's story told only natively, two independent voices or more (`voicesOf`), or null. Its heat is its voices, its kinds and its speed. */
function voicedRow(p, t) {
  const family = voicedFamily(p);
  const v = voicesOf(p, family, t);
  if (!v) return null;
  const kinds = kindsOfVoices(v);
  const says = saysOf(p, TN.FAMILY.get(family));
  const noun = nounOf(family, (v.items.find(says) || {}).title);
  const line = noun ? voicedLine(p, family, kinds, noun) : null;
  if (!noun || !line) return null;
  const fast = fastOf(v, t);
  return { p, family, noun, line, kinds, fast, voiced: true, voices: v.voices, views: v.viewsAnHour,
    heat: Math.min(HEAT_MAX, HEAT_BASE + HEAT_PER_KIND * Object.keys(kinds).length + HEAT_PER_VOICE * Math.min(HEAT_VOICES_MAX, v.voices) + (fast ? HEAT_FAST : 0)) };
}

/**
 * The engine's rows with the creators' side attached: a talking point whose subject the signals are about gains `meta.native`, the
 * signals that fit its own noun. Rows the signals say nothing of come back as they were.
 */
function attach(rows, people, index, t) {
  return rows.map((row) => {
    if (row.type !== 'point' || row.wordish || row.native) return row;
    const key = keyOf(row.subject || '');
    const p = people.get(index.alias.get(key) || key) || people.get(index.alias.get(keyOf(row.surface || '')) || '');
    if (!p) return row;
    const kinds = signalsFor(p, row.family || null);
    if (!Object.keys(kinds).length) return row;
    return { ...row, meta: { ...(row.meta || {}), native: nativeMeta(p, kinds, t) } };
  });
}

/**
 * The names worth their own search this cycle, `max` at most: who two kinds agree on first, then one kind or a story two voices
 * tell, then the shortlist. lately(name): the name was searched inside the last few hours.
 */
function research(people, { lately = () => false, max = RESEARCH_PER_CYCLE } = {}) {
  // (p.slot: the slot the signals were read at, lib/native-signals.js peopleOf)
  const voiced = (p) => Number.isFinite(p.slot) && voiceable(p) && !!voicesOf(p, voicedFamily(p), p.slot);
  const score = (p) => 10 * Math.max(Object.keys(p.kinds).length, voiced(p) ? 1 : 0) + (p.known ? 2 : 0) + (p.shortlist ? 1 : 0);
  return [...people.values()].filter((p) => (nameable(p) && (Object.keys(p.kinds).length || p.shortlist)) || voiced(p)).sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key))
    .map(shown).filter((name) => !lately(name)).slice(0, max);
}

/**
 * The name searches of a cycle with riders: a drama name waiting in the backlog (`drama`: the engine's people-drama names, as search
 * keys) whose headlines grew, RIDE_MIN or more in the last six hours and more than in the six before, rides ahead of the names first
 * met this cycle, the fastest growing first, RIDE_MAX at most. Nothing is added: the cycle searches as many names as before
 * (lib/budget.js pickNames), and a name a rider passes waits in the backlog. store: the engine's store (its rows' titles and times).
 * { fresh, backlog } in and out, as search keys.
 */
function ride({ fresh = [], backlog = [] }, { drama = [], store = null, nowMs = null, max = RIDE_MAX } = {}) {
  if (!store || !store.rows || !Number.isFinite(nowMs) || max <= 0) return { fresh, backlog };
  const wanted = new Set(backlog.filter((k) => drama.includes(k)));
  if (!wanted.size) return { fresh, backlog };
  const counts = new Map();
  const span = RIDE_SPAN * 1000;
  for (const r of store.rows.values()) {
    if (!Number.isFinite(r.t) || r.t > nowMs || nowMs - r.t > 2 * span || r.fam === 'trends') continue;
    const ws = W.words(String(r.title || ''));
    const seen = new Set();
    for (let i = 0; i < ws.length; i++) for (let n = 1; n <= RIDE_WORDS && i + n <= ws.length; n++) { const k = TS.talkKey(ws.slice(i, i + n).join(' ')); if (wanted.has(k)) seen.add(k); }
    for (const k of seen) { const c = counts.get(k) || { now: 0, before: 0 }; if (nowMs - r.t <= span) c.now += 1; else c.before += 1; counts.set(k, c); }
  }
  const riders = [...counts].filter(([, c]) => c.now >= RIDE_MIN && c.now > c.before).sort((a, b) => (b[1].now - b[1].before) - (a[1].now - a[1].before) || b[1].now - a[1].now || a[0].localeCompare(b[0]))
    .slice(0, max).map(([k]) => k);
  if (!riders.length) return { fresh, backlog };
  return { fresh: [...riders, ...fresh.filter((k) => !riders.includes(k))], backlog: backlog.filter((k) => !riders.includes(k)) };
}

module.exports = { rowsOf, census, inStore, attach, research, ride, lineOf, whyOf, familyOf, nounOf, signalsFor, corroborated, nameable, voiceable, voicedFamily, voicesOf, voicedLine, fastOf, shown, nativeMeta, HEAT_MAX, KIND_SPAN, BOARD,
  PAGE_RANK, PAGE_ROWS_MAX, RIDE_MAX };
