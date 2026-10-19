'use strict';
/*
 * "Words & trends": what the per-term lookups (lookups.js) answered, read into meanings and signals.
 *   Wikipedia   a page named exactly like the term and about slang/memes -> a meaning, daily-view heat and direction
 *   Wiktionary  a coinage's slang-labelled sense -> a meaning
 *   KYM page    an entry page's definition -> a meaning (quality 5), its kind, its start date
 *   origin      an open-ended news search -> how far back headlines naming the term go
 * Plain string/regex arithmetic only, so it ports 1:1 to Swift.
 */
const W = require('./wording');
const X = require('./words-extract');
const { median, outletKey } = require('./util');
const { termStem, termSeq, termKey, hasSeq } = require('./words-keys');

const DAY = 86400000;
const WIKI_VIEWS_MIN = 2000;
const NOT_SLANG_PAGE = /\b(organi[sz]ation|country|city|town|company|corporation|band|film|album|song|politician|footballer|player|actor|actress|singer|rapper|group|party|bloc|video game|software|brand|born|species|river|mountain)\b/i;
const WIKI_SLANG = /\b(slang|internet meme|meme|neologism|catchphrase|phrase|expression|colloquial\w*|viral|tiktok|internet trend|challenge|dance craze|gesture|buzzword)\b/i;
const CONTEXT_FOR_PLAIN_WORD = /\b(slang|meaning|means?|trend\w*|memes?|tiktok|challenge|word|term|saying|says|kids|teens|gen z|gen alpha|viral|internet)\b/i;

/**
 * Wikipedia Action API batch replies (a first reply plus its continuations) -> Map(term key -> { summary, views }). A page counts
 * only when it carries exactly the term's name (a redirect to another page or to a section of one does not: "Mogging" ->
 * "-maxxing", "Fanum tax" -> "Fanum (streamer)#Fanum tax") and is about slang, a meme or a trend, or the term is a coinage no
 * dictionary knows ("Phubbing"). "Hotel Lobby" the 1943 painting and "Chile" the country are refused.
 */
