'use strict';
/*
 * Story step, what a line may say: the vocabulary that tells a conflict ("dropped", "backlash", "quit") from a defence ("blames",
 * "declares"), a review, an explainer or day-one logistics; the corrections that rewrite or veto a story ("reverse course",
 * "fact check", "fake", "denies", "creator says it was intentional"); and the wording rules every shown line passes (a romance
 * is "reportedly", a contested crowd reaction is "drew boos (reaction mixed)", no label on a private person, no heckler's
 * accusation, no opinionated source wording). Plain string/regex/set arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const R = require('./rules');
const { contains, uniqByKey } = require('./util');
const { words, stem, DAY, uniq } = require('./story-terms');

// ---------- vocabulary ----------
// what makes a story: somebody did something to somebody, and people took sides
const CONFLICT = /\b(backlash|boycott\w*|outrage\w*|outcry|fury|furious|fum(?:e|es|ing)|slam(?:s|med)?|blasts|blasted|rips|ripped|trash(?:es|ed)?|accus\w+|snub(?:s|bed)?|feud\w*|rift|spat|clash\w*|controvers\w+|scandal|firestorm|uproar|pile-?on|criticis\w+|criticiz\w+|condemn\w*|protest\w*|quits?|quitting|withdraw\w*|withdrew|pulls? out|pulled out|drops? out|dropped|removed|removal|fired|ousted|kicked (?:off|out)|forced off|bans?|banned|refus(?:e|es|ed|ing)|reject(?:s|ed|ing)?|rejection|revers(?:e|es|ed|al)|backtrack\w*|backpedal\w*|u-turn|booed|boos|heckl\w*|divided|divides|split over|dragged|mocked|mocking|ridicul\w+|disgust\w*|sues|sued|lawsuit|threat\w*|diss|calls? out|called out|under fire|exodus|implod\w+|turmoil|trolls?|trolled|trolling)\b/i;
// people turning on the subject (not laughing along: "mocked", "memes" are the moment's own spread)
const BACKLASH = /\b(backlash|outrage\w*|outcry|fury|furious|slammed|criticis\w+|criticiz\w+|called out|calls? out|ripped|under fire|boycott\w*|disgust\w*|divided|split over|pile-?on|dragged|condemn\w*)\b/i;
// the subject defending itself is its damage control, not the story
const SELF_DEFENSE = /\b(blames?|blamed|declares?|insists?|speaks? (?:out|on|about)|defends? (?:himself|herself|themselves)|explains?|clarif(?:y|ies|ied)|responds?|breaks? (?:his |her |their )?silence|opens? up|addresses|reacts? to|says (?:he|she|they|it)|reveals?|admits?|weighs? in|shares (?:his|her|their)|tells)\b/i;
const REVIEW = /^(?:review|opinion|analysis|column|editorial|guest commentary|commentary|essay|let['’]s (?:rank|talk about|discuss|break down|revisit|relive))\b|\b(?:film )?review\s*[:|]|\breview$|\bopinion\s*\||\|\s*opinion\b|\bbrings (?:the )?sleaze\b|\bgoes for it\b|\bis ready for\b/i;
// a columnist's byline before a colon ("Rouiel Trevace: From the generation that brought us ..."): an opinion piece
const BYLINE = /^(\p{Lu}[\p{Ll}’'-]+\s+\p{Lu}[\p{L}’'-]+):\s+(?:From|Why|How|What|When|In|On|The|A|An)\s/u;
const byline = (title, E) => { const m = W.curlQuotes(title).match(BYLINE); return !!m && !(E && contains(words(m[1]).join(' '), E)); };
const EXPLAINER = /\b(morning rundown|live updates|newsletter|briefing|inspo|outfit ideas|what to wear|best looks|see (?:all )?(?:her|his|the) (?:best )?looks|what to know|who is|who are|everything (?:we know|to know|you need)|explained|timeline|here['’]s (?:what|why|how|the)|how to|things to know|true story|is it (?:true|real)|how accurate|fact-check the|what happened|where (?:is|are) .+ now|all about|get to know|meet the)\b|^(?:is|are|does|did|was|were|can|could|will|would|why|how)\b/i;
const LOGISTICS = /\b(starter|starting pitcher|confirmed(?: for)?|announced for|couples|contestants|cast list|pairings|airport|tarmac|planeside|arriv(?:es|ed|al|ing)|lands in|touches down|set to (?:face|play|perform|attend|headline|meet)|to attend|expected at|schedule|tickets?|setlist|start times?|what time|where to watch|how to watch|line-?ups?|(?:official|starting|predicted|probable) (?:xis?|elevens?)|team news|menu|guest list|who attended|venue|agenda|preview|kicks? off|begins|traffic|forecast|presale|dates|reveals? (?:the )?songs|songs revealed|song choices)\b/i;
// a verdict or a stake: what came of it
const STAKES = /\b(\d+(?:st|nd|rd|th) straight|third straight|straight (?:year|season)|player of the year|mvp|no breakthroughs?|few (?:concrete )?(?:gains|achievements)|little (?:sign of )?progress|light on substance|over substance|pomp|pageantry|fanfare|flop\w*|disaster\w*|collaps\w*|record|history|historic|upset|stuns?|stunned|biggest crisis|culture war|flashpoint)\b/i;
// a turn of the story: somebody gave in, gave up or raised the stakes
const TURN = /\b(apologi[sz](?:e|es|ed|ing)|resign\w*|announc\w+|cancel(?:s|led|ed)|walks? out|walked out|sues|sued|quits?|in tears|breaks down|dropped from)\b/i;
// the moment's own framing: a retelling of it, not its story
const MOMENT_FRAME = /\b(goes viral|went viral|going viral|sparks? shock|stuns?|stunned|shocks?|shocking|internet (?:reacts|is)|fans react|becomes? (?:an? )?(?:instant )?meme|became (?:an? )?(?:instant )?meme|viral (?:video|clip|moment|meme|footage)|wild (?:scene|moment)|bizarre|jaw-dropping|what happens next)\b/i;
// what has not happened yet: a preview is no story and no stake
const FUTURE = /\b(to face|will (?:start|face|play|meet|attend|perform|open|host)|set to|likely (?:his|her|their)|expected to|ahead of|preview|looks? to|keys to|to watch|underdogs?|is opening|to open|coming (?:this|next) (?:week|month)|announces (?:new|upcoming)|announces (?:a |her |his |their )?(?:major |big |surprise )?(?:new )?(?:music )?(?:release|single|album|song|ep|video)|to start (?:as|in|for|against)\b|excited (?:for|about)|gearing up for|(?:is|are) (?:poised|primed|dressed|ready|hoping|aiming) to|(?:dropping|coming|arriving|out) (?:this|next) (?:week|month|friday|saturday|sunday|monday|tuesday|wednesday|thursday))\b/i;
// a teaser that hides what happened
const VAGUE = /\b(ends with (?:a )?surprise|you won['’]t believe|what happen(?:s|ed) next|here['’]s why|the reason why|find out (?:why|what)|reveals? where (?:he|she|they) stands?|find out the (?:shocking |real )?reason|for an eyebrow-raising reason|leaves? (?:people|fans|everyone|the internet|viewers) (?:floored|stunned|speechless|in tears|shocked)|(?:her|his|their) next move|floors (?:people|fans|everyone)|needs? to be one change|one (?:big )?(?:change|thing|detail|problem))\b|\bexposed\s*$/i;
// curiosity-gap and tabloid wording: a line that never says what happened, or shouts it ("fans beg BBC to fix glaring mistake")
// a title that is a verdict on a claim ("Fact check: Tavix Ostiss has not performed solo ..."): its sentence repeats the rumour
const VERDICT = /^\s*(?:fact[- ]?check(?:ed|ing)?|false|fake|debunked|rumou?rs?|myth(?:buster)?)\s*[:|\u2013\u2014-]\s/i;
// a title whose claim rests on unnamed experts or sources ("Brinory Hassner, Hollinet Yarrent ‘furious’ as ...: experts"): cut to a line, it
// would state their guess about real people as fact
const HEARSAY = /[:,]\s*(?:(?:royal|palace|body[- ]language|legal|some|top|many)\s+)?(?:experts?|insiders?|sources?|pals?|friends|a source|an insider|an expert|a pal|a friend)(?:\s+(?:say|says|claim|claims|reveal|reveals|suggest|suggests|believe|believes|warn|warns))?\s*[.!]?\s*$/i;
// what happened to the subject: a death, an arrest, a result; a retrospective or an interview about it is not the story
const RESULT = /\b(?:dies|died|dead|killed|arrested|charged|convicted|sentenced)\b/i;
const RETRO = /\b(?:interviews?|(?:years?|months?|weeks?|days?) before|before (?:\S+\s+){0,2}(?:death|passing|arrest)|looks? back|remember(?:s|ed|ing)?|recalls?|resurfac\w*|throwback)\b/i;
const GRAVE_EVENT = /\b(?:death|died|dies|dead|passing|arrest\w*|losing|loss|killed)\b/i;
// a name glossed with the one people use ("Bexane Tamurn, globetrotting wrestler known as Swivdot, dies at 40"): the line names
// them by the name fans do not, so another line tells it ("AEW star Swivdot dead at 40")
const NAME_GLOSS = /,\s+(?:[\w’'-]+\s+){0,6}(?:(?:also|better)\s+)?known as\b|\baka\b/i;
/**
 * A one-word name followed by a name few of the story's own items put after it is someone else: "Pellard Sorriss wins national award"
 * is not BLACKPINK's Yolkstro, though one search row about her fell into the story (while "Orret Neskurn" and "Strictly Come Dancing"
 * are the story's own).
 */
