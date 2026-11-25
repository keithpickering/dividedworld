import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { renderInWorld } from '../test-world.tsx';
import { AnnounceLine, UnmaskLine } from '../thread/lines.tsx';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { revealPreview, turnPreview } from './previews.ts';

afterEach(cleanup);

const text = (lines: readonly { text: string }[]) => lines.map((l) => l.text);

describe('the preview of a Turn', () => {
  const base = { name: 'Pipewrench', was: 'Heel', to: 'Face' };
  const NEXT = ' It takes effect at the next settlement.';

  test('silent says nobody is told and that it is posted nowhere, and names no class', () => {
    const p = turnPreview({ ...base, loudness: 'silent', showFrom: false, showTo: false });
    expect(p.lines).toEqual([]);
    expect(p.nothing).toMatch(/Nobody is told/u);
    expect(p.where).toBe('Nowhere: a silent Turn is posted nowhere');
    expect(JSON.stringify(p)).not.toMatch(/Heel|Face/u);
  });

  test('announced says that it has Turned, and that it takes effect at the next settlement', () => {
    const p = turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: false });
    expect(text(p.lines)).toEqual([`Pipewrench has Turned.${NEXT}`]);
  });

  test('may name the old class, the new one, or both; one post says it all', () => {
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: true, showTo: false }).lines)).toEqual([`Pipewrench has Turned, leaving Heel.${NEXT}`]);
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: true }).lines)).toEqual([`Pipewrench has Turned to Face.${NEXT}`]);
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: true, showTo: true }).lines)).toEqual([`Pipewrench has Turned from Heel to Face.${NEXT}`]);
  });

  test('is posted at once, in the thread chosen, or the one the player will choose; never in a season\'s Roster Report', () => {
    expect(turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: false, threadTitle: 'The tea thread' }).where).toBe('At once, in The tea thread');
    expect(turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: false }).where).toBe('At once, in the thread you choose');
    expect(JSON.stringify(turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: false }))).not.toMatch(/Promo/u);
  });

  test('a silent Turn never carries the names, whatever the flags say', () => {
    expect(turnPreview({ ...base, loudness: 'silent', showFrom: true, showTo: true }).lines).toEqual([]);
  });
});

/* The preview promises what the Promo will say: it must be the words the thread draws, or it is a lie. */
describe('the preview and the thread say the same words', () => {
  const lineOf = (payload: Act['payload']) => {
    renderInWorld(<AnnounceLine act={{ payload } as unknown as Act} name="Pipewrench" />);
    const out = document.querySelector('p')!.textContent!;
    cleanup();
    return out;
  };

  test('a Turn, naming neither class, one or both', () => {
    const cases = [
      [{ what: 'turn', ahead: true }, false, false],
      [{ what: 'turn', ahead: true, was: 'heel' }, true, false],
      [{ what: 'turn', ahead: true, class: 'face' }, false, true],
      [{ what: 'turn', ahead: true, was: 'heel', class: 'face' }, true, true],
    ] as const;
    for (const [payload, showFrom, showTo] of cases) {
      expect(text(turnPreview({ name: 'Pipewrench', was: 'Heel', to: 'Face', loudness: 'announced', showFrom, showTo }).lines)[0]).toBe(lineOf(payload));
    }
  });

  test('the character\'s own reveal, with and without its words', () => {
    for (const message of ['', 'It was me.']) {
      renderInWorld(<UnmaskLine act={{ payload: { class: 'face', message } } as unknown as Act} name="Pipewrench" />);
      const said = document.querySelector('p')!.textContent;
      cleanup();
      expect(text(revealPreview({ name: 'Pipewrench', className: 'Face', message, threadTitle: null }).lines)).toEqual([said]);
    }
  });
});

describe('the preview of a reveal', () => {
  const base = { name: 'Pipewrench', className: 'Face', message: '', threadTitle: 'The tea thread' };

  test('is one line, the character\'s own and never The System\'s', () => {
    const p = revealPreview(base);
    expect(text(p.lines)).toEqual(['Pipewrench revealed: Face']);
    expect(p.lines[0]!.by).toBe('Pipewrench');
    expect(p.nothing).toBeNull();
  });

  test('carries the character\'s words, as the server stores them, trimmed', () => {
    expect(text(revealPreview({ ...base, message: '  It was me.  ' }).lines)).toEqual(['Pipewrench revealed: Face — “It was me.”']);
    expect(text(revealPreview({ ...base, message: '   ' }).lines)).toEqual(['Pipewrench revealed: Face']);
  });

  test('says where it appears: the thread chosen, or the thread the player will choose', () => {
    expect(revealPreview(base).where).toBe('At once, in The tea thread');
    expect(revealPreview({ ...base, threadTitle: null }).where).toBe('At once, in the thread you choose');
  });
});
