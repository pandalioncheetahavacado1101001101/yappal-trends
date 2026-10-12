'use strict';
/*
 * What the platform, word and craze sources are made into (ios/IDEAS-FEED.md M12). Pure: the things the ledger holds go in
 * (lib/platform-signals.js thingsOf); out come
 *   rows      a sound with its count and its day's change, a format a roundup dates, a word a dictionary defines, a thing shoppers
 *             call viral, an AI trend people ask for, an app or a game weeks old and already on a chart: each a row of the right
 *             kind, in the shape lib/rows.js gives a word, so everything after reads it as it reads the engine's own;
 *   attached  on the rows the list already has for a person, the hourly reading of their Wikipedia page and the news titles that
 *             named them;
 *   wanted    what the next requests should ask: the sounds whose own page is worth reading, the words that need an entry.
 *
 * Honesty rules held here. A number is its source's own and is said as that source's. A row says "rising" only on its source's own
 * dated numbers (a chart's days, a list read again and again) or on being new by observation: a roundup's word, a dictionary's
 * entry or a completion met at a cold start carries no status at all, and the feed then says the status was not measured. A row
 * with no start to show never takes a place on the page. Nothing here is a headline, and no row is about a person.
 */
const WD = require('../engine/words');
const D = require('./describe');
const PS = require('./platform-signals');
const { UNNAMED_SOUND, labelOf } = require('./sources/roundups');
const APPS = require('./sources/apps');
const { naturalKey } = require('./identity');
const { keyOf, clamp, mean, HOUR, DAY } = require('./util');

const LINE_MAX = 200;
const CLAUSE_MAX = 170;
const TITLE_MAX = 80;
const ROWS_MAX = 16;
const PER_KIND = { sound: 6, format: 4, word: 3, product: 3, ai: 2, app: 2, game: 3, pin: 1 };
const SOUND_PAGE = 2;
const FORMAT_PAGE = 2;
const FORMAT_DAYS = 21;
const FORMAT_PAGE_DAYS = 10;
const SONG_FRESH = 36 * HOUR;
const SONGS_WANTED = 5;
const WORD_DAYS = 30;
const APP_YOUNG_DAYS = 60;
const APP_PAGE_RANK = 10;
const GAME_YOUNG_DAYS = 90;
const GAME_PLAYERS_MIN = 20000;
const STEAM_PLAYERS_MIN = 30000;
const DAYS_MIN = 4;
const RISE = 1.15;
const FALL = 0.6;
// a day's gain under this share of a sound's videos is a tail (1.5%: "Nicole Kidman" at +3.7% a day is rising, a sound at +1% is not
// at a peak); a tail this many days after its page first counted it has faded
const SOUND_TAIL_SHARE = 0.015;
const SOUND_OLD_DAYS = 42;
// TikTok's growth on the creators' scale (lib/signals.js TT_GROWTH_SCALE): half a percent of a sound's videos in an hour reads as half
const GROWTH_SCALE = 930;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// names a title should print as their owners do
const BRANDS = ['Starbucks', 'Stanley', 'Dyson', 'UGG', 'Home Depot', 'Labubu', 'Target', 'Walmart', 'Costco', 'Trader Joe’s', 'Sephora', 'IKEA', 'Nike', 'Crocs', 'Birkin', 'Birkenstock', 'Bogg', 'Baccarat Rouge', 'TikTok',
  'Roblox', 'Pinterest', 'Disney', 'Barbie', 'Lego', 'Amazon', 'Aldi', 'Owala', 'Hermès', 'Lululemon', 'Skims', 'Rhode', 'Hailey Bieber', 'Taylor Swift'];

const count = (n) => Math.round(n).toLocaleString('en-US');
/** A number said roundly: 97,694 is "about 98,000". */
const about = (n) => { const m = Math.pow(10, Math.max(2, Math.floor(Math.log10(Math.max(1, n))) - 1)); return count(Math.round(n / m) * m); };
/** A name as an owner: "Later’s", "Meta Platforms’". */
const owns = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
const listOf = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
/** "2026-10-02" as a card says a day: "2 October". */
const dayWords = (day) => { const m = String(day || '').match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null; };
const capFirst = (s) => (s && /^\p{Ll}/u.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** A typed term as a title prints it: its first letter capital, a brand as its owner spells it. */
function titled(term) {
  let s = capFirst(String(term || '').replace(/\s+/g, ' ').trim());
  for (const b of BRANDS) s = s.replace(BRAND_RE.get(b), b);
  return s;
}
// (a brand as typed: any case, with or without its apostrophe)
const BRAND_RE = new Map(BRANDS.map((b) => [b, new RegExp(`(?<![\\p{L}\\p{N}])${b.split('’').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[’\']?')}(?![\\p{L}\\p{N}])`, 'giu')]));
/** Straight double quotes as the curly pair a card prints. */
const curly = (s) => String(s || '').replace(/"([^"]{1,80})"/g, '“$1”').replace(/(\p{L})'(\p{L})/gu, '$1’$2');
const endStop = (s) => (/[.!?…]['’"”]?$/.test(s) ? s : `${s}.`);
/** A sentence cut where a clause ends, never mid-word, to `max` characters; null when too little is left. */
function cutClause(text, max = CLAUSE_MAX) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const at = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' — '), head.lastIndexOf(': '));
  const cut = at >= max / 3 ? head.slice(0, at) : head.slice(0, head.lastIndexOf(' '));
  return cut.split(' ').length >= 6 ? cut.replace(/[,;:\s]+$/, '') : null;
}

