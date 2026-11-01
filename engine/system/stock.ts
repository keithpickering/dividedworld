/**
 * The stock lines: what The System says at each standing order when a model call is out of budget
 * or fails, so cost never grows without bound and nothing stalls (design, section 2). The engine
 * names the keys and the tokens a line may carry; the instance writes the lines, in its own voice.
 *
 * Each key's lines are a list, one chosen at random, so a stock line wears thin more slowly.
 */
export const STOCK_LINE_KEYS = ['moveLanded', 'moveMet', 'moveExpired', 'moveReversed', 'bossFarewell', 'bossArrival', 'boardDescription'] as const;
export type StockLineKey = (typeof STOCK_LINE_KEYS)[number];

/** The `{tokens}` a line may carry, by key: `{move}` is the move's plain name, `{boss}` a Boss's name, `{board}` a board's name. */
export const STOCK_LINE_TOKENS: Readonly<Record<StockLineKey, readonly string[]>> = {
  moveLanded: ['move'],
  moveMet: ['move'],
  moveExpired: ['move'],
  moveReversed: ['move'],
  bossFarewell: ['boss'],
  bossArrival: ['boss'],
  boardDescription: ['board'],
};
