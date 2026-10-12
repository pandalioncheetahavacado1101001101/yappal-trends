'use strict';
/*
 * The model behind the line writer (ios/IDEAS-FEED.md G5): any OpenAI-compatible endpoint, set by the environment only.
 *   IDEAS_LLM_BASE_URL   the endpoint's base; `POST <base>/chat/completions`
 *   IDEAS_LLM_MODEL      the model's name there
 *   IDEAS_LLM_API_KEY    the key, sent as a Bearer token; a keyless endpoint is asked without one
 *   IDEAS_LLM_RPM (10), IDEAS_LLM_DAILY (200), IDEAS_LLM_PER_CYCLE (6), IDEAS_LLM_MAX_TOKENS (200), IDEAS_LLM_JSON (1),
 *   IDEAS_LLM_REASONING (unset; "low" is sent as reasoning_effort to a model that thinks before it answers)
 * With no base URL there are no calls at all, and nothing here is ever read from a file: a key lives in the host's secrets.
 *
 * The editor pass (lib/editor, ios/IDEAS-FEED.md P) is the same endpoint asked for a whole card, one story a request:
 *   IDEAS_EDITOR (unset; 1 turns it on in place of the line writer), IDEAS_EDITOR_CARDS (20 first asks a cycle),
 *   IDEAS_EDITOR_ROWS (40: the rows of the page, from the top, that are written for), IDEAS_EDITOR_BUDGET_MS (300000 in all), IDEAS_EDITOR_UNTIL (unset; an epoch second no call may run past: the host's own
 *   deadline), IDEAS_EDITOR_TIMEOUT_MS (90000 a call), IDEAS_EDITOR_MAX_TOKENS (320), IDEAS_EDITOR_SOURCES (16 sentences shown),
 *   IDEAS_EDITOR_TRACE (unset; a file every card of the cycle is appended to, one JSON a line: for a person to read)
 * A model on the machine itself (127.0.0.1, localhost) takes no key, is not paced and is asked not to think aloud
 * (reasoning_effort "none": measured 2026-10-12 on a 4-core hosted runner, where every small model otherwise spent its whole
 * allowance reasoning and answered nothing).
 *
 * A replayed benchmark day (eval/README.md) may call a model when EVAL_LLM=1 and EVAL_LLM_CACHE names a folder: every reply is
 * kept there by the hash of its request, so a second replay asks nothing and gives the same feed. `cachedCall` is that transport.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { userAgent } = require('./budget');

const CALL_TIMEOUT_MS = 20000;
const RPM = 10;
const DAILY = 200;
const PER_CYCLE = 6;
const MAX_TOKENS = 200;
// what turns the writer off for a day: the key is wrong, or the account would have to pay (never retried into a bill)
const REFUSED = new Set([401, 402, 403]);
// what backs off like any host: too many requests, or the service is down
const TURNED_AWAY = new Set([429, 503]);
/**
 * Endpoints that answered with no key when probed (2026-10-11), and what they take: there the model, its allowance and its pace
 * default, so the one variable IDEAS_LLM_BASE_URL turns the writer on. This one's anonymous model reasons before it answers (the
 * reasoning counts against max_tokens and, unasked to be brief, takes longer than a call may), it serves an anonymous caller about
 * one request a minute (so one line a cycle), and it says 402 where others say 429: a request too soon, not a bill (there is no key
 * to bill).
 */
// (measured again 2026-10-11, later the same day: a second request 3 seconds after the first was told 402, one 20 seconds after it
// was answered; five rows in one request came back in 11 seconds. So: one request every 20 seconds, five rows in each, three
// requests a cycle, and a call may take 40 seconds.)
// (and a third request 20 seconds after the second was told 402 once the same evening: 30 seconds apart, so two or three a cycle)
const KEYLESS = [{ host: 'text.pollinations.ai', model: 'openai-fast', maxTokens: 600, rpm: 2, perCycle: 3, batch: 5, batchTokens: 3000, timeoutMs: 40000, budgetMs: 120000, daily: 1500, reasoning: 'low', tooSoon: [402],
  // (a whole card, and the model's reasoning, count against one allowance: lib/editor)
  editorTokens: 1600, editorTimeoutMs: 60000 }];
