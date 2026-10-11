'use strict';
/*
 * names.json (ios/IDEAS-FEED.md D6): the names a typed follow is suggested from: everyone listed in the last 14 days, then the
 * creators' roster, 60 KB at most. Pure: what was listed is handed in (collect.js keeps it in `meta`), nothing is read or written here.
 */
const D = require('./describe');
const { keyOf, instant, minify, DAY } = require('./util');

const LISTED_DAYS = 14;
const NAMES_BYTES_MAX = 60000;
const NAME_MAX = 80;

/**
 * Who has been listed lately, with this cycle's lists added and anyone unseen for 14 days dropped. listed: { key: { name, role, at } };
 * lists: this cycle's published lists ({ audience: list }); t: this slot. Returns a new object, the newest first.
 */
function listedAfter(listed, lists, t) {
  const next = new Map(Object.entries(listed || {}).filter(([, v]) => v && Number.isFinite(v.at) && t - v.at <= LISTED_DAYS * DAY));
  for (const list of Object.values(lists || {})) {
    for (const item of (list && list.items) || []) {
      for (const p of item.people || []) {
        if (!p || !p.key || !p.name) continue;
        const old = next.get(p.key);
        next.set(p.key, { name: p.name, ...(p.role || (old && old.role) ? { role: p.role || old.role } : {}), at: t });
      }
    }
  }
  return Object.fromEntries([...next.entries()].sort((a, b) => b[1].at - a[1].at || a[0].localeCompare(b[0])));
}

/**
 * The file: { schemaVersion, generatedAt, names: [{ key, name, role? }] }: the listed first (the newest first), then the roster in
 * its own order (each of Wikipedia's lists is most linked first), a key once, cut to `maxBytes`.
 * roster: the engine's Map(key -> { name, desc }).
 */
function namesFile({ listed = {}, roster = null, generatedAt, schemaVersion = 1, maxBytes = NAMES_BYTES_MAX }) {
  const names = [];
  const seen = new Set();
  const add = (name, role) => {
    const key = keyOf(name);
    if (!key || seen.has(key) || String(name).length > NAME_MAX) return;
    seen.add(key);
    names.push({ key, name: String(name), ...(role ? { role } : {}) });
  };
  for (const v of Object.values(listed)) add(v.name, v.role);
  for (const r of roster ? roster.values() : []) add(r.name, D.roleOf(r.name, [], { creator: true, rosterDesc: r.desc || '' }));
  const file = { schemaVersion, generatedAt: instant(generatedAt), names };
  // (the tail goes first: the roster's least linked names)
  let size = Buffer.byteLength(minify(file));
  while (file.names.length && size > maxBytes) { const cut = file.names.pop(); size -= Buffer.byteLength(minify(cut)) + 1; }
  return file;
}

module.exports = { listedAfter, namesFile, LISTED_DAYS, NAMES_BYTES_MAX };
