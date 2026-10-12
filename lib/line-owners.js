'use strict';
/*
 * Whose a thing is (ios/IDEAS-FEED.md G3 rule 6, R3): the two readings of a noun phrase the who-did-what rule leans on beside its
 * verbs. A possessor the source gives a thing is kept with it ("her husband's affair" is never "affair"), and a thing given to a
 * name is given so by the source ("<thing> from <name>"). Pure: no clock, no I/O.
 */
const T = require('./line-text');
const R = require('./line-roles');

const QUIET_HEAD = (t) => !T.isContent(t) || T.ADVERB.has(t.k) || /ly$/.test(t.k);
const OWNER_REACH = 3;
/**
 * A possessor the line left out (reviewers, 2026-10-12: "shares shocking details of affair" from "her husband's affair" gave the
 * affair to the one who told of it). Where the source has "<owner>'s <thing>" every time it says the thing, a clause that keeps
 * the thing keeps its owner: before it, after "of", "by" or "from", or as someone the clause names. A pronoun owns nothing new.
 */
function ownerDropped(L, c, src) {
  const toks = src.S.toks;
  for (let j = 0; j < toks.length; j++) {
    const o = toks[j];
    if (!o.poss || T.PRONOUN[o.k] || o.q) continue;
    // (the thing owned, in the owner's own phrase: past a word that only describes it, "<owner>'s alleged ex"; a claim is its
    // maker's to make and is read by its roles, "<owner>'s allegations")
    let head = null;
    for (let k = j + 1; k < toks.length && k <= j + OWNER_REACH; k++) {
      if (T.commaAfter(toks[k - 1]) || T.breaksAfter(toks[k - 1])) break;
      if (QUIET_HEAD(toks[k]) || toks[k].poss || R.verbShaped(toks[k])) continue;
      head = toks[k];
      break;
    }
    if (!head || src.S.names.has(head.i) || head.num || R.NOMINAL.test(head.k) || T.REPORT.test(head.k)) continue;
    // (the thing, said in the source with no owner as well, is anybody's)
    if (toks.some((x, k) => x.st === head.st && !src.S.names.has(k) && !toks.slice(Math.max(0, k - OWNER_REACH), k).some((y) => y.poss && !T.PRONOUN[y.k]))) continue;
    for (let i = c.from; i <= c.to; i++) {
      if (L.names.has(i) || L.toks[i].st !== head.st) continue;
      const kept = L.toks.slice(c.from, c.to + 1).some((x) => x.k === o.k) || (c.heir && c.heir.keys.includes(o.k));
      if (!kept) return `"${L.toks[i].s}" is ${o.s}’s in the source, and the line does not say whose`;
    }
  }
  return null;
}
const GIVEN_BY = new Set(['from', 'by']);
const GIVEN_REACH = 4;
/**
 * A thing given to a name (reviewers, 2026-10-12: "‘repeated disturbance’ from streamer Mara Voss" where the source has the
 * disturbance "from fan" and the actor responding to it). "<thing> from <name>" and "<thing> by <name>" in the line are the same
 * in the source: the name follows the thing after that word there, or owns it ("<name>'s <thing>"), or the thing is a verb's own
 * form and the name its doer. Read only where the source has the thing at all; a claim's noun is read by its roles (rule 6).
 */
function givenDiffers(L, c, src) {
  for (let i = c.from + 1; i <= c.to; i++) {
    const p = L.toks[i];
    if (!GIVEN_BY.has(p.k) || p.q) continue;
    // ("accused of abuse by Tobin Hale": after something done to someone, "by" says who did that, and rule 6 reads it there)
    if (p.k === 'by' && L.toks.slice(c.from, i).some((x, n) => !L.names.has(c.from + n) && (/(?:ed|en)$/.test(x.k) || T.PAST_FORMS.has(x.k)))) continue;
    const m = L.mentions.find((x) => x.start > i && x.start <= i + GIVEN_REACH && x.end <= c.to && !L.toks.slice(i + 1, x.start).some((y) => T.commaAfter(y) || T.STOP.has(y.k)));
    let h = i - 1;
    while (h >= c.from && (!T.isContent(L.toks[h]) || T.FREE.has(L.toks[h].k))) h -= 1;
    if (!m || h < c.from || L.names.has(h) || L.toks[h].num || R.isNominal(L, h) || R.readable(L, h)) continue;
    const head = L.toks[h];
    const toks = src.S.toks;
    const at = toks.map((x, k) => (x.st === head.st && !src.S.names.has(k) ? k : -1)).filter((k) => k >= 0);
    if (!at.length) continue;
    const same = (x) => !!x && T.sameName(x, m);
    const given = at.some((k) => {
      // ("<thing> from <label> <name>": nothing but what the name is called between them)
      for (let n = k + 1; n < toks.length && n <= k + 2; n++) {
        if (!GIVEN_BY.has(toks[n].k) && toks[n].k !== 'of') continue;
        const next = src.S.mentions.find((x) => x.start > n && x.start <= n + GIVEN_REACH);
        if (same(next) && !toks.slice(n + 1, next.start).some((y) => T.STOP.has(y.k) || T.commaAfter(y) || R.verbShaped(y))) return true;
      }
      // ("<name>'s <thing>", "<name> <thing>")
      const before = src.S.mentions.find((x) => x.end < k && k - x.end <= 2 && !toks.slice(x.end + 1, k).some((y) => R.verbShaped(y) || T.CONNECTIVE.has(y.k) || T.commaAfter(y)));
      return same(before);
    });
    if (!given) return `"${head.s} ${p.s} ${m.keys.join(' ')}": the source does not give it to ${m.keys.join(' ')}`;
  }
  return null;
}

module.exports = { ownerDropped, givenDiffers, QUIET_HEAD };
