'use strict';
/*
 * The charts desk (ios/.review/learn/2026-10-30-5x-plan.md item 6, wave 10 "charts"): an extension desk, `rows(ctx)`, whose rows
 * each carry `section: 'charts'` and their clock (`extUntil`, the extension's budget, lib/extension.js) and are laid out only past the
 * list's main rows (ranks 81 and on). collect.js registers it with the extension beside the kinds desk, so the main rows never see its
 * rows and ranks 1-80 are the same with or without it. It reads nothing: every number comes from the chart reads the collector
 * already makes (the platform ledger, lib/native-ledger.js `platform`, and the store's Know Your Meme feed items). +0 requests.
 *
 * Why a section and not page one: on the virality ground truth (2026-10-30-virality-truth.md) sounds proved viral 0 of 9 and words 0
 * of 27, so a chart is a place to look, not a proof; the rows sit under the main list, ranked by their chart, never removed.
 *
 *   sounds  a sound on the US TikTok charts (Trending TikTok Songs' viral and popular lists), Shazam's US discovery chart or Spotify's
 *           US daily chart (Kworb) that ENTERED within ENTERED_HOURS (by the source's own date: the sound page's first day on a chart,
 *           the days Spotify's chart has held it; or new to a chart while the collector watched it) or CLIMBED in its last read
 *           (CLIMB_PLACES or more, and a quarter of its old place, between the collector's last two reads of the US chart, READS_APART
 *           or more apart). The line is the chart's fact, said as the chart's.
 *   songs   (wave 12) each audience's OWN countries' song charts (lib/sources/country-charts.js: Apple Music's most played in the US,
 *           the UK, Australia and Canada; Spotify's UK, Australian, Canadian and US daily charts by way of Kworb; Shazam's discovery
 *           charts of the four; the Canadian viral TikTok chart): a song that entered one of them within ENTERED_HOURS or climbed in
 *           its last read, every chart of the audience's countries that says so in one line. The UK's list is the UK's songs first;
 *           the US TikTok sounds follow them there, said as the US chart's (rank, never filter).
 * A chart row leaves 72 hours after its song came onto the chart unless it climbed in its last read (wave 12: on 2026-10-29 every
 * list's charts rows were the same 8 US sounds, all 110 hours on their chart).
 *   slang   a word a dictionary just took in (Wiktionary's slang categories, joined within ENTERED_DAYS) that people are asking the
 *           meaning of (the same rule the platform desk lists a word by: lib/platform-desk.js wordNotListed), or a Know Your Meme
 *           entry published within ENTERED_DAYS that a second voice names (people typing it, a Google Trends search, a dictionary
 *           entry, a chart). The dictionary and Know Your Meme are confirming voices only: neither alone makes a row. Know Your Meme
 *           is never quoted: the line says that it added a page, and what the other voice is.
 *
 * Nothing here is drama or Early, claims a person did anything, asks a name search or titles a row by a person: an entry whose name
 * reads as news about someone (an allegation, a death, a funeral, a mugshot: NEWS_WORDS) or holds a person-like name (a given
 * name and a surname, TN.personLike) is left to the engine's own pipeline. A thing a row of the list
 * already tells gets no row here.
 *
 * Sources and flags (each source file's header says its own): Trending TikTok Songs (robots.txt allows all; no flag), Kworb's mirror of
 * Spotify's daily charts (robots allows all; needs permission: Spotify, for its ranks shown as rows), Shazam's discovery files
 * (not disallowed; needs permission: Apple), Apple Music's most played songs (marketing RSS, robots allows all; needs permission:
 * Apple), Wiktionary (needs permission: Wikimedia: robots.txt disallows /w/), Know Your Meme's two entry feeds (not disallowed;
 * paraphrased, never quoted: quoting would need permission: Know Your Meme).
 *
 * Off: IDEAS_KINDS_OFF=charts (or "all") makes no row; IDEAS_SOURCES_OFF=<source> leaves that source out of the desk (tts, shazam,
 * kworb, wikt-slang, kym, and wave 12's apple-music, kworb-country, shazam-country, tts-country or country-charts for all four) as it
 * already stops that source's read; IDEAS_SOURCES_OFF=charts is the whole desk.
 */
