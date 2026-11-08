import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { LETTERING, reading } from '../../../engine/ui/postbit/group-bar-face.ts';
import { MODES, tokensOf } from '../../../engine/ui/contrast.ts';
import { groups } from '../groups.ts';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
const engine = read('engine/ui/tokens.css');
const house = read('instances/divided-world/ui/theme.css');
const themes = ['blue-steel', 'fan-site', 'hot-rod', 'midnight'].map((t) => read(`instances/divided-world/ui/themes/${t}.css`));
const all = [...groups.ladder, ...groups.conferred];

/*
 * The rank bar's lettering (engine/ui/postbit/GroupBar.tsx) on each Divided World group's face, in the house theme and each tribute theme, in every
 * mode a board resolves to. The lettering is white with a black halo. A group whose face holds the white alone at 4.5:1 is read as it is; one that
 * does not is read through the halo, which holds (white on black). Today that is every group: the lightest the face gets is its glossy top, and white
 * alone reaches 4.5:1 on none of the seven (Regulars comes closest at 4.3). The list is pinned here, so a recolor that changes it is seen.
 */
const NEEDS_THE_HALO = ['members', 'regulars', 'oldGuard', 'personalityCores', 'trialMembers', 'teachersPet', 'hallMonitors'];

describe('the group bar for each Divided World group', () => {
  for (const [name, sheets] of [['the house theme', [engine, house]], ...themes.map((t, i) => [`tribute theme ${i + 1}`, [engine, t]] as const)] as const) {
    test(`reads in ${name}, in every mode: the ink holds on the face or through the halo`, () => {
      const modes = tokensOf(...sheets);
      for (const g of all) for (const mode of MODES) {
        const r = reading(g.color, modes[mode], g.stripe === true);
        expect(r.alone || r.edge >= LETTERING, `${g.key} in ${mode}`).toBe(true);
      }
    });
  }

  test('the groups whose face cannot hold the white alone, and so are read through the halo, are exactly these', () => {
    const tokens = tokensOf(engine, house).light;
    expect(all.filter((g) => !reading(g.color, tokens, g.stripe === true).alone).map((g) => g.key).sort()).toEqual([...NEEDS_THE_HALO].sort());
  });
});
