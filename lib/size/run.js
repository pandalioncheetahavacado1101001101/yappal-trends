#!/usr/bin/env node
'use strict';
/*
 * The size series of live rows and anchors, read from the network by hand (Mac only). A cycle runs the same steps a few requests at a
 * time (lib/size/cycle.js, through lib/size/plan.js and lib/fetch.js). Keyless and polite: the collector's one user agent with a contact
 * (it will not start without one: Wikimedia's user-agent policy asks for it, and the first hand run lost 5 of about 15 requests with
 * the bare agent), one request at a time per host group, a second apart, a host that turns a request away paused as the cycle pauses
 * it (lib/budget.js hostAfter: Retry-After, or 15 minutes doubling; the run waits out a short pause and leaves the host alone for the
 * rest of the run otherwise), and every reply kept in --cache so nothing is asked twice.
 *
 *   IDEAS_UA_CONTACT=<url or email> node lib/size/run.js --feed <v1/us.json> --rows "<a row's title>|<another>" \
 *     --anchors six-seven,squid-game --cache <dir> [--json <out.json>]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { userAgent, hostAfter, hostOpen, hostOfUrl, retryAfterSeconds } = require('../budget');
const SW = require('../sources/size-wiki');
const W = require('./wiki');
const R = require('./resolve');
const T = require('./tracked');
const S = require('./series');
const D = require('./days');
const { ANCHORS } = require('./scale');
const P = require('./proxies');

const GAP_MS = 1100;
const TIMEOUT_MS = 30000;
// a pause this short is waited out; a longer one leaves the host alone for the rest of the run
const WAIT_UP_TO_SECONDS = 120;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

/** The run's user agent, or an error when it carries no contact (IDEAS_UA_CONTACT, or the repository's URL on a CI runner). */
function agentOf(env = process.env) {
  const agent = userAgent(env);
  if (!/\(\+.+\)/.test(agent)) throw new Error('set IDEAS_UA_CONTACT to a URL or an email Wikimedia can reach (the public repository\'s URL will do): the bare agent is refused');
  return agent;
}

/**
 * A GET, kept on disk by its address: { status, text, cached, skipped? }. One request at a time per host group, GAP_MS apart; a 429,
 * a 403, a 503 or any 5xx (or two timeouts) pauses the group by lib/budget.js hostAfter, and a request to a paused group waits when
 * the pause is short, else it is not sent ({ status: 0, skipped: true }). transport and clock are for the tests.
 */
