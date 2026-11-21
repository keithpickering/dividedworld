/**
 * Divided World's voice for a `trapStruck` alert (`AlertCopy.trapStruck`; the face-down Moves design, section 5). The glass may gloat here,
 * as the player whose card was set face down would, and it never bluffs: each line says only what the spring already shows everyone, the
 * setter's character, the card and how long it was set face down before it sprang. It names no account and no class.
 */
import type { TrapStruckFacts } from '../../../engine/ui/types.ts';
import { cards } from '../cards/index.ts';

export function trapStruckWords(f: TrapStruckFacts): { readonly line: string; readonly detail: string } | undefined {
  /* A pierce's cast got past a card set face down: nothing about the back is public, so no setter is named. The voice may gloat, and says only that the card stays face down and its setter is not told. */
  if (f.how === 'passed') {
    return {
      line: 'Cheap shot! It slipped right past.',
      detail: `Your ${f.card ?? 'card'} got your ${f.laid ?? 'Move'} past a card set face down. That card stays face down, and the one who set it is not told.`,
    };
  }
  if (f.setter === null) return undefined;
  /* A ride back's cast landed as usual: the voice says only what the spring shows everyone. A setter's card that names its card (`catches`, 4D Chess) says it named the cast; one that names none (Whoopee Cushion) says it sprang on it. Where the spring was not read (`f.card` null) more than one card rides, so the card is only "card". */
  if (f.how === 'rode') {
    const card = f.card === null ? undefined : cards.find((c) => c.name === f.card);
    const named = card?.catches !== undefined;
    return {
      /* Whoopee Cushion's own line is the owner's (#902); every other ride, and an unread card, keep the setter's gloat. */
      line: card?.key === 'whoopee-cushion' ? `PFFFT! You sat on ${f.setter}'s whoopee cushion.` : `${f.setter} wanted you to do that.`,
      detail: named
        ? `Their face-down ${f.card} named your ${f.laid ?? 'cast'}. It landed as usual and you keep everything it earns; ${f.setter} is paid for the reactions it draws.`
        : `Their face-down ${f.card ?? 'card'} sprang on your ${f.laid ?? 'cast'}. It landed as usual and you keep everything it earns; ${f.setter} is paid for ${f.card === null ? 'the reactions' : 'every reaction'} it draws.`,
    };
  }
  /* A refund back's cast landed as usual and its card went back to its caster: the glass may be warm, and it says only what the spring shows everyone. Where the spring was not read (`f.card` null) it is only "card". */
  if (f.how === 'returned') {
    return { line: 'Paid forward', detail: `Their face-down ${f.card ?? 'card'} sprang on your ${f.laid ?? 'Move'}. It landed as usual, and the card is back in your hand.` };
  }
  /* A lockout back's Move landed as usual and its player is locked out of the thread until the time the spring shows: the voice may be smug, and says only what the spring shows everyone. Where the spring was not read (`f.card` null) it is only "card". */
  if (f.how === 'lockedOut') {
    /* Once an admin has ended the lockout, the voice says it was, in the past tense; the engine adds the time it was ended. */
    const until = f.until ? ` until ${f.until}` : '';
    return {
      line: 'So very happy for you',
      detail: `Their face-down ${f.card ?? 'card'} sprang on your ${f.laid ?? 'Move'}. It landed as usual, and you ${f.ended ? 'were' : 'are'} locked out of this thread${until}.`,
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