// what a roundup's sentence must do to say what people film: "creators are dropping ...", "creators lip-sync ..."
const DOING = /\bcreators?\s+(?:are|have|use|lip-?sync|film|post|pair|show|turn|drop|share|put|mouth|set|cover|hop|soundtrack|time|overlay|stitch|duet|recreate|dance|walk|pose|hold|cut|record|add|play|swap|reveal|react)\w*\b/i;
const OPENS_FORMAT = /^This\s+(?:\w+\s+)?(?:format|trend)\b/;
/**
 * What a page says people do, as one sentence: the first that says what creators do, from "creators" on; else one that opens "This
 * trend ..." or "This format ..."; cut where a clause ends. null when the page says neither. abouts: the pages' own paragraphs.
 */
function clauseOf(abouts) {
  const sentences = abouts.filter(Boolean).flatMap((a) => String(a).match(/[^.!?]+[.!?]+(?=\s|$)/g) || [String(a)]).map((x) => x.trim()).filter(Boolean);
  const doing = sentences.map((x) => ({ x, m: x.match(DOING) })).find((y) => y.m);
  const picked = doing ? doing.x.slice(doing.m.index) : sentences.find((x) => OPENS_FORMAT.test(x)) || null;
  const cut = picked ? cutClause(curly(picked)) : null;
  return cut ? endStop(capFirst(cut)) : null;
}

// ---------- a source's own dated numbers, read as a status ----------
/**
 * The gains of a sound's newest unbroken run of days, newest first: a day's gain counts only when the day before it is in the
 * history too (after days off the charts, what a page calls a day's change is the change since it was last listed). A day
 * without a date is taken as following its neighbour.
 */
function dailyGains(days) {
  const out = [];
  const list = days || [];
  for (let i = 0; i < list.length; i++) {
    const [a, b] = [list[i], list[i + 1]];
    const [at, before] = [a && a.day ? PS.dayStart(a.day) : null, b && b.day ? PS.dayStart(b.day) : null];
    const follows = !a.day || (i + 1 < list.length && (before === null || at - before === DAY));
    if (!Number.isFinite(a.change) || !follows) break;
    out.push(a.change);
  }
  return out;
}
/**
 * A status from the days a chart gives a sound, newest first ([{ change }]): rising when the newest day's gain is above the mean
 * of the three before by fifteen percent and no lower than the day before; fading when it gained nothing, or under six tenths of
 * its best day after falling two days running; else peaking. null with fewer than four days (no curve to read).
 */
/**
 * A sound's status held to how much of it the day added: a day that adds under SOUND_TAIL_SHARE of the sound's videos is a tail,
 * whatever the day before was (a three-month-old sound adding one percent a day read "Peaking", one adding 0.9% "Rising": judges,
 * 2026-10-12). A tail on a sound SOUND_OLD_DAYS old or more is fading; on a younger one nothing is said (the card reads "Trending").
 */
function tailStatus(status, day, originDay, t) {
  if (!status || !day || !(day.videos > 0) || status === 'fading' || day.share >= SOUND_TAIL_SHARE) return status;
  const age = originDay ? (t - PS.dayStart(originDay)) / DAY : null;
  return age !== null && age >= SOUND_OLD_DAYS ? 'fading' : null;
}
function statusOfDays(days) {
  const c = dailyGains(days);
  if (c.length < DAYS_MIN) return null;
  const prior = mean(c.slice(1, 4));
  if (c[0] > 0 && prior > 0 && c[0] >= RISE * prior && c[0] >= c[1]) return 'rising';
  if (c[0] <= 0 || (c[0] <= FALL * Math.max(...c) && c[0] < c[1] && c[1] <= c[2])) return 'fading';
  return 'peaking';
}
/**
 * A status from a number read hour by hour (a game's players): against the reading a day before, a quarter up is rising, four
 * tenths down is fading, else peaking. null until there is a reading twenty to twenty-eight hours old to hold it against (one
 * hour of a day against another says the time of day, not the game).
 */
function statusOfHours(points, t) {
  const now = points && points.length ? points[points.length - 1] : null;
  const before = now ? [...points].reverse().find((p) => now.t - p.t >= 20 * HOUR && now.t - p.t <= 28 * HOUR) : null;
  if (!now || !before || t - now.t > 3 * HOUR || !(before.v > 0)) return null;
  return now.v >= 1.25 * before.v ? 'rising' : now.v <= 0.6 * before.v ? 'fading' : 'peaking';
}
/** A status from an app's place on a chart, read again and again: five places up inside a day is rising, ten down is fading, else peaking; null with under six hours of readings. */
function statusOfRanks(points, t) {
  const day = (points || []).filter((p) => t - p.t <= DAY);
  if (day.length < 2 || day[day.length - 1].t - day[0].t < 6 * HOUR) return null;
  const moved = day[0].v - day[day.length - 1].v;
  return moved >= 5 ? 'rising' : moved <= -10 ? 'fading' : 'peaking';
}