function parseWikiBatch(replies, pairs) {
  const pages = new Map();
  const redirects = new Map();
  for (const j of replies) {
    const q = (j && j.query) || {};
    for (const n of q.normalized || []) redirects.set(n.from, { to: n.to });
    for (const r of q.redirects || []) redirects.set(r.from, { to: r.to, fragment: r.tofragment || null });
    for (const p of q.pages || []) {
      const old = pages.get(p.title) || {};
      pages.set(p.title, { ...old, ...p, pageviews: { ...(old.pageviews || {}), ...(p.pageviews || {}) } });
    }
  }
  const out = new Map();
  for (const [key, title] of pairs) {
    let t = title;
    let fragment = null;
    for (let hops = 0; hops < 3 && redirects.has(t); hops++) { const r = redirects.get(t); fragment = r.fragment || fragment; t = r.to; }
    const p = pages.get(t);
    if (!p || p.missing || p.invalid) { if (!out.has(key)) out.set(key, { summary: null, views: null }); continue; }
    const extract = p.extract || '';
    const sameName = !fragment && termKey(p.title.replace(/\s*\([^)]*\)/g, '')) === key;
    const about = `${p.description || ''} ${extract.split(/(?<=[a-z0-9)])\.\s/)[0]}`;
    // a coinage's own page counts, unless it is the page of an organisation, a place, a work or a person ("BRICS")
    // (a number is never a coinage: "325" is the year, "67" needs a page that says it is slang)
    // (a letter or two is never a coinage either: "W" is the letter's page)
    const coinage = termSeq(title).length === 1 && /[a-z]{3}/i.test(title) && X.isCoinage(W.words(title)[0] || '') && !NOT_SLANG_PAGE.test(p.description || '');
    const disambiguation = /\bmay refer to\b/i.test(extract) || /topics referred to by the same term|disambiguation/i.test(p.description || '');
    const accepted = sameName && !disambiguation && (WIKI_SLANG.test(about) || coinage);
    const views = Object.entries(p.pageviews || {}).filter(([, v]) => Number.isFinite(v)).map(([d, v]) => ({ d, v }));
    // a term asked under two titles ("67", "6-7") keeps the accepted answer
    if (out.has(key) && out.get(key).summary && out.get(key).summary.accepted && !accepted) continue;
    out.set(key, { summary: { title: p.title, description: p.description || '', extract, accepted }, views: accepted ? views : null });
  }
  return out;
}
const POS = /^={3,4} (Noun|Verb|Adjective|Adverb|Interjection|Phrase|Proverb|Idiom|Prepositional phrase|Pronoun|Particle|Contraction) ={3,4}$/;
const SLANG_LABEL = /\b(slang|internet|neologism|gen z|gen alpha|aave|african-american vernacular|youth|incel|informal|colloquial|tiktok|gaming|twitch|lgbt|ballroom)\b/i;
const FORM_OF = /^(plural|alternative|misspelling|present participle|past participle|simple past|past tense|third-person|obsolete|archaic|abbreviation|initialism|synonym|comparative|superlative|eye dialect)\b.*\bof\b/i;
// a sense that is a usage note, not a meaning: Wiktionary's "&lit" line ("Used other than figuratively or idiomatically: see red,
// flag."), a "see" cross-reference, a form-of line, a label alone. Live 2026-10-19: "Red Flag meaning | Used other than
// figuratively or idiomatically." took row 9 of the page as a word's line. Nothing a creator can say is in it.
const USAGE_NOTE = /^(?:used other than\b|used (?:literally|attributively)\b|see\b|only used\b|chiefly (?:in|used)\b|short for\b|clipping of\b|ellipsis of\b|synonym of\b|alternative (?:form|spelling|letter-case form|case form) of\b|(?:common |deliberate )?misspelling of\b|(?:initialism|abbreviation|acronym|contraction) of\b|(?:obsolete|archaic|dated|rare|nonstandard) (?:form|spelling) of\b|(?:plural|singular) of\b|(?:past|present) (?:tense|participle) of\b|(?:simple past|past participle|present participle|gerund) (?:tense |form )?of\b|(?:comparative|superlative) (?:form|degree) of\b|a (?:common |frequent )?misspelling\b|(?:this|the) term (?:needs|is)\b|\(?(?:non-?gloss definition|rfdef|rfe|rfv)\)?$)/i;
/** Whether a dictionary sense is a usage note or a cross-reference rather than a meaning. */
const usageNote = (text) => USAGE_NOTE.test(String(text || '').replace(/^\s*\((?:[^)]*)\)\s*/, '').trim());
// a label that places a sense in a trade's own vocabulary, not the internet's: a technical definition is no trend ("Chopped:
// Having a vehicle's height reduced by horizontal trimming of the roofline." on a US list, live 2026-10-19)
const TECHNICAL_LABEL = /\b(?:automotive|vehicles?|motor(?:ing|sport)?|finance|financial|banking|economics|law|legal|medicine|medical|pathology|anatomy|pharmacology|chemistry|physics|mathematics|geometry|statistics|computing|programming|engineering|electronics|electrical|mechanics|nautical|aviation|aeronautics|military|botany|zoology|biology|biochemistry|genetics|geology|astronomy|architecture|construction|carpentry|masonry|cooking|culinary|printing|typography|linguistics|grammar|phonetics|music theory|cricket|baseball|golf|chess|poker|card games|bridge|knitting|sewing|textiles|agriculture|forestry|mining|metallurgy|surveying|cartography|heraldry|philately|numismatics)\b/i;
/** Whether a sense's label puts it in a trade's vocabulary and says nothing of slang. */
const technicalLabel = (label) => TECHNICAL_LABEL.test(String(label || '')) && !SLANG_LABEL.test(String(label || ''));
/**
 * Wiktionary plain text -> its English senses [{ pos, label, text }]. The sense to show is the first one labelled slang/internet/etc.;
 * for a pure coinage ("gyatt") the first sense of any kind. "mewing" has a slang sense after "the act of producing a mew sound".
 */
