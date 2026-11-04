/**
 * PLACEHOLDER MOD BOT. The first Mod Bots are written with the owner when the Bosses are (the
 * system plan, Task 5, amended 2026-10-31). Until then this one keeps `firstStaff` valid, and the
 * setting `systemEnabled` (false) keeps it from acting. Nothing a Mod Bot does is built in Part 1;
 * these fields are fixed now so the roster can be written against them.
 */
import type { Persona } from '../../../../engine/rules/types.ts';
import { persona } from '../persona.ts';

const name = 'Hall Monitor (placeholder)';
const title = 'Placeholder Mod Bot';

export const placeholderMonitor: Persona = {
  key: 'placeholder-monitor',
  name,
  title,
  signature: 'Walk, do not post. (Placeholder Mod Bot.)',
  beats: ['general'],
  petRules: [],
  strictness: { visitHours: { least: 2, most: 12 }, bands: ['small'] },
  // A quiz: the placeholder has to be weak to something, and the questions are dumb on purpose.
  weakness: {
    kind: 'quiz',
    questions: [
      { question: 'What color is the orb?', choices: ['Orb-colored', 'Beige', 'Taxes'], answer: 'Orb-colored' },
      { question: 'How many Bosses is it legal to have at once?', choices: ['One', 'Several', 'Yes'], answer: 'One' },
    ],
  },
  voice: 'chat',
  persuadedBy: 'Sincere, polite appeals that cite a rule by its number; it is unmoved by bravado.',
  // DRAFT for the owner: the Boss fields below are placeholders, there so every persona has every field.
  startingHobby: 'DRAFT: clipboards (it collects the ones other people put down)',
  temperament: 'Earnest, literal and a little proud of its lanyard. It enforces whatever it was told with total sincerity.',
  persona: persona({
    name,
    title,
    temperament: 'Earnest, literal and a little proud of its lanyard. It enforces whatever it was told with total sincerity.',
    voice: 'Short, polite and slightly stiff. Says "friendly reminder" before a warning. Never jokes on purpose.',
    habits: ['It announces its own arrival in a thread as though it were a fire drill.', 'It thanks everyone it visits for their cooperation.'],
  }, 'bot'),
};
