/** You Were Saying?'s entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as YouWereSayingConfigForm } from '../../../cards/you-were-saying/ConfigForm.tsx';
import { mostSteps, youWereSaying } from '../../../cards/you-were-saying.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import youWereSayingCanvas from './art.webp?url';
import youWereSayingMark from './mark.svg?url';
import youWereSayingArt from './art.json';
import { orbs } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const YouWereSayingEffect = lazy(() => import('../../../cards/you-were-saying/Effect.tsx').then((m) => ({ default: m.YouWereSayingEffect })));

/*
 * You Were Saying? (docs/plans/2026-11-07-you-were-saying-design.md): Pepperoni's color. Its face is a terminal with a blinking cursor, and
 * its price is a range: the machine's price at the base length, each step on top of it.
 */
export const ui: CardUi = {
  key: 'you-were-saying',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: youWereSayingCanvas, mark: youWereSayingMark, credit: youWereSayingArt.credit, tagline: 'Let an old chatbot keep going.' },
  summary: 'Hands a post to a chatbot from 2021, which keeps writing after the author stops.',
  /* Up to the rules' `stack` chain on a post, each continuing the last. */
  status: (plays) => `Typing on, ${Math.min(plays.length, youWereSaying.stack!)} of ${youWereSaying.stack} chained`,
  Effect: YouWereSayingEffect,
  ConfigForm: YouWereSayingConfigForm,
  surcharge: (settings: Settings) => {
    const e = settings.economy;
    return `Longer costs more: +${orbs(e['youWereSaying.stepPrice'] ?? 0)} per step, ${orbs(mostSteps(settings) * (e['youWereSaying.stepPrice'] ?? 0))} at most`;
  },
  describe: (settings: Settings) => {
    const e = settings.economy;
    return `A Pepperoni card, ${youWereSaying.rarity}, cast on a post with words of its own. A chatbot from 2021 reads the post and keeps going after the author stops, and its words type themselves in after the post's. You choose how much it writes, from about ${e['youWereSaying.baseTokens'] ?? 0} tokens, a short paragraph, up to ${e['youWereSaying.mostTokens'] ?? 0}, a rant. The base length costs nothing more to play; each step longer costs ${orbs(e['youWereSaying.stepPrice'] ?? 0)} more. The author can erase it, but all at once. Its words are the chatbot's, never the author's, and the post's own words are always there.`;
  },
  /* The caster's play line says the length the play bought, as the play recorded it (the server wrote it with the play), so it is true after any retune. */
  logPlay: (_config, { tokens }) => (tokens === undefined ? undefined : `It was played for ${tokens} ${tokens === 1 ? 'token' : 'tokens'}.`),
  /* The author's erase is the state `{ cleared }` (the rules' validateState): said as the author's own act. */
  logSave: (state: unknown) => (typeof state === 'object' && state !== null && typeof (state as { cleared?: unknown }).cleared === 'string' ? { what: 'Tail erased', verb: 'erased' } : undefined),
  /* What it did to the author's post: its first text, a new text made for an edit, and a generation that did not come. */
  logWritten: { continued: 'continued it', again: (card: string) => `made its ${card} again`, failed: "didn't take" },
};
