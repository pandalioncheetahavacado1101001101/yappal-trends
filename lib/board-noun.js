'use strict';
/*
 * The board noun (wave 11, IDEAS_BOARD_NOUN): a person's story that only the boards tell so far (posts on the boards where creators'
 * and celebrities' drama is argued, no outlet's headline naming them yet) has no noun its posts say in so many words, so it waits
 * with no title and no line. Its noun is taken from the boards themselves, never guessed:
 *   - a board's own flair names the family (Ban, Leak, Beef or Feud, Apology) on a post that leads with the person (POST_LEAD_WORDS)
 *     and is no joke, question, fan theory, game bit or first-person post; or a Drama or Controversy flair on such a post confirms the
 *     family its own words say about the person, or the claim it reports about them ("<name> responds to <other> claiming he ...").
 *     A Drama tag alone names nothing: "<name> drama" over a post that says no family is a title the title check cannot hold (probes:
 *     it renamed four such rows to words of the post, one over a post where fans fear the worst);
 *   - or two independent boards' posts (two different boards, inside AGREE_HOURS) say the same family about the person.
 * Never a claim one post makes by itself (review, wave 11): only an event a flair names (ban, leak, feud, apology) or a claim the
 * post reports someone else making stands; the same events read from the post's own words keep lib/lines.js rule 8; a family the post
 * asserts (allegations, cheating, a crime, abuse, an arrest, a death, a wrongdoing verb) names nothing unless an outlet's headline in
 * the card says it of the person; an unban, a lifted, reinstated or overturned ban is no ban.
 * The line reports the board, never the claim as fact, the person first as every claim's line has them: "<the post, sentence case>, a
 * post on r/<Board> tagged Drama says." or "..., posts on r/<A> and r/<B> say.", with the person's denial when a headline or a post of
 * the store words one ("; <surname> denies it"). The card then lists only
 * through every gate of lists() (demand, the title and claim rules): rank, never filter.
 *
 * The flair comes from reads the collector already makes (the boards' private record, lib/voices/boards.js, and the mirror's busy-
 * thread titles in the native ledger): +0 requests. Flair is matched to a post by its Reddit id.
 *
 * IDEAS_BOARD_NOUN unset: shadow (lists unchanged; the cycle's log counts what on would list: "[board-noun] would list n (nouns m: flair
 * f, two boards b); shadow"); `on`/`act`/`1`: the noun and the line stand; `0`/`off`: off. Collector only. Pure: no clock, no I/O.
 * needs license: Reddit (post titles and flair: Reddit's RSS and the Arctic Shift mirror); needs permission: Reddit (robots.txt
 * "Disallow: /", read 2026-10-28; this step reads nothing new).
 */
const TN = require('../engine/talk-nouns');
const TL = require('../engine/talk-lines');
const W = require('../engine/wording');

let LINES = null;
const lines = () => { if (!LINES) LINES = require('./lines'); return LINES; };

/** The switch: 'shadow' (unset), 'on', or 'off'. */
function mode(env = process.env) {
  const v = String((env && env.IDEAS_BOARD_NOUN) || '').trim().toLowerCase();
  if (v === 'on' || v === 'act' || v === '1' || v === 'true') return 'on';
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  return 'shadow';
}

const HOUR = 3600e3;
// the boards where creators' and celebrities' drama is argued, by the name the line prints
const BOARDS = new Map([['livestreamfail', 'LivestreamFail'], ['youtubedrama', 'youtubedrama'], ['tiktokgossip', 'tiktokgossip'],
  ['nycinfluencersnark', 'NYCinfluencersnark'], ['beautyguruchatter', 'BeautyGuruChatter'], ['popculturechat', 'popculturechat'], ['fauxmoi', 'Fauxmoi']]);