// a model served on the machine itself: no key to send, nobody to be polite to, and told not to think aloud
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
const LOCAL = { rpm: 600, daily: 5000, reasoning: 'none' };
const EDITOR_CARDS = 20;
const EDITOR_BUDGET_MS = 300000;
const EDITOR_TIMEOUT_MS = 90000;
const EDITOR_TOKENS = 320;
const EDITOR_SOURCES = 16;
const EDITOR_ROWS = 40;
const BATCH = 1;
const BATCH_MAX = 8;
const BUDGET_MS = 60000;

const count = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; };

/** The writer's settings from the environment, or null when no endpoint is set (or no model for it): then there are no calls. */
function configOf(env = process.env) {
  const baseUrl = String(env.IDEAS_LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) return null;
  let host = '';
  try { host = new URL(baseUrl).host; } catch { return null; }
  // (the editor on a model of the machine's own: its pace, its allowance and its switch; the line writer's settings are as they were)
  const editor = String(env.IDEAS_EDITOR || '').trim() === '1';
  const preset = KEYLESS.find((p) => p.host === host) || (editor && LOCAL_HOST.test(host) ? LOCAL : {});
  const model = String(env.IDEAS_LLM_MODEL || '').trim() || preset.model || '';
  if (!model) return null;
  // (a key is never sent to an endpoint that takes none: a secret saved for another provider, with the base URL left at the keyless
  // default, went out as a Bearer token to a third party on every call, and the 402 it answers "too soon" with then read as a
  // bill refused. Reviewers, 2026-10-12)
  const given = String(env.IDEAS_LLM_API_KEY || '').trim();
  const key = preset.host ? '' : given;
  return { baseUrl, host, model, key, keyIgnored: !!preset.host && !!given, rpm: count(env.IDEAS_LLM_RPM, preset.rpm || RPM), daily: count(env.IDEAS_LLM_DAILY, preset.daily || DAILY),
    perCycle: count(env.IDEAS_LLM_PER_CYCLE, preset.perCycle || PER_CYCLE),
    // (IDEAS_LLM_BATCH: rows written in one request, 1 unless set; the time one call may take and a cycle's calls may take in all)
    batch: Math.min(BATCH_MAX, count(env.IDEAS_LLM_BATCH, preset.batch || BATCH)), batchTokens: preset.batchTokens || null,
    timeoutMs: count(env.IDEAS_LLM_TIMEOUT_MS, preset.timeoutMs || CALL_TIMEOUT_MS), budgetMs: count(env.IDEAS_LLM_BUDGET_MS, preset.budgetMs || BUDGET_MS), maxTokens: count(env.IDEAS_LLM_MAX_TOKENS, preset.maxTokens || MAX_TOKENS), json: String(env.IDEAS_LLM_JSON || '1') !== '0',
    reasoning: String(env.IDEAS_LLM_REASONING || '').trim() || preset.reasoning || null,
    // (only where no key is sent can a 402 mean "too soon": with a key it is a bill refused, and the writer goes off for a day)
    tooSoon: key ? [] : preset.tooSoon || [], agent: userAgent(env),
    // (the editor pass: lib/editor)
    editor, editorCards: count(env.IDEAS_EDITOR_CARDS, EDITOR_CARDS), editorBudgetMs: count(env.IDEAS_EDITOR_BUDGET_MS, EDITOR_BUDGET_MS), editorUntil: count(env.IDEAS_EDITOR_UNTIL, 0) || null,
    editorTimeoutMs: count(env.IDEAS_EDITOR_TIMEOUT_MS, preset.editorTimeoutMs || EDITOR_TIMEOUT_MS), editorTokens: count(env.IDEAS_EDITOR_MAX_TOKENS, preset.editorTokens || EDITOR_TOKENS),
    editorShown: Math.min(40, count(env.IDEAS_EDITOR_SOURCES, EDITOR_SOURCES)), editorRows: Math.min(80, count(env.IDEAS_EDITOR_ROWS, EDITOR_ROWS)), trace: String(env.IDEAS_EDITOR_TRACE || '').trim() || null, traceDossiers: String(env.IDEAS_EDITOR_TRACE_DOSSIERS || '') === '1' };
}

