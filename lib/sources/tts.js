'use strict';
/*
 * Trending TikTok Songs (ios/IDEAS-FEED.md M1): one person's public site that charts the sounds TikTok's own lists rank, with each
 * sound's id and how many videos use it. Two charts for the US, Viral and Popular, fifty sounds each, and one page a sound with its
 * dated history (the chart's day, its rank, the videos gained that day, the total). Keyless, `robots.txt` allows all.
 *
 * It is the one keyless list of sounds with numbers: the charts are read twice a day (the data is daily and runs a day or two
 * behind), and a sound's own page only for the few sounds the list holds, five a day at most. The count is the chart's, told as
 * the chart's; it is how many videos use a sound, never how many people watched.
 */
const { request } = require('./fixed');
const { ldJson, textOf, countOf, dayOf, soundOf, decode } = require('./html');
const { HOUR } = require('../util');

const SITE = 'https://trendingtiktoksongs.com';
const CHARTS = [{ id: 'viral', url: `${SITE}/charts/us/viral` }, { id: 'popular', url: `${SITE}/` }];
const CHART_EVERY = 12 * HOUR;
const SONG_EVERY = 20 * HOUR;
const SONGS_A_DAY = 5;
const ROWS_MAX = 60;
const HISTORY_DAYS = 31;

/** The charts due: each every twelve hours. lastReadAt: Map(id -> epoch seconds). */
const chartRequests = (lastReadAt = new Map(), now = 0) => CHARTS.filter((c) => now - (lastReadAt.get(`tts-${c.id}`) ?? -Infinity) >= CHART_EVERY)
  .map((c) => request({ id: `tts-${c.id}`, source: 'tts', kind: 'tts-chart', args: { chart: c.id }, url: c.url, file: `tts-${c.id}.html`, tier: 2, conditional: true }));
/** One sound's history page. sound: { id, slug }. */
const songRequest = (sound) => request({ id: `tts-song-${sound.id}`, rotationId: `tts-song-${sound.id}`, source: 'tts', kind: 'tts-song', args: { id: sound.id }, url: `${SITE}/songs/${sound.slug || 'sound'}-${sound.id}`,
  file: 'tts-song.html', tier: 3 });
/**
 * The sound whose page is read this cycle: of the ones wanted (strongest first), the first not read for twenty hours, and none once
 * five were read inside the last day. wanted: [{ id, slug }]; lastReadAt: Map("tts-song-<id>" -> epoch seconds).
 */
function songTurn(wanted, lastReadAt = new Map(), now = 0) {
  const readToday = [...lastReadAt].filter(([id, at]) => id.startsWith('tts-song-') && now - at < 24 * HOUR).length;
  if (readToday >= SONGS_A_DAY) return null;
  return wanted.find((s) => s && /^\d{5,25}$/.test(String(s.id)) && now - (lastReadAt.get(`tts-song-${s.id}`) ?? -Infinity) >= SONG_EVERY) || null;
}

/** "Title by Artist" as its two parts (the last " by " divides them). */
function nameParts(name) {
  const s = decode(name).replace(/\s+/g, ' ').trim();
  const at = s.lastIndexOf(' by ');
  return at > 0 ? { title: s.slice(0, at).trim(), artist: s.slice(at + 4).trim() } : { title: s, artist: null };
}

/**
 * A chart page as { chart, day ("2026-10-09": the day the chart is dated, or null), rows: [{ rank, id, slug, title, artist, videos }] }.
 * The ranks, names and sound ids are the page's JSON-LD list; the counts are the rows' own, matched by rank. null when the page is
 * not a chart (no list of sounds in it).
 */