const POST_DAYS = 2;
const AGREE_HOURS = 48;
const POST_LEAD_WORDS = 5;
const WORDS = [5, 24];
const CHARS_MAX = 200;
// a flair that names the family (emoji shortcodes and emoji are stripped first), or (key null) one that only confirms the post's own family. (A breakup tag names none: the
// title check reads "Breakups and Divorce" in the line as a divorce, and a board's tag is no split. Collector only, wave 11 probes)
const FLAIRS = [
  { re: /^(?:drama|controvers\w*)$/i, key: null, noun: null },
  { re: /^(?:bans?|banned)$/i, key: 'quit', noun: 'ban' },
  { re: /^leaks?$/i, key: 'leak', noun: 'leak' },
  { re: /^(?:beef|feuds?)$/i, key: 'feud', noun: 'feud' },
  { re: /^apolog(?:y|ies)$/i, key: 'apology', noun: 'apology' },
];
// a flair that says the post is a joke, a fan's, a meme or chat: never a noun's voice
const PLAY_FLAIR = /\b(?:funny|humou?r|meme|shitpost|satire|joke|fluff|wholesome|hype|cringe|fan ?art|fanfic|theory|theories|speculation|question|self promo|free talk)\b/i;
// a post about a game or a bit is no news of the person (engine/talking-points.js POST_PLAY), nor a fan's guess or one's own story
const POST_PLAY = /\b(?:gta|rp|roleplay|role-play|role play|in-game|in game|skit|parody|prank|pranked|fake|staged|acting|bit|joke|jokes|joking|meme|memes|theory|theories|speculat\w*|predict\w*|imagine|if|would|could|might|maybe|probably|thoughts|opinions?|unpopular|hot take|ranking|tier list)\b/i;
const FIRST_PERSON = /\b(?:i|i'm|i’m|im|my|me|we|our|us)\b/i;
const LOADED = /\b(?:lul|lol|lmao|wtf|insane|notorious|disgusting|pathetic|clown|scammer|idiot|loser|creep|creepy|psycho|vile|evil|trash|garbage|cringe|serial|predator|pedo\w*|nonce)\b/i;
// someone answering, watching or reviewing someone else's story: the person is an onlooker ("<name> reacts to <other> ...")
const REACTS = /^(?:\s*(?:\(|\[)[^)\]]*(?:\)|\]))?\s*(?:reacts?|responds?|replies|weighs in|watches|reviews|explains|breaks down|talks|comments|discusses|speaks|on|shares|says|calls|asks|defends|mocks|roasts|praises|thanks)\b/i;
// a claim the post reports about the person who answers it: "<name> responds to <other> claiming he funded ..."
const CLAIM_BACK = /\b(?:claim(?:s|ed|ing)?|accus(?:es|ed|ing)|alleg(?:es|ed|ing)|saying|says)\s+(?:that\s+)?(?:he|she|they|him|her)\b/i;
// (review, wave 11: a board post never makes a grave claim a row's title by itself. Only an event a board's own flair names, or a claim
// the post reports someone else making about the person (CLAIM_BACK), stands; a family the post's own words assert stands only for these
// events and keeps lib/lines.js rule 8 (a claim only a post makes); any other family it asserts (allegations, cheating, a crime, abuse,
// an arrest, a death) stands only when an outlet's headline in the card says the same of the person)
const EVENTS = new Set(FLAIRS.filter((x) => x.key).map((x) => x.key));
// (a deed of wrongdoing, a crime or a death a post says in its own words, whether or not a noun family reads it: "<name> stole ...")
const GRAVE_DEED = /\b(?:stole|steals?|stealing|theft|embezzl\w*|cheated|cheats|groom(?:s|ed|ing)|assault(?:s|ed)?|abus(?:e|es|ed|ing|ive)|rap(?:e|ed|ist)|harass\w*|molest\w*|scam(?:s|med)?|defraud\w*|fraud|grop(?:e|ed|ing)|punch(?:es|ed)|slap(?:s|ped)|attack(?:s|ed)|stalk(?:s|ed|ing)|threaten(?:s|ed)|drugged|robb(?:ed|ing)|lied|faked|faking|pedo\w*|predator|arrest(?:s|ed)?|charged|jailed|indicted|died|dies|dead|death|killed|murder\w*|overdos\w*|suicide)\b/i;
// (a ban that ended is no ban: "<name> finally unbanned", "ban lifted", "reinstated", "ban overturned")
const UNBAN = /\b(?:un-?bann?\w*|lift(?:s|ed|ing)?|reinstat\w*|overturn\w*|reversed?|revoked|returns? from (?:(?:a|his|her|their) )?ban|back (?:on|after)|appeal (?:won|granted|succeeds?))\b/i;
const QUESTION = /\?|^(?:is|are|was|were|did|does|do|why|what|who|how|when|where|will|can|should|has|have)\b/i;
// the words a post may put before the person it is about: who they are, never someone else doing something ("Ethan talks about <name>")
const DESCRIBES = new Set(['the', 'a', 'an', 'streamer', 'streamers', 'youtuber', 'tiktoker', 'influencer', 'creator', 'rapper', 'singer', 'actor', 'actress', 'star',
  'host', 'podcaster', 'vtuber', 'twitch', 'kick', 'youtube', 'tiktok', 'instagram', 'former', 'ex', 'famous', 'popular', 'big', 'crewmember', 'member',
  'korean', 'japanese', 'american', 'british', 'canadian', 'australian', 'german', 'french', 'spanish', 'mexican', 'brazilian', 'irish', 'nyc', 'la', 'uk', 'us']);

