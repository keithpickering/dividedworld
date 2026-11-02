/**
 * Divided World's words for a hint (the alerts design's section 5; `AlertCopy.hint`). The glass describes the game here, so it may
 * joke, and it never bluffs: each line says only what the engine counted, from the reaction counts anyone can see on the post. A hint is
 * about a post or about a card play (`about.card`), and the words never call one the other.
 */
interface Words { readonly line: string; readonly detail: string }

const COUNTED = 'Counted from the reaction counts anyone can see.';

const LEADING: Readonly<Record<string, { post: Words; card: Words }>> = {
  'leading:excitedNegative': {
    post: { line: 'Your post is picking up heat', detail: `Most of the reactions it has drawn lately are the excited, negative kind. The room is fired up, and not in your favor. ${COUNTED}` },
    card: { line: 'Your card is picking up heat', detail: `Most of the reactions it has drawn lately are the excited, negative kind. The room has opinions about that play. ${COUNTED}` },
  },
  'leading:excitedPositive': {
    post: { line: 'Your post is popping off', detail: `Most of the reactions it has drawn lately are the excited, positive kind. Somebody out there is on their feet. ${COUNTED}` },
    card: { line: 'Your card is popping off', detail: `Most of the reactions it has drawn lately are the excited, positive kind. That play landed. ${COUNTED}` },
  },
  'leading:calmPositive': {
    post: { line: 'Your post is getting polite shrugs', detail: `Most of the reactions it has drawn lately are the calm, positive kind: a nod, a cup of tea. Nobody is angry, and nobody is losing their mind either. ${COUNTED}` },
    card: { line: 'Your card is getting polite shrugs', detail: `Most of the reactions it has drawn lately are the calm, positive kind: a nod, a cup of tea. Nobody is angry, and nobody is losing their mind either. ${COUNTED}` },
  },
  'leading:boredNegative': {
    post: { line: 'Your post is getting groans', detail: `Most of the reactions it has drawn lately are the bored, negative kind. It might be exactly what you were going for. ${COUNTED}` },
    card: { line: 'Your card is getting groans', detail: `Most of the reactions it has drawn lately are the bored, negative kind. It might be exactly what you were going for. ${COUNTED}` },
  },
  divisive: {
    post: { line: 'Your post is dividing the room', detail: `A real share of the reactions it has drawn lately are positive and a real share are negative. Half the room is cheering and the other half is not. ${COUNTED}` },
    card: { line: 'Your card is dividing the room', detail: `A real share of the reactions it has drawn lately are positive and a real share are negative. Half the room is cheering and the other half is not. ${COUNTED}` },
  },
  thunder: {
    post: { line: 'A card is stealing your post\'s thunder', detail: 'A card played on your post has drawn more reactions than the post itself has. The card is the main event now.' },
    card: { line: 'Your card is stealing the thunder', detail: 'The card you played has drawn more reactions than the post it landed on. You are the main event now.' },
  },
};

export function hintWords(pattern: string, about: { readonly card: boolean }): Words | undefined {
  const words = LEADING[pattern];
  return words ? (about.card ? words.card : words.post) : undefined;
}
