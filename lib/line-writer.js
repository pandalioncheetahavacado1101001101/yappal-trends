'use strict';
/*
 * Writing the one line (ios/IDEAS-FEED.md G5): which rows are asked this cycle, the cache that makes a line written once, the limits
 * (six calls a cycle, sixty seconds, a daily cap counted in `lines`, the provider's own refusals), and the fallback. A line reaches
 * the feed as "model" only when the claim check passes it (lib/lines.js); everything else is the headline path (lib/line-sources.js).
 * The model is behind `call`, so the tests run it against a stub.
 */
const TL = require('../engine/talk-lines');
const TN = require('../engine/talk-nouns');
const W = require('../engine/wording');
const LLM = require('./llm');
const P = require('./line-prompt');
const SRC = require('./line-sources');
const COMPOSE = require('./line-compose');
const { checkLine } = require('./lines');
const { HOUR, DAY, keyOf } = require('./util');

// (the rows a cycle may ask for: the page and the first of "Show more", in the order they are laid out)
const PAGE = 40;
const BUDGET_MS = 60000;
const MIN_CALL_MS = 5000;
const REWRITE_AFTER_SECONDS = 2 * HOUR;
const OFF_SECONDS = 24 * HOUR;
const UNANSWERED_AGAIN_SECONDS = 15 * 60;
const BACKOFF_FIRST_SECONDS = 15 * 60;
const BACKOFF_MAX_SECONDS = 6 * HOUR;
const WHY_MAX = 300;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * One attempt for one item: ask, read the reply, check the line. Resolves
 * { outcome: 'passed' | 'failed-check' | 'unreadable' | 'refused' | 'turned-away' | 'failed', line, why, status, retryAfter, check }.
 */
