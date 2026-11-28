/** Heads Will Roll's words (ui.ts): where the instance has set no number, `describe` says the orbit's own defaults, never a made-up one. */
import { expect, test } from 'vitest';
import type { Settings } from '../../../../engine/rules/types.ts';
import { ORBIT } from './orbit.ts';
import { describeWords } from './words.ts';


const settingsOf = (cardSettings: Record<string, number>) => ({ cardSettings, economy: {} }) as unknown as Settings;

test('with no numbers set, describe says the reel base and the Overreaction weight the orbit defaults to', () => {
  const words = describeWords(settingsOf({}));
  expect(words).toContain(`about ${ORBIT.defaults.reelBase} seconds`);
  expect(words).toContain(`counting ${ORBIT.defaults.overMass} times as heavy`);
});

test('with numbers set, describe says them', () => {
  const words = describeWords(settingsOf({ 'headsWillRoll.reelBase': 1.5, 'headsWillRoll.overMass': 3 }));
  expect(words).toContain('about 1.5 seconds');
  expect(words).toContain('counting 3 times as heavy');
});
