'use strict';
/*
 * Sending a cycle's requests (ios/IDEAS-FEED.md A4): one host at a time per host, spaced out, hosts side by side; no retries inside a
 * cycle; a host that turns one request away gets nothing more this cycle or the next (lib/budget.js hostAfter). The transport is
 * handed in, so a replay reads saved replies through the very same path (test/replay.test.js).
 */
const zlib = require('node:zlib');
const { gapOf, hostAfter, hostOpen, retryAfterSeconds, userAgent } = require('./budget');

const REQUEST_TIMEOUT_MS = 20000;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The network: one GET or POST with the collector's one user agent. Resolves { status, text, retryAfter, date, etag, lastModified };
 * rejects on a failure. A request that says `validators` ({ etag, lastModified }: what the same address answered with last time) is
 * sent conditionally, and a 304 then says the file has not changed (M: a page that changes once a day is not downloaded twice). A
 * request that says `gzip` asks for a file that is gzip itself: it is gunzipped here, so everything after reads text.
 */
function netTransport(env = process.env) {
  const agent = userAgent(env);
  return async (request) => {
    const init = request.init || {};
    const v = request.validators || {};
    const conditional = { ...(v.etag ? { 'If-None-Match': v.etag } : {}), ...(v.lastModified ? { 'If-Modified-Since': v.lastModified } : {}) };
    const res = await fetch(request.url, { ...init, headers: { 'User-Agent': agent, ...conditional, ...(init.headers || {}) }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'follow' });
    const text = request.gzip && res.status === 200 ? zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8') : await res.text();
    // (date: the server's own clock, what a cycle checks its slot against before it publishes)
    return { status: res.status, text, retryAfter: res.headers.get('retry-after'), date: res.headers.get('date'), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  };
}

/**
 * Sends `requests` in the order given (the order is the priority: what the budget refuses is simply not sent), and resolves every
 * result: [{ request, status (0 when it failed), text, ms, bytes, timeout, tried, guessed }].
 * opts: { budget, hosts (Map: rows are replaced as answers come), clock (() => epoch seconds), deadlineMs (wall clock), transport,
 *   gap (ms for a host; 0 in a replay), onResult (called as each answer lands) }.
 */
async function send(requests, { budget, hosts, clock, deadlineMs = Infinity, transport, gap = gapOf, onResult = () => {} }) {
  const accepted = requests.filter((r) => budget.take(r));
  const byHost = new Map();
  for (const r of accepted) byHost.set(r.host, [...(byHost.get(r.host) || []), r]);
  const results = [];
  const one = async (request, url, args) => {
    const started = Date.now();
    try {
      const res = await transport({ ...request, url, args });
      return { request: { ...request, url, args }, status: res.status, text: res.text || '', ms: Date.now() - started, bytes: Buffer.byteLength(res.text || ''),
        timeout: false, retryAfter: retryAfterSeconds(res.retryAfter, clock()), date: res.date || null, etag: res.etag || null, lastModified: res.lastModified || null };
    } catch (e) {
      const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { request: { ...request, url, args }, status: 0, text: '', ms: Date.now() - started, bytes: 0, timeout, retryAfter: null, error: e && e.message ? e.message : String(e) };
    }
  };
  await Promise.all([...byHost.entries()].map(async ([host, list]) => {
    let first = true;
    for (const request of list) {
      // (a host put aside by an earlier answer of this cycle, or the fetch deadline: what was counted and never sent gives its place back)
      if (!hostOpen(hosts.get(host), clock()) || Date.now() > deadlineMs) { budget.giveBack(request); budget.refused.push({ id: request.id, host, why: Date.now() > deadlineMs ? 'deadline' : 'back-off' }); if (!hostOpen(hosts.get(host), clock())) budget.blocked.add(host); continue; }
      if (!first) await sleep(gap(host));
      first = false;
      let result = await one(request, request.url, request.args);
      hosts.set(host, { ...hostAfter(hosts.get(host), result, clock(), host), host });
      let tried = 1;
      let guessed = request.args && request.args.known === false ? 1 : 0;
      // (a term's next address only after a 404, each one a request of its own)
      for (const next of request.fallbacks || []) {
        if (result.status !== 404 || !hostOpen(hosts.get(host), clock()) || Date.now() > deadlineMs || !budget.take({ ...request, id: `${request.id}+${tried}` })) break;
        await sleep(gap(host));
        result = await one(request, next.url, next.args);
        hosts.set(host, { ...hostAfter(hosts.get(host), result, clock(), host), host });
        tried += 1;
        if (next.args && next.args.known === false) guessed += 1;
      }
      const done = { ...result, tried, guessed };
      results.push(done);
      onResult(done);
    }
  }));
  // (in the order asked, so the store is filled the same way whatever order the answers came in)
  const order = new Map(accepted.map((r, i) => [r.id, i]));
  return results.sort((a, b) => order.get(a.request.id) - order.get(b.request.id));
}

module.exports = { send, netTransport, REQUEST_TIMEOUT_MS };
