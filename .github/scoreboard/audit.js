'use strict';
/*
 * The matcher's audit (scoreboard-spec.json matcher.audit): the Google Trends pairs the frozen matcher makes on two saved inputs,
 * for a hand-check. Run on the Mac only: its inputs are private and gitignored (.github/scoreboard/private/audit/, never published).
 *   mac   the Mac loop's state of 2026-10-11/12 (our rows with their real first listings) against its own Google Trends read
 *   live  the published US list of 2026-10-19 07:25Z (no first listings: the feed carries none) against the read of 07:32Z
 *
 *   node .github/scoreboard/audit.js [private dir]     prints every pair, one a line, for labelling
 *   node .github/scoreboard/audit.js --record          writes audit-result.json from the labelled pairs (private/audit/pairs-checked.json):
 *                                                      the day, the pairs and how many were not the same story; counts only, so it may
 *                                                      be published (latest.json carries it as the matcher's false-match rate)
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const M = require('./match');
const C = require('./comparators');

const gunzip = (file) => zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');

/** Every GT pair of both sets: [{ set, gt, gtStart, ours, how, score }], in a stable order. */
function auditPairs(privateDir, spec) {
  const sets = [
    { set: 'mac', ours: JSON.parse(gunzip(path.join(privateDir, 'audit', 'mac-ours.json.gz'))), gt: gunzip(path.join(privateDir, 'audit', 'mac-gt-us-168h.txt.gz')) },
    { set: 'live', ours: JSON.parse(gunzip(path.join(privateDir, 'replies', 'feed-us.json.gz'))).items.map((x) => ({ id: x.id, kind: x.kind, sub: x.sub, titles: [x.title],
      aliases: x.keys || [], people: x.people || [], tags: x.tags || [], subject: null, listed: null })), gt: gunzip(path.join(privateDir, 'replies', 'gt-us-168h.txt.gz')) },
  ];
  const out = [];
  for (const s of sets) {
    const index = M.prepareOurs(s.ours, spec);
    const titleOf = new Map(s.ours.map((o) => [o.id, o.titles[0]]));
    const entries = C.parseGt(s.gt);
    const byKey = new Map(entries.map((e) => [e.key, e]));
    for (const h of M.matchAll(entries.map((e) => ({ ...e, t: e.own })), 'gt', index)) {
      const e = byKey.get(h.key);
      out.push({ set: s.set, gt: e.title, gtStart: e.own, ours: titleOf.get(h.id), how: h.how, score: h.score });
    }
  }
  return out.sort((a, b) => (a.set === b.set ? a.gtStart - b.gtStart || (a.gt < b.gt ? -1 : 1) : a.set < b.set ? -1 : 1));
}

/** The counts of a labelled audit: { day, pairs, wrong } (uncertain was labelled not the same). */
function auditCounts(checked) {
  return { day: checked.checked, pairs: checked.pairs.length, wrong: checked.pairs.filter((p) => !p.same).length };
}

module.exports = { auditPairs, auditCounts };

if (require.main === module) {
  if (process.argv[2] === '--record') {
    const counts = auditCounts(JSON.parse(fs.readFileSync(path.join(__dirname, 'private', 'audit', 'pairs-checked.json'), 'utf8')));
    fs.writeFileSync(path.join(__dirname, 'audit-result.json'), `${JSON.stringify(counts)}\n`);
    process.stdout.write(`audit-result.json: ${counts.pairs} pairs, ${counts.wrong} not the same story (${counts.day})\n`);
  } else {
    const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'scoreboard-spec.json'), 'utf8'));
    for (const p of auditPairs(process.argv[2] || path.join(__dirname, 'private'), spec)) process.stdout.write(`${JSON.stringify(p)}\n`);
  }
}
