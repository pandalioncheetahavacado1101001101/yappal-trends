'use strict';
/*
 * The entity graph of one cycle (P14, B2): which other rows of the list a card is related to, and through what. Pure: the roster,
 * the live lookups and the cards are handed in; nothing is read or written here.
 *
 * A card's nodes are what it names itself (a node join counts only when the card names the entity):
 *   person  each of its `people` (the names its own title, line and sources give it), resolved by the roster (lib/entity/resolve.js)
 *   work    its topic (a word, a format, a moment's subject), a sound's song, and a "person" the live lookup found is no human
 *   sound   a sound row's own TikTok sound id
 * A node crosses to another story by QID, or by the same full name (two words or more, or a handle) only where that name is one
 * person: the roster holds exactly one under it, or the live lookup found one human (P14's own mitigation; reviewers 2026-10-20: an
 * ambiguous common name tied an athlete's anniversary to a namesake's shooting charge). On a grave story's side (a crime,
 * violence, a death, an allegation) a person crosses by QID alone, the same QID on both sides; and a name the row gives a private
 * person's role before ("Harbor City man Dale Okafor") is no node at all. A one-word name crosses only by QID, and the roster gives a
 * one-word name a QID only with occupation support from the row: "Brimvale" in a creator story is the creator of that name, and
 * anywhere else joins nothing. Persons join persons, works join works, sounds join sounds: a song named after an actress is never the
 * actress.
 *
 * And one edge that is no node of the card's own: Google Trends' related queries of a card's searches (people who search for it also
 * search for this). A query links to another row when it is that row's own search, or holds the whole name of a person that row names
 * (two words or more; never a name of the card's own) and nothing else but either row's own words.
 *
 * Each card gets at most MAX_RELATED other rows, the strongest edge first (the card's own subject by QID, then any QID, then a full
 * name, a sound, a work, a query), then the higher-listed row. A row whose title only says this card's title again is never one
 * (IDEAS-SUPER P10: "lina suspended" under "Lina Marsh suspension"),
 * nor one no list carries beside this card (a sheet opened from one audience's list cannot open a row only another's carries), nor
 * one that tells the same event (the two lines tell it in the same words, or the two titles name the same thing that happened,
 * "Rook Calder verdict" and "Velmor gunman verdict"): that is a duplicate for the desk to merge, handed back apart
 * (`duplicates`), never a related row.
 */
const { fold, wordsOf, handleLike } = require('./fold');
const RES = require('./resolve');
const I = require('../editor/ideas');
const SF = require('../../engine/story-focus');

const MAX_RELATED = 3;
// two lines that share this much of their words tell one event (the same story listed twice, as two rows)
const SAME_EVENT_SHARE = 0.5;
// (and say at least this many of the same words past the names in them: two lines naming one person share the name and little else)
const SAME_EVENT_WORDS = 2;
// a story of a crime, violence, a death or an allegation: its people cross to another story by QID alone
const ALLEGED = /(?<![\p{L}\p{N}])(?:alleg\w*|accus\w*)(?![\p{L}\p{N}])/iu;
const graveCard = (card) => { const text = `${card.title || ''}\n${card.line || ''}`; return !!I.graveTextOf(text) || ALLEGED.test(text); };
/** Whether the card names `name` straight after a private person's role ("Harbor City man Dale Okafor", engine/story-focus.js). */
function privateRole(card, name) {
  const text = ` ${fold(`${card.title || ''} ${card.line || ''}`)} `;
  const key = fold(name);
  return !!key && SF.PRIVATE_ROLES.some((role) => text.includes(` ${role} ${key} `));
}
const STRENGTH = { subjectQid: 7, qid: 6, name: 5, sound: 4, work: 3, query: 2 };

// ---------- the title rule (P10; the phone's IdeasRelatedChips.restates) ----------
const SMALL = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'with', 'by', 'about', 'and', 'or', 'vs', 'v',
  'is', 'was', 'are', 'were', 'be', 'been', 'today', 'now', 'news', 'latest', 'update', 'updates']);
