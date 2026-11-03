/**
 * Divided World's onboarding words, in Gabe's voice (the developer persona, `instance.developer`): the tips the spotlight and the card callouts
 * show, and the welcome letter. Every word is a DRAFT for the owner's review in the PR (docs/plans/2026-11-02-onboarding-plan.md).
 *
 * The glass may joke where it describes the game, and it never bluffs and never reveals what is hidden (CLAUDE.md, "The fiction may lie;
 * the log never does"). The lines that will name the starting gift wait for it (the plan's Task 11), and no setting is retyped as a
 * number, since a retune would leave it untrue. So each line says only what the screen shows the player about their own game, nothing about anyone else's
 * mask, class or reaction. The tips are keyed by the engine's tip keys (engine/ui/tips/keys.ts); `instanceUiProblems` holds this exact.
 */
import type { OnboardingUi } from '../../../engine/ui/types.ts';

export const onboarding: OnboardingUi = Object.freeze({
  tips: Object.freeze({
    'tour-plate': {
      title: 'This is your mask',
      line: 'It is the character you are posting as. The tag beside its name is its class, and no other player can see it unless you reveal it. Swap masks here, or press the picture to see all of yours.',
    },
    'tour-orbs': {
      title: 'These are your orbs',
      line: 'Reactions to your characters fill them at the settlement. Until then, hatched fill shows where you\'re headed. There is a most you can hold, so spend it.',
    },
    'tour-hand': {
      title: 'This is your hand',
      line: 'Cards live here, shared by all your characters. Open it, arm a card, and pick where it lands.',
    },
    grid: {
      title: 'Four corners',
      line: 'Every reaction sits in a corner of this grid: excited or low-key, positive or negative. Most classes are paid by some corners and hurt by others, so a reaction can lift one character and sink another. The Strategy Guide has the whole chart.',
    },
    ghost: {
      title: 'Ghost means estimate',
      line: 'The hatched fill is a ghost: our estimate of where today\'s reactions are taking your Aura. It is only an estimate until the settlement, which is when it becomes real.',
    },
    'first-card': {
      title: 'That is a card',
      line: 'Press a card\'s mark to open the Lens. It says what the card is doing to the post and how it ends.',
    },
  }),
  letter: [
    '## After nine years of development',
    '',
    '...hopefully it would have been worth the wait.',
    '',
    'This is Divided World. It looks like a message board from 2003, and it is one. It is also a game. You\'ll play several characters, each behind a mask, each with a secret class that decides which reactions make it stronger. No other player can see which masks are yours.',
    '',
    'Everything anyone does here is public. Who\'s doing it isn\'t. Work it out, or don\'t.',
    '',
    'Go make somebody.',
    '',
    'Gabe',
  ].join('\n'),
});
