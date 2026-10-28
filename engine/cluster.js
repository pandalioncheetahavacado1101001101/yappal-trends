'use strict';
/*
 * Steps 3-4 of the Ideas pipeline: names and pseudo-names per item, then union-find clustering into stories.
 * Two items are one story when they share a title, a name plus a distinctive word, a quoted phrase or role noun
 * ("multitasking mom") in the same place, a quoted catchphrase, or (nameless) two rare story words. Plain string/regex/set
 * arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const { sum, median, contains, uniqByKey } = require('./util');

const { words, stem, uniq, STOP, GENERIC } = W;
const DAY = 86400000;
const LINK_MAX_DAYS = 5;
const LINK_MAX_DAYS_TWO_NAMES = 12; // "Plonker ... Tavix Ostiss" stays one saga across a week and a half
const PSEUDO_LINK_DAYS = 3;
const TOKEN_IDF_MIN = 3.2;
const COMMON_ENTITY_DF = 12; // a name in this many items (Esselle Quillith, Neskova) needs more shared words to link
const ROLE_PREFIX = /^(?:(?:former|then|us|u\.s\.|vice|first)\s+)*(?:president|presidential|star|singer|host|rapper|actor|actress|senator|governor|pop star|superstar|comedian|lady)\s+/;
const STRICT_BUSY_DF = 30; // a name in this many items (Neskova, Esselle Quillith) is everywhere: alone it links only on two distinctive words
const PSEUDO_BUSY_DF = 8;
const RARE_TOKEN_DF = 5; // a word in this few items is the story itself ("verity", "mugshot")
// A cluster this big is a chain (a busy name linking a touchdown clip to a whole awards night): it is split with the strict rule
const SPLIT_ITEMS = Number(process.env.IDEAS_SPLIT_ITEMS) || 12;
const SPLIT_SIDE = 3; // ... when it mixes three items from an awards night with three from elsewhere
// An event's name ("VMAs", "MTV Video Music Awards") is not a person: two items at one awards night are two moments unless they
// share a person too, and a person alone never ties a clip from the event to one from elsewhere
const EVENT_NAME = /\b(vmas?|video music awards?|awards?|emmys?|grammys?|oscars?|golden globes?|met gala|super bowl|baftas?|brits|amas|cmas|tonys?|coachella|glastonbury|comic[- ]con)\b/;
const isEventName = (e) => EVENT_NAME.test(e);
// Words two nameless stories can share without being the same story ("man", "hand", "sparks debate").
const WEAK_TOKENS = new Set(['man', 'woman', 'hand', 'spark', 'debate', 'viral', 'video', 'clip', 'internet', 'people', 'mom', 'dad', 'fan',
  'instant', 'became', 'becom', 'hilarious', 'wild']);

/** UTC midnight of the day `t` falls in. */
const utcDay = (t) => Math.floor(t / DAY) * DAY;
/** Spelling variants of one name ("Hollinrel Yarrurn" / "Hollinrel Yarurn") meet once doubled letters are squeezed. */
const SQUEEZED = new Map();
const squeeze = (name) => {
  const hit = SQUEEZED.get(name);
  if (hit !== undefined) return hit;
  const out = name.replace(/([a-z])\1+/g, '$1');
  if (SQUEEZED.size >= 500000) SQUEEZED.clear();
  SQUEEZED.set(name, out);
  return out;
};

/**
 * Quoted phrases and role nouns ("multitasking mom", "Packers fan", "Neskent lookalike") stand in for a name when there is none.
 * Returns { quoted, roles }: the two kinds link under different rules.
 */
function pseudoNames(title, ents) {
  const out = new Set();
  const roles = new Set();
  for (const m of title.matchAll(R.QUOTE_RE)) {
    const ws = words(m[1] || m[2]);
    if (!ws.length || ws.length > 6 || ws.every((w) => STOP.has(w) || GENERIC.has(w))) continue;
    const q = (m[1] || m[2]).trim();
    if (ws.length === 1 && (ws[0].length < 3 || (W.isDictWord(ws[0]) && !W.isCapWord(q)))) continue; // scare quotes: ‘inappropriate’
    out.add('p:' + ws.join(' ')); // also when it is a known name: "Choosin' Texas" the song links as a title
  }
  const entWords = new Set(ents.join(' ').split(' '));
  for (const m of title.matchAll(R.ROLE_RE)) {
    const prev = words(m[2])[0];
    const role = m[3].toLowerCase();
    if (!prev || prev.length < 3 || STOP.has(prev) || GENERIC.has(prev) || /(ing|ed|ly)$/.test(prev) || W.VERB_RE.test(prev)) continue;
    if (entWords.has(prev) && role !== 'lookalike') continue;
    roles.add(`p:${prev} ${role}`);
  }
  return { quoted: [...out].filter((p) => !roles.has(p)), roles: [...roles] };
}

