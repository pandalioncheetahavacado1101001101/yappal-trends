'use strict';
/*
 * Two weekly roundups of TikTok trends (ios/IDEAS-FEED.md M2): Later's running page (a dated entry a trend, most with the sound it
 * is filmed to) and Ramdam's weekly page (a few trends, each with its sound). Keyless, ordinary published pages, read once a day.
 *
 * A roundup is an editor's word: it names a format, dates it and says what people do on camera. It carries no number, so a trend
 * only a roundup lists is never "rising" by it. Two roundups naming the same trend, or the same sound, is a confidence signal.
 * What a page says of a trend is kept in the state for the line; the page's text is never published beyond that one line.
 */
const { request } = require('./fixed');
const { textOf, dayOf, soundOf, decode } = require('./html');
const { DAY } = require('../util');

const PAGES = [
  { id: 'later', label: 'Later', url: 'https://later.com/blog/tiktok-trends/' },
  { id: 'ramdam', label: 'Ramdam', url: 'https://www.ramd.am/blog/trends-tiktok' },
];
const EVERY = DAY;
const ENTRIES_MAX = 80;
const ABOUT_MAX = 420;
const NAME_MAX = 70;
// a sound nobody named: the app's own default for an upload's audio, in the languages the pages link
const UNNAMED_SOUND = /^(?:original (?:sound|audio)|sonido original|som original|son original|originalton|suono originale|오리지널 사운드)(?:\s|$)/i;
const LINK_WORDS = /^(?:use this (?:audio|sound)|here|this (?:audio|sound)|audio|sound)$/i;

/** The pages due: each once a day. lastReadAt: Map(id -> epoch seconds). */
const roundupRequests = (lastReadAt = new Map(), now = 0) => PAGES.filter((p) => now - (lastReadAt.get(`roundup-${p.id}`) ?? -Infinity) >= EVERY)
  .map((p) => request({ id: `roundup-${p.id}`, source: `roundup-${p.id}`, kind: 'roundup', args: { page: p.id }, url: p.url, file: `roundup-${p.id}.html`, tier: 2, conditional: true }));
const labelOf = (id) => (PAGES.find((p) => p.id === id) || {}).label || null;

/**
 * The sound a fragment links to: { id, slug, name } or null. id and slug are a `tiktok.com/music/<slug>-<id>` address's (null for a
 * short link, which names nothing); name is the link's own words when they name the sound, else the address's, and null for a
 * sound nobody named ("original sound"). An embed's own link ("♬ name - account") is passed over: it carries an account's name.
 */
function soundIn(html) {
  let found = null;
  for (const m of String(html || '').matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = decode(m[1]);
    if (!/^https?:\/\/(?:[a-z]+\.)?tiktok\.com\//.test(href) || /[?&]refer=embed/.test(href)) continue;
    const sound = soundOf(href.split('?')[0]);
    if (!sound && !/tiktok\.com\/t\/|\/\/vm\.tiktok\.com\//.test(href)) continue;
    // ("Training Season – Dua Lipa": the sound's name is what stands before the artist)
    const text = textOf(m[2]).split(/\s+[–—]\s+/)[0].trim();
    const fromSlug = sound && sound.slug ? sound.slug.replace(/-/g, ' ').trim() : null;
    const name = [text && !LINK_WORDS.test(text) && !text.startsWith('♬') ? text : null, fromSlug].find((n) => n && !UNNAMED_SOUND.test(n)) || null;
    const next = { id: sound ? sound.id : null, slug: sound ? sound.slug : null, name: name ? name.slice(0, NAME_MAX) : null };
    if (!found || (next.id && !found.id)) found = next;
    if (found.id) break;
  }
  return found && (found.id || found.name) ? found : null;
}
const firstParagraph = (html, skip = /^$/) => { for (const m of String(html || '').matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) { const s = textOf(m[1]); if (s.split(/\s+/).length >= 6 && !skip.test(s)) return s.slice(0, ABOUT_MAX); } return null; };

/**
 * Later's page as [{ name, day ("2026-10-02"), sound ({ id, slug, name } or null), about (the entry's recap) }], in the page's order
 * (newest first). An entry is a heading "Trend: <name> — <date>", its recap and, most times, its audio. null when the page has none.
 */
function parseLater(html) {
  const out = [];
  for (const part of String(html || '').split(/<h3[\s>]/).slice(1)) {
    const head = textOf(`<h3 ${part.split('</h3>')[0]}`.replace(/^<h3 [^>]*>/, ''));
    const m = head.match(/^Trend:\s*(.+?)\s+[—–-]\s+([A-Z][a-z]+ \d{1,2},? \d{4})$/);
    if (!m) continue;
    const body = part.split('</h3>').slice(1).join('</h3>').split(/<h[23][\s>]/)[0];
    const recap = (body.match(/<p[^>]*>\s*<b>\s*Trend Recap:?\s*<\/b>([\s\S]*?)<\/p>/) || [])[1];
    const audio = (body.match(/<p[^>]*>\s*<b>\s*Audio:?\s*<\/b>([\s\S]*?)<\/p>/) || [])[1];
    const day = dayOf(m[2]);
    const name = m[1].replace(/\.{3}$|…$/, '').trim();
    if (!day || !name || name.length > NAME_MAX) continue;
    out.push({ name, day, sound: soundIn(audio), about: recap ? textOf(recap).slice(0, ABOUT_MAX) : firstParagraph(body) });
    if (out.length >= ENTRIES_MAX) break;
  }
  return out.length ? out : null;
}

/**
 * Ramdam's page as the same rows: a dated heading ("5 Oct 2026"), then a heading a trend ("The “Oh look” trend"), the paragraph
 * that says what it is, and the sound it says to use. null when the page has none.
 */
function parseRamdam(html) {
  const out = [];
  for (const week of String(html || '').split(/<h2[^>]*>/).slice(1)) {
    const day = dayOf(textOf(week.split('</h2>')[0]));
    if (!day) continue;
    for (const part of week.split(/<h4[^>]*>/).slice(1)) {
      const m = textOf(part.split('</h4>')[0]).match(/^(?:the\s+)?[“"‘']?(.+?)[”"’']?\s+trend$/i);
      if (!m) continue;
      // (the embeds hold other people's posts and accounts: nothing of them is read)
      const body = part.split('</h4>').slice(1).join('</h4>').replace(/<blockquote[\s\S]*?<\/blockquote>/g, ' ');
      const name = m[1].trim();
      if (!name || name.length > NAME_MAX) continue;
      out.push({ name, day, sound: soundIn(body), about: firstParagraph(body, /^for this trend\b/i) });
      if (out.length >= ENTRIES_MAX) break;
    }
  }
  return out.length ? out : null;
}

/** One roundup's reply as its rows, or null when it is not that page. */
const parse = (pageId, html) => (pageId === 'later' ? parseLater(html) : pageId === 'ramdam' ? parseRamdam(html) : null);

module.exports = { PAGES, EVERY, UNNAMED_SOUND, roundupRequests, labelOf, parse, parseLater, parseRamdam, soundIn };
