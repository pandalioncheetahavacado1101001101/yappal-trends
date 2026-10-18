'use strict';
/*
 * What joins the talking points at its own heat [talking-points.js]: the month's TikTok crazes (NewEngen's page), the listed words and
 * crazes of "Words & trends", the moments whose headline puts a talking-point noun after its subject, and Know Your Meme's memes of
 * the week (a meme entry, an explainer or a weekly roundup naming it, with a second signal: "Jean Phil", "Tony Stark looking").
 * Plain string/regex/arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const TN = require('./talk-nouns');
const { keyOf, mentions, DAY, WINDOW_DAYS } = require('./talk-candidates');

const { words } = W;
// the card's 0-100 heat from its score: smooth and never clipped, so the top of the list keeps its order (a score of 10 reads 63, 20
// reads 86, 30 reads 95)
const HEAT_SPAN = 10;
const heatNumber = (score) => Math.round(100 * (1 - Math.exp(-Math.max(0, score) / HEAT_SPAN)));

const capFirst = (w) => `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
/**
 * How the texts print a name's later words where they name it whole, mid-line ("Fat Bear Week is here", "dressed as the Cat in the Hat"):
 * per word, true (capitalised), false (lowercase) or null (no say: not named whole, or as often each way).
 */
function phraseCase(ws, texts) {
  const keys = ws.map((w) => words(w).join(''));
  if (ws.length < 2 || keys.some((k) => !k)) return ws.map(() => null);
  const cap = ws.map(() => 0);
  const low = ws.map(() => 0);
  for (const t of texts) {
    const toks = t.split(/\s+/).filter(Boolean);
    const tk = toks.map((x) => words(x).join(''));
    for (let j = 0; j + ws.length <= toks.length; j++) {
      if (!keys.every((k, i) => tk[j + i] === k)) continue;
      for (let i = 1; i < ws.length; i++) {
        const core = toks[j + i].replace(/^[^\p{L}\p{N}]+/u, '');
        if (/^\p{Lu}/u.test(core)) cap[i] += 1;
        else if (/^\p{Ll}/u.test(core)) low[i] += 1;
      }
    }
  }
  return ws.map((_, i) => (cap[i] > low[i] ? true : low[i] > cap[i] ? false : null));
}
/**
 * A word's, craze's or meme's name in sentence case, as the texts naming it print it ("Black cat clapping", "Fat Bear Week", "Cat in
 * the Hat"): the first word capitalised; a later word kept when it is all capitals ("AI"); else as the texts print the whole name
 * mid-line; else kept as a given name's surname ("Tony Stark looking"), capitalised where the texts print it so mid-line (TN.caseMap),
 * kept when it is no dictionary word ("McDouble", "Wawaluigi"), and lowercase as any other dictionary word. A Title Case text has no say.
 * own(w, i): a spelling the caller keeps first (a craze page's own: "Be OK", "Patient Zero"), else null.
 */
function caseName(name, texts, own = () => null, described = false) {
  const ws = String(name || '').trim().split(/\s+/).filter(Boolean);
  const plain = (texts || []).filter(Boolean).filter((t) => !W.isTitleCase(t.split(/\s+/)));
  const said = phraseCase(ws, plain);
  const caps = TN.caseMap(plain);
  return ws.map((w, i) => {
    const x = own(w, i);
    if (x) return x;
    if (i === 0) return capFirst(w);
    if (/^\p{Lu}{2,}$/u.test(w)) return w;
    // (a name its own meaning uses as plain words is a description, whatever the press capitalises: "Black cat clapping")
    if (described && W.inDict(words(w).join('')) && !W.isFirstName(words(w).join(''))) return w.toLowerCase();
    if (said[i] !== null) return said[i] ? capFirst(w) : w.toLowerCase();
    if (W.isFirstName(words(ws[i - 1]).join(''))) return w;
    const k = words(w).join('');
    if (caps.has(k)) return capFirst(w);
    return k && W.inDict(k) && !W.isFirstName(k) ? w.toLowerCase() : w;
  }).join(' ');
}
/**
 * A name its own meaning uses as plain words: two of its words in a row, lowercase, mid-line ("... an AI-generated video of a black
 * cat" for "Black Cat Clapping"; never "Fat Bear Week", whose meaning only says "fattest bear").
 */
function descriptive(name, meaning) {
  const ks = String(name || '').trim().split(/\s+/).map((w) => words(w).join(''));
  const toks = String(meaning || '').split(/\s+/).filter(Boolean);
  const low = (t) => /^\p{Ll}/u.test(t.replace(/^[^\p{L}\p{N}]+/u, ''));
  for (let j = 1; j + 1 < toks.length; j++) {
    for (let i = 0; i + 1 < ks.length; i++) {
      if (ks[i] && ks[i + 1] && low(toks[j]) && low(toks[j + 1]) && words(toks[j]).join('') === ks[i] && words(toks[j + 1]).join('') === ks[i + 1]) return true;
    }
  }
  return false;
}
/**
 * A quote too long or too broken to search ("Verity's from Minecraft, he belongs to Backrooms", "Happy day, Ronaldo day": a comma, or
 * more than QUOTE_MAX_WORDS words) is named by the names in it: its first and last ("Verity Backrooms"), or the clause its one name is
 * in ("Ronaldo day"); null for a name that is fine as it is, or a quote with no name.
 */
