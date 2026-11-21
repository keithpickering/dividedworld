/**
 * Buzzkill's settings in the play form: "The Gimmick it ends", one radio per Gimmick up on the target, oldest first, each with its card's face and
 * name and when it ends. Choosing one gives `{ play }`, the key `buzzkill.validateConfig` takes; with none up it says so plainly.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { cardsUi } from '../../ui/cards.ts';
import { instanceUi } from '../../ui/index.ts';
import { instance } from '../../index.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;
const kayfa = { instance, ui: { ...instanceUi, cards: cardsUi } } as unknown as Kayfa;
const A = '3f1c2a54-8d1e-4b0a-9a56-0c6d1b7e2f10';
const B = '5b8e0d7a-1c4f-4e2b-8f33-9a1d6c0e4b21';
const gimmicks = [
  { play: A, card: 'kick-me', caster: 'c1', ends: '2026-11-24T15:00:00.000Z' },
  { play: B, card: 'force-field', caster: 'c2' },
];

function show(onChange: (c: Record<string, unknown>) => void, list: typeof gimmicks | undefined = gimmicks) {
  return render(<KayfaProvider value={kayfa}><ConfigForm config={undefined} onChange={onChange} post={POST} id="play" {...(list ? { gimmicks: list } : {})} /></KayfaProvider>);
}

describe('the Gimmick it ends', () => {
  test('is a group with one radio per Gimmick, oldest first, by its card\'s name, with its end where it has one', () => {
    show(() => {});
    const group = screen.getByRole('group', { name: 'The Gimmick it ends' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([expect.stringMatching(/^Kick Me.*ends /u), expect.stringMatching(/^Force Field/u)]);
    expect(radios[1]!.closest('label')!.textContent).not.toMatch(/ends /u);
  });

  test('each radio shows its card\'s mark image, kind tag and rarity word; an unknown card key falls back to its key with no face', () => {
    show(() => {}, [...gimmicks, { play: 'c', card: 'no-such-card', caster: 'c3' }]);
    const [kick, field, unknown] = screen.getAllByRole('radio').map((r) => r.closest('label')!);
    expect(kick!.querySelector('img.kb-trap-face-mark')).not.toBeNull();
    expect(kick!.querySelector('.kb-trap-face-tag')!.textContent).toBe('Gimmick');
    expect(kick!.querySelector('.kb-trap-face-rarity')!.textContent).toMatch(/Common/u);
    expect(field!.querySelector('.kb-trap-face-rarity')!.textContent).toMatch(/\w/u);
    expect(unknown!.querySelector('.kb-trap-face-name')!.textContent).toBe('no-such-card');
    expect(unknown!.querySelector('img')).toBeNull();
    expect(unknown!.querySelector('.kb-trap-face-tag')).toBeNull();
    expect(unknown!.querySelector('.kb-trap-face-rarity')).toBeNull();
  });

  test('choosing one gives { play }; the keyboard reaches the group by Tab and an arrow key changes the choice', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    show(onChange);
    await user.click(screen.getAllByRole('radio')[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ play: A });
    (document.activeElement as HTMLElement).blur();
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByRole('radio')[0]);
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith({ play: B });
  });

  test('with none up says so plainly and offers nothing', () => {
    show(() => {}, []);
    expect(screen.getByText('Nothing here to end.')).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });
});
