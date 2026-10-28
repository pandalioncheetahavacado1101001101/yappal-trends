'use strict';
/*
 * Text primitives of the claim check (ios/IDEAS-FEED.md G3): a sentence as tokens with their quotes, possessives and negations; stems
 * that let "accused" meet "accusations" and nothing looser; numbers as values ("$200K" is 200,000); names as the line spells them.
 * Pure: no clock, no I/O.
 */
const W = require('../engine/wording');

// ---------- word classes (closed lists: what is not listed here is a content word and must stand in a source) ----------
const list = (s) => new Set(s.split(/\s+/).filter(Boolean));
// grammar only: a word here adds nothing a source would have to say
const STOP = list(`a an the and or of to in on at for with by from as than that this these those which who whom whose what
  is are was were be been being am has have had having do does did
  he she they it him her them his their its hers theirs himself herself themselves itself
  into onto upon about against between during through among within near off out up down so also both there here where when while vs versus via`);
// rule 4's free words: they add care, never a claim
// (how a claim is attributed is the line's to word: "..., according to media reports" for a source's "..., media reports say")
const FREE = list('reportedly allegedly after amid over following says said say according reports');
// rule 7: never stop words, never free
const NEG_GRAMMAR = list('no not never without nor neither none cannot nobody nothing');
// (and the other words a denial is made with: "refutes", "disputes", "rebuts", "dismisses ... as", "baseless", "fabricated")
const NEG_WORDS = /^(?:den(?:y|ies|ied|ial|ials|ying)|dropped|dismiss(?:es|ed|ing)?|cleared|hoax(?:es)?|false|fake|faked|acquitted|withdrawn|withdrew|tossed|debunked|untrue|innocent|refus(?:es|ed|ing)|reject(?:s|ed|ing)?|refut(?:e|es|ed|ing)|disput(?:e|es|ed|ing)|rebut(?:s|ted|ting)?|baseless|fabricated)$/;
// what a denial of a claim is made with, said of whoever makes it (rule 9 reads the sources for it)
const DENIES = /^(?:den(?:y|ies|ied|ial|ials|ying)|refut(?:e|es|ed|ing)|disput(?:e|es|ed|ing)|rebut(?:s|ted|ting)?|reject(?:s|ed|ing)?|dismiss(?:es|ed|ing)?)$/;
const PRONOUN = { he: 'he', him: 'he', his: 'he', himself: 'he', she: 'she', her: 'she', hers: 'she', herself: 'she', they: 'they', them: 'they', their: 'they', theirs: 'they', themselves: 'they', it: 'it', its: 'it' };
// words that only say when or how much of a verb: never who did it
const ADVERB = list('now still again also just then later once already even ever finally recently publicly openly reportedly allegedly');
const AUX = list('is are was were be been being am has have had having do does did gets got get');
const CONNECTIVE = list('after amid while before following when since because but though although despite');

// ---------- claim words (rule 4: never free; rule 8: reported unless established) ----------
// who says so: a claim reported as someone's
const REPORT = /^(?:alleg(?:e|es|ed|ing|ation|ations)|accus(?:e|es|ed|ing|ation|ations)|claim(?:s|ed|ing)?)$/;
const DENY = /^(?:den(?:y|ies|ied|ial|ials|ying))$/;
const ADMIT = /^(?:admit(?:s|ted|ting)?|admission|confess(?:es|ed|ing|ion)?|apolog(?:y|ies|i[sz]e|i[sz]es|i[sz]ed|i[sz]ing)|confirm(?:s|ed|ing)?)$/;
// an act on record: stated flat only when two outlets state it and nobody hedges or denies it
const RECORD = /^(?:arrest(?:s|ed|ing)?|charged|charges|sued|sues|suing|sentenced|sentencing|convicted|conviction|banned|fired|died|dies|dead|death|indicted|jailed)$/;
// wrongdoing and guilt: always reported, unless the subject owned up to it
const GUILT = /^(?:guilty|cheat(?:s|ed|ing|er)?|assault(?:s|ed|ing)?|attack(?:s|ed|ing|er)?|stab(?:s|bed|bing)?|shot|shooting|leak(?:s|ed|ing)?|scam(?:s|med|ming|mer|mers)?|groom(?:s|ed|ing|er)?|abus(?:e|es|ed|ing|er|ers|ive)|harass(?:es|ed|ing|ment)?|threat(?:s|en|ens|ened|ening)?|stole|stolen|steal(?:s|ing)?|lied|lying|liar|pleaded|pled|rap(?:e|ed|es|ist)|molest\w*|grop\w+|fraud\w*|theft|murder\w*|kill(?:s|ed|ing|er)?|rob(?:s|bed|bing|bery)|punch(?:es|ed|ing)?|slap(?:s|ped|ping)?|stalk\w*|predator\w*|pedophil\w*|racist|battery|misconduct|felon\w*|crime|crimes|criminal|brib\w+|extort\w*|blackmail\w*|kidnap\w*|traffick\w*|embezzl\w*|violence|detained|booked|expelled)$/;
const RETRACT = /^(?:apolog(?:y|ies|i[sz]e|i[sz]es|i[sz]ed|i[sz]ing)|retract(?:s|ed|ing|ion)?|recant(?:s|ed|ing)?|withdr[ae]w(?:s|n|ing)?)$/;
// an outcome only looked ahead to (rule 7): "could face", "if convicted", "set to be executed"
const AHEAD = list('if could would might may will should unless whether faces facing face risks risk awaits awaiting possible potential expected set scheduled ahead plans wants seeks demands');
const UNDONE = /^(?:dropped|dismissed|tossed|withdrawn|cleared|overturned)$/;

