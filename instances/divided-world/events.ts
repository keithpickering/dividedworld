/**
 * What Divided World's Random Events say (`Instance.events`). An event is private, plain and never Aura; a gear or card line says `{item}`
 * where the found item's name goes. The lines are placeholders the owner approves in review.
 */
import type { EventLine } from '../../engine/rules/cosmetics.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';

export const events: { readonly lines: readonly EventLine[] } = deepFreeze<{ readonly lines: readonly EventLine[] }>({
  lines: [
    { key: 'appreciate', outcome: 'line', text: 'You take a moment to appreciate yourself for once.' },
    { key: 'soveryhappy', outcome: 'line', text: 'Please be on the lookout for a suspect described as an "italian plumber with red eyes and an elongated grin". He, or it, has caused unspeakable horror.' },
    { key: 'debs', outcome: 'line', text: '...D.E.B.S. ALERT...Police are investigating a potential crime involving colorful goop splatted on character posts.' },
    { key: 'lag', outcome: 'line', text: 'Pointless lag may occur for no reason. Take this, for instance!' },
    { key: 'park-bench', outcome: 'gear', text: 'You find a {item} under a park bench. The real question is what this park bench is doing in cyberspace.' },
    { key: 'lost-and-found', outcome: 'gear', text: 'Someone left a {item} in the lost and found. You decide you can make better use of it.' },
    { key: 'vending-slot', outcome: 'gear', text: 'A {item} falls out of a vending machine, and you didn\'t even have to pay.' },
    { key: 'ground', outcome: 'card', text: 'You spot an opened booster pack on the ground. Whoever opened it left a card behind: {item}.' },
    { key: 'pocket', outcome: 'card', text: 'You find a loose {item} in a coat pocket. Someone\'s coat pocket, anyway.' },
    { key: 'mail', outcome: 'card', text: 'A {item} arrived in the mail, addressed to "Occupant".' },
  ],
});
