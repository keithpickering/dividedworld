import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { renderInWorld } from '../test-world.tsx';
import { Debuts, UnmaskLine } from '../thread/lines.tsx';
import { debutPreview, turnPreview } from './previews.ts';

afterEach(cleanup);

const text = (lines: readonly { text: string }[]) => lines.map((l) => l.text);

describe('the preview of a debut', () => {
  const base = { name: 'Pipewrench', className: 'Face' };

  test('silent says nothing is posted, and names no class', () => {
    for (const timing of ['tally', 'now'] as const) {
      const p = debutPreview({ ...base, timing, loudness: 'silent' });
      expect(p.lines).toEqual([]);
      expect(p.nothing).toMatch(/Nothing is posted/u);
      expect(JSON.stringify(p)).not.toContain('Face');
    }
  });

  test('announced names the character and never its class', () => {
    for (const timing of ['tally', 'now'] as const) {
      const p = debutPreview({ ...base, timing, loudness: 'announced' });
      expect(text(p.lines)).toEqual(['Pipewrench debuts']);
      expect(p.lines[0]!.by).toBe('The System');
      expect(JSON.stringify(p)).not.toContain('Face');
    }
  });

  test('with its class names the class in the tally and in the reveal that follows it', () => {
    const p = debutPreview({ ...base, timing: 'tally', loudness: 'with_class' });
    expect(text(p.lines)).toEqual(['Pipewrench debuts as Face', 'Pipewrench revealed: Face']);
  });

  test('says where and when it appears', () => {
    expect(debutPreview({ ...base, timing: 'tally', loudness: 'announced' }).where).toMatch(/next settlement/u);
    expect(debutPreview({ ...base, timing: 'now', loudness: 'announced' }).where).toMatch(/at once/iu);
  });
});

describe('the preview of a Turn', () => {
  const base = { name: 'Pipewrench', was: 'Heel', to: 'Face' };

  test('silent says nobody is told, and names no class', () => {
    const p = turnPreview({ ...base, loudness: 'silent', showFrom: false, showTo: false });
    expect(p.lines).toEqual([]);
    expect(p.nothing).toMatch(/Nobody is told/u);
    expect(JSON.stringify(p)).not.toMatch(/Heel|Face/u);
  });

  test('announced says only that it has Turned', () => {
    const p = turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: false });
    expect(text(p.lines)).toEqual(['Pipewrench has Turned']);
  });

  test('may name the old class, the new one, or both; the new one is also revealed', () => {
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: true, showTo: false }).lines)).toEqual(['Pipewrench has Turned from Heel']);
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: true }).lines)).toEqual(['Pipewrench has Turned to Face', 'Pipewrench revealed: Face']);
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: true, showTo: true }).lines)).toEqual(['Pipewrench has Turned from Heel to Face', 'Pipewrench revealed: Face']);
  });

  test('a silent Turn never carries the names, whatever the flags say', () => {
    expect(turnPreview({ ...base, loudness: 'silent', showFrom: true, showTo: true }).lines).toEqual([]);
  });
});

/* The preview promises what the tally will say: it must be the words the thread draws, or it is a lie. */
describe('the preview and the thread say the same words', () => {
  const lineOf = (payload: Act['payload']) => {
    renderInWorld(<Debuts payload={payload} />);
    const out = document.querySelector('li')!.textContent!;
    cleanup();
    return out;
  };

  test('a debut', () => {
    const named = lineOf({ debuts: [{ name: 'Pipewrench' }] });
    const classed = lineOf({ debuts: [{ name: 'Pipewrench', class: 'face' }] });
    expect(text(debutPreview({ name: 'Pipewrench', className: 'Face', timing: 'tally', loudness: 'announced' }).lines)[0]).toBe(named);
    expect(text(debutPreview({ name: 'Pipewrench', className: 'Face', timing: 'tally', loudness: 'with_class' }).lines)[0]).toBe(classed);
  });

  test('a Turn', () => {
    const cases = [
      [{ name: 'Pipewrench' }, false, false],
      [{ name: 'Pipewrench', was: 'heel' }, true, false],
      [{ name: 'Pipewrench', class: 'face' }, false, true],
      [{ name: 'Pipewrench', was: 'heel', class: 'face' }, true, true],
    ] as const;
    for (const [entry, showFrom, showTo] of cases) {
      const said = lineOf({ turns: [entry] });
      expect(text(turnPreview({ name: 'Pipewrench', was: 'Heel', to: 'Face', loudness: 'announced', showFrom, showTo }).lines)[0]).toBe(said);
    }
  });

  test('a reveal', () => {
    renderInWorld(<UnmaskLine act={{ payload: { class: 'face', message: '' } } as unknown as Act} name="Pipewrench" />);
    const said = document.querySelector('p')!.textContent;
    expect(text(turnPreview({ name: 'Pipewrench', was: 'Heel', to: 'Face', loudness: 'announced', showFrom: false, showTo: true }).lines)[1]).toBe(said);
    render(<span />);
    expect(screen.queryByText('x')).toBeNull();
  });
});