// ---------- rows ----------
/** A row in the shape lib/rows.js gives a word. r: { kind, sub, title, line, heat, status, says, page, sources, originDay, startedAt, signal, videos, sound, demand, why, about, topics, wordKind, pulse, from }. */
function rowOf(r, audience, engineRank) {
  // (term: what the row is known by, its id's own key, where the title is another wording of it: an app as people search it)
  const term = r.term || r.title;
  const platformMeta = { why: r.why || [], signal: Number.isFinite(r.signal) ? r.signal : null, videos: Number.isFinite(r.videos) ? r.videos : null, startedAt: Number.isFinite(r.startedAt) ? r.startedAt : null, from: r.from };
  const originT = r.originDay ? Date.parse(`${r.originDay}T12:00:00Z`) : null;
  const meta = { originT: Number.isFinite(originT) ? originT : null, established: false, listedBy: 'platform', pageT: Number.isFinite(r.pulse) ? r.pulse * 1000 : null, about: r.about || null, own: [], searches: [], platform: platformMeta };
  const word = { term, kind: r.wordKind || (r.kind === 'sound' ? 'sound' : 'trend'), meaning: r.line, whyNow: null, sources: r.sources || [], meaningFrom: (r.sources || [])[0] || null, meta };
  return { audience, engineRank, kind: r.kind, title: r.title, heat: r.heat, engineStatus: 'peaking', drama: false, type: 'word', cardKey: `word:${term}`, word, meta, wordish: true, line: r.line, subject: term, surface: term,
    family: null, noun: null, tier: null, natural: naturalKey({ kind: 'word', term }), heads: [],
    platform: { sub: r.sub, from: r.from, status: r.status || null, says: !!r.says, page: !!r.page, sound: r.sound || null, demand: r.demand || null, topics: r.topics || [] } };
}

/** How well a sound stands: its places on the two charts, the share it gained on its last day, the other lists that agree, being new to a chart. */
function soundScore(s, day) {
  const place = (c) => (c ? (51 - Math.min(50, c.rank)) / 50 : 0);
  const agree = [s.shazam, s.kworb && s.kworb.rank <= 100, s.reels, s.roundups.length > 0].filter(Boolean).length;
  // (how many videos use it, on a scale from ten thousand to a million: a sound a hundred and sixty thousand videos use outweighs one
  // seventeen thousand do, whatever the day's viral chart says. And a sound somebody has said what creators do with is worth a row;
  // one nobody can say anything about but its place costs the reader a row. Judges, 2026-10-12: the chart's No. 2, on Spotify's top
  // five and leading the Reels list, had no row while a 17,000-video sound with no known use held one on the page)
  const size = Number.isFinite(s.videos) && s.videos > 0 ? clamp((Math.log10(s.videos) - 4) / 2) : 0;
  return 0.55 * place(s.viral) + 0.45 * place(s.popular) + (s.viral && s.popular ? 0.15 : 0) + (day ? 0.4 * clamp(day.share / 0.05) : 0) + 0.1 * agree + ((s.viral && s.viral.fresh) || (s.popular && s.popular.fresh) ? 0.2 : 0) +
    SOUND_SIZE_W * size + (usedFor(s) ? SOUND_USE_W : 0);
}
const SOUND_SIZE_W = 0.3;
const SOUND_SCORE_TOP = 2.2;
const SOUND_USE_W = 0.3;
/** What a roundup or the Reels list says creators do with a sound, or null: the only thing that tells a creator what to film. */
const usedFor = (s) => [...s.roundups.map((r) => r.about), s.reels ? s.reels.about : null].filter(Boolean).join(' ') || null;
/**
 * The day a song began, from how long Spotify's daily chart has held it, when its own page has not been read yet: a song
 * CHART_NEW_DAYS on the chart or fewer is a new release, and the chart's first day of it is when people began to hear it (a song
 * a year on the chart says nothing of when a trend to it began). null with no such count.
 */
function chartOrigin(s) {
  const k = s.kworb;
  if (!k || !Number.isFinite(k.days) || k.days < 1 || k.days > CHART_NEW_DAYS || !/^\d{4}-\d\d-\d\d$/.test(String(k.day || ''))) return null;
  return new Date(Date.parse(`${k.day}T12:00:00Z`) - (k.days - 1) * DAY * 1000).toISOString().slice(0, 10);
}
const CHART_NEW_DAYS = 42;
/** A sound's newest day as its own page gives it, while that page is fresh: { change, videos, share (of its total, gained that day), day } or null. */
function lastDayOf(s, t) {
  const d = s.song && t - s.song.readAt <= SONG_FRESH ? s.song.days[0] : null;
  // (the charts run a day or two behind: a newest day older than that is no "today")
  if (!d || !dailyGains(s.song.days).length || !(d.videos > 0) || t - PS.dayStart(d.day) > 3 * DAY) return null;
  return { change: d.change, videos: d.videos, share: d.change / d.videos, day: d.day };
}
const nameable = (title) => !!title && /\p{L}/u.test(title) && !UNNAMED_SOUND.test(title);
const chartFacts = (s) => [s.popular ? `No. ${s.popular.rank} on the US chart of popular TikTok sounds` : null, s.viral ? `No. ${s.viral.rank} on the ${s.popular ? 'viral one' : 'US chart of viral TikTok sounds'}` : null].filter(Boolean);

