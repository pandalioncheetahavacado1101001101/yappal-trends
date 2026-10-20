'use strict';
/*
 * Who a name on a card is (P14, B2): resolver v2 of the entity roster (scripts/build-data/entity-roster/resolver2.py), ported line
 * for line so the collector gets the measured behaviour (278 person mentions: 73% resolved, 98.5% right; 0 of 32 false persons given
 * a QID). In order:
 *   - the exact folded key of a label, an alias or a handle; a label (or a handle) beats a less notable person's alias (an actor's
 *     name may also be a writer's pen name); an honorific goes only when a full name is left ("Princess Velma" never becomes "Velma");
 *     a full name written as one word is tried as a handle ("Kairo Venn" as "kairovenn");
 *   - score = 2 x occupation fit + log10(1 + sitelinks) / 2 + log10(1 + audience) / 7, the fit from the row's role, tier and words;
 *   - a one-word name needs occupation support ("Brimvale" in an actor story is the actor of that name; "Death" is nobody);
 *   - two or more people under the name: the top one needs a 0.5 margin and no occupation mismatch, or the name stays unresolved.
 * A unique full name is never vetoed by the row's role (the collector called comedians "creator").
 */
const { fold, handleLike } = require('./fold');

const ROLE_CLASSES = { creator: ['creator', 'streamer'], youtuber: ['creator', 'streamer'], tiktoker: ['creator'], streamer: ['streamer', 'creator'],
  actor: ['actor'], musician: ['musician'], athlete: ['athlete'], politician: ['politician'] };
const TIER_CLASSES = { creator: ['creator', 'streamer'], politics: ['politician', 'other'], sports: ['athlete'] };
const TEXT_CLASSES = [
  ['streamer', /\b(streamer|twitch|kick streamer|livestreamfail|vtuber|stream)\b/],
  ['creator', /\b(youtuber|tiktoker|tiktok star|influencer|content creator|podcaster|podcast|vlogger|youtube star|instagram star)\b/],
  ['actor', /\b(actor|actress|star of|comedian|host|sitcom|film|movie|series|dwts|dancing with the stars|strictly|model|showrunner)\b/],
  ['musician', /\b(singer|rapper|musician|band|frontman|album|concert|tour|song|music|dj)\b/],
  ['athlete', /\b(boxer|boxing|player|coach|quarterback|nfl|nba|mlb|ufc|wwe|wrestler|football|soccer|f1|driver|fight|trade rumors|athlete)\b/],
  ['politician', /\b(president|senator|senate|governor|minister|congressman|congresswoman|secretary|mp|candidate|mayor|ambassador|white house|parliament)\b/],
];
const HONORIFICS = /^(dame|sir|dr|doctor|prince|princess|president|senator|governor|pope|king|queen|lord|lady|judge|justice|cardinal|sergeant|sgt|officer|detective|coach|rev|reverend|mr|mrs|ms) /;
const MARGIN = 0.5;

/** The classes a row's context asks for: { role, tier, text } (each a Set or null; text a Set, maybe empty). */
function wanted(ctx = {}) {
  const role = String(ctx.role || '').toLowerCase();
  const tier = String(ctx.tier || '').toLowerCase();
  const text = fold(`${ctx.title || ''} ${ctx.line || ''}`);
  return {
    role: ROLE_CLASSES[role] ? new Set(ROLE_CLASSES[role]) : null,
    tier: TIER_CLASSES[tier] ? new Set(TIER_CLASSES[tier]) : null,
    text: new Set(TEXT_CLASSES.filter(([, rx]) => rx.test(text)).map(([c]) => c)),
  };
}

const prior = (p) => Math.log10(1 + (p.sitelinks || 0)) / 2 + Math.log10(1 + (p.size || 0)) / 7;

/** A candidate's score in a context: { score, compat }. */
function scoreOf(p, want) {
  const cls = p.cls || 'other';
  let compat = 0;
  if (want.role) compat += want.role.has(cls) ? 1 : -1;
  if (want.tier) compat += want.tier.has(cls) ? 0.5 : -0.5;
  if (want.text.size) compat += want.text.has(cls) ? 0.5 : 0;
  return { score: 2 * compat + prior(p), compat };
}

/** The people a name may be, as resolver v2 narrows them: Map(qid -> candidate with its type). */
function candidates(roster, name) {
  const k = fold(name);
  let c = roster.candidatesOfKey(k);
  if (!c.size) {
    const k2 = k.replace(HONORIFICS, '');
    if (k2 !== k && k2.includes(' ')) c = roster.candidatesOfKey(k2);
  }
  if (!c.size && k.includes(' ')) c = new Map([...roster.candidatesOfKey(k.replace(/ /g, ''))].filter(([, p]) => p.type === 'handle'));
  if (!c.size) return c;
  const lab = [...c.values()].filter((p) => p.type === 'label' || p.type === 'handle');
  if (lab.length) {
    const top = Math.max(...lab.map((p) => p.sitelinks || 0));
    c = new Map([...c].filter(([, p]) => p.type !== 'alias' || (p.sitelinks || 0) > top));
  }
  return c;
}

/**
 * Who `name` is in a row's context: { qid (or null), why ('resolved', 'absent', 'single-word-unsupported', 'ambiguous',
 * 'occupation-mismatch', 'no-roster'), n (candidates), cls (the person's class when resolved) }. ctx: { role, tier, title, line }.
 */
function resolve(roster, name, ctx = {}) {
  if (!roster) return { qid: null, why: 'no-roster', n: 0, cls: null };
  const c = candidates(roster, name);
  const n = c.size;
  if (!n) return { qid: null, why: 'absent', n: 0, cls: null };
  const want = wanted(ctx);
  // (best first: the score, then the fit, then the larger QID string, as the measured resolver sorts its tuples)
  const scored = [...c.values()].map((p) => ({ p, ...scoreOf(p, want) }))
    .sort((a, b) => b.score - a.score || b.compat - a.compat || (a.p.qid < b.p.qid ? 1 : a.p.qid > b.p.qid ? -1 : 0));
  const top = scored[0];
  const viaHandle = top.p.type === 'handle';
  const single = !fold(name).includes(' ') && !handleLike(name) && !viaHandle;
  if (single && top.compat <= 0) return { qid: null, why: 'single-word-unsupported', n, cls: null };
  if (n > 1) {
    if (top.score - scored[1].score < MARGIN) return { qid: null, why: 'ambiguous', n, cls: null };
    if (top.compat < 0 && !viaHandle) return { qid: null, why: 'occupation-mismatch', n, cls: null };
  }
  return { qid: top.p.qid, why: 'resolved', n, cls: top.p.cls };
}

module.exports = { resolve, candidates, wanted, scoreOf, MARGIN, HONORIFICS };
