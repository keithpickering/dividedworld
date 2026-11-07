/**
 * The stock lines: what The System says at each standing order when a model call is out of budget
 * or fails, so cost never grows without bound and nothing stalls (design, section 2). The engine
 * names the keys and the tokens a line may carry; the instance writes the lines, in its own voice.
 *
 * Each key's lines are a list, one chosen at random, so a stock line wears thin more slowly.
 */
export const STOCK_LINE_KEYS = ['moveLanded', 'moveMet', 'moveExpired', 'moveReversed', 'moveSuperseded', 'moveUnmet', 'moveOverturned', 'bossFarewell', 'bossArrival', 'boardDescription', 'ruleSet', 'visitArrived', 'visitFiled', 'reportDismissed', 'reportBackfired', 'appealOverturned', 'appealUpheld', 'appealReduced', 'appealIncreased'] as const;
export type StockLineKey = (typeof STOCK_LINE_KEYS)[number];

/**
 * The `{tokens}` a line may carry, by key: `{move}` is the move's plain name, `{boss}` a Boss's name, `{board}` a board's name ("every board" for a house
 * rule), `{rule}` a rule as it will be numbered and worded in plain words ("Rule 3: no double posting", "House Rule 1: no all-caps posts"). For a visit, `{mod}` is the Mod's name and `{rule}` the rules charged, in words, one after another. For a report's verdict, `{mod}` is the Mod's name and `{reporter}` the reporter's public name. For an appeal's ruling, `{mod}` is the hearer's name and `{appellant}` the appellant's public name.
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
};
