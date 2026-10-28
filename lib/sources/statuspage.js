'use strict';
/*
 * The services' own status pages (lib/kinds-desk.js, the `rightNow` section): each one's incident history feed, history.rss, which
 * robots.txt allows. Never the status pages' /api/ (their robots.txt disallows it). Keyless; one feed is read only when a search or
 * a headline of the hour says the service is down (lib/kinds-desk.js `wanted`), so a quiet day asks nothing.
 *
 * The services are the ones creators work on or film about, and whose status page publishes that feed: Discord, Reddit, Twitch,
 * Epic Games (Fortnite), Cloudflare (whose outages take down other sites), ChatGPT and Canva. Two feed shapes: Atlassian Statuspage
 * (every update of an incident in its description, newest first) and incident.io (the newest update only).
 * Pure: requests to send and replies read into small records. A row says only what the service itself said, and names it.
 */
const { hostOfUrl } = require('../budget');

const SERVICES = [
  { id: 'discord', name: 'Discord', url: 'https://discordstatus.com/history.rss', aliases: ['discord'] },
  { id: 'reddit', name: 'Reddit', url: 'https://www.redditstatus.com/history.rss', aliases: ['reddit'] },
  { id: 'twitch', name: 'Twitch', url: 'https://status.twitch.com/history.rss', aliases: ['twitch'] },
  { id: 'epic', name: 'Epic Games', url: 'https://status.epicgames.com/history.rss', aliases: ['epic games', 'fortnite', 'epic games store', 'rocket league'] },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://www.cloudflarestatus.com/history.rss', aliases: ['cloudflare'] },
  { id: 'openai', name: 'ChatGPT', url: 'https://status.openai.com/history.rss', aliases: ['chatgpt', 'chat gpt', 'openai', 'sora'] },
  { id: 'canva', name: 'Canva', url: 'https://www.canvastatus.com/history.rss', aliases: ['canva'] },
];
const ITEMS_KEPT = 8;
const TEXT_MAX = 140;
// (an update's words: a maintenance window is planned work, never an outage)
const MAINTENANCE = new Set(['scheduled', 'in progress', 'verifying', 'completed']);
const STATUSES = new Set(['investigating', 'identified', 'monitoring', 'update', 'resolved', 'postmortem', 'degraded performance', 'partial outage', 'full outage', 'major outage', ...MAINTENANCE]);
// (minutes from UTC of the zones the feeds print)
const ZONES = { UTC: 0, GMT: 0, PDT: -420, PST: -480, EDT: -240, EST: -300, CDT: -300, CST: -360, MDT: -360, MST: -420, BST: 60, CET: 60, CEST: 120, AEDT: 660, AEST: 600, JST: 540, IST: 330 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const byId = new Map(SERVICES.map((s) => [s.id, s]));
const request = (service) => ({ tier: 3, init: {}, host: hostOfUrl(service.url), source: 'kinds-status', id: `kinds-status-${service.id}`, kind: 'kinds-status', args: { service: service.id },
  url: service.url, file: `kinds-status-${service.id}.rss` });
const statusRequest = (id) => (byId.has(id) ? request(byId.get(id)) : null);

const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#0?39;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const text = (s, max = TEXT_MAX) => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const tag = (block, name) => (block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')) || [])[1] || '';

/** "Oct 21, 19:07 UTC" in an item of the year `year` as epoch seconds, or null. */
function stamp(mon, dd, hhmm, zone, year) {
  const m = MONTHS.indexOf(String(mon).slice(0, 3).toLowerCase());
  const [hh, mm] = String(hhmm).split(':').map(Number);
  const off = ZONES[String(zone).toUpperCase()];
  if (m < 0 || !Number.isFinite(hh) || !Number.isFinite(mm) || off === undefined) return null;
  return Math.floor(Date.UTC(year, m, Number(dd), hh, mm) / 1000) - off * 60;
}

/** An Atlassian item's updates, newest first: [{ at, status, text }]. */
function statuspageUpdates(desc, pubAt) {
  const html = decode(desc);
  const year = new Date((pubAt || 0) * 1000).getUTCFullYear();
  const out = [];
  for (const p of html.split(/<p>/i).slice(1)) {
    const when = p.match(/<small>\s*([A-Za-z]{3})\w*\s*<var[^>]*>\s*(\d{1,2})\s*<\/var>\s*,\s*<var[^>]*>\s*(\d{1,2}:\d{2})\s*<\/var>\s*([A-Z]{2,4})/i);
    const st = p.match(/<strong>([^<]+)<\/strong>\s*-\s*([\s\S]*)$/i);
    if (!when || !st) continue;
    let at = stamp(when[1], when[2], when[3], when[4], year);
    // (a December update in a January feed)
    if (at !== null && pubAt && at > pubAt + 86400) at = stamp(when[1], when[2], when[3], when[4], year - 1);
    out.push({ at, status: st[1].trim().toLowerCase(), text: text(st[2]) });
  }
  return out;
}

/** An incident.io item's one update: "Status: Monitoring" and its words. */
function incidentIoUpdate(desc, pubAt) {
  const html = decode(desc);
  const st = html.match(/Status:\s*([A-Za-z ]+?)\s*<\/b>/i);
  if (!st) return [];
  return [{ at: pubAt, status: st[1].trim().toLowerCase(), text: text(html.replace(/<b>[\s\S]*?<\/b>/i, ' ')) }];
}

/**
 * A feed's incidents as [{ key (the incident's address), title, at (epoch s of its newest update), updates (newest first) }], the
 * newest ITEMS_KEPT, maintenance windows left out; null when it is not a feed.
 */
function parse(xml) {
  const s = String(xml || '');
  if (!/<rss[\s>]/i.test(s)) return null;
  const out = [];
  for (const block of s.split(/<item[\s>]/i).slice(1)) {
    const item = block.split(/<\/item>/i)[0];
    const title = text(tag(item, 'title'), 120);
    const link = text(tag(item, 'link'), 300);
    const pub = Date.parse(text(tag(item, 'pubDate'), 60));
    if (!title || !link || !Number.isFinite(pub)) continue;
    const at = Math.floor(pub / 1000);
    const desc = tag(item, 'description');
    const updates = (/<var[\s\S]*data-var/i.test(decode(desc)) ? statuspageUpdates(desc, at) : incidentIoUpdate(desc, at)).filter((u) => u.at !== null && STATUSES.has(u.status));
    if (!updates.length) continue;
    const maintenance = updates.some((u) => MAINTENANCE.has(u.status));
    // (planned work is never an outage: a feed of maintenance windows would push its incidents out of what is kept)
    if (maintenance) continue;
    out.push({ key: link.replace(/[?#].*$/, ''), title, at: Math.max(...updates.map((u) => u.at)), updates: updates.sort((a, b) => b.at - a.at) });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, ITEMS_KEPT);
}

module.exports = { SERVICES, byId, statusRequest, parse, MAINTENANCE };