const QUOTE_MAX_WORDS = 4;
function shortTerm(term) {
  const t = String(term || '').trim();
  const ws = t.split(/\s+/).filter(Boolean);
  if (!t.includes(',') && ws.length <= QUOTE_MAX_WORDS) return null;
  const bare = (w) => w.replace(/[’']s$/, '').replace(/[^\p{L}\p{N}-]/gu, '');
  // (a capitalised word past the first; the first only when it owns something, "Verity's", or is no dictionary word)
  // (the pronoun is no name: "Brother, may I have some oats" was titled "I meme" on the first joined run, 2026-10-11)
  const isName = (w, i) => /^\p{Lu}/u.test(bare(w)) && bare(w).length > 1 && (i > 0 ? !W.inDict(bare(w).toLowerCase()) || W.isFirstName(bare(w).toLowerCase()) : /[’']s$/.test(w) || !W.inDict(bare(w).toLowerCase()));
  const names = [...new Set(ws.filter(isName).map(bare))];
  if (!names.length) return null;
  if (names.length >= 2) return `${names[0]} ${names[names.length - 1]}`;
  const clause = t.split(/,\s*/).find((c) => c.split(/\s+/).map(bare).includes(names[0])) || names[0];
  return clause.split(/\s+/).length <= 3 ? clause.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}’'-]/gu, '')).join(' ') : names[0];
}
/** A "Words & trends" entry's name as a card shows it: in sentence case, by its own why-now headline and meaning ("Black cat clapping"); a quote too long to search by its names, as a meme ("Verity Backrooms meme"). */
const wordName = (w) => {
  const term = String(w.term || '').trim();
  const short = shortTerm(term);
  return short ? `${short} meme` : caseName(term, [w.whyNow, w.meaning], () => null, descriptive(term, w.meaning));
};

/**
 * A meaning or an entry's first sentence as a card's one plain line: a clause's date is left out ("popularized through a September 2026
 * fan art trend" -> "popularized through a fan art trend"), and the clause with it when little else is said ("who emerged in mid-to-late
 * September 2026"); a second sentence spliced on with a comma ends it, kept as a clause when it says how the clip is used ("... of a
 * black cat, the cat is used to represent ..." -> "..., used to represent ..."); one over LINE_MAX_WORDS words ends at its first comma
 * past LINE_MIN_WORDS words that leaves no quote open; a writer's filler is left out ("remixable", "meme and trend", "their respective");
 * a fragment gets its verb ("A viral animated video showing ..." -> "... shows ..."); and a bare definition of a short name says what it
 * defines ("Malfoid is a nickname for ...", the name without the kind word the definition repeats: "Celebrity lookalike is a viral
 * trend ..."); always a sentence with a full stop.
 * name: the card's name as its title spells it, or null.
 */
const LINE_MAX_WORDS = 20;
const LINE_MIN_WORDS = 10;
const LINE_KIND_TAIL = /\s+(trend|meme|challenge)$/i;
const LINE_NAME_WORDS = 3;
const LINE_YEAR = /\b(?:19|20)\d\d\b/;
const LINE_WHO_TAIL = /\s+(?:who|which|that)\s+[^,]*$/i;
const LINE_SPLICE = /^(?:the|it|its|it['’]s|they|he|she|this|these|those)\s/i;
const LINE_ARTICLE = /^(An?|The)\s+(\S)/;
// (how the clip is used, spliced on as a second sentence: "the cat is used to represent someone applauding bad behavior")
const LINE_USAGE = /^(?:the|it|they|this|these|those)\s+(?:\w+\s+){0,2}?(?:is|are)\s+(used\s+(?:to|for|as|when|by)\b.*)$/i;
const LINE_USAGE_MAX_WORDS = 26;
// (when it began is the badge's to say: "a September 2026 fan art trend" -> "a fan art trend")
const LINE_DATE = /\s*\b(?:(?:in|during|since|from|around)\s+)?(?:(?:early|mid|late|mid-to-late|early-to-mid)[- ]+)?(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?(?:19|20)\d\d\b/gi;
const LINE_DATED_MIN_WORDS = 4;
// (a writer's filler: "An remixable green-screen meme and trend" -> "A green-screen meme")
const LINE_FILLER = [[/\bremixable\s+/gi, ''], [/\bmeme and trend\b/gi, 'meme'], [/\btrend and meme\b/gi, 'trend'], [/\btheir respective\b/gi, 'their']];
// (a fragment with no verb of its own: "A viral animated video showing ..." -> "... shows ...", "Memes based on ..." -> "Memes are based on ...")
const LINE_PARTICIPLE = /^((?:An?|The)\s+(?:[\p{L}\p{N}-]+\s+){1,4}?)(showing|featuring|depicting|capturing)\b/u;
const LINE_FINITE = { showing: 'shows', featuring: 'features', depicting: 'depicts', capturing: 'captures' };
const LINE_PLURAL_BASED = /^(\p{Lu}[\p{L}]+s)\s+(based on|inspired by|taken from|made from)\b/u;
const count = (x, re) => (x.match(re) || []).length;
const quotesClosed = (x) => count(x, /“/g) === count(x, /”/g) && count(x, /‘/g) <= count(x, /’/g) && count(x, /"/g) % 2 === 0;
function plainLine(name, text) {
  let raw = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  for (const [re, to] of LINE_FILLER) raw = raw.replace(re, to);
  if (!raw) return null;
  const kept = [];
  let usage = null;
  const clauses = raw.split(/,\s+/);
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i];
    if (i > 0 && LINE_SPLICE.test(c) && quotesClosed(kept.join(', '))) {
      const used = c.match(LINE_USAGE);
      if (used) usage = used[1];
      break;
    }
    const tail = c.match(LINE_WHO_TAIL);
    if (tail && LINE_YEAR.test(tail[0])) kept.push(c.slice(0, tail.index));
    else if (i === 0 || !LINE_YEAR.test(c)) kept.push(c);
    else {
      // (the clause without its date, when it still says something: "popularized through a fan art trend")
      const undated = c.replace(LINE_DATE, '').replace(/\s+/g, ' ').trim();
      if (undated.split(' ').length >= LINE_DATED_MIN_WORDS) kept.push(undated);
    }
  }
  const upTo = (k) => kept.slice(0, k).join(', ');
  let n = kept.length;
  if (upTo(n).split(' ').length > LINE_MAX_WORDS) {
    const cut = kept.findIndex((_, i) => upTo(i + 1).split(' ').length >= LINE_MIN_WORDS && quotesClosed(upTo(i + 1)));
    n = cut < 0 ? n : cut + 1;
  }
  let out = upTo(n);
  // (how it is used ends the line when there is room: what a creator does with it)
  if (usage && `${out}, ${usage}`.split(' ').length <= LINE_USAGE_MAX_WORDS && quotesClosed(out)) out = `${out}, ${usage}`;
  out = out.replace(LINE_PARTICIPLE, (m, lead, verb) => `${lead}${LINE_FINITE[verb.toLowerCase()]}`).replace(LINE_PLURAL_BASED, '$1 are $2');
  const named = String(name || '').trim();
  // (the kind word the definition says itself is said once: "Celebrity lookalike is a viral trend ...")
  const tail = named.match(LINE_KIND_TAIL);
  const said = tail && new RegExp(`\\b${tail[1]}\\b`, 'i').test(out.split(' ').slice(0, 5).join(' ')) ? named.replace(LINE_KIND_TAIL, '') : named;
  const art = out.match(LINE_ARTICLE);
  // (a bare definition of a short name says what it defines: "A nickname for ..." -> "Malfoid is a nickname for ...")
  if (art && said && said.split(/\s+/).length <= LINE_NAME_WORDS && !out.toLowerCase().includes(said.replace(/[“”]/g, '').toLowerCase())) {
    // ("An remixable": the article as the next word wants it)
    const a = art[1].toLowerCase() === 'the' ? 'the' : /^[aeio]/i.test(art[2]) ? 'an' : 'a';
    out = `${said} is ${a} ${out.slice(art[1].length).trim()}`;
  }
  return `${out.charAt(0).toUpperCase()}${out.slice(1)}.`;
}

/**
 * The month's TikTok crazes (NewEngen's monthly page, talk-sources.js crazeRows): the formats a creator can film today ("Pumpkin head
 * illusion", "Ramalama costume walk"), at most CRAZE_MAX, at a heat from their place on the page, a format new this month over a
 * carry-over, and the headlines that name it as a trend this week (verified: "What is TikTok's pumpkin head trend?"). Rising only
 * with a headline in the last three days; fading once no headline named it for CRAZE_STALE_DAYS on a page older than that (the page's
 * date is when it was written, not when the craze began). Titled in sentence case (caseName, by the headlines naming it; a word the
 * page capitalises outside the format's name stays so: "Patient Zero"), with "trend" after a name that does not say what it is ("Two
 * fishes trend").
 */
// (Collector: every format of the month's page has its row, the weaker ones under "Show more": decision 9, sounds and formats)
const CRAZE_MAX = 8;
const CRAZE_BASE = 4.5;
const CRAZE_RANK_STEP = 0.05;
const CRAZE_CARRY = 0.85;
const CRAZE_UNVERIFIED = 0.65; // one blog's word: below every craze a headline names as a trend ("Two Fishes")
const CRAZE_NEWS_W = 0.5;
const CRAZE_NEWS_MAX = 2;
const CRAZE_STALE_DAYS = 7;
const CRAZE_ORIGIN_DAYS = 45;
const CRAZE_COINED_MIN = 6;
const CRAZE_KIND = /\b(?:trend|challenge|meme|dance|sound|audio|filter|illusion|walk|prank|edit|reveal|roast|transition|lip ?sync)s?$/i;
const CRAZE_CONTEXT = /\b(?:trend\w*|tiktok|viral|meme|challenge|audio|sound|filter|edit)\b/i;
const CRAZE_GENERIC = new Set(['trend', 'challenge', 'meme', 'dance', 'sound', 'audio', 'filter', 'illusion', 'walk', 'edit', 'day', 'the', 'a', 'an', 'tiktok']);
function crazeTitle(name, about, headlines = []) {
  const ws = name.split(/\s+/);
  const nameRe = new RegExp(ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi');
  // (the page's own spelling of an all-caps word in the name: "Be OK")
  const said = (String(about || '').match(new RegExp(nameRe.source, 'i')) || [''])[0].split(/\s+/);
  const rest = String(about || '').replace(nameRe, ' ');
  const kept = (w) => new RegExp(`(?<![.!?]\\s)(?<=\\s|[“"‘'(])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(rest);
  // (the rest as the headlines naming it print it: the page capitalises every name it lists, "Stop the Wedding")
  const title = caseName(name, headlines, (w, i) => (/^\p{Lu}{2,}$/u.test(said[i] || '') ? said[i] : i > 0 && kept(w) ? w : null));
  return CRAZE_KIND.test(title) || ws.length > 4 ? title : `${title} trend`;
}
/** A craze that is a sound people film to: the page calls it an audio, a sound or a song ("Two Fishes is a viral audio ..."), or its name says so. */
function crazeIsAudio(name, about) {
  const src = String(name || '').split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`^(?:the )?${src}\\s+is\\s+(?:the|a)\\s+(?:\\w+\\s+){0,2}(?:audio|sound|song)\\b`, 'i').test(String(about || '')) || CRAZE_SOUND_NAME.test(String(name || ''));
}
const CRAZE_SOUND_NAME = /\b(?:sound|audio)s?$/i;
/**
 * A craze's line: the page's sentence that says what people do on camera ("Creators hold a real pumpkin right up to the lens so it
 * swallows their friend's head ..."), else the one naming whose audio it is, else its first; the craze's name as the card's title
 * spells it, and never a sentence leaning on a "his" or "her" it does not name.
 */
const CRAZE_DOING = /\b(?:creators?|people|everyone|couples|users|brides|fans|the camera)\b[^.]*?\b(?:hold|film|cut|post|use|using|lip-?sync|danc|walk|stalk|pose|spin|record|shar|pair|swap|edit|put|stay|pull|turn)\w*/i;
const CRAZE_SOURCE = /\b(?:it['’]s|from|by)\s+(?:\p{Lu}[\p{L}'’]+\s+){1,3}/u;
function crazeLine(c, title) {
  const about = String(c.about || '');
  const sentences = (about.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [about]).map((x) => x.trim()).filter(Boolean);
  if (!sentences.length) return null;
  const scoreOf = (x, i) => (CRAZE_DOING.test(x) ? 2 : 0) + (CRAZE_SOURCE.test(x) ? 1 : 0) + (i === 0 ? 0.5 : 0) - (/\b(?:his|her)\b/i.test(x) && !/\p{Lu}\p{Ll}+\s+\p{Lu}/u.test(x) ? 2 : 0) -
    (x.split(/\s+/).length > 30 || x.split(/\s+/).length < 6 ? 1 : 0);
  const best = sentences.map((x, i) => ({ x, s: scoreOf(x, i), i })).sort((a, b) => b.s - a.s || a.i - b.i)[0].x;
  // (the craze's name as the title spells it: "The pumpkin head illusion is back ...")
  const name = title.replace(/\s+trend$/, '');
  // (only where the sentence opens with it: "having two fishes" inside the joke is no name)
  const re = new RegExp(`^(the\\s+)?${c.name.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\b`, 'i');
  // (after "The" the name keeps the title's case past its first letter: "The pumpkin head illusion", "The Ramalama costume walk")
  const out = best.replace(re, (m, the) => (the ? `${the}${/^\p{Lu}\p{Ll}+\s+\p{Ll}/u.test(name) && !/^\p{Lu}/u.test(m.slice(the.length + 1, m.length).replace(/^\S+\s*/, '')) ? name.charAt(0).toLowerCase() + name.slice(1) : name}` : name));
  // ("It's Corbin Mims ... calmly explaining ...": whose audio it is, said as a sentence about the sound; a nickname in passing left
  // out: "..., aka CorbinGPT, calmly explaining ...")
  const told = out.replace(/^it['’]s\s+/i, 'The sound is ').replace(/,\s+(?:aka|a\.k\.a\.|also known as)\s+[^,]+,\s+/i, ' ');
  return told.charAt(0).toUpperCase() + told.slice(1);
}
/**
 * A craze's or meme's own demand, the way the talking points weigh it [talking-points.js heatOf]: its own name search's outlets and
 * creators' uploads, and the YouTube completions people only lately type after its name. look: its store lookup ({ tpnews, tpyt }) or
 * null; re: what a row must say to be about it, context: and what else (a craze's row calls it a trend); since: the window's start.
 */
function ownDemand(look, re, since, now, context = null) {
  const rows = ((look && look.tpnews && look.tpnews.rows) || []).filter((r) => r.t >= since && r.t <= now + DAY && (!re || re.test(r.title)) &&
    (!context || context.test(r.title)));
  const uploads = rows.filter((r) => /^youtube$/i.test(r.publisher || '')).length;
  const outlets = new Set(rows.filter((r) => !/^youtube$/i.test(r.publisher || '')).map((r) => String(r.publisher || '').toLowerCase())).size;
  const comps = (look && look.tpyt && look.tpyt.completions) || [];
  // (YouTube completes almost any name; the ones it marks as only lately typed are the demand)
  const fresh = comps.filter((x) => x.fresh).length;
  const score = OWN_PRESS_W * Math.log2(1 + outlets) + OWN_CREATORS_W * Math.log2(1 + uploads) + OWN_FRESH_W * Math.min(OWN_FRESH_MAX, fresh);
  return { score, outlets, uploads, typed: comps.length, fresh };
}
const OWN_PRESS_W = 0.3;
const OWN_CREATORS_W = 0.9;
const OWN_FRESH_W = 0.3;
const OWN_FRESH_MAX = 4;
// a format any creator can film today, as a creators' own world is to a story: the short-form audience's own (talking-points.js NATIVE_BONUS)
const FILMABLE_BONUS = 1;
/** A craze's name search: its name as the page prints it, lowercase ("pumpkin head illusion"). */
const crazeSearchName = (c) => keyOf(c.name);
/** The crazes the run searches by name: the page's first CRAZE_LOOKUP_MAX. */
const crazeLookupNames = (crazes) => (crazes || []).filter((c) => c.name && c.name.split(/\s+/).length <= 5).sort((a, b) => (a.rank || 99) - (b.rank || 99))
  .slice(0, CRAZE_LOOKUP_MAX).map(crazeSearchName);
const CRAZE_LOOKUP_MAX = 6;

function crazePoints(crazes, { items, lookups, now }) {
  const held = [...(items || []).filter((i) => i.fam !== 'reddit').map((i) => ({ title: i.title, t: i.t, outlet: i.outlet })),
    ...[...(lookups ? lookups.values() : [])].flatMap((l) => [...((l.tpnews && l.tpnews.rows) || []).map((r) => ({ title: r.title, t: r.t, outlet: r.publisher })),
      ...((l.deep && l.deep.rows) || []).map((r) => ({ title: r.title, t: r.t, outlet: r.publisher })),
      ...(l.since ? [...(l.since.recent || []), ...(l.since.titles || [])].map((r) => ({ title: r.title, t: r.t, outlet: r.label })) : [])])];
  const rows = held.filter((r) => r.t >= now - WINDOW_DAYS * DAY && r.t <= now + DAY);
  // (when the press first named a format: looked for further back than the week it is weighed by, since a format on this month's
  // page began last month at the earliest and its first explainer is often its oldest headline in hand)
  const earlier = held.filter((r) => r.t >= now - CRAZE_ORIGIN_DAYS * DAY && r.t <= now + DAY);
  return (crazes || []).filter((c) => c.name && c.name.split(/\s+/).length <= 5).map((c) => {
    const core = words(c.name).filter((w) => !CRAZE_GENERIC.has(w));
    // (a coined word in a format's name names it on its own: "What Is the 'Ramalama' TikTok Song?" is about the "Ramalama Costume
    // Walk", where a name of plain words needs all of them, "Stop the Wedding". Collector only, 2026-10-12: the page's second format
    // counted as one blog's word, under the cut, while an explainer and its searches were in hand)
    const coined = core.filter((w) => w.length >= CRAZE_COINED_MIN && !W.inDict(w) && !W.isFirstName(w));
    const re = core.length ? new RegExp(`\\b(?:${[core.join('\\W+'), ...(coined.length && core.length > 1 ? [coined[0]] : [])].join('|')})\\b`, 'i') : null;
    // (when the press first named it, read by the name as the page prints it, the small words inside it too: "Stop the Wedding" is
    // named by "‘Stop the Wedding’ trend has ...", where its two own words side by side, "stop wedding", are in no headline.
    // Collector only, 2026-10-12. For the start alone: what a format is WEIGHED by is still `re`, because a format's heat is its
    // share of the hottest format's, and one more verified format re-ranks every other; that is a change to make on a second day)
    const printed = words(c.name);
    while (printed.length > 1 && CRAZE_GENERIC.has(printed[0])) printed.shift();
    while (printed.length > 1 && CRAZE_GENERIC.has(printed[printed.length - 1])) printed.pop();
    const whole = printed.filter((w) => !CRAZE_GENERIC.has(w)).length === core.length && printed.length > core.length ? printed.join('\\W+') : null;
    const reDated = whole ? new RegExp(`\\b(?:${whole})\\b`, 'i') : null;
    const named = re ? [...new Map(rows.filter((r) => re.test(r.title) && CRAZE_CONTEXT.test(r.title)).map((r) => [keyOf(r.title), r])).values()] : [];
    const namedT = re ? Math.min(Infinity, ...earlier.filter((r) => (re.test(r.title) || (reDated && reDated.test(r.title))) && CRAZE_CONTEXT.test(r.title)).map((r) => r.t)) : Infinity;
    const age = Math.max(0, (now - (c.updated || now)) / DAY);
    // its own name search: outlets, creators' uploads, what people type after its name
    // (a row about it as a trend: "be ok" is in every other headline)
    const own = ownDemand(lookups ? lookups.get(`talk-${crazeSearchName(c).replace(/[^a-z0-9]/g, '')}`) : null, re, now - WINDOW_DAYS * DAY, now, CRAZE_CONTEXT);
    // (a format no headline names as a trend yet counts for less: the page alone is one blog's word)
    const fade = Math.pow(0.5, Math.max(0, age - CRAZE_STALE_DAYS) / CRAZE_STALE_DAYS);
    const score = (CRAZE_BASE * Math.max(0.5, 1 - CRAZE_RANK_STEP * ((c.rank || 1) - 1)) * (c.fresh ? 1 : CRAZE_CARRY) * (named.length || own.outlets || own.uploads ? 1 : CRAZE_UNVERIFIED) +
      CRAZE_NEWS_W * Math.min(CRAZE_NEWS_MAX, named.length) + own.score + FILMABLE_BONUS) * fade;
    const title = crazeTitle(c.name, c.about, named.map((r) => r.title));
    const what = crazeLine(c, title);
    const newest = Math.max(0, ...named.map((r) => r.t));
    // (rising with a headline in the last three days; fading with none for a week on a page older than that)
    const status = now - newest < 3 * DAY ? 'rising' : now - newest > CRAZE_STALE_DAYS * DAY && age > CRAZE_STALE_DAYS ? 'fading' : 'peak';
    return { title, score, subject: keyOf(title), filmable: true, out: { title, kind: crazeIsAudio(c.name, c.about) ? 'sound' : 'craze', what, subject: c.name, noun: null, heat: heatNumber(score),
      status, since: null, daysAgo: Math.round(age), sources: [c.source || 'NewEngen', ...new Set(named.map((r) => r.outlet).filter(Boolean))].slice(0, 6),
      signals: { news: named.length, pageRank: c.rank || null, newThisMonth: !!c.fresh, outlets: own.outlets, youtube: own.uploads, typed: own.typed }, from: 'crazes', trace: named.slice(0, 3).map((r) => ({ source: r.outlet, date: new Date(r.t).toISOString().slice(0, 10), text: r.title })),
      // (the collector's timed evidence: the headlines that name it as a trend, the page that lists it)
      // (Collector: the page's own paragraph, for the line writer; when the format was first listed, for its start)
      meta: { own: named.map((r) => ({ t: r.t, title: r.title, outlet: r.outlet || null, fam: 'gnews' })), listedBy: 'crazes', pageT: c.updated || null, newOnPage: !!c.fresh, about: c.about || null,
        listedT: Number.isFinite(c.listedT) ? c.listedT : null, namedT: Number.isFinite(namedT) ? namedT : null } } };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, CRAZE_MAX);
}

/**
 * The listed words and crazes of "Words & trends", as talking points at their own heat; titled in sentence case by their why-now
 * headline, meaning and the press headlines naming them (items: the talking points' rows, each with its words' hay `h`).
 */
const WORD_HEAT = { hot: 6, warm: 4.5, mild: 3.2 };
const REACTION_CLIP = /\breaction (?:clip|video|image|gif|face|shot)s?\b/i;
const EMOTION_LEAD = /^(?:shocked|stunned|confused|crying|angry|sad|happy|surprised|smiling|laughing|disgusted|awkward)\s+(?=\p{Lu})/iu;
const WORD_STATUS = { new: 1, rising: 1, back: 0.95, 'still big': 0.85, steady: 0.8, fading: 0.55 };
const WORD_SPIKE = 0.5;
const TITLE_MAX_WORDS = 5;
// (a plain word whose meaning is only its dictionary sense is no trend: "Parenting", "Process of raising a child")
const TREND_MARK = /\b(?:slang|internet|online|viral|trend\w*|memes?|tiktok|social media|videos?|clips?|sounds?|audio|songs?|lyrics?|challenge|catchphrase|phrase|term|nickname|fans?|streamer|youtuber|creators?|gen z|gen alpha|posts?|users?|reaction|edits?|filter|dance)\b/i;
const plainSense = (w) => w.kind === 'trend' && !String(w.term || '').trim().includes(' ') && W.inDict(String(w.term || '').trim().toLowerCase()) && !TREND_MARK.test(String(w.meaning || ''));
/** A one-word trend whose meaning never says it is a trend, a meme, slang or a format: a plain word's sense, whatever the dictionary says. */
const plainMeaning = (w) => w.kind === 'trend' && !String(w.term || '').trim().includes(' ') && !TREND_MARK.test(String(w.meaning || ''));
/** A sound, or a trend whose meaning is a format (a challenge, a dance, a clip; never an event or fan art): a creator can film it today. */
const wordFilmable = (w) => w.kind === 'sound' || (w.kind === 'trend' && FILMABLE_MEME.test(String(w.meaning || '')) && !/\bfan[- ]?art\b/i.test(String(w.meaning || '')));
/** A listed word's score: its heat by its status; a format any creator can film today counts more, a search spike is people looking it up. */
// (a word, a meme or a sound that began over a week ago is no longer rising, whatever its list says: "Black cat clapping" 11 days on
// and "Verity's from Minecraft ..." 35 days on are at their peak, and weigh as a steady one)
const WORD_RISING_DAYS = 7;
const wordClimbs = (w) => ['new', 'rising'].includes(w.status);
const wordStatusWeight = (w) => (wordClimbs(w) && (w.daysAgo ?? 0) > WORD_RISING_DAYS ? WORD_STATUS.steady : WORD_STATUS[w.status] || 0.8);
const wordScore = (w) => (WORD_HEAT[w.heat] || 2.4) * wordStatusWeight(w) + (wordFilmable(w) ? FILMABLE_BONUS : 0) + (w.searchSpike ? WORD_SPIKE : 0);
/** A listed word's status as a card's: new and rising are rising for their first week, fading is fading, the rest peak. */
const wordStatusOf = (w) => (wordClimbs(w) && (w.daysAgo ?? 0) <= WORD_RISING_DAYS ? 'rising' : w.status === 'fading' ? 'fading' : 'peak');
function wordPoints(listed, items = []) {
  return (listed || []).filter((w) => String(w.term || '').trim().split(/\s+/).length <= 5 && !plainSense(w)).map((w) => {
    const term0 = String(w.term || '').trim();
    // (a quote too broken to search is named by its names, as a meme: "Happy day, Ronaldo day" -> "Ronaldo day meme")
    const short = shortTerm(term0);
    // a reaction clip of a person is searched as that person's reaction meme: "Katie Britt reaction meme", not "Shocked Katie Britt trend"
    const reaction = w.kind === 'trend' && REACTION_CLIP.test(String(w.meaning || ''));
    // (and by the face its other name says, when it has one: "Katie Britt face meme", the press's "Schmitt face meme")
    const face = reaction ? (w.alsoCalled || []).map((x) => String(x).trim()).find((x) => /^\S+(?:\s+\S+){0,2}\s+face$/i.test(x)) : null;
    const term = face ? face.replace(/\s+face$/i, ' face') : reaction ? term0.replace(EMOTION_LEAD, '') : term0;
    const ws = term.split(/\s+/);
    // (a Know Your Meme entry is a meme, whatever its meaning calls the craze: "Malfoid meme")
    const kym = w.meaningFrom === 'Know Your Meme' || (w.sources || []).includes('Know Your Meme');
    // a craze's name says what it is: "Malfoid meme", "Salt stepping trend" (its meaning names the kind)
    const named = /\b(?:trend|challenge|meme|dance|sound|audio|filter|illusion|walk)s?$/i.test(term);
    const sort = face ? 'meme' : reaction ? 'reaction meme' : (String(w.meaning || '').match(/\b(meme|challenge|dance|filter)s?\b/i) || [])[1] || (kym ? 'meme' : null);
    // (up to the five-word title: "Cat in the Hat trend" is searched as the trend, not the book)
    const kindOf = (sort || 'trend').toLowerCase();
    const suffix = w.kind === 'trend' && ws.length + kindOf.split(' ').length <= TITLE_MAX_WORDS && !named ? ` ${kindOf}` : '';
    // (in sentence case as its why-now headline, its meaning and the press naming it print it: "Black cat clapping meme", "Fat Bear Week
    // trend")
    const key = keyOf(term);
    // (an outlet's headline: a Know Your Meme entry's title capitalises every word, "Black Cat Clapping - trending.knowyourmeme.com")
    const press = key ? (items || []).filter((i) => i.fam !== 'reddit' && i.fam !== 'kym' && i.h && mentions(i.h, key)).map((i) => i.title) : [];
    const shown = short || caseName(term, [w.whyNow, w.meaning, ...press], () => null, descriptive(term, w.meaning));
    const title = short ? `${short} meme` : `${shown}${suffix}`;
    const filmable = wordFilmable(w);
    const score = wordScore(w);
    // (the meaning as one plain sentence: "Malfoid is a nickname for a gender-swapped version of the character Draco Malfoy.")
    const what = plainLine(short ? null : w.kind === 'phrase' ? `“${shown}”` : shown, w.meaning);
    return { title, score, subject: keyOf(term), filmable, out: { title, kind: w.kind === 'trend' ? (/meme$/.test(title) ? 'meme' : 'craze') : w.kind === 'sound' ? 'sound' : 'word', what,
      subject: term, noun: null, heat: heatNumber(score), status: wordStatusOf(w),
      since: null, daysAgo: w.daysAgo ?? null, sources: w.sources || [], signals: { searchSpike: !!w.searchSpike },
      ...(w.sensitive ? { sensitive: true } : {}), from: 'words', trace: [], meta: w.meta || null } };
  });
}

/**
 * The moments list's cards whose headline puts a talking-point noun right after its subject ("Gillian Anderson responds to backlash"
 * -> "Gillian Anderson backlash"), at a heat from the moment's own heat and coverage. A response alone is no talking point.
 */
const MOMENT_HEAT = { rising: 1, 'second wave': 0.9, peak: 0.85, fading: 0.6 };
const MOMENT_BASE = 5; // (a viral clip still rising, in eight outlets, ranks with a 50K search's story, not under every one of them)
const REMARK = /^(?:slams|rips|rips into|takes aim at|lashes out at)$/i;
/** A moment's score: its heat, a search spike and its coverage. */
const momentScore = (m) => MOMENT_BASE * (MOMENT_HEAT[m.heat] || 0.6) + (m.searchSpike ? 0.4 : 0) + 0.05 * (m.sources || []).length;
/** A moment's heat as a card's status: fading, peak, else rising (a second wave rises again). */
const momentStatusOf = (m) => (m.heat === 'fading' ? 'fading' : m.heat === 'peak' ? 'peak' : 'rising');
function momentPoints(moments, lex) {
  const out = [];
  for (const m of moments || []) {
    const subject = keyOf(m.subject || '');
    if (!subject || !m.headline) continue;
    const hw = words(m.headline);
    const end = (TN.nameAt(hw, subject)[0] ?? -99) + subject.split(' ').length;
    // (one name slamming another in a headline is a remark, not yet a feud: "Florence Pugh slams Instagram ...")
    const x = TN.familiesIn(m.headline).filter((y) => y.f.key !== 'response' && !REMARK.test(y.surface) && y.at - end >= 0 && y.at - end <= 2).sort((a, b) => b.f.w - a.f.w)[0];
    if (!x) continue;
    const noun = x.f.noun(x.surface);
    const texts = [m.headline, m.story, m.moment].filter(Boolean);
    const title = TN.caseTitle([...subject.split(' '), ...words(noun)], subject, texts, lex);
    const score = momentScore(m);
    // (the line is the headline the noun came from, told as a sentence: the story behind it may not say it)
    const what = /[.!?]['’"”]?$/.test(m.headline) ? m.headline : `${m.headline}.`;
    out.push({ title, score, subject, out: { title, kind: 'moment', what, subject: m.subject, noun, heat: heatNumber(score),
      status: momentStatusOf(m), since: null, daysAgo: m.daysAgo ?? null, sources: m.sources || [],
      signals: { searchSpike: !!m.searchSpike }, ...(m.sensitive ? { sensitive: true, sensitiveWhy: m.sensitiveWhy } : {}), from: 'moments', trace: [], meta: m.meta || null } });
  }
  return out;
}

/**
 * Know Your Meme's memes of the week as talking points ("Jean Phil meme", "Tony Stark looking meme"): a meme entry of the last two
 * weeks (the confirmed list, or a submission), Know Your Meme's own explainer this week ("What Is The 'Tony Stark Looking' Meme?"), a
 * weekly roundup naming it ("Malfoid, Ronaldo Day, Hotel Lobby AI And More"), outlets and Reddit posts naming it. Listed only with
 * two kinds of signal (one blog's word is not a talking point), at a heat from them, halving every four days past the newest; told
 * by the entry's own first sentence, or the plainest headline naming it. A word "Words & trends" lists for the same meme keeps its
 * card at the higher heat.
 */
const MEME_BASE = 2.4;
const MEME_ENTRY_DAYS = 14;
const MEME_SIGNAL_DAYS = 7;
const MEME_EXPLAINER = 0.8;
const MEME_ROUNDUP = 0.6;
const MEME_NEWS_W = 0.5;
const MEME_NEWS_MAX = 3;
const MEME_REDDIT = 0.8;
const MEME_MIN_KINDS = 2;
const MEME_GRACE_DAYS = 3;
const MEME_HALF_LIFE = 4;
// a meme with no new signal for five days is past its peak (its heat has been halving since day three; it leaves the list after a week)
const MEME_FADE_DAYS = 5;
const MEME_NAME_USED = 3; // headlines naming it so before the press's name replaces Know Your Meme's
const EXPLAINER_NAME = /^what(?:['’]s| is| are) (?:the )?['‘"“]([^'’"”?]{2,40})['’"”] (?:meme|trend)s?\b/i;
// (a name's generic tail is no part of what outlets call it: "Hotel Lobby AI" is their "'Hotel Lobby' trend")
const MEME_TAIL = /\s+(?:ai|a i|trend|trends|meme|memes|edit|edits|challenge|filter)$/;
const ROUNDUP = /^the weekly meme roundup:\s*(.+?)(?:,?\s+and more)?$/i;
const MEME_WORD = /\b(?:trend|meme|memes|edits?|challenge)\b/i;
// what a headline about a meme says of it, beyond its name: it is a meme, a trend, a thing of TikTok or the internet
const MEME_CONTEXT = /\b(?:memes?|trends?|trending|tiktok|tiktoks?|viral|challenge|edits?|slang|meaning|means|explained|internet|brainrot|know your meme|catchphrase|format|sound|audio)\b/i;
const MEME_VOCAB_MIN = 4;
const FILMABLE_MEME = /\b(?:trend|challenge|dance|filter|edits?|lip-?sync|format|clip|sound|audio)\b/i;
const KYM_ENTRY_URL = /^https?:\/\/(?:www\.)?knowyourmeme\.com\/memes\/[^/?#]+\/?$/;
const NOT_ENTRY = /\?|^the weekly meme roundup|\bexplained\b|^\d+ years\b|^why |^what /i;

/** The meme names Know Your Meme's rows give: Map(key -> { name, aliases:Set, entryT, desc, explainerT, roundupT }). */
function kymMemes(items, now) {
  const by = new Map();
  const get = (name) => {
    const k = keyOf(name);
    for (const m of by.values()) if (m.keys.has(k)) return m;
    const m = { name: name.trim(), shown: null, forms: new Map([[k, name.trim()]]), keys: new Set([k, ...(MEME_TAIL.test(k) && k.replace(MEME_TAIL, '').includes(' ') ? [k.replace(MEME_TAIL, '')] : [])]), entryT: 0,
      subT: 0, desc: null, explainerT: 0, roundupT: 0 };
    by.set(k, m);
    return m;
  };
  const rows = (items || []).filter((i) => i.fam === 'kym' && i.t >= now - MEME_ENTRY_DAYS * DAY && i.t <= now + DAY).sort((a, b) => a.t - b.t);
  for (const i of rows) {
    // (an entry by its feed, or by its address: the story steps re-key a row's source as plain "kym")
    if ((i.src === 'kym-memes' || i.src === 'kym-subs' || KYM_ENTRY_URL.test(i.url || '')) && !NOT_ENTRY.test(i.title)) {
      const [name, ...aliases] = i.title.split(/\s+\/\s+/);
      const m = get(name);
      for (const a of aliases) { const f = a.replace(/\s+meme$/i, '').trim(); m.keys.add(keyOf(f)); if (!m.forms.has(keyOf(f))) m.forms.set(keyOf(f), f); }
      // (the entry's "also known as" names: "also known as the Tony Stark Looking Meme")
      for (const a of String(i.kymDesc || '').split(/[.!?](?:\s|$)/)[0].matchAll(/\balso known as (?:the )?([^,]+?)(?: meme)?(?:,| or |$)/gi)) m.keys.add(keyOf(a[1]));
      if (i.src === 'kym-subs') m.subT = Math.max(m.subT, i.t); else m.entryT = Math.max(m.entryT, i.t);
      if (i.kymDesc && !m.desc) m.desc = i.kymDesc;
    }
  }
  // (Know Your Meme's explainers and roundups as any outlet reprints them: Yahoo's "The Weekly Meme Roundup: Wawario, Jean Phil ...")
  const reprints = (items || []).filter((i) => i.fam !== 'kym' && i.fam !== 'reddit' && i.t >= now - MEME_ENTRY_DAYS * DAY && i.t <= now + DAY &&
    (EXPLAINER_NAME.test(TN.cleanHeadline(i.title, i.outlet)) || ROUNDUP.test(TN.cleanHeadline(i.title, i.outlet))));
  for (const i0 of [...rows, ...reprints].filter((r) => now - r.t <= MEME_SIGNAL_DAYS * DAY)) {
    const i = { ...i0, title: TN.cleanHeadline(i0.title, i0.outlet) };
    const ex = i.title.match(EXPLAINER_NAME);
    // (the explainer's name is the one the press uses: "Tony Stark Looking" for the "Tony Stark Head Turn" entry)
    if (ex) { const m = get(ex[1]); m.explainerT = Math.max(m.explainerT, i.t); m.shown = ex[1].trim(); if (!m.forms.has(keyOf(ex[1]))) m.forms.set(keyOf(ex[1]), ex[1].trim()); }
    const ru = i.title.match(ROUNDUP);
    if (ru) for (const n of ru[1].split(/,\s*|\s+and\s+/)) if (n.trim()) { const m = get(n); m.roundupT = Math.max(m.roundupT, i.t); }
  }
  return [...by.values()];
}

/** The name the press uses most of a meme's names, else its explainer's, else its entry's ("Jean Phil" for "Jean Philanthrope"). */
function displayName(m, news) {
  const own = searchName(m);
  const used = [...m.forms.entries()].map(([k, form]) => ({ form, n: news.filter((r) => ` ${words(r.title).join(' ')} `.includes(` ${k} `)).length }))
    .filter((x) => x.n >= MEME_NAME_USED).sort((a, b) => b.n - a.n || (b.form === own) - (a.form === own) || a.form.length - b.form.length);
  return used.length ? used[0].form : own;
}
/** The name a meme is searched by: its explainer's, else a short form of its entry's name ("Jean Phil" of "Jean Philanthrope"), else the entry's. */
const searchName = (m) => m.shown || [...m.forms.values()].find((f) => f.split(/\s+/).length >= 2 && f.length < m.name.length && m.name.toLowerCase().startsWith(f.toLowerCase())) || m.name;

/** The entry's first sentence, its "also known as" clause out, as a plain line about the meme (plainLine). */
function memeLine(desc, name) {
  const x = (String(desc || '').match(/^.*?[.!?](?=\s|$)/) || [''])[0].replace(/,?\s+(?:also known as|aka)\s+[^,]+?(?:,\s+[^,]+?)*?(?:,| or [^,]+,)\s*/i, ' ').replace(/\s+/g, ' ').trim();
  return x ? plainLine(name, x) : null;
}
// (a headline that says nothing of what the meme is: "... sparks debate", "... goes viral", "... explained")
const EMPTY_LINE = /\b(?:sparks?|stirs?|ignites?|prompts?|fuels?|divides?|draws?)\s+(?:\w+\s+){0,2}(?:debate|controversy|backlash|outrage|conversation|reactions?|criticism)\b|\b(?:goes|going|went|gone) viral\b|\btak(?:es|ing) over\b|\bexplained\b|\beverything (?:you need )?to know\b/i;

function memePoints({ items, lookups, now, lex, moments }) {
  // (an outlet reprinting Know Your Meme's own piece is no second signal: Yahoo's copy of an explainer)
  const kymTitles = new Set((items || []).filter((i) => i.fam === 'kym').map((i) => keyOf(i.title)));
  const reprint = (t) => EXPLAINER_NAME.test(t) || ROUNDUP.test(t);
  const press = [...(items || []).filter((i) => i.fam !== 'kym' && i.fam !== 'reddit').map((i) => ({ title: i.title, t: i.t, outlet: i.outlet })),
    ...[...(lookups ? lookups.values() : [])].flatMap((l) => [...((l.tpnews && l.tpnews.rows) || []), ...((l.deep && l.deep.rows) || [])].map((r) => ({ title: r.title, t: r.t, outlet: r.publisher })))]
    .filter((r) => r.t >= now - MEME_SIGNAL_DAYS * DAY && r.t <= now + DAY && !kymTitles.has(keyOf(TN.cleanHeadline(r.title, r.outlet))) &&
      !reprint(TN.cleanHeadline(r.title, r.outlet)));
  const reddit = (items || []).filter((i) => i.fam === 'reddit' && i.t >= now - MEME_SIGNAL_DAYS * DAY);
  const out = [];
  for (const m of kymMemes(items, now)) {
    const keys = [...m.keys].filter((k) => k && k.length >= 4);
    const names = (t) => { const h = ` ${words(t).join(' ')} `; return keys.some((k) => h.includes(` ${k} `)); };
    // (a headline is about the meme when, beside its name, it says meme, trend, TikTok, viral ... or a word of the entry's own
    // description: the words of a meme's name are everyday words, and a name search for them answers with everything that carries
    // them. "State property" found forty outlets' tax news, "Crash out" would count car crashes. Collector only, 2026-10-19)
    const vocab = new Set(words(String(m.desc || '')).filter((w) => w.length >= MEME_VOCAB_MIN && !W.STOP.has(w) && !W.GENERIC.has(w) && !keys.some((k) => k.split(' ').includes(w)) && !MEME_CONTEXT.test(w)));
    const quoted = new RegExp(`[‘“"']\\s*(?:${keys.map((k) => k.split(' ').join('\\W+')).join('|')})\\W*[’”"']`, 'i');
    const fits = (t) => MEME_CONTEXT.test(String(t || '')) || quoted.test(String(t || '')) || words(t).some((w) => vocab.has(w));
    // (and every result of its own name search, which matched the article if not the headline: "Disturbing truth behind mysterious
    // influencer" is a Jean Phil story)
    const own = lookups ? lookups.get(`talk-${keyOf(searchName(m)).replace(/[^a-z0-9]/g, '')}`) : null;
    const ownRows = ((own && own.tpnews && own.tpnews.rows) || []).map((r) => ({ title: r.title, t: r.t, outlet: r.publisher }))
      .filter((r) => r.t >= now - MEME_SIGNAL_DAYS * DAY && r.t <= now + DAY && fits(TN.cleanHeadline(r.title, r.outlet)));
    const news = [...new Map([...ownRows, ...press.filter((r) => names(r.title) && fits(TN.cleanHeadline(r.title, r.outlet)))].map((r) => [keyOf(r.title), r])).values()];
    // (the outlets behind it are only those headlines: a bare phrase search never feeds the count)
    const outlets = new Set(news.map((r) => r.outlet)).size;
    const posts = reddit.filter((r) => names(r.title) && fits(r.title)).length;
    const kinds = [m.entryT || m.subT, m.explainerT, m.roundupT, outlets, posts].filter(Boolean).length;
    if (kinds < MEME_MIN_KINDS) continue;
    const newest = Math.max(m.entryT, m.subT, m.explainerT, m.roundupT, ...news.map((r) => r.t));
    const age = Math.max(0, (now - newest) / DAY - MEME_GRACE_DAYS);
    // (and what people type after its name, creators' uploads naming it: its own name search's)
    const typed = ownDemand(own, null, now - MEME_SIGNAL_DAYS * DAY, now);
    const score = (MEME_BASE + (m.explainerT ? MEME_EXPLAINER : 0) + (m.roundupT ? MEME_ROUNDUP : 0) + MEME_NEWS_W * Math.min(MEME_NEWS_MAX, Math.log2(1 + outlets)) +
      (posts ? MEME_REDDIT : 0) + OWN_FRESH_W * Math.min(OWN_FRESH_MAX, typed.fresh) + OWN_CREATORS_W * Math.log2(1 + typed.uploads)) *
      Math.pow(0.5, age / MEME_HALF_LIFE);
    // (named as its sentence-case headlines print it mid-line: "Hotel Lobby AI"; a plain word past the first lowercase; a given name's
    // surname stays a name: "Tony Stark looking"; the press's own name for it when it has one: "Jean Phil")
    const nameWs = displayName(m, news).split(/\s+/);
    const shown = caseName(nameWs.join(' '), news.map((r) => r.title));
    // (what the press calls it: a trend where more of its headlines say so than say meme, "Hotel Lobby AI trend")
    // (a headline about the meme itself first, one that says what it is before one that only says it is talked about; the moments'
    // own telling of it counts: "Viral AI trend puts celebrities ... inside Quavo and Takeoff's 'Hotel Lobby' colors performance" over
    // "... trend sparks debate")
    const tellings = (moments || []).filter((x) => names(x.headline || '') || names(x.moment || '') || names(x.story || '')).flatMap((x) => [x.moment, x.story, x.why]).filter(Boolean)
      .map((l) => (l.match(/^.*?[.!?](?=\s|$)/) || [l])[0].replace(/[.!]+$/, ''));
    const line = [...news.filter((r) => names(r.title)).map((r) => TN.cleanHeadline(r.title, r.outlet)), ...tellings.filter((l) => names(l))]
      .map((l, i) => ({ l, i })).sort((a, b) => MEME_WORD.test(b.l) - MEME_WORD.test(a.l) || EMPTY_LINE.test(a.l) - EMPTY_LINE.test(b.l) || a.l.split(/\s+/).length - b.l.split(/\s+/).length || a.i - b.i)
      .map((x) => x.l).find((l) => !/\?/.test(l) && !W.isTitleCase(l.split(/\s+/)) && l.split(/\s+/).length >= 6);
    const what = memeLine(m.desc, shown) || (line ? `${line.replace(/[.!]+$/, '')}.` : null);
    // (the title's kind word is its line's: a trend where the line calls it one, "Hotel Lobby AI trend")
    const sort = /\btrends?\b/i.test(what || '') && !/\bmemes?\b/i.test(what || '') ? 'trend' : 'meme';
    const title = /\b(?:meme|trend|challenge)s?$/i.test(shown) ? shown : `${shown} ${sort}`;
    if (!what || title.split(/\s+/).length > 5) continue;
    // (a meme the press calls a trend or a challenge is a format a creator can make: "Viral A.I. 'Hotel Lobby' trend sparks debate")
    // (never fan art: "Malfoid", "a September 2026 fan art trend")
    const filmable = FILMABLE_MEME.test(line || '') && !/\bfan[- ]?art\b/i.test(`${what} ${line}`);
    // (rising with a signal in the last three days, fading with none for MEME_FADE_DAYS)
    const status = now - newest < 3 * DAY ? 'rising' : now - newest > MEME_FADE_DAYS * DAY ? 'fading' : 'peak';
    out.push({ title, score, subject: keyOf(nameWs.join(' ')), keys, filmable, out: { title, kind: 'meme', what, subject: nameWs.join(' '), noun: null, heat: heatNumber(score),
      status, since: m.entryT ? new Date(m.entryT).toISOString().slice(0, 10) : null, daysAgo: Math.round((now - newest) / DAY),
      sources: ['Know Your Meme', ...new Set(news.map((r) => r.outlet).filter(Boolean))].slice(0, 6),
      signals: { news: news.length, outlets, reddit: posts, explainer: !!m.explainerT, roundup: !!m.roundupT, entry: !!m.entryT }, from: 'memes',
      trace: news.slice(0, 3).map((r) => ({ source: r.outlet, date: new Date(r.t).toISOString().slice(0, 10), text: r.title })),
      // (the collector's timed evidence: its headlines, its Know Your Meme entry, explainer and roundup, when each came)
      meta: { own: news.map((r) => ({ t: r.t, title: r.title, outlet: r.outlet || null, fam: 'gnews' })), listedBy: 'kym',
        memeT: [m.entryT, m.subT, m.explainerT, m.roundupT].filter((t) => t > 0), originT: m.entryT || null } } });
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

module.exports = { crazePoints, crazeTitle, caseName, wordName, crazeIsAudio, crazeLookupNames, wordPoints, momentPoints, memePoints, kymMemes, searchName, ownDemand, heatNumber, HEAT_SPAN,
  FILMABLE_BONUS, wordScore, wordStatusOf, momentScore, momentStatusOf, plainMeaning, plainLine, shortTerm, descriptive };
