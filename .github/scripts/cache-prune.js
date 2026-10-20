#!/usr/bin/env node
'use strict';
/*
 * The state's superseded cache entries (collect.yml, the step after a state save that succeeded):
 *
 *   node .github/scripts/cache-prune.js
 *
 * Every cycle saves its state as a new Actions cache entry, "state-<run id>-<attempt>", and nothing deleted one: 79 copies (5.5 GB)
 * beside the editor model (5.2 GB) put the repository over its 10 GB cache cap on 2026-10-19, where GitHub evicts the least recently
 * used entries and the model or the state could go at any time. This keeps the newest KEEP (3) state entries of this run's own ref
 * and deletes every older one by its exact key, scoped to that ref (the REST API's delete by key takes a complete key, never a
 * prefix). It never touches any other key: "editor-model-*", and anything that is not exactly "state-<digits>-<digits>".
 *
 * Deletes nothing unless the entry this run has just saved (PRUNE_SAVED_KEY) is listed: a save that did not land leaves every older
 * state where it was. Stops at its deadline (PRUNE_UNTIL, epoch seconds on the job's clock, so the job never meets its cap here):
 * what is left goes next run, as does anything past DELETES_PER_RUN (40). Never fails a job: exits 0 whatever happens.
 * Writes counts, never a key, to PRUNE_OUT (default cache-prune.json) for the ledger line:
 *   { seconds, entries, gb, model, deleted, freedGb, kept, failed, left, why }
 *   entries, gb   the repository's whole cache after this step (every key, every ref)
 *   model         whether an "editor-model-*" entry is in it
 *   deleted       state entries deleted (freedGb: their size); kept: state entries of this ref left; failed: deletes refused;
 *                 left: superseded entries not reached before the deadline; why: what stopped the step early, else null
 * Environment: GH_TOKEN (the built-in token; the job's "actions: write"), GH_REPO (owner/name), GITHUB_REF (refs/heads/main),
 * PRUNE_SAVED_KEY, PRUNE_UNTIL, PRUNE_OUT; GITHUB_API_URL (the runner's); PRUNE_KIND. Zero dependencies.
 *
 * PRUNE_KIND=cards (enrich.yml's merge, ios/IDEAS-SUPER.md P11): the same for the merged model cards, "cards-<run>-<attempt>" (the
 * newest KEEP of this ref kept, this run's among them), and every shard's part, "cardpart-<run>-<attempt>-<shard>", of this run or an
 * older one: merged now, or left by a pass whose merge never ran. Never a state key, never "editor-model-*". The counts' "kept" is
 * then the cards entries kept. The stories job's part, "storypart-<run>-<attempt>" (P8), goes with the shards' parts.
 * PRUNE_KIND=vectors (enrich.yml's stories job, P8): the superseded vector caches, "storyvec-<run>-<attempt>", the newest KEEP of
 * this ref kept. PRUNE_KIND unset or "state": the state, as above.
 */
const fs = require('node:fs');

const KEEP = 3;
const STATE_KEY = /^state-\d+-\d+$/;
const CARDS_KEY = /^cards-\d+-\d+$/;
// (a shard's cards, or the stories job's stories: both merged into the cards, ios/IDEAS-SUPER.md P8)
const PART_KEY = /^(?:cardpart-\d+-\d+-\d+|storypart-\d+-\d+)$/;
const VECTORS_KEY = /^storyvec-\d+-\d+$/;
// (what each kind deletes: its own superseded entries, and for the cards the shards' parts they were merged from)
const KINDS = { state: { key: STATE_KEY, parts: null, name: 'state' }, cards: { key: CARDS_KEY, parts: PART_KEY, name: 'cards' },
  vectors: { key: VECTORS_KEY, parts: null, name: 'story vector' } };
const PAGE_SIZE = 100;
const PAGES_MAX = 20;
const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_SECONDS = 60;
const SAVED_TRIES = 3;
const SAVED_WAIT_MS = 3000;
const MARGIN_MS = 2000;
// (a run deletes at most this many: GitHub limits bursts of writes, and the first run after 2026-10-19 had about 76 to delete)
const DELETES_PER_RUN = 40;
const GB = 1e9;

const timeOf = (entry) => { const at = Date.parse(entry && entry.created_at); return Number.isFinite(at) ? at : null; };
const runOf = (key) => Number(String(key).split('-')[1]) || 0;
const gbOf = (bytes) => Math.round((bytes / GB) * 100) / 100;

