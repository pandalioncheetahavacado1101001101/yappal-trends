'use strict';
/*
 * Word sense at the one place every word row gets its line (ios/IDEAS-SUPER.md P9, B8 in ios/.review/datasets-knowledge.md):
 * collect.js hands this cycle's rows here once the engine's, the creators' side's and the platform sources' rows are together, before
 * they are matched to trends, measured and laid out. Pure: no clock, no network, no model.
 *
 *   guard     only a row whose line is a dictionary's (read live from Wiktionary, or a sense of the word as the data file has it),
 *             or one whose searches ask what the word means. Unguarded it made "Breaking Bad" mean "to go downhill".
 *   sense     lib/sense/pick.js on the data file's senses (lib/data/word-senses.json) and what people search. A non-dictionary line
 *             from a page that defines the word (Know Your Meme, Wikipedia) stands.
 *   missing   a word the file does not have yet (it lags the live dictionary by weeks): the line read live stands, held to the same
 *             test (no usage note).
 *   register  a sense the dictionary marks offensive, vulgar or derogatory is shown as the dictionary shows it, its label first
 *             ("Vulgar slang: ..."): no content filtering, and no row is kept off page one for what its word means.
 *   abstain   a dictionary row the picker abstains on gets the dossier line (lib/sense/fallback.js: what people search, never a
 *             meaning) and is kept off page one: it no longer says what it is.
 *   formats   a format a roundup named, whose page tells what creators do in words the desk's rule does not read, gets that line.
 *
 * A line from the data file credits Wiktionary in the row's sources (CC BY-SA 4.0: lib/data/word-senses.LICENCE.md).
 */
const S = require('./store');
const P = require('./pick');
const T = require('./text');
const R = require('./register');
const FB = require('./fallback');

const DICTIONARY = 'Wiktionary';
// a line from a page that defines the word itself: better than a dictionary's sense, never replaced
const DEFINER = /know your meme|wikipedia|newengen/i;
// what a dossier line's source is called on the row: it defines nothing, so the desk keeps the row off page one (lib/desk.js saysWhatItIs)
const DOSSIER = 'searches';
const LINE_MAX = 180;

const isWordRow = (r) => !!r && (r.kind === 'word' || r.type === 'word' || r.wordish === true);
const termOf = (r) => (r.word && r.word.term) || r.subject || r.title || '';
const fromOf = (r) => (r.word && r.word.meaningFrom) || (r.platform && r.platform.from === 'wikt' ? DICTIONARY : null);

/** What people type about the word: the completions read for any of its forms (lib/platform-signals.js typedOf, kind "word"). */
function askedOf(forms, typed) {
  const words = typed && typeof typed.get === 'function' ? typed.get('word') : null;
  if (!words) return [];
  return [...new Set(forms.flatMap((f) => (words.get(f) && words.get(f).said) || []))];
}

/**
 * A dictionary sense as a card line: one sentence, capital first, a full stop, cut at a clause past LINE_MAX characters; a sense the
 * dictionary marks offensive, vulgar or derogatory carries that label first, as the dictionary prints it ("Vulgar slang: ...").
 */
function senseLine(gloss, label = '') {
  let s = String(gloss || '').replace(/\s+/g, ' ').trim().replace(/^\([^)]{1,80}\)\s*/, '');
  if (!s) return null;
  const mark = R.registerOf(label);
  const room = LINE_MAX - (mark ? mark.length + 2 : 0);
  if (s.length > room) {
    const head = s.slice(0, room);
    const at = Math.max(head.lastIndexOf('; '), head.lastIndexOf(', '));
    s = `${(at >= room / 3 ? head.slice(0, at) : head.slice(0, head.lastIndexOf(' '))).replace(/[,;:\s]+$/, '')}…`;
  }
  s = mark ? `${mark.charAt(0).toUpperCase()}${mark.slice(1)}: ${s}` : s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(s) ? s : `${s}.`;
}

/**
 * The row with a new line, its word's meaning and source said the same way everywhere the feed reads them (immutably). A dossier
 * line is no meaning: the word's meaning is then null, and the phone's idea writer is told none.
 */
function withLine(row, line, { from, says, meaning = line }) {
  const credit = (xs) => (from === DICTIONARY ? [DICTIONARY, ...(xs || []).filter((x) => x !== DICTIONARY)] : xs);
  const word = row.word ? { ...row.word, meaning, meaningFrom: from, sources: credit(row.word.sources) } : row.word;
  const point = row.point ? { ...row.point, what: line, sources: credit(row.point.sources) } : row.point;
  const platform = row.platform ? { ...row.platform, says, page: says ? row.platform.page : false } : row.platform;
  return { ...row, line, word, point, platform };
}

