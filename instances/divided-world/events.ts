/**
 * What Divided World's Random Events say (`Instance.events`). An event is private, plain and never Aura; a gear or card line says `{item}`
 * where the found item's name goes. The lines are placeholders the owner approves in review.
 */
import type { EventLine } from '../../engine/rules/cosmetics.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';

export const events: { readonly lines: readonly EventLine[] } = deepFreeze<{ readonly lines: readonly EventLine[] }>({
  lines: [
    { key: 'appreciate', outcome: 'line', text: 'You take a moment to appreciate yourself for once.' },
    { key: 'soveryhappy', outcome: 'line', text: 'Please be on the lookout for a suspect described as an "italian plumber with glowing red eyes and an elongated grin". He, or it, has caused unspeakable horror.' },
    { key: 'debs', outcome: 'line', text: '...D.E.B.S. ALERT...Delfino Police are investigating a potential crime involving colorful goop splatted on character posts.' },
    { key: 'sorry', outcome: 'line', text: 'Sorry to waste your time, I was just wondering...oh, forget it!' },
    { key: 'popup', outcome: 'line', text: 'You come across an annoying pop-up.' },
    { key: 'critical', outcome: 'line', text: 'CRITICAL: Illegal behavior has been detected on this account and will be deleted in five seconds, unless...wait...no, nevermind, I thought you were someone else.' },
    { key: 'forgot', outcome: 'line', text: 'But I totally forgot what it was. You deserve better, and I won\'t let this happen next time.' },
    { key: 'goomba', outcome: 'line', text: 'A passerby implores you to look at their Goomba sprites...you keep moving.' },
    { key: 'split', outcome: 'line', text: 'You pass by an unkempt gentleman in ragged old clothing. He is parading a dirty scrap of cardboard, on which he has scrawled "THE SPLIT IS NEAR!"' },
    { key: 'park-bench', outcome: 'gear', text: 'You find a {item} under a park bench. The real question is what this park bench is doing on a message board.' },
    { key: 'lost-and-found', outcome: 'gear', text: 'Someone left a {item} in the lost and found. You decide you can make better use of it.' },
    { key: 'vending-slot', outcome: 'gear', text: 'A {item} falls out of a vending machine, and you didn\'t even have to pay.' },
    { key: 'ground', outcome: 'card', text: 'You spot an opened booster pack on the ground. Whoever opened it left a card behind: {item}.' },
    { key: 'pocket', outcome: 'card', text: 'You find a loose {item} in a coat pocket. Someone\'s coat pocket, anyway.' },
    { key: 'mail', outcome: 'card', text: 'A {item} arrived in the mail, addressed to "Occupant".' },
  ],
});
