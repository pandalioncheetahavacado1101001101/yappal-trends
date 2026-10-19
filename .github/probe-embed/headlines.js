'use strict';
/*
 * Invented headlines for the embedding probe (ios/IDEAS-SUPER.md P8): people who do not exist, made from syllables by a seeded
 * generator, each with two stories of different kinds (an accusation and a record stream, a split and a leak), each story told by
 * many headlines in different words. Nothing here is a real person, a real story or anything the collector read: the probe runs on a
 * public runner and publishes numbers only.
 *
 *   headlines({ people: 50, perStory: 20, seed }) -> [{ text, person, story, kind }]   (people x 2 x perStory headlines)
 *
 * Same seed, same headlines, on every machine.
 */

/** Seeded uniform numbers in [0, 1): mulberry32. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_A = ['Ta', 'Ve', 'Mor', 'Kas', 'Liv', 'Brin', 'Sel', 'Dar', 'Fen', 'Jor', 'Quil', 'Ras', 'Tov', 'Wen', 'Zar', 'Oph', 'Ny', 'Cael'];
const FIRST_B = ['ren', 'ia', 'o', 'an', 'ix', 'ella', 'us', 'ine', 'ar', 'eth', 'ani', 'ory'];
const LAST_A = ['Hal', 'Corv', 'Mard', 'Pell', 'Strand', 'Vey', 'Okon', 'Lum', 'Tarr', 'Brisk', 'Quen', 'Ashe', 'Dov', 'Fral'];
const LAST_B = ['wick', 'ley', 'ston', 'more', 'dell', 'ford', 'ane', 'by', 'ett', 'worth', 'ock', 'rin'];

// {N} the person, {S} their surname, {O} another invented person, {X} a number, {W} a word of the kind's own
const KINDS = {
  accusation: { words: ['bullying', 'stealing clips', 'faking a charity stream', 'harassing staff', 'lying to fans'], t: [
    '{N} accused of {W} by a former friend', '{O} makes new claims against {N}', '{N} responds to {W} allegations', 'Former manager alleges {N} was {W}',
    '{N} denies claims made by {O}', 'Fans react as {O} accuses {N} of {W}', '{S} breaks silence on {W} accusations', 'What we know about the {N} allegations',
    'More people come forward with claims about {N}', '{N} faces backlash over {W} claims'] },
  record: { words: ['subathon', 'marathon stream', 'charity stream', 'birthday stream', 'reaction stream'], t: [
    '{N} breaks viewer record with {X}-hour {W}', '{N}\'s {W} passes {X} hours', '{S} sets a new {W} record', 'Inside {N}\'s record-breaking {W}',
    '{N} hits {X} million live viewers', 'Viewers flock to {N}\'s {X}-day {W}', '{N} ends historic {W} after {X} hours', '{S}\'s {W} becomes most watched of the year',
    '{N} celebrates record {W} with {O}', 'How {N} kept a {W} going for {X} days'] },
  split: { words: ['split', 'breakup', 'divorce', 'separation', 'parting'], t: [
    '{N} and {O} announce {W} after {X} years', '{N} confirms {W} with {O}', '{S} opens up about {W} from {O}', 'Inside the {N} and {O} {W}',
    'Fans shocked by {N} {W} news', '{O} speaks out after {W} with {N}', '{N} deletes photos with {O} amid {W} rumours', '{N} and {O} quietly end {X}-year relationship',
    'Why {N} and {O} called it quits', '{S} moves out after {W}'] },
  leak: { words: ['unreleased song', 'private messages', 'contract details', 'demo tape', 'tour plans'], t: [
    '{N}\'s {W} leaked online', 'Leaked {W} show {N} feud with {O}', '{N} furious after {W} leak', '{S} confirms {W} were stolen',
    'Hackers publish {N}\'s {W}', '{N} {W} leak spreads across forums', '{O} blamed for {N} {W} leak', '{N} asks fans not to share leaked {W}',
    'What the {N} {W} leak reveals', '{S} takes legal action over {W} leak'] },
  ban: { words: ['platform', 'streaming site', 'video app', 'chat service', 'tournament'], t: [
    '{N} banned from {W} for {X} days', '{N} suspended by {W} after stream incident', '{S} reveals reason for {W} ban', '{W} bans {N} without warning',
    '{N}\'s channel taken down by {W}', '{N} returns after {X}-day {W} ban', 'Fans demand answers over {N} {W} suspension', '{O} defends {N} after {W} ban',
    '{N} appeals {W} ban', 'Why was {N} banned from the {W}'] },
  tour: { words: ['tour', 'concert run', 'arena shows', 'world tour', 'festival set'], t: [
    '{N} cancels remaining {W} dates', '{S} pulls out of {X} {W} citing health', '{N} postpones {W} at the last minute', 'Refunds offered after {N} scraps {W}',
    '{N} explains why the {W} was cancelled', 'Fans stranded as {N} calls off {W}', '{O} replaces {N} on {W} bill', '{N} {W} cancellation leaves venue scrambling',
    '{N} promises to reschedule {W}', '{S} apologises for {W} cancellation'] },
  fight: { words: ['brawl', 'scuffle', 'fight', 'altercation', 'shoving match'], t: [
    '{N} and {O} in heated {W} at event', 'Video shows {N} throwing a punch at {O}', '{S} {W} with security goes viral', '{N} breaks up {W} on stage',
    'Police called after {N} {W}', '{O} speaks out after {W} with {N}', '{N} banned from venue after {W}', 'Watch the moment {N} and {O} clash',
    '{N} says {O} started the {W}', 'Fans split over {N} {W} clip'] },
  award: { words: ['award', 'top prize', 'trophy', 'honour', 'best newcomer'], t: [
    '{N} wins {W} at awards night', '{N} takes home {W} beating {O}', '{S} gives emotional speech after {W} win', '{N} named winner of {W}',
    'Shock as {N} beats {O} to {W}', '{N} dedicates {W} to fans', '{N} wins {X} awards in one night', 'Inside {N}\'s big night as {W} goes to them',
    '{O} congratulates {N} on {W}', 'Why {N} deserved the {W}'] },
};
const KIND_NAMES = Object.keys(KINDS);
// how a second outlet retells a headline
const LEADS = ['', '', 'Watch: ', 'Report: ', 'Update: ', 'Explained: '];
const TAILS = ['', '', ' as fans react', ', sources say', ' in new video', ' this week'];

/** The invented people: `n` distinct names, two syllable pairs each. */
function people(n, rand) {
  const out = []; const seen = new Set();
  let guard = 0;
  while (out.length < n && guard++ < n * 200) {
    const pick = (xs) => xs[Math.floor(rand() * xs.length)];
    const first = pick(FIRST_A) + pick(FIRST_B);
    const last = pick(LAST_A) + pick(LAST_B);
    const name = `${first} ${last}`;
    if (seen.has(name) || seen.has(last)) continue;
    seen.add(name); seen.add(last);
    out.push({ name, surname: last });
  }
  return out;
}

