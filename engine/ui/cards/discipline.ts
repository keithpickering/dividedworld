/**
 * What the Lens says of a discipline card's play (card notes, part 5, Task 7): the four effects an instance's cards may pick (`CardRules.discipline`), in plain words that name
 * who each landed on and say how it ends. The words are the engine's, keyed by the effect and never by a card, so an instance names no sentence here; the card's own heading
 * (`CardUi.status`) stands above them. Plain and true for every reader, in the glass's voice, never in character: each names only public characters, by their public names,
 * and says nothing of an owner, a class or who reacted. Pure: the Lens gives the names and the play.
 */
import type { DisciplineEffect } from '../../rules/cards.ts';
import { dayAndTime } from '../characters/format.ts';
import type { CardPlay } from './types.ts';

/** How a fall waiting ends, as its view's way out: by a filing or by an admin ("No player is ever stuck"). */
export const FALL_ENDS = 'Ends when a visit to this post files, or when an admin ends it.';

/** The public names a play's words use: the character it landed on, the one that played it, and the author of the post it is on. */
export interface DisciplineNames {
  readonly target: string;
  readonly caster: string;
  readonly author: string;
}

/** "1 warn point", "2 warn points". */
export const warnPoints = (n: number): string => `${n} warn point${n === 1 ? '' : 's'}`;

/** "twice", or "3 times": how many times as likely a watch makes a patrol to look. */
export const timesWords = (weight: number): string => (weight === 2 ? 'twice' : `${weight} times`);

/**
 * The note a discipline play's Lens row carries, or null where the play does not say enough to speak (a relief with no `took`, a watch with no end). A fall says whether a filing
 * has spent it (`CardPlay.spent`, from the page); a heart and an Unban, which are over when they land, say what they did and when. A watch whose time has passed (`now`, the Lens's clock) is said in the past tense.
 */
export function disciplineNote(effect: DisciplineEffect, play: CardPlay, names: DisciplineNames, now: number): string | null {
  switch (effect.kind) {
    case 'relief':
      return play.took === undefined ? null : `Took ${warnPoints(play.took)} off ${names.target}'s warn bar on ${dayAndTime(play.playedAt)}.`;
    case 'unban':
      return `Ended ${names.target}'s ban on ${dayAndTime(play.playedAt)}.`;
    case 'fall':
      return play.spent === true
        ? `A visit to this post filed, and its warn points landed on ${names.caster}.`
        : `If a Mod Bot's visit to this post files, its warn points land on ${names.caster}, not on ${names.author}. The post keeps its notice.`;
    case 'watch':
      if (play.ends === undefined) return null;
      if (Date.parse(play.ends) <= now) return `Mod Bot patrols were ${timesWords(effect.weight)} as likely to look at ${names.target}'s posts until ${dayAndTime(play.ends)}.`;
      return `Mod Bot patrols are ${timesWords(effect.weight)} as likely to look at ${names.target}'s posts until ${dayAndTime(play.ends)}. A patrol still judges each post against the rules.`;
  }
}
