'use strict';
/*
 * The dictionary's own register label for a sense (B8): what a line from it says before the sense when Wiktionary marks it
 * offensive, vulgar, derogatory, pejorative or a slur ("Vulgar slang: ..."), in the dictionary's own words and order. Nothing is
 * withheld or swapped here: a sense people mean is shown whatever it says (no content filtering), with the label the dictionary
 * gives it, as a dictionary page would show it.
 */
const REGISTER = ['ethnic slur', 'slur', 'offensive', 'vulgar', 'derogatory', 'pejorative'];

/** The register words a sense's label carries, in the label's own order ("transitive, vulgar, slang" -> ["vulgar"]). */
function registersOf(label) {
  const l = String(label || '').toLowerCase();
  const found = REGISTER.map((w) => ({ w, at: l.search(new RegExp(`(?<![a-z])${w}(?![a-z])`)) })).filter((x) => x.at >= 0);
  // ("ethnic slur" is one label, not an ethnic one and a slur)
  const kept = found.filter((x) => !(x.w === 'slur' && found.some((y) => y.w === 'ethnic slur')));
  return kept.sort((a, b) => a.at - b.at).map((x) => x.w);
}
/**
 * What a line says before a marked sense: "vulgar slang", "ethnic slur, offensive slang", "derogatory", or null for a sense the
 * dictionary marks with none of these.
 */
function registerOf(label) {
  const marks = registersOf(label);
  if (!marks.length) return null;
  return `${marks.join(', ')}${/(?<![a-z])slang(?![a-z])/i.test(String(label || '')) ? ' slang' : ''}`;
}

module.exports = { registerOf, registersOf, REGISTER };
