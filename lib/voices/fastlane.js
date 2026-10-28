'use strict';
/*
 * The fast lane (wave 9; plan #1): a person's news story lists at its first two independent voices, before the press volume the
 * other gates wait for. A voice is a source family that told the story's own chapter (a headline naming the person and saying the
 * card's noun, never a noun the headline gives to someone else): one outlet (outlets the store shows publishing together are one
 * voice, lib/voices/syndication.js), the boards (Reddit's own listings; a mirror post only once it survived a re-read,
 * lib/voices/boards.js), Bluesky, creators' uploads. One voice is enough only for a (voice, noun) pair whose measured hit rate is
 * RATE_MIN or more on RATE_N or more stories (`rates`, learned privately; empty until then).
 *
 * Rank, never filter: the lane only opens the demand gates for a young chapter. Every title, line and claim rule of lists() still
 * applies, the Early caps are unchanged (3 on page one, 12 a list, 36 hours) and nothing is ever removed.
 *
 * IDEAS_FASTLANE unset: shadow (the build reports what it would list, nothing changes; the board reads add posts to the boards' private
 * record only, and the Reddit survival re-read waits for act); `act`: it lists; `0` or `off`: off, with every board read
 * (lib/voices/boards.js offOf).
 * Collector only, wave 9. needs license: Reddit, needs permission: Reddit (board voices: lib/voices/boards.js).
 */
const TN = require('../../engine/talk-nouns');
const { outletKey } = require('../../engine/util');
const SYN = require('./syndication');

const HOUR = 3600e3;
// (a chapter is young while its first own headline is inside the Early tag's 36 hours: C3)
const CHAPTER_MS = 36 * HOUR;
const RATE_MIN = 0.5;
const RATE_N = 20;
const PERSON_TIERS = new Set(['creator', 'celebrity']);
const FAMS = new Set([...TN.DRAMA_FAMS, 'death']);

/** The switch: 'shadow' (unset), 'act', or 'off'. */
function mode(env = process.env) {
  const v = String((env && env.IDEAS_FASTLANE) || '').trim().toLowerCase();
  if (v === 'act' || v === 'on' || v === '1') return 'act';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return 'shadow';
}

/** Whether a point is a person's news: a creator or a celebrity, and a drama noun or a death. */
const personNews = (p) => !!p && !!p.c && !!p.noun && !!p.noun.f && FAMS.has(p.noun.f.key) && !!p.out && PERSON_TIERS.has(p.out.tier);

const keyOf = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const named = (title, last) => ` ${keyOf(title)} `.includes(` ${last} `);

/** The voice a row speaks for: 'forum', 'social', 'video', 'o:<outlet's voice>', or null (a blocked or far outlet's copy). */
function voiceOf(r, table) {
  if (!r) return null;
  if (r.fam === 'reddit') return 'forum';
  if (r.fam === 'bluesky') return 'social';
  if (r.youtube) return 'video';
  if (r.blocked || !r.outlet || /^google news$/i.test(r.outlet)) return null;
  const k = outletKey(r.outlet);
  if (!k || (table && table.rehost(k))) return null;
  return `o:${table ? table.voiceOf(k) : k}`;
}

/**
 * A point's own chapter and its voices at `now`: { young, first (ms), voices: [{ voice, t }] earliest first, two (ms when the
 * second voice spoke, or null) }. boards: board posts that survived ([{ t, title }]), counted as the forum's voice.
 */
function voicesOf(p, now, { table = null, boards = [] } = {}) {
  const f = p.noun.f;
  const subject = String(p.subject || p.c.key || '');
  const last = keyOf(subject).split(' ').slice(-1)[0];
  if (!last) return { young: false, first: null, voices: [], two: null };
  const own = [...((p.ev && p.ev.rows) || []), ...boards.map((b) => ({ ...b, fam: 'reddit' }))]
    .filter((r) => Number.isFinite(r.t) && r.t <= now && named(r.title, last) && TN.says(r.title, f) && !TN.othersSaid(r.title, f, subject));
  if (!own.length) return { young: false, first: null, voices: [], two: null };
  const first = Math.min(...own.map((r) => r.t));
  const young = now - first <= CHAPTER_MS;
  // (a headline another outlet printed first, word for word, is the first printer's voice: a re-host is no second voice)
  const printed = new Map();
  for (const r of [...own].sort((a, b) => a.t - b.t)) {
    const k = SYN.copyKey(r.title);
    if (k && !printed.has(k)) printed.set(k, r);
  }
  const by = new Map();
  for (const r of own) {
    const k = SYN.copyKey(r.title);
    const v = voiceOf(k && printed.has(k) ? printed.get(k) : r, table);
    if (v && (!by.has(v) || by.get(v) > r.t)) by.set(v, r.t);
  }
  const voices = [...by.entries()].map(([voice, t]) => ({ voice, t })).sort((a, b) => a.t - b.t || a.voice.localeCompare(b.voice));
  return { young, first, voices, two: voices.length >= 2 ? voices[1].t : null };
}

/** The (voice kind, noun) key a hit rate is kept under: an outlet's own voice, or the family of the rest. */
const rateKey = (voice, noun) => `${voice}|${noun}`;
const rateOk = (rates, voice, noun) => {
  const r = rates && typeof rates.get === 'function' ? rates.get(rateKey(voice, noun)) : null;
  return !!r && r.n >= RATE_N && r.hits >= RATE_MIN * r.n;
};

/**
 * The lane's verdict for a point at `now`: { person, young, voices (count), rule: 'two' | 'one' | null, at (ms the rule was met) }.
 * A person's news, its chapter young, met by two independent voices, or by one whose (voice, noun) pair hits often enough.
 */
function verdictOf(p, now, opts = {}) {
  if (!personNews(p)) return { person: false, young: false, voices: 0, rule: null, at: null };
  const v = voicesOf(p, now, opts);
  const base = { person: true, young: v.young, voices: v.voices.length, first: v.first, rule: null, at: null, families: v.voices.map((x) => x.voice) };
  if (!v.young) return base;
  if (v.two !== null) return { ...base, rule: 'two', at: v.two };
  const one = v.voices.find((x) => rateOk(opts.rates, x.voice, p.noun.f.key));
  return one ? { ...base, rule: 'one', at: one.t } : base;
}

/** The table a build learns from its store's name searches (lib/voices/syndication.js), with totals for the log. */
const tableOf = (lookups) => SYN.tableOf(lookups);

// what each audience's last build would list (engine/talking-points.js fastLane): read once by the cycle for its log line and the
// private voice log, then cleared
let REPORTS = new Map();
const report = (audience, r) => { REPORTS.set(String(audience || 'US'), r); };
const takeReports = () => { const out = REPORTS; REPORTS = new Map(); return out; };

module.exports = { mode, personNews, voiceOf, voicesOf, verdictOf, rateKey, rateOk, tableOf, report, takeReports, CHAPTER_MS, RATE_MIN, RATE_N, FAMS };
