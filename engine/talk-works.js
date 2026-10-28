'use strict';
/*
 * Talking-point works [talking-points.js]: the film, show or documentary a name's coverage is about ("Quavrrb movie", "Monster
 * Tavena Osturn", "Brinena Hassiss Velix Graviss doc"), and the crossover a reveal is ("Fortnite FNAF collab").
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const TN = require('./talk-nouns');
const TC = require('./talk-candidates');
const { contains } = require('./util');

const { words } = W;
const { keyOf, hay, mentions, LEAGUE_KW } = TC;

/**
 * A film, show or documentary the name's coverage is about, when the name is read and searched for it ("Orro Neskith" for Netflix's
 * 'Quavrrb'): { title words, noun } from a quoted work in a fifth of its titles ("Quavrrb movie"; a work naming the subject,
 * "Monster: The Tavena Osturn Story", as "Monster Tavena Osturn"), or a person's take on the subject ("Brinena Hassiss's Velix
 * Graviss doc"); null when its titles name none.
 */
const SCREEN_WORD = /\b(movie|film|documentary|docuseries|doc|series|miniseries|show)\b/i;
const SCREEN_NOUN = { movie: 'movie', film: 'movie', documentary: 'doc', docuseries: 'doc', doc: 'doc', series: 'series', miniseries: 'series', show: 'show' };
// (a runway's show is no screen work: "makes Paris Fashion Week runway debut in Miu Miu show"; nor is an event: "Fashion Week")
const STAGE_SHOW = /\b(?:fashion|runway|catwalk|couture|collection|week|spring|summer|fall|autumn|winter|resort|ss\d{2}|fw\d{2})\s+(?:\S+\s+){0,3}?show\b/i;
const EVENT_WORK = /\b(?:fashion|runway|week|awards?|festival|fest|con|expo|summit|tour|gala|ball)$/i;
function workOf(subject, titles, lex) {
  const subj = subject.split(' ');
  const screen = titles.filter((t) => SCREEN_WORD.test(t) && !(/\bshow\b/i.test(t.match(SCREEN_WORD)[0]) && STAGE_SHOW.test(t)));
  if (screen.length < WORK_MIN) return null;
  const kindOfWork = (list) => {
    const n = new Map();
    for (const t of list) { const m = t.match(SCREEN_WORD); if (m) { const k = SCREEN_NOUN[m[1].toLowerCase()]; n.set(k, (n.get(k) || 0) + 1); } }
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  };
  // a person's take on a person: "Brinena Hassiss's Velix Graviss doc", under either name
  const NAME = `\\p{Lu}[\\p{L}.’'-]+(?: \\p{Lu}[\\p{L}.’'-]+){1,2}`;
  const subjRe = subj.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+');
  const screenAlt = SCREEN_WORD.source.slice(3, -3);
  const takes = [new RegExp(`(${NAME})['’]s (?:new )?(${subjRe})\\s+(?:${screenAlt})\\b`, 'iu'), new RegExp(`(${subjRe})['’]s (?:new )?(${NAME})\\s+(?:${screenAlt})\\b`, 'iu')];
  const pairs = new Map();
  for (const t of screen) {
    for (const re of takes) {
      const m = t.match(re);
      if (!m) continue;
      const [maker, about] = [keyOf(m[1]), keyOf(m[2])];
      const other = maker === subject ? about : maker;
      if (other === subject || !TN.personLike(other, lex)) continue;
      const k = `${maker}|${about}`;
      pairs.set(k, [...(pairs.get(k) || []), t]);
    }
  }
  const mk = [...pairs.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (mk && mk[1].length >= 2) {
    const [maker, about] = mk[0].split('|');
    const both = screen.filter((t) => mentions(hay(t), maker) && mentions(hay(t), about));
    return { ws: [...maker.split(' '), ...about.split(' '), kindOfWork(mk[1])], noun: kindOfWork(mk[1]), work: null, about: true, n: both.length };
  }
  // the work: a proper name (capitalised mid-line in the sentence-case titles) most of the screen titles carry, never the subject's own
  // words, a platform or a person's name ("Quavrrb" in Netflix's 'Quavrrb' movie; "Primetime"; "Monster")
  const proper = TN.caseMap(titles);
  const works = new Map();
  for (const t of screen) {
    const people = new Set(TN.nameRuns(t).filter((n) => TN.personLike(n, lex)).flatMap((n) => n.split(' ')));
    // (a word inside a longer quoted title is that title's, not a work of its own: "Everything" of 'You Can See Everything')
    const inner = new Set([...t.matchAll(/[‘'“"]([^’'”"]{2,60})[’'”"]/g)].map((m) => words(m[1])).filter((ws) => ws.length >= 3).flatMap((ws) => ws.slice(1)));
    const seen = new Set();
    for (const tok of t.split(/\s+/)) {
      const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '');
      const k = core.toLowerCase();
      if (!/^\p{Lu}/u.test(core) || core.length < 3 || seen.has(k) || !proper.has(k) || subj.includes(k) || people.has(k) || inner.has(k) || W.STOP.has(k) ||
        LEAGUE_KW.test(k) || SCREEN_WORD.test(k) || R.PLACES.has(k)) continue;
      seen.add(k);
      works.set(k, [...(works.get(k) || []), t]);
    }
  }
  const best = [...works.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (!best || best[1].length < Math.max(WORK_MIN, WORK_SCREEN_SHARE * screen.length)) return null;
  const [wk0, ts] = best;
  // (the whole proper name the word starts in its titles: "Celebrity Traitors", not "Celebrity")
  const runs = new Map();
  for (const t of ts) {
    const toks = t.split(/\s+/).map((x) => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, ''));
    const i = toks.findIndex((x) => x.toLowerCase() === wk0);
    if (i < 0) continue;
    let j = i + 1;
    while (j < toks.length && j - i < 3 && /^\p{Lu}/u.test(toks[j]) && proper.has(toks[j].toLowerCase()) && !SCREEN_WORD.test(toks[j]) &&
      !/[:,;.!?]$/.test(t.split(/\s+/)[j - 1] || '')) j++;
    const run = toks.slice(i, j).join(' ');
    runs.set(run, (runs.get(run) || 0) + 1);
  }
  const top = [...runs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const form = top && top[1] >= Math.max(2, 0.5 * ts.length) ? top[0] : proper.get(wk0);
  const wk = keyOf(form);
  if (EVENT_WORK.test(wk)) return null;
  const kind = kindOfWork(ts);
  // a work named for the subject: "Monster: The Tavena Osturn Story", 'Monster: Tavena Osturn' -> "Monster Tavena Osturn"
  const named = new RegExp(`${form}[:\\s]+(?:the\\s+)?${subj.join('\\s+')}(?:\\s+story|['’”"])`, 'i');
  if (ts.filter((t) => named.test(t)).length >= 2) return { ws: [...wk.split(' '), ...subj], noun: kind, work: form, about: true, n: ts.length };
  return { ws: [...wk.split(' '), kind], noun: kind, work: form, n: ts.length };
}
const WORK_MIN = 4;
const WORK_SCREEN_SHARE = 0.4;

/** An IP the name's reveal is a crossover with ("Fortnite FNAF collab"): an acronym-cased name in three or more titles, one saying collab. */
function crossoverOf(subject, titles) {
  const subj = subject.split(' ');
  const counts = new Map();
  for (const t of titles) {
    for (const tok of new Set(t.split(/\s+/).map((x) => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '')))) {
      if (!/^\p{Lu}[\p{L}]{1,5}$/u.test(tok) || (tok.match(/\p{Lu}/gu) || []).length < 2 || subj.includes(tok.toLowerCase())) continue;
      const k = tok.toUpperCase();
      counts.set(k, [...(counts.get(k) || []), t]);
    }
  }
  const best = [...counts.entries()].filter(([, ts]) => ts.length >= CROSSOVER_MIN && ts.some((t) => TN.FAMILY.get('collab').re.test(t)))
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : null;
}
const CROSSOVER_MIN = 3;

module.exports = { SCREEN_WORD, workOf, crossoverOf };
