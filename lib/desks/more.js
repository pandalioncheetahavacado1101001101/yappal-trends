'use strict';
/*
 * The cards under the cut, as rows past the main list (wave 12, the depth lane; ios/IDEAS-FEED.md D3 `more`): the engine weighs about
 * 180 talking points an audience, every one through lists()' title, line and claim rules, and lists the first forty by heat (and the
 * people-drama just under them); the other 110-125 passed every rule and were dropped (the frozen 2026-10-12 state, five lists). Here
 * they become an extension desk (lib/extension.js), each row in the section `more`, after the main list's own rows past its 80:
 * measured in the extension's own history step (a card whose trend a main row holds is that row's story and is left out), held to the
 * extension's freshness budget like every row there (begun under 72 hours, a chapter inside 48, still searched), and titled and
 * respelt as every row (collect.js extLined). The main list never sees them: ranks 1-80 are the same with or without this desk.
 *
 * A row is made as lib/rows.js makes a talking point's: the engine's own hot-list entry for it (engine/hot-list.js, which also leaves out
 * a card fading past its days), its line the card's (lists() passed it). One a subject: a card whose subject a main row already names is
 * left to that row. Then the desk's edit (lib/desk.js `edit`, collect.js hands it in as `edit`) over the main list's engine rows and
 * these together, exactly as the main rows had it: a bare name, a placeholder, a one-sided feud or a word with no line is no row; a
 * title is made no surer than its headlines; a card that is the same story as a row above it goes. Nothing here is drama-ranked, Early
 * or urgent (the extension never is), nothing is read (+0 requests).
 *
 * A grave noun (death, execution, verdict, sentencing, arrest, shooting, stabbing, attack, firing, exit) stands only when one of the
 * card's headlines says it of the title's own name (engine/grave-own.js): a card the cut hid whose grave word is someone else's (the name
 * wounded where another was killed, the speaker of another's sentence, an opinion called a verdict) is no row, as before this desk.
 *
 * Off: IDEAS_KINDS_OFF=more (or "all"); IDEAS_EXTENSION=0 turns the whole extension off.
 */
const HL = require('../../engine/hot-list');
const GO = require('../../engine/grave-own');
const ROWS = require('../rows');
const D = require('../describe');
const { keyOf } = require('../util');

const SECTION = 'more';
// (the list's main rows, lib/extension.js MAIN_ROWS: no row here is among them)
const MAIN_ROWS = 80;
const ROWS_MAX = 80;

/** Whether the desk is off: IDEAS_KINDS_OFF names "more" or "all". */
const offOf = (env = {}) => String(env.IDEAS_KINDS_OFF || '').split(',').map((x) => x.trim().toLowerCase()).some((x) => x === 'more' || x === 'all' || x === '1');

// (a noun its own headlines do not say: "<name> <month> comments" over attending a vigil, "<name> <place> performance" over a
// cancellation. The cut hid these cards, so no review read them; past 80 they need their word said)
const SAID_WORDS = { comments: /\b(?:comments?|remarks?|says?|said|statement|words|posts?|posted|tweets?|tweeted|told|tells|claims?|calls?|called|slams?|blasts?)\b/i,
  remarks: /\b(?:comments?|remarks?|says?|said|statement|words|posts?|posted|tweets?|tweeted|told|tells|claims?|calls?|called|slams?|blasts?)\b/i };
const CALLED_OFF = /\b(?:cancel(?:s|led|ed|ling|ation)?|postpone[sd]?|called off|calls off|pulls? out|pulled out|scrap(?:s|ped))\b/i;
function nounSaid(p) {
  const noun = String(p.noun || '').toLowerCase().split(/\s+/).pop();
  const texts = [p.what, p.latest && p.latest.text, ...((p.trace || []).map((t) => t && t.text))].filter(Boolean).join(' \n ');
  if (SAID_WORDS[noun]) return SAID_WORDS[noun].test(texts);
  if (noun === 'performance') return !CALLED_OFF.test(String(p.what || ''));
  return true;
}
/** Whether a card's grave noun, if any, is said of its own subject (engine/grave-own.js), and its noun said at all; a card that throws
 * there is no row. */
const graveOk = (p) => { try { return GO.graveOwn(p) && nounSaid(p); } catch { return false; } };
// (and past 80 no grave card at all: on the first live pass, 2026-10-29 11:00Z, the guard let through a name's fragment over a private
// person's obituary as "<fragment> death", a resignation titled "<name> firing" and a place given an "arrest". Deaths have their own
// section, Remembered, and the main list keeps its grave cards; the cards under the cut no longer reach rows 81-160 with one)
const graveCard = (p) => { try { return !!GO.graveOf(String(p.noun || '')) || !!GO.graveOf(String(p.title || '').trim().split(/\s+/).pop()); } catch { return true; } };

/** The subjects the audience's rows already name (a talking point's subject, its surface, its title's own name). */
function namedOf(rows) {
  const keys = new Set();
  for (const r of rows || []) for (const k of [keyOf(r.subject || ''), keyOf(r.surface || ''), keyOf(D.ownName(r.title || ''))]) if (k && k.length >= 3) keys.add(k);
  return keys;
}

/**
 * The desk's rows for one audience: ctx { audience, rows (the audience's main rows as made), built (the engine's build: byAudience[a]
 * carries `overflow`, the cards under the cut; words and moments), now (ms), rankFrom, edit ((rows) => the rows of them the desk's
 * edit keeps, made over the main engine rows and these: collect.js) }. ROWS_MAX at most, heat order, each with section `more` and
 * `overflowRow`. [] while the main list is short of its 80 (the extension would lay a row inside ranks 1-80).
 */
function rows(ctx) {
  const { audience = 'US', built = null, now = Date.now() } = ctx || {};
  if (!built || !built.byAudience || (ctx.rows || []).length < MAIN_ROWS) return [];
  const over = (built.byAudience[audience] && built.byAudience[audience].overflow) || [];
  if (!over.length) return [];
  const named = namedOf(ctx.rows);
  const fresh = over.filter((p) => p && p.title && !named.has(keyOf(p.subject || '')) && !named.has(keyOf(D.ownName(p.title))) && !graveCard(p) && graveOk(p));
  // (the engine's own entries: its kinds, heats and statuses, a card fading past its days left out; no page rules apply past rank 80)
  const hot = HL.hotList({ talkingPoints: fresh, words: [], moments: [] }, { now, audience });
  const made = ROWS.rowsOf(audience, { talkingPoints: fresh, hot }, { words: built.words || [], moments: built.moments || [] }).map((r) => ({ ...r, section: SECTION, overflowRow: true }));
  const edited = typeof ctx.edit === 'function' ? ctx.edit(made).filter((r) => r && r.overflowRow) : made;
  let rank = Number.isFinite(ctx.rankFrom) ? ctx.rankFrom : 1 + (ctx.rows || []).reduce((m, r) => Math.max(m, r.engineRank || 0), 0);
  return edited.slice(0, ROWS_MAX).map((r) => ({ ...r, engineRank: rank++, section: SECTION, overflowRow: true }));
}

/** Counts for the cycle's log: cards under the cut, rows made. Never a title. */
const census = (built, audience, made = []) => {
  const over = (built && built.byAudience && built.byAudience[audience] && built.byAudience[audience].overflow) || [];
  return { under: over.length, rows: made.filter((r) => r && r.overflowRow).length, grave: over.filter((p) => p && p.title && (graveCard(p) || !graveOk(p))).length };
};

module.exports = { SECTION, ROWS_MAX, offOf, rows, census, namedOf, graveOk, graveCard };