const keyOf = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordsOf = (s) => keyOf(s).split(' ').filter(Boolean);
const idOf = (r) => (String((r && r.url) || '').match(/\/comments\/([a-z0-9]{5,10})(?:\/|$)/) || [])[1] || null;
/** A flair as the board shows it, emoji and shortcodes off: "Drama:dFace:" -> "Drama". */
const flairText = (f) => String(f || '').replace(/:[\w-]+:/g, ' ').replace(/[^\p{L}\p{N}&/ -]+/gu, ' ').replace(/\s+/g, ' ').trim();
/** The family a flair names: { key, noun } or null. */
function flairFamily(flair) {
  const t = flairText(flair);
  if (!t || PLAY_FLAIR.test(t)) return null;
  const hit = FLAIRS.find((x) => x.re.test(t));
  return hit ? { key: hit.key, noun: hit.noun, flair: t, ...(hit.key ? {} : { confirms: true }) } : null;
}

/** Where the person's name stands in a post's words (whole name, or its last word for a two-word name), or -1. */
function nameAt(ws, subject) {
  const sw = subject.split(' ');
  for (let i = 0; i + sw.length <= ws.length; i++) if (sw.every((w, j) => ws[i + j] === w)) return i;
  return -1;
}

/**
 * Why a post cannot be a board noun's voice for the subject, or null when it can. post: { title, sub, t, flair };
 * o: { subject, now }.
 */