// (and the words a list puts after a thing's name: "Velmor dance meme" says nothing "Velmor dance" does not)
const FRAMING = new Set(['trend', 'trends', 'meme', 'memes', 'challenge', 'format', 'sound', 'audio', 'viral', 'video', 'videos', 'clip', 'clips', 'meaning', 'means', 'mean']);
const isSmall = (w) => SMALL.has(w) || (/^\d{4}$/.test(w) && Number(w) >= 1900 && Number(w) <= 2099);
/** A word a title may add without saying anything new: a small word, or a list's framing word. */
const isFiller = (w) => isSmall(w) || FRAMING.has(w);
/** A word without its commonest ending, then without a doubled last consonant ("banned" and "ban" are "ban"). */
function stem(word) {
  const ending = ['ings', 'ing', 'ions', 'ion', 'ed', 's'].find((e) => word.endsWith(e) && word.length - e.length >= 3);
  const cut = ending ? word.slice(0, -ending.length) : word;
  const last = cut[cut.length - 1];
  return cut.length >= 3 && cut[cut.length - 2] === last && !'aeiou'.includes(last) ? cut.slice(0, -1) : cut;
}
/** Two forms of one word: "ban" and "banned", "suspended" and "suspension". */
function sameWord(a, b) {
  if (a === b) return true;
  const [x, y] = [stem(a), stem(b)];
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  if (shorter < 5) return false;
  let i = 0;
  while (i < shorter && x[i] === y[i]) i += 1;
  return i >= shorter - 1;
}
/** Whether a text says nothing but the title: every word of it, the small and framing ones aside, is one of the title's. */
function restates(text, title) {
  const t = wordsOf(title);
  const ws = wordsOf(text).filter((w) => !isFiller(w));
  return ws.every((w) => t.some((x) => sameWord(w, x)));
}

// ---------- nodes ----------
/** A name that may cross by itself: two words or more, or a handle. */
const crossable = (name) => wordsOf(name).length >= 2 || handleLike(name);

/**
 * A card's nodes: [{ kind, qid, name (folded, or null when the name may not cross by itself: one word, more than one person under it,
 * nobody known under it yet, or a grave story's), key (the folded full name, for the live lookups), via, subject, absent (a full name
 * the roster does not hold and no lookup has answered yet) }].
 * card: { title, line, tier, people: [{ name, role }], topic: { name } | null, sound: { id, song, artist } | null }.
 * opts: { roster, looked: (folded name) => { qid, human } | null (the live lookups held, lib/entity/lookup.js) }.
 */
