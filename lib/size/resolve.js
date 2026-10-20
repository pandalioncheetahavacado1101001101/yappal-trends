'use strict';
/*
 * Which Wikipedia article(s) a trend's size is read from (ios/.review/trend-size-scale.md "The unit"): the page of the row's subject
 * and of anyone else its title names, and a page named after the trend itself (a meme, a work, an event). A page is attached only
 * when its name is the subject's and what it says it is agrees with what the row is; a page that only shares a name is a namesake
 * and is refused. Where the page itself cannot say (no description, no role to compare, a one-word name anybody could have), the
 * page must also have moved when the trend began. Pure: candidates come in as the search replies give them
 * (lib/sources/size-wiki.js).
 */
const { keyOf, median } = require('../util');
const { FLOOR } = require('./scale');
const { words, baseTitle, qualifierOf, classify, PERSON_CLASSES } = require('./pages');
const D = require('./days');

// the card's own nouns: what a row's title adds to its subject ("Alex Rowan arrest"), never what names a page
const GENERIC = new Set(('allegations allegation backlash arrest arrested ban banned drama controversy feud split divorce trial comments comment meaning word tutorial ' +
  'trend trends challenge sound video clip series movie film box office reveal death dies died firing fired comeback charges charged heckler rant tears diss ' +
  'retirement retires lawsuit sued apology apologizes statement response reaction reacts beef fight leak leaked scandal rumors rumours dating breakup engaged ' +
  'wedding pregnant baby news update viral meme memes explained discusses talks says slams responds goes new latest').split(' '));

// the classes a row's role agrees with: a page that says another occupation is someone else (a namesake). 'creator' is the feed's
// default for a talking point's subject (13 of the 53 subjects of 2026-10-19; comedians and commentators carry it too, and they are
// actors and politicians here): it agrees with a creator, an actor, a musician or a politician, never with a page that is only an
// athlete's (a busy footballer's page passes the move test by chance in 8 or 9 of 20 unrelated windows). It is weak
// agreement all the same: only a move attaches such a page. A creator row with no role is read the same way.
const ROLE = {
  streamer: ['creator'], youtuber: ['creator'], tiktoker: ['creator'], creator: ['creator', 'actor', 'musician', 'politician'], actor: ['actor', 'musician', 'creator'],
  musician: ['musician', 'actor', 'creator'], athlete: ['athlete', 'creator'], politician: ['politician', 'otherPerson'],
};
// the row's tier as evidence for a full name: a celebrity row's subject is the famous bearer of the name, a politics row's a public
// figure. An athlete's page earns no credit from a celebrity row (a sports row's subject is the athlete): only its move attaches it
const TIER = { celebrity: ['actor', 'musician', 'creator', 'politician', 'otherPerson'], politics: ['politician', 'otherPerson'], sports: ['athlete'] };
// what a row of each kind can be read from: the page classes that agree, and those that never do (unless one that agrees is there too)
const ROW_KIND = {
  word: { ok: ['meme'], never: ['place', 'org', 'product', 'work', 'song', 'game', 'event', 'disambiguation'] },
  sound: { ok: ['song'], never: ['place', 'org', 'product', 'event', 'work', 'game', 'disambiguation'] },
  game: { ok: ['game'], never: ['place', 'org', 'disambiguation'] },
  show: { ok: ['work'], never: ['place', 'org', 'product', 'disambiguation'] },
  story: { ok: ['event', 'meme', 'work'], never: ['place', 'org', 'product', 'disambiguation'] },
};
/** Which of ROW_KIND a row is read as. */
function rowKind(row) {
  const sub = row.sub || '';
  if (row.kind === 'sound' || sub === 'sound' || sub === 'music') return 'sound';
  if (sub === 'gaming' || sub === 'game') return 'game';
  if (sub === 'show') return 'show';
  if (row.kind === 'word') return 'word';
  return 'story';
}