/** A dictionary line that stands, credited as one from the file is: Wiktionary first in the row's sources (CC BY-SA 4.0). */
function credited(row) {
  const has = (xs) => (xs || [])[0] === DICTIONARY;
  if ((!row.word || has(row.word.sources)) && (!row.point || has(row.point.sources))) return row;
  return withLine(row, row.line, { from: DICTIONARY, says: row.platform ? row.platform.says : true, meaning: row.word ? row.word.meaning : undefined });
}

/**
 * One row's line by sense, or the row as it came. data: the word-sense file (lib/sense/store.js); typed: what people type
 * (Map kind -> Map key -> { said }). Returns { row, did } (did: a note for the cycle's log, or null).
 */
function senseRow(row, { data, typed }) {
  if (!isWordRow(row)) return { row, did: null };
  // a format a roundup named that its page tells in words the desk's rule did not read
  if (row.platform && row.platform.from === 'roundup' && !row.platform.says) {
    const line = FB.formatLine(row.meta && row.meta.about);
    return line ? { row: withLine(row, line, { from: fromOf(row), says: true }), did: 'format: its roundup’s own recap' } : { row, did: null };
  }
  const term = termOf(row);
  const forms = T.formsOf(term, row.title);
  const asked = askedOf(forms, typed);
  // (the row's own title counts as a search only when it is one, a meaning question: "Red Flag meaning". An editor's title can
  // carry the very sense a wrong line gave it: "Chopped trimming")
  const searches = [...asked, T.MEANING_CUE.test(row.title || '') ? row.title : null, term].filter(Boolean);
  const from = fromOf(row);
  const line = String(row.line || '');
  const dictLine = from === DICTIONARY || P.USAGE_NOTE.test(line) || S.isGlossOf(data, forms, line);
  const asks = T.asksMeaning([...asked, row.title]);
  if (!dictLine && (!asks || DEFINER.test(from || ''))) return { row, did: null };
  const dossier = (why) => ({ row: withLine(row, FB.wordLine({ term, asked, title: row.title, why: (row.meta && row.meta.platform && row.meta.platform.why) || [] }), { from: DOSSIER, says: false, meaning: null }), did: `dossier line: ${why}` });
  const hit = S.sensesOf(data, forms);
  if (!hit) {
    if (!dictLine) return { row, did: null };
    // (the file lags the live dictionary: a word it does not have keeps the line read live, held to the same tests)
    if (!line || P.USAGE_NOTE.test(line)) return dossier('the live sense is a usage note, no meaning');
    return { row: from === DICTIONARY ? credited(row) : row, did: null };
  }
  const r = P.pick(hit.senses, searches, { term });
  if (!r.sense) return r.keep || !dictLine ? { row, did: null } : dossier(r.abstain);
  const next = senseLine(r.sense.gloss, r.sense.label);
  if (!next || T.termKey(next) === T.termKey(line)) return { row: dictLine ? credited(row) : row, did: null };
  return { row: withLine(row, next, { from: DICTIONARY, says: true }), did: `sense: ${r.why}` };
}

/**
 * The hook: a cycle's rows for one audience, each word row's line by sense. Returns { rows, notes: [{ title, did }], counts }.
 * data and typed may be left out (the shipped file; nobody's searches).
 */
function lineRows(rows, { data = null, typed = null } = {}) {
  const list = rows || [];
  if (!list.some(isWordRow)) return { rows: list, notes: [], counts: { sense: 0, dossier: 0, format: 0 } };
  const d = data || S.load();
  const notes = [];
  const out = list.map((row) => {
    const { row: next, did } = senseRow(row, { data: d, typed });
    if (did) notes.push({ title: row.title, did });
    return next;
  });
  const count = (p) => notes.filter((n) => n.did.startsWith(p)).length;
  return { rows: out, notes, counts: { sense: count('sense'), dossier: count('dossier'), format: count('format') } };
}

/** Whether the hook runs: always, unless IDEAS_SENSE is "off" (the rows then go on as they came). */
const on = (env = {}) => String(env.IDEAS_SENSE || '').trim().toLowerCase() !== 'off';

module.exports = { on, lineRows, senseRow, senseLine, withLine, askedOf, DICTIONARY, DOSSIER };
