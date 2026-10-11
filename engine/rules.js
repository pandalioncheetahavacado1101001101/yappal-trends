'use strict';
/*
 * Topic rules for the Ideas list: what counts as proof that something went viral, which topics never belong, which outlets
 * are dropped or discounted, and the places/teams that are never the subject of a story.
 * Plain regular expressions and word sets only, so they port 1:1 to NSRegularExpression / Set<String> in Swift.
 */

const splitList = (s) => s.split(/\s+/).filter(Boolean);
// Generic nouns never carry a story on their own, so they are never its hook word.
const HOOK_STOP = new Set(splitList(`movie film show series song album tour trailer documentary doc ad ads campaign concert game match
  interview podcast episode season clip photo video post moment fan fans star singer actor actress rapper internet online
  people user users story news report week weekend night day today home family`));

const RE = {
  // Explicit proof that the thing itself went viral. One such item is enough for a story to qualify.
  viral: /\b(goes viral|went viral|going viral|gone viral|viral (video|clip|moment|post|photo|trend|dance|sound|challenge|meme|debate|sensation|footage|typo|song)|instant meme|(became|becomes|become|becoming|turned into|turns into|is now|is the) (an? |the )?(\w+ ){0,3}(meme|trend)|latest (viral )?meme|brainrot|internet(['’]s)? (is obsessed|can'?t|cannot|loses|goes wild|new favou?rite|wildest)|breaks the internet|sparks? (memes|a meme|a trend|a viral)|tiktok trend|trend(s|ing)? on (tiktok|x|social media)|takes over (tiktok|the internet|social media)|(has|have) the internet|social media (is|erupts|reacts|can'?t)|\d+(\.\d+)? (million|billion) views)\b/i,
  // Crowd reaction words: proof only together with wide coverage (3+ outlets).
  reaction: /\b(internet reacts|the internet is (divided|reacting)|backlash|slammed|slams|roast(s|ed|ing)?|trolled|mocked|mocks|mocking|booed|meltdown|fans (react|slam|roast|mock|troll|freak|lose|fume|fuming)|has fans fuming|sparks? (debate|outrage|backlash)|ignit\w+ (a )?debate|enraged|outrage|pile-?on|ratioed|divided)\b/i,
  soft: /\b(viral|onstage|on stage|feud|diss|fan theor\w*|theories|fans think|clapback|hilarious|bizarre|awkward|jaw-dropping|stuns?|lookalike|wholesome|react(s|ed|ing)? to|reaction to|meme|memes)\b/i,
  // Physical "moment" verbs: the Chris-Rock-slaps-Will-Smith kind of item.
  moment: /\b(slaps?|slapped|bites|falls?|fell|trip(s|ped)? (over|on|up|and)|tripped|kiss(es|ed)?|dances?|danced|dancing|cries|cried|crying|sobs|booed|melts?|melting|disintegrates?|glitch\w*|storms? off|walks? off|twerk\w*|faints?|fainted|chugs?|pranks?|pranked|punch\w*|shoves?|confronts?|heckl\w*|proposes?|proposed|hug(s|ged)?|claps? back|rejects?|rejecting|shuts down|shutting down|flinch\w*|taunt\w*|mimed|mimes|miming|recreat\w*|reenact\w*|flatten\w*|plow\w*|collid\w*|collision|tackl\w*|smack\w*|juggl\w*|balanc\w*|carries|carrying|soil\w*|poops?|pooped|jam session|photobomb\w*|stumbl\w*|wardrobe malfunction|lets \w+( \w+)? win|serenad\w*|screams?|screaming|shadowbox\w*|pulse)\b/i,
  // An interview account of something ("X says his kid roasted him") is not footage of a moment.
  told: /\b(says|said|reveals?|revealed|admits?|admitted|recalls?|recalled|opens up|speaks out|weighs in|breaks (his|her|their )?silence|shares (his|her|their) thoughts|explains?|confess\w*|jokes?|joked|tells|told|details|claims?|remembers|reflects|interview|podcast)\b/i,
  tragedy: /\b(dies|died|dead|death|deaths|killed|killing|murder\w*|homicide|suicid\w*|overdose|rape\w*|sexual(ly)? assault\w*|abuse\w*|molest\w*|funeral|obituary|memorial|tribute|passed away|cremat\w*|shooting|stabb\w*|fatal\w*|tragic|cancer|hospitali[sz]ed|rehab|addiction|grief|mourn\w*|bulimi\w*|anorexi\w*|sobriety|auschwitz|holocaust|9\/11)\b/i,
  // a "trend" of frightening or chasing children is never an idea to copy
  menace: /\b(terrif\w*|creepy|scary|stalk\w*|chas(e|es|ing)|targets?|targeting)\b.*\b(kids|children|students|schoolkids|teens?|girls?|boys?)\b|\b(kids|children|students|teens?|girls?|boys?)\b.*\b(chased|stalked|terrified|targeted)\b/i,
  unsafe: /\b(dangerous|deadly|lethal|hits out at|warn(s|ed|ing)?|warnings?|authorities|kkk|lynch\w*|nazi\w*|racist|slur|genocide|pedo\w*|porn\w*|onlyfans|nsfw|nude\w*|naked|sex tape|goblin)\b/i,
  // Police or violence: never an idea, even when viral.
  violent: /^(?=.*\b(police|officers?|cops?|deputy|deputies|sheriff|trooper)\b)(?=.*\b(arrest\w*|kick\w*|slam\w*|punch\w*|tas(e|ed|er)|beat\w*|shoot\w*|shot|kill\w*|attack\w*|tackl\w*|drag\w*|chok\w*|brutal\w*|bodycam)\b)|\b(brawl|stabbing|guns?|shooter|weapon|knife|assault\w*)\b/i,
  // Tech companies and their products are business news, not pop culture ("Meta's Muse goes viral").
  techBiz: /\b(layoffs?|economy|inflation|stocks?|meta|openai|chatgpt|anthropic|microsoft|nvidia|samsung|tesla|zuckerberg|altman|nadella|lexus|toyota|walmart|target|costco)\b/i,
  legal: /\b(arrest\w*|charged|charges|indict\w*|sentenced|convicted|trial|lawsuit|sues|sued|court|judge|police|cops|deputy|jail|prison|mugshot|detained|custody)\b/i,
  politics: /\b(anti-[\w-]+ bill|bill (passes|would|to ban)|legislation|lawmakers?|commissioners?|city council|school board|data cent(er|re)s?|trump|biden|vance|obama|mamdani|netanyahu|putin|zelensky|xi jinping|carney|starmer|albanese|congress|senate|senator|sen\.|governor|mayor|mayoral|president|prime minister|gop|democrat\w*|republican\w*|election\w*|midterm\w*|vote|voting|ballot|campaign|immigration|deport\w*|tariff\w*|iran|tehran|israel|gaza|houthis?|hamas|hezbollah|taliban|palestin\w*|ukraine|russia\w*|nato|u\.n\.|labour|tory|tories|parliament|minister|white house|state dinner)\b/i,
  politicsCase: /\b(ICE|UN|MAGA)\b/,
  // A political story is only an idea when it is a physical or meme moment.
  politicalMoment: /\b(flinch\w*|booed|mock\w*|meme\w*|gaffe|stumbl\w*|falls?|fell|trips?|tripped|dances?|dancing|accordion)\b/i,
  hardNews: /\b(earthquake|hurricane|storm|nor'?easter|flood\w*|wildfire|tornado|tsunami|explosion|explosives|terror\w*|bomb\w*|evacuat\w*|outage|inflation|economy|layoffs?|incident|war|missile|strikes?|drones?|military)\b/i,
  sportsDry: /\b(vs\.?|v\.|(?<!tomatoes |audience |critics )scores?|scored|standings|playoffs?|inactive|injur\w*|trade|traded|draft|roster|odds|picks|fantasy|week \d+|game \d+|quarterback|qb|touchdown|coach(es|ing)?|highlights|results|ppv|pay-per-view|comparison|stats?|mvp|season opener|regular season|retire\w*|retirement)\b/i,
  science: /\b(virus|viral (load|dna|rna|infection|shedding|replication|vector)|antiviral|respiratory|vaccin\w*|covid|flu|measles|cdc|study|researchers|scientists|cells?|genom\w*|protein|wastewater)\b/i,
  service: /\b(horoscope|how to (watch|stream|make|get)|where to (watch|stream|livestream)|what time|start time|tv channel|live ?stream(ing)? (link|free)|full list|winners list|updating live|codes?\b|quiz|deals?\b|% off|on sale|shopping|under \$\d+|gift guide|recipe|reviews?\b|recap|box office|ratings|everything we know|what we know|is there an? .* today|who is .*['’]s (wife|husband|girlfriend|boyfriend)|meet (the|his|her)|leaving (netflix|prime video|hulu|max)|coming to|new releases|predictions?|net worth|viewing figures|leaving in \w+|all the (movies|shows)|all about|here'?s what|what to know|things to know|been reported|list revealed|grades|d rating|pure fiction|explained|based on a true story|true story|in order|watch order|ranked|ranking|scores revealed|leaderboard|who went home)\b|^everything\b/i,
  // Questions are dropped unless they are explainers of a trend ("What is the Beckham test?") or "what's going on with".
  question: /^(is|are|does|did|who|what|when|where|how|why|can|should|will)\b.*\?$/i,
  explainer: /^(so )?(what|who|wtf)(['’]s| is| are) .{2,60}|^(so )?what('?s|’s| is| are) (going on|up|happening) with/i,
  evergreen: /(^(these |the )?\d+\s)|\bof all time\b|\bthrowback\b|\bthrough the years\b|\bmost .* moments\b|\byou be the judge\b|\bguess who\b|\bhot shots\b|\bsecrets\b|\bbirdoftheday\b|#\w+|\btheme:|\b\d+ years ago\b|\bon this day\b|\bhappy birthday\b|\banniversary\b|\bappreciation post\b|\b(?:festival|holiday|new year|day|eve)s? (?:celebrated|observed)$/i,
  // Industry and award news: dropped unless something about it went viral.
  industry: /\b(to direct|directing|director|to star|will (?:be )?star(?:ring)?|biopic|casting|cast as|joins|renewed|sequel|prequel|spinoff|trailer|teaser|first look|release date|premiere date|showrunner|studio|acquir\w*|merger|record|audience score|earns praise|critics|acclaim|honou?red|honou?r|humanitarian|wins (an? )?(emmy|grammy|oscar|award)|rating|r-rating|filming|box office|tour dates|lineup|nominat\w*|trade show|tokyo game show|gamescom|comic-con|summer game fest|nintendo direct|state of play|run (?:the )?ads|(?:paid |political )?ads? (?:rejection|policy|ban)|(?:reject|refuse|ban|block)\w* (?:[\w’'‘“”-]+ ){0,3}ads|talent agen\w+|uta agent|caa agent|signs with (?:caa|uta|wme))\b/i,
  // Award-show nights: a reaction or red-carpet moment there is exactly the "Chris Rock slaps Will Smith" kind of item.
  awardShow: /\b(emmys?|oscars?|grammys?|vmas?|golden globes|met gala|red carpet|bafta|brit awards|amas|bet awards|cmas|acm awards)\b/i,
  // Satire recaps and speculative gossip are never an idea.
  satire: /\b(weekend update|cold open|monologue|sketch (mocks|skewers|roasts))\b/i,
  // late-night and SNL political comedy: a recap of satire, not a moment
  satireShow: /\b(snl|saturday night live|kimmel|colbert|fallon|seth meyers|late[- ]night|the daily show)\b/i,
  gossip: /\b(speculat\w*|woman heard|mystery woman|dating rumou?rs?)\b/i,
  // Paparazzi strolls: "kiss" on a walk in Paris is not a moment. Dropped unless the item itself says it went viral.
  paparazzi: /\b(romantic (walk|stroll|getaway|dinner)|pda|hold(s|ing)? hands|spotted|date night|cozy|cosy|packs? on the|turns heads|stuns in|steps out in|style is|leg-lengthening)\b|\byesterday\W*$/i,
  // A restaging of an old meme (a PR stunt at a trade show) is not a new moment unless the restaging itself went viral.
  restage: /\b(recreat\w*|re-creat\w*|reenact\w*|re-enact\w*|restag\w*)\b/i,
  // "A truck driver went viral ... Now it's a museum exhibit": the viral moment is old, the news is its aftermath.
  pastViral: /\b(went|gone|had gone) viral\b.*\b(now|years? (ago|later))\b|\bonce went viral\b|\b(years|months) after (going|it went) viral\b|\bwent viral (in|back in) (19|20)\d\d\b/i,
  // Trend explainers ("What is the X trend? ... explained") are the best proof a format exists, so service/question rules spare them.
  trendWord: /\b(memes?|trends?|challenge|lyrics?|diss(es)?)\b/i,
  // Off-field moment cues for sports stories: the daughter who walks out, the taunt, the blood smear.
  offField: /\b(daughter|son|wife|kid|mimed|mimes|miming|taunt\w*|celebrat\w*|blood|proposal|hug(s|ged)?)\b/i,
  // A Bluesky sports trend is kept only when it is a moment ("flagged for taunting"), not a result.
  sportsMoment: /\b(mimed|mimes|miming|taunt\w*|mock\w*|memes?)\b/i,
  // A stock joke caption on someone else's clip ("Tom Cruise has been real quiet since this stunt dropped"): the name is not in it.
  jokeTitle: /\b(?:has|have) been (?:real|really|awfully|very|mighty|suspiciously|pretty) quiet since\b|\bquiet since this\b/i,
  // An awareness day or observance, not a moment ("Today is the International Day of Sign Languages").
  observance: /^today is\b|\b(?:international|national|world|global) (?:[\w’'-]+ ){0,4}(?:day|week|month)\b/i,
  // A reported decision, not footage: "Prince William rejects Diana film offers", "turns down a role".
  decision: /\b(?:rejects?|rejected|turns? down|turned down|snubs?|snubbed)\s+(?:[\w’'-]+\s+){0,2}(?:offers?|film|movie|deal|role|bid|plan|proposal|request|documentary|invitations?|project|series)\b/i,
  crypto: /\b(meme[ -]?coins?|memecoins?|crypto\w*|tokens?|presale|bybit|solana|bitcoin|btc|ethereum|dogecoin|shiba|airdrop|altcoins?|nfts?|stocks?|nasdaq|trading|price prediction|convert)\b/i,
  cryptoAll: /\b(meme[ -]?coins?|memecoins?|crypto\w*|tokens?|presale|bybit|solana|bitcoin|btc|ethereum|dogecoin|shiba|airdrop|altcoins?|nfts?|stocks?|nasdaq|trading|price prediction|convert)\b/gi,
  // what a title about a meme or a persona says besides its coin ("Who is Jean Phil? AI character behind ... meme coin sparks fake persona trend")
  coinMeme: /\b(who is|memes?|trends?|viral|persona|character|internet|tiktok)\b/i,
  spam: /[+>?]{3,}|\+\+|\?\+|>\?|【|▷|☀️|👙|FULL-?VIDEO|X-VIDEOS?|\[clip!?\]|\bMMS\b|Leaked!|\bFree Mobile App Download\b|\(xxx\b|onlyfans video/i,
  govDomain: /\.gov(\.[a-z]{2})?(\/|$)/i,
  // a university or school host publishing celebrity videos and app downloads is a hijacked domain (vnua.edu.vn)
  eduDomain: /\.(?:edu|ac)(\.[a-z]{2})?(\/|$)/i,
  eduSpam: /\b(video|viral|leak\w*|download|clip|mms|onlyfans|free)\b/i,
};

// Outlets that flood the viral/"internet reacts" searches with rewrites of US stories, and spam domains.
const PUBLISHER_BLOCK = /\b(times of india|timesofindia|indiatimes|news18|ndtv|hindustan times|asianet|india today|indiatoday|telegraph india|telegraphindia|teluguone|indian express|economic times|mashable india|free press journal|dna india|zee news|times now|firstpost|oneindia|news9|livemint|mint|moneycontrol|business standard|deccan|koimoi|filmibeat|bollywood\w*|pinkvilla|inshorts|geo news|tribune\.com\.pk|the statesman|wion|abp|republic world|jagran|india\.com|czechinvest|indulge express|new indian express|sportskeeda|essentiallysports|opindia|the hans india|daily observer|daily-sun|daily sun|dhaka tribune|the daily star|prothom alo|bdnews24|tbsnews|the business standard bd|kalerkantho|jugantor|samakal)\b/i;
// Outlets about the news business itself: a newspaper's subscriber numbers are media-trade trivia, never why a story is big.
const MEDIA_TRADE = /^(?:nieman ?lab|niemanlab\.org|poynter|press gazette|digiday|columbia journalism review|cjr|adweek|mediapost|journalism\.co\.uk|inma)$/i;
// Re-hosts of other outlets' stories count as half an outlet.
const REHOST = /^(aol(\.com)?|yahoo.*|.*\.yahoo\.com|msn(\.com)?|newsbreak|flipboard|inkl|ground news|head topics|headtopics)$/i;
// Local TV/radio and local papers: a story only they carry is local news, not a viral moment.
const LOCAL_OUTLET = /^(?:[WK][A-Z]{2,3}(?:-(?:TV|FM|AM|DT))?|[wk][a-z]{2,3}(?:tv)?\.com)$|^(?:FOX|NBC|ABC|CBS|CW|MY) ?\d+|^(FOX|NBC|ABC|CBS) (?!News\b|Sports\b|Business\b)[A-Z][a-z]+|\b\d+ ?(?:News|Now|Alive)\b|\bNews ?\d+\b|^fox\d+|hoodline|^patch|\brecorder\b|^(?:kare11|wral|wfaa|khou|ktla|wgn)/i;
// British and Irish outlets: a story only they carry (and only British or Irish searches) is regional news to most creators ("John Nellis tops
// the Strictly Come Dancing leaderboard": Wales Online, the Evening Standard, in-Cumbria, a UK search)
// (the national titles, the regionals and any .uk or .ie site: "Emma Willis breaks silence" in the East Anglian Daily Times, Ham & High,
// the Whitehaven News and the New Statesman's Media Mole)
const UK_OUTLET = /^(?:the )?(?:bbc(?:\.com|\.co\.uk| news| sport)?|guardian|independent|telegraph|telegraph\.co\.uk|times|sunday times|sun|the-sun\.com|irish sun|mirror|daily mirror|irish mirror|daily mail|mail online|dailymail\.co\.uk|metro|metro\.co\.uk|evening standard|london evening standard|standard|sky news|sky sports|itv|itv news|itvx|channel 4( news)?|radio times|digital spy|manchester evening news|wales ?online|walesonline\.co\.uk|in-cumbria|news & star|scotsman|daily record|express|daily express|express\.co\.uk|herald|inews|i news|i paper|ipaper|the i paper|gb news|ladbible|unilad|joe|joe\.co\.uk|bristol post|liverpool echo|birmingham mail|chronicle live|belfast telegraph|irish times|irish independent|irish examiner|rte|rté|breakingnews\.ie|the journal|thejournal\.ie|hello!?( magazine)?|ok!?( magazine)?|heart|capital fm|newsnight|pinknews|the national|nottingham post|yorkshire post|leicester mercury|kent online|east anglian daily times|eastern daily press|ham (?:&|and) high|hampstead highgate express|whitehaven news|cotswold journal|media mole|new statesman|the poke|the tab|hitc(?:\.com)?|irishsun\.com|northern echo|edinburgh live|glasgow live|lancs live|cornwall live|devon live|somerset live|kent live|essex live|surrey live|berkshire live|bristol live|birmingham live|nottinghamshire live|dublin live|belfast live|my ?london|express (?:&|and) star|shropshire star|the courier|press (?:&|and) journal|yorkshire evening post|hull daily mail|plymouth herald|oxford mail|daily echo|lancashire telegraph|lancashire evening post|sunderland echo|coventry telegraph|stoke sentinel|derby telegraph|cambridge news|daily star|irish daily star|scottish sun|herald ?scotland|evening times|sunday world|irish news|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.uk|org\.uk|uk|ie))$/i;
// Entertainment, celebrity, gaming and internet-culture publishers: an item from one of them is pop culture wherever it was found.
const ENT_PUBLISHER = /^(the )?(hollywood reporter|variety|deadline|people(\.com)?|e! ?(news|online)?|us weekly|page ?six|pagesix\.com|tmz|just jared|billboard|rolling stone|entertainment weekly|ew(\.com)?|vulture|indiewire|dexerto|know your meme|buzzfeed( news)?|huffpost( uk)?|cosmopolitan(\.com)?|elle|vogue|glamour|harper'?s bazaar|hello!?( magazine)?|ok!?( magazine)?|perez hilton|pitchfork|complex|xxl|hotnewhiphop|the source( magazine)?|imdb|collider|screen ?rant|game ?rant|polygon|kotaku|ign|gamespot|a\.v\. club|avclub\.com|uproxx|decider|primetimer(\.com)?|distractify|bored panda|daily dot|the daily dot|mashable|indy100|unilad|ladbible|the tab|countrychord\.com|them(\.us)?|pedestrian\.tv|popsugar|jezebel|the cut|nme|consequence|stereogum|access hollywood|extra|entertainment tonight|et online|etonline\.com|just jared jr)$/i;
// Families whose items are pop culture by definition.
const POP_FAMS = new Set(['celeb', 'kym', 'bluesky']);
const POP_QUERIES = /^gn-(ent|meme|tiktok|clip)/;

// Subreddits whose top posts are viral clips by definition; other subs need a moment/reaction word as well.
const VIRAL_SUBS = new Set(['popular', 'tiktokcringe', 'outoftheloop', 'publicfreakout', 'mademesmile', 'sipstea', 'nextfuckinglevel']);

// Athlete pages spike on game days, which says little about an off-field viral moment.
const ATHLETE = /\b(football|basketball|baseball|soccer|hockey|player|quarterback|running back|wide receiver|pitcher|coach|athlete|tennis|golfer|boxer|fighter|racing driver|wnba|nba|nfl|mlb|nhl)\b/i;
// Scores and game verbs mark a sports story ("LSU trails Ole Miss 17-0").
const GAME_RE = /\b\d{1,3}-\d{1,3}\b|\b(trails?|trailing|leads?|beats?|defeats?|win over|loss to|halftime|quarter|inning|overtime|sideline|touchdown|jumpers?|open gym|open run|dunks?|layups?|free throws?|three-pointers?|home runs?|homers?|field goals?|hat tricks?|penalty kicks?|goals?|premier league|la liga|man city|man utd|man united|sec|ncaa|college football|gameday)\b/i;
const COLLEGE_RE = /\b(LSU|Ole Miss|Alabama|Clemson|Notre Dame|Ohio State|Michigan|Georgia|Texas A&M|Oregon|USC|UCLA|Penn State|Auburn)\b/;
// Someone in the crowd is not a sports story even at a game.
// Checked on the opening words only, where the subject of a title sits ("Distraught Packers fan ...").
const CROWD_SUBJECT = /^(\S+ ){0,4}(fan|mom|dad|mother|father|spectator|kid|girl|boy|woman|man|couple|wife|husband|staffer|worker|['‘"“]?mom of the year)\b/i;

const US_STATES = `alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana
  iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada
  ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming mass`;
const COUNTRIES = `america usa us uk britain england scotland wales ireland australia canada mexico brazil argentina france germany italy
  spain portugal netherlands belgium sweden norway denmark finland poland greece turkey china japan korea india pakistan
  indonesia philippines vietnam thailand singapore malaysia russia ukraine israel gaza iran iraq egypt nigeria kenya
  africa europe asia albania kosovo colombia chile peru cuba jamaica switzerland austria`;
const CITIES = `york london paris rome tokyo sydney melbourne brisbane perth toronto vancouver montreal chicago boston houston dallas
  austin miami atlanta seattle denver phoenix nashville vegas detroit philadelphia philly brooklyn manhattan hollywood
  berlin madrid barcelona milan dublin glasgow manchester liverpool birmingham auckland dubai mumbai delhi beijing shanghai
  seoul prishtina peja greenfield minneapolis orleans francisco angeles diego jersey hartford knoxville`;
const TEAMS = `cardinals falcons ravens bills panthers bears bengals browns cowboys broncos lions packers texans colts jaguars chiefs
  raiders chargers rams dolphins vikings patriots saints giants jets eagles steelers 49ers niners seahawks buccaneers bucs
  titans commanders hawks celtics nets hornets bulls cavaliers cavs mavericks mavs nuggets pistons warriors rockets pacers
  clippers lakers grizzlies heat bucks timberwolves pelicans knicks thunder magic 76ers sixers suns blazers kings spurs
  raptors jazz wizards diamondbacks braves orioles cubs reds guardians rockies tigers astros royals angels dodgers marlins
  brewers twins mets yankees athletics phillies pirates padres mariners rays rangers nationals bruins sabres flames
  hurricanes blackhawks avalanche oilers canadiens predators devils islanders senators flyers penguins sharks kraken
  blues lightning canucks capitals aces fever lynx liberty mercury storm mystics valkyries sparks sky dream wings arsenal chelsea
  tottenham juventus bayern psg galaxy longhorns volunteers vols crimson tide buckeyes wolverines trojans ducks`;
const PLACES = new Set([...splitList(US_STATES), ...splitList(COUNTRIES), ...splitList(CITIES),
  'new york', 'los angeles', 'las vegas', 'san francisco', 'new orleans', 'new jersey', 'south korea', 'north korea',
  'united states', 'united kingdom', 'new zealand', 'green bay', 'kansas city', 'san diego', 'st louis', 'tampa bay',
  'north america', 'latin america', 'white house', 'the internet']);
const TEAM_WORDS = new Set(splitList(TEAMS));
// Case-sensitive: "Giants" the team, not "giants" the word.
const TEAM_RE = new RegExp(`\\b(${splitList(TEAMS).map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('|')})\\b`);

const PLACE_WORDS = new Set(splitList('new san los las st city county north south east west central northern southern upper lower greater bay village'));
/** True when every word of a name is a place or a team ("texas", "new york knicks", "green bay packers"). */
function isPlaceOrTeam(name) {
  if (PLACES.has(name)) return true;
  const ws = name.split(' ');
  return ws.every((w) => PLACES.has(w) || TEAM_WORDS.has(w) || PLACE_WORDS.has(w));
}

// Role nouns that make a nameless subject specific enough for a headline ("Packers fan", "multitasking mom").
const ROLE_NOUNS = `lookalike mom dad fan grandma grandpa bride groom wrestler worker staffer teacher nurse waiter waitress barista
  toddler baby dog cat bar athlete influencer tiktoker streamer couple student driver passenger customer employee neighbor
  neighbour bartender pilot frenchman actress singer`;
const ROLE_RE = new RegExp(`(^|\\s)([A-Za-z][\\w’'.&-]*) (${splitList(ROLE_NOUNS).join('|')})(?=['’]s\\b|\\b)`, 'gi');
// A quoted phrase (group 1: double quotes, group 2: single): opens after a space/start, closes before a space/end/punctuation.
// An apostrophe followed by a letter stays inside a single-quoted phrase ('That's my husband!').
const QUOTE_RE = /(?:^|[\s(—–-])(?:["“]([^"“”]{3,40}?)["”]|[‘']((?:[^‘’"“”']|[’'](?=\w)){3,40}?)[’'])(?=$|[\s,.:;!?)—–-])/g;

module.exports = { RE, HOOK_STOP, GAME_RE, COLLEGE_RE, PUBLISHER_BLOCK, MEDIA_TRADE, REHOST, LOCAL_OUTLET, UK_OUTLET, ENT_PUBLISHER, POP_FAMS, POP_QUERIES, VIRAL_SUBS, ATHLETE, CROWD_SUBJECT, PLACES, TEAM_WORDS, TEAM_RE, ROLE_RE,
  QUOTE_RE, isPlaceOrTeam, splitList, CITY_LIST: splitList(CITIES) };