/** One request: POST <base>/chat/completions. The key goes in a header and nowhere else. */
function requestFor(config, body) {
  return { url: `${config.baseUrl}/chat/completions`, init: { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': config.agent,
    ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) }, body: JSON.stringify(body) } };
}
/** The network: resolves { status, text, retryAfter }; a failure or a timeout is status 0. `timeoutMs` caps the one call. */
async function netCall(request, timeoutMs = CALL_TIMEOUT_MS) {
  try {
    const res = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    return { status: res.status, text: await res.text(), retryAfter: res.headers.get('retry-after') };
  } catch (e) {
    return { status: 0, text: '', retryAfter: null, error: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network' };
  }
}

/**
 * One chat completion. Resolves { status, text (the reply body), outcome: 'ok' | 'refused' | 'turned-away' | 'failed', retryAfter }.
 * `call`: the transport (tests hand in a stub); never retried here.
 */
async function chat(config, body, { call = netCall, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const res = await call(requestFor(config, body), timeoutMs);
  const away = TURNED_AWAY.has(res.status) || (config.tooSoon || []).includes(res.status);
  const outcome = res.status === 200 ? 'ok' : away ? 'turned-away' : REFUSED.has(res.status) ? 'refused' : 'failed';
  return { status: res.status, text: res.text || '', outcome, retryAfter: res.retryAfter || null, error: res.error || null };
}

// ---------- a replayed day's model (eval/README.md): asked once, kept on disk ----------
const EVAL_RETRIES = 4;
const EVAL_RETRY_MS = 35000;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** Whether a replay may call a model: EVAL_LLM=1 and a folder to keep every reply in. */
const evalOn = (env = process.env) => String(env.EVAL_LLM || '').trim() === '1' && !!String(env.EVAL_LLM_CACHE || '').trim();
/**
 * A transport that keeps every answered request on disk, by the hash of what was asked (the address, the model, the messages, the
 * settings): a request asked before is answered from its file and costs nothing; a new one goes to the network no faster than the
 * endpoint's own pace (`gapMs` after the last real call, whichever process made it), is asked again a few times when the endpoint
 * says "too soon", and is kept when it is answered. EVAL_LLM_OFFLINE=1: the network is never asked, and a request not on disk
 * gets no answer. Only for a replay: a live cycle never reads an old answer.
 */
function cachedCall(env = process.env, { call = netCall, wait = pause, now = Date.now } = {}) {
  const dir = String(env.EVAL_LLM_CACHE || '').trim();
  const offline = String(env.EVAL_LLM_OFFLINE || '').trim() === '1';
  const config = configOf(env);
  const gapMs = config ? Math.ceil(60000 / config.rpm) : 0;
  const tooSoon = new Set([429, ...((config && config.tooSoon) || [])]);
  const last = path.join(dir, '.last-call');
  const cached = async (request, timeoutMs) => {
    let body = {};
    try { body = JSON.parse(request.init.body); } catch { body = {}; }
    const key = crypto.createHash('sha256').update(JSON.stringify([request.url, body.model, body.messages, body.temperature, body.max_tokens, body.reasoning_effort || null])).digest('hex').slice(0, 32);
    const file = path.join(dir, `${key}.json`);
    try { const kept = JSON.parse(fs.readFileSync(file, 'utf8')); if (kept && kept.status === 200 && typeof kept.text === 'string') return { status: 200, text: kept.text, retryAfter: null, cached: true }; } catch { /* not asked before */ }
    if (offline) return { status: 0, text: '', retryAfter: null, error: 'not in the cache' };
    fs.mkdirSync(dir, { recursive: true });
    let res = { status: 0, text: '', retryAfter: null };
    for (let attempt = 0; attempt <= EVAL_RETRIES; attempt++) {
      let since = Infinity;
      try { since = now() - Number(fs.readFileSync(last, 'utf8')); } catch { since = Infinity; }
      if (Number.isFinite(since) && since < gapMs) await wait(gapMs - since);
      fs.writeFileSync(last, String(now()));
      res = await call(request, timeoutMs);
      if (!tooSoon.has(res.status)) break;
      await wait(EVAL_RETRY_MS);
    }
    if (res.status === 200 && res.text) fs.writeFileSync(file, JSON.stringify({ at: new Date(now()).toISOString(), url: request.url, model: body.model, status: 200, text: res.text, request: body }));
    return res;
  };
  // (it keeps the endpoint's pace itself, and only for a request that really goes out: whoever calls it need not wait between calls)
  cached.paced = true;
  return cached;
}

module.exports = { configOf, requestFor, chat, netCall, evalOn, cachedCall, KEYLESS, LOCAL, CALL_TIMEOUT_MS, RPM, DAILY, PER_CYCLE, MAX_TOKENS, BATCH, BUDGET_MS, EDITOR_CARDS, EDITOR_BUDGET_MS, EDITOR_TIMEOUT_MS, EDITOR_TOKENS };
