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
 * Ollama's own API (the enrich shards, ios/IDEAS-SUPER.md P11; the host's model.sh sets these): IDEAS_LLM_OLLAMA=1 sends the same
 * request to <origin>/api/chat instead (machine-local endpoints only), translated field for field as Ollama's OpenAI layer does it
 * (temperature, top_p 1, max_tokens as num_predict, json_object as format "json", reasoning_effort "none" as think false), and
 * the reply translated back, so the editor reads the very same thing. Why: only that API says where a call's time went
 * (prompt_eval_count/duration, eval_count/duration, load_duration: `usageOf`), and it takes the load-time options every request
 * must agree on or the server reloads the model: IDEAS_LLM_NUM_CTX (num_ctx), IDEAS_LLM_NUM_THREAD (num_thread),
 * IDEAS_LLM_KEEP_ALIVE (30m).
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
/** Whether config's endpoint is a model served on this machine (no key, no pace, as many requests at once as it serves). */
const isLocal = (config) => !!config && LOCAL_HOST.test(String(config.host || ''));
const KEEP_ALIVE = '30m';
// (Ollama's OpenAI layer sets these when a request names none: the native request does the same, so the model samples alike)
const COMPAT_TEMPERATURE = 1;
const COMPAT_TOP_P = 1;
const NS_PER_MS = 1e6;
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
  // (Ollama's own API: only to a model on this machine, and only when the host's model.sh says that is what it served)
  const ollama = String(env.IDEAS_LLM_OLLAMA || '').trim() === '1' && LOCAL_HOST.test(host);
  return { baseUrl, host, model, key, ollama, numCtx: ollama ? count(env.IDEAS_LLM_NUM_CTX, 0) || null : null, numThread: ollama ? count(env.IDEAS_LLM_NUM_THREAD, 0) || null : null,
    keepAlive: ollama ? String(env.IDEAS_LLM_KEEP_ALIVE || '').trim() || KEEP_ALIVE : null, keyIgnored: !!preset.host && !!given, rpm: count(env.IDEAS_LLM_RPM, preset.rpm || RPM), daily: count(env.IDEAS_LLM_DAILY, preset.daily || DAILY),
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

/**
 * An OpenAI-style chat body as Ollama's own /api/chat takes it, translated as Ollama's OpenAI layer translates it, plus the load-time
 * options of config (num_ctx, num_thread: the same on every request, or the server reloads the model) and keep_alive.
 */
function nativeBodyOf(config, body) {
  const options = { temperature: Number.isFinite(body.temperature) ? body.temperature : COMPAT_TEMPERATURE, top_p: Number.isFinite(body.top_p) ? body.top_p : COMPAT_TOP_P,
    ...(Number.isFinite(body.max_tokens) ? { num_predict: body.max_tokens } : {}), ...(config.numCtx ? { num_ctx: config.numCtx } : {}), ...(config.numThread ? { num_thread: config.numThread } : {}) };
  const effort = typeof body.reasoning_effort === 'string' && body.reasoning_effort.trim() ? body.reasoning_effort.trim() : null;
  const json = !!body.response_format && body.response_format.type === 'json_object';
  return { model: body.model, messages: body.messages, stream: false, ...(json ? { format: 'json' } : {}), ...(effort ? { think: effort === 'none' ? false : effort } : {}), options,
    ...(config.keepAlive ? { keep_alive: config.keepAlive } : {}) };
}
/** Ollama's /api/chat reply as an OpenAI chat completion's body (what lib/editor/prompt.js contentOf reads); a body that does not read is left as it is. */
function openAiOf(text) {
  let o;
  try { o = JSON.parse(text); } catch { return text; }
  if (!o || typeof o !== 'object' || !o.message || typeof o.message !== 'object') return text;
  const prompt = Number(o.prompt_eval_count) || 0;
  const reply = Number(o.eval_count) || 0;
  return JSON.stringify({ object: 'chat.completion', model: o.model || null, choices: [{ index: 0, message: { role: 'assistant', content: typeof o.message.content === 'string' ? o.message.content : '' },
    finish_reason: o.done_reason === 'length' ? 'length' : 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: reply, total_tokens: prompt + reply } });
}
/**
 * Where one answered call's time went, from its reply body: { promptTokens, promptMs, replyTokens, replyMs, loadMs, timed }, or null.
 * Ollama's own API gives the counts and the durations (prompt_eval_count/duration: the prompt the server had to read, the part its
 * cache did not hold; eval_count/duration: the reply; load_duration); an OpenAI-style body only the counts (timed false).
 */
function usageOf(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  if (o.message && (o.prompt_eval_count !== undefined || o.eval_count !== undefined)) {
    const ms = (v) => (num(v) === null ? 0 : num(v) / NS_PER_MS);
    return { promptTokens: num(o.prompt_eval_count) || 0, promptMs: ms(o.prompt_eval_duration), replyTokens: num(o.eval_count) || 0, replyMs: ms(o.eval_duration), loadMs: ms(o.load_duration), timed: true };
  }
  const u = o.usage && typeof o.usage === 'object' ? o.usage : null;
  if (!u) return null;
  return { promptTokens: num(u.prompt_tokens) || 0, promptMs: 0, replyTokens: num(u.completion_tokens) || 0, replyMs: 0, loadMs: 0, timed: false };
}

/** One request: POST <base>/chat/completions (Ollama's own: <origin>/api/chat, `nativeBodyOf`). The key goes in a header and nowhere else. */
function requestFor(config, body) {
  const url = config.ollama ? `${new URL(config.baseUrl).origin}/api/chat` : `${config.baseUrl}/chat/completions`;
  return { url, init: { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': config.agent,
    ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) }, body: JSON.stringify(config.ollama ? nativeBodyOf(config, body) : body) } };
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
 * One chat completion. Resolves { status, text (the reply body, OpenAI-style whichever API answered), outcome: 'ok' | 'refused' |
 * 'turned-away' | 'failed', retryAfter, usage (`usageOf`, or null) }. `call`: the transport (tests hand in a stub); never retried here.
 */
async function chat(config, body, { call = netCall, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const res = await call(requestFor(config, body), timeoutMs);
  const away = TURNED_AWAY.has(res.status) || (config.tooSoon || []).includes(res.status);
  const outcome = res.status === 200 ? 'ok' : away ? 'turned-away' : REFUSED.has(res.status) ? 'refused' : 'failed';
  const text = config.ollama && res.status === 200 ? openAiOf(res.text || '') : res.text || '';
  return { status: res.status, text, outcome, retryAfter: res.retryAfter || null, error: res.error || null, usage: res.status === 200 ? usageOf(res.text || '') : null };
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
    // (Ollama's own API carries its settings in options, format and think: in the key too; an OpenAI-style request's key is as it was)
    const native = body.options ? [body.options, body.format || null, body.think === undefined ? null : body.think] : [];
    const key = crypto.createHash('sha256').update(JSON.stringify([request.url, body.model, body.messages, body.temperature, body.max_tokens, body.reasoning_effort || null, ...native])).digest('hex').slice(0, 32);
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

module.exports = { configOf, requestFor, chat, netCall, evalOn, cachedCall, nativeBodyOf, openAiOf, usageOf, isLocal, KEYLESS, LOCAL, KEEP_ALIVE, CALL_TIMEOUT_MS, RPM, DAILY, PER_CYCLE, MAX_TOKENS, BATCH, BUDGET_MS, EDITOR_CARDS, EDITOR_BUDGET_MS, EDITOR_TIMEOUT_MS, EDITOR_TOKENS };