// confidence: the name is the subject's (0.5); the page's occupation is the row's role (+0.3), or fits the row's tier (+0.2), or
// the row only says "creator" (+0.15); the page moved when the trend began (+0.25 clearly, +0.2 a little). Attached at 0.7 or more.
const NAME = 0.5;
const AGREES = 0.3;
const AGREES_TIER = 0.2;
const AGREES_WEAK = 0.15;
const MOVED = { strong: 0.25, weak: 0.2, none: 0 };
const ACCEPT = 0.7;
// a clear move: the trend's days stand 4 robust sigmas above the page's own level, and a floor's worth; a little one: 2 sigmas, a
// floor's worth, and above every day of the weeks before (a busy page's ordinary swing is neither)
const SPIKE_SIGMAS = 4;
const WEAK_SIGMAS = 2;
const MAD_TO_SIGMA = 1.4826;
const SPIKE_BEFORE_DAYS = 45;
const SPIKE_BEFORE_MIN_DAYS = 5;

/**
 * How a page moved when the trend began: 'strong', 'weak', 'none', or null when too little is known. views: Map(day -> views or
 * null). The days from 45 to 4 before the start give the page's own level and swing; the trend's days are from 3 before to 14 after.
 */
function spiked(views, trendStart) {
  if (!views || !trendStart) return null;
  const before = [];
  const during = [];
  let unknown = 0;
  for (const [d, v] of views) {
    const n = D.dayNum(d) - D.dayNum(trendStart);
    if (!Number.isFinite(v)) { if (n >= -3 && n <= 14) unknown += 1; continue; }
    if (n >= -SPIKE_BEFORE_DAYS && n <= -4) before.push(v);
    else if (n >= -3 && n <= 14) during.push(v);
  }
  if (!during.length) return null;
  // (a page whose trend days are partly not filled in yet has not been seen not to move: the search's views lag a few days)
  const settle = (level) => (level === 'none' && unknown > 0 ? null : level);
  const peak = Math.max(...during);
  // (a page with hardly any days before: it was made for the trend, and its first days are the move)
  if (before.length < SPIKE_BEFORE_MIN_DAYS) return settle(peak >= FLOOR + 2 * (before.length ? Math.max(...before) : 0) ? 'strong' : 'none');
  const level = median(before);
  const swing = MAD_TO_SIGMA * median(before.map((v) => Math.abs(v - level)));
  if (peak - level >= Math.max(FLOOR, SPIKE_SIGMAS * swing)) return 'strong';
  return settle(peak - level >= Math.max(FLOOR, WEAK_SIGMAS * swing) && peak > Math.max(...before) ? 'weak' : 'none');
}

/** A name nobody else is likely to carry: two words or more, or a handle with a digit or an inner capital ("Zed2Play", "QuietCr4ft"). */
const distinctive = (name) => words(name).length >= 2 || /\d/.test(name) || /[a-z][A-Z]/.test(name);

/** The people a row's size is read from: its subject (the first of `people`), and anyone else its title names; two at most. */
function peopleOf(row) {
  const title = new Set(words(row.title || ''));
  const out = [];
  (row.people || []).forEach((p, i) => {
    const w = words(p.name || '');
    if (!w.length || out.length >= 2 || out.some((o) => keyOf(o.name) === keyOf(p.name))) return;
    if (i === 0 || w.every((x) => title.has(x))) out.push({ name: p.name, role: p.role || null });
  });
  return out;
}

/**
 * The words that name the trend itself, beside its people: a sound's song without its artist ("Velvet Static by Mara Quill" ->
 * velvet static), anything else's title without the card's noun.
 */
function coreOf(row, people = peopleOf(row)) {
  const name = (row.kind === 'word' || row.kind === 'sound') && row.topic && row.topic.name ? row.topic.name : row.title || '';
  const song = rowKind(row) === 'sound' ? name.replace(/\s+by\s+.+$/i, '') : name;
  const personWords = new Set(people.flatMap((p) => words(p.name)));
  return { name, core: [...new Set(words(song))].filter((w) => !GENERIC.has(w) && !personWords.has(w)) };
}

/**
 * What to look up for a row: [{ id, kind: 'person' | 'trend', name, role, query }]. A person by their name (a phrase search); the trend
 * by its topic or title, unless all its title says beyond its people is the card's noun and one word ("Mara Quill bird feud":
 * the singer's page is the trend's, and "bird" names no page of it).
 */