const PD = require('../platform-desk');
const PS = require('../platform-signals');
const D = require('../describe');
const TN = require('../../engine/talk-nouns');
const { UNNAMED_SOUND } = require('../sources/roundups');
const CC = require('../sources/country-charts');
const { keyOf, homeGeos, HOUR, DAY } = require('../util');

const SECTION = 'charts';
// (the list's main rows, lib/extension.js MAIN_ROWS: a charts row is never among them)
const MAIN_ROWS = 80;
// (slang: a dictionary's or Know Your Meme's new entry, a week. A chart's song or sound: 72 hours from its entry, or while it climbs)
const ENTERED_DAYS = 7;
const ENTERED_HOURS = 72;
const CLIMB_PLACES = 3;
const CLIMB_DAYS = 3;
const READS_APART = 10 * HOUR;
const CLIMB_SHARE = 0.25;
const CHART_LIVE = 3 * DAY;
// (a row that climbed in its last read stays until the chart's next read could say it again: the read's interval and two hours)
const CLIMB_HOLD = 2 * HOUR;
const TTS_EVERY = 12 * HOUR;
const KWORB_TOP = 100;
// (the rows a list takes from here, and of each kind: the extension's own quota for the section, lib/extension.js SECTIONS, is 24)
const ROWS_MAX = 24;
const MAX = { sound: 10, song: 14, slang: 4 };
const LINE_FACTS = 2;
const TITLE_MAX = 80;
const LINE_MAX = 200;
const HEAT_BASE = 22;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// (a Know Your Meme entry named as news about somebody: the engine's drama pipeline, with its reported-wording rules, tells those)
// (and a death, an arrest or a harm told any other way: "RIP <name>", "<name> funeral", "<name> mugshot" is somber news, not a meme)
const NEWS_WORDS = /\b(?:alleg\w*|accus\w*|arrest\w*|charg\w*|dies|died|dead|death|lawsuit|sued|sues|scandal|cheat\w*|leak\w*|fired|banned|abuse\w*|assault\w*|rape|murder\w*|kill\w*|controvers\w*|apolog\w*|feud|beef|split|divorce\w*|breakup|exposed|cancel\w*|racis\w*|slur|rip|r\.i\.p|rest in peace|passing|passed away|passes away|tribute\w*|memorial\w*|funeral\w*|obituar\w*|vigil\w*|shooting\w*|shot|stabb\w*|crash\w*|overdos\w*|suicid\w*|missing|mugshot\w*)\b/i;
// (a name holding a person-like run of two words, "<given name> <surname> ...": a row titled by a person is the engine's, never this desk's)
const personNamed = (name) => {
  const ws = String(name || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i + 1 < ws.length; i++) if (TN.personLike(`${ws[i]} ${ws[i + 1]}`, null)) return true;
  return false;
};
const KIND_TAIL = /\s+(?:meme|memes|trend|challenge|sound|audio|song|dance|filter|edit)$/i;
const NAMED_SPAN = 3 * DAY;
const HEADLINES_MIN = 2;
const GEO_WORDS = { US: 'the US', GB: 'the UK', AU: 'Australia', CA: 'Canada' };

const dayOfT = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const dayWords = (day) => { const m = String(day || '').match(/^(\d{4})-(\d\d)-(\d\d)$/); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null; };
const dayStart = (day) => { const ms = Date.parse(`${day}T00:00:00Z`); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null; };
const capFirst = (s) => (s && /^\p{Ll}/u.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const cut = (s, max) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length <= max ? x : `${x.slice(0, max - 1).replace(/\s+\S*$/, '')}…`; };
const count = (n) => Math.round(n).toLocaleString('en-US');
const nameable = (title) => !!title && /\p{L}/u.test(title) && !UNNAMED_SOUND.test(title);
const has = (hay, name) => !!name && ` ${hay} `.includes(` ${name} `);

