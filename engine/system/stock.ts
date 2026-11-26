/**
 * The stock lines: what The System says at each standing order when a model call is out of budget
 * or fails, so cost never grows without bound and nothing stalls (design, section 2). The engine
 * names the keys and the tokens a line may carry; the instance writes the lines, in its own voice.
 *
 * Each key's lines are a list, one chosen at random, so a stock line wears thin more slowly.
 */
import { PRONOUN_FORMS } from '../rules/pronouns.ts';
import type { SystemContent } from '../rules/types.ts';
import { cutAtSentence } from './chatter.ts';
import type { Trim } from './validate.ts';

export { PRONOUN_FORMS };

/** The tokens that name a staff character and so take a pronoun form after a dot (`{mod.they}`, `{boss.Their}`). */
export const STAFF_TOKENS = ['boss', 'mod'] as const;

export const STOCK_LINE_KEYS = ['moveLanded', 'moveMet', 'moveExpired', 'moveReversed', 'moveSuperseded', 'moveUnmet', 'moveOverturned', 'bossFarewell', 'bossArrival', 'boardDescription', 'ruleSet', 'visitArrived', 'visitFiled', 'reportDismissed', 'reportBackfired', 'appealOverturned', 'appealUpheld', 'appealReduced', 'appealIncreased', 'requestGranted', 'requestRefused', 'requestLapsed'] as const;
export type StockLineKey = (typeof STOCK_LINE_KEYS)[number];

/**
 * The `{tokens}` a line may carry, by key: `{move}` is the move's plain name, `{boss}` a Boss's name, `{board}` a board's name ("every board" for a house
 * rule), `{rule}` a rule as it will be numbered and worded in plain words ("Rule 3: no double posting", "House Rule 1: no all-caps posts"). For a visit, `{mod}` is the Mod's name and `{rule}` the rules charged, in words, one after another. For a report's verdict, `{mod}` is the Mod's name and `{reporter}` the reporter's public name. For an appeal's ruling, `{mod}` is the hearer's name and `{appellant}` the appellant's public name.
 *
 * The staff tokens, `STAFF_TOKENS` (`{boss}` and `{mod}`, whose holder changes), also take the holder's pronouns: `{mod.they}`, `{boss.Their}`, `{mod.is}`, `{mod.s}` and the rest of `PRONOUN_FORMS`, whose keys are the they-set's words and whose values are the character's own. `{reporter}` and `{appellant}` are names only.
 */
export const STOCK_LINE_TOKENS: Readonly<Record<StockLineKey, readonly string[]>> = {
  moveLanded: ['move'],
  moveMet: ['move'],
  moveExpired: ['move'],
  moveReversed: ['move'],
  moveSuperseded: ['move'],
  moveUnmet: ['move'],
  moveOverturned: ['move'],
  bossFarewell: ['boss'],
  bossArrival: ['boss'],
  boardDescription: ['board'],
  ruleSet: ['rule', 'board'],
  visitArrived: ['mod', 'rule'],
  visitFiled: ['mod', 'rule'],
  reportDismissed: ['mod', 'reporter'],
  reportBackfired: ['mod', 'reporter'],
  appealOverturned: ['mod', 'appellant'],
  appealUpheld: ['mod', 'appellant'],
  appealReduced: ['mod', 'appellant'],
  appealIncreased: ['mod', 'appellant'],
  requestGranted: ['boss', 'asker'],
  requestRefused: ['boss', 'asker'],
  requestLapsed: ['boss', 'asker'],
};

/** The keys of a line owed for an act that has already happened: posted by its speaker's call, else from the speaker's stock lines, else not at all. */
export const OWED_KEYS = ['moveMet', 'moveExpired', 'moveUnmet', 'moveSuperseded', 'moveReversed', 'moveOverturned', 'requestLapsed', 'bossArrival'] as const satisfies readonly StockLineKey[];

/** The keys of a line written ahead for a move's landing: `moveLanded`, or `ruleSet` for a `setRule`. */
export const LANDING_KEYS = ['moveLanded', 'ruleSet'] as const satisfies readonly StockLineKey[];

/** The lines a speaker says at a standing order: the roster persona's own list for the key, else the instance's. */
export function stockLinesOf(system: Pick<SystemContent, 'roster' | 'stockLines'>, speaker: string, key: StockLineKey): readonly string[] {
  return system.roster.find((p) => p.key === speaker)?.stockLines[key] ?? system.stockLines[key];
}

/** The most characters of a landing line a move carries (the database holds the same in `queued_moves.line`). */
export const LANDING_LINE_MOST = 280;

/**
 * A landing line as the model wrote it, repaired and never rejected: whitespace collapsed, a `{token}` the landing key is not given
 * stripped of its braces (nested braces too) (the word inside stays; recorded as `tokens(<key>)`), then cut at a sentence to `LANDING_LINE_MOST` (recorded).
 * Blank, or not text, is none (null) and the move lands with the speaker's stock line. The trims' paths are `line`; the caller prefixes them.
 */
export function repairLandingLine(raw: unknown, key: (typeof LANDING_KEYS)[number]): { readonly line: string | null; readonly trims: readonly Trim[] } {
  let text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (text === '') return { line: null, trims: [] };
  const trims: Trim[] = [];
  const given = STOCK_LINE_TOKENS[key];
  let stripped = 0;
  // Repeat until stable, so a nested brace never survives as a token the key is not given: `{{boss}}` is `boss` (two strips), and an allowed token
  // inside stray braces, `{{move}}`, keeps `{move}` with the outer pair stripped (one strip). Every strip is counted.
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(/\{(\{[^{}]*\})\}/g, (_whole, inner: string) => { stripped++; return inner; });
    text = text.replace(/\{([^{}]*)\}/g, (whole, token: string) => {
      const [name, form, ...extra] = token.split('.');
      const fine = form === undefined ? given.includes(token) : given.includes(name!) && (STAFF_TOKENS as readonly string[]).includes(name!) && !extra.length && (PRONOUN_FORMS as readonly string[]).includes(form);
      if (fine) return whole;
      stripped++;
      return token;
    });
  }
  if (stripped) trims.push({ path: 'line', predicate: `tokens(${key})`, before: stripped, after: 0 });
  if (text.length > LANDING_LINE_MOST) {
    const cut = cutAtSentence(text, LANDING_LINE_MOST);
    trims.push({ path: 'line', predicate: `maxLength(${LANDING_LINE_MOST})`, before: text.length, after: cut.length });
    text = cut;
  }
  return { line: text, trims };
}