function nodesOf(card, { roster = null, looked = () => null } = {}) {
  const out = [];
  const grave = graveCard(card);
  const ctx = (role) => ({ role: role || null, tier: card.tier || null, title: card.title || '', line: card.line || '' });
  (card.people || []).forEach((p, i) => {
    if (!p || !p.name || !fold(p.name)) return;
    // (a private person, named after a role: no node, never crossed, never kept)
    if (privateRole(card, p.name)) return;
    const r = RES.resolve(roster, p.name, ctx(p.role));
    const key = crossable(p.name) ? fold(p.name) : null;
    // (a name the roster does not hold: what the live lookup found for it, a full name only. No human under the name: a thing)
    const live = !r.qid && r.why === 'absent' && key ? looked(key) : null;
    if (live && live.qid && live.human === false) { out.push({ kind: 'work', qid: live.qid, name: key, key, via: p.name, subject: i === 0 }); return; }
    const human = !!(live && live.qid && live.human);
    const qid = r.qid || (human ? live.qid : null);
    // (the bare name crosses only where it is one person, and never from a grave story)
    const name = key && (r.n === 1 || human) && !grave ? key : null;
    // (absent: a name for the live lookup to ask about, until it has an answer; it crosses nothing meanwhile)
    const absent = r.why === 'absent' && !!key && !live;
    if (!qid && !name && !absent) return;
    out.push({ kind: 'person', qid, name, key, via: p.name, subject: i === 0, ...(absent ? { absent: true } : {}) });
  });
  if (card.topic && card.topic.name && crossable(card.topic.name)) out.push({ kind: 'work', qid: null, name: fold(card.topic.name), key: fold(card.topic.name), via: card.topic.name, subject: !out.length });
  if (card.sound) {
    if (card.sound.id) out.push({ kind: 'sound', qid: null, name: `sound ${card.sound.id}`, key: `sound ${card.sound.id}`, via: card.sound.song || card.title, subject: true });
    if (card.sound.song && crossable(card.sound.song) && !(card.topic && fold(card.topic.name) === fold(card.sound.song))) out.push({ kind: 'work', qid: null, name: fold(card.sound.song), key: fold(card.sound.song), via: card.sound.song, subject: false });
    if (card.sound.artist) {
      // (whoever a sound is by is a musician: the one-word artist resolves with that support, or crosses nothing; a full name crosses
      // by itself only where the roster holds one person under it)
      const r = RES.resolve(roster, card.sound.artist, { role: 'musician', title: card.title, line: card.line || '' });
      const key = crossable(card.sound.artist) ? fold(card.sound.artist) : null;
      const name = key && r.n === 1 && !grave ? key : null;
      if (r.qid || name) out.push({ kind: 'person', qid: r.qid, name, key, via: card.sound.artist, subject: false });
    }
  }
  // (one node a key: the same person named twice is one node)
  const seen = new Set();
  return out.filter((n) => { const k = `${n.kind}|${n.qid || ''}|${n.name || n.key || ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Whether two nodes are one entity: the same QID, or the same crossable name and no two different QIDs. Kinds never mix. */
function joins(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.qid && b.qid) return a.qid === b.qid;
  return !!a.name && a.name === b.name;
}
/** How strong a join is (STRENGTH): the card's own subject by QID first. */
function strengthOf(a, b) {
  if (a.kind === 'sound') return STRENGTH.sound;
  if (a.kind === 'work') return STRENGTH.work;
  if (a.qid && b.qid) return a.subject ? STRENGTH.subjectQid : STRENGTH.qid;
  return STRENGTH.name;
}

// the words after a name that make it someone else's ("theo brandt jr" is not Theo Brandt)
const SUFFIXES = new Set(['jr', 'sr', 'junior', 'senior', 'ii', 'iii', 'iv']);
/** Where `phrase` (folded words) stands in `words`, side by side and in order, not followed by a suffix: its index, or -1. */
function phraseAt(words, phrase) {
  if (!phrase.length || phrase.length > words.length) return -1;
  for (let i = 0; i + phrase.length <= words.length; i++) {
    if (phrase.every((w, k) => words[i + k] === w) && !SUFFIXES.has(words[i + phrase.length])) return i;
  }
  return -1;
}
/**
 * The query edge from card a to card b: a related query of a's that is b's own search and says a word of b's title a's title does not,
 * or that holds the whole name of a person b names (two words or more, never a name of a's own) and says nothing else but a's title's
 * words or b's title's, line's and tags'
 * (the phone's rule for a search that names another row: "mara quill commercial" under "Lina Marsh feud" is not about the row
 * "Mara Quill split", it is about something else she did). { via } or null.
 */
function queryEdge(a, b, nodesA, nodesB) {
  const own = new Set(nodesA.map((n) => n.key || n.name).filter(Boolean));
  const searches = new Set((b.searches || []).map(fold).filter((k) => k.split(' ').length >= 2));
  const names = nodesB.filter((n) => n.kind === 'person' && n.name && n.name.includes(' ') && !own.has(n.name));
  if (!searches.size && !names.length) return null;
  const known = [a.title, b.title, b.line || '', ...(b.tags || [])].flatMap(wordsOf);
  // (a search of the other row's says a word of its title this card's title does not: "bbc strictly" is the show's, not one story's)
  const titleA = wordsOf(a.title);
  const titleB = wordsOf(b.title).filter((w) => !isFiller(w) && !titleA.some((x) => sameWord(w, x)));
  for (const q of a.queries || []) {
    const k = fold(q);
    if (!k || own.has(k)) continue;
    // (via: who or what the other row is about, never the query's own words: a search may name someone no card prints)
    if (searches.has(k) && k.split(' ').some((w) => titleB.some((x) => sameWord(w, x)))) return { via: (nodesB.find((n) => n.subject) || nodesB[0] || { via: b.title }).via };
    const ws = k.split(' ');
    for (const n of names) {
      const name = n.name.split(' ');
      const at = phraseAt(ws, name);
      if (at < 0) continue;
      const rest = [...ws.slice(0, at), ...ws.slice(at + name.length)].filter((w) => !isSmall(w));
      if (rest.every((w) => known.some((x) => sameWord(w, x)))) return { via: n.via };
    }
  }
  return null;
}

/** Whether two lists carry the two cards side by side: one audience at least lists both (a card with no audiences is every list's). */
const sideBySide = (a, b) => !a.audiences || !b.audiences || [...a.audiences].some((x) => b.audiences.has(x));
/**
 * Whether two joined cards tell one event (a duplicate, not a related row): their lines share SAME_EVENT_SHARE of their words ("Velma
 * Orrin accidentally exposes herself in hotel window reflection ..." and "... Velma Orrin accidentally exposes herself while sharing
 * ... photo"), or their titles name the same thing that happened past the names they carry ("Rook Calder verdict", "Velmor
 * gunman verdict"). A sound's or a word's line is a format's boilerplate: only titles are read for those. via: the name they share.
 */
function sameEvent(a, b, via) {
  if (a.kind === 'sound' || b.kind === 'sound') return false;
  const words = () => { const fb = I.factOf(b.line); return [...I.factOf(a.line)].filter((x) => fb.has(x)).length; };
  const told = a.kind !== 'word' && b.kind !== 'word' && !!a.line && !!b.line && Math.max(I.toldShare(a.line, [b.line]), I.toldShare(b.line, [a.line])) >= SAME_EVENT_SHARE && words() >= SAME_EVENT_WORDS;
  if (told) return true;
  const named = new Set([...wordsOf(via || ''), ...(a.people || []).flatMap((p) => wordsOf(p.name || '')), ...(b.people || []).flatMap((p) => wordsOf(p.name || ''))]);
  const own = (title) => wordsOf(title).filter((w) => !isFiller(w) && !named.has(w));
  const tb = own(b.title);
  return own(a.title).some((w) => tb.some((x) => sameWord(w, x)));
}
/**
 * Every card's related rows: Map(id -> [{ id, title, via, kind }]), MAX_RELATED at most, the strongest first, then the row more lists
 * carry (a detail is every audience's), then the higher row; only rows some list carries beside the card, and never one that tells
 * the same event (those are `duplicates`: [[id, id]], each pair once). cards: [{ id, title, line, kind, tier, people, topic, sound,
 * tags, searches, queries, rank, lists, audiences }]. Also returns the nodes, for the chapters.
 */
function relate(cards, { roster = null, looked = () => null, max = MAX_RELATED } = {}) {
  const nodes = new Map(cards.map((c) => [c.id, nodesOf(c, { roster, looked })]));
  // (by node, the cards that carry it: a QID or a name may cross, nothing else is indexed)
  const byKey = new Map();
  for (const c of cards) {
    for (const n of nodes.get(c.id)) {
      for (const k of [n.qid ? `${n.kind}|q|${n.qid}` : null, n.name ? `${n.kind}|n|${n.name}` : null].filter(Boolean)) {
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(c);
      }
    }
  }
  const related = new Map();
  const duplicates = new Map();
  for (const a of cards) {
    const best = new Map();
    const offer = (b, strength, via, kind) => {
      if (b.id === a.id) return;
      const had = best.get(b.id);
      if (!had || strength > had.strength) best.set(b.id, { b, strength, via, kind });
    };
    for (const na of nodes.get(a.id)) {
      const keys = [na.qid ? `${na.kind}|q|${na.qid}` : null, na.name ? `${na.kind}|n|${na.name}` : null].filter(Boolean);
      for (const b of new Set(keys.flatMap((k) => byKey.get(k) || []))) {
        const nb = nodes.get(b.id).find((x) => joins(na, x));
        if (nb) offer(b, strengthOf(na, nb), na.via, na.kind);
      }
    }
    if ((a.queries || []).length) {
      for (const b of cards) {
        if (b.id === a.id || (best.get(b.id) && best.get(b.id).strength >= STRENGTH.query)) continue;
        const e = queryEdge(a, b, nodes.get(a.id), nodes.get(b.id));
        if (e) offer(b, STRENGTH.query, e.via, 'query');
      }
    }
    const list = [...best.values()]
      .filter((x) => x.b.title && !restates(x.b.title, a.title) && fold(x.b.title) !== fold(a.title) && sideBySide(a, x.b))
      .filter((x) => { if (!sameEvent(a, x.b, x.via)) return true; const pair = [a.id, x.b.id].sort(); duplicates.set(pair.join('|'), pair); return false; })
      .sort((x, y) => y.strength - x.strength || (y.b.lists || 0) - (x.b.lists || 0) || (x.b.rank ?? Infinity) - (y.b.rank ?? Infinity) || (x.b.id < y.b.id ? -1 : 1))
      .slice(0, max)
      .map((x) => ({ id: x.b.id, title: x.b.title, via: x.via, kind: x.kind }));
    if (list.length) related.set(a.id, list);
  }
  return { related, nodes, duplicates: [...duplicates.values()] };
}

module.exports = { relate, nodesOf, joins, queryEdge, sameEvent, sideBySide, graveCard, privateRole, phraseAt, restates, sameWord, stem, crossable, MAX_RELATED, STRENGTH };