// ---------- switches ----------
/** Which of the desk's voices are off: { all, sources: Set } from IDEAS_KINDS_OFF ("charts" or "all") and IDEAS_SOURCES_OFF (source ids, or "charts"). */
function offOf(env = {}) {
  const kinds = new Set(String(env.IDEAS_KINDS_OFF || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  const sources = new Set(String(env.IDEAS_SOURCES_OFF || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
  return { all: kinds.has('charts') || kinds.has('all') || kinds.has('1') || sources.has('charts'), sources };
}
const offFor = (off, source) => !!off && off.sources instanceof Set && (off.sources.has(source) || (source === 'kym' && [...off.sources].some((s) => s.startsWith('kym'))));

// ---------- what the list already tells ----------
/** The keys of what the audience's rows tell: names without their kind word, subjects, sound ids. */
function toldOf(rows) {
  const keys = new Set();
  const sounds = new Set();
  for (const r of rows || []) {
    if (!r || r.chartsRow) continue;
    for (const k of [keyOf(D.ownName(r.title || '')), keyOf(r.subject || ''), keyOf(r.surface || '')]) if (k) keys.add(k);
    const id = r.platform && r.platform.sound && r.platform.sound.id;
    if (id) sounds.add(String(id));
  }
  return { keys, sounds };
}
/** Whether a told key names the thing (the same, or one inside the other where the shorter is two words or more). */
const toldKey = (told, key) => !!key && (told.keys.has(key) || [...told.keys].some((k) => (k.split(' ').length >= 2 && has(key, k)) || (key.split(' ').length >= 2 && has(k, key))));

// ---------- sounds ----------
/**
 * A sound's climb by the collector's own reads of its one chart (the platform ledger's series "tts|<id>": the videos, and the rank as
 * the place), when it sits on one chart only (the series does not say which chart a place is on): the place it climbed from at the
 * newest read at least READS_APART before the newest one, which must be the place the chart shows now. null otherwise.
 */
function climbOfReads(points, rank, t) {
  if (!Number.isFinite(rank)) return null;
  const pts = (points || []).filter((p) => p && Number.isFinite(p.w) && Number.isFinite(p.t) && p.t <= t && t - p.t <= CLIMB_DAYS * DAY);
  const last = pts[pts.length - 1];
  if (!last || last.w !== rank || t - last.t > DAY) return null;
  // (in its LAST read: the newest place against the newest read READS_APART or more before it, wave 12; until then the best place inside
  // CLIMB_DAYS, which kept a row up for days on one climb long past)
  const from = pts.filter((p) => last.t - p.t >= READS_APART).sort((a, b) => b.t - a.t)[0];
  // (a climb is CLIMB_PLACES or more and a CLIMB_SHARE of the place it left: three places at the chart's foot, 47 to 44 when sounds above it
  // drop off, is the chart reshuffling, not a sound climbing. Frozen 2026-10-12b: four such rows, none above No. 44)
  return from && from.w - rank >= Math.max(CLIMB_PLACES, Math.ceil(CLIMB_SHARE * from.w)) ? { now: rank, nowDay: dayOfT(last.t), from: from.w, fromDay: dayOfT(from.t) } : null;
}
/** When the sound entered a chart, by the earliest a source dates it inside ENTERED_HOURS: { at, how }, or null. */
function enteredOf(s, items, t) {
  const within = (at) => Number.isFinite(at) && at <= t && t - at < ENTERED_HOURS * HOUR;
  const dates = [];
  for (const chart of ['viral', 'popular']) {
    const i = items.get(`${chart}:${s.id}`);
    // (new by observation: the collector watched the chart when it appeared, lib/native-ledger.js `fresh`)
    if (i && i.fresh && within(i.firstSeen)) dates.push({ at: i.firstSeen, how: chart === 'viral' ? 'new to the viral chart' : 'new to the popular chart' });
  }
  const first = s.song && s.song.firstSeen ? dayStart(s.song.firstSeen) : null;
  if (within(first)) dates.push({ at: first, how: 'first charted' });
  const k = s.kworb;
  if (k && Number.isFinite(k.days) && k.days >= 1 && k.days <= Math.ceil(ENTERED_HOURS / 24) + 1 && /^\d{4}-\d\d-\d\d$/.test(String(k.day || ''))) {
    const at = dayStart(k.day) - (k.days - 1) * DAY;
    if (within(at)) dates.push({ at, how: 'new on Spotify' });
  }
  return dates.sort((a, b) => a.at - b.at)[0] || null;
}
/** The chart's own fact, as one sentence: "No. 4 on the US viral TikTok chart (Trending TikTok Songs), up from No. 15 on 25 October." */
function soundLine(s, { entered, climb }) {
  const place = s.viral ? `No. ${s.viral.rank} on the US viral TikTok chart` : s.popular ? `No. ${s.popular.rank} on the US popular TikTok chart` : null;
  const parts = [];
  if (place) parts.push(`${place} (Trending TikTok Songs)`);
  if (climb) parts.push(`up from No. ${climb.from} on ${dayWords(climb.fromDay)}`);
  else if (entered && entered.how !== 'new on Spotify') parts.push(entered.how === 'first charted' ? `first on the site’s charts on ${dayWords(dayOfT(entered.at))}` : `${entered.how} on ${dayWords(dayOfT(entered.at))}`);
  const also = [];
  if (s.kworb && Number.isFinite(s.kworb.rank)) also.push(entered && entered.how === 'new on Spotify' ? `new to Spotify's US daily chart this week, No. ${s.kworb.rank} there (Kworb)` : `No. ${s.kworb.rank} on Spotify's US daily chart (Kworb)`);
  if (s.shazam && Number.isFinite(s.shazam.rank)) also.push(`No. ${s.shazam.rank} on Shazam's US discovery chart`);
  const first = parts.join(', ');
  const line = [first, ...also].filter(Boolean).join('; ');
  return line ? `${capFirst(line)}.` : null;
}
const fullTitle = (title, artist) => (artist && `${title} by ${artist}`.length <= TITLE_MAX ? `${title} by ${artist}` : title);

function soundRows(things, ledger, { t, told, off }) {
  const items = new Map(((ledger && ledger.items) || []).filter((i) => i && i.source === 'tts' && t - i.lastSeen <= CHART_LIVE).map((i) => [i.key, i]));
  const made = [];
  if (offFor(off, 'tts')) return made;
  for (const s0 of (things && things.sounds ? things.sounds.values() : [])) {
    // (a source switched off says nothing here, even while its last reads are still in the ledger)
    const s = { ...s0, kworb: offFor(off, 'kworb') ? null : s0.kworb, shazam: offFor(off, 'shazam') ? null : s0.shazam };
    if (!nameable(s.title) || (!s.viral && !s.popular)) continue;
    const full = fullTitle(s.title, s.artist);
    if (told.sounds.has(String(s.id)) || toldKey(told, keyOf(s.title)) || toldKey(told, keyOf(full))) continue;
    const oneChart = s.viral && !s.popular ? s.viral : s.popular && !s.viral ? s.popular : null;
    // (climbing only by the collector's own reads of the US chart: a sound's own page charts the region it ranks best in, "currently
    // #1 on the Canada Viral chart", so its dated ranks are not the US chart's and are never said beside it)
    const climb = oneChart && ledger && ledger.series ? climbOfReads(ledger.series.get(`tts|${s.id}`), oneChart.rank, t) : null;
    const entered = enteredOf(s, items, t);
    if (!climb && !entered) continue;
    const line = soundLine(s, { entered, climb });
    if (!line || line.length > LINE_MAX) continue;
    const best = Math.min(s.viral ? s.viral.rank : 99, s.popular ? s.popular.rank : 99);
    const at = entered ? entered.at : dayStart(climb.nowDay);
    // (72 hours from its entry; a climber until the chart's next read could say it again. Never past its last sight on a chart + CHART_LIVE)
    const lastOn = Math.max(...['viral', 'popular'].map((c) => (items.get(`${c}:${s.id}`) || {}).lastSeen || 0));
    const until = Math.min(Math.max(entered ? entered.at + ENTERED_HOURS * HOUR : 0, climb ? lastOn + TTS_EVERY + CLIMB_HOLD : 0), lastOn + CHART_LIVE);
    const sources = ['Trending TikTok Songs', ...(s.kworb ? ['Kworb'] : []), ...(s.shazam ? ['Shazam'] : [])];
    made.push({ score: (51 - Math.min(50, best)) / 50 + (climb ? 0.02 * (climb.from - climb.now) : 0) + (entered ? 0.3 : 0) + (s.shazam ? 0.1 : 0), at, until,
      r: { kind: 'sound', sub: 'sound', wordKind: 'sound', title: capFirst(full), line, heat: HEAT_BASE + Math.round(10 * (51 - Math.min(50, best)) / 50), status: climb || (entered && entered.how.startsWith('new to')) ? 'rising' : null,
        says: true, page: false, sources, originDay: entered ? dayOfT(entered.at) : null, signal: null, videos: Number.isFinite(s.videos) ? s.videos : null,
        sound: { id: s.id, slug: s.slug, videos: Number.isFinite(s.videos) ? s.videos : null, videosToday: null, asOf: s.asOf }, demand: PD.soundDemand(s),
        why: [line], about: null, topics: ['music'], pulse: s.asOf, from: 'charts', key: keyOf(s.title) }, songKey: PS.songKey(s.title, s.artist), geos: ['US'] });
  }
  return made.sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title)).slice(0, MAX.sound);
}

/**
 * One chart's fact about a song, as a clause: "new to Spotify's UK daily chart on 27 October, No. 57 there (Kworb)", "up 14 places to
 * No. 27 on Spotify's UK daily chart on 27 October (Kworb)", "No. 12 on Apple Music's most played songs in the UK, new to it on 28
 * October", "out on 23 October; No. 12 on ...". e: an entry of lib/sources/country-charts.js entriesOf, with `fresh` (entered inside
 * ENTERED_HOURS) set. null when the entry says nothing new.
 */
function songFact(e) {
  const on = e.kind === 'kworb' ? ` on ${dayWords(e.day) || 'its last day'}` : '';
  const credit = e.kind === 'kworb' ? ' (Kworb)' : e.kind === 'tts' ? ' (Trending TikTok Songs)' : '';
  if (e.climb) return `up ${e.climb.from - e.climb.to} places to No. ${e.climb.to} on ${e.label}${e.climb.own ? on : `, from No. ${e.climb.from} on ${dayWords(dayOfT(e.climb.fromAt)) || 'its last read'}`}${credit}`;
  if (!e.fresh) return null;
  if (e.entered.how === 'released') return `No. ${e.rank} on ${e.label}${on}, out on ${dayWords(e.entered.released)}${credit}`;
  if (e.kind === 'kworb') return `No. ${e.rank} on ${e.label}${on}, new to it ${e.entered.at >= dayStart(e.day) ? 'that day' : `on ${dayWords(dayOfT(e.entered.at))}`}${credit}`;
  if (e.kind === 'shazam') return `new to ${e.label} on ${dayWords(dayOfT(e.entered.at))}, the songs people are newly looking up; No. ${e.rank} there now`;
  return `No. ${e.rank} on ${e.label}, new to it on ${dayWords(dayOfT(e.entered.at))}${credit}`;
}

/**
 * Songs of the audience's own countries' charts (lib/sources/country-charts.js) that entered one inside ENTERED_HOURS or climbed in its
 * last read, one row a song (its key across charts: lib/platform-signals.js songKey), every chart saying so in its line (LINE_FACTS at
 * most), that no main row and no TikTok sound row of the list tells. cache: the charts' cache (meta `countryCharts`).
 */
function songRows(cache, things, { t, told, off, geos }) {
  if (!cache) return [];
  const sources = off && off.sources instanceof Set ? off.sources : new Set();
  const tiktok = new Set([...(things && things.sounds ? things.sounds.values() : [])].map((s) => PS.songKey(s.title, s.artist)));
  const bySong = new Map();
  for (const e0 of CC.entriesOf(cache, geos, t, { off: sources })) {
    if (e0.kind === 'kworb' && e0.rank > KWORB_TOP) continue;
    const e = { ...e0, fresh: !!e0.entered && e0.entered.at <= t && t - e0.entered.at < ENTERED_HOURS * HOUR };
    if (!e.fresh && !e.climb) continue;
    if (!nameable(e.title) || tiktok.has(e.key)) continue;
    const list = bySong.get(e.key) || [];
    list.push(e);
    bySong.set(e.key, list);
  }
  const out = [];
  for (const [key, es] of bySong) {
    const full = fullTitle(es[0].title, es[0].artist);
    if (toldKey(told, keyOf(es[0].title)) || toldKey(told, keyOf(full))) continue;
    // (the chart that places it best first: a share of the chart, then a climb over a plain entry)
    const ranked = [...es].sort((a, b) => a.rank / a.size - b.rank / b.size || Number(!!b.climb) - Number(!!a.climb) || a.chart.localeCompare(b.chart));
    const facts = ranked.map(songFact).filter(Boolean).slice(0, LINE_FACTS);
    if (!facts.length) continue;
    let line = `${capFirst(facts.join('; '))}.`;
    if (line.length > LINE_MAX) line = `${capFirst(facts[0])}.`;
    if (line.length > LINE_MAX) continue;
    const at = Math.min(...es.map((e) => (e.fresh ? e.entered.at : e.climb.at)).filter(Number.isFinite));
    const until = Math.max(...es.map((e) => Math.max(e.fresh ? e.entered.at + ENTERED_HOURS * HOUR : 0, e.climb ? e.readAt + e.every + CLIMB_HOLD : 0)));
    const best = ranked[0];
    const tts = es.find((e) => e.kind === 'tts' && e.id);
    const score = (best.size + 1 - best.rank) / best.size + (es.some((e) => e.fresh) ? 0.3 : 0) + Math.min(0.4, 0.02 * Math.max(0, ...es.map((e) => (e.climb ? e.climb.from - e.climb.to : 0)))) + 0.25 * (new Set(es.map((e) => e.chart)).size - 1);
    const credits = [...new Set(ranked.map((e) => e.credit))];
    out.push({ score, at, until, songKey: key, geos: [...new Set(es.map((e) => e.geo))],
      r: { ...songRow(full, es[0].title, line, at, credits, `No. ${best.rank} on ${best.label}`.slice(0, 60)), ...(tts ? { sub: 'sound', sound: { id: tts.id, slug: tts.slug, videos: tts.videos, videosToday: null, asOf: tts.readAt } } : {}),
        status: es.some((e) => e.climb || e.entered.how === 'seen') ? 'rising' : null } });
  }
  return out.sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title)).slice(0, MAX.song);
}
const songRow = (full, title, line, at, sources, label) => ({ kind: 'sound', sub: 'song', wordKind: 'sound', title: capFirst(full), line, heat: HEAT_BASE, status: null, says: true, page: false, sources, originDay: dayOfT(at), signal: null,
  videos: null, sound: null, demand: { label, kind: 'listed' }, why: [line], about: null, topics: ['music'], pulse: at, from: 'charts', key: keyOf(title) });

