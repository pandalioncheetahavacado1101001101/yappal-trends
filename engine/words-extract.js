'use strict';
/*
 * "Words & trends", step 1: which viral word, catchphrase, sound or craze a piece of text is about, and any plain definition
 * the same text gives for it. Sources: explainer titles ("What does 'mogging' mean on TikTok?"), trend names ("'Salt Stepping'
 * Is the New Bedtime Trend"), slang roundups ("From '67' to 'aura'"), Know Your Meme entries and its weekly roundup, Bluesky
 * culture trends and Google Trends meaning queries ("what does wharfie time mean"). Also when a term began ("went viral in
 * late 2025"), so an old word covered again is not sold as new. Regular expressions only, so it ports 1:1 to
 * NSRegularExpression.
 */
const W = require('./wording');
const { PLACES } = require('./rules');
const { termKey } = require('./words-keys');

const MAX_TERM_WORDS = 9; // a quoted catchphrase ("Me at the Same Age As My Parents"); an unquoted term stays within 4
const MAX_BARE_WORDS = 4;
const MAX_TERM_CHARS = 48;
const TERM_LIMIT = { words: MAX_TERM_WORDS, chars: MAX_TERM_CHARS };
// Know Your Meme files long captions as entry names ("When the Friend Group Is Separated So Everyone Is Experiencing Their Own Arc")
const KYM_NAME_LIMIT = { words: 14, chars: 90 };
const MEANING_MAX_WORDS = 26;
const QUOTE_SPAN = 50;
const KYM_QUOTE_SPAN = 90;

/** A quoted span of up to `span` characters: 'mogging', “Quiet on the Creek”, ‘That’s so AI!’ (an apostrophe followed by a letter stays inside). */
const quoted = (span) => `(?<![\\w’'])["“‘']((?:[^"“”‘’']|['’](?=\\w)){1,${span}}?)["”’'](?=$|[\\s,.:;!?)—–/-])`;
const BARE = `([\\w’'-]+(?: [\\w’'-]+){0,2}?)`;
const KIND_TREND = 'trends?|challenges?|memes?|dances?|filters?|pranks?|formats?|craze|game|test|incident|theory|gifs?|edits?|aesthetic';
const KIND_SOUND = 'audio|sound|song';
const KIND_PHRASE = `${KIND_SOUND}|quote|catchphrase|phrase|saying|chant`;
const KIND_WORD = 'slang term|slang word|slang|term|word|emote|insult|compliment|acronym|expression';
const KIND_ANY = `${KIND_TREND}|${KIND_PHRASE}|${KIND_WORD}`;
// "What's up with the 'X' video?" is a moment, not a word: those kinds never make a term
const KIND_SKIP = /^(videos?|clips?|discourse|controvers(y|ies)|drama|feud|scandal|lawsuit|app|error|feature|update|debate|incident report)$/i;
const TREND_KIND_RE = new RegExp(`^(${KIND_TREND})$`, 'i');
const PHRASE_KIND_RE = new RegExp(`^(${KIND_PHRASE})$`, 'i');
const SOUND_KIND_RE = new RegExp(`^(${KIND_SOUND})$`, 'i');
// a quoted name that carries its own kind word and nothing after it: "the ‘Ghost Paper Trend’" (not "‘Squid Game’")
const QUOTED_TREND_TAIL = /\s(trends?|challenges?|memes?|dances?|filters?|pranks?|formats?|craze)$/i;

