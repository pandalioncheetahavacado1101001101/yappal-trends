# word-senses.json: licence and credit

`word-senses.json` is a separate file under its own licence. It is not covered by the licence of the code around it.

**Credit:** English Wiktionary contributors, via wiktextract on kaikki.org (T. Ylonen, LREC 2022). CC BY-SA 4.0 and GFDL; files built from it stay CC BY-SA.

- Source: English Wiktionary (https://en.wiktionary.org), from the extract https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz (dump built 2026-10-03).
- Licence: Creative Commons Attribution-ShareAlike 4.0 International (https://creativecommons.org/licenses/by-sa/4.0/), and GFDL.
- Changes: senses selected for the Ideas collector (the words it has met, plus a reserve of recent slang). Glosses cut to 240 characters. Every kept sense keeps its words and its labels; a sense the dictionary marks offensive, vulgar or derogatory is shown with that label.
- Share-alike: this file, and any file built from it, stays under CC BY-SA 4.0.
- Anything shown from it, such as a card line in the feed or the app, credits "Wiktionary, CC BY-SA 4.0" with a link. The collector names Wiktionary first in such a row's sources.

Built by `lib/sense/build.js` from `scripts/build-data/slang-senses.json` (see `scripts/build-data/slang-senses.README.md`). Rebuild it each month, when that file is rebuilt.
