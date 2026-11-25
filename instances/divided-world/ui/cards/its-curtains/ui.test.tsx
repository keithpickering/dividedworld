/**
 * It's Curtains' entry in the screens' card list (docs/plans/2026-11-23-its-curtains-plan.md, Task 6): its face and fields, its rules in words read from the settings the
 * instance runs (the two surcharges are never written in), a tagline and status that fit the Lens's and the plate's limits, a tag in the play's fabric, and the log's line.
 */
import { describe, expect, test } from 'vitest';
import type { CardPlay } from '../../../../../engine/ui/cards/types.ts';
import { wordsProblems } from '../../../../../engine/ui/cards/lens-words.ts';
import { itsCurtains, FABRICS } from '../../../cards/its-curtains.ts';
import { instance } from '../../../index.ts';
import { setMoveWords } from '../words.ts';
import { ConfigForm } from '../../its-curtains/ConfigForm.tsx';
import { ui } from './ui.ts';

const play = (fabric: unknown): CardPlay => ({ id: 'ic1', card: 'its-curtains', layer: 1, caster: 'c1', message: '', config: { fabric }, playedAt: '2026-11-25T12:00:00Z', post: 'p1' });
const withEconomy = (second: number, third: number) => ({ ...instance.settings, economy: { ...instance.settings.economy, 'itsCurtains.secondAdd': second, 'itsCurtains.thirdAdd': third } });

describe('its entry', () => {
  test('is the card\'s, with its face in the owner\'s red, the engine\'s row cover, and its four sounds', () => {
    expect(ui.key).toBe('its-curtains');
    expect(ui.art).toMatchObject({ color: '#f00000', ink: '#1a0000', tagline: 'Hide it behind a curtain. Ta-da!' });
    expect(ui.art.credit).toBeTruthy();
    expect(ui.coversRow).toBe(true);
    expect(ui.takeover).toBeUndefined();
    expect(ui.foldsRow).toBeUndefined();
    expect(ui.Effect).toBeDefined();
    expect(ui.Cover).toBeDefined();
    expect(ui.ConfigForm).toBe(ConfigForm);
    expect(ui.sounds).toEqual(['its-curtains.drumroll', 'its-curtains.crash', 'its-curtains.whoosh', 'its-curtains.tada']);
    expect(ui.summary).toBe('Hangs a curtain over a post, author and all. Each reader opens it with a press, to a drumroll.');
    expect(ui.hint).toBe('Press the curtain to see the post.');
  });

  test('its status counts a stack, and its status and tagline fit the Lens\'s and the plate\'s limits', () => {
    const status = ui.status as (plays: readonly CardPlay[]) => string;
    expect(status([play('red')])).toBe('Behind a curtain');
    expect(status([play('red'), play('gold')])).toBe('2 curtains stacked');
    expect(status([play('red'), play('gold'), play('black')])).toBe('3 curtains stacked');
    for (const n of [1, 2, 3]) expect(wordsProblems('status', status(Array.from({ length: n }, () => play('red'))))).toEqual([]);
    /* the plate: two lines of at most 20 characters, wrapped greedily at spaces */
    const lines: string[] = [];
    let line = '';
    for (const word of ui.art.tagline!.split(' ')) {
      if (line !== '' && `${line} ${word}`.length > 20) { lines.push(line); line = word; } else line = line === '' ? word : `${line} ${word}`;
    }
    lines.push(line);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(20);
  });

  test('its words read the two surcharges from the settings, and never write them in', () => {
    const words = ui.describe(instance.settings);
    expect(words).toBe(`A Pepperoni card, ${itsCurtains.rarity}. It hangs a curtain in the fabric you choose over a post, author and all. A drumroll plays while a reader points at it, and one press opens it, with a ta-da and confetti. Each reader opens it for themselves, and the post's effects start only then. Up to ${itsCurtains.stack} curtains stack, each opened in turn; the second costs 1.00 more to play and the third 2.00 more. ${setMoveWords('the quoting post')}`);
    const other = ui.describe(withEconomy(350, 725));
    expect(other).toContain('the second costs 3.50 more to play and the third 7.25 more');
    expect(other).not.toContain('1.00');
  });

  test('its tag is the play\'s fabric\'s mid shade, and says nothing of a fabric it does not know', () => {
    for (const [key, f] of Object.entries(FABRICS)) expect(ui.tag!(play(key), [play(key)])).toBe(f.mid);
    expect(ui.tag!(play('#fff'), [])).toBeUndefined();
  });

  test('its log line names the fabric, and says nothing of one it does not know', () => {
    expect(ui.logPlay!({ fabric: 'royal-blue' }, {})).toBe('It hung a Royal Blue curtain over the post.');
    expect(ui.logPlay!({ fabric: 'red' }, {})).toBe('It hung a Red curtain over the post.');
    expect(ui.logPlay!({ fabric: 'chartreuse' }, {})).toBeUndefined();
    expect(ui.logPlay!({}, {})).toBeUndefined();
  });
});