// ---------- slang ----------
/** A word a dictionary just took in that people ask about (lib/platform-desk.js wordNotListed's rule), the overflow its rows' cap leaves. */
function dictionaryRows(things, { t, told, off }) {
  if (offFor(off, 'wikt-slang')) return [];
  const out = [];
  for (const w of (things && things.words) || []) {
    if (!Number.isFinite(w.added) || t - w.added >= ENTERED_DAYS * DAY || w.added > t) continue;
    if (PD.wordNotListed(w, t) || toldKey(told, keyOf(w.term)) || NEWS_WORDS.test(w.term)) continue;
    const said = w.asked && w.asked.said && w.asked.said[0];
    out.push({ score: 0.4 + (w.asked && w.asked.climbing ? 0.2 : 0), at: w.added, until: w.added + ENTERED_DAYS * DAY,
      r: { kind: 'word', sub: /\s/.test(w.term.trim()) ? 'phrase' : 'word', wordKind: /\s/.test(w.term.trim()) ? 'phrase' : 'word', title: capFirst(w.term), line: w.meaning, heat: HEAT_BASE + 4, status: null, says: true, page: false,
        sources: ['Wiktionary'], originDay: dayOfT(w.added), signal: null, demand: null,
        why: [`Added to Wiktionary on ${dayWords(dayOfT(w.added))}`, said ? `People are searching “${said}”` : null].filter(Boolean), pulse: w.added, from: 'charts', key: w.key } });
  }
  return out;
}

