'use strict';
/* Small readers of a page's markup that the platform adapters share (ios/IDEAS-FEED.md M). Pure; no parser, no dependencies. */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
/** Character references as the characters they stand for. */
const decode = (s) => String(s || '').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&([a-z]+);/gi, (m, name) => NAMED[name.toLowerCase()] ?? m);
/** A fragment's text: tags off, references decoded, zero-width marks and runs of space gone. */
const textOf = (html) => decode(String(html || '').replace(/<(?:script|style|svg)[\s\S]*?<\/(?:script|style|svg)>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ')
  .replace(/\s+([,.;:!?])(?=\s|$)/g, '$1').trim();
/** Every JSON-LD block of a page, parsed; a `@graph` is flattened. A block that does not parse is skipped. */
function ldJson(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j = null;
    try { j = JSON.parse(m[1]); } catch { continue; }
    for (const node of Array.isArray(j) ? j : j && Array.isArray(j['@graph']) ? j['@graph'] : [j]) if (node && typeof node === 'object') out.push(node);
  }
  return out;
}
/** "115,731", "17.3K", "2M", "1.1M videos" as a number; null when it is none. */
function countOf(text) {
  const m = String(text || '').replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!m) return null;
  const n = Number(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1);
  return Number.isFinite(n) ? Math.round(n) : null;
}
/** "Oct 11, 2026", "October 02, 2026", "5 Oct 2026" as "2026-10-11"; null when it is no date. */
function dayOf(text) {
  const ms = Date.parse(`${String(text || '').replace(/(\d)(?:st|nd|rd|th)\b/g, '$1').trim()} 12:00 UTC`);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}
/** A TikTok sound's address as { id, slug }: `tiktok.com/music/<slug>-<id>`; null for any other address (a short link names nothing). */
function soundOf(url) {
  let path = '';
  try { const u = new URL(String(url || '')); if (!/(?:^|\.)tiktok\.com$/.test(u.host)) return null; path = decodeURIComponent(u.pathname); } catch { return null; }
  const m = path.match(/^\/music\/(.*?)-?(\d{5,25})\/?$/);
  if (!m) return null;
  const slug = m[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return { id: m[2], slug: slug || null };
}

module.exports = { decode, textOf, ldJson, countOf, dayOf, soundOf };