function parseChart(html, chart) {
  const list = ldJson(html).find((n) => n['@type'] === 'ItemList' && Array.isArray(n.itemListElement));
  if (!list) return null;
  const counts = new Map();
  for (const block of String(html).split(/<li class="group grid /).slice(1)) {
    const row = block.split('</li>')[0];
    const rank = Number((row.match(/tabular-nums[^"]*"[^>]*>(\d{1,3})<\/span>/) || [])[1]);
    const videos = countOf((textOf(row).match(/([\d.,]+\s*[KMB]?)\s+videos\b/i) || [])[1]);
    if (Number.isFinite(rank) && rank > 0 && videos !== null && !counts.has(rank)) counts.set(rank, videos);
  }
  const rows = [];
  for (const el of list.itemListElement.slice(0, ROWS_MAX)) {
    const sound = soundOf(el && el.url);
    const rank = Number(el && el.position);
    if (!sound || !Number.isFinite(rank) || rank < 1 || !el.name) continue;
    rows.push({ rank, id: sound.id, slug: sound.slug, ...nameParts(el.name), videos: counts.get(rank) ?? null });
  }
  if (!rows.length) return null;
  // (the page says its own day: "As of October 9, 2026, this United States Viral chart ...")
  const day = dayOf((textOf(html).match(/As of ([A-Z][a-z]{2,8} \d{1,2}, \d{4})/) || [])[1]);
  return { chart, day, rows };
}
/**
 * A sound's page as { id, slug, title, artist, videos (exact), created ("2026-09-01": when the sound was made), firstSeen (its
 * first day on any chart), category, days: [{ day, rank, change, videos }] newest first }. null when it is not a sound's page.
 */
function parseSong(html) {
  const rec = ldJson(html).find((n) => n['@type'] === 'MusicRecording');
  const sound = rec ? [...(rec.sameAs || []), rec.url].map(soundOf).find(Boolean) || soundOf(String(rec.url || '').replace('/songs/', '/music/').replace(/^https:\/\/[^/]+/, 'https://www.tiktok.com')) : null;
  if (!rec || !sound) return null;
  const text = textOf(String(html).replace(/<\/(?:td|th|tr|li|p|div|h\d|dt|dd|span)>/g, ' | '));
  const days = [];
  // (the history table, a day a row: "Oct 11, 2026 Rank # 3 ... ▲ 4,319 ... TikTok videos ▲ 4,319 ... 115,731")
  const history = text.slice(Math.max(0, text.indexOf('Chart history')));
  const marks = [...history.matchAll(/([A-Z][a-z]{2} \d{1,2}, \d{4}) Rank #/g)];
  marks.forEach((m, i) => {
    const seg = history.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : m.index + 400);
    const day = dayOf(m[1]);
    const rank = Number((seg.match(/Rank #\s*(\d+)/) || [])[1]);
    // (the day’s change, then the total; a day with one number has only its total)
    const nums = (seg.split('TikTok videos')[1] || "").match(/^[\s|▲▼=–-]*(\d[\d,]*)(?:[\s|]+(\d[\d,]*))?/) || [];
    const videos = countOf(nums[2] || nums[1]);
    const change = nums[2] ? countOf(nums[1]) * (/▼/.test(seg) ? -1 : 1) : null;
    if (day && videos !== null && !days.some((d) => d.day === day)) days.push({ day, rank: Number.isFinite(rank) ? rank : null, change, videos });
  });
  const after = (label) => { const m = text.match(new RegExp(`${label}\\s*\\|[\\s|]*([^|]{1,40})`)); return m ? m[1].trim() : null; };
  const total = countOf((text.match(/with ([\d,]+) videos using this sound/) || [])[1]) ?? (days[0] ? days[0].videos : null);
  return { id: sound.id, slug: sound.slug, title: decode(rec.name || '').trim(), artist: rec.byArtist && rec.byArtist.name ? decode(rec.byArtist.name).trim() : null, videos: total,
    created: dayOf(after('Sound created')), firstSeen: dayOf(after('First seen')), category: ((text.match(/using this sound\.\s*\|[\s|]*([A-Z][A-Za-z &]{2,24}?)\s*\|/) || [])[1] || '').trim() || null,
    days: days.sort((a, b) => b.day.localeCompare(a.day)).slice(0, HISTORY_DAYS) };
}

module.exports = { CHARTS, CHART_EVERY, SONG_EVERY, SONGS_A_DAY, chartRequests, songRequest, songTurn, parseChart, parseSong, nameParts };
