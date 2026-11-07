/** `glassInk`: a card's chosen ink, made to read on the glass (the Lens's open tab, a play's plate, a mark's edge, a moment's ring). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { glassInk } from './ink.ts';
import { ratio } from '../contrast.ts';

/* The glass is dark in every mode: its field and the ink its open tab writes on a fill are read from its own tokens. */
const tokens = readFileSync(new URL('../glass/tokens.css', import.meta.url), 'utf8');
const token = (name: string) => {
  const m = new RegExp(`${name}:\\s*(#[0-9a-f]{3,6})`, 'iu').exec(tokens);
  if (!m) throw new Error(`no ${name} in glass/tokens.css`);
  return m[1]!;
};
const FIELD = token('--kb-glass-field');
const FIELD_2 = token('--kb-glass-field-2');
const ON_INK = token('--kb-glass-ink-neon');

describe('glassInk', () => {
  for (const dark of ['#000000', '#14030a', '#1a237e', '#3b0000', '#222222', 'rgb(20, 20, 60)']) {
    test(`${dark} is lifted until the tab's words read on it and its edge reads on the field`, () => {
      const ink = glassInk(dark);
      assert.ok(ink, 'a readable color is never dropped');
      assert.ok(ratio(ink, ON_INK) >= 4.5, `${ink} on the open tab: ${ratio(ink, ON_INK).toFixed(2)}`);
      assert.ok(ratio(ink, FIELD) >= 3, `${ink} edge on the field: ${ratio(ink, FIELD).toFixed(2)}`);
      assert.ok(ratio(ink, FIELD_2) >= 3, `${ink} edge on the second field: ${ratio(ink, FIELD_2).toFixed(2)}`);
    });
  }

  test('a lifted ink keeps its hue: a dark blue stays blue', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(glassInk('#1a237e')!.slice(i, i + 2), 16)) as [number, number, number];
    assert.ok(b > r && b > g, `blue leads: ${r},${g},${b}`);
  });

  for (const bright of ['#ff3d7f', '#2ee6ff', '#ffffff', '#ffd400']) {
    test(`${bright}, already readable, is drawn as chosen`, () => {
      assert.equal(glassInk(bright), bright);
    });
  }

  for (const unread of ['var(--kb-glass-salty)', 'magenta', 'rgba(0,0,0,0.5)', '', 'nonsense']) {
    test(`${JSON.stringify(unread)}, which cannot be checked, gives no ink (the alignment's is drawn)`, () => {
      assert.equal(glassInk(unread), undefined);
    });
  }
});
