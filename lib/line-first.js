'use strict';
/*
 * The line first (wave 10, IDEAS_LINE_FIRST): a person's news card whose composed line (engine/talk-nouns.js whatOf) cannot be
 * built yet is told by the first headline that names the person whole and says the card's noun, kept as the outlet wrote it and
 * attributed to it ("Streamer Plonvy Draske accused of faking charity stream, Velvetline reports."). The composed line replaces it
 * the build it can be built: this is only what stands until then.
 *
 * Never a looser line, only an attributed one. A headline words this line only when:
 *   - it names the person whole (every word of a two-word name, or the handle), not only a surname another given name may carry;
 *   - it says the card's noun of that person: never a noun it gives to someone else (talk-nouns.js othersSaid), never one the person
 *     only watches, mourns or reacts to (onlooker), never one only rumoured ("arrest rumours"), never a death it doubts;
 *   - it is no relative's or helper's story: the person's name is not a possessive before someone of theirs ("Plonvy Draske's
 *     brother ..."), and no other given name carries the person's surname in it;
 *   - it is an outlet's headline the card may quote: no upload, no board post, no far region's outlet, no satire, no question, no
 *     explainer, no list, no cut headline; a blocked outlet only for the creators' world, as the composed line allows;
 *   - and the account itself, denial in, passes the claim check (lib/lines.js) on its own sources (the attribution names the source).
 * A claim the headline states flat is reported by the attribution itself; the subject's denial, when a headline of the store carries
 * one, follows as the composed line words it ("; Draske denies it").
 *
 * And the headline itself first (engine/talking-points.js evidenceOf `borrow`): a person people search whose own name search has not
 * answered yet is told by the headlines the other names' searches already hold that lead with them, whole name in the first words
 * ("Mara Quell accused of bullying co-stars ..." in another name's results); only for a person's news (a creator's or a celebrity's
 * drama noun or death): any other card of such a name is weighed as without them. +0 requests: the rows are already in the store.
 *
 * IDEAS_LINE_FIRST unset: shadow (lists unchanged; the cycle's log counts what on would list: "[line-first] would list n (lines made m,
 * k passing lists()); unsearched people another name's search names b, would list w; shadow"); `on`/`act`/`1`: both stand and the card
 * lists through every other gate of lists(); `0`/`off`: off. Collector only. Pure: no clock, no I/O. No new source and no request: the
 * lent rows are the other name searches' own results, already read.
 */
const TN = require('../engine/talk-nouns');
const TL = require('../engine/talk-lines');
const W = require('../engine/wording');

// (the checks lib/lines.js holds; required when first asked: lib/line-rules.js requires engine/talking-points.js, which requires this)
let LINES = null;
const lines = () => { if (!LINES) LINES = require('./lines'); return LINES; };

/** The switch: 'shadow' (unset), 'on', or 'off'. */
function mode(env = process.env) {
  const v = String((env && env.IDEAS_LINE_FIRST) || '').trim().toLowerCase();
  if (v === 'on' || v === 'act' || v === '1' || v === 'true') return 'on';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return 'shadow';
}

const PERSON_TIERS = new Set(['creator', 'celebrity']);
const FAMS = new Set([...TN.DRAMA_FAMS, 'death']);
/** Whether a card is a person's news: a creator's or a celebrity's, under a drama noun or a death (the fast lane's own reading). */
const personNews = (tier, family) => PERSON_TIERS.has(tier) && !!family && FAMS.has(family.key);

