/**
 * The phrase-matcher fixtures: BBCode bodies, a phrase, and whether the phrase is in the body's visible text as a whole word, one list for two
 * languages ("Two lists that must agree are one list"). `found` is `phraseIn(visibleText(parse(body)), phrase)`, which engine/bbcode/phrase.test.ts
 * holds against the engine's matcher (engine/bbcode/phrase.ts over engine/bbcode/visible.ts and parse.ts). tools/phrase-sql.mjs makes
 * supabase/tests/0136-phrase.sql from the same list, which holds the database's `phrase_in(bbcode_plain(body), phrase)`
 * (supabase/migrations/0142_face_down_moves.sql) to the same answers, and tools/check-phrase-sql.mjs holds that file to exactly what the list makes.
 *
 * The list is JSON after the marker line below, so tools/phrase-sql.mjs can read it without a TypeScript loader; add a fixture by adding an object,
 * then run `node tools/phrase-sql.mjs`. The bodies go through the same text on both sides (visibleText(parse(body)) and bbcode_plain(body)), so a
 * quote, code, a link and an image are held out the same way; the case folds where JavaScript's `i` flag and Postgres's `lower()` part (dotless i,
 * dotted capital I, final sigma, long s, the micro sign) are fixtures too.
 */
export interface PhraseFixture {
  readonly name: string;
  readonly body: string;
  readonly phrase: string;
  readonly found: boolean;
}

