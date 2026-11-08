/**
 * Divided World's voice for a `trapStruck` alert (`AlertCopy.trapStruck`; the face-down Moves design, section 5). The glass may gloat here,
 * as the player whose card was set face down would, and it never bluffs: each line says only what the spring already shows everyone, the
 * setter's character, the card and how long it was set face down before it sprang. It names no account and no class.
 */
import type { TrapStruckFacts } from '../../../engine/ui/types.ts';

export function trapStruckWords(f: TrapStruckFacts): { readonly line: string; readonly detail: string } | undefined {
  if (f.setter === null || f.card === null) return undefined;
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
    line: `${f.setter} had a Trap Card waiting.`,
    detail: `It named your ${f.card} exactly${f.span ? `, and it had been face down for ${f.span} when you cast it` : ''}. ${f.card} ${f.setterStaff ? 'is spent' : `is ${f.setter}'s now`}.`,
  };
}