const OWN_NAME_SHARE = 1 / 3;
function otherBearer(text, E, own) {
  if (!E || E.includes(' ')) return false;
  const lower = text.toLowerCase();
  for (let i = lower.indexOf(E); i !== -1; i = lower.indexOf(E, i + 1)) {
    if (i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1])) continue;
    const m = text.slice(i + E.length).match(/^\s+(\p{Lu}[\p{Ll}’'-]+)/u);
    if (!m) continue;
    const name = `${E} ${m[1].toLowerCase()}`;
    const uses = own.filter((it) => it.title.toLowerCase().includes(name)).length;
    if (uses < 2 && uses < OWN_NAME_SHARE * own.length) return true;
  }
  return false;
}
// a line with no action of its own: a name, then "to avoid elimination"
const NO_ACTION = /^(?:[\p{Lu}][\p{L}\u2019'.-]*\s+)+(?:\p{Ll}[\p{L}\u2019'-]*\s+){0,2}to\s+(?:avoid|be|face|win|lose|compete|perform|return|join|star|host|make|get|take|go|see|meet|release|drop|open|close|headline|appear|feature|reveal|announce)\b/u;
const CLICKBAIT = /\b(begs?|begging|glaring|what happens next|floor(?:s|ed)|with a twist|feels? sick|have demands|has demands|yet another|goes crazy|went crazy|going crazy|faces (?:her|his|their) fears|an? a-lister|you won['’]t believe|jaw-dropping|mind-blowing|epic fail|leaves? (?:people|fans|everyone|viewers|the internet) \w+|(?:this|these) (?:to|at|in|on|for|during|while)|this (?:one )?(?:thing|detail|item|drink|habit))\b/i;
// a tabloid source title: its line is not shown even when the wording rules would calm it down
const BAIT_TITLE = /\bslammed for\b/i;
// coverage about the coverage
const META = /\b(reporter|journalist|columnist|newsroom|subscri\w+|article|op-?ed|podcast episode|headline)\b/i;
// the event a moment happened at
const EVENT = /\b(vs\.?|home[- ]opener|wins?|won|beats?|upset|loss|loses|lost|defeat\w*|falls? to|fell to|routs?|routed|blowout|\d{1,3}-\d{1,3}(?=\W|$)|opener|finale|premiere\w*|debut\w*|launch\w*|farewell|final (?:start|game|show|match|season|outing)|retire\w*|career|summit|state visit|visit|tour|ceremony|playoffs?|game \d|record|ratings|viewers|viewing figures|box office|opens to|host(?:s|ing)? line-?up|new hosts?)\b/i;
// a reported number that says how big it is
// (an outlet's own subscriber gain is the news business, not how big the moment is)
const SCALE_NUM = /\$\s?\d[\d.,]*\s?(?:million|m|billion|bn)\b|\b\d[\d.,]*\s?(?:million|m|billion|bn) (?:views|viewers|streams|followers|people)\b/i;
// source wording that takes a side or labels someone
const OPINION = /\b(truck stick\w*|straight facts|spot on|nails it|destroys|obliterat\w+|epic(?:ally)?|savage(?:ly)?|brutal(?:ly)?|shameless(?:ly)?|disgusting|whin(?:e|es|ing)|melts? down|meltdown|unhinged|craven|gutless|coward\w*|humiliat\w*|slays?|lazy|dead-ringer|nicked|lol|hailed|hails|branded|(?:is|are|was|were) (?:so |pure |simply )?(?:hilarious|amazing|incredible|genius|perfect|everything|a must-watch))\b/i;
// an outlet's own praise or scorn said as fact ("opens to impressive $19.2 million", "infamous stare", "basic job interview advice"):
// the adjective goes, the fact stays
const EVALUATIVE = /\b(impressive|infamous|chaotic|basic|perfectly|stunning(?:ly)?|iconic|legendary|epic|shocking(?:ly)?|bizarre|cringe-?worthy|hilarious(?:ly)?|jaw-?dropping)\s+(?=[\p{L}‘“$\d])/giu;
const LABEL = /\b(lazy|out-of-control|deadbeat|bad|useless|entitled|crazed|unhinged|paranoid|woke|angry toddler)\s+(man|men|dad|father|husband|woman|nurse|mom|mother|guy|fan|owner|boyfriend|girlfriend|toddler)\b/i;
// an accusation said as fact about someone (never quoted without "accused"/"reportedly"/"denies")
const ACCUSE = /\b(cheat(?:ed|ing|s)?|scamm?(?:ed|ing|er)?|stole|fraudster|abus(?:ed|er)|harass(?:ed|er)|assault(?:ed)?|lied|pervert|shoplifter|thief)\b/i;
const HEDGE = /\b(accus\w+|alleg\w+|reported(?:ly)?|reports?|claims?|den(?:y|ies|ied)|rumou?r\w*|sources?|suspicion|resurface\w*)\b/i;
// a heckler's accusation, censored or not, is never repeated
const CENSORED = /\b\w+\*{2,}\w*|\*{3,}|\bpedo\w*|\bped\*|\bpaedo\w*/i;
// "cheers for Neskova", "appears to be booed", "did Neskova get booed?", "tries to prove he wasn't booed": the reaction is disputed
const CONTRADICT_BOO = /\b(cheers?\b|cheered|mixed (?:reaction|response)|appears? to (?:be )?boo|did .{0,40}get booed|wasn['’]t booed|not booed|prove he wasn|thinks he['’]s being cheered|quiet doubts)\b/i;
// a romance stated as fact
const ROMANCE = /\b(dating|romance|boyfriend|girlfriend|spending time together|an item|seeing each other|new beau)\b/i;
const ROMANCE_HEDGE = /\b(reported(?:ly)?|reports?|rumou?r\w*|sources?|allegedly|apparently|confirmed|buzz)\b/i;
// accident words that a designed or deliberate moment must not be told with
const ACCIDENT = /\b(glitch\w*|malfunction\w*|disintegrat\w*|falls? apart|fell apart|wardrobe malfunction|off (?:her|his|their) body|mishap|blunder|goes wrong|went wrong|bugs? out)\b/i;

// corrections: a later row that rewrites or vetoes the story or the moment
const CORRECTION = [
  { kind: 'fake', re: /\b(fact[- ]check\w*|fake|faked|doctored|edited (?:clip|video|image|photo)|edited|manipulated|digitally altered|ai[- ](?:altered|edited|doctored|manipulated)|(?:is|was|were|are) ai[- ]generated|deepfake|debunk(?:s|ed)? (?:viral|video|clip|photo|image|mugshot)|hoax|not real|falsely|morphed|is from 20\d\d\b)/i },
  { kind: 'reversal', re: /\b(revers(?:e|es|ed|ing) (?:course|decision|ban)|revers(?:e|es|ed)\b|backtrack\w*|backpedal\w*|u-turn\w*|walks? back|after all|now accept\w*|later allowed|changes? (?:course|its mind)|lifts? (?:the )?ban|will run ads)\b/i },
  { kind: 'denial', re: /\b(denies|denied|deny|not true|shuts? down (?:rumou?rs?|claims?|speculation)|debunks? (?:rumou?rs?|claims?|theory))\b/i },
  { kind: 'intentional', re: /\b(intentional(?:ly)?|on purpose|deliberate(?:ly)?|by design|(?:\b(?:its|the|her|his) |['’]s )designer\b|designed|was planned|staged|part of the (?:show|act)|not a (?:malfunction|glitch|mistake|accident)|how it worked|fashion magic|runway experiment|trick\b)/i },
];

// major outlets tell a story; a content farm or an unknown domain does not
const MAJOR = /^(ap news|associated press|reuters|bbc|bbc\.com|bbc\.co\.uk|sky sports|nfl\.com|cnn|nbc news|cbs news|abc news|npr|pbs|the new york times|new york times|the washington post|washington post|wsj|the wall street journal|the guardian|the independent|the atlantic|the new yorker|axios|politico|bloomberg|los angeles times|usa today|variety|variety\.com|billboard|rolling stone|deadline|the hollywood reporter|people\.com|people|entertainment weekly|vulture|indiewire|the verge|techcrunch|wired|espn|cbs sports|the athletic|sky news|the telegraph|telegraph\.co\.uk|the times|fox news|new york post|page six|tmz|e! news|us weekly|just jared|the daily beast|mashable|business insider|forbes|fortune|cnbc|time|newsweek|newsweek\.com|metro\.co\.uk|the sun|dailymail\.com|daily mail|nz herald|rnz|news\.com\.au|abc australia|the boston globe|san francisco chronicle|sfgate|yahoo sports|sports illustrated|si\.com|bleacher report|the spun|pitchfork|consequence\.net|stereogum|them\.us|the cut|vogue\.com|elle|wwd|harper['’]s bazaar|instyle\.com|complex|slashfilm|a\.v\. club|av club|the ringer|salon\.com|slate magazine|the economist|al jazeera|dw\.com|radio times|digital spy|manchester evening news|the mirror|mirror|irish mirror)$/i;
const WEAK_OUTLET = /^(betus|barstool sports|ssbcrack|suaragarut\.id|evrim ağacı|her campus|comic basics|briefly news|legit news|yen\.com\.gh|the news international|modern ghana|newsbytes|primetimer\.com|currently\.com|news\.meaww\.com|thetab\.com|holr magazine|chennaionline|türkiye today|voice of alexandria|netflix junkie|attack of the fanboy|gridiron heroics|finchannel|methodshop|film stories|imdb|facebook\.com|youtube|linkedin|oh no they didn['’]t!.*|jubileecast|newscord|the tech buzz|межа.*|ua\.news|tovima\.com|brewtiful living|kaniva tonga news|kanivatonga\.co\.nz|sheldon ang media|redraven\.news|vox rebelle|tooxclusive\.com)$/i;

const outletQuality = (it) => (it.fam === 'reddit' ? -0.8 : MAJOR.test(it.outlet || '') ? 0.8 : WEAK_OUTLET.test(it.outlet || '') ? -1 : /\./.test(it.outlet || '') ? -0.3 : 0);

// ---------- consensus: how many separate titles repeat a word ----------
const titleKey = (it) => words(it.title.replace(/\s+[-–|]\s+[^-–|]+$/, '')).join(' ');
// two-letter words count when they are not stop words ("Tamwyn", "UK")
const contentStems = (text, skip) => uniq(words(text).filter((w) => w.length > 1 && !W.STOP.has(w) && !W.GENERIC.has(w) && !skip.has(w) && !/^\d+$/.test(w))
  .map(stem)).filter((s) => s.length > 1);

/** stem -> number of separate titles carrying it (syndicated copies of one title count once). */
function docFreq(items) {
  const byStem = new Map();
  for (const it of items) {
    const k = titleKey(it);
    for (const s of it.textStems || []) {
      if (!byStem.has(s)) byStem.set(s, new Set());
      byStem.get(s).add(k);
    }
  }
  return new Map([...byStem].map(([s, set]) => [s, set.size]));
}

/** How widely a line's words are repeated: the mean of log2(1 + titles) over its content words. */
function consensusOf(text, df, skip) {
  const st = contentStems(text, skip);
  if (!st.length) return 0;
  return st.reduce((a, s) => a + Math.log2(1 + (df.get(s) || 0)), 0) / Math.max(3, st.length);
}

/** Words of a line that only one or two separate titles use while the moment has many ("Mercury worker" vs "arena staffer"). */
function minorityWords(text, df, skip, total) {
  if (total < 4) return [];
  return contentStems(text, skip).filter((s) => (df.get(s) || 0) <= 1);
}

// ---------- corrections ----------
/**
 * Rows that correct the moment or the story: a fact check or "fake"/"edited" (veto), a reversal (the story is the reversal),
 * a denial (the story leads with it), "creator says it was intentional" (the moment is not an accident). A row counts when it
 * names the main name and carries one of the moment's own words, or is the moment's own coverage.
 */
function correctionsOf(pool, { E, isMom, momentStems, momentFirst }) {
  const out = { fake: [], reversal: [], denial: [], intentional: [] };
  // a nameless moment needs two of its own words in the row ("Fennsy" alone also finds a fact check about a wedding photo)
  const own = (it) => momentStems.filter((s) => it.textStems.has(s)).length;
  const tied = (it) => (E ? (contains(it.textWords, E) || it.allNames.some((n) => contains(n, E))) && own(it) >= 1 : own(it) >= 2);
  for (const it of uniqByKey(pool)) {
    if (it.t < momentFirst - DAY || !tied(it)) continue;
    for (const c of CORRECTION) {
      if (!c.re.test(it.title)) continue;
      // "Is 'Primetime' a true story? We fact-check the thriller" checks a film, not the moment
      if (c.kind === 'fake' && EXPLAINER.test(it.title) && !/\b(fake|edited|doctored|altered|hoax|debunk\w*)\b/i.test(it.title)) continue;
      out[c.kind].push(it);
    }
  }
  for (const k of Object.keys(out)) out[k] = uniqByKey(out[k]);
  return out;
}

/** "Creator Says It Was Intentional" -> "creator says it was intentional": the correcting clause of a title, in its words. */
function correctionClause(it) {
  const t = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '');
  const m = t.match(/\b((?:its |her |his |the )?(?:creator|designer|director|rep|representative|spokesperson|team|studio|maker|producer)s?\b[^,;:.!?]{3,120})/i);
  if (!m) return null;
  // "Designer of Veley Gravmott's Viral 'Melting' Dress Explains How It Worked" -> "designer explains how it worked"
  const c = m[1].replace(/^the /i, '').replace(/^((?:its |her |his )?\w+s?)\b.*?\b(says|explains|reveals|confirms|insists)\b/i, '$1 $2');
  return c.toLowerCase().replace(/\s+/g, ' ').trim();
  return null;
}

// ---------- wording rules for every shown line ----------
/**
 * Privacy and defamation: a romance is "reportedly", "shoplifter" is "alleged", an age appositive goes ("Neskova, 80,"), a label
 * on a private person goes, opinion filler goes. Returns the safe line.
 */
function safeLine(text, { contested = false } = {}) {
  let s = text.replace(/,\s*\d{2,3},\s*/g, ' ').replace(/\s{2,}/g, ' ');
  if (ROMANCE.test(s) && !ROMANCE_HEDGE.test(s)) {
    s = s.replace(/\b(are|is)\s+(dating|spending time together|an item|seeing each other)\b/i, '$1 reportedly $2')
      .replace(/(\S+['’]s)\s+(boyfriend|girlfriend|romance|new beau)\b/i, '$1 reported $2');
    if (!ROMANCE_HEDGE.test(s)) s = s.replace(/\b(dating|romance)\b/i, 'reported $1');
  }
  // a neutral verb for a collision, no heat words: "plows into" -> "runs into", "faces furious backlash" -> "faces backlash"
  s = s.replace(/\bplow(?:s)? into\b/gi, 'runs into').replace(/\bplowed into\b/gi, 'ran into').replace(/\bbulldoz(?:es|ing) (?:into|through)\b/gi, 'runs into')
    .replace(/\bslammed for\b/gi, 'criticised for')
    .replace(/\bafter (?:the )?internet (?:goes|went) (?:crazy|wild|nuts) (?:over|for) (?:her |his |their |the )?(.+)$/i, 'after $1 goes viral')
    // an honour stated as fact ("Hall of Fame career") is an outlet's praise, not a record; "participates in" is stilted
    .replace(/\bbids farewell to (?:a |his |her |their )?(?:future )?Hall[- ]of[- ]Fame career\b/i, 'bids farewell')
    .replace(/\bparticipates in\b/gi, 'joins').replace(/\bparticipated in\b/gi, 'joined').replace(/\b(?:furious|fierce|massive|huge) (backlash|fury)\b/gi, '$1').replace(/\bbecuase\b/gi, 'because');
  s = s.replace(/\b(an? |the )?shoplifter(['’]s)?\b/gi, (m, art, pos) => `${art || ''}alleged shoplifter${pos || ''}`)
    .replace(/\b(lazy|out-of-control|deadbeat|useless|entitled|crazed|paranoid)\s+(?=(man|men|dad|father|husband|woman|nurse|mom|mother|guy|fan|owner)\b)/gi, '')
    .replace(/\b(brutally|savagely|shamelessly|hilariously|epically|loudly)\s+/gi, '');
  if (contested) {
    // (the why says the accounts differ)
    s = s.replace(/\b(gets|got|is|was)\s+booed\b/i, 'drew boos').replace(/\bbooed\b/i, 'drew boos').replace(/\bfaces? loud boos\b/i, 'drew boos');
  }
  // "at College Football Game" (a Title Case headline's generic words) reads "at a college football game"
  s = s.replace(/\bat (?:a |the )?College Football Game\b/g, 'at a college football game');
  // a tabloid's crown on someone goes, the act stays: "Zanane Ulmenko is hailed an ‘Albanian queen’ as she balances a glass" -> "Zanane Ulmenko balances a glass"
  s = s.replace(/\s+(?:is|was|gets|got)\s+(?:hailed|branded|dubbed|crowned)\s+(?:as\s+)?(?:an?\s+|the\s+)?[‘'“"][^’'”"]{2,40}[’'”"]\s+(?:as|after|for|while)\s+(?:she|he|they)\s+/i, ' ');
  // an outlet's praise or scorn goes (never inside a quote: that is someone's words), and a "rant" is a complaint
  s = s.split(/([‘“][^’”]*[’”])/).map((part, i) => (i % 2 ? part : part.replace(EVALUATIVE, '')
    .replace(/\bfor (?:a )?rant\b/gi, 'for a complaint').replace(/\brant(s)?\b/gi, 'complaint$1'))).join('');
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * A one-word quote a Title Case headline capitalised ("‘Pathetic’", "‘Blocking’") in the case the word has everywhere else: a plain
 * word the corpus prints in lowercase and never as a name.
 */
const MID_LINE_COMMON = /(\S\s+)(Internet|Web)\b(?!\s+(?:Explorer|Archive|Summit|Awards?)\b)/g;
function quoteWordCase(text, lex) {
  return String(text || '').replace(/(\s[‘“])(\p{Lu}\p{Ll}+)([’”])(?!\s+(?:video|show|film|movie|series|album|song|tour|special|sketch|podcast|book|trailer|star|cast)\b)/gu, (m, a, w, b) => {
    const k = w.toLowerCase();
    return W.inDict(k) && lex && !lex.proper.has(k) && !W.isFirstName(k) && !W.isProperWord(k) ? `${a}${k}${b}` : m;
  // (and a common noun some outlets capitalise is lowercase mid-line: "The Internet is debating ..." -> "The internet is debating ...")
  }).replace(MID_LINE_COMMON, (m, a, w) => `${a}${w.toLowerCase()}`);
}

/** A line fit to show at all: no heckler's accusation, no unhedged accusation, no label on a private person. */
function unsafeLine(text) {
  return CENSORED.test(text) || (ACCUSE.test(text) && !HEDGE.test(text)) || LABEL.test(text);
}

/**
 * Words the saved titles print capitalised mid-sentence ("Unraveled Tour", "SNL UK") keep their capital in a line; a word only Title
 * Case titles print, always capitalised and in three titles or more, is a name too ("Lambeau"). With the lexicon, a lone capital
 * left over from a Title Case title ("micro Minidress melts", "at MLB Game,") goes lowercase when no sentence-case title capitalises it.
 */
function recaseFrom(text, items, lex = null) {
  const caps = new Map();
  for (const it of items) {
    const toks = W.curlQuotes(it.title).replace(/\s+[-–|]\s+[^-–|]+$/, '').split(/\s+/);
    const titleCase = W.isTitleCase(toks);
    toks.forEach((tok, i) => {
      if (i === 0) return;
      const w = words(tok)[0];
      if (!w || w.length < 3) return;
      const c = caps.get(w) || { up: 0, low: 0, upTC: 0, upSC: 0 };
      const up = /^[^\p{L}]*\p{Lu}/u.test(tok);
      // a Title Case title says nothing about a dictionary word's case, but a word no dictionary has ("Lambeau") is a name either way
      if (titleCase) { if (up) c.upTC++; if (!W.inDict(w)) { if (up) c.up++; else c.low++; } } else if (up) { c.up++; c.upSC++; } else c.low++;
      caps.set(w, c);
    });
  }
  const toks = text.split(' ');
  // a two-word name the lexicon knows keeps both capitals ("Fox News", "Weekend Update", "Lambeau Field")
  if (lex) {
    for (let i = 0; i + 1 < toks.length; i++) {
      const a = words(toks[i])[0];
      const b = words(toks[i + 1])[0];
      if (a && b && /^[^\p{L}]*\p{Lu}/u.test(toks[i]) && /^\p{Ll}/u.test(toks[i + 1]) && (lex.capNames || lex.names).has(`${a} ${b}`) && !W.STOP.has(b)) {
        toks[i + 1] = toks[i + 1].replace(/\p{Ll}/u, (ch) => ch.toUpperCase());
      }
    }
  }
  return toks.map((tok, i) => {
    if (i === 0) return tok;
    const w = words(tok)[0];
    // a name after a hyphenated first name ("Essan-Lyle quilliss" -> "Essan-Lyle Quilliss"), a team no dictionary has ("Knicks"), a name the lexicon pairs
    // with the word before it ("Rotten Tomatoes", "Fox News")
    const prevTok = toks[i - 1] || '';
    const hyphFirst = /^[^\p{L}]*(\p{Lu}\p{Ll}+)-\p{Lu}\p{Ll}+$/u.exec(prevTok);
    if (w && /^\p{Ll}/u.test(tok) && ((hyphFirst && W.isFirstName(hyphFirst[1].toLowerCase())) || (R.TEAM_WORDS.has(w) && !W.inDict(w) && w.endsWith('s')) ||
      (lex && /^[^\p{L}]*\p{Lu}/u.test(prevTok) && W.ENTITY_STOP.has(`${words(prevTok)[0]} ${w}`)))) return tok.replace(/\p{Ll}/u, (ch) => ch.toUpperCase());
    const pairName = W.ENTITY_STOP.has(`${words(prevTok)[0] || ''} ${w}`) || (lex && lex.capNames && lex.capNames.has(`${words(prevTok)[0] || ''} ${w}`));
    if (w && /^\p{Lu}\p{Ll}+$/u.test(tok) && /(?:ed|es)$/.test(w) && W.inDict(w) && W.looksVerb(w) && !pairName && !(caps.get(w) && caps.get(w).up > caps.get(w).low)) return tok.toLowerCase();
    const c = w && caps.get(w);
    if (lex && c && /^\p{Lu}\p{Ll}+[,.;:!?]?$/u.test(tok) && c.upSC === 0 && !lex.proper.has(w) && !lex.firstNames.has(w) && !W.isProperWord(w)) {
      // a lone capital between lowercase words, or after an acronym ("MLB Game,"), that no sentence-case title prints
      const prev = toks[i - 1] || '';
      const next = toks[i + 1] || '';
      const lowerCtx = (/^\p{Ll}/u.test(prev) || /^\p{Lu}{2,}$/u.test(prev) || /[’”]$/.test(prev)) && (!next || /^[\p{Ll}(]/u.test(next) || /[,.;:!?]$/.test(tok));
      if (lowerCtx && (W.inDict(w) || c.upTC <= 1)) return tok.toLowerCase();
    }
    if (c && !/^[^\p{L}]*\p{Lu}/u.test(tok) && c.low === 0 && c.upTC >= 3 && !W.inDict(w)) return tok.replace(/\p{Ll}/u, (ch) => ch.toUpperCase());
    // a word no dictionary has ("Lambeau") is a name after one capitalised use; a dictionary word needs two
    if (!c || c.up < (W.inDict(w) ? 2 : 1) || c.low > 0 || /^[^\p{L}]*\p{Lu}/u.test(tok)) return tok;
    return tok.replace(/\p{Ll}/u, (ch) => ch.toUpperCase());
  }).join(' ');
}

/**
 * Names of private people: a name right after a role noun ("teacher Dovia Kelsy", "woman Korelle Fennick") or one that only
 * one or two outlets print. Lines naming them are not shown.
 */
// (the roles that make the name after them a private person's; lib/entity/graph.js crosses no such name to another story)
const PRIVATE_ROLES = ['dancer', 'teacher', 'nurse', 'woman', 'man', 'mom', 'mum', 'dad', 'fan', 'concertgoer', 'shopper', 'student', 'worker', 'staffer', 'employee', 'wife', 'husband',
  'girlfriend', 'boyfriend', 'neighbor', 'neighbour', 'customer', 'passenger', 'driver', 'influencer', 'tiktoker', 'mother', 'father', 'daughter', 'son'];
const ROLE_BEFORE_NAME = new RegExp(`\\b(?:${PRIVATE_ROLES.join('|')})\\s+((?:\\p{Lu}[\\p{L}’'-]+\\s?){2,3})`, 'u');
function privateNames(items, nameSources) {
  const out = new Set();
  for (const it of items) {
    const m = W.curlQuotes(it.title).match(ROLE_BEFORE_NAME);
    if (m) out.add(words(m[1]).join(' '));
  }
  // a person's name (it opens with a first name; not a team, a place or a show) that only one or two outlets print
  for (const [n, k] of nameSources) if (k <= 2 && n.split(' ').length >= 2 && W.isFirstName(n.split(' ')[0]) && !R.isPlaceOrTeam(n)) out.add(n);
  return out;
}
const namesPrivate = (text, priv, keep) => { const tw = words(text).join(' '); return [...priv].some((n) => !keep.has(n) && contains(tw, n)); };

module.exports = {
  byline, FUTURE, VAGUE, NAME_GLOSS, otherBearer, CLICKBAIT, VERDICT, HEARSAY, RESULT, RETRO, GRAVE_EVENT, NO_ACTION, BAIT_TITLE, BACKLASH, TURN, MOMENT_FRAME, META, CONFLICT, SELF_DEFENSE, REVIEW, EXPLAINER, LOGISTICS, STAKES, EVENT, SCALE_NUM, OPINION, LABEL, ACCUSE, HEDGE, CENSORED,
  CONTRADICT_BOO, ROMANCE, ACCIDENT, CORRECTION, MAJOR, outletQuality, titleKey, contentStems, docFreq, consensusOf, minorityWords,
  correctionsOf, correctionClause, safeLine, unsafeLine, recaseFrom, privateNames, namesPrivate, quoteWordCase, PRIVATE_ROLES, ROLE_BEFORE_NAME,
};
