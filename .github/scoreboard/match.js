'use strict';
/*
 * The scoreboard's frozen matcher (scoreboard-spec.json "matcher"): pairs a comparator's entry with one of our trends.
 *
 * Pure: no clock, no file, no network, and none of the collector's own code, so a change to the collector's entity graph never moves
 * a scoreboard number. Every threshold comes from the spec. In order:
 *   alias    the entry's whole title, folded, equals one of the trend's titles or alias keys, folded
 *   person   only for person trends: the entry's whole title is the name of a person the row names, the row's own title is that name
 *            and at most maxExtraWords more ("Velma Orrin divorce", never a headline that opens with a name), and the name has two
 *            words or more or is a handle (a one-word name like "Brimvale" never joins on its own; "Zap2Zork" may)
 *   jaccard  the title cores (folded words, less stopwords and our own framing words, singular) overlap by jaccardMin or more
 *   bare name  whatever the step, a join whose entry is, by its title core, only the name of a person the row names (or its subject)
 *            holds only when corroborated: the entry's related searches share a word, tag or other person with the row, or the entry
 *            surfaced between 24 h before and 48 h after our first listing (a name trends for many reasons: "velma orrin" on the day
 *            of her new film is not our row about her split; nor are "velma orrin now" or "where is velma orrin from", whose other
 *            words are stopwords or framing)
 *   long lead  a join whose entry surfaced more than 48 h after our first listing, on a comparator that gives related searches,
 *            holds only when those searches corroborate it as above (the longest leads are where a wrong join would count most)
 * A comparator matches only the kinds the spec gives it: a chart of sounds matches our sounds, nothing else matches a sound (the
 * sound "Velma Orrin by Quorra" is never the actress).
 */

const RANK = { alias: 3, person: 2, jaccard: 1 };

