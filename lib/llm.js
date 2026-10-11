'use strict';
/*
 * The model behind the line writer (ios/IDEAS-FEED.md G5): any OpenAI-compatible endpoint, set by the environment only.
 *   IDEAS_LLM_BASE_URL   the endpoint's base; `POST <base>/chat/completions`
 *   IDEAS_LLM_MODEL      the model's name there
 *   IDEAS_LLM_API_KEY    the key, sent as a Bearer token; a keyless endpoint is asked without one
 *   IDEAS_LLM_RPM (10), IDEAS_LLM_DAILY (200), IDEAS_LLM_PER_CYCLE (6), IDEAS_LLM_MAX_TOKENS (200), IDEAS_LLM_JSON (1),
 *   IDEAS_LLM_REASONING (unset; "low" is sent as reasoning_effort to a model that thinks before it answers)
 * With no base URL there are no calls at all, and nothing here is ever read from a file: a key lives in the host's secrets.
 */
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
const KEYLESS = [{ host: 'text.pollinations.ai', model: 'openai-fast', maxTokens: 600, rpm: 2, perCycle: 3, batch: 5, batchTokens: 3000, timeoutMs: 40000, budgetMs: 120000, daily: 1500, reasoning: 'low', tooSoon: [402] }];
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
  const preset = KEYLESS.find((p) => p.host === host) || {};
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
    tooSoon: key ? [] : preset.tooSoon || [], agent: userAgent(env) };
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

module.exports = { configOf, requestFor, chat, netCall, KEYLESS, CALL_TIMEOUT_MS, RPM, DAILY, PER_CYCLE, MAX_TOKENS, BATCH, BUDGET_MS };
