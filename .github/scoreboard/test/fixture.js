'use strict';
/*
 * A small invented state and invented comparator replies for the offline tests: every name here is made up. The state has the
 * tables and columns the scoreboard reads (lib/state.js's shape), an archive of US lists and a store with Know Your Meme rows.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const HOUR = 3600;
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `scoreboard-${name}-`));
const iso = (s) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Writes a state folder. trends: [{ id, kind, sub, title, firstSeen, listed, rank (at its first listing: 10 unless given), ended,
 * aliases, info }]; samples: [{ id, t, sv_us, interest, n24, outlets, r_us, flags }]; lists: [{ name ("2026-10-17-0900"), t, items }];
 * kym: [{ url, seenFirst (s) }]; viral: [{ id, firstSeen }] (platform_items, optional). As the collector does, a trend's first listing
 * is a sample ranking it (r_us) at `listed`, and every archived list's row a sample ranking it at the list's time; first_listed_at and
 * first_page_at are the first of those ranked at all and ranked 1 to 20.
 */
function writeState({ firstCycleAt, trends = [], samples = [], lists = [], kym = [], viral = null, meta = {} }) {
  const dir = tmp('state');
  fs.mkdirSync(path.join(dir, 'engine'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'collector.db'));
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE trends (id TEXT PRIMARY KEY, natural_key TEXT, kind TEXT, sub TEXT, first_seen INTEGER, ended_at INTEGER, first_listed_at TEXT, first_page_at TEXT, title TEXT, info TEXT);
    CREATE TABLE aliases (key TEXT PRIMARY KEY, trend_id TEXT NOT NULL);
    CREATE TABLE texts (trend_id TEXT, t INTEGER, title TEXT, line TEXT, PRIMARY KEY (trend_id, t));
    CREATE TABLE samples (trend_id TEXT, t INTEGER, res INTEGER, sv_us INTEGER, interest REAL, n24 INTEGER, outlets INTEGER, r_us INTEGER, flags INTEGER, PRIMARY KEY (trend_id, t, res));`);
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('firstCycleAt', JSON.stringify(firstCycleAt));
  for (const [k, v] of Object.entries(meta)) db.prepare('INSERT INTO meta VALUES (?, ?)').run(k, JSON.stringify(v));
  // (the ranked samples the collector writes when it lists a trend, then the given ones; at one instant the given values win)
  const ranked = [
    ...trends.filter((t) => Number.isFinite(t.listed)).map((t) => ({ id: t.id, t: t.listed, r_us: t.rank ?? 10 })),
    ...lists.flatMap((l) => l.items.filter((x) => Number.isFinite(x.rank)).map((x) => ({ id: x.id, t: l.t, r_us: x.rank }))),
  ];
  const merged = new Map();
  for (const s of [...ranked, ...samples]) merged.set(`${s.id}|${s.t}`, { ...(merged.get(`${s.id}|${s.t}`) || {}), ...s });
  const firstRanked = (id, depth) => {
    const ts = [...merged.values()].filter((s) => s.id === id && Number.isFinite(s.r_us) && s.r_us >= 1 && s.r_us <= depth && !((s.flags || 0) & 36)).map((s) => s.t);
    return ts.length ? Math.min(...ts) : null;
  };
  const put = db.prepare('INSERT INTO trends VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const t of trends) {
    const listed = firstRanked(t.id, Infinity);
    const paged = firstRanked(t.id, 20);
    put.run(t.id, t.title.toLowerCase(), t.kind || 'talk', t.sub || null, t.firstSeen, t.ended ?? null, JSON.stringify(listed !== null ? { US: listed } : {}),
      JSON.stringify(paged !== null ? { US: paged } : {}), t.title, JSON.stringify(t.info || {}));
    for (const a of t.aliases || []) db.prepare('INSERT INTO aliases VALUES (?, ?)').run(a, t.id);
  }
  const ps = db.prepare('INSERT INTO samples VALUES (?, ?, 900, ?, ?, ?, ?, ?, ?)');
  for (const s of merged.values()) ps.run(s.id, s.t, s.sv_us ?? null, s.interest ?? null, s.n24 ?? null, s.outlets ?? null, s.r_us ?? null, s.flags ?? 0);
  if (viral) {
    db.exec('CREATE TABLE platform_items (source TEXT, key TEXT, t INTEGER, first_seen INTEGER, last_seen INTEGER, fresh INTEGER, title TEXT, who TEXT, data TEXT, PRIMARY KEY (source, key))');
    for (const v of viral) db.prepare("INSERT INTO platform_items VALUES ('tts', ?, NULL, ?, ?, 0, NULL, NULL, NULL)").run(`viral:${v.id}`, v.firstSeen, v.firstSeen);
  }
  db.close();
  for (const l of lists) {
    const file = path.join(dir, 'archive', 'US', `${l.name}.json.gz`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ schemaVersion: 1, audience: 'US', generatedAt: iso(l.t), items: l.items })));
  }
  fs.writeFileSync(path.join(dir, 'engine', 'store.json'), JSON.stringify({ rows: kym.map((k) => ({ key: k.url, url: k.url, fam: 'kym', seenFirst: k.seenFirst * 1000 })) }));
  return dir;
}

/** Google Trends' batchexecute reply. rows: [{ keyword, start, volume, categories, related }]. */
function gtReply(rows) {
  const data = [null, rows.map((r) => [r.keyword, null, 'US', [r.start], null, null, r.volume || 20000, null, 1000, r.related || [r.keyword], r.categories || [4], []])];
  return `)]}'\n\n123\n${JSON.stringify([['wrb.fr', 'i0OFE', JSON.stringify(data), null, null, null, 'generic']])}\n`;
}
const rssReply = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map((i) => `<item><link>${i.url}</link><title>${i.title}</title><pubDate>${new Date(i.at * 1000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
/** The Viral 50 page. rows: [{ title, artist, id }] in rank order; day: "October 17, 2026". */
function viralReply(rows, day) {
  const list = { '@type': 'ItemList', itemListElement: rows.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: `${r.title} by ${r.artist}`, url: `https://www.tiktok.com/music/${r.title.toLowerCase()}-${r.id}` })) };
  return `<html><head><script type="application/ld+json">${JSON.stringify(list)}</script></head><body><p>As of ${day}, this United States Viral chart contains ${rows.length} ranked TikTok sounds.</p></body></html>`;
}
const xReply = (names) => `<html><table class="ranking">${names.map((n, i) => `<tr><th scope="row" class="pos">${i + 1}</th><td class="main"><a class="string" href="/united-states/trend/${encodeURIComponent(n)}/">${n}</a></td></tr>`).join('')}</table></html>`;

/** A folder of saved replies under the names comparators.js READS uses. */
function writeReplies(files) {
  const dir = tmp('replies');
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

module.exports = { HOUR, tmp, iso, writeState, gtReply, rssReply, viralReply, xReply, writeReplies };