const claimClass = (k) => (REPORT.test(k) ? 'report' : DENY.test(k) ? 'deny' : ADMIT.test(k) ? 'admit' : RECORD.test(k) ? 'record' : GUILT.test(k) ? 'guilt' : null);

// ---------- stems ----------
const IRREGULAR = { paid: 'pay', pays: 'pay', paying: 'pay', said: 'say', says: 'say', told: 'tell', tells: 'tell', died: 'die', dies: 'die', dead: 'die', death: 'death', deaths: 'death', dying: 'die', accuser: 'accuser', accusers: 'accuser',
  sued: 'sue', sues: 'sue', suing: 'sue', lawsuit: 'lawsuit', shot: 'shoot', shoots: 'shoot', shooting: 'shoot', stole: 'steal', stolen: 'steal', lied: 'lie', lying: 'lie', lies: 'lie',
  hit: 'hit', hits: 'hit', beat: 'beat', beaten: 'beat', fought: 'fight', left: 'leave', leaves: 'leave', broke: 'break', broken: 'break', gave: 'give', given: 'give', took: 'take', taken: 'take',
  made: 'make', found: 'find', lost: 'lose', won: 'win', held: 'hold', sent: 'send', met: 'meet', bought: 'buy', sold: 'sell', brought: 'bring', caught: 'catch', taught: 'teach',
  thought: 'think', knew: 'know', known: 'know', saw: 'see', seen: 'see', went: 'go', gone: 'go', goes: 'go', got: 'get', gotten: 'get', came: 'come', ran: 'run', wrote: 'write', written: 'write',
  spoke: 'speak', spoken: 'speak', wore: 'wear', worn: 'wear', threw: 'throw', thrown: 'throw', fell: 'fall', fallen: 'fall', began: 'begin', begun: 'begin', drove: 'drive', driven: 'drive',
  felt: 'feel', kept: 'keep', pled: 'plead', led: 'lead', fled: 'flee', women: 'woman', men: 'man', children: 'child', people: 'person', wives: 'wife', lives: 'life',
  // ("under fire" and "fires back" are no firing: the two never meet)
  fire: 'fire', fires: 'fire', fired: 'fired', firing: 'fired', use: 'us', used: 'us', uses: 'us', using: 'us',
  // (a headline's short forms are the words they stand for)
  gf: 'girlfriend', bf: 'boyfriend', girlfriends: 'girlfriend', boyfriends: 'boyfriend' };
const FAMILY = [[/^apolog/, 'apolog'], [/^alleg(?:e|es|ed|ing|ation|ations)$/, 'alleg'], [/^accus/, 'accus'], [/^den(?:y|ies|ied|ial|ials|ying)$/, 'deny'], [/^admi(?:t|ts|tted|tting|ssion|ssions)$/, 'admit'],
  [/^critici[sz]/, 'critic'], [/^controvers/, 'controvers'], [/^divorc/, 'divorc'], [/^threat/, 'threat'], [/^convict/, 'convict'], [/^harass/, 'harass']];