/** Places a title names ("Texas", "Maryland"): two role-noun stories set in different places are different stories. */
function placesIn(ws) {
  const out = new Set();
  ws.forEach((w, i) => {
    if (R.PLACES.has(w)) out.add(w);
    if (i + 1 < ws.length && R.PLACES.has(`${w} ${ws[i + 1]}`)) out.add(`${w} ${ws[i + 1]}`);
  });
  return out;
}

function annotate(it, lex) {
  const ws = words(it.title);
  const padded = ws.join(' ');
  const ents = new Set();
  for (const w of new Set(ws)) for (const n of lex.byFirst.get(w) || []) if (contains(padded, n)) ents.add(n);
  // "Demner's ad" names Caelan Demner; a plain word is no surname ("girlfriend" is not "Lysix Marrenko Girlfriend")
  for (const w of new Set(ws)) { const full = lex.bySurname.get(w); if (full && !ents.has(full) && ((!W.isDictWord(w) && !lex.low.has(w)) || lex.proper.has(w))) ents.add(full); }
  it.ents = [...ents]; // every matched name, so "jasena wickaby stare" and "jasena wickaby" still meet
  it.entsSq = it.ents.map(squeeze);
  it.atEvent = it.ents.some(isEventName) || EVENT_NAME.test(ws.join(' '));
  const folded = W.foldGDrop(it.title); // "‘blockin’ the street’" reads as one quoted phrase
  const pseudo = pseudoNames(folded, it.ents);
  it.pents = [...pseudo.quoted, ...pseudo.roles];
  it.quoteP = new Set(pseudo.quoted);
  it.roleP = new Set(pseudo.roles);
  it.places = placesIn(ws);
  // content words of each quoted phrase: "‘blockin’ the street’" and "‘We’re All Just Blocking The Street’" are one catchphrase
  it.quoteStems = [...folded.matchAll(R.QUOTE_RE)].map((m) => words(m[1] || m[2]).filter((w) => !STOP.has(w) && !GENERIC.has(w)).map(stem))
    .filter((q) => q.length >= 2);
  const entWords = new Set(it.ents.join(' ').split(' '));
  const useful = (w) => !STOP.has(w) && !GENERIC.has(w) && !entWords.has(w) && w.length > 2;
  it.toks = uniq(ws.filter(useful).map(stem));
  // a Bluesky trend's description carries its story words ("He mimed peeing after a sack")
  it.descToks = new Set(words(it.desc || '').filter(useful).map(stem));
  it.key = ws.join(' ');
  const raw = it.title.split(/\s+/);
  it.titleCase = W.isTitleCase(raw);
  it.capToks = new Set(raw.filter((w, i) => i > 0 && W.isCapWord(w)).flatMap((w) => words(w)).map(stem));
}

function clusterItems(items) {
  const df = new Map();
  const entDf = new Map();
  const titleDf = new Map(); // syndicated copies of one title count once: "luggage" in five copies of two stories is still rare
  for (const it of items) {
    for (const t of it.toks) df.set(t, (df.get(t) || 0) + 1);
    for (const e of [...it.ents, ...it.pents]) entDf.set(e, (entDf.get(e) || 0) + 1);
  }
  for (const it of uniqByKey(items)) for (const t of it.toks) titleDf.set(t, (titleDf.get(t) || 0) + 1);
  const ctx = { idf: (t) => Math.log(items.length / (df.get(t) || 1)), entDf, rareIdf: Math.log(items.length / RARE_TOKEN_DF),
    isRare: (t) => (titleDf.get(t) || 0) <= RARE_TOKEN_DF };
  const groups = unionFind(items, (a, b) => linked(a, b, ctx));
  // a chain: split it again with the strict rule (busy names need a strong shared story word, an event's name links nothing)
  const mixed = (g) => g.filter((i) => i.atEvent).length >= SPLIT_SIDE && g.filter((i) => !i.atEvent).length >= SPLIT_SIDE;
  const out = groups.flatMap((g) => (g.length > SPLIT_ITEMS && mixed(g) ? unionFind(g, (a, b) => linked(a, b, { ...ctx, strict: true })) : [g]));
  return { clusters: out.map((g) => makeCluster(g, ctx)), ctx };
}

/** Groups of items joined by `link`, in item order. */
function unionFind(items, link) {
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) if (find(i) !== find(j) && link(items[i], items[j])) parent[find(i)] = find(j);
  }
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(it); });
  return [...groups.values()];
}

/**
 * Same moment? Names link on a shared rare word; one-word names and quoted phrases only within a few days; two shared names
 * (a saga: "Plonker ... Tavix Ostiss tour") across up to 12 days when a distinctive word is shared too.
 */
