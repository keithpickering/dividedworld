/**
 * Divided World's onboarding words, in Gabe's voice (the developer persona, `instance.developer`): the tips the spotlight and the card callouts
 * show, and the welcome letter. The voice is instances/divided-world/voice/gabe.md; the letter is the first half of the owner's intro post (docs/plans/2026-11-21-gabes-voice-design.md, section 3).
 *
 * The glass may joke where it describes the game, and it never bluffs and never reveals what is hidden (CLAUDE.md, "The fiction may lie;
 * the log never does"). The Starter Pack's lines are this design's (docs/plans/2026-11-18-starter-pack-design.md), and no setting is retyped as a
 * number, since a retune would leave it untrue. So each line says only what the screen shows the player about their own game, nothing about anyone else's
 * mask, class or reaction. The tips are keyed by the engine's tip keys (engine/ui/tips/keys.ts); `instanceUiProblems` holds this exact.
 */
import type { OnboardingUi } from '../../../engine/ui/types.ts';

export const onboarding: OnboardingUi = Object.freeze({
  tips: Object.freeze({
    'tour-plate': {
      title: 'This is your mask',
      line: 'It\'s the character you\'re posting as. The tag beside the name is the class, which no other player can see unless you make it public. Swap masks here, or press the picture to see all of yours.',
    },
    'tour-orbs': {
      title: 'These are your orbs',
      line: 'Aura lands here at each settlement: from reactions to your characters, and from reacting to other players\' posts and cards. Until then, hatched fill shows where you\'re headed. There\'s a most you can hold, so spend it. I would.',
    },
    'tour-hand': {
      title: 'This is your hand',
      line: 'Cards live here, shared by all your characters. A new pack waits here sealed until you open it. Open the hand, arm a card, and pick where it lands.',
    },
    grid: {
      title: 'Four corners',
      line: 'Every reaction sits in a corner of this grid: excited or low-key, positive or negative. Most classes are paid by some corners and hurt by others, so a reaction can lift one character and sink another. The Strategy Guide has the whole chart.',
    },
    ghost: {
      title: 'Ghost means estimate',
      line: 'The hatched fill is a ghost: my estimate of where the reactions so far are taking your Aura. It\'s a guess until the settlement, which is when it becomes real.',
    },
    'first-card': {
      title: 'That is a card',
      line: 'Press a card\'s mark to open the Lens. It says what the card is doing to the post and how it ends.',
    },
    shine: {
      title: 'This post is shiny',
      line: 'Tilt your phone and the light moves across it, like tilting a real foil card.',
      action: 'Turn on tilt',
    },
  }),
  letter: [
    '## Hi. I\'m Gabe.',
    '',
    'You might know me as the creator of Minus World, a forum and a fighting game all-in-one. Recently, I made the decision to strip the RAM from Minus World\'s servers and sell it to Sam Altman to pay for another yacht for myself. As a result, Minus World had to be shut down. Its denizens were left stranded with nowhere to go, like sad, wandering hobos. Hobos without yachts.',
    '',
    'Although Minus World was eventually restored to working order (through no fault of my own), I couldn\'t shake the feeling that maybe I behaved sort of selfishly in this situation. To clear my conscience, I had the fellas at the lab whip up something new. This is basically like Minus World, but half as good—So I called it "Divided World".',
    '',
    'I can\'t lie to you. Prioritizing this project meant that several in-development games nearing completion, most notably Half-Life: Nuts & Bolts, had to be shelved, likely permanently. These games\' assets will be repurposed as purchasable cosmetics, so they will live on in our hats. Uh, I mean hearts.',
    '',
    'Have fun,',
    'Gabe',
  ].join('\n'),
});
