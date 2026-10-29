'use strict';
/*
 * Soft news (wave 12, IDEAS_SOFT_NEWS): a person people search whose news is no drama, a health update, an engagement, a wedding, a
 * pregnancy or a baby, a role, an award, a tour, an album or a song, a return, an interview, had no noun and no card: a name and nothing
 * argued about it never listed, however many people searched it. Such a card is titled "<name> <family word>" ("Orla Venn engagement",
 * "Orla Venn health update") and told by the headline that says it, as the outlet wrote it and attributed to it ("Orla Venn announces
 * engagement to Bram Tolvey, Velvetline reports."), with the person's own denial when a headline carries one.
 *
 * Only when all of these hold (engine/talk-nouns.js softSaid, softRead):
 *   - measured demand: a search of the name (a Google Trends entry or our own Trends read); a name no one searches is never lifted;
 *   - a person: a creator or a celebrity (engine/talking-points.js whoOf), whose card has no noun of its own but a response or a
 *     reveal that lists nothing; a drama noun, a death or a claim always tells the card as before;
 *   - an outlet's headline in the last three days that leads with the person, named whole (a role, a show or a partner's possessive
 *     before the name at most; "<A> and <B>" for a couple's news), and says the family in the clause right after the name;
 *   - never someone else's: no other name, no one of theirs and no possessive between the name and the word ("<name> reveals husband's
 *     diagnosis" is the husband's, "<name> congratulates <other> on engagement" the other's); the name's own possessive is never its news;
 *   - never only rumoured, feared, hinted at or denied: a pregnancy, a split, a health scare or a casting the headline hedges is no title
 *     of its own; a look back ("recalls her first pregnancy") neither, but an interview may look back;
 *   - no drama family, death or claim anywhere in the headline: those are the drama families' to tell, never softened;
 *   - and the line, the subject's denial in, passes the claim check (lib/lines.js) on its own sources, as the line first's does.
 * Ranked like the bare name it was (the no-noun weight), never above it; at the talking points' cut a soft card never takes the seat of a
 * person's drama or death card, a creator's first (yieldSoft, engine/talking-points.js build): rank, never filter.
 *
 * IDEAS_SOFT_NEWS unset: on (DEFAULT_MODE); `shadow`: lists unchanged, the cycle's log counts what on would list ("[soft-news] would
 * list n (nouns m, lines l, k passing lists()); shadow"); `0`/`off`: off, nothing read. Collector only. Pure: no clock, no I/O; no new
 * source and no request: the headlines are the store's.
 */
const TN = require('../engine/talk-nouns');
const R = require('../engine/rules');
const W = require('../engine/wording');
const LF = require('./line-first');

const DEFAULT_MODE = 'on';
/** The switch: 'on' (unset: DEFAULT_MODE), 'shadow', or 'off'. */
function mode(env = process.env) {
  const v = String((env && env.IDEAS_SOFT_NEWS) || '').trim().toLowerCase();
  if (v === 'on' || v === 'act' || v === '1' || v === 'true') return 'on';
  if (v === 'shadow') return 'shadow';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return DEFAULT_MODE;
}

const PERSON_TIERS = new Set(['creator', 'celebrity']);
// (a card whose noun lists nothing on its own: a response, a reveal said plainly. Any other noun tells the card as before)
const OVER = new Set(['response', 'reveal']);
const DAYS = 3;
// (a name that is a day, an event or a place is no person, whatever its first word: "<X> Day", "<X> parade", "<city> <city>")
const NOT_PERSON = /(?:^|\s)(?:day|eve|night|week|weekend|parade|festival|fest|fair|carnival|marathon|games|cup|awards?|expo|summit|olympics|championships?|bowl|derby|tournament|conference)(?:\s|$)/i;
const SATIRE = /^(?:the )?(?:onion|babylon bee|clickhole|daily mash|newsthump|reductress|beaverton|waterford whispers(?: news)?|hard times|hard drive|borowitz report)$/i;
const BLOG = /livejournal|blogspot|substack|tumblr|wordpress|medium\.com|quora|\breddit\b/i;
const NO_ACCOUNT = /\?|\b(?:explained|what happened|what to know|what we know|everything (?:we know|to know)|here['’]s (?:why|what|how|everything)|timeline|live (?:updates?|blog)|watch live|how to watch|where to (?:watch|stream)|you won['’]t believe|the internet (?:is|can['’]t)|fans (?:are )?(?:losing it|can['’]t))\b|^(?:\d+|every|all the)\s/i;
const WORDS_MIN = 6;
const WORDS_MAX = 24;
const CHARS_MAX = 200;

/** Why a headline cannot word a soft card's line, or null when it can (the line first's outlet rules, then the soft reading itself). */
function refusal(row, { subject, family }) {
  if (!row || !row.title) return 'none';
  if (row.youtube || row.fam === 'reddit' || row.fam === 'bluesky') return 'not an outlet';
  if (row.far) return 'far region';
  if (row.blocked) return 'blocked outlet';
  const outlet = String(row.outlet || '').trim();
  if (!outlet || /^google news$/i.test(outlet) || SATIRE.test(outlet) || BLOG.test(outlet)) return 'no outlet to name';
  const line = TN.cleanHeadline(row.title, row.outlet);
  const ws = W.words(line);
  if (ws.length < WORDS_MIN || ws.length > WORDS_MAX || line.length > CHARS_MAX || /…|\.\.\.$/.test(line)) return 'length';
  if (NO_ACCOUNT.test(line) || TN.QUESTION.test(line) || TN.EXPLAINED.test(line)) return 'no account';
  const said = TN.softSaid(line, subject);
  if (!said || said.f.key !== family.key) return 'not said';
  if (LF.someoneElses(line, subject)) return 'someone else of theirs';
  return null;
}