function linked(a, b, ctx) {
  if (a.key === b.key) return true; // syndicated copies
  const { idf, entDf } = ctx;
  const dt = Math.abs(a.t - b.t) / DAY;
  if (dt > LINK_MAX_DAYS_TWO_NAMES) return false;
  if (!blueskyHookShared(a, b, idf)) return false;
  const both = a.ents.filter((e) => b.ents.includes(e) || b.entsSq.some((x) => contains(x, squeeze(e)) || contains(squeeze(e), x)));
  const sharedNames = both.filter((e) => !both.some((o) => o !== e && contains(o, e)) && !isEventName(e));
  const storyToks = (x) => (x.fam === 'bluesky' ? uniq([...x.toks, ...x.descToks]) : x.toks);
  const bToks = storyToks(b);
  const shared = storyToks(a).filter((t) => bToks.includes(t));
  const distinct = shared.filter((t) => idf(t) >= TOKEN_IDF_MIN);
  const tokWeight = sum(distinct.map(idf));
  const busy = (e) => (entDf.get(e) || 0) >= COMMON_ENTITY_DF;
  if (dt > LINK_MAX_DAYS) return sharedNames.length >= 2 && tokWeight >= TOKEN_IDF_MIN && !sharedNames.every(busy);
  const allBusy = sharedNames.length > 0 && sharedNames.every(busy);
  // two items sharing only a name everyone prints (Neskova: a heckler, a CNN ban, Caelus Demsy's endorsement) share two distinctive
  // words within five days; splitting a chain, so do an item from an awards night and one from elsewhere
  // (or one word few titles use: "flinch"; and "orrory neskova" is as busy as the "neskova" inside it)
  const strong = dt <= LINK_MAX_DAYS && ((distinct.length >= 2 && tokWeight >= 2 * TOKEN_IDF_MIN) || distinct.some((t) => ctx.isRare(t) && idf(t) >= ctx.rareIdf));
  // (a role word in front does not make a busy name rare: "president orrory neskova" is "orrory neskova", "singer esselle quillith" too)
  const everywhere = (e) => [e, e.replace(ROLE_PREFIX, ''), ...both.filter((o) => o !== e && contains(e, o))].some((n) => (entDf.get(n) || 0) >= STRICT_BUSY_DF);
  if (sharedNames.length && !strong && ((ctx.strict && a.atEvent !== b.atEvent) || (sharedNames.length === 1 && everywhere(sharedNames[0])))) {
    return pseudoLinked(a, b, dt, tokWeight, entDf) || sameCatchphrase(a, b);
  }
  // a couple who appear together all the time (Esselle Quillith, Velet Gravard) also need a shared story word
  if (sharedNames.length >= 2 && ((dt <= 2 && !allBusy) || tokWeight > 0)) return true;
  if (sharedNames.length === 1) {
    const isBusy = allBusy;
    if (!sharedNames[0].includes(' ')) { if (tokWeight >= TOKEN_IDF_MIN && dt <= 2) return true; }
    else if (tokWeight >= (isBusy ? 1.6 : 1) * TOKEN_IDF_MIN) return true;
    // "Fenrel Zellsy goes viral" twice in two days, about the same thing (a shared word): not the trailer and a reaction to a transfer
    else if (a.viral && b.viral && dt <= 2 && tokWeight > 0 && (!isBusy || tokWeight >= TOKEN_IDF_MIN)) return true;
  }
  if (pseudoLinked(a, b, dt, tokWeight, entDf)) return true;
  if (sameCatchphrase(a, b)) return true;
  if (sharedNames.length) return false;
  return namelessLinked(a, b, dt, shared, distinct, tokWeight, ctx);
}

/** A Bluesky trend links only when its title or description carries one of the other title's story words. */
function blueskyHookShared(a, b, idf) {
  const check = (bs, other) => {
    const own = new Set([...bs.toks, ...bs.descToks]);
    return other.toks.some((t) => own.has(t) && idf(t) >= TOKEN_IDF_MIN);
  };
  if (a.fam === 'bluesky' && b.fam !== 'bluesky') return check(a, b);
  if (b.fam === 'bluesky' && a.fam !== 'bluesky') return check(b, a);
  return true;
}

/**
 * Shared quoted phrase or role noun. A role noun in two different places is two stories (the Texas luggage driver, the
 * Maryland crash); a quoted title ("Choosin’ Texas") links across families only with a shared distinctive word.
 */