function parseWikt(json) {
  const page = json && json.query && (json.query.pages || [])[0];
  const text = page && !page.missing ? page.extract || '' : '';
  const en = text.split(/\n(?=== [^=]+ ==\n)/).find((sec) => sec.startsWith('== English =='));
  if (!en) return null;
  const senses = [];
  let pos = null;
  let head = false;
  for (const line of en.split('\n').map((l) => l.trim())) {
    const m = line.match(POS);
    if (m) { pos = m[1]; head = true; continue; }
    if (/^=/.test(line)) { pos = null; continue; }
    if (!pos || !line) continue;
    if (head) { head = false; continue; } // "big back (plural big backs)"
    const lm = line.match(/^\(([^)]*)\)\s*(.*)$/);
    const sense = { pos, label: lm ? lm[1] : '', text: lm ? lm[2] : line };
    // (a usage note or a cross-reference is no sense: there is no meaning in it to show)
    if (sense.text && !FORM_OF.test(sense.text) && !usageNote(sense.text) && !/^(synonyms?|antonyms?|coordinate terms?|see also|hypernyms?|hyponyms?|derived terms?):/i.test(sense.text)) senses.push(sense);
  }
  // "larping": only "present participle of larp" -> the lemma's page is asked next
  const lemma = (en.match(/\b(?:present participle|past participle|simple past|plural|gerund)(?: and [a-z ]+)? of ([a-z][a-z -]{1,30})\b/i) || [])[1];
  return senses.length ? { senses: senses.slice(0, 12) } : lemma ? { senses: [], lemma: lemma.trim() } : null;
}

/**
 * The term's accepted Wikipedia summary. A page named by a letter or two counts only when it is about slang ("6-7"), not the
 * letter "W" (answers saved before that rule are checked again here).
 */
