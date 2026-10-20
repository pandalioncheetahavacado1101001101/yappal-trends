'use strict';
/*
 * What a Wikipedia page says it is, from its short description and its title's qualifier (lib/size/resolve.js reads it to refuse
 * namesakes): a person (and what they do), or a thing (a work, a song, a game, an event, a meme, a place, an organisation, a
 * product, a list of namesakes). Pure.
 */
const { keyOf } = require('../util');

const STOP = new Set('the a an of and in on at to for by with vs v is my me about all it its his her their this that from as'.split(' '));
const YEAR = /^(?:1[89]|20)\d\d$/;

/** A text's words that can name a page: the normalised key's words, without small words and years. */
const words = (text) => keyOf(text).split(' ').filter((w) => w && !STOP.has(w) && !YEAR.test(w));
/** A page title without its trailing qualifier: "Alex Rowan (American football)" -> "Alex Rowan". */
const baseTitle = (title) => String(title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
/** A page title's trailing qualifier, or null. */
const qualifierOf = (title) => (String(title || '').match(/\(([^)]*)\)\s*$/) || [])[1] || null;

const BORN = /\((?:born|b\.)\s|\bborn \d{4}\b/i;
const SPAN = /\(\s*(?:c\.\s*)?\d{3,4}\s*[–-]\s*(?:c\.\s*)?(\d{3,4})\s*\)|\(died \d{4}\)/i;
const DIED = /\(\s*(?:c\.\s*)?\d{3,4}\s*[–-]\s*(?:c\.\s*)?(\d{3,4})\s*\)|\(died (\d{4})\)/i;
// a band or a duo stands where a person does (the row's `people` hold acts as well as people)
const MUSIC_ACT = /\b(?:band|duo|trio|quartet|boy band|girl group|music(?:al)? group|vocal group|rap group|hip hop group|k-pop group)\b/i;
const PERSON_CLASSES = {
  creator: /\b(?:youtuber|you ?tube (?:personality|creator)|streamer|twitch|tiktok(?:er)?s?|social media (?:personality|influencer|star)|internet (?:personality|celebrity)|online personality|influencer|content creator|vlogger|podcaster|e-?sports|gamer|super smash bros\.?|fortnite|minecraft|web personality|youtube)\b/i,
  actor: /\b(?:actor|actress|comedian|comic|television (?:personality|presenter|host)|tv (?:personality|host)|talk show host|model|filmmaker|film director|screenwriter|stand-up|entertainer|reality television|socialite)\b/i,
  musician: /\b(?:singer|rapper|musician|songwriter|record producer|disc jockey|dj|composer|guitarist|drummer|pianist|vocalist|band|duo|trio|boy band|girl group)\b/i,
  athlete: /\b(?:footballer|football (?:player|coach|manager)|american football|soccer|basketball|baseball|hockey|cricketer|rugby|tennis|golfer|boxer|wrestler|mixed martial|mma|fighter|swimmer|sprinter|athlete|racing driver|cyclist|skier|skater|gymnast|olympian|coach|quarterback|pitcher|breakdancer|b-girl|b-boy|jockey|sportscaster)\b/i,
  politician: /\b(?:politician|senator|governor|congress(?:man|woman)|member of (?:the )?(?:house|parliament|congress)|mayor|president|prime minister|minister|diplomat|political (?:commentator|activist|candidate)|commentator|activist|lawyer|attorney|judge|first lady|press secretary)\b/i,
  otherPerson: /\b(?:painter|poet|writer|novelist|author|journalist|scientist|physicist|chemist|mathematician|physician|surgeon|engineer|architect|business(?:man|woman|person)|entrepreneur|executive|economist|philosopher|historian|bishop|priest|cleric|rabbi|imam|monk|nun|saint|military officer|soldier|general|admiral|king|queen|prince|princess|emperor|noble(?:man|woman)|aristocrat|explorer|inventor|academic|professor|sculptor|photographer|chef|designer|criminal|murderer|serial killer|spy|fraudster|heiress|royal)\b/i,
};
const THING_CLASSES = {
  meme: /\b(?:meme|slang|catchphrase|phrase|slogan|neologism|internet (?:trend|phenomenon)|viral (?:video|trend|dance|challenge)|challenge|dance craze|dance|hashtag|buzzword|expression|idiom|brain ?rot|trend)\b/i,
  song: /\b(?:song|single|track)\b/i,
  game: /\b(?:video game|roblox|game)\b/i,
  work: /\b(?:film|movie|television series|tv series|(?:television|tv) (?:program|programme|show|sitcom)|sitcom|miniseries|web series|anime|manga|album|ep|mixtape|novel|book|comic|musical|opera|episode|soundtrack|franchise|podcast|documentary|reality (?:show|series|competition)|game show|talk show|series)\b/i,
  event: /\b(?:season|tournament|championship|election|ceremony|awards?|festival|conference|match|fight|bout|shooting|attack|bombing|riot|protests?|disaster|earthquake|hurricane|storm|crash|incident|scandal|controversy|trial|lawsuit|case|war|battle|massacre|murder|killing|strike|pageant|fashion show|tour|concert|rivalry|feud|implosion|arrest|death)\b/i,
  place: /\b(?:village|town|city|municipality|commune|county|district|province|country|island|river|lake|mountain|neighbou?rhood|suburb|borough|region|capital|census-designated place|unincorporated community|hamlet|parish|street|square|park|station|airport|bridge|building|stadium|arena|state of)\b/i,
  org: /\b(?:company|corporation|brand|business|manufacturer|retailer|restaurant|chain|university|college|school|organi[sz]ation|agency|association|foundation|charity|political party|club|team|league|newspaper|magazine|website|record label|network|channel|bank|hospital|church|trade union|group|house|collective)\b/i,
  product: /\b(?:car|vehicle|automobile|truck|motorcycle|aircraft|ship|smartphone|phone|device|console|software|app|application|operating system|product|toy|drink|beverage|food|snack|cereal|cup|weapon|rifle|computer|chip|model of)\b/i,
  disambiguation: /\b(?:topics referred to by the same term|disambiguation|given name|surname|family name)\b/i,
};
const THINGS = ['work', 'event', 'place', 'org', 'song', 'game', 'meme', 'product', 'disambiguation'];

/**
 * What a page is: { person (bool), classes: Set(class), died (year or null), described (it has a description at all) }. "Born" makes
 * a person, and so does a band or a duo; otherwise a page that says it is a work, an event, a place, an organisation or a product
 * is a thing, whatever occupation words or span of years it also carries ("2021 boxing match", "American TikTok group", "South
 * Korean television series (2021–2025)", "Electric sports car (2008–2012)").
 */
function classify(description, title = '') {
  const text = `${description || ''} ${qualifierOf(title) || ''}`.trim();
  const act = MUSIC_ACT.test(text) && !/\b(?:tiktok|youtube|social media)\s+group\b/i.test(text);
  const classes = new Set();
  for (const [c, re] of Object.entries(THING_CLASSES)) if (re.test(text)) classes.add(c);
  if (act) { classes.delete('org'); classes.delete('event'); }
  const occupations = Object.entries(PERSON_CLASSES).filter(([, re]) => re.test(text)).map(([c]) => c);
  const thing = THINGS.some((c) => classes.has(c));
  const person = BORN.test(text) || act || ((SPAN.test(text) || occupations.length > 0) && !thing);
  if (person) for (const c of occupations) classes.add(c);
  const m = person ? text.match(DIED) : null;
  return { person, classes, died: m ? Number(m[1] || m[2]) : null, described: text.length > 0 };
}

module.exports = { words, baseTitle, qualifierOf, classify, PERSON_CLASSES, THINGS };