function getter(cacheDir, { agent = agentOf(), transport = fetch, clock = () => Date.now(), pause = sleep, log = (line) => console.error(line) } = {}) {
  const lastAt = new Map();
  const count = new Map();
  const hosts = new Map();
  const skipped = new Map();
  async function get(url) {
    const file = path.join(cacheDir, `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 24)}.json`);
    if (fs.existsSync(file)) return { ...JSON.parse(fs.readFileSync(file, 'utf8')), cached: true };
    const host = hostOfUrl(url);
    const row = hosts.get(host);
    if (!hostOpen(row, clock() / 1000)) {
      const left = row.blocked_until - clock() / 1000;
      if (left > WAIT_UP_TO_SECONDS) { skipped.set(host, (skipped.get(host) || 0) + 1); return { status: 0, url, text: '', cached: false, skipped: true }; }
      await pause(left * 1000);
    }
    const wait = (lastAt.get(host) || 0) + GAP_MS - clock();
    if (wait > 0) await pause(wait);
    lastAt.set(host, clock());
    count.set(host, (count.get(host) || 0) + 1);
    let res;
    let text = '';
    try {
      res = await transport(url, { headers: { 'User-Agent': agent }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      text = await res.text();
    } catch (e) {
      hosts.set(host, { ...hostAfter(row, { status: 0, retryAfter: null, timeout: true }, clock() / 1000, host), host });
      log(`  no answer from ${host} (${e && e.message ? e.message : e}): ${url.slice(0, 120)}`);
      return { status: 0, url, text: '', cached: false };
    }
    const retryAfter = retryAfterSeconds(res.headers.get('retry-after'), clock() / 1000);
    const next = { ...hostAfter(row, { status: res.status, retryAfter, timeout: false }, clock() / 1000, host), host };
    hosts.set(host, next);
    const out = { status: res.status, url, text };
    if (res.status !== 200 && res.status !== 404) {
      const paused = hostOpen(next, clock() / 1000) ? '' : ` (${host} paused ${Math.round(next.blocked_until - clock() / 1000)} s)`;
      log(`  ${res.status} from ${host}${retryAfter ? ` (retry after ${retryAfter} s)` : ''}${paused}: ${url.slice(0, 120)}`);
    }
    // (a refusal or a failure is not kept: it is asked again next run)
    if (res.status === 200 || res.status === 404) { const tmp = `${file}.new`; fs.writeFileSync(tmp, JSON.stringify(out)); fs.renameSync(tmp, file); }
    return { ...out, cached: false };
  }
  return { get, count, hosts, skipped };
}

/** One trend measured end to end. spec: { label, row, trendStart, today, tracked }. */
async function measure(spec, get, views) {
  const { row, trendStart, today } = spec;
  const yesterday = D.addDays(today, -1);
  const subjects = R.subjectsOf(row);
  const replies = new Map();
  for (const s of subjects) {
    const res = await get(SW.searchUrl(s.query));
    replies.set(s.id, res.status === 200 ? SW.parseSearch(res.text) || [] : []);
  }
  const resolved = R.resolve(row, replies, trendStart);
  const fetchTitle = async (title, from, to) => {
    const res = await get(SW.viewsUrl(title, from, to));
    const items = W.parseRest(res.text) || [];
    if (items.length) views.published = [views.published, items[items.length - 1].day].filter(Boolean).sort().pop();
    const covered = res.status === 200 || res.status === 404 ? W.coveredTo(items, to, views.published) : null;
    if (covered) views.cache[title] = W.mergeFetch(views.cache[title], title, items, { from, to: covered });
    return views.cache[title];
  };
  const subjectTitles = [];
  const articles = [];
  for (const a of resolved.articles) {
    const res = await get(SW.redirectsUrl(a.pageid));
    const titles = SW.titlesOf(a.title, res.status === 200 ? SW.parseRedirects(res.text) || [] : []);
    const entries = [];
    for (const t of titles) for (const range of W.wantRanges(views.cache[t], W.historyFrom(trendStart), yesterday)) entries.push(await fetchTitle(t, range.from, range.to));
    const held = titles.map((t) => views.cache[t]).filter(Boolean);
    const judged = R.confirm(a, (W.subjectViews(held) || {}).views || null, trendStart);
    if (judged.verdict === 'refuse') { resolved.refused.push(judged); continue; }
    articles.push({ ...judged, titles });
    subjectTitles.push({ kind: a.kind, titles });
  }
  const held = () => subjectTitles.map((s) => ({ kind: s.kind, titles: s.titles.map((t) => views.cache[t]) }));
  let wiki = subjectTitles.length ? W.wikiSize(held(), trendStart) : null;
  // (a life that reaches back to the first day held, or an own page whose start is older than what is held: its earlier history, once)
  if (W.wantsEarlier(wiki)) {
    for (const s of subjectTitles) for (const t of s.titles) for (const range of W.wantRanges(views.cache[t], W.DAILY_FROM, yesterday)) await fetchTitle(t, range.from, range.to);
    wiki = W.wikiSize(held(), trendStart);
  }
  const size = S.sizeOf({ wiki, tracked: spec.tracked, trendStart, today });
  return { label: spec.label, subjects, articles, refused: resolved.refused, wiki, size, field: S.feedField(size) };
}

const short = (p) => `${p.day.slice(2)} ${p.pct.toFixed(1)}${p.estimated ? '*' : ''}`;
function report(m) {
  const lines = [`== ${m.label}`];
  lines.push(`   articles: ${m.articles.map((a) => `${a.title} [${a.titles.join(' + ')}] (${a.verdict} ${a.confidence}: ${a.why})`).join('; ') || 'none'}`);
  if (m.refused.length) lines.push(`   refused: ${m.refused.map((r) => `${r.title} (${r.why})`).join('; ')}`);
  if (m.wiki) lines.push(`   wiki: held ${m.wiki.from}..${m.wiki.to}, baselines ${m.wiki.baselines.map((b) => Math.round(b)).join(' + ')}, life floor ${m.wiki.lifeFloor}, life ${m.wiki.life ? `${m.wiki.life.start}..${m.wiki.life.end}${m.wiki.life.ended ? ' (ended)' : ''}` : 'never above the floor'}`);
  if (!m.size) { lines.push('   size: none (listed, size not measured)'); return lines.join('\n'); }
  const s = m.size;
  lines.push(`   size ${s.peakPct}% (best 30 days ${s.peakFrom}..${s.peakTo})${s.spike ? `, a spike (${s.daysAboveHalf} days above half its peak)` : s.daysAboveHalf !== null ? ` (${s.daysAboveHalf} days above half its peak)` : ''}${s.marker ? ', one marker' : ''}; line highest on ${s.lineTopDay}`);
  lines.push(`   ${s.points.length} days ${s.start}..${s.end}, from ${s.from}${s.fromDay ? ` (${s.fromDay})` : ''}; ${m.field ? `feed field ${Buffer.byteLength(JSON.stringify(m.field))} bytes, ${m.field.series.length} points` : 'no feed field (one marker, or a line that never reached 1%)'}`);
  lines.push(`   stretches: ${s.stretches.map((x) => `${x.from}..${x.to} ${x.basis}${x.estimated ? ' (estimated)' : ''}`).join('; ')}`);
  if (m.field) lines.push(`   series: ${m.field.series.map(short).join(', ')}`);
  return lines.join('\n');
}

/**
 * Resolution alone for every row of a feed (the lookups and the redirects, no views): how many rows have a page, how many subjects
 * and titles each, and every page attached or refused, to read by eye for namesakes.
 */
async function resolveAll(feed, get) {
  const feedDay = D.dayOfInstant(feed.generatedAt);
  const rows = [];
  for (const row of feed.items) {
    const trendStart = row.startedAt ? D.dayOfInstant(row.startedAt) : feedDay;
    const subjects = R.subjectsOf(row);
    const replies = new Map();
    for (const s of subjects) { const res = await get(SW.searchUrl(s.query)); replies.set(s.id, res.status === 200 ? SW.parseSearch(res.text) || [] : []); }
    const r = R.resolve(row, replies, trendStart);
    const articles = [];
    for (const a of r.articles) {
      const res = await get(SW.redirectsUrl(a.pageid));
      articles.push({ ...a, titles: SW.titlesOf(a.title, res.status === 200 ? SW.parseRedirects(res.text) || [] : []) });
    }
    rows.push({ rank: row.rank, title: row.title, subjects: subjects.length, articles, refused: r.refused });
  }
  return rows;
}

async function main() {
  const a = args(process.argv);
  const cacheDir = a.cache;
  if (!cacheDir) throw new Error('--cache <dir> is required');
  const agent = agentOf();
  fs.mkdirSync(cacheDir, { recursive: true });
  const { get, count, skipped } = getter(cacheDir, { agent });
  const today = a.today || D.dayOfInstant(Date.now() / 1000);
  const specs = [];
  if (a.feed) {
    const feed = JSON.parse(fs.readFileSync(a.feed, 'utf8'));
    const feedDay = D.dayOfInstant(feed.generatedAt);
    const wanted = (a.rows || '').split('|').map((s) => s.trim()).filter(Boolean);
    for (const title of wanted) {
      const row = feed.items.find((r) => r.title === title);
      if (!row) { console.error(`no row "${title}" in the feed`); continue; }
      const trendStart = row.startedAt ? D.dayOfInstant(row.startedAt) : feedDay;
      // (a band is a running total: it is read on the day the row peaked, not the day the list was made)
      const demandDay = row.demand && row.demand.kind === 'search' && row.peakAt ? D.dayOfInstant(row.peakAt) : feedDay;
      specs.push({ label: `${row.title} (row ${row.rank}, ${row.kind}/${row.sub || '-'}, demand ${row.demand ? row.demand.label || `${row.demand.kind} ${row.demand.value}` : 'none'})`,
        row, trendStart, today, tracked: [T.trackedFromDemand(row.demand, demandDay)].filter(Boolean) });
    }
  }
  const anchorRows = {
    'six-seven': { kind: 'word', sub: 'meme', title: '6-7', topic: { name: '6-7' } },
    'squid-game': { kind: 'talk', sub: 'show', title: 'Squid Game', topic: { name: 'Squid Game' } },
    ppap: { kind: 'word', sub: 'meme', title: 'Pen-Pineapple-Apple-Pen', topic: { name: 'Pen-Pineapple-Apple-Pen' } },
    'among-us': { kind: 'word', sub: 'game', title: 'Among Us', topic: { name: 'Among Us' } },
    barbenheimer: { kind: 'word', sub: 'meme', title: 'Barbenheimer', topic: { name: 'Barbenheimer' } },
  };
  for (const id of (a.anchors || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const anchor = ANCHORS.anchors.find((x) => x.id === id);
    if (!anchor || !anchorRows[id]) { console.error(`no anchor "${id}" this run can read (REST-era anchors only)`); continue; }
    specs.push({ label: `anchor ${anchor.short} (calibrated ${anchor.views} on ${anchor.peakDay}, ${anchor.pct}%)`, row: anchorRows[id], trendStart: anchor.peakDay, today, tracked: [] });
  }
  if (a['resolve-all'] && a.feed) {
    const rows = await resolveAll(JSON.parse(fs.readFileSync(a.feed, 'utf8')), get);
    for (const r of rows) console.log(`${String(r.rank).padStart(2)} ${r.title}: ${r.articles.map((x) => `${x.title} [${x.titles.length}] ${x.verdict} ${x.confidence}`).join('; ') || '-'}${r.refused.length ? ` | refused ${r.refused.map((x) => `${x.title} (${x.why})`).join('; ')}` : ''}`);
    const withPage = rows.filter((r) => r.articles.length);
    const accepted = withPage.filter((r) => r.articles.some((x) => x.verdict === 'accept'));
    const titles = withPage.flatMap((r) => r.articles.map((x) => x.titles.length));
    console.log(`rows ${rows.length}; subjects ${rows.reduce((s, r) => s + r.subjects, 0)}; rows with a page ${withPage.length} (${accepted.length} accepted outright, the rest waiting on their spike); pages ${titles.length}, titles ${titles.reduce((s, n) => s + n, 0)}`);
    console.log(`requests sent: ${[...count].map(([h, n]) => `${h} ${n}`).join(', ') || 'none (all from the cache)'}`);
    return;
  }
  const views = { cache: {}, published: null };
  const out = [];
  for (const spec of specs) {
    const m = await measure(spec, get, views);
    out.push(m);
    console.log(report(m));
  }
  console.log(`requests sent: ${[...count].map(([h, n]) => `${h} ${n}`).join(', ') || 'none (all from the cache)'}${skipped.size ? `; not sent (host paused): ${[...skipped].map(([h, n]) => `${h} ${n}`).join(', ')}` : ''}; Wikipedia's daily views published through ${views.published}`);
  if (a.json) {
    const plain = out.map((m) => ({ label: m.label, articles: m.articles, refused: m.refused, life: m.wiki && m.wiki.life, baselines: m.wiki && m.wiki.baselines, stretches: m.size && m.size.stretches,
      size: m.field, days: m.size && m.size.points.map((p) => ({ day: p.day, line: Math.round(p.pct * 10) / 10, day1: Math.round(p.dayPct * 10) / 10, views: Math.round(p.views), basis: P.LABEL[p.basis] || p.basis, estimated: p.estimated, partial: p.partial })) }));
    fs.writeFileSync(a.json, JSON.stringify(plain, null, 1));
  }
}

if (require.main === module) main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });

module.exports = { measure, report, getter, agentOf, WAIT_UP_TO_SECONDS };