function pseudoLinked(a, b, dt, tokWeight, entDf) {
  const valid = a.pents.filter((p) => b.pents.includes(p)).filter((p) => {
    if (a.roleP.has(p) || b.roleP.has(p)) {
      // a crash or a court case is never the same story as another "delivery driver" by its role noun alone
      if (a.sensitive || b.sensitive) return false;
      const differentPlaces = a.places.size && b.places.size && ![...a.places].some((x) => b.places.has(x));
      return !differentPlaces;
    }
    return tokWeight >= TOKEN_IDF_MIN || a.fam === b.fam;
  });
  if (!valid.length || !(dt <= PSEUDO_LINK_DAYS || (dt <= LINK_MAX_DAYS && valid.some((p) => p.includes(' '))))) return false;
  return valid.some((p) => (entDf.get(p) || 0) < PSEUDO_BUSY_DF) || tokWeight >= TOKEN_IDF_MIN;
}

/** Two meme/trend titles quoting the same catchphrase: one quote's content words all inside the other's. */
function sameCatchphrase(a, b) {
  if (!memeish(a) || !memeish(b)) return false;
  const inside = (p, q) => p.every((w) => q.includes(w));
  return a.quoteStems.some((p) => b.quoteStems.some((q) => inside(p, q) || inside(q, p)));
}

const memeish = (x) => x.viral || x.inherent || /\b(memes?|trends?)\b/i.test(x.title);

/** No shared name: a rare capitalised word in two meme titles ("Verity"), or two rare story words in two meme/trend titles. */
function namelessLinked(a, b, dt, shared, distinct, tokWeight, { idf, rareIdf, isRare }) {
  // a death or a court case shares words with a light story by chance ("model", "girlfriend"): never linked on words alone
  if (!!a.sensitive !== !!b.sensitive) return false;
  if (dt <= PSEUDO_LINK_DAYS && memeish(a) && memeish(b) && shared.some((t) => idf(t) >= rareIdf && t.length >= 4 && !R.isPlaceOrTeam(t) &&
    a.capToks.has(t) && b.capToks.has(t) &&
    (!a.titleCase || !b.titleCase))) return true; // "Verity": a rare capitalised word in two meme titles
  // a nameless story retold: two rare words that are not "man", "hand", "sparks debate", "instant meme"
  const rare = distinct.filter((t) => isRare(t) && !WEAK_TOKENS.has(t));
  const nameless = !a.ents.length && !b.ents.length;
  if (nameless && rare.length >= 2 && memeish(a) && memeish(b) && dt <= PSEUDO_LINK_DAYS) return true;
  const jaccard = shared.length / (a.toks.length + b.toks.length - shared.length || 1);
  return shared.length >= 3 && tokWeight >= 3 * TOKEN_IDF_MIN && jaccard >= 0.4;
}

const topOf = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] || null;

function makeCluster(items, ctx) {
  const entCount = new Map();
  const pentCount = new Map();
  for (const it of items) {
    // a name that opens a title is its subject, so it counts one and a half
    for (const e of it.ents) entCount.set(e, (entCount.get(e) || 0) + (it.key.startsWith(e + ' ') ? 1.5 : 1));
    for (const p of it.pents) pentCount.set(p, (pentCount.get(p) || 0) + 1);
  }
  const ts = items.map((i) => i.t);
  const mid = median(ts);
  const byDay = new Map();
  for (const it of uniqByKey(items)) { const d = utcDay(it.t); byDay.set(d, (byDay.get(d) || 0) + 1); }
  const c = {
    items, topEnt: topOf(entCount), topPseudo: topOf(pentCount), entSet: new Set(entCount.keys()), pentSet: new Set(pentCount.keys()),
    byDay, peakT: Number(topOf(byDay)),
    first: Math.min(...ts.filter((t) => t >= mid - 4 * DAY)), // ignore a stray early mention
    last: Math.max(...ts), trends: [], wiki: [],
  };
  c.hooks = clusterHooks(c, ctx.idf);
  // names most of the story's titles share: a headline naming both sides ("Plonker ... Tavix Ostiss tour") reads best
  c.mainEnts = [...entCount.entries()].filter(([e, n]) => n >= Math.max(2, 0.25 * items.length) && e !== c.topEnt).map(([e]) => e);
  return c;
}

/** The words that carry the story: rare words shared by 2+ distinct titles, rarest first ("mugshot", "pulse"). */
function clusterHooks(c, idf) {
  const cnt = new Map();
  for (const it of uniqByKey(c.items)) for (const t of new Set(it.toks)) cnt.set(t, (cnt.get(t) || 0) + 1);
  const titles = uniqByKey(c.items).length;
  if (titles < 3) return [];
  return [...cnt.entries()].filter(([t, n]) => n >= 2 && n >= 0.3 * titles && idf(t) >= TOKEN_IDF_MIN && !R.HOOK_STOP.has(t))
    .sort((a, b) => idf(b[0]) - idf(a[0]) || b[1] - a[1]).slice(0, 2).map(([t]) => t);
}

module.exports = { annotate, clusterItems, linked, squeeze, utcDay, isEventName, TOKEN_IDF_MIN };