/** The second voice that names a Know Your Meme entry: { what } (said in the line) or null. */
function secondVoice(key, { things, trends, items, t }) {
  for (const [kind, m] of (things && things.typed) || new Map()) {
    for (const g of m.values()) if (g.key === key || (key.split(' ').length >= 2 && has(g.key, key))) return { what: `people are searching “${g.said[0]}”`, kind: `typed-${kind}` };
  }
  const tr = (trends || []).find((x) => x && x.keyword && Number.isFinite(x.start) && t * 1000 - x.start < ENTERED_DAYS * DAY * 1000 && (keyOf(x.keyword) === key || (key.split(' ').length >= 2 && has(keyOf(x.keyword), key))));
  if (tr) return { what: `people${GEO_WORDS[tr.geo] ? ` in ${GEO_WORDS[tr.geo]}` : ''} are searching Google for “${tr.keyword}”`, kind: 'trends' };
  const w = ((things && things.words) || []).find((x) => x.key === key);
  if (w && w.meaning) return { what: 'Wiktionary has an entry for it', kind: 'wikt' };
  const s = [...((things && things.sounds) || new Map()).values()].find((x) => keyOf(x.title) === key && (x.viral || x.popular));
  if (s) return { what: `a sound of that name is on the US TikTok charts`, kind: 'tts' };
  if (key.split(' ').length >= 2) {
    const named = (items || []).filter((i) => i && i.fam !== 'kym' && Number.isFinite(i.t) && t * 1000 - i.t < NAMED_SPAN * 1000 && has(keyOf(i.title), key));
    const outlets = new Set(named.map((i) => i.publisher || i.label || i.fam));
    if (outlets.size >= HEADLINES_MIN) return { what: `${outlets.size} outlets' headlines named it this week`, kind: 'headlines' };
  }
  return null;
}
/** Know Your Meme's new entries (its two entry feeds, never its news articles) that a second voice names. */
function kymRows({ things, items, trends, t, told, off }) {
  if (offFor(off, 'kym')) return [];
  const out = [];
  const seen = new Set();
  const entries = (items || []).filter((i) => i && i.fam === 'kym' && (i.src === 'kym-memes' || i.src === 'kym-subs') && Number.isFinite(i.t) && t * 1000 - i.t < ENTERED_DAYS * DAY * 1000 && i.t <= t * 1000 + HOUR * 1000);
  for (const i of entries.sort((a, b) => b.t - a.t)) {
    const name = String(i.title || '').split(' / ')[0].replace(/^["“‘']+|["”’']+$/g, '').replace(/\s+/g, ' ').trim();
    const key = keyOf(name.replace(KIND_TAIL, ''));
    if (!key || key.length < 3 || seen.has(key) || name.length > TITLE_MAX - 5 || NEWS_WORDS.test(name) || personNamed(name) || toldKey(told, key)) continue;
    const voice = secondVoice(key, { things, trends, items, t });
    if (!voice) continue;
    seen.add(key);
    const at = Math.floor(i.t / 1000);
    const title = KIND_TAIL.test(name) ? capFirst(name) : `${capFirst(name)} meme`;
    // (paraphrased, never quoted: the line says that it has a page and what the second voice is)
    const line = `Know Your Meme added a page for it on ${dayWords(dayOfT(at))}; ${voice.what}.`;
    out.push({ score: 0.35, at, until: at + ENTERED_DAYS * DAY,
      r: { kind: 'word', sub: 'meme', wordKind: 'trend', title, line: cut(line, LINE_MAX), heat: HEAT_BASE + 2, status: null, says: true, page: false, sources: ['Know Your Meme'], originDay: dayOfT(at), signal: null, demand: null,
        why: [line], pulse: at, from: 'charts', key } });
  }
  return out;
}

// ---------- the rows ----------
// (a row of one of the audience's own countries' charts ranks before one of another country's: the UK's list leads with the UK's songs)
const OWN_FIRST = 10;
/**
 * The desk's rows for one audience, each with `section: 'charts'`, its clock (`extUntil`) and `chartsRow`, ROWS_MAX at most, nothing a
 * row of `rows` tells. ctx: { t (seconds), audience, rows (the audience's main rows as made), things (lib/platform-signals.js
 * thingsOf), ledger (the platform ledger as loaded), countryCharts (lib/sources/country-charts.js's cache), items (the store's rows:
 * Know Your Meme's entries and the headlines), trends (the store's Google Trends entries), off (offOf), rankFrom }.
 */
function rows(ctx) {
  const { t, audience = 'US', things = null, ledger = null, items = [], trends = [], off = { all: false, sources: new Set() } } = ctx || {};
  if (!Number.isFinite(t) || (off && off.all)) return [];
  // (never inside ranks 1-80: the extension lays its sections right after the main rows, so on a main list short of its 80 a charts row
  // would publish at 70-something. The desk makes rows only when the audience has the main list's 80 rows built)
  if ((ctx.rows || []).length < MAIN_ROWS) return [];
  const told = toldOf(ctx.rows);
  const geos = homeGeos(audience);
  const usHere = geos.includes('US');
  // (the US TikTok sounds: the US's own chart. Off the US's lists a song the audience's own charts hold is that song's row instead, its
  // own country's facts first; with the US among the audience's countries the sound's row tells it, with its Spotify and Shazam facts)
  const songs = songRows(ctx.countryCharts || null, usHere ? things : null, { t, told, off, geos });
  const songKeys = new Set(songs.map((m) => m.songKey));
  const sounds = soundRows(things, ledger, { t, told, off }).filter((m) => usHere || !songKeys.has(m.songKey));
  const own = (m) => (m.geos || []).some((g) => geos.includes(g));
  const made = [
    ...[...sounds, ...songs].map((m) => ({ ...m, score: m.score + (own(m) ? OWN_FIRST : 0) })),
    ...[...dictionaryRows(things, { t, told, off }), ...kymRows({ things, items, trends, t, told, off })].sort((a, b) => b.at - a.at).slice(0, MAX.slang),
  ];
  // (one row a thing: the first a key names)
  const keys = new Set();
  const kept = made.filter((m) => { const k = keyOf(D.ownName(m.r.title)); if (!k || keys.has(k) || !m.r.line || m.r.line.length > LINE_MAX || m.r.title.length > TITLE_MAX) return false; keys.add(k); return true; })
    .sort((a, b) => b.score - a.score || b.at - a.at || a.r.title.localeCompare(b.r.title)).slice(0, ROWS_MAX);
  let rank = Number.isFinite(ctx.rankFrom) ? ctx.rankFrom : 1 + (ctx.rows || []).reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
  return kept.map((m) => {
    const row = PD.rowOf({ ...m.r, startedAt: null }, audience, rank);
    rank += 1;
    return { ...row, section: SECTION, chartsRow: true, extUntil: Math.max(t + HOUR, m.until),
      meta: { ...row.meta, charts: { at: m.at, until: m.until, from: m.r.sources, geos: m.geos || [], own: m.geos ? own(m) : null } } };
  });
}

/** Counts for the cycle's log: rows by kind for one audience, and how many say a chart of the audience's own countries. Never a title. */
function census(made = []) {
  const by = { sounds: 0, songs: 0, slang: 0, own: 0 };
  for (const r of made) {
    if (!r || !r.chartsRow) continue;
    if (r.kind === 'sound' && r.platform && r.platform.sub === 'song') by.songs += 1; else if (r.kind === 'sound') by.sounds += 1; else by.slang += 1;
    if (r.meta && r.meta.charts && r.meta.charts.own) by.own += 1;
  }
  return { rows: made.filter((r) => r && r.chartsRow).length, ...by };
}

module.exports = { SECTION, ENTERED_DAYS, ENTERED_HOURS, CLIMB_PLACES, ROWS_MAX, MAX, offOf, rows, census, climbOfReads, enteredOf, soundLine, songRows, songFact, secondVoice, toldOf };
