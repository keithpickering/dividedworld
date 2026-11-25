/**
 * The stock lines: what The System says at each standing order when a model call is out of budget
 * or fails, so cost never grows without bound and nothing stalls (design, section 2). The engine
 * names the keys and the tokens a line may carry; the instance writes the lines, in its own voice.
 *
 * Each key's lines are a list, one chosen at random, so a stock line wears thin more slowly.
 */
import { PRONOUN_FORMS, words, type PronounForm, type PronounSet } from '../rules/pronouns.ts';

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

/**
 * A stock line with its tokens filled, for the code that posts one (a meeting's reply to a request): `{name}` for each of `values`, and `{boss.they}` and the rest of `PRONOUN_FORMS` from `bossPronouns` as the SQL's
 * `fill_tokens` does for the tick's. A token the line carries that is neither is left as written. The line is chosen by `pick` over the list, so a retried meeting writes what the first would have.
 */
export function fillStockLine(lines: readonly string[], pick: number, values: Readonly<Record<string, string>>, bossPronouns: PronounSet): string | null {
  if (lines.length === 0) return null;
  const forms = words(bossPronouns);
  const line = lines[((pick % lines.length) + lines.length) % lines.length]!;
  return line.replace(/\{([A-Za-z]+)(?:\.([A-Za-z]+))?\}/g, (whole, name: string, form: string | undefined) => {
    if (form === undefined) return values[name] ?? whole;
    return name === 'boss' && (PRONOUN_FORMS as readonly string[]).includes(form) ? forms[form as PronounForm] : whole;
  });
}
