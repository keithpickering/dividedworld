import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import type { Act } from '../data/api.ts';
import { renderInWorld } from '../test-world.tsx';
import { AnnounceLine, UnmaskLine } from '../thread/lines.tsx';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { debutPreview, revealPreview, turnPreview } from './previews.ts';

afterEach(cleanup);

const text = (lines: readonly { text: string }[]) => lines.map((l) => l.text);

describe('the preview of a debut', () => {
  const base = { name: 'Pipewrench', className: 'Face', pronouns: PRONOUN_PRESETS.it };

  test('silent says nothing is posted, and names no class', () => {
    for (const timing of ['tally', 'now'] as const) {
      const p = debutPreview({ ...base, timing, loudness: 'silent' });
      expect(p.lines).toEqual([]);
      expect(p.nothing).toMatch(/Nothing is posted/u);
      expect(JSON.stringify(p)).not.toContain('Face');
    }
  });

  test('a silent debut names the character\'s own pronouns, verbs agreeing, and no other set', () => {
    expect(debutPreview({ ...base, pronouns: PRONOUN_PRESETS.she, timing: 'now', loudness: 'silent' }).nothing).toBe('Nothing is posted. Pipewrench is on the board at once, and her first post is her entrance.');
    expect(debutPreview({ ...base, pronouns: PRONOUN_PRESETS.they, timing: 'now', loudness: 'silent' }).nothing).toBe('Nothing is posted. Pipewrench is on the board at once, and their first post is their entrance.');
    expect(debutPreview({ ...base, timing: 'now', loudness: 'silent' }).nothing).toBe('Nothing is posted. Pipewrench is on the board at once, and its first post is its entrance.');
  });

  test('announced names the character and never its class', () => {
    for (const timing of ['tally', 'now'] as const) {
      const p = debutPreview({ ...base, timing, loudness: 'announced' });
      expect(text(p.lines)).toEqual(['Pipewrench debuts.']);
      expect(p.lines[0]!.by).toBe('Pipewrench');
      expect(JSON.stringify(p)).not.toContain('Face');
    }
  });

  test('with its class names the class in the one Promo, which is also the reveal', () => {
    const p = debutPreview({ ...base, timing: 'tally', loudness: 'with_class' });
    expect(text(p.lines)).toEqual(['Pipewrench debuts as a Face.']);
    expect(p.lines[0]!.by).toBe('Pipewrench');
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
    expect(text(p.lines)).toEqual(['Pipewrench has Turned.']);
  });

  test('may name the old class, the new one, or both; one Promo says it all', () => {
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: true, showTo: false }).lines)).toEqual(['Pipewrench has Turned, leaving Heel.']);
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: false, showTo: true }).lines)).toEqual(['Pipewrench has Turned to Face.']);
    expect(text(turnPreview({ ...base, loudness: 'announced', showFrom: true, showTo: true }).lines)).toEqual(['Pipewrench has Turned from Heel to Face.']);
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

  test('a debut', () => {
    expect(text(debutPreview({ name: 'Pipewrench', className: 'Face', pronouns: PRONOUN_PRESETS.it, timing: 'tally', loudness: 'announced' }).lines)[0]).toBe(lineOf({ what: 'debut' }));
    expect(text(debutPreview({ name: 'Pipewrench', className: 'Face', pronouns: PRONOUN_PRESETS.it, timing: 'tally', loudness: 'with_class' }).lines)[0]).toBe(lineOf({ what: 'debut', class: 'face' }));
  });

  test('a Turn, naming neither class, one or both', () => {
    const cases = [
      [{ what: 'turn' }, false, false],
      [{ what: 'turn', was: 'heel' }, true, false],
      [{ what: 'turn', class: 'face' }, false, true],
      [{ what: 'turn', was: 'heel', class: 'face' }, true, true],
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

describe('from the Task 9 spec review', () => {
  test('a preview that names a class before one is chosen says so, never a blank', () => {
    const p = debutPreview({ name: 'Spritey', className: '', pronouns: PRONOUN_PRESETS.it, timing: 'tally', loudness: 'with_class' });
    expect(p.lines.map((l) => l.text)).toEqual(['Spritey debuts as a (the class you choose).']);
  });
});
