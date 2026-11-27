/**
 * The outcome quote's cases: (body, room) and the words each should quote, one list for two languages ("Two lists that must
 * agree are one list"). `outcomeQuote(target, body, room)` (engine/bbcode/outcome-quote.ts) gives `[quote=<target>]<words>[/quote]\n`,
 * or '' where `words` is null; engine/bbcode/outcome-quote.test.ts and engine/ui/data/fake.test.tsx hold the engine to them.
 * tools/outcome-quote-fixtures.mjs makes supabase/tests/0452-outcome-quotes-parity.sql from the same list, which holds the database's
 * `outcome_quote(target, room)` (supabase/migrations/0452_outcome_quotes.sql) to the same words, and
 * tools/check-outcome-quote-fixtures.mjs holds that file to exactly what the list makes.
 *
 * `room` is what the words, the ellipsis and the `[noparse]` cover may take in all (the 53 characters of the markup are out already).
 * `{Q}` in a body stands for the id of another post, so a case can open with a real quote. The list is JSON after the marker line
 * below, so the generator can read it without a TypeScript loader; add a case by adding an object, then run
 * `node tools/outcome-quote-fixtures.mjs`. The two 280 cases sit on the boundary: 280 code points are quoted whole, 281 are cut (varied letters, since a long run of one letter is squashed to a few by the parser).
 */
export interface OutcomeQuoteFixture {
  readonly name: string;
  readonly body: string;
  readonly room: number;
  /** The words inside the quote, or null where the room leaves no quote at all. */
  readonly words: string | null;
}

export const OUTCOME_QUOTE_FIXTURES: readonly OutcomeQuoteFixture[] = [
  {
    "name": "whole",
    "body": "Hello  [b]big\nworld[/b]",
    "room": 100,
    "words": "Hello big world"
  },
  {
    "name": "cut at a word",
    "body": "alpha beta gamma",
    "room": 9,
    "words": "alpha…"
  },
  {
    "name": "hard cut, shrunk by the ellipsis",
    "body": "abcdefghijklmnop",
    "room": 6,
    "words": "abcde…"
  },
  {
    "name": "noparse wrap",
    "body": "[noparse]see [b] now[/noparse]",
    "room": 40,
    "words": "[noparse]see [b] now[/noparse]"
  },
  {
    "name": "a [/noparse] escape",
    "body": "a [/noparse] b",
    "room": 60,
    "words": "[noparse]a [/noparse[/noparse][noparse]] b[/noparse]"
  },
  {
    "name": "astral characters",
    "body": "😀😁😂 😃😄😅",
    "room": 5,
    "words": "😀😁😂…"
  },
  {
    "name": "leading quote skipped",
    "body": "[quote={Q}]first words[/quote] my reply",
    "room": 100,
    "words": "my reply"
  },
  {
    "name": "no room",
    "body": "some words",
    "room": 1,
    "words": null
  },
  {
    "name": "280 code points whole, 281 cut: exactly 280",
    "body": "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh",
    "room": 1000,
    "words": "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh"
  },
  {
    "name": "280 code points whole, 281 cut: 281 is cut",
    "body": "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghi",
    "room": 1000,
    "words": "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh…"
  }
];