function subjectsOf(row) {
  const people = peopleOf(row);
  const out = people.map((p) => ({ id: `person:${keyOf(p.name)}`, kind: 'person', name: p.name, role: p.role, tier: row.tier || null, query: `"${p.name.replace(/"/g, '')}"` }));
  const { name, core } = coreOf(row, people);
  if (core.length >= (people.length ? 2 : 1)) out.push({ id: `trend:${keyOf(name)}`, kind: 'trend', name, role: null, query: name });
  return out;
}

/** A judgement: { pageid, title, subject, kind, confidence, verdict: 'accept' | 'needs-spike' | 'refuse', need ('strong' | 'moved'), why }. */
const verdictOf = (candidate, subject) => (verdict, confidence, why, need = 'moved') => ({ pageid: candidate.pageid, title: candidate.title, subject: subject.id, kind: subject.kind,
  confidence: Math.round(Math.min(1, confidence) * 100) / 100, verdict, need, why });

/** What can still attach a page at confidence c: a little move, or only a clear one. */
const needOf = (c) => (c + MOVED.weak >= ACCEPT ? 'moved' : 'strong');

/** A person's page judged: its name, then what it says it is against the row's role and tier, then whether it moved. */
function judgePerson(candidate, subject, page, moved, trendStart, out) {
  if (keyOf(baseTitle(candidate.title)) !== keyOf(subject.name)) return out('refuse', 0, 'another name');
  if (candidate.disambiguation || (page.classes.has('disambiguation') && !page.person)) return out('refuse', 0, 'a list of namesakes');
  const strict = !distinctive(subject.name);
  if (!page.person) {
    // (a page with no description says nothing either way: only its move can attach it)
    if (!page.described) return out('needs-spike', NAME, 'no description: only a move can say it is this page', 'strong');
    return out('refuse', 0, `not a person (${[...page.classes].join(', ') || 'it says nothing of one'})`);
  }
  if (page.died && trendStart && page.died < Number(trendStart.slice(0, 4)) - 1) return out('refuse', 0, `a namesake who died in ${page.died}`);
  const occupations = [...page.classes].filter((c) => c in PERSON_CLASSES);
  // (the feed's default role, or a creator row that names none: weak, but a page with another occupation is still a namesake)
  const weak = subject.role === 'creator' || (!subject.role && subject.tier === 'creator');
  const role = ROLE[weak ? 'creator' : subject.role] || null;
  const tier = TIER[subject.tier] || null;
  let c = NAME;
  let why = 'the name';
  if (role && occupations.length && !occupations.some((o) => role.includes(o))) return out('refuse', 0, `a namesake: ${occupations.join(', ')}, not ${subject.role || `a ${subject.tier} row's subject`}`);
  if (role && occupations.length && !weak) {
    c += AGREES;
    why += ', the role';
  } else if (tier && occupations.some((o) => tier.includes(o)) && !strict) {
    c += AGREES_TIER;
    why += `, a ${subject.tier} row`;
  } else if (weak) {
    c += AGREES_WEAK;
  }
  // (a one-word name is anybody's: only a clear move attaches it, whatever the page says)
  if (strict) {
    if (moved === 'strong') return out('accept', c + MOVED.strong, 'a one-word name, and a clear move');
    return moved === null ? out('needs-spike', c, 'a one-word name: only a clear move can say it is this page', 'strong') : out('refuse', c, 'a one-word name, and no clear move');
  }
  if (moved && moved !== 'none') { c += MOVED[moved]; why += ', its move'; }
  if (c >= ACCEPT) return out('accept', c, why);
  return moved === null ? out('needs-spike', c, `${why} alone`, needOf(c)) : out('refuse', c, 'nothing but the name says it is this page, and it did not move when the trend began');
}

/** The trend's own page judged: every word of its name is the trend's, and it names all of what the trend is. */
function judgeTrend(candidate, subject, row, page, moved, trendStart, out) {
  const people = peopleOf(row);
  const { core } = coreOf(row, people);
  const trendWords = new Set([...words(row.title || ''), ...words((row.topic && row.topic.name) || ''), ...people.flatMap((p) => words(p.name))]);
  const base = words(baseTitle(candidate.title));
  if (!base.length || !base.every((w) => trendWords.has(w))) return out('refuse', 0, 'its name says more than the trend');
  if (!core.every((w) => base.includes(w))) return out('refuse', 0, 'its name covers too little of the trend');
  if (candidate.disambiguation || (page.classes.has('disambiguation') && !page.person)) return out('refuse', 0, 'a list of namesakes');
  // (a person whose whole name is the trend's: the row is about them, though its people do not say so; "Odile brant")
  if (page.person) {
    if (keyOf(baseTitle(candidate.title)) !== core.join(' ') && words(baseTitle(candidate.title)).join(' ') !== core.join(' ')) return out('refuse', 0, 'a person the row does not name');
    return judgePerson(candidate, { ...subject, name: baseTitle(candidate.title), role: null, tier: row.tier || null }, page, moved, trendStart, out);
  }
  const kind = ROW_KIND[rowKind(row)];
  const classes = [...page.classes];
  const agrees = classes.some((c) => kind.ok.includes(c));
  if (!agrees && classes.some((c) => kind.never.includes(c))) return out('refuse', 0, `a ${classes.join(', ')} page, not this ${rowKind(row)}`);
  // (a qualifier that names another kind is another page: "Glass Harbor (film)" for a song)
  const qual = qualifierOf(candidate.title);
  if (qual && !agrees && !words(qual).every((w) => trendWords.has(w))) return out('refuse', 0, `another ${qual}`);
  let c = NAME + (agrees ? AGREES : 0);
  if (moved) c += MOVED[moved];
  if (c >= ACCEPT) return out('accept', c, agrees ? 'its name, and what the page says it is' : 'its name, and its move');
  if (moved === null) return out('needs-spike', c, 'its name alone', needOf(c));
  return out('refuse', c, 'the page did not move when the trend began');
}

/** One candidate page judged for one subject. candidate: { pageid, title, description, disambiguation, views (Map or null) }. */
function judge(candidate, subject, row, trendStart) {
  const out = verdictOf(candidate, subject);
  const page = classify(candidate.description, candidate.title);
  const moved = spiked(candidate.views, trendStart);
  return subject.kind === 'person' ? judgePerson(candidate, subject, page, moved, trendStart, out) : judgeTrend(candidate, subject, row, page, moved, trendStart, out);
}

/**
 * A row's articles from the candidates its lookups gave. replies: Map(subject id -> [candidate]) in the search's own order. Returns
 * { subjects, articles: [judgement] (one page each subject at most, no page twice), refused: [judgement] (pages with the subject's
 * name refused: the namesakes) }. A 'needs-spike' article is attached only once its own history shows the move (confirm()).
 */
function resolve(row, replies, trendStart) {
  const subjects = subjectsOf(row);
  const articles = [];
  const refused = [];
  for (const s of subjects) {
    const judged = (replies.get(s.id) || []).map((c) => judge(c, s, row, trendStart));
    for (const j of judged) if (j.verdict === 'refuse' && j.why !== 'another name' && !j.why.startsWith('its name')) refused.push(j);
    const best = judged.filter((j) => j.verdict !== 'refuse').sort((a, b) => b.confidence - a.confidence)[0];
    if (best && !articles.some((a) => a.pageid === best.pageid)) articles.push(best);
  }
  return { subjects, articles, refused };
}

/** A 'needs-spike' article once its own history is in: attached when the history moved as it needed to, refused otherwise. */
function confirm(article, views, trendStart) {
  if (article.verdict !== 'needs-spike') return article;
  const s = spiked(views, trendStart);
  const ok = s === 'strong' || (s === 'weak' && article.need === 'moved');
  return ok ? { ...article, verdict: 'accept', confidence: Math.round(Math.min(1, article.confidence + MOVED[s]) * 100) / 100, why: `${article.why}; it moved` }
    : { ...article, verdict: 'refuse', why: s === null ? 'too little history to tell' : 'the page did not move as it had to when the trend began' };
}

module.exports = { GENERIC, words, baseTitle, qualifierOf, classify, spiked, distinctive, peopleOf, coreOf, subjectsOf, judge, resolve, confirm, rowKind, ACCEPT };