/**
 * The state keys to delete, oldest first: every "state-<digits>-<digits>" key of `ref` older than its newest `keep` keys, never
 * `savedKey`, and nothing at all unless `savedKey` is listed on `ref`. A key listed twice (two versions) goes only when its newest
 * entry is superseded. An entry whose created_at does not read is never deleted and does not count among the kept.
 * Pure: entries as the REST API lists them ({ key, ref, created_at, ... }).
 */
function superseded(entries, { ref, savedKey, keep = KEEP, key: pattern = STATE_KEY } = {}) {
  if (!Array.isArray(entries) || typeof ref !== 'string' || !ref || typeof savedKey !== 'string' || !pattern.test(savedKey)) return [];
  const mine = entries.filter((e) => e && e.ref === ref && typeof e.key === 'string' && pattern.test(e.key));
  if (!mine.some((e) => e.key === savedKey)) return [];
  // (each key at its newest entry; a key with an entry whose time does not read is left alone)
  const newest = new Map();
  const unread = new Set();
  for (const e of mine) {
    const at = timeOf(e);
    if (at === null) { unread.add(e.key); continue; }
    if (!newest.has(e.key) || newest.get(e.key) < at) newest.set(e.key, at);
  }
  const ranked = [...newest.entries()].filter(([key]) => !unread.has(key)).sort((a, b) => b[1] - a[1] || runOf(b[0]) - runOf(a[0]));
  const kept = new Set([savedKey, ...ranked.slice(0, Math.max(1, Math.floor(Number(keep) || KEEP))).map(([key]) => key)]);
  return ranked.filter(([key]) => !kept.has(key)).map(([key]) => key).reverse();
}

/**
 * The shards' parts done with: every "cardpart-<run>-<attempt>-<shard>" key of `ref` whose run is this merge's run (`savedKey`
 * "cards-<run>-<attempt>") or older, oldest first; nothing unless `savedKey` is listed on `ref` (the merge's own save landed).
 */
function partsDone(entries, { ref, savedKey } = {}) {
  if (!Array.isArray(entries) || typeof ref !== 'string' || !ref || typeof savedKey !== 'string' || !CARDS_KEY.test(savedKey)) return [];
  if (!entries.some((e) => e && e.ref === ref && e.key === savedKey)) return [];
  const run = runOf(savedKey);
  const keys = new Set(entries.filter((e) => e && e.ref === ref && typeof e.key === 'string' && PART_KEY.test(e.key) && runOf(e.key) <= run).map((e) => e.key));
  return [...keys].sort((a, b) => runOf(a) - runOf(b) || (a < b ? -1 : 1));
}

/** The repository's cache entries, every page (newest first). Throws when GitHub cannot be asked. */
async function listAll(api) {
  const all = [];
  for (let page = 1; page <= PAGES_MAX; page += 1) {
    const body = await api('GET', `actions/caches?per_page=${PAGE_SIZE}&page=${page}&sort=created_at&direction=desc`);
    const list = body && Array.isArray(body.actions_caches) ? body.actions_caches : null;
    if (!list) throw new Error('the cache list did not read');
    all.push(...list);
    if (list.length < PAGE_SIZE || (Number.isFinite(body.total_count) && all.length >= body.total_count)) break;
  }
  return all;
}

/** The REST API through fetch: (method, path) -> parsed body; a 404 on a delete is "already gone". Never logs the token. */
function apiOf(env, fetchImpl, deadlineMs, now) {
  const base = `${(env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '')}/repos/${env.GH_REPO}/`;
  return async (method, rest) => {
    const timeoutMs = Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, deadlineMs - now()));
    const res = await fetchImpl(base + rest, { method, signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GH_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ideas-collector-cache-prune' } });
    if (method === 'DELETE' && res.status === 404) return { gone: true };
    if (res.status < 200 || res.status >= 300) { const e = new Error(`GitHub answered ${res.status}`); e.status = res.status; throw e; }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  };
}