function soundRows(things, t) {
  const made = [];
  for (const s of things.sounds.values()) {
    if (!nameable(s.title) || (!s.viral && !s.popular)) continue;
    const day = lastDayOf(s, t);
    const score = soundScore(s, day);
    const full = s.artist && `${s.title} by ${s.artist}`.length <= TITLE_MAX ? `${s.title} by ${s.artist}` : s.title;
    const used = clauseOf([...s.roundups.map((r) => r.about), s.reels ? s.reels.about : null]);
    const also = s.kworb && s.kworb.rank <= 50 ? `No. ${s.kworb.rank} on Spotify’s US daily chart` : s.shazam ? 'on Shazam’s US discovery chart' : s.reels ? 'among the week’s trending Reels audio' : null;
    const facts = chartFacts(s);
    const fallback = endStop(`${facts.join(' and ')}${also ? `; also ${also}` : ''}`);
    const line = used && used.length <= LINE_MAX ? used : fallback;
    const exact = s.song && t - s.song.readAt <= SONG_FRESH && Number.isFinite(s.song.videos);
    const videos = s.live ? s.live.videos : exact ? s.song.videos : s.videos;
    const why = [`${facts.join(' and ')}, by Trending TikTok Songs’ count`,
      s.kworb ? `No. ${s.kworb.rank} on Spotify’s US daily chart${Number.isFinite(s.kworb.streams) ? `, with about ${about(s.kworb.streams)} streams that day (Kworb)` : ''}` : null,
      s.shazam ? `No. ${s.shazam.rank} on Shazam’s US discovery chart` : null,
      s.reels ? `Among the week’s trending Reels audio${s.reels.format ? `, used for “${s.reels.format}”` : ''} (CreatorDB)` : null,
      ...s.roundups.slice(0, 1).map((r) => `Named in ${labelOf(r.page) ? owns(labelOf(r.page)) : 'a'} roundup of TikTok trends${dayWords(r.day) ? ` (${dayWords(r.day)})` : ''}`)].filter(Boolean);
    // (a new release began the day the charts first held it: the earlier of that day and the day its TikTok page first counted it, so
    // the start is the same whichever was read first, and a sound whose page was never read still has a start to show)
    const originDay = [s.song ? s.song.firstSeen || null : null, chartOrigin(s)].filter(Boolean).sort()[0] || null;
    // (a sound nobody has counted by the day and no page has dated says nothing a card can stand on: no start, no change, a
    // heat word nobody measured. It waits until its own page has been read. Judges, 2026-10-12)
    if (!day && !originDay) continue;
    const status = day ? tailStatus(statusOfDays(s.song.days), day, originDay, t) : null;
    made.push({ score, row: { kind: 'sound', sub: 'sound', wordKind: 'sound', title: capFirst(full), line, heat: Math.round(22 + 30 * clamp(score / SOUND_SCORE_TOP)), status, says: true,
      sources: ['Trending TikTok Songs', ...s.roundups.map((r) => labelOf(r.page)).filter(Boolean), ...(s.kworb ? ['Kworb'] : []), ...(s.shazam ? ['Shazam'] : []), ...(s.reels ? ['CreatorDB'] : [])],
      originDay, signal: day && day.change > 0 ? clamp(Math.log2(1 + (GROWTH_SCALE * day.change) / 24 / Math.max(day.videos, 1000)) / 5) : null, videos,
      sound: { id: s.id, slug: s.slug, videos: Number.isFinite(videos) ? videos : null, videosToday: day && !s.live ? day.change : null, asOf: s.live ? s.live.at : exact ? s.song.readAt : s.asOf },
      why, about: [...s.roundups.map((r) => r.about), s.reels ? s.reels.about : null].filter(Boolean).join(' ') || null, topics: ['music'], pulse: s.asOf, from: 'tts', key: keyOf(s.title), soundId: s.id } });
  }
  made.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title));
  // (the page takes a sound only with a start to show, which its own page gives: the two strongest, a rising one first)
  // (and only one somebody has said what creators do with: a place on a chart alone tells a creator nothing to film)
  const paged = made.filter((m) => m.row.originDay && m.row.about).sort((a, b) => Number(b.row.status === 'rising') - Number(a.row.status === 'rising') || b.score - a.score).slice(0, SOUND_PAGE);
  return made.slice(0, PER_KIND.sound).map((m) => ({ ...m.row, page: paged.includes(m) }));
}

