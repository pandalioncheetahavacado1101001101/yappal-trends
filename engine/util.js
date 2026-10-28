'use strict';
/* Small helpers shared by the Ideas pipeline modules. */

const sum = (xs) => xs.reduce((s, v) => s + v, 0);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const stripParen = (s) => (s || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
/** Whole-word containment on space-joined word lists: contains('esselle quillith fans', 'esselle quillith'). */
const contains = (hay, name) => (' ' + hay + ' ').includes(' ' + name + ' ');
/** Syndicated copies (same normalised title) count once. */
function uniqByKey(items) {
  const seen = new Set();
  return items.filter((i) => (seen.has(i.key) ? false : seen.add(i.key)));
}

// One key per outlet: "Yahoo Sports" = "sports.yahoo.com", "Page Six" = "pagesix.com", "E! News" = "eonline".
const OUTLET_ALIAS = { eonline: 'e', usmagazine: 'usweekly', nypost: 'newyorkpost', ew: 'entertainmentweekly', thr: 'hollywoodreporter',
  huffingtonpost: 'huffpost', huffpostuk: 'huffpost', knowyourmeme: 'kym' };
// Publishing groups that run one newsroom's story under several mastheads: one source, not five (a moment covered only by the
// Mirror and the Irish Mirror has one independent source)
const PUBLISHER_GROUP = {
  reach: ['mirror', 'irishmirror', 'dailymirror', 'express', 'dailyexpress', 'manchestereveningnews', 'men', 'liverpoolecho', 'walesonline',
    'dailystar', 'birminghammail', 'dailyrecord', 'chroniclelive', 'bristolpost', 'devonlive', 'hulldailymail', 'nottinghampost', 'belfastlive',
    'glasgowlive', 'edinburghlive', 'examinerlive', 'lancs', 'mylondon', 'manchesterevening', 'wales'],
  nzme: ['nzherald', 'newstalkzb', 'thecountry', 'nzheraldconz'],
  newscorpau: ['couriermail', 'heraldsun', 'adelaidenow', 'cairnspost', 'newscomau', 'news', 'dailytelegraphau', 'perthnow', 'goldcoastbulletin',
    'townsvillebulletin', 'geelongadvertiser', 'themercury', 'ntnews', 'skynewsau'],
  newsquest: ['eastlothiancourier', 'heraldscotland', 'thenational', 'northernecho', 'theargus', 'yorkpress', 'oxfordmail', 'bournemouthecho'],
};
const GROUP_OF = new Map(Object.entries(PUBLISHER_GROUP).flatMap(([g, list]) => list.map((k) => [k, `group:${g}`])));
function outletKey(name) {
  const k = (name || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^the /, '')
    .replace(/\.(com|co\.uk|com\.au|org|net|us|ca|co|tv)$/, '')
    .replace(/^(sports|news|ca\.news|uk\.news|au\.news|currently\.att|en|m|amp)\./, '')
    .replace(/ (magazine|news|online|digital)$/, '').replace(/[^a-z0-9]/g, '');
  if (!k) return (name || '').toLowerCase().replace(/\s+/g, ''); // a name in another script ("스포츠조선") is its own key
  if (k.startsWith('yahoo')) return 'yahoo';
  // "theguardian.com" and "The Guardian" are one outlet
  const bare = k.replace(/^the(?=[a-z]{3})/, '');
  const key = OUTLET_ALIAS[bare] || bare;
  return GROUP_OF.get(key) || key;
}

module.exports = { sum, median, stripParen, contains, uniqByKey, outletKey };