const sleepFor = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The step: list, choose, delete until the deadline, write the counts. Resolves the report; never rejects. */
async function prune(env = process.env, { fetchImpl = globalThis.fetch, now = Date.now, sleep = sleepFor, log = (s) => console.log(s) } = {}) {
  const started = now();
  const untilS = Number(env.PRUNE_UNTIL);
  const deadlineMs = (Number.isFinite(untilS) && untilS > 0 ? untilS * 1000 : started + DEFAULT_SECONDS * 1000) - MARGIN_MS;
  const report = { seconds: 0, entries: null, gb: null, model: null, deleted: 0, freedGb: 0, kept: null, failed: 0, left: 0, why: null };
  const ref = env.GITHUB_REF || '';
  const savedKey = env.PRUNE_SAVED_KEY || '';
  const kind = KINDS[env.PRUNE_KIND || 'state'] || null;
  try {
    if (!env.GH_TOKEN) throw new Error('no token');
    if (!/^[\w.-]+\/[\w.-]+$/.test(env.GH_REPO || '')) throw new Error('no repository named');
    if (!/^refs\/[\w./-]+$/.test(ref)) throw new Error('no ref named');
    if (!kind) throw new Error('no such kind');
    if (!kind.key.test(savedKey)) throw new Error(`no saved ${kind.name} key named`);
    if (now() >= deadlineMs) throw new Error('no time left');
    const api = apiOf(env, fetchImpl, deadlineMs, now);
    let entries = await listAll(api);
    // (a save shows in the list a moment after it lands: asked again a few times before giving up for this run)
    for (let tries = 1; tries < SAVED_TRIES && !entries.some((e) => e && e.key === savedKey && e.ref === ref) && now() + SAVED_WAIT_MS < deadlineMs; tries += 1) {
      await sleep(SAVED_WAIT_MS);
      entries = await listAll(api);
    }
    const doomed = [...superseded(entries, { ref, savedKey, keep: KEEP, key: kind.key }), ...(kind.parts ? partsDone(entries, { ref, savedKey }) : [])];
    if (!entries.some((e) => e && e.key === savedKey && e.ref === ref)) report.why = `the saved ${kind.name} is not listed yet: nothing deleted`;
    const gone = new Set();
    for (const key of doomed.slice(0, DELETES_PER_RUN)) {
      if (now() >= deadlineMs) { report.why = 'deadline'; break; }
      try {
        await api('DELETE', `actions/caches?key=${encodeURIComponent(key)}&ref=${encodeURIComponent(ref)}`);
        gone.add(key);
      } catch (e) {
        report.failed += 1;
        // (refused outright: the token cannot delete; no point asking again this run)
        if (e && (e.status === 401 || e.status === 403)) { report.why = `delete refused (${e.status})`; break; }
      }
    }
    const freed = entries.filter((e) => e && e.ref === ref && gone.has(e.key));
    const after = entries.filter((e) => e && !(e.ref === ref && gone.has(e.key)));
    report.deleted = gone.size;
    report.freedGb = gbOf(freed.reduce((n, e) => n + (Number(e.size_in_bytes) || 0), 0));
    report.left = doomed.length - gone.size - report.failed;
    report.entries = after.length;
    report.gb = gbOf(after.reduce((n, e) => n + (Number(e.size_in_bytes) || 0), 0));
    report.model = after.some((e) => typeof e.key === 'string' && e.key.startsWith('editor-model-'));
    report.kept = new Set(after.filter((e) => e.ref === ref && typeof e.key === 'string' && kind.key.test(e.key)).map((e) => e.key)).size;
  } catch (e) {
    report.why = report.why || (e && e.name === 'TimeoutError' ? 'GitHub did not answer in time' : (e && e.message) || 'failed');
  }
  report.seconds = Math.round((now() - started) / 100) / 10;
  log(`cache: ${report.entries ?? '?'} entries, ${report.gb ?? '?'} GB${report.model === null ? '' : report.model ? ' (the editor model is in it)' : ' (NO editor model in it)'}; `
    + `deleted ${report.deleted} superseded ${(kind || KINDS.state).name} entries (${report.freedGb} GB), ${report.kept ?? '?'} kept, ${report.failed} refused, ${report.left} left for the next run`
    + `${report.why ? `; ${report.why}` : ''} (${report.seconds} s)`);
  return report;
}

async function main() {
  const report = await prune(process.env);
  const out = process.env.PRUNE_OUT || 'cache-prune.json';
  try { fs.writeFileSync(`${out}.new`, `${JSON.stringify(report)}\n`); fs.renameSync(`${out}.new`, out); } catch (e) { console.log(`cache: the counts were not written (${e.message})`); }
  return 0;
}

module.exports = { superseded, partsDone, prune, KEEP, STATE_KEY, CARDS_KEY, PART_KEY, VECTORS_KEY, DELETES_PER_RUN };
if (require.main === module) main().then((code) => process.exit(code), () => process.exit(0));