function formatRows(things, t) {
  const made = [];
  for (const f of things.formats) {
    const age = (t - f.at) / DAY;
    if (age > FORMAT_DAYS) continue;
    const name = f.name.replace(/^["“‘']|["”’']$/g, '').trim();
    const title = /\b(?:trend|challenge|dance|meme|edit|filter|transition)s?$/i.test(name) ? capFirst(name) : `${capFirst(name)} trend`;
    if (title.length > TITLE_MAX) continue;
    const soundName = f.sound && f.sound.name && nameable(f.sound.name) ? f.sound.name : null;
    const charted = f.sound && f.sound.id ? things.sounds.get(f.sound.id) || null : null;
    const pages = f.pages.map(labelOf).filter(Boolean);
    const clause = clauseOf(f.abouts.map((a) => a.about));
    const tail = soundName ? `set to ‘${soundName}’` : null;
    const withSound = clause && tail && !keyOf(clause).includes(keyOf(soundName)) && `${clause.replace(/[.]$/, '')}, ${tail}.`.length <= LINE_MAX ? `${clause.replace(/[.]$/, '')}, ${tail}.` : clause;
    const listed = `Listed in ${listOf(pages.map(owns))} roundup${pages.length > 1 ? 's' : ''} of TikTok trends on ${dayWords(f.day)}${soundName ? `; it is filmed to ‘${soundName}’` : ''}.`;
    const day = charted ? lastDayOf(charted, t) : null;
    made.push({ kind: 'word', sub: /\bchallenge\b/i.test(name) ? 'challenge' : 'format', wordKind: 'trend', title, line: withSound || listed, heat: 30 + (pages.length > 1 ? 8 : 0) + (age <= 7 ? 6 : age <= 14 ? 3 : 0) + (charted ? 4 : 0),
      // (a roundup alone never reads "rising": only its sound's own days on the chart can say so)
      status: day ? statusOfDays(charted.song.days) : null, says: !!clause, page: !!clause && (pages.length > 1 || age <= FORMAT_PAGE_DAYS), sources: pages, originDay: f.day,
      signal: null, demand: { label: 'TikTok trend', kind: 'listed' }, about: f.abouts.map((a) => a.about).filter(Boolean).join(' ') || null,
      why: [`Listed in ${listOf(pages.map(owns))} roundup${pages.length > 1 ? 's' : ''} of TikTok trends (${dayWords(f.day)})`, soundName ? `Filmed to the sound “${soundName}”` : null,
        charted ? `Its sound is ${chartFacts(charted).join(' and ')}` : null].filter(Boolean), pulse: f.at, from: 'roundup', key: keyOf(name), keys: f.names.map((n) => keyOf(n)) });
  }
  made.sort((a, b) => b.heat - a.heat || b.pulse - a.pulse);
  const paged = made.filter((m) => m.page).slice(0, FORMAT_PAGE);
  return made.slice(0, PER_KIND.format).map((m) => ({ ...m, page: paged.includes(m) }));
}

const CATEGORY_WORDS = { internet: 'internet slang', fandom: 'fandom slang', hot: 'words of the year', neologisms: 'new words' };
function wordRows(things, t) {
  const made = [];
  for (const w of things.words) {
    if (typeof w.meaning !== 'string' || !w.meaning || !WD.safeTerm(w.term) || (t - w.added) / DAY > WORD_DAYS) continue;
    const asked = w.asked && (w.asked.fresh || w.asked.climbing || w.asked.templates.length > 0) ? w.asked : null;
    const moving = !!asked && (asked.climbing || (asked.fresh && Number.isFinite(asked.firstFresh) && t - asked.firstFresh <= DAY));
    // (a dictionary's word lists only when something else says it is being said: people ask what it means, the editors mark it
    // hot, or two of the categories hold it)
    if (!asked && !w.cats.includes('hot') && w.cats.length < 2) continue;
    // (nor a word no slang category holds whose entry carries no slang label: an ordinary word people look up. People always ask
    // what "syntactic" means; its entry's everyday sense is no trend. Live 2026-10-12: "Syntactic: Of, related to or connected
    // with syntax." took a row of the page as rising)
    if (!w.cats.length && !w.label) continue;
    const cat = w.cats.map((c) => CATEGORY_WORDS[c]).find(Boolean);
    const created = Number.isFinite(w.created) ? new Date(w.created * 1000).toISOString().slice(0, 10) : null;
    made.push({ kind: 'word', sub: /\s/.test(w.term.trim()) ? 'phrase' : 'word', wordKind: /\s/.test(w.term.trim()) ? 'phrase' : 'word', title: capFirst(w.term), line: w.meaning,
      heat: 24 + (asked ? 8 : 0) + (moving ? 6 : 0) + (w.cats.includes('hot') ? 4 : 0) + (w.cats.length > 1 ? 3 : 0) + ((t - w.added) / DAY <= 7 ? 4 : 0),
      // (a dictionary confirms and defines: only people newly asking what the word means makes it "rising")
      status: moving ? 'rising' : null, says: true, page: moving, sources: ['Wiktionary'], originDay: moving ? null : created, startedAt: moving && asked.fresh ? asked.firstFresh : null, signal: null, demand: null,
      why: [cat ? `Added to Wiktionary’s ${cat} on ${dayWords(new Date(w.added * 1000).toISOString().slice(0, 10))}` : null, asked ? `People are searching “${asked.said[0]}”` : null].filter(Boolean),
      pulse: Math.max(w.added, asked && asked.firstFresh ? asked.firstFresh : 0), from: 'wikt', key: w.key });
  }
  return made.sort((a, b) => b.heat - a.heat || b.pulse - a.pulse).slice(0, PER_KIND.word);
}

const TAIL_WORDS = 2;
/**
 * What shoppers call viral, one row a thing: the completions that end in the same two words are one thing ("mango ice cream",
 * "fruit ice cream"), told by the best placed of them that is three words or more, else the best placed.
 */
function productRows(things, t) {
  const fills = [...(things.typed.get('product') || new Map()).values()].filter((p) => p.key.split(' ').length >= 2);
  const clusters = new Map();
  for (const p of fills) { const tail = p.key.split(' ').slice(-TAIL_WORDS).join(' '); clusters.set(tail, [...(clusters.get(tail) || []), p]); }
  const made = [];
  for (const group of clusters.values()) {
    const best = [...group].sort((a, b) => Number(b.key.split(' ').length >= 3) - Number(a.key.split(' ').length >= 3) || a.pos - b.pos)[0];
    const templates = [...new Set(group.flatMap((p) => p.templates))];
    const fresh = group.some((p) => p.fresh);
    const moving = group.some((p) => p.climbing || (p.fresh && Number.isFinite(p.firstFresh) && t - p.firstFresh <= DAY));
    const top = Math.min(...group.map((p) => p.pos));
    // (listed when two shopping boxes agree, when it is new or climbing, or when it leads the "viral" box)
    if (templates.length < 2 && !fresh && !moving && top > 3) continue;
    const pin = things.pins.find((x) => ` ${x.key} `.includes(` ${best.key} `) || ` ${best.key} `.includes(` ${x.key} `)) || null;
    const viral = best.said.find((q) => q.startsWith('viral ')) || `viral ${best.term}`;
    const dupes = templates.includes('shop-dupe');
    const firstFresh = Math.min(...group.map((p) => (p.fresh && Number.isFinite(p.firstFresh) ? p.firstFresh : Infinity)));
    made.push({ kind: 'word', sub: 'product', wordKind: 'trend', title: titled(best.term), line: `Shoppers are searching Google Shopping for “${viral}”${dupes ? ' and for dupes of it' : ''}${pin ? '; searches for it are growing on Pinterest too' : ''}.`,
      heat: 24 + (templates.length > 1 ? 8 : 0) + (fresh ? 6 : 0) + (pin ? 4 : 0) + Math.max(0, 6 - top), status: moving ? 'rising' : null, says: templates.length > 1 || !!pin, page: moving, sources: ['Google Shopping', ...(pin ? ['Pinterest Trends'] : [])],
      originDay: null, startedAt: Number.isFinite(firstFresh) ? firstFresh : null, signal: null, demand: { label: 'Shopping searches', kind: 'listed' }, topics: ['shopping'],
      why: [`Google Shopping completes “${viral}”`, dupes ? 'Shoppers also search for dupes of it' : null, pin ? `Pinterest searches for “${pin.term}” are up on last month` : null].filter(Boolean),
      pulse: Number.isFinite(firstFresh) ? firstFresh : t, from: 'typed', key: best.key });
  }
  return made.sort((a, b) => b.heat - a.heat || a.title.localeCompare(b.title)).slice(0, PER_KIND.product);
}

/** Pinterest's own growing searches that are a thing to make, not the calendar: at least doubled on the month and up on the year. */
function pinRows(things, t) {
  const grown = things.pins.filter((p) => p.month >= 80 && p.year >= 50 && p.key.split(' ').length >= 2).sort((a, b) => b.year + b.month - (a.year + a.month) || a.key.localeCompare(b.key));
  // (a longer search for the same thing is the same thing: "dressmaker game", "dressmaker")
  const kept = grown.filter((p, i) => !grown.slice(0, i).some((q) => ` ${p.key} `.includes(` ${q.key} `) || ` ${q.key} `.includes(` ${p.key} `)));
  return kept.slice(0, PER_KIND.pin).map((p) => ({ kind: 'word', sub: 'craze', wordKind: 'trend', title: titled(p.term.replace(/\s+free$/, '')), line: `Searches for “${p.term}” on Pinterest have ${p.month >= 100 ? 'at least doubled' : 'grown sharply'} in a month, by Pinterest’s own weekly figures.`,
    heat: 24, status: null, says: false, page: false, sources: ['Pinterest Trends'], originDay: null, signal: null, demand: { label: 'Pinterest searches', kind: 'listed' }, why: ['Among the fastest-growing US searches on Pinterest this week'],
    pulse: t, from: 'pinterest', key: p.key }));
}

const AI_TAIL = /\s+(?:prompts?|photos?|videos?|filters?|generator|trend|edit)$/;
function aiRows(things, t) {
  const groups = new Map();
  for (const a of (things.typed.get('ai') || new Map()).values()) {
    const key = a.key.replace(AI_TAIL, '');
    const g = groups.get(key) || { key, term: a.term.replace(AI_TAIL, ''), said: [], fresh: false, moving: false, firstFresh: Infinity, pos: Infinity };
    g.said.push(...a.said); g.fresh = g.fresh || a.fresh; g.pos = Math.min(g.pos, a.pos);
    g.moving = g.moving || a.climbing || (a.fresh && Number.isFinite(a.firstFresh) && t - a.firstFresh <= DAY);
    if (a.fresh && Number.isFinite(a.firstFresh)) g.firstFresh = Math.min(g.firstFresh, a.firstFresh);
    groups.set(key, g);
  }
  const trends = things.typed.get('trend') || new Map();
  const made = [];
  for (const g of groups.values()) {
    const filmed = trends.get(g.key) || null;
    // (listed when two questions name it, when people also ask about it as a TikTok trend, or when it is new or climbing)
    if (g.said.length < 2 && !filmed && !g.fresh && !g.moving) continue;
    const said = [...new Set(g.said)].slice(0, 2);
    made.push({ kind: 'word', sub: 'ai', wordKind: 'trend', title: `${titled(g.term)} AI trend`, line: `People are searching Google for ${listOf(said.map((q) => `“${q}”`))}${filmed ? ', and for it as a TikTok trend' : ''}.`,
      heat: 24 + (said.length > 1 ? 4 : 0) + (filmed ? 6 : 0) + (g.fresh ? 6 : 0) + Math.max(0, 6 - g.pos), status: g.moving ? 'rising' : null, says: false, page: false, sources: ['Google'], originDay: null,
      startedAt: Number.isFinite(g.firstFresh) ? g.firstFresh : null, signal: null, demand: null, why: [`People are searching “${said[0]}”`, filmed ? `People are also searching “${filmed.said[0]}”` : null].filter(Boolean),
      pulse: Number.isFinite(g.firstFresh) ? g.firstFresh : t, from: 'typed', key: g.key });
  }
  return made.sort((a, b) => b.heat - a.heat || a.title.localeCompare(b.title)).slice(0, PER_KIND.ai);
}

const SAYS_AI = /(?<![\p{L}\p{N}])(?:A\.?I\.?|GPT|chatbot|generator)(?![\p{L}\p{N}])/u;
const makerName = (maker) => String(maker || '').replace(/,?\s+(?:Inc|LLC|Ltd|Limited|Corp|Corporation|Pte|GmbH|S\.A\.|Co)\.?(?=,|\s|$)/gi, '').replace(/[,.\s]+$/, '').trim();
/**
 * An app as people search it: the maker's name leads where the store's name hangs it on the end ("Muse from Meta" is "Meta Muse").
 * Only when the name after "from" or "by" opens as the maker's own does; any other name stands as the store prints it.
 */
function searchedAs(name, maker) {
  const m = String(name || '').match(/^(.{2,30}?)\s+(?:from|by)\s+(\S.{0,30})$/i);
  const firm = keyOf(maker || '').split(' ')[0];
  return m && firm && keyOf(m[2]).split(' ')[0] === firm ? `${m[2]} ${m[1]}` : name;
}
function appRows(things, t) {
  const young = things.apps.filter((a) => a.released && (t - PS.dayStart(a.released)) / DAY <= APP_YOUNG_DAYS && t >= PS.dayStart(a.released));
  // (one row an app: its better chart)
  const best = new Map();
  for (const a of young) if (!best.has(a.id) || a.rank < best.get(a.id).rank) best.set(a.id, a);
  return [...best.values()].sort((a, b) => a.rank - b.rank).slice(0, PER_KIND.app).map((a) => {
    const maker = makerName(a.maker);
    const label = APPS.labelOf(a.chart) || 'free apps';
    return { kind: 'word', sub: SAYS_AI.test(a.full) ? 'ai' : 'product', wordKind: 'trend', title: searchedAs(a.name, maker), term: a.name, line: `${maker ? `${owns(maker)} app` : 'The app'} is No. ${a.rank} among ${label} in the US; it was released on ${dayWords(a.released)}.`,
      heat: 30 + Math.round(18 * ((51 - Math.min(50, a.rank)) / 50)), status: a.fresh ? 'rising' : statusOfRanks(a.ranks, t), says: true, page: a.rank <= APP_PAGE_RANK, sources: ['App Store'], originDay: a.released,
      signal: 0.8 * clamp((51 - a.rank) / 50), demand: { label: `No. ${a.rank} free app`, kind: 'listed' }, why: [`No. ${a.rank} among ${label} in the US, by Apple’s own chart`, `Released on ${dayWords(a.released)}`],
      pulse: a.seenAt, from: 'apps', key: keyOf(a.name) };
  });
}

function gameRows(things, t) {
  const made = [];
  for (const g of things.games) {
    if (!g.name || !Number.isFinite(g.players)) continue;
    if (g.platform === 'roblox') {
      const age = g.created ? (t - PS.dayStart(g.created)) / DAY : null;
      if (age === null || age > GAME_YOUNG_DAYS || age < 0 || g.players < GAME_PLAYERS_MIN) continue;
      const trending = g.sorts.includes('top-trending') ? ', and it is on Roblox’s Top Trending list' : g.sorts.includes('up-and-coming') ? ', and it is on Roblox’s Up-and-Coming list' : '';
      made.push({ kind: 'word', sub: 'gaming', wordKind: 'trend', title: g.name, line: `A Roblox game made on ${dayWords(g.created)}; about ${about(g.players)} people are playing it right now${trending}.`,
        heat: 28 + Math.round(20 * clamp(Math.log10(g.players / 1000) / 3)), status: statusOfHours(g.series, t), says: true, page: true, sources: ['Roblox'], originDay: g.created, signal: clamp(Math.log10(g.players / 1000) / 3),
        demand: { label: `${D.short(Math.round(g.players / 1000) * 1000)} playing`, kind: 'players', value: g.players }, why: [`About ${about(g.players)} people are playing it on Roblox right now`, `Made on ${dayWords(g.created)}`],
        pulse: g.seenAt, from: 'roblox', key: keyOf(g.name) });
    } else if (g.fresh && g.players >= STEAM_PLAYERS_MIN) {
      // (Steam gives no day of release: a game is a craze there only by observation, new to the hundred most played)
      made.push({ kind: 'word', sub: 'gaming', wordKind: 'trend', title: g.name, line: `New to Steam’s hundred most played games, with about ${about(g.players)} people in it right now.`, heat: 28 + Math.round(20 * clamp(Math.log10(g.players / 1000) / 3)),
        status: 'rising', says: true, page: true, sources: ['Steam'], originDay: null, startedAt: g.seenAt, signal: clamp(Math.log10(g.players / 1000) / 3), demand: { label: `${D.short(Math.round(g.players / 1000) * 1000)} playing`, kind: 'players', value: g.players },
        why: [`About ${about(g.players)} people are in it on Steam right now`, `No. ${g.rank} on Steam’s most played`], pulse: g.seenAt, from: 'steam', key: keyOf(g.name) });
    }
  }
  return made.sort((a, b) => b.heat - a.heat || a.title.localeCompare(b.title)).slice(0, PER_KIND.game);
}

/**
 * The rows made this cycle, for every audience named: { audience: [row] }. A thing the engine already lists is left to its row
 * (`taken`: the keys of what the list holds, names without their kind word), and of two rows made here for one thing the first
 * stands. ctx: { t, audiences, taken: Set, rankFrom: { audience: first free engine rank } }.
 */
function rowsOf(things, { t, audiences = ['US'], taken = new Set(), rankFrom = {} }) {
  const all = [...soundRows(things, t), ...formatRows(things, t), ...wordRows(things, t), ...productRows(things, t), ...aiRows(things, t), ...appRows(things, t), ...gameRows(things, t), ...pinRows(things, t)];
  const seen = new Set();
  const held = (key) => !key || [...taken, ...seen].some((s) => s === key || (key.split(' ').length >= 2 && ` ${s} `.includes(` ${key} `)) || (s.split(' ').length >= 2 && ` ${key} `.includes(` ${s} `)));
  const kept = [];
  for (const r of all) {
    const keys = [r.key, ...(r.keys || [])].filter(Boolean);
    if (!r.title || !r.line || r.line.length > LINE_MAX || keys.some(held)) continue;
    for (const k of keys) seen.add(k);
    kept.push(r);
  }
  // (the strongest sixteen: a row the page can take first, of those one that is rising first, then by heat)
  const rising = (r) => Number(r.status === 'rising');
  const picked = kept.map((r, i) => ({ r, i })).sort((a, b) => Number(b.r.page) - Number(a.r.page) || rising(b.r) - rising(a.r) || b.r.heat - a.r.heat || a.i - b.i).slice(0, ROWS_MAX).map((x) => x.r);
  return Object.fromEntries(audiences.map((a) => [a, picked.map((r, i) => rowOf(r, a, (rankFrom[a] || 1) + i))]));
}

/**
 * The list's own rows with what the hourly files and GDELT show of the people they are about: a talking point about a person of
 * two words or more gains `meta.wikiHourly` (its page's views by the hour: lib/signals.js reads it as the row's reads) and, in
 * `meta.platform.why`, what each shows with its own number. Rows nothing is known of come back as they were.
 */
const CHART_SOURCES = new Set(['kworb', 'reels', 'shazam', 'tts']);
const CHART_FRESH = 3 * DAY;
/** The charts that carry a sound under exactly this name (two words or more), each once: [{ source, rank, rising }]; read inside the last three days. */
function chartsOf(ledger, key, t) {
  if (!key || key.split(' ').length < 2) return [];
  const by = new Map();
  for (const i of (ledger && ledger.items) || []) {
    if (!CHART_SOURCES.has(i.source) || keyOf(i.title || '') !== key || !Number.isFinite(i.lastSeen) || t - i.lastSeen > CHART_FRESH) continue;
    const rank = i.data && Number.isFinite(i.data.rank) ? i.data.rank : null;
    const was = by.get(i.source);
    if (!was || (rank !== null && (was.rank === null || rank < was.rank))) by.set(i.source, { source: i.source, rank, rising: !!(i.data && i.data.momentum === 'rising') });
  }
  return [...by.values()];
}
function attach(rows, ledger, t) {
  return rows.map((row) => {
    // (a format or a word the list already holds, whose own audio the charts carry under the same name: the charts vouch for it.
    // `meta.charts`: [{ source, rank, rising }], read by the page's layout, lib/desk.js. Nothing is retitled, reworded or dated by it)
    if (row.wordish && !row.platform) {
      const charts = chartsOf(ledger, keyOf(D.ownName(row.title)), t);
      return charts.length ? { ...row, meta: { ...(row.meta || {}), charts } } : row;
    }
    if (row.type !== 'point' || row.wordish || row.platform) return row;
    const key = keyOf(row.surface || row.subject || '');
    if (key.split(' ').length < 2) return row;
    const wiki = PS.wikiOf(ledger, key, t);
    const press = PS.pressOf(ledger, key, t);
    // (the page is named: a reading is of the page with that title, whoever else shares the name)
    const why = [wiki && wiki.last >= 500 ? `The Wikipedia page “${row.surface || row.subject}” was read about ${about(wiki.last)} times in the newest hour counted` : null,
      press.h3 >= 3 ? `About ${count(press.h3)} news articles named ${row.surface || 'it'} in the last three hours, by GDELT’s count` : null].filter(Boolean);
    if (!wiki && !why.length) return row;
    return { ...row, meta: { ...(row.meta || {}), ...(wiki ? { wikiHourly: wiki } : {}), platform: { ...((row.meta && row.meta.platform) || {}), why } } };
  });
}

/**
 * What the next requests should ask for: { songs: [{ id, slug }] (the sounds whose own page is worth reading, strongest first),
 * entries: [terms] (the words that need a dictionary entry read), roblox: [universe ids with no day of making yet], steam: [app
 * ids with no name yet] }.
 */
function wanted(things, t) {
  // (a sound whose use is known and whose own page was never read is asked first: its page gives it the start and the day's count a row needs)
  const sounds = [...things.sounds.values()].filter((s) => nameable(s.title)).map((s) => ({ s, score: soundScore(s, lastDayOf(s, t)) })).sort((a, b) => Number(!!usedFor(b.s) && !b.s.song) - Number(!!usedFor(a.s) && !a.s.song) || b.score - a.score).slice(0, SONGS_WANTED).map((x) => ({ id: x.s.id, slug: x.s.slug }));
  // (only a word that could list is worth its entry: one people ask about, one the editors mark hot, one two categories hold)
  const words = things.words.filter((w) => w.meaning === undefined && WD.safeTerm(w.term) && (t - w.added) / DAY <= WORD_DAYS && (!!w.asked || w.cats.includes('hot') || w.cats.length > 1))
    .sort((a, b) => Number(!!b.asked) - Number(!!a.asked) || Number(b.cats.includes('hot')) - Number(a.cats.includes('hot')) || b.cats.length - a.cats.length || b.added - a.added).map((w) => w.term);
  const roblox = things.games.filter((g) => g.platform === 'roblox' && !g.created && g.players >= GAME_PLAYERS_MIN / 2).map((g) => g.id);
  const steam = things.games.filter((g) => g.platform === 'steam' && !g.name && (g.fresh || g.rank <= 20)).map((g) => g.id);
  return { songs: sounds, entries: words, roblox, steam };
}

module.exports = { searchedAs, rowsOf, attach, wanted, rowOf, clauseOf, cutClause, dailyGains, tailStatus, statusOfDays, statusOfHours, statusOfRanks, soundScore, lastDayOf, titled, dayWords, about, soundRows, formatRows, wordRows, productRows, pinRows, aiRows, appRows,
  gameRows, ROWS_MAX, PER_KIND };
