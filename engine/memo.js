'use strict';
/*
 * Memos for the engine's pure steps, one scope a build (engine/build.js): a step asked again, in the same build, with arguments of the
 * same content returns what it returned the first time. The five audiences' lists ask the same questions of the same headlines (a
 * name's line is the same whoever the list is for), and a build used to answer each one five times over.
 *
 * Safe by construction:
 *  - the key is a hash of every argument's whole content (JSON with Maps, Sets, RegExps, undefined, NaN and -0 told apart);
 *    functions, and the objects the build declares read-only for its length (`readOnly`: the lexicon, the lookups), by identity;
 *  - an argument that is no plain value (a class instance, a typed array, a symbol) makes the call a plain call, never cached (JSON
 *    reads no property that is not enumerable: the engine's values are plain data);
 *  - the first caller gets the step's own result; every later one its own copy of it (structuredClone, or the step's own `copy`),
 *    so no caller can change what another reads; a result that does not copy is never cached;
 *  - outside a scope nothing is cached: a test or a script calling a step directly gets a plain call.
 * IDEAS_MEMO_CHECK=1 checks it all on a real build: every hit is computed again and compared, every call's arguments are keyed again
 * after it (a step that changes its own arguments is not pure), and every read-only object is hashed again when the scope closes.
 * Any difference throws. `checking(true)` turns the same checks on in-process (the tests).
 */
const crypto = require('node:crypto');

let checkOn = process.env.IDEAS_MEMO_CHECK === '1';
const UNCACHEABLE = Symbol('uncacheable');
let scope = null;
let last = {};

/** One scope: { caches, ids (object -> number), readOnly, sealed (with the checks: object -> hash), stats, check }. */
const newScope = () => ({ caches: new Map(), ids: new WeakMap(), nextId: 1, readOnly: new Set(), sealed: new Map(), stats: new Map(), check: checkOn });
const idOf = (s, o) => { let id = s.ids.get(o); if (id === undefined) { id = s.nextId++; s.ids.set(o, id); } return id; };

/** JSON of a value's whole content; read-only objects and functions by identity. Throws UNCACHEABLE on anything else. */
function contentOf(s, value, { identity = true } = {}) {
  return JSON.stringify(value, function (k, v) {
    // (the value as it stands, before any toJSON of its own: a Date is no string, a class instance with toJSON no plain value)
    const raw = this[k];
    if (raw instanceof Date) return `\u0000d${raw.getTime()}`;
    if (raw !== null && typeof raw === 'object' && raw !== v) throw UNCACHEABLE;
    if (v === undefined) return '\u0000u';
    if (typeof v === 'number') return Number.isNaN(v) ? '\u0000nan' : Object.is(v, -0) ? '\u0000-0' : !Number.isFinite(v) ? `\u0000${v}` : v;
    if (typeof v === 'string') return v.charCodeAt(0) === 0 ? `\u0000s${v}` : v;
    if (typeof v === 'bigint') return `\u0000n${v}`;
    if (typeof v === 'function') return `\u0000f${idOf(s, v)}`;
    if (typeof v === 'symbol') throw UNCACHEABLE;
    if (v === null || typeof v !== 'object') return v;
    if (identity && s.readOnly.has(v)) return `\u0000o${idOf(s, v)}`;
    if (v instanceof Map) return { '\u0000map': [...v] };
    if (v instanceof Set) return { '\u0000set': [...v] };
    if (v instanceof RegExp) return `\u0000r${v.source}/${v.flags}/${v.lastIndex}`;
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) throw UNCACHEABLE;
    return v;
  });
}
const hashOf = (text) => crypto.createHash('sha256').update(text).digest('base64');

/** The cache of `name` in the open scope, the key of `args` in it (null: a call never cached), and its count. */
function slot(s, name, args) {
  let key;
  try { key = hashOf(contentOf(s, args)); } catch (e) { if (e === UNCACHEABLE) return null; throw e; }
  let cache = s.caches.get(name);
  if (!cache) { cache = new Map(); s.caches.set(name, cache); }
  let st = s.stats.get(name);
  if (!st) { st = { calls: 0, hits: 0 }; s.stats.set(name, st); }
  st.calls++;
  return { cache, key, st };
}

/**
 * The step `fn` with a memo: the same function while no scope is open; inside one, asked again with arguments of the same content,
 * a copy of its first answer. `name` names its cache (and its line in `stats`). `copy`: how to copy an answer, for one that holds
 * what structuredClone cannot (a noun family with its function: nounOf); it must give a value no caller can change another's through.
 */
function memo(name, fn, { copy = structuredClone } = {}) {
  return function memoized(...args) {
    const s = scope;
    const at = s && slot(s, name, args);
    if (!at) return fn.apply(this, args);
    if (at.cache.has(at.key)) {
      at.st.hits++;
      const kept = at.cache.get(at.key);
      if (s.check) {
        const again = fn.apply(this, args);
        if (contentOf(s, again, { identity: false }) !== contentOf(s, kept, { identity: false })) throw new Error(`memo ${name}: a hit differs from the step's own answer`);
        if (hashOf(contentOf(s, args)) !== at.key) throw new Error(`memo ${name}: the step changed its arguments`);
      }
      return copy(kept);
    }
    const out = fn.apply(this, args);
    if (s.check && hashOf(contentOf(s, args)) !== at.key) throw new Error(`memo ${name}: the step changed its arguments`);
    let kept;
    try { kept = copy(out); } catch { return out; }
    at.cache.set(at.key, kept);
    return out;
  };
}

/**
 * A step whose result every caller in the scope shares, read-only (the audiences' lists read one copy of the window's items): asked
 * again with arguments of the same content, the very object it gave first, declared read-only (so it is keyed by identity after, and
 * with IDEAS_MEMO_CHECK=1 checked unchanged when the scope closes). Outside a scope, a plain call.
 */
function once(name, fn) {
  return function shared(...args) {
    const at = scope && slot(scope, name, args);
    if (!at) return fn.apply(this, args);
    if (at.cache.has(at.key)) { at.st.hits++; return at.cache.get(at.key); }
    const out = fn.apply(this, args);
    at.cache.set(at.key, out);
    readOnly(out);
    return out;
  };
}

/** Declares objects read-only for the rest of the open scope: keyed by identity (with IDEAS_MEMO_CHECK=1, checked when it closes). */
function readOnly(...objects) {
  const s = scope;
  if (!s) return;
  for (const o of objects) {
    if (!o || typeof o !== 'object' || s.readOnly.has(o)) continue;
    if (s.check) s.sealed.set(o, hashOf(contentOf(s, o, { identity: false })));
    s.readOnly.add(o);
  }
}

/** Runs fn() in a scope of its own (one build): the caches live as long as it does. A scope already open is joined. */
function within(fn) {
  if (scope) return fn();
  scope = newScope();
  const s = scope;
  try { return fn(); } finally { close(s); }
}
function close(s) {
  if (scope === s) scope = null;
  if (s.check) for (const [o, h] of s.sealed) if (hashOf(contentOf(s, o, { identity: false })) !== h) throw new Error('memo: an object declared read-only changed during the build');
  last = Object.fromEntries(s.stats);
}
/** The last closed scope's { [name]: { calls, hits } }. */
const stats = () => last;

/** Turns the checks of IDEAS_MEMO_CHECK=1 on or off for the scopes opened after. */
const checking = (on) => { checkOn = !!on; };

module.exports = { memo, once, readOnly, within, stats, checking };