const PAST_FORMS = new Set(Object.keys(IRREGULAR).filter((k) => !/(?:s|ing)$/.test(k) && !['lawsuit', 'death', 'dead', 'women', 'men', 'children', 'people', 'fire', 'use', 'gf', 'bf', 'accuser'].includes(k)));
// (a contraction is no possessive: "he's", "that's")
const NO_POSSESSIVE = list('he she it that there here what who let how where when');
const MIN_STEM = 3;
/** A word's stem: its inflections and the nouns made from it meet ("accused", "accusations"), nothing looser. Takes a token's key. */
function stemOf(key) {
  if (IRREGULAR[key]) return IRREGULAR[key];
  for (const [re, to] of FAMILY) if (re.test(key)) return to;
  // (the British spelling meets the American one: "apologises", "criticised")
  let s = key.replace(/is(e|es|ed|ing|ation|ations)$/, 'iz$1').replace(/^(rum|fav|col|hon|behavi|neighb|lab|hum)our/, '$1or');
  const cut = (suffix, min = MIN_STEM) => { if (s.endsWith(suffix) && s.length - suffix.length >= min) { s = s.slice(0, -suffix.length); return true; } return false; };
  // ("consciousness" meets "conscious": a state and the word for being in it)
  if (!(cut('ations', 4) || cut('ation', 4) || cut('ments', 4) || cut('ment', 4) || cut('ness', 5) || cut('ings') || cut('ing'))) {
    if (s.endsWith('ies') && s.length > 4) s = `${s.slice(0, -3)}y`;
    else if (s.endsWith('ied') && s.length > 4) s = `${s.slice(0, -3)}y`;
    else if (!cut('ed')) {
      if (/(?:s|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
      // ("conscious", "famous", "crisis" end in an s that is no plural's)
      else if (s.endsWith('s') && !/(?:ss|us|is)$/.test(s) && s.length > MIN_STEM) s = s.slice(0, -1);
    }
  }
  if (s.endsWith('e') && s.length > MIN_STEM) s = s.slice(0, -1);
  // ("admitted", "banned", "stabbed": the doubled letter goes with the ending)
  if (s.length > MIN_STEM && /([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1);
  return s;
}

// ---------- numbers ----------
const NUMBER = /^([$£€])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(k|m|mn|b|bn)?(%)?\+?$/i;
const ORDINAL = /^(\d+)(?:st|nd|rd|th)$/i;
const SCALE = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9 };
const SCALE_WORD = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const NUMBER_WORD = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, dozen: 12 };
const MONEY_WORD = list('dollars dollar bucks usd pounds euros');
/** A token's own number, or null: { value, money, pct }. `surface` keeps its sign and suffix ("$200K", "86", "4%"). */
function numberOf(surface) {
  const m = String(surface).match(NUMBER);
  if (m) return { value: Number(m[2].replace(/,/g, '') + (m[3] || '')) * (m[4] ? SCALE[m[4].toLowerCase()] : 1), money: !!m[1], pct: !!m[5] };
  const o = String(surface).match(ORDINAL);
  if (o) return { value: Number(o[1]), money: false, pct: false };
  const w = NUMBER_WORD[String(surface).toLowerCase()];
  return w ? { value: w, money: false, pct: false } : null;
}
/** Whether the line's number stands as the source's: the same value, and a sum of money or a share is one there too. */
const sameNumber = (line, source) => Math.abs(line.value - source.value) < 1e-9 && (!line.money || source.money) && (!line.pct || source.pct);

// ---------- tokens ----------
const QUOTE = /["“”‘’']/;
const keyOf = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
/**
 * A sentence as tokens, in order: { s (the word as written), k (key), st (stem), cap, q (the quote it stands in, 0 for none), pre and
 * post (the punctuation around it), poss (a possessive), neg (a negation), num, unit (a number's scale or currency word), i }.
 * A hyphenated word is its parts ("ex-moderator", "86-year-old"); a dash between words is punctuation after the word before it.
 */
function tokensOf(text) {
  // ("&" is "and": the card prints it so, and a headline's "Robbed & Assaulted" is two verbs joined)
  const chunks = String(text || '').replace(/\s&\s/g, ' and ').replace(/\s--\s/g, ' — ').replace(/([\p{L}\p{N}])[—–]([\p{L}\p{N}])/gu, '$1 — $2').split(/\s+/).filter(Boolean);
  const out = [];
  let open = 0;
  let quotes = 0;
  for (const chunk of chunks) {
    if (!/[\p{L}\p{N}]/u.test(chunk)) {
      // (a dash, a bar or a lone quote mark between words)
      if (out.length) out[out.length - 1].post += ` ${chunk}`;
      if (QUOTE.test(chunk) && open) open = 0;
      continue;
    }
    const pre = (chunk.match(/^[^\p{L}\p{N}$£€#@]+/u) || [''])[0];
    const rest = chunk.slice(pre.length);
    const post = (rest.match(/[^\p{L}\p{N}%+]+$/u) || [''])[0];
    let core = rest.slice(0, rest.length - post.length);
    if (QUOTE.test(pre) && !open) { quotes += 1; open = quotes; }
    const q = open;
    // (a closing mark: one after the word while a quote is open; a lone apostrophe after a plural with none open is a possessive)
    const closes = open && QUOTE.test(post);
    let poss = /['’]s$/i.test(core) || (!open && /s$/i.test(core) && /^['’]/.test(post));
    if (/['’]s$/i.test(core)) core = core.slice(0, -2);
    if (NO_POSSESSIVE.has(keyOf(core))) poss = false;
    const neg = /n['’]t$/i.test(core);
    const parts = core.split(/[-/]/).filter((p) => /[\p{L}\p{N}]/u.test(p));
    parts.forEach((part, at) => {
      const lastPart = at === parts.length - 1;
      const k = keyOf(part);
      out.push({ s: part, k, st: stemOf(k), cap: /^\p{Lu}/u.test(part), q, pre: at === 0 ? pre : '', post: lastPart ? post : '', joined: !lastPart, poss: lastPart && poss,
        neg: (lastPart && neg) || NEG_GRAMMAR.has(k) || NEG_WORDS.test(k), nt: lastPart && neg, num: numberOf(part.replace(/^#/, '')), unit: false, i: out.length });
    });
    poss = false;
    if (closes) open = 0;
  }
  // (a quotation mark never closed: the shape rule's to know)
  out.open = open !== 0;
  // a number's scale and currency words join it: "200 thousand", "5 million dollars", "40 percent"
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (!t.num) continue;
    let next = out[i + 1];
    if (next && SCALE_WORD[next.k] && !/^\d+$/.test(next.k)) { t.num = { ...t.num, value: t.num.value * SCALE_WORD[next.k] }; next.unit = true; next.num = null; next = out[i + 2]; }
    if (next && MONEY_WORD.has(next.k)) { t.num = { ...t.num, money: true }; next.unit = true; } else if (next && (next.k === 'percent' || next.k === 'per')) { t.num = { ...t.num, pct: true }; next.unit = true; }
  }
  return out;
}

/** Whether a token ends a clause for whoever reads on: a semicolon, a colon or a dash after it. */
const breaksAfter = (t) => /[;:—–|]|(?:^|\s)-(?:\s|$)/.test(t.post);
const commaAfter = (t) => t.post.includes(',');

// ---------- names ----------
const HANDLE = /^@|\p{Ll}\p{Lu}|\p{L}\d|\d\p{L}/u;
/** Whether a token is written as a handle keeps its spelling: "@name", "nimvaneb", "Swivstro". */
const isHandle = (t) => HANDLE.test(t.pre.slice(-1) + t.s) && /\p{L}/u.test(t.s) && !t.num;
const isTitleCase = (toks) => W.isTitleCase(toks.map((t) => t.s));
/**
 * Which tokens of a sentence are name words: Set of indexes. In a sentence-case sentence, a capitalised word (the first word only
 * when no dictionary spells it, or a name follows it); in a Title Case headline, where capitals say nothing, only a word known as a
 * name elsewhere (`known`: keys), a given name, or one no dictionary spells.
 */
function nameIndexes(toks, known = new Set()) {
  const out = new Set();
  const title = isTitleCase(toks);
  // (a headline set all in capitals tells nothing by them)
  const shouted = toks.filter((t) => t.s.length >= 4 && t.s === t.s.toUpperCase() && /\p{L}/u.test(t.s)).length >= 3;
  // (a dictionary's word, or a form of one it does not list: "Paid", "Sued", "Apologises")
  // ("May", "Will" and "Can" in a headline's capitals are the helping verbs far more often than the month or the name)
  const plain = (t) => HELPING.has(t.k) || ((W.inDict(t.k) || !!IRREGULAR[t.k] || !!claimClass(t.k) || W.inDict(stemOf(t.k))) && !W.isFirstName(t.k) && !W.isProperWord(t.k));
  toks.forEach((t, i) => {
    if (t.num || !/\p{L}/u.test(t.s)) return;
    if (isHandle(t)) { out.add(i); return; }
    if (!t.cap) return;
    if (known.has(t.k)) { out.add(i); return; }
    const opens = i === 0 || /[.!?:]/.test(toks[i - 1].post) || (t.q && (i === 0 || toks[i - 1].q !== t.q));
    // (an acronym keeps its capitals in any case: "AI", "LA", "DCU")
    const acronym = t.s.length >= 2 && t.s.length <= 5 && t.s === t.s.toUpperCase() && !STOP.has(t.k) && !IRREGULAR[t.k];
    if (title || opens) { if ((acronym && !shouted) || (!plain(t) && !STOP.has(t.k))) out.add(i); return; }
    if (!STOP.has(t.k)) out.add(i);
  });
  // (a sentence's first word before a name is part of it when it is no word for what someone is: "Bexan Tamard", never "Streamer Bexan Tamard")
  const first = toks[0];
  if (!title && first && first.cap && !out.has(0) && out.has(1) && !first.poss && !/[,;:]/.test(first.post) && !STOP.has(first.k) && !DESCRIBES.has(first.k) && !/(?:ed|ing|er|or|ist|ian)$/.test(first.k)) out.add(0);
  return out;
}
const HELPING = list('may will can might must should could would');
const DESCRIBES = list(`former late new fellow popular controversial embattled disgraced rapper singer actor actress star streamer youtuber tiktoker influencer host model comedian
  player coach director producer presenter musician artist creator judge founder boss legend twitch kick youtube tiktok instagram bollywood hollywood police fans`);
/**
 * The names of a sentence as mentions, in order: { keys, start, end, poss }. Name words side by side are one name; a comma, a
 * possessive or a quote's edge ends it.
 */
function mentionsOf(toks, names) {
  const out = [];
  let run = null;
  const flush = () => { if (run) out.push(run); run = null; };
  toks.forEach((t, i) => {
    if (!names.has(i)) { flush(); return; }
    if (run && toks[i - 1].q !== t.q) flush();
    if (!run) run = { keys: [], start: i, end: i, poss: false };
    run.keys.push(t.k);
    run.end = i;
    // (a possessive ends a name, and so does punctuation after it; never the stop of "Ms." or of an initial)
    if (t.poss) { run.poss = true; flush(); } else if (/[,;:!?()—–]/.test(t.post) || (t.post.includes('.') && t.s.length > 3)) flush();
  });
  flush();
  return out;
}
/** Whether two mentions name the same one: the shorter's words all stand in the longer ("Tamard" is "Bexan Tamard"; "Jasan Wickard" is not). */
function sameName(a, b) {
  const [small, big] = a.keys.length <= b.keys.length ? [a.keys, b.keys] : [b.keys, a.keys];
  return small.every((k) => big.includes(k));
}

/** Whether a token is a content word: not grammar, not a number's unit, not punctuation. */
const isContent = (t) => !!t.k && !t.unit && !STOP.has(t.k);
/** Whether a token may be what happened: a claim word, or a word shaped like a verb (a plural noun counts: stricter, never looser). */
function isVerbish(t) {
  if (!isContent(t) || t.num || FREE.has(t.k)) return false;
  return !!claimClass(t.k) || PAST_FORMS.has(t.k) || /(?:ed|ing|s)$/.test(t.k) || W.looksVerb(t.k);
}

module.exports = { STOP, FREE, NEG_GRAMMAR, NEG_WORDS, DENIES, PRONOUN, ADVERB, AUX, CONNECTIVE, REPORT, DENY, ADMIT, RECORD, GUILT, RETRACT, AHEAD, UNDONE, PAST_FORMS, claimClass, stemOf, numberOf, sameNumber,
  tokensOf, keyOf, breaksAfter, commaAfter, isHandle, isTitleCase, nameIndexes, mentionsOf, sameName, isContent, isVerbish };