/** See the header. */
function headlines({ people: n = 50, perStory = 20, seed = 20261020 } = {}) {
  const rand = rng(seed);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const who = people(n, rand);
  const out = [];
  const seen = new Set();
  who.forEach((p, i) => {
    const first = Math.floor(rand() * KIND_NAMES.length);
    const second = (first + 1 + Math.floor(rand() * (KIND_NAMES.length - 1))) % KIND_NAMES.length;
    [first, second].forEach((k, s) => {
      const kind = KIND_NAMES[k];
      const spec = KINDS[kind];
      const word = pick(spec.words); // one story, one subject: the same word throughout, as a real story keeps its noun
      const other = who[(i + 1 + Math.floor(rand() * (who.length - 1))) % who.length].name;
      const number = 2 + Math.floor(rand() * 40);
      for (let h = 0; h < perStory; h++) {
        const template = spec.t[h % spec.t.length];
        const text = template.replace(/\{N\}/g, p.name).replace(/\{S\}/g, p.surname).replace(/\{O\}/g, other).replace(/\{X\}/g, String(h < spec.t.length ? number : number + h))
          .replace(/\{W\}/g, h < spec.t.length ? word : pick(spec.words));
        const told = h < spec.t.length ? text : `${pick(LEADS)}${text}${pick(TAILS)}`;
        out.push({ text: seen.has(told) ? `${told} (${h})` : told, person: i, story: i * 2 + s, kind });
        seen.add(told);
      }
    });
  });
  return out;
}

module.exports = { headlines, rng, KIND_NAMES };