async function attempt(config, inputs, { call, timeoutMs } = {}) {
  const res = await LLM.chat(config, P.bodyFor(inputs, config), { ...(call ? { call } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  if (res.outcome !== 'ok') return { outcome: res.outcome, line: null, why: `call: ${res.status || res.error || 'no answer'}`, status: res.status, retryAfter: res.retryAfter };
  const reply = P.parseReply(P.contentOf(res.text) || '');
  if (!reply) return { outcome: 'unreadable', line: null, why: 'reply: no line in it', status: 200 };
  // (printed the card's way before it is judged: what is checked is what would be shown)
  // (a full stop the model left off is the card's to add, as it is on a headline: one was refused for that alone on 2026-10-11)
  const tidy = TL.tidyLine(reply.line);
  const line = tidy && !/[.!?]['’"”)]?$/.test(tidy) ? `${tidy}.` : tidy;
  const check = checkLine({ ...inputs, line, claims: reply.claims });
  return check.ok ? { outcome: 'passed', line, why: null, status: 200, check }
    : { outcome: 'failed-check', line, why: `check: ${check.failures.map((f) => `rule ${f.rule}: ${f.why}`).join('; ')}`.slice(0, WHY_MAX), status: 200, check };
}

/** A line as the card prints it: tidied, with the full stop a model left off. */
/**
 * A line with a full name said once: where a person's name (a given name and a surname) stands twice, the later ones are the surname
 * alone ("Kai Cenat ...; Gorgeous Doll apologizes to Cenat"). A model joining two sentences repeats the name each carried; the
 * card says it once. Only a name that opens with a given name: "Gorgeous Doll" is nobody's surname.
 */
function nameOnce(text, subject = '') {
  const s = String(text || '');
  // (the row's own subject is a name whatever the given-name list knows: "Kai Cenat")
  const own = String(subject || '').trim();
  const names = [...new Set((s.match(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’-]+\s+\p{Lu}[\p{L}'’-]+(?![\p{L}\p{N}])/gu) || []))].filter((n) => (W.isFirstName(n.split(/\s+/)[0].toLowerCase()) || n === own) && !W.isDictWord(n.split(/\s+/)[1].toLowerCase()));
  let out = s;
  for (const name of names) {
    const first = out.indexOf(name);
    if (first < 0 || out.indexOf(name, first + name.length) < 0) continue;
    const head = out.slice(0, first + name.length);
    out = head + out.slice(first + name.length).split(name).join(name.split(/\s+/)[1]);
  }
  return out;
}
/** A word's line without its own name said again before what it is: "Stop the Wedding is the trending TikTok audio ..." is "The trending TikTok audio ...". */
function withoutOwnName(text, subject) {
  const src = String(subject || '').trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  if (!src) return text;
  const m = String(text || '').match(new RegExp(`^(?:the\\s+)?${src}\\s+(?:is|are|was)\\s+(an?|the)\\s+(.+)$`, 'i'));
  return m && m[2].split(/\s+/).length >= 6 ? `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : text;
}
function printed(text, subject = '') {
  // (a model's typography is not the card's: its non-breaking hyphens and spaces are plain ones, or "green‑screen" is no word of any source)
  const tidy = nameOnce(TL.tidyLine(String(text || '').replace(/[\u2010\u2011\u2012]/g, '-').replace(/[\u00a0\u202f\u2009]/g, ' ')), subject);
  return tidy && !/[.!?]['’"”)]?$/.test(tidy) ? `${tidy}.` : tidy;
}
/**
 * One request for several items (lib/line-prompt.js `batchBodyFor`): each line is read and checked on its own, so one bad line
 * costs its own row and no other. items: [{ inputs, retry: { line, why } | null }]. Resolves [{ outcome, line, why, status,
 * retryAfter, check }], one per item, in order; a call that was not answered gives every item that outcome.
 */
async function attemptBatch(config, items, { call, timeoutMs } = {}) {
  const res = await LLM.chat(config, P.batchBodyFor(items, config), { ...(call ? { call } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  if (res.outcome !== 'ok') return items.map(() => ({ outcome: res.outcome, line: null, why: `call: ${res.status || res.error || 'no answer'}`, status: res.status, retryAfter: res.retryAfter }));
  const lines = P.parseBatchReply(P.contentOf(res.text) || '');
  return items.map((item, i) => {
    const raw = lines.get(i + 1);
    if (!raw) return { outcome: 'unreadable', line: null, why: 'reply: no line in it', status: 200 };
    const line = item.inputs.kind === 'word' ? printed(withoutOwnName(raw, item.inputs.subject)) : printed(raw, item.inputs.subject);
    const check = checkLine({ ...item.inputs, line, claims: [] });
    return check.ok ? { outcome: 'passed', line, why: null, status: 200, check }
      : { outcome: 'failed-check', line, why: `check: ${check.failures.map((f) => `rule ${f.rule}: ${f.why}`).join('; ')}`.slice(0, WHY_MAX), status: 200, check };
  });
}

/**
 * What a refused line is told on its one second try: each of the check's reasons as something to do, in plain words. The check's own
 * wording names rules and token runs; a model mends "do not use the word X" far more often than "rule 4".
 */
function hintsFor(check, inputs) {
  const noun = String(inputs.title || '').trim().split(/\s+/).pop();
  const out = new Set();
  for (const f of (check && check.failures) || []) {
    const quoted = (f.why.match(/"([^"]+)"/) || [])[1] || null;
    if (f.rule === 1) out.add(f.why);
    else if (f.rule === 2 || f.rule === 3 || f.rule === 4) out.add(`${quoted ? `"${quoted}"` : 'a word'} is in no source sentence: use only the sources' own words`);
    else if (f.rule === 5 && /another story/.test(f.why)) out.add(`${quoted ? `"${quoted}"` : 'a clause'} is not about ${inputs.subject}: leave it out`);
    else if (f.rule === 5) out.add(`${quoted ? `"${quoted}"` : 'a clause'} mixes words of two source sentences: take that clause from ONE sentence, or split it in two clauses joined by a semicolon`);
    else if (f.rule === 6) out.add(`${quoted ? `in "${quoted}" ` : ''}who did what to whom is not as the source has it: keep each person on the side the source gives`);
    else if (f.rule === 7) out.add(`keep the source's "not" or denial${quoted ? ` around "${quoted}"` : ''}`);
    else if (f.rule === 8) out.add(`${quoted ? `"${quoted}"` : 'a claim'} must be told as reported: add "reportedly" or who says so`);
    else if (f.rule === 9) out.add(/does not/.test(f.why) ? `say that ${inputs.subject} denies it` : 'leave the denial out: no source gives one');
    else if (f.rule === 10) out.add('say what happened, not only that there was a reaction');
    else if (f.rule === 11) out.add(`the line must say the "${noun}" itself, of ${inputs.subject}, in a source's own words`);
    else if (f.rule === 12) out.add(`it is out of date: ${f.why}`);
    else out.add(f.why);
  }
  return [...out].slice(0, 4).join('; ').slice(0, WHY_MAX);
}

// ---------- the cache ----------
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };
/** The `lines` table as the writer reads it: the row for these very sources, the newest row of a trend, how many calls a day has seen. */
function cacheOf(db) {
  const exact = db.prepare('SELECT t, line, ok, why, basis FROM lines WHERE trend_id = ? AND source_hash = ?');
  const newest = db.prepare('SELECT t, line, ok, why, basis FROM lines WHERE trend_id = ? ORDER BY t DESC LIMIT 1');
  const since = db.prepare('SELECT COUNT(*) AS n FROM lines WHERE t >= ?');
  const put = db.prepare('INSERT OR REPLACE INTO lines (trend_id, source_hash, t, line, ok, why, basis) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const read = (row) => (row ? { ...row, basis: parse(row.basis) } : null);
  return { exact: (id, hash) => read(exact.get(id, hash)), newest: (id) => read(newest.get(id)), callsSince: (t) => since.get(t).n,
    put: (id, hash, t, line, ok, why, basis) => put.run(id, hash, t, line, ok ? 1 : 0, why, JSON.stringify(basis)) };
}
/** Whether a cached row is an answer about its sources (a line, or a line the check refused): a call that never answered is not. */
const answered = (row) => !!row && (row.ok === 1 || !/^call:/.test(row.why || ''));

/**
 * What to show for one row and whether to ask: { show: the model's line or null, ask: bool, why }.
 * A line is written once per set of sources, and again only when the story changes, never within two hours of the last write; a
 * line written for an earlier state of the story is not shown once the story has changed.
 */
function decide({ exact, newest, basis, t }) {
  if (answered(exact)) return { show: exact.ok === 1 ? exact.line : null, ask: false, why: 'cached' };
  if (!newest) return { show: null, ask: true, why: 'new' };
  // (written by an earlier writer: what was asked then is not what is asked now)
  if (((newest.basis && newest.basis.v) || 1) !== (basis.v || 1)) {
    const kept = newest.ok === 1 && !SRC.storyMoved(newest.basis, basis);
    // (a line the earlier writer got past the check stands while the story has not moved; what it could not write is asked for again)
    return kept ? { show: newest.line, ask: false, why: 'cached' } : { show: null, ask: true, why: 'new' };
  }
  // (a call that never answered, a timeout or a 5xx, says nothing about the row: it is asked again the next slot, not two hours on.
  // The run of 2026-10-11: two of three requests timed out and ten page rows would have waited until the evening)
  if (!SRC.storyChanged(newest.basis, basis)) return { show: newest.ok === 1 ? newest.line : null, ask: !answered(newest) && t - newest.t >= UNANSWERED_AGAIN_SECONDS, why: 'same story' };
  return { show: null, ask: t - newest.t >= REWRITE_AFTER_SECONDS, why: 'story changed' };
}

/**
 * The rows a cycle may write for, each once, in the contract's order: first-page rows whose headline line only says there was a
 * reaction; first-page rows never written for; Early rows; then first-page rows whose story changed.
 * rowsByAudience: { audience: [row] } in the engine's order; isEarly(row): bool. Returns [{ row, page, early, thin }].
 */
function candidates(rowsByAudience, isEarly = () => false) {
  const byId = new Map();
  for (const rows of Object.values(rowsByAudience)) {
    rows.forEach((row, i) => {
      if (!row.id) return;
      const c = byId.get(row.id) || { row, rank: Infinity, page: false, early: false };
      c.rank = Math.min(c.rank, i + 1);
      c.page = c.page || i < PAGE;
      c.early = c.early || !!isEarly(row);
      byId.set(row.id, c);
    });
  }
  return [...byId.values()].map((c) => ({ ...c, thin: !!c.row.line && TN.onlyReaction(c.row.line, keyOf(c.row.subject || '')) })).sort((a, b) => a.rank - b.rank);
}

/** How long the writer stays off after an answer: a day after a refusal; fifteen minutes doubling to six hours, or what Retry-After says, after being turned away. */
function offFor(outcome, strikes, retryAfter) {
  if (outcome === 'refused') return OFF_SECONDS;
  const asked = Number(retryAfter);
  return Math.max(Number.isFinite(asked) && asked > 0 ? asked : 0, Math.min(BACKOFF_MAX_SECONDS, BACKOFF_FIRST_SECONDS * 2 ** Math.min(10, strikes)));
}

/**
 * One cycle's lines. Resolves { lines: Map(trend id -> { line, by: 'model' | 'headline' }), stats }.
 * opts: { db, meta ({ get, set }), t (slot, seconds), rowsByAudience, isEarly, lex, config (LLM.configOf, or null: no calls), call
 *   (the transport), now (() => ms), wait (ms => Promise), log }.
 * Only rows whose line differs from the engine's are in `lines`: every other row keeps its line, written by "headline".
 */
async function writeLines({ db, meta, t, rowsByAudience, isEarly, lex = null, config = null, call, now = Date.now, wait = sleep, log = () => {} }) {
  const cache = cacheOf(db);
  const lines = new Map();
  const casing = new Map();
  const stats = { asked: 0, calls: 0, passed: 0, failedCheck: 0, unanswered: 0, shown: 0, headlinesChanged: 0, off: null };
  const queue = [];
  const fallbacks = [];
  const every = [];
  for (const c of candidates(rowsByAudience, isEarly)) {
    const inputs = SRC.inputsOf(c.row);
    if (!inputs) continue;
    every.push({ ...c, inputs });
    const hash = SRC.sourceHash(inputs);
    const basis = SRC.basisOf(c.row, inputs);
    const d = decide({ exact: cache.exact(c.row.id, hash), newest: cache.newest(c.row.id), basis, t });
    // (a line kept from an earlier cycle is shown only while it still passes the check as the check now is and on the sentences the
    // row now has: a rule learnt since, or a newer headline that says the opposite, takes it down and it is asked for again)
    const stands = d.show ? checkLine({ ...inputs, line: d.show, claims: [] }).ok : false;
    if (d.show && stands) { lines.set(c.row.id, { line: d.show, by: 'model' }); continue; }
    fallbacks.push({ ...c, inputs });
    // (asked once more: the answer, a line or a refusal, replaces the one that no longer stands)
    const reask = !!d.show && !stands;
    if ((d.ask || reask) && (c.page || c.early)) queue.push({ ...c, inputs, hash, basis, first: d.why === 'new' || reask });
  }
  // the contract's order: thin headline lines on the page, new page rows, Early rows, then page rows whose story changed
  const order = (q) => (q.page && q.thin ? 0 : q.page && q.first ? 1 : q.early ? 2 : 3);
  queue.sort((a, b) => order(a) - order(b) || a.rank - b.rank);
  const off = meta.get('llmOff', null);
  if (config && off && off.until > t) stats.off = off.why;
  if (config && !stats.off && queue.length) {
    const started = now();
    const budgetMs = config.budgetMs || BUDGET_MS;
    const callMs = config.timeoutMs || LLM.CALL_TIMEOUT_MS;
    const size = Math.max(1, config.batch || 1);
    // (the day's allowance counts what was asked, not what was answered: a row whose call timed out is asked again every cycle and
    // its cache row only replaced, so by the cache a failing endpoint was never over its cap. Reviewers, 2026-10-12)
    const asked = (meta.get('llmAsked', []) || []).filter((x) => Array.isArray(x) && x[0] > t - DAY);
    const askedToday = asked.reduce((a, x) => a + (x[1] || 0), 0);
    let rowsLeft = Math.max(0, config.daily - Math.max(cache.callsSince(t - DAY), askedToday));
    let unansweredRun = meta.get('llmUnanswered', 0) || 0;
    let callsLeft = config.perCycle;
    const gapMs = Math.ceil(60000 / config.rpm);
    const waiting = [...queue];
    // (a line the check threw away is asked for once more in the same cycle, with what to mend)
    const again = [];
    while (waiting.length || again.length) {
      // (the cycle's time for lines in all: a call's timeout is cut to what is left of it, and none is started with too little left to answer in)
      const remaining = budgetMs - (now() - started) - (stats.calls ? gapMs : 0);
      if (callsLeft <= 0 || rowsLeft <= 0 || remaining < MIN_CALL_MS) break;
      if (stats.calls) await wait(gapMs);
      // (a row on its second try goes first: a page row is mended in the cycle that refused it, and the rows still waiting fill the request)
      const batch = [...again.splice(0, Math.min(size, rowsLeft))];
      while (batch.length < Math.min(size, rowsLeft) && waiting.length) batch.push(waiting.shift());
      const timeoutMs = Math.min(callMs, remaining);
      const results = size > 1 ? await attemptBatch(config, batch, { call, timeoutMs }) : [await attempt(config, batch[0].inputs, { call, timeoutMs })];
      callsLeft -= 1;
      rowsLeft -= batch.length;
      stats.calls += 1;
      asked.push([t, batch.length]);
      meta.set('llmAsked', asked);
      let stop = false;
      // (a call nothing came back from, a timeout or a 5xx: three in a row and the writer stands back as it does when turned away)
      const noAnswer = results.every((r) => !['passed', 'failed-check', 'unreadable', 'refused', 'turned-away'].includes(r.outcome));
      unansweredRun = noAnswer ? unansweredRun + 1 : 0;
      meta.set('llmUnanswered', unansweredRun);
      if (unansweredRun >= UNANSWERED_RUN_MAX) {
        const strikes = off && off.until > t - DAY ? (off.strikes || 0) + 1 : 0;
        meta.set('llmOff', { until: t + offFor('turned-away', strikes, null), why: 'no answer', strikes });
        meta.set('llmUnanswered', 0);
        stats.off = 'no answer';
        stop = true;
      }
      batch.forEach((q, i) => {
        const r = results[i];
        stats.asked += 1;
        cache.put(q.row.id, q.hash, t, r.line, r.outcome === 'passed', r.why, q.basis);
        if (r.outcome === 'passed') { stats.passed += 1; lines.set(q.row.id, { line: r.line, by: 'model' }); meta.set('llmOff', null); return; }
        if (r.outcome === 'failed-check' || r.outcome === 'unreadable') {
          log(`[lines] "${q.row.title}": ${r.line ? `"${r.line}" ` : ''}${r.why}`);
          if (size > 1 && !q.retry && r.outcome === 'failed-check') again.push({ ...q, retry: { line: r.line, why: hintsFor(r.check, q.inputs) } }); else stats.failedCheck += 1;
          return;
        }
        stats.unanswered += 1;
        if (i === 0) log(`[lines] "${q.row.title}": ${r.why}`);
        if ((r.outcome === 'refused' || r.outcome === 'turned-away') && !stop) {
          const strikes = off && off.until > t - DAY ? (off.strikes || 0) + 1 : 0;
          const seconds = offFor(r.outcome, strikes, r.retryAfter);
          meta.set('llmOff', { until: t + seconds, why: r.outcome === 'refused' ? `refused (${r.status})` : `turned away (${r.status})`, strikes });
          stats.off = `${r.outcome} (${r.status})`;
          stop = true;
        }
      });
      if (stop) break;
    }
    // (a row still waiting its second try when the time ran out keeps the refusal it has: counted once)
    stats.failedCheck += again.length;
  }
  // the headline path for every row the model did not write: the engine's line, or the source sentence that says who did what
  for (const c of fallbacks) {
    if (lines.has(c.row.id) || c.inputs.kind === 'word') continue;
    // (composed from all of its own sentences and passed by the claim check: lib/line-compose.js)
    const h = COMPOSE.compose(c.inputs, lex);
    if (h.line && h.line !== c.row.line) { lines.set(c.row.id, { line: h.line, by: 'headline' }); stats.headlinesChanged += 1; if ((h.steps || []).length) stats.composed = (stats.composed || 0) + 1; }
  }
  // (and whoever wrote the line that stands: a title whose noun is someone else's in it is no card. "Nancy Guthrie arrest" over the
  // arrest of a man detained in the search for her says she was arrested; "Pete Hegseth public execution" is Nidal Hasan's. The row
  // is left out: rule 11, read with no headline to excuse it)
  for (const c of every) {
    if (c.inputs.kind === 'word') continue;
    const w = lines.get(c.row.id) || null;
    const line = w ? w.line : c.row.line;
    if (!line) continue;
    const alone = checkLine({ ...c.inputs, line, kind: 'headline', headline: null });
    const theirs = alone.failures.find((f) => f.rule === 11 && NOT_THEIRS.test(f.why));
    if (!theirs) continue;
    // (led by whoever's act it is, when the title names them: "Brandon Rogers NYCC apology", an apology New York Comic Con made, is
    // "NYCC Brandon Rogers apology". Else the row is left out)
    const led = ledByOwner(c.inputs, line);
    if (led) { lines.set(c.row.id, { line, by: w ? w.by : 'headline', title: led, did: 'named by whose act it is' }); stats.retitled = (stats.retitled || 0) + 1; continue; }
    lines.set(c.row.id, { line, by: w ? w.by : 'headline', drop: theirs.why });
    stats.leftOut = (stats.leftOut || 0) + 1;
  }
  // (and every row's line is spelt as its own sources spell it, whoever wrote it and wherever it is listed: a word's and a
  // moment's too, on the page or under "Show more". "JJ watt" and "crystal harris" were lines no writer had touched)
  for (const c of every) {
    const w = lines.get(c.row.id) || null;
    if (w && w.drop) continue;
    const line = w ? w.line : c.row.line;
    // (a story's and a moment's line: a word's line is its page's own sentence and is left as written)
    if (c.inputs.kind === 'word' || c.row.wordish || c.row.type === 'word') continue;
    // (a moment's title is its headline, recased by the same lexicon: "John stamos opens up after viral video")
    const title = c.row.type === 'moment' && !(w && w.title) ? SRC.namesRecased(c.row.title, c.inputs.sources, c.inputs.spelt || []) : null;
    if (title && title !== c.row.title) casing.set(c.row.id, { ...(casing.get(c.row.id) || {}), title });
    if (!line) continue;
    const spelt = SRC.namesRecased(line, c.inputs.sources, c.inputs.spelt || []);
    if (spelt === line) continue;
    if (w) lines.set(c.row.id, { ...w, line: spelt }); else casing.set(c.row.id, { ...(casing.get(c.row.id) || {}), line: spelt });
  }
  stats.shown = [...lines.values()].filter((x) => x.by === 'model').length;
  return { lines, stats, casing };
}

// (only what says whose the act is in so many words: "the noun is someone else's" also reads "FKA Twigs dismisses lawsuit against
// ex Shia LaBeouf" that way, and is a reason to prefer another sentence, never to leave a row out)
const DESK = require('./desk');
const NOT_THEIRS = /is not the subject’s own|only threatened, wished or asked/;
/**
 * A title whose act is someone else's, named by that one when the title already names them between the subject and the noun:
 * "<subject> <owner> <noun>" becomes "<owner> <noun>" ("Brandon Rogers NYCC apology", over an apology New York Comic Con made,
 * is "NYCC apology"). Only when the check then finds the act that name's own, in the line and in its sources; else null.
 */
function ledByOwner(inputs, line) {
  const title = String(inputs.title || '').trim();
  const subject = String(inputs.subject || '').trim();
  if (!subject || !title.toLowerCase().startsWith(`${subject.toLowerCase()} `)) return null;
  const rest = title.slice(subject.length).trim().split(/\s+/);
  if (rest.length < 2) return null;
  const noun = rest[rest.length - 1];
  const owner = rest.slice(0, -1).join(' ');
  // (the title names whose act it is and nobody else: "NYCC apology". With the person still in it, "NYCC Brandon Rogers apology",
  // it read as his apology all the same: reviewers, 2026-10-12. He is still in the line, and the row is still about him)
  const named = `${owner} ${noun}`;
  const again = checkLine({ ...inputs, title: named, subject: owner, person: false, line, kind: 'headline', headline: null });
  return again.failures.some((f) => f.rule === 11 && NOT_THEIRS.test(f.why)) ? null : named;
}
const UNANSWERED_RUN_MAX = 3;
/** The rows with their lines as written: a new row object where the line changed, `lineWrittenBy` on every row. */
function applyLines(rowsByAudience, lines, casing = new Map()) {
  return Object.fromEntries(Object.entries(rowsByAudience).map(([audience, rows]) => [audience, rows.map((row) => {
    let w = row.id ? lines.get(row.id) : null;
    if (w && w.drop) return null;
    // (a moment's line tells its own headline's story, whoever wrote it: an outlet's sentence about something else the same name
    // did that week is no line for it. The desk's own stands, or none)
    if (w && row.type === 'moment' && !DESK.momentTells(row, w.line)) w = null;
    // (spelt: { line, title }, or the line alone: the names of a row no writer touched, as its sources write them)
    const found = row.id ? casing.get(row.id) : null;
    const spelt = typeof found === 'string' ? { line: found } : found || {};
    const titled = spelt.title && row.title ? { title: spelt.title } : {};
    if (w) return { ...row, ...titled, ...(w.title ? { title: w.title, desk: [...(row.desk || []), 'named by whose act it is'] } : {}), line: w.line, lineWrittenBy: w.by };
    return { ...row, ...titled, ...(spelt.line && row.line ? { line: spelt.line } : {}), lineWrittenBy: 'headline' };
  }).filter(Boolean)]));
}

module.exports = { ledByOwner, attempt, attemptBatch, hintsFor, nameOnce, withoutOwnName, printed, writeLines, applyLines, candidates, decide, cacheOf, offFor, PAGE, BUDGET_MS, REWRITE_AFTER_SECONDS, OFF_SECONDS };
