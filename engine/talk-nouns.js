'use strict';
/*
 * Talking-point nouns and wording [talking-points.js]: what a name's coverage keeps repeating ("allegations" in 21 of 54 Bexan Tamard
 * titles), the card's title shaped like the search people type ("Bexan Tamard allegations", "Jasade Wickenko execution", "Esselle Quillith
 * SNL cameo"), and a one-line reported "what" with the denial when the sources carry one.
 * Plain regular expressions and word lists, so they port 1:1 to Swift.
 */
const MEMO = require('./memo');
const W = require('./wording');
const R = require('./rules');
const { contains } = require('./util');
const TL = require('./talk-lines');

const { words } = W;

// The talking-point nouns. Each family: the words a title uses (case-insensitive), the noun the card says, and how much it is the
// talking point itself (a response or a court date is the aftermath; the allegation, the arrest, the death are what people search).
// noun(surface) turns the matched word into the card's noun ("arrested" -> "arrest", "shirt" stays "shirt").
const FAMILIES = [
  { key: 'execution', w: 1.0, sensitive: 'crime', re: /\b(?:execution|executed|execute|lethal injection)\b/i, noun: () => 'execution' },
  { key: 'death', w: 1.0, sensitive: 'tragedy', re: /\b(?:dies|died|dead|death(?! penalty| row| threats?| sentence)|passes away|passed away|passing|obituary|funeral|killed|dies at \d+)\b/i,
    noun: () => 'death' },
  { key: 'arrest', w: 1.0, sensitive: 'crime', re: /\b(?:arrest|arrests|arrested|charged|charges|booked|mugshot|jailed|out of jail|in custody|indicted|tased)\b/i,
    noun: (s) => (/^(?:charged|charges|indicted)$/i.test(s) ? 'charges' : 'arrest') },
  // (and someone exposed for or by something: the exposé is a claim about them, never a leak. Collector only, 2026-10-28: "<creator> exposed
  // for faking ..." was titled "leak". Only exposed for, by or as, or someone getting exposed with nothing after it: "exposed skin" and
  // "was exposed to toxic mold" are nobody's claim)
  { key: 'allegations', w: 1.0, sensitive: 'crime', re: /\b(?:allegations?|alleges|accus(?:es|ed|ing|ation|ations|er|ers)|grooming|groomed|exposed (?:for|by|as)|(?:gets|got|getting|been|being|was|were) exposed(?!\s+(?:to|in|on|at|after|during)\b))\b/i,
    noun: () => 'allegations' },
  // (a suit only weighed or threatened is no lawsuit yet: "Feniel Zellova considers legal action against A24" stays a feud)
  // (and what a suit costs the one in it: "<name> says she still owes <amount> in legal fees". Collector only, 2026-10-29: a story
  // of what a suit cost had no noun of its own, so no card)
  { key: 'lawsuit', w: 0.8, sensitive: 'crime', re: /\b(?:lawsuits?|sues|sued|suing|(?<!(?:considers?|considering|weighs?|weighing|mulls?|mulling|threatens?|threatening|eyes|explores?|exploring|plans?|planning|vows?|could take|may take|might take|seeks?) )legal action|court|trial|legal (?:fees|bills))\b/i,
    // (a court on its own is a case, not a trial: "Wyno Pymace court case", the police he took to the High Court)
    noun: (s) => (/trial/i.test(s) ? 'trial' : /court/i.test(s) ? 'court case' : /legal/i.test(s) ? 'legal fees' : 'lawsuit') },
  // (a lawyer's letter that demands someone stop is its own step, never a lawsuit: nothing was filed. A cease-and-desist had no family, so
  // its headlines made no card. Collector only, 2026-10-28)
  { key: 'desist', w: 0.8, re: /\b(?:cease[- ]and[- ]desist|cease & desist|c&d letter)s?\b/i, noun: () => 'cease-and-desist' },
  // the outcomes that replace a trial or a charge once they land ("Velard Gravley guilty verdict", not "Velard Gravley trial"); a sentencing
  // only once handed down ("sentenced to 25 years", not "ahead of sentencing"); a trial that ended with no verdict is a mistrial,
  // never a guilty verdict ("Zanard Ulmard mistrial": "judge denies request to find her not guilty after mistrial")
  { key: 'mistrial', w: 1.05, sensitive: 'crime', re: /\b(?:mistrial|hung jury|deadlocked jury|jury deadlocked)\b/i, noun: () => 'mistrial' },
  { key: 'verdict', w: 1.0, sensitive: 'crime', re: /\b(?:(?<!\bbe )found guilty|(?<!not )guilty verdict|(?<!guilty )verdict|pleads? guilty|pleaded guilty|convicted|acquitted|(?<!\bbe )found not guilty)\b/i,
    noun: (s) => (/acquit|not guilty/i.test(s) ? 'acquittal' : /plead/i.test(s) ? 'guilty plea' : /guilty|convicted/i.test(s) ? 'guilty verdict' : 'verdict') },
  // a child given up long ago and found ("Fenet Zellow meets son he placed for adoption 58 years ago")
  { key: 'reunion', w: 0.95, re: /\b(?:(?:secret|long-lost|long lost|biological|estranged|\d+-year-old) (?:son|daughter|child)|love child|(?:reunit\w*|reconnect\w*|meets?|finds?|found) (?:with )?(?:his |her |their )?(?:(?:long-lost|biological|secret|\d+-year-old) )?(?:son|daughter)\b(?! of)|(?:son|daughter|child) (?:he|she|they) (?:placed|put|gave) (?:up )?for adoption|(?:placed|put|given) (?:up )?for adoption)\b/i,
    // (a child given up and found is long-lost; "secret" only where the line says so: a love child, a secret son)
    noun: (s) => `${/secret|love child/i.test(s) ? 'secret' : 'long-lost'} ${/daughter/i.test(s) ? 'daughter' : /child/i.test(s) ? 'child' : 'son'}` },
  // (and a suspended sentence handed down is one: "<singer> given 8-month suspended sentence over nightclub attack". Collector only, 2026-10-28)
  { key: 'sentencing', w: 1.0, sensitive: 'crime', re: /\bsentenced to(?: life)?\b|\b(?:gets|given|handed|receives) (?:a )?life (?:sentence|in prison|without parole)\b|\bsuspended (?:prison |jail )?sentence\b/i,
    noun: (s) => (/life/i.test(s) ? 'life sentence' : /suspended/i.test(s) ? 'suspended sentence' : 'sentencing') },
  { key: 'stabbing', w: 1.0, sensitive: 'violence', re: /\b(?:stabbed|stabbing|stabs|knifed)\b/i, noun: () => 'stabbing' },
  // (a streamer set upon in the street: "German streamer Nimdot pelted with rocks by kids in Cairo")
  { key: 'attack', w: 0.95, sensitive: 'violence', re: /\b(?:(?<!\b(?:panic|heart|asthma|anxiety) )attack|(?<!\b(?:panic|heart|asthma|anxiety) )attacks|attacked|assault|assaulted|assaults|pelted|mobbed|ambushed|mass shooting|shooting (?:at|in|near|leaves|kills|suspect|victims?)|shot dead|gunman|open(?:s|ed)? fire)\b/i,
    noun: (s) => (/shoot|shot|gunman|fire/i.test(s) ? 'shooting' : 'attack') },
  // (a slap on camera is searched as the slap: "Swivix slap")
  { key: 'fight', w: 0.95, sensitive: 'violence', re: /\b(?:fight|fights|fighting|brawl|brawls|punch|punched|punches|slap|slaps|slapped|slapping|altercation|scuffle|melee)\b/i,
    noun: (s) => (/slap/i.test(s) ? 'slap' : 'fight') },
  // (collector only, 2026-10-12: someone losing their temper at a person in the room is an outburst whatever verb the headline picks,
  // "erupts at", "explodes on", "rages at", "loses his cool"; and one at a heckler is searched as the heckler, "<name> heckler".
  // Six headlines of a creator shouting down a heckler at a panel had no noun, so the card was titled by the organiser's apology)
  { key: 'argument', w: 0.9, re: /\b(?:spat|blowup|blow-up|heated exchange|exchange|argument|shouting match|outburst|tirade|tantrum|rant|meltdown|confrontation|sideline|hecklers?|heckled|heckling|(?:erupts?|erupted|explodes?|exploded|rages?|raged|snaps?|snapped) (?:at|on)|(?:loses|lost|losing) (?:his|her|their) (?:cool|temper)|(?:goes|went) off on)\b/i,
    // (a confrontation is told as one: "blowup" is the card's word only where the headlines' is a blowup or an outburst on a sideline)
    noun: (s) => (/^heckl/i.test(s) ? 'heckler' : /^(?:erupt|explod|rage|snap|los|goes off|went off)/i.test(s) ? 'outburst' :
      { spat: 'spat', rant: 'rant', tirade: 'rant', tantrum: 'tantrum', meltdown: 'meltdown', outburst: 'outburst', sideline: 'sideline blowup', confrontation: 'confrontation' }[s.toLowerCase()] || 'blowup') },
  // (a claim of menace: "Miriel Vorova accused of death threats, stalking by ex")
  { key: 'threats', w: 0.9, sensitive: 'crime', re: /\b(?:death threats?|threats|stalking|stalked|harassment|harassing|harassed)\b/i,
    noun: (s) => (/death/i.test(s) ? 'death threats' : /stalk/i.test(s) ? 'stalking claims' : /harass/i.test(s) ? 'harassment claims' : 'threats') },
  // (money lost or taken: "Wynena Pymsy ... losing $250K to an investment fraud")
  { key: 'scam', w: 0.9, sensitive: 'crime', re: /\b(?:scam|scams|scammed|scamming|fraud|defrauded|ponzi scheme|rug ?pull)\b/i, noun: (s) => (/fraud/i.test(s) ? 'fraud' : 'scam') },
  { key: 'prison', w: 0.85, sensitive: 'crime', re: /\b(?:prison|behind bars|inmate|solitary|cellmate)\b/i, noun: () => 'prison life' },
  // (one name going at another: "Feniel Zellova slams 'Primetime'", "rips Bexena Tamaby's 'Primetime'")
  { key: 'feud', w: 0.85, re: /\b(?:feud|feuding|beef|fallout|diss|disses|dissed|clash|clashes|rift|war of words|slams|rips|rips into|takes aim at|lashes out at)\b/i,
    noun: (s) => (/beef/i.test(s) ? 'beef' : /diss/i.test(s) ? 'diss' : 'feud') },
  { key: 'backlash', w: 0.85, re: /\b(?:backlash|slammed|blasted|criticism|criticized|criticised|outrage|boycott\w*|under fire|controvers\w*|sparks? (?:\w+ ){0,2}debate)\b/i,
    noun: (s) => (/controvers/i.test(s) ? 'controversy' : 'backlash') },
  // (someone exposed to a danger has leaked nothing: "<name> says she was exposed to toxic mold". 2026-10-28)
  { key: 'leak', w: 0.8, re: /\b(?:leak|leaks|leaked|exposed(?!\s+to\b)|exposes|exposing)\b/i, noun: () => 'leak' },
  // (collector only, 2026-10-11: a creator breaking down on camera is a clip everyone reacts to and had no noun, so three beat
  // headlines about a streamer in tears made no card at all)
  { key: 'tears', w: 0.75, re: /\b(?:(?:breaks?|broke|breaking) down (?:in tears|crying)|in tears|(?:cries|cried|crying|sobs|sobbing) on (?:stream|camera|live|air)|tearful(?:ly)?|tears up)\b/i, noun: () => 'tears' },
  // (something said that people are arguing about, as headlines put it: "... after ICE comments", "over his comments on female influencers")
  { key: 'remarks', w: 0.75, re: /\b(?:comments|remarks)\b(?! section)/i, noun: () => 'comments' },
  // (never one refused: "Rouena Trevow won't apologize for ...")
  // (nor a word that only looks like one: "an apologist for Jasey Wickow" apologises for nothing. Collector only, 2026-10-12)
  // (and one said in two words: "<name> says sorry to fans". Collector only, 2026-10-28)
  { key: 'apology', w: 0.8, re: /\b(?<!(?:won['’]t|will not|not|never|refuses to|refused to|no) )(?:apolog(?!ists?\b|ia\b|etics?\b)\w+|(?:says|said|saying) sorry)\b/i, noun: () => 'apology' },
  // (a couple calling it quits has split, never quit: "<name> and <partner> call it quits". Anyone else calling it quits has quit: a career,
  // a season, a stream. really() tells them apart, coupleQuits)
  { key: 'split', w: 0.9, re: /\b(?:split|splits|breakup|break up|breaks up|breaking up|broke up|divorce|divorced|divorces|divorcing|separated|separation|(?:calls?|calling|called) it quits)\b/i,
    noun: (s) => (/divorc/i.test(s) ? 'divorce' : 'split') },
  // (a partner cheated on is a claim about who cheated: "<name> accused of cheating on <partner>", "<name> cheating rumours". Never a
  // game's cheat: "cheated on" a person, or the cheating called a scandal, claims or rumours. Collector only, 2026-10-28)
  { key: 'cheating', w: 0.85, re: /\b(?:cheat(?:s|ed|ing)? on (?!(?:a |the |his |her |their )?(?:test|exam|game|diet|taxes))|cheating (?:scandal|allegations?|claims?|rumou?rs?|accusations?|reports?)|(?:accused of|caught) cheating|unfaithful|infidelity)\b/i,
    noun: () => 'cheating claims' },
  { key: 'romance', w: 0.8, re: /\b(?:dating|romance|engaged|engagement|wedding|marries|pregnant|pregnancy|affair)\b/i,
    noun: (s) => ({ dating: 'dating rumors', romance: 'romance', engaged: 'engagement', engagement: 'engagement', wedding: 'wedding', marries: 'wedding',
      pregnant: 'pregnancy', pregnancy: 'pregnancy', affair: 'affair' }[s.toLowerCase()] || 'romance') },
  { key: 'rumors', w: 0.8, re: /\b(?:rumou?rs?|speculation)\b/i, noun: () => 'rumors' },
  { key: 'look', w: 0.85, re: /\b(?:shirt|t-shirt|outfit|dress|haircut|hairstyle|tattoo|costume|hoodie|wig)\b/i,
    noun: (s) => ({ 't-shirt': 'shirt', hairstyle: 'haircut' }[s.toLowerCase()] || s.toLowerCase()) },
  { key: 'cameo', w: 0.9, re: /\b(?:cameo|surprise appearance|crash(?:es|ed)\s+(?:[\w’'‘“”-]+\s+){0,4}(?:monologue|show|stage|set|concert|wedding|party|stream|sketch)|pops (?:up|into)|shows up)\b/i,
    noun: () => 'cameo' },
  { key: 'speech', w: 0.8, re: /\b(?:speech|acceptance speech)\b/i, noun: () => 'speech' },
  { key: 'performance', w: 0.7, re: /\b(?:performance|performs|performed|halftime show)\b/i, noun: () => 'performance' },
  // (never weapons in a list, or an f-bomb: "threatens to bring guns, bombs and tanks", "drops f-bombs". Collector only, 2026-10-29: a
  // streamer's threat was titled a flop)
  { key: 'flop', w: 1.2, re: /\b(?:flop|flops|flopped|(?<![-,]\s?|\b(?:and|or|with|of|truth|f)\s)bombs(?!\s*(?:,|and\b|or\b|&))|bombed|box office bomb|lowest opening|worst opening|disappoint\w*)\b/i, noun: () => 'flop' },
  { key: 'boxoffice', w: 0.5, re: /\b(?:box office|opening weekend|tops the box office)\b/i, noun: () => 'box office' },
  { key: 'ending', w: 0.8, re: /\b(?:ending|finale)\b/i, noun: (s) => (/finale/i.test(s) ? 'finale' : 'ending') },
  { key: 'reveal', w: 0.75, re: /\b(?:reveal|reveals|revealed|unmasked|admits)\b/i, noun: () => 'reveal' },
  { key: 'collab', w: 0.8, re: /\b(?:collab|collaboration|crossover)\b/i, noun: () => 'collab' },
  { key: 'trailer', w: 0.7, re: /\b(?:trailer|teaser)\b/i, noun: () => 'trailer' },
  // (a shoot that stopped: "'The Batman Part II' halts production as director Zanan Ulmova steps away")
  { key: 'pause', w: 0.9, re: /\b(?:(?:halts?|halted|halting|pauses?|paused|pausing|suspends?|suspended|shuts? down|stops?|stopped) (?:production|filming|shooting)|(?:production|filming|shooting) (?:(?:is |was |has been )?(?:halted|paused|suspended|shut down|stopped|on hold)|halts|pauses|shuts down)|production (?:pause|halt|shutdown|delay))\b/i,
    noun: () => 'production pause' },
  { key: 'outbreak', w: 0.95, sensitive: 'tragedy', re: /\b(?:outbreak|epidemic|plague)\b/i, noun: () => 'outbreak' },
  { key: 'riots', w: 0.9, sensitive: 'violence', re: /\b(?:riots?|rioting|protests?|unrest)\b/i, noun: (s) => (/protest/i.test(s) ? 'protests' : 'riots') },
  // (a vote is what a politician's week is about: "Zanade Ulmith runoff", never the bare name)
  { key: 'election', w: 0.85, re: /\b(?:election|runoff|run-off|presidential race)\b/i, noun: (s) => (/run-?off/i.test(s) ? 'runoff' : 'election') },
  { key: 'collapse', w: 0.85, re: /\bcollaps\w+\b/i, noun: () => 'collapse' },
  { key: 'crash', w: 0.85, sensitive: 'tragedy', re: /\b(?:car crash|plane crash|helicopter crash|fatal crash|crash(?:es|ed)? (?:into|landing|landed)|killed in (?:a )?crash|wreck)\b/i, noun: () => 'crash' },
  { key: 'tribute', w: 0.8, re: /\b(?:tribute|tributes|honou?rs|remembers|memorial)\b/i, noun: () => 'tribute' },
  { key: 'injury', w: 0.55, re: /\b(?:injur\w+|hospitali[sz]ed|hospital)\b/i, noun: (s) => (/hospital/i.test(s) ? 'hospitalization' : 'injury') },
  // (a person cancelled, not a concert: "Tavix Ostiss concerts cancelled because of bad weather" is no ban)
  // (a couple calling it quits split; a platform that bans the name bans it: "Kick bans <streamer>". Collector only, 2026-10-28)
  { key: 'quit', w: 0.85, re: /\b(?:quits|quit|quitting|banned|bans|ban|(?<!(?:concerts?|shows?|tour|gigs?|dates?|events?|series|season|games?|match|flights?|tickets?)\s(?:(?:gets?|got|is|was|were|are|been|being)\s)?)cancell?ed|fired|suspended|suspends|suspension|removed|dropped by|steps down|stepping down|disqualified|disqualification|defaulted|ejected)\b/i,
    noun: (s) => (/quit|step/i.test(s) ? 'exit' : /disqualif|defaulted/i.test(s) ? 'disqualification' : /ejected/i.test(s) ? 'ejection' : /fir(?:ed|ing)|removed|dropped/i.test(s) ? 'firing' : /suspen/i.test(s) ? 'suspension' : /cancel/i.test(s) ? 'cancellation' : 'ban') },
  // (collector only, 2026-10-12: a retirement announced is what a name's week is about and had no noun: twenty headlines of a creator
  // retiring from the ring made no card. Its own family: off the field for a creator or a celebrity, sports news for an athlete)
  { key: 'retirement', w: 0.85, re: /\b(?:retires?|retired|retiring|retirement)\b(?! (?:home|plan|plans|fund|funds|account|accounts|savings|age|community|village|benefits?|income|party))/i, noun: () => 'retirement' },
  { key: 'knockout', w: 0.8, re: /\b(?:knockouts?|kos)\b/i, noun: () => 'knockouts' },
  { key: 'response', w: 0.35, re: /\b(?:responds?|response|reacts?|breaks? (?:his |her |their )?silence|speaks out|addresses|calls out|hits back|fires back|denies|denied)\b/i,
    noun: () => 'response' },
  { key: 'comeback', w: 0.6, re: /\b(?:comeback|returns to|return to)\b/i, noun: () => 'comeback' },
  // (a film's all-time record is a box office record: "Avengers: Endgame overtakes Avatar as highest-grossing movie in history")
  { key: 'record', w: 0.85, re: /\b(?:record-breaking|breaks? (?:the |a )?record|all-time (?:box office )?record|box office (?:record|crown)|highest[- ]grossing|top-grossing|biggest (?:movie|film) ever|most-liked|most liked|most-watched|most watched)\b/i,
    noun: (s) => (/gross|box office|movie|film/i.test(s) ? 'box office record' : 'record') },
];
const FAMILY = new Map(FAMILIES.map((f) => [f.key, f]));
// a product recall, only for a search that says so ("gatorade recall"): "recall" in a headline is as often someone remembering
const RECALL = { key: 'recall', w: 0.9, re: /\brecall(?:s|ed|ing)?\b/i, noun: () => 'recall' };
// what critics make of a new film or show, for one searched as itself with nothing argued about it yet ("East of Eden reviews"): never
// found among a name's nouns (talking-points.js reviewsOf asks for it)
const REVIEWS = { key: 'reviews', w: 0.5, re: /\b(?:reviews?|critics|rotten tomatoes)\b/i, noun: () => 'reviews' };
// a memoir, for a name whose week is its book's old stories ("Brinia Hassent memoir"): never found among a name's nouns
// (talking-points.js memoirOf asks for it)
const MEMOIR = { key: 'memoir', w: 0.5, re: /\b(?:memoirs?|autobiography|tell-all|new book)\b/i, noun: () => 'memoir' };
// families a sports name may list for (drama off the field); a result, a trade or an injury is sports news
const SPORTS_TALK = new Set(['allegations', 'arrest', 'death', 'stabbing', 'attack', 'fight', 'argument', 'feud', 'backlash', 'leak', 'apology', 'split',
  'romance', 'rumors', 'look', 'cameo', 'speech', 'quit', 'knockout', 'lawsuit', 'record']);
// the nouns people argue about, the kind the list leads with when they are a person's (IDEAS-SPEC "Top 20": "Bexan Tamard allegations"): a
// claim, an arrest, a lawsuit, a feud, a backlash, an apology, a split, a leak, a fight, a blowup, a rumour, a ban or a firing
const DRAMA_FAMS = new Set(['allegations', 'arrest', 'lawsuit', 'feud', 'backlash', 'apology', 'split', 'leak', 'fight', 'attack', 'stabbing', 'argument', 'rumors', 'quit',
  'threats', 'scam', 'remarks', 'hoax', 'tears', 'retirement', 'desist', 'cheating']);
// families whose card adds the denial when a title carries one
const DENIABLE = new Set(['allegations', 'rumors', 'lawsuit', 'arrest', 'attack', 'leak', 'fight', 'stabbing', 'threats', 'cheating']);
// (and a romance the person denies: "<name> engagement" told while a headline has them deny it says so. Collector only, wave 12)
const DENIED_TOO = new Set([...DENIABLE, 'romance']);
// families that are claims about a person: the "what" must report them ("accused", "allegations", "claims", "reportedly")
const CLAIMS = new Set(['allegations', 'rumors', 'attack', 'stabbing', 'fight', 'leak', 'threats', 'scam', 'cheating']);
// a line that reports its claim: a word that hedges it ("accused of", "alleged", "claims", "reportedly", a denial, an investigation), or
// who says so at its end or its start (", lawsuit says", ", police say", "Fans say ..."). Someone answering, the police or an arrest somewhere in the line hedge
// nothing: "Bexan Tamard punched a fan at mall, responds to critics" states the punch.
const REPORTED = /\b(?:alleg\w+|accus\w+|claims?|claimed|reportedly|rumou?r\w*|suspect\w*|unconfirmed|according to|said to|den(?:y|ies|ied|ial)|investigat\w+)\b|\b(?:reports?|reported)\s+(?:say|says|that|of|to)\b|,\s*(?:[\p{L}\p{N}’'.-]+\s+){0,3}(?:says?|said|reports?|reported)\s*$|^(?:[\p{L}\p{N}’'.-]+\s+){1,4}?(?:says?|said)\s/iu;
// a romance is a claim when it is one nobody announced: an affair, a pregnancy, who is dating whom
const ROMANCE_CLAIM = /\b(?:affair|pregnan\w+|dating)\b/i;
// what a creators' post or a bare headline states about someone that only a report may: a crime or a betrayal
const POST_CLAIM = /\b(?:pedophil\w*|predator\w*|groom\w*|rap(?:e|ed|ist)|molest\w*|racist|nazi|abus\w*|cheat\w*|stole|steal\w*)\b/i;
// families whose own step is the report: a charge, a suit, a verdict say who claims it
const LEGAL_STEP = new Set(['arrest', 'lawsuit', 'verdict', 'sentencing', 'mistrial', 'execution', 'prison', 'death']);
// a wrongdoing its line says was owned up to needs no hedge
const OWNED_UP = /\b(?:admits?|admitted|apologi[sz]\w+|confess\w+|confirms?|confirmed|pleads? guilty|pleaded guilty)\b/i;
// (breaking a silence or responding is no denial: "Bachelor star Hollinus Yarriss ... break silence after domestic violence charges")
// (suing on its own is no denial: "victim suing Cornell University")
// (collector only, 2026-10-12: "refutes", "disputes", "rebuts", "rejects the claims", "dismisses ... as lies", "calls ... baseless",
// "none of it happened" are denials too: "Bexan Tamard refutes new video claims he paid ..." carried no denial and the card dropped it)
const DENIAL = /\b(?:den(?:y|ies|ied|ial)(?!\s+(?:bail|entry|access|parole|visa))|refut(?:es|ed|ing)|disput(?:es|ed|ing)|rebut(?:s|ted|ting)|rejects? (?:the |all |these |those |new )?(?:\S+ )?(?:claims?|allegations?|accusations?|reports?|rumou?rs?)|dismiss(?:es|ed) [^,;:]{0,40}?(?:as )?(?:lies|false|baseless|untrue|fabricated|rumou?rs?|nonsense)|calls? [^,;:]{0,30}?(?:lies|baseless|fabricated)|calls? (?:bs|b\.s\.|bull\S*|cap) on|baseless|fabricated|none of it (?:happened|is true)|innocent|not true|false claims|fires? back|(?:is|are|was) lying|slams (?:the )?(?:claims|allegations|accusations)|pushes back|threatens (?:to sue|lawsuit|legal action)|(?:plans|announces|takes|vows) legal action|says (?:he|she|they)(?:’|')?(?:s| is| are| will be) suing)\b/i;
// a denial in so many words (a threat to sue is no denial of the claim: "Bexan Tamard threatens lawsuit after Dovette ..." still needs one)
const STRICT_DENIAL = /\b(?:den(?:y|ies|ied|ial)(?!\s+(?:bail|entry|access|parole|visa))|rejects?|innocent|not true|false claims|slams (?:the )?(?:claims|allegations|accusations)|pushes back)\b/i;
// demand, not the noun: people want it explained
const EXPLAINED = /\b(?:explained|what happened|what to know|everything we know|here['’]s why|timeline|why is|what is going on|what['’]s (?:confirmed|known|true|next)|all about)\b/i;
// a search about a name's evergreen facts, not this week's story
const FACETS = new Set(['age', 'wife', 'husband', 'net', 'worth', 'height', 'movies', 'films', 'songs', 'albums', 'kids', 'children', 'parents', 'family',
  'instagram', 'twitter', 'tiktok', 'biography', 'bio', 'nationality', 'religion', 'birthday', 'house', 'salary', 'contract', 'stats', 'number', 'jersey',
  'girlfriend', 'boyfriend', 'siblings', 'brother', 'sister', 'son', 'daughter', 'mom', 'dad', 'father', 'mother', 'tour', 'tickets', 'live', 'stream',
  'today', 'news', 'update', 'latest', 'now', 'twitch', 'youtube', 'reddit', 'video', 'videos', 'reaction', 'song', 'haircut', 'merch']);
const QUESTION = /^(?:what|who|why|how|when|where|did|does|is|are|was|were|will|can)\b/i;

/** Which families a text matches: [{ f, surface, at }] (one entry per family, its first matched word and that word's index). */
function familiesIn(text) {
  const out = [];
  const s = String(text || '');
  for (const f of FAMILIES) {
    const m = saidIn(s, f);
    if (m) out.push({ f, surface: m[0], at: words(s.slice(0, m.index)).length, index: m.index });
  }
  // what a claim says is the claim: "sexual assault allegation" is allegations, not an attack
  return out.some((x) => x.f.key === 'allegations') ? out.filter((x) => !CLAIM_CONTENT.has(x.f.key)) : out;
}
const CLAIM_CONTENT = new Set(['attack', 'stabbing', 'fight', 'threats', 'scam']);

// ---- a family's word that is no such thing ----
// an outcome only looked ahead to or asked about is none: "faces up to 20 years in prison if convicted", "could be sentenced to ..."
const NOT_YET = /\b(?:if|could|would|might|faces?|facing|to be|unless|whether|ahead of|before|should|risks?|awaits?|awaiting|possible|potential)\b/i;
// ("Will" the name and "May" the month are no helping verbs)
const NOT_YET_AUX = /\b(?:will|may|can|Will Be|May Be|Can Be)\b/;
const NOT_YET_FAMS = new Set(['verdict', 'sentencing']);
// no arrest and no charges: "will not face charges", "cleared of charges", "charges dropped"
const NOT_SO = /\b(?:no|not|never|won['’]t|without|cleared of|avoids?|avoided|escapes?|escaped|spared|dodges?)\s+(?:[\p{L}-]+\s+){0,2}$/iu;
const UNDONE = /^\s+(?:(?:are|were|was|is|been|being|have been|has been)\s+)?(?:dropped|dismissed|tossed|thrown out|withdrawn)\b/i;
// a death that is none: a hoax, a rumour, someone alive, a near miss, a figure of speech ("killed it", "dead wrong")
const DEATH_HOAXED = /\b(?:hoax\w*|death rumou?rs?|rumou?rs? of (?:his|her|their) death|fake(?:d|s)? (?:(?:his|her|their) )?(?:own )?death|not dead|isn['’]t dead|is alive|still alive|alive and well|(?:he|she|they)(?:['’]s| is| are) alive)\b/i;
const DEATH_NEAR = /\b(?:not|almost|nearly|near|nearly-|could have|could['’]ve|thought (?:he|she|they) (?:was|were))[\s-]+$/i;
const DEATH_FIGURE = /^\s+(?:it\b|wrong\b|serious\b|last\b|tired\b|set on\b|giveaway\b|ringer\b|heat\b|air\b|end\b|silent\b|center\b|even\b)/i;
// what was done to the name, never what the name did or a figure of speech: "fired back", "fired off", "fired up", "fired shots"
const QUIT_DONE = /^(?:fired|banned|bans|removed|suspended|suspends|cancell?ed)$/i;
const QUIT_FIGURE = /^\s+(?:back|off|up|shots?|a shot)\b/i;
// an apology asked for is none given: "demands apology from Bexey Tamow"
const APOLOGY_ASKED = /\b(?:demands?|demanded|demanding|wants?|wanted|owed|owes?|deserves?|expects?|awaits?|seeks?|seeking|calls? for|called for|calling for|asks? for|asked for|asking for|waiting (?:for|on))\s+(?:[\p{L}\p{N}’'.-]+\s+){0,3}$/iu;
/** Where in a headline a clause begins before `index` (after its last comma, colon, semicolon or dash). */
function clauseBefore(s, index) {
  const head = s.slice(0, index);
  const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' – '), head.lastIndexOf(' — '), head.lastIndexOf(' - '));
  return cut < 0 ? head : head.slice(cut + 2);
}
/** Whether one match of a family's words in a text is the thing itself, not one looked ahead to, denied, asked for or a figure of speech. */
function really(s, f, m) {
  const before = s.slice(0, m.index);
  const after = s.slice(m.index + m[0].length);
  if (NOT_YET_FAMS.has(f.key)) {
    const clause = clauseBefore(s, m.index);
    return !NOT_YET.test(clause) && !NOT_YET_AUX.test(clause) && !/\?\s*$/.test(s);
  }
  // (a cardiac arrest is no arrest: "Dovena Kelard suffers cardiac arrest at Mumbai home". Collector only)
  if (f.key === 'arrest') return !NOT_SO.test(before) && !UNDONE.test(after) && !(/^arrests?$/i.test(m[0]) && /(?:cardiac|heart|respiratory|cardiopulmonary)\s+$/i.test(before));
  if (f.key === 'death') return !DEATH_HOAXED.test(s) && !DEATH_NEAR.test(before) && !(/^(?:killed|dead)$/i.test(m[0]) && DEATH_FIGURE.test(after));
  // (a suspended fine or sentence is no suspension: "Zellent handed suspended fine". Collector only)
  // (and a couple calling it quits has split, the split family's: coupleQuits)
  if (f.key === 'quit') {
    const call = /^quits$/i.test(m[0]) ? before.match(CALL_IT) : null;
    return !(QUIT_DONE.test(m[0]) && QUIT_FIGURE.test(after)) && !(/^suspended$/i.test(m[0]) && /^\s+(?:\S+\s+)?(?:fine|sentence|jail|prison|term)(?![\p{L}\p{N}])/iu.test(after)) &&
      !(call && coupleQuits(s, before.slice(0, call.index), after, call[0]));
  }
  // (a clash is a feud between two people, never a fixture: "Zellley fit for Anfield clash". Said with who it is with, or of two
  // names joined by "and". Collector only)
  if (f.key === 'feud') return !(/^clash(?:es)?$/i.test(m[0]) && !/^\s+(?:with|between)(?![\p{L}\p{N}])/iu.test(after) && !/(?<![\p{L}\p{N}])and\s+(?:[\p{L}’'.-]+\s+){1,3}$/iu.test(before));
  if (f.key === 'apology') return !APOLOGY_ASKED.test(before);
  // (a prison avoided, spared or escaped is none: "<singer> avoids prison time". Collector only, 2026-10-28)
  if (f.key === 'prison') return !NOT_SO.test(before);
  // (a group divided is no breakup: "Democrats split over <name>'s event", an event that "splits the party", a split decision.
  // Collector only, 2026-10-28: a streamer's event that divided a party was titled "<streamer> split")
  // (nor one denied, withdrawn, dismissed or only rumoured: "<name> says 'divorce' has no place in his household", "<name>'s wife withdrew
  // her divorce plea", "<couple>'s divorce dismissed", "divorce rumours")
  // (and calling it quits is a split only when a couple is named; else a career, a season or a stream ended: coupleQuits. 2026-10-28: a
  // retirement and the end of a stream were titled "<name> split")
  if (f.key === 'split') return !(/^splits?$/i.test(m[0]) && (SPLIT_GROUP.test(before) || SPLIT_OBJECT.test(after))) && !SPLIT_UNDONE_BEFORE.test(before) && !SPLIT_UNDONE_AFTER.test(after) && !/[‘'"“]$/.test(before) &&
    !(CALLS_QUITS.test(m[0]) && !coupleQuits(s, before, after, m[0]));
  // (a figure of speech is no fight: "Pellan Sorraby says he still has to fight for acting jobs", "fights back tears", "fighting to
  // keep her show". Collector only: the card read "Pellan Sorraby fight")
  if (f.key === 'fight') return !(/^fight(?:s|ing)?$/i.test(m[0]) && FIGHT_FIGURE.test(after));
  return true;
}
const FIGHT_FIGURE = /^[’'"”]?\s+(?:for|to|back|off|against\s+(?:cancer|addiction|depression|the\s+odds|time|stigma|misinformation|claims?|rumou?rs?|allegations?))(?![\p{L}\p{N}])/iu;
// (who is split: a party, voters, fans, the internet, opinion; and what is split: the party, the vote, fans, a decision, a screen)
const SPLIT_GROUP = /(?<![\p{L}\p{N}])(?:democrats|republicans|dems|gop|dfl|party|parties|voters|fans|fanbase|internet|viewers|critics|community|lawmakers|leaders|officials|members|board|council|jury|justices|court|opinions?|reactions?|experts|analysts|users|netizens|people|audiences?|social media|the left|the right|congress|senate|cabinet|government|church|union|league|owners|players|team|staff|family|families)\s+(?:(?:are|were|is|was|remain|remains|appear|appears|seem|seems|stand|stands)\s+)?(?:(?:deeply|sharply|bitterly|evenly|largely|still)\s+)?$/iu;
const SPLIT_OBJECT = /^[’'"”]?\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|its\s+|their\s+)?(?:(?:[\p{L}]{2,}\s+)?part(?:y|ies)\b|vote\b|votes\b|voters\b|fans\b|fanbase\b|internet\b|opinions?\b|viewers\b|critics\b|room\b|audiences?\b|community\b|democrats\b|republicans\b|gop\b|dfl\b|congress\b|decision\b|screen\b|second\b|bill\b|check\b|difference\b|pot\b|ticket\b|personality\b)/iu;
const SPLIT_UNDONE_BEFORE = /(?<![\p{L}\p{N}])(?:no|not|never|won['’]t|without|withdr[ae]w|withdraws|withdrawn|withdrawing|withdrawal of|dismiss(?:es|ed)?|drops?|dropped|denies|denied|deny|rules? out|ruled out|calls? off|called off|halts?|halted|pauses?|paused)\s+(?:(?:her|his|their|the|a|an|its)\s+)?$/iu;
const SPLIT_UNDONE_AFTER = /^[’'"”]?\s+(?:(?:plea|petition|filing|case|proceedings)\s+)?(?:(?:is|was|has been|have been|gets?|got)\s+)?(?:withdrawn|dismissed|dropped|called off|tossed|thrown out|rumou?rs?|speculation|doesn['’]t|does not|has no|isn['’]t|is not|won['’]t|not happening|unlikely|denied)\b/iu;
// (calling it quits: a couple named, as two people joined before a plural "call it quits" ("<A> and <B> call it quits", "<A>, <B> have
// called it quits"), a partner it is called with or on ("calls it quits with his wife", "on their marriage"), or a couple's word anywhere in
// the line (a marriage, a relationship, a divorce). A singular "calls it quits" has one subject: a pair before it is no couple)
const CALLS_QUITS = /^(?:calls?|calling|called) it quits$/i;
const CALL_IT = /(?:calls?|calling|called) it\s+$/i;
const COUPLE_NAME = String.raw`\p{Lu}[\p{L}\p{N}’'.-]*(?:\s+\p{Lu}[\p{L}\p{N}’'.-]*){0,2}`;
const COUPLE_PARTNER = String.raw`(?:(?:his|her|their|His|Her|Their)\s+)?(?:${COUPLE_NAME}|wife|husband|girlfriend|boyfriend|fianc[eé]e?|partner|spouse)`;
const COUPLE_PAIR = new RegExp(String.raw`${COUPLE_NAME}(?:\s+(?:and|And|AND|&)\s+|,\s+)${COUPLE_PARTNER}\s+(?:(?:have|has|had|officially|reportedly|finally|quietly|seemingly|Have|Has|Officially|Reportedly|Finally)\s+){0,2}$`, 'u');
const COUPLE_WITH = /^\s+(?:with|from|on)\s+(?:(?:his|her|their)\s+)?(?:(?:\d+-year|long-?time)\s+)?(?:wife|husband|girlfriend|boyfriend|fianc[eé]e?|partner|spouse|marriage|relationship|romance|engagement)(?![\p{L}\p{N}])/iu;
const COUPLE_WORD = /(?<![\p{L}\p{N}])(?:marriage|married|marital|relationship|romance|romantic|couple(?!\s+of(?![\p{L}\p{N}]))|lovebirds|engagement|divorc\w*|breakup|break-up)(?![\p{L}\p{N}])/iu;
/** Whether "call(s) it quits" in a text is said of a couple (before: the text up to the verb; verb: "call it quits", "calls it", ...). */
const coupleQuits = (s, before, after, verb) => COUPLE_WORD.test(s) || COUPLE_WITH.test(after) || (!/^calls\b/i.test(verb) && COUPLE_PAIR.test(before));
const CHECKED_FAMS = new Set(['verdict', 'sentencing', 'arrest', 'death', 'quit', 'apology', 'fight', 'feud', 'prison', 'split']);
/** A family's first match in a text that is the thing itself (see `really`), as `text.match(f.re)` gives it; or null. */
function saidIn(text, f) {
  const s = String(text || '');
  const first = s.match(f.re);
  if (!first || !CHECKED_FAMS.has(f.key) || really(s, f, first)) return first;
  const all = new RegExp(f.re.source, f.re.flags.includes('g') ? f.re.flags : `${f.re.flags}g`);
  all.lastIndex = first.index + Math.max(1, first[0].length);
  for (let m = all.exec(s); m; m = all.exec(s)) {
    if (really(s, f, m)) return m;
    if (m[0].length === 0) all.lastIndex += 1;
  }
  return null;
}
/** Whether a text says a family's thing itself: `f.re.test(text)`, less the matches that are no such thing. */
const saysIt = (text, f) => !!f && !!saidIn(text, f);
// a death that turned out to be none ("Bexan Tamard death hoax"): never found among a name's nouns (talking-points.js hoaxOf asks for it)
const HOAX = { key: 'hoax', w: 0.85, re: /\b(?:hoax\w*|death rumou?rs?|rumou?rs? of (?:his|her|their) death|fake(?:d|s)? (?:(?:his|her|their) )?(?:own )?death|not dead|isn['’]t dead)\b/i, noun: () => 'death hoax' };
const NEAR_WORDS = 12;
const THIN_TITLES = 10;

// ---- a name told only after another person's noun (collector only, 2026-11-01) ----
// "<Other> dies at 52 after cancer battle, <name> pays tribute", "<Other>, 52, dies; co-star <name> heartbroken", "<Other> sued by former
// manager, <name> weighs in": the noun is the other person's, whose full name stands before it, and the name only comes after it, past a
// clause break or with a reaction of its own. A title "<name> death" over such a line says a living person died.
const TRAIL_REACT = /^\s+(?:also\s+|now\s+|is\s+|was\s+|left\s+)?(?:pa(?:ys|id|ying)\s+tribute|leads?\s+tributes|led\s+tributes|heartbroken|devastated|gutted|shocked|stunned|weigh(?:s|ed|ing)?\s+in|speak(?:s|ing)?\s+out|spoke\s+out|break(?:s|ing)?\s+(?:silence|down)|broke\s+(?:silence|down)|react(?:s|ed|ing)?|respond(?:s|ed|ing)?|defend(?:s|ed|ing)?|mourn(?:s|ed|ing)?|shar(?:es|ed|ing)|remember(?:s|ed|ing)?|honou?r(?:s|ed|ing)|send(?:s|ing)?\s+(?:love|prayers|condolences)|sent\s+(?:love|prayers|condolences))(?![\p{L}\p{N}])/iu;
const TRAIL_BREAK = /[,;:|]|\s[—–-]\s/;
/** Whether a text holds a full name other than the name's: two capitalised words in a row, a given name's or two no dictionary spells. */
function otherFullName(text, own, titleCase) {
  const toks = String(text || '').split(/\s+/).map((t) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/[’']s$/, '')).filter(Boolean);
  for (let i = 0; i + 1 < toks.length; i++) {
    const [a, b] = [toks[i], toks[i + 1]];
    if (!/^\p{Lu}\p{Ll}/u.test(a) || !/^\p{Lu}\p{Ll}/u.test(b)) continue;
    const pair = `${a.toLowerCase()} ${b.toLowerCase()}`;
    if (pair.split(' ').some((w) => own.has(w) || NAME_STOP.has(w))) continue;
    if (personLike(pair, null) || (!titleCase && !W.inDict(a.toLowerCase()) && !W.inDict(b.toLowerCase()))) return true;
  }
  return false;
}
/**
 * Whether a family's word in a text (x: { f, surface, index }) is another person's that the name only follows: no word of the name
 * before it, another full name before it, and every mention of the name after it past a clause break or with a reaction of its own.
 */
function trailingOnlooker(text, x, name) {
  if (!text || !x || !Number.isFinite(x.index) || !name) return false;
  const s = String(text);
  const nw = String(name).toLowerCase().split(' ').filter(Boolean);
  if (nw.length < 1) return false;
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before = s.slice(0, x.index);
  const own = new Set(nw);
  if (nw.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'iu').test(before))) return false;
  const end = x.index + String(x.surface || '').length;
  const last = new RegExp(`(?<![\\p{L}\\p{N}])${esc(nw[nw.length - 1])}(?:[’']s)?(?![\\p{L}\\p{N}])`, 'giu');
  const hits = [...s.matchAll(last)].filter((m) => m.index >= end);
  if (!hits.length || !otherFullName(before, own, titleCased(s))) return false;
  return hits.every((m) => TRAIL_BREAK.test(s.slice(end, m.index)) || TRAIL_REACT.test(s.slice(m.index + m[0].length)));
}
/**
 * Whether a noun in a headline is someone else's than the name's: a claim made against another name ("Drubzo calls Plonlo's
 * allegations against Bexan Tamard hearsay" is no claim about Drubzo), a noun another name owns ("... reacts to Bexan Tamard's arrest";
 * never a claim, which its maker owns: "Dovette's allegations" are about Bexan Tamard), or a word for someone of theirs ("wrongfully
 * convicted friend's brother").
 */
function othersNoun(title, x, name) {
  if (!name || !Number.isFinite(x.index)) return false;
  // (another's noun the name only follows: "<Other> dies at 52, <name> pays tribute", trailingOnlooker)
  if (trailingOnlooker(title, x, name)) return true;
  // (and the tribute the name pays to that death is no tribute to the name: "<name> tribute" would read as a death of its own)
  if (x.f.key === 'tribute' && familiesIn(title).some((y) => y.f.key === 'death' && trailingOnlooker(title, y, name))) return true;
  const nw = name.split(' ');
  const own = (w) => nw.includes(words(w)[0] || '');
  const after = title.slice(x.index + x.surface.length);
  const before = title.slice(0, x.index);
  // (the one the noun is said to face or be made against, up to two small words on: "allegations facing Tobin Hale", "backlash
  // grows against Tobin Hale". Collector only, 2026-10-19: a roster name that only released findings on someone else's allegations
  // took the title)
  const against = after.match(/^[’'"”]?\s+(?:\p{Ll}+\s+){0,2}(?:[Aa]gainst|facing|faced by|aimed at|directed at|levell?ed at)\s+(?:\p{Ll}+\s+){0,2}(\p{Lu}[\p{L}\p{N}’'.-]*)/u);
  if (against && !own(against[1].replace(/[’']s$/, ''))) return true;
  // (and whoever a headline says faces, sparks or draws the noun owns it, up to two small words on: "Senate candidate Tobin Hale
  // faces backlash over Mara Voss ties" is Tobin Hale's backlash, and Mara Voss is only mentioned. Never a word of the name's own)
  const faces = before.match(/(\p{Lu}[\p{L}\p{N}’'.-]*)\s+(?:faces?|facing|faced|sparks?|sparked|sparking|draws?|drew|drawing|gets?|got|getting|receives?|received|hit with|met with|under)\s+(?:[\p{Ll}-]+\s+){0,2}$/u);
  if (faces && !own(faces[1].replace(/[’']s$/, ''))) return true;
  // (a cheating claim's possessive is who makes it, never who cheated: "<name> on wife <other>'s cheating claims" is a claim about the name)
  const owner = OWNED.has(x.f.key) && !(x.f.key === 'cheating' && CLAIM_NOUN.test(x.surface)) ? before.match(/(\p{Lu}[\p{L}\p{N}.-]*)[’']s\s+(?:[\p{Ll}-]+\s+){0,2}$/u) : null;
  if (owner && !own(owner[1])) return true;
  // (what the name did to someone else: "Bexan Tamard banned a viewer", "Orrus Neskenko cancelled her Paris shows")
  if (x.f.key === 'quit' && QUIT_DONE.test(x.surface) && own(words(before).slice(-1)[0] || '') && !/[,:;]\s*$/.test(before) && DID_TO.test(after)) return true;
  // (a claim the name makes is about someone else: "<name> alleges someone is influencing his wife", "<name> accuses <other> of lying"
  // tell no claim against the name. Never "accused of" or "alleged to": those are about it. Collector only, 2026-10-28: a line where the
  // name made the claim stood under "<name> allegations")
  const lastBefore = words(before.replace(/\s+(?:now|also|publicly|reportedly|then|later)\s*$/i, ' ')).slice(-1)[0] || '';
  // (a ban the name hands out is never its own: "Kick bans <streamer>" is the streamer's, "<street> bans traffic" no ban of the street's.
  // Collector only, 2026-10-28)
  if (x.f.key === 'quit' && /^bans$/i.test(x.surface) && own(lastBefore) && !/[,:;]\s*$/.test(before)) return true;
  if (x.f.key === 'allegations' && MAKES_CLAIM.test(x.surface) && own(lastBefore) && !/[,:;]\s*$/.test(before) &&
    (!/^(?:accused|alleged)$/i.test(x.surface) || MADE_AGAINST.test(after))) return true;
  return /ed$/i.test(x.surface) && OF_THEIRS.test(after);
}
const CLAIM_NOUN = /\b(?:claims?|allegations?|accusations?|rumou?rs?|reports?)$/i;
const MAKES_CLAIM = /^(?:alleges|alleging|alleged|accuses|accusing|accused)$/i;
// (whom an active "accused" or "alleged" is made against: "<name> accused her ex of ...", never "accused of", "accused by")
const MADE_AGAINST = /^\s+(?![Oo]f\b|[Bb]y\b|[Ii]n\b|[Tt]o\b|[Oo]ver\b|[Aa]fter\b|[Aa]mid\b|[Aa]s\b|OF\b|BY\b)(?:him|her|them|his|their|the|a|an|someone|people|fans|\p{Lu}[\p{L}\p{N}’'.-]*)/u;
const OWNED = new Set(['arrest', 'death', 'apology', 'split', 'lawsuit', 'sentencing', 'verdict', 'injury', 'quit', 'romance', 'cheating']);
const DID_TO = /^\s+(?:an?|the|his|her|their|its|him|them|two|three|several|some|all|every|\d+|\p{Lu}[\p{L}\p{N}’'.-]*)\b/u;
const OF_THEIRS = /^\s+(?:\p{L}+[’']s\s+)?(?:friend|brother|sister|father|mother|dad|mom|son|daughter|wife|husband|cousin|uncle|aunt|ex|fan|man|woman|teen)\b/iu;

// ---- a name that only watches, answers or mourns a family's thing (collector only, 2026-10-28) ----
// "<name> reacts to arrest of <other>", "<name> witnesses stabbing outside venue", "<name> condemns attack on fans", "<name> mourns death
// of friend": the thing is someone else's, and a title "<name> arrest" states it of the wrong person. Who only watches it (witnesses,
// mourns, condemns, pays tribute) never owns it; who talks of it or reacts to it owns it only when it is a claim made of them, a ban, a
// suit, a feud or a split they answer ("<name> responds to allegations", "<name> addresses ban")
const ONLOOKER = /(?<![\p{L}\p{N}])(?:witness(?:es|ed|ing)?|saw|sees|seeing|watch(?:es|ed|ing)?|condemn(?:s|ed|ing)?|mourn(?:s|ed|ing)?|griev(?:es|ed|ing)|honou?r(?:s|ed|ing)|pa(?:ys|id|ying) tribute|prais(?:es|ed|ing)|back(?:s|ed|ing)|support(?:s|ed|ing)|pray(?:s|ed|ing) for|send(?:s|ing)? (?:love|prayers|condolences)|sent (?:love|prayers|condolences))(?![\p{L}\p{N}])/iu;
const REACTS = /(?<![\p{L}\p{N}])(?:react(?:s|ed|ing)?|respond(?:s|ed|ing)?|address(?:es|ed|ing)?|speak(?:s|ing)?|spoke|talk(?:s|ed|ing)?|discuss(?:es|ed|ing)?|comment(?:s|ed|ing)?|weigh(?:s|ed|ing)? in|break(?:s|ing)? down|broke down|recall(?:s|ed|ing)?|remember(?:s|ed|ing)?|reflect(?:s|ed|ing)?|defend(?:s|ed|ing)?|slam(?:s|med|ming)?|blast(?:s|ed|ing)?|call(?:s|ed|ing)? out|mock(?:s|ed|ing)?|criticiz(?:es|ed|ing)|criticis(?:es|ed|ing)|hit(?:s|ting)? back|open(?:s|ed|ing)? up|shar(?:es|ed|ing)|jok(?:es|ed|ing)|tweet(?:s|ed|ing)?|post(?:s|ed|ing)?)(?![\p{L}\p{N}])/iu;
const ANSWERED = new Set(['allegations', 'backlash', 'rumors', 'cheating', 'scam', 'threats', 'quit', 'desist', 'lawsuit', 'feud', 'split', 'leak']);
// the family's word as a noun (after a small word) with someone else after it: "arrest of fellow streamer <other>", "death of his manager",
// "attack on fans", "ban of <other>". Never "accused of fraud" (a verb's), nor "allegations of abuse" (what the claim says)
const AS_NOUN = /(?<![\p{L}\p{N}])(?:to|the|a|an|on|about|over|after|amid|following|into|at|by|in|of|his|her|their|its)\s+(?:[\p{Ll}-]+\s+)?$/iu;
const OF_OTHER = /^[’'"”]?\s+(?:of|on|against|involving|targeting|toward|towards)\s+(?:(?:his|her|their|its|a|an|the|His|Her|Their|A|An|The)\s+)?(?:(?:fellow|former|ex|longtime|long-time|late|beloved|close|best|old|young|own|Fellow|Former|Longtime|Long-Time|Late|Beloved|Close|Best|Old|Young|Own)[-\s]+)*([\p{L}\p{N}’'.-]+)/u;
const OTHER_PERSON = /^(?:friends?|managers?|colleagues?|co-?stars?|co-?hosts?|hosts?|streamers?|rappers?|singers?|actors?|actress(?:es)?|teammates?|rivals?|moderators?|mods?|employees?|staffers?|assistants?|bodyguards?|fans?|viewers?|followers?|subscribers?|creators?|youtubers?|influencers?|players?|coach(?:es)?|members?|bandmates?|producers?|directors?|stars?|men|man|women|woman|teens?|girls?|boys?|child(?:ren)?|kids?|suspects?|drivers?|officers?|crew|security|family|partner|spouse|father|mother|dad|mom|brother|sister|son|daughter|wife|husband|ex|girlfriend|boyfriend|cousin|uncle|aunt|people|protesters?|strangers?|someone|man’s|woman’s)$/i;
/** Whether the word after "of" or "on" names someone else: a person's role or relation, a pronoun's someone, or a capitalised name. */
function someoneNamed(word, titleCase) {
  const w = String(word || '').replace(/[’']s$/i, '').replace(/[^\p{L}\p{N}-]+$/gu, '');
  if (!w) return false;
  if (OTHER_PERSON.test(w)) return true;
  if (!/^\p{Lu}/u.test(w)) return false;
  // (in a Title Case headline every word is capitalised: a capitalised word is a name only when no dictionary spells it)
  return !titleCase || !W.inDict(w.toLowerCase());
}
/**
 * Whether a family's word in a text (x: { f, surface, index }) is one the name only watches, answers or mourns, never its own: a
 * watching verb between the name and the word ("<name> witnesses stabbing"); a reacting verb there when the family is no claim the name
 * answers ("<name> reacts to arrest of ..."); or the word, said as a noun, of someone else ("arrest of fellow streamer <other>",
 * "attack on fans"). False when the name is not before the word in its clause.
 */
function onlooker(text, x, name) {
  if (!text || !x || !Number.isFinite(x.index) || !name) return false;
  const s = String(text);
  const before = s.slice(0, x.index);
  const after = s.slice(x.index + String(x.surface || '').length);
  const last = String(name).split(' ').filter(Boolean).slice(-1)[0];
  if (!last) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[’']s)?(?![\\p{L}\\p{N}])`, 'giu');
  const hits = [...before.matchAll(re)];
  const named = hits.length ? hits[hits.length - 1] : null;
  const own = new Set(String(name).toLowerCase().split(' '));
  const ofOther = AS_NOUN.test(before) && !/ed$/i.test(String(x.surface || '')) && (() => {
    const m = after.match(OF_OTHER);
    return !!m && !own.has(m[1].toLowerCase().replace(/[’']s$/, '')) && someoneNamed(m[1], titleCased(s)); // (titleCased: the line pick's, below)
  })();
  if (!named) return ofOther || trailingOnlooker(s, x, name);
  const between = before.slice(named.index + named[0].length);
  if (/[,;:—–|]/.test(between)) return false;
  if (ONLOOKER.test(between)) return true;
  // (a reaction to one's own: "<name> reacts to his arrest")
  if (REACTS.test(between) && !ANSWERED.has(x.f.key) && !/(?<![\p{L}\p{N}])(?:his|her|their)\s+(?:[\p{L}-]+\s+)?$/iu.test(before)) return true;
  return ofOther;
}
/** Whether a family's word in a text is only rumoured, claimed or reported ("arrest rumours", "death reports"): the thing is not said. */
const rumoured = (text, x) => !!x && Number.isFinite(x.index) && /^[’'"”]?\s+(?:rumou?rs?|claims?|reports?|speculation|hoax(?:es)?|theor(?:y|ies))(?![\p{L}\p{N}])/iu.test(String(text).slice(x.index + String(x.surface || '').length));
/**
 * Whether a text gives a family's noun to someone other than the name (othersNoun, on the family's first real match): a line that
 * says "<Other> faces backlash over <name> ties" or "allegations facing <Other>" is no line of the name's "<name> backlash" card.
 * False when the text does not say the noun at all.
 */
function othersSaid(text, f, name) {
  if (!f || !name) return false;
  const s = String(text || '');
  const m = saidIn(s, f);
  return !!m && othersNoun(s, { f, surface: m[0], index: m.index, at: words(s.slice(0, m.index)).length }, name);
}

/** Word positions where a name starts in a word list. */
function nameAt(ws, name) {
  const nw = name.split(' ');
  const out = [];
  for (let i = 0; i + nw.length <= ws.length; i++) if (ws.slice(i, i + nw.length).join(' ') === nw.join(' ')) out.push(i);
  return out;
}

/**
 * The talking-point noun of a name's evidence: each title once (full weight when the noun sits within eight words of the name, less
 * when the name is far or absent), plus related Trends queries and fresh YouTube completions (people typing it) at double weight and
 * the trend keyword's own extra words at triple, times the family's weight. The noun must repeat in the titles (twice near the name),
 * unless there are hardly any titles and the searches say it. Returns { f, noun, count, share, explained } or null.
 */
function nounOf(titles, { related = [], fresh = [], rest = '', name = '', only = null, nearWords = NEAR_WORDS, pool = null, thin = false } = {}) {
  const score = new Map();
  const near = new Map();
  const said = new Map();
  const surfaces = new Map();
  const add = (key, surface, w) => {
    score.set(key, (score.get(key) || 0) + w);
    const m = surfaces.get(key) || new Map();
    m.set(surface.toLowerCase(), (m.get(surface.toLowerCase()) || 0) + w);
    surfaces.set(key, m);
  };
  for (const t of titles) {
    const ws = words(t);
    const at = name ? nameAt(ws, name) : [];
    // (how far a noun stands from the name is counted from the name's nearer end: "Wynory Pymith faces six-month social media ban"
    // has its ban six words after "Pymith", and was read as seven from "Wynory", one too far to be his. Judges, 2026-10-12)
    const nameWords = name ? name.split(' ').length : 1;
    const away = (i) => (x) => (x.at >= i + nameWords ? x.at - (i + nameWords - 1) : Math.abs(x.at - i));
    for (const x of familiesIn(t)) {
      // (someone else's noun is no noun of the name's, however near it stands)
      const close = at.some((i) => away(i)(x) <= nearWords) && !othersNoun(t, x, name);
      add(x.f.key, x.surface, close ? 1 : at.length ? 0.3 : 0.5);
      if (at.length) said.set(x.f.key, (said.get(x.f.key) || 0) + 1);
      if (close) near.set(x.f.key, (near.get(x.f.key) || 0) + 1);
    }
  }
  let searched = new Map();
  const addQuery = (q, w) => { for (const x of familiesIn(q)) { add(x.f.key, x.surface, w); searched.set(x.f.key, (searched.get(x.f.key) || 0) + w); } };
  related.forEach((q) => addQuery(q, 2));
  fresh.forEach((q) => addQuery(q, 2));
  if (rest) addQuery(rest, 3);
  const few = titles.length < 5;
  // (pool: families that are one story told three ways, something said, who hit back and the backlash: each headline says one of them)
  const pooled = pool ? [...pool].reduce((n, k) => n + (near.get(k) || 0), 0) : 0;
  const inPool = (k) => !!pool && pool.has(k) && pooled >= 2 && (near.get(k) || 0) >= 1;
  // (thin: a story a handful of headlines carry, a creators' beat's: one says the noun right by the name, another says it at all)
  const inThin = (k) => thin && titles.length <= THIN_TITLES && (near.get(k) || 0) >= 1 && (said.get(k) || 0) >= 2;
  // (only: the families asked for, a drama name's newest wave among the nouns people argue about)
  const ranked = [...score.entries()].map(([k, n]) => ({ f: FAMILY.get(k), n })).filter((x) => !only || only.has(x.f.key))
    .filter((x) => (near.get(x.f.key) || 0) >= 2 || inPool(x.f.key) || inThin(x.f.key) || (few && (searched.get(x.f.key) || 0) >= 2) || ((near.get(x.f.key) || 0) >= 1 && (searched.get(x.f.key) || 0) >= 2))
    .sort((a, b) => b.n * b.f.w - a.n * a.f.w || a.f.key.localeCompare(b.f.key));
  const explained = titles.filter((t) => EXPLAINED.test(t)).length + [...related, ...fresh].filter((q) => EXPLAINED.test(q)).length;
  if (!ranked.length) return explained ? { f: null, noun: null, count: 0, share: 0, explained } : null;
  const best = ranked[0];
  const surface = [...surfaces.get(best.f.key).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  const count = inPool(best.f.key) ? Math.max(pooled, near.get(best.f.key) || 0) : inThin(best.f.key) ? Math.max(said.get(best.f.key) || 0, near.get(best.f.key) || 0) : near.get(best.f.key) || 0;
  return { f: best.f, noun: best.f.noun(surface), count, share: titles.length ? count / titles.length : 0, explained };
}

// ---------- names in titles ----------
const CAP_TOKEN = /^[\p{Lu}][\p{L}\p{N}’'.&-]*$/u;
const NAME_STOP = new Set(['the', 'a', 'an', 'i', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'is', 'his', 'her', 'their',
  'after', 'before', 'over', 'amid', 'why', 'what', 'how', 'who', 'watch', 'exclusive', 'breaking', 'update', 'new', 'video', 'report', 'reports']);
/** Capitalised runs of two or three words in a title, lowercased ("Wynia Pymick", "Esselle Quillith", "Hollinane Yarrner"). */
function nameRuns(title) {
  const toks = String(title || '').replace(/[“”"‘’'](?=\s|$)|(?<=\s|^)[“”"‘’']/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  let run = [];
  const flush = () => {
    const ws = run.map((t) => words(t).join(' ')).filter(Boolean);
    while (ws.length && NAME_STOP.has(ws[0])) ws.shift();
    while (ws.length && NAME_STOP.has(ws[ws.length - 1])) ws.pop();
    if (ws.length >= 2 && ws.length <= 3) out.push(ws.join(' '));
    run = [];
  };
  for (const tok of toks) {
    const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '');
    if (core && CAP_TOKEN.test(core) && !/[,:;!?]$/.test(tok.replace(/[’']s$/, ''))) {
      run.push(core);
      if (/[’']s[^\p{L}]*$/u.test(tok)) flush(); // a possessive ends the name: "Lyso Marrwyn's SNL"
    } else {
      if (core && CAP_TOKEN.test(core)) { run.push(core); }
      flush();
    }
  }
  flush();
  return out;
}

/** A person-like name: two or three words opening with a given name ("wynia pymick", "esselle quillith"), or one the lexicon knows as a person. */
const personLike = (name, lex) => {
  const ws = name.split(' ');
  if (ws.length < 2 || ws.length > 3) return false;
  return W.isFirstName(ws[0]) || (!!lex && !!lex.firstNames && lex.firstNames.has(ws[0]) && !ACRONYM.has(ws[0]) && !W.inDict(ws[0]));
};

// families where the noun happens to one person, who may not be the trend's name ("Wynia Pymick dies" under "jaso"; "Esselle Quillith
// crashes Lyso Marrwyn's SNL monologue" under "lyso marrwyn"); an allegation, a lawsuit or a feud is between two and stays the trend's
const SWITCHABLE = new Set(['death', 'arrest', 'stabbing', 'cameo', 'injury', 'romance', 'split', 'look', 'speech', 'performance', 'quit', 'apology',
  'reveal', 'execution', 'cheating']);
/**
 * Who the noun is about: the trend's own name, unless another person named around it (its related queries, its titles) is the name
 * closest before the noun word in clearly more of the family's titles.
 */
function subjectOf(entity, family, titles, candidates) {
  if (!family || !SWITCHABLE.has(family.key)) return entity;
  const famTitles = titles.filter((t) => saysIt(t, family));
  if (famTitles.length < 2) return entity;
  const names = [entity, ...candidates.filter((c) => c !== entity && !contains(entity, c) && !contains(c, entity))];
  const votes = new Map();
  let theirs = 0;
  for (const t of famTitles) {
    const ws = words(t);
    const m = saidIn(t, family);
    const at = words(t.slice(0, m.index)).length;
    let best = null;
    for (const n of names) for (const i of nameAt(ws, n)) { const end = i + n.split(' ').length; if (end <= at && (!best || end > best.end)) best = { n, end }; }
    // (someone of the name's between it and the noun: the noun is theirs, no vote for the name and none against the one the other
    // titles name: "Jaso Wickick's partner found dead" beside "Wynia Pymick, ex-fiancé of Jaso Wickick, found dead")
    if (best && best.n === entity && ws.slice(best.end, at).some((w) => RELATION.has(w))) { theirs += 1; continue; }
    if (best) votes.set(best.n, (votes.get(best.n) || 0) + 1);
  }
  const own = votes.get(entity) || 0;
  const top = [...votes.entries()].filter(([n]) => n !== entity).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top && top[1] >= Math.max(2, 1.5 * own) && top[1] >= 0.35 * (famTitles.length - theirs) ? top[0] : entity;
}

// ---------- whose noun ----------
/** The raw text between the last mention of a name before index `at` and `at`, or null ("Orret Neskurn, son of Essade Quillard, dies"). */
function textBetween(title, name, at) {
  const pat = new RegExp(`(?<![\\p{L}\\p{N}])${name.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+')}(?:['’]s)?(?![\\p{L}\\p{N}])`, 'giu');
  let end = -1;
  for (const m of title.matchAll(pat)) if (m.index + m[0].length <= at) end = m.index + m[0].length;
  return end < 0 ? null : title.slice(end, at);
}
// "Orret Neskurn, son of model Essade Quillard, dies": an aside between commas describes the name itself
const APPOSITIVE = /^\s*,[^,]{1,80},\s*$/;
// families that happen to someone: when the titles put a relative or a pet between the name and the noun ("Thalena Lorrner's daughter
// Holliniel dead", "Yolkmo's cat Mimi dies"), the card says whose ("Thalena Lorrner daughter death"), never the name's own death
const PERSONAL = new Set(['death', 'injury', 'stabbing', 'arrest', 'attack', 'crash']);
const RELATION = new Map([['daughter', 'daughter'], ['son', 'son'], ['wife', 'wife'], ['husband', 'husband'], ['partner', 'partner'], ['fiance', 'fiance'],
  ['fiancee', 'fiancee'], ['ex', 'ex'], ['boyfriend', 'boyfriend'], ['girlfriend', 'girlfriend'], ['mom', 'mom'], ['mother', 'mother'], ['dad', 'dad'],
  ['father', 'father'], ['brother', 'brother'], ['sister', 'sister'], ['baby', 'baby'], ['child', 'child'], ['kid', 'child'], ['cat', 'cat'], ['dog', 'dog'],
  ['pet', 'pet'], ['bodyguard', 'bodyguard'], ['manager', 'manager'], ['friend', 'friend'], ['costar', 'co-star'], ['co', 'co-star'], ['grandmother', 'grandmother'],
  ['grandfather', 'grandfather'], ['nephew', 'nephew'], ['niece', 'niece'], ['stepson', 'stepson'], ['stepdaughter', 'stepdaughter']]);
// whose "his" and "her" are: a pronoun before the noun that is not the relative's is the name's own ("X's wife pays tribute after his death")
const RELATION_HER = new Set(['daughter', 'wife', 'fiancee', 'girlfriend', 'mom', 'mother', 'sister', 'grandmother', 'niece', 'stepdaughter']);
const RELATION_HIS = new Set(['son', 'husband', 'fiance', 'boyfriend', 'dad', 'father', 'brother', 'grandfather', 'nephew', 'stepson']);
/**
 * The relative named right after the name's possessive, however far the noun comes ("Miret Vorow's wife Fenus Zellurn before her
 * death": wife), unless the pronoun before the noun is the name's own. Collector only: a card never says a living person died on the
 * strength of a headline about their wife.
 */
function possessiveRelation(title, subject, at) {
  const name = subject.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+');
  const m = title.match(new RegExp(`${name}['’]s?\\s+(?:[\\p{L}\\d-]+\\s+){0,2}?(${[...RELATION.keys()].join('|')})\\b`, 'iu'));
  if (!m || m.index > at) return null;
  const rel = RELATION.get(m[1].toLowerCase());
  // (a relative who is the one acting is alive: "X's wife pays tribute after death" is no death of hers)
  if (LIVING.test(title.slice(m.index + m[0].length, at))) return null;
  const pronoun = (title.slice(0, at).match(/\b(his|her)\s+(?:[\p{L}-]+\s+)?$/iu) || [])[1];
  if (pronoun && ((/^his$/i.test(pronoun) && RELATION_HER.has(rel)) || (/^her$/i.test(pronoun) && RELATION_HIS.has(rel)))) return null;
  return rel;
}
// ---------- whose it is, read from the headline itself (collector only) ----------
// what only the living do in a headline: a name that does one of these before the noun is not the one it happened to, and a relative
// who does one is alive ("Thaley Lorriss addresses death of ...", "Miret Vorow says final goodbye ...", "... wife pays tribute")
const LIVING_WORDS = ['says', 'said', 'addresses', 'addressed', 'mourns', 'mourn', 'mourning', 'mourned', 'pays', 'paid', 'breaks', 'broke', 'shares', 'shared', 'remembers',
  'remembered', 'honors', 'honours', 'honored', 'honoured', 'reacts', 'reacted', 'responds', 'responded', 'speaks', 'spoke', 'opens', 'reveals', 'revealed', 'announces',
  'announced', 'confirms', 'confirmed', 'bids', 'attends', 'attended', 'delivers', 'delivered', 'posts', 'posted', 'writes', 'wrote', 'thanks', 'thanked', 'grieves', 'grieving',
  'recalls', 'reflects', 'talks', 'tells', 'told', 'calls', 'slams', 'defends', 'blames', 'heartbroken', 'devastated'];
const LIVING = new RegExp(`(?<![\\p{L}\\p{N}])(?:${LIVING_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What stands between a name's last mention before index `at` and `at`: { text, possessive (the name's own 's opens it) }, or null. */
function spanAfter(title, name, at) {
  const pat = new RegExp(`(?<![\\p{L}\\p{N}])${name.split(' ').map(escapeRe).join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}])`, 'giu');
  let end = -1;
  for (const m of String(title).matchAll(pat)) if (m.index + m[0].length <= at) end = m.index + m[0].length;
  if (end < 0) return null;
  const text = title.slice(end, at);
  return { text, possessive: /^[’']s(?![\p{L}\p{N}])/u.test(text) };
}
const RELATION_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${[...RELATION.keys()].join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const OTHERS_POSSESSIVE = /[\p{L}\p{N}][’']s\s+(?:[\p{L}\p{N}-]+\s+){0,2}$/u;
// ("he's", "it's": no possessive)
const CONTRACTION = /(?<![\p{L}\p{N}])(it|he|she|that|there|here|what|who|let|everyone|everything)[’']s(?![\p{L}\p{N}])/giu;
/**
 * The first relative a stretch of a headline names that is the name's own and is not the one acting: one after another name's
 * possessive is that name's ("... death of Essade Quillard's son"), and one who mourns, says or shares is alive ("... wife pays tribute
 * after death"). A possessive that opens the stretch is the name's own ("[Thalena Lorrner]'s daughter Holliniel dead").
 */
function ownRelation(text) {
  const s = String(text || '');
  for (const m of s.matchAll(RELATION_RE)) {
    const before = s.slice(0, m.index).replace(/^\s*[’']s(?![\p{L}\p{N}])/u, '').replace(CONTRACTION, '$1 is');
    if (OTHERS_POSSESSIVE.test(` ${before}`)) continue;
    if (LIVING.test(s.slice(m.index + m[0].length))) continue;
    return RELATION.get(m[1].toLowerCase());
  }
  return null;
}
/** Whether the name itself is the one acting between its mention and index `at` ("Thaley Lorriss addresses ..."): never its possessive's owner. */
function actsBefore(title, name, at) {
  const mid = spanAfter(title, name, at);
  return !!mid && !mid.possessive && LIVING.test(mid.text);
}
/** The relative or pet a personal noun belongs to in most of the family's titles, or null ("daughter" for Thalena Lorrner's death story). */
function relationOf(subject, family, titles) {
  if (!family || !PERSONAL.has(family.key)) return null;
  const famTitles = titles.filter((t) => saysIt(t, family) && nameAt(words(t), subject).length);
  const counts = new Map();
  for (const t of famTitles) {
    const m = saidIn(t, family);
    const pre = words(t.slice(0, m.index));
    const end = nameAt(pre, subject).map((i) => i + subject.split(' ').length).pop();
    const mid = spanAfter(t, subject, m.index);
    // "Thalena Lorrner's daughter Holliniel dead", or after the noun: "Thalena Lorrner announces death of 13-year-old daughter Holliniel"
    // (and however far the noun comes when the name is the one acting: "Miret Vorow says final goodbye to beloved wife Fenus
    // Zellurn at funeral". Never someone else's relative, "... death of Essade Quillard's son", nor one who is acting, "... wife pays
    // tribute after death". Collector only)
    const near = end !== undefined && !!mid && !APPOSITIVE.test(textBetween(t, subject, m.index) || '') && (pre.length - end <= 4 || actsBefore(t, subject, m.index));
    const post = t.slice(m.index + m[0].length);
    const rel = (near ? ownRelation(mid.text) : null) || (/^\s*of\b/i.test(post) ? ownRelation(post.split(/\s+/).filter(Boolean).slice(0, 6).join(' ')) : null) ||
      possessiveRelation(t, subject, m.index);
    if (rel) counts.set(rel, (counts.get(rel) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // (when every one of the family's titles says whose it is, one title is enough: the name's own death is never said on a lone
  // headline about a relative. Collector only)
  return best && (best[1] >= Math.max(2, 0.3 * famTitles.length) || best[1] === famTitles.length) ? best[0] : null;
}

const DEATH_NOUN = /^(?:death|funeral|passing|obituary)$/i;
const OF_PHRASE_END = /[,;:–—]|\s-\s|\s(?:after|as|at|in|amid|while|when|following|says?|aged?)\s/i;
const OWN_NEAR = 3;
/** A name as a headline gives it, without the words before it that are no part of it ("son Orret Neskurn", "about Orret Neskurn"); two words or more, else null. */
function ownerName(text) {
  const ws = words(text);
  while (ws.length > 2 && (RELATION.has(ws[0]) || (W.inDict(ws[0]) && !W.isFirstName(ws[0])))) ws.shift();
  return ws.length >= 2 && ws.length <= 3 ? ws.join(' ') : null;
}
/**
 * Whose death a name's headlines tell (collector only: a card never says a living person died): { own, others, owner }.
 *   own     headlines that say it of the name itself: "Orrane Neskwyn dies at 86", "death of Orrane Neskwyn", "Tavrel Ostaby, R&B singer,
 *           dies", "Wyney Pymner's wife Quorrel breaks silence after his death"
 *   others  headlines where it is someone else's: the death "of" another ("Thaley Lorriss addresses death of Essade Quillard's son
 *           Orret Neskurn"), another name's own ("... not ready to talk about Orret Neskurn's death"), the name's relative's
 *           ("Thalena Lorrner's daughter Holliniel dead"), or the name is the one acting ("Miret Vorow says final goodbye to beloved wife
 *           ... at funeral": the dead say nothing)
 *   owner   the other name most of those give, { name, n }, or null
 * A headline that says neither counts for neither.
 */
function whoseDeath(subject, family, titles) {
  const out = { own: 0, others: 0, owner: null };
  if (!family || family.key !== 'death') return out;
  const sw = subject.split(' ');
  const mine = (name) => name.split(' ').some((w) => sw.includes(w));
  const owners = new Map();
  const other = (name) => { out.others += 1; if (name && !mine(name)) owners.set(name, (owners.get(name) || 0) + 1); };
  for (const t of titles) {
    const m = saidIn(t, family);
    if (!m || !nameAt(words(t), subject).length) continue;
    const pre = t.slice(0, m.index);
    const post = t.slice(m.index + m[0].length);
    // the death "of" someone: the name's own when the phrase names it, else whoever it names
    const of = DEATH_NOUN.test(m[0]) ? post.match(/^\s+(?:of|for)\s+(.*)$/i) : null;
    if (of) {
      const phrase = of[1].split(OF_PHRASE_END)[0];
      const named = spanAfter(`${phrase} `, subject, phrase.length + 1);
      if (named && !named.possessive) { out.own += 1; continue; }
      // (never the one a possessive names: "death of Essade Quillard's son" is no death of hers)
      const possessive = (n) => { const x = spanAfter(`${phrase} `, n, phrase.length + 1); return !!x && x.possessive; };
      const all = nameRuns(phrase).filter((n) => !mine(n));
      const runs = all.filter((n) => !possessive(n)).map(ownerName).filter((n) => n && !mine(n));
      if (all.length || ownRelation(phrase) || OTHERS_POSSESSIVE.test(`${phrase} `)) { other(runs[runs.length - 1] || null); continue; }
    }
    // another name's own: "... Orret Neskurn's death"
    const owner = pre.match(/((?:\p{Lu}[\p{L}\p{N}.’'-]*\s+){0,2}\p{Lu}[\p{L}\p{N}.-]*)[’']s\s+(?:[\p{Ll}-]+\s+){0,2}$/u);
    if (owner && !mine(words(owner[1]).join(' '))) { other(ownerName(owner[1])); continue; }
    const mid = spanAfter(t, subject, m.index);
    if (!mid) continue;
    const anyRel = words(mid.text).map((w) => RELATION.get(w)).find(Boolean) || null;
    // "X's wife Quorrel breaks silence after his death": a pronoun that is not the relative's is the name's own
    const pronoun = (mid.text.match(/(?<![\p{L}\p{N}])(his|her)\s+(?:[\p{L}-]+\s+)?$/iu) || [])[1];
    if (pronoun && anyRel && ((/^his$/i.test(pronoun) && RELATION_HER.has(anyRel)) || (/^her$/i.test(pronoun) && RELATION_HIS.has(anyRel)))) { out.own += 1; continue; }
    if (APPOSITIVE.test(mid.text)) { out.own += 1; continue; }
    if ((!mid.possessive && LIVING.test(mid.text)) || ownRelation(mid.text)) { other(null); continue; }
    // (a relative who is the one acting, or someone else's: the line does not say whose it is)
    if (anyRel) continue;
    if (words(mid.text).length <= OWN_NEAR) out.own += 1;
  }
  const top = [...owners.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  out.owner = top ? { name: top[0], n: top[1] } : null;
  return out;
}

/**
 * Whether a personal noun is the subject's: in at least 40% of the family's titles naming the subject, the noun word comes within
 * three words after the name ("Wynia Pymick dead", "QUAVNIX reportedly stabbed", "Thalena Lorrner's daughter Holliniel dead"), not later in the line
 * about someone else ("Mirard Vorith says Wynard Pymwyn' viral injury reaction ...").
 */
function personalNear(subject, family, titles) {
  // (a death's or an arrest's coverage runs on to the funeral, the suspension, the tributes; whose it is, relationOf and subjectOf settle)
  if (!family || !PERSONAL.has(family.key) || family.key === 'death' || family.key === 'arrest') return true;
  const famTitles = titles.filter((t) => saysIt(t, family) && nameAt(words(t), subject).length);
  if (!famTitles.length) return true;
  const near = famTitles.filter((t) => {
    const m = saidIn(t, family);
    const pre = words(t.slice(0, m.index));
    const end = nameAt(pre, subject).map((i) => i + subject.split(' ').length).pop();
    return end !== undefined && (pre.length - end <= 3 || APPOSITIVE.test(textBetween(t, subject, m.index) || ''));
  }).length;
  return near >= 0.4 * famTitles.length;
}

// ---------- what was said ----------
// something said that people hit back at is searched by what it was about: "Drubzo women comments", "Nimvane slavery comments"
const SAID_FAMS = new Set(['backlash', 'remarks', 'feud']);
const SAID_RE = /\b(?:comments?|remarks?)\b(?! section)/i;
const SAID_ABOUT = /\b(?:comments?|remarks?)\s+(?:about|on|over|regarding|toward|towards|against)\s+((?:[\p{L}\p{N}’'-]+\s+){0,3}[\p{L}\p{N}’'-]+)/iu;
const SAID_BEFORE = /((?:[‘'“"]?[\p{L}\p{N}’'”"-]+\s+){1,2})(?:comments?|remarks?)\b/iu;
// (words that only describe the comments, or whose they are)
const SAID_STOP = new Set(['controversial', 'recent', 'viral', 'offensive', 'insensitive', 'shocking', 'latest', 'new', 'old', 'past', 'crude', 'harsh', 'public', 'online',
  'social', 'media', 'own', 'such', 'podcast', 'interview', 'stage', 'onstage', 'resurfaced', 'resurfacing', 'disparaging', 'derogatory', 'inflammatory', 'heated', 'nasty',
  'rude', 'bizarre', 'wild', 'outrageous', 'cruel', 'hateful', 'racist', 'sexist', 'transphobic', 'homophobic', 'antisemitic', 'vile', 'gross', 'shady', 'candid', 'blunt',
  'explosive', 'divisive', 'tone-deaf', 'deaf', 'tone', 'no', 'more', 'further', 'previous', 'earlier', 'similar', 'those', 'these', 'that', 'this', 'some', 'any', 'female', 'male',
  'young', 'fellow', 'other', 'many', 'instagram', 'tiktok', 'twitter', 'youtube', 'facebook', 'fan', 'fans', 'making', 'made', 'makes', 'leaves', 'leaving', 'posts', 'posted', 'the']);
const singular = (w) => (w.length > 5 && /[^s]s$/.test(w) && W.inDict(w.slice(0, -1)) ? w.slice(0, -1) : w);
/**
 * What a name's comments were about, as the headlines naming it say: the word right before "comments" ("ICE comments", "'Slavery'
 * comments") or the one after "comments about/on" where its phrase ends ("comments about women in games" -> "women", "comments on
 * female influencers" -> "influencer"), never a word that only describes them or a word of a name; the commonest, said in
 * SAID_TOPIC_MIN headlines (or the only one any headline gives); or null.
 */
function saidTopic(titles, subject, names = []) {
  const last = subject.split(' ').slice(-1)[0];
  const subj = subject.split(' ');
  // (what they were about is a thing or a people, never something done: "comments about refusing to ..." names none)
  const ok = (w) => w.length >= 3 && !W.STOP.has(w) && !SAID_STOP.has(w) && !subj.includes(w) && !ROLE.has(w) && !W.isFirstName(w) && !names.some((n) => n.split(' ').includes(w)) &&
    !familiesIn(w).length && !/^\d+$/.test(w) && !/(?:ing|ly)$/.test(w);
  const n = new Map();
  for (const t of titles) {
    if (!words(t).includes(last) || !SAID_RE.test(t)) continue;
    const about = t.match(SAID_ABOUT);
    const before = t.match(SAID_BEFORE);
    // (the phrase after "about" up to its first joining word: "women in games" is women)
    const phrase = about ? words(about[1]) : [];
    const cut = phrase.findIndex((w) => W.STOP.has(w));
    const head = (cut < 0 ? phrase : phrase.slice(0, cut)).filter(ok);
    const pre = before ? words(before[1]).filter(ok) : [];
    const topic = head.length ? singular(head[head.length - 1]) : pre.length ? singular(pre[pre.length - 1]) : null;
    if (topic) n.set(topic, (n.get(topic) || 0) + 1);
  }
  const best = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // (said in two headlines, or the only thing any headline says they were about)
  return best && (best[1] >= SAID_TOPIC_MIN || n.size === 1) ? best[0] : null;
}
const SAID_TOPIC_MIN = 2;
/**
 * What a post people hit back at was about, as the headlines naming its author quote it: the quoted word right before "post"
 * ("Plonly stirs controversy with 'genocide' post"), in SAID_TOPIC_MIN headlines; or null.
 */
function postTopic(titles, subject) {
  const last = subject.split(' ').slice(-1)[0];
  const n = new Map();
  for (const t of titles) {
    if (!words(t).includes(last)) continue;
    const m = t.match(POST_QUOTED);
    const topic = m ? words(m[1])[0] : null;
    if (topic && topic.length >= 3 && !W.STOP.has(topic) && !SAID_STOP.has(topic)) n.set(topic, (n.get(topic) || 0) + 1);
  }
  const best = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best && best[1] >= SAID_TOPIC_MIN ? best[0] : null;
}
const POST_QUOTED = /[‘'“"]([\p{L}\p{N}-]+)[’'”"]\s+(?:posts?|tweets?|caption)\b/iu;

// ---------- the title ----------
/** A word that is part of a person's name: a given name, a word of a name its titles print, or a name searched on its own ("dovette"). */
const isNameWord = (w, names) => (W.isFirstName(w) && !W.inDict(w)) || names.some((n) => n.split(' ').includes(w));
const PREFIX_OK = (w) => R.PLACES.has(w) || /^\d+$/.test(w);
const BEFORE_SHARE = 0.12;
// an agency that brought a case is no title word ("caelelle demow doj charges" -> "Caelelle Demow charges")
const AGENCY = new Set(['doj', 'fbi', 'sec', 'dhs', 'irs', 'ice', 'nypd', 'lapd', 'police', 'feds', 'federal', 'cps', 'ftc', 'dea', 'atf']);
// what people search to have something explained is no part of its name ("patient zero meaning")
const CONTEXT_STOP = new Set(['meaning', 'meanings', 'lyrics', 'explained', 'explanation', 'review', 'reviews', 'reaction', 'reactions', 'cast', 'trailer', 'ending',
  'netflix', 'hulu', 'hbo', 'reddit', 'twitter', 'tiktok', 'instagram', 'youtube', 'live', 'full', 'video', 'clip', 'interview', 'podcast',
  // (a court's people and steps are the case's, not its name: "Zanard Ulmard mistrial", not "Zanard Ulmard juror mistrial")
  'juror', 'jurors', 'jury', 'judge', 'lawyer', 'lawyers', 'attorney', 'attorneys', 'court', 'hearing', 'testimony', 'supporters', 'debate',
  // (and the people reacting to it: "Rouade Trevick death", never "Rouade Trevick friends death")
  'friend', 'friends', 'fans', 'family']);
// a role is no context ("Rapper Quavnix ..." is not "Quavnix rapper fight")
const ROLE = new Set(['rapper', 'singer', 'actor', 'actress', 'star', 'streamer', 'youtuber', 'tiktoker', 'influencer', 'host', 'model', 'comedian', 'player',
  'coach', 'director', 'producer', 'presenter', 'personality', 'musician', 'artist', 'creator', 'alum', 'contestant', 'judge', 'founder', 'ceo', 'boss', 'legend']);
// words that only qualify the noun ("new haircut", "latest arrest")
const BEFORE_STOP = new Set(['new', 'latest', 'first', 'second', 'final', 'last', 'big', 'huge', 'shock', 'shocking', 'viral', 'recent', 'alleged', 'reported']);

// a game's official: what the card calls them, by the words a headline puts right before the name
const OFFICIAL = new Map([['referee', 'referee'], ['ref', 'referee'], ['umpire', 'umpire'], ['linesman', 'referee'], ['official', 'referee']]);
const OFFICIAL_SHARE = 0.3;
/** The official's job the family's titles give the subject right before the name ("referee Essey Quillick"), in OFFICIAL_SHARE of them; else null. */
function officialOf(subject, famTitles) {
  const subj = subject.split(' ');
  const n = new Map();
  for (const t of famTitles) {
    const ws = words(t);
    const role = nameAt(ws, subject).map((i) => OFFICIAL.get(ws[i - 1] || '')).find(Boolean);
    if (role) n.set(role, (n.get(role) || 0) + 1);
  }
  const best = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best && subj.length >= 2 && best[1] >= Math.max(2, OFFICIAL_SHARE * famTitles.length) ? best[0] : null;
}

/**
 * The card's title, shaped like the search: { ws (lowercase words), how }.
 *   phrase   a related query or fresh completion naming the subject and the noun word, cut after it ("jasade wickenko execution", "jasette
 *            wickwyn free palestine shirt", "bexan tamard allegations r" -> "bexan tamard allegations", "russia plague outbreak")
 *   context  the subject + a word its searches pair it with that most of the family's titles carry ("esselle quillith snl") + the noun
 *   before   the subject + the word the family's titles put right before the noun word, when people search it too ("flydubai pilot attack")
 *   relation the subject + whose it is + the noun, when the titles say a relative's or a pet's ("Thalena Lorrner daughter death")
 *   plain    the subject + the noun
 */
function titleWords(subject, noun, family, phrases, titles, names, searched = new Set()) {
  const subj = subject.split(' ');
  if (!family) return { ws: subj, how: 'plain' };
  const nounWs = words(noun);
  const rel = relationOf(subject, family, titles);
  if (rel) return { ws: [...subj, rel, ...nounWs].slice(0, 5), how: 'relation' };
  for (const p of phrases) {
    const ws = words(p);
    if (QUESTION.test(p)) continue;
    const at = nameAt(ws, subject)[0];
    if (at === undefined) continue;
    const prefix = ws.slice(0, at);
    if (prefix.length > 2 || !prefix.every(PREFIX_OK)) continue;
    // the noun word after the name ("russia plague outbreak": "outbreak", not the "plague" the name already is)
    const rem = ws.slice(at + subj.length).join(' ');
    const m = rem.match(family.re);
    if (!m) continue;
    const famAt = at + subj.length + words(rem.slice(0, m.index)).length;
    const mid = ws.slice(at + subj.length, famAt);
    if (mid.length > 3 || mid.some((w) => FACETS.has(w) || isNameWord(w, names) || W.STOP.has(w) || BEFORE_STOP.has(w) || AGENCY.has(w))) continue;
    const out = [...prefix, ...subj, ...mid, ...nounWs];
    if (out.length <= 5) return { ws: out, how: 'phrase' };
  }
  const famTitles = titles.filter((t) => family.re.test(t));
  const shareOf = (wsx) => famTitles.filter((t) => wsx.every((w) => words(t).includes(w))).length / Math.max(1, famTitles.length);
  // (a subject that already ends with the noun's own word is not said twice: "France protests", not "France protests protests")
  const plain = familiesIn(subject).some((x) => x.f.key === family.key) ? subj : [...subj, ...nounWs];
  for (const p of phrases) {
    const ws = words(p);
    if (QUESTION.test(p) || ws.slice(0, subj.length).join(' ') !== subject) continue;
    const rest = ws.slice(subj.length);
    // (a word that is itself a talking-point word is no context: "quavnix stabbed" over a fight)
    if (!rest.length || rest.length > 2 || rest.some((w) => FACETS.has(w) || W.STOP.has(w) || ROLE.has(w) || CONTEXT_STOP.has(w) || nounWs.includes(w) || isNameWord(w, names) ||
      familiesIn(w).length)) continue;
    // (a team between a name and its noun reads as the team's: "Essey Quillick Vikings suspension" is a referee's, not the Vikings')
    if (rest.some((w) => R.isPlaceOrTeam(w) && !R.PLACES.has(w))) continue;
    if (shareOf(rest) >= 0.3 && plain.length + rest.length <= 5) return { ws: [...subj, ...rest, ...plain.slice(subj.length)], how: 'context' };
  }
  // an official is searched by the job: "Essey Quillick referee suspension" (the family's titles call them so right before the name)
  const official = officialOf(subject, famTitles);
  if (official && plain.length < 5 && plain.length > subj.length) return { ws: [...subj, official, ...nounWs], how: 'role' };
  // a word people search with the name that sits between it and the noun in the family's titles ("FlyDubai co-pilot attacked",
  // "Pellia Sorrenko's Digger flops"), never across a clause ("Saved by the Bell star Jaset Wickith dead" has none between)
  const before = new Map();
  for (const t of famTitles) {
    const m = t.match(family.re);
    const pre = words(t.slice(0, m.index));
    const end = nameAt(pre, subject).map((i) => i + subj.length).pop();
    if (end === undefined || pre.length - end > 3 || pre.length - end < 1) continue;
    const w = pre.slice(end).reverse().find((x) => searched.has(x) && !BEFORE_STOP.has(x) && !W.STOP.has(x) && !FACETS.has(x) && !isNameWord(x, names) &&
      !subj.includes(x) && !PREFIX_OK(x) && !familiesIn(x).length && !ROLE.has(x) && !AGENCY.has(x));
    if (w) before.set(w, (before.get(w) || 0) + 1);
  }
  const bw = [...before.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (bw && bw[1] >= Math.max(2, BEFORE_SHARE * famTitles.length) && plain.length < 5 && plain.length > subj.length) return { ws: [...subj, bw[0], ...nounWs], how: 'before' };
  return { ws: plain.slice(0, Math.max(5, subj.length)), how: 'plain' };
}

const ACRONYM = new Map([['snl', 'SNL'], ['ufc', 'UFC'], ['nfl', 'NFL'], ['nba', 'NBA'], ['nrl', 'NRL'], ['vmas', 'VMAs'], ['vma', 'VMA'], ['mtv', 'MTV'],
  ['bbc', 'BBC'], ['usa', 'USA'], ['uk', 'UK'], ['us', 'US'], ['fnaf', 'FNAF'], ['wwe', 'WWE'], ['aca', 'ACA'], ['fbi', 'FBI'], ['ice', 'ICE'], ['nyc', 'NYC'],
  ['bts', 'BTS'], ['ai', 'AI'], ['tv', 'TV'], ['dms', 'DMs'], ['gta', 'GTA'], ['lsu', 'LSU'], ['mlb', 'MLB'], ['nhl', 'NHL'], ['ceo', 'CEO']]);

/**
 * How each lowercase word is spelled in the name's own titles: the commonest capitalised form when titles written in sentence case
 * capitalise it mid-line more often than not ("ComplexCon", "Wexwy", "Palestine"); names the subject keeps are always capitalised.
 */
function caseMap(titles) {
  const cap = new Map();
  const low = new Map();
  for (const t of titles) {
    const toks = t.split(/\s+/);
    // (a Title Case headline tells no word's case, but for one capitalised inside: "SiriusXM", "GrimVane")
    const titleCase = W.isTitleCase(toks);
    toks.forEach((tok, i) => {
      const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, '');
      if (titleCase ? !/\p{Ll}\p{Lu}/u.test(core) : i === 0 || /[:.!?]$/.test(toks[i - 1] || '')) return;
      const k = words(core).join('');
      if (!k || words(core).length !== 1) return;
      // (a plain word shouted in capitals tells no case: the kicker of "STREAMER ARREST British streamer ..." never titles a card
      // "Grimvik ARREST". An acronym is no dictionary word and still counts: "WNBA". Collector only)
      if (/^\p{Lu}{4,}$/u.test(core) && W.inDict(core.toLowerCase())) return;
      if (/^\p{Lu}/u.test(core)) { const m = cap.get(k) || new Map(); m.set(core, (m.get(core) || 0) + 1); cap.set(k, m); } else low.set(k, (low.get(k) || 0) + 1);
    });
  }
  const out = new Map();
  for (const [k, m] of cap) {
    const n = [...m.values()].reduce((a, b) => a + b, 0);
    if (n > (low.get(k) || 0)) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  }
  return out;
}

/**
 * A name as its titles spell it ("lysette marrner" -> "Lysette Marrner", "bexan tamard" -> "Bexan Tamard"): sentence-case titles first, an
 * initial with its full stop over one without; else a name's words capitalised ("East of Eden"), a plain phrase only at its start.
 */
const CAPS_NAME_MAX = 5;
const CAPS_NAME_MIN = 3;
function nameSurface(name, titles) {
  // (a name spelt with an apostrophe inside is still the name: "Dov'anne" for "dovanne")
  const pat = new RegExp(`(?<![\\p{L}\\p{N}])${name.split(' ').map((w) => w.split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[’\']?')).join('[\\s.-]+')}\\.?(?![\\p{L}\\p{N}])`, 'iu');
  const forms = new Map();
  // (a plain word opening a headline is capitalised by position, not as a name: "Plague outbreak ...")
  const plainName = name.split(' ').every((w) => W.inDict(w) && !W.isFirstName(w));
  const count = (list, w) => {
    for (const t of list) {
      const m = t.match(pat);
      const lead = m && (m.index === 0 || /[:.!?]\s*['"‘“]?$/.test(t.slice(0, m.index)));
      if (m && /\p{Lu}/u.test(m[0]) && m[0] !== m[0].toUpperCase()) forms.set(m[0], (forms.get(m[0]) || 0) + (lead && plainName ? 0.05 : w));
    }
  };
  const proper = name.split(' ').some((w) => !W.inDict(w) && !/^\d+$/.test(w)) || W.isFirstName(name.split(' ')[0]);
  count(titles.filter((t) => !W.isTitleCase(t.split(/\s+/))), 1);
  // (a Title Case headline capitalises every word: it spells a name, never a plain phrase like "Verity movie")
  if (proper) count(titles.filter((t) => W.isTitleCase(t.split(/\s+/))), 0.25);
  const dotted = (f) => (/\b\p{Lu}\.\s/u.test(f) ? 1 : 0);
  const best = [...forms.entries()].map(([f, n]) => [f.replace(/\.$/, (d) => (/\b\p{L}\.$/u.test(f) ? d : '')), n])
    .sort((a, b) => dotted(b[0]) - dotted(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  // (a short one-word name most headlines print in capitals, among words they do not shout, is spelt in capitals: "QUAVM", never
  // the "Quavm" of one headline about something else. Collector only, 2026-10-12)
  if (!name.includes(' ') && name.length <= CAPS_NAME_MAX && !W.inDict(name)) {
    const shouted = titles.filter((t) => { const m = t.match(pat); return !!m && m[0] === m[0].toUpperCase() && /\p{Lu}/u.test(m[0]) && /\p{Ll}{3,}/u.test(t.replace(pat, ' ')); });
    if (shouted.length >= CAPS_NAME_MIN && shouted.length > 2 * (best ? best[1] : 0)) return shouted[0].match(pat)[0].replace(/\.$/, '');
  }
  if (best && best[1] >= 0.5) return best[0];
  if (plainName) return name;
  const ws = name.split(' ');
  const small = new Set(['of', 'the', 'and', 'in', 'on', 'at', 'to', 'for', 'a', 'an']);
  return ws.map((w, i) => ACRONYM.get(w) || ((i === 0 || (proper && !small.has(w))) ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/** Sentence case: the subject as its titles spell it, other words as the titles spell them mid-line, the first letter capitalised. */
function caseTitle(ws, subject, titles, lex) {
  const subjN = subject.split(' ').length;
  const at = nameAt(ws, subject)[0];
  const map = caseMap(titles);
  const one = (w) => {
    if (ACRONYM.has(w)) return ACRONYM.get(w);
    if (map.has(w)) return map.get(w);
    if (R.PLACES.has(w)) return w.charAt(0).toUpperCase() + w.slice(1);
    if (lex && lex.surface && lex.proper && lex.proper.has(w) && !W.inDict(w) && lex.surface.get(w)) return lex.surface.get(w);
    return w;
  };
  const surface = at === undefined ? null : nameSurface(subject, titles);
  const out = at === undefined ? ws.map(one) : [...ws.slice(0, at).map(one), surface, ...ws.slice(at + subjN).map(one)];
  return capLine(out.join(' '), at === 0 ? surface : null);
}
/**
 * A line or a title with its first letter capitalised, unless it opens with a handle its headlines spell with a small first letter and a
 * capital inside ("nimVaneb ban", "zoRvik apology": never "NimVaneb").
 */
function capLine(s, surface) {
  if (surface && /^\p{Ll}/u.test(surface) && /\p{Lu}/u.test(surface) && s.startsWith(surface) && !/^[\p{L}\p{N}]/u.test(s.slice(surface.length))) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- the "what" ----------
const CLEAN_LEAD = /^(?:watch|exclusive|breaking|update|video|new|report|listen|photos?)\s*[:|-]\s*/i;
// a source tag after the line ("'Saved by the Bell' actor Jaset Wickith dies: TMZ")
const SOURCE_TAG = /\s*[:|-]\s*(?:tmz|page six|people|variety|deadline|report|reports|sources?|exclusive|insider|daily mail|the sun|us weekly|e! news)\s*$/i;
const SOUNDBITE_LEAD = /^(?:["“]([^"”]{8,160})["”]|[‘']((?:[^‘’']|[’'](?=\p{L}))+)[’'])[,.]?:\s+(?=["“‘']?\p{Lu})/u;
// (collector only, 2026-10-28: the line pick reads a headline without the soundbite it opens or ends on when the soundbite is someone
// speaking, Title Case or not: "'I Just Don't Listen Very Well': Influencer <name> Banned by Two Airlines ...", "<name> Apologizes After
// ...: 'First and Last Time It Will Ever Happen'". Speech says I, we, you, my or a contraction, or asks or shouts; a work's name, "'East
// of Eden': ...", does none of these and stays)
const SPEECH = /(?:^|[\s‘'“"])(?:i|i['’]m|i['’]ve|i['’]ll|i['’]d|we|we['’]re|you|you['’]re|my|me|our|don['’]t|can['’]t|won['’]t|didn['’]t|isn['’]t|wasn['’]t|it['’]s|that['’]s|he['’]s|she['’]s|they['’]re)(?=[\s,.!?’'”"]|$)|[!?]/i;
const SOUNDBITE_TAIL = /:\s+(?:["“]([^"”]{8,160})["”]|[‘']((?:[^‘’']|[’'](?=\p{L}))+)[’'])[.!?]?\s*$/u;
const BITE_WORDS = 3;
const BITE_REST_WORDS = 8;
/** A headline without a soundbite of someone speaking at its start or end (`SPEECH`), when what is left still tells the story. */
function withoutSpeech(line) {
  let s = String(line || '');
  const lead = s.match(SOUNDBITE_LEAD);
  const said = lead ? lead[1] || lead[2] || '' : '';
  if (lead && said.split(/\s+/).length >= BITE_WORDS && SPEECH.test(said)) s = s.slice(lead[0].length);
  const tail = s.match(SOUNDBITE_TAIL);
  if (tail && s.slice(0, tail.index).split(/\s+/).length >= BITE_REST_WORDS) s = s.slice(0, tail.index);
  return s;
}
// ---------- it says what happened (IDEAS-FEED G3 rule 10; collector only) ----------
// what only says there was a reaction: "stirs controversy", "sparks backlash", "faces criticism", "under fire", "goes viral", "breaks
// silence", "responds", "reacts", "speaks out"
const REACTION_SAID = /(?<![\p{L}\p{N}])(?:(?:stirs?|stirred|stirring|spark(?:s|ed|ing)?|ignit(?:es|ed|ing)|draws?|drew|drawing|fac(?:es|ed|ing)|prompt(?:s|ed|ing)?|trigger(?:s|ed|ing)?|caus(?:es|ed|ing)|under|amid)\s+(?:[\p{L}-]+\s+){0,2}?(?:controvers\w+|backlash|criticism|outrage|fire|debate|uproar|fury|scrutiny)|go(?:es|ing)?\s+viral|went\s+viral|viral|breaks?\s+(?:(?:his|her|their)\s+)?silence|broke\s+(?:(?:his|her|their)\s+)?silence|responds?|responded|responding|reacts?|reacted|reacting|speaks?\s+out|spoke\s+out|claps?\s+back|fires?\s+back|hits?\s+back|controvers\w+|backlash|full\s+story|explained|what\s+we\s+know)(?![\p{L}\p{N}])/giu;
// (a headline is terse: three content words say over what, "... faces backlash over alleged Palestine stance"; a written line needs four)
const SAYS_WHAT_WORDS = 3;
const SAYS_WHAT_STOP = new Set(['video', 'videos', 'clip', 'clips', 'post', 'posts', 'online', 'internet', 'fans', 'massive', 'huge', 'major', 'new', 'latest', 'recent', 'social', 'media', 'amid', 'after',
  'over', 'following', 'star', 'says', 'said']);
/**
 * Whether a line only says there was a reaction: it has a reaction's words ("stirs controversy", "responds", "goes viral") and,
 * without them, the subject's name and what describes anyone, fewer than three content words to say over what. "Plonly stirs
 * controversy with 'genocide' post" says a post existed; "Hollinan Yarrwyn says she's never read a book, sparking fierce online backlash"
 * says what was said. `min`: the content words that say over what (three for a terse headline, four for a written line).
 */
function onlyReaction(line, subject, min = SAYS_WHAT_WORDS) {
  const text = String(line || '');
  if (!text.match(REACTION_SAID)) return false;
  const name = new Set(String(subject || '').split(' '));
  // (a negation is content: "says she's never read a book")
  const rest = words(text.replace(REACTION_SAID, ' ')).filter((w) => SAYS_WHAT_NOT.has(w) || (w.length > 2 && !name.has(w) && !W.STOP.has(w) && !ROLE.has(w) && !SAYS_WHAT_STOP.has(w) && !/^\d+$/.test(w)));
  return new Set(rest).size < min;
}
const SAYS_WHAT_NOT = new Set(['never', 'not', 'no', 'without', 'denies', 'refuses']);
const REACTION_ONLY_PENALTY = 1.5;

// (collector only, the speed of a build and never its result: each distinct headline, under each publisher, is cleaned once a process;
// every story, every audience and every line reads the same few thousand headlines many times over. A string in, a string out)
const CLEANED = new Map();
const CLEANED_MAX = 200000;
let cleanedSize = 0;
/** A headline as a line: no publisher suffix, no section bar, no "WATCH:" lead, no "(VIDEO)" tail, no ": TMZ" source tag. */
function cleanHeadline(title, publisher) {
  if (publisher && typeof publisher !== 'string') return cleanHeadlineOf(title, publisher);
  const text = String(title || '');
  const under = publisher || '';
  let byTitle = CLEANED.get(under);
  const hit = byTitle && byTitle.get(text);
  if (hit !== undefined) return hit;
  const out = cleanHeadlineOf(text, publisher);
  if (cleanedSize >= CLEANED_MAX) { CLEANED.clear(); cleanedSize = 0; byTitle = null; }
  if (!byTitle) { byTitle = new Map(); CLEANED.set(under, byTitle); }
  byTitle.set(text, out);
  cleanedSize++;
  return out;
}
function cleanHeadlineOf(title, publisher) {
  let s = String(title || '');
  if (publisher && s.endsWith(` - ${publisher}`)) s = s.slice(0, -(publisher.length + 3));
  s = s.replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, (m) => (/\b(?:news|com|online|magazine|daily|times|post|tv|radio|weekly|media|herald|journal|report)\b/i.test(m) ? '' : m));
  // (nor are an outlet's pictures: "🏳️‍🌈🕯️ Queer Punjabi makeup artist ..." is the sentence after them. Collector only)
  s = s.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]+(?:[_\s]*[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}]+)*/gu, ' ').replace(/\s+/g, ' ').trim();
  // (nor a site's own tag after its mark: "... in leaked court documents ᐉ News from Fakti.bg - Curious". Collector only)
  s = s.replace(/\s*[ᐉ►▶»›⟶➤➜]\s.*$/u, '').trim();
  // (a shouted tail is no part of the line: "... at gunpoint in LA -- OMG!". Collector only)
  s = s.replace(/\s+(?:--|–|—)\s+(?:\p{Lu}{2,}[!?]*\s*){1,3}$/u, '');
  s = s.replace(/\s+\|\s+[^|]+$/, '').replace(CLEAN_LEAD, '').replace(/\s*\((?:video|photos?|watch|exclusive|updated?)\)\s*$/i, '').replace(SOURCE_TAG, '');
  // (an outlet's section after the line, "... - National", and a clip's file ending, "... method acting.mp4")
  s = s.replace(/\s+[-–—]\s+(?:national|world|entertainment|canada|u\.?s\.?|uk|video|opinion)$/i, '').replace(/\.(?:mp4|mov|webm)$/i, '');
  // (a soundbite before the headline tells a feeling, the headline after it the story: '"I don't think anybody should ...": Drubzo says ...';
  // never a work's name, "'East of Eden': ...": three words or more, one of them a lowercase word of four letters)
  const bite = s.match(SOUNDBITE_LEAD);
  const said = bite ? bite[1] || bite[2] || '' : '';
  if (said.split(/\s+/).length >= 3 && /(?:^|\s)\p{Ll}{4,}/u.test(said)) s = s.slice(bite[0].length);
  // a show's or column's name before the line ("The 51% - The Cornell 7: ...")
  s = s.replace(/^[^-–—|:]{2,24}\s[-–—|]\s(?=\S)/, (m) => (m.split(/\s+/).length <= 4 ? '' : m));
  return s.replace(/\s+/g, ' ').trim();
}

// wire services and national outlets whose line is the plainest account
const MAJOR = /^(?:the )?(?:associated press|ap news|ap|reuters|cnn|nbc news|cbs news|abc news|the new york times|new york times|washington post|usa today|bbc|bbc news|npr|the guardian|people(?:\.com)?|variety(?:\.com)?|the hollywood reporter|rolling stone|billboard|tmz|entertainment weekly|deadline|nbc|today(?:\.com)?|los angeles times|time)$/i;
const DAY_MS = 86400000;
// a column about the story, not the story
const OPINION = /\b(?:opinion|op-ed|editorial|column|moral stain|we must|we need|should be|must be|is a disgrace|shameful|my (?:fabulous|friend|friendship|take)|i (?:was|am|think|watched))\b|^(?:my|i)\b/i;
// an explainer, an interview or a pun about the story, not the story ("What 'Timshel' means ...", "The creators discuss ...", "too
// pregnant for Hot Ones", "director reveals why the movie didn't get its ending")
const NOT_THE_NEWS = /\b(?:means|meaning|creators? discuss\w*|discuss(?:es)? (?:the|that|his|her)|director (?:reveals|explains|says) why|explains? why|breaks? down|interviews?|recap|review|ranked|every (?:easter egg|detail)|too \w+ for|here['’]s (?:how|what|why)|what we know|(?:boss|showrunner|creator|director|star|team) (?:\S+ ){0,3}(?:on|breaks down|answers|explains) (?:that|the|her|his|their|burning))\b/i;
// the outlet's own tone, not the reported account
// (and a review's verdict: "A career-best Pellade Sorrova anchors Netflix's astounding East of Eden adaptation")
const LOADED = /\b(?:maga darling|after lying|lying for|disgusting|shocking(?:ly)?|you won['’]t believe|jaw-dropping|unhinged|meltdown over|epic|savage|brutal(?:ly)?|sick|career-best|astounding|stunning|magnificent|masterful|masterpiece|tour de force|knock you over|triumph(?:ant)?|brilliant(?:ly)?)\b/i;
const SCARE_QUOTE = /[‘'“"]\p{Lu}\p{Ll}+(?:s|ed)[’'”"](?!\s*(?:movie|film|series|show|star|album|song))/u;
// a list about the story ("Nine things Netflix's Quavrrb movie gets wrong", "6 details ...")
const LISTICLE = /(?:^|:\s+)(?:\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:\w+\s+)?(?:things|ways|details|facts|times|reasons|moments|questions|takeaways|biggest|best|worst|movies|films|shows|documentaries|songs)\b/i;
// a filler adjective before the role noun that opens a line ("Popular streamer Bexan Tamard")
const FILLER_LEAD = /^(?:popular|famous|beloved|iconic|legendary|viral|controversial)\s+(?=\p{Ll})/iu;
// what a claim is: a line naming it says what happened
const CLAIM_WORDS = /\b(?:groom\w*|abuse\w*|battery|assault\w*|domestic violence|rape\w*|harass\w*|fraud|murder\w*|strangl\w*|stalk\w*|threat\w*|misconduct|pedophil\w*|predator\w*|paid (?:her|him|them)|abortion)\b/i;
// the newest outcome is the news: "found guilty", "sentenced" over the trial; a split over the engagement
const AGE = /(?:\bat the age of|\baged?|\bdead at|\bdies at|\bdied at|,)\s+(\d{1,3})\b(?!\s*(?:%|percent|years? (?:ago|later|after|before)|million|days?|hours?))/gi;

/**
 * A "<name> case:" heading turned into the line it heads: "Cornell 7 case: NY Attorney General assigned as special prosecutor" ->
 * "NY Attorney General assigned as special prosecutor in the Cornell 7 case" (only a case, a trial, a saga or a scandal of the subject).
 */
const CASE_HEADING = /^['‘"“]?((?:the\s+)?[^:'’"”]{2,40}?)['’"”]?\s+(case|trial|saga|scandal):\s+(\p{Lu}.{20,})$/u;
// (a claim's bare heading is its case too: "The Cornell 7: Allegations spark fury ..." -> "... in the Cornell 7 case")
const NAME_HEADING = /^['‘"“]?((?:the\s+)?[^:'’"”]{2,40}?)['’"”]?:\s+(\p{Lu}.{20,})$/u;
const CASE_FAMILIES = new Set(['allegations', 'lawsuit', 'arrest', 'mistrial', 'verdict', 'sentencing']);
function caseHeading(line, subject, family = null) {
  const m = line.match(CASE_HEADING);
  const bare = !m && family && CASE_FAMILIES.has(family.key) ? line.match(NAME_HEADING) : null;
  const [heading, kind, rest] = m ? [m[1], m[2], m[3]] : bare ? [bare[1], 'case', bare[2]] : [null, null, null];
  if (!heading || words(heading).filter((w) => w !== 'the').join(' ') !== subject || contains(words(rest).join(' '), subject.split(' ').slice(-1)[0])) return line;
  return `${rest.replace(/[.!]+$/, '')} in the ${heading.replace(/^the\s+/i, '')} ${kind}`;
}

/** He, she or they for the subject, when the titles naming it say so clearly; else null. */
function pronounOf(rows, subject) {
  const last = subject.split(' ').slice(-1)[0];
  let he = 0;
  let she = 0;
  for (const r of rows) {
    const ws = words(r.title);
    if (!ws.includes(last)) continue;
    he += ws.filter((w) => w === 'he' || w === 'his' || w === 'him' || w === 'himself').length;
    she += ws.filter((w) => w === 'she' || w === 'her' || w === 'hers' || w === 'herself').length;
  }
  if (he >= 3 && he >= 2 * she) return 'he';
  if (she >= 3 && she >= 2 * he) return 'she';
  return null;
}

/**
 * The denial as a short reported clause, from a line where the subject is the one denying ("Bexan Tamard pushes back on Dovette's
 * allegations and says a lawsuit is coming" -> "he denies it and says he is suing"); null when the line has no denial by the subject.
 * pron: "he" or "she" when the titles say so clearly, else the clause names the subject.
 */
function denialClause(line, subject, pron, name, near = DENIAL_NEAR, { kin = false } = {}) {
  const m = line.match(DENIAL);
  if (!m) return null;
  // (the subject named just before the denial: "Wexwy denies claims" under Bexan Tamard is someone else's)
  const pre = words(line.slice(0, m.index));
  const last = subject.split(' ').slice(-1)[0];
  const at = pre.lastIndexOf(last);
  if (at < 0 || pre.length - at > near) return null;
  // (and the subject itself, not someone of theirs: "<Name>'s half-brother fires back at dad's denial" is the brother's, and "dad <Other
  // given> <Name> denies" a relative's who shares the surname. 2026-10-28: a line put the father's denial in his daughter's mouth.
  // kin: a denial by the subject's own family still counts as the claim's denial on record, for the line rules that ask whether a line
  // keeps the denial its sources carry (lib/line-rules.js rule 9) and never to word one in the subject's name)
  if (!kin && relativeLed(line.slice(0, m.index), subject)) return null;
  // (and the subject is the one denying: nobody else named, no new clause between the name and the denial, "Bexan Tamard allegations:
  // Twitch denies it ignored reports"; unless the subject is quoted saying it, "Bexan Tamard says Plonlo is lying")
  const between = textBetween(line, last, m.index) || '';
  const quoted = /^\s+(?:says|said|insists|insisted|claims|claimed|maintains)\b/i.test(between);
  if (/[,:;]/.test(between) || (!quoted && between.split(/\s+/).some((t) => /^[^\p{L}\p{N}]*\p{Lu}/u.test(t)))) return null;
  // (a denial taken back is none, "no longer denies", nor a line that says the subject owned up)
  if (DENIAL_NOT.test(line.slice(0, m.index)) || OWNED_UP.test(line)) return null;
  // (innocent only in the subject's own words: "Bexan Tamard is innocent, says Bexey Tamow" is someone else's view)
  if (/^innocent$/i.test(m[0]) && !/\b(?:says|said|insists|insisted|maintains|claims|claimed|declares|pleads)\b/i.test(between)) return null;
  // (a threat to sue with no denial in the line is told as that alone: "Zordot plans legal action after officer tased, arrested
  // him" denies nothing)
  if (/\b(?:su(?:e|es|ing)|lawsuit|legal action)\b/i.test(line)) {
    if (!STRICT_DENIAL.test(line)) return pron ? `${pron} says ${pron} is taking legal action` : `${name} threatens legal action`;
    return pron ? `${pron} denies it and says ${pron} is suing` : `${name} denies it and threatens to sue`;
  }
  if (/\binnocent\b/i.test(line) && pron) return `${pron} says ${pron} is innocent`;
  return `${pron || name} denies it`;
}

const DENIAL_NEAR = 6;
/**
 * Whether the subject's surname nearest before a denial is someone else's: a possessive ("<Name>'s <noun> ...", the denial its noun's),
 * or after another given name ("<Other> <Surname>", a relative who shares it). The subject's own given name before it is the subject.
 */
function relativeLed(pre, subject) {
  const sw = subject.split(' ');
  const last = sw[sw.length - 1];
  const toks = String(pre || '').split(/\s+/).filter(Boolean);
  const bareOf = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}’']+$/gu, '');
  for (let i = toks.length - 1; i >= 0; i--) {
    const b = bareOf(toks[i]);
    const k = b.replace(/[’']s$/i, '').replace(/s[’']$/i, 's').toLowerCase();
    if (k !== last) continue;
    if (/[’']s$/i.test(b) || /s[’']$/i.test(b)) return true;
    const prev = i > 0 ? bareOf(toks[i - 1]) : '';
    return sw.length > 1 && /^\p{Lu}\p{Ll}/u.test(prev) && !sw.includes(prev.toLowerCase()) && !W.inDict(prev.toLowerCase()) && !/[,:;]$/.test(toks[i - 1]);
  }
  return false;
}
const DENIAL_NOT = /\b(?:no longer|not|never|doesn['’]t|didn['’]t|won['’]t|refuses to|declines to|stops short of)\s+(?:[\p{L}-]+\s+){0,2}$/iu;
const CLAIM_NAMED = 1.5;
/** Capitalised single words mid-line that no dictionary spells and that are not the subject's ("Dovette", "Wexwy"): who else is in the line. */
function otherNames(toks, subjectWords) {
  return toks.slice(1).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/[’']s$/, ''))
    .filter((c) => /^\p{Lu}[\p{L}]+$/u.test(c) && c.length >= 3 && !W.inDict(c.toLowerCase()) && !subjectWords.includes(c.toLowerCase()) && !ACRONYM.has(c.toLowerCase()) &&
      !R.PLACES.has(c.toLowerCase()))
    .map((c) => c.toLowerCase());
}
const CONTEXT_BONUS = 2;
const COUNT_LEAD_PENALTY = 1.5;
const DENIAL_NEAR_OWN = 10;
const HEADING_COLON = 3; // "The Cornell 7: Allegations spark ...", "'East of Eden': ... explain ..."
const LONG_LINE = 16;
const STRONGER_BONUS = 1.5;
const SHOW_FACETS = new Set(['ending', 'trailer']);
const NEWEST_BONUS = 0.5;
const QA_HEADING = /^(?:\S+\s+){0,4}?(?:star|boss|showrunner|creator|director|actor|actress|host|writer)\s+(?:\p{Lu}[\p{L}.’'-]*\s+){1,3}on\s/u;
const FACT_CHECK = /\b(?:skipped|gets? (?:wrong|right)|got (?:wrong|right)|how accurate|fact[- ]check\w*|the real (?!world)\w+|vs\.? (?:the )?(?:book|reality|real))\b/i;
const SHOW_FALLBACK_MIN = 1;
const BLOG = /livejournal|blogspot|substack|tumblr|wordpress|medium\.com|quora|\breddit\b/i;
const SATIRE = /^(?:the )?(?:onion|babylon bee|clickhole|daily mash|newsthump|reductress|beaverton|waterford whispers(?: news)?|hard times|hard drive|borowitz report)$/i;
const TEASER = /^(?:that|this|these|the) (?:wild|shocking|crazy|insane|bizarre|wildest|jaw-dropping|unbelievable)\b/i;
// a teaser of one detail, not the story ("The sick, online posts that pushed 'Cornell 7' rape accuser to go to cops"), and a guess at what
// comes next ("Lanterns finale raises questions for Man of Tomorrow", "could set up", "leaves fans eager")
const TEASER_DETAIL = /^the (?:[\w’'-]+,?\s+){0,3}(?:posts?|moments?|reasons?|details?|clips?|messages?|photos?|texts?|words?) that\b|\b(?:raises|major|burning|big) questions\b|\bquestions remain\b|^inside (?:the|his|her|their)\b|\bcould set up\b|\bleaves fans\b|\btakes? (?:us|you) inside\b|\bshowrunners? (?:unpack|explain|break down|answer)|\bgo(?:es)? deep on\b|,\s+growing up\b/i;
const CLAIM_NAMED_FULL = 1;
const UNREPORTED_PENALTY = 4;
// a teaser that withholds what happened ("admits he was nervous about one particular aspect of Celebrity Traitors", "producer shares
// if Lysette Marrner really slipped up"), or who it was ("claims in new book that this A-list actress once bit him")
const VAGUE = /\b(?:one|a|this) (?:particular|specific|certain) (?:aspect|thing|detail|moment|part|reason)\b|\b(?:shares|reveals|reveal|says|answers) (?:if|whether)\b|\bsomething (?:surprising|shocking|unexpected)\b|\bthis (?:[\w-]+ ){0,2}(?:actress|actor|star|co-?star|singer|rapper|celebrity)\b/i;
const VAGUE_PENALTY = 3;
const AHEAD = /\b(?:ahead of|on the eve of|days? before|hours? before|set to be|scheduled (?:to|for)|slated (?:to|for)|awaits?|awaiting|prepares? (?:to|for)|to be executed)\b/i;
const AHEAD_DAYS = 1.5;
const AHEAD_PENALTY = 2.5;
const EXPLAINS_ONLY = /\b(?:explains?|clarif(?:y|ies|ied)|addresses|sets? the record straight|speaks? out (?:on|about|after)|responds? to)\b/i;
const HAPPENED = /\b(?:after|for)\s+(?:\S+\s+)?(?:telling|saying|calling|asking|claiming|posting|sharing|accusing|refusing|kicking|hitting|throwing|leaving|walking|making|wearing|mocking|yelling|confronting)\b/i;
const HAPPENED_BONUS = 1;
const EXPLAINS_PENALTY = 1.5;
const OFFICIAL_ACT = /\b(?:judge|court|jury|magistrate|tribunal)\s+(?:rules?|ruled|orders?|ordered|finds?|found|declares?|declared|throws? out|tosses|dismiss(?:es|ed))\b/i;
const ACT_MIN_ROWS = 4;
const ACT_OUTLETS = 2;
const ACT_PENALTY = 2.5;
const MISPLACED_HEDGE = /\b(?:allegedly|reportedly|supposedly|apparently)\s+(?:speaks?|spoke|responds?|responded|reacts?|reacted|breaks?|broke|addresses|addressed|comments?|commented)\b/i;
const MISPLACED_HEDGE_PENALTY = 3;
const UNNAMED_ACTOR = /\b(?:by|from)\s+(?:an?\s+|the\s+)?(?:[\p{L}-]+\s+){0,2}(?:filmmaker|director|actor|actress|star|singer|rapper|comedian|co-star|costar|legend|icon|insider|source|producer|host)s?(?=$|[.,;:!?]|\s+\p{Ll})/u;
const UNNAMED_PENALTY = 2;
// (Title Case keeps short prepositions lowercase: "Brinia Hassent Admits 40-Year Affair with Hollinelle Yarrsy")
const TITLE_SMALL = new Set(['with', 'from', 'into', 'over', 'after', 'about', 'than', 'that', 'this', 'upon', 'onto', 'amid', 'near', 'like']);
function titleCased(s) {
  const ws = s.split(/\s+/);
  if (W.isTitleCase(ws)) return true;
  const long = ws.filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 4 && !TITLE_SMALL.has(w.toLowerCase()));
  return long.length >= 3 && long.filter((w) => /^[^\p{L}\p{N}]*\p{Lu}/u.test(w)).length / long.length >= 0.8;
}
const LONG_QUOTE = /(?:^|[\s:(])['‘“"][^'‘’“”"]{25,}['’”"]/;
const LONG_QUOTE_PENALTY = 2.5;
// a line whose subject is the talk itself, naming nobody ("Allegations spark fury over ...", "Backlash grows after ..."): it never says
// who did or is accused of what
const ABSTRACT_SUBJECT = /^(?:the\s+)?(?:new\s+|fresh\s+)?(?:allegations?|claims?|accusations?|reactions?|backlash|outrage|fury|anger|controversy|rumou?rs?|questions?|concerns?)\s+(?:\w+\s+)?(?:spark|sparks|sparked|grow|grows|mount|mounts|swirl|swirls|emerge|emerges|surface|surfaces|erupt|erupts|rock|rocks|stir|stirs|raise|raises|continue|continues)\b/i;
const ABSTRACT_PENALTY = 2;
// a claim told with who is accused of what, in so many words ("... one of the 'Cornell 7' frat bros accused of drugging and ...")
const ACCUSED_OF = /\baccused of\s+(?:\w+\s+){0,3}?\w+ing\b|\bcharged with\b/i;
const ACCUSED_OF_BONUS = 1.5;
// a recall's line says what for ("... over undeclared food dyes"), for everyone, not one state's shelves ("sold in Texas")
const RECALL_CAUSE = /\b(?:over|due to|because of|for)\s+(?:(?:possible|potential|undeclared|suspected)\s+)?(?:[\p{L}-]+\s+){0,2}?(?:dyes?|colou?rings?|allergens?|contamination|salmonella|listeria|e\.? ?coli|bacteria|mold|metal|plastic|glass|mislabel\w*|labell?ing|choking|fire|burns?|injur\w*|defects?)\b/iu;
const RECALL_LOCAL = /\bsold in\s+\p{Lu}/u;
const RECALL_CAUSE_BONUS = 1;
// a finale's line never says who did it ("... explain why Kerry killed Hal Jordan" -> "... explain who killed Hal Jordan")
const SPOILER = /\b(?:why|how|that)\s+(?:\p{Lu}[\p{L}'’.-]*\s+){1,2}(killed|murdered|shot|poisoned|betrayed)\s+/u;
// a reviews card is told by a line about the reviews as a whole ("Rotten Tomatoes reviews praise ...", "critics are split on ..."),
// never by one critic's verdict
const REVIEWS_WHOLE = /\b(?:reviews|critics)\b/i;
const REVIEWS_WHOLE_BONUS = 3;
const REVIEW_CAPS = /(?<=\s)(?:Reviews?|Critics|Miniseries|Docuseries)(?![\p{L}\p{N}’'”"])/gu;
const REACTION_PENALTY = 2.5;
const DANGLING = /\bafter \w+ing (?:to|into|at|on) (?:his|her|their) /i;
/** Whether a capitalised name other than the subject's comes after its last mention in the line ("... involving Wexwy"). */
function otherAfter(line, last) {
  const ws = line.split(/\s+/);
  const i = ws.map((w) => words(w)[0]).lastIndexOf(last);
  return ws.slice(i + 1).some((w) => /^\p{Lu}\p{L}+/u.test(w.replace(/^[^\p{L}]+/u, '')) && !W.inDict(words(w)[0] || ''));
}

/**
 * Whether a line names the subject's surname only after another capitalised given name and never says the subject's own ("Son of
 * ex-president Korane Ulmith ..." for Zanade Ulmith): a relative's or a namesake's line.
 */
function otherGiven(line, subject) {
  const sw = subject.split(' ');
  const given = (w) => W.isFirstName(w) || !W.inDict(w);
  if (sw.length !== 2 || !given(sw[0])) return false;
  const toks = line.split(/\s+/).map((t) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/[’']s$/, ''));
  const ks = toks.map((t) => t.toLowerCase());
  if (ks.includes(sw[0])) return false;
  return ks.some((k, i) => k === sw[1] && i > 0 && /^\p{Lu}\p{Ll}+$/u.test(toks[i - 1]) && given(ks[i - 1]) && !ROLE.has(ks[i - 1]) && !R.PLACES.has(ks[i - 1]));
}

/** The words just after the subject's last name ("Zaniel Ulmiss, singer ..., dies at 65" -> its next ten words), or "" without it. */
function afterName(line, last) {
  const ws = line.split(/\s+/);
  const i = ws.findIndex((w) => words(w)[0] === last);
  return i < 0 ? '' : ws.slice(i + 1, i + 11).join(' ');
}

/** Ages the family's titles give the subject ("dead at 63", "dies at 65"): Map(age -> titles saying it). */
function agesIn(lines) {
  const out = new Map();
  for (const l of lines) {
    const seen = new Set();
    for (const m of l.matchAll(AGE)) { const n = Number(m[1]); if (n >= 10 && n <= 110 && !seen.has(n)) { seen.add(n); out.set(n, (out.get(n) || 0) + 1); } }
  }
  return out;
}
const AGE_MAJORITY = 0.75;
const WHO_FAMILIES = new Set(['death', 'sentencing', 'verdict']);
const WHAT_FOR_BONUS = 0.75;

/**
 * The card's one reported line: the best headline that names the subject and the noun, the noun close to the name (a sentence-case
 * line from a named outlet, from the peak day, 7-20 words; a claim about a person only in reported wording, best when it names who
 * makes it and what it is; not a follow-up about something else, an explainer, an interview or the outlet's tone), plus the denial as
 * a short reported clause when the subject denies it. rows: [{ title, outlet, t, blocked, youtube }] (blocked outlets and YouTube
 * uploads count, but never word the line). Ages the sources disagree on are left out.
 */
// what a card's line never is: a call to look, a "here's", a review's verdict, a promo's hype ("See her look", "the wildest movie in
// years", "officially kicks off a whole new era")
const NOT_A_LINE = /\b(?:and more )?promotes?\b[^.]*\b(?:series|film|movie|show|album)\b|\bon the red carpet\b|\bwatch live\b|\bhow (?:you can |to )watch\b|\bfor free\b|\bwhere to (?:watch|stream)\b|\bsee (?:her|his|their|the) (?:look|outfit|photos?|pics?)\b|^here['’]s\b|\bhere['’]s (?:the|a|an|every|all)\b|\blive (?:updates?|blog)\b|\bexplained\b|\bwasn['’]t right\b|\bmakes it worse\b|\bwildest\b|\bthe ultimate\b|\bofficially kicks off\b|\bwhole new era\b|\bmust[- ](?:see|watch)\b|\byou need to\b|\bisn['’]t the same as\b/i;
const REACTION = /\b(?:backs|slams|reacts?|reacted|weighs in|speaks out|defends|calls out|praises|blasts|mocks|responds|criticiz(?:es|ed))\b/i;
// (a relative's or namesake's line: the subject's surname after another given name, the subject's own given name nowhere: "Son of
// ex-president Korane Ulmith takes election lead" under Zanade Ulmith)
const OTHER_GIVEN_PENALTY = 2;
const LEAD_WORDS_BONUS = 0.5; // the subject in the line's first four words: who, then what
// (a line led by someone of the subject's, not the subject: "Velard Gravley's daughter confronts ...", "Zanix Ulmner's lawyer speaks
// out"; never the relative the card's own title names: "Thalena Lorrner daughter death")
const PROXY = new Set(['daughter', 'son', 'wife', 'husband', 'mother', 'mom', 'father', 'dad', 'sister', 'brother', 'family', 'lawyer', 'lawyers',
  'attorney', 'attorneys', 'rep', 'representative', 'spokesperson', 'team', 'camp', 'fans', 'ex', 'partner', 'girlfriend', 'boyfriend', 'fiance',
  'fiancee', 'friend', 'friends', 'kids', 'children', 'parents', 'mum']);
const PROXY_PENALTY = 1.5;
/** Whether the subject's first mention in a line is a possessive before someone of theirs the title does not name. */
function proxyLed(line, last, context) {
  const toks = line.split(/\s+/);
  const i = toks.findIndex((t) => words(t)[0] === last);
  if (i < 0 || !/[’']s$/.test(toks[i].replace(/[^\p{L}’']+$/u, ''))) return false;
  const next = words(toks[i + 1] || '')[0] || '';
  return PROXY.has(next) && !context.includes(next);
}
// a wrongdoing claim (never a rumour about who someone is)
const WRONGDOING = /\b(?:grop\w*|groom\w*|abuse\w*|assault\w*|battery|rape\w*|harass\w*|cheat\w*|fraud|stole|theft)\b/i;
const OTHERS_NOUN_PENALTY = 6;
const NAMED_ASIDE = (name) => new RegExp(`\\b(?:amid|after|following|over)\\s+(?:the\\s+)?(?:\\S+\\s+){0,3}?${name.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+')}(?:['’]s)?\\s+(?:\\S+\\s+){0,2}?(?:controvers\\w*|uproar|backlash|drama|saga|row|scandal|feud|furore|fallout)\\b`, 'iu');

function whatOf(rows, subject, family, peakT, lex, context = [], { rumor = false, debug = null, stronger = null, now = 0 } = {}) {
  const last = subject.split(' ').slice(-1)[0];
  const peakDay = Math.floor(peakT / DAY_MS) * DAY_MS;
  // (a name of several words is named whole, a person by their surname at least: "Bexan Tamard", "Wickenko")
  const person = personLike(subject, null) || subject.split(' ').length === 2;
  // (a satire site's headline is a joke about the story, never its account: The Onion's "Feniel Zellova Slams 'Primetime' For ...")
  const usable = rows.filter((r) => !r.blocked && !r.youtube && r.fam !== 'reddit' && !SATIRE.test(r.outlet || '') && contains(words(r.title).join(' '), person ? last : subject));
  const claim = family && (CLAIMS.has(family.key) || family.key === 'arrest' || family.key === 'lawsuit');
  const reviews = !!family && family.key === 'reviews';
  // (what most outlets say, each counted once: the role they call the person, the other name they print, a hedge they keep)
  const majority = TL.majorityChecks(usable.map((r) => ({ line: cleanHeadline(r.title, r.outlet), outlet: r.outlet })), { nameRuns, subject, family });
  // (each line as a plain account: no tabloid tail or soundbite, a bare first name given its surname and role)
  const names = TL.nameIndex(rows.map((r) => r.title), subject, { nameRuns, ROLE, nameSurface });
  const newestT = Math.max(0, ...usable.map((r) => r.t));
  const acts = new Set(usable.filter((r) => OFFICIAL_ACT.test(r.title)).map((r) => String(r.outlet || '').toLowerCase()));
  const scored = usable.map((r) => {
    const head = caseHeading(withoutSpeech(cleanHeadline(r.title, r.outlet)), subject, family);
    const bare = TL.plainLine(head, null, subject, null);
    const line = TL.fullNames(bare, names, subject, { nameRuns, ROLE, nameSurface });
    // (its length as the outlet wrote it: a surname given to a bare first name is no padding; its case as the outlet wrote it)
    const ws = bare.split(/\s+/);
    const titleCase = titleCased(head);
    const lw = words(line);
    let s = 0;
    const fams = familiesIn(line);
    const own = fams.find((x) => family && x.f.key === family.key);
    // (the noun said of someone else is no account of the name's story, however near the name stands: "Senate candidate Tobin Hale
    // faces backlash over Mara Voss ties" tells Tobin Hale's backlash. Collector only, 2026-10-19)
    const theirs = !!own && othersNoun(line, own, subject);
    if (own && !theirs) {
      s += 3;
      if (nameAt(lw, last).some((i) => Math.abs(own.at - i) <= 5)) s += 1;
    }
    if (theirs) s -= OTHERS_NOUN_PENALTY;
    // a follow-up about something else ("... sister accuses ..." under a death) says less; a claim's two sides (the lawsuit, the
    // response) are the same story
    // (and a backlash over the noun is the noun's own story: "Wexdot fans threaten boycott after Christian album collab")
    // (never beside a death or a crime: "Altered football photo invoking Rouade Trevick' death sparks outrage" is a side story)
    // (and a claim's outcome in court is its own story: "<singer> given suspended jail sentence for nightclub altercation" under a fight.
    // Collector only, 2026-10-28)
    const sides = claim ? new Set(['response', 'lawsuit', 'allegations', 'arrest', 'sentencing', 'verdict']) : new Set(['response', ...(family && !family.sensitive ? ['backlash'] : [])]);
    s -= 0.75 * fams.filter((x) => !own || (x.f.key !== family.key && !sides.has(x.f.key) && x.f.w >= 0.8)).length;
    // (a claim its line states flat is told as reported, and a line that already reports it is the better one)
    const flat = statesClaim(line, family, last) && !REPORTED.test(line);
    if (flat) s -= UNREPORTED_PENALTY;
    // a claim's line says who makes it and what it is ("Dovette's allegations", "grooming", "battery"); a rumour about who someone is
    // is told as that rumour, never beside a wrongdoing claim it would read as denying ("lesbian dating profiles", not "groping")
    if (claim && !rumor) {
      // (the line's capitalised words are names only in a sentence-case line)
      const others = [...nameRuns(line), ...(titleCase ? [] : otherNames(ws, subject.split(' ')))].filter((n) => !n.split(' ').includes(last));
      if (others.length || /\b\p{Lu}\p{Ll}+['’]s\s+(?:allegations?|claims?|accusations?)\b/u.test(line)) s += 1;
      // (who makes it, by their full name: "streamer Dovette Kelner's allegations")
      if (others.some((n) => n.includes(' '))) s += CLAIM_NAMED_FULL;
      if (CLAIM_WORDS.test(line)) s += CLAIM_NAMED;
      // both sides in one line: the accuser named and the subject's denial ("pushes back on Dovette's allegations"); a threat to sue
      // alone is no denial
      if (STRICT_DENIAL.test(line)) s += 1;
    }
    if (rumor) {
      if (WRONGDOING.test(line)) s -= 2;
      if (DENIAL.test(line)) s += 1;
    }
    if (NOT_A_LINE.test(line)) s -= 3;
    s += majority(line);
    // a blog's or a forum's post is no outlet's report; a teaser's lead ("That wild 'Lanterns' finale twist ..."); a clause whose
    // subject is someone else ("... about Hollinette Yarrard feud after rushing to his deathbed")
    if (BLOG.test(r.outlet || '')) s -= 2;
    if (TEASER.test(line) || TEASER_DETAIL.test(line)) s -= 2;
    if (VAGUE.test(line)) s -= VAGUE_PENALTY;
    // (a line looking ahead to what has since happened is yesterday's news: "... spoke ahead of Jasade Wickenko's execution" two days on)
    if (AHEAD.test(line) && newestT - r.t > AHEAD_DAYS * DAY_MS) s -= AHEAD_PENALTY;
    // (a line that only says it was explained tells less than one that says what happened: "... explains heated exchange with fans"
    // under "... clarifies viral exchange after telling longtime fans they were 'distracting'")
    // (never a claim's: its response is the other side of it)
    if (!claim && family && DRAMA_FAMS.has(family.key) && EXPLAINS_ONLY.test(line)) s -= HAPPENED.test(line) ? -HAPPENED_BONUS : EXPLAINS_PENALTY;
    // (a ruling or a finding only one outlet's headline states, in a story others tell without it: "... as judge rules NDA is ...")
    if (OFFICIAL_ACT.test(line) && usable.length >= ACT_MIN_ROWS && acts.size < ACT_OUTLETS) s -= ACT_PENALTY;
    // a hedge on the wrong verb ("allegedly speaks out": the speaking is no claim), and who did it withheld ("defended by Oscar-winning
    // filmmaker"): a line says who and what
    if (MISPLACED_HEDGE.test(line)) s -= MISPLACED_HEDGE_PENALTY;
    if (UNNAMED_ACTOR.test(line)) s -= UNNAMED_PENALTY;
    // a soundbite inside the line ("Rouade Trevick funeral: 'We will miss everything about him,' mom says ...") tells a feeling, not the story
    if (LONG_QUOTE.test(line)) s -= LONG_QUOTE_PENALTY;
    if (ABSTRACT_SUBJECT.test(line)) s -= ABSTRACT_PENALTY;
    // (a line that only says there was a reaction says nothing: IDEAS-FEED G3 rule 10, G4. Collector only)
    if (onlyReaction(line, subject)) s -= REACTION_ONLY_PENALTY;
    if (claim && !rumor && ACCUSED_OF.test(line)) s += ACCUSED_OF_BONUS;
    if (family && family.key === 'recall') s += (RECALL_CAUSE.test(line) ? RECALL_CAUSE_BONUS : 0) - (RECALL_LOCAL.test(line) ? RECALL_CAUSE_BONUS : 0);
    if (reviews && REVIEWS_WHOLE.test(line)) s += REVIEWS_WHOLE_BONUS;
    if (DANGLING.test(line) && [...nameRuns(line)].some((n) => !n.split(' ').includes(last))) s -= 1.5;
    // a stronger reported verb the card's noun stands in for: "reportedly stabbed" over "reportedly injured" under a fight
    if (stronger && stronger.re.test(line) && REPORTED.test(line)) s += STRONGER_BONUS;
    if (ws.length > LONG_LINE) s -= 1;
    // someone else's reaction to it ("'The View' host Miran Vormott backs DA's decision not to charge 'Ravenmoor 7' ..."): the story told
    // second-hand
    const reacts = line.match(REACTION);
    if (reacts && !nameAt(words(line.slice(0, reacts.index)), last).length && nameAt(lw, last).length) s -= REACTION_PENALTY;
    // the name only in an aside about something else ("Plonker 'blown away' by ... amid Tavix Ostiss controversy")
    if (NAMED_ASIDE(subject).test(line)) s -= 4;
    if (FILLER_LEAD.test(line) || /!['’"”]?$/.test(line)) s -= 0.5;
    // (a cut headline, "... 2 dead and up to 35….", or one shouting mid-line, "dies! (in living color)")
    if (/…|\.\.\./.test(line)) s -= 2;
    if (/!\s+\S/.test(line)) s -= 1;
    // the line tells the title's own story: "lesbian" for "Quorena Brannmott lesbian allegations"
    const ctxWords = context.filter((w) => !R.PLACES.has(w));
    if (ctxWords.length && ctxWords.every((w) => lw.includes(w) || lw.some((x) => x.startsWith(w)))) s += CONTEXT_BONUS;
    if (!titleCase) s += 1.5;
    if (R.ENT_PUBLISHER.test(r.outlet || '') || MAJOR.test(r.outlet || '')) s += 0.5;
    if (ws.length < 7 || ws.length > 20) s -= 2;
    // (a question or an explainer is no account of what happened)
    if (/[?]/.test(line) || EXPLAINED.test(line) || QUESTION.test(line)) s -= 3;
    if (/\s[-–—|]\s/.test(line) || (W.quoteImbalance && W.quoteImbalance(line))) s -= 1;
    // a heading before a colon ("The Cornell 7: Allegations spark ...", "'Lanterns' finale: The creators ..."), a dash run-on ("Bible—And")
    if (/^[^:]{2,40}:\s+(?:the |a )?\p{Lu}/iu.test(line) && !/:\s+['‘"“]/.test(line)) s -= HEADING_COLON;
    if (/\S[—–]\S|[—–]\s*\p{Lu}/u.test(line)) s -= 1.5;
    // (no em dash in a card's line, no episode code, no line of two headings)
    if (/\s[—–]\s/.test(line)) s -= 1.5;
    if (/\bS\d{1,2}E\d{1,2}\b/i.test(line) || (line.match(/:\s/g) || []).length >= 2) s -= 1.5;
    // (a review is the news of a reviews card, and its verdict the account)
    if (NOT_THE_NEWS.test(reviews ? line.replace(/\breviews?\b/gi, ' ') : line)) s -= 2;
    if (LOADED.test(line) && !reviews) s -= 1.5;
    // a tabloid's scare quotes round a verb ("Pregnant Thalia Lorrova 'Disappears' from spotlight")
    if (SCARE_QUOTE.test(line)) s -= 1.5;
    if (LISTICLE.test(line)) s -= 2;
    // the subject doing the noun ("Wynia Pymick dead", "Lysette Marrner reveals", "QUAVNIX reportedly stabbed"), the subject leading the line
    if (own && nameAt(lw, last).some((i) => own.at - i >= 1 && own.at - i <= 2)) s += 1;
    if (lw.slice(0, 4).includes(last)) s += LEAD_WORDS_BONUS;
    // (a person's story told by a count is a statistic, not who did what: "2,400 signed up for Orria Neskley's controversial UT event")
    if (person && family && DRAMA_FAMS.has(family.key) && /^\d/.test(line)) s -= COUNT_LEAD_PENALTY;
    if (otherGiven(line, subject)) s -= OTHER_GIVEN_PENALTY;
    if (proxyLed(line, last, context)) s -= PROXY_PENALTY;
    // a death's line says who they were ("Canadian rock singer Zaniel Ulmiss dies ...")
    // (the words right before the name, never a clause leading into it: "No criminal charges in death of Rouade Trevick" says no one)
    // (and a sentence's or a verdict's, with what for: a line that only says the title again tells nothing, "Velard Gravley sentenced to
    // life without parole"; "Former 'American Idol' singer Velard Gravley sentenced to life for wife's murder" says who he is and why)
    if (family && WHO_FAMILIES.has(family.key)) {
      const at = nameAt(lw, subject.split(' ')[0])[0] ?? nameAt(lw, last)[0];
      const before = at === undefined ? [] : lw.slice(Math.max(0, at - 2), at);
      if (before.length === 2 && before.every((w) => !W.STOP.has(w) && !subject.split(' ').includes(w) && !familiesIn(w).length)) s += 1;
      // (and what for: "... sentenced to life for wife's murder")
      if (family.key !== 'death' && CLAIM_WORDS.test(line)) s += WHAT_FOR_BONUS;
    }
    if (R.RE.service.test(line)) s -= 1;
    if (OPINION.test(line)) s -= 2;
    if (/[.!?]\s+\p{Lu}/u.test(line)) s -= 1;
    if (r.t >= peakDay - DAY_MS / 2 && r.t < peakDay + 1.5 * DAY_MS) s += 1;
    else if (r.t < peakDay - DAY_MS) s -= 1;
    // (the last two days' development a little over the busiest day's: "Fenory Zellard ... renew call for federal investigation")
    if (now && now - r.t < 2 * DAY_MS) s += NEWEST_BONUS;
    // a fact-check aside about a film or show is not how it is doing ("Monster skipped the real Tavena Osturn's ...")
    if (!family && FACT_CHECK.test(line)) s -= 1.5;
    // an interview's heading ("'Monster' star Wynix Pymurn on Tavena Osturn's relationship with Pellette")
    if (QA_HEADING.test(line)) s -= 2;
    return { r, line, s, titleCase, flat };
  }).sort((a, b) => b.s - a.s || a.r.t - b.r.t || a.line.localeCompare(b.line));
  // the line must say the noun when there is one; a film or show with none is told by how it is doing ("opened at No. 1")
  // (or, short of that, what it is and who is in it: "Pellade Sorrova stars in Netflix's 'East of Eden' adaptation")
  const showing = /\b(?:box office|no\. ?1|number one|tops|opening weekend|record|streaming chart|most-watched|top 10|stars in|premieres?|debuts?|now streaming)\b/i;
  if (!family) for (const x of scored) if (showing.test(x.line)) x.s += 1.5;
  scored.sort((a, b) => b.s - a.s || a.r.t - b.r.t || a.line.localeCompare(b.line));
  if (debug) for (const x of scored.slice(0, Number(process.env.TALK_LINES) || 12)) debug(`     ${x.s.toFixed(1).padStart(5)} ${new Date(x.r.t).toISOString().slice(5, 10)} ${x.r.outlet} | ${x.line}`);
  // (and the title's own words when a usable line has them: "lesbian" for "Quorena Brannmott lesbian allegations")
  const ctxWords = context.filter((w) => !R.PLACES.has(w));
  const says = (x) => ctxWords.every((w) => words(x.line).some((y) => y === w || y.startsWith(w)));
  const fits = (x) => !family || (reviews ? REVIEWS_WHOLE.test(x.line) : saysIt(x.line, family) && !othersSaid(x.line, family, subject));
  const best0 = (ctxWords.length && scored.find((x) => fits(x) && says(x) && x.s >= 0)) || scored.find(fits);
  // (a show's facet no fit line tells well, "East of Eden ending" under explainers and interviews: the show's own plainest line)
  const best = best0 && best0.s >= 0 ? best0 : family && SHOW_FACETS.has(family.key) ? scored.find((x) => x.s >= SHOW_FALLBACK_MIN) || best0 : best0;
  if (!best || best.s < 0) return { what: null, denied: false, trace: [], unsaid: false };
  // (the line never says the noun: the card is titled by what the line tells, never "East of Eden ending" over a casting line)
  const unsaid = !!family && !fits(best);
  // (a Title Case line is told plainly once recased: "Slams" is "slams" only now)
  // (a title is never surer than its sources: a claim no line of its own reports is told as reported, "... reportedly gets slapped by
  // two men during Vietnam stream")
  const said = best.flat ? reportedClaim(best.line, family) : best.line;
  // (and as a sentence: the helping verb a headline clips goes back in, "Esso Quillley is accused of ...")
  let what = TL.sentenceVerb(TL.plainWords(sentenceLine(said.replace(FILLER_LEAD, ''), lex, best.titleCase)), subject);
  if (family && family.key === 'ending') what = what.replace(SPOILER, 'who $1 ');
  // (a Title Case headline's plain words a recase leaves capitalised beside a name: "Rotten Tomatoes Reviews praise ... Miniseries")
  if (reviews && best.titleCase) what = what.replace(REVIEW_CAPS, (m) => m.toLowerCase());
  // (an age the sources disagree on is left out: "dead at the age of 63" in one, "dies at 65" in another)
  // (an age the sources disagree on is left out, unless the line gives the one three in four of them give: TMZ's 33 among 34s)
  if (family && family.key === 'death') {
    const ages = agesIn(usable.filter((r) => family.re.test(r.title)).map((r) => afterName(cleanHeadline(r.title, r.outlet), last)));
    const said = [...agesIn([afterName(what, last)]).keys()][0];
    const total = [...ages.values()].reduce((a, b) => a + b, 0);
    // ("dead at 63" -> "dies", never a bare "dead")
    if (ages.size > 1 && !(said && ages.get(said) >= AGE_MAJORITY * total)) {
      what = what.replace(/(?:,\s*|\s+(?:is\s+)?)dead\s+(?:at the age of|at age|aged?|at)\s+\d{1,3}\b/i, ' dies').replace(/\s+(?:at the age of|at age|aged?|at)\s+\d{1,3}\b/i, '')
        .replace(/,\s+\d{1,3},/, '');
    }
  }
  const trace = [{ source: best.r.outlet, t: best.r.t, text: best.r.title }];
  let denied = false;
  // (a suit the subject brought is denied by the other side, not by the subject: "Wyno Pymace launches legal action")
  const plaintiff = family && family.key === 'lawsuit' && new RegExp(`\\b${last}\\b[^.;:]*?\\b(?:sues|sued|suing|launch\\w* (?:a )?legal|files?|filed|tak(?:es?|ing|en) legal action|legal challenge|challeng(?:es|ed|ing))\\b|\\b${last}(?: s|s)? legal (?:action|challenge|bid|fight|case)\\b`, 'i').test(words(best.line).join(' ') + ' ' + best.line);
  if (family && DENIED_TOO.has(family.key) && !plaintiff) {
    const pron = pronounOf(usable, subject);
    const name0 = nameSurface(subject, usable.map((r) => r.title));
    // (a person the line already names whole is named again by the surname: "Bexan Tamard responds to ...; Tamard denies it")
    const name = personLike(subject, null) && subject.split(' ').length >= 2 && contains(words(best.line).join(' '), subject) ? name0.split(' ').slice(-1)[0] : name0;
    // (a line that already carries a denial gets no second one; a threat to sue alone still gets one)
    // (the line's own denial, in its outlet's words: whoever of the subject's makes it, it is on record. kin)
    if (STRICT_DENIAL.test(best.line)) denied = !!denialClause(best.line, subject, pron, name, DENIAL_NEAR_OWN, { kin: true });
    else {
      for (const x of scored) {
        if (x === best || x.s <= -5) continue;
        // (a denial of the same claim: the noun, or a claim word, in its line)
        if (!(family.re.test(x.line) || /\b(?:claims?|allegations?|accusations?|rumou?rs?|charges)\b/i.test(x.line))) continue;
        const clause0 = denialClause(x.line, subject, pron, name);
        if (!clause0) continue;
        // (a line already saying the subject is suing needs only the denial: "... responds to abuse allegations: 'I'm suing you, bro!'")
        // (and names the subject when someone else is named last in the line: "... involving Wexwy; Bexan Tamard denies it")
        const who = pron && !otherAfter(best.line, last) ? pron : name;
        const clause = /\bsu(?:e|es|ing)\b|\blawsuit\b|\blegal action\b/i.test(best.line) ? `${who} denies it` : clause0;
        what = `${what.replace(/[.!]+(['’"”]?)$/, '$1')}; ${clause}`;
        trace.push({ source: x.r.outlet, t: x.r.t, text: x.r.title });
        denied = true;
        break;
      }
    }
  }
  // (a quoted word or two before the subject's own sentence is a soundbite, not the story: "'Sacrilege': Quoro Branniss criticised ...")
  const lead = what.match(/^[‘“'"][^‘’“”'"]{2,40}[’”'"]:\s+/);
  if (lead && words(what.slice(lead[0].length)).slice(0, subject.split(' ').length).join(' ') === subject) what = what.slice(lead[0].length);
  // (a line ending in a closing quote after its stop is a whole sentence: "... 'I'm suing you, bro!'")
  // (and it is printed the card's way: curly quotes, "and" for "&", "six decades")
  what = TL.tidyLine(what);
  return { what: /[.!?]['’"”]?$/.test(what) ? what : `${what}.`, denied, trace, unsaid };
}

/**
 * Whether a line states something about a person that only a report may: a claim family's noun (an allegation, a fight, a leak, a
 * scam; an affair, a pregnancy or who is dating whom), or, under no family or one people only argue about, a wrongdoing in so many
 * words ("Fremvane cheated on girlfriend ..."). Never a legal step, which says who claims it, nor something the line says was owned up to.
 */
function statesClaim(line, family, last) {
  if (OWNED_UP.test(line)) return false;
  if (family && (CLAIMS.has(family.key) || (family.key === 'romance' && ROMANCE_CLAIM.test(line)))) return true;
  if (family && (LEGAL_STEP.has(family.key) || family.key === 'reviews' || family.key === 'memoir' || family.key === 'hoax')) return false;
  // (what the subject is said to have done: its name right before the wrongdoing, "Fremvane cheated on ...", "Bexan Tamard assaulted a fan")
  return !!last && new RegExp(`(?<![\\p{L}\\p{N}])${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:\\p{Ll}+ly\\s+)?${DID_WRONG}(?![\\p{L}\\p{N}])`, 'iu').test(line);
}
const DID_WRONG = '(?:cheated|groomed|assaulted|abused|raped|harassed|molested|scammed|defrauded|stole from|groped|punched|slapped|attacked|stalked|threatened|drugged|robbed)';
// (where "reportedly" goes in a line with no family's word: before the wrongdoing it states)
const CLAIM_FAMILY = { key: 'claim', re: new RegExp(`\\b${DID_WRONG}\\b`, 'i') };

/** A flat claim told as reported, by its family's word when the line says it, else by the wrongdoing it states. */
const reportedClaim = (line, family) => reported(line, family && saysIt(line, family) ? family : CLAIM_FAMILY);

/**
 * A flat claim told as reported: "reportedly" before what was done (before its "gets" or "was": "reportedly gets slapped by two men"),
 * or, when the line names it with a noun, ", reports say" at its end.
 */
function reported(line, family) {
  const m = saidIn(line, family) || line.match(family.re);
  if (!m || !/(?:ed|en)$/i.test(m[0])) return `${line.replace(/[.!]+$/, '')}, reports say`;
  const head = line.slice(0, m.index);
  const aux = head.match(/\b(?:gets|got|is|was|were|are|been|being|has been|had been|have been)\s+$/i);
  const at = aux ? aux.index : m.index;
  return `${line.slice(0, at)}reportedly ${line.slice(at)}`;
}

/** A headline in sentence case (a Title Case one is recased with the lexicon), ending without a stop (added by the caller). */
function sentenceLine(line, lex, titleCase = null) {
  const ws = line.split(/\s+/);
  // (a Title Case headline made plain is still recased: "AEW Star TROXRR Dead at 40" -> "AEW star Troxrr has died at 40")
  const s = (titleCase === null ? W.isTitleCase(ws) : titleCase) && lex ? W.recase(line, lex, true) : line;
  // (a new sentence after a question or an exclamation starts with a capital: "Is the Quavrrb still alive? What happened ...")
  const out = s.replace(/([?!]['’"”]?\s+['‘"“]?)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase());
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The line with every spelling of a name as the card's title spells it ("QUAVNIX" -> "Quavnix", "lysette marrner" -> "Lysette Marrner"). */
function recaseName(line, name, surface) {
  // (a plain word is no name to respell: "Plague outbreak expands ...")
  if (!line || !surface || !/\p{Lu}/u.test(surface)) return line;
  // (never a name a hyphen carries on: "Fenard Zellith" inside "Fenard Zellith-Varne")
  const pat = new RegExp(`(?<![\\p{L}\\p{N}])${name.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.-]+')}\\.?(?![\\p{L}\\p{N}]|-\\p{L})`, 'giu');
  // (a one-word name a dictionary spells is respelt only where the line prints it as a name, with its capital or opening a sentence:
  // "lit by a paper lantern" under a streamer called Lantern keeps its small word. Collector only, 2026-10-19)
  const strict = !name.includes(' ') && (W.inDict(name) || W.isFirstName(name));
  const opens = (at) => at === 0 || /[.!?:]['’"”]?\s+['‘"“]?$/.test(line.slice(0, at));
  const out = line.replace(pat, (m, at) => (strict && !/^\p{Lu}/u.test(m) && !opens(at) ? m : m.endsWith('.') && !surface.endsWith('.') ? `${surface}.` : surface));
  return capLine(out, surface);
}

// ---------- a person's soft news (collector only, wave 12: lib/line-soft.js, IDEAS_SOFT_NEWS) ----------
// A searched person's news that is no drama, read from one outlet's headline that leads with the person and says it of them: a health
// update, an engagement, a wedding, a pregnancy, a baby, a role, an award, a tour, an album or a song, a return, an interview. Its own
// families, apart from FAMILIES: nounOf never reads them, so no card's noun changes but through softRead. Each is said in the clause right
// after the name ("<name> announces engagement to <partner>", "<name>, 45, welcomes baby"), never of someone else, never only rumoured.
// `lead`: an interview is said by the verb right after the name ("<name> opens up about ...", "<name> says she ..."; never an admission,
// which the reveal and admission readings tell); the others anywhere in that clause. `hedged`: one only rumoured, feared or hinted at is no title of its own ("pregnancy rumours", "fans fear for <name>'s
// health", "reportedly in talks to star"). `noun`: the title's word for what the headline says.
const SOFT_FAMILIES = [
  { key: 'health', w: 0.6, hedged: true, re: /\b(?:diagnos(?:is|ed|es)|misdiagnos\w+|hospitali[sz]ed|surger(?:y|ies)|cancer|tumou?rs?|chemo\w*|stroke(?! of)|heart attack|illness|health (?:update|scare|battle|issues?|condition|news|struggles?|crisis|journey|setback)|recover(?:ing|y|s|ed) from|rehab|treatment|(?:eye|heart|skin|medical|rare|chronic) condition|disease|dementia|sclerosis|leuka?emia|lymphoma|lupus|seizures?)\b/i,
    noun: () => 'health update' },
  { key: 'pregnancy', w: 0.6, hedged: true, couple: true, re: /\b(?:pregnant|pregnancy|expecting (?:a |their |her |his |baby|twins|first|second|third|fourth|child)|baby (?:no\.?\s*\d|number \w+|on the way|bump))\b/i,
    noun: () => 'pregnancy' },
  { key: 'baby', w: 0.6, hedged: true, couple: true, re: /\b(?:welcom(?:es|ed|ing) (?:(?:a|their|her|his|baby|first|second|third|fourth|new|magical|healthy)\s+)*(?:baby|son|daughter|child|twins|boy|girl)|gives? birth|gave birth|new baby|newborn|becomes? (?:a )?(?:mom|mum|dad|mother|father|parents?)|baby (?:boy|girl))\b/i,
    noun: () => 'baby' },
  { key: 'engagement', w: 0.6, hedged: true, couple: true, re: /\b(?:engaged|engagement|propos(?:es|ed) to|pops the question|popped the question)\b/i, noun: () => 'engagement' },
  { key: 'wedding', w: 0.6, hedged: true, couple: true, re: /\b(?:marries|weds|ties the knot|tied the knot|wedding(?! anniversary)|(?:gets|got|getting) married|exchange(?:s|d)? vows|walks? down the aisle)\b/i,
    noun: () => 'wedding' },
  { key: 'casting', w: 0.6, hedged: true, re: /\b(?:cast (?:as|in)|joins? (?:the )?cast|to star (?:in|as|opposite|alongside)|set to (?:star|play|lead|host)|will (?:star|play|lead|host) |stars? as|to play\b(?=[^,;:]{0,50}\b(?:in|opposite|role|lead|part|alongside)\b)|lands? (?:a |the |her |his |their )?(?:new |lead |starring |leading )?(?:role|part|lead|gig)|boards (?:the |a |an )?(?:cast|film|movie|series|project|show|sequel|remake|adaptation|biopic)|signs? on (?:to|for)|tapped (?:to|for|as))/i,
    noun: () => 'casting' },
  { key: 'award', w: 0.6, hedged: true, re: /\b(?:to receive|receives?|received|wins?|won|earns?|earned|accepts?|honou?red (?:with|at|by)|is honou?red|inducted into|named \w+ of the year|nominated for|(?:lands?|scores?|earns?|gets?) (?:a |an |her |his |their )?(?:\w+ )?nomination|gets? (?:a )?star on)\b[^,;:]{0,60}?\b(?:awards?|prize|honou?r|trophy|grammys?|emmys?|oscars?|tony|golden globes?|baftas?|hall of fame|walk of fame|medal|of the year|nominations?)\b/i,
    noun: (s) => (/nominat/i.test(s) ? 'nomination' : 'award') },
  { key: 'tour', w: 0.6, re: /\b(?:announces?|unveils?|reveals?|kicks? off|launches?|adds|extends?|confirms?|postpones?|cancels?|wraps?)\b[^,;:]{0,40}?\b(?:tour(?! bus)|residency)\b/i, noun: () => 'tour' },
  { key: 'album', w: 0.6, re: /\b(?:announces?|unveils?|reveals?|drops?(?! out)|dropped(?! out)|releases?|released|teases?|shares?|debuts?|premieres?)\b[^,;:]{0,40}?\b(?:album|ep|mixtape|single|song|music video)\b/i,
    noun: (s) => (/\b(?:single|song|music video)\b/i.test(s) ? 'new song' : 'album') },
  { key: 'return', w: 0.6, re: /\b(?:returns? to|returning to|makes? (?:a |an |her |his |their )?(?:\w+ )?(?:return|comeback)|is back (?:on|to|with)|comes? back to|back (?:on|to) (?:stage|screen|tv|the stage|instagram|social media|youtube|twitch|streaming))\b/i,
    noun: () => 'return' },
  { key: 'interview', w: 0.5, lead: true, re: /\b(?:opens? up|gets? candid|gets? real|reveals?|recalls?|reflects? on|talks?|speaks? (?:out )?(?:about|on)|says? (?:she|he|they|her|his|it|that|i|being)|shares? (?:why|how|what|that|rare|candid|emotional|heartfelt|details|(?:her|his|their) (?:story|experience|journey|struggles?|thoughts))|explains?|discusses|dishes on)\b/i,
    noun: () => 'interview' },
];
const SOFT_FAMILY = new Map(SOFT_FAMILIES.map((f) => [f.key, { ...f, soft: true }]));
// (only rumoured, feared, hinted at or denied: no title of its own; it stays reported where a drama card or none tells it)
const SOFT_HEDGE = /\b(?:reportedly|allegedly|rumou?r\w*|speculat\w*|sources?|insiders?|claims?|claimed|purportedly|apparently|seemingly|appears? to|could|might|may|hints?|hinted|hinting|sparks?|sparked|fuels?|fueled|fuelled|fans (?:think|believe|suspect|speculate|wonder|worry|fear|notice|convinced)|concerns?|concerned|fears?|feared|worr(?:y|ies|ied)|in talks|eyed|frontrunner|odds|denies|denied|deny|shuts? down|not|no longer|never|isn['’]t|wasn['’]t|won['’]t|doesn['’]t|didn['’]t|fake|hoax\w*|amid|jok(?:es|ed|ing|e)|quips?|quipped|kid(?:s|ding)|trolls?|trolled|pranks?|pranked|parod\w+|food baby|theor(?:y|ies|ists?)|blind items?)\b/i;
// (looks back: no news of today's for a title, "<name> recalls her first pregnancy"; an interview may look back, it is today's)
const SOFT_RETRO = /\b(?:recalls?|recalled|remembers?|reflects? on|looks? back|looking back|years? ago|decades? ago|throwback|anniversary|once|former|ex-|past|reminisces?|regrets?|at \d{1,2})\b/i;
// (a story the drama families tell is told by them: the soft reading never stands in for a claim, a fight, a split, a death)
const SOFT_BLOCK = new Set([...DRAMA_FAMS, 'death', 'execution', 'verdict', 'sentencing', 'mistrial', 'prison', 'crash', 'cheating', 'outbreak', 'riots'].filter((k) => !['remarks', 'tears', 'retirement'].includes(k)));
// someone of the person's, a relative or a helper: their news is their own ("<name> says daughter's cancer ...")
const SOFT_THEIRS = /(?<![\p{L}\p{N}])(?:daughters?|sons?|wife|husband|mother|mom|mum|father|dad|sisters?|brothers?|family|kids|children|parents?|grand(?:mother|father|ma|pa|son|daughter)|cousin|uncle|aunt|niece|nephew|ex|partner|girlfriend|boyfriend|fianc[eé]e?|friend|friends|co-?stars?|bandmates?|manager|pet|dog|cat)(?![\p{L}\p{N}])/iu;
// (what may stand before the name: a role, a show in quotes, a partner's possessive, "<Other> and" for a couple; never an object of someone's verb)
const SOFT_PREFIX_END = /(?<![\p{L}\p{N}])(?:with|for|to|by|from|of|at|on|as|vs\.?|versus|about|against|over|after|like|than|calls|tells|says|slams|praises|thanks|joins|meets|congratulates|hugs|kisses|and|&)\s*$/iu;
const SOFT_PARTNER_PREFIX = /^(?:\S+\s+){0,3}\S+[’']s\s+(?:(?:new|longtime|long-time)\s+)?(?:boyfriend|girlfriend|husband|wife|fianc[eé]e?|partner)\s*$/iu;
const SOFT_AND_PARTNER = /^\s+(?:and|&)\s+(?:(?:her|his|their)\s+)?(?:(?:new|longtime|long-time)\s+)?(?:(?:boyfriend|girlfriend|husband|wife|fianc[eé]e?|partner)\s+)?(?:\p{Lu}[\p{L}\p{N}’'.-]*\s+){1,3}/u;
// (a verb whose object is someone else's news: "<name> congratulates <other> on engagement", "<name> attends wedding of ...")
const SOFT_OTHERS_VERB = /(?<![\p{L}\p{N}])(?:congratulat\w*|prais\w*|react\w*|respond\w*|slam\w*|mock\w*|roast\w*|support\w*|defend\w*|attend\w*|crash\w*|officiat\w*|toast\w*|gush\w*|wish\w*|celebrates? (?:with|for)|hosts?|throws?|plans?|joins|visits?|comforts?|consol\w*|mourn\w*|honou?r\w*|blesses|thanks|meets|surprises?)(?![\p{L}\p{N}])/iu;
/**
 * Whether a span names someone: in a sentence-case headline any capitalised word but "I"; in a Title Case one a given name, or two words
 * in a row no dictionary spells.
 */
function someoneIn(span, nw, titleCase) {
  const toks = String(span || '').split(/\s+/).map((t) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').replace(/[’']s$/, '')).filter(Boolean);
  const named = (t) => /^\p{Lu}/u.test(t) && t !== 'I' && !nw.includes(t.toLowerCase());
  if (!titleCase) return toks.some(named);
  const unknown = (t) => named(t) && /^\p{L}{3,}$/u.test(t) && !W.inDict(t.toLowerCase());
  return toks.some((t) => named(t) && W.isFirstName(t.toLowerCase())) || toks.some((t, i) => i + 1 < toks.length && unknown(t) && unknown(toks[i + 1]));
}
// (a disaster word anywhere in the headline: no soft family stands)
const SOFT_DISASTER = /\b(?:hurricanes?|storms?|typhoons?|cyclones?|tornado(?:es)?|wildfires?|bushfires?|fire|blaze|flood(?:s|ed|ing)?|earthquakes?|quakes?|tsunamis?|landslides?|mudslides?|eruptions?|evacuat\w*)\b/i;
const SOFT_LEAD_AT = 6;
const SOFT_BETWEEN_WORDS = 10;
const SOFT_SAID_WORDS = 2;
const SOFT_APPOSITIVE = /^\s*,\s*(?:\d{1,3}|[^,]{1,40}),/;

/**
 * Which soft family a headline says of the person, or null: { f, noun, surface, index }. `name`: the person's key ("orla venn"); `lex`:
 * the lexicon (a person-like other name). The name whole within the first SOFT_LEAD_AT words, nothing before it but a role, a show or a
 * partner's possessive (or "<Other> and" for a couple's news); the family said after it in the same clause, nobody else named or someone
 * of theirs between; no drama family, death or claim anywhere in it; never a question; a family that can be only rumoured, not hedged.
 */
function softSaid(text, name) {
  const s = String(text || '');
  if (!s || !name || /\?/.test(s) || QUESTION.test(s) || EXPLAINED.test(s)) return null;
  const nw = String(name).toLowerCase().split(' ').filter(Boolean);
  const ws = words(s);
  const at = nameAt(ws, nw.join(' '));
  if (!at.length || at[0] > SOFT_LEAD_AT) return null;
  if (familiesIn(s).some((x) => SOFT_BLOCK.has(x.f.key))) return null;
  // (where the name ends in the text itself: its last word's first mention)
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = s.match(new RegExp(`(?<![\\p{L}\\p{N}])${nw.map(esc).join('[\\s.-]+')}(?![\\p{L}\\p{N}])`, 'iu'));
  if (!m) return null;
  const prefix = s.slice(0, m.index);
  if (/:/.test(prefix)) return null;
  // (a disaster in the headline is no one's soft news: "<place> boards up as hurricane nears", "<name> evacuates as wildfire spreads")
  if (SOFT_DISASTER.test(s)) return null;
  // (a baby lost is a death: never a soft card)
  if (/\b(?:born sleeping|stillb(?:orn|irth)|miscarri\w+|lost (?:the|their|her|his|our) baby)\b/i.test(s)) return null;
  let after = s.slice(m.index + m[0].length);
  // (the name's own possessive is someone of theirs or a thing of theirs: "<name>'s daughter", never the name's own news)
  if (/^[’']s\b/.test(after)) return null;
  const titleCase = titleCased(s);
  const couple = /^\s*(?:\p{Lu}[\p{L}\p{N}’'.-]*\s+){1,3}(?:and|&)(?:\s+\p{Ll}[\p{L}-]*){0,2}\s*$/u.test(prefix);
  if (prefix.trim() && !couple && !SOFT_PARTNER_PREFIX.test(prefix) &&
    (SOFT_PREFIX_END.test(prefix) || /[’']s\s/.test(prefix) || otherFullName(prefix, new Set(nw), titleCase))) return null;
  const app = after.match(SOFT_APPOSITIVE);
  const base = m.index + m[0].length + (app ? app[0].length : 0);
  if (app) after = after.slice(app[0].length);
  // (the clause that follows the name: to its first stop, colon, dash or "as"/"after" that starts another story)
  const stop = after.search(/[;:|]|\s[—–-]\s|,\s+(?!\d)|\s(?:after|amid|while|following|weeks after|days after)\s/i);
  const clause = stop < 0 ? after : after.slice(0, stop);
  for (const f0 of SOFT_FAMILIES) {
    const f = SOFT_FAMILY.get(f0.key);
    if (couple && !f.couple) continue;
    const hit = clause.match(f.re);
    if (!hit) continue;
    // (a couple's news may name the partner right after the name: "<name> and boyfriend <partner> announce engagement")
    const between = f.couple ? clause.slice(0, hit.index).replace(SOFT_AND_PARTNER, ' ') : clause.slice(0, hit.index);
    if (f.lead && !/^\s+(?:(?:finally|candidly|tearfully|emotionally|openly|now|also)\s+)?$/i.test(between)) continue;
    // (an interview says what was said: two words of it at least after the verb, "<name> opens up" says nothing)
    if (f.lead && words(clause.slice(hit.index + hit[0].length)).filter((w) => w.length > 2 && !W.STOP.has(w)).length < SOFT_SAID_WORDS) continue;
    // (nobody else's: no other name, no one of theirs, no possessive before the family's word; and then the headline is that other
    // person's soft news, never this name's interview: "<name> reveals husband's cancer diagnosis" is the husband's)
    if (words(between).length > SOFT_BETWEEN_WORDS) continue;
    if (!f.lead && (SOFT_THEIRS.test(between) || SOFT_OTHERS_VERB.test(between) || /[’']s\s+(?:[\p{L}-]+\s+){0,2}$/u.test(between) ||
      otherFullName(between, new Set(nw), titleCase) || someoneIn(between, nw, titleCase))) return null;
    if (f.hedged && (SOFT_HEDGE.test(s) || SOFT_RETRO.test(clause))) continue;
    // (another person named inside the family's own words is that person's doing: "<name> reveals <Other> filled her tour bus")
    if (!f.lead && otherFullName(hit[0], new Set(nw), titleCase)) return null;
    const tail = clause.slice(hit.index + hit[0].length, hit.index + hit[0].length + 60);
    if ((f.couple || f.key === 'award') && (/\bon behalf of\b/i.test(tail) || (f.couple && /^\s*(?:\S+\s+){0,2}(?:of|for)\b/i.test(tail) && (SOFT_THEIRS.test(tail) || /[’']s\b/.test(tail) || someoneIn(tail, nw, titleCase))))) return null;
    if ((f.couple || f.key === 'award') && /\b(?:at|attends?|attending|performs? at|sings? at|stuns? at|dazzles? at)\s+(?:(?:a|an|the|lavish|royal|star-studded|celebrity|intimate|surprise|glamorous|private)\s+){0,3}$/i.test(clause.slice(0, hit.index))) return null;
    if (f.key === 'health' && /\b(?:charit\w*|research|awareness|fundrais\w*|foundation|campaign|donat\w*|benefit|telethon|marathon|patients)\b/i.test(clause)) return null;
    // (an interview that tells another named person's news is theirs: "<name> opens up about <Other>'s overdose")
    if (f.lead && /(?:^|\s)\p{Lu}[\p{L}-]+\s+\p{Lu}[\p{L}-]+[’']s\b/u.test(clause.slice(hit.index + hit[0].length))) return null;
    // (and one whose said part opens on another person, "<name> reveals <Other> filled her tour bus": the other's doing, not her news)
    if (f.lead && otherFullName(words(clause.slice(hit.index + hit[0].length)).length ? clause.slice(hit.index + hit[0].length).split(/\s+/).filter(Boolean).slice(0, 3).join(' ') : '', new Set(nw), titleCase)) return null;
    return { f, noun: f.noun(hit[0]), surface: hit[0], index: base + hit.index };
  }
  return null;
}

/**
 * The soft news of a searched person's card, or null: the soft family its newest outlet headlines say of it (rows: the card's evidence
 * rows, each { title, outlet, t, blocked, far, youtube, fam }), within `days` of now, most headlines first and then the families' order.
 * -> { f, noun, count, rows } (rows: the headlines that say it, oldest first).
 */
function softRead(rows, name, { now = 0, days = 3 } = {}) {
  const by = new Map();
  for (const r of rows || []) {
    if (!r || !r.title || r.youtube || r.fam === 'reddit' || r.fam === 'bluesky' || r.blocked || r.far) continue;
    if (now && Number.isFinite(r.t) && now - r.t > days * DAY_MS) continue;
    const said = softSaid(cleanHeadline(r.title, r.outlet), name);
    if (!said) continue;
    const e = by.get(said.f.key) || { f: said.f, nouns: new Map(), rows: [] };
    e.nouns.set(said.noun, (e.nouns.get(said.noun) || 0) + 1);
    e.rows.push(r);
    by.set(said.f.key, e);
  }
  if (!by.size) return null;
  const order = SOFT_FAMILIES.map((f) => f.key);
  const outlets = (e) => new Set(e.rows.map((r) => String(r.outlet || '').toLowerCase())).size;
  const best = [...by.values()].sort((a, b) => outlets(b) - outlets(a) || order.indexOf(a.f.key) - order.indexOf(b.f.key))[0];
  const noun = [...best.nouns.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return { f: best.f, noun, count: best.rows.length, rows: [...best.rows].sort((a, b) => a.t - b.t) };
}

module.exports = { SAID_FAMS, SAID_RE, saidTopic, postTopic, RECALL, REVIEWS, MEMOIR, RELATION, OFFICIAL, FAMILIES, FAMILY, SPORTS_TALK, DRAMA_FAMS, DENIABLE, CLAIMS, FACETS, EXPLAINED, QUESTION, familiesIn, othersNoun, othersSaid, nameAt,
  // (collector only, wave 12: a person's soft news, lib/line-soft.js)
  SOFT_FAMILIES, SOFT_FAMILY, softSaid, softRead,
  // (collector only: nounOf, caseTitle and whatOf are asked of the same headlines for every audience's list, answered once a build;
  // nounOf's answer holds the family itself, kept, and plain values, copied. engine/memo.js)
  nounOf: MEMO.memo('nounOf', nounOf, { copy: (r) => (r ? { ...r } : r) }), nameRuns, personLike, subjectOf, relationOf, personalNear,
  titleWords, caseTitle: MEMO.memo('caseTitle', caseTitle), caseMap, nameSurface, cleanHeadline, whatOf: MEMO.memo('whatOf', whatOf), recaseName, DENIAL, ROLE, WRONGDOING, MAJOR, REPORTED, reported,
  saidIn, says: saysIt, withoutSpeech, onlooker, trailingOnlooker, rumoured, ANSWERED, coupleQuits, HOAX, POST_CLAIM, statesClaim, reportedClaim, denialClause, capLine, sentenceLine,
  // (collector only: whose a death or an arrest is, read from the headline itself)
  whoseDeath, ownRelation, spanAfter, actsBefore, PERSONAL, LIVING, RELATION_HER, RELATION_HIS, onlyReaction, REACTION_SAID,
  // (collector only, wave 12 release: engine/grave-own.js)
  otherFullName };