/** Lower case, accents off, "&" as "and", possessives and apostrophes off, anything else not a letter or digit a space. */
function fold(text) {
  let s = String(text || '');
  // (a hashtag's words: "#VelmorGrandGala" is "velmor grand gala")
  if (/^#/.test(s.trim())) s = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/&/g, ' and ').replace(/['’](s)\b/g, '').replace(/['’`]/g, '');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** One word in its frozen singular: "shootings" is "shooting", "velmors" "velmor"; "boss", "status" and "crisis" stay. */
function singular(word, m) {
  if (word.length < m.singularise.minChars || !word.endsWith('s')) return word;
  if (m.singularise.keepEndings.some((e) => word.endsWith(e))) return word;
  return word.slice(0, -1);
}

/** The words that carry a title: folded, singular, less stopwords, framing words and one-letter words (a digit stays). */
function coreOf(text, m) {
  const stop = m._stop || new Set(m.stopwords);
  const framing = m._framing || new Set(m.framing);
  const out = new Set();
  for (const raw of fold(text).split(' ')) {
    if (!raw || stop.has(raw) || framing.has(raw)) continue;
    if (raw.length < m.minTokenChars && !/^\d+$/.test(raw)) continue;
    const w = singular(raw, m);
    if (!framing.has(w)) out.add(w);
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** "Song by Artist" as its two parts (the last " by " divides them). */
function soundParts(title, m) {
  const s = String(title || '').replace(/\s+/g, ' ').trim();
  const at = s.toLowerCase().lastIndexOf(m.sound.split);
  return at > 0 ? { song: s.slice(0, at).trim(), artist: s.slice(at + m.sound.split.length).trim() } : { song: s, artist: null };
}

/** An alias key without its kind prefix, as words: "talk|velma orrin|feud" is "velma orrin feud". */
function aliasText(key, m) {
  let s = String(key || '');
  for (const p of m.aliasPrefixes) if (s.startsWith(p)) { s = s.slice(p.length); break; }
  return s.replace(/\|/g, ' ');
}

/** A person's name the person rule may join on: two words or more, or a handle (one word of 6+ characters with a digit or an inner capital). */
function joinableName(name, m) {
  const words = fold(name).split(' ').filter(Boolean);
  if (words.length >= m.person.minTokens) return true;
  const raw = String(name || '').trim();
  return words.length === 1 && raw.length >= m.person.handle.minChars && (/\d/.test(raw) || /[a-z][A-Z]/.test(raw));
}

const prepared = (m) => (m._stop ? m : { ...m, _stop: new Set(m.stopwords), _framing: new Set(m.framing) });

/**
 * Our side, ready to match. trends: [{ id, kind, sub, titles: [string], aliases: [string], people: [{ name }], tags: [string],
 * subject (string or null), listed (epoch s or null) }]. Returns an index; nothing in it is ever written anywhere.
 */
function prepareOurs(trends, spec) {
  const m = prepared(spec.matcher);
  const rows = [];
  const byToken = new Map();
  for (const tr of trends) {
    const texts = [...new Set([...(tr.titles || []), ...(tr.aliases || []).map((a) => aliasText(a, m))].filter(Boolean))];
    const wholes = new Set(texts.map(fold).filter(Boolean));
    const isSound = tr.kind === 'sound';
    const cores = isSound ? [] : texts.map((t) => coreOf(t, m)).filter((c) => c.size);
    const sounds = isSound ? texts.map((t) => soundParts(t, m)).map((p) => ({ song: coreOf(p.song, m), artist: p.artist ? coreOf(p.artist, m) : null })).filter((p) => p.song.size) : [];
    const persons = new Set();
    if (m.person.kinds.includes(tr.kind)) {
      const first = (tr.titles || [])[0] || '';
      const title = fold(first);
      for (const p of tr.people || []) {
        const name = fold(p && p.name);
        if (!name || !joinableName(p.name, m) || !(title === name || title.startsWith(`${name} `))) continue;
        // (the row is about the person: its title is the name and at most a couple of words, "Velma Orrin divorce", never a headline)
        if (coreOf(title.slice(name.length), m).size <= m.person.maxExtraWords) persons.add(name);
      }
    }
    // (the names a bare-name join must be corroborated on, whole and as title cores, and the row's words that may corroborate one)
    const names = new Set([...(tr.people || []).map((p) => fold(p && p.name)), fold(tr.subject)].filter(Boolean));
    const nameCores = [...names].map((n) => coreOf(n, m)).filter((c) => c.size);
    const words = new Set([...texts, ...(tr.tags || []), ...(tr.people || []).map((p) => p && p.name)].flatMap((t) => [...coreOf(t, m)]));
    const row = { id: tr.id, kind: tr.kind, listed: Number.isFinite(tr.listed) ? tr.listed : null, wholes, cores, sounds, persons, names, nameCores, words };
    const i = rows.push(row) - 1;
    const tokens = new Set([...cores.flatMap((c) => [...c]), ...sounds.flatMap((s) => [...s.song])]);
    for (const w of tokens) { if (!byToken.has(w)) byToken.set(w, []); byToken.get(w).push(i); }
  }
  const byWhole = new Map();
  rows.forEach((r, i) => { for (const w of r.wholes) { if (!byWhole.has(w)) byWhole.set(w, []); byWhole.get(w).push(i); } });
  const byPerson = new Map();
  rows.forEach((r, i) => { for (const p of r.persons) { if (!byPerson.has(p)) byPerson.set(p, []); byPerson.get(p).push(i); } });
  return { m, rows, byToken, byWhole, byPerson };
}

function kindAllowed(kind, rule) {
  if (!rule) return true;
  if (rule.only) return rule.only.includes(kind);
  if (rule.not) return !rule.not.includes(kind);
  return true;
}

/** Better first: the stronger step, the higher score, the earlier listing, the smaller id (frozen and total). */
function better(a, b) {
  if (!b) return true;
  if (RANK[a.how] !== RANK[b.how]) return RANK[a.how] > RANK[b.how];
  if (a.score !== b.score) return a.score > b.score;
  const la = a.listed ?? Infinity;
  const lb = b.listed ?? Infinity;
  if (la !== lb) return la < lb;
  return a.id < b.id;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((w) => b.has(w));

/** Whether the entry is only the name of a person the row names (or its subject): the same folded title, or the same title core. */
const isBareName = (row, whole, core) => row.names.has(whole) || (core.size > 0 && row.nameCores.some((c) => sameSet(c, core)));

/** Related searches that corroborate a join: one shares a title-core word, tag or person's word with the row, beyond the entry's own words. */
function relatedCorroborates(row, core, entry, m) {
  for (const q of entry.related || []) for (const w of coreOf(q, m)) if (!core.has(w) && row.words.has(w)) return true;
  return false;
}

/** A bare-name join's corroboration: related searches that share a word with the row, or a surface near our first listing. */
function corroborated(row, whole, entry, m) {
  const rule = m.bareName;
  if (relatedCorroborates(row, coreOf(whole, m), entry, m)) return true;
  const t = Number.isFinite(entry.t) ? entry.t : null;
  return t !== null && row.listed !== null && t >= row.listed - rule.hoursBeforeListing * 3600 && t <= row.listed + rule.hoursAfterListing * 3600;
}

/** A long lead (the entry surfaced more than hoursAfterListing after our first listing, on a comparator that gives related searches): those must corroborate it. */
function longLeadHolds(row, core, entry, comparator, m) {
  const rule = m.bareName.longLead;
  if (!rule.comparators.includes(comparator) || !Number.isFinite(entry.t) || row.listed === null) return true;
  if (entry.t - row.listed <= m.bareName.hoursAfterListing * 3600) return true;
  return relatedCorroborates(row, core, entry, m);
}

/**
 * The best of our trends for one entry of comparator `comparator`, or null. entry: { title, artist (a sound's, optional), related
 * (its related searches, optional), t (when it surfaced, epoch s, optional) }. Returns { id, how, score }.
 */
function matchEntry(entry, comparator, index) {
  const { m, rows, byToken, byWhole, byPerson } = index;
  const rule = m.kinds[comparator];
  const isSound = comparator === 'viral50';
  const whole = fold(isSound && entry.artist ? `${entry.title}${m.sound.split}${entry.artist}` : entry.title);
  const wholeCore = coreOf(whole, m);
  let best = null;
  const consider = (i, how, score) => {
    const r = rows[i];
    if (!kindAllowed(r.kind, rule)) return;
    if (isBareName(r, whole, wholeCore) && !corroborated(r, whole, entry, m)) return;
    if (!longLeadHolds(r, wholeCore, entry, comparator, m)) return;
    const cand = { id: r.id, how, score: Math.round(score * 1000) / 1000, listed: r.listed };
    if (better(cand, best)) best = cand;
  };
  for (const i of byWhole.get(whole) || []) consider(i, 'alias', 1);
  if (isSound) {
    const song = coreOf(entry.title, m);
    const artist = entry.artist ? coreOf(entry.artist, m) : null;
    const seen = new Set();
    for (const w of song) for (const i of byToken.get(w) || []) {
      if (seen.has(i)) continue;
      seen.add(i);
      for (const s of rows[i].sounds) {
        const j = jaccard(song, s.song);
        if (j < m.jaccardMin) continue;
        if (m.sound.artistMustOverlap && artist && artist.size && s.artist && s.artist.size && jaccard(artist, s.artist) === 0) continue;
        consider(i, 'jaccard', j);
      }
    }
  } else {
    for (const i of byPerson.get(whole) || []) consider(i, 'person', 1);
    const core = coreOf(entry.title, m);
    const seen = new Set();
    for (const w of core) for (const i of byToken.get(w) || []) {
      if (seen.has(i)) continue;
      seen.add(i);
      let top = 0;
      for (const c of rows[i].cores) top = Math.max(top, jaccard(core, c));
      if (top >= m.jaccardMin) consider(i, 'jaccard', top);
    }
  }
  return best ? { id: best.id, how: best.how, score: best.score } : null;
}

/** Every entry's best match: [{ key, id, how, score }] for the entries that matched, in the entries' order. */
function matchAll(entries, comparator, index) {
  const out = [];
  for (const e of entries) {
    const hit = matchEntry(e, comparator, index);
    if (hit) out.push({ key: e.key, ...hit });
  }
  return out;
}

/** One of our rows as the matcher sees it for a duplicate check: its folded title, its title core (a sound's song's), whether a sound. */
function storyOf(row, m) {
  const sound = row.kind === 'sound';
  return { whole: fold(row.title), core: coreOf(sound ? soundParts(row.title, m).song : row.title, m), sound };
}

/** Whether two of our rows are one story to the matcher: the same title folded, or (both sounds or neither) title cores overlapping by jaccardMin. */
function sameStory(a, b, m) {
  const x = a.whole !== undefined ? a : storyOf(a, m);
  const y = b.whole !== undefined ? b : storyOf(b, m);
  return x.whole === y.whole || (x.sound === y.sound && x.core.size > 0 && jaccard(x.core, y.core) >= m.jaccardMin);
}

module.exports = { fold, coreOf, jaccard, soundParts, aliasText, joinableName, isBareName, corroborated, longLeadHolds, storyOf, sameStory, prepareOurs, matchEntry, matchAll };