// Title contexts
const SLANG_CONTEXT = /\b(slang\w*|lingo|dictionary|vocab\w*|new words|words|terms|phrases|insults?|buzzwords?|language)\b/i;
const ROUNDUP_SKIP = /\b(campaign|brand|ads?|quiz|crossword|connections|wordle|spelling bee|hints?)\b/i;
const DICTIONARY_CONTEXT = /\b(dictionary|merriam|webster|oxford english|collins|new words|entries)\b/i;
// a daily word column picks a word every day whether or not anyone is saying it: real, but no sign of a moment
const COLUMN = /^(today['’]s slanguage|worldwide wednesday|word of the day|slang of the day)\b/i;
const TREND_CONTEXT = /\b(trend\w*|memes?|challenge|tiktok|viral|slang|meaning|explained|internet|kids|teens|gen z|gen alpha)\b/i;
// A song's meaning is a music story ("What Does 'Patient Zero' Mean? ... Taylor Swift's New Song"), unless the song is a viral sound
const SONG_CONTEXT = /\b(song|lyrics?|album|single|track|freestyle|mixtape|verse)\b|\bby [A-Z]/i;
const VIRAL_SOUND = /\bviral\b.*\b(tiktok|sound|audio)\b|\b(tiktok|sound|audio)\b.*\bviral\b/i;
const TECH_CONTEXT = /\b(error|apps?|settings|feature|update|snapchat|iphone|android|bug|account|password|parameters?|valuation|stocks?|market|price)\b/i;
// Know Your Meme forum/gallery pages that Google News also indexes ("It's time to cook a mushroom | /r/grimdank")
const KYM_JUNK = /\s\|\s|\/r\//;
// a meme-explainer series that names its meme after a bar: "MEMES EXPLAINED! | LA PEACE"
const MEMES_EXPLAINED = /^memes explained!?\s*\|\s*(.+)$/i;
// Know Your Meme's own weekly pick: "Weekly Meme Roundup: Robert Pattinson Lyrics, Speed GTA, Gavin Dorman And More"
const KYM_ROUNDUP = /^(?:the )?weekly meme roundup: (.+?),? and more\b/i;
// a possessive that is a platform or a place is not the owner of a work: "TikTok’s “Anti-Blush” Trend" names a trend
const PLATFORM_OWNER = /^(tiktok|instagram|youtube|twitter|x|reddit|internet|america|britain|australia)$/i;

// Words that open a trend name without being part of it ("This TikTok Beauty Trend") or describe it ("Bizarre New Bedtime Trend").
const TREND_LEAD_STOP = new Set(`this that these those the a an latest newest new viral bizarre weird wild strange creepy disturbing
  dangerous sinister terrifying scary favorite favourite coolest hottest biggest big huge massive popular trending trendy tiktok
  tiktoks tiktok’s tiktok's gen z alpha social media beauty makeup fashion fitness sleep wellness party shower food diet summer fall
  winter spring internet online latest is are was were has have had just wore do does how to try join make why what who everyone
  people users women men girls boys kids teens parents moms dads its it's it’s our your my their his her year week after before with
  for from into over during amid about sparks reactions reveals says shares iconic classic famous infamous legendary beloved
  original wildest bigger better best greatest real true`.split(/\s+/));
const GENERIC_TREND_WORDS = new Set(`beauty makeup skincare hair nails nail outfit style fashion fitness workout sleep diet food recipe
  wellness shower dating travel party jacket shoes dress photo video ai app filter sound song dance challenge trend meme`.split(/\s+/));
// a term needs one word beyond these ("TikTok trend", "viral challenge" name nothing)
const TERM_GENERIC = new Set(`tiktok tiktoks viral trend trends meme memes challenge challenges internet social media gen z alpha instagram
  youtube reels x new latest ai photo video dance sound audio slang word words term terms phrase online app`.split(/\s+/));
const PRONOUN = /^(it|this|that|they|he|she|you|i|we|me|him|her|them|us|what|who|there|here|one|someone|everyone)$/i;
const LEAD_DET = /^(the|a|an|this|that|these|those|your|my|our|their|his|her|its)\s/i;
const PERSONA = /^(an? |the )?(?:[\w-]+ ){0,4}(reviewer|streamer|youtuber|tiktoker|influencer|creator|persona|character|person|rapper|singer|comedian|artist|account|mascot|user|family|couple|actor|actress|athlete|dog|cat)\b/i;
const KYM_MOMENT = /\b(controvers\w*|discourse|drama|feud|scandal|lawsuit|death|arrest\w*|shooting|incident|accident|debate|beef)\b/i;
const KYM_TREND = /\b(trends?|challenges?|dances?|formats?|filters?|templates?|styles?|redraws?|edits|parod(?:y|ies)|series of (?:memes|videos|jokes|edits|skits|posts|images|reactions|parodies)|jokes|memes|gifs?|image macros?|copypastas?|photoshops?|exploitables?|snowclones?)\b/i;
const KYM_SPEECH = /\b(catchphrase|phrase|expression|slang|term|saying|says|say|said|singing|sings|chant\w*|shout\w*|quote|audio|sound|lyrics?|line)\b/i;
// A term that reads like something said: a pronoun, a contraction or an exclamation ("That's My Husband", "You Play Games")
const QUOTE_LIKE = /\b(i|i'm|i’m|you|we|my|me|your|it's|it’s|that's|that’s|don't|don’t|can't|can’t|let's|let’s|oh|no no)\b|!/i;

const cleanTerm = (raw) => (raw || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
  .replace(/^[\s"“”‘’'(]+|[\s"“”‘’',.:;!?)]+$/g, '').replace(/\s+explained$/i, '').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "LA PEACE" -> "La peace": a shouted name with a dictionary word in it is written in sentence case; "GG EZ", "KEKW" stay. */
function unshout(t) {
  if (!/[A-Z]{4,}/.test(t) || /[a-z]/.test(t)) return t;
  const plainWord = t.split(' ').some((w) => w.length >= 4 && W.inDict(w.toLowerCase().replace(/[^a-z]/g, '')));
  return plainWord ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

function validTerm(t, bare, lim = TERM_LIMIT) {
  const ws = t.split(' ');
  if (!t || t.length < 1 || t.length > lim.chars || ws.length > lim.words) return false;
  if (ws.every((w) => W.STOP.has(w.toLowerCase()) || TERM_GENERIC.has(w.toLowerCase().replace(/[’']s$/, '')))) return false;
  if (PRONOUN.test(t) || /^\d{4}$/.test(t) || /\?/.test(t)) return false;
  if (bare && (LEAD_DET.test(t) || ws.length > MAX_BARE_WORDS)) return false;
  return true;
}
const isCoinage = (w) => !W.isDictWord(w.toLowerCase().replace(/[’']/g, ''));
/** An unquoted term is trusted when it carries a kind word or a word no dictionary knows ("gyatt", "KEKW", "sleepmaxxing"). */
function bareOk(t, kindWord) {
  if (kindWord) return true;
  const ws = t.split(' ');
  return ws.some((w) => isCoinage(w) || /^[A-Z0-9]{2,6}$/.test(w));
}

function kindOf(kindWord, term) {
  const kw = (kindWord || '').toLowerCase();
  if (kw && TREND_KIND_RE.test(kw)) return 'trend';
  if (kw && SOUND_KIND_RE.test(kw)) return 'sound';
  if (kw && PHRASE_KIND_RE.test(kw)) return 'phrase';
  return term.split(' ').length > 1 ? 'phrase' : 'word';
}

/** The title regexes, built for a quoted span of `span` characters (Know Your Meme's own explainers quote long captions). */
function buildRX(span) {
  const Q = quoted(span);
  return {
    Q,
    // "What does 'mogging' mean on TikTok?", "What Does it Mean When Kids Say 'Mogging'?", "What does gyatt mean? Internet slang explained"
    mean: new RegExp(`\\bwhat (?:does|do) (?:it mean when (?:\\w+ ){1,2}(?:say|says|call|calls|use|uses) |(?:the )?(?:slang |word |term |phrase |acronym |emoji )?)(?:${Q}|${BARE})(?: actually| really)? means?\\b(?! for\\b| to (?:you|me|us|investors|fans)\\b)`, 'i'),
    // "What is the F74 trend on TikTok?", "What's Up With All The 'Chile' Memes?", "WTF Is A 'Skill Issue'", "What is mewing on TikTok?"
    whatIs: new RegExp(`^(?:so )?(?:what|wtf|who)(?:['’]s| is| are)(?: up with| the deal with)? (?:all )?(?:the |a |an |this |tiktok['’]s |the viral |viral )?(?:viral )?(?:${Q}|${BARE})(?: (${KIND_ANY}|videos?|clips?|discourse|controversy|app))?(?: (?:on|from) tiktok)?(?=\\s*(?:\\?|:|$| and\\b| [–-] |, ))`, 'i'),
    // "'Cookie McDouble' trend", "“Me at the Same Age As My Parents” TikTok Trend", "'you see how this looks, right' Primetime quote"
    quotedKind: new RegExp(`${Q}(?: (?:tiktok|viral|ai|photo|dance|social media|primetime|internet|online|new))* (${KIND_ANY})\\b`, 'i'),
    // "'Salt Stepping' Is the Bizarre New Bedtime Trend ...", "'Quiet On The Creek' Is Taking Over The Internet"
    quotedIsA: new RegExp(`${Q},? (?:(?:is|are) (?:suddenly |now |officially )?(?:taking over (?:the internet|tiktok|social media|your fyp)|(?:the |a |an )(?:[\\w’'-]+ ){0,4}(${KIND_ANY})\\b)|(?:the |a |an )(?:[\\w’'-]+ ){0,4}(${KIND_ANY})\\b)`, 'i'),
    // "This TikTok trend has users 'blockin' the street'"
    trendHas: new RegExp(`\\b(?:trend|challenge) (?:that )?(?:has|gets|sees) (?:users|people|everyone|women|men|kids|parents|couples|gen z|fans) ${Q}`, 'i'),
    // "Why TikTok users are suddenly calling things 'polyester'", "Why Do Kids Keep Saying 'X'"
    calling: new RegExp(`\\b(?:calling (?:things|everything|everyone|people|someone|each other|it|them|their \\w+)|(?:kids|teens|people|everyone|gen z|gen alpha|fans|users) (?:are |keep |keeps )?(?:suddenly )?(?:saying|say|singing|chanting|using|shouting)|the (?:word|phrase|term|slang|catchphrase)) ${Q}`, 'i'),
    // "Double cleansing: The bizarre Gen Z shower trend", "Absolute Cinema: Meaning, Origins, and Why It Became a Viral Meme"
    colon: new RegExp(`^(?:${Q}|([\\w’'-]+(?: [\\w’'-]+){0,3})): (?:the |a |an )?(?:[\\w’'-]+ ){0,4}(${KIND_ANY}|meaning|origins?)\\b`, 'i'),
    // "Sleepmaxxing trend takes over TikTok", "'Cookie McDouble' trend has some McDonald's customers 'McMad'"
    startTrend: new RegExp(`^(?:${Q}|([\\w’'-]+(?: [\\w’'-]+){0,2})) (?:tiktok |viral |ai )*(trend|challenge|craze)\\b`, 'i'),
    // "How to do the Hotel Lobby AI trend", "How to do TikTok's photo swipe trend"
    howTo: new RegExp(`\\bhow to (?:do|try|make|join) (?:the |that |this |tiktok['’]s )?(?:viral )?(?:${Q}|([\\w’'-]+(?: [\\w’'-]+){0,4}?)) (?:(?:ai|photo|tiktok|viral) )*(trend|challenge|filter|dance)\\b`, 'i'),
    // "Soup Swaps Are The Latest Party Trend On TikTok"
    latest: new RegExp(`^(?:${Q}|([\\w’'-]+(?: [\\w’'-]+){0,3})) (?:is|are) (?:the |a )(?:latest|newest|new|hottest|biggest) (?:[\\w-]+ ){0,3}(trend|craze|challenge|obsession)\\b`, 'i'),
    // "Epsom Salt Foot Stomping Is TikTok’s Cheapest Sleep Trend"
    platformIs: new RegExp(`^(${Q}|[\\w’'-]+(?: [\\w’'-]+){0,3}) (?:is|are) (?:tiktok['’]s|the internet['’]s) (?:[\\w’'-]+ ){0,2}(trend|craze|challenge)\\b`, 'i'),
    // "Deeper meaning behind Robert Pattinson's 'you see how this looks, right' Primetime quote"
    meaningBehind: new RegExp(`\\b(?:meaning|story|origin)s? (?:of|behind) (?:[\\w’'.-]+ ){0,3}?(?:[\\w’'.-]+['’]s )?${Q}`, 'i'),
    // a lowercase coinage right before trend/challenge: "sleepmaxxing trend", "door-kicking TikTok trend"
    coinage: /\b([a-z][a-z-]{3,}(?:maxxing|core|tok|ing|ers))\b (?:tiktok )?(?:trend|challenge)\b/,
    // a run of capitalised words before (TikTok|AI|Photo) Trend|Challenge|Meme|Theory: "Low-Cortisol Workout Trend", "Polar Bear 2026
    // Meme", "The Viral October Theory Is Back"
    capRun: /((?:[A-Z][\w’'-]*|\d[\w-]*)(?: (?:[A-Z][\w’'-]*|\d[\w-]*|of|in|the|a|and|my|to|at|as)){0,5}) (?:(?:TikTok|AI|Photo|Viral|Social Media) )*(Trend|Challenge|Meme|Theory|trend|challenge|theory)\b(?: (\S+))?/,
    roundupFromTo: /^from ([\w-]+(?: (?!and\b)[\w-]+)?) to ([\w-]+(?: (?!and\b)[\w-]+)?)(?: and ([\w-]+))?\b/i,
    quotedAll: new RegExp(Q, 'g'),
    // Know Your Meme's own explainer template, syndicated on Yahoo: "What Is The 'X' Meme? The Viral ... Explained"
    kymTemplate: /^(?:what(?:['’]s| is| are)|who (?:is|are)|why is|where did) .+\? the .+ explained$/i,
    trendsMean: /^(?:what does (.+) mean|what is (.+) slang|(.+) (?:meaning|slang|slang meaning))$/i,
  };
}
const RX = buildRX(QUOTE_SPAN);
const RX_KYM = buildRX(KYM_QUOTE_SPAN);
const CONNECTOR = new Set(['of', 'in', 'the', 'a', 'and', 'my', 'to', 'at', 'as']);
/** Where a title's question ends: the first "?" outside a quote ("What Is The 'Why Would I Deceive You?' Meme? The ..." -> after "Meme"). */
function questionEnd(title) {
  const m = title.match(/\?(?![’'”"])(?=\s|$)/);
  return m ? m.index : -1;
}
const NAME_KINDS = /^(test|incident|theory|game|dance|filter|prank|challenge)$/i;
// what may follow "... Trend" when the run before it is a trend's name ("Trend Takes Over", "Trend On TikTok"; not "Trend Tracker")
const NEXT_OK = /^(on|in|is|are|has|have|that|of|with|for|to|from|at|as|and|by|among|amid|explained|,)[,:]?$/i;

/** The trend name inside a run of capitalised words: collected from the right until a lead-in word ("This TikTok Beauty" -> none). */
function trendNameFromRun(run) {
  const ws = run.split(' ');
  while (ws.length > 1 && /^(ai|photo|tiktok|viral)$/i.test(ws[ws.length - 1])) ws.pop(); // "Hotel Lobby AI (Trend)"
  const out = [];
  for (let i = ws.length - 1; i >= 0; i--) {
    const low = ws[i].toLowerCase().replace(/[’']s$/, '');
    if (TREND_LEAD_STOP.has(low) || /[’']s$/.test(ws[i]) && i < ws.length - 1 && out.length === 0) break;
    if (/[’']s$/.test(ws[i])) break; // "Kenya's On-Stage Cash Gift": the possessive owner is not the name
    if (W.looksVerb(ws[i]) || (/ing$/i.test(ws[i]) && W.isDictWord(ws[i].toLowerCase()))) break; // "... After Joining (Viral Challenge)"
    out.unshift(ws[i]);
  }
  while (out.length && CONNECTOR.has(out[0].toLowerCase())) out.shift();
  const content = out.filter((w) => !CONNECTOR.has(w.toLowerCase()));
  if (!content.length) return null;
  if (content.every((w) => GENERIC_TREND_WORDS.has(w.toLowerCase()))) return null;
  if (content.length === 1 && ((!isCoinage(content[0]) && !/\d/.test(content[0])) || content[0].length < 4)) return null; // "Jacket", "PR"
  return out.join(' ');
}
/** A "theory" names a craze only as a short plain name ("October theory"); "Taylor Swift Fan Theory" is a fan theory about a person. */
const theoryName = (name) => name.split(' ').length <= 2 && !name.split(' ').some((w) => /^(fan|fans|conspiracy)$/i.test(w) || W.isFirstName(w.toLowerCase()));

/** The name as sources write it with its kind: "Hotel Lobby" + "... the Hotel Lobby AI trend from TikTok" -> "Hotel Lobby AI trend". */
function withKindOf(title, term, kindWord) {
  if (!kindWord || new RegExp(`\\s(${KIND_ANY})$`, 'i').test(term)) return null;
  const t = escapeRe(term).replace(/[’']/g, "['’]");
  const m = title.match(new RegExp(`${t}["”’']?((?: (?:ai|photo|tiktok|viral|dance|filter|beauty|makeup))*) (${escapeRe(kindWord)})\\b`, 'i'));
  return m ? `${term}${m[1]} ${m[2].toLowerCase()}` : null;
}

/**
 * Terms one title is about: [{ term, kind, role, secondary, withKind }]. role: 'explainer' (the title explains the term),
 * 'roundup' (a slang list), 'dictionary' (dictionary additions: real but not new), 'column' (a word-of-the-day column: real,
 * no sign of a moment), 'kym-roundup' (Know Your Meme's weekly pick). secondary: named only in an explainer's second clause
 * ("... The Viral 'Family Guy' Trend Explained"), so it is an alias of the first term and never a term of its own.
 */
function termsFromTitle(rawTitle, { isReddit = false } = {}) {
  const title = W.foldGDrop(W.curlQuotes(rawTitle || ''));
  if (!title) return [];
  const out = [];
  const series = title.match(MEMES_EXPLAINED);
  const roundup = title.match(KYM_ROUNDUP);
  if (!series && KYM_JUNK.test(title)) return [];
  // Know Your Meme's own explainers quote whole captions ("'How It Feels to Cook A Yummy Meal As A Boy'")
  const kymT = RX.kymTemplate.test(title);
  const rx = kymT ? RX_KYM : RX;
  const lim = kymT ? KYM_NAME_LIMIT : TERM_LIMIT;
  const column = COLUMN.test(title);
  const q = questionEnd(title);
  const add = (raw, kindWordIn, role, bare, at) => {
    let term = unshout(cleanTerm(raw));
    // a quoted name that ends in its kind: "'Parent Split-Face Trend'"
    const tail = (term.match(new RegExp(`\\s(${KIND_ANY})$`, 'i')) || [])[1];
    const kindWord = kindWordIn || tail;
    if (!validTerm(term, bare, lim) || (bare && !bareOk(term, kindWord))) return;
    if (kindWord && KIND_SKIP.test(kindWord)) return;
    if (bare && q > 0 && at > q) return; // after the question only a quoted name is trusted (an alias), never a capitalised run
    const withKind = withKindOf(title, term, kindWord);
    // the kind word is part of the name: "Beckham test", "December 22 incident", "battle trend" (a plain word alone says nothing)
    if (kindWord && !tail && (NAME_KINDS.test(kindWord) || (/^trends?$/i.test(kindWord) && term.split(' ').length === 1 && !isCoinage(term)))) {
      term = `${term} ${kindWord.toLowerCase()}`;
    }
    out.push({ term, kind: kindOf(kindWord, term), kindWord: (kindWord || '').toLowerCase(), role: column ? 'column' : role, bare: !!bare,
      secondary: q > 0 && at > q && out.length > 0, ...(withKind && withKind !== term ? { withKind } : {}) });
  };
  if (series) { add(series[1], null, 'explainer', false, 0); return out; }
  if (roundup) { for (const n of roundup[1].split(/,\s+/)) add(n, null, 'kym-roundup', false, 0); return out; }
  const songOnly = SONG_CONTEXT.test(title) && !VIRAL_SOUND.test(title);
  const tech = TECH_CONTEXT.test(title);
  let m;
  // "What does X mean?" / "What is X?" is written because people are searching it: a stronger signal than a passing trend story
  if (!isReddit && !tech && !songOnly && (m = title.match(rx.mean))) add(m[1] || m[2], null, 'asked', !m[1], m.index);
  if (!isReddit && !tech && (m = title.match(rx.whatIs))) {
    const kw = m[3];
    const who = /^(?:so )?who/i.test(title); // "Who is Hasbulla?" is a person; "Who Are 'Wawario' And 'Wawaluigi'? The Viral Memes" a meme
    const ok = who ? (kw || (m[1] && /\bmemes?\b/i.test(title)))
      : m[1] ? true : (kw || /on tiktok/i.test(m[0]) || TREND_CONTEXT.test(title.slice(m[0].length)));
    if (ok && !(songOnly && !/\bsong\b/i.test(kw || ''))) add(m[1] || m[2], kw, 'asked', !m[1], m.index);
  }
  for (const re of [rx.quotedKind, rx.quotedIsA, rx.calling, rx.meaningBehind, rx.trendHas]) {
    const g = new RegExp(re.source, 'gi');
    while ((m = g.exec(title))) {
      const kw = m[2] || m[3] || (re === rx.trendHas ? 'trend' : null);
      // "Eric Stonestreet signs his 'Modern Family' meme": a work's title owned by someone is not the meme's name
      // ("TikTok’s “Anti-Blush” Trend" is the platform's trend, not TikTok's work)
      if (re === rx.quotedKind) {
        const own = title.slice(0, m.index).match(/(?:\b(his|her|their|its)|(\S+)['’]s)\s$/i);
        const platform = own && own[2] && PLATFORM_OWNER.test(own[2]);
        if (own && !platform && !PHRASE_KIND_RE.test(kw || '')) continue;
      }
      add(m[1], kw, 'explainer', false, m.index);
    }
  }
  // "Watches the ‘Ghost Paper Trend’ and ...": a quoted name that ends in its own kind word
  for (const qm of title.matchAll(new RegExp(rx.Q, 'g'))) if (QUOTED_TREND_TAIL.test(qm[1].trim())) add(qm[1], null, 'explainer', false, qm.index);
  // "Absolute Cinema: Meaning, Origins, and Why ...": a title that promises the meaning trusts an unquoted name
  if ((m = title.match(rx.colon)) && (!/^(meaning|origins?)$/i.test(m[3]) || /\b(memes?|slang|viral|tiktok|trend\w*)\b/i.test(title))) {
    add(m[1] || m[2], /^(meaning|origins?)$/i.test(m[3]) ? null : m[3], 'explainer', !m[1] && !/^(meaning|origins?)$/i.test(m[3]), 0);
  }
  // an unquoted opening ("AI Face-Swap Trend Puts Celebrities Into ... 'Hotel Lobby'") yields to a quoted name in the same title
  if ((m = title.match(rx.startTrend)) && (m[1] || !new RegExp(rx.Q).test(title))) add(m[1] || m[2], m[3], 'explainer', !m[1], 0);
  if ((m = title.match(rx.howTo))) add((m[1] || m[2] || '').replace(/\s+(ai|photo|tiktok)$/i, ''), m[3], 'explainer', !m[1], m.index);
  if ((m = title.match(rx.latest))) add(m[1] || m[2], m[3], 'explainer', !m[1], 0);
  if ((m = title.match(rx.platformIs))) add(m[1], m[3], 'explainer', !/^["“‘']/.test(m[1]), 0);
  if ((m = title.match(rx.coinage)) && isCoinage(m[1])) add(m[1], 'trend', 'explainer', true, m.index);
  // a capitalised run only names a trend in a title that quotes nothing ("AI Face-Swap Trend Puts Celebrities Into ... 'Hotel Lobby'")
  if (!new RegExp(rx.Q).test(title) && (m = title.match(rx.capRun)) && !(m[3] && /^[A-Z]/.test(m[3]) && !W.looksVerb(m[3]) && !NEXT_OK.test(m[3]))) {
    const name = trendNameFromRun(m[1]);
    if (name && (!/^theory$/i.test(m[2]) || theoryName(name))) add(name, m[2], 'explainer', true, m.index);
  }
  // slang lists and dictionary additions: every short quoted span, plus "From rizz to unc and 67"
  if (SLANG_CONTEXT.test(title) && !ROUNDUP_SKIP.test(title) && !songOnly) {
    const role = DICTIONARY_CONTEXT.test(title) ? 'dictionary' : 'roundup';
    const g = new RegExp(rx.quotedAll.source, 'g');
    while ((m = g.exec(title))) if (m[1].split(/\s+/).length <= 4 && !out.some((o) => o.term === cleanTerm(m[1]))) add(m[1], null, role, false, m.index);
    if ((m = title.match(rx.roundupFromTo))) [m[1], m[2], m[3]].filter(Boolean).forEach((t) => add(t, 'slang', role, false, 0));
    // one quoted term in a slang title is that term's explainer ("‘That’s so AI!’ What gen Alpha’s biggest insult tells us")
    const listed = out.filter((o) => o.role === role);
    if (role === 'roundup' && !column && listed.length === 1 && out.length === 1) listed[0].role = 'explainer';
  }
  // one term once per title (the first, most specific reading wins)
  const seen = new Set();
  return out.filter((o) => { const k = o.term.toLowerCase(); return seen.has(k) ? false : seen.add(k); });
}

/** The name(s) a Know Your Meme entry is filed under: "Parent Split-Face / Family Resemblance Trend" -> both; a quoted part wins. */
function kymNames(title, lim = KYM_NAME_LIMIT) {
  return (title || '').replace(/\s+-\s+Know Your Meme$/i, '').split(' / ').map((n) => {
    const q = W.curlQuotes(n).match(/[“"]([^”"]{2,80})[”"]/);
    return cleanTerm(q ? q[1] : n.replace(/^[\w.’'-]+(?: [\w.’'-]+)?['’]s\s+(?=[“"])/, ''));
  }).filter((n) => validTerm(n, false, lim));
}

/** The predicate of a Know Your Meme definition: "X, sometimes known as Y, is a series of memes ..." -> "a series of memes ...". */
function kymPredicate(desc, name) {
  const first = (desc || '').split(/(?<=[a-z0-9)”"'’])\.\s/)[0];
  const at = name ? first.toLowerCase().indexOf(name.toLowerCase().slice(0, 20)) : -1;
  const rest = at === 0 ? first.slice(name.length) : first;
  const m = rest.match(/^(?:.{0,160}?)\s(?:is|are|was|refers to)\s(.+)$/i);
  return m ? m[1] : null;
}

/** A KYM definition of a character or a picture people repost ("memes based on a viral image of a ... child"), not a word, sound or format. */
function kymImageMeme(pred) {
  const ws = (pred || '').split(/\s+/);
  return IMAGE_MEME.test(ws.slice(0, 24).join(' ')) && !FORMAT_WORD.test(ws.slice(0, 12).join(' '));
}
/** A KYM definition of a person, a one-off moment or a picture ("a French internet persona", "... Controversy refers to viral discourse"). */
function kymPersonOrMoment(pred, name) {
  const head = (pred || '').split(/\s+/).slice(0, 12).join(' ');
  return (PERSONA.test(head) && !KYM_TREND.test(head)) || KYM_MOMENT.test(name || '') || KYM_MOMENT.test(head.split(/\s+/).slice(0, 5).join(' ')) ||
    kymImageMeme(pred);
}

const IMAGE_MEME = /\b(?:memes?|jokes|edits|reposts) (?:using|based (?:around|on)|of|featuring|depicting)\b[^.]{0,100}?\b(?:character|image|photo|picture|drawing|screenshot|portrait|aesthetic)\b/i;
const FORMAT_WORD = /\b(trends?|challenges?|formats?|templates?|captions?|catchphrases?|phrases?|audio|sounds?|songs?|dances?|filters?|redraws?|lip ?dubs?|video clip)\b/i;
/** What kind of entry a KYM definition describes: 'trend' | 'sound' | 'phrase' | 'word' | null (a person, a moment, a one-off video). */
function kymKind(pred, name) {
  if (!pred) return null;
  const head = pred.split(/\s+/).slice(0, 12).join(' ');
  if (PERSONA.test(head) && !KYM_TREND.test(head)) return null;
  // "Last Ditch Bar Mask-Optional Controversy ... refers to viral online discourse and memes": a moment, listed with the moments
  if (KYM_MOMENT.test(name) || KYM_MOMENT.test(head.split(/\s+/).slice(0, 5).join(' '))) return null;
  // "GG EZ is an AI-generated K-pop song ...": a sound people use, not a format
  if (/\b(song|audio|sound|remix)\b/i.test(head.split(/\s+/).slice(0, 8).join(' ')) && !/\b(challenges?|dances?)\b/i.test(head)) return 'sound';
  // "... a viral video clip of IShowSpeed skating and singing, “Happy day, Ronaldo day”": the entry is the line people sing or say
  const sung = W.curlQuotes(pred).match(/\b(?:sing\w*|sung|says|saying|shout\w*|chant\w*),?\s*[“"‘]([^”"’]{2,80})[”"’]/i);
  if (sung && termKey(sung[1]) === termKey(name)) return /\bsing\w*|sung|chant\w*/i.test(sung[0]) ? 'sound' : 'phrase';
  // "memes using a creepy aesthetic based around ... the character Bart Simpson", "memes based on a viral image of a ... child": a
  // character or a picture people repost, not a word, a sound or a format to copy
  if (kymImageMeme(pred)) return null;
  const quoteLike = QUOTE_LIKE.test(name) || name.split(' ').length >= 4 && W.verbIndex(name.split(' ')) > 0;
  if (/\b(trends?|challenges?|dances?|formats?|filters?|templates?|redraws?)\b/i.test(head)) return 'trend';
  if (KYM_SPEECH.test(pred.split(/\s+/).slice(0, 24).join(' ')) && (quoteLike || /\b(catchphrase|phrase|slang|term|audio|sound|saying)\b/i.test(head))) {
    return /\b(slang|term)\b/i.test(head) && name.split(' ').length === 1 ? 'word' : 'phrase';
  }
  // "Robert Pattinson as Chris Hansen Rap Lyric Memes" names a format by its own kind word, however much it reads like a line
  if (KYM_TREND.test(head)) return quoteLike && !/\b(memes?|trends?|challenges?|edits?|formats?)$/i.test(name) ? 'phrase' : 'trend';
  // a single viral video ("If You Log Out, It's Still 2007 is a viral YouTube video") is a moment, not a word or a craze
  return null;
}

/**
 * An entry page's definition: the first two paragraphs of its "About" section (the definition, then usually when it began), else
 * its og:description, which Know Your Meme cuts off mid-word. { desc, name } or null.
 */
function kymPageSummary(html) {
  const page = html || '';
  const meta = (prop) => {
    const a = page.match(new RegExp(`<meta\\s+(?:property|name)=(["'])${prop}\\1\\s+content=(["'])(.*?)\\2`, 'i'));
    const b = page.match(new RegExp(`<meta\\s+content=(["'])(.*?)\\1\\s+(?:property|name)=(["'])${prop}\\3`, 'i'));
    return a ? decodeHtml(a[3]).trim() : b ? decodeHtml(b[2]).trim() : '';
  };
  const about = page.match(/<h2 id=["']about["'][^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|$)/i);
  const paras = about ? (about[1].match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).slice(0, 3) : [];
  const text = paras.map((p) => decodeHtml(p.replace(/<[^>]+>/g, '')).trim()).filter(Boolean).join(' ');
  const desc = text || meta('og:description') || meta('description');
  const name = meta('og:title').replace(/\s*\|\s*Know Your Meme\s*$/i, '');
  return desc ? { desc, name } : null;
}
// How people use a meme, from Know Your Meme's later sentences: "As a meme, the clip is often posted alongside a gameplay video",
// "... in which the clip is paired with captions about getting stuck in a crowd", "often consisting of GIF caption jokes about ...",
// "is typically used to express feelings ...", "The memes tend to use clips of people doing things independently ..."
const USE_RE = [
  /\bas a (?:meme|format|reaction(?: image| gif)?),\s(?:the (?:clip|audio|image|video|gif|format|phrase|caption|sound|song|line)s? )?(?:is |are )?(?:often |typically |usually |commonly |frequently )?(.+)$/i,
  /\b(?:in which|where) (?:the )?(?:clip|audio|image|video|gif|format|sound|song|scene)s? (?:is|are) (?:often |typically |usually |commonly )?((?:paired|set|posted|combined|overlaid) .+)$/i,
  /\b(?:often |typically |usually |commonly )?consisting of (.+)$/i,
  /\b(?:is|are) (?:often |typically |usually |commonly )?(used (?:to|as|for) .+)$/i,
  /\b(?:memes|videos|posts|edits) (?:tend to|typically|often|usually) (use .+)$/i,
];
const USE_MAX_WORDS = 16;
/** One line on how people use the meme, from the sentences after its definition, or null. */
function useLine(text) {
  const sents = W.curlQuotes(text || '').replace(/\bparied\b/g, 'paired').split(/(?<=[A-Za-z0-9)”"'’])[.!?][”"’]?\s+(?=[A-Z“"‘])/).slice(1);
  for (const sent of sents) {
    for (const re of USE_RE) {
      const m = sent.match(re);
      if (!m) continue;
      // "including as a lip dub audio and as an image macro format, in which the clip is paired with ...": what it is used as leads
      const as = [...sent.slice(0, m.index).matchAll(/\bas (?:an? )?((?:lip[- ]?dub |reaction )?(?:audio|sound|image macro|gif|template|caption))\b/gi)].map((x) => x[1]);
      // "often consisting of GIF caption jokes about ..." says what the memes are for: "used for GIF caption jokes about ..."
      const lead = as.length && !/^used\b/i.test(m[1]) ? `used as ${as.map((a, i) => `${i ? '' : /^[aeiou]/i.test(a) ? 'an ' : 'a '}${a}`).join(' and ')}, `
        : re === USE_RE[2] ? 'used for ' : '';
      const u = tidyMeaning(`${lead}${m[1]}`, USE_MAX_WORDS);
      if (u && u.split(' ').length >= 4) return u.replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase());
    }
  }
  return null;
}
/**
 * Know Your Meme's weekly roundup page -> its picks [{ name, slug }]: each "<h2>" section names one meme, and the entry it links to is
 * the one whose slug is the heading's own ("wawario-and-wawaluigi"), or contains it ("jean-philanthrope-jean-phil" for "Jean Phil"),
 * else the section's first entry link.
 */
function kymRoundupEntries(html) {
  const page = html || '';
  const body = page.slice(Math.max(0, page.indexOf('class="body"')));
  const slugOf = (s) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const out = [];
  for (const sec of body.split(/<h2\b[^>]*>/i).slice(1)) {
    const name = decodeHtml((sec.match(/^([\s\S]*?)<\/h2>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
    if (!name || name.length > 90) continue;
    const links = [...sec.slice(0, 6000).matchAll(/href="https:\/\/knowyourmeme\.com\/memes\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    if (!links.length) continue;
    const own = slugOf(name);
    const slug = links.find((l) => l === own) || links.find((l) => own.length >= 5 && l.includes(own)) || links[0];
    out.push({ name, slug });
  }
  return out;
}
const HTML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decodeHtml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] !== '#' ? HTML_ENT[e.toLowerCase()] ?? m
  : String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)))).replace(/\s+/g, ' ');

// ---------- origin ----------
const MONTHS = 'january february march april may june july august september october november december'.split(' ');
// "late September 2026", "March 3, 2025", "mid-to-late September 2026", "throughout August 2026", "late August through September
// 2026" (the first month), "in early 2023", "since 2019", "in the 2010s"
const DATE_RE = /\b(?:(early|mid|late|end of|start of|beginning of|throughout)(?:-to-(?:early|mid|late))?[- ])?(january|february|march|april|may|june|july|august|september|october|november|december)(?: (\d{1,2})(?:st|nd|rd|th)?,?)?(?: (?:through|to|and|into)(?: early| mid-?| late)? (?:january|february|march|april|may|june|july|august|september|october|november|december))? (\d{4})\b|\b(?:in|since|from|during|throughout) (?:the )?(early |mid-|mid |late )?(\d{4})(s)?\b/gi;
// A date says when the term began only next to a word about it going viral or about its source material being made, and the two
// differ: "a video uploaded to YouTube in 2024 ... went viral in 2026" began in 2026. The cue nearest the date decides which it is.
const VIRAL_CUE = /\b(viral\w*|popular\w*|memes?|spread\w*|took off|blew up|trend\w*|circulat\w*|resurfac\w*|revived|went|emerg\w*|gained|surg\w*)\b/gi;
const SOURCE_CUE = /\b(originat\w*|coined|first|began|begun|started|posted|uploaded|aired|released|created|made|launched|appear\w*|premiered|published|design\w*)\b/gi;
const CUE_REACH = 60;
function dateOf(m, nowYear) {
  const part = (m[1] || m[5] || '').trim().replace(/-$/, '').toLowerCase().replace(/^(start|beginning) of$/, 'early');
  if (m[2]) {
    const day = m[3] ? Number(m[3]) : { early: 5, late: 25, 'end of': 28, throughout: 1 }[part] || 15;
    return Date.UTC(Number(m[4]), MONTHS.indexOf(m[2].toLowerCase()), day);
  }
  const year = Number(m[6]);
  if (year < 1990) return NaN;
  if (m[7]) return year + 9 < nowYear ? Date.UTC(year + 5, 0, 1) : NaN; // "the 2010s"
  if (year >= nowYear) return NaN; // "went viral in 2026" does not say which month
  return Date.UTC(year, part === 'early' ? 1 : part === 'late' ? 9 : part === 'mid' ? 5 : 6, 1);
}
/** The kind of cue nearest a date within CUE_REACH characters: 'viral', 'source' or null. */
function cueNear(sentence, at, len) {
  let best = null;
  for (const [kind, re] of [['viral', VIRAL_CUE], ['source', SOURCE_CUE]]) {
    for (const c of sentence.matchAll(new RegExp(re.source, 'gi'))) {
      const d = c.index + c[0].length <= at ? at - (c.index + c[0].length) : c.index >= at + len ? c.index - (at + len) : 0;
      if (d <= CUE_REACH && (!best || d < best.d)) best = { kind, d };
    }
  }
  return best ? best.kind : null;
}
/**
 * The dates a text gives for a term: { viral, viralSeen, source }. viral: the earliest "went viral / became a meme" date; viralSeen:
 * the text dates its spread at all, even only by the current year ("went viral in 2026"); source: the earliest date its source
 * material was made ("uploaded in 2024"). Future dates are names ("Remember November 2026").
 */
function originParts(text, now) {
  const nowYear = new Date(now).getUTCFullYear();
  const out = { viral: Infinity, viralSeen: false, source: Infinity };
  for (const sentence of (text || '').split(/(?<=[a-z0-9)”"'’])[.!?]\s/)) {
    for (const m of sentence.matchAll(DATE_RE)) {
      const kind = cueNear(sentence, m.index, m[0].length);
      if (!kind) continue;
      const t = dateOf(m, nowYear);
      if (kind === 'viral') out.viralSeen = true;
      if (!Number.isFinite(t) || t >= now) continue;
      if (kind === 'viral') out.viral = Math.min(out.viral, t);
      else out.source = Math.min(out.source, t);
    }
  }
  return out;
}
/** When a term began from several texts' dates: when it went viral if any text says so, else when its source material was made. */
function originFromParts(parts) {
  const viralSeen = parts.some((p) => p.viralSeen);
  return Math.min(Infinity, ...parts.map((p) => (viralSeen ? p.viral : p.source)));
}
/** The date a text gives for a term starting ("which went viral in late 2025" -> 2025-10-01), or Infinity. */
const originOf = (text, now) => originFromParts([originParts(text, now)]);

// ---------- meanings ----------
const PROFANE = /\b(fuck\w*|shit\w*|cunt\w*|bitch\w*|dick\w*|cock\w*|pussy|porn\w*|penis|vagina|nude\w*|sex\w*|horny|cum|slut\w*|whore\w*)\b/i;
// words a cut line must not end on ("... that shaped who they are" keeps its pronouns; "... based on a" loses the "on a")
const DANGLING = new Set(`a an the of to in on at for with by from as and or but that which whose into over about than their his its my your our
  typically usually often mostly especially including like such namely`.split(/\s+/));
const FILLER = /\b(bizarre|weird|wild|strange|new|latest|newest|hilarious|creepy|so-called|trendy|massive|huge|little-known|unusual|quirky|odd|funny|cute|chaotic|mysterious|viral)\s+|\s+to try(?: now| this \w+)?$/gi;
const PLAIN = [
  [/\ba colloquialism (?:denoting|for|meaning)\b/i, 'slang for'],
  [/\bInternet\b/g, 'internet'],
  [/\bthe act or habit of\b/i, 'the act of'],
];

// Know Your Meme boilerplate that spends words without saying anything: "a series of memes, including ..., based on", "streamer and
// YouTuber IShowSpeed", "Pirate Clark from the Backrooms movie", "a post by @feydemon", "Twitter / X"
const KYM_BOILERPLATE = [
  [/^(?:an? )?series of (memes|jokes|videos|edits)\b/i, '$1'],
  [/\b(streamer|YouTuber|TikToker) and (?:streamer|YouTuber|TikToker)\b/g, '$1'],
  [/\s+from the (?:[A-Z][\w'’-]* ){1,3}(?:movie|mod|show|series|game)\b/g, ''],
  [/\s+by @[\w.]+/g, ''],
  [/\b(?:pop star|singer|rapper|actress|actor|comedian) (?=\p{Lu}\p{Ll}+ \p{Lu})/gu, ''],
  [/\b(?:Twitter \/ X|X \/ Twitter)\b/g, 'X'],
];
// where a line may end: before a conjunction or a clause word, before a quote, after a comma
const CLAUSE_WORD = /^(and|or|but|that|which|where|who|whose|while|when|after|before|during|as|with|featuring|including|attempting|trying|depicting)$/i;
const naturalEnd = (ws, k) => k >= ws.length || /[,;:]$/.test(ws[k - 1]) || CLAUSE_WORD.test(ws[k]) || /^[‘“"']/.test(ws[k]) ||
  (/^in$/i.test(ws[k]) && /^which$/i.test(ws[k + 1] || ''));
const QUOTE_OPEN = /^[(]?[‘“"']/;
const QUOTE_CLOSE = /[’”"'][,.;:!?)]*$/;
/** Index of the word that opens a quote still unclosed after ws[0..end), or -1. */
function openQuoteAt(ws, end) {
  let open = -1;
  for (let i = 0; i < end; i++) {
    if (open < 0 && QUOTE_OPEN.test(ws[i]) && !(QUOTE_CLOSE.test(ws[i]) && ws[i].length > 2)) open = i;
    else if (open >= 0 && QUOTE_CLOSE.test(ws[i])) open = -1;
  }
  return open;
}
const CUT_REACH = 4; // a cut may run this many words past the limit to finish a name, a noun phrase or a quote
/**
 * Where a line longer than `max` words ends: a quote is kept whole (up to CUT_REACH words over) or dropped; else the next natural
 * end within CUT_REACH words ("edits of an anime | character or other fictional character,"); else the last comma or clause word;
 * else the hard limit.
 */
function cutWords(ws, max) {
  if (ws.length <= max) return ws;
  const open = openQuoteAt(ws, max);
  if (open >= 0) {
    for (let k = max; k < Math.min(ws.length, max + CUT_REACH); k++) if (QUOTE_CLOSE.test(ws[k])) return ws.slice(0, k + 1);
    return ws.slice(0, open);
  }
  for (let k = max; k <= Math.min(ws.length, max + CUT_REACH); k++) if (naturalEnd(ws, k)) return ws.slice(0, k);
  const cut = ws.slice(0, max);
  const lastBreak = Math.max(...cut.map((w, i) => (openQuoteAt(cut, i + 1) < 0 && (/,$/.test(w) || CLAUSE_WORD.test(cut[i + 1] || '')) ? i : -1)));
  return lastBreak >= 6 ? cut.slice(0, lastBreak + 1) : cut;
}

/** One plain line: first sentence, no asides, cut at a clause break, at most `max` words. Null when nothing clean is left. */
function tidyMeaning(raw, max = MEANING_MAX_WORDS) {
  if (!raw) return null;
  // "... skating and singing, “Happy day, Ronaldo day,” then getting body-checked ...": the quoted line after a speech verb is the
  // point, so it stays whole, and so does what happens after it
  const curled = W.curlQuotes(raw);
  const said = curled.match(/\b(?:say|says|said|saying|sing|sings|singing|chant\w*|shout\w*|yell\w*),?\s*[“"]([^”"]{2,50})[”"]/);
  const after = said ? curled.slice(said.index + said[0].length) : '';
  // "say, “Welcome to X brother,” “X” being a fandom": the comma stays before a new clause, and a one-word quote is just the word
  const comma = said && /,[”"]$/.test(said[0]) && /^\s*[“"‘'\p{Lu}]/u.test(after) ? ',' : '';
  const src = said ? curled.slice(0, said.index) + said[0].replace(/[“"]([^”"]+?)[,.!]?[”"]/, '‘$1’') + comma + after.replace(/[“"]([^”"\s]{1,12})[”"]/g, '$1') : raw;
  let t = W.curlQuotes(src).replace(/\s*\([^)]*\)/g, '')
    // an aside ("memes, including brainrot edits, based on ..."), not a list ("feelings, including awkwardness, boredom, ...")
    .replace(/,\s(?:including|such as|also known as|sometimes known as|often called|or simply|usually|typically)\s[^,]+,\s(?=(?:based|about|that|which|where|who|in|on|from|with|to|for|of|by|often|typically|usually|parodying|depicting|showing|featuring|used|made|[a-z]+ed|[a-z]+ing)\b)/gi, ' ')
    // "her husband, Travis Kelce, scoring a touchdown": the appositive name stays, without its commas
    .replace(/,\s((?:[A-Z][\w.'’-]*\s?){1,4}),\s(?=[a-z])/g, ' $1 ')
    // "that became popular in late 2025": the date is the term's origin, not its meaning
    .replace(/,?\s(?:that|which) (?:became|went) (?:popular|viral) in [^,.]+/i, '')
    .replace(/\s+/g, ' ').trim();
  for (const [re, to] of KYM_BOILERPLATE) t = t.replace(re, to);
  t = t.split(/;\s|\s[—–]\s|:\s|,\s(?:i\.e\.|e\.g\.|and is|but|with the|where the|including|such as|typically|usually|especially|mostly|as well as)\b|,\s["“]|(?<=[a-z0-9)”"'’])\.\s/)[0];
  for (const [re, to] of PLAIN) t = t.replace(re, to);
  const bad = t.search(PROFANE);
  if (bad >= 0) t = t.slice(0, bad).replace(/[\s,]+\S*$/, '');
  let ws = cutWords(t.split(' ').filter(Boolean), max);
  while (ws.length && (DANGLING.has(ws[ws.length - 1].toLowerCase().replace(/[^a-z]/g, '')) || /^[,;:]$/.test(ws[ws.length - 1]))) ws.pop();
  let out = ws.join(' ').replace(/,?\s+explained$/i, '').replace(/[\s,.:;!—–-]+$/, '').trim();
  // an opening quote whose closing one was cut off (or the reverse) goes, with all its partners
  const opens = (out.match(/(^|[\s(])[‘“"']/g) || []).length;
  const closes = (out.match(/[’”"'](?=$|[\s,.;:!?)])/g) || []).length;
  if (opens !== closes) out = out.replace(/(^|[\s(])[‘“"']/g, '$1').replace(/[’”"'](?=$|[\s,.;:!?)])/g, '').trim();
  if (out.split(' ').length < 3 || PROFANE.test(out)) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const aOrAn = (s) => (/^[aeiou]/i.test(s) && !/^(one|uni|use|eu)/i.test(s) ? 'An' : 'A');
/** "the bizarre new bedtime trend people say ..." -> "A bedtime trend people say ..."; "Twitch chat's favorite emote" keeps no article. */
function asIndefinite(np) {
  const core = np.replace(/^(?:the|a|an)\s+/i, '').replace(FILLER, '').replace(/^(?:tiktok['’]s|internet['’]s)\s+/i, '').trim();
  if (!core) return null;
  const head = core.split(/\s+(?:for|of|about|that|which|where|from|with|in|on)\s/i)[0].split(' ');
  const plural = /s$/i.test(head[head.length - 1]) && !/(ss|us|is)$/i.test(head[head.length - 1]);
  if (/^\S+['’]s?\s/.test(core) || /['’]s\b/.test(head.join(' ')) || plural) return core;
  return `${aOrAn(core)} ${core}`;
}
const NP_VERB = /^(is|are|was|were|has|have|had|becomes?|became|think|thinks|know|knows|says|said|explains|shows|makes|takes|gets|goes|went|helps|needs|wants)$/i;
const contentWords = (s, term) => {
  const own = new Set(W.words(term));
  return W.words(s).filter((w) => !W.STOP.has(w) && !own.has(w) && !/^(viral|trend|trends|meme|memes|tiktok|explained|internet|slang|the|new)$/.test(w));
};
// words that only name the medium or the kind: "‘Zias And B.Lou’ Streaming Clip And Memes" says nothing about what the meme is
const MEDIUM_WORD = /^(clips?|videos?|stream|streaming|songs?|audio|sounds?|formats?|challenges?|gifs?|edits?|ai|generated|reels?|instagram|youtube|online|social|media|posts?)$/;
/**
 * A title's noun phrase says something only with two plain content words left once quoted names and capitalised non-words go:
 * "‘He Belongs To Backrooms’ memes", "A Saucy Santana trend", "A David & Victoria TikTok trend" and "NFL's sandwich slang" say nothing.
 */
function saysSomething(np, term) {
  const plain = np.replace(/(^|\s)[‘'"“][^’'"”]+[’'"”](?=$|[\s,.:;!?])/g, ' ').split(/\s+/)
    .filter((w) => w && (!/^[A-Z]/.test(w) || W.inDict(w.toLowerCase().replace(/[^a-z]/g, ''))));
  return contentWords(plain.join(' ').toLowerCase(), term).filter((w) => !MEDIUM_WORD.test(w)).length >= 2;
}

/**
 * Definitions a title gives for a term it names: [{ text, quality }]. Quality 4: the title defines it ("The slang term for ...",
 * "a trend that combines burgers with cookies"); 2-3: a descriptive noun phrase ("Twitch chat's favorite emote").
 */
/** "puts people into Quavo and Takeoff video" -> "... into a Quavo and Takeoff video": a name before a noun needs its article. */
const withArticle = (s) => s.replace(/\b(into|in|from|of|like)\s+((?:\p{Lu}[\p{L}’'-]*\s+)+(?:and\s+(?:\p{Lu}[\p{L}’'-]*\s+)+)?)(video|clip|song|scene|show|movie|photo)\b/gu, '$1 a $2$3');
function meaningsFromTitle(rawTitle, term, { rehost = false } = {}) {
  const title = W.foldGDrop(W.curlQuotes(rawTitle || '')).replace(/\s*\((?:with|plus|video|photos?)[^)]*\)/gi, '');
  if (/(\.\.\.|…)$/.test(title)) return []; // Google News cut the title short
  const out = [];
  const t = escapeRe(term).replace(/[’']/g, "['’]");
  const push = (text, quality) => {
    const s = tidyMeaning(text) && withArticle(tidyMeaning(text));
    // "A trend that wants your cheeks to chill out" is a headline talking to its reader, not a definition
    if (s && contentWords(s, term).length >= 2 && !/\b(you|your)\b/i.test(s) && !out.some((o) => o.text.toLowerCase() === s.toLowerCase())) out.push({ text: s, quality });
  };
  let m;
  // "'Salt Stepping' Is the Bizarre New Bedtime Trend People Say Helps Them Sleep"
  if ((m = title.match(new RegExp(`${t}["”’']?,? (?:is|are) ((?:the|a|an) .+)$`, 'i'))) && /\b(trend|slang|term|word|phrase|meme|challenge|craze|insult|way)\b/i.test(m[1])) {
    const np = m[1].split(/\s(?:—|–|-)\s|:\s|\?\s/)[0];
    // "the Bizarre New Bedtime Trend People Say Helps Them Sleep" says what it does; "the Moody Yet Wearable Makeup Trend" only
    // describes it
    const does = /\b(for|of|that|where|which|who|people|users|replacing|instead|with|about)\b/i.test(np.replace(/\bto try\b.*$/i, ''));
    if (saysSomething(np, term)) push(asIndefinite(np), does ? 4 : 3.4);
  }
  // "'Sleepmaxxing', a TikTok trend encourages people to ..." / "Double cleansing: The bizarre Gen Z shower trend taking over TikTok"
  if ((m = title.match(new RegExp(`${t}["”’']?(?:,|:) ((?:the|a|an) (?:[\\w’'-]+ ){0,5}(?:trend|slang|term|word|phrase|meme|challenge|craze|catchphrase|insult)\\b.*)$`, 'i')))) {
    const np = m[1].replace(/\b(trend|challenge|craze) (?!that\b|which\b|where\b)(\w+s)\b/i, '$1 that $2');
    if (saysSomething(np.replace(/,? explained\b.*$/i, ''), term)) push(asIndefinite(np), 4);
  }
  // "trend combines burgers with chocolate chip cookies", "Trend Puts Celebrities Into ...", "trend from TikTok that puts people into ..."
  if ((m = title.match(/((?:[\w’'-]+ ){0,3})(trend|challenge|craze)(?: from tiktok)?(?: that| which)? (aims to|combines|puts|lets|has (?:people|users)|sees|involves|encourages|uses|asks|shows|turns|pairs|features|gets|makes|swaps|mixes|blends)\b(.+)$/i))) {
    const adj = m[1].split(' ').filter((w) => w && !/["“”‘’']/.test(w) && !TREND_LEAD_STOP.has(w.toLowerCase()) && !/^(as|and|the|a|an|of)$/i.test(w) && !W.words(term).includes(W.words(w)[0])).join(' ');
    push(`${aOrAn(adj || m[2])} ${adj ? `${adj} ` : ''}${m[2].toLowerCase()} that ${m[3]}${m[4].split(/,\s(?:but|and)\s|\s[—–-]\s|:\s/)[0]}`, 4);
  }
  // "Fat Bear Week returns to crown Alaska’s fattest bear": a recurring event and what it is for
  if ((m = title.match(new RegExp(`^["“‘']?${t}["”’']?(?: \\d{4})? returns to ([a-z]+ .{6,60})$`, 'i'))) && !/\b(you|your)\b/i.test(m[1])) {
    push(`An event to ${m[1].split(/\s(?:—|–|-)\s|:\s/)[0]}`, 3);
  }
  // "Creepy 'Cat in the Hat' trend targets schools as ...": what the named trend does, up to its first aside
  if ((m = title.match(new RegExp(`((?:[\\w’'-]+ ){0,2})["“‘']${t}["”’'] (trend|challenge|meme) (targets|lands|sends|spreads|involves|sees|has) (.+)$`, 'i')))) {
    const adj = m[1].split(' ').filter((w) => w && !TREND_LEAD_STOP.has(w.toLowerCase()) && !/^(as|and|the|a|an|of|viral|new)$/i.test(w)).join(' ').toLowerCase();
    const rest = m[4].split(/\s(?:as|now|after|while|—|–|-)\s|,\s|:\s/)[0];
    push(`${aOrAn(adj || m[2])} ${adj ? `${adj} ` : ''}${m[2].toLowerCase()} that ${m[3].toLowerCase()} ${rest}`, 3.2);
  }
  // "Anti-Blush Is About to Take Over Fall: The Viral Makeup Trend for a Cooler, Sculpted Look": the name leads, the colon defines
  if ((m = title.match(new RegExp(`^["“‘']?${t}["”’']?\\s[^:?]{3,60}:\\s((?:the|a|an) (?:[\\w’'-]+ ){0,4}(?:trend|look|meme|challenge|craze|slang|term|phrase|style|hack)s? (?:for|of|that|where|which|with|replacing)\\b.+)$`, 'i')))) {
    if (saysSomething(m[1], term)) push(asIndefinite(m[1]), 3.5);
  }
  // explainer second clause: "What Is 'Phubbing'? The Slang Term for the Subtle Behavior ...", "...? Twitch chat's favorite emote explained"
  const q = questionEnd(title);
  if (q > 0 && new RegExp(t, 'i').test(title.slice(0, q))) {
    const tail = title.slice(q + 1).replace(/^[\s'’"”]+/, '').trim();
    const why = tail.match(/^why (kids|people|teens|gen z|gen alpha|users|women|men|everyone|parents|fans|tiktokers) (?:are|is|keep) (.+?)[.?!]?$/i);
    if (why) push(`${why[1]} ${why[2]}`, 3);
    const np = tail.replace(/,? explained\b.*$/i, '').replace(/^meet (?=the |a |an )/i, '').replace(/^(?:the |a |an )/i, '');
    const npWords = np.split(/\s+/);
    // a noun phrase only: "New slang word becomes viral trend" (a sentence) and "Meaning of the narrow country's memes" say nothing
    const sentence = npWords.some((w, i) => i > 0 && (W.VERB_RE.test(w) || NP_VERB.test(w)));
    if (/\b(slang term|term|word|phrase|meme|memes|trend|challenge|emote|insult|dance|filter|prank|format|gif|sound|audio|song|game)\b/i.test(np) &&
      !sentence && !/^(how|why|what|who|here|and|is|are|does|did|meaning|origins?|story|history|everything)\b/i.test(np) && saysSomething(np, term)) {
      const defining = /\b(for|of|about|where|that|which|with|from|replacing|instead)\b/i.test(np) || /['’]s\b/.test(np);
      push(asIndefinite(np), defining ? 3 : 2);
    }
  }
  // "‘That’s so AI!’ What gen Alpha’s biggest insult tells us": who says it and what kind of word it is. Enough (quality 3) when the
  // title quotes the term and an outlet wrote it; a re-host's copy stays below the bar
  if ((m = title.match(/\b((?:gen z|gen alpha|teens?|kids|gamers|twitch chat)['’]?s? (?:\w+ ){0,2}(?:insult|compliment|slang|word|phrase|catchphrase|greeting|emote))\b/i))) {
    const quotedTerm = new RegExp(`[‘“"']${t}[!?.,]?[’”"']`, 'i').test(title);
    push(m[1], quotedTerm && !rehost ? 3 : 2.5);
  }
  // "Why are TikTok users stomping on Epsom salt before bed?": what people do, when the question names the term
  if ((m = title.match(/^why (?:are|do|is) ((?:tiktok|instagram) users|people|gen z|women|men|kids|teens|parents|everyone) (?:suddenly |now )?([a-z]+ing\b[^?]{3,60})\?/i)) &&
    new RegExp(t, 'i').test(title)) push(`${m[1]} ${m[2]}`, 3.5);
  return out;
}

// ---------- meaning casing ----------
const coreOf = (w) => w.replace(/^[^\p{L}\p{N}]+|(?:['’]s)?[^\p{L}\p{N}]*$/gu, '');
const isCapitalised = (w) => /^\p{Lu}\p{Ll}/u.test(coreOf(w)) && !/\p{Ll}\p{Lu}/u.test(coreOf(w));
// capitalised pairs of dictionary words that are names all the same
const KEEP_PAIR = /^(gen (z|x|alpha)|k-pop|big tech|(pacific|atlantic|indian|arctic|southern) ocean|(north|south|central|latin) american?)$/i;
const RUN_BREAK = /^(trends?|memes?|challenges?|slang|songs?|sounds?|audio|dances?|formats?|filters?|clips?|videos?)$/i;
/** Two-word capitalised runs holding a name ("A Saucy Santana Trend"): both words keep their capitals when the line is un-Title-Cased. */
function nameRuns(ws, lex) {
  const keep = new Set();
  for (let i = 1; i < ws.length;) {
    let j = i;
    while (j < ws.length && /^\p{Lu}/u.test(coreOf(ws[j])) && !W.STOP.has(coreOf(ws[j]).toLowerCase()) && !RUN_BREAK.test(coreOf(ws[j]))) j++;
    if (j - i === 2 && [i, i + 1].some((k) => ['proper', 'unknown'].includes(W.wordClass(coreOf(ws[k]), lex))) &&
      ![i, i + 1].some((k) => W.looksVerb(coreOf(ws[k])))) { keep.add(i); keep.add(i + 1); }
    i = Math.max(j, i + 1);
  }
  return keep;
}
/** A capitalised dictionary word left mid-sentence ("Kids Tracking their parents", "a Double Cheeseburger") that is no part of a name. */
function strayCapital(ws, i, lex, keep, titleCase = false) {
  const c = coreOf(ws[i]);
  if (keep.has(i) || !isCapitalised(ws[i]) || W.wordClass(c, lex) !== 'lower' || /[.!?:]$/.test(ws[i - 1] || '')) return false;
  if (/^[‘“"']/.test(ws[i])) return false; // the first word of a quoted line: ‘Happy day, Ronaldo day’
  const capAt = (k) => k > 0 && k < ws.length && isCapitalised(ws[k]) && !/[.!?:]$/.test(ws[k - 1] || '');
  if (!titleCase && (capAt(i - 1) || capAt(i + 1))) return false; // a run of capitals in a sentence is a name: "Grand Theft Auto", "The Onion"
  if (i + 1 < ws.length && W.isFirstName(coreOf(ws[i + 1]).toLowerCase())) return false; // a title before a name: "Pirate Clark"
  const low = c.toLowerCase();
  if (W.ENTITY_STOP.has(low) || PLACES.has(low) || W.isProperWord(low)) return false; // a brand or a place: Twitter, Chile
  const nameAt = (k) => k > 0 && k < ws.length && /^\p{Lu}/u.test(coreOf(ws[k])) && W.wordClass(coreOf(ws[k]), lex) !== 'lower';
  if (nameAt(i - 1) || nameAt(i + 1) || (/^(and|&)$/i.test(ws[i - 1] || '') && nameAt(i - 2))) return false; // "Kansas City", "Quavo and Takeoff"
  const pair = (a, b) => `${W.words(a).join(' ')} ${W.words(b).join(' ')}`;
  if (i > 0 && (KEEP_PAIR.test(pair(ws[i - 1], ws[i])) || lex.names.has(pair(ws[i - 1], ws[i])))) return false;
  if (i + 1 < ws.length && (KEEP_PAIR.test(pair(ws[i], ws[i + 1])) || lex.names.has(pair(ws[i], ws[i + 1])))) return false;
  return true;
}
/**
 * Casing of a meaning line: Title Case is undone (two-word names kept), then stray mid-sentence capitals are lowered, except the
 * entry's own names ("Verity" in "pull Verity into their respective universe"; names: lowercase words of its names).
 */
function caseMeaning(text, lex, titleCase, names = null) {
  if (!lex) return text;
  const orig = text.split(' ');
  const keep = titleCase ? nameRuns(orig, lex) : new Set();
  const recased = (titleCase ? W.recase(text, lex, true) : text).split(' ');
  const ws = recased.length === orig.length ? recased.map((w, i) => (keep.has(i) ? orig[i] : w)) : recased;
  // the entry's own names keep a capital the line still has ("pull Verity into their respective universe")
  const own = new Set(keep);
  if (names) ws.forEach((w, i) => { if (i > 0 && names.has(coreOf(w).toLowerCase()) && /^\p{Lu}/u.test(coreOf(w))) own.add(i); });
  return ws.map((w, i) => (i > 0 && strayCapital(ws, i, lex, own, titleCase) ? w.replace(/\p{Lu}/u, (ch) => ch.toLowerCase()) : w)).join(' ');
}

// a summary line that opens by defining a trend: "A McDonald’s menu trend that puts a chocolate chip cookie inside a Double Cheeseburger ..."
const DEFINING_DEK = /^(?:an?|the) (?:[\w’'&-]+ ){0,4}(?:trend|meme|challenge|craze|slang(?: term| word)?|term|phrase|dance|sound|audio|format|hack)s? (?:that|where|in which|which|of|for|involving|when)\b/i;
const DEK_TAIL = /\s(?:is|are) (?:going viral|taking over|everywhere|trending|blowing up)\b.*$|\s(?:has|have) (?:gone viral|taken over)\b.*$/i;
/** A feed's own summary line ("The 'AI Shirtless Plumber' prank is a viral trend on TikTok that uses ...") when it defines the term. */
function meaningFromDek(dek, term, anySentence = false) {
  if (!dek) return null;
  if (anySentence) {
    const first = W.curlQuotes(dek).split(/(?<=[a-z0-9)”"'’])[.!]\s/)[0].replace(DEK_TAIL, '');
    const s = !/\?$/.test(first) && new RegExp(escapeRe(term.split(' ')[0]), 'i').test(first) ? tidyMeaning(first) : null;
    return s ? { text: s, quality: DEFINING_DEK.test(first) ? 4.2 : 3.2 } : null;
  }
  const t = escapeRe(term).replace(/[’']/g, "['’]");
  const m = W.curlQuotes(dek).match(new RegExp(`${t}["”’']?(?: \\w+)?,? (?:is|are|means|refers to|describes) (.+)$`, 'i'));
  if (!m || !/\b(trend|slang|term|word|phrase|meme|challenge|craze|way|when|someone|something|people)\b/i.test(m[1].split(' ').slice(0, 8).join(' '))) return null;
  const s = tidyMeaning(m[1]);
  return s ? { text: s, quality: 4 } : null;
}

// "... salt stepping, or ‘salt stomping’, ...", "also known as ‘Family Resemblance’": another name for the same craze
const ALIAS = /(?:also (?:called|known as)|\baka|a\.k\.a\.|(?:,|\()\s*or)\s+[‘'"“]([^’'"”]{2,40})[’'"”]/gi;
function aliasesIn(text) {
  return [...W.curlQuotes(text || '').matchAll(ALIAS)].map((m) => cleanTerm(m[1])).filter((t) => validTerm(t, false));
}

/** A Bluesky culture trend's description is one plain sentence already: "Bluesky users list nine games ..., sparking a viral trend." */
function meaningFromBluesky(desc) {
  const s = tidyMeaning((desc || '').replace(/,\s(?:sparking|prompting|creating|launching|starting|kicking off)\b.*$/i, ''));
  return s ? { text: s, quality: 4 } : null;
}

/** A Trends row asking what a term means ("what does wharfie time mean"), unless it is a song ("pink clouding lyrics"). */
function termFromTrend(tr) {
  const queries = [tr.keyword, ...(tr.related || [])];
  if (queries.some((x) => /\blyrics?\b/i.test(x))) return null;
  for (const x of queries) {
    const m = (x || '').match(RX.trendsMean);
    const term = m && cleanTerm(m[1] || m[2] || m[3]);
    if (term && validTerm(term, true) && term.split(' ').length <= 4 && !/^(a|an|the)\b/.test(term)) return term;
  }
  return null;
}

/** "Verity's From Minecraft, He Belongs To Backrooms" -> "veritys-from-minecraft-he-belongs-to-backrooms" (Know Your Meme's URL form). */
const kymSlug = (s) => (s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** "The Weekly Meme Roundup: Wawario, Jean Phil, Blocking The Street And More - Yahoo" -> its Know Your Meme editorial slug. */
function roundupSlug(title) {
  const t = (title || '').replace(/\s+-\s+[^-]+$/, '');
  return KYM_ROUNDUP.test(t) ? kymSlug(/^the /i.test(t) ? t : `The ${t}`) : null;
}


module.exports = { kymSlug, roundupSlug, caseMeaning, termsFromTitle, kymNames, kymPredicate, kymKind, kymPersonOrMoment, kymPageSummary, kymRoundupEntries, tidyMeaning, useLine, meaningsFromTitle, meaningFromDek,
  meaningFromBluesky, aliasesIn, originOf, originParts, originFromParts, termFromTrend, isCoinage, QUOTE_LIKE, PROFANE, TREND_CONTEXT, SLANG_CONTEXT,
  DICTIONARY_CONTEXT, KIND_ANY, RX, RX_ROUNDUP: KYM_ROUNDUP };
