'use strict';
/*
 * A frozen day's answer key as labels for clustering (ios/IDEAS-SUPER.md P8 "label the frozen pools by gold's match rules"): a
 * text belongs to the gold story whose names it carries, unless the story's "not" words are in it, and only when its "any" words
 * are (when the story has some). A text two stories claim equally is left unlabelled. Same reading of the rules as eval/score.js
 * (a phrase of words, a trailing * matching any ending, a plural "s" folded). Reads the gold object it is handed; no file, no clock.
 */

const norm = (s) => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[‘’`´]/g, "'").replace(/'s\b/g, '').replace(/'/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const toks = (s) => { const n = norm(s); return n ? n.split(' ') : []; };
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** One alternative ("groom*", "comic con") as [{ w, star }], or null when it has no word. */
function alt(raw) {
  const words = [];
  for (const piece of String(raw || '').trim().split(/\s+/)) {
    const star = piece.endsWith('*');
    const parts = toks(piece.replace(/\*+$/, ''));
    parts.forEach((w, i) => words.push({ w, star: star && i === parts.length - 1 }));
  }
  return words.length ? words : null;
}
const alts = (list) => list.map(alt).filter(Boolean);
/** The length in words of the first alternative found in `tokens`, or 0. */
function hit(altsList, tokens) {
  let best = 0;
  for (const a of altsList) {
    for (let i = 0; i + a.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < a.length && ok; j++) ok = a[j].star ? tokens[i + j].startsWith(a[j].w) : stem(a[j].w) === stem(tokens[i + j]);
      if (ok) { best = Math.max(best, a.length); break; }
    }
  }
  return best;
}

/** The gold stories as matchers: [{ key, verdict, names, any, not }]. */
function matchers(gold) {
  return (gold.stories || []).filter((s) => s.match && (s.match.names || []).length).map((s) => ({
    key: s.key, verdict: s.verdict || null,
    names: alts(s.match.names || []),
    any: s.match.any ? alts(s.match.any.split('|')) : [],
    not: s.match.not ? alts(s.match.not.split('|')) : [],
    nameKeys: (s.match.names || []).map(norm),
  }));
}

/** The gold story a text tells (its key), or null: none, or two claim it equally. */
function labelOf(text, stories) {
  const tokens = toks(text);
  if (!tokens.length) return null;
  let best = null; let tie = false;
  for (const s of stories) {
    const name = hit(s.names, tokens);
    if (!name || hit(s.not, tokens)) continue;
    const topical = s.any.length ? hit(s.any, tokens) > 0 : null;
    if (topical === false) continue;
    const score = name * 10 + (topical ? 2 : 0);
    if (!best || score > best.score) { best = { key: s.key, score }; tie = false; } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}

/** Pairs of gold stories that share a name: one person's two stories, which must stay two. [[keyA, keyB, name]] */
function samePersonPairs(stories) {
  const out = [];
  for (let i = 0; i < stories.length; i++) for (let j = i + 1; j < stories.length; j++) {
    const shared = stories[i].nameKeys.filter((n) => stories[j].nameKeys.includes(n));
    if (shared.length) out.push([stories[i].key, stories[j].key, shared[0]]);
  }
  return out;
}

/**
 * B-cubed precision, recall and F1 of predicted groups against labels, over the labelled elements only. groups: [[element]];
 * labels: element -> gold key or null.
 */
function bcubed(groups, labels) {
  const goldSize = new Map();
  for (const g of groups) for (const e of g) { const l = labels.get(e); if (l) goldSize.set(l, (goldSize.get(l) || 0) + 1); }
  let p = 0; let r = 0; let n = 0;
  for (const g of groups) {
    const counts = new Map();
    let labelled = 0;
    for (const e of g) { const l = labels.get(e); if (l) { counts.set(l, (counts.get(l) || 0) + 1); labelled += 1; } }
    for (const [l, c] of counts) { p += c * (c / labelled); r += c * (c / goldSize.get(l)); n += c; }
  }
  const P = n ? p / n : 0; const R = n ? r / n : 0;
  return { precision: P, recall: R, f1: P + R ? (2 * P * R) / (P + R) : 0, labelled: n };
}

/** Whether a gold pair stayed apart: no group holds `min` or more texts of each. Returns { apart, worst } (worst: the most mixed group's smaller side). */
function apart(groups, labels, a, b, min = 2) {
  let worst = 0;
  for (const g of groups) {
    let na = 0; let nb = 0;
    for (const e of g) { const l = labels.get(e); if (l === a) na += 1; else if (l === b) nb += 1; }
    worst = Math.max(worst, Math.min(na, nb));
  }
  return { apart: worst < min, worst };
}

module.exports = { matchers, labelOf, samePersonPairs, bcubed, apart, norm };