function refusal(post, { subject, now }) {
  if (!post || !post.title) return 'none';
  if (!BOARDS.has(String(post.sub || '').toLowerCase())) return 'not a drama board';
  if (!Number.isFinite(post.t) || now - post.t > POST_DAYS * 24 * HOUR || post.t > now + HOUR) return 'too old';
  const title = String(post.title);
  if (title.length > CHARS_MAX) return 'length';
  const ws = wordsOf(title);
  if (ws.length < WORDS[0] || ws.length > WORDS[1]) return 'length';
  const at = nameAt(ws, subject);
  if (at < 0) return 'not named whole';
  // (a name read with the post's own verb in it is no name: "<name> reacts", "<name> responds")
  if (REACTS.test(subject.split(' ').slice(-1)[0])) return 'a verb in the name';
  if (at >= POST_LEAD_WORDS || ws.slice(0, at).some((w) => !DESCRIBES.has(w))) return 'does not lead with the person';
  // (a one-word name the post carries on with a capitalised word no dictionary spells is someone else's longer name: "Mara Quell ..." is
  // no post about "Mara")
  if (!subject.includes(' ')) {
    const next = (afterName(title, subject).match(/^\s+([\p{L}][\p{L}'’-]*)/u) || [])[1];
    if (next && /^\p{Lu}/u.test(next) && (!W.isTitleCase(title.split(/\s+/)) || !W.inDict(next.toLowerCase()))) return 'part of a longer name';
  }
  if (QUESTION.test(title.trim())) return 'a question';
  if (post.flair && PLAY_FLAIR.test(flairText(post.flair))) return 'a joke or a fan\'s post';
  if (POST_PLAY.test(title)) return 'a bit, a guess or a fan theory';
  if (FIRST_PERSON.test(title.replace(/["“][^"”]*["”]/g, ' '))) return 'first person';
  if (LOADED.test(title)) return 'a loaded word';
  // (the person's own story, never a relative's or someone of theirs: "<name>'s brother ...")
  const own = String(title).match(new RegExp(`${subject.split(' ').slice(-1)[0]}[’']s\\s+(\\p{L}+)`, 'iu'));
  if (own && /^(?:daughter|son|wife|husband|mother|mom|mum|father|dad|sister|brother|family|ex|partner|girlfriend|boyfriend|friend|friends|manager|fans|mod|mods|moderator|editor|lawyer)$/i.test(own[1])) return 'someone else of theirs';
  return null;
}

/** What follows the name in the post's own text ("Dan X Responds to ..." -> " Responds to ..."). */
function afterName(title, subject) {
  const sw = subject.split(' ');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${sw.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s./-]+')}(?:[’']s)?(?![\\p{L}\\p{N}])`, 'iu');
  const m = String(title).match(re);
  return m ? String(title).slice(m.index + m[0].length) : '';
}

/**
 * The family a post says of the person, read from its own words: { key, noun, how } or null. A drama family the post says with the
 * person not an onlooker and the noun not given to someone else; or a claim it reports about the person answering it (allegations).
 */
function wordsFamily(title, subject) {
  const t = String(title);
  const after = afterName(t, subject);
  const reacting = REACTS.test(after);
  if (reacting && CLAIM_BACK.test(after)) return { key: 'allegations', noun: 'allegations', how: 'claim' };
  if (reacting) return null;
  const x = TN.familiesIn(t).filter((y) => (TN.DRAMA_FAMS.has(y.f.key)) && !TN.othersNoun(t, y, subject) && !TN.onlooker(t, y, subject) && !TN.rumoured(t, y) && !otherNamed(t, y, subject))
    .sort((a, b) => b.f.w - a.f.w || a.f.key.localeCompare(b.f.key))[0];
  return x ? { key: x.f.key, noun: x.f.noun(x.surface), how: 'words' } : null;
}

/** Whether the person only answers someone else's story in this post ("<name> reacts to <other> ..."), with no claim about them. */
/** Whether a family's word in a post stands right after another person's two-word name ("... shaken by Orrin Hale attack"). */
function otherNamed(title, x, subject) {
  if (!x || !Number.isFinite(x.index)) return false;
  const before = String(title).slice(0, x.index).trim().split(/\s+/).slice(-3).map((w) => w.replace(/[’']s$/, '').replace(/[^\p{L}\p{N}-]/gu, ''));
  const tail = before.slice(-2);
  const own = new Set(subject.split(' '));
  // (in a Title Case post every word is capitalised: there a name is a word no dictionary spells)
  const titleCase = W.isTitleCase(String(title).split(/\s+/));
  return tail.length === 2 && tail.every((w) => /^\p{Lu}/u.test(w) && (!titleCase || !W.inDict(w.toLowerCase())) && !own.has(w.toLowerCase()));
}
/** A family outside the flairs' events that the post's own words say of the person (a drama family, or a crime, a death, violence), or null. */
function gravePart(title, subject) {
  const t = String(title);
  const x = TN.familiesIn(t).find((y) => (TN.DRAMA_FAMS.has(y.f.key) || y.f.sensitive) && !EVENTS.has(y.f.key) && !TN.othersNoun(t, y, subject) && !TN.onlooker(t, y, subject) && !otherNamed(t, y, subject));
  if (x) return { key: x.f.key, noun: x.f.noun(x.surface), how: 'words' };
  return GRAVE_DEED.test(t.replace(/["“][^"”]*["”]/g, ' ')) ? { key: 'deed', noun: null, how: 'words' } : null;
}
/** Whether an outlet's headline in the card says the family of the person (not of someone else): rows with fam other than 'reddit'. */
function outletSays(rows, key, subject) {
  return (rows || []).some((r) => r && r.fam !== 'reddit' && !r.youtube && !r.far && r.title && nameAt(wordsOf(r.title), subject) >= 0 &&
    TN.familiesIn(String(r.title)).some((y) => y.f.key === key && !TN.othersNoun(String(r.title), y, subject) && !TN.onlooker(String(r.title), y, subject)));
}
const onlookerPost = (title, subject) => { const after = afterName(title, subject); return REACTS.test(after) && !CLAIM_BACK.test(after); };

/**
 * The board noun of a person's card whose rows name them only on boards so far, or null. rows: the card's evidence rows (engine/
 * talking-points.js evidenceOf; board posts are fam 'reddit' with url and sub); o: { subject, now, flairs (Map post id -> flair) }.
 * -> { f (family), noun, count, how ('flair' | 'boards'), posts: [{ id, sub, t, title, flair }], why (refusals counted) }.
 */
function nounOf(rows, { subject, now, flairs = null } = {}) {
  if (!subject || !Array.isArray(rows)) return null;
  const why = {};
  const ok = [];
  for (const r of rows) {
    if (!r || r.fam !== 'reddit') continue;
    const id = idOf(r);
    const flair = (id && flairs && typeof flairs.get === 'function' ? flairs.get(id) : null) || r.flair || null;
    const post = { id, sub: String(r.sub || '').toLowerCase(), t: r.t, title: String(r.title || ''), flair };
    const no = refusal(post, { subject, now });
    if (no) { why[no] = (why[no] || 0) + 1; continue; }
    ok.push(post);
  }
  if (!ok.length) return null;
  // (each post's family: its own words first, else its flair's; an onlooker's post names none, whatever its flair)
  // (src: where the noun came from: 'flair' a flair naming the event, 'claim' a claim the post reports someone else making, 'words' the
  // post's own words, 'outlet' a family the post asserts that an outlet's headline in the card also says)
  const read = ok.map((p) => {
    if (onlookerPost(p.title, subject)) return { p, fam: null, by: 'onlooker' };
    const said = wordsFamily(p.title, subject);
    const fl = flairFamily(p.flair);
    // (a flair on a post whose own words put the drama on someone else is the other's drama: "<name> doesn't remember <other> attack")
    const others = TN.familiesIn(p.title).some((y) => (TN.DRAMA_FAMS.has(y.f.key) || y.f.key === 'death') && (TN.othersNoun(p.title, y, subject) || TN.onlooker(p.title, y, subject) || otherNamed(p.title, y, subject)));
    if (!said && others) return { p, fam: null, by: 'others' };
    // (a grave family the post asserts by itself, whatever its tag says ("<name> dies at 29" tagged Ban): never a noun, unless an
    // outlet says it too)
    const grave = said && said.how === 'claim' ? null : said && !EVENTS.has(said.key) ? said : gravePart(p.title, subject);
    if (grave) return said && grave === said && outletSays(rows, said.key, subject) ? { p, fam: said, by: fl ? 'flair' : 'words', src: 'outlet' } : { p, fam: null, by: 'asserted' };
    const fam = said || (fl && fl.key ? fl : null);
    if (!fam) return { p, fam: null, by: null };
    // (an ended ban is no ban)
    if (fam.key === 'quit' && UNBAN.test(p.title)) return { p, fam: null, by: 'unban' };
    const src = said && said.how === 'claim' ? 'claim' : !said || (fl && fl.key === said.key) ? 'flair' : 'words';
    return { p, fam, by: fl ? 'flair' : 'words', src };
  }).filter((x) => { if (!x.fam && x.by && x.by !== 'onlooker' && x.by !== 'others') why[x.by] = (why[x.by] || 0) + 1; return x.fam; })
    .sort((a, b) => a.p.t - b.p.t || a.p.title.localeCompare(b.p.title));
  if (!read.length) { why.noFamily = ok.length; return { why }; }
  // (two independent boards: two boards' posts inside AGREE_HOURS say the same family of the person)
  for (const a of read) {
    const b = read.find((y) => y.p.sub !== a.p.sub && y.fam.key === a.fam.key && Math.abs(y.p.t - a.p.t) <= AGREE_HOURS * HOUR);
    if (b) return { ...made(a.fam, [a, b], 'boards'), why };
  }
  // (or a board's own flair names it)
  const fl = read.find((x) => x.by === 'flair');
  if (fl) return { ...made(fl.fam, [fl], 'flair'), why };
  why.oneBoard = read.length;
  return { why };
}
function made(fam, xs, how) {
  const f = TN.FAMILY.get(fam.key);
  if (!f) return {};
  return { f, noun: fam.noun, count: xs.length, how, claim: fam.how === 'claim', posts: xs.map((x) => ({ ...x.p, by: x.by, src: x.src })) };
}

/** The post's words as the line tells them: no tag in brackets, no trailing stop, sentence case, the name as the card spells it. */
function plain(title, subject, surface, lex) {
  let s = String(title).replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, '\'').replace(/[.…!\s]+$/, '').replace(/\s+/g, ' ').trim();
  // (a Title Case post is made plain word by word: a word a dictionary spells goes small, a name keeps its capital, "Responds to Orrin
  // Hale Claiming He Funded ..." -> "responds to Orrin Hale claiming he funded ...", never a name made small by the corpus)
  // (a surname a dictionary spells keeps its capital after a name: "Orrin Hale")
  if (W.isTitleCase(s.split(' '))) {
    const ws = s.split(' ');
    const name = (k) => !!k && (!W.inDict(k) || W.isFirstName(k));
    s = ws.map((w, i) => {
      const k = w.toLowerCase().replace(/[^\p{L}]/gu, '');
      const prev = i > 0 ? ws[i - 1].toLowerCase().replace(/[^\p{L}]/gu, '') : '';
      const prev2 = i > 1 ? ws[i - 2].toLowerCase().replace(/[^\p{L}]/gu, '') : '';
      // (a lone given name before it: the word is its surname; after a whole name it is the post's own word again)
      const surname = i > 1 && name(prev) && /^\p{Lu}/u.test(ws[i - 1]) && !/[,.;:’']s?$/.test(ws[i - 1]) && !(name(prev2) && /^\p{Lu}/u.test(ws[i - 2]));
      const keep = i === 0 || !k || name(k) || /^\p{Lu}{2,}$/u.test(w.replace(/[^\p{L}]/gu, '')) || surname;
      return keep ? w : w.toLowerCase();
    }).join(' ');
  }
  s = TN.sentenceLine(s, null, false);
  if (surface) s = TN.recaseName(s, subject, surface);
  return TL.tidyLine(s);
}

/**
 * The card's line from its board noun, reported: "<post>, a post on r/<Board> tagged <Flair> says." / "<post>, posts on r/<A> and r/<B>
 * say."; the person's denial a headline or a post words appended; or { what: null } when the account fails the claim check.
 * bn: nounOf's result; rows: the card's evidence rows (for a denial); o: { subject, surface, lex, title }.
 */
function lineOf(bn, rows, { subject, surface = null, lex = null, title = null } = {}) {
  if (!bn || !bn.f || !bn.posts || !bn.posts.length) return null;
  const first = bn.posts[0];
  const text = plain(first.title, subject, surface, lex);
  const boards = [...new Set(bn.posts.map((p) => BOARDS.get(p.sub) || p.sub))];
  const where = bn.how === 'boards' ? `posts on r/${boards[0]} and r/${boards[1]} say` :
    `a post on r/${boards[0]}${first.flair && first.by === 'flair' ? ` tagged ${flairText(first.flair)}` : ''} says`;
  const name = surface ? surface.split(' ').slice(-1)[0] : subject.split(' ').slice(-1)[0];
  let denial = null;
  let denialRow = null;
  if (TN.DENIABLE.has(bn.f.key) || bn.claim) {
    for (const d of rows || []) {
      if (!d || !d.title || d.youtube || d.far) continue;
      const clause = TN.denialClause(TN.cleanHeadline(d.title, d.outlet), subject, null, name);
      if (clause) { denial = clause; denialRow = d; break; }
    }
  }
  const what = `${text}, ${where}${denial ? `; ${denial}` : ''}.`;
  const sources = [...bn.posts.map((p) => ({ text: p.title, type: 'post', outlet: `r/${BOARDS.get(p.sub) || p.sub}`, t: p.t })),
    ...(denialRow ? [{ text: TN.cleanHeadline(denialRow.title, denialRow.outlet), type: denialRow.fam === 'reddit' ? 'post' : 'outlet', outlet: denialRow.outlet || 'Reddit', t: denialRow.t }] : [])];
  const check = lines().checkLine({ line: `${text}${denial ? `; ${denial}` : ''}.`, title: title || `${surface || subject} ${bn.noun}`, subject, family: bn.f.key, sources, denied: !!denial, kind: 'headline', headline: null });
  // (the account is the board's: an event its flair names, a claim it reports someone else making, or what an outlet says too, is
  // reported by "says" itself (rules 8 and 11 give way); a noun read from the post's own words keeps rule 8; any other failure refuses)
  const reported = bn.posts.every((p) => p.src === 'flair' || p.src === 'claim' || p.src === 'outlet');
  if (!check.ok && !check.failures.every((x) => (reported && x.rule === 8) || x.rule === 11)) return { what: null, failures: check.failures.map((x) => x.rule) };
  return { what, trace: bn.posts.map((p) => ({ source: `r/${BOARDS.get(p.sub) || p.sub}`, t: p.t, text: p.title })), denied: !!denial };
}

// what each audience's last build would list (engine/talking-points.js): read once by the cycle for its log line, then cleared
let REPORTS = new Map();
const report = (audience, r) => { REPORTS.set(String(audience || 'US'), r); };
const takeReports = () => { const out = REPORTS; REPORTS = new Map(); return out; };
/** The cycle's log line: counts only (the job's log is public). */
function logLine(reports, main = 'US') {
  const r = reports.get(main) || [...reports.values()][0];
  if (!r) return null;
  return `[board-noun] ${r.mode === 'on' ? 'listed' : 'would list'} ${r.would} (nouns ${r.made}: flair ${r.flair}, two boards ${r.boards}; lines ${r.lines}, ${r.passed} passing lists()); ${r.mode}`;
}

/** The flair of each post id the collector's own reads hold: the boards' record (lib/voices/boards.js state) and ledger posts. */
function flairsOf(boardsState, ledgerPosts = []) {
  const m = new Map();
  for (const [id, p] of Object.entries((boardsState && boardsState.posts) || {})) if (p && p.flair) m.set(id, String(p.flair));
  for (const p of ledgerPosts || []) if (p && p.id && p.flair && !m.has(p.id)) m.set(String(p.id), String(p.flair));
  return m;
}

module.exports = { mode, flairText, flairFamily, refusal, wordsFamily, onlookerPost, outletSays, gravePart, nounOf, lineOf, flairsOf, report, takeReports, logLine, idOf, BOARDS, FLAIRS, EVENTS, UNBAN };