function okSummary(lookup) {
  const s = lookup && lookup.summary;
  if (!s || !s.accepted) return null;
  return /[a-z]{3}/i.test(s.title) || WIKI_SLANG.test(`${s.description || ''} ${(s.extract || '').split(/(?<=[a-z0-9)])\.\s/)[0]}`) ? s : null;
}
// words that only name the category: "An internet meme, slang term, and gesture" says nothing about what "67" means
const CATEGORY_WORD = /^(meme|memes|slang|term|terms|gesture|phrase|expression|internet|catchphrase|word|neologism|viral|online)$/;
const saysWhat = (text) => W.words(text).filter((w) => !W.STOP.has(w) && !CATEGORY_WORD.test(w)).length >= 2;
/** A defining short description ("Snubbing a person for a mobile phone") beats the lead sentence; a bare category ("Internet slang word") does not. */
// a page about a people, a place's history or an old word is another sense of the term, never the slang ("Chud": Finnic peoples)
const OTHER_SENSE = /\b(peoples?|tribes?|ethnic\w*|ethnonym|old (?:slavic|norse|english|french)|medieval|ancient|historical|dynasty|surname|given name)\b/i;
function wikiMeaning(lookup) {
  const s = okSummary(lookup);
  if (!s || OTHER_SENSE.test(`${s.description || ''} ${(s.extract || '').slice(0, 200)}`)) return null;
  const d = s.description;
  if (d && d.split(' ').length >= 3 && /\b(for|of|meaning|to|used|when|where|that)\b/i.test(d) && !/^\d{4}\b/.test(d) && saysWhat(d)) {
    return { text: d.charAt(0).toUpperCase() + d.slice(1), quality: 3.8, from: 'Wikipedia' };
  }
  const first = s.extract.replace(/\s*\([^)]*\)/g, '').split(/(?<=[a-z0-9)”"'’])\.\s/)[0];
  const m = first.match(/\s(?:is|are|was|refers to)\s(.+)$/i);
  const text = X.tidyMeaning(m ? m[1] : null);
  return text && saysWhat(text) ? { text, quality: 3.5, from: 'Wikipedia' } : null;
}
const NEW_SLANG_LABEL = /\b(?:internet|gen z|gen alpha|aave|african-american vernacular|tiktok|twitch|gaming|youth)\b/i;
function wiktMeaning(lookup, term) {
  const senses = (lookup && lookup.wikt && lookup.wikt.senses) || [];
  const plainWord = term && term.split(' ').length === 1 && W.inDict(W.words(term)[0] || '');
  // (what people mean by it now before what the dictionary lists first: a sense labelled internet slang, then one labelled slang,
  // then any informal one. "Crash out" read "To fall asleep from exhaustion", its first informal sense, where the word that is
  // trending is the internet one, to lose control in anger. Collector only, reviewers 2026-10-12)
  // (and a coinage's first sense only when it is no trade's technical definition: "finance", "automotive" and the like define a
  // term of the trade, not the word people are saying)
  const sense = senses.find((x) => NEW_SLANG_LABEL.test(x.label)) || senses.find((x) => /\bslang\b/i.test(x.label)) || senses.find((x) => SLANG_LABEL.test(x.label)) || (plainWord ? null : senses.find((x) => !technicalLabel(x.label)) || null);
  const text = sense && X.tidyMeaning(sense.text);
  return text ? { text, quality: 3, from: 'Wiktionary' } : null;
}
/**
 * The definition on the term's Know Your Meme entry page (fetched when no source gave a usable meaning), and how people use it
 * when a later sentence says so ("... paired with captions about getting stuck in a crowd"): [meaning, use], either may be absent.
 */
function kymPageMeanings(lookup) {
  const k = lookup && lookup.kym;
  if (!k || !k.desc) return [];
  const pred = X.kymPredicate(k.desc, k.name);
  const text = X.tidyMeaning(pred);
  const use = X.useLine(k.desc);
  return [text ? { text, quality: 5, from: 'Know Your Meme', raw: pred } : null, use ? { text: use, quality: 5, from: 'Know Your Meme', use: true } : null]
    .filter(Boolean);
}
/** Daily Wikipedia views of the term's page: the window's peak against the month before it. */
function wikiEvidence(lookup, now) {
  const views = okSummary(lookup) && lookup.views;
  if (!views || !views.length) return null;
  const from = now - 14 * DAY;
  const inWin = views.filter((x) => Date.parse(x.d) >= from);
  const before = views.filter((x) => Date.parse(x.d) < from).map((x) => x.v);
  if (!inWin.length) return null;
  const peak = inWin.reduce((a, b) => (b.v > a.v ? b : a));
  if (peak.v < WIKI_VIEWS_MIN) return null;
  const spike = peak.v / Math.max(50, median(before) || peak.v);
  const w = spike >= 1.5 ? 0.6 + Math.min(1.4, Math.log2(spike) / 2) : 0.5;
  return { key: 'wiki', w, t: Date.parse(peak.d), role: 'wiki', label: 'Wikipedia', spike, views: peak.v };
}
/** Day-over-day direction of the page's views: the last two days against the two before them. */
function wikiDirection(lookup) {
  const views = okSummary(lookup) && lookup.views;
  if (!views || views.length < 4) return null;
  const v = [...views].sort((a, b) => (a.d < b.d ? -1 : 1)).map((x) => x.v);
  const n = v.length;
  const recent = v[n - 1] + v[n - 2];
  const before = v[n - 3] + v[n - 4];
  if (recent + before < 400) return null;
  const slope = (recent - before) / Math.max(1, before);
  return slope >= 0.25 ? 'rising' : slope <= -0.25 ? 'fading' : 'steady';
}

// ---------- origin ----------
const RECENT_DAYS = 14;
// "What does 'MOG' mean?", "What Is The TikTok 'Phone Ceiling Challenge'?": a headline about the term itself dates it alone
const ABOUT_TERM = /^(?:so )?(?:what|who|wtf|where|why)\b.*\b(?:mean|means|meaning|is|are|explained|come from)\b/i;
const KYM_PUBLISHER = /^(?:know ?your ?meme\b|(?:trending\.)?knowyourmeme\.com$)/i;
// a Know Your Meme page title that is a gallery or a single image, not the entry ("You See How This Looks Right Chris Hansen GIF")
const KYM_NOT_ENTRY = /\b(gifs?|video gallery|image gallery|photos?|images?|meme generator|templates?|examples?|stickers?)$|:/i;
const TITLES_MAX = 15;
/**
 * An open-ended Google News search for the term -> { t, n, recent, kymTitles }.
 *   t          when headlines began naming it: the earliest headline about the term itself (it quotes the term or asks what it is),
 *              or the second-earliest of any that name it (one passing old mention can be a coincidence: "Larping, mogging and
 *              losing its way", 2015)
 *   recent     each outlet whose headline named it in the 14 days before the search, once: [{ key, label, t, title }]. The search
 *              is term-exact, so this is the term's real breadth, beyond the few titles the daily feeds caught
 *   titles     the newest headlines about words or trends that name it: meaning material when the daily feeds' titles give none
 *   kymTitles  Know Your Meme entry names it found ("Wawario and Wawaluigi"): entry pages to try first
 * A term made of plain words counts only in headlines about words, memes or trends; a quote-like catchphrase of three or more words
 * ("That's my husband") is distinctive on its own.
 */
function sinceOf(feedItems, term, fetchedAt = null) {
  const seq = termSeq(term);
  // (a letter or two is never a coinage: "W" is in every obituary's middle initial)
  const coinage = seq.length === 1 && /[a-z]{3}/i.test(term) && X.isCoinage(W.words(term)[0] || '') && !/^\d+$/.test(term);
  const distinctive = coinage || (seq.length >= 3 && X.QUOTE_LIKE.test(term));
  const bare = (x) => x.title.replace(/\s+-\s+[^-]+$/, '');
  const hasTerm = (x) => hasSeq(W.words(bare(x)).map(termStem), seq);
  const inContext = (x) => coinage || CONTEXT_FOR_PLAIN_WORD.test(bare(x));
  const named = (feedItems || []).filter((x) => Number.isFinite(x.t) && hasTerm(x) && (distinctive || inContext(x)));
  // dating needs the context even for a catchphrase: "Kourtney Kardashian boasts 'that's my husband'" (2022) is not this meme
  const dating = named.filter(inContext);
  const dates = dating.map((x) => x.t).sort((a, b) => a - b);
  const quotedRe = new RegExp(`[‘“"']${W.words(term).join('\\W+')}\\W*[’”"']`, 'i');
  const aboutTerm = dating.filter((x) => quotedRe.test(bare(x)) || ABOUT_TERM.test(bare(x)) || KYM_PUBLISHER.test(x.publisher || '')).map((x) => x.t);
  const t = Math.min(aboutTerm.length ? Math.min(...aboutTerm) : Infinity, dates.length >= 2 ? dates[1] : Infinity);
  const at = Number.isFinite(fetchedAt) ? fetchedAt : Math.max(0, ...dates);
  const recent = new Map();
  for (const x of named) {
    if (x.t < at - RECENT_DAYS * DAY || x.t > at + DAY || !x.publisher || KYM_PUBLISHER.test(x.publisher)) continue;
    const key = outletKey(x.publisher);
    // ctx: the headline is about words, memes or trends (else words.js checks it shares a word with the entry's own sources)
    if (!recent.has(key) || recent.get(key).t < x.t) recent.set(key, { key, label: x.publisher, t: x.t, title: bare(x), ctx: inContext(x) });
  }
  // the newest headlines about words or trends that name it, for a meaning when the daily feeds' titles give none
  const titles = dating.filter((x) => x.publisher && !KYM_PUBLISHER.test(x.publisher)).sort((a, b) => b.t - a.t).slice(0, TITLES_MAX)
    .map((x) => ({ title: bare(x), label: x.publisher, t: x.t }));
  // an entry's own name, a few words longer at most ("Wawario and Wawaluigi" for "Wawaluigi"), not a page that mentions it in passing
  const kymTitles = [...new Set((feedItems || []).filter((x) => KYM_PUBLISHER.test(x.publisher || '') && hasTerm(x) && !/[?|]/.test(bare(x)) &&
    !KYM_NOT_ENTRY.test(bare(x)) && W.words(bare(x)).length <= seq.length + 3).map((x) => bare(x)))].slice(0, 3);
  return { term, t: Number.isFinite(t) ? t : null, n: dates.length, recent: [...recent.values()], titles, kymTitles };
}

module.exports = { CONTEXT_FOR_PLAIN_WORD, SLANG_LABEL, parseWikiBatch, parseWikt, okSummary, wikiMeaning, wiktMeaning, kymPageMeanings, wikiEvidence,
  wikiDirection, sinceOf, usageNote, technicalLabel };
