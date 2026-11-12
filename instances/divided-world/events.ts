/**
 * What Divided World's Random Events say (`Instance.events`). An event is private, plain and never Aura; a gear or card line says `{item}`
 * where the found item's name goes. The lines are placeholders the owner approves in review.
 */
import type { EventLine } from '../../engine/rules/cosmetics.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';

export const events: { readonly lines: readonly EventLine[] } = deepFreeze<{ readonly lines: readonly EventLine[] }>({
  lines: [
    { key: 'statue', outcome: 'line', text: 'You touched the statue.' },
    { key: 'bird-migration', outcome: 'line', text: 'Delayed due to Bird Migration.' },
    { key: 'intentional', outcome: 'line', text: 'This was intentional.' },
    { key: 'lag', outcome: 'line', text: 'Pointless lag may occur for no reason.' },
    { key: 'park-bench', outcome: 'gear', text: 'You found a {item} under a park bench. It smells like nachos.' },
    { key: 'lost-and-found', outcome: 'gear', text: 'Someone left a {item} in the lost and found. Nobody is coming back for it.' },
    { key: 'vending-slot', outcome: 'gear', text: 'A {item} fell out of the vending machine. You did not even pay.' },
    { key: 'shoe', outcome: 'card', text: 'A postcard was stuck to your shoe. It\'s a {item}.' },
    { key: 'pocket', outcome: 'card', text: 'You found a {item} in a coat pocket. It was not your coat.' },
    { key: 'mail', outcome: 'card', text: 'A {item} arrived in the mail, addressed to "Occupant".' },
  ],
});