export const PHRASE_FIXTURES: readonly PhraseFixture[] = [
  {
    "name": "an empty phrase matches nothing",
    "body": "some words",
    "phrase": "",
    "found": false
  },
  {
    "name": "a phrase with no letter or digit matches nothing",
    "body": "wow!! ... ok",
    "phrase": "!!",
    "found": false
  },
  {
    "name": "the phrase at the start",
    "body": "cats are here",
    "phrase": "cats",
    "found": true
  },
  {
    "name": "the phrase at the end",
    "body": "here are cats",
    "phrase": "cats",
    "found": true
  },
  {
    "name": "the phrase alone",
    "body": "cats",
    "phrase": "cats",
    "found": true
  },
  {
    "name": "the phrase inside a longer word",
    "body": "concatenate it",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "the phrase at the front of a longer word",
    "body": "cats everywhere",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "the phrase at the back of a longer word",
    "body": "the bobcat",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "next to punctuation",
    "body": "Is it the cat? Yes: (cat), \"cat\", cat.",
    "phrase": "cat",
    "found": true
  },
  {
    "name": "punctuation inside a word no longer splits it",
    "body": "don't cat_alog",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a phrase with spaces",
    "body": "I said good morning to all",
    "phrase": "good morning",
    "found": true
  },
  {
    "name": "a phrase with a regular-expression character",
    "body": "what is 2+2? it is (a.b)",
    "phrase": "(a.b)",
    "found": true
  },
  {
    "name": "a phrase with a dot is not a wildcard",
    "body": "axb",
    "phrase": "a.b",
    "found": false
  },
  {
    "name": "a plus sign is not a repeat",
    "body": "use c++ now",
    "phrase": "c++",
    "found": true
  },
  {
    "name": "a phrase ending on a symbol, beside more symbols",
    "body": "c+++ x",
    "phrase": "c++",
    "found": true
  },
  {
    "name": "brackets are not a class",
    "body": "see [a] here",
    "phrase": "[a]",
    "found": true
  },
  {
    "name": "brackets around a phrase are ignored",
    "body": "see a here",
    "phrase": "[a]",
    "found": true
  },
  {
    "name": "a backslash is not an escape",
    "body": "type a \\d b",
    "phrase": "\\d",
    "found": true
  },
  {
    "name": "a backslash-d is not a digit",
    "body": "a 5 b",
    "phrase": "\\d",
    "found": false
  },
  {
    "name": "a dollar sign is not the end",
    "body": "it costs $5 today",
    "phrase": "$5",
    "found": true
  },
  {
    "name": "a caret is not the start",
    "body": "a ^b c",
    "phrase": "^b",
    "found": true
  },
  {
    "name": "braces are not a count",
    "body": "xx and x{2}",
    "phrase": "x{2}",
    "found": true
  },
  {
    "name": "braces do not count the letter",
    "body": "xx here",
    "phrase": "x{2}",
    "found": false
  },
  {
    "name": "a bar is not an alternative",
    "body": "just a here",
    "phrase": "a|b",
    "found": false
  },
  {
    "name": "a star is not a repeat",
    "body": "aaa",
    "phrase": "a*",
    "found": false
  },
  {
    "name": "a question mark is not optional",
    "body": "whatx",
    "phrase": "what?",
    "found": false
  },
  {
    "name": "a question mark is itself",
    "body": "so what? fine",
    "phrase": "what?",
    "found": true
  },
  {
    "name": "mixed case",
    "body": "CaTs and DOGS",
    "phrase": "cats",
    "found": true
  },
  {
    "name": "mixed case in the phrase",
    "body": "cats and dogs",
    "phrase": "DoGs",
    "found": true
  },
  {
    "name": "in a quote only",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]the cat sat[/quote] and nothing else",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "in a quote and outside it",
    "body": "[quote=0f8fad5b-d9cb-469f-a165-70867728950e]the cat sat[/quote] my cat did not",
    "phrase": "cat",
    "found": true
  },
  {
    "name": "a quote does not join words across it",
    "body": "ca[quote=0f8fad5b-d9cb-469f-a165-70867728950e]x[/quote]t",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a quote with a name that is no Act is a counterfeit and keeps its words",
    "body": "[quote=zz]the cat[/quote]",
    "phrase": "cat",
    "found": true
  },
  {
    "name": "in code only",
    "body": "[code]the cat sat[/code]",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "in a link's words only",
    "body": "[url=https://example.com/]the cat[/url]",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "in a bare link only",
    "body": "[url]https://example.com/cat[/url]",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "in an image only",
    "body": "[img]https://example.com/cat.png[/img]",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "across bold",
    "body": "the [b]cat[/b] sat",
    "phrase": "the cat",
    "found": true
  },
  {
    "name": "inside bold and joined to a letter",
    "body": "ca[b]ts[/b]",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a list item",
    "body": "[list][*]cat[*]dog[/list]",
    "phrase": "dog",
    "found": true
  },
  {
    "name": "an unclosed counterfeit quote keeps its words",
    "body": "[quote=Geno]the cat",
    "phrase": "cat",
    "found": true
  },
  {
    "name": "an unclosed bold keeps its words",
    "body": "[b]loud [i]cat",
    "phrase": "cat",
    "found": true
  },
  {
    "name": "an accented letter beside it",
    "body": "a café, not a cafe",
    "phrase": "cafe",
    "found": true
  },
  {
    "name": "an accented letter makes a longer word",
    "body": "cafés",
    "phrase": "cafe",
    "found": false
  },
  {
    "name": "an accented phrase in capitals",
    "body": "CAFÉ au lait",
    "phrase": "café",
    "found": true
  },
  {
    "name": "a Cyrillic phrase in capitals",
    "body": "ПРИВЕТ, мир",
    "phrase": "привет",
    "found": true
  },
  {
    "name": "a Cyrillic letter inside a longer word",
    "body": "приветствие",
    "phrase": "привет",
    "found": false
  },
  {
    "name": "Greek, capital and small",
    "body": "ΑΘΗΝΑ και Αθήνα",
    "phrase": "αθήνα",
    "found": true
  },
  {
    "name": "Japanese letters",
    "body": "こんにちは世界",
    "phrase": "こんにちは",
    "found": false
  },
  {
    "name": "Japanese letters with a space",
    "body": "こんにちは 世界",
    "phrase": "こんにちは",
    "found": true
  },
  {
    "name": "a digit beside it",
    "body": "cat2 and 3cat",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a combining vowel sign is not a letter",
    "body": "कि",
    "phrase": "क",
    "found": true
  },
  {
    "name": "a decomposed accent is not a letter",
    "body": "café au lait",
    "phrase": "cafe",
    "found": true
  },
  {
    "name": "a superscript number is a number",
    "body": "cat² and cat",
    "phrase": "cat",
    "found": true
  },
  {
    "name": "a superscript number beside it only",
    "body": "cat²",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a circled digit beside it only",
    "body": "cat②",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a Roman numeral beside it only",
    "body": "catⅧ",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "a digit phrase",
    "body": "room 101 is open",
    "phrase": "101",
    "found": true
  },
  {
    "name": "a digit phrase inside a longer number",
    "body": "room 1012 is open",
    "phrase": "101",
    "found": false
  },
  {
    "name": "a digit phrase with a letter beside it",
    "body": "a101",
    "phrase": "101",
    "found": false
  },
  {
    "name": "an underscore inside a word is ignored, so the word is one",
    "body": "the_cat",
    "phrase": "cat",
    "found": false
  },
  {
    "name": "dotless i does not fold to i",
    "body": "ISTANBUL ıstanbul",
    "phrase": "ı",
    "found": false
  },
  {
    "name": "dotless i matches itself",
    "body": "a word ı alone",
    "phrase": "ı",
    "found": true
  },
  {
    "name": "dotted capital I does not fold to i",
    "body": "İstanbul",
    "phrase": "istanbul",
    "found": false
  },
  {
    "name": "dotted capital I matches itself",
    "body": "İstanbul",
    "phrase": "İSTANBUL",
    "found": true
  },
  {
    "name": "capital I folds to i",
    "body": "ISTANBUL",
    "phrase": "istanbul",
    "found": true
  },
  {
    "name": "sharp s does not fold to ss",
    "body": "Straße",
    "phrase": "strasse",
    "found": false
  },
  {
    "name": "sharp s matches itself in capitals",
    "body": "STRAßE",
    "phrase": "straße",
    "found": true
  },
  {
    "name": "capital sharp s folds to sharp s",
    "body": "STRAẞE",
    "phrase": "straße",
    "found": true
  },
  {
    "name": "final sigma folds to sigma",
    "body": "ΟΔΥΣΣΕΥΣ and οδυσσευς",
    "phrase": "οδυσσευσ",
    "found": true
  },
  {
    "name": "sigma folds to final sigma",
    "body": "οδυσσευσ",
    "phrase": "οδυσσευς",
    "found": true
  },
  {
    "name": "capital sigma folds to final sigma",
    "body": "ΟΔΥΣΣΕΥΣ",
    "phrase": "οδυσσευς",
    "found": true
  },
  {
    "name": "long s folds to s",
    "body": "ſtill here",
    "phrase": "still",
    "found": true
  },
  {
    "name": "Kelvin sign folds to k",
    "body": "the King",
    "phrase": "king",
    "found": true
  },
  {
    "name": "micro sign folds to mu",
    "body": "a µm and a μm",
    "phrase": "μm",
    "found": true
  },
  {
    "name": "an astral letter",
    "body": "a 𐐀 b",
    "phrase": "𐐨",
    "found": true
  },
  {
    "name": "looser: an apostrophe inside a word is ignored, \"dont\" finds \"don't\"",
    "body": "Don't do that",
    "phrase": "dont",
    "found": true
  },
  {
    "name": "looser: and \"don't\" finds \"dont\"",
    "body": "I dont know",
    "phrase": "don't",
    "found": true
  },
  {
    "name": "looser: a curly apostrophe is ignored too",
    "body": "I don’t know",
    "phrase": "dont",
    "found": true
  },
  {
    "name": "looser: \"e-mail\" finds \"email\"",
    "body": "send an email",
    "phrase": "e-mail",
    "found": true
  },
  {
    "name": "looser: \"email\" finds \"e-mail\"",
    "body": "send an e-mail",
    "phrase": "email",
    "found": true
  },
  {
    "name": "looser: \"U.S.A.\" finds \"USA\"",
    "body": "the USA wins",
    "phrase": "U.S.A.",
    "found": true
  },
  {
    "name": "looser: \"usa\" finds \"U.S.A.\"",
    "body": "the U.S.A. wins",
    "phrase": "usa",
    "found": true
  },
  {
    "name": "looser: punctuation between words is any other punctuation, \"nice try\" finds \"Nice... try!\"",
    "body": "Nice... try!",
    "phrase": "nice try",
    "found": true
  },
  {
    "name": "looser: \"nice try\" does not find \"nice-try\", which reads as one word",
    "body": "what a nice-try",
    "phrase": "nice try",
    "found": false
  },
  {
    "name": "looser: \"don\" does not find \"don't\"",
    "body": "I don't know",
    "phrase": "don",
    "found": false
  },
  {
    "name": "looser: \"dont\" does not find \"don\"",
    "body": "I don know",
    "phrase": "dont",
    "found": false
  },
  {
    "name": "looser: a phrase is not found across a line break",
    "body": "nice\ntry",
    "phrase": "nice try",
    "found": false
  },
  {
    "name": "looser: a phrase is not found across a quote's separator",
    "body": "nice [quote=0f8fad5b-d9cb-469f-a165-70867728950e]x[/quote] try",
    "phrase": "nice try",
    "found": false
  },
  {
    "name": "looser: punctuation at the phrase's end is ignored, \"wow!\" finds \"wow, that\"",
    "body": "wow, that is something",
    "phrase": "wow!",
    "found": true
  },
  {
    "name": "looser: and \"wow\" finds \"wow!\"",
    "body": "wow!",
    "phrase": "wow",
    "found": true
  },
  {
    "name": "looser: punctuation at the phrase's start is ignored",
    "body": "say (hello) now",
    "phrase": "(hello)",
    "found": true
  },
  {
    "name": "looser: a phrase that normalizes to nothing matches nothing",
    "body": "?! ... ?!",
    "phrase": "?! ...",
    "found": false
  },
  {
    "name": "looser: a non-breaking space is a space",
    "body": "nice try",
    "phrase": "nice try",
    "found": true
  },
  {
    "name": "looser: an ideographic space is a space",
    "body": "你好　世界",
    "phrase": "你好 世界",
    "found": true
  },
  {
    "name": "looser: CJK punctuation inside a word is ignored",
    "body": "你好，世界",
    "phrase": "你好世界",
    "found": true
  },
  {
    "name": "looser: and CJK punctuation does not make a space the phrase has",
    "body": "你好，世界",
    "phrase": "你好 世界",
    "found": false
  },
  {
    "name": "looser: CJK punctuation before a space is one space",
    "body": "你好。 世界",
    "phrase": "你好 世界",
    "found": true
  },
  {
    "name": "looser: an Arabic comma before a space is one space",
    "body": "مرحبا، بالعالم",
    "phrase": "مرحبا بالعالم",
    "found": true
  },
  {
    "name": "looser: an Arabic comma inside a word is ignored",
    "body": "مرحبا،بالعالم",
    "phrase": "مرحبابالعالم",
    "found": true
  },
  {
    "name": "looser: a phrase's many spaces are one",
    "body": "nice   try",
    "phrase": "nice try",
    "found": true
  }
];
