/**
 * Divided World's voice for a `trapStruck` alert (`AlertCopy.trapStruck`; the face-down Moves design, section 5). The glass may gloat here,
 * as the player whose card was set face down would, and it never bluffs: each line says only what the spring already shows everyone, the
 * setter's character, the card and how long it was set face down before it sprang. It names no account and no class.
 */
import type { TrapStruckFacts } from '../../../engine/ui/types.ts';
import { fourDChess } from '../cards/4d-chess.ts';

export function trapStruckWords(f: TrapStruckFacts): { readonly line: string; readonly detail: string } | undefined {
  if (f.setter === null) return undefined;
  /* A ride back's cast landed as usual: the voice says only what the spring shows everyone, that the Move it named was cast and the setter is paid for its reactions. The setter's card is 4D Chess, the only one that rides, and is named so where the spring was not read. */
  if (f.how === 'rode') {
    return {
      line: `${f.setter} wanted you to do that.`,
      detail: `Their face-down ${f.card ?? fourDChess.name} named your ${f.laid ?? 'cast'}. It landed as usual and you keep everything it earns; ${f.setter} is paid for the reactions it draws.`,
    };
  }
  if (f.card === null) return undefined;
  if (f.how === 'quote') {
    /* The engine hands the matched conditions already shortened and quoted; each is a fact of the spring, so the voice may gloat about it and says no more. */
    const matched = Boolean(f.passage || f.says);
    const quoted = f.passage ? `quoted ${f.passage}` : 'quoted their post';
    return {
      line: matched ? `${f.setter} was waiting for exactly that.` : `${f.setter} saw this coming.`,
      detail: `Their face-down ${f.card} sprang when you ${quoted}${f.says ? ` saying ${f.says}` : ''}${f.span ? `, ${f.span} after they set it` : ''}.`,
    };
  }
  return {
    line: `${f.setter} had a Reversal waiting.`,
    detail: `It caught your ${f.card}${f.span ? `, and it had been face down for ${f.span} when you cast it` : ''}. ${f.card} ${f.setterStaff ? 'is spent' : `is ${f.setter}'s now`}.`,
  };
}
