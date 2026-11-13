/**
 * You Were Saying?'s length in the play form (docs/plans/2026-11-07-you-were-saying-plan.md, Task 9): a native range input from the base
 * length to the most the economy allows, each step named in words with its price beside it, the price the card's own `playPrice`.
 * A browser steps a range on an arrow key and fires `change`; jsdom does not step it, so the tests fire the change the key would.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { defaults } from '../../settings.ts';
import { youWereSaying } from '../you-were-saying.ts';
import { ConfigForm } from './ConfigForm.tsx';

const post = { id: 'p', currentPayload: { body: 'Once upon a time' } } as unknown as Act;
const form = (config: Record<string, unknown> | undefined, cardEconomy: Record<string, number> = {}, live: Record<string, number> = {}) => {
  cleanup();
  const onChange = vi.fn();
  const kayfa = { instance: { settings: defaults }, settings: { cardEconomy, ...live } } as unknown as Kayfa;
  render(<KayfaProvider value={kayfa}><ConfigForm config={config} onChange={onChange} post={post} id="play" /></KayfaProvider>);
  return { onChange, slider: screen.getByLabelText('How much it writes') as HTMLInputElement };
};

describe("You Were Saying?'s play form", () => {
  test("the slider's value is the config's steps, from 0 up to the most the economy allows", () => {
    const { slider } = form({ steps: 3 });
    expect(slider).toHaveAttribute('type', 'range');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '7');
    expect(slider).toHaveAttribute('step', '1');
    expect(slider.value).toBe('3');
  });

  test('a form nobody has touched holds the base length and hands it back, so playing straight away plays it', () => {
    const { onChange, slider } = form(undefined);
    expect(slider.value).toBe('0');
    expect(onChange).toHaveBeenCalledWith({ steps: 0 });
  });

  test('a key that steps the range hands back the config with the new steps', () => {
    const { onChange, slider } = form({ steps: 2 });
    fireEvent.change(slider, { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({ steps: 3 });
    fireEvent.change(slider, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith({ steps: 1 });
  });

  test("the price shown is playPrice of the step, free at the base and said plainly", () => {
    for (const steps of [0, 3, 7]) {
      const price = youWereSaying.playPrice(defaults, { reach: 'post', act: 'p', kind: 'post', length: 16, text: 'Once upon a time' }, { steps });
      const { slider } = form({ steps });
      expect(slider.getAttribute('aria-valuetext')).toContain(steps === 0 ? 'free to play' : `${(price / 100).toFixed(2)} orbs more`);
    }
    form({ steps: 7 });
    expect(screen.getByText('1.75')).toBeInTheDocument();
    expect(screen.getByText(/1\.75 on top of the price you paid at the machine/)).toBeInTheDocument();
    form({ steps: 0 });
    expect(screen.getByText('Nothing more to play it: its price was paid at the machine.')).toBeInTheDocument();
  });

  test("the slider's value text reads naturally, and only it is announced: no live region repeats it", () => {
    const { slider } = form({ steps: 4 });
    expect(slider).toHaveAttribute('aria-valuetext', 'a paragraph and a half, 1.00 orb more');
    expect(slider).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('the group and the slider have names that do not repeat', () => {
    form({ steps: 1 });
    expect(screen.getAllByText('How much it writes')).toHaveLength(1);
    expect(screen.queryByRole('group')).toBeNull();
  });

  test('the first and last steps are named in words, in the slider\'s value text too', () => {
    expect(form({ steps: 0 }).slider).toHaveAttribute('aria-valuetext', 'about a sentence, free to play');
    expect(form({ steps: 7 }).slider).toHaveAttribute('aria-valuetext', 'a rant, 1.75 orbs more');
    expect(screen.getByText('a rant')).toBeInTheDocument();
  });

  test("the range's max follows the live settings when they lower it", () => {
    const { slider } = form({ steps: 1 }, { 'youWereSaying.mostTokens': 100 });
    expect(slider).toHaveAttribute('max', '3');
  });

  test("the slider's last stop fits the window: a window of 400 and a floor of 256 leave 144 tokens, step 4", () => {
    const { slider } = form({ steps: 1 }, {}, { oldVoiceWindow: 400, oldVoicePromptFloor: 256 });
    expect(slider).toHaveAttribute('max', '4');
  });

  test("a window at or below the floor leaves a single stop, never a broken slider", () => {
    for (const live of [{ oldVoiceWindow: 270, oldVoicePromptFloor: 256 }, { oldVoiceWindow: 64, oldVoicePromptFloor: 256 }]) {
      const { slider } = form({ steps: 1 }, {}, live);
      expect(slider).toHaveAttribute('max', '0');
    }
  });

  test("a window or floor that is not a number is ignored, and the instance's own settings stand", () => {
    for (const bad of [null, '400', undefined, NaN]) {
      const { slider } = form({ steps: 1 }, {}, { oldVoiceWindow: bad as never, oldVoicePromptFloor: bad as never });
      expect(slider).toHaveAttribute('max', '7');
    }
  });

  test("the range's max never passes what the card's validateConfig accepts, whatever the live settings raise it to", () => {
    const { slider } = form({ steps: 1 }, { 'youWereSaying.mostTokens': 400 });
    expect(slider).toHaveAttribute('max', '7');
    expect(youWereSaying.validateConfig({ steps: 8 }).ok).toBe(false);
  });

  test('the words follow the step\'s tokens, so overridden step sizes still describe the length honestly', () => {
    const economy = { 'youWereSaying.stepTokens': 50 };
    expect(form({ steps: 0 }, economy).slider).toHaveAttribute('aria-valuetext', expect.stringContaining('about a sentence'));
    expect(form({ steps: 1 }, economy).slider).toHaveAttribute('aria-valuetext', expect.stringContaining('a short paragraph'));
    expect(form({ steps: 3 }, economy).slider).toHaveAttribute('aria-valuetext', expect.stringContaining('a very long paragraph'));
  });

  test('every step has its own words', () => {
    const said = new Set<string>();
    for (let i = 0; i <= 7; i++) {
      const { slider: s } = form({ steps: i });
      said.add(String(s.getAttribute('aria-valuetext')).split(',')[0] ?? '');
    }
    expect(said.size).toBe(8);
  });

  test('the form is a ConfigRange, the words and price line and a ConfigHint, and draws no class of its own', () => {
    const { slider } = form({ steps: 4 });
    expect(slider).toHaveClass('kb-play-range');
    expect(slider.closest('.kb-play-config-field')).not.toBeNull();
    expect(document.querySelector('.dw-ywsf-length')).not.toBeNull();
    const fine = screen.getByText(/on top of the price you paid at the machine/);
    expect(fine).toHaveClass('kb-play-fine');
    expect(fine).not.toHaveAttribute('role');
    for (const gone of ['dw-ywsf-form', 'dw-ywsf-label', 'dw-ywsf-fine']) expect(document.querySelector(`.${gone}`)).toBeNull();
  });
});