const SATIRE = /^(?:the )?(?:onion|babylon bee|clickhole|daily mash|newsthump|reductress|beaverton|waterford whispers(?: news)?|hard times|hard drive|borowitz report)$/i;
const BLOG = /livejournal|blogspot|substack|tumblr|wordpress|medium\.com|quora|\breddit\b/i;
// (what is no account of what happened: a question, an explainer, a list, a page to watch, a teaser that withholds it)
const NO_ACCOUNT = /\?|\b(?:explained|what happened|what to know|what we know|everything (?:we know|to know)|here['’]s (?:why|what|how|everything)|timeline|live (?:updates?|blog)|watch live|how to watch|where to (?:watch|stream)|you won['’]t believe|the internet (?:is|can['’]t)|fans (?:are )?(?:losing it|can['’]t))\b|^(?:\d+|every|all the)\s/i;
// (a death only a doubt tells: "Is <name> dead?", "death hoax", "fans fear ...")
const DEATH_DOUBT = /\b(?:hoax\w*|rumou?r\w*|fear\w*|unconfirmed|unverified|alive|not dead|isn['’]t dead|false|fake\w*|speculat\w*|reportedly)\b/i;
// someone of the person's: "<name>'s brother / lawyer / ex ..."
const THEIRS = /^(?:daughter|son|wife|husband|mother|mom|mum|father|dad|sister|brother|family|lawyer|lawyers|attorney|attorneys|rep|representative|spokesperson|team|camp|fans|ex|partner|girlfriend|boyfriend|fianc[eé]e?|friend|friends|kids|children|parents|manager|assistant|bodyguard|stepdaughter|stepson|stepmother|stepfather|niece|nephew|cousin|uncle|aunt|grandmother|grandfather|grandson|granddaughter|widow|widower)$/i;
const WORDS_MIN = 6;
// (a headline's own attribution at its end: ", family says", ", crew members allege", ", ex-assistant says in new interview")
const OWN_SAYS = /,\s+(?:[\p{L}\p{N}’'.-]+\s+){0,3}(?:says?|said|alleges?|alleged|claims?|claimed|reports?|reported)(?:\s+[\p{L}\p{N}’'.-]+){0,4}$/iu;
// (a heading of four words at most before a colon, and the sentence after it)
const LABEL = /^(?:[^:]{2,40}):\s+(\p{Lu}.*)$/u;
const WORDS_MAX = 24;
const CHARS_MAX = 200;
// (a name's whole run in a headline's words, and the words a headline is read by)
const wordsOf = (s) => W.words(String(s || ''));
const at = (ws, name) => { const nw = name.split(' '); for (let i = 0; i + nw.length <= ws.length; i++) if (nw.every((w, j) => ws[i + j] === w)) return i; return -1; };

/** Whether the person's first mention is a possessive before someone of theirs, or their surname follows another given name. */
function someoneElses(line, subject) {
  const sw = subject.split(' ');
  const last = sw[sw.length - 1];
  const toks = String(line).split(/\s+/);
  const bare = (t) => String(t || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}’']+$/gu, '');
  for (let i = 0; i < toks.length; i++) {
    const b = bare(toks[i]);
    const k = b.replace(/[’']s$/i, '').toLowerCase();
    if (k !== last) continue;
    // (another capitalised given name right before the surname, the person's own given name not: a relative or a namesake)
    const prev = bare(toks[i - 1]);
    if (sw.length > 1 && /^\p{Lu}\p{Ll}+$/u.test(prev) && prev.toLowerCase() !== sw[sw.length - 2] && (W.isFirstName(prev.toLowerCase()) || !W.inDict(prev.toLowerCase()))) return true;
    if (/[’']s$/i.test(b)) {
      const next = bare(toks[i + 1]).toLowerCase().replace(/[’']s$/, '');
      const next2 = bare(toks[i + 2]).toLowerCase().replace(/[’']s$/, '');
      // ("<name>'s ex-wife", "<name>'s former manager")
      if (THEIRS.test(next) || THEIRS.test(next.replace(/^ex-/, '')) || (/^(?:former|late|longtime|estranged|own|younger|older|eldest|youngest)$/.test(next) && THEIRS.test(next2))) return true;
    }
    return false;
  }
  return false;
}

/** A headline told without a heading before its colon when what follows names the person whole: "Feud: <name> ..." is "<name> ...". */
function toldOf(head, subject) {
  const label = String(head || '').match(LABEL);
  return label && at(wordsOf(label[1]), subject) >= 0 && wordsOf(label[1]).length >= WORDS_MIN ? label[1] : String(head || '');
}

/** The headline's first real match of the family, as talk-nouns.js reads one: { f, surface, index } or null. */
function familyAt(text, family) {
  const m = TN.saidIn(text, family);
  return m ? { f: family, surface: m[0], index: m.index } : null;
}

/**
 * Why a headline cannot word the card's line first, or null when it can. row: { title, outlet, t, blocked, far, youtube, fam };
 * o: { subject, family, creatorWorld }.
 */
function refusal(row, { subject, family, creatorWorld = false }) {
  if (!row || !row.title) return 'none';
  if (row.youtube || row.fam === 'reddit' || row.fam === 'bluesky') return 'not an outlet';
  if (row.far) return 'far region';
  if (row.blocked && !creatorWorld) return 'blocked outlet';
  const outlet = String(row.outlet || '').trim();
  if (!outlet || /^google news$/i.test(outlet) || SATIRE.test(outlet) || BLOG.test(outlet)) return 'no outlet to name';
  const line = toldOf(TN.cleanHeadline(row.title, row.outlet), subject);
  const ws = wordsOf(line);
  if (at(ws, subject) < 0) return 'not named whole';
  if (ws.length < WORDS_MIN || ws.length > WORDS_MAX || line.length > CHARS_MAX || /…|\.\.\.$/.test(line)) return 'length';
  if (NO_ACCOUNT.test(line) || TN.QUESTION.test(line) || TN.EXPLAINED.test(line)) return 'no account';
  const x = familyAt(line, family);
  if (!x) return 'no noun';
  if (TN.othersSaid(line, family, subject)) return 'noun given to someone else';
  if (TN.onlooker(line, x, subject)) return 'an onlooker';
  if (TN.rumoured(line, x)) return 'only rumoured';
  if (family.key === 'death' && DEATH_DOUBT.test(line)) return 'a doubted death';
  if (someoneElses(line, subject)) return 'someone else of theirs';
  return null;
}

const DENIABLE = TN.DENIABLE;
/**
 * The card's line from the first headline that may word it, attributed, with the denial a headline of the store carries; or null.
 * rows: the card's evidence rows (engine/talking-points.js evidenceOf); o: { subject, surface, family, lex, creatorWorld, title }.
 * (wave 12, lib/line-soft.js: `refuse` a refusal of its own for another reading of the headline, `deniable` the denial asked for
 * whatever the family, `denials` the rows a denial is looked for in, the card's own by default)
 * -> { what, denied, trace, outlet, t, why } (why: the refusals counted, for the kit).
 */
function lineOf(rows, { subject, surface = null, family, lex = null, creatorWorld = false, title = null, refuse = null, deniable = null, denials = null } = {}) {
  if (!family || !subject || !Array.isArray(rows)) return null;
  const why = {};
  const ok = [];
  for (const r of [...rows].sort((a, b) => a.t - b.t || String(a.title).localeCompare(String(b.title)))) {
    const no = (refuse || refusal)(r, { subject, family, creatorWorld });
    if (no) { why[no] = (why[no] || 0) + 1; continue; }
    ok.push(r);
  }
  const last = subject.split(' ').slice(-1)[0];
  const name = surface ? surface.split(' ').slice(-1)[0] : last;
  for (const r of ok) {
    const head = TN.cleanHeadline(r.title, r.outlet);
    const titleCase = W.isTitleCase(head.split(/\s+/));
    // (as the outlet wrote it: its words, in the card's sentence case and its spelling of the name; a label before a colon, a soundbite
    // and a tabloid's tail off, as every line has them off: "Feud: <name> ..." is "<name> ...")
    const told = toldOf(head, subject);
    let core = TN.sentenceLine(TL.plainWords(TL.plainLine(TN.withoutSpeech(told), null, subject, null)).replace(/[.!]+(['’"”]?)$/, '$1'), lex, titleCase);
    if (surface) core = TN.recaseName(core, subject, surface);
    core = TL.tidyLine(core);
    const outlet = String(r.outlet).trim();
    // (a headline that already says who says it is led by the outlet instead: "Velvetline reports: <name> dies at 31, family says")
    const said = OWN_SAYS.test(core) ? `${outlet} reports: ${core}` : `${core}, ${outlet} reports`;
    // (the attribution reports a flat claim: the line pick's own reading of reported wording must agree, else "according to")
    const led = said.startsWith(`${outlet} reports: `);
    const attributed = TN.statesClaim(core, family, last) && !led && !TN.REPORTED.test(said) ? `${core}, according to ${outlet}` : said;
    // (the subject's denial, as the composed line words it: never a relative's, never someone else's)
    let denial = null;
    if ((deniable === null ? DENIABLE.has(family.key) : deniable) && !TN.DENIAL.test(core)) {
      for (const d of denials || rows) {
        if (d === r || d.youtube || d.fam === 'reddit' || d.fam === 'bluesky' || d.far) continue;
        const text = TN.cleanHeadline(d.title, d.outlet);
        if (!(family.re.test(text) || /\b(?:claims?|allegations?|accusations?|rumou?rs?|charges)\b/i.test(text))) continue;
        const clause = TN.denialClause(text, subject, null, name);
        if (clause) { denial = { clause, row: d }; break; }
      }
    }
    const what = `${attributed}${denial ? `; ${denial.clause}` : ''}.`;
    const sources = [{ text: head, type: 'outlet', outlet, t: r.t }, ...(denial ? [{ text: TN.cleanHeadline(denial.row.title, denial.row.outlet), type: 'outlet', outlet: denial.row.outlet, t: denial.row.t }] : [])];
    // (the claim check, on the account itself: the attribution names the outlet the source is, never a claim of its own)
    const check = lines().checkLine({ line: `${core}${denial ? `; ${denial.clause}` : ''}.`, title: title || `${surface || subject} ${family.key}`, subject, family: family.key, sources,
      denied: !!denial, kind: 'headline', headline: null });
    const flatOk = !check.ok && check.failures.every((x) => x.rule === 8) && (led || TN.REPORTED.test(attributed));
    if (!check.ok && !flatOk) { why.check = (why.check || 0) + 1; continue; }
    return { what, denied: !!denial, outlet, t: r.t, why, unsaid: false,
      trace: [{ source: outlet, t: r.t, text: r.title }, ...(denial ? [{ source: denial.row.outlet, t: denial.row.t, text: denial.row.title }] : [])] };
  }
  return { what: null, why };
}

// what each audience's last build would list (engine/talking-points.js): read once by the cycle for its log line, then cleared
let REPORTS = new Map();
const report = (audience, r) => { REPORTS.set(String(audience || 'US'), r); };
const takeReports = () => { const out = REPORTS; REPORTS = new Map(); return out; };
/** The cycle's log line: counts only (the job's log is public). */
function logLine(reports, main = 'US') {
  const r = reports.get(main) || [...reports.values()][0];
  if (!r) return null;
  if (r.mode === 'on') return `[line-first] listed ${r.would} (lines made ${r.made}, ${r.passed} passing lists()); listed cards another name's search told ${r.borrowed}; on`;
  return `[line-first] would list ${r.would} (lines made ${r.made}, ${r.passed} passing lists()); unsearched people another name's search names ${r.borrowed}, would list ${r.borrowWould}; shadow`;
}

module.exports = { mode, personNews, refusal, lineOf, someoneElses, report, takeReports, logLine, FAMS };