/**
 * The soft noun of a card, or null: { noun, line } where noun is the card's noun ({ f, noun, count, share, explained, soft, wave }) and
 * line the attributed account ({ what, denied, trace }). c: the candidate; ev: its evidence (engine/talking-points.js evidenceOf);
 * near: its name; o: { now, lex, tier }.
 */
function nounOf(c, ev, near, { now = 0, lex = null, tier = null } = {}) {
  if (!c || !ev || !near || !Array.isArray(c.trends) || !c.trends.length || c.parent || c.generic) return null;
  if (!TN.personLike(near, lex) || NOT_PERSON.test(near) || R.isPlaceOrTeam(near)) return null;
  if (tier !== null && !PERSON_TIERS.has(tier)) return null;
  const read = TN.softRead(ev.rows, near, { now, days: DAYS });
  if (!read) return null;
  // (a headline of the store in which the person denies it: the line carries the denial, as every claim's line does)
  const surface = TN.nameSurface(near, ev.rows.filter((r) => !r.blocked).map((r) => r.title));
  // (a sentence-case headline first: a Title Case one is recased word by word, and a show's or an outlet's name may not survive it)
  const plain = read.rows.filter((r) => !W.isTitleCase(TN.cleanHeadline(r.title, r.outlet).split(/\s+/)));
  const made = LF.lineOf(plain.length ? plain : read.rows, { subject: near, surface, family: read.f, lex, title: `${surface} ${read.noun}`, refuse: refusal, deniable: true, denials: ev.rows });
  if (!made || !made.what) return null;
  const titles = ev.rows.length || 1;
  return { noun: { f: read.f, noun: read.noun, count: read.count, share: read.count / titles, explained: 0, soft: true, wave: true },
    line: { what: made.what, denied: made.denied, trace: made.trace, unsaid: false } };
}

/**
 * The order at the talking points' cut (`max` cards) with every person's drama or death card a soft card pushed under it lifted back
 * above it: the soft card waits just under the cut instead (one card for one soft card, the lowest soft card first). A creator's story
 * first among them, and any card the list tags drama; a card whose noun is a drama family or a death too, whatever its tag or tier (a
 * small creator's ban told by one far outlet is not tagged drama). Rank, never filter: nothing leaves the order. order: the points by
 * heat, each { noun, out }. -> { all, yielded }.
 */
const KEPT_FAMS = new Set([...TN.DRAMA_FAMS, 'death']);
function yieldSoft(order, max) {
  const isSoft = (p) => !!(p && p.noun && p.noun.soft);
  const creatorDrama = (p) => !!(p && p.out && (p.out.drama || (p.noun && p.noun.f && KEPT_FAMS.has(p.noun.f.key))));
  const head = order.slice(0, max);
  if (!head.some(isSoft)) return { all: order, yielded: 0 };
  // (the creator cards the cut would have kept with no soft card above them)
  const owed = order.filter((p) => !isSoft(p)).slice(0, max).filter((p) => creatorDrama(p) && !head.includes(p));
  if (!owed.length) return { all: order, yielded: 0 };
  const out = order.filter((p) => !owed.includes(p));
  let yielded = 0;
  for (const p of owed) {
    const soft = out.slice(0, max).filter(isSoft).pop();
    if (!soft) break;
    out.splice(out.indexOf(soft), 1);
    out.splice(max - 1, 0, p);
    out.splice(max, 0, soft);
    yielded += 1;
  }
  // (and any the soft cards left could not seat keeps its place in the order after them)
  for (const p of owed) if (!out.includes(p)) out.splice(Math.min(out.length, order.indexOf(p)), 0, p);
  return { all: out, yielded };
}

// what each audience's last build would list (engine/talking-points.js): read once by the cycle for its log line, then cleared
let REPORTS = new Map();
const report = (audience, r) => { REPORTS.set(String(audience || 'US'), r); };
const takeReports = () => { const out = REPORTS; REPORTS = new Map(); return out; };
/** The cycle's log line: counts only (the job's log is public). */
function logLine(reports, main = 'US') {
  const r = reports.get(main) || [...reports.values()][0];
  if (!r) return null;
  const fams = Object.entries(r.families || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${k} ${n}`).join(', ');
  return `[soft-news] ${r.mode === 'on' ? 'listed' : 'would list'} ${r.would} (nouns ${r.made}${fams ? `: ${fams}` : ''}; ${r.passed} passing lists(); held under the cut for creator drama ${r.yielded || 0}); ${r.mode}`;
}

module.exports = { mode, nounOf, refusal, yieldSoft, report, takeReports, logLine, DEFAULT_MODE, PERSON_TIERS, OVER };
